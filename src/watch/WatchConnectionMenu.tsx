import { t, useLanguage, getLocale } from "../i18n/tools";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BatteryMedium, Bluetooth, ChevronDown, ChevronLeft, ChevronRight, Info, KeyRound, LayoutGrid, Loader2,
  MessageSquare, RefreshCw, Search, Send, Smartphone, Unplug, Usb, Watch, type LucideIcon
} from "lucide-react";
import type { WatchStatus } from "../../electron/types";
import type { CorosNativeBleDeviceChoice, CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { formatBytes } from "../media/libraryUtils";
import { CorosPhonePairingPanel } from "../watchfaces/CorosPhonePairingPanel";
import {
  apiErrorMessage, connectedWatch, onSystemBluetooth, watchConnectionState, watchDisplayName, watchFirmware, watchLinkSupported, watchMessagingReady,
  type WatchLinkTone
} from "../watchfaces/watchLink";
import { isValidatedWatch } from "../../electron/watchfaceTargets";
import "../watchfaces/watchLink.css";
import "./watchConnection.css";

type WatchMenuPage = "home" | "message" | "iphone" | "details";

interface WatchConnectionMenuProps {
  api: CorosLinkApi | undefined;
  /** The app-wide Bluetooth link, polled by App. */
  snapshot: CorosNativeBleSnapshot | null;
  onSnapshotChange: (snapshot: CorosNativeBleSnapshot) => void;
  /** The watch mounted as USB storage, used for music and maps. */
  usbWatch: WatchStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWatchFaces: () => void;
  onSignIn: () => void;
}

/** The toolbar's watch button: every way CorosLink reaches the watch, from any view. */
export function WatchConnectionMenu(props: WatchConnectionMenuProps) {
  useLanguage();
  const { api, snapshot, usbWatch, open, onOpenChange } = props;
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  const trigger = triggerState(snapshot, usbWatch);

  return (
    <div className="watch-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`watch-menu-trigger is-${trigger.tone}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("{{p0}}: {{p1}}. Watch connection", { p0: trigger.name, p1: trigger.label })}
        title={trigger.title}
        onClick={() => onOpenChange(!open)}
      >
        <span className="watch-menu-trigger-name">
          <Watch size={16} aria-hidden="true" />
          <span>{trigger.name}</span>
        </span>
        <span className="watch-menu-trigger-status">
          <span className="watch-menu-lamp" aria-hidden="true" />
          <span className="watch-menu-trigger-label">{trigger.label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </span>
      </button>
      {open ? <WatchMenuPanel {...props} id={panelId} api={api} /> : null}
    </div>
  );
}

function triggerState(snapshot: CorosNativeBleSnapshot | null, usbWatch: WatchStatus | null):
  { tone: WatchLinkTone; name: string; label: string; title: string } {
  const ble = watchConnectionState(snapshot);
  if (snapshot?.connected) {
    const name = watchDisplayName(snapshot.deviceName, t("Watch")).replace(/^COROS\s+/i, "");
    const label = ble.tone === "ok" ? t("Connected") : ble.tone === "busy" ? t("Connecting…")
      : snapshot.systemBind === "failed" ? t("Auth failed") : t("Sign-in needed");
    return { tone: ble.tone, name, label, title: `${watchDisplayName(snapshot.deviceName)}: ${ble.label}` };
  }
  if (ble.tone === "busy") return { tone: "busy", name: t("Watch"), label: ble.label, title: ble.label };
  if (usbWatch?.connected) {
    return { tone: "ok", name: usbWatch.name ?? t("Watch"), label: t("Connected"), title: usbWatch.rootPath ? t("USB storage at {{p0}}", { p0: usbWatch.rootPath }) : t("Connected over USB") };
  }
  return { tone: "off", name: t("Watch"), label: t("Offline"), title: t("No watch connected") };
}

function WatchMenuPanel({
  id, api, snapshot, onSnapshotChange, usbWatch, onOpenChange, onOpenWatchFaces, onSignIn
}: WatchConnectionMenuProps & { id: string }) {
  useLanguage();
  const [page, setPage] = useState<WatchMenuPage>("home");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<CorosNativeBleDeviceChoice | undefined>();
  const [watchKeySaved, setWatchKeySaved] = useState<boolean | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shownPage = useRef<WatchMenuPage | null>(null);

  useEffect(() => {
    if (typeof api?.getCorosWatchfaceStatus !== "function") return;
    let disposed = false;
    void api.getCorosWatchfaceStatus()
      .then(status => { if (!disposed) setWatchKeySaved(Boolean(status.watchAuthenticationAvailable)); })
      .catch(() => {});
    return () => { disposed = true; };
  }, [api]);

  // Opening focuses the panel; each page change focuses its first control.
  useEffect(() => {
    const previous = shownPage.current;
    shownPage.current = page;
    if (previous === page) return;
    if (previous === null) panelRef.current?.focus();
    else panelRef.current?.querySelector<HTMLElement>(page === "home" ? ".watch-menu-row" : ".watch-menu-back")?.focus();
  }, [page]);

  const supported = Boolean(api && typeof api.connectCorosNativeBle === "function" && watchLinkSupported(snapshot));
  const connected = Boolean(snapshot?.connected);
  const state = watchConnectionState(snapshot);
  const linking = snapshot?.phase === "connecting" || snapshot?.phase === "scanning";
  const disabled = busy || linking;
  const waitedSeconds = useWaitTimer(!connected && disabled);
  const devices = snapshot?.discoveredDevices ?? [];
  const needsSignIn = connected
    ? snapshot?.systemBind === "unavailable" || snapshot?.systemBind === "failed" || snapshot?.systemBind === "not_authenticated"
    : watchKeySaved === false;

  async function run(task: () => Promise<CorosNativeBleSnapshot | void>) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await task();
      if (next) onSnapshotChange(next);
      if (next?.connected) setChoosing(false);
    } catch (error) {
      setMessage(apiErrorMessage(error, t("The watch did not respond.")));
    } finally {
      setBusy(false);
    }
  }

  /** Scans; with exactly one watch nearby and `connectSingle`, connects to it straight away. */
  async function findWatches(connectSingle: boolean): Promise<CorosNativeBleSnapshot> {
    const found = await api!.scanCorosNativeBle();
    onSnapshotChange(found);
    const nearby = found.discoveredDevices ?? [];
    if (!nearby.length) throw new Error(t("No COROS watch found nearby. On the watch, open System → Pair Phone, keep it close, then try again."));
    if (nearby.length === 1 && connectSingle) {
      setSelectedDevice(nearby[0]);
      return api!.connectCorosNativeBle({ backend: "system", device: nearby[0] });
    }
    setChoosing(true);
    setSelectedDevice(current => nearby.find(item => item.deviceId === current?.deviceId) ?? (nearby.length === 1 ? nearby[0] : undefined));
    return found;
  }

  const connect = () => run(async () => {
    // Always the computer's own Bluetooth; this replaces a saved USB-adapter choice.
    if (choosing && selectedDevice) return api!.connectCorosNativeBle({ backend: "system", device: selectedDevice });
    try {
      return await api!.connectCorosNativeBle({ backend: "system" });
    } catch (error) {
      // Nothing remembered yet: find the watch instead of asking the user to.
      if (!/find and select/i.test(apiErrorMessage(error, ""))) throw error;
    }
    return findWatches(true);
  });

  const openWatchFaces = () => { onOpenChange(false); onOpenWatchFaces(); };
  const signIn = () => { onOpenChange(false); onSignIn(); };

  const connectLabel = snapshot?.phase === "scanning" ? t("Finding watch…")
    : snapshot?.phase === "connecting" || busy ? t("Connecting…")
    : choosing && selectedDevice ? t("Connect to {{p0}}", { p0: watchDisplayName(selectedDevice.deviceName) }) : t("Connect watch");

  const home = (
    <>
      <header className="watch-menu-identity">
        <span className={`watch-link-glyph is-${state.tone}`} aria-hidden="true"><Watch size={20} /></span>
        <div className="watch-menu-identity-text">
          <h2 id={`${id}-title`}>{connected ? watchDisplayName(snapshot?.deviceName) : t("Your COROS watch")}</h2>
          <p className="watch-menu-meta">
            {supported ? <span className={`watch-link-state is-${state.tone}`} role="status">{state.label}</span> : null}
            {connected && snapshot?.batteryPercent !== undefined ? <span className="watch-link-chip">
              <BatteryMedium size={14} aria-hidden="true" />{snapshot.batteryPercent}%</span> : null}
          </p>
        </div>
        {connected ? <button className="watch-link-icon-button" type="button" disabled={disabled}
          aria-label={t("Refresh battery and status")} title={t("Refresh battery and status")}
          onClick={() => void run(() => api!.refreshCorosNativeBle())}>
          <RefreshCw size={15} className={busy ? "spin" : undefined} aria-hidden="true" />
        </button> : null}
      </header>

      {!supported && snapshot !== null ? <p className="watch-menu-hint">
        {t("Bluetooth features need CorosLink’s watch link, which isn’t available on this computer. USB storage still works for music.")}</p> : null}

      {supported && needsSignIn ? <div className="watch-menu-callout" role={connected ? "alert" : undefined}>
        <KeyRound size={16} aria-hidden="true" />
        <div>
          <strong>{connected && snapshot?.systemBind === "failed" ? t("The watch didn’t accept this account") : t("Sign in to COROS")}</strong>
          <p>{connected && snapshot?.systemBind === "failed" && snapshot.authenticationError ? snapshot.authenticationError
            : t("Your watch only trusts CorosLink after you sign in with the COROS account it’s paired to.")}</p>
        </div>
        <button className="secondary-button watch-link-button" type="button" onClick={signIn}>{t("Sign in")}</button>
      </div> : null}

      {supported && !connected ? <div className="watch-menu-connect">
        {choosing && devices.length ? <fieldset className="watch-menu-devices" disabled={disabled}>
          <legend>{t("Watches nearby")}</legend>
          {devices.map(device => <label key={device.deviceId} className={selectedDevice?.deviceId === device.deviceId ? "is-selected" : undefined}>
            <input type="radio" name={`${id}-device`} value={device.deviceId}
              checked={selectedDevice?.deviceId === device.deviceId} onChange={() => setSelectedDevice(device)} />
            <Watch size={15} aria-hidden="true" />
            <span>{watchDisplayName(device.deviceName)}<small>{device.deviceName}</small></span>
          </label>)}
        </fieldset> : null}
        <button className="primary-button watch-link-button watch-menu-connect-button" type="button"
          disabled={disabled || (choosing && !selectedDevice)} onClick={() => void connect()}>
          {busy || linking ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Bluetooth size={15} aria-hidden="true" />}
          {connectLabel}
        </button>
        {waitedSeconds >= 8 ? <p className="watch-menu-hint" role="status">
          {t("Still looking for your watch ·")} {Math.floor(waitedSeconds / 60)}:{String(waitedSeconds % 60).padStart(2, "0")}{t(". Wake it and open System → Pair Phone. CorosLink stops trying after about a minute.")}</p> : <p className="watch-menu-hint">
          {t("First time? On the watch, open System → Pair Phone, then connect and accept the pairing prompt.")}</p>}
      </div> : null}

      {message || (snapshot?.phase === "failed" && snapshot.error) ? <p className="watch-link-note is-error" role="alert">{message ?? snapshot?.error}</p> : null}


      {supported ? <ul className="watch-menu-list" aria-label={t("Watch features")}>
        <MenuRow icon={LayoutGrid} title={t("Watch faces")} detail={t("Install and replace faces on the watch")} onClick={openWatchFaces} />
        <MenuRow icon={MessageSquare} title={t("Send a message")} detail={watchMessagingReady(snapshot) ? t("Appears as a notification on the watch") : t("Needs a connected, supported COROS watch")}
          onClick={() => setPage("message")} />
        <MenuRow icon={Smartphone} title={t("iPhone app")} detail={t("Pair C-LINK with a QR code")} onClick={() => setPage("iphone")} />
        <MenuRow icon={Info} title={t("Connection details")} detail={t("Firmware, signal, watch key and diagnostics")} onClick={() => setPage("details")} />
      </ul> : null}

      {usbWatch?.connected || usbWatch?.error ? <div className="watch-menu-usb">
        <span className="watch-menu-usb-icon" aria-hidden="true"><Usb size={15} /></span>
        <div>
          <strong>{usbWatch.connected ? t("USB storage · {{p0}}", { p0: usbWatch.name ?? t("Watch") }) : t("USB storage")}</strong>
          <span>{usbWatch.connected
            ? usbWatch.freeBytes !== undefined ? t("{{p0}} free · for music and maps", { p0: formatBytes(usbWatch.freeBytes) }) : t("Ready for music and maps")
            : usbWatch.error}</span>
        </div>
      </div> : null}

      {supported ? <footer className="watch-menu-footer">
        {connected ? <button className="secondary-button watch-link-button" type="button" disabled={disabled}
          onClick={() => void run(() => api!.disconnectCorosNativeBle())}>
          <Unplug size={15} aria-hidden="true" />  {t("Disconnect")}</button> : <button className="watch-menu-text-button" type="button" disabled={disabled}
          onClick={() => void run(() => findWatches(false))}>
          <Search size={14} aria-hidden="true" /> {choosing ? t("Search again") : t("Choose a watch")}
        </button>}
      </footer> : null}
    </>
  );

  return (
    <div id={id} ref={panelRef} className="watch-menu-panel" role="dialog" tabIndex={-1}
      aria-labelledby={page === "home" ? `${id}-title` : `${id}-page-title`} aria-busy={disabled || undefined}>
      {page === "home" ? home : <div className="watch-menu-page">
        <header className="watch-menu-page-head">
          <button className="watch-menu-back" type="button" onClick={() => setPage("home")}>
            <ChevronLeft size={16} aria-hidden="true" />  {t("Watch")}</button>
          <h2 id={`${id}-page-title`}>{page === "message" ? t("Send a message") : page === "iphone" ? t("C-LINK for iPhone") : t("Connection details")}</h2>
        </header>
        {page === "message" ? <WatchMessageComposer api={api} snapshot={snapshot} busy={disabled} onBusy={setBusy} />
          : page === "iphone" ? api ? <CorosPhonePairingPanel api={api} /> : null
          : <WatchConnectionDetails snapshot={snapshot} api={api} watchKeySaved={watchKeySaved} onWatchKeySavedChange={setWatchKeySaved} />}
      </div>}
    </div>
  );
}

