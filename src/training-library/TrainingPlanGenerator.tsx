import { formatWorkoutSport } from "../calendar/workoutLabels";
import { useLanguage, getLocale, t } from "../i18n/training";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  Info,
  LoaderCircle,
  Minus,
  Plus,
  RotateCw,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ChatProvider,
  PlanDraftPreview,
  TrainingPlanDocument,
  TrainingPlanGenerationRequest,
  WorkoutSport
} from "../../electron/types";
import { trainingPlanFromDraftPreview } from "../../electron/trainingPlanDomain";
import { WORKOUT_SPORTS } from "../../electron/workoutCapabilities";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { sportTheme } from "./sportTheme";

interface TrainingPlanGeneratorProps {
  api: CorosLinkApi;
  onClose: () => void;
  onGenerated: (plan: TrainingPlanDocument) => void;
  onOpenCoach: (prompt?: string) => void;
}
interface ProviderAvailability {
  provider: ChatProvider;
  label: string;
  ready: boolean;
  detail: string;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* Sport chip identity — icon plus colour — comes from ./sportTheme, so the
   generator agrees with the library indexes about what a sport looks like. */
const DIFFICULTY_OPTIONS: { value: TrainingPlanGenerationRequest["difficulty"]; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "New to structured training" },
  { value: "intermediate", label: "Intermediate", hint: "Training consistently" },
  { value: "advanced", label: "Advanced", hint: "Strong high-volume base" },
  { value: "custom", label: "Custom", hint: "Coach judges from your data" }
];

const EXAMPLE_GOALS = [
  "Finish my first trail 50K comfortably",
  "Build a consistent 5K run base",
  "Hybrid strength and engine for HYROX"
];

/** Canonical generation stages in order; `id` matches the stage text set by stream events. */
const STAGE_STEPS = [
  { id: "Preparing Training Coach context", label: "Preparing context" },
  { id: "Reviewing training context", label: "Reviewing your training" },
  { id: "Building the plan structure", label: "Building plan structure" },
  { id: "Validating workouts and dates", label: "Validating workouts" }
];

function calendarDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function providerName(provider: ChatProvider): string {
  if (provider === "claude-code") return "Claude Code";
  if (provider === "gemini-cli") return "Gemini CLI";
  if (provider === "local") return "Local model";
  return "ChatGPT";
}

function isValidStartDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.valueOf()) && value >= calendarDay();
}

function generationPrompt(request: TrainingPlanGenerationRequest): string {
  const available = request.availableDayIndexes.map((day) => t(DAY_NAMES[day]!)).join(", ");
  return [
    "Create a complete structured training plan for the athlete using the current Training Coach context, recovery metrics, recent activities, upcoming schedule, units, and privacy permissions.",
    "Do not ask a follow-up question. Do not upload, schedule, save, delete, or otherwise write anything remotely.",
    `Goal: ${request.goal}`,
    `Sports (use only these): ${request.sports.join(", ")}`,
    `Difficulty: ${request.difficulty}`,
    `Length: exactly ${request.weeks} weeks`,
    `Sessions: exactly ${request.sessionsPerWeek} workouts per week`,
    `Plan start date (Day 1 of Week 1): ${request.startDate}`,
    "Each plan week is a consecutive seven-day block beginning on the plan start date.",
    `Available calendar weekdays (use only these): ${available}`,
    request.maxSessionMinutes ? `Maximum duration for every session: ${request.maxSessionMinutes} minutes` : "No explicit session-duration cap.",
    request.constraints?.trim() ? `Additional constraints: ${request.constraints.trim()}` : "No additional constraints.",
    "Every workout must have a schedule_date, explicit sport, and complete typed steps including repeats, targets, and intensities. Set save_to_library to false.",
    "You MUST call draft_training_plan with the finished plan. Return a short summary only after the tool succeeds. Never call upload_training_plan."
  ].join("\n");
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}

