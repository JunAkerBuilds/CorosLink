import { BrowserWindow } from "electron";
import { expectedError } from "./diagnosticsLog";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import SpotifyWebApi from "spotify-web-api-node";
import {
  deleteSettings,
  getSetting,
  getSpotifySyncTrack,
  listSpotifySyncTracks,
  markDownloadTransferred,
  setSetting,
  upsertSpotifySyncTrack
} from "./database";
import { downloadAudioSearch } from "./downloadService";
import { readPlaylistTracks } from "./spotifyInternal";
import {
  SPOTIFY_OAUTH_CALLBACK_PORT,
  SPOTIFY_OAUTH_TLS_CREDENTIALS
} from "./spotifyOAuthTls";
import { transferFileToWatch } from "./watchService";
import type {
  LocalTrack,
  SpotifyConfig,
  SpotifyPlaylist,
  SpotifyPlaylistTrack,
  SpotifyStatus,
  SpotifySyncResult,
  SpotifySyncTrack,
  SpotifySyncUpdate
} from "./types";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

const SETTINGS = {
  clientId: "spotify.clientId",
  // Only written by versions before PKCE; its presence marks tokens that
  // cannot be refreshed without the secret.
  legacyClientSecret: "spotify.clientSecret",
  accessToken: "spotify.accessToken",
  refreshToken: "spotify.refreshToken",
  expiresAt: "spotify.expiresAt",
  userId: "spotify.userId",
  displayName: "spotify.displayName",
  followedAccessToken: "spotify.followed.accessToken",
  followedRefreshToken: "spotify.followed.refreshToken",
  followedExpiresAt: "spotify.followed.expiresAt"
};

interface SpotifyGrant {
  clientId: () => string;
  port: number;
  // Serve the loopback callback over https with the bundled self-signed cert.
  tls: boolean;
  callbackPath: string;
  scopes: string[];
  windowTitle: string;
  keys: { accessToken: string; refreshToken: string; expiresAt: string };
}

// The user's own Spotify Developer app. Development Mode only lets it read
// playlists the user owns or collaborates on.
const APP_GRANT: SpotifyGrant = {
  clientId: requireClientId,
  // Kept on https so Spotify apps registered with the original redirect URI
  // keep working without changes.
  port: SPOTIFY_OAUTH_CALLBACK_PORT,
  tls: true,
  callbackPath: "/callback",
  scopes: ["playlist-read-private", "playlist-read-collaborative", "user-read-private"],
  windowTitle: "Log in with Spotify",
  keys: {
    accessToken: SETTINGS.accessToken,
    refreshToken: SETTINGS.refreshToken,
    expiresAt: SETTINGS.expiresAt
  }
};

// Optional: Spotify's own desktop client identity, the one librespot (and so
// Spotifast, ncspot, spotify-player) signs in with. It is not subject to
// Development Mode, so it can read playlists the user only follows. Spotify
// does not sanction third-party use of it and may block it at any time; it is
// used only to read playlist items the user's own app is refused.
const FOLLOWED_GRANT: SpotifyGrant = {
  clientId: () => "65b708073fc0480ea92a077233ca87bd",
  port: 8898,
  tls: false,
  callbackPath: "/login",
  scopes: ["playlist-read-private", "playlist-read-collaborative"],
  windowTitle: "Unlock followed Spotify playlists",
  keys: {
    accessToken: SETTINGS.followedAccessToken,
    refreshToken: SETTINGS.followedRefreshToken,
    expiresAt: SETTINGS.followedExpiresAt
  }
};

function redirectUriFor(grant: SpotifyGrant): string {
  const scheme = grant.tls ? "https" : "http";
  return `${scheme}://127.0.0.1:${grant.port}${grant.callbackPath}`;
}

const REDIRECT_URI = redirectUriFor(APP_GRANT);

export function getSpotifyConfig(): SpotifyConfig {
  return {
    clientId: getSetting(SETTINGS.clientId) ?? "",
    redirectUri: REDIRECT_URI
  };
}

export function saveSpotifyConfig(config: SpotifyConfig): SpotifyStatus {
  const previous = getSpotifyConfig();
  const clientId = config.clientId.trim();

  setSetting(SETTINGS.clientId, clientId);

  if (previous.clientId !== clientId) {
    clearSpotifyTokens();
  }

  return getSpotifyStatus();
}

