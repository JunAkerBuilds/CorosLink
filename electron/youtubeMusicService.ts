import { app, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  deleteSettings,
  getSetting,
  setSetting
} from "./database";
import type {
  YouTubeMusicAlbum,
  YouTubeMusicConfig,
  YouTubeMusicLibrary,
  YouTubeMusicPlaylist,
  YouTubeMusicSong,
  YouTubeMusicStatus,
  YouTubeMusicSyncResult
} from "./types";

const execFileAsync = promisify(execFile);
const PYTHON_COMMANDS = ["python3", "python"];
const BRIDGE_TIMEOUT_MS = 60_000;
const LIBRARY_TIMEOUT_MS = 180_000;
const DEFAULT_LIBRARY_LIMIT = 5000;
const YOUTUBE_MUSIC_DEVICE_CODE_ENDPOINT =
  "https://www.youtube.com/o/oauth2/device/code";
const YOUTUBE_MUSIC_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const YOUTUBE_MUSIC_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube";
const YOUTUBE_MUSIC_OAUTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0 Cobalt/Version";
const YTMUSICAPI_BRIDGE_SCRIPT = String.raw`
import json
import sys

try:
    from ytmusicapi import OAuthCredentials, YTMusic, setup
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"ytmusicapi import failed: {exc}"}))
    sys.exit(2)

def is_oauth_auth(auth_path):
    try:
        with open(auth_path, encoding="utf-8") as auth_file:
            payload = json.load(auth_file)
        required = {"access_token", "refresh_token", "scope", "token_type"}
        return required.issubset(set(payload.keys()))
    except Exception:
        return False

def create_ytmusic(auth_path, client_id="", client_secret=""):
    oauth_credentials = None
    if is_oauth_auth(auth_path):
        if not client_id or not client_secret:
            raise Exception("Add your YouTube Music OAuth Client ID and Client Secret first.")
        oauth_credentials = OAuthCredentials(client_id, client_secret)
    return YTMusic(auth_path, oauth_credentials=oauth_credentials)

command = sys.argv[1] if len(sys.argv) > 1 else ""

try:
    if command == "check":
        print(json.dumps({"ok": True}))
    elif command == "setup":
        auth_path = sys.argv[2]
        headers_raw = sys.stdin.read()
        setup(filepath=auth_path, headers_raw=headers_raw)
        print(json.dumps({"ok": True}))
    elif command == "library":
        auth_path = sys.argv[2]
        limit = int(sys.argv[3])
        client_id = sys.argv[4] if len(sys.argv) > 4 else ""
        client_secret = sys.argv[5] if len(sys.argv) > 5 else ""
        ytmusic = create_ytmusic(auth_path, client_id, client_secret)
        albums = ytmusic.get_library_albums(limit=limit)
        songs = ytmusic.get_library_songs(limit=limit)

        try:
            liked = ytmusic.get_liked_songs(limit=limit)
            liked_tracks = liked.get("tracks", []) if isinstance(liked, dict) else liked
            songs = songs + (liked_tracks or [])
        except Exception:
            pass

        playlists = []
        try:
            library_playlists = ytmusic.get_library_playlists(limit=limit)
        except Exception:
            library_playlists = []
        for entry in library_playlists:
            playlist_id = entry.get("playlistId")
            tracks = []
            if playlist_id:
                try:
                    detail = ytmusic.get_playlist(playlist_id, limit=limit)
                    tracks = detail.get("tracks", []) or []
                    if not entry.get("description"):
                        entry["description"] = detail.get("description")
                except Exception:
                    tracks = []
            playlists.append({
                "playlistId": playlist_id,
                "title": entry.get("title"),
                "description": entry.get("description"),
                "thumbnails": entry.get("thumbnails"),
                "tracks": tracks,
            })

        print(json.dumps({"albums": albums, "songs": songs, "playlists": playlists}))
    else:
        print(json.dumps({"ok": False, "error": f"Unknown command: {command}"}))
        sys.exit(2)
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
    sys.exit(1)
`;

const SETTINGS = {
  clientId: "youtubeMusic.clientId",
  clientSecret: "youtubeMusic.clientSecret",
  authUpdatedAt: "youtubeMusic.authUpdatedAt",
  libraryJson: "youtubeMusic.libraryJson"
};

