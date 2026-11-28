// "Reach from anywhere": the one opt-in exception to C-LINK being local. With the switch on, this computer is signed
// in to the athlete's coroslink.com website account, linked to it through relay.coroslink.com, and runs Cloudflare's
// connector for the tunnel the relay made (`<16 hex>.coroslinkrelay.com`), whose ingress is http://localhost:<port>.
// Nothing here calls those servers while the switch is off, except finishing what the athlete asked for: signing in,
// signing out, and the unlink that turning it off is.
//
// Kept in `dir`: cloud.json (the switch, the link and the pinned relay keys; nothing secret), cloud-secrets.bin (the
// connector token, sealed) and website-account.bin (the website's app token, sealed).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { spawn as spawnProcess } from "node:child_process";
import { t } from "@/lib/i18n";
import type { Sealer } from "../../secrets";
import type { EnvironmentKey } from "../identity";
import { ASSETS, CLOUDFLARED_VERSION, Connector, downloadCloudflared, edgePortBlocked, findCloudflared, targetFor, type Found, type Source } from "./cloudflared";
import { RECOVERY_MIN_INTERVAL_MS, RelayClient, RelayError, relayOrigin, TUNNEL_HOSTNAME, type Platform, type RelayKey } from "./relay";
import { AccountError, WebsiteAccount, websiteOrigin } from "./websiteAccount";

export type CloudState = "off" | "linking" | "online" | "offline" | "error";

export interface CloudStatus {
  signedIn: boolean;
  handle: string | null;
  signingIn: boolean;
  enabled: boolean;
  linked: boolean;
  state: CloudState;
  message?: string;
  hostname: string | null;
  connector: {
    source: Source | null;
    version: string | null;
    needsDownload: boolean;
    downloading: boolean;
    progress: number | null;
    /** Bytes of the pinned download, or null when Cloudflare publishes none for this computer. */
    downloadBytes: number | null;
    connections: number;
    portBlocked: boolean;
  };
}

interface Link { relayOrigin: string; environmentId: string; keyThumbprint: string; userId: string; hostname: string; tunnelId: string; generation: number; port: number }
interface State { version: 1; enabled: boolean; link?: Link; jwks?: { keys: RelayKey[]; fetchedAt: number } }

/** An unknown relay `kid` fetches the relay's keys again at most this often. */
const JWKS_REFRESH_MS = 60_000;
const EDGE_PROBE_MS = 60_000;

export interface CloudLinkOptions {
  dir: string;
  sealer: Sealer;
  key: EnvironmentKey;
  environmentId: string;
  /** This computer's name, as the phone lists it. */
  label: string;
  platform: NodeJS.Platform;
  /** The loopback port the phone server listens on; the tunnel points there. */
  port: () => number;
  isPackaged: boolean;
  openExternal: (url: string) => Promise<void> | void;
  onChange?: () => void;
  /** Where the pinned cloudflared is downloaded; `<dir>/cloudflared` unless given (main passes `<userData>/cloudflared`). */
  cloudflaredDir?: string;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  /** Tests: stand-ins for spawning the connector, the connector's restart delay and the port 7844 check. */
  spawn?: typeof spawnProcess;
  restartDelayMs?: (attempt: number) => number;
  edgePortBlocked?: (relay: { host: string; port: number }) => Promise<boolean>;
}

export class CloudLink {
  private state: State = { version: 1, enabled: false };
  private readonly file: string;
  private readonly secretsFile: string;
  private readonly cloudflaredDir: string;
  private readonly account: WebsiteAccount;
  private readonly connector: Connector;
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly clients = new Map<string, RelayClient>();
  private found: Found | null = null;
  private checked = false;
  private busy = false;
  private error: string | undefined;
  /** A relay problem that doesn't stop the stored connector (a failed recovery). */
  private notice: string | undefined;
  private downloading: { progress: number; promise: Promise<void> } | null = null;
  private lastRecoveryAt = 0;
  private recovering: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private jwksFetch: Promise<RelayKey[]> | null = null;
  private portBlocked = false;
  private lastProbeAt = 0;