export function getSpotifyStatus(): SpotifyStatus {
  dropLegacySpotifyAuth();
  const config = getSpotifyConfig();
  const expiresAt = getSetting(SETTINGS.expiresAt);
  const refreshToken = getSetting(SETTINGS.refreshToken);

  return {
    configured: Boolean(config.clientId),
    authenticated: Boolean(refreshToken),
    redirectUri: REDIRECT_URI,
    displayName: getSetting(SETTINGS.displayName),
    userId: getSetting(SETTINGS.userId),
    followedPlaylistsUnlocked: Boolean(
      refreshToken && getSetting(SETTINGS.followedRefreshToken)
    ),
    tokenExpiresAt: expiresAt
      ? new Date(Number(expiresAt)).toISOString()
      : undefined
  };
}

export function logoutSpotify(): SpotifyStatus {
  clearSpotifyTokens();
  return getSpotifyStatus();
}

export async function loginSpotify(
  parentWindow?: BrowserWindow
): Promise<SpotifyStatus> {
  const token = await authorizeGrant(APP_GRANT, parentWindow);

  const api = new SpotifyWebApi({ accessToken: token.access_token });
  const profile = await api.getMe();
  setSetting(SETTINGS.userId, profile.body.id);
  setSetting(
    SETTINGS.displayName,
    profile.body.display_name || profile.body.id
  );

  return getSpotifyStatus();
}

export async function unlockSpotifyFollowedPlaylists(
  parentWindow?: BrowserWindow
): Promise<SpotifyStatus> {
  if (!getSetting(SETTINGS.refreshToken)) {
    throw new Error("Log in to Spotify first.");
  }

  // No Web API call here: the desktop identity is rate-limited there.
  await authorizeGrant(FOLLOWED_GRANT, parentWindow);
  return getSpotifyStatus();
}

export function lockSpotifyFollowedPlaylists(): SpotifyStatus {
  deleteSettings(Object.values(FOLLOWED_GRANT.keys));
  return getSpotifyStatus();
}

async function authorizeGrant(
  grant: SpotifyGrant,
  parentWindow?: BrowserWindow
): Promise<SpotifyTokenResponse> {
  const clientId = grant.clientId();
  const redirectUri = redirectUriFor(grant);
  const state = crypto.randomBytes(18).toString("hex");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: grant.scopes.join(" "),
    show_dialog: "true"
  }).toString();

  const code = await waitForAuthorizationCode(
    grant,
    authUrl.toString(),
    state,
    parentWindow
  );
  const token = await requestSpotifyToken({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  });
  storeSpotifyToken(grant, token);
  return token;
}

function pickImageUrl(
  images: SpotifyApi.ImageObject[] | undefined,
  edge: "largest" | "smallest"
): string | undefined {
  if (!images || images.length === 0) {
    return undefined;
  }

  const withDimensions = images.filter((image) => Boolean(image?.url));
  if (withDimensions.length === 0) {
    return undefined;
  }

  const sorted = [...withDimensions].sort(
    (left, right) => (right.width ?? 0) - (left.width ?? 0)
  );
  const chosen = edge === "largest" ? sorted[0] : sorted[sorted.length - 1];
  return chosen.url;
}

function largestImageUrl(
  images: SpotifyApi.ImageObject[] | undefined
): string | undefined {
  return pickImageUrl(images, "largest");
}

function smallestImageUrl(
  images: SpotifyApi.ImageObject[] | undefined
): string | undefined {
  return pickImageUrl(images, "smallest");
}

