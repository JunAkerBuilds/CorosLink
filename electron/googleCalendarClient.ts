import { calendarSyncRange, readCalendarWorkouts } from "./calendarSyncUtils";
import {
  authorizeGoogleCalendar,
  GoogleAuthorizationError,
  requestGoogleTokens,
  type GoogleCalendarTokens,
} from "./googleCalendarOAuth";
import {
  GoogleCalendarApiError,
  syncWorkoutEvents,
} from "./googleCalendarSync";
import type {
  GoogleCalendarChoice,
  GoogleCalendarConfigInput,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
} from "./googleCalendarTypes";
import type { TrainingHubScheduledWorkoutEntry } from "./types";

export interface GoogleCalendarState {
  config?: GoogleCalendarConfigInput;
  tokens?: GoogleCalendarTokens;
  accountEmail?: string;
  accountId?: string;
  corosUserId?: string;
  calendar?: GoogleCalendarChoice;
  autoSync?: boolean;
  lastSyncedAt?: string;
  error?: string;
}

interface Dependencies {
  read: () => GoogleCalendarState;
  write: (state: GoogleCalendarState) => void;
  ensureSecureStorage: () => void;
  sourceUserId: () => string | undefined;
  listWorkouts: (
    start: string,
    end: string,
  ) => Promise<TrainingHubScheduledWorkoutEntry[]>;
  openUrl: (url: string) => Promise<void>;
  config?: GoogleCalendarConfigInput;
  authorize?: typeof authorizeGoogleCalendar;
}

export class GoogleCalendarClient {
  private active?: { controller: AbortController; promise: Promise<unknown> };
  private syncing = false;
  private connecting = false;
  private disconnecting = false;

  constructor(private readonly dependencies: Dependencies) {}

  private config(state = this.dependencies.read()): GoogleCalendarConfigInput {
    return state.config ?? this.dependencies.config ?? { clientId: "" };
  }

