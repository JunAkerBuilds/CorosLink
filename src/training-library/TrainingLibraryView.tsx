import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  CalendarClock,
  CalendarRange,
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
  planEntryFromWorkout,
  summarizeTrainingPlan,
  workoutSportFromType
} from "../../electron/trainingPlanDomain";
import type { CorosLinkApi } from "../coroslink-api";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { SelectDropdown } from "../components/SelectDropdown";
import { BulletRidge, Ridge, type BulletWeek } from "./Ridge";
import { PlanCompare } from "./PlanCompare";
import { PlanEditor } from "./PlanEditor";
import { WorkoutWorkspace } from "./WorkoutWorkspace";
import "./trainingLibrary.css";

interface TrainingLibraryViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
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
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function weekdayLabel(date: Date): string {
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString(undefined, { weekday: "short" });
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
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 6) return `${weeks} wk`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} mo` : `${Math.round(days / 365)} yr`;
}

function planStartLabel(plan: TrainingPlanDocument): string {
  if (!plan.startDate) return "Unscheduled";
  const date = new Date(`${plan.startDate}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? "Unscheduled" : `Starts ${shortDate(date)}`;
}

function sourceLabel(source: TrainingPlanDocument["source"]): string {
  if (source === "coros") return "COROS";
  if (source === "coach") return "Coach";
  if (source === "template") return "Template";
  return "Local";
}

