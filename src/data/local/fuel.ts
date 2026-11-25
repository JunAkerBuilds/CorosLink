"use client";
import { useSyncExternalStore } from "react";
import { SAMPLE_TODAY } from "@/data/core";
import type { DayLog } from "@/data/fuel";
import { createStore } from "@/data/local/store";
import { dayKey } from "@/lib/format";

/** Food logged at a desk, by day (YYYY-MM-DD). A day is in here from the first change made to it. */
export type SavedDays = Record<string, DayLog>;

export const NO_DAYS: SavedDays = {};
export const fuelDays = createStore<SavedDays>("fuel.days", NO_DAYS);

const never = () => () => {};
const sampleToday = dayKey(SAMPLE_TODAY);

/** Today's calendar day in this browser. Renders the sample athlete's today on the server and for the first paint. */
export function useToday(): string {
  return useSyncExternalStore(never, () => dayKey(new Date()), () => sampleToday);
}