  status(): GoogleCalendarStatus {
    const state = this.dependencies.read();
    const config = this.config(state);
    return {
      configured: Boolean(config.clientId),
      clientId: config.clientId,
      connected: Boolean(state.tokens),
      accountEmail: state.accountEmail,
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
        new Error("A calendar operation is already running. Please wait."),
      );
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => operation(controller.signal))
      .finally(() => {
        this.active = undefined;
      });
    this.active = { controller, promise };
    return promise;
  }

  saveConfig(input: GoogleCalendarConfigInput): GoogleCalendarStatus {
    if (this.active || this.disconnecting)
      throw new Error("Wait for the calendar operation to finish first.");
    const clientId =
      typeof input?.clientId === "string" ? input.clientId.trim() : "";
    const clientSecret =
      typeof input?.clientSecret === "string" ? input.clientSecret.trim() : "";
    if (
      !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
      clientId.length > 300 ||
      clientSecret.length > 500
    ) {
      throw new Error("Enter a valid Google Desktop app client ID.");
    }
    this.dependencies.ensureSecureStorage();
    const state = this.dependencies.read();
    if (state.tokens)
      throw new Error(
        "Disconnect Google Calendar before changing its app credentials.",
      );
    this.dependencies.write({
      config: { clientId, ...(clientSecret ? { clientSecret } : {}) },
    });
    return this.status();
  }

  connect(): Promise<GoogleCalendarStatus> {
    return this.run(async (signal) => {
      this.dependencies.ensureSecureStorage();
      const userId = this.dependencies.sourceUserId();
      if (!userId)
        throw new Error("Connect your COROS account in Training Hub first.");
      const before = this.dependencies.read();
      const config = this.config(before);
      if (!config.clientId)
        throw new Error("Set up Google Calendar app credentials first.");
      this.connecting = true;
      try {
        const tokens = await (
          this.dependencies.authorize ?? authorizeGoogleCalendar
        )(config, this.dependencies.openUrl, signal);
        const profileResponse = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          },
        );
        const profile = (await profileResponse.json()) as {
          id?: string;
          email?: string;
        };
        if (!profileResponse.ok || !profile.id || !profile.email)
          throw new Error(
            "Could not identify your Google account. Try connecting again.",
          );
        signal.throwIfAborted();
        if (this.dependencies.sourceUserId() !== userId)
          throw new Error(
            "Your COROS account changed. Connect Google Calendar again.",
          );
        const sameAccount =
          before.corosUserId === userId && before.accountId === profile.id;
        this.dependencies.write({
          config,
          tokens,
          accountId: profile.id,
          accountEmail: profile.email,
          corosUserId: userId,
          ...(sameAccount
            ? {
                calendar: before.calendar,
                autoSync: before.autoSync,
                lastSyncedAt: before.lastSyncedAt,
              }
            : {}),
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

  async disconnect(): Promise<GoogleCalendarStatus> {
    if (this.disconnecting)
      throw new Error("Calendar disconnect is already running.");
    this.disconnecting = true;
    try {
      this.active?.controller.abort();
      await this.active?.promise.catch(() => undefined);
      const state = this.dependencies.read();
      // Local access is always removed, even if Google is unreachable.
      this.dependencies.write({ config: state.config });
      if (state.tokens) {
        try {
          const response = await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            body: new URLSearchParams({ token: state.tokens.refreshToken }),
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok && response.status !== 400)
            throw new Error("Revocation failed");
        } catch {
          this.dependencies.write({
            config: state.config,
            error:
              "Disconnected on this computer. To remove Google's permission too, visit your Google Account connections.",
          });
        }
      }
      return this.status();
    } finally {
      this.disconnecting = false;
    }
  }

  private async request<T>(
    path: string,
    signal: AbortSignal,
    method = "GET",
    body?: unknown,
    retry = true,
  ): Promise<T> {
    signal.throwIfAborted();
    let state = this.dependencies.read();
    if (!state.tokens)
      throw new GoogleAuthorizationError("Connect Google Calendar first.");
    if (state.corosUserId !== this.dependencies.sourceUserId())
      throw new Error(
        "Calendar sync is paused because the COROS account changed. Reconnect Google Calendar for this account.",
      );
    if (state.tokens.expiresAt <= Date.now() + 60_000) {
      const tokens = await requestGoogleTokens(
        this.config(state),
        {
          grant_type: "refresh_token",
          refresh_token: state.tokens.refreshToken,
        },
        signal,
      );
      signal.throwIfAborted();
      state = { ...state, tokens };
      this.dependencies.write(state);
    }
    if (state.corosUserId !== this.dependencies.sourceUserId())
      throw new Error("Your COROS account changed during sync. Try again.");
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${state.tokens!.accessToken}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      },
    );
    signal.throwIfAborted();
    if (response.status === 401 && retry) {
      this.dependencies.write({
        ...state,
        tokens: { ...state.tokens!, expiresAt: 0 },
      });
      return this.request(path, signal, method, body, false);
    }
    if (response.status === 401)
      throw new GoogleAuthorizationError(
        "Google Calendar access expired. Reconnect your account.",
      );
    if (!response.ok) {
      throw new GoogleCalendarApiError(
        response.status,
        response.status === 403
          ? "Google denied calendar access. Enable the Calendar API, check calendar permissions, or try again later if your quota was exceeded."
          : response.status === 429
            ? "Google Calendar is temporarily rate limited. Try syncing again later."
            : response.status === 404
              ? "The selected Google calendar or event is no longer available. Choose a calendar again."
              : `Google Calendar request failed (${response.status}). Try syncing again.`,
      );
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  private async calendars(
    signal: AbortSignal,
  ): Promise<GoogleCalendarChoice[]> {
    const calendars: GoogleCalendarChoice[] = [];
    const seenPages = new Set<string>();
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        minAccessRole: "writer",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await this.request<{
        items?: Array<{
          id?: string;
          summary?: string;
          summaryOverride?: string;
          primary?: boolean;
          accessRole?: string;
        }>;
        nextPageToken?: string;
      }>(`/users/me/calendarList?${params}`, signal);
      for (const calendar of page.items ?? []) {
        if (
          calendar.id &&
          ["owner", "writer"].includes(calendar.accessRole ?? "")
        ) {
          calendars.push({
            id: calendar.id,
            name: calendar.summaryOverride || calendar.summary || calendar.id,
            primary: Boolean(calendar.primary),
          });
        }
      }
      pageToken = page.nextPageToken ?? "";
      if (pageToken && seenPages.has(pageToken))
        throw new Error("Google repeated a calendar page. Try again.");
      seenPages.add(pageToken);
    } while (pageToken);
    return calendars.sort(
      (a, b) =>
        Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
    );
  }

  listCalendars(): Promise<GoogleCalendarChoice[]> {
    return this.run(async (signal) => {
      try {
        return await this.calendars(signal);
      } catch (error) {
        if (error instanceof GoogleAuthorizationError && !signal.aborted) {
          this.dependencies.write({
            ...this.dependencies.read(),
            tokens: undefined,
            autoSync: false,
            error: error.message,
          });
        }
        throw error;
      }
    });
  }

  updateSettings(input: {
    calendarId?: string;
    autoSync?: boolean;
  }): Promise<GoogleCalendarStatus> {
    return this.run(async (signal) => {
      let state = this.dependencies.read();
      if (!state.tokens) throw new Error("Connect Google Calendar first.");
      if (input.calendarId !== undefined) {
        if (typeof input.calendarId !== "string" || !input.calendarId)
          throw new Error("Choose a Google calendar.");
        const calendar = (await this.calendars(signal)).find(
          (item) => item.id === input.calendarId,
        );
        if (!calendar)
          throw new Error("Choose a calendar you have permission to edit.");
        state = this.dependencies.read(); // A calendar read may have refreshed the token.
        state = {
          ...state,
          calendar,
          lastSyncedAt:
            state.calendar?.id === calendar.id ? state.lastSyncedAt : undefined,
        };
      }
      if (input.autoSync !== undefined && typeof input.autoSync !== "boolean")
        throw new Error("Invalid calendar sync preference.");
      this.dependencies.write({
        ...state,
        autoSync: input.autoSync ?? state.autoSync,
        error: undefined,
      });
      return this.status();
    });
  }

  sync(): Promise<GoogleCalendarSyncResult> {
    return this.run(async (signal) => {
      this.syncing = true;
      try {
        const state = this.dependencies.read();
        const userId = this.dependencies.sourceUserId();
        if (!state.tokens || !state.calendar)
          throw new Error(
            "Connect Google Calendar and choose a calendar first.",
          );
        if (!userId || state.corosUserId !== userId)
          throw new Error(
            "Calendar sync is paused. Sign in to the linked COROS account or reconnect Google Calendar.",
          );
        const range = calendarSyncRange();
        const workouts = await readCalendarWorkouts({
          userId,
          ...range,
          signal,
          sourceUserId: this.dependencies.sourceUserId,
          listWorkouts: this.dependencies.listWorkouts,
        });
        const result = await syncWorkoutEvents({
          userId,
          calendarId: state.calendar.id,
          ...range,
          workouts,
          request: (path, method, body) =>
            this.request(path, signal, method, body),
        });
        signal.throwIfAborted();
        this.dependencies.write({
          ...this.dependencies.read(),
          lastSyncedAt: new Date().toISOString(),
          error: undefined,
        });
        return result;
      } catch (error) {
        if (!signal.aborted) {
          this.dependencies.write({
            ...this.dependencies.read(),
            ...(error instanceof GoogleAuthorizationError
              ? { tokens: undefined, autoSync: false }
              : {}),
            error:
              error instanceof Error
                ? error.message
                : "Calendar sync failed. Try again.",
          });
        }
        throw error;
      } finally {
        this.syncing = false;
      }
    });
  }

  /** Runs in the main process, including when the calendar screen is closed. */
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
