import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Info,
  Link2,
  Loader2,
  LockKeyhole,
  Minus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  X
} from "lucide-react";
import type {
  HevyStatus,
  StrengthDataSource,
  StrengthSession,
  TrainingHubStatus,
  UnitSystem
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { useTheme } from "../theme/ThemeProvider";
import { resolveMuscleView } from "./bodyFocus";
import { BodyMapV2, type BodyView } from "./BodyMapV2";
import { MusclePanel } from "./MusclePanel";
import { MUSCLE_BY_ID, type MuscleId } from "./muscles";
import { buildSampleStrengthSessions } from "./sampleSessions";
import { ExerciseExplorer } from "./ExerciseExplorer";
import { explorerExerciseName } from "./exerciseExplorerData";
import {
  buildStrengthAnalytics,
  formatSets,
  startOfWeekMs,
  type ExerciseStat,
  type HeatMetric,
  type WeekBucket
} from "./strengthAnalytics";
import "./strength.css";
import "./exerciseExplorer.css";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { kilogramsToDisplayWeight, weightUnit } from "../units/units";

interface StrengthViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  /** Dev view unlocks the generated sample history. */
  showDevelopmentTools?: boolean;
}

const WINDOW_OPTIONS = [
  { days: 30, label: "30 days", phrase: "the last 30 days" },
  { days: 90, label: "3 months", phrase: "the last 3 months" },
  { days: 180, label: "6 months", phrase: "the last 6 months" },
  { days: 365, label: "1 year", phrase: "the last year" }
];

const METRIC_OPTIONS: { id: HeatMetric; label: string }[] = [
  { id: "sets", label: "Sets" },
  { id: "volume", label: "Volume" },
  { id: "time", label: "Time" }
];

/** Chunks are drained in a loop; this caps a runaway backfill. */
const MAX_SYNC_ROUNDS = 60;

const MS_PER_WEEK = 604_800_000;

/**
 * Lifts shown in the main-lift list, and sessions in the history grid. Five
 * lifts keeps that card roughly level with the movement mix beside it; six
 * left the right-hand column ending well short of the left.
 */
const MAX_MAIN_LIFTS = 5;
const MAX_RECENT_SESSIONS = 6;

/** Plot box of the weekly chart, in the same pixels the gradient is drawn in. */
const CHART_HEIGHT = 268;
const CHART_PLOT_TOP = 6;
const CHART_PLOT_BOTTOM = 236;

/**
 * The page's own ramp, taken from the heat legend on the figure above: work is
 * warm. Deliberately not the app's teal accent, which belongs to every other
 * view — green is kept here for one job only, marking a lift that improved.
 */
const EMBER = {
  dark: {
    hot: "#f6b04a",
    mid: "#e8813c",
    base: "#d9434b",
    sets: "#f3dfc4",
    /* The hover column reads as the bar's own warmth turned up, not as the
       shared white wash — which on this chart outshone the bar it marked. */
    cursor: "rgba(232, 129, 60, 0.12)"
  },
  paper: {
    hot: "#d9901c",
    mid: "#cf6a2a",
    base: "#bd3238",
    sets: "#614b3a",
    cursor: "rgba(207, 106, 42, 0.1)"
  }
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSessionDate(startTime?: number): string {
  if (!startTime) {
    return "Unknown date";
  }
  const date = new Date(startTime * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

function formatSyncTime(value?: string): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not synced yet"
    : `Last synced ${date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })}`;
}

function sessionSourceLabel(session: StrengthSession): string | undefined {
  if (session.source === "combined") return "Hevy + COROS";
  if (session.source === "hevy") return "Hevy";
  if (session.source === "coros") return "COROS";
  return undefined;
}

interface FigurePart {
  value: string;
  unit?: string;
}

/**
 * Big-figure formatting: the number and its unit are separate so the unit can
 * be set smaller and quieter than the digits it belongs to.
 */
function totalWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  if (unitSystem === "metric" && kg >= 1000) {
    const tonnes = kg / 1000;
    return [
      {
        value: tonnes >= 10 ? Math.round(tonnes).toLocaleString() : tonnes.toFixed(1),
        unit: "tonnes"
      }
    ];
  }
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [{ value: Math.round(display).toLocaleString(), unit: weightUnit(unitSystem) }];
}

/** A single lift keeps its half-kilo; a season's tonnage does not. */
function liftWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [
    {
      value: Number.isInteger(display)
        ? display.toLocaleString()
        : display.toFixed(1),
      unit: weightUnit(unitSystem)
    }
  ];
}

function formatTotalWeight(kg: number, unitSystem: UnitSystem): string {
  return totalWeightParts(kg, unitSystem)
    .map((part) => `${part.value} ${part.unit ?? ""}`.trim())
    .join(" ");
}

function formatLiftWeight(kg: number, unitSystem: UnitSystem): string {
  return liftWeightParts(kg, unitSystem)
    .map((part) => `${part.value} ${part.unit ?? ""}`.trim())
    .join(" ");
}

function durationParts(seconds: number): FigurePart[] {
  const total = Math.max(0, Math.round(seconds));
  let hours = Math.floor(total / 3600);
  let minutes = Math.round((total % 3600) / 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours === 0) {
    return [{ value: String(minutes), unit: "min" }];
  }
  if (minutes === 0) {
    return [{ value: String(hours), unit: "h" }];
  }
  return [
    { value: String(hours), unit: "h" },
    { value: String(minutes), unit: "min" }
  ];
}

/** Compact form of the same duration, for running text: "52 min", "1h 4m". */
function formatSpan(seconds: number): string {
  const parts = durationParts(seconds);
  if (parts.length === 1 && parts[0].unit === "min") {
    return `${parts[0].value} min`;
  }
  return parts.map((part) => `${part.value}${part.unit?.charAt(0) ?? ""}`).join(" ");
}

