import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { app } from "electron";
import { z } from "zod";
import { selectCorosWatchfaceArchive } from "./corosWatchfaceService";
import type {
  CommunityWatchface,
  CommunityWatchfaceCatalogPage,
  CommunityWatchfaceCatalogQuery,
  CommunityWatchfaceDownloadProgress,
  CommunityWatchfaceImport
} from "./types";

const PRODUCTION_CATALOG_ORIGIN = "https://watchfaces.coroslink.com";
const MAX_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_COMMUNITY_PACKAGE_BYTES = 100 * 1024 * 1024;
const STALE_IMPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const watchfaceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(SLUG_PATTERN).max(100),
  title: z.string().min(1).max(160),
  description: z.string().max(1000),
  creatorName: z.string().min(1).max(160),
  creatorHandle: z.string().max(80).nullable(),
  models: z.array(z.string().min(1).max(80)).max(30),
  tags: z.array(z.string().min(1).max(80)).max(30),
  publishedAt: z.string().datetime().nullable(),
  previewUrl: z.string().url(),
  detailUrl: z.string().url(),
  downloadUrl: z.string().url(),
  packageBytes: z.number().int().positive().max(MAX_COMMUNITY_PACKAGE_BYTES),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  validatorVersion: z.string().max(100).nullable()
});

const catalogPageSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(watchfaceSchema).max(48),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(48),
    total: z.number().int().nonnegative(),
    pageCount: z.number().int().positive()
  }),
  facets: z.object({
    models: z.array(z.string().min(1).max(80)).max(50),
    styles: z.array(z.object({
      value: z.string().min(1).max(80),
      label: z.string().min(1).max(100)
    })).max(50)
  })
});

const catalogItemSchema = z.object({
  schemaVersion: z.literal(1),
  item: watchfaceSchema
});

let progressListener:
  | ((progress: CommunityWatchfaceDownloadProgress) => void)
  | undefined;
let activeImportSlug: string | undefined;

