import fs from "node:fs/promises";
import type { CorosNativeBleService } from "./corosNativeBleService";

type ActivityScreenApi = Pick<CorosNativeBleService,
  "activityScreenStatus" | "activityScreenBackups" | "listActivityScreenSports" | "readActivityScreens" |
  "backupActivityScreens" | "syncActivityScreenBaseline" | "confirmActivityScreenBaseline" |
  "previewActivityScreenLayout" | "applyActivityScreenLayout" | "restoreActivityScreens" | "exportActivityScreenBackup">;

export function registerCorosActivityScreenIpc(deps: {
  ipc: Pick<Electron.IpcMain, "handle">;
  isPackaged: () => boolean;
  owner: (event: Electron.IpcMainInvokeEvent) => Electron.BrowserWindow;
  api: ActivityScreenApi;
  saveDialog: (owner: Electron.BrowserWindow, options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
}): void {
  const owner = (event: Electron.IpcMainInvokeEvent) => {
    if (deps.isPackaged()) throw new Error("Activity-screen sync is available only in development builds.");
    return deps.owner(event);
  };
  const input = (value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Choose an activity-page action.");
    return value as { snapshotId?: unknown; previewId?: unknown; backupId?: unknown; pageIndex?: unknown; fieldCount?: unknown };
  };
  const id = (value: unknown): string => {
    if (typeof value !== "string" || !value.length || value.length > 100) throw new Error("Read or select the activity pages again.");
    return value;
  };
  const { ipc, api } = deps;
  ipc.handle("corosBle:activityScreenStatus", event => { owner(event); return api.activityScreenStatus(); });
  ipc.handle("corosBle:activityScreenSports", event => { owner(event); return api.listActivityScreenSports(); });
  ipc.handle("corosBle:activityScreensRead", (event, sportId: unknown) => {
    owner(event);
    if (typeof sportId !== "number" || !Number.isInteger(sportId)) throw new Error("Choose an activity.");
    return api.readActivityScreens(sportId);
  });
  ipc.handle("corosBle:activityScreenBackups", event => { owner(event); return api.activityScreenBackups(); });
  ipc.handle("corosBle:activityScreensBackup", (event, value: unknown) => {
    owner(event); return api.backupActivityScreens(id(input(value).snapshotId));
  });
  ipc.handle("corosBle:activityScreenBaselineSync", (event, value: unknown) => {
    owner(event); return api.syncActivityScreenBaseline(id(input(value).snapshotId));
  });
  ipc.handle("corosBle:activityScreenBaselineConfirm", (event, value: unknown) => {
    owner(event); return api.confirmActivityScreenBaseline(id(input(value).snapshotId));
  });
  ipc.handle("corosBle:activityScreenPreview", (event, value: unknown) => {
    owner(event);
    const selected = input(value);
    if (typeof selected.pageIndex !== "number" || !Number.isInteger(selected.pageIndex) ||
        typeof selected.fieldCount !== "number" || !Number.isInteger(selected.fieldCount)) throw new Error("Choose a page and layout.");
    return api.previewActivityScreenLayout(id(selected.snapshotId), selected.pageIndex, selected.fieldCount);
  });
  ipc.handle("corosBle:activityScreenApply", (event, value: unknown) => {
    owner(event); return api.applyActivityScreenLayout(id(input(value).previewId));
  });
  ipc.handle("corosBle:activityScreensRestore", (event, value: unknown) => {
    owner(event); return api.restoreActivityScreens(id(input(value).backupId));
  });
  ipc.handle("corosBle:activityScreenBackupExport", async (event, value: unknown) => {
    const window = owner(event), backupId = id(input(value).backupId);
    const content = await api.exportActivityScreenBackup(backupId);
    const selection = await deps.saveDialog(window, { title: "Export activity-page backup", defaultPath: `PACE-Pro-activity-pages-${backupId}.json`,
      filters: [{ name: "CorosLink activity-page backup", extensions: ["json"] }] });
    if (selection.canceled || !selection.filePath) return { saved: false };
    await fs.writeFile(selection.filePath, content, { mode: 0o600 });
    return { saved: true };
  });
}
