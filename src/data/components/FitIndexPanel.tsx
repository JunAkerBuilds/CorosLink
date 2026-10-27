import { t, useLanguage, formatDate, formatNumber } from "../../i18n/tools";
import {
  CheckCircle2,
  Loader2,
  Radar,
  Square,
  XCircle
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { FitIndexProgress, FitIndexStatus } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import "./fitIndexPanel.css";

const RUNNING_STATES = new Set(["listing", "indexing"]);

type WindowChoice = 90 | 365 | 0;

const WINDOW_OPTIONS: Array<{ value: WindowChoice; label: string; hint: string }> = [
  { value: 90, label: "Last 90 days", hint: "Current block · a few minutes" },
  { value: 365, label: "Last year", hint: "Season-long comparisons" },
  { value: 0, label: "Everything", hint: "Full history, in the background" }
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return t("{{p0}} KB", { p0: Math.round(bytes / 1024) });
  if (bytes < 1024 * 1024 * 1024) return t("{{p0}} MB", { p0: (bytes / (1024 * 1024)).toFixed(1) });
  return t("{{p0}} GB", { p0: (bytes / (1024 * 1024 * 1024)).toFixed(2) });
}

function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function FitIndexPanel({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const [status, setStatus] = useState<FitIndexStatus | null>(null);
  const [progress, setProgress] = useState<FitIndexProgress | null>(null);
  const [windowDays, setWindowDays] = useState<WindowChoice>(90);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = () =>
    api
      .getFitIndexStatus()
      .then((next) => {
        setStatus(next);
        setProgress(next.progress);
      })
      .catch(() => undefined);

  useEffect(() => {
    void refreshStatus();
    return api.onFitIndexProgress((next) => {
      setProgress(next);
      if (!RUNNING_STATES.has(next.state)) void refreshStatus();
    });
  }, [api]);

  const running = Boolean(progress && RUNNING_STATES.has(progress.state));
  const processed = progress
    ? progress.completed + progress.skipped + progress.failed
    : 0;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((processed / progress.total) * 100))
      : 0;
  const progressWidth =
    progress?.state === "listing" || progress?.total === 0 ? "10%" : `${percent}%`;
  const lastSync = formatWhen(status?.lastSyncAt);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      await api.startFitIndexSync(windowDays === 0 ? {} : { sinceDays: windowDays });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Could not start indexing."));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="data-tool-card training-backup-panel fit-index-panel">
      <header className="data-tool-header">
        <div className="training-backup-heading">
          <p className="eyebrow">{t("Local activity index")}</p>
          <h2>{t("Index activities for deep analysis")}</h2>
          <p className="training-backup-hint">
            {t("Coach computes splits, power curves, best efforts, cardiac drift, and same-route comparisons from full-resolution FIT files cached on this computer. Files download once, never expire, and have no daily limit. Coach also indexes on demand, so this is only needed for history-wide questions.")}</p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <Radar size={22} />
        </div>
      </header>

      <div className="fit-index-body">
        <dl className="fit-index-stats">
          <div className={status && status.indexed > 0 ? "fit-index-stat is-ready" : "fit-index-stat"}>
            <dt>{t("Activities indexed")}</dt>
            <dd>{status ? formatNumber(status.indexed) : "–"}</dd>
          </div>
          <div className="fit-index-stat">
            <dt>{t("Cache on disk")}</dt>
            <dd>{status ? formatBytes(status.cacheBytes) : "–"}</dd>
          </div>
          <div className="fit-index-stat">
            <dt>{t("Last sync")}</dt>
            <dd className={lastSync ? undefined : "is-empty"}>{lastSync ?? t("Never")}</dd>
          </div>
        </dl>

        <div className="fit-index-controls">
          <div className="fit-index-window">
            <span className="training-backup-formats-label" id="fit-index-window-label">
              {t("Window")}</span>
            <div
              className="fit-index-window-grid"
              role="radiogroup"
              aria-labelledby="fit-index-window-label"
            >
              {WINDOW_OPTIONS.map((option) => {
                const active = windowDays === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={
                      active
                        ? "training-backup-format-option fit-index-window-option active"
                        : "training-backup-format-option fit-index-window-option"
                    }
                    disabled={running}
                    onClick={() => setWindowDays(option.value)}
                  >
                    <strong>{t(option.label)}</strong>
                    <span>{t(option.hint)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fit-index-action">
            {running ? (
              <button
                type="button"
                className="secondary-button danger-button fit-index-button"
                onClick={() => void api.cancelFitIndexSync()}
              >
                <Square size={14} aria-hidden="true" />
                {t("Stop indexing")}</button>
            ) : (
              <button
                type="button"
                className="primary-button fit-index-button"
                disabled={starting}
                onClick={() => void handleStart()}
              >
                {starting ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <Radar size={16} aria-hidden="true" />
                )}
                {t("Index activities")}</button>
            )}
          </div>
        </div>

        {running ? (
          <div className="training-backup-progress fit-index-progress">
            <div className="training-backup-progress-meta">
              <span className="training-backup-progress-label">
                {progress?.state === "listing" ? t("Finding activities") : t("Indexing")}
              </span>
              {progress && progress.total > 0 ? (
                <span className="training-backup-progress-count">
                  {processed} / {progress.total}
                </span>
              ) : null}
            </div>
            <div
              className={`training-backup-progress-track${
                progress?.state === "listing" || progress?.total === 0
                  ? " is-indeterminate"
                  : ""
              }`}
              style={{ "--backup-progress": progressWidth } as CSSProperties}
            >
              <span />
            </div>
            {progress?.currentName && progress.state === "indexing" ? (
              <p className="training-backup-current">{progress.currentName}</p>
            ) : progress?.state === "listing" ? (
              <p className="training-backup-current">{t("Scanning your COROS account…")}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {progress && !running ? (
        <div
          className={`training-backup-result${
            progress.state === "error"
              ? " is-error"
              : progress.state === "cancelled"
                ? " is-cancelled"
                : " is-success"
          }`}
        >
          {progress.state === "error" ? (
            <>
              <XCircle size={18} aria-hidden="true" />
              <div>
                <strong>{t("Indexing failed")}</strong>
                <p>{progress.error ?? t("Unknown error")}</p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>
                  {progress.state === "cancelled" ? t("Indexing stopped") : t("Index up to date")}
                </strong>
                <div className="training-backup-stats">
                  <span className="badge ready">{progress.completed}  {t("indexed")}</span>
                  <span className="badge">{progress.skipped}  {t("already indexed")}</span>
                  {progress.failed > 0 ? (
                    <span className="badge danger">{progress.failed}  {t("failed")}</span>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className="training-backup-error">{error}</p> : null}
    </section>
  );
}
