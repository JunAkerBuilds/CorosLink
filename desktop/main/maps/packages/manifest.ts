// COROS's official region map list: https://map-oss-us.coros.com/regionMap/v{n}/regions_v{n}.json, one per map
// version. Each row is one region and one layer:
//   { region: "asia1", title: "map.asia1", parent: "asia", type: "topo" | "landscape",
//     data: { size: 5803363719, link: "/regionMap/v5/asia1_topo_5.0.3.zip" } }
// with top-level { v: "5", host, updatedAt: "2025-09-16 22:31:26", bundleVersion: "5.0.3", totalSize }.
// A newer list can point at an older build (v6's topo rows are the v5 zips), so a package's id follows the folder its
// zip lives in: the same zip keeps one id and one cache entry whichever list it came from.
import type { MapManifest, MapPackage, MapRegion } from "../../../maps/types";

export const COROS_MAP_HOST = "https://map-oss-us.coros.com";
export const MAP_VERSIONS = [6, 5, 4] as const;
export const DEFAULT_MAP_VERSION = 5;

export const manifestUrl = (version: number) => `${COROS_MAP_HOST}/regionMap/v${version}/regions_v${version}.json`;

export function mapVersionOf(value: unknown): number {
  const n = Number(value);
  return (MAP_VERSIONS as readonly number[]).includes(n) ? n : DEFAULT_MAP_VERSION;
}

interface RawRow { region?: unknown; title?: unknown; parent?: unknown; type?: unknown; data?: { size?: unknown; link?: unknown } }
export interface RawManifest { v?: unknown; host?: unknown; updatedAt?: unknown; bundleVersion?: unknown; mapData?: unknown }

/** "North-America1" → "north-america1"; stable across list versions. */
export const regionSlug = (region: string) => region.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const NAMES: Record<string, string> = { "australia-oceania": "Australia & Oceania", global: "Whole world" };

/** "north-america2" → "North America 2"; "asia" → "Asia". */
export function regionName(slug: string): string {
  if (NAMES[slug]) return NAMES[slug];
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").replace(/([A-Za-z])(\d+)$/, "$1 $2");
}

/** "v5:topo:north-america1". */
export const packageId = (version: number, layer: MapPackage["layer"], region: string) => `v${version}:${layer}:${regionSlug(region)}`;

export function parsePackageId(id: string): { version: number; layer: MapPackage["layer"]; region: string } | null {
  const m = /^v(\d+):(topo|landscape):([a-z0-9-]+)$/.exec(id);
  return m ? { version: Number(m[1]), layer: m[2] as MapPackage["layer"], region: m[3] } : null;
}

/** Only COROS's own map host over HTTPS is ever downloaded from. */
export function isOfficialUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === new URL(COROS_MAP_HOST).hostname;
  } catch {
    return false;
  }
}

/** "2025-09-16 22:31:26" (COROS's server time, Beijing) → ISO. Left as it is when it doesn't look like that. */
function isoTime(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text);
  if (!m) return text;
  const date = new Date(`${m[1]}T${m[2]}+08:00`);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

export function parseManifest(raw: RawManifest, requested: number): MapManifest {
  const version = mapVersionOf(raw.v ?? requested);
  const rows = Array.isArray(raw.mapData) ? (raw.mapData as RawRow[]) : [];
  const host = typeof raw.host === "string" && isOfficialUrl(raw.host) ? raw.host.replace(/\/+$/, "") : COROS_MAP_HOST;
  const regions = new Map<string, MapRegion>();
  const parents = new Map<string, string>();
  for (const row of rows) {
    const layer = row.type === "topo" || row.type === "landscape" ? row.type : null;
    const region = typeof row.region === "string" ? regionSlug(row.region) : "";
    const link = typeof row.data?.link === "string" ? row.data.link.trim() : "";
    const sizeBytes = Number(row.data?.size);
    if (!layer || !region || !link || !Number.isFinite(sizeBytes) || sizeBytes < 0) continue;
    const url = /^https?:\/\//i.test(link) ? link : `${host}/${link.replace(/^\/+/, "")}`;
    if (!isOfficialUrl(url)) continue;
    const fileVersion = Number(/\/regionMap\/v(\d+)\//.exec(url)?.[1] ?? version);
    const parent = typeof row.parent === "string" ? regionSlug(row.parent) : "global";
    parents.set(region, parent);
    const entry = regions.get(region) ?? { id: region, name: regionName(region), continent: "" };
    entry[layer] = { id: packageId(fileVersion, layer, region), layer, sizeBytes, url };
    regions.set(region, entry);
  }
  for (const [slug, entry] of regions) {
    const parent = parents.get(slug) ?? "global";
    if (parent && parent !== "global" && parent !== slug) entry.parent = parent;
    // A top-level region is its own continent; "asia1" belongs to "asia". The whole-world package stands alone.
    entry.continent = slug === "global" ? "World" : regionName(entry.parent ?? slug);
  }
  const list = [...regions.values()].sort((a, b) =>
    a.continent.localeCompare(b.continent) || Number(!!a.parent) - Number(!!b.parent) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    version,
    release: typeof raw.bundleVersion === "string" ? raw.bundleVersion : String(version),
    updatedAt: isoTime(raw.updatedAt),
    regions: list,
  };
}

/** Every package a manifest lists, by id. */
export function packagesOf(manifest: MapManifest): Map<string, { pkg: MapPackage; region: MapRegion }> {
  const out = new Map<string, { pkg: MapPackage; region: MapRegion }>();
  for (const region of manifest.regions) for (const pkg of [region.topo, region.landscape]) if (pkg) out.set(pkg.id, { pkg, region });
  return out;
}
