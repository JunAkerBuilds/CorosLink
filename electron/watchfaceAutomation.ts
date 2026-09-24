import { app, clipboard, ipcMain, nativeImage, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { getSetting, setSetting } from "./database";
import { WatchfaceAutomationBroker } from "./watchfaceAutomationBroker";
import { WatchfaceAutomationServer } from "./watchfaceAutomationServer";
import { WatchfaceAutomationService } from "./watchfaceAutomationService";
import { listChatGptModels } from "./chatService";
import { listCodexCliModels } from "./watchfaceCodexCli";
import { WatchfaceAiChatStore } from "./watchfaceAiChatStore";
import { cancelWatchfaceAiChat, runWatchfaceAiChat, WATCHFACE_AI_TOOL_NAMES } from "./watchfaceAiChat";
import type { WatchfaceAiMessage, WatchfaceAiOptions, WatchfaceAutomationResponse, WatchfaceAutomationStatus } from "./watchfaceAutomationTypes";

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
  // The Studio AI panel drives the same broker as external MCP clients, so its
  // edits serialize with theirs and land in the live editor history.
  ipcMain.handle("watchfaceAi:send", (event, requestId: unknown, messages: unknown, options: unknown) => {
    if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
    if (typeof requestId !== "string" || !requestId || requestId.length > 200 || !Array.isArray(messages)) {
      throw new Error("Send a request id and the conversation messages.");
    }
    const sender = event.sender;
    void runWatchfaceAiChat(
      {
        listTools: () => server.listAgentTools(WATCHFACE_AI_TOOL_NAMES),
        callTool: (name, params) => server.callAgentTool(name, params),
        importImage: (dataUrl) => server.importAgentImage(dataUrl),
        readImage: (assetId) => server.readAgentImage(assetId),
        importGeneratedImage: async (base64) => {
          const asset = await server.importAgentImage(`data:image/png;base64,${base64}`);
          // Full resolution stays in the asset store; the chat and the model's
          // vision input get a lighter copy.
          const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
          const preview = image.getSize().width > 512 ? image.resize({ width: 512, quality: "good" }) : image;
          return { ...asset, previewDataUrl: preview.toDataURL() };
        }
      },
      requestId,
      messages as WatchfaceAiMessage[],
      // The editor supports only Codex CLI, including requests from older renderers.
      {
        ...(options && typeof options === "object" ? options as WatchfaceAiOptions : {}),
        harness: "codex-cli"
      },
      (payload) => { if (!sender.isDestroyed()) sender.send("watchfaceAi:event", payload); }
    );
  });
  ipcMain.handle("watchfaceAi:models", (event) => {
    if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
    // The editor runs Codex CLI, so list what its own sign-in offers.
    return listCodexCliModels().catch((error: unknown) => {
      console.warn("[watchmaker] Codex CLI model list unavailable:", error instanceof Error ? error.message : error);
      return listChatGptModels();
    });
  });
  const chats = new WatchfaceAiChatStore(app.getPath("userData"));
  const handleTrusted = <Args extends unknown[]>(channel: string, handler: (...args: Args) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
      return handler(...(args as Args));
    });
  };
  handleTrusted("watchfaceAi:listChats", (projectKey: string) => chats.list(projectKey));
  handleTrusted("watchfaceAi:loadChat", (id: string) => chats.load(id));
  handleTrusted("watchfaceAi:saveChat", (input: { id?: string; projectKey: string; title?: string; messages: unknown[] }) => {
    if (!input || typeof input !== "object") throw new Error("Invalid chat.");
    return chats.save(input);
  });
  handleTrusted("watchfaceAi:renameChat", (id: string, title: string) => chats.rename(id, String(title ?? "")));
  handleTrusted("watchfaceAi:deleteChat", (id: string) => chats.delete(id));
  handleTrusted("watchfaceAi:copyImage", async (assetId: string) => {
    if (typeof assetId !== "string" || !/^[a-f0-9]{64}$/.test(assetId)) throw new Error("Choose a generated image to copy.");
    // Gallery images are reduced previews. Copy the original stored PNG,
    // including its alpha channel, without copying the checkerboard or caption.
    const image = nativeImage.createFromDataURL(await server.readAgentImage(assetId));
    if (image.isEmpty()) throw new Error("The original image could not be loaded.");
    clipboard.writeImage(image);
  });
  ipcMain.handle("watchfaceAi:cancel", (event, requestId: unknown) => {
    if (!trusted(event)) throw new Error("This connection is only available to the CorosLink window.");
    if (typeof requestId === "string") cancelWatchfaceAiChat(requestId);
  });
  ipcMain.on("watchfaceAutomation:response", (event, response: WatchfaceAutomationResponse) => {
    if (!trusted(event) || !response || typeof response.id !== "string") return;
    broker.respond(response);
  });

  return {
    resetRenderer: () => { cancelWatchfaceAiChat(); service.cancel(); broker.cancel(); },
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
      cancelWatchfaceAiChat();
      service.cancel();
      broker.cancel();
      await configuration.catch(() => undefined);
      await server.stop();
    }
  };
}
