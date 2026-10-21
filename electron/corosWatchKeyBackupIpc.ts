import { expectedError } from "./diagnosticsLog";
import {
  inspectWatchKeyBackup, readWatchKeyBackupFile, WATCH_KEY_BACKUP_ERROR, WATCH_KEY_BACKUP_EXTENSION, watchKeyBackupFileName,
  watchKeyPassphrase, writeWatchKeyBackupFile
} from "./corosWatchKeyBackup";
import type { CorosWatchKeyLabel, CorosWatchKeyRestore } from "./corosWatchfaceService";
import type { CorosWatchfaceStatus, CorosWatchKeyBackupResult, CorosWatchKeyBackupChoice, CorosWatchKeyRestoreResult } from "./types";

type Owner = Electron.BrowserWindow;

export interface WatchKeyBackupIpcDependencies {
  ipc: Pick<Electron.IpcMain, "handle">;
  /** The main window, when it sent the request; throws otherwise. */
  owner: (event: Electron.IpcMainInvokeEvent) => Owner;
  service: {
    status: () => CorosWatchfaceStatus;
    createBackup: (passphrase: string) => Promise<{ data: Buffer; keyId: string }>;
    openBackup: (data: Buffer, passphrase: string) => Promise<CorosWatchKeyRestore>;
    saveRestored: (restore: CorosWatchKeyRestore) => CorosWatchfaceStatus;
  };
  saveDialog: (owner: Owner, options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
  openDialog: (owner: Owner, options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
  /** Shows a localized confirmation; resolves to the chosen button index. */
  confirm: (owner: Owner, options: Electron.MessageBoxOptions) => Promise<number>;
  /** Translates a native string (dialog details are built from translated pieces). */
  text: (source: string) => string;
  /** A diagnostics notice: only what happened and the four-digit key ID. */
  notice: (message: string) => void;
}

/**
 * Watch key backup IPC. The renderer sends a passphrase, once per operation,
 * and gets back only whether it worked and the summary every status carries.
 * Paths come from native dialogs, never from the renderer; the key and the
 * file's contents stay here.
 */
export function registerCorosWatchKeyBackupIpc(deps: WatchKeyBackupIpcDependencies): void {
  const { ipc, service } = deps;
  /** The file chosen in the restore dialog, read once (size-capped). Dropped after a restore or a new choice. */
  let chosen: Buffer | undefined;
  const passphraseOf = (input: unknown, purpose: "export" | "import") =>
    watchKeyPassphrase(input && typeof input === "object" ? (input as { passphrase?: unknown }).passphrase : undefined, purpose);
  const account = (label: CorosWatchKeyLabel) => label.accountEmail ?? deps.text("COROS account {{p0}}").replace("{{p0}}", label.accountId);
  const describe = (template: string, label: CorosWatchKeyLabel) =>
    deps.text(template).replace("{{p0}}", label.keyId).replace("{{p1}}", account(label));

  ipc.handle("watchfaces:backupWatchKey", async (event, input: unknown): Promise<CorosWatchKeyBackupResult> => {
    const window = deps.owner(event);
    const passphrase = passphraseOf(input, "export");
    const keyId = service.status().watchKey?.keyId;
    if (!keyId) throw new Error("No watch key is saved on this computer. Sign in to COROS first.");
    const selection = await deps.saveDialog(window, {
      title: "Back up watch key",
      defaultPath: watchKeyBackupFileName(keyId),
      filters: [{ name: "CorosLink watch key backup", extensions: [WATCH_KEY_BACKUP_EXTENSION] }]
    });
    if (selection.canceled || !selection.filePath) return { saved: false };
    const destination = selection.filePath.toLowerCase().endsWith(`.${WATCH_KEY_BACKUP_EXTENSION}`)
      ? selection.filePath : `${selection.filePath}.${WATCH_KEY_BACKUP_EXTENSION}`;
    const backup = await service.createBackup(passphrase);
    try {
      await writeWatchKeyBackupFile(destination, backup.data);
    } catch {
      // File system errors name the path; the user knows where they chose.
      throw new Error("CorosLink couldn't save the watch key backup there. Choose another folder.");
    }
    deps.notice(`Watch key backup exported (key ${backup.keyId}).`);
    return { saved: true };
  });

  ipc.handle("watchfaces:chooseWatchKeyBackup", async (event): Promise<CorosWatchKeyBackupChoice> => {
    const window = deps.owner(event);
    chosen = undefined;
    const selection = await deps.openDialog(window, {
      title: "Restore watch key",
      properties: ["openFile"],
      filters: [{ name: "CorosLink watch key backup", extensions: [WATCH_KEY_BACKUP_EXTENSION] }]
    });
    const filePath = selection.canceled ? undefined : selection.filePaths[0];
    if (!filePath) return { chosen: false };
    let data: Buffer;
    try {
      data = await readWatchKeyBackupFile(filePath);
      inspectWatchKeyBackup(data);
    } catch (error) {
      // The user picked the wrong file: say so, but don't log it (or its path).
      throw expectedError(error instanceof Error && !("code" in error) ? error : new Error(WATCH_KEY_BACKUP_ERROR));
    }
    chosen = data;
    return { chosen: true };
  });

  ipc.handle("watchfaces:restoreWatchKey", async (event, input: unknown): Promise<CorosWatchKeyRestoreResult> => {
    const window = deps.owner(event);
    if (!chosen) throw new Error("Choose a watch key backup first.");
    const passphrase = passphraseOf(input, "import");
    let restore: CorosWatchKeyRestore;
    try {
      restore = await service.openBackup(chosen, passphrase);
    } catch (error) {
      // A wrong passphrase is the user's to retry: the chosen file stays, and nothing is logged.
      throw error instanceof Error && error.message === WATCH_KEY_BACKUP_ERROR ? expectedError(error) : error;
    }
    if (restore.alreadySaved) {
      chosen = undefined;
      return { outcome: "alreadySaved", status: service.status() };
    }
    if (restore.replaces || restore.signsOutOtherAccount) {
      const details = [
        ...(restore.replaces ? [describe("Saved now: key {{p0}}, {{p1}}.", restore.replaces)] : []),
        describe("In the backup: key {{p0}}, {{p1}}.", restore.backup),
        ...(restore.signsOutOtherAccount ? [deps.text("You're signed in to COROS with another account. Restoring signs you out, so one account's key is never used with another's sign-in.")] : [])
      ];
      const response = await deps.confirm(window, {
        type: "warning", buttons: ["Cancel", restore.replaces ? "Replace watch key" : "Restore watch key"], defaultId: 0, cancelId: 0,
        message: restore.replaces ? "Replace the saved watch key?" : "Restore a watch key from another COROS account?",
        detail: details.join("\n\n"), noLink: true
      });
      if (response !== 1) {
        chosen = undefined;
        return { outcome: "cancelled", status: service.status() };
      }
    }
    const status = service.saveRestored(restore);
    chosen = undefined;
    deps.notice(`Watch key imported from a backup (key ${restore.backup.keyId}).`);
    return { outcome: "restored", status };
  });

  ipc.handle("watchfaces:cancelWatchKeyRestore", event => {
    deps.owner(event);
    chosen = undefined;
  });
}
