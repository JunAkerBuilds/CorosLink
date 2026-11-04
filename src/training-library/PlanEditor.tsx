/**
 * The plan editor: a header with the plan's name, history and save, a rail of
 * tools (library, details, phases), and a board of weeks under a weekly-load
 * overview. Every edit lands in one undo history; nothing reaches the
 * library or COROS until Save.
 */
import { formatWorkoutSport } from "../calendar/workoutLabels";
import { getLocale, useLanguage, t, formatDate } from "../i18n/training";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronLeft,
  CloudOff,
  Copy,
  Loader2,
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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent
} from "react";
import { createPortal } from "react-dom";
import type {
  PlanWorkoutEntryInput,
  TrainingLibraryWorkout,
  TrainingPlanDocument,
  TrainingPlanEntry,
  TrainingPlanPhase,
  WorkoutSport
} from "../../electron/types";
import {
  duplicateTrainingPlanWeek,
  activeTrainingPlanCalendarInstall,
  insertRecoveryWeek,
  planEntryFromWorkout,
  removeTrainingPlanWeek,
  reorderTrainingPlanWeek,
  shiftTrainingPlan,
  summarizeTrainingPlan,
  trainingPlanCalendarRevision,
  trainingPlanEntryMetrics,
  validateTrainingPlan,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import { WORKOUT_SPORTS } from "../../electron/workoutCapabilities";
import type { CorosLinkApi } from "../coroslink-api";
import { WorkoutEditorModal } from "../calendar/WorkoutEditorModal";
import { planWorkoutInputToEditorDraft, replaceTrainingPlanEntryWorkout } from "../../electron/planWorkoutEditor";
import { useUnitSystem } from "../units/UnitSystemProvider";
import type { UnitSystem } from "../units/units";
import { formatDistanceValue } from "../units/units";
import { readableVolume, resolveWorkoutSport, sessionProfile, type SessionProfile } from "./sessionProfile";
import { sportTheme } from "./sportTheme";
import "./planEditor.css";

interface PlanEditorProps {
  api: CorosLinkApi;
  initialPlan: TrainingPlanDocument;
  workouts: TrainingLibraryWorkout[];
  calendarEnabled: boolean;
  offline: boolean;
  onCalendar: (plan: TrainingPlanDocument, operation?: "install" | "remove") => void;
  /** Resolves false when the save failed, so the edits stay marked unsaved. */
  onSave: (plan: TrainingPlanDocument) => Promise<boolean>;
  /** Not in the library yet: a generated or Coach plan, or a new blank one. */
  neverSaved: boolean;
  onClose: () => void;
}

type RailTab = "library" | "details" | "phases";
type PhaseKind = NonNullable<TrainingPlanPhase["kind"]>;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PHASE_KINDS: PhaseKind[] = ["base", "build", "peak", "taper", "recovery"];
const PHASE_LABELS: Record<PhaseKind, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  recovery: "Recovery",
  custom: "Custom"
};
const DIFFICULTIES: Array<{ value: TrainingPlanDocument["difficulty"]; label: string; full: string }> = [
  { value: "beginner", label: "Beginner", full: "Beginner" },
  { value: "intermediate", label: "Interm.", full: "Intermediate" },
  { value: "advanced", label: "Advanced", full: "Advanced" },
  { value: "custom", label: "Custom", full: "Custom" }
];

/* ------------------------------------------------------------ plan edits */

function withDerivedSportMix(plan: TrainingPlanDocument): TrainingPlanDocument {
  const sports = plan.entries
    .map((entry) => entry.workout?.sport)
    .filter((sport): sport is WorkoutSport => Boolean(sport));
  return { ...plan, sportMix: [...new Set(sports)], updatedAt: new Date().toISOString() };
}

function removeWeek(plan: TrainingPlanDocument, weekIndex: number): TrainingPlanDocument {
  return withDerivedSportMix(removeTrainingPlanWeek(plan, weekIndex));
}

/* ------------------------------------------------------------------ dates */

/** Plans store "yyyy-mm-dd" or COROS's "yyyymmdd". */
function parsePlanDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function planDay(plan: TrainingPlanDocument, offset: number): Date | undefined {
  const start = parsePlanDate(plan.startDate);
  if (!start) return undefined;
  const date = new Date(start);
  date.setDate(date.getDate() + offset);
  return date;
}

function shortDate(date: Date | undefined): string | undefined {
  return date ? formatDate(date, { month: "short", day: "numeric" }) : undefined;
}

function planDayName(plan: TrainingPlanDocument, dayIndex: number): string {
  const date = planDay(plan, dayIndex);
  return date ? formatDate(date, { weekday: "short" }) : t(DAY_NAMES[dayIndex]!);
}

/** Week and day of today inside the plan, or -1 when today is outside it. */
function planToday(plan: TrainingPlanDocument): { week: number; day: number } {
  const start = parsePlanDate(plan.startDate);
  if (!start) return { week: -1, day: -1 };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const offset = Math.round((today.valueOf() - start.valueOf()) / 86_400_000);
  if (offset < 0) return { week: -1, day: -1 };
  return { week: Math.floor(offset / 7), day: offset % 7 };
}

/* ------------------------------------------------------------- formatting */

function hours(seconds: number): string {
  return t("{{value1}} h", { value1: String(Math.round(seconds / 360) / 10) });
}

function minutes(seconds: number): string {
  return t("{{value1}} min", { value1: String(Math.max(1, Math.round(seconds / 60))) });
}

function phaseColor(kind: TrainingPlanPhase["kind"] | undefined): string {
  return kind && kind !== "custom" ? `var(--tl-phase-${kind})` : "var(--pe-ink-4)";
}

function phaseLabel(phase: TrainingPlanPhase): string {
  return phase.name.trim() || t(PHASE_LABELS[phase.kind ?? "custom"]);
}

/* --------------------------------------------------------------- profiles */

/**
 * Library workouts carry no steps, so their shapes come from the workout
 * editor, one request per workout, cached for the session.
 */
const profileRequests = new Map<string, Promise<SessionProfile | null>>();
const profileResults = new Map<string, SessionProfile | null>();

