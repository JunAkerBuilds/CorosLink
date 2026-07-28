import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  Dumbbell,
  FlaskConical,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCw,
  Timer,
  TrendingUp,
  Trophy,
  Weight
} from "lucide-react";
import type { StrengthSession, TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatDurationSeconds } from "../training/formatters";
import { resolveExerciseName } from "../training/exerciseNames";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import { resolveMuscleView } from "./bodyFocus";
import { BodyMapV2, type BodyView } from "./BodyMapV2";
import { MusclePanel } from "./MusclePanel";
import { MUSCLE_BY_ID, type MuscleId } from "./muscles";
import { buildSampleStrengthSessions } from "./sampleSessions";
import {
  buildStrengthAnalytics,
  formatSets,
  formatVolumeKg,
  formatWeightKg,
  type HeatMetric
} from "./strengthAnalytics";
import "./strength.css";
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
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 180, label: "6m" },
  { days: 365, label: "1y" }
];

const METRIC_OPTIONS: { id: HeatMetric; label: string }[] = [
  { id: "sets", label: "Sets" },
  { id: "volume", label: "Volume" },
  { id: "time", label: "Time" }
];

/** Chunks are drained in a loop; this caps a runaway backfill. */
const MAX_SYNC_ROUNDS = 60;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSessionDate(startTime?: number): string {
  if (!startTime) {
    return "Unknown date";
  }
  return new Date(startTime * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function StatTile({
  icon,
  label,
  value,
  meta
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="strength-tile">
      <span className="strength-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="strength-tile-label">{label}</span>
      <strong className="strength-tile-value">{value}</strong>
      {meta ? <span className="strength-tile-meta">{meta}</span> : null}
    </div>
  );
}

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="training-zone-tooltip training-chart-tooltip">
      <span>Week of {label}</span>
      {payload.map((entry) => (
        <strong key={String(entry.dataKey)}>
          {entry.name}: {entry.value}
        </strong>
      ))}
    </div>
  );
}

