import { t, useLanguage } from "../../i18n/training";
import { useState } from "react";
import {
  Loader2,
  Moon,
  MoonStar,
  Sunrise
} from "lucide-react";
import { formatSleepClockRange, formatSleepNightLabel } from "../formatters";
import type { TrainingHubSleepRecord, TrainingHubSleepSummary } from "../../../electron/types";
import "../sleepPanel.css";

interface SleepSummaryPanelProps {
  sleep?: TrainingHubSleepSummary | null;
  connecting?: boolean;
  refreshing?: boolean;
  /**
   * Opens COROS sign-in. Background loads never do, so this is the way in when
   * data access isn't connected; the sleep reloads once it connects.
   */
  onConnect?: () => Promise<unknown>;
  /** Local-Only Mode: sleep comes from the watch, and the sleep score (computed by COROS) never arrives. */
  local?: boolean;
}

function formatSleepDuration(minutes?: number): string {
  if (minutes === undefined || !Number.isFinite(minutes)) {
    return "–";
  }

  if (minutes <= 0) {
    return "0m";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);

  if (hours <= 0) {
    return `${remainder}m`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function sleepScoreTone(score?: number): "low" | "mid" | "good" | "high" | "neutral" {
  if (score === undefined || !Number.isFinite(score)) {
    return "neutral";
  }

  if (score < 60) {
    return "low";
  }

  if (score < 75) {
    return "mid";
  }

  if (score < 90) {
    return "good";
  }

  return "high";
}

function sleepScoreLabel(score?: number): string {
  const tone = sleepScoreTone(score);

  switch (tone) {
    case "low":
      return t("Poor");
    case "mid":
      return t("Fair");
    case "good":
      return t("Good");
    case "high":
      return t("Excellent");
    default:
      return t("Waiting");
  }
}

function stageTotal(record: TrainingHubSleepRecord): number {
  const stagedPercent =
    (record.deepPercent ?? 0) +
    (record.lightPercent ?? 0) +
    (record.remPercent ?? 0) +
    (record.awakePercent ?? 0);

  if (stagedPercent > 0) {
    return stagedPercent;
  }

  const staged =
    (record.deepMinutes ?? 0) +
    (record.lightMinutes ?? 0) +
    (record.remMinutes ?? 0) +
    (record.awakeMinutes ?? 0);

  if (staged > 0) {
    return staged;
  }

  return record.totalMinutes ?? 0;
}

function formatNapSummary(record: TrainingHubSleepRecord): string {
  if (record.napMinutes === undefined) {
    return t("No data");
  }

  return formatSleepDuration(record.napMinutes);
}

function formatSleepWindow(
  record: TrainingHubSleepRecord
): { start: string; end: string } | undefined {
  const range = formatSleepClockRange(record.sleepStart, record.sleepEnd);
  if (!range) {
    return undefined;
  }

  const [start, end] = range.split(" – ");
  return start && end ? { start, end } : undefined;
}

function formatSleepMetricDuration(minutes?: number): string {
  const duration = formatSleepDuration(minutes);
  return duration === "–" ? "No data" : duration;
}

function SleepMetric({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  useLanguage();
  return (
    <div className="sleep-metric">
      <dt>{t(label)}</dt>
      <dd title={String(value)}>{value}</dd>
    </div>
  );
}

function SleepWindowMetric({ record }: { record: TrainingHubSleepRecord }) {
  useLanguage();
  const window = formatSleepWindow(record);

  return (
    <div className="sleep-metric is-window">
      <dt>{t("Sleep window")}</dt>
      <dd
        className="sleep-window-value"
        title={window ? t("{{value1}} to {{value2}}", { value1: String(window.start), value2: String(window.end) }) : t("No data")}
      >
        {window ? (
          <>
            <span className="sleep-window-time">
              <Moon size={13} strokeWidth={2} aria-hidden="true" />
              {window.start}
            </span>
            <span className="sleep-window-arrow" aria-hidden="true">→</span>
            <span className="sleep-window-time">
              <Sunrise size={13} strokeWidth={2} aria-hidden="true" />
              {window.end}
            </span>
          </>
        ) : (
          t("No data")
        )}
      </dd>
    </div>
  );
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function SleepStageBar({ record }: { record: TrainingHubSleepRecord }) {
  useLanguage();
  const total = stageTotal(record);

  if (total <= 0) {
    return <p className="sleep-panel-empty-stages">{t("Stage breakdown unavailable.")}</p>;
  }

  const segments = [
    {
      key: "deep",
      label: "Deep",
      value: record.deepPercent ?? record.deepMinutes ?? 0,
      detail: record.deepPercent !== undefined
        ? formatPercent(record.deepPercent)
        : formatSleepDuration(record.deepMinutes),
      className: "is-deep"
    },
    {
      key: "light",
      label: "Light",
      value: record.lightPercent ?? record.lightMinutes ?? 0,
      detail: record.lightPercent !== undefined
        ? formatPercent(record.lightPercent)
        : formatSleepDuration(record.lightMinutes),
      className: "is-light"
    },
    {
      key: "rem",
      label: "REM",
      value: record.remPercent ?? record.remMinutes ?? 0,
      detail: record.remPercent !== undefined
        ? formatPercent(record.remPercent)
        : formatSleepDuration(record.remMinutes),
      className: "is-rem"
    },
    {
      key: "awake",
      label: "Awake",
      value: record.awakePercent ?? record.awakeMinutes ?? 0,
      detail: record.awakePercent !== undefined
        ? formatPercent(record.awakePercent)
        : formatSleepDuration(record.awakeMinutes),
      className: "is-awake"
    }
  ].filter((segment) => segment.value > 0);

  return (
    <div className="sleep-stage-stack">
      <div
        className="sleep-stage-bar"
        aria-label={t("Sleep stage breakdown")}
        role="list"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`sleep-stage-segment ${segment.className}`}
            style={{ flexGrow: segment.value }}
            aria-label={`${t(segment.label)}: ${t(segment.detail)}`}
            data-stage-label={`${segment.label}: ${segment.detail}`}
            role="listitem"
            tabIndex={0}
          />
        ))}
      </div>
      <div className="sleep-stage-legend" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.key} className="sleep-stage-legend-item">
            <span className={`sleep-stage-legend-dot ${segment.className}`} />
            {t(segment.label)}
            <strong>{t(segment.detail)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function SleepSummaryPanel({
  sleep,
  connecting = false,
  refreshing = false,
  onConnect,
  local = false
}: SleepSummaryPanelProps) {
  useLanguage();
  const [connectingMcp, setConnectingMcp] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const connect = async () => {
    if (!onConnect || connectingMcp) return;
    setConnectingMcp(true);
    setConnectError(null);
    try {
      await onConnect();
    } catch (caught) {
      setConnectError(caught instanceof Error ? caught.message : t("Could not connect to COROS."));
    } finally {
      setConnectingMcp(false);
    }
  };
  const latest = sleep?.latest;
  const tone = sleepScoreTone(latest?.score);
  const label = sleepScoreLabel(latest?.score);
  const isLoading = connecting || refreshing;
  // Local-Only Mode has no sleep score: the duration leads, and the score-tinted badge has nothing to show.
  const durationOnly = local && latest?.score === undefined;

  return (
    <section className={`panel sleep-panel tone-${tone}`}>
      <div className="sleep-panel-header">
        <div>
          <p className="sleep-panel-label">
            <span className="sleep-panel-moon" aria-hidden="true">
              <MoonStar size={20} />
            </span>
            {t("Sleep")} </p>
          <h2>{latest ? formatSleepNightLabel(latest) : t("Last night")}</h2>
        </div>
        {isLoading || !durationOnly ? (
          <span className="sleep-panel-icon" aria-hidden="true">
            {isLoading ? <Loader2 className="spin" size={16} /> : <MoonStar size={16} />}
          </span>
        ) : null}
      </div>

      {connecting && !local ? (
        <p className="sleep-panel-message">{t("Connecting COROS data access…")}</p>
      ) : null}

      {(!connecting || local) && isLoading ? (
        <p className="sleep-panel-message">{t("Syncing sleep data…")}</p>
      ) : null}

      {!isLoading && latest ? (
        <>
          <div className={`sleep-panel-hero${durationOnly ? " is-duration-only" : ""}`}>
            {durationOnly ? null : <div className="sleep-panel-score">
              <strong>{latest.score !== undefined ? Math.round(latest.score) : "–"}</strong>
              <span>{t(label)}</span>
            </div>}
            <div className="sleep-panel-duration">
              <span>{t("Main sleep")}</span>
              <strong>{formatSleepDuration(latest.totalMinutes)}</strong>
            </div>
          </div>

          <SleepStageBar record={latest} />

          {latest.completeness === "partial" ? (
            <p className="sleep-panel-partial">
              {t("Partial data:")} {latest.partialReason ?? t("COROS is still syncing this sleep.")}
            </p>
          ) : null}

          <dl className="sleep-panel-metrics" aria-label={t("Sleep details")}>
            <SleepWindowMetric record={latest} />
            <SleepMetric
              label={t("Awake")}
              value={formatSleepMetricDuration(latest.awakeMinutes)}
            />
            <SleepMetric
              label={t("Wake-ups > 5m")}
              value={latest.awakeCountOverFiveMinutes ?? "No data"}
            />
            <SleepMetric
              label={t("Naps")}
              value={formatNapSummary(latest)}
            />
          </dl>
        </>
      ) : null}

      {!isLoading && !latest && (sleep?.mcpConnected || local) ? (
        <p className="sleep-panel-message">{local ? t("No data yet.") : t("No sleep data for this period.")}</p>
      ) : null}
      {!isLoading && !latest && !sleep?.mcpConnected && !local ? (
        <div className="sleep-panel-connect">
          <p className="sleep-panel-message">
            {t("Connect COROS data access to view sleep metrics.")}
          </p>
          {onConnect ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void connect()}
              disabled={connectingMcp}
            >
              {connectingMcp ? t("Connecting…") : t("Connect COROS data access")}
            </button>
          ) : null}
          {connectError ? (
            <p className="sleep-panel-connect-error" role="alert">{connectError}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
