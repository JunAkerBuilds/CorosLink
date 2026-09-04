import { safeStorage, shell } from "electron";
import { getSetting, setSetting } from "./database";
import {
  getTrainingHubStatus,
  listScheduledWorkoutEntries,
} from "./trainingHubService";
import {
  GoogleCalendarClient,
  type GoogleCalendarState,
} from "./googleCalendarClient";

const STORAGE_KEY = "googleCalendar.secureState";

function ensureSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "Secure credential storage is unavailable. Unlock your system keychain to connect Google Calendar.",
    );
  }
}

export const googleCalendar = new GoogleCalendarClient({
  ensureSecureStorage,
  read: () => {
    const stored = getSetting(STORAGE_KEY);
    if (!stored) return {};
    ensureSecureStorage();
    try {
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(stored, "base64")),
      ) as GoogleCalendarState;
    } catch {
      throw new Error(
        "Could not unlock Google Calendar credentials. Check your system keychain and restart CorosLink.",
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
  openUrl: (url) => shell.openExternal(url),
  config: {
    clientId: process.env.COROSLINK_GOOGLE_CALENDAR_CLIENT_ID ?? "",
    clientSecret: process.env.COROSLINK_GOOGLE_CALENDAR_CLIENT_SECRET,
  },
});

let timer: ReturnType<typeof setInterval> | undefined;
export function startGoogleCalendarSync(): void {
  if (timer) return;
  const tick = () => {
    void googleCalendar.syncIfDue().catch(() => {
      /* Status carries sync failures for the UI. */
    });
  };
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
  tick();
}

export function stopGoogleCalendarSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  googleCalendar.stop();
}
