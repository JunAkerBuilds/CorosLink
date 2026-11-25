// The music services' settings (Spotify's Client ID: media/services.json) and sign-ins (tokens: media/services.bin,
// encrypted with the OS keychain). Nothing here reaches the page.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sealer } from "../secrets";

/** Keeps values as they are (tests). */
export const plain: Sealer = {
  encrypt: async (text) => Buffer.from(text, "utf8"),
  decrypt: async (data) => ({ text: data.toString("utf8"), stale: false }),
};

export class ServiceVault {
  private readonly settingsFile: string;
  private readonly secretsFile: string;
  private settings: Record<string, string> = {};
  private secrets: Record<string, string> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(data: string, private readonly sealer: Sealer) {
    const folder = path.join(data, "media");
    mkdirSync(folder, { recursive: true });
    this.settingsFile = path.join(folder, "services.json");
    this.secretsFile = path.join(folder, "services.bin");
    try { if (existsSync(this.settingsFile)) this.settings = JSON.parse(readFileSync(this.settingsFile, "utf8")) as Record<string, string>; } catch { /* starts empty */ }
  }

  setting(key: string): string | null { return this.settings[key] ?? null; }
  setSetting(key: string, value: string | null): void {
    if (value == null) delete this.settings[key]; else this.settings[key] = value;
    writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
  }

  private async open(): Promise<Record<string, string>> {
    if (this.secrets) return this.secrets;
    try {
      const { text, stale } = await this.sealer.decrypt(await readFile(this.secretsFile));
      this.secrets = JSON.parse(text) as Record<string, string>;
      if (stale) await this.save();
    } catch {
      this.secrets = {};
    }
    return this.secrets;
  }

  private save(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await writeFile(this.secretsFile, await this.sealer.encrypt(JSON.stringify(this.secrets ?? {})), { mode: 0o600 });
    });
    return this.writing;
  }

  async secret<T>(key: string): Promise<T | null> {
    const raw = (await this.open())[key];
    try { return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
  }

  async setSecret(key: string, value: unknown): Promise<void> {
    const all = await this.open();
    if (value == null) delete all[key]; else all[key] = JSON.stringify(value);
    await this.save();
  }
}
