import { safeStorage, shell } from "electron";
import { getSetting } from "./database";
import { recordDiagnosticError } from "./diagnosticsService";
import { SecureSettingCache } from "./secureSettingCache";
import { calendarSourceUserId, calendarSourceRevision, listCalendarWorkoutEntries } from "./calendarWorkoutEventStorage";
import {
  GoogleCalendarClient,
  type GoogleCalendarState,
} from "./googleCalendarClient";

const STORAGE_KEY = "googleCalendar.secureState";

const secureState = new SecureSettingCache<GoogleCalendarState>(STORAGE_KEY, {
  unreadableMessage:
    "Could not unlock Google Calendar credentials. Check your system keychain and restart CorosLink.",
  onSaveError: (error) => recordDiagnosticError("calendarSync:google:saveCredentials", error),
});

/** Decrypts the saved Google Calendar credentials; awaited at startup before any read. */
export function loadGoogleCalendarCredentials(): Promise<void> {
  return secureState.load();
}

function ensureSecureStorage(): void {
  if (
    !secureState.secureStorageAvailable() ||
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
    if (!getSetting(STORAGE_KEY) && secureState.read() === undefined) return {};
    ensureSecureStorage();
    return secureState.read() ?? {};
  },
  write: (state) => {
    ensureSecureStorage();
    secureState.write(state);
  },
  sourceUserId: calendarSourceUserId,
  listWorkouts: listCalendarWorkoutEntries,
  sourceRevision: calendarSourceRevision,
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
    void googleCalendar.syncIfDue().catch((error) => {
      // Status carries sync failures for the UI; the error report keeps the cause.
      recordDiagnosticError("calendarSync:google", error);
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
