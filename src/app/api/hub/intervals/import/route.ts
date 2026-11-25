// Importing one activity: its original file from intervals.icu, uploaded to the COROS account.
import { hubRoute, readBody, withSession } from "@/server/hub/http";
import { HubNotWired } from "@/server/hub/errors";
import { activityFileOf, stsRequestURL, timezoneQuarters, uploadActivityFile } from "@/server/hub/upload";
import { intervalsActivityId } from "@/server/intervals/client";
import { intervals, withLogin } from "@/server/intervals/http";

/**
 * `{ id, timezone }` (a `fileExt` sent along is ignored). Answers `{ importId }`. The file's type is read from its
 * bytes, and a region COROS uploads aren't connected for is refused before anything is downloaded.
 */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const id = intervalsActivityId(body.id), timezone = timezoneQuarters(body.timezone);
  return withSession((session) => withLogin(async (login) => {
    if (!stsRequestURL(session.baseURL)) throw new HubNotWired("Sending activities to COROS is connected for the Global and Europe regions only. Your COROS account is in another region.");
    const { ext, bytes } = activityFileOf(await intervals.file(login, id));
    return uploadActivityFile(session, { name: `clink-intervals-${id}.${ext}`, bytes }, { timezone });
  }));
});
