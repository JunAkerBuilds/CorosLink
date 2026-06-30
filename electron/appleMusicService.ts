// Wrapper around Apple Music's internal web API ("amp-api"). The official
// MusicKit JS client authenticates every request with a developer token (a
// short-lived JWT), a media-user-token that identifies the signed-in account,
// and the session cookies. None of that is documented, so the practical way to
// reuse a browser session is to paste the request headers (or a "Copy as cURL")
// straight from DevTools, exactly like the YouTube Music flow does. The bearer
// token belongs to Apple's own web player, so no Apple Developer membership is
// required — it just expires often and has to be re-copied.

import {
  deleteSettings,
  getSetting,
  setSetting
} from "./database";
import type {
  AppleMusicPlaylist,
  AppleMusicStatus,
  AppleMusicTrack
} from "./types";

const AMP_API_BASE_URL = "https://amp-api.music.apple.com";
const APPLE_MUSIC_ORIGIN = "https://music.apple.com";

const SETTINGS = {
  credentialsJson: "appleMusic.credentialsJson",
  authUpdatedAt: "appleMusic.authUpdatedAt"
};

export interface AppleMusicCredentials {
  /** MusicKit developer token (the `Authorization: Bearer …` JWT). */
  developerToken: string;
  /** Per-account token from the `media-user-token` header. */
  userToken?: string;
  /** Raw `Cookie` header value, forwarded verbatim. */
  cookie?: string;
  /** Two-letter storefront, e.g. "us". Falls back to the account default. */
  storefront?: string;
}

/** Reports whether stored credentials exist (drives the connect UI). */
export function getAppleMusicStatus(): AppleMusicStatus {
  const credentials = readStoredCredentials();
  return {
    authenticated: Boolean(credentials),
    hasUserToken: Boolean(credentials?.userToken),
    authUpdatedAt: getSetting(SETTINGS.authUpdatedAt)
  };
}

/** Parses pasted headers, stores the credentials, and returns the new status. */
export function saveAppleMusicAuth(headersRaw: string): AppleMusicStatus {
  const credentials = parseAppleMusicCredentials(headersRaw);
  setSetting(SETTINGS.credentialsJson, JSON.stringify(credentials));
  setSetting(SETTINGS.authUpdatedAt, new Date().toISOString());
  return getAppleMusicStatus();
}

export function logoutAppleMusic(): AppleMusicStatus {
  deleteSettings([SETTINGS.credentialsJson, SETTINGS.authUpdatedAt]);
  return getAppleMusicStatus();
}

/** Fetches a playlist (with its full track list) using the stored credentials. */
export function fetchAppleMusicPlaylist(
  playlist: string
): Promise<AppleMusicPlaylist> {
  return getAppleMusicPlaylist(playlist, requireStoredCredentials());
}

/**
 * Lists every playlist in the signed-in account's library (metadata only, no
 * tracks). Mirrors the Spotify integration's listSpotifyPlaylists.
 */
