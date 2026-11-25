// The official COROS asset library: every bitmap set in COROS's official faces (digit fonts, battery gauges, weather
// icons, status icons, backgrounds…), browsed from Studio and reused in the user's own faces. Rewritten from CorosLink's
// electron/corosOfficialAssetService.ts (docs/studio-port.md); its limits are tests in officialAssets.test.ts.
//
// - The library is prebuilt and hosted (R2 behind coroslink-assets.akerrules.ca/official-faces): one manifest, one
//   index per watch, and per set a preview strip and a ZIP of its frames. Nothing is fetched from anywhere else, no
//   redirect is followed, and every answer has a size limit (an archive is at most 25 MB).
// - The first visit for a watch downloads its index once (progress in bytes); strips arrive as pages are browsed and a
//   set's frames when it is opened, all kept under studio/official-assets/<firmware>. At most 4 downloads run at once.
// - A hosted index older than 24 h is fetched again in the background; the one on disk keeps serving meanwhile.
// - When the hosted library can't be reached (or has no index for the watch), the library is built here from COROS's
//   official catalog with the signed-in COROS account: each face downloaded once (4 at a time, ≤25 MB) and unpacked.
// - All of it is reading: the library's host is not COROS, and the fallback only lists and downloads official faces,
//   so Local-Only Mode (dataMode.ts) lets it through.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { encodeCorosRgbaPng } from "../../watchface/recoverBin";
import {
  OFFICIAL_CATEGORIES, OFFICIAL_FONT_ROLES, officialCategory, officialFontRole, officialTags,
  type OfficialCategory, type OfficialFontRole, type OfficialTag,
} from "../../watchface/officialAssetSets";
import { officialFaceSets, officialStrip } from "../../watchface/officialFaceSets";
import { getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import { readZip } from "../../watchface/zipRead";

export const OFFICIAL_LIBRARY_URL = "https://coroslink-assets.akerrules.ca/official-faces";
export const OFFICIAL_REFRESH_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_DOWNLOADS_AT_ONCE = 4;
/** An official archive (a set's frame ZIP, or a face in a local build) is at most 25 MB. */
export const MAX_OFFICIAL_ARCHIVE = 25 * 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;
const MAX_INDEX = 24 * 1024 * 1024;
const MAX_STRIP = 8 * 1024 * 1024;
const MAX_FRAMES = 512;
const MAX_PAGE = 96;
const VERSION = 1;
const ID = /^[0-9a-f]{16}$/;

export class OfficialProblem extends Error {
  constructor(message: string, readonly code = "official", readonly status = 502) { super(message); }
}

interface StoredAsset {
  id: string;
  category: OfficialCategory;
  role?: OfficialFontRole;
  width: number;
  height: number;
  frames: number;
  elementIds: string[];
  configKeys: string[];
  faces: string[];
  faceCount: number;
  strip: { width: number; height: number };
}
interface StoredLibrary {
  version: number;
  firmwareType: string;
  builtAt: string;
  source: "hosted" | "local";
  fetchedAt?: string;
  faceCount: number;
  assets: StoredAsset[];
}

export interface OfficialStatus {
  watch: string;
  state: "idle" | "loading" | "ready" | "error";
  source?: "hosted" | "local";
  /** While loading: bytes of the index, or faces unpacked in a local build. */
  done: number;
  total: number;
  unit: "bytes" | "faces";
  faceCount: number;
  assetCount: number;
  fetchedAt?: string;
  message?: string;
}
export interface OfficialAsset {
  id: string;
  category: OfficialCategory;
  role?: OfficialFontRole;
  width: number;
  height: number;
  frames: number;
  configKeys: string[];
  tags: OfficialTag[];
  /** Up to three faces it comes from, and how many in all. */
  faces: string[];
  faceCount: number;
  strip: { width: number; height: number };
}
export interface OfficialQuery {
  category?: string; role?: string; tag?: string; q?: string; frames?: "single" | "multi"; frameCount?: number; configKey?: string;
  page?: number; pageSize?: number;
}
export interface OfficialPage {
  status: OfficialStatus;
  categories: { id: string; label: string; count: number }[];
  roles: { id: string; label: string; count: number }[];
  tags: { id: string; label: string; count: number }[];
  frameCounts: { frames: number; count: number }[];
  total: number;
  page: number;
  pageSize: number;
  assets: OfficialAsset[];
}
/** A set's frames as PNG data URLs, in the watch's own order. */
export interface OfficialFrames { id: string; category: OfficialCategory; label: string; width: number; height: number; frames: string[] }

/** COROS's official faces for a watch, for the local build (the signed-in account's catalog). */
export interface OfficialCatalog {
  faces(firmwareType: string): Promise<{ id: string; name: string; packageUrl: string }[]>;
  download(packageUrl: string): Promise<Buffer>;
}

export interface OfficialOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** The hosted library, for tests; production reads only OFFICIAL_LIBRARY_URL. */
  url?: string;
  client?: string;
  catalog?: OfficialCatalog;
}

