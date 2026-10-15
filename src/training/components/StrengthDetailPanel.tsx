import { useLanguage, t } from "../../i18n/training";
import type { StrengthDetail } from "../../../electron/types";
import { formatDurationSeconds, formatOptionalNumber } from "../formatters";
import { resolveExerciseName } from "../exerciseNames";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatVolumeKg, formatWeightKg } from "../../strength/strengthAnalytics";

function StatTile({ label, value }: { label: string; value: string }) {
  useLanguage();
  return (
    <div className="activity-detail-stat">
      <span>{t(label)}</span>
      <strong>{value}</strong>
    </div>
  );
}

function restLabel(seconds: number): string {
  return seconds > 0 ? formatDurationSeconds(seconds) : "—";
}

// Resolve a display name, falling back to a generic "Exercise N" label when the
// key is still an unresolved COROS code (rare: an exercise absent from both the
// catalogue dictionary and the body-region table).
function displayExerciseName(
  nameKey: string,
  rawName: string | undefined,
  index: number
): string {
  const resolved = resolveExerciseName(nameKey, rawName);
  return /^[TS]\d/.test(resolved) ? `Exercise ${index + 1}` : resolved;
}

export function StrengthDetailPanel({ strength }: { strength: StrengthDetail }) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const { summary, exercises } = strength;
  return (
    <div className="strength-detail">
      <div className="activity-detail-grid">
        <StatTile label={t("Sets")} value={String(summary.sets)} />
        <StatTile label={t("Reps")} value={String(summary.totalReps)} />
        <StatTile label={t("Total Weight")} value={formatVolumeKg(summary.totalWeightKg, unitSystem)} />
        <StatTile label={t("Calories")} value={String(summary.calories)} />
        <StatTile label={t("Duration")} value={formatDurationSeconds(summary.durationSec)} />
        {summary.avgHr !== undefined ? (
          <StatTile label={t("Avg HR")} value={formatOptionalNumber(summary.avgHr)} />
        ) : null}
        {summary.maxHr !== undefined ? (
          <StatTile label={t("Max HR")} value={formatOptionalNumber(summary.maxHr)} />
        ) : null}
        {summary.trainingLoad !== undefined ? (
          <StatTile label={t("Training Load")} value={formatOptionalNumber(summary.trainingLoad)} />
        ) : null}
        {summary.aerobicEffect !== undefined ? (
          <StatTile label={t("Aerobic")} value={summary.aerobicEffect.toFixed(1)} />
        ) : null}
        {summary.anaerobicEffect !== undefined ? (
          <StatTile label={t("Anaerobic")} value={summary.anaerobicEffect.toFixed(1)} />
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
                {index + 1}. {displayExerciseName(exercise.nameKey, exercise.rawName, index)}
              </span>
              <span className="strength-exercise-meta">
                {exercise.sets} {t("sets ·")} {exercise.totalReps} {t("reps")} </span>
            </h3>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("Set")}</th>
                    <th>{t("Reps")}</th>
                    <th>{t("Weight")}</th>
                    <th>{t("Time")}</th>
                    <th>{t("Rest")}</th>
                    <th>{t("Cal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {exercise.entries.map((entry, setIndex) => (
                    <tr key={setIndex}>
                      <td>{setIndex + 1}</td>
                      <td>{entry.reps}</td>
                      <td>{entry.weightKg > 0 ? formatWeightKg(entry.weightKg, unitSystem) : "—"}</td>
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
