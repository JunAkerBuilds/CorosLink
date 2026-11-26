// The main process: one window showing the app from the private `clink://app` origin. The same origin answers
// the web app's /api routes here, so the screens and their server code run unchanged.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme, net, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron";
import { readAccount, setLocalAccountServer, signInLocally } from "@/server/local/http";
import { hostAI } from "@/server/ai/host";
import { ChatGPTAccount } from "./ai/chatgpt";
import { AntigravityAccount } from "./ai/antigravity";
import { ClaudeCodeAccount } from "./ai/claudeCode";
import { GeminiCliAccount } from "./ai/geminiCli";
import { OpenCodeAccount } from "./ai/opencode";
import { McpHub } from "./ai/mcp";
import { checkInput, McpStore } from "./ai/mcpStore";
import { AIService } from "./ai/service";
import { AIVault, type SecretId } from "./ai/vault";
import { provider as aiProvider } from "./ai/catalog";
import { answerApi } from "./api";
import { CookieJar } from "./cookieJar";
import { DevMode } from "./devMode";
import { ErrorLog } from "./errorLog";
import { LocalStore } from "./localStore";
import { electronWeb } from "./media/electronWeb";
import { MediaService } from "./media/service";
import { WatchfaceStudio } from "./watchface/studio";
import { StudioAutomation } from "./watchface/automation";
import { Watchmaker } from "./watchface/watchmaker";
import { openAIImageMaker } from "./watchface/watchmaker/imageMaker";
import { CorosAccount } from "./watchface/corosAccount";
import { PhoneSync } from "./phones/phoneSync";
import { runInRequest } from "./requestScope";
import { cookieSecret, keychain, keychainName, keychainSecure, setKeychainFallback } from "./secrets";
import { askedNamesFile, corosLinkKeychain } from "./coroslink/oldKeychain";
import { guardSession } from "./dataMode";
import { Updates, type Updater } from "./updates";
import { DesktopSettings } from "./settings";
import { FirstRun } from "./setup";
import { WatchEngine } from "./watch/engine/engine";
import { spawnBle } from "./watch/engine/transport";
import { MapsService } from "./maps/service";
import { LocalWatch } from "./watch/service";
import { ActivityScreens } from "./watch/activityScreens";
import { runSmoke } from "./smoke";
import { CorosLinkMove } from "./coroslink/move";
import { ActivityRules } from "./activities/duplicates";
import { smokeWatchmakerModel } from "./smokeStudioWatchmaker";
import { simulatedPacePro } from "./smokeActivityScreens";

const ORIGIN = "clink://app";
const DEV_SERVER = process.env.CLINK_DEV_SERVER; // set by `npm run dev`: the Vite server for the screens
const RENDERER = path.join(__dirname, "..", "renderer");

