// Community watch faces: the reviewed catalog at watchfaces.coroslink.com, browsed from Studio's home and opened as
// projects. Rewritten from CorosLink's electron/communityWatchfaceService.ts (docs/studio-port.md, phase 5):
//
// - Every catalog answer is at most 2 MB, checked field by field, and every URL in it must point back at the catalog
//   (previews, face pages, downloads).
// - A download asks the catalog for a signed location, follows it only to the catalog's own signed-storage route (or
//   Vercel Blob, where older releases live), streams at most 100 MB and must match the reviewed package's SHA-256.
// - Downloads land in studio/community-imports and are removed once opened; anything left there is cleaned after 7 days.
// - The catalog is not COROS, so Local-Only Mode (dataMode.ts) has nothing to stop here: these are reads.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n";

export const CATALOG_ORIGIN = "https://watchfaces.coroslink.com";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
export const MAX_COMMUNITY_PACKAGE = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
/** Animated WebPs run about 0.2–1 MB; the website caps what it publishes well under this. */
const MAX_ANIMATION_BYTES = 12 * 1024 * 1024;
const STALE_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;

/** The watches the catalog knows, as it names them. */
export const COMMUNITY_MODELS = ["PACE 3", "PACE 4", "PACE 4 Pro", "PACE Pro", "APEX 2", "APEX 2 Pro", "APEX 4", "NOMAD", "VERTIX 2", "VERTIX 2S", "VERTIX 4"] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class CommunityProblem extends Error {
  constructor(message: string, readonly code = "community", readonly status = 502) { super(message); }
}

