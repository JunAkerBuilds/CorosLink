// The bodies of synced items, as docs/sync-contract.md defines them. "Native" bodies are exactly what the
// phone's Codable models write (CorosKit: FoodLog.swift, FuelTargets.swift, GymLog.swift, TrainingInsights.swift,
// BodyGoal.swift). Every optional field may be missing: the phone leaves out what it cannot fill.

/** Seconds since 2001-01-01T00:00:00Z, as Swift's default JSONEncoder writes a Date. */
export type RefDate = number;
export const REF_EPOCH_UNIX = 978_307_200;

export const refToMs = (ref: RefDate): number => (ref + REF_EPOCH_UNIX) * 1000;
export const refToDate = (ref: RefDate): Date => new Date(refToMs(ref));
export const msToRef = (ms: number): RefDate => ms / 1000 - REF_EPOCH_UNIX;
export const dateToRef = (date: Date): RefDate => msToRef(date.getTime());

export interface CalendarDay { year: number; month: number; day: number }

/** `YYYY-MM-DD` of a CalendarDay. */
export const calendarDayKey = (d: CalendarDay): string =>
  `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function calendarDayOf(key: string): CalendarDay {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** An uppercase UUID, as the phones write ids. */
export function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().toUpperCase();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`.toUpperCase();
}

/* ───────────── Fuel ───────────── */

/** `Nutrition`. The five after `fatG` are missing in logs saved before they were counted (read as 0). */
export interface NativeNutrition {
  kcal: number; proteinG: number; carbsG: number; fatG: number;
  fiberG?: number; sugarG?: number; saturatedFatG?: number; sodiumMg?: number; cholesterolMg?: number;
}

/** `FoodItem`. `id` is "usda:…", "off:…", "custom:<uuid>", "quick:<uuid>" or "estimate:<uuid>". */
export interface NativeFoodItem {
  id: string;
  name: string;
  brand?: string;
  barcode?: string;
  /** Per 100 g, or per 100 ml when `liquid`. */
  per100g: NativeNutrition;
  servings: { label: string; grams: number }[];
  /** Measured in ml. Left out (not false) for grams. */
  liquid?: boolean;
}

export type NativeMeal = "breakfast" | "lunch" | "dinner" | "snack";
export type NativeFoodSource = "search" | "barcode" | "manual" | "estimate";

/** `FoodEntry`. `grams` is ml for a liquid item. `version` is bumped on each edit. */
export interface NativeFoodEntry {
  id: string;
  time: RefDate;
  meal: NativeMeal;
  item: NativeFoodItem;
  grams: number;
  source: NativeFoodSource;
  version: number;
}

export type NativeFuelGoal = "lose" | "maintain" | "gain" | "custom";
export type NativeFuelSex = "male" | "female" | "unspecified";
export type NativeMacroUnit = "grams" | "perKg" | "percent" | "per1000Kcal";
export interface NativeMacroTarget { unit: NativeMacroUnit; value: number }
export interface NativeFuelMacros { protein?: NativeMacroTarget; carbs?: NativeMacroTarget; fat?: NativeMacroTarget; fiber?: NativeMacroTarget }

/** `FuelProfile`. */
export interface NativeFuelProfile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: NativeFuelSex;
  goal: NativeFuelGoal;
  customKcal?: number;
  usesWeighIns?: boolean;
  macros?: NativeFuelMacros;
}

/* ───────────── Gym ───────────── */

export type NativeGymSetKind = "normal" | "warmUp" | "drop" | "failure" | "restPause" | "cluster";

/** `GymSet`. Done when `doneAt` is there. */
export interface NativeGymSet {
  id: string;
  kind: NativeGymSetKind;
  weightKg?: number;
  reps?: number;
  seconds?: number;
  rpe?: number;
  doneAt?: RefDate;
}

/** `GymEntry`: one exercise with its sets. `progression` and `suggestion` are passed through untouched. */
export interface NativeGymEntry {
  id: string;
  exerciseID: string;
  note?: string;
  superset?: number;
  restSeconds?: number;
  sets?: NativeGymSet[];
  progression?: unknown;
  suggestion?: unknown;
}

/** `GymWorkout` (finished ones only). */
export interface NativeGymWorkout {
  id: string;
  name?: string;
  start: RefDate;
  end?: RefDate;
  note?: string;
  entries?: NativeGymEntry[];
  routineID?: string;
  editedAt?: RefDate;
  suggested?: boolean;
}

