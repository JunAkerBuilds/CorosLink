import { t, useLanguage } from "../i18n/tools";
import { useState } from "react";
import { Bookmark, CalendarDays, Check, CircleCheck, Layers, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import type {
  CoachCorosActionPreview,
  CoachCorosActionStep,
  CoachCorosActionWorkout
} from "../../electron/types";
import { sportTheme } from "../training-library/sportTheme";
import { isoDateFromCompact } from "./chatTypes";

function dateParts(iso: string | undefined) {
  if (!iso) return undefined;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    day: date.toLocaleDateString(undefined, { day: "numeric" }),
    month: date.toLocaleDateString(undefined, { month: "short" }),
    label: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  };
}

function countSteps(workout: CoachCorosActionWorkout): number {
  return workout.steps.reduce((n, step) => n + ("repeats" in step ? step.steps.length : 1), 0);
}

/** The step list of one COROS workout, in the same structure block as strength drafts. */
function CorosWorkoutStructure({ workout }: { workout: CoachCorosActionWorkout }) {
  useLanguage();
  const total = countSteps(workout);
  let number = 0;
  const renderStep = (step: CoachCorosActionStep, key: string) => {
    number += 1;
    const tone = step.kind === "recovery" ? "rest" : step.kind;
    return (
      <li key={key} className={`chat-plan-strength-step is-${tone}`}>
        <span className="chat-plan-strength-marker" aria-hidden="true">{number}</span>
        <span className="chat-plan-strength-step-copy">
          <strong>{t(step.label)}</strong>
        </span>
        <span className="chat-plan-strength-prescription">
          <strong>{step.target}</strong>
          {step.intensity ? <span>{step.intensity}</span> : null}
        </span>
      </li>
    );
  };
  return (
    <section className="chat-plan-strength-structure" aria-label={t("Session structure")}>
      <header className="chat-plan-strength-header">
        <strong>{t("Session structure")}</strong>
        <span>{total} {total === 1 ? t("step") : t("steps")}</span>
      </header>
      <ol className="chat-plan-strength-steps">
        {workout.steps.map((step, index) =>
          "repeats" in step ? (
            <li key={`group-${index}`} className="chat-plan-strength-repeat">
              <div className="chat-plan-strength-repeat-header">
                <strong>{t("Intervals")}</strong>
                <span>{step.repeats} {t("rounds")}</span>
              </div>
              <ol>{step.steps.map((child, childIndex) => renderStep(child, `group-${index}-${childIndex}`))}</ol>
            </li>
          ) : (
            renderStep(step, `step-${index}`)
          )
        )}
      </ol>
    </section>
  );
}

