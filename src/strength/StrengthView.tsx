import { formatNumber, t, getLocale, useLanguage } from "../i18n/training";
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
  StravaStatus,
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
import { StravaConnection } from "./StravaConnection";
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
import {
  defineSelectionPreference,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";

interface StrengthViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
  /** Dev view unlocks the generated sample history. */
  showDevelopmentTools?: boolean;
  initialAccountSetup?: boolean;
}

// Phrases include their preposition so each language can choose its own ("au cours des", "在…内").
const WINDOW_OPTIONS = [
  { days: 30, label: "30 days", phrase: "in the last 30 days" },
  { days: 90, label: "3 months", phrase: "in the last 3 months" },
  { days: 180, label: "6 months", phrase: "in the last 6 months" },
  { days: 365, label: "1 year", phrase: "in the last year" }
];

const METRIC_OPTIONS: { id: HeatMetric; label: string }[] = [
  { id: "sets", label: "Sets" },
  { id: "volume", label: "Volume" },
  { id: "time", label: "Time" }
];

const STRENGTH_DAYS_PREFERENCE = defineSelectionPreference<number>({
  key: "strength.days",
  defaultValue: 90,
  validate: selectionIsOneOf([30, 90, 180, 365])
});

const STRENGTH_SOURCE_PREFERENCE =
  defineSelectionPreference<StrengthDataSource>({
    key: "strength.source",
    defaultValue: "combined",
    validate: selectionIsOneOf(["combined", "hevy", "strava", "coros"])
  });

const STRENGTH_BODY_VIEW_PREFERENCE = defineSelectionPreference<BodyView>({
  key: "strength.bodyView",
  defaultValue: "front",
  validate: selectionIsOneOf(["front", "back"])
});

const STRENGTH_METRIC_PREFERENCE = defineSelectionPreference<HeatMetric>({
  key: "strength.metric",
  defaultValue: "sets",
  validate: selectionIsOneOf(["sets", "volume", "time"])
});

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
    return t("Unknown date");
  }
  const date = new Date(startTime * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(getLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  });
}

function formatSyncTime(value?: string): string {
  if (!value) return t("Not synced yet");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Not synced yet")
    : t("Last synced {{value1}}", { value1: String(date.toLocaleString(getLocale(), {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })) });
}

function sessionSourceLabel(session: StrengthSession): string | undefined {
  const ids = session.sourceIds;
  if (ids) {
    const providers = [
      ids.hevy ? "Hevy" : undefined,
      ids.coros ? "COROS" : undefined,
      ids.strava ? "Strava" : undefined
    ].filter(Boolean);
    if (providers.length > 0) return providers.join(" + ");
  }
  if (session.source === "hevy") return "Hevy";
  if (session.source === "coros") return "COROS";
  if (session.source === "strava") return "Strava";
  return undefined;
}

interface ConnectedSources {
  coros: boolean;
  hevy: boolean;
  strava: boolean;
}

/** Combined once two sources are linked; otherwise the one that is. */
function preferredSource(connected: ConnectedSources): StrengthDataSource {
  const linked = Object.values(connected).filter(Boolean).length;
  if (linked >= 2) return "combined";
  if (connected.hevy) return "hevy";
  if (connected.strava) return "strava";
  return "coros";
}

function sourceIsAvailable(
  source: StrengthDataSource,
  connected: ConnectedSources
): boolean {
  if (source === "combined") {
    return Object.values(connected).filter(Boolean).length >= 2;
  }
  return connected[source];
}

function pendingNotice(pending: { coros: number; strava: number }): string | null {
  const total = pending.coros + pending.strava;
  if (total <= 0) return null;
  const sessions = `${total} more session${total === 1 ? "" : "s"}`;
  if (pending.coros > 0 && pending.strava > 0) {
    return `Reading ${sessions} from COROS and Strava. The map fills in as they arrive.`;
  }
  if (pending.coros > 0) {
    return `Reading ${sessions} from COROS. The map fills in as they arrive.`;
  }
  return `Reading notes for ${sessions} from Strava.`;
}

