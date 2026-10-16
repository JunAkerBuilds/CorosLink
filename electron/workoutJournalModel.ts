import type {
  WorkoutBrief,
  WorkoutBriefInput,
  WorkoutCueOutcome,
  WorkoutDebrief,
  WorkoutDebriefInput,
  WorkoutFeel,
  WorkoutFocusCue,
  WorkoutFuelOutcome,
  WorkoutFueling,
  WorkoutJournalAuthor,
  WorkoutJournalEntry,
  WorkoutJournalRef,
  WorkoutJournalSaveInput
} from "./workoutJournalTypes";

export const JOURNAL_LIMITS = {
  goal: 160,
  cue: 140,
  cues: 8,
  fuelPlan: 240,
  notes: 4000,
  taken: 240,
  name: 160
} as const;

const CUE_OUTCOMES: readonly WorkoutCueOutcome[] = ["hit", "partial", "missed"];
const FUEL_OUTCOMES: readonly WorkoutFuelOutcome[] = ["good", "mixed", "bad"];
const CUE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const FEEL_WORDS: Record<WorkoutFeel, string> = {
  1: "awful",
  2: "rough",
  3: "okay",
  4: "good",
  5: "great"
};

function defaultId(): string {
  return `cue-${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\r\n?/g, "\n").trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** One line: cues and goals never hold line breaks. */
function line(value: unknown, max: number): string | undefined {
  return text(typeof value === "string" ? value.replace(/\s+/g, " ") : value, max);
}

function optionalId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  return id ? id.slice(0, 200) : undefined;
}

export function normalizeHappenDay(value: unknown): string {
  const day = String(value ?? "").replace(/-/g, "").trim();
  if (!/^\d{8}$/.test(day)) throw new Error("A workout date must be YYYYMMDD.");
  return day;
}

export function normalizeJournalRef(ref: WorkoutJournalRef): WorkoutJournalRef {
  if (!ref || typeof ref !== "object") throw new Error("Choose a workout first.");
  const planId = optionalId(ref.planId);
  const idInPlan = optionalId(ref.idInPlan);
  const activityId = optionalId(ref.activityId);
  const scheduled = Boolean(planId && idInPlan);
  if (!scheduled && !activityId) throw new Error("Choose a workout first.");
  const sportType = Number(ref.sportType);
  return {
    happenDay: normalizeHappenDay(ref.happenDay),
    ...(scheduled ? { planId, idInPlan } : {}),
    ...(activityId ? { activityId } : {}),
    ...(line(ref.workoutName, JOURNAL_LIMITS.name) ? { workoutName: line(ref.workoutName, JOURNAL_LIMITS.name) } : {}),
    ...(Number.isFinite(sportType) && sportType > 0 ? { sportType } : {})
  };
}

function normalizeCues(value: unknown, makeId: () => string): WorkoutFocusCue[] {
  if (!Array.isArray(value)) return [];
  const cues: WorkoutFocusCue[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const source = typeof raw === "string" ? { text: raw } : (raw as Partial<WorkoutFocusCue> | null);
    const cueText = line(source?.text, JOURNAL_LIMITS.cue);
    if (!cueText) continue;
    let id = typeof source?.id === "string" && CUE_ID.test(source.id) ? source.id : makeId();
    while (seen.has(id)) id = makeId();
    seen.add(id);
    cues.push({ id, text: cueText });
    if (cues.length >= JOURNAL_LIMITS.cues) break;
  }
  return cues;
}

function sameBriefContent(left: WorkoutBriefInput, right: WorkoutBriefInput): boolean {
  return left.goal === right.goal &&
    left.fuelPlan === right.fuelPlan &&
    left.notes === right.notes &&
    left.cues.length === right.cues.length &&
    left.cues.every((cue, index) => cue.text === right.cues[index]?.text);
}

/**
 * A brief the Coach wrote stays the Coach's when the athlete edits it, marked
 * edited, so the panel can say whose plan it is. Returns undefined when empty.
 */
export function normalizeBrief(
  input: WorkoutBriefInput,
  author: WorkoutJournalAuthor,
  previous: WorkoutBrief | undefined,
  now: string,
  makeId: () => string = defaultId
): WorkoutBrief | undefined {
  const content: WorkoutBriefInput = {
    goal: line(input?.goal, JOURNAL_LIMITS.goal),
    cues: normalizeCues(input?.cues, makeId),
    fuelPlan: line(input?.fuelPlan, JOURNAL_LIMITS.fuelPlan),
    notes: text(input?.notes, JOURNAL_LIMITS.notes)
  };
  if (!content.goal && content.cues.length === 0 && !content.fuelPlan && !content.notes) return undefined;
  if (previous && sameBriefContent(previous, content)) {
    return { ...previous, cues: content.cues };
  }
  const coachOwned = author === "coach" || previous?.author === "coach";
  return {
    ...(content.goal ? { goal: content.goal } : {}),
    cues: content.cues,
    ...(content.fuelPlan ? { fuelPlan: content.fuelPlan } : {}),
    ...(content.notes ? { notes: content.notes } : {}),
    author: coachOwned ? "coach" : "athlete",
    ...(coachOwned && author === "athlete" ? { edited: true } : {}),
    updatedAt: now
  };
}

function normalizeFueling(value: unknown): WorkoutFueling | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<WorkoutFueling>;
  const taken = line(source.taken, JOURNAL_LIMITS.taken);
  const outcome = FUEL_OUTCOMES.includes(source.outcome as WorkoutFuelOutcome) ? source.outcome : undefined;
  const experiment = source.experiment === true;
  if (!taken && !outcome && !experiment) return undefined;
  return {
    ...(taken ? { taken } : {}),
    ...(experiment ? { experiment } : {}),
    ...(outcome ? { outcome } : {})
  };
}

/** Outcomes only survive for cues the brief still has. Returns undefined when empty. */
export function normalizeDebrief(
  input: WorkoutDebriefInput,
  cues: readonly WorkoutFocusCue[],
  viaCoach: boolean,
  now: string
): WorkoutDebrief | undefined {
  const feelValue = Number(input?.feel);
  const feel = Number.isInteger(feelValue) && feelValue >= 1 && feelValue <= 5 ? feelValue as WorkoutFeel : undefined;
  const cueIds = new Set(cues.map((cue) => cue.id));
  const cueOutcomes: Record<string, WorkoutCueOutcome> = {};
  for (const [id, outcome] of Object.entries(input?.cueOutcomes ?? {})) {
    if (cueIds.has(id) && CUE_OUTCOMES.includes(outcome)) cueOutcomes[id] = outcome;
  }
  const fueling = normalizeFueling(input?.fueling);
  const notes = text(input?.notes, JOURNAL_LIMITS.notes);
  if (!feel && Object.keys(cueOutcomes).length === 0 && !fueling && !notes) return undefined;
  return {
    ...(feel ? { feel } : {}),
    cueOutcomes,
    ...(fueling ? { fueling } : {}),
    ...(notes ? { notes } : {}),
    ...(viaCoach ? { viaCoach } : {}),
    updatedAt: now
  };
}

export function journalEntryMatches(
  entry: Pick<WorkoutJournalEntry, "planId" | "idInPlan" | "activityId">,
  ref: Pick<WorkoutJournalRef, "planId" | "idInPlan" | "activityId">
): "scheduled" | "activity" | null {
  if (ref.planId && ref.idInPlan && entry.planId === ref.planId && entry.idInPlan === ref.idInPlan) return "scheduled";
  if (ref.activityId && entry.activityId === ref.activityId) return "activity";
  return null;
}

/** The scheduled occurrence wins over the activity, since the brief lives there. */
export function findJournalEntry<T extends Pick<WorkoutJournalEntry, "planId" | "idInPlan" | "activityId">>(
  entries: readonly T[],
  ref: Pick<WorkoutJournalRef, "planId" | "idInPlan" | "activityId">
): T | undefined {
  return entries.find((entry) => journalEntryMatches(entry, ref) === "scheduled") ??
    entries.find((entry) => journalEntryMatches(entry, ref) === "activity");
}

/**
 * Apply a save to the stored entry. Returns null when both sections end up
 * empty, so the caller deletes the row instead of keeping a blank one.
 */
export function mergeJournalEntry(
  existing: WorkoutJournalEntry | undefined,
  input: WorkoutJournalSaveInput,
  options: { author: WorkoutJournalAuthor; now: string; entryId: () => string; cueId?: () => string }
): WorkoutJournalEntry | null {
  const ref = normalizeJournalRef(input.ref);
  const { author, now } = options;
  const brief = input.brief === undefined
    ? existing?.brief
    : input.brief === null
      ? undefined
      : normalizeBrief(input.brief, author, existing?.brief, now, options.cueId);
  const cues = brief?.cues ?? [];
  const debriefSource: WorkoutDebriefInput | undefined = input.debrief === undefined
    ? existing?.debrief
    : input.debrief ?? undefined;
  const debrief = debriefSource
    ? input.debrief === undefined
      // Re-filter a kept debrief: cues it checked off may have just been removed.
      ? normalizeDebrief(debriefSource, cues, existing?.debrief?.viaCoach === true, existing?.debrief?.updatedAt ?? now)
      : normalizeDebrief(debriefSource, cues, author === "coach", now)
    : undefined;
  if (!brief && !debrief) return null;
  return {
    entryId: existing?.entryId ?? options.entryId(),
    happenDay: ref.happenDay,
    planId: ref.planId ?? existing?.planId,
    idInPlan: ref.idInPlan ?? existing?.idInPlan,
    activityId: ref.activityId ?? existing?.activityId,
    workoutName: ref.workoutName ?? existing?.workoutName,
    sportType: ref.sportType ?? existing?.sportType,
    ...(brief ? { brief } : {}),
    ...(debrief ? { debrief } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

/** The Coach may rewrite its own untouched brief, never one the athlete wrote or edited. */
export function coachMayReplaceBrief(brief: WorkoutBrief | undefined): boolean {
  return !brief || (brief.author === "coach" && !brief.edited);
}

function formatDay(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

const CUE_WORDS: Record<WorkoutCueOutcome, string> = { hit: "hit", partial: "partly", missed: "missed" };
const FUEL_WORDS: Record<WorkoutFuelOutcome, string> = { good: "sat well", mixed: "mixed", bad: "GI trouble" };

/** Compact plain-text journal for the Coach's context and tool results. */
export function formatJournalEntryForCoach(entry: WorkoutJournalEntry): string {
  const lines = [`- ${formatDay(entry.happenDay)} ${entry.workoutName ? `"${entry.workoutName}"` : "workout"}`];
  const { brief, debrief } = entry;
  if (brief) {
    const by = brief.author === "coach" ? (brief.edited ? "coach, edited by athlete" : "coach") : "athlete";
    const parts = [
      brief.goal ? `goal: ${brief.goal}` : null,
      brief.cues.length ? `focus: ${brief.cues.map((cue) => {
        const outcome = debrief?.cueOutcomes[cue.id];
        return outcome ? `${cue.text} [${CUE_WORDS[outcome]}]` : cue.text;
      }).join("; ")}` : null,
      brief.fuelPlan ? `fuel plan: ${brief.fuelPlan}` : null,
      brief.notes ? `notes: ${brief.notes.replace(/\s+/g, " ")}` : null
    ].filter(Boolean);
    lines.push(`  brief (${by}): ${parts.join(" | ")}`);
  }
  if (debrief) {
    const fueling = debrief.fueling;
    const parts = [
      debrief.feel ? `felt ${FEEL_WORDS[debrief.feel]} (${debrief.feel}/5)` : null,
      fueling
        ? `fueling${fueling.experiment ? " (new, experiment)" : ""}: ${fueling.taken ?? "not described"}${fueling.outcome ? ` → ${FUEL_WORDS[fueling.outcome]}` : ""}`
        : null,
      debrief.notes ? `notes: ${debrief.notes.replace(/\s+/g, " ")}` : null
    ].filter(Boolean);
    lines.push(`  debrief${debrief.viaCoach ? " (logged via coach)" : ""}: ${parts.join(" | ")}`);
  }
  return lines.join("\n");
}