export function CorosActionCard({ preview, onConfirm }: {
  preview: CoachCorosActionPreview;
  onConfirm: () => Promise<CoachCorosActionPreview | undefined>;
}) {
  useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CoachCorosActionPreview>();
  const current = result ?? preview;
  const date = isoDateFromCompact(current.date);
  const parts = dateParts(date);
  const workouts = current.workouts ?? [];
  const lead = workouts[0];
  const isPlan = current.destination === "Training Plan";
  const isCalendar = current.destination === "Calendar";
  const sport = lead?.sport ?? current.sport;
  const theme = sportTheme(sport);
  const SportIcon = theme.icon;
  const sportStyle = { "--chat-plan-sport": theme.color } as CSSProperties;
  const saved = current.state === "saved";
  const stepCount = workouts.reduce((n, workout) => n + countSteps(workout), 0);
  const meta = lead
    ? isPlan
      ? `${workouts.length} ${workouts.length === 1 ? t("workout") : t("workouts")} · ${t(current.destination)}`
      : `${lead.sportLabel} · ${stepCount} ${stepCount === 1 ? t("step") : t("steps")}${parts ? ` · ${parts.label}` : ""}`
    : [t(current.destination), date].filter(Boolean).join(" · ");
  const DestinationIcon = isPlan ? Layers : isCalendar ? CalendarDays : Bookmark;
  const destinationNote = isPlan
    ? t("This plan will be saved to your COROS Training Plans{{p0}}.", { p0: parts ? t(" starting {{p0}}", { p0: parts.label }) : "" })
    : isCalendar
      ? t("This workout will be added to your COROS Calendar{{p0}}.", { p0: parts ? t(" on {{p0}}", { p0: parts.label }) : "" })
      : t("This workout will be saved to your COROS Workout Library.");
  const actionLabel = saving
    ? t("Saving…")
    : current.state === "saving"
      ? t("Check save status")
      : isPlan
        ? t("Save plan to COROS")
        : isCalendar
          ? t("Add to COROS Calendar")
          : t("Save to COROS");

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try { setResult(await onConfirm()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("Unable to save this workout.")); }
    finally { setSaving(false); }
  };

  return (
    <div className="chat-plan-card chat-workout-card chat-coros-action-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <span className="chat-workout-card-kicker">{t(current.title)}</span>
          <h4>{lead ? (isPlan ? current.summary : lead.name) : t(current.title)}</h4>
          <span className="chat-plan-card-summary">{lead && !isPlan ? current.summary : meta}</span>
        </div>
        {sport ? (
          <span className="chat-plan-sport-dot" style={sportStyle} title={lead?.sportLabel ?? sport}>
            <SportIcon size={12} strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {workouts.length > 0 ? (
        <ul className="chat-plan-entries chat-workout-entries">
          {workouts.map((workout, index) => {
            const WorkoutIcon = sportTheme(workout.sport).icon;
            return (
              <li
                key={`${workout.name}-${index}`}
                className={`chat-plan-entry is-strength${workout.steps.length ? "" : " is-rest-day"}`}
                style={{ "--chat-plan-sport": sportTheme(workout.sport).color } as CSSProperties}
              >
                <span className={`chat-plan-entry-date${parts || workout.dayNo !== undefined ? "" : " is-undated"}`}>
                  {workout.dayNo !== undefined ? (
                    <>
                      <span className="chat-plan-entry-weekday">{t("Day")}</span>
                      <span className="chat-plan-entry-day">{workout.dayNo + 1}</span>
                    </>
                  ) : parts ? (
                    <>
                      <span className="chat-plan-entry-weekday">{parts.weekday}</span>
                      <span className="chat-plan-entry-day">{parts.day}</span>
                      <span className="chat-plan-entry-month">{parts.month}</span>
                    </>
                  ) : (
                    <Bookmark size={14} aria-hidden="true" />
                  )}
                </span>
                <span className="chat-plan-entry-main">
                  <span className="chat-plan-entry-name">{workout.name}</span>
                  {workout.description ? (
                    <span className="chat-plan-entry-steps">{workout.description}</span>
                  ) : null}
                  {workout.steps.length ? <CorosWorkoutStructure workout={workout} /> : null}
                </span>
                <span className="chat-plan-entry-meta">
                  <span className="chat-plan-entry-tags">
                    <span className="chat-plan-entry-sport">
                      <WorkoutIcon size={11} strokeWidth={2.2} aria-hidden="true" />
                      {workout.sportLabel}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="chat-plan-card-summary">{current.summary}</p>
          {current.details.length > 0 && (
            <details className="chat-coros-action-details">
              <summary>{t("Workout details")}</summary>
              <ul>{current.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
            </details>
          )}
        </>
      )}

      {saved ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>{current.message ?? destinationNote}</span>
        </p>
      ) : (
        <>
          {current.message ? (
            <p role="status" className="chat-coros-action-status">
              {current.state === "saved" ? <Check size={14} aria-hidden="true" /> : null}
              {current.message}
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <p className="chat-plan-destination-summary" data-tone="ok">
            <DestinationIcon size={13} aria-hidden="true" />
            <span>{destinationNote}</span>
          </p>
          {(current.state === "pending" || current.state === "saving") && (
            <div className="chat-plan-actions">
              <button type="button" className="chat-plan-upload" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <DestinationIcon size={14} aria-hidden="true" />}
                {actionLabel}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
