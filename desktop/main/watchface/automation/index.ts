// Studio automation in the main process: the broker to the open editor (used by the MCP server and Watchmaker), the
// asset store, and the opt-in MCP server with its settings. The token is sealed with the keychain and never reaches
// the page: "Copy Codex configuration" puts it on the clipboard from here. Turning automation off revokes it.
// Routes: /api/desktop/studio/automation (status, on/off), …/copy, and the page's …/inbox and …/reply.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sealer } from "../../secrets";
import { AssetStore } from "./assets";
import { EditorBroker } from "./broker";
import { ENDPOINT, startMcpServer, type McpServerHandle } from "./server";
import { automationTools, type ToolHost } from "./tools";

export { AssetStore } from "./assets";
export { EditorBroker, EditorError } from "./broker";

// CorosLink's port for this server; 38472 is the strength-workouts server's.
const DEFAULT_PORT = 38_471;

interface Saved { enabled: boolean; port: number; token?: string }

export interface AutomationStatus {
  enabled: boolean;
  /** The server's address while it runs. */
  url: string | null;
  /** The token's last four characters, to tell configurations apart. */
  tokenHint: string | null;
  /** Whether a C-LINK window is connected to answer editor tools. */
  editor: boolean;
  problem?: string;
}

export interface AutomationDeps {
  sealer: Sealer;
  projects: ToolHost["projects"];
  /** Puts text on the clipboard (Electron's clipboard in the app). */
  copy(text: string): void;
}

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The Codex MCP configuration for the server (TOML, as Codex's config.toml takes it). */
export const codexConfig = (url: string, token: string) =>
  `[mcp_servers.clink_watch_studio]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }\ntool_timeout_sec = 180\n`;

export class StudioAutomation {
  readonly broker = new EditorBroker();
  readonly assets: AssetStore;
  private readonly file: string;
  private saved: Saved = { enabled: false, port: DEFAULT_PORT };
  private token: string | null = null;
  private server: McpServerHandle | null = null;
  private problem: string | undefined;
  private loaded: Promise<void> | null = null;

  constructor(private readonly folder: string, private readonly deps: AutomationDeps) {
    this.file = path.join(folder, "automation.json");
    this.assets = new AssetStore(path.join(folder, "automation-assets"));
  }

  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Saved>;
        this.saved = { enabled: raw.enabled === true, port: Number.isInteger(raw.port) && raw.port! > 1024 && raw.port! < 65536 ? raw.port! : DEFAULT_PORT, ...(typeof raw.token === "string" ? { token: raw.token } : {}) };
        if (this.saved.token) {
          const { text, stale } = await this.deps.sealer.decrypt(Buffer.from(this.saved.token, "base64"));
          this.token = text;
          if (stale) await this.store();
        }
      } catch { /* not set up yet, or the keychain changed: starts off */ }
      if (this.saved.enabled && !this.token) this.saved.enabled = false;
    })());
  }

  private async store(): Promise<void> {
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const token = this.token ? (await this.deps.sealer.encrypt(this.token)).toString("base64") : undefined;
    this.saved = { enabled: this.saved.enabled, port: this.saved.port, ...(token ? { token } : {}) };
    await writeFile(this.file, JSON.stringify(this.saved), { mode: 0o600 });
  }

  private tools() {
    return automationTools({ broker: this.broker, assets: this.assets, projects: this.deps.projects });
  }

  /** Starts the server if it was left on. */
  async start(): Promise<void> {
    await this.load();
    if (this.saved.enabled && !this.server) await this.listen();
  }

  private async listen(): Promise<void> {
    try {
      this.server = await startMcpServer(this.tools(), () => this.token ?? "", this.saved.port);
      this.problem = undefined;
      if (this.server.port !== this.saved.port) { this.saved.port = this.server.port; await this.store(); }
    } catch (error) {
      this.problem = error instanceof Error ? error.message : "The server didn't start.";
    }
  }

  async stop(): Promise<void> {
    await this.server?.close();
    this.server = null;
  }

  async setEnabled(on: boolean): Promise<void> {
    await this.load();
    if (on === this.saved.enabled && (!on || this.server)) return;
    await this.stop();
    this.saved.enabled = on;
    // A new token each time it's turned on; off revokes the old one.
    this.token = on ? randomBytes(32).toString("base64url") : null;
    await this.store();
    if (on) await this.listen();
  }

  get url(): string | null { return this.server ? `http://127.0.0.1:${this.server.port}${ENDPOINT}` : null; }

  async status(): Promise<AutomationStatus> {
    await this.load();
    return { enabled: this.saved.enabled, url: this.url, tokenHint: this.token ? this.token.slice(-4) : null, editor: this.broker.connected, ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** /api/desktop/studio/automation[/…]. Null when the path isn't one of these. */
  async answer(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    const route = pathname.slice("/api/desktop/studio/automation".length) || "/";
    if (!pathname.startsWith("/api/desktop/studio/automation")) return null;
    const get = request.method === "GET";
    if (!get && request.headers.get("x-clink-hub") !== "1") return reply({ error: "forbidden", message: "Not from this app." }, 403);
    if (get && route === "/inbox") return this.broker.open(request.signal);
    // A stored picture, for the chat and the panel (ids only; the store checks them).
    const asset = /^\/asset\/(img_[0-9a-f]{32})$/.exec(route);
    if (get && asset) {
      try {
        const a = await this.assets.get(asset[1]);
        return new Response(new Uint8Array(a.bytes), { headers: { "Content-Type": a.mime, "Cache-Control": "max-age=31536000, immutable" } });
      } catch { return reply({ error: "notFound" }, 404); }
    }
    if (!get && route === "/reply") {
      const body = await request.json().catch(() => null);
      return reply({ taken: this.broker.reply(body) });
    }
    if (get && route === "/") return reply(await this.status());
    if (!get && route === "/") {
      const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") return reply({ error: "invalid", message: "Say on or off." }, 400);
      await this.setEnabled(body.enabled);
      return reply(await this.status());
    }
    if (!get && route === "/copy") {
      if (!this.url || !this.token) return reply({ error: "off", message: "Turn automation on first." }, 400);
      this.deps.copy(codexConfig(this.url, this.token));
      return reply({ copied: true });
    }
    return reply({ error: "notFound" }, 404);
  }
}
