import { formatWorkoutSport } from "../calendar/workoutLabels";
import { getLocale, useLanguage, t } from "../i18n/training";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarRange,
  CalendarPlus,
  CalendarX,
  CloudOff,
  Copy,
  Moon,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import type {
  PlanWorkoutEntryInput,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanEntry,
  WorkoutSport
} from "../../electron/types";
import {
  duplicateTrainingPlanWeek,
  activeTrainingPlanCalendarInstall,
  insertRecoveryWeek,
  planEntryFromWorkout,
  reorderTrainingPlanWeek,
  shiftTrainingPlan,
  summarizeTrainingPlan,
  trainingPlanCalendarRevision,
  validateTrainingPlan,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import { WORKOUT_SPORTS } from "../../electron/workoutCapabilities";
import type { CorosLinkApi } from "../coroslink-api";
import { WorkoutEditorModal } from "../calendar/WorkoutEditorModal";
import { SelectDropdown } from "../components/SelectDropdown";
import { replaceTrainingPlanEntryWorkout } from "../../electron/planWorkoutEditor";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";
import { Ridge } from "./Ridge";
import { SportDot } from "./sportTheme";

interface PlanEditorProps {
  api: CorosLinkApi;
  initialPlan: TrainingPlanDocument;
  workouts: TrainingLibraryWorkout[];
  calendarEnabled: boolean;
  offline: boolean;
  onCalendar: (plan: TrainingPlanDocument, operation?: "install" | "remove") => void;
  onSave: (plan: TrainingPlanDocument) => Promise<void>;
  onClose: () => void;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Entry cards and library rows carry the sport's icon in its own colour. */
function withDerivedSportMix(plan: TrainingPlanDocument): TrainingPlanDocument {
  const sports = plan.entries
    .map((entry) => entry.workout?.sport)
    .filter((sport): sport is WorkoutSport => Boolean(sport));
  return { ...plan, sportMix: [...new Set(sports)], updatedAt: new Date().toISOString() };
}

function removeWeek(plan: TrainingPlanDocument, weekIndex: number): TrainingPlanDocument {
  return withDerivedSportMix({
    ...plan,
    weekCount: Math.max(1, plan.weekCount - 1),
    entries: plan.entries
      .filter((entry) => entry.weekIndex !== weekIndex)
      .map((entry) => ({
        ...entry,
        weekIndex: entry.weekIndex > weekIndex ? entry.weekIndex - 1 : entry.weekIndex
      })),
    phases: plan.phases.filter((phase) => phase.startWeek <= Math.max(1, plan.weekCount - 1)),
    syncState: plan.source === "coros" ? "pending" : "local"
  });
}

function entryDate(plan: TrainingPlanDocument, weekIndex: number, dayIndex: number): string | undefined {
  if (!plan.startDate) return undefined;
  const date = new Date(`${plan.startDate}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return undefined;
  date.setDate(date.getDate() + weekIndex * 7 + dayIndex);
  return date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

function weekDateRange(plan: TrainingPlanDocument, weekIndex: number): string | undefined {
  const first = entryDate(plan, weekIndex, 0);
  const last = entryDate(plan, weekIndex, 6);
  return first && last ? `${first} – ${last}` : undefined;
}

function planDayName(startDate: string | undefined, dayIndex: number): string {
  if (!startDate) return t(DAY_NAMES[dayIndex]!);
  const date = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return t(DAY_NAMES[dayIndex]!);
  date.setDate(date.getDate() + dayIndex);
  return date.toLocaleDateString(getLocale(), { weekday: "short" });
}

export function PlanEditor({ api, initialPlan, workouts, calendarEnabled, offline, onCalendar, onSave, onClose }: PlanEditorProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [history, setHistory] = useState<TrainingPlanDocument[]>([structuredClone(initialPlan)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showNewWorkout, setShowNewWorkout] = useState(false);
  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [newWorkoutSport, setNewWorkoutSport] = useState<WorkoutSport>("run");
  const [newWorkoutMinutes, setNewWorkoutMinutes] = useState("45");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** What is being dragged, so drop zones can announce themselves. */
  const [dragKind, setDragKind] = useState<"entry" | "library" | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [workoutEditorError, setWorkoutEditorError] = useState<string | null>(null);
  const plan = history[historyIndex]!;
  const planDayNames = useMemo(() => DAY_NAMES.map((_day, dayIndex) => planDayName(plan.startDate, dayIndex)), [plan.startDate, getLocale()]);
  const editingEntry = plan.entries.find((entry) => entry.id === editingEntryId);
  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan);
  const validation = useMemo(() => validateTrainingPlan(plan), [plan, getLocale()]);
  const summary = useMemo(() => summarizeTrainingPlan(plan), [plan, getLocale()]);
  const calendarInstall = activeTrainingPlanCalendarInstall(plan);
  const retryingInstall = calendarInstall?.state === "partial" && calendarInstall.lastOperation === "install";
  const calendarDiffers = Boolean(calendarInstall && calendarInstall.planRevision !== trainingPlanCalendarRevision(plan));
  const libraryMatches = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const matches = query
      ? workouts.filter((workout) => workout.name.toLowerCase().includes(query))
      : workouts;
    return matches.slice(0, 40);
  }, [workouts, libraryQuery, getLocale()]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  const commit = (next: TrainingPlanDocument) => {
    const normalized = withDerivedSportMix(next);
    setHistory((current) => [...current.slice(0, historyIndex + 1), normalized]);
    setHistoryIndex((current) => current + 1);
  };

  const patchPlan = (patch: Partial<TrainingPlanDocument>) => commit({ ...plan, ...patch });

  const addLibraryWorkout = (workout: TrainingLibraryWorkout, weekIndex = 0, dayIndex?: number) => {
    const sport = workoutSportFromType(workout.sportType) ?? "run";
    const source: PlanWorkoutEntryInput = {
      key: `library:${workout.id}`,
      name: workout.name,
      sport,
      save_to_library: false
    };
    const entry = planEntryFromWorkout(source, weekIndex, dayIndex, workout.id);
    entry.plannedTrainingLoad = workout.trainingLoad;
    commit({ ...plan, entries: [...plan.entries, entry] });
  };

  const createWorkout = () => {
    if (!newWorkoutName.trim()) return;
    const minutes = Math.max(1, Number(newWorkoutMinutes) || 1);
    const workout: PlanWorkoutEntryInput = {
      key: `local:${Date.now()}`,
      name: newWorkoutName.trim(),
      sport: newWorkoutSport,
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: minutes * 60,
          intensity: { type: "none" }
        }
      ],
      save_to_library: false
    };
    commit({ ...plan, entries: [...plan.entries, planEntryFromWorkout(workout, 0)] });
    setNewWorkoutName("");
    setShowNewWorkout(false);
  };

  const moveEntry = (entryId: string, weekIndex: number, dayIndex?: number) => {
    commit({
      ...plan,
      entries: plan.entries.map((entry) =>
        entry.id === entryId ? { ...entry, weekIndex, dayIndex } : entry
      )
    });
  };

  const removeEntry = (entryId: string) => {
    commit({ ...plan, entries: plan.entries.filter((entry) => entry.id !== entryId) });
  };

  const applyWorkoutEdit = (entryId: string, workout: PlanWorkoutEntryInput) => {
    commit({
      ...plan,
      entries: plan.entries.map((entry) => entry.id === entryId
        ? replaceTrainingPlanEntryWorkout(entry, workout)
        : entry)
    });
    setEditingEntryId(null);
  };

  const addRest = (weekIndex: number, dayIndex: number) => {
    const rest: TrainingPlanEntry = {
      id: `rest:${Date.now()}:${weekIndex}:${dayIndex}`,
      kind: "rest",
      weekIndex,
      dayIndex,
      sortOrder: 0,
      title: "Rest day"
    };
    commit({ ...plan, entries: [...plan.entries, rest] });
  };

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved plan changes?")) return;
    onClose();
  };

  const save = async () => {
    if (validation.some((issue) => issue.severity === "error")) return;
    setSaving(true);
    try {
      await onSave(plan);
    } finally {
      setSaving(false);
    }
  };

  const drop = (event: DragEvent, weekIndex: number, dayIndex?: number) => {
    event.preventDefault();
    setDragKind(null);
    const entryId = event.dataTransfer.getData("text/training-plan-entry");
    if (entryId) {
      moveEntry(entryId, weekIndex, dayIndex);
      return;
    }
    const workoutId = event.dataTransfer.getData("text/training-library-workout");
    const workout = workoutId ? workouts.find((item) => item.id === workoutId) : undefined;
    if (workout) addLibraryWorkout(workout, weekIndex, dayIndex);
  };

  const entryDragProps = {
    onDragStart: () => setDragKind("entry"),
    onDragEnd: () => {
      setDragKind(null);
      setDropTarget(null);
    }
  };

  /** Lights the day (or the holding area) a dragged card is hovering over. */
  const dropTargetProps = (key: string, handleDrop: (event: DragEvent) => void) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (event: DragEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !event.currentTarget.contains(next)) {
        setDropTarget((current) => (current === key ? null : current));
      }
    },
    onDrop: (event: DragEvent) => {
      setDropTarget(null);
      handleDrop(event);
    }
  });

  const unscheduled = plan.entries.filter(
    (entry) => entry.kind === "workout" && entry.dayIndex === undefined
  );

  return (
    <section className="plan-editor" aria-label={t("Edit {{value1}}", { value1: String(plan.name) })}>
      <header className="plan-editor-header">
        <div>
          <p className="tl-eyebrow">{t("Plan editor")}</p>
          <input
            className="plan-editor-name"
            aria-label={t("Plan name")}
            value={plan.name}
            onChange={(event) => patchPlan({ name: event.target.value })}
          />
          <p>{summary.weekCount} {t("weeks,")} {summary.workouts} {t("workouts,")} {Math.round(summary.trainingLoad)} {t("estimated load")}</p>
          {dirty ? <span className="plan-editor-dirty">{t("Unsaved changes")}</span> : null}
          {calendarDiffers ? <span className="plan-editor-source-warning">{t("Calendar differs · Remove and reinstall to apply edits")}</span> : null}
          {plan.source === "coros" ? <span className="plan-editor-source-warning">{t("Native source · Save creates a local copy")}</span> : null}
        </div>
        <div className="plan-editor-header-actions">
          <button type="button" className="icon-button" aria-label={t("Undo")} disabled={historyIndex === 0} onClick={() => setHistoryIndex((index) => index - 1)}><Undo2 size={17} /></button>
          <button type="button" className="icon-button" aria-label={t("Redo")} disabled={historyIndex === history.length - 1} onClick={() => setHistoryIndex((index) => index + 1)}><Redo2 size={17} /></button>
          <button type="button" className="ghost-button" onClick={close}><ArrowLeft size={15} /> {t("Back to library")}</button>
          {calendarEnabled ? <button type="button" className="ghost-button" disabled={dirty || offline || saving} title={dirty ? t("Save the plan before changing its calendar installation") : offline ? t("Reconnect to COROS to change the calendar") : undefined} onClick={() => onCalendar(plan, retryingInstall ? "install" : undefined)}>{offline ? <CloudOff size={15} /> : calendarInstall && !retryingInstall ? <CalendarX size={15} /> : <CalendarPlus size={15} />}{retryingInstall ? t("Retry calendar install") : calendarInstall ? t("Remove from calendar") : t("Add to calendar")}</button> : null}
          {calendarEnabled && retryingInstall ? <button type="button" className="ghost-button" disabled={dirty || offline || saving} onClick={() => onCalendar(plan, "remove")}><CalendarX size={15} /> {t("Remove partial install")}</button> : null}
          <button type="button" className="primary-button" disabled={saving || validation.some((issue) => issue.severity === "error")} onClick={() => void save()}><Save size={15} /> {saving ? t("Saving...") : t("Save plan")}</button>
        </div>
      </header>

      <div className="plan-editor-layout">
        <aside className="plan-editor-sidebar">
          <section>
            <h3>{t("Plan details")}</h3>
            <label><span>{t("Description")}</span><textarea value={plan.description} onChange={(event) => patchPlan({ description: event.target.value })} /></label>
            <label><span>{t("Goal")}</span><input value={plan.goal} onChange={(event) => patchPlan({ goal: event.target.value })} /></label>
            <label>
              <span>{t("Difficulty")}</span>
              <SelectDropdown<TrainingPlanDocument["difficulty"]> translateLabel={t}
                label={t("Plan difficulty")}
                value={plan.difficulty}
                options={[
                  { value: "beginner", label: "Beginner" },
                  { value: "intermediate", label: "Intermediate" },
                  { value: "advanced", label: "Advanced" },
                  { value: "custom", label: "Custom" }
                ]}
                portal
                onChange={(difficulty) => patchPlan({ difficulty })}
              />
            </label>
            <label><span>{t("Plan start date")}</span><span className="plan-editor-date"><CalendarRange size={15} /><input type="date" value={plan.startDate ?? ""} onChange={(event) => { if (event.target.value) commit(shiftTrainingPlan(plan, event.target.value)); }} /></span></label>
            <label><span>{t("Notes")}</span><textarea value={plan.notes} onChange={(event) => patchPlan({ notes: event.target.value })} /></label>
          </section>

          <section>
            <div className="plan-editor-section-title">
              <div>
                <h3>{t("Workout library")}</h3>
                <span>{workouts.length} {t("saved")}</span>
              </div>
              <button
                type="button"
                className={`icon-button${showNewWorkout ? " is-active" : ""}`}
                aria-label={showNewWorkout ? t("Close new workout form") : t("Create a new workout")}
                aria-expanded={showNewWorkout}
                onClick={() => setShowNewWorkout((value) => !value)}
              >
                {showNewWorkout ? <X size={15} /> : <Plus size={16} />}
              </button>
            </div>
            {showNewWorkout ? <div className="plan-editor-new-workout">
              <label><span>{t("Name")}</span><input value={newWorkoutName} onChange={(event) => setNewWorkoutName(event.target.value)} /></label>
              <label>
                <span>{t("Sport")}</span>
                <SelectDropdown<WorkoutSport> translateLabel={t}
                  label={t("Workout sport")}
                  value={newWorkoutSport}
                  options={WORKOUT_SPORTS.map((sport) => ({
                    value: sport,
                    label: formatWorkoutSport(sport)
                  }))}
                  portal
                  onChange={setNewWorkoutSport}
                />
              </label>
              <label><span>{t("Duration")}</span><span className="plan-editor-duration"><input type="number" min="1" value={newWorkoutMinutes} onChange={(event) => setNewWorkoutMinutes(event.target.value)} /><em>min</em></span></label>
              <button type="button" className="primary-button" disabled={!newWorkoutName.trim()} onClick={createWorkout}>{t("Add to holding area")}</button>
            </div> : null}
            <div className="plan-editor-library-search">
              <Search size={15} aria-hidden />
              <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={t("Filter workouts")} aria-label={t("Filter workouts")} />
              {libraryQuery ? <button type="button" aria-label={t("Clear workout filter")} onClick={() => setLibraryQuery("")}><X size={13} /></button> : null}
            </div>
            <p className="plan-editor-library-hint">{t("Drag a workout onto a day, or click to hold it.")}</p>
            <div className="plan-editor-library-list">
              {libraryMatches.length === 0 ? <p className="plan-editor-empty-inline">{t("No workouts match your filter.")}</p> : libraryMatches.map((workout) => <button
                type="button"
                key={workout.id}
                aria-label={t("Add {{value1}} to plan", { value1: String(workout.name) })}
                title={t("Click to add to the holding area, or drag onto a day")}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/training-library-workout", workout.id);
                  event.dataTransfer.effectAllowed = "copy";
                  setDragKind("library");
                }}
                onDragEnd={() => {
                  setDragKind(null);
                  setDropTarget(null);
                }}
                onClick={() => addLibraryWorkout(workout)}
              ><SportDot sport={workoutSportFromType(workout.sportType)} /><span><strong>{workout.name}</strong><small>{formatWorkoutSport(workoutSportFromType(workout.sportType) ?? "run")}</small></span><span className="plan-editor-library-add" aria-hidden="true"><Plus size={14} /></span></button>)}
            </div>
          </section>

          <section>
            <h3>{t("Plan phases")}</h3>
            <div className="plan-editor-phases">
              {plan.phases.map((phase) => <span key={phase.id}>{phase.name} <small>W{phase.startWeek}-W{phase.endWeek}</small><button type="button" aria-label={t("Remove {{value1}}", { value1: String(phase.name) })} onClick={() => patchPlan({ phases: plan.phases.filter((item) => item.id !== phase.id) })}><X size={12} /></button></span>)}
              <button type="button" className="ghost-button" onClick={() => patchPlan({ phases: [...plan.phases, { id: `phase:${Date.now()}`, name: "Base", kind: "base", startWeek: 1, endWeek: Math.max(1, Math.ceil(plan.weekCount / 2)) }] })}><Plus size={13} /> {t("Add phase")}</button>
            </div>
          </section>
        </aside>

        <main className={`plan-editor-main${dragKind ? " is-dragging" : ""}`}>
          <section
            className={`plan-holding-area${unscheduled.length === 0 ? " is-empty" : ""}${dropTarget === "holding" ? " is-drop-target" : ""}`}
            {...dropTargetProps("holding", (event) => drop(event, 0, undefined))}
          >
            <div className="plan-holding-heading">
              <h3>{t("Holding area")}{unscheduled.length ? <span>{unscheduled.length}</span> : null}</h3>
              <p>{dragKind === "entry"
                ? t("Drop here to unschedule.")
                : unscheduled.length === 0
                  ? t("Workouts you add from the library wait here until you drag them onto a day.")
                  : t("Drag these onto a day to schedule them.")}</p>
            </div>
            {unscheduled.length ? <div className="plan-holding-list">
              {unscheduled.map((entry) => <PlanEntryCard key={entry.id} entry={entry} dragProps={entryDragProps} onEdit={() => setEditingEntryId(entry.id)} onRemove={() => removeEntry(entry.id)} />)}
            </div> : null}
          </section>

          <div className="plan-week-list">
            {Array.from({ length: plan.weekCount }, (_, weekIndex) => {
              const weekEntries = plan.entries.filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined);
              const weekSummary = summary.weekly[weekIndex];
              return <section className="plan-week" key={weekIndex}>
                <header>
                  <div><h3>{t("Week")} {weekIndex + 1}{weekDateRange(plan, weekIndex) ? <small>{weekDateRange(plan, weekIndex)}</small> : null}</h3><p>{weekSummary?.workouts ?? 0} {t("workout")}{weekSummary?.workouts === 1 ? "" : "s"} · {Math.round((weekSummary?.durationSeconds ?? 0) / 360) / 10} {t("hr ·")} {Math.round(weekSummary?.trainingLoad ?? 0)} {t("load")}</p></div>
                  <div>
                    <button type="button" className="icon-button" aria-label={t("Move week {{value1}} up", { value1: String(weekIndex + 1) })} disabled={weekIndex === 0} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex - 1))}><ArrowUp size={15} /></button>
                    <button type="button" className="icon-button" aria-label={t("Move week {{value1}} down", { value1: String(weekIndex + 1) })} disabled={weekIndex === plan.weekCount - 1} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex + 1))}><ArrowDown size={15} /></button>
                    <button type="button" className="icon-button" aria-label={t("Duplicate week {{value1}}", { value1: String(weekIndex + 1) })} onClick={() => commit(duplicateTrainingPlanWeek(plan, weekIndex))}><Copy size={15} /></button>
                    <button type="button" className="icon-button" aria-label={t("Insert recovery week after week {{value1}}", { value1: String(weekIndex + 1) })} onClick={() => commit(insertRecoveryWeek(plan, weekIndex))}><RotateCcw size={15} /></button>
                    <button type="button" className="icon-button danger" aria-label={t("Delete week {{value1}}", { value1: String(weekIndex + 1) })} disabled={plan.weekCount <= 1} onClick={() => { if (weekEntries.length === 0 || window.confirm(t("Delete week {{value1}} and its {{value2}} item{{value3}}?", { value1: String(weekIndex + 1), value2: String(weekEntries.length), value3: String(weekEntries.length === 1 ? "" : "s") }))) commit(removeWeek(plan, weekIndex)); }}><Trash2 size={15} /></button>
                  </div>
                </header>
                <div className="plan-week-days">
                  {planDayNames.map((day, dayIndex) => {
                    const entries = weekEntries.filter((entry) => entry.dayIndex === dayIndex).sort((a, b) => a.sortOrder - b.sortOrder);
                    const dayKey = `week-${weekIndex}-day-${dayIndex}`;
                    return <div className={`plan-day${dropTarget === dayKey ? " is-drop-target" : ""}`} key={dayKey} {...dropTargetProps(dayKey, (event) => drop(event, weekIndex, dayIndex))}>
                      <div className="plan-day-heading"><span><strong>{day}</strong><small>{entryDate(plan, weekIndex, dayIndex)}</small></span>{entries.some((entry) => entry.kind === "rest") ? null : <button type="button" aria-label={t("Mark {{value1}} of week {{value2}} as a rest day", { value1: String(day), value2: String(weekIndex + 1) })} title={t("Mark as rest day")} onClick={() => addRest(weekIndex, dayIndex)}><Moon size={12} /></button>}</div>
                      <div className="plan-day-entries">
                        {entries.map((entry) => <PlanEntryCard key={entry.id} entry={entry} dragProps={entryDragProps} onEdit={() => setEditingEntryId(entry.id)} onRemove={() => removeEntry(entry.id)} />)}
                      </div>
                    </div>;
                  })}
                </div>
              </section>;
            })}
          </div>
          <button type="button" className="plan-add-week" onClick={() => patchPlan({ weekCount: plan.weekCount + 1 })}><Plus size={15} /> {t("Add week")}</button>
        </main>

        <aside className="plan-editor-preview">
          <h3>{t("Plan summary")}</h3>
          <p className="plan-editor-preview-note">{t("Estimated load by week")}</p>
          {summary.trainingLoad > 0 ? <Ridge
            values={summary.weekly.map((week) => week.trainingLoad)}
            peakWeek={summary.peakWeek}
            unit="load"
            variant="load"
            label={t("Estimated weekly training load across the {{value1}} weeks", { value1: String(summary.weekCount) })}
          /> : <p className="plan-editor-preview-empty">{t("Schedule workouts to see how load builds week to week.")}</p>}
          <dl>
            <div><dt>{t("Workouts")}</dt><dd>{summary.workouts}</dd></div>
            <div><dt>{t("Duration")}</dt><dd>{Math.round(summary.durationSeconds / 360) / 10} {t("hr")}</dd></div>
            <div><dt>{t("Distance")}</dt><dd>{formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 1 })}</dd></div>
            <div><dt>{t("Training load")}</dt><dd>{Math.round(summary.trainingLoad)}</dd></div>
            <div><dt>{t("Rest days")}</dt><dd>{summary.restDays}</dd></div>
            <div><dt>{t("Peak week")}</dt><dd>{summary.trainingLoad > 0 && summary.peakWeek ? t("Week {{value1}}", { value1: String(summary.peakWeek) }) : "–"}</dd></div>
          </dl>
          {plan.source === "coros" ? <div className="plan-editor-limitation"><AlertTriangle size={16} /><p>{t("This edit will be saved as a local plan. Native plan writes remain disabled until verified.")}</p></div> : null}
          {validation.length ? <div className="plan-editor-validation" aria-live="polite">{validation.map((issue, index) => <p className={issue.severity} key={`${issue.path}:${index}`}><AlertTriangle size={13} />{t(issue.message)}</p>)}</div> : <p className="plan-editor-valid">{t("Ready to save.")}</p>}
        </aside>
      </div>
      {workoutEditorError ? <div className="plan-editor-workout-error" role="alert"><AlertTriangle size={14} />{workoutEditorError}<button type="button" onClick={() => setWorkoutEditorError(null)}><X size={12} /></button></div> : null}
      {editingEntry?.kind === "workout" ? (
        <WorkoutEditorModal
          api={api}
          planEntry={editingEntry}
          onClose={() => setEditingEntryId(null)}
          onSavedToPlan={(workout) => applyWorkoutEdit(editingEntry.id, workout)}
          onError={setWorkoutEditorError}
        />
      ) : null}
    </section>
  );
}

interface PlanEntryCardProps {
  entry: TrainingPlanEntry;
  dragProps: { onDragStart: () => void; onDragEnd: () => void };
  onEdit: () => void;
  onRemove: () => void;
}

function PlanEntryCard({ entry, dragProps, onEdit, onRemove }: PlanEntryCardProps) {
  useLanguage();
  const draggable = entry.kind === "workout";
  return <article
    className={`plan-entry-card is-${entry.kind}`}
    draggable={draggable}
    onDragStart={draggable ? (event) => {
      event.dataTransfer.setData("text/training-plan-entry", entry.id);
      event.dataTransfer.effectAllowed = "move";
      dragProps.onDragStart();
    } : undefined}
    onDragEnd={draggable ? dragProps.onDragEnd : undefined}
    onDoubleClick={draggable ? onEdit : undefined}
  >
    {entry.kind === "workout" ? <SportDot sport={entry.workout?.sport} /> : entry.kind === "rest" ? <Moon size={12} className="plan-entry-rest-icon" aria-hidden="true" /> : null}
    <span><strong>{entry.title ?? (entry.kind === "rest" ? t("Rest day") : t("Note"))}</strong>{entry.workout?.sport ? <small>{formatWorkoutSport(entry.workout.sport)}</small> : null}</span>
    <span className="plan-entry-actions">
      {entry.kind === "workout" ? <button type="button" aria-label={t("Edit {{value1}}", { value1: String(entry.title ?? t("workout")) })} onClick={onEdit}><Pencil size={12} /></button> : null}
      <button type="button" aria-label={t("Remove {{value1}}", { value1: String(entry.title ?? entry.kind) })} onClick={onRemove}><X size={12} /></button>
    </span>
  </article>;
}
