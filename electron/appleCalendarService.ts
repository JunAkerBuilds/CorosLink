import { safeStorage } from "electron";
import { getSetting, setSetting } from "./database";
import {
  getTrainingHubStatus,
  listScheduledWorkoutEntries,
} from "./trainingHubService";
import {
  AppleCalendarClient,
  type AppleCalendarState,
} from "./appleCalendarClient";

const STORAGE_KEY = "appleCalendar.secureState";
function ensureSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "Secure credential storage is unavailable. Unlock your system keychain to connect Apple Calendar.",
    );
  }
}

export const appleCalendar = new AppleCalendarClient({
  ensureSecureStorage,
  read: () => {
    const stored = getSetting(STORAGE_KEY);
    if (!stored) return {};
    ensureSecureStorage();
    try {
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(stored, "base64")),
      ) as AppleCalendarState;
    } catch {
      throw new Error(
        "Could not unlock Apple Calendar credentials. Check your system keychain and restart CorosLink.",
      );
    }
  },
  write: (state) => {
    ensureSecureStorage();
    setSetting(
      STORAGE_KEY,
      safeStorage.encryptString(JSON.stringify(state)).toString("base64"),
    );
  },
  sourceUserId: () => {
    const status = getTrainingHubStatus();
    return status.authenticated ? status.userId : undefined;
  },
  listWorkouts: listScheduledWorkoutEntries,
});

let timer: ReturnType<typeof setInterval> | undefined;
export function startAppleCalendarSync(): void {
  if (timer) return;
  const tick = () => {
    void appleCalendar.syncIfDue().catch(() => {
      /* Connection status carries failures. */
    });
  };
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  tick();
}
export function stopAppleCalendarSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  appleCalendar.stop();
}
