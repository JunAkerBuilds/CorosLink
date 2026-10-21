import { app, session, type Session } from "electron";
import { isCorosDestination, type NetworkPolicy } from "./networkPolicy";

/**
 * Electron/Chromium side of the network policy. Renderer, webview, OAuth
 * windows and `net.request` traffic never touches Node's HTTP stack, so every
 * session gets a `webRequest` gate that cancels uploads to COROS. Reads from
 * COROS and all other traffic pass through untouched. Chromium runs the gate
 * again for every redirect hop, with the method and body that hop carries, so
 * a redirect can't reach a COROS upload endpoint either.
 *
 * The gate always answers: a request Electron is waiting on hangs until its
 * callback runs, so a failure while deciding still cancels a COROS request
 * (while enforcing) and lets anything else through.
 */

type BeforeRequestListener = (
  details: Electron.OnBeforeRequestListenerDetails,
  callback: (response: Electron.CallbackResponse) => void
) => void;

interface DownstreamListener {
  patterns: RegExp[] | null;
  listener: BeforeRequestListener;
}

const guardedSessions = new WeakSet<Session>();

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Electron keeps one onBeforeRequest listener per session. Ours stays first;
 * any later registration (with or without a URL filter) is chained behind it
 * instead of replacing it.
 */
function installSessionGuard(policy: NetworkPolicy, target: Session): void {
  if (guardedSessions.has(target)) return;
  guardedSessions.add(target);
  const webRequest = target.webRequest;
  const register = webRequest.onBeforeRequest.bind(webRequest) as (listener: BeforeRequestListener) => void;
  let downstream: DownstreamListener | null = null;

  register((details, rawCallback) => {
    let answered = false;
    const callback = (response: Electron.CallbackResponse) => {
      if (answered) return;
      answered = true;
      rawCallback(response);
    };
    let allowed: boolean;
    try {
      const bytes = details.uploadData?.find(part => part.bytes)?.bytes;
      allowed = policy.allowRequest({
        url: details.url, method: details.method, body: bytes ? Buffer.from(bytes).toString("utf8") : undefined
      }, "electron", details.resourceType).allowed;
    } catch {
      allowed = !(policy.enforcing && isCorosDestination(details.url));
    }
    if (!allowed) {
      callback({ cancel: true });
      return;
    }
    try {
      if (downstream && (!downstream.patterns || downstream.patterns.some(pattern => pattern.test(details.url)))) {
        downstream.listener(details, callback);
        return;
      }
    } catch (error) {
      console.warn("[privacy] A chained onBeforeRequest listener failed:", error);
    }
    callback({});
  });

  const chained = (filterOrListener: unknown, maybeListener?: unknown): void => {
    if (typeof filterOrListener === "function") {
      downstream = { patterns: null, listener: filterOrListener as BeforeRequestListener };
    } else if (typeof maybeListener === "function") {
      const urls = (filterOrListener as { urls?: string[] } | null)?.urls ?? [];
      downstream = { patterns: urls.length ? urls.map(patternToRegExp) : null, listener: maybeListener as BeforeRequestListener };
    } else {
      downstream = null;
    }
  };
  try {
    Object.defineProperty(webRequest, "onBeforeRequest", { value: chained, configurable: true, writable: true });
  } catch {
    // Our listener is registered either way; only chaining a later listener would be lost.
    console.warn("[privacy] Could not chain onBeforeRequest; a later listener would replace the network gate.");
  }
}

export function installElectronNetworkGuards(policy: NetworkPolicy): void {
  app.on("session-created", created => installSessionGuard(policy, created));
  void app.whenReady().then(() => installSessionGuard(policy, session.defaultSession));
}
