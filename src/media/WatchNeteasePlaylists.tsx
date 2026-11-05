import { t, useLanguage } from "../i18n/tools";
import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ListMusic, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CorosWirelessAudioTrack } from "../../electron/corosBleMusicTypes";
import { NETEASE_MAX_PLAYLISTS, NETEASE_MAX_SONGS } from "../../electron/corosWifiMusicTypes";
import { NameForm, playlistMeta, type PlaylistRow } from "./CorosNeteasePlaylists";
import { trackAvatarColor, trackInitial } from "./trackAvatar";
import { publishNeteaseAddSlot, updateNeteaseSend, useNeteaseSend } from "./watchMusicInventoryStore";

function Artwork({ row, size }: { row: PlaylistRow; size: "row" | "hero" }) {
  const className = `track-avatar wnp-art wnp-art--${size}`;
  if (!row.named) return <span className={`${className} track-avatar--watch`} aria-hidden="true"><ListMusic size={size === "hero" ? 18 : 15} /></span>;
  return <span className={`${className} track-avatar--library`} aria-hidden="true"
    style={{ "--track-color": trackAvatarColor(row.name) } as CSSProperties}>{trackInitial(row.name)}</span>;
}

const rowKey = (row: PlaylistRow) => row.state === "draft" ? "draft" : row.id;

/**
 * NetEase playlists in the On-watch panel, like a music app: a list that opens one playlist with its songs.
 * While Wi-Fi sends go to NetEase, the open playlist is the target and shows the add-songs controls.
 */
