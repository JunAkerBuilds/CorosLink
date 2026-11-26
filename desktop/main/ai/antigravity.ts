// Antigravity: Coach answered by Google's Antigravity agent with the athlete's Google account, over ACP. Its runtime
// is not installed with C-LINK: the pinned release (about 115 MB on a Mac) is downloaded from Google when the athlete
// first signs in, checked against its SHA-256, and kept in the app's data folder with a private sign-in of its own.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CoachModel } from "@/lib/coach/loop";
import { CoachModelError } from "@/server/coach/anthropic";
import { AcpAgent, acpAnswer, acpFailure, allowCoachTools, sessionModels } from "./acp";
import { agentModel, type AgentAsk } from "./agent";
import { BRIDGE_NAME } from "./bridge";
import type { AccountProvider } from "./service";
import { t } from "@/lib/i18n";

const VERSION = "1.4.3";
const BASE = "https://dl.google.com/agy-extensions/releases";
/** From the registry's agent.json for 1.4.3. */
const RELEASES: Record<string, { url: string; sha256: string; bytes: number }> = {
  "darwin-arm64": { url: `${BASE}/macos/agy-acp-server-1.4.3-darwin-arm64.zip`, sha256: "c57db0a9b8b712daa9c3c17cdb990a61842ea569f279e8bd79d7aa85a303b20b", bytes: 114_147_623 },
  "darwin-x64": { url: `${BASE}/macos/agy-acp-server-1.4.3-darwin-x86_64.zip`, sha256: "9392dbbdad7f0663dbfb5a0bf641297b0cf80d2ee9cd2d49a616bbbc7378731d", bytes: 119_801_100 },
  "linux-x64": { url: `${BASE}/linux/agy-acp-server-1.4.3-linux-x86_64.zip`, sha256: "0634ce5306ba92c932945455e7a83fda78e2d99c33fa8aa6ee0566206a382714", bytes: 336_846_435 },
  "linux-arm64": { url: `${BASE}/linux/agy-acp-server-1.4.3-linux-arm64.zip`, sha256: "05c153443b0b1175151c760eeddea538950bc9843e317d54786a1f03670182bc", bytes: 322_887_047 },
  "win32-x64": { url: `${BASE}/windows/agy-acp-server-1.4.3-windows-x86_64.zip`, sha256: "54c2e16378d9a4952e1da70e355f3c33c4f284308d6de48ab3e6e34a127bd325", bytes: 131_267_135 },
  "win32-arm64": { url: `${BASE}/windows/agy-acp-server-1.4.3-windows-arm64.zip`, sha256: "fcd46431ad33d3b510ce0b98fe7b43d095bd8b3f1c363ee2d57faa7ee981c7bb", bytes: 134_301_870 },
};
const PROTOCOL = 2;
const AUTH_LINK = "Open the following link to authenticate the ACP server: ";
const win = process.platform === "win32";
const FILES = win ? { server: "agy_acp_server.exe", harness: "localharness_external.exe" } : { server: "agy_acp_server.par", harness: "localharness_external" };

/** Ambient Google credentials and settings that must not reach the agent: it uses only its own sign-in. */
const AMBIENT = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_CLOUD_QUOTA_PROJECT", "GOOGLE_GENAI_USE_VERTEXAI", "GCLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT", "GEMINI_HOME", "ANTIGRAVITY_HARNESS_PATH", "AGY_ACP_FORCE_FILE_STORAGE", "BROWSER", "PYTHONUNBUFFERED", "ELECTRON_RUN_AS_NODE"];

/** The sign-in link the agent prints, when it asks for one. */
export const signInLink = (line: string): string | null => {
  const at = line.indexOf(AUTH_LINK);
  if (at < 0) return null;
  const url = line.slice(at + AUTH_LINK.length).trim().split(/\s/)[0];
  return /^https:\/\/accounts\.google\.com\//.test(url) ? url : null;
};

export interface AntigravityHost {
  /** Opens Google's sign-in page in the athlete's browser. */
  openExternal(url: string): void;
  /** Says how the download is going, for the page. */
  progress?(text: string | null): void;
}

export class AntigravityAccount implements AccountProvider {
  readonly canSignOut = true;
  private installing: Promise<void> | null = null;
  private listed: { at: number; models: string[] } | null = null;
  private note: string | null = null;

  constructor(private readonly folder: string, private readonly host: AntigravityHost) {}

  private get dirs() {
    const root = path.join(this.folder, "antigravity");
    const home = path.join(root, "home");
    // GEMINI_HOME is `home`; the agent keeps its sign-in and sessions in `acp` inside it.
    return { root, runtime: path.join(root, "runtime", VERSION), home, acp: path.join(home, "antigravity-acp"), workspace: path.join(root, "workspace"), temp: path.join(root, "tmp") };
  }

