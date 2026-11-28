// Studio's main-process side, answered at /api/desktop/studio: COROS's editable templates, the projects made from them,
// and building a project into the files a watch takes. Rewritten from CorosLink's corosWatchfaceService.ts for this
// app (docs/studio-port.md); the archive work itself is the moved engine in desktop/watchface/archive.
//
// - Templates: the catalog bundled with the app (desktop/watchface/assets/templateCatalog.json, CorosLink's snapshot).
//   Packages and their pictures download from COROS without signing in, only from URLs in that catalog, and are kept
//   in the data folder (studio/templates). Those are reads, so Local-Only Mode (dataMode.ts) lets them through.
// - Projects: CorosLink's own format, one folder each in studio/projects/<uuid>: project.json (name, template id,
//   firmware type, design), starter.dat (the template as it came) and preview.png. "Download → Editable project ZIP"
//   is CorosLink's portable form (coroslink-project.json, starter.dat, preview.png), which either app imports.
// - Building: the final archive is built in a worker thread (dist/main/watchfaceArchive.cjs) and compiled to a BIN by
//   compile.ts in another.
// - Sources (phase 5, pulled forward for the home page): Community faces (community.ts) and the COROS account's
//   catalogs (corosAccount.ts) open as projects through the same import as a file. A compiled face (official faces are
//   BINs) is recovered into an editable starter first (desktop/watchface/recoverBin.ts).
import type { WatchfaceCarriedPreferences } from "../../watchface/engine/watchfaceCarriedPreferences";
import { NATIVE_CHART_SOURCES } from "../../watchface/watchfaceNativeCatalog";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import catalogFile from "../../watchface/assets/templateCatalog.json";
import { buildsFromNativeLayout, buildWatchfaceArchive, type NativeLayoutTarget, type WatchfaceBuildInput } from "../../watchface/archive/build";
import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from "../../watchface/archive/worker";
import { standardizeWatchfacePackage } from "../../watchface/archive/distribution";
import { describeTemplate, inspectTemplate, openTemplate, templateAssets, templateConfigTexts, validateArchiveInventory, type TemplateInfo } from "../../watchface/archive/template";
import { parseCorosFaceMagic } from "../../watchface/corosBinLayout";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import { getWatchfaceTarget, WATCHFACE_TARGETS, type WatchfaceTarget } from "../../watchface/watchfaceTargets";
import type { CorosWatchfaceDesignState, CorosWatchfacePreviewAnimation, CorosWatchfaceTheme } from "../../watchface/types";
import { recoverCompiledCorosWatchface } from "../../watchface/recoverBin";
import { CorosWatchfaceCompiler, type WatchfaceImageOptions } from "./compile";
import { isLocalTemplateId, WatchfaceConverter } from "./convert";
import { PhoneSend } from "./phoneSend";
import { archiveTemplate, publishToCoros } from "./corosShare";
import { prepareWatchfaceConversion } from "../../watchface/engine/watchfaceConversion";
import { NO_WATCH, PickedFolders, PreparedFaces, saveUnpackedTo, saveZipTo, SendProblem } from "./send";
import { CommunityCatalog, CommunityProblem, type CommunityQuery } from "./community";
import { AccountProblem, type CorosAccount } from "./corosAccount";
import type { CorosCatalog } from "./corosMobile";
import { OfficialAssetLibrary, OfficialProblem } from "./officialAssets";
import { GoogleFonts, GoogleFontsProblem } from "./googleFonts";
import { t } from "@/lib/i18n";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const problem = (message: string, code = "problem", status = 400) => json({ error: { code, message } }, status);
/** A download. The name goes as UTF-8 too (filename*), so a face named in Chinese keeps its name. */
export function disposition(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  const ascii = stem.replace(/[^\w .()-]+/g, "").trim() || "watch face";
  return `attachment; filename="${ascii}${ext.replace(/[^\w.]+/g, "")}"; filename*=UTF-8''${encodeURIComponent(name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ""))}`;
}
const file = (bytes: Buffer, type: string, name: string, extra: Record<string, string> = {}) => new Response(new Uint8Array(bytes), {
  headers: { "Content-Type": type, "Cache-Control": "no-store", "Content-Disposition": disposition(name), ...extra },
});

/** A build request carries sprites (≤20 MB) and two 800 px pictures as base64. */
const MAX_BODY = 64 * 1024 * 1024;
const MAX_PACKAGE = 25 * 1024 * 1024;
const MAX_PREVIEW = 10 * 1024 * 1024;
const MAX_PROJECT = 60 * 1024 * 1024;
const MAX_PROJECT_ZIP = 100 * 1024 * 1024;
const MAX_CACHED_PACKAGES = 150;
const ARCHIVE_WORKER = path.join(__dirname, "watchfaceArchive.cjs");

export class StudioProblem extends Error {
  constructor(message: string, readonly code = "problem", readonly status = 400) { super(message); }
}

interface CatalogFile { source: string; firmware: Record<string, { savedAt: string; themes: CorosWatchfaceTheme[] }> }
const CATALOG = catalogFile as CatalogFile;

/** A template as the page lists it. Package and picture URLs stay here; the page asks for them by id. */
export interface StudioTemplate { id: string; name: string; category?: string; watchFaceVersion?: number; templateType?: number }

/** project.json, as CorosLink writes it, plus `startedFrom` while the design is still the empty one it was made with. */
export interface StoredProject {
  projectId: string;
  name: string;
  updatedAt: string;
  sourceTemplateId: string;
  firmwareType?: string;
  design: CorosWatchfaceDesignState;
  /** Made here and not opened yet: Studio sets the design up from the template ("blank" clears it) on first open. */
  startedFrom?: "template" | "blank";
  /** A converted copy made for All watches and removed after; never listed, cleaned up after an hour. */
  scratch?: true;
  /** A face rebuilt for another watch: the chart group it had open, so it opens on the same one (CorosLink's carriedPreferences). */
  carried?: WatchfaceCarriedPreferences;
}
export type ProjectSummary = Omit<StoredProject, "design"> & { previewUpdatedAt?: string };

/** What a conversion did, for the page to say. */
export interface ConversionResult {
  /** Rebuilt from the face's own layout with the edits applied (a recovered face, or one with no 800 px master). */
  rebuilt: boolean;
  /** An AMOLED watch got an always-on layout copied from Current, to be reviewed. */
  generatedAod: boolean;
  /** COROS couldn't be reached on first use: the copy installs from this app but has no COROS template to publish. */
  noCorosTemplate: boolean;
}

/** The watch a firmware type or model names, PACE Pro when it names none. */
function watchOf(value: unknown): WatchfaceTarget {
  return (typeof value === "string" ? getWatchfaceTarget(value) : undefined) ?? WATCHFACE_TARGETS[0];
}

/** The catalog entries for a watch: COROS's editable templates for its firmware, newest format first as COROS lists them. */
export function templatesFor(watch: WatchfaceTarget): { savedAt: string; themes: CorosWatchfaceTheme[] } {
  return CATALOG.firmware[watch.firmwareType] ?? { savedAt: "", themes: [] };
}

function themeFor(watch: WatchfaceTarget, id: string): CorosWatchfaceTheme {
  const theme = templatesFor(watch).themes.find((t) => t.id === id);
  if (!theme?.packageUrl) throw new StudioProblem(t("That template isn't in the catalog."), "noTemplate", 404);
  return theme;
}

