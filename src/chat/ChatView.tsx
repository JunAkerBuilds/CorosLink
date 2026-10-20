import { t, useLanguage, getLocale } from "../i18n/tools";
import { WorkoutEditCard } from "./WorkoutEditCard";
import { CorosActionCard } from "./CorosActionCard";
import { normalizeCoachChartTitle } from "./coachChartFreshness";
import { ensureDashboardWidget } from "../training/dashboardLayout";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  Activity,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  ChartLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Database,
  ExternalLink,
  FileText,
  HeartPulse,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  MessageCircle,
  Network,
  Paperclip,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  X
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import { morph } from "./coachMorph";
import {
  COACH_FILE_ACCEPT,
  CoachFileError,
  MAX_COACH_FILES,
  isImageFile,
  prepareCoachFile
} from "./coachFiles";
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
  ChatFileAttachment,
  ChatMessageAttachment,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  ClaudeCodeStatus,
  CoachChartPreview,
  CoachFileUpload,
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
  WorkoutDeletePreview
} from "../../electron/types";
import {
  applyCoachEvent,
  coachStateFromSnapshot,
  type CoachClientState,
  type CoachEventFrame
} from "../../electron/coachHub/coachContract";
import { formatWorkoutSport } from "../../electron/workoutCapabilities";
import { trainingPlanFromCoachDraftPreview } from "../../electron/trainingPlanDomain";
import { sportTheme } from "../training-library/sportTheme";
import { ActivityVisualCard } from "./ActivityVisualCard";
import { CoachChartCard } from "./CoachChartCard";
import { FitnessTrendCard } from "./FitnessTrendCard";
import { HrZoneCard } from "./HrZoneCard";
import { ChatSettingsModal } from "./ChatSettingsModal";
import { ChatSidebar } from "./ChatSidebar";
import { ModelSwitch } from "./ModelSwitch";
import { ProviderSwitch } from "./ProviderSwitch";
import {
  isChatVisualEntry,
  listCoachCreations,
  planEntryScheduleDate,
  type ChatEntry,
  type CoachCreation,
  type CoachCreationStatus,
  type CoachPrefill,
  type SourceInfo
} from "./chatTypes";

const NO_ENTRIES: ChatEntry[] = [];

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
  useLanguage();
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
  useLanguage();
  return (
    <details className={`chat-thinking${live ? " chat-thinking-live" : ""}`}>
      <summary>
        <span>{t("Thinking")}</span>
        {live ? <small><i aria-hidden="true" />{t("Live")}</small> : null}
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
  useLanguage();
  const answered = prompt.answeredAt !== undefined;
  return (
    <section
      className={`chat-coach-prompt${answered ? " is-answered" : ""}`}
      aria-labelledby={`coach-prompt-${prompt.promptId}`}
    >
      <header className="chat-coach-prompt-header">
        <span className="chat-coach-prompt-status">
          <MessageCircle size={14} aria-hidden="true" />
          {answered ? t("Answered") : t("Waiting for your answer")}
        </span>
        <h4 id={`coach-prompt-${prompt.promptId}`}>{prompt.question}</h4>
      </header>
      <div className="chat-coach-prompt-choices" role="group" aria-label={t("Answer choices")}>
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
                {!answered && index === 0 ? <em>{t("Recommended")}</em> : null}
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
          {t("Type another answer")}</button>
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
  pendingPrompt?: CoachPrefill | null;
  onPendingPromptConsumed?: () => void;
  accountSetupRequest?: number;
  /** False while Coach stays mounted behind another view. */
  visible?: boolean;
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
  if (seconds < 90) return t("{{p0}} sec", { p0: Math.round(seconds) });
  const minutes = seconds / 60;
  return Number.isInteger(minutes)
    ? t("{{p0}} min", { p0: minutes })
    : t("{{p0}} min", { p0: minutes.toFixed(1) });
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
    return t("{{p0}} gain", { p0: formatElevationValue(step.target_elevation_gain_meters, unitSystem) });
  }
  if (step.target_duration_seconds) {
    return formatPlanDuration(step.target_duration_seconds);
  }
  if (step.target_reps) return t("{{p0}} reps", { p0: step.target_reps });
  if (step.target_routes) {
    return `${step.target_routes} ${step.target_routes === 1 ? t("route") : t("routes")}`;
  }
  if (step.target_hr_recovery_bpm) {
    return t("to {{p0}} bpm", { p0: step.target_hr_recovery_bpm });
  }
  if (step.send_off_seconds) return t("{{p0}} send-off", { p0: formatPlanDuration(step.send_off_seconds) });
  if (step.target_load) return t("{{p0}} TL", { p0: step.target_load });
  return t("Open", undefined, "workoutTarget");
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
  if (step.kind === "warmup") return t("Warm-up");
  if (step.kind === "cooldown") return t("Cooldown");
  if (step.kind === "rest") return t("Recovery");
  return t("Strength exercise");
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
  useLanguage();
  const steps = source.steps ?? [];
  const exerciseCount = countStrengthExercises(steps);
  let exerciseNumber = 0;

  const renderStep = (step: PlanSourceStep, key: string) => {
    const exercise = isStrengthExerciseStep(step);
    const currentExerciseNumber = exercise ? ++exerciseNumber : undefined;
    const intensity = step.intensity
      ? formatPlanIntensity(step.intensity, unitSystem)
      : undefined;
    const setCount = step.sets && step.sets > 1 ? t("{{p0}} sets", { p0: step.sets }) : undefined;
    const setRest = step.sets && step.sets > 1 && step.rest_value !== undefined
      ? t("{{p0}} rest", { p0: formatPlanDuration(step.rest_value) })
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
      aria-label={t("{{p0}} {{p1}} in strength session structure", { p0: exerciseCount, p1: exerciseCount === 1 ? "exercise" : "exercises" })}
    >
      <header className="chat-plan-strength-header">
        <strong>{t("Session structure")}</strong>
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
                <strong>{step.name?.trim() || t("Repeat block")}</strong>
                <span>{step.repeat}  {t("rounds")}</span>
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
    if (intensity.mode === "bodyweight") return t("Bodyweight");
    const kilograms = intensity.unit === "lb"
      ? intensity.value / POUNDS_PER_KILOGRAM
      : intensity.value;
    return `${kilogramsToDisplayWeight(kilograms, unitSystem).toFixed(1)} ${weightUnit(unitSystem)}`;
  }
  if (intensity.type === "heartRate") {
    return t("{{p0}}–{{p1}} bpm", { p0: intensity.lowBpm, p1: intensity.highBpm });
  }
  if (intensity.type === "power" && !intensity.preset) {
    return `${intensity.lowWatts}–${intensity.highWatts} W`;
  }
  if (intensity.type === "cadence") {
    return `${intensity.low}–${intensity.high} ${intensity.unit}`;
  }
  if (intensity.type === "swimStroke") return intensity.stroke;
  if (intensity.type === "rpe") return t("RPE {{p0}}", { p0: intensity.value });
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
    weekday: new Intl.DateTimeFormat(getLocale(), { weekday: "short" }).format(date),
    day: String(date.getDate()),
    month: new Intl.DateTimeFormat(getLocale(), { month: "short" }).format(date)
  };
}

/** One-line localized label, e.g. "Tue, Aug 4". Falls back to the raw value. */
function formatPlanDateLabel(scheduleDate: string): string {
  const date = planDateFromSchedule(scheduleDate);
  if (!date) return scheduleDate;
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
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
  const month = new Intl.DateTimeFormat(getLocale(), { month: "short" });
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
      label: t("Week {{p0}}", { p0: index + 1 }),
      dateRange: formatPlanWeekRange(group.start),
      entries: group.entries
    }));
  if (unscheduled.length > 0) {
    weeks.push({
      id: "unscheduled",
      label: t("Unscheduled"),
      dateRange: t("No calendar date"),
      entries: unscheduled
    });
  }
  return weeks;
}

/** Inline style hook that tints a row/chip with the sport's own colour. */
function planSportStyle(sport: PlanDraftPreviewEntry["sport"]): CSSProperties {
  return { "--chat-plan-sport": sportTheme(sport).color } as CSSProperties;
}

