import { clock } from "@/lib/format";
import { distanceIn, distanceUnit, imperial, paceIn, paceUnitLabel } from "@/lib/units";
import type { BriefCard, CoachData, CompareCard, DebriefCard, FuelCard, PlanCard, PlanCheckCard, QuestionCard, RecapCard, TodayCard, TrendCard, WorkoutCard } from "../coach";

// The sample's numbers are metric; the ones on cards are shown in the page's units.
const dist = (metres: number) => distanceIn(metres).toFixed(2);
const pace = (secPerKm: number, decimals = 0) => clock(paceIn(secPerKm), decimals);
const paces = (fast: number, slow: number) => `${pace(fast)} to ${pace(slow)} ${paceUnitLabel()}`;
const BLOCK = imperial() ? `Tempo block, ${distanceIn(4000).toFixed(1)} mi` : "Tempo block, 4 km";

const TEMPO = "/activities/2026-11-19-morning-tempo";
const TEMPO_BEFORE = "/activities/2026-11-05-tempo-run";

const recap: RecapCard = {
  kind: "recap", id: "recap-tempo", activityId: "2026-11-19-morning-tempo",
  eyebrow: "Run · Thu 19 Nov, 07:42", title: "Morning tempo",
  routePath: "M120 330C170 240 240 295 300 230S410 150 480 125C550 100 620 112 655 170C682 218 640 270 580 258C518 246 462 200 406 226S310 330 240 352C190 366 148 356 120 330Z",
  routeLabel: "Route sketch: a loop along the river and back through the park",
  stats: [
    { label: "Distance", value: dist(8020), unit: distanceUnit() },
    { label: "Time", value: "38:14.52" },
    { label: "Avg pace", value: pace(286), unit: paceUnitLabel() },
    { label: BLOCK, value: "18:15.56", hue: "mint" },
    { label: "Avg heart rate", value: "158", unit: "bpm", hue: "rose" },
    { label: "Load", value: "96", hue: "pink" },
  ],
  splits: [
    { seconds: 308.31 }, { seconds: 302.77 },
    { seconds: 273.12, block: true }, { seconds: 274.9, block: true }, { seconds: 275.48, block: true }, { seconds: 272.06, block: true },
    { seconds: 292.11 }, { seconds: 290.24 },
  ],
  heartRate: [123.5, 128.7, 132.2, 134.1, 134.7, 134.9, 135.6, 136.9, 138.5, 140, 142.6, 143.7, 143.8, 143.8, 144.3, 145.6, 147.1, 148.4, 148.8, 148.2, 151.2, 153.4, 155.6, 158.1, 160.6, 162.4, 163.2, 162.9, 162.2, 161.7, 163.2, 165.2, 167.2, 168.6, 168.9, 168.4, 167.5, 167, 167.3, 168.3, 170.1, 171.2, 171.2, 170.5, 169.5, 169.1, 169.5, 170.6, 171.8, 172.4, 172.5, 171.9, 171.1, 170.8, 171.4, 172.6, 173.8, 174.3, 173.8, 172.8, 169, 166.6, 165.7, 165.6, 165.8, 165.4, 164.3, 162.8, 161.6, 161.1, 160.2, 160.1, 160.1, 159.5, 158.3, 156.7, 155.5, 155.2, 155.9, 156.9, 157.7],
  paceSeconds: [308, 309.7, 310.4, 309.8, 308.5, 307.6, 307.7, 308.7, 309.5, 309.3, 303, 301.3, 300.3, 300.6, 302, 303.5, 304.1, 303.6, 302.7, 302.2, 272.9, 274.3, 275.5, 275.5, 274.2, 272.4, 271.2, 271.2, 272.1, 273.2, 275.3, 274.5, 273.4, 273, 273.9, 275.6, 277.2, 277.6, 276.8, 275.3, 274.4, 274.5, 275.4, 276.1, 275.9, 274.6, 273, 272.2, 272.8, 274.4, 273, 273.5, 273, 272, 271.5, 272.1, 273.4, 274.3, 274.1, 272.7, 290.9, 289.7, 289.9, 291.1, 292.2, 292.4, 291.7, 290.7, 290.4, 291.4, 291.1, 292.5, 292.7, 291.6, 290, 289, 289.1, 290, 290.8, 290.5, 289.2],
  chartLabel: "Pace for each kilometre as bars, the four tempo kilometres highlighted, with heart rate rising from 124 to 174 and easing to 158",
  read: "All four tempo kilometres between 4:32.06 and 4:35.48, heart rate up only 9 bpm across the block.",
};

