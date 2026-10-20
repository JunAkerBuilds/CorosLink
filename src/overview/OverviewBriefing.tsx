import { t, useLanguage, getLocale, formatNumber } from "../i18n/tools";
import { lazy, Suspense, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, LogIn } from "lucide-react";
import {
  Barbell,
  Bicycle,
  CalendarDots,
  CalendarPlus,
  Heartbeat,
  MoonStars,
  Mountains,
  Path,
  PersonSimpleHike,
  PersonSimpleRun,
  PersonSimpleSki,
  PersonSimpleSwim,
  PersonSimpleWalk,
  Pulse,
  Timer,
  Waves,
  type Icon
} from "@phosphor-icons/react";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
  TrainingHubSportType,
  TrainingHubUpcomingWorkout
} from "../../electron/types";
import {
  activitySportFamily,
  scheduledSportFamily,
  WEEK_SPORT_FAMILY_META,
  type WeekSportFamily
} from "../calendar/weekSportBreakdown";
import { activityMovingSeconds } from "../../electron/activityTime";
import type { CorosLinkApi } from "../coroslink-api";
import type { PrimaryView } from "../navigation/primaryNav";
import { PRIMARY_NAV_ITEMS } from "../navigation/primaryNav";
import { useHiddenNavItems } from "../navigation/hiddenNav";
import {
  formatDurationSeconds,
  formatUpcomingWorkoutDate,
  formatUpcomingWorkoutVolumeDisplay,
  getLocalHappenDayKey,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import { isCyclingSportType, isSwimSportType, resolveSportName } from "../training/sportTypes";
import type { TrainingHubSnapshot } from "../training/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  formatSpeedValue
} from "../units/units";
import {
  buildBriefLine,
  buildReadiness,
  buildTodayPlan,
  buildVitals,
  buildWeekSummary,
  formatActivityWhen,
  formatSleepMinutes,
  latestActivity,
  type Readiness,
  type SleepNight,
  type TodayPlan,
  type Vitals,
  type WeekSummary
} from "./overviewBriefingModel";
import "./overviewBriefing.css";

// Leaflet stays out of the startup bundle until the latest route is on screen.
const LazyActivityCardRoute = lazy(() =>
  import("../training/components/ActivityCardRoute").then(({ ActivityCardRoute }) => ({
    default: ActivityCardRoute
  }))
);

// One shared request per activity, so returning to Overview reuses the route.
const routePreviews = new Map<string, Promise<TrainingHubActivityDetail>>();

function routePreviewLoader(api: CorosLinkApi) {
  return (activity: TrainingHubActivity): Promise<TrainingHubActivityDetail> => {
    const key = `${activity.sportType}:${activity.activityId}`;
    let request = routePreviews.get(key);
    if (!request) {
      request = api.getTrainingHubActivityDetail(activity.activityId, activity.sportType, activity);
      request.catch(() => routePreviews.delete(key));
      routePreviews.set(key, request);
    }
    return request;
  };
}

const INDOOR_SPORT_TYPES = new Set([101, 201, 300, 400, 402, 701, 800, 801]);

// Phosphor duotone throughout, like the launchpad and the Activities table.
const FAMILY_ICONS: Record<WeekSportFamily, Icon> = {
  run: PersonSimpleRun,
  trail: Mountains,
  hike: PersonSimpleHike,
  bike: Bicycle,
  swim: PersonSimpleSwim,
  strength: Barbell,
  cardio: Heartbeat,
  walk: PersonSimpleWalk,
  ski: PersonSimpleSki,
  water: Waves,
  climb: Mountains,
  multisport: Pulse,
  other: Pulse
};

// Recorded activities carry COROS activity codes (100 = run); planned workouts
// carry program codes (1 = run), so each side resolves its own family.
const planFamily = (workout: TrainingHubUpcomingWorkout) => scheduledSportFamily(workout.sportType);

function sportColor(family: WeekSportFamily): string {
  return `var(--sport-${WEEK_SPORT_FAMILY_META[family].color})`;
}

function sportStyle(family: WeekSportFamily): CSSProperties {
  return { "--overview-sport": sportColor(family) } as CSSProperties;
}

/** "Easy", "Intervals"… for runs, the sport itself for everything else. */
function workoutKind(workout: TrainingHubUpcomingWorkout, family: WeekSportFamily): string {
  return t(family === "run" ? inferUpcomingWorkoutCategory(workout.name) : WEEK_SPORT_FAMILY_META[family].label);
}

function workoutStats(workout: TrainingHubUpcomingWorkout, unitSystem: Parameters<typeof formatUpcomingWorkoutVolumeDisplay>[1]): string {
  const volume = formatUpcomingWorkoutVolumeDisplay(workout.volume, unitSystem);
  // COROS reports 0 TL for workouts it has not estimated; say nothing rather than zero.
  const load = workout.trainingLoad !== undefined && Number.isFinite(workout.trainingLoad) ? Math.round(workout.trainingLoad) : 0;
  return [volume !== "--" ? volume : undefined, load > 0 ? `${load} TL` : undefined].filter(Boolean).join(" · ");
}

function SportIcon({ family, size = 18 }: { family: WeekSportFamily; size?: number }) {
  useLanguage();
  const Glyph = FAMILY_ICONS[family];
  return <Glyph size={size} weight="duotone" aria-hidden="true" />;
}

