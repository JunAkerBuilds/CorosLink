import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  BookOpen,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Database,
  ExternalLink,
  FileDown,
  FileText,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Network,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  User
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  POUNDS_PER_KILOGRAM,
  formatDistanceValue,
  formatElevationValue,
  formatPaceValue,
  kilogramsToDisplayWeight,
  kmhToDisplaySpeed,
  speedUnit,
  weightUnit,
  type UnitSystem
} from "../units/units";
import type {
  ChatAuthStatus,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  ClaudeCodeStatus,
  CoachInputChoice,
  CoachInputPrompt,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConnectionTest,
  CorosMcpStatus,
  McpServerStatus,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  PlanWorkoutEntryInput,
  TrainingPlanDocument,
  TrainingPlanDestination,
  TrainingHubExportResult,
  UploadPlanResult,
  WorkoutIntensityInput,
  WorkoutDeletePreview,
  DeleteWorkoutResult
} from "../../electron/types";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { trainingPlanFromCoachDraftPreview } from "../../electron/trainingPlanDomain";
import { sportTheme } from "../training-library/sportTheme";
import { ActivityVisualCard } from "./ActivityVisualCard";
import { FitnessTrendCard } from "./FitnessTrendCard";
import { HrZoneCard } from "./HrZoneCard";
import { ChatSettingsModal } from "./ChatSettingsModal";
import { ChatSidebar } from "./ChatSidebar";
import { ModelSwitch } from "./ModelSwitch";
import { ProviderSwitch } from "./ProviderSwitch";
import {
  fromPersistedEntries,
  toPersistedEntries,
  toWireMessages,
  upsertActivityVisualEntry,
  upsertCoachPromptEntry,
  upsertFitnessTrendEntry,
  upsertHrZoneEntry,
  upsertPlanDraftEntry,
  upsertWorkoutDeleteEntry,
  isChatVisualEntry,
  type ChatEntry,
  type SourceInfo
} from "./chatTypes";

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "chatgpt",
  chatgpt: {},
  claudeCode: {
    permissions: {
      recentActivities: true,
      trainingMetrics: true,
      upcomingWorkouts: true,
      sleepData: false,
      fullActivityFiles: false
    }
  },
  openRouter: {
    model: "openrouter/auto",
    hasApiKey: false
  },
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  },
  sidebarOpen: true,
  visualizationsEnabled: false,
  customInstructions: ""
};

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

const CHAT_MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const CHAT_MARKDOWN_COMPONENTS: Components = {
  // Render links in the user's browser, not inside the app window.
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
};

