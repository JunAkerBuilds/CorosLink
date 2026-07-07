import type { ReactNode } from "react";
import { Flame, Footprints, Heart, Zap } from "lucide-react";
import {
  formatOptionalNumber,
  formatSignedDelta
} from "../formatters";
import type { TrainingSummaryMetrics } from "../types";

interface TrainingSummaryTilesProps {
  summary: TrainingSummaryMetrics;
  layout?: "row" | "stack";
  metrics?: TrainingSummaryMetric[];
  className?: string;
}

type TrainingSummaryMetric = "load" | "heart" | "steps" | "calories";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  variant?: "bar" | "widget";
  tone?: "load" | "heart" | "steps" | "calories";
}

function StatCard({
  icon,
  label,
  value,
  detail,
  variant = "bar",
  tone = "load"
}: StatCardProps) {
  if (variant === "widget") {
    return (
      <section className={`training-stat-card is-widget tone-${tone}`}>
        <div className="training-stat-card__icon" aria-hidden="true">
          {icon}
        </div>
        <p className="training-stat-card__label">{label}</p>
        <strong
          className={`training-stat-card__value${
            value === "–" ? " is-empty" : ""
          }`}
        >
          {value}
        </strong>
        <span className="training-stat-card__detail">{detail}</span>
      </section>
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
  layout = "row",
  metrics = ["load", "heart"],
  className
}: TrainingSummaryTilesProps) {
  const variant = layout === "stack" ? "widget" : "bar";
  const iconSize = variant === "widget" ? 13 : 16;
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
            summary.weekLoadTotal !== undefined
              ? variant === "widget"
                ? `${Math.round(summary.weekLoadTotal)} / 7 days`
                : `${Math.round(summary.weekLoadTotal)} load over 7 days`
              : variant === "widget"
                ? "today"
                : "today's load"
          }
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
            summary.rhrDelta !== undefined
              ? variant === "widget"
                ? `${formatSignedDelta(summary.rhrDelta, "")} vs avg`
                : `${formatSignedDelta(summary.rhrDelta, " bpm")} vs 7-day avg`
              : variant === "widget"
                ? "bpm"
                : "beats per minute"
          }
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
          variant={variant}
          tone="calories"
        />
      ) : null}
    </div>
  );
}
