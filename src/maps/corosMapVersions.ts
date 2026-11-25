import type { WatchModelId } from "../../electron/watchModels";

/** Region-map list generations COROS publishes (regionMap/v{n}/regions_v{n}.json). */
export const COROS_MAP_VERSIONS = ["6", "5", "4"] as const;
export type CorosMapVersion = (typeof COROS_MAP_VERSIONS)[number];

/** What to show when CorosLink has never seen the watch: COROS's own page defaults to v5 too. */
export const FALLBACK_COROS_MAP_VERSION: CorosMapVersion = "5";

/**
 * The map version COROS's download page (coros.com/maps, "map.versionSupport") lists for each
 * watch, read 2026-11-21. Newer firmware reads only its own generation, so a v5 zip on a v6 watch
 * (or the reverse) is the wrong map. Watches with no offline maps are left out.
 */
const COROS_MAP_VERSION_BY_MODEL: Partial<Record<WatchModelId, CorosMapVersion>> = {
  "pace-4-pro": "6",
  // Not on COROS's list yet (read 2026-11-25); assumed v6 like the PACE 4 Pro, the other 2026 AMOLED.
  "vertix-4": "6",
  "apex-4": "5",
  "pace-4": "5",
  nomad: "5",
  "pace-pro": "5",
  "vertix-2s": "4",
  "vertix-2": "4",
  vertix: "4",
  "apex-2-pro": "4",
  "apex-2": "4",
  "apex-pro": "4"
};

export function recommendedCorosMapVersion(
  model: WatchModelId | undefined
): CorosMapVersion | undefined {
  return model ? COROS_MAP_VERSION_BY_MODEL[model] : undefined;
}

export function isCorosMapVersion(value: unknown): value is CorosMapVersion {
  return COROS_MAP_VERSIONS.includes(value as CorosMapVersion);
}
