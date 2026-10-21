import type { CoachEventFrame } from "../../coachHub/coachContract";
import type { CloudLinkState, CloudLinkStatus } from "../contract";
import type { RemoteIdentity, RemoteSecretBox, RemoteSettingsStore } from "../identity";
import type { RelayTrust } from "../server";
import {
  CLOUDFLARED_ASSETS,
  CLOUDFLARED_VERSION,
  CloudflaredSupervisor,
  cloudflaredTarget,
  downloadCloudflared as downloadPinnedCloudflared,
  findCloudflared as findInstalledCloudflared,
  isIntelMac,
  pruneManagedCloudflared,
  type CloudflaredSupervisorOptions,
  type ConnectorSnapshot,
  type ResolvedCloudflared
} from "./cloudflaredManager";
import { LiveActivityFeed, type LiveTurnReport } from "./liveActivityFeed";
import { RelayClient, RelayRequestError } from "./relayClient";
import {
  ENVIRONMENT_PLATFORMS,
  RECOVERY_MIN_INTERVAL_SECONDS,
  SESSION_ID_PATTERN,
  TUNNEL_HOSTNAME_PATTERN,
  type ActivityEvent,
  type EnvironmentPlatform,
  type RelayPublicJwk
} from "./relayProtocol";
import { WebsiteAccountError, type WebsiteAccount } from "./websiteAccount";

/**
 * Away from home: links this computer to the person's watchfaces.coroslink.com
 * account through the relay, keeps Cloudflare's connector running for the
 * tunnel the relay made, and gives the environment server what it needs to
 * answer the relay's mint requests (the pinned relay keys and the linked user)
 * and to accept the tunnel's Host. Linking is off until the person turns it on.
 */

/** Read by RemoteServer's Host allowlist (remoteAccess.ts). */
export const TUNNEL_HOSTNAME_KEY = "remote.tunnelHostname";
/** Read by RemoteServer's mint handler (remoteAccess.ts). */
export const RELAY_TRUST_KEY = "remote.relayTrust";
const ENABLED_KEY = "remote.cloud.enabled";
const LINK_KEY = "remote.cloud.link";
const CONNECTOR_TOKEN_KEY = "remote.cloud.connectorToken";
/** The person agreed to download Cloudflare's connector (and its pinned updates). */
const CONSENT_KEY = "remote.cloud.cloudflaredConsent";

const RECOVERY_INTERVAL_MS = RECOVERY_MIN_INTERVAL_SECONDS * 1000;
/** An unknown relay `kid` refetches the relay's keys at most this often. */
const RELAY_KEYS_REFRESH_MS = 60 * 60_000;

interface StoredLink {
  version: 1;
  relayOrigin: string;
  environmentId: string;
  keyThumbprint: string;
  userId: string;
  hostname: string;
  tunnelId: string;
  generation: number;
  linkedAt: string;
}

interface StoredTrust extends RelayTrust {
  fetchedAt: number;
}

// ----- Activity pushes -----

const APPROVAL_ENTRY_KINDS = new Set(["corosAction", "workoutDelete", "workoutEdit", "planDraft"]);

/** Which push a Coach event is worth, if any. Only the event name and session id ever leave. */
export function activityForCoachEvent(frame: CoachEventFrame): ActivityEvent | null {
  if (frame.event === "turn.completed") return "replied";
  if (frame.event === "entry.appended" && APPROVAL_ENTRY_KINDS.has(frame.data.entry.kind)) return "approval";
  return null;
}

/**
 * At most one push per conversation every 30 s (an approval may follow a
 * reply), and 30 an hour overall.
 */
export class ActivityThrottle {
  private readonly last = new Map<string, { at: number; event: ActivityEvent }>();
  private sent: number[] = [];

  constructor(private readonly perSessionMs = 30_000, private readonly perHour = 30) {}

  allow(sessionId: string, event: ActivityEvent, now: number): boolean {
    const previous = this.last.get(sessionId);
    if (previous && now - previous.at < this.perSessionMs && !(event === "approval" && previous.event === "replied")) {
      return false;
    }
    this.sent = this.sent.filter((at) => now - at < 3_600_000);
    if (this.sent.length >= this.perHour) return false;
    this.sent.push(now);
    this.last.set(sessionId, { at: now, event });
    if (this.last.size > 500) {
      for (const [key, value] of this.last) if (now - value.at >= this.perSessionMs) this.last.delete(key);
    }
    return true;
  }
}

