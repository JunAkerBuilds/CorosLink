import {
  CalendarPlus,
  Copy,
  Download,
  Heart,
  History,
  Layers,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  Route,
  Search,
  Tag,
  Trash2,
  Unlink,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RunWorkoutEditorNode,
  TrainingCollection,
  TrainingLibraryWorkout,
  UnitSystem,
  WorkoutEditPreview,
  WorkoutEditorDocument
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel } from "../training/formatters";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { workoutSportFromType } from "../../electron/trainingPlanDomain";
import { SportBadge, sportAccentStyle, sportChipStyle, sportTheme } from "./sportTheme";
import { SelectDropdown } from "../components/SelectDropdown";
import { WorkoutEditorModal } from "../calendar/WorkoutEditorModal";
import { AddWorkoutModal } from "../calendar/AddWorkoutModal";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue, formatElevationValue } from "../units/units";

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
/*
 * A tile's shape needs the step list, and COROS only ships that on
 * /training/program/detail — one request per workout. So tiles ask for it only
 * once they scroll into view, a few at a time, and never twice for the same
 * workout. Browsing the library costs a handful of requests, not sixty.
 */
const SHAPE_BATCH = 3;
/** Draws the comb a beat before the tile lands, so it is never seen filling in. */
const SHAPE_PREFETCH_MARGIN = "160px";
const DISTANCE_VOLUME_PATTERN = /([\d.]+)\s*(km|mi|yd|m)\b/i;

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
  const distance = Number(value.match(DISTANCE_VOLUME_PATTERN)?.[1] ?? 0);
  if (value.includes(" km")) return distance * 1000;
  if (value.includes(" mi")) return distance * 1609.344;
  if (value.includes(" yd")) return distance * 0.9144;
  return distance;
}