/**
 * A session with no set breakdown (Strava's API never shares one) keeps the
 * same three-fact line as a lifting session; the rest sits in the chip row.
 */
function summaryOnlyFacts(session: StrengthSession): { facts: string[]; chips: string[] } {
  const summary = session.detail.summary;
  const facts = [formatSpan(summary.durationSec || session.duration || 0)];
  const avgHr = session.avgHr ?? summary.avgHr;
  if (avgHr) facts.push(`${avgHr} bpm avg`);
  const calories = session.calories ?? summary.calories;
  if (calories) facts.push(`${Math.round(calories).toLocaleString(getLocale())} kcal`);
  const chips = [session.sportName ?? "Gym session"];
  if (session.strava?.relativeEffort) {
    chips.push(`Relative Effort ${Math.round(session.strava.relativeEffort)}`);
  }
  if (session.strava?.perceivedExertion) {
    chips.push(`Felt ${session.strava.perceivedExertion}/10`);
  }
  return { facts, chips };
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
        value: tonnes >= 10 ? Math.round(tonnes).toLocaleString(getLocale()) : formatNumber(tonnes, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        unit: t("tonnes")
      }
    ];
  }
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [{ value: Math.round(display).toLocaleString(getLocale()), unit: weightUnit(unitSystem) }];
}

