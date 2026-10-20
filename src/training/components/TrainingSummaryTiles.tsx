import { useLanguage, t, getLocale } from "../../i18n/training";
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
  /** Local-Only Mode: resting HR is calculated by COROS and isn't in the watch's sync data. */
  local?: boolean;
}

type TrainingSummaryMetric = "load" | "heart" | "steps" | "calories";

interface StatReading {
  date: string;
  value?: number;
}

function StatChart({ readings, bars, emptyLabel = "No history" }: { readings: StatReading[]; bars: boolean; emptyLabel?: string }) {
  useLanguage();
  const gradientId = useId();
  const values = readings.flatMap(({ value }) => value === undefined ? [] : [value]);
  if (values.length === 0) {
    return <span className="training-stat-card__chart-empty">{t(emptyLabel)}</span>;
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
  /** No source can fill this reading, so the card says why instead of promising history. */
  unavailable?: boolean;
}

function StatCard({
  icon,
  label,
  value,
  detail,
  context,
  readings = [],
  variant = "bar",
  tone = "load",
  unavailable = false
}: StatCardProps) {
  useLanguage();
  if (variant === "widget") {
    return (
      <details className={`training-stat-card is-widget tone-${tone}`}>
        <summary className="training-stat-card__summary" aria-label={t("{{value1}}: {{value2}} {{value3}}. Recent readings", { value1: String(label), value2: String(value), value3: String(detail) })}>
          <span className="training-stat-card__header">
            <span className="training-stat-card__icon" aria-hidden="true">
              {icon}
            </span>
            <span className="training-stat-card__label">{t(label)}</span>
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
            <StatChart readings={readings} bars={tone === "steps" || tone === "calories"}
              emptyLabel={unavailable ? "Not available" : undefined} />
          </span>
        </summary>
        <div className="training-stat-card__history">
          {context ? <p>{context}</p> : null}
          {readings.some((reading) => reading.value !== undefined) ? (
            <>
              <p className="training-stat-card__history-label">{t("Recent readings")}</p>
              <dl>
                {readings.map((reading) => (
                  <div key={reading.date}>
                    <dt>{formatHappenDayLabel(reading.date)}</dt>
                    <dd>{formatWholeNumber(reading.value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : unavailable ? null : <p>{t("Recent history will appear after syncing.")}</p>}
        </div>
      </details>
    );
  }

  return (
    <section className={`training-stat-card tone-${tone}`}>
      <div className="training-stat-card__icon" aria-hidden="true">
        {icon}
      </div>
      <p className="training-stat-card__label">{t(label)}</p>
      <span className="training-stat-card__detail">{detail}</span>
      <strong className="training-stat-card__value">{value}</strong>
    </section>
  );
}

function formatWholeNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "–";
  }

  return Math.round(value).toLocaleString(getLocale());
}

export function TrainingSummaryTiles({
  summary,
  trendPoints = [],
  healthRecords = [],
  layout = "row",
  metrics = ["load", "heart"],
  className,
  local = false
}: TrainingSummaryTilesProps) {
  useLanguage();
  const restingHrUnavailable = local && summary.latestRhr === undefined;
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
          label={variant === "widget" ? t("Load") : t("Training Load")}
          value={formatOptionalNumber(summary.todayLoad)}
          detail={
            variant === "widget" ? t("today") : summary.weekLoadTotal !== undefined
              ? t("{{value1}} load over 7 days", { value1: String(Math.round(summary.weekLoadTotal)) }) : t("today's load")
          }
          context={summary.weekLoadTotal !== undefined ? t("{{value1}} load over 7 days", { value1: String(Math.round(summary.weekLoadTotal)) }) : undefined}
          readings={recentReadings(trendPoints.map((point) => ({ date: point.date, value: point.trainingLoad })))}
          variant={variant}
          tone="load"
        />
      ) : null}

      {metrics.includes("heart") ? (
        <StatCard
          icon={<Heart size={iconSize} />}
          label={t("Resting HR")}
          value={
            summary.latestRhr !== undefined ? `${Math.round(summary.latestRhr)}` : "–"
          }
          detail={
            variant === "widget" ? "bpm" : summary.rhrDelta !== undefined
              ? t("{{value1}} vs 7-day avg", { value1: String(formatSignedDelta(summary.rhrDelta, " bpm")) }) : t("beats per minute")
          }
          context={restingHrUnavailable
            ? t("Not available in Local-Only Mode.")
            : summary.rhrDelta !== undefined ? t("{{value1}} vs 7-day avg", { value1: String(formatSignedDelta(summary.rhrDelta, " bpm")) }) : undefined}
          readings={recentReadings(trendPoints.map((point) => ({ date: point.date, value: point.rhr !== undefined && point.rhr > 0 ? point.rhr : undefined })))}
          variant={variant}
          tone="heart"
          unavailable={restingHrUnavailable}
        />
      ) : null}

      {metrics.includes("steps") ? (
        <StatCard
          icon={<Footprints size={iconSize} />}
          label={t("Steps")}
          value={formatWholeNumber(summary.steps)}
          detail={variant === "widget" ? t("today") : t("daily step count")}
          readings={recentReadings(healthRecords.map((record) => ({ date: record.happenDay, value: record.steps })))}
          variant={variant}
          tone="steps"
        />
      ) : null}

      {metrics.includes("calories") ? (
        <StatCard
          icon={<Zap size={iconSize} />}
          label={local ? t("Active calories") : t("Calories")}
          value={formatWholeNumber(summary.calories)}
          detail={variant === "widget" ? "kcal" : t("total calories")}
          readings={recentReadings(healthRecords.map((record) => ({ date: record.happenDay, value: record.calories })))}
          variant={variant}
          tone="calories"
        />
      ) : null}
    </div>
  );
}
