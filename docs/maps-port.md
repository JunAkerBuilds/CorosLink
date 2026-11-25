# Maps: porting CorosLink's Maps into C-LINK Desktop

Goal: CorosLink's Maps (Beta) in the design's look — the C-LINK design canvas's "Maps and routes, desktop app" boards
(`MapAreas`, `MapRegions`, `RouteStudio` and their `Light*` copies). Source of truth for what must come over:
CorosLink `docs/replacement-checklist.md` §7 "Maps (Beta)" and its **Must not regress** list, which become tests.

New rail item **Maps** (folded-map icon) between Watch and Studio. One page, `/maps`, with the tabs
**Map areas | COROS Maps | Route Studio** (`/maps`, `/maps/coros`, `/maps/routes`).

## Code

| Part | Where |
| --- | --- |
| Shared types and helpers (page + main) | `desktop/maps/types.ts` |
| Screens | `desktop/renderer/pages/Maps.tsx` (shell + tabs), `pages/maps/*.tsx`, `pages/maps.css`, `desktop/renderer/maps.ts` (API calls) |
| Map | MapLibre GL on OpenStreetMap: OpenFreeMap vector styles, OpenTopoMap, Esri imagery, Waymarked Trails overlays — no account or token (`pages/maps/basemap.ts`) |
| Dispatcher | `desktop/main/maps/service.ts`: `/api/desktop/maps/*` → the three services below |
| Route Studio backend | `desktop/main/maps/routing/*` (BRouter, Nominatim, loop planner, way-tag insights, sketch geometry, Overpass trails, ORS), `desktop/main/maps/routes.ts` (saved routes + GPX), `desktop/main/maps/routesService.ts` |
| Watch side | `native/watch` helper commands, `desktop/main/watch/service.ts` methods, `desktop/main/maps/areasService.ts` (map areas + route sync) |
| COROS Maps backend | `desktop/main/maps/packagesService.ts` (+ `packages/*`) |

Each service class has `answer(request: Request, sub: string): Promise<Response | null>`, where `sub` is the path
after `/api/desktop/maps` (`"/routes/abc"`), returning null for paths it doesn't own. Errors answer
`{ error: { code, message } }` (`MapsProblem`) with a 4xx/5xx status; messages are written for the athlete.

## API (`/api/desktop/maps`)

### Route Studio (routesService)

| | |
| --- | --- |
| `GET /routing` → `RoutingConfig`; `PUT /routing` `{ engine, orsKey? }` | Keyless (BRouter + Nominatim) or OpenRouteService with a key kept sealed (safeStorage) |
| `GET /places?q=` → `Place[]`; `GET /places/reverse?lat=&lon=` → `Place` | Nominatim, ≥ 1.1 s between calls, own User-Agent |
| `POST /generate` `GenerateRequest` → `{ candidates: RouteCandidate[] }` | Loop or A → B; up to three: Best match, More trail, Flatter |
| `POST /leg` `LegRequest` → `RouteGeometry` | Draw mode, one leg |
| `POST /sketch` `SketchRequest` → `SketchAnswer` | Sketch snapped to streets |
| `POST /elevation` `{ points: LatLon[] }` → `RouteGeometry` | Heights for freehand lines (Open-Meteo elevation) |
| `GET /trails?south=&west=&north=&east=&kinds=hike,cycle,mtb` → `{ trails: TrailRoute[] }`; `GET /trails/:id` → `RouteGeometry` | Explore: OSM route relations (Overpass) |
| `GET /routes?offset=&limit=&q=` → `RouteList`; `GET /routes/:id` → `SavedRoute` | Saved routes, newest first |
| `POST /routes` `RouteSave` → `SavedRoute`; `PATCH /routes/:id` `{ name }`; `DELETE /routes/:id`; `DELETE /routes` | |
| `POST /routes/import?name=` (body: GPX text) → `{ routes: SavedRouteSummary[] }` | One file per call, tracks or routes inside |
| `GET /routes/:id/gpx` | GPX 1.1 download |

### Watch, map areas and route sync (areasService)

| | |
| --- | --- |
| `GET /watch` → `MapsWatch \| null` | Local mode's Bluetooth link and/or the watch as a USB drive |
| `POST /routes/:id/sync` → `RouteSync`; `GET /sync` → `RouteSync`; `POST /sync/cancel` | HTRK file 0x14 via CorosKit; skip when same ID + CRC is there |
| `GET /watch/routes` → `{ routes: WatchRoute[] }` | The watch's route list (0xAA) |
| `GET /areas` → `AreasStatus` | Watch, Wi-Fi tasks + readiness, USB copy, history |
| `POST /areas/preview` `{ tiles }` → `AreaPreview` | COROS map package check (signed request) |
| `POST /areas/start` `{ previewId, label, via: "wifi" \| "usb" }` → `AreasStatus` | Wi-Fi: COROS task id → watch (0x0A start); USB: download each area file, copy to `Map/VSM`, `Map/VCM` |
| `POST /areas/cancel` `{ taskId? }` | Wi-Fi task remove (never empty / all-0xFF id), or stop the USB copy |
| `DELETE /areas/history/:id` | Remove those area files from the watch (USB) |

### COROS Maps (packagesService)

| | |
| --- | --- |
| `GET /packages/manifest?version=` → `MapManifest` | Official regions, Topo/Landscape |
| `GET /packages` → `PackagesStatus` | Jobs, cache, install progress, packages on the plugged-in watch |
| `POST /packages/:id/download`; `POST /packages/:id/cancel`; `DELETE /packages/cached/:id` | Resume `.part` with Range + If-Range on ETag; drop partials after 30 d |
| `POST /packages/install` `{ ids }`; `POST /packages/install/cancel` | Over USB; count only bytes still needed; free-space check |

## Must not regress (from the checklist, as tests)

- Map version per model: v6 PACE 4 Pro; v5 APEX 4, PACE 4, NOMAD, PACE Pro; v4 VERTIX family, APEX 2/2 Pro/Pro; fallback v5.
- Zips up to 15 GB: resume with Range + If-Range on ETag, drop partials after 30 days, read via the central directory (data descriptors / Zip64).
- Count only bytes still needed; refuse when the source is the watch's own folder (case-insensitive on Windows).
- Area maps only on PACE 4, PACE 4 Pro, PACE Pro, APEX 4; packages per model ("W336").
- Wi-Fi task remove: an empty id or eight 0xFF bytes means every task — refuse; reply 0x1A = USB cable in.
- Read COROS's map signing config as data, never run its JavaScript.
- Routes: 2–40,000 points, no simplification; skip if the same track ID + CRC16 is there; verify after sending; say clearly when the watch's route library is full; the watch doesn't take routes over USB.
- Map folder is `Map` on APEX 4, `map` on older watches; never assume case-insensitive.
- BRouter: two requests at a time, profiles cached 6 h. Routing limits: foot ≤ 100 km, cycling ≤ 300 km.

## Phases

1. Maps shell, Route Studio (all four modes, saved routes, GPX, sync to watch), Map areas, COROS Maps — built in
   parallel on `claude/maps`.
2. Later: Share to phone (LAN QR), CARTO key option.
