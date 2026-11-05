import { t, getLocale } from "../i18n/tools";
import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import type { CorosBleMusicInventory, CorosWirelessAudioTrack } from "../../electron/corosBleMusicTypes";
import type { CorosNeteasePlaylistLabel } from "../../electron/corosWifiMusicTypes";
import "./neteasePlaylists.css";

export type { NeteasePlaylistSelection } from "./watchMusicInventoryStore";

export interface PlaylistRow {
  key: string;
  id?: string;
  name: string;
  /** The watch only stores IDs: false until CorosLink or the user names it. */
  named: boolean;
  songs?: CorosWirelessAudioTrack[];
  updatedAt?: number;
  state: "draft" | "watch" | "saved" | "absent";
}

export const invalidPlaylistName = (value: string) => !value.trim() || /[\x00-\x1f\x7f]/.test(value) || new TextEncoder().encode(value.trim()).length > 63;

/** Merge the last Bluetooth read (IDs, songs) with the names CorosLink remembers for this watch. */
export function neteasePlaylistRows(labels: CorosNeteasePlaylistLabel[], inventory: CorosBleMusicInventory | null, draft: string | null) {
  const known = Boolean(inventory?.wirelessTracks && !inventory.wirelessError && !inventory.neteaseError);
  const groups = new Map<string, CorosWirelessAudioTrack[]>();
  if (known) for (const track of inventory!.wirelessTracks!) {
    if (track.destination !== "netease" || !track.playlistId) continue;
    groups.set(track.playlistId, [...(groups.get(track.playlistId) ?? []), track]);
  }
  const rows: PlaylistRow[] = labels.map(label => ({ key: label.id, id: label.id, name: label.name, named: true, updatedAt: label.updatedAt,
    songs: groups.get(label.id), state: groups.has(label.id) ? "watch"
      // Songs added after the read aren't in it yet: the playlist is on the watch, its songs just unknown.
      : !known || (label.updatedAt ?? 0) > inventory!.checkedAt ? "saved" : "absent" }));
  for (const [id, songs] of groups) if (!labels.some(label => label.id === id)) {
    const name = songs.find(song => song.playlistName)?.playlistName;
    rows.push({ key: id, id, name: name ?? t("Playlist {{p0}}", { p0: id }), named: Boolean(name), songs, state: "watch" });
  }
  const rank = (row: PlaylistRow) => row.state === "absent" ? 1 : 0;
  rows.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name, getLocale()));
  if (draft !== null) rows.unshift({ key: "draft", name: draft, named: true, state: "draft" });
  const songCount = known ? [...groups.values()].reduce((sum, songs) => sum + songs.length, 0) : undefined;
  return { rows, known, playlistCount: known ? groups.size : undefined, songCount };
}

export const songsLabel = (count: number) => count === 1 ? t("1 song") : t("{{p0}} songs", { p0: count });

export function playlistMeta(row: PlaylistRow) {
  return row.state === "draft" ? t("Not on the watch yet") : row.state === "absent" ? t("Not found in the last read")
    : row.songs ? songsLabel(row.songs.length) : t("Read the watch to see its songs");
}

export function NameForm({ initial, submitLabel, disabled, onSubmit, onCancel }: {
  initial: string; submitLabel: string; disabled: boolean;
  onSubmit: (name: string) => void | Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const invalid = invalidPlaylistName(name);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!invalid && !disabled) void onSubmit(name.trim());
  }
  return <form className="netease-playlist-name-form" onSubmit={submit}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
    <input aria-label={t("Playlist name")} placeholder={t("Playlist name")} value={name} maxLength={63} autoFocus disabled={disabled}
      aria-invalid={Boolean(name) && invalid} onChange={event => setName(event.target.value)} />
    <button type="submit" className="secondary-button compact-button" disabled={disabled || invalid}><Check size={14} aria-hidden="true" /> {submitLabel}</button>
    <button type="button" className="icon-button" aria-label={t("Cancel")} title={t("Cancel")} disabled={disabled} onClick={onCancel}><X size={15} aria-hidden="true" /></button>
    {name && invalid ? <p role="alert">{t("Enter a playlist name (up to 63 UTF-8 bytes).")}</p> : null}
  </form>;
}
