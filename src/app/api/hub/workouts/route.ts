// The COROS saved-workout library.
import { addToLibrary, library, libraryProgram, removeFromLibrary } from "@/server/hub/calendar";
import { HubInvalid } from "@/server/hub/errors";
import { hub, hubRoute, readBody, withSession } from "@/server/hub/http";
import { hubTotals, hubWorkoutProblem } from "@/server/hub/rules";
import { corosId, flag, workout } from "@/server/hub/validate";

/** The saved workouts (summaries; steps only when COROS lists them), or with `?id=` one of them with its steps. */
export const GET = hubRoute({}, async (request) => {
  const id = request.nextUrl.searchParams.get("id");
  if (id !== null) {
    const wanted = corosId(id, "The saved workout");
    return { workout: await withSession((session) => libraryProgram(hub, session, wanted)) };
  }
  return { workouts: await withSession((session) => library(hub, session)) };
});

const units = (body: Record<string, unknown>) => ({ imperial: flag(body.imperial), pounds: flag(body.pounds) });

/** Saves a new workout to the library: `{ workout, imperial?, pounds? }`. Answers the saved workout. */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const wanted = workout(body.workout);
  const problem = hubWorkoutProblem(wanted, () => false);
  if (problem) throw new HubInvalid(problem);
  return {
    workout: await withSession(async (session) => {
      const id = await addToLibrary(hub, session, wanted, units(body));
      // The steps as sent: COROS's own copy is read when the library is next opened.
      return { id, name: wanted.name, sportCode: null, sport: wanted.sport, hasSteps: true, workout: wanted, totals: hubTotals(wanted) };
    }),
  };
});

/** Takes a saved workout out of the library: `?id=`. */
export const DELETE = hubRoute({ write: true }, async (request) => {
  const id = corosId(request.nextUrl.searchParams.get("id"), "The saved workout");
  await withSession((session) => removeFromLibrary(hub, session, id));
  return { ok: true };
});
