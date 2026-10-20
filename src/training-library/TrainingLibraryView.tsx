import { formatWorkoutSport } from "../calendar/workoutLabels";
import { getLocale, t, useLanguage } from "../i18n/training";
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  CalendarPlus,
  CalendarClock,
  CalendarRange,
  CalendarX,
  CloudOff,
  Copy,
  FolderPlus,
  Heart,
  LayoutGrid,
  List,
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
  TrainingHubStatus,
  TrainingLibrarySnapshot,
  TrainingPlanDocument,
  TrainingPlanMetadataPatch
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
  SportMixDots,
  SportBadge,
  dominantSport,
  planSourceLabel,
  sportAccentStyle
} from "./sportTheme";
import { SelectDropdown } from "../components/SelectDropdown";
import { BulletRidge, Ridge, type BulletWeek } from "./Ridge";
import { PlanCompare } from "./PlanCompare";
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
    : date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

function weekdayLabel(date: Date): string {
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString(getLocale(), { weekday: "short" });
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

/** "Week 3 of 14" once a calendar run has started; undefined before it starts or after it ends. */
function planCalendarWeekLabel(plan: TrainingPlanDocument, startDay?: string): string | undefined {
  const digits = startDay?.replaceAll("-", "");
  if (!digits || !/^\d{8}$/.test(digits)) return undefined;
  const start = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((today.valueOf() - start.valueOf()) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  if (days < 0 || week > plan.weekCount) return undefined;
  return t("Week {{value1}} of {{value2}}", { value1: String(week), value2: String(plan.weekCount) });
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
  const [section, setSection] = useSelectionPreference(
    LIBRARY_SECTION_PREFERENCE
  );
  const [snapshot, setSnapshot] = useState<TrainingLibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<TrainingPlanDocument | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<TrainingPlanDocument | null>(null);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
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
    if (status?.authenticated) void load();
  }, [load, status?.authenticated]);

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

  const savePlan = async (plan: TrainingPlanDocument) => {
    try {
      const saved = await api.saveLocalTrainingPlan(plan);
      setEditingPlan(null);
      onMessage(t("Saved \"{{value1}}\" as a local {{value2}}.", { value1: String(saved.name), value2: String(saved.source === "template" ? "template" : "plan") }));
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
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

  const duplicatePlan = async (plan: TrainingPlanDocument) => {
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
      remotePlanProgramId: undefined
    }));
    duplicate.calendarInstalls = [];
    await savePlan(duplicate);
  };

  const deletePlan = async () => {
    if (!pendingPlanDelete || deletingPlan) return;
    const plan = pendingPlanDelete;
    setDeletingPlan(true);
    try {
      if (plan.source === "coros" && plan.remoteId) {
        const result = await api.deleteCorosTrainingPlan(plan.remoteId, true);
        onMessage(result.endedCalendarPlans
          ? t("Deleted \"{{value1}}\" from COROS and removed its upcoming workouts from your calendar.", { value1: String(plan.name) })
          : t("Deleted \"{{value1}}\" from COROS.", { value1: String(plan.name) }));
      } else {
        const { removedCalendarWorkouts } = await api.deleteLocalTrainingPlan(plan.id, true);
        onMessage(removedCalendarWorkouts === 1
          ? t("Deleted \"{{value1}}\" and removed 1 upcoming workout from your COROS calendar.", { value1: String(plan.name) })
          : removedCalendarWorkouts
            ? t("Deleted \"{{value1}}\" and removed {{value2}} upcoming workouts from your COROS calendar.", { value1: String(plan.name), value2: String(removedCalendarWorkouts) })
            : `Deleted "${plan.name}".`);
      }
      setPendingPlanDelete(null);
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      // Calendar workouts may already be gone; show the plan as it is now.
      setPendingPlanDelete(null);
      void load();
    } finally {
      setDeletingPlan(false);
    }
  };

  const deleteRemovesCalendar = Boolean(
    pendingPlanDelete && pendingPlanDelete.source !== "coros" && activeTrainingPlanCalendarInstall(pendingPlanDelete)
  );
  const deleteCalendarCount = deleteRemovesCalendar && pendingPlanDelete
    ? upcomingTrainingPlanCalendarWorkoutCount(pendingPlanDelete)
    : 0;

  const stateLabel = current.offline ? "Offline · cached" : current.stale ? "Partial sync" : "Synced";

  return (
    <section className="training-library-view">
      <header className="tl-masthead">
        <div>
          <h1>{t("Training Library")}</h1>
        </div>
        <div className="tl-masthead-actions">
          {current.stale || current.offline ? <span className="tl-state is-stale">
            {current.offline ? <CloudOff size={13} /> : null}
            {t(stateLabel)}
          </span> : null}
          <button
            type="button"
            className="ghost-button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} /> {t("Refresh")} </button>
        </div>
      </header>

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
            {t(label)}
            <span>{counts[id]}</span>
          </button>
        ))}
      </nav>

      {editingPlan ? (
        <PlanEditor
          key={`${editingPlan.id}:${editingPlan.updatedAt}`}
          api={api}
          initialPlan={editingPlan}
          workouts={current.workouts}
          calendarEnabled={current.plans.some((plan) => plan.id === editingPlan.id) && editingPlan.source !== "coros"}
          offline={current.offline}
          onCalendar={(plan, operation) => setCalendarTarget({ plan, operation })}
          onSave={savePlan}
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
              onGenerate={() => setGeneratorOpen(true)}
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

      {generatorOpen ? <TrainingPlanGenerator api={api} onClose={() => setGeneratorOpen(false)} onOpenCoach={onOpenCoach} onGenerated={(plan) => { setGeneratorOpen(false); setEditingPlan(plan); }} /> : null}

      {calendarTarget ? <TrainingPlanCalendarDialog api={api} plan={calendarTarget.plan} requestedOperation={calendarTarget.operation} offline={current.offline} onClose={() => setCalendarTarget(null)} onComplete={(result) => {
        setCalendarTarget(null);
        if (editingPlan?.id === result.plan.id) setEditingPlan(result.plan);
        if (result.failures.length) onMessage(t("Updated {{value1}} calendar workout{{value2}}; {{value3}} need retry.", { value1: String(result.scheduledCount + result.removedCount), value2: String(result.scheduledCount + result.removedCount === 1 ? "" : "s"), value3: String(result.failures.length) }));
        else if (result.scheduledCount) onMessage(t("Added {{value1}} workouts from \"{{value2}}\" to the COROS calendar.", { value1: String(result.scheduledCount), value2: String(result.plan.name) }));
        else onMessage(t("Removed {{value1}} future workouts owned by \"{{value2}}\".", { value1: String(result.removedCount), value2: String(result.plan.name) }));
        void load();
      }} /> : null}

      {pendingPlanDelete ? (
        <div className="tl-dialog-backdrop">
          <section
            className="tl-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plan-delete-title"
          >
            <h2 id="plan-delete-title">
              {t("Delete “")}{pendingPlanDelete.name}&rdquo;?
            </h2>
            {pendingPlanDelete.source === "coros" ? (
              <>
                <p>{t("This deletes the plan from your COROS account, not just from CorosLink.")}</p>
                <p>{t("If the plan is on your COROS calendar, its upcoming workouts are removed too. Past days stay. This can’t be undone.")}</p>
              </>
            ) : deleteRemovesCalendar ? (
              <p>
                {deleteCalendarCount === 1
                  ? t("This deletes the plan from CorosLink and removes its 1 upcoming workout from your COROS calendar. Past days stay.")
                  : deleteCalendarCount
                    ? t("This deletes the plan from CorosLink and removes its {{value1}} upcoming workouts from your COROS calendar. Past days stay.", { value1: String(deleteCalendarCount) })
                    : t("This deletes the plan from CorosLink and removes its upcoming workouts from your COROS calendar. Past days stay.")}
              </p>
            ) : (
              <p>
                {t("This removes the local copy and its")} {pendingPlanDelete.entries.length} {t("item")} {pendingPlanDelete.entries.length === 1 ? "" : "s"}{t(". Plans stored on COROS are not touched.")} </p>
            )}
            <footer>
              <button type="button" className="ghost-button" disabled={deletingPlan} onClick={() => setPendingPlanDelete(null)}>
                {t("Cancel")} </button>
              <button type="button" className="primary-button danger" aria-busy={deletingPlan} disabled={deletingPlan} onClick={() => void deletePlan()}>
                {pendingPlanDelete.source === "coros"
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

/**
 * Everything a tile and a row both need, derived once so the two layouts can
 * never drift apart on what a plan says.
 */
function planView(
  plan: TrainingPlanDocument,
  summary: ReturnType<typeof summarizeTrainingPlan> | undefined,
  noun: "plan" | "template"
) {
  const weekly = summary?.weekly ?? [];
  const hasLoad = weekly.some((week) => week.trainingLoad > 0);
  const sports = plan.sportMix.map((sport) => formatWorkoutSport(sport)).join(", ");
  const context =
    plan.goal || plan.description || sports || `${sourceLabel(plan.source)} ${noun}`;

  return {
    context,
    sessions: summary?.workouts ?? 0,
    load: summary?.trainingLoad ? Math.round(summary.trainingLoad) : 0,
    details: [context, planStartLabel(plan)],
    dominant: dominantSport(summary?.sportDistribution, plan.sportMix),
    sportCounts: summary?.sportDistribution,
    ridge: {
      values: weekly.map((week) => (hasLoad ? week.trainingLoad : week.workouts)),
      peakWeek: hasLoad ? summary?.peakWeek : undefined,
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
  onGenerate?: () => void;
  onCalendar?: (plan: TrainingPlanDocument, operation?: "install" | "remove") => void;
  offline?: boolean;
  onOpen: (plan: TrainingPlanDocument) => void;
  onDuplicate: (plan: TrainingPlanDocument) => void;
  onDelete: (plan: TrainingPlanDocument) => void;
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
  const [query, setQuery] = useState("");
  const [scope, setScope] = useSelectionPreference(
    PLAN_SCOPE_PREFERENCES[noun]
  );
  const [sort, setSort] = useSelectionPreference(PLAN_SORT_PREFERENCES[noun]);
  const [layout, setLayout] = useSelectionPreference(
    PLAN_LAYOUT_PREFERENCES[noun]
  );
  const [selected, setSelected] = useState<string[]>([]);

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
            : current.length < 3
              ? [...current, plan.id]
              : current
        )
      }
    />
  );

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
          onClick={() => onDelete(plan)}
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
          onClick={() => onDelete(plan)}
        >
          <Trash2 size={14} />
        </button>
      )}
    </>;
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
          <div className="tl-plan-create">
            <button type="button" className={noun === "plan" && onGenerate ? "ghost-button" : "primary-button"} onClick={onCreate}>
              <Plus size={15} /> {t("New")} {noun}
            </button>
            {noun === "plan" && onGenerate ? <button type="button" className="primary-button tl-generate-button" onClick={onGenerate}><Sparkles size={15} /> {t("Generate plan")}</button> : null}
          </div>
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
                ? t("Build a plan here, or refresh to pull plans from COROS.")
                : t("Save a plan as a template, or turn a completed activity into one.")}
          </p>
        </div>
      ) : layout === "grid" ? (
        <ul className="tl-grid" role="list">
          {visible.map((plan) => {
            const view = planView(plan, summaries.get(plan.id), noun);
            const isSelected = selected.includes(plan.id);
            const calendarRun = calendarRuns.get(plan.id);
            const calendarWeek = calendarRun ? planCalendarWeekLabel(plan, calendarRun.startDay) : undefined;

            return (
              <li
                className={`tl-card${isSelected ? " is-selected" : ""}${calendarRun ? " is-on-calendar" : ""}`}
                key={plan.id}
                data-accent={view.dominant ?? undefined}
                style={view.dominant ? sportAccentStyle(view.dominant) : undefined}
              >
                {selectMark(plan, isSelected)}
                <button type="button" className="tl-card-open" onClick={() => onOpen(plan)}>
                  <span className="tl-card-top">
                    {plan.favorite ? (
                      <Heart size={11} fill="currentColor" strokeWidth={0} aria-label={t("Favorite")} />
                    ) : null}
                    <PlanSourceBadge source={plan.source} />
                    {calendarRun ? <i className="tl-live">{t("On calendar")}</i> : null}
                    {UNSETTLED_SYNC.has(plan.syncState) ? (
                      <i className="tl-flag">{plan.syncState}</i>
                    ) : null}
                    {activeTrainingPlanCalendarInstall(plan) && activeTrainingPlanCalendarInstall(plan)?.planRevision !== trainingPlanCalendarRevision(plan) ? <i className="tl-flag">{t("Calendar differs")}</i> : null}
                  </span>
                  <span className="tl-card-name" title={plan.name}>{plan.name}</span>
                  <span className="tl-card-note" title={view.context}>{view.context}</span>
                  <span className="tl-plan-sports">
                    {plan.sportMix.slice(0, 3).map((sport) => <SportBadge key={sport} sport={sport} compact />)}
                    {plan.sportMix.length > 3 ? <span title={plan.sportMix.slice(3).map(formatWorkoutSport).join(", ")}>+{plan.sportMix.length - 3} {t("more")}</span> : null}
                  </span>
                  <span className="tl-plan-profile">
                    <span className="tl-plan-profile-label">{view.ridge.variant === "load" ? t("Weekly training load") : t("Sessions per week")}<span>{plan.weekCount} {plan.weekCount === 1 ? t("week") : t("weeks")}</span></span>
                    <Ridge {...view.ridge} />
                  </span>
                  <span className="tl-card-figs">
                    <span>
                      <b>{plan.weekCount}</b>
                      <small>{plan.weekCount === 1 ? t("week") : t("weeks")}</small>
                    </span>
                    <span>
                      <b className={view.sessions ? "" : "is-nil"}>{view.sessions || "—"}</b>
                      <small>{view.sessions === 1 ? t("session") : t("sessions")}</small>
                    </span>
                    {view.load > 0 ? <span>
                      <b>{view.load}</b>
                      <small>{t("training load")}</small>
                    </span> : null}
                  </span>
                </button>
                <div className="tl-plan-card-footer">
                  <span className={calendarWeek ? "is-live" : undefined}><CalendarClock size={12} aria-hidden="true" />{calendarWeek ?? planStartLabel(plan)}</span>
                  <div className="tl-card-actions">{planActions(plan)}</div>
                </div>
              </li>
            );
          })}
        </ul>
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
              {noun}
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
              const view = planView(plan, summaries.get(plan.id), noun);
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
                  <button type="button" className="tl-row-open" onClick={() => onOpen(plan)}>
                    <span className="tl-row-name">
                      {plan.favorite ? (
                        <Heart size={12} fill="currentColor" strokeWidth={0} aria-label={t("Favorite")} />
                      ) : null}
                      {plan.name}
                    </span>
                    <span className="tl-row-sub">
                      <SportMixDots sports={plan.sportMix} counts={view.sportCounts} />
                      {view.details.map((detail, index) => (
                        <em key={index}>{detail}</em>
                      ))}
                      <PlanSourceBadge source={plan.source} />
                      {calendarRun ? <i className="tl-live">{t("On calendar")}</i> : null}
                      {UNSETTLED_SYNC.has(plan.syncState) ? (
                        <i className="tl-flag">{plan.syncState}</i>
                      ) : null}
                      {activeTrainingPlanCalendarInstall(plan) && activeTrainingPlanCalendarInstall(plan)?.planRevision !== trainingPlanCalendarRevision(plan) ? <i className="tl-flag">{t("Calendar differs")}</i> : null}
                    </span>
                  </button>
                  <span className="tl-fig">{plan.weekCount}</span>
                  <span className={`tl-fig${view.sessions ? "" : " is-nil"}`}>
                    {view.sessions || "—"}
                  </span>
                  <span className={`tl-fig${view.load ? "" : " is-nil"}`}>{view.load || "—"}</span>
                  <span className="tl-fig is-quiet">{elapsedLabel(plan.updatedAt)}</span>
                  <Ridge {...view.ridge} />
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
  onDelete: (plan: TrainingPlanDocument) => void;
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
