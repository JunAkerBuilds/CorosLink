import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  ApplePodcastEpisode,
  ApplePodcastShow,
  ApplePodcastShowDetail
} from "./types";

const ITUNES_API_BASE_URL = "https://itunes.apple.com";
const SEARCH_LIMIT = 25;
export const APPLE_PODCAST_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const FEED_CACHE_TTL_MS = 10 * 60_000;
const FEED_CACHE_MAX_ENTRIES = 12;

type JsonObject = Record<string, unknown>;

interface ItunesSearchResponse {
  resultCount?: number;
  results?: ItunesPodcastResult[];
}

interface ItunesPodcastResult {
  collectionId?: number;
  trackId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  collectionViewUrl?: string;
  trackViewUrl?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  trackCount?: number;
}

interface ApplePodcastInput {
  collectionId: string;
  storefront: string;
}

interface ApplePodcastFeedCacheEntry {
  detail: ApplePodcastShowDetail;
  cachedAt: number;
}

const feedCache = new Map<string, ApplePodcastFeedCacheEntry>();

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  processEntities: true
});

/** Searches Apple's public catalogue for podcasts in the user's storefront. */
export async function searchApplePodcasts(
  query: string
): Promise<ApplePodcastShow[]> {
  const term = query.trim();
  if (!term) {
    throw new Error("Enter a podcast name to search Apple Podcasts.");
  }

  const storefront = getApplePodcastStorefront();
  const url = new URL("/search", ITUNES_API_BASE_URL);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "podcast");
  url.searchParams.set("entity", "podcast");
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  url.searchParams.set("country", storefront);

  const response = await fetchJson<ItunesSearchResponse>(
    url,
    "Apple Podcasts search"
  );

  return (response.results ?? [])
    .map((result) => toApplePodcastShow(result, storefront))
    .filter((show): show is ApplePodcastShow => Boolean(show));
}

/**
 * Resolves an Apple Podcasts collection id or show URL, then returns a page of
 * downloadable RSS episodes in the publisher's feed order. Parsed feeds stay
 * in a short-lived main-process cache so loading more never repeats the fetch.
 */
export async function loadApplePodcast(
  showIdOrApplePodcastsUrl: string,
  offset = 0
): Promise<ApplePodcastShowDetail> {
  const input = resolveApplePodcastInput(showIdOrApplePodcastsUrl);
  const cacheKey = `${input.storefront}:${input.collectionId}`;
  const cached = getCachedFeed(cacheKey);
  const detail = cached ?? await fetchApplePodcastFeed(input, cacheKey);
  return pageApplePodcastDetail(detail, offset);
}

async function fetchApplePodcastFeed(
  input: ApplePodcastInput,
  cacheKey: string
): Promise<ApplePodcastShowDetail> {
  const show = await lookupApplePodcast(input);

  if (!show.feedUrl) {
    throw new Error(
      "Apple Podcasts does not expose a public RSS feed for this show, so its episodes cannot be downloaded."
    );
  }

  const feedResponse = await fetchResponse(show.feedUrl, "Podcast RSS feed", {
    Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
  });
  const feedXml = await feedResponse.text();
  const detail = parseApplePodcastRss(feedXml, show);
  cacheFeed(cacheKey, detail);
  return detail;
}

/** Resolves the locale into an iTunes storefront, defaulting to the US. */
export function getApplePodcastStorefront(
  locale = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  const parts = locale.split("-");
  const region = parts.length > 1 ? parts.at(-1)?.toUpperCase() : undefined;
  return region && /^[A-Z]{2}$/.test(region) ? region : "US";
}

/** Parses a numeric collection id or a canonical podcasts.apple.com URL. */
export function resolveApplePodcastInput(
  rawInput: string,
  defaultStorefront = getApplePodcastStorefront()
): ApplePodcastInput {
  const input = rawInput.trim();
  if (!input) {
    throw new Error("Paste an Apple Podcasts show link or collection id.");
  }

  if (/^\d+$/.test(input)) {
    return { collectionId: input, storefront: defaultStorefront };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Apple Podcasts show link or collection id.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "podcasts.apple.com" && host !== "www.podcasts.apple.com") {
    throw new Error("Paste a show link from podcasts.apple.com.");
  }

  const collectionId = /(?:^|\/)id(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
  if (!collectionId) {
    throw new Error("That Apple Podcasts link does not contain a show id.");
  }

  const country = url.pathname
    .split("/")
    .filter(Boolean)[0]
    ?.toUpperCase();

  return {
    collectionId,
    storefront: country && /^[A-Z]{2}$/.test(country)
      ? country
      : defaultStorefront
  };
}

/** Maps and validates an RSS feed into a show detail record. */
export function parseApplePodcastRss(
  xml: string,
  show: ApplePodcastShow
): ApplePodcastShowDetail {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error("The podcast RSS feed is not valid XML.");
  }

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    throw new Error("The podcast RSS feed could not be read.");
  }

  const root = asRecord(parsed);
  const rss = asRecord(root?.rss);
  const channel = asRecord(rss?.channel);
  if (!channel) {
    throw new Error("The podcast feed does not contain an RSS channel.");
  }

  const episodeAudioUrls = new Set<string>();
  const episodes: ApplePodcastEpisode[] = [];
  for (const rawItem of asArray(channel.item)) {
    const item = asRecord(rawItem);
    if (!item) {
      continue;
    }

    const enclosure = asArray(item.enclosure)
      .map(asRecord)
      .find((entry) => validHttpUrl(readAttribute(entry, "url")));
    const audioUrl = validHttpUrl(readAttribute(enclosure, "url"));
    if (!audioUrl || episodeAudioUrls.has(audioUrl)) {
      continue;
    }

    episodeAudioUrls.add(audioUrl);
    const guid = readText(item.guid);
    const publishedAt = toIsoDate(readText(item.pubDate));
    episodes.push({
      id: guid || audioUrl,
      title: readText(item["itunes:title"]) ?? readText(item.title) ?? "Untitled episode",
      description: cleanDescription(
        readText(item["itunes:summary"]) ??
          readText(item.description) ??
          readText(item["content:encoded"])
      ),
      publishedAt,
      durationSeconds: parseDurationSeconds(readText(item["itunes:duration"])),
      episodeNumber: parsePositiveInteger(readText(item["itunes:episode"])),
      seasonNumber: parsePositiveInteger(readText(item["itunes:season"])),
      artworkUrl: readArtworkUrl(item),
      audioUrl,
      mimeType: readAttribute(enclosure, "type"),
      sizeBytes: parsePositiveInteger(readAttribute(enclosure, "length"))
    });
  }

  if (episodes.length === 0) {
    throw new Error(
      "This podcast feed does not contain any publicly downloadable audio episodes."
    );
  }

  return {
    ...show,
    title: readText(channel.title) ?? show.title,
    authorName:
      readText(channel["itunes:author"]) ??
      readText(channel.managingEditor) ??
      show.authorName,
    description:
      cleanDescription(
        readText(channel["itunes:summary"]) ?? readText(channel.description)
      ) ?? show.description,
    artworkUrl: readArtworkUrl(channel) ?? show.artworkUrl,
    episodes,
    totalEpisodeCount: episodes.length,
    hasMoreEpisodes: false
  };
}