export function StrengthView({
  api,
  status,
  onOpenTraining,
  showDevelopmentTools = false
}: StrengthViewProps) {
  const { unitSystem } = useUnitSystem();
  const connected = Boolean(status?.authenticated);
  const { colors } = useChartColors();

  const [days, setDays] = useState(90);
  const [loadedSessions, setLoadedSessions] = useState<StrengthSession[]>([]);
  const [sampleMode, setSampleMode] = useState(false);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BodyView>("front");
  const [viewRequest, setViewRequest] = useState(0);
  const [metric, setMetric] = useState<HeatMetric>("sets");
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(null);
  // Hover remains a transient highlight on the mannequin. The right-hand
  // panel changes only after an explicit click, so it never jumps while the
  // pointer crosses muscle shells or ranking rows.
  const [figureHover, setFigureHover] = useState<MuscleId | null>(null);
  const [listHover, setListHover] = useState<MuscleId | null>(null);
  const syncSequenceRef = useRef(0);

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
      if (!connected) {
        return;
      }

      const sequence = ++syncSequenceRef.current;
      setLoading(true);
      setError(null);

      try {
        let result = await api.syncStrengthHistory(days, force);
        if (syncSequenceRef.current !== sequence) {
          return;
        }
        setLoadedSessions(result.sessions);
        setPending(result.pending);

        // Keep draining while COROS still owes us breakdowns; each round
        // repaints the body map so it fills in as the history arrives.
        for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
          if (result.pending <= 0) {
            break;
          }
          const next = await api.syncStrengthHistory(days, false);
          if (syncSequenceRef.current !== sequence) {
            return;
          }
          setLoadedSessions(next.sessions);
          setPending(next.pending);
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
        }
      }
    },
    [api, connected, days]
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

  const highlightedMuscle = figureHover ?? listHover ?? selectedMuscle;
  const panelMuscle = selectedMuscle;
  const heatMax = analytics.muscleMax[metric];

  const chartData = useMemo(
    () =>
      analytics.weeks.map((week) => ({
        label: week.label,
        volume: Math.round(kilogramsToDisplayWeight(week.volumeKg, unitSystem)),
        sets: Math.round(week.sets)
      })),
    [analytics.weeks, unitSystem]
  );

  const topLifts = useMemo(
    () =>
      analytics.exercises
        .filter((exercise) => exercise.bestE1rmKg > 0)
        .sort((a, b) => b.bestE1rmKg - a.bestE1rmKg)
        .slice(0, 8),
    [analytics.exercises]
  );

  const balanceTotal =
    analytics.balance.push +
    analytics.balance.pull +
    analytics.balance.legs +
    analytics.balance.core;

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

  if (!connected && !sampleMode) {
    return (
      <section className="strength-view">
        <header className="strength-header">
          <div>
            <p className="eyebrow">Resistance training</p>
            <h2>Strength</h2>
            <p>
              Explore your COROS strength workload on a detailed anatomical
              muscle model.
            </p>
          </div>
          <div className="strength-header-icon" aria-hidden="true">
            <Dumbbell size={22} />
          </div>
        </header>

        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>Connect COROS first</h3>
            <p>
              Strength analysis reads the set-by-set breakdown of your gym
              sessions from your Training Hub account.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenTraining}>
            Open Training Hub
          </button>
        </section>

        {sampleButton ? (
          <div className="strength-sample-cta">{sampleButton}</div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="strength-view">
      <header className="strength-header">
        <div>
          <p className="eyebrow">Resistance training</p>
          <h2>Strength</h2>
          <p>
            Explore your COROS strength workload on a detailed anatomical
            muscle model.
          </p>
        </div>
        <div className="strength-header-controls">
          <div className="strength-segmented" role="group" aria-label="Time window">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                className={days === option.days ? "is-active" : ""}
                aria-pressed={days === option.days}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={loading || sampleMode}
            onClick={() => void runSync(true)}
          >
            {loading ? (
              <Loader2 className="spin" size={15} aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
      </header>

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

      {pending > 0 && !sampleMode ? (
        <p className="strength-notice" role="status">
          <Loader2 className="spin" size={14} aria-hidden="true" />
          Reading {pending} more session{pending === 1 ? "" : "s"} from COROS.
          The map fills in as they arrive.
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
              {METRIC_OPTIONS.map((option) => (
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
        </section>
      </div>

      <div className="strength-tiles">
        <StatTile
          icon={<Dumbbell size={16} />}
          label="Sessions"
          value={String(analytics.summary.sessions)}
          meta={`${analytics.summary.sessionsPerWeek.toFixed(1)} per week`}
        />
        <StatTile
          icon={<TrendingUp size={16} />}
          label="Volume"
          value={formatVolumeKg(analytics.summary.volumeKg, unitSystem)}
          meta={`${formatVolumeKg(analytics.summary.avgSessionVolumeKg, unitSystem)} per session`}
        />
        <StatTile
          icon={<RotateCw size={16} />}
          label="Sets"
          value={String(Math.round(analytics.summary.sets))}
          meta={`${Math.round(analytics.summary.reps)} reps`}
        />
        <StatTile
          icon={<Timer size={16} />}
          label="Time"
          value={formatDurationSeconds(analytics.summary.durationSec)}
          meta={
            analytics.summary.trainingLoad > 0
              ? `${Math.round(analytics.summary.trainingLoad)} training load`
              : undefined
          }
        />
        <StatTile
          icon={<Trophy size={16} />}
          label="Best est. 1RM"
          value={
            analytics.summary.bestE1rm
              ? formatWeightKg(analytics.summary.bestE1rm.e1rmKg, unitSystem)
              : "No data"
          }
          meta={analytics.summary.bestE1rm?.name}
        />
        <StatTile
          icon={<Weight size={16} />}
          label="Heaviest set"
          value={
            analytics.summary.heaviestLift
              ? formatWeightKg(analytics.summary.heaviestLift.weightKg, unitSystem)
              : "No data"
          }
          meta={
            analytics.summary.heaviestLift
              ? `${analytics.summary.heaviestLift.name} × ${analytics.summary.heaviestLift.reps}`
              : undefined
          }
        />
      </div>

      <div className="strength-grid">
        <section className="panel strength-trend-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Weekly</p>
              <h3>Volume &amp; sets</h3>
            </div>
            <div className="training-chart-legend" aria-hidden="true">
              <span className="training-chart-legend-item">
                <span className="training-chart-legend-dot is-accent" />
                Volume
              </span>
              <span className="training-chart-legend-item">
                <span className="training-chart-legend-line is-gold" />
                Sets
              </span>
            </div>
          </div>
          {chartData.length === 0 ? (
            <p className="strength-panel-empty">Not enough weeks to chart yet.</p>
          ) : (
            <div className="strength-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={trainingChartMargin}>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={colors.text}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    minTickGap={18}
                  />
                  <YAxis
                    yAxisId="volume"
                    stroke={colors.text}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={46}
                  />
                  <YAxis
                    yAxisId="sets"
                    orientation="right"
                    stroke={colors.text}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={32}
                  />
                  <Tooltip
                    content={(props) => <TrendTooltip {...props} />}
                    contentStyle={trainingChartTooltipStyle}
                    cursor={{ fill: colors.cursor }}
                  />
                  <Bar
                    yAxisId="volume"
                    dataKey="volume"
                        name={`Volume (${weightUnit(unitSystem)})`}
                    fill={colors.accent}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Line
                    yAxisId="sets"
                    type="monotone"
                    dataKey="sets"
                    name="Sets"
                    stroke={colors.gold}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="panel strength-balance-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Movement mix</p>
              <h3>Balance</h3>
            </div>
          </div>
          <ul className="strength-balance">
            {(
              [
                ["push", "Push"],
                ["pull", "Pull"],
                ["legs", "Legs"],
                ["core", "Core"]
              ] as const
            ).map(([key, label]) => {
              const value = analytics.balance[key];
              const share = balanceTotal > 0 ? value / balanceTotal : 0;
              return (
                <li key={key}>
                  <span className="strength-balance-label">{label}</span>
                  <span className="strength-balance-track" aria-hidden="true">
                    <span
                      className={`strength-balance-fill is-${key}`}
                      style={{ transform: `scaleX(${share})` }}
                    />
                  </span>
                  <span className="strength-balance-value">
                    {Math.round(share * 100)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="strength-balance-note">
            Share of working sets. Assistance muscles count partially, so a
            bench press leans push without erasing its triceps work.
            {analytics.mobilitySets > 0 || analytics.unmappedSets > 0 ? (
              <>
                {" "}
                Excludes{" "}
                {[
                  analytics.mobilitySets > 0
                    ? `${Math.round(analytics.mobilitySets)} warm-up and mobility`
                    : null,
                  analytics.unmappedSets > 0
                    ? `${Math.round(analytics.unmappedSets)} unrecognised`
                    : null
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                set
                {Math.round(analytics.mobilitySets + analytics.unmappedSets) === 1
                  ? ""
                  : "s"}
                .
              </>
            ) : null}
          </p>
        </section>
      </div>

      <div className="strength-grid">
        <section className="panel strength-lifts-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Estimated one-rep max</p>
              <h3>Top lifts</h3>
            </div>
          </div>
          {topLifts.length === 0 ? (
            <p className="strength-panel-empty">
              No loaded sets in this window. Bodyweight work doesn&apos;t
              produce a 1RM estimate.
            </p>
          ) : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Exercise</th>
                    <th>Best set</th>
                    <th>Est. 1RM</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {topLifts.map((lift) => (
                    <tr key={lift.name}>
                      <td>
                        <span className="strength-lift-name">{lift.name}</span>
                        <span className="strength-lift-meta">
                          {lift.sessions} session
                          {lift.sessions === 1 ? "" : "s"} ·{" "}
                          {formatSets(lift.sets)} sets
                        </span>
                      </td>
                      <td>{formatWeightKg(lift.bestWeightKg, unitSystem)}</td>
                      <td>{formatWeightKg(lift.bestE1rmKg, unitSystem)}</td>
                      <td>
                        {lift.e1rmTrendKg === undefined ? (
                          <span className="strength-trend is-flat">No data</span>
                        ) : (
                          <span
                            className={`strength-trend ${
                              lift.e1rmTrendKg > 0.5
                                ? "is-up"
                                : lift.e1rmTrendKg < -0.5
                                  ? "is-down"
                                  : "is-flat"
                            }`}
                          >
                            {lift.e1rmTrendKg > 0 ? "+" : ""}
                                {kilogramsToDisplayWeight(lift.e1rmTrendKg, unitSystem).toFixed(1)} {weightUnit(unitSystem)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel strength-sessions-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">History</p>
              <h3>Recent sessions</h3>
            </div>
          </div>
          {sessions.length === 0 ? (
            <p className="strength-panel-empty">No sessions in this window.</p>
          ) : (
            <ul className="strength-sessions">
              {sessions.slice(0, 10).map((session) => {
                const summary = session.detail.summary;
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
                      <span>{formatSessionDate(session.startTime)}</span>
                    </div>
                    <div className="strength-session-stats">
                      <span>{summary.sets} sets</span>
                      <span>{summary.totalReps} reps</span>
                      <span>
                        {volume > 0 ? formatVolumeKg(volume, unitSystem) : "Bodyweight"}
                      </span>
                      <span>{formatDurationSeconds(summary.durationSec)}</span>
                    </div>
                    <div className="strength-session-chips">
                      {session.detail.exercises.slice(0, 4).map((exercise, index) => (
                        <span key={`${exercise.nameKey}-${index}`}>
                          {exercise.sets}×{" "}
                          {resolveExerciseName(exercise.nameKey, exercise.rawName)}
                        </span>
                      ))}
                      {session.detail.exercises.length > 4 ? (
                        <span className="is-more">
                          +{session.detail.exercises.length - 4}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
