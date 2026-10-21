import { t, useLanguage, getLocale, formatNumber } from "../i18n/tools";
import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, Copy, Download, Globe, Link2, Loader2, LogIn, LogOut, QrCode, Smartphone, Wifi, X } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  CloudLinkState,
  CloudLinkStatus,
  RemoteAccessStatus,
  RemoteDevice,
  RemotePairingCode
} from "../../electron/remote/contract";
import { ChatSettingsSectionHeader, chatSettingsSectionDomId } from "./chatSettingsSections";
import "./remoteAccessSettings.css";

function permissionLabel(device: RemoteDevice): string {
  if (device.permissions.includes("coach:approve")) return t("Can send and approve changes");
  if (device.permissions.includes("coach:operate")) return t("Can send, can't approve");
  return t("View only");
}

function lastSeen(device: RemoteDevice, now: number): string {
  if (device.connected) return t("Connected now");
  const at = Date.parse(device.lastUsedAt ?? device.createdAt);
  const minutes = Math.round((at - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  const relative =
    Math.abs(minutes) < 60
      ? format.format(minutes, "minute")
      : Math.abs(minutes) < 48 * 60
        ? format.format(Math.round(minutes / 60), "hour")
        : format.format(Math.round(minutes / (24 * 60)), "day");
  return t("Last used {{p0}}", { p0: relative });
}

function ipcMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(caught);
}

function cloudStateLabel(state: CloudLinkState): string {
  switch (state) {
    case "online":
      return t("Online");
    case "offline":
      return t("Offline");
    case "linking":
      return t("Linking…");
    case "error":
      return t("Error");
    default:
      return t("Off");
  }
}

function RoutePill({ state, label }: { state: string; label: string }) {
  return (
    <span className="chat-remote-pill" data-state={state} role="status">
      {state === "linking" ? <Loader2 className="chat-spinner" size={12} aria-hidden="true" /> : <i aria-hidden="true" />}
      {label}</span>
  );
}

/**
 * The away-from-home route under the remote access switch: sign in to
 * watchfaces.coroslink.com and the switch links this computer through
 * CorosLink's relay and runs Cloudflare's connector, so C-LINK reaches Coach
 * off the local network. cloudflared is downloaded only after the person
 * agrees; Connect retries or picks up a link the switch didn't start.
 */
function AwayRoute({
  api,
  cloud,
  onStatus
}: {
  api: CorosLinkApi;
  cloud: CloudLinkStatus;
  onStatus: (status: RemoteAccessStatus) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [confirm, setConfirm] = useState<"signOut" | null>(null);

  const run = async (key: string, task: () => Promise<RemoteAccessStatus>) => {
    setBusy(key);
    setError(null);
    try {
      onStatus(await task());
    } catch (caught) {
      setError(ipcMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const account = cloud.account;
  const connector = cloud.connector;
  const accountName = account.displayName || (account.handle ? `@${account.handle}` : t("your account"));
  const shownError = [error, account.error].find((item) => item && item !== cloud.message) ?? null;
  const downloadMb = connector.downloadBytes ? formatNumber(Math.round(connector.downloadBytes / 1_000_000)) : null;
  const ready = account.signedIn || cloud.linked;
  const idle = ready && !cloud.enabled && cloud.state !== "linking" && !connector.downloading;
  const askDownload = idle && connector.needsDownload && !declined;
  const showConnect = idle && !askDownload;

  const connect = () => {
    setDeclined(false);
    if (!connector.needsDownload) void run("connect", () => api.setCloudLink({ enabled: true }));
  };

  if (!cloud.available) {
    return (
      <div className="chat-remote-route">
        <span className="chat-remote-device-icon" aria-hidden="true">
          <Globe size={15} strokeWidth={1.8} />
        </span>
        <div className="chat-remote-device-text">
          <strong>{t("Away from home")}</strong>
          <span className="chat-remote-route-wrap">
            {t("Cloudflare doesn't publish a connector for this computer. Install cloudflared and put it on your PATH to use this.")}</span>
        </div>
      </div>
    );
  }

  const accountButton = account.signedIn ? (
    <button
      type="button"
      className={confirm === "signOut" ? "chat-local-action danger" : "chat-local-action"}
      disabled={busy !== null}
      title={cloud.linked ? t("Signing out also unlinks this computer.") : undefined}
      onBlur={() => setConfirm(null)}
      onClick={() => {
        if (cloud.linked && confirm !== "signOut") {
          setConfirm("signOut");
          return;
        }
        setConfirm(null);
        void run("signOut", () => api.cloudSignOut());
      }}
    >
      {busy === "signOut" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
      {confirm === "signOut" ? t("Sign out and unlink") : t("Sign out")}</button>
  ) : account.signingIn ? (
    <button type="button" className="chat-local-action" onClick={() => void run("signIn", () => api.cloudCancelSignIn())}>
      <X size={14} aria-hidden="true" />
      {t("Cancel")}</button>
  ) : (
    <button
      type="button"
      className={cloud.linked ? "chat-local-action" : "chat-local-action primary"}
      disabled={busy !== null}
      onClick={() => void run("signIn", () => api.cloudSignIn())}
    >
      <LogIn size={14} aria-hidden="true" />
      {t("Sign in")}</button>
  );

  const connectorLabel =
    connector.source === "path" || connector.source === "env"
      ? t("Using your own cloudflared.")
      : connector.version
        ? t("cloudflared {{p0}}", { p0: connector.version })
        : null;

  return (
    <div className="chat-remote-route" data-state={ready ? cloud.state : undefined}>
      <span className="chat-remote-device-icon" aria-hidden="true">
        <Globe size={15} strokeWidth={1.8} />
      </span>
      <div className="chat-remote-device-text">
        <strong>{t("Away from home")}</strong>
        {!ready ? (
          <span className="chat-remote-route-wrap">
            {account.signingIn
              ? t("Finish signing in in your browser.")
              : t("Sign in to watchfaces.coroslink.com and your iPhone reaches Coach from anywhere.")}</span>
        ) : (
          <>
            {cloud.linked && cloud.hostname ? (
              <code>{cloud.hostname}</code>
            ) : (
              <span>{cloud.state === "linking" ? t("Getting a private address at Cloudflare…") : t("No address yet.")}</span>
            )}
            <span>
              {[account.signedIn ? t("Signed in as {{p0}}", { p0: accountName }) : t("Not signed in"), connectorLabel]
                .filter(Boolean)
                .join(" · ")}</span>
          </>
        )}
      </div>
      <div className="chat-remote-route-end">
        {showConnect ? (
          <button type="button" className="chat-local-action primary" disabled={busy !== null} onClick={connect}>
            {busy === "connect" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            {t("Connect")}</button>
        ) : ready && !askDownload ? (
          <RoutePill state={cloud.state} label={cloudStateLabel(cloud.state)} />
        ) : null}
        {accountButton}
      </div>

      {askDownload ? (
        <div className="chat-remote-route-more chat-remote-cloud-consent" role="group" aria-label={t("Download Cloudflare's connector?")}>
          <strong>{t("Download Cloudflare's connector?")}</strong>
          <span>
            {t("CorosLink needs cloudflared {{p0}} ({{p1}} MB) from Cloudflare's releases on GitHub to reach Cloudflare. It checks the download against a pinned checksum before running it.", {
              p0: connector.downloadVersion,
              p1: downloadMb ?? "?"
            })}</span>
          <div className="chat-local-actions">
            <button
              type="button"
              className="chat-local-action primary"
              disabled={busy !== null}
              onClick={() => void run("connect", () => api.setCloudLink({ enabled: true, allowDownload: true }))}
            >
              <Download size={14} aria-hidden="true" />
              {t("Download and connect")}</button>
            <button type="button" className="chat-local-action" disabled={busy !== null} onClick={() => setDeclined(true)}>
              {t("Not now")}</button>
          </div>
        </div>
      ) : null}

      {connector.downloading ? (
        <div className="chat-remote-route-more chat-remote-cloud-progress" role="status">
          <span>
            {t("Downloading cloudflared… {{p0}}%", { p0: String(Math.round((connector.progress ?? 0) * 100)) })}</span>
          <progress max={1} value={connector.progress ?? undefined} />
        </div>
      ) : null}

      {cloud.state === "error" && cloud.message ? (
        <p className="chat-remote-route-more chat-remote-alert" role="alert">
          {cloud.message}</p>
      ) : cloud.state === "offline" ? (
        <p className="chat-remote-route-more chat-remote-cloud-note" role="status">
          <strong>{t("Not connected to Cloudflare right now. CorosLink keeps trying.")}</strong>
          {cloud.message ? ` ${cloud.message}` : null}</p>
      ) : null}
      {shownError ? (
        <p className="chat-remote-route-more chat-remote-alert" role="alert">
          {shownError}</p>
      ) : null}

      {cloud.intelMac ? (
        <p className="chat-remote-route-more chat-remote-cloud-note">
          {t("Cloudflare stops building its connector for Intel Macs in 2027. After that, C-LINK reaches this Mac on the local network only.")}</p>
      ) : null}
    </div>
  );
}

/**
 * Coach settings → Remote access: lets C-LINK on an iPhone pair with this
 * computer and drive Coach. One switch covers the same Wi-Fi and, once signed
 * in, away from home. Only this window can pair or remove devices.
 */
export function RemoteAccessSettings({ api }: { api: CorosLinkApi | undefined }) {
  useLanguage();
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [pairing, setPairing] = useState<RemotePairingCode | null>(null);
  const [pairedLabel, setPairedLabel] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [busy, setBusy] = useState<"network" | "pair" | "awake" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef<RemotePairingCode | null>(null);
  shown.current = pairing;
  const supported = typeof api?.getRemoteAccessStatus === "function";

  useEffect(() => {
    if (!supported || !api) return;
    let live = true;
    void api.getRemoteAccessStatus().then((next) => {
      if (live) setStatus(next);
    }, () => undefined);
    const stop = api.onRemoteAccessStatus((next) => setStatus(next));
    return () => {
      live = false;
      stop();
    };
  }, [api, supported]);

  // A code shown here dies with the panel, so it can't be scanned later.
  useEffect(
    () => () => {
      if (shown.current && api) void api.cancelRemotePairing(shown.current.id).catch(() => undefined);
    },
    [api]
  );

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  // The code was spent, cancelled or ran out: hide it, and say who paired.
  useEffect(() => {
    if (!pairing || !status) return;
    const expired = now >= Date.parse(pairing.expiresAt);
    if (status.pairing?.id === pairing.id && !expired) return;
    const newcomer = status.devices.find((device) => Date.parse(device.createdAt) >= Date.parse(pairing.createdAt));
    setPairedLabel(newcomer ? newcomer.label : null);
    setPairing(null);
  }, [status, pairing, now]);

  if (!supported || !api) return null;

  const run = async (key: string, task: () => Promise<RemoteAccessStatus | void>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await task();
      if (next) setStatus(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const showCode = () =>
    run("pair", async () => {
      setPairedLabel(null);
      const code = await api.createRemotePairing({ viewOnly });
      setNow(Date.now());
      setPairing(code);
      return api.getRemoteAccessStatus();
    });

  const hideCode = () =>
    run("pair", async () => {
      const code = pairing;
      setPairing(null);
      if (code) return api.cancelRemotePairing(code.id);
    });

  const copyLink = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("Could not copy the link."));
    }
  };

  const networkAccess = status?.networkAccess === true;
  const lanHosts = status?.lanAddresses.map((host) => `${host}:${status.port ?? ""}`).join(", ") ?? "";
  const remaining = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  const devices = status?.devices ?? [];
  const message = error ?? status?.error ?? null;

  return (
    <section
      className="chat-settings-section chat-remote-section"
      id={chatSettingsSectionDomId("remote")}
      data-settings-section="remote"
    >
      <ChatSettingsSectionHeader id="remote" />
      <p className="chat-settings-copy">
        {t("Pair C-LINK on your iPhone to follow and continue your Coach conversations while CorosLink is open on this computer. Your iPhone connects to this computer directly.")}</p>

      <div className="chat-remote-reach" data-on={networkAccess ? "true" : undefined}>
        <label className="chat-settings-toggle-row">
          <span className="chat-settings-toggle-text">
            <strong>{t("Reach Coach from your iPhone")}</strong>
            <span>
              {t("Paired iPhones reach Coach on this Wi-Fi, and from anywhere once you sign in. When off, only this computer can.")}</span>
          </span>
          <input
            type="checkbox"
            className="chat-settings-switch"
            checked={networkAccess}
            disabled={busy === "network" || !status}
            onChange={(event) => {
              const enabled = event.target.checked;
              if (!enabled) setPairing(null);
              void run("network", () => api.setRemoteNetworkAccess(enabled));
            }}
          />
        </label>

        {networkAccess && status ? (
          <div className="chat-remote-routes">
            <div className="chat-remote-route" data-state={lanHosts ? "online" : "offline"}>
              <span className="chat-remote-device-icon" aria-hidden="true">
                <Wifi size={15} strokeWidth={1.8} />
              </span>
              <div className="chat-remote-device-text">
                <strong>{t("This Wi-Fi")}</strong>
                {lanHosts ? (
                  <code>{lanHosts}</code>
                ) : (
                  <span className="chat-remote-route-wrap">{t("This computer isn't on a local network right now.")}</span>
                )}
              </div>
              <div className="chat-remote-route-end">
                <RoutePill state={lanHosts ? "online" : "offline"} label={lanHosts ? t("On") : t("No network")} />
              </div>
            </div>
            {status.cloud ? <AwayRoute api={api} cloud={status.cloud} onStatus={setStatus} /> : null}
          </div>
        ) : null}

        {networkAccess && status?.cloud?.available ? (
          <p className="chat-remote-cloud-note">
            {t("Away from home, Coach traffic is encrypted to Cloudflare and passes through Cloudflare's network; CorosLink's relay only sets up the connection.")}</p>
        ) : null}
      </div>

      {message ? (
        <p className="chat-remote-alert" role="alert">
          {message}</p>
      ) : null}

      <div className="chat-remote-pair">
        {pairing ? (
          <div className="chat-remote-code-block">
            <figure className="chat-remote-code">
              <img src={pairing.qrDataUrl} width={176} height={176} alt={t("Pairing code for C-LINK on iPhone")} />
            </figure>
            <div className="chat-remote-code-copy">
              <strong>{t("Scan with your iPhone")}</strong>
              <span>{t("Use the Camera app or C-LINK, then confirm on your iPhone. The code works once.")}</span>
              <span className="chat-remote-timer" role="timer">
                {t("Expires in {{p0}}:{{p1}}", {
                  p0: String(Math.floor(remaining / 60)),
                  p1: String(remaining % 60).padStart(2, "0")
                })}</span>
              {pairing.permissions.includes("coach:operate") ? null : (
                <span className="chat-remote-tag">{t("View only")}</span>
              )}
              <div className="chat-local-actions">
                <button type="button" className="chat-local-action" onClick={() => void copyLink()}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? t("Copied") : t("Copy link")}</button>
                <button type="button" className="chat-local-action" disabled={busy === "pair"} onClick={() => void hideCode()}>
                  <X size={14} aria-hidden="true" />
                  {t("Cancel")}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="chat-remote-pair-row">
            <div className="chat-settings-toggle-text">
              <strong>{t("Pair iPhone")}</strong>
              <span>
                {networkAccess
                  ? t("Shows a one-time code that works for 10 minutes.")
                  : t("Turn on Reach Coach from your iPhone to pair one.")}</span>
            </div>
            <div className="chat-remote-pair-actions">
              <label className="chat-local-tools">
                <input
                  type="checkbox"
                  checked={viewOnly}
                  disabled={!networkAccess}
                  onChange={(event) => setViewOnly(event.target.checked)}
                />
                <span>{t("View only")}</span>
              </label>
              <button
                type="button"
                className="chat-local-action primary"
                disabled={!networkAccess || busy === "pair"}
                onClick={() => void showCode()}
              >
                {busy === "pair" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <QrCode size={14} aria-hidden="true" />}
                {t("Pair iPhone")}</button>
            </div>
          </div>
        )}
        {pairedLabel ? (
          <p className="chat-remote-success" role="status">
            <CircleCheck size={14} aria-hidden="true" />
            {t("Paired with {{p0}}.", { p0: pairedLabel })}</p>
        ) : null}
      </div>

      <div className="chat-remote-devices">
        <h4>{t("Paired devices")}</h4>
        {devices.length === 0 ? (
          <p className="chat-settings-copy">{t("No iPhones are paired yet.")}</p>
        ) : (
          <ul>
            {devices.map((device) => (
              <li key={device.id} data-connected={device.connected ? "true" : undefined}>
                <span className="chat-remote-device-icon" aria-hidden="true">
                  <Smartphone size={15} strokeWidth={1.8} />
                </span>
                <div className="chat-remote-device-text">
                  <strong>{device.label}</strong>
                  <span>
                    {device.connected ? <i className="chat-remote-dot" aria-hidden="true" /> : null}
                    {lastSeen(device, Date.now())} · {permissionLabel(device)}</span>
                </div>
                <button
                  type="button"
                  className={confirmRemove === device.id ? "chat-local-action danger" : "chat-local-action"}
                  disabled={busy === device.id}
                  onBlur={() => setConfirmRemove((current) => (current === device.id ? null : current))}
                  onClick={() => {
                    if (confirmRemove !== device.id) {
                      setConfirmRemove(device.id);
                      return;
                    }
                    setConfirmRemove(null);
                    void run(device.id, () => api.revokeRemoteDevice(device.id));
                  }}
                >
                  {confirmRemove === device.id ? t("Confirm remove") : t("Remove")}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="chat-settings-toggle-row">
        <span className="chat-settings-toggle-text">
          <strong>{t("Keep this computer awake while remote is on")}</strong>
          <span>
            {status?.keepingAwake
              ? t("An iPhone is connected, so this computer is staying awake.")
              : t("While an iPhone is connected, this computer won't go to sleep.")}</span>
        </span>
        <input
          type="checkbox"
          className="chat-settings-switch"
          checked={status?.keepAwake === true}
          disabled={busy === "awake" || !status}
          onChange={(event) => {
            const enabled = event.target.checked;
            void run("awake", () => api.setRemoteKeepAwake(enabled));
          }}
        />
      </label>
    </section>
  );
}
