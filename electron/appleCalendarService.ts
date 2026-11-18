import { safeStorage } from "electron";
import { getSetting } from "./database";
import { recordDiagnosticError } from "./diagnosticsService";
import { SecureSettingCache } from "./secureSettingCache";
import { calendarSourceUserId, calendarSourceRevision, listCalendarWorkoutEntries } from "./calendarWorkoutEventStorage";
import {
  AppleCalendarClient,
  type AppleCalendarState,
} from "./appleCalendarClient";

const STORAGE_KEY = "appleCalendar.secureState";
const secureState = new SecureSettingCache<AppleCalendarState>(STORAGE_KEY, {
  unreadableMessage:
    "Could not unlock Apple Calendar credentials. Check your system keychain and restart CorosLink.",
  onSaveError: (error) => recordDiagnosticError("calendarSync:apple:saveCredentials", error),
});

/** Decrypts the saved Apple Calendar credentials; awaited at startup before any read. */
export function loadAppleCalendarCredentials(): Promise<void> {
  return secureState.load();
}

function ensureSecureStorage(): void {
  if (
    !secureState.secureStorageAvailable() ||
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
});

let timer: ReturnType<typeof setInterval> | undefined;
export function startAppleCalendarSync(): void {
  if (timer) return;
  const tick = () => {
    void appleCalendar.syncIfDue().catch((error) => {
      // Connection status carries failures; the error report keeps the cause.
      recordDiagnosticError("calendarSync:apple", error);
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
