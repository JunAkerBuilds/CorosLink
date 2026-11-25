// The activities COROS has recorded, as far as matching needs them: start, elapsed time and distance.
// Ported from the desktop app's Training Hub activity list (activity/query, filtered by startDay / endDay).
import type { MatchableActivity } from "@/lib/intervals";
import type { HubSession, TrainingHub } from "./client";
import { at, list, num, type Json } from "./json";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** One page of `activity/query` as matchable activities. Times are whole seconds; the start is seconds since 1970. */
export function parseRecorded(raw: Json | undefined): MatchableActivity[] {
  return (list(at(raw, "dataList")) ?? []).map((item) => ({
    startEpochMs: (num(at(item, "startTime")) ?? 0) * 1000,
    movingSec: num(at(item, "totalTime")) ?? 0,
    distanceM: num(at(item, "distance")) ?? 0,
  }));
}

/** Every activity from `fromDay` to `toDay` (both `YYYYMMDD`), paged until a short page ends the list. */
export async function recorded(hub: TrainingHub, session: HubSession, fromDay: string, toDay: string): Promise<MatchableActivity[]> {
  const all: MatchableActivity[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const raw = await hub.get("activity/query", { size: String(PAGE_SIZE), pageNumber: String(page), startDay: fromDay, endDay: toDay }, session);
    const batch = parseRecorded(raw);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}
