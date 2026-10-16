import { t, useLanguage } from "../i18n/tools";
import { useState } from "react";
import {
  Bookmark,
  CalendarDays,
  Check,
  CircleCheck,
  Layers,
  ListChecks,
  Loader2,
  Route,
  Timer
} from "lucide-react";
import type {
  CoachCorosActionPreview,
  CoachCorosActionStep,
  CoachCorosActionWorkout,
  WorkoutSport
} from "../../electron/types";
import { sportTheme } from "../training-library/sportTheme";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { CardioStructure } from "../calendar/ScheduledWorkoutDetail";
import {
  formatStepDistanceLabel,
  formatStepTimeLabel,
  type ScheduledNodeView,
  type ScheduledStepView,
  type ScheduledStructureView
} from "../calendar/scheduledStructure";
import { isoDateFromCompact } from "./chatTypes";

const LEGACY_SPORTS: Record<string, WorkoutSport | undefined> = { Run: "run", Bike: "bike", "Trail run": "trailRun", "Rest day": undefined };
const LEGACY_KINDS: Record<string, CoachCorosActionStep["kind"]> = { "Warm-up": "warmup", Training: "training", Recovery: "recovery", "Cool-down": "cooldown" };
const SPORT_CATEGORY: Partial<Record<WorkoutSport, string>> = { run: "run", trailRun: "trail", bike: "bike", strength: "strength" };

/** Parse a display target ("1.20 km", "400 m", "10 min", "20 s", "4:30") back into a bar magnitude. */
function targetMagnitude(target: string): Pick<CoachCorosActionStep, "magnitude" | "magnitudeType"> {
  const text = target.trim();
  let match = /^([\d.]+)\s*(km|mi|m)$/.exec(text);
  if (match) {
    const value = Number(match[1]);
    const meters = match[2] === "km" ? value * 1000 : match[2] === "mi" ? value * 1609.344 : value;
    return { magnitude: meters, magnitudeType: "distance" };
  }
  match = /^(\d+)\s*min$/.exec(text);
  if (match) return { magnitude: Number(match[1]) * 60, magnitudeType: "time" };
  match = /^(\d+)\s*s$/.exec(text);
  if (match) return { magnitude: Number(match[1]), magnitudeType: "time" };
  match = /^(\d+):(\d{2})$/.exec(text);
  if (match) return { magnitude: Number(match[1]) * 60 + Number(match[2]), magnitudeType: "time" };
  return {};
}

function legacyStep(line: string): CoachCorosActionStep | undefined {
  const match = /^(Warm-up|Training|Recovery|Cool-down): (.+?)(?: · (.+))?$/.exec(line.trim());
  if (!match) return undefined;
  const intensity = match[3] && match[3] !== "No intensity target" ? match[3] : undefined;
  return { kind: LEGACY_KINDS[match[1]!], label: match[1]!, target: match[2]!, ...(intensity ? { intensity } : {}), ...targetMagnitude(match[2]!) };
}

/** Actions staged before structured workouts existed only kept summary lines; rebuild the structure from them. */
function legacyWorkouts(details: string[]): CoachCorosActionWorkout[] {
  const workouts: CoachCorosActionWorkout[] = [];
  let current: CoachCorosActionWorkout | undefined;
  for (const line of details) {
    const header = /^(?:Day (\d+) · )?(Run|Bike|Rest day|Trail run) · (.+)$/.exec(line);
    if (header) {
      current = { name: header[3]!, sportLabel: header[2]!, steps: [], ...(LEGACY_SPORTS[header[2]!] ? { sport: LEGACY_SPORTS[header[2]!] } : {}), ...(header[1] ? { dayNo: Number(header[1]) - 1 } : {}) };
      workouts.push(current);
      continue;
    }
    if (!current) continue;
    const group = /^(\d+) × \((.+)\)$/.exec(line);
    if (group) {
      const steps = group[2]!.split("; ").map(legacyStep).filter((step): step is CoachCorosActionStep => Boolean(step));
      if (steps.length) current.steps.push({ repeats: Number(group[1]), steps });
      continue;
    }
    const step = legacyStep(line);
    if (step) current.steps.push(step);
    else if (!current.description && !current.steps.length) current.description = line;
  }
  return workouts;
}

