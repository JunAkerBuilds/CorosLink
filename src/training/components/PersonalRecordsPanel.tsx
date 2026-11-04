import { getLocale, getDateTimeFormat, useLanguage, t, midSentence } from "../../i18n/training";
import {
  Activity,
  ArrowUp,
  ArrowUpRight,
  Bike,
  ChartColumn,
  Flame,
  Footprints,
  PersonStanding,
  Target,
  Timer,
  Trophy,
  Waves,
  type LucideIcon
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  TrainingHubActivity,
  TrainingHubDashboard,
  TrainingHubPersonalRecord,
  TrainingHubRaceScore
} from "../../../electron/types";
import {
  formatDurationSeconds,
  formatElevationMeters,
  formatPersonalRecordHero,
  formatPersonalRecordMeta,
  formatRecordDateShort,
  isPersonalRecordPopulated,
  isPersonalRecordVisible
} from "../formatters";
import { activityMovingSeconds } from "../../../electron/activityTime";
import { useLocalOnlyView } from "../../privacy/localOnlyView";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDistanceValue, formatSpeedValue, type UnitSystem } from "../../units/units";
import {
  defineSelectionPreference,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import {
  PR_ASSET_BASE,
  RecordBurst,
  RollingText,
  readSeenRecordSignatures,
  recordLabel,
  recordSignature,
  splitHero,
  type RecordCelebration
} from "./PersonalRecordCelebration";
import {
  HALL_SPORT_LABELS,
  activitiesSince,
  activityRecords,
  activitySeries,
  bestAsOf,
  findRecordActivity,
  milestones as findMilestones,
  periodStart,
  reachShare,
  recordHistory,
  sessionNoun,
  sportTally,
  workBuckets,
  workTotals,
  type ActivityRecord,
  type HallSport,
  type Milestones,
  type RecordHistoryPoint
} from "../hallOfBests";
import { RecordWorkChart, formatHours } from "./RecordWorkChart";
import "../personalRecords.css";

/**
 * Records & PRs: one board for every best. Running's race distances form a
 * ladder along a single rail, gold up to the farthest distance raced and open
 * beyond it; the longest run, the biggest climb and every other sport's bests
 * are plain figures on the same grid. The hours behind them and the
 * milestones sit underneath.
 */

interface PersonalRecordsPanelProps {
  dashboard: TrainingHubDashboard | null;
  /** The full activity history: bests for other sports, totals and the work chart. */
  activities?: TrainingHubActivity[];
  /** Set while a record's on-board celebration plays (after the full-screen moment). */
  celebration?: RecordCelebration | null;
  /** Replays the full-screen celebration for a record. */
  onCelebrate?: (record: TrainingHubPersonalRecord) => void;
  /** Opens an activity's page; the record story links to the run a record was set in. */
  onOpenActivity?: (activity: TrainingHubActivity) => void;
}

const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;
const RECORD_GROUP_ALL_TIME = 4;
const RECENT_RECORD_DAYS = 30;
/** A record this fresh glows on the ladder and wears a NEW tag. */
const FRESH_RECORD_DAYS = 10;
const DAY_MS = 86_400_000;

/** Race-distance record types and their exact distances (COROS type ids). */
const RECORD_DISTANCE_METERS: Record<number, number> = {
  7: 1000,
  6: 3000,
  5: 5000,
  4: 10000,
  2: 21097.5,
  13: 42195
};

/** COROS's predictor names, for predictions that arrive without a distance. */
const PREDICTION_NAMES: Record<number, string> = {
  5: "5k",
  4: "10k",
  2: "half marathon",
  13: "marathon"
};

const PERSONAL_RECORD_GROUP_PREFERENCE = defineSelectionPreference<number>({
  key: "training.personalRecordGroup",
  defaultValue: RECORD_GROUP_ALL_TIME,
  validate: (value): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0
});

function isEnduranceRecord(record: TrainingHubPersonalRecord): boolean {
  return record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN;
}

const PERIOD_LABELS: Record<number, string> = {
  1: "4 weeks",
  2: "12 weeks",
  3: "Half year",
  4: "All time"
};

function periodLabel(group: { type: number; label: string }): string {
  return t(PERIOD_LABELS[group.type] ?? group.label);
}

function periodOrder(type: number): number {
  return type in PERIOD_LABELS ? type : 99;
}

function happenDayTime(happenDay?: string): number | null {
  if (!happenDay || !/^\d{8}$/.test(happenDay)) {
    return null;
  }

  return new Date(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8))
  ).getTime();
}

/** "Sep 29" this year, "Aug 16, 2025" before it; `full` always shows the year. */
function formatRecordTime(time: number, full = false): string {
  const date = new Date(time);
  return getDateTimeFormat({
    month: "short",
    day: "numeric",
    ...(full || date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {})
  }).format(date);
}

function formatRecordDay(happenDay?: string): string {
  const time = happenDayTime(happenDay);
  return time === null ? formatRecordDateShort(happenDay) : formatRecordTime(time);
}

/** How long a record has stood: "3 days", "5 weeks", "4 months", "2 years". */
function formatStanding(days: number): string {
  if (days < 1) return t("set today");
  if (days < 14) return t(days === 1 ? "{{count}} day" : "{{count}} days", { count: days });
  if (days < 61) return t("{{count}} weeks", { count: Math.round(days / 7) });
  if (days < 730) return t("{{count}} months", { count: Math.round(days / 30.44) });
  return t("{{count}} years", { count: Math.round(days / 365.25) });
}

/** COROS's labels are Title Case; the board sets them in sentences. */
const BOARD_LABELS: Record<number, string> = {
  2: "Half marathon",
  13: "Marathon",
  101: "Longest run",
  103: "Most elevation gain"
};

function boardLabel(record: TrainingHubPersonalRecord, unitSystem: UnitSystem): string {
  const label = BOARD_LABELS[record.type];
  return label ? t(label) : recordLabel(record, unitSystem);
}

/** "21.20km" → "21.20 km", as the board sets its units apart. */
function spacedHero(record: TrainingHubPersonalRecord, unitSystem: UnitSystem): string {
  const { value, unit } = splitHero(formatPersonalRecordHero(record, unitSystem));
  return unit ? `${value} ${unit}` : value;
}

function recordValue(record: TrainingHubPersonalRecord): number | undefined {
  return isEnduranceRecord(record) ? record.distance : record.duration;
}

function predictionFor(
  record: TrainingHubPersonalRecord,
  predictions: TrainingHubRaceScore[]
): TrainingHubRaceScore | null {
  const meters = RECORD_DISTANCE_METERS[record.type];

  if (!meters) {
    return null;
  }

  const name = PREDICTION_NAMES[record.type];
  return (
    predictions.find(
      (prediction) =>
        prediction.predictSeconds !== undefined &&
        prediction.predictSeconds > 0 &&
        (prediction.distance !== undefined && prediction.distance > 0
          ? Math.abs(prediction.distance - meters) / meters < 0.02
          : prediction.distanceLabel?.toLowerCase() === name)
    ) ?? null
  );
}

