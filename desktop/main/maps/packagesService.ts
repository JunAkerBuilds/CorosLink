// COROS Maps: COROS's official region packages (Topo and Landscape zips per region and map version), downloaded to
// this computer and put on the watch over USB. Answered at /api/desktop/maps/packages* (docs/maps-port.md).
//
// Downloads resume (packages/download.ts), two at a time; the zips are read through their central directory
// (packages/zip.ts) and unpacked straight into the watch's Map folder (packages/install.ts).
import { statfsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedPackage, CopyProgress, MapManifest, MapPackage, MapRegion, PackageJob, PackagesStatus } from "../../maps/types";
import { PackageCache } from "./packages/cache";
import { download, DownloadProblem, prunePartials } from "./packages/download";
import { assertNotOwnFolder, clearLeftovers, fingerprint, InstallProblem, mapFolderOf, onWatch, plan, unpack, type PlanTotals } from "./packages/install";
import { isOfficialUrl, manifestUrl, MAP_VERSIONS, mapVersionOf, packagesOf, parseManifest, parsePackageId, regionName, type RawManifest } from "./packages/manifest";
import { ZipProblem } from "./packages/zip";
import { t } from "@/lib/i18n";

/** The watch as a USB drive, as far as map packages care. */
export interface PackagesWatch {
  /** The volume's root ("/Volumes/COROS PACE PRO", "E:\\"). */
  root: string;
  /** "APEX 4 46mm": picks `Map` or `map` when the watch has neither yet. */
  model?: string;
  /** Free space on the watch; read from the volume when left out. */
  freeBytes?: number;
}

export interface PackagesDrive {
  /** The plugged-in watch, or null. */
  watch(): Promise<PackagesWatch | null>;
  /** One watch write at a time (WatchDrive.exclusive). */
  exclusive?<T>(work: () => Promise<T>): Promise<T>;
  /** Forget cached watch status after a write (WatchDrive.invalidate). */
  invalidate?(): void;
}

export interface PackagesHost {
  /** Where the zips, partial downloads and index live (its own folder; nothing else is kept there). */
  folder: string;
  drive: () => PackagesDrive;
  fetch?: typeof fetch;
  /** Time, for tests. */
  now?: () => number;
  log?: (line: string) => void;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);

const PARALLEL = 2;
const MANIFEST_TTL_MS = 60 * 60 * 1000;
const ON_WATCH_TTL_MS = 30_000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

interface Job extends PackageJob { controller?: AbortController; pkg: MapPackage; region: MapRegion }

const layerName = (layer: MapPackage["layer"]) => (layer === "topo" ? "Topo" : "Landscape");

export class PackagesService {
  private readonly cache: PackageCache;
  private readonly jobs = new Map<string, Job>();
  private readonly manifests = new Map<number, { at: number; manifest: MapManifest }>();
  private install: CopyProgress | undefined;
  private installing: { controller: AbortController; ids: string[] } | null = null;
  private watchCache: { root: string; at: number; ids: string[] } | null = null;
  private prunedAt = -Infinity;

  constructor(private readonly host: PackagesHost) {
    this.cache = new PackageCache(host.folder);
  }

  private now() { return this.host.now?.() ?? Date.now(); }
  private get fetch() { return this.host.fetch ?? fetch; }