function pageApplePodcastDetail(
  detail: ApplePodcastShowDetail,
  rawOffset: number
): ApplePodcastShowDetail {
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const totalEpisodeCount = detail.episodes.length;
  const end = Math.min(offset + APPLE_PODCAST_PAGE_SIZE, totalEpisodeCount);

  return {
    ...detail,
    episodes: detail.episodes.slice(offset, end),
    totalEpisodeCount,
    hasMoreEpisodes: end < totalEpisodeCount
  };
}

function getCachedFeed(cacheKey: string): ApplePodcastShowDetail | undefined {
  const cached = feedCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }

  if (Date.now() - cached.cachedAt > FEED_CACHE_TTL_MS) {
    feedCache.delete(cacheKey);
    return undefined;
  }

  // Refresh insertion order so recently browsed shows survive cache eviction.
  feedCache.delete(cacheKey);
  feedCache.set(cacheKey, cached);
  return cached.detail;
}

function cacheFeed(cacheKey: string, detail: ApplePodcastShowDetail): void {
  feedCache.set(cacheKey, { detail, cachedAt: Date.now() });
  while (feedCache.size > FEED_CACHE_MAX_ENTRIES) {
    const oldest = feedCache.keys().next().value;
    if (!oldest) {
      return;
    }
    feedCache.delete(oldest);
  }
}

export function parseDurationSeconds(value: string | undefined): number | undefined {
  const duration = value?.trim();
  if (!duration) {
    return undefined;
  }

  if (/^\d+$/.test(duration)) {
    return Number.parseInt(duration, 10);
  }

  const parts = duration.split(":").map((part) => Number.parseInt(part, 10));
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    return undefined;
  }

  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes > 59 || seconds > 59) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

async function lookupApplePodcast(input: ApplePodcastInput): Promise<ApplePodcastShow> {
  const url = new URL("/lookup", ITUNES_API_BASE_URL);
  url.searchParams.set("id", input.collectionId);
  url.searchParams.set("country", input.storefront);

  const response = await fetchJson<ItunesSearchResponse>(
    url,
    "Apple Podcasts lookup"
  );
  const result = (response.results ?? []).find(
    (candidate) => String(candidate.collectionId ?? candidate.trackId) === input.collectionId
  );
  const show = result && toApplePodcastShow(result, input.storefront);
  if (!show) {
    throw new Error("Apple Podcasts could not find that show in this storefront.");
  }

  return show;
}

function toApplePodcastShow(
  result: ItunesPodcastResult,
  storefront: string
): ApplePodcastShow | undefined {
  const id = result.collectionId ?? result.trackId;
  const title = result.collectionName?.trim() || result.trackName?.trim();
  if (!id || !title) {
    return undefined;
  }

  return {
    id: String(id),
    storefront,
    title,
    authorName: result.artistName?.trim() || undefined,
    artworkUrl: validHttpUrl(result.artworkUrl600) ?? validHttpUrl(result.artworkUrl100),
    genre: result.primaryGenreName?.trim() || undefined,
    episodeCount: parsePositiveInteger(String(result.trackCount ?? "")),
    applePodcastsUrl:
      validHttpUrl(result.collectionViewUrl) ?? validHttpUrl(result.trackViewUrl),
    feedUrl: validHttpUrl(result.feedUrl)
  };
}

async function fetchJson<T>(url: URL, label: string): Promise<T> {
  const response = await fetchResponse(url.toString(), label, {
    Accept: "application/json"
  });
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function fetchResponse(
  url: string,
  label: string,
  headers: Record<string, string>
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`${label} could not be reached: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${response.statusText}.`);
  }

  return response;
}

function asRecord(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || undefined;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return readText(record["#text"]);
}

function readAttribute(record: JsonObject | undefined, name: string): string | undefined {
  return readText(record?.[`@_${name}`]);
}

function readArtworkUrl(record: JsonObject): string | undefined {
  return (
    validHttpUrl(readAttribute(asRecord(record["itunes:image"]), "href")) ??
    validHttpUrl(readAttribute(asRecord(record["media:thumbnail"]), "url")) ??
    validHttpUrl(readText(asRecord(record.image)?.url))
  );
}

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function cleanDescription(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const clean = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || undefined;
}