// ----- The link -----

export interface CloudLinkOptions {
  settings: RemoteSettingsStore;
  secrets: RemoteSecretBox;
  account: WebsiteAccount;
  /** The relay new links go through (links keep the relay they were made with). */
  relayUrl: string;
  /** Starts the environment server if it isn't running: the key and the loopback port the tunnel reaches. */
  environment: () => Promise<{ identity: RemoteIdentity; port: number }>;
  /** This computer's name, as the phone lists it. */
  label: () => string;
  platform: NodeJS.Platform;
  arch: string;
  userDataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  findCloudflared?: typeof findInstalledCloudflared;
  downloadCloudflared?: typeof downloadPinnedCloudflared;
  supervisor?: Partial<CloudflaredSupervisorOptions>;
  /** Tests: the Live Activity feed's clock, timers and intervals. */
  liveActivity?: Partial<Omit<ConstructorParameters<typeof LiveActivityFeed>[0], "send">>;
  onChange?: () => void;
}

export class CloudLink {
  private readonly supervisor: CloudflaredSupervisor;
  private readonly throttle = new ActivityThrottle();
  private readonly live: LiveActivityFeed;
  private readonly now: () => number;
  private busy: "linking" | "unlinking" | null = null;
  /** Switched on and still finding the connector, so the panel says "linking" from the start. */
  private switchingOn = false;
  /** Bumped by every setEnabled, so a slow switch-on (a download) yields to a later switch. */
  private switchGeneration = 0;
  private error: string | undefined;
  /** A non-fatal relay problem (recovery failed, but the stored connector runs). */
  private relayNotice: string | undefined;
  private connector: ResolvedCloudflared | null = null;
  private connectorChecked = false;
  private download: { progress: number | null; promise: Promise<string> } | null = null;
  private lastRecoveryAt = 0;
  private recovering: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private trustRefresh: Promise<RelayTrust | null> | null = null;
  private readonly clients = new Map<string, RelayClient>();

  /** The website account this computer signs in with (also used to open the member's private faces). */
  get account(): WebsiteAccount {
    return this.options.account;
  }

  constructor(private readonly options: CloudLinkOptions) {
    this.now = options.now ?? Date.now;
    this.live = new LiveActivityFeed({ send: (report) => this.sendLive(report), now: this.now, ...options.liveActivity });
    this.supervisor = new CloudflaredSupervisor({
      ...options.supervisor,
      onChange: () => this.changed(),
      onNeedsRecovery: (reason) => void this.recover(reason).catch(() => undefined),
      onSwapped: (spec) => {
        if (spec.version === CLOUDFLARED_VERSION && this.connector?.source === "managed") {
          void pruneManagedCloudflared(this.options.userDataDir, CLOUDFLARED_VERSION);
        }
      }
    });
  }

  // ----- Settings -----

  private get settings(): RemoteSettingsStore {
    return this.options.settings;
  }

  get enabled(): boolean {
    return this.settings.get(ENABLED_KEY) === "1";
  }

  private setEnabledFlag(enabled: boolean): void {
    this.settings.set(ENABLED_KEY, enabled ? "1" : "0");
  }

  private storedLink(): StoredLink | null {
    const saved = this.settings.get(LINK_KEY);
    if (!saved) return null;
    try {
      const link = JSON.parse(saved) as StoredLink;
      return link?.version === 1 && TUNNEL_HOSTNAME_PATTERN.test(link.hostname) && typeof link.tunnelId === "string" ? link : null;
    } catch {
      return null;
    }
  }

  get linked(): boolean {
    return this.storedLink() !== null;
  }

  private saveLink(link: StoredLink): void {
    this.settings.set(LINK_KEY, JSON.stringify(link));
    // The server's Host allowlist and mint handler read these.
    this.settings.set(TUNNEL_HOSTNAME_KEY, link.hostname);
  }

  private connectorToken(): string | null {
    const encoded = this.settings.get(CONNECTOR_TOKEN_KEY);
    if (!encoded) return null;
    try {
      this.options.secrets.ensureAvailable();
      return this.options.secrets.decrypt(Buffer.from(encoded, "base64")) || null;
    } catch {
      return null;
    }
  }

  private saveConnectorToken(token: string): void {
    this.options.secrets.ensureAvailable();
    this.settings.set(CONNECTOR_TOKEN_KEY, this.options.secrets.encrypt(token).toString("base64"));
  }

