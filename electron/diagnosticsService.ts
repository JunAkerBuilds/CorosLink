import { app, clipboard, ipcMain, type BrowserWindow } from "electron";
import os from "node:os";
import path from "node:path";
import { DiagnosticsLog, withDiagnosticLogging } from "./diagnosticsLog";
import type { RendererDiagnosticError } from "./diagnosticsTypes";

let log: DiagnosticsLog | undefined;

function getLog(): DiagnosticsLog {
  return log ??= new DiagnosticsLog(
    path.join(app.getPath("userData"), "diagnostics", "errors.json"),
    {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome
    },
    [app.getPath("userData"), app.getAppPath(), os.homedir()]
  );
}

export function recordDiagnosticError(source: string, error: unknown): void {
  try { getLog().record(source, error); } catch { /* Diagnostics are best effort. */ }
}

export function handleDiagnosticIpc(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1]
): void {
  ipcMain.handle(channel, withDiagnosticLogging({ record: recordDiagnosticError }, channel, listener));
}

// Main-process handler registration goes through this adapter; Electron itself is unchanged.
export const diagnosticIpcMain = { handle: handleDiagnosticIpc };

export function initializeDiagnostics(getWindow: () => BrowserWindow | undefined): void {
  getLog();
  const assertSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const contents = getWindow()?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      throw new Error("Diagnostics are only available in the main app window.");
    }
  };
  // Keep diagnostic operations outside the logging wrapper to avoid recursion.
  ipcMain.handle("diagnostics:get", (event) => {
    assertSender(event);
    return getLog().snapshot();
  });
  ipcMain.handle("diagnostics:clear", (event) => {
    assertSender(event);
    return getLog().clear();
  });
  ipcMain.handle("diagnostics:copy", (event) => {
    assertSender(event);
    const snapshot = getLog().snapshot();
    clipboard.writeText(snapshot.report);
    return snapshot;
  });
  ipcMain.on("diagnostics:rendererError", (event, input: RendererDiagnosticError) => {
    try { assertSender(event); } catch { return; }
    if (!input || (input.kind !== "error" && input.kind !== "unhandledrejection") ||
      typeof input.name !== "string" || input.name.length > 160 || typeof input.message !== "string" ||
      input.message.length > 32_000 || (input.stack !== undefined &&
        (typeof input.stack !== "string" || input.stack.length > 32_000))) return;
    recordDiagnosticError(`renderer:${input.kind}`, {
      name: input.name,
      message: input.message,
      stack: input.stack
    });
  });
  // Observe fatal errors without changing Node's normal termination behavior.
  process.on("uncaughtExceptionMonitor", (error, origin) => recordDiagnosticError(`main:${origin}`, error));
}

export function observeDiagnosticWindow(window: BrowserWindow): void {
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") {
      recordDiagnosticError("renderer:processGone", new Error(`${details.reason} (exit ${details.exitCode})`));
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      recordDiagnosticError("renderer:load", Object.assign(new Error(description), { code: String(code) }));
    }
  });
}
