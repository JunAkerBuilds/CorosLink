import { MessageCircle } from "lucide-react";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";

interface WeekStatsCellProps {
  stats: WeeklyStats;
  onAskCoach: () => void;
}

function StatRow({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "accent" | "gold" | "warn";
}) {
  return (
    <div className="calendar-weekstats-row">
      <span className="calendar-weekstats-label">{label}</span>
      <span className={`calendar-weekstats-value ${tone ? `tone-${tone}` : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function WeekStatsCell({ stats, onAskCoach }: WeekStatsCellProps) {
  const hasAny =
    stats.actualLoad > 0 ||
    stats.plannedLoad > 0 ||
    stats.activityTimeSeconds > 0 ||
    stats.distanceMeters > 0;

  return (
    <div className="calendar-weekstats">
      {stats.baseFitness !== undefined ? (
        <StatRow label="Base Fitness" value={String(Math.round(stats.baseFitness))} tone="accent" />
      ) : null}
      {stats.loadImpact !== undefined ? (
        <StatRow label="Load Impact" value={String(Math.round(stats.loadImpact))} tone="gold" />
      ) : null}
      {stats.loadRatio !== undefined ? (
        <StatRow
          label="Load Ratio"
          value={stats.loadRatio.toFixed(2)}
          tone="warn"
        />
      ) : null}
      <StatRow
        label="Training Load"
        value={
          stats.plannedLoad > 0
            ? `${stats.actualLoad} / ${stats.plannedLoad} TL`
            : `${stats.actualLoad} TL`
        }
      />
      {stats.recommendedLoadMin !== undefined && stats.recommendedLoadMax !== undefined ? (
        <StatRow
          label="Target Range"
          value={`${stats.recommendedLoadMin}–${stats.recommendedLoadMax} TL`}
        />
      ) : null}
      <StatRow
        label="Activity Time"
        value={stats.activityTimeSeconds > 0 ? formatDurationSeconds(stats.activityTimeSeconds) : "--"}
      />
      <StatRow
        label="Distance"
        value={
          stats.plannedDistanceKm > 0
            ? `${(stats.distanceMeters / 1000).toFixed(1)} / ${stats.plannedDistanceKm.toFixed(1)} km`
            : stats.distanceMeters > 0
              ? formatDistanceMeters(stats.distanceMeters)
              : "--"
        }
      />
      <StatRow
        label="Elev. Gain"
        value={stats.elevationGain > 0 ? `${stats.elevationGain} m` : "--"}
      />
      {hasAny ? (
        <button
          type="button"
          className="calendar-weekstats-coach"
          onClick={onAskCoach}
          title="Ask Coach about this week"
        >
          <MessageCircle size={13} aria-hidden="true" />
          Ask Coach
        </button>
      ) : null}
    </div>
  );
}
