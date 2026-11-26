import { CoachError, loadCoachAccess, type CoachAccessInfo } from "@/data/coach";
import { fromBrowser, fromSample, NotWiredError, type Loaded, type Origin } from "@/data/core";
import { dropPlan, planDraftStore, planStore, putPlan, savedPlans } from "@/data/local/plans";
import { samplePlans } from "@/data/sample/plans";
import { syncView } from "@/data/sync";
import { loadAddToCalendar, newStepId, removeWorkout, scheduleLibraryWorkout, standing, type LibraryRow } from "@/data/workouts";
import type { CoachEvent } from "@/lib/coach/loop";
import { t } from "@/lib/i18n";
import {
  activeTrainingPlanCalendarInstall, createTrainingPlan, duplicateTrainingPlan, installTrainingPlan, planEnv, removeTrainingPlanFromCalendar, validateTrainingPlan,
  type InstallProgress, type PlanPacing, type TrainingPlanDocument,
} from "@/lib/plan";
import { generatedPlanFromBlocks, generationPrompt, requestFromPlan, requestProblem, revisionPrompt, trainingPlanFromGenerated, type PlanGenerationRequest } from "@/lib/planGenerate";

export type { PlanDraft } from "@/data/local/plans";

/* Training plans. A plan is kept in this computer's store as a `training.plan` item ("On this computer"),
   and only "Add to calendar" reaches further, one workout at a time through the same save as the workout builder. */

export interface PlansData {
  plans: TrainingPlanDocument[];
  today: string;
  /** "Add to calendar" writes to the COROS calendar (else to this computer's). */
  toCoros: boolean;
  pacing: PlanPacing;
  /** These are the sample athlete's plans: they can be opened and copied, not changed. */
  sample: boolean;
}

/** The Plans index: the plans saved on this computer, or (only with nobody signed in anywhere) the sample athlete's. */
export async function loadPlans(): Promise<Loaded<PlansData>> {
  const at = await standing();
  const base = { today: at.today, toCoros: at.toCoros, pacing: at.pacing };
  const kept = savedPlans();
  if (kept.length > 0 || !at.sample || planStore.hasSaved()) return fromBrowser({ ...base, plans: kept, sample: false });
  return fromSample({ ...base, plans: samplePlans, sample: true });
}

export interface PlanEditorData {
  plan: TrainingPlanDocument;
  /** Not saved on this computer yet: a blank plan, a generated one, or a sample plan (saving makes your own copy). */
  neverSaved: boolean;
  /** Where Coach's generated plan differs from what was asked. */
  differences: string[];
  today: string;
  toCoros: boolean;
  pacing: PlanPacing;
  library: LibraryRow[];
  libraryOrigin: Origin;
  /** Why the workout library couldn't be read, when it couldn't. The plan can still be edited. */
  libraryProblem: string | null;
}

export interface PlanEditorQuery { id?: string | null; draft?: boolean; /** The blank plan to open when neither is given. */ blank?: TrainingPlanDocument }

/** What the editor opens with: a saved plan (`id`), the plan Coach just generated (`draft`), or a blank one. */
export async function loadPlanEditor(query: PlanEditorQuery): Promise<Loaded<PlanEditorData>> {
  const at = await standing();
  let library: LibraryRow[] = [], libraryOrigin: Origin = "browser", libraryProblem: string | null = null;
  try {
    const loaded = await loadAddToCalendar();
    library = loaded.data.library;
    libraryOrigin = loaded.origin;
  } catch (e) {
    libraryProblem = e instanceof Error ? e.message : t("The workout library couldn't be read.");
  }
  const base = { differences: [], today: at.today, toCoros: at.toCoros, pacing: at.pacing, library, libraryOrigin, libraryProblem };
  if (query.draft) {
    const draft = planDraftStore.get();
    if (!draft) throw new Error(t("The generated plan is not in this tab any more. Generate it again."));
    return fromBrowser({ ...base, plan: draft.plan, differences: draft.differences, neverSaved: true });
  }
  if (query.id) {
    const kept = savedPlans().find((p) => p.id === query.id);
    if (kept) return fromBrowser({ ...base, plan: kept, neverSaved: false });
    const sample = at.sample ? samplePlans.find((p) => p.id === query.id) : undefined;
    if (sample) return fromSample({ ...base, plan: sample, neverSaved: true });
    throw new Error(t("This plan is not saved on this computer any more."));
  }
  return fromBrowser({ ...base, plan: query.blank ?? createTrainingPlan(), neverSaved: true });
}

const isSample = (plan: TrainingPlanDocument) => samplePlans.some((p) => p.id === plan.id);

/**
 * Saves the plan on this computer. A sample plan, and a plan that came from COROS, is saved as your own local copy.
 * Resolves to the plan as saved.
 */
