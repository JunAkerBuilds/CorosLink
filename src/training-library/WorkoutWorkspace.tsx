import {
  CalendarPlus,
  Copy,
  Download,
  Heart,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Unlink,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  RunWorkoutEditorNode,
  TrainingCollection,
  TrainingLibraryWorkout,
  WorkoutEditPreview,
  WorkoutEditorDocument
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel } from "../training/formatters";
import { sportColorCategory } from "../training/sportColors";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { workoutSportFromType } from "../../electron/trainingPlanDomain";
import { SelectDropdown } from "../components/SelectDropdown";
import { WorkoutEditorModal } from "../calendar/WorkoutEditorModal";
import { AddWorkoutModal } from "../calendar/AddWorkoutModal";

interface WorkoutWorkspaceProps {
  api: CorosLinkApi;
  workouts: TrainingLibraryWorkout[];
  collections: TrainingCollection[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

type WorkoutColumn = "name" | "total" | "load" | "used";

interface WorkoutSort {
  column: WorkoutColumn;
  descending: boolean;
}

const WORKOUT_COLUMNS: Array<{ id: WorkoutColumn; label: string }> = [
  { id: "total", label: "Total" },
  { id: "load", label: "Load" },
  { id: "used", label: "Used" }
];

/** Tiles have no column headings to click, so sorting gets its own control. */
const WORKOUT_SORT_OPTIONS: Array<{ value: WorkoutColumn; label: string }> = [
  { value: "name", label: "Name" },
  { value: "total", label: "Duration" },
  { value: "load", label: "Training load" },
  { value: "used", label: "Most used" }
];

const UNSETTLED_SYNC = new Set(["pending", "conflicted", "failed", "stale"]);
/** Enough segments to read an interval comb without drawing thousands of them. */
const SHAPE_SEGMENT_LIMIT = 96;

/** Legend wording for the step kinds the shape bar can draw, in session order. */
const STEP_KIND_LABELS: Record<string, string> = {
  warmup: "Warm-up",
  training: "Work",
  rest: "Rest",
  cooldown: "Cool-down",
  sendOff: "Send-off"
};
const STEP_KIND_ORDER = Object.keys(STEP_KIND_LABELS);

function metricFromVolume(volume: string | undefined, kind: "duration" | "distance"): number {
  const value = volume?.toLowerCase() ?? "";
  if (kind === "duration") {
    const hours = Number(value.match(/([\d.]+)\s*h/)?.[1] ?? 0);
    const minutes = Number(value.match(/([\d.]+)\s*m(?:in)?/)?.[1] ?? 0);
    return hours * 3600 + minutes * 60;
  }
  const distance = Number(value.match(/([\d.]+)\s*(km|mi|m)\b/)?.[1] ?? 0);
  if (value.includes(" km")) return distance * 1000;
  if (value.includes(" mi")) return distance * 1609.344;
  return distance;
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function targetLabel(node: RunWorkoutEditorNode): string {
  if (node.nodeType === "repeat") return `${node.repeat} rounds`;
  const target = node.target;
  if (target.type === "time") return `${Math.round(target.seconds / 60)} min`;
  if (target.type === "distance") {
    return target.meters >= 1000 ? `${(target.meters / 1000).toFixed(1)} km` : `${target.meters} m`;
  }
  if (target.type === "load") return `${target.load} load`;
  if (target.type === "reps") return `${target.count} reps`;
  if (target.type === "routes") return `${target.count} routes`;
  if (target.type === "elevationGain") return `${target.meters} m gain`;
  if (target.type === "hrRecovery") return `${target.bpm} bpm recovery`;
  return "Open";
}

/** Repeat groups carry no kind of their own; they borrow their first child's. */
function nodeKind(node: RunWorkoutEditorNode): string | undefined {
  return node.nodeType === "step" ? node.kind : node.steps[0]?.kind;
}

interface ShapeSegment {
  kind: string;
  share: number;
  label: string;
}

/**
 * The reader's counterpart to the plan ridge: one segment per step, width
 * proportional to how long the step runs, shaded by the step's declared kind.
 * Repeats expand, so an interval set reads as a comb.
 */
function workoutShape(nodes: RunWorkoutEditorNode[]): ShapeSegment[] {
  const segments: ShapeSegment[] = [];

  const push = (node: RunWorkoutEditorNode) => {
    if (segments.length >= SHAPE_SEGMENT_LIMIT || node.nodeType === "repeat") return;
    const target = node.target;
    const weight =
      target.type === "time"
        ? target.seconds
        : target.type === "distance"
          ? target.meters / 3
          : target.type === "reps"
            ? target.count * 4
            : 120;
    segments.push({ kind: node.kind, share: Math.max(weight, 1), label: `${node.name} · ${targetLabel(node)}` });
  };

  for (const node of nodes) {
    if (node.nodeType === "repeat") {
      for (let round = 0; round < node.repeat; round += 1) {
        for (const step of node.steps) push(step);
      }
    } else {
      push(node);
    }
  }

  const total = segments.reduce((sum, segment) => sum + segment.share, 0) || 1;
  return segments.map((segment) => ({ ...segment, share: (segment.share / total) * 100 }));
}

function downloadSelection(workouts: TrainingLibraryWorkout[]) {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), workouts }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `coroslink-workouts-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WorkoutWorkspace({
  api,
  workouts,
  collections,
  onRefresh,
  onMessage,
  onError
}: WorkoutWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState<WorkoutSort>({ column: "name", descending: false });
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(workouts[0]?.id ?? null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewDocument, setPreviewDocument] = useState<WorkoutEditorDocument | null>(null);
  const [previewMetrics, setPreviewMetrics] = useState<WorkoutEditPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(tomorrow);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [duplicateSport, setDuplicateSport] = useState<number | undefined>();
  const [creating, setCreating] = useState(false);

  const scopes = useMemo(() => {
    const options = [{ id: "all", label: "All" }];
    if (workouts.some((workout) => workout.favorite)) {
      options.push({ id: "favorite", label: "Favorites" });
    }
    const sports = [...new Set(workouts.map((workout) => workout.sportType))]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);
    for (const sportType of sports) {
      options.push({
        id: `sport:${sportType}`,
        label: formatWorkoutSport(workoutSportFromType(sportType) ?? "run")
      });
    }
    if (workouts.some((workout) => UNSETTLED_SYNC.has(workout.syncState))) {
      options.push({ id: "unsettled", label: "Needs attention" });
    }
    return options;
  }, [workouts]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = workouts.filter((workout) => {
      if (needle && !`${workout.name} ${workout.tags.join(" ")}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (scope === "favorite") return workout.favorite;
      if (scope === "unsettled") return UNSETTLED_SYNC.has(workout.syncState);
      if (scope.startsWith("sport:")) return String(workout.sportType) === scope.slice(6);
      return true;
    });

    const direction = sort.descending ? -1 : 1;
    return matching.sort((left, right) => {
      if (sort.column === "name") return left.name.localeCompare(right.name) * direction;
      if (sort.column === "load") {
        return ((left.trainingLoad ?? 0) - (right.trainingLoad ?? 0)) * direction;
      }
      if (sort.column === "used") {
        return (
          (left.usedByPlanIds.length + left.scheduledCount - right.usedByPlanIds.length - right.scheduledCount) *
          direction
        );
      }
      return (
        (metricFromVolume(left.volume, "duration") - metricFromVolume(right.volume, "duration")) * direction
      );
    });
  }, [workouts, query, scope, sort]);

  const active = workouts.find((workout) => workout.id === activeId);
  const shape = useMemo(
    () => (previewDocument ? workoutShape(previewDocument.draft.nodes) : []),
    [previewDocument]
  );
  /** Kinds actually drawn, in session order, so the legend never lists a ghost. */
  const shapeKinds = useMemo(
    () => STEP_KIND_ORDER.filter((kind) => shape.some((segment) => segment.kind === kind)),
    [shape]
  );

  useEffect(() => {
    if (!activeId) {
      setPreviewDocument(null);
      setPreviewMetrics(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewDocument(null);
    setPreviewMetrics(null);
    void api
      .getWorkoutForEdit({ kind: "library", programId: activeId }, "metric")
      .then(async (document) => {
        if (cancelled) return;
        setPreviewDocument(document);
        try {
          const metrics = await api.previewWorkoutEdit(
            document.ref,
            document.revision,
            document.draft,
            "metric"
          );
          if (!cancelled) setPreviewMetrics(metrics);
        } catch {
          // The complete step structure is still useful when the estimate is unavailable.
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, activeId, onError]);

  const updateMetadata = async (ids: string[], patch: Parameters<CorosLinkApi["updateWorkoutMetadata"]>[1]) => {
    setBusy("metadata");
    try {
      await api.updateWorkoutMetadata(ids, patch);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const schedule = async () => {
    if (!active || !scheduleDate) return;
    setBusy("schedule");
    try {
      const happenDay = scheduleDate.replace(/-/g, "");
      await api.scheduleLibraryWorkout(active.id, happenDay);
      await api.updateWorkoutMetadata([active.id], { lastUsedAt: new Date().toISOString() });
      onMessage(`Scheduled "${active.name}" on ${formatHappenDayLabel(happenDay)}.`);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    if (!active) return;
    const name = window.prompt("Name for the duplicate", `${active.name} Copy`);
    if (!name?.trim()) return;
    setBusy("duplicate");
    try {
      const result = await api.duplicateLibraryWorkout(
        active.id,
        name.trim(),
        duplicateSport ?? active.sportType
      );
      onMessage(`Created "${result.name}" in the workout library.`);
      await onRefresh();
      setActiveId(result.id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const applyTags = () => {
    const targets = selected.length ? selected : activeId ? [activeId] : [];
    if (!targets.length) return;
    const existing = workouts.find((workout) => targets.includes(workout.id))?.tags.join(", ") ?? "";
    const value = window.prompt("Tags, separated by commas", existing);
    if (value === null) return;
    void updateMetadata(targets, {
      tags: [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
    });
  };

  const deleteConfirmed = async () => {
    setBusy("delete");
    try {
      await api.deleteTrainingLibraryWorkouts({ programIds: pendingDelete, confirmed: true });
      onMessage(`Deleted ${pendingDelete.length} workout${pendingDelete.length === 1 ? "" : "s"} from COROS.`);
      setSelected([]);
      setPendingDelete([]);
      setActiveId(null);
      await onRefresh();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  /** Shared by the tile and the row so selection behaves identically. */
  const workoutMark = (id: string, name: string, isSelected: boolean) => (
    <button
      type="button"
      className="tl-mark"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`Select ${name}`}
      onClick={() =>
        setSelected((current) =>
          current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
        )
      }
    />
  );

  const toggleSort = (column: WorkoutColumn) =>
    setSort((current) =>
      current.column === column
        ? { column, descending: !current.descending }
        : { column, descending: column !== "name" }
    );

  const sortIndicator = (column: WorkoutColumn) =>
    sort.column === column ? (sort.descending ? " ↓" : " ↑") : "";

  const exportTargets = selected.length
    ? workouts.filter((workout) => selected.includes(workout.id))
    : active
      ? [active]
      : [];

  return (
    <div className="tl-panel tl-split">
      <section className="tl-catalog" aria-label={`${filtered.length} workouts`}>
        <div className="tl-filters">
          <label className="tl-search">
            <Search size={15} />
            <span className="sr-only">Search workouts</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workouts and tags"
            />
          </label>
          <div className="tl-chips" role="group" aria-label="Filter workouts">
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
              label="Sort workouts"
              value={sort.column}
              options={WORKOUT_SORT_OPTIONS}
              onChange={(value) => setSort({ column: value, descending: value !== "name" })}
            />
            <div className="tl-layout-switch" role="group" aria-label="Workout layout">
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
            <button type="button" className="primary-button" onClick={() => setCreating(true)}>
              <Plus size={14} /> New workout
            </button>
          </div>
        </div>

        {selected.length ? (
          <div className="tl-bulk" role="toolbar" aria-label="Actions for selected workouts">
            <strong>{selected.length} selected</strong>
            <button type="button" onClick={applyTags}>
              <Tag size={13} /> Tag
            </button>
            {collections.length ? (
              <SelectDropdown
                className="tl-quiet-select"
                label="Move selected workouts to a collection"
                value=""
                options={[
                  { value: "", label: "Move to collection" },
                  ...collections.map((collection) => ({ value: collection.id, label: collection.name }))
                ]}
                onChange={(value) => {
                  if (value) void updateMetadata(selected, { collectionId: value });
                }}
              />
            ) : null}
            <button type="button" onClick={() => downloadSelection(exportTargets)}>
              <Download size={13} /> Export
            </button>
            <button type="button" className="danger" onClick={() => setPendingDelete(selected)}>
              <Trash2 size={13} /> Delete
            </button>
            <button type="button" aria-label="Clear selection" onClick={() => setSelected([])}>
              <X size={13} />
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="tl-empty">
            <h3>No workouts match</h3>
            <p>Clear the search or choose another filter.</p>
          </div>
        ) : layout === "grid" ? (
          <ul className="tl-grid" role="list">
            {filtered.slice(0, visibleCount).map((workout) => {
              const isSelected = selected.includes(workout.id);
              const references = workout.usedByPlanIds.length + workout.scheduledCount;

              return (
                <li
                  className={`tl-card${activeId === workout.id ? " is-active" : ""}${
                    isSelected ? " is-selected" : ""
                  }`}
                  key={workout.id}
                >
                  {workoutMark(workout.id, workout.name, isSelected)}
                  <button
                    type="button"
                    className="tl-card-open"
                    onClick={() => setActiveId(workout.id)}
                  >
                    <span className="tl-card-top">
                      {workout.favorite ? (
                        <Heart size={11} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                      ) : null}
                      <em>{formatWorkoutSport(workoutSportFromType(workout.sportType) ?? "run")}</em>
                      {UNSETTLED_SYNC.has(workout.syncState) ? (
                        <i className="tl-flag">{workout.syncState}</i>
                      ) : null}
                    </span>
                    <span className="tl-card-name">{workout.name}</span>
                    <span className="tl-card-figs">
                      <span>
                        <b className={workout.volume ? "" : "is-nil"}>{workout.volume ?? "—"}</b>
                        <small>total</small>
                      </span>
                      <span>
                        <b className={workout.trainingLoad ? "" : "is-nil"}>
                          {workout.trainingLoad ? Math.round(workout.trainingLoad) : "—"}
                        </b>
                        <small>load</small>
                      </span>
                      <span>
                        <b className={references ? "" : "is-nil"}>{references || "—"}</b>
                        <small>used</small>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visibleCount < filtered.length ? (
              <li>
                <button
                  type="button"
                  className="tl-load-more"
                  onClick={() => setVisibleCount((value) => value + 60)}
                >
                  Show 60 more of {filtered.length}
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="tl-index">
            <div className="tl-index-head tl-workout-row">
              <span />
              <button
                type="button"
                className="tl-sortable"
                aria-pressed={sort.column === "name"}
                onClick={() => toggleSort("name")}
              >
                workout{sortIndicator("name")}
              </button>
              {WORKOUT_COLUMNS.map((column) => (
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
            </div>

            <ul role="list">
              {filtered.slice(0, visibleCount).map((workout) => {
                const isSelected = selected.includes(workout.id);
                const references = workout.usedByPlanIds.length + workout.scheduledCount;
                const details = [
                  formatWorkoutSport(workoutSportFromType(workout.sportType) ?? "run"),
                  ...workout.tags.slice(0, 2)
                ];

                return (
                  <li
                    className={`tl-workout-row tl-row${activeId === workout.id ? " is-active" : ""}${
                      isSelected ? " is-selected" : ""
                    }`}
                    key={workout.id}
                  >
                    {workoutMark(workout.id, workout.name, isSelected)}
                    <button type="button" className="tl-row-open" onClick={() => setActiveId(workout.id)}>
                      <span className="tl-row-name">
                        {workout.favorite ? (
                          <Heart size={12} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                        ) : null}
                        {workout.name}
                      </span>
                      <span className="tl-row-sub">
                        {details.map((detail, index) => (
                          <em key={index}>{detail}</em>
                        ))}
                        {UNSETTLED_SYNC.has(workout.syncState) ? (
                          <i className="tl-flag">{workout.syncState}</i>
                        ) : null}
                      </span>
                    </button>
                    <span className={`tl-fig${workout.volume ? "" : " is-nil"}`}>
                      {workout.volume ?? "—"}
                    </span>
                    <span className={`tl-fig${workout.trainingLoad ? "" : " is-nil"}`}>
                      {workout.trainingLoad ? Math.round(workout.trainingLoad) : "—"}
                    </span>
                    <span className={`tl-fig${references ? "" : " is-nil"}`}>{references || "—"}</span>
                  </li>
                );
              })}
            </ul>

            {visibleCount < filtered.length ? (
              <button
                type="button"
                className="tl-load-more"
                onClick={() => setVisibleCount((value) => value + 60)}
              >
                Show 60 more of {filtered.length}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <aside className="tl-reader" aria-live="polite">
        {!active ? (
          <div className="tl-empty">
            <h3>Pick a workout</h3>
            <p>Its full step structure and references appear here.</p>
          </div>
        ) : (
          <>
            <header>
              <p
                className="tl-eyebrow tl-reader-sport"
                data-sport={sportColorCategory(active.sportType)}
              >
                {formatWorkoutSport(workoutSportFromType(active.sportType) ?? "run")}
              </p>
              <h2>{active.name}</h2>
              <button
                type="button"
                className={`tl-reader-favorite${active.favorite ? " is-active" : ""}`}
                aria-label={active.favorite ? "Remove from favorites" : "Add to favorites"}
                onClick={() => void updateMetadata([active.id], { favorite: !active.favorite })}
              >
                <Heart size={16} fill={active.favorite ? "currentColor" : "none"} />
              </button>
            </header>

            <dl className="tl-reader-metrics">
              <div>
                <dt>Time</dt>
                <dd className={previewMetrics?.durationSeconds ? "" : "is-nil"}>
                  {previewMetrics?.durationSeconds
                    ? `${Math.round(previewMetrics.durationSeconds / 60)}m`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd className={previewMetrics?.distanceMeters || active.volume ? "" : "is-nil"}>
                  {previewMetrics?.distanceMeters
                    ? `${(previewMetrics.distanceMeters / 1000).toFixed(1)} km`
                    : (active.volume ?? "—")}
                </dd>
              </div>
              <div>
                <dt>Load</dt>
                <dd className={previewMetrics?.trainingLoad || active.trainingLoad ? "" : "is-nil"}>
                  {previewMetrics?.trainingLoad
                    ? Math.round(previewMetrics.trainingLoad)
                    : active.trainingLoad
                      ? Math.round(active.trainingLoad)
                      : "—"}
                </dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd className={previewDocument?.draft.nodes.length ? "" : "is-nil"}>
                  {previewDocument?.draft.nodes.length ?? "—"}
                </dd>
              </div>
            </dl>

            {shape.length ? (
              <figure className="tl-shape">
                <div role="img" aria-label={`Step structure of ${active.name}, ${shape.length} steps`}>
                  {shape.map((segment, index) => (
                    <span
                      key={index}
                      className={`is-${segment.kind}`}
                      style={{ width: `${segment.share}%` }}
                      title={segment.label}
                    />
                  ))}
                </div>
                <figcaption>
                  <span>Step structure, by share of the session</span>
                  {shapeKinds.length ? (
                    <span className="tl-shape-legend" aria-hidden="true">
                      {shapeKinds.map((kind) => (
                        <span key={kind}>
                          <em className={`is-${kind}`} />
                          {STEP_KIND_LABELS[kind]}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </figcaption>
              </figure>
            ) : null}

            {previewLoading ? (
              <p className="tl-reader-loading">
                <LoaderCircle className="is-spinning" size={16} /> Loading the full structure
              </p>
            ) : previewDocument ? (
              <ol className="tl-steps">
                {previewDocument.draft.nodes.map((node) => (
                  <li key={node.id} data-kind={nodeKind(node)}>
                    <span className="tl-step-head">
                      <b>{node.name}</b>
                      <small className={node.nodeType === "repeat" ? "is-rounds" : ""}>
                        {targetLabel(node)}
                      </small>
                    </span>
                    {node.nodeType === "repeat" ? (
                      <span className="tl-step-children">
                        {node.steps.map((step) => (
                          <em key={step.id}>
                            {step.name} <small>{targetLabel(step)}</small>
                          </em>
                        ))}
                      </span>
                    ) : null}
                    {!node.editable ? (
                      <i className="tl-flag" title={node.unsupportedReason}>
                        read only
                      </i>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            <p
              className={`tl-reader-references${
                active.usedByPlanIds.length || active.scheduledCount ? " is-linked" : ""
              }`}
            >
              {active.usedByPlanIds.length || active.scheduledCount ? (
                <>
                  <Link2 size={13} />
                  {`Used by ${active.usedByPlanIds.length} plan${
                    active.usedByPlanIds.length === 1 ? "" : "s"
                  } and scheduled ${active.scheduledCount} time${active.scheduledCount === 1 ? "" : "s"}.`}
                </>
              ) : (
                <>
                  <Unlink size={13} />
                  Not referenced by a plan or a calendar day.
                </>
              )}
            </p>

            <form
              className="tl-reader-schedule"
              onSubmit={(event) => {
                event.preventDefault();
                void schedule();
              }}
            >
              <label>
                <span>Put it on the calendar</span>
                <input
                  type="date"
                  value={scheduleDate}
                  min={tomorrow()}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </label>
              <button type="submit" className="primary-button" disabled={!scheduleDate || busy === "schedule"}>
                <CalendarPlus size={14} /> {busy === "schedule" ? "Scheduling" : "Schedule"}
              </button>
            </form>

            <div className="tl-reader-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!previewDocument?.canEdit}
                onClick={() => setEditId(active.id)}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={busy === "duplicate"}
                onClick={() => void duplicate()}
              >
                <Copy size={14} /> Duplicate as
              </button>
              <SelectDropdown
                className="tl-quiet-select"
                label="Sport for the duplicate"
                value={String(duplicateSport ?? active.sportType ?? 1)}
                options={Array.from({ length: 9 }, (_, index) => ({
                  value: String(index + 1),
                  label: formatWorkoutSport(workoutSportFromType(index + 1) ?? "run")
                }))}
                onChange={(value) => setDuplicateSport(Number(value))}
              />
              <button type="button" className="ghost-button" onClick={applyTags}>
                <Tag size={14} /> Tags
              </button>
              <button
                type="button"
                className="ghost-button danger"
                onClick={() => setPendingDelete([active.id])}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </>
        )}
      </aside>

      {pendingDelete.length ? (
        <div className="tl-dialog-backdrop">
          <section
            className="tl-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="workout-delete-title"
          >
            <h2 id="workout-delete-title">
              Delete {pendingDelete.length} workout{pendingDelete.length === 1 ? "" : "s"} from COROS?
            </h2>
            <p>
              This cannot be undone. Calendar copies stay in place, and plan references will remain but
              point at nothing.
            </p>
            <ul>
              {workouts
                .filter((workout) => pendingDelete.includes(workout.id))
                .map((workout) => (
                  <li key={workout.id}>
                    <strong>{workout.name}</strong>
                    <span>
                      {workout.usedByPlanIds.length} plan references · {workout.scheduledCount} scheduled
                    </span>
                  </li>
                ))}
            </ul>
            <footer>
              <button type="button" className="ghost-button" onClick={() => setPendingDelete([])}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger"
                disabled={busy === "delete"}
                onClick={() => void deleteConfirmed()}
              >
                {busy === "delete" ? "Deleting" : "Delete"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {editId ? (
        <WorkoutEditorModal
          api={api}
          editRef={{ kind: "library", programId: editId }}
          onClose={() => setEditId(null)}
          onSaved={(result) => {
            setEditId(null);
            onMessage(result.verified ? "Workout saved and verified." : (result.warning ?? "Workout saved."));
            void onRefresh();
          }}
          onError={(message) => message && onError(message)}
        />
      ) : null}

      {creating ? (
        <AddWorkoutModal
          api={api}
          dateKey={tomorrow().replace(/-/g, "")}
          sportTypes={[]}
          libraryOnly
          onClose={() => setCreating(false)}
          onScheduled={(message) => {
            setCreating(false);
            onMessage(message);
            void onRefresh();
          }}
          onError={(message) => message && onError(message)}
          onEditLibrary={(programId) => {
            setCreating(false);
            setEditId(programId);
          }}
        />
      ) : null}
    </div>
  );
}
