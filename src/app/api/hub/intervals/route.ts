// The intervals.icu connection: is there one, make one, drop it. The API key goes in and never comes out.
import { hubRoute, readBody } from "@/server/hub/http";
import { intervalsAthlete, intervalsKey } from "@/server/intervals/client";
import { clearLogin, intervals, readLogin, shareLogin, statusOf, writeLogin } from "@/server/intervals/http";

/** `{ connected, athleteId? }`. */
export const GET = hubRoute({}, async () => statusOf(await readLogin()));

/** Connects after intervals.icu accepts the key for that athlete: `{ apiKey, athleteId }`. */
export const POST = hubRoute({ write: true }, async (request) => {
  const body = await readBody(request);
  const login = { apiKey: intervalsKey(body.apiKey), athleteId: intervalsAthlete(body.athleteId) };
  await intervals.check(login);
  await writeLogin(login);
  await shareLogin(login);
  return statusOf(login);
});

/** Disconnects, in this browser and through the person's account in their others. */
export const DELETE = hubRoute({ write: true }, async () => {
  await clearLogin();
  await shareLogin(null);
  return statusOf(null);
});