function creationStatusLabel(status: CoachCreationStatus): string {
  switch (status) {
    case "saved":
      return t("Saved");
    case "pending":
      return t("Pending");
    case "saving":
      return t("Saving…");
    case "uncertain":
      return t("Unconfirmed");
    default:
      return t("Draft");
  }
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
  useLanguage();
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
        : undefined) ?? entry.volume ?? t("Not set")
    : t("Not set");
  const steps = entry
    ? (entry.source
        ? formatPlanSourceSteps(entry.source, unitSystem)
        : undefined) ?? entry.stepsSummary ?? t("No structure provided")
    : t("No structure provided");

  return (
    <div className="chat-plan-card chat-workout-card">
      <div className="chat-plan-card-header">
        <div className="chat-plan-card-title">
          <span className="chat-workout-card-kicker">{t("One-off workout")}</span>
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
                  ? t("Add to Calendar on {{p0}}", { p0: scheduleDate })
                  : t("Save to Workout Library")
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
          <span>{t("This workout does not contain any steps yet.")}</span>
        </div>
      )}
      {isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {uploadedDestination === "calendar"
              ? t("Added to your COROS Calendar on {{p0}}.", { p0: formatPlanDateLabel(scheduleDate) })
              : t("Saved to your COROS Workout Library.")}
          </span>
        </p>
      ) : (
        <>
          <fieldset className="chat-plan-confirmation" disabled={uploading}>
            <legend>{t("Where should this workout go?")}</legend>
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
                  <strong>{t("Workout Library")}</strong>
                  <small>{t("Save it as an unscheduled, reusable workout.")}</small>
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
                  <strong>{t("Calendar")}</strong>
                  <small>{t("Add this workout on the date you choose.")}</small>
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
                <span>{t("Calendar date")}</span>
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
                  ? t("This workout will be added to Calendar on {{p0}}.", { p0: formatPlanDateLabel(scheduleDate) })
                  : t("This workout will be saved to your Workout Library without a calendar date.")}
                {" "}{t("It will remain a one-off workout, not a training plan.")}</span>
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
              {destination === "calendar" ? t("Add to Calendar") : t("Save to Library")}
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
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [destination, setDestination] = useState<
    Extract<
      TrainingPlanDestination,
      "localPlan" | "workoutLibrary" | "calendar" | "nativePlan" | "nativePlanAndCalendar"
    >
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
    workoutLibrary: t("COROS Workout Library"),
    calendar: t("COROS Calendar"),
    localPlan: t("CorosLink Training Library"),
    nativePlan: t("COROS Plan"),
    localTemplate: t("Local CorosLink template"),
    nativePlanAndCalendar: t("COROS Plan on Calendar")
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
                  title={sport ? formatWorkoutSport(sport) : t("Workout")}
                >
                  <SportIcon size={10} strokeWidth={2.2} aria-hidden="true" />
                </span>
              );
            })}
          </span>
        ) : null}
      </div>
      <div className="chat-plan-overview" aria-label={t("Plan overview")}>
        <div className="chat-plan-overview-item">
          <span>{t("Weeks")}</span>
          <strong>{scheduledWeekCount}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>{t("Workouts")}</span>
          <strong>{draft.entries.length}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>{t("Sports")}</span>
          <strong title={sports.join(", ")}>{sports.join(", ")}</strong>
        </div>
        <div className="chat-plan-overview-item">
          <span>{t("Starts")}</span>
          <strong>{startDate ? formatPlanDateLabel(startDate) : t("Not set")}</strong>
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
                {selectedWeek.entries.length === 1 ? t("workout") : t("workouts")}
              </small>
            </div>
            {planWeeks.length > 1 ? (
              <div className="chat-plan-week-stepper" aria-label={t("Change week")}>
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(-1)}
                  disabled={selectedWeekIndex <= 0}
                  aria-label={t("Previous week")}
                  title={t("Previous week")}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span>{selectedWeekIndex + 1}  {t("of")} {planWeeks.length}</span>
                <button
                  type="button"
                  onClick={() => selectAdjacentWeek(1)}
                  disabled={selectedWeekIndex >= planWeeks.length - 1}
                  aria-label={t("Next week")}
                  title={t("Next week")}
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
              aria-label={t("Plan weeks")}
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
                  : undefined) ?? entry.volume ?? t("Not set");
              const steps =
                (entry.source
                  ? formatPlanSourceSteps(entry.source, unitSystem)
                  : undefined) ?? entry.stepsSummary ?? t("No structure provided");
              return (
                <li
                  key={entry.key}
                  className={`chat-plan-entry${hasStrengthStructure ? " is-strength" : ""}`}
                  style={planSportStyle(entry.sport)}
                >
                  <span
                    className={`chat-plan-entry-date${dateParts ? "" : " is-undated"}`}
                    title={scheduleDate ?? t("Saved to library only")}
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
          <span>{t("This plan does not contain any workouts yet.")}</span>
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
            <small>{t("Review before saving")}</small>
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
            <small>{t("Additional plan details")}</small>
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
          <legend>{t("How should this plan be saved?")}</legend>
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
                <strong>{t("Training Plan")}</strong>
                <small>{t("Keep these workouts together as one editable plan in CorosLink.")}</small>
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
                <strong>{t("Individual Workouts")}</strong>
                <small>{t("Save each workout separately to the COROS Workout Library.")}</small>
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
                <strong>{t("Calendar")}</strong>
                <small>
                  {unscheduledWorkoutCount > 0
                    ? t("{{p0}} {{p1}} a date.", { p0: unscheduledWorkoutCount, p1: t(unscheduledWorkoutCount === 1 ? "workout needs" : "workouts need") })
                    : t("Schedule workouts on the dates shown above.")}
                </small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "nativePlan" ? " is-selected" : ""
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="nativePlan"
                checked={destination === "nativePlan"}
                onChange={() => setDestination("nativePlan")}
              />
              <span className="chat-plan-destination-icon">
                <Layers size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>{t("COROS Plan")}</strong>
                <small>{t("Bundle these workouts into one grouped Plan in your COROS Plan Library.")}</small>
              </span>
              <CircleCheck
                className="chat-plan-destination-check"
                size={16}
                aria-hidden="true"
              />
            </label>
            <label
              className={`chat-plan-destination-option${
                destination === "nativePlanAndCalendar" ? " is-selected" : ""
              }${unscheduledWorkoutCount > 0 ? " is-disabled" : ""}`}
            >
              <input
                className="sr-only"
                type="radio"
                name={`plan-destination-${draft.draftId}`}
                value="nativePlanAndCalendar"
                checked={destination === "nativePlanAndCalendar"}
                onChange={() => setDestination("nativePlanAndCalendar")}
                disabled={unscheduledWorkoutCount > 0}
              />
              <span className="chat-plan-destination-icon">
                <Upload size={16} aria-hidden="true" />
              </span>
              <span className="chat-plan-destination-copy">
                <strong>{t("COROS Plan on Calendar")}</strong>
                <small>
                  {unscheduledWorkoutCount > 0
                    ? t("{{p0}} {{p1}} a date.", { p0: unscheduledWorkoutCount, p1: t(unscheduledWorkoutCount === 1 ? "workout needs" : "workouts need") })
                    : t("Bundle into one COROS Plan and put it on your Calendar.")}
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
                ? t("This will be saved as one grouped plan with {{p0}} {{p1}} in your CorosLink Training Library.", { p0: draft.entries.length, p1: draft.entries.length === 1 ? t("workout") : t("workouts") })
                : destination === "calendar"
                  ? t("{{p0}} {{p1}} will be added to your COROS Calendar.{{p2}}", { p0: scheduledWorkoutCount, p1: scheduledWorkoutCount === 1 ? t("workout") : t("workouts"), p2: draft.conflicts.length > 0
                        ? t(" Review {{p0}} {{p1}} before adding.", { p0: draft.conflicts.length, p1: draft.conflicts.length === 1 ? "conflict" : "conflicts" })
                        : t(" No scheduling conflicts.") })
                  : destination === "nativePlan"
                    ? t("This will be bundled into one Plan with {{p0}} {{p1}} in your COROS Plan Library, unscheduled.", { p0: draft.entries.length, p1: draft.entries.length === 1 ? t("workout") : t("workouts") })
                    : destination === "nativePlanAndCalendar"
                      ? t("This will be bundled into one Plan with {{p0}} {{p1}} and put on your COROS Calendar starting {{p2}}.", { p0: draft.entries.length, p1: draft.entries.length === 1 ? t("workout") : t("workouts"), p2: startDate ? formatPlanDateLabel(startDate) : t("the first workout's date") })
                      : t("{{p0}} {{p1}} will be saved individually to your COROS Workout Library. Dates will not be added to Calendar.", { p0: draft.entries.length, p1: draft.entries.length === 1 ? t("workout") : t("workouts") })}
            </span>
          </p>
        </fieldset>
      ) : null}
      {uploadedResult || isUploaded ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            {(uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination) === "localPlan"
              ? t("Saved as a grouped plan in {{p0}}.", { p0: destinationLabel.localPlan })
              : (uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination) === "nativePlan" ||
                  (uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination) === "nativePlanAndCalendar"
                ? t("Saved as one grouped {{p0}}.", { p0: destinationLabel[uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination] })
                : t("Saved to {{p0}}. {{p1}} scheduled, {{p2}} saved to library.", { p0: destinationLabel[uploadedResult?.destination ?? draft.uploadResult?.destination ?? destination], p1: uploadedResult?.workoutsScheduled ?? draft.uploadResult?.workoutsScheduled ?? 0, p2: uploadedResult?.workoutsCreated ?? draft.uploadResult?.workoutsCreated ?? 0 })}
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
              title={t("Open this plan in the Training Library editor")}
            >
              <BookOpen size={14} aria-hidden="true" />
              {t("Edit plan first")}</button>
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
            ) : destination === "nativePlan" ? (
              <Layers size={14} aria-hidden="true" />
            ) : destination === "nativePlanAndCalendar" ? (
              <Upload size={14} aria-hidden="true" />
            ) : (
              <Bookmark size={14} aria-hidden="true" />
            )}
            {destination === "localPlan"
              ? t("Save Plan")
              : destination === "calendar"
                ? t("Add to Calendar")
                : destination === "nativePlan"
                  ? t("Save Plan")
                  : destination === "nativePlanAndCalendar"
                    ? t("Save Plan & Schedule")
                    : t("Save Workouts")}
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
  useLanguage();
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
  if (target === "scheduled") return t("Calendar");
  if (target === "library") return t("Library");
  return t("Calendar and library");
}