type RecordComparison =
  | { kind: "all-time-best" }
  | { kind: "all-time"; record: TrainingHubPersonalRecord }
  | { kind: "prediction"; prediction: TrainingHubRaceScore }
  | { kind: "standing"; days: number };

/**
 * One line of context per record. A shorter period is measured against the
 * all-time best; all-time bests against COROS's predicted time when it has one.
 */
function compareRecord(
  record: TrainingHubPersonalRecord,
  allTimeRecords: TrainingHubPersonalRecord[] | null,
  prediction: TrainingHubRaceScore | null
): RecordComparison | null {
  if (!isPersonalRecordPopulated(record)) {
    return null;
  }

  const allTime = allTimeRecords?.find((candidate) => candidate.type === record.type);
  const value = recordValue(record);
  const allTimeValue = allTime ? recordValue(allTime) : undefined;

  if (allTime && value !== undefined && allTimeValue !== undefined) {
    const isBest = isEnduranceRecord(record)
      ? value >= allTimeValue - 0.5
      : value <= allTimeValue + 0.5;
    return isBest ? { kind: "all-time-best" } : { kind: "all-time", record: allTime };
  }

  if (prediction && !isEnduranceRecord(record)) {
    return { kind: "prediction", prediction };
  }

  const time = happenDayTime(record.happenDay);
  return time === null
    ? null
    : { kind: "standing", days: Math.floor((Date.now() - time) / DAY_MS) };
}

/**
 * The arena behind the wreath: pyro bursts from three points along the stage
 * edge and embers drifting up across it. Laid out deterministically so the
 * stage looks the same on every visit.
 */
const PYRO_EMITTERS = [6, 30, 55, 80];
const PYRO = PYRO_EMITTERS.flatMap((x, emitter) =>
  Array.from({ length: 14 }, (_, index) => {
    const seed = emitter * 14 + index;
    return {
      x: x + ((seed * 13) % 7) - 3,
      vx: ((seed * 37) % 140) - 70,
      vy: -(60 + ((seed * 53) % 110)),
      delay: emitter * 1100 + ((seed * 29) % 360),
      size: 2.5 + (seed % 3),
      color: seed % 5 === 0 ? "#fff6dc" : seed % 3 === 0 ? "#ffb347" : "#f0c870"
    };
  })
);
const EMBERS = Array.from({ length: 36 }, (_, index) => ({
  x: (index * 41 + (index % 5) * 7) % 100,
  delay: (index * 173) % 5200,
  duration: 4200 + ((index * 97) % 3400),
  rise: 110 + ((index * 61) % 150),
  sway: ((index * 29) % 90) - 45,
  size: 2.5 + (index % 3) * 0.75
}));
/**
 * Tongues of flame along the stage edge: an outer row of broad, slow tongues
 * and an inner row of small hot ones, tallest behind the wreath, dying off
 * to the right. Positions are jittered so the line never reads as lamps.
 */
const FLAMES = Array.from({ length: 32 }, (_, index) => {
  const outer = index < 21;
  const x = outer
    ? index * 4.9 + ((index * 7) % 5) * 0.6
    : (index - 21) * 9.4 + 1.5 + ((index * 11) % 7) * 0.8;
  const left = Math.max(0, 1 - x / 58);
  const peak = outer && [0, 2, 3, 9, 15].includes(index) ? 48 : 0;
  return {
    x: Math.round(x * 10) / 10,
    width: outer ? 90 + ((index * 23) % 70) : 38 + ((index * 17) % 30),
    height: outer
      ? 56 + Math.round(left * 84) + peak + ((index * 13) % 28)
      : 40 + Math.round(left * 40) + ((index * 19) % 28),
    duration: outer ? 1000 + ((index * 131) % 800) : 640 + ((index * 97) % 500),
    delay: -((index * 211) % 1500),
    opacity: outer ? 0.5 + left * 0.5 : 0.75 + left * 0.25,
    hot: !outer
  };
});

