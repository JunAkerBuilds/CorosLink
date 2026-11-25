// A scripted stand-in for an AI, for development only (COACH_MODEL=mock, refused in a production build), and for the
// Coach tests. It is not an AI: it picks tools from words in the question so the whole
// path (stream, tools, cards, apply, undo, storage) can be run without an AI key. Its tool calls go through the
// real loop and the real tools, on the sample athlete's real items.
import type { CoachModel, ModelMessage, ModelRequest, ModelTurn, ToolCall } from "@/lib/coach/loop";
import { contentText } from "@/lib/coach/files";

export const MOCK_NOTE = "Scripted dev model, not an AI";

const textOf = (m: ModelMessage | undefined): string => contentText(m?.content);
const resultsOf = (m: ModelMessage | undefined): { content: string; is_error?: boolean }[] =>
  Array.isArray(m?.content) ? (m.content as { type?: string; content?: string; is_error?: boolean }[]).filter((b) => b.type === "tool_result").map((b) => ({ content: String(b.content ?? ""), is_error: b.is_error })) : [];

function tomorrow(context: string, add = 1): string {
  const day = /Today is (\d{4})-(\d{2})-(\d{2})/.exec(context);
  const t = day ? new Date(Date.UTC(+day[1], +day[2] - 1, +day[3] + add)) : new Date(Date.now() + add * 86_400_000);
  return t.toISOString().slice(0, 10);
}

const RUN = {
  name: "Tempo 3 × 2 km", sport: "run", description: "Three controlled blocks at threshold pace.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "none" } }] },
    { repeats: 3, steps: [{ kind: "training", target: "distance", meters: 2000, intensity: { kind: "pace", low: 270, high: 280 } }, { kind: "rest", target: "time", seconds: 120, intensity: { kind: "none" } }] },
    { steps: [{ kind: "cooldown", target: "time", seconds: 600, intensity: { kind: "none" } }] },
  ],
};

const GYM = {
  name: "Lower body strength", sport: "strength", description: "Heavy legs with a short accessory finish.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 480, intensity: { kind: "none" }, name: "Bike and mobility" }] },
    { steps: [{ kind: "training", target: "reps", count: 6, sets: 4, restSeconds: 150, exercise: "Back squat", intensity: { kind: "weight", low: 80 } }] },
    { steps: [{ kind: "training", target: "reps", count: 8, sets: 3, restSeconds: 120, exercise: "Romanian deadlift", intensity: { kind: "weight", low: 70 } }] },
    { steps: [{ kind: "training", target: "reps", count: 10, sets: 3, restSeconds: 90, exercise: "Walking lunge", intensity: { kind: "bodyweight" } }] },
    { steps: [{ kind: "training", target: "time", seconds: 45, sets: 3, restSeconds: 45, exercise: "Plank", intensity: { kind: "bodyweight" } }] },
  ],
};

