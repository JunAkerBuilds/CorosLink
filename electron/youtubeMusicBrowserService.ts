// Embedded YouTube Music sign-in. Rather than asking the user to copy request
// headers out of DevTools (see youtubeMusicService.saveYouTubeMusicAuth), we
// host music.youtube.com in its own Electron session and watch the internal
// "youtubei" API traffic. Every signed-in request carries the account cookie
// (and the x-goog-* headers ytmusicapi wants), so once the user logs in we can
// assemble the header block ytmusicapi's browser auth expects automatically.

import { app, session, type WebContents } from "electron";
import crypto from "node:crypto";

export const YOUTUBE_MUSIC_PARTITION = "persist:coroslink-ytmusic";

// Watch YouTube + Google traffic: the private API lives under
// music.youtube.com/youtubei/… (for credential capture), and the Google
// accounts pages (…google.com) need their client-hint headers cleaned so the
// embedded Chromium doesn't get rejected as an insecure browser during sign-in.
const REQUEST_URL_FILTER = {
  urls: ["https://*.youtube.com/*", "https://*.google.com/*"]
};

type YouTubeMusicHeaderListener = (headerBlock: string) => void;

// Fingerprint of the last captured cookie, so a stream of youtubei requests for
// the same session only triggers one (expensive) ytmusicapi setup. Cleared on
// reset so a fresh sign-in re-captures.
let lastCapturedFingerprint = "";

// Google rejects sign-in from embedded Chromium (the "this browser may not be
// secure" page), detecting it partly via the Sec-CH-UA client hints that only
// Chromium sends. Presenting as Firefox — which has no client hints — is the
// most reliable way to look like a normal, allowed browser.
const FIREFOX_VERSION = "128.0";

function buildBrowserUserAgent(): string {
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10.15"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";

  return `Mozilla/5.0 (${platform}; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`;
}

// Firefox sends no Sec-CH-UA client hints, so strip the ones Chromium adds to
// stay consistent with the Firefox user agent. Mutates the header map in place.
function stripClientHints(requestHeaders: Record<string, string>): void {
  for (const key of Object.keys(requestHeaders)) {
    if (key.toLowerCase().startsWith("sec-ch-ua")) {
      delete requestHeaders[key];
    }
  }
}

function youtubeMusicSession(): Electron.Session {
  return session.fromPartition(YOUTUBE_MUSIC_PARTITION);
}

function isYouTubeMusicWebContents(contents: WebContents): boolean {
  return contents.session === youtubeMusicSession();
}

export function configureYouTubeMusicBrowserSession(): void {
  const musicSession = youtubeMusicSession();
  musicSession.setUserAgent(buildBrowserUserAgent());

  musicSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "fullscreen", "pointerLock"].includes(permission));
  });
}

/**
 * Watches the YouTube Music session's youtubei traffic and, the first time it
 * sees a signed-in request, reports a raw header block ready for ytmusicapi's
 * browser auth. Deduped by cookie so the listener fires the callback once per
 * signed-in session.
 */
export function registerYouTubeMusicBrowserHandlers(
  onHeaders: YouTubeMusicHeaderListener
): void {
  const musicSession = youtubeMusicSession();

  musicSession.webRequest.onBeforeSendHeaders(
    REQUEST_URL_FILTER,
    (details, callback) => {
      const requestHeaders = details.requestHeaders;

      // Drop the Chromium-only Sec-CH-UA client hints so the traffic stays
      // consistent with the Firefox user agent — otherwise Google flags the
      // mismatch and blocks sign-in as an insecure browser.
      stripClientHints(requestHeaders);

      if (details.url.includes("/youtubei/")) {
        const captured = extractHeaders(requestHeaders);
        // The SAPISID cookie only exists once signed in to a Google account, so
        // its presence is our "this request is authenticated" signal.
        if (captured.cookie && /SAPISID/.test(captured.cookie)) {
          const fingerprint = crypto
            .createHash("sha1")
            .update(captured.cookie)
            .digest("hex");
          if (fingerprint !== lastCapturedFingerprint) {
            lastCapturedFingerprint = fingerprint;
            onHeaders(buildHeaderBlock(captured));
          }
        }
      }

      callback({ requestHeaders });
    }
  );

  app.on("web-contents-created", (_event, contents) => {
    if (
      contents.getType() !== "webview" ||
      !isYouTubeMusicWebContents(contents)
    ) {
      return;
    }
    contents.setUserAgent(buildBrowserUserAgent());
  });
}

/** Clears the signed-in YouTube Music session and the capture dedupe state. */
export async function resetYouTubeMusicBrowserSession(): Promise<void> {
  lastCapturedFingerprint = "";
  const musicSession = youtubeMusicSession();
  await musicSession.clearCache();
  await musicSession.clearStorageData();
}

interface CapturedYouTubeMusicHeaders {
  cookie?: string;
  authorization?: string;
  "x-goog-authuser"?: string;
  "x-goog-visitor-id"?: string;
  "x-goog-pageid"?: string;
  "user-agent"?: string;
}

// Chromium keeps original header casing; match case-insensitively and keep only
// the headers ytmusicapi's browser auth cares about.
function extractHeaders(
  requestHeaders: Record<string, string>
): CapturedYouTubeMusicHeaders {
  const captured: CapturedYouTubeMusicHeaders = {};

  for (const [name, value] of Object.entries(requestHeaders)) {
    if (!value) {
      continue;
    }
    const lower = name.toLowerCase();
    if (
      lower === "cookie" ||
      lower === "authorization" ||
      lower === "x-goog-authuser" ||
      lower === "x-goog-visitor-id" ||
      lower === "x-goog-pageid" ||
      lower === "user-agent"
    ) {
      captured[lower as keyof CapturedYouTubeMusicHeaders] = value;
    }
  }

  return captured;
}

// ytmusicapi.setup() parses a raw "name: value" header block. Emit the captured
// headers plus the static ones the web client always sends, so the resulting
// auth file matches what a real browser request looks like.
function buildHeaderBlock(headers: CapturedYouTubeMusicHeaders): string {
  const lines: string[] = [
    "accept: */*",
    "accept-language: en-US,en;q=0.9",
    "content-type: application/json",
    "origin: https://music.youtube.com",
    "x-origin: https://music.youtube.com",
    `user-agent: ${headers["user-agent"] ?? buildBrowserUserAgent()}`,
    `cookie: ${headers.cookie ?? ""}`,
    `x-goog-authuser: ${headers["x-goog-authuser"] ?? "0"}`
  ];

  if (headers.authorization) {
    lines.push(`authorization: ${headers.authorization}`);
  }
  if (headers["x-goog-visitor-id"]) {
    lines.push(`x-goog-visitor-id: ${headers["x-goog-visitor-id"]}`);
  }
  if (headers["x-goog-pageid"]) {
    lines.push(`x-goog-pageid: ${headers["x-goog-pageid"]}`);
  }

  return lines.join("\n");
}
