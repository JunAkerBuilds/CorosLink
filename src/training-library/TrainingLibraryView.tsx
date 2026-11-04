import { formatWorkoutSport } from "../calendar/workoutLabels";
import { formatNumber, getLocale, t, useLanguage, formatDate } from "../i18n/training";
import { useLocalOnlyView } from "../privacy/localOnlyView";
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  CalendarPlus,
  CalendarClock,
  CalendarRange,
  CalendarX,
  CloudOff,
  Flame,
  Copy,
  FolderPlus,
  Heart,
  LayoutGrid,
  List,
  ListChecks,
  Plus,
  RefreshCw,
  Scale,
  Search,
  SkipForward,
  Sparkles,
  Tag,
  Target,
  Trash2,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  TrainingActivityMatch,
  TrainingCollection,
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  TrainingHubStatus,
  TrainingLibrarySnapshot,
  TrainingPlanDocument,
  TrainingPlanMetadataPatch,
  WorkoutSport
} from "../../electron/types";
import {
  createTrainingPlan,
  activeTrainingPlanCalendarInstall,
  upcomingTrainingPlanCalendarWorkoutCount,
  planEntryFromWorkout,
  summarizeTrainingPlan,
  trainingPlanCalendarRevision,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import type { CorosLinkApi } from "../coroslink-api";
import { activityHappenDay } from "../../electron/activityLinks";

import {
  PlanSourceBadge,
  SportGlyph,
  dominantSport,
  planSourceLabel,
  sportAccentStyle,
  sportChipStyle,
  sportTheme
} from "./sportTheme";
import { readableVolume, resolveWorkoutSport } from "./sessionProfile";
import { dayKey, libraryWeek, scheduleWindow } from "./libraryWeek";
import { SelectDropdown } from "../components/SelectDropdown";
import { BulletRidge, WeekProfile, type BulletWeek } from "./Ridge";
import { PlanCompare } from "./PlanCompare";
import type { TrainingPlanPreset } from "./TrainingPlanGenerator";
import { PlanEditor } from "./PlanEditor";
import { WorkoutWorkspace } from "./WorkoutWorkspace";
import { TrainingPlanCalendarDialog } from "./TrainingPlanCalendarDialog";
import { TrainingPlanGenerator } from "./TrainingPlanGenerator";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";
import "./trainingLibrary.css";
import "./trainingLibraryRevamp.css";

interface TrainingLibraryViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  onOpenCoach: (prompt?: string) => void;
  pendingPlan?: TrainingPlanDocument | null;
  onPendingPlanConsumed?: () => void;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

type LibrarySection = "workouts" | "plans" | "templates" | "adherence";

const SECTIONS: Array<{ id: LibrarySection; label: string; icon: typeof Zap }> = [
  { id: "workouts", label: "Workouts", icon: Zap },
  { id: "plans", label: "Plans", icon: CalendarRange },
  { id: "templates", label: "Templates", icon: Bookmark },
  { id: "adherence", label: "Adherence", icon: Target }
];

/** One quiet line under the title: what the open section holds. */
const SECTION_LEDES: Record<LibrarySection, string> = {
  workouts: "Sessions to schedule, build plans from, or send to your watch.",
  plans: "Blocks of weeks you can put on your calendar and train through.",
  templates: "Starting points to build new plans from.",
  adherence: "What was planned, against what got done."
};

/** The masthead's backdrop: a track session and a progression run, drawn as one faint skyline. */
const MASTHEAD_SKYLINE: Array<[string, number]> = [
  ["warmup", 34], ["z5", 100], ["rest", 16], ["z5", 100], ["rest", 16], ["z5", 100], ["rest", 16], ["z5", 100],
  ["rest", 16], ["z5", 100], ["rest", 16], ["z5", 100], ["cooldown", 28], ["z2", 46], ["z2", 46], ["z3", 62],
  ["z3", 62], ["z4", 80], ["z4", 80]
];

const LIBRARY_SECTION_PREFERENCE =
  defineSelectionPreference<LibrarySection>({
    key: "trainingLibrary.section",
    defaultValue: "workouts",
    validate: selectionIsOneOf([
      "workouts",
      "plans",
      "templates",
      "adherence"
    ])
  });

/** Sync states worth interrupting the reader for. Everything else stays quiet. */
const UNSETTLED_SYNC = new Set(["pending", "conflicted", "failed", "stale"]);

function happenDay(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function happenDayToDate(value: string): Date {
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T12:00:00`);
}

function shortDate(date: Date): string {
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : formatDate(date, { month: "short", day: "numeric" });
}

function weekdayLabel(date: Date): string {
  return Number.isNaN(date.valueOf())
    ? ""
    : formatDate(date, { weekday: "short" });
}

function activityDate(activity: TrainingHubActivity): string {
  const value = activity.startTime ?? 0;
  return shortDate(new Date(value > 10_000_000_000 ? value : value * 1000));
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Compact elapsed time for the ledger's Updated column. */
function elapsedLabel(iso: string): string {
  const then = new Date(iso).valueOf();
  if (Number.isNaN(then)) return "—";
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days <= 0) return t("today");
  if (days === 1) return t("1 day");
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 6) return `${weeks} wk`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} mo` : `${Math.round(days / 365)} yr`;
}

function planStartLabel(plan: TrainingPlanDocument): string {
  if (!plan.startDate) return t("Unscheduled");
  const date = new Date(`${plan.startDate}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? t("Unscheduled") : `Starts ${shortDate(date)}`;
}

type NativePlansOnCalendar = Record<string, { startDay?: string }>;
const NO_NATIVE_PLANS_ON_CALENDAR: NativePlansOnCalendar = {};

/**
 * The calendar run a plan is part of: a CorosLink calendar install for local
 * plans, or an active COROS instance (executeSubPlan) for native plans.
 */
function planOnCalendar(
  plan: TrainingPlanDocument,
  nativeOnCalendar: NativePlansOnCalendar
): { startDay?: string } | undefined {
  if (plan.source === "coros") return plan.remoteId ? nativeOnCalendar[plan.remoteId] : undefined;
  const install = activeTrainingPlanCalendarInstall(plan);
  return install ? { startDay: install.startDate } : undefined;
}

function calendarStartDate(startDay?: string): Date | undefined {
  const digits = startDay?.replaceAll("-", "");
  if (!digits || !/^\d{8}$/.test(digits)) return undefined;
  return new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T12:00:00`);
}

/** The 1-based week a calendar run is in; undefined before it starts or after it ends. */
function planCalendarWeek(plan: TrainingPlanDocument, startDay?: string): number | undefined {
  const start = calendarStartDate(startDay);
  if (!start) return undefined;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((today.valueOf() - start.valueOf()) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  return days < 0 || week > plan.weekCount ? undefined : week;
}

/** "Week 3 of 14" once a calendar run has started; undefined before it starts or after it ends. */
function planCalendarWeekLabel(plan: TrainingPlanDocument, startDay?: string): string | undefined {
  const week = planCalendarWeek(plan, startDay);
  return week === undefined
    ? undefined
    : t("Week {{value1}} of {{value2}}", { value1: String(week), value2: String(plan.weekCount) });
}

function sourceLabel(source: TrainingPlanDocument["source"]): string {
  return planSourceLabel(source);
}

export function TrainingLibraryView({
  api,
  status,
  onOpenTraining,
  onOpenCoach,
  pendingPlan,
  onPendingPlanConsumed,
  onMessage,
  onError
}: TrainingLibraryViewProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const [section, setSection] = useSelectionPreference(
    LIBRARY_SECTION_PREFERENCE
  );
  const [snapshot, setSnapshot] = useState<TrainingLibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<TrainingPlanDocument | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<TrainingPlanDocument[]>([]);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  /** Goal picked on the "Build me a plan" tile, handed to the generator as its starting values. */
  const [generatorPreset, setGeneratorPreset] = useState<TrainingPlanPreset | undefined>();
  const openGenerator = (preset?: TrainingPlanPreset) => {
    setGeneratorPreset(preset);
    setGeneratorOpen(true);
  };
  /** Each bump asks the workout workspace to open the builder. */
  const [createSignal, setCreateSignal] = useState(0);
  /** "Up next" asks the workspace to open one workout. */
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  /** This week's calendar and the week after: the masthead brief and the reader's day strip. */
  const [schedule, setSchedule] = useState<TrainingHubScheduledWorkoutEntry[]>([]);
  const loadSchedule = useCallback(async () => {
    const { start, end } = scheduleWindow();
    try {
      setSchedule((await api.listScheduledWorkouts(start, end)) ?? []);
    } catch {
      /* The brief and the strip simply go without calendar facts. */
    }
  }, [api]);
  const [calendarTarget, setCalendarTarget] = useState<{ plan: TrainingPlanDocument; operation?: "install" | "remove" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFatalError(null);
    try {
      setSnapshot(await api.getTrainingLibrarySnapshot());
    } catch (cause) {
      setFatalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (status?.authenticated) {
      void load();
      void loadSchedule();
    }
  }, [load, loadSchedule, status?.authenticated]);

  useEffect(() => api.onWorkoutEditsChanged(() => { if (status?.authenticated) void load(); }), [api, load, status?.authenticated]);

  useEffect(() => {
    if (!status?.authenticated || !pendingPlan) return;
    setSection("plans");
    setEditingPlan(structuredClone(pendingPlan));
    onPendingPlanConsumed?.();
  }, [onPendingPlanConsumed, pendingPlan, status?.authenticated]);

  if (!status?.authenticated) {
    return (
      <section className="training-library-gate">
        <BookOpen size={30} strokeWidth={1.5} />
        <h1>{t("Training Library")}</h1>
        <p>{t("Connect COROS Training Hub to load your workouts, plans, and completed activities.")}</p>
        <button type="button" className="primary-button" onClick={onOpenTraining}>
          {t("Connect Training Hub")} </button>
      </section>
    );
  }

  if (!snapshot && loading) {
    return (
      <section className="training-library-view">
        <header className="tl-masthead">
          <h1>{t("Training Library")}</h1>
        </header>
        <div className="tl-skeleton" aria-label={t("Loading the training library")}>
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} style={{ "--tl-row-index": index } as React.CSSProperties} />
          ))}
        </div>
      </section>
    );
  }

  if (!snapshot && fatalError) {
    return (
      <section className="training-library-gate">
        <AlertTriangle size={30} strokeWidth={1.5} />
        <h1>{t("The library didn’t load")}</h1>
        <p>{fatalError}</p>
        <button type="button" className="primary-button" onClick={() => void load()}>
          {t("Try again")} </button>
      </section>
    );
  }

  const current = snapshot!;
  const plans = current.plans.filter((plan) => plan.source !== "template");
  const templates = current.plans.filter((plan) => plan.source === "template");
  const counts: Record<LibrarySection, number> = {
    workouts: current.workouts.length,
    plans: plans.length,
    templates: templates.length,
    adherence: current.matches.length
  };
  /* Adherence reads as a rate: done (in full or in part) out of what has come due. */
  const dueMatches = current.matches.filter((match) => match.status !== "upcoming" && match.status !== "rescheduled");
  const adherenceRate = dueMatches.length
    ? Math.round((dueMatches.filter((match) => match.status === "completed" || match.status === "partial").length / dueMatches.length) * 100)
    : undefined;

  /* Plans are matched by local id and by COROS id, whichever the workout's references carry. */
  const planNames = new Map<string, string>(current.plans.flatMap((plan) =>
    plan.remoteId ? [[plan.id, plan.name], [plan.remoteId, plan.name]] as Array<[string, string]> : [[plan.id, plan.name]] as Array<[string, string]>));

  const savePlan = async (plan: TrainingPlanDocument): Promise<TrainingPlanDocument | undefined> => {
    try {
      const saved = await api.saveLocalTrainingPlan(plan);
      onMessage(t("Saved \"{{value1}}\" as a local {{value2}}.", { value1: String(saved.name), value2: String(saved.source === "template" ? "template" : "plan") }));
      await load();
      return saved;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  };

  // Saving keeps the editor open on the saved copy, so Add to calendar is one click away.
  const savePlanAndKeepEditing = async (plan: TrainingPlanDocument) => {
    const saved = await savePlan(plan);
    if (saved) setEditingPlan(saved);
  };

  const createPlan = (source: "local" | "template") =>
    setEditingPlan(createTrainingPlan(source === "template" ? "New template" : "New plan", source));

  const openPlan = async (plan: TrainingPlanDocument) => {
    if (plan.source !== "coros" || !plan.remoteId) {
      setEditingPlan(plan);
      return;
    }
    setLoading(true);
    try {
      setEditingPlan(await api.getNativeTrainingPlan(plan.remoteId));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      setEditingPlan(plan);
    } finally {
      setLoading(false);
    }
  };

  const duplicatePlan = async (listed: TrainingPlanDocument) => {
    // The list holds a COROS plan without its workouts; the copy needs them to go on the calendar.
    const fromCoros = listed.source === "coros" && Boolean(listed.remoteId);
    const plan = fromCoros
      ? await api.getNativeTrainingPlan(listed.remoteId!).catch(() => listed)
      : listed;
    const duplicate = createTrainingPlan(
      `${plan.name} Copy`,
      plan.source === "template" ? "template" : "local"
    );
    duplicate.description = plan.description;
    duplicate.goal = plan.goal;
    duplicate.difficulty = plan.difficulty;
    duplicate.notes = plan.notes;
    duplicate.sportMix = [...plan.sportMix];
    duplicate.weekCount = plan.weekCount;
    duplicate.startDate = plan.startDate;
    duplicate.phases = structuredClone(plan.phases).map((phase, index) => ({
      ...phase,
      id: `${duplicate.id}:phase:${index}`
    }));
    duplicate.entries = structuredClone(plan.entries).map((entry, index) => ({
      ...entry,
      id: `${duplicate.id}:entry:${index}`,
      remotePlanProgramId: undefined,
      // A COROS plan's workout IDs exist only inside that plan; the copy schedules corosProgram.
      ...(fromCoros ? { programId: undefined } : {})
    }));
    duplicate.calendarInstalls = [];
    await savePlan(duplicate);
  };

  // A plan still on the calendar takes its upcoming workouts with it: they're removed first, then the plan.
  const deletePlan = async (plan: TrainingPlanDocument): Promise<string> => {
    if (plan.source === "coros" && plan.remoteId) {
      const result = await api.deleteCorosTrainingPlan(plan.remoteId, true);
      return result.endedCalendarPlans
        ? t("Deleted \"{{value1}}\" from COROS and removed its upcoming workouts from your calendar.", { value1: String(plan.name) })
        : t("Deleted \"{{value1}}\" from COROS.", { value1: String(plan.name) });
    }
    const { removedCalendarWorkouts } = await api.deleteLocalTrainingPlan(plan.id, true);
    return removedCalendarWorkouts === 1
      ? (localOnly ? t("Deleted \"{{value1}}\" and removed 1 upcoming workout from your calendar.", { value1: String(plan.name) }) : t("Deleted \"{{value1}}\" and removed 1 upcoming workout from your COROS calendar.", { value1: String(plan.name) }))
      : removedCalendarWorkouts
        ? (localOnly ? t("Deleted \"{{value1}}\" and removed {{value2}} upcoming workouts from your calendar.", { value1: String(plan.name), value2: String(removedCalendarWorkouts) }) : t("Deleted \"{{value1}}\" and removed {{value2}} upcoming workouts from your COROS calendar.", { value1: String(plan.name), value2: String(removedCalendarWorkouts) }))
        : `Deleted "${plan.name}".`;
  };

  // One at a time, so a plan that fails leaves the others deleted and says which it was.
  const deletePlans = async () => {
    if (!pendingPlanDelete.length || deletingPlan) return;
    const targets = pendingPlanDelete;
    setDeletingPlan(true);
    const failures: string[] = [];
    let lastMessage = "";
    for (const plan of targets) {
      try {
        lastMessage = await deletePlan(plan);
      } catch (cause) {
        failures.push(targets.length === 1
          ? (cause instanceof Error ? cause.message : String(cause))
          : `${plan.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    const deleted = targets.length - failures.length;
    const templates = targets.every((plan) => plan.source === "template");
    if (deleted && targets.length === 1) onMessage(lastMessage);
    else if (deleted) {
      onMessage(failures.length
        ? (templates ? t("Deleted {{value1}} of {{value2}} templates.", { value1: String(deleted), value2: String(targets.length) }) : t("Deleted {{value1}} of {{value2}} plans.", { value1: String(deleted), value2: String(targets.length) }))
        : (templates ? t("Deleted {{value1}} templates.", { value1: String(deleted) }) : t("Deleted {{value1}} plans.", { value1: String(deleted) })));
    }
    if (failures.length) onError(targets.length === 1 ? failures[0] : `${t("Couldn’t delete:")} ${failures.join("; ")}`);
    // Calendar workouts may already be gone even where a delete failed; show the plans as they are now.
    setPendingPlanDelete([]);
    setDeletingPlan(false);
    await load();
  };

  const deleteSingle = pendingPlanDelete.length === 1 ? pendingPlanDelete[0] : null;
  const deleteOnCalendar = pendingPlanDelete.filter(
    (plan) => plan.source !== "coros" && activeTrainingPlanCalendarInstall(plan)
  );
  const deleteRemovesCalendar = deleteOnCalendar.length > 0;
  const deleteCalendarCount = deleteOnCalendar.reduce(
    (sum, plan) => sum + upcomingTrainingPlanCalendarWorkoutCount(plan),
    0
  );
  const deleteCorosCount = pendingPlanDelete.filter((plan) => plan.source === "coros").length;
  const deleteTemplates = pendingPlanDelete.length > 0 && pendingPlanDelete.every((plan) => plan.source === "template");

  const stateLabel = current.offline ? "Offline · cached" : current.stale ? "Partial sync" : "Synced";

  return (
    <section className="training-library-view">
      <header className="tl-masthead">
        <div className="tl-masthead-skyline" aria-hidden="true">
          {MASTHEAD_SKYLINE.map(([zone, height], index) => (
            <i key={index} className={`is-${zone}`} style={{ height: `${height}%`, "--tl-bar-index": index } as React.CSSProperties} />
          ))}
        </div>
        <div className="tl-masthead-title">
          <h1>{t("Training Library")}</h1>
          <p>{t(SECTION_LEDES[section])}</p>
        </div>
        <p className="tl-masthead-tagline" aria-hidden="true">
          {t("build it once,")}<br /><span>{t("run it often")}</span>
        </p>
        <div className="tl-masthead-actions">
          {!editingPlan ? (
            <>
              {section === "plans" ? (
                <>
                  <button type="button" className="ghost-button tl-masthead-button" onClick={() => void createPlan("local")}>
                    <Plus size={15} aria-hidden="true" /> {t("Blank plan")}
                  </button>
                  <button type="button" className="primary-button tl-masthead-button" onClick={() => openGenerator()}>
                    <Sparkles size={15} aria-hidden="true" /> {t("Generate plan")}
                  </button>
                </>
              ) : (
              <>
              <button type="button" className="ghost-button tl-masthead-button" onClick={() => openGenerator()}>
                <Sparkles size={15} aria-hidden="true" /> {t("Generate plan")}
              </button>
              <button
                type="button"
                className="primary-button tl-masthead-button"
                onClick={() => {
                  setSection("workouts");
                  setCreateSignal((value) => value + 1);
                }}
              >
                <Plus size={15} aria-hidden="true" /> {t("New workout")}
              </button>
              </>
              )}
            </>
          ) : null}
          <button
            type="button"
            className="tl-round-button"
            disabled={loading}
            aria-label={t("Refresh")}
            title={t("Refresh")}
            onClick={() => void load()}
          >
            <RefreshCw size={15} className={loading ? "is-spinning" : ""} />
          </button>
        </div>
      </header>

      {!editingPlan && section !== "plans" ? (
        <LibraryBrief
          workouts={current.workouts}
          schedule={schedule}
          matches={current.matches}
          onOpenWorkout={(id) => {
            setSection("workouts");
            setFocusRequest((current) => ({ id, n: (current?.n ?? 0) + 1 }));
          }}
        />
      ) : null}

      {current.partialFailures.length ? (
        <details className="tl-notice">
          <summary>
            <AlertTriangle size={14} />
            {t("Some COROS data didn’t refresh. Cached items are still shown.")} </summary>
          {current.partialFailures.map((failure) => (
            <p key={failure}>{failure}</p>
          ))}
        </details>
      ) : null}

      <div className="tl-sections-row">
      <nav className="tl-sections" aria-label={t("Library sections")}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={section === id ? "page" : undefined}
            disabled={Boolean(editingPlan)}
            onClick={() => setSection(id)}
          >
            <Icon aria-hidden="true" />
            {id === "plans" ? t("Plans", undefined, "trainingPlans") : t(label)}
            {id === "adherence" && adherenceRate !== undefined
              ? <span className="is-rate">{adherenceRate}%</span>
              : counts[id] ? <span>{counts[id]}</span> : null}
          </button>
        ))}
      </nav>
        <span className={`tl-sync-state${current.stale || current.offline ? " is-stale" : ""}`} role="status">
          {current.offline ? <CloudOff size={13} aria-hidden="true" /> : <i aria-hidden="true" />}
          {current.offline || current.stale
            ? t(stateLabel)
            : t("Synced with COROS · {{value1}}", { value1: syncedAgo(current.cachedAt) })}
        </span>
      </div>

      {editingPlan ? (
        <PlanEditor
          key={`${editingPlan.id}:${editingPlan.updatedAt}`}
          api={api}
          initialPlan={editingPlan}
          workouts={current.workouts}
          calendarEnabled={current.plans.some((plan) => plan.id === editingPlan.id) && editingPlan.source !== "coros"}
          offline={current.offline}
          onCalendar={(plan, operation) => setCalendarTarget({ plan, operation })}
          onSave={savePlanAndKeepEditing}
          onClose={() => setEditingPlan(null)}
        />
      ) : (
        <>
          {section === "workouts" ? (
            <WorkoutWorkspace
              api={api}
              workouts={current.workouts}
              collections={current.collections}
              onRefresh={load}
              onMessage={onMessage}
              onError={onError}
              createSignal={createSignal}
              focusRequest={focusRequest}
              onRequestHandled={() => {
                /* Consumed: coming back to Workouts later must not reopen the builder or refocus. */
                setCreateSignal(0);
                setFocusRequest(null);
              }}
              schedule={schedule}
              onScheduleChanged={loadSchedule}
              planNames={planNames}
            />
          ) : null}

          {section === "plans" ? (
            <PlanIndex
              api={api}
              noun="plan"
              plans={plans}
              nativeOnCalendar={current.nativePlansOnCalendar}
              collections={current.collections}
              onCreate={() => createPlan("local")}
              onGenerate={openGenerator}
              createInMasthead
              onCalendar={(plan, operation) => setCalendarTarget({ plan, operation })}
              offline={current.offline}
              onOpen={(plan) => void openPlan(plan)}
              onDuplicate={(plan) => void duplicatePlan(plan)}
              onDelete={setPendingPlanDelete}
              onRefresh={load}
              onError={onError}
              onCompare={(ids) => {
                setCompareIds(ids);
                setCompareOpen(true);
              }}
            />
          ) : null}

          {section === "templates" ? (
            <TemplateSection
              api={api}
              templates={templates}
              collections={current.collections}
              onCreate={() => createPlan("template")}
              onOpen={setEditingPlan}
              onDuplicate={(plan) => void duplicatePlan(plan)}
              onDelete={setPendingPlanDelete}
              onRefresh={load}
              onMessage={onMessage}
              onError={onError}
            />
          ) : null}

          {section === "adherence" ? (
            <AdherenceSection
              api={api}
              matches={current.matches}
              onRefresh={load}
              onMessage={onMessage}
              onError={onError}
            />
          ) : null}
        </>
      )}

      {compareOpen ? (
        <PlanCompare
          plans={plans}
          selectedIds={compareIds}
          onSelectionChange={setCompareIds}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {generatorOpen ? <TrainingPlanGenerator api={api} preset={generatorPreset} onClose={() => setGeneratorOpen(false)} onOpenCoach={onOpenCoach} onGenerated={(plan) => { setGeneratorOpen(false); setEditingPlan(plan); }} /> : null}

      {calendarTarget ? <TrainingPlanCalendarDialog api={api} plan={calendarTarget.plan} requestedOperation={calendarTarget.operation} offline={current.offline} onClose={() => setCalendarTarget(null)} onComplete={(result) => {
        setCalendarTarget(null);
        if (editingPlan?.id === result.plan.id) setEditingPlan(result.plan);
        if (result.failures.length) onMessage(t("Updated {{value1}} calendar workout{{value2}}; {{value3}} need retry.", { value1: String(result.scheduledCount + result.removedCount), value2: String(result.scheduledCount + result.removedCount === 1 ? "" : "s"), value3: String(result.failures.length) }));
        else if (result.scheduledCount) onMessage(localOnly
          ? t("Added {{value1}} workouts from \"{{value2}}\" to the calendar.", { value1: String(result.scheduledCount), value2: String(result.plan.name) })
          : t("Added {{value1}} workouts from \"{{value2}}\" to the COROS calendar.", { value1: String(result.scheduledCount), value2: String(result.plan.name) }));
        else onMessage(t("Removed {{value1}} future workouts owned by \"{{value2}}\".", { value1: String(result.removedCount), value2: String(result.plan.name) }));
        void load();
      }} /> : null}

      {pendingPlanDelete.length > 1 ? (
        <div className="tl-dialog-backdrop">
          <section
            className="tl-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plan-delete-title"
          >
            <h2 id="plan-delete-title">
              {deleteTemplates
                ? t("Delete {{value1}} templates?", { value1: String(pendingPlanDelete.length) })
                : t("Delete {{value1}} plans?", { value1: String(pendingPlanDelete.length) })}
            </h2>
            <ul>
              {pendingPlanDelete.map((plan) => <li key={plan.id}><strong>{plan.name}</strong></li>)}
            </ul>
            {deleteCorosCount ? (
              <p>
                {deleteCorosCount === 1
                  ? t("1 of them is a COROS plan: it’s deleted from your COROS account, not just from CorosLink, and its upcoming workouts leave your COROS calendar. This can’t be undone.")
                  : t("{{value1}} of them are COROS plans: they’re deleted from your COROS account, not just from CorosLink, and their upcoming workouts leave your COROS calendar. This can’t be undone.", { value1: String(deleteCorosCount) })}
              </p>
            ) : null}
            {deleteRemovesCalendar ? (
              <p>
                {deleteCalendarCount === 1
                  ? (localOnly ? t("Their 1 upcoming workout on your calendar is removed first. Past days stay.") : t("Their 1 upcoming workout on your COROS calendar is removed first. Past days stay."))
                  : (localOnly ? t("Their {{value1}} upcoming workouts on your calendar are removed first. Past days stay.", { value1: String(deleteCalendarCount) }) : t("Their {{value1}} upcoming workouts on your COROS calendar are removed first. Past days stay.", { value1: String(deleteCalendarCount) }))}
              </p>
            ) : null}
            {!deleteCorosCount && !deleteRemovesCalendar ? (
              <p>{t("This removes them from CorosLink. Plans stored on COROS are not touched.")}</p>
            ) : null}
            <footer>
              <button type="button" className="ghost-button" disabled={deletingPlan} onClick={() => setPendingPlanDelete([])}>
                {t("Cancel")} </button>
              <button type="button" className="primary-button danger" aria-busy={deletingPlan} disabled={deletingPlan} onClick={() => void deletePlans()}>
                {deletingPlan
                  ? t("Deleting")
                  : deleteTemplates
                    ? t("Delete {{value1}} templates", { value1: String(pendingPlanDelete.length) })
                    : t("Delete {{value1}} plans", { value1: String(pendingPlanDelete.length) })} </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteSingle ? (
        <div className="tl-dialog-backdrop">
          <section
            className="tl-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plan-delete-title"
          >
            <h2 id="plan-delete-title">
              {t("Delete “")}{deleteSingle.name}&rdquo;?
            </h2>
            {deleteSingle.source === "coros" ? (
              <>
                <p>{t("This deletes the plan from your COROS account, not just from CorosLink.")}</p>
                <p>{t("If the plan is on your COROS calendar, its upcoming workouts are removed too. Past days stay. This can’t be undone.")}</p>
              </>
            ) : deleteRemovesCalendar ? (
              <p>
                {deleteCalendarCount === 1
                  ? (localOnly ? t("This deletes the plan from CorosLink and removes its 1 upcoming workout from your calendar. Past days stay.") : t("This deletes the plan from CorosLink and removes its 1 upcoming workout from your COROS calendar. Past days stay."))
                  : deleteCalendarCount
                    ? (localOnly ? t("This deletes the plan from CorosLink and removes its {{value1}} upcoming workouts from your calendar. Past days stay.", { value1: String(deleteCalendarCount) }) : t("This deletes the plan from CorosLink and removes its {{value1}} upcoming workouts from your COROS calendar. Past days stay.", { value1: String(deleteCalendarCount) }))
                    : (localOnly ? t("This deletes the plan from CorosLink and removes its upcoming workouts from your calendar. Past days stay.") : t("This deletes the plan from CorosLink and removes its upcoming workouts from your COROS calendar. Past days stay."))}
              </p>
            ) : (
              <p>
                {t("This removes the local copy and its")} {deleteSingle.entries.length} {t("item")}{deleteSingle.entries.length === 1 ? "" : "s"}{t(". Plans stored on COROS are not touched.")} </p>
            )}
            <footer>
              <button type="button" className="ghost-button" disabled={deletingPlan} onClick={() => setPendingPlanDelete([])}>
                {t("Cancel")} </button>
              <button type="button" className="primary-button danger" aria-busy={deletingPlan} disabled={deletingPlan} onClick={() => void deletePlans()}>
                {deleteSingle.source === "coros"
                  ? deletingPlan ? t("Deleting from COROS…") : t("Delete from COROS")
                  : deleteRemovesCalendar
                    ? deletingPlan ? t("Removing workouts…") : t("Remove workouts and delete")
                    : t("Delete plan")} </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

interface LibraryBriefProps {
  workouts: TrainingSnapshotWorkout[];
  schedule: TrainingHubScheduledWorkoutEntry[];
  matches: TrainingActivityMatch[];
  onOpenWorkout: (id: string) => void;
}

type TrainingSnapshotWorkout = TrainingLibrarySnapshot["workouts"][number];

/** "2 min ago" for the sync line under the tabs. */
function syncedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).valueOf()) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return t("just now");
  if (minutes < 60) return t("{{value1}} min ago", { value1: String(minutes) });
  const hours = Math.round(minutes / 60);
  return hours < 24 ? t("{{value1}} h ago", { value1: String(hours) }) : shortDate(new Date(iso));
}

/** The masthead brief: what is next, how much of the week came from here, the favourite, the mix. */
function LibraryBrief({ workouts, schedule, matches, onOpenWorkout }: LibraryBriefProps) {
  useLanguage();
  const week = libraryWeek();
  const todayKey = week.find((day) => day.isToday)?.key ?? dayKey(new Date());
  const byId = new Map(workouts.map((workout) => [workout.id, workout]));
  const byName = new Map(workouts.map((workout) => [workout.name.trim().toLowerCase(), workout]));
  const libraryWorkoutFor = (entry: TrainingHubScheduledWorkoutEntry) =>
    (entry.programId ? byId.get(entry.programId) : undefined) ?? byName.get(entry.name.trim().toLowerCase());

  const upcoming = schedule
    .filter((entry) => entry.happenDay >= todayKey)
    .sort((left, right) => left.happenDay.localeCompare(right.happenDay) || (left.sortNo ?? 0) - (right.sortNo ?? 0));
  const next = upcoming[0];
  const nextWorkout = next ? libraryWorkoutFor(next) : undefined;
  const nextSport = resolveWorkoutSport(next?.sportType ?? nextWorkout?.sportType);
  const NextIcon = sportTheme(nextSport).icon;
  const nextDay = next ? formatDate(happenDayToDate(next.happenDay), { weekday: "short", month: "short", day: "numeric" }) : "";
  const nextFacts = next
    ? [readableVolume(next.volume), next.trainingLoad ? t("{{value1}} load", { value1: String(Math.round(next.trainingLoad)) }) : undefined].filter(Boolean).join(" · ")
    : "";

  const thisWeek = schedule.filter((entry) => entry.happenDay >= week[0]!.key && entry.happenDay <= week[6]!.key);
  /* Done means COROS (or a confirmed link) credited an activity to the session, in full or in part. */
  const fromLibraryThisWeek = thisWeek.filter((entry) => libraryWorkoutFor(entry)).length;
  const doneThisWeek = Math.min(thisWeek.length, matches.filter((match) =>
    match.happenDay >= week[0]!.key && match.happenDay <= week[6]!.key &&
    (match.status === "completed" || match.status === "partial")).length);

  const favourite = workouts.reduce<TrainingSnapshotWorkout | undefined>((best, workout) => {
    const uses = workout.usedByPlanIds.length + workout.scheduledCount;
    const bestUses = best ? best.usedByPlanIds.length + best.scheduledCount : 0;
    return uses > bestUses ? workout : best;
  }, undefined);
  const favouriteUses = favourite ? favourite.usedByPlanIds.length + favourite.scheduledCount : 0;

  const mix = new Map<WorkoutSport, number>();
  for (const workout of workouts) {
    const sport = resolveWorkoutSport(workout.sportType);
    if (sport) mix.set(sport, (mix.get(sport) ?? 0) + 1);
  }
  const mixEntries = [...mix].sort((left, right) => right[1] - left[1]);

  return (
    <div className="tl-brief" aria-label={t("Library at a glance")}>
      {next ? (
        <div className="tl-brief-chip is-next" style={sportAccentStyle(nextSport)}>
          <span className="tl-brief-badge" aria-hidden="true"><NextIcon size={17} strokeWidth={2} /></span>
          <span>
            <small>{t("Up next · {{value1}}", { value1: nextDay })}</small>
            <b>{next.name}{nextFacts ? <em> · {nextFacts}</em> : null}</b>
          </span>
          {nextWorkout ? (
            <button type="button" className="tl-brief-open" onClick={() => onOpenWorkout(nextWorkout.id)}>{t("Open")}</button>
          ) : null}
        </div>
      ) : null}
      {thisWeek.length ? (
        <div
          className="tl-brief-chip"
          title={t("{{value1}} of {{value2}} sessions done this week", { value1: String(doneThisWeek), value2: String(thisWeek.length) })}
        >
          <span>
            <small>{t("This week from the library")}</small>
            <b>{t("{{value1}} of {{value2}} sessions", { value1: String(fromLibraryThisWeek), value2: String(thisWeek.length) })} <em>{t("scheduled")}</em></b>
          </span>
          <span
            className="tl-brief-progress"
            role="img"
            aria-label={t("{{value1}} of {{value2}} sessions this week came from the library, {{value3}} done", { value1: String(fromLibraryThisWeek), value2: String(thisWeek.length), value3: String(doneThisWeek) })}
          >
            <i style={{ width: `${Math.max(fromLibraryThisWeek ? 6 : 0, Math.round((fromLibraryThisWeek / thisWeek.length) * 100))}%` }} />
            <i className="is-done" style={{ width: `${Math.round((doneThisWeek / thisWeek.length) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      {favourite && favouriteUses ? (
        <div className="tl-brief-chip is-favourite">
          <Flame className="tl-brief-flame" size={22} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          <span>
            <small>{t("Crowd favourite")}</small>
            <b>{favourite.name} <em>· {t("used {{value1}}×", { value1: String(favouriteUses) })}</em></b>
          </span>
        </div>
      ) : null}
      {mixEntries.length ? (
        <div className="tl-brief-chip">
          <span>
            <small>{t("Mix")}</small>
            <span className="tl-brief-mix" aria-hidden="true">
              {mixEntries.map(([sport, count]) => (
                <i key={sport} title={`${count} ${formatWorkoutSport(sport)}`} style={{ ...sportChipStyle(sport), flexGrow: count }} />
              ))}
            </span>
          </span>
          <em className="tl-brief-mix-label">
            {mixEntries.slice(0, 3).map(([sport, count]) => `${count} ${formatWorkoutSport(sport).toLowerCase()}`).join(" · ")}
          </em>
        </div>
      ) : null}
    </div>
  );
}

type PlanColumn = "name" | "weeks" | "sessions" | "load" | "updated";

interface PlanSort {
  column: PlanColumn;
  descending: boolean;
}

const PLAN_COLUMNS: Array<{ id: PlanColumn; label: string; numeric: boolean }> = [
  { id: "weeks", label: "Weeks", numeric: true },
  { id: "sessions", label: "Sessions", numeric: true },
  { id: "load", label: "Load", numeric: true },
  { id: "updated", label: "Updated", numeric: true }
];

/** Tiles have no column headings to click, so sorting gets its own control. */
const PLAN_SORT_OPTIONS: Array<{ value: PlanColumn; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "weeks", label: "Weeks" },
  { value: "sessions", label: "Sessions" },
  { value: "load", label: "Training load" }
];

type PlanIndexNoun = "plan" | "template";

const PLAN_SCOPE_PREFERENCES = {
  plan: defineSelectionPreference<string>({
    key: "trainingLibrary.plans.scope",
    defaultValue: "all",
    validate: (value): value is string =>
      typeof value === "string" &&
      ["all", "favorite", "calendar", "coros", "local", "coach", "unsettled", "archived"].includes(value)
  }),
  template: defineSelectionPreference<string>({
    key: "trainingLibrary.templates.scope",
    defaultValue: "all",
    validate: (value): value is string =>
      typeof value === "string" &&
      ["all", "favorite", "calendar", "coros", "local", "coach", "unsettled", "archived"].includes(value)
  })
} satisfies Record<PlanIndexNoun, unknown>;

function isPlanSort(value: unknown): value is PlanSort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    ["name", "weeks", "sessions", "load", "updated"].includes(
      String(candidate.column)
    ) && typeof candidate.descending === "boolean"
  );
}

const PLAN_SORT_PREFERENCES = {
  plan: defineSelectionPreference<PlanSort>({
    key: "trainingLibrary.plans.sort",
    defaultValue: { column: "updated", descending: true },
    validate: isPlanSort
  }),
  template: defineSelectionPreference<PlanSort>({
    key: "trainingLibrary.templates.sort",
    defaultValue: { column: "updated", descending: true },
    validate: isPlanSort
  })
} satisfies Record<PlanIndexNoun, unknown>;

const PLAN_LAYOUT_PREFERENCES = {
  plan: defineSelectionPreference<"grid" | "list">({
    key: "trainingLibrary.plans.layout",
    defaultValue: "grid",
    validate: selectionIsOneOf(["grid", "list"])
  }),
  template: defineSelectionPreference<"grid" | "list">({
    key: "trainingLibrary.templates.layout",
    defaultValue: "grid",
    validate: selectionIsOneOf(["grid", "list"])
  })
} satisfies Record<PlanIndexNoun, unknown>;

/** Goals on the "Build me a plan" tile, each a starting point for the generator. */
const PLAN_GOAL_PRESETS = [
  { id: "5k", label: "5K", goal: "Run a faster 5K", weeks: 8, sessionsPerWeek: 4 },
  { id: "10k", label: "10K", goal: "Run a faster 10K", weeks: 10, sessionsPerWeek: 4 },
  { id: "half", label: "Half", goal: "Race a half marathon", weeks: 12, sessionsPerWeek: 5 },
  { id: "marathon", label: "Marathon", goal: "Race a marathon", weeks: 16, sessionsPerWeek: 5 },
  { id: "trail", label: "Trail ultra", goal: "Finish a trail ultra strong", weeks: 16, sessionsPerWeek: 5 }
] as const;

type PlanGoalPresetId = (typeof PLAN_GOAL_PRESETS)[number]["id"];

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced"
};

/**
 * Everything a tile, the hero and a row need, derived once so the layouts can
 * never drift apart on what a plan says.
 */
function planView(
  plan: TrainingPlanDocument,
  summary: ReturnType<typeof summarizeTrainingPlan> | undefined
) {
  const weekly = summary?.weekly ?? [];
  const hasLoad = weekly.some((week) => week.trainingLoad > 0);
  const sports = plan.sportMix.map((sport) => formatWorkoutSport(sport)).join(", ");

  // A peak is only worth naming when one week stands above the rest.
  const loads = weekly.map((week) => week.trainingLoad);
  const peakWeek = hasLoad && loads.filter((load) => load === Math.max(...loads)).length === 1
    ? summary?.peakWeek
    : undefined;
  // How often the plan trains, when there is no load peak to describe its shape.
  const busyWeeks = weekly.map((week) => week.workouts).filter((count) => count > 0);
  const fewest = Math.min(...busyWeeks);
  const most = Math.max(...busyWeeks);
  const rhythm = !busyWeeks.length
    ? ""
    : fewest === most
      ? t("{{value1}} a week", { value1: String(most) })
      : t("{{value1}}–{{value2}} a week", { value1: String(fewest), value2: String(most) });

  return {
    /** What the plan is for, in the author's words; the tile shows nothing rather than repeat its sports. */
    note: plan.goal || plan.description,
    sports,
    sessions: summary?.workouts ?? 0,
    load: summary?.trainingLoad ? Math.round(summary.trainingLoad) : 0,
    /** The heaviest week's load: what the tile leads with. */
    peakLoad: hasLoad ? Math.round(Math.max(...loads)) : 0,
    profileNote: peakWeek ? t("Peak in week {{value1}}", { value1: String(peakWeek) }) : rhythm,
    dominant: dominantSport(summary?.sportDistribution, plan.sportMix),
    ridge: {
      values: weekly.map((week) => (hasLoad ? week.trainingLoad : week.workouts)),
      peakWeek,
      unit: hasLoad ? "load" : "sessions",
      variant: hasLoad ? ("load" as const) : ("count" as const),
      label: `${hasLoad ? "Training load" : "Sessions"} across ${weekly.length} ${weekly.length === 1 ? "week" : "weeks"}`
    }
  };
}

interface PlanIndexProps {
  api: CorosLinkApi;
  noun: PlanIndexNoun;
  plans: TrainingPlanDocument[];
  /** Native plans running on the COROS calendar, keyed by library plan remoteId. */
  nativeOnCalendar?: NativePlansOnCalendar;
  collections: TrainingCollection[];
  onCreate: () => void;
  onGenerate?: (preset?: TrainingPlanPreset) => void;
  /** Plans: Blank plan and Generate plan live in the masthead, so the toolbar leaves them out. */
  createInMasthead?: boolean;
  onCalendar?: (plan: TrainingPlanDocument, operation?: "install" | "remove") => void;
  offline?: boolean;
  onOpen: (plan: TrainingPlanDocument) => void;
  onDuplicate: (plan: TrainingPlanDocument) => void;
  onDelete: (plans: TrainingPlanDocument[]) => void;
  onRefresh: () => Promise<void>;
  onError: (message: string | null) => void;
  onCompare?: (ids: string[]) => void;
}

function PlanIndex({
  api,
  noun,
  plans,
  nativeOnCalendar = NO_NATIVE_PLANS_ON_CALENDAR,
  collections,
  onCreate,
  onGenerate,
  createInMasthead = false,
  onCalendar,
  offline = false,
  onOpen,
  onDuplicate,
  onDelete,
  onRefresh,
  onError,
  onCompare
}: PlanIndexProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useSelectionPreference(
    PLAN_SCOPE_PREFERENCES[noun]
  );
  const [sort, setSort] = useSelectionPreference(PLAN_SORT_PREFERENCES[noun]);
  const [layout, setLayout] = useSelectionPreference(
    PLAN_LAYOUT_PREFERENCES[noun]
  );
  const [selected, setSelected] = useState<string[]>([]);
  /** The goal picked on the "Build me a plan" tile. */
  const [goalPreset, setGoalPreset] = useState<PlanGoalPresetId | null>(null);

  // A deleted plan leaves the selection.
  useEffect(() => {
    setSelected((current) => {
      const kept = current.filter((id) => plans.some((plan) => plan.id === id));
      return kept.length === current.length ? current : kept;
    });
  }, [plans]);

  const summaries = useMemo(
    () => new Map(plans.map((plan) => [plan.id, summarizeTrainingPlan(plan)])),
    [plans, getLocale()]
  );

  const calendarRuns = useMemo(
    () => new Map(plans.flatMap((plan) => {
      const state = planOnCalendar(plan, nativeOnCalendar);
      return state ? [[plan.id, state] as const] : [];
    })),
    [plans, nativeOnCalendar]
  );

  const scopes = useMemo(() => {
    const options = [{ id: "all", label: "All" }];
    if (calendarRuns.size > 0) options.push({ id: "calendar", label: "On calendar" });
    if (plans.some((plan) => plan.favorite)) options.push({ id: "favorite", label: "Favorites" });
    for (const source of ["coros", "local", "coach"] as const) {
      if (plans.some((plan) => plan.source === source)) {
        options.push({ id: source, label: sourceLabel(source) });
      }
    }
    if (plans.some((plan) => UNSETTLED_SYNC.has(plan.syncState))) {
      options.push({ id: "unsettled", label: "Needs attention" });
    }
    if (plans.some((plan) => plan.archived)) options.push({ id: "archived", label: "Archived" });
    return options;
  }, [plans, calendarRuns, getLocale()]);

  const scopeAvailable = scopes.some((option) => option.id === scope);
  useEffect(() => {
    if (!scopeAvailable) setScope("all");
  }, [scopeAvailable, setScope]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = plans.filter((plan) => {
      if (needle) {
        const haystack = `${plan.name} ${plan.description} ${plan.goal} ${plan.tags.join(" ")} ${plan.sportMix.join(" ")}`;
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
      if (scope === "calendar") return calendarRuns.has(plan.id) && !plan.archived;
      if (scope === "favorite") return plan.favorite;
      if (scope === "unsettled") return UNSETTLED_SYNC.has(plan.syncState);
      if (scope === "archived") return plan.archived;
      if (scope !== "all") return plan.source === scope && !plan.archived;
      return !plan.archived;
    });

    const direction = sort.descending ? -1 : 1;
    return matching.sort((left, right) => {
      const leftSummary = summaries.get(left.id);
      const rightSummary = summaries.get(right.id);
      if (sort.column === "name") return left.name.localeCompare(right.name) * direction;
      if (sort.column === "weeks") return (left.weekCount - right.weekCount) * direction;
      if (sort.column === "sessions") {
        return ((leftSummary?.workouts ?? 0) - (rightSummary?.workouts ?? 0)) * direction;
      }
      if (sort.column === "load") {
        return ((leftSummary?.trainingLoad ?? 0) - (rightSummary?.trainingLoad ?? 0)) * direction;
      }
      return left.updatedAt.localeCompare(right.updatedAt) * direction;
    });
  }, [plans, query, scope, sort, summaries, calendarRuns, getLocale()]);

  const update = async (planId: string, patch: TrainingPlanMetadataPatch) => {
    try {
      await api.updateTrainingPlanMetadata(planId, patch);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const updateSelected = async (patch: TrainingPlanMetadataPatch) => {
    try {
      await Promise.all(selected.map((id) => api.updateTrainingPlanMetadata(id, patch)));
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleSort = (column: PlanColumn) =>
    setSort((current) =>
      current.column === column
        ? { column, descending: !current.descending }
        : { column, descending: column !== "name" }
    );

  const sortIndicator = (column: PlanColumn) =>
    sort.column === column ? (sort.descending ? " ↓" : " ↑") : "";

  /** Selection and row actions are identical in both layouts. */
  const selectMark = (plan: TrainingPlanDocument, isSelected: boolean) => (
    <button
      type="button"
      className="tl-mark"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={t("Select {{value1}}", { value1: String(plan.name) })}
      onClick={() =>
        setSelected((current) =>
          current.includes(plan.id)
            ? current.filter((id) => id !== plan.id)
            : [...current, plan.id]
        )
      }
    />
  );

  const selectedPlans = plans.filter((plan) => selected.includes(plan.id));
  // As the row buttons: a COROS plan, or one with workouts on the calendar, needs COROS to delete.
  const deleteNeedsCoros = selectedPlans.some((plan) =>
    plan.source === "coros" || Boolean(activeTrainingPlanCalendarInstall(plan))
  );
  const deleteSelectedBlocked =
    (offline && deleteNeedsCoros) || selectedPlans.some((plan) => plan.source === "coros" && !plan.remoteId);
  const unselectedVisible = visible.filter((plan) => !selected.includes(plan.id)).length;

  const planActions = (plan: TrainingPlanDocument) => {
    const install = activeTrainingPlanCalendarInstall(plan);
    const retryingInstall = install?.state === "partial" && install.lastOperation === "install";
    return <>
      <button
        type="button"
        title={plan.favorite ? t("Remove from favorites") : t("Add to favorites")}
        aria-label={plan.favorite ? t("Remove from favorites") : t("Add to favorites")}
        onClick={() => void update(plan.id, { favorite: !plan.favorite })}
      >
        <Heart size={14} fill={plan.favorite ? "currentColor" : "none"} />
      </button>
      <button type="button" title={t("Duplicate")} aria-label={t("Duplicate {{value1}}", { value1: String(plan.name) })} onClick={() => onDuplicate(plan)}>
        <Copy size={14} />
      </button>
      {noun === "plan" && plan.source !== "coros" && onCalendar ? (
        <button
          type="button"
          disabled={offline}
          title={offline ? t("Reconnect to COROS to change the calendar") : undefined}
          aria-label={t("{{value1}} {{value2}} {{value3}} calendar", { value1: String(install && !retryingInstall ? t("Remove") : retryingInstall ? t("Retry adding") : t("Add")), value2: String(plan.name), value3: String(install && !retryingInstall ? t("from") : t("to")) })}
          onClick={() => onCalendar(plan, retryingInstall ? "install" : undefined)}
        >
          {install && !retryingInstall ? <CalendarX size={14} /> : <CalendarPlus size={14} />}
        </button>
      ) : null}
      {noun === "plan" && plan.source !== "coros" && onCalendar && retryingInstall ? <button type="button" disabled={offline} aria-label={t("Remove partial installation of {{value1}} from calendar", { value1: String(plan.name) })} onClick={() => onCalendar(plan, "remove")}><CalendarX size={14} /></button> : null}
      {plan.source === "coros" ? (
        <button
          type="button"
          className="danger"
          disabled={offline || !plan.remoteId}
          title={offline ? t("Reconnect to COROS to delete this plan") : t("Delete from COROS")}
          aria-label={t("Delete {{value1}} from COROS", { value1: String(plan.name) })}
          onClick={() => onDelete([plan])}
        >
          <Trash2 size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="danger"
          disabled={Boolean(install) && offline}
          title={install && offline ? t("Reconnect to COROS to delete this plan") : undefined}
          aria-label={t("Delete {{value1}}", { value1: String(plan.name) })}
          onClick={() => onDelete([plan])}
        >
          <Trash2 size={14} />
        </button>
      )}
    </>;
  };

  /** Warnings a plan carries until they are settled: sync trouble, or a calendar run that no longer matches it. */
  const planFlags = (plan: TrainingPlanDocument) => {
    const install = activeTrainingPlanCalendarInstall(plan);
    return <>
      {UNSETTLED_SYNC.has(plan.syncState) ? <i className="tl-flag">{plan.syncState}</i> : null}
      {install && install.planRevision !== trainingPlanCalendarRevision(plan) ? <i className="tl-flag">{t("Calendar differs")}</i> : null}
    </>;
  };

  /** Where a plan stands on the calendar: the week it is in, when it starts, or not scheduled. */
  const planStatus = (plan: TrainingPlanDocument) => {
    const calendarRun = calendarRuns.get(plan.id);
    if (!calendarRun) return planStartLabel(plan);
    const label = planCalendarWeekLabel(plan, calendarRun.startDay);
    if (label) return label;
    const start = calendarStartDate(calendarRun.startDay);
    return start && start.valueOf() > Date.now()
      ? t("Starts {{value1}}", { value1: shortDate(start) })
      : t("On calendar");
  };

  const renderTile = (plan: TrainingPlanDocument) => {
    const view = planView(plan, summaries.get(plan.id));
    const isSelected = selected.includes(plan.id);
    const calendarRun = calendarRuns.get(plan.id);

    return (
      <li
        className={`tl-plan-tile${isSelected ? " is-selected" : ""}${calendarRun ? " is-on-calendar" : ""}`}
        key={plan.id}
        style={sportAccentStyle(view.dominant)}
      >
        {selectMark(plan, isSelected)}
        <button type="button" className="tl-plan-tile-open" title={plan.description || undefined} onClick={() => onOpen(plan)}>
          <span className="tl-plan-tile-head">
            <SportGlyph sport={view.dominant} />
            <span className="tl-plan-tile-title">
              <span className="tl-plan-tile-name-row">
                <span className="tl-plan-tile-name" title={plan.name}>{plan.name}</span>
                {plan.goal ? <span className="tl-plan-goal" title={plan.goal}>{plan.goal}</span> : null}
              </span>
              <span className="tl-plan-meta">
                {plan.favorite ? <Heart size={11} fill="currentColor" strokeWidth={0} aria-label={t("Favorite")} /> : null}
                <PlanSourceBadge source={plan.source} />
                {view.sports ? <em title={view.sports}>{view.sports}</em> : null}
                {plan.difficulty && plan.difficulty !== "custom" ? <em>{t(DIFFICULTY_LABELS[plan.difficulty] ?? plan.difficulty)}</em> : null}
              </span>
            </span>
          </span>
          <span className="tl-plan-well" title={[view.ridge.variant === "load" ? t("Weekly load") : t("Sessions per week"), view.profileNote].filter(Boolean).join(" · ")}>
            <span className="tl-plan-caption">
              <span>{view.ridge.variant === "load" ? t("Weekly load") : t("Sessions per week")}</span>
              {view.profileNote ? <span>{view.profileNote}</span> : null}
            </span>
            <WeekProfile {...view.ridge} phases={plan.phases} currentWeek={calendarRun ? planCalendarWeek(plan, calendarRun.startDay) : undefined} />
            {plan.phases.length ? (
              <>
                <span className="tl-phase-ribbon" aria-hidden="true">
                  {plan.phases.map((phase) => (
                    <span
                      key={phase.id}
                      data-phase={phase.kind ?? "custom"}
                      style={{ flexGrow: Math.max(1, phase.endWeek - phase.startWeek + 1) }}
                    >
                      <i />
                    </span>
                  ))}
                </span>
                <span className="tl-phase-legend" aria-label={t("Phases: {{value1}}", { value1: plan.phases.map((phase) => `${phase.name} ${phase.endWeek - phase.startWeek + 1}w`).join(", ") })}>
                  {plan.phases.map((phase) => (
                    <small key={phase.id} data-phase={phase.kind ?? "custom"}>{phase.name} <b>{phase.endWeek - phase.startWeek + 1}w</b></small>
                  ))}
                </span>
              </>
            ) : null}
          </span>
          <span className="tl-plan-figs">
            <span>
              <small>{t("Weeks")}</small>
              <b>{plan.weekCount}</b>
            </span>
            <span>
              <small>{t("Sessions")}</small>
              <b className={view.sessions ? "" : "is-nil"}>{view.sessions || "—"}</b>
            </span>
            <span className="is-load" title={view.load ? t("Total load {{value1}}", { value1: formatNumber(view.load) }) : undefined}>
              <small>{view.peakLoad ? t("Peak load") : t("Load")}</small>
              <b className={view.peakLoad ? "" : "is-nil"}>{view.peakLoad ? formatNumber(view.peakLoad) : "—"}</b>
            </span>
          </span>
        </button>
        <div className="tl-plan-tile-foot">
          {(() => {
            /* Ready: a start date is set but the plan is not on the calendar yet. */
            const ready = !calendarRun && planStartLabel(plan) !== t("Unscheduled");
            return (
              <span className={`tl-plan-status${calendarRun ? " is-live" : ready ? " is-ready" : ""}`}>
                <i aria-hidden="true" />
                {ready ? t("Ready · {{value1}}", { value1: planStatus(plan) }) : planStatus(plan)}
              </span>
            );
          })()}
          {planFlags(plan)}
          <div className="tl-plan-actions">{planActions(plan)}</div>
        </div>
      </li>
    );
  };

  return (
    <div className="tl-panel tl-plan-library">
      <div className="tl-filters">
        <label className="tl-search">
          <Search size={15} />
          <span className="sr-only">{t("Search")} {noun}s</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search {{value1}}s", { value1: String(noun) })}
          />
        </label>
        <SelectDropdown translateLabel={t}
          className="tl-quiet-select tl-plan-scope"
          label={t("Filter {{value1}}s", { value1: String(noun) })}
          value={scope}
          options={scopes.map((option) => ({
            value: option.id,
            label: option.id === "all" ? `All ${noun}s` : option.label
          }))}
          onChange={setScope}
        />
        <div className="tl-filters-tail">
          <SelectDropdown translateLabel={t}
            className="tl-quiet-select"
            label={t("Sort {{value1}}s", { value1: String(noun) })}
            value={sort.column}
            options={PLAN_SORT_OPTIONS}
            onChange={(value) =>
              setSort({ column: value, descending: value !== "name" })
            }
          />
          <div className="tl-layout-switch" role="group" aria-label={t("{{value1}} layout", { value1: String(noun) })}>
            <button
              type="button"
              aria-pressed={layout === "grid"}
              aria-label={t("Show tiles")}
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              aria-pressed={layout === "list"}
              aria-label={t("Show list")}
              onClick={() => setLayout("list")}
            >
              <List size={14} />
            </button>
          </div>
          {!createInMasthead ? <div className="tl-plan-create">
            <button type="button" className={noun === "plan" && onGenerate ? "ghost-button" : "primary-button"} onClick={onCreate}>
              <Plus size={15} /> {t("New")} {noun}
            </button>
            {noun === "plan" && onGenerate ? <button type="button" className="primary-button tl-generate-button" onClick={() => onGenerate()}><Sparkles size={15} /> {t("Generate plan")}</button> : null}
          </div> : null}
        </div>
      </div>

      {query || scope !== "all" ? <div className="tl-plan-results">
        <span role="status"><strong>{visible.length}</strong> {noun}{visible.length === 1 ? "" : "s"} {t("found")}</span>
        <button type="button" className="ghost-button" onClick={() => { setQuery(""); setScope("all"); }}>{t("Clear filters")}</button>
      </div> : null}
      {selected.length ? (
        <div className="tl-bulk" role="toolbar" aria-label={t("Actions for selected {{value1}}s", { value1: String(noun) })}>
          <strong>{selected.length} {t("selected")}</strong>
          {onCompare ? <span className="tl-selection-hint">{t("Select 2–3 plans to compare")}</span> : null}
          {onCompare ? (
            <button
              type="button"
              disabled={selected.length < 2 || selected.length > 3}
              onClick={() => onCompare(selected)}
            >
              <Scale size={13} /> {t("Compare")} </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const value = window.prompt("Tags, separated by commas", "");
              if (value === null) return;
              void updateSelected({
                tags: value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
              });
            }}
          >
            <Tag size={13} /> {t("Tag")} </button>
          {collections.length ? (
            <SelectDropdown translateLabel={t}
              className="tl-quiet-select"
              label={t("Move selected {{value1}}s to a collection", { value1: String(noun) })}
              value=""
              options={[
                { value: "", label: "Move to collection" },
                ...collections.map((collection) => ({
                  value: collection.id,
                  label: collection.name,
                  translate: false
                }))
              ]}
              onChange={(value) => {
                if (value) void updateSelected({ collectionId: value });
              }}
            />
          ) : null}
          {unselectedVisible ? (
            <button type="button" onClick={() => setSelected([...new Set([...selected, ...visible.map((plan) => plan.id)])])}>
              <ListChecks size={13} /> {t("Select all {{value1}}", { value1: String(selected.length + unselectedVisible) })} </button>
          ) : null}
          <button
            type="button"
            className="danger"
            disabled={deleteSelectedBlocked}
            title={deleteSelectedBlocked ? t("Reconnect to COROS to delete these plans") : undefined}
            onClick={() => onDelete(selectedPlans)}
          >
            <Trash2 size={13} /> {t("Delete")} </button>
          <button type="button" aria-label={t("Clear selection")} onClick={() => setSelected([])}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="tl-empty">
          <h3>{query || scope !== "all" ? t("No {{value1}}s match", { value1: String(noun) }) : t("No {{value1}}s yet", { value1: String(noun) })}</h3>
          <p>
            {query || scope !== "all"
              ? t("Clear the search or choose another filter.")
              : noun === "plan"
                ? localOnly ? t("Build a plan here, or ask the Coach to draft one.") : t("Build a plan here, or refresh to pull plans from COROS.")
                : t("Save a plan as a template, or turn a completed activity into one.")}
          </p>
        </div>
      ) : layout === "grid" ? (
        <div className="tl-plan-board">
          <ul className={`tl-plan-grid${selected.length ? " is-selecting" : ""}`} role="list">
            {visible.map(renderTile)}
            {noun === "plan" && onGenerate && scope === "all" && !query ? (
              <li className="tl-plan-generate">
                <div className="tl-plan-generate-card">
                  <span className="tl-plan-generate-sparkles" aria-hidden="true"><i /><i /><i /></span>
                  <span className="tl-plan-generate-head">
                    <span className="tl-plan-generate-badge" aria-hidden="true"><Sparkles size={20} /></span>
                    <span>
                      <b>{t("Build me a plan")}</b>
                      <small>{t("From your library, fitness and race date")}</small>
                    </span>
                  </span>
                  <span className="tl-plan-generate-label" id="tl-plan-goal-label">{t("Goal")}</span>
                  <span className="tl-plan-generate-goals" role="group" aria-labelledby="tl-plan-goal-label">
                    {PLAN_GOAL_PRESETS.map((goal) => (
                      <button
                        type="button"
                        key={goal.id}
                        aria-pressed={goalPreset === goal.id}
                        onClick={() => setGoalPreset(goalPreset === goal.id ? null : goal.id)}
                      >
                        {t(goal.label)}
                      </button>
                    ))}
                  </span>
                  {(() => {
                    const preset = PLAN_GOAL_PRESETS.find((goal) => goal.id === goalPreset);
                    if (!preset) return <span className="tl-plan-generate-facts">{t("Pick a goal, or start from scratch.")}</span>;
                    const raceDay = new Date();
                    raceDay.setDate(raceDay.getDate() + preset.weeks * 7 - 1);
                    return (
                      <span className="tl-plan-generate-facts">
                        {t("Race day")} <b>{formatDate(raceDay, { weekday: "short", month: "short", day: "numeric" })}</b>
                        <i aria-hidden="true">·</i>
                        <b>{preset.sessionsPerWeek}</b> {t("sessions a week")}
                      </span>
                    );
                  })()}
                  <button
                    type="button"
                    className="tl-plan-generate-cta"
                    onClick={() => {
                      const preset = PLAN_GOAL_PRESETS.find((goal) => goal.id === goalPreset);
                      onGenerate?.(preset ? { goal: t(preset.goal), weeks: preset.weeks, sessionsPerWeek: preset.sessionsPerWeek } : undefined);
                    }}
                  >
                    {(() => {
                      const preset = PLAN_GOAL_PRESETS.find((goal) => goal.id === goalPreset);
                      return preset ? t("Generate {{value1}}-week plan", { value1: String(preset.weeks) }) : t("Generate plan");
                    })()}
                  </button>
                </div>
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <div className="tl-index">
          <div className="tl-index-head tl-plan-row">
            <span />
            <button
              type="button"
              className="tl-sortable"
              aria-pressed={sort.column === "name"}
              onClick={() => toggleSort("name")}
            >
              {noun === "plan" ? t("Plan") : t("Template")}
              {sortIndicator("name")}
            </button>
            {PLAN_COLUMNS.map((column) => (
              <button
                type="button"
                key={column.id}
                className="tl-sortable is-numeric"
                aria-pressed={sort.column === column.id}
                onClick={() => toggleSort(column.id)}
              >
                {t(column.label)}
                {sortIndicator(column.id)}
              </button>
            ))}
            <span className="tl-column-label">{t("Weekly load")}</span>
            <span />
          </div>

          <ul role="list">
            {visible.map((plan) => {
              const view = planView(plan, summaries.get(plan.id));
              const isSelected = selected.includes(plan.id);
              const calendarRun = calendarRuns.get(plan.id);

              return (
                <li
                  className={`tl-plan-row tl-row${isSelected ? " is-selected" : ""}${calendarRun ? " is-on-calendar" : ""}`}
                  key={plan.id}
                  data-accent={view.dominant ?? undefined}
                  style={view.dominant ? sportAccentStyle(view.dominant) : undefined}
                >
                  {selectMark(plan, isSelected)}
                  <button type="button" className="tl-row-open has-glyph" onClick={() => onOpen(plan)}>
                    <SportGlyph sport={view.dominant} size={17} />
                    <span className="tl-row-text">
                      <span className="tl-row-name">
                        {plan.favorite ? (
                          <Heart size={12} fill="currentColor" strokeWidth={0} aria-label={t("Favorite")} />
                        ) : null}
                        <span>{plan.name}</span>
                      </span>
                      <span className="tl-row-sub">
                        <PlanSourceBadge source={plan.source} />
                        {view.sports ? <em>{view.sports}</em> : null}
                        {calendarRun ? <i className="tl-live">{planStatus(plan)}</i> : <em>{planStatus(plan)}</em>}
                        {planFlags(plan)}
                      </span>
                    </span>
                  </button>
                  <span className="tl-fig">{plan.weekCount}</span>
                  <span className={`tl-fig${view.sessions ? "" : " is-nil"}`}>
                    {view.sessions || "—"}
                  </span>
                  <span className={`tl-fig${view.load ? "" : " is-nil"}`}>{view.load ? formatNumber(view.load) : "—"}</span>
                  <span className="tl-fig is-quiet">{elapsedLabel(plan.updatedAt)}</span>
                  <WeekProfile {...view.ridge} currentWeek={calendarRun ? planCalendarWeek(plan, calendarRun.startDay) : undefined} />
                  <div className="tl-row-actions">{planActions(plan)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

interface TemplateSectionProps {
  api: CorosLinkApi;
  templates: TrainingPlanDocument[];
  collections: TrainingCollection[];
  onCreate: () => void;
  onOpen: (plan: TrainingPlanDocument) => void;
  onDuplicate: (plan: TrainingPlanDocument) => void;
  onDelete: (plans: TrainingPlanDocument[]) => void;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

function TemplateSection({
  api,
  templates,
  collections,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onRefresh,
  onMessage,
  onError
}: TemplateSectionProps) {
  useLanguage();
  const [newCollection, setNewCollection] = useState("");

  const saveCollection = async () => {
    if (!newCollection.trim()) return;
    try {
      await api.saveTrainingCollection({ id: "", name: newCollection.trim() });
      setNewCollection("");
      onMessage(t("Created the collection \"{{value1}}\".", { value1: String(newCollection.trim()) }));
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="tl-template-layout">
      <PlanIndex
        api={api}
        noun="template"
        plans={templates}
        collections={collections}
        onCreate={onCreate}
        onOpen={onOpen}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onRefresh={onRefresh}
        onError={onError}
      />

      <aside className="tl-panel tl-collections">
        <header>
          <h2>{t("Collections")}</h2>
          <p>{t("Local grouping. Nothing here changes a COROS record.")}</p>
        </header>
        <form
          className="tl-collection-create"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCollection();
          }}
        >
          <input
            aria-label={t("New collection name")}
            value={newCollection}
            onChange={(event) => setNewCollection(event.target.value)}
            placeholder={t("Collection name")}
          />
          <button type="submit" className="ghost-button" disabled={!newCollection.trim()}>
            <FolderPlus size={14} /> {t("Create")} </button>
        </form>
        {collections.length ? (
          <ul role="list">
            {collections.map((collection) => (
              <li key={collection.id}>
                <span>
                  <strong>{collection.name}</strong>
                  <small>
                    {templates.filter((plan) => plan.collectionId === collection.id).length} {t("templates")} </small>
                </span>
                <button
                  type="button"
                  aria-label={t("Delete the collection {{value1}}", { value1: String(collection.name) })}
                  onClick={() => {
                    if (
                      !window.confirm(
                        t("Delete the collection \"{{value1}}\"? Its templates stay in the library.", { value1: String(collection.name) })
                      )
                    ) {
                      return;
                    }
                    void api
                      .deleteTrainingCollection(collection.id, true)
                      .then(onRefresh)
                      .catch((cause: unknown) =>
                        onError(cause instanceof Error ? cause.message : String(cause))
                      );
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tl-collections-empty">
            {t("No collections yet. Name one above to start grouping templates.")} </p>
        )}
      </aside>
    </div>
  );
}

const ADHERENCE_STATES: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "partial", label: "Partial" },
  { id: "missed", label: "Missed" },
  { id: "skipped", label: "Skipped" },
  { id: "rescheduled", label: "Rescheduled" },
  { id: "upcoming", label: "Upcoming" }
];

const ADHERENCE_STATE_PREFERENCE = defineSelectionPreference<string>({
  key: "trainingLibrary.adherenceState",
  defaultValue: "all",
  validate: (value): value is string =>
    typeof value === "string" &&
    ADHERENCE_STATES.some((option) => option.id === value)
});

interface AdherenceSectionProps {
  api: CorosLinkApi;
  matches: TrainingActivityMatch[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

function AdherenceSection({ api, matches, onRefresh, onMessage, onError }: AdherenceSectionProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [activities, setActivities] = useState<TrainingHubActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useSelectionPreference(
    ADHERENCE_STATE_PREFERENCE
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [activityList] = await Promise.all([
        api.listTrainingHubActivities(1, 200, happenDay(-120), happenDay(30)),
        api.refreshTrainingActivityMatches(happenDay(-120), happenDay(30))
      ]);
      setActivities(activityList);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [api, onError, onRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ordered = useMemo(
    () => [...matches].sort((left, right) => right.happenDay.localeCompare(left.happenDay)),
    [matches, getLocale()]
  );
  const visible = ordered.filter((match) => state === "all" || match.status === state);
  const settled = matches.filter((match) => match.status !== "upcoming");
  const honoured = matches.filter(
    (match) => match.status === "completed" || match.status === "partial"
  );
  const completion = settled.length ? Math.round((honoured.length / settled.length) * 100) : 0;

  /** Weekly planned-versus-completed load, oldest week first. */
  const weeks = useMemo<BulletWeek[]>(() => {
    const buckets = new Map<string, BulletWeek>();
    for (const match of matches) {
      const date = happenDayToDate(match.happenDay);
      if (Number.isNaN(date.valueOf())) continue;
      const monday = new Date(date);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? {
        weekLabel: t("Week of {{value1}}", { value1: String(shortDate(monday)) }),
        planned: 0,
        completed: 0
      };
      bucket.planned += match.plannedTrainingLoad ?? 0;
      bucket.completed += match.completedTrainingLoad ?? 0;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, week]) => week);
  }, [matches, getLocale()]);

  const statesPresent = ADHERENCE_STATES.filter(
    (option) => option.id === "all" || matches.some((match) => match.status === option.id)
  );
  const stateAvailable = statesPresent.some((option) => option.id === state);

  useEffect(() => {
    if (!stateAvailable) setState("all");
  }, [setState, stateAvailable]);

  // A link only counts when the activity is on the workout's day, so offer just those.
  const activitiesByDay = useMemo(() => {
    const byDay = new Map<string, TrainingHubActivity[]>();
    for (const activity of activities) {
      const day = activityHappenDay(activity);
      if (day) byDay.set(day, [...(byDay.get(day) ?? []), activity]);
    }
    return byDay;
  }, [activities]);
  const activityOptionsFor = (match: TrainingActivityMatch) => {
    const linked = activities.find((activity) => activity.activityId === match.activityId);
    const sameDay = activitiesByDay.get(match.happenDay) ?? [];
    return [
      { value: "", label: "Match an activity" },
      ...(linked && !sameDay.includes(linked) ? [linked, ...sameDay] : sameDay).map((activity) => ({
        value: activity.activityId,
        label: `${activity.name ?? activity.sportName ?? t("Activity")} · ${activityDate(activity)}`,
        translate: false
      }))
    ];
  };

  const createTemplate = async (activity: TrainingHubActivity) => {
    const plan = createTrainingPlan(
      `${activity.name || activity.sportName || "Activity"} Template`,
      "template"
    );
    plan.weekCount = 1;
    const sport = workoutSportFromType(activity.sportType) ?? "run";
    plan.sportMix = [sport];
    plan.description = t("Created from a completed activity on {{value1}}.", { value1: String(activityDate(activity)) });
    plan.entries = [
      planEntryFromWorkout(
        {
          key: `activity:${activity.activityId}`,
          name: activity.name || `${formatWorkoutSport(sport)} workout`,
          sport,
          distance_km: activity.distance ? activity.distance / 1000 : undefined,
          steps: activity.duration
            ? [
                {
                  kind: "training",
                  target_type: "time",
                  target_duration_seconds: activity.duration,
                  intensity: { type: "none" }
                }
              ]
            : undefined,
          save_to_library: false
        },
        0,
        0
      )
    ];
    try {
      await api.saveLocalTrainingPlan(plan);
      onMessage(t("Saved \"{{value1}}\" to Templates.", { value1: String(plan.name) }));
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const linkActivity = async (match: TrainingActivityMatch, activityId?: string) => {
    const activity = activities.find((item) => item.activityId === activityId);
    try {
      await api.saveManualActivityMatch({
        ...match,
        activityId,
        status: activity ? "completed" : match.happenDay < happenDay(0) ? "missed" : "upcoming",
        confidence: activity ? 1 : undefined,
        manual: true,
        completedDurationSeconds: activity?.duration,
        completedDistanceMeters: activity?.distance,
        completedTrainingLoad: activity?.trainingLoad,
        updatedAt: new Date().toISOString()
      });
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="tl-adherence">
      <section className="tl-panel tl-adherence-lede">
        <header>
          <div>
            <h2>{t("Planned against done")}</h2>
            <p>
              {settled.length
                ? t("{{value1}}% of {{value2}} past sessions were matched to a completed activity.", { value1: String(completion), value2: String(settled.length) })
                : t("No past planned sessions in this range yet.")}
            </p>
          </div>
          <button type="button" className="ghost-button" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} /> {t("Refresh matches")} </button>
        </header>

        {weeks.length ? (
          <figure className="tl-adherence-chart">
            <BulletRidge weeks={weeks} label={t("Planned and completed training load by week")} />
            <figcaption>
              <span>
                {weeks[0]?.weekLabel} &ndash; {weeks[weeks.length - 1]?.weekLabel}
              </span>
              <span className="tl-legend">
                <em className="is-planned" /> {t("planned")} <em className="is-done" /> {t("done")} </span>
            </figcaption>
          </figure>
        ) : null}

        <dl className="tl-tally">
          {(["completed", "partial", "missed", "upcoming"] as const).map((key) => (
            <div key={key} data-status={key}>
              <dt>{key}</dt>
              <dd>{matches.filter((match) => match.status === key).length}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="tl-panel">
        <div className="tl-filters">
          <div className="tl-chips" role="group" aria-label={t("Filter planned sessions")}>
            {statesPresent.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={state === option.id}
                onClick={() => setState(option.id)}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="tl-empty">
            <h3>{matches.length ? t("Nothing in this filter") : t("Nothing to compare yet")}</h3>
            <p>
              {matches.length
                ? t("Choose another filter to see planned sessions.")
                : t("Schedule workouts on the calendar, then refresh here after you finish them.")}
            </p>
          </div>
        ) : (
          <div className="tl-index">
            <div className="tl-index-head tl-match-row">
              <span className="tl-column-label">{t("Day")}</span>
              <span className="tl-column-label">{t("Planned")}</span>
              <span className="tl-column-label">{t("Completed")}</span>
              <span className="tl-column-label is-numeric">{t("Match")}</span>
              <span />
            </div>
            <ul role="list">
              {visible.map((match) => {
                const date = happenDayToDate(match.happenDay);
                const activity = activities.find((item) => item.activityId === match.activityId);
                const completedParts = [
                  match.completedDurationSeconds
                    ? formatDuration(match.completedDurationSeconds)
                    : null,
                  match.completedDistanceMeters
                    ? formatDistanceValue(match.completedDistanceMeters, unitSystem, { digits: 1 })
                    : null,
                  match.completedTrainingLoad ? t("{{value1}} load", { value1: String(Math.round(match.completedTrainingLoad)) }) : null
                ].filter(Boolean);

                return (
                  <li className={`tl-match-row tl-row is-${match.status}`} key={match.id}>
                    <span className="tl-match-day">
                      <b>{shortDate(date)}</b>
                      <small>{weekdayLabel(date)}</small>
                    </span>
                    <span className="tl-match-planned">
                      <b>
                        {match.plannedTrainingLoad
                          ? t("{{value1}} load", { value1: String(Math.round(match.plannedTrainingLoad)) })
                          : t("Structured workout")}
                      </b>
                      <small>
                        {match.plannedDurationSeconds
                          ? formatDuration(match.plannedDurationSeconds)
                          : match.status}
                      </small>
                    </span>
                    <span className="tl-match-done">
                      <SelectDropdown translateLabel={t}
                        className="tl-quiet-select is-wide"
                        label={t("Completed activity for {{value1}}", { value1: String(shortDate(date)) })}
                        value={match.activityId ?? ""}
                        options={activityOptionsFor(match)}
                        onChange={(value) => void linkActivity(match, value || undefined)}
                      />
                      {completedParts.length ? <small>{completedParts.join(" · ")}</small> : null}
                    </span>
                    <span className={`tl-fig${match.activityId ? "" : " is-nil"}`}>
                      {match.manual
                        ? t("manual")
                        : match.confidence
                          ? `${Math.round(match.confidence * 100)}%`
                          : "—"}
                    </span>
                    <div className="tl-row-actions">
                      {match.status === "missed" ? (
                        <button
                          type="button"
                          aria-label={t("Reschedule this session")}
                          onClick={() => {
                            const value = window.prompt("New date (YYYY-MM-DD)");
                            if (!value) return;
                            void api
                              .rescheduleWorkout(
                                {
                                  planId: match.schedulePlanId,
                                  idInPlan: match.scheduleIdInPlan,
                                  happenDay: match.happenDay
                                },
                                value.replace(/-/g, "")
                              )
                              .then(() => {
                                onMessage("Rescheduled the session.");
                                return refresh();
                              })
                              .catch((cause: unknown) =>
                                onError(cause instanceof Error ? cause.message : String(cause))
                              );
                          }}
                        >
                          <CalendarClock size={14} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={t("Skip this session")}
                        onClick={() =>
                          void api
                            .saveManualActivityMatch({
                              ...match,
                              status: "skipped",
                              manual: true,
                              updatedAt: new Date().toISOString()
                            })
                            .then(onRefresh)
                            .catch((cause: unknown) =>
                              onError(cause instanceof Error ? cause.message : String(cause))
                            )
                        }
                      >
                        <SkipForward size={14} />
                      </button>
                      {activity && (activity.duration || activity.distance) ? (
                        <button
                          type="button"
                          aria-label={t("Save this activity as a template")}
                          onClick={() => void createTemplate(activity)}
                        >
                          <Copy size={14} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <section className="tl-panel tl-recent">
        <header>
          <h2>{t("Recent activities")}</h2>
          <p>{t("Open Training Hub for charts, laps, route, and strength detail.")}</p>
        </header>
        <div className="tl-index">
          <div className="tl-index-head tl-activity-row">
            <span className="tl-column-label">{t("Activity")}</span>
            <span className="tl-column-label is-numeric">{t("Time")}</span>
            <span className="tl-column-label is-numeric">{t("Distance")}</span>
            <span className="tl-column-label is-numeric">{t("Load")}</span>
            <span />
          </div>
          <ul role="list">
            {activities.slice(0, 24).map((activity) => (
              <li className="tl-activity-row tl-row" key={activity.activityId}>
                <span className="tl-row-open is-static">
                  <span className="tl-row-name">
                    {activity.name ?? (activity.sportName == null ? activity.sportName : t(String(activity.sportName))) ?? t("Activity")}
                  </span>
                  <span className="tl-row-sub">
                    <em>{activityDate(activity)}</em>
                    {activity.sportName ? <em>{t(activity.sportName)}</em> : null}
                  </span>
                </span>
                <span className="tl-fig">{formatDuration(activity.duration)}</span>
                <span className={`tl-fig${activity.distance ? "" : " is-nil"}`}>
                  {activity.distance
                    ? formatDistanceValue(activity.distance, unitSystem, { digits: 1 })
                    : "—"}
                </span>
                <span className={`tl-fig${activity.trainingLoad ? "" : " is-nil"}`}>
                  {activity.trainingLoad ? Math.round(activity.trainingLoad) : "—"}
                </span>
                <div className="tl-row-actions">
                  {activity.duration || activity.distance ? (
                    <button
                      type="button"
                      aria-label={t("Save {{value1}} as a template", { value1: String(activity.name ?? t("this activity")) })}
                      onClick={() => void createTemplate(activity)}
                    >
                      <Copy size={14} />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