  constructor(private readonly options: CloudLinkOptions) {
    this.file = path.join(options.dir, "cloud.json");
    this.secretsFile = path.join(options.dir, "cloud-secrets.bin");
    this.cloudflaredDir = options.cloudflaredDir ?? path.join(options.dir, "cloudflared");
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
    this.account = new WebsiteAccount({
      dir: options.dir, sealer: options.sealer, origin: websiteOrigin(options.isPackaged, this.env),
      openExternal: options.openExternal, fetch: options.fetch, now: this.now, onChange: () => this.changed(),
    });
    this.connector = new Connector({
      dir: this.cloudflaredDir, env: this.env, spawn: options.spawn, restartDelayMs: options.restartDelayMs, now: this.now,
      onChange: () => {
        if (this.connector.snapshot().state === "online") this.portBlocked = false;
        this.changed();
      },
      onNeedsRecovery: () => void this.recover().catch(() => {}),
      onEdgeUnreachable: () => this.probeEdge(),
    });
    this.ready = this.load();
  }

  // ----- What the screens and the phone server read -----

  /** The tunnel host, once linked: the phone server accepts it as `Host`. */
  get hostname(): string | null { return this.state.link?.hostname ?? null; }
  /** The website user this computer is linked to: the only one a mint request may name. */
  get linkedUserId(): string | null { return this.state.link?.userId ?? null; }
  /** The relay the link was made with: a mint request's `iss`. */
  get relayIssuer(): string | null { return this.state.link?.relayOrigin ?? null; }

  status(): CloudStatus {
    const account = this.account.status();
    const link = this.state.link;
    const snapshot = this.connector.snapshot();
    const target = targetFor(this.options.platform, this.options.arch ?? process.arch);
    const message = this.error ?? account.error ?? (this.state.enabled && snapshot.state !== "online"
      ? this.notice ?? snapshot.message ?? (link && this.checked && !this.found ? t("Download Cloudflare's connector to go online.") : undefined)
      : undefined);
    return {
      signedIn: account.signedIn,
      handle: account.handle,
      signingIn: account.signingIn,
      enabled: this.state.enabled,
      linked: Boolean(link),
      state: this.cloudState(snapshot.state),
      ...(message ? { message } : {}),
      hostname: link?.hostname ?? null,
      connector: {
        source: this.found?.source ?? null,
        version: this.found?.version ?? null,
        needsDownload: this.checked && !this.found,
        downloading: Boolean(this.downloading),
        progress: this.downloading?.progress ?? null,
        downloadBytes: target ? ASSETS[target].size : null,
        connections: snapshot.connections,
        portBlocked: this.portBlocked && snapshot.state !== "online",
      },
    };
  }

  private cloudState(connector: string): CloudState {
    if (this.busy) return "linking";
    if (this.error) return "error";
    if (!this.state.enabled || !this.state.link) return "off";
    if (connector === "online") return "online";
    if ((connector === "starting" && !this.portBlocked) || this.downloading) return "linking";
    return "offline";
  }

  /** The pinned relay keys, for checking mint requests. Naming a `kid` not among them fetches them again (throttled). */
  async relayJwks(kid?: string | null): Promise<RelayKey[]> {
    await this.ready;
    const link = this.state.link;
    const pinned = this.state.jwks;
    if (!link || !pinned) return [];
    if (!kid || pinned.keys.some((key) => key.kid === kid) || this.now() - pinned.fetchedAt < JWKS_REFRESH_MS) return pinned.keys;
    return (this.jwksFetch ??= (async () => {
      // The attempt counts even when it fails, so unknown kids can't make this hammer the relay.
      this.state.jwks = { ...pinned, fetchedAt: this.now() };
      try {
        const keys = await this.client(link.relayOrigin).jwks();
        if (this.state.link === link) {
          this.state.jwks = { keys, fetchedAt: this.now() };
          await this.save();
        }
        return keys;
      } catch {
        return pinned.keys;
      }
    })().finally(() => { this.jwksFetch = null; }));
  }

  // ----- Lifecycle -----

  /** Whether the switch was left on: the phone server must listen before `start` points the tunnel at it. */
  async switchedOn(): Promise<boolean> {
    await this.ready;
    return this.state.enabled;
  }

