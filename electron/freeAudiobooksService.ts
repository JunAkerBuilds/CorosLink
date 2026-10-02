import type { FreeAudiobook, FreeAudiobookDetail, FreeAudiobookSection } from "./types";

// LibriVox's volunteer recordings are public domain and every one of them is
// hosted in the Internet Archive's `librivoxaudio` collection. archive.org's
// search API ranks that collection by downloads and matches any words, which
// LibriVox's own API (exact or prefix titles only) cannot do.
const ARCHIVE_BASE_URL = "https://archive.org";
const LIBRIVOX_COLLECTION = "librivoxaudio";
const RESULT_LIMIT = 36;
const REQUEST_TIMEOUT_MS = 20_000;
const POPULAR_CACHE_TTL_MS = 6 * 60 * 60_000;
// The lowest-bitrate MP3 derivative is preferred: parts are re-encoded to
// 64 kbps mono anyway, so a larger source only costs download time.
const MP3_FORMAT_PREFERENCE = ["64Kbps MP3", "VBR MP3", "128Kbps MP3", "MP3"];
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface ArchiveSearchResponse {
  response?: { docs?: ArchiveSearchDoc[] };
}

interface ArchiveSearchDoc {
  identifier?: unknown;
  title?: unknown;
  creator?: unknown;
  downloads?: unknown;
  runtime?: unknown;
  language?: unknown;
}

interface ArchiveMetadataResponse {
  metadata?: Record<string, unknown>;
  files?: ArchiveFile[];
}

interface ArchiveFile {
  name?: unknown;
  format?: unknown;
  title?: unknown;
  track?: unknown;
  length?: unknown;
  size?: unknown;
  sha1?: unknown;
}

let popularCache: { books: FreeAudiobook[]; cachedAt: number } | undefined;

/** The most downloaded LibriVox recordings: the tab's default shelf. */
export async function listPopularFreeAudiobooks(): Promise<FreeAudiobook[]> {
  if (popularCache && Date.now() - popularCache.cachedAt < POPULAR_CACHE_TTL_MS) {
    return popularCache.books;
  }
  const books = await searchArchive(`collection:${LIBRIVOX_COLLECTION} AND mediatype:audio`);
  popularCache = { books, cachedAt: Date.now() };
  return books;
}

