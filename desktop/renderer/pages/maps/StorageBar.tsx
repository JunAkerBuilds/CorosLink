// The watch's storage as one bar: maps, everything else, free.
import { t, tx } from "@/lib/i18n";
import type { MapsWatch } from "../../../maps/types";
import { bytes } from "../../maps";

export function StorageBar({ storage }: { storage: NonNullable<MapsWatch["storage"]> }) {
  const { totalBytes, freeBytes, mapBytes, mapFiles } = storage;
  const other = Math.max(0, totalBytes - freeBytes - mapBytes);
  const pc = (n: number) => `${totalBytes ? (n / totalBytes) * 100 : 0}%`;
  return (
    <div className="mp-storage">
      <div className="mp-storage-bar" role="img" aria-label={t("Watch storage: maps {maps}, other {other}, free {free} of {total}", { maps: bytes(mapBytes), other: bytes(other), free: bytes(freeBytes), total: bytes(totalBytes) })}>
        <span className="mp-st-maps" style={{ width: pc(mapBytes) }} />
        <span className="mp-st-other" style={{ width: pc(other) }} />
      </div>
      <div className="mp-storage-key">
        <span><i className="mp-st-maps" />{t("Maps")} {bytes(mapBytes)}{mapFiles ? ` · ${mapFiles === 1 ? t("1 file") : t("{n} files", { n: mapFiles })}` : ""}</span>
        <span><i className="mp-st-other" />{t("Other")} {bytes(other)}</span>
        <span><i className="mp-st-free" />{tx("storage", "Free")} {bytes(freeBytes)}</span>
      </div>
    </div>
  );
}