const AssistantMarkdown = memo(function AssistantMarkdown({
  content,
  streaming = false
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={`chat-markdown${streaming ? " chat-markdown-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
        components={CHAT_MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

const ThinkingDisclosure = memo(function ThinkingDisclosure({
  content,
  live = false
}: {
  content: string;
  live?: boolean;
}) {
  return (
    <details className={`chat-thinking${live ? " chat-thinking-live" : ""}`}>
      <summary>
        <span>Thinking</span>
        {live ? <small><i aria-hidden="true" />Live</small> : null}
      </summary>
      <div className="chat-thinking-text">
        <AssistantMarkdown content={content} />
      </div>
    </details>
  );
});

function CoachInputCard({
  prompt,
  disabled,
  onChoose,
  onCustom
}: {
  prompt: CoachInputPrompt;
  disabled: boolean;
  onChoose: (choice: CoachInputChoice) => void;
  onCustom: () => void;
}) {
  const answered = prompt.answeredAt !== undefined;
  return (
    <section
      className={`chat-coach-prompt${answered ? " is-answered" : ""}`}
      aria-labelledby={`coach-prompt-${prompt.promptId}`}
    >
      <header className="chat-coach-prompt-header">
        <span className="chat-coach-prompt-status">
          <MessageCircle size={14} aria-hidden="true" />
          {answered ? "Answered" : "Waiting for your answer"}
        </span>
        <h4 id={`coach-prompt-${prompt.promptId}`}>{prompt.question}</h4>
      </header>
      <div className="chat-coach-prompt-choices" role="group" aria-label="Answer choices">
        {prompt.choices.map((choice, index) => {
          const selected = prompt.selectedChoiceId === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              className={`chat-coach-prompt-choice${selected ? " is-selected" : ""}`}
              onClick={() => onChoose(choice)}
              disabled={disabled || answered}
            >
              <span>
                {choice.label}
                {!answered && index === 0 ? <em>Recommended</em> : null}
              </span>
              {choice.description ? <small>{choice.description}</small> : null}
            </button>
          );
        })}
      </div>
      {!answered && prompt.allowCustom ? (
        <button
          type="button"
          className="chat-coach-prompt-custom"
          onClick={onCustom}
          disabled={disabled}
        >
          Type another answer
        </button>
      ) : null}
    </section>
  );
}

interface ChatViewProps {
  api: CorosLinkApi | undefined;
  onError: (message: string | null) => void;
  onPlanUploaded?: () => void;
  onReviewPlan?: (plan: TrainingPlanDocument) => void;
  /** Fires when a coach request is in progress (streaming or exporting). */
  onActivityChange?: (active: boolean) => void;
  /** Text preloaded into the composer (e.g. "Ask Coach" from the calendar). */
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
}

function canonicalPlanDistanceMeters(source: PlanWorkoutEntryInput): number {
  if (source.distance_km && source.distance_km > 0) {
    return source.distance_km * 1_000;
  }
  let total = 0;
  for (const step of source.steps ?? []) {
    if ("repeat" in step) {
      total += step.repeat * step.steps.reduce(
        (sum, child) => sum + (child.target_distance_meters ?? 0),
        0
      );
    } else {
      total += step.target_distance_meters ?? 0;
    }
  }
  return total;
}

function formatPlanSourceVolume(
  source: PlanWorkoutEntryInput,
  unitSystem: UnitSystem
): string | undefined {
  const meters = canonicalPlanDistanceMeters(source);
  if (meters <= 0) return undefined;
  return formatDistanceValue(meters, unitSystem, {
    swim: source.sport === "swim"
  });
}

type PlanSourceNode = NonNullable<PlanWorkoutEntryInput["steps"]>[number];
type PlanSourceRepeat = Extract<PlanSourceNode, { repeat: number }>;
type PlanSourceStep = Exclude<PlanSourceNode, { repeat: number }>;

function isPlanSourceRepeat(step: PlanSourceNode): step is PlanSourceRepeat {
  return "repeat" in step;
}

function formatPlanDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes)
    ? `${minutes} min`
    : `${minutes.toFixed(1)} min`;
}

function formatPlanStepTarget(
  step: PlanSourceStep,
  sport: PlanWorkoutEntryInput["sport"],
  unitSystem: UnitSystem
): string {
  if (step.target_distance_meters) {
    return formatDistanceValue(step.target_distance_meters, unitSystem, {
      swim: sport === "swim"
    });
  }
  if (step.target_elevation_gain_meters) {
    return `${formatElevationValue(step.target_elevation_gain_meters, unitSystem)} gain`;
  }
  if (step.target_duration_seconds) {
    return formatPlanDuration(step.target_duration_seconds);
  }
  if (step.target_reps) return `${step.target_reps} reps`;
  if (step.target_routes) {
    return `${step.target_routes} ${step.target_routes === 1 ? "route" : "routes"}`;
  }
  if (step.target_hr_recovery_bpm) {
    return `to ${step.target_hr_recovery_bpm} bpm`;
  }
  if (step.send_off_seconds) return `${formatPlanDuration(step.send_off_seconds)} send-off`;
  if (step.target_load) return `${step.target_load} TL`;
  return "Open";
}

function formatPlanSourceSteps(
  source: PlanWorkoutEntryInput,
  unitSystem: UnitSystem
): string | undefined {
  const formatStep = (
    step: NonNullable<PlanWorkoutEntryInput["steps"]>[number]
  ): string => {
    if (isPlanSourceRepeat(step)) {
      return `${step.repeat}x (${step.steps.map((child) => formatStep(child)).join(", ")})`;
    }
    const target = formatPlanStepTarget(step, source.sport, unitSystem);
    const intensity = step.intensity
      ? formatPlanIntensity(step.intensity, unitSystem)
      : step.pace
        ? formatLegacyPlanPace(step.pace, unitSystem)
        : undefined;
    return `${step.kind ?? "training"} ${target}${intensity ? ` @ ${intensity}` : ""}`;
  };
  return source.steps?.length
    ? source.steps.map(formatStep).join(" → ")
    : undefined;
}

function isStrengthExerciseStep(step: PlanSourceStep): boolean {
  return step.kind === "training" || step.kind === "interval";
}

function strengthStepTitle(step: PlanSourceStep): string {
  if (step.exercise_name?.trim()) return step.exercise_name.trim();
  if (step.name?.trim()) return step.name.trim();
  if (step.kind === "warmup") return "Warm-up";
  if (step.kind === "cooldown") return "Cooldown";
  if (step.kind === "rest") return "Recovery";
  return "Strength exercise";
}

function strengthStepMarker(step: PlanSourceStep, exerciseNumber?: number): string {
  if (exerciseNumber !== undefined) return String(exerciseNumber);
  if (step.kind === "warmup") return "W";
  if (step.kind === "cooldown") return "C";
  if (step.kind === "rest") return "R";
  return "S";
}

function countStrengthExercises(steps: readonly PlanSourceNode[]): number {
  return steps.reduce((count, step) => {
    if (isPlanSourceRepeat(step)) {
      return count + step.steps.filter(isStrengthExerciseStep).length;
    }
    return count + (isStrengthExerciseStep(step) ? 1 : 0);
  }, 0);
}

function StrengthPlanStructure({
  source,
  unitSystem
}: {
  source: PlanWorkoutEntryInput;
  unitSystem: UnitSystem;
}) {
  const steps = source.steps ?? [];
  const exerciseCount = countStrengthExercises(steps);
  let exerciseNumber = 0;

  const renderStep = (step: PlanSourceStep, key: string) => {
    const exercise = isStrengthExerciseStep(step);
    const currentExerciseNumber = exercise ? ++exerciseNumber : undefined;
    const intensity = step.intensity
      ? formatPlanIntensity(step.intensity, unitSystem)
      : undefined;
    const setCount = step.sets && step.sets > 1 ? `${step.sets} sets` : undefined;
    const setRest = step.sets && step.sets > 1 && step.rest_value !== undefined
      ? `${formatPlanDuration(step.rest_value)} rest`
      : undefined;

    return (
      <li
        key={key}
        className={`chat-plan-strength-step is-${step.kind ?? "training"}`}
      >
        <span className="chat-plan-strength-marker" aria-hidden="true">
          {strengthStepMarker(step, currentExerciseNumber)}
        </span>
        <span className="chat-plan-strength-step-copy">
          <strong>{strengthStepTitle(step)}</strong>
        </span>
        <span className="chat-plan-strength-prescription">
          {setCount ? <span>{setCount}</span> : null}
          <strong>{formatPlanStepTarget(step, source.sport, unitSystem)}</strong>
          {intensity ? <span>{intensity}</span> : null}
          {setRest ? <span>{setRest}</span> : null}
        </span>
      </li>
    );
  };

  return (
    <section
      className="chat-plan-strength-structure"
      aria-label={`${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"} in strength session structure`}
    >
      <header className="chat-plan-strength-header">
        <strong>Session structure</strong>
        <span>
          {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"}
        </span>
      </header>
      <ol className="chat-plan-strength-steps">
        {steps.map((step, index) => {
          if (!isPlanSourceRepeat(step)) {
            return renderStep(step, `step-${index}`);
          }
          return (
            <li key={`repeat-${index}`} className="chat-plan-strength-repeat">
              <div className="chat-plan-strength-repeat-header">
                <strong>{step.name?.trim() || "Repeat block"}</strong>
                <span>{step.repeat} rounds</span>
              </div>
              <ol>
                {step.steps.map((child, childIndex) =>
                  renderStep(child, `repeat-${index}-step-${childIndex}`)
                )}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function formatPlanPaceRange(
  lowSecondsPerKm: number,
  highSecondsPerKm: number,
  unitSystem: UnitSystem
): string {
  const clock = (value: number) => formatPaceValue(value, unitSystem).split(" ")[0];
  return `${clock(lowSecondsPerKm)}–${clock(highSecondsPerKm)}/${unitSystem === "imperial" ? "mi" : "km"}`;
}

function formatPlanIntensity(
  intensity: WorkoutIntensityInput,
  unitSystem: UnitSystem
): string | undefined {
  if (intensity.type === "none") return undefined;
  if (intensity.type === "pace" || intensity.type === "effortPace") {
    return formatPlanPaceRange(
      intensity.lowSecondsPerKm,
      intensity.highSecondsPerKm,
      unitSystem
    );
  }
  if (intensity.type === "speed") {
    const lowKmh = intensity.unit === "mph" ? intensity.low * 1.609344 : intensity.low;
    const highKmh = intensity.unit === "mph" ? intensity.high * 1.609344 : intensity.high;
    return `${kmhToDisplaySpeed(lowKmh, unitSystem).toFixed(1)}–${kmhToDisplaySpeed(highKmh, unitSystem).toFixed(1)} ${speedUnit(unitSystem)}`;
  }
  if (intensity.type === "weight") {
    if (intensity.mode === "bodyweight") return "Bodyweight";
    const kilograms = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    return `${kilogramsToDisplayWeight(kilograms, unitSystem).toFixed(1)} ${weightUnit(unitSystem)}`;
  }
  if (intensity.type === "heartRate") {
    return `${intensity.lowBpm}–${intensity.highBpm} bpm`;
  }
  if (intensity.type === "power" && !intensity.preset) {
    return `${intensity.lowWatts}–${intensity.highWatts} W`;
  }
  if (intensity.type === "cadence") {
    return `${intensity.low}–${intensity.high} ${intensity.unit}`;
  }
  if (intensity.type === "swimStroke") return intensity.stroke;
  if (intensity.type === "rpe") return `RPE ${intensity.value}`;
  return undefined;
}

function formatLegacyPlanPace(
  pace: string,
  unitSystem: UnitSystem
): string {
  const match = pace.trim().match(/^(\d+):([0-5]\d)(?:-(\d+):([0-5]\d))?\/(km|mi)$/i);
  if (!match) return pace;
  const sourceFactor = match[5]?.toLowerCase() === "mi" ? 1 / 1.609344 : 1;
  const low = (Number(match[1]) * 60 + Number(match[2])) * sourceFactor;
  const high = match[3]
    ? (Number(match[3]) * 60 + Number(match[4])) * sourceFactor
    : low;
  return formatPlanPaceRange(low, high, unitSystem);
}

const PLAN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function planDateFromSchedule(scheduleDate: string): Date | undefined {
  const match = scheduleDate.match(PLAN_DATE_RE);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Calendar-badge parts for a scheduled date: weekday / day number / month. */
function planDateParts(
  scheduleDate?: string
): { weekday: string; day: string; month: string } | undefined {
  if (!scheduleDate) return undefined;
  const date = planDateFromSchedule(scheduleDate);
  if (!date) return undefined;
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    day: String(date.getDate()),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)
  };
}

/** One-line localized label, e.g. "Tue, Aug 4". Falls back to the raw value. */
function formatPlanDateLabel(scheduleDate: string): string {
  const date = planDateFromSchedule(scheduleDate);
  if (!date) return scheduleDate;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function planEntryScheduleDate(entry: PlanDraftPreviewEntry): string | undefined {
  if (entry.scheduleDate) return entry.scheduleDate;
  const sourceDate = entry.source?.schedule_date;
  if (!sourceDate || !/^\d{8}$/.test(sourceDate)) return undefined;
  return `${sourceDate.slice(0, 4)}-${sourceDate.slice(4, 6)}-${sourceDate.slice(6, 8)}`;
}

function localPlanDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function planWeekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function formatPlanWeekRange(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const month = new Intl.DateTimeFormat(undefined, { month: "short" });
  if (start.getMonth() === end.getMonth()) {
    return `${month.format(start)} ${start.getDate()}-${end.getDate()}`;
  }
  return `${month.format(start)} ${start.getDate()}-${month.format(end)} ${end.getDate()}`;
}

interface PlanWeekGroup {
  id: string;
  label: string;
  dateRange: string;
  entries: PlanDraftPreviewEntry[];
}

function groupPlanEntriesByWeek(entries: PlanDraftPreviewEntry[]): PlanWeekGroup[] {
  const groups = new Map<string, { start: Date; entries: PlanDraftPreviewEntry[] }>();
  const unscheduled: PlanDraftPreviewEntry[] = [];
  const sortedEntries = [...entries].sort((left, right) => {
    const leftDate = planEntryScheduleDate(left) ?? "9999-99-99";
    const rightDate = planEntryScheduleDate(right) ?? "9999-99-99";
    return leftDate.localeCompare(rightDate);
  });

  for (const entry of sortedEntries) {
    const scheduleDate = planEntryScheduleDate(entry);
    const date = scheduleDate ? planDateFromSchedule(scheduleDate) : undefined;
    if (!date) {
      unscheduled.push(entry);
      continue;
    }
    const start = planWeekStart(date);
    const id = localPlanDateKey(start);
    const existing = groups.get(id);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(id, { start, entries: [entry] });
    }
  }

  const weeks = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, group], index) => ({
      id,
      label: `Week ${index + 1}`,
      dateRange: formatPlanWeekRange(group.start),
      entries: group.entries
    }));
  if (unscheduled.length > 0) {
    weeks.push({
      id: "unscheduled",
      label: "Unscheduled",
      dateRange: "No calendar date",
      entries: unscheduled
    });
  }
  return weeks;
}

/** Inline style hook that tints a row/chip with the sport's own colour. */
function planSportStyle(sport: PlanDraftPreviewEntry["sport"]): CSSProperties {
  return { "--chat-plan-sport": sportTheme(sport).color } as CSSProperties;
}

function WorkoutPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ) => void;
}) {
  const { unitSystem } = useUnitSystem();
  const entry = draft.entries[0];
  const suggestedDate = entry ? planEntryScheduleDate(entry) : undefined;
  const today = localPlanDateKey(new Date());
  const [destination, setDestination] = useState<
    Extract<TrainingPlanDestination, "workoutLibrary" | "calendar">
  >(suggestedDate ? "calendar" : "workoutLibrary");
  const [scheduleDate, setScheduleDate] = useState(suggestedDate ?? today);
  const uploadedResult =
    uploaded ??
    (draft.uploadResult
      ? {
          planName: draft.name,
          workoutsCreated: draft.uploadResult.workoutsCreated,
          workoutsScheduled: draft.uploadResult.workoutsScheduled,
          entries: [],
          destination: draft.uploadResult.destination
        }
      : undefined);
  const isUploaded = Boolean(uploadedResult || draft.uploadedAt);
  const uploadedDestination =
    uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination;
  const calendarDateParts = destination === "calendar"
    ? planDateParts(scheduleDate)
    : undefined;
  const calendarDateInvalid =
    destination === "calendar" && (!scheduleDate || scheduleDate < today);
  const SportIcon = sportTheme(entry?.sport).icon;
  const hasStrengthStructure = Boolean(
    entry &&
      (entry.sport === "strength" || entry.sport === "hyrox") &&
      entry.source?.steps?.length
  );
  const volume = entry
    ? (entry.source
        ? formatPlanSourceVolume(entry.source, unitSystem)
        : undefined) ?? entry.volume ?? "Not set"
    : "Not set";
  const steps = entry
    ? (entry.source
        ? formatPlanSourceSteps(entry.source, unitSystem)
        : undefined) ?? entry.stepsSummary ?? "No structure provided"
    : "No structure provided";

  return (
    <div className="chat-plan-card chat-workout-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <span className="chat-workout-card-kicker">One-off workout</span>
          <h4>{draft.name}</h4>
          <span className="chat-plan-card-summary">{draft.summary}</span>
        </div>
        {entry ? (
          <span
            className="chat-plan-sport-dot"
            style={planSportStyle(entry.sport)}
            title={formatWorkoutSport(entry.sport ?? "run")}
          >
            <SportIcon size={12} strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {entry ? (
        <ul className="chat-plan-entries chat-workout-entries">
          <li
            className={`chat-plan-entry${hasStrengthStructure ? " is-strength" : ""}`}
            style={planSportStyle(entry.sport)}
          >
            <span
              className={`chat-plan-entry-date${calendarDateParts ? "" : " is-undated"}`}
              title={
                destination === "calendar"
                  ? `Add to Calendar on ${scheduleDate}`
                  : "Save to Workout Library"
              }
            >
              {calendarDateParts ? (
                <>
                  <span className="chat-plan-entry-weekday">
                    {calendarDateParts.weekday}
                  </span>
                  <span className="chat-plan-entry-day">
                    {calendarDateParts.day}
                  </span>
                  <span className="chat-plan-entry-month">
                    {calendarDateParts.month}
                  </span>
                </>
              ) : (
                <Bookmark size={14} aria-hidden="true" />
              )}
            </span>
            <span className="chat-plan-entry-main">
              <span className="chat-plan-entry-name">{entry.name}</span>
              {hasStrengthStructure && entry.source ? (
                <StrengthPlanStructure
                  source={entry.source}
                  unitSystem={unitSystem}
                />
              ) : (
                <span className="chat-plan-entry-steps">{steps}</span>
              )}
            </span>
            <span className="chat-plan-entry-meta">
              {!hasStrengthStructure ? (
                <span className="chat-plan-entry-volume">{volume}</span>
              ) : null}
              <span className="chat-plan-entry-tags">
                <span className="chat-plan-entry-type">{entry.workoutType}</span>
                <span className="chat-plan-entry-sport">
                  <SportIcon size={11} strokeWidth={2.2} aria-hidden="true" />
                  {formatWorkoutSport(entry.sport ?? "run")}
                </span>
              </span>
            </span>
          </li>
        </ul>
      ) : (
        <div className="chat-plan-empty-week">
          <Bookmark size={16} aria-hidden="true" />
          <span>This workout does not contain any steps yet.</span>
        </div>
      )}
      {isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {uploadedDestination === "calendar"
              ? `Added to your COROS Calendar on ${formatPlanDateLabel(scheduleDate)}.`
              : "Saved to your COROS Workout Library."}
          </span>
        </p>
      ) : (
        <>
          <fieldset className="chat-plan-confirmation" disabled={uploading}>
            <legend>Where should this workout go?</legend>
            <div className="chat-plan-destination-options">
              <label
                className={`chat-plan-destination-option${
                  destination === "workoutLibrary" ? " is-selected" : ""
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`workout-destination-${draft.draftId}`}
                  value="workoutLibrary"
                  checked={destination === "workoutLibrary"}
                  onChange={() => setDestination("workoutLibrary")}
                />
                <span className="chat-plan-destination-icon">
                  <BookOpen size={16} aria-hidden="true" />
                </span>
                <span className="chat-plan-destination-copy">
                  <strong>Workout Library</strong>
                  <small>Save it as an unscheduled, reusable workout.</small>
                </span>
                <CircleCheck
                  className="chat-plan-destination-check"
                  size={16}
                  aria-hidden="true"
                />
              </label>
              <label
                className={`chat-plan-destination-option${
                  destination === "calendar" ? " is-selected" : ""
                }`}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name={`workout-destination-${draft.draftId}`}
                  value="calendar"
                  checked={destination === "calendar"}
                  onChange={() => setDestination("calendar")}
                />
                <span className="chat-plan-destination-icon">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <span className="chat-plan-destination-copy">
                  <strong>Calendar</strong>
                  <small>Add this workout on the date you choose.</small>
                </span>
                <CircleCheck
                  className="chat-plan-destination-check"
                  size={16}
                  aria-hidden="true"
                />
              </label>
            </div>
            {destination === "calendar" ? (
              <label className="chat-workout-calendar-date">
                <span>Calendar date</span>
                <input
                  type="date"
                  value={scheduleDate}
                  min={today}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </label>
            ) : null}
            <p className="chat-plan-destination-summary" data-tone="ok">
              {destination === "calendar" ? (
                <CalendarDays size={13} aria-hidden="true" />
              ) : (
                <BookOpen size={13} aria-hidden="true" />
              )}
              <span>
                {destination === "calendar"
                  ? `This workout will be added to Calendar on ${formatPlanDateLabel(scheduleDate)}.`
                  : "This workout will be saved to your Workout Library without a calendar date."}
                {" "}It will remain a one-off workout, not a training plan.
              </span>
            </p>
          </fieldset>
          <div className="chat-plan-actions">
            <button
              type="button"
              className="chat-plan-upload"
              onClick={() => onUpload(
                destination,
                destination === "calendar" ? scheduleDate : undefined
              )}
              disabled={uploading || !entry || calendarDateInvalid}
            >
              {uploading ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                destination === "calendar" ? (
                  <CalendarDays size={14} aria-hidden="true" />
                ) : (
                  <Bookmark size={14} aria-hidden="true" />
                )
              )}
              {destination === "calendar" ? "Add to Calendar" : "Save to Library"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload,
  onReview
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (destination: TrainingPlanDestination) => void;
  onReview?: () => void;
}) {
  const { unitSystem } = useUnitSystem();
  const [destination, setDestination] = useState<
    Extract<TrainingPlanDestination, "localPlan" | "workoutLibrary" | "calendar">
  >("localPlan");
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const weekTabsRef = useRef<HTMLDivElement>(null);
  const uploadedResult =
    uploaded ??
    (draft.uploadResult
      ? {
          planName: draft.name,
          workoutsCreated: draft.uploadResult.workoutsCreated,
          workoutsScheduled: draft.uploadResult.workoutsScheduled,
          entries: []
        }
      : undefined);
  const isUploaded = Boolean(uploadedResult || draft.uploadedAt);
  const planWeeks = groupPlanEntriesByWeek(draft.entries);
  const scheduledWeekCount = planWeeks.filter(
    (week) => week.id !== "unscheduled"
  ).length;
  const selectedWeek =
    planWeeks.find((week) => week.id === selectedWeekId) ?? planWeeks[0];
  const selectedWeekIndex = selectedWeek
    ? planWeeks.findIndex((week) => week.id === selectedWeek.id)
    : -1;
  const sports = [
    ...new Set(draft.entries.map((entry) => formatWorkoutSport(entry.sport ?? "run")))
  ];
  const sportKinds = [...new Set(draft.entries.map((entry) => entry.sport))];
  const startDate = draft.entries
    .map(planEntryScheduleDate)
    .filter((date): date is string => Boolean(date))
    .sort()[0];
  const scheduledWorkoutCount = draft.entries.filter((entry) =>
    Boolean(planEntryScheduleDate(entry))
  ).length;
  const unscheduledWorkoutCount = draft.entries.length - scheduledWorkoutCount;
  const destinationLabel: Record<TrainingPlanDestination, string> = {
    workoutLibrary: "COROS Workout Library",
    calendar: "COROS Calendar",
    localPlan: "CorosLink Training Library",
    nativePlan: "COROS Plan Library",
    localTemplate: "Local CorosLink template",
    nativePlanAndCalendar: "COROS plan + Calendar"
  };

  useEffect(() => {
    setSelectedWeekId(null);
  }, [draft.draftId]);

  useEffect(() => {
    const activeTab = weekTabsRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedWeek?.id]);

  const selectAdjacentWeek = (offset: number) => {
    const nextWeek = planWeeks[selectedWeekIndex + offset];
    if (nextWeek) setSelectedWeekId(nextWeek.id);
  };

  return (
    <div className="chat-plan-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <h4>{draft.name}</h4>
          <span className="chat-plan-card-summary">{draft.summary}</span>
        </div>
        {sportKinds.length > 0 ? (
          <span
            className="chat-plan-sports"
            role="img"
            aria-label={sports.join(", ")}
          >
            {sportKinds.slice(0, 4).map((sport, index) => {
              const SportIcon = sportTheme(sport).icon;
              return (
                <span
                  key={`${sport ?? "unknown"}-${index}`}
                  className="chat-plan-sport-dot"
                  style={planSportStyle(sport)}
                  title={sport ? formatWorkoutSport(sport) : "Workout"}
                >
                  <SportIcon size={10} strokeWidth={2.2} aria-hidden="true" />
                </span>
              );
            })}
          </span>
        ) : null}
      </div>
      <div className="chat-plan-overview" aria-label="Plan overview">
        <div className="chat-plan-overview-item">
          <span>Weeks</span>
          <strong>{scheduledWeekCount}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Workouts</span>
          <strong>{draft.entries.length}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Sports</span>
          <strong title={sports.join(", ")}>{sports.join(", ")}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>Starts</span>
          <strong>{startDate ? formatPlanDateLabel(startDate) : "Not set"}</strong>
        </div>
      </div>
      {selectedWeek ? (
        <section
          className="chat-plan-week"
          aria-labelledby={`chat-plan-week-${draft.draftId}-${selectedWeek.id}`}
        >
          <div className="chat-plan-week-header">
            <div>
              <span>{selectedWeek.label}</span>
              <h5 id={`chat-plan-week-${draft.draftId}-${selectedWeek.id}`}>
                {selectedWeek.dateRange}
              </h5>
              <small>
                {selectedWeek.entries.length}{" "}
                {selectedWeek.entries.length === 1 ? "workout" : "workouts"}
              </small>
            </div>
            {planWeeks.length > 1 ? (
              <div className="chat-plan-week-stepper" aria-label="Change week">
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(-1)}
                  disabled={selectedWeekIndex <= 0}
                  aria-label="Previous week"
                  title="Previous week"
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span>{selectedWeekIndex + 1} of {planWeeks.length}</span>
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(1)}
                  disabled={selectedWeekIndex >= planWeeks.length - 1}
                  aria-label="Next week"
                  title="Next week"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
          {planWeeks.length > 1 ? (
            <div
              ref={weekTabsRef}
              className="chat-plan-week-tabs"
              role="tablist"
              aria-label="Plan weeks"
            >
              {planWeeks.map((week) => (
                <button
                  key={week.id}
                  type="button"
                  role="tab"
                  aria-selected={week.id === selectedWeek.id}
                  className={week.id === selectedWeek.id ? "is-active" : ""}
                  onClick={() => setSelectedWeekId(week.id)}
                >
                  <strong>{week.label}</strong>
                  <span>{week.dateRange}</span>
                </button>
              ))}
            </div>
          ) : null}
          <ul className="chat-plan-entries">
            {selectedWeek.entries.map((entry) => {
              const SportIcon = sportTheme(entry.sport).icon;
              const scheduleDate = planEntryScheduleDate(entry);
              const dateParts = planDateParts(scheduleDate);
              const hasStrengthStructure =
                (entry.sport === "strength" || entry.sport === "hyrox") &&
                Boolean(entry.source?.steps?.length);
              const volume =
                (entry.source
                  ? formatPlanSourceVolume(entry.source, unitSystem)
                  : undefined) ?? entry.volume ?? "Not set";
              const steps =
                (entry.source
                  ? formatPlanSourceSteps(entry.source, unitSystem)
                  : undefined) ?? entry.stepsSummary ?? "No structure provided";
              return (
                <li
                  key={entry.key}
                  className={`chat-plan-entry${hasStrengthStructure ? " is-strength" : ""}`}
                  style={planSportStyle(entry.sport)}
                >
                  <span
                    className={`chat-plan-entry-date${dateParts ? "" : " is-undated"}`}
                    title={scheduleDate ?? "Saved to library only"}
                  >
                    {dateParts ? (
                      <>
                        <span className="chat-plan-entry-weekday">
                          {dateParts.weekday}
                        </span>
                        <span className="chat-plan-entry-day">{dateParts.day}</span>
                        <span className="chat-plan-entry-month">
                          {dateParts.month}
                        </span>
                      </>
                    ) : (
                      <Bookmark size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span className="chat-plan-entry-main">
                    <span className="chat-plan-entry-name">{entry.name}</span>
                    {hasStrengthStructure && entry.source ? (
                      <StrengthPlanStructure
                        source={entry.source}
                        unitSystem={unitSystem}
                      />
                    ) : (
                      <span className="chat-plan-entry-steps">{steps}</span>
                    )}
                  </span>
                  <span className="chat-plan-entry-meta">
                    {!hasStrengthStructure ? (
                      <span className="chat-plan-entry-volume">{volume}</span>
                    ) : null}
                    <span className="chat-plan-entry-tags">
                      <span className="chat-plan-entry-type">
                        {entry.workoutType}
                      </span>
                      <span className="chat-plan-entry-sport">
                        <SportIcon size={11} strokeWidth={2.2} aria-hidden="true" />
                        {formatWorkoutSport(entry.sport ?? "run")}
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="chat-plan-empty-week">
          <Bookmark size={16} aria-hidden="true" />
          <span>This plan does not contain any workouts yet.</span>
        </div>
      )}
      {draft.conflicts.length > 0 ? (
        <details
          className="chat-plan-issues"
          data-tone="alert"
          open={draft.conflicts.length <= 3}
        >
          <summary>
            <span>
              <TriangleAlert size={13} aria-hidden="true" />
              <strong>
                {draft.conflicts.length}{" "}
                {draft.conflicts.length === 1
                  ? "scheduling conflict"
                  : "scheduling conflicts"}
              </strong>
            </span>
            <small>Review before saving</small>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <ul className="chat-plan-warnings">
            {draft.conflicts.map((item) => (
              <li key={item}>
                <TriangleAlert size={12} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {draft.warnings.length > 0 ? (
        <details
          className="chat-plan-issues"
          data-tone="note"
          open={draft.warnings.length <= 3}
        >
          <summary>
            <span>
              <Info size={13} aria-hidden="true" />
              <strong>
                {draft.warnings.length}{" "}
                {draft.warnings.length === 1 ? "plan note" : "plan notes"}
              </strong>
            </span>
            <small>Additional plan details</small>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <ul className="chat-plan-notes">
            {draft.warnings.map((item) => (
              <li key={item}>
                <Info size={12} aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!isUploaded ? (
        <fieldset className="chat-plan-confirmation" disabled={uploading}>
          <legend>How should this plan be saved?</legend>
          <div className="chat-plan-destination-options">
            <label
              className={`chat-plan-destination-option is-primary${
                destination === "localPlan" ? " is-selected" : ""
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="localPlan"
                checked={destination === "localPlan"}
                onChange={() => setDestination("localPlan")}
              />
              <span className="chat-plan-destination-icon">
                <BookOpen size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Training Plan</strong>
                <small>Keep these workouts together as one editable plan in CorosLink.</small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "workoutLibrary" ? " is-selected" : ""
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="workoutLibrary"
                checked={destination === "workoutLibrary"}
                onChange={() => setDestination("workoutLibrary")}
              />
              <span className="chat-plan-destination-icon">
                <Bookmark size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Individual Workouts</strong>
                <small>Save each workout separately to the COROS Workout Library.</small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "calendar" ? " is-selected" : ""
              }${unscheduledWorkoutCount > 0 ? " is-disabled" : ""}`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="calendar"
                checked={destination === "calendar"}
                onChange={() => setDestination("calendar")}
                disabled={unscheduledWorkoutCount > 0}
              />
              <span className="chat-plan-destination-icon">
                <CalendarDays size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>Calendar</strong>
                <small>
                  {unscheduledWorkoutCount > 0
                    ? `${unscheduledWorkoutCount} ${
                        unscheduledWorkoutCount === 1 ? "workout needs" : "workouts need"
                      } a date.`
                    : "Schedule workouts on the dates shown above."}
                </small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
          </div>
          <p
            className="chat-plan-destination-summary"
            data-tone={
              destination === "calendar" && draft.conflicts.length > 0
                ? "alert"
                : "ok"
            }
          >
            {destination === "calendar" && draft.conflicts.length > 0 ? (
              <TriangleAlert size={13} aria-hidden="true" />
            ) : (
              <CircleCheck size={13} aria-hidden="true" />
            )}
            <span>
              {destination === "localPlan"
                ? `This will be saved as one grouped plan with ${draft.entries.length} ${
                    draft.entries.length === 1 ? "workout" : "workouts"
                  } in your CorosLink Training Library.`
                : destination === "calendar"
                  ? `${scheduledWorkoutCount} ${
                      scheduledWorkoutCount === 1 ? "workout" : "workouts"
                    } will be added to your COROS Calendar.${
                      draft.conflicts.length > 0
                        ? ` Review ${draft.conflicts.length} ${
                            draft.conflicts.length === 1 ? "conflict" : "conflicts"
                          } before adding.`
                        : " No scheduling conflicts."
                    }`
                  : `${draft.entries.length} ${
                      draft.entries.length === 1 ? "workout" : "workouts"
                    } will be saved individually to your COROS Workout Library. Dates will not be added to Calendar.`}
            </span>
          </p>
        </fieldset>
      ) : null}
      {uploadedResult || isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {(uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination) === "localPlan"
              ? `Saved as a grouped plan in ${destinationLabel.localPlan}.`
              : `Saved to ${destinationLabel[uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination]}. ${
                  uploadedResult?.workoutsScheduled ?? draft.uploadResult?.workoutsScheduled ?? 0
                } scheduled, ${
                  uploadedResult?.workoutsCreated ?? draft.uploadResult?.workoutsCreated ?? 0
                } saved to library.`}
          </span>
        </p>
      ) : (
        <div className="chat-plan-actions">
          {onReview ? (
            <button
              type="button"
              className="chat-plan-review"
              onClick={onReview}
              disabled={uploading}
              title="Open this plan in the Training Library editor"
            >
              <BookOpen size={14} aria-hidden="true" />
              Edit plan first
            </button>
          ) : null}
          <button
            type="button"
            className="chat-plan-upload"
            onClick={() => onUpload(destination)}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : destination === "localPlan" ? (
              <BookOpen size={14} aria-hidden="true" />
            ) : destination === "calendar" ? (
              <CalendarDays size={14} aria-hidden="true" />
            ) : (
              <Bookmark size={14} aria-hidden="true" />
            )}
            {destination === "localPlan"
              ? "Save Plan"
              : destination === "calendar"
                ? "Add to Calendar"
                : "Save Workouts"}
          </button>
        </div>
      )}
    </div>
  );
}

function CoachDraftPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload,
  onReview
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: (
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ) => void;
  onReview?: () => void;
}) {
  if (draft.artifactType === "workout") {
    return (
      <WorkoutPreviewCard
        draft={draft}
        uploading={uploading}
        uploaded={uploaded}
        onUpload={onUpload}
      />
    );
  }

  return (
    <PlanPreviewCard
      draft={draft}
      uploading={uploading}
      uploaded={uploaded}
      onUpload={onUpload}
      onReview={onReview}
    />
  );
}

function deleteTargetLabel(target: WorkoutDeletePreview["target"]): string {
  if (target === "scheduled") return "Calendar";
  if (target === "library") return "Library";
  return "Calendar and library";
}

function DeletePreviewCard({
  preview,
  deleting,
  deleted,
  onConfirm
}: {
  preview: WorkoutDeletePreview;
  deleting: boolean;
  deleted?: DeleteWorkoutResult;
  onConfirm: () => void;
}) {
  return (
    <div className="chat-plan-card chat-delete-card">
      <div className="chat-plan-card-header">
        <h4>Delete workout</h4>
        <span className="chat-plan-card-summary">{preview.summary}</span>
      </div>
      <dl className="chat-delete-details">
        <div>
          <dt>Target</dt>
          <dd>{deleteTargetLabel(preview.target)}</dd>
        </div>
        {preview.workoutName ? (
          <div>
            <dt>Workout</dt>
            <dd>{preview.workoutName}</dd>
          </div>
        ) : null}
        {preview.scheduleDate ? (
          <div>
            <dt>Date</dt>
            <dd>{preview.scheduleDate}</dd>
          </div>
        ) : null}
      </dl>
      {deleted ? (
        <p className="chat-plan-success">{deleted.message}</p>
      ) : (
        <div className="chat-plan-actions">
          <button
            type="button"
            className="chat-delete-confirm"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            Delete from COROS
          </button>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SourceInfo }) {
  if (source.mcpUsed) {
    const tools = source.mcpTools.filter(Boolean);
    return (
      <div className={`chat-source ${source.mcpError ? "chat-source-error" : "chat-source-mcp"}`}>
        <Database size={12} aria-hidden="true" />
        MCP
        {tools.length > 0 ? ` · ${[...new Set(tools)].join(", ")}` : ""}
        {source.mcpError ? " · failed" : ""}
      </div>
    );
  }
  if (source.snapshotIncluded) {
    return (
      <div className="chat-source chat-source-snapshot">
        <FileText size={12} aria-hidden="true" />
        Training snapshot
        {source.mcpEnabled ? " · MCP not called" : ""}
      </div>
    );
  }
  return (
    <div className="chat-source chat-source-none">
      <FileText size={12} aria-hidden="true" />
      No COROS data
    </div>
  );
}

function isLatestActivityFileRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(download|export|save|get|grab)\b/.test(normalized) &&
    /\b(latest|last|most recent|newest|recent)\b/.test(normalized) &&
    /\b(activity|workout|run|ride)\b/.test(normalized) &&
    /\b(file|fit|original)\b/.test(normalized)
  );
}

function formatLatestActivityExportMessage(
  result: TrainingHubExportResult
): string {
  const formatLabel = result.formatLabel ?? "FIT";
  const activityName = result.activityName ? ` "${result.activityName}"` : "";
  if (!result.saved || !result.filePath) {
    return `No file saved. The latest activity ${formatLabel} export was cancelled.`;
  }
  return `Saved the latest activity ${formatLabel} file${activityName} to:\n\n\`${result.filePath}\``;
}

interface ChatComposerHandle {
  focus: () => void;
  setDraft: (value: string) => void;
}

interface ChatComposerProps {
  providerControls: ReactNode;
  initialDraft: string;
  apiAvailable: boolean;
  streaming: boolean;
  exportingLatestActivity: boolean;
  waitingForCoachAnswer: boolean;
  isLocalProvider: boolean;
  localModelConfigured: boolean;
  onDraftChange: (value: string) => void;
  onNewChat: () => void;
  onSend: (message: string) => Promise<boolean>;
  onStop: () => void;
}

const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(
  function ChatComposer(
    {
      providerControls,
      initialDraft,
      apiAvailable,
      streaming,
      exportingLatestActivity,
      waitingForCoachAnswer,
      isLocalProvider,
      localModelConfigured,
      onDraftChange,
      onNewChat,
      onSend,
      onStop
    },
    ref
  ) {
    const [draft, setDraft] = useState(initialDraft);
    const draftRef = useRef(initialDraft);
    const submittingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const trimmedDraft = draft.trim();
    const latestActivityFileRequest = isLatestActivityFileRequest(trimmedDraft);
    const localProviderBlocked =
      isLocalProvider &&
      !localModelConfigured &&
      !latestActivityFileRequest;

    const updateDraft = useCallback(
      (value: string) => {
        draftRef.current = value;
        setDraft(value);
        onDraftChange(value);
      },
      [onDraftChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setDraft: updateDraft
      }),
      [updateDraft]
    );

    const submitDraft = async () => {
      if (
        !apiAvailable ||
        !trimmedDraft ||
        exportingLatestActivity ||
        localProviderBlocked ||
        submittingRef.current
      ) {
        return;
      }

      const submittedDraft = draft;
      submittingRef.current = true;
      updateDraft("");
      try {
        const accepted = await onSend(trimmedDraft);
        if (!accepted && !draftRef.current) {
          updateDraft(submittedDraft);
        }
      } finally {
        submittingRef.current = false;
      }
    };

    return (
      <div className="chat-composer">
        <div className="chat-composer-toolbar">
          {providerControls}
          <button
            type="button"
            className="chat-new-chat chat-composer-new-chat"
            onClick={onNewChat}
            disabled={!apiAvailable || streaming || exportingLatestActivity}
            aria-label="Start a new chat"
            title="Start a new chat"
          >
            <Plus size={14} aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
        <div className="chat-composer-inner">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            placeholder={
              waitingForCoachAnswer
                ? "Type another answer…"
                : "Ask your coach…"
            }
            rows={1}
            disabled={exportingLatestActivity}
          />
          {streaming ? (
            <button
              type="button"
              className="chat-send chat-stop"
              onClick={onStop}
              title="Stop"
            >
              <Square size={15} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              onClick={() => void submitDraft()}
              disabled={
                !apiAvailable ||
                !trimmedDraft ||
                exportingLatestActivity ||
                localProviderBlocked
              }
              title={
                localProviderBlocked ? "Enter a local model first" : "Send"
              }
            >
              <Send size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="chat-disclaimer">
          Coach can make mistakes. Verify important training decisions.
        </p>
      </div>
    );
  }
);

export function ChatView({
  api,
  onError,
  onPlanUploaded,
  onReviewPlan,
  onActivityChange,
  pendingPrompt,
  onPendingPromptConsumed
}: ChatViewProps) {
  const { unitSystem } = useUnitSystem();
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatSettings, setChatSettings] =
    useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingLocal, setTestingLocal] = useState(false);
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [detectingLocal, setDetectingLocal] = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [openRouterConnection, setOpenRouterConnection] =
    useState<OpenRouterConnectionTest | null>(null);
  const [localApiKey, setLocalApiKey] = useState("");
  const [localConnection, setLocalConnection] =
    useState<LocalChatConnectionTest | null>(null);
  const [localDiscovery, setLocalDiscovery] =
    useState<LocalChatDiscovery | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [connectingClaude, setConnectingClaude] = useState(false);
  const [testingClaude, setTestingClaude] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [timeline, setTimeline] = useState<ChatEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [exportingLatestActivity, setExportingLatestActivity] = useState(false);
  const [currentSource, setCurrentSource] = useState<SourceInfo | null>(null);
  const [mcpStatus, setMcpStatus] = useState<CorosMcpStatus | null>(null);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpRefreshVersion, setMcpRefreshVersion] = useState(0);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [selectedPlanDraftId, setSelectedPlanDraftId] = useState<
    string | null
  >(null);
  const [planPanelExpanded, setPlanPanelExpanded] = useState(false);
  const [highlightedChatEntryIndex, setHighlightedChatEntryIndex] = useState<
    number | null
  >(null);
  const [uploadingDraftId, setUploadingDraftId] = useState<string | null>(null);
  const [uploadedPlans, setUploadedPlans] = useState<
    Record<string, UploadPlanResult>
  >({});
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null
  );
  const [deletedWorkouts, setDeletedWorkouts] = useState<
    Record<string, DeleteWorkoutResult>
  >({});

  // Ref so the push-event handlers filter on the current request without
  // being recreated (and re-subscribed) on every keystroke.
  const activeRequestIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  // Accumulates source info across the current stream's info events.
  const sourceRef = useRef<SourceInfo | null>(null);
  const thinkingRef = useRef("");
  // Interaction cards are appended after the assistant's final text so the
  // question and its choices stay in a natural reading order.
  const pendingCoachPromptsRef = useRef<CoachInputPrompt[]>([]);
  // Kept only while a paused Coach turn is resuming, so a failed/cancelled
  // request can restore the question instead of silently losing it.
  const resumedCoachPromptRef = useRef<CoachInputPrompt | null>(null);
  const autoDetectLocalRef = useRef(false);
  const claudePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mcpRef = useRef<HTMLDivElement>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const composerDraftRef = useRef("");
  const composerRef = useRef<ChatComposerHandle>(null);
  const handleComposerDraftChange = useCallback((value: string) => {
    composerDraftRef.current = value;
  }, []);

  useEffect(() => {
    if (!pendingPrompt || !composerRef.current) {
      return;
    }
    composerRef.current?.setDraft(pendingPrompt);
    onPendingPromptConsumed?.();
    // Focus after the coach panel becomes visible.
    requestAnimationFrame(() => composerRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingPrompt,
    checkingAuth,
    authStatus?.signedIn,
    claudeStatus?.state,
    chatSettings.provider
  ]);

  const resetEphemeralChatState = () => {
    setUploadedPlans({});
    setDeletedWorkouts({});
    pendingCoachPromptsRef.current = [];
    resumedCoachPromptRef.current = null;
  };

  const persistHistory = (
    sessionId: string | null,
    entries: ChatEntry[],
    immediate = false
  ) => {
    if (!api || !sessionId) return;
    const run = () => {
      void api
        .saveChatSession(sessionId, toPersistedEntries(entries))
        .then((summary) => {
          if (!summary) return;
          setSessions((current) => {
            const index = current.findIndex((session) => session.id === summary.id);
            if (index < 0) {
              return [summary, ...current];
            }
            const next = [...current];
            next[index] = summary;
            next.sort(
              (left, right) =>
                new Date(right.updatedAt).getTime() -
                new Date(left.updatedAt).getTime()
            );
            return next;
          });
        })
        .catch(() => undefined);
    };
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    if (immediate) {
      run();
      return;
    }
    persistTimeoutRef.current = setTimeout(run, 300);
  };

  const loadSession = async (sessionId: string) => {
    if (!api) return;
    try {
      const entries = await api.getChatSession(sessionId);
      setTimeline(fromPersistedEntries(entries));
      resetEphemeralChatState();
      setActiveSessionId(sessionId);
    } catch {
      setTimeline([]);
      resetEphemeralChatState();
    }
  };

  const refreshSessions = async (provider: ChatProvider) => {
    if (!api) return [];
    const listed = await api.listChatSessions(provider);
    setSessions(listed);
    return listed;
  };

  const ensureActiveSession = async (provider: ChatProvider) => {
    if (!api) return null;
    const listed = await refreshSessions(provider);
    if (listed.length > 0) {
      await loadSession(listed[0].id);
      return listed[0].id;
    }
    const created = await api.createChatSession(provider);
    setSessions([created]);
    setActiveSessionId(created.id);
    setTimeline([]);
    resetEphemeralChatState();
    return created.id;
  };

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Load sign-in/provider state on mount.
  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setCheckingAuth(false);
      return;
    }
    void Promise.allSettled([
      api.getChatAuthStatus(),
      api.getChatSettings(),
      api.getClaudeCodeStatus()
    ])
      .then(async ([authResult, settingsResult, claudeResult]) => {
        if (cancelled) return;
        setAuthStatus(
          authResult.status === "fulfilled"
            ? authResult.value
            : { signedIn: false }
        );
        const settings =
          settingsResult.status === "fulfilled"
            ? settingsResult.value
            : DEFAULT_CHAT_SETTINGS;
        setChatSettings(settings);
        if (claudeResult.status === "fulfilled") {
          setClaudeStatus(claudeResult.value);
        }
        await ensureActiveSession(settings.provider);
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      if (claudePollTimerRef.current) {
        clearTimeout(claudePollTimerRef.current);
        claudePollTimerRef.current = null;
      }
      if (chatHighlightTimeoutRef.current) {
        clearTimeout(chatHighlightTimeoutRef.current);
        chatHighlightTimeoutRef.current = null;
      }
    };
  }, [api]);

  useEffect(() => {
    if (!api || checkingAuth || streaming || !activeSessionId) return;
    persistHistory(activeSessionId, timeline);
  }, [api, checkingAuth, streaming, timeline, activeSessionId]);

  useEffect(() => {
    onActivityChange?.(streaming || exportingLatestActivity);
  }, [streaming, exportingLatestActivity, onActivityChange]);

  const refreshMcpStatuses = useCallback(async () => {
    if (!api) return;
    const [corosResult, statusesResult] = await Promise.allSettled([
      api.getCorosMcpStatus(),
      api.getMcpStatuses()
    ]);
    if (corosResult.status === "fulfilled") {
      setMcpStatus(corosResult.value);
    }
    if (statusesResult.status === "fulfilled") {
      setMcpStatuses(statusesResult.value);
    }
    setMcpRefreshVersion((version) => version + 1);
  }, [api]);

  // Load MCP connection status on mount (and shortly after, to catch the
  // silent startup reconnect completing in the main process).
  useEffect(() => {
    if (!api) return;
    void refreshMcpStatuses();
    const timer = setTimeout(() => void refreshMcpStatuses(), 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [api, refreshMcpStatuses]);

  useEffect(() => {
    if (!showTools || settingsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!mcpRef.current?.contains(event.target as Node)) {
        setShowTools(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowTools(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showTools, settingsOpen]);

  // Subscribe once to the streaming push channels.
  useEffect(() => {
    if (!api) return;
    const restoreResumedCoachPrompt = () => {
      const originalPrompt = resumedCoachPromptRef.current;
      resumedCoachPromptRef.current = null;
      if (!originalPrompt) return;
      setTimeline((prev) => {
        const next = prev.map((entry): ChatEntry =>
          entry.kind === "coachPrompt" &&
          entry.prompt.promptId === originalPrompt.promptId
            ? { kind: "coachPrompt", prompt: originalPrompt }
            : entry
        );
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    };
    const finishStreaming = (finalText: string, finishReason?: string) => {
      activeRequestIdRef.current = null;
      setStreaming(false);
      setStreamingText("");
      setThinkingText("");
      setActiveTool(null);
      const source = sourceRef.current ?? undefined;
      const reasoningSummary = thinkingRef.current.trim() || undefined;
      thinkingRef.current = "";
      const coachPrompts = pendingCoachPromptsRef.current;
      pendingCoachPromptsRef.current = [];
      setCurrentSource(null);
      sourceRef.current = null;
      if (finishReason === "cancelled") {
        restoreResumedCoachPrompt();
        return;
      }
      resumedCoachPromptRef.current = null;
      if (finalText || coachPrompts.length > 0) {
        setTimeline((prev) => {
          let next: ChatEntry[] = [...prev];
          if (source?.mcpError) {
            next.push({ kind: "toolNotice", message: source.mcpError });
          }
          if (finalText) {
            next.push({
              kind: "message",
              role: "assistant",
              content: finalText,
              source,
              reasoningSummary
            });
          }
          for (const prompt of coachPrompts) {
            next = upsertCoachPromptEntry(next, prompt);
          }
          persistHistory(activeSessionIdRef.current, next, true);
          return next;
        });
      }
    };

    const unsubscribers = [
      api.onChatStreamStart((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        setStreamingText("");
        setThinkingText("");
        thinkingRef.current = "";
        setActiveTool(null);
        pendingCoachPromptsRef.current = [];
      }),
      api.onChatStreamToken((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        setActiveTool(null);
        setStreamingText((prev) => prev + payload.delta);
      }),
      api.onChatStreamInfo((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        if (payload.kind === "context") {
          sourceRef.current = {
            snapshotIncluded: payload.snapshotIncluded,
            mcpEnabled: payload.mcpEnabled,
            mcpUsed: false,
            mcpTools: []
          };
          setCurrentSource(sourceRef.current);
        } else if (payload.kind === "planDraft") {
          setTimeline((prev) => upsertPlanDraftEntry(prev, payload.draft));
        } else if (payload.kind === "workoutDelete") {
          setTimeline((prev) =>
            upsertWorkoutDeleteEntry(prev, payload.preview)
          );
        } else if (payload.kind === "activityVisual") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertActivityVisualEntry(prev, payload.preview));
          }
        } else if (payload.kind === "fitnessTrend") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertFitnessTrendEntry(prev, payload.preview));
          }
        } else if (payload.kind === "hrZoneSummary") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertHrZoneEntry(prev, payload.preview));
          }
        } else if (payload.kind === "coachPrompt") {
          pendingCoachPromptsRef.current = [
            ...pendingCoachPromptsRef.current.filter(
              (prompt) => prompt.promptId !== payload.prompt.promptId
            ),
            payload.prompt
          ];
        } else if (payload.kind === "thinking") {
          thinkingRef.current += payload.delta;
          setThinkingText(thinkingRef.current);
        } else if (payload.kind === "mcp") {
          setActiveTool(payload.status === "call" ? payload.tool ?? null : null);
          const base: SourceInfo = sourceRef.current ?? {
            snapshotIncluded: false,
            mcpEnabled: true,
            mcpUsed: false,
            mcpTools: []
          };
          sourceRef.current = {
            ...base,
            mcpUsed: true,
            mcpTools: payload.tool
              ? [...base.mcpTools, payload.tool]
              : base.mcpTools,
            mcpError:
              /fail|error/i.test(payload.status) || payload.message
                ? payload.message ?? payload.status
                : base.mcpError
          };
          setCurrentSource(sourceRef.current);
        }
      }),
      api.onChatStreamDone((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        finishStreaming(payload.fullText, payload.finishReason);
      }),
      api.onChatStreamError((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        activeRequestIdRef.current = null;
        setStreaming(false);
        setStreamingText("");
        setThinkingText("");
        thinkingRef.current = "";
        setActiveTool(null);
        setCurrentSource(null);
        sourceRef.current = null;
        pendingCoachPromptsRef.current = [];
        restoreResumedCoachPrompt();
        onError(payload.message);
        if (payload.authError) {
          setAuthStatus({ signedIn: false });
        }
        if (chatSettings.provider === "claude-code") {
          void api
            .getClaudeCodeStatus()
            .then(setClaudeStatus)
            .catch(() => undefined);
        }
      })
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [api, chatSettings.provider, chatSettings.visualizationsEnabled, onError]);

  // Keep the transcript scrolled to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, streamingText, thinkingText, exportingLatestActivity]);

  const handleSignIn = async () => {
    if (!api) return;
    setSigningIn(true);
    onError(null);
    try {
      const status = await api.loginChat();
      setAuthStatus(status);
      if (chatSettings.provider === "chatgpt") {
        await ensureActiveSession("chatgpt");
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "ChatGPT sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!api) return;
    if (activeRequestIdRef.current) {
      void api.cancelChat(activeRequestIdRef.current);
      activeRequestIdRef.current = null;
      setStreaming(false);
      setStreamingText("");
    }
    const status = await api.logoutChat();
    setAuthStatus(status);
  };

  const refreshClaudeCodeStatus = async () => {
    if (!api || checkingClaude) return null;
    setCheckingClaude(true);
    onError(null);
    try {
      const status = await api.getClaudeCodeStatus();
      setClaudeStatus(status);
      return status;
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Claude Code detection failed."
      );
      return null;
    } finally {
      setCheckingClaude(false);
    }
  };

  const pollClaudeCodeStatus = (attempt = 0) => {
    if (!api || attempt >= 40) return;
    if (claudePollTimerRef.current) {
      clearTimeout(claudePollTimerRef.current);
    }
    claudePollTimerRef.current = setTimeout(() => {
      void api
        .getClaudeCodeStatus()
        .then((status) => {
          setClaudeStatus(status);
          if (status.state === "connecting" || status.state === "sign-in-required") {
            pollClaudeCodeStatus(attempt + 1);
          }
        })
        .catch(() => pollClaudeCodeStatus(attempt + 1));
    }, 1500);
  };

  const handleConnectClaudeCode = async () => {
    if (!api || connectingClaude) return;
    setConnectingClaude(true);
    onError(null);
    try {
      const status = await api.connectClaudeCode();
      setClaudeStatus(status);
      if (status.state === "connecting" || status.state === "sign-in-required") {
        pollClaudeCodeStatus();
      }
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : "Claude sign-in failed."
      );
    } finally {
      setConnectingClaude(false);
    }
  };

  const handleTestClaudeCode = async () => {
    if (!api || testingClaude) return;
    setTestingClaude(true);
    onError(null);
    try {
      const result = await api.testClaudeCodeConnection();
      setClaudeStatus(result.status);
      if (!result.ok) onError(result.message);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Claude connection test failed."
      );
    } finally {
      setTestingClaude(false);
    }
  };

  const handleUpdateClaudeCode = async (
    patch: Partial<ChatSettings["claudeCode"]>
  ) => {
    const nextClaudeCode = {
      ...chatSettings.claudeCode,
      ...patch,
      permissions: {
        ...chatSettings.claudeCode.permissions,
        ...(patch.permissions ?? {})
      }
    };
    const nextSettings = { ...chatSettings, claudeCode: nextClaudeCode };
    setChatSettings(nextSettings);
    setClaudeStatus(null);
    if (!api) return;
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not save Claude settings."
      );
    }
  };

  const handleNewChat = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      const created = await api.createChatSession(chatSettings.provider);
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.id);
      setTimeline([]);
      resetEphemeralChatState();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not start a new chat.");
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity || sessionId === activeSessionId) {
      return;
    }
    onError(null);
    await loadSession(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.deleteChatSession(sessionId);
      const listed = await refreshSessions(chatSettings.provider);
      if (sessionId === activeSessionId) {
        if (listed.length > 0) {
          await loadSession(listed[0].id);
        } else {
          const created = await api.createChatSession(chatSettings.provider);
          setSessions([created]);
          setActiveSessionId(created.id);
          setTimeline([]);
          resetEphemeralChatState();
        }
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not delete chat.");
    }
  };

  const handleProviderChange = async (provider: ChatProvider) => {
    if (!api || provider === chatSettings.provider) return;
    const nextSettings: ChatSettings = { ...chatSettings, provider };
    setChatSettings(nextSettings);
    setLocalConnection(null);
    setOpenRouterConnection(null);
    onError(null);
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
      await ensureActiveSession(provider);
      if (provider === "claude-code") {
        const status = await api.getClaudeCodeStatus();
        setClaudeStatus(status);
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Provider change failed.");
    }
  };

  const handleModelChange = async (model: string) => {
    if (!api || chatSettings.provider === "local") return;
    const normalizedModel = model.trim() || undefined;
    const nextSettings: ChatSettings =
      chatSettings.provider === "claude-code"
        ? {
            ...chatSettings,
            claudeCode: {
              ...chatSettings.claudeCode,
              model: normalizedModel
            }
          }
        : chatSettings.provider === "openrouter"
          ? {
              ...chatSettings,
              openRouter: {
                ...chatSettings.openRouter,
                model: normalizedModel ?? "openrouter/auto"
              }
            }
        : {
            ...chatSettings,
            chatgpt: {
              ...chatSettings.chatgpt,
              model: normalizedModel
            }
          };

    setChatSettings(nextSettings);
    setSavingSettings(true);
    onError(null);
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not save the selected model."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const updateOpenRouterDraft = (
    patch: Partial<ChatSettings["openRouter"]>
  ) => {
    setChatSettings((current) => ({
      ...current,
      openRouter: {
        ...current.openRouter,
        ...patch
      }
    }));
    setOpenRouterConnection(null);
  };

  const handleSaveOpenRouterSettings = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const apiKey = openRouterApiKey.trim();
      const saved = await api.saveChatSettings({
        ...chatSettings,
        openRouter: {
          ...chatSettings.openRouter,
          apiKey: apiKey || undefined
        }
      });
      setChatSettings(saved);
      setOpenRouterApiKey("");
      setOpenRouterConnection((current) => ({
        ok: true,
        message: "OpenRouter settings saved.",
        models: current?.models ?? []
      }));
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not save OpenRouter settings."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearOpenRouterApiKey = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const saved = await api.saveChatSettings({
        ...chatSettings,
        openRouter: {
          ...chatSettings.openRouter,
          clearApiKey: true
        }
      });
      setChatSettings(saved);
      setOpenRouterApiKey("");
      setOpenRouterConnection({
        ok: true,
        message: "OpenRouter API key cleared.",
        models: []
      });
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not clear the OpenRouter API key."
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestOpenRouterConnection = async () => {
    if (!api || testingOpenRouter) return;
    setTestingOpenRouter(true);
    setOpenRouterConnection(null);
    onError(null);
    try {
      const result = await api.testOpenRouterConnection({
        ...chatSettings.openRouter,
        apiKey: openRouterApiKey.trim() || undefined
      });
      setOpenRouterConnection(result);
      if (!result.ok) onError(result.message);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "OpenRouter connection test failed."
      );
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const updateLocalDraft = (patch: Partial<ChatSettings["local"]>) => {
    setChatSettings((current) => ({
      ...current,
      local: {
        ...current.local,
        ...patch
      }
    }));
    setLocalConnection(null);
  };

  const handleUpdateChatSettings = async (patch: Partial<ChatSettings>) => {
    if (!api) return false;
    const nextSettings = { ...chatSettings, ...patch };
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
      onError(null);
      return true;
    } catch {
      onError("Could not save Coach settings. Please try again.");
      return false;
    }
  };

  const handleSaveLocalSettings = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const apiKey = localApiKey.trim();
      const saved = await api.saveChatSettings({
        ...chatSettings,
        local: {
          ...chatSettings.local,
          apiKey: apiKey || undefined
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local model settings saved.",
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Local settings failed.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearLocalApiKey = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const saved = await api.saveChatSettings({
        ...chatSettings,
        local: {
          ...chatSettings.local,
          clearApiKey: true
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local API key cleared.",
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not clear API key.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDetectLocalServers = async (auto = false) => {
    if (!api || detectingLocal) return;
    setDetectingLocal(true);
    if (!auto) {
      setLocalConnection(null);
      onError(null);
    }
    try {
      const discovery = await api.detectLocalChatServers(
        localApiKey.trim() || undefined
      );
      setLocalDiscovery(discovery);
      const available = discovery.servers.filter(
        (server) => server.ok && server.models.length > 0
      );
      if (available.length === 0) {
        const runningEmpty = discovery.servers.filter((server) => server.ok);
        setLocalConnection({
          ok: false,
          message:
            runningEmpty.length > 0
              ? `${runningEmpty.map((server) => server.label).join(" and ")} ${runningEmpty.length === 1 ? "is" : "are"} running, but no models were found. Pull an Ollama model or load a model in LM Studio, then detect again.`
              : "No Ollama or LM Studio server found on localhost ports 11434 or 1234."
        });
        return;
      }

      const currentBaseUrl = chatSettings.local.baseUrl;
      const currentModel = chatSettings.local.model;
      const preferred =
        available.find(
          (server) =>
            server.baseUrl === currentBaseUrl &&
            server.models.includes(currentModel)
        ) ??
        available.find((server) => server.baseUrl === currentBaseUrl) ??
        available[0];
      const model = preferred.models.includes(currentModel)
        ? currentModel
        : preferred.models[0];
      const nextSettings: ChatSettings = {
        ...chatSettings,
        provider: "local",
        local: {
          ...chatSettings.local,
          baseUrl: preferred.baseUrl,
          model
        }
      };
      const apiKey = localApiKey.trim();
      const saved = await api.saveChatSettings({
        ...nextSettings,
        local: {
          ...nextSettings.local,
          apiKey: apiKey || undefined
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: `Detected ${preferred.label} with ${preferred.models.length} model${preferred.models.length === 1 ? "" : "s"}.`,
        normalizedBaseUrl: preferred.baseUrl,
        models: preferred.models
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Local model detection failed.";
      if (auto) {
        setLocalConnection({ ok: false, message });
      } else {
        onError(message);
      }
    } finally {
      setDetectingLocal(false);
    }
  };

  useEffect(() => {
    if (
      !api ||
      checkingAuth ||
      chatSettings.provider !== "local" ||
      chatSettings.local.model.trim() ||
      autoDetectLocalRef.current
    ) {
      return;
    }
    autoDetectLocalRef.current = true;
    void handleDetectLocalServers(true);
  }, [api, checkingAuth, chatSettings.provider, chatSettings.local.model]);

  const handleTestLocalConnection = async () => {
    if (!api) return;
    setTestingLocal(true);
    setLocalConnection(null);
    onError(null);
    try {
      const result = await api.testLocalChatConnection({
        ...chatSettings.local,
        apiKey: localApiKey.trim() || undefined
      });
      setLocalConnection(result);
      if (result.normalizedBaseUrl) {
        setChatSettings((current) => ({
          ...current,
          local: {
            ...current.local,
            baseUrl: result.normalizedBaseUrl ?? current.local.baseUrl
          }
        }));
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Local connection test failed.");
    } finally {
      setTestingLocal(false);
    }
  };

  const handleConnectMcp = async () => {
    if (!api || mcpBusy) return;
    setMcpBusy(true);
    onError(null);
    try {
      const status = await api.connectCorosMcp();
      setMcpStatus(status);
      // Surface the discovered tools for verification during this milestone.
      console.log("[COROS MCP] tools:", status.tools);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "COROS connection failed.");
    } finally {
      await refreshMcpStatuses();
      setMcpBusy(false);
    }
  };

  const sendMessage = async (
    trimmed: string,
    answeredPrompt?: { promptId: string; choiceId: string }
  ): Promise<boolean> => {
    if (!api || !trimmed || streaming || exportingLatestActivity) return false;
    if (isLatestActivityFileRequest(trimmed)) {
      await handleLatestActivityFileRequest(trimmed);
      return true;
    }
    if (
      chatSettings.provider === "openrouter" &&
      !chatSettings.openRouter.hasApiKey &&
      !openRouterApiKey.trim()
    ) {
      onError("Add an OpenRouter API key in Coach settings first.");
      return false;
    }
    if (chatSettings.provider === "openrouter") {
      try {
        const apiKey = openRouterApiKey.trim();
        const saved = await api.saveChatSettings({
          ...chatSettings,
          openRouter: {
            ...chatSettings.openRouter,
            apiKey: apiKey || undefined
          }
        });
        setChatSettings(saved);
        setOpenRouterApiKey("");
      } catch (caught) {
        onError(
          caught instanceof Error
            ? caught.message
            : "OpenRouter settings failed."
        );
        return false;
      }
    }
    if (chatSettings.provider === "local" && !chatSettings.local.model.trim()) {
      onError("Enter a local model before starting the coach.");
      return false;
    }
    if (chatSettings.provider === "local") {
      try {
        const apiKey = localApiKey.trim();
        const saved = await api.saveChatSettings({
          ...chatSettings,
          local: {
            ...chatSettings.local,
            apiKey: apiKey || undefined
          }
        });
        setChatSettings(saved);
        setLocalApiKey("");
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : "Local settings failed.");
        return false;
      }
    }
    let answeredPromptIndex = answeredPrompt
      ? timeline.findIndex(
          (entry) =>
            entry.kind === "coachPrompt" &&
            entry.prompt.promptId === answeredPrompt.promptId &&
            entry.prompt.answeredAt === undefined
        )
      : -1;
    if (answeredPromptIndex < 0) {
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        const entry = timeline[index];
        if (entry.kind === "coachPrompt" && entry.prompt.answeredAt === undefined) {
          answeredPromptIndex = index;
          break;
        }
      }
    }
    const promptEntry =
      answeredPromptIndex >= 0 ? timeline[answeredPromptIndex] : undefined;
    const originalPrompt =
      promptEntry?.kind === "coachPrompt" ? promptEntry.prompt : null;
    const answeredTimeline = timeline.map((entry, index): ChatEntry =>
      index === answeredPromptIndex && entry.kind === "coachPrompt"
        ? {
            kind: "coachPrompt",
            prompt: {
              ...entry.prompt,
              answer: trimmed,
              answeredAt: Date.now(),
              selectedChoiceId:
                answeredPrompt?.promptId === entry.prompt.promptId
                  ? answeredPrompt.choiceId
                  : undefined
            }
          }
        : entry
    );
    const nextEntries: ChatEntry[] = originalPrompt
      ? answeredTimeline
      : [
          ...answeredTimeline,
          { kind: "message", role: "user", content: trimmed }
        ];
    const requestId = crypto.randomUUID();

    activeRequestIdRef.current = requestId;
    resumedCoachPromptRef.current = originalPrompt;
    sourceRef.current = null;
    setCurrentSource(null);
    setTimeline(nextEntries);
    // Keep the unanswered card durable until the resumed turn completes. If
    // the app closes mid-request, reloading the session can safely offer it
    // again instead of leaving an answered-but-incomplete invisible entry.
    if (!originalPrompt) {
      persistHistory(activeSessionIdRef.current, nextEntries, true);
    }
    setStreaming(true);
    setStreamingText("");
    onError(null);

    const wireMessages = toWireMessages(nextEntries);
    try {
      await api.sendChat(requestId, wireMessages, unitSystem);
    } catch (caught) {
      activeRequestIdRef.current = null;
      setStreaming(false);
      if (originalPrompt) {
        resumedCoachPromptRef.current = null;
        const restoredEntries = timeline.map((entry): ChatEntry =>
          entry.kind === "coachPrompt" &&
          entry.prompt.promptId === originalPrompt.promptId
            ? { kind: "coachPrompt", prompt: originalPrompt }
            : entry
        );
        setTimeline(restoredEntries);
        persistHistory(activeSessionIdRef.current, restoredEntries, true);
      }
      onError(caught instanceof Error ? caught.message : "Chat request failed.");
    }
    return true;
  };

  const handleCoachPromptChoice = async (
    prompt: CoachInputPrompt,
    choice: CoachInputChoice
  ) => {
    await sendMessage(choice.response, {
      promptId: prompt.promptId,
      choiceId: choice.id
    });
  };

  const handleCustomCoachAnswer = () => {
    composerRef.current?.focus();
  };

  const handleStop = () => {
    if (!api || !activeRequestIdRef.current) return;
    void api.cancelChat(activeRequestIdRef.current);
  };

  const handleUploadPlanDraft = async (
    draftId: string,
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ) => {
    if (!api || uploadingDraftId) return;
    setUploadingDraftId(draftId);
    onError(null);
    try {
      const result = await api.uploadTrainingPlanDraft(
        draftId,
        unitSystem,
        destination,
        scheduleDate
      );
      const scheduledDates = new Map(
        result.entries.flatMap((entry) => {
          if (!entry.date) return [];
          const normalized = entry.date.replace(/-/g, "");
          if (!/^\d{8}$/.test(normalized)) return [];
          return [[
            entry.key,
            `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
          ] as const];
        })
      );
      setUploadedPlans((prev) => ({ ...prev, [draftId]: result }));
      setTimeline((prev) => {
        const next = prev.map((entry) =>
          entry.kind === "planDraft" && entry.draft.draftId === draftId
            ? {
                kind: "planDraft" as const,
                draft: {
                  ...entry.draft,
                  uploadedAt: Date.now(),
                  entries: entry.draft.entries.map((draftEntry) => {
                    const scheduledDate = scheduledDates.get(draftEntry.key);
                    const clearDate =
                      destination === "workoutLibrary" &&
                      entry.draft.artifactType === "workout";
                    return {
                      ...draftEntry,
                      scheduleDate: clearDate
                        ? undefined
                        : scheduledDate ?? draftEntry.scheduleDate,
                      source: draftEntry.source
                        ? {
                            ...draftEntry.source,
                            schedule_date: clearDate
                              ? undefined
                              : scheduledDate?.replace(/-/g, "") ??
                                draftEntry.source.schedule_date
                          }
                        : undefined
                    };
                  }),
                  uploadResult: {
                    workoutsScheduled: result.workoutsScheduled,
                    workoutsCreated: result.workoutsCreated,
                    destination: result.destination,
                    localPlanId: result.localPlanId,
                    groupedPlanCreated: result.groupedPlanCreated
                  }
                }
              }
            : entry
        );
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Failed to save the workout or plan to COROS."
      );
    } finally {
      setUploadingDraftId(null);
    }
  };

  const handleReviewPlanDraft = (draft: PlanDraftPreview) => {
    if (!onReviewPlan) return;
    try {
      onError(null);
      onReviewPlan(trainingPlanFromCoachDraftPreview(draft));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "The Coach plan could not be opened in the Training Library.");
    }
  };

  const handleScrollToPlanChat = (draftId: string) => {
    const planIndex = timeline.findIndex(
      (entry) => entry.kind === "planDraft" && entry.draft.draftId === draftId
    );
    if (planIndex < 0) return;

    let targetIndex = timeline.findIndex(
      (entry, index) =>
        index > planIndex &&
        entry.kind === "message" &&
        entry.role === "assistant"
    );
    if (targetIndex < 0) {
      for (let index = planIndex - 1; index >= 0; index -= 1) {
        const entry = timeline[index];
        if (entry.kind === "message" && entry.role === "assistant") {
          targetIndex = index;
          break;
        }
      }
    }
    if (targetIndex < 0) return;

    const transcript = scrollRef.current;
    const target = transcript?.querySelector<HTMLElement>(
      `[data-chat-entry-index="${targetIndex}"]`
    );
    if (!transcript || !target) return;

    const transcriptRect = transcript.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop =
      transcript.scrollTop +
      targetRect.top -
      transcriptRect.top -
      Math.max(24, (transcript.clientHeight - targetRect.height) / 2);

    transcript.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    setHighlightedChatEntryIndex(targetIndex);
    if (chatHighlightTimeoutRef.current) {
      clearTimeout(chatHighlightTimeoutRef.current);
    }
    chatHighlightTimeoutRef.current = setTimeout(() => {
      setHighlightedChatEntryIndex(null);
      chatHighlightTimeoutRef.current = null;
    }, 1800);
  };

  const handleConfirmWorkoutDelete = async (requestId: string) => {
    if (!api || deletingRequestId) return;
    setDeletingRequestId(requestId);
    onError(null);
    try {
      const result = await api.confirmWorkoutDelete(requestId);
      setDeletedWorkouts((prev) => ({ ...prev, [requestId]: result }));
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Failed to delete workout from COROS."
      );
    } finally {
      setDeletingRequestId(null);
    }
  };

  const handleLatestActivityFileRequest = async (trimmed: string) => {
    if (!api) return;

    const nextEntries: ChatEntry[] = [
      ...timeline,
      { kind: "message", role: "user", content: trimmed }
    ];
    setTimeline(nextEntries);
    persistHistory(activeSessionIdRef.current, nextEntries, true);
    setExportingLatestActivity(true);
    onError(null);

    try {
      const result = await api.exportLatestTrainingHubActivityFile(4);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: formatLatestActivityExportMessage(result)
          }
        ];
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Latest activity FIT export failed.";
      onError(message);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: `I couldn't download the latest activity FIT file: ${message}`
          }
        ];
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
    } finally {
      setExportingLatestActivity(false);
    }
  };

  const isLocalProvider = chatSettings.provider === "local";
  const isClaudeProvider = chatSettings.provider === "claude-code";
  const isOpenRouterProvider = chatSettings.provider === "openrouter";
  const isChatGptProvider = chatSettings.provider === "chatgpt";
  const localModelConfigured = chatSettings.local.model.trim().length > 0;
  const isBusy = streaming || exportingLatestActivity;
  const waitingForCoachAnswer = [...timeline]
    .reverse()
    .some(
      (entry) =>
        entry.kind === "coachPrompt" && entry.prompt.answeredAt === undefined
    );
  const showLoginGate = isChatGptProvider && !authStatus?.signedIn;
  const showClaudeGate =
    isClaudeProvider && claudeStatus?.state !== "connected";
  const showOpenRouterGate =
    isOpenRouterProvider && !chatSettings.openRouter.hasApiKey;
  const showPlanPanel = useMediaQuery("(min-width: 1400px)");
  const planDrafts = timeline.flatMap((entry) =>
    entry.kind === "planDraft" ? [entry.draft] : []
  );
  const latestPlanDraft = planDrafts.at(-1);
  const selectedPlanDraft =
    planDrafts.find((draft) => draft.draftId === selectedPlanDraftId) ??
    latestPlanDraft;
  const trainingPlanDrafts = planDrafts.filter(
    (draft) => draft.artifactType !== "workout"
  );
  const selectedTrainingPlanNumber = selectedPlanDraft?.artifactType !== "workout"
    ? trainingPlanDrafts.findIndex(
        (draft) => draft.draftId === selectedPlanDraft?.draftId
      ) + 1
    : 0;

  useEffect(() => {
    setSelectedPlanDraftId(latestPlanDraft?.draftId ?? null);
    if (latestPlanDraft) {
      setPlanPanelExpanded(false);
    }
  }, [activeSessionId, latestPlanDraft?.draftId]);

  const providerSwitch = (
    <ProviderSwitch
      provider={chatSettings.provider}
      disabled={savingSettings || isBusy}
      onChange={(provider) => void handleProviderChange(provider)}
    />
  );
  const selectedModel =
    chatSettings.provider === "claude-code"
      ? chatSettings.claudeCode.model ?? ""
      : chatSettings.provider === "openrouter"
        ? chatSettings.openRouter.model
        : chatSettings.chatgpt.model ?? "";
  const providerControls = (
    <div className="chat-provider-controls">
      {providerSwitch}
      <ModelSwitch
        provider={chatSettings.provider}
        model={selectedModel}
        disabled={savingSettings || isBusy}
        onChange={(model) => void handleModelChange(model)}
      />
    </div>
  );

  const conversationSidebarOpen = chatSettings.sidebarOpen !== false;
  const sidebarProps = {
    open: conversationSidebarOpen,
    overlay: false,
    sessions,
    activeSessionId,
    busy: isBusy,
    onClose: () => void handleUpdateChatSettings({ sidebarOpen: false }),
    onOpen: () => void handleUpdateChatSettings({ sidebarOpen: true }),
    onNewChat: () => void handleNewChat(),
    onSelectSession: (sessionId: string) => void handleSelectSession(sessionId),
    onDeleteSession: (sessionId: string) => void handleDeleteSession(sessionId)
  };

  const settingsModalProps = {
    api,
    mcpRefreshVersion,
    open: settingsOpen,
    chatSettings,
    authStatus,
    claudeStatus,
    openRouterApiKey,
    openRouterConnection,
    localApiKey,
    localConnection,
    localDiscovery,
    savingSettings,
    testingLocal,
    testingOpenRouter,
    detectingLocal,
    signingIn,
    checkingClaude,
    connectingClaude,
    testingClaude,
    busy: isBusy,
    onClose: () => setSettingsOpen(false),
    onSignIn: () => void handleSignIn(),
    onSignOut: () => void handleSignOut(),
    onRefreshClaude: () => void refreshClaudeCodeStatus(),
    onConnectClaude: () => void handleConnectClaudeCode(),
    onTestClaude: () => void handleTestClaudeCode(),
    onOpenClaudeSetupGuide: () => void api?.openClaudeCodeSetupGuide(),
    onUpdateClaudeCode: (patch: Partial<ChatSettings["claudeCode"]>) =>
      void handleUpdateClaudeCode(patch),
    onOpenRouterApiKeyChange: setOpenRouterApiKey,
    onUpdateOpenRouterDraft: updateOpenRouterDraft,
    onTestOpenRouterConnection: () =>
      void handleTestOpenRouterConnection(),
    onSaveOpenRouterSettings: () => void handleSaveOpenRouterSettings(),
    onClearOpenRouterApiKey: () => void handleClearOpenRouterApiKey(),
    onOpenOpenRouterKeys: () => void api?.openOpenRouterKeys(),
    onOpenOpenRouterModels: () => void api?.openOpenRouterModels(),
    onLocalApiKeyChange: setLocalApiKey,
    onUpdateLocalDraft: updateLocalDraft,
    onDetectLocalServers: () => void handleDetectLocalServers(),
    onTestLocalConnection: () => void handleTestLocalConnection(),
    onSaveLocalSettings: () => void handleSaveLocalSettings(),
    onClearLocalApiKey: () => void handleClearLocalApiKey(),
    onMcpServersChange: refreshMcpStatuses,
    onUpdateChatSettings: (patch: Partial<ChatSettings>) =>
      handleUpdateChatSettings(patch)
  };

  if (checkingAuth) {
    return (
      <div className="chat-view chat-view-centered">
        <Loader2 className="chat-spinner" size={22} aria-hidden="true" />
      </div>
    );
  }

  if (showClaudeGate) {
    const notInstalled = claudeStatus?.state === "not-installed";
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-claude-login-panel">
              <Terminal size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Claude Code</h2>
                <span className="chat-beta-badge">Beta</span>
              </div>
              <p>
                Use the Claude Code CLI installed on this computer with your
                existing Claude subscription. CorosLink does not read or store
                your Claude credentials.
              </p>
              <div className="chat-login-actions">
                {notInstalled ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void api?.openClaudeCodeSetupGuide()}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    Install Claude Code
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleConnectClaudeCode()}
                    disabled={connectingClaude || !api}
                  >
                    {connectingClaude ? (
                      <Loader2
                        className="chat-spinner"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : (
                      <Terminal size={16} aria-hidden="true" />
                    )}
                    Sign in with Claude
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshClaudeCodeStatus()}
                  disabled={checkingClaude || !api}
                >
                  {checkingClaude ? (
                    <Loader2
                      className="chat-spinner"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw size={16} aria-hidden="true" />
                  )}
                  Check again
                </button>
              </div>
              <p className="chat-login-note">
                {claudeStatus?.message ?? "Checking for Claude Code…"}
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      </div>
    );
  }

  if (showOpenRouterGate) {
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-openrouter-login-panel">
              <Network size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Connect OpenRouter</h2>
                <span className="chat-beta-badge">BYOK</span>
              </div>
              <p>
                Use your OpenRouter API key and model credits for COROS-aware
                coaching, workout drafting, and activity tools.
              </p>
              <div className="chat-login-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  Add API key
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void api?.openOpenRouterKeys()}
                  disabled={!api}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  Get a key from OpenRouter
                </button>
              </div>
              <p className="chat-login-note">
                Your key is encrypted in local app storage and is never added to
                the chat transcript.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      </div>
    );
  }

  if (showLoginGate) {
    return (
      <div
        className={["chat-view", "chat-view-login"]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel">
              <MessageCircle size={32} aria-hidden="true" />
              <h2>Your training coach</h2>
              <p>
                Sign in with your ChatGPT account to chat with a coach that knows your
                COROS activities, recovery, and upcoming workouts.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleSignIn()}
                disabled={signingIn || !api}
              >
                {signingIn ? (
                  <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
                ) : null}
                Sign in with ChatGPT
              </button>
              <p className="chat-login-note">
                Or switch to Local model below to chat without signing in.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerControls}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      </div>
    );
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-header-title">
          <span>Training Coach</span>
        </div>
        <div className="chat-header-end">
          <button
            type="button"
            className="chat-settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <Settings2 size={16} aria-hidden="true" />
            Settings
          </button>
          <div className="chat-mcp" ref={mcpRef}>
            {(() => {
              const connectedServers = mcpStatuses.filter((s) => s.connected);
              const totalTools = connectedServers.reduce(
                (n, s) => n + s.toolCount,
                0
              );
              return connectedServers.length > 0 ? (
              <>
                <button
                  type="button"
                  className="chat-mcp-pill connected"
                  onClick={() => setShowTools((open) => !open)}
                  title={`Connected via MCP: ${connectedServers
                    .map((s) => s.name)
                    .join(", ")}`}
                  aria-expanded={showTools}
                  aria-haspopup="dialog"
                >
                  <Database size={13} aria-hidden="true" />
                  {connectedServers.length === 1
                    ? connectedServers[0].name
                    : `${connectedServers.length} MCP servers`}{" "}
                  · {totalTools} tools
                </button>
                {showTools ? (
                  <div className="chat-mcp-panel">
                    <ul>
                      {connectedServers.map((s) => (
                        <li key={s.id}>
                          <code>{s.name}</code>
                          <span>{s.toolCount} tools</span>
                        </li>
                      ))}
                    </ul>
                    <div className="chat-mcp-panel-head">
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                      >
                        Manage servers
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="chat-mcp-pill"
                onClick={() => {
                  setSettingsOpen(true);
                  void handleConnectMcp();
                }}
                disabled={mcpBusy}
              >
                {mcpBusy ? (
                  <Loader2 className="chat-spinner" size={13} aria-hidden="true" />
                ) : (
                  <Database size={13} aria-hidden="true" />
                )}
                {mcpBusy
                  ? "Connecting…"
                  : mcpStatus?.authorized
                    ? "Reconnect COROS"
                    : "Connect COROS"}
              </button>
            );
            })()}
          </div>
          {isChatGptProvider ? (
            <button
              type="button"
              className="chat-signout"
              onClick={() => void handleSignOut()}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      <div className="chat-layout">
        <ChatSidebar {...sidebarProps} />
        <div className="chat-main">
          <div className="chat-transcript" ref={scrollRef}>
        <div className="chat-thread">
          {timeline.length === 0 && !streaming ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Sparkles size={28} aria-hidden="true" />
              </div>
              <h3>How can I help with your training?</h3>
              <div className="chat-suggestions">
                {[
                  "How was my latest activity?",
                  "Break down my latest workout by lap",
                  "Create one workout for today and save it to my Workout Library",
                  "Build a balanced week from my recent training",
                  "Schedule bike intervals for Saturday",
                  "Add strength around my endurance sessions",
                  "Am I recovered enough for a hard session?",
                  "Download my latest activity FIT file"
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => {
                      composerRef.current?.setDraft(suggestion);
                      composerRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {timeline.map((entry, index) => {
            if (!chatSettings.visualizationsEnabled && isChatVisualEntry(entry)) {
              return null;
            }

            if (entry.kind === "toolNotice") {
              return (
                <div
                  key={`tool-notice-${index}`}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-tool-notice">
                    {entry.message}
                  </div>
                </div>
              );
            }

            if (entry.kind === "coachPrompt") {
              if (entry.prompt.answeredAt !== undefined) {
                return null;
              }
              return (
                <div
                  key={entry.prompt.promptId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <MessageCircle size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-coach-prompt">
                    <CoachInputCard
                      prompt={entry.prompt}
                      disabled={streaming || exportingLatestActivity}
                      onChoose={(choice) =>
                        void handleCoachPromptChoice(entry.prompt, choice)
                      }
                      onCustom={handleCustomCoachAnswer}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "planDraft") {
              if (showPlanPanel) {
                return null;
              }
              return (
                <div
                  key={entry.draft.draftId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachDraftPreviewCard
                      draft={entry.draft}
                      uploading={uploadingDraftId === entry.draft.draftId}
                      uploaded={uploadedPlans[entry.draft.draftId]}
                      onUpload={(destination, scheduleDate) =>
                        void handleUploadPlanDraft(
                          entry.draft.draftId,
                          destination,
                          scheduleDate
                        )
                      }
                      onReview={onReviewPlan ? () => handleReviewPlanDraft(entry.draft) : undefined}
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "workoutDelete") {
              return (
                <div
                  key={entry.preview.requestId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <DeletePreviewCard
                      preview={entry.preview}
                      deleting={deletingRequestId === entry.preview.requestId}
                      deleted={deletedWorkouts[entry.preview.requestId]}
                      onConfirm={() =>
                        void handleConfirmWorkoutDelete(entry.preview.requestId)
                      }
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "activityVisual") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <ActivityVisualCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "fitnessTrend") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <FitnessTrendCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "hrZoneSummary") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <HrZoneCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`message-${index}`}
                className={`chat-row chat-row-${entry.role}${
                  highlightedChatEntryIndex === index
                    ? " is-chat-jump-target"
                    : ""
                }`}
                data-chat-entry-index={index}
              >
                <div className={`chat-avatar chat-avatar-${entry.role}`}>
                  {entry.role === "assistant" ? (
                    <Sparkles size={16} aria-hidden="true" />
                  ) : (
                    <User size={16} aria-hidden="true" />
                  )}
                </div>
                <div className="chat-bubble">
                  {entry.role === "assistant" ? (
                    <>
                      {entry.reasoningSummary ? (
                        <ThinkingDisclosure content={entry.reasoningSummary} />
                      ) : null}
                      <AssistantMarkdown content={entry.content} />
                      {entry.source ? (
                        <SourceBadge source={entry.source} />
                      ) : null}
                    </>
                  ) : (
                    entry.content
                  )}
                </div>
              </div>
            );
          })}

          {streaming ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble chat-bubble-streaming">
                {streamingText ? (
                  <>
                    {thinkingText ? (
                      <ThinkingDisclosure content={thinkingText} live />
                    ) : null}
                    <AssistantMarkdown content={streamingText} streaming />
                  </>
                ) : (
                  <div className="chat-stream-pending">
                    {activeTool || !thinkingText ? (
                      <span className="chat-stream-status">
                        {activeTool
                          ? `Using ${activeTool.replace(/_/g, " ")}…`
                          : resumedCoachPromptRef.current
                            ? "Resuming plan…"
                            : "Working on it…"}
                      </span>
                    ) : null}
                    {thinkingText ? (
                      <ThinkingDisclosure content={thinkingText} live />
                    ) : null}
                  </div>
                )}
                {currentSource ? <SourceBadge source={currentSource} /> : null}
              </div>
            </div>
          ) : null}

          {exportingLatestActivity ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <FileDown size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble">Preparing latest activity FIT export…</div>
            </div>
          ) : null}
        </div>
      </div>

          <ChatComposer
            ref={composerRef}
            providerControls={providerControls}
            initialDraft={composerDraftRef.current}
            apiAvailable={Boolean(api)}
            streaming={streaming}
            exportingLatestActivity={exportingLatestActivity}
            waitingForCoachAnswer={waitingForCoachAnswer}
            isLocalProvider={isLocalProvider}
            localModelConfigured={localModelConfigured}
            onDraftChange={handleComposerDraftChange}
            onNewChat={() => void handleNewChat()}
            onSend={sendMessage}
            onStop={handleStop}
          />
        </div>
        {showPlanPanel && selectedPlanDraft ? (
          <aside
            className={`chat-plan-panel${
              planPanelExpanded ? " is-expanded" : " is-list-view"
            }`}
            aria-label={
              planPanelExpanded ? "Generated item details" : "Coach creations"
            }
          >
            {!planPanelExpanded ? (
              <>
                <header className="chat-plan-list-header">
                  <div>
                    <span className="chat-plan-panel-icon">
                      <BookOpen size={15} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>Coach creations</strong>
                      <span>Plans and one-off workouts</span>
                    </div>
                  </div>
                  <strong className="chat-plan-list-count">
                    {planDrafts.length}
                  </strong>
                </header>
                <ol className="chat-plan-list">
                  {planDrafts.map((draft, index) => {
                    const saved = Boolean(
                      uploadedPlans[draft.draftId] ||
                        draft.uploadResult ||
                        draft.uploadedAt
                    );
                    const isWorkout = draft.artifactType === "workout";
                    const planNumber = isWorkout
                      ? 0
                      : planDrafts
                          .slice(0, index + 1)
                          .filter((item) => item.artifactType !== "workout").length;
                    const weeks = isWorkout
                      ? 0
                      : Math.max(
                          1,
                          groupPlanEntriesByWeek(draft.entries).filter(
                            (week) => week.id !== "unscheduled"
                          ).length
                        );
                    const primarySport = draft.entries[0]?.sport;
                    const SportIcon = sportTheme(primarySport).icon;
                    const selected = draft.draftId === selectedPlanDraft.draftId;

                    return (
                      <li key={draft.draftId}>
                        <button
                          type="button"
                          className={`chat-plan-list-item${
                            selected ? " is-selected" : ""
                          }`}
                          onClick={() => {
                            setSelectedPlanDraftId(draft.draftId);
                            setPlanPanelExpanded(true);
                          }}
                          aria-label={`Open ${draft.name || `${isWorkout ? "workout" : "plan"} ${index + 1}`}`}
                        >
                          <span
                            className="chat-plan-list-sport"
                            style={planSportStyle(primarySport)}
                          >
                            <SportIcon
                              size={15}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </span>
                          <span className="chat-plan-list-copy">
                            <span className="chat-plan-list-kicker">
                              {isWorkout ? "One-off workout" : `Plan ${planNumber}`}
                            </span>
                            <strong>
                              {draft.name || (isWorkout ? "Untitled workout" : "Untitled plan")}
                            </strong>
                            <span className="chat-plan-list-meta">
                              <span>
                                {draft.entries.length}{" "}
                                {draft.entries.length === 1
                                  ? "workout"
                                  : "workouts"}
                              </span>
                              {!isWorkout ? (
                                <span>
                                  {weeks} {weeks === 1 ? "week" : "weeks"}
                                </span>
                              ) : (
                                <span>Workout Library</span>
                              )}
                              <span data-status={saved ? "saved" : "draft"}>
                                {saved ? "Saved" : "Draft"}
                              </span>
                            </span>
                          </span>
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <>
                <header className="chat-plan-panel-header">
                  <div className="chat-plan-panel-heading">
                    <button
                      type="button"
                      className="chat-plan-panel-back"
                      onClick={() => setPlanPanelExpanded(false)}
                      aria-label="Back to Coach creations"
                      title="Back to Coach creations"
                    >
                      <ChevronLeft size={15} aria-hidden="true" />
                      Creations
                    </button>
                    <div className="chat-plan-panel-title is-detail-title">
                      <div>
                        <strong title={selectedPlanDraft.name}>
                          {selectedPlanDraft.name ||
                            (selectedPlanDraft.artifactType === "workout"
                              ? "Untitled workout"
                              : "Untitled plan")}
                        </strong>
                        <span>
                          {selectedPlanDraft.artifactType === "workout"
                            ? "One-off workout"
                            : `Plan ${selectedTrainingPlanNumber} of ${trainingPlanDrafts.length}`}
                        </span>
                      </div>
                    </div>
                    <div className="chat-plan-panel-actions">
                      <button
                        type="button"
                        className="chat-plan-panel-chat-link"
                        onClick={() =>
                          handleScrollToPlanChat(selectedPlanDraft.draftId)
                        }
                        title="View the generated response in chat"
                      >
                        <MessageCircle size={14} aria-hidden="true" />
                        View in chat
                      </button>
                    </div>
                  </div>
                </header>
                <div className="chat-plan-panel-body">
                  <CoachDraftPreviewCard
                    key={selectedPlanDraft.draftId}
                    draft={selectedPlanDraft}
                    uploading={uploadingDraftId === selectedPlanDraft.draftId}
                    uploaded={uploadedPlans[selectedPlanDraft.draftId]}
                    onUpload={(destination, scheduleDate) =>
                      void handleUploadPlanDraft(
                        selectedPlanDraft.draftId,
                        destination,
                        scheduleDate
                      )
                    }
                    onReview={
                      onReviewPlan
                        ? () => handleReviewPlanDraft(selectedPlanDraft)
                        : undefined
                    }
                  />
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
      <ChatSettingsModal {...settingsModalProps} />
    </div>
  );
}
