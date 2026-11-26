// intervals.icu's activities for a range of days, each marked with whether COROS already has it.
import { recorded } from "@/server/hub/activities";
import { HubInvalid } from "@/server/hub/errors";
import { hub, hubRoute, withSession } from "@/server/hub/http";
import { intervals, withLogin } from "@/server/intervals/http";
import { importWindow, isImportDays, parseIntervalsActivities, withStatus, type IntervalsRow } from "@/lib/intervals";
import { t } from "@/lib/i18n";

/** `?days=7|30|90|365`. Needs both the intervals.icu connection and the COROS sign-in. */
export const GET = hubRoute({}, async (request): Promise<{ activities: IntervalsRow[] }> => {
  const days = Number(request.nextUrl.searchParams.get("days"));
  if (!isImportDays(days)) throw new HubInvalid(t("Pick 7, 30, 90 or 365 days."));
  const window = importWindow(days);
  return withSession((session) => withLogin(async (login) => {
    const listed = parseIntervalsActivities(await intervals.list(login, window.oldest, window.newest));
    const onCoros = await recorded(hub, session, window.corosFrom, window.corosTo);
    return { activities: withStatus(listed, onCoros) };
  }));
});
