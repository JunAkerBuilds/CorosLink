import { t, useLanguage, getLocale, formatDate, formatNumber } from "../i18n/tools";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle, BatteryMedium, Bluetooth, ChevronDown, ChevronLeft, ChevronRight, Download, Info, KeyRound, LayoutGrid, Loader2,
  MessageSquare, RefreshCw, RotateCw, Search, Send, Settings, Smartphone, Unplug, Upload, Usb, Watch, type LucideIcon
} from "lucide-react";
import type { CorosWatchKeySummary, CorosWatchfaceStatus, WatchStatus } from "../../electron/types";
import type { CorosNativeBleDeviceChoice, CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { formatBytes } from "../media/libraryUtils";
import { CorosPhonePairingPanel } from "../watchfaces/CorosPhonePairingPanel";
import {
  apiErrorMessage, connectedWatch, onSystemBluetooth, watchConnectionState, watchDisplayName, watchFirmware, watchLinkSupported, watchMessagingReady,
  type WatchLinkTone
} from "../watchfaces/watchLink";
import "../watchfaces/watchLink.css";
import "./watchConnection.css";
import { EXPERIMENTAL_SYNC_MODELS } from "../../electron/localSync/watchSyncModels";
import { WatchAutoSyncControl } from "./WatchAutoSyncControl";
import { WatchSyncResult } from "./WatchSyncResult";
import { runWatchSync, useWatchSync } from "./watchSyncState";

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
  /** Opens a section of Settings ("watch", "weather"). */
  onOpenSettings?: (section: "watch" | "weather") => void;
  /** Local-Only Mode: the Training Hub shows what a watch sync reads, so the menu offers one. */
  localOnly?: boolean;
  /** Set when another view asks for "Sync watch now": the menu opens and starts it. */
  syncRequest?: number | null;
  onSyncRequestHandled?: () => void;
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
    // Tabbing past the panel closes it, as a click outside does; leaving the window doesn't.
    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !containerRef.current?.contains(next)) onOpenChange(false);
    };
    const container = containerRef.current;
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    container?.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      container?.removeEventListener("focusout", handleFocusOut);
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
  id, api, snapshot, onSnapshotChange, usbWatch, onOpenChange, onOpenWatchFaces, onSignIn, onOpenSettings, localOnly, syncRequest, onSyncRequestHandled
}: WatchConnectionMenuProps & { id: string }) {
  useLanguage();
  const [page, setPage] = useState<WatchMenuPage>("home");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The sync and its result belong to the window, so closing the menu mid-sync loses nothing.
  const watchSync = useWatchSync(api);
  const syncing = watchSync.manual || watchSync.reading;
  const syncPercent = watchSync.percent;
  const [choosing, setChoosing] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<CorosNativeBleDeviceChoice | undefined>();
  const [watchKeySaved, setWatchKeySaved] = useState<boolean | null>(null);
  const [watchKey, setWatchKey] = useState<CorosWatchKeySummary | undefined>();
  const panelRef = useRef<HTMLDivElement>(null);
  const applyKeyStatus = (status: CorosWatchfaceStatus) => {
    setWatchKeySaved(Boolean(status.watchAuthenticationAvailable));
    setWatchKey(status.watchKey);
  };
  const shownPage = useRef<WatchMenuPage | null>(null);

  useEffect(() => {
    if (typeof api?.getCorosWatchfaceStatus !== "function") return;
    let disposed = false;
    void api.getCorosWatchfaceStatus()
      .then(status => { if (!disposed) applyKeyStatus(status); })
      .catch(() => {});
    return () => { disposed = true; };
    // A watch sign-in updates when the key was last used.
  }, [api, snapshot?.systemBind, snapshot?.authenticatedAt]);

  // Opening focuses the panel; a sub-page focuses Back, and Back returns to the row that opened it.
  useEffect(() => {
    const previous = shownPage.current;
    shownPage.current = page;
    if (previous === page) return;
    if (previous === null) panelRef.current?.focus();
    else panelRef.current?.querySelector<HTMLElement>(page === "home" ? `.watch-menu-row[data-page="${previous}"]` : ".watch-menu-back")?.focus();
  }, [page]);

  const supported = Boolean(api && typeof api.connectCorosNativeBle === "function" && watchLinkSupported(snapshot));
  const connected = Boolean(snapshot?.connected);
  const state = watchConnectionState(snapshot);
  const linking = snapshot?.phase === "connecting" || snapshot?.phase === "scanning";
  const disabled = busy || linking || watchSync.manual;
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
    // Several watches with one name: the remembered one is chosen, never another automatically.
    setSelectedDevice(current => nearby.find(item => item.deviceId === current?.deviceId) ?? nearby.find(item => item.remembered)
      ?? (nearby.length === 1 ? nearby[0] : undefined));
    return found;
  }

  async function connectWatch(): Promise<CorosNativeBleSnapshot> {
    // Always the computer's own Bluetooth; this replaces a saved USB-adapter choice.
    if (choosing && selectedDevice) return api!.connectCorosNativeBle({ backend: "system", device: selectedDevice });
    try {
      return await api!.connectCorosNativeBle({ backend: "system" });
    } catch (error) {
      // Nothing remembered yet: find the watch instead of asking the user to.
      if (!/find and select/i.test(apiErrorMessage(error, ""))) throw error;
    }
    return findWatches(true);
  }

  const connect = () => run(connectWatch);

  /** Connects first when needed, then reads activities and health history; the watch stays connected. */
  const sync = () => run(async () => {
    await runWatchSync(api!, connected ? undefined : async () => {
      const linked = await connectWatch();
      onSnapshotChange(linked);
      // Several watches nearby, or the watch needs a sign-in: stop here; the panel shows what to do.
      return linked.connected && linked.systemBind === "authenticated";
    });
    return api!.getCorosNativeBleStatus();
  });

  // Progress shows on the button that started it: during a sync, Connect stays put
  // and the Sync button reports finding, connecting, then syncing.
  const phaseLabel = snapshot?.phase === "scanning" ? t("Finding watch…") : snapshot?.phase === "connecting" ? t("Connecting…") : null;
  const connecting = !syncing && (busy || linking);
  const syncLabel = !syncing ? t("Sync watch now")
    : connected ? syncPercent === null ? t("Syncing…") : t("Syncing… {{p0}}%", { p0: syncPercent })
    : phaseLabel ?? t("Connecting…");
  // A watch that is not signed in cannot sync, nor can one without a saved watch key; the callout above asks for the sign-in.
  const syncBlocked = connected ? snapshot?.systemBind !== "authenticated" : watchKeySaved === false || (choosing && !selectedDevice);
  // Connected before (the key signed in to a watch, or the last connection left its name): no first-time pairing hint.
  const pairedBefore = watchKeySaved !== false && Boolean(watchKey?.lastUsed || snapshot?.deviceName || snapshot?.identityMismatch);
  // Only in Local-Only Mode, and not for a connected watch whose sync files haven't been checked.
  const offerSync = Boolean(localOnly) && !(connected && snapshot?.watchModel && !EXPERIMENTAL_SYNC_MODELS.has(snapshot.watchModel));

  // Another view asked for a sync (the Training Hub before the first one): start it once the menu is open.
  const syncNow = useRef(sync);
  syncNow.current = sync;
  const canSync = supported && offerSync && !syncing && !disabled && !syncBlocked;
  useEffect(() => {
    if (!syncRequest) return;
    onSyncRequestHandled?.();
    if (canSync) void syncNow.current();
  }, [syncRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // In Local-Only Mode, Sync is the menu's one main button: it connects first when needed.
  const syncButton = (
    <button className={`primary-button watch-link-button watch-menu-sync-button${syncing ? " is-busy" : ""}`} type="button"
      disabled={disabled || syncing || syncBlocked} aria-describedby={syncBlocked && needsSignIn ? `${id}-sign-in` : undefined}
      onClick={() => void sync()}>
      {syncing ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
      {syncLabel}
      {syncing && syncPercent !== null ? <span className="watch-menu-sync-meter" style={{ width: `${syncPercent}%` }} aria-hidden="true" /> : null}
    </button>
  );

  const openWatchFaces = () => { onOpenChange(false); onOpenWatchFaces(); };
  const signIn = () => { onOpenChange(false); onSignIn(); };
  const openSettings = (section: "watch" | "weather") => { onOpenChange(false); onOpenSettings?.(section); };

  const connectLabel = connecting ? phaseLabel ?? t("Connecting…")
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
        {onOpenSettings ? <button className="watch-link-icon-button" type="button"
          aria-label={t("Watch settings")} title={t("Watch settings")} onClick={() => openSettings("watch")}>
          <Settings size={15} aria-hidden="true" />
        </button> : null}
        {connected ? <button className="watch-link-icon-button" type="button" disabled={disabled}
          aria-label={t("Refresh battery and status")} title={t("Refresh battery and status")}
          onClick={() => void run(() => api!.refreshCorosNativeBle())}>
          <RotateCw size={14} className={busy && !syncing ? "spin" : undefined} aria-hidden="true" />
        </button> : null}
      </header>

      {!supported && snapshot !== null ? <p className="watch-menu-hint">
        {t("Bluetooth features need CorosLink’s watch link, which isn’t available on this computer. USB storage still works for music.")}</p> : null}

      {supported && needsSignIn ? <div className="watch-menu-callout" role={connected ? "alert" : undefined}>
        <KeyRound size={16} aria-hidden="true" />
        <div>
          <strong>{connected && snapshot?.systemBind === "failed" ? t("The watch didn’t accept this account") : t("Sign in to COROS")}</strong>
          <p id={`${id}-sign-in`}>{connected && snapshot?.systemBind === "failed" && snapshot.authenticationError ? snapshot.authenticationError
            : t("Your watch only trusts CorosLink after you sign in with the COROS account it’s paired to.")}</p>
        </div>
        <button className="secondary-button watch-link-button" type="button" onClick={signIn}>{t("Sign in")}</button>
      </div> : null}

      {/* Another device answered with the watch's name: nothing was sent to it until the user says so. */}
      {supported && !connected && snapshot?.identityMismatch ? <div className="watch-menu-callout is-identity" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        <div>
          <strong>{t("This doesn’t look like the watch you connected before.")}</strong>
          <div className="watch-menu-callout-actions">
            <button className="secondary-button watch-link-button" type="button" disabled={disabled}
              onClick={() => void run(() => api!.connectCorosNativeBle({ backend: "system", confirmIdentity: true }))}>{t("Connect anyway")}</button>
            <button className="watch-menu-text-button" type="button" disabled={disabled}
              onClick={() => void run(() => api!.disconnectCorosNativeBle())}>{t("Cancel")}</button>
          </div>
        </div>
      </div> : null}

      {/* While another device's answer waits for the user, the callout above is the only choice. */}
      {supported && !connected && !snapshot?.identityMismatch ? <div className="watch-menu-connect">
        {choosing && devices.length ? <fieldset className="watch-menu-devices" disabled={disabled}>
          <legend>{t("Watches nearby")}</legend>
          {devices.map(device => <label key={device.deviceId} className={selectedDevice?.deviceId === device.deviceId ? "is-selected" : undefined}>
            <input type="radio" name={`${id}-device`} value={device.deviceId}
              checked={selectedDevice?.deviceId === device.deviceId} onChange={() => setSelectedDevice(device)} />
            <Watch size={15} aria-hidden="true" />
            <span>{watchDisplayName(device.deviceName)}<small>{device.deviceName}</small></span>
          </label>)}
        </fieldset> : null}
        {offerSync ? syncButton : <button className={`primary-button watch-link-button watch-menu-connect-button${connecting ? " is-busy" : ""}`} type="button"
          disabled={disabled || (choosing && !selectedDevice)} onClick={() => void connect()}>
          {connecting ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Bluetooth size={15} aria-hidden="true" />}
          {connectLabel}
        </button>}
        {waitedSeconds >= 8 ? <p className="watch-menu-hint" role="status">
          {t("Still looking for your watch ·")} {Math.floor(waitedSeconds / 60)}:{String(waitedSeconds % 60).padStart(2, "0")}{t(". Wake it and open System → Pair Phone. CorosLink stops trying after about a minute.")}</p>
          : !pairedBefore ? <p className="watch-menu-hint">
          {t("First time? On the watch, open System → Pair Phone, then connect and accept the pairing prompt.")}</p> : null}
      </div> : null}

      {supported && connected && offerSync ? <div className="watch-menu-connect">
        {syncButton}
      </div> : null}

      {/* Results sit under the button that asked for them; a background sync reports here too. */}
      {offerSync && watchSync.last && !watchSync.manual ? <WatchSyncResult api={api} last={watchSync.last} disabled={disabled || syncing}
        onSync={() => void sync()} /> : null}
      {message || (snapshot?.phase === "failed" && snapshot.error) ? <p className="watch-link-note watch-menu-result is-error" role="alert">
        <AlertCircle size={15} aria-hidden="true" /><span>{message ?? snapshot?.error}</span></p> : null}

      {supported && offerSync && api ? <WatchAutoSyncControl api={api} disabled={disabled || syncing} /> : null}

      {supported ? <ul className="watch-menu-list" aria-label={t("Watch features")}>
        <MenuRow icon={LayoutGrid} title={t("Watch faces")} detail={t("Install and replace faces on the watch")} onClick={openWatchFaces} />
        <MenuRow page="message" icon={MessageSquare} title={t("Send a message")} detail={watchMessagingReady(snapshot) ? t("Appears as a notification on the watch") : t("Needs a connected, supported COROS watch")}
          onClick={() => setPage("message")} />
        <MenuRow page="iphone" icon={Smartphone} title={t("iPhone app")} detail={t("Pair C-LINK with a QR code")} onClick={() => setPage("iphone")} />
        <MenuRow page="details" icon={Info} title={t("Connection details")} detail={t("Firmware, signal and watch key")} onClick={() => setPage("details")} />
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
          <Unplug size={15} aria-hidden="true" />  {t("Disconnect")}</button> : <>
          {/* Sync connects first; this connects without syncing (for watch faces or a message). */}
          {offerSync && !snapshot?.identityMismatch ? <button className="watch-menu-text-button watch-menu-connect-only" type="button"
            disabled={disabled || (choosing && !selectedDevice)} onClick={() => void connect()}>
            {connecting ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Bluetooth size={14} aria-hidden="true" />} {connecting || (choosing && selectedDevice) ? connectLabel : t("Connect only")}
          </button> : null}
          <button className="watch-menu-text-button" type="button" disabled={disabled}
            onClick={() => void run(() => findWatches(false))}>
            <Search size={14} aria-hidden="true" /> {choosing ? t("Search again") : t("Choose a watch")}
          </button>
        </>}
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
          : <WatchConnectionDetails snapshot={snapshot} api={api} watchKeySaved={watchKeySaved} watchKey={watchKey}
            onWatchKeyStatus={applyKeyStatus} onSignIn={signIn}
            onChoosePlace={onOpenSettings ? () => openSettings("weather") : undefined} />}
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

/** Developer diagnostics show only when CorosLink runs with COROSLINK_SYNC_CAPTURE=1 (the flag behind the capture tools). */
function useDeveloperTools(api: CorosLinkApi | undefined): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof api?.getLocalDataOverview !== "function") return;
    let live = true;
    void api.getLocalDataOverview().then(overview => { if (live) setEnabled(Boolean(overview.captureEnabled)); }).catch(() => undefined);
    return () => { live = false; };
  }, [api]);
  return enabled;
}

