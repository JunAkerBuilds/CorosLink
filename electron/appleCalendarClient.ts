import type {
  AppleCalendarCredentials,
  CalendarChoice,
  CalendarConnectionStatus,
  CalendarSyncResult,
  CalendarSyncSettings,
} from "./calendarSyncTypes";
import type { TrainingHubScheduledWorkoutEntry } from "./types";
import { calendarSyncRange, readCalendarWorkouts } from "./calendarSyncUtils";
import { ICloudCalDav, ICloudCalendarError } from "./iCloudCalDav";
import { syncAppleWorkoutEvents } from "./appleCalendarSync";

export interface AppleCalendarState {
  credentials?: AppleCalendarCredentials;
  homeUrl?: string;
  corosUserId?: string;
  calendar?: CalendarChoice;
  autoSync?: boolean;
  lastSyncedAt?: string;
  error?: string;
}

interface Dependencies {
  read: () => AppleCalendarState;
  write: (state: AppleCalendarState) => void;
  ensureSecureStorage: () => void;
  sourceUserId: () => string | undefined;
  listWorkouts: (
    start: string,
    end: string,
  ) => Promise<TrainingHubScheduledWorkoutEntry[]>;
}

export class AppleCalendarClient {
  private active?: { controller: AbortController; promise: Promise<unknown> };
  private syncing = false;
  private connecting = false;
  private disconnecting = false;
  constructor(private readonly dependencies: Dependencies) {}

  status(): CalendarConnectionStatus {
    const state = this.dependencies.read();
    return {
      connected: Boolean(state.credentials && state.homeUrl),
      accountEmail: state.credentials?.email,
      calendar: state.calendar,
      autoSync: Boolean(state.autoSync),
      syncing: this.syncing,
      connecting: this.connecting,
      lastSyncedAt: state.lastSyncedAt,
      error: state.error,
      accountMatches: Boolean(
        state.corosUserId &&
        state.corosUserId === this.dependencies.sourceUserId(),
      ),
    };
  }