const compare: CompareCard = {
  kind: "compare", id: "compare-tempo",
  eyebrow: "Same session · 2 weeks apart", title: "Tempo, 19 Nov against 5 Nov",
  before: { label: "Thu 5 Nov", short: "5 Nov", href: TEMPO_BEFORE },
  after: { label: "Thu 19 Nov", short: "19 Nov", href: TEMPO },
  rows: [
    { label: BLOCK, before: "18:41.20", after: "18:15.56", change: "−25.64 s", better: true },
    { label: "Tempo pace", before: `${pace(280.3, 2)} ${paceUnitLabel()}`, after: `${pace(273.89, 2)} ${paceUnitLabel()}`, change: `−${paceIn(6.41).toFixed(2)} s`, better: true },
    { label: "Heart rate in the block", before: "169 bpm", after: "167 bpm", change: "−2 bpm", better: true },
    { label: "Heart rate drift", before: "+13 bpm", after: "+9 bpm", change: "−4 bpm", better: true },
    { label: "Cadence", before: "176 spm", after: "177 spm", change: "+1 spm" },
    { label: "Load", before: "99", after: "96", change: "−3" },
  ],
  beforeSeconds: [308.9, 303.4, 279.6, 281.2, 280.9, 279.5, 292.6, 291],
  afterSeconds: [308.31, 302.77, 273.12, 274.9, 275.48, 272.06, 292.11, 290.24],
  chartLabel: "Pace per kilometre for both runs: warm-up and cool-down match, all four tempo kilometres are faster on 19 November",
  read: "6.41 s per km faster at a heart rate 2 bpm lower. That is fitness, not effort.",
};

const fuel: FuelCard = {
  kind: "fuel", id: "fuel-tonight",
  eyebrow: "Fuel · today so far", title: "990 kcal left, protein is the gap",
  leftKcal: 990, eatenKcal: 1460, targetKcal: 2450, burnedKcal: 2140,
  macros: [
    { name: "Protein", hue: "rose", grams: 88, leftGrams: 62 },
    { name: "Carbs", hue: "mint", grams: 160, leftGrams: 160 },
    { name: "Fat", hue: "orange", grams: 52, leftGrams: 23 },
  ],
  meal: { slot: "Dinner", name: "Salmon rice bowl with edamame", detail: "720 kcal · 46 g protein · 82 g carbs · 22 g fat" },
  read: "Dinner covers 46 g of the 62 g of protein still open. Carbs matter more tomorrow evening, before the long run.",
};

/** Ninety nights: sixty steady ones made here, then the thirty the canvas draws, with Tuesday's dip. */
const HRV_30 = [58, 61, 57, 60, 63, 59, 56, 60, 62, 58, 55, 59, 61, 64, 60, 57, 59, 62, 58, 61, 63, 60, 56, 62, 61, 58, 60, 44, 57, 62];
const HRV_EARLIER = Array.from({ length: 60 }, (_, k) => 58 + Math.round(3.4 * Math.sin(k * 1.7) + 2.1 * Math.cos(k * 0.61)));

const trend: TrendCard = {
  kind: "trend", id: "trend-hrv",
  eyebrow: "HRV", title: "One low night, back in range since",
  metric: "HRV", unit: "ms",
  values: [...HRV_EARLIER, ...HRV_30], lastDay: "2026-11-19", usual: [54, 66], markBack: 2,
  href: "/health", hrefLabel: "Open Health",
  read: "Tuesday's 44 ms followed Monday's late strength session and 6 h 05 min of sleep. It is not a trend.",
};

const today: TodayCard = {
  kind: "today", id: "today-ready",
  eyebrow: "Today · Thu 19 Nov", title: "Good to train, with the tempo already in your legs",
  dials: [
    { label: "Recovery", value: "78", note: "Ready", hue: "mint", fraction: 0.78 },
    { label: "Sleep", value: "7 h 42", unit: "min", note: "Score 84", hue: "violet", fraction: 0.84 },
    { label: "Energy", value: "64", note: "Woke at 81", hue: "lime", fraction: 0.64 },
  ],
  form: { value: -7, note: "Fatigue 61", min: -30, max: 20 },
  rows: [
    { label: "HRV", value: "62 ms", note: "in range" },
    { label: "Resting HR", value: "48 bpm", note: "in range" },
    { label: "Week load", value: "253 of 463" },
  ],
  read: "Keep Friday easy and Saturday's long run is on.",
};

