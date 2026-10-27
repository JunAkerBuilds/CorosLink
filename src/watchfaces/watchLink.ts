import { t, formatNumber } from "../i18n/watchfacesLocale";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type {
  CorosDirectWatchfaceInventory, CorosDirectWatchfacePreview, CorosDirectWatchfaceStatus
} from "../../electron/corosBleWatchfaceTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { connectedWatchfaceTarget, getWatchfaceTarget, isValidatedWatch, type WatchfaceTarget } from "../../electron/watchfaceTargets";

/** The connected watch, when CorosLink supports it (from its model number, else its name). */
export function connectedWatch(snapshot: CorosNativeBleSnapshot | null): WatchfaceTarget | undefined {
  if (!snapshot?.connected) return undefined;
  // Main reports it; work it out here too for a snapshot from before it did.
  return getWatchfaceTarget(snapshot.watchModel) ?? connectedWatchfaceTarget(snapshot)?.target;
}

/** The computer's own Bluetooth (Mac, Windows or Linux); the USB adapter only syncs routes. */
const SYSTEM_TRANSPORTS = new Set<CorosNativeBleSnapshot["transport"]>(["corebluetooth", "winrt", "bluez"]);
export function onSystemBluetooth(snapshot: CorosNativeBleSnapshot | null): boolean {
  return SYSTEM_TRANSPORTS.has(snapshot?.transport);
}

/** Messages need an authenticated, supported COROS watch on the computer's Bluetooth. */
export function watchMessagingReady(snapshot: CorosNativeBleSnapshot | null): boolean {
  // While connecting, the link is already up and signed in but CorosLink is still
  // setting the clock and sending weather; the watch takes nothing else until then.
  return Boolean(snapshot?.connected && snapshot.systemBind === "authenticated" &&
    snapshot.phase !== "connecting" && snapshot.phase !== "scanning" &&
    onSystemBluetooth(snapshot) && connectedWatch(snapshot));
}

/** Direct face sync has the same needs; it was verified on PACE Pro firmware 3.2008.0 and is beta elsewhere. */
export function watchFaceSyncReady(snapshot: CorosNativeBleSnapshot | null): boolean {
  return watchMessagingReady(snapshot);
}

/**
 * Every Bluetooth feature was checked on PACE Pro 3.2008.0. Other watches (and other PACE Pro
 * firmware) are open as beta; this says so where they are used.
 */
export function watchBetaNote(snapshot: CorosNativeBleSnapshot | null): string | null {
  const watch = connectedWatch(snapshot);
  if (!watch) return null;
  // Transfers were checked over Mac Bluetooth; the Windows and Linux worker sends the same bytes.
  const platform = snapshot?.transport === "winrt" ? "Windows" : snapshot?.transport === "bluez" ? "Linux" : null;
  if (snapshot?.watchValidated ?? isValidatedWatch(snapshot)) {
    return platform ? t("Watch transfers over {{platform}} Bluetooth are in beta: they were tested over Mac Bluetooth. Check the result on the watch.", { platform }) : null;
  }
  return watch.model === "pace-pro"
    ? t("CorosLink was tested on PACE Pro firmware 3.2008.0. On firmware {{firmware}} it is in beta, so check the result on the watch.", { firmware: watchFirmware(snapshot) ?? t("this version") })
    : t("{{watch}} support is in beta: CorosLink was tested on PACE Pro. Check the result on the watch, and tell us what you see.", { watch: watch.label });
}

/** Whether this computer's own Bluetooth can reach a COROS watch. */
export function watchLinkSupported(snapshot: CorosNativeBleSnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.backends ? snapshot.backends.some(item => item.id === "system" && item.available) : snapshot.available;
}

export type WatchLinkTone = "ok" | "busy" | "warn" | "off" | "error";

