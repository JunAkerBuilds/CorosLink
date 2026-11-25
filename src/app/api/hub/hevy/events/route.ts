// One page of what changed in the person's Hevy workouts since a time: added, edited, deleted.
import { hubRoute } from "@/server/hub/http";
import { hevyPage, hevySince } from "@/server/hevy/client";
import { hevy, withLogin } from "@/server/hevy/http";
import { parseHevyEventsPage, type HevyEventsPage } from "@/lib/hevy";

/** `?since=<ISO time>&page=1…`. Answers `{ events, seen, pageCount, userId }`, newest change first. */
export const GET = hubRoute({}, async (request): Promise<HevyEventsPage & { userId: string }> => {
  const page = hevyPage(request.nextUrl.searchParams.get("page"));
  const since = hevySince(request.nextUrl.searchParams.get("since"));
  return withLogin(async (login) => ({ ...parseHevyEventsPage(await hevy().events(login.apiKey, since, page), page), userId: login.userId }));
});