const planCheck: PlanCheckCard = {
  kind: "plancheck", id: "plan-check",
  eyebrow: "Plan · 6 to 19 Nov", title: "9 of 11 sessions done on their day",
  days: [
    { label: "F 6", state: "done", hue: "mint" }, { label: "S 7", state: "done", hue: "orange" }, { label: "S 8", state: "done", hue: "mint" },
    { label: "M 9", state: "rest" }, { label: "T 10", state: "done", hue: "mint" }, { label: "W 11", state: "skipped" },
    { label: "T 12", state: "done", hue: "mint" }, { label: "F 13", state: "rest" }, { label: "S 14", state: "moved-away" },
    { label: "S 15", state: "done", hue: "mint" }, { label: "M 16", state: "moved-here", hue: "orange" }, { label: "T 17", state: "done", hue: "mint" },
    { label: "W 18", state: "done", hue: "cyan" }, { label: "T 19", state: "done", hue: "mint" },
  ],
  daysLabel: "14 days, 6 to 19 November: nine sessions done on their day, one skipped on Wednesday 11, one moved from Saturday 14 to Monday 16, two rest days",
  totals: [
    { label: "Distance", done: `${dist(71_420)} ${distanceUnit()}`, planned: dist(79_420), fraction: 0.899, hue: "mint" },
    { label: "Time", done: "7 h 52 min", planned: "8 h 41", fraction: 0.906, hue: "blue" },
    { label: "Load", done: "548", planned: "612", fraction: 0.895, hue: "pink" },
  ],
  misses: [
    { day: "Wed 11 Nov", name: "Intervals, 6 × 800 m", state: "skipped", note: "Skipped" },
    { day: "Sat 14 Nov", name: "Strength, lower body", state: "moved", note: "Done Mon 16" },
  ],
  read: "Every long run is there. The one real gap is speed work, so the tempo mattered.",
};

const debrief: DebriefCard = {
  kind: "debrief", id: "debrief-tempo", activityId: "2026-11-19-morning-tempo",
  eyebrow: "Debrief · Thu 19 Nov", title: "Morning tempo",
  feel: { score: 4, of: 5, word: "Strong" },
  cues: [
    { text: "Tempo kilometres between 4:30 and 4:38", hit: true },
    { text: "Shoulders loose after km 4", hit: true },
    { text: "Gel at 20 min", hit: false },
  ],
  fuel: "Coffee and a banana before, nothing during",
  said: "Legs felt fine, forgot the gel. Last tempo kilometre was the easiest.",
  read: "2 of 3 cues hit. Next tempo, tape the gel to the bottle.",
};

const plan: PlanCard = {
  kind: "plan", id: "move-long-run", title: "Move the long run to Saturday",
  rows: [
    { day: "Fri 20", now: [{ name: "Easy run, 6.00 km", hue: "mint" }], proposed: [{ name: "Easy run, 6.00 km", hue: "mint" }, { name: "Strength, upper body", hue: "orange", changed: true }], loadNow: 38, loadNext: 68 },
    { day: "Sat 21", now: [{ name: "Strength, lower body", hue: "orange" }], proposed: [{ name: "Long run, 18.00 km", hue: "mint", changed: true }], loadNow: 42, loadNext: 130 },
    { day: "Sun 22", now: [{ name: "Long run, 18.00 km", hue: "mint" }], proposed: [{ name: "Rest, travel day", hue: "none", changed: true }], loadNow: 130, loadNext: 0 },
    { day: "Mon 23", now: [{ name: "Recovery ride, 25.00 km", hue: "cyan" }], proposed: [{ name: "Strength, lower body", hue: "orange", changed: true }], loadNow: 35, loadNext: 42 },
  ],
  week: { label: "Week load, 16 to 22 Nov", before: 463, after: 451, done: 253 },
  note: "An easy day either side of the long run. The recovery ride drops out.",
};

