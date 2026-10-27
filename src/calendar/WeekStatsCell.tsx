import { formatNumber, useLanguage, t } from "../i18n/training";
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Grip,
  HeartPulse,
  Medal,
  MessageCircle,
  Mountain,
  MountainSnow,
  PersonStanding,
  Sailboat,
  Snowflake,
  Waves,
  type LucideIcon
} from "lucide-react";
import type { UnitSystem } from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds
} from "../training/formatters";
import type { WeeklyStats } from "./calendarTypes";
import type { WeekSportFamily, WeekSportTotals } from "./weekSportBreakdown";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation,
  metersToSwimDistance,
  swimDistanceUnit
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

export const WEEK_SPORT_ICONS: Record<WeekSportFamily, LucideIcon> = {
  run: Footprints,
  trail: Mountain,
  hike: MountainSnow,
  bike: Bike,
  swim: Waves,
  strength: Dumbbell,
  cardio: HeartPulse,
  walk: PersonStanding,
  ski: Snowflake,
  water: Sailboat,
  climb: Grip,
  multisport: Medal,
  other: Activity
};

function formatActualPlannedDistance(
  meters: number,
  plannedKm: number,
  unitSystem: UnitSystem,
  swim: boolean
): string | undefined {
  if (plannedKm > 0) {
    const plannedMeters = plannedKm * 1_000;
    return swim
      ? `${Math.round(metersToSwimDistance(meters, unitSystem))} / ${Math.round(metersToSwimDistance(plannedMeters, unitSystem))} ${swimDistanceUnit(unitSystem)}`
      : `${formatNumber(metersToDisplayDistance(meters, unitSystem), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${formatNumber(metersToDisplayDistance(plannedMeters, unitSystem), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${distanceUnit(unitSystem)}`;
  }
  return meters > 0 ? formatDistanceMeters(meters, unitSystem, swim) : undefined;
}

function SportBreakdownRow({
  sport,
  unitSystem
}: {
  sport: WeekSportTotals;
  unitSystem: UnitSystem;
}) {
  useLanguage();
  const Icon = WEEK_SPORT_ICONS[sport.family];
  const time =
    sport.plannedTimeSeconds > 0
      ? `${formatDurationSeconds(sport.activityTimeSeconds)} / ${formatDurationSeconds(sport.plannedTimeSeconds)}`
      : formatDurationSeconds(sport.activityTimeSeconds);
  const distance = formatActualPlannedDistance(
    sport.distanceMeters,
    sport.plannedDistanceKm,
    unitSystem,
    sport.family === "swim"
  );

  return (
    <li className="calendar-weekstats-sport">
      <div className="calendar-weekstats-row">
        <span className="calendar-weekstats-sport-name">
          <Icon
            size={13}
            aria-hidden="true"
            style={{ color: `var(--sport-${sport.color})` }}
          />
          <span className="calendar-weekstats-sport-label">{t(sport.label)}</span>
        </span>
        <span className="calendar-weekstats-value">
          {sport.plannedLoad > 0
            ? `${sport.actualLoad} / ${sport.plannedLoad} ${t("TL")}`
            : `${sport.actualLoad} ${t("TL")}`}
        </span>
      </div>
      <div className="calendar-weekstats-sport-meta">
        <span>{time}</span>
        {distance ? <span>{distance}</span> : null}
      </div>
    </li>
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
        value={
          stats.plannedTimeSeconds > 0
            ? `${formatDurationSeconds(stats.activityTimeSeconds)} / ${formatDurationSeconds(stats.plannedTimeSeconds)}`
            : stats.activityTimeSeconds > 0
              ? formatDurationSeconds(stats.activityTimeSeconds)
              : "--"
        }
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
      {stats.sports.length > 0 ? (
        <ul className="calendar-weekstats-sports" aria-label={t("By sport")}>
          {stats.sports.map((sport) => (
            <SportBreakdownRow key={sport.key} sport={sport} unitSystem={unitSystem} />
          ))}
        </ul>
      ) : null}
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