function useLibraryProfiles(api: CorosLinkApi, ids: string[], unitSystem: UnitSystem): Map<string, SessionProfile | null> {
  const [, setVersion] = useState(0);
  const key = ids.join("|");
  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter((id) => !profileResults.has(id));
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < missing.length) {
        const id = missing[cursor++]!;
        let request = profileRequests.get(id);
        if (!request) {
          request = api
            .getWorkoutForEdit({ kind: "library", programId: id }, unitSystem)
            .then((document) => sessionProfile(document.draft.nodes, document.context))
            .catch(() => null)
            .then((profile) => {
              profileResults.set(id, profile);
              return profile;
            });
          profileRequests.set(id, request);
        }
        await request;
        if (!cancelled) setVersion((value) => value + 1);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [key, unitSystem]);
  return profileResults;
}

const stepProfiles = new WeakMap<PlanWorkoutEntryInput, SessionProfile>();

function stepsProfile(workout: PlanWorkoutEntryInput): SessionProfile | undefined {
  if (!workout.steps?.length) return undefined;
  let profile = stepProfiles.get(workout);
  if (!profile) {
    try {
      profile = sessionProfile(planWorkoutInputToEditorDraft(workout).nodes);
    } catch {
      return undefined;
    }
    stepProfiles.set(workout, profile);
  }
  return profile;
}

function MiniShape({ profile, className }: { profile: SessionProfile | null | undefined; className: string }) {
  if (!profile?.segments.length) return null;
  const largest = Math.max(...profile.segments.map((segment) => segment.weight));
  return (
    <span className={className} aria-hidden="true">
      {profile.segments.map((segment, index) => (
        <span
          key={index}
          className={`is-${segment.zone}`}
          style={{ flexGrow: Math.max(segment.weight, largest * 0.035), height: `${Math.round(segment.height * 100)}%` }}
        />
      ))}
    </span>
  );
}

/* ----------------------------------------------------------------- editor */