protocol.registerSchemesAsPrivileged([
  { scheme: "clink", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Before anything reads it: the web app's server code takes its settings from process.env.
process.env.NODE_ENV = app.isPackaged ? "production" : "development";
// A separate data folder (tests, a second profile) when asked for. A development build otherwise keeps its own,
// "C-LINK Dev": it seals with a different keychain item than the shipped app, so sharing the shipped app's folder
// would leave values there that the shipped app has to ask the system for.
if (process.env.CLINK_USER_DATA) app.setPath("userData", process.env.CLINK_USER_DATA);
else if (!app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "C-LINK Dev"));
// Shipped Mac builds seal with CorosLink's keychain item (secrets.ts keychainName): its name is fixed now, before
// ready. The data folder is pinned first so it stays C-LINK's; the name shown goes back to C-LINK once ready.
const KEYCHAIN = keychainName(app.isPackaged, process.platform);
const SHOWN_NAME = app.getName();
if (KEYCHAIN) {
  app.setPath("userData", app.getPath("userData"));
  app.setName(KEYCHAIN);
}
if (process.platform === "darwin") {
  // What was sealed under the other name (a development build's "C-LINK", or CorosLink's when this is one) opens once.
  // The system is asked for that name on one launch only: what it doesn't open then is treated as gone.
  setKeychainFallback(corosLinkKeychain({
    platform: "darwin", folder: "", names: [KEYCHAIN ? "C-LINK" : "CorosLink"],
    asked: askedNamesFile(path.join(app.getPath("userData"), "keychain-asked.json")),
  }));
}

if (!app.requestSingleInstanceLock()) app.quit();

let window: BrowserWindow | null = null;

// Error logs (Settings → Error logs): what the main process and the screens report as errors, kept on this computer.
const errors = new ErrorLog(app.getPath("userData"));
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleError(...args);
  errors.add("app", args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
};
process.on("uncaughtExceptionMonitor", (error) => errors.add("app", error.stack ?? String(error)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

// Scripts and styles only from the app itself; data from the app, Mapbox and the weather service.
const CSP = [
  "default-src 'self'",
  "script-src 'self'" + (DEV_SERVER ? " 'unsafe-inline' http://localhost:5174" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.mapbox.com https://tile.waymarkedtrails.org https://*.tile.opentopomap.org https://tiles.openfreemap.org https://server.arcgisonline.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://api.open-meteo.com https://archive-api.open-meteo.com https://tile.waymarkedtrails.org https://*.tile.opentopomap.org https://tiles.openfreemap.org https://server.arcgisonline.com" + (DEV_SERVER ? " ws://localhost:5174 http://localhost:5174" : ""),
].join("; ");

/** A file of the built screens, or index.html for any path that isn't a file (the router takes it from there). */
function serveFile(pathname: string): Response {
  const resolved = path.normalize(path.join(RENDERER, decodeURIComponent(pathname)));
  const inside = resolved.startsWith(RENDERER + path.sep);
  const file = inside && existsSync(resolved) && path.extname(resolved) ? resolved : path.join(RENDERER, "index.html");
  const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
  const headers: Record<string, string> = { "Content-Type": type };
  if (type.startsWith("text/html")) headers["Content-Security-Policy"] = CSP;
  else headers["Cache-Control"] = "public, max-age=31536000, immutable";
  return new Response(readFileSync(file), { headers });
}

/** In development the screens come from the Vite server (with hot reload); index.html gets the CSP like the build. */
async function serveFromDevServer(request: Request, pathname: string): Promise<Response> {
  const url = new URL(request.url);
  // A page of the app (/settings, /calendar…) is always index.html: asked for by path, Vite would answer with a
  // source file of the same name instead (/settings → Settings.tsx, the file system being case-insensitive).
  const isNavigation = request.headers.get("sec-fetch-dest") === "document" || (!path.extname(pathname) && (request.headers.get("accept") ?? "").includes("text/html"));
  const asked = await net.fetch(isNavigation ? `${DEV_SERVER}/` : `${DEV_SERVER}${pathname}${url.search}`, { headers: { Accept: request.headers.get("accept") ?? "*/*" } });
  const isPage = (asked.headers.get("content-type") ?? "").startsWith("text/html");
  if (!isPage) return asked;
  const headers = new Headers(asked.headers);
  headers.set("Content-Security-Policy", CSP);
  return new Response(asked.body, { status: asked.status, headers });
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#151515" : "#f8f9f8",
    // On a Mac the content runs up to the top edge, with the window buttons inside the sidebar (desktop.css makes
    // the top strip draggable).
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 26, y: 26 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.webContents.on("console-message", (event) => { if (event.level === "error") errors.add("screen", event.message); });
  window.webContents.on("render-process-gone", (_event, details) => errors.add("screen", `The window stopped: ${details.reason}`));
  if (process.env.CLINK_SMOKE && !app.isPackaged) {
    void runSmoke(window, ORIGIN, process.env.CLINK_SMOKE);
    return;
  }

  // Links to other sites open in the browser; the window never leaves the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(ORIGIN + "/")) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  void window.loadURL(`${ORIGIN}/`);
}

/**
 * The menu bar: the usual Mac menus, a Developer Mode switch in the app menu, and with it on, a Developer menu
 * (sample data, its reset, reload and the developer tools).
 */
function buildMenu(dev: DevMode, change: (c: { devMode?: boolean; sample?: boolean; resetSample?: boolean }, reload: boolean) => Promise<void>): void {
  const state = dev.state;
  const isMac = process.platform === "darwin";
  // ⌘, opens Settings, or Coach settings from inside Coach.
  const inCoach = () => { try { return new URL(window?.webContents.getURL() ?? "").pathname.startsWith("/coach"); } catch { return false; } };
  const settingsItem: MenuItemConstructorOptions = { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => void window?.loadURL(`${ORIGIN}${inCoach() ? "/coach/settings" : "/settings"}`) };
  const aiItem: MenuItemConstructorOptions = { label: "Coach Settings…", click: () => void window?.loadURL(`${ORIGIN}/coach/settings`) };
  const updatesItem: MenuItemConstructorOptions = { label: "Check for Updates…", click: () => void window?.loadURL(`${ORIGIN}/settings/about?check=1`) };
  const devSwitch: MenuItemConstructorOptions = { label: "Developer Mode", type: "checkbox", checked: state.devMode, click: (item) => void change({ devMode: item.checked }, true) };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const, submenu: [
      { role: "about" as const }, updatesItem, { type: "separator" as const }, settingsItem, aiItem, devSwitch, { type: "separator" as const },
      { role: "services" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const },
      { type: "separator" as const }, { role: "quit" as const },
    ] }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [
      ...(state.devMode ? [{ role: "reload" as const }, { role: "forceReload" as const }, { role: "toggleDevTools" as const }, { type: "separator" as const }] : []),
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    ...(state.devMode ? [{ label: "Developer", submenu: [
      { label: "Sample Data", type: "checkbox" as const, checked: state.sample, accelerator: "CmdOrCtrl+Shift+S", click: (item: Electron.MenuItem) => void change({ sample: item.checked }, true) },
      { label: "Reset Sample Data", enabled: state.sample, click: () => void change({ resetSample: true }, true) },
      { type: "separator" as const },
      { label: "Developer Page", click: () => void window?.loadURL(`${ORIGIN}/developer`) },
      { label: "Run Setup Again", click: () => void window?.loadURL(`${ORIGIN}/setup`) },
      { label: "Open Data Folder", click: () => void shell.openPath(app.getPath("userData")) },
      ...(isMac ? [] : [{ type: "separator" as const }, devSwitch]),
    ] }] : isMac ? [] : [{ label: "Help", submenu: [updatesItem, settingsItem, aiItem, devSwitch] }]),
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("second-instance", () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

void app.whenReady().then(async () => {
  // The keychain's name is fixed by now; menus and dialogs say C-LINK.
  if (KEYCHAIN) app.setName(SHOWN_NAME);
  const data = app.getPath("userData");
  process.env.CLINK_COOKIE_SECRET ??= await cookieSecret(path.join(data, "secret.bin"));
  const jar = await CookieJar.open(path.join(data, "cookies.bin"), keychain);

  // Everything stays on this computer: the app's own store answers the sync API, and the app is always signed in
  // to it. There is no C-LINK account and no C-LINK cloud.
  const store = new LocalStore(path.join(data, "clink.db"));
  // One workout, one activity: a run read from the watch and the same run from the phone become one (activities/
  // duplicates.ts), on every write and once over everything here at launch.
  const activityRules = new ActivityRules(store, { fitFolder: path.join(data, "watch", "fit"), ledger: path.join(data, "activity-merges.json"), log: (line) => errors.add("app", line) });
  store.attachRules(activityRules);
  {
    const { merged, details } = activityRules.cleanup();
    if (merged || details) errors.add("app", `Workouts: ${merged} duplicate${merged === 1 ? "" : "s"} merged, ${details} detail${details === 1 ? "" : "s"} made from FIT files`);
  }
  // Developer mode, and with it sample data in a store of its own (devMode.ts). `npm run dev:sample` starts in it.
  const dev = new DevMode(data, store, { devMode: !app.isPackaged, sample: false });
  if (process.env.CLINK_SAMPLE) dev.set({ devMode: true, sample: true });
  // Signed in to whichever store the app reads now (the real one, or the sample athlete's).
  const ensureSignedIn = () => runInRequest({ jar, path: "/", headers: new Headers() }, async () => {
    const { store: current, viewer } = dev.current;
    setLocalAccountServer(current);
    if ((await readAccount())?.viewer.id !== viewer.id) await signInLocally(current.token, viewer);
  });
  await ensureSignedIn();

  /** A developer setting changed (from the menu or the page): the app reads the right store, and the window starts over. */
  const changeDev = async (change: Parameters<DevMode["set"]>[0] & { resetSample?: boolean }, reload: boolean) => {
    const { resetSample, ...settings } = change;
    dev.set(settings);
    if (resetSample) dev.resetSample();
    await ensureSignedIn();
    buildMenu(dev, changeDev);
    if (reload) window?.webContents.reload();
  };
  buildMenu(dev, changeDev);

  // Who answers Coach, the notes, meal estimates and titles: the athlete's pick on the AI page (ai/service.ts).
  const vault = new AIVault(data, keychain);
  const ai = new AIService(vault, {
    chatgpt: new ChatGPTAccount({
      load: () => vault.secret("chatgpt"),
      save: (value) => vault.setSecret("chatgpt", value),
      // Its own window and an in-memory session each time, so the account picker always shows.
      openSignIn: (url, state, onClosed) => {
        const signIn = new BrowserWindow({ width: 520, height: 720, title: "Sign in with ChatGPT", parent: window ?? undefined, webPreferences: { partition: `chatgpt-signin-${state}`, sandbox: true } });
        signIn.on("closed", onClosed);
        void signIn.loadURL(url);
        return () => { signIn.removeListener("closed", onClosed); if (!signIn.isDestroyed()) signIn.close(); };
      },
    }),
    "claude-code": new ClaudeCodeAccount(data),
    "gemini-cli": new GeminiCliAccount(data),
    opencode: new OpenCodeAccount(data),
    antigravity: new AntigravityAccount(data, { openExternal: (url) => void shell.openExternal(url) }),
  });
  // The athlete's own MCP servers: their tools, once turned on, go to Coach next to its own (ai/mcp.ts).
  const mcpStore = new McpStore(data, vault);
  const mcp = new McpHub(mcpStore, { openExternal: (url) => void shell.openExternal(url), log: (line) => errors.add("app", line) });
  ai.extraTools = () => mcp.coachTools();
  app.on("before-quit", () => { void mcp.closeAll(); });
  app.on("will-quit", () => mcp.stopNow());
  hostAI.current = ai;

  // Phones sync straight to this store on the local network (pairing by QR code, on the Connections page).
  const phones = new PhoneSync(path.join(data, "phones.db"), store, app.getVersion());
  void phones.startIfPaired();
  app.on("before-quit", () => { void phones.stop(); });

  // First-run setup (setup.ts): shown at launch until done; an install that already has data isn't asked.
  const firstRun = new FirstRun(data, {
    store: () => dev.current.store,
    realStore: () => store,
    // Running from source, the login item would be Electron itself: only a built app is put there.
    loginItem: app.isPackaged && process.platform !== "linux"
      ? { get: () => app.getLoginItemSettings().openAtLogin, set: (on) => app.setLoginItemSettings({ openAtLogin: on }) }
      : null,
    existingInstall: store.size > 0 || phones.sessions.list().length > 0,
    showOnLaunch: !process.env.CLINK_SMOKE,
    log: (line) => errors.add("app", line),
  });
  firstRun.startBackups();
  app.on("before-quit", () => firstRun.stop());

  // The Settings page's own state: data mode, backups, storage, logs (settings.ts).
  const settings = new DesktopSettings(data, errors, {
    version: app.getVersion(),
    store: () => store,
    saveDialog: async (name) => {
      const options = { defaultPath: path.join(app.getPath("documents"), name), filters: [{ name: "C-LINK backup", extensions: ["clinkbackup"] }] };
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      return picked.canceled ? null : picked.filePath ?? null;
    },
    openDialog: async () => {
      const options = { properties: ["openFile" as const], filters: [{ name: "C-LINK backup", extensions: ["clinkbackup"] }] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : picked.filePaths[0] ?? null;
    },
    reveal: (target) => shell.showItemInFolder(target),
    restored: () => { void ensureSignedIn().then(() => window?.webContents.reload()); },
    confirm: async (message, detail, button) => {
      const options = { type: "question" as const, message, detail, buttons: [button, "Cancel"], defaultId: 1, cancelId: 1 };
      return (window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)).response === 0;
    },
    lastPhoneSync: () => phones.sessions.list().map((p) => p.lastUsedAt).sort().at(-1) ?? null,
    modeChanged: (mode) => { if (mode === "connected") watch.leftLocalMode(); else watch.enteredLocalMode(); },
  }, { replayIntro: !app.isPackaged && !!process.env.CLINK_INTRO, skipIntro: !app.isPackaged && !!process.env.CLINK_SMOKE });
  // Local mode's watch over Bluetooth (watch/service.ts): the TypeScript watch engine over clink-ble (watch/engine,
  // docs/watch-engine.md), every platform.
  const bleBinary = app.isPackaged ? path.join(process.resourcesPath, process.platform === "win32" ? "clink-ble.exe" : "clink-ble")
    : path.join(app.getAppPath(), "native/ble/target/release", process.platform === "win32" ? "clink-ble.exe" : "clink-ble");
  const watch = new LocalWatch(data, {
    store: () => store,
    sealer: keychain,
    localMode: () => settings.guard.localOnly(),
    engine: existsSync(bleBinary) ? (onEvent, onLog) => new WatchEngine(spawnBle(bleBinary), onEvent, onLog) : null,
    log: (line) => errors.add("app", line),
  });
  app.on("before-quit", () => watch.stop());
  // C-LINK's own updates from the CorosLink release feed (updates.ts); packaged builds only.
  const updater = app.isPackaged ? ((await import("electron-updater")).autoUpdater as unknown as Updater) : null;
  const updates = new Updates(data, app.getVersion(), updater, (line) => errors.add("app", line));
  updates.start();
  // Developer → Activity screens: a PACE Pro activity's data pages over the same watch link (watch/activityScreens.ts).
  const activityScreens = new ActivityScreens({
    // Development builds in developer mode only, as in CorosLink (refused in packaged builds).
    enabled: () => !app.isPackaged && dev.state.devMode, link: () => watch.activityLink(), exchange: (op, payload) => watch.activityExchange(op, payload),
    folder: path.join(data, "activity-screens"),
    // Its smoke uses a simulated PACE Pro, never a real watch.
    ...(process.env.CLINK_SMOKE_ACTIVITY_SCREENS && !app.isPackaged ? simulatedPacePro() : {}),
  });
  // Media: the music library on this computer and the watch as a USB drive (media/service.ts).
  const media = new MediaService(data, undefined, (line) => errors.add("app", line), {
    web: electronWeb(() => window), sealer: keychain, appPath: app.getAppPath(), reveal: (file) => shell.showItemInFolder(file),
    chooseFiles: async (extensions) => {
      const options = { title: "Choose an audiobook", buttonLabel: "Choose", properties: ["openFile" as const, "multiSelections" as const], filters: [{ name: "Audiobooks", extensions: [...extensions] }] };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : picked.filePaths;
    },
  });
  // Maps: Route Studio, Map areas and COROS Maps (maps/service.ts), with the Bluetooth watch and the USB drive.
  const maps = new MapsService({ data, sealer: keychain, watch: () => watch, drive: media.drive, log: (line) => errors.add("app", line) });
  // Studio: watch faces on COROS's templates, kept on this computer and built into BINs (watchface/studio.ts).
  // Its COROS account (official faces, saved faces) keeps its session sealed with the keychain (watchface/corosAccount.ts).
  const studio = new WatchfaceStudio(data, {
    watch,
    account: new CorosAccount(path.join(data, "studio"), { sealer: keychain, secure: keychainSecure }),
    pickFolder: async () => {
      const options = { properties: ["openDirectory" as const, "createDirectory" as const], buttonLabel: "Save here" };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : picked.filePaths[0] ?? null;
    },
  });
  void studio.community.cleanup();
  // Bringing CorosLink's data over (coroslink/move.ts), offered by the first-run intro. CorosLink's folder is only read.
  // CLINK_COROSLINK_DIR (development) points it at a copy of CorosLink's folder instead of finding one.
  const move = new CorosLinkMove({
    data,
    appData: app.getPath("appData"),
    appFolders: process.platform === "darwin" ? ["/Applications", path.join(app.getPath("home"), "Applications")] : [],
    only: app.isPackaged ? null : process.env.CLINK_COROSLINK_DIR ?? null,
    store: () => store,
    saveRoute: (route) => maps.routes.save(route),
    ai: {
      current: () => vault.current,
      // Only C-LINK's own providers and their ids (ai/catalog.ts).
      choose: ({ picked, models = {}, efforts = {}, localUrl }) => {
        const known = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([id]) => aiProvider(id)));
        vault.choose({ ...(picked && aiProvider(picked) ? { picked: aiProvider(picked)!.id } : {}), models: known(models), efforts: known(efforts), ...(localUrl ? { localUrl } : {}) });
      },
      hasSecret: (id) => vault.hasSecret(id as SecretId),
      setSecret: (id, value) => vault.setSecret(id as SecretId, value),
    },
    // Shipped Mac builds open CorosLink's values with their own safeStorage (same item, no prompt) and never ask for
    // the development "coroslink" item; development builds ask the system for both names.
    keychain: (folder) => corosLinkKeychain({
      platform: process.platform, folder,
      ...(KEYCHAIN ? { own: async (d: Buffer) => (await safeStorage.decryptStringAsync(d)).result, names: [] } : app.isPackaged ? { names: ["CorosLink"] } : {}),
    }),
    watch,
    localMode: { on: () => settings.guard.localOnly(), enter: () => settings.enterLocalMode() },
    studioAccount: studio.account,
    adoptOrsKey: (key) => maps.routes.adoptOrsKey(key),
    mcp: {
      urls: () => mcpStore.list().flatMap((s) => (s.url ? [s.url] : [])),
      add: async (input) => (await mcpStore.add(checkInput(input))).id,
      setOAuth: (id, oauth) => mcpStore.setOAuth(id, oauth as Parameters<McpStore["setOAuth"]>[1]),
    },
    media: {
      // Library.add moves the file in, so it gets a copy; CorosLink's own file stays.
      addTrack: async (file, name, origin) => {
        if (media.library.byOrigin(origin)) return false;
        const temp = path.join(data, "media", "incoming", `coroslink-${randomUUID()}.mp3`);
        await mkdir(path.dirname(temp), { recursive: true });
        await copyFile(file, temp);
        try { await media.library.add(temp, name, { origin }); return true; } catch { return false; }
      },
      setting: (key) => media.services.vault.setting(key),
      setSetting: (key, value) => media.services.vault.setSetting(key, value),
    },
    paceMs: app.isPackaged ? 0 : Number(process.env.CLINK_MOVE_PACE_MS ?? 0) || 0,
    log: (line) => errors.add("app", line),
  });
  app.on("before-quit", () => studio.phone.stop());
  // The broker to the open editor (MCP server, Watchmaker) and the opt-in watch-face MCP server (watchface/automation).
  const automation = new StudioAutomation(studio.root, {
    sealer: keychain,
    projects: async () => (await studio.list()).map((p) => ({ id: p.projectId, name: p.name, watch: p.firmwareType, updatedAt: p.updatedAt })),
    copy: (text) => clipboard.writeText(text),
  });
  void automation.start();
  // Watchmaker, Studio's AI designer: the AI picked on the AI page, driving the open face through the same broker.
  const watchmaker = new Watchmaker({
    broker: automation.broker, assets: automation.assets, projectsDir: path.join(studio.root, "projects"),
    model: async () => {
      // The Watchmaker smoke has no AI set up; a scripted model stands in (development builds only).
      if (process.env.CLINK_SMOKE_STUDIO_WATCHMAKER && !app.isPackaged) return { model: smokeWatchmakerModel(), label: "Smoke · scripted", provider: "smoke" };
      const m = await ai.model();
      return m ? { ...m, provider: vault.current.picked } : null;
    },
    imageMaker: async () => { const key = await vault.secret("openai"); return key ? openAIImageMaker(key) : null; },
  });
  app.on("before-quit", () => void automation.stop());
  // Local-Only Mode holds for Chromium's own requests too, not only the server code's fetch (dataMode.ts).
  guardSession(session.defaultSession, settings.guard.localOnly, settings.guard.blocked);
  app.on("session-created", (made) => guardSession(made, settings.guard.localOnly, settings.guard.blocked));

  protocol.handle("clink", async (request) => {
    const { pathname, host } = new URL(request.url);
    if (host !== "app") return new Response("Not found", { status: 404 });
    if (pathname.startsWith("/api/desktop/phones") && phones) return phones.answer(request);
    if (pathname === "/api/desktop/settings" || pathname.startsWith("/api/desktop/settings/")) return settings.answer(request);
    if (pathname === "/api/desktop/updates" || pathname.startsWith("/api/desktop/updates/")) return updates.answer(request);
    if (pathname === "/api/desktop/setup") return firstRun.answer(request);
    if (pathname === "/api/desktop/watch" || pathname.startsWith("/api/desktop/watch/")) return watch.answer(request);
    if (pathname === "/api/desktop/ai" || pathname.startsWith("/api/desktop/ai/")) return ai.answer(request);
    if (pathname === "/api/desktop/mcp" || pathname.startsWith("/api/desktop/mcp/")) return mcp.answer(request);
    if (pathname === "/api/desktop/media" || pathname.startsWith("/api/desktop/media/")) return media.answer(request);
    if (pathname.startsWith("/api/desktop/studio/watchmaker")) return (await watchmaker.answer(request)) ?? new Response("Not found", { status: 404 });
    if (pathname.startsWith("/api/desktop/studio/automation")) return (await automation.answer(request)) ?? new Response("Not found", { status: 404 });
    if (pathname === "/api/desktop/studio" || pathname.startsWith("/api/desktop/studio/")) return studio.answer(request);
    if (pathname === "/api/desktop/maps" || pathname.startsWith("/api/desktop/maps/")) return maps.answer(request);
    if (pathname === "/api/desktop/move" || pathname.startsWith("/api/desktop/move/")) return move.answer(request);
    if (pathname.startsWith("/api/desktop/developer/activity-screens")) return activityScreens.answer(request);
    if (pathname === "/api/desktop/developer" && dev) {
      if (request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const pick = (k: string) => (typeof body[k] === "boolean" ? { [k]: body[k] as boolean } : {});
        await changeDev({ ...pick("devMode"), ...pick("sample"), ...pick("resetSample") }, false);
      }
      return Response.json(dev.state, { headers: { "Cache-Control": "no-store" } });
    }
    if (pathname.startsWith("/api/")) {
      await ensureSignedIn();
      return answerApi(request, jar);
    }
    return DEV_SERVER ? serveFromDevServer(request, pathname) : serveFile(pathname);
  });

  // The only browser permissions: writing to the clipboard, and listing this computer's fonts for Studio's font picker.
  const allowed = new Set(["clipboard-sanitized-write", "local-fonts"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