/** Shape a staged COROS workout like a scheduled one so it shares the calendar's structure view. */
function structureView(workout: CoachCorosActionWorkout): ScheduledStructureView {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let stepCount = 0;
  let repeatGroups = 0;
  const toStep = (step: CoachCorosActionStep, id: string): ScheduledStepView => {
    const magnitude = step.magnitude ?? targetMagnitude(step.target).magnitude;
    const magnitudeType = step.magnitudeType ?? targetMagnitude(step.target).magnitudeType;
    stepCount += 1;
    return {
      id,
      kind: step.kind === "recovery" ? "rest" : step.kind,
      name: t(step.label),
      targetLabel: step.target,
      ...(step.intensity ? { intensityLabel: step.intensity } : {}),
      ...(magnitude !== undefined && magnitudeType ? { magnitude, magnitudeType } : {})
    };
  };
  const nodes: ScheduledNodeView[] = workout.steps.map((node, index) => {
    if ("repeats" in node) {
      repeatGroups += 1;
      const steps = node.steps.map((step, childIndex) => toStep(step, `g${index}-${childIndex}`));
      const types = new Set(steps.map((step) => step.magnitudeType).filter(Boolean));
      const magnitudeType = types.size === 1 ? steps[0]?.magnitudeType : undefined;
      const magnitude = magnitudeType ? steps.reduce((sum, step) => sum + (step.magnitude ?? 0), 0) : undefined;
      for (const step of steps) {
        if (step.magnitudeType === "distance") distanceMeters += (step.magnitude ?? 0) * node.repeats;
        if (step.magnitudeType === "time") durationSeconds += (step.magnitude ?? 0) * node.repeats;
      }
      return { type: "repeat", id: `g${index}`, name: t("Intervals"), repeat: node.repeats, steps, ...(magnitude !== undefined && magnitudeType ? { magnitude, magnitudeType } : {}) };
    }
    const step = toStep(node, `s${index}`);
    if (step.magnitudeType === "distance") distanceMeters += step.magnitude ?? 0;
    if (step.magnitudeType === "time") durationSeconds += step.magnitude ?? 0;
    return { type: "step", step };
  });
  return {
    nodes,
    totals: { ...(distanceMeters ? { distanceMeters } : {}), ...(durationSeconds ? { durationSeconds } : {}), stepCount, repeatGroups },
    source: "parsed"
  };
}

