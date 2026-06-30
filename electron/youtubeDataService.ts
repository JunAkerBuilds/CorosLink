import { shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  deleteSettings,
  getSetting,
  setSetting
} from "./database";
import type {
  YouTubeDataConfig,
  YouTubeDataPlaylist,
  YouTubeDataPlaylistItem,
  YouTubeDataStatus
} from "./types";

const YOUTUBE_DATA_OAUTH_CALLBACK_PORT = 4568;
const REDIRECT_URI = `http://127.0.0.1:${YOUTUBE_DATA_OAUTH_CALLBACK_PORT}`;
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3/";
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

const SETTINGS = {
  clientId: "youtubeData.clientId",
  clientSecret: "youtubeData.clientSecret",
  accessToken: "youtubeData.accessToken",
  refreshToken: "youtubeData.refreshToken",
  expiresAt: "youtubeData.expiresAt",
  channelId: "youtubeData.channelId",
  displayName: "youtubeData.displayName"
};

export function getYouTubeDataConfig(): YouTubeDataConfig {
  return {
    clientId: getSetting(SETTINGS.clientId) ?? "",
    clientSecret: getSetting(SETTINGS.clientSecret) ?? "",
    redirectUri: REDIRECT_URI
  };
}

export function saveYouTubeDataConfig(
  config: YouTubeDataConfig
): YouTubeDataStatus {
  const previous = getYouTubeDataConfig();
  const clientId = config.clientId.trim();
  const clientSecret = config.clientSecret.trim();

  setSetting(SETTINGS.clientId, clientId);
  setSetting(SETTINGS.clientSecret, clientSecret);

  if (
    previous.clientId !== clientId ||
    previous.clientSecret !== clientSecret
  ) {
    clearYouTubeDataTokens();
  }

  return getYouTubeDataStatus();
}

export function getYouTubeDataStatus(): YouTubeDataStatus {
  const config = getYouTubeDataConfig();
  const expiresAt = getSetting(SETTINGS.expiresAt);

  return {
    configured: Boolean(config.clientId),
    authenticated: Boolean(
      getSetting(SETTINGS.refreshToken) || getSetting(SETTINGS.accessToken)
    ),
    redirectUri: REDIRECT_URI,
    displayName: getSetting(SETTINGS.displayName),
    channelId: getSetting(SETTINGS.channelId),
    tokenExpiresAt: expiresAt
      ? new Date(Number(expiresAt)).toISOString()
      : undefined
  };
}

export function logoutYouTubeData(): YouTubeDataStatus {
  clearYouTubeDataTokens();
  return getYouTubeDataStatus();
}

export async function loginYouTubeData(): Promise<YouTubeDataStatus> {
  const config = getYouTubeDataConfig();
  if (!config.clientId) {
    throw new Error("Add your Google OAuth Client ID first.");
  }

  const state = crypto.randomBytes(18).toString("hex");
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const authUrl = createAuthorizationUrl(config, state, codeChallenge);
  const code = await waitForAuthorizationCode(authUrl, state);
  const token = await requestToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    codeVerifier,
    redirectUri: REDIRECT_URI
  });

  setSetting(SETTINGS.accessToken, token.access_token);
  if (token.refresh_token) {
    setSetting(SETTINGS.refreshToken, token.refresh_token);
  }
  setSetting(SETTINGS.expiresAt, String(Date.now() + token.expires_in * 1000));

  await refreshYouTubeDataProfile();

  return getYouTubeDataStatus();
}

export async function listYouTubeDataPlaylists(): Promise<
  YouTubeDataPlaylist[]