export async function listSpotifyPlaylists(): Promise<SpotifyPlaylist[]> {
  const api = await getAuthorizedSpotifyApi();
  const profile = await api.getMe();
  const userId = profile.body.id;
  const followedUnlocked = Boolean(getSetting(SETTINGS.followedRefreshToken));
  const playlists: SpotifyPlaylist[] = [];
  let offset = 0;

  while (true) {
    const response = await api.getUserPlaylists({
      limit: 50,
      offset
    });

    for (const playlist of response.body.items) {
      const playlistLike = playlist as SpotifyApi.PlaylistObjectSimplified & {
        items?: { total?: number };
      };
      playlists.push({
        id: playlist.id,
        name: playlist.name,
        ownerId: playlist.owner.id,
        ownerName: playlist.owner.display_name || playlist.owner.id,
        collaborative: playlist.collaborative,
        public: playlist.public,
        totalTracks: playlistLike.items?.total ?? playlist.tracks?.total ?? 0,
        snapshotId: playlist.snapshot_id,
        syncable:
          followedUnlocked ||
          playlist.owner.id === userId ||
          playlist.collaborative,
        description: playlist.description || undefined,
        artworkUrl: largestImageUrl(playlist.images),
        url: playlist.external_urls?.spotify
      });
    }

    offset += response.body.items.length;
    if (!response.body.next || response.body.items.length === 0) {
      break;
    }
  }

  return playlists.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listSpotifyPlaylistTracks(
  playlistId: string
): Promise<SpotifyPlaylistTrack[]> {
  const accessToken = await getGrantAccessToken(APP_GRANT);
  const tracks: SpotifyPlaylistTrack[] = [];
  let offset = 0;

  while (true) {
    let response: SpotifyPlaylistItemsResponse;
    try {
      response = await spotifyGet<SpotifyPlaylistItemsResponse>(
        accessToken,
        `/v1/playlists/${playlistId}/items`,
        { limit: 100, offset }
      );
    } catch (error) {
      // Development Mode refuses playlists the user only follows; read those
      // through Spotify's internal endpoints when followed playlists are
      // unlocked.
      if (
        offset === 0 &&
        error instanceof SpotifyHttpError &&
        (error.status === 403 || error.status === 404) &&
        getSetting(SETTINGS.followedRefreshToken)
      ) {
        const internal = await readPlaylistTracks(
          await getGrantAccessToken(FOLLOWED_GRANT),
          playlistId
        );
        return internal.map((track) =>
          toPlaylistTrack({
            spotifyTrackId: track.id,
            artistName: track.artistName,
            trackName: track.trackName,
            albumName: track.albumName,
            durationMs: track.durationMs,
            addedAt: track.addedAt,
            artworkUrl: track.artworkUrl
          })
        );
      }
      throw error;
    }

    for (const item of response.items) {
      const track = item.item ?? item.track;
      if (!track || track.type !== "track" || !track.id) {
        continue;
      }

      tracks.push(
        toPlaylistTrack({
          spotifyTrackId: track.id,
          artistName:
            track.artists.map((artist) => artist.name).join(", ") ||
            "Unknown Artist",
          trackName: track.name,
          albumName: track.album?.name,
          durationMs: track.duration_ms,
          addedAt: item.added_at,
          artworkUrl: smallestImageUrl(track.album?.images)
        })
      );
    }

    offset += response.items.length;
    if (!response.next || response.items.length === 0) {
      break;
    }
  }

  return tracks;
}

function toPlaylistTrack(
  track: Omit<SpotifyPlaylistTrack, "filename" | "query">
): SpotifyPlaylistTrack {
  return {
    ...track,
    filename: `${sanitizeFileBaseName(`${track.artistName} - ${track.trackName}`)}.mp3`,
    query: `${track.artistName} ${track.trackName} official audio`
  };
}

export function listSpotifySyncState(playlistId: string): SpotifySyncTrack[] {
  return listSpotifySyncTracks(playlistId);
}

export async function syncSpotifyPlaylist(
  playlistId: string,
  autoTransfer: boolean,
  onUpdate: (update: SpotifySyncUpdate) => void
): Promise<SpotifySyncResult> {
  const tracks = await listSpotifyPlaylistTracks(playlistId);
  let completed = 0;
  let failed = 0;

  for (const track of tracks) {
    const existing = getSpotifySyncTrack(playlistId, track.spotifyTrackId);
    const existingFileStillExists =
      existing?.filePath && fs.existsSync(existing.filePath);

    if (existing?.status === "done" && existingFileStillExists) {
      const current = upsertSpotifySyncTrack({
        ...existing,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename
      });
      onUpdate(current);
      completed += 1;
      continue;
    }

    emitSyncUpdate(
      {
        playlistId,
        spotifyTrackId: track.spotifyTrackId,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename,
        status: "queued"
      },
      onUpdate
    );

    emitSyncUpdate(
      {
        playlistId,
        spotifyTrackId: track.spotifyTrackId,
        artistName: track.artistName,
        trackName: track.trackName,
        query: track.query,
        filename: track.filename,
        status: "downloading"
      },
      onUpdate
    );

    try {
      const sourceUrl = `spotify:${playlistId}:${track.spotifyTrackId}`;
      const result = await downloadAudioSearch(
        track.query,
        path.basename(track.filename, ".mp3"),
        sourceUrl
      );
      const downloadedTrack = firstDownloadedTrack(result.tracks);

      if (autoTransfer) {
        await transferFileToWatch(downloadedTrack.filePath);
        markDownloadTransferred(downloadedTrack.id);
      }

      emitSyncUpdate(
        {
          playlistId,
          spotifyTrackId: track.spotifyTrackId,
          artistName: track.artistName,
          trackName: track.trackName,
          query: track.query,
          filename: path.basename(downloadedTrack.filePath),
          status: "done",
          localDownloadId: downloadedTrack.id,
          filePath: downloadedTrack.filePath
        },
        onUpdate
      );
      completed += 1;
    } catch (error) {
      emitSyncUpdate(
        {
          playlistId,
          spotifyTrackId: track.spotifyTrackId,
          artistName: track.artistName,
          trackName: track.trackName,
          query: track.query,
          filename: track.filename,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        },
        onUpdate
      );
      failed += 1;
    }
  }

  return {
    playlistId,
    tracks: listSpotifySyncTracks(playlistId),
    completed,
    failed
  };
}

function emitSyncUpdate(
  track: Omit<SpotifySyncTrack, "updatedAt">,
  onUpdate: (update: SpotifySyncUpdate) => void
): void {
  onUpdate(upsertSpotifySyncTrack(track));
}

function firstDownloadedTrack(tracks: LocalTrack[]): LocalTrack {
  const track = tracks[0];
  if (!track) {
    throw new Error("No MP3 file was downloaded.");
  }

  return track;
}

async function getAuthorizedSpotifyApi(): Promise<SpotifyWebApi> {
  return new SpotifyWebApi({
    accessToken: await getGrantAccessToken(APP_GRANT)
  });
}

async function getGrantAccessToken(grant: SpotifyGrant): Promise<string> {
  dropLegacySpotifyAuth();
  const accessToken = getSetting(grant.keys.accessToken);
  const refreshToken = getSetting(grant.keys.refreshToken);
  const expiresAt = Number(getSetting(grant.keys.expiresAt) ?? 0);

  if (!refreshToken) {
    throw new Error(
      grant === APP_GRANT
        ? "Log in to Spotify first."
        : "Unlock followed playlists first."
    );
  }

  if (accessToken && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }

  const refreshed = await requestSpotifyToken({
    client_id: grant.clientId(),
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  storeSpotifyToken(grant, refreshed);
  return refreshed.access_token;
}

function requireClientId(): string {
  const { clientId } = getSpotifyConfig();
  if (!clientId) {
    throw new Error("Add your Spotify Client ID first.");
  }
  return clientId;
}

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function requestSpotifyToken(
  form: Record<string, string>
): Promise<SpotifyTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form)
  });
  const body = (await response.json().catch(() => ({}))) as
    | SpotifyTokenResponse
    | { error?: string; error_description?: string };

  if (!response.ok || !("access_token" in body)) {
    const detail =
      "error_description" in body && body.error_description
        ? body.error_description
        : "error" in body && body.error
          ? body.error
          : `${response.status} ${response.statusText}`;
    throw new Error(`Spotify token request failed: ${detail}`);
  }

  return body;
}