  private installed(): boolean {
    return existsSync(path.join(this.dirs.runtime, FILES.server));
  }

  private signedIn(): boolean {
    return existsSync(path.join(this.dirs.acp, "acp_token.json"));
  }

  async status() {
    if (this.note) return { ready: false, problem: this.note };
    if (!RELEASES[`${process.platform}-${process.arch}`]) return { ready: false, problem: t("Antigravity isn't made for this computer.") };
    if (!this.installed()) return { ready: false, problem: t("Signing in downloads Antigravity from Google ({mb} MB).", { mb: Math.round(RELEASES[`${process.platform}-${process.arch}`].bytes / 1e6) }) };
    return this.signedIn() ? { ready: true, account: t("Google account") } : { ready: false, problem: t("Not signed in.") };
  }

  /** Downloads and unpacks the pinned runtime, once. */
  private install(): Promise<void> {
    this.installing ??= (async () => {
      const release = RELEASES[`${process.platform}-${process.arch}`];
      if (!release) throw new CoachModelError("unreachable", t("Antigravity isn't made for this computer."));
      const { runtime, root } = this.dirs;
      const zip = path.join(root, `download-${randomUUID()}.zip`), unpacked = `${runtime}.${randomUUID()}`;
      await mkdir(root, { recursive: true, mode: 0o700 });
      try {
        const response = await fetch(release.url, { signal: AbortSignal.timeout(30 * 60_000) });
        if (!response.ok || !response.body) throw new CoachModelError("unreachable", t("Antigravity couldn't be downloaded."));
        const hash = createHash("sha256");
        let got = 0, shown = 0;
        const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
        body.on("data", (chunk: Buffer) => {
          hash.update(chunk);
          got += chunk.length;
          const pct = Math.floor((got / release.bytes) * 100);
          if (pct >= shown + 5) { shown = pct; this.note = t("Downloading Antigravity… {pct}%", { pct }); this.host.progress?.(this.note); }
        });
        await pipeline(body, createWriteStream(zip, { mode: 0o600 }));
        if (got !== release.bytes || hash.digest("hex") !== release.sha256) throw new CoachModelError("unreachable", t("The Antigravity download didn't match Google's release. Nothing was installed."));
        this.note = t("Unpacking Antigravity…");
        await mkdir(unpacked, { recursive: true, mode: 0o700 });
        await unzip(zip, unpacked);
        if (!existsSync(path.join(unpacked, FILES.server))) throw new CoachModelError("unreachable", t("The Antigravity download is missing its program."));
        await rm(runtime, { recursive: true, force: true });
        await rename(unpacked, runtime);
      } finally {
        this.note = null;
        this.host.progress?.(null);
        await rm(zip, { force: true });
        await rm(unpacked, { recursive: true, force: true });
      }
    })().finally(() => { this.installing = null; });
    return this.installing;
  }