  private run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active || this.disconnecting)
      return Promise.reject(
        new Error(
          "An Apple Calendar operation is already running. Please wait.",
        ),
      );
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => operation(controller.signal))
      .catch((error) => {
        if (!controller.signal.aborted) {
          const state = this.dependencies.read();
          this.dependencies.write({
            ...state,
            ...(error instanceof ICloudCalendarError && error.status === 401
              ? { credentials: undefined, autoSync: false }
              : {}),
            error:
              error instanceof Error
                ? error.message
                : "Apple Calendar operation failed. Try again.",
          });
        }
        throw error;
      })
      .finally(() => {
        this.active = undefined;
      });
    this.active = { controller, promise };
    return promise;
  }

  connect(input: AppleCalendarCredentials): Promise<CalendarConnectionStatus> {
    return this.run(async (signal) => {
      this.dependencies.ensureSecureStorage();
      const email =
        typeof input?.email === "string"
          ? input.email.trim().toLowerCase()
          : "";
      const appPassword =
        typeof input?.appPassword === "string" ? input.appPassword.trim() : "";
      if (email.length > 254 || !/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(email))
        throw new Error("Enter your Apple Account email address.");
      if (!/^[a-z]{4}(?:-[a-z]{4}){3}$/i.test(appPassword))
        throw new Error(
          "Enter an Apple app-specific password in the form xxxx-xxxx-xxxx-xxxx. Create one at account.apple.com.",
        );
      const userId = this.dependencies.sourceUserId();
      if (!userId)
        throw new Error("Connect your COROS account in Training Hub first.");
      const credentials = { email, appPassword };
      const before = this.dependencies.read();
      this.connecting = true;
      try {
        const dav = new ICloudCalDav(credentials, signal, () => {
          if (this.dependencies.sourceUserId() !== userId)
            throw new Error(
              "Your COROS account changed. Connect Apple Calendar again.",
            );
        });
        const { homeUrl, calendars } = await dav.discover();
        signal.throwIfAborted();
        const sameAccount =
          before.homeUrl === homeUrl && before.corosUserId === userId;
        const calendar = sameAccount
          ? calendars.find((calendar) => calendar.id === before.calendar?.id)
          : undefined;
        this.dependencies.write({
          credentials,
          homeUrl,
          corosUserId: userId,
          calendar,
          ...(calendar
            ? { autoSync: before.autoSync, lastSyncedAt: before.lastSyncedAt }
            : {}),
          error: calendars.length
            ? undefined
            : "No editable iCloud calendars were found. Create an iCloud calendar or check sharing permissions.",
        });
      } finally {
        this.connecting = false;
      }
      return this.status();
    });
  }

  cancelConnect(): void {
    if (this.connecting) this.active?.controller.abort();
  }

  async disconnect(): Promise<CalendarConnectionStatus> {
    if (this.disconnecting)
      throw new Error("Apple Calendar disconnect is already running.");
    this.disconnecting = true;
    try {
      this.active?.controller.abort();
      await this.active?.promise.catch(() => undefined);
      this.dependencies.write({});
      return this.status();
    } finally {
      this.disconnecting = false;
    }
  }

  private dav(signal: AbortSignal): ICloudCalDav {
    const state = this.dependencies.read();
    if (!state.credentials || !state.homeUrl)
      throw new Error("Connect Apple Calendar first.");
    const assertAccount = () => {
      if (
        !state.corosUserId ||
        state.corosUserId !== this.dependencies.sourceUserId()
      ) {
        throw new Error(
          "Apple Calendar sync is paused. Sign in to the linked COROS account, or disconnect and connect again.",
        );
      }
    };
    assertAccount();
    return new ICloudCalDav(state.credentials, signal, assertAccount);
  }

  listCalendars(): Promise<CalendarChoice[]> {
    return this.run((signal) =>
      this.dav(signal).listCalendars(this.dependencies.read().homeUrl!),
    );
  }

  updateSettings(
    input: CalendarSyncSettings,
  ): Promise<CalendarConnectionStatus> {
    return this.run(async (signal) => {
      const dav = this.dav(signal);
      let state = this.dependencies.read();
      if (input?.calendarId !== undefined) {
        const calendar = (await dav.listCalendars(state.homeUrl!)).find(
          (calendar) => calendar.id === input.calendarId,
        );
        if (!calendar)
          throw new Error(
            "Choose an iCloud calendar you have permission to edit.",
          );
        state = {
          ...state,
          calendar,
          lastSyncedAt:
            state.calendar?.id === calendar.id ? state.lastSyncedAt : undefined,
        };
      }
      if (
        !input ||
        (input.autoSync !== undefined && typeof input.autoSync !== "boolean")
      )
        throw new Error("Invalid calendar sync preference.");
      signal.throwIfAborted();
      this.dependencies.write({
        ...state,
        autoSync: input.autoSync ?? state.autoSync,
        error: undefined,
      });
      return this.status();
    });
  }

  sync(): Promise<CalendarSyncResult> {
    return this.run(async (signal) => {
      this.syncing = true;
      try {
        const dav = this.dav(signal);
        const state = this.dependencies.read();
        if (!state.calendar)
          throw new Error("Choose an iCloud calendar to start syncing.");
        const userId = state.corosUserId!;
        const range = calendarSyncRange();
        const workouts = await readCalendarWorkouts({
          userId,
          ...range,
          signal,
          sourceUserId: this.dependencies.sourceUserId,
          listWorkouts: this.dependencies.listWorkouts,
        });
        const result = await syncAppleWorkoutEvents({
          userId,
          calendarId: state.calendar.id,
          ...range,
          workouts,
          dav,
        });
        signal.throwIfAborted();
        this.dependencies.write({
          ...this.dependencies.read(),
          lastSyncedAt: new Date().toISOString(),
          error: undefined,
        });
        return result;
      } finally {
        this.syncing = false;
      }
    });
  }

  async syncIfDue(): Promise<void> {
    if (this.active || this.disconnecting) return;
    const state = this.status();
    if (
      !state.connected ||
      !state.calendar ||
      !state.autoSync ||
      !state.accountMatches
    )
      return;
    if (
      state.lastSyncedAt &&
      Date.now() - Date.parse(state.lastSyncedAt) < 5 * 60_000
    )
      return;
    await this.sync();
  }

  stop(): void {
    this.active?.controller.abort();
  }
}