function MenuRow({ icon: Icon, title, detail, onClick, page }: { icon: LucideIcon; title: string; detail: ReactNode; onClick: () => void; page?: WatchMenuPage }) {
  useLanguage();
  return (
    <li>
      <button className="watch-menu-row" type="button" data-page={page} onClick={onClick}>
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
 * The watch account key CorosLink saved at COROS sign-in. Signing out keeps it; Remove
 * deletes it (main asks to confirm), and a sign-in with another account replaces it.
 * It doesn't expire; it stops working once the watch is given another key.
 * Back up saves it encrypted with a passphrase; Restore reads such a file back (main
 * asks before replacing a different key). The passphrase is sent once and then cleared;
 * the key itself never reaches this page.
 */
function WatchKeySection({ api, saved, info, onStatus, onSignIn }: {
  api: CorosLinkApi | undefined; saved: boolean | null; info: CorosWatchKeySummary | undefined;
  onStatus: (status: CorosWatchfaceStatus) => void; onSignIn: () => void;
}) {
  useLanguage();
  const id = useId();
  const [working, setWorking] = useState<"remove" | "backup" | "choose" | "restore" | null>(null);
  const [form, setForm] = useState<"backup" | "restore" | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const canRemove = typeof api?.forgetCorosWatchKey === "function";
  const canBackUp = typeof api?.backupCorosWatchKey === "function";
  const canRestore = typeof api?.chooseCorosWatchKeyBackup === "function" && typeof api?.restoreCorosWatchKey === "function";
  const when = (at: number) => formatDate(at, { dateStyle: "medium", timeStyle: "short" });
  const tooShort = passphrase.length > 0 && passphrase.length < 8;
  const mismatch = form === "backup" && repeat.length > 0 && repeat !== passphrase;
  const clearPassphrases = () => { setPassphrase(""); setRepeat(""); };
  const closeForm = () => {
    if (form === "restore") void api?.cancelCorosWatchKeyRestore?.().catch(() => {});
    clearPassphrases(); setForm(null);
  };

  async function attempt(kind: NonNullable<typeof working>, task: () => Promise<void>, fallback: string) {
    if (working) return;
    setWorking(kind);
    setNote(null);
    try {
      await task();
    } catch (caught) {
      setNote({ error: true, text: apiErrorMessage(caught, fallback) });
    } finally {
      setWorking(null);
    }
  }

  const remove = () => attempt("remove", async () => { onStatus(await api!.forgetCorosWatchKey!()); }, t("Could not remove the watch key."));

  const backUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passphrase.length < 8 || repeat !== passphrase) return;
    const secret = passphrase;
    clearPassphrases();
    void attempt("backup", async () => {
      const result = await api!.backupCorosWatchKey!(secret);
      if (!result.saved) return;
      setForm(null);
      setNote({ error: false, text: t("Watch key backup saved.") });
    }, t("Could not back up the watch key."));
  };

  const choose = () => attempt("choose", async () => {
    clearPassphrases(); setForm(null);
    const choice = await api!.chooseCorosWatchKeyBackup!();
    if (choice.chosen) setForm("restore");
  }, t("Could not open the watch key backup."));

  const restore = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passphrase) return;
    const secret = passphrase;
    clearPassphrases();
    void attempt("restore", async () => {
      const result = await api!.restoreCorosWatchKey!(secret);
      onStatus(result.status);
      setForm(null);
      if (result.outcome === "restored") setNote({ error: false, text: t("Watch key restored.") });
      else if (result.outcome === "alreadySaved") setNote({ error: false, text: t("This watch key is already saved.") });
    }, t("Could not restore the watch key."));
  };

  const rows: Array<[string, string]> = info ? [
    [t("Account"), info.accountEmail ?? t("COROS account {{p0}}", { p0: info.accountId })],
    [t("Saved", undefined, "watchKey"), info.savedAt ? when(info.savedAt) : t("Unknown")],
    [t("Last used"), info.lastUsed ? `${watchDisplayName(info.lastUsed.watch)} · ${when(info.lastUsed.at)}` : "—"],
    [t("Key ID"), info.keyId]
  ] : [];
  const problem = info?.problem;
  const icon = (kind: NonNullable<typeof working>, Icon: LucideIcon) => working === kind
    ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />;

  return (
    <section className="watch-link-key" aria-label={t("Watch key")}>
      <h3>{t("Watch key")}</h3>
      {/* A key that no longer works leads with the problem, in place of the reassuring status line. */}
      {saved && problem ? <div className="watch-menu-callout" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        <div>
          <p>{problem.result === "mismatch"
            ? t("{{p0}} has a different key ({{p1}}). Sign in to COROS again to get the current one.", { p0: watchDisplayName(problem.watch), p1: when(problem.at) })
            : t("{{p0}} didn’t accept this key ({{p1}}). Connect the watch to the COROS app once, then sign in to COROS again.", { p0: watchDisplayName(problem.watch), p1: when(problem.at) })}</p>
        </div>
        <button className="secondary-button watch-link-button" type="button" onClick={onSignIn}>{t("Sign in")}</button>
      </div> : <p role="status">{saved === null ? t("Checking for a saved watch key…")
        : saved ? t("Saved on this computer. It doesn’t expire.")
        : t("Not saved. Sign in to COROS to authenticate with your watch.")}</p>}
      {saved && rows.length ? <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      {saved && !problem ? <p className="watch-menu-hint">{t("It stops working if you pair or reset your watch in the COROS app. Sign in here again to get the new key.")}</p> : null}
      {form === "backup" ? <form className="watch-link-key-form" aria-label={t("Back up watch key")} onSubmit={backUp}>
        <p>{t("Keep this file and passphrase safe: anyone with both can sign in to your watch. The passphrase can’t be recovered.")}</p>
        <label htmlFor={`${id}-passphrase`}>{t("Passphrase")}</label>
        <input id={`${id}-passphrase`} type="password" autoComplete="new-password" maxLength={1024} value={passphrase}
          aria-invalid={tooShort || undefined} aria-describedby={`${id}-rule`} disabled={working !== null}
          onChange={event => { setPassphrase(event.target.value); setNote(null); }} />
        <label htmlFor={`${id}-repeat`}>{t("Repeat passphrase")}</label>
        <input id={`${id}-repeat`} type="password" autoComplete="new-password" maxLength={1024} value={repeat}
          aria-invalid={mismatch || undefined} aria-describedby={`${id}-rule`} disabled={working !== null}
          onChange={event => { setRepeat(event.target.value); setNote(null); }} />
        <p id={`${id}-rule`} className={mismatch ? "watch-link-note is-error" : undefined}>
          {mismatch ? t("The passphrases don’t match.") : t("At least 8 characters")}</p>
        <div className="watch-link-key-actions">
          <button className="primary-button watch-link-button" type="submit" disabled={working !== null || passphrase.length < 8 || repeat !== passphrase}>
            {icon("backup", Download)}{t("Save backup…")}</button>
          <button className="secondary-button watch-link-button" type="button" disabled={working !== null} onClick={closeForm}>{t("Cancel")}</button>
        </div>
      </form> : null}
      {form === "restore" ? <form className="watch-link-key-form" aria-label={t("Restore watch key")} onSubmit={restore}>
        <label htmlFor={`${id}-restore`}>{t("Backup passphrase")}</label>
        <input id={`${id}-restore`} type="password" autoComplete="off" maxLength={1024} value={passphrase} disabled={working !== null}
          onChange={event => { setPassphrase(event.target.value); setNote(null); }} />
        <div className="watch-link-key-actions">
          <button className="primary-button watch-link-button" type="submit" disabled={working !== null || !passphrase}>
            {icon("restore", Upload)}{t("Restore")}</button>
          <button className="secondary-button watch-link-button" type="button" disabled={working !== null} onClick={closeForm}>{t("Cancel")}</button>
        </div>
      </form> : null}
      {saved !== null && form === null ? <div className="watch-link-key-actions">
        {saved && canBackUp ? <button className="secondary-button watch-link-button" type="button" disabled={working !== null}
          onClick={() => { setNote(null); clearPassphrases(); setForm("backup"); }}>
          <Download size={15} aria-hidden="true" />{t("Back up watch key")}</button> : null}
        {canRestore ? <button className="secondary-button watch-link-button" type="button" disabled={working !== null} onClick={() => void choose()}>
          {icon("choose", Upload)}{t("Restore watch key…")}</button> : null}
        {saved && canRemove ? <button className="secondary-button watch-link-button" type="button" disabled={working !== null} onClick={() => void remove()}>
          {icon("remove", KeyRound)}{t("Remove watch key")}</button> : null}
      </div> : null}
      {note ? <p className={`watch-link-note${note.error ? " is-error" : " is-success"}`} role={note.error ? "alert" : "status"}>{note.text}</p> : null}
    </section>
  );
}