/** `GymRoutine`. */
export interface NativeGymRoutine {
  id: string;
  name?: string;
  folder?: string;
  note?: string;
  entries?: NativeGymEntry[];
  updated?: RefDate;
}

/** `GymPlanned`: a routine put on a day of C-LINK's calendar. */
export interface NativeGymPlanned { id: string; routineID: string; day: CalendarDay }

/* ───────────── Activities and health ───────────── */

export type NativeSport =
  | "run" | "indoorRun" | "trailRun" | "track" | "walk" | "hike" | "bike" | "indoorBike" | "poolSwim" | "openWater"
  | "strength" | "cardio" | "ski" | "row" | "multisport" | "other";

/** `TrainingInsights.ActivitySummary`. */
export interface NativeActivity {
  id: string;
  name: string;
  sport: NativeSport;
  /** COROS's sport type code, such as 100 for an outdoor run. */
  sportCode?: number;
  start?: RefDate;
  distanceMeters?: number;
  durationSeconds?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
  /** Steps per minute. */
  averageCadence?: number;
  averagePower?: number;
}

/** Contract 5.1. Streams run along `x`; one that was not recorded is left out. */
export interface ActivityDetailBody {
  laps?: { n: number; distanceM?: number; durationS: number; avgHr?: number; maxHr?: number; cadence?: number; elevationM?: number; name?: string }[];
  steps?: { n: number; distanceM?: number; durationS: number; avgHr?: number; maxHr?: number; cadence?: number; elevationM?: number; name?: string }[];
  streams?: { axis: "distance" | "time"; x: number[]; speedMps?: number[]; hr?: number[]; elevationM?: number[]; cadence?: number[]; powerW?: number[] };
  /** `[latitude, longitude]` pairs. */
  route?: [number, number][];
  zones?: { zone: number; fromBpm: number | null; toBpm: number | null; seconds: number }[];
}

/** `TrainingInsights.DayVitals`, without values that came from Apple Health / Health Connect. */
export interface NativeDayVitals {
  day: CalendarDay;
  steps?: number;
  /** kcal for the whole day. */
  calories?: number;
  restingHR?: number;
  averageHR?: number;
  hrv?: number;
  sleepMinutes?: number;
  sleepScore?: number;
  stress?: number;
  trainingLoad?: number;
  exerciseMinutes?: number;
  acuteLoad?: number;
  chronicLoad?: number;
  loadRatio?: number;
  loadComment?: string;
}

export type NativeSleepStage = "awake" | "light" | "deep" | "rem";
export interface NativeSleepSpan { start: RefDate; end: RefDate; stage: NativeSleepStage }

/** `TrainingInsights.SleepNight`. `day` is the day the night ended. */
export interface NativeSleepNight {
  day: CalendarDay;
  totalMinutes?: number;
  score?: number;
  deepMinutes?: number;
  lightMinutes?: number;
  remMinutes?: number;
  awakeMinutes?: number;
  bedtime?: RefDate;
  wakeTime?: RefDate;
  averageHR?: number;
  napMinutes?: number;
  details?: { label: string; value: string }[];
  /** Each stage in order, bedtime to wake time. Only the watch's own records have it. */
  stages?: NativeSleepSpan[];
  nightScore?: number;
  naps?: { start: RefDate; end: RefDate; asleepMinutes: number; points?: number }[];
  stress?: { start: RefDate; readings: number[] };
}

/** Contract 5.2. Minutes are after local midnight of the day (negative = the evening before). */
export interface EnergyDayBody {
  points?: { minute: number; level: number }[];
  events?: { kind: "sleep" | "rest" | "workout" | "stress" | "awake"; startMinute: number; endMinute: number; change?: number; sleepScore?: number; workoutName?: string; averageStress?: number }[];
  bedtime?: { minute: number; level: number };
  woke?: { minute: number; level: number };
  now?: { minute: number; level: number };
  trend?: "charging" | "steady" | "usingSlowly" | "usingFast";
  projection?: { minute: number; level: number }[];
  learning?: boolean;
}

/* ───────────── Watch ───────────── */

export interface WatchAlarmBody { slot?: number; enabled: boolean; hour: number; minute: number; days: number[] }
export type WatchGpsMode = "standard" | "all" | "dual";