/** One status label for the link, shared by the toolbar watch menu and the On watch tab. */
export function watchConnectionState(snapshot: CorosNativeBleSnapshot | null): { tone: WatchLinkTone; label: string } {
  if (!snapshot) return { tone: "off", label: t("Not connected") };
  if (snapshot.phase === "scanning") return { tone: "busy", label: t("Finding watch…") };
  if (snapshot.phase === "connecting") return { tone: "busy", label: t("Connecting…") };
  if (snapshot.connected) {
    if (snapshot.systemBind === "authenticated") return { tone: "ok", label: t("Connected") };
    if (snapshot.systemBind === "authenticating") return { tone: "busy", label: t("Authenticating…") };
    return { tone: "warn", label: snapshot.systemBind === "failed" ? t("Authentication failed") : t("Sign-in needed") };
  }
  return snapshot.phase === "failed" ? { tone: "error", label: t("Connection failed") } : { tone: "off", label: t("Not connected") };
}

/** "COROS PACE Pro 2F1A6C" → "COROS PACE Pro": the advertised suffix only tells watches apart. */
export function watchDisplayName(deviceName: string | undefined, fallback = "COROS watch"): string {
  return deviceName?.trim().replace(/\s+[0-9A-F]{4,8}$/i, "") || t(fallback);
}

/** Firmware without the watch's "V " prefix. */
export function watchFirmware(snapshot: CorosNativeBleSnapshot | null): string | undefined {
  return (snapshot?.softwareRevision || snapshot?.firmwareRevision)?.replace(/^V\s*/i, "") || undefined;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  return t((error instanceof Error ? error.message : fallback).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? t("{{size}} MB", { size: formatNumber(bytes / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : t("{{size}} KB", { size: formatNumber(Math.max(1, Math.round(bytes / 1024))) });
}

/** "Compiled in 0.3 s": how long CorosLink's compiler took for this BIN. */
export function compileSummary(preview: CorosDirectWatchfacePreview): string | null {
  if (!preview.compile) return null;
  const seconds = preview.compile.durationMs / 1000;
  const time = seconds < 10 ? `${formatNumber(seconds, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s` : `${formatNumber(Math.round(seconds))} s`;
  return t("Compiled in {{time}}", { time });
}

const FULL_COLOR_KEY = "coroslink.watchfaces.fullColorBins";

/**
 * Whether compiles keep images past 256 colors as full-color RGBA (AMOLED watches only).
 * A per-computer preference, off by default: the BIN grows, and the result is not yet
 * confirmed on every watch.
 */
export function useFullColorBins(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(FULL_COLOR_KEY) === "1"; } catch { return false; } });
  const update = useCallback((next: boolean) => {
    setOn(next);
    try { localStorage.setItem(FULL_COLOR_KEY, next ? "1" : "0"); } catch {}
  }, []);
  return [on, update];
}

/** Polls the Bluetooth link while mounted. */
export function useCorosWatchLink(api: CorosLinkApi, intervalMs = 2000) {
  const [snapshot, setSnapshot] = useState<CorosNativeBleSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof api.getCorosNativeBleStatus === "function";
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.getCorosNativeBleStatus();
        if (!disposed) { setSnapshot(next); setError(null); }
      } catch (caught) {
        if (!disposed) setError(apiErrorMessage(caught, "Could not read the watch connection."));
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), intervalMs);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, intervalMs, supported]);
  return { snapshot, setSnapshot, error };
}

export type WatchInstallStep = "compile" | "send" | "verify";

/**
 * Watch face slots and Bluetooth installation, shared by the hub's watch link
 * and Studio's Send dialog. Occupied slots are never chosen automatically.
 */