function dateLabel(iso: string | undefined, style: "short" | "long") {
  if (!iso) return undefined;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return style === "short"
    ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function CorosWorkoutDetail({ workout, date }: { workout: CoachCorosActionWorkout; date?: string }) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const view = structureView(workout);
  const SportIcon = sportTheme(workout.sport).icon;
  const category = (workout.sport && SPORT_CATEGORY[workout.sport]) ?? "other";
  const hasRepeat = view.totals.repeatGroups > 0;
  const stats: Array<{ icon: typeof Route; label: string; value: string }> = [];
  if (view.totals.distanceMeters) stats.push({ icon: Route, label: t("Distance"), value: formatStepDistanceLabel(view.totals.distanceMeters, unitSystem) });
  if (view.totals.durationSeconds) stats.push({ icon: Timer, label: t("Timed work"), value: formatStepTimeLabel(view.totals.durationSeconds) });
  if (date) stats.push({ icon: CalendarDays, label: workout.dayNo !== undefined ? t("Day {{p0}}", { p0: workout.dayNo + 1 }) : t("Scheduled"), value: dateLabel(date, "short") ?? date });
  const context = view.totals.stepCount
    ? `${view.totals.stepCount} ${view.totals.stepCount === 1 ? t("step") : t("steps")}${hasRepeat ? `, ${view.totals.repeatGroups} ${view.totals.repeatGroups === 1 ? t("repeat group") : t("repeat groups")}` : ""}`
    : undefined;

  return (
    <div className={`sched-detail chat-coros-detail is-${category}`}>
      <div className="sched-hero">
        <div className="sched-hero-top">
          <span className="sched-hero-icon" aria-hidden="true"><SportIcon size={20} /></span>
          <div className="sched-hero-title">
            <div className="sched-hero-heading">
              <span className="sched-hero-sport">{workout.sportLabel}</span>
              {hasRepeat ? <span className="sched-hero-chip">{t("Intervals")}</span> : null}
            </div>
            {context ? (
              <span className="sched-hero-context">
                <Layers size={12} aria-hidden="true" />
                {context}
              </span>
            ) : null}
          </div>
        </div>
        {stats.length ? (
          <dl className={`sched-hero-stats is-${stats.length}`}>
            {stats.map((stat) => (
              <div className="sched-stat" key={stat.label}>
                <dt className="sched-stat-label"><stat.icon size={12} aria-hidden="true" />{stat.label}</dt>
                <dd className="sched-stat-value">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {view.nodes.length ? (
        <div className="sched-structure">
          <div className="sched-structure-head">
            <h4><ListChecks size={14} aria-hidden="true" />{t("Workout structure")}</h4>
            {view.totals.distanceMeters ? (
              <span className="sched-structure-total">{formatStepDistanceLabel(view.totals.distanceMeters, unitSystem)} {t("total")}</span>
            ) : null}
          </div>
          <CardioStructure view={view} unitSystem={unitSystem} swim={false} />
        </div>
      ) : (
        <div className="sched-empty">
          <ListChecks size={18} aria-hidden="true" />
          <p>{t("No structured steps — this workout runs by feel.")}</p>
        </div>
      )}
    </div>
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
  const workouts = current.workouts ?? legacyWorkouts(current.details);
  const lead = workouts[0];
  const isPlan = current.destination === "Training Plan";
  const isCalendar = current.destination === "Calendar";
  const saved = current.state === "saved";
  const when = dateLabel(date, "short");
  const DestinationIcon = isPlan ? Layers : isCalendar ? CalendarDays : Bookmark;
  const destinationNote = isPlan
    ? t("Saves to your COROS Training Plans{{p0}}.", { p0: when ? t(" starting {{p0}}", { p0: when }) : "" })
    : isCalendar
      ? t("Adds to your COROS Calendar{{p0}}.", { p0: when ? t(" on {{p0}}", { p0: when }) : "" })
      : t("Saves to your COROS Workout Library.");
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
          <span className="chat-workout-card-kicker">{when ? `${t(current.title)} · ${when}` : t(current.title)}</span>
          <h4>{lead ? (isPlan ? current.summary : lead.name) : t(current.title)}</h4>
          {!lead || isPlan ? <span className="chat-plan-card-summary">{isPlan ? t(current.destination) : current.summary}</span> : null}
        </div>
      </div>

      {workouts.length ? (
        <div className="chat-coros-workouts">
          {workouts.map((workout, index) => (
            <CorosWorkoutDetail key={`${workout.name}-${index}`} workout={workout} date={date} />
          ))}
        </div>
      ) : current.details.length > 0 ? (
        <details className="chat-coros-action-details">
          <summary>{t("Workout details")}</summary>
          <ul>{current.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </details>
      ) : null}

      {lead && !isPlan ? (
        <details className="chat-coros-action-details">
          <summary>{t("Coach's note")}</summary>
          <p className="chat-coros-action-note">{current.summary}</p>
        </details>
      ) : null}

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
          {(current.state === "pending" || current.state === "saving") && (
            <div className="chat-plan-actions">
              <button type="button" className="chat-plan-upload" onClick={() => void save()} disabled={saving} title={destinationNote}>
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