/** Seconds since `waiting` turned on; 0 while off. */
function useWaitTimer(waiting: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waiting) { setStartedAt(null); return; }
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

function MenuRow({ icon: Icon, title, detail, onClick }: { icon: LucideIcon; title: string; detail: ReactNode; onClick: () => void }) {
  useLanguage();
  return (
    <li>
      <button className="watch-menu-row" type="button" onClick={onClick}>
        <span className="watch-menu-row-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="watch-menu-row-text"><strong>{title}</strong><small>{detail}</small></span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </li>
  );
}

/** A CorosLink notification on the watch (tested on PACE Pro, beta on other watches). */
function WatchMessageComposer({ api, snapshot, busy, onBusy }: {
  api: CorosLinkApi | undefined; snapshot: CorosNativeBleSnapshot | null; busy: boolean; onBusy: (busy: boolean) => void;
}) {
  useLanguage();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const senderAvailable = typeof api?.sendCorosNotification === "function";
  const ready = watchMessagingReady(snapshot) && senderAvailable;
  const tooLong = new TextEncoder().encode(draft).length > 511;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || !ready || !draft.trim() || tooLong || busy) return;
    sendingRef.current = true;
    setSending(true); onBusy(true); setStatus(null);
    try {
      await api!.sendCorosNotification({ title: "CorosLink", body: draft });
      setStatus({ error: false, text: t("Sent. Check your watch for the notification.") });
    } catch (error) {
      setStatus({ error: true, text: apiErrorMessage(error, t("Could not send the message.")) });
    } finally {
      sendingRef.current = false;
      setSending(false); onBusy(false);
    }
  }

  return (
    <form className="watch-link-composer" onSubmit={event => void send(event)}>
      <label htmlFor="coros-notification-message">{t("Message your watch")}</label>
      <textarea id="coros-notification-message" rows={4} maxLength={511} value={draft}
        placeholder={t("Type a message…")} disabled={sending} aria-describedby="coros-notification-help"
        aria-invalid={tooLong || undefined}
        onChange={event => { setDraft(event.target.value); setStatus(null); }} />
      <div className="watch-link-composer-footer">
        <p id="coros-notification-help">
          {tooLong ? t("This message is too long. Shorten it before sending.")
            : ready ? t("Appears on the watch as a CorosLink notification.")
            : !senderAvailable ? t("Restart CorosLink to enable message sending.")
            : t("Connect and authenticate a supported COROS watch to send messages.")}
        </p>
        <button className="primary-button watch-link-button" type="submit" disabled={busy || !ready || !draft.trim() || tooLong}>
          {sending ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {sending ? t("Sending…") : t("Send")}
        </button>
      </div>
      {status ? <p className={`watch-link-note${status.error ? " is-error" : " is-success"}`}
        role={status.error ? "alert" : "status"}>{status.text}</p> : null}
    </form>
  );
}

