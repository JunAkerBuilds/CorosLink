import { app, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { getSetting, setSetting } from "./database";
import { WatchfaceAutomationBroker } from "./watchfaceAutomationBroker";
import { WatchfaceAutomationServer } from "./watchfaceAutomationServer";
import { WatchfaceAutomationService } from "./watchfaceAutomationService";
import type { WatchfaceAutomationResponse, WatchfaceAutomationStatus } from "./watchfaceAutomationTypes";

const SETTINGS_KEY = "watchfaces.externalAi";

/** Owns the opt-in endpoint and its trusted main-window IPC bridge. */
export function registerWatchfaceAutomation(getWindow: () => BrowserWindow | undefined) {
  let startupError: string | undefined;
  const requireWindow = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error("Open the CorosLink window before using watch-face tools.");
    return window;
  };
  const broker = new WatchfaceAutomationBroker({
    activate: () => {
      const window = requireWindow();
      window.webContents.send("watchfaceAutomation:activate");
    },
    send: (request) => requireWindow().webContents.send("watchfaceAutomation:request", request)
  });
  const service = new WatchfaceAutomationService((method, params) => broker.dispatch(method, params));
  const server = new WatchfaceAutomationServer({
    userDataPath: app.getPath("userData"),
    dispatch: (method, params) => service.dispatch(method, params)
  });
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const window = getWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
  };
  const status = (): WatchfaceAutomationStatus => ({ ...server.getStatus(), ...(startupError ? { error: startupError } : {}) });
  let configuration: Promise<unknown> = Promise.resolve();
  const configure = (input: { enabled: boolean; port?: number }, persist = true): Promise<WatchfaceAutomationStatus> => {
    const work = configuration.catch(() => undefined).then(async () => {
      if (!input || typeof input.enabled !== "boolean" || (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535))) {
        throw new Error("Choose whether external AI access is enabled and a port between 1024 and 65535.");
      }
      startupError = undefined;
      const previousPort = server.getStatus().port;
      if (input.enabled) {
        const started = await server.start({ port: input.port });
        if (!started.enabled) throw new Error(started.error ?? "Could not start external AI access.");
      } else {
        service.cancel();
        broker.cancel("External AI access was disabled.", false);
        await server.stop({ revokeToken: true });
      }
      const current = status();
      if (persist) setSetting(SETTINGS_KEY, JSON.stringify({ enabled: input.enabled, port: current.port ?? input.port ?? previousPort }));
      return current;
    });
    configuration = work;
    return work;
  };

  ipcMain.handle("watchfaceAutomation:status", (event) => {
    if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
    return status();
  });
  ipcMain.handle("watchfaceAutomation:configure", (event, input) => {
    if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
    return configure(input);
  });
  ipcMain.on("watchfaceAutomation:ready", (event, scope: unknown, ready: unknown) => {
    if (trusted(event) && (scope === "hub" || scope === "editor") && typeof ready === "boolean") broker.setReady(scope, ready);
  });
  ipcMain.on("watchfaceAutomation:response", (event, response: WatchfaceAutomationResponse) => {
    if (!trusted(event) || !response || typeof response.id !== "string") return;
    broker.respond(response);
  });

  return {
    resetRenderer: () => { service.cancel(); broker.cancel(); },
    restore: async () => {
      try {
        const saved = getSetting(SETTINGS_KEY);
        if (!saved) return;
        const input = JSON.parse(saved);
        if (input.enabled === true) await configure(input, false);
      } catch (error) {
        startupError = error instanceof Error ? error.message : "Could not start external AI access.";
      }
    },
    stop: async () => {
      service.cancel();
      broker.cancel();
      await configuration.catch(() => undefined);
      await server.stop();
    }
  };
}
