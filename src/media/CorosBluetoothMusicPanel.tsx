import { t, useLanguage } from "../i18n/tools";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bluetooth, Loader2, Music, Podcast, RefreshCw, Search, Trash2 } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosBleMusicInventory, CorosBleMusicTrack, CorosWirelessAudioTrack } from "../../electron/corosBleMusicTypes";
import { formatBytes } from "./libraryUtils";
import { CorosWifiMusicPanel } from "./CorosWifiMusicPanel";
import { publishWatchMusicInventory, updateNeteasePlaylistLabels, updateNeteaseSend, useNeteasePlaylistLabels, useNeteaseSend, useWatchMusicInventory } from "./watchMusicInventoryStore";
import { neteasePlaylistRows } from "./CorosNeteasePlaylists";
import { WatchNeteasePlaylists } from "./WatchNeteasePlaylists";

export function CorosBluetoothMusicPanel({ api, connection, onWifiBusyChange, onOperationBusyChange, showWifiMusic = true, wifiSyncBusy }: {
  api: CorosLinkApi | undefined;
  connection: CorosNativeBleSnapshot | null;
  onWifiBusyChange?: (busy: boolean) => void;
  onOperationBusyChange?: (busy: boolean) => void;
  showWifiMusic?: boolean;
  wifiSyncBusy?: boolean;
}) {
  useLanguage();
  // Shared with the NetEase playlists in the Wi-Fi panel, which can also read the watch.
  const shared = useWatchMusicInventory();
  const [inventory, setLocalInventory] = useState<CorosBleMusicInventory | null>(shared);
  const setInventory = (next: CorosBleMusicInventory | null) => { setLocalInventory(next); publishWatchMusicInventory(next); };
  useEffect(() => { if (shared) setLocalInventory(shared); }, [shared]);
  useEffect(() => { if (!connection?.connected) { setLocalInventory(null); publishWatchMusicInventory(null); } }, [connection?.connected]);
  // The read outlives switching to the USB view so the library keeps showing Wi-Fi songs as synced;
  // disconnecting (above) or the Wi-Fi panel unmounting on a watch change drops it.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [wifiBusy, setWifiBusy] = useState(false);
  const labels = useNeteasePlaylistLabels();
  const send = useNeteaseSend();
  // While Wi-Fi sends go to NetEase, this panel is where the target playlist is picked or created.
  const picking = send.destination === "netease";
  // NetEase playlist names live in CorosLink (the watch stores IDs): load them for this watch and after each read.
  useEffect(() => {
    if (!connection?.connected || typeof api?.getCorosNeteasePlaylists !== "function") return;
    let alive = true;
    api.getCorosNeteasePlaylists().then(rows => { if (alive) updateNeteasePlaylistLabels(current =>
      [...rows, ...current.filter(row => !rows.some(saved => saved.id === row.id))]); }, () => undefined);
    return () => { alive = false; };
  }, [api, connection?.connected, inventory]);
  const busy = loading || deleting !== null || wifiBusy || Boolean(wifiSyncBusy);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { onWifiBusyChange?.(wifiBusy); }, [wifiBusy, onWifiBusyChange]);
  const operationBusy = loading || deleting !== null;
  useEffect(() => { onOperationBusyChange?.(operationBusy); }, [operationBusy, onOperationBusyChange]);
  useEffect(() => () => onOperationBusyChange?.(false), [onOperationBusyChange]);

  async function readMusic() {
    if (!connection?.connected || !api?.getCorosMusicInventory || busy) return;
    const request = ++generation.current;
    setLoading(true); setError(""); setNotice(""); setInventory(null);
    try {
      const result = await api.getCorosMusicInventory();
      if (request === generation.current) setInventory(result);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error
        ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
        : t("Could not read the watch’s music."));
    } finally { if (request === generation.current) setLoading(false); }
  }

  async function deleteTrack(track: CorosBleMusicTrack) {
    if (!connection?.connected || !api?.deleteCorosMusicTrack || !inventory?.id || busy) return;
    const request = ++generation.current;
    setDeleting(track.watchPath); setError(""); setNotice("");
    try {
      const result = await api.deleteCorosMusicTrack({ inventoryId: inventory.id, watchId: track.watchId, watchPath: track.watchPath });
      if (request === generation.current) {
        setInventory(result.inventory);
        if (result.deleted) setNotice(t("Deleted “{{p0}}” from the watch.", { p0: track.name }));
      }
    } catch (cause) {
      if (request === generation.current) {
        setInventory(null);
        setError(cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
          : t("Could not delete this track. Refresh the watch’s music and try again."));
      }
    } finally { if (request === generation.current) setDeleting(null); }
  }

  async function deletePodcast(track: CorosWirelessAudioTrack) {
    if (track.destination !== "podcasts" || !connection?.connected || !api?.deleteCorosMusicTrack || !inventory?.id || busy) return;
    const request = ++generation.current;
    const key = `podcast:${track.id}`;
    setDeleting(key); setError(""); setNotice("");
    try {
      const result = await api.deleteCorosMusicTrack({ inventoryId: inventory.id, destination: "podcasts", id: track.id });
      if (request === generation.current) {
        setInventory(result.inventory);
        if (result.deleted) setNotice(t("Deleted “{{p0}}” from the watch.", { p0: track.name ?? track.id }));
      }
    } catch (cause) {
      if (request === generation.current) {
        setInventory(null);
        setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : t("Could not delete this track. Refresh the watch’s music and try again."));
      }
    } finally { if (request === generation.current) setDeleting(null); }
  }

  async function deleteNetease(playlistId: string, songs: CorosWirelessAudioTrack[], whole: boolean) {
    if (!connection?.connected || !api?.deleteCorosMusicTrack || !inventory?.id || busy || !songs.length) return;
    const request = ++generation.current;
    setDeleting(whole ? `netease-playlist:${playlistId}` : `netease:${songs[0]!.id}`); setError(""); setNotice("");
    try {
      const result = await api.deleteCorosMusicTrack({ inventoryId: inventory.id, destination: "netease", playlistId, songIds: songs.map(song => song.id) });
      if (request === generation.current) {
        setInventory(result.inventory);
        if (whole && result.deleted) updateNeteaseSend({ selection: null });
        if (result.deleted) setNotice(whole
          ? t("Deleted the NetEase playlist {{p0}} from the watch.", { p0: songs[0]?.playlistName ?? playlistId })
          : t("Deleted “{{p0}}” from the watch.", { p0: songs[0]!.name ?? songs[0]!.id }));
      }
    } catch (cause) {
      if (request === generation.current) {
        setInventory(null);
        setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : t("Could not delete this track. Refresh the watch’s music and try again."));
      }
    } finally { if (request === generation.current) setDeleting(null); }
  }

  async function renamePlaylist(id: string | undefined, name: string) {
    if (!id) { updateNeteaseSend({ draft: name }); return; }
    if (!api?.renameCorosNeteasePlaylist) return;
    setError("");
    try {
      const rows = await api.renameCorosNeteasePlaylist(id, name);
      updateNeteasePlaylistLabels(current => [...rows, ...current.filter(row => !rows.some(saved => saved.id === row.id))]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : t("Couldn’t rename the playlist."));
    }
  }

  async function deleteAll() {
    if (!connection?.connected || !api?.deleteAllCorosMusic || !inventory?.id || busy) return;
    const request = ++generation.current;
    setDeleting("all"); setError(""); setNotice("");
    try {
      const result = await api.deleteAllCorosMusic(inventory.id);
      if (request === generation.current) {
        setInventory(result.inventory ?? null);
        if (result.deletedCount) setNotice(t("Deleted {{p0}} tracks from the watch.", { p0: result.deletedCount }));
        if (result.error) setError(result.error);
      }
    } catch (cause) {
      if (request === generation.current) {
        setInventory(null);
        setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "") : t("Could not delete watch tracks. Refresh and try again."));
      }
    } finally { if (request === generation.current) setDeleting(null); }
  }

  const tracks = inventory?.tracks ?? [];
  const wirelessTracks = inventory?.wirelessTracks ?? [];
  const query = search.trim().toLocaleLowerCase();
  const visible = tracks.filter(track => track.name.toLocaleLowerCase().includes(query));
  const visibleWireless = wirelessTracks.filter(track => (track.name ?? track.id).toLocaleLowerCase().includes(query));
  const totalTracks = tracks.length + wirelessTracks.length;
  const podcasts = visibleWireless.filter(track => track.destination === "podcasts");
  const netease = neteasePlaylistRows(labels, inventory, send.draft);
  // Outside NetEase sends, only the playlists the watch has.
  const neteaseRows = netease.rows.filter(row => picking || row.state === "watch");
  const openPlaylist = Boolean(send.selection && neteaseRows.some(row => send.selection!.kind === "draft" ? row.state === "draft" : row.id === send.selection!.id));
  const neteaseSection = picking || neteaseRows.length ? <WatchNeteasePlaylists rows={neteaseRows} known={netease.known}
    playlistCount={netease.playlistCount} songCount={netease.songCount} picking={picking} busy={busy} deleting={deleting} query={query}
    onRename={api?.renameCorosNeteasePlaylist ? renamePlaylist : undefined}
    onDelete={api?.deleteCorosMusicTrack && inventory?.id ? (id, songs, whole) => void deleteNetease(id, songs, whole) : undefined} /> : null;
  if (!connection?.connected) return null;
  return <section className="library-panel library-panel--watch" aria-label={t("On watch")}>
    <header className="library-panel-header">
      <div><p className="eyebrow">{inventory?.deviceName ?? connection?.deviceName ?? t("COROS watch")}</p><h3>{t("On watch")}</h3></div>
      <em>{inventory ? t("{{p0}} track{{p1}}", { p0: totalTracks, p1: totalTracks === 1 ? "" : "s" }) : "Bluetooth"}</em>
    </header>
    <div className="ble-music-toolbar">
      <span className="ble-music-note"><Bluetooth size={14} aria-hidden="true" /> {t("Reads music, downloaded podcasts and NetEase playlists directly from the watch.")}</span>
      <button type="button" className="secondary-button compact-button" disabled={busy || !api?.getCorosMusicInventory} onClick={() => void readMusic()}>
        {loading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        {loading ? t("Reading…") : inventory ? t("Refresh music") : t("Read music")}
      </button>
    </div>
    {inventory?.wirelessError ? <p className="ble-music-error" role="alert">{t("Podcast inventory unavailable: {{p0}}", { p0: inventory.wirelessError })}</p> : null}
    {error ? <p className="ble-music-error" role="alert">{error}</p> : null}
    {notice ? <p className="ble-music-note" role="status">{notice}</p> : null}
    {deleting ? <p className="ble-music-note" role="status">{t("Waiting for confirmation, then deleting and checking the watch…")}</p> : null}
    {inventory ? <>
      <div className="library-panel-tools"><div className="library-search-field">
        <Search size={15} aria-hidden="true" /><input type="search" aria-label={t("Search watch music")} placeholder={t("Search watch music")} value={search} onChange={event => setSearch(event.target.value)} />
      </div>{api?.deleteAllCorosMusic && inventory.wirelessTracks && !inventory.wirelessError && !inventory.neteaseError && totalTracks > 0 ?
        <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => void deleteAll()}>
          <Trash2 size={14} aria-hidden="true" /> {t("Delete all")}
        </button> : null}</div>
      {visible.length || visibleWireless.length || neteaseSection ? <div className="ble-music-groups">
        {openPlaylist ? null : visible.length ? <MusicGroup icon={Music} title={t("Music")} count={visible.length}>{visible.map(track => <li key={JSON.stringify([track.watchId, track.name])}>
          <Music size={16} aria-hidden="true" /><span>{track.name}</span><em>{formatBytes(track.sizeBytes)}</em>
          {api?.deleteCorosMusicTrack && inventory.id ? <button type="button" className="icon-button ble-music-delete"
            title={t("Delete {{p0}} via Bluetooth", { p0: track.name })} aria-label={t("Delete {{p0}} via Bluetooth", { p0: track.name })}
            disabled={busy} onClick={() => void deleteTrack(track)}>
            {deleting === track.watchPath ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          </button> : null}
        </li>)}</MusicGroup> : null}
        {!openPlaylist && podcasts.length ? <MusicGroup icon={Podcast} title={t("Podcasts")} count={podcasts.length}>{podcasts.map(track => <li key={`podcast:${track.id}`}>
          <Podcast size={16} aria-hidden="true" /><span>{track.name ?? track.id}</span><em>{formatBytes(track.sizeBytes)}</em>
          {api?.deleteCorosMusicTrack && inventory.id ? <button type="button" className="icon-button ble-music-delete"
            title={t("Delete {{p0}} via Bluetooth", { p0: track.name ?? track.id })} aria-label={t("Delete {{p0}} via Bluetooth", { p0: track.name ?? track.id })}
            disabled={busy} onClick={() => void deletePodcast(track)}>
            {deleting === `podcast:${track.id}` ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          </button> : null}
        </li>)}</MusicGroup> : null}
        {neteaseSection}
      </div> : <p className="ble-music-empty">{totalTracks ? t("No matching watch tracks") : inventory.wirelessTracks && !inventory.wirelessError
        ? t("No audio files reported by the watch") : t("No local MP3 files in the watch’s Music folder")}</p>}
      {inventory.neteaseError ? <p className="ble-music-note">{t("NetEase songs couldn’t be read: {{p0}}", { p0: inventory.neteaseError })}</p> : null}
      {wirelessTracks.some(track => !track.name) ? <p className="ble-music-note">{t("Titles are unavailable for some older uploads; their watch file IDs are shown.")}</p> : null}
      <p className="ble-music-note">{formatBytes([...tracks, ...wirelessTracks].reduce((sum, track) => sum + track.sizeBytes, 0))}  {t("of stored audio.")}</p>
    </> : <>
      {!error ? <p className="ble-music-empty">{loading ? t("Reading the music stored on your watch…") : t("Read your watch’s music library over Bluetooth. Keep the watch awake and nearby.")}</p> : null}
      {neteaseSection ? <div className="ble-music-groups">{neteaseSection}</div> : null}
    </>}
    {showWifiMusic && api && typeof api.getCorosWifiMusicStatus === "function" && typeof api.sendCorosMusicOverWifi === "function" ? <CorosWifiMusicPanel api={api} otherBusy={loading || deleting !== null} onBusyChange={setWifiBusy} /> : null}
  </section>;
}

function MusicGroup({ icon: Icon, title, count, action, children }: { icon: typeof Music; title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return <section className="ble-music-group">
    <h4><Icon size={14} aria-hidden="true" /> <span>{title}</span> <small>{count}</small>{action}</h4>
    <ul className="ble-music-list">{children}</ul>
  </section>;
}