  private storedTrust(): StoredTrust | null {
    const saved = this.settings.get(RELAY_TRUST_KEY);
    if (!saved) return null;
    try {
      const trust = JSON.parse(saved) as StoredTrust;
      return trust && Array.isArray(trust.keys) && typeof trust.userId === "string" ? trust : null;
    } catch {
      return null;
    }
  }

  private saveTrust(trust: StoredTrust): void {
    this.settings.set(RELAY_TRUST_KEY, JSON.stringify(trust));
  }

  /** Forgets the link here: no tunnel host, no relay keys (so mint answers 404), no connector. */
  private forgetLink(): void {
    for (const key of [LINK_KEY, CONNECTOR_TOKEN_KEY, TUNNEL_HOSTNAME_KEY, RELAY_TRUST_KEY]) this.settings.set(key, "");
    this.setEnabledFlag(false);
    this.relayNotice = undefined;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** One client per relay and key, so a clock correction learned from the relay sticks. */
  private client(identity: RemoteIdentity, origin = this.storedLink()?.relayOrigin ?? this.options.relayUrl): RelayClient {
    const key = `${origin} ${identity.kid}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new RelayClient({ baseUrl: origin, identity, fetch: this.options.fetch, now: this.now });
      this.clients.set(key, client);
    }
    return client;
  }

  private get platform(): EnvironmentPlatform | null {
    return ENVIRONMENT_PLATFORMS.includes(this.options.platform as EnvironmentPlatform)
      ? (this.options.platform as EnvironmentPlatform)
      : null;
  }

  // ----- Status -----

  status(): CloudLinkStatus {
    const link = this.storedLink();
    const account = this.options.account.status();
    const connector = this.supervisor.snapshot();
    const target = cloudflaredTarget(this.options.platform, this.options.arch);
    return {
      available: Boolean(this.platform && (target || this.connector)),
      account: {
        signedIn: account.signedIn,
        handle: account.viewer?.handle || null,
        displayName: account.viewer?.displayName ?? null,
        signingIn: account.signingIn,
        ...(account.error ? { error: account.error } : {})
      },
      enabled: this.enabled,
      linked: Boolean(link),
      state: this.state(link, connector),
      ...(this.message(connector) ? { message: this.message(connector) } : {}),
      hostname: link?.hostname ?? null,
      connector: {
        source: this.connector?.source ?? null,
        version: connector.version ?? this.connector?.version ?? null,
        needsDownload: this.connectorChecked && !this.connector,
        downloading: Boolean(this.download),
        progress: this.download?.progress ?? null,
        downloadVersion: CLOUDFLARED_VERSION,
        downloadBytes: target ? CLOUDFLARED_ASSETS[target].size : null,
        connections: connector.connections
      },
      intelMac: isIntelMac(this.options.platform, this.options.arch)
    };
  }

  private state(link: StoredLink | null, connector: ConnectorSnapshot): CloudLinkState {
    if (this.busy || this.switchingOn) return "linking";
    if (this.error) return "error";
    if (!this.enabled || !link) return "off";
    if (connector.state === "online") return "online";
    if (connector.state === "starting" || this.download) return "linking";
    return "offline";
  }

  private message(connector: ConnectorSnapshot): string | undefined {
    if (this.error) return this.error;
    if (!this.enabled) return undefined;
    if (connector.state !== "online") return this.relayNotice ?? connector.message;
    return undefined;
  }

  private changed(): void {
    this.options.onChange?.();
  }

  // ----- Lifecycle -----

  /** At launch: learn which connector is installed; reconnect if linked and switched on. */
  initialize(): void {
    void this.checkConnector()
      .catch(() => undefined)
      .then(() => {
        if (this.enabled && this.linked) return this.start();
      })
      .catch((error) => {
        this.error = error instanceof Error ? error.message : String(error);
        this.changed();
      });
  }

  /** Before quit: stop the connector. The link stays. */
  async stop(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.supervisor.stop();
  }

  private async checkConnector(): Promise<ResolvedCloudflared | null> {
    const find = this.options.findCloudflared ?? findInstalledCloudflared;
    try {
      this.connector = await find({
        env: this.options.env ?? process.env,
        userDataDir: this.options.userDataDir,
        platform: this.options.platform,
        arch: this.options.arch
      });
    } finally {
      this.connectorChecked = true;
      this.changed();
    }
    return this.connector;
  }

  /**
   * The connector to run. A missing one is downloaded only with consent; a
   * downloaded one older than the pin keeps running while the pinned build
   * downloads, then they swap.
   */
  private async ensureConnector(allowDownload: boolean): Promise<ResolvedCloudflared | null> {
    const found = await this.checkConnector();
    const consented = allowDownload || this.settings.get(CONSENT_KEY) === "1";
    const target = cloudflaredTarget(this.options.platform, this.options.arch);
    if (found && !found.stale) return found;
    if (!target) {
      if (found) return found;
      throw new Error("Cloudflare doesn't publish a connector for this computer. Install cloudflared yourself and put it on your PATH.");
    }
    if (!consented) return found;
    if (found?.stale) {
      void this.downloadConnector().catch(() => undefined);
      return found;
    }
    await this.downloadConnector();
    return this.connector;
  }

  private downloadConnector(): Promise<string> {
    if (this.download) return this.download.promise;
    const target = cloudflaredTarget(this.options.platform, this.options.arch);
    if (!target) return Promise.reject(new Error("Cloudflare doesn't publish a connector for this computer."));
    const download = this.options.downloadCloudflared ?? downloadPinnedCloudflared;
    const state: { progress: number | null; promise: Promise<string> } = { progress: 0, promise: Promise.resolve("") };
    let lastShown = 0;
    state.promise = download({
      asset: CLOUDFLARED_ASSETS[target],
      version: CLOUDFLARED_VERSION,
      userDataDir: this.options.userDataDir,
      platform: this.options.platform,
      fetch: this.options.fetch,
      onProgress: (received, total) => {
        state.progress = total > 0 ? Math.min(1, received / total) : null;
        if (this.now() - lastShown > 250) {
          lastShown = this.now();
          this.changed();
        }
      }
    })
      .then(async (binary) => {
        this.settings.set(CONSENT_KEY, "1");
        this.connector = { path: binary, source: "managed", version: CLOUDFLARED_VERSION };
        // A version bump while running: start the new one; the old stops once it registers.
        const token = this.connectorToken();
        if (this.supervisor.running && token) this.supervisor.run({ binary, token, version: CLOUDFLARED_VERSION });
        return binary;
      })
      .finally(() => {
        this.download = null;
        this.changed();
      });
    this.download = state;
    this.changed();
    return state.promise;
  }

  // ----- The switch -----

  /**
   * Away from home, driven by the remote access switch (remoteAccess.ts) and
   * the panel's Connect. On: link (or reconnect) and run the connector; a
   * missing connector is downloaded only when `allowDownload` (the person
   * agreed in the panel) or they agreed before. Off: stop the connector and
   * keep the link, so the address stays the same.
   */
  async setEnabled(enabled: boolean, input: { allowDownload?: boolean } = {}): Promise<void> {
    const generation = ++this.switchGeneration;
    this.error = undefined;
    if (!enabled) {
      this.switchingOn = false;
      this.setEnabledFlag(false);
      this.relayNotice = undefined;
      await this.stop();
      this.changed();
      return;
    }
    this.switchingOn = true;
    this.changed();
    try {
      if (!this.platform) throw new Error("Access away from home isn't available on this system.");
      this.options.secrets.ensureAvailable();
      if (!this.linked && !this.options.account.signedIn) throw new Error("Sign in to watchfaces.coroslink.com first.");
      const connector = await this.ensureConnector(input.allowDownload === true);
      // No connector and no consent yet: the panel asks, then calls again with allowDownload.
      // Switched again while this waited (a download): the later call decides.
      if (!connector || generation !== this.switchGeneration) return;
      this.setEnabledFlag(true);
      if (this.linked) await this.start();
      else await this.link();
    } catch (error) {
      if (generation === this.switchGeneration) {
        this.setEnabledFlag(false);
        this.error = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      if (generation === this.switchGeneration) this.switchingOn = false;
      this.changed();
    }
  }

  private async link(): Promise<void> {
    this.busy = "linking";
    this.changed();
    try {
      const { identity, port } = await this.options.environment();
      const client = this.client(identity, this.options.relayUrl);
      const linkWith = async (relayToken: string) =>
        client.link({ relayToken, label: this.options.label(), platform: this.platform!, port });
      let answer;
      try {
        answer = await linkWith(await this.options.account.relayToken());
      } catch (error) {
        // A cached token the relay no longer takes: fetch a new one once.
        if (!(error instanceof RelayRequestError && error.code === "invalid_token")) throw error;
        this.options.account.forgetRelayToken();
        answer = await linkWith(await this.options.account.relayToken());
      }
      // Pin the relay's keys now, so mint requests can be checked from here on.
      const keys = await client.jwks();
      this.saveConnectorToken(answer.connectorToken);
      this.saveTrust({ issuer: client.origin, userId: answer.userId, keys, fetchedAt: this.now() });
      this.saveLink({
        version: 1,
        relayOrigin: client.origin,
        environmentId: identity.environmentId,
        keyThumbprint: identity.kid,
        userId: answer.userId,
        hostname: answer.hostname,
        tunnelId: answer.tunnelId,
        generation: answer.generation,
        linkedAt: new Date(this.now()).toISOString()
      });
      this.busy = null;
      // Recovery right after linking registers this host with the relay's cleanup.
      await this.start({ forceRecovery: true });
    } catch (error) {
      throw new Error(linkErrorMessage(error));
    } finally {
      this.busy = null;
    }
  }

  /** Linked and switched on: register recovery (throttled), then run the connector. */
  private async start(input: { forceRecovery?: boolean } = {}): Promise<void> {
    const link = this.storedLink();
    if (!link || !this.enabled) return;
    const { identity } = await this.options.environment();
    if (identity.kid !== link.keyThumbprint || identity.environmentId !== link.environmentId) {
      this.forgetLink();
      throw new Error("This computer's remote access key changed. Choose Connect to link it again.");
    }
    const connector = this.connector && !this.connector.stale ? this.connector : await this.ensureConnector(false);
    await this.recover(input.forceRecovery ? "link" : "startup", { force: input.forceRecovery });
    if (!this.linked || !this.enabled) return;
    const token = this.connectorToken();
    if (!connector) throw new Error("Download Cloudflare's connector to go online.");
    if (!token) throw new Error("This computer's tunnel key is missing. Sign out, then sign in again to link it again.");
    this.supervisor.run({ binary: connector.path, token, version: connector.version });
  }

  /**
   * POST /v1/environments/recovery, at most once per 2 minutes. A new
   * connector token (the tunnel was rebuilt) restarts the connector with it.
   * Whatever happens, the stored connector keeps running.
   */
  recover(reason: "startup" | "link" | "exit" | "rejected" | "retry", input: { force?: boolean } = {}): Promise<void> {
    if (this.recovering) return this.recovering;
    const link = this.storedLink();
    if (!link || !this.enabled) return Promise.resolve();
    if (!input.force && this.now() - this.lastRecoveryAt < RECOVERY_INTERVAL_MS) return Promise.resolve();
    this.lastRecoveryAt = this.now();
    this.recovering = this.runRecovery(link, reason).finally(() => {
      this.recovering = null;
      this.changed();
    });
    return this.recovering;
  }

  private async runRecovery(link: StoredLink, _reason: string): Promise<void> {
    const { identity, port } = await this.options.environment();
    try {
      const answer = await this.client(identity, link.relayOrigin).recovery({ tunnelId: link.tunnelId, port });
      this.relayNotice = undefined;
      if (answer.connectorToken) this.saveConnectorToken(answer.connectorToken);
      this.saveLink({ ...link, hostname: answer.hostname, tunnelId: answer.tunnelId, generation: answer.generation });
      const token = this.connectorToken();
      const binary = this.connector?.path;
      if (answer.connectorToken && this.supervisor.running && binary && token) {
        this.supervisor.run({ binary, token, version: this.connector?.version ?? null });
      }
    } catch (error) {
      if (!(error instanceof RelayRequestError)) throw error;
      if (error.notLinked) {
        await this.supervisor.stop();
        this.forgetLink();
        this.error = "This computer was unlinked from your account. Choose Connect to link it again.";
        return;
      }
      if (error.status === 429) return; // Recovered recently; the stored connector is right.
      if (error.code === "allocation_busy" || error.code === "upstream_rate_limited") {
        this.scheduleRetry((error.retryAfterSeconds ?? 30) * 1000);
      }
      this.relayNotice = error.message;
    }
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.recover("retry", { force: true }).catch(() => undefined);
    }, Math.min(Math.max(delayMs, 5_000), 10 * 60_000));
    this.retryTimer.unref?.();
  }

  /** Removes this computer from the account: the relay deletes its tunnel and address. */
  async unlink(): Promise<void> {
    const link = this.storedLink();
    this.error = undefined;
    this.busy = "unlinking";
    this.changed();
    try {
      await this.supervisor.stop();
      this.setEnabledFlag(false);
      if (!link) return;
      const { identity } = await this.options.environment();
      try {
        await this.client(identity, link.relayOrigin).unlink();
      } catch (error) {
        if (!(error instanceof RelayRequestError && error.notLinked)) {
          this.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
      this.forgetLink();
    } finally {
      this.busy = null;
      this.changed();
    }
  }

  // ----- Website account -----

  async signIn(): Promise<void> {
    await this.options.account.beginSignIn();
  }

  cancelSignIn(): void {
    this.options.account.cancelSignIn();
  }

  handleAuthCallback(url: string): Promise<void> {
    return this.options.account.handleCallback(url);
  }

  /** Signing out also unlinks: this computer shouldn't stay reachable through an account it left. */
  async signOut(): Promise<void> {
    if (this.linked) {
      try {
        await this.unlink();
      } catch {
        // Unreachable relay: forget it here anyway; the phone can still unlink it.
        await this.supervisor.stop();
        this.forgetLink();
      }
    }
    await this.options.account.signOut();
    this.error = undefined;
    this.changed();
  }

  // ----- Mint trust -----

  /**
   * The pinned relay keys, refetched for a mint signed with a key not seen yet
   * (a relay key rotation), at most once an hour.
   */
  refreshRelayTrust(): Promise<RelayTrust | null> {
    const trust = this.storedTrust();
    const link = this.storedLink();
    if (!trust || !link) return Promise.resolve(null);
    if (this.now() - (trust.fetchedAt ?? 0) < RELAY_KEYS_REFRESH_MS) return Promise.resolve(trust);
    this.trustRefresh ??= (async () => {
      // Count the attempt even if it fails, so a bad kid can't make us hammer the relay.
      this.saveTrust({ ...trust, fetchedAt: this.now() });
      try {
        const { identity } = await this.options.environment();
        const keys: RelayPublicJwk[] = await this.client(identity, link.relayOrigin).jwks();
        const next: StoredTrust = { ...trust, keys, fetchedAt: this.now() };
        if (this.linked) this.saveTrust(next);
        return next;
      } catch {
        return trust;
      }
    })().finally(() => {
      this.trustRefresh = null;
    });
    return this.trustRefresh;
  }

  // ----- Activity -----

  /**
   * A Coach event from the hub. Turns and staged approvals become text-free
   * alerts, and running turns keep C-LINK's Live Activity current.
   */
  noteCoachEvent(frame: CoachEventFrame): void {
    // Only turns that start while linked are followed; sending checks the link again.
    if (frame.event !== "turn.started" || (this.enabled && this.storedLink())) this.live.note(frame);
    const event = activityForCoachEvent(frame);
    if (!event || !this.enabled || !SESSION_ID_PATTERN.test(frame.sessionId)) return;
    const link = this.storedLink();
    if (!link || !this.throttle.allow(frame.sessionId, event, this.now())) return;
    void this.options
      .environment()
      .then(({ identity }) => this.client(identity, link.relayOrigin).activity({ sessionId: frame.sessionId, event }))
      .catch((error) => {
        console.warn("[remote] activity push failed:", error instanceof RelayRequestError ? error.code : "error");
      });
  }

  /** A turn's phase, for the relay to push to the Live Activities following it. */
  private async sendLive(report: LiveTurnReport): Promise<void> {
    const link = this.storedLink();
    if (!link || !this.enabled) return;
    try {
      const { identity } = await this.options.environment();
      await this.client(identity, link.relayOrigin).liveActivity(report);
    } catch (error) {
      console.warn("[remote] live activity push failed:", error instanceof RelayRequestError ? error.code : "error");
    }
  }

  /** For tests and diagnostics. */
  connectorSnapshot(): ConnectorSnapshot {
    return this.supervisor.snapshot();
  }
}

function linkErrorMessage(error: unknown): string {
  if (error instanceof WebsiteAccountError) return error.message;
  if (error instanceof RelayRequestError) {
    switch (error.code) {
      case "link_limit_reached":
        return "Your account already has 10 linked computers. Unlink one from C-LINK, then try again.";
      case "environment_key_mismatch":
        return "This computer is linked with an older key. Unlink it from C-LINK, then try again.";
      case "invalid_token":
      case "client_not_allowed":
        return "watchfaces.coroslink.com didn't let this computer link. Sign out, sign in again, then try again.";
      case "not_configured":
        return "CorosLink's relay isn't set up for linking yet.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}
