import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The Coach's athlete tools (memory, context, races, compliance, moves,
// weather, strength history, zones) against the compiled dist-electron build,
// with every service faked through the tools' dependency object.

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(`${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`);

const {
  CHAT_ATHLETE_TOOL_NAMES,
  claudeCanUseAthleteTool,
  compactDay,
  getChatAthleteTools,
  handleChatAthleteTool,
  isChatAthleteTool,
  parseClock
} = await load("chatAthleteTools.js");
const {
  MAX_ATHLETE_FACTS,
  formatAthleteMemoryForCoach,
  normalizeAthleteFactText,
  planAthleteFactWrite
} = await load("athleteMemoryModel.js");
const { buildPlanCompliance } = await load("planCompliance.js");
const { aqiCategory, dewPointC, heatPaceAdjustment, summarizeForecastDay } = await load("coachWeather.js");
const { buildStrengthProgress, estimateOneRepMaxKg } = await load("strengthProgress.js");
const { CoachReviewNotSentError, createCoachReviewService } = await load("coachReviewActions.js");
const { buildCoachDataStatus, formatDataStatusForContext } = await load("coachDataStatus.js");
const { buildAthleteToolGuide } = await load("chatCoachContext.js");
const { chatEntryKey, fromPersistedEntries, toPersistedEntries, toWireMessages } = await load("chatTranscript.js");

const NOW = "2026-10-22T08:00:00.000Z";

// ----- Memory model -----
assert.equal(normalizeAthleteFactText("  Left calf\nstrain   since Monday\t"), "Left calf strain since Monday");
assert.equal(normalizeAthleteFactText("x".repeat(400)).length, 280);
let ids = 0;
const newId = () => `f${++ids}`;
const remembered = planAthleteFactWrite([], { category: "injury", text: "Left calf strain since 2026-10-18" }, "coach", NOW, newId);
assert.equal(remembered.action, "remembered");
assert.deepEqual(remembered.fact, { id: "f1", category: "injury", text: "Left calf strain since 2026-10-18", author: "coach", createdAt: NOW, updatedAt: NOW });
const facts = [remembered.fact];
assert.equal(planAthleteFactWrite(facts, { category: "injury", text: "left calf strain since 2026-10-18" }, "coach", NOW, newId).action, "unchanged", "the same words are kept once");
assert.equal(planAthleteFactWrite(facts, { category: "bogus", text: "Has a turbo trainer" }, "coach", NOW, newId).fact.category, "other");
const updated = planAthleteFactWrite(facts, { id: "f1", category: "injury", text: "Calf strain healed; running normally" }, "athlete", "2026-10-25T08:00:00.000Z", newId);
assert.equal(updated.action, "updated");
assert.equal(updated.previous.text, "Left calf strain since 2026-10-18");
assert.equal(updated.fact.author, "athlete");
assert.equal(updated.fact.createdAt, NOW);
assert.throws(() => planAthleteFactWrite(facts, { id: "gone", category: "goal", text: "x" }, "coach", NOW, newId), /no longer saved/);
assert.throws(() => planAthleteFactWrite(facts, { category: "goal", text: " " }, "coach", NOW, newId), /one short sentence/);
const full = Array.from({ length: MAX_ATHLETE_FACTS }, (_, index) => ({ ...remembered.fact, id: `f${index}`, text: `Fact ${index}` }));
assert.throws(() => planAthleteFactWrite(full, { category: "goal", text: "One more" }, "coach", NOW, newId), /memory is full/);
assert.match(formatAthleteMemoryForCoach([{ ...remembered.fact, id: "fz", category: "goal", text: "Valencia Marathon, sub-3:15" }, remembered.fact]),
  /^- \[fz\] Goal: Valencia Marathon, sub-3:15 \(noted 2026-10-22\)\n- \[f1\] Injury or niggle: Left calf strain/);

// ----- Tool definitions and Claude's switches -----
assert.equal(CHAT_ATHLETE_TOOL_NAMES.length, 9);
assert.ok(CHAT_ATHLETE_TOOL_NAMES.every(isChatAthleteTool));
assert.equal(isChatAthleteTool("get_activity_detail"), false);
const allTools = getChatAthleteTools({ trainingData: true });
assert.deepEqual(allTools.map((tool) => tool.name).sort(), [...CHAT_ATHLETE_TOOL_NAMES].sort());
assert.deepEqual(getChatAthleteTools({ trainingData: false }).map((tool) => tool.name),
  ["get_athlete_context", "remember_athlete_fact", "forget_athlete_fact", "get_weather_forecast"],
  "signed out: memory and weather still work");