export async function searchFreeAudiobooks(query: string): Promise<FreeAudiobook[]> {
  const words = query
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) {
    throw new Error("Enter a title or author to search LibriVox.");
  }
  // Each word must appear in the title or the author, so "austen pride"
  // finds Pride and Prejudice without matching every Austen book's blurb.
  const clauses = words.map((word) => {
    const escaped = word.replace(/["\\]/g, "");
    return `(title:"${escaped}" OR creator:"${escaped}")`;
  });
  return searchArchive(
    `collection:${LIBRIVOX_COLLECTION} AND mediatype:audio AND ${clauses.join(" AND ")}`
  );
}

/**
 * Loads one recording and the MP3 file for each of its sections, in play
 * order. The main process calls this again at import time, so download URLs
 * never come from the renderer.
 */
export async function loadFreeAudiobook(identifier: string): Promise<FreeAudiobookDetail> {
  assertIdentifier(identifier);
  const url = `${ARCHIVE_BASE_URL}/metadata/${encodeURIComponent(identifier)}`;
  const data = await fetchJson<ArchiveMetadataResponse>(url, "LibriVox book");
  const metadata = data.metadata ?? {};
  const collections = toStringList(metadata.collection);
  if (!collections.includes(LIBRIVOX_COLLECTION)) {
    throw new Error("That item is not a LibriVox recording.");
  }

  const files = data.files ?? [];
  const format = MP3_FORMAT_PREFERENCE.find((candidate) =>
    files.some((file) => file.format === candidate)
  );
  if (!format) {
    throw new Error("This recording has no MP3 files to download.");
  }

  const sections: FreeAudiobookSection[] = files
    .filter((file) => file.format === format && typeof file.name === "string")
    .filter((file) => isSafeFileName(file.name as string))
    .map((file) => {
      const name = file.name as string;
      return {
        name,
        title: cleanSectionTitle(toText(file.title)) || stripExtension(name),
        url: `${ARCHIVE_BASE_URL}/download/${encodeURIComponent(identifier)}/${name
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        sizeBytes: toPositiveNumber(file.size),
        durationSeconds: parseClock(toText(file.length)),
        sha1: /^[0-9a-f]{40}$/i.test(toText(file.sha1)) ? toText(file.sha1).toLowerCase() : undefined,
        track: toPositiveNumber(String(file.track ?? "").split("/")[0])
      };
    })
    .sort(
      (left, right) =>
        (left.track ?? Number.MAX_SAFE_INTEGER) - (right.track ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name, undefined, { numeric: true })
    )
    .map(({ track: _track, ...section }) => section);
  if (sections.length === 0) {
    throw new Error("This recording has no MP3 files to download.");
  }

  const book = toFreeAudiobook({
    identifier,
    title: metadata.title,
    creator: metadata.creator,
    runtime: metadata.runtime,
    language: metadata.language
  });
  if (!book) {
    throw new Error("LibriVox returned an incomplete book record.");
  }
  return {
    ...book,
    runtimeSeconds:
      book.runtimeSeconds ??
      (sections.every((section) => section.durationSeconds)
        ? sections.reduce((total, section) => total + (section.durationSeconds ?? 0), 0)
        : undefined),
    description: htmlToText(toText(metadata.description)),
    sections,
    totalBytes: sections.reduce((total, section) => total + (section.sizeBytes ?? 0), 0)
  };
}

/** Download hosts a LibriVox section may be served from, redirects included. */
export function isArchiveDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org"))
    );
  } catch {
    return false;
  }
}

async function searchArchive(query: string): Promise<FreeAudiobook[]> {
  const url = new URL("/advancedsearch.php", ARCHIVE_BASE_URL);
  url.searchParams.set("q", query);
  for (const field of ["identifier", "title", "creator", "downloads", "runtime", "language"]) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.append("sort[]", "downloads desc");
  url.searchParams.set("rows", String(RESULT_LIMIT));
  url.searchParams.set("output", "json");

  const data = await fetchJson<ArchiveSearchResponse>(url.toString(), "LibriVox search");
  return (data.response?.docs ?? [])
    .map(toFreeAudiobook)
    .filter((book): book is FreeAudiobook => Boolean(book));
}

function toFreeAudiobook(doc: ArchiveSearchDoc): FreeAudiobook | undefined {
  const identifier = toText(doc.identifier);
  const title = cleanBookTitle(toText(doc.title));
  if (!IDENTIFIER_PATTERN.test(identifier) || !title) {
    return undefined;
  }
  const language = toStringList(doc.language)[0];
  return {
    identifier,
    title,
    author: toStringList(doc.creator).join(", ") || undefined,
    language: language ? languageName(language) : undefined,
    runtimeSeconds: parseClock(toText(doc.runtime)),
    downloads: toPositiveNumber(doc.downloads),
    coverUrl: `${ARCHIVE_BASE_URL}/services/img/${encodeURIComponent(identifier)}`,
    pageUrl: `${ARCHIVE_BASE_URL}/details/${encodeURIComponent(identifier)}`
  };
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "coroslink" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`${label} could not be reached: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText}.`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function assertIdentifier(identifier: string): void {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error("Invalid LibriVox book id.");
  }
}

function isSafeFileName(name: string): boolean {
  return (
    name.toLowerCase().endsWith(".mp3") &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return toText(value[0]);
  return "";
}

function toStringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map(toText).filter(Boolean);
}

function toPositiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Parses "65:06", "10:17:59" or plain seconds. */
export function parseClock(value: string): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return toPositiveNumber(value);
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return toPositiveNumber(parts.reduce((total, part) => total * 60 + part, 0));
}

function cleanBookTitle(title: string): string {
  // Search titles often repeat the author: "Alice's Adventures…, by Lewis Carroll".
  return title.replace(/,\s+by\s+[^,]+$/i, "").replace(/\s+/g, " ").trim();
}

function cleanSectionTitle(title: string): string {
  // Track titles carry their own number ("01 - A Scandal in Bohemia"); the
  // part list already numbers them.
  return title.replace(/^\d+\s*[-–.:]\s*/, "").replace(/\s+/g, " ").trim();
}

function stripExtension(name: string): string {
  return (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "");
}

export function htmlToText(html: string): string | undefined {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English",
  ger: "German",
  deu: "German",
  fre: "French",
  fra: "French",
  spa: "Spanish",
  ita: "Italian",
  dut: "Dutch",
  nld: "Dutch",
  por: "Portuguese",
  rus: "Russian",
  chi: "Chinese",
  zho: "Chinese",
  jpn: "Japanese",
  lat: "Latin",
  pol: "Polish",
  gre: "Greek",
  ell: "Greek",
  swe: "Swedish",
  fin: "Finnish",
  heb: "Hebrew",
  dan: "Danish",
  nor: "Norwegian"
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code;
}