  /** At launch: find the connector (on this computer only) and, when switched on and linked, reconnect. */
  start(): Promise<void> {
    return this.serial(async () => {
      await this.checkConnector().catch((error: unknown) => { this.error = messageOf(error); });
      if (this.state.enabled && this.state.link) await this.resume(true).catch((error: unknown) => { this.error = messageOf(error); });
      else if (this.state.enabled) await this.setFlag(false); // switched on but never linked: a crash mid-link
      this.changed();
    });
  }

  /** Before quit: stop the connector. The link stays. */
  async stop(): Promise<void> {
    this.clearRetry();
    await this.connector.stop();
  }

  /** The phone server moved to another port: point the tunnel at it. */
  checkPort(): Promise<void> {
    const link = this.state.link;
    if (!this.state.enabled || !link || link.port === this.options.port()) return Promise.resolve();
    return this.recover(true);
  }

  // ----- The website account -----

  async signIn(): Promise<void> {
    await this.ready;
    await this.account.signIn();
  }

  /** A `coroslink://auth/callback` deep link; false for any other URL. */
  handleDeepLink(url: string): boolean {
    return this.account.handleCallback(url);
  }

  /** Also unlinks and stops: this computer shouldn't stay reachable through an account it left. */
  signOut(): Promise<void> {
    return this.serial(async () => {
      await this.connector.stop();
      if (this.state.link) await this.client(this.state.link.relayOrigin).unlink().catch(() => {}); // the phone can unlink it too
      await this.forgetLink();
      await this.account.signOut();
      this.error = undefined;
      this.changed();
    });
  }

  // ----- The switch -----

  /** On: link (or reconnect) and run the connector. Off: stop the connector and unlink. */
  setEnabled(on: boolean): Promise<void> {
    return this.serial(async () => {
      this.error = undefined;
      this.notice = undefined;
      if (!on) return this.turnOff();
      if (!(["darwin", "win32", "linux"] as string[]).includes(this.options.platform)) throw this.fail(t("Reach from anywhere isn't available on this system."));
      if (!this.state.link && !this.account.signedIn) throw this.fail(t("Sign in to your coroslink.com account first."));
      this.busy = true;
      this.changed();
      try {
        await this.checkConnector().catch(() => {});
        await this.setFlag(true);
        if (this.state.link) await this.resume(true);
        else await this.link();
      } catch (error) {
        await this.setFlag(false);
        await this.connector.stop();
        throw this.fail(linkMessage(error));
      } finally {
        this.busy = false;
        this.changed();
      }
    });
  }

  private async turnOff(): Promise<void> {
    await this.setFlag(false);
    this.clearRetry();
    await this.connector.stop();
    const link = this.state.link;
    if (link) {
      this.busy = true;
      this.changed();
      try {
        await this.client(link.relayOrigin).unlink();
      } catch (error) {
        // Still linked there: turning it off again tries again.
        if (!(error instanceof RelayError && error.notLinked)) throw this.fail(t("Couldn't reach the relay to unlink this computer. Turn it off again to retry."));
      } finally {
        this.busy = false;
      }
      await this.forgetLink();
    }
    this.changed();
  }

  /** Downloads the pinned cloudflared; only ever called from the athlete's Download button. */
  download(): Promise<void> {
    if (this.downloading) return this.downloading.promise;
    const target = targetFor(this.options.platform, this.options.arch ?? process.arch);
    if (!target) return Promise.reject(new Error(t("Cloudflare doesn't publish a connector for this computer. Install cloudflared and put it on your PATH.")));
    let shown = 0;
    const job = { progress: 0, promise: Promise.resolve() };
    job.promise = downloadCloudflared({
      dir: this.cloudflaredDir, asset: ASSETS[target], platform: this.options.platform, fetch: this.options.fetch,
      onProgress: (fraction) => {
        job.progress = fraction;
        if (this.now() - shown > 250) { shown = this.now(); this.changed(); }
      },
    }).then(async (binary) => {
      this.found = { path: binary, source: "managed", version: CLOUDFLARED_VERSION };
      this.checked = true;
      if (this.state.enabled && this.state.link) await this.serial(() => this.runConnector());
    }).finally(() => {
      this.downloading = null;
      this.changed();
    });
    this.downloading = job;
    this.changed();
    return job.promise;
  }

