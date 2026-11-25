// Moving a planned workout to another day.
import { moveScheduled, newMove } from "@/server/hub/calendar";
import { HubInvalid } from "@/server/hub/errors";
import { hub, hubRoute, readBody, withSession } from "@/server/hub/http";
import { corosId, day, moveProgress, plainText } from "@/server/hub/validate";

/**
 * `{ from, to, idInPlan, name }` starts a move; `{ move }` picks up one that stopped part-way (the `move` a
 * failed answer carried). Answers `{ move }`, whose `newIdInPlan` is the workout's ID on its new day.
 */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const start = body.move !== undefined && body.move !== null
    ? moveProgress(body.move)
    : newMove(day(body.from, "from"), day(body.to, "to"), plainText(body.name ?? "", "The workout's name", 200),
        body.idInPlan === undefined || body.idInPlan === null ? null : corosId(body.idInPlan, "The workout"));
  if (start.idInPlan === null && start.name === "") throw new HubInvalid("Say which workout to move.");
  return { move: await withSession((session) => moveScheduled(hub, session, start)) };
});