export function TrainingLibraryView({
  api,
  status,
  onOpenTraining,
  onMessage,
  onError
}: TrainingLibraryViewProps) {
  const [section, setSection] = useState<LibrarySection>("workouts");
  const [snapshot, setSnapshot] = useState<TrainingLibrarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<TrainingPlanDocument | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [pendingPlanDelete, setPendingPlanDelete] = useState<TrainingPlanDocument | null>(null);

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

  if (!status?.authenticated) {
    return (
      <section className="training-library-gate">
        <BookOpen size={30} strokeWidth={1.5} />
        <h1>Training Library</h1>
        <p>Connect COROS Training Hub to load your workouts, plans, and completed activities.</p>
        <button type="button" className="primary-button" onClick={onOpenTraining}>
          Connect Training Hub
        </button>
      </section>
    );
  }

  if (!snapshot && loading) {
    return (
      <section className="training-library-view">
        <header className="tl-masthead">
          <h1>Training Library</h1>
        </header>
        <div className="tl-skeleton" aria-label="Loading the training library">
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
        <h1>The library didn&rsquo;t load</h1>
        <p>{fatalError}</p>
        <button type="button" className="primary-button" onClick={() => void load()}>
          Try again
        </button>
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
      onMessage(`Saved "${saved.name}" as a local ${saved.source === "template" ? "template" : "plan"}.`);
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
    await savePlan(duplicate);
  };

  const deletePlan = async () => {
    if (!pendingPlanDelete) return;
    try {
      await api.deleteLocalTrainingPlan(pendingPlanDelete.id, true);
      onMessage(`Deleted "${pendingPlanDelete.name}".`);
      setPendingPlanDelete(null);
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stateLabel = current.offline ? "Offline · cached" : current.stale ? "Partial sync" : "Synced";

  return (
    <section className="training-library-view">
      <header className="tl-masthead">
        <div>
          <h1>Training Library</h1>
          <p className="tl-census">
            <span>
              <b>{counts.workouts}</b> workouts
            </span>
            <span>
              <b>{counts.plans}</b> plans
            </span>
            <span>
              <b>{counts.templates}</b> templates
            </span>
            <span>
              <b>{counts.adherence}</b> planned sessions
            </span>
          </p>
        </div>
        <div className="tl-masthead-actions">
          <span className={`tl-state${current.stale || current.offline ? " is-stale" : ""}`}>
            {current.offline ? <CloudOff size={13} /> : null}
            {stateLabel}
          </span>
          <button
            type="button"
            className="ghost-button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} /> Refresh
          </button>
        </div>
      </header>

      {current.partialFailures.length ? (
        <details className="tl-notice">
          <summary>
            <AlertTriangle size={14} />
            Some COROS data didn&rsquo;t refresh. Cached items are still shown.
          </summary>
          {current.partialFailures.map((failure) => (
            <p key={failure}>{failure}</p>
          ))}
        </details>
      ) : null}

      <nav className="tl-sections" aria-label="Library sections">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id)}
          >
            <Icon aria-hidden="true" />
            {label}
            <span>{counts[id]}</span>
          </button>
        ))}
      </nav>

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
          collections={current.collections}
          readOnlyReason={current.nativePlanWrites.reason}
          onCreate={() => createPlan("local")}
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

      {editingPlan ? (
        <PlanEditor
          initialPlan={editingPlan}
          workouts={current.workouts}
          onSave={savePlan}
          onClose={() => setEditingPlan(null)}
        />
      ) : null}

      {compareOpen ? (
        <PlanCompare
          plans={plans}
          selectedIds={compareIds}
          onSelectionChange={setCompareIds}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {pendingPlanDelete ? (
        <div className="tl-dialog-backdrop">
          <section
            className="tl-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="plan-delete-title"
          >
            <h2 id="plan-delete-title">
              Delete &ldquo;{pendingPlanDelete.name}&rdquo;?
            </h2>
            <p>
              This removes the local copy and its {pendingPlanDelete.entries.length} item
              {pendingPlanDelete.entries.length === 1 ? "" : "s"}. Plans stored on COROS are not
              touched.
            </p>
            <footer>
              <button type="button" className="ghost-button" onClick={() => setPendingPlanDelete(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button danger" onClick={() => void deletePlan()}>
                Delete plan
              </button>
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
    details: [context, planStartLabel(plan), sourceLabel(plan.source)],
    ridge: {
      values: weekly.map((week) => (hasLoad ? week.trainingLoad : week.workouts)),
      peakWeek: hasLoad ? summary?.peakWeek : undefined,
      unit: hasLoad ? "load" : "sessions",
      variant: hasLoad ? ("load" as const) : ("count" as const),
      label: `${hasLoad ? "Training load" : "Sessions"} across ${weekly.length} weeks`
    }
  };
}

interface PlanIndexProps {
  api: CorosLinkApi;
  noun: "plan" | "template";
  plans: TrainingPlanDocument[];
  collections: TrainingCollection[];
  readOnlyReason?: string;
  onCreate: () => void;
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
  collections,
  readOnlyReason,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onRefresh,
  onError,
  onCompare
}: PlanIndexProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState<PlanSort>({ column: "updated", descending: true });
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);

  const summaries = useMemo(
    () => new Map(plans.map((plan) => [plan.id, summarizeTrainingPlan(plan)])),
    [plans]
  );

  const scopes = useMemo(() => {
    const options = [{ id: "all", label: "All" }];
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
  }, [plans]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = plans.filter((plan) => {
      if (needle) {
        const haystack = `${plan.name} ${plan.description} ${plan.goal} ${plan.tags.join(" ")} ${plan.sportMix.join(" ")}`;
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
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
  }, [plans, query, scope, sort, summaries]);

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
      aria-label={`Select ${plan.name}`}
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

  const planActions = (plan: TrainingPlanDocument) => (
    <>
      <button
        type="button"
        aria-label={plan.favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => void update(plan.id, { favorite: !plan.favorite })}
      >
        <Heart size={14} fill={plan.favorite ? "currentColor" : "none"} />
      </button>
      <button type="button" aria-label={`Duplicate ${plan.name}`} onClick={() => onDuplicate(plan)}>
        <Copy size={14} />
      </button>
      {plan.source !== "coros" ? (
        <button
          type="button"
          className="danger"
          aria-label={`Delete ${plan.name}`}
          onClick={() => onDelete(plan)}
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </>
  );

  return (
    <div className="tl-panel">
      <div className="tl-filters">
        <label className="tl-search">
          <Search size={15} />
          <span className="sr-only">Search {noun}s</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${noun}s, goals, and tags`}
          />
        </label>
        <div className="tl-chips" role="group" aria-label={`Filter ${noun}s`}>
          {scopes.map((option) => (
            <button
              type="button"
              key={option.id}
              aria-pressed={scope === option.id}
              onClick={() => setScope(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="tl-filters-tail">
          <SelectDropdown
            className="tl-quiet-select"
            label={`Sort ${noun}s`}
            value={sort.column}
            options={PLAN_SORT_OPTIONS}
            onChange={(value) =>
              setSort({ column: value, descending: value !== "name" })
            }
          />
          <div className="tl-layout-switch" role="group" aria-label={`${noun} layout`}>
            <button
              type="button"
              aria-pressed={layout === "grid"}
              aria-label="Show tiles"
              onClick={() => setLayout("grid")}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              aria-pressed={layout === "list"}
              aria-label="Show list"
              onClick={() => setLayout("list")}
            >
              <List size={14} />
            </button>
          </div>
          <button type="button" className="primary-button" onClick={onCreate}>
            <Plus size={14} /> New {noun}
          </button>
        </div>
      </div>

      {readOnlyReason ? (
        <p className="tl-inline-note">
          <AlertTriangle size={14} />
          COROS plans open as read-only copies here. {readOnlyReason}
        </p>
      ) : null}

      {selected.length ? (
        <div className="tl-bulk" role="toolbar" aria-label={`Actions for selected ${noun}s`}>
          <strong>{selected.length} selected</strong>
          {onCompare ? (
            <button
              type="button"
              disabled={selected.length < 2 || selected.length > 3}
              onClick={() => onCompare(selected)}
            >
              <Scale size={13} /> Compare
            </button>
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
            <Tag size={13} /> Tag
          </button>
          {collections.length ? (
            <SelectDropdown
              className="tl-quiet-select"
              label={`Move selected ${noun}s to a collection`}
              value=""
              options={[
                { value: "", label: "Move to collection" },
                ...collections.map((collection) => ({
                  value: collection.id,
                  label: collection.name
                }))
              ]}
              onChange={(value) => {
                if (value) void updateSelected({ collectionId: value });
              }}
            />
          ) : null}
          <button type="button" aria-label="Clear selection" onClick={() => setSelected([])}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="tl-empty">
          <h3>{query || scope !== "all" ? `No ${noun}s match` : `No ${noun}s yet`}</h3>
          <p>
            {query || scope !== "all"
              ? "Clear the search or choose another filter."
              : noun === "plan"
                ? "Build a plan here, or refresh to pull plans from COROS."
                : "Save a plan as a template, or turn a completed activity into one."}
          </p>
        </div>
      ) : layout === "grid" ? (
        <ul className="tl-grid" role="list">
          {visible.map((plan) => {
            const view = planView(plan, summaries.get(plan.id), noun);
            const isSelected = selected.includes(plan.id);

            return (
              <li className={`tl-card${isSelected ? " is-selected" : ""}`} key={plan.id}>
                {selectMark(plan, isSelected)}
                <button type="button" className="tl-card-open" onClick={() => onOpen(plan)}>
                  <span className="tl-card-top">
                    {plan.favorite ? (
                      <Heart size={11} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                    ) : null}
                    <em>{sourceLabel(plan.source)}</em>
                    {UNSETTLED_SYNC.has(plan.syncState) ? (
                      <i className="tl-flag">{plan.syncState}</i>
                    ) : null}
                  </span>
                  <span className="tl-card-name">{plan.name}</span>
                  <span className="tl-card-note">
                    {view.context} · {planStartLabel(plan)}
                  </span>
                  <Ridge {...view.ridge} />
                  <span className="tl-card-figs">
                    <span>
                      <b>{plan.weekCount}</b>
                      <small>weeks</small>
                    </span>
                    <span>
                      <b className={view.sessions ? "" : "is-nil"}>{view.sessions || "—"}</b>
                      <small>sessions</small>
                    </span>
                    <span>
                      <b className={view.load ? "" : "is-nil"}>{view.load || "—"}</b>
                      <small>load</small>
                    </span>
                  </span>
                </button>
                <div className="tl-card-actions">{planActions(plan)}</div>
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
                {column.label}
                {sortIndicator(column.id)}
              </button>
            ))}
            <span className="tl-column-label">Weekly load</span>
            <span />
          </div>

          <ul role="list">
            {visible.map((plan) => {
              const view = planView(plan, summaries.get(plan.id), noun);
              const isSelected = selected.includes(plan.id);

              return (
                <li className={`tl-plan-row tl-row${isSelected ? " is-selected" : ""}`} key={plan.id}>
                  {selectMark(plan, isSelected)}
                  <button type="button" className="tl-row-open" onClick={() => onOpen(plan)}>
                    <span className="tl-row-name">
                      {plan.favorite ? (
                        <Heart size={12} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                      ) : null}
                      {plan.name}
                    </span>
                    <span className="tl-row-sub">
                      {view.details.map((detail, index) => (
                        <em key={index}>{detail}</em>
                      ))}
                      {UNSETTLED_SYNC.has(plan.syncState) ? (
                        <i className="tl-flag">{plan.syncState}</i>
                      ) : null}
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
  const [newCollection, setNewCollection] = useState("");

  const saveCollection = async () => {
    if (!newCollection.trim()) return;
    try {
      await api.saveTrainingCollection({ id: "", name: newCollection.trim() });
      setNewCollection("");
      onMessage(`Created the collection "${newCollection.trim()}".`);
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
          <h2>Collections</h2>
          <p>Local grouping. Nothing here changes a COROS record.</p>
        </header>
        <form
          className="tl-collection-create"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCollection();
          }}
        >
          <input
            aria-label="New collection name"
            value={newCollection}
            onChange={(event) => setNewCollection(event.target.value)}
            placeholder="Collection name"
          />
          <button type="submit" className="ghost-button" disabled={!newCollection.trim()}>
            <FolderPlus size={14} /> Create
          </button>
        </form>
        {collections.length ? (
          <ul role="list">
            {collections.map((collection) => (
              <li key={collection.id}>
                <span>
                  <strong>{collection.name}</strong>
                  <small>
                    {templates.filter((plan) => plan.collectionId === collection.id).length} templates
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={`Delete the collection ${collection.name}`}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete the collection "${collection.name}"? Its templates stay in the library.`
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
            No collections yet. Name one above to start grouping templates.
          </p>
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

interface AdherenceSectionProps {
  api: CorosLinkApi;
  matches: TrainingActivityMatch[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

function AdherenceSection({ api, matches, onRefresh, onMessage, onError }: AdherenceSectionProps) {
  const [activities, setActivities] = useState<TrainingHubActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState("all");

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
    [matches]
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
        weekLabel: `Week of ${shortDate(monday)}`,
        planned: 0,
        completed: 0
      };
      bucket.planned += match.plannedTrainingLoad ?? 0;
      bucket.completed += match.completedTrainingLoad ?? 0;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, week]) => week);
  }, [matches]);

  const statesPresent = ADHERENCE_STATES.filter(
    (option) => option.id === "all" || matches.some((match) => match.status === option.id)
  );

  const activityOptions = useMemo(
    () => [
      { value: "", label: "Match an activity" },
      ...activities.map((activity) => ({
        value: activity.activityId,
        label: `${activity.name ?? activity.sportName ?? "Activity"} · ${activityDate(activity)}`
      }))
    ],
    [activities]
  );

  const createTemplate = async (activity: TrainingHubActivity) => {
    const plan = createTrainingPlan(
      `${activity.name || activity.sportName || "Activity"} Template`,
      "template"
    );
    plan.weekCount = 1;
    const sport = workoutSportFromType(activity.sportType) ?? "run";
    plan.sportMix = [sport];
    plan.description = `Created from a completed activity on ${activityDate(activity)}.`;
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
      onMessage(`Saved "${plan.name}" to Templates.`);
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
            <h2>Planned against done</h2>
            <p>
              {settled.length
                ? `${completion}% of ${settled.length} past sessions were matched to a completed activity.`
                : "No past planned sessions in this range yet."}
            </p>
          </div>
          <button type="button" className="ghost-button" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} /> Refresh matches
          </button>
        </header>

        {weeks.length ? (
          <figure className="tl-adherence-chart">
            <BulletRidge weeks={weeks} label="Planned and completed training load by week" />
            <figcaption>
              <span>
                {weeks[0]?.weekLabel} &ndash; {weeks[weeks.length - 1]?.weekLabel}
              </span>
              <span className="tl-legend">
                <em className="is-planned" /> planned
                <em className="is-done" /> done
              </span>
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
          <div className="tl-chips" role="group" aria-label="Filter planned sessions">
            {statesPresent.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={state === option.id}
                onClick={() => setState(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="tl-empty">
            <h3>{matches.length ? "Nothing in this filter" : "Nothing to compare yet"}</h3>
            <p>
              {matches.length
                ? "Choose another filter to see planned sessions."
                : "Schedule workouts on the calendar, then refresh here after you finish them."}
            </p>
          </div>
        ) : (
          <div className="tl-index">
            <div className="tl-index-head tl-match-row">
              <span className="tl-column-label">Day</span>
              <span className="tl-column-label">Planned</span>
              <span className="tl-column-label">Completed</span>
              <span className="tl-column-label is-numeric">Match</span>
              <span />
            </div>
            <ul role="list">
              {visible.map((match) => {
                const date = happenDayToDate(match.happenDay);
                const activity = activities.find((item) => item.activityId === match.activityId);
                const completedParts = [
                  formatDuration(match.completedDurationSeconds),
                  match.completedDistanceMeters
                    ? `${(match.completedDistanceMeters / 1000).toFixed(1)} km`
                    : null,
                  match.completedTrainingLoad ? `${Math.round(match.completedTrainingLoad)} load` : null
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
                          ? `${Math.round(match.plannedTrainingLoad)} load`
                          : "Structured workout"}
                      </b>
                      <small>
                        {match.plannedDurationSeconds
                          ? formatDuration(match.plannedDurationSeconds)
                          : match.status}
                      </small>
                    </span>
                    <span className="tl-match-done">
                      <SelectDropdown
                        className="tl-quiet-select is-wide"
                        label={`Completed activity for ${shortDate(date)}`}
                        value={match.activityId ?? ""}
                        options={activityOptions}
                        onChange={(value) => void linkActivity(match, value || undefined)}
                      />
                      {completedParts.length ? <small>{completedParts.join(" · ")}</small> : null}
                    </span>
                    <span className={`tl-fig${match.activityId ? "" : " is-nil"}`}>
                      {match.manual
                        ? "manual"
                        : match.confidence
                          ? `${Math.round(match.confidence * 100)}%`
                          : "—"}
                    </span>
                    <div className="tl-row-actions">
                      {match.status === "missed" ? (
                        <button
                          type="button"
                          aria-label="Reschedule this session"
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
                        aria-label="Skip this session"
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
                          aria-label="Save this activity as a template"
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
          <h2>Recent activities</h2>
          <p>Open Training Hub for charts, laps, route, and strength detail.</p>
        </header>
        <div className="tl-index">
          <div className="tl-index-head tl-activity-row">
            <span className="tl-column-label">Activity</span>
            <span className="tl-column-label is-numeric">Time</span>
            <span className="tl-column-label is-numeric">Distance</span>
            <span className="tl-column-label is-numeric">Load</span>
            <span />
          </div>
          <ul role="list">
            {activities.slice(0, 24).map((activity) => (
              <li className="tl-activity-row tl-row" key={activity.activityId}>
                <span className="tl-row-open is-static">
                  <span className="tl-row-name">
                    {activity.name ?? activity.sportName ?? "Activity"}
                  </span>
                  <span className="tl-row-sub">
                    <em>{activityDate(activity)}</em>
                    {activity.sportName ? <em>{activity.sportName}</em> : null}
                  </span>
                </span>
                <span className="tl-fig">{formatDuration(activity.duration)}</span>
                <span className={`tl-fig${activity.distance ? "" : " is-nil"}`}>
                  {activity.distance ? `${(activity.distance / 1000).toFixed(1)}` : "—"}
                </span>
                <span className={`tl-fig${activity.trainingLoad ? "" : " is-nil"}`}>
                  {activity.trainingLoad ? Math.round(activity.trainingLoad) : "—"}
                </span>
                <div className="tl-row-actions">
                  {activity.duration || activity.distance ? (
                    <button
                      type="button"
                      aria-label={`Save ${activity.name ?? "this activity"} as a template`}
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
