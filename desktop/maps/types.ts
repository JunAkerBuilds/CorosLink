// Maps (desktop only): what the Maps screens and the main process say to each other at /api/desktop/maps.
// Three parts, as in the design's Maps boards: Route Studio (routes planned here, kept on this computer, sent to the
// watch over Bluetooth), Map areas (COROS's zoom-7 map squares, downloaded by the watch over its Wi-Fi or copied over
// USB) and COROS Maps (COROS's official region packages, downloaded here and copied to the watch over USB).
// Pure types and small helpers only: imported by both the page and the main process.

/** [latitude, longitude] or [latitude, longitude, elevation in metres]. */
export type LatLon = [number, number];
export type TrackPoint = [number, number] | [number, number, number];

export type RouteSport = "run" | "walk" | "hike" | "road" | "mtb";
export type RouteKind = "loop" | "ab";
export type Surface = "road" | "mixed" | "trail";
export type Elevation = "any" | "flat" | "hilly";
export type RoutingEngine = "keyless" | "ors";

export interface Place { name: string; detail?: string; lat: number; lon: number }

/** Way types and surfaces along a route, in metres (BRouter's way tags). */
export interface RouteMakeup {
  ways: { kind: "path" | "cycleway" | "sidewalk" | "quiet" | "busy" | "other"; meters: number }[];
  surfaces: { kind: "paved" | "gravel" | "dirt" | "unknown"; meters: number }[];
  busyMeters: number;
  /** Metres run twice (out-and-back sections, spurs). */
  retracedMeters: number;
}

/** A routed line with what the stats bar shows. */
export interface RouteGeometry {
  points: TrackPoint[];
  distanceM: number;
  ascentM: number;
  descentM: number;
  makeup?: RouteMakeup;
}

// ---- Route Studio ----

export interface GenerateRequest {
  sport: RouteSport;
  kind: RouteKind;
  start: LatLon;
  /** A → B only. */
  end?: LatLon;
  distanceKm: number;
  surface: Surface;
  elevation: Elevation;
  /** Changes the loop's direction ("New variation"). */
  seed?: number;
}

/** "Pick your loop": up to three, best match first. */
export interface RouteCandidate extends RouteGeometry {
  id: string;
  label: "Best match" | "More trail" | "Flatter" | string;
  /** 0–1 */
  carFree: number;
  paved: number;
}

/** Draw mode: one leg between two clicked points, along paths, or straight when snap is off. */
export interface LegRequest { sport: RouteSport; surface: Surface; from: LatLon; to: LatLon; snap: boolean }

/** Sketch: the outline (already placed on the map) snapped to streets. */
export interface SketchRequest { sport: RouteSport; outline: LatLon[]; fidelity: "loose" | "balanced" | "strict" }
export interface SketchAnswer { route: RouteGeometry; /** 0–1 */ match: number }

export interface SavedRouteSummary {
  id: string;
  name: string;
  sport: RouteSport;
  kind: RouteKind;
  distanceM: number;
  ascentM: number;
  createdAt: string;
  /** The track ID + CRC the watch last took, when it still holds it. */
  onWatch?: boolean;
}

export interface SavedRoute extends SavedRouteSummary {
  descentM: number;
  points: TrackPoint[];
  /** The clicked points (Draw) to keep editing; absent for generated or imported routes. */
  waypoints?: LatLon[];
  makeup?: RouteMakeup;
  /** Where it came from. */
  source: "generate" | "draw" | "sketch" | "import" | "explore";
}

export interface RouteSave {
  name?: string;
  sport: RouteSport;
  kind: RouteKind;
  source: SavedRoute["source"];
  route: RouteGeometry;
  waypoints?: LatLon[];
}

export interface RouteList { routes: SavedRouteSummary[]; total: number }

/** Sending one route to the watch over Bluetooth (Local mode's watch link). */
export interface RouteSync {
  state: "idle" | "connecting" | "sending" | "checking" | "done" | "failed" | "cancelled";
  routeId?: string;
  name?: string;
  percent?: number;
  message?: string;
  /** The watch already had this route (same track ID and CRC). */
  already?: boolean;
}

/** The routes the watch holds. */
export interface WatchRoute { id: string; name: string; crc: number }

/** OpenStreetMap's marked routes near the map (Explore). */
export interface TrailRoute { id: string; name: string; kind: "hike" | "cycle" | "mtb"; distanceKm?: number; network?: string }

export interface RoutingConfig { engine: RoutingEngine; hasOrsKey: boolean }

// ---- Watch (shared by Map areas and COROS Maps) ----

