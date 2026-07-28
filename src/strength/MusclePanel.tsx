import type { ReactNode } from "react";
import { Flame, History, Layers, Repeat2, Weight } from "lucide-react";
import { MUSCLE_BY_ID, MUSCLES, type MuscleId } from "./muscles";
import {
  daysSince,
  formatDaysSince,
  formatSets,
  formatVolumeKg,
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat
} from "./strengthAnalytics";
import { formatDurationSeconds } from "../training/formatters";

interface MusclePanelProps {
  muscles: MuscleStat[];
  muscleById: Record<MuscleId, MuscleStat>;
  metric: HeatMetric;
  max: number;
  active: MuscleId | null;
  onSelect: (muscle: MuscleId | null) => void;
  onHover: (muscle: MuscleId | null) => void;
}

function metricLabel(metric: HeatMetric): string {
  if (metric === "volume") return "Volume";
  if (metric === "time") return "Time under load";
  return "Sets";
}

function formatMetric(value: number, metric: HeatMetric): string {
  if (metric === "volume") return formatVolumeKg(value);
  if (metric === "time") return formatDurationSeconds(Math.round(value));
  return `${formatSets(value)} sets`;
}

/** Ranked list of every muscle, doubling as the body map's legend. */
function MuscleRanking({
  muscles,
  metric,
  max,
  onSelect,
  onHover
}: Pick<MusclePanelProps, "muscles" | "metric" | "max" | "onSelect" | "onHover">) {
  const ranked = [...muscles].sort(
    (a, b) => metricValue(b, metric) - metricValue(a, metric)
  );

  return (
    <ul className="muscle-ranking">
      {ranked.map((stat) => {
        const value = metricValue(stat, metric);
        const share = max > 0 ? Math.min(1, value / max) : 0;
        const meta = MUSCLE_BY_ID[stat.muscle];
        return (
          <li key={stat.muscle}>
            <button
              type="button"
              className={`muscle-ranking-row${value <= 0 ? " is-empty" : ""}`}
              onClick={() => onSelect(stat.muscle)}
              onPointerEnter={() => onHover(stat.muscle)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(stat.muscle)}
              onBlur={() => onHover(null)}
            >
              <span className="muscle-ranking-name">{meta.label}</span>
              <span className="muscle-ranking-track" aria-hidden="true">
                <span
                  className="muscle-ranking-fill"
                  data-level={heatLevel(value, max)}
                  style={{ transform: `scaleX(${share})` }}
                />
              </span>
              <span className="muscle-ranking-value">
                {value > 0 ? formatMetric(value, metric) : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DetailStat({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="muscle-detail-stat">
      <span className="muscle-detail-stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="muscle-detail-stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

export function MusclePanel({
  muscles,
  muscleById,
  metric,
  max,
  active,
  onSelect,
  onHover
}: MusclePanelProps) {
  if (!active) {
    const untrained = MUSCLES.filter(
      (muscle) => muscleById[muscle.id].sets <= 0
    );
    return (
      <div className="muscle-panel">
        <header className="muscle-panel-head">
          <p className="eyebrow">{metricLabel(metric)} by muscle</p>
          <h3>Coverage</h3>
          <p className="muscle-panel-lead">
            Hover the figure or a row to isolate a muscle group.
          </p>
        </header>
        <MuscleRanking
          muscles={muscles}
          metric={metric}
          max={max}
          onSelect={onSelect}
          onHover={onHover}
        />
        {untrained.length > 0 ? (
          <p className="muscle-panel-gap">
            <strong>Untrained:</strong>{" "}
            {untrained.map((muscle) => muscle.label).join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  const stat = muscleById[active];
  const meta = MUSCLE_BY_ID[active];
  const staleness = daysSince(stat.lastTrained);

  return (
    <div className="muscle-panel is-detail">
      <header className="muscle-panel-head">
        <p className="eyebrow">{meta.anatomy}</p>
        <h3>{meta.label}</h3>
        <button
          type="button"
          className="muscle-panel-clear"
          onClick={() => onSelect(null)}
        >
          Back to all muscles
        </button>
      </header>

      <div
        className={`muscle-freshness${
          staleness !== undefined && staleness <= 2 ? " is-fresh" : ""
        }`}
      >
        <History size={14} aria-hidden="true" />
        <span>Last trained</span>
        <strong>{formatDaysSince(stat.lastTrained)}</strong>
      </div>

      <div className="muscle-detail-grid">
        <DetailStat
          icon={<Layers size={15} />}
          label="Sets"
          value={formatSets(stat.sets)}
        />
        <DetailStat
          icon={<Repeat2 size={15} />}
          label="Reps"
          value={String(Math.round(stat.reps))}
        />
        <DetailStat
          icon={<Weight size={15} />}
          label="Volume"
          value={stat.volumeKg > 0 ? formatVolumeKg(stat.volumeKg) : "Bodyweight"}
        />
        <DetailStat
          icon={<Flame size={15} />}
          label="Sessions"
          value={String(stat.sessions)}
        />
      </div>

      {stat.topExercises.length > 0 ? (
        <div className="muscle-exercises">
          <p className="eyebrow">Driven by</p>
          <ul>
            {stat.topExercises.map((exercise) => {
              const share =
                stat.sets > 0 ? Math.min(1, exercise.sets / stat.sets) : 0;
              return (
                <li key={exercise.name}>
                  <span className="muscle-exercise-name">{exercise.name}</span>
                  <span className="muscle-exercise-track" aria-hidden="true">
                    <span
                      className="muscle-exercise-fill"
                      style={{ transform: `scaleX(${share})` }}
                    />
                  </span>
                  <span className="muscle-exercise-value">
                    {formatSets(exercise.sets)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="muscle-panel-gap">
          No sets landed on this muscle in the selected window.
        </p>
      )}
    </div>
  );
}
