/** The Sports pages for the sample athlete: the same maths as a synced athlete's, run over the sample activities. */
import { SAMPLE_TODAY } from "@/data/core";
import type { Sports } from "@/data/sports";
import { dateToRef, type NativeActivity, type NativeSport } from "@/data/sync/native";
import { sportsFromItems } from "@/data/sync/sports";
import { SAMPLE_ACTIVITIES, SAMPLE_THRESHOLDS } from "./activities";

const NATIVE: Record<string, NativeSport> = { Run: "run", Ride: "bike", Swim: "poolSwim", Strength: "strength", Other: "other" };

export function sampleSports(): Sports {
  const activities: NativeActivity[] = SAMPLE_ACTIVITIES.map((a) => ({
    id: a.id, name: a.name, sport: NATIVE[a.sport] ?? "other", start: dateToRef(new Date(a.start)),
    distanceMeters: a.distanceM ?? undefined, durationSeconds: a.durationS, averageHR: a.avgHr ?? undefined,
    elevationGain: a.elevationGainM ?? undefined, trainingLoad: a.load ?? undefined,
  }));
  const now = new Date(SAMPLE_TODAY.getFullYear(), SAMPLE_TODAY.getMonth(), SAMPLE_TODAY.getDate(), 20, 0);
  return sportsFromItems({
    activities, details: [], gym: [], planned: [],
    training: { thresholdHr: SAMPLE_THRESHOLDS.hr, ftp: SAMPLE_THRESHOLDS.ftp, maxHr: SAMPLE_THRESHOLDS.maxHr },
    body: { weightKg: SAMPLE_THRESHOLDS.weightKg },
  }, now);
}