interface PythonCheckResult {
  pythonCommand?: string;
  pythonAvailable: boolean;
  ytmusicapiAvailable: boolean;
  error?: string;
}

export function getYouTubeMusicConfig(): YouTubeMusicConfig {
  return {
    clientId: getSetting(SETTINGS.clientId) ?? "",
    clientSecret: getSetting(SETTINGS.clientSecret) ?? ""
  };
}

export async function saveYouTubeMusicConfig(
  config: YouTubeMusicConfig
): Promise<YouTubeMusicStatus> {
  const previous = getYouTubeMusicConfig();
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();

  setSetting(SETTINGS.clientId, clientId);
  setSetting(SETTINGS.clientSecret, clientSecret);

  if (
    previous.clientId !== clientId ||
    previous.clientSecret !== clientSecret
  ) {
    await clearYouTubeMusicAuth();
  }

  return getYouTubeMusicStatus();
}

export async function getYouTubeMusicStatus(): Promise<YouTubeMusicStatus> {
  const check = await checkYtMusicApi();
  const library = getStoredYouTubeMusicLibrary();
  const authMethod = getYouTubeMusicAuthMethod();

  return {
    configured: Boolean(
      getSetting(SETTINGS.clientId) && getSetting(SETTINGS.clientSecret)
    ),
    pythonAvailable: check.pythonAvailable,
    ytmusicapiAvailable: check.ytmusicapiAvailable,
    authenticated: fs.existsSync(getAuthPath()),
    authMethod,
    authUpdatedAt: getSetting(SETTINGS.authUpdatedAt),
    syncedAt: library.syncedAt,
    songCount: library.songs.length,
    albumCount: library.albums.length,
    playlistCount: library.playlists.length,
    dependencyError: check.error
  };
}

export function listYouTubeMusicLibrary(): YouTubeMusicLibrary {
  return getStoredYouTubeMusicLibrary();
}

export async function loginYouTubeMusic(): Promise<YouTubeMusicStatus> {
  await requireYtMusicApi();
  const config = getYouTubeMusicConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Add your YouTube Music OAuth Client ID and Client Secret first."
    );
  }

  const deviceCode = await requestYouTubeMusicDeviceCode(config.clientId);
  const loginUrl = `${deviceCode.verification_url}?user_code=${encodeURIComponent(
    deviceCode.user_code
  )}`;
  await shell.openExternal(loginUrl);
  const token = await waitForYouTubeMusicOAuthToken(config, deviceCode);
  await saveYouTubeMusicOAuthToken(token);

  return getYouTubeMusicStatus();
}

export async function saveYouTubeMusicAuth(
  headersRaw: string
): Promise<YouTubeMusicStatus> {
  const trimmedHeaders = normalizeYouTubeMusicHeaders(headersRaw).trim();
  if (!trimmedHeaders) {
    throw new Error("Paste YouTube Music request headers first.");
  }

  const check = await requireYtMusicApi();
  const authPath = getAuthPath();
  await fs.promises.mkdir(path.dirname(authPath), { recursive: true });
  await runBridge(check.pythonCommand, "setup", [authPath], trimmedHeaders);
  setSetting(SETTINGS.authUpdatedAt, new Date().toISOString());

  return getYouTubeMusicStatus();
}

export async function logoutYouTubeMusic(): Promise<YouTubeMusicStatus> {
  await clearYouTubeMusicAuth();
  return getYouTubeMusicStatus();
}

export async function syncYouTubeMusicLibrary(): Promise<YouTubeMusicSyncResult> {
  const check = await requireYtMusicApi();
  const authPath = getAuthPath();
  if (!fs.existsSync(authPath)) {
    throw new Error("Save YouTube Music headers first.");
  }

  const raw = await runBridge(check.pythonCommand, "library", [
    authPath,
    String(DEFAULT_LIBRARY_LIMIT),
    getSetting(SETTINGS.clientId) ?? "",
    getSetting(SETTINGS.clientSecret) ?? ""
  ]);
  const payload = JSON.parse(raw) as YtMusicLibraryPayload;
  const library = createYouTubeMusicLibrary(payload);
  setSetting(SETTINGS.libraryJson, JSON.stringify(library));

  return {
    ...library,
    status: await getYouTubeMusicStatus()
  };
}

