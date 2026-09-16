import { useId, type ReactNode } from "react";
import { ChevronRight, Flame, Footprints, Heart, Zap } from "lucide-react";
import type { TrainingHubDailyHealthRecord } from "../../../electron/types";
import {
  formatHappenDayLabel,
  formatOptionalNumber,
  formatSignedDelta
} from "../formatters";
import type { TrainingSummaryMetrics, TrainingTrendPoint } from "../types";

interface TrainingSummaryTilesProps {
  summary: TrainingSummaryMetrics;
  trendPoints?: TrainingTrendPoint[];
  healthRecords?: TrainingHubDailyHealthRecord[];
  layout?: "row" | "stack";
  metrics?: TrainingSummaryMetric[];
  className?: string;
}

type TrainingSummaryMetric = "load" | "heart" | "steps" | "calories";

interface StatReading {
  date: string;
  value?: number;
}

function StatChart({ readings, bars }: { readings: StatReading[]; bars: boolean }) {
  const gradientId = useId();
  const values = readings.flatMap(({ value }) => value === undefined ? [] : [value]);
  if (values.length === 0) {
    return <span className="training-stat-card__chart-empty">No history</span>;
  }

  const min = bars ? 0 : Math.min(...values);
  const range = Math.max(Math.max(...values) - min, 1);
  const points = readings.map(({ value }, index) => ({
    x: readings.length === 1 ? 60 : 5 + index * 110 / (readings.length - 1),
    y: value === undefined ? undefined : 48 - (value - min) / range * 34
  }));
  const line = points.map((point, index) => point.y === undefined ? "" :
    `${index === 0 || points[index - 1].y === undefined ? "M" : "L"}${point.x},${point.y}`
  ).join(" ");

  return (
    <svg viewBox="0 0 120 56" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity={bars ? "0.4" : "0"} />
        </linearGradient>
      </defs>
      {bars ? points.map((point, index) => point.y === undefined ? null : (
        <rect key={readings[index].date} x={point.x - 3} y={point.y}
          width="6" height={Math.max(48 - point.y, 1.5)} rx="1.8"
          fill={`url(#${gradientId})`} />
      )) : (
        <>
          {points.slice(1).map((point, index) => {
            const previous = points[index];
            return point.y === undefined || previous.y === undefined ? null : (
              <path key={readings[index + 1].date}
                d={`M${previous.x},52 L${previous.x},${previous.y} L${point.x},${point.y} L${point.x},52 Z`}
                fill={`url(#${gradientId})`} opacity="0.24" />
            );
          })}
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => point.y === undefined ? null : (
            <circle key={readings[index].date} cx={point.x} cy={point.y} r="2" fill="currentColor" />
          ))}
        </>
      )}
    </svg>
  );
}

function recentReadings(readings: StatReading[]): StatReading[] {
  return [...readings]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10)
    .map((reading) => ({
      ...reading,
      value: reading.value !== undefined && Number.isFinite(reading.value) && reading.value >= 0
        ? reading.value : undefined
    }));
}

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  context?: string;
  readings?: StatReading[];
  variant?: "bar" | "widget";
  tone?: "load" | "heart" | "steps" | "calories";
}

