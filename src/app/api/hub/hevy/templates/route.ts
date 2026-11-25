// One page of the person's Hevy exercise library, cut down to the one thing Strength needs from it: which
// exercises are assisted, so their weight isn't counted as weight lifted.
import { hubRoute } from "@/server/hub/http";
import { hevyPage } from "@/server/hevy/client";
import { hevy, withLogin } from "@/server/hevy/http";
import { parseHevyTemplatesPage, type HevyTemplatesPage } from "@/lib/hevy";

/** `?page=1…`. Answers `{ assisted, seen, pageCount, userId }`. */
export const GET = hubRoute({}, async (request): Promise<HevyTemplatesPage & { userId: string }> => {
  const page = hevyPage(request.nextUrl.searchParams.get("page"));
  return withLogin(async (login) => ({ ...parseHevyTemplatesPage(await hevy().templates(login.apiKey, page), page), userId: login.userId }));
});
