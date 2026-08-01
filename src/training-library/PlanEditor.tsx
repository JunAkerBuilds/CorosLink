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
  CornerDownLeft,
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
import { formatWorkoutSport, WORKOUT_SPORTS } from "../../electron/workoutCapabilities";
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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function planDayName(startDate: string | undefined, dayIndex: number): string {
  if (!startDate) return DAY_NAMES[dayIndex]!;
  const date = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return DAY_NAMES[dayIndex]!;
  date.setDate(date.getDate() + dayIndex);
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export function PlanEditor({ api, initialPlan, workouts, calendarEnabled, offline, onCalendar, onSave, onClose }: PlanEditorProps) {
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
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [workoutEditorError, setWorkoutEditorError] = useState<string | null>(null);
  const plan = history[historyIndex]!;
  const planDayNames = useMemo(() => DAY_NAMES.map((_day, dayIndex) => planDayName(plan.startDate, dayIndex)), [plan.startDate]);
  const editingEntry = plan.entries.find((entry) => entry.id === editingEntryId);
  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan);
  const validation = useMemo(() => validateTrainingPlan(plan), [plan]);
  const summary = useMemo(() => summarizeTrainingPlan(plan), [plan]);
  const calendarInstall = activeTrainingPlanCalendarInstall(plan);
  const retryingInstall = calendarInstall?.state === "partial" && calendarInstall.lastOperation === "install";
  const calendarDiffers = Boolean(calendarInstall && calendarInstall.planRevision !== trainingPlanCalendarRevision(plan));
  const libraryMatches = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const matches = query
      ? workouts.filter((workout) => workout.name.toLowerCase().includes(query))
      : workouts;
    return matches.slice(0, 40);
  }, [workouts, libraryQuery]);

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

  const addLibraryWorkout = (workout: TrainingLibraryWorkout) => {
    const sport = workoutSportFromType(workout.sportType) ?? "run";
    const source: PlanWorkoutEntryInput = {
      key: `library:${workout.id}`,
      name: workout.name,
      sport,
      save_to_library: false
    };
    const entry = planEntryFromWorkout(source, 0, undefined, workout.id);
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
    const entryId = event.dataTransfer.getData("text/training-plan-entry");
    if (entryId) moveEntry(entryId, weekIndex, dayIndex);
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
    <section className="plan-editor" aria-label={`Edit ${plan.name}`}>
      <header className="plan-editor-header">
        <div>
          <p className="tl-eyebrow">Plan editor</p>
          <input
            className="plan-editor-name"
            aria-label="Plan name"
            value={plan.name}
            onChange={(event) => patchPlan({ name: event.target.value })}
          />
          <p>{summary.weekCount} weeks, {summary.workouts} workouts, {Math.round(summary.trainingLoad)} estimated load</p>
          {dirty ? <span className="plan-editor-dirty">Unsaved changes</span> : null}
          {calendarDiffers ? <span className="plan-editor-source-warning">Calendar differs · Remove and reinstall to apply edits</span> : null}
          {plan.source === "coros" ? <span className="plan-editor-source-warning">Native source · Save creates a local copy</span> : null}
        </div>
        <div className="plan-editor-header-actions">
          <button type="button" className="icon-button" aria-label="Undo" disabled={historyIndex === 0} onClick={() => setHistoryIndex((index) => index - 1)}><Undo2 size={17} /></button>
          <button type="button" className="icon-button" aria-label="Redo" disabled={historyIndex === history.length - 1} onClick={() => setHistoryIndex((index) => index + 1)}><Redo2 size={17} /></button>
          <button type="button" className="ghost-button" onClick={close}><ArrowLeft size={15} /> Back to library</button>
          {calendarEnabled ? <button type="button" className="ghost-button" disabled={dirty || offline || saving} title={dirty ? "Save the plan before changing its calendar installation" : offline ? "Reconnect to COROS to change the calendar" : undefined} onClick={() => onCalendar(plan, retryingInstall ? "install" : undefined)}>{offline ? <CloudOff size={15} /> : calendarInstall && !retryingInstall ? <CalendarX size={15} /> : <CalendarPlus size={15} />}{retryingInstall ? "Retry calendar install" : calendarInstall ? "Remove from calendar" : "Add to calendar"}</button> : null}
          {calendarEnabled && retryingInstall ? <button type="button" className="ghost-button" disabled={dirty || offline || saving} onClick={() => onCalendar(plan, "remove")}><CalendarX size={15} /> Remove partial install</button> : null}
          <button type="button" className="primary-button" disabled={saving || validation.some((issue) => issue.severity === "error")} onClick={() => void save()}><Save size={15} /> {saving ? "Saving..." : "Save plan"}</button>
        </div>
      </header>

      <div className="plan-editor-layout">
        <aside className="plan-editor-sidebar">
          <section>
            <h3>Plan details</h3>
            <label><span>Description</span><textarea value={plan.description} onChange={(event) => patchPlan({ description: event.target.value })} /></label>
            <label><span>Goal</span><input value={plan.goal} onChange={(event) => patchPlan({ goal: event.target.value })} /></label>
            <label>
              <span>Difficulty</span>
              <SelectDropdown<TrainingPlanDocument["difficulty"]>
                label="Plan difficulty"
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
            <label><span>Plan start date</span><span className="plan-editor-date"><CalendarRange size={15} /><input type="date" value={plan.startDate ?? ""} onChange={(event) => { if (event.target.value) commit(shiftTrainingPlan(plan, event.target.value)); }} /></span></label>
            <label><span>Notes</span><textarea value={plan.notes} onChange={(event) => patchPlan({ notes: event.target.value })} /></label>
          </section>

          <section>
            <div className="plan-editor-section-title">
              <div>
                <h3>Workout library</h3>
                <span>{workouts.length} saved</span>
              </div>
              <button
                type="button"
                className={`icon-button${showNewWorkout ? " is-active" : ""}`}
                aria-label={showNewWorkout ? "Close new workout form" : "Create a new workout"}
                aria-expanded={showNewWorkout}
                onClick={() => setShowNewWorkout((value) => !value)}
              >
                {showNewWorkout ? <X size={15} /> : <Plus size={16} />}
              </button>
            </div>
            {showNewWorkout ? <div className="plan-editor-new-workout">
              <label><span>Name</span><input value={newWorkoutName} onChange={(event) => setNewWorkoutName(event.target.value)} /></label>
              <label>
                <span>Sport</span>
                <SelectDropdown<WorkoutSport>
                  label="Workout sport"
                  value={newWorkoutSport}
                  options={WORKOUT_SPORTS.map((sport) => ({
                    value: sport,
                    label: formatWorkoutSport(sport)
                  }))}
                  portal
                  onChange={setNewWorkoutSport}
                />
              </label>
              <label><span>Duration</span><span className="plan-editor-duration"><input type="number" min="1" value={newWorkoutMinutes} onChange={(event) => setNewWorkoutMinutes(event.target.value)} /><em>min</em></span></label>
              <button type="button" className="primary-button" disabled={!newWorkoutName.trim()} onClick={createWorkout}>Add to holding area</button>
            </div> : null}
            <div className="plan-editor-library-search">
              <Search size={15} aria-hidden />
              <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Filter workouts" aria-label="Filter workouts" />
              {libraryQuery ? <button type="button" aria-label="Clear workout filter" onClick={() => setLibraryQuery("")}><X size={13} /></button> : null}
            </div>
            <div className="plan-editor-library-list">
              {libraryMatches.length === 0 ? <p className="plan-editor-empty-inline">No workouts match your filter.</p> : libraryMatches.map((workout) => <button type="button" key={workout.id} aria-label={`Add ${workout.name} to plan`} onClick={() => addLibraryWorkout(workout)}><SportDot sport={workoutSportFromType(workout.sportType)} /><span><strong>{workout.name}</strong><small>{formatWorkoutSport(workoutSportFromType(workout.sportType) ?? "run")}</small></span><span className="plan-editor-library-add" aria-hidden="true"><Plus size={14} /></span></button>)}
            </div>
          </section>

          <section>
            <h3>Plan phases</h3>
            <div className="plan-editor-phases">
              {plan.phases.map((phase) => <span key={phase.id}>{phase.name} <small>W{phase.startWeek}-W{phase.endWeek}</small><button type="button" aria-label={`Remove ${phase.name}`} onClick={() => patchPlan({ phases: plan.phases.filter((item) => item.id !== phase.id) })}><X size={12} /></button></span>)}
              <button type="button" className="ghost-button" onClick={() => patchPlan({ phases: [...plan.phases, { id: `phase:${Date.now()}`, name: "Base", kind: "base", startWeek: 1, endWeek: Math.max(1, Math.ceil(plan.weekCount / 2)) }] })}><Plus size={13} /> Add phase</button>
            </div>
          </section>
        </aside>

        <main className="plan-editor-main">
          <section className={`plan-holding-area${dropTarget === "holding" ? " is-drop-target" : ""}`} {...dropTargetProps("holding", (event) => drop(event, 0, undefined))}>
            <div><h3>Holding area</h3><p>Drag unscheduled workouts into a day.</p></div>
            <div className="plan-holding-list">
              {unscheduled.length === 0 ? <span className="plan-editor-empty-inline">No unscheduled workouts</span> : unscheduled.map((entry) => <PlanEntryCard key={entry.id} entry={entry} onEdit={() => setEditingEntryId(entry.id)} onRemove={() => removeEntry(entry.id)} />)}
            </div>
          </section>

          <div className="plan-week-list">
            {Array.from({ length: plan.weekCount }, (_, weekIndex) => {
              const weekEntries = plan.entries.filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined);
              const weekSummary = summary.weekly[weekIndex];
              return <section className="plan-week" key={weekIndex}>
                <header>
                  <div><h3>Week {weekIndex + 1}</h3><p>{weekSummary?.workouts ?? 0} workouts · {Math.round((weekSummary?.durationSeconds ?? 0) / 360) / 10} hr · {Math.round(weekSummary?.trainingLoad ?? 0)} load</p></div>
                  <div>
                    <button type="button" className="icon-button" aria-label={`Move week ${weekIndex + 1} up`} disabled={weekIndex === 0} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex - 1))}><ArrowUp size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Move week ${weekIndex + 1} down`} disabled={weekIndex === plan.weekCount - 1} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex + 1))}><ArrowDown size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Duplicate week ${weekIndex + 1}`} onClick={() => commit(duplicateTrainingPlanWeek(plan, weekIndex))}><Copy size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Insert recovery week after week ${weekIndex + 1}`} onClick={() => commit(insertRecoveryWeek(plan, weekIndex))}><RotateCcw size={15} /></button>
                    <button type="button" className="icon-button danger" aria-label={`Delete week ${weekIndex + 1}`} disabled={plan.weekCount <= 1} onClick={() => { if (weekEntries.length === 0 || window.confirm(`Delete week ${weekIndex + 1} and its ${weekEntries.length} item${weekEntries.length === 1 ? "" : "s"}?`)) commit(removeWeek(plan, weekIndex)); }}><Trash2 size={15} /></button>
                  </div>
                </header>
                <div className="plan-week-days">
                  {planDayNames.map((day, dayIndex) => {
                    const entries = weekEntries.filter((entry) => entry.dayIndex === dayIndex).sort((a, b) => a.sortOrder - b.sortOrder);
                    const dayKey = `week-${weekIndex}-day-${dayIndex}`;
                    return <div className={`plan-day${dropTarget === dayKey ? " is-drop-target" : ""}`} key={dayKey} {...dropTargetProps(dayKey, (event) => drop(event, weekIndex, dayIndex))}>
                      <div className="plan-day-heading"><span><strong>{day}</strong><small>{entryDate(plan, weekIndex, dayIndex)}</small></span><button type="button" aria-label={`Add rest day on ${day}`} onClick={() => addRest(weekIndex, dayIndex)}><CornerDownLeft size={13} /></button></div>
                      <div className="plan-day-entries">
                        {entries.map((entry) => <PlanEntryCard key={entry.id} entry={entry} onEdit={() => setEditingEntryId(entry.id)} onRemove={() => removeEntry(entry.id)} />)}
                      </div>
                    </div>;
                  })}
                </div>
              </section>;
            })}
          </div>
          <button type="button" className="plan-add-week" onClick={() => patchPlan({ weekCount: plan.weekCount + 1 })}><Plus size={15} /> Add week</button>
        </main>

        <aside className="plan-editor-preview">
          <h3>Save preview</h3>
          <Ridge
            values={summary.weekly.map((week) => week.trainingLoad)}
            peakWeek={summary.peakWeek}
            unit="load"
            variant="load"
            label={`Estimated weekly training load across the ${summary.weekCount} weeks`}
          />
          <p className="plan-editor-preview-note">Estimated load by week</p>
          <dl>
            <div><dt>Workouts</dt><dd>{summary.workouts}</dd></div>
            <div><dt>Duration</dt><dd>{Math.round(summary.durationSeconds / 360) / 10} hr</dd></div>
            <div><dt>Distance</dt><dd>{formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 1 })}</dd></div>
            <div><dt>Training load</dt><dd>{Math.round(summary.trainingLoad)}</dd></div>
            <div><dt>Rest days</dt><dd>{summary.restDays}</dd></div>
            <div><dt>Peak week</dt><dd>{summary.peakWeek ?? "-"}</dd></div>
          </dl>
          {plan.source === "coros" ? <div className="plan-editor-limitation"><AlertTriangle size={16} /><p>This edit will be saved as a local plan. Native plan writes remain disabled until verified.</p></div> : null}
          {validation.length ? <div className="plan-editor-validation" aria-live="polite">{validation.map((issue, index) => <p className={issue.severity} key={`${issue.path}:${index}`}><AlertTriangle size={13} />{issue.message}</p>)}</div> : <p className="plan-editor-valid">Ready to save.</p>}
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

function PlanEntryCard({ entry, onEdit, onRemove }: { entry: TrainingPlanEntry; onEdit: () => void; onRemove: () => void }) {
  return <article className={`plan-entry-card is-${entry.kind}`} draggable={entry.kind === "workout"} onDragStart={(event) => event.dataTransfer.setData("text/training-plan-entry", entry.id)}>
    {entry.kind === "workout" ? <SportDot sport={entry.workout?.sport} /> : null}
    <span><strong>{entry.title ?? (entry.kind === "rest" ? "Rest day" : "Note")}</strong>{entry.workout?.sport ? <small>{formatWorkoutSport(entry.workout.sport)}</small> : null}</span>
    <span className="plan-entry-actions">
      {entry.kind === "workout" ? <button type="button" aria-label={`Edit ${entry.title ?? "workout"}`} onClick={onEdit}><Pencil size={12} /></button> : null}
      <button type="button" aria-label={`Remove ${entry.title ?? entry.kind}`} onClick={onRemove}><X size={12} /></button>
    </span>
  </article>;
}