function storeSpotifyToken(
  grant: SpotifyGrant,
  token: SpotifyTokenResponse
): void {
  setSetting(grant.keys.accessToken, token.access_token);
  // Spotify rotates refresh tokens for PKCE clients; keep the old one only
  // when a refresh response omits it.
  if (token.refresh_token) {
    setSetting(grant.keys.refreshToken, token.refresh_token);
  }
  setSetting(
    grant.keys.expiresAt,
    String(Date.now() + token.expires_in * 1000)
  );
}

// Tokens issued to the old client-secret flow cannot be refreshed with PKCE,
// so forget them and the secret; the user signs in once more.
function dropLegacySpotifyAuth(): void {
  if (getSetting(SETTINGS.legacyClientSecret) === undefined) {
    return;
  }
  deleteSettings([SETTINGS.legacyClientSecret]);
  clearSpotifyTokens();
}

interface SpotifyPlaylistItemsResponse {
  items: Array<{
    added_at?: string;
    item?: SpotifyApi.TrackObjectFull | null;
    track?: SpotifyApi.TrackObjectFull | null;
  }>;
  next: string | null;
}

class SpotifyHttpError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`Spotify API request failed: ${status} ${statusText}`);
  }
}

async function spotifyGet<T>(
  accessToken: string,
  endpoint: string,
  params: Record<string, string | number>
): Promise<T> {
  const url = new URL(endpoint, "https://api.spotify.com");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new SpotifyHttpError(response.status, response.statusText);
  }

  return response.json() as Promise<T>;
}