  async answer(request: Request, sub: string): Promise<Response | null> {
    const pathOnly = sub.split("?")[0].replace(/\/+$/, "");
    if (pathOnly !== "/packages" && !pathOnly.startsWith("/packages/")) return null;
    const method = request.method.toUpperCase();
    const parts = pathOnly.split("/").slice(2).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    try {
      if (method === "GET" && parts.length === 0) return json(await this.status());
      if (method === "GET" && parts.length === 1 && parts[0] === "manifest") {
        return json(await this.manifest(mapVersionOf(new URL(request.url).searchParams.get("version"))));
      }
      if (method === "POST" && parts.length === 1 && parts[0] === "install") {
        const body = (await request.json().catch(() => null)) as { ids?: unknown; check?: unknown } | null;
        const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((i): i is string => typeof i === "string"))] : [];
        return (await this.startInstall(ids, body?.check === true)) ?? json(await this.status());
      }
      if (method === "POST" && parts.length === 2 && parts[0] === "install" && parts[1] === "cancel") {
        this.installing?.controller.abort();
        return json(await this.status());
      }
      if (method === "POST" && parts.length === 2 && parts[1] === "download") return (await this.startDownload(parts[0])) ?? json(await this.status());
      if (method === "POST" && parts.length === 2 && parts[1] === "cancel") {
        this.cancel(parts[0]);
        return json(await this.status());
      }
      if (method === "DELETE" && parts.length === 2 && parts[0] === "cached") return (await this.remove(parts[1])) ?? json(await this.status());
      return null;
    } catch (error) {
      if (error instanceof InstallProblem || error instanceof DownloadProblem) return problem(error.message, error.code);
      if (error instanceof ZipProblem) return problem(error.message, "damaged");
      this.host.log?.(`Maps ${method} ${pathOnly} failed: ${String(error)}`);
      return problem(t("That didn't work."), "internal", 500);
    }
  }

  // ---- Manifest ----

  private manifestFile(version: number) { return path.join(this.host.folder, `manifest-v${version}.json`); }

  /** COROS's list for a map version; kept an hour, and on disk for when COROS can't be reached. */
  async manifest(version: number): Promise<MapManifest> {
    const held = this.manifests.get(version);
    if (held && this.now() - held.at < MANIFEST_TTL_MS) return held.manifest;
    try {
      const answer = await this.fetch(manifestUrl(version), { signal: AbortSignal.timeout(20_000) });
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      const manifest = parseManifest((await answer.json()) as RawManifest, version);
      if (!manifest.regions.length) throw new Error("empty list");
      this.manifests.set(version, { at: this.now(), manifest });
      await mkdir(this.host.folder, { recursive: true });
      await writeFile(this.manifestFile(version), JSON.stringify(manifest)).catch(() => undefined);
      return manifest;
    } catch (error) {
      this.host.log?.(`COROS map list v${version} failed: ${String(error)}`);
      const saved = await readFile(this.manifestFile(version), "utf8").then((t) => JSON.parse(t) as MapManifest, () => null);
      if (saved) return saved;
      throw new DownloadProblem(t("COROS's map list couldn't be loaded. Check the connection and try again."), "manifest");
    }
  }

  /** The package behind an id, from the lists: its own version's first, then the others (v6 lists v5 topo zips). */
  private async lookup(id: string): Promise<{ pkg: MapPackage; region: MapRegion } | null> {
    const parsed = parsePackageId(id);
    if (!parsed) return null;
    for (const { manifest } of this.manifests.values()) {
      const hit = packagesOf(manifest).get(id);
      if (hit) return hit;
    }
    const order = [parsed.version, ...MAP_VERSIONS.filter((v) => v !== parsed.version)];
    for (const version of order) {
      if (!(MAP_VERSIONS as readonly number[]).includes(version)) continue;
      const hit = packagesOf(await this.manifest(version).catch(() => ({ regions: [] }) as unknown as MapManifest)).get(id);
      if (hit) return hit;
    }
    return null;
  }

  // ---- Status ----

  async status(): Promise<PackagesStatus> {
    if (this.now() - this.prunedAt > PRUNE_EVERY_MS) {
      this.prunedAt = this.now();
      await prunePartials(this.host.folder, this.now());
    }
    const cached: CachedPackage[] = this.cache.list().map(({ packageId, region, layer, version, sizeBytes, savedAt }) =>
      ({ packageId, region, layer, version, sizeBytes, savedAt }));
    const jobs: PackageJob[] = [...this.jobs.values()].map(({ packageId, state, receivedBytes, totalBytes, message }) =>
      ({ packageId, state, receivedBytes, totalBytes, ...(message ? { message } : {}) }));
    return {
      jobs,
      cached,
      cacheBytes: await this.cache.bytes(),
      ...(this.install ? { install: { ...this.install } } : {}),
      onWatch: await this.onWatch(),
    };
  }

  /** Cached packages whose files are on the plugged-in watch (sampled), rechecked every 30 s. */
  private async onWatch(): Promise<string[]> {
    const watch = await this.host.drive().watch().catch(() => null);
    if (!watch) { this.watchCache = null; return []; }
    if (this.watchCache && this.watchCache.root === watch.root && this.now() - this.watchCache.at < ON_WATCH_TTL_MS) return this.watchCache.ids;
    const { folder, exists } = mapFolderOf(watch.root, watch.model);
    const ids: string[] = [];
    if (exists) for (const record of this.cache.list()) if (await onWatch(record.fingerprint, folder)) ids.push(record.packageId);
    this.watchCache = { root: watch.root, at: this.now(), ids };
    return ids;
  }

  // ---- Downloads ----

  private async startDownload(id: string): Promise<Response | null> {
    if (this.cache.get(id)) return null;
    const existing = this.jobs.get(id);
    if (existing && (existing.state === "queued" || existing.state === "downloading")) return null;
    const hit = await this.lookup(id);
    if (!hit) return problem(t("That map package isn't in COROS's list."), "notFound", 404);
    if (!isOfficialUrl(hit.pkg.url)) return problem(t("Only COROS's own map downloads can be used."), "notOfficial");
    const resumed = await this.cache.partialOf(id);
    this.jobs.set(id, { packageId: id, state: "queued", receivedBytes: resumed, totalBytes: hit.pkg.sizeBytes, pkg: hit.pkg, region: hit.region });
    this.pump();
    return null;
  }

  private pump(): void {
    const running = [...this.jobs.values()].filter((j) => j.state === "downloading").length;
    const next = [...this.jobs.values()].filter((j) => j.state === "queued").slice(0, Math.max(0, PARALLEL - running));
    for (const job of next) void this.run(job);
  }

  /** Resolves when the download ends either way; for tests. */
  readonly settled = new Map<string, Promise<void>>();

  private run(job: Job): Promise<void> {
    job.state = "downloading";
    job.controller = new AbortController();
    const work = (async () => {
      const file = this.cache.fileOf(job.packageId);
      await mkdir(this.host.folder, { recursive: true });
      try {
        const size = await download({
          url: job.pkg.url, target: file, fetch: this.host.fetch, signal: job.controller!.signal,
          onProgress: (received, total) => { job.receivedBytes = received; if (total) job.totalBytes = total; },
        });
        let print;
        try {
          print = await fingerprint(file);
        } catch (error) {
          await rm(file, { force: true });
          throw error instanceof ZipProblem || error instanceof InstallProblem
            ? new DownloadProblem(t("The download came out damaged. Try again."), "damaged") : error;
        }
        const parsed = parsePackageId(job.packageId)!;
        await this.cache.put({
          packageId: job.packageId, region: job.region.id, layer: job.pkg.layer, version: parsed.version, sizeBytes: size,
          savedAt: new Date(this.now()).toISOString(), url: job.pkg.url, fingerprint: print,
        });
        this.jobs.delete(job.packageId);
        this.watchCache = null;
      } catch (error) {
        if (this.jobs.get(job.packageId) !== job) return;
        if (job.controller?.signal.aborted) {
          job.state = "cancelled";
          job.message = t("Download cancelled. It picks up where it left off next time.");
        } else {
          job.state = "failed";
          job.message = error instanceof DownloadProblem ? error.message : t("The download stopped. Try again.");
          this.host.log?.(`Map package ${job.packageId} failed: ${String(error)}`);
        }
      } finally {
        job.controller = undefined;
        this.settled.delete(job.packageId);
        this.pump();
      }
    })();
    this.settled.set(job.packageId, work);
    return work;
  }

  private cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.state === "queued") { job.state = "cancelled"; job.message = t("Download cancelled."); }
    else if (job.state === "downloading") job.controller?.abort();
    else this.jobs.delete(id);
  }

  private async remove(id: string): Promise<Response | null> {
    if (this.installing?.ids.includes(id)) return problem(t("This map is going to the watch. Cancel that first."), "busy", 409);
    const job = this.jobs.get(id);
    if (job?.controller) { job.controller.abort(); await this.settled.get(id); }
    this.jobs.delete(id);
    await this.cache.remove(id);
    this.watchCache = null;
    return null;
  }

  // ---- Install over USB ----

  /**
   * Puts cached packages on the watch. `check` also reads back the files already there at the right size and
   * compares their CRC-32 with the zip's, replacing any that differ; it runs in the background with its own progress.
   */
  private async startInstall(ids: string[], check = false): Promise<Response | null> {
    if (!ids.length) return problem(t("Pick at least one downloaded map."), "noIds");
    if (this.installing) return problem(t("Maps are already going to the watch."), "busy", 409);
    const records = ids.map((id) => this.cache.get(id));
    if (records.some((r) => !r)) return problem(t("That map isn't downloaded yet."), "notCached", 404);
    const drive = this.host.drive();
    const watch = await drive.watch();
    if (!watch) return problem(t("Plug in your watch first."), "noWatch", 409);
    const { folder } = mapFolderOf(watch.root, watch.model);
    assertNotOwnFolder(this.host.folder, folder);
    const zips = records.map((r) => ({
      file: this.cache.fileOf(r!.packageId),
      label: `${regionName(r!.region)} ${layerName(r!.layer)}`,
    }));
    for (const z of zips) assertNotOwnFolder(z.file, folder);
    const label = zips.length === 1 ? zips[0].label : t("{n} map packages", { n: zips.length });

    const controller = new AbortController();
    this.installing = { controller, ids };
    const prepare = async (): Promise<PlanTotals> => {
      // A copy cut short (a crash, an unplugged watch) can leave unfinished files behind: cleared first.
      const cleared = await clearLeftovers(folder);
      if (cleared) this.host.log?.(`Removed ${cleared} unfinished map file(s) from the watch.`);
      const totals = await plan(zips.map((z) => z.file), folder, controller.signal, {
        check,
        onChecked: (read, total) => { if (this.install?.state === "checking") Object.assign(this.install, { copiedBytes: read, totalBytes: total }); },
      });
      const free = watch.freeBytes ?? freeSpace(watch.root);
      if (free !== undefined && totals.neededBytes > free) {
        throw new InstallProblem(t("The watch needs {needed} free for these maps and has {free}. Remove some maps or music first.", { needed: gb(totals.neededBytes), free: gb(free) }), "noSpace");
      }
      return totals;
    };
    const copying = (totals: PlanTotals): CopyProgress => ({ state: "copying", label, copiedBytes: 0, totalBytes: totals.bytes, files: totals.files, filesDone: 0, ...(check ? { checked: true } : {}) });

    if (check) {
      // Reading every file back takes minutes: answered now, followed on the status.
      this.install = { state: "checking", label, copiedBytes: 0, totalBytes: 0, files: 0, filesDone: 0, checked: true };
      this.installDone = (async () => {
        let totals: PlanTotals;
        try {
          totals = await prepare();
        } catch (error) {
          this.installing = null;
          const cancelled = controller.signal.aborted;
          if (!cancelled) this.host.log?.(`Map check failed: ${String(error)}`);
          this.install = cancelled ? { ...this.install!, state: "cancelled", message: t("Transfer cancelled.") }
            : { ...this.install!, state: "failed", message: watchWriteMessage(error) };
          return;
        }
        this.install = copying(totals);
        await this.copy(drive, zips, folder, controller, totals.replace);
      })();
      return null;
    }

    this.install = { state: "copying", label, copiedBytes: 0, totalBytes: 0, files: 0, filesDone: 0, message: t("Checking what the watch already has") };
    let totals;
    try {
      totals = await prepare();
    } catch (error) {
      this.installing = null;
      this.install = error instanceof InstallProblem && error.code === "cancelled"
        ? { ...this.install, state: "cancelled", message: t("Transfer cancelled.") } : undefined;
      if (error instanceof InstallProblem && error.code === "cancelled") return null;
      throw error;
    }
    this.install = copying(totals);
    void this.copy(drive, zips, folder, controller, totals.replace);
    return null;
  }

  /** Resolves when the running install ends; for tests. */
  installDone: Promise<void> = Promise.resolve();

  private copy(drive: PackagesDrive, zips: { file: string; label: string }[], folder: string, controller: AbortController, replace: ReadonlySet<string>): Promise<void> {
    const work = async () => unpack(zips, folder, {
      signal: controller.signal, replace,
      onProgress: ({ copiedBytes, filesDone, label }) => {
        if (this.install) Object.assign(this.install, { copiedBytes, filesDone, ...(zips.length > 1 ? { message: label } : {}) });
      },
    });
    this.installDone = (async () => {
      try {
        const done = await (drive.exclusive ? drive.exclusive(work) : work());
        // After a check, how many files on the watch were different and written again.
        if (this.install) Object.assign(this.install, { state: "done", copiedBytes: done.copiedBytes, filesDone: done.filesDone, message: undefined, ...(this.install.checked ? { fixed: replace.size } : {}) });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        if (!cancelled) this.host.log?.(`Map install failed: ${String(error)}`);
        if (this.install) Object.assign(this.install, cancelled
          ? { state: "cancelled", message: t("Transfer cancelled.") }
          : { state: "failed", message: watchWriteMessage(error) });
      } finally {
        this.installing = null;
        this.watchCache = null;
        drive.invalidate?.();
      }
    })();
    return this.installDone;
  }
}

function freeSpace(root: string): number | undefined {
  try {
    const fs = statfsSync(root);
    return fs.bavail * fs.bsize;
  } catch {
    return undefined;
  }
}

const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(0.01, bytes / 1e6).toFixed(2)} MB`);

function watchWriteMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOSPC") return "The watch ran out of space.";
  if (code === "ENOENT" || code === "EIO" || code === "ENODEV") return "The watch was unplugged or stopped answering. Plug it in and try again.";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "The watch's storage can't be written to.";
  if (error instanceof ZipProblem || error instanceof InstallProblem) return error.message;
  return "The maps couldn't be copied to the watch.";
}