interface State { status: OfficialStatus; library: StoredLibrary | null; loading: Promise<void> | null; refreshing: Promise<void> | null }

const isPng = (bytes: Buffer) => bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47;
const frameName = (index: number) => `${String(index).padStart(2, "0")}.png`;

/** Runs at most `limit` tasks at once; the rest wait their turn. */
export class Limiter {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  /** The most that ever ran together (for tests). */
  peak = 0;
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    // A finished task hands its slot straight to the next one waiting, so a newcomer can't slip in between.
    if (this.running >= this.limit) await new Promise<void>((go) => this.waiting.push(go));
    else this.running += 1;
    this.peak = Math.max(this.peak, this.running);
    try { return await task(); } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.running -= 1;
    }
  }
}

function checkAsset(value: unknown): StoredAsset | null {
  const v = value as Partial<StoredAsset> | null;
  const whole = (n: unknown, max: number) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
  const strings = (list: unknown, max: number): list is string[] => Array.isArray(list) && list.length <= max && list.every((s) => typeof s === "string" && s.length <= 120);
  if (!v || typeof v.id !== "string" || !ID.test(v.id) || !whole(v.width, 4096) || !whole(v.height, 4096) || !whole(v.frames, MAX_FRAMES)) return null;
  if (!strings(v.elementIds, 400) || !strings(v.configKeys, 400) || !strings(v.faces, 8)) return null;
  if (!v.strip || !whole(v.strip.width, 8192) || !whole(v.strip.height, 65536)) return null;
  const category = (typeof v.category === "string" && v.category in OFFICIAL_CATEGORIES ? v.category : "other") as OfficialCategory;
  const role = typeof v.role === "string" && v.role in OFFICIAL_FONT_ROLES ? (v.role as OfficialFontRole) : undefined;
  return {
    id: v.id, category, ...(role ? { role } : {}), width: v.width!, height: v.height!, frames: v.frames!, elementIds: v.elementIds, configKeys: v.configKeys,
    faces: v.faces, faceCount: whole(v.faceCount, 1e6) ? v.faceCount! : v.faces.length, strip: { width: v.strip.width, height: v.strip.height },
  };
}

/** An index as the library sends it (or as it was saved), checked entry by entry; null when it isn't one for this watch. */
export function parseOfficialLibrary(text: string, firmwareType: string): StoredLibrary | null {
  let v: Partial<StoredLibrary> | null;
  try { v = JSON.parse(text) as Partial<StoredLibrary>; } catch { return null; }
  if (!v || v.version !== VERSION || v.firmwareType !== firmwareType || !Array.isArray(v.assets) || v.assets.length > 200_000) return null;
  const assets = v.assets.map(checkAsset).filter((a): a is StoredAsset => !!a);
  return {
    version: VERSION, firmwareType, builtAt: typeof v.builtAt === "string" ? v.builtAt : "", source: v.source === "local" ? "local" : "hosted",
    ...(typeof v.fetchedAt === "string" ? { fetchedAt: v.fetchedAt } : {}),
    faceCount: typeof v.faceCount === "number" && v.faceCount >= 0 ? Math.trunc(v.faceCount) : 0, assets,
  };
}