export async function saveTrainingPlan(plan: TrainingPlanDocument): Promise<TrainingPlanDocument> {
  const problem = validateTrainingPlan(plan).find((issue) => issue.severity === "error");
  if (problem) throw new Error(problem.message);
  const copy = isSample(plan);
  const saved: TrainingPlanDocument = {
    ...plan, ...(copy ? { id: planEnv.newId("plan"), calendarInstalls: undefined } : {}),
    source: plan.source === "coros" || plan.source === "template" ? "local" : plan.source, syncState: "local", updatedAt: planEnv.now(),
  };
  putPlan(saved);
  if (planDraftStore.get()?.plan.id === plan.id) planDraftStore.clear();
  return saved;
}

function own(planId: string): TrainingPlanDocument {
  const plan = savedPlans().find((p) => p.id === planId);
  if (!plan) throw new NotWiredError("plans.sample", t("This is a sample plan. Duplicate it, or open it and save, to get a copy of your own."));
  return plan;
}

export async function setPlanFavorite(planId: string, favorite: boolean): Promise<void> {
  putPlan({ ...own(planId), favorite });
}

/** A copy saved on this computer, off the calendar. Works for a sample plan too. */
export async function duplicatePlan(plan: TrainingPlanDocument): Promise<TrainingPlanDocument> {
  const copy = duplicateTrainingPlan(plan);
  putPlan(copy);
  return copy;
}

export interface CalendarRun {
  plan: TrainingPlanDocument;
  /** Why it stopped before the end, when it did. What was written so far is recorded on the plan. */
  problem: string | null;
}

const stoppedWhy = (plan: TrainingPlanDocument, today: string): string | null => {
  const install = activeTrainingPlanCalendarInstall(plan, today);
  return install?.state === "partial" ? install.failures[0]?.message ?? t("It stopped before the end.") : null;
};

/**
 * Puts a saved plan's workouts on the calendar, from today on, one at a time through the builder's own save: the
 * COROS calendar when signed in to Training Hub, this computer's otherwise. Stops at the first workout that is
 * refused; the plan then records "X of Y added" and can be retried or taken back.
 */
export async function addPlanToCalendar(planId: string, onProgress?: (progress: InstallProgress) => void): Promise<CalendarRun> {
  const plan = own(planId);
  const at = await standing();
  const next = await installTrainingPlan(plan, at.today, {
    save: putPlan, onProgress,
    schedule: async ({ entry, day, name }) => {
      const doc = entry.workout?.doc ? { ...entry.workout.doc, name } : null;
      if (!doc && !(at.toCoros && entry.programId)) throw new Error(t("“{name}” has no steps saved with this plan.", { name }));
      const result = await scheduleLibraryWorkout({ id: entry.programId ?? "", doc }, day, at.toCoros, at.pacing);
      if (!result.ref) throw new Error(t("The calendar didn't say where it put this workout, so the plan can't keep track of it."));
      return { where: result.where, ref: result.ref };
    },
  });
  return { plan: next, problem: stoppedWhy(next, at.today) };
}

/** Takes a plan's workouts from today on off the calendar, one at a time. Past days stay. */
export async function removePlanFromCalendar(planId: string, onProgress?: (progress: InstallProgress) => void): Promise<CalendarRun> {
  const plan = own(planId);
  const at = await standing();
  const next = await removeTrainingPlanFromCalendar(plan, at.today, {
    save: putPlan, onProgress,
    remove: (o) => removeWorkout(o.where === "coros" ? { coros: { day: o.happenDay, idInPlan: o.ref, name: o.name } } : { savedId: o.ref }),
  });
  return { plan: next, problem: stoppedWhy(next, at.today) };
}

/** Deletes a plan from this computer. Its upcoming calendar workouts are removed first; if one can't be, the plan stays. */
export async function deletePlan(planId: string): Promise<void> {
  const plan = own(planId);
  const at = await standing();
  if (activeTrainingPlanCalendarInstall(plan, at.today)) {
    const run = await removePlanFromCalendar(planId);
    if (run.problem) throw new Error(t("The plan was kept, because its calendar workouts couldn't all be removed: {problem}", { problem: run.problem }));
  }
  dropPlan(planId);
}

/* ───────────── Generate plan ───────────── */

export interface GeneratorData {
  today: string;
  /** Signed in to the store on this computer: Coach answers only from its data. */
  signedIn: boolean;
  /** Which AI key Coach would answer with; null when that couldn't be read. */
  access: CoachAccessInfo | null;
}

/** What the Generate form needs before it can ask: today, and whether Coach can answer. */
export async function loadPlanGenerator(): Promise<Loaded<GeneratorData>> {
  const [at, view] = await Promise.all([standing(), syncView()]);
  const access = view ? await loadCoachAccess().catch(() => null) : null;
  return fromBrowser({ today: at.today, signedIn: Boolean(view), access });
}

