import type { RaceEntry, RaceOverview } from "../../electron/raceTypes";

const DAY = 86_400;

/**
 * A believable two-and-a-half-year race history for sample mode, dated
 * relative to today like the rest of the Training Hub sample data.
 */
export function createSampleRaceOverview(now = Date.now()): RaceOverview {
  const today = Math.floor(now / 1000);
  const ago = (days: number) => today - days * DAY;
  const race = (
    raceId: string,
    daysAgo: number,
    name: string,
    distanceKey: RaceEntry["distanceKey"],
    officialDistance: number,
    officialTime: number,
    extra: Partial<RaceEntry> = {}
  ): RaceEntry => ({
    raceId,
    source: "coros",
    name,
    startTime: ago(daysAgo),
    sportType: 100,
    distanceKey,
    distanceIsManual: false,
    officialDistance,
    officialTime,
    officialTimeIsManual: true,
    recordedDistance: officialDistance * 1.012,
    recordedTime: officialTime + 2,
    avgHr: 176,
    elevationGain: 34,
    buildUp: { weeks: 8, runs: 26, distance: 214_000, longestRun: 18_200, complete: true },
    ...extra
  });

  return {
    races: [
      race("sample:fall10k", 24, "Harvest Moon 10K", "10k", 10000, 2838, {
        placing: "61st of 1,204 · 9th M30–34",
        avgHr: 179,
        buildUp: { weeks: 8, runs: 31, distance: 262_000, longestRun: 21_100, complete: true }
      }),
      race("sample:summer5k", 104, "Canada Day 5K", "5k", 5000, 1331, {
        notes: "Went out in 4:15, held on.",
        buildUp: { weeks: 8, runs: 24, distance: 188_000, longestRun: 16_000, complete: true }
      }),
      race("sample:half", 166, "Spring Half Marathon", "half", 21097.5, 6315, {
        source: "strava",
        stravaActivityId: "1",
        stravaUrl: "https://www.strava.com/",
        avgHr: 168,
        elevationGain: 96,
        buildUp: { weeks: 8, runs: 33, distance: 298_000, longestRun: 22_400, complete: true }
      }),
      race("sample:winter5k", 260, "Frostbite 5K", "5k", 5000, 1402, {
        buildUp: { weeks: 8, runs: 19, distance: 141_000, longestRun: 14_000, complete: true }
      }),
      race("sample:10k-first", 420, "Waterfront 10K", "10k", 10000, 3125, {
        source: "strava",
        stravaActivityId: "2",
        stravaUrl: "https://www.strava.com/",
        buildUp: { weeks: 8, runs: 17, distance: 118_000, longestRun: 12_500, complete: true }
      }),
      race("sample:5k-second", 560, "Parkrun #42", "5k", 5000, 1515, {
        buildUp: { weeks: 8, runs: 12, distance: 76_000, longestRun: 10_000, complete: true }
      }),
      race("sample:5k-first", 860, "Community 5K", "5k", 5000, 1660, {
        source: "manual",
        recordedDistance: undefined,
        recordedTime: undefined,
        avgHr: undefined,
        elevationGain: undefined,
        notes: "First race ever.",
        buildUp: { weeks: 8, runs: 0, distance: 0, complete: false }
      })
    ],
    suggestions: [
      {
        activity: {
          activityId: "sample:suggestion",
          name: "Thanksgiving Trot",
          sportType: 100,
          startTime: ago(3),
          duration: 1358,
          distance: 5042,
          avgHr: 181
        },
        distanceKey: "5k",
        reasons: ["Named like a race", "38% quicker than your usual pace"]
      }
    ],
    strava: { connected: true, lastImportedAt: new Date(now - 2 * DAY * 1000).toISOString(), hiddenRaces: 0 }
  };
}