for (const tool of allTools) {
  assert.equal(tool.inputSchema.type, "object", tool.name);
  assert.ok(tool.description.length > 60, tool.name);
}
for (const write of ["add_target_race", "propose_zone_update"]) {
  assert.ok(allTools.find((tool) => tool.name === write).inputSchema.required.includes("review_summary"), write);
}
const none = { recentActivities: false, trainingMetrics: false, upcomingWorkouts: false, sleepData: false, fullActivityFiles: false };
assert.deepEqual(CHAT_ATHLETE_TOOL_NAMES.filter((name) => claudeCanUseAthleteTool(name, none)),
  ["get_athlete_context", "remember_athlete_fact", "forget_athlete_fact", "get_weather_forecast"]);
assert.equal(claudeCanUseAthleteTool("get_plan_compliance", { ...none, recentActivities: true }), false, "compliance needs activities and the calendar");
assert.equal(claudeCanUseAthleteTool("get_plan_compliance", { ...none, recentActivities: true, upcomingWorkouts: true }), true);
assert.equal(claudeCanUseAthleteTool("propose_zone_update", { ...none, trainingMetrics: true }), true);
assert.equal(claudeCanUseAthleteTool("list_races", { ...none, recentActivities: true }), true);

assert.equal(compactDay("2026-10-22"), "20261022");
assert.equal(compactDay("20260230"), undefined);
assert.equal(parseClock("3:15:00"), 11700);
assert.equal(parseClock("19:30"), 1170);
assert.equal(parseClock("3:61"), undefined);

// ----- Handlers, with faked services -----
function harness(overrides = {}) {
  const calls = { memory: [], reviews: [], notices: [] };
  let memory = [];
  let facts = 0;
  const watchCurrent = { maxHr: 190, restingHr: 48, thresholdHr: 172, hrZoneType: 3, thresholdPaceSecondsPerKm: 255 };
  const deps = {
    unitSystem: "metric",
    today: () => "20261022",
    allowed: { zones: true, races: true },
    claude: false,
    memory: {
      list: () => memory,
      save: (input) => {
        const change = planAthleteFactWrite(memory, input, "coach", NOW, () => `fx${++facts}`);
        if (change.action !== "unchanged") memory = [...memory.filter((fact) => fact.id !== change.fact.id), change.fact];
        return change;
      },
      remove: (id) => {
        const fact = memory.find((candidate) => candidate.id === id);
        if (!fact) return undefined;
        memory = memory.filter((candidate) => candidate.id !== id);
        return { action: "forgot", fact, previous: fact };
      }
    },
    onMemoryChange: (change) => calls.notices.push(change),
    races: {
      overview: () => ({
        races: [
          { raceId: "r1", source: "coros", name: "Autumn 10K", startTime: Date.UTC(2026, 8, 6) / 1000, distanceKey: "10k", distanceIsManual: false, officialDistance: 10000, officialTime: 2580, officialTimeIsManual: false, avgHr: 176, buildUp: { weeks: 8, runs: 30, distance: 280000, longestRun: 21000, complete: true } },
          { raceId: "r2", source: "manual", name: "Spring 10K", startTime: Date.UTC(2026, 3, 12) / 1000, distanceKey: "10k", distanceIsManual: true, officialDistance: 10000, officialTime: 2650, officialTimeIsManual: true }
        ],
        suggestions: [],
        strava: { connected: false, hiddenRaces: 0 },
        targets: [
          { targetId: "t-old", name: "Old Half", raceDay: "20261001", distanceKey: "half", distance: 21097.5, createdAt: NOW },
          { targetId: "t1", name: "Valencia Marathon", raceDay: "20261207", distanceKey: "marathon", distance: 42195, goalTime: 11700, priority: "A", createdAt: NOW }
        ]
      }),
      normalizeTarget: (input) => {
        if (!/^\d{8}$/.test(input.raceDay) || input.raceDay < "20261022") throw new Error("A target race is in the future. Add a finished race as a result instead.");
        return { name: input.name.trim(), raceDay: input.raceDay, distanceKey: input.distanceKey, distance: input.distanceKey === "half" ? 21097.5 : input.distance ?? 42195, ...(input.goalTime ? { goalTime: input.goalTime } : {}), ...(input.priority ? { priority: input.priority } : {}) };
      }
    },
    zones: async () => ({
      source: "watch",
      read_at: NOW,
      thresholds: { max_hr: 190, resting_hr: 48, threshold_hr: 172, threshold_pace: "4:15 /km" },
      body_weight: "not available to CorosLink",
      update: { possible: false, editable: ["max_hr"], reason: "The watch isn't connected over Bluetooth right now." },
      current: watchCurrent
    }),
    dataStatus: async () => ({ data_mode: "connected", guidance: "Connected Mode", recent_sync_errors: [] }),
    compliance: async (start, end) => ({ range: { start_date: start, end_date: end }, workouts: [], unlinked_activities: [], summary: { planned: 0 } }),
    weather: async (day, place) => ({ place: place ?? "Lisbon", date: day, units: "metric" }),
    strength: async (days) => ({ days, sessions: 0, sources: [], exercises: [], muscles: [], unmapped_sets: 0 }),
    stageReview: (draft) => {
      calls.reviews.push(draft);
      return { requestId: `rv${calls.reviews.length}`, action: draft.action, title: draft.title, summary: draft.summary, items: draft.items, notes: draft.notes, createdAt: 1, state: "pending" };
    },
    onReview: () => {},
    ...overrides
  };
  const run = async (name, args = {}) => JSON.parse(await handleChatAthleteTool(name, args, deps));
  return { deps, calls, run, memory: () => memory };
}