/** Contract 5.3. */
export interface WatchStateBody {
  name?: string;
  model?: string;
  firmware?: string;
  syncedAt?: RefDate;
  battery?: { percent: number; readAt?: RefDate };
  storage?: { usedBytes: number; totalBytes: number };
  goals?: { calories?: number; exerciseMinutes?: number; steps?: number };
  today?: { calories?: number; exerciseMinutes?: number; steps?: number };
  alarms?: WatchAlarmBody[];
  alarmsReadAt?: RefDate;
  gpsMode?: WatchGpsMode;
  /** The watch's sleep schedule (Sleep Mode), minutes after midnight. */
  sleepSchedule?: { bedtime: number; wake: number };
  gpsModes?: WatchGpsMode[];
  batteryHistory?: { at: RefDate; percent: number }[];
  refused?: { key: string; at: RefDate }[];
  /** Not in the phone's body: "computer" when the desktop wrote it, syncing with the watch itself (Local mode). */
  via?: "computer";
}

export type WatchChangeKey = "goal.calories" | "goal.exerciseMinutes" | "goal.steps" | "gpsMode" | "alarms";

/** Contract 5.4. The item's id is the setting key. */
export interface WatchChangeBody { value: number | WatchGpsMode | WatchAlarmBody[]; at: RefDate; from: "web" }

/* ───────────── Views the phone computes ───────────── */

/** Contract 5.5. */
export interface ViewTrainingBody {
  fitness?: { start: string; fitness: number[]; fatigue: number[] };
  load?: { acute?: number; chronic?: number; ratio?: number; status?: string; weekTotal?: number };
  vo2max?: number;
  thresholdPaceSecPerKm?: number;
  thresholdHr?: number;
  maxHr?: number;
  ftp?: number;
  predictions?: { name: string; meters: number; seconds: number }[];
  bests?: { name: string; meters: number; seconds: number; at?: RefDate; sport?: string; activityId?: string }[];
  weeklyGoalMinutes?: number;
  readiness?: { score: number; status?: string };
  /** The heart rate zones set on the watch. `basis` says what they are worked out from. An open end is null. */
  hrZones?: { basis?: "maxHr" | "reserve" | "threshold"; zones: { zone: number; fromBpm: number | null; toBpm: number | null }[] };
  /** The races the athlete is training for (C-LINK's own goal races; COROS has none). `day` is YYYY-MM-DD. */
  goalRaces?: { name: string; day: string; distanceMeters?: number; goalSeconds?: number }[];
  computedAt?: RefDate;
}

/** Contract 5.6. */
export interface ViewStrengthBody {
  muscles?: { name: string; fatigue: number; readyAt?: RefDate; lastTrainedAt?: RefDate; state?: "ready" | "recovering" | "overdue" }[];
  suggestion?: { title: string; exercises?: { name: string; sets?: number; reps?: number; weightKg?: number }[] };
  exerciseNames?: Record<string, string>;
  computedAt?: RefDate;
}

/** Contract 5.7. */
export interface ViewBodyBody {
  bodyAge?: { value: number; at?: RefDate };
  restingKcal?: number;
  weightKg?: number;
  weightAt?: RefDate;
  weightSource?: string;
  computedAt?: RefDate;
}

/** `BodyGoal`, in the `body.goals` map keyed by BodyMetric ("weight", "bodyFat"). */
export interface NativeBodyGoal { target: number; start: number; startDate: RefDate; byDate?: RefDate }
export interface BodyGoalsBody { goals: Partial<Record<"weight" | "bodyFat", NativeBodyGoal>> & Record<string, NativeBodyGoal | undefined> }

/** Typed on the web; phones ignore it. */
export interface BodyMeasurementBody { day: string; weightKg: number; bodyFatPct?: number }

/* ───────────── Body Alert and Illness mode ───────────── */

export type BodyAlertState = "learning" | "normal" | "watch" | "strain" | "strainHigh" | "recovering";
export type BodyAlertNightClass = "noData" | "statusOnly" | "normal" | "deviating" | "strong";
export type BodyAlertSignalName = "heart" | "hrv" | "breathing";

