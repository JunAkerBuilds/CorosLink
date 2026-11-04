import { formatIntensityType, formatWorkoutSport } from "../calendar/workoutLabels";
import { formatDate, getLocale, t, useLanguage } from "../i18n/training";
import { keyToIso, libraryWeek } from "./libraryWeek";
import { useLocalOnlyView } from "../privacy/localOnlyView";
import {
  CalendarPlus,
  Clock,
  Copy,
  Download,
  Flame,
  Heart,
  Layers,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  Route,
  Search,
  Tag,
  Trash2,
  Unlink,
  X,
  Watch
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RunWorkoutEditorNode,
  RunWorkoutEditorStep,
  TrainingCollection,
  TrainingHubScheduledWorkoutEntry,
  TrainingLibraryWorkout,
  UnitSystem,
  WorkoutEditPreview,
  WorkoutEditorDocument,
  WorkoutSport
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel } from "../training/formatters";

import { workoutSportFromType } from "../../electron/trainingPlanDomain";
import { SportBadge, sportAccentStyle, sportChipStyle, sportTheme } from "./sportTheme";
import { PROFILE_ZONE_LABELS, readableVolume, resolveWorkoutSport, sessionKind, sessionProfile, stepZone, type SessionProfile } from "./sessionProfile";
import { SessionProfileBars, profileSummary } from "./SessionProfileBars";
import { SelectDropdown } from "../components/SelectDropdown";
import { WorkoutEditorModal } from "../calendar/WorkoutEditorModal";
import { AddWorkoutModal } from "../calendar/AddWorkoutModal";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue, formatElevationValue } from "../units/units";
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";

interface WorkoutWorkspaceProps {
  api: CorosLinkApi;
  workouts: TrainingLibraryWorkout[];
  collections: TrainingCollection[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  /** Bumped by the masthead's New workout button; each change opens the builder. */
  createSignal?: number;
  /** "Up next" in the masthead opens this workout; n changes on every click. */
  focusRequest?: { id: string; n: number } | null;
  /** Calendar entries for this week and the next: dots on the day strip. */
  schedule?: TrainingHubScheduledWorkoutEntry[];
  onScheduleChanged?: () => Promise<void> | void;
  /** Plan names by id, so the reader can say which plan uses a workout. */
  planNames?: ReadonlyMap<string, string>;
}

type WorkoutColumn = "name" | "total" | "load" | "used" | "recent";

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
  { value: "recent", label: "Recently used" },
  { value: "name", label: "Name" },
  { value: "total", label: "Duration" },
  { value: "load", label: "Training load" },
  { value: "used", label: "Most used" }
];

const WORKOUT_SCOPE_PREFERENCE = defineSelectionPreference<string>({
  key: "trainingLibrary.workouts.scope",
  defaultValue: "all",
  validate: (value): value is string =>
    typeof value === "string" &&
    (["all", "favorite", "unsettled"].includes(value) || /^sport:[a-zA-Z]+$/.test(value))
});

const WORKOUT_SORT_PREFERENCE = defineSelectionPreference<WorkoutSort>({
  key: "trainingLibrary.workouts.sort",
  defaultValue: { column: "recent", descending: true },
  validate: (value): value is WorkoutSort => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
      ["name", "total", "load", "used", "recent"].includes(String(candidate.column)) &&
      typeof candidate.descending === "boolean"
    );
  }
});

const WORKOUT_LAYOUT_PREFERENCE =
  defineSelectionPreference<"grid" | "list">({
    key: "trainingLibrary.workouts.layout",
    defaultValue: "grid",
    validate: selectionIsOneOf(["grid", "list"])
  });

const UNSETTLED_SYNC = new Set(["pending", "conflicted", "failed", "stale"]);
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
  if (!volume || !DISTANCE_VOLUME_PATTERN.test(volume)) return readableVolume(volume);
  const meters = metricFromVolume(volume, "distance");
  if (unitSystem === "metric" && !swim && meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return formatDistanceValue(meters, unitSystem, {
    swim,
    ...(swim ? { digits: 0 } : {})
  });
}

const STEP_KIND_NAMES: Record<string, string> = {
  warmup: "Warm-up",
  training: "Work",
  rest: "Recovery",
  cooldown: "Cool-down",
  sendOff: "Send-off"
};

/** COROS leaves many steps unnamed; the kind is a fair title for those. */
function stepName(step: RunWorkoutEditorStep): string {
  return step.name.trim() || t(STEP_KIND_NAMES[step.kind] ?? "Step");
}

function paceText(secondsPerKm: number, unit: "km" | "mi"): string {
  const perUnit = unit === "mi" ? secondsPerKm * 1.609344 : secondsPerKm;
  return `${Math.floor(perUnit / 60)}:${String(Math.round(perUnit % 60)).padStart(2, "0")}`;
}