{
  const { run, calls, memory } = harness();
  const saved = await run("remember_athlete_fact", { category: "availability", fact: "Can train Tue, Thu, Sat and Sun; Sunday long run up to 2.5 h." });
  assert.equal(saved.saved, "remembered");
  assert.equal(calls.notices.length, 1, "each write reaches the transcript");
  const again = await run("remember_athlete_fact", { category: "availability", fact: "can train tue, thu, sat and sun; sunday long run up to 2.5 h." });
  assert.equal(again.saved, false);
  assert.equal(calls.notices.length, 1, "an unchanged fact is not announced");
  const replaced = await run("remember_athlete_fact", { category: "availability", fact: "Now trains Mon, Wed, Sat.", replaces_fact_id: saved.fact.id });
  assert.equal(replaced.saved, "updated");
  assert.equal(memory().length, 1);
  const missing = await run("forget_athlete_fact", { fact_id: "nope" });
  assert.equal(missing.error_code, "fact_not_found");
  const forgot = await run("forget_athlete_fact", { fact_id: saved.fact.id });
  assert.equal(forgot.ok, true);
  assert.equal(memory().length, 0);
  assert.equal(calls.notices.at(-1).action, "forgot");
}

{
  // The bundle: memory, zones without the canonical values, races, freshness; Claude's switches hide parts.
  const { run } = harness();
  const context = await run("get_athlete_context");
  assert.match(context.memory, /Nothing saved yet/);
  assert.equal(context.zones.current, undefined, "canonical values stay internal");
  assert.equal(context.zones.thresholds.threshold_hr, 172);
  assert.deepEqual(context.races.targets.map((target) => target.name), ["Valencia Marathon"], "past targets drop out");
  assert.equal(context.races.targets[0].days_to_go, 46);
  assert.equal(context.races.targets[0].goal_time, "3:15:00");
  assert.equal(context.races.targets[0].goal_pace, "4:37 /km");
  assert.equal(context.data_status.data_mode, "connected");
  const hidden = await harness({ allowed: { zones: false, races: false } }).run("get_athlete_context");
  assert.equal(hidden.zones, undefined);
  assert.equal(hidden.races, undefined);
  assert.equal(hidden.not_shared.length, 2);
  const only = await run("get_athlete_context", { sections: ["data_status"] });
  assert.deepEqual(Object.keys(only).sort(), ["data_status", "ok"]);
}

{
  const { run } = harness();
  const races = await run("list_races");
  assert.equal(races.results.length, 2);
  assert.deepEqual(races.best_times, [{ distance: "10K", time: "43:00", date: "2026-09-06", name: "Autumn 10K" }]);
  assert.match(races.results[0].build_up, /30 runs, 280\.0 km in 8 weeks, longest 21\.0 km/);
  assert.deepEqual(Object.keys(await run("list_races", { include: "targets" })).sort(), ["ok", "targets"]);
}

