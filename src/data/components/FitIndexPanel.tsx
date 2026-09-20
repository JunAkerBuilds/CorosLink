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

const RUNNING_STATES = new Set(["listing", "indexing"]);

type WindowChoice = 90 | 365 | 0;

const WINDOW_OPTIONS: Array<{ value: WindowChoice; label: string; hint: string }> = [
  { value: 90, label: "Last 90 days", hint: "Current block; a few minutes" },
  { value: 365, label: "Last year", hint: "Season-long comparisons" },
  { value: 0, label: "Everything", hint: "Full history, runs in the background" }
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function FitIndexPanel({ api }: { api: CorosLinkApi }) {
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
      setError(caught instanceof Error ? caught.message : "Could not start indexing.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="data-tool-card training-backup-panel fit-index-panel">
      <header className="data-tool-header">
        <div className="training-backup-heading">
          <p className="eyebrow">Local activity index</p>
          <h2>Index activities for deep analysis</h2>
          <p className="training-backup-hint">
            Coach computes splits, power curves, best efforts, cardiac drift, and
            same-route comparisons from full-resolution FIT files cached on this
            computer. Files are downloaded once and never expire; there is no
            daily limit. Coach also indexes on demand, so this is only needed for
            history-wide questions.
          </p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <Radar size={22} />
        </div>
      </header>

      <div className="training-backup-card">
        <div className="training-backup-stats fit-index-stats">
          <span className="badge ready">
            {status ? `${status.indexed} indexed` : "…"}
          </span>
          <span className="badge">{status ? formatBytes(status.cacheBytes) : "…"}</span>
          {lastSync ? <span className="badge">Last sync {lastSync}</span> : null}
        </div>

        <div className="training-backup-formats">
          <span className="training-backup-formats-label">Window</span>
          <div
            className="training-backup-format-grid"
            role="radiogroup"
            aria-label="Index window"
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
                      ? "training-backup-format-option active"
                      : "training-backup-format-option"
                  }
                  disabled={running}
                  onClick={() => setWindowDays(option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="training-backup-action-bar">
          {running ? (
            <div className="training-backup-progress">
              <div className="training-backup-progress-meta">
                <span className="training-backup-progress-label">
                  {progress?.state === "listing" ? "Finding activities" : "Indexing"}
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
                <p className="training-backup-current">Scanning your COROS account…</p>
              ) : null}
              <button
                type="button"
                className="secondary-button danger-button compact-button training-backup-stop"
                onClick={() => void api.cancelFitIndexSync()}
              >
                <Square size={14} aria-hidden="true" />
                Stop indexing
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button training-backup-start"
              disabled={starting}
              onClick={() => void handleStart()}
            >
              {starting ? (
                <Loader2 size={16} className="spin" aria-hidden="true" />
              ) : (
                <Radar size={16} aria-hidden="true" />
              )}
              Index activities
            </button>
          )}
        </div>
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
                <strong>Indexing failed</strong>
                <p>{progress.error ?? "Unknown error"}</p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>
                  {progress.state === "cancelled" ? "Indexing stopped" : "Index up to date"}
                </strong>
                <div className="training-backup-stats">
                  <span className="badge ready">{progress.completed} indexed</span>
                  <span className="badge">{progress.skipped} already indexed</span>
                  {progress.failed > 0 ? (
                    <span className="badge danger">{progress.failed} failed</span>
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