function WatchConnectionDetails({ snapshot, api, watchKeySaved, watchKey: watchKeyInfo, onWatchKeyStatus, onSignIn, onChoosePlace }: {
  snapshot: CorosNativeBleSnapshot | null;
  api: CorosLinkApi | undefined;
  watchKeySaved: boolean | null;
  watchKey: CorosWatchKeySummary | undefined;
  onWatchKeyStatus: (status: CorosWatchfaceStatus) => void;
  onSignIn: () => void;
  onChoosePlace?: () => void;
}) {
  useLanguage();
  const developerTools = useDeveloperTools(api);
  const watchKey = <WatchKeySection api={api} saved={watchKeySaved} info={watchKeyInfo} onStatus={onWatchKeyStatus} onSignIn={onSignIn} />;
  if (!snapshot) return <div className="watch-link-details"><p className="watch-menu-hint">{t("Reading the watch connection…")}</p>{watchKey}</div>;
  const details = [
    [t("Battery"), snapshot.batteryPercent === undefined ? "—" : `${snapshot.batteryPercent}%`],
    [t("Model"), snapshot.modelNumber || "—"],
    [t("Recognized as"), connectedWatch(snapshot) ? connectedWatch(snapshot)!.label
      : snapshot.connected ? t("Not supported yet") : "—"],
    [t("Software"), watchFirmware(snapshot) || "—"],
    [t("Signal"), snapshot.connected && snapshot.rssiDbm !== undefined ? t("{{p0}} dBm", { p0: snapshot.rssiDbm }) : "—"],
    [t("Connection"), snapshot.connected ? "Bluetooth" : t("Disconnected")],
    [t("COROS session"), snapshot.connected && snapshot.systemBind === "authenticated" ? t("Authenticated")
      : snapshot.systemBind === "failed" ? t("Authentication failed") : t("Not authenticated")],
    [t("Clock"), snapshot.connected && snapshot.clockSetAt
      ? t("Set from this computer at {{p0}}", { p0: formatDate(new Date(snapshot.clockSetAt), { hour: "numeric", minute: "2-digit" }) })
      : "—"],
    [t("Weather"), snapshot.connected && snapshot.weatherSentAt
      ? t("Forecast sent at {{p0}}", { p0: formatDate(new Date(snapshot.weatherSentAt), { hour: "numeric", minute: "2-digit" }) })
      : snapshot.connected && snapshot.weatherFailedAt ? t("The watch didn't take the forecast this time. CorosLink sends it again next time the watch connects.")
      : snapshot.connected ? onChoosePlace
        ? <button type="button" className="watch-link-inline-button" onClick={onChoosePlace}>{t("Choose a place")}</button>
        : t("Choose a place in Settings → Weather location, or open the Overview once")
      : "—"],
    [t("Satellite data"), developerTools
      ? <>{satelliteData(snapshot.gpsAssistance, snapshot.connected)}<SatelliteDeveloperTools api={api} assist={snapshot.gpsAssistance} connected={snapshot.connected} /></>
      : satelliteData(snapshot.gpsAssistance, snapshot.connected)]
  ] satisfies Array<[string, ReactNode]>;
  // With the watch away, rows that would only read "—" are left out.
  const rows = snapshot.connected ? details : details.filter(([, value]) => value !== "—");
  return (
    <div className="watch-link-details">
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {watchKey}
      {/* Developer diagnostics: only with COROSLINK_SYNC_CAPTURE=1, like the capture tools in Privacy settings. */}
      {developerTools && onSystemBluetooth(snapshot) ? <section className="watch-link-events" aria-label={t("Watch controls")}>
        <h3>{t("Watch controls")}</h3>
        <p>{t("Press the watch’s phone music controls to see the commands it sends.")}</p>
        {snapshot.watchEvents?.length ? <ul>{snapshot.watchEvents.slice().reverse().map(event => <li key={event.id}>
          <time>{new Date(event.receivedAt).toLocaleTimeString(getLocale())}</time>
          {event.kind === "call-rejected" ? t("Call rejected") : t("Media command {{p0}}, value {{p1}}", { p0: event.action, p1: event.value })}
        </li>)}</ul> : <p>{t("No watch commands received in this connection.")}</p>}
      </section> : null}
      {developerTools && snapshot.channels.length ? <details className="watch-link-channels">
        <summary>{t("Live BLE channels")}</summary>
        <p>{snapshot.pairingManagedByOS ? t("{{p0}} COROS control writes · pairing managed by your operating system", { p0: formatNumber(snapshot.controlWrites ?? 0) })
          : t("Computer → adapter {{p0}} packets · adapter → computer {{p1}} packets", { p0: formatNumber(snapshot.hostToAdapterPackets ?? 0), p1: formatNumber(snapshot.adapterToHostPackets ?? 0) })}</p>
        <ul>{snapshot.channels.map(channel => <li key={channel.name} className={channel.subscribed ? "is-live" : ""}>
          <strong>{channel.name}</strong>
          <span>{channel.subscribed ? t("Listening") : t("Disconnected")} · {formatNumber(channel.notifications)}  {t("notifications ·")} {formatNumber(channel.receivedBytes)}  {t("bytes")}</span>
        </li>)}</ul>
      </details> : null}
      {/* Only when the watch needs a sign-in; a saved key with the watch away needs nothing more than connecting. */}
      {(snapshot.connected && snapshot.systemBind !== "authenticated") || (!snapshot.connected && watchKeySaved === false)
        ? <p className="watch-menu-hint">{t("Sign in to the COROS account paired with this watch, then connect.")}</p>
        : null}
    </div>
  );
}

