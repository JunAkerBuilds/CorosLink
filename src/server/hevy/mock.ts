// A stand-in for Hevy's API in development: it answers the same four GETs from made-up workouts, in Hevy's own
// JSON. Used only with `HEVY_API=mock` in development, never in a production build,
// and the Connections card says "Dev mock" while it is on. A key containing "refused" is refused, and one
// containing "flaky" connects but fails when workouts are read, so those screens can be seen too.
import { seedItems } from "@/data/sampleSeed";
import { refToMs, type NativeGymWorkout } from "@/data/sync/native";

const DAY = 86_400_000;

const TEMPLATES = [
  { id: "79D0BB3A", title: "Bench Press (Barbell)", type: "weight_reps" },
  { id: "D04AC939", title: "Squat (Barbell)", type: "weight_reps" },
  { id: "C6272009", title: "Deadlift (Barbell)", type: "weight_reps" },
  { id: "7B8D84E8", title: "Overhead Press (Barbell)", type: "weight_reps" },
  { id: "A1PULLUP", title: "Pull Up (Assisted)", type: "bodyweight_assisted_reps" },
  { id: "C6C9B8A0", title: "Plank", type: "duration" },
];

const set = (index: number, type: string, weight_kg: number | null, reps: number | null, duration_seconds: number | null = null) =>
  ({ index, type, weight_kg, reps, distance_meters: null, duration_seconds, rpe: null, custom_metric: null });

function lifts(index: number, templateIndex: number, top: number, reps: number) {
  const t = TEMPLATES[templateIndex];
  return {
    index, title: t.title, notes: "", exercise_template_id: t.id, superset_id: null,
    sets: [set(0, "warmup", Math.round(top * 0.5), 8), set(1, "normal", top, reps), set(2, "normal", top, reps), set(3, "normal", top, reps - 1)],
  };
}

function workout(id: string, title: string, start: number, minutes: number, exercises: unknown[]) {
  const iso = (ms: number) => new Date(ms).toISOString();
  return { id, title, routine_id: null, description: "", start_time: iso(start), end_time: iso(start + minutes * 60_000), updated_at: iso(start + minutes * 60_000), created_at: iso(start + minutes * 60_000), exercises };
}

/** 26 workouts over the last 13 weeks, newest first, two of them ones the seeded phone already holds. */
export function mockHevyWorkouts(now: Date): unknown[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out: { start_time: string }[] = [];
  for (let k = 0; k < 26; k += 1) {
    const week = Math.floor(k / 2), upper = k % 2 === 0;
    const start = today - (week * 7 + (upper ? 2 : 5)) * DAY + 7 * 3_600_000;
    const up = (12 - week) * 0.625;
    const id = `0f3c5a10-${String(k).padStart(4, "0")}-4b6e-9d21-5e7a1c0b9f${String(k).padStart(2, "0")}`;
    out.push(upper
      ? workout(id, "Hevy push and pull", start, 58, [
        lifts(0, 0, 70 + Math.round(up * 2) / 2, 5), lifts(1, 3, 42.5 + Math.round(up) / 2, 6),
        { index: 2, title: TEMPLATES[4].title, notes: "", exercise_template_id: TEMPLATES[4].id, superset_id: null, sets: [set(0, "normal", 20, 8), set(1, "normal", 20, 7)] },
      ])
      : workout(id, "Hevy legs", start, 64, [
        lifts(0, 1, 95 + Math.round(up * 4) / 2, 5), lifts(1, 2, 120 + Math.round(up * 4) / 2, 3),
        { index: 2, title: TEMPLATES[5].title, notes: "", exercise_template_id: TEMPLATES[5].id, superset_id: null, sets: [set(0, "normal", null, null, 60), set(1, "normal", null, null, 45)] },
      ]));
  }
  // The same workouts the phone would already hold: one it imported from Hevy (same id), one logged in C-LINK at the same time.
  const phone = seedItems(now).filter((i) => i.collection === "gym.workout").map((i) => i.body as NativeGymWorkout).sort((a, b) => b.start - a.start);
  if (phone[0]) out.push(workout(phone[0].id.toLowerCase(), "Imported by the phone", refToMs(phone[0].start), 50, [lifts(0, 0, 80, 5)]));
  if (phone[1]) out.push(workout("0f3c5a10-9999-4b6e-9d21-5e7a1c0b9f99", "Also logged in C-LINK", refToMs(phone[1].start) + 5 * 60_000, 40, [lifts(0, 1, 100, 5)]));
  return out.sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

/** A `fetch` that answers as Hevy would. */
export const mockHevyFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const key = (init?.headers as Record<string, string> | undefined)?.["api-key"] ?? "";
  if (key.includes("refused")) return json({ error: "Invalid API key" }, 401);
  const page = Number(url.searchParams.get("page") ?? 1), size = Number(url.searchParams.get("pageSize") ?? 10);
  const paged = (name: string, all: unknown[]) => json({ page, page_count: Math.max(1, Math.ceil(all.length / size)), [name]: all.slice((page - 1) * size, page * size) });
  switch (url.pathname) {
    case "/v1/user/info": return json({ data: { id: "dev-hevy-user", name: "dev", url: "https://hevy.com/user/dev" } });
    case "/v1/exercise_templates": return paged("exercise_templates", TEMPLATES);
    case "/v1/workouts": return key.includes("flaky") ? json({ error: "Internal error" }, 500) : paged("workouts", mockHevyWorkouts(new Date()));
    case "/v1/workouts/events": return key.includes("flaky") ? json({ error: "Internal error" }, 500) : paged("events", []);
    default: return json({ error: "Not found" }, 404);
  }
};