export function useWatchfaceInstaller(api: CorosLinkApi, ready: boolean, options: { disabled?: boolean; onBusy?: (busy: boolean) => void } = {}) {
  const [inventory, setInventory] = useState<CorosDirectWatchfaceInventory | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [status, setStatus] = useState<CorosDirectWatchfaceStatus>({ phase: "idle", sentBytes: 0, totalBytes: 0 });
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const attempted = useRef(false);
  const onBusy = useRef(options.onBusy);
  onBusy.current = options.onBusy;
  const available = typeof api.getCorosWatchfaceSlots === "function" && typeof api.syncCorosWatchface === "function";
  const target = inventory?.slots.find(item => item.slot === selectedSlot) ?? null;

  const begin = () => { active.current = true; onBusy.current?.(true); };
  const end = () => { active.current = false; onBusy.current?.(false); };

  function applyInventory(next: CorosDirectWatchfaceInventory) {
    setInventory(next);
    setSelectedSlot(next.slots.find(item => item.faceId === null)?.slot ?? null);
    setInventoryError(null);
  }

  const readSlots = useCallback(async () => {
    if (active.current || !ready || !available) return;
    begin(); setReading(true);
    try { applyInventory(await api.getCorosWatchfaceSlots()); }
    catch (caught) {
      setInventory(null); setSelectedSlot(null);
      setInventoryError(apiErrorMessage(caught, "Could not read the watch face slots."));
    } finally { setReading(false); end(); }
  }, [api, ready, available]);

  useEffect(() => {
    if (!ready) {
      attempted.current = false;
      setInventory(null); setSelectedSlot(null); setInventoryError(null);
    } else if (available && !options.disabled && !attempted.current) {
      attempted.current = true;
      void readSlots();
    }
  }, [ready, available, options.disabled, readSlots]);

  useEffect(() => {
    if (!transferring) return;
    let disposed = false;
    const timer = setInterval(() => {
      void api.getCorosWatchfaceSyncStatus().then(next => { if (!disposed && next.phase !== "idle") setStatus(next); }).catch(() => {});
    }, 400);
    return () => { disposed = true; clearInterval(timer); };
  }, [api, transferring]);

  /** Sends a prepared BIN to the selected slot. Resolves true when the watch accepted it. */
  async function install(preview: CorosDirectWatchfacePreview, alreadyActive = false): Promise<boolean> {
    if ((!alreadyActive && active.current) || !ready || !inventory || !target) return false;
    if (!alreadyActive) begin();
    setTransferring(true); setError(null);
    setStatus({ phase: "preparing", name: preview.name, sentBytes: 0, totalBytes: preview.bytes });
    let complete = false;
    try {
      const final = await api.syncCorosWatchface(preview.id, {
        inventoryId: inventory.id, slot: target.slot, replaceExisting: target.faceId !== null
      });
      setStatus(final);
      complete = final.phase === "complete";
    } catch (caught) {
      setStatus({ phase: "failed", name: preview.name, sentBytes: 0, totalBytes: preview.bytes });
      setError(apiErrorMessage(caught, "Could not install the watch face."));
    } finally {
      setTransferring(false);
      // Face IDs changed (or the attempt failed): re-read before the next install.
      try { applyInventory(await api.getCorosWatchfaceSlots()); }
      catch (caught) {
        setInventory(null); setSelectedSlot(null);
        setInventoryError(apiErrorMessage(caught, "Refresh slots before installing again."));
      }
      if (!alreadyActive) end();
    }
    return complete;
  }

  function cancel() {
    void api.cancelCorosWatchfaceSync().catch(caught => setError(apiErrorMessage(caught, "Could not cancel the transfer.")));
  }

  return {
    available, inventory, selectedSlot, target, reading, transferring, status, error, inventoryError,
    busy: () => active.current, begin, end, setError,
    /** Choosing a destination starts over: the last result no longer describes it. */
    select: (slot: number) => { setSelectedSlot(slot); setError(null); setStatus({ phase: "idle", sentBytes: 0, totalBytes: 0 }); },
    resetStatus: () => setStatus({ phase: "idle", sentBytes: 0, totalBytes: 0 }),
    readSlots, install, cancel
  };
}
export type WatchfaceInstaller = ReturnType<typeof useWatchfaceInstaller>;
