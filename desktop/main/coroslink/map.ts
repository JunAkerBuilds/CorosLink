// CorosLink's rows as C-LINK's synced items (src/data/sync/native.ts). Pure: no files, no database.
import type { CoachBriefBody, CoachConversationBody, CoachMemoryBody, CoachMessageBody, NativeActivity, NativeDayVitals, NativeSleepNight, NativeSport } from "@/data/sync/native";
import { msToRef } from "@/data/sync/native";
import type { RouteSave, RouteSport, TrackPoint } from "../../maps/types";

export interface Change { collection: string; id: string; body: object }

/** COROS's sport codes, as CorosKit's TrainingInsights.Sport(corosCode:) reads them. */
export function sportOf(code: number): NativeSport {
  switch (code) {
    case 100: return "run";
    case 101: return "indoorRun";
    case 102: return "trailRun";
    case 103: return "track";
    case 104: case 105: return "hike";
    case 200: case 202: case 203: case 204: case 205: case 299: return "bike";
    case 201: return "indoorBike";
    case 300: return "poolSwim";
    case 301: return "openWater";
    case 400: case 401: case 901: case 902: return "cardio";
    case 402: return "strength";
    case 500: case 501: case 502: case 503: case 10002: return "ski";
    case 700: case 701: case 702: case 704: return "row";
    case 900: return "walk";
    case 10000: case 10001: return "multisport";
    default: return "other";
  }
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const pos = (v: unknown): number | undefined => { const n = num(v); return n !== undefined && n > 0 ? n : undefined; };
const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** A row of `training_activities` (the COROS activity list CorosLink kept). */
export interface ActivityRow {
  activity_id: string; name: string | null; sport_type: number; sport_name: string | null;
  start_time: number | null; duration: number | null; distance: number | null; avg_hr: number | null; max_hr: number | null;
  calories: number | null; training_load: number | null; elevation_gain: number | null;
}

/** A row of `local_activity_files`: a workout CorosLink read from the watch itself, with its FIT file. */
export interface ActivityFileRow {
  activity_id: string; watch_activity_id: string | null; file_path: string; format: string; sport_type: number; name: string | null;
  start_time: number | null; duration: number | null; distance: number | null; avg_hr: number | null; max_hr: number | null;
  calories: number | null; elevation_gain: number | null;
}

function activityBody(id: string, row: Omit<ActivityRow, "activity_id" | "sport_name" | "training_load"> & { training_load?: number | null }): NativeActivity {
  return drop({
    id,
    name: row.name?.trim() || "Workout",
    sport: sportOf(row.sport_type),
    sportCode: row.sport_type,
    start: row.start_time ? msToRef(row.start_time * 1000) : undefined,
    distanceMeters: pos(row.distance),
    durationSeconds: pos(row.duration),
    averageHR: pos(row.avg_hr),
    maxHR: pos(row.max_hr),
    calories: pos(row.calories),
    trainingLoad: pos(row.training_load),
    elevationGain: pos(row.elevation_gain),
  });
}

/** COROS keeps a start-and-stop blip; the phone never shows one, so neither does the move. */
const isBlip = (r: { duration: number | null; distance: number | null }) => (r.duration ?? 0) < 60 && (r.distance ?? 0) < 50;

/**
 * Every activity once. COROS's list keeps its own ids (the same ones the phone syncs). A workout read straight from
 * the watch takes the watch's id (`coros-<start>-<type>`), as Local mode writes it, so the next watch sync updates it
 * instead of adding a second. One that COROS also lists (same start, same sport) is left to COROS's copy.
 */
export function activityChanges(list: readonly ActivityRow[], files: readonly ActivityFileRow[]): Change[] {
  const out: Change[] = [];
  const listed = new Set<string>();
  for (const row of list) {
    if (isBlip(row)) continue;
    listed.add(`${row.start_time}:${row.sport_type}`);
    out.push({ collection: "activity", id: row.activity_id, body: activityBody(row.activity_id, row) });
  }
  for (const row of files) {
    if (isBlip(row) || listed.has(`${row.start_time}:${row.sport_type}`)) continue;
    const id = row.watch_activity_id ?? row.activity_id;
    out.push({ collection: "activity", id, body: activityBody(id, row) });
  }
  return out.filter((c) => /^[A-Za-z0-9._:-]{1,128}$/.test(c.id));
}

/** A row of `local_health_summaries`: one figure of one day (`YYYYMMDD`) from the watch. */
export interface HealthRow { day: string; metric: string; value: number }
/** A row of `local_sleep_sessions`. */
export interface SleepRow {
  start_ts: number; end_ts: number; day: string; total_minutes: number; awake_minutes: number; light_minutes: number;
  deep_minutes: number; rem_minutes: number; avg_hr: number | null;
}

const dayKey = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const calendarDay = (key: string) => { const [year, month, day] = key.split("-").map(Number); return { year, month, day }; };

/** `health.day` and `health.night` items, keyed `YYYY-MM-DD` like the phone's. */
export function healthChanges(rows: readonly HealthRow[], nights: readonly SleepRow[]): Change[] {
  const days = new Map<string, NativeDayVitals>();
  const dayOf = (key: string) => days.get(key) ?? days.set(key, { day: calendarDay(key) }).get(key)!;
  for (const r of rows) {
    const key = dayKey(r.day);
    if (!key || !Number.isFinite(r.value)) continue;
    const d = dayOf(key);
    if (r.metric === "steps") d.steps = Math.round(r.value);
    else if (r.metric === "calories" || r.metric === "total_calories") d.calories = Math.round(r.value);
    else if (r.metric === "resting_hr" || r.metric === "restingHR") d.restingHR = Math.round(r.value);
    else if (r.metric === "hrv") d.hrv = Math.round(r.value);
    else if (r.metric === "active_time" && r.value > 0) d.exerciseMinutes = Math.round(r.value / 60);
  }
  const out: Change[] = [];
  // The watch can record a day's sleep as more than one session (woken in the night); they make one night.
  const byDay = new Map<string, SleepRow[]>();
  for (const n of nights) {
    const key = dayKey(n.day);
    if (key && n.total_minutes > 0) byDay.set(key, [...(byDay.get(key) ?? []), n]);
  }
  for (const [key, parts] of byDay) {
    const sum = (f: (n: SleepRow) => number) => parts.reduce((t, n) => t + f(n), 0);
    const total = sum((n) => n.total_minutes);
    const withHR = parts.filter((n) => (n.avg_hr ?? 0) > 0);
    const hrMinutes = withHR.reduce((t, n) => t + n.total_minutes, 0);
    const night: NativeSleepNight = drop({
      day: calendarDay(key), totalMinutes: total, deepMinutes: sum((n) => n.deep_minutes), lightMinutes: sum((n) => n.light_minutes),
      remMinutes: sum((n) => n.rem_minutes), awakeMinutes: sum((n) => n.awake_minutes),
      bedtime: msToRef(Math.min(...parts.map((n) => n.start_ts)) * 1000), wakeTime: msToRef(Math.max(...parts.map((n) => n.end_ts)) * 1000),
      averageHR: hrMinutes ? pos(Math.round(withHR.reduce((t, n) => t + (n.avg_hr ?? 0) * n.total_minutes, 0) / hrMinutes)) : undefined,
    });
    out.push({ collection: "health.night", id: key, body: night });
    dayOf(key).sleepMinutes = total;
  }
  for (const [key, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.keys(d).length > 1) out.push({ collection: "health.day", id: key, body: d });
  }
  return out;
}

/** A row of `chat_sessions`: one conversation, its entries in `messages_json`. */
export interface ChatRow { id: string; title: string; messages_json: string; created_at: string; updated_at: string }

const MAX_TEXT = 60_000;
const refOf = (iso: string) => { const ms = Date.parse(iso); return msToRef(Number.isFinite(ms) ? ms : 0); };

/**
 * `coach.conversation` and `coach.message` items. CorosLink's text messages come over as they are; its cards
 * (charts, plan drafts, watch actions) are made for its own screens and aren't carried.
 */
export function chatChanges(rows: readonly ChatRow[]): { changes: Change[]; conversations: number; leftOut: number } {
  const changes: Change[] = [];
  let conversations = 0, leftOut = 0;
  for (const row of rows) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(row.id)) { leftOut++; continue; }
    let entries: unknown[] = [];
    try { const parsed = JSON.parse(row.messages_json) as unknown; if (Array.isArray(parsed)) entries = parsed; } catch { /* none */ }
    const messages: CoachMessageBody[] = [];
    const startedAt = refOf(row.created_at), updatedAt = refOf(row.updated_at);
    for (const e of entries) {
      const entry = e as { kind?: unknown; role?: unknown; content?: unknown };
      if (entry?.kind !== "message" || typeof entry.content !== "string" || !entry.content.trim()) { leftOut++; continue; }
      const n = messages.length + 1, text = entry.content.slice(0, MAX_TEXT), id = `${row.id}.m${n}`;
      const message = entry.role === "user" ? { id, from: "you", text } : { id, from: "coach", blocks: [{ kind: "text", text }] };
      messages.push({ conversationId: row.id, n, at: n === 1 ? startedAt : updatedAt, message });
    }
    if (!messages.length) continue;
    conversations++;
    const conversation: CoachConversationBody = { title: row.title?.trim() || "Conversation", startedAt, updatedAt };
    changes.push({ collection: "coach.conversation", id: row.id, body: conversation });
    for (const m of messages) changes.push({ collection: "coach.message", id: `${row.id}.${String(m.n).padStart(4, "0")}`, body: m });
  }
  return { changes, conversations, leftOut };
}

