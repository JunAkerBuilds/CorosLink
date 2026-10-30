import { formatNumber, useLanguage, t } from "../i18n/training";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, X } from "lucide-react";
import type { StrengthSession, UnitSystem } from "../../electron/types";
import { exerciseDisplayName } from "../strength/strengthAnalytics";
import { formatDurationSeconds, formatHappenDayLabel, happenDayFromTimestamp } from "../training/formatters";
import { kilogramsToDisplayWeight, weightUnit } from "../units/units";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  externalWorkoutName,
  externalWorkoutSeconds,
  externalWorkoutSource
} from "./externalWorkouts";
import "./calendarExternal.css";

interface ExternalWorkoutPanelProps {
  session: StrengthSession | null;
  onClose: () => void;
}

function formatWeight(kg: number, unitSystem: UnitSystem): string {
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  const value = Number.isInteger(display)
    ? formatNumber(display)
    : formatNumber(display, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${value} ${weightUnit(unitSystem)}`;
}

/** A Hevy or Strava gym session from the calendar: totals, then every set. */
export function ExternalWorkoutPanel({ session, onClose }: ExternalWorkoutPanelProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();

  return (
    <AnimatePresence>
      {session ? (
        <>
          <motion.div
            className="calendar-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="calendar-detail-panel"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <header className="calendar-detail-header">
              <div className="calendar-detail-heading">
                <p className="eyebrow">
                  {formatHappenDayLabel(happenDayFromTimestamp(session.startTime) ?? "")}
                  {" · "}
                  {externalWorkoutSource(session)}
                </p>
                <h3>{externalWorkoutName(session)}</h3>
              </div>
              <div className="calendar-detail-actions">
                {session.strava?.url ? (
                  <a
                    className="ghost-button calendar-detail-action"
                    href={session.strava.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("View on Strava")}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                ) : null}
                <button
                  type="button"
                  className="ghost-button calendar-detail-action"
                  onClick={onClose}
                  aria-label={t("Close details")}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="calendar-detail-body external-workout">
              <dl className="external-workout-stats">
                {[
                  { label: t("Duration"), value: externalWorkoutSeconds(session) ? formatDurationSeconds(externalWorkoutSeconds(session)) : undefined },
                  { label: t("Sets"), value: session.detail.summary.sets > 0 ? formatNumber(session.detail.summary.sets) : undefined },
                  { label: t("Reps"), value: session.detail.summary.totalReps > 0 ? formatNumber(session.detail.summary.totalReps) : undefined },
                  { label: t("Volume"), value: session.detail.summary.totalWeightKg > 0 ? formatWeight(session.detail.summary.totalWeightKg, unitSystem) : undefined },
                  { label: t("Avg HR"), value: session.avgHr ? formatNumber(Math.round(session.avgHr)) : undefined },
                  { label: t("Calories"), value: session.calories ? formatNumber(Math.round(session.calories)) : undefined }
                ]
                  .filter((stat) => stat.value !== undefined)
                  .map((stat) => (
                    <div key={stat.label} className="external-workout-stat">
                      <dt>{stat.label}</dt>
                      <dd>{stat.value}</dd>
                    </div>
                  ))}
              </dl>

              {session.strava?.description ? (
                <section className="external-workout-notes">
                  <h4>{t("Notes")}</h4>
                  <p>{session.strava.description}</p>
                </section>
              ) : null}

              {session.detail.exercises.length > 0 ? (
                <ol className="external-workout-exercises">
                  {session.detail.exercises.map((exercise, index) => (
                    <li key={`${exercise.nameKey}-${index}`} className="external-workout-exercise">
                      <h4>{t(exerciseDisplayName(exercise.nameKey, exercise.rawName))}</h4>
                      <ol className="external-workout-sets">
                        {exercise.entries.map((set, setIndex, entries) => (
                          <li key={setIndex} className={set.type === "warmup" ? "is-warmup" : undefined}>
                            <span className="external-workout-set-index">
                              {set.type === "warmup"
                                ? t("Warm-up")
                                : entries.slice(0, setIndex + 1).filter((entry) => entry.type !== "warmup").length}
                            </span>
                            <span>
                              {set.weightKg > 0 ? `${formatWeight(set.weightKg, unitSystem)} × ${set.reps}` : set.reps > 0 ? `× ${set.reps}` : set.workSec > 0 ? formatDurationSeconds(set.workSec) : "—"}
                            </span>
                            {set.rpe ? <span className="external-workout-set-rpe">RPE {formatNumber(set.rpe)}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
