// Coach's own reads from COROS Training Hub, for the athlete it is answering. The session is the one the athlete
// shares between phone and web through their account (the `hub.session` sync item, docs/sync-contract.md 5.8):
// the Coach route already reads the account's items with the athlete's token, so it finds it there. The token
// stays in this file: it never reaches the model, the tools or the browser. Everything here only reads; what
// Coach proposes is written by the browser through /api/hub, after the athlete presses the card's button.
import type { HubCalendarDay, HubExercise, HubSavedWorkout } from "@/data/hub";
import type { Row } from "@/lib/coach/items";
import type { HubLoaders } from "@/lib/coach/tools";
import { exercises, library, libraryProgram, scheduled, toPlanned } from "@/server/hub/calendar";
import { HUB_REGIONS, TrainingHub, type HubSession } from "@/server/hub/client";

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value !== "" && value.length <= max;

/** The shared session among the account's items, or null unless it is whole and on one of COROS's own hosts. */
export function sharedSession(rows: readonly Row[]): HubSession | null {
  const body = rows.find((r) => r.collection === "hub.session" && r.id === "me")?.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") return null;
  const { accessToken, userId, regionId, baseURL } = body;
  if (!isText(accessToken, 4096) || !isText(userId, 64) || typeof regionId !== "string" || regionId.length > 16) return null;
  if (typeof baseURL !== "string" || !HUB_REGIONS.includes(baseURL)) return null;
  return { accessToken, userId, regionId, baseURL };
}

const two = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;

/** Why a Hub read failed, in words for the model. Never the token, never COROS's raw answer. */
const reason = (error: unknown): string => (error instanceof Error && error.name.startsWith("Hub") ? error.message : "COROS couldn't be reached.").slice(0, 200);

/** The COROS calendar from `from` to `to`, every day present. */
export async function calendarDays(session: HubSession, from: string, to: string, hub: TrainingHub = new TrainingHub()): Promise<HubCalendarDay[]> {
  const entries = await scheduled(hub, session, from, to);
  const days: HubCalendarDay[] = [];
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000) days.push({ day: key(new Date(at)), workouts: [] });
  const byDay = new Map(days.map((day) => [day.day, day]));
  for (const entry of entries.workouts) byDay.get(entry.day)?.workouts.push(toPlanned(entry));
  return days;
}

/**
 * The reads Coach's tools may ask for while answering, each made at most once per answer. A failure is
 * returned as words, so the tool can tell the model what it couldn't read.
 */
export function hubLoaders(session: HubSession, hub: TrainingHub = new TrainingHub()): HubLoaders {
  const once = <T,>(load: () => Promise<T>): (() => Promise<T | { problem: string }>) => {
    let made: Promise<T | { problem: string }> | null = null;
    return () => (made ??= load().catch((error: unknown) => ({ problem: reason(error) })));
  };
  const catalog = once<HubExercise[]>(() => exercises(hub, session, "strength"));
  const saved = once<HubSavedWorkout[]>(() => library(hub, session));
  return {
    catalog, library: saved,
    libraryWorkout: (id) => libraryProgram(hub, session, id).catch((error: unknown) => ({ problem: reason(error) })),
  };
}