export function PlanEditor({ api, initialPlan, neverSaved, workouts, calendarEnabled, offline, onCalendar, onSave, onClose }: PlanEditorProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [history, setHistory] = useState<TrainingPlanDocument[]>([structuredClone(initialPlan)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  /* A generated plan with workouts in it is unsaved work; a new blank plan has nothing to lose. */
  const [savedJson, setSavedJson] = useState(() => neverSaved && initialPlan.entries.length ? "" : JSON.stringify(initialPlan));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<RailTab>("library");
  const [showNewWorkout, setShowNewWorkout] = useState(false);
  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [newWorkoutSport, setNewWorkoutSport] = useState<WorkoutSport>("run");
  const [newWorkoutMinutes, setNewWorkoutMinutes] = useState("45");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** What is being dragged, so drop zones can announce themselves. */
  const [dragKind, setDragKind] = useState<"entry" | "library" | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [workoutEditorError, setWorkoutEditorError] = useState<string | null>(null);
  const [confirmDeleteWeek, setConfirmDeleteWeek] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [toast, setToast] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const weekRefs = useRef<Array<HTMLElement | null>>([]);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  const plan = history[historyIndex]!;
  const locale = getLocale();
  const planDayNames = useMemo(() => DAY_NAMES.map((_day, dayIndex) => planDayName(plan, dayIndex)), [plan.startDate, locale]);
  const editingEntry = plan.entries.find((entry) => entry.id === editingEntryId);
  const planJson = useMemo(() => JSON.stringify(plan), [plan]);
  const dirty = planJson !== savedJson;
  const validation = useMemo(() => validateTrainingPlan(plan), [plan, locale]);
  const summary = useMemo(() => summarizeTrainingPlan(plan), [plan, locale]);
  const hasError = validation.some((issue) => issue.severity === "error");
  const calendarInstall = activeTrainingPlanCalendarInstall(plan);
  const retryingInstall = calendarInstall?.state === "partial" && calendarInstall.lastOperation === "install";
  const calendarDiffers = Boolean(calendarInstall && calendarInstall.planRevision !== trainingPlanCalendarRevision(plan));
  const isCoros = plan.source === "coros";
  /** Weeks only read as "this week" / "done" once the plan is on the calendar. */
  const onCalendarNow = Boolean(calendarInstall) && !isCoros;
  const today = onCalendarNow ? planToday(plan) : { week: -1, day: -1 };
  const workoutById = useMemo(() => new Map(workouts.map((workout) => [workout.id, workout])), [workouts]);

  const libraryMatches = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const matches = query
      ? workouts.filter((workout) => workout.name.toLowerCase().includes(query))
      : workouts;
    return matches.slice(0, 40);
  }, [workouts, libraryQuery, locale]);

  /* Shapes: plan entries first (they fill the board), then the library rows. */
  const profileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of plan.entries) {
      if (entry.kind === "workout" && !entry.workout?.steps?.length && entry.programId && workoutById.has(entry.programId)) ids.add(entry.programId);
    }
    if (tab === "library") for (const workout of libraryMatches) ids.add(workout.id);
    return [...ids];
  }, [plan.entries, libraryMatches, tab, workoutById]);
  const libraryProfiles = useLibraryProfiles(api, profileIds, unitSystem);

  const entryProfile = (entry: TrainingPlanEntry): SessionProfile | null | undefined =>
    (entry.workout ? stepsProfile(entry.workout) : undefined) ?? (entry.programId ? libraryProfiles.get(entry.programId) : undefined);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  useEffect(() => {
    if (!discardOpen) return;
    keepEditingRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDiscardOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [discardOpen]);

  const commit = (next: TrainingPlanDocument, message = "") => {
    const normalized = withDerivedSportMix(next);
    setHistory((current) => [...current.slice(0, historyIndex + 1), normalized]);
    setHistoryIndex((current) => current + 1);
    setConfirmDeleteWeek(null);
    setToast(message);
  };

  const patchPlan = (patch: Partial<TrainingPlanDocument>, message?: string) => commit({ ...plan, ...patch }, message);

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
    commit(
      { ...plan, entries: [...plan.entries, entry] },
      dayIndex === undefined
        ? t("{{value1}} added to the holding area", { value1: workout.name })
        : t("{{value1}} added to week {{value2}}", { value1: workout.name, value2: String(weekIndex + 1) })
    );
  };

  const createWorkout = (event?: FormEvent) => {
    event?.preventDefault();
    const name = newWorkoutName.trim();
    if (!name) return;
    const minutesValue = Math.max(1, Number(newWorkoutMinutes) || 1);
    const workout: PlanWorkoutEntryInput = {
      key: `local:${Date.now()}`,
      name,
      sport: newWorkoutSport,
      steps: [
        {
          kind: "training",
          target_type: "time",
          target_duration_seconds: minutesValue * 60,
          intensity: { type: "none" }
        }
      ],
      save_to_library: false
    };
    commit({ ...plan, entries: [...plan.entries, planEntryFromWorkout(workout, 0)] }, t("{{value1}} added to the holding area", { value1: name }));
    setNewWorkoutName("");
    setShowNewWorkout(false);
  };

  const moveEntry = (entryId: string, weekIndex: number, dayIndex?: number) => {
    commit(
      {
        ...plan,
        entries: plan.entries.map((entry) =>
          entry.id === entryId ? { ...entry, weekIndex, dayIndex } : entry
        )
      },
      dayIndex === undefined ? t("Moved to the holding area") : t("Moved to week {{value1}}", { value1: String(weekIndex + 1) })
    );
  };

  const removeEntry = (entry: TrainingPlanEntry) => {
    commit(
      { ...plan, entries: plan.entries.filter((item) => item.id !== entry.id) },
      entry.kind === "workout" ? t("{{value1}} removed", { value1: entry.title ?? t("Workout") }) : ""
    );
  };

  const applyWorkoutEdit = (entryId: string, workout: PlanWorkoutEntryInput) => {
    commit(
      {
        ...plan,
        entries: plan.entries.map((entry) => entry.id === entryId
          ? replaceTrainingPlanEntryWorkout(entry, workout)
          : entry)
      },
      t("Updated this plan’s copy of {{value1}}", { value1: workout.name })
    );
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
    commit({ ...plan, entries: [...plan.entries, rest] }, t("Rest day added"));
  };

  const updatePhase = (phaseId: string, change: (phase: TrainingPlanPhase) => TrainingPlanPhase, message?: string) => {
    patchPlan({
      phases: plan.phases.map((phase) => {
        if (phase.id !== phaseId) return phase;
        const next = change(phase);
        const startWeek = Math.max(1, Math.min(next.startWeek, plan.weekCount));
        const endWeek = Math.max(startWeek, Math.min(next.endWeek, plan.weekCount));
        return { ...next, startWeek, endWeek };
      })
    }, message);
  };

  const addPhase = () => {
    const lastEnd = plan.phases.reduce((end, phase) => Math.max(end, phase.endWeek), 0);
    patchPlan({
      phases: [...plan.phases, {
        id: `phase:${Date.now()}`,
        name: PHASE_LABELS.peak,
        kind: "peak",
        startWeek: Math.min(plan.weekCount, lastEnd + 1),
        endWeek: plan.weekCount
      }]
    }, t("Phase added"));
  };

  const undo = () => {
    setHistoryIndex((index) => Math.max(0, index - 1));
    setConfirmDeleteWeek(null);
    setToast(t("Undone"));
  };

  const redo = () => {
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
    setConfirmDeleteWeek(null);
    setToast(t("Redone"));
  };

  const close = () => {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  /* A COROS plan saves as a local copy, which is worth doing unedited too. */
  const canSave = !saving && !hasError && (dirty || isCoros || neverSaved);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (!(await onSave(plan))) return;
      setSavedJson(planJson);
      setToast(isCoros
        ? t("Saved “{{value1}}” as a local plan", { value1: plan.name })
        : t("Saved “{{value1}}”", { value1: plan.name }));
    } finally {
      setSaving(false);
    }
  };

  const drop = (event: DragEvent, weekIndex: number, dayIndex?: number) => {
    event.preventDefault();
    setDragKind(null);
    setDraggingId(null);
    const entryId = event.dataTransfer.getData("text/training-plan-entry");
    if (entryId) {
      moveEntry(entryId, weekIndex, dayIndex);
      return;
    }
    const workoutId = event.dataTransfer.getData("text/training-library-workout");
    const workout = workoutId ? workouts.find((item) => item.id === workoutId) : undefined;
    if (workout) addLibraryWorkout(workout, weekIndex, dayIndex);
  };

  const endDrag = () => {
    setDragKind(null);
    setDraggingId(null);
    setDropTarget(null);
  };

  const entryDragProps = {
    onDragStart: (entryId: string) => {
      setDragKind("entry");
      setDraggingId(entryId);
    },
    onDragEnd: endDrag
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

  const jumpToWeek = (weekIndex: number) => {
    setSelectedWeek(weekIndex);
    weekRefs.current[weekIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const unscheduled = plan.entries.filter((entry) => entry.dayIndex === undefined);
  const sortedPhases = [...plan.phases].sort((a, b) => a.startWeek - b.startWeek);
  /* The narrowest match, so a recovery week inside a longer phase reads as recovery. */
  const phaseForWeek = (weekIndex: number) =>
    sortedPhases
      .filter((phase) => weekIndex + 1 >= phase.startWeek && weekIndex + 1 <= phase.endWeek)
      .sort((a, b) => a.endWeek - a.startWeek - (b.endWeek - b.startWeek))[0];
  /* Per-week figures count scheduled items only: the holding area belongs to no week. */
  const weekly = Array.from({ length: plan.weekCount }, () => ({ workouts: 0, durationSeconds: 0, trainingLoad: 0 }));
  for (const entry of plan.entries) {
    const week = weekly[entry.weekIndex];
    if (!week || entry.kind !== "workout" || entry.dayIndex === undefined) continue;
    const metrics = trainingPlanEntryMetrics(entry);
    week.workouts += 1;
    week.durationSeconds += metrics.durationSeconds;
    week.trainingLoad += metrics.trainingLoad;
  }
  const maxLoad = Math.max(1, ...weekly.map((week) => week.trainingLoad));
  const peakIndex = weekly.some((week) => week.trainingLoad > 0) ? weekly.findIndex((week) => week.trainingLoad === maxLoad) : -1;

  /* Advice only: it never blocks saving. */
  const suggestions: string[] = [];
  if (unscheduled.length) suggestions.push(t("{{value1}} in the holding area won’t go on the calendar", { value1: String(unscheduled.length) }));
  weekly.forEach((week, index) => {
    const prior = weekly[index - 1]?.trainingLoad ?? 0;
    if (index > 0 && prior > 0 && week.trainingLoad > prior * 1.25) {
      suggestions.push(t("Week {{value1}} load jumps {{value2}}%", { value1: String(index + 1), value2: String(Math.round((week.trainingLoad / prior - 1) * 100)) }));
    }
  });
  const uncovered = weekly.map((_week, index) => index).filter((index) => !phaseForWeek(index));
  if (uncovered.length && plan.phases.length) {
    suggestions.push(t("Week {{value1}} has no phase", { value1: uncovered.map((index) => index + 1).join(", ") }));
  }

  const errorCount = validation.filter((issue) => issue.severity === "error").length;
  const warningCount = validation.length - errorCount;
  const statusTone = hasError ? "error" : validation.length ? "warning" : "ok";
  const statusText = saving
    ? t("Saving…")
    : hasError
      ? errorCount === 1 ? t("Fix 1 issue before saving") : t("Fix {{value1}} issues before saving", { value1: String(errorCount) })
      : warningCount
        ? warningCount === 1 ? t("Ready to save · 1 warning") : t("Ready to save · {{value1}} warnings", { value1: String(warningCount) })
        : dirty
          ? t("Ready to save.")
          : t("Saved · everything is up to date");

  const calendarLocked = dirty || offline || saving;
  const calendarTitle = dirty
    ? t("Save the plan before changing its calendar installation")
    : offline
      ? t("Reconnect to COROS to change the calendar")
      : undefined;
  const installAdded = calendarInstall?.occurrences.filter((occurrence) => !occurrence.removedAt).length ?? 0;
  const installTotal = installAdded + (calendarInstall?.failures.length ?? 0);

  const sportLabel = (sport: WorkoutSport | undefined) => formatWorkoutSport(sport ?? "run");

  const entryMeta = (entry: TrainingPlanEntry): string => {
    const metrics = trainingPlanEntryMetrics(entry);
    const parts: string[] = [];
    if (metrics.strengthSets) parts.push(metrics.strengthSets === 1 ? t("1 set") : t("{{value1}} sets", { value1: String(metrics.strengthSets) }));
    else if (metrics.distanceMeters) parts.push(formatDistanceValue(metrics.distanceMeters, unitSystem, { digits: 1 }));
    if (metrics.durationSeconds) parts.push(minutes(metrics.durationSeconds));
    if (!parts.length && entry.programId) {
      const volume = workoutById.get(entry.programId)?.volume;
      if (volume) parts.push(readableVolume(volume));
    }
    return parts.join(" · ") || sportLabel(entry.workout?.sport);
  };

  const renderEntry = (entry: TrainingPlanEntry, inline = false) => {
    const isWorkout = entry.kind === "workout";
    const name = entry.kind === "rest" ? t("Rest day") : entry.title ?? (isWorkout ? t("Workout") : t("Note"));
    const load = isWorkout ? Math.round(trainingPlanEntryMetrics(entry).trainingLoad) : 0;
    const sport = entry.workout?.sport;
    return (
      <PlanEntryCard
        key={entry.id}
        entry={entry}
        name={name}
        meta={isWorkout ? entryMeta(entry) : ""}
        load={load}
        color={sportTheme(sport).color}
        profile={isWorkout && !compact && !inline ? entryProfile(entry) : undefined}
        inline={inline}
        dragging={draggingId === entry.id}
        dragProps={entryDragProps}
        onEdit={() => setEditingEntryId(entry.id)}
        onRemove={() => removeEntry(entry)}
      />
    );
  };

  const weekColumns = { gridTemplateColumns: `repeat(${plan.weekCount}, minmax(0, 1fr))` } as CSSProperties;
  const headerStart = shortDate(planDay(plan, 0));

  return (
    <section className="pe" aria-label={t("Edit {{value1}}", { value1: String(plan.name) })}>
      {/* ===== header ===== */}
      <header className="pe-header">
        <div className="pe-header-main">
          <button type="button" className="pe-back" aria-label={t("Back to library")} onClick={close}>
            <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <div className="pe-title">
            <div className="pe-badges">
              <span className="pe-eyebrow">{t("Plan editor")}</span>
              {dirty ? <span className="pe-badge is-dirty"><i aria-hidden="true" />{t("Unsaved changes")}</span> : null}
              {calendarDiffers && !retryingInstall && !isCoros ? <span className="pe-badge is-orange"><AlertTriangle size={12} strokeWidth={2.2} aria-hidden="true" />{t("Calendar differs · Remove and reinstall to apply edits")}</span> : null}
              {retryingInstall ? <span className="pe-badge is-red"><AlertTriangle size={12} strokeWidth={2.2} aria-hidden="true" />{t("Calendar install incomplete · {{value1}} of {{value2}} workouts added", { value1: String(installAdded), value2: String(installTotal) })}</span> : null}
              {offline && calendarEnabled ? <span className="pe-badge is-muted"><CloudOff size={12} strokeWidth={2.2} aria-hidden="true" />{t("Offline · calendar changes wait for COROS")}</span> : null}
              {isCoros ? <span className="pe-badge is-orange"><AlertTriangle size={12} strokeWidth={2.2} aria-hidden="true" />{t("Native source · Save creates a local copy")}</span> : null}
            </div>
            <input
              className="pe-name"
              aria-label={t("Plan name")}
              value={plan.name}
              onChange={(event) => patchPlan({ name: event.target.value })}
            />
            <div className="pe-facts-line">
              <span><b>{summary.weekCount}</b>{t("weeks")}</span>
              <span><b>{summary.workouts}</b>{t("workouts")}</span>
              <span><b>{Math.round(summary.trainingLoad)}</b>{t("estimated load")}</span>
              {headerStart ? <span><b>{headerStart}</b>{t("start")}</span> : null}
              <span><b>{plan.goal.trim() || "—"}</b></span>
            </div>
          </div>
        </div>
        <div className="pe-header-actions">
          <div className="pe-history" role="group" aria-label={t("History")}>
            <button type="button" className="pe-icon" aria-label={t("Undo")} disabled={historyIndex === 0} onClick={undo}><Undo2 size={16} aria-hidden="true" /></button>
            <button type="button" className="pe-icon" aria-label={t("Redo")} disabled={historyIndex === history.length - 1} onClick={redo}><Redo2 size={16} aria-hidden="true" /></button>
          </div>
          {calendarEnabled ? (
            <button
              type="button"
              className="pe-button"
              disabled={calendarLocked}
              title={calendarTitle}
              onClick={() => onCalendar(plan, retryingInstall ? "install" : undefined)}
            >
              {offline ? <CloudOff size={15} aria-hidden="true" /> : retryingInstall ? <RotateCcw size={15} aria-hidden="true" /> : calendarInstall ? <CalendarX size={15} aria-hidden="true" /> : <CalendarPlus size={15} aria-hidden="true" />}
              {retryingInstall ? t("Retry calendar install") : calendarInstall ? t("Remove from calendar") : t("Add to calendar")}
            </button>
          ) : null}
          {calendarEnabled && retryingInstall ? (
            <button type="button" className="pe-button" disabled={calendarLocked} title={calendarTitle} onClick={() => onCalendar(plan, "remove")}>
              <CalendarX size={15} aria-hidden="true" />{t("Remove partial install")}
            </button>
          ) : null}
          <button type="button" className="pe-save" disabled={!canSave} aria-busy={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={15} className="pe-spin" aria-hidden="true" /> : dirty || isCoros ? <Save size={15} aria-hidden="true" /> : <Check size={15} strokeWidth={2.2} aria-hidden="true" />}
            {saving ? t("Saving…") : dirty || isCoros ? t("Save plan") : t("Saved")}
          </button>
        </div>
      </header>

      {workoutEditorError ? (
        <div className="pe-banner is-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{workoutEditorError}</span>
          <button type="button" className="pe-icon" aria-label={t("Dismiss")} onClick={() => setWorkoutEditorError(null)}><X size={14} aria-hidden="true" /></button>
        </div>
      ) : null}
      {isCoros ? (
        <div className="pe-banner is-coros">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t("This edit will be saved as a local plan. CorosLink can't edit plans on COROS yet.")}</span>
        </div>
      ) : null}

      <div className="pe-body">
        {/* ===== left rail ===== */}
        <aside className="pe-rail" aria-label={t("Plan tools")}>
          <div className="pe-tabs" role="tablist" aria-label={t("Plan tools")}>
            {([
              ["library", t("Library"), workouts.length],
              ["details", t("Details"), undefined],
              ["phases", t("Phases"), plan.phases.length]
            ] as Array<[RailTab, string, number | undefined]>).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`pe-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`pe-panel-${id}`}
                onClick={() => setTab(id)}
              >
                {label}{count !== undefined ? <span>{count}</span> : null}
              </button>
            ))}
          </div>

          {tab === "library" ? (
            <div className="pe-panel" role="tabpanel" id="pe-panel-library" aria-labelledby="pe-tab-library">
              <div className="pe-lib-search">
                <label>
                  <span className="pe-sr">{t("Filter workouts")}</span>
                  <Search size={14} aria-hidden="true" />
                  <input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={t("Filter workouts")} />
                </label>
                <button
                  type="button"
                  className="pe-square"
                  aria-expanded={showNewWorkout}
                  aria-label={showNewWorkout ? t("Close new workout form") : t("Create a quick workout")}
                  onClick={() => setShowNewWorkout((value) => !value)}
                >
                  {showNewWorkout ? <X size={15} strokeWidth={2.4} aria-hidden="true" /> : <Plus size={15} strokeWidth={2.4} aria-hidden="true" />}
                </button>
              </div>
              {showNewWorkout ? (
                <form className="pe-quick" onSubmit={createWorkout}>
                  <div className="pe-eyebrow">{t("Quick workout · goes to the holding area")}</div>
                  <label>{t("Name")}<input type="text" value={newWorkoutName} onChange={(event) => setNewWorkoutName(event.target.value)} placeholder={t("e.g. Hill strides")} /></label>
                  <div className="pe-quick-row">
                    <label>{t("Sport")}
                      <select value={newWorkoutSport} onChange={(event) => setNewWorkoutSport(event.target.value as WorkoutSport)}>
                        {WORKOUT_SPORTS.map((sport) => <option key={sport} value={sport}>{formatWorkoutSport(sport)}</option>)}
                      </select>
                    </label>
                    <label>{t("Minutes")}<input type="number" min="1" value={newWorkoutMinutes} onChange={(event) => setNewWorkoutMinutes(event.target.value)} /></label>
                  </div>
                  <button type="submit" className="pe-mint" disabled={!newWorkoutName.trim()}>{t("Add to holding area")}</button>
                </form>
              ) : null}
              <p className="pe-lib-hint">{t("Drag onto a day, or click to put it in the holding area.")} <b>{t("{{value1}} of {{value2}}", { value1: String(libraryMatches.length), value2: String(workouts.length) })}</b></p>
              {libraryMatches.length ? (
                <ul className="pe-lib-list">
                  {libraryMatches.map((workout) => {
                    const sport = resolveWorkoutSport(workout.sportType);
                    const theme = sportTheme(sport);
                    const Icon = theme.icon;
                    const meta = [sportLabel(sport), workout.volume ? readableVolume(workout.volume) : undefined, workout.trainingLoad ? t("{{value1}} load", { value1: String(Math.round(workout.trainingLoad)) }) : undefined].filter(Boolean).join(" · ");
                    return (
                      <li key={workout.id}>
                        <button
                          type="button"
                          className="pe-lib"
                          style={{ "--pe-sport": theme.color } as CSSProperties}
                          aria-label={t("Add {{value1}} to the holding area", { value1: workout.name })}
                          title={t("Click to add to the holding area, or drag onto a day")}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/training-library-workout", workout.id);
                            event.dataTransfer.effectAllowed = "copy";
                            setDragKind("library");
                          }}
                          onDragEnd={endDrag}
                          onClick={() => addLibraryWorkout(workout)}
                        >
                          <span className="pe-lib-badge"><Icon size={13} strokeWidth={2.2} aria-hidden="true" /></span>
                          <span className="pe-lib-text"><b>{workout.name}</b><small>{meta}</small></span>
                          <MiniShape profile={libraryProfiles.get(workout.id)} className="pe-shape is-lib" />
                          <span className="pe-lib-plus" aria-hidden="true">+</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="pe-lib-empty">{t("No workouts match your filter.")}</p>}
            </div>
          ) : null}

          {tab === "details" ? (
            <div className="pe-panel pe-details" role="tabpanel" id="pe-panel-details" aria-labelledby="pe-tab-details">
              <label className="pe-field">{t("Goal")}<input type="text" value={plan.goal} onChange={(event) => patchPlan({ goal: event.target.value })} placeholder={t("e.g. Run 10K under 50:00")} /></label>
              <div className="pe-field">
                <span>{t("Difficulty")}</span>
                <div className="pe-segments" role="group" aria-label={t("Difficulty")}>
                  {DIFFICULTIES.map((difficulty) => (
                    <button
                      key={difficulty.value}
                      type="button"
                      aria-pressed={plan.difficulty === difficulty.value}
                      aria-label={t(difficulty.full)}
                      onClick={() => patchPlan({ difficulty: difficulty.value })}
                    >
                      {t(difficulty.label)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="pe-field">{t("Plan start date")}
                <input
                  type="date"
                  value={plan.startDate ? isoDate(parsePlanDate(plan.startDate) ?? new Date()) : ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    commit(shiftTrainingPlan(plan, value), t("Plan moved to start {{value1}}", { value1: shortDate(parsePlanDate(value)) ?? value }));
                  }}
                />
              </label>
              <p className="pe-field-hint">{t("Changing it moves every week; workouts keep their weekday.")}</p>
              <label className="pe-field">{t("Description")}<textarea rows={4} value={plan.description} onChange={(event) => patchPlan({ description: event.target.value })} /></label>
              <label className="pe-field">{t("Notes")}<textarea rows={3} value={plan.notes} onChange={(event) => patchPlan({ notes: event.target.value })} placeholder={t("Private notes for this block")} /></label>
            </div>
          ) : null}

          {tab === "phases" ? (
            <div className="pe-panel pe-phases" role="tabpanel" id="pe-panel-phases" aria-labelledby="pe-tab-phases">
              <p className="pe-lib-hint">{t("Phases colour the weekly load and label the weeks they cover.")}</p>
              {plan.phases.map((phase) => {
                const kind = phase.kind ?? "custom";
                const label = phaseLabel(phase);
                return (
                  <div key={phase.id} className="pe-phase" style={{ "--pe-phase": phaseColor(phase.kind) } as CSSProperties}>
                    <div className="pe-phase-top">
                      <span className="pe-phase-swatch" aria-hidden="true" />
                      <select
                        aria-label={t("Phase type")}
                        value={kind}
                        onChange={(event) => {
                          const next = event.target.value as PhaseKind;
                          updatePhase(phase.id, (current) => ({
                            ...current,
                            kind: next,
                            /* A default name follows the type; a name of your own stays. */
                            name: !current.name.trim() || current.name === PHASE_LABELS[current.kind ?? "custom"] ? PHASE_LABELS[next] : current.name
                          }));
                        }}
                      >
                        {PHASE_KINDS.map((option) => <option key={option} value={option}>{t(PHASE_LABELS[option])}</option>)}
                        {kind === "custom" ? <option value="custom">{t("Custom")}</option> : null}
                      </select>
                      <button
                        type="button"
                        className="pe-icon is-danger"
                        aria-label={t("Remove {{value1}} phase", { value1: label })}
                        onClick={() => patchPlan({ phases: plan.phases.filter((item) => item.id !== phase.id) }, t("Phase removed"))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="pe-phase-weeks">
                      <span>{t("Weeks")}</span>
                      <span className="pe-stepper">
                        <button type="button" aria-label={t("Earlier start")} disabled={phase.startWeek <= 1} onClick={() => updatePhase(phase.id, (current) => ({ ...current, startWeek: current.startWeek - 1 }))}>−</button>
                        <b>W{phase.startWeek}</b>
                        <button type="button" aria-label={t("Later start")} disabled={phase.startWeek >= Math.min(phase.endWeek, plan.weekCount)} onClick={() => updatePhase(phase.id, (current) => ({ ...current, startWeek: current.startWeek + 1 }))}>+</button>
                      </span>
                      <span>{t("to")}</span>
                      <span className="pe-stepper">
                        <button type="button" aria-label={t("Earlier end")} disabled={phase.endWeek <= phase.startWeek} onClick={() => updatePhase(phase.id, (current) => ({ ...current, endWeek: current.endWeek - 1 }))}>−</button>
                        <b>W{phase.endWeek}</b>
                        <button type="button" aria-label={t("Later end")} disabled={phase.endWeek >= plan.weekCount} onClick={() => updatePhase(phase.id, (current) => ({ ...current, endWeek: current.endWeek + 1 }))}>+</button>
                      </span>
                    </div>
                  </div>
                );
              })}
              <button type="button" className="pe-dashed" onClick={addPhase}>{t("+ Add phase")}</button>
            </div>
          ) : null}
        </aside>

        {/* ===== main ===== */}
        <main className={`pe-main${dragKind ? " is-dragging" : ""}${compact ? " is-compact" : ""}`}>
          <section className="pe-overview" aria-label={t("Plan overview")}>
            <div className="pe-overview-top">
              <span className="pe-label">{t("Weekly load · click a week to jump to it")}</span>
              {peakIndex >= 0 ? <span className="pe-peak-note">{t("Peak week {{value1}} · {{value2}} load", { value1: String(peakIndex + 1), value2: String(Math.round(maxLoad)) })}</span> : <span className="pe-peak-note">{t("Schedule workouts to see how load builds week to week.")}</span>}
            </div>
            <div className="pe-bars" style={weekColumns}>
              {weekly.map((week, index) => {
                const phase = phaseForWeek(index);
                const load = Math.round(week.trainingLoad);
                const isNow = index === today.week;
                return (
                  <button
                    key={index}
                    type="button"
                    className={`pe-bar${selectedWeek === index ? " is-selected" : ""}${index === peakIndex ? " is-peak" : ""}`}
                    style={{ "--pe-phase": phaseColor(phase?.kind), "--pe-i": index } as CSSProperties}
                    aria-label={[t("Week {{value1}}", { value1: String(index + 1) }), t("{{value1}} load", { value1: String(load) }), phase ? phaseLabel(phase) : undefined].filter(Boolean).join(", ")}
                    onClick={() => jumpToWeek(index)}
                  >
                    <span className="pe-bar-load">{load}</span>
                    <span className="pe-bar-track"><span style={{ height: `${Math.max(4, Math.round((week.trainingLoad / maxLoad) * 100))}%` }} /></span>
                    <span className="pe-bar-week">W{index + 1}</span>
                    {isNow ? <span className="pe-now">{t("NOW")}</span> : null}
                  </button>
                );
              })}
            </div>
            {sortedPhases.length ? (
              <div className="pe-ribbon" style={weekColumns} aria-hidden="true">
                {sortedPhases.map((phase) => {
                  const start = Math.max(1, Math.min(phase.startWeek, plan.weekCount));
                  const end = Math.max(start, Math.min(phase.endWeek, plan.weekCount));
                  return (
                    <span key={phase.id} style={{ gridColumn: `${start} / ${end + 1}`, "--pe-phase": phaseColor(phase.kind) } as CSSProperties}>
                      {phaseLabel(phase)} · W{phase.startWeek}{phase.endWeek > phase.startWeek ? `–${phase.endWeek}` : ""}
                    </span>
                  );
                })}
              </div>
            ) : null}
            <div className="pe-facts">
              <div className="is-mint"><span>{t("Workouts")}</span><b>{summary.workouts}</b></div>
              <div className="is-mint"><span>{t("Duration")}</span><b>{hours(summary.durationSeconds)}</b></div>
              <div className="is-sky"><span>{t("Distance")}</span><b>{formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 0 })}</b></div>
              <div className="is-orange"><span>{t("Training load")}</span><b>{Math.round(summary.trainingLoad)}</b></div>
              <div className="is-indigo"><span>{t("Rest days")}</span><b>{summary.restDays}</b></div>
              <div className="is-pink"><span>{t("Peak week")}</span><b>{peakIndex >= 0 ? t("Week {{value1}}", { value1: String(peakIndex + 1) }) : "–"}</b></div>
            </div>
          </section>

          <section
            className={`pe-hold${dropTarget === "holding" && dragKind ? " is-over" : ""}`}
            aria-label={t("Holding area")}
            {...dropTargetProps("holding", (event) => drop(event, 0, undefined))}
          >
            <div className="pe-hold-head">
              <span className="pe-hold-icon" aria-hidden="true"><Trash2 size={15} /></span>
              <div>
                <div className="pe-hold-title">{t("Holding area")}{unscheduled.length ? <span>{unscheduled.length}</span> : null}</div>
                <div className="pe-hold-hint">{dragKind === "entry"
                  ? t("Drop here to unschedule")
                  : unscheduled.length
                    ? t("Drag these onto a day to schedule them")
                    : t("Workouts you click in the library wait here")}</div>
              </div>
            </div>
            {unscheduled.length ? <div className="pe-hold-list">{unscheduled.map((entry) => renderEntry(entry, true))}</div> : null}
          </section>

          <div className="pe-board-top">
            <span className="pe-label">{t("Weeks · drag workouts between days")}</span>
            <button type="button" className="pe-small" aria-pressed={compact} onClick={() => setCompact((value) => !value)}>
              {compact ? t("Show session shapes") : t("Compact weeks")}
            </button>
          </div>
          <div className="pe-board-scroll">
            <div className="pe-board">
              <div className="pe-daynames" aria-hidden="true"><span />{planDayNames.map((day, index) => <span key={index}>{day}</span>)}</div>
              {weekly.map((week, weekIndex) => {
                const phase = phaseForWeek(weekIndex);
                const weekEntries = plan.entries.filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined);
                const status = !onCalendarNow ? "" : weekIndex < today.week ? "done" : weekIndex === today.week ? "now" : "";
                const sports = [...new Set(weekEntries.filter((entry) => entry.kind === "workout").map((entry) => entry.workout?.sport ?? "run"))];
                const weekLabel = String(weekIndex + 1);
                const confirming = confirmDeleteWeek === weekIndex;
                const first = shortDate(planDay(plan, weekIndex * 7));
                const last = shortDate(planDay(plan, weekIndex * 7 + 6));
                return (
                  <section
                    key={weekIndex}
                    ref={(node) => { weekRefs.current[weekIndex] = node; }}
                    className={`pe-week${selectedWeek === weekIndex ? " is-selected" : ""}${status ? ` is-${status}` : ""}`}
                    style={{ "--pe-phase": phaseColor(phase?.kind) } as CSSProperties}
                    aria-label={t("Week {{value1}}", { value1: weekLabel })}
                  >
                    <div className="pe-week-side">
                      <div className="pe-week-title">
                        <b>{t("Week {{value1}}", { value1: weekLabel })}</b>
                        <span className="pe-phase-chip">{phase ? phaseLabel(phase) : t("No phase")}</span>
                        {status ? <span className={`pe-status-chip is-${status}`}>{status === "now" ? t("This week") : t("Done")}</span> : null}
                      </div>
                      {first && last ? <span className="pe-week-dates">{first} – {last}</span> : null}
                      <span className="pe-week-sum">{week.workouts === 1 ? t("1 workout") : t("{{value1}} workouts", { value1: String(week.workouts) })} · {hours(week.durationSeconds)} · {t("{{value1}} load", { value1: String(Math.round(week.trainingLoad)) })}</span>
                      <span className="pe-week-meter">
                        <span className="pe-week-track"><span style={{ width: `${Math.round((week.trainingLoad / maxLoad) * 100)}%` }} /></span>
                        <span className="pe-week-mix" aria-hidden="true">{sports.map((sport) => <i key={sport} style={{ background: sportTheme(sport).color }} />)}</span>
                      </span>
                      <div className="pe-week-tools" role="toolbar" aria-label={t("Week {{value1}} actions", { value1: weekLabel })}>
                        <button type="button" className="pe-icon" aria-label={t("Move week {{value1}} up", { value1: weekLabel })} disabled={weekIndex === 0} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex - 1), t("Week {{value1}} moved up", { value1: weekLabel }))}><ArrowUp size={13} strokeWidth={2.2} aria-hidden="true" /></button>
                        <button type="button" className="pe-icon" aria-label={t("Move week {{value1}} down", { value1: weekLabel })} disabled={weekIndex === plan.weekCount - 1} onClick={() => commit(reorderTrainingPlanWeek(plan, weekIndex, weekIndex + 1), t("Week {{value1}} moved down", { value1: weekLabel }))}><ArrowDown size={13} strokeWidth={2.2} aria-hidden="true" /></button>
                        <button type="button" className="pe-icon" aria-label={t("Duplicate week {{value1}}", { value1: weekLabel })} title={t("Duplicate week")} onClick={() => commit(duplicateTrainingPlanWeek(plan, weekIndex), t("Week {{value1}} duplicated", { value1: weekLabel }))}><Copy size={13} aria-hidden="true" /></button>
                        <button type="button" className="pe-icon is-recovery" aria-label={t("Insert recovery week after week {{value1}}", { value1: weekLabel })} title={t("Insert recovery week after")} onClick={() => commit(insertRecoveryWeek(plan, weekIndex), t("Recovery week inserted after week {{value1}}", { value1: weekLabel }))}><Moon size={13} aria-hidden="true" /></button>
                        {confirming ? (
                          <>
                            <button type="button" className="pe-confirm" onClick={() => commit(removeWeek(plan, weekIndex), t("Week {{value1}} deleted", { value1: weekLabel }))}>
                              {weekEntries.length === 1 ? t("Delete 1 item?") : t("Delete {{value1}} items?", { value1: String(weekEntries.length) })}
                            </button>
                            <button type="button" className="pe-keep" onClick={() => setConfirmDeleteWeek(null)}>{t("Keep")}</button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="pe-icon is-danger"
                            aria-label={t("Delete week {{value1}}", { value1: weekLabel })}
                            disabled={plan.weekCount <= 1}
                            onClick={() => {
                              if (weekEntries.length) setConfirmDeleteWeek(weekIndex);
                              else commit(removeWeek(plan, weekIndex), t("Week {{value1}} deleted", { value1: weekLabel }));
                            }}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    {planDayNames.map((day, dayIndex) => {
                      const entries = weekEntries.filter((entry) => entry.dayIndex === dayIndex).sort((a, b) => a.sortOrder - b.sortOrder);
                      const dayKey = `week-${weekIndex}-day-${dayIndex}`;
                      const isToday = weekIndex === today.week && dayIndex === today.day;
                      const date = shortDate(planDay(plan, weekIndex * 7 + dayIndex));
                      return (
                        <div
                          key={dayKey}
                          className={`pe-day${entries.length ? " has-items" : ""}${isToday ? " is-today" : ""}${dropTarget === dayKey && dragKind ? " is-over" : ""}`}
                          {...dropTargetProps(dayKey, (event) => drop(event, weekIndex, dayIndex))}
                        >
                          <div className="pe-day-top">
                            <span className="pe-day-date">{isToday ? t("Today · {{value1}}", { value1: date ?? day }) : date ?? day}</span>
                            {entries.some((entry) => entry.kind === "rest") ? null : (
                              <button
                                type="button"
                                className="pe-icon pe-rest-btn"
                                aria-label={t("Mark {{value1}} of week {{value2}} as a rest day", { value1: String(day), value2: weekLabel })}
                                title={t("Mark as rest day")}
                                onClick={() => addRest(weekIndex, dayIndex)}
                              >
                                <Moon size={12} strokeWidth={2.2} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {entries.map((entry) => renderEntry(entry))}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
              <button type="button" className="pe-add-week" onClick={() => patchPlan({ weekCount: plan.weekCount + 1 }, t("Week {{value1}} added", { value1: String(plan.weekCount + 1) }))}>
                {t("+ Add week {{value1}}", { value1: String(plan.weekCount + 1) })}
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* ===== status bar ===== */}
      <footer className="pe-status">
        <span role="status" className={`pe-status-text is-${saving ? "ok" : statusTone}`}><i aria-hidden="true" />{statusText}</span>
        {validation.length ? (
          <ul className="pe-issues" aria-label={t("Plan checks")} aria-live="polite">
            {/* Errors first: one that blocks saving must never fall off the end of this list. */}
            {[...validation].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).slice(0, 4).map((issue, index) => (
              <li key={`${issue.path}:${index}`} className={issue.severity === "error" ? "is-error" : "is-warning"}>
                <span aria-hidden="true">{issue.severity === "error" ? "✕" : "!"}</span>{t(issue.message)}
              </li>
            ))}
          </ul>
        ) : null}
        {suggestions.length ? (
          <ul className="pe-suggestions" aria-label={t("Suggestions")}>
            <li className="pe-suggestions-label">{t("Suggestions")}</li>
            {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
          </ul>
        ) : null}
        <span className="pe-toast" aria-live="polite">{toast}</span>
      </footer>

      {discardOpen ? createPortal(
        <div className="pe-scrim">
          <section className="pe-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pe-discard-title" aria-describedby="pe-discard-body">
            <h2 id="pe-discard-title">{t("Discard unsaved plan changes?")}</h2>
            <p id="pe-discard-body">{historyIndex === 1
              ? t("You have 1 unsaved change to this plan. Leaving now throws it away.")
              : t("You have {{value1}} unsaved changes to this plan. Leaving now throws them away.", { value1: String(Math.max(1, historyIndex)) })}</p>
            <div className="pe-dialog-actions">
              <button ref={keepEditingRef} type="button" className="pe-button" onClick={() => setDiscardOpen(false)}>{t("Keep editing")}</button>
              <button type="button" className="pe-discard" onClick={() => { setDiscardOpen(false); onClose(); }}>{t("Discard and leave")}</button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

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
  name: string;
  meta: string;
  load: number;
  color: string;
  profile: SessionProfile | null | undefined;
  inline: boolean;
  dragging: boolean;
  dragProps: { onDragStart: (entryId: string) => void; onDragEnd: () => void };
  onEdit: () => void;
  onRemove: () => void;
}

function PlanEntryCard({ entry, name, meta, load, color, profile, inline, dragging, dragProps, onEdit, onRemove }: PlanEntryCardProps) {
  useLanguage();
  const isWorkout = entry.kind === "workout";
  return (
    <article
      className={`pe-card is-${entry.kind}${inline ? " is-inline" : ""}${dragging ? " is-dragging" : ""}`}
      style={{ "--pe-sport": color } as CSSProperties}
      draggable={isWorkout}
      onDragStart={isWorkout ? (event) => {
        event.dataTransfer.setData("text/training-plan-entry", entry.id);
        event.dataTransfer.effectAllowed = "move";
        dragProps.onDragStart(entry.id);
      } : undefined}
      onDragEnd={isWorkout ? dragProps.onDragEnd : undefined}
      onDoubleClick={isWorkout ? onEdit : undefined}
    >
      {inline ? (
        <>
          <span className="pe-dot" aria-hidden="true" />
          <span className="pe-card-text"><b>{name}</b>{meta ? <small>{meta}</small> : null}</span>
        </>
      ) : (
        <>
          <div className="pe-card-head">
            <span className="pe-dot" aria-hidden="true" />
            <span className="pe-card-name">{name}</span>
          </div>
          {isWorkout ? <MiniShape profile={profile} className="pe-shape is-card" /> : null}
          {isWorkout ? <span className="pe-card-meta"><span>{meta}</span>{load ? <b>{load}</b> : null}</span> : null}
        </>
      )}
      <span className="pe-card-actions">
        {isWorkout ? <button type="button" className="pe-icon" aria-label={t("Edit {{value1}}", { value1: name })} onClick={onEdit}><Pencil size={11} strokeWidth={2.2} aria-hidden="true" /></button> : null}
        <button type="button" className="pe-icon" aria-label={entry.kind === "rest" ? t("Remove rest day") : t("Remove {{value1}}", { value1: name })} onClick={onRemove}><X size={13} aria-hidden="true" /></button>
      </span>
    </article>
  );
}
