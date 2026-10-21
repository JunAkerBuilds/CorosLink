import { app, powerSaveBlocker, safeStorage, shell } from "electron";
import QRCode from "qrcode";
import type { CoachSessionHub } from "../coachHub/coachSessionHub";
import type { ChatProvider, ChatSettings } from "../types";
import type { ChatModelOption } from "../chatModels";
import { RemoteAuth, remoteDeviceFromRecord } from "./auth";
import { CloudLink, RELAY_TRUST_KEY, TUNNEL_HOSTNAME_KEY } from "./cloud/cloudLink";
import { PRODUCTION_RELAY_URL, relayBaseUrl } from "./cloud/relayClient";
import { PRODUCTION_WEBSITE_URL, WebsiteAccount, websiteBaseUrl } from "./cloud/websiteAccount";
import {
  DEFAULT_GRANT_PERMISSIONS,
  VIEW_ONLY_PERMISSIONS,
  encodeRemotePairingLink,
  type RemoteAccessStatus,
  type RemotePairingCode
} from "./contract";
import {
  computerName,
  hasRemoteIdentity,
  loadOrCreateRemoteIdentity,
  preferredRemotePort,
  randomRemotePort,
  saveRemotePort,
  type RemoteIdentity,
  type RemoteSecretBox,
  type RemoteSettingsStore
} from "./identity";
import { RemoteServer, remoteLanAddresses, type RelayTrust } from "./server";

/**
 * Remote access as the app runs it: one environment server for the Coach hub,
 * started at launch once this computer has an identity (or on first use), the
 * one remote access switch (the same Wi-Fi, plus away from home once signed
 * in), keep-awake, and pairing codes for the Remote access panel. The desktop
 * window drives it over IPC (main.ts), which is the only place `access:write`
 * exists.
 */

const NETWORK_ACCESS_KEY = "remote.networkAccess";
const KEEP_AWAKE_KEY = "remote.keepAwake";

