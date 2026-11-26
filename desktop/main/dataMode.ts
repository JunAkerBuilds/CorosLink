// Local-Only Mode: nothing is uploaded to COROS. The web code's server side (Training Hub, activity uploads) runs in
// this process and calls the global fetch, so a guard around it stops every write to COROS's servers and its upload
// bucket, while reads and signing in still work. Each stopped request is noted (method, host and path only).
import { t } from "@/lib/i18n";

export type DataMode = "connected" | "localOnly";
export interface Blocked { at: number; method: string; target: string }

// Reads COROS takes as POSTs: Training Hub sign-in and queries; for Studio, the mobile app's sign-in and its
// watch-face lists (corosAccount.ts). A face is only ever sent to COROS by a later phase, through a path not here.
// Map areas' package check (mapstatic.coros.com) is a POST that only asks which map files cover some squares.
// An activity's file (/activity/detail/download) is a POST that only names where to fetch it (the account import).
const READ_PATH = /^\/account\/|\/query$|\/calculate$|^\/activity\/detail\/download$|^\/coros\/user\/login$|^\/coros\/watchface\/getWatchFaceThemeList$|^\/openapi\/tileMap\/getMapPackage$/;

/** Whether a request would upload to COROS: any write to its servers, the upload bucket, or the start of an upload. */
export function uploadsToCoros(url: URL, method: string): boolean {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD" || m === "OPTIONS";
  if (url.hostname === "coros.com" || url.hostname.endsWith(".coros.com")) {
    if (url.pathname.includes("/oss/sts")) return true;
    return !read && !READ_PATH.test(url.pathname);
  }
  // Uploads go to COROS's bucket on S3; nothing else in the app writes there.
  if (url.hostname.endsWith(".amazonaws.com")) return !read;
  return false;
}

/** COROS's answer shape for a refusal, so the screens say why in their usual way. */
const refusal = () => Response.json(
  { result: "LOCAL", apiCode: "LOCAL", message: t("Local-Only Mode is on: nothing is uploaded to COROS. Turn it off in Settings → Privacy & local data.") },
  { status: 200, headers: { "x-clink-blocked": "1" } },
);

/** Puts the guard around the global fetch. `localOnly` is asked on every request, so switching needs no restart. */
export function guardFetch(localOnly: () => boolean, onBlocked: (b: Blocked) => void): void {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (localOnly()) {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input));
      const method = init?.method ?? request?.method ?? "GET";
      if (uploadsToCoros(url, method)) {
        onBlocked({ at: Date.now(), method: method.toUpperCase(), target: url.host + url.pathname });
        return url.hostname.endsWith(".amazonaws.com") ? new Response("Local-Only Mode", { status: 403 }) : refusal();
      }
    }
    return inner(input, init);
  }) as typeof fetch;
}

/** The part of an Electron session the guard needs (kept structural so this file loads in tests without Electron). */
interface WebRequests {
  webRequest: {
    onBeforeRequest(filter: { urls: string[] }, listener: (details: { url: string; method: string }, callback: (answer: { cancel: boolean }) => void) => void): void;
  };
}

/**
 * The same rule for requests the window and its sessions make themselves (Chromium's network, not Node's fetch). The
 * page's CSP already keeps it off COROS; this holds even if a later screen, sign-in window or `net.fetch` reaches it.
 */
export function guardSession(session: WebRequests, localOnly: () => boolean, onBlocked: (b: Blocked) => void): void {
  const urls = ["*://*.coros.com/*", "*://coros.com/*", "*://*.amazonaws.com/*"];
  session.webRequest.onBeforeRequest({ urls }, (details, callback) => {
    const url = new URL(details.url);
    const cancel = localOnly() && uploadsToCoros(url, details.method);
    if (cancel) onBlocked({ at: Date.now(), method: details.method.toUpperCase(), target: url.host + url.pathname });
    callback({ cancel });
  });
}

/**
 * The saved mode, failing closed: a settings file that exists but can't be read or doesn't name a mode starts the
 * app in Local-Only Mode, so a damaged file never turns uploads back on. No file at all is a first start: Connected.
 */
export function savedMode(raw: string | null): { dataMode: DataMode; damaged: boolean } {
  if (raw === null) return { dataMode: "connected", damaged: false };
  try {
    const mode = (JSON.parse(raw) as { dataMode?: unknown } | null)?.dataMode;
    if (mode === "connected" || mode === "localOnly") return { dataMode: mode, damaged: false };
  } catch { /* damaged */ }
  return { dataMode: "localOnly", damaged: true };
}