function DeletePreviewCard({
  preview,
  deleting,
  onConfirm
}: {
  preview: WorkoutDeletePreview;
  deleting: boolean;
  onConfirm: () => void;
}) {
  useLanguage();
  return (
    <div className="chat-plan-card chat-delete-card">
      <div className="chat-plan-card-header">
        <h4>{t("Delete workout")}</h4>
        <span className="chat-plan-card-summary">{preview.summary}</span>
      </div>
      <dl className="chat-delete-details">
        <div>
          <dt>{t("Target")}</dt>
          <dd>{deleteTargetLabel(preview.target)}</dd>
        </div>
        {preview.workoutName ? (
          <div>
            <dt>{t("Workout")}</dt>
            <dd>{preview.workoutName}</dd>
          </div>
        ) : null}
        {preview.scheduleDate ? (
          <div>
            <dt>{t("Date")}</dt>
            <dd>{preview.scheduleDate}</dd>
          </div>
        ) : null}
      </dl>
      {preview.state === "deleted" ? (
        <p className="chat-plan-success">{preview.message}</p>
      ) : (
        <>
        {preview.state === "failed" && preview.message ? (
          <p role="alert">{preview.message}</p>
        ) : null}
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
            {t("Delete from COROS")}</button>
        </div>
        </>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SourceInfo }) {
  useLanguage();
  if (source.mcpUsed) {
    const tools = source.mcpTools.filter(Boolean);
    return (
      <div className={`chat-source ${source.mcpError ? "chat-source-error" : "chat-source-mcp"}`}>
        <Database size={12} aria-hidden="true" />
        MCP
        {tools.length > 0 ? ` · ${[...new Set(tools)].join(", ")}` : ""}
        {source.mcpError ? t(" · failed") : ""}
      </div>
    );
  }
  if (source.snapshotIncluded) {
    return (
      <div className="chat-source chat-source-snapshot">
        <FileText size={12} aria-hidden="true" />
        {t("Training snapshot")}{source.mcpEnabled ? t(" · MCP not called") : ""}
      </div>
    );
  }
  return (
    <div className="chat-source chat-source-none">
      <FileText size={12} aria-hidden="true" />
      {t("No COROS data")}</div>
  );
}

/** Context sent with a user message, shown as a chip instead of its text. */
function MessageAttachmentChip({
  attachment,
  onRemove
}: {
  attachment: ChatMessageAttachment;
  onRemove?: () => void;
}) {
  useLanguage();
  return (
    <span className="chat-attachment">
      <ChartLine size={13} aria-hidden="true" />
      <span className="chat-attachment-kind">{t("Pinned chart")}</span>
      <span className="chat-attachment-label">{attachment.label}</span>
      {onRemove ? (
        <button
          type="button"
          className="chat-attachment-remove"
          onClick={onRemove}
          aria-label={t("Remove {{label}} from this message", { label: attachment.label })}
          title={t("Remove {{label}} from this message", { label: attachment.label })}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
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
    return t("No file saved. The latest activity {{p0}} export was cancelled.", { p0: formatLabel });
  }
  return t("Saved the latest activity {{p0}} file{{p1}} to:\n\n`{{p2}}`", { p0: formatLabel, p1: activityName, p2: result.filePath });
}

interface ChatComposerHandle {
  focus: () => void;
  /** Replaces the whole draft, including any attachment. */
  setDraft: (value: string, attachment?: ChatMessageAttachment) => void;
  /** Reads files dropped on the conversation into the draft. */
  addFiles: (files: File[]) => void;
}

/** A file in the composer: read in the window, uploaded with the message. */
interface ComposerFile {
  key: string;
  name: string;
  image: boolean;
  status: "reading" | "ready";
  upload?: CoachFileUpload;
  /** Object URL of the picked image, for its thumbnail. */
  previewUrl?: string;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  txt: "Text",
  md: "Markdown",
  markdown: "Markdown",
  csv: "CSV",
  tsv: "TSV",
  json: "JSON"
};

/** "PDF · 6 pages", plus how the model gets it when that is not plain text. */
function describeFile(
  name: string,
  details: { pageCount?: number; scanned?: boolean; truncated?: boolean }
): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const parts = [FILE_TYPE_LABELS[extension] ?? extension.toUpperCase()];
  if (details.pageCount) {
    parts.push(
      details.pageCount === 1
        ? t("1 page")
        : t("{{count}} pages", { count: details.pageCount })
    );
  }
  if (details.scanned) parts.push(t("read as images"));
  if (details.truncated) parts.push(t("trimmed to fit"));
  return parts.filter(Boolean).join(" · ");
}

function ComposerFileChip({
  file,
  onRemove
}: {
  file: ComposerFile;
  onRemove: () => void;
}) {
  useLanguage();
  const reading = file.status === "reading";
  const removeLabel = t("Remove {{label}} from this message", { label: file.name });
  if (file.image) {
    return (
      <span
        className={`chat-file-thumb chat-file-thumb-draft${reading ? " is-reading" : ""}`}
        title={file.name}
      >
        {file.previewUrl ? <img src={file.previewUrl} alt={file.name} /> : <ImageIcon size={18} aria-hidden="true" />}
        {reading ? (
          <span className="chat-file-thumb-status" aria-label={t("Reading {{name}}…", { name: file.name })}>
            <Loader2 size={16} className="chat-file-spinner" aria-hidden="true" />
          </span>
        ) : null}
        <button
          type="button"
          className="chat-file-remove"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <X size={11} aria-hidden="true" />
        </button>
      </span>
    );
  }
  const upload = file.upload;
  return (
    <span className={`chat-file-card chat-file-card-draft${reading ? " is-reading" : ""}`} title={file.name}>
      <span className="chat-file-card-icon" aria-hidden="true">
        {reading ? <Loader2 size={16} className="chat-file-spinner" /> : <FileText size={16} />}
      </span>
      <span className="chat-file-card-text">
        <span className="chat-file-card-name">{file.name}</span>
        <span className="chat-file-card-meta">
          {reading || !upload
            ? t("Reading…")
            : describeFile(upload.name, {
                pageCount: upload.pageCount,
                scanned: Boolean(upload.images?.length),
                truncated: upload.truncated
              })}
        </span>
      </span>
      <button
        type="button"
        className="chat-file-remove"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <X size={11} aria-hidden="true" />
      </button>
    </span>
  );
}

const attachmentPreviews = new Map<string, Promise<string | null>>();

function useAttachmentPreview(
  api: CorosLinkApi | undefined,
  sessionId: string | null,
  attachmentId: string
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!api || !sessionId) return;
    const key = `${sessionId}:${attachmentId}`;
    let request = attachmentPreviews.get(key);
    if (!request) {
      request = api.coachAttachmentPreview(sessionId, attachmentId).catch(() => null);
      attachmentPreviews.set(key, request);
    }
    let live = true;
    void request.then((value) => {
      if (live) setUrl(value);
    });
    return () => {
      live = false;
    };
  }, [api, sessionId, attachmentId]);
  return url;
}

/** Files sent with a user message; opening one hands the kept original to the system. */
function MessageFiles({
  files,
  api,
  sessionId,
  onError
}: {
  files: ChatFileAttachment[];
  api: CorosLinkApi | undefined;
  sessionId: string | null;
  onError: (message: string | null) => void;
}) {
  useLanguage();
  const open = (file: ChatFileAttachment) => {
    if (!api || !sessionId) return;
    void api.coachOpenAttachment(sessionId, file.id).catch((caught) =>
      onError(caught instanceof Error ? caught.message : t("This file could not be opened."))
    );
  };
  return (
    <div className="chat-message-files">
      {files.map((file) =>
        file.kind === "image" ? (
          <MessageImage key={file.id} file={file} api={api} sessionId={sessionId} onOpen={() => open(file)} />
        ) : (
          <button
            key={file.id}
            type="button"
            className="chat-file-card"
            onClick={() => open(file)}
            title={t("Open {{name}}", { name: file.name })}
          >
            <span className="chat-file-card-icon" aria-hidden="true">
              <FileText size={16} />
            </span>
            <span className="chat-file-card-text">
              <span className="chat-file-card-name">{file.name}</span>
              <span className="chat-file-card-meta">
                {describeFile(file.name, {
                  pageCount: file.pageCount,
                  scanned: Boolean(file.pageImages) && !file.textChars,
                  truncated: file.truncated
                })}
              </span>
            </span>
          </button>
        )
      )}
    </div>
  );
}