export interface GenerateOptions {
  signal?: AbortSignal;
  /** What Coach is doing, in a few words. */
  onStage?: (stage: string) => void;
}

/** Sends Coach one question that it answers with plan cards, and reads its stream to the end. */
async function askCoachForPlan(text: string, options: GenerateOptions): Promise<Extract<CoachEvent, { t: "done" }>> {
  if (!(await syncView())) throw new NotWiredError("plans.generate", t("C-LINK is still starting. Try again in a moment."));
  options.onStage?.(t("Asking Coach"));
  let response: Response;
  try {
    response = await fetch("/api/coach", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: options.signal,
      headers: { Accept: "application/x-ndjson", "Content-Type": "application/json", "X-Clink-Hub": "1" },
      body: JSON.stringify({ text, history: [], offsetMin: new Date().getTimezoneOffset(), hubDays: null, browserWorkouts: [] }),
    });
  } catch {
    throw new CoachError(options.signal?.aborted ? "stopped" : "unreachable", options.signal?.aborted ? t("Stopped before Coach answered.") : t("Coach couldn't be reached. Check your connection and try again."));
  }
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new CoachError(payload?.error?.code ?? `http_${response.status}`, payload?.error?.message ?? t("Coach couldn't answer."));
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", done: Extract<CoachEvent, { t: "done" }> | null = null, problem: string | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let event: CoachEvent;
    try { event = JSON.parse(line) as CoachEvent; } catch { return; }
    if (event.t === "working") { const step = event.card.steps[event.card.steps.length - 1]; if (step) options.onStage?.(step.text); }
    else if (event.t === "block" && event.block.kind === "plan") options.onStage?.(t("Checking workouts and dates"));
    else if (event.t === "done") done = event;
    else if (event.t === "error") problem = event.message;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(take);
    }
    take(buffer);
  } catch {
    if (options.signal?.aborted) throw new CoachError("stopped", t("Stopped before Coach finished."));
    problem ??= t("The connection dropped before Coach finished.");
  }
  const finished = done as Extract<CoachEvent, { t: "done" }> | null;
  if (!finished) throw new CoachError("unfinished", problem ?? t("Coach stopped before finishing the plan."));
  return finished;
}

/**
 * "Ask Coach" in the plan editor: Coach changes the plan as asked and lays it out again. Resolves to the plan with
 * Coach's workouts and phases in it (same id, name, goal and details), what Coach said it changed, and anything it
 * proposed that a plan can't hold. Nothing is saved: the editor takes it as one undoable edit.
 */
export async function reviseTrainingPlan(plan: TrainingPlanDocument, ask: string, options: GenerateOptions = {}): Promise<{ plan: TrainingPlanDocument; note: string; left: string[] }> {
  if (!ask.trim()) throw new Error(t("Say what Coach should change."));
  const finished = await askCoachForPlan(revisionPrompt(plan, ask), options);
  const made = generatedPlanFromBlocks(finished.blocks, newStepId);
  if (!made || !made.workouts.length) {
    const failed = finished.blocks.find((b) => b.kind === "failed");
    const text = finished.blocks.map((b) => (b.kind === "text" ? b.text : "")).join(" ").trim();
    throw new Error(failed && failed.kind === "failed" ? t("Coach couldn't change the plan: {problem}", { problem: failed.text }) : text || t("Coach answered without a changed plan. Try asking another way."));
  }
  const { plan: laid } = trainingPlanFromGenerated(made, requestFromPlan(plan));
  return {
    plan: { ...plan, entries: laid.entries, weekCount: laid.weekCount, startDate: laid.startDate, sportMix: laid.sportMix, phases: laid.phases },
    note: made.summary.trim(),
    left: made.left,
  };
}

/**
 * Asks Coach for a plan and resolves to it as an unsaved plan, also left in this tab for the editor
 * (`/calendar/plans/edit?draft=1`). It goes through the Coach route as any question does, with Coach's own
 * `propose_training_plan` tool: the workouts are the ones on Coach's plan cards and nothing is written anywhere.
 * No conversation is saved for it.
 */
export async function generateTrainingPlan(request: PlanGenerationRequest, options: GenerateOptions = {}): Promise<{ plan: TrainingPlanDocument; differences: string[] }> {
  const at = await standing();
  const invalid = requestProblem(request, at.today);
  if (invalid) throw new Error(invalid);
  const finished = await askCoachForPlan(generationPrompt(request), options);
  const made = generatedPlanFromBlocks(finished.blocks, newStepId);
  if (!made) {
    const failed = finished.blocks.find((b) => b.kind === "failed");
    throw new Error(failed && failed.kind === "failed" ? t("Coach didn't lay out a plan: {problem}", { problem: failed.text }) : t("Coach answered without a plan, so there is nothing to open. Try again, or ask in Coach."));
  }
  const result = trainingPlanFromGenerated(made, request);
  planDraftStore.set(result);
  return result;
}
