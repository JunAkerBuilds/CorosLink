// The health sync items and health.json: CorosKit's SyncBodiesTests (SyncHealthFilterTests) and TrainingInsightsTests
// (merging over the cache, old caches decoding), ported; then the whole path checked against CorosKit's own output.
// fixtures/health-coroskit.json was written by CorosKit (a scratch Swift program, run once) from the health-daily-*.bin
// files: WatchHealth.record for each read, JSONEncoder for health.json, SyncBodies.healthDays/healthNights for the items.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "@/data/sync/canonical";
import { parseDailyHistory } from "./dailyHistory";
import { healthDays, healthNights } from "./healthItems";
import {
  type ActivitySummary, type DayVitals, type SleepNight, type TrainingInsights, addingDays, decodeInsights, isScoreOnly, mergedOver,
  newInsights, utcCalendar, withoutOtherHealthSources,
} from "./insights";
import { type CalendarDay, dayKey, dayText } from "./native";
import {
  decodeHealth, encodeHealth, healthFromJSON, healthToJSON, newWatchHealth, parsePedometer, recordDailyHistory, recordPedometer, recordProfile,
} from "./watchHealth";

const today: CalendarDay = { year: 2026, month: 11, day: 20 };
const ago = (days: number): CalendarDay => addingDays(today, -days);

describe("health items leave out other sources", () => {
  /** COROS and watch values that may go, and Apple Health values (all 9xx, "Oura", 99) that must not. */
  const insights = (): TrainingInsights => {
    const watchDay: DayVitals = { day: ago(1), steps: 8000, calories: 500, restingHR: 48, hrv: 62, sleepMinutes: 420, sleepScore: 84, stress: 30 };
    const mixedDay: DayVitals = { day: today, steps: 7412, restingHR: 951, hrv: 962, sleepMinutes: 973, sleepScore: 99, restingHRSource: "appleHealth", hrvSource: "appleHealth" };
    const healthOnlyDay: DayVitals = { day: ago(2), restingHR: 952, hrv: 963, restingHRSource: "appleHealth", hrvSource: "appleHealth" };
    const watchNight: SleepNight = { day: ago(1), totalMinutes: 420, score: 84, deepMinutes: 80 };
    const healthNight: SleepNight = { day: today, totalMinutes: 973, score: 99, deepMinutes: 981, averageHR: 944, source: "appleHealth", sourceApp: "Oura" };
    return newInsights(new Date(), {
      days: [healthOnlyDay, watchDay, mixedDay], nights: [watchNight, healthNight],
      hrv: { day: today, average: 962, baseline: 960, rangeLow: 955, rangeHigh: 965 }, hrvBaseline: 960,
    });
  };

  it("sends nothing from Apple Health", () => {
    const items = [...healthDays(insights(), today), ...healthNights(insights(), today)];
    const text = items.map((i) => canonical(i.body)).join("\n");
    for (const leak of ["951", "952", "962", "963", "973", "981", "944", "99", "Oura", "appleHealth", "Source", "960"]) expect(text).not.toContain(leak);
    // What the watch and COROS measured still goes.
    expect(new Set(items.map((i) => `${i.collection}/${i.id}`))).toEqual(new Set(["health.day/2026-11-19", "health.day/2026-11-20", "health.night/2026-11-19"]));
    const mixed = items.find((i) => i.collection === "health.day" && i.id === "2026-11-20")!;
    expect(canonical(mixed.body)).toBe(`{"day":{"day":20,"month":11,"year":2026},"steps":7412}`);
    const watch = items.find((i) => i.collection === "health.day" && i.id === "2026-11-19")!;
    expect([watch.body.hrv, watch.body.restingHR, watch.body.sleepScore]).toEqual([62, 48, 84]);
  });

  it("leaves the filtered insights with no other source", () => {
    const clean = withoutOtherHealthSources(insights());
    expect(clean.nights.every((n) => n.source === undefined && n.sourceApp === undefined)).toBe(true);
    expect(clean.days.every((d) => d.hrvSource === undefined && d.restingHRSource === undefined)).toBe(true);
    // Apple Health's HRV sets the status and baseline too.
    expect(clean.hrv === undefined && clean.hrvBaseline === undefined).toBe(true);
    expect(clean.days.find((d) => dayKey(d.day) === dayKey(today))?.sleepMinutes).toBeUndefined();
    // Untouched when nothing came from elsewhere.
    const own = insights();
    own.days = own.days.filter((d) => d.hrvSource === undefined);
    own.nights = own.nights.filter((n) => n.source === undefined);
    expect(withoutOtherHealthSources(own)).toEqual(own);
  });

  it("sends only the last 400 days", () => {
    const days = Array.from({ length: 450 }, (_, i): DayVitals => ({ day: ago(i), steps: 1000 + i })).reverse();
    const nights = Array.from({ length: 450 }, (_, i): SleepNight => ({ day: ago(i), totalMinutes: 400 })).reverse();
    const all = newInsights(new Date(), { days, nights });
    const sent = healthDays(all, today);
    expect(sent.length).toBe(400);
    expect(sent[0].id).toBe(dayText(ago(399)));
    expect(sent.at(-1)?.id).toBe("2026-11-20");
    expect(healthNights(all, today).length).toBe(400);
    // A day with nothing measured isn't an item.
    expect(healthDays(newInsights(new Date(), { days: [{ day: today }] }), today)).toEqual([]);
  });
});