  // ----- Linking -----

  private async link(): Promise<void> {
    const client = this.client(relayOrigin(this.options.isPackaged, this.env));
    const port = this.options.port();
    const linkWith = async () => client.link({ relayToken: await this.account.relayToken(), label: cleanLabel(this.options.label), platform: this.options.platform as Platform, port });
    let answer;
    try {
      answer = await linkWith();
    } catch (error) {
      // A cached token the relay no longer takes: fetch a new one once.
      if (!(error instanceof RelayError && error.code === "invalid_token")) throw error;
      this.account.forgetRelayToken();
      answer = await linkWith();
    }
    // Pin the relay's keys now, so mint requests can be checked from here on.
    const keys = await client.jwks();
    await this.saveToken(answer.connectorToken);
    this.state.link = {
      relayOrigin: client.origin, environmentId: this.options.environmentId, keyThumbprint: this.options.key.thumbprint,
      userId: answer.userId, hostname: answer.hostname, tunnelId: answer.tunnelId, generation: answer.generation, port,
    };
    this.state.jwks = { keys, fetchedAt: this.now() };
    await this.save();
    // Recovery right after linking registers this computer with the relay's cleanup.
    await this.resume(true);
  }

  /** Linked and switched on: recovery, then the connector (with the stored token even when recovery fails). */
  private async resume(force: boolean): Promise<void> {
    const link = this.state.link!;
    if (link.keyThumbprint !== this.options.key.thumbprint || link.environmentId !== this.options.environmentId) {
      await this.forgetLink();
      await this.setFlag(false);
      throw new Error(t("This computer's key changed. Turn on Reach from anywhere to link it again."));
    }
    await this.recover(force);
    if (this.state.enabled && this.state.link) await this.runConnector();
  }

  private async runConnector(): Promise<void> {
    if (!this.state.enabled || !this.state.link) return;
    const token = await this.loadToken();
    if (!token) throw new Error(t("This computer's tunnel key is missing. Turn Reach from anywhere off and on again."));
    if (this.found) await this.connector.run(this.found.path, token);
  }

