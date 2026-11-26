// What the athlete set up for AI on this computer. The choices (which provider, which model, a local server's
// address) are plain JSON in ai.json; keys and sign-in tokens are one JSON object encrypted with the OS keychain in
// ai-secrets.bin. Neither leaves the main process: the page only ever hears which providers are ready.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sealer } from "../secrets";
import { provider, type ProviderId } from "./catalog";

export interface AIChoices {
  /** The provider Coach and the writers use; null until one is set up. */
  picked: ProviderId | null;
  /** The model picked for each provider; a provider without one uses its default. */
  models: Partial<Record<ProviderId, string>>;
  /** How hard each provider thinks ("low" … "max"); "" or none is the model's own default. */
  efforts: Partial<Record<ProviderId, string>>;
  /** The OpenAI-compatible server on this computer or network. */
  localUrl: string | null;
  /** Where the athlete says an installed program is (Claude Code, Gemini CLI, OpenCode), when C-LINK can't find it. */
  programs: Partial<Record<ProviderId, string>>;
}

const EMPTY: AIChoices = { picked: null, models: {}, efforts: {}, localUrl: null, programs: {} };

/** What a secret is kept under: a provider's key or token, or an MCP server's headers and env (`mcp:<id>`). */
export type SecretId = ProviderId | `mcp:${string}`;

export class AIVault {
  private readonly choicesFile: string;
  private readonly secretsFile: string;
  private choices: AIChoices;
  private secrets: Record<string, string> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(folder: string, private readonly sealer: Sealer) {
    this.choicesFile = path.join(folder, "ai.json");
    this.secretsFile = path.join(folder, "ai-secrets.bin");
    let saved: Partial<AIChoices> = {};
    try { if (existsSync(this.choicesFile)) saved = JSON.parse(readFileSync(this.choicesFile, "utf8")) as Partial<AIChoices>; } catch { /* starts empty */ }
    this.choices = {
      picked: provider(saved.picked)?.id ?? null,
      models: typeof saved.models === "object" && saved.models ? saved.models : {},
      efforts: typeof saved.efforts === "object" && saved.efforts ? saved.efforts : {},
      localUrl: typeof saved.localUrl === "string" ? saved.localUrl : null,
      programs: typeof saved.programs === "object" && saved.programs ? saved.programs : {},
    };
  }

  get current(): AIChoices { return this.choices; }

  choose(change: Partial<AIChoices>): AIChoices {
    this.choices = { ...EMPTY, ...this.choices, ...change, models: { ...this.choices.models, ...change.models }, efforts: { ...this.choices.efforts, ...change.efforts }, programs: { ...this.choices.programs, ...change.programs } };
    writeFileSync(this.choicesFile, JSON.stringify(this.choices, null, 2), { mode: 0o600 });
    return this.choices;
  }

  private async open(): Promise<Record<string, string>> {
    if (this.secrets) return this.secrets;
    try {
      const { text, stale } = await this.sealer.decrypt(await readFile(this.secretsFile));
      const parsed = JSON.parse(text) as unknown;
      this.secrets = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
      if (stale) await this.save();
    } catch {
      this.secrets = {};
    }
    return this.secrets;
  }

  private save(): Promise<void> {
    const next = this.writing.then(async () => writeFile(this.secretsFile, await this.sealer.encrypt(JSON.stringify(this.secrets ?? {})), { mode: 0o600 }));
    this.writing = next.catch(() => {});
    return next;
  }

  /** A provider's key or token, or null. */
  async secret(id: SecretId): Promise<string | null> {
    return (await this.open())[id] ?? null;
  }

  async setSecret(id: SecretId, value: string | null): Promise<void> {
    const all = await this.open();
    if (value === null) delete all[id];
    else all[id] = value;
    await this.save();
  }

  async hasSecret(id: SecretId): Promise<boolean> {
    return id in (await this.open());
  }
}