const none = { kind: "none" };
const BIKE = {
  name: "Sweet spot 3 × 12 min", sport: "bike", description: "Three long blocks just under threshold.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "power", low: 130, high: 160 } }] },
    { repeats: 3, steps: [{ kind: "training", target: "time", seconds: 720, intensity: { kind: "power", low: 220, high: 235 } }, { kind: "rest", target: "time", seconds: 240, intensity: { kind: "power", low: 120, high: 140 } }] },
    { steps: [{ kind: "cooldown", target: "time", seconds: 600, intensity: { kind: "power", low: 110, high: 140 } }] },
  ],
};
const SWIM = {
  name: "Threshold 100s", sport: "swim", description: "Even hundreds on short rest.",
  blocks: [
    { steps: [{ kind: "warmup", target: "distance", meters: 400, intensity: { kind: "stroke", stroke: "freestyle" } }] },
    { repeats: 4, steps: [{ kind: "training", target: "distance", meters: 50, intensity: { kind: "stroke", stroke: "drills" } }, { kind: "rest", target: "time", seconds: 15, intensity: none }] },
    { repeats: 8, steps: [{ kind: "training", target: "distance", meters: 100, intensity: { kind: "stroke", stroke: "freestyle" } }, { kind: "rest", target: "time", seconds: 20, intensity: none }] },
    { repeats: 4, steps: [{ kind: "training", target: "distance", meters: 50, intensity: { kind: "stroke", stroke: "backstroke" } }, { kind: "rest", target: "time", seconds: 30, intensity: none }] },
    { steps: [{ kind: "cooldown", target: "distance", meters: 200, intensity: { kind: "stroke", stroke: "mix" } }] },
  ],
};
const station = (exercise: string, step: Record<string, unknown>) => ({ steps: [{ kind: "training", exercise, ...step }] });
const km = { steps: [{ kind: "training", target: "distance", meters: 1000, intensity: none }] };
const HYROX = {
  name: "Half simulation", sport: "hyrox", description: "Four stations with the runs between, at race effort.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 600, intensity: none }] },
    km, station("SkiErg", { target: "distance", meters: 1000, intensity: { kind: "rpe", low: 7 } }),
    km, station("Sled Push", { target: "distance", meters: 50, intensity: { kind: "weight", low: 102 } }),
    km, station("Burpee Broad Jumps", { target: "distance", meters: 80, intensity: { kind: "rpe", low: 8 } }),
    km, station("Wall Balls", { target: "reps", count: 100, intensity: { kind: "weight", low: 6 } }),
    { steps: [{ kind: "cooldown", target: "time", seconds: 300, intensity: none }] },
  ],
};
const CLIMB = {
  name: "Volume pyramid", sport: "indoorClimb", gradeSystem: "french", description: "Easy mileage up to one hard route and back.",
  blocks: [
    { steps: [{ kind: "warmup", target: "routes", count: 3, intensity: { kind: "grade", grade: "5a" } }] },
    { repeats: 3, steps: [{ kind: "training", target: "routes", count: 2, intensity: { kind: "grade", grade: "6a+" } }, { kind: "rest", target: "time", seconds: 180, intensity: { kind: "grade", grade: "6a+" } }] },
    { steps: [{ kind: "training", target: "routes", count: 1, intensity: { kind: "grade", gradeOffset: 0 } }] },
    { steps: [{ kind: "rest", target: "time", seconds: 300, intensity: { kind: "grade", gradeOffset: 0 } }] },
    { steps: [{ kind: "training", target: "time", seconds: 900, intensity: { kind: "grade", gradeOffset: -2 } }] },
  ],
};
const BOULDER = {
  name: "Limit boulders", sport: "bouldering", gradeSystem: "vScale", description: "Few hard problems, long rests.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "grade", grade: "V1" } }] },
    { repeats: 5, steps: [{ kind: "training", target: "routes", count: 3, intensity: { kind: "grade", grade: "V4" } }, { kind: "rest", target: "time", seconds: 240, intensity: { kind: "grade", grade: "V4" } }] },
  ],
};
const SKI = {
  name: "Classic hill repeats", sport: "xcSki", description: "Climbs at threshold, easy back down.",
  blocks: [
    { steps: [{ kind: "warmup", target: "time", seconds: 900, intensity: { kind: "heartRate", low: 120, high: 135 } }] },
    { repeats: 5, steps: [{ kind: "training", target: "elevationGain", meters: 60, intensity: { kind: "heartRate", low: 160, high: 170 } }, { kind: "rest", target: "time", seconds: 180, intensity: none }] },
    { steps: [{ kind: "cooldown", target: "distance", meters: 2000, intensity: none }] },
  ],
};
const TRAIL = {
  name: "Rolling trail hour", sport: "trailRun", description: "Steady on the flats, strong on the climbs.",
  blocks: [
    { steps: [{ kind: "warmup", target: "distance", meters: 2000, intensity: { kind: "heartRate", low: 125, high: 140 } }] },
    { repeats: 4, steps: [{ kind: "training", target: "elevationGain", meters: 120, intensity: { kind: "heartRate", low: 158, high: 168 } }, { kind: "rest", target: "distance", meters: 800, intensity: { kind: "heartRate", low: 120, high: 135 } }] },
    { steps: [{ kind: "cooldown", target: "time", seconds: 600, intensity: none }] },
  ],
};
const EASY = { name: "Easy 45", sport: "run", description: "Legs moving, nothing more.", blocks: [{ steps: [{ kind: "training", target: "time", seconds: 2700, intensity: { kind: "heartRate", low: 130, high: 145 } }] }] };

