import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Bike,
  Clock,
  Dumbbell,
  Flame,
  Footprints,
  Gauge,
  Layers,
  ListChecks,
  Mountain,
  Pause,
  Repeat,
  Route,
  Snowflake,
  Timer,
  Waves,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useMemo } from "react";
import type {
  TrainingHubScheduledWorkoutEntry,
  TrainingHubSportType,
  WorkoutSport
} from "../../electron/types";
import {
  WORKOUT_SPORT_CAPABILITIES,
  workoutSportFromType
} from "../../electron/workoutCapabilities";
import {
  formatDurationSeconds,
  formatUpcomingWorkoutLoad,
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import {
  sportColorCategory,
  type SportColorCategory
} from "../training/sportColors";
import { resolveSportName } from "../training/sportTypes";
import {
  buildScheduledWorkoutView,
  formatStepDistanceLabel,
  formatStepTimeLabel,
  type ScheduledNodeView,
  type ScheduledStepKind,
  type ScheduledStepView,
  type ScheduledStructureView
} from "./scheduledStructure";

interface ScheduledWorkoutDetailProps {
  entry: TrainingHubScheduledWorkoutEntry;
  sportTypes: TrainingHubSportType[];
}

const KIND_ICON: Record<ScheduledStepKind, LucideIcon> = {
  warmup: Flame,
  training: Zap,
  rest: Pause,
  cooldown: Snowflake,
  sendOff: Timer
};

const KIND_LABEL: Record<ScheduledStepKind, string> = {
  warmup: "Warm-up",
  training: "Main",
  rest: "Rest",
  cooldown: "Cool-down",
  sendOff: "Send-off"
};

const KIND_ORDER: ScheduledStepKind[] = [
  "warmup",
  "training",
  "rest",
  "cooldown",
  "sendOff"
];

/**
 * Scheduled workouts carry COROS *program* sport codes (1–9), not activity
 * codes — resolve them via the shared workout capabilities so icons/colors
 * stay in sync with the workout editor.
 */
const SPORT_VIEW: Record<
  WorkoutSport,
  { category: SportColorCategory; icon: LucideIcon }
> = {
  run: { category: "run", icon: Footprints },
  trailRun: { category: "trail", icon: Mountain },
  bike: { category: "bike", icon: Bike },
  swim: { category: "other", icon: Waves },
  strength: { category: "strength", icon: Dumbbell },
  hyrox: { category: "other", icon: Activity },
  indoorClimb: { category: "other", icon: Mountain },
  bouldering: { category: "other", icon: Mountain },
  xcSki: { category: "other", icon: Snowflake }
};

function stepMagnitudeLabel(step: ScheduledStepView): string | undefined {
  if (step.magnitude === undefined || !step.magnitudeType) {
    return undefined;
  }
  return step.magnitudeType === "distance"
    ? formatStepDistanceLabel(step.magnitude)
    : formatStepTimeLabel(step.magnitude);
}

function flatSteps(view: ScheduledStructureView): ScheduledStepView[] {
  const steps: ScheduledStepView[] = [];
  for (const node of view.nodes) {
    if (node.type === "step") {
      steps.push(node.step);
    } else {
      steps.push(...node.steps);
    }
  }
  return steps;
}

export function ScheduledWorkoutDetail({
  entry,
  sportTypes
}: ScheduledWorkoutDetailProps) {
  const reduceMotion = useReducedMotion();
  const view = useMemo(() => buildScheduledWorkoutView(entry), [entry]);
  const sport = workoutSportFromType(entry.sportType);
  const sportMeta = sport ? SPORT_VIEW[sport] : undefined;
  const category =
    sportMeta?.category ?? sportColorCategory(entry.sportType);
  const sportName = sport
    ? WORKOUT_SPORT_CAPABILITIES[sport].label
    : (resolveSportName({ sportType: entry.sportType }, sportTypes) ??
      "Workout");
  const workoutCategory = inferUpcomingWorkoutCategory(entry.name);
  // The name classifier is run-centric — only surface its chip when it found
  // a real intent (or the sport actually is running) to avoid a bogus "Run"
  // badge on swims/rides/strength sessions.
  const showCategoryChip =
    category === "run" || category === "trail" || workoutCategory !== "Run";
  const isStrength = sport === "strength";
  const SportIcon = sportMeta?.icon ?? Activity;

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.28, delay, ease: "easeOut" as const }
        };

  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [
    {
      icon: Route,
      label: "Volume",
      value: formatUpcomingWorkoutVolumeDisplay(entry.volume)
    },
    {
      icon: Gauge,
      label: "Planned load",
      value: formatUpcomingWorkoutLoad(entry.trainingLoad)
    }
  ];
  if (view.totals.durationSeconds) {
    stats.push({
      icon: Clock,
      label: "Est. duration",
      value: formatDurationSeconds(view.totals.durationSeconds)
    });
  }
  if (view.totals.stepCount > 0) {
    stats.push({
      icon: Layers,
      label: "Structure",
      value:
        view.totals.repeatGroups > 0
          ? `${view.totals.stepCount} steps · ${view.totals.repeatGroups}× repeat`
          : `${view.totals.stepCount} step${view.totals.stepCount === 1 ? "" : "s"}`
    });
  }

  return (
    <div className={`sched-detail is-${category}`}>
      <motion.div className="sched-hero" {...rise(0)}>
        <div className="sched-hero-top">
          <span className="sched-hero-icon" aria-hidden="true">
            <SportIcon size={20} />
          </span>
          <div className="sched-hero-title">
            <span className="sched-hero-sport">{sportName}</span>
            {showCategoryChip ? (
              <span className="sched-hero-chip">{workoutCategory}</span>
            ) : null}
          </div>
        </div>
        <div className="sched-hero-stats">
          {stats.map((stat) => (
            <div className="sched-stat" key={stat.label}>
              <span className="sched-stat-label">
                <stat.icon size={12} aria-hidden="true" />
                {stat.label}
              </span>
              <strong className="sched-stat-value">{stat.value}</strong>
            </div>
          ))}
        </div>
      </motion.div>

      {view.nodes.length > 0 ? (
        <motion.div className="sched-structure" {...rise(0.06)}>
          <div className="sched-structure-head">
            <h4>
              <ListChecks size={14} aria-hidden="true" />
              Workout structure
            </h4>
            {view.totals.distanceMeters ? (
              <span className="sched-structure-total">
                {formatStepDistanceLabel(view.totals.distanceMeters)} total
              </span>
            ) : null}
          </div>
          {isStrength ? (
            <StrengthStructure view={view} />
          ) : (
            <CardioStructure view={view} />
          )}
        </motion.div>
      ) : (
        <motion.div className="sched-empty" {...rise(0.06)}>
          <ListChecks size={18} aria-hidden="true" />
          <p>No structured steps — this workout runs by feel.</p>
        </motion.div>
      )}
    </div>
  );
}

