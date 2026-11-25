// The COROS calendar's planned workouts for a range of days.
import { scheduled, toPlanned } from "@/server/hub/calendar";
import { hub, hubRoute, withSession } from "@/server/hub/http";
import { dayRange } from "@/server/hub/validate";
import type { HubCalendarDay } from "@/data/hub";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (at most 400 days): every day in the range, in order, with its workouts. */
export const GET = hubRoute({}, async (request): Promise<{ days: HubCalendarDay[] }> => {
  const query = request.nextUrl.searchParams;
  const { from, to } = dayRange(query.get("from"), query.get("to"));
  const entries = await withSession((session) => scheduled(hub, session, from, to));
  const days: HubCalendarDay[] = [];
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000) {
    days.push({ day: new Date(at).toISOString().slice(0, 10), workouts: [] });
  }
  const byDay = new Map(days.map((day) => [day.day, day]));
  for (const entry of entries.workouts) byDay.get(entry.day)?.workouts.push(toPlanned(entry));
  return { days };
});
