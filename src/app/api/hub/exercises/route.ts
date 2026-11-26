// COROS's exercise catalog for strength workouts and HYROX stations.
import { exercises } from "@/server/hub/calendar";
import { HubInvalid } from "@/server/hub/errors";
import { hub, hubRoute, withSession } from "@/server/hub/http";
import { HUB_SPORTS } from "@/server/hub/rules";
import { t } from "@/lib/i18n";

/** `?sport=strength|hyrox` (other sports have no catalog and answer an empty list). */
export const GET = hubRoute({}, async (request) => {
  const sport = HUB_SPORTS.find((known) => known === (request.nextUrl.searchParams.get("sport") ?? "strength"));
  if (!sport) throw new HubInvalid(t("That sport isn't one this app knows."));
  return { exercises: await withSession((session) => exercises(hub, session, sport)) };
});