export function WatchNeteasePlaylists({ rows, known, playlistCount, songCount, picking, busy, deleting, query, onRename, onDelete }: {
  rows: PlaylistRow[];
  /** A Bluetooth read of NetEase songs is available. */
  known: boolean;
  playlistCount?: number;
  songCount?: number;
  picking: boolean;
  busy: boolean;
  deleting: string | null;
  query: string;
  onRename?: (id: string | undefined, name: string) => Promise<void>;
  /** Deletes songs over Bluetooth; absent without a read or a delete API. */
  onDelete?: (playlistId: string, songs: CorosWirelessAudioTrack[], whole: boolean) => void;
}) {
  useLanguage();
  const { selection } = useNeteaseSend();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const open = selection ? rows.find(row => rowKey(row) === (selection.kind === "draft" ? "draft" : selection.id)) : undefined;
  const select = (row: PlaylistRow | undefined) => {
    setRenaming(false);
    updateNeteaseSend({ selection: !row ? null : row.state === "draft" ? { kind: "draft" } : { kind: "playlist", id: row.id! } });
  };
  const matches = (song: CorosWirelessAudioTrack) => !query || (song.name ?? song.id).toLocaleLowerCase().includes(query);

  if (open) {
    const all = open.songs ?? [];
    const songs = all.filter(matches);
    const canDelete = Boolean(onDelete && open.id && all.length);
    return <section className="wnp wnp-detail" aria-label={open.name}>
      <header className="wnp-detail-head">
        <button type="button" className="icon-button wnp-back" aria-label={t("Playlists")} title={t("Playlists")} onClick={() => select(undefined)}>
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <Artwork row={open} size="hero" />
        {renaming && onRename ? <NameForm initial={open.named ? open.name : ""} submitLabel={t("Save")} disabled={busy}
          onCancel={() => setRenaming(false)} onSubmit={async name => { await onRename(open.id, name); setRenaming(false); }} />
          : <div className="wnp-detail-title">
            <h4><span>{open.name}</span>
              {onRename && (open.id || open.state === "draft") ? <button type="button" className="icon-button wnp-icon" disabled={busy}
                aria-label={open.named ? t("Rename playlist") : t("Name playlist")} title={open.named ? t("Rename playlist") : t("Name playlist")}
                onClick={() => setRenaming(true)}><Pencil size={13} aria-hidden="true" /></button> : null}
            </h4>
            <small>{[playlistMeta(open), open.id ? t("ID {{p0}}", { p0: open.id }) : ""].filter(Boolean).join(" · ")}</small>
          </div>}
        {renaming ? null : open.state === "draft" ? <button type="button" className="icon-button wnp-icon wnp-discard" disabled={busy}
          aria-label={t("Discard playlist")} title={t("Discard playlist")} onClick={() => updateNeteaseSend({ draft: null, selection: null })}>
          <X size={15} aria-hidden="true" />
        </button> : canDelete ? <button type="button" className="icon-button wnp-icon wnp-delete" disabled={busy}
          aria-label={t("Delete playlist {{p0}}", { p0: open.name })} title={t("Delete playlist {{p0}}", { p0: open.name })}
          onClick={() => onDelete!(open.id!, all, true)}>
          {deleting === `netease-playlist:${open.id}` ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
        </button> : null}
      </header>
      {picking ? <div className="wnp-add" ref={publishNeteaseAddSlot} /> : null}
      {songs.length ? <ol className="wnp-songs">{songs.map(song => <li key={song.id}>
        <span className="wnp-song-index">{all.indexOf(song) + 1}</span>
        <span className="wnp-song-name">{song.name ?? t("Song {{p0}}", { p0: song.id })}</span>
        {canDelete ? <button type="button" className="icon-button wnp-icon wnp-song-delete" disabled={busy}
          aria-label={t("Delete {{p0}} via Bluetooth", { p0: song.name ?? song.id })} title={t("Delete {{p0}} via Bluetooth", { p0: song.name ?? song.id })}
          onClick={() => onDelete!(open.id!, [song], all.length === 1)}>
          {deleting === `netease:${song.id}` ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
        </button> : null}
      </li>)}</ol>
        : <p className="wnp-empty">{open.state === "draft" ? t("No songs yet. Select songs in your library, then add them here.")
          : all.length ? t("No matching watch tracks")
          : open.state === "absent" ? t("The last read didn’t find this playlist on the watch. Adding songs creates it again with the same name.")
          : known && open.state !== "saved" ? t("No songs in this playlist.") : t("Read the watch over Bluetooth to see the songs in this playlist.")}</p>}
    </section>;
  }

  const full = playlistCount !== undefined && playlistCount >= NETEASE_MAX_PLAYLISTS;
  const visible = rows.filter(row => !query || row.name.toLocaleLowerCase().includes(query) || row.songs?.some(matches));
  return <section className="wnp" aria-label={t("NetEase playlists")}>
    <div className="wnp-head">
      <span>{t("NetEase playlists")}</span>
      <small>{playlistCount !== undefined ? t("{{p0}} of {{p1}} on the watch · {{p2}} of {{p3}} songs",
        { p0: playlistCount, p1: NETEASE_MAX_PLAYLISTS, p2: songCount ?? 0, p3: NETEASE_MAX_SONGS }) : t("Up to {{p0}} playlists and {{p1}} songs", { p0: NETEASE_MAX_PLAYLISTS, p1: NETEASE_MAX_SONGS })}</small>
      {picking && !creating ? <button type="button" className="text-button wnp-new" disabled={busy || full}
        title={full ? t("The watch holds up to {{p0}} NetEase playlists.", { p0: NETEASE_MAX_PLAYLISTS }) : undefined} onClick={() => setCreating(true)}>
        <Plus size={14} aria-hidden="true" /> {t("New playlist")}</button> : null}
    </div>
    {creating ? <div className="wnp-create"><NameForm initial="" submitLabel={t("Create")} disabled={busy} onCancel={() => setCreating(false)}
      onSubmit={name => { setCreating(false); updateNeteaseSend({ draft: name, selection: { kind: "draft" } }); }} /></div> : null}
    {visible.length ? <ul className="wnp-list">{visible.map(row => <li key={row.key}>
      <button type="button" className={`wnp-row${row.state === "absent" ? " is-absent" : ""}`} disabled={busy} onClick={() => select(row)}>
        <Artwork row={row} size="row" />
        <span className="wnp-row-text"><strong>{row.name}</strong><small>{playlistMeta(row)}</small></span>
        <ChevronRight size={15} className="wnp-chevron" aria-hidden="true" />
      </button>
    </li>)}</ul> : creating ? null : <p className="wnp-empty">{query ? t("No matching watch tracks") : known
      ? t("No NetEase playlists on the watch yet. Create one to add your own MP3s.") : t("Create a playlist, or read the watch to find the ones already on it.")}</p>}
  </section>;
}
