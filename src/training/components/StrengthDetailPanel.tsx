import type { StrengthDetail } from "../../../electron/types";
import { formatDurationSeconds, formatOptionalNumber } from "../formatters";
import { resolveExerciseName } from "../exerciseNames";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function restLabel(seconds: number): string {
  return seconds > 0 ? formatDurationSeconds(seconds) : "—";
}

export function StrengthDetailPanel({ strength }: { strength: StrengthDetail }) {
  const { summary, exercises } = strength;
  return (
    <div className="strength-detail">
      <div className="activity-detail-grid">
        <StatTile label="Sets" value={String(summary.sets)} />
        <StatTile label="Reps" value={String(summary.totalReps)} />
        <StatTile label="Total Weight" value={`${summary.totalWeightKg} kg`} />
        <StatTile label="Calories" value={String(summary.calories)} />
        <StatTile label="Duration" value={formatDurationSeconds(summary.durationSec)} />
        {summary.avgHr !== undefined ? (
          <StatTile label="Avg HR" value={formatOptionalNumber(summary.avgHr)} />
        ) : null}
        {summary.maxHr !== undefined ? (
          <StatTile label="Max HR" value={formatOptionalNumber(summary.maxHr)} />
        ) : null}
        {summary.trainingLoad !== undefined ? (
          <StatTile label="Training Load" value={formatOptionalNumber(summary.trainingLoad)} />
        ) : null}
        {summary.aerobicEffect !== undefined ? (
          <StatTile label="Aerobic" value={summary.aerobicEffect.toFixed(1)} />
        ) : null}
        {summary.anaerobicEffect !== undefined ? (
          <StatTile label="Anaerobic" value={summary.anaerobicEffect.toFixed(1)} />
        ) : null}
      </div>

      <div className="strength-exercise-list">
        {exercises.map((exercise, index) => (
          <section
            className="strength-exercise"
            key={`${exercise.nameKey}-${index}`}
          >
            <h3 className="strength-exercise-head">
              <span className="strength-exercise-name">
                {index + 1}. {resolveExerciseName(exercise.nameKey, exercise.rawName)}
              </span>
              <span className="strength-exercise-meta">
                {exercise.sets} sets · {exercise.totalReps} reps
              </span>
            </h3>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Set</th>
                    <th>Reps</th>
                    <th>Weight</th>
                    <th>Time</th>
                    <th>Rest</th>
                    <th>Cal</th>
                  </tr>
                </thead>
                <tbody>
                  {exercise.entries.map((entry, setIndex) => (
                    <tr key={setIndex}>
                      <td>{setIndex + 1}</td>
                      <td>{entry.reps}</td>
                      <td>{entry.weightKg > 0 ? `${entry.weightKg} kg` : "—"}</td>
                      <td>{formatDurationSeconds(entry.workSec)}</td>
                      <td>{restLabel(entry.restSec)}</td>
                      <td>{entry.calories}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
