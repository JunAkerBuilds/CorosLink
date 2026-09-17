import {
  CalendarDays,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { GoogleCalendarStatus } from "../../electron/googleCalendarTypes";
import type {
  CalendarChoice,
  CalendarConnectionStatus,
} from "../../electron/calendarSyncTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { calendarSyncButtonState } from "./calendarSyncStatus";
import "./calendarConnections.css";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : "Could not connect your calendar. Try again.";
}

type CalendarProvider = "google" | "apple";
type ConnectionStatus = CalendarConnectionStatus &
  Partial<Pick<GoogleCalendarStatus, "configured" | "clientId">>;

function CalendarConnection({
  api,
  provider,
  suggestedEmail,
}: {
  api: CorosLinkApi;
  provider: CalendarProvider;
  suggestedEmail?: string;
}) {
  const isGoogle = provider === "google";
  const providerName = isGoogle ? "Google Calendar" : "Apple Calendar";
  const destinationName = isGoogle ? "Google" : "iCloud";
  const connectFormId = useId();
  const autoSyncLabelId = useId();
  const autoSyncDescriptionId = useId();
  const [appleEmail, setAppleEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const adapter = useMemo(
    () =>
      isGoogle
        ? {
            getStatus: api.getGoogleCalendarStatus,
            listCalendars: api.listGoogleCalendars,
            updateSettings: api.updateGoogleCalendarSettings,
            sync: api.syncGoogleCalendar,
            disconnect: api.disconnectGoogleCalendar,
            cancelConnect: api.cancelGoogleCalendarConnect,
          }
        : {
            getStatus: api.getAppleCalendarStatus,
            listCalendars: api.listAppleCalendars,
            updateSettings: api.updateAppleCalendarSettings,
            sync: api.syncAppleCalendar,
            disconnect: api.disconnectAppleCalendar,
            cancelConnect: api.cancelAppleCalendarConnect,
          },
    [api, isGoogle],
  );
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [selected, setSelected] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const next: ConnectionStatus = await adapter.getStatus();
    if (mounted.current) setStatus(next);
    return next;
  }, [adapter]);

  useEffect(() => {
    mounted.current = true;
    void refresh()
      .then((next) => {
        if (mounted.current) {
          setClientId(next.clientId ?? "");
          setAppleEmail(next.accountEmail ?? "");
          setSelected(next.calendar?.id ?? "");
          setSetupOpen(!next.configured);
        }
      })
      .catch((error) => {
        if (mounted.current) setError(errorMessage(error));
      });
    const timer = window.setInterval(() => {
      void refresh().catch((error) => {
        if (mounted.current) setError(errorMessage(error));
      });
    }, 3_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const loadCalendars = useCallback(async () => {
    const items = await adapter.listCalendars();
    if (mounted.current) {
      setCalendars(items);
      setSelected((current) =>
        items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? ""),
      );
      if (items.length === 0)
        setMessage(
          `No editable calendars were found. Connect an account with permission to edit a ${destinationName} calendar.`,
        );
    }
  }, [adapter, destinationName]);

  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      if (mounted.current) {
        try {
          await refresh();
        } catch (error) {
          setError(errorMessage(error));
        }
        setBusy(null);
      }
    }
  }

  async function connect() {
    await perform("connect", async () => {
      const credentials = { email: appleEmail, appPassword };
      if (!isGoogle) setAppPassword("");
      const next = isGoogle
        ? await api.connectGoogleCalendar()
        : await api.connectAppleCalendar(credentials);
      if (!mounted.current) return;
      setStatus(next);
      setSelected(next.calendar?.id ?? "");
      await loadCalendars();
    });
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    await perform("setup", async () => {
      const next = await api.saveGoogleCalendarConfig({
        clientId,
        clientSecret,
      });
      setStatus(next);
      setClientSecret("");
      setSetupOpen(false);
      setMessage("Google Calendar is ready to connect.");
    });
  }

  async function sync(saveCalendar: boolean) {
    await perform("sync", async () => {
      if (saveCalendar)
        await adapter.updateSettings({
          calendarId: selected,
          autoSync: true,
        });
      const result = await adapter.sync();
      if (saveCalendar) setCalendars([]);
      setMessage(
        `Calendar synced: ${result.created} added, ${result.updated} updated, ${result.deleted} removed.`,
      );
    });
  }

  const working = Boolean(busy || status?.syncing || status?.connecting);
  const connecting = busy === "connect" || status?.connecting;
  const choosingCalendar = calendars.length > 0;
  const lastSynced = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const syncState = calendarSyncButtonState(
    status ? [{ ...status, error: error || status.error }] : null,
    busy === "sync",
  );

  return (
    <section
      className="calendar-connection-connection"
      aria-label={`${providerName} connection`}
    >
      <div className="calendar-connection-overview">
        <div className="calendar-connection-heading">
          <span className="calendar-connection-icon">
            <CalendarDays size={21} aria-hidden="true" />
          </span>
          <div>
            <h3>{providerName}</h3>
            {status?.connected ? (
              <span className="calendar-connection-badge">
                <Check size={13} aria-hidden="true" /> Connected
              </span>
            ) : null}
          </div>
        </div>
        <p className="calendar-connection-hint">
          Your scheduled workouts appear as all-day events in {destinationName},
          from the past 7 days through the next 90 days.
        </p>
        <p className="calendar-connection-hint">
          Make workout changes in CorosLink. Edits in {providerName} won’t
          update your training plan.
        </p>
      </div>

      <div className="calendar-connection-content">
        {!status && !error ? (
          <p className="calendar-connection-loading" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" /> Loading
            calendar connection…
          </p>
        ) : null}

        {status?.connected ? (
          <>
            <div className="calendar-connection-row calendar-connection-account">
              <div className="calendar-connection-row-copy">
                <span className="calendar-connection-label">Account</span>
                <strong>{status.accountEmail}</strong>
              </div>
              <button
                className="calendar-connection-text-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void perform("disconnect", async () => {
                    const next = await adapter.disconnect();
                    setStatus(next);
                    setCalendars([]);
                    setSelected("");
                    setMessage(
                      `${providerName} disconnected. Previously synced events remain in your calendar.${isGoogle ? "" : " You can also revoke the app-specific password at account.apple.com."}`,
                    );
                  })
                }
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
            {!status.accountMatches ? (
              <p className="calendar-error">
                Sync is paused. Sign in to the linked COROS account, or
                disconnect and reconnect {providerName} for your current
                account.
              </p>
            ) : null}

            {choosingCalendar ? (
              <div className="calendar-connection-destination calendar-connection-row">
                <label className="field">
                  Destination calendar
                  <select
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                    disabled={working}
                  >
                    {calendars.map((calendar) => (
                      <option value={calendar.id} key={calendar.id}>
                        {calendar.name}
                        {calendar.primary ? " (primary)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {status.calendar && status.calendar.id !== selected ? (
                  <p className="calendar-connection-hint">
                    Previously synced events stay in the old calendar. New syncs
                    will use the selected calendar.
                  </p>
                ) : null}
                <div className="calendar-connection-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={working || !selected || !status.accountMatches}
                    onClick={() => void sync(true)}
                  >
                    {busy === "sync" ? (
                      <Loader2 size={15} className="spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={15} aria-hidden="true" />
                    )}
                    {status.calendar?.id === selected
                      ? "Save and sync"
                      : "Start syncing"}
                  </button>
                  <button
                    className="calendar-connection-text-button"
                    type="button"
                    disabled={working}
                    onClick={() => {
                      setCalendars([]);
                      setSelected(status.calendar?.id ?? "");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="calendar-connection-row">
                <div className="calendar-connection-row-copy">
                  <span className="calendar-connection-label">
                    Destination calendar
                  </span>
                  <strong>
                    {status.calendar?.name ?? "No calendar selected"}
                  </strong>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working || !status.accountMatches}
                  onClick={() => void perform("calendars", loadCalendars)}
                >
                  {busy === "calendars" ? (
                    <Loader2 size={15} className="spin" aria-hidden="true" />
                  ) : (
                    <CalendarDays size={15} aria-hidden="true" />
                  )}
                  {status.calendar ? "Change" : "Choose calendar"}
                </button>
              </div>
            )}

            {status.calendar ? (
              <div className="calendar-connection-row calendar-connection-sync-settings">
                <label className="calendar-connection-toggle">
                  <span className="calendar-connection-row-copy">
                    <strong id={autoSyncLabelId}>Automatic sync</strong>
                    <span
                      id={autoSyncDescriptionId}
                      className="calendar-connection-hint"
                    >
                      Every 5 minutes while CorosLink is running.
                    </span>
                  </span>
                  <span className="calendar-connection-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-labelledby={autoSyncLabelId}
                      aria-describedby={autoSyncDescriptionId}
                      checked={status.autoSync}
                      disabled={working || !status.accountMatches}
                      onChange={(event) =>
                        void perform("settings", async () => {
                          await adapter.updateSettings({
                            autoSync: event.target.checked,
                          });
                        })
                      }
                    />
                    <span
                      className="calendar-connection-switch-track"
                      aria-hidden="true"
                    />
                  </span>
                </label>
              </div>
            ) : null}
            {status.calendar && !choosingCalendar ? (
              <div className="calendar-connection-footer">
                <div className="calendar-connection-row-copy">
                  <span className="calendar-connection-label">
                    {syncState === "syncing"
                      ? "Syncing workouts…"
                      : "Last synced"}
                  </span>
                  {lastSynced ? (
                    <time
                      dateTime={status.lastSyncedAt}
                      title={new Date(status.lastSyncedAt!).toLocaleString()}
                    >
                      {lastSynced}
                    </time>
                  ) : (
                    <span className="calendar-connection-hint">
                      No successful sync yet
                    </span>
                  )}
                </div>
                <button
                  className={`secondary-button calendar-connection-sync-button${syncState === "synced" ? " is-synced" : ""}`}
                  type="button"
                  disabled={working || !status.accountMatches}
                  onClick={() => void sync(false)}
                >
                  {syncState === "synced" ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <RefreshCw
                      size={15}
                      className={syncState === "syncing" ? "spin" : ""}
                      aria-hidden="true"
                    />
                  )}
                  {syncState === "syncing"
                    ? "Syncing…"
                    : syncState === "synced"
                      ? "Synced"
                      : "Sync now"}
                </button>
              </div>
            ) : null}
            {!status.accountMatches && isGoogle ? (
              <button
                className="secondary-button"
                type="button"
                disabled={working}
                onClick={() => void connect()}
              >
                Reconnect account
              </button>
            ) : null}
          </>
        ) : status ? (
          <>
            {!isGoogle ? (
              <form
                id={connectFormId}
                className="calendar-connection-setup"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <p className="calendar-connection-hint">
                  Connect the iCloud account you use in Apple Calendar. Enable
                  iCloud Calendar on your Apple devices to see synced workouts
                  there.
                </p>
                <label className="field">
                  Apple Account email
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={appleEmail}
                    disabled={working}
                    onChange={(event) => setAppleEmail(event.target.value)}
                  />
                </label>
                {suggestedEmail && appleEmail !== suggestedEmail ? (
                  <button type="button" className="secondary-button account-email-suggestion" disabled={working} onClick={() => setAppleEmail(suggestedEmail)}>
                    Use COROS email · {suggestedEmail}
                  </button>
                ) : null}
                <label className="field">
                  App-specific password
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={appPassword}
                    disabled={working}
                    onChange={(event) => setAppPassword(event.target.value)}
                  />
                </label>
                <a
                  href="https://support.apple.com/102654"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create an app-specific password{" "}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <p className="calendar-connection-hint">
                  Use a password generated for CorosLink in your Apple Account’s
                  Sign-In and Security settings. It is encrypted on this
                  computer.
                </p>
              </form>
            ) : null}
            <div className="calendar-connection-actions">
              <button
                className="primary-button"
                type={isGoogle ? "button" : "submit"}
                form={isGoogle ? undefined : connectFormId}
                disabled={
                  working ||
                  (isGoogle
                    ? !status.configured
                    : !appleEmail.trim() || !appPassword.trim())
                }
                onClick={isGoogle ? () => void connect() : undefined}
              >
                {connecting ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <CalendarDays size={15} aria-hidden="true" />
                )}
                {connecting
                  ? isGoogle
                    ? "Waiting for Google sign-in…"
                    : "Connecting to iCloud…"
                  : `Connect ${providerName}`}
              </button>
              {connecting ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void adapter
                      .cancelConnect()
                      .catch((error) => setError(errorMessage(error)))
                  }
                >
                  Cancel sign-in
                </button>
              ) : null}
              {isGoogle && status.configured ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working}
                  onClick={() => setSetupOpen((open) => !open)}
                >
                  App setup
                </button>
              ) : null}
            </div>
            {isGoogle && (setupOpen || !status.configured) ? (
              <form className="calendar-connection-setup" onSubmit={saveConfig}>
                <h3>Google app setup</h3>
                <p className="calendar-connection-hint">
                  Enable the Google Calendar API in your Google Cloud project,
                  then create an OAuth client of type{" "}
                  <strong>Desktop app</strong>. If your app is in testing, add
                  your Google account as a test user.
                </p>
                <a
                  href="https://developers.google.com/identity/protocols/oauth2/native-app#prerequisites"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google setup instructions{" "}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <label className="field">
                  Client ID
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={clientId}
                    disabled={working}
                    placeholder="…apps.googleusercontent.com"
                    onChange={(event) => setClientId(event.target.value)}
                  />
                </label>
                <label className="field">
                  Client secret (if provided by Google)
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={clientSecret}
                    disabled={working}
                    onChange={(event) => setClientSecret(event.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={working || !clientId.trim()}
                >
                  Save app setup
                </button>
              </form>
            ) : null}
          </>
        ) : null}

        {error || status?.error ? (
          <p className="calendar-error" role="alert">
            {error || status?.error}
          </p>
        ) : null}
        {message ? (
          <p className="calendar-connection-success" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function CalendarConnections({ api, initialProvider = "google", suggestedEmail }: { api: CorosLinkApi; initialProvider?: CalendarProvider; suggestedEmail?: string }) {
  const [provider, setProvider] = useState<CalendarProvider>(initialProvider);
  return (
    <div className="calendar-connections">
      <div className="calendar-connections-header">
        <div className="calendar-connections-title">
          <h2>Calendar sync</h2>
          <p>Keep planned workouts alongside the rest of your day.</p>
        </div>
        <div
          className="calendar-provider-tabs"
          role="group"
          aria-label="Calendar provider"
        >
          <button
            type="button"
            aria-pressed={provider === "google"}
            onClick={() => setProvider("google")}
          >
            Google Calendar
          </button>
          <button
            type="button"
            aria-pressed={provider === "apple"}
            onClick={() => setProvider("apple")}
          >
            Apple Calendar
          </button>
        </div>
      </div>
      <CalendarConnection key={provider} api={api} provider={provider} suggestedEmail={suggestedEmail} />
    </div>
  );
}

export function CalendarConnectionsDialog({
  api,
  onClose,
}: {
  api: CorosLinkApi;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      className="calendar-connection-dialog"
      ref={dialog}
      aria-label="Connect your calendar"
      onCancel={onClose}
    >
      <button
        type="button"
        className="icon-button calendar-connection-close"
        aria-label="Close calendar connection"
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <CalendarConnections api={api} />
    </dialog>
  );
}
