import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Upload, Wifi } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosWifiMusicStatus } from "../../electron/corosWifiMusicTypes";
import { formatBytes } from "./libraryUtils";

const ACTIVE = new Set(["choosing", "preparing", "downloading", "restoring"]);
const message = (cause: unknown) => cause instanceof Error
  ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : "Could not send audio over Wi-Fi.";

export function CorosWifiMusicPanel({ api, otherBusy, onBusyChange, library }: {
  api: CorosLinkApi;
  otherBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  library?: { allIds: string[]; selectedIds: string[] };
}) {
  const [status, setStatus] = useState<CorosWifiMusicStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const active = submitting || Boolean(status && ACTIVE.has(status.phase));
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try { const result = await api.getCorosWifiMusicStatus(); if (alive) setStatus(result); }
      catch (cause) { if (alive) setError(message(cause)); }
      if (alive) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [api]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { onBusyChange(active); }, [active, onBusyChange]);

  async function perform(action: () => Promise<CorosWifiMusicStatus>) {
    if (otherBusy || active) return;
    const request = generation.current;
    setSubmitting(true); setError("");
    try { const result = await action(); if (request === generation.current) setStatus(result); }
    catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { if (request === generation.current) setSubmitting(false); }
  }
  if (!status?.supported) return null;
  const disabled = otherBusy || active;
  const progress = status.totalBytes ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : 0;
  const label = status.phase === "restoring" ? "Restoring watch settings…"
    : status.phase === "downloading" ? `Sending ${status.fileName ?? "MP3s"}…`
      : status.phase === "preparing" ? `Preparing ${status.fileName ?? "MP3s"}…` : "Choose your MP3s…";
  return <div className="ble-wifi-music" aria-label="Wi-Fi audio sync">
    <div className="ble-wifi-music-heading"><span><Wifi size={15} aria-hidden="true" /> Send audio over Wi-Fi</span>
      {status.ready ? <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.sendCorosMusicOverWifi())}>
        {active ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} {library ? "Choose other MP3s" : "Send MP3s"}
      </button> : null}
    </div>
    <p>Keep the watch and computer on the same Wi-Fi. Files appear in <strong>Podcasts</strong> on the watch.</p>
    {library && status.ready ? <div className="ble-wifi-music-library">
      <div className="ble-wifi-music-actions">
        <button type="button" className="secondary-button compact-button"
          disabled={disabled || library.selectedIds.length === 0 || library.selectedIds.length > 20}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi([...library.selectedIds]))}>
          <Wifi size={14} aria-hidden="true" /> Send selected over Wi-Fi ({library.selectedIds.length})
        </button>
        <button type="button" className="secondary-button compact-button"
          disabled={disabled || library.allIds.length === 0 || library.allIds.length > 20}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi([...library.allIds]))}>
          <Upload size={14} aria-hidden="true" /> Send all over Wi-Fi ({library.allIds.length})
        </button>
      </div>
      <p>{library.allIds.length > 20 || library.selectedIds.length > 20
        ? "Select up to 20 library tracks per Wi-Fi transfer."
        : "Select downloaded tracks, or send all. The Synced label refers to USB music."}</p>
    </div> : null}
    {active ? <div className="ble-wifi-music-progress" role="status" aria-live="polite">
      <span>{label}</span>
      {status.phase === "downloading" ? <><progress max={100} value={progress} aria-label="Audio transfer progress" />
        <small>{formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)} · {status.completedFiles} of {status.totalFiles} files</small></> : null}
      {["preparing", "downloading"].includes(status.phase) ? <button type="button" className="secondary-button compact-button"
        onClick={() => { const request = generation.current; void api.cancelCorosWifiMusicSync().catch(cause => {
          if (request === generation.current) setError(message(cause));
        }); }}><Square size={12} aria-hidden="true" /> Cancel sync</button> : null}
    </div> : null}
    {status.restorePending && !active ? <div className="ble-wifi-music-recovery">
      <p>The watch’s download settings need restoration before another transfer.</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.restoreCorosWifiMusicSettings())}>Restore watch settings</button>
    </div> : !status.ready && !active ? <div className="ble-wifi-music-setup">
      <p>{status.backupSavedAt
        ? `The settings backup from ${new Date(status.backupSavedAt).toLocaleString()} is more than a day old. Import a current one to send audio.`
        : "A current settings backup is needed to prepare Wi-Fi sync."}</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.importCorosWifiMusicBackup())}>Import settings backup</button>
    </div> : null}
    {status.ready && !active ? <details className="ble-wifi-music-backup"><summary>Wi-Fi settings backup</summary>
      <p>{status.backupSavedAt ? `Saved ${new Date(status.backupSavedAt).toLocaleString()}. ` : ""}A backup is used for a day. Update it sooner after changing your COROS account, region or watch download settings.</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.importCorosWifiMusicBackup())}>Update settings backup</button>
    </details> : null}
    {status.phase === "complete" && !active ? <p className="ble-wifi-music-success" role="status">Sent {status.completedFiles} file{status.completedFiles === 1 ? "" : "s"} to watch podcasts. Download settings restored.</p> : null}
    {status.phase === "cancelled" && !active ? <p role="status">Audio sync cancelled.</p> : null}
    {error || status.error ? <p className="ble-music-error" role="alert">{error || status.error}</p> : null}
  </div>;
}