{
  const { run, calls } = harness();
  const bad = await run("add_target_race", { name: "Lisbon Half", date: "20261115", distance: "half", goal_time: "1:3", review_summary: "Add it." });
  assert.equal(bad.error_code, "invalid_goal_time");
  const past = await run("add_target_race", { name: "Lisbon Half", date: "20261001", distance: "half", review_summary: "Add it." });
  assert.match(past.error, /in the future/);
  const duplicate = await run("add_target_race", { name: "valencia marathon", date: "20261207", distance: "marathon", review_summary: "Add it." });
  assert.equal(duplicate.error_code, "already_saved");
  const staged = await run("add_target_race", { name: "Lisbon Half", date: "20261115", distance: "half", goal_time: "1:32:00", priority: "B", review_summary: "Your tune-up before Valencia." });
  assert.equal(staged.status, "awaiting_confirmation");
  assert.equal(calls.reviews.length, 1);
  assert.equal(calls.reviews[0].action, "addTargetRace");
  assert.deepEqual(calls.reviews[0].items.map((item) => item.label), ["Race", "Date", "Distance", "Goal", "Priority"]);
  assert.match(calls.reviews[0].items[3].after, /^1:32:00 · 4:22 \/km$/);
  assert.equal(calls.reviews[0].payload.raceDay, "20261115");
}

{
  const { run } = harness();
  assert.equal((await run("get_plan_compliance", { start_date: "20261030", end_date: "20261020" })).error_code, "invalid_range");
  assert.equal((await run("get_plan_compliance", { start_date: "20260101", end_date: "20261020" })).error_code, "range_too_long");
  const defaults = await run("get_plan_compliance");
  assert.deepEqual(defaults.range, { start_date: "20261008", end_date: "20261029" });
  assert.equal((await run("get_weather_forecast", { date: "20261021" })).error_code, "past_date");
  assert.equal((await run("get_weather_forecast", { date: "20261120" })).error_code, "too_far");
  assert.equal((await run("get_weather_forecast", { place: "Valencia" })).place, "Valencia");
  assert.match((await run("get_strength_history", { days: 3 })).note, /No strength sessions/);
}

{
  const { run, calls } = harness();
  assert.equal((await run("propose_zone_update", { threshold_hr: 172, review_summary: "x" })).error_code, "no_change");
  assert.equal((await run("propose_zone_update", { threshold_hr: 195, review_summary: "x" })).error_code, "invalid_order");
  const staged = await run("propose_zone_update", { threshold_hr: 175, threshold_pace_seconds_per_km: 250, hr_zone_basis: "threshold_hr", review_summary: "Your last two 30-minute tests averaged 175 bpm." });
  assert.equal(staged.status, "awaiting_confirmation");
  const draft = calls.reviews.at(-1);
  assert.deepEqual(draft.items.map((item) => [item.label, item.before, item.after]), [
    ["Threshold heart rate", "172 bpm", "175 bpm"],
    ["Threshold pace", "4:15 /km", "4:10 /km"]
  ], "an unchanged zone basis is left out");
  assert.deepEqual(draft.payload.edits, { thresholdHr: 175, thresholdPaceSecondsPerKm: 250 });
  assert.ok(draft.notes.some((note) => /Connect it over Bluetooth before clicking Update watch/.test(note)));
  const unsupported = harness({ zones: async () => ({ source: "watch", thresholds: {}, body_weight: "", current: { maxHr: 190, restingHr: 48, thresholdHr: 172, hrZoneType: 3, thresholdPaceSecondsPerKm: 255 }, update: { possible: false, editable: [], reason: "CorosLink can't change zones on this watch model yet." } }) });
  assert.equal((await unsupported.run("propose_zone_update", { max_hr: 191, review_summary: "x" })).error_code, "unsupported_watch");
  const noProfile = harness({ zones: async () => ({ source: "none", thresholds: {}, body_weight: "", update: { possible: false, editable: [], reason: "CorosLink hasn't read the watch's profile yet." } }) });
  assert.equal((await noProfile.run("propose_zone_update", { max_hr: 191, review_summary: "x" })).error_code, "no_watch_profile");
}

