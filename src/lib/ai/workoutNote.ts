// The short note under one workout, written on the server from the athlete's synced items (docs/sync-contract.md
// 5.10). Pure: the facts the model is given, the instructions, and what is kept of its answer. The wording of the
// instructions is the phone's own (ActivitySummaryWriter.swift), so a note reads the same wherever it was written.
import type { ActivityDetailBody, NativeActivity } from "@/data/sync/native";

export const NOTE_COLLECTION = "ai.note";
export type NoteKind = "workout";
export const NOTE_KINDS: readonly NoteKind[] = ["workout"];

/** What the item holds. `writtenAt` is seconds since 2001, like every time in the contract. */
export interface NoteBody {
  kind: NoteKind;
  key: string;
  language: string;
  text: string;
  writer: "server" | "phone";
  /** The model that wrote it (server) or the phone's writer (`onDevice`, `ownKey`, `coach`). */
  model?: string;
  /** What the text was written from: the same facts give the same fingerprint, so it isn't written twice. */
  fingerprint?: string;
  writtenAt: number;
}

const REF_EPOCH = 978307200;
export const refNow = (now: number = Date.now()): number => Math.round(now / 1000) - REF_EPOCH;

/** A language tag as a client sends it: `en`, `pt`, `zh-Hans`. */
export const languageTag = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(value) ? value : null;

/** The item id: kind, key and language, in the characters an id may hold. */
export const noteId = (kind: NoteKind, key: string, language: string): string => `${kind}.${key}.${language}`;

export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function instructions(language: string): string {
  return [
    "You write the short note under one workout in C-LINK, a training app for COROS watches, like a coach's comment after a session. Second person, plain words, warm but honest, no hype, no emojis, no hashtags, no markdown, no lists.",
    "Rules:",
    "- Use only the facts given. Never invent numbers, workouts or causes.",
    "- Say what stands out and what it means for fitness, pacing, effort or recovery; don't repeat every number.",
    "- Compare only as the facts do; don't work out differences between numbers yourself.",
    "- Each number and percentage belongs to its own fact; never move one to another fact or turn a score into a time.",
    "- Two or three sentences, at most 320 characters.",
    `- Write in ${languageName(language)}, the athlete's own language, with the spelling and words of their region.`,
    "- Keep numbers, paces and units as the facts give them.",
    "- It's a reading of the watch's data, not medical advice.",
  ].join("\n");
}

const two = (n: number): string => String(n).padStart(2, "0");

/** 1:02:03 or 42:07. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

const PACE_SPORTS = new Set(["run", "trailRun", "treadmill", "trackRun", "walk", "hike"]);
const MILE = 1609.344;

export interface FactOptions { imperial?: boolean; /** Minutes east of UTC where the athlete is, for the time of day. */ utcOffsetMinutes?: number }

/**
 * The lines the model is told about a workout, in English and the athlete's units. Only what the synced items
 * hold: a value that isn't there is left out, never guessed. Comparisons are worked out here, not by the model.
 */