describe("insights kept between reads", () => {
  const now = new Date(1_792_000_000_000);
  const d = (text: string): CalendarDay => { const [year, month, day] = text.split("-").map(Number); return { year, month, day }; };
  const activity = (id: string, name: string, sport: string, start?: number, trainingLoad?: number): ActivitySummary =>
    ({ id, name, sport, start: start === undefined ? undefined : new Date(start * 1000), trainingLoad });

  /** What was kept stays when it's no longer sent; what's read now wins. */
  it("merges a read over the cache", () => {
    const [d1, d2, d3] = [d("2026-08-01"), d("2026-10-14"), d("2026-10-15")];
    const previous = newInsights(new Date(now.getTime() - 3600_000), {
      recovery: { percent: 70 },
      days: [{ day: d1, steps: 9000 }, { day: d2, steps: 100, restingHR: 50 }],
      nights: [{ day: d1, totalMinutes: 400 }, { day: d2, totalMinutes: 420, score: 80 }],
      fitness: { vo2max: 52, predictions: [] },
      activities: [activity("old", "Run", "run", 1_780_000_000, 60), activity("gone", "Run", "run", 1_791_950_000)],
      healthChecks: [{ time: new Date(1_780_000_000_000), spo2: 97 }],
    });
    const current = newInsights(now, {
      days: [{ day: d2, steps: 12000 }, { day: d3, steps: 500 }],
      nights: [{ day: d2, score: 81 }],
      activities: [activity("new", "Ride", "bike", 1_792_000_000), activity("mid", "Ride", "bike", 1_791_900_000)],
      healthChecks: [{ time: new Date(1_792_000_000_000), spo2: 98 }],
    });
    const merged = mergedOver(current, previous, utcCalendar);
    expect(merged.fetchedAt).toEqual(now);
    expect(merged.recovery?.percent).toBe(70); // an hour-old recovery still counts
    expect(merged.fitness?.vo2max).toBe(52);
    expect(merged.days.map((x) => x.day)).toEqual([d1, d2, d3]);
    expect(merged.days.map((x) => x.steps)).toEqual([9000, 12000, 500]);
    expect(merged.days[1].restingHR).toBe(50); // a value this answer lacks comes from the cache
    expect(merged.nights.map((x) => x.day)).toEqual([d1, d2]);
    expect(merged.nights[1]).toEqual({ day: d2, score: 81 }); // a night sent again replaces the cached one
    // "gone" fell inside the list's window but isn't listed any more.
    expect(merged.activities.map((a) => a.id)).toEqual(["new", "mid", "old"]);
    expect(merged.activities[2].trainingLoad).toBe(60);
    expect(merged.healthChecks.map((c) => c.spo2)).toEqual([97, 98]);

    const stale = { ...previous, fetchedAt: new Date(now.getTime() - 86_400_000) };
    expect(mergedOver(current, stale, utcCalendar).recovery).toBeUndefined(); // yesterday's recovery isn't today's
    // Every tool failed: the cache stands, activities and all.
    const empty = mergedOver(newInsights(now), previous, utcCalendar);
    expect(empty.activities.map((a) => a.id)).toEqual(["gone", "old"]);
    expect(empty.days.length).toBe(2);
  });

  it("decodes a cache from before stress samples and health checks", () => {
    const json = `{"fetchedAt":0,"days":[{"day":{"year":2026,"month":10,"day":15},"steps":812}],"nights":[{"day":{"year":2026,"month":10,"day":15},"score":84}],"activities":[]}`;
    const insights = decodeInsights(JSON.parse(json));
    expect(insights.days[0].steps).toBe(812);
    expect(insights.days[0].exerciseMinutes).toBeUndefined();
    expect(insights.nights[0].score).toBe(84);
    expect(isScoreOnly(insights.nights[0])).toBe(true);
    expect(insights.stressSamples).toEqual([]);
    expect(insights.healthChecks).toEqual([]);
    expect(insights.activityListCut).toBe(false);
  });
});

