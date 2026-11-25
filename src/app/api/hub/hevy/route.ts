// The Hevy connection: is there one, make one, drop it. The API key goes in and never comes out.
import { hubRoute, readBody } from "@/server/hub/http";
import { hevyKey } from "@/server/hevy/client";
import { clearLogin, hevy, readLogin, shareLogin, statusOf, writeLogin } from "@/server/hevy/http";

/**
 * `{ connected, userId?, name?, profileUrl? }`. Reads the sealed cookie; Hevy is only asked whose key it is
 * the first time after the key came from the person's phone.
 */
export const GET = hubRoute({}, async () => statusOf(await readLogin()));

/** Connects after Hevy accepts the key: `{ apiKey }`. */
export const POST = hubRoute({ write: true }, async (request) => {
  const apiKey = hevyKey((await readBody(request)).apiKey);
  const identity = await hevy().identity(apiKey);
  await writeLogin({ apiKey, ...identity });
  await shareLogin({ apiKey, ...identity });
  return statusOf(identity);
});

/**
 * Disconnects: here, and through the store on this computer on the paired phone too. The page
 * erases its copy of the workouts itself.
 */
export const DELETE = hubRoute({ write: true }, async () => {
  await clearLogin();
  await shareLogin(null);
  return statusOf(null);
});