function catalogBaseUrl(): URL {
  const override = process.env.COROSLINK_WATCHFACE_SITE_URL?.trim();
  const value = override && !app.isPackaged ? override : PRODUCTION_CATALOG_ORIGIN;
  const parsed = new URL(value);
  if (
    app.isPackaged &&
    parsed.origin !== PRODUCTION_CATALOG_ORIGIN
  ) {
    throw new Error("The community catalog origin is not trusted.");
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))
  ) {
    throw new Error("The community catalog must use HTTPS.");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function validateCatalogUrl(value: string, expectedPath: RegExp): URL {
  const parsed = new URL(value);
  const base = catalogBaseUrl();
  if (
    parsed.origin !== base.origin ||
    !expectedPath.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The community catalog returned an untrusted URL.");
  }
  return parsed;
}

function validateWatchfaceUrls(face: CommunityWatchface): CommunityWatchface {
  validateCatalogUrl(face.previewUrl, /^\/api\/watch-faces\/[a-f0-9-]{36}\/preview$/i);
  validateCatalogUrl(face.detailUrl, /^\/face\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  validateCatalogUrl(face.downloadUrl, /^\/api\/downloads\/[a-f0-9-]{36}$/i);
  return face;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CATALOG_RESPONSE_BYTES) {
    throw new Error("The community catalog response is unexpectedly large.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_CATALOG_RESPONSE_BYTES) {
    throw new Error("The community catalog returned an invalid response.");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The community catalog returned invalid JSON.");
  }
  if (!response.ok) {
    const message =
      typeof value === "object" &&
      value !== null &&
      "message" in value &&
      typeof value.message === "string"
        ? value.message
        : `The community catalog request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return value;
}

async function requestCatalog(pathname: string): Promise<unknown> {
  const url = new URL(pathname, catalogBaseUrl());
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": `CorosLink/${app.getVersion()}`
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  return readJsonResponse(response);
}

function normalizeQuery(input: CommunityWatchfaceCatalogQuery = {}) {
  const query = new URLSearchParams();
  const q = input.q?.trim();
  if (q) query.set("q", q.slice(0, 100));
  const model = input.model?.trim();
  if (model) query.set("model", model.slice(0, 80));
  const style = input.style?.trim();
  if (style) query.set("style", style.slice(0, 80));
  query.set("sort", input.sort === "title" ? "title" : "newest");
  query.set("page", String(Math.max(1, Math.min(10_000, Math.trunc(input.page ?? 1)))));
  query.set("pageSize", String(Math.max(1, Math.min(48, Math.trunc(input.pageSize ?? 12)))));
  return query;
}

export async function listCommunityWatchfaces(
  input: CommunityWatchfaceCatalogQuery = {}
): Promise<CommunityWatchfaceCatalogPage> {
  const query = normalizeQuery(input);
  const parsed = catalogPageSchema.parse(
    await requestCatalog(`/api/v1/watch-faces?${query.toString()}`)
  ) as CommunityWatchfaceCatalogPage;
  return {
    ...parsed,
    items: parsed.items.map(validateWatchfaceUrls)
  };
}

export async function getCommunityWatchface(
  slug: string
): Promise<CommunityWatchface> {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized) || normalized.length > 100) {
    throw new Error("Choose a valid community watch face.");
  }
  const parsed = catalogItemSchema.parse(
    await requestCatalog(`/api/v1/watch-faces/${encodeURIComponent(normalized)}`)
  );
  return validateWatchfaceUrls(parsed.item);
}

export function setCommunityWatchfaceProgressListener(
  listener:
    | ((progress: CommunityWatchfaceDownloadProgress) => void)
    | undefined
): void {
  progressListener = listener;
}

function emitProgress(progress: CommunityWatchfaceDownloadProgress): void {
  progressListener?.(progress);
}

function importDirectory(): string {
  return path.join(app.getPath("userData"), "community-watchface-imports");
}

export async function cleanupCommunityWatchfaceImports(): Promise<void> {
  const directory = importDirectory();
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - STALE_IMPORT_AGE_MS;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !/\.(?:part|zip)$/i.test(entry.name)) return;
    const filePath = path.join(directory, entry.name);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.promises.rm(filePath, { force: true });
    }
  }));
}

function signedBlobUrl(location: string): URL {
  const parsed = new URL(location);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")
  ) {
    throw new Error("The community download redirected to an untrusted host.");
  }
  return parsed;
}

async function resolveSignedDownload(face: CommunityWatchface): Promise<URL> {
  const response = await fetch(face.downloadUrl, {
    headers: {
      accept: "application/zip,application/octet-stream",
      "user-agent": `CorosLink/${app.getVersion()}`
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000)
  });
  if (![302, 303, 307, 308].includes(response.status)) {
    if (response.status === 404) {
      throw new Error("This watch face is no longer available.");
    }
    throw new Error(`The community download could not be prepared (HTTP ${response.status}).`);
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("The community download did not include a signed location.");
  }
  return signedBlobUrl(location);
}

async function streamPackage(
  url: URL,
  destinationPath: string,
  face: CommunityWatchface
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "application/zip,application/octet-stream",
      "user-agent": `CorosLink/${app.getVersion()}`
    },
    redirect: "error",
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`The community watch-face download failed (HTTP ${response.status}).`);
  }
  const totalBytes = Number(response.headers.get("content-length") ?? 0) || undefined;
  if (totalBytes && totalBytes > MAX_COMMUNITY_PACKAGE_BYTES) {
    throw new Error("The community watch-face package is larger than 100 MB.");
  }
  const output = fs.createWriteStream(destinationPath, { flags: "wx" });
  const hash = crypto.createHash("sha256");
  let receivedBytes = 0;
  let lastEmittedAt = 0;
  try {
    for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(rawChunk);
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_COMMUNITY_PACKAGE_BYTES) {
        throw new Error("The community watch-face package is larger than 100 MB.");
      }
      hash.update(chunk);
      if (!output.write(chunk)) await once(output, "drain");
      const now = Date.now();
      if (now - lastEmittedAt >= 100) {
        emitProgress({
          slug: face.slug,
          stage: "downloading",
          receivedBytes,
          ...(totalBytes ? { totalBytes } : {})
        });
        lastEmittedAt = now;
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.once("error", reject);
      output.end(resolve);
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
  if (receivedBytes === 0) {
    throw new Error("The community watch-face package was empty.");
  }
  emitProgress({
    slug: face.slug,
    stage: "verifying",
    receivedBytes,
    ...(totalBytes ? { totalBytes } : {})
  });
  return hash.digest("hex");
}

export async function importCommunityWatchface(
  slug: string
): Promise<CommunityWatchfaceImport> {
  const normalized = slug.trim().toLowerCase();
  if (activeImportSlug) {
    throw new Error(
      activeImportSlug === normalized
        ? "This watch face is already downloading."
        : "Wait for the current watch-face download to finish."
    );
  }
  activeImportSlug = normalized;
  const directory = importDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  const id = crypto.randomUUID();
  const partialPath = path.join(directory, `${id}.part`);
  const finalPath = path.join(directory, `${id}.zip`);
  try {
    const face = await getCommunityWatchface(normalized);
    const signedUrl = await resolveSignedDownload(face);
    const digest = await streamPackage(signedUrl, partialPath, face);
    if (digest !== face.packageSha256) {
      throw new Error("The downloaded watch face did not match its reviewed package.");
    }
    await fs.promises.rename(partialPath, finalPath);
    emitProgress({
      slug: face.slug,
      stage: "opening",
      receivedBytes: face.packageBytes,
      totalBytes: face.packageBytes
    });
    const archive = await selectCorosWatchfaceArchive(finalPath);
    return { face, archive };
  } catch (error) {
    await Promise.all([
      fs.promises.rm(partialPath, { force: true }),
      fs.promises.rm(finalPath, { force: true })
    ]);
    throw error;
  } finally {
    activeImportSlug = undefined;
  }
}

export function parseCommunityWatchfaceDeepLink(
  value: string
): { slug: string } | null {
  if (value.includes("..")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "coroslink:" ||
    parsed.hostname !== "watchfaces" ||
    segments.length !== 1 ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  let slug: string;
  try {
    slug = decodeURIComponent(segments[0]!).toLowerCase();
  } catch {
    return null;
  }
  return SLUG_PATTERN.test(slug) && slug.length <= 100 ? { slug } : null;
}