const workout: WorkoutCard = {
  kind: "workout", id: "fast-finish",
  eyebrow: "Coach suggests · Run", title: "Long run with a fast finish",
  date: "2026-11-21", dayLabel: "Sat 21 Nov",
  stats: [
    { label: "Planned", value: dist(18_000), unit: distanceUnit() },
    { label: "About", value: "1 h 40", unit: "min" },
    { label: "Planned load", value: "130", hue: "pink" },
  ],
  steps: [
    { name: "Warm up", length: `${dist(2000)} ${distanceUnit()}`, target: paces(335, 345), note: "Zone 2", hue: "gold", weight: 2, height: 0.5 },
    { name: "Steady", length: `${dist(12_000)} ${distanceUnit()}`, target: paces(320, 330), note: "Zone 2 to 3", hue: "mint", weight: 12, height: 0.68, soft: true },
    { name: "Fast finish", length: `${dist(4000)} ${distanceUnit()}`, target: paces(285, 290), note: "9 s off goal pace", hue: "mint", weight: 4, height: 1 },
    { name: "Cool down", length: "5:00", target: "Walk or jog", note: "Easy", hue: "blue", weight: 0.9, height: 0.34 },
  ],
  shapeLabel: "Workout shape: a short warm-up, a long steady block, a taller fast finish, a short cool-down",
  summary: `Warm up ${dist(2000)} ${distanceUnit()} · steady ${dist(12_000)} ${distanceUnit()} · fast finish ${dist(4000)} ${distanceUnit()} at ${paces(285, 290)} · cool down`,
  note: "Replaces the plain 18 km on Saturday. Hold back until 14 km.",
};

const question: QuestionCard = {
  kind: "question", id: "last-4km", title: "How should the last 4 km of Saturday's long run feel?",
  options: [
    { id: "fast", title: "Fast finish, 4:45 to 4:50 /km", detail: "Close to race effort for the last 4 km. Best practice for the half.", recommended: true },
    { id: "steady", title: "Steady all the way, 5:20 to 5:30 /km", detail: "Lower cost. Pick this if the tempo is still in your legs on Saturday." },
    { id: "later", title: "Decide at 14 km", detail: "I add both versions to the brief with a heart-rate rule for choosing." },
  ],
};

const brief: BriefCard = {
  kind: "brief", id: "brief-long-run",
  eyebrow: "Brief · Sat 21 Nov", title: "Long run with a fast finish",
  goal: "18 km steady, the last 4 km at 4:45 to 4:50 /km",
  cues: ["No faster than 5:20 /km before 14 km", "Drink before 10 km", "Cadence 174 spm or more on the fast finish"],
  fuel: "60 g of carbs in the hour before, one gel at 9 km",
  saved: "Saved on Saturday's workout", savedNote: "Shown in the calendar and the phone app",
};