export function sanitizeProjectName(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  const name = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name.length > 80) throw new StudioProblem(t("Project names must contain between 1 and 80 characters."), "badName");
  return name;
}

/** "Name copy", then "Name copy 2", … (CorosLink's createDuplicateProjectName). */
export function duplicateName(source: string, existing: Iterable<string>): string {
  const clean = sanitizeProjectName(source);
  const copy = clean.match(/^(.*?)\s+copy(?:\s+(\d+))?$/i);
  const root = copy?.[1]?.trim() || clean;
  const sourceNumber = copy?.[2] ? Number(copy[2]) : 1;
  const first = copy ? (Number.isSafeInteger(sourceNumber) && sourceNumber < Number.MAX_SAFE_INTEGER ? sourceNumber + 1 : 2) : 1;
  const taken = new Set(Array.from(existing, (n) => n.trim().toLowerCase()));
  for (let n = first; ; n++) {
    const suffix = n === 1 ? " copy" : ` copy ${n}`;
    const candidate = `${root.slice(0, Math.max(1, 80 - suffix.length)).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The carried chart groups, kept only when they name chart readouts the catalog knows. */
function carriedOf(value: unknown): { carried?: WatchfaceCarriedPreferences } {
  const chart = (value as WatchfaceCarriedPreferences | undefined)?.chartSource;
  if (!chart || typeof chart !== "object") return {};
  const known = new Set<string>(NATIVE_CHART_SOURCES.map((c) => c.id));
  const chartSource = Object.fromEntries((["current", "aod"] as const).flatMap((m) => (typeof chart[m] === "string" && known.has(chart[m]!) ? [[m, chart[m]!]] : [])));
  return Object.keys(chartSource).length ? { carried: { chartSource } } : {};
}

function checkDesign(design: unknown): CorosWatchfaceDesignState {
  if (!design || typeof design !== "object" || (design as { version?: unknown }).version !== 1) throw new StudioProblem(t("The watchface project design is invalid."), "badDesign");
  if (Buffer.byteLength(JSON.stringify(design), "utf8") > MAX_PROJECT) throw new StudioProblem(t("The watchface project is too large to save."), "tooBig", 413);
  return design as CorosWatchfaceDesignState;
}

/** The website plays at most this many frames (CorosLink-web's MAX_ANIMATION_FRAMES). */
const MAX_PREVIEW_ANIMATION_FRAMES = 44;
/** As the editor caps it (watchfacePreviewAnimation.ts); this side doesn't load canvas code. */
const MAX_PREVIEW_ANIMATION_BYTES = 16 * 1024 * 1024;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * The website's copy of the face's animation (CorosLink's portablePreviewAnimation), when it is
 * well formed and lines up with `preview`; anything else is left out rather than failing the export.
 */
export function portablePreviewAnimation(value: unknown, preview: Buffer): CorosWatchfacePreviewAnimation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { version, size, x, y, width, height, delays, frames, under, over, watch } = value as Partial<Record<keyof CorosWatchfacePreviewAnimation, unknown>>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const previewSize = preview.byteLength >= 24 ? [preview.readUInt32BE(16), preview.readUInt32BE(20)] : [];
  if (version !== 1 || !Number.isInteger(size) || (size as number) < 64 || (size as number) > 2048) return undefined;
  const edge = size as number;
  const ok = previewSize[0] === edge && previewSize[1] === edge &&
    [x, y].every((n) => finite(n) && Math.abs(n) <= edge * 2) &&
    [width, height].every((n) => finite(n) && n > 0 && n <= edge * 2) &&
    Array.isArray(frames) && frames.length >= 1 && frames.length <= MAX_PREVIEW_ANIMATION_FRAMES &&
    Array.isArray(delays) && delays.length === frames.length &&
    delays.every((delay) => Number.isInteger(delay) && delay >= 1 && delay <= 65535) &&
    [under, over, ...frames].every((url) => typeof url === "string" && PNG_DATA_URL.test(url)) &&
    (watch === undefined || (typeof watch === "string" && /^[a-z0-9-]{1,40}$/.test(watch)));
  if (!ok) return undefined;
  const urls = [under, over, ...frames] as string[];
  if (urls.reduce((sum, url) => sum + url.length, 0) > MAX_PREVIEW_ANIMATION_BYTES) return undefined;
  return {
    version: 1, size: edge, x: x as number, y: y as number, width: width as number, height: height as number,
    delays: [...delays as number[]], frames: [...frames as string[]], under: under as string, over: over as string,
    ...(watch ? { watch: watch as string } : {}),
  };
}

function pngFromDataUrl(value: unknown): Buffer | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new StudioProblem(t("The preview is not a PNG image."), "badPreview");
  const bytes = Buffer.from(value.slice(22), "base64");
  if (!bytes.length || bytes.length > MAX_PREVIEW || bytes.readUInt32BE(0) !== 0x89504e47) throw new StudioProblem(t("The preview is not a PNG image."), "badPreview");
  return bytes;
}

async function writeWhole(target: string, data: string | Buffer): Promise<void> {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temp, data);
    await fs.promises.rename(temp, target);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}

/** Runs buildWatchfaceArchive in its worker; in this thread only if the worker can't start (tests, a missing build). */
function buildInWorker(starter: Buffer, input: WatchfaceBuildInput, script: string, native?: NativeLayoutTarget): Promise<Buffer> {
  const inProcess = () => new Promise<Buffer>((resolve, reject) => { try { resolve(buildWatchfaceArchive(starter, input, native)); } catch (e) { reject(e); } });
  if (!fs.existsSync(script)) return inProcess();
  let worker: Worker;
  try { worker = new Worker(script); } catch { return inProcess(); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); action();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(t("The watch face took too long to build.")))), 120_000);
    worker.once("message", (answer: ArchiveWorkerResponse) => finish(() => {
      if ("error" in answer) reject(new StudioProblem(answer.error, "buildFailed"));
      else resolve(Buffer.from(answer.archive.buffer, answer.archive.byteOffset, answer.archive.byteLength));
    }));
    worker.once("error", () => finish(() => { inProcess().then(resolve, reject); }));
    worker.once("exit", () => finish(() => reject(new Error(t("The watch-face builder stopped unexpectedly.")))));
    worker.postMessage({ starter, input, ...(native ? { native: { model: native.target.model, carrier: native.carrier } } : {}) } satisfies ArchiveWorkerRequest);
  });
}

export interface StudioOptions {
  fetch?: typeof fetch;
  now?: () => number;
  archiveWorker?: string;
  compilerWorker?: string;
  /** The COROS account for its face catalogs; without one those routes say to sign in. */
  account?: CorosAccount;
  /** The Community catalog (defaults to watchfaces.coroslink.com with this fetch). */
  community?: CommunityCatalog;
  /** The app's folder picker, for All watches and Development export; null when cancelled. */
  pickFolder?: () => Promise<string | null>;
  /** Send to iPhone's local server (tests pass one with fixed addresses). */
  phone?: PhoneSend;
  /** The official asset library (defaults to the hosted one, with the account's official catalog as its fallback). */
  official?: OfficialAssetLibrary;
  googleFonts?: GoogleFonts;
  /** The watch paired to this computer in Local mode (watch/service.ts), for Send → Watch; none means it can't install. */
  watch?: FaceWatch;
}

/** What Studio needs of the paired watch to install a face over Bluetooth. */
export interface FaceWatch {
  faceConnection(): { connected: boolean; reason?: string; model?: string };
  faces(): Promise<{ slots: { slot: number; faceId?: number }[]; shown: number | null }>;
  installFace(bin: Buffer, target?: { slot: number; expectedFaceId: number | null; replace: boolean }): Promise<{ slots: { slot: number; faceId?: number }[]; shown: number | null; installed?: number }>;
}

/** A COROS face as the page lists it: no URLs, the page asks for pictures and packages by ID. */
export interface CorosFace { id: string; name: string; category?: string; templateType?: number; watchFaceVersion?: number; picture: boolean }
const CATALOGS: readonly CorosCatalog[] = ["editable", "official", "custom"];
const catalogOf = (value: unknown): CorosCatalog => (CATALOGS.includes(value as CorosCatalog) ? (value as CorosCatalog) : "editable");

export class WatchfaceStudio {
  readonly root: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly compiler: CorosWatchfaceCompiler;
  private readonly archiveWorker: string;
  readonly account?: CorosAccount;
  readonly community: CommunityCatalog;
  readonly prepared: PreparedFaces;
  private readonly converter: WatchfaceConverter;
  readonly phone: PhoneSend;
  readonly official: OfficialAssetLibrary;
  readonly googleFonts: GoogleFonts;
  private readonly folders = new PickedFolders();
  private readonly pickFolder?: () => Promise<string | null>;
  private readonly watch?: FaceWatch;
  /** Read starters by path and mtime, so opening a face doesn't read its starter once per request. */
  private starters = new Map<string, { mtimeMs: number; bytes: Buffer }>();

  constructor(data: string, options: StudioOptions = {}) {
    this.root = path.join(data, "studio");
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
    this.archiveWorker = options.archiveWorker ?? ARCHIVE_WORKER;
    this.compiler = new CorosWatchfaceCompiler(path.join(this.root, "compiler"), options.compilerWorker);
    this.account = options.account;
    this.pickFolder = options.pickFolder;
    this.watch = options.watch;
    this.prepared = new PreparedFaces(this.now);
    this.phone = options.phone ?? new PhoneSend();
    // Carriers for Convert come from the same template catalog and downloads as new faces (no sign-in needed).
    this.converter = new WatchfaceConverter(path.join(this.root, "conversion"), {
      templates: async (target) => templatesFor(target).themes.filter((t) => t.id && t.packageUrl).map((t) => ({ id: t.id!, name: t.name })),
      download: (target, templateId) => this.download(themeFor(target, templateId).packageUrl!, "package"),
    });
    this.community = options.community ?? new CommunityCatalog(path.join(this.root, "community-imports"), { fetch: this.fetch, now: this.now });
    // Official artwork (officialAssets.ts): the hosted library, else built from the signed-in account's official faces.
    const account = this.account;
    this.official = options.official ?? new OfficialAssetLibrary(path.join(this.root, "official-assets"), {
      fetch: this.fetch, now: this.now,
      ...(account ? { catalog: {
        faces: async (firmwareType) => (await account.themes("official", { firmwareType })).filter((t) => t.id && t.packageUrl).map((t) => ({ id: t.id!, name: t.name, packageUrl: t.packageUrl! })),
        download: (packageUrl) => account.fetchPackage(packageUrl),
      } } : {}),
    });
    this.googleFonts = options.googleFonts ?? new GoogleFonts(path.join(this.root, "google-fonts"), { fetch: this.fetch, now: this.now });
  }

  private get projects(): string { return path.join(this.root, "projects"); }

  private projectDir(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new StudioProblem(t("That project isn't here."), "missing", 404);
    return path.join(this.projects, id);
  }

  // ───── Templates ─────

  /** COROS's editable templates for a watch, as the page lists them. */
  templates(watch: WatchfaceTarget): { savedAt: string; templates: StudioTemplate[] } {
    const { savedAt, themes } = templatesFor(watch);
    return {
      savedAt,
      templates: themes.filter((t) => t.id && t.packageUrl).map((t) => ({
        id: t.id!, name: t.name, ...(t.category ? { category: t.category } : {}),
        ...(t.watchFaceVersion !== undefined ? { watchFaceVersion: t.watchFaceVersion } : {}),
        ...(t.templateType !== undefined ? { templateType: t.templateType } : {}),
      })),
    };
  }

  /** A catalog URL's bytes, from the cache or COROS. Only URLs from the bundled catalog get here. */
  private async download(url: string, kind: "package" | "preview", get?: (url: string) => Promise<Buffer>): Promise<Buffer> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "coros.com" || parsed.hostname.endsWith(".coros.com"))) {
      throw new StudioProblem(t("Templates only come from COROS."), "badUrl");
    }
    const folder = path.join(this.root, "templates", kind === "package" ? "packages" : "pictures");
    const cached = path.join(folder, `${createHash("sha256").update(url).digest("hex").slice(0, 40)}.${kind === "package" ? "bin" : "png"}`);
    const valid = (bytes: Buffer) => bytes.length >= 4 && (kind === "preview"
      ? bytes.readUInt32BE(0) === 0x89504e47 || (bytes[0] === 0xff && bytes[1] === 0xd8)
      : (bytes[0] === 0x50 && bytes[1] === 0x4b) || Boolean(parseCorosFaceMagic(bytes.toString("latin1", 0, 4))));
    try {
      const bytes = await fs.promises.readFile(cached);
      if (valid(bytes)) {
        const now = new Date();
        await fs.promises.utimes(cached, now, now).catch(() => {});
        return bytes;
      }
    } catch { /* not cached yet */ }
    let bytes: Buffer;
    if (get) bytes = await get(url);
    else {
      let answer: Response;
      try { answer = await this.fetch(url); } catch { throw new StudioProblem(t("COROS couldn't be reached. Check the connection and try again."), "offline", 502); }
      if (!answer.ok) throw new StudioProblem(t("COROS answered {status} for that template.", { status: answer.status }), "download", 502);
      bytes = Buffer.from(await answer.arrayBuffer());
    }
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      // Package CDNs sometimes serve the archive gzip-wrapped.
      try { bytes = (await import("node:zlib")).gunzipSync(bytes); } catch { /* checked below */ }
    }
    if (!bytes.length || bytes.length > MAX_PACKAGE || !valid(bytes)) throw new StudioProblem(t("COROS sent something that isn't a template."), "download", 502);
    await fs.promises.mkdir(folder, { recursive: true });
    await writeWhole(cached, bytes).catch(() => {});
    if (kind === "package") await this.prunePackages(folder);
    return bytes;
  }

  private async prunePackages(folder: string): Promise<void> {
    const names = (await fs.promises.readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".bin"));
    if (names.length <= MAX_CACHED_PACKAGES) return;
    const dated = await Promise.all(names.map(async (n) => ({ n, at: (await fs.promises.stat(path.join(folder, n)).catch(() => null))?.mtimeMs ?? 0 })));
    dated.sort((a, b) => a.at - b.at);
    await Promise.all(dated.slice(0, dated.length - MAX_CACHED_PACKAGES).map(({ n }) => fs.promises.rm(path.join(folder, n), { force: true }).catch(() => {})));
  }

  async templatePicture(watch: WatchfaceTarget, id: string): Promise<Buffer> {
    const theme = templatesFor(watch).themes.find((t) => t.id === id) ?? this.account?.theme("editable", id);
    if (!theme?.previewImageUrl) throw new StudioProblem(t("That template has no picture."), "missing", 404);
    return this.download(theme.previewImageUrl, "preview");
  }

  // ───── Projects ─────

  private async readStored(id: string): Promise<StoredProject> {
    const manifest = path.join(this.projectDir(id), "project.json");
    let parsed: StoredProject & { sourceTemplateId: string | number };
    try {
      const stat = await fs.promises.stat(manifest);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT) throw new Error("size");
      parsed = JSON.parse(await fs.promises.readFile(manifest, "utf8")) as StoredProject & { sourceTemplateId: string | number };
    } catch {
      throw new StudioProblem(t("That project isn't here any more."), "missing", 404);
    }
    const sourceTemplateId = typeof parsed.sourceTemplateId === "number" && Number.isSafeInteger(parsed.sourceTemplateId) ? String(parsed.sourceTemplateId) : parsed.sourceTemplateId;
    if (parsed.projectId !== id || typeof parsed.name !== "string" || typeof parsed.updatedAt !== "string" ||
      typeof sourceTemplateId !== "string" || !/^\d{1,20}$/.test(sourceTemplateId) || parsed.design?.version !== 1) {
      throw new StudioProblem(t("The saved watchface project metadata is invalid."), "damaged", 500);
    }
    return { ...parsed, sourceTemplateId };
  }

  private async starter(id: string): Promise<Buffer> {
    const dir = this.projectDir(id);
    const primary = path.join(dir, "starter.dat"), legacy = path.join(dir, "starter.zip");
    const target = fs.existsSync(primary) ? primary : legacy;
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(target); } catch { throw new StudioProblem(t("This project's template is missing."), "missing", 404); }
    const known = this.starters.get(target);
    if (known && known.mtimeMs === stat.mtimeMs) return known.bytes;
    const bytes = await fs.promises.readFile(target);
    this.starters.set(target, { mtimeMs: stat.mtimeMs, bytes });
    while (this.starters.size > 4) this.starters.delete(this.starters.keys().next().value!);
    return bytes;
  }

  private async writeProject(stored: StoredProject, starter?: Buffer, preview?: Buffer | null): Promise<StoredProject> {
    const dir = this.projectDir(stored.projectId);
    await fs.promises.mkdir(dir, { recursive: true });
    if (starter) await writeWhole(path.join(dir, "starter.dat"), starter);
    if (preview) await writeWhole(path.join(dir, "preview.png"), preview);
    const manifest = path.join(dir, "project.json");
    await writeWhole(manifest, JSON.stringify(stored));
    await this.writeSummary(stored, manifest);
    return stored;
  }

  /**
   * summary.json beside project.json: the project without its design, tied to project.json's size and time, so the
   * list doesn't read every design (those run to tens of MB each). One that doesn't match is ignored and made again.
   */
  private async writeSummary(stored: StoredProject, manifest: string): Promise<void> {
    try {
      const { size, mtimeMs } = await fs.promises.stat(manifest);
      const { design: _design, ...project } = stored;
      await writeWhole(path.join(path.dirname(manifest), "summary.json"), JSON.stringify({ size, mtimeMs, project }));
    } catch { /* the list reads project.json instead */ }
  }

  private async readSummary(id: string): Promise<Omit<StoredProject, "design">> {
    const dir = this.projectDir(id), manifest = path.join(dir, "project.json");
    try {
      const { size, mtimeMs } = await fs.promises.stat(manifest);
      const saved = JSON.parse(await fs.promises.readFile(path.join(dir, "summary.json"), "utf8")) as { size?: number; mtimeMs?: number; project?: ProjectSummary };
      if (saved.size === size && saved.mtimeMs === mtimeMs && saved.project?.projectId === id &&
        typeof saved.project.name === "string" && typeof saved.project.updatedAt === "string") return saved.project;
    } catch { /* none yet, or damaged */ }
    const stored = await this.readStored(id);
    await this.writeSummary(stored, manifest);
    const { design: _design, ...summary } = stored;
    return summary;
  }

  /** Every project, last edited first, without designs (those can be tens of MB). Damaged folders are skipped. */
  async list(): Promise<ProjectSummary[]> {
    const names = await fs.promises.readdir(this.projects).catch(() => [] as string[]);
    const found = await Promise.all(names.filter((n) => /^[a-f0-9-]{36}$/i.test(n)).map(async (id): Promise<ProjectSummary | null> => {
      try {
        const summary = await this.readSummary(id);
        if (summary.scratch) {
          if (Date.parse(summary.updatedAt) < this.now() - 60 * 60_000) await this.remove(id);
          return null;
        }
        const preview = await fs.promises.stat(path.join(this.projects, id, "preview.png")).catch(() => null);
        return { ...summary, ...(preview?.isFile() ? { previewUpdatedAt: preview.mtime.toISOString() } : {}) };
      } catch { return null; }
    }));
    return found.filter((p): p is ProjectSummary => !!p).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async open(id: string): Promise<{ project: StoredProject; template: TemplateInfo }> {
    const project = await this.readStored(id);
    return { project, template: inspectTemplate(await this.starter(id)) };
  }

  /** A new project on a catalog template. `blank` starts it empty (the template's layout with everything switched off). */
  async create(input: { watch?: unknown; templateId?: unknown; blank?: unknown; name?: unknown; design?: unknown }): Promise<StoredProject> {
    const watch = watchOf(input.watch);
    const id = String(input.templateId ?? "");
    const live = this.account?.theme("editable", id);
    const theme = live?.packageUrl && !templatesFor(watch).themes.some((t) => t.id === id) ? live : themeFor(watch, id);
    const starter = await this.download(theme.packageUrl!, "package", theme === live ? (u) => this.account!.fetchPackage(u) : undefined);
    let info: TemplateInfo;
    try { info = inspectTemplate(starter); } catch (e) { throw new StudioProblem(e instanceof Error ? t("That template can't be edited: {reason}", { reason: e.message }) : t("That template can't be edited: it isn't a DIY template"), "notTemplate"); }
    const blank = input.blank === true;
    return this.writeProject({
      projectId: randomUUID(),
      name: sanitizeProjectName(input.name ?? (blank ? t("Blank face") : theme.name)),
      updatedAt: new Date(this.now()).toISOString(),
      sourceTemplateId: info.sourceTemplateId,
      firmwareType: watch.firmwareType,
      design: checkDesign(input.design),
      startedFrom: blank ? "blank" : "template",
    }, starter);
  }

  async save(id: string, input: { name?: unknown; design?: unknown; previewDataUrl?: unknown }): Promise<ProjectSummary> {
    const before = await this.readStored(id);
    const { startedFrom: _started, ...rest } = before;
    const stored = await this.writeProject({
      ...rest, name: sanitizeProjectName(input.name ?? before.name), design: checkDesign(input.design),
      updatedAt: new Date(this.now()).toISOString(),
    }, undefined, pngFromDataUrl(input.previewDataUrl));
    const { design: _design, ...summary } = stored;
    return summary;
  }

  async duplicate(id: string): Promise<ProjectSummary> {
    const source = await this.readStored(id);
    const starter = await this.starter(id);
    const preview = await fs.promises.readFile(path.join(this.projectDir(id), "preview.png")).catch(() => null);
    const { design: _design, ...summary } = await this.writeProject({
      ...source, projectId: randomUUID(), name: duplicateName(source.name, (await this.list()).map((p) => p.name)),
      updatedAt: new Date(this.now()).toISOString(),
    }, starter, preview);
    return summary;
  }

  /**
   * A new project for another watch, converted from this one's 800 px master with that watch's official carrier
   * (convert.ts); this project is left as it is. Raw config edits move into the new baseline; the design comes along.
   */
  async convert(id: string, input: { watch?: unknown; design?: unknown; name?: unknown; scratch?: unknown; build?: unknown; carried?: unknown }): Promise<{ project: ProjectSummary; result: ConversionResult }> {
    const target = typeof input.watch === "string" ? getWatchfaceTarget(input.watch) : undefined;
    if (!target || target.model !== input.watch) throw new StudioProblem(t("Choose a watch to convert to."), "badInput");
    const stored = await this.readStored(id);
    const info = inspectTemplate(await this.starter(id));
    if (buildsFromNativeLayout(info, target, watchOf(stored.firmwareType))) return this.convertBuilt(id, stored, target, input);
    const design = input.design === undefined ? stored.design : checkDesign(input.design);
    const edits = design.configTextEdits ?? {};
    let converted;
    try {
      converted = await this.converter.convert(await this.starter(id), target, { configTextEdits: edits });
    } catch (e) {
      throw new StudioProblem(e instanceof Error ? e.message : t("The face couldn't be converted."), "convert");
    }
    const ported = prepareWatchfaceConversion(design, {
      rawEditsApplied: converted.appliedRawConfigEditCount === Object.keys(edits).length,
      generatedAod: converted.generatedAod, aodDesignScale: converted.aodDesignScale,
    }).design;
    const preview = await fs.promises.readFile(path.join(this.projectDir(id), "preview.png")).catch(() => null);
    const { design: _design, ...summary } = await this.writeProject({
      projectId: randomUUID(),
      name: sanitizeProjectName(input.name ?? `${stored.name} (${target.label})`),
      updatedAt: new Date(this.now()).toISOString(),
      sourceTemplateId: converted.sourceTemplateId,
      firmwareType: target.firmwareType,
      design: ported,
      ...(input.scratch === true ? { scratch: true as const } : {}),
    }, converted.starter, preview);
    return { project: summary, result: { rebuilt: false, generatedAod: converted.generatedAod, noCorosTemplate: isLocalTemplateId(converted.sourceTemplateId) } };
  }

  /**
   * Convert for a face with no 800 px master to carry the design on (recovered from a BIN, or made in the COROS app):
   * the page's composition is built for the destination as Send does, and the finished archive becomes the new
   * project's starter. The edits are part of that starter, so the new project starts from it with an empty design.
   */
  private async convertBuilt(id: string, stored: StoredProject, target: WatchfaceTarget, input: { name?: unknown; scratch?: unknown; build?: unknown; carried?: unknown }): Promise<{ project: ProjectSummary; result: ConversionResult }> {
    if (!input.build || typeof input.build !== "object") throw new StudioProblem(t("This face is rebuilt for the other watch; send its composition."), "badInput");
    const { archive } = await this.buildFinal(id, input.build as WatchfaceBuildInput, target.model);
    const info = inspectTemplate(archive);
    const preview = await fs.promises.readFile(path.join(this.projectDir(id), "preview.png")).catch(() => null);
    const { design: _design, ...summary } = await this.writeProject({
      projectId: randomUUID(),
      name: sanitizeProjectName(input.name ?? `${stored.name} (${target.label})`),
      updatedAt: new Date(this.now()).toISOString(),
      sourceTemplateId: info.sourceTemplateId,
      firmwareType: target.firmwareType,
      design: { version: 1 } as CorosWatchfaceDesignState,
      startedFrom: "template",
      ...(input.scratch === true ? { scratch: true as const } : {}),
      ...carriedOf(input.carried),
    }, archive, preview);
    return { project: summary, result: { rebuilt: true, generatedAod: false, noCorosTemplate: isLocalTemplateId(info.sourceTemplateId) } };
  }

  async remove(id: string): Promise<void> {
    await fs.promises.rm(this.projectDir(id), { recursive: true, force: true });
  }

  async preview(id: string): Promise<Buffer> {
    try { return await fs.promises.readFile(path.join(this.projectDir(id), "preview.png")); } catch { throw new StudioProblem(t("No preview yet."), "missing", 404); }
  }

  /**
   * Import: an Editable project ZIP (CorosLink's coroslink-project.json + one DAT + preview.png) keeps its design; a
   * plain DAT/ZIP face opens as a template. The watch is the one the face has layouts for, `watch` first.
   */
  async importFile(bytes: Buffer, fileName: string, preferred?: unknown, name?: string): Promise<StoredProject> {
    if (!bytes.length || bytes.length > MAX_PROJECT_ZIP) throw new StudioProblem(t("Choose a watch face ZIP, DAT or BIN smaller than 100 MB."), "tooBig", 413);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      if (!parseCorosFaceMagic(bytes.toString("latin1", 0, 4))) throw new StudioProblem(t("That file is not a watch face ZIP, DAT or BIN."), "notFace");
      // A compiled face: recovered into an editable starter (CorosLink's selectCompiledWatchface).
      const label = (name ?? fileName.replace(/\.(bin|zip|dat)$/i, "").trim()) || t("Imported face");
      try { bytes = recoverCompiledCorosWatchface(bytes, label.slice(0, 80)).zip; } catch (e) { throw new StudioProblem(e instanceof Error ? e.message : t("That BIN can't be opened."), "notFace"); }
    }
    const packaged = this.readProjectPackage(bytes);
    const starter = packaged?.starter ?? bytes;
    let info: TemplateInfo;
    try { info = inspectTemplate(starter); } catch (e) { throw new StudioProblem(e instanceof Error ? e.message : t("That file is not a watch face."), "notFace"); }
    const sizes = new Set(info.resolutionDirectories.map((d) => Number(d.match(/_(\d+)x/)?.[1])));
    const fits = (t: WatchfaceTarget) => sizes.has(t.previewSize);
    const asked = typeof preferred === "string" ? getWatchfaceTarget(preferred) : undefined;
    const listed = packaged?.firmwareType ? getWatchfaceTarget(packaged.firmwareType) : undefined;
    const watch = [listed, asked, ...WATCHFACE_TARGETS].find((t): t is WatchfaceTarget => !!t && fits(t));
    if (!watch) throw new StudioProblem(t("This face has no layout for a supported watch."), "noWatch");
    const named = name ?? packaged?.name ?? info.name ?? (fileName.replace(/\.(zip|dat|bin)$/i, "").trim() || t("Imported face"));
    return this.writeProject({
      projectId: randomUUID(),
      name: sanitizeProjectName(named.slice(0, 80)),
      updatedAt: new Date(this.now()).toISOString(),
      sourceTemplateId: info.sourceTemplateId,
      firmwareType: watch.firmwareType,
      design: packaged?.design ?? { version: 1 } as CorosWatchfaceDesignState,
      ...(packaged && !packaged.openAsTemplate ? {} : { startedFrom: "template" as const }),
    }, starter, packaged?.preview ?? null);
  }

  /** An Editable project ZIP's parts, or null when the ZIP is a plain face (CorosLink's readCorosWatchfaceProjectPackage). */
  private readProjectPackage(bytes: Buffer): { name: string; design: CorosWatchfaceDesignState; starter: Buffer; preview?: Buffer; firmwareType?: string; openAsTemplate?: boolean } | null {
    const { files } = openTemplate(bytes);
    const visible = files.filter((e) => !e.path.startsWith("__MACOSX/"));
    const manifests = visible.filter((e) => /^(?:[^/]+\/)?(?:coroslink-project|project)\.json$/i.test(e.path));
    if (manifests.length > 1) throw new StudioProblem(t("The editable watch-face package contains multiple project manifests."), "notFace");
    const manifestEntry = manifests[0];
    if (!manifestEntry) return null;
    validateArchiveInventory(readZip(bytes), 100, 130 * 1024 * 1024, MAX_PROJECT_ZIP, 8, "editable watch-face package");
    const prefix = manifestEntry.path.slice(0, manifestEntry.path.lastIndexOf("/") + 1);
    const dats = visible.filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/") && /\.dat$/i.test(e.path));
    if (dats.length !== 1) throw new StudioProblem(t("The editable watch-face package must contain exactly one DAT archive."), "notFace");
    const previewEntry = visible.find((e) => e.path === `${prefix}preview.png`);
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(manifestEntry.read().toString("utf8")) as Record<string, unknown>; } catch { throw new StudioProblem(t("The editable watch-face project manifest is not valid JSON."), "notFace"); }
    if (manifest.format !== "coroslink-watchface-project" || manifest.version !== 1 || typeof manifest.name !== "string" ||
      typeof manifest.sourceTemplateId !== "string" || !/^\d{1,20}$/.test(manifest.sourceTemplateId)) {
      throw new StudioProblem(t("This is not a supported CorosLink watch-face project."), "notFace");
    }
    const preview = previewEntry?.read();
    return {
      name: sanitizeProjectName(manifest.name), design: checkDesign(manifest.design), starter: dats[0].read(),
      ...(preview && preview.length && preview.readUInt32BE(0) === 0x89504e47 ? { preview } : {}),
      ...(typeof manifest.firmwareType === "string" ? { firmwareType: manifest.firmwareType } : {}),
      ...(manifest.openAsTemplate === true ? { openAsTemplate: true } : {}),
    };
  }

  /** CorosLink's portable project: coroslink-project.json, the starter reduced to the website's DAT standard, preview.png. */
  async exportProject(id: string, input: { name?: unknown; design?: unknown; previewDataUrl?: unknown; previewAnimation?: unknown }): Promise<{ zip: Buffer; name: string }> {
    const stored = await this.readStored(id);
    const name = sanitizeProjectName(input.name ?? stored.name);
    const design = checkDesign(input.design ?? stored.design);
    const preview = pngFromDataUrl(input.previewDataUrl) ?? await this.preview(id).catch(() => undefined);
    if (!preview) throw new StudioProblem(t("The editable project needs a preview picture."), "badPreview");
    // The website plays this over preview.png; the watch's own animation is compiled from `design`.
    const previewAnimation = portablePreviewAnimation(input.previewAnimation, preview);
    const starterBytes = await this.starter(id);
    const all = readZip(starterBytes);
    const standard = standardizeWatchfacePackage(
      all.filter((e) => !e.directory).map((e) => ({ name: e.path, data: e.read() })), all.filter((e) => e.directory).map((e) => e.path), name);
    const zip = createStoreZip([
      { name: "coroslink-project.json", data: Buffer.from(JSON.stringify({ format: "coroslink-watchface-project", version: 1, name, sourceTemplateId: stored.sourceTemplateId, ...(stored.firmwareType ? { firmwareType: stored.firmwareType } : {}), design, ...(previewAnimation ? { previewAnimation } : {}) })) },
      { name: "starter.dat", data: standard.changed ? createStoreZip(standard.entries) : starterBytes },
      { name: "preview.png", data: preview },
    ]);
    if (zip.length > MAX_PROJECT_ZIP) throw new StudioProblem(t("The editable watch-face package is too large to export."), "tooBig", 413);
    return { zip, name };
  }

  /**
   * The final watch archive (Final watch ZIP) for the project's watch, or for `watchModel` when the face is built from
   * its own layout (a recovered face or one with no 800 px master, scaled with that watch's carrier); any other face
   * reaches another watch through Convert.
   */
  async buildFinal(id: string, input: WatchfaceBuildInput, watchModel?: unknown): Promise<{ archive: Buffer; watch: WatchfaceTarget; name: string }> {
    const stored = await this.readStored(id);
    const own = watchOf(stored.firmwareType);
    const watch = watchModel === undefined || watchModel === null ? own : typeof watchModel === "string" ? getWatchfaceTarget(watchModel) : undefined;
    if (!watch || (watchModel != null && watch.model !== watchModel)) throw new StudioProblem(t("Choose a supported watch."), "badInput");
    const starter = await this.starter(id);
    const native = buildsFromNativeLayout(inspectTemplate(starter), watch, own);
    if (!native && watch.model !== own.model) throw new StudioProblem(t("Convert this face for {watch} first.", { watch: watch.label }), "badInput");
    let carrier;
    try { carrier = native ? await this.converter.nativeCarrier(starter, watch) : undefined; } catch (e) {
      throw new StudioProblem(e instanceof Error ? e.message : t("The face couldn't be built for that watch."), "convert");
    }
    const archive = await buildInWorker(starter, { ...input, firmwareType: watch.firmwareType, watchModel: watch.model }, this.archiveWorker,
      carrier ? { target: watch, carrier } : undefined);
    return { archive, watch, name: stored.name };
  }

  /** The BIN the watch installs: the final archive compiled for the project's watch, checked by compile.ts. */
  async buildBin(id: string, input: WatchfaceBuildInput, options: WatchfaceImageOptions = {}): Promise<{ bin: Buffer; warnings: string[]; name: string }> {
    const { archive, watch, name } = await this.buildFinal(id, input);
    return { ...(await this.compileArchive(archive, watch, name, options)), name };
  }

  /** Compiles a final archive for a watch, with the experimental image options (full color, smooth edges). */
  async compileArchive(archive: Buffer, watch: WatchfaceTarget, name: string, options: WatchfaceImageOptions = {}): Promise<{ bin: Buffer; warnings: string[] }> {
    const folder = path.join(this.root, "compiler", "archives");
    await fs.promises.mkdir(folder, { recursive: true });
    const source = path.join(folder, `${randomUUID()}.dat`);
    await fs.promises.writeFile(source, archive);
    try {
      const compiled = await this.compiler.compile(source, name, watch, {
        fullColor: options.fullColor === true && watch.display === "amoled", smoothEdges: options.smoothEdges === true && watch.display === "mip",
      });
      try {
        return { bin: await fs.promises.readFile(compiled.filePath), warnings: compiled.warnings };
      } finally {
        await fs.promises.rm(path.dirname(compiled.filePath), { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      await fs.promises.rm(source, { force: true }).catch(() => {});
    }
  }

  // ───── Sources: COROS's catalogs and Community ─────

  private requireAccount(): CorosAccount {
    if (!this.account) throw new StudioProblem(t("Sign in to your COROS account first."), "signedOut", 401);
    return this.account;
  }

  /** A COROS list for a watch, as the page shows it. Advanced filters default to the watch and English. */
  async corosFaces(catalog: CorosCatalog, watch: WatchfaceTarget, filters: { language?: string | null; maxVersion?: string | null; sn?: string | null; modelVersion?: string | null; firmwareType?: string | null } = {}): Promise<CorosFace[]> {
    const maxVersion = filters.maxVersion ? Number(filters.maxVersion) : undefined;
    const themes = await this.requireAccount().themes(catalog, {
      firmwareType: filters.firmwareType || watch.firmwareType, ...(filters.language ? { language: filters.language } : {}),
      ...(maxVersion !== undefined ? { maxWatchFaceVersion: maxVersion } : {}), ...(filters.sn ? { snCode: filters.sn } : {}),
      ...(filters.modelVersion ? { modelVersion: filters.modelVersion } : {}),
    });
    return themes.filter((t) => t.id && t.packageUrl).map((t) => ({
      id: t.id!, name: t.name, ...(t.category ? { category: t.category } : {}), ...(t.templateType !== undefined ? { templateType: t.templateType } : {}),
      ...(t.watchFaceVersion !== undefined ? { watchFaceVersion: t.watchFaceVersion } : {}), picture: Boolean(t.previewImageUrl),
    }));
  }

  private listedFace(catalog: CorosCatalog, id: string): CorosWatchfaceTheme {
    const theme = this.requireAccount().theme(catalog, id);
    if (!theme?.packageUrl) throw new StudioProblem(t("That face isn't in the list any more. Refresh and try again."), "missing", 404);
    return theme;
  }

  async corosPicture(catalog: CorosCatalog, id: string): Promise<Buffer> {
    const theme = this.listedFace(catalog, id);
    if (!theme.previewImageUrl) throw new StudioProblem(t("That face has no picture."), "missing", 404);
    return this.download(theme.previewImageUrl, "preview");
  }

  /** A COROS face (template, official or the account's own) as a new project. Official faces arrive as BINs. */
  async openCorosFace(catalog: CorosCatalog, id: string, watch: unknown, name?: unknown): Promise<StoredProject> {
    const theme = this.listedFace(catalog, id);
    const bytes = await this.download(theme.packageUrl!, "package", (u) => this.requireAccount().fetchPackage(u));
    const label = typeof name === "string" && name.trim() ? name.trim() : theme.name;
    return this.importFile(bytes, `${label}.zip`, theme.firmwareType ?? watch, label.slice(0, 80));
  }

  /** A Community face as a new project: its reviewed package, checked against the catalog's SHA-256. */
  async openCommunity(slug: unknown, model: unknown, watch: unknown): Promise<{ project: StoredProject; title: string }> {
    const { item, opened } = await this.community.download(slug, model, (bytes, face) => this.importFile(bytes, `${face.title}.zip`, watch, face.title.slice(0, 80)));
    return { project: opened, title: item.title };
  }

  /** /community… and /coros…, or null for the other routes. */
  private async answerSources(request: Request, route: string, url: URL, get: boolean): Promise<Response | null> {
    const q = url.searchParams;
    if (route === "/community" || route.startsWith("/community/")) {
      if (get && route === "/community") {
        const query: CommunityQuery = {
          ...(q.get("q") ? { q: q.get("q")! } : {}), ...(q.get("model") ? { model: q.get("model")! } : {}), ...(q.get("style") ? { style: q.get("style")! } : {}),
          sort: (q.get("sort") ?? "newest") as CommunityQuery["sort"], ...(q.get("view") === "designs" ? { view: "designs" as const } : {}),
          ...(q.get("group") ? { group: q.get("group")! } : {}), page: Number(q.get("page") ?? 1), pageSize: Number(q.get("pageSize") ?? 12),
        };
        return json(await this.community.list(query));
      }
      if (get && route === "/community/progress") return json({ progress: this.community.progress });
      let m = /^\/community\/previews\/([a-f0-9-]{36})$/i.exec(route);
      if (get && m) { const { bytes, type } = await this.community.preview(m[1]); return picture(bytes, type); }
      m = /^\/community\/animations\/([a-f0-9-]{36})$/i.exec(route);
      if (get && m) {
        const animation = await this.community.animation(m[1]);
        return animation ? picture(animation.bytes, animation.type) : problem(t("That face has no animation."), "notFound", 404);
      }
      m = /^\/community\/([a-z0-9-]{1,100})$/.exec(route);
      if (get && m) return json({ face: await this.community.face(m[1], q.get("model") || undefined) });
      m = /^\/community\/([a-z0-9-]{1,100})\/open$/.exec(route);
      if (!get && m) {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const { project, title } = await this.openCommunity(m[1], body.model, body.watch);
        return json({ project: summaryOf(project), title });
      }
      return problem(t("Not a Studio action."), "notFound", 404);
    }
    if (route === "/coros" || route.startsWith("/coros/")) {
      if (get && route === "/coros") return json({ account: this.account ? await this.account.status() : null });
      if (get && route === "/coros/faces") {
        return json({ faces: await this.corosFaces(catalogOf(q.get("catalog")), watchOf(q.get("watch")), {
          language: q.get("language"), maxVersion: q.get("maxVersion"), sn: q.get("sn"), modelVersion: q.get("modelVersion"), firmwareType: q.get("firmwareType"),
        }) });
      }
      let m = /^\/coros\/faces\/(\d{1,24})\/picture$/.exec(route);
      if (get && m) return picture(await this.corosPicture(catalogOf(q.get("catalog")), m[1]));
      if (get) return problem(t("Not a Studio action."), "notFound", 404);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      m = /^\/coros\/faces\/(\d{1,24})\/open$/.exec(route);
      if (m) return json({ project: summaryOf(await this.openCorosFace(catalogOf(body.catalog), m[1], body.watch, body.name)) });
      const account = this.requireAccount();
      if (route === "/coros/sign-in") return json({ account: await account.signIn(body) });
      if (route === "/coros/sign-in/saved") return json({ account: await account.signInSaved(body) });
      if (route === "/coros/sign-out") return json({ account: await account.signOut() });
      if (route === "/coros/forget") return json({ account: await account.forget() });
      return problem(t("Not a Studio action."), "notFound", 404);
    }
    return null;
  }

  /** /prepared…, /folders…, /watch: Send's routes, or null for the others (send.ts). */
  private async answerSend(request: Request, route: string, get: boolean): Promise<Response | null> {
    if (get && route === "/watch") return json({ watch: this.watch?.faceConnection() ?? NO_WATCH });
    if (get && route === "/watch/slots") {
      if (!this.watch) throw new SendProblem(NO_WATCH.reason!, "noWatch", 409);
      return json(await this.watch.faces());
    }
    if (get && route === "/phone") return json({ status: this.phone.status() });
    if (!get && route === "/phone/stop") { this.phone.stop(); return json({ status: this.phone.status() }); }
    if (!get && route === "/folders/pick") {
      if (!this.pickFolder) throw new SendProblem(t("Folders can't be picked here."), "folder");
      const picked = await this.pickFolder();
      return json({ folder: picked ? this.folders.add(picked) : null });
    }
    const m = /^\/prepared\/([a-f0-9-]{36})(\/[a-z-]+)$/i.exec(route);
    if (!m || get) return null;
    const [, pid, action] = m;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const item = this.prepared.get(pid);
    const name = typeof body.name === "string" && body.name.trim() ? sanitizeProjectName(body.name) : item.name;
    if (action === "/assets") return json({ assets: this.prepared.assets(pid, body.paths) });
    if (action === "/bin") {
      const { bin, warnings } = await this.compileArchive(item.archive, item.watch, name, { fullColor: body.fullColor === true, smoothEdges: body.smoothEdges === true });
      return file(bin, "application/octet-stream", `${name}.bin`, { "X-Clink-Warnings": encodeURIComponent(JSON.stringify(warnings)) });
    }
    if (action === "/final") return file(item.archive, "application/zip", `${name}.zip`);
    if (action === "/folder") {
      const folder = this.folders.path(body.folderId);
      const saved = body.unpacked === true ? await saveUnpackedTo(folder, name, item.archive) : await saveZipTo(folder, name, item.archive);
      return json({ saved });
    }
    if (action === "/phone") {
      try {
        // The Editable project goes too, so the phone keeps the face editable; without it the face goes alone.
        const project = body.design && typeof body.design === "object"
          ? await this.exportProject(item.projectId, { name, design: body.design, previewDataUrl: body.previewDataUrl }).then((p) => p.zip, () => undefined)
          : undefined;
        return json({ send: await this.phone.start({ data: item.archive, name, model: item.watch.model, project }) });
      } catch (e) { throw new SendProblem(e instanceof Error ? e.message : t("The face couldn't be offered to the iPhone."), "phone"); }
    }
    if (action === "/coros") {
      const { sourceTemplateId, watchFaceVersion } = archiveTemplate(item.archive);
      const backgroundImageId = typeof body.backgroundImageId === "number" ? body.backgroundImageId : 13;
      const link = await publishToCoros(this.requireAccount(), {
        archive: item.archive, name, firmwareType: item.watch.firmwareType, sourceTemplateId, watchFaceVersion, backgroundImageId,
      });
      return json({ link: { url: link.url, qrDataUrl: link.qrDataUrl, expiresAt: link.expiresAt } });
    }
    if (action === "/install") {
      const connection = this.watch?.faceConnection() ?? NO_WATCH;
      if (!this.watch || !connection.connected) throw new SendProblem(connection.reason ?? NO_WATCH.reason!, "noWatch", 409);
      // The watch side checks the BIN was built for its screen before sending anything (CorosKit requireInstallable).
      const { bin, warnings } = await this.compileArchive(item.archive, item.watch, name, { fullColor: body.fullColor === true, smoothEdges: body.smoothEdges === true });
      const slot = Number(body.slot);
      const target = Number.isInteger(slot) && slot >= 0 && slot <= 9
        ? { slot, expectedFaceId: typeof body.expectedFaceId === "number" ? body.expectedFaceId : null, replace: body.replace === true }
        : undefined;
      try {
        return json({ ...(await this.watch.installFace(bin, target)), warnings });
      } catch (e) { throw new SendProblem(e instanceof Error ? e.message : t("The face didn't install."), "install"); }
    }
    return problem(t("Not a Studio action."), "notFound", 404);
  }

  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.pathname.slice("/api/desktop/studio".length) || "/";
    const get = request.method === "GET";
    if (!get && request.headers.get("x-clink-hub") !== "1") return problem(t("Not from this app."), "forbidden", 403);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return problem(t("That's too big for a watch face."), "tooBig", 413);
    try {
      const sourced = await this.answerSources(request, route, url, get);
      if (sourced) return sourced;
      const sent = await this.answerSend(request, route, get);
      if (sent) return sent;
      const assets = (await this.official.answer(request, route, url, get)) ?? (await this.googleFonts.answer(request, route, url, get));
      if (assets) return assets;
      if (get && route === "/templates") return json(this.templates(watchOf(url.searchParams.get("watch"))));
      let m = /^\/templates\/(\d{1,20})\/picture$/.exec(route);
      if (get && m) {
        const bytes = await this.templatePicture(watchOf(url.searchParams.get("watch")), m[1]);
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": bytes[0] === 0xff ? "image/jpeg" : "image/png", "Cache-Control": "max-age=86400" } });
      }
      if (get && route === "/projects") return json({ projects: await this.list() });
      if (!get && route === "/projects/import") {
        const bytes = Buffer.from(await request.arrayBuffer());
        return json({ project: summaryOf(await this.importFile(bytes, url.searchParams.get("name") ?? "", url.searchParams.get("watch"))) });
      }
      const body = !get ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
      if (!get && route === "/projects") return json({ project: summaryOf(await this.create(body)) });
      m = /^\/projects\/([a-f0-9-]{36})(\/[a-z/-]+)?$/i.exec(route);
      if (!m) return problem(t("Not a Studio action."), "notFound", 404);
      const [, id, action = ""] = m;
      if (get && action === "") return json(await this.open(id));
      if (get && action === "/preview") return new Response(new Uint8Array(await this.preview(id)), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
      if (get && action === "/template") return json({ details: describeTemplate(await this.starter(id), id) });
      if (get && action === "/config-texts") return json({ files: templateConfigTexts(await this.starter(id)) });
      if (get) return problem(t("Not a Studio action."), "notFound", 404);
      if (action === "") return json({ project: await this.save(id, body) });
      if (action === "/assets") return json({ assets: templateAssets(await this.starter(id), body.paths, body.skipMissing === true) });
      if (action === "/duplicate") return json({ project: await this.duplicate(id) });
      if (action === "/delete") { await this.remove(id); return json({ deleted: true }); }
      if (action === "/export/project") {
        const { zip, name } = await this.exportProject(id, body);
        return file(zip, "application/zip", `${name} (editable).zip`);
      }
      if (action === "/export/final") {
        const { watch, ...input } = body;
        const { archive, name } = await this.buildFinal(id, input as unknown as WatchfaceBuildInput, watch);
        return file(archive, "application/zip", `${name}.zip`);
      }
      if (action === "/convert") return json(await this.convert(id, body));
      if (action === "/send/prepare") {
        // `watch`: another watch, for a face built from its own layout (All watches).
        const { watch: model, ...input } = body;
        const { archive, watch, name } = await this.buildFinal(id, input as unknown as WatchfaceBuildInput, model);
        return json({ prepared: this.prepared.summary(this.prepared.add({ projectId: id, name, watch, archive })) });
      }
      if (action === "/export/bin") {
        const { bin, warnings, name } = await this.buildBin(id, body as unknown as WatchfaceBuildInput);
        return file(bin, "application/octet-stream", `${name}.bin`, { "X-Clink-Warnings": encodeURIComponent(JSON.stringify(warnings)) });
      }
      return problem(t("Not a Studio action."), "notFound", 404);
    } catch (e) {
      if (e instanceof StudioProblem || e instanceof CommunityProblem || e instanceof AccountProblem || e instanceof SendProblem || e instanceof OfficialProblem || e instanceof GoogleFontsProblem) return problem(e.message, e.code, e.status);
      return problem(e instanceof Error ? e.message : t("Studio couldn't do that."), "failed", 500);
    }
  }
}

const picture = (bytes: Buffer, type?: string) => new Response(new Uint8Array(bytes), {
  headers: { "Content-Type": type ?? (bytes[0] === 0xff ? "image/jpeg" : "image/png"), "Cache-Control": "max-age=86400" },
});

function summaryOf(stored: StoredProject): ProjectSummary {
  const { design: _design, ...summary } = stored;
  return summary;
}