> {
  const playlists: YouTubeDataPlaylist[] = [];
  let pageToken: string | undefined;

  do {
    const response = await youtubeGet<YouTubePlaylistListResponse>(
      "playlists",
      {
        part: "snippet,contentDetails",
        mine: "true",
        maxResults: 50,
        ...(pageToken ? { pageToken } : {})
      }
    );

    for (const playlist of response.items) {
      playlists.push({
        id: playlist.id,
        title: playlist.snippet.title,
        description: playlist.snippet.description || undefined,
        channelId: playlist.snippet.channelId,
        channelTitle: playlist.snippet.channelTitle,
        publishedAt: playlist.snippet.publishedAt,
        thumbnailUrl: bestThumbnailUrl(playlist.snippet.thumbnails),
        totalItems: playlist.contentDetails.itemCount ?? 0
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return playlists.sort((left, right) =>
    left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
  );
}

export async function listYouTubeDataPlaylistItems(
  playlistId: string
): Promise<YouTubeDataPlaylistItem[]> {
  const items: YouTubeDataPlaylistItem[] = [];
  let pageToken: string | undefined;

  do {
    const response = await youtubeGet<YouTubePlaylistItemsListResponse>(
      "playlistItems",
      {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: 50,
        ...(pageToken ? { pageToken } : {})
      }
    );

    for (const item of response.items) {
      const videoId =
        item.contentDetails.videoId ?? item.snippet.resourceId?.videoId;
      if (!videoId) {
        continue;
      }

      items.push({
        id: item.id,
        playlistId,
        videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.videoOwnerChannelTitle,
        publishedAt: item.snippet.publishedAt,
        thumbnailUrl: bestThumbnailUrl(item.snippet.thumbnails),
        videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(
          videoId
        )}`
      });
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return items;
}

async function refreshYouTubeDataProfile(): Promise<void> {
  const response = await youtubeGet<YouTubeChannelsListResponse>("channels", {
    part: "snippet",
    mine: "true",
    maxResults: 1
  });
  const channel = response.items[0];
  if (!channel) {
    return;
  }

  setSetting(SETTINGS.channelId, channel.id);
  setSetting(SETTINGS.displayName, channel.snippet.title || channel.id);
}

async function getAuthorizedAccessToken(): Promise<string> {
  const config = getYouTubeDataConfig();
  const accessToken = getSetting(SETTINGS.accessToken);
  const refreshToken = getSetting(SETTINGS.refreshToken);
  const expiresAt = Number(getSetting(SETTINGS.expiresAt) ?? 0);

  if (!config.clientId) {
    throw new Error("Add your Google OAuth Client ID first.");
  }

  if (accessToken && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error("Log in to YouTube Playlists first.");
  }

  const refreshed = await refreshAccessToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken
  });

  setSetting(SETTINGS.accessToken, refreshed.access_token);
  setSetting(
    SETTINGS.expiresAt,
    String(Date.now() + refreshed.expires_in * 1000)
  );

  return refreshed.access_token;
}

async function youtubeGet<T>(
  endpoint: string,
  params: Record<string, string | number | boolean>
): Promise<T> {
  const accessToken = await getAuthorizedAccessToken();
  const url = new URL(endpoint, YOUTUBE_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await formatGoogleApiError(response));
  }

  return response.json() as Promise<T>;
}

function createAuthorizationUrl(
  config: YouTubeDataConfig,
  state: string,
  codeChallenge: string
): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function waitForAuthorizationCode(
  authUrl: string,
  state: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((request, response) => {
      if (!request.url) {
        response.writeHead(400);
        response.end("YouTube Playlists login failed. You can close this tab.");
        rejectOnce(new Error("Google OAuth callback URL was empty."));
        return;
      }

      const callbackUrl = new URL(request.url, REDIRECT_URI);
      if (callbackUrl.pathname !== "/") {
        response.writeHead(404);
        response.end();
        return;
      }

      const error = callbackUrl.searchParams.get("error");
      const receivedState = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");

      if (error) {
        response.end("YouTube Playlists login failed. You can close this tab.");
        rejectOnce(new Error(error));
        return;
      }

      if (receivedState !== state || !code) {
        response.end("YouTube Playlists login failed. You can close this tab.");
        rejectOnce(new Error("Google OAuth state mismatch."));
        return;
      }

      response.end("YouTube Playlists login complete. You can close this tab.");
      resolveOnce(code);
    });

    const timeout = setTimeout(() => {
      rejectOnce(new Error("Google OAuth login timed out."));
    }, 5 * 60 * 1000);

    const cleanup = () => {
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // The server may already be closed after an OAuth error path.
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

    server.listen(YOUTUBE_DATA_OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      if (address.port !== YOUTUBE_DATA_OAUTH_CALLBACK_PORT) {
        rejectOnce(
          new Error("Google OAuth callback port did not bind correctly.")
        );
        return;
      }

      void shell.openExternal(authUrl).catch((error) => {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
      });
    });
  });
}

async function requestToken({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri
}: {
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  return postTokenRequest(body);
}

async function refreshAccessToken({
  clientId,
  clientSecret,
  refreshToken
}: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  return postTokenRequest(body);
}

async function postTokenRequest(
  body: URLSearchParams
): Promise<GoogleTokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Google OAuth request failed: ${response.status} ${response.statusText}`
    );
  }

  if (!payload.access_token || !payload.expires_in) {
    throw new Error("Google OAuth response did not include an access token.");
  }

  return payload;
}

async function formatGoogleApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as GoogleApiErrorResponse;
    return (
      payload.error?.message ||
      `YouTube Data API request failed: ${response.status} ${response.statusText}`
    );
  } catch {
    return `YouTube Data API request failed: ${response.status} ${response.statusText}`;
  }
}

function createCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

function createCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
}

function base64UrlEncode(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bestThumbnailUrl(thumbnails?: YouTubeThumbnailMap): string | undefined {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url
  );
}

function clearYouTubeDataTokens(): void {
  deleteSettings([
    SETTINGS.accessToken,
    SETTINGS.refreshToken,
    SETTINGS.expiresAt,
    SETTINGS.channelId,
    SETTINGS.displayName
  ]);
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleApiErrorResponse {
  error?: {
    message?: string;
  };
}

interface YouTubeListResponse<T> {
  items: T[];
  nextPageToken?: string;
}

interface YouTubeThumbnailMap {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
  standard?: { url?: string };
  maxres?: { url?: string };
}

interface YouTubePlaylistListResponse
  extends YouTubeListResponse<{
    id: string;
    snippet: {
      title: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: YouTubeThumbnailMap;
    };
    contentDetails: {
      itemCount?: number;
    };
  }> {}

interface YouTubePlaylistItemsListResponse
  extends YouTubeListResponse<{
    id: string;
    snippet: {
      title: string;
      publishedAt?: string;
      videoOwnerChannelTitle?: string;
      thumbnails?: YouTubeThumbnailMap;
      resourceId?: {
        videoId?: string;
      };
    };
    contentDetails: {
      videoId?: string;
    };
  }> {}

interface YouTubeChannelsListResponse
  extends YouTubeListResponse<{
    id: string;
    snippet: {
      title?: string;
    };
  }> {}