/** The line under a step's name: its effort target, and sets and rest for an exercise. */
function stepDetail(step: RunWorkoutEditorStep): string {
  const intensity = step.intensity;
  const parts: string[] = [];
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    parts.push(`${paceText(intensity.lowSecondsPerKm, intensity.displayUnit)}–${paceText(intensity.highSecondsPerKm, intensity.displayUnit)} /${intensity.displayUnit}`);
  } else if (intensity.type === "heartRate") {
    parts.push(`${intensity.lowBpm}–${intensity.highBpm} bpm`);
  } else if (intensity.type === "power" && "lowWatts" in intensity && intensity.lowWatts !== undefined) {
    parts.push(`${intensity.lowWatts}–${intensity.highWatts} W`);
  } else if ((intensity.type === "ftpPercent" || intensity.type === "heartRatePercent" || intensity.type === "thresholdPacePercent") && !intensity.preset && intensity.lowPercent !== undefined) {
    const basis = intensity.type === "ftpPercent" ? "FTP" : intensity.type === "heartRatePercent" ? t("HR") : t("threshold pace");
    parts.push(`${intensity.lowPercent}–${intensity.highPercent}% ${basis}`);
  } else if (intensity.type === "rpe") {
    parts.push(`RPE ${intensity.value}`);
  } else if (intensity.type === "weight" && intensity.mode === "weight") {
    parts.push(`${intensity.value} ${intensity.unit}`);
  } else if (intensity.type !== "none" && intensity.type !== "weight") {
    parts.push(formatIntensityType(intensity.type === "lthrPercent" ? "heartRatePercent" : intensity.type));
  }
  if (step.sets && step.sets > 1) parts.push(t("{{value1}} sets", { value1: String(step.sets) }));
  if (step.restValue) parts.push(t("{{value1}} rest", { value1: step.restValue >= 60 ? `${Math.round(step.restValue / 60 * 10) / 10} min` : `${step.restValue} s` }));
  return parts.join(" · ");
}

/** "Repeat block · 6 min each" when every step in it is timed. */
function repeatDetail(node: Extract<RunWorkoutEditorNode, { nodeType: "repeat" }>): string {
  const seconds = node.steps.reduce((sum, step) => sum + (step.target.type === "time" ? step.target.seconds : Number.NaN), 0);
  return Number.isFinite(seconds) && seconds > 0
    ? t("Repeat block · {{value1}} each", { value1: formatMinutes(seconds / 60) })
    : t("Repeat block");
}

/** "58 min", "1 h 05". */
function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  return `${Math.floor(rounded / 60)} h ${String(rounded % 60).padStart(2, "0")}`;
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
  if (days === 0) return t("today");
  if (days === 1) return t("yesterday");
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return t("{{value1}}mo ago", { value1: String(Math.round(days / 30)) });
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
  if (target.type === "load") return t("{{value1}} load", { value1: String(target.load) });
  if (target.type === "reps") return `${target.count} reps`;
  if (target.type === "routes") return `${target.count} routes`;
  if (target.type === "elevationGain") return `${formatElevationValue(target.meters, unitSystem)} gain`;
  if (target.type === "hrRecovery") return t("{{value1}} bpm recovery", { value1: String(target.bpm) });
  return t("Open");
}


const EMPTY_PROFILE: SessionProfile = { segments: [], zones: [], totalWeight: 0, timed: false };

function profileOf(document: WorkoutEditorDocument, unitSystem: UnitSystem): SessionProfile {
  const swim = document.draft.sport === "swim";
  return sessionProfile(document.draft.nodes, document.context, (step) => `${step.name} · ${targetLabel(step, unitSystem, swim)}`);
}

/** "11.2 km" with the unit set smaller, so four figures fit one row. */
function Figure({ value }: { value: string }) {
  const match = value.match(/^([\d.,:]+(?:\s*h\s*\d+)?)\s*(\D.*)?$/);
  if (!match || !match[2]) return <>{value}</>;
  return <>{match[1]}<small className="tl-kpi-unit">{match[2]}</small></>;
}

/** Training load as five rising pips, scaled to the heaviest workout in the library. */
function LoadPips({ load, heaviest }: { load: number | null; heaviest: number }) {
  const filled = load && heaviest ? Math.max(1, Math.ceil((load / heaviest) * 5)) : 0;
  return (
    <span className="tl-pips" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <i key={index} className={index < filled ? "is-on" : ""} />
      ))}
    </span>
  );
}