export const SAMPLE_COACH: CoachData = {
  conversations: [
    {
      id: "long-run",
      title: "Moving Sunday's long run",
      group: "Today",
      stamp: "07:12",
      messages: [
        { id: "m1", from: "you", text: "I'm travelling on Sunday. Can I do the 18 km long run on Saturday instead? This morning's tempo felt hard, so tell me if that is too soon." },
        {
          id: "m2", from: "coach",
          blocks: [
            { kind: "text", text: "It felt hard because it was quick, not because you were struggling. The tempo block was your fastest this autumn and your heart rate stayed flat through it." },
            recap,
            { kind: "text", text: "With an easy Friday, two days is enough. I'd move strength to Friday evening, upper body only, so your legs are fresh for Saturday." },
            plan,
          ],
        },
        { id: "m3", from: "you", text: "What pace should the last 4 km be?" },
        {
          id: "m4", from: "coach",
          blocks: [
            { kind: "text", text: "Hold 5:20 to 5:30 for the first 14 km, then bring the last 4 km down to 4:45 to 4:50. That is about 9 s per km off your goal pace of 4:38.71, enough to practise the finish without racing it." },
            workout,
          ],
        },
      ],
      suggestions: ["How should I fuel Saturday?", "Compare this tempo with 5 Nov", "Am I on track for 1:38?"],
      sources: [
        { title: "Morning tempo", detail: `Today · ${dist(8020)} ${distanceUnit()} · ${pace(286)} ${paceUnitLabel()}`, href: TEMPO },
        { title: "Long run", detail: `Sun 15 Nov · ${dist(18_040)} ${distanceUnit()} · ${pace(320)} ${paceUnitLabel()}`, href: "/activities/2026-11-15-long-run" },
        { title: "This week's plan", detail: "16 to 22 Nov · 7 sessions", href: "/calendar" },
      ],
    },
    {
      id: "hrv-tuesday", title: "Why was Tuesday's HRV low?", group: "This week", stamp: "Tue",
      messages: [
        { id: "h1", from: "you", text: "Why was Tuesday's HRV low?" },
        {
          id: "h2", from: "coach",
          blocks: [
            { kind: "note", id: "read-hrv", note: "read", text: "Read 3 things for this answer: health, 30 nights · activities, 30 days · this week's plan." },
            { kind: "text", text: "One night, and it has a cause. You lifted late on Monday and slept just over six hours." },
            trend,
          ],
        },
        { id: "h3", from: "you", text: "Am I OK to train hard this week?" },
        { id: "h4", from: "coach", blocks: [{ kind: "text", text: "Yes. Everything else is where it should be." }, today] },
        { id: "h5", from: "you", text: "What should I eat tonight?" },
        { id: "h6", from: "coach", blocks: [fuel] },
      ],
      suggestions: ["Show the last 90 nights", "What moves my HRV the most?"],
      sources: [
        { title: "Health", detail: "21 Oct to 19 Nov · 30 nights", href: "/health" },
        { title: "Strength, upper body", detail: "Mon 16 Nov · 21:10", href: "/activities" },
      ],
    },
    {
      id: "debrief-tempo", title: "Debrief: morning tempo", group: "This week", stamp: "Thu",
      messages: [
        { id: "d1", from: "you", text: "Legs felt fine, forgot the gel. Last tempo kilometre was the easiest." },
        { id: "d2", from: "coach", blocks: [{ kind: "text", text: "Noted against the brief you had for it." }, debrief] },
        { id: "d3", from: "you", text: "Am I faster than two weeks ago?" },
        { id: "d4", from: "coach", blocks: [compare] },
        { id: "d5", from: "you", text: "And the splits from the run itself?" },
        {
          id: "d6", from: "coach",
          blocks: [{
            kind: "failed", id: "failed-tempo", title: "Morning tempo, Thu 19 Nov", tried: "Last tried 09:14",
            text: "The activity file hasn't reached this computer yet. It arrives with the phone app's next sync. The summary numbers are here, the splits and heart rate are not.",
          }],
        },
      ],
      suggestions: ["What should the next tempo be?"],
      sources: [
        { title: "Morning tempo", detail: `Today · ${dist(8020)} ${distanceUnit()} · ${pace(286)} ${paceUnitLabel()}`, href: TEMPO },
        { title: "Tempo run", detail: `Thu 5 Nov · ${dist(8000)} ${distanceUnit()} · ${pace(290)} ${paceUnitLabel()}`, href: TEMPO_BEFORE },
      ],
    },
    {
      id: "half-plan", title: "Half marathon plan, 16 weeks", group: "Earlier", stamp: "2 Nov",
      messages: [
        { id: "p1", from: "you", text: "Have I been sticking to the plan?" },
        { id: "p2", from: "coach", blocks: [planCheck] },
        { id: "p3", from: "you", text: "Write Saturday's long run up for me." },
        {
          id: "p4", from: "coach",
          blocks: [
            { kind: "text", text: "One thing first." },
            question,
            brief,
            { kind: "note", id: "remember-sundays", note: "remembered", text: "you travel most Sundays, so long runs go on Saturday." },
          ],
        },
      ],
      suggestions: ["What is the hardest week of the plan?"],
      sources: [{ title: "Plan", detail: "6 to 19 Nov · 11 sessions", href: "/calendar" }],
    },
    {
      id: "strength-days", title: "Strength days around running", group: "Earlier", stamp: "28 Oct",
      messages: [
        { id: "s1", from: "you", text: "Do my lifts slow down the runs the day after?" },
        {
          id: "s2", from: "coach",
          blocks: [{
            kind: "working", id: "working-lifts", title: "Looking at your last 12 weeks",
            steps: [
              { text: "Read activities, 4 Sep to 28 Oct", done: true },
              { text: "Read strength sessions, 23 of them", done: true },
              { text: "Comparing runs after a lift with runs after rest", done: false },
            ],
          }],
        },
      ],
      suggestions: [],
      sources: [],
    },
  ],
  looking: [
    { label: "Recovery", value: "78" },
    { label: "Fitness / fatigue / form", value: "54 / 61 / −7" },
    { label: "Load this week", value: "253 of 463" },
    { label: "Sleep, 7-day average", value: "7:17" },
  ],
  goal: { title: "Half marathon in 1:38:00", detail: "Predicted today 1:40:05 · Week 3 of 16" },
  level: { number: 6, fraction: 0.7, line: "Tempo done. Nice work.", next: "Next look: gold band, 2 more weeks in a row" },
};