/* ---------------- cardio (run / ride / swim / other) ---------------- */

type ScheduledRepeatViewExtract = Extract<ScheduledNodeView, { type: "repeat" }>;

interface BarSegment {
  key: string;
  kind: ScheduledStepKind;
  grow: number;
  label: string;
}

function buildBarSegments(view: ScheduledStructureView): BarSegment[] {
  const segments: BarSegment[] = [];
  const push = (step: ScheduledStepView, key: string, repeat?: number) => {
    const magnitude = stepMagnitudeLabel(step);
    const label = [
      step.name,
      repeat && repeat > 1 ? `×${repeat}` : null,
      magnitude ?? step.targetLabel ?? null
    ]
      .filter(Boolean)
      .join(" · ");
    segments.push({ key, kind: step.kind, grow: step.magnitude ?? 0, label });
  };

  for (const node of view.nodes) {
    if (node.type === "step") {
      push(node.step, node.step.id);
    } else {
      for (let round = 0; round < node.repeat; round += 1) {
        for (const step of node.steps) {
          push(step, `${node.id}-${round}-${step.id}`, node.repeat);
        }
      }
    }
  }

  const max = Math.max(0, ...segments.map((segment) => segment.grow));
  if (max <= 0) {
    return segments.map((segment) => ({ ...segment, grow: 1 }));
  }
  // Floor tiny segments (short recoveries) so they stay visible.
  const floor = max * 0.035;
  return segments.map((segment) => ({
    ...segment,
    grow: segment.grow > 0 ? Math.max(segment.grow, floor) : floor
  }));
}