/** The next seven days, tomorrow first: the reader's quick-schedule strip. */
/** Tomorrow when it falls this week, otherwise today (on a Sunday the week has no tomorrow). */
function defaultScheduleDate(): string {
  const week = libraryWeek();
  const today = week.findIndex((day) => day.isToday);
  return (week[today + 1] ?? week[today] ?? week[6]!).iso;
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
  onError,
  createSignal = 0,
  focusRequest,
  schedule: scheduledEntries = [],
  onScheduleChanged,
  planNames
}: WorkoutWorkspaceProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const { unitSystem } = useUnitSystem();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useSelectionPreference(
    WORKOUT_SCOPE_PREFERENCE
  );
  const [sort, setSort] = useSelectionPreference(WORKOUT_SORT_PREFERENCE);
  const [layout, setLayout] = useSelectionPreference(
    WORKOUT_LAYOUT_PREFERENCE
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(workouts[0]?.id ?? null);
  const [visibleCount, setVisibleCount] = useState(60);
  const [previewDocument, setPreviewDocument] = useState<WorkoutEditorDocument | null>(null);
  const [previewMetrics, setPreviewMetrics] = useState<WorkoutEditPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState(defaultScheduleDate);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [duplicateSport, setDuplicateSport] = useState<number | undefined>();
  /** The reader's copy button opens a small "Duplicate as" sport menu. */
  const [duplicateMenuOpen, setDuplicateMenuOpen] = useState(false);
  const duplicateMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!duplicateMenuOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !duplicateMenuRef.current?.contains(event.target as Node)) {
        setDuplicateMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [duplicateMenuOpen]);
  const [creating, setCreating] = useState(false);
  const otherDateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (createSignal) setCreating(true);
  }, [createSignal]);
  useEffect(() => {
    if (focusRequest) setActiveId(focusRequest.id);
  }, [focusRequest]);
  /** Sports already planned on each day, for the reader's day strip. */
  const plannedDays = useMemo(() => {
    const next: Record<string, WorkoutSport[]> = {};
    for (const entry of scheduledEntries) {
      (next[keyToIso(entry.happenDay)] ??= []).push(resolveWorkoutSport(entry.sportType) ?? "run");
    }
    return next;
  }, [scheduledEntries]);
  /** Step structure per workout id; an empty array means "asked, none to draw". */
  const [shapes, setShapes] = useState<Record<string, SessionProfile>>({});
  const [shapeQueue, setShapeQueue] = useState<string[]>([]);
  const requestedShapes = useRef(new Set<string>());
  const shapeBusy = useRef(false);
  const shapeObserver = useRef<IntersectionObserver | null>(null);

  const scopes = useMemo(() => {
    const options: Array<{ id: string; label: string; count: number; sport?: WorkoutSport }> = [
      { id: "all", label: "All", count: workouts.length }
    ];
    const bySport = new Map<WorkoutSport, number>();
    for (const workout of workouts) {
      const sport = resolveWorkoutSport(workout.sportType);
      if (sport) bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
    }
    /* Busiest sport first, so the pills read as the library's mix. */
    for (const [sport, count] of [...bySport].sort((left, right) => right[1] - left[1])) {
      options.push({ id: `sport:${sport}`, label: formatWorkoutSport(sport), count, sport });
    }
    if (workouts.some((workout) => UNSETTLED_SYNC.has(workout.syncState))) {
      options.push({
        id: "unsettled",
        label: "Needs attention",
        count: workouts.filter((workout) => UNSETTLED_SYNC.has(workout.syncState)).length
      });
    }
    return options;
  }, [workouts, getLocale()]);
  const favoriteCount = workouts.filter((workout) => workout.favorite).length;

  const scopeAvailable = scope === "favorite" ? favoriteCount > 0 : scopes.some((option) => option.id === scope);
  useEffect(() => {
    if (!scopeAvailable) setScope("all");
  }, [scopeAvailable, setScope]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = workouts.filter((workout) => {
      if (needle && !`${workout.name} ${workout.tags.join(" ")}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (scope === "favorite") return workout.favorite;
      if (scope === "unsettled") return UNSETTLED_SYNC.has(workout.syncState);
      if (scope.startsWith("sport:")) return resolveWorkoutSport(workout.sportType) === scope.slice(6);
      return true;
    });

    const direction = sort.descending ? -1 : 1;
    return matching.sort((left, right) => {
      if (sort.column === "name") return left.name.localeCompare(right.name) * direction;
      if (sort.column === "load") {
        return ((left.trainingLoad ?? 0) - (right.trainingLoad ?? 0)) * direction;
      }
      if (sort.column === "recent") {
        /* Never-used workouts sink to the end, then read alphabetically. */
        const leftTime = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
        const rightTime = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
        return (rightTime - leftTime) || left.name.localeCompare(right.name);
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
  }, [workouts, query, scope, sort, getLocale()]);

  /*
   * The tile meter is self-referential: a bar reads as a share of the heaviest
   * workout in the library, so it stays honest without asserting thresholds
   * COROS never publishes. The whole library, not the filtered set, so the bars
   * do not resize under the reader when a filter changes.
   */
  const heaviestLoad = useMemo(
    () => workouts.reduce((most, workout) => Math.max(most, workout.trainingLoad ?? 0), 0),
    [workouts, getLocale()]
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
        let profile: SessionProfile = EMPTY_PROFILE;
        try {
          const document = await api.getWorkoutForEdit({ kind: "library", programId: id }, unitSystem);
          profile = profileOf(document, unitSystem);
        } catch {
          /* A tile that cannot draw its shape falls back to its load bar. */
        }
        if (!cancelled) setShapes((current) => ({ ...current, [id]: profile }));
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
  const profile = useMemo(
    () => (previewDocument ? profileOf(previewDocument, unitSystem) : EMPTY_PROFILE),
    [previewDocument, unitSystem, getLocale()]
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
          [activeId]: profileOf(document, unitSystem)
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
      void onScheduleChanged?.();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  /** Puts the workout in the watch's workout list over Bluetooth (no COROS account needed). */
  const sendToWatch = async () => {
    if (!active) return;
    setBusy("watch");
    try {
      await api.sendWorkoutToWatch(active.id);
      onMessage(t("Sent \"{{value1}}\" to your watch. Find it under Workouts on the watch.", { value1: String(active.name) }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (sport = duplicateSport) => {
    if (!active) return;
    setDuplicateMenuOpen(false);
    const name = window.prompt("Name for the duplicate", `${active.name} Copy`);
    if (!name?.trim()) return;
    setBusy("duplicate");
    try {
      const result = await api.duplicateLibraryWorkout(
        active.id,
        name.trim(),
        sport ?? active.sportType
      );
      onMessage(t("Created \"{{value1}}\" in the workout library.", { value1: String(result.name) }));
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
      onMessage(localOnly
        ? t("Deleted {{value1}} workout{{value2}} from this computer.", { value1: String(pendingDelete.length), value2: String(pendingDelete.length === 1 ? "" : "s") })
        : t("Deleted {{value1}} workout{{value2}} from COROS.", { value1: String(pendingDelete.length), value2: String(pendingDelete.length === 1 ? "" : "s") }));
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
      aria-label={t("Select {{value1}}", { value1: String(name) })}
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
  const readerSeconds = previewMetrics?.durationSeconds || (profile.timed ? profile.totalWeight : 0);
  const readerTime = readerSeconds ? formatMinutes(readerSeconds / 60) : null;
  const activeSport = resolveWorkoutSport(active?.sportType);
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
  const readerKind = sessionKind(profile);
  const days = libraryWeek();
  const scheduleDay = days.find((day) => day.iso === scheduleDate);
  const readerAxis = readerSeconds
    ? [0, 0.25, 0.5, 0.75, 1].map((fraction) => (fraction ? formatMinutes((readerSeconds * fraction) / 60) : "0"))
    : [];
  const swimReader = previewDocument?.draft.sport === "swim";
  const readerIsSets = !previewMetrics?.distanceMeters && isSetVolume(active?.volume);

  return (
    <div className="tl-panel tl-split">
        <div className="tl-filters">
          <label className="tl-search">
            <Search size={15} />
            <span className="sr-only">{t("Search workouts")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search workouts and tags")}
            />
          </label>
          <div className="tl-chips" role="group" aria-label={t("Filter workouts")}>
            {scopes.map((option) => (
              <button
                type="button"
                key={option.id}
                className="tl-pill"
                aria-pressed={scope === option.id}
                style={option.sport ? sportChipStyle(option.sport) : undefined}
                onClick={() => setScope(option.id)}
              >
                {option.sport ? <i className="tl-pill-dot" aria-hidden="true" /> : null}
                {t(option.label)}
                <span className="tl-pill-count">{option.count}</span>
              </button>
            ))}
            {favoriteCount ? (
              <button
                type="button"
                className="tl-pill is-favorite"
                aria-pressed={scope === "favorite"}
                onClick={() => setScope(scope === "favorite" ? "all" : "favorite")}
              >
                <Heart size={13} fill={scope === "favorite" ? "currentColor" : "none"} aria-hidden="true" />
                {t("Favorites")}
                <span className="tl-pill-count">{favoriteCount}</span>
              </button>
            ) : null}
          </div>
          <div className="tl-filters-tail">
            <span className="tl-sort-label" aria-hidden="true">{t("Sort")}</span>
            <SelectDropdown translateLabel={t}
              className="tl-quiet-select"
              label={t("Sort workouts")}
              value={sort.column}
              options={WORKOUT_SORT_OPTIONS}
              onChange={(value) => setSort({ column: value, descending: value !== "name" })}
            />
            <div className="tl-layout-switch" role="group" aria-label={t("Workout layout")}>
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

          </div>
        </div>

      <section className="tl-catalog" aria-label={t("{{value1}} workouts", { value1: String(filtered.length) })}>
        {selected.length ? (
          <div className="tl-bulk" role="toolbar" aria-label={t("Actions for selected workouts")}>
            <strong>{selected.length} {t("selected")}</strong>
            <button type="button" onClick={applyTags}>
              <Tag size={13} /> {t("Tag")} </button>
            {collections.length ? (
              <SelectDropdown translateLabel={t}
                className="tl-quiet-select"
                label={t("Move selected workouts to a collection")}
                value=""
                options={[
                  { value: "", label: "Move to collection" },
                  ...collections.map((collection) => ({ value: collection.id, label: collection.name, translate: false }))
                ]}
                onChange={(value) => {
                  if (value) void updateMetadata(selected, { collectionId: value });
                }}
              />
            ) : null}
            <button type="button" onClick={() => downloadSelection(exportTargets)}>
              <Download size={13} /> {t("Export")} </button>
            {filtered.some((workout) => !selected.includes(workout.id)) ? (
              // Every workout the filters match, including ones not shown yet.
              <button type="button" onClick={() => setSelected([...new Set([...selected, ...filtered.map((workout) => workout.id)])])}>
                <ListChecks size={13} /> {t("Select all {{value1}}", { value1: String(new Set([...selected, ...filtered.map((workout) => workout.id)]).size) })} </button>
            ) : null}
            <button type="button" className="danger" onClick={() => setPendingDelete(selected)}>
              <Trash2 size={13} /> {t("Delete")} </button>
            <button type="button" aria-label={t("Clear selection")} onClick={() => setSelected([])}>
              <X size={13} />
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="tl-empty">
            <h3>{t("No workouts match")}</h3>
            <p>{t("Clear the search or choose another filter.")}</p>
          </div>
        ) : layout === "grid" ? (
          <>
          <p className="tl-list-label">
            <span>
              {filtered.length === workouts.length
                ? t("All {{value1}} workouts", { value1: String(filtered.length) })
                : t("{{value1}} of {{value2}} workouts", { value1: String(filtered.length), value2: String(workouts.length) })}
            </span>
            <span>{t("Shape = intensity over time")}</span>
          </p>
          <ul className={`tl-grid${selected.length ? " is-selecting" : ""}`} role="list">
            {filtered.slice(0, visibleCount).map((workout) => {
              const isSelected = selected.includes(workout.id);
              const references = workout.usedByPlanIds.length + workout.scheduledCount;
              const sport = resolveWorkoutSport(workout.sportType);
              const SportIcon = sportTheme(sport).icon;
              const load = workout.trainingLoad ? Math.round(workout.trainingLoad) : null;
              /* A sliver of fill so the lightest session still draws something. */
              const loadShare = load && heaviestLoad ? Math.max(3, (load / heaviestLoad) * 100) : 0;
              const lastUsed = sinceLabel(workout.lastUsedAt);
              const tags = workout.tags.slice(0, 3);
              const tileProfile = shapes[workout.id];
              const hasShape = Boolean(tileProfile?.segments.length);
              /* Timed steps add up to a duration; a volume that is itself a time says so already. */
              const tileDuration = tileProfile?.timed && !/\b(h|min)\b/.test(workout.volume ?? "")
                ? formatMinutes(tileProfile.totalWeight / 60)
                : null;

              return (
                <li
                  className={`tl-card tl-tile${activeId === workout.id ? " is-active" : ""}${
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
                    className={`tl-tile-heart${workout.favorite ? " is-active" : ""}`}
                    aria-pressed={workout.favorite}
                    aria-label={workout.favorite
                      ? t("Remove {{value1}} from favorites", { value1: workout.name })
                      : t("Add {{value1}} to favorites", { value1: workout.name })}
                    onClick={() => void updateMetadata([workout.id], { favorite: !workout.favorite })}
                  >
                    <Heart size={15} fill={workout.favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="tl-card-open tl-tile-open"
                    aria-pressed={activeId === workout.id}
                    onClick={() => setActiveId(workout.id)}
                  >
                    <span className="tl-tile-head">
                      <span className="tl-tile-badge" aria-hidden="true">
                        <SportIcon size={17} strokeWidth={2} />
                      </span>
                      <span className="tl-tile-sport">
                        <b>{formatWorkoutSport(sport ?? "run")}</b>
                        <small>
                          {lastUsed ? t("Last used {{value1}}", { value1: lastUsed }) : t("Not used yet")}
                        </small>
                      </span>
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
                    {hasShape ? (
                      <SessionProfileBars
                        profile={tileProfile}
                        label={t("{{value1}} intensity profile: {{value2}}", { value1: workout.name, value2: profileSummary(tileProfile) })}
                      />
                    ) : (
                      <span className="tl-skyline is-tile is-pending" aria-hidden="true">
                        <span
                          className={`tl-wk-track${load ? "" : " is-nil"}`}
                          title={
                            load
                              ? t("{{value1}} training load — {{value2}}% of the heaviest workout in your library", { value1: String(load), value2: String(Math.round((load / heaviestLoad) * 100)) })
                              : t("COROS has not reported a training load for this workout")
                          }
                        >
                          {load ? <i style={{ width: `${loadShare}%` }} /> : null}
                        </span>
                      </span>
                    )}
                    <span className="tl-tile-foot">
                      <span className="tl-tile-facts">
                        {tileDuration ? (
                          <span>
                            <b>{tileDuration}</b>
                          </span>
                        ) : null}
                        <span>
                          <b>{formatWorkoutVolume(workout.volume, unitSystem, sport === "swim") ?? t("No volume")}</b>
                        </span>
                        <span>
                          {references ? (
                            <>
                              <b>{references}</b> {references === 1 ? t("use") : t("uses")}
                            </>
                          ) : (
                            t("Unused")
                          )}
                        </span>
                      </span>
                      <span className="tl-tile-load" title={t("Training load")}>
                        <LoadPips load={load} heaviest={heaviestLoad} />
                        <b className={load ? "" : "is-nil"}>{load ?? "—"}</b>
                        <span className="sr-only">{t("load")}</span>
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
                  {t("Show 60 more of")} {filtered.length}
                </button>
              </li>
            ) : null}
          </ul>
          </>
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
                {t("Workout")}{sortIndicator("name")}
              </button>
              {WORKOUT_COLUMNS.map((column) => (
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
            </div>

            <ul role="list">
              {filtered.slice(0, visibleCount).map((workout) => {
                const isSelected = selected.includes(workout.id);
                const references = workout.usedByPlanIds.length + workout.scheduledCount;
                const sport = resolveWorkoutSport(workout.sportType);
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
                          <Heart size={12} fill="currentColor" strokeWidth={0} aria-label={t("Favorite")} />
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
                      {formatWorkoutVolume(workout.volume, unitSystem, resolveWorkoutSport(workout.sportType) === "swim") ?? "—"}
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
                {t("Show 60 more of")} {filtered.length}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <aside className="tl-reader tl-reader-revamp" aria-live="polite" style={sportAccentStyle(activeSport)}>
        {!active ? (
          <div className="tl-empty">
            <h3>{t("Pick a workout")}</h3>
            <p>{t("Its full step structure and references appear here.")}</p>
          </div>
        ) : (
          <>
            <div className="tl-reader-scroll">
              <header className="tl-reader-head">
                <span className="tl-reader-badge" aria-hidden="true">
                  <ActiveSportIcon size={22} strokeWidth={2} />
                </span>
                <span className="tl-reader-title">
                  <p className="tl-reader-eyebrow">
                    {formatWorkoutSport(activeSport ?? "run")}
                    {readerKind ? <> · {t(readerKind)}</> : null}
                  </p>
                  <h2>{active.name}</h2>
                </span>
                <button
                  type="button"
                  className={`tl-reader-favorite${active.favorite ? " is-active" : ""}`}
                  aria-pressed={active.favorite}
                  aria-label={active.favorite ? t("Remove from favorites") : t("Add to favorites")}
                  onClick={() => void updateMetadata([active.id], { favorite: !active.favorite })}
                >
                  <Heart size={17} fill={active.favorite ? "currentColor" : "none"} />
                </button>
              </header>
              <ul className="tl-reader-tags" aria-label={t("Workout tags")}>
                {active.tags.slice(0, 8).map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
                {active.tags.length > 8 ? <li>+{active.tags.length - 8} {t("more")}</li> : null}
                <li className="is-action">
                  <button type="button" onClick={applyTags}>
                    <Plus size={11} aria-hidden="true" /> {active.tags.length ? t("Edit tags") : t("Tag")}
                  </button>
                </li>
              </ul>

              <dl className="tl-kpis">
                <div className="is-time">
                  <dt><i aria-hidden="true"><Clock size={11} strokeWidth={2.6} /></i>{t("Time")}</dt>
                  <dd className={readerTime ? "" : "is-nil"} title={readerTime ?? undefined}>{readerTime ? <Figure value={readerTime} /> : "—"}</dd>
                </div>
                <div className="is-distance">
                  <dt>
                    <i aria-hidden="true">{readerIsSets ? <Layers size={11} strokeWidth={2.6} /> : <Route size={11} strokeWidth={2.6} />}</i>
                    {readerIsSets ? t("Sets") : t("Distance")}
                  </dt>
                  <dd className={readerDistance ? "" : "is-nil"} title={readerDistance ?? undefined}>{readerDistance ? <Figure value={readerDistance} /> : "—"}</dd>
                </div>
                <div className="is-load">
                  <dt><i aria-hidden="true"><Flame size={11} strokeWidth={2.6} /></i>{t("Load")}</dt>
                  <dd className={readerLoad ? "" : "is-nil"}>{readerLoad ?? "—"}</dd>
                </div>
                <div className="is-steps">
                  <dt><i aria-hidden="true"><Layers size={11} strokeWidth={2.6} /></i>{t("Steps")}</dt>
                  <dd className={readerSteps ? "" : "is-nil"}>{readerSteps ?? "—"}</dd>
                </div>
              </dl>

              {profile.segments.length ? (
                <figure className="tl-reader-profile">
                  <figcaption>
                    <span>{t("Session profile")}</span>
                    {readerTime ? <span>{readerTime}</span> : null}
                  </figcaption>
                  <SessionProfileBars
                    profile={profile}
                    size="reader"
                    playhead
                    label={t("Intensity profile for {{value1}}: {{value2}}", { value1: active.name, value2: profileSummary(profile, readerSeconds || undefined) })}
                  />
                  {readerAxis.length ? (
                    <div className="tl-reader-axis" aria-hidden="true">
                      {readerAxis.map((tick, index) => <span key={index}>{tick}</span>)}
                    </div>
                  ) : null}
                  <div className="tl-zone-split" aria-hidden="true">
                    {profile.zones.map(({ zone, share }) => (
                      <i key={zone} className={`is-${zone}`} style={{ flexGrow: share }} />
                    ))}
                  </div>
                  <ul className="tl-zone-legend" aria-label={t("Time by intensity")}>
                    {profile.zones.map(({ zone, share }) => (
                      <li key={zone}>
                        <i className={`is-${zone}`} aria-hidden="true" />
                        {t(PROFILE_ZONE_LABELS[zone])}{" "}
                        <b>{readerSeconds ? formatMinutes((share * readerSeconds) / 60) : `${Math.round(share * 100)}%`}</b>
                      </li>
                    ))}
                  </ul>
                </figure>
              ) : null}

              {previewLoading ? (
                <p className="tl-reader-loading">
                  <LoaderCircle className="is-spinning" size={16} /> {t("Loading the full structure")} </p>
              ) : previewDocument ? (
                <div className="tl-steps-block">
                  <p className="tl-steps-label">
                    {t("Steps")} <span>{previewDocument.draft.nodes.length === 1
                    ? t("1 step")
                    : t("{{value1}} steps", { value1: String(previewDocument.draft.nodes.length) })}</span>
                  </p>
                  <ol className="tl-steps tl-steps-revamp">
                    {previewDocument.draft.nodes.map((node, index) => (
                      <li
                        key={node.id}
                        className={node.nodeType === "repeat" ? "is-repeat" : ""}
                        data-zone={node.nodeType === "step" ? stepZone(node, previewDocument.context) : node.steps[0] ? stepZone(node.steps[0], previewDocument.context) : "work"}
                      >
                        <span className="tl-step-row">
                          <span className="tl-step-number">{String(index + 1).padStart(2, "0")}</span>
                          <span className="tl-step-text">
                            <b>
                              {node.nodeType === "repeat"
                                ? `${node.repeat} × ${node.steps.map(stepName).join(" + ")}`
                                : stepName(node)}
                            </b>
                            {node.nodeType === "step"
                              ? (stepDetail(node) || node.overview ? <small>{stepDetail(node) || node.overview}</small> : null)
                              : <small>{repeatDetail(node)}</small>}
                          </span>
                          <small className={`tl-step-amount${node.nodeType === "repeat" ? " is-rounds" : ""}`}>
                            {targetLabel(node, unitSystem, swimReader)}
                          </small>
                        </span>
                        {node.nodeType === "repeat" ? (
                          <ol className="tl-step-children">
                            {node.steps.map((step) => (
                              <li key={step.id} data-zone={stepZone(step, previewDocument.context)}>
                                <i aria-hidden="true" />
                                <span>
                                  {stepName(step)}
                                  {stepDetail(step) ? <em>{stepDetail(step)}</em> : null}
                                </span>
                                <small>{targetLabel(step, unitSystem, swimReader)}</small>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        {!node.editable ? (
                          <i className="tl-flag" title={node.unsupportedReason}>
                            {t("read only")} </i>
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
                    {(() => {
                      /* "In Half Marathon — Sub 1:30 · scheduled 3× · last today", falling back to counts when no name is known. */
                      const named = active.usedByPlanIds.map((id) => planNames?.get(id)).filter((name): name is string => Boolean(name));
                      const lastUsed = sinceLabel(active.lastUsedAt);
                      const parts = [
                        named.length
                          ? named.length > 1
                            ? t("In {{value1}} +{{value2}} more", { value1: named[0]!, value2: String(active.usedByPlanIds.length - 1) })
                            : t("In {{value1}}", { value1: named[0]! })
                          : active.usedByPlanIds.length
                            ? t("Used by {{value1}} plan{{value2}}", { value1: String(active.usedByPlanIds.length), value2: active.usedByPlanIds.length === 1 ? "" : "s" })
                            : undefined,
                        active.scheduledCount ? t("scheduled {{value1}}×", { value1: String(active.scheduledCount) }) : undefined,
                        lastUsed ? t("last {{value1}}", { value1: lastUsed }) : undefined
                      ].filter(Boolean);
                      return <span>{parts.join(" · ")}</span>;
                    })()}
                  </>
                ) : (
                  <>
                    <Unlink size={13} />
                    {t("Not referenced by a plan or a calendar day.")} </>
                )}
              </p>
            </div>

            <footer className="tl-reader-dock tl-reader-dock-revamp">
              <form
                className="tl-reader-schedule"
                onSubmit={(event) => {
                  event.preventDefault();
                  void schedule();
                }}
              >
                <div className="tl-reader-schedule-heading">
                  <span className="tl-dock-label">{t("Put it on this week")}</span>
                  <label className="tl-other-date">
                    <span>{t("Pick another date")} ›</span>
                    <input
                      ref={otherDateInput}
                      type="date"
                      value={scheduleDate}
                      min={days.find((day) => day.isToday)?.iso ?? tomorrow()}
                      aria-label={t("Schedule date")}
                      onChange={(event) => setScheduleDate(event.target.value)}
                      onClick={() => {
                        try { otherDateInput.current?.showPicker(); } catch { /* the field still takes typing */ }
                      }}
                    />
                  </label>
                </div>
                <div className="tl-day-strip" role="group" aria-label={t("Choose a day this week")}>
                  {days.map((day) => {
                    const planned = plannedDays[day.iso] ?? [];
                    return (
                      <button
                        type="button"
                        key={day.iso}
                        aria-pressed={scheduleDate === day.iso}
                        disabled={day.past}
                        className={day.isToday ? "is-today" : undefined}
                        aria-label={planned.length
                          ? t("{{value1}}, {{value2}} planned", { value1: day.long, value2: String(planned.length) })
                          : t("{{value1}}, free", { value1: day.long })}
                        onClick={() => setScheduleDate(day.iso)}
                      >
                        <small>{day.isToday ? t("Today") : day.weekday}</small>
                        <b>{day.day}</b>
                        <span className="tl-day-dots" aria-hidden="true">
                          {planned.slice(0, 3).map((sport, index) => (
                            <i key={index} style={sportChipStyle(sport)} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="submit"
                  className="tl-schedule-button"
                  disabled={!scheduleDate || busy === "schedule"}
                >
                  <CalendarPlus size={15} aria-hidden="true" />
                  {busy === "schedule"
                    ? t("Scheduling")
                    : scheduleDay
                      ? t("Schedule for {{value1}}", { value1: formatDate(new Date(`${scheduleDay.iso}T12:00:00`), { weekday: "short", month: "short", day: "numeric" }) })
                      : scheduleDate
                        ? t("Schedule for {{value1}}", { value1: formatHappenDayLabel(scheduleDate.replace(/-/g, "")) })
                        : t("Schedule")}
                </button>
              </form>

              <div className="tl-reader-actions">
                <div className="tl-reader-actions-main">
                  <button
                    type="button"
                    className="primary-button tl-send-button"
                    disabled={busy === "watch"}
                    onClick={() => void sendToWatch()}
                  >
                    <Watch size={15} /> {busy === "watch" ? t("Sending to watch…") : t("Send to watch")} </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={!previewDocument?.canEdit}
                    onClick={() => setEditId(active.id)}
                  >
                    <Pencil size={14} /> {t("Edit")} </button>
                  <div className="tl-reader-duplicate-menu" ref={duplicateMenuRef}>
                    <button
                      type="button"
                      className="ghost-button tl-reader-icon-button"
                      aria-label={t("Duplicate as")}
                      title={t("Duplicate as")}
                      aria-haspopup="menu"
                      aria-expanded={duplicateMenuOpen}
                      disabled={busy === "duplicate"}
                      onClick={() => setDuplicateMenuOpen((open) => !open)}
                    >
                      <Copy size={14} />
                    </button>
                    {duplicateMenuOpen ? (
                      <div className="tl-duplicate-popover" role="menu" aria-label={t("Sport for the duplicate")}>
                        <p>{t("Duplicate as")}</p>
                        {Array.from({ length: 9 }, (_, index) => index + 1).map((sportType) => {
                          const sport = workoutSportFromType(sportType) ?? "run";
                          const current = sportType === (duplicateSport ?? active.sportType ?? 1);
                          return (
                            <button
                              type="button"
                              role="menuitem"
                              key={sportType}
                              className={current ? "is-current" : undefined}
                              style={sportChipStyle(sport)}
                              onClick={() => {
                                setDuplicateSport(sportType);
                                void duplicate(sportType);
                              }}
                            >
                              <i aria-hidden="true" />
                              {formatWorkoutSport(sport)}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="tl-reader-actions-meta">
                  <button
                    type="button"
                    className="ghost-button danger tl-reader-icon-button"
                    aria-label={t("Delete")}
                    title={t("Delete")}
                    onClick={() => setPendingDelete([active.id])}
                  >
                    <Trash2 size={14} />
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
              {t("Delete")} {pendingDelete.length} {t("workout")}{pendingDelete.length === 1 ? "" : "s"} {localOnly ? t("from this computer?") : t("from COROS?")} </h2>
            <p>
              {t("This cannot be undone. Calendar copies stay in place, and plan references will remain but point at nothing.")} </p>
            <ul>
              {workouts
                .filter((workout) => pendingDelete.includes(workout.id))
                .map((workout) => (
                  <li key={workout.id}>
                    <strong>{workout.name}</strong>
                    <span>
                      {workout.usedByPlanIds.length} {t("plan references ·")} {workout.scheduledCount} {t("scheduled")} </span>
                  </li>
                ))}
            </ul>
            <footer>
              <button type="button" className="ghost-button" onClick={() => setPendingDelete([])}>
                {t("Cancel")} </button>
              <button
                type="button"
                className="primary-button danger"
                disabled={busy === "delete"}
                onClick={() => void deleteConfirmed()}
              >
                {busy === "delete" ? t("Deleting") : t("Delete")}
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