/** A row of `athlete_memory`: what Coach was told to keep in mind. */
export interface MemoryRow { fact_id: string; text: string; updated_at: string }

export function memoryChanges(rows: readonly MemoryRow[]): Change[] {
  return rows.filter((r) => r.text?.trim() && /^[A-Za-z0-9._:-]{1,128}$/.test(r.fact_id))
    .map((r) => ({ collection: "coach.memory", id: r.fact_id, body: { text: r.text.trim(), at: refOf(r.updated_at) } satisfies CoachMemoryBody }));
}

/** A row of `generated_routes`: a route made in CorosLink's Maps. */
export interface RouteRow {
  id: string; name: string; distance_meters: number; ascent_meters: number | null; descent_meters: number | null;
  mode: string; surface_preference: string; points_json: string; activity_type: string | null;
}

const ROUTE_SPORT: Record<string, RouteSport> = { running: "run", run: "run", walking: "walk", walk: "walk", hiking: "hike", hike: "hike", cycling: "road", road: "road", bike: "road", mtb: "mtb", mountain_biking: "mtb" };

/** A saved route for Route Studio (RouteStore.save), or null when its points can't be read. */
export function routeSave(row: RouteRow): RouteSave | null {
  let raw: unknown;
  try { raw = JSON.parse(row.points_json); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const points: TrackPoint[] = [];
  for (const p of raw) {
    const q = p as { lat?: unknown; lon?: unknown; elevation?: unknown };
    const lat = num(q?.lat), lon = num(q?.lon), ele = num(q?.elevation);
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push(ele === undefined ? [lat, lon] : [lat, lon, ele]);
  }
  if (points.length < 2) return null;
  return {
    name: row.name?.trim().slice(0, 80) || "Route",
    sport: ROUTE_SPORT[(row.activity_type ?? "").toLowerCase()] ?? (row.surface_preference === "trail" ? "hike" : "run"),
    kind: row.mode === "loop" ? "loop" : "ab",
    source: "import",
    route: { points, distanceM: Math.max(0, row.distance_meters || 0), ascentM: Math.max(0, row.ascent_meters ?? 0), descentM: Math.max(0, row.descent_meters ?? 0) },
  };
}

// ── The watch key ──

/**
 * CorosLink's saved watch key (`coros.ble.loginAuth`, a `CorosBleLoginKey`, or the older per-watch
 * `coros.ble.accountAuth`) as the text C-LINK keeps sealed in watch/key.bin (engine/systemBind.ts WatchAccountKey).
 * The account ID passes 2^53, so it is written as a bare number straight from CorosLink's decimal text. Null when the
 * value isn't a key.
 */
export function watchKeyText(opened: string): string | null {
  let key: Record<string, unknown>;
  try { key = JSON.parse(opened) as Record<string, unknown>; } catch { return null; }
  if (!key || typeof key !== "object") return null;
  const id = typeof key.accountUserId === "string" ? key.accountUserId : typeof key.accountUserId === "number" ? String(key.accountUserId) : "";
  const der = key.privateKeyDer;
  if (!/^\d{1,20}$/.test(id) || typeof der !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(der)) return null;
  const unit = key.unit === 1 ? 1 : 0;
  const dataCollectSwitch = Number.isInteger(key.dataCollectSwitch) ? (key.dataCollectSwitch as number) : 0;
  const deviceName = typeof key.deviceName === "string" ? key.deviceName : null;
  return `{"accountUserId":${BigInt(id).toString()},"unit":${unit},"dataCollectSwitch":${dataCollectSwitch},"deviceName":${JSON.stringify(deviceName)},"privateKeyDER":${JSON.stringify(der)}}`;
}

/** "ru•••@example.com", as C-LINK shows the account a key came from. */
export function maskEmail(email: unknown): string | null {
  const m = typeof email === "string" ? /^([^@\s]+)@([^@\s]+)$/.exec(email.trim()) : null;
  return m ? `${m[1].slice(0, m[1].length > 2 ? 2 : 1)}•••@${m[2]}` : null;
}

export interface PairedWatch { name: string; display: string; model?: string }

/**
 * The watch CorosLink last trusted, as C-LINK pairs it: by its advertised name ("COROS PACE Pro 2F1A6C"). From the
 * pinned identity (`coros.ble.watchIdentity`), then the last system-Bluetooth watch (`coros.ble.systemDevice`), then
 * the newest watch in `local_devices`.
 */
export function pairedWatch(identity: string | null, systemDevice: string | null, device: { name: string | null; model: string | null } | null): PairedWatch | null {
  const parse = (text: string | null): Record<string, unknown> => { try { const v = JSON.parse(text ?? "{}") as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; } };
  const pinned = parse(identity).system as Record<string, unknown> | undefined;
  const options: { name?: unknown; model?: unknown }[] = [
    { name: pinned?.deviceName, model: pinned?.model },
    { name: parse(systemDevice).deviceName },
    { name: device?.name, model: device?.model },
  ];
  for (const o of options) {
    if (typeof o.name !== "string" || !/^COROS \S/.test(o.name) || o.name.length > 64) continue;
    const display = o.name.replace(/^COROS\s+/, "").replace(/\s+[A-F0-9]{6}$/i, "");
    const model = typeof o.model === "string" && o.model ? o.model : options.find((x) => x.name === o.name && typeof x.model === "string")?.model;
    return { name: o.name, display, ...(typeof model === "string" ? { model } : {}) };
  }
  return null;
}

// ── The workout journal ──

/** A row of `workout_journal`: the athlete's brief before a planned workout and debrief after. */
export interface JournalRow { entry_id: string; happen_day: string | null; workout_name: string | null; brief_json: string | null; updated_at: string }

/**
 * Briefs as `coach.brief` items (goal, cues, fuel). Debriefs (feel after the workout, cue and fuelling outcomes, notes)
 * have no place in C-LINK: C-LINK's `feel.check` is the morning check, not a workout's feel. They are kept with the
 * rest of CorosLink's journal (move.ts, the kept folder).
 */
export function journalChanges(rows: readonly JournalRow[]): Change[] {
  const out: Change[] = [];
  for (const row of rows) {
    const key = dayKey(row.happen_day ?? "");
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(row.entry_id)) continue;
    let brief: { goal?: unknown; cues?: unknown; fuelPlan?: unknown; updatedAt?: unknown } = {};
    try { brief = JSON.parse(row.brief_json ?? "{}") ?? {}; } catch { /* none */ }
    const cues = Array.isArray(brief.cues) ? brief.cues.map((c) => (c as { text?: unknown })?.text).filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()) : [];
    const goal = typeof brief.goal === "string" ? brief.goal.trim() : "";
    const fuel = typeof brief.fuelPlan === "string" ? brief.fuelPlan.trim() : "";
    if (goal || cues.length || fuel) {
      out.push({ collection: "coach.brief", id: `coroslink.${row.entry_id}`, body: { title: row.workout_name?.trim() || "Workout", ...(key ? { day: key } : {}), goal, cues, fuel, at: refOf(row.updated_at) } satisfies CoachBriefBody });
    }
  }
  return out;
}