/** Card header: a glyph tile lit in the card's hue, the title, and a quieter line under it. */
export function CardHead({
  icon,
  hue,
  title,
  subtitle,
  children
}: {
  icon: ReactNode;
  hue: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  useLanguage();
  return (
    <header className="overview-card-head">
      <div className="overview-card-title">
        <span className="overview-glyph" style={{ "--glyph": hue } as CSSProperties} aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="overview-card-name">{title}</p>
          {subtitle ? <p className="overview-card-sub">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </header>
  );
}

export interface OverviewBriefingData {
  readiness: Readiness;
  plan: TodayPlan;
  week: WeekSummary;
  brief?: string;
}

export function useOverviewBriefing(
  snapshot: TrainingHubSnapshot | null,
  activities: TrainingHubActivity[],
  workouts: TrainingHubUpcomingWorkout[]
): OverviewBriefingData {
  return useMemo(() => {
    const plan = buildTodayPlan(workouts);
    const readiness = buildReadiness(snapshot, plan.today);
    const week = buildWeekSummary(activities, workouts);
    return { readiness, plan, week, brief: buildBriefLine(readiness, plan, week) };
  }, [snapshot, activities, workouts, getLocale()]);
}

interface OverviewBriefingProps {
  api: CorosLinkApi | undefined;
  /** Null until the first Training Hub status check answers. */
  connected: boolean | null;
  loading: boolean;
  briefing: OverviewBriefingData;
  snapshot: TrainingHubSnapshot | null;
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  onNavigate: (view: PrimaryView) => void;
  onOpenActivity: (activity: TrainingHubActivity) => void;
}

export function OverviewBriefing({
  api,
  connected,
  loading,
  briefing,
  snapshot,
  activities,
  sportTypes,
  onNavigate,
  onOpenActivity
}: OverviewBriefingProps) {
  useLanguage();
  const hiddenNavItems = useHiddenNavItems();
  const trainingHidden = hiddenNavItems.has("training");
  const latest = useMemo(() => latestActivity(activities), [activities]);
  const scores = (snapshot?.racePredictor?.runScoreList ?? []).filter(
    (score) => score.predictSeconds !== undefined && score.predictSeconds > 0
  );

  if (connected === false) {
    return <OverviewConnectHero onConnect={() => onNavigate("training")} />;
  }

  if (connected === null || (loading && !snapshot && activities.length === 0)) {
    return (
      <div className="overview-briefing" aria-busy="true" aria-label={t("Loading your training")}>
        <div className="overview-row">
          <div className="panel overview-skeleton is-tall" />
          <div className="panel overview-skeleton is-tall" />
        </div>
      </div>
    );
  }

  return (
    <div className="overview-briefing">
      <div className="overview-row">
        <ReadinessCard readiness={briefing.readiness} snapshot={snapshot} onNavigate={onNavigate} />
        <TodayCard plan={briefing.plan} week={briefing.week} onNavigate={onNavigate} />
      </div>
      {latest || scores.length > 0 ? (
        <div className={`overview-row${latest && scores.length > 0 ? "" : " is-single"}`}>
          {latest ? (
            <LatestActivityCard
              api={api}
              activity={latest}
              sportTypes={sportTypes}
              onOpen={trainingHidden ? undefined : () => onOpenActivity(latest)}
            />
          ) : null}
          {scores.length > 0 ? (
            <RacePredictionsCard
              scores={scores}
              level={snapshot?.racePredictor?.staminaLevel}
              onOpen={trainingHidden ? undefined : () => onNavigate("training")}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function useMountedReveal(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return ready;
}

const RING_TICKS = 60;
const RING_RADIUS = 62;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Recovery dial styled like a watch bezel: lit ticks and an arc up to today's percent. */
function ReadinessRing({ percent, tone, ghost = false }: { percent?: number; tone: Readiness["tone"]; ghost?: boolean }) {
  useLanguage();
  const revealed = useMountedReveal();
  const ready = ghost || revealed;
  const ratio = (percent ?? 0) / 100;
  const lit = ready ? Math.round(ratio * RING_TICKS) : 0;
  return (
    <div
      className={`overview-ring tone-${tone}${ready ? " is-ready" : ""}${ghost ? " is-ghost" : ""}`}
      role={ghost ? undefined : "img"}
      aria-hidden={ghost || undefined}
      aria-label={ghost ? undefined : percent !== undefined ? t("{{p0}}% recovered", { p0: String(percent) }) : t("Recovery not synced yet")}
    >
      <svg viewBox="0 0 168 168" aria-hidden="true">
        <circle className="overview-ring-core" cx="84" cy="84" r="54" />
        <g className="overview-ring-ticks">
          {Array.from({ length: RING_TICKS }, (_, tick) => (
            <line
              key={tick}
              className={tick < lit ? "is-lit" : undefined}
              style={{ transitionDelay: `${tick * 12}ms` }}
              x1="84"
              y1="2"
              x2="84"
              y2={tick % 5 === 0 ? 10 : 7}
              transform={`rotate(${(tick * 360) / RING_TICKS} 84 84)`}
            />
          ))}
        </g>
        <circle className="overview-ring-track" cx="84" cy="84" r={RING_RADIUS} />
        <circle
          className="overview-ring-fill"
          cx="84"
          cy="84"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={ready ? RING_LENGTH * (1 - ratio) : RING_LENGTH}
          transform="rotate(-90 84 84)"
        />
      </svg>
      <div className="overview-ring-label">
        <strong>
          {percent !== undefined ? percent : "–"}
          {percent !== undefined ? <small>%</small> : null}
        </strong>
        <span>{t("Recovery", undefined, "overviewRing")}</span>
      </div>
    </div>
  );
}

/** Catmull-Rom through the readings, as cubic Béziers, clamped so the curve never leaves the band. */
function smoothPath(points: ReadonlyArray<readonly [number, number]>, top: number, bottom: number): string {
  const clamp = (value: number) => Math.min(bottom, Math.max(top, value));
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];
  let path = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = clamp(y1 + (y2 - y0) / 6);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = clamp(y2 - (y3 - y1) / 6);
    path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
  }
  return path;
}

const TREND_W = 220;
const TREND_H = 48;

/** The recent trend along the floor of a vital tile: the athlete's own reference
    dashed through it, and the latest reading pinned at the end. */
function TrendLine({ values, reference }: { values: number[]; reference?: number }) {
  const gradientId = useId();
  if (values.length < 2) return null;
  const all = reference !== undefined ? [...values, reference] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min;
  const top = 8;
  const bottom = TREND_H - 7;
  // A flat series sits mid-height instead of reading as a line on the floor.
  const y = (value: number) => (span < 1e-6 ? (top + bottom) / 2 : bottom - ((value - min) / span) * (bottom - top));
  const points = values.map((value, index) => [(index / (values.length - 1)) * TREND_W, y(value)] as const);
  const line = smoothPath(points, top - 3, bottom + 3);
  const last = points[points.length - 1];
  return (
    <>
      <svg className="overview-spark" viewBox={`0 0 ${TREND_W} ${TREND_H}`} aria-hidden="true" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--vital)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--vital)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="is-area" d={`${line} L${TREND_W},${TREND_H} L0,${TREND_H} Z`} fill={`url(#${gradientId})`} />
        {reference !== undefined ? (
          <line className="is-reference" x1="0" x2={TREND_W} y1={y(reference).toFixed(2)} y2={y(reference).toFixed(2)} />
        ) : null}
        <path d={line} />
      </svg>
      <i className="overview-spark-dot" style={{ top: `${(last[1] / TREND_H) * 100}%` }} aria-hidden="true" />
    </>
  );
}

const SLEEP_BAR_SLOTS = 14;

/** Recent nights as stacked stage bars (deep, REM, light from the floor up),
    newest on the right, with the week's average dashed across them. */
function SleepBars({ nights, reference }: { nights: SleepNight[]; reference?: number }) {
  if (nights.length < 2) return null;
  const peak = Math.max(...nights.map((night) => night.total), reference ?? 0);
  if (peak <= 0) return null;
  const blanks = Math.max(0, SLEEP_BAR_SLOTS - nights.length);
  return (
    <div className="overview-sleep-bars" aria-hidden="true">
      {reference !== undefined ? (
        <i className="overview-sleep-reference" style={{ bottom: `${(reference / peak) * 100}%` }} />
      ) : null}
      {Array.from({ length: blanks }, (_, index) => (
        <span key={`blank-${index}`} className="overview-sleep-night is-blank" />
      ))}
      {nights.map((night, index) => {
        const deep = night.deep ?? 0;
        const rem = night.rem ?? 0;
        const segments: Array<[string, number]> = deep + rem > 0
          ? [["deep", deep], ["rem", rem], ["light", Math.max(0, night.total - deep - rem)]]
          : [["total", night.total]];
        return (
          <span
            key={night.happenDay}
            className={`overview-sleep-night${index === nights.length - 1 ? " is-latest" : ""}`}
            style={{ height: `${Math.max(4, (night.total / peak) * 100)}%` }}
          >
            {segments.map(([stage, minutes]) => (
              <i key={stage} className={`is-${stage}`} style={{ flex: `${minutes} 1 0px` }} />
            ))}
          </span>
        );
      })}
    </div>
  );
}

type DeltaTone = "good" | "bad" | "flat";

function deltaTone(delta: number | undefined, higherIsBetter: boolean, threshold = 0.5): DeltaTone {
  if (delta === undefined || Math.abs(delta) < threshold) return "flat";
  return (delta > 0) === higherIsBetter ? "good" : "bad";
}

function formatDelta(delta: number | undefined, unit = ""): string | undefined {
  if (delta === undefined || !Number.isFinite(delta)) return undefined;
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return `±0${unit}`;
  return `${rounded > 0 ? "+" : "−"}${formatNumber(Math.abs(rounded))}${unit}`;
}

/** "1h 32m", or just "45m" under an hour, for stage lengths and sleep deltas. */
function formatShortMinutes(minutes: number): string {
  const rounded = Math.round(Math.abs(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

function formatSignedMinutes(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return "±0m";
  return `${rounded > 0 ? "+" : "−"}${formatShortMinutes(rounded)}`;
}

/** Native tooltip: the window behind the trend, in the athlete's numbers. */
function rangeTitle(history: number[], unit: string, format: (value: number) => string): string | undefined {
  if (history.length < 2) return undefined;
  const average = history.reduce((sum, value) => sum + value, 0) / history.length;
  const low = Math.min(...history);
  const high = Math.max(...history);
  const values = { count: history.length, average: format(average), low: format(low), high: format(high) };
  return unit === "nights"
    ? t("Last {{count}} nights · avg {{average}} · range {{low}} – {{high}}", values)
    : t("Last {{count}} days · avg {{average}} · range {{low}} – {{high}}", values);
}

/** How a reading sits against the athlete's own normal: the one coloured word on a tile. */
const VERDICTS: Record<"hrv" | "rhr" | "vo2", Record<DeltaTone, string>> = {
  hrv: { good: "Above baseline", flat: "On baseline", bad: "Below baseline" },
  rhr: { good: "Below usual", flat: "Steady", bad: "Elevated" },
  vo2: { good: "Improving", flat: "Holding", bad: "Slipping" }
};

type VitalHue = "sleep" | "hrv" | "rhr" | "vo2";

interface VitalSpec {
  hue: VitalHue;
  label: string;
  value?: string;
  unit?: string;
  verdict?: string;
  tone: DeltaTone;
  /** The coloured opening of the detail line (the delta), ahead of its context. */
  lead?: string;
  detail?: string;
  title?: string;
  trend?: ReactNode;
  /** Said in place of the reading when there is none, so the row explains itself. */
  emptyHint: string;
  action?: { label: string; onClick: () => void };
}

function vitalSpecs(vitals: Vitals, onNavigate: (view: PrimaryView) => void): VitalSpec[] {
  const { sleep, hrv, rhr, vo2max } = vitals;

  const sleepStale = sleep.value !== undefined && sleep.happenDay !== undefined && sleep.happenDay !== getLocalHappenDayKey();
  const sleepTone: DeltaTone = sleepStale
    ? "flat"
    : sleep.score !== undefined && sleep.score > 0
      ? sleep.score >= 80 ? "good" : sleep.score < 60 ? "bad" : "flat"
      : sleep.value !== undefined && sleep.value < 360
        ? "bad"
        : deltaTone(sleep.delta, true, 30);
  const sleepVerdict = sleep.value === undefined
    ? undefined
    : sleepStale
      ? t("Not synced")
      : sleep.score !== undefined && sleep.score > 0
        ? t("Score {{score}}", { score: Math.round(sleep.score) })
        : sleepTone === "bad" ? t("Short night") : sleepTone === "good" ? t("Long night") : t("Typical");
  const sleepStages = (sleep.deep ?? 0) + (sleep.rem ?? 0) > 0;
  const sleepDetail = sleepStale && sleep.happenDay
    ? { detail: t("Last synced {{time}}", { time: formatUpcomingWorkoutDate(sleep.happenDay) }) }
    : sleepStages
      ? { detail: t("Deep {{deep}} · REM {{rem}}", { deep: formatShortMinutes(sleep.deep ?? 0), rem: formatShortMinutes(sleep.rem ?? 0) }) }
      : sleep.delta !== undefined
        ? { lead: formatSignedMinutes(sleep.delta), detail: t(" vs 7-night avg") }
        : { detail: t("Last night") };

  const hrvTone = hrv.baseline !== undefined ? deltaTone(hrv.delta, true, 3) : "flat";
  const hrvDelta = formatDelta(hrv.delta, " ms");
  const hrvDetail = hrvDelta && hrv.baseline !== undefined
    ? { lead: hrvDelta, detail: t(" vs baseline {{value}}", { value: Math.round(hrv.baseline) }) }
    : hrv.nightsToBaseline !== undefined
      ? { detail: hrv.nightsToBaseline === 1 ? t("1 more night to a baseline") : t("{{count}} more nights to a baseline", { count: hrv.nightsToBaseline }) }
      : { detail: t("Baseline forming") };

  const rhrTone = deltaTone(rhr.delta, false, 2);
  const rhrDelta = formatDelta(rhr.delta, " bpm");
  const rhrDetail = rhrDelta && rhr.reference !== undefined
    ? { lead: rhrDelta, detail: t(" vs 7-day avg {{value}}", { value: Math.round(rhr.reference) }) }
    : { detail: rhr.history.length > 1 ? t("{{count}}-day trend", { count: rhr.history.length }) : t("First reading") };

  const vo2Tone = deltaTone(vo2max.delta, true, 0.3);
  const vo2Delta = vo2max.delta !== undefined && Math.abs(vo2max.delta) >= 0.1 ? formatDelta(vo2max.delta) : undefined;
  const level = vo2max.level !== undefined ? t("Running level {{p0}}", { p0: vo2max.level }) : undefined;
  const vo2Detail = vo2Delta
    ? { lead: vo2Delta, detail: vo2max.level !== undefined ? t(" this week · Level {{level}}", { level: vo2max.level }) : t(" this week") }
    : { detail: level ?? (vo2max.history.length > 1 ? t("{{count}}-day trend", { count: vo2max.history.length }) : t("First estimate")) };

  return [
    {
      hue: "sleep",
      label: t("Sleep"),
      value: sleep.value !== undefined ? formatSleepMinutes(sleep.value) : undefined,
      verdict: sleepVerdict,
      tone: sleepTone,
      ...sleepDetail,
      title: rangeTitle(sleep.history, "nights", formatSleepMinutes),
      trend: sleep.nights.length >= 2
        ? <SleepBars nights={sleep.nights} reference={sleep.reference} />
        : <TrendLine values={sleep.history} reference={sleep.reference} />,
      emptyHint: sleep.connected ? t("No nights synced yet · wear your watch to bed") : t("Connect COROS data access to bring in your nights"),
      action: sleep.connected ? undefined : { label: t("Connect"), onClick: () => onNavigate("training") }
    },
    {
      hue: "hrv",
      label: t("Sleep HRV"),
      value: hrv.value !== undefined ? String(Math.round(hrv.value)) : undefined,
      unit: "ms",
      verdict: hrv.value !== undefined && hrv.baseline !== undefined ? t(VERDICTS.hrv[hrvTone]) : undefined,
      tone: hrvTone,
      ...hrvDetail,
      title: rangeTitle(hrv.history, "nights", (value) => `${Math.round(value)} ms`),
      trend: <TrendLine values={hrv.history} reference={hrv.reference} />,
      emptyHint: hrv.nightsToBaseline !== undefined
        ? hrv.nightsToBaseline === 1
          ? t("Wear your watch for 1 more night to set a baseline")
          : t("Wear your watch for {{count}} more nights to set a baseline", { count: hrv.nightsToBaseline })
        : t("Wear your watch to bed to measure it")
    },
    {
      hue: "rhr",
      label: t("Resting HR"),
      value: rhr.value !== undefined ? String(Math.round(rhr.value)) : undefined,
      unit: "bpm",
      verdict: rhr.delta !== undefined ? t(VERDICTS.rhr[rhrTone]) : undefined,
      tone: rhrTone,
      ...rhrDetail,
      title: rangeTitle(rhr.history, "days", (value) => `${Math.round(value)} bpm`),
      trend: <TrendLine values={rhr.history} reference={rhr.reference} />,
      emptyHint: t("No resting readings yet")
    },
    {
      hue: "vo2",
      label: t("VO₂max"),
      value: vo2max.value !== undefined ? formatNumber(vo2max.value, { maximumFractionDigits: 1 }) : undefined,
      verdict: vo2max.delta !== undefined ? t(VERDICTS.vo2[vo2Tone]) : undefined,
      tone: vo2Tone,
      ...vo2Detail,
      title: vo2max.history.length > 1
        ? t("Last {{count}} days · {{first}} → {{last}}", { count: vo2max.history.length, first: formatNumber(vo2max.history[0]!, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), last: formatNumber(vo2max.history[vo2max.history.length - 1]!, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
        : undefined,
      trend: <TrendLine values={vo2max.history} />,
      emptyHint: t("Run outdoors with GPS to estimate it")
    }
  ];
}

function Vital({ spec }: { spec: VitalSpec }) {
  return (
    <div className={`overview-vital is-${spec.hue}`} title={spec.title}>
      <dt>
        <i className="overview-vital-dot" aria-hidden="true" />
        <span className="overview-vital-label">{spec.label}</span>
        {spec.verdict ? <span className={`overview-vital-verdict is-${spec.tone}`}>{spec.verdict}</span> : null}
      </dt>
      <dd>
        <strong>
          {spec.value}
          {spec.unit ? <small>{spec.unit}</small> : null}
        </strong>
        <span className="overview-vital-detail">
          {spec.lead ? <b className={`is-${spec.tone}`}>{spec.lead}</b> : null}
          {spec.detail ?? (spec.lead ? null : " ")}
        </span>
      </dd>
      <div className="overview-trend">{spec.trend}</div>
    </div>
  );
}

/** Vitals not measured yet share one quiet tile, so the grid keeps its room for real readings. */
function PendingVitals({ items, wide }: { items: VitalSpec[]; wide: boolean }) {
  return (
    <div className={`overview-vitals-pending${wide ? " is-wide" : ""}`}>
      {items.map((item) => (
        <div key={item.hue} className={`overview-vital-pending is-${item.hue}`}>
          <dt>
            <i className="overview-vital-dot" aria-hidden="true" />
            {item.label}
          </dt>
          <dd>
            <span>{item.emptyHint}</span>
            {item.action ? (
              <button type="button" className="overview-vital-action" onClick={item.action.onClick}>
                {item.action.label}
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            ) : null}
          </dd>
        </div>
      ))}
    </div>
  );
}

function ReadinessCard({
  readiness,
  snapshot,
  onNavigate
}: {
  readiness: Readiness;
  snapshot: TrainingHubSnapshot | null;
  onNavigate: (view: PrimaryView) => void;
}) {
  useLanguage();
  const vitals = useMemo(() => buildVitals(snapshot), [snapshot, getLocale()]);
  const specs = vitalSpecs(vitals, onNavigate);
  const measured = specs.filter((spec) => spec.value !== undefined);
  const pending = specs.filter((spec) => spec.value === undefined);
  // Measured tiles share the height; a pending strip under an even number of
  // them takes only what its rows need.
  const tileRows = Math.ceil(measured.length / 2);
  const stripWide = pending.length > 0 && measured.length % 2 === 0;
  const gridTemplateRows = `${tileRows > 0 ? `repeat(${tileRows}, minmax(0, 1fr))` : ""}${stripWide ? " auto" : ""}`.trim();

  return (
    <section className={`panel overview-card overview-readiness tone-${readiness.tone}`}>
      <CardHead
        icon={<Heartbeat size={20} weight="duotone" />}
        hue="var(--tone)"
        title={t("Readiness")}
        subtitle={t("Recovery and overnight vitals")}
      >
        {readiness.percent !== undefined ? (
          <span className={`overview-chip${readiness.fullRecoveryHours ? "" : " is-good"}`}>
            {readiness.fullRecoveryHours
              ? t("Full recovery in {{p0}}h", { p0: String(readiness.fullRecoveryHours) })
              : t("Fully recovered")}
          </span>
        ) : null}
      </CardHead>
      <div className="overview-readiness-body">
        <ReadinessRing percent={readiness.percent} tone={readiness.tone} />
        <div className="overview-readiness-copy">
          <h2>{readiness.title}</h2>
          <p>{readiness.message}</p>
        </div>
        <dl className="overview-vitals" style={{ gridTemplateRows }}>
          {measured.map((spec) => (
            <Vital key={spec.hue} spec={spec} />
          ))}
          {pending.length > 0 ? <PendingVitals items={pending} wide={stripWide} /> : null}
        </dl>
      </div>
    </section>
  );
}

function TodayCard({
  plan,
  week,
  onNavigate
}: {
  plan: TodayPlan;
  week: WeekSummary;
  onNavigate: (view: PrimaryView) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const hiddenNavItems = useHiddenNavItems();
  const nextLabel = plan.next
    ? `Next up: ${plan.next.name.trim()} · ${formatUpcomingWorkoutDate(plan.next.happenDay)}`
    : undefined;

  return (
    <section className="panel overview-card overview-today">
      <CardHead
        icon={<CalendarDots size={20} weight="duotone" />}
        hue="var(--ov-calendar)"
        title={t("Today’s plan")}
        subtitle={t("From your COROS calendar")}
      >
        {hiddenNavItems.has("calendar") ? null : (
          <button
            type="button"
            className="overview-round-link"
            onClick={() => onNavigate("calendar")}
            aria-label={t("Open Calendar")}
            title={t("Open Calendar")}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </CardHead>

      {plan.today.length > 0 ? (
        <div className="overview-sessions">
          {plan.today.map((workout, index) => {
            const family = planFamily(workout);
            const stats = workoutStats(workout, unitSystem);
            return (
              <article
                key={`${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`}
                className="overview-session"
                style={sportStyle(family)}
              >
                <div>
                  <h2>{workout.name.trim()}</h2>
                  <p>
                    <SportIcon family={family} size={16} />
                    {[workoutKind(workout, family), stats].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      ) : plan.next ? (
        <article className="overview-session is-rest">
          <div>
            <h2>{t("Rest day")}</h2>
            <p>
              <MoonStars size={16} weight="duotone" aria-hidden="true" />
              {nextLabel}
            </p>
          </div>
        </article>
      ) : (
        <article className="overview-session is-empty">
          <div>
            <h2>{t("Nothing scheduled")}</h2>
            <p>
              <CalendarPlus size={16} weight="duotone" aria-hidden="true" />
              {t("Pick a workout or plan from the Training Library.")}</p>
          </div>
          {hiddenNavItems.has("library") ? null : (
            <button type="button" className="overview-link" onClick={() => onNavigate("library")}>
              {t("Plan")}<ChevronRight size={14} aria-hidden="true" />
            </button>
          )}
        </article>
      )}

      {plan.later.length > (plan.today.length > 0 ? 0 : 1) ? (
        <div className="overview-upnext">
          <p className="overview-upnext-label">{t("Coming up")}</p>
          <ul>
            {plan.later.slice(plan.today.length > 0 ? 0 : 1, plan.today.length > 1 ? 1 : 2).map((workout, index) => (
              <li key={`${workout.happenDay}-${workout.sortNo ?? index}-${workout.name}`} style={sportStyle(planFamily(workout))}>
                <span className="overview-upnext-day">{formatUpcomingWorkoutDate(workout.happenDay)}</span>
                <SportIcon family={planFamily(workout)} size={16} />
                <span className="overview-upnext-name">{workout.name.trim()}</span>
                <span className="overview-upnext-stats">{workoutStats(workout, unitSystem)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WeekStrip week={week} />
    </section>
  );
}

function WeekStrip({ week }: { week: WeekSummary }) {
  useLanguage();
  const ready = useMountedReveal();
  const change = week.previousLoad > 0 ? Math.round(((week.load - week.previousLoad) / week.previousLoad) * 100) : undefined;
  return (
    <div className="overview-week">
      <div className="overview-week-head">
        <span>{t("This week")}</span>
        <strong>
          {week.load}
          <small>TL</small>
        </strong>
        <span className="overview-week-meta">
          {week.sessions} {week.sessions === 1 ? t("session") : t("sessions")}
          {week.plannedSessions > 0 ? t(" · {{p0}} planned", { p0: String(week.plannedSessions) }) : ""}
          {week.previousLoad > 0 ? t(" · last week {{p0}} TL", { p0: String(week.previousLoad) }) : ""}
        </span>
      </div>
      <ol className={`overview-week-bars${ready ? " is-ready" : ""}`}>
        {week.days.map((day) => {
          const done = day.load > 0 || day.sessions > 0;
          const height = (value: number) => `${Math.max(8, (value / week.peak) * 100)}%`;
          const title = [
            new Intl.DateTimeFormat(getLocale(), { weekday: "long", month: "short", day: "numeric" }).format(
              new Date(Number(day.happenDay.slice(0, 4)), Number(day.happenDay.slice(4, 6)) - 1, Number(day.happenDay.slice(6, 8)))
            ),
            done ? `${day.load} TL · ${day.sessions} ${day.sessions === 1 ? t("session") : t("sessions")}` : undefined,
            day.planned.length ? t("Planned: {{workouts}}", { workouts: day.planned.map((workout) => workout.name.trim()).join(", ") }) : undefined
          ].filter(Boolean).join("\n");
          return (
            <li
              key={day.happenDay}
              className={[day.isToday && "is-today", day.isFuture && "is-future"].filter(Boolean).join(" ") || undefined}
              title={title}
            >
              <span className="overview-week-track">
                {day.planned.length > 0 && !done ? (
                  // Unestimated workouts (0 TL) still get a marker, at a modest fixed height.
                  <span
                    className="overview-week-bar is-planned"
                    style={{
                      height: day.plannedLoad > 0 ? height(day.plannedLoad) : "60%",
                      "--overview-sport": `var(--sport-${day.plannedSport ?? "other"})`
                    } as CSSProperties}
                  />
                ) : null}
                {done ? (
                  <span
                    className="overview-week-bar is-done"
                    style={{ height: height(day.load), "--overview-sport": `var(--sport-${day.sport ?? "other"})` } as CSSProperties}
                  />
                ) : day.planned.length > 0 ? null : (
                  <span className="overview-week-dot" />
                )}
              </span>
              <span className="overview-week-day">{day.weekday}</span>
              <span className="overview-week-date">{day.dayOfMonth}</span>
            </li>
          );
        })}
      </ol>
      {change !== undefined && week.days.some((day) => day.isFuture) === false ? (
        <p className="overview-week-foot">{change >= 0 ? `+${change}%` : `${change}%`} {t("vs last week")}</p>
      ) : null}
    </div>
  );
}

function LatestActivityCard({
  api,
  activity,
  sportTypes,
  onOpen
}: {
  api: CorosLinkApi | undefined;
  activity: TrainingHubActivity;
  sportTypes: TrainingHubSportType[];
  /** Omitted while Training Hub is hidden from the sidebar. */
  onOpen?: () => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const loader = useMemo(() => (api ? routePreviewLoader(api) : null), [api]);
  const indoor = INDOOR_SPORT_TYPES.has(activity.sportType);
  const swim = isSwimSportType(activity.sportType);
  const sportName = resolveSportName(activity, sportTypes) ?? "Activity";
  const distance = activity.distance && activity.distance > 0 ? activity.distance : undefined;
  // Moving time, as COROS shows it: pauses would stretch Time and slow Pace.
  const duration = activityMovingSeconds(activity);
  const paceLabel = distance && duration && !swim
    ? isCyclingSportType(activity.sportType)
      ? { label: t("Speed"), value: formatSpeedValue((distance / 1000) / (duration / 3600), unitSystem) }
      : { label: t("Pace"), value: formatPaceValue(duration / (distance / 1000), unitSystem) }
    : undefined;
  const stats = [
    distance ? { label: t("Distance"), value: formatDistanceValue(distance, unitSystem, { swim, digits: swim ? 0 : undefined }) } : undefined,
    duration ? { label: t("Time"), value: formatDurationSeconds(duration) } : undefined,
    paceLabel,
    activity.avgHr ? { label: t("Avg HR"), value: `${Math.round(activity.avgHr)} bpm` } : undefined,
    activity.elevationGain ? { label: t("Elevation"), value: formatElevationValue(activity.elevationGain, unitSystem) } : undefined,
    activity.trainingLoad ? { label: t("Load"), value: `${Math.round(activity.trainingLoad)} TL` } : undefined,
    activity.calories ? { label: t("Calories"), value: `${Math.round(activity.calories)} kcal` } : undefined
  ].filter((stat): stat is { label: string; value: string } => Boolean(stat)).slice(0, 6);

  const family = activitySportFamily(activity.sportType);

  return (
    <section
      className="panel overview-card overview-latest"
      style={{ ...sportStyle(family), "--activity-color": sportColor(family) } as CSSProperties}
    >
      <div className="overview-latest-route">
        {loader ? (
          <Suspense fallback={<div className="activity-card-route" />}>
            <LazyActivityCardRoute activity={activity} load={loader} indoor={indoor} />
          </Suspense>
        ) : null}
      </div>
      <div className="overview-latest-body">
        <CardHead
          icon={<SportIcon family={family} size={20} />}
          hue="var(--overview-sport)"
          title={t("Latest activity")}
          subtitle={formatActivityWhen(activity.startTime)}
        />
        <div className="overview-latest-title">
          <h2>{activity.name?.trim() || sportName}</h2>
          <p>{sportName}</p>
        </div>
        <dl className="overview-latest-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{t(stat.label)}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
        {onOpen ? (
          <button type="button" className="overview-link" onClick={onOpen}>
            {t("Open in Training Hub")}<ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RacePredictionsCard({
  scores,
  level,
  onOpen
}: {
  scores: NonNullable<TrainingHubSnapshot["racePredictor"]>["runScoreList"];
  level?: number;
  /** Omitted while Training Hub is hidden from the sidebar. */
  onOpen?: () => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const ready = useMountedReveal();
  const paces = scores.map((score) => score.avgPace ?? 0).filter((pace) => pace > 0);
  const fastest = paces.length ? Math.min(...paces) : 0;
  const slowest = paces.length ? Math.max(...paces) : 0;

  return (
    <section className="panel overview-card overview-races">
      <CardHead
        icon={<Timer size={20} weight="duotone" />}
        hue="var(--ov-gold)"
        title={t("Race predictor")}
        subtitle={t("If you raced today")}
      >
        {level !== undefined && Number.isFinite(level) ? (
          <span className="overview-chip">{t("Running level {{p0}}", { p0: String(Math.round(level)) })}</span>
        ) : null}
      </CardHead>
      <ul className={`overview-race-list${ready ? " is-ready" : ""}`}>
        {scores.slice(0, 4).map((score, index) => {
          const pace = score.avgPace ?? 0;
          const ratio = pace > 0 && slowest > fastest ? 1 - ((pace - fastest) / (slowest - fastest)) * 0.6 : 1;
          const label = score.distanceLabel ? t(score.distanceLabel) : score.distance ? formatDistanceValue(score.distance, unitSystem) : t("Race {{number}}", { number: index + 1 });
          return (
            <li key={`${label}-${index}`}>
              <span className="overview-race-label">{label}</span>
              <span className="overview-race-track" aria-hidden="true">
                <span style={{ width: `${ratio * 100}%`, transitionDelay: `${index * 60}ms` }} />
              </span>
              <strong>{formatDurationSeconds(score.predictSeconds)}</strong>
              <small>{pace > 0 ? formatPaceValue(pace, unitSystem) : ""}</small>
            </li>
          );
        })}
      </ul>
      {onOpen ? (
        <button type="button" className="overview-link" onClick={onOpen}>
          {t("Training Hub")}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

function OverviewConnectHero({ onConnect }: { onConnect: () => void }) {
  useLanguage();
  const points = [
    { icon: <Heartbeat size={17} weight="duotone" aria-hidden="true" />, label: t("Recovery, sleep and HRV every morning") },
    { icon: <CalendarDots size={17} weight="duotone" aria-hidden="true" />, label: t("Today’s workout and your week at a glance") },
    { icon: <Path size={17} weight="duotone" aria-hidden="true" />, label: t("Your latest route and race predictions") }
  ];
  return (
    <section className="panel overview-connect">
      <div className="overview-connect-copy">
        <p className="eyebrow">COROS Training Hub</p>
        <h2>{t("Make this your morning brief")}</h2>
        <p>{t("Sign in to your COROS account and Overview fills with what your watch already recorded. No cable, no Bluetooth: it syncs from the cloud.")}</p>
        <ul className="overview-connect-points">
          {points.map((point) => (
            <li key={point.label}>
              <span>{point.icon}</span>
              {point.label}
            </li>
          ))}
        </ul>
        <button type="button" className="primary-button overview-connect-button" onClick={onConnect}>
          <LogIn size={16} aria-hidden="true" />
          {t("Sign in to COROS")}</button>
      </div>
      <div className="overview-connect-preview" aria-hidden="true">
        <ReadinessRing percent={82} tone="high" ghost />
        <ol className="overview-week-bars is-ready is-ghost">
          {[46, 0, 88, 34, 62, 100, 28].map((value, index) => (
            <li key={index}>
              <span className="overview-week-track">
                {value ? (
                  <span
                    className="overview-week-bar is-done"
                    style={{ height: `${value}%`, "--overview-sport": `var(--sport-${["run", "other", "trail", "run", "bike", "trail", "run"][index]})` } as CSSProperties}
                  />
                ) : (
                  <span className="overview-week-dot" />
                )}
              </span>
              <span className="overview-week-day">{new Intl.DateTimeFormat(getLocale(), { weekday: "narrow" }).format(new Date(2024, 0, 1 + index))}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const NAV_ICONS = new Map<PrimaryView, Icon>(PRIMARY_NAV_ITEMS.map((item) => [item.id, item.icon]));

interface LaunchItem {
  view: PrimaryView;
  title: string;
  detail: string;
}

export function OverviewLaunchpad({
  trackCount,
  librarySize,
  upcomingCount,
  trainingConnected,
  onNavigate
}: {
  trackCount: number;
  librarySize: string;
  upcomingCount: number;
  trainingConnected: boolean;
  onNavigate: (view: PrimaryView) => void;
}) {
  useLanguage();
  const hiddenNavItems = useHiddenNavItems();
  const launchItems: LaunchItem[] = [
    { view: "watchfaces", title: t("Watch Faces"), detail: t("Design your own face in Studio") },
    {
      view: "coach",
      title: t("Coach"),
      detail: trainingConnected ? t("Ask about today’s training") : t("Chat about plans and pacing")
    },
    {
      view: "calendar",
      title: t("Calendar"),
      detail: upcomingCount > 0
        ? upcomingCount === 1
          ? t("1 workout in the next two weeks")
          : t("{{count}} workouts in the next two weeks", { count: upcomingCount.toLocaleString(getLocale()) })
        : t("Plan your next block")
    },
    {
      view: "media",
      title: t("Music"),
      detail: trackCount > 0
        ? trackCount === 1
          ? t("1 track · {{size}}", { size: librarySize })
          : t("{{count}} tracks · {{size}}", { count: trackCount.toLocaleString(getLocale()), size: librarySize })
        : t("Load music for your runs")
    }
  ];
  const items = launchItems.filter((item) => !hiddenNavItems.has(item.view));
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="overview-launchpad-shell">
      <nav
        className="overview-launchpad"
        aria-label={t("Jump to")}
        style={{ "--launch-columns": items.length } as CSSProperties}
      >
        {items.map((item) => {
          const Glyph = NAV_ICONS.get(item.view);
          return (
            <button key={item.view} type="button" className={`overview-launch is-${item.view}`} onClick={() => onNavigate(item.view)}>
              <span className="overview-glyph overview-launch-icon">{Glyph ? <Glyph size={20} weight="duotone" aria-hidden="true" /> : null}</span>
              <span className="overview-launch-copy">
                <strong>{item.title}</strong>
                <span>{t(item.detail)}</span>
              </span>
              <ChevronRight className="overview-launch-arrow" size={16} aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
