// What the Maps screens ask the main process for, at /api/desktop/maps (desktop/main/maps/service.ts).
import type {
  AreaPreview, AreasStatus, GenerateRequest, LatLon, LegRequest, MapManifest, MapsWatch, PackagesStatus, Place, RouteCandidate,
  RouteGeometry, RouteList, RouteSave, RouteSync, RoutingConfig, SavedRoute, SavedRouteSummary, SketchAnswer, SketchRequest,
  Tile, TrailRoute, WatchRoute,
} from "../maps/types";

const BASE = "/api/desktop/maps";

export class MapsProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const answer = await fetch(BASE + path, {
    cache: "no-store", ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}),
  });
  const body = answer.headers.get("Content-Type")?.includes("json") ? await answer.json().catch(() => null) : null;
  if (!answer.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new MapsProblem(e?.message ?? `Maps couldn't do that (${answer.status}).`, e?.code ?? "problem");
  }
  return body as T;
}
const get = <T>(path: string) => call<T>(path);
const send = <T>(method: string, path: string, json?: unknown) => call<T>(path, { method, json });

export const said = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

// Route Studio
export const routingConfig = () => get<RoutingConfig>("/routing");
export const setRouting = (engine: RoutingConfig["engine"], orsKey?: string) => send<RoutingConfig>("PUT", "/routing", { engine, orsKey });
export const searchPlaces = (q: string) => get<Place[]>(`/places?q=${encodeURIComponent(q)}`);
export const placeAt = (lat: number, lon: number) => get<Place>(`/places/reverse?lat=${lat}&lon=${lon}`);
export const generate = (request: GenerateRequest) => send<{ candidates: RouteCandidate[] }>("POST", "/generate", request);
export const routeLeg = (request: LegRequest) => send<RouteGeometry>("POST", "/leg", request);
export const sketch = (request: SketchRequest) => send<SketchAnswer>("POST", "/sketch", request);
export const heights = (points: LatLon[]) => send<RouteGeometry>("POST", "/elevation", { points });
export const trailsIn = (b: { south: number; west: number; north: number; east: number }, kinds: string[]) =>
  get<{ trails: TrailRoute[] }>(`/trails?south=${b.south}&west=${b.west}&north=${b.north}&east=${b.east}&kinds=${kinds.join(",")}`);
export const trail = (id: string) => get<RouteGeometry>(`/trails/${encodeURIComponent(id)}`);

export const listRoutes = (offset = 0, limit = 6, q = "") => get<RouteList>(`/routes?offset=${offset}&limit=${limit}&q=${encodeURIComponent(q)}`);
export const loadRoute = (id: string) => get<SavedRoute>(`/routes/${encodeURIComponent(id)}`);
export const saveRoute = (route: RouteSave) => send<SavedRoute>("POST", "/routes", route);
export const renameRoute = (id: string, name: string) => send<SavedRoute>("PATCH", `/routes/${encodeURIComponent(id)}`, { name });
export const deleteRoute = (id: string) => send<unknown>("DELETE", `/routes/${encodeURIComponent(id)}`);
export const deleteAllRoutes = () => send<unknown>("DELETE", "/routes");
export const gpxHref = (id: string) => `${BASE}/routes/${encodeURIComponent(id)}/gpx`;
export async function importGpx(file: File): Promise<SavedRouteSummary[]> {
  const text = await file.text();
  const answer = await call<{ routes: SavedRouteSummary[] }>(`/routes/import?name=${encodeURIComponent(file.name.replace(/\.gpx$/i, ""))}`, {
    method: "POST", body: text, headers: { "Content-Type": "application/gpx+xml" },
  });
  return answer.routes;
}

export const syncRoute = (id: string) => send<RouteSync>("POST", `/routes/${encodeURIComponent(id)}/sync`);
export const routeSync = () => get<RouteSync>("/sync");
export const cancelRouteSync = () => send<RouteSync>("POST", "/sync/cancel");
export const watchRoutes = () => get<{ routes: WatchRoute[] }>("/watch/routes");

// Watch, Map areas
export const mapsWatch = () => get<MapsWatch | null>("/watch");
export const areas = () => get<AreasStatus>("/areas");
export const previewAreas = (tiles: Tile[]) => send<AreaPreview>("POST", "/areas/preview", { tiles });
export const startAreas = (previewId: string, label: string, via: "wifi" | "usb") => send<AreasStatus>("POST", "/areas/start", { previewId, label, via });
export const cancelAreas = (taskId?: string) => send<AreasStatus>("POST", "/areas/cancel", { taskId });
export const removeAreas = (id: string) => send<AreasStatus>("DELETE", `/areas/history/${encodeURIComponent(id)}`);

// COROS Maps
export const manifest = (version: number) => get<MapManifest>(`/packages/manifest?version=${version}`);
export const packages = () => get<PackagesStatus>("/packages");
export const downloadPackage = (id: string) => send<PackagesStatus>("POST", `/packages/${encodeURIComponent(id)}/download`);
export const cancelPackage = (id: string) => send<PackagesStatus>("POST", `/packages/${encodeURIComponent(id)}/cancel`);
export const deleteCached = (id: string) => send<PackagesStatus>("DELETE", `/packages/cached/${encodeURIComponent(id)}`);
export const installPackages = (ids: string[]) => send<PackagesStatus>("POST", "/packages/install", { ids });
export const cancelInstall = () => send<PackagesStatus>("POST", "/packages/install/cancel");

// Formatting
export function bytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
export const km = (m: number) => (m / 1000).toFixed(2);
export const shortDate = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
