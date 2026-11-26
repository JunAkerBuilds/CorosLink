// Maps' watch side at /api/desktop/maps: the watch itself (Local mode's Bluetooth link and/or the watch as a USB
// drive), routes sent to it over Bluetooth (CorosKit's HTRK file 0x14, skipped when the same track ID and CRC16 are
// there), and map areas, either downloaded by the watch over its own Wi-Fi (COROS task id → B6 0A) or copied here
// over USB to Map/VSM and Map/VCM. The watch doesn't take routes over USB. See docs/maps-port.md.
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  mapVersionFor, takesMapAreas,
  type AreaPreview, type AreasStatus, type CopyProgress, type MapsWatch, type RouteSync, type WatchRoute, type WifiReadiness, type WifiTask,
} from "../../maps/types";
import { HelperProblem } from "../watch/helper";
import { isMapTaskId, type LocalWatch, type RouteInventory } from "../watch/service";
import { AreasProblem, MapPackageClient } from "./areas/client";
import { AreasHistory } from "./areas/history";
import { modelCode } from "./areas/models";
import { CopyCancelled, bytesStillNeeded, copyAreas, removeAreaFiles, watchMapFolder, type AreasDrive } from "./areas/usb";
import { msg, t } from "@/lib/i18n";

/** A saved route as Route Studio keeps it (desktop/main/maps/routes.ts). */
export interface RouteForSync {
  id: string;
  name: string;
  points: [number, number, number?][];
  distanceM: number;
  ascentM: number;
  descentM: number;
  createdAt: string;
}

export interface AreasHost {
  /** Where Maps keeps its history and the area-file cache. */
  folder: string;
  /** Local mode's watch, or null where there's none. */
  watch: () => LocalWatch | null;
  /** The watch as a USB drive (`areasDrive(watchDrive)`), or null. */
  drive: () => AreasDrive | null;
  /** A saved route by id, or null. */
  route: (id: string) => Promise<RouteForSync | null>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export const MIN_ROUTE_POINTS = 2;
export const MAX_ROUTE_POINTS = 40_000;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "maps", status = 400) => json({ error: { code, message } }, status);

/** The watch's ID for a route, as CorosKit makes it: the first 8 bytes of SHA-256 over its namespace and the id, little-endian. */
export function trackIdFor(routeId: string): string {
  const digest = createHash("sha256").update(`CorosLink route v1\0${routeId}`, "utf8").digest();
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(digest[i]);
  return (value === 0n ? 1n : value).toString(16).padStart(16, "0");
}

const NOT_OVER_USB = msg("Routes go to the watch over Bluetooth, not its USB cable.");
const AREAS_ONLY = msg("Map areas work on PACE 4, PACE 4 Pro, PACE Pro and APEX 4.");

export class AreasService {
  private readonly history: AreasHistory;
  private readonly client: MapPackageClient;
  private readonly cache: string;
  private sync: RouteSync = { state: "idle" };
  private syncCancelled = false;
  private inventory: RouteInventory | null = null;
  private copy: CopyProgress | undefined;
  private copyAbort: AbortController | null = null;
  private mapFiles: { root: string; at: number; count: number } | null = null;

  constructor(private readonly host: AreasHost) {
    this.history = new AreasHistory(host.folder);
    this.client = new MapPackageClient({ fetch: host.fetch });
    this.cache = path.join(host.folder, "area-cache");
  }

  private log(line: string) { this.host.log?.(line); }

  // ── Watch ──

  private async driveStatus() {
    const drive = this.host.drive();
    const status = drive ? await drive.status().catch(() => null) : null;
    return { drive, status: status?.connected ? status : null };
  }

  /** The watch as Maps shows it: its Bluetooth link (Local mode) and/or its USB drive; null when neither. */
  async watchInfo(): Promise<MapsWatch | null> {
    const local = this.host.watch();
    const link = local?.link();
    const { drive, status } = await this.driveStatus();
    if (!link?.name && !status) return null;
    const label = link?.model ?? status?.model ?? link?.display ?? "COROS watch";
    const model = modelCode(link?.model) ?? modelCode(status?.model);
    const out: MapsWatch = {
      name: label, ...(model ? { model } : {}), linked: !!link?.usable, connected: !!link?.connected, usb: !!status,
      ...(link && !link.usable && link.reason ? { linkNote: link.reason } : {}),
      mapVersion: mapVersionFor(label), areas: takesMapAreas(label),
      ...(link?.battery !== undefined ? { battery: link.battery } : {}),
    };
    if (status && status.totalBytes !== undefined && status.freeBytes !== undefined) {
      const root = await drive!.root().catch(() => null);
      out.storage = { totalBytes: status.totalBytes, freeBytes: status.freeBytes, mapBytes: status.mapBytes ?? 0, mapFiles: root ? await this.countMapFiles(root) : 0 };
    } else if (link?.connected && local) {
      const s = await local.storage();
      if (s) out.storage = { totalBytes: s.total, freeBytes: s.free, mapBytes: s.maps, mapFiles: 0 };
    }
    return out;
  }