describe("the whole path, against CorosKit", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  const bin = (name: string): Uint8Array => readFileSync(new URL(name, dir));
  const swift = JSON.parse(readFileSync(new URL("health-coroskit.json", dir), "utf8")) as Record<string, unknown>;
  type Item = { collection: string; id: string; body: string };
  const items = (health: ReturnType<typeof newWatchHealth>, day: CalendarDay): Item[] =>
    [...healthDays(health.insights, day), ...healthNights(health.insights, day)].map((i) => ({ collection: i.collection, id: i.id, body: canonical(i.body) }));
  const le32 = (values: number[]): Uint8Array => { const b = new Uint8Array(values.length * 4); values.forEach((v, i) => new DataView(b.buffer).setInt32(i * 4, v, true)); return b; };

  /** The synthetic file at UTC+7, a pedometer read, the training profile, then a later file. */
  function one() {
    const health = newWatchHealth();
    const steps = new Uint8Array([...le32([8_412, 612_300, 386_400, 3_240]), 1, 2, 0, 0]);
    recordPedometer(health, parsePedometer(steps), new Date(1_767_320_000_000), utcCalendar);
    recordDailyHistory(health, parseDailyHistory(bin("health-daily-1.bin")), { weightKg: 72, schedule: { bedtime: 22 * 60 + 30, wake: 6 * 60 + 45 } },
      new Date(1_767_330_000_000), utcCalendar);
    recordProfile(health, { maxHR: 196, thresholdHR: 171, ftp: 250 });
    recordDailyHistory(health, parseDailyHistory(bin("health-daily-2.bin")), undefined, new Date(1_767_340_000_000), utcCalendar);
    return health;
  }

  /** A night with stress, then the file started again with two naps. */
  function two() {
    const oct31 = Date.UTC(2026, 9, 31);
    const health = newWatchHealth();
    recordDailyHistory(health, parseDailyHistory(bin("health-daily-3.bin")), undefined, new Date(oct31 + 7 * 3600_000), utcCalendar);
    const afterNight = canonical(healthToJSON(health));
    recordDailyHistory(health, parseDailyHistory(bin("health-daily-4.bin")), undefined, new Date(oct31 + (16 * 3600 + 600) * 1000), utcCalendar);
    return { health, afterNight };
  }

  it("keeps health.json as CorosKit's JSONEncoder writes it", () => {
    expect(canonical(healthToJSON(one()))).toBe(canonical(swift.one));
    const { health, afterNight } = two();
    expect(afterNight).toBe(canonical(swift.twoAfterNight));
    expect(canonical(healthToJSON(health))).toBe(canonical(swift.two));
    expect(canonical(healthToJSON(newWatchHealth()))).toBe(canonical(swift.empty));
  });

  it("makes the health.day and health.night items CorosKit makes", () => {
    expect(items(one(), { year: 2026, month: 1, day: 2 })).toEqual(swift.oneItems);
    expect(items(two().health, { year: 2026, month: 10, day: 31 })).toEqual(swift.twoItems);
  });

  it("reads a health.json the CorosKit helper wrote, and writes it back the same", () => {
    for (const key of ["one", "two", "twoAfterNight", "empty"]) {
      const health = decodeHealth(JSON.stringify(swift[key]));
      expect(canonical(JSON.parse(encodeHealth(health)))).toBe(canonical(swift[key]));
    }
    // A read on top of a decoded file goes on as it would have.
    const kept = decodeHealth(JSON.stringify(swift.twoAfterNight));
    recordDailyHistory(kept, parseDailyHistory(bin("health-daily-4.bin")), undefined, new Date(Date.UTC(2026, 9, 31) + (16 * 3600 + 600) * 1000), utcCalendar);
    expect(canonical(healthToJSON(kept))).toBe(canonical(swift.two));
    expect(() => healthFromJSON({ insights: {} })).toThrow();
  });

  it("exposes the battery readings", () => {
    const battery = parseDailyHistory(bin("health-daily-4.bin")).battery;
    expect(battery.map((b) => ({ time: b.time.getTime() / 1000, percent: b.percent, offset: b.utcOffsetMinutes }))).toEqual(swift.battery);
  });
});
