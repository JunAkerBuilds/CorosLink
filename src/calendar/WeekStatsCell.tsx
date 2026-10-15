import { formatNumber, useLanguage, t } from "../i18n/training";
import { MessageCircle } from "lucide-react";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../units/units";

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
  useLanguage();
  return (
    <div className="calendar-weekstats-row">
      <span className="calendar-weekstats-label">{t(label)}</span>
      <span className={`calendar-weekstats-value ${tone ? `tone-${tone}` : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function WeekStatsCell({ stats, onAskCoach }: WeekStatsCellProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const hasAny =
    stats.actualLoad > 0 ||
    stats.plannedLoad > 0 ||
    stats.activityTimeSeconds > 0 ||
    stats.distanceMeters > 0;

  return (
    <div className="calendar-weekstats">
      {stats.baseFitness !== undefined ? (
        <StatRow label={t("Base Fitness")} value={String(Math.round(stats.baseFitness))} tone="accent" />
      ) : null}
      {stats.loadImpact !== undefined ? (
        <StatRow label={t("Load Impact")} value={String(Math.round(stats.loadImpact))} tone="gold" />
      ) : null}
      {stats.loadRatio !== undefined ? (
        <StatRow
          label={t("Load Ratio")}
          value={formatNumber(stats.loadRatio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          tone="warn"
        />
      ) : null}
      <StatRow
        label={t("Training Load")}
        value={
          stats.plannedLoad > 0
            ? `${stats.actualLoad} / ${stats.plannedLoad} TL`
            : `${stats.actualLoad} TL`
        }
      />
      {stats.recommendedLoadMin !== undefined && stats.recommendedLoadMax !== undefined ? (
        <StatRow
          label={t("Target Range")}
          value={`${stats.recommendedLoadMin}–${stats.recommendedLoadMax} TL`}
        />
      ) : null}
      <StatRow
        label={t("Activity Time")}
        value={stats.activityTimeSeconds > 0 ? formatDurationSeconds(stats.activityTimeSeconds) : "--"}
      />
      <StatRow
        label={t("Distance")}
        value={
          stats.plannedDistanceKm > 0
            ? `${formatNumber(metersToDisplayDistance(stats.distanceMeters, unitSystem), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${formatNumber(metersToDisplayDistance(stats.plannedDistanceKm * 1_000, unitSystem), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${distanceUnit(unitSystem)}`
            : stats.distanceMeters > 0
              ? formatDistanceMeters(stats.distanceMeters, unitSystem)
              : "--"
        }
      />
      <StatRow
        label={t("Elev. Gain")}
        value={
          stats.elevationGain > 0
            ? `${Math.round(metersToElevation(stats.elevationGain, unitSystem))} ${elevationUnit(unitSystem)}`
            : "--"
        }
      />
      {hasAny ? (
        <button
          type="button"
          className="calendar-weekstats-coach"
          onClick={onAskCoach}
          title={t("Ask Coach about this week")}
        >
          <MessageCircle size={13} aria-hidden="true" />
          {t("Ask Coach")} </button>
      ) : null}
    </div>
  );
}
