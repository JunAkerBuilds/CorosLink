import { useEffect, useRef, useState } from "react";
import { Bluetooth, Loader2, Music, RefreshCw, Search, Trash2 } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosBleMusicInventory, CorosBleMusicTrack } from "../../electron/corosBleMusicTypes";
import { formatBytes } from "./libraryUtils";
import { CorosWifiMusicPanel } from "./CorosWifiMusicPanel";

export function CorosBluetoothMusicPanel({ api, connection, onWifiBusyChange, onOperationBusyChange, showWifiMusic = true, wifiSyncBusy }: {
  api: CorosLinkApi | undefined;
  connection: CorosNativeBleSnapshot | null;
  onWifiBusyChange?: (busy: boolean) => void;
  onOperationBusyChange?: (busy: boolean) => void;
  showWifiMusic?: boolean;
  wifiSyncBusy?: boolean;
}) {
  const [inventory, setInventory] = useState<CorosBleMusicInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [wifiBusy, setWifiBusy] = useState(false);
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
        : "Could not read the watch’s music.");
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
        if (result.deleted) setNotice(`Deleted “${track.name}” from the watch.`);
      }
    } catch (cause) {
      if (request === generation.current) {
        setInventory(null);
        setError(cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
          : "Could not delete this track. Refresh the watch’s music and try again.");
      }
    } finally { if (request === generation.current) setDeleting(null); }
  }

  const tracks = inventory?.tracks ?? [];
  const visible = tracks.filter(track => track.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  if (!connection?.connected) return null;
  return <section className="library-panel library-panel--watch" aria-label="On watch">
    <header className="library-panel-header">
      <div><p className="eyebrow">{inventory?.deviceName ?? connection?.deviceName ?? "COROS watch"}</p><h3>On watch</h3></div>
      <em>{inventory ? `${tracks.length} track${tracks.length === 1 ? "" : "s"}` : "Bluetooth"}</em>
    </header>
    <div className="ble-music-toolbar">
      <span><Bluetooth size={14} aria-hidden="true" /> Music on your watch</span>
      <button type="button" className="secondary-button compact-button" disabled={busy || !api?.getCorosMusicInventory} onClick={() => void readMusic()}>
        {loading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        {loading ? "Reading…" : inventory ? "Refresh music" : "Read music"}
      </button>
    </div>
    {error ? <p className="ble-music-error" role="alert">{error}</p> : null}
    {notice ? <p className="ble-music-note" role="status">{notice}</p> : null}
    {deleting ? <p className="ble-music-note" role="status">Waiting for confirmation, then deleting and checking the watch…</p> : null}
    {inventory ? <>
      <div className="library-panel-tools"><div className="library-search-field">
        <Search size={15} aria-hidden="true" /><input type="search" aria-label="Search watch music" placeholder="Search watch music" value={search} onChange={event => setSearch(event.target.value)} />
      </div></div>
      {visible.length ? <ul className="ble-music-list">{visible.map(track => <li key={JSON.stringify([track.watchId, track.name])}>
        <Music size={16} aria-hidden="true" /><span>{track.name}</span><em>{formatBytes(track.sizeBytes)}</em>
        {api?.deleteCorosMusicTrack && inventory.id ? <button type="button" className="icon-button ble-music-delete"
          title={`Delete ${track.name} via Bluetooth`} aria-label={`Delete ${track.name} via Bluetooth`}
          disabled={busy} onClick={() => void deleteTrack(track)}>
          {deleting === track.watchPath ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        </button> : null}
      </li>)}</ul> : <p className="ble-music-empty">{tracks.length ? "No matching watch tracks" : "No MP3 files on the watch"}</p>}
      <p className="ble-music-note">{formatBytes(tracks.reduce((sum, track) => sum + track.sizeBytes, 0))} of local music · Delete individual tracks over Bluetooth.</p>
    </> : !error ? <p className="ble-music-empty">{loading ? "Reading the music stored on your watch…" : "Read your watch’s music library over Bluetooth. Keep the watch awake and nearby."}</p> : null}
    {showWifiMusic && api && typeof api.getCorosWifiMusicStatus === "function" && typeof api.sendCorosMusicOverWifi === "function" ? <CorosWifiMusicPanel api={api} otherBusy={loading || deleting !== null} onBusyChange={setWifiBusy} /> : null}
  </section>;
}
