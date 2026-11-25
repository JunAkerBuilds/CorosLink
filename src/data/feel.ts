"use client";
// Today's feel check from the web: the same `feel.check` item the phone writes. The phone scores readiness
// with it when it next syncs.
import { NotWiredError } from "@/data/core";
import { put, syncView } from "@/data/sync";
import { calendarDayOf } from "@/data/sync/native";
import { isDayKey } from "@/lib/calendar";

const TAGS = new Set(["sore", "stressed", "unwell", "heavyLegs"]);

export async function setFeel(day: string, level: number, tags: readonly string[]): Promise<void> {
  if (!isDayKey(day)) throw new Error("Pick a day.");
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error("Pick how you feel, 1 to 5.");
  if (!(await syncView())) throw new NotWiredError("feel.check", "C-LINK is still starting. Try again in a moment.");
  put("feel.check", day, { day: calendarDayOf(day), feel: level, tags: [...new Set(tags)].filter((t) => TAGS.has(t)).sort() });
}