function formatWorkoutVolume(
  volume: string | undefined,
  unitSystem: UnitSystem,
  swim = false
): string | undefined {
  if (!volume || !DISTANCE_VOLUME_PATTERN.test(volume)) return volume;
  const meters = metricFromVolume(volume, "distance");
  if (unitSystem === "metric" && !swim && meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return formatDistanceValue(meters, unitSystem, {
    swim,
    ...(swim ? { digits: 0 } : {})
  });
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** How long ago a workout was last scheduled, short enough for a tile footer. */
function sinceLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).valueOf();
  if (Number.isNaN(then)) return null;
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** COROS reports volume as a distance or a set count; the icon says which. */
function isSetVolume(volume: string | undefined): boolean {
  return /set/i.test(volume ?? "");
}

function targetLabel(
  node: RunWorkoutEditorNode,
  unitSystem: UnitSystem,
  swim = false
): string {
  if (node.nodeType === "repeat") return `${node.repeat} rounds`;
  const target = node.target;
  if (target.type === "time") return `${Math.round(target.seconds / 60)} min`;
  if (target.type === "distance") {
    if (unitSystem === "metric" && !swim && target.meters < 1000) {
      return `${Math.round(target.meters)} m`;
    }
    return formatDistanceValue(target.meters, unitSystem, {
      swim,
      ...(swim ? { digits: 0 } : {})
    });
  }
  if (target.type === "load") return `${target.load} load`;
  if (target.type === "reps") return `${target.count} reps`;
  if (target.type === "routes") return `${target.count} routes`;
  if (target.type === "elevationGain") return `${formatElevationValue(target.meters, unitSystem)} gain`;
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
function workoutShape(
  nodes: RunWorkoutEditorNode[],
  unitSystem: UnitSystem,
  swim = false
): ShapeSegment[] {
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
    segments.push({
      kind: node.kind,
      share: Math.max(weight, 1),
      label: `${node.name} · ${targetLabel(node, unitSystem, swim)}`
    });
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

/*
 * The calendar's structure bar sizes its segments by flex-grow and floors the
 * tiny ones, so a 20-second recovery between reps never collapses to nothing.
 * The tile borrows the rule outright — the two bars should read as one idea.
 */
function combGrow(segments: ShapeSegment[]): number[] {
  const largest = Math.max(0, ...segments.map((segment) => segment.share));
  if (largest <= 0) return segments.map(() => 1);
  const floor = largest * 0.035;
  return segments.map((segment) => Math.max(segment.share, floor));
}

/*
 * Past this many steps the gapped pills stop fitting a tile's width, so the
 * comb closes up into a striped band instead of overflowing. A 20 × 30s set
 * genuinely looks like that.
 */
const COMB_DENSE_AT = 30;

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
  const { unitSystem } = useUnitSystem();
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
  /** Step structure per workout id; an empty array means "asked, none to draw". */
  const [shapes, setShapes] = useState<Record<string, ShapeSegment[]>>({});
  const [shapeQueue, setShapeQueue] = useState<string[]>([]);
  const requestedShapes = useRef(new Set<string>());
  const shapeBusy = useRef(false);
  const shapeObserver = useRef<IntersectionObserver | null>(null);

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

  /*
   * The tile meter is self-referential: a bar reads as a share of the heaviest
   * workout in the library, so it stays honest without asserting thresholds
   * COROS never publishes. The whole library, not the filtered set, so the bars
   * do not resize under the reader when a filter changes.
   */
  const heaviestLoad = useMemo(
    () => workouts.reduce((most, workout) => Math.max(most, workout.trainingLoad ?? 0), 0),
    [workouts]
  );

  /*
   * The observer is built on the first tile that mounts rather than in an
   * effect, so the tiles already on screen at first paint are watched too.
   */
  const observeTile = useCallback((node: HTMLLIElement | null) => {
    if (!node) return;
    if (!shapeObserver.current) {
      shapeObserver.current = new IntersectionObserver(
        (entries, observer) => {
          const seen: string[] = [];
          for (const entry of entries) {
            const id = entry.isIntersecting ? (entry.target as HTMLElement).dataset.workoutId : null;
            if (!id || requestedShapes.current.has(id)) continue;
            requestedShapes.current.add(id);
            seen.push(id);
            observer.unobserve(entry.target);
          }
          if (seen.length) setShapeQueue((current) => [...current, ...seen]);
        },
        { rootMargin: SHAPE_PREFETCH_MARGIN }
      );
    }
    shapeObserver.current.observe(node);
  }, []);

  useEffect(
    () => () => {
      shapeObserver.current?.disconnect();
      shapeObserver.current = null;
    },
    []
  );

  /* One batch in flight at a time; finishing it trims the queue and re-runs. */
  useEffect(() => {
    if (shapeBusy.current || !shapeQueue.length) return;
    shapeBusy.current = true;
    const batch = shapeQueue.slice(0, SHAPE_BATCH);
    let cancelled = false;

    void Promise.all(
      batch.map(async (id) => {
        let segments: ShapeSegment[] = [];
        try {
          const document = await api.getWorkoutForEdit({ kind: "library", programId: id }, unitSystem);
          segments = workoutShape(document.draft.nodes, unitSystem, document.draft.sport === "swim");
        } catch {
          /* A tile that cannot draw its shape falls back to its load bar. */
        }
        if (!cancelled) setShapes((current) => ({ ...current, [id]: segments }));
      })
    ).finally(() => {
      shapeBusy.current = false;
      if (!cancelled) setShapeQueue((current) => current.slice(batch.length));
    });

    return () => {
      cancelled = true;
    };
  }, [api, shapeQueue, unitSystem]);

  /*
   * An edit rewrites one workout's steps. Queue that id directly rather than
   * waiting on the observer — the tile is already on screen and will not cross
   * the viewport edge again to announce itself.
   */
  const redrawShape = useCallback((id: string) => {
    setShapes((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    requestedShapes.current.add(id);
    setShapeQueue((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  const active = workouts.find((workout) => workout.id === activeId);
  const shape = useMemo(
    () => previewDocument
      ? workoutShape(previewDocument.draft.nodes, unitSystem, previewDocument.draft.sport === "swim")
      : [],
    [previewDocument, unitSystem]
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
      .getWorkoutForEdit({ kind: "library", programId: activeId }, unitSystem)
      .then(async (document) => {
        if (cancelled) return;
        setPreviewDocument(document);
        /* The reader just paid for this workout's steps; its tile draws for free. */
        requestedShapes.current.add(activeId);
        setShapes((current) => ({
          ...current,
          [activeId]: workoutShape(document.draft.nodes, unitSystem, document.draft.sport === "swim")
        }));
        try {
          const metrics = await api.previewWorkoutEdit(
            document.ref,
            document.revision,
            document.draft,
            unitSystem
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
  }, [api, activeId, onError, unitSystem]);

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

  /*
   * Reader figures resolve once, so a cell the strip has to ellipsize can
   * still carry its full string on the title attribute.
   */
  const readerTime = previewMetrics?.durationSeconds
    ? `${Math.round(previewMetrics.durationSeconds / 60)}m`
    : null;
  const activeSport = workoutSportFromType(active?.sportType);
  const readerDistance = previewMetrics?.distanceMeters
    ? formatDistanceValue(previewMetrics.distanceMeters, unitSystem, {
        swim: activeSport === "swim",
        ...(activeSport === "swim" ? { digits: 0 } : {})
      })
    : (formatWorkoutVolume(active?.volume, unitSystem, activeSport === "swim") ?? null);
  const readerLoadSource = previewMetrics?.trainingLoad || active?.trainingLoad;
  const readerLoad = readerLoadSource ? Math.round(readerLoadSource) : null;
  const readerSteps = previewDocument?.draft.nodes.length ?? null;
  const ActiveSportIcon = sportTheme(activeSport).icon;

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
              const sport = workoutSportFromType(workout.sportType);
              const SportGlyph = sportTheme(sport).icon;
              const VolumeIcon = isSetVolume(workout.volume) ? Layers : Route;
              const load = workout.trainingLoad ? Math.round(workout.trainingLoad) : null;
              /* A sliver of fill so the lightest session still draws something. */
              const loadShare = load && heaviestLoad ? Math.max(3, (load / heaviestLoad) * 100) : 0;
              const lastUsed = sinceLabel(workout.lastUsedAt);
              const tags = workout.tags.slice(0, 3);
              const tileShape = shapes[workout.id];
              const hasShape = Boolean(tileShape?.length);

              return (
                <li
                  className={`tl-card${activeId === workout.id ? " is-active" : ""}${
                    isSelected ? " is-selected" : ""
                  }`}
                  key={workout.id}
                  ref={observeTile}
                  data-workout-id={workout.id}
                  data-accent={sport ?? "other"}
                  style={sportAccentStyle(sport)}
                >
                  {workoutMark(workout.id, workout.name, isSelected)}
                  <button
                    type="button"
                    className="tl-card-open"
                    onClick={() => setActiveId(workout.id)}
                  >
                    <SportGlyph className="tl-wk-glyph" size={132} strokeWidth={1} aria-hidden="true" />
                    <span className="tl-card-top">
                      {workout.favorite ? (
                        <Heart size={11} fill="currentColor" strokeWidth={0} aria-label="Favorite" />
                      ) : null}
                      <SportBadge sport={sport ?? "run"} />
                      {UNSETTLED_SYNC.has(workout.syncState) ? (
                        <i className="tl-flag">{workout.syncState}</i>
                      ) : null}
                    </span>
                    <span className="tl-card-name">{workout.name}</span>
                    {tags.length ? (
                      <span className="tl-wk-tags">
                        {tags.map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                        {workout.tags.length > tags.length ? (
                          <em className="is-more">+{workout.tags.length - tags.length}</em>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="tl-wk-meter">
                      <span className="tl-wk-meter-head">
                        <small>{hasShape ? "Session shape" : "Training load"}</small>
                        <span className="tl-wk-load">
                          <b className={load ? "" : "is-nil"}>{load ?? "—"}</b>
                          <em>load</em>
                        </span>
                      </span>
                      {hasShape ? (
                        <span
                          className="tl-wk-shape"
                          data-dense={tileShape.length > COMB_DENSE_AT ? "true" : undefined}
                          role="img"
                          aria-label={`Workout structure: ${tileShape
                            .map((segment) => segment.label)
                            .join(", ")}`}
                        >
                          {combGrow(tileShape).map((grow, index) => (
                            <i
                              key={index}
                              className={`is-${tileShape[index].kind}`}
                              style={{ flexGrow: grow }}
                              title={tileShape[index].label}
                            />
                          ))}
                        </span>
                      ) : (
                        <span
                          className={`tl-wk-track${load ? "" : " is-nil"}`}
                          aria-hidden="true"
                          title={
                            load
                              ? `${load} training load — ${Math.round((load / heaviestLoad) * 100)}% of the heaviest workout in your library`
                              : "COROS has not reported a training load for this workout"
                          }
                        >
                          {load ? <i style={{ width: `${loadShare}%` }} /> : null}
                        </span>
                      )}
                    </span>
                    <span className="tl-wk-foot">
                      <span>
                        <VolumeIcon size={11} aria-hidden="true" />
                        <b>{formatWorkoutVolume(workout.volume, unitSystem, workoutSportFromType(workout.sportType) === "swim") ?? "No volume"}</b>
                      </span>
                      <span>
                        <Link2 size={11} aria-hidden="true" />
                        {references ? (
                          <>
                            <b>{references}</b> {references === 1 ? "use" : "uses"}
                          </>
                        ) : (
                          "Unused"
                        )}
                      </span>
                      {lastUsed ? (
                        <span>
                          <History size={11} aria-hidden="true" />
                          {lastUsed}
                        </span>
                      ) : null}
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
                const sport = workoutSportFromType(workout.sportType);
                const details = workout.tags.slice(0, 2);

                return (
                  <li
                    className={`tl-workout-row tl-row${activeId === workout.id ? " is-active" : ""}${
                      isSelected ? " is-selected" : ""
                    }`}
                    key={workout.id}
                    data-accent={sport ?? "other"}
                    style={sportAccentStyle(sport)}
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
                        <SportBadge sport={sport ?? "run"} compact />
                        {details.map((detail, index) => (
                          <em key={index}>{detail}</em>
                        ))}
                        {UNSETTLED_SYNC.has(workout.syncState) ? (
                          <i className="tl-flag">{workout.syncState}</i>
                        ) : null}
                      </span>
                    </button>
                    <span className={`tl-fig${workout.volume ? "" : " is-nil"}`}>
                      {formatWorkoutVolume(workout.volume, unitSystem, workoutSportFromType(workout.sportType) === "swim") ?? "—"}
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
            <div className="tl-reader-scroll">
              <header>
                <p className="tl-eyebrow tl-reader-sport has-icon" style={sportChipStyle(activeSport)}>
                  <ActiveSportIcon size={12} strokeWidth={2.2} aria-hidden="true" />
                  {formatWorkoutSport(activeSport ?? "run")}
                </p>
                <h2>{active.name}</h2>
                {active.tags.length ? (
                  <ul className="tl-reader-tags" aria-label="Workout tags">
                    {active.tags.slice(0, 8).map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                    {active.tags.length > 8 ? <li>+{active.tags.length - 8} more</li> : null}
                  </ul>
                ) : null}
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
                <dd className={readerTime ? "" : "is-nil"} title={readerTime ?? undefined}>
                  {readerTime ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd className={readerDistance ? "" : "is-nil"} title={readerDistance ?? undefined}>
                  {readerDistance ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Load</dt>
                <dd className={readerLoad ? "" : "is-nil"} title={readerLoad ? String(readerLoad) : undefined}>
                  {readerLoad ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Steps</dt>
                <dd className={readerSteps ? "" : "is-nil"}>{readerSteps ?? "—"}</dd>
              </div>
            </dl>

            {shape.length ? (
              <figure className="tl-shape" style={sportAccentStyle(activeSport)}>
                <div
                  role="img"
                  data-dense={shape.length > COMB_DENSE_AT ? "true" : undefined}
                  aria-label={`Step structure of ${active.name}, ${shape.length} steps`}
                >
                  {combGrow(shape).map((grow, index) => (
                    <span
                      key={index}
                      className={`is-${shape[index].kind}`}
                      style={{ flexGrow: grow }}
                      title={shape[index].label}
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
              <div className="tl-steps-block">
                <p className="tl-steps-label">
                  Session steps <span>{previewDocument.draft.nodes.length}</span>
                </p>
                <ol className="tl-steps">
                  {previewDocument.draft.nodes.map((node) => (
                    <li key={node.id} data-kind={nodeKind(node)}>
                      <span className="tl-step-head">
                        <b>{node.name}</b>
                        <small className={node.nodeType === "repeat" ? "is-rounds" : ""}>
                          {targetLabel(node, unitSystem, previewDocument?.draft.sport === "swim")}
                        </small>
                      </span>
                      {node.nodeType === "repeat" ? (
                        <span className="tl-step-children">
                          {node.steps.map((step) => (
                            <em key={step.id}>
                              {step.name} <small>{targetLabel(step, unitSystem, previewDocument?.draft.sport === "swim")}</small>
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
              </div>
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
            </div>

            <footer className="tl-reader-dock">
              <form
                className="tl-reader-schedule"
                onSubmit={(event) => {
                  event.preventDefault();
                  void schedule();
                }}
              >
                <div className="tl-reader-schedule-heading">
                  <span className="tl-reader-schedule-icon" aria-hidden="true">
                    <CalendarPlus size={15} />
                  </span>
                  <span>
                    <strong>Schedule workout</strong>
                    <small>Add it to your COROS calendar</small>
                  </span>
                </div>
                <div className="tl-reader-schedule-controls">
                  <label>
                    <span className="sr-only">Schedule date</span>
                    <input
                      type="date"
                      value={scheduleDate}
                      min={tomorrow()}
                      onChange={(event) => setScheduleDate(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!scheduleDate || busy === "schedule"}
                  >
                    {busy === "schedule" ? "Scheduling" : "Schedule"}
                  </button>
                </div>
              </form>

              <div className="tl-reader-actions">
                <div className="tl-reader-actions-main">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!previewDocument?.canEdit}
                    onClick={() => setEditId(active.id)}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <div className="tl-reader-duplicate">
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
                  </div>
                </div>
                <div className="tl-reader-actions-meta">
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
              </div>
            </footer>
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
            redrawShape(editId);
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
