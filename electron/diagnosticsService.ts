import { app, clipboard, ipcMain, type BrowserWindow } from "electron";
import os from "node:os";
import path from "node:path";
import { DiagnosticsLog, withDiagnosticLogging, type DiagnosticLevel } from "./diagnosticsLog";
import type { RendererDiagnosticError } from "./diagnosticsTypes";

let log: DiagnosticsLog | undefined;
let statusProviders: Array<() => string[]> = [];

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

let recordForTests: ((source: string, error: unknown) => void) | undefined;

/** Test seam for services that record failures they don't rethrow. Never used by the app. */
export function setDiagnosticRecorderForTests(record?: (source: string, error: unknown) => void): void {
  recordForTests = record;
}

export function recordDiagnosticError(source: string, error: unknown): void {
  try { (recordForTests ?? getLog().record.bind(getLog()))(source, error); } catch { /* Diagnostics are best effort. */ }
}

/** Sync and connection failures from the last `hours`, for the Coach's data-freshness check. */
export function recentSyncErrors(hours = 72, limit = 8): Array<{ at: string; source: string; message: string; code?: string; count?: number }> {
  try {
    const sync = /^(trainingHub|mcp|corosMcp|corosBle|corosAccount|calendar|calendarSync|googleCalendar|appleCalendar|watch|localData|activityBackup|fitIndex|strava|hevy|intervals)(?::|$)/i;
    return getLog().recentErrors(Date.now() - hours * 3_600_000, (source) => sync.test(source)).slice(-limit);
  } catch {
    return [];
  }
}

/** Adds current-state lines (such as account connections) to the top of every report. */
export function registerDiagnosticStatus(provider: () => string[]): void {
  statusProviders = [...statusProviders, provider];
}

function currentStatus(): string[] {
  return statusProviders.flatMap((provider) => {
    try { return provider(); } catch (error) {
      return [`Status unavailable: ${error instanceof Error ? error.message : String(error)}`];
    }
  });
}

/** An info or warning entry (not an error), redacted like every entry. */
export function recordDiagnosticNotice(source: string, message: string, level: DiagnosticLevel = "info"): void {
  try { getLog().note(source, message, level); } catch { /* Diagnostics are best effort. */ }
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
  const range = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  ipcMain.handle("diagnostics:get", (event, rangeHours?: unknown) => {
    assertSender(event);
    return getLog().snapshot(currentStatus(), range(rangeHours));
  });
  ipcMain.handle("diagnostics:clear", (event) => {
    assertSender(event);
    getLog().clear();
    return getLog().snapshot(currentStatus());
  });
  ipcMain.handle("diagnostics:copy", (event, rangeHours?: unknown) => {
    assertSender(event);
    const snapshot = getLog().snapshot(currentStatus(), range(rangeHours));
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
