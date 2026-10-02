import { useId } from "react";
import type { ChartCardSize } from "../widgetSizing";
import "../chartSizing.css";
import "../profileSizing.css";
import "../racePredictor.css";
import { Timer } from "lucide-react";
import type { TrainingHubRacePredictor } from "../../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatPaceSecondsPerKm
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";

interface RacePredictorCardsProps {
  size?: ChartCardSize;
  racePredictor: TrainingHubRacePredictor | null;
}

function hasPace(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

const LEVEL_RING_RADIUS = 22;
const LEVEL_RING_LENGTH = 2 * Math.PI * LEVEL_RING_RADIUS;
const LEVEL_TICK_COUNT = 48;

/** Map each pace onto 0.35..1 so the fastest race fills its line and slower ones taper. */
function paceBarRatio(pace: number, fastest: number, slowest: number): number {
  if (slowest <= fastest) return 1;
  return 1 - ((pace - fastest) / (slowest - fastest)) * 0.65;
}

function LevelRing({ level }: { level: number }) {
  const gradientId = useId();
  const ratio = Math.min(Math.max(level / 100, 0), 1);
  const litTicks = Math.round(ratio * LEVEL_TICK_COUNT);

  return (
    <div className="race-level-ring" role="img" aria-label={`Running level ${Math.round(level)}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-strong)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <g className="race-level-ticks">
          {Array.from({ length: LEVEL_TICK_COUNT }, (_, tick) => (
            <line
              key={tick}
              className={tick < litTicks ? "is-lit" : undefined}
              x1="32"
              y1="1.5"
              x2="32"
              y2={tick % 12 === 0 ? 5.5 : 4}
              transform={`rotate(${(tick * 360) / LEVEL_TICK_COUNT} 32 32)`}
            />
          ))}
        </g>
        <circle className="race-level-ring-track" cx="32" cy="32" r={LEVEL_RING_RADIUS} />
        <circle
          className="race-level-ring-fill"
          cx="32"
          cy="32"
          r={LEVEL_RING_RADIUS}
          stroke={`url(#${gradientId})`}
          strokeDasharray={LEVEL_RING_LENGTH}
          strokeDashoffset={LEVEL_RING_LENGTH * (1 - ratio)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <strong>{Math.round(level)}</strong>
      <span>Level</span>
    </div>
  );
}

export function RacePredictorCards({ racePredictor, size }: RacePredictorCardsProps) {
  const { unitSystem } = useUnitSystem();
  const scores = racePredictor?.runScoreList ?? [];
  const runningLevel = racePredictor?.staminaLevel;
  const hasLevel = runningLevel !== undefined && Number.isFinite(runningLevel);
  const paces = scores.map((score) => score.avgPace).filter(hasPace);
  const fastestPace = paces.length ? Math.min(...paces) : 0;
  const slowestPace = paces.length ? Math.max(...paces) : 0;
  const paceFadePct =
    paces.length > 1 && fastestPace > 0
      ? Math.round(((slowestPace - fastestPace) / fastestPace) * 100)
      : null;

  const labelFor = (index: number) => {
    const score = scores[index];
    return (
      score?.distanceLabel ??
      (score?.distance ? formatDistanceMeters(score.distance, unitSystem) : `Race ${index + 1}`)
    );
  };

  return (
    <section className="panel training-race-panel" data-chart-size={size}>
      <header className="training-race-header">
        <div className="training-race-heading">
          <p className="eyebrow">Race Predictor</p>
          <h2>Estimated finish times</h2>
        </div>
        {hasLevel ? (
          <LevelRing level={runningLevel} />
        ) : (
          <span className="training-panel-icon" aria-hidden="true">
            <Timer />
          </span>
        )}
      </header>

      {scores.length > 0 ? (
        <div className="race-card-grid">
          {scores.map((score, index) => {
            const label = labelFor(index);
            const paceLabel = hasPace(score.avgPace)
              ? formatPaceSecondsPerKm(score.avgPace, unitSystem)
              : null;

            return (
              <article
                key={`${label}-${score.predictSeconds ?? index}`}
                className="race-card"
                style={{ animationDelay: `${index * 0.07}s` }}
              >
                <span className="race-card-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="race-card-badge">{label}</span>
                <strong className="race-card-time">
                  {score.predictSeconds
                    ? formatDurationSeconds(score.predictSeconds)
                    : "-"}
                </strong>
                {hasPace(score.avgPace) ? (
                  <span className="race-card-track" aria-hidden="true">
                    <span
                      className="race-card-track-fill"
                      style={{
                        width: `${paceBarRatio(score.avgPace, fastestPace, slowestPace) * 100}%`,
                        animationDelay: `${0.2 + index * 0.07}s`
                      }}
                    />
                  </span>
                ) : null}
                {paceLabel ? (
                  <span className="race-card-pace">{paceLabel}</span>
                ) : score.score !== undefined ? (
                  <span className="race-card-pace">Score {Math.round(score.score)}</span>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="training-empty-state">
          <p>
            No race predictions available yet. Complete more runs to unlock
            estimates.
          </p>
        </div>
      )}

      {paceFadePct !== null && paceFadePct > 0 ? (
        <footer className="race-card-footer">
          <span>Pace fade</span>
          <span className="race-card-footer-route">
            {labelFor(0)}
            <i aria-hidden="true" />
            {labelFor(scores.length - 1)}
          </span>
          <strong>+{paceFadePct}%</strong>
        </footer>
      ) : null}
    </section>
  );
}