/** The scripted workout for the sport a question names. */
function workoutFor(q: string): { workout: unknown; note: string; days: number } | null {
  if (/hyrox/.test(q)) return { workout: HYROX, note: "Race-order practice while your running load is steady.", days: 3 };
  if (/boulder/.test(q)) return { workout: BOULDER, note: "Few hard problems, full rests.", days: 2 };
  if (/climb/.test(q)) return { workout: CLIMB, note: "Mileage first, one hard route in the middle.", days: 2 };
  if (/\bski/.test(q)) return { workout: SKI, note: "Short climbs keep the effort honest.", days: 2 };
  if (/\bswim|pool/.test(q)) return { workout: SWIM, note: "Short rests hold you at threshold.", days: 1 };
  if (/\b(bike|ride|cycling|power|ftp)/.test(q)) return { workout: BIKE, note: "Sweet spot builds the engine at a cost you can repeat.", days: 1 };
  if (/trail/.test(q)) return { workout: TRAIL, note: "Climbing by heart rate, not pace.", days: 1 };
  if (/\b(strength|gym|lift|leg|upper|lower)/.test(q)) return { workout: GYM, note: "Legs are your least-trained group this week.", days: 2 };
  if (/\beasy\b/.test(q)) return { workout: EASY, note: "A day between the hard ones.", days: 1 };
  if (/\b(run|workout|interval|tempo|session)/.test(q)) return { workout: RUN, note: "Your load ratio leaves room for one quality day.", days: 1 };
  return null;
}

/** What the scripted model does first for a question. */
function firstCalls(question: string, context: string): { name: string; input: unknown }[] {
  const q = question.toLowerCase();
  const making = /\b(create|build|make|plan me|give me|write|design)\b/.test(q);
  if (/\b(change|edit|shorten|lengthen|make it|rewrite)\b/.test(q) && !making) return [{ name: "list_calendar", input: {} }];
  if (/\b(plan|block)\b/.test(q) && /\b(week|days)\b/.test(q) && making) {
    return [{ name: "propose_training_plan", input: { name: "One week back in", overview: "Three runs and a gym day, easy first.", start_date: tomorrow(context), workouts: [
      { day: 1, workout: { name: "Easy 6 km", sport: "run", blocks: [{ steps: [{ kind: "training", target: "distance", meters: 6000, intensity: { kind: "none" } }] }] } },
      { day: 3, workout: RUN }, { day: 4, workout: GYM },
      { day: 6, workout: { name: "Long run", sport: "run", blocks: [{ steps: [{ kind: "training", target: "distance", meters: 16000, intensity: { kind: "none" } }] }] } },
    ] } }];
  }
  if (/\bexercise/.test(q) && /\b(search|find|which|what)\b/.test(q)) return [{ name: "search_exercises", input: { query: "squat, lunge, deadlift" } }];
  const sport = making ? workoutFor(q) : null;
  if (sport) return [{ name: "propose_workout", input: { date: tomorrow(context, sport.days), workout: sport.workout, note: sport.note } }];
  if (/\b(move|swap|reschedule|shift|push|remove|cancel|skip)\b/.test(q)) return [{ name: "list_calendar", input: {} }];
  if (/\bcompare\b/.test(q)) return [{ name: "read_activities", input: { days: 30, sport: "run" } }];
  if (/\b(brief)\b/.test(q)) return [{ name: "write_workout_brief", input: { date: tomorrow(context), name: "Tempo 3 × 2 km", goal: "Hold threshold pace without fading", cues: ["Each 2 km within 5 s of the first", "Heart rate under 170 until the last block"], fuel_plan: "Carbs two hours before, water only during" } }];
  if (/\b(remember|my goal|training for)\b/.test(q)) return [{ name: "remember_fact", input: { fact: question.slice(0, 200) } }];
  if (/\b(which|not sure|help me choose|ask me)\b/.test(q)) return [{ name: "request_coach_input", input: { question: "What matters most this week?", choices: [{ label: "Hit the long run", description: "Keep Saturday, ease the days around it." }, { label: "Recover first", description: "Two easy days before anything hard." }] } }];
  if (/\b(eat|food|fuel|dinner|lunch|breakfast|protein|calorie)/.test(q)) return [{ name: "show_fuel", input: { read: "Protein is the gap; dinner can close it.", meal: { slot: "dinner", name: "Salmon rice bowl with edamame", kcal: 720, protein_g: 46, carbs_g: 82, fat_g: 22 } } }];
  if (/\b(hrv|sleep|recover|resting)/.test(q)) return [{ name: "show_trend", input: { metric: /sleep/.test(q) ? "sleep" : /resting/.test(q) ? "resting_hr" : "hrv", read: "Inside your usual range." } }];
  if (/\b(plan|week|compliance|on track)\b/.test(q)) return [{ name: "get_plan_compliance", input: { read: "The week as recorded." } }];
  if (/\b(today|ready|how do i look)\b/.test(q)) return [{ name: "show_today", input: { read: "Nothing here argues against training today." } }];
  return [{ name: "read_activities", input: { days: 14 } }];
}