export class OfficialAssetLibrary {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly base: URL;
  private readonly client: string;
  private readonly catalog?: OfficialCatalog;
  private readonly states = new Map<string, State>();
  readonly downloads = new Limiter(OFFICIAL_DOWNLOADS_AT_ONCE);

  constructor(readonly folder: string, options: OfficialOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
    this.base = new URL(`${(options.url ?? OFFICIAL_LIBRARY_URL).replace(/\/+$/, "")}/`);
    this.client = options.client ?? "coroslink/clink-desktop";
    this.catalog = options.catalog;
  }

  // ───── The hosted library ─────

  /** A file of the hosted library, or null when it can't be had. Only the library's own host, no redirects, size-capped. */
  private async hosted(relative: string, max: number, progress?: (received: number, total: number) => void): Promise<Buffer | null> {
    const url = new URL(relative, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.search || url.hash) return null;
    return this.downloads.run(async () => {
      try {
        // The bucket's edge rule answers only requests with this header (it isn't a secret; it keeps the URL app-only).
        const answer = await this.fetch(url, { headers: { "X-CorosLink-Client": this.client, Accept: "*/*" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!answer.ok || !answer.body) return null;
        const total = Number(answer.headers.get("content-length") ?? 0) || 0;
        if (total > max) return null;
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.length;
          if (received > max) return null;
          chunks.push(Buffer.from(chunk));
          progress?.(received, total);
        }
        return received ? Buffer.concat(chunks) : null;
      } catch { return null; }
    });
  }

  private root(firmwareType: string): string {
    return path.join(this.folder, firmwareType.replace(/[^A-Za-z0-9]+/g, "-"));
  }

  private async write(target: string, bytes: Buffer | string): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await fs.promises.writeFile(temp, bytes); await fs.promises.rename(temp, target); } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  }

  /** The watch's index from the hosted library; false when there's none to be had. */
  private async fetchHosted(firmwareType: string, state: State, quiet = false): Promise<boolean> {
    const manifestBytes = await this.hosted("v1/manifest.json", MAX_MANIFEST);
    if (!manifestBytes) return false;
    let indexPath: unknown;
    try {
      const manifest = JSON.parse(manifestBytes.toString("utf8")) as { version?: number; models?: Record<string, { index?: unknown }> };
      if (manifest.version !== VERSION) return false;
      indexPath = manifest.models?.[firmwareType]?.index;
    } catch { return false; }
    if (typeof indexPath !== "string" || !/^v1\/models\/[A-Za-z0-9-]+\/library\.json$/.test(indexPath)) return false;
    let bytes = await this.hosted(indexPath, MAX_INDEX, quiet ? undefined : (done, total) => { state.status = { ...state.status, done, total, unit: "bytes" }; });
    if (!bytes) return false;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try { bytes = gunzipSync(bytes, { maxOutputLength: MAX_INDEX }); } catch { return false; }
    }
    const library = parseOfficialLibrary(bytes.toString("utf8"), firmwareType);
    if (!library) return false;
    library.source = "hosted";
    library.fetchedAt = new Date(this.now()).toISOString();
    await this.write(path.join(this.root(firmwareType), "library.json"), JSON.stringify(library));
    this.ready(firmwareType, state, library);
    return true;
  }

  private ready(firmwareType: string, state: State, library: StoredLibrary): void {
    state.library = library;
    state.status = {
      watch: firmwareType, state: "ready", source: library.source, done: library.faceCount, total: library.faceCount, unit: "faces",
      faceCount: library.faceCount, assetCount: library.assets.length, ...(library.fetchedAt ? { fetchedAt: library.fetchedAt } : {}),
    };
  }

  // ───── The local build ─────

  /** Builds the library from COROS's official catalog: each face downloaded once, unpacked, its sets merged by content. */
  private async buildLocal(firmwareType: string, state: State): Promise<void> {
    if (!this.catalog) throw new OfficialProblem("The official library couldn't be reached. Check the connection and try again.", "offline");
    const root = this.root(firmwareType);
    const faces = (await this.catalog.faces(firmwareType)).filter((f) => f.id && f.packageUrl);
    if (!faces.length) throw new OfficialProblem("COROS lists no official faces for this watch.", "empty", 404);
    state.status = { ...state.status, state: "loading", source: "local", done: 0, total: faces.length, unit: "faces", message: undefined };
    const assets = new Map<string, StoredAsset & { names: Set<string> }>();
    let unpacked = 0;
    await Promise.all(faces.map((face) => this.downloads.run(async () => {
      try {
        const cached = path.join(root, "faces", `${face.id.replace(/[^A-Za-z0-9_-]+/g, "")}.bin`);
        let bin: Buffer | null = await fs.promises.readFile(cached).catch(() => null);
        if (!bin) {
          const fetched = await this.catalog!.download(face.packageUrl);
          if (fetched.length > MAX_OFFICIAL_ARCHIVE) throw new Error("too big");
          await this.write(cached, fetched);
          bin = fetched;
        }
        for (const set of officialFaceSets(bin).sets) {
          if (set.frames.length > MAX_FRAMES) continue;
          let asset = assets.get(set.id);
          if (!asset) {
            // Entered before its files are written, so two faces unpacked together that share a set share one entry.
            const strip = officialStrip(set.width, set.height, set.frames);
            asset = { id: set.id, category: "other", width: set.width, height: set.height, frames: set.frames.length, elementIds: [], configKeys: [], faces: [], faceCount: 0, strip: { width: strip.width, height: strip.height }, names: new Set() };
            assets.set(set.id, asset);
            const dir = path.join(root, "assets", set.id);
            await fs.promises.mkdir(dir, { recursive: true });
            await Promise.all([
              ...set.frames.map((frame, i) => fs.promises.writeFile(path.join(dir, frameName(i)), encodeCorosRgbaPng(set.width, set.height, frame))),
              fs.promises.writeFile(path.join(dir, "strip.png"), encodeCorosRgbaPng(strip.width, strip.height, strip.rgba)),
            ]);
          }
          asset.elementIds = [...new Set([...asset.elementIds, ...set.elementIds])].sort();
          asset.configKeys = [...new Set([...asset.configKeys, ...set.configKeys])].sort();
          asset.names.add(face.name);
        }
        unpacked += 1;
      } catch { /* a face that can't be had or read is left out */ }
      state.status = { ...state.status, done: state.status.done + 1, assetCount: assets.size };
      // Lets the page's status polls through between faces.
      await new Promise((go) => setImmediate(go));
    })));
    if (!unpacked) throw new OfficialProblem("None of COROS's official faces for this watch could be downloaded.", "offline");
    // Named in COROS's order, whichever face finished unpacking first.
    const listed = [...new Set(faces.map((f) => f.name))];
    const library: StoredLibrary = {
      version: VERSION, firmwareType, builtAt: new Date(this.now()).toISOString(), source: "local", faceCount: unpacked,
      assets: [...assets.values()].map(({ names, ...asset }) => {
        const category = officialCategory(asset.elementIds, asset.configKeys);
        return { ...asset, category, ...(category === "fonts" ? { role: officialFontRole(asset.elementIds) } : {}), faces: listed.filter((name) => names.has(name)).slice(0, 3), faceCount: names.size };
      }).sort((a, b) => a.category.localeCompare(b.category) || b.faceCount - a.faceCount || a.id.localeCompare(b.id)),
    };
    await this.write(path.join(root, "library.json"), JSON.stringify(library));
    this.ready(firmwareType, state, library);
  }

  // ───── What Studio asks ─────

  private firmware(watch: unknown): string {
    const target = typeof watch === "string" ? getWatchfaceTarget(watch) : undefined;
    if (!target) throw new OfficialProblem("Choose a watch to browse official artwork for.", "badWatch", 400);
    return target.firmwareType;
  }

  private state(firmwareType: string): State {
    let state = this.states.get(firmwareType);
    if (!state) {
      let library: StoredLibrary | null = null;
      try { library = parseOfficialLibrary(fs.readFileSync(path.join(this.root(firmwareType), "library.json"), "utf8"), firmwareType); } catch { /* first visit */ }
      state = { library: null, loading: null, refreshing: null, status: { watch: firmwareType, state: "idle", done: 0, total: 0, unit: "bytes", faceCount: 0, assetCount: 0 } };
      if (library) this.ready(firmwareType, state, library);
      this.states.set(firmwareType, state);
    }
    return state;
  }

  /**
   * The library's state for a watch, starting its first download when there's none yet (`refresh` downloads it again).
   * Answers at once; the page asks again while it loads.
   */
  ensure(watch: unknown, refresh = false): OfficialStatus {
    const firmwareType = this.firmware(watch);
    const state = this.state(firmwareType);
    if (state.loading) return state.status;
    if (state.library && !refresh) {
      const fetched = state.library.source === "hosted" && state.library.fetchedAt ? Date.parse(state.library.fetchedAt) : NaN;
      if (!state.refreshing && this.now() - fetched > OFFICIAL_REFRESH_MS) {
        // A day-old index is fetched again quietly; if that fails, tomorrow's first visit tries again.
        state.refreshing = this.fetchHosted(firmwareType, state, true).then(() => {}, () => {}).finally(() => { state.refreshing = null; });
      }
      return state.status;
    }
    state.status = { watch: firmwareType, state: "loading", done: 0, total: 0, unit: "bytes", faceCount: 0, assetCount: 0 };
    state.loading = (async () => {
      try {
        if (!(await this.fetchHosted(firmwareType, state))) await this.buildLocal(firmwareType, state);
      } catch (e) {
        const message = e instanceof Error ? e.message : "The official library couldn't be loaded.";
        if (state.library) this.ready(firmwareType, state, state.library);
        state.status = { ...state.status, state: state.library ? "ready" : "error", message };
      } finally { state.loading = null; }
    })();
    return state.status;
  }

  /** Waits for a load or refresh in flight (tests, and the smoke run). */
  async settled(watch: unknown): Promise<OfficialStatus> {
    const state = this.state(this.firmware(watch));
    await state.loading;
    await state.refreshing;
    return state.status;
  }

  private asset(firmwareType: string, id: unknown): StoredAsset {
    const asset = typeof id === "string" && ID.test(id) ? this.state(firmwareType).library?.assets.find((a) => a.id === id) : undefined;
    if (!asset) throw new OfficialProblem("That artwork isn't in the library.", "missing", 404);
    return asset;
  }

  /** One page of sets, filtered, with the counts the filters show. */
  list(watch: unknown, input: OfficialQuery = {}): OfficialPage {
    const firmwareType = this.firmware(watch);
    const state = this.state(firmwareType);
    const all = state.library?.assets ?? [];
    const category = input.category && input.category in OFFICIAL_CATEGORIES ? input.category : undefined;
    const role = category === "fonts" && input.role && input.role in OFFICIAL_FONT_ROLES ? input.role : undefined;
    const tag = typeof input.tag === "string" && /^[a-z0-9-]{1,32}$/i.test(input.tag) ? input.tag : undefined;
    const configKey = typeof input.configKey === "string" && /^[a-z0-9_]{1,64}$/i.test(input.configKey) ? input.configKey : undefined;
    const frameCount = Number.isInteger(input.frameCount) && input.frameCount! > 0 ? input.frameCount : undefined;
    const terms = (input.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const inCategory = all.filter((a) => (!category || a.category === category) && (!configKey || a.configKeys.includes(configKey)) &&
      (!input.frames || (input.frames === "single" ? a.frames === 1 : a.frames > 1)));
    const inRole = inCategory.filter((a) => !role || a.role === role);
    const framed = inRole.filter((a) => !frameCount || a.frames === frameCount);
    const matches = framed.filter((a) => {
      if (tag && !officialTags(a.configKeys).some((t) => t.id === tag)) return false;
      if (!terms.length) return true;
      const hay = [a.id, a.category, a.role ?? "", `${a.width}x${a.height}`, ...a.configKeys, ...a.faces].join(" ").toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Math.trunc(Number(input.pageSize) || 36)));
    const page = Math.min(Math.max(1, Math.ceil(matches.length / pageSize)), Math.max(1, Math.trunc(Number(input.page) || 1)));

    const count = <K>(items: Iterable<K>) => { const m = new Map<K, number>(); for (const k of items) m.set(k, (m.get(k) ?? 0) + 1); return m; };
    const categories = count(all.map((a) => a.category)), roles = count(inCategory.filter((a) => !frameCount || a.frames === frameCount).flatMap((a) => (a.role ? [a.role] : [])));
    const tags = new Map<string, { label: string; count: number }>();
    for (const a of framed) for (const t of officialTags(a.configKeys)) tags.set(t.id, { label: t.label, count: (tags.get(t.id)?.count ?? 0) + 1 });
    return {
      status: state.status,
      categories: (Object.keys(OFFICIAL_CATEGORIES) as OfficialCategory[]).filter((id) => categories.has(id)).map((id) => ({ id, label: OFFICIAL_CATEGORIES[id], count: categories.get(id)! })),
      roles: (Object.keys(OFFICIAL_FONT_ROLES) as OfficialFontRole[]).filter((id) => roles.has(id)).map((id) => ({ id, label: OFFICIAL_FONT_ROLES[id], count: roles.get(id)! })),
      tags: [...tags].map(([id, t]) => ({ id, ...t })).sort((a, b) => b.count - a.count),
      // The frame counts worth a filter: the most common ones among multi-frame sets.
      frameCounts: [...count(inRole.filter((a) => a.frames > 1).map((a) => a.frames))].map(([frames, n]) => ({ frames, count: n })).sort((a, b) => b.count - a.count).slice(0, 8).sort((a, b) => a.frames - b.frames),
      total: matches.length, page, pageSize,
      assets: matches.slice((page - 1) * pageSize, page * pageSize).map((a): OfficialAsset => ({
        id: a.id, category: a.category, ...(a.role ? { role: a.role } : {}), width: a.width, height: a.height, frames: a.frames,
        configKeys: a.configKeys, tags: officialTags(a.configKeys), faces: a.faces, faceCount: a.faceCount, strip: a.strip,
      })),
    };
  }

  /** A set's preview strip (PNG), from the cache or the library. */
  async strip(watch: unknown, id: unknown): Promise<Buffer> {
    const firmwareType = this.firmware(watch);
    const asset = this.asset(firmwareType, id);
    const file = path.join(this.root(firmwareType), "assets", asset.id, "strip.png");
    const cached = await fs.promises.readFile(file).catch(() => null);
    if (cached && isPng(cached)) return cached;
    const bytes = await this.hosted(`v1/assets/${asset.id}/strip.png`, MAX_STRIP);
    if (!bytes || !isPng(bytes)) throw new OfficialProblem("That preview couldn't be downloaded.", "offline");
    await this.write(file, bytes);
    return bytes;
  }

  /** Every frame of a set. A hosted set's ZIP (≤25 MB) is downloaded once and its NN.png entries unpacked. */
  async frames(watch: unknown, id: unknown): Promise<OfficialFrames> {
    const firmwareType = this.firmware(watch);
    const asset = this.asset(firmwareType, id);
    const dir = path.join(this.root(firmwareType), "assets", asset.id);
    const read = async () => {
      const frames: (Buffer | null)[] = await Promise.all(Array.from({ length: asset.frames }, (_, i) => fs.promises.readFile(path.join(dir, frameName(i))).catch(() => null)));
      return frames.every((f) => !!f && isPng(f)) ? (frames as Buffer[]) : null;
    };
    let frames = await read();
    if (!frames) {
      const zip = await this.hosted(`v1/assets/${asset.id}/${asset.id}.zip`, MAX_OFFICIAL_ARCHIVE);
      if (!zip) throw new OfficialProblem("That artwork couldn't be downloaded. Check the connection and try again.", "offline");
      let unpacked = 0, total = 0;
      try {
        for (const entry of readZip(zip)) {
          const name = path.posix.basename(entry.path);
          const index = /^(\d{2,3})\.png$/.exec(name);
          if (entry.directory || !index || Number(index[1]) >= asset.frames) continue;
          total += entry.size;
          if (total > 4 * MAX_OFFICIAL_ARCHIVE) throw new Error("too big");
          const png = entry.read();
          if (!isPng(png)) throw new Error("not a PNG");
          await this.write(path.join(dir, frameName(Number(index[1]))), png);
          unpacked += 1;
        }
      } catch { throw new OfficialProblem("The library sent artwork that can't be opened.", "damaged"); }
      frames = unpacked ? await read() : null;
      if (!frames) throw new OfficialProblem("The library sent artwork with frames missing.", "damaged");
    }
    return {
      id: asset.id, category: asset.category, width: asset.width, height: asset.height,
      label: `${OFFICIAL_CATEGORIES[asset.category]} from ${asset.faces[0] ?? "an official face"}`,
      frames: frames.map((f) => `data:image/png;base64,${f.toString("base64")}`),
    };
  }

  /** /official…, or null for Studio's other routes. */
  async answer(request: Request, route: string, url: URL, get: boolean): Promise<Response | null> {
    if (route !== "/official" && !route.startsWith("/official/")) return null;
    const json = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
    const q = url.searchParams, watch = q.get("watch");
    if (get && route === "/official") return json({ status: this.ensure(watch) });
    if (!get && route === "/official/refresh") {
      const body = (await request.json().catch(() => ({}))) as { watch?: unknown };
      return json({ status: this.ensure(body.watch, true) });
    }
    if (get && route === "/official/assets") {
      const frames = q.get("frames");
      return json(this.list(watch, {
        category: q.get("category") ?? undefined, role: q.get("role") ?? undefined, tag: q.get("tag") ?? undefined, q: q.get("q") ?? undefined,
        configKey: q.get("configKey") ?? undefined, ...(frames === "single" || frames === "multi" ? { frames } : {}),
        ...(q.get("frameCount") ? { frameCount: Number(q.get("frameCount")) } : {}), page: Number(q.get("page") ?? 1), pageSize: Number(q.get("pageSize") ?? 36),
      }));
    }
    let m = /^\/official\/strips\/([0-9a-f]{16})$/.exec(route);
    // A set is named by its content, so its strip never changes.
    if (get && m) return new Response(new Uint8Array(await this.strip(watch, m[1])), { headers: { "Content-Type": "image/png", "Cache-Control": "max-age=31536000, immutable" } });
    m = /^\/official\/sets\/([0-9a-f]{16})$/.exec(route);
    if (get && m) return json({ set: await this.frames(watch, m[1]) });
    return Response.json({ error: { code: "notFound", message: "Not a Studio action." } }, { status: 404 });
  }
}