function Stepper({ value, min, max, disabled, decreaseLabel, increaseLabel, onChange }: StepperProps) {
  useLanguage();
  return (
    <span className="plan-generator-stepper">
      <button type="button" aria-label={decreaseLabel} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={13} />
      </button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" aria-label={increaseLabel} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={13} />
      </button>
    </span>
  );
}
export function TrainingPlanGenerator({ api, onClose, onGenerated, onOpenCoach }: TrainingPlanGeneratorProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [goal, setGoal] = useState("");
  const [sports, setSports] = useState<WorkoutSport[]>(["run"]);
  const [difficulty, setDifficulty] = useState<TrainingPlanGenerationRequest["difficulty"]>("intermediate");
  const [weeks, setWeeks] = useState(8);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [startDate, setStartDate] = useState(calendarDay);
  const [availableDays, setAvailableDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [maxSessionMinutes, setMaxSessionMinutes] = useState("");
  const [constraints, setConstraints] = useState("");
  const [availability, setAvailability] = useState<ProviderAvailability | null>(null);
  const [checkingProvider, setCheckingProvider] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState("Preparing Training Coach context");
  const [failure, setFailure] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const draftRef = useRef<PlanDraftPreview | null>(null);
  const requestRef = useRef<TrainingPlanGenerationRequest | null>(null);

  const request = useMemo<TrainingPlanGenerationRequest>(() => ({
    goal: goal.trim(),
    sports,
    difficulty,
    weeks,
    sessionsPerWeek,
    startDate,
    availableDayIndexes: [...availableDays].sort(),
    maxSessionMinutes: maxSessionMinutes ? Number(maxSessionMinutes) : undefined,
    constraints: constraints.trim() || undefined
  }), [availableDays, constraints, difficulty, goal, maxSessionMinutes, sessionsPerWeek, sports, startDate, weeks, getLocale()]);

  const formValid = Boolean(
    request.goal && request.sports.length && request.availableDayIndexes.length &&
    request.weeks >= 1 && request.weeks <= 24 &&
    request.sessionsPerWeek >= 1 && request.sessionsPerWeek <= Math.min(7, request.availableDayIndexes.length) &&
    isValidStartDate(request.startDate) &&
    (request.maxSessionMinutes === undefined || request.maxSessionMinutes > 0)
  );

  /** Index into STAGE_STEPS for the progress checklist; unknown tool messages map to "reviewing". */
  const stageIndex = (() => {
    const exact = STAGE_STEPS.findIndex((step) => step.id === stage);
    if (exact >= 0) return exact;
    return stage.includes("Coach tools") ? 1 : 0;
  })();

  /** Live plan snapshot for the sidebar: total sessions and the full date range. */
  const snapshot = useMemo(() => {
    const start = new Date(`${startDate}T12:00:00`);
    const validStart = !Number.isNaN(start.valueOf());
    const end = validStart ? new Date(start) : null;
    if (end) end.setDate(end.getDate() + Math.max(1, weeks) * 7 - 1);
    const dayFmt = new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" });
    const fullFmt = new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric", year: "numeric" });
    const total = Number.isFinite(weeks * sessionsPerWeek) ? weeks * sessionsPerWeek : 0;
    return {
      total,
      range: end ? `${dayFmt.format(start)} – ${fullFmt.format(end)}` : "Pick a plan start date"
    };
  }, [sessionsPerWeek, startDate, weeks, getLocale()]);

  const daysSummary = useMemo(() => {
    if (!availableDays.length) return "—";
    if (availableDays.length === 7) return t("Every day");
    return [...availableDays].sort().map((day) => t(DAY_NAMES[day]!)).join(" · ");
  }, [availableDays, getLocale()]);

  useEffect(() => {
    let active = true;
    void api.getChatSettings().then(async (settings) => {
      const label = providerName(settings.provider);
      if (settings.provider === "chatgpt") {
        const status = await api.getChatAuthStatus();
        if (active) setAvailability({ provider: settings.provider, label, ready: status.signedIn, detail: status.signedIn ? "Signed in and using Coach privacy settings." : "Sign in to ChatGPT in Training Coach settings." });
      } else if (settings.provider === "claude-code") {
        const status = await api.getClaudeCodeStatus();
        if (active) setAvailability({ provider: settings.provider, label, ready: status.authenticated, detail: status.authenticated ? status.message : "Connect Claude Code in Training Coach settings." });
      } else if (settings.provider === "gemini-cli") {
        const status = await api.getGeminiCliStatus();
        if (active) setAvailability({ provider: settings.provider, label, ready: status.authenticated, detail: status.authenticated ? status.message : "Connect Gemini CLI in Training Coach settings." });
      } else {
        const configured = Boolean(settings.local.baseUrl.trim() && settings.local.model.trim());
        let ready = configured;
        let detail = configured ? t("Configured for {{value1}}.", { value1: String(settings.local.model) }) : "Choose a local endpoint and model in Training Coach settings.";
        if (configured) {
          const tested = await api.testLocalChatConnection(settings.local);
          ready = tested.ok;
          detail = tested.message;
        }
        if (active) setAvailability({ provider: settings.provider, label, ready, detail });
      }
    }).catch((cause: unknown) => {
      if (active) setAvailability({ provider: "chatgpt", label: "Training Coach", ready: false, detail: cause instanceof Error ? cause.message : String(cause) });
    }).finally(() => { if (active) setCheckingProvider(false); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => {
    const finishWithDraft = (fullText: string) => {
      const draft = draftRef.current;
      const boundRequest = requestRef.current;
      activeRequestId.current = null;
      setGenerating(false);
      if (!draft || !boundRequest) {
        setFailure(fullText.trim()
          ? "Training Coach returned guidance, but did not produce a valid structured plan draft."
          : "Training Coach did not return a structured plan draft.");
        return;
      }
      try {
        onGenerated(trainingPlanFromDraftPreview(draft, boundRequest));
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      }
    };
    const offStart = api.onChatStreamStart((payload) => {
      if (payload.requestId === activeRequestId.current) setStage("Reviewing training context");
    });
    const offToken = api.onChatStreamToken((payload) => {
      if (payload.requestId === activeRequestId.current) setStage("Building the plan structure");
    });
    const offInfo = api.onChatStreamInfo((payload) => {
      if (payload.requestId !== activeRequestId.current) return;
      if (payload.kind === "planDraft") {
        draftRef.current = payload.draft;
        setStage("Validating workouts and dates");
      } else if (payload.kind === "mcp") {
        setStage(payload.message ?? "Checking Training Coach tools");
      }
    });
    const offDone = api.onChatStreamDone((payload) => {
      if (payload.requestId === activeRequestId.current) finishWithDraft(payload.fullText);
    });
    const offError = api.onChatStreamError((payload) => {
      if (payload.requestId !== activeRequestId.current) return;
      activeRequestId.current = null;
      setGenerating(false);
      setFailure(payload.message);
    });
    return () => { offStart(); offToken(); offInfo(); offDone(); offError(); };
  }, [api, onGenerated]);

  useEffect(() => () => {
    const requestId = activeRequestId.current;
    if (requestId) void api.cancelChat(requestId);
  }, [api]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const requestId = activeRequestId.current;
      if (requestId) void api.cancelChat(requestId);
      activeRequestId.current = null;
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [api, onClose]);

  const close = () => {
    const requestId = activeRequestId.current;
    if (requestId) void api.cancelChat(requestId);
    activeRequestId.current = null;
    onClose();
  };

  const generate = async () => {
    if (!formValid || !availability?.ready) return;
    const requestId = `training-plan-${crypto.randomUUID()}`;
    activeRequestId.current = requestId;
    requestRef.current = structuredClone(request);
    draftRef.current = null;
    setFailure(null);
    setGenerating(true);
    setStage("Preparing Training Coach context");
    try {
      await api.sendChat(requestId, [{ role: "user", content: generationPrompt(request) }], unitSystem);
    } catch (cause) {
      if (activeRequestId.current !== requestId) return;
      activeRequestId.current = null;
      setGenerating(false);
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleSport = (sport: WorkoutSport) => {
    setSports((current) => current.includes(sport) ? current.filter((item) => item !== sport) : [...current, sport]);
  };

  const toggleDay = (day: number) => {
    setAvailableDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  };

  const handoffPrompt = failure ? generationPrompt(request) : undefined;

  /** First blocking problem, shown in the footer so the disabled Generate button explains itself. */
  const formHint = (() => {
    if (generating || formValid) return null;
    if (!request.goal) return "Describe your goal to continue.";
    if (!request.sports.length) return "Pick at least one sport.";
    if (!request.availableDayIndexes.length) return "Pick at least one available day.";
    if (request.sessionsPerWeek > request.availableDayIndexes.length) return t("Choose at least {{value1}} available days.", { value1: String(request.sessionsPerWeek) });
    if (!isValidStartDate(request.startDate)) return "Choose today or a future start date.";
    return "Check the highlighted fields above.";
  })();
  return (
    <div className="plan-generator-backdrop">
      <section className="plan-generator" role="dialog" aria-modal="true" aria-labelledby="plan-generator-title">
        <header>
          <div>
            <p className="tl-eyebrow">{t("Training Coach")}</p>
            <h2 id="plan-generator-title">
              <span className="plan-generator-title-icon"><Sparkles size={16} /></span>
              {t("Generate a training plan")} </h2>
            <p>{t("Build a structured draft from your current training and recovery context. Nothing is sent to COROS until you install the saved plan.")}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t("Close plan generator")} disabled={generating} onClick={close}><X size={17} /></button>
        </header>

        <div className="plan-generator-body">
          <div className="plan-generator-form">
            <label className="plan-generator-goal">
              <span>{t("What are you training for?")}</span>
              <input autoFocus value={goal} maxLength={180} placeholder={t("Example: Finish my first trail 50K comfortably")} disabled={generating} onChange={(event) => setGoal(event.target.value)} />
            </label>
            {!goal.trim() ? (
              <div className="plan-generator-examples">
                <span>{t("Try")}</span>
                {EXAMPLE_GOALS.map((example) => (
                  <button type="button" key={example} disabled={generating} onClick={() => setGoal(example)}>{example}</button>
                ))}
              </div>
            ) : null}

            <fieldset>
              <legend>{t("Sports")}</legend>
              <div className="plan-generator-sports">
                {WORKOUT_SPORTS.map((sport) => {
                  const theme = sportTheme(sport);
                  const SportIcon = theme.icon;
                  const selected = sports.includes(sport);
                  return (
                    <button
                      type="button"
                      key={sport}
                      className={selected ? "is-selected" : ""}
                      style={{ "--sport-accent": theme.color } as CSSProperties}
                      aria-pressed={selected}
                      disabled={generating}
                      onClick={() => toggleSport(sport)}
                    >
                      <SportIcon size={13} />
                      {formatWorkoutSport(sport)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend>{t("Difficulty")}</legend>
              <div className="plan-generator-segmented">
                {DIFFICULTY_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={difficulty === option.value ? "is-selected" : ""}
                    aria-pressed={difficulty === option.value}
                    disabled={generating}
                    onClick={() => setDifficulty(option.value)}
                  >
                    <strong>{t(option.label)}</strong>
                    <small>{t(option.hint)}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="plan-generator-grid">
              <label>
                <span>{t("Weeks")}</span>
                <Stepper value={weeks} min={1} max={24} disabled={generating} decreaseLabel="Fewer weeks" increaseLabel="More weeks" onChange={setWeeks} />
              </label>
              <label>
                <span>{t("Sessions / week")}</span>
                <Stepper value={sessionsPerWeek} min={1} max={Math.min(7, availableDays.length || 1)} disabled={generating} decreaseLabel="Fewer sessions per week" increaseLabel="More sessions per week" onChange={setSessionsPerWeek} />
              </label>
              <label>
                <span>{t("Plan start date")}</span>
                <span className="plan-generator-date">
                  <CalendarDays size={14} />
                  <input type="date" value={startDate} min={calendarDay()} disabled={generating} onChange={(event) => setStartDate(event.target.value)} />
                </span>
              </label>
            </div>

            <fieldset>
              <legend>{t("Available days")}</legend>
              <div className="plan-generator-days">
                {DAY_NAMES.map((day, index) => (
                  <button
                    type="button"
                    key={day}
                    title={t(DAY_NAMES_FULL[index]!)}
                    aria-pressed={availableDays.includes(index)}
                    className={availableDays.includes(index) ? "is-selected" : ""}
                    disabled={generating}
                    onClick={() => toggleDay(index)}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </fieldset>
            {sessionsPerWeek > availableDays.length ? <p className="plan-generator-inline-error" role="alert">{t("Choose at least")} {sessionsPerWeek} {t("available days.")}</p> : null}
            {!isValidStartDate(startDate) ? <p className="plan-generator-inline-error" role="alert">{t("Choose today or a future start date.")}</p> : null}

            <div className="plan-generator-grid is-bottom">
              <label>
                <span>{t("Session limit")} <small>{t("optional")}</small></span>
                <span className="plan-generator-duration">
                  <input type="number" min="10" max="600" value={maxSessionMinutes} placeholder={t("No limit")} disabled={generating} onChange={(event) => setMaxSessionMinutes(event.target.value)} />
                  <em>min</em>
                </span>
              </label>
              <label className="plan-generator-constraints">
                <span>{t("Constraints")} <small>{t("optional")}</small></span>
                <textarea rows={3} value={constraints} maxLength={600} placeholder={t("Injuries, equipment, travel, preferred long day...")} disabled={generating} onChange={(event) => setConstraints(event.target.value)} />
              </label>
            </div>
          </div>

          <aside className="plan-generator-status">
            <p className="tl-eyebrow">{t("Provider")}</p>
            {checkingProvider ? (
              <div className="plan-generator-provider">
                <span className="plan-generator-provider-icon"><LoaderCircle className="is-spinning" size={15} /></span>
                <span><strong>{t("Checking Training Coach")}</strong><small>{t("Using your configured provider")}</small></span>
              </div>
            ) : availability ? (
              <div className={`plan-generator-provider${availability.ready ? " is-ready" : " is-blocked"}`}>
                <span className="plan-generator-provider-icon">{availability.ready ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                <span><strong>{t(availability.label)}</strong><small>{t(availability.detail)}</small></span>
              </div>
            ) : null}
            {!checkingProvider && !availability?.ready ? <button type="button" className="ghost-button" onClick={() => onOpenCoach()}>{t("Open Coach setup")} <ArrowRight size={14} /></button> : null}

            <p className="tl-eyebrow plan-generator-aside-eyebrow">{t("Plan snapshot")}</p>
            <ul className="plan-generator-snapshot">
              <li>
                <span>{t("Sports")}</span>
                {sports.length ? (
                  <span className="plan-generator-snapshot-sports">
                    {sports.map((sport) => {
                      const theme = sportTheme(sport);
                      const SportIcon = theme.icon;
                      return (
                        <span key={sport} className="plan-generator-snapshot-sport" style={{ "--sport-accent": theme.color } as CSSProperties} title={formatWorkoutSport(sport)}>
                          <SportIcon size={12} />
                        </span>
                      );
                    })}
                  </span>
                ) : <strong>—</strong>}
              </li>
              <li><span>{t("Structure")}</span><strong>{weeks} {t("weeks ·")} {sessionsPerWeek} {t("/ week")}</strong></li>
              <li><span>{t("Total sessions")}</span><strong>{snapshot.total}</strong></li>
              <li><span>{t("Dates")}</span><strong>{snapshot.range}</strong></li>
              <li><span>{t("Days")}</span><strong>{daysSummary}</strong></li>
              {maxSessionMinutes ? <li><span>{t("Session cap")}</span><strong>{maxSessionMinutes} min</strong></li> : null}
            </ul>

            {generating ? (
              <div className="plan-generator-progress" aria-live="polite">
                <span className="plan-generator-pulse"><Sparkles size={18} /></span>
                <strong>{t("Generating your plan")}</strong>
                <ol className="plan-generator-stages">
                  {STAGE_STEPS.map((step, index) => (
                    <li key={step.id} className={index < stageIndex ? "is-done" : index === stageIndex ? "is-active" : ""}>
                      <span className="plan-generator-stage-dot">{index < stageIndex ? <Check size={10} /> : null}</span>
                      {t(step.label)}
                    </li>
                  ))}
                </ol>
                {!STAGE_STEPS.some((step) => step.id === stage) ? <p>{stage}</p> : null}
                <button type="button" className="ghost-button" onClick={close}>{t("Cancel")}</button>
              </div>
            ) : null}
            {failure ? (
              <div className="plan-generator-failure" role="alert">
                <AlertTriangle size={17} />
                <strong>{t("Draft needs another pass")}</strong>
                <p>{failure}</p>
                <div>
                  <button type="button" className="ghost-button" disabled={!formValid || !availability?.ready} onClick={() => void generate()}><RotateCw size={14} /> {t("Retry")}</button>
                  <button type="button" className="ghost-button" onClick={() => onOpenCoach(handoffPrompt)}>{t("Continue in Coach")} <ArrowRight size={14} /></button>
                </div>
              </div>
            ) : null}
            {!generating && !failure ? (
              <div className="plan-generator-privacy">
                <strong>{t("Review before saving")}</strong>
                <p>{t("The result opens as an unsaved local Coach plan. You can edit every workout before saving or adding it to your calendar.")}</p>
              </div>
            ) : null}
          </aside>
        </div>

        <footer>
          {formHint ? <p className="plan-generator-footer-hint"><Info size={13} />{formHint}</p> : null}
          <button type="button" className="ghost-button" disabled={generating} onClick={close}>{t("Cancel")}</button>
          <button type="button" className="primary-button" disabled={!formValid || !availability?.ready || generating} onClick={() => void generate()}>
            {generating ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}
            {generating ? t("Generating...") : t("Generate plan")}
          </button>
        </footer>
      </section>
    </div>
  );
}