function getAuthPath(): string {
  return path.join(app.getPath("userData"), "ytmusicapi-browser.json");
}

async function requestYouTubeMusicDeviceCode(
  clientId: string
): Promise<YouTubeMusicDeviceCodeResponse> {
  return postYouTubeMusicOAuth<YouTubeMusicDeviceCodeResponse>(
    YOUTUBE_MUSIC_DEVICE_CODE_ENDPOINT,
    {
      client_id: clientId,
      scope: YOUTUBE_MUSIC_OAUTH_SCOPE
    }
  );
}

async function waitForYouTubeMusicOAuthToken(
  config: YouTubeMusicConfig,
  deviceCode: YouTubeMusicDeviceCodeResponse
): Promise<YouTubeMusicOAuthTokenResponse> {
  const expiresAt = Date.now() + deviceCode.expires_in * 1000;
  let intervalMs = Math.max(1, deviceCode.interval ?? 5) * 1000;

  while (Date.now() < expiresAt) {
    await delay(intervalMs);

    const response = await fetch(YOUTUBE_MUSIC_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": YOUTUBE_MUSIC_OAUTH_USER_AGENT
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "http://oauth.net/grant_type/device/1.0",
        code: deviceCode.device_code
      }).toString()
    });
    const payload = (await response.json().catch(() => ({}))) as
      | YouTubeMusicOAuthTokenResponse
      | YouTubeMusicOAuthErrorResponse;

    if (response.ok) {
      const token = payload as YouTubeMusicOAuthTokenResponse;
      if (!token.access_token || !token.refresh_token) {
        throw new Error("Google OAuth did not return a refresh token.");
      }

      return token;
    }

    const error = (payload as YouTubeMusicOAuthErrorResponse).error;
    if (error === "authorization_pending") {
      continue;
    }

    if (error === "slow_down") {
      intervalMs += 5000;
      continue;
    }

    if (error === "access_denied") {
      throw new Error("YouTube Music sign-in was denied.");
    }

    if (error === "expired_token") {
      throw new Error("The YouTube Music sign-in code expired.");
    }

    throw new Error(toYouTubeMusicOAuthError(payload, response.status));
  }

  throw new Error("The YouTube Music sign-in code expired.");
}

async function postYouTubeMusicOAuth<T>(
  url: string,
  body: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": YOUTUBE_MUSIC_OAUTH_USER_AGENT
    },
    body: new URLSearchParams(body).toString()
  });
  const payload = (await response.json().catch(() => ({}))) as
    | T
    | YouTubeMusicOAuthErrorResponse;

  if (!response.ok) {
    throw new Error(toYouTubeMusicOAuthError(payload, response.status));
  }

  return payload as T;
}

async function saveYouTubeMusicOAuthToken(
  token: YouTubeMusicOAuthTokenResponse
): Promise<void> {
  const authPath = getAuthPath();
  await fs.promises.mkdir(path.dirname(authPath), { recursive: true });
  await fs.promises.writeFile(
    authPath,
    JSON.stringify(
      {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        scope: token.scope,
        token_type: token.token_type,
        expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
        expires_in: token.refresh_token_expires_in ?? token.expires_in
      },
      null,
      4
    )
  );
  setSetting(SETTINGS.authUpdatedAt, new Date().toISOString());
}

async function clearYouTubeMusicAuth(): Promise<void> {
  await fs.promises.rm(getAuthPath(), { force: true });
  deleteSettings([SETTINGS.authUpdatedAt, SETTINGS.libraryJson]);
}

function getYouTubeMusicAuthMethod(): YouTubeMusicStatus["authMethod"] {
  const raw = readAuthJson();
  if (!raw) {
    return undefined;
  }

  if (
    typeof raw.access_token === "string" &&
    typeof raw.refresh_token === "string"
  ) {
    return "oauth";
  }

  if (typeof raw.cookie === "string" || typeof raw.Cookie === "string") {
    return "headers";
  }

  return undefined;
}