export interface CommunityGroup { slug: string; name: string; variantCount: number; creatorCount?: number }
export interface CommunityFace {
  id: string;
  slug: string;
  title: string;
  description: string;
  creatorName: string;
  creatorHandle: string | null;
  models: string[];
  tags: string[];
  publishedAt: string | null;
  previewUrl: string;
  detailUrl: string;
  downloadUrl: string;
  packageBytes: number;
  packageSha256: string;
  validatorVersion: string | null;
  downloadCount?: number;
  group?: CommunityGroup;
}
export interface CommunityPage {
  schemaVersion: 1;
  items: CommunityFace[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  facets: { models: string[]; styles: { value: string; label: string }[] };
}
export type CommunitySort = "newest" | "title" | "trending" | "downloads";
export interface CommunityQuery {
  q?: string; model?: string; style?: string; sort?: CommunitySort; view?: "designs"; group?: string; page?: number; pageSize?: number;
}
export interface CommunityProgress { slug: string; stage: "downloading" | "verifying" | "opening"; receivedBytes: number; totalBytes?: number }

// ───── Checking what the catalog sends ─────

type Check<T> = (value: unknown, at: string) => T;
const fail = (at: string): never => { throw new CommunityProblem(t("The community catalog sent something unexpected ({at}).", { at }), "catalog"); };
const obj = (value: unknown, at: string): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail(at);
const text = (min: number, max: number, pattern?: RegExp): Check<string> => (value, at) =>
  typeof value === "string" && value.length >= min && value.length <= max && (!pattern || pattern.test(value)) ? value : fail(at);
const nullable = <T>(check: Check<T>): Check<T | null> => (value, at) => (value === null ? null : check(value, at));
const int = (min: number, max = Number.MAX_SAFE_INTEGER): Check<number> => (value, at) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(at);
const list = <T>(check: Check<T>, max: number): Check<T[]> => (value, at) =>
  Array.isArray(value) && value.length <= max ? value.map((v, i) => check(v, `${at}[${i}]`)) : fail(at);
const url: Check<string> = (value, at) => {
  if (typeof value !== "string") return fail(at);
  try { new URL(value); return value; } catch { return fail(at); }
};
const isoDate: Check<string> = (value, at) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ? value : fail(at);
/** Postgres bigint columns can reach the JSON as strings (the grouped listing did in October 2026). */
const packageBytes: Check<number> = (value, at) =>
  int(1, MAX_COMMUNITY_PACKAGE)(typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : value, at);

function face(value: unknown, at: string): CommunityFace {
  const v = obj(value, at);
  const optional = <T>(key: string, check: Check<T>) => (v[key] === undefined ? {} : { [key]: check(v[key], `${at}.${key}`) });
  const group = v.group === undefined ? undefined : obj(v.group, `${at}.group`);
  return {
    id: text(36, 36, UUID)(v.id, `${at}.id`),
    slug: text(1, 100, SLUG)(v.slug, `${at}.slug`),
    title: text(1, 160)(v.title, `${at}.title`),
    description: text(0, 1000)(v.description, `${at}.description`),
    creatorName: text(1, 160)(v.creatorName, `${at}.creatorName`),
    creatorHandle: nullable(text(0, 80))(v.creatorHandle, `${at}.creatorHandle`),
    models: list(text(1, 80), 30)(v.models, `${at}.models`),
    tags: list(text(1, 80), 30)(v.tags, `${at}.tags`),
    publishedAt: nullable(isoDate)(v.publishedAt, `${at}.publishedAt`),
    previewUrl: url(v.previewUrl, `${at}.previewUrl`),
    detailUrl: url(v.detailUrl, `${at}.detailUrl`),
    downloadUrl: url(v.downloadUrl, `${at}.downloadUrl`),
    packageBytes: packageBytes(v.packageBytes, `${at}.packageBytes`),
    packageSha256: text(64, 64, /^[a-f0-9]{64}$/)(v.packageSha256, `${at}.packageSha256`),
    validatorVersion: nullable(text(0, 100))(v.validatorVersion, `${at}.validatorVersion`),
    ...(optional("downloadCount", int(0)) as { downloadCount?: number }),
    ...(group ? {
      group: {
        slug: text(1, 100, SLUG)(group.slug, `${at}.group.slug`),
        name: text(1, 160)(group.name, `${at}.group.name`),
        variantCount: int(0)(group.variantCount, `${at}.group.variantCount`),
        ...(group.creatorCount === undefined ? {} : { creatorCount: int(0)(group.creatorCount, `${at}.group.creatorCount`) }),
      },
    } : {}),
  };
}

/** A catalog page, shape-checked (CorosLink's catalogPageSchema). Its URLs are checked by the caller. */
export function parseCommunityPage(value: unknown): CommunityPage {
  const v = obj(value, "page");
  if (v.schemaVersion !== 1) fail("schemaVersion");
  const p = obj(v.pagination, "pagination"), f = obj(v.facets, "facets");
  return {
    schemaVersion: 1,
    items: list(face, 48)(v.items, "items"),
    pagination: { page: int(1)(p.page, "page"), pageSize: int(1, 48)(p.pageSize, "pageSize"), total: int(0)(p.total, "total"), pageCount: int(1)(p.pageCount, "pageCount") },
    facets: {
      models: list(text(1, 80), 50)(f.models, "facets.models"),
      styles: list((s, at) => { const o = obj(s, at); return { value: text(1, 80)(o.value, `${at}.value`), label: text(1, 100)(o.label, `${at}.label`) }; }, 50)(f.styles, "facets.styles"),
    },
  };
}

export function parseCommunityItem(value: unknown): CommunityFace {
  const v = obj(value, "item");
  if (v.schemaVersion !== 1) fail("schemaVersion");
  return face(v.item, "item");
}

function modelQueryOk(u: URL): boolean {
  return !u.search || ([...u.searchParams.keys()].length === 1 && (COMMUNITY_MODELS as readonly string[]).includes(u.searchParams.get("model") ?? ""));
}

function onCatalog(value: string, origin: string, pathname: RegExp, allowModel = false): URL {
  const u = new URL(value);
  if (u.origin !== origin || !pathname.test(u.pathname) || (allowModel ? !modelQueryOk(u) : Boolean(u.search)) || u.hash) {
    throw new CommunityProblem(t("The community catalog returned an untrusted URL."), "catalog");
  }
  return u;
}

/** Every URL a face carries points back at the catalog (CorosLink's validateWatchfaceUrls). */
export function checkFaceUrls(item: CommunityFace, origin = CATALOG_ORIGIN): CommunityFace {
  onCatalog(item.previewUrl, origin, /^\/api\/watch-faces\/[a-f0-9-]{36}\/preview$/i);
  onCatalog(item.detailUrl, origin, /^\/face\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  onCatalog(item.downloadUrl, origin, /^\/api\/downloads\/[a-f0-9-]{36}$/i, true);
  return item;
}

// The catalog's own signed-storage route (Cloudflare R2 behind the catalog origin since September 2026), for a
// published release ZIP only.
const SIGNED_STORAGE = /^\/api\/storage\/releases\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.zip$/i;

/** A download redirect is followed only to the catalog's signed-storage route or to Vercel Blob. */
export function trustedDownloadLocation(location: string, origin: string): URL | null {
  let u: URL;
  try { u = new URL(location); } catch { return null; }
  if (u.username || u.password || u.hash) return null;
  if (u.protocol === "https:" && u.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")) return u;
  if (u.origin === new URL(origin).origin && SIGNED_STORAGE.test(u.pathname) && u.searchParams.get("expires") && u.searchParams.get("signature")) return u;
  return null;
}

/** The query the catalog is asked, clamped as CorosLink's normalizeQuery does. */
export function catalogQuery(input: CommunityQuery = {}): URLSearchParams {
  const query = new URLSearchParams();
  const q = input.q?.trim();
  if (q) query.set("q", q.slice(0, 100));
  const model = input.model?.trim();
  if (model) query.set("model", model.slice(0, 80));
  const style = input.style?.trim();
  if (style) query.set("style", style.slice(0, 80));
  query.set("sort", input.sort === "title" || input.sort === "trending" || input.sort === "downloads" ? input.sort : "newest");
  if (input.view === "designs") query.set("view", "designs");
  const group = input.group?.trim().toLowerCase();
  if (group && SLUG.test(group) && group.length <= 100) query.set("group", group);
  query.set("page", String(Math.max(1, Math.min(10_000, Math.trunc(Number(input.page) || 1)))));
  query.set("pageSize", String(Math.max(1, Math.min(48, Math.trunc(Number(input.pageSize) || 12)))));
  return query;
}

export function cleanSlug(slug: unknown): string {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!SLUG.test(s) || s.length > 100) throw new CommunityProblem(t("Choose a valid community watch face."), "badFace", 400);
  return s;
}

export function cleanModel(model: unknown): string | undefined {
  if (model === undefined || model === null || model === "") return undefined;
  if (!(COMMUNITY_MODELS as readonly string[]).includes(String(model))) throw new CommunityProblem(t("Choose a watch the community catalog knows."), "badModel", 400);
  return String(model);
}

// ───── The catalog ─────

export interface CommunityOptions {
  fetch?: typeof fetch;
  now?: () => number;
  origin?: string;
  userAgent?: string;
}

export class CommunityCatalog {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  readonly origin: string;
  private readonly userAgent: string;
  private active: string | undefined;
  /** The download in flight, for the page to show (it asks; there's no push channel). */
  progress: CommunityProgress | null = null;

  constructor(readonly folder: string, options: CommunityOptions = {}) {
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
    this.origin = new URL(options.origin ?? CATALOG_ORIGIN).origin;
    this.userAgent = options.userAgent ?? "C-LINK";
  }

  private async getJson(pathname: string): Promise<unknown> {
    let answer: Response;
    try {
      answer = await this.fetch(new URL(pathname, this.origin), {
        headers: { accept: "application/json", "user-agent": this.userAgent }, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new CommunityProblem(t("The community catalog couldn't be reached. Check the connection and try again."), "offline"); }
    if (Number(answer.headers.get("content-length") ?? 0) > MAX_CATALOG_BYTES) throw new CommunityProblem(t("The community catalog answer is unexpectedly large."));
    const bytes = Buffer.from(await answer.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_CATALOG_BYTES) throw new CommunityProblem(t("The community catalog returned an invalid answer."));
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new CommunityProblem(t("The community catalog returned invalid JSON.")); }
    if (!answer.ok) {
      const message = value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string" ? (value as { message: string }).message : "";
      throw new CommunityProblem(message || `The community catalog answered ${answer.status}.`, answer.status === 404 ? "missing" : "community", answer.status === 404 ? 404 : 502);
    }
    return value;
  }

  async list(input: CommunityQuery = {}): Promise<CommunityPage> {
    const page = parseCommunityPage(await this.getJson(`/api/v1/watch-faces?${catalogQuery(input)}`));
    return { ...page, items: page.items.map((f) => checkFaceUrls(f, this.origin)) };
  }

  async face(slug: unknown, model?: unknown): Promise<CommunityFace> {
    const s = cleanSlug(slug), m = cleanModel(model);
    const item = checkFaceUrls(parseCommunityItem(await this.getJson(`/api/v1/watch-faces/${encodeURIComponent(s)}${m ? `?${new URLSearchParams({ model: m })}` : ""}`)), this.origin);
    if (m && new URL(item.downloadUrl).searchParams.get("model") !== m) {
      throw new CommunityProblem(t("The community catalog didn't return that watch's version of this face."), "badModel");
    }
    return item;
  }

  /** A face's picture, by its id: always the catalog's own preview route. */
  async preview(id: string): Promise<{ bytes: Buffer; type: string }> {
    if (!UUID.test(id)) throw new CommunityProblem(t("No such face."), "missing", 404);
    let answer: Response;
    try {
      answer = await this.fetch(new URL(`/api/watch-faces/${id.toLowerCase()}/preview`, this.origin), {
        headers: { accept: "image/png,image/webp,image/jpeg", "user-agent": this.userAgent }, redirect: "follow", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new CommunityProblem(t("The community catalog couldn't be reached."), "offline"); }
    if (!answer.ok) throw new CommunityProblem(t("The community catalog answered {status}.", { status: answer.status }), "missing", answer.status === 404 ? 404 : 502);
    const bytes = Buffer.from(await answer.arrayBuffer());
    const type = bytes.length >= 4 && bytes.readUInt32BE(0) === 0x89504e47 ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
        : bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP" ? "image/webp" : "";
    if (!type || bytes.length > MAX_PREVIEW_BYTES) throw new CommunityProblem(t("That preview isn't a picture."));
    return { bytes, type };
  }

  /**
   * A face's native animation, the way the website plays it: one looping animated WebP of the whole face, framed like
   * the preview. `null` when the face has none (the catalog answers `null` or an older format).
   */
  async animation(id: string): Promise<{ bytes: Buffer; type: string } | null> {
    if (!UUID.test(id)) throw new CommunityProblem(t("No such face."), "missing", 404);
    const meta = await this.getJson(`/api/watch-faces/${id.toLowerCase()}/animation`);
    const image = meta && typeof meta === "object" ? (meta as { version?: unknown; image?: unknown }) : null;
    if (!image || image.version !== 2 || image.image !== `/api/watch-faces/${id.toLowerCase()}/animation/image`) return null;
    let answer: Response;
    try {
      answer = await this.fetch(new URL(image.image, this.origin), {
        headers: { accept: "image/webp", "user-agent": this.userAgent }, redirect: "follow", signal: AbortSignal.timeout(20_000),
      });
    } catch { throw new CommunityProblem(t("The community catalog couldn't be reached."), "offline"); }
    if (!answer.ok) return null;
    const bytes = Buffer.from(await answer.arrayBuffer());
    const webp = bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
    if (!webp || bytes.length > MAX_ANIMATION_BYTES) return null;
    return { bytes, type: "image/webp" };
  }

  /** Signed location for a face's package, followed only where trustedDownloadLocation allows. */
  private async signedLocation(item: CommunityFace): Promise<URL> {
    let answer: Response;
    try {
      answer = await this.fetch(new URL(item.downloadUrl), {
        headers: { accept: "application/zip,application/octet-stream", "user-agent": this.userAgent }, redirect: "manual", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new CommunityProblem(t("The community catalog couldn't be reached."), "offline"); }
    if (![302, 303, 307, 308].includes(answer.status)) {
      if (answer.status === 404) throw new CommunityProblem(t("This watch face is no longer available."), "missing", 404);
      throw new CommunityProblem(t("The download couldn't be prepared ({status}).", { status: answer.status }));
    }
    const location = answer.headers.get("location");
    const trusted = location ? trustedDownloadLocation(location, this.origin) : null;
    if (!trusted) throw new CommunityProblem(t("The community download pointed somewhere untrusted."), "untrusted");
    return trusted;
  }

  /** Streams the package to a temp file (≤100 MB), hashing as it goes; returns the hex SHA-256. */
  private async stream(from: URL, to: string, item: CommunityFace): Promise<string> {
    let answer: Response;
    try {
      answer = await this.fetch(from, {
        headers: { accept: "application/zip,application/octet-stream", "user-agent": this.userAgent }, redirect: "error", signal: AbortSignal.timeout(120_000),
      });
    } catch { throw new CommunityProblem(t("The watch face couldn't be downloaded. Check the connection and try again."), "offline"); }
    if (!answer.ok || !answer.body) throw new CommunityProblem(t("The watch face download failed ({status}).", { status: answer.status }));
    const total = Number(answer.headers.get("content-length") ?? 0) || undefined;
    if (total && total > MAX_COMMUNITY_PACKAGE) throw new CommunityProblem(t("The community watch face is larger than 100 MB."), "tooBig");
    const hash = createHash("sha256");
    const out = await fs.promises.open(to, "wx");
    let received = 0;
    try {
      for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > MAX_COMMUNITY_PACKAGE) throw new CommunityProblem(t("The community watch face is larger than 100 MB."), "tooBig");
        hash.update(chunk);
        await out.write(chunk);
        this.progress = { slug: item.slug, stage: "downloading", receivedBytes: received, ...(total ? { totalBytes: total } : {}) };
      }
    } finally {
      await out.close();
    }
    if (!received) throw new CommunityProblem(t("The community watch face was empty."));
    this.progress = { slug: item.slug, stage: "verifying", receivedBytes: received, ...(total ? { totalBytes: total } : {}) };
    return hash.digest("hex");
  }

  /**
   * Downloads a face's reviewed package and checks it against the catalog's SHA-256. `open` gets the bytes (Studio
   * makes a project of them); the temp file is removed either way. One download at a time.
   */
  async download<T>(slug: unknown, model: unknown, open: (bytes: Buffer, item: CommunityFace) => Promise<T>): Promise<{ item: CommunityFace; opened: T }> {
    const s = cleanSlug(slug);
    if (this.active) throw new CommunityProblem(this.active === s ? t("This watch face is already downloading.") : t("Wait for the current download to finish."), "busy", 409);
    this.active = s;
    await fs.promises.mkdir(this.folder, { recursive: true });
    const id = randomUUID();
    const partial = path.join(this.folder, `${id}.part`), whole = path.join(this.folder, `${id}.zip`);
    try {
      const item = await this.face(s, model);
      const digest = await this.stream(await this.signedLocation(item), partial, item);
      if (digest !== item.packageSha256) throw new CommunityProblem(t("The downloaded watch face didn't match its reviewed package."), "mismatch");
      await fs.promises.rename(partial, whole);
      this.progress = { slug: item.slug, stage: "opening", receivedBytes: item.packageBytes, totalBytes: item.packageBytes };
      return { item, opened: await open(await fs.promises.readFile(whole), item) };
    } finally {
      await Promise.all([fs.promises.rm(partial, { force: true }), fs.promises.rm(whole, { force: true })]);
      this.active = undefined;
      this.progress = null;
    }
  }

  /** Removes downloads left behind (a crash mid-download) once they're a week old. */
  async cleanup(): Promise<void> {
    const entries = await fs.promises.readdir(this.folder, { withFileTypes: true }).catch(() => []);
    const cutoff = this.now() - STALE_IMPORT_MS;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !/\.(?:part|zip)$/i.test(entry.name)) return;
      const file = path.join(this.folder, entry.name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.promises.rm(file, { force: true });
    }));
  }
}