function waitForAuthorizationCode(
  grant: SpotifyGrant,
  authUrl: string,
  state: string,
  parentWindow?: BrowserWindow
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handleRequest: http.RequestListener = (request, response) => {
      if (!request.url) {
        return;
      }

      const callbackUrl = new URL(request.url, redirectUriFor(grant));
      if (callbackUrl.pathname !== grant.callbackPath) {
        response.writeHead(404);
        response.end();
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      const receivedState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");

      if (error) {
        response.end("Spotify login failed. You can close this window.");
        rejectOnce(new Error(error));
        return;
      }

      if (receivedState !== state || !code) {
        response.end("Spotify login failed. You can close this window.");
        rejectOnce(new Error("Spotify OAuth state mismatch."));
        return;
      }

      response.end("Spotify login complete. You can close this window.");
      resolveOnce(code);
    };
    const server = grant.tls
      ? https.createServer(SPOTIFY_OAUTH_TLS_CREDENTIALS, handleRequest)
      : http.createServer(handleRequest);

    let authWindow: BrowserWindow | undefined;

    const cleanup = () => {
      try {
        server.close();
      } catch {
        // The server may already be closed after an OAuth error path.
      }
      if (authWindow && !authWindow.isDestroyed()) {
        setTimeout(() => authWindow?.close(), 300);
      }
    };

    const resolveOnce = (code: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(code);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    server.on("error", (error) => {
      rejectOnce(error);
    });

    server.listen(grant.port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      if (address.port !== grant.port) {
        rejectOnce(new Error("Spotify OAuth callback port did not bind correctly."));
        return;
      }

      authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        title: grant.windowTitle,
        // Not modal: on macOS a modal child becomes a sheet with no close
        // button, which traps the user on Spotify's error pages.
        parent: parentWindow,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      if (grant.tls) {
        // Trust only the bundled self-signed cert on the loopback callback.
        authWindow.webContents.session.setCertificateVerifyProc(
          (request, callback) => {
            callback(request.hostname === "127.0.0.1" ? 0 : -3);
          }
        );
      }

      // Spotify shows authorize errors (such as an unregistered redirect URI)
      // as a plain page instead of redirecting back, so surface them here.
      let authorizeStatus = 0;
      authWindow.webContents.on("did-navigate", (_event, url, statusCode) => {
        authorizeStatus = url.startsWith(AUTHORIZE_URL) ? statusCode : 0;
      });
      authWindow.webContents.on("did-finish-load", () => {
        if (authorizeStatus < 400 || !authWindow) {
          return;
        }
        void authWindow.webContents
          .executeJavaScript("document.body?.innerText ?? ''")
          .catch(() => "")
          .then((text: string) => {
            const detail = text.trim() || `HTTP ${authorizeStatus}`;
            rejectOnce(
              new Error(
                detail.includes("redirect_uri")
                  ? `Spotify rejected the redirect URI. Add ${redirectUriFor(grant)} under Redirect URIs in your Spotify app, save, then log in again.`
                  : `Spotify sign-in failed: ${detail}`
              )
            );
          });
      });

      authWindow.on("closed", () => {
        authWindow = undefined;
        rejectOnce(expectedError(new Error("Spotify login window was closed.")));
      });
      authWindow.loadURL(authUrl);
    });
  });
}

function clearSpotifyTokens(): void {
  deleteSettings([
    SETTINGS.accessToken,
    SETTINGS.refreshToken,
    SETTINGS.expiresAt,
    SETTINGS.userId,
    SETTINGS.displayName,
    ...Object.values(FOLLOWED_GRANT.keys)
  ]);
}

function sanitizeFileBaseName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "Spotify Track";
}