function cadencePhrase(sessionsPerWeek: number): string {
  if (sessionsPerWeek <= 0) {
    return "";
  }
  if (sessionsPerWeek >= 1) {
    return `About ${sessionsPerWeek.toFixed(1).replace(/\.0$/, "")} a week`;
  }
  return `About one every ${Math.round(7 / sessionsPerWeek)} days`;
}

interface WeekPoint {
  weekStart: number;
  label: string;
  sessions: number;
  sets: number;
  volumeKg: number;
}

/**
 * Zero-filled weeks across the whole window. The analytics only bucket weeks
 * that had a session, so a week off would otherwise close up and the chart
 * would read as an unbroken streak.
 */
function buildWeekSeries(weeks: WeekBucket[], windowDays: number): WeekPoint[] {
  const byWeekStart = new Map(weeks.map((week) => [week.weekStart, week]));
  const currentWeek = startOfWeekMs(Date.now());
  const firstWeek = startOfWeekMs(Date.now() - (windowDays - 1) * 86_400_000);
  const points: WeekPoint[] = [];

  for (let at = firstWeek; at <= currentWeek; at += MS_PER_WEEK) {
    const bucket = byWeekStart.get(Math.floor(at / 1000));
    points.push({
      weekStart: Math.floor(at / 1000),
      label: new Date(at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      }),
      sessions: bucket?.sessions ?? 0,
      sets: bucket?.sets ?? 0,
      volumeKg: bucket?.volumeKg ?? 0
    });
  }

  return points;
}

interface RecentChange {
  /** Percent change from the previous block of the same length. */
  percent: number;
  weeks: number;
}

/**
 * Compare the last few finished weeks against the same number before them. The
 * week in progress is left out — half a week always looks like a slump.
 */
function compareRecentWeeks(
  series: WeekPoint[],
  valueOf: (point: WeekPoint) => number
): RecentChange | null {
  const finished = series.slice(0, -1);
  const span = Math.min(4, Math.floor(finished.length / 2));
  if (span < 2) {
    return null;
  }
  const total = (points: WeekPoint[]) =>
    points.reduce((sum, point) => sum + valueOf(point), 0);
  const earlier = total(finished.slice(-span * 2, -span));
  if (earlier <= 0) {
    return null;
  }
  const recent = total(finished.slice(-span));
  return { percent: ((recent - earlier) / earlier) * 100, weeks: span };
}

function Figure({ parts }: { parts: FigurePart[] }) {
  return (
    <p className="strength-figure">
      {parts.map((part) => (
        <span key={`${part.value}-${part.unit ?? ""}`}>
          <strong>{part.value}</strong>
          {part.unit ? <em>{part.unit}</em> : null}
        </span>
      ))}
    </p>
  );
}

