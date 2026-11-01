import { t, useLanguage, getLocale } from "../i18n/tools";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, FolderOpen, ListMusic, ListPlus, Loader2, Podcast, RefreshCw, Square, Upload, Wifi } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosWifiMusicOptions, CorosWifiMusicStatus } from "../../electron/corosWifiMusicTypes";
import type { NeteaseToolboxState } from "../../electron/corosWatchToolbox";
import { NETEASE_MAX_SONGS, WIFI_MUSIC_MAX_FILES } from "../../electron/corosWifiMusicTypes";
import { formatBytes } from "./libraryUtils";
import { normalizeMusicFileName } from "../../electron/musicFileNames";
import { neteasePlaylistRows } from "./CorosNeteasePlaylists";
import { publishWatchMusicInventory, updateNeteasePlaylistLabels, updateNeteaseSend, useNeteaseAddSlot, useNeteasePlaylistLabels, useNeteaseSend, useWatchMusicInventory } from "./watchMusicInventoryStore";

const ACTIVE = new Set(["choosing", "preparing", "waiting", "downloading", "restoring"]);
const message = (cause: unknown) => cause instanceof Error
  ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : t("Could not send audio over Wi-Fi.");

export function CorosWifiMusicPanel({ api, otherBusy, onBusyChange, library }: {
  api: CorosLinkApi;
  otherBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  /** filePaths: id → local path, to skip songs a NetEase playlist already has. */
  library?: { allIds: string[]; selectedIds: string[]; filePaths?: Record<string, string> };
}) {
  useLanguage();
  const [status, setStatus] = useState<CorosWifiMusicStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toolbox, setToolbox] = useState<NeteaseToolboxState | "checking" | "showing" | "error">();
  const [toolboxError, setToolboxError] = useState("");
  const [reading, setReading] = useState(false);
  // Shared with the On-watch panel, where playlists are browsed, renamed and deleted.
  const playlists = useNeteasePlaylistLabels();
  const setPlaylists = updateNeteasePlaylistLabels;
  // The On-watch panel picks (or creates) the playlist; this panel adds library songs to it.
  const { destination, draft, selection } = useNeteaseSend();
  // The open playlist in the On-watch panel hosts the add-songs controls.
  const addSlot = useNeteaseAddSlot();
  const setDestination = (next: CorosWifiMusicOptions["destination"]) => updateNeteaseSend({ destination: next });
  const sentToDraft = useRef(false);
  const sharedInventory = useWatchMusicInventory();
  // Only this watch's read: the store outlives a watch switch until the Bluetooth panel clears it.
  const inventory = sharedInventory && (!sharedInventory.deviceName || !status?.deviceName || sharedInventory.deviceName === status.deviceName) ? sharedInventory : null;
  const playlistView = useMemo(() => neteasePlaylistRows(playlists, inventory, draft), [playlists, inventory, draft]);
  const openRow = selection?.kind === "draft" ? playlistView.rows.find(row => row.state === "draft")
    : selection ? playlistView.rows.find(row => row.id === selection.id) : undefined;
  const options: CorosWifiMusicOptions | undefined = destination !== "netease" ? undefined
    : openRow?.id ? { destination, playlistName: openRow.name, playlistId: openRow.id } : openRow ? { destination, playlistName: openRow.name } : undefined;
  const generation = useRef(0);
  // The panel is keyed by watch and unmounts on disconnect: a read never outlives its watch.
  useEffect(() => () => { generation.current++; publishWatchMusicInventory(null); updateNeteasePlaylistLabels(() => []); updateNeteaseSend(null); }, []);
  const sending = submitting || Boolean(status && ACTIVE.has(status.phase));
  const active = sending || reading;
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
  // NetEase songs are only reachable when NetEase is in the watch's Toolbox: check once it's chosen.
  const canCheckToolbox = destination === "netease" && Boolean(status?.ready) && !active && !otherBusy;
  useEffect(() => {
    if (!canCheckToolbox || toolbox !== undefined) return;
    const request = generation.current;
    setToolbox("checking"); setToolboxError("");
    api.getCorosNeteaseToolbox().then(state => { if (request === generation.current) setToolbox(state); },
      cause => { if (request === generation.current) { setToolbox("error"); setToolboxError(message(cause)); } });
  }, [api, canCheckToolbox, toolbox]);
  // Playlists CorosLink made on this watch (names are kept locally); refreshed after each NetEase send.
  const sentNetease = status?.phase === "complete" && status.destination === "netease";
  useEffect(() => {
    if (destination !== "netease" || !status?.ready || active || typeof api.getCorosNeteasePlaylists !== "function") return;
    const request = generation.current;
    api.getCorosNeteasePlaylists().then(rows => { if (request === generation.current) setPlaylists(current => {
      // Keep an optimistic row (a draft that just got its ID) until the saved list has it.
      const pending = current.filter(row => row.updatedAt && !rows.some(saved => saved.id === row.id) && Date.now() - row.updatedAt < 60_000);
      return [...rows, ...pending];
    }); }, () => undefined);
  }, [api, destination, status?.ready, active, sentNetease]);
  // The first send creates the draft playlist on the watch; open it by the ID the watch now uses.
  const createdId = status?.destination === "netease" && status.completedFiles > 0 && !sending ? status.playlistId : undefined;
  useEffect(() => {
    if (!createdId || !sentToDraft.current) return;
    sentToDraft.current = false;
    const name = status?.playlistName ?? draft ?? "CorosLink";
    setPlaylists(current => current.some(row => row.id === createdId) ? current : [...current, { id: createdId, name, updatedAt: Date.now() }]);
    updateNeteaseSend({ draft: null, selection: { kind: "playlist", id: createdId } });
  }, [createdId, status?.playlistName, draft]);
  // After songs reach a NetEase playlist (even a stopped queue's first batches), re-read the watch so the
  // open playlist lists them and the library marks them synced.
  const wasSending = useRef(false);
  useEffect(() => {
    const finished = wasSending.current && !sending;
    wasSending.current = sending;
    if (!finished || status?.destination !== "netease" || !status.completedFiles || otherBusy || typeof api.getCorosMusicInventory !== "function") return;
    const request = generation.current;
    setReading(true);
    api.getCorosMusicInventory().then(result => { if (request === generation.current) publishWatchMusicInventory(result); }, () => undefined)
      .finally(() => { if (request === generation.current) setReading(false); });
  }, [api, sending, status?.destination, status?.completedFiles, otherBusy]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => { onBusyChange(active); }, [active, onBusyChange]);

  async function perform(action: () => Promise<CorosWifiMusicStatus>) {
    if (otherBusy || active) return;
    const request = generation.current;
    sentToDraft.current = destination === "netease" && selection?.kind === "draft";
    setSubmitting(true); setError("");
    try { const result = await action(); if (request === generation.current) setStatus(result); }
    catch (cause) { if (request === generation.current) setError(message(cause)); }
    finally { if (request === generation.current) setSubmitting(false); }
  }
  async function showNetease() {
    if (otherBusy || active) return;
    const request = generation.current;
    setToolbox("showing"); setToolboxError("");
    try { const state = await api.showCorosNeteaseInToolbox(); if (request === generation.current) setToolbox(state); }
    catch (cause) { if (request === generation.current) { setToolbox("error"); setToolboxError(message(cause)); } }
  }
  if (!status?.supported) return null;
  const disabled = otherBusy || active;
  const sendDisabled = disabled || (destination === "netease" && !options);
  const progress = status.totalBytes ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : 0;
  const label = status.phase === "restoring" ? t("Restoring watch settings…")
    : status.phase === "waiting" && status.waitingFor === "screen" ? t("Press a button on the watch to close its download screen. The next batch starts right after.")
    : status.phase === "waiting" ? t("Waiting for the watch to become ready…")
    : status.phase === "downloading" ? t("Sending {{p0}}…", { p0: status.fileName ?? "MP3s" })
      : status.phase === "preparing" ? t("Preparing {{p0}}…", { p0: status.fileName ?? "MP3s" }) : t("Choose your MP3s…");
  const overLimit = Boolean(library && (library.allIds.length > WIFI_MUSIC_MAX_FILES || library.selectedIds.length > WIFI_MUSIC_MAX_FILES));
  const neteaseSongs = (ids: number) => playlistView.songCount === undefined ? 0 : Math.max(0, playlistView.songCount + ids - NETEASE_MAX_SONGS);
  // Adding to a NetEase playlist skips songs its last read already lists, so a retry after a stopped queue doesn't duplicate them.
  const inOpenPlaylist = new Set((openRow?.songs ?? []).flatMap(song => song.name ? [normalizeMusicFileName(song.name)] : []));
  const missing = (ids: string[]) => destination !== "netease" || !inOpenPlaylist.size || !library?.filePaths ? ids
    : ids.filter(id => !library.filePaths![id] || !inOpenPlaylist.has(normalizeMusicFileName(library.filePaths![id]!)));
  const selectedIds = missing(library?.selectedIds ?? []), allIds = missing(library?.allIds ?? []);
  const selectedCount = selectedIds.length, allCount = allIds.length;
  const alreadyThere = (library?.selectedIds.length || library?.allIds.length || 0) - (library?.selectedIds.length ? selectedCount : allCount);
  const progressBlock = sending ? <div className="ble-wifi-music-progress" role="status" aria-live="polite">
    <span>{label}</span>
    {status.batchCount && status.batchCount > 1 ? <small>{t("Batch {{p0}} of {{p1}}", { p0: status.batchIndex ?? 1, p1: status.batchCount })}</small> : null}
    {status.phase === "downloading" ? <><progress max={100} value={progress} aria-label={t("Audio transfer progress")} />
      <small>{formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)} · {status.completedFiles}  {t("of")} {status.totalFiles}  {t("files")}</small></> : null}
    {["preparing", "waiting", "downloading"].includes(status.phase) ? <button type="button" className="secondary-button compact-button"
      onClick={() => { const request = generation.current; void api.cancelCorosWifiMusicSync().catch(cause => {
        if (request === generation.current) setError(message(cause));
      }); }}><Square size={12} aria-hidden="true" />  {t("Cancel sync")}</button> : null}
  </div> : null;
  const resultBlock = sending ? null : <>
    {status.phase === "complete" ? <p className="ble-wifi-music-success" role="status">{status.destination === "netease"
      ? status.completedFiles === 1 ? t("Added 1 song to {{p0}}.", { p0: status.playlistName ?? "CorosLink" })
        : t("Added {{p0}} songs to {{p1}}.", { p0: status.completedFiles, p1: status.playlistName ?? "CorosLink" })
      : <>{t("Sent")} {status.completedFiles}  {t("file")}{status.completedFiles === 1 ? "" : "s"}  {t("to watch podcasts. Download settings restored.")}</>}</p> : null}
    {status.phase === "cancelled" ? <p role="status">{t("Audio sync cancelled.")}</p> : null}
    {["failed", "cancelled", "restore-required"].includes(status.phase) && status.completedFiles > 0 ? <p role="status">
      {t("{{p0}} of {{p1}} files were downloaded before the transfer stopped.", { p0: status.completedFiles, p1: status.totalFiles })}
    </p> : null}
  </>;
  // Inside an open playlist: add songs from the library (or other MP3s), with progress and the result in place.
  // The watch reports not-ready for the whole transfer (its settings are swapped until restored): keep the controls and progress in place.
  const neteaseAdd: ReactNode = destination === "netease" && (status.ready || sending) && openRow ? <>
    <div className="ble-wifi-music-actions">
      {library ? <>
        <button type="button" className="secondary-button compact-button netease-add-primary"
          disabled={sendDisabled || selectedCount === 0 || selectedCount > WIFI_MUSIC_MAX_FILES || neteaseSongs(selectedCount) > 0}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi(selectedIds, options))}>
          {sending ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ListPlus size={14} aria-hidden="true" />} {t("Add {{p0}} selected", { p0: selectedCount })}
        </button>
        <button type="button" className="secondary-button compact-button"
          disabled={sendDisabled || allCount === 0 || allCount > WIFI_MUSIC_MAX_FILES || neteaseSongs(allCount) > 0}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi(allIds, options))}>
          <Upload size={14} aria-hidden="true" /> {t("Add all {{p0}}", { p0: allCount })}
        </button>
      </> : null}
      <button type="button" className={library ? "text-button" : "secondary-button compact-button"} disabled={sendDisabled}
        onClick={() => void perform(() => api.sendCorosMusicOverWifi(options))}>
        {library ? null : <FolderOpen size={14} aria-hidden="true" />} {library ? t("Choose other MP3s") : t("Choose MP3s…")}</button>
    </div>
    {alreadyThere > 0 && !sending ? <p>{alreadyThere === 1 ? t("1 song is already in this playlist and is skipped.")
      : t("{{p0}} songs are already in this playlist and are skipped.", { p0: alreadyThere })}</p> : null}
    {neteaseSongs(selectedCount || allCount) > 0 ? <p role="alert">{t("The watch holds up to {{p0}} NetEase songs; {{p1}} more fit.", { p0: NETEASE_MAX_SONGS, p1: Math.max(0, NETEASE_MAX_SONGS - (playlistView.songCount ?? 0)) })}</p> : null}
    {overLimit ? <p role="alert">{t("Select up to 500 tracks per queue (1 GB total).")}</p> : null}
    {progressBlock}
    {reading ? <p role="status" className="netease-reading"><Loader2 size={13} className="spin" aria-hidden="true" /> {t("Reading…")}</p> : null}
    {sending || status.destination !== "netease" || (status.playlistId && status.playlistId !== openRow.id) ? null : <>
      {status.phase === "complete" ? <p className="ble-wifi-music-success" role="status"><CircleCheck size={14} aria-hidden="true" /> {status.completedFiles === 1
        ? t("Added 1 song to {{p0}}.", { p0: openRow.name }) : t("Added {{p0}} songs to {{p1}}.", { p0: status.completedFiles, p1: openRow.name })}</p> : null}
      {status.phase === "cancelled" ? <p role="status">{t("Audio sync cancelled.")}</p> : null}
      {["failed", "cancelled", "restore-required"].includes(status.phase) && status.completedFiles > 0 ? <p role="status">
        {t("{{p0}} of {{p1}} files were downloaded before the transfer stopped.", { p0: status.completedFiles, p1: status.totalFiles })}
      </p> : null}
    </>}
  </> : null;
  const inPlaylist = Boolean(addSlot && neteaseAdd);
  const toolboxStatus = destination === "netease" && status.ready ? <div className={`ble-wifi-music-toolbox${toolbox === "shown" ? " is-ready" : ""}`} role="status" aria-live="polite">
    {toolbox === "shown" ? <span title={t("The COROS app may remove NetEase from the Toolbox when it syncs; show it again here if it does.")}>
        <CircleCheck size={14} aria-hidden="true" /> {t("NetEase is in the watch’s Toolbox.")}</span>
      : toolbox === "hidden" ? <span>{t("NetEase is hidden in the watch’s Toolbox. Show it again from the Toolbox settings on the watch.")}</span>
      : toolbox === "missing" || toolbox === "showing" ? <>
        <span>{t("NetEase isn’t in the watch’s Toolbox.")}</span>
        <button type="button" className="secondary-button compact-button" disabled={disabled || toolbox === "showing"} onClick={() => void showNetease()}>
          {toolbox === "showing" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ListMusic size={14} aria-hidden="true" />} {t("Show NetEase on watch")}
        </button></>
      : toolbox === "error" ? <>
        <span>{toolboxError || t("Couldn’t check the watch’s Toolbox.")}</span>
        <button type="button" className="secondary-button compact-button" disabled={disabled} onClick={() => setToolbox(undefined)}>
          <RefreshCw size={14} aria-hidden="true" /> {t("Check again")}</button></>
      : <span><Loader2 size={14} className="spin" aria-hidden="true" /> {t("Checking the watch’s Toolbox…")}</span>}
  </div> : null;
  return <div className="ble-wifi-music" aria-label={t("Wi-Fi audio sync")}>
    <div className="ble-wifi-music-heading">
      <span className="ble-wifi-music-title"><Wifi size={15} aria-hidden="true" /> {t("Send audio over Wi-Fi")}</span>
      <div className="ble-wifi-music-destination">
        <div className="ble-wifi-music-choices" role="radiogroup" aria-label={t("Watch destination")}>
          {([["podcasts", Podcast, t("Podcasts"), t("Listed under Podcasts on the watch.")],
            ["netease", ListMusic, t("NetEase playlist"), t("Your MP3s in a playlist in the watch’s NetEase player.")]] as const).map(([value, Icon, title, hint]) =>
            <label key={value} title={hint} className={`ble-wifi-music-choice${destination === value ? " is-selected" : ""}`}>
              <input type="radio" name="wifi-destination" value={value} checked={destination === value} disabled={disabled}
                onChange={() => setDestination(value)} />
              <Icon size={14} aria-hidden="true" /> {title}
            </label>)}
        </div>
      </div>
      {status.ready && !library && destination === "podcasts" ? <button type="button" className="secondary-button compact-button" disabled={sendDisabled}
        onClick={() => void perform(() => api.sendCorosMusicOverWifi(options))}>
        {sending ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} {t("Send MP3s")}
      </button> : null}
      {toolbox === "shown" && toolboxStatus}
    </div>
    {toolboxStatus && toolbox !== "shown" ? <div className="ble-wifi-music-netease">{toolboxStatus}</div> : null}
    {destination === "netease" && (status.ready || sending) ? <p className={`netease-target${addSlot && openRow ? "" : " is-empty"}`}>{addSlot && openRow
      ? <><ListMusic size={14} aria-hidden="true" /> {t("Adding to")} <strong>{openRow.name}</strong></> : t("Open a playlist under On watch to add songs.")}</p> : null}
    {addSlot && neteaseAdd ? createPortal(<div className="netease-send">{neteaseAdd}</div>, addSlot) : null}
    {destination === "podcasts" && library && status.ready ? <div className="ble-wifi-music-library">
      <div className="ble-wifi-music-actions">
        <button type="button" className="secondary-button compact-button"
          disabled={sendDisabled || library.selectedIds.length === 0 || library.selectedIds.length > WIFI_MUSIC_MAX_FILES}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi([...library.selectedIds], options))}>
          <Wifi size={14} aria-hidden="true" />  {t("Send selected over Wi-Fi (")}{library.selectedIds.length})
        </button>
        <button type="button" className="secondary-button compact-button"
          disabled={sendDisabled || library.allIds.length === 0 || library.allIds.length > WIFI_MUSIC_MAX_FILES}
          onClick={() => void perform(() => api.sendCorosLibraryMusicOverWifi([...library.allIds], options))}>
          <Upload size={14} aria-hidden="true" />  {t("Send all over Wi-Fi (")}{library.allIds.length})
        </button>
        <button type="button" className="text-button" disabled={sendDisabled}
          onClick={() => void perform(() => api.sendCorosMusicOverWifi(options))}>{t("Choose other MP3s")}</button>
      </div>
      {overLimit ? <p role="alert">{t("Select up to 500 tracks per queue (1 GB total).")}</p> : null}
    </div> : null}
    <div className="ble-wifi-music-footer">
    <p className="ble-wifi-music-hint">{destination === "netease"
      ? t("Same Wi-Fi needed. Your own MP3s play in the watch’s NetEase player: Toolbox → NetEase Music.")
      : t("Same Wi-Fi needed. Audio goes straight from this computer to the watch.")}</p>
    {inPlaylist ? null : progressBlock}
    {status.restorePending && !sending ? <div className="ble-wifi-music-recovery">
      <p>{t("The watch’s download settings need restoration before another transfer.")}</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.restoreCorosWifiMusicSettings())}>{t("Restore watch settings")}</button>
    </div> : !status.ready && !sending ? <div className="ble-wifi-music-setup">
      <p>{t("Import a settings backup once to prepare Wi-Fi sync.")}</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.importCorosWifiMusicBackup())}>{t("Import settings backup")}</button>
    </div> : null}
    {status.ready && !sending ? <details className="ble-wifi-music-backup"><summary>{t("Wi-Fi settings backup")}</summary>
      <p>{status.backupSavedAt ? t("Saved {{p0}}. ", { p0: new Date(status.backupSavedAt).toLocaleString(getLocale()) }) : ""}{t("This backup is reused for this watch and account. Update it after changing your COROS account, region or watch download settings.")}</p>
      <button type="button" className="secondary-button compact-button" disabled={disabled}
        onClick={() => void perform(() => api.importCorosWifiMusicBackup())}>{t("Update settings backup")}</button>
    </details> : null}
    </div>
    {inPlaylist ? null : resultBlock}
    {error || status.error ? <p className="ble-music-error" role="alert">{error || status.error}</p> : null}
  </div>;
}