// ----- Plan compliance -----
{
  const at = (day, hour = 7) => new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), hour).getTime() / 1000;
  const scheduled = [
    { planId: "p", idInPlan: "1", planProgramId: "a", happenDay: "20261019", name: "Easy 8 km", sportType: 1, trainingLoad: 60, volume: "8.00km", corosActivity: { activityId: "a1", completeRate: 1 } },
    { planId: "p", idInPlan: "2", planProgramId: "b", happenDay: "20261020", name: "Intervals", sportType: 1, trainingLoad: 100 },
    { planId: "p", idInPlan: "3", planProgramId: "c", happenDay: "20261021", name: "Long run", sportType: 1, trainingLoad: 150, corosActivity: { activityId: "a3", completeRate: 1.4 } },
    { planId: "p", idInPlan: "4", planProgramId: "d", happenDay: "20261018", name: "Strength A", sportType: 4, trainingLoad: 40 },
    { planId: "p", idInPlan: "5", planProgramId: "e", happenDay: "20261017", name: "Recovery", sportType: 1, trainingLoad: 30 },
    { planId: "p", idInPlan: "6", planProgramId: "f", happenDay: "20261022", name: "Tempo", sportType: 1, trainingLoad: 90, rawProgram: { duration: 2700 } },
    { planId: "p", idInPlan: "7", planProgramId: "g", happenDay: "20261024", name: "Long run", sportType: 1, trainingLoad: 160 }
  ];
  const activities = [
    { activityId: "a1", sportType: 100, name: "Morning Run", startTime: at("20261019"), distance: 8100, duration: 2900, trainingLoad: 62 },
    { activityId: "a2", sportType: 100, name: "Track session", startTime: at("20261020", 18), distance: 9000, duration: 3000, trainingLoad: 50 },
    { activityId: "a3", sportType: 100, name: "Long Run", startTime: at("20261021"), distance: 30000, duration: 9600, trainingLoad: 210 },
    { activityId: "a4", sportType: 402, name: "Gym", startTime: at("20261018"), duration: 2400, trainingLoad: 25 }
  ];
  const report = buildPlanCompliance({
    scheduled, activities,
    manualLinks: [
      { planId: "p", idInPlan: "4", happenDay: "20261018", activityId: "a4" },
      { planId: "p", idInPlan: "5", happenDay: "20261017" }
    ],
    startDay: "20261017", endDay: "20261025", today: "20261022"
  });
  const status = Object.fromEntries(report.workouts.map((workout) => [workout.id_in_plan, workout.status]));
  assert.deepEqual(status, { 5: "skipped", 4: "partial", 1: "done", 2: "missed", 3: "over", 6: "today", 7: "upcoming" });
  const byId = Object.fromEntries(report.workouts.map((workout) => [workout.id_in_plan, workout]));
  assert.equal(byId[1].linked_by, "coros");
  assert.equal(byId[1].completion_pct, 100);
  assert.equal(byId[4].linked_by, "athlete");
  assert.equal(byId[4].completion_pct, 63);
  assert.equal(byId[3].completion_pct, 140);
  assert.equal(byId[6].planned.duration, "45:00");
  assert.equal(byId[1].activity.distance, "8.10 km");
  assert.deepEqual(report.unlinked_activities.map((activity) => [activity.date, activity.activity_id]), [["2026-10-20", "a2"]],
    "the same-day track session is listed, never counted");
  assert.deepEqual(report.summary, { planned: 7, done: 1, partial: 1, over: 1, missed: 1, skipped: 1, remaining: 2, completion_rate_pct: 60, planned_load: 380, completed_load: 297 });
}