/**
 * The watch account key CorosLink saved at COROS sign-in. Signing out keeps it; this
 * removes it (main asks to confirm), and a sign-in with another account replaces it.
 */
function WatchKeySection({ api, saved, onSavedChange }: {
  api: CorosLinkApi | undefined; saved: boolean | null; onSavedChange: (saved: boolean) => void;
}) {
  useLanguage();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRemove = typeof api?.forgetCorosWatchKey === "function";

  async function remove() {
    if (removing || !api?.forgetCorosWatchKey) return;
    setRemoving(true);
    setError(null);
    try {
      onSavedChange(Boolean((await api.forgetCorosWatchKey()).watchAuthenticationAvailable));
    } catch (caught) {
      setError(apiErrorMessage(caught, t("Could not remove the watch key.")));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="watch-link-key" aria-label={t("Watch key")}>
      <h3>{t("Watch key")}</h3>
      <p role="status">{saved === null ? t("Checking for a saved watch key…")
        : saved ? t("Saved on this computer from your COROS sign-in. Signing out of COROS keeps it; signing in with another account replaces it.")
        : t("Not saved. Sign in to COROS to authenticate with your watch.")}</p>
      {saved && canRemove ? <button className="secondary-button watch-link-button" type="button" disabled={removing} onClick={() => void remove()}>
        {removing ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
        {t("Remove watch key")}</button> : null}
      {error ? <p className="watch-link-note is-error" role="alert">{error}</p> : null}
    </section>
  );
}

function WatchConnectionDetails({ snapshot, api, watchKeySaved, onWatchKeySavedChange }: {
  snapshot: CorosNativeBleSnapshot | null;
  api: CorosLinkApi | undefined;
  watchKeySaved: boolean | null;
  onWatchKeySavedChange: (saved: boolean) => void;
}) {
  useLanguage();
  const watchKey = <WatchKeySection api={api} saved={watchKeySaved} onSavedChange={onWatchKeySavedChange} />;
  if (!snapshot) return <div className="watch-link-details"><p className="watch-menu-hint">{t("Reading the watch connection…")}</p>{watchKey}</div>;
  const details = [
    [t("Battery"), snapshot.batteryPercent === undefined ? "—" : `${snapshot.batteryPercent}%`],
    [t("Model"), snapshot.modelNumber || "—"],
    [t("Recognized as"), connectedWatch(snapshot) ? `${connectedWatch(snapshot)!.label}${snapshot.watchModelSource === "name" ? t(" (from its name)") : ""}${(snapshot.watchValidated ?? isValidatedWatch(snapshot)) ? "" : t(" · beta")}`
      : snapshot.connected ? t("Not supported yet") : "—"],
    [t("Software"), watchFirmware(snapshot) || "—"],
    [t("Signal"), snapshot.connected && snapshot.rssiDbm !== undefined ? t("{{p0}} dBm", { p0: snapshot.rssiDbm }) : "—"],
    [snapshot.pairingManagedByOS ? t("Maximum write") : "MTU", snapshot.pairingManagedByOS
      ? snapshot.maximumWriteBytes === undefined ? "—" : t("{{p0}} bytes", { p0: snapshot.maximumWriteBytes })
      : snapshot.mtu === undefined ? "—" : t("{{p0}} bytes", { p0: snapshot.mtu })],
    [t("Connection"), snapshot.connected ? "Bluetooth" : t("Disconnected")],
    [t("COROS session"), snapshot.connected && snapshot.systemBind === "authenticated" ? t("Authenticated")
      : snapshot.systemBind === "failed" ? t("Authentication failed") : t("Not authenticated")]
  ];
  return (
    <div className="watch-link-details">
      <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
      {watchKey}
      {onSystemBluetooth(snapshot) ? <section className="watch-link-events" aria-label={t("Watch controls")}>
        <h3>{t("Watch controls")}</h3>
        <p>{t("Press the watch’s phone music controls to see the commands it sends. Action mapping is still being investigated.")}</p>
        {snapshot.watchEvents?.length ? <ul>{snapshot.watchEvents.slice().reverse().map(event => <li key={event.id}>
          <time>{new Date(event.receivedAt).toLocaleTimeString(getLocale())}</time>
          {event.kind === "call-rejected" ? t("Call rejected") : t("Media command {{p0}}, value {{p1}}", { p0: event.action, p1: event.value })}
        </li>)}</ul> : <p>{t("No watch commands received in this connection.")}</p>}
      </section> : null}
      {snapshot.channels.length ? <details className="watch-link-channels">
        <summary>{t("Live BLE channels")}</summary>
        <p>{snapshot.pairingManagedByOS ? t("{{p0}} COROS control writes · pairing managed by your operating system", { p0: (snapshot.controlWrites ?? 0).toLocaleString(getLocale()) })
          : t("Computer → adapter {{p0}} packets · adapter → computer {{p1}} packets", { p0: (snapshot.hostToAdapterPackets ?? 0).toLocaleString(getLocale()), p1: (snapshot.adapterToHostPackets ?? 0).toLocaleString(getLocale()) })}</p>
        <ul>{snapshot.channels.map(channel => <li key={channel.name} className={channel.subscribed ? "is-live" : ""}>
          <strong>{channel.name}</strong>
          <span>{channel.subscribed ? t("Listening") : t("Disconnected")} · {channel.notifications.toLocaleString(getLocale())}  {t("notifications ·")} {channel.receivedBytes.toLocaleString(getLocale())}  {t("bytes")}</span>
        </li>)}</ul>
      </details> : null}
      <p className="watch-menu-hint">{snapshot.connected && snapshot.systemBind === "authenticated"
        ? t("The watch accepted a fresh COROS authentication challenge from CorosLink.")
        : t("Sign in to the COROS account paired with this watch, then connect. CorosLink gets your watch account key from that sign-in.")}</p>
    </div>
  );
}