function StatCard({
  icon,
  label,
  value,
  detail,
  context,
  readings = [],
  variant = "bar",
  tone = "load"
}: StatCardProps) {
  if (variant === "widget") {
    return (
      <details className={`training-stat-card is-widget tone-${tone}`}>
        <summary className="training-stat-card__summary" aria-label={`${label}: ${value} ${detail}. Recent readings`}>
          <span className="training-stat-card__header">
            <span className="training-stat-card__icon" aria-hidden="true">
              {icon}
            </span>
            <span className="training-stat-card__label">{label}</span>
            <ChevronRight className="training-stat-card__chevron" size={16} aria-hidden="true" />
          </span>
          <span className="training-stat-card__reading">
            <strong
              className={`training-stat-card__value${
                value === "–" || value === "-" ? " is-empty" : ""
              }`}
            >
              {value}
            </strong>
            <span className="training-stat-card__detail">{detail}</span>
          </span>
          <span className="training-stat-card__chart" aria-hidden="true">
            <StatChart readings={readings} bars={tone === "steps" || tone === "calories"} />
          </span>
        </summary>
        <div className="training-stat-card__history">
          {context ? <p>{context}</p> : null}
          {readings.some((reading) => reading.value !== undefined) ? (
            <>
              <p className="training-stat-card__history-label">Recent readings</p>
              <dl>
                {readings.map((reading) => (
                  <div key={reading.date}>
                    <dt>{formatHappenDayLabel(reading.date)}</dt>
                    <dd>{formatWholeNumber(reading.value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : <p>Recent history will appear after syncing.</p>}
        </div>
      </details>
    );
  }

  return (
    <section className={`training-stat-card tone-${tone}`}>
      <div className="training-stat-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="training-stat-card__label">{label}</p>
      <span className="training-stat-card__detail">{detail}</span>
      <strong className="training-stat-card__value">{value}</strong>
    </section>
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }

  return Math.round(value).toLocaleString();
}

export function TrainingSummaryTiles({
  summary,
  trendPoints = [],
  healthRecords = [],
  layout = "row",
  metrics = ["load", "heart"],
  className
}: TrainingSummaryTilesProps) {
  const variant = layout === "stack" ? "widget" : "bar";
  const iconSize = variant === "widget" ? 17 : 16;
  const tilesClassName = [
    "training-summary-tiles",
    layout === "stack" ? "is-stack" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={tilesClassName}>
      {metrics.includes("load") ? (
        <StatCard
          icon={<Flame size={iconSize} />}
          label={variant === "widget" ? "Load" : "Training Load"}
          value={formatOptionalNumber(summary.todayLoad)}
          detail={
            variant === "widget" ? "today" : summary.weekLoadTotal !== undefined
              ? `${Math.round(summary.weekLoadTotal)} load over 7 days` : "today's load"
          }
          context={summary.weekLoadTotal !== undefined ? `${Math.round(summary.weekLoadTotal)} load over 7 days` : undefined}
          readings={recentReadings(trendPoints.map((point) => ({ date: point.date, value: point.trainingLoad })))}
          variant={variant}
          tone="load"
        />
      ) : null}

      {metrics.includes("heart") ? (
        <StatCard
          icon={<Heart size={iconSize} />}
          label="Resting HR"
          value={
            summary.latestRhr !== undefined ? `${Math.round(summary.latestRhr)}` : "–"
          }
          detail={
            variant === "widget" ? "bpm" : summary.rhrDelta !== undefined
              ? `${formatSignedDelta(summary.rhrDelta, " bpm")} vs 7-day avg` : "beats per minute"
          }
          context={summary.rhrDelta !== undefined ? `${formatSignedDelta(summary.rhrDelta, " bpm")} vs 7-day avg` : undefined}
          readings={recentReadings(trendPoints.map((point) => ({ date: point.date, value: point.rhr !== undefined && point.rhr > 0 ? point.rhr : undefined })))}
          variant={variant}
          tone="heart"
        />
      ) : null}

      {metrics.includes("steps") ? (
        <StatCard
          icon={<Footprints size={iconSize} />}
          label="Steps"
          value={formatWholeNumber(summary.steps)}
          detail={variant === "widget" ? "today" : "daily step count"}
          readings={recentReadings(healthRecords.map((record) => ({ date: record.happenDay, value: record.steps })))}
          variant={variant}
          tone="steps"
        />
      ) : null}

      {metrics.includes("calories") ? (
        <StatCard
          icon={<Zap size={iconSize} />}
          label="Calories"
          value={formatWholeNumber(summary.calories)}
          detail={variant === "widget" ? "kcal" : "total calories"}
          readings={recentReadings(healthRecords.map((record) => ({ date: record.happenDay, value: record.calories })))}
          variant={variant}
          tone="calories"
        />
      ) : null}
    </div>
  );
}
