// Checks on everything the browser sends to /api/hub. Each returns the clean value or throws `HubInvalid`.
import type {
  HubClimbSystem, HubDay, HubExercise, HubIntensity, HubIntensityKind, HubMoveProgress, HubSport, HubStepKind, HubStepTarget, HubStroke, HubWorkout,
  HubWorkoutBlock, HubWorkoutStep,
} from "@/data/hub";
import { HubInvalid } from "./errors";
import { CLIMB_SYSTEM_ID, HUB_SPORTS } from "./rules";

const STEP_KINDS: readonly HubStepKind[] = ["warmup", "training", "rest", "cooldown"];
const TARGETS: readonly HubStepTarget[] = ["time", "distance", "open", "reps", "load", "hrRecovery", "elevationGain", "routes"];
const INTENSITIES: readonly HubIntensityKind[] = ["none", "heartRate", "pace", "power", "speed", "cadence", "stroke", "bodyweight", "weight", "rpe", "grade", "kept"];
const STROKES: readonly HubStroke[] = ["freestyle", "breaststroke", "backstroke", "butterfly", "mix", "individualMedley", "drills"];

type Bag = Record<string, unknown>;

function bag(value: unknown, what: string): Bag {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HubInvalid(`${what} is missing.`);
  return value as Bag;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new HubInvalid(`${what} isn't one this app knows.`);
  return value as T;
}

function finite(value: unknown, what: string, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) throw new HubInvalid(`${what} is out of range.`);
  return value;
}

function whole(value: unknown, what: string, low: number, high: number): number {
  const found = finite(value, what, low, high);
  if (!Number.isInteger(found)) throw new HubInvalid(`${what} must be a whole number.`);
  return found;
}

const absent = (value: unknown): boolean => value === undefined || value === null;

/** Text without control characters, at most `max` long. */
export function plainText(value: unknown, what: string, max: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HubInvalid(`${what} isn't valid.`);
  }
  if (!allowEmpty && value.trim() === "") throw new HubInvalid(`${what} is missing.`);
  return value;
}

/** The COROS account: an email address. */
export function account(value: unknown): string {
  const found = typeof value === "string" ? value.trim() : "";
  if (found.length < 3 || found.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/.test(found)) {
    throw new HubInvalid("Enter your COROS email and password.");
  }
  return found;
}

/** The password's MD5 as the browser hashed it: 32 lower-case hex digits, never the password. */
export function passwordHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/.test(value)) throw new HubInvalid("Enter your COROS email and password.");
  return value;
}

/** A real calendar day as `YYYY-MM-DD`. */
export function day(value: unknown, what = "The day"): HubDay {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HubInvalid(`${what} must be YYYY-MM-DD.`);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new HubInvalid(`${what} isn't a real date.`);
  }
  return value;
}

const MAX_RANGE_DAYS = 400;

/** `from`…`to`, in order and at most 400 days. */
export function dayRange(from: unknown, to: unknown): { from: HubDay; to: HubDay } {
  const first = day(from, "from"), last = day(to, "to");
  const span = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  if (span < 0) throw new HubInvalid("from must not be after to.");
  if (span > MAX_RANGE_DAYS) throw new HubInvalid(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  return { from: first, to: last };
}

/** A COROS ID: digits and letters only, so it can't bend a URL or a header. */
export function corosId(value: unknown, what = "The ID"): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw new HubInvalid(`${what} isn't valid.`);
  return value;
}

function exercise(value: unknown): HubExercise {
  const raw = bag(value, "The exercise");
  const out: HubExercise = { id: corosId(raw.id, "The exercise"), name: plainText(raw.name, "The exercise's name", 120) };
  if (!absent(raw.kind)) out.kind = whole(raw.kind, "The exercise's kind", 0, 99);
  if (typeof raw.code === "string" && /^[A-Za-z][A-Za-z0-9_]{1,23}$/.test(raw.code)) out.code = raw.code;
  if (typeof raw.overview === "string" && /^sid_[A-Za-z0-9_]{1,80}$/.test(raw.overview) && raw.overview !== "sid_strength_training") out.overview = raw.overview;
  return out;
}

function intensity(value: unknown): HubIntensity {
  if (absent(value)) return { kind: "none" };
  const raw = bag(value, "The target");
  const out: HubIntensity = { kind: oneOf(raw.kind, INTENSITIES, "The target") };
  if (!absent(raw.low)) out.low = finite(raw.low, "The target", 0, 100_000);
  if (!absent(raw.high)) out.high = finite(raw.high, "The target", 0, 100_000);
  if (!absent(raw.stroke)) out.stroke = oneOf(raw.stroke, STROKES, "The stroke");
  if (!absent(raw.grade)) out.grade = plainText(raw.grade, "The grade", 8);
  if (!absent(raw.gradeOffset)) out.gradeOffset = whole(raw.gradeOffset, "The relative grade", -32, 32);
  return out;
}

