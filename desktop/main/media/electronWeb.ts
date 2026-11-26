// The music services' sign-in windows and sessions, and YouTube inside the app's window, from Electron (see webHost.ts).
import { randomUUID } from "node:crypto";
import { BrowserWindow, session, WebContentsView } from "electron";
import { BUTTON_CSS, BUTTON_WORLD, buttonsScript, readClick } from "./youtubeButtons";
import type { Browse, Browser, BrowserView, SignIn, WebHost } from "./webHost";
import { t } from "@/lib/i18n";

const PLATFORM = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "X11; Linux x86_64";

/** A plain Chrome user agent: Google and Apple turn away browsers that say they're Electron. */
const chrome = () => `Mozilla/5.0 (${PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

/**
 * Google's sign-in still says "This browser or app may not be secure" to Chromium that claims to be Chrome: its
 * client hints (Sec-CH-UA) name no Google Chrome. Its sign-in pages get Firefox instead, which sends no client hints.
 */
const FIREFOX = "145.0";
const firefox = () => `Mozilla/5.0 (${PLATFORM.replace("10_15_7", "10.15")}; rv:${FIREFOX}) Gecko/20100101 Firefox/${FIREFOX}`;
const GOOGLE_SIGN_IN = "https://accounts.google.com/*";
export const isGoogleSignIn = (url: string) => { try { return new URL(url).hostname === "accounts.google.com"; } catch { return false; } };
export const agentFor = (url: string) => (isGoogleSignIn(url) ? firefox() : chrome());

type Headers = Record<string, string>;
/** What a request to Google's sign-in sends instead: Firefox, and no Chromium client hints. */
export function asFirefox(headers: Headers): Headers {
  const out: Headers = {};
  for (const [k, v] of Object.entries(headers)) if (!/^sec-ch-ua/i.test(k)) out[k] = v;
  for (const k of Object.keys(out)) if (k.toLowerCase() === "user-agent") delete out[k];
  out["User-Agent"] = firefox();
  return out;
}

/** The session's one header hook: Google's sign-in as Firefox, plus whatever a sign-in window is waiting to see. */
function hookHeaders(ses: Electron.Session, watch?: { urls: string[]; seen: (headers: Headers) => boolean; then: () => void }) {
  ses.webRequest.onBeforeSendHeaders({ urls: [GOOGLE_SIGN_IN, ...(watch?.urls ?? [])] }, (details, callback) => {
    const headers = isGoogleSignIn(details.url) ? asFirefox(details.requestHeaders) : details.requestHeaders;
    callback({ requestHeaders: headers });
    if (watch?.seen(details.requestHeaders)) setTimeout(watch.then, 0);
  });
}

const hooked = new WeakSet<Electron.Session>();
const sessionOf = (partition: string) => {
  const s = session.fromPartition(partition);
  if (!hooked.has(s)) {
    hooked.add(s);
    s.setUserAgent(chrome());
    hookHeaders(s);
  }
  return s;
};

/** Keeps the page's own navigator.userAgent matching what its requests say, as it moves on and off Google's sign-in. */
function followAgent(wc: Electron.WebContents) {
  const set = (url: string) => { if (!wc.isDestroyed()) wc.setUserAgent(agentFor(url)); };
  wc.on("did-start-navigation", (details) => { if (details.isMainFrame && !details.isSameDocument) set(details.url); });
  wc.on("will-redirect", (details) => { if (details.isMainFrame) set(details.url); });
}

/**
 * YouTube inside the app's window: a view of its own (own session, sandboxed, no Node, only the addresses `allow`
 * lets through) that this process lays over the slot the page keeps for it. The page says where the slot is through
 * the API; nothing of the page reaches the view, or the other way round.
 */
/** How long YouTube stays open out of sight before it's closed. */
const HIDDEN_FOR = 30_000;

function browse(o: Browse, parent: () => BrowserWindow | null): Browser {
  const host = parent();
  if (!host || host.isDestroyed()) throw new Error(t("The app's window isn't open."));
  const ses = sessionOf(o.partition);
  // No fullscreen: a video going fullscreen would take the whole app's window with it.
  ses.setPermissionRequestHandler((_w, permission, callback) => callback(permission === "media"));
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  const wc = view.webContents;
  view.setVisible(false);
  host.contentView.addChildView(view);
  let closed = false;
  const state = (): BrowserView | null => {
    if (closed || wc.isDestroyed()) return null;
    const h = wc.navigationHistory;
    return { url: wc.getURL(), title: wc.getTitle(), canBack: h.canGoBack(), canForward: h.canGoForward() };
  };
  const report = () => { const v = state(); if (v) o.visited(v); };
  const guard = (event: { preventDefault: () => void }, url: string) => { if (!o.allow(url)) event.preventDefault(); };
  wc.on("will-navigate", (e, url) => guard(e, url));
  wc.on("will-redirect", (e, url) => guard(e, url));
  wc.on("did-navigate", report);
  wc.on("did-navigate-in-page", report);
  wc.on("page-title-updated", report);
  // Links that open a new window open here instead, when they're allowed at all.
  wc.setWindowOpenHandler(({ url }) => {
    if (o.allow(url)) void wc.loadURL(url);
    return { action: "deny" };
  });
  wc.on("will-prevent-unload", (e) => e.preventDefault());
  // A "Download" button on every video, from a script world YouTube's own scripts can't reach. A click logs a
  // message with this secret; nothing else is taken from the page.
  const tag = `__clink_${randomUUID()}:`;
  const inject = () => {
    const known = o.known().filter((id) => /^[\w-]{11}$/.test(id));
    void wc.executeJavaScriptInIsolatedWorld(BUTTON_WORLD, [{ code: `${buttonsScript(tag)}\nwindow.__clinkKnow(${JSON.stringify(known)});` }]).catch(() => {});
  };
  wc.on("dom-ready", () => { void wc.insertCSS(BUTTON_CSS).catch(() => {}); inject(); });
  // Again once loaded: the script runs once per page whichever comes first.
  wc.on("did-finish-load", inject);
  wc.on("console-message", (details) => {
    const click = readClick(details.message, tag);
    if (click && details.frame && !details.frame.parent) o.download(click.id, click.title);
  });
  const close = () => {
    if (closed) return;
    closed = true;
    if (idle) clearTimeout(idle);
    if (!host.isDestroyed()) {
      host.contentView.removeChildView(view);
      host.webContents.off("did-start-navigation", pageLeft);
    }
    if (!wc.isDestroyed()) wc.close();
    o.closed();
  };
  // The app's page reloading or going elsewhere takes its slot away: hide until it says where the slot is again.
  const pageLeft = (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) hide(); };
  host.webContents.on("did-start-navigation", pageLeft);
  host.once("closed", close);
  followAgent(wc);
  void wc.loadURL(o.url, { userAgent: agentFor(o.url) });
  // Out of sight, YouTube stops: its video pauses and it's muted at once, and after a while it's closed altogether
  // (the YouTube tab opens it again where it was).
  let idle: ReturnType<typeof setTimeout> | null = null;
  const hide = () => {
    view.setVisible(false);
    if (wc.isDestroyed()) return;
    wc.setAudioMuted(true);
    void wc.executeJavaScript("document.querySelectorAll('video,audio').forEach((m) => m.pause())").catch(() => {});
    idle ??= setTimeout(close, HIDDEN_FOR);
  };
  return {
    view: state,
    go: (to) => {
      if (closed) return;
      const h = wc.navigationHistory;
      if (to === "back") { if (h.canGoBack()) h.goBack(); } else if (to === "forward") { if (h.canGoForward()) h.goForward(); } else if (to === "reload") wc.reload();
      else if (o.allow(to.url)) void wc.loadURL(to.url);
    },
    place: (rect) => {
      if (closed || host.isDestroyed()) return;
      if (!rect) { hide(); return; }
      if (idle) { clearTimeout(idle); idle = null; }
      wc.setAudioMuted(false);
      // The page measures in its own CSS pixels; the window lays out in points.
      const zoom = host.webContents.getZoomFactor();
      const [w, h] = host.getContentSize();
      const x = Math.max(0, Math.round(rect.x * zoom)), y = Math.max(0, Math.round(rect.y * zoom));
      view.setBounds({ x, y, width: Math.max(0, Math.min(w - x, Math.round(rect.width * zoom))), height: Math.max(0, Math.min(h - y, Math.round(rect.height * zoom))) });
      view.setVisible(true);
    },
    mark: (id, state) => {
      if (closed || wc.isDestroyed() || !/^[\w-]{11}$/.test(id)) return;
      void wc.executeJavaScriptInIsolatedWorld(BUTTON_WORLD, [{ code: `window.__clinkMark && window.__clinkMark(${JSON.stringify(id)}, ${JSON.stringify(state)})` }]).catch(() => {});
    },
    focus: () => { if (!closed) wc.focus(); },
    close,
  };
}

export function electronWeb(parent: () => BrowserWindow | null): WebHost {
  return {
    signIn: (o: SignIn) => new Promise((resolve) => {
      const ses = sessionOf(o.partition);
      const win = new BrowserWindow({
        width: 520, height: 760, title: o.title, parent: parent() ?? undefined,
        webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        if (o.headers) hookHeaders(ses);
        resolve(value);
        if (!win.isDestroyed()) win.close();
      };
      const check = (event: { preventDefault: () => void }, url: string) => {
        if (o.done?.(url)) { event.preventDefault(); finish(url); }
      };
      win.webContents.on("will-redirect", (e, url) => check(e, url));
      win.webContents.on("will-navigate", (e, url) => check(e, url));
      win.webContents.on("did-navigate", (_e, url) => { if (o.done?.(url)) finish(url); });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      if (o.headers) hookHeaders(ses, { ...o.headers, then: () => finish("headers") });
      win.on("closed", () => finish(null));
      followAgent(win.webContents);
      void win.loadURL(o.url, { userAgent: agentFor(o.url) });
    }),
    fetch: (partition, url, init) => sessionOf(partition).fetch(url, init),
    cookies: async (partition, url) => (await sessionOf(partition).cookies.get({ url })).map((c) => ({ name: c.name, value: c.value })),
    browse: (o) => browse(o, parent),
    clear: async (partition) => {
      const s = sessionOf(partition);
      await s.clearStorageData();
      await s.clearCache();
    },
  };
}
