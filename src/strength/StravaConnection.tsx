import { renderLocalizedText, type LocalizableText, t, useLanguage, getLocale } from "../i18n/training";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, Link2, Loader2 } from "lucide-react";
import type { StravaStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import "./stravaConnection.css";

const STRAVA_API_SETTINGS_URL = "https://www.strava.com/settings/api";

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function formatSyncTime(value?: string): string {
  if (!value) return t("Not synced yet");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Not synced yet")
    : t("Last synced {{time}}", { time: date.toLocaleString(getLocale(), {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }) });
}

/**
 * Strava sign-in for gym sessions, shared by the Strength dialog and the
 * Accounts settings page. Credentials go straight to the main process; the
 * page never sees the secret or the tokens again.
 */
export function StravaConnection({
  api,
  onStatusChange,
  onDone
}: {
  api: CorosLinkApi;
  onStatusChange?: (status: StravaStatus) => void;
  /** Shown as a "Done" action when the panel lives in a dialog. */
  onDone?: () => void;
}) {
  useLanguage();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LocalizableText | null>(null);
  const startedConnectRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const applyStatus = useCallback((next: StravaStatus) => {
    setStatus(next);
    onStatusChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    let active = true;
    api.getStravaStatus().then(
      (next) => {
        if (!active) return;
        applyStatus(next);
        setClientId(next.clientId ?? "");
      },
      (caught) => {
        if (active) setError(toErrorMessage(caught));
      }
    );
    return () => {
      active = false;
    };
  }, [api, applyStatus]);

  // A sign-in started elsewhere (the other surface) finishes in the main
  // process; follow it until it settles.
  const connecting = Boolean(status?.connecting);
  useEffect(() => {
    if (!connecting || startedConnectRef.current) return;
    const timer = window.setInterval(() => {
      void api.getStravaStatus().then(applyStatus, () => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [api, applyStatus, connecting]);

  // Closing the surface that opened the browser abandons that sign-in rather
  // than leaving a callback listener behind it.
  useEffect(
    () => () => {
      if (startedConnectRef.current) void api.cancelStravaConnect();
    },
    [api]
  );

  const connect = useCallback(async () => {
    setError(null);
    startedConnectRef.current = true;
    setStatus((current) => (current ? { ...current, connecting: true } : current));
    try {
      applyStatus(await api.connectStrava());
    } catch (caught) {
      const message = toErrorMessage(caught);
      if (!/cancelled/i.test(message)) setError(message);
      void api.getStravaStatus().then(applyStatus, () => undefined);
    } finally {
      startedConnectRef.current = false;
    }
  }, [api, applyStatus]);

  const saveAndConnect = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const saved = await api.saveStravaConfig({ clientId, clientSecret });
        applyStatus(saved);
        setClientSecret("");
        setEditing(false);
        if (!saved.connected) void connect();
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [api, applyStatus, clientId, clientSecret, connect]
  );

  const disconnect = useCallback(async () => {
    if (!window.confirm(t("Disconnect Strava and erase its cached gym sessions from this device?"))) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.disconnectStrava();
      applyStatus(await api.getStravaStatus());
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [api, applyStatus]);

  const errorBlock = error ? (
    <p className="strava-connection-error" role="alert">
      {renderLocalizedText(error)}
    </p>
  ) : null;

  if (!status) {
    return (
      <div className="strava-connection">
        {errorBlock ?? (
          <p className="strava-connection-copy" role="status">{t("Checking Strava…")}</p>
        )}
      </div>
    );
  }

  if (status.connecting) {
    return (
      <div className="strava-connection">
        <p className="strava-connection-waiting" role="status">
          <Loader2 className="spin" size={16} aria-hidden="true" />
          {t("Approve CorosLink in the browser window that just opened.")}</p>
        <p className="strava-connection-copy">{t("This updates by itself once you select Authorize on Strava.")}</p>
        <div className="strava-connection-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void api.cancelStravaConnect()}
          >{t("Cancel")}</button>
        </div>
        {errorBlock}
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="strava-connection">
        <div className="strava-connection-account">
          <span className="strava-connection-mark" aria-hidden="true">S</span>
          <div>
            <strong>{status.displayName || t("Strava athlete")}</strong>
            <span>{formatSyncTime(status.lastSyncedAt)}</span>
          </div>
          {status.profileUrl ? (
            <a href={status.profileUrl} target="_blank" rel="noreferrer">
              {t("View on Strava")}<ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {!status.canReadPrivate ? (
          <p className="strava-connection-warning" role="note">{t("Gym sessions set to Only You are hidden. Disconnect, connect again and keep “View data about your private activities” ticked.")}</p>
        ) : null}
        <p className="strava-connection-copy">{t("Weight Training, CrossFit, HIIT and Workout activities appear in Strength. Strava's API does not share the Exercises tab, so they bring time, heart rate, calories, Relative Effort and your notes; sets and reps still come from COROS or Hevy.")}</p>
        <p className="strava-connection-copy">{t("CorosLink only reads activities. It never posts to Strava.")}</p>
        <div className="strava-connection-actions is-split">
          <button
            type="button"
            className="secondary-button strava-connection-danger"
            disabled={busy}
            onClick={() => void disconnect()}
          >{t("Disconnect and erase cache")}</button>
          {onDone ? (
            <button type="button" className="primary-button" disabled={busy} onClick={onDone}>{t("Done")}</button>
          ) : null}
        </div>
        {errorBlock}
      </div>
    );
  }

  if (status.configured && !editing) {
    return (
      <div className="strava-connection">
        <div className="strava-connection-account">
          <span className="strava-connection-mark" aria-hidden="true">S</span>
          <div>
            <strong>{t("Strava API app {{p0}}", { p0: String(status.clientId) })}</strong>
            <span>{t("Ready to connect")}</span>
          </div>
          <button
            type="button"
            className="strava-connection-text-button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
          >{t("Edit")}</button>
        </div>
        <p className="strava-connection-copy">{t("Strava opens in your browser to approve access. Keep “View data about your private activities” ticked so gym sessions set to Only You are included.")}</p>
        <div className="strava-connection-actions">
          <button type="button" className="primary-button" onClick={() => void connect()}>
            <Link2 size={16} aria-hidden="true" />
            {t("Connect with Strava")}</button>
        </div>
        {errorBlock}
      </div>
    );
  }

  return (
    <form className="strava-connection" onSubmit={saveAndConnect}>
      <p className="strava-connection-copy">{t("Strava connects through your own API application. Copy its Client ID and Client Secret from the Strava API settings page.")}</p>
      <a
        className="strava-connection-link"
        href={STRAVA_API_SETTINGS_URL}
        target="_blank"
        rel="noreferrer"
      >
        {t("Open Strava API settings")}<ExternalLink size={14} aria-hidden="true" />
      </a>
      <label className="field">
        <span>{t("Client ID")}</span>
        <input
          value={clientId}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="123456"
          disabled={busy}
          onChange={(event) => setClientId(event.target.value)}
        />
      </label>
      <label className="field">
        <span>{t("Client Secret")}</span>
        <input
          type="password"
          value={clientSecret}
          autoComplete="off"
          spellCheck={false}
          placeholder={status.configured ? t("Saved — leave blank to keep it") : t("Paste Client Secret")}
          disabled={busy}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      </label>
      <p className="strava-connection-copy">{t("The secret and sign-in tokens are encrypted with your operating system's credential storage. Strava now requires an active Strava subscription for personal API applications.")}</p>
      <div className="strava-connection-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !clientId.trim() || (!status.configured && !clientSecret.trim())}
        >
          {busy ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <Link2 size={16} aria-hidden="true" />
          )}
          {t("Save and connect")}</button>
        {status.configured ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setClientSecret("");
              setClientId(status.clientId ?? "");
              setError(null);
            }}
          >{t("Cancel")}</button>
        ) : null}
      </div>
      {errorBlock}
    </form>
  );
}