function step(value: unknown): HubWorkoutStep {
  const raw = bag(value, "A step");
  const out: HubWorkoutStep = { kind: oneOf(raw.kind, STEP_KINDS, "A step's kind"), target: oneOf(raw.target, TARGETS, "What a step ends on"), intensity: intensity(raw.intensity) };
  if (!absent(raw.id)) out.id = corosId(raw.id, "A step");
  if (!absent(raw.seconds)) out.seconds = finite(raw.seconds, "A step's time", 0, 86_400);
  if (!absent(raw.meters)) out.meters = finite(raw.meters, "A step's distance", 0, 1_000_000);
  if (!absent(raw.count)) out.count = whole(raw.count, "A step's count", 0, 10_000);
  if (!absent(raw.load)) out.load = whole(raw.load, "A step's training load", 0, 10_000);
  if (!absent(raw.bpm)) out.bpm = whole(raw.bpm, "A step's heart rate", 0, 300);
  if (!absent(raw.name) && raw.name !== "") out.name = plainText(raw.name, "A step's name", 120);
  if (!absent(raw.exercise)) out.exercise = exercise(raw.exercise);
  if (!absent(raw.sets)) out.sets = whole(raw.sets, "Sets", 0, 1000);
  if (!absent(raw.restSeconds)) out.restSeconds = finite(raw.restSeconds, "The rest between sets", 0, 86_400);
  return out;
}

/** A workout from the browser, checked for shape and size. What COROS itself would refuse is `hubWorkoutProblem`'s job. */
export function workout(value: unknown): HubWorkout {
  const raw = bag(value, "The workout");
  if (!Array.isArray(raw.blocks) || raw.blocks.length > 100) throw new HubInvalid("The workout's steps aren't valid.");
  let steps = 0;
  const blocks = raw.blocks.map((item): HubWorkoutBlock => {
    const block = bag(item, "A step");
    if (!Array.isArray(block.steps) || block.steps.length > 50) throw new HubInvalid("A repeat's steps aren't valid.");
    steps += block.steps.length;
    const out: HubWorkoutBlock = { repeats: absent(block.repeats) ? null : whole(block.repeats, "Repeats", 0, 1000), steps: block.steps.map(step) };
    if (!absent(block.id)) out.id = corosId(block.id, "A repeat");
    return out;
  });
  if (steps > 200) throw new HubInvalid("That's more steps than COROS takes.");
  const out: HubWorkout = {
    name: plainText(raw.name ?? "", "The workout's name", 200), sport: oneOf(raw.sport, HUB_SPORTS as readonly HubSport[], "The sport"),
    description: plainText(raw.description ?? "", "The description", 2000), blocks,
  };
  if (!absent(raw.poolLength)) out.poolLength = finite(raw.poolLength, "The pool length", 1, 1000);
  if (!absent(raw.gradeSystem)) out.gradeSystem = oneOf(raw.gradeSystem, Object.keys(CLIMB_SYSTEM_ID) as HubClimbSystem[], "The grade system");
  return out;
}

/** How far an earlier move got, as this API handed it out. */
export function moveProgress(value: unknown): HubMoveProgress {
  const raw = bag(value, "The move");
  const before = raw.targetBefore;
  if (!absent(before) && (!Array.isArray(before) || before.length > 200)) throw new HubInvalid("The move isn't valid.");
  if (typeof raw.removed !== "boolean") throw new HubInvalid("The move isn't valid.");
  return {
    from: day(raw.from, "from"), to: day(raw.to, "to"), name: plainText(raw.name, "The workout's name", 200),
    idInPlan: absent(raw.idInPlan) ? null : corosId(raw.idInPlan, "The workout"),
    targetBefore: absent(before) ? null : (before as unknown[]).map((id) => (id === "" ? "" : corosId(id, "The move"))),
    newIdInPlan: absent(raw.newIdInPlan) ? null : corosId(raw.newIdInPlan, "The move"),
    removed: raw.removed,
  };
}

export function flag(value: unknown): boolean | undefined {
  if (absent(value)) return undefined;
  if (typeof value !== "boolean") throw new HubInvalid("A setting isn't valid.");
  return value;
}

/**
 * Whether a state-changing request came from this site's own pages: it must carry the `X-Clink-Hub` header
 * (which a cross-site form or image can't add, and a cross-site script can't without a CORS preflight this
 * API never answers), and what the browser says about where it came from (`Sec-Fetch-Site`, `Origin`) must
 * agree. `host` is the host the request was addressed to.
 */
export function fromThisSite(headers: Headers, host: string | null): boolean {
  if (headers.get("x-clink-hub") !== "1") return false;
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = headers.get("origin");
  if (origin === null) return site === "same-origin";
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