/** A single lift keeps its half-kilo; a season's tonnage does not. */
function liftWeightParts(kg: number, unitSystem: UnitSystem): FigurePart[] {
  const display = kilogramsToDisplayWeight(kg, unitSystem);
  return [
    {
      value: Number.isInteger(display)
        ? display.toLocaleString(getLocale())
        : formatNumber(display, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
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
    return t("About {{value1}} a week", { value1: String(formatNumber(sessionsPerWeek, { minimumFractionDigits: 1, maximumFractionDigits: 1 })) });
  }
  return t("About one every {{value1}} days", { value1: String(Math.round(7 / sessionsPerWeek)) });
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
      label: new Date(at).toLocaleDateString(getLocale(), {
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
  useLanguage();
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
  useLanguage();
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
  }, [values, getLocale()]);

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
  showDevelopmentTools = false,
  initialAccountSetup = false
}: StrengthViewProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const corosConnected = Boolean(status?.authenticated);
  const { colors } = useChartColors();
  const { theme } = useTheme();
  const ember = theme === "paper" ? EMBER.paper : EMBER.dark;

  const [days, setDays] = useSelectionPreference(STRENGTH_DAYS_PREFERENCE);
  const [source, setSource, sourcePreference] = useSelectionPreference(
    STRENGTH_SOURCE_PREFERENCE
  );
  const [hevyStatus, setHevyStatus] = useState<HevyStatus | null>(null);
  const [hevyStatusLoading, setHevyStatusLoading] = useState(true);
  const [hevyDialogOpen, setHevyDialogOpen] = useState(initialAccountSetup);
  const [hevyApiKey, setHevyApiKey] = useState("");
  const [hevyBusy, setHevyBusy] = useState(false);
  const [hevyDialogError, setHevyDialogError] = useState<string | null>(null);
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [stravaDialogOpen, setStravaDialogOpen] = useState(false);
  const [loadedSessions, setLoadedSessions] = useState<StrengthSession[]>([]);
  const [sampleMode, setSampleMode] = useState(false);
  const [pending, setPending] = useState({ coros: 0, strava: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [view, setView] = useSelectionPreference(
    STRENGTH_BODY_VIEW_PREFERENCE
  );
  const [viewRequest, setViewRequest] = useState(0);
  const [metric, setMetric] = useSelectionPreference(
    STRENGTH_METRIC_PREFERENCE
  );
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(null);
  const [selectedExerciseName, setSelectedExerciseName] = useState<string | null>(null);
  // Hover remains a transient highlight on the mannequin. The right-hand
  // panel changes only after an explicit click, so it never jumps while the
  // pointer crosses muscle shells or ranking rows.
  const [figureHover, setFigureHover] = useState<MuscleId | null>(null);
  const [listHover, setListHover] = useState<MuscleId | null>(null);
  const syncSequenceRef = useRef(0);
  const sourceInitializedRef = useRef(sourcePreference.restored);
  const hevyConnected = Boolean(hevyStatus?.connected);
  const stravaConnected = Boolean(stravaStatus?.connected);
  const anyConnected = corosConnected || hevyConnected || stravaConnected;
  const connectedSources = useMemo<ConnectedSources>(
    () => ({ coros: corosConnected, hevy: hevyConnected, strava: stravaConnected }),
    [corosConnected, hevyConnected, stravaConnected]
  );

  useEffect(() => {
    let active = true;
    setHevyStatusLoading(true);
    // Both provider checks settle before the source is chosen, so a linked
    // Strava never loses the first pick to a still-loading Hevy check.
    void Promise.all([
      api.getHevyStatus().catch((caught: unknown) => {
        if (active) setError(toErrorMessage(caught));
        return { connected: false, includeWarmups: false } satisfies HevyStatus;
      }),
      api.getStravaStatus().catch(
        () =>
          ({ configured: false, connected: false, connecting: false, canReadPrivate: false }) satisfies StravaStatus
      )
    ]).then(([nextHevy, nextStrava]) => {
      if (!active) return;
      setHevyStatus(nextHevy);
      setStravaStatus(nextStrava);
      if (!sourceInitializedRef.current) {
        sourceInitializedRef.current = true;
        setSource(
          preferredSource({
            coros: corosConnected,
            hevy: nextHevy.connected,
            strava: nextStrava.connected
          })
        );
      }
      setHevyStatusLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, corosConnected]);

  useEffect(() => {
    if (hevyStatus === null || stravaStatus === null) return;
    setSource((current) =>
      sourceIsAvailable(current, connectedSources)
        ? current
        : preferredSource(connectedSources)
    );
  }, [connectedSources, hevyStatus, stravaStatus]);

  useEffect(() => {
    if (source !== "coros" && metric === "time") {
      setMetric("sets");
    }
  }, [metric, source]);

  useEffect(() => {
    if (!hevyDialogOpen && !stravaDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hevyDialogOpen && !hevyBusy) setHevyDialogOpen(false);
      if (stravaDialogOpen) setStravaDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [hevyBusy, hevyDialogOpen, stravaDialogOpen]);

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
      setNotices([]);

      const pendingOf = (history: { pending: number; pendingBySource?: { coros?: number; strava?: number } }) => ({
        coros: history.pendingBySource?.coros ?? history.pending,
        strava: history.pendingBySource?.strava ?? 0
      });

      try {
        let result = await api.syncStrengthHistory({ days, force, source });
        if (syncSequenceRef.current !== sequence) {
          return;
        }
        setLoadedSessions(result.sessions);
        setPending(pendingOf(result));
        setWarnings(result.warnings ?? []);
        setNotices(result.notices ?? []);

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
          setPending(pendingOf(next));
          setWarnings(next.warnings ?? []);
          setNotices(next.notices ?? []);
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
          if (source === "combined" || source === "hevy") {
            void api.getHevyStatus().then(setHevyStatus).catch(() => undefined);
          }
          if (source === "combined" || source === "strava") {
            void api.getStravaStatus().then(setStravaStatus).catch(() => undefined);
          }
        }
      }
    },
    // The link flags re-run the sync when a source joins an unchanged selection,
    // such as Strava folding into an existing Combined view.
    [api, anyConnected, days, hevyConnected, hevyStatusLoading, source, stravaConnected]
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
        t("Disconnect Hevy and erase its cached workouts from this device?")
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
      setPending({ coros: 0, strava: 0 });
      setSource(preferredSource({ ...connectedSources, hevy: false }));
      if (!corosConnected && !stravaConnected) setHevyDialogOpen(false);
    } catch (caught) {
      setHevyDialogError(toErrorMessage(caught));
    } finally {
      setHevyBusy(false);
    }
  }, [api, connectedSources, corosConnected, stravaConnected]);

  const changeStravaStatus = useCallback(
    (next: StravaStatus) => {
      // Undefined while the first status check is still out: the panel's own
      // first report is then not a change, and must not override the
      // restored source.
      const wasConnected = stravaStatus?.connected;
      setStravaStatus(next);
      if (next.connected && wasConnected === false) {
        // A fresh link is what the user came for: show it alongside the rest.
        setSource(preferredSource({ ...connectedSources, strava: true }));
      } else if (!next.connected && wasConnected === true) {
        syncSequenceRef.current += 1;
        setLoadedSessions([]);
        setWarnings([]);
        setNotices([]);
        setPending({ coros: 0, strava: 0 });
      }
    },
    [connectedSources, stravaStatus?.connected]
  );

  // Sample mode swaps in a generated history so the page can be worked on
  // without a populated account; nothing about it touches the API or the cache.
  const sessions = useMemo(
    () => (sampleMode ? buildSampleStrengthSessions(days) : loadedSessions),
    [sampleMode, days, loadedSessions, getLocale()]
  );

  const analytics = useMemo(
    () => buildStrengthAnalytics(sessions, days),
    [sessions, days, getLocale()]
  );

  const selectedExercise = selectedExerciseName
    ? analytics.exercises.find((exercise) => exercise.name === selectedExerciseName) ?? null
    : null;
  const openExercise = useCallback((name: string) => setSelectedExerciseName(name), []);
  const closeExercise = useCallback(() => setSelectedExerciseName(null), []);

  const pendingText = pendingNotice(pending);
  // Strava gym sessions arrive without sets; say why they leave the map blank.
  const summaryOnlyStravaSessions = sessions.filter(
    (session) => session.strava && session.detail.exercises.length === 0
  ).length;

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
    [analytics.weeks, days, getLocale()]
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
    [weekSeries, unitSystem, usesWeights, getLocale()]
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
  }, [weekSeries, usesWeights, getLocale()]);

  const averageValue = usesWeights
    ? Math.round(kilogramsToDisplayWeight(average.kg, unitSystem))
    : Math.round(average.sets);

  const change = useMemo(
    () =>
      compareRecentWeeks(weekSeries, (week) =>
        usesWeights ? week.volumeKg : week.sets
      ),
    [weekSeries, usesWeights, getLocale()]
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
    [analytics.exercises, getLocale()]
  );

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
        .slice(0, MAX_RECENT_SESSIONS),
    [sessions, getLocale()]
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
      label: t("Sessions"),
      parts: [{ value: String(summary.sessions) }],
      caption: cadencePhrase(summary.sessionsPerWeek) || "Nothing logged yet"
    },
    usesWeights
      ? {
          key: "lifted",
          label: t("Weight lifted"),
          parts: totalWeightParts(summary.volumeKg, unitSystem),
          caption: t("Across {{count}} sets", { count: Math.round(summary.sets).toLocaleString(getLocale()) })
        }
      : {
          key: "sets",
          label: t("Sets"),
          parts: [{ value: Math.round(summary.sets).toLocaleString(getLocale()) }],
          caption: t("{{count}} reps", { count: Math.round(summary.reps).toLocaleString(getLocale()) })
        },
    {
      key: "time",
      label: t("Time lifting"),
      parts: durationParts(summary.durationSec),
      caption: hasSessions
        ? t("About {{duration}} a session", { duration: formatSpan(summary.durationSec / summary.sessions) })
        : t("No time logged")
    },
    {
      key: "heaviest",
      label: t("Heaviest lift"),
      parts: summary.heaviestLift
        ? liftWeightParts(summary.heaviestLift.weightKg, unitSystem)
        : [{ value: "—" }],
      caption: summary.heaviestLift
        ? `${summary.heaviestLift.name} × ${summary.heaviestLift.reps}`
        : t("Nothing with weight on it yet")
    }
  ];

  const axisFormatter = (value: number) => {
    if (!usesWeights) {
      return String(value);
    }
    return value >= 1000
      ? unitSystem === "metric"
        ? `${Math.round(value / 1000)} ${t("tonnes")}`
        : `${Math.round(value / 1000)}k`
      : String(value);
  };

  const averageLabel = usesWeights
    ? formatTotalWeight(average.kg, unitSystem)
    : t("{{value1}} sets", { value1: String(Math.round(average.sets)) });

  const sampleButton = showDevelopmentTools ? (
    <button
      type="button"
      className="strength-sample-button"
      onClick={() => setSampleMode(true)}
    >
      <FlaskConical size={14} aria-hidden="true" />
      {t("Preview with sample data")} </button>
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
            <p className="eyebrow">{t("Strength source")}</p>
            <h2 id="strength-hevy-title">
              {hevyConnected ? t("Hevy connected") : t("Connect Hevy")}
            </h2>
          </div>
          <button
            type="button"
            className="strength-hevy-close"
            aria-label={t("Close Hevy settings")}
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
                <strong>{hevyStatus?.displayName || t("Hevy account")}</strong>
                <span>{formatSyncTime(hevyStatus?.lastSyncedAt)}</span>
              </div>
              {hevyStatus?.profileUrl ? (
                <a href={hevyStatus.profileUrl} target="_blank" rel="noreferrer">
                  {t("Profile")} <ExternalLink size={13} aria-hidden="true" />
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
                <strong>{t("Include warm-up sets")}</strong>
                <small>{t("Count warm-ups in sets, volume, and lift records.")}</small>
              </span>
            </label>
            <p className="strength-hevy-privacy">
              {t("CorosLink reads completed workouts only. It never writes to Hevy or sends Hevy workouts to COROS.")} </p>
            <footer>
              <button
                type="button"
                className="secondary-button danger"
                disabled={hevyBusy}
                onClick={() => void disconnectHevyAccount()}
              >
                {t("Disconnect and erase cache")} </button>
              <button
                type="button"
                className="primary-button"
                disabled={hevyBusy}
                onClick={() => setHevyDialogOpen(false)}
              >
                {t("Done")} </button>
            </footer>
          </>
        ) : (
          <form onSubmit={connectHevyAccount}>
            <p>
              {t("Hevy's developer API requires Hevy Pro. Create a key in your Hevy web settings, then paste it below.")} </p>
            <a
              className="strength-hevy-developer-link"
              href="https://hevy.com/settings?developer"
              target="_blank"
              rel="noreferrer"
            >
              {t("Open Hevy developer settings")} <ExternalLink size={14} aria-hidden="true" />
            </a>
            <label className="field">
              <span>{t("Hevy API key")}</span>
              <input
                type="password"
                value={hevyApiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("Paste API key")}
                disabled={hevyBusy}
                onChange={(event) => setHevyApiKey(event.target.value)}
              />
            </label>
            <p className="strength-hevy-privacy">
              {t("The key is encrypted with your operating system's credential storage and is never exposed to the page after connection.")} </p>
            <button
              type="submit"
              className="primary-button"
              disabled={hevyBusy || !hevyApiKey.trim()}
            >
              {hevyBusy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              {t("Connect Hevy")} </button>
          </form>
        )}

        {hevyDialogError ? (
          <p className="strength-hevy-error" role="alert">{hevyDialogError}</p>
        ) : null}
      </section>
    </div>
  ) : null;

  const stravaDialog = stravaDialogOpen ? (
    <div
      className="strength-hevy-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setStravaDialogOpen(false);
      }}
    >
      <section
        className="strength-hevy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-strava-title"
      >
        <header>
          <div>
            <p className="eyebrow">{t("Strength source")}</p>
            <h2 id="strength-strava-title">
              {stravaConnected ? t("Strava connected") : t("Connect Strava")}
            </h2>
          </div>
          <button
            type="button"
            className="strength-hevy-close"
            aria-label={t("Close Strava settings")}
            onClick={() => setStravaDialogOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <StravaConnection
          api={api}
          onStatusChange={changeStravaStatus}
          onDone={() => setStravaDialogOpen(false)}
        />
      </section>
    </div>
  ) : null;

  // The controls only appear once there is something to control: on the
  // connect screen a window picker and a Refresh button would both be dead.
  const renderHeader = (withControls: boolean) => (
    <header className="strength-header">
      <div className="strength-title">
        <h2>{t("Strength")}</h2>
        <p>
          {!withControls
            ? t("Your lifting, muscle by muscle.")
            : hasSessions
              ? t("You trained {{value1}} {{value2}} {{value3}}.", { value1: String(summary.sessions), value2: String(summary.sessions === 1 ? t("time", undefined, "sessionCount") : t("times")), value3: t(activeWindow.phrase) })
              : t("Your lifting {{value1}}, muscle by muscle.", { value1: t(activeWindow.phrase) })}
        </p>
      </div>
      <div className="strength-header-controls">
        {withControls ? (
          <>
          <div className="strength-segment strength-source" role="group" aria-label={t("Strength source")}>
            {(
              [
                ["combined", "Combined", !sourceIsAvailable("combined", connectedSources)],
                ["hevy", "Hevy", !hevyConnected],
                ["strava", "Strava", !stravaConnected],
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
                <span className="strength-segment-label">{t(label)}</span>
              </button>
            ))}
          </div>
          <div className="strength-segment strength-window" role="group" aria-label={t("Time covered")}>
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={days === option.days ? "is-active" : ""}
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                <span className="strength-segment-label">{t(option.label)}</span>
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
              {t("Refresh")} </button>
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
                {t("Connect Hevy")} </>
            )}
          </button>
          <button
            type="button"
            className="strength-action"
            onClick={() => setStravaDialogOpen(true)}
          >
            {stravaConnected ? (
              <>
                <span className="strength-hevy-dot" aria-hidden="true" />
                <Settings2 size={14} aria-hidden="true" />
                Strava
              </>
            ) : (
              <>
                <Link2 size={14} aria-hidden="true" />
                {t("Connect Strava")}</>
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
          {t("Checking strength connections…")} </p>
        {hevyDialog}
        {stravaDialog}
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
          <h3>{t("Connect a strength source")}</h3>
          <p>{t("Import completed workouts from Hevy, gym sessions from Strava, read sessions from COROS Training Hub, or connect several for one combined history.")}</p>
          <div className="strength-connect-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setHevyDialogOpen(true)}
            >
              <Link2 size={16} aria-hidden="true" />
              {t("Connect Hevy")} </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStravaDialogOpen(true)}
            >
              <Link2 size={16} aria-hidden="true" />
              {t("Connect Strava")}</button>
            <button type="button" className="secondary-button" onClick={onOpenTraining}>
              {t("Open Training Hub")} </button>
          </div>
        </section>

        {sampleButton ? (
          <div className="strength-sample-cta">{sampleButton}</div>
        ) : null}
        {hevyDialog}
        {stravaDialog}
      </section>
    );
  }

  return (
    <section className="strength-view">
      {renderHeader(true)}
      {hevyDialog}
      {stravaDialog}

      {sampleMode ? (
        <p className="strength-notice is-sample" role="status">
          <FlaskConical size={14} aria-hidden="true" />
          {t("Showing generated sample data, not your training.")} <button type="button" onClick={() => setSampleMode(false)}>
            {t("Exit preview")} </button>
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
              {warning} {t("Showing the most recent cached workouts instead.")} </p>
          ))
        : null}

      {!sampleMode
        ? notices.map((notice) => (
            <p className="strength-notice" role="status" key={notice}>
              <Info size={14} aria-hidden="true" />
              {notice}
            </p>
          ))
        : null}

      {pendingText && !sampleMode ? (
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          {pendingText}
        </p>
      ) : null}

      {hasSessions && genericSetCount > 0 ? (
        <p className="strength-notice is-attribution" role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {t("COROS recorded {{value1}} working {{value2}} only as Full Body, so {{value3}} excluded from the map. Specific attribution is available for {{value4}} of {{value5}} working sets.", { value1: String(genericSetCount.toLocaleString(getLocale())), value2: String(genericSetCount === 1 ? t("set") : t("sets")), value3: String(genericSetCount === 1 ? t("it is") : t("they are")), value4: String(attributedSetCount.toLocaleString(getLocale())), value5: String(workingSetCount.toLocaleString(getLocale())) })}
          </span>
        </p>
      ) : null}

      {hasSessions && summaryOnlyStravaSessions > 0 ? (
        <p className="strength-notice is-attribution" role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {summaryOnlyStravaSessions === 1
              ? t("1 session comes from Strava alone. Strava's API does not share the Exercises tab, so it counts toward sessions and time but not sets or the map.")
              : t("{{count}} sessions come from Strava alone. Strava's API does not share the Exercises tab, so they count toward sessions and time but not sets or the map.", { count: summaryOnlyStravaSessions.toLocaleString(getLocale()) })}
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
            <div className="strength-segmented" role="group" aria-label={t("Body view")}>
              <button
                type="button"
                className={view === "front" ? "is-active" : ""}
                aria-pressed={view === "front"}
                onClick={() => requestView("front")}
              >
                {t("Front")} </button>
              <button
                type="button"
                className={view === "back" ? "is-active" : ""}
                aria-pressed={view === "back"}
                onClick={() => requestView("back")}
              >
                {t("Back", undefined, "bodyView")} </button>
            </div>
            <button
              type="button"
              className="strength-flip"
              aria-label={t("Flip the figure")}
              onClick={() => requestView(view === "front" ? "back" : "front")}
            >
              <RotateCw size={15} aria-hidden="true" />
            </button>
            <div className="strength-segmented is-quiet" role="group" aria-label={t("Heat metric")}>
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
                  {t(option.label)}
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
            <span>{t("Light")}</span>
            <span className="strength-legend-ramp">
              {[1, 2, 3, 4, 5].map((level) => (
                <i key={level} data-level={level} />
              ))}
            </span>
            <span>{t("Hammered")}</span>
          </div>
        </section>

        <section className="panel strength-muscle-panel">
          {hasSessions && workingSetCount > 0 && analytics.attributedSets <= 0 ? (
            <div className="muscle-panel is-unattributed">
              <span className="muscle-panel-unattributed-icon" aria-hidden="true">
                <Info size={22} />
              </span>
              <p className="eyebrow">{t("Muscle attribution")}</p>
              <h3>{t("No specific muscle data")}</h3>
              <p>
                {genericSetCount > 0
                  ? t("COROS recorded {{value1}} working {{value2}} only as Full Body. Session totals remain available, but the map stays neutral because no specific muscles were identified.", { value1: String(genericSetCount.toLocaleString(getLocale())), value2: String(genericSetCount === 1 ? t("set") : t("sets")) })
                  : t("None of the exercises in this window could be matched to specific muscles. Session totals remain available, but the map stays neutral.")}
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
          <h3>{t("No strength sessions {{value1}}", { value1: t(activeWindow.phrase) })}</h3>
          <p>
            {t("Sessions appear here a few minutes after they sync from your watch. Try a longer stretch of time if you know you've been lifting.")} </p>
        </section>
      ) : (
        <>
          <section className="strength-summary" aria-label={t("Your training so far")}>
            {summaryItems.map((item) => (
              <div key={item.key} className="strength-summary-item">
                <p className="strength-summary-label">{t(item.label)}</p>
                <Figure parts={item.parts} />
                <p className="strength-summary-caption">{t(item.caption)}</p>
              </div>
            ))}
          </section>

          <section className="panel strength-card strength-week-card">
            <div className="strength-card-head">
              <div>
                <h3>{usesWeights ? t("Weight lifted and sets each week") : t("Sets each week")}</h3>
                <p>
                  {usesWeights
                    ? t("Bars show total weight lifted; the line tracks your sets.")
                    : t("Every bar is every set you did that week.")}
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
                    ? t("About the same as the {{value1}} weeks before", { value1: String(change.weeks) })
                    : t("{{value1}}% {{value2}} than the {{value3}} weeks before", { value1: String(Math.abs(Math.round(change.percent))), value2: String(change.percent > 0 ? t("more") : t("less")), value3: String(change.weeks) })}
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
                          <span>{t("Week of")} {(props.label == null ? props.label : t(String(props.label)))}</span>
                          <strong>
                            {point.sessions === 0
                              ? t("No sessions")
                              : usesWeights
                                ? formatTotalWeight(point.volumeKg, unitSystem)
                                : t("{{value1}} sets", { value1: String(point.sets) })}
                          </strong>
                          {point.sessions > 0 ? (
                            <span>
                              {point.sessions} {t("session")} {point.sessions === 1 ? "" : "s"}
                              {usesWeights ? t(" · {{value1}} sets", { value1: String(point.sets) }) : ""}
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
                {t("Your average week:")} {averageLabel}
              </p>
            ) : null}
          </section>

          <div className="strength-columns">
            <section className="panel strength-card strength-lifts-card">
              <div className="strength-card-head">
                <div>
                  <h3>{t("Your main lifts")}</h3>
                  <p>
                    {t("The most you could lift for one rep, estimated from your best set.")} </p>
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
                    {t("Explore all")} </button>
                ) : null}
              </div>

              {mainLifts.length === 0 ? (
                <p className="strength-empty">
                  {t("Nothing to estimate yet — this needs sets with weight on them.")} </p>
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
                          aria-label={t("Explore {{value1}}", { value1: String(lift.name) })}
                          onClick={() => openExercise(lift.name)}
                        >
                          <div className="strength-lift-main">
                            <span className="strength-lift-name">{lift.name}</span>
                            <span className="strength-lift-meta">
                              {lift.sessions} {t("session")} {lift.sessions === 1 ? "" : "s"} ·{" "}
                              {formatSets(lift.sets)} {t("sets")} </span>
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
                                t("One session")
                              ) : tone === "flat" ? (
                                t("No change")
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
                  <h3>{t("Where the work went")}</h3>
                  <p>{t("Share of your working sets.")}</p>
                </div>
              </div>

              {balanceTotal <= 0 ? (
                <p className="strength-empty">
                  {t("Nothing to sort yet — sets appear here once we recognise the exercise.")} </p>
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
                        <span>{t(segment.label)}</span>
                        <strong>{Math.round(segment.share * 100)}%</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="strength-mix-note">
                    {t("Helper muscles count for part of a set, so a bench press mostly counts as pushing.")} {analytics.genericSets > 0
                      ? t(" COROS Full Body sets are left out because they do not identify a specific muscle.")
                      : ""}
                    {analytics.mobilitySets > 0 || analytics.unmappedSets > 0
                      ? t(" Warm-ups, stretching and moves we don't recognise are left out.")
                      : ""}
                  </p>
                </>
              )}
            </section>
          </div>

          <section className="panel strength-card strength-sessions-card">
            <div className="strength-card-head">
              <div>
                <h3>{t("Recent sessions")}</h3>
                <p>{t("Your last few times in the gym.")}</p>
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
                const summaryOnly =
                  session.detail.exercises.length === 0 ? summaryOnlyFacts(session) : null;
                return (
                  <li key={session.activityId}>
                    <div className="strength-session-head">
                      <strong>{session.name?.trim() || t("Strength session")}</strong>
                      <div className="strength-session-meta">
                        {sessionSourceLabel(session) ? (
                          <span className="strength-session-source">
                            {sessionSourceLabel(session)}
                          </span>
                        ) : null}
                        <span>{formatSessionDate(session.startTime)}</span>
                      </div>
                    </div>
                    {summaryOnly ? (
                      <>
                        <p className="strength-session-facts">
                          {summaryOnly.facts.map((fact) => (
                            <span key={fact}>{fact}</span>
                          ))}
                        </p>
                        <div className="strength-session-chips">
                          {summaryOnly.chips.map((chip) => (
                            <span key={chip}>{chip}</span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="strength-session-facts">
                        <span>{detail.sets} {t("sets")}</span>
                        <span>
                          {volume > 0
                            ? formatTotalWeight(volume, unitSystem)
                            : t("Bodyweight")}
                        </span>
                        <span>{formatSpan(detail.durationSec)}</span>
                      </p>
                    )}
                    {session.detail.exercises.length > 0 ? (
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
                            +{session.detail.exercises.length - 3} {t("more")} </span>
                        ) : null}
                      </div>
                    ) : null}
                    {session.strava?.description ? (
                      <p className="strength-session-notes">{session.strava.description}</p>
                    ) : null}
                    {session.strava ? (
                      <a
                        className="strength-session-strava"
                        href={session.strava.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("View on Strava")}<ExternalLink size={12} aria-hidden="true" />
                      </a>
                    ) : null}
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
