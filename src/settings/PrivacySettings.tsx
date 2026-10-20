import { localizedText, renderLocalizedText, type LocalizableText, t, useLanguage, formatDate, formatNumber } from "../i18n";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertCircle, Archive, CheckCircle2, ChevronRight, Cloud, Download, FileInput, FolderOpen, HardDrive, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2, Watch, XCircle
} from "lucide-react";
import type { DataModeStatus, NetworkAccessReport } from "../../electron/privacy/dataModeTypes";
import type { LocalDataOverview, WatchSyncProbe } from "../../electron/localSync/localDataTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { ipcErrorText } from "../ipcErrorText";
import { formatBytes } from "../media/libraryUtils";
import { WatchSyncResult } from "../watch/WatchSyncResult";
import { runWatchSync, useWatchSync } from "../watch/watchSyncState";
import "./settingsPanel.css";
import "./privacySettings.css";
import "./watchSystemSettings.css";

type Busy = "mode" | "steps" | "probe" | "import" | "folder" | "backup" | "restore" | "report" | null;
/** Where a message shows: under the section whose button caused it. */
type Section = "mode" | "watch" | "import" | "backup" | "report";
type Mode = "connected" | "local";
const MODES: readonly Mode[] = ["connected", "local"];

function formatWhen(iso?: string): string {
  return iso ? formatDate(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : t("Never");
}

/** "4 activities imported · Already here: 2", without "(s)" plurals. */
function countText(count: number, one: string, many: string, extras: Array<[number, string]>): string {
  const head = count === 1 ? t(one) : t(many, { value0: count });
  const tail = extras.filter(([value]) => value > 0).map(([value, label]) => t(label, { value0: value }));
  return [head, ...tail].join(" · ");
}

function Notice({ message }: { message: { text: LocalizableText; error: boolean } | null }) {
  useLanguage();
  if (!message) return null;
  const Icon = message.error ? AlertCircle : CheckCircle2;
  return (
    <p className={`watch-menu-result ${message.error ? "is-error" : "is-success"}`} role={message.error ? "alert" : "status"}>
      <Icon size={15} aria-hidden="true" /><span>{renderLocalizedText(message.text)}</span>
    </p>
  );
}

export function PrivacySettings({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const [status, setStatus] = useState<DataModeStatus | null>(null);
  const [overview, setOverview] = useState<LocalDataOverview | null>(null);
  const [probe, setProbe] = useState<WatchSyncProbe | null>(null);
  const [report, setReport] = useState<NetworkAccessReport | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ section: Section; text: LocalizableText; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [retainWatchKey, setRetainWatchKey] = useState(true);
  const [forgetCloudSession, setForgetCloudSession] = useState(false);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [restorePrompt, setRestorePrompt] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const watchSync = useWatchSync(api);
  const syncing = watchSync.manual || watchSync.reading;
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const refreshOverview = useCallback(async () => {
    setOverview(await api.getLocalDataOverview());
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.getDataModeStatus().then(next => { if (active) setStatus(next); }).catch(() => undefined);
    void refreshOverview().catch(() => undefined);
    const offMode = api.onDataModeChange(next => { if (active) setStatus(next); });
    // A sync started from the toolbar's watch menu also lands here; refresh the counts when it ends.
    const offSync = api.onWatchSyncProgress(next => {
      if (active && (next.state === "done" || next.state === "failed" || next.state === "cancelled")) void refreshOverview().catch(() => undefined);
    });
    return () => { active = false; offMode(); offSync(); };
  }, [api, refreshOverview]);

  async function run(kind: Exclude<Busy, null>, section: Section, task: () => Promise<LocalizableText | void>) {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await task();
      if (result) setMessage({ section, text: result, error: false });
    } catch (caught) {
      setMessage({ section, text: ipcErrorText(caught), error: true });
    } finally {
      setBusy(null);
      void refreshOverview().catch(() => undefined);
    }
  }

  const localOnly = status?.mode === "local_only";
  const enforcing = status?.enforcing === true;
  const current: Mode = localOnly ? "local" : "connected";
  const modeLocked = busy !== null || !status;

  const activate = () => run("mode", "mode", async () => {
    const next = await api.activateLocalOnlyMode({ retainWatchKey, forgetCloudSession });
    setStatus(next);
    setConfirming(false);
    return next.phase === "degraded"
      ? localizedText(() => t("Local-Only Mode is on, but part of turning it on failed."))
      : localizedText(() => t("Local-Only Mode is on."));
  });

  /** Picking the other mode asks first: Local-Only below the cards, Connected in a dialog (it restarts CorosLink). */
  const choose = (mode: Mode) => {
    if (modeLocked) return;
    if (mode === current) { setConfirming(false); return; }
    if (mode === "local") { setConfirming(true); return; }
    void run("mode", "mode", async () => { setStatus(await api.returnToConnectedMode()); });
  };

  // Arrow keys, Home and End move between the two modes, like native radio buttons.
  const modeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.indexOf(current === "local" && confirming ? "local" : current);
    const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: MODES.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = (next + MODES.length) % MODES.length;
    modeRefs.current[target]?.focus();
    choose(MODES[target]!);
  };

  const statusLine = !status ? t("Loading…")
    : status.phase === "activating" ? t("Turning on Local-Only Mode…")
    : status.phase === "restart-required" ? t("Connected Mode is saved. CorosLink is restarting.")
    : status.phase === "degraded" ? t("Local-Only Mode is on, but part of turning it on failed.")
    // The selected mode card already says which mode is on.
    : null;

  const notice = (section: Section) => <Notice message={message?.section === section ? message : null} />;
  const syncLabel = !syncing ? t("Sync watch now")
    : watchSync.percent === null ? t("Syncing…") : t("Syncing… {{p0}}%", { p0: watchSync.percent });
  // After a sync, the counts are read again.
  const syncNow = () => { setMessage(null); void runWatchSync(api).then(refreshOverview).catch(() => undefined); };
  const shortPassphrase = backupPassphrase.length > 0 && backupPassphrase.length < 8;

  const modeCard = (mode: Mode, index: number) => {
    const checked = current === mode;
    return (
      <button key={mode} ref={element => { modeRefs.current[index] = element; }} type="button" role="radio" aria-checked={checked}
        className={checked ? "is-active" : undefined} tabIndex={checked ? 0 : -1} disabled={!status} aria-disabled={busy !== null && !checked ? true : undefined}
        onClick={() => choose(mode)}>
        <span className="settings-unit-radio" aria-hidden="true" />
        {mode === "local" ? <HardDrive size={18} aria-hidden="true" /> : <Cloud size={18} aria-hidden="true" />}
        <span>
          <strong>{mode === "local" ? t("Local-Only Mode") : t("Connected Mode")}</strong>
          <small>{mode === "local" ? t("Nothing is uploaded to COROS.")
            : t("Workouts, plans, schedules, gear, watch faces and activity imports can be saved to your COROS account.")}</small>
        </span>
      </button>
    );
  };

  return (
    <section className="panel settings-units-panel settings-panel privacy-settings" aria-labelledby="privacy-title">
      <div className="settings-units-heading">
        <span className="settings-units-icon" aria-hidden="true"><ShieldCheck size={22} /></span>
        <div>
          <p className="eyebrow">{t("Data mode")}</p>
          <h2 id="privacy-title">{t("Privacy & local data")}</h2>
          {statusLine ? <p>{statusLine}</p> : null}
        </div>
      </div>

      <div className="privacy-modes" role="radiogroup" aria-label={t("Data mode")} onKeyDown={modeKey}>
        {MODES.map(modeCard)}
      </div>

      {confirming && !localOnly ? (
        <div className="privacy-confirm">
          <label>
            <input type="checkbox" checked={retainWatchKey} onChange={event => setRetainWatchKey(event.target.checked)} />
            {t("Keep the saved watch key (needed to connect your watch without the COROS app)")}
          </label>
          <label>
            <input type="checkbox" checked={forgetCloudSession} onChange={event => setForgetCloudSession(event.target.checked)} />
            {t("Remove my COROS sign-in from this computer")}
          </label>
          <p className="settings-hint">{t("Local-Only Mode starts empty: it shows what you sync from the watch or import. Your COROS workouts, calendar and activities stay in your COROS account and show again in Connected Mode.")}</p>
          <p className="settings-hint">{t("Data already uploaded to COROS stays in your COROS account. To keep new data off COROS, turn off the watch's Wi-Fi and don't sync it with the COROS app.")}</p>
          <p className="settings-hint">{t("Without COROS, Strava and TrainingPeaks stop receiving your activities, and the watch gets no firmware updates.")}</p>
          <div className="privacy-actions">
            <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void activate()}>
              {busy === "mode" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
              {t("Turn on Local-Only Mode")}
            </button>
            <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => setConfirming(false)}>{t("Cancel")}</button>
          </div>
        </div>
      ) : null}
      {notice("mode")}

      {status?.failedServices.length ? (
        <ul className="privacy-failures" aria-label={t("What failed")}>
          {status.failedServices.map(failure => <li key={failure.id}><XCircle size={14} aria-hidden="true" /> {t(failure.label)}: {failure.error}</li>)}
        </ul>
      ) : null}

      {/* What a sync or an import adds shows only in Local-Only Mode, so they're offered only there. */}
      {localOnly ? <div className="privacy-section">
        <h3><Watch size={16} aria-hidden="true" /> {t("Watch and local data")}</h3>
        <dl className="privacy-facts">
          <div><dt>{t("Watch key")}</dt><dd>{overview ? (overview.watchKeySaved ? t("Saved on this computer") : t("Not saved. Sign in to COROS once to save it.")) : "—"}</dd></div>
          <div><dt>{t("Watch")}</dt><dd>{overview ? (overview.watchConnected ? (overview.watchName ?? t("Connected")) : t("Not connected")) : "—"}</dd></div>
          <div><dt>{t("Last watch sync")}</dt><dd>{formatWhen(overview?.lastActivitySync?.finishedAt)}</dd></div>
          <div><dt>{t("Activities on this computer")}</dt><dd>{overview ? formatNumber(overview.activities.total) : "—"}
            {overview?.activities.total ? <small>{t("From the watch: {{value0}} · Imported: {{value1}}", { value0: formatNumber(overview.activities.fromWatch), value1: formatNumber(overview.activities.imported) })}</small> : null}</dd></div>
          <div><dt>{t("Days of health data")}</dt><dd>{overview ? formatNumber(overview.healthDays) : "—"}</dd></div>
          <div><dt>{t("Local storage")}</dt><dd>{overview ? formatBytes(overview.storageBytes) : "—"}</dd></div>
        </dl>
        {/* Only when Sync watch now is unavailable: what to do about it. */}
        {overview && overview.watchSyncSupport !== "experimental" ? (
          <p className="settings-hint">
            {!overview.watchConnected
              ? t("To sync, connect your watch from the watch menu in the toolbar.")
              : t(overview.watchSyncUnsupportedReason ?? "Connect and authenticate your watch first.")}
          </p>
        ) : null}
        <div className="privacy-actions">
          <button type="button" className={`primary-button privacy-sync-button${syncing ? " is-busy" : ""}`}
            disabled={busy !== null || syncing || overview?.watchSyncSupport !== "experimental"} onClick={syncNow}>
            {syncing ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
            <span aria-live="polite">{syncLabel}</span>
            {syncing && watchSync.percent !== null ? <span className="watch-menu-sync-meter" style={{ width: `${watchSync.percent}%` }} aria-hidden="true" /> : null}
          </button>
          {syncing ? (
            <button type="button" className="secondary-button" onClick={() => void api.cancelWatchSync()}>{t("Cancel sync")}</button>
          ) : null}
        </div>
        {watchSync.last && !syncing ? <WatchSyncResult api={api} last={watchSync.last} disabled={busy !== null} onSync={syncNow} /> : null}
        {notice("watch")}
        {overview?.captureEnabled ? (
          <div className="privacy-capture">
            <p className="settings-hint">{t("Developer capture is on. Every watch-sync frame is saved to {{value0}}.", { value0: overview.captureDirectory ?? "" })}</p>
            <div className="privacy-actions">
              <button type="button" className="secondary-button" disabled={busy !== null || syncing || overview.watchSyncSupport !== "experimental"}
                onClick={() => void run("probe", "watch", async () => { setProbe(await api.probeWatchSync()); })}>
                {busy === "probe" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Watch size={15} aria-hidden="true" />}
                {t("Probe watch records")}
              </button>
              <button type="button" className="secondary-button" disabled={busy !== null || syncing || !overview.watchConnected}
                onClick={() => void run("steps", "watch", async () => { await api.readWatchDayTotals(); return localizedText(() => t("Today's steps were read from the watch.")); })}>
                {busy === "steps" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Watch size={15} aria-hidden="true" />}
                {t("Read today's steps")}
              </button>
            </div>
            {probe ? (
              <p className="privacy-progress" role="status">
                {probe.ok
                  ? t("The watch reports {{value0}} bytes of activity records; the first block is {{value1}} bytes ({{value2}}). Nothing was acknowledged.", { value0: probe.totalBytes ?? 0, value1: probe.blockBytes ?? 0, value2: probe.looksLike ?? "unknown" })
                  : t("Probe failed: {{value0}}", { value0: probe.error ?? "" })}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="privacy-actions">
          <button type="button" className="secondary-button" disabled={busy !== null}
            onClick={() => void run("import", "import", async () => {
              const result = await api.importLocalFitFiles(false);
              return localizedText(() => countText(result.imported, "1 activity imported", "{{value0}} activities imported", [[result.duplicates, "Already here: {{value0}}"], [result.failed.length, "Couldn't import: {{value0}}"]]));
            })}>
            {busy === "import" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <FileInput size={15} aria-hidden="true" />} {t("Import FIT files")}
          </button>
          <button type="button" className="secondary-button" disabled={busy !== null}
            onClick={() => void run("folder", "import", async () => {
              const result = await api.importLocalFitFiles(true);
              return localizedText(() => countText(result.imported, "1 activity imported", "{{value0}} activities imported", [[result.duplicates, "Already here: {{value0}}"], [result.failed.length, "Couldn't import: {{value0}}"]]));
            })}>
            {busy === "folder" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <FolderOpen size={15} aria-hidden="true" />} {t("Import a folder")}
          </button>
        </div>
        {notice("import")}
      </div> : null}

      <div className="privacy-section">
        <h3><Archive size={16} aria-hidden="true" /> {t("Backup")}</h3>
        <p className="settings-hint">{t("A backup holds the activities and health data on this computer. Watch keys and sign-ins are never included.")}</p>
        <label className="privacy-passphrase-label" htmlFor="privacy-passphrase">{t("Passphrase (optional)")}</label>
        <div className="privacy-actions">
          <input id="privacy-passphrase" type="password" className="privacy-passphrase" value={backupPassphrase} autoComplete="new-password"
            placeholder={t("Encrypts the backup")}
            aria-invalid={shortPassphrase || undefined} aria-describedby={shortPassphrase ? "privacy-passphrase-rule" : undefined}
            onChange={event => setBackupPassphrase(event.target.value)} />
          <button type="button" className="secondary-button" disabled={busy !== null || shortPassphrase}
            onClick={() => void run("backup", "backup", async () => {
              const result = await api.exportLocalBackup(backupPassphrase || undefined);
              setBackupPassphrase("");
              return result.saved ? localizedText(() => t("Backup saved.")) : undefined;
            })}>
            {busy === "backup" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            {t("Export backup")}
          </button>
          <button type="button" className="secondary-button" disabled={busy !== null}
            onClick={() => void run("restore", "backup", async () => {
              const choice = await api.chooseLocalBackup();
              if (!choice.chosen) return;
              if (choice.encrypted) { setRestorePrompt(true); return; }
              const result = await api.restoreLocalBackup();
              return localizedText(() => countText(result.activitiesAdded, "1 activity restored", "{{value0}} activities restored", [[result.activitiesSkipped, "Already here: {{value0}}"]]));
            })}>
            {busy === "restore" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />} {t("Restore backup")}
          </button>
        </div>
        {shortPassphrase ? <p id="privacy-passphrase-rule" className="settings-hint">{t("At least 8 characters")}</p> : null}
        {restorePrompt ? <label className="privacy-passphrase-label" htmlFor="privacy-restore-passphrase">{t("Backup passphrase")}</label> : null}
        {restorePrompt ? (
          <div className="privacy-actions">
            <input id="privacy-restore-passphrase" type="password" className="privacy-passphrase" value={restorePassphrase} autoComplete="off"
              onChange={event => setRestorePassphrase(event.target.value)} />
            <button type="button" className="primary-button" disabled={busy !== null || !restorePassphrase}
              onClick={() => void run("restore", "backup", async () => {
                const result = await api.restoreLocalBackup(restorePassphrase);
                setRestorePrompt(false);
                setRestorePassphrase("");
                return localizedText(() => countText(result.activitiesAdded, "1 activity restored", "{{value0}} activities restored", [[result.activitiesSkipped, "Already here: {{value0}}"]]));
              })}>{t("Restore")}</button>
          </div>
        ) : null}
        {notice("backup")}
      </div>

      {enforcing ? <details className="privacy-section privacy-report" onToggle={event => {
        if ((event.target as HTMLDetailsElement).open) void run("report", "report", async () => { setReport(await api.getNetworkAccessReport()); });
      }}>
        <summary>
          <ChevronRight size={14} className="watch-settings-chevron" aria-hidden="true" />
          {t("Blocked uploads to COROS")}{status ? <span className="privacy-count"> · {formatNumber(status.blockedAttempts)}</span> : null}
        </summary>
        {report?.attempts.length ? (
          <table className="privacy-attempts">
            <thead><tr><th>{t("Time")}</th><th>{t("Destination")}</th></tr></thead>
            <tbody>
              {[...report.attempts].reverse().slice(0, 50).map((attempt, index) => (
                <tr key={`${attempt.at}-${index}`}>
                  <td>{formatDate(new Date(attempt.at), { timeStyle: "medium" })}</td>
                  <td>{attempt.destination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="settings-hint">{t("No blocked attempts recorded.")}</p>}
        <div className="privacy-actions">
          <button type="button" className="secondary-button" disabled={busy !== null}
            onClick={() => void run("report", "report", async () => { setReport(await api.getNetworkAccessReport()); })}>
            <RefreshCw size={14} aria-hidden="true" /> {t("Refresh")}
          </button>
          <button type="button" className="secondary-button" disabled={busy !== null || !report?.attempts.length}
            onClick={() => void run("report", "report", async () => { setReport(await api.clearNetworkAccessReport()); })}>
            <Trash2 size={14} aria-hidden="true" /> {t("Clear")}
          </button>
        </div>
        {notice("report")}
      </details> : null}
    </section>
  );
}
