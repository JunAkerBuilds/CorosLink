import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarRange,
  Copy,
  CornerDownLeft,
  Plus,
  Redo2,
  RotateCcw,
  Save,
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
  insertRecoveryWeek,
  planEntryFromWorkout,
  reorderTrainingPlanWeek,
  shiftTrainingPlan,
  summarizeTrainingPlan,
  validateTrainingPlan,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import { formatWorkoutSport, WORKOUT_SPORTS } from "../../electron/workoutCapabilities";

interface PlanEditorProps {
  initialPlan: TrainingPlanDocument;
  workouts: TrainingLibraryWorkout[];
  onSave: (plan: TrainingPlanDocument) => Promise<void>;
  onClose: () => void;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function mondayOf(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PlanEditor({ initialPlan, workouts, onSave, onClose }: PlanEditorProps) {
  const [history, setHistory] = useState<TrainingPlanDocument[]>([structuredClone(initialPlan)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showNewWorkout, setShowNewWorkout] = useState(false);
  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [newWorkoutSport, setNewWorkoutSport] = useState<WorkoutSport>("run");
  const [newWorkoutMinutes, setNewWorkoutMinutes] = useState("45");
  const plan = history[historyIndex]!;
  const dirty = JSON.stringify(plan) !== JSON.stringify(initialPlan);
  const validation = useMemo(() => validateTrainingPlan(plan), [plan]);
  const summary = useMemo(() => summarizeTrainingPlan(plan), [plan]);

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
          {plan.source === "coros" ? <span className="plan-editor-source-warning">Native source · Save creates a local copy</span> : null}
        </div>
        <div className="plan-editor-header-actions">
          <button type="button" className="icon-button" aria-label="Undo" disabled={historyIndex === 0} onClick={() => setHistoryIndex((index) => index - 1)}><Undo2 size={17} /></button>
          <button type="button" className="icon-button" aria-label="Redo" disabled={historyIndex === history.length - 1} onClick={() => setHistoryIndex((index) => index + 1)}><Redo2 size={17} /></button>
          <button type="button" className="ghost-button" onClick={close}><X size={15} /> Close</button>
          <button type="button" className="primary-button" disabled={saving || validation.some((issue) => issue.severity === "error")} onClick={() => void save()}><Save size={15} /> {saving ? "Saving..." : "Save plan"}</button>
        </div>
      </header>

      <div className="plan-editor-layout">
        <aside className="plan-editor-sidebar">
          <section>
            <h3>Plan details</h3>
            <label><span>Description</span><textarea value={plan.description} onChange={(event) => patchPlan({ description: event.target.value })} /></label>
            <label><span>Goal</span><input value={plan.goal} onChange={(event) => patchPlan({ goal: event.target.value })} /></label>
            <label><span>Difficulty</span><select value={plan.difficulty} onChange={(event) => patchPlan({ difficulty: event.target.value as TrainingPlanDocument["difficulty"] })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="custom">Custom</option></select></label>
            <label><span>Week 1 Monday</span><span className="plan-editor-date"><CalendarRange size={15} /><input type="date" value={plan.startDate ?? ""} onChange={(event) => commit(shiftTrainingPlan(plan, mondayOf(event.target.value)))} /></span></label>
            <label><span>Notes</span><textarea value={plan.notes} onChange={(event) => patchPlan({ notes: event.target.value })} /></label>
          </section>

          <section>
            <div className="plan-editor-section-title"><h3>Workout library</h3><button type="button" className="icon-button" aria-label="Create a new workout" onClick={() => setShowNewWorkout((value) => !value)}><Plus size={16} /></button></div>
            {showNewWorkout ? <div className="plan-editor-new-workout">
              <label><span>Name</span><input value={newWorkoutName} onChange={(event) => setNewWorkoutName(event.target.value)} /></label>
              <label><span>Sport</span><select value={newWorkoutSport} onChange={(event) => setNewWorkoutSport(event.target.value as WorkoutSport)}>{WORKOUT_SPORTS.map((sport) => <option key={sport} value={sport}>{formatWorkoutSport(sport)}</option>)}</select></label>
              <label><span>Duration</span><span className="plan-editor-duration"><input type="number" min="1" value={newWorkoutMinutes} onChange={(event) => setNewWorkoutMinutes(event.target.value)} /><em>min</em></span></label>
              <button type="button" className="primary-button" disabled={!newWorkoutName.trim()} onClick={createWorkout}>Add to holding area</button>
            </div> : null}
            <div className="plan-editor-library-list">
              {workouts.slice(0, 40).map((workout) => <button type="button" key={workout.id} onClick={() => addLibraryWorkout(workout)}><span><strong>{workout.name}</strong><small>{formatWorkoutSport(workoutSportFromType(workout.sportType) ?? "run")}</small></span><Plus size={14} /></button>)}
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
          <section className="plan-holding-area" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, 0, undefined)}>
            <div><h3>Holding area</h3><p>Drag unscheduled workouts into a day.</p></div>
            <div className="plan-holding-list">
              {unscheduled.length === 0 ? <span className="plan-editor-empty-inline">No unscheduled workouts</span> : unscheduled.map((entry) => <PlanEntryCard key={entry.id} entry={entry} onRemove={() => removeEntry(entry.id)} />)}
            </div>
          </section>

          <div className="plan-week-list">
            {Array.from({ length: plan.weekCount }, (_, weekIndex) => {
              const weekEntries = plan.entries.filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined);
              const weekSummary = summary.weekly[weekIndex];
              return <section className="plan-week" key={weekIndex}>
                <header>
                  <div><h3>Week {weekIndex + 1}</h3><p>{weekSummary?.workouts ?? 0} workouts, {Math.round(weekSummary?.trainingLoad ?? 0)} load</p></div>
                  <div>
                    <button type="button" className="icon-button" aria-label={`Move week ${weekIndex + 1} up`} disabled={weekIndex === 0} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex - 1))}><ArrowUp size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Move week ${weekIndex + 1} down`} disabled={weekIndex === plan.weekCount - 1} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex + 1))}><ArrowDown size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Duplicate week ${weekIndex + 1}`} onClick={() => commit(duplicateTrainingPlanWeek(plan, weekIndex))}><Copy size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Insert recovery week after week ${weekIndex + 1}`} onClick={() => commit(insertRecoveryWeek(plan, weekIndex))}><RotateCcw size={15} /></button>
                    <button type="button" className="icon-button danger" aria-label={`Delete week ${weekIndex + 1}`} disabled={plan.weekCount <= 1} onClick={() => { if (weekEntries.length === 0 || window.confirm(`Delete week ${weekIndex + 1} and its ${weekEntries.length} item${weekEntries.length === 1 ? "" : "s"}?`)) commit(removeWeek(plan, weekIndex)); }}><Trash2 size={15} /></button>
                  </div>
                </header>
                <div className="plan-week-days">
                  {DAY_NAMES.map((day, dayIndex) => {
                    const entries = weekEntries.filter((entry) => entry.dayIndex === dayIndex).sort((a, b) => a.sortOrder - b.sortOrder);
                    return <div className="plan-day" key={day} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, weekIndex, dayIndex)}>
                      <div className="plan-day-heading"><span><strong>{day}</strong><small>{entryDate(plan, weekIndex, dayIndex)}</small></span><button type="button" aria-label={`Add rest day on ${day}`} onClick={() => addRest(weekIndex, dayIndex)}><CornerDownLeft size={13} /></button></div>
                      <div className="plan-day-entries">
                        {entries.map((entry) => <PlanEntryCard key={entry.id} entry={entry} onRemove={() => removeEntry(entry.id)} />)}
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
          <dl>
            <div><dt>Workouts</dt><dd>{summary.workouts}</dd></div>
            <div><dt>Duration</dt><dd>{Math.round(summary.durationSeconds / 360) / 10} hr</dd></div>
            <div><dt>Distance</dt><dd>{Math.round(summary.distanceMeters / 100) / 10} km</dd></div>
            <div><dt>Training load</dt><dd>{Math.round(summary.trainingLoad)}</dd></div>
            <div><dt>Rest days</dt><dd>{summary.restDays}</dd></div>
            <div><dt>Peak week</dt><dd>{summary.peakWeek ?? "-"}</dd></div>
          </dl>
          {plan.source === "coros" ? <div className="plan-editor-limitation"><AlertTriangle size={16} /><p>This edit will be saved as a local plan. Native plan writes remain disabled until verified.</p></div> : null}
          {validation.length ? <div className="plan-editor-validation" aria-live="polite">{validation.map((issue, index) => <p className={issue.severity} key={`${issue.path}:${index}`}><AlertTriangle size={13} />{issue.message}</p>)}</div> : <p className="plan-editor-valid">Ready to save.</p>}
        </aside>
      </div>
    </section>
  );
}

function PlanEntryCard({ entry, onRemove }: { entry: TrainingPlanEntry; onRemove: () => void }) {
  return <article className={`plan-entry-card is-${entry.kind}`} draggable={entry.kind === "workout"} onDragStart={(event) => event.dataTransfer.setData("text/training-plan-entry", entry.id)}>
    <span><strong>{entry.title ?? (entry.kind === "rest" ? "Rest day" : "Note")}</strong>{entry.workout?.sport ? <small>{formatWorkoutSport(entry.workout.sport)}</small> : null}</span>
    <button type="button" aria-label={`Remove ${entry.title ?? entry.kind}`} onClick={onRemove}><X size={12} /></button>
  </article>;
}