export async function listAppleMusicPlaylists(): Promise<AppleMusicPlaylist[]> {
  const credentials = requireStoredCredentials();
  if (!credentials.userToken) {
    throw new Error(
      "Listing your library needs a media-user-token. Re-copy the headers while signed in to music.apple.com."
    );
  }

  const playlists: AppleMusicPlaylist[] = [];
  let path: string | undefined = "/v1/me/library/playlists?limit=100";

  while (path) {
    const page: AmpResponse<AmpPlaylist> = await ampApiGet<
      AmpResponse<AmpPlaylist>
    >(stripOrigin(path), {}, credentials);

    for (const entry of page.data ?? []) {
      const attributes = entry.attributes ?? {};
      playlists.push({
        id: entry.id,
        kind: "library",
        name: attributes.name ?? "Untitled playlist",
        description:
          attributes.description?.standard ?? attributes.description?.short,
        curatorName: attributes.curatorName,
        lastModifiedAt: attributes.lastModifiedDate,
        artworkUrl: buildArtworkUrl(attributes.artwork),
        url: attributes.url,
        trackCount: attributes.trackCount ?? 0,
        tracks: []
      });
    }

    path = page.next;
  }

  return playlists.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

function requireStoredCredentials(): AppleMusicCredentials {
  const credentials = readStoredCredentials();
  if (!credentials) {
    throw new Error(
      "Connect Apple Music first by pasting your request headers."
    );
  }

  return credentials;
}

function readStoredCredentials(): AppleMusicCredentials | undefined {
  const raw = getSetting(SETTINGS.credentialsJson);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppleMusicCredentials>;
    return parsed.developerToken
      ? (parsed as AppleMusicCredentials)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extracts the credentials Apple Music needs from a pasted header block or a
 * browser "Copy as cURL" command. Accepts either `name: value` lines or curl
 * `-H`/`-b` flags.
 */
export function parseAppleMusicCredentials(
  headersRaw: string
): AppleMusicCredentials {
  const headers = parseHeaderBlock(headersRaw);

  const authorization = headers.get("authorization") ?? "";
  const developerToken = authorization.replace(/^bearer\s+/i, "").trim();
  if (!developerToken) {
    throw new Error(
      'Could not find an "Authorization: Bearer …" token in the pasted headers. Copy the headers from a music.apple.com request in DevTools.'
    );
  }

  return {
    developerToken,
    userToken: headers.get("media-user-token")?.trim() || undefined,
    cookie: headers.get("cookie")?.trim() || undefined
  };
}

/**
 * Fetches playlist metadata and the full (paginated) track list. `playlist`
 * may be a music.apple.com URL or a bare playlist id (`pl.…` or `p.…`).
 */
export async function getAppleMusicPlaylist(
  playlist: string,
  credentials: AppleMusicCredentials
): Promise<AppleMusicPlaylist> {
  const { id, kind } = resolvePlaylistId(playlist);

  if (kind === "library" && !credentials.userToken) {
    throw new Error(
      "That looks like a personal library playlist (p.…), which needs a media-user-token. Make sure you copied the headers while signed in to music.apple.com."
    );
  }

  const storefront = await resolveStorefront(credentials);

  const path =
    kind === "library"
      ? `/v1/me/library/playlists/${encodeURIComponent(id)}`
      : `/v1/catalog/${storefront}/playlists/${encodeURIComponent(id)}`;

  const response = await ampApiGet<AmpResponse<AmpPlaylist>>(
    path,
    { include: "tracks" },
    credentials
  );

  const data = response.data?.[0];
  if (!data) {
    throw new Error("Apple Music returned no playlist for that id.");
  }

  const attributes = data.attributes ?? {};
  const tracks = await collectTracks(data, credentials);

  return {
    id: data.id,
    kind,
    name: attributes.name ?? "Untitled playlist",
    description:
      attributes.description?.standard ?? attributes.description?.short,
    curatorName: attributes.curatorName,
    lastModifiedAt: attributes.lastModifiedDate,
    artworkUrl: buildArtworkUrl(attributes.artwork),
    url: attributes.url ?? `${APPLE_MUSIC_ORIGIN}/playlist/${data.id}`,
    trackCount: tracks.length,
    tracks
  };
}

async function collectTracks(
  playlist: AmpPlaylist,
  credentials: AppleMusicCredentials
): Promise<AppleMusicTrack[]> {
  const relationship = playlist.relationships?.tracks;
  const tracks: AppleMusicTrack[] = (relationship?.data ?? []).map(mapTrack);

  // The first page arrives inline via `include=tracks`; follow `next` for the
  // rest. `next` is a path like "/v1/.../tracks?offset=100".
  let next = relationship?.next;
  while (next) {
    const page = await ampApiGet<AmpResponse<AmpTrack>>(
      stripOrigin(next),
      {},
      credentials
    );
    for (const entry of page.data ?? []) {
      tracks.push(mapTrack(entry));
    }
    next = page.next;
  }

  return tracks;
}

function mapTrack(entry: AmpTrack): AppleMusicTrack {
  const attributes = entry.attributes ?? {};
  return {
    id: entry.id,
    title: attributes.name ?? "Unknown track",
    artistName: attributes.artistName,
    albumName: attributes.albumName,
    durationMs: attributes.durationInMillis,
    trackNumber: attributes.trackNumber,
    isrc: attributes.isrc,
    artworkUrl: buildArtworkUrl(attributes.artwork),
    catalogUrl: attributes.url
  };
}

async function resolveStorefront(
  credentials: AppleMusicCredentials
): Promise<string> {
  if (credentials.storefront) {
    return credentials.storefront;
  }

  // The account storefront is only available when a user token is present.
  if (credentials.userToken) {
    try {
      const response = await ampApiGet<AmpResponse<{ id: string }>>(
        "/v1/me/storefront",
        {},
        credentials
      );
      const id = response.data?.[0]?.id;
      if (id) {
        credentials.storefront = id;
        return id;
      }
    } catch {
      // Fall through to the default below.
    }
  }

  return "us";
}

async function ampApiGet<T>(
  path: string,
  params: Record<string, string | number>,
  credentials: AppleMusicCredentials
): Promise<T> {
  const url = new URL(path, AMP_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.developerToken}`,
    Origin: APPLE_MUSIC_ORIGIN,
    Accept: "application/json"
  };
  if (credentials.userToken) {
    headers["media-user-token"] = credentials.userToken;
  }
  if (credentials.cookie) {
    headers.Cookie = credentials.cookie;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(await formatAmpApiError(response));
  }

  return response.json() as Promise<T>;
}

async function formatAmpApiError(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return "Apple Music rejected the credentials (401/403). The developer token expires often — re-copy fresh headers from music.apple.com.";
  }

  try {
    const payload = (await response.json()) as AmpErrorResponse;
    const message = payload.errors?.[0]?.detail ?? payload.errors?.[0]?.title;
    if (message) {
      return `Apple Music API error: ${message}`;
    }
  } catch {
    // Non-JSON error body; fall through to the status line.
  }

  return `Apple Music API request failed: ${response.status} ${response.statusText}`;
}

function resolvePlaylistId(input: string): {
  id: string;
  kind: "catalog" | "library";
} {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Provide an Apple Music playlist URL or id.");
  }

  // Bare id, e.g. "pl.u-xxxx" (catalog) or "p.xxxx" (library).
  if (!/^https?:\/\//i.test(trimmed)) {
    return { id: trimmed, kind: classifyId(trimmed) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Could not parse that Apple Music playlist URL.");
  }

  // The id is the last path segment for both catalog
  // (.../playlist/name/pl.xxx) and library (.../library/playlist/p.xxx) URLs.
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments[segments.length - 1];
  if (!id) {
    throw new Error("That Apple Music URL does not contain a playlist id.");
  }

  return { id, kind: classifyId(id) };
}

function classifyId(id: string): "catalog" | "library" {
  return id.startsWith("p.") && !id.startsWith("pl.") ? "library" : "catalog";
}

function buildArtworkUrl(artwork?: AmpArtwork, size = 512): string | undefined {
  if (!artwork?.url) {
    return undefined;
  }

  // Apple artwork URLs are templates with {w}/{h}/{f} placeholders.
  return artwork.url
    .replace("{w}", String(size))
    .replace("{h}", String(size))
    .replace("{f}", "jpg");
}

function stripOrigin(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith("http")) {
    return pathOrUrl;
  }

  const url = new URL(pathOrUrl);
  return url.pathname + url.search;
}

/**
 * Parses a header block. Handles both `name: value` lines (DevTools "Copy
 * request headers") and curl `-H`/`-b`/`--header`/`--cookie` flags ("Copy as
 * cURL"). Returns a lowercase-keyed map.
 */
function parseHeaderBlock(input: string): Map<string, string> {
  const headers = new Map<string, string>();
  const trimmed = input.trim();

  const looksLikeCurl =
    /^curl\b/.test(trimmed) ||
    /(?:^|\s)(?:-H|--header|-b|--cookie)\b/.test(trimmed);

  if (looksLikeCurl) {
    const tokens = tokenizeShellCommand(trimmed);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "-H" || token === "--header") {
        addHeaderLine(headers, tokens[index + 1]);
        index += 1;
      } else if (token.startsWith("-H") && token.length > 2) {
        addHeaderLine(headers, token.slice(2));
      } else if (token === "-b" || token === "--cookie") {
        const value = tokens[index + 1];
        if (value && value.includes("=")) {
          headers.set("cookie", value);
        }
        index += 1;
      }
    }
    return headers;
  }

  for (const line of trimmed.split(/\r?\n/)) {
    addHeaderLine(headers, line);
  }
  return headers;
}

function addHeaderLine(headers: Map<string, string>, line?: string): void {
  if (!line) {
    return;
  }

  const separator = line.indexOf(":");
  if (separator === -1) {
    return;
  }

  const name = stripWrappers(line.slice(0, separator)).toLowerCase();
  const value = stripWrappers(line.slice(separator + 1));
  if (name && value) {
    headers.set(name, value);
  }
}

// DevTools emits headers in several shapes: raw "name: value" lines, curl
// "-H 'name: value'", and "Copy as fetch" JS objects like `"name": "value",`.
// Strip the surrounding quotes and trailing commas the JS form adds so every
// variant parses the same way.
function stripWrappers(value: string): string {
  let result = value.trim();
  if (result.endsWith(",")) {
    result = result.slice(0, -1).trim();
  }
  if (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1);
  }
  return result.trim();
}

// Minimal POSIX-shell tokenizer covering the quoting browsers emit for "Copy as
// cURL" on macOS/Linux: '...', "...", $'...', and \ line breaks.
function tokenizeShellCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  let index = 0;

  const doubleQuoteEscapes = new Set(['"', "\\", "$", "`"]);
  const ansiCEscapes: Record<string, string> = {
    n: "\n",
    t: "\t",
    r: "\r",
    "\\": "\\",
    "'": "'",
    '"': '"'
  };

  while (index < input.length) {
    const char = input[index];

    if (char === "\\" && input[index + 1] === "\n") {
      index += 2;
      continue;
    }

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (hasCurrent) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
      index += 1;
      continue;
    }

    if (char === "$" && input[index + 1] === "'") {
      hasCurrent = true;
      index += 2;
      while (index < input.length && input[index] !== "'") {
        if (input[index] === "\\" && index + 1 < input.length) {
          const next = input[index + 1];
          current += ansiCEscapes[next] ?? next;
          index += 2;
        } else {
          current += input[index];
          index += 1;
        }
      }
      index += 1;
      continue;
    }

    if (char === "'") {
      hasCurrent = true;
      index += 1;
      while (index < input.length && input[index] !== "'") {
        current += input[index];
        index += 1;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      hasCurrent = true;
      index += 1;
      while (index < input.length && input[index] !== '"') {
        if (input[index] === "\\" && index + 1 < input.length) {
          const next = input[index + 1];
          current += doubleQuoteEscapes.has(next) ? next : `\\${next}`;
          index += 2;
        } else {
          current += input[index];
          index += 1;
        }
      }
      index += 1;
      continue;
    }

    if (char === "\\" && index + 1 < input.length) {
      current += input[index + 1];
      hasCurrent = true;
      index += 2;
      continue;
    }

    current += char;
    hasCurrent = true;
    index += 1;
  }

  if (hasCurrent) {
    tokens.push(current);
  }

  return tokens;
}

interface AmpResponse<T> {
  data?: T[];
  next?: string;
}

interface AmpPlaylist {
  id: string;
  attributes?: {
    name?: string;
    curatorName?: string;
    lastModifiedDate?: string;
    url?: string;
    trackCount?: number;
    description?: { standard?: string; short?: string };
    artwork?: AmpArtwork;
  };
  relationships?: {
    tracks?: {
      data?: AmpTrack[];
      next?: string;
    };
  };
}

interface AmpTrack {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    trackNumber?: number;
    isrc?: string;
    url?: string;
    artwork?: AmpArtwork;
  };
}

interface AmpArtwork {
  url?: string;
  width?: number;
  height?: number;
}

interface AmpErrorResponse {
  errors?: Array<{ title?: string; detail?: string }>;
}
