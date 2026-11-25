// The watch's storage as one bar: maps, everything else, free.
import type { MapsWatch } from "../../../maps/types";
import { bytes } from "../../maps";

export function StorageBar({ storage }: { storage: NonNullable<MapsWatch["storage"]> }) {
  const { totalBytes, freeBytes, mapBytes, mapFiles } = storage;
  const other = Math.max(0, totalBytes - freeBytes - mapBytes);
  const pc = (n: number) => `${totalBytes ? (n / totalBytes) * 100 : 0}%`;
  return (
    <div className="mp-storage">
      <div className="mp-storage-bar" role="img" aria-label={`Watch storage: maps ${bytes(mapBytes)}, other ${bytes(other)}, free ${bytes(freeBytes)} of ${bytes(totalBytes)}`}>
        <span className="mp-st-maps" style={{ width: pc(mapBytes) }} />
        <span className="mp-st-other" style={{ width: pc(other) }} />
      </div>
      <div className="mp-storage-key">
        <span><i className="mp-st-maps" />Maps {bytes(mapBytes)}{mapFiles ? ` · ${mapFiles} files` : ""}</span>
        <span><i className="mp-st-other" />Other {bytes(other)}</span>
        <span><i className="mp-st-free" />Free {bytes(freeBytes)}</span>
      </div>
    </div>
  );
}
