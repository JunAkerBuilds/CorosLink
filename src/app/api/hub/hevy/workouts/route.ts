// One page of the person's completed Hevy workouts, newest first, cut down to what Strength uses.
import { hubRoute } from "@/server/hub/http";
import { hevyPage } from "@/server/hevy/client";
import { hevy, withLogin } from "@/server/hevy/http";
import { parseHevyWorkoutsPage, type HevyWorkoutsPage } from "@/lib/hevy";

/** `?page=1…`. Answers `{ workouts, seen, pageCount, userId }`; `userId` says whose workouts they are. */
export const GET = hubRoute({}, async (request): Promise<HevyWorkoutsPage & { userId: string }> => {
  const page = hevyPage(request.nextUrl.searchParams.get("page"));
  return withLogin(async (login) => ({ ...parseHevyWorkoutsPage(await hevy().workouts(login.apiKey, page), page), userId: login.userId }));
});
