import { Loader2, MoonStar } from "lucide-react";
import { formatSleepNightLabel } from "../formatters";
import type { TrainingHubSleepRecord, TrainingHubSleepSummary } from "../../../electron/types";

interface SleepSummaryPanelProps {
  sleep?: TrainingHubSleepSummary | null;
  connecting?: boolean;
  refreshing?: boolean;
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
      return "Poor";
    case "mid":
      return "Fair";
    case "good":
      return "Good";
    case "high":
      return "Excellent";
    default:
      return "Waiting";
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
    return "–";
  }

  const duration = formatSleepDuration(record.napMinutes);
  if (record.napStart && record.napEnd) {
    return `${duration} · ${record.napStart}–${record.napEnd}`;
  }

  return duration;
}

function formatSleepWindow(record: TrainingHubSleepRecord): string {
  if (record.sleepStart && record.sleepEnd) {
    return `${record.sleepStart}-${record.sleepEnd}`;
  }

  return "–";
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function SleepStageBar({ record }: { record: TrainingHubSleepRecord }) {
  const total = stageTotal(record);

  if (total <= 0) {
    return <p className="sleep-panel-empty-stages">Stage breakdown unavailable.</p>;
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
        aria-label="Sleep stage breakdown"
        role="img"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`sleep-stage-segment ${segment.className}`}
            style={{ flexGrow: segment.value }}
            title={`${segment.label}: ${segment.detail}`}
          />
        ))}
      </div>
      <div className="sleep-stage-legend" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.key} className="sleep-stage-legend-item">
            <span className={`sleep-stage-legend-dot ${segment.className}`} />
            {segment.label}
            <strong>{segment.detail}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function SleepSummaryPanel({
  sleep,
  connecting = false,
  refreshing = false
}: SleepSummaryPanelProps) {
  const latest = sleep?.latest;
  const tone = sleepScoreTone(latest?.score);
  const label = sleepScoreLabel(latest?.score);
  const isLoading = connecting || refreshing;

  return (
    <section className={`panel sleep-panel tone-${tone}`}>
      <div className="sleep-panel-header">
        <div>
          <p className="eyebrow">Sleep</p>
          <h2>{latest ? formatSleepNightLabel(latest) : "Last night"}</h2>
        </div>
        <span className="sleep-panel-icon" aria-hidden="true">
          {isLoading ? <Loader2 className="spin" size={16} /> : <MoonStar size={16} />}
        </span>
      </div>

      {connecting ? (
        <p className="sleep-panel-message">Connecting COROS data access…</p>
      ) : null}

      {!connecting && isLoading ? (
        <p className="sleep-panel-message">Syncing sleep data…</p>
      ) : null}

      {!isLoading && latest ? (
        <>
          <div className="sleep-panel-hero">
            <div className="sleep-panel-score">
              <strong>{latest.score !== undefined ? Math.round(latest.score) : "–"}</strong>
              <span>{label}</span>
            </div>
            <div className="sleep-panel-duration">
              <span>Main sleep</span>
              <strong>{formatSleepDuration(latest.totalMinutes)}</strong>
            </div>
          </div>

          <SleepStageBar record={latest} />

          {latest.completeness === "partial" ? (
            <p className="sleep-panel-partial">
              Partial data: {latest.partialReason ?? "COROS is still syncing this sleep."}
            </p>
          ) : null}

          <div className="sleep-panel-metrics">
            <div>
              <span>Window</span>
              <strong>{formatSleepWindow(latest)}</strong>
            </div>
            <div>
              <span>Awake</span>
              <strong>{formatSleepDuration(latest.awakeMinutes)}</strong>
            </div>
            <div>
              <span>Awake &gt;5m</span>
              <strong>{latest.awakeCountOverFiveMinutes ?? "–"}</strong>
            </div>
            <div>
              <span>Naps</span>
              <strong>{formatNapSummary(latest)}</strong>
            </div>
          </div>
        </>
      ) : null}

      {!isLoading && !latest ? (
        <p className="sleep-panel-message">
          {sleep?.mcpConnected
            ? "No sleep data for this period."
            : "Connect COROS data access to view sleep metrics."}
        </p>
      ) : null}
    </section>
  );
}
