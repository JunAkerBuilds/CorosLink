import { BrowserWindow, type WebContents } from "electron";
import { isWebUrl } from "./externalLinks";

/** The page the main window shows (dist/index.html, or the Vite dev server); set when the window is created. */
let appPage: string | undefined;

/**
 * Whether `url` is CorosLink's own page: the same file (any query or hash) for
 * a file: page, the same origin for the dev server.
 */
export function isAppPageUrl(url: string, page: string | undefined = appPage): boolean {
  if (!page) return false;
  try {
    const candidate = new URL(url);
    const expected = new URL(page);
    if (expected.protocol === "file:") return candidate.protocol === "file:" && candidate.host === expected.host && candidate.pathname === expected.pathname;
    return candidate.origin === expected.origin;
  } catch {
    return false;
  }
}

/**
 * Keeps the main window on CorosLink's page. Its preload hands every page it
 * shows the whole `window.corosLink` API (watch writes, local data, the data
 * mode), so a dropped file or link, or a link without a target, must not
 * replace the app: web links open in the browser instead, anything else is
 * ignored. Redirects away from the app are refused too.
 *
 * The page's webviews (YouTube, YouTube Music, Apple Music) are remote sites:
 * whatever a `<webview>` element asks for, its guest gets no preload and no
 * Node, so a script injected into the app can't create a privileged one.
 */
export function confineMainWindow(contents: WebContents, page: string, openExternal: (url: string) => void): void {
  appPage = page;
  contents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
  });
  contents.on("will-navigate", (event, url) => {
    if (isAppPageUrl(url, page)) return;
    event.preventDefault();
    if (isWebUrl(url)) openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppPageUrl(url, page)) event.preventDefault();
  });
}

/**
 * The one sender check for IPC that changes something (the watch, local data,
 * the data mode): the request must come from the main window's top frame, not
 * from a subframe, a webview or another window, and that frame must be showing
 * CorosLink's own page. Returns that window, for dialogs; otherwise throws `refusal`.
 */
export function requireMainWindowSender(event: Electron.IpcMainInvokeEvent, mainWindow: BrowserWindow | undefined | null, refusal: string): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || !owner || owner !== mainWindow || owner.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(refusal);
  }
  if (appPage && !isAppPageUrl(event.senderFrame?.url ?? "")) throw new Error(refusal);
  return owner;
}