export function workoutFacts(activity: NativeActivity, detail: ActivityDetailBody | undefined, options: FactOptions = {}): string {
  const lines: string[] = [];
  const add = (name: string, value: string | null | undefined) => { if (value) lines.push(`${name}: ${value}`); };
  const unit = options.imperial ? MILE : 1000, unitName = options.imperial ? "mi" : "km";
  const pace = (secondsPerMetre: number) => `${clock(secondsPerMetre * unit)} /${unitName}`;
  const usesPace = PACE_SPORTS.has(String(activity.sport));

  add("Sport", String(activity.sport));
  add("Name", activity.name);
  if (typeof activity.start === "number") {
    const at = new Date((activity.start + REF_EPOCH + (options.utcOffsetMinutes ?? 0) * 60) * 1000);
    add("When", `${at.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}, ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`);
  }
  const distance = activity.distanceMeters ?? 0, time = activity.durationSeconds ?? 0;
  if (distance > 50) add("Distance", `${(distance / unit).toFixed(2)} ${unitName}`);
  if (time > 0) add("Time", clock(time));
  if (distance > 50 && time > 0) {
    if (usesPace) add("Average pace", pace(time / distance));
    else add("Average speed", `${((distance / unit) / (time / 3600)).toFixed(1)} ${unitName}/h`);
  }
  if (activity.averageHR) add("Average heart rate", `${Math.round(activity.averageHR)} bpm`);
  if (activity.maxHR) add("Highest heart rate", `${Math.round(activity.maxHR)} bpm`);
  if (activity.elevationGain && activity.elevationGain >= 1) {
    add("Elevation gain", options.imperial ? `${Math.round(activity.elevationGain * 3.28084)} ft` : `${Math.round(activity.elevationGain)} m`);
  }
  if (activity.averagePower) add("Average power", `${Math.round(activity.averagePower)} W`);
  if (activity.trainingLoad) add("Training load (a points score, not a time)", `${Math.round(activity.trainingLoad)} points`);

  // Pacing: the two halves of the distance, from the laps.
  const laps = (detail?.laps ?? []).filter((lap) => (lap.distanceM ?? 0) > 0 && lap.durationS > 0);
  const lapDistance = laps.reduce((sum, lap) => sum + (lap.distanceM ?? 0), 0);
  if (usesPace && laps.length >= 4 && lapDistance > 1500) {
    let run = 0, first = 0, second = 0;
    for (const lap of laps) {
      const d = lap.distanceM ?? 0, inFirst = Math.max(0, Math.min(d, lapDistance / 2 - run));
      first += lap.durationS * (inFirst / d);
      second += lap.durationS * (1 - inFirst / d);
      run += d;
    }
    const split = (second - first) / first * 100, amount = Math.abs(split).toFixed(1);
    add("Pacing", Math.abs(split) <= 2 ? "even halves" : split < 0 ? `negative split, second half ${amount}% faster` : `second half ${amount}% slower`);
  }
  // Where the time went, by the athlete's own heart rate zones.
  const zones = (detail?.zones ?? []).filter((zone) => zone.seconds > 0);
  const zoneTotal = zones.reduce((sum, zone) => sum + zone.seconds, 0);
  if (zoneTotal >= 300) {
    const names = ["easy", "aerobic", "tempo", "threshold", "hard"];
    add("Time in heart rate zones", zones.map((zone) => `${names[zone.zone - 1] ?? `zone ${zone.zone}`} ${Math.round(zone.seconds / zoneTotal * 100)}%`).join(", "));
  }
  return lines.join("\n");
}

/** Without quotes, markdown or a label the model put around it; null when nothing is left. */
export function cleaned(text: string): string | null {
  let out = text.trim();
  for (const prefix of ["Summary:", "**Summary:**"]) if (out.startsWith(prefix)) out = out.slice(prefix.length);
  out = out.replaceAll("**", "").replace(/^[\s"“”]+|[\s"“”]+$/g, "");
  return out ? out : null;
}

/** At most `limit` characters, cut at the end of a sentence. */
export function shortened(text: string, limit = 380): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const end = Math.max(...[".", "!", "?", "。", "！", "？"].map((mark) => head.lastIndexOf(mark)));
  return end > limit / 3 ? head.slice(0, end + 1) : text;
}

/** A short, stable mark of the facts a note was written from (FNV-1a, hex). */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A note body read back from an item; null unless it is whole. */
export function readNote(body: unknown): NoteBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== "workout" || typeof b.key !== "string" || typeof b.language !== "string" || typeof b.text !== "string" || !b.text) return null;
  return {
    kind: "workout", key: b.key, language: b.language, text: b.text, writer: b.writer === "phone" ? "phone" : "server",
    ...(typeof b.model === "string" ? { model: b.model } : {}), ...(typeof b.fingerprint === "string" ? { fingerprint: b.fingerprint } : {}),
    writtenAt: typeof b.writtenAt === "number" ? b.writtenAt : 0,
  };
}
