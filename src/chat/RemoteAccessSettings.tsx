import { t, useLanguage, getLocale } from "../i18n/tools";
import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, Copy, Loader2, QrCode, Smartphone, X } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { RemoteAccessStatus, RemoteDevice, RemotePairingCode } from "../../electron/remote/contract";
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

/**
 * Coach settings → Remote access: lets C-LINK on an iPhone pair with this
 * computer and drive Coach over the local network. Only this window can pair
 * or remove devices.
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

      <label className="chat-settings-toggle-row">
        <span className="chat-settings-toggle-text">
          <strong>{t("Network access")}</strong>
          <span>
            {networkAccess && status?.lanAddresses.length
              ? t("Paired iPhones on this network can reach Coach at {{p0}}.", {
                  p0: status.lanAddresses.map((host) => `${host}:${status.port ?? ""}`).join(", ")
                })
              : t("Lets paired iPhones on the same Wi-Fi reach Coach. When off, only this computer can.")}</span>
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
                  : t("Turn on Network access to pair an iPhone.")}</span>
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