  /**
   * `POST /v1/environments/recovery`, at most every 2 minutes unless forced. A new connector token (the tunnel was
   * rebuilt) restarts the connector with it. Whatever happens, the stored connector keeps running.
   */
  private recover(force = false): Promise<void> {
    if (this.recovering) return this.recovering;
    const link = this.state.link;
    if (!link || !this.state.enabled) return Promise.resolve();
    if (!force && this.now() - this.lastRecoveryAt < RECOVERY_MIN_INTERVAL_MS) return Promise.resolve();
    this.lastRecoveryAt = this.now();
    const port = this.options.port();
    this.recovering = (async () => {
      try {
        const answer = await this.client(link.relayOrigin).recovery({ tunnelId: link.tunnelId, port });
        this.notice = undefined;
        if (answer.connectorToken) await this.saveToken(answer.connectorToken);
        if (this.state.link === link) {
          this.state.link = { ...link, hostname: answer.hostname, tunnelId: answer.tunnelId, generation: answer.generation, port };
          await this.save();
        }
        if (answer.connectorToken && this.connector.running) await this.runConnector();
      } catch (error) {
        if (!(error instanceof RelayError)) throw error;
        if (error.notLinked) {
          await this.connector.stop();
          await this.forgetLink();
          await this.setFlag(false);
          this.error = t("This computer was unlinked from your account. Turn on Reach from anywhere to link it again.");
          return;
        }
        const later = error.code === "allocation_busy" || error.code === "upstream_rate_limited" || (error.status === 429 && link.port !== port);
        if (later) this.scheduleRetry((error.retryAfterSeconds ?? 30) * 1000);
        if (error.status !== 429) this.notice = error.message; // 429: recovered recently, the stored connector is right
      } finally {
        this.recovering = null;
        this.changed();
      }
    })();
    return this.recovering;
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.recover(true).catch(() => {});
    }, Math.min(Math.max(delayMs, 5_000), 10 * 60_000));
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** The connector can't reach Cloudflare: at most once a minute, check whether this network blocks port 7844. */
  private probeEdge(): void {
    const link = this.state.link;
    if (!link || this.now() - this.lastProbeAt < EDGE_PROBE_MS) return;
    this.lastProbeAt = this.now();
    const relay = new URL(link.relayOrigin);
    const target = { host: relay.hostname.replace(/^\[|\]$/g, ""), port: Number(relay.port) || (relay.protocol === "http:" ? 80 : 443) };
    void (this.options.edgePortBlocked ?? edgePortBlocked)(target).then((blocked) => {
      blocked = blocked && this.connector.snapshot().state !== "online";
      if (blocked !== this.portBlocked) { this.portBlocked = blocked; this.changed(); }
    }).catch(() => {});
  }

  // ----- Kept here -----

  private client(origin: string): RelayClient {
    let client = this.clients.get(origin);
    if (!client) {
      client = new RelayClient({ origin, key: this.options.key, environmentId: this.options.environmentId, fetch: this.options.fetch, now: this.now });
      this.clients.set(origin, client);
    }
    return client;
  }

  private async checkConnector(): Promise<void> {
    try {
      this.found = await findCloudflared({ dir: this.cloudflaredDir, env: this.env, platform: this.options.platform, arch: this.options.arch ?? process.arch });
    } finally {
      this.checked = true;
    }
  }

  private async load(): Promise<void> {
    await this.account.load();
    try {
      const read = JSON.parse(await fs.promises.readFile(this.file, "utf8")) as Partial<State>;
      const link = read.link;
      const valid = link && typeof link.relayOrigin === "string" && typeof link.userId === "string" && TUNNEL_HOSTNAME.test(link.hostname ?? "")
        && typeof link.tunnelId === "string" && typeof link.port === "number";
      this.state = {
        version: 1,
        enabled: read.enabled === true,
        ...(valid ? { link } : {}),
        ...(valid && Array.isArray(read.jwks?.keys) ? { jwks: read.jwks } : {}),
      };
    } catch { /* never switched on */ }
    this.changed();
  }

  private async save(): Promise<void> {
    await writeAtomic(this.file, JSON.stringify(this.state));
  }

  private async setFlag(enabled: boolean): Promise<void> {
    if (this.state.enabled === enabled) return;
    this.state.enabled = enabled;
    await this.save();
  }

  /** No tunnel host, no relay keys (so a mint is refused), no connector token. */
  private async forgetLink(): Promise<void> {
    delete this.state.link;
    delete this.state.jwks;
    this.state.enabled = false;
    this.notice = undefined;
    this.portBlocked = false;
    this.clearRetry();
    await this.save();
    await fs.promises.rm(this.secretsFile, { force: true });
  }

  private async saveToken(connectorToken: string): Promise<void> {
    await writeAtomic(this.secretsFile, await this.options.sealer.encrypt(JSON.stringify({ connectorToken })));
  }

  private async loadToken(): Promise<string | null> {
    try {
      const { text } = await this.options.sealer.decrypt(await fs.promises.readFile(this.secretsFile));
      const token = (JSON.parse(text) as { connectorToken?: unknown }).connectorToken;
      return typeof token === "string" && token ? token : null;
    } catch {
      return null;
    }
  }

  private fail(message: string): Error {
    this.error = message;
    this.changed();
    return new Error(message);
  }

  /** One switch, sign-out or launch at a time, each after the saved state is read. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(work);
    this.queue = next.catch(() => {});
    return next;
  }

  private changed(): void { this.options.onChange?.(); }
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(temp, data, { mode: 0o600 });
    await fs.promises.rename(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}

// eslint-disable-next-line no-control-regex
const cleanLabel = (label: string) => label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) || "C-LINK";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function linkMessage(error: unknown): string {
  if (error instanceof AccountError || !(error instanceof RelayError)) return messageOf(error);
  switch (error.code) {
    case "link_limit_reached": return t("Your account already has 10 linked computers. Unlink one from C-LINK on your phone, then try again.");
    case "environment_key_mismatch": return t("This computer is linked with another key. Unlink it from C-LINK on your phone, then try again.");
    case "invalid_token": case "client_not_allowed": return t("coroslink.com didn't let this computer link. Sign out, sign in again, then try again.");
    case "not_configured": return t("The relay isn't set up for linking yet.");
    default: return error.message;
  }
}