/** One signal of one night: `usual` is the baseline plus what training explains; HRV's channels are ln ms. */
export interface BodyAlertSignalBody {
  signal: BodyAlertSignalName;
  channel: "sleepHR" | "restingHR" | "lnRMSSD" | "dailyHRV" | "breathing" | string;
  value: number;
  usual: number;
  spread: number;
  z: number;
}

/** Body Alert as the phone works it out (StrainWatch), the last 28 nights oldest first. Phone only. */
export interface BodyAlertBody {
  on: boolean;
  state: BodyAlertState;
  nightsLearned: number;
  updatedAt?: RefDate;
  nights: { day: CalendarDay; state: BodyAlertState; nightClass: BodyAlertNightClass; level: number; signals: BodyAlertSignalBody[] }[];
}

/** Illness mode: spells the person said they were unwell. Phone and web both write it. */
/** CorosKit `FeelCheck`: the day, 1 (awful) … 5 (great), and tags from sore, stressed, unwell, heavyLegs, sorted. */
export interface FeelCheckBody { day: CalendarDay; feel: number; tags: string[] }

export interface BodyIllnessBody { spells: { start: RefDate; end?: RefDate }[]; confirmedAt?: RefDate }

/* ───────────── Coach on the web ───────────── */

/** A Coach conversation held on the web. Phones ignore the `coach.*` collections. */
export interface CoachConversationBody {
  title: string;
  startedAt: RefDate;
  updatedAt: RefDate;
  suggestions?: string[];
  sources?: { title: string; detail: string; href: string }[];
}

/** One message of a conversation; the item's id is `<conversation id>.<number>`. `message` is a `CoachMessage`. */
export interface CoachMessageBody { conversationId: string; n: number; at: RefDate; message: unknown }

/** A brief Coach wrote for a planned workout, saved when the athlete says so. */
export interface CoachBriefBody { title: string; day?: string; goal: string; cues: string[]; fuel: string; at: RefDate }

/** Something the athlete told Coach to keep in mind. */
export interface CoachMemoryBody { text: string; at: RefDate }

/** Every collection and its body. */
export interface SyncBodies {
  "fuel.entry": NativeFoodEntry;
  "fuel.food": NativeFoodItem;
  "fuel.profile": NativeFuelProfile;
  "gym.workout": NativeGymWorkout;
  "gym.routine": NativeGymRoutine;
  "gym.planned": NativeGymPlanned;
  "gym.meta": { folders?: string[]; customExercises?: unknown[] };
  "body.goals": BodyGoalsBody;
  "body.measurement": BodyMeasurementBody;
  "body.alert": BodyAlertBody;
  "body.illness": BodyIllnessBody;
  "feel.check": FeelCheckBody;
  "activity": NativeActivity;
  "activity.detail": ActivityDetailBody;
  "health.day": NativeDayVitals;
  "health.night": NativeSleepNight;
  "energy.day": EnergyDayBody;
  "watch.state": WatchStateBody;
  "watch.change": WatchChangeBody;
  "view.training": ViewTrainingBody;
  "view.strength": ViewStrengthBody;
  "view.body": ViewBodyBody;
  "coach.conversation": CoachConversationBody;
  "coach.message": CoachMessageBody;
  "coach.brief": CoachBriefBody;
  "coach.memory": CoachMemoryBody;
  /** What C-LINK wrote about a workout (section 5.10). Written by the server's summary endpoint or a phone. */
  "ai.note": import("@/lib/ai/workoutNote").NoteBody;
  /**
   * The athlete's own training plans, calendar workouts and kept workouts, made on this computer (src/data/local).
   * The sync contract has no collections for these yet, so phones ignore them; they're in the store so they're kept,
   * backed up and ready for the phone once it reads them (docs/coroslink-move.md).
   */
  "training.plan": import("@/lib/plan").TrainingPlanDocument;
  "training.workout": import("@/data/workouts").SavedWorkout;
  "training.library": import("@/data/workouts").Workout;
}

export type Collection = keyof SyncBodies;

/** Collections the web writes (contract section 4). Everything else is read-only here. */
export const WEB_WRITES: readonly Collection[] = ["fuel.entry", "fuel.food", "fuel.profile", "gym.planned", "body.goals", "body.measurement", "body.illness", "feel.check", "watch.change", "coach.conversation", "coach.message", "coach.brief", "coach.memory", "training.plan", "training.workout", "training.library"];