function readAuthJson(): Record<string, unknown> | undefined {
  const authPath = getAuthPath();
  if (!fs.existsSync(authPath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(authPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function toYouTubeMusicOAuthError(
  payload: unknown,
  status: number
): string {
  const error =
    typeof payload === "object" && payload && "error" in payload
      ? String((payload as YouTubeMusicOAuthErrorResponse).error)
      : `HTTP ${status}`;
  const description =
    typeof payload === "object" && payload && "error_description" in payload
      ? String((payload as YouTubeMusicOAuthErrorResponse).error_description)
      : "";
  const suffix = description ? `: ${description}` : "";

  if (error === "invalid_client" || error === "unauthorized_client") {
    return `Google OAuth client failed (${error})${suffix}. Create a YouTube Music OAuth client with application type "TVs and Limited Input devices" and enable the YouTube Data API.`;
  }

  return `Google OAuth request failed (${error})${suffix}.`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function checkYtMusicApi(): Promise<PythonCheckResult> {
  const pythonCommand = await findPythonCommand();
  if (!pythonCommand) {
    return {
      pythonAvailable: false,
      ytmusicapiAvailable: false,
      error: "Python 3 is not available. Install Python 3.10+ and ytmusicapi."
    };
  }

  try {
    await runBridge(pythonCommand, "check", []);
    return {
      pythonCommand,
      pythonAvailable: true,
      ytmusicapiAvailable: true
    };
  } catch (caught) {
    return {
      pythonCommand,
      pythonAvailable: true,
      ytmusicapiAvailable: false,
      error: toErrorMessage(caught)
    };
  }
}

async function requireYtMusicApi(): Promise<
  PythonCheckResult & { pythonCommand: string }
> {
  const check = await checkYtMusicApi();
  if (!check.pythonCommand) {
    throw new Error(check.error ?? "Python 3 is not available.");
  }

  if (!check.ytmusicapiAvailable) {
    throw new Error(
      check.error ??
        "ytmusicapi is not installed. Run: python3 -m pip install ytmusicapi"
    );
  }

  return {
    ...check,
    pythonCommand: check.pythonCommand
  };
}

async function findPythonCommand(): Promise<string | undefined> {
  for (const command of PYTHON_COMMANDS) {
    try {
      await execFileAsync(command, ["--version"], { timeout: 5000 });
      return command;
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

async function runBridge(
  pythonCommand: string,
  command: string,
  args: string[],
  input?: string
): Promise<string> {
  const timeout = command === "library" ? LIBRARY_TIMEOUT_MS : BRIDGE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonCommand,
      ["-c", YTMUSICAPI_BRIDGE_SCRIPT, command, ...args],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("ytmusicapi command timed out."));
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();

      if (code !== 0) {
        reject(new Error(parseBridgeError(output) || errorOutput || "ytmusicapi failed."));
        return;
      }

      resolve(output);
    });

    child.stdin.end(input ?? "");
  });
}

function createYouTubeMusicLibrary(
  payload: YtMusicLibraryPayload
): YouTubeMusicLibrary {
  const songs = normalizeSongs(payload.songs ?? []);
  const albumMetadata = normalizeAlbums(payload.albums ?? []);
  const albums = mergeAlbums(albumMetadata, songs);
  const playlists = normalizePlaylists(payload.playlists ?? []);

  return {
    albums,
    songs,
    playlists,
    syncedAt: new Date().toISOString()
  };
}

function normalizePlaylists(
  rawPlaylists: YtMusicRawPlaylist[]
): YouTubeMusicPlaylist[] {
  const playlists: YouTubeMusicPlaylist[] = [];
  const seen = new Set<string>();

  for (const raw of rawPlaylists) {
    const title = cleanText(raw.title);
    if (!title) {
      continue;
    }

    const playlistId = cleanText(raw.playlistId);
    const key = playlistId || normalizeLibraryKey(title);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const songs = normalizeSongs(raw.tracks ?? []);
    playlists.push({
      id: createId(key),
      playlistId: playlistId || undefined,
      title,
      description: cleanText(raw.description) || undefined,
      thumbnailUrl: bestThumbnailUrl(raw.thumbnails),
      songCount: songs.length,
      songs
    });
  }

  return playlists.sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  );
}

function normalizeSongs(rawSongs: YtMusicRawSong[]): YouTubeMusicSong[] {
  const songs: YouTubeMusicSong[] = [];
  const seen = new Set<string>();

  for (const raw of rawSongs) {
    const songTitle = cleanText(raw.title);
    if (!songTitle) {
      continue;
    }

    const artistName = artistsToText(raw.artists);
    const albumTitle = cleanText(raw.album?.name);
    const videoId = cleanText(raw.videoId);
    const key = [
      videoId,
      normalizeLibraryKey(songTitle),
      normalizeLibraryKey(albumTitle),
      normalizeLibraryKey(artistName)
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    songs.push({
      id: createId(key),
      videoId: videoId || undefined,
      songTitle,
      albumTitle: albumTitle || undefined,
      artistName: artistName || undefined,
      videoUrl: videoId
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        : undefined,
      thumbnailUrl: bestThumbnailUrl(raw.thumbnails)
    });
  }

  return songs.sort((left, right) => {
    const albumCompare = (left.albumTitle ?? "").localeCompare(
      right.albumTitle ?? "",
      undefined,
      { sensitivity: "base" }
    );
    if (albumCompare !== 0) {
      return albumCompare;
    }

    return left.songTitle.localeCompare(right.songTitle, undefined, {
      sensitivity: "base"
    });
  });
}

function normalizeAlbums(rawAlbums: YtMusicRawAlbum[]): YouTubeMusicAlbum[] {
  const albums: YouTubeMusicAlbum[] = [];
  const seen = new Set<string>();

  for (const raw of rawAlbums) {
    const albumTitle = cleanText(raw.title);
    if (!albumTitle) {
      continue;
    }

    const artistName = artistsToText(raw.artists);
    const browseId = cleanText(raw.browseId);
    const playlistId = cleanText(raw.playlistId);
    const key =
      browseId ||
      playlistId ||
      `${normalizeLibraryKey(albumTitle)}|${normalizeLibraryKey(artistName)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    albums.push({
      id: createId(key),
      browseId: browseId || undefined,
      playlistId: playlistId || undefined,
      albumTitle,
      artistName: artistName || undefined,
      year: cleanText(raw.year) || undefined,
      thumbnailUrl: bestThumbnailUrl(raw.thumbnails),
      songCount: 0,
      songs: []
    });
  }

  return albums;
}

function mergeAlbums(
  albumMetadata: YouTubeMusicAlbum[],
  songs: YouTubeMusicSong[]
): YouTubeMusicAlbum[] {
  const albumsByKey = new Map<string, YouTubeMusicAlbum>();

  for (const album of albumMetadata) {
    albumsByKey.set(albumGroupKey(album.albumTitle, album.artistName), album);
  }

  for (const song of songs) {
    const albumTitle = song.albumTitle ?? "Unknown Album";
    const artistName = song.artistName;
    const key = albumGroupKey(albumTitle, artistName);
    const existing =
      albumsByKey.get(key) ??
      ({
        id: createId(key),
        albumTitle,
        artistName,
        songCount: 0,
        songs: []
      } satisfies YouTubeMusicAlbum);

    existing.songs.push(song);
    existing.songCount = existing.songs.length;
    albumsByKey.set(key, existing);
  }

  return [...albumsByKey.values()]
    .map((album) => ({
      ...album,
      songCount: album.songs.length || album.songCount,
      songs: album.songs.sort((left, right) =>
        left.songTitle.localeCompare(right.songTitle, undefined, {
          sensitivity: "base"
        })
      )
    }))
    .sort((left, right) => {
      const titleCompare = left.albumTitle.localeCompare(
        right.albumTitle,
        undefined,
        { sensitivity: "base" }
      );
      if (titleCompare !== 0) {
        return titleCompare;
      }

      return (left.artistName ?? "").localeCompare(right.artistName ?? "", undefined, {
        sensitivity: "base"
      });
    });
}

function getStoredYouTubeMusicLibrary(): YouTubeMusicLibrary {
  const raw = getSetting(SETTINGS.libraryJson);
  if (!raw) {
    return emptyYouTubeMusicLibrary();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<YouTubeMusicLibrary>;
    return {
      albums: Array.isArray(parsed.albums) ? parsed.albums : [],
      songs: Array.isArray(parsed.songs) ? parsed.songs : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      syncedAt: parsed.syncedAt
    };
  } catch {
    return emptyYouTubeMusicLibrary();
  }
}

function emptyYouTubeMusicLibrary(): YouTubeMusicLibrary {
  return { albums: [], songs: [], playlists: [] };
}

function artistsToText(
  artists?: Array<{ name?: string | null }> | null
): string {
  return (
    artists
      ?.map((artist) => cleanText(artist.name))
      .filter(Boolean)
      .join(", ") ?? ""
  );
}

function bestThumbnailUrl(
  thumbnails?: Array<{ url?: string | null }> | null
): string | undefined {
  return thumbnails?.slice().reverse().find((thumbnail) => thumbnail.url)?.url ?? undefined;
}

function albumGroupKey(albumTitle: string, artistName?: string): string {
  return `${normalizeLibraryKey(albumTitle)}|${normalizeLibraryKey(
    artistName ?? ""
  )}`;
}

function normalizeLibraryKey(value?: string): string {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function cleanText(value?: string | number | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function createId(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBridgeError(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as { error?: string };
    return parsed.error;
  } catch {
    return undefined;
  }
}

// ytmusicapi expects a raw "name: value" header block. Browsers also offer
// "Copy as cURL", which is easier to grab reliably, so accept either form and
// convert curl input into the header block ytmusicapi understands.
function normalizeYouTubeMusicHeaders(input: string): string {
  const fromCurl = extractHeadersFromCurl(input);
  return fromCurl ?? input;
}

function extractHeadersFromCurl(input: string): string | null {
  const trimmed = input.trim();
  const looksLikeCurl =
    /^curl\b/.test(trimmed) || /(?:^|\s)(?:-H|--header|-b|--cookie)\b/.test(trimmed);
  if (!looksLikeCurl) {
    return null;
  }

  const tokens = tokenizeShellCommand(trimmed);
  const headers: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-H" || token === "--header") {
      const value = tokens[index + 1];
      if (value) {
        headers.push(value);
        index += 1;
      }
    } else if (token === "-b" || token === "--cookie") {
      const value = tokens[index + 1];
      if (value && !value.includes("=")) {
        // Skip cookie-jar file arguments; only forward inline cookie strings.
        index += 1;
      } else if (value) {
        headers.push(`cookie: ${value}`);
        index += 1;
      }
    } else if (token.startsWith("-H") && token.length > 2) {
      headers.push(token.slice(2));
    }
  }

  return headers.length > 0 ? headers.join("\n") : null;
}

// Minimal POSIX-shell tokenizer covering the quoting browsers emit for
// "Copy as cURL" on macOS/Linux: '...', "...", $'...', and \ line breaks.
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

interface YtMusicLibraryPayload {
  albums?: YtMusicRawAlbum[];
  songs?: YtMusicRawSong[];
  playlists?: YtMusicRawPlaylist[];
}

interface YtMusicRawPlaylist {
  playlistId?: string;
  title?: string;
  description?: string;
  thumbnails?: Array<{ url?: string | null }> | null;
  tracks?: YtMusicRawSong[];
}

interface YtMusicRawAlbum {
  title?: string;
  browseId?: string;
  playlistId?: string;
  year?: string | number;
  artists?: Array<{ name?: string | null }> | null;
  thumbnails?: Array<{ url?: string | null }> | null;
}

interface YtMusicRawSong {
  title?: string;
  videoId?: string;
  artists?: Array<{ name?: string | null }> | null;
  album?: {
    name?: string | null;
    id?: string | null;
  } | null;
  thumbnails?: Array<{ url?: string | null }> | null;
}

interface YouTubeMusicDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval?: number;
}

interface YouTubeMusicOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expires_in: number;
  refresh_token_expires_in?: number;
}

interface YouTubeMusicOAuthErrorResponse {
  error?: string;
  error_description?: string;
}