/**
 * Developer only (COROSLINK_SYNC_CAPTURE=1): the raw bytes the satellite format is read from (bind
 * reply bytes 11–14, then settings type 13 once a sync has read it), and a test send that doesn't
 * wait for the usual rule. The send itself is refused in the main process without the flag.
 */
function SatelliteDeveloperTools({ api, assist, connected }: { api: CorosLinkApi | undefined; assist: CorosNativeBleSnapshot["gpsAssistance"]; connected: boolean }) {
  useLanguage();
  const [outcome, setOutcome] = useState<{ sending?: boolean; sent?: boolean; error?: string }>({});
  const send = api?.sendSatelliteDataNow;
  return (
    <small className="watch-menu-detail-sub">
      <code>{assist ? `${assist.raw || "—"}${assist.settingsRaw ? ` · ${assist.settingsRaw}` : ""}` : "—"}</code>{" "}
      {send ? <button type="button" className="watch-link-inline-button" disabled={!connected || outcome.sending} onClick={() => {
        setOutcome({ sending: true });
        void send().then(
          result => setOutcome(result.ok ? { sent: true } : { error: result.error ?? "—" }),
          error => setOutcome({ error: error instanceof Error ? error.message : String(error) }));
      }}>{outcome.sending ? t("Sending…") : t("Send satellite data now")}</button> : null}{" "}
      {outcome.sent ? t("Sent") : outcome.error ?? null}
    </small>
  );
}

/** When the watch's GPS assistance data runs out, as read on the last connection. */
function satelliteData(assist: CorosNativeBleSnapshot["gpsAssistance"], connected: boolean): ReactNode {
  // A reply in an unknown format, or a date far from today, wasn't read as expected: shown as no data (the bytes stay in the snapshot).
  const plausible = !assist?.validUntil || Math.abs(assist.validUntil - Date.now()) < 400 * 86_400_000;
  if (!assist || assist.format === "unknown" || !plausible) return "—";
  const until = assist.validUntil && formatDate(new Date(assist.validUntil), { dateStyle: "medium", timeStyle: "short" });
  const value = !assist.validUntil ? t("None on the watch")
    : assist.validUntil > Date.now() ? t("Valid until {{p0}}", { p0: until }) : t("Expired {{p0}}", { p0: until });
  // With the watch away it may have been updated since (by the COROS app, say), so say when this was read.
  return connected ? value : <>{value}<small className="watch-menu-detail-sub">{t("as read at the last connection")}</small></>;
}