function Stage() {
  useLanguage();
  return (
    <div className="pr-stage" aria-hidden="true">
      <span className="pr-stage-heat" />
      <span className="pr-stage-fire">
        {FLAMES.map((flame, index) => (
          <i
            key={index}
            className={flame.hot ? "is-hot" : undefined}
            style={
              {
                "--x": `${flame.x}%`,
                "--w": `${flame.width}px`,
                "--h": `${flame.height}px`,
                "--t": `${flame.duration}ms`,
                "--d": `${flame.delay}ms`,
                "--o": flame.opacity
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="pr-stage-embers">
        {EMBERS.map((ember, index) => (
          <i
            key={index}
            style={
              {
                "--x": `${ember.x}%`,
                "--d": `${ember.delay}ms`,
                "--t": `${ember.duration}ms`,
                "--h": `${ember.rise}px`,
                "--sway": `${ember.sway}px`,
                "--s": `${ember.size}px`
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="pr-stage-pyro">
        {PYRO.map((spark, index) => (
          <i
            key={index}
            style={
              {
                "--x": `${spark.x}%`,
                "--vx": `${spark.vx}px`,
                "--vy": `${spark.vy}px`,
                "--d": `${spark.delay}ms`,
                "--s": `${spark.size}px`,
                "--c": spark.color
              } as CSSProperties
            }
          />
        ))}
      </span>
      <span className="pr-stage-edge" />
    </div>
  );
}

function Laurels({ children, celebrating }: { children: ReactNode; celebrating: boolean }) {
  useLanguage();
  return (
    <div className={celebrating ? "pr-emblem is-celebrating" : "pr-emblem"} aria-hidden="true">
      <img
        className="pr-emblem-wheat is-left"
        src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
        alt=""
      />
      <span className="pr-emblem-medal">{children}</span>
      <img
        className="pr-emblem-wheat is-right"
        src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
        alt=""
      />
    </div>
  );
}

export function PersonalRecordsPanel({
  dashboard,
  activities = [],
  celebration = null,
  onCelebrate,
  onOpenActivity
}: PersonalRecordsPanelProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const { unitSystem } = useUnitSystem();
  // The lights come up a frame after the board mounts. A transition rather
  // than an animation, so a backgrounded window (which pauses animations)
  // can never leave the board dark.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setLit(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const groups = useMemo(
    () =>
      [...(dashboard?.personalRecords ?? [])].sort(
        (left, right) => periodOrder(left.type) - periodOrder(right.type)
      ),
    [dashboard]
  );
  const predictions = dashboard?.racePredictor?.runScoreList ?? [];
  const [activeGroupType, setActiveGroupType] = useSelectionPreference(
    PERSONAL_RECORD_GROUP_PREFERENCE
  );

  useEffect(() => {
    if (groups.length === 0) {
      return;
    }

    if (!groups.some((group) => group.type === activeGroupType)) {
      setActiveGroupType(
        groups.find((group) => group.type === RECORD_GROUP_ALL_TIME)?.type ?? groups[0]!.type
      );
    }
  }, [activeGroupType, groups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.type === activeGroupType) ?? groups[0],
    [activeGroupType, groups, getLocale()]
  );
  const activePeriod = activeGroup ? periodLabel(activeGroup) : t("All time");
  const isAllTime = !activeGroup || activeGroup.type === RECORD_GROUP_ALL_TIME;

  // COROS's running board for the period.
  const records = (activeGroup?.records ?? []).filter(isPersonalRecordVisible);
  const raceRecords = records.filter((record) => !isEnduranceRecord(record));
  const enduranceRecords = records.filter(isEnduranceRecord);
  const populated = records.filter(isPersonalRecordPopulated);

  // A shorter period is read against the all-time board.
  const allTimeRecords = !isAllTime
    ? (groups
        .find((group) => group.type === RECORD_GROUP_ALL_TIME)
        ?.records.filter(isPersonalRecordPopulated) ?? null)
    : null;

  // Every other sport, from the activity history for the same period.
  const since = isAllTime ? null : periodStart(activeGroup?.type);
  const periodActivities = useMemo(() => activitiesSince(activities, since), [activities, since]);
  const wings = useMemo(
    () =>
      (["ride", "swim", "walk"] as const)
        .filter((sport) => sportTally(activities, sport).count > 0)
        .map((sport) => ({
          sport,
          tally: sportTally(periodActivities, sport),
          records: activityRecords(periodActivities, sport).filter(isActivityRecord),
          allTime: isAllTime ? null : activityRecords(activities, sport).filter(isActivityRecord)
        })),
    [activities, periodActivities, isAllTime]
  );
  const runTally = sportTally(periodActivities, "run");
  const quietSports = wings.filter((wing) => wing.tally.count === 0).map((wing) => wing.sport);

  // Every record on the board, for the medal count, the newest and the chart's medals.
  const entries = [
    ...populated.map((record) => ({
      key: `coros:${record.type}`,
      label: boardLabel(record, unitSystem),
      time: happenDayTime(record.happenDay)
    })),
    ...wings.flatMap((wing) =>
      wing.records.map((record) => ({
        key: record.key,
        label: t(record.label),
        time: record.time || null
      }))
    )
  ];
  const sportsWithRecords =
    (populated.length > 0 ? 1 : 0) + wings.filter((wing) => wing.records.length > 0).length;
  const newest = entries.reduce<(typeof entries)[number] | null>(
    (best, entry) =>
      entry.time !== null && (best?.time == null || entry.time > best.time) ? entry : best,
    null
  );
  // Records set on the newest day. Only all-time bests among them are new PRs.
  const newestDay = entries.filter((entry) => entry.time !== null && entry.time === newest?.time);
  const isRecent =
    newest?.time != null && Date.now() - newest.time <= RECENT_RECORD_DAYS * DAY_MS;
  const recentKeys = new Set(isRecent ? newestDay.map((entry) => entry.key) : []);

  const totals = useMemo(() => workTotals(periodActivities), [periodActivities]);
  const work = useMemo(() => {
    const from = since ?? totals.first;
    return from === null ? null : workBuckets(periodActivities, from, Date.now());
  }, [periodActivities, since, totals.first]);
  const medals = new Map<number, string[]>();
  for (const entry of entries) {
    const bucket = work?.buckets.find(
      (candidate) =>
        entry.time !== null && entry.time >= candidate.start && entry.time < candidate.end
    );
    if (bucket) medals.set(bucket.start, [...(medals.get(bucket.start) ?? []), entry.label]);
  }
  const milestones = useMemo(() => findMilestones(periodActivities), [periodActivities]);

  const celebrated = celebration
    ? (groups
        .flatMap((group) => group.records)
        .find((record) => recordSignature(record) === celebration.signature) ?? null)
    : null;
  const celebrate = (record: TrainingHubPersonalRecord) => onCelebrate?.(record);

  const recordProps = (record: TrainingHubPersonalRecord) => {
    const comparison = compareRecord(record, allTimeRecords, predictionFor(record, predictions));
    return {
      record,
      isLatest:
        recentKeys.has(`coros:${record.type}`) &&
        (isAllTime || comparison?.kind === "all-time-best"),
      comparison,
      prediction: predictionFor(record, predictions),
      celebrationNonce:
        celebration?.signature === recordSignature(record) ? celebration.nonce : null,
      onCelebrate: () => celebrate(record)
    };
  };

  // Every record the app has seen, for each distance's best-time story.
  const seenSignatures = useMemo(() => readSeenRecordSignatures(), [dashboard]);
  const now = Date.now();
  const rungInfo = (record: TrainingHubPersonalRecord): RungInfo => {
    const prediction = predictionFor(record, predictions);
    const populated = isPersonalRecordPopulated(record);
    const time = happenDayTime(record.happenDay);
    const duration = record.duration ?? 0;
    const predicted = prediction?.predictSeconds ?? 0;
    const comparison = compareRecord(record, allTimeRecords, prediction);
    return {
      populated,
      time,
      // Recent, and a best on the board it is shown against.
      fresh:
        populated &&
        time !== null &&
        Math.floor((now - time) / DAY_MS) <= FRESH_RECORD_DAYS &&
        (isAllTime || allTimeRecords === null || comparison?.kind === "all-time-best"),
      predicted: populated && predicted > 0 ? predicted : null,
      gap: populated && predicted > 0 ? duration - predicted : null,
      reach: populated && predicted > 0 ? reachShare(duration, predicted) : null
    };
  };
  const rungs = raceRecords.map((record) => ({ record, info: rungInfo(record) }));
  // The distance whose predicted time beats its record by the smallest share.
  const spotlight = rungs.reduce<(typeof rungs)[number] | null>((best, rung) => {
    const { gap } = rung.info;
    if (gap === null || gap < 1 || !rung.record.duration) return best;
    const share = gap / rung.record.duration;
    return !best || share < best.info.gap! / best.record.duration! ? rung : best;
  }, null);

  // One distance tells its story under the ladder: the picked one, else the newest.
  const [storyType, setStoryType] = useState<number | null>(null);
  const storyRung =
    rungs.find((rung) => rung.record.type === storyType) ??
    rungs.reduce<(typeof rungs)[number] | null>(
      (best, rung) =>
        rung.info.time !== null && (best?.info.time == null || rung.info.time > best.info.time)
          ? rung
          : best,
      null
    ) ??
    rungs[0] ??
    null;
  const storyId = useId();
  const tallyChips = [
    { sport: "run" as const, tally: runTally },
    ...wings.filter((wing) => wing.sport === "ride").map((wing) => ({ sport: wing.sport, tally: wing.tally }))
  ].filter((chip) => chip.tally.count > 0);

  const hasAnything = records.length > 0 || activities.length > 0;
  const count = entries.length;
  const countText = count === 1 ? t("1 record") : t("{{count}} records", { count });
  const summary = isAllTime
    ? sportsWithRecords > 1
      ? t("{{records}} across {{sports}} sports.", { records: countText, sports: sportsWithRecords })
      : t("{{records}}, all time.", { records: countText })
    : t("{{records}} in the last {{period}}.", {
        records: countText,
        period: activePeriod.toLowerCase()
      });

  return (
    <section className={lit ? "panel training-records-panel is-lit" : "panel training-records-panel"}>
      <header className="pr-head">
        <Stage />
        <div className="pr-head-title">
          <Laurels celebrating={celebrated !== null}>{count}</Laurels>
          <div className="pr-head-copy">
            <h2 className="pr-title">{t("Personal records")}</h2>
            {celebrated ? (
              <p className="pr-announce" key={celebration?.nonce} role="status">
                <span className="pr-announce-spark" aria-hidden="true" />
                {t("New personal record:")} <strong>{recordLabel(celebrated, unitSystem)}</strong>{" "}
                {t("in")} <strong>{formatPersonalRecordHero(celebrated, unitSystem)}</strong>
              </p>
            ) : (
              <p className="pr-summary">
                {count > 0 ? (
                  <>
                    <span>{summary}</span>
                    {newest?.time != null ? (
                      <span>
                        {t("Newest:")}{" "}
                        <strong>
                          {newestDay.length > 1
                            ? t("{{count}} records", { count: newestDay.length })
                            : newest.label}
                        </strong>
                        , {formatRecordTime(newest.time, true)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span>{t("Your fastest efforts and longest days, all in one place.")}</span>
                )}
              </p>
            )}
            {tallyChips.length > 0 ? (
              <ul className="pr-tally-chips">
                {tallyChips.map(({ sport, tally }) => {
                  const Icon = SPORT_ICONS[sport];
                  return (
                    <li className="pr-tally-chip" key={sport}>
                      <Icon size={13} strokeWidth={2} aria-hidden="true" />
                      {[
                        t(HALL_SPORT_LABELS[sport]),
                        `${tally.count} ${t(sessionNoun(sport, tally.count))}`,
                        tally.distance > 0 ? formatDistanceValue(tally.distance, unitSystem) : null
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>

        {groups.length > 0 || spotlight ? (
          <div className="pr-head-side">
            {groups.length > 0 ? (
              <div className="pr-periods" role="tablist" aria-label={t("Record period")}>
                {groups.map((group) => (
                  <button
                    key={group.type}
                    type="button"
                    role="tab"
                    aria-selected={group.type === activeGroup?.type}
                    className={group.type === activeGroup?.type ? "pr-period active" : "pr-period"}
                    onClick={() => setActiveGroupType(group.type)}
                  >
                    {periodLabel(group)}
                  </button>
                ))}
              </div>
            ) : null}
            {spotlight ? (
              <NextPrSpotlight
                label={boardLabel(spotlight.record, unitSystem)}
                best={spotlight.record.duration!}
                predicted={spotlight.info.predicted!}
                reach={spotlight.info.reach ?? 0}
                onShow={() => setStoryType(spotlight.record.type)}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      {hasAnything ? (
        <div className="pr-body" key={activeGroup?.type}>
          <section className="pr-wing" aria-label={t(HALL_SPORT_LABELS.run)}>
            <WingHead sport="run" count={runTally.count} distance={runTally.distance} />
            {records.length > 0 ? (
              <>
                {raceRecords.length > 0 ? (
                  <>
                    <ol
                      className="pr-ladder"
                      style={{ "--pr-rungs": raceRecords.length } as CSSProperties}
                    >
                      {rungs.map(({ record, info }, index) => (
                        <LadderRung
                          key={record.type}
                          index={index}
                          segment={
                            index === raceRecords.length - 1
                              ? "none"
                              : isPersonalRecordPopulated(record) &&
                                  isPersonalRecordPopulated(raceRecords[index + 1]!)
                                ? "solid"
                                : "open"
                          }
                          info={info}
                          selected={storyRung?.record.type === record.type}
                          storyId={storyId}
                          onSelect={() => setStoryType(record.type)}
                          {...recordProps(record)}
                        />
                      ))}
                    </ol>
                    {storyRung ? (
                      <RecordStory
                        id={storyId}
                        record={storyRung.record}
                        info={storyRung.info}
                        activity={
                          storyRung.info.populated
                            ? findRecordActivity(activities, {
                                activityId: storyRung.record.activityId,
                                day: storyRung.info.time,
                                meters: RECORD_DISTANCE_METERS[storyRung.record.type]
                              })
                            : null
                        }
                        history={
                          storyRung.info.populated && storyRung.record.duration
                            ? recordHistory(seenSignatures, storyRung.record.type, {
                                time: storyRung.info.time ?? now,
                                seconds: storyRung.record.duration
                              })
                            : []
                        }
                        onOpenActivity={onOpenActivity}
                      />
                    ) : null}
                  </>
                ) : null}
                {enduranceRecords.length > 0 ? (
                  <div className="pr-figures">
                    {enduranceRecords.map((record, index) => (
                      <EnduranceFigure
                        key={record.type}
                        index={raceRecords.length + index}
                        {...recordProps(record)}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="pr-wing-note">
                {t(
                  "No running records from your COROS dashboard yet. They appear after your next sync."
                )}
              </p>
            )}
          </section>

          {wings
            .filter((wing) => wing.tally.count > 0)
            .map((wing) => (
              <section
                className="pr-wing"
                key={wing.sport}
                aria-label={t(HALL_SPORT_LABELS[wing.sport])}
              >
                <WingHead
                  sport={wing.sport}
                  count={wing.tally.count}
                  distance={wing.tally.distance}
                />
                {wing.records.length > 0 ? (
                  <div className="pr-figures">
                    {wing.records.map((record, index) => (
                      <ActivityFigure
                        key={record.key}
                        record={record}
                        allTime={
                          wing.allTime?.find((candidate) => candidate.key === record.key) ?? null
                        }
                        isAllTime={isAllTime}
                        index={index}
                        isRecent={recentKeys.has(record.key)}
                        series={activitySeries(periodActivities, wing.sport, record.kind)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="pr-wing-note">
                    {t("No {{sport}} records yet.", {
                      sport: midSentence(t(HALL_SPORT_LABELS[wing.sport]))
                    })}
                  </p>
                )}
              </section>
            ))}

          {quietSports.length > 0 ? (
            <p className="pr-quiet">
              <span className="pr-quiet-icons" aria-hidden="true">
                {quietSports.map((sport) => {
                  const Icon = SPORT_ICONS[sport];
                  return <Icon key={sport} size={14} strokeWidth={2} />;
                })}
              </span>
              <span>
                {t("No {{sports}} in the last {{period}}. Their records are under {{allTime}}.", {
                  sports: new Intl.ListFormat(getLocale(), { type: "disjunction" }).format(
                    quietSports.map((sport) => t(sessionNoun(sport, 2)))
                  ),
                  period: activePeriod.toLowerCase(),
                  allTime: t("All time")
                })}
              </span>
            </p>
          ) : null}

          {work && totals.count > 0 ? (
            <div className="pr-lower">
              <section className="pr-work-section" aria-label={t("The work behind them")}>
                <div className="pr-section-head">
                  <h3 className="pr-section-title">{t("The work behind them")}</h3>
                  <p className="pr-section-sub">
                    {work.unit === "week"
                      ? t("Hours trained each week. A medal marks a week you set a record.")
                      : t("Hours trained each month. A medal marks a month you set a record.")}
                  </p>
                </div>
                <RecordWorkChart unit={work.unit} buckets={work.buckets} medals={medals} />
              </section>
              <section className="pr-milestones-section" aria-label={t("Milestones")}>
                <div className="pr-section-head">
                  <h3 className="pr-section-title">{t("Milestones")}</h3>
                </div>
                <MilestoneList milestones={milestones} />
              </section>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pr-empty">
          <Trophy size={22} strokeWidth={1.7} aria-hidden="true" />
          <p>{t("No personal records yet.")}</p>
          <span>
            {localOnly
              ? t("Your longest runs, rides, walks and swims, and the hours behind them appear here after a watch sync.")
              : t("Your running bests from COROS, your longest rides, walks and swims, and the hours behind them appear here after a sync.")}
          </span>
        </div>
      )}
    </section>
  );
}

const isActivityRecord = (record: ActivityRecord | null): record is ActivityRecord =>
  record !== null;

const SPORT_ICONS: Record<HallSport, LucideIcon> = {
  run: Footprints,
  ride: Bike,
  swim: Waves,
  walk: PersonStanding
};

/** "240.2 km" → value and unit, set apart like the board's figures. */
function splitUnit(text: string): { value: string; unit: string | null } {
  const at = text.lastIndexOf(" ");
  return at > 0 && /[a-z/]/i.test(text.slice(at + 1))
    ? { value: text.slice(0, at), unit: text.slice(at + 1) }
    : { value: text, unit: null };
}

function formatActivityRecord(
  record: Pick<ActivityRecord, "kind" | "sport" | "value">,
  unitSystem: UnitSystem
): { value: string; unit: string | null } {
  switch (record.kind) {
    case "distance":
      return splitUnit(
        formatDistanceValue(record.value, unitSystem, {
          swim: record.sport === "swim",
          digits: record.sport === "swim" ? 0 : 2
        })
      );
    case "duration":
      return { value: formatDurationSeconds(record.value), unit: null };
    case "climb":
      return splitUnit(formatElevationMeters(record.value, unitSystem));
    case "speed":
      return splitUnit(formatSpeedValue(record.value, unitSystem));
  }
}

function WingHead({
  sport,
  count,
  distance
}: {
  sport: HallSport;
  count: number;
  distance: number;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const Icon = SPORT_ICONS[sport];
  return (
    <div className="pr-wing-head">
      <Icon className="pr-wing-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <h3 className="pr-wing-title">{t(HALL_SPORT_LABELS[sport])}</h3>
      <span className="pr-wing-rule" aria-hidden="true" />
      {count > 0 ? (
        <span className="pr-wing-meta">
          {count} {t(sessionNoun(sport, count))}
          {distance > 0
            ? `, ${formatDistanceValue(distance, unitSystem, { swim: sport === "swim" })}`
            : ""}
        </span>
      ) : null}
    </div>
  );
}

/** The "New PR" tag is also the replay button. */
function LatestChip({ onCelebrate }: { onCelebrate?: () => void }) {
  useLanguage();
  const logo = <img src={`${PR_ASSET_BASE}/pr-logo_no_bg.png`} alt="" aria-hidden="true" />;
  return onCelebrate ? (
    <button
      type="button"
      className="pr-latest-chip"
      onClick={onCelebrate}
      title={t("Celebrate again")}
    >
      {logo}
      {t("New PR")}
    </button>
  ) : (
    <span className="pr-latest-chip">
      {logo}
      {t("New PR")}
    </span>
  );
}

function entryClass(
  base: string,
  index: number,
  flags: { populated?: boolean; latest?: boolean; best?: boolean; celebrating?: boolean }
): { className: string; style: CSSProperties } {
  return {
    className: [
      base,
      flags.populated === false ? "is-open" : null,
      flags.latest ? "is-latest" : null,
      flags.best ? "is-best" : null,
      flags.celebrating ? "is-celebrating" : null
    ]
      .filter(Boolean)
      .join(" "),
    style: { "--i": index } as CSSProperties
  };
}

type FootContent =
  | { kind: "best" }
  | { kind: "standing"; days: number }
  | {
      kind: "ref";
      key: string;
      value: string;
      note?: string;
      tone?: "reach" | "good";
      title?: string;
    };

function Foot({ content }: { content: FootContent | null }) {
  useLanguage();
  if (!content) {
    return null;
  }

  if (content.kind === "best") {
    return <p className="pr-foot is-best">{t("All-time best")}</p>;
  }

  if (content.kind === "standing") {
    return (
      <p className="pr-foot">
        <span className="pr-foot-key">{t("Standing")}</span>
        <span>{formatStanding(content.days)}</span>
      </p>
    );
  }

  return (
    <p className="pr-foot">
      <span className="pr-foot-key">{content.key}</span>
      <span>{content.value}</span>
      {content.note ? (
        <span
          className={content.tone ? `pr-foot-delta is-${content.tone}` : "pr-foot-delta"}
          title={content.title}
        >
          {content.note}
        </span>
      ) : null}
    </p>
  );
}

function comparisonFoot(
  record: TrainingHubPersonalRecord,
  comparison: RecordComparison | null,
  unitSystem: UnitSystem
): FootContent | null {
  if (!comparison) {
    return null;
  }

  if (comparison.kind === "all-time-best") {
    return { kind: "best" };
  }

  if (comparison.kind === "standing") {
    return comparison;
  }

  if (comparison.kind === "all-time") {
    const allTime = comparison.record;
    const gap =
      !isEnduranceRecord(record) && record.duration && allTime.duration
        ? record.duration - allTime.duration
        : null;
    return {
      kind: "ref",
      key: t("All-time"),
      value: spacedHero(allTime, unitSystem),
      note: gap !== null ? `+${formatDurationSeconds(gap)}` : formatRecordDay(allTime.happenDay),
      title:
        gap !== null
          ? t("{{gap}} slower than your all-time best", { gap: formatDurationSeconds(gap) })
          : undefined
    };
  }

  const predicted = comparison.prediction.predictSeconds!;
  const gap = (record.duration ?? 0) - predicted;
  return {
    kind: "ref",
    key: t("Predicted"),
    value: formatDurationSeconds(predicted),
    ...(Math.abs(gap) < 1
      ? { note: t("on target"), tone: "good" as const }
      : gap > 0
        ? {
            note: t("{{gap}} in reach", { gap: formatDurationSeconds(gap) }),
            tone: "reach" as const,
            title: t("COROS predicts you can run this {{gap}} faster", {
              gap: formatDurationSeconds(gap)
            })
          }
        : {
            note: t("{{gap}} under", { gap: formatDurationSeconds(-gap) }),
            tone: "good" as const,
            title: t("Faster than COROS predicts")
          })
  };
}

interface RecordEntryProps {
  record: TrainingHubPersonalRecord;
  index: number;
  isLatest: boolean;
  comparison: RecordComparison | null;
  prediction: TrainingHubRaceScore | null;
  /** Set while this record's celebration plays; changes restart the animation. */
  celebrationNonce: number | null;
  onCelebrate: () => void;
}

/** One distance on the running ladder: its marker on the rail, then the time set there. */
function LadderRung({
  record,
  index,
  isLatest,
  comparison,
  prediction,
  celebrationNonce,
  onCelebrate,
  segment,
  info,
  selected,
  storyId,
  onSelect
}: RecordEntryProps & {
  segment: "solid" | "open" | "none";
  info: RungInfo;
  selected: boolean;
  storyId: string;
  onSelect: () => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const populated = isPersonalRecordPopulated(record);
  const label = boardLabel(record, unitSystem);
  const pace = formatPersonalRecordMeta(record, unitSystem);
  const celebrating = celebrationNonce !== null;
  const predictedPace =
    prediction?.predictSeconds && RECORD_DISTANCE_METERS[record.type]
      ? formatPersonalRecordMeta(
          { type: record.type, duration: prediction.predictSeconds },
          unitSystem
        )
      : null;
  const { className, style } = entryClass("pr-rung", index, {
    populated,
    latest: isLatest,
    best: comparison?.kind === "all-time-best",
    celebrating
  });
  const hero = populated
    ? formatPersonalRecordHero(record, unitSystem)
    : prediction?.predictSeconds
      ? t("Not raced yet")
      : "—";

  return (
    <li
      key={celebrationNonce === null ? "rung" : `rung-${celebrationNonce}`}
      className={[
        className,
        info.fresh ? "is-fresh" : null,
        selected ? "is-selected" : null
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      data-segment={segment}
    >
      {/* The whole rung picks its story; the chips inside stay their own buttons. */}
      <button
        type="button"
        className="pr-rung-select"
        aria-pressed={selected}
        aria-controls={storyId}
        aria-label={`${label}, ${hero}`}
        onClick={onSelect}
      />
      <div className="pr-rung-head">
        <span className="pr-label">{label}</span>
        {isLatest ? (
          <LatestChip onCelebrate={onCelebrate} />
        ) : info.fresh ? (
          <span className="pr-new-tag">{t("New")}</span>
        ) : null}
      </div>
      <span className="pr-rung-post" aria-hidden="true" />
      <div className="pr-rung-body">
        {populated ? (
          <>
            <p className="pr-value">
              <RollingText
                text={formatPersonalRecordHero(record, unitSystem)}
                rolling={celebrating}
              />
            </p>
            <div className="pr-lines">
              {pace ? <p className="pr-meta">{pace}</p> : null}
              <p className="pr-meta is-date" title={formatRecordDateShort(record.happenDay)}>
                {formatRecordDay(record.happenDay)}
              </p>
              <Foot content={comparisonFoot(record, comparison, unitSystem)} />
              {info.reach !== null ? (
                <span
                  className={info.reach >= 1 ? "pr-reach is-full" : "pr-reach"}
                  aria-hidden="true"
                >
                  <i style={{ width: `${Math.max(4, Math.round(info.reach * 100))}%` }} />
                </span>
              ) : null}
            </div>
          </>
        ) : prediction?.predictSeconds ? (
          <>
            <p
              className="pr-value is-open"
              title={t("Not raced yet. This is the time COROS predicts for you.")}
            >
              {formatDurationSeconds(prediction.predictSeconds)}
            </p>
            <div className="pr-lines">
              <p className="pr-meta">
                {t("Predicted")}
                {predictedPace ? `, ${predictedPace}` : ""}
              </p>
              <p className="pr-foot">{t("Not raced yet")}</p>
            </div>
          </>
        ) : (
          <>
            <p className="pr-value is-open">—</p>
            <div className="pr-lines">
              <p className="pr-foot">{t("Not raced yet")}</p>
            </div>
          </>
        )}
      </div>
      {celebrating ? <RecordBurst key={`burst-${celebrationNonce}`} /> : null}
    </li>
  );
}

/** Longest run and most elevation gain: figures under the ladder. */
function EnduranceFigure({
  record,
  index,
  isLatest,
  comparison,
  celebrationNonce,
  onCelebrate
}: RecordEntryProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const populated = isPersonalRecordPopulated(record);
  const isLongestRun = record.type === RECORD_TYPE_LONGEST_RUN;
  const { value, unit } = splitHero(formatPersonalRecordHero(record, unitSystem));
  const pace = isLongestRun ? formatPersonalRecordMeta(record, unitSystem) : null;
  const celebrating = celebrationNonce !== null;
  const { className, style } = entryClass("pr-figure", index, {
    populated,
    latest: isLatest,
    best: comparison?.kind === "all-time-best",
    celebrating
  });

  return (
    <article
      key={celebrationNonce === null ? "figure" : `figure-${celebrationNonce}`}
      className={className}
      style={style}
    >
      <div className="pr-figure-head">
        <span className="pr-label">{boardLabel(record, unitSystem)}</span>
        {isLatest ? <LatestChip onCelebrate={onCelebrate} /> : null}
      </div>
      {populated ? (
        <>
          <p className="pr-value">
            <RollingText text={value} rolling={celebrating} />
            {unit ? <span className="pr-unit">{unit}</span> : null}
          </p>
          <div className="pr-lines">
            {isLongestRun && record.duration ? (
              <p className="pr-meta">
                {formatDurationSeconds(record.duration)}
                {pace ? `, ${pace}` : ""}
              </p>
            ) : null}
            <p className="pr-meta is-date" title={formatRecordDateShort(record.happenDay)}>
              {formatRecordDay(record.happenDay)}
            </p>
            <Foot content={comparisonFoot(record, comparison, unitSystem)} />
          </div>
        </>
      ) : (
        <>
          <p className="pr-value is-open">—</p>
          <div className="pr-lines">
            <p className="pr-foot">{isLongestRun ? t("No run yet") : t("No climb yet")}</p>
          </div>
        </>
      )}
      {celebrating ? <RecordBurst key={`burst-${celebrationNonce}`} /> : null}
    </article>
  );
}

/** A best computed from the activity list: rides, swims and walks. */
function ActivityFigure({
  record,
  allTime,
  isAllTime,
  index,
  isRecent,
  series = []
}: {
  record: ActivityRecord;
  allTime: ActivityRecord | null;
  isAllTime: boolean;
  index: number;
  isRecent: boolean;
  /** The metric across the period's sessions, oldest first: a faint sparkline. */
  series?: number[];
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const { value, unit } = formatActivityRecord(record, unitSystem);
  const foot: FootContent =
    !isAllTime && allTime
      ? allTime.activity.activityId === record.activity.activityId ||
        record.value >= allTime.value - 1e-6
        ? { kind: "best" }
        : {
            kind: "ref",
            key: t("All-time"),
            value: (({ value: allValue, unit: allUnit }) =>
              allUnit ? `${allValue} ${allUnit}` : allValue)(
              formatActivityRecord(allTime, unitSystem)
            ),
            note: formatRecordTime(allTime.time)
          }
      : { kind: "standing", days: Math.floor((Date.now() - record.time) / DAY_MS) };
  const isLatest = isRecent && (isAllTime || foot.kind === "best");
  const { className, style } = entryClass("pr-figure", index, {
    latest: isLatest,
    best: foot.kind === "best"
  });

  return (
    <article className={`${className} is-card`} style={style}>
      {series.length >= 3 ? <Sparkline values={series} /> : null}
      <div className="pr-figure-head">
        <span className="pr-label">{t(record.label)}</span>
        {isLatest ? <LatestChip /> : null}
      </div>
      <p className="pr-value">
        {value}
        {unit ? <span className="pr-unit">{unit}</span> : null}
      </p>
      <div className="pr-lines">
        <p className="pr-meta is-name">
          {record.activity.name ?? t(HALL_SPORT_LABELS[record.sport])}
        </p>
        <p className="pr-meta is-date" title={formatRecordTime(record.time, true)}>
          {formatRecordTime(record.time)}
        </p>
        <Foot content={foot} />
      </div>
    </article>
  );
}

function MilestoneList({ milestones }: { milestones: Milestones }) {
  useLanguage();
  const { biggestWeek, longestStreak, hardestSession, longestSession } = milestones;
  const sessionDetail = (activity: TrainingHubActivity) =>
    [activity.name, activity.startTime ? formatRecordTime(activityTime(activity)) : null]
      .filter(Boolean)
      .join(", ");
  const items: { key: string; label: string; value: string; unit?: string; detail: string }[] =
    [];

  if (biggestWeek) {
    items.push({
      key: "week",
      label: t("Biggest week"),
      value: formatHours(biggestWeek.seconds),
      detail: t("Week of {{date}}, {{sessions}}", {
        date: formatRecordTime(biggestWeek.start),
        sessions:
          biggestWeek.count === 1
            ? t("1 session")
            : t("{{count}} sessions", { count: biggestWeek.count })
      })
    });
  }
  if (longestStreak && longestStreak.days > 1) {
    items.push({
      key: "streak",
      label: t("Longest streak"),
      value: String(longestStreak.days),
      unit: t("days in a row"),
      detail: t("Through {{date}}", { date: formatRecordTime(longestStreak.end) })
    });
  }
  if (hardestSession?.trainingLoad) {
    items.push({
      key: "hardest",
      label: t("Hardest session"),
      value: String(Math.round(hardestSession.trainingLoad)),
      unit: t("load"),
      detail: sessionDetail(hardestSession)
    });
  }
  const longestSeconds = longestSession ? activityMovingSeconds(longestSession) : undefined;
  if (longestSession && longestSeconds) {
    items.push({
      key: "longest",
      label: t("Longest session"),
      value: formatDurationSeconds(longestSeconds),
      detail: sessionDetail(longestSession)
    });
  }

  return (
    <ul className="pr-milestones">
      {items.map(({ key, label, value, unit, detail }) => {
        const Icon = MILESTONE_ICONS[key] ?? Trophy;
        return (
        <li className="pr-milestone" key={key} data-kind={key}>
          <span className="pr-milestone-tile" aria-hidden="true">
            <Icon size={16} strokeWidth={2} />
          </span>
          <div className="pr-milestone-copy">
            <span className="pr-milestone-label">{label}</span>
            <span className="pr-milestone-detail">{detail}</span>
          </div>
          <p className="pr-milestone-value">
            {value}
            {unit ? <small>{unit}</small> : null}
          </p>
        </li>
        );
      })}
    </ul>
  );
}

const MILESTONE_ICONS: Record<string, LucideIcon> = {
  week: ChartColumn,
  streak: Flame,
  hardest: Activity,
  longest: Timer
};

/** What the ladder knows about one distance beyond COROS's own record. */
interface RungInfo {
  populated: boolean;
  /** Epoch ms of the day the record was set. */
  time: number | null;
  /** Set within the last FRESH_RECORD_DAYS days. */
  fresh: boolean;
  /** COROS's predicted time, when it has one for this distance. */
  predicted: number | null;
  /** Record minus predicted, in seconds: positive is time in reach. */
  gap: number | null;
  /** 0–1, how close the record sits to the predicted time. */
  reach: number | null;
}

/** A faint area sparkline behind a figure; decoration only. */
function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = 120 / (values.length - 1);
  const line = values
    .map((value, index) => `${index ? "L" : "M"}${(index * step).toFixed(1)},${(46 - ((value - min) / span) * 34).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="pr-sparkline" viewBox="0 0 120 50" preserveAspectRatio="none" aria-hidden="true">
      <path className="pr-sparkline-area" d={`${line} L120,50 L0,50 Z`} />
      <path className="pr-sparkline-line" d={line} />
    </svg>
  );
}

/** The banner's "Next PR in reach": the distance COROS says is closest to falling. */
function NextPrSpotlight({
  label,
  best,
  predicted,
  reach,
  onShow
}: {
  label: string;
  best: number;
  predicted: number;
  reach: number;
  onShow: () => void;
}) {
  useLanguage();
  return (
    <button type="button" className="pr-spotlight" onClick={onShow}>
      <span className="pr-spotlight-eyebrow">
        <Target size={12} strokeWidth={2.4} aria-hidden="true" />
        {t("Next PR in reach")}
      </span>
      <span className="pr-spotlight-row">
        <strong>{label}</strong>
        <span className="pr-spotlight-gap">
          {t("{{gap}} to find", { gap: formatDurationSeconds(best - predicted) })}
        </span>
      </span>
      <span className="pr-reach is-spotlight" aria-hidden="true">
        <i style={{ width: `${Math.max(4, Math.round(reach * 100))}%` }} />
      </span>
      <span className="pr-spotlight-note">
        {t("Predicted {{predicted}} vs best {{best}}", {
          predicted: formatDurationSeconds(predicted),
          best: formatDurationSeconds(best)
        })}
      </span>
    </button>
  );
}

/**
 * The picked distance's story: where it was set, how it has come down over
 * the records the app has seen, and what COROS says is still in it.
 */
function RecordStory({
  id,
  record,
  info,
  activity,
  history,
  onOpenActivity
}: {
  id: string;
  record: TrainingHubPersonalRecord;
  info: RungInfo;
  activity: TrainingHubActivity | null;
  history: RecordHistoryPoint[];
  onOpenActivity?: (activity: TrainingHubActivity) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const label = boardLabel(record, unitSystem);
  const seconds = record.duration ?? 0;
  // History only speaks for a record that is the best the app has seen.
  const last = history.at(-1);
  const isNewestBest =
    info.populated && last !== undefined && last.seconds === seconds && last.time === (info.time ?? last.time);
  const steps = isNewestBest ? history : [];
  const yearAgo = steps.length > 1 ? bestAsOf(steps, Date.now() - 365 * DAY_MS) : null;
  const previous = steps.length > 1 ? steps[steps.length - 2]! : null;
  const date = info.time !== null ? formatRecordTime(info.time, true) : null;

  const sentences: string[] = [];
  if (!info.populated) {
    sentences.push(t("You have not raced this distance yet."));
  } else if (activity?.name && date) {
    sentences.push(t("Set in “{{name}}” on {{date}}.", { name: activity.name, date }));
  } else if (date) {
    sentences.push(t("Set on {{date}}.", { date }));
  }
  if (yearAgo && yearAgo.seconds > seconds) {
    sentences.push(
      t("{{gap}} faster than a year ago.", { gap: formatDurationSeconds(yearAgo.seconds - seconds) })
    );
  } else if (previous && previous.seconds > seconds) {
    sentences.push(
      t("{{gap}} faster than your previous best from {{date}}.", {
        gap: formatDurationSeconds(previous.seconds - seconds),
        date: formatRecordTime(previous.time, true)
      })
    );
  }
  if (info.gap !== null && info.predicted !== null) {
    sentences.push(
      info.gap >= 1
        ? t("COROS predicts {{time}}, so {{gap}} is in reach.", {
            time: formatDurationSeconds(info.predicted),
            gap: formatDurationSeconds(info.gap)
          })
        : t("Faster than COROS predicts.")
    );
  }

  return (
    <section
      id={id}
      className={info.fresh ? "pr-story is-fresh" : "pr-story"}
      aria-live="polite"
      aria-label={t("{{distance}} story", { distance: label })}
    >
      <div className="pr-story-copy">
        <p className="pr-story-eyebrow">
          {!info.populated
            ? t("Not raced yet")
            : date === null
              ? t("Standing record")
              : info.fresh
                ? t("Fresh record · {{date}}", { date })
                : t("Standing record · {{date}}", { date })}
        </p>
        <h4 className="pr-story-title">
          {label}
          {info.populated ? <span> · {formatPersonalRecordHero(record, unitSystem)}</span> : null}
        </h4>
        {sentences.length ? <p className="pr-story-text">{sentences.join(" ")}</p> : null}
        {activity && onOpenActivity ? (
          <button type="button" className="pr-story-open" onClick={() => onOpenActivity(activity)}>
            {t("Open the activity")}
            <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <StoryChart label={label} steps={steps} />
    </section>
  );
}

/** Best time over the records the app has seen: a staircase, faster upward. */
function StoryChart({ label, steps }: { label: string; steps: RecordHistoryPoint[] }) {
  useLanguage();
  const gradient = `pr-story-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (steps.length < 2) {
    return (
      <div className="pr-story-chart is-empty">
        <p>
          {t("Your best-time history fills in here as CorosLink sees new records for this distance.")}
        </p>
      </div>
    );
  }
  const now = Date.now();
  const first = steps[0]!;
  const last = steps.at(-1)!;
  const from = first.time;
  const to = Math.max(now, last.time + DAY_MS);
  const slow = first.seconds;
  const fast = last.seconds;
  const x = (time: number) => 12 + ((time - from) / (to - from || 1)) * 476;
  const y = (seconds: number) => 14 + ((seconds - fast) / (slow - fast || 1)) * 88;
  let line = `M${x(first.time).toFixed(1)},${y(first.seconds).toFixed(1)}`;
  for (const point of steps.slice(1)) {
    line += ` H${x(point.time).toFixed(1)} V${y(point.seconds).toFixed(1)}`;
  }
  line += ` H${x(to).toFixed(1)}`;
  const axis = (time: number) =>
    getDateTimeFormat({ month: "short", year: "numeric" }).format(new Date(time));
  return (
    <div className="pr-story-chart">
      <div className="pr-story-chart-head">
        <span>{t("Best time over time")}</span>
        <span>
          {t("Faster")}
          <ArrowUp size={11} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </div>
      <div className="pr-story-plot">
      <svg
        viewBox="0 0 500 120"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("{{distance}} best time went from {{from}} to {{to}}", {
          distance: label,
          from: formatDurationSeconds(first.seconds),
          to: formatDurationSeconds(last.seconds)
        })}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--pr-gold)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--pr-gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} V120 H${x(first.time).toFixed(1)} Z`} fill={`url(#${gradient})`} />
        <path className="pr-story-line" d={line} />
      </svg>
      <div className="pr-story-dots" aria-hidden="true">
        {steps.map((point, index) => (
          <i
            key={point.time}
            className={index === steps.length - 1 ? "is-current" : undefined}
            style={{ left: `${(x(point.time) / 500) * 100}%`, top: `${(y(point.seconds) / 120) * 100}%` }}
          />
        ))}
      </div>
      </div>
      <div className="pr-story-axis">
        <span>{axis(from)}</span>
        <span>{axis(now)}</span>
      </div>
    </div>
  );
}

function activityTime(activity: TrainingHubActivity): number {
  const value = activity.startTime ?? 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}
