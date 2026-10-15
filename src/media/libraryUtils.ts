import { getLocale, formatNumber, t } from "../i18n/toolsLocale";
import type { LocalTrack, WatchTrack } from "../../electron/types";
import {
  musicFileNamesMatch,
  normalizeMusicFileName,
} from "../../electron/musicFileNames";

export interface WatchTrackNameIndex {
  exactNames: Set<string>;
  stems: Set<string>;
  collisionStems: Set<string>;
}

export function createWatchTrackNameIndex(
  watchTracks: WatchTrack[],
): WatchTrackNameIndex {
  const exactNames = new Set<string>();
  const stems = new Set<string>();
  const collisionStems = new Set<string>();

  for (const track of watchTracks) {
    const normalizedName = normalizeMusicFileName(track.name);
    exactNames.add(normalizedName);

    if (!normalizedName.endsWith(".mp3")) {
      continue;
    }

    const stem = normalizedName.slice(0, -4);
    stems.add(stem);

    const collision = /^(.+) \((\d+)\)$/.exec(stem);
    if (collision) {
      collisionStems.add(collision[1]);
    }
  }

  return { exactNames, stems, collisionStems };
}

export function findWatchTrackForLocal(
  track: LocalTrack,
  watchTracks: WatchTrack[],
): WatchTrack | undefined {
  return watchTracks.find((watchTrack) =>
    musicFileNamesMatch(track.filePath, watchTrack.name),
  );
}

export function isLocalTrackOnWatchByIndex(
  track: LocalTrack,
  watchIndex: WatchTrackNameIndex,
  watchConnected: boolean,
): boolean {
  const localName = normalizeMusicFileName(track.filePath);
  let onWatchNow = watchIndex.exactNames.has(localName);

  if (!onWatchNow && localName.endsWith(".mp3")) {
    const localStem = localName.slice(0, -4);
    onWatchNow =
      watchIndex.stems.has(localStem) || watchIndex.collisionStems.has(localStem);
  }

  if (watchConnected) {
    return onWatchNow;
  }

  return onWatchNow || Boolean(track.transferredAt);
}

export function isLocalTrackOnWatch(
  track: LocalTrack,
  watchTracks: WatchTrack[],
  watchConnected: boolean,
): boolean {
  const onWatchNow = Boolean(findWatchTrackForLocal(track, watchTracks));
  if (watchConnected) {
    return onWatchNow;
  }

  return onWatchNow || Boolean(track.transferredAt);
}

export function countPendingTransfers(
  downloads: LocalTrack[],
  watchTracks: WatchTrack[],
  watchConnected: boolean,
): number {
  const watchIndex = createWatchTrackNameIndex(watchTracks);

  return downloads.filter(
    (track) => !isLocalTrackOnWatchByIndex(track, watchIndex, watchConnected),
  ).length;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `0 ${t("B")}`;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${formatNumber(value, { minimumFractionDigits: value >= 10 ? 0 : 1, maximumFractionDigits: value >= 10 ? 0 : 1 })} ${t(units[exponent])}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function sumBytes(tracks: { sizeBytes: number }[]): number {
  return tracks.reduce((total, track) => total + track.sizeBytes, 0);
}