/** Course of one lift's estimated max, drawn small enough to read as texture. */
function Sparkline({
  values,
  tone,
  record = false
}: {
  values: number[];
  tone: string;
  /** True when the newest point is also the lift's best — that dot earns gold. */
  record?: boolean;
}) {
  const width = 112;
  const height = 34;
  const pad = 5;

  const path = useMemo(() => {
    if (values.length < 2) {
      return null;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = (width - pad * 2) / (values.length - 1);
    return values.map((value, index) => ({
      x: pad + index * step,
      y: height - pad - ((value - min) / span) * (height - pad * 2)
    }));
  }, [values]);

  if (!path) {
    return <span className="strength-spark is-empty" aria-hidden="true" />;
  }

  const first = path[0]!;
  const last = path[path.length - 1]!;
  const area = [
    `M ${first.x} ${first.y}`,
    ...path.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${last.x} ${height}`,
    `L ${first.x} ${height}`,
    "Z"
  ].join(" ");
  return (
    <svg
      className="strength-spark"
      data-tone={tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path className="strength-spark-area" d={area} />
      <polyline points={path.map((point) => `${point.x},${point.y}`).join(" ")} />
      <circle
        className={record ? "strength-spark-record" : undefined}
        cx={last.x}
        cy={last.y}
        r={2.6}
      />
    </svg>
  );
}

export function StrengthView({
  api,
  status,
  onOpenTraining,
  showDevelopmentTools = false
}: StrengthViewProps) {
  const { unitSystem } = useUnitSystem();
  const corosConnected = Boolean(status?.authenticated);
  const { colors } = useChartColors();
  const { theme } = useTheme();
  const ember = theme === "paper" ? EMBER.paper : EMBER.dark;

  const [days, setDays] = useState(90);
  const [source, setSource] = useState<StrengthDataSource>("combined");
  const [hevyStatus, setHevyStatus] = useState<HevyStatus | null>(null);
  const [hevyStatusLoading, setHevyStatusLoading] = useState(true);
  const [hevyDialogOpen, setHevyDialogOpen] = useState(false);
  const [hevyApiKey, setHevyApiKey] = useState("");
  const [hevyBusy, setHevyBusy] = useState(false);
  const [hevyDialogError, setHevyDialogError] = useState<string | null>(null);
  const [loadedSessions, setLoadedSessions] = useState<StrengthSession[]>([]);
  const [sampleMode, setSampleMode] = useState(false);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [view, setView] = useState<BodyView>("front");
  const [viewRequest, setViewRequest] = useState(0);
  const [metric, setMetric] = useState<HeatMetric>("sets");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(null);
  const [selectedExerciseName, setSelectedExerciseName] = useState<string | null>(null);
  // Hover remains a transient highlight on the mannequin. The right-hand
  // panel changes only after an explicit click, so it never jumps while the
  // pointer crosses muscle shells or ranking rows.
  const [figureHover, setFigureHover] = useState<MuscleId | null>(null);
  const [listHover, setListHover] = useState<MuscleId | null>(null);
  const syncSequenceRef = useRef(0);
  const sourceInitializedRef = useRef(false);
  const hevyConnected = Boolean(hevyStatus?.connected);
  const anyConnected = corosConnected || hevyConnected;

  useEffect(() => {
    let active = true;
    setHevyStatusLoading(true);
    api
      .getHevyStatus()
      .then((next) => {
        if (!active) return;
        setHevyStatus(next);
        if (!sourceInitializedRef.current) {
          sourceInitializedRef.current = true;
          setSource(
            corosConnected && next.connected
              ? "combined"
              : next.connected
                ? "hevy"
                : "coros"
          );
        }
      })
      .catch((caught) => {
        if (!active) return;
        setHevyStatus({ connected: false, includeWarmups: false });
        sourceInitializedRef.current = true;
        setSource("coros");
        setError(toErrorMessage(caught));
      })
      .finally(() => {
        if (active) setHevyStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, corosConnected]);

  useEffect(() => {
    if (hevyStatus === null) return;
    setSource((current) => {
      if (current === "combined" && corosConnected && hevyConnected) return current;
      if (current === "coros" && corosConnected) return current;
      if (current === "hevy" && hevyConnected) return current;
      return corosConnected && hevyConnected
        ? "combined"
        : hevyConnected
          ? "hevy"
          : "coros";
    });
  }, [corosConnected, hevyConnected, hevyStatus]);

  useEffect(() => {
    if (source !== "coros" && metric === "time") {
      setMetric("sets");
    }
  }, [metric, source]);

  useEffect(() => {
    if (!hevyDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !hevyBusy) setHevyDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [hevyBusy, hevyDialogOpen]);

  const requestView = useCallback((next: BodyView) => {
    setSelectedMuscle(null);
    setFigureHover(null);
    setListHover(null);
    setView(next);
    setViewRequest((current) => current + 1);
  }, []);

  const selectMuscle = useCallback(
    (muscle: MuscleId | null) => {
      setFigureHover(null);
      setListHover(null);

      if (muscle === null || muscle === selectedMuscle) {
        setSelectedMuscle(null);
        return;
      }

      const nextView = resolveMuscleView(MUSCLE_BY_ID[muscle].view, view);
      if (nextView !== view) {
        setView(nextView);
        setViewRequest((current) => current + 1);
      }
      setSelectedMuscle(muscle);
    },
    [selectedMuscle, view]
  );

  const runSync = useCallback(
    async (force: boolean) => {
      if (hevyStatusLoading || !anyConnected) {
        return;
      }

      const sequence = ++syncSequenceRef.current;
      setLoading(true);
      setError(null);
      setWarnings([]);

      try {
        let result = await api.syncStrengthHistory({ days, force, source });
        if (syncSequenceRef.current !== sequence) {
          return;
        }
        setLoadedSessions(result.sessions);
        setPending(result.pending);
        setWarnings(result.warnings ?? []);

        // Keep draining while COROS still owes us breakdowns; each round
        // repaints the body map so it fills in as the history arrives.
        for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
          if (result.pending <= 0) {
            break;
          }
          const next = await api.syncStrengthHistory({
            days,
            force: false,
            source
          });
          if (syncSequenceRef.current !== sequence) {
            return;
          }
          setLoadedSessions(next.sessions);
          setPending(next.pending);
          setWarnings(next.warnings ?? []);
          // A round that fetched nothing means the API is refusing; stop
          // instead of spinning against it.
          if (next.fetched === 0) {
            break;
          }
          result = next;
        }
      } catch (caught) {
        if (syncSequenceRef.current === sequence) {
          setError(toErrorMessage(caught));
        }
      } finally {
        if (syncSequenceRef.current === sequence) {
          setLoading(false);
          if (source !== "coros") {
            void api.getHevyStatus().then(setHevyStatus).catch(() => undefined);
          }
        }
      }
    },
    [api, anyConnected, days, hevyStatusLoading, source]
  );

  useEffect(() => {
    void runSync(false);
    return () => {
      syncSequenceRef.current += 1;
    };
  }, [runSync]);

  // Leaving dev view drops the preview, so generated data can never linger in
  // the production view.
  useEffect(() => {
    if (!showDevelopmentTools) {
      setSampleMode(false);
    }
  }, [showDevelopmentTools]);

  const connectHevyAccount = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setHevyBusy(true);
      setHevyDialogError(null);
      try {
        const next = await api.connectHevy(hevyApiKey);
        setHevyStatus(next);
        setHevyApiKey("");
        setSource(corosConnected ? "combined" : "hevy");
      } catch (caught) {
        setHevyDialogError(toErrorMessage(caught));
      } finally {
        setHevyBusy(false);
      }
    },
    [api, corosConnected, hevyApiKey]
  );

  const changeWarmupSetting = useCallback(
    async (includeWarmups: boolean) => {
      setHevyBusy(true);
      setHevyDialogError(null);
      try {
        const next = await api.updateHevySettings({ includeWarmups });
        setHevyStatus(next);
        await runSync(false);
      } catch (caught) {
        setHevyDialogError(toErrorMessage(caught));
      } finally {
        setHevyBusy(false);
      }
    },
    [api, runSync]
  );

  const disconnectHevyAccount = useCallback(async () => {
    if (
      !window.confirm(
        "Disconnect Hevy and erase its cached workouts from this device?"
      )
    ) {
      return;
    }
    setHevyBusy(true);
    setHevyDialogError(null);
    try {
      syncSequenceRef.current += 1;
      await api.disconnectHevy();
      setHevyStatus({ connected: false, includeWarmups: false });
      setLoadedSessions([]);
      setWarnings([]);
      setPending(0);
      setSource(corosConnected ? "coros" : "hevy");
      if (!corosConnected) setHevyDialogOpen(false);
    } catch (caught) {
      setHevyDialogError(toErrorMessage(caught));
    } finally {
      setHevyBusy(false);
    }
  }, [api, corosConnected]);

  // Sample mode swaps in a generated history so the page can be worked on
  // without a populated account; nothing about it touches the API or the cache.
  const sessions = useMemo(
    () => (sampleMode ? buildSampleStrengthSessions(days) : loadedSessions),
    [sampleMode, days, loadedSessions]
  );

  const analytics = useMemo(
    () => buildStrengthAnalytics(sessions, days),
    [sessions, days]
  );

  const selectedExercise = selectedExerciseName
    ? analytics.exercises.find((exercise) => exercise.name === selectedExerciseName) ?? null
    : null;
  const openExercise = useCallback((name: string) => setSelectedExerciseName(name), []);
  const closeExercise = useCallback(() => setSelectedExerciseName(null), []);

  const highlightedMuscle = figureHover ?? listHover ?? selectedMuscle;
  const panelMuscle = selectedMuscle;
  const heatMax = analytics.muscleMax[metric];

  const activeWindow =
    WINDOW_OPTIONS.find((option) => option.days === days) ?? WINDOW_OPTIONS[1];
  const summary = analytics.summary;
  const hasSessions = summary.sessions > 0;
  const attributedSetCount = Math.round(analytics.attributedSets);
  const genericSetCount = Math.round(analytics.genericSets);
  const workingSetCount = Math.round(
    analytics.attributedSets + analytics.genericSets + analytics.unmappedSets
  );
  // A history of dips and pull-ups carries no load, so the page switches to
  // counting sets rather than showing a column of zeroes.
  const usesWeights = summary.volumeKg > 0;

  const weekSeries = useMemo(
    () => buildWeekSeries(analytics.weeks, days),
    [analytics.weeks, days]
  );

  const chartData = useMemo(
    () =>
      weekSeries.map((week) => ({
        label: week.label,
        value: usesWeights
          ? Math.round(kilogramsToDisplayWeight(week.volumeKg, unitSystem))
          : Math.round(week.sets),
        volumeKg: week.volumeKg,
        sets: Math.round(week.sets),
        sessions: week.sessions
      })),
    [weekSeries, unitSystem, usesWeights]
  );

  /**
   * Averaged over the weeks that were actually trained: counting rest weeks
   * would drag the line below every bar it is meant to sit among.
   */
  const average = useMemo(() => {
    const active = weekSeries.filter(
      (week) => (usesWeights ? week.volumeKg : week.sets) > 0
    );
    if (active.length === 0) {
      return { kg: 0, sets: 0 };
    }
    return {
      kg: active.reduce((total, week) => total + week.volumeKg, 0) / active.length,
      sets: active.reduce((total, week) => total + week.sets, 0) / active.length
    };
  }, [weekSeries, usesWeights]);

  const averageValue = usesWeights
    ? Math.round(kilogramsToDisplayWeight(average.kg, unitSystem))
    : Math.round(average.sets);

  const change = useMemo(
    () =>
      compareRecentWeeks(weekSeries, (week) =>
        usesWeights ? week.volumeKg : week.sets
      ),
    [weekSeries, usesWeights]
  );

  /**
   * Ranked by the work each lift actually took, not by how many times it was
   * performed: counting sets floats side bends and calf raises above the bench
   * press, which is not what anyone means by a main lift.
   */
  const mainLifts = useMemo(
    () =>
      analytics.exercises
        .filter((exercise: ExerciseStat) => exercise.bestE1rmKg > 0)
        .sort((a, b) => b.volumeKg - a.volumeKg)
        .slice(0, MAX_MAIN_LIFTS),
    [analytics.exercises]
  );

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
        .slice(0, MAX_RECENT_SESSIONS),
    [sessions]
  );

  const balanceTotal =
    analytics.balance.push +
    analytics.balance.pull +
    analytics.balance.legs +
    analytics.balance.core;

  const balanceSegments = (
    [
      ["push", "Pushing"],
      ["pull", "Pulling"],
      ["legs", "Legs"],
      ["core", "Core"]
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    share: balanceTotal > 0 ? analytics.balance[key] / balanceTotal : 0
  }));

  const summaryItems: { key: string; label: string; parts: FigurePart[]; caption: string }[] = [
    {
      key: "sessions",
      label: "Sessions",
      parts: [{ value: String(summary.sessions) }],
      caption: cadencePhrase(summary.sessionsPerWeek) || "Nothing logged yet"
    },
    usesWeights
      ? {
          key: "lifted",
          label: "Weight lifted",
          parts: totalWeightParts(summary.volumeKg, unitSystem),
          caption: `Across ${Math.round(summary.sets).toLocaleString()} sets`
        }
      : {
          key: "sets",
          label: "Sets",
          parts: [{ value: Math.round(summary.sets).toLocaleString() }],
          caption: `${Math.round(summary.reps).toLocaleString()} reps`
        },
    {
      key: "time",
      label: "Time lifting",
      parts: durationParts(summary.durationSec),
      caption: hasSessions
        ? `About ${formatSpan(summary.durationSec / summary.sessions)} a session`
        : "No time logged"
    },
    {
      key: "heaviest",
      label: "Heaviest lift",
      parts: summary.heaviestLift
        ? liftWeightParts(summary.heaviestLift.weightKg, unitSystem)
        : [{ value: "—" }],
      caption: summary.heaviestLift
        ? `${summary.heaviestLift.name} × ${summary.heaviestLift.reps}`
        : "Nothing with weight on it yet"
    }
  ];

  const axisFormatter = (value: number) => {
    if (!usesWeights) {
      return String(value);
    }
    return value >= 1000
      ? unitSystem === "metric"
        ? `${Math.round(value / 1000)} tonnes`
        : `${Math.round(value / 1000)}k`
      : String(value);
  };

  const averageLabel = usesWeights
    ? formatTotalWeight(average.kg, unitSystem)
    : `${Math.round(average.sets)} sets`;

  const sampleButton = showDevelopmentTools ? (
    <button
      type="button"
      className="strength-sample-button"
      onClick={() => setSampleMode(true)}
    >
      <FlaskConical size={14} aria-hidden="true" />
      Preview with sample data
    </button>
  ) : null;

  const hevyDialog = hevyDialogOpen ? (
    <div
      className="strength-hevy-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !hevyBusy) {
          setHevyDialogOpen(false);
        }
      }}
    >
      <section
        className="strength-hevy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-hevy-title"
      >
        <header>
          <div>
            <p className="eyebrow">Strength source</p>
            <h2 id="strength-hevy-title">
              {hevyConnected ? "Hevy connected" : "Connect Hevy"}
            </h2>
          </div>
          <button
            type="button"
            className="strength-hevy-close"
            aria-label="Close Hevy settings"
            disabled={hevyBusy}
            onClick={() => setHevyDialogOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {hevyConnected ? (
          <>
            <div className="strength-hevy-account">
              <span className="strength-hevy-mark" aria-hidden="true">H</span>
              <div>
                <strong>{hevyStatus?.displayName || "Hevy account"}</strong>
                <span>{formatSyncTime(hevyStatus?.lastSyncedAt)}</span>
              </div>
              {hevyStatus?.profileUrl ? (
                <a href={hevyStatus.profileUrl} target="_blank" rel="noreferrer">
                  Profile <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <label className="strength-hevy-toggle">
              <input
                type="checkbox"
                checked={Boolean(hevyStatus?.includeWarmups)}
                disabled={hevyBusy}
                onChange={(event) => void changeWarmupSetting(event.target.checked)}
              />
              <span>
                <strong>Include warm-up sets</strong>
                <small>Count warm-ups in sets, volume, and lift records.</small>
              </span>
            </label>
            <p className="strength-hevy-privacy">
              CorosLink reads completed workouts only. It never writes to Hevy or
              sends Hevy workouts to COROS.
            </p>
            <footer>
              <button
                type="button"
                className="secondary-button danger"
                disabled={hevyBusy}
                onClick={() => void disconnectHevyAccount()}
              >
                Disconnect and erase cache
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={hevyBusy}
                onClick={() => setHevyDialogOpen(false)}
              >
                Done
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={connectHevyAccount}>
            <p>
              Hevy&apos;s developer API requires Hevy Pro. Create a key in your
              Hevy web settings, then paste it below.
            </p>
            <a
              className="strength-hevy-developer-link"
              href="https://hevy.com/settings?developer"
              target="_blank"
              rel="noreferrer"
            >
              Open Hevy developer settings
              <ExternalLink size={14} aria-hidden="true" />
            </a>
            <label className="field">
              <span>Hevy API key</span>
              <input
                type="password"
                value={hevyApiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste API key"
                disabled={hevyBusy}
                onChange={(event) => setHevyApiKey(event.target.value)}
              />
            </label>
            <p className="strength-hevy-privacy">
              The key is encrypted with your operating system&apos;s credential
              storage and is never exposed to the page after connection.
            </p>
            <button
              type="submit"
              className="primary-button"
              disabled={hevyBusy || !hevyApiKey.trim()}
            >
              {hevyBusy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              Connect Hevy
            </button>
          </form>
        )}

        {hevyDialogError ? (
          <p className="strength-hevy-error" role="alert">{hevyDialogError}</p>
        ) : null}
      </section>
    </div>
  ) : null;

  // The controls only appear once there is something to control: on the
  // connect screen a window picker and a Refresh button would both be dead.
  const renderHeader = (withControls: boolean) => (
    <header className="strength-header">
      <div className="strength-title">
        <h2>Strength</h2>
        <p>
          {!withControls
            ? "Your lifting, muscle by muscle."
            : hasSessions
              ? `You trained ${summary.sessions} ${
                  summary.sessions === 1 ? "time" : "times"
                } in ${activeWindow.phrase}.`
              : `Your lifting from ${activeWindow.phrase}, muscle by muscle.`}
        </p>
      </div>
      <div className="strength-header-controls">
        {withControls ? (
          <>
          <div className="strength-segment strength-source" role="group" aria-label="Strength source">
            {(
              [
                ["combined", "Combined", !(corosConnected && hevyConnected)],
                ["hevy", "Hevy", !hevyConnected],
                ["coros", "COROS", !corosConnected]
              ] as const
            ).map(([id, label, disabled]) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                className={source === id ? "is-active" : ""}
                aria-pressed={source === id}
                onClick={() => setSource(id)}
              >
                <span className="strength-segment-label">{label}</span>
              </button>
            ))}
          </div>
          <div className="strength-segment strength-window" role="group" aria-label="Time covered">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={days === option.days ? "is-active" : ""}
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                <span className="strength-segment-label">{option.label}</span>
              </button>
            ))}
          </div>
          </>
        ) : null}
        <div className="strength-header-actions">
          {withControls ? (
            <button
              type="button"
              className="strength-action"
              disabled={loading || sampleMode}
              onClick={() => void runSync(true)}
            >
              {loading ? (
                <Loader2 className="spin" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Refresh
            </button>
          ) : null}
          <button
            type="button"
            className="strength-action"
            onClick={() => {
              setHevyDialogError(null);
              setHevyDialogOpen(true);
            }}
          >
            {hevyConnected ? (
              <>
                <span className="strength-hevy-dot" aria-hidden="true" />
                <Settings2 size={14} aria-hidden="true" />
                Hevy
              </>
            ) : (
              <>
                <Link2 size={14} aria-hidden="true" />
                Connect Hevy
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );

  if (hevyStatusLoading && !corosConnected && !sampleMode) {
    return (
      <section className="strength-view">
        {renderHeader(false)}
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          Checking strength connections…
        </p>
        {hevyDialog}
      </section>
    );
  }

  if (!anyConnected && !sampleMode) {
    return (
      <section className="strength-view">
        {renderHeader(false)}

        <section className="panel strength-card strength-connect">
          <span className="strength-connect-icon" aria-hidden="true">
            <LockKeyhole size={22} />
          </span>
          <h3>Connect a strength source</h3>
          <p>
            Import completed workouts from Hevy, read sessions from COROS
            Training Hub, or connect both for one combined history.
          </p>
          <div className="strength-connect-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setHevyDialogOpen(true)}
            >
              <Link2 size={16} aria-hidden="true" />
              Connect Hevy
            </button>
            <button type="button" className="secondary-button" onClick={onOpenTraining}>
              Open Training Hub
            </button>
          </div>
        </section>

        {sampleButton ? (
          <div className="strength-sample-cta">{sampleButton}</div>
        ) : null}
        {hevyDialog}
      </section>
    );
  }

  return (
    <section className="strength-view">
      {renderHeader(true)}
      {hevyDialog}

      {sampleMode ? (
        <p className="strength-notice is-sample" role="status">
          <FlaskConical size={14} aria-hidden="true" />
          Showing generated sample data, not your training.
          <button type="button" onClick={() => setSampleMode(false)}>
            Exit preview
          </button>
        </p>
      ) : null}

      {error && !sampleMode ? (
        <p className="strength-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {!sampleMode
        ? warnings.map((warning) => (
            <p className="strength-notice is-warning" role="status" key={warning}>
              {warning} Showing the most recent cached workouts instead.
            </p>
          ))
        : null}

      {pending > 0 && !sampleMode ? (
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          Reading {pending} more session{pending === 1 ? "" : "s"} from COROS.
          The map fills in as they arrive.
        </p>
      ) : null}

      {hasSessions && genericSetCount > 0 ? (
        <p className="strength-notice is-attribution" role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {`COROS recorded ${genericSetCount.toLocaleString()} working ${
              genericSetCount === 1 ? "set" : "sets"
            } only as Full Body, so ${genericSetCount === 1 ? "it is" : "they are"} excluded from the map. Specific attribution is available for ${attributedSetCount.toLocaleString()} of ${workingSetCount.toLocaleString()} working sets.`}
          </span>
        </p>
      ) : null}

      {sampleButton && !sampleMode ? (
        <div className="strength-sample-cta">{sampleButton}</div>
      ) : null}

      <div
        className="strength-hero"
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedMuscle) {
            event.preventDefault();
            selectMuscle(null);
          }
        }}
      >
        <section className="panel strength-body-panel">
          <div className="strength-body-controls">
            <div className="strength-segmented" role="group" aria-label="Body view">
              <button
                type="button"
                className={view === "front" ? "is-active" : ""}
                aria-pressed={view === "front"}
                onClick={() => requestView("front")}
              >
                Front
              </button>
              <button
                type="button"
                className={view === "back" ? "is-active" : ""}
                aria-pressed={view === "back"}
                onClick={() => requestView("back")}
              >
                Back
              </button>
            </div>
            <button
              type="button"
              className="strength-flip"
              aria-label="Flip the figure"
              onClick={() => requestView(view === "front" ? "back" : "front")}
            >
              <RotateCw size={15} aria-hidden="true" />
            </button>
            <div className="strength-segmented is-quiet" role="group" aria-label="Heat metric">
              {METRIC_OPTIONS.filter(
                (option) => source === "coros" || option.id !== "time"
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={metric === option.id ? "is-active" : ""}
                  aria-pressed={metric === option.id}
                  onClick={() => setMetric(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <BodyMapV2
            view={view}
            viewRequest={viewRequest}
            metric={metric}
            muscleById={analytics.muscleById}
            max={heatMax}
            selected={selectedMuscle}
            hovered={highlightedMuscle}
            onHover={setFigureHover}
            onSelect={selectMuscle}
            onViewChange={requestView}
            showLayerControls={showDevelopmentTools}
          />

          <div className="strength-legend" aria-hidden="true">
            <span>Light</span>
            <span className="strength-legend-ramp">
              {[1, 2, 3, 4, 5].map((level) => (
                <i key={level} data-level={level} />
              ))}
            </span>
            <span>Hammered</span>
          </div>
        </section>

        <section className="panel strength-muscle-panel">
          {hasSessions && workingSetCount > 0 && analytics.attributedSets <= 0 ? (
            <div className="muscle-panel is-unattributed">
              <span className="muscle-panel-unattributed-icon" aria-hidden="true">
                <Info size={22} />
              </span>
              <p className="eyebrow">Muscle attribution</p>
              <h3>No specific muscle data</h3>
              <p>
                {genericSetCount > 0
                  ? `COROS recorded ${genericSetCount.toLocaleString()} working ${
                      genericSetCount === 1 ? "set" : "sets"
                    } only as Full Body. Session totals remain available, but the map stays neutral because no specific muscles were identified.`
                  : "None of the exercises in this window could be matched to specific muscles. Session totals remain available, but the map stays neutral."}
              </p>
            </div>
          ) : (
            <MusclePanel
              muscles={analytics.muscles}
              muscleById={analytics.muscleById}
              metric={metric}
              max={heatMax}
              active={panelMuscle}
              onSelect={selectMuscle}
              onHover={setListHover}
              unitSystem={unitSystem}
            />
          )}
        </section>
      </div>

      {!hasSessions ? (
        <section className="panel strength-card strength-blank">
          <h3>No strength sessions in {activeWindow.phrase}</h3>
          <p>
            Sessions appear here a few minutes after they sync from your watch.
            Try a longer stretch of time if you know you&apos;ve been lifting.
          </p>
        </section>
      ) : (
        <>
          <section className="strength-summary" aria-label="Your training so far">
            {summaryItems.map((item) => (
              <div key={item.key} className="strength-summary-item">
                <p className="strength-summary-label">{item.label}</p>
                <Figure parts={item.parts} />
                <p className="strength-summary-caption">{item.caption}</p>
              </div>
            ))}
          </section>

          <section className="panel strength-card strength-week-card">
            <div className="strength-card-head">
              <div>
                <h3>{usesWeights ? "Weight lifted and sets each week" : "Sets each week"}</h3>
                <p>
                  {usesWeights
                    ? "Bars show total weight lifted; the line tracks your sets."
                    : "Every bar is every set you did that week."}
                </p>
              </div>
              {change ? (
                <span
                  className="strength-change"
                  data-tone={
                    Math.abs(change.percent) < 5
                      ? "flat"
                      : change.percent > 0
                        ? "up"
                        : "down"
                  }
                >
                  {Math.abs(change.percent) < 5 ? (
                    <Minus size={13} aria-hidden="true" />
                  ) : change.percent > 0 ? (
                    <ArrowUpRight size={13} aria-hidden="true" />
                  ) : (
                    <ArrowDownRight size={13} aria-hidden="true" />
                  )}
                  {Math.abs(change.percent) < 5
                    ? `About the same as the ${change.weeks} weeks before`
                    : `${Math.abs(Math.round(change.percent))}% ${
                        change.percent > 0 ? "more" : "less"
                      } than the ${change.weeks} weeks before`}
                </span>
              ) : null}
            </div>

            <div className="strength-chart">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <ComposedChart
                  data={chartData}
                  margin={{ top: 6, right: 2, left: 0, bottom: 0 }}
                >
                  <defs>
                    {/*
                     * Anchored to the plot box rather than to each bar, so the
                     * ramp is a property of the chart and not of the shape: a
                     * big week climbs into the amber, a light one stays low and
                     * deep red. Same reading as the heat on the figure above.
                     */}
                    <linearGradient
                      id="strengthWeekFill"
                      gradientUnits="userSpaceOnUse"
                      x1="0"
                      y1={CHART_PLOT_TOP}
                      x2="0"
                      y2={CHART_PLOT_BOTTOM}
                    >
                      <stop offset="0%" stopColor={ember.hot} stopOpacity={0.98} />
                      <stop offset="55%" stopColor={ember.mid} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={ember.base} stopOpacity={0.62} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={colors.text}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11.5}
                    tickMargin={10}
                    minTickGap={28}
                  />
                  <YAxis
                    yAxisId="weight"
                    stroke={colors.text}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11.5}
                    tickMargin={6}
                    width={usesWeights && unitSystem === "metric" ? 82 : 52}
                    tickFormatter={axisFormatter}
                  />
                  {usesWeights ? (
                    <YAxis
                      yAxisId="sets"
                      orientation="right"
                      stroke={ember.sets}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11.5}
                      tickMargin={6}
                      width={32}
                      allowDecimals={false}
                    />
                  ) : null}
                  <Tooltip
                    content={(props: TooltipContentProps) => {
                      if (!props.active || !props.payload?.length) {
                        return null;
                      }
                      const point = props.payload[0].payload as (typeof chartData)[number];
                      return (
                        <div className="strength-tooltip">
                          <span>Week of {props.label}</span>
                          <strong>
                            {point.sessions === 0
                              ? "No sessions"
                              : usesWeights
                                ? formatTotalWeight(point.volumeKg, unitSystem)
                                : `${point.sets} sets`}
                          </strong>
                          {point.sessions > 0 ? (
                            <span>
                              {point.sessions} session
                              {point.sessions === 1 ? "" : "s"}
                              {usesWeights ? ` · ${point.sets} sets` : ""}
                            </span>
                          ) : null}
                        </div>
                      );
                    }}
                    contentStyle={trainingChartTooltipStyle}
                    cursor={{ fill: ember.cursor, radius: 6 }}
                  />
                  {averageValue > 0 ? (
                    <ReferenceLine
                      yAxisId="weight"
                      y={averageValue}
                      stroke={colors.text}
                      strokeOpacity={0.45}
                      strokeDasharray="2 6"
                    />
                  ) : null}
                  <Bar
                    yAxisId="weight"
                    dataKey="value"
                    name={usesWeights ? "Weight lifted" : "Sets"}
                    fill="url(#strengthWeekFill)"
                    radius={[5, 5, 2, 2]}
                    maxBarSize={30}
                  />
                  {usesWeights ? (
                    <Line
                      yAxisId="sets"
                      type="monotone"
                      dataKey="sets"
                      name="Sets"
                      stroke={ember.sets}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: ember.sets,
                        stroke: colors.dotStroke,
                        strokeWidth: 2
                      }}
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {averageValue > 0 ? (
              <p className="strength-chart-note">
                <span className="strength-chart-dash" aria-hidden="true" />
                Your average week: {averageLabel}
              </p>
            ) : null}
          </section>

          <div className="strength-columns">
            <section className="panel strength-card strength-lifts-card">
              <div className="strength-card-head">
                <div>
                  <h3>Your main lifts</h3>
                  <p>
                    The most you could lift for one rep, estimated from your best
                    set.
                  </p>
                </div>
                {analytics.exercises.length > 0 ? (
                  <button
                    type="button"
                    className="strength-explore-all"
                    onClick={() =>
                      openExercise(mainLifts[0]?.name ?? analytics.exercises[0]!.name)
                    }
                  >
                    <Search size={13} aria-hidden="true" />
                    Explore all
                  </button>
                ) : null}
              </div>

              {mainLifts.length === 0 ? (
                <p className="strength-empty">
                  Nothing to estimate yet — this needs sets with weight on them.
                </p>
              ) : (
                <ul className="strength-lift-list">
                  {mainLifts.map((lift) => {
                    const trend = lift.e1rmTrendKg;
                    const tone =
                      trend === undefined
                        ? "flat"
                        : trend > 0.5
                          ? "up"
                          : trend < -0.5
                            ? "down"
                            : "flat";
                    const loaded = lift.history.filter(
                      (point) => point.e1rmKg > 0
                    );
                    const latest = loaded[loaded.length - 1];
                    const onRecord =
                      latest !== undefined &&
                      latest.e1rmKg >= lift.bestE1rmKg - 1e-6;
                    const best = liftWeightParts(lift.bestE1rmKg, unitSystem)[0]!;
                    return (
                      <li key={lift.name} className="is-interactive">
                        <button
                          type="button"
                          className="strength-lift-button"
                          aria-label={`Explore ${lift.name}`}
                          onClick={() => openExercise(lift.name)}
                        >
                          <div className="strength-lift-main">
                            <span className="strength-lift-name">{lift.name}</span>
                            <span className="strength-lift-meta">
                              {lift.sessions} session
                              {lift.sessions === 1 ? "" : "s"} ·{" "}
                              {formatSets(lift.sets)} sets
                            </span>
                          </div>
                          <Sparkline
                            values={loaded.map((point) => point.e1rmKg)}
                            tone={tone}
                            record={onRecord}
                          />
                          <div className="strength-lift-figures">
                            <strong>
                              {best.value}
                              {best.unit ? <em>{best.unit}</em> : null}
                            </strong>
                            <span className="strength-lift-change" data-tone={tone}>
                              {trend === undefined ? (
                                "One session"
                              ) : tone === "flat" ? (
                                "No change"
                              ) : (
                                <>
                                  {tone === "up" ? (
                                    <ArrowUpRight size={12} aria-hidden="true" />
                                  ) : (
                                    <ArrowDownRight size={12} aria-hidden="true" />
                                  )}
                                  {formatLiftWeight(Math.abs(trend), unitSystem)}
                                </>
                              )}
                            </span>
                          </div>
                          <ChevronRight
                            className="strength-lift-open-icon"
                            size={15}
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="panel strength-card strength-mix-card">
              <div className="strength-card-head">
                <div>
                  <h3>Where the work went</h3>
                  <p>Share of your working sets.</p>
                </div>
              </div>

              {balanceTotal <= 0 ? (
                <p className="strength-empty">
                  Nothing to sort yet — sets appear here once we recognise the
                  exercise.
                </p>
              ) : (
                <>
                  <div className="strength-mix-bar" aria-hidden="true">
                    {balanceSegments
                      .filter((segment) => segment.share > 0)
                      .map((segment) => (
                        <span
                          key={segment.key}
                          data-pattern={segment.key}
                          style={{ flexGrow: segment.share }}
                        />
                      ))}
                  </div>
                  <ul className="strength-mix-legend">
                    {balanceSegments.map((segment) => (
                      <li key={segment.key}>
                        <i data-pattern={segment.key} aria-hidden="true" />
                        <span>{segment.label}</span>
                        <strong>{Math.round(segment.share * 100)}%</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="strength-mix-note">
                    Helper muscles count for part of a set, so a bench press
                    mostly counts as pushing.
                    {analytics.genericSets > 0
                      ? " COROS Full Body sets are left out because they do not identify a specific muscle."
                      : ""}
                    {analytics.mobilitySets > 0 || analytics.unmappedSets > 0
                      ? " Warm-ups, stretching and moves we don't recognise are left out."
                      : ""}
                  </p>
                </>
              )}
            </section>
          </div>

          <section className="panel strength-card strength-sessions-card">
            <div className="strength-card-head">
              <div>
                <h3>Recent sessions</h3>
                <p>Your last few times in the gym.</p>
              </div>
            </div>

            <ul className="strength-session-list">
              {recentSessions.map((session) => {
                const detail = session.detail.summary;
                const volume = session.detail.exercises.reduce(
                  (total, exercise) =>
                    total +
                    exercise.entries.reduce(
                      (sum, entry) => sum + entry.reps * entry.weightKg,
                      0
                    ),
                  0
                );
                return (
                  <li key={session.activityId}>
                    <div className="strength-session-head">
                      <strong>{session.name?.trim() || "Strength session"}</strong>
                      <div className="strength-session-meta">
                        {sessionSourceLabel(session) ? (
                          <span className="strength-session-source">
                            {sessionSourceLabel(session)}
                          </span>
                        ) : null}
                        <span>{formatSessionDate(session.startTime)}</span>
                      </div>
                    </div>
                    <p className="strength-session-facts">
                      <span>{detail.sets} sets</span>
                      <span>
                        {volume > 0
                          ? formatTotalWeight(volume, unitSystem)
                          : "Bodyweight"}
                      </span>
                      <span>{formatSpan(detail.durationSec)}</span>
                    </p>
                    <div className="strength-session-chips">
                      {session.detail.exercises.slice(0, 3).map((exercise, index) => {
                        const name = explorerExerciseName(
                          exercise.nameKey,
                          exercise.rawName
                        );
                        return (
                          <button
                            type="button"
                            className="strength-session-chip-button"
                            key={`${exercise.nameKey}-${index}`}
                            onClick={() => openExercise(name)}
                          >
                            {exercise.sets}× {name}
                          </button>
                        );
                      })}
                      {session.detail.exercises.length > 3 ? (
                        <span className="is-more">
                          +{session.detail.exercises.length - 3} more
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
      {selectedExercise ? (
        <ExerciseExplorer
          exercise={selectedExercise}
          exercises={analytics.exercises}
          sessions={sessions}
          unitSystem={unitSystem}
          onSelect={openExercise}
          onClose={closeExercise}
        />
      ) : null}
    </section>
  );
}