const safeStorageBox: RemoteSecretBox = {
  ensureAvailable() {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
    ) {
      throw new Error("Secure credential storage is unavailable. Unlock your system keychain to use remote access.");
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (encrypted) => safeStorage.decryptString(encrypted)
};

export interface RemoteAccessOptions {
  hub: CoachSessionHub;
  settings: RemoteSettingsStore;
  defaultProvider: () => ChatProvider;
  chatSettings?: () => ChatSettings;
  saveChatSettings?: (settings: ChatSettings) => ChatSettings;
  chatModels?: (provider: ChatProvider) => Promise<ChatModelOption[]>;
}

export class RemoteAccess {
  private readonly auth = new RemoteAuth();
  private server: RemoteServer | null = null;
  private starting: Promise<RemoteServer> | null = null;
  private identity: RemoteIdentity | null = null;
  private error: string | undefined;
  private blockerId: number | null = null;
  private readonly listeners = new Set<(status: RemoteAccessStatus) => void>();
  private pairingTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  /** Away from home: the website account, the relay link and cloudflared. */
  readonly cloud: CloudLink;

  constructor(private readonly options: RemoteAccessOptions) {
    this.auth.onChange(() => this.changed());
    const onChange = () => this.changed();
    const settings = options.settings;
    this.cloud = new CloudLink({
      settings,
      secrets: safeStorageBox,
      account: new WebsiteAccount({
        origin: configuredUrl(
          () => websiteBaseUrl({ isPackaged: app.isPackaged, override: process.env.COROSLINK_WATCHFACE_SITE_URL }),
          PRODUCTION_WEBSITE_URL
        ),
        settings,
        secrets: safeStorageBox,
        openExternal: (url) => shell.openExternal(url),
        onChange
      }),
      relayUrl: configuredUrl(
        () => relayBaseUrl({ isPackaged: app.isPackaged, override: process.env.COROSLINK_RELAY_URL }),
        PRODUCTION_RELAY_URL
      ),
      environment: async () => {
        const server = await this.ensureStarted();
        if (!this.identity || server.port === null) throw new Error("Remote access isn't running.");
        return { identity: this.identity, port: server.port };
      },
      label: () => computerName(),
      platform: process.platform,
      arch: process.arch,
      userDataDir: app.getPath("userData"),
      onChange
    });
  }

  /** At launch: start only if remote access was set up before, so nobody else gets a keychain prompt. */
  initialize(): void {
    this.pruneTimer = setInterval(() => this.prune(), 24 * 60 * 60_000);
    this.pruneTimer.unref?.();
    this.prune();
    // Turns and staged approvals become text-free pushes while linked.
    this.options.hub.onEvent((frame) => this.cloud.noteCoachEvent(frame));
    // Before one switch, the tunnel could run with the same Wi-Fi off; it now means both.
    if (this.cloud.enabled && !this.networkAccess) this.options.settings.set(NETWORK_ACCESS_KEY, "1");
    // Reconnects the tunnel when linked and switched on (which starts the server).
    this.cloud.initialize();
    if (!hasRemoteIdentity(this.options.settings)) return;
    void this.ensureStarted().catch(() => undefined);
  }

  private prune(): void {
    try {
      this.auth.prune();
    } catch (error) {
      console.warn("[remote] prune failed:", error instanceof Error ? error.message : error);
    }
  }

  onStatus(listener: (status: RemoteAccessStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.updateKeepAwake();
    const status = this.status();
    for (const listener of [...this.listeners]) listener(status);
  }

  private get networkAccess(): boolean {
    return this.options.settings.get(NETWORK_ACCESS_KEY) === "1";
  }

  private get keepAwake(): boolean {
    return this.options.settings.get(KEEP_AWAKE_KEY) === "1";
  }

  private relayTrust(): RelayTrust | null {
    const saved = this.options.settings.get(RELAY_TRUST_KEY);
    if (!saved) return null;
    try {
      const trust = JSON.parse(saved) as RelayTrust;
      return trust && typeof trust.issuer === "string" && typeof trust.userId === "string" && Array.isArray(trust.keys)
        ? trust
        : null;
    } catch {
      return null;
    }
  }

  private ensureStarted(): Promise<RemoteServer> {
    if (this.server?.running) return Promise.resolve(this.server);
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<RemoteServer> {
    try {
      this.identity ??= loadOrCreateRemoteIdentity(this.options.settings, safeStorageBox);
      const settings = this.options.settings;
      this.server ??= new RemoteServer({
        identity: this.identity,
        auth: this.auth,
        hub: this.options.hub,
        descriptor: () => ({ name: computerName(), appVersion: app.getVersion() }),
        defaultProvider: this.options.defaultProvider,
        chatSettings: this.options.chatSettings,
        saveChatSettings: this.options.saveChatSettings,
        chatModels: this.options.chatModels,
        port: preferredRemotePort(settings),
        nextPort: () => randomRemotePort(),
        onPortChanged: (port) => saveRemotePort(settings, port),
        networkAccess: this.networkAccess,
        tunnelHostname: () => settings.get(TUNNEL_HOSTNAME_KEY) || null,
        relayTrust: () => this.relayTrust(),
        refreshRelayTrust: () => this.cloud.refreshRelayTrust(),
        onConnectionsChanged: () => this.changed()
      });
      await this.server.start();
      this.error = undefined;
      return this.server;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Remote access couldn't start.";
      throw error;
    } finally {
      this.changed();
    }
  }

  async stop(): Promise<void> {
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.releaseKeepAwake();
    await Promise.all([this.cloud.stop(), this.server?.stop()]);
  }

  status(): RemoteAccessStatus {
    const server = this.server;
    const running = Boolean(server?.running);
    const connected = server?.connectedSessionIds() ?? new Set<string>();
    let devices: RemoteAccessStatus["devices"] = [];
    let pairing: RemoteAccessStatus["pairing"] = null;
    try {
      devices = this.auth.listSessions().map((record) => remoteDeviceFromRecord(record, connected.has(record.id)));
      const pending = this.auth.pendingPairing();
      pairing = pending ? { id: pending.id, expiresAt: new Date(pending.expiresAt).toISOString() } : null;
    } catch {
      // The database isn't open yet.
    }
    return {
      running,
      networkAccess: this.networkAccess,
      keepAwake: this.keepAwake,
      keepingAwake: this.blockerId !== null,
      port: server?.port ?? null,
      lanAddresses: this.networkAccess ? remoteLanAddresses() : [],
      name: computerName(),
      environmentId: this.identity?.environmentId ?? null,
      pairing,
      devices,
      ...(this.error ? { error: this.error } : {}),
      cloud: this.cloud.status()
    };
  }

  /**
   * The remote access switch: the same Wi-Fi and, once signed in, away from
   * home. Off stops both (the away-from-home link stays, so its address does).
   */
  async setNetworkAccess(enabled: boolean): Promise<RemoteAccessStatus> {
    this.options.settings.set(NETWORK_ACCESS_KEY, enabled ? "1" : "0");
    if (!enabled) this.auth.cancelPairing();
    const server = await this.ensureStarted();
    await server.setNetworkAccess(enabled);
    if (enabled) this.connectAway();
    else await this.cloud.setEnabled(false);
    this.changed();
    return this.status();
  }

  /**
   * Away from home joins the same Wi-Fi when there's an account or a link to
   * use. It runs on its own (the status says "linking"); a missing cloudflared
   * waits for the panel's download consent.
   */
  private connectAway(): void {
    const cloud = this.cloud.status();
    if (!cloud.available || cloud.enabled || !(cloud.account.signedIn || cloud.linked)) return;
    void this.cloud.setEnabled(true).catch(() => undefined);
  }

  setKeepAwake(enabled: boolean): RemoteAccessStatus {
    this.options.settings.set(KEEP_AWAKE_KEY, enabled ? "1" : "0");
    this.changed();
    return this.status();
  }

  /** A QR code for C-LINK. Needs remote access on and a local network to be on. */
  async createPairing(input: { viewOnly?: boolean } = {}): Promise<RemotePairingCode> {
    if (!this.networkAccess) throw new Error("Turn on remote access first, so your iPhone can reach this computer.");
    const server = await this.ensureStarted();
    const hosts = remoteLanAddresses();
    if (!hosts.length) {
      throw new Error("This computer isn't on a local network. Join the same Wi-Fi as your iPhone, then try again.");
    }
    const port = server.port;
    if (port === null || !this.identity) throw new Error("Remote access isn't running.");
    const pairing = this.auth.createPairing(input.viewOnly ? VIEW_ONLY_PERMISSIONS : DEFAULT_GRANT_PERMISSIONS);
    // The link carries the secret: it goes to the window as a QR code and is never logged.
    const link = encodeRemotePairingLink({
      environmentId: this.identity.environmentId,
      hosts,
      port,
      name: computerName(),
      secret: pairing.secret
    });
    const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: "M" });
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    // Tell the window when the code lapses unused.
    this.pairingTimer = setTimeout(() => this.changed(), pairing.expiresAt - Date.now() + 500);
    this.pairingTimer.unref?.();
    return {
      id: pairing.id,
      link,
      qrDataUrl,
      hosts,
      port,
      createdAt: new Date(pairing.createdAt).toISOString(),
      expiresAt: new Date(pairing.expiresAt).toISOString(),
      permissions: pairing.permissions
    };
  }

  cancelPairing(id?: string): RemoteAccessStatus {
    this.auth.cancelPairing(id);
    return this.status();
  }

  revokeDevice(sessionId: string): RemoteAccessStatus {
    this.auth.revokeSession(sessionId);
    return this.status();
  }

  // ----- Away from home -----

  async cloudSignIn(): Promise<RemoteAccessStatus> {
    await this.cloud.signIn();
    return this.status();
  }

  cloudCancelSignIn(): RemoteAccessStatus {
    this.cloud.cancelSignIn();
    return this.status();
  }

  async cloudSignOut(): Promise<RemoteAccessStatus> {
    await this.cloud.signOut();
    return this.status();
  }

  async setCloudLink(enabled: boolean, input: { allowDownload?: boolean } = {}): Promise<RemoteAccessStatus> {
    await this.cloud.setEnabled(enabled, input);
    return this.status();
  }

  async cloudUnlink(): Promise<RemoteAccessStatus> {
    await this.cloud.unlink();
    return this.status();
  }

  /** The `coroslink://auth/callback` deep link from the browser. Signed in with remote access on: away from home joins in. */
  async handleAuthCallback(url: string): Promise<void> {
    await this.cloud.handleAuthCallback(url);
    if (this.networkAccess) this.connectAway();
  }

  // ----- Keep awake -----

  /** Holds the computer awake while a device is connected, if the setting is on. */
  private updateKeepAwake(): void {
    const wanted = this.keepAwake && (this.server?.connectedSessionIds().size ?? 0) > 0;
    if (wanted && this.blockerId === null) {
      this.blockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!wanted) {
      this.releaseKeepAwake();
    }
  }

  private releaseKeepAwake(): void {
    if (this.blockerId === null) return;
    if (powerSaveBlocker.isStarted(this.blockerId)) powerSaveBlocker.stop(this.blockerId);
    this.blockerId = null;
  }
}

/** A dev override (unpackaged builds only); a bad one falls back to production with a warning. */
function configuredUrl(resolve: () => string, fallback: string): string {
  try {
    return resolve();
  } catch (error) {
    console.warn("[remote]", error instanceof Error ? error.message : error);
    return fallback;
  }
}