  /** Starts the agent with its private home; a sign-in link it prints goes to `onLink`. */
  private async start(onLink: ((url: string) => void) | null, log: string[]): Promise<{ agent: AcpAgent; stop: () => Promise<void> }> {
    const { runtime, home, workspace, temp } = this.dirs;
    const tmp = path.join(temp, randomUUID());
    await Promise.all([home, workspace, tmp].map((d) => mkdir(d, { recursive: true, mode: 0o700 })));
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!AMBIENT.includes(k.toUpperCase())) env[k] = v;
    Object.assign(env, {
      GEMINI_HOME: home, ANTIGRAVITY_HARNESS_PATH: path.join(runtime, FILES.harness), AGY_ACP_FORCE_FILE_STORAGE: "1", PYTHONUNBUFFERED: "1",
      // The agent never opens a browser itself: C-LINK opens Google's page, and only when asked to sign in.
      ...(win ? { ELECTRON_RUN_AS_NODE: "1", BROWSER: `'${process.execPath.replaceAll("\\", "/")}' -e 0 %s`, TEMP: tmp, TMP: tmp } : { BROWSER: "true", TMPDIR: tmp }),
    });
    const agent: AcpAgent = AcpAgent.start(path.join(runtime, FILES.server), process.platform === "linux" ? ["--uid="] : [], {
      cwd: workspace, env, onPermission: allowCoachTools,
      onStderr: (line) => {
        if (!line.includes("loadCodeAssist response")) { log.push(line.slice(0, 400)); if (log.length > 30) log.shift(); }
        const url = signInLink(line);
        if (!url) return;
        // Outside sign-in, a lapsed sign-in must never wait on a browser.
        if (onLink) onLink(url); else agent.close();
      },
    });
    return { agent, stop: async () => { agent.close(); await agent.done; await rm(tmp, { recursive: true, force: true }); } };
  }

  /** Coach's session: no built-in tools at all, Coach's tools declared up front, Coach's rules added. */
  private sessionExtra(system: string) {
    return { _meta: { antigravity: { enabledTools: [], eagerMcpServers: [BRIDGE_NAME], ...(system ? { systemPrompt: { append: system } } : {}) } } };
  }

  async signIn(): Promise<void> {
    if (!this.installed()) await this.install();
    const log: string[] = [];
    const { agent, stop } = await this.start((url) => this.host.openExternal(url), log);
    const timer = setTimeout(() => agent.close(), 6 * 60_000);
    try {
      await agent.initialize(PROTOCOL);
      await agent.request("authenticate", { methodId: "oauth-personal" });
      // Signing in isn't enough: Google checks the account's plan when a session starts.
      const session = (await agent.request("session/new", { cwd: this.dirs.workspace, mcpServers: [], ...this.sessionExtra("") })) as { sessionId?: string };
      await this.forget(session.sessionId);
    } catch (error) {
      throw acpFailure("Antigravity", error, log.join("\n"));
    } finally {
      clearTimeout(timer);
      await stop();
    }
  }

  async signOut(): Promise<void> {
    await rm(this.dirs.home, { recursive: true, force: true });
    this.listed = null;
  }

  /** Coach keeps its own conversations: the agent's copy of a session is deleted. */
  private async forget(sessionId: unknown): Promise<void> {
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) return;
    const { acp } = this.dirs;
    for (const entry of await readdir(path.join(acp, "conversations")).catch(() => [] as string[])) {
      if (entry === sessionId || entry.startsWith(`${sessionId}.`)) await rm(path.join(acp, "conversations", entry), { recursive: true, force: true });
    }
    await rm(path.join(acp, "brain", sessionId), { recursive: true, force: true });
  }

  async models(): Promise<string[]> {
    if (this.listed && Date.now() - this.listed.at < 10 * 60_000) return this.listed.models;
    if (!this.installed() || !this.signedIn()) return [""];
    const { agent, stop } = await this.start(null, []);
    const timer = setTimeout(() => agent.close(), 60_000);
    try {
      await agent.initialize(PROTOCOL);
      const session = (await agent.request("session/new", { cwd: this.dirs.workspace, mcpServers: [], ...this.sessionExtra("") })) as { sessionId?: string };
      await this.forget(session.sessionId);
      const models = ["", ...sessionModels(session).models.map((m) => m.value)];
      this.listed = { at: Date.now(), models };
      return models;
    } catch (error) {
      throw acpFailure("Antigravity", error);
    } finally {
      clearTimeout(timer);
      await stop();
    }
  }

  private async answer(model: string, ask: AgentAsk) {
    if (!this.installed()) throw new CoachModelError("bad_key", t("Sign in to Antigravity on the AI page."));
    const log: string[] = [];
    const { agent, stop } = await this.start(null, log);
    let sessionId: unknown = null;
    try {
      return await acpAnswer(agent, ask, {
        name: "Antigravity", cwd: this.dirs.workspace, model, protocolVersion: PROTOCOL, extra: this.sessionExtra(ask.system),
        started: async (_s, id) => { sessionId = id; }, log: () => log.join("\n"),
      });
    } finally {
      await stop();
      await this.forget(sessionId);
    }
  }

  model(model: string): CoachModel {
    return agentModel((ask) => this.answer(model, ask));
  }
}

/** Unpacks a zip with the system's own tool: ditto on a Mac, unzip on Linux, PowerShell on Windows. */
async function unzip(zip: string, into: string): Promise<void> {
  const [file, args] = process.platform === "darwin" ? ["/usr/bin/ditto", ["-x", "-k", zip, into]]
    : win ? ["powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${into.replaceAll("'", "''")}' -Force`]]
    : ["unzip", ["-q", "-o", zip, "-d", into]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args as string[], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new CoachModelError("unreachable", t("Antigravity couldn't be unpacked.")))));
  });
  // Some archives keep the program one folder down.
  const inner = await readdir(into);
  if (inner.length === 1 && (await stat(path.join(into, inner[0]))).isDirectory() && !existsSync(path.join(into, FILES.server))) {
    for (const entry of await readdir(path.join(into, inner[0]))) await rename(path.join(into, inner[0], entry), path.join(into, entry));
  }
}