function CardioStructure({ view }: { view: ScheduledStructureView }) {
  const segments = buildBarSegments(view);
  const kindsPresent = KIND_ORDER.filter((kind) =>
    view.nodes.some((node) =>
      node.type === "step"
        ? node.step.kind === kind
        : node.steps.some((step) => step.kind === kind)
    )
  );

  return (
    <>
      <div
        className="sched-bar"
        role="img"
        aria-label={`Workout structure: ${segments
          .map((segment) => segment.label)
          .join(", ")}`}
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`sched-bar-segment is-${segment.kind}`}
            style={{ flexGrow: segment.grow }}
            title={segment.label}
          />
        ))}
      </div>
      {kindsPresent.length > 1 ? (
        <div className="sched-legend" aria-hidden="true">
          {kindsPresent.map((kind) => (
            <span key={kind} className={`sched-legend-item is-${kind}`}>
              <span className="sched-legend-dot" />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
      ) : null}
      <ol className="sched-steps">
        {view.nodes.map((node) =>
          node.type === "step" ? (
            <StepRow key={node.step.id} step={node.step} />
          ) : (
            <RepeatCard key={node.id} node={node} />
          )
        )}
      </ol>
    </>
  );
}

function StepRow({ step }: { step: ScheduledStepView }) {
  const KindIcon = KIND_ICON[step.kind];
  const setsSuffix =
    step.sets && step.sets > 1 && !step.reps ? ` ×${step.sets}` : null;
  return (
    <li className={`sched-step is-${step.kind}`}>
      <span className="sched-step-token" aria-hidden="true">
        <KindIcon size={13} />
      </span>
      <div className="sched-step-text">
        <span className="sched-step-name">
          {step.name}
          {setsSuffix}
        </span>
        {step.intensityLabel ? (
          <span className="sched-step-intensity">{step.intensityLabel}</span>
        ) : null}
      </div>
      {step.targetLabel ? (
        <span className="sched-step-target">{step.targetLabel}</span>
      ) : null}
    </li>
  );
}

function RepeatCard({ node }: { node: ScheduledRepeatViewExtract }) {
  const perRep = node.magnitude
    ? node.magnitudeType === "distance"
      ? formatStepDistanceLabel(node.magnitude)
      : formatStepTimeLabel(node.magnitude)
    : undefined;
  const total =
    node.magnitude !== undefined
      ? node.magnitudeType === "distance"
        ? formatStepDistanceLabel(node.magnitude * node.repeat)
        : formatStepTimeLabel(node.magnitude * node.repeat)
      : undefined;

  return (
    <li className="sched-repeat">
      <div className="sched-repeat-head">
        <span className="sched-repeat-token" aria-hidden="true">
          <Repeat size={12} />
        </span>
        <span className="sched-repeat-title">Repeat ×{node.repeat}</span>
        {perRep && total ? (
          <span className="sched-repeat-total">
            {perRep} each · {total} total
          </span>
        ) : null}
      </div>
      <ol className="sched-repeat-steps">
        {node.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
    </li>
  );
}

/* ---------------- strength ---------------- */

function formatTonnage(kg: number): string {
  if (kg >= 10_000) {
    return `${(kg / 1000).toFixed(1)} t`;
  }
  return `${Math.round(kg).toLocaleString()} kg`;
}

function StrengthStructure({ view }: { view: ScheduledStructureView }) {
  const steps = flatSteps(view);
  const totalSets = steps.reduce((sum, step) => sum + (step.sets ?? 1), 0);
  const tonnage = steps.reduce(
    (sum, step) =>
      step.weightUnit === "lb"
        ? sum
        : sum + (step.sets ?? 1) * (step.reps ?? 0) * (step.weight ?? 0),
    0
  );

  return (
    <>
      <div className="sched-strength-summary">
        <span className="sched-strength-chip">
          {steps.length} exercise{steps.length === 1 ? "" : "s"}
        </span>
        <span className="sched-strength-chip">{totalSets} sets</span>
        {tonnage > 0 ? (
          <span className="sched-strength-chip">
            {formatTonnage(tonnage)} lifted
          </span>
        ) : null}
      </div>
      <div className="sched-strength-list">
        {view.nodes.map((node) =>
          node.type === "step" ? (
            <LiftCard key={node.step.id} step={node.step} />
          ) : (
            <div className="sched-circuit" key={node.id}>
              <div className="sched-circuit-head">
                <Repeat size={12} aria-hidden="true" />
                Circuit ×{node.repeat}
              </div>
              {node.steps.map((step) => (
                <LiftCard key={step.id} step={step} />
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}

function LiftCard({ step }: { step: ScheduledStepView }) {
  const sets = step.sets ?? 1;
  const scheme = [
    sets > 1 ? `${sets} ×` : null,
    step.reps ? `${step.reps} reps` : null
  ]
    .filter(Boolean)
    .join(" ");
  const weightLabel =
    step.weight !== undefined
      ? `${step.weight} ${step.weightUnit ?? "kg"}`
      : (step.intensityLabel ?? undefined);

  return (
    <article className="sched-lift">
      <span className="sched-lift-icon" aria-hidden="true">
        <Dumbbell size={14} />
      </span>
      <div className="sched-lift-text">
        <span className="sched-lift-name">{step.name}</span>
        {scheme ? <span className="sched-lift-scheme">{scheme}</span> : null}
      </div>
      {weightLabel ? (
        <span className="sched-lift-weight">{weightLabel}</span>
      ) : step.targetLabel && !step.reps ? (
        <span className="sched-lift-weight">{step.targetLabel}</span>
      ) : null}
    </article>
  );
}