/** What it does after reading a tool result, when the question needs a second step. */
function nextCalls(question: string, results: { content: string; is_error?: boolean }[], context: string): { name: string; input: unknown }[] {
  const q = question.toLowerCase(), text = results.map((r) => r.content).join("\n");
  if (results.some((r) => r.is_error)) return [];
  if (/\b(move|swap|reschedule|shift|push|remove|cancel|skip)\b/.test(q) && text.startsWith("Calendar ")) {
    const planned = [...text.matchAll(/planned: .*\[entry ([^\]]+)\]/g)].map((m) => m[1]);
    const future = planned.find((id) => { const d = /(\d{4}-\d{2}-\d{2})/.exec(id)?.[1]; return !d || d >= tomorrow(context, 0); }) ?? planned[planned.length - 1];
    if (!future) return [];
    const removing = /\b(remove|cancel|skip)\b/.test(q);
    return [{ name: "propose_plan_change", input: { title: removing ? "Take it off the calendar" : "Move it two days on", note: "As you asked.", changes: [removing ? { action: "remove", entry: future } : { action: "move", entry: future, new_date: tomorrow(context, 9) }] } }];
  }
  if (/\b(change|edit|shorten|lengthen|make it|rewrite)\b/.test(q) && text.startsWith("Calendar ")) {
    const id = [...text.matchAll(/planned: .*\[entry ((?:browser|coros)-[^\]]+)\]/g)].map((m) => m[1])[0];
    if (!id) return [];
    return [{ name: "read_workout", input: { entry: id } }];
  }
  if (/\b(change|edit|shorten|lengthen|make it|rewrite)\b/.test(q) && text.startsWith("Planned on ")) {
    const id = /\[entry ([^\]]+)\]/.exec(text)?.[1];
    const short = { ...RUN, name: "Tempo 2 × 2 km", blocks: RUN.blocks.map((b) => ("repeats" in b ? { ...b, repeats: 2 } : b)) };
    return id ? [{ name: "propose_workout_change", input: { entry: id, workout: short, note: "One block fewer, as you asked." } }] : [];
  }
  if (/\bcompare\b/.test(q) && text.includes("[id ")) {
    const ids = [...text.matchAll(/"Morning tempo".*\[id ([^\]]+)\]/g)].map((m) => m[1]);
    const any = [...text.matchAll(/\[id ([^\]]+)\]/g)].map((m) => m[1]);
    const pair = ids.length >= 2 ? ids : any;
    if (pair.length >= 2) return [{ name: "show_comparison", input: { after_activity_id: pair[0], before_activity_id: pair[1], read: "The same session, one week on." } }];
  }
  if (text.includes("[id ") && !/\bcompare\b/.test(q) && !text.startsWith("Calendar ")) {
    const run = /· Run · .*\[id ([^\]]+)\]/.exec(text) ?? /\[id ([^\]]+)\]/.exec(text);
    if (run) return [{ name: "show_workout_recap", input: { activity_id: run[1], read: "Your most recent run, as recorded." } }];
  }
  return [];
}

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });

async function say(text: string, request: ModelRequest): Promise<void> {
  for (const word of text.split(/(?<=\s)/)) {
    if (request.signal?.aborted) return;
    request.onText(word);
    await pause(18, request.signal);
  }
}

export function mockModel(delayMs = 350): CoachModel {
  let n = 0;
  return {
    async turn(request): Promise<ModelTurn> {
      const lastUser = [...request.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
      const question = textOf(lastUser), tail = request.messages[request.messages.length - 1];
      const results = resultsOf(tail), toolRounds = request.messages.filter((m) => Array.isArray(m.content) && m.role === "user").length;
      await pause(delayMs, request.signal);
      const wanted = !request.allowTools ? [] : results.length ? (toolRounds >= 3 ? [] : nextCalls(question, results, request.context)) : firstCalls(question, request.context);
      const calls: ToolCall[] = wanted.map((c) => ({ id: `mock_${++n}`, name: c.name, input: c.input }));
      let text = "";
      if (!calls.length) {
        const failed = results.find((r) => r.is_error);
        text = failed ? `That didn't work: ${failed.content.replace(/^Error: /, "")}`
          : results.some((r) => r.content.startsWith("awaiting_confirmation")) ? "I've put it up for you to check. Nothing changes until you press the button on the card."
          : results.some((r) => r.content.startsWith("waiting_for_athlete")) ? ""
          : results.length ? "That is what your own data shows. I'm the scripted dev model, so there is no real coaching in this sentence."
          : "I'm the scripted dev model. Ask about a workout, sleep, food, the plan, or to create a workout.";
        await say(text, request);
      }
      return {
        content: [...(text ? [{ type: "text", text }] : []), ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input }))],
        text, calls, stop: calls.length ? "tools" : "end", inputTokens: 0, outputTokens: 0,
      };
    },
  };
}