export interface MapsWatch {
  /** "PACE Pro" */
  name: string;
  /** COROS's model code ("W332"); map packages are made per model. */
  model?: string;
  /** Reachable over Bluetooth: paired in Local mode (the link connects when a send needs it). */
  linked: boolean;
  /** Connected over Bluetooth right now. */
  connected?: boolean;
  /** Why it can't be reached over Bluetooth, when it can't. */
  linkNote?: string;
  /** Mounted as a USB drive. */
  usb: boolean;
  /** COROS map version this model reads (v4/v5/v6). */
  mapVersion: number;
  /** Map areas (zoom-7 squares) work only on PACE 4, PACE 4 Pro, PACE Pro, APEX 4. */
  areas: boolean;
  storage?: { totalBytes: number; freeBytes: number; mapBytes: number; mapFiles: number };
  battery?: number;
  charging?: boolean;
}

// ---- Map areas ----

export interface Tile { x: number; y: number }

export interface AreaPreview {
  id: string;
  tiles: Tile[];
  fileCount: number;
  sizeBytes: number;
  /** What the watch still needs (files it holds don't count), over USB with the watch plugged in. */
  neededBytes?: number;
}

/** A download the watch holds (its own Wi-Fi task list). */
export interface WifiTask {
  id: string;
  state: "queued" | "downloading" | "complete" | "failed" | "unknown";
  downloadedBytes: number;
  totalBytes: number;
  errorCode: number;
  /** What C-LINK called it when it started it ("Vancouver & Kelowna"). */
  label?: string;
}

/** Why the watch won't download now (its readiness bits), as one line each. */
export interface WifiReadiness { ready: boolean; reasons: string[] }

export interface AreasStatus {
  watch: MapsWatch | null;
  tasks: WifiTask[];
  readiness?: WifiReadiness;
  /** USB copy in progress. */
  copy?: CopyProgress;
  /** Map areas put on the watch from here, newest first. */
  history: AreaHistory[];
  checkedAt: string;
}

export interface AreaHistory { id: string; label: string; tiles: Tile[]; fileCount: number; sizeBytes: number; via: "wifi" | "usb"; at: string }

export interface CopyProgress {
  state: "copying" | "done" | "failed" | "cancelled";
  label: string;
  copiedBytes: number;
  totalBytes: number;
  files: number;
  filesDone: number;
  message?: string;
}

// ---- COROS Maps ----

export interface MapPackage {
  /** Stable per package and version: "v5:topo:british-columbia". */
  id: string;
  layer: "topo" | "landscape";
  sizeBytes: number;
  url: string;
}

export interface MapRegion { id: string; name: string; parent?: string; continent: string; topo?: MapPackage; landscape?: MapPackage }

export interface MapManifest { version: number; release: string; updatedAt: string; regions: MapRegion[] }

export interface PackageJob {
  packageId: string;
  state: "queued" | "downloading" | "failed" | "cancelled";
  receivedBytes: number;
  totalBytes: number;
  message?: string;
}

export interface CachedPackage { packageId: string; region: string; layer: MapPackage["layer"]; version: number; sizeBytes: number; savedAt: string }

export interface PackagesStatus {
  jobs: PackageJob[];
  cached: CachedPackage[];
  cacheBytes: number;
  install?: CopyProgress;
  /** Package ids found on the plugged-in watch. */
  onWatch: string[];
}

/** Error body every Maps call answers with on failure. */
export interface MapsProblem { error: { code: string; message: string } }

// ---- Small shared helpers ----

export const MAX_AREA_TILES = 16;
export const AREA_ZOOM = 7;

/** COROS map version a watch model reads. v6 PACE 4 Pro and VERTIX 4; v5 APEX 4, PACE 4, NOMAD, PACE Pro; v4 VERTIX and APEX 2. */
export function mapVersionFor(watchName: string | undefined): number {
  const n = (watchName ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  // VERTIX 4 isn't on COROS's map list yet (2026-11-25); assumed v6 like the PACE 4 Pro, the other 2026 AMOLED.
  if (/PACE 4 PRO|VERTIX 4/.test(n)) return 6;
  if (/APEX 4|PACE 4|NOMAD|PACE PRO/.test(n)) return 5;
  if (/VERTIX|APEX 2|APEX PRO/.test(n)) return 4;
  return 5;
}

/** Only these take map areas. */
export function takesMapAreas(watchName: string | undefined): boolean {
  return /PACE 4|PACE PRO|APEX 4/i.test(watchName ?? "");
}

export function quadkey(tile: Tile): string {
  let out = "";
  for (let bit = AREA_ZOOM - 1; bit >= 0; bit--) out += ((tile.x >> bit) & 1) + 2 * ((tile.y >> bit) & 1);
  return out;
}

const CELLS = 1 << AREA_ZOOM;
export function tileAt(lat: number, lon: number): Tile {
  const phi = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const x = Math.floor((lon + 180) / 360 * CELLS);
  const y = Math.floor((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * CELLS);
  return { x: Math.max(0, Math.min(CELLS - 1, x)), y: Math.max(0, Math.min(CELLS - 1, y)) };
}
export function tileBounds(tile: Tile) {
  const lat = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / CELLS))) * 180 / Math.PI;
  return { west: tile.x / CELLS * 360 - 180, east: (tile.x + 1) / CELLS * 360 - 180, north: lat(tile.y), south: lat(tile.y + 1) };
}
