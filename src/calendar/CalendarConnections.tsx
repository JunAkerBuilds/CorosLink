import { useLanguage, t, getLocale } from "../i18n/training";
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
  CalendarEventTiming,
} from "../../electron/calendarSyncTypes";
import { defaultCalendarEventTiming } from "../../electron/calendarSyncTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { calendarSyncButtonState } from "./calendarSyncStatus";
import "./calendarConnections.css";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : t("Could not connect your calendar. Try again.");
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
  useLanguage();
  const isGoogle = provider === "google";
  const providerName = isGoogle ? "Google Calendar" : "Apple Calendar";
  const destinationName = isGoogle ? "Google" : "iCloud";
  const connectFormId = useId();
  const autoSyncLabelId = useId();
  const autoSyncDescriptionId = useId();
  const timeZonesId = useId();
  const defaultTiming = useMemo(defaultCalendarEventTiming, []);
  const timeZones = useMemo(() => [...new Set([defaultTiming.timeZone, "UTC", ...Intl.supportedValuesOf("timeZone")])], [defaultTiming]);
  const [timingDraft, setTimingDraft] = useState<CalendarEventTiming | null>(null);
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
          t("No editable calendars were found. Connect an account with permission to edit a {{value1}} calendar.", { value1: String(destinationName) }),
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
      setMessage(t("Google Calendar is ready to connect."));
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
        t("Calendar synced: {{value1}} added, {{value2}} updated, {{value3}} removed.", { value1: String(result.created), value2: String(result.updated), value3: String(result.deleted) }),
      );
    });
  }

  const working = Boolean(busy || status?.syncing || status?.connecting);
  const savedTiming = status?.eventTiming ?? defaultTiming;
  const timing = timingDraft ?? savedTiming;
  const timingChanged = JSON.stringify(timing) !== JSON.stringify(savedTiming);
  const changeTiming = (patch: Partial<CalendarEventTiming>) => setTimingDraft({ ...timing, ...patch });
  const connecting = busy === "connect" || status?.connecting;
  const choosingCalendar = calendars.length > 0;
  const lastSynced = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString(getLocale(), {
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
      aria-label={t("{{value1}} connection", { value1: String(providerName) })}
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
                <Check size={13} aria-hidden="true" /> {t("Connected")} </span>
            ) : null}
          </div>
        </div>
        <p className="calendar-connection-hint">
          {t("Your scheduled workouts appear in")} {destinationName}{t(", from the past 7 days through the next 90 days.")} </p>
        <p className="calendar-connection-hint">
          {t("Choose all-day events or timed workout blocks. Calendar edits won’t update your COROS training plan.")} </p>
      </div>

      <div className="calendar-connection-content">
        {!status && !error ? (
          <p className="calendar-connection-loading" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" /> {t("Loading calendar connection…")} </p>
        ) : null}

        {status?.connected ? (
          <>
            <div className="calendar-connection-row calendar-connection-account">
              <div className="calendar-connection-row-copy">
                <span className="calendar-connection-label">{t("Account")}</span>
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
                      t("{{value1}} disconnected. Previously synced events remain in your calendar.{{value2}}", { value1: String(providerName), value2: String(isGoogle ? "" : t(" You can also revoke the app-specific password at account.apple.com.")) }),
                    );
                  })
                }
              >
                {busy === "disconnect" ? t("Disconnecting…") : t("Disconnect")}
              </button>
            </div>
            {!status.accountMatches ? (
              <p className="calendar-error">
                {t("Sync is paused. Sign in to the linked COROS account, or disconnect and reconnect")} {providerName} {t("for your current account.")} </p>
            ) : null}

            {choosingCalendar ? (
              <div className="calendar-connection-destination calendar-connection-row">
                <label className="field">
                  {t("Destination calendar")} <select
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                    disabled={working}
                  >
                    {calendars.map((calendar) => (
                      <option value={calendar.id} key={calendar.id}>
                        {calendar.name}
                        {calendar.primary ? t(" (primary)") : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {status.calendar && status.calendar.id !== selected ? (
                  <p className="calendar-connection-hint">
                    {t("Previously synced events stay in the old calendar. New syncs will use the selected calendar.")} </p>
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
                      ? t("Save and sync")
                      : t("Start syncing")}
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
                    {t("Cancel")} </button>
                </div>
              </div>
            ) : (
              <div className="calendar-connection-row">
                <div className="calendar-connection-row-copy">
                  <span className="calendar-connection-label">
                    {t("Destination calendar")} </span>
                  <strong>
                    {status.calendar?.name ?? t("No calendar selected")}
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
                  {status.calendar ? t("Change") : t("Choose calendar")}
                </button>
              </div>
            )}

            {status.calendar ? (
              <form
                className="calendar-event-timing calendar-connection-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform("timing", async () => {
                    await adapter.updateSettings({ eventTiming: timing });
                    if (mounted.current) setTimingDraft(null);
                    const result = await adapter.sync();
                    if (mounted.current) setMessage(t("Event preferences saved. {{value1}} added, {{value2}} updated, {{value3}} removed.", { value1: String(result.created), value2: String(result.updated), value3: String(result.deleted) }));
                  });
                }}
              >
                <div className="calendar-connection-row-copy">
                  <strong>{t("Workout events")}</strong>
                  <p className="calendar-connection-hint">{t("Choose how workouts fit into your calendar.")}</p>
                </div>
                <fieldset disabled={working || !status.accountMatches}>
                  <label className="field">
                    {t("Event type")} <select value={timing.mode} onChange={(event) => changeTiming({ mode: event.target.value as CalendarEventTiming["mode"] })}>
                      <option value="all-day">{t("All-day events")}</option>
                      <option value="timed">{t("Timed events")}</option>
                    </select>
                  </label>
                  {timing.mode === "timed" ? (
                    <>
                      <div className="calendar-event-time-fields">
                        <label className="field">
                          {t("Default start time")} <input type="time" required value={timing.startTime} onChange={(event) => changeTiming({ startTime: event.target.value })} />
                        </label>
                        <label className="field">
                          {t("Default end time")} <input type="time" required value={timing.endTime} onChange={(event) => changeTiming({ endTime: event.target.value })} />
                        </label>
                      </div>
                      <label className="field">
                        {t("Time zone")} <input type="text" required list={timeZonesId} value={timing.timeZone} onChange={(event) => changeTiming({ timeZone: event.target.value })} />
                        <datalist id={timeZonesId}>{timeZones.map(zone => <option key={zone} value={zone} />)}</datalist>
                      </label>
                      <p className="calendar-connection-hint">
                        {t("Choose the start and end times for your events. Move or resize individual events in")} {providerName}{t("; sync keeps those times when workout details change.")} </p>
                      {timing.endTime <= timing.startTime ? <p className="calendar-connection-hint">{t("End time is on the following day.")}</p> : null}
                    </>
                  ) : null}
                  {timingChanged ? (
                    <p className="calendar-connection-hint">
                      {t("Saving updates synced workouts without individual event settings in the past 7 and next 90 days. Rescheduling a workout in CorosLink also reapplies its time.")} </p>
                  ) : null}
                  <div className="calendar-connection-actions">
                    <button type="submit" className="primary-button" disabled={!timingChanged}>
                      {busy === "timing" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
                      {t("Save event preferences and sync")} </button>
                    {timingChanged ? <button type="button" className="calendar-connection-text-button" onClick={() => setTimingDraft(null)}>{t("Cancel")}</button> : null}
                  </div>
                </fieldset>
              </form>
            ) : null}

            {status.calendar ? (
              <div className="calendar-connection-row calendar-connection-sync-settings">
                <label className="calendar-connection-toggle">
                  <span className="calendar-connection-row-copy">
                    <strong id={autoSyncLabelId}>{t("Automatic sync")}</strong>
                    <span
                      id={autoSyncDescriptionId}
                      className="calendar-connection-hint"
                    >
                      {t("Every 5 minutes while CorosLink is running.")} </span>
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
                      ? t("Syncing workouts…")
                      : t("Last synced")}
                  </span>
                  {lastSynced ? (
                    <time
                      dateTime={status.lastSyncedAt}
                      title={new Date(status.lastSyncedAt!).toLocaleString(getLocale())}
                    >
                      {lastSynced}
                    </time>
                  ) : (
                    <span className="calendar-connection-hint">
                      {t("No successful sync yet")} </span>
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
                    ? t("Syncing…")
                    : syncState === "synced"
                      ? t("Synced")
                      : t("Sync now")}
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
                {t("Reconnect account")} </button>
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
                  {t("Connect the iCloud account you use in Apple Calendar. Enable iCloud Calendar on your Apple devices to see synced workouts there.")} </p>
                <label className="field">
                  {t("Apple Account email")} <input
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
                    {t("Use COROS email ·")} {suggestedEmail}
                  </button>
                ) : null}
                <label className="field">
                  {t("App-specific password")} <input
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
                  {t("Create an app-specific password")}{" "}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <p className="calendar-connection-hint">
                  {t("Use a password generated for CorosLink in your Apple Account’s Sign-In and Security settings. It is encrypted on this computer.")} </p>
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
                    ? t("Waiting for Google sign-in…")
                    : t("Connecting to iCloud…")
                  : t("Connect {{value1}}", { value1: String(providerName) })}
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
                  {t("Cancel sign-in")} </button>
              ) : null}
              {isGoogle && status.configured ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={working}
                  onClick={() => setSetupOpen((open) => !open)}
                >
                  {t("App setup")} </button>
              ) : null}
            </div>
            {isGoogle && (setupOpen || !status.configured) ? (
              <form className="calendar-connection-setup" onSubmit={saveConfig}>
                <h3>{t("Google app setup")}</h3>
                <p className="calendar-connection-hint">
                  {t("Enable the Google Calendar API in your Google Cloud project, then create an OAuth client of type")}{" "}
                  <strong>{t("Desktop app")}</strong>{t(". If your app is in testing, add your Google account as a test user.")} </p>
                <a
                  href="https://developers.google.com/identity/protocols/oauth2/native-app#prerequisites"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Google setup instructions")}{" "}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
                <label className="field">
                  {t("Client ID")} <input
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
                  {t("Client secret (if provided by Google)")} <input
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
                  {t("Save app setup")} </button>
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
            {t(message)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function CalendarConnections({ api, initialProvider = "google", suggestedEmail }: { api: CorosLinkApi; initialProvider?: CalendarProvider; suggestedEmail?: string }) {
  useLanguage();
  const [provider, setProvider] = useState<CalendarProvider>(initialProvider);
  return (
    <div className="calendar-connections">
      <div className="calendar-connections-header">
        <div className="calendar-connections-title">
          <h2>{t("Calendar sync")}</h2>
          <p>{t("Keep planned workouts alongside the rest of your day.")}</p>
        </div>
        <div
          className="calendar-provider-tabs"
          role="group"
          aria-label={t("Calendar provider")}
        >
          <button
            type="button"
            aria-pressed={provider === "google"}
            onClick={() => setProvider("google")}
          >
            {t("Google Calendar")} </button>
          <button
            type="button"
            aria-pressed={provider === "apple"}
            onClick={() => setProvider("apple")}
          >
            {t("Apple Calendar")} </button>
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
  useLanguage();
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
      aria-label={t("Connect your calendar")}
      onCancel={onClose}
    >
      <button
        type="button"
        className="icon-button calendar-connection-close"
        aria-label={t("Close calendar connection")}
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <CalendarConnections api={api} />
    </dialog>
  );
}