function MessageImage({
  file,
  api,
  sessionId,
  onOpen
}: {
  file: ChatFileAttachment;
  api: CorosLinkApi | undefined;
  sessionId: string | null;
  onOpen: () => void;
}) {
  useLanguage();
  const url = useAttachmentPreview(api, sessionId, file.id);
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : undefined;
  return (
    <button
      type="button"
      className="chat-file-thumb"
      onClick={onOpen}
      title={t("Open {{name}}", { name: file.name })}
      style={ratio ? ({ "--chat-file-ratio": ratio } as CSSProperties) : undefined}
    >
      {url ? <img src={url} alt={file.name} /> : <ImageIcon size={18} aria-hidden="true" />}
    </button>
  );
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
  onSend: (
    message: string,
    attachment?: ChatMessageAttachment,
    uploads?: CoachFileUpload[]
  ) => Promise<boolean>;
  onStop: () => void;
  onFileError: (message: string) => void;
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
      onStop,
      onFileError
    },
    ref
  ) {
  useLanguage();
    const [draft, setDraft] = useState(initialDraft);
    const draftRef = useRef(initialDraft);
    const [attachment, setAttachment] = useState<ChatMessageAttachment | null>(null);
    const [files, setFiles] = useState<ComposerFile[]>([]);
    const filesRef = useRef<ComposerFile[]>([]);
    filesRef.current = files;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const submittingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const trimmedDraft = draft.trim();
    const readingFiles = files.some((file) => file.status === "reading");
    const uploads = files.flatMap((file) =>
      file.status === "ready" && file.upload ? [file.upload] : []
    );
    const hasMessage = Boolean(trimmedDraft) || uploads.length > 0;
    const latestActivityFileRequest =
      files.length === 0 && isLatestActivityFileRequest(trimmedDraft);
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

    const addFiles = useCallback(
      (incoming: File[]) => {
        if (incoming.length === 0) return;
        const room = MAX_COACH_FILES - filesRef.current.length;
        if (incoming.length > room) {
          onFileError(t("Attach up to {{count}} files per message.", { count: MAX_COACH_FILES }));
        }
        const accepted = incoming.slice(0, Math.max(0, room));
        if (accepted.length === 0) return;
        const added = accepted.map((file): ComposerFile => {
          const image = isImageFile(file);
          return {
            key: crypto.randomUUID(),
            name: file.name,
            image,
            status: "reading",
            ...(image ? { previewUrl: URL.createObjectURL(file) } : {})
          };
        });
        filesRef.current = [...filesRef.current, ...added];
        setFiles(filesRef.current);
        added.forEach((entry, index) => {
          prepareCoachFile(accepted[index]).then(
            (upload) =>
              setFiles((current) =>
                current.map((item) =>
                  item.key === entry.key
                    ? { ...item, name: upload.name, status: "ready", upload }
                    : item
                )
              ),
            (error) => {
              setFiles((current) => current.filter((item) => item.key !== entry.key));
              if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
              onFileError(
                error instanceof CoachFileError
                  ? error.message
                  : t("{{name}} could not be attached.", { name: entry.name })
              );
            }
          );
        });
        textareaRef.current?.focus();
      },
      [onFileError]
    );

    const removeFile = (key: string) => {
      const file = filesRef.current.find((item) => item.key === key);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      setFiles((current) => current.filter((item) => item.key !== key));
      textareaRef.current?.focus();
    };

    useEffect(
      () => () => {
        for (const file of filesRef.current) {
          if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        }
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setDraft: (value, nextAttachment) => {
          updateDraft(value);
          setAttachment(nextAttachment ?? null);
        },
        addFiles
      }),
      [updateDraft, addFiles]
    );

    const submitDraft = async () => {
      if (
        !apiAvailable ||
        !hasMessage ||
        readingFiles ||
        exportingLatestActivity ||
        localProviderBlocked ||
        submittingRef.current
      ) {
        return;
      }

      const submittedDraft = draft;
      const submittedAttachment = attachment;
      const submittedFiles = files;
      submittingRef.current = true;
      updateDraft("");
      setAttachment(null);
      setFiles([]);
      try {
        const accepted = await onSend(
          trimmedDraft,
          submittedAttachment ?? undefined,
          uploads.length ? uploads : undefined
        );
        if (!accepted && !draftRef.current) {
          updateDraft(submittedDraft);
          setAttachment(submittedAttachment);
        }
        if (!accepted) {
          setFiles((current) => (current.length ? current : submittedFiles));
        } else {
          for (const file of submittedFiles) {
            if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
          }
        }
      } finally {
        submittingRef.current = false;
      }
    };

    return (
      <div className="chat-composer">
        <div className="chat-composer-inner">
          {attachment || files.length ? (
            <div className="chat-composer-attachments">
              {attachment ? (
                <MessageAttachmentChip
                  attachment={attachment}
                  onRemove={() => {
                    setAttachment(null);
                    textareaRef.current?.focus();
                  }}
                />
              ) : null}
              {files.map((file) => (
                <ComposerFileChip
                  key={file.key}
                  file={file}
                  onRemove={() => removeFile(file.key)}
                />
              ))}
            </div>
          ) : null}
          <div className="chat-composer-entry">
            <textarea
              ref={textareaRef}
              className="chat-input"
              aria-label={t("Message your coach")}
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
              onPaste={(event) => {
                // Pasted screenshots and copied files attach; pasted text stays text.
                const pasted = [...event.clipboardData.files];
                if (pasted.length === 0 || event.clipboardData.getData("text/plain")) return;
                event.preventDefault();
                addFiles(pasted);
              }}
              placeholder={
                waitingForCoachAnswer
                  ? t("Type another answer…")
                  : t("Ask your coach…")
              }
              rows={1}
              disabled={exportingLatestActivity}
            />
            <button
              type="button"
              className={streaming ? "chat-send chat-stop" : "chat-send"}
              data-mode={streaming ? "stop" : "send"}
              onClick={() => {
                if (streaming) {
                  onStop();
                } else {
                  void submitDraft();
                }
              }}
              disabled={
                !streaming &&
                (!apiAvailable ||
                  !hasMessage ||
                  readingFiles ||
                  exportingLatestActivity ||
                  localProviderBlocked)
              }
              title={
                streaming
                  ? t("Stop")
                  : localProviderBlocked
                    ? t("Enter a local model first")
                    : readingFiles
                      ? t("Reading your files…")
                      : t("Send")
              }
              aria-label={streaming ? t("Stop") : t("Send")}
            >
              <span className="chat-send-glyph chat-send-glyph-send" aria-hidden="true">
                <ArrowUp size={16} strokeWidth={2.4} />
              </span>
              <span className="chat-send-glyph chat-send-glyph-stop" aria-hidden="true">
                <Square size={12} strokeWidth={2.4} fill="currentColor" />
              </span>
            </button>
          </div>
          <div className="chat-composer-toolbar">
            <button
              type="button"
              className="chat-composer-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={!apiAvailable || exportingLatestActivity || files.length >= MAX_COACH_FILES}
              aria-label={t("Attach files")}
              title={t("Attach a plan, document, or image")}
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={COACH_FILE_ACCEPT}
              hidden
              tabIndex={-1}
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {providerControls}
            <button
              type="button"
              className="chat-new-chat chat-composer-new-chat"
              onClick={onNewChat}
              disabled={!apiAvailable || streaming || exportingLatestActivity}
              aria-label={t("Start a new chat")}
              title={t("Start a new chat")}
            >
              <Plus size={14} aria-hidden="true" />
              <span>{t("New chat")}</span>
            </button>
          </div>
        </div>
        <p className="chat-disclaimer">
          {t("Coach can make mistakes. Verify important training decisions.")}</p>
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
  onPendingPromptConsumed,
  accountSetupRequest = 0,
  visible = true
}: ChatViewProps) {
  useLanguage();
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
  const [fileDragActive, setFileDragActive] = useState(false);
  useEffect(() => {
    if (accountSetupRequest > 0) setSettingsOpen(true);
  }, [accountSetupRequest]);
  // The open conversation as the Coach hub in the main process reports it.
  // This window renders it; the hub builds and saves the transcript.
  const [coachState, setCoachState] = useState<CoachClientState | null>(null);
  // Tools called so far in the turn in progress, for the live source badge.
  const [liveTools, setLiveTools] = useState<{ requestId: string; tools: string[]; error?: string } | null>(null);
  const [exportingLatestActivity, setExportingLatestActivity] = useState(false);
  const timeline = coachState?.entries ?? NO_ENTRIES;
  const activeTurn = coachState?.activeTurn ?? null;
  // The FIT export is a turn the window writes itself; it shows its own row.
  const streaming = Boolean(activeTurn) && !exportingLatestActivity;
  const streamingText = activeTurn?.text ?? "";
  const thinkingText = activeTurn?.thinking ?? "";
  const activeTool = activeTurn?.tool ?? null;
  const currentSource: SourceInfo | null =
    activeTurn && liveTools?.requestId === activeTurn.requestId && liveTools.tools.length > 0
      ? {
          snapshotIncluded: false,
          mcpEnabled: true,
          mcpUsed: true,
          mcpTools: liveTools.tools,
          ...(liveTools.error ? { mcpError: liveTools.error } : {})
        }
      : null;
  const [mcpStatus, setMcpStatus] = useState<CorosMcpStatus | null>(null);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpRefreshVersion, setMcpRefreshVersion] = useState(0);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [selectedCreationId, setSelectedCreationId] = useState<
    string | null
  >(null);
  const [planPanelExpanded, setPlanPanelExpanded] = useState(false);
  const [highlightedChatEntryIndex, setHighlightedChatEntryIndex] = useState<
    number | null
  >(null);
  const [uploadingDraftId, setUploadingDraftId] = useState<string | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null
  );
  // What is pinned on the Training Hub, so cards know whether they live there
  // and whether pinning would replace an older chart with the same title.
  const [pinnedCharts, setPinnedCharts] = useState<
    { id: string; previewId: string; title: string }[]
  >([]);
  const [pinningPreviewId, setPinningPreviewId] = useState<string | null>(null);
  // previewId -> one-line confirmation under the card after pinning.
  const [pinNotices, setPinNotices] = useState<Record<string, string>>({});
  const pinnedChartIds = useMemo(
    () => Object.fromEntries(pinnedCharts.map((chart) => [chart.previewId, chart.id])),
    [pinnedCharts]
  );
  const pinnedTitles = useMemo(
    () => new Set(pinnedCharts.map((chart) => normalizeCoachChartTitle(chart.title))),
    [pinnedCharts]
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .listPinnedCoachCharts()
      .then((charts) => {
        if (cancelled) return;
        setPinnedCharts(
          charts.map((chart) => ({
            id: chart.id,
            previewId: chart.preview.previewId,
            title: chart.preview.spec.title
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  const pinCoachChart = useCallback(
    async (preview: CoachChartPreview) => {
      if (!api) return;
      setPinningPreviewId(preview.previewId);
      onError(null);
      try {
        const { pinned, replaced } = await api.pinCoachChart(preview);
        setPinnedCharts((prev) => [
          { id: pinned.id, previewId: preview.previewId, title: preview.spec.title },
          ...prev.filter((chart) => chart.id !== pinned.id)
        ]);
        // The Coach charts widget is opt-in on the dashboard; a first pin
        // would otherwise land somewhere the athlete cannot see.
        let addedWidget = false;
        try {
          addedWidget = ensureDashboardWidget("coach");
        } catch {
          addedWidget = false;
        }
        setPinNotices((prev) => ({
          ...prev,
          [preview.previewId]: addedWidget
            ? t("Pinned. A Coach charts section was added to your Training Hub dashboard.")
            : replaced
              ? t("Updated the pinned chart with this title on your Training Hub.")
              : t("Pinned to your Training Hub dashboard, under Coach charts.")
        }));
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : t("Could not pin the chart."));
      } finally {
        setPinningPreviewId(null);
      }
    },
    [api, onError]
  );

  const unpinCoachChart = useCallback(
    async (previewId: string) => {
      const pinnedId = pinnedChartIds[previewId];
      if (!api || !pinnedId) return;
      setPinningPreviewId(previewId);
      onError(null);
      try {
        await api.unpinCoachChart(pinnedId);
        setPinnedCharts((prev) => prev.filter((chart) => chart.id !== pinnedId));
        setPinNotices((prev) => {
          const next = { ...prev };
          delete next[previewId];
          return next;
        });
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : t("Could not unpin the chart."));
      } finally {
        setPinningPreviewId(null);
      }
    },
    [api, onError, pinnedChartIds]
  );

  // Refs so the push-event handlers read current values without being
  // recreated (and re-subscribed) on every keystroke.
  const activeSessionIdRef = useRef<string | null>(null);
  const coachStateRef = useRef<CoachClientState | null>(null);
  // Events that arrive while a conversation is opening, applied once it is.
  const pendingFramesRef = useRef<CoachEventFrame[]>([]);
  const providerRef = useRef<ChatProvider>(DEFAULT_CHAT_SETTINGS.provider);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPlanUploadedRef = useRef(onPlanUploaded);
  onPlanUploadedRef.current = onPlanUploaded;
  const autoDetectLocalRef = useRef(false);
  const claudePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mcpRef = useRef<HTMLDivElement>(null);
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
    composerRef.current?.setDraft(pendingPrompt.text, pendingPrompt.attachment);
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

  const showCoachState = (state: CoachClientState | null) => {
    coachStateRef.current = state;
    setCoachState(state);
  };

  const upsertSessionSummary = (summary: ChatSessionSummary) => {
    setSessions((current) => {
      const next = [summary, ...current.filter((session) => session.id !== summary.id)];
      next.sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
      );
      return next;
    });
  };

  /**
   * Shows a conversation: its snapshot, then every event after its cursor. With
   * `animate`, the switch morphs from the conversation on screen.
   */
  const loadSession = async (sessionId: string, animate = false) => {
    if (!api) return;
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    // The previous conversation stays up until this one's snapshot arrives.
    setLiveTools(null);
    pendingFramesRef.current = [];
    try {
      const snapshot = await api.coachGetSession(sessionId);
      if (activeSessionIdRef.current !== sessionId) return;
      const { response, replay } = await api.coachSubscribe(sessionId, snapshot.cursor);
      if (activeSessionIdRef.current !== sessionId) return;
      const commit = () => {
        showCoachState(
          coachStateFromSnapshot(response.mode === "snapshot" ? response.snapshot : snapshot)
        );
        // Events that arrived meanwhile were held for this snapshot; apply them in order.
        const pending = pendingFramesRef.current;
        pendingFramesRef.current = [];
        applyCoachFramesRef.current([...replay, ...pending]);
      };
      if (animate) {
        morph(commit);
      } else {
        commit();
      }
    } catch {
      if (activeSessionIdRef.current === sessionId) {
        showCoachState(null);
      }
    }
  };

  const refreshSessions = async (provider: ChatProvider) => {
    if (!api) return [];
    const listed = await api.coachListSessions(provider);
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
    const created = await api.coachCreateSession(provider);
    setSessions([created]);
    await loadSession(created.id);
    return created.id;
  };

  // Applies hub events to the open conversation, with the side effects the
  // old in-window transcript had: errors, sign-in state, refreshed views.
  const applyCoachFrames = (frames: CoachEventFrame[]) => {
    let state = coachStateRef.current;
    if (!state) return;
    const wasEmpty = state.entries.length === 0;
    for (const frame of frames) {
      if (frame.sessionId !== state.sessionId || frame.seq <= state.cursor) continue;
      const next = applyCoachEvent(state, frame);
      if (next === "resync") {
        void loadSession(state.sessionId);
        return;
      }
      if (frame.event === "turn.started") {
        setLiveTools({ requestId: frame.data.requestId, tools: [] });
      } else if (frame.event === "turn.tool") {
        const { requestId, tool, status, message } = frame.data;
        setLiveTools((current) => {
          const base = current?.requestId === requestId ? current : { requestId, tools: [] };
          return {
            requestId,
            tools: tool ? [...base.tools, tool] : base.tools,
            error: status === "failed" ? message ?? status : base.error
          };
        });
      } else if (frame.event === "turn.completed") {
        setLiveTools(null);
      } else if (frame.event === "turn.failed") {
        setLiveTools(null);
        onErrorRef.current(frame.data.message);
        if (frame.data.authError) {
          setAuthStatus({ signedIn: false });
        }
        if (providerRef.current === "claude-code") {
          void api
            ?.getClaudeCodeStatus()
            .then(setClaudeStatus)
            .catch(() => undefined);
        }
      } else if (frame.event === "entry.updated") {
        // Saves land on any device; refresh the Training views when one does.
        const before = state.entries[frame.data.index];
        const after = frame.data.entry;
        const saved =
          (after.kind === "planDraft" && before?.kind === "planDraft" &&
            !before.draft.uploadedAt && Boolean(after.draft.uploadedAt)) ||
          (after.kind === "corosAction" && before?.kind === "corosAction" &&
            before.preview.state !== "saved" && after.preview.state === "saved") ||
          (after.kind === "workoutDelete" && before?.kind === "workoutDelete" &&
            before.preview.state !== "deleted" && after.preview.state === "deleted");
        if (saved) onPlanUploadedRef.current?.();
      }
      state = next;
    }
    const settled = state;
    // A conversation's first message morphs the hero into the transcript.
    if (wasEmpty && settled.entries.length > 0) {
      morph(() => showCoachState(settled));
    } else {
      showCoachState(settled);
    }
  };
  const applyCoachFramesRef = useRef(applyCoachFrames);
  applyCoachFramesRef.current = applyCoachFrames;

  useEffect(() => {
    if (!api) return;
    const unsubscribeEvents = api.onCoachEvent((frame) => {
      if (frame.sessionId !== activeSessionIdRef.current) return;
      if (coachStateRef.current?.sessionId !== frame.sessionId) {
        pendingFramesRef.current.push(frame);
        return;
      }
      applyCoachFramesRef.current([frame]);
    });
    const unsubscribeSessions = api.onCoachSessionsChanged((change) => {
      if (change.kind === "delete") {
        setSessions((current) => current.filter((session) => session.id !== change.sessionId));
      } else if (change.session.provider === providerRef.current) {
        upsertSessionSummary(change.session);
      }
    });
    const unsubscribeSettings = api.onChatSettingsChanged?.((settings) => {
      const providerChanged = settings.provider !== providerRef.current;
      setChatSettings(settings);
      if (providerChanged) void ensureActiveSession(settings.provider);
    });
    return () => {
      unsubscribeEvents();
      unsubscribeSessions();
      unsubscribeSettings?.();
      const sessionId = activeSessionIdRef.current;
      if (sessionId) void api.coachUnsubscribe(sessionId).catch(() => undefined);
    };
  }, [api]);

  useEffect(() => {
    providerRef.current = chatSettings.provider;
  }, [chatSettings.provider]);

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

  // Coach stays mounted while hidden, and Settings → Accounts can save the
  // Local/OpenRouter config meanwhile. Re-read on return, or the next Coach
  // save would write this stale copy back over it.
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    const returned = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!api || !returned) return;
    let cancelled = false;
    void api
      .getChatSettings()
      .then((settings) => {
        if (!cancelled) setChatSettings(settings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, visible]);

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
      onError(caught instanceof Error ? caught.message : t("ChatGPT sign-in failed."));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!api) return;
    const sessionId = activeSessionIdRef.current;
    if (activeTurn && sessionId) {
      void api.coachCancel(sessionId).catch(() => undefined);
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
          : t("Claude Code detection failed.")
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
        caught instanceof Error ? caught.message : t("Claude sign-in failed.")
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
          : t("Claude connection test failed.")
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
          : t("Could not save Claude settings.")
      );
    }
  };

  const handleNewChat = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      const created = await api.coachCreateSession(chatSettings.provider);
      upsertSessionSummary(created);
      await loadSession(created.id, true);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Could not start a new chat."));
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity || sessionId === activeSessionId) {
      return;
    }
    onError(null);
    await loadSession(sessionId, true);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.coachDeleteSession(sessionId);
      const listed = await refreshSessions(chatSettings.provider);
      if (sessionId === activeSessionId) {
        if (listed.length > 0) {
          await loadSession(listed[0].id);
        } else {
          const created = await api.coachCreateSession(chatSettings.provider);
          setSessions([created]);
          await loadSession(created.id);
        }
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Could not delete chat."));
    }
  };

  const handleDeleteAllSessions = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.coachDeleteAllSessions(chatSettings.provider);
      const created = await api.coachCreateSession(chatSettings.provider);
      setSessions([created]);
      await loadSession(created.id);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Could not clear chats."));
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
      onError(caught instanceof Error ? caught.message : t("Provider change failed."));
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
          : t("Could not save the selected model.")
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
        message: t("OpenRouter settings saved."),
        models: current?.models ?? []
      }));
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : t("Could not save OpenRouter settings.")
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
        message: t("OpenRouter API key cleared."),
        models: []
      });
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : t("Could not clear the OpenRouter API key.")
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
          : t("OpenRouter connection test failed.")
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
      onError(t("Could not save Coach settings. Please try again."));
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
        message: t("Local model settings saved."),
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Local settings failed."));
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
        message: t("Local API key cleared."),
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Could not clear API key."));
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
              ? t("{{p0}} {{p1}} running, but no models were found. Pull an Ollama model or load a model in LM Studio, then detect again.", { p0: runningEmpty.map((server) => server.label).join(t(" and ")), p1: runningEmpty.length === 1 ? "is" : "are" })
              : "No Ollama or LM Studio server found on localhost ports 11434 or 1234. For a server on another machine, enter its URL (for example http://192.168.1.20:8000/v1) and click Test."
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
        message: t("Detected {{p0}} with {{p1}} model{{p2}}.", { p0: preferred.label, p1: preferred.models.length, p2: preferred.models.length === 1 ? "" : "s" }),
        normalizedBaseUrl: preferred.baseUrl,
        models: preferred.models
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : t("Local model detection failed.");
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
      onError(caught instanceof Error ? caught.message : t("Local connection test failed."));
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
      onError(caught instanceof Error ? caught.message : t("COROS connection failed."));
    } finally {
      await refreshMcpStatuses();
      setMcpBusy(false);
    }
  };

  const sendMessage = async (
    trimmed: string,
    answeredPrompt?: { promptId: string; choiceId: string },
    attachment?: ChatMessageAttachment,
    uploads?: CoachFileUpload[]
  ): Promise<boolean> => {
    if (!api || (!trimmed && !uploads?.length) || streaming || exportingLatestActivity) return false;
    if (!uploads?.length && isLatestActivityFileRequest(trimmed)) {
      await handleLatestActivityFileRequest(trimmed);
      return true;
    }
    if (
      chatSettings.provider === "openrouter" &&
      !chatSettings.openRouter.hasApiKey &&
      !openRouterApiKey.trim()
    ) {
      onError(t("Add an OpenRouter API key in Coach settings first."));
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
            : t("OpenRouter settings failed.")
        );
        return false;
      }
    }
    if (chatSettings.provider === "local" && !chatSettings.local.model.trim()) {
      onError(t("Enter a local model before starting the coach."));
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
        onError(caught instanceof Error ? caught.message : t("Local settings failed."));
        return false;
      }
    }
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return false;
    onError(null);
    try {
      // The hub decides whether this answers an open question card and
      // builds the transcript; the window only says what was written.
      await api.coachSend({
        sessionId,
        clientMessageId: crypto.randomUUID(),
        text: trimmed,
        ...(answeredPrompt ? { promptAnswer: answeredPrompt } : {}),
        ...(attachment ? { attachment } : {}),
        ...(uploads?.length ? { uploads } : {}),
        unitSystem
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t("Chat request failed."));
      return false;
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
    const sessionId = activeSessionIdRef.current;
    if (!api || !sessionId || !activeTurn) return;
    void api.coachCancel(sessionId).catch(() => undefined);
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
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      // The hub saves the result into the card for every client and the
      // Training views refresh when its update arrives.
      await api.coachConfirm({
        sessionId,
        kind: "planUpload",
        id: draftId,
        decision: "confirm",
        options: { destination, scheduleDate, unitSystem }
      });
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : t("Failed to save the workout or plan to COROS.")
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
      onError(caught instanceof Error ? caught.message : t("The Coach plan could not be opened in the Training Library."));
    }
  };

  const handleScrollToCreationChat = (creation: CoachCreation) => {
    const planIndex = timeline.findIndex((entry) =>
      creation.kind === "planDraft"
        ? entry.kind === "planDraft" &&
          entry.draft.draftId === creation.draft.draftId
        : entry.kind === "corosAction" &&
          entry.preview.requestId === creation.preview.requestId
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

  const handleConfirmCorosAction = async (requestId: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!api || !sessionId) return;
    const { entry } = await api.coachConfirm({
      sessionId,
      kind: "corosAction",
      id: requestId,
      decision: "confirm"
    });
    return entry.kind === "corosAction" ? entry.preview : undefined;
  };

  const handleConfirmWorkoutDelete = async (requestId: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!api || !sessionId || deletingRequestId) return;
    setDeletingRequestId(requestId);
    onError(null);
    try {
      const { entry } = await api.coachConfirm({
        sessionId,
        kind: "workoutDelete",
        id: requestId,
        decision: "confirm"
      });
      if (entry.kind === "workoutDelete" && entry.preview.state === "failed") {
        onError(entry.preview.message ?? t("Failed to delete workout from COROS."));
      }
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : t("Failed to delete workout from COROS.")
      );
    } finally {
      setDeletingRequestId(null);
    }
  };

  const handleLatestActivityFileRequest = async (trimmed: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!api || !sessionId) return;

    // The export opens a save dialog here, so this window writes the reply;
    // the hub still records it like any other turn.
    const { requestId } = await api.coachBeginLocalTurn(sessionId, crypto.randomUUID(), trimmed);
    setExportingLatestActivity(true);
    onError(null);

    let reply: string;
    try {
      const result = await api.exportLatestTrainingHubActivityFile(4);
      reply = formatLatestActivityExportMessage(result);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : t("Latest activity FIT export failed.");
      onError(message);
      reply = t("I couldn't download the latest activity FIT file: {{p0}}", { p0: message });
    } finally {
      setExportingLatestActivity(false);
    }
    await api.coachFinishLocalTurn(sessionId, requestId, reply).catch(() => undefined);
  };

  const isLocalProvider = chatSettings.provider === "local";
  const isClaudeProvider = chatSettings.provider === "claude-code";
  const isOpenRouterProvider = chatSettings.provider === "openrouter";
  const isChatGptProvider = chatSettings.provider === "chatgpt";
  const localModelConfigured = chatSettings.local.model.trim().length > 0;
  const isBusy = streaming || exportingLatestActivity;
  // A turn that answers a question card resumes the plan it paused.
  const resumingCoachPrompt = (() => {
    if (!activeTurn) return false;
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const entry = timeline[index];
      if (entry.kind === "message") return false;
      if (entry.kind === "coachPrompt") return entry.prompt.answeredAt !== undefined;
    }
    return false;
  })();
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
  // Local drafts and official COROS review cards, in timeline order.
  const creations = listCoachCreations(timeline);
  const latestCreation = creations.at(-1);
  const selectedCreation =
    creations.find((creation) => creation.id === selectedCreationId) ??
    latestCreation;
  // "Plan 2 of 3" numbering counts local training plans only.
  const trainingPlanDrafts = creations.flatMap((creation) =>
    creation.kind === "planDraft" && creation.artifact === "plan"
      ? [creation.draft]
      : []
  );
  const selectedTrainingPlanNumber =
    selectedCreation?.kind === "planDraft" && selectedCreation.artifact === "plan"
      ? trainingPlanDrafts.findIndex(
          (draft) => draft.draftId === selectedCreation.draft.draftId
        ) + 1
      : 0;
  const creationArtifacts = new Set(
    creations.map((creation) => creation.artifact)
  );
  const creationsSubtitle =
    creationArtifacts.size > 1
      ? t("Plans and one-off workouts")
      : creationArtifacts.has("plan")
        ? t("Training plans")
        : t("One-off workouts");
  const selectedCreationTitle = !selectedCreation
    ? ""
    : selectedCreation.kind === "corosAction"
      ? selectedCreation.title
      : selectedCreation.title ||
        (selectedCreation.artifact === "workout"
          ? t("Untitled workout")
          : t("Untitled plan"));
  const selectedCreationKicker = !selectedCreation
    ? ""
    : selectedCreation.kind === "corosAction"
      ? [t(selectedCreation.destination), selectedCreation.date]
          .filter(Boolean)
          .join(" · ")
      : selectedCreation.artifact === "workout"
        ? t("One-off workout")
        : t("Plan {{p0}} of {{p1}}", {
            p0: selectedTrainingPlanNumber,
            p1: trainingPlanDrafts.length
          });

  useEffect(() => {
    setSelectedCreationId(latestCreation?.id ?? null);
    if (latestCreation) {
      setPlanPanelExpanded(false);
    }
  }, [activeSessionId, latestCreation?.id]);

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
        api={api}
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
    onDeleteSession: (sessionId: string) => void handleDeleteSession(sessionId),
    onDeleteAllSessions: () => void handleDeleteAllSessions()
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
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="chat-header">
              <div className="chat-header-title">
                <span>{t("Training Coach")}</span>
              </div>
              <div className="chat-header-end">
                <button
                  type="button"
                  className="chat-settings-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 size={16} aria-hidden="true" />
                  {t("Settings")}</button>
              </div>
            </div>
            <div className="panel chat-login-panel chat-claude-login-panel">
              <Terminal size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Claude Code</h2>
                <span className="chat-beta-badge">{t("Beta")}</span>
              </div>
              <p>
                {t("Use the Claude Code CLI installed on this computer with your existing Claude subscription. CorosLink does not read or store your Claude credentials.")}</p>
              <div className="chat-login-actions">
                {notInstalled ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void api?.openClaudeCodeSetupGuide()}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    {t("Install Claude Code")}</button>
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
                    {t("Sign in with Claude")}</button>
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
                  {t("Check again")}</button>
              </div>
              <p className="chat-login-note">
                {claudeStatus?.message ?? t("Checking for Claude Code…")}
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
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="chat-header">
              <div className="chat-header-title">
                <span>{t("Training Coach")}</span>
              </div>
              <div className="chat-header-end">
                <button
                  type="button"
                  className="chat-settings-button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t("Open settings")}
                >
                  <Settings2 size={16} aria-hidden="true" />
                  {t("Settings")}</button>
              </div>
            </div>
            <div className="panel chat-login-panel chat-openrouter-login-panel">
              <Network size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>{t("Connect OpenRouter")}</h2>
                <span className="chat-beta-badge">{t("BYOK")}</span>
              </div>
              <p>
                {t("Use your OpenRouter API key and model credits for COROS-aware coaching, workout drafting, and activity tools.")}</p>
              <div className="chat-login-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setSettingsOpen(true)}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  {t("Add API key")}</button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void api?.openOpenRouterKeys()}
                  disabled={!api}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  {t("Get a key from OpenRouter")}</button>
              </div>
              <p className="chat-login-note">
                {t("Your key is encrypted in local app storage and is never added to the chat transcript.")}</p>
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
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="chat-header">
              <div className="chat-header-title">
                <span>{t("Training Coach")}</span>
              </div>
              <div className="chat-header-end">
                <button
                  type="button"
                  className="chat-settings-button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t("Open settings")}
                >
                  <Settings2 size={16} aria-hidden="true" />
                  {t("Settings")}</button>
              </div>
            </div>
            <div className="panel chat-login-panel">
              <MessageCircle size={32} aria-hidden="true" />
              <h2>{t("Your training coach")}</h2>
              <p>
                {t("Sign in with your ChatGPT account to chat with a coach that knows your COROS activities, recovery, and upcoming workouts.")}</p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleSignIn()}
                disabled={signingIn || !api}
              >
                {signingIn ? (
                  <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
                ) : null}
                {t("Sign in with ChatGPT")}</button>
              <p className="chat-login-note">
                {t("Or switch to Local model below to chat without signing in.")}</p>
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
      <div className="chat-layout">
        <ChatSidebar {...sidebarProps} />
        <div
          className={`chat-main${fileDragActive ? " is-file-drag" : ""}`}
          onDragOver={(event) => {
            if (!api || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setFileDragActive(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setFileDragActive(false);
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setFileDragActive(false);
            composerRef.current?.addFiles([...event.dataTransfer.files]);
          }}
        >
          <div className="chat-header">
            <div className="chat-header-title">
              <span>{t("Training Coach")}</span>
            </div>
            <div className="chat-header-end">
              <button
                type="button"
                className="chat-settings-button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t("Open settings")}
              >
                <Settings2 size={16} aria-hidden="true" />
                {t("Settings")}</button>
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
                      title={t("Connected via MCP: {{p0}}", { p0: connectedServers
                        .map((s) => s.name)
                        .join(", ") })}
                      aria-expanded={showTools}
                      aria-haspopup="dialog"
                    >
                      <Database size={13} aria-hidden="true" />
                      {connectedServers.length === 1
                        ? connectedServers[0].name
                        : t("{{p0}} MCP servers", { p0: connectedServers.length })}
                      <span className="chat-mcp-pill-detail">
                        {" "}· {totalTools}  {t("tools")}
                      </span>
                    </button>
                    {showTools ? (
                      <div className="chat-mcp-panel">
                        <ul>
                          {connectedServers.map((s) => (
                            <li key={s.id}>
                              <code>{s.name}</code>
                              <span>{s.toolCount}  {t("tools")}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="chat-mcp-panel-head">
                          <button
                            type="button"
                            onClick={() => setSettingsOpen(true)}
                          >
                            {t("Manage servers")}</button>
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
                      ? t("Connecting…")
                      : mcpStatus?.authorized
                        ? t("Reconnect COROS")
                        : t("Connect COROS")}
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
                  {t("Sign out")}</button>
              ) : null}
            </div>
          </div>
          <div className="chat-transcript" ref={scrollRef}>
        <div className="chat-thread">
          {timeline.length === 0 && !streaming ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Sparkles size={26} strokeWidth={1.6} aria-hidden="true" />
              </div>
              <h3>{t("How can I help with your training?")}</h3>
              <p className="chat-empty-description">
                {t("A little insight. A clear plan. Your next step forward.")}</p>
              <div className="chat-suggestions">
                {[
                  {
                    title: t("Review my activity"),
                    description: t("Find the takeaways from my latest session"),
                    prompt: t("How was my latest activity?"),
                    icon: Activity
                  },
                  {
                    title: t("Create a workout"),
                    description: t("Build a session for today’s goals"),
                    prompt: t("Create one workout for today and save it to my Workout Library"),
                    icon: Target
                  },
                  {
                    title: t("Plan my week"),
                    description: t("Bring some balance to my training"),
                    prompt: t("Build a balanced week from my recent training"),
                    icon: CalendarDays
                  },
                  {
                    title: t("Check my recovery"),
                    description: t("See if I’m ready for a harder session"),
                    prompt: t("Am I recovered enough for a hard session?"),
                    icon: HeartPulse
                  }
                ].map(({ title, description, prompt, icon: Icon }) => (
                  <button
                    key={title}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => {
                      composerRef.current?.setDraft(prompt);
                      composerRef.current?.focus();
                    }}
                  >
                    <Icon className="chat-suggestion-icon" size={19} strokeWidth={1.7} aria-hidden="true" />
                    <span className="chat-suggestion-copy">
                      <strong>{title}</strong>
                      <span>{description}</span>
                    </span>
                    <ArrowUpRight className="chat-suggestion-arrow" size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <details className="chat-more-suggestions">
                <summary>{t("More ways to get started")} <ChevronDown size={14} aria-hidden="true" /></summary>
                <div className="chat-more-suggestions-list">
                  {[
                    t("Break down my latest workout by lap"),
                    t("Schedule bike intervals for Saturday"),
                    t("Add strength around my endurance sessions"),
                    t("Download my latest activity FIT file")
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        composerRef.current?.setDraft(suggestion);
                        composerRef.current?.focus();
                      }}
                    >
                      {suggestion}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </details>
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
                  <div className="chat-bubble chat-bubble-plan">
                    <CoachDraftPreviewCard
                      draft={entry.draft}
                      uploading={uploadingDraftId === entry.draft.draftId}
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

            if (entry.kind === "workoutEdit") {
              return <div key={entry.preview.proposalId} className="chat-row chat-row-assistant"><div className="chat-bubble chat-bubble-plan">{api && <WorkoutEditCard preview={entry.preview} api={api} />}</div></div>;
            }
            if (entry.kind === "corosAction") {
              if (showPlanPanel) {
                return null;
              }
              return <div key={entry.preview.requestId} className="chat-row chat-row-assistant">
                
                <div className="chat-bubble chat-bubble-plan">
                  <CorosActionCard preview={entry.preview} onConfirm={() => handleConfirmCorosAction(entry.preview.requestId)} />
                </div>
              </div>;
            }

            if (entry.kind === "workoutDelete") {
              return (
                <div
                  key={entry.preview.requestId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-bubble chat-bubble-plan">
                    <DeletePreviewCard
                      preview={entry.preview}
                      deleting={deletingRequestId === entry.preview.requestId}
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
                  <div className="chat-bubble chat-bubble-plan">
                    <HrZoneCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "coachChart") {
              const previewId = entry.preview.previewId;
              return (
                <div
                  key={previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-bubble chat-bubble-plan chat-bubble-chart">
                    <CoachChartCard
                      preview={entry.preview}
                      pinned={Boolean(pinnedChartIds[previewId])}
                      replaces={pinnedTitles.has(
                        normalizeCoachChartTitle(entry.preview.spec.title)
                      )}
                      busy={pinningPreviewId === previewId}
                      notice={pinnedChartIds[previewId] ? pinNotices[previewId] ?? null : null}
                      onPin={() => void pinCoachChart(entry.preview)}
                      onUnpin={() => void unpinCoachChart(previewId)}
                    />
                  </div>
                </div>
              );
            }

            const userFiles = entry.role === "user" ? entry.files ?? [] : [];
            return (
              <div
                key={`message-${index}`}
                className={`chat-row chat-row-${entry.role}${
                  userFiles.length ? " has-files" : ""
                }${
                  highlightedChatEntryIndex === index
                    ? " is-chat-jump-target"
                    : ""
                }`}
                data-chat-entry-index={index}
              >
                {userFiles.length ? (
                  <MessageFiles
                    files={userFiles}
                    api={api}
                    sessionId={activeSessionId}
                    onError={onError}
                  />
                ) : null}
                {entry.role === "user" && userFiles.length && !entry.content && !entry.attachment ? null : (
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
                    <>
                      {entry.content}
                      {entry.attachment ? (
                        <div className="chat-message-attachments">
                          <MessageAttachmentChip attachment={entry.attachment} />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                )}
              </div>
            );
          })}

          {streaming ? (
            <div className="chat-row chat-row-assistant">
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
                          ? t("Using {{p0}}…", { p0: activeTool.replace(/_/g, " ") })
                          : resumingCoachPrompt
                            ? t("Resuming plan…")
                            : t("Working on it…")}
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
              <div className="chat-bubble">{t("Preparing latest activity FIT export…")}</div>
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
            onSend={(message, attachment, uploads) =>
              sendMessage(message, undefined, attachment, uploads)
            }
            onStop={handleStop}
            onFileError={onError}
          />
          {fileDragActive ? (
            <div className="chat-dropzone" aria-hidden="true">
              <span className="chat-dropzone-badge">
                <Paperclip size={18} />
                {t("Drop to attach to your message")}
              </span>
              <span className="chat-dropzone-hint">
                {t("PDF, Word, text, or images")}
              </span>
            </div>
          ) : null}
        </div>
        {showPlanPanel && selectedCreation ? (
          <aside
            className={`chat-plan-panel${
              planPanelExpanded ? " is-expanded" : " is-list-view"
            }`}
            aria-label={
              planPanelExpanded ? t("Generated item details") : t("Coach creations")
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
                      <strong>{t("Coach creations")}</strong>
                      <span>{creationsSubtitle}</span>
                    </div>
                  </div>
                  <strong className="chat-plan-list-count">
                    {creations.length}
                  </strong>
                </header>
                <ol className="chat-plan-list">
                  {creations.map((creation, index) => {
                    const selected = creation.id === selectedCreation.id;
                    const SportIcon = sportTheme(creation.sport).icon;
                    const select = () =>
                      morph(
                        () => setPlanPanelExpanded(true),
                        () => setSelectedCreationId(creation.id)
                      );

                    if (creation.kind === "corosAction") {
                      const label = creation.title;
                      return (
                        <li key={creation.id}>
                          <button
                            type="button"
                            className={`chat-plan-list-item${
                              selected ? " is-selected" : ""
                            }`}
                            onClick={select}
                            aria-label={t("Open {{p0}}", { p0: label })}
                          >
                            <span
                              className="chat-plan-list-sport"
                              style={planSportStyle(creation.sport)}
                            >
                              <SportIcon
                                size={15}
                                strokeWidth={2}
                                aria-hidden="true"
                              />
                            </span>
                            <span className="chat-plan-list-copy">
                              <span className="chat-plan-list-kicker">
                                {t(creation.kicker ?? creation.title)}
                              </span>
                              <strong>{label}</strong>
                              <span className="chat-plan-list-meta">
                                <span>{t(creation.destination)}</span>
                                {creation.date ? (
                                  <span>{creation.date}</span>
                                ) : null}
                                <span data-status={creation.status}>
                                  {creationStatusLabel(creation.status)}
                                </span>
                              </span>
                            </span>
                            <ChevronRight size={15} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    }

                    const { draft } = creation;
                    const saved = creation.status === "saved";
                    const isWorkout = creation.artifact === "workout";
                    const planNumber = isWorkout
                      ? 0
                      : creations
                          .slice(0, index + 1)
                          .filter(
                            (item) =>
                              item.kind === "planDraft" && item.artifact === "plan"
                          ).length;
                    const weeks = isWorkout
                      ? 0
                      : Math.max(
                          1,
                          groupPlanEntriesByWeek(draft.entries).filter(
                            (week) => week.id !== "unscheduled"
                          ).length
                        );

                    return (
                      <li key={creation.id}>
                        <button
                          type="button"
                          className={`chat-plan-list-item${
                            selected ? " is-selected" : ""
                          }`}
                          onClick={select}
                          aria-label={t("Open {{p0}}", { p0: draft.name || `${isWorkout ? t("workout") : "plan"} ${index + 1}` })}
                        >
                          <span
                            className="chat-plan-list-sport"
                            style={planSportStyle(creation.sport)}
                          >
                            <SportIcon
                              size={15}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </span>
                          <span className="chat-plan-list-copy">
                            <span className="chat-plan-list-kicker">
                              {isWorkout ? t("One-off workout") : t("Plan {{p0}}", { p0: planNumber })}
                            </span>
                            <strong>
                              {draft.name || (isWorkout ? t("Untitled workout") : t("Untitled plan"))}
                            </strong>
                            <span className="chat-plan-list-meta">
                              <span>
                                {draft.entries.length}{" "}
                                {draft.entries.length === 1
                                  ? t("workout")
                                  : t("workouts")}
                              </span>
                              {!isWorkout ? (
                                <span>
                                  {weeks} {weeks === 1 ? "week" : "weeks"}
                                </span>
                              ) : (
                                <span>{t("Workout Library")}</span>
                              )}
                              <span data-status={saved ? "saved" : "draft"}>
                                {saved ? t("Saved") : t("Draft")}
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
                      onClick={() => morph(() => setPlanPanelExpanded(false))}
                      aria-label={t("Back to Coach creations")}
                      title={t("Back to Coach creations")}
                    >
                      <ChevronLeft size={15} aria-hidden="true" />
                      {t("Creations")}</button>
                    <div className="chat-plan-panel-title is-detail-title">
                      <div>
                        <strong title={selectedCreationTitle}>
                          {selectedCreationTitle}
                        </strong>
                        <span>{selectedCreationKicker}</span>
                      </div>
                    </div>
                    <div className="chat-plan-panel-actions">
                      <button
                        type="button"
                        className="chat-plan-panel-chat-link"
                        onClick={() =>
                          handleScrollToCreationChat(selectedCreation)
                        }
                        title={t("View the generated response in chat")}
                      >
                        <MessageCircle size={14} aria-hidden="true" />
                        {t("View in chat")}</button>
                    </div>
                  </div>
                </header>
                <div className="chat-plan-panel-body">
                  {selectedCreation.kind === "corosAction" ? (
                    <CorosActionCard
                      key={selectedCreation.id}
                      preview={selectedCreation.preview}
                      onConfirm={() =>
                        handleConfirmCorosAction(
                          selectedCreation.preview.requestId
                        )
                      }
                    />
                  ) : (
                    <CoachDraftPreviewCard
                      key={selectedCreation.id}
                      draft={selectedCreation.draft}
                      uploading={
                        uploadingDraftId === selectedCreation.draft.draftId
                      }
                      onUpload={(destination, scheduleDate) =>
                        void handleUploadPlanDraft(
                          selectedCreation.draft.draftId,
                          destination,
                          scheduleDate
                        )
                      }
                      onReview={
                        onReviewPlan
                          ? () => handleReviewPlanDraft(selectedCreation.draft)
                          : undefined
                      }
                    />
                  )}
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