  private async countMapFiles(root: string): Promise<number> {
    if (this.mapFiles && this.mapFiles.root === root && Date.now() - this.mapFiles.at < 60_000) return this.mapFiles.count;
    let count = 0;
    const visit = async (dir: string, depth: number) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && depth < 6) await visit(path.join(dir, e.name), depth + 1);
        else if (e.isFile() && !e.name.startsWith(".")) count++;
      }
    };
    await visit(await watchMapFolder(root), 0);
    this.mapFiles = { root, at: Date.now(), count };
    return count;
  }

  /** Local mode's watch, ready for commands, or why not. */
  private linked(): LocalWatch {
    const local = this.host.watch();
    const link = local?.link();
    if (!local || !link?.usable) throw new AreasProblem(link?.reason ?? "Turn on Local mode and pair your watch on the Watch page.", "noLink");
    return local;
  }

  // ── Routes ──

  /** Whether the watch holds this route as last sent (same track ID and CRC16), as far as C-LINK knows. */
  onWatch(routeId: string): boolean {
    const record = this.history.route(routeId);
    if (!record) return false;
    if (!this.inventory) return true;
    return this.inventory.routes.some((r) => r.trackId === record.trackId && r.crc === record.crc);
  }

  private async startSync(routeId: string): Promise<Response> {
    if (["connecting", "sending", "checking"].includes(this.sync.state)) return problem(t("A route is already being sent to the watch."), "busy", 409);
    const route = await this.host.route(routeId);
    if (!route) return problem(t("That route isn't saved any more."), "notFound", 404);
    if (route.points.length < MIN_ROUTE_POINTS || route.points.length > MAX_ROUTE_POINTS) {
      return problem(t("A route must contain between 2 and 40,000 GPS points to sync."), "points");
    }
    const local = this.host.watch();
    const link = local?.link();
    if (!local || !link?.usable) {
      const usb = (await this.driveStatus()).status;
      return problem(usb ? `${t(NOT_OVER_USB)} ${link?.reason ?? t("Turn on Local mode and pair your watch on the Watch page.")}` : (link?.reason ?? t("Turn on Local mode and pair your watch on the Watch page.")), "noLink");
    }
    // Every point as it is; the heights only when every point has one.
    const heights = route.points.every((p) => typeof p[2] === "number" && Number.isFinite(p[2])) ? route.points.map((p) => p[2] as number) : [];
    const created = Date.parse(route.createdAt);
    this.syncCancelled = false;
    this.sync = { state: "connecting", routeId, name: route.name, percent: 0 };
    void local.syncRoute({
      id: route.id, name: route.name, createdAt: Number.isFinite(created) ? Math.floor(created / 1000) : Math.floor(Date.now() / 1000),
      distanceM: route.distanceM, ascentM: route.ascentM, descentM: route.descentM,
      points: route.points.map((p) => [p[0], p[1]]), elevations: heights,
    }, (phase, percent) => {
      if (this.sync.routeId !== routeId || !["connecting", "sending", "checking"].includes(this.sync.state)) return;
      const state = phase === "checking" ? "checking" : phase === "done" ? this.sync.state : "sending";
      this.sync = { ...this.sync, state, ...(percent !== undefined ? { percent } : {}) };
    }).then((sent) => {
      this.inventory = sent.inventory;
      this.history.noteRoute({ routeId, trackId: sent.trackId, crc: sent.crc, name: route.name, at: new Date().toISOString() });
      this.sync = {
        state: "done", routeId, name: route.name, percent: 100, already: sent.already,
        message: sent.already ? "The watch already has this route." : "The route is on the watch.",
      };
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.sync = this.syncCancelled
        ? { state: "cancelled", routeId, name: route.name, message: t("Stopped. The watch keeps the routes it had.") }
        : { state: "failed", routeId, name: route.name, message };
    });
    return json(this.sync);
  }

  private async cancelSync(): Promise<RouteSync> {
    if (!["connecting", "sending", "checking"].includes(this.sync.state)) return this.sync;
    this.syncCancelled = true;
    await this.host.watch()?.cancelRouteSync();
    return this.sync;
  }

  private async watchRoutes(): Promise<WatchRoute[]> {
    this.inventory = await this.linked().watchRoutes();
    return this.inventory.routes.map((r) => ({ id: r.trackId, name: this.history.routeByTrack(r.trackId)?.name ?? "Route on the watch", crc: r.crc }));
  }

  // ── Map areas ──

  /** The watch's model code for map packages, or why there's none. */
  private async areaModel(): Promise<{ watch: MapsWatch; model: string }> {
    const watch = await this.watchInfo();
    if (!watch) throw new AreasProblem(t("Connect your watch: Local mode over Bluetooth, or its USB cable."), "noWatch");
    if (!watch.areas) throw new AreasProblem(t(AREAS_ONLY), "unsupported");
    if (!watch.model) throw new AreasProblem(t("C-LINK can't tell which watch this is. Pair it in Local mode so its model is known."), "noModel");
    return { watch, model: watch.model };
  }

  async areas(refresh = false): Promise<AreasStatus> {
    const watch = await this.watchInfo();
    let tasks: WifiTask[] = [];
    let readiness: WifiReadiness | undefined;
    const local = this.host.watch();
    const link = local?.link();
    // The watch is asked only while it's connected (or the page asks to refresh): polling never reconnects it.
    if (watch?.areas && local && link?.usable && (link.connected || refresh)) {
      try {
        tasks = (await local.mapTasks()).map((t) => ({
          id: t.id, state: t.state, downloadedBytes: t.downloadedBytes, totalBytes: t.totalBytes, errorCode: t.errorCode,
          ...(this.history.labelFor(t.id) ? { label: this.history.labelFor(t.id) } : {}),
        }));
        const ready = await local.mapReadiness();
        readiness = { ready: ready.ready, reasons: ready.reasons };
      } catch (error) {
        this.log(`Map areas: the watch's downloads couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { watch, tasks, ...(readiness ? { readiness } : {}), ...(this.copy ? { copy: this.copy } : {}), history: this.history.areas(), checkedAt: new Date().toISOString() };
  }

  private async preview(tiles: unknown): Promise<AreaPreview> {
    const { watch, model } = await this.areaModel();
    const preview = await this.client.preview(tiles, model);
    const out: AreaPreview = { id: preview.id, tiles: preview.tiles, fileCount: preview.fileCount, sizeBytes: preview.sizeBytes };
    if (watch.usb) {
      const root = await this.host.drive()?.root().catch(() => null);
      if (root) out.neededBytes = await bytesStillNeeded(preview.files, await watchMapFolder(root));
    }
    return out;
  }

  private async start(body: Record<string, unknown>): Promise<AreasStatus> {
    const previewId = String(body.previewId ?? "");
    const label = String(body.label ?? "").trim().slice(0, 120) || "Map areas";
    const { model } = await this.areaModel();
    const preview = this.client.take(previewId, model);
    if (body.via === "wifi") {
      const local = this.linked();
      const ready = await local.mapReadiness();
      if (!ready.ready) throw new AreasProblem(ready.reasons[0] ?? "The watch can't download maps now.", "notReady", 409);
      const taskId = await this.client.createTask(previewId, model);
      await local.startMapTask(taskId);
      this.client.forget(previewId);
      this.history.addArea({ id: randomUUID(), label, tiles: preview.tiles, fileCount: preview.fileCount, sizeBytes: preview.sizeBytes, via: "wifi", at: new Date().toISOString(), files: preview.files, taskId, model });
      return this.areas(true);
    }
    if (body.via !== "usb") throw new AreasProblem(t("Pick Wi-Fi or USB."));
    if (this.copy?.state === "copying") throw new AreasProblem(t("Map areas are already being copied to the watch."), "busy", 409);
    const drive = this.host.drive();
    const root = await drive?.root().catch(() => null);
    if (!drive || !root) throw new AreasProblem(t("Plug in your watch with its USB cable first."), "noUsb");
    const status = await drive.status();
    const mapFolder = await watchMapFolder(root);
    const abort = new AbortController();
    this.copyAbort = abort;
    this.copy = { state: "copying", label, copiedBytes: 0, totalBytes: 0, files: preview.files.length, filesDone: 0 };
    this.client.forget(previewId);
    const run = () => copyAreas({
      label, files: preview.files, mapFolder, cache: this.cache, freeBytes: status.freeBytes, fetch: this.host.fetch, signal: abort.signal,
      onProgress: (p) => { if (this.copyAbort === abort) this.copy = p; },
    });
    void (drive.exclusive ? drive.exclusive(run) : run()).then((done) => {
      this.copy = done;
      this.history.addArea({ id: randomUUID(), label, tiles: preview.tiles, fileCount: preview.fileCount, sizeBytes: preview.sizeBytes, via: "usb", at: new Date().toISOString(), files: preview.files, model });
    }, (error: unknown) => {
      const base = this.copy ?? { label, copiedBytes: 0, totalBytes: 0, files: preview.files.length, filesDone: 0 };
      this.copy = error instanceof CopyCancelled || abort.signal.aborted
        ? { ...base, state: "cancelled", message: t("Stopped. Files already copied stay on the watch.") }
        : { ...base, state: "failed", message: error instanceof Error ? error.message : String(error) };
    }).finally(() => {
      if (this.copyAbort === abort) this.copyAbort = null;
      drive.invalidate?.();
      this.mapFiles = null;
    });
    return this.areas();
  }

  private async cancel(body: Record<string, unknown>): Promise<AreasStatus> {
    if (body.taskId !== undefined) {
      // An empty id or eight 0xFF bytes would make the watch drop every download: only a real id goes.
      if (!isMapTaskId(body.taskId)) throw new AreasProblem(t("Choose a download from the watch's list."), "taskId");
      await this.linked().removeMapTask(body.taskId);
      return this.areas(true);
    }
    if (!this.copyAbort) throw new AreasProblem(t("Nothing is being copied."), "idle");
    this.copyAbort.abort();
    return this.areas();
  }

  private async removeHistory(id: string, forget: boolean): Promise<AreasStatus> {
    const record = this.history.area(id);
    if (!record) throw new AreasProblem(t("Those map areas aren't in the list any more."), "notFound", 404);
    if (!forget) {
      if (this.copy?.state === "copying") throw new AreasProblem(t("Wait for the copy to the watch to finish."), "busy", 409);
      const drive = this.host.drive();
      const root = await drive?.root().catch(() => null);
      if (!drive || !root) throw new AreasProblem(t("Plug in your watch with its USB cable to take map areas off it."), "noUsb");
      const keep = this.history.filesInUseBesides(id);
      const files = record.files.filter((f) => !keep.has(`${f.layer}/${f.name}`));
      const mapFolder = await watchMapFolder(root);
      const work = () => removeAreaFiles(files, mapFolder);
      try { await (drive.exclusive ? drive.exclusive(work) : work()); } finally { drive.invalidate?.(); this.mapFiles = null; }
    }
    this.history.removeArea(id);
    return this.areas();
  }

  // ── Page ──

  /** Answers the paths it owns under /api/desktop/maps; null for the rest. */
  async answer(request: Request, sub: string): Promise<Response | null> {
    const method = request.method;
    const url = new URL(request.url);
    const body = async () => (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const routeSync = /^\/routes\/([^/]+)\/sync$/.exec(sub);
    const historyItem = /^\/areas\/history\/([^/]+)$/.exec(sub);
    const owned = ["/watch", "/watch/routes", "/sync", "/sync/cancel", "/areas", "/areas/preview", "/areas/start", "/areas/cancel"].includes(sub) || routeSync || historyItem;
    if (!owned) return null;
    try {
      if (routeSync && method === "POST") return await this.startSync(decodeURIComponent(routeSync[1]));
      if (historyItem && method === "DELETE") return json(await this.removeHistory(decodeURIComponent(historyItem[1]), url.searchParams.get("forget") === "1"));
      switch (`${method} ${sub}`) {
        case "GET /watch": return json(await this.watchInfo());
        case "GET /sync": return json(this.sync);
        case "POST /sync/cancel": return json(await this.cancelSync());
        case "GET /watch/routes": return json({ routes: await this.watchRoutes() });
        case "GET /areas": return json(await this.areas(url.searchParams.get("refresh") === "1"));
        case "POST /areas/preview": return json(await this.preview((await body()).tiles));
        case "POST /areas/start": return json(await this.start(await body()));
        case "POST /areas/cancel": return json(await this.cancel(await body()));
        default: return problem(t("Not a Maps action."), "method", 405);
      }
    } catch (error) {
      if (error instanceof AreasProblem) return problem(error.message, error.code, error.status);
      if (error instanceof HelperProblem) return problem(error.message, "watch");
      this.log(`Maps ${method} ${sub} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return problem(t("That didn't work."), "internal", 500);
    }
  }
}
