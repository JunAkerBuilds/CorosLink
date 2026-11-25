// Logging an activity after the fact: a one-lap TCX file built here and uploaded to the COROS account.
import { HubInvalid } from "@/server/hub/errors";
import { hubRoute, readBody, withSession } from "@/server/hub/http";
import { timezoneQuarters, uploadActivityFile } from "@/server/hub/upload";
import { buildManualTcx, cleanManualActivity } from "@/lib/tcx";

/**
 * `{ sport: "run" | "bike" | "other", startTimeIso, durationSec, distanceM, calories?, avgHr?, timezone }`.
 * Answers `{ importId }`. COROS reads the file afterwards, so the activity shows up a little later.
 */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const activity = cleanManualActivity(body);
  if (typeof activity === "string") throw new HubInvalid(activity);
  const timezone = timezoneQuarters(body.timezone);
  const bytes = new TextEncoder().encode(buildManualTcx(activity));
  return withSession((session) => uploadActivityFile(session, { name: `clink-manual-${Date.now()}.tcx`, bytes }, { timezone }));
});
