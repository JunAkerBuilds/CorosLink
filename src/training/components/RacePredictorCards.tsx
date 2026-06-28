import { Timer } from "lucide-react";
import type { TrainingHubRacePredictor } from "../../../electron/types";
import {
  formatDurationSeconds,
  formatPaceSecondsPerKm
} from "../formatters";

interface RacePredictorCardsProps {
  racePredictor: TrainingHubRacePredictor | null;
}

function hasPace(value?: number): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function RacePredictorCards({ racePredictor }: RacePredictorCardsProps) {
  const scores = racePredictor?.runScoreList ?? [];
  const runningLevel = racePredictor?.staminaLevel;

  return (
    <section className="panel training-race-panel">
      <header className="training-race-header">
        <div className="training-race-heading">
          <p className="eyebrow">Race Predictor</p>
          <h2>Estimated finish times</h2>
          {runningLevel !== undefined && Number.isFinite(runningLevel) ? (
            <p className="training-race-level">
              Running level {Math.round(runningLevel)}
            </p>
          ) : null}
        </div>
        <Timer size={22} aria-hidden="true" />
      </header>

      {scores.length > 0 ? (
        <div className="race-card-grid">
          {scores.map((score, index) => {
            const label =
              score.distanceLabel ??
              (score.distance
                ? `${(score.distance / 1000).toFixed(1)} km`
                : `Race ${index + 1}`);
            const paceLabel = hasPace(score.avgPace)
              ? formatPaceSecondsPerKm(score.avgPace)
              : null;

            return (
              <article
                key={`${label}-${score.predictSeconds ?? index}`}
                className="race-card"
              >
                <span className="race-card-badge">{label}</span>
                <strong className="race-card-time">
                  {score.predictSeconds
                    ? formatDurationSeconds(score.predictSeconds)
                    : "-"}
                </strong>
                {paceLabel ? (
                  <span className="race-card-pace">{paceLabel}</span>
                ) : score.score !== undefined ? (
                  <span className="race-card-pace">
                    Score {Math.round(score.score)}
                  </span>
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
    </section>
  );
}
