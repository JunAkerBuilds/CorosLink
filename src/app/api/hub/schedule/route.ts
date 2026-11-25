// Planned workouts on the COROS calendar: add, edit, remove.
import { remove, schedule, scheduledOne, update } from "@/server/hub/calendar";
import { hub, hubRoute, readBody, withSession } from "@/server/hub/http";
import { corosId, day, flag, plainText, workout } from "@/server/hub/validate";

const units = (body: Record<string, unknown>) => ({ imperial: flag(body.imperial), pounds: flag(body.pounds) });

/** Puts a new workout on a day: `{ day, workout, imperial?, pounds? }`. Answers `{ idInPlan }`. */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const on = day(body.day), planned = workout(body.workout);
  return { idInPlan: await withSession((session) => schedule(hub, session, planned, on, units(body))) };
});

/** Replaces a planned workout's steps, name and description: `{ day, idInPlan, name, workout, imperial?, pounds? }`. */
export const PUT = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const where = { day: day(body.day), idInPlan: corosId(body.idInPlan, "The workout"), name: plainText(body.name ?? "", "The workout's name", 200) };
  const edited = workout(body.workout);
  await withSession((session) => update(hub, session, where, edited, units(body)));
  return { ok: true };
});

/** Takes a planned workout off the calendar: `?day=&idInPlan=&name=`. */
export const DELETE = hubRoute({ write: true }, async (request) => {
  const query = request.nextUrl.searchParams;
  const on = day(query.get("day")), id = corosId(query.get("idInPlan"), "The workout"), name = plainText(query.get("name") ?? "", "The workout's name", 200);
  await withSession(async (session) => remove(hub, session, await scheduledOne(hub, session, on, id, name)));
  return { ok: true };
});