// ----- Weather -----
assert.equal(Math.round(dewPointC(30, 70)), 24);
assert.equal(dewPointC(20, 0), undefined);
assert.equal(heatPaceAdjustment(95), "none");
assert.equal(heatPaceAdjustment(125), "1–2% slower");
assert.equal(heatPaceAdjustment(185), "hard running not advised");
assert.equal(aqiCategory(42), "good");
assert.equal(aqiCategory(120), "unhealthy for sensitive groups");
assert.equal(aqiCategory(320), "hazardous");
{
  // A UTC place, 24 hours of a warm humid day.
  const day0 = Date.UTC(2026, 9, 22) / 1000;
  const hourly = Array.from({ length: 48 }, (_, index) => {
    const hour = index % 24;
    const temperature = 18 + 10 * Math.cos(((hour - 15) / 24) * Math.PI * 2);
    return { time: day0 + index * 3600, weatherCode: 1, temperature, apparentTemperature: temperature + 1, humidity: 80, precipitationProbability: 10, windSpeedKmh: 12, uvIndex: hour > 9 && hour < 17 ? 6 : 0, usAqi: hour === 15 ? 130 : 40 };
  });
  const forecast = {
    latitude: 38.7, longitude: -9.1, utcOffsetSeconds: 0, airQuality: true,
    current: hourly[0], hourly,
    daily: [{ time: day0, date: "2026-10-22", weatherCode: 1, min: 12, max: 28, precipitationProbability: 20 }, { time: day0 + 86400 * 6, date: "2026-10-28", weatherCode: 61, min: 10, max: 17, precipitationProbability: 80 }]
  };
  const report = summarizeForecastDay(forecast, "20261022", "Lisbon");
  assert.equal(report.day.high, "28°C");
  assert.equal(report.hours.length, 17, "05:00 to 21:00");
  assert.equal(report.hours[0].time, "05:00");
  assert.match(report.hours[0].dew_point, /°C$/);
  assert.equal(report.coolest_window, "05:00–07:00");
  assert.equal(report.hottest_window, "14:00–16:00");
  assert.ok(report.heat.temperature_plus_dew_point_f > 100);
  assert.deepEqual(report.air_quality, { worst_us_aqi: 130, category: "unhealthy for sensitive groups" });
  const imperial = summarizeForecastDay(forecast, "20261022", "Lisbon", "imperial");
  assert.equal(imperial.day.high, "82°F");
  assert.match(imperial.hours[0].wind, /mph$/);
  const later = summarizeForecastDay(forecast, "20261028", "Lisbon");
  assert.equal(later.day.conditions, "rain");
  assert.equal(later.hours, undefined);
  assert.match(later.note, /within about 4 days/);
  assert.match(summarizeForecastDay(forecast, "20261103", "Lisbon").note, /doesn't reach this date/);
}

// ----- Strength history -----
assert.equal(estimateOneRepMaxKg(100, 1), 100);
assert.equal(Math.round(estimateOneRepMaxKg(100, 5) * 10) / 10, 116.7);
assert.equal(estimateOneRepMaxKg(100, 20), 0);
{
  const day = (offset) => Date.UTC(2026, 9, 1 + offset, 7) / 1000;
  const set = (reps, weightKg, type) => ({ reps, weightKg, workSec: 30, restSec: 90, calories: 5, ...(type ? { type } : {}) });
  const sessions = [
    { activityId: "c1", source: "coros", sportType: 402, startTime: day(0), detail: { summary: {}, exercises: [
      { nameKey: "T1061", sets: 4, totalReps: 20, entries: [set(10, 40, "warmup"), set(5, 100), set(5, 100), set(5, 100)] },
      { nameKey: "Custom Pallof", rawName: "Custom Pallof", sets: 2, totalReps: 20, entries: [set(10, 10), set(10, 10)] }
    ] } },
    { activityId: "h1", source: "hevy", sportType: 402, startTime: day(7), detail: { summary: {}, exercises: [
      { nameKey: "Squat (Barbell)", rawName: "Squat (Barbell)", primaryMuscleGroup: "quadriceps", sets: 3, totalReps: 15, entries: [set(5, 105), set(5, 105), set(5, 105, undefined)].map((entry, index) => index === 2 ? { ...entry, rpe: 8.5 } : entry) },
      { nameKey: "Push Up", rawName: "Push Up", sets: 2, totalReps: 40, entries: [set(20, 0), set(20, 0)] }
    ] } }
  ];
  const report = buildStrengthProgress(sessions, { days: 14 });
  assert.deepEqual(report.sources, ["coros", "hevy"]);
  const squat = report.exercises.find((exercise) => /squat/i.test(exercise.exercise));
  assert.ok(squat, "T1061 resolves to its catalogue name and merges with Hevy's barbell squat");
  assert.equal(squat.sessions, 2);
  assert.equal(squat.sets, 6, "warm-ups are left out");
  assert.equal(squat.best_set, "5 × 105 kg");
  assert.equal(squat.best_e1rm.value, "122.5 kg");
  assert.equal(squat.e1rm_change_pct, 5);
  assert.equal(squat.history.at(-1).avg_rpe, 8.5);
  assert.ok(squat.muscles.includes("Quads"));
  const pushUp = report.exercises.find((exercise) => exercise.exercise === "Push Up");
  assert.equal(pushUp.best_set, "20 reps");
  assert.equal(pushUp.best_e1rm, undefined, "bodyweight work has no e1RM");
  const quads = report.muscles.find((muscle) => muscle.muscle === "Quads");
  assert.equal(quads.sets, 6);
  assert.equal(quads.sets_per_week, 3);
  assert.equal(quads.weighted_sets, 1.8);
  assert.ok(report.unmapped_sets >= 0);
  const filtered = buildStrengthProgress(sessions, { days: 14, exercise: "push", unitSystem: "imperial" });
  assert.deepEqual(filtered.exercises.map((exercise) => exercise.exercise), ["Push Up"]);
  assert.equal(buildStrengthProgress(sessions, { days: 14, unitSystem: "imperial" }).exercises.find((exercise) => /squat/i.test(exercise.exercise)).best_set, "5 × 231.5 lb");
}

// ----- Review cards -----
{
  let saved;
  let allowed = true;
  let execute = async (_action, _payload, preview) => ({ results: preview.items.map(() => ({ ok: true })), message: "Updated." });
  const deps = { load: () => saved, save: (value) => { saved = value; }, canConfirm: () => allowed, execute: (...args) => execute(...args), now: () => 1_000 };
  const service = createCoachReviewService(deps);
  assert.throws(() => service.stage({ action: "updateZones", title: "Update watch zones", summary: " ", items: [{ label: "Max heart rate", after: "192 bpm" }], payload: {} }), /review_summary/);
  const draft = { action: "updateZones", title: "Update watch zones", summary: "Two threshold tests agree.", items: [{ label: "Threshold heart rate", before: "172 bpm", after: "175 bpm" }, { label: "Max heart rate", before: "190 bpm", after: "192 bpm" }], payload: { edits: {} } };
  const preview = service.stage(draft, true);
  assert.equal(preview.state, "pending");
  allowed = false;
  await assert.rejects(service.confirm(preview.requestId), /turned off in Coach settings/);
  allowed = true;
  execute = async () => { throw new CoachReviewNotSentError("Connect your watch over Bluetooth, then click Update watch again."); };
  await assert.rejects(service.confirm(preview.requestId), /Connect your watch/);
  assert.equal(service.get(preview.requestId).state, "pending", "nothing sent: the button comes back");
  execute = async () => ({ results: [{ ok: true }, { ok: false, message: "The watch refused it." }], message: "Some zones changed." });
  const partial = await service.confirm(preview.requestId);
  assert.equal(partial.state, "partial");
  assert.deepEqual(partial.items.map((item) => item.result.ok), [true, false]);
  assert.equal((await service.confirm(preview.requestId)).state, "partial", "a finished review never runs twice");
  assert.throws(() => service.get("unknown"), /expired/);

  const second = service.stage({ ...draft, payload: {} });
  execute = async () => { throw new Error("COROS is unreachable."); };
  const failed = await service.confirm(second.requestId);
  assert.equal(failed.state, "failed");
  assert.equal(failed.message, "COROS is unreachable.");
  const third = service.stage({ ...draft, payload: {} });
  assert.equal(service.dismiss(third.requestId).state, "dismissed");
  await service.confirm(third.requestId);
  assert.equal(service.get(third.requestId).state, "dismissed");

  // A save interrupted by a restart is reported, not retried.
  const fourth = service.stage({ ...draft, payload: {} });
  execute = () => new Promise(() => {});
  void service.confirm(fourth.requestId);
  await new Promise((resolve) => setImmediate(resolve));
  const restarted = createCoachReviewService({ ...deps, execute: async () => assert.fail("never re-run") });
  assert.equal(restarted.get(fourth.requestId).state, "failed");
  assert.match(restarted.get(fourth.requestId).message, /interrupted/);
}

// ----- Data freshness -----
{
  const now = new Date(2026, 9, 22, 9, 0);
  const local = buildCoachDataStatus({
    now, localOnly: true, trainingHub: { signedIn: false },
    newestActivity: { startTime: new Date(2026, 9, 21, 7, 30).getTime() / 1000, name: "Easy run", sport: "Run" },
    watch: { connected: false, lastConnectedAt: new Date(2026, 9, 21, 20, 0).toISOString() },
    localSync: { lastActivitySyncAt: new Date(2026, 9, 21, 20, 5).toISOString() },
    syncErrors: [
      { at: new Date(2026, 9, 21, 6).toISOString(), source: "corosBle:link", message: "Bluetooth link dropped." },
      { at: new Date(2026, 9, 22, 8).toISOString(), source: "localData:sync", message: "Sync interrupted.", count: 3 }
    ]
  });
  assert.equal(local.data_mode, "local-only");
  assert.match(local.newest_activity, /^2026-10-21 07:30 \(26 h ago\) · Run · Easy run$/);
  assert.match(local.last_watch_sync, /2026-10-21 20:05/);
  assert.match(local.watch, /not connected; last connected 2026-10-21 20:00/);
  assert.deepEqual(local.recent_sync_errors.map((error) => [error.where, error.repeats]), [["Watch", 3], ["Watch", undefined]], "newest first");
  assert.match(local.guidance, /Sync watch now/);
  const line = formatDataStatusForContext(local);
  assert.match(line, /Data mode: local-only; newest activity: 2026-10-21 07:30/);
  assert.match(line, /2 recent sync errors \(latest: Watch: Sync interrupted\.\)/);
  const signedOut = buildCoachDataStatus({ now, localOnly: false, trainingHub: { signedIn: false, sessionExpired: true }, watch: { connected: true, name: "PACE 3" }, syncErrors: [] });
  assert.match(signedOut.training_hub, /session expired/);
  assert.equal(signedOut.coros_mcp, "not set up");
  assert.equal(signedOut.watch, "connected (PACE 3)");
  assert.match(signedOut.guidance, /sign in to COROS/);
  const connected = buildCoachDataStatus({ now, localOnly: false, trainingHub: { signedIn: true }, corosMcp: { connected: false, authenticated: true, error: "timeout" }, watch: { connected: false }, syncErrors: [] });
  assert.equal(connected.coros_mcp, "not connected (timeout)");
  assert.match(connected.guidance, /COROS phone app/);
}

// ----- Tool guide -----
{
  const guide = buildAthleteToolGuide(CHAT_ATHLETE_TOOL_NAMES);
  for (const rule of [/call get_athlete_context once/, /remember_athlete_fact in the same turn/, /get_plan_compliance for the relevant weeks/,
    /check get_weather_forecast/, /offer add_target_race/,
    /read get_strength_history first/, /propose_zone_update only from clear evidence/, /may not have synced yet/]) {
    assert.match(guide, rule);
  }
  const memoryOnly = buildAthleteToolGuide(["get_athlete_context", "remember_athlete_fact", "forget_athlete_fact", "get_weather_forecast"]);
  assert.doesNotMatch(memoryOnly, /get_plan_compliance|propose_zone_update/, "rules only for tools on offer");
  assert.equal(buildAthleteToolGuide([]), "");
}

// ----- Transcript entries -----
{
  const review = { kind: "coachReview", preview: { requestId: "rv1", action: "updateZones", title: "Update watch zones", summary: "New threshold.", items: [{ label: "Threshold heart rate", before: "172 bpm", after: "175 bpm" }], createdAt: 1, state: "saved", message: "The watch now has max 190, threshold 175 and resting 48 bpm." } };
  const notice = { kind: "athleteMemory", notice: { noticeId: "n1", action: "updated", at: NOW, fact: { ...remembered.fact, text: "Calf healed" }, previous: remembered.fact } };
  assert.equal(chatEntryKey(review), "coachReview:rv1");
  assert.equal(chatEntryKey(notice), "athleteMemory:n1");
  const wire = toWireMessages([review, notice, { ...notice, notice: { ...notice.notice, undone: true } }]);
  assert.match(wire[0].content, /Review card "Update watch zones" \(saved\): New threshold\. The watch now has/);
  assert.match(wire[1].content, /^Memory updated \[f1\] injury: Calf healed$/);
  assert.match(wire[2].content, /athlete undid this memory change/);
  assert.deepEqual(fromPersistedEntries(toPersistedEntries([review, notice])), [review, notice]);
}

console.log("coach athlete tools tests passed (memory, context bundle, races, compliance, moves, weather, strength history, zones, reviews, data freshness, guide, transcript)");
