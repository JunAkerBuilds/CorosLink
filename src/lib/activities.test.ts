import { afterEach, describe, expect, it } from "vitest";
import type { Activity, RecordedDetail } from "@/data/activities";
import { SAMPLE_ACTIVITIES, SAMPLE_ZONE_BOUNDS, sampleActivityDetail } from "@/data/sample/activities";
import {
  DEFAULT_FILTERS, axisTicks, filterActivities, filtersToQuery, formatDay, formatDayTime, formatDistance, formatLapPace, formatPace,
  formatTime, formatTotals, generateDetail, inDateRange, inDistanceBand, kmMarkers, lapBars, lapIndexAt, lapSpans, matchesSearch,
  dayStrip, groupByWeek, isPlaced, mergeLaps, nearestSample, nextSort, parseFilters, routeLngLatAt, routeLngLatSlice, routePositionAt, routeSlice, seededRandom, sortActivities, splitWhole, toCsv,
  totals, weekKey, weekTitle, zoneLabel, distanceBands, distanceMarkers, formatElevation, formatLapDistance, formatPosition, recordPace,
} from "./activities";
import { useUnitsNow } from "./units";

const TODAY = new Date(2026, 10, 19);
// The newest fifteen: the rows these expectations were written against.
const all = SAMPLE_ACTIVITIES.slice(0, 15);
const names = (list: Activity[]) => list.map((a) => a.name);

describe("table formatting", () => {
  it("matches the canvas rows", () => {
    const row = (a: Activity) => [formatDay(a.start), formatDistance(a), formatTime(a.durationS), formatPace(a)];
    expect(row(all[0])).toEqual(["Thu 19 Nov", "8.02 km", "38:14", "4:46 /km"]);
    expect(row(all[2])).toEqual(["Tue 17 Nov", "—", "48:10", "—"]);
    expect(row(all[3])).toEqual(["Mon 16 Nov", "24.6 km", "58:02", "25.4 km/h"]);
    expect(row(all[4])).toEqual(["Sun 15 Nov", "18.04 km", "1:36:20", "5:20 /km"]);
    expect(row(all[5])).toEqual(["Sat 14 Nov", "1,500 m", "31:15", "2:05 /100 m"]);
    expect(row(all[9])).toEqual(["Tue 10 Nov", "38.2 km", "1:32:44", "24.7 km/h"]);
    expect(all.filter((a) => a.sport === "Run").map(formatPace)).toEqual(["4:46 /km", "5:32 /km", "5:20 /km", "5:36 /km", "4:57 /km", "5:23 /km", "4:50 /km", "5:33 /km"]);
    expect(formatDayTime(all[0].start)).toBe("Thu 19 Nov 2026, 07:42");
  });

  it("totals the whole list as the canvas does", () => {
    expect(formatTotals(totals(all))).toBe("15 activities · 140.9 km · 12:49:47 · Load 1,047");
    expect(formatTotals(totals(all.slice(0, 1)))).toBe("1 activity · 8.0 km · 38:14 · Load 96");
    expect(formatTotals(totals([]))).toBe("0 activities · 0.0 km · 0:00 · Load 0");
  });
});

describe("search and filters", () => {
  it("matches every typed word, ignoring case and accents", () => {
    expect(matchesSearch({ name: "Strength, upper body" }, "UPPER stren")).toBe(true);
    expect(matchesSearch({ name: "Strength, upper body" }, "upper run")).toBe(false);
    expect(matchesSearch({ name: "Séance tempo" }, "seance")).toBe(true);
    expect(matchesSearch({ name: "Anything" }, "   ")).toBe(true);
  });

  it("keeps date ranges to whole local days", () => {
    expect(inDateRange({ start: "2026-10-21T06:00" }, "30d", TODAY)).toBe(true);
    expect(inDateRange({ start: "2026-10-20T23:59" }, "30d", TODAY)).toBe(false);
    expect(inDateRange({ start: "2026-10-20T23:59" }, "90d", TODAY)).toBe(true);
    expect(inDateRange({ start: "2025-12-31T10:00" }, "year", TODAY)).toBe(false);
    expect(inDateRange({ start: "2026-01-01T00:00" }, "year", TODAY)).toBe(true);
    expect(inDateRange({ start: "2019-01-01T00:00" }, "all", TODAY)).toBe(true);
    expect(inDateRange({ start: "2026-11-20T00:00" }, "30d", TODAY)).toBe(false);
  });

  it("bands distance and leaves out activities with none", () => {
    expect(inDistanceBand({ distanceM: null }, "any")).toBe(true);
    expect(inDistanceBand({ distanceM: null }, "under5")).toBe(false);
    expect(inDistanceBand({ distanceM: 4999 }, "under5")).toBe(true);
    expect(inDistanceBand({ distanceM: 5000 }, "5to10")).toBe(true);
    expect(inDistanceBand({ distanceM: 10000 }, "5to10")).toBe(true);
    expect(inDistanceBand({ distanceM: 10001 }, "over10")).toBe(true);
  });

  it("combines sport, dates, distance and search", () => {
    expect(filterActivities(all, DEFAULT_FILTERS, TODAY)).toHaveLength(15);
    expect(filterActivities(all, { ...DEFAULT_FILTERS, sport: "Ride" }, TODAY).map((a) => a.name)).toEqual(["Recovery ride", "Hill ride"]);
    expect(names(filterActivities(all, { ...DEFAULT_FILTERS, sport: "Run", distance: "over10" }, TODAY))).toEqual(["Long run", "Long run"]);
    expect(names(filterActivities(all, { ...DEFAULT_FILTERS, distance: "under5" }, TODAY))).toEqual(["Pool swim"]);
    expect(filterActivities(all, { ...DEFAULT_FILTERS, q: "tempo", sport: "Swim" }, TODAY)).toEqual([]);
  });

  it("round-trips filters through the URL and drops defaults", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    const f = { ...DEFAULT_FILTERS, q: "long run", sport: "Run" as const, dates: "year" as const, distance: "over10" as const, sort: "load" as const, dir: "asc" as const, page: 2 };
    expect(parseFilters(new URLSearchParams(filtersToQuery(f)))).toEqual(f);
    expect(parseFilters(new URLSearchParams("sport=Yoga&sort=nope&dir=up&page=-3&dates=1d"))).toEqual(DEFAULT_FILTERS);
  });
});

describe("sorting", () => {
  it("sorts each column both ways with empty values last", () => {
    expect(sortActivities(all, "date", "desc")[0].name).toBe("Morning tempo");
    expect(sortActivities(all, "date", "asc")[0].start).toBe("2026-11-03T12:40");
    expect(sortActivities(all, "load", "desc")[0].load).toBe(120);
    expect(sortActivities(all, "time", "asc")[0].name).toBe("Easy run");
    expect(sortActivities(all, "name", "asc")[0].name).toBe("Easy run");
    for (const dir of ["asc", "desc"] as const) {
      const byDistance = sortActivities(all, "distance", dir);
      expect(byDistance.slice(-4).every((a) => a.distanceM == null)).toBe(true);
      expect(byDistance.slice(0, 11).every((a) => a.distanceM != null)).toBe(true);
      expect(sortActivities(all, "cadence", dir).slice(-5).every((a) => a.cadence == null)).toBe(true);
    }
    expect(sortActivities(all, "distance", "desc")[0].name).toBe("Hill ride");
    expect(sortActivities(all, "pace", "desc")[0].name).toBe("Recovery ride");
    expect(sortActivities(all, "hr", "asc")[0].avgHr).toBe(112);
    expect(sortActivities(all, "elevation", "desc")[0].elevationGainM).toBe(612);
  });

  it("breaks ties newest first and does not change the input", () => {
    const before = names([...all]);
    const bySport = sortActivities(all, "sport", "asc");
    expect(bySport.filter((a) => a.sport === "Ride").map((a) => a.name)).toEqual(["Recovery ride", "Hill ride"]);
    expect(names([...all])).toEqual(before);
  });

  it("toggles direction on the same column and picks a sensible first direction", () => {
    expect(nextSort({ sort: "date", dir: "desc" }, "date")).toEqual({ sort: "date", dir: "asc" });
    expect(nextSort({ sort: "date", dir: "asc" }, "date")).toEqual({ sort: "date", dir: "desc" });
    expect(nextSort({ sort: "date", dir: "desc" }, "name")).toEqual({ sort: "name", dir: "asc" });
    expect(nextSort({ sort: "date", dir: "desc" }, "load")).toEqual({ sort: "load", dir: "desc" });
  });
});

describe("CSV", () => {
  it("quotes commas and quotes, keeps hundredths, leaves gaps empty", () => {
    const lines = toCsv([all[0], all[2], { ...all[1], name: 'The "big" one' }]).split("\r\n");
    expect(lines[0]).toBe("Start,Activity,Sport,Distance (km),Time,Time (s),Pace / speed,Avg HR,Max HR,Elevation (m),Cadence,Load");
    expect(lines[1]).toBe("2026-11-19T07:42,Morning tempo,Run,8.020,38:14.52,2294.52,4:46.10 /km,158,172,64,174,96");
    expect(lines[2]).toBe('2026-11-17T12:30,"Strength, upper body",Strength,,48:10.02,2890.02,,112,141,,,41');
    expect(lines[3]).toContain('"The ""big"" one"');
    expect(lines[4]).toBe("");
    expect(toCsv([])).toBe(lines[0] + "\r\n");
  });
});

describe("laps", () => {
  const tempo = sampleActivityDetail(all[0].id)!;

  it("has the canvas laps with hundredths", () => {
    expect(tempo.laps.map((l) => formatLapPace("Run", l))).toEqual(["5:08.31", "5:02.77", "4:33.12", "4:34.90", "4:35.48", "4:32.06", "4:52.11", "4:50.24", "4:36.50"]);
    expect(lapBars("Run", tempo.laps, tempo.activity).map((b) => b.width)).toEqual([36, 45, 95, 92, 91, 97, 63, 66, 89]);
    expect(lapBars("Run", tempo.laps, tempo.activity).map((b) => b.fast)).toEqual([false, false, true, true, true, true, false, false, true]);
  });

  it("finds spans and the lap under a position", () => {
    const spans = lapSpans(tempo.laps, "distance");
    expect(spans[0]).toEqual({ from: 0, to: 1000 });
    expect(spans[8]).toEqual({ from: 8000, to: 8020 });
    expect(lapIndexAt(spans, 0)).toBe(0);
    expect(lapIndexAt(spans, 999)).toBe(0);
    expect(lapIndexAt(spans, 1000)).toBe(1);
    expect(lapIndexAt(spans, 4500)).toBe(4);
    expect(lapIndexAt(spans, 8010)).toBe(8);
    expect(lapIndexAt(spans, 99999)).toBe(8);
    expect(lapIndexAt([], 10)).toBe(-1);
    expect(lapSpans(tempo.laps, "time")[1].from).toBeCloseTo(308.31, 6);
  });

  it("merges laps into workout steps without losing distance, time or climb", () => {
    const steps = tempo.steps!;
    expect(steps.map((s) => s.distanceM)).toEqual([2000, 4000, 2020]);
    expect(steps.map((s) => formatLapPace("Run", s))).toEqual(["5:05.54", "4:33.89", "4:51.03"]);
    expect(steps.reduce((s, l) => s + l.durationS, 0)).toBeCloseTo(2294.52, 6);
    expect(steps.reduce((s, l) => s + (l.elevationM ?? 0), 0)).toBe(64);
    expect(steps.map((s) => s.maxHr)).toEqual([152, 172, 170]);
    expect(mergeLaps(tempo.laps, [9])[0].avgHr).toBe(158);
  });
});

describe("route and axis helpers", () => {
  const tempo = sampleActivityDetail(all[0].id) as RecordedDetail;
  const route = tempo.route!;

  it("puts the canvas km marks where the canvas draws them", () => {
    expect(kmMarkers(8020)).toEqual([2, 4, 6]);
    expect(kmMarkers(18040)).toEqual([5, 10, 15]);
    expect(routePositionAt(route, 0)).toEqual({ x: 120, y: 330 });
    expect(routePositionAt(route, 2000)).toEqual({ x: 300, y: 230 });
    expect(routePositionAt(route, 4000)).toEqual({ x: 655, y: 170 });
    expect(routePositionAt(route, 6000)).toEqual({ x: 406, y: 226 });
    expect(routePositionAt(route, 9e9)).toEqual({ x: 120, y: 330 });
  });

  it("keeps route distance rising and slices by distance", () => {
    for (let i = 1; i < route.length; i++) expect(route[i].d).toBeGreaterThanOrEqual(route[i - 1].d);
    expect(route[route.length - 1].d).toBeCloseTo(8020, 6);
    const slice = routeSlice(route, 2000, 4000);
    expect(slice[0]).toEqual({ x: 300, y: 230 });
    expect(slice[slice.length - 1]).toEqual({ x: 655, y: 170 });
    expect(slice.length).toBeGreaterThan(10);
  });

  it("labels the shared axis and finds samples", () => {
    expect(axisTicks("Run", tempo.streams)).toEqual(["0 km", "2", "4", "6", "8 km"]);
    expect(axisTicks("Strength", { axis: "time", x: [0, 2880] })).toEqual(["0:00", "12:00", "24:00", "36:00", "48:00"]);
    expect(nearestSample(tempo.streams.x, 4460)).toBe(45);
    expect(nearestSample(tempo.streams.x, -5)).toBe(0);
  });

  it("names zones as the canvas does", () => {
    expect(tempo.zones.map(zoneLabel)).toEqual(["Zone 1 · under 136", "Zone 2 · 136 to 150", "Zone 3 · 151 to 157", "Zone 4 · 158 to 167", "Zone 5 · 168 and over"]);
    expect(tempo.zones.reduce((s, z) => s + z.seconds, 0)).toBeCloseTo(2294.52, 6);
  });
});

describe("seeded sample detail", () => {
  it("splits whole numbers exactly", () => {
    expect(splitWhole(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(splitWhole(0, [2, 5])).toEqual([0, 0]);
    expect(splitWhole(64, [3, 1, 4, 1, 5]).reduce((s, p) => s + p, 0)).toBe(64);
  });

  it("gives the same numbers for the same seed", () => {
    const a = seededRandom("x"), b = seededRandom("x"), c = seededRandom("y");
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(generateDetail(all[4], SAMPLE_ZONE_BOUNDS)).toEqual(generateDetail(all[4], SAMPLE_ZONE_BOUNDS));
  });

  // The ride, swim and strength session the canvas draws in full have their own shape (no laps); see activityDetail.test.ts.
  const drawn = ["2026-11-10-hill-ride", "2026-11-14-pool-swim", "2026-11-17-strength-upper-body"];
  it.each(all.filter((a) => !drawn.includes(a.id)).map((a) => [a.id, a] as const))("%s: laps, zones and streams agree with its row", (_id, a) => {
    const d = sampleActivityDetail(a.id) as RecordedDetail;
    const cs = (s: number) => Math.round(s * 100);

    // Laps add up to the row, to the metre and the hundredth of a second.
    expect(d.laps.reduce((s, l) => s + cs(l.durationS), 0)).toBe(cs(a.durationS));
    if (a.distanceM == null) expect(d.laps.every((l) => l.distanceM == null)).toBe(true);
    else expect(d.laps.reduce((s, l) => s + (l.distanceM ?? 0), 0)).toBe(a.distanceM);
    if (a.elevationGainM != null) expect(d.laps.reduce((s, l) => s + (l.elevationM ?? 0), 0)).toBe(a.elevationGainM);
    expect(d.laps.map((l) => l.n)).toEqual(d.laps.map((_, k) => k + 1));
    expect(d.laps.every((l) => l.durationS > 0)).toBe(true);

    // Heart rate centres on the row's average and tops out at its maximum.
    const meanHr = d.laps.reduce((s, l) => s + l.avgHr! * l.durationS, 0) / a.durationS;
    expect(Math.abs(meanHr - a.avgHr!)).toBeLessThanOrEqual(1);
    expect(Math.max(...d.laps.map((l) => l.maxHr!))).toBe(a.maxHr);
    expect(d.laps.every((l) => l.maxHr! >= l.avgHr!)).toBe(true);
    expect(Math.max(...d.streams.hr!)).toBeLessThanOrEqual(a.maxHr! + 3);

    // Zones cover the whole activity.
    expect(d.zones).toHaveLength(5);
    expect(d.zones.reduce((s, z) => s + cs(z.seconds), 0)).toBe(cs(a.durationS));

    // Streams line up sample for sample and stay inside the drawn ranges.
    const n = d.streams.x.length;
    expect(n).toBeGreaterThan(10);
    for (const s of [d.streams.pace, d.streams.hr, d.streams.elevation, d.streams.cadence]) if (s) expect(s).toHaveLength(n);
    expect(d.streams.x.every((v, i) => i === 0 || v > d.streams.x[i - 1])).toBe(true);
    expect(d.streams.x[n - 1]).toBeLessThanOrEqual(d.streams.axis === "distance" ? a.distanceM! : a.durationS);
    expect(d.streams.axis).toBe(a.distanceM == null ? "time" : "distance");
    const inside = (values: number[] | null, scale: [number, number] | null) =>
      !values || (scale != null && values.every((v) => Number.isFinite(v) && v >= scale[0] && v <= scale[1]));
    expect(inside(d.streams.pace, d.scales.pace)).toBe(true);
    expect(inside(d.streams.hr, d.scales.hr)).toBe(true);
    expect(inside(d.streams.elevation, d.scales.elevation)).toBe(true);

    // Outdoor activities get a route as long as the row says; indoor ones get none.
    if (a.sport === "Run" || a.sport === "Ride") {
      expect(d.route![d.route!.length - 1].d).toBeCloseTo(a.distanceM!, 6);
      expect(d.route!.every((p) => p.x >= 0 && p.x <= 760 && p.y >= 0 && p.y <= 420)).toBe(true);
    } else {
      expect(d.route).toBeNull();
    }
  });

  it("returns nothing for an unknown id", () => {
    expect(sampleActivityDetail("nope")).toBeNull();
  });
});

describe("weeks and the day strip", () => {
  it("puts every day from Monday to Sunday in the same week", () => {
    expect(weekKey("2026-11-16T17:05")).toBe("2026-11-16");
    expect(weekKey("2026-11-22T23:59")).toBe("2026-11-16");
    expect(weekKey("2026-11-15T08:15")).toBe("2026-11-09");
    expect(weekKey("2026-11-01T08:10")).toBe("2026-10-26");
    expect(weekTitle("2026-11-16", TODAY)).toBe("This week");
    expect(weekTitle("2026-11-09", TODAY)).toBe("9 Nov – 15 Nov");
    expect(weekTitle("2026-10-26", TODAY)).toBe("26 Oct – 1 Nov");
  });

  it("groups rows by week with each week's totals", () => {
    const weeks = groupByWeek(SAMPLE_ACTIVITIES);
    expect(weeks.map((w) => [w.key, w.rows.length])).toEqual([["2026-11-16", 4], ["2026-11-09", 6], ["2026-11-02", 5], ["2026-10-26", 5], ["2026-10-19", 3]]);
    expect(formatTotals(weeks[0].totals)).toBe("4 activities · 38.7 km · 2:58:14 · Load 253");
    // Sorted another way, a week can come up more than once; each run still carries the whole week's totals.
    const split = groupByWeek([all[0], all[4], all[1]]);
    expect(split.map((w) => w.key)).toEqual(["2026-11-16", "2026-11-09", "2026-11-16"]);
    expect(split[2].totals.count).toBe(2);
  });

  it("lays out the last 30 days, oldest first", () => {
    const strip = dayStrip(SAMPLE_ACTIVITIES, TODAY);
    expect(strip).toHaveLength(30);
    expect([strip[0].date.getDate(), strip[0].date.getMonth()]).toEqual([21, 9]);
    expect(strip[29].activities.map((a) => a.name)).toEqual(["Morning tempo"]);
    expect(strip[29].load).toBe(96);
    expect(strip[0].activities).toEqual([]);
    expect(strip.filter((d) => d.activities.length > 0)).toHaveLength(23);
  });
});

describe("a route on a real map", () => {
  const placed = [
    { x: 0, y: 0, d: 0, lat: 45.5, lon: -73.6 },
    { x: 10, y: 0, d: 1000, lat: 45.5, lon: -73.5 },
    { x: 10, y: 10, d: 2000, lat: 45.6, lon: -73.5 },
  ];

  it("is placed only when every point says where it is", () => {
    expect(isPlaced(placed)).toBe(true);
    expect(isPlaced([{ x: 0, y: 0, d: 0 }, { x: 1, y: 1, d: 10 }])).toBe(false);
    expect(isPlaced([...placed, { x: 1, y: 1, d: 2500 }])).toBe(false);
    expect(isPlaced(placed.slice(0, 1))).toBe(false);
  });

  it("finds [longitude, latitude] at a distance, between points and past either end", () => {
    expect(routeLngLatAt(placed, -5)).toEqual([-73.6, 45.5]);
    expect(routeLngLatAt(placed, 500)[0]).toBeCloseTo(-73.55, 10);
    expect(routeLngLatAt(placed, 1500)[1]).toBeCloseTo(45.55, 10);
    expect(routeLngLatAt(placed, 9999)).toEqual([-73.5, 45.6]);
  });

  it("cuts a stretch with exact ends", () => {
    const cut = routeLngLatSlice(placed, 500, 1500);
    expect(cut).toHaveLength(3);
    expect(cut[1]).toEqual([-73.5, 45.5]);
    expect(cut[0][0]).toBeCloseTo(-73.55, 10);
    expect(cut[2][1]).toBeCloseTo(45.55, 10);
    expect(routeLngLatSlice(placed, 1500, 500)).toEqual([]);
  });
});

describe("imperial units", () => {
  afterEach(() => useUnitsNow("metric"));
  const tempo = sampleActivityDetail(all[0].id) as RecordedDetail;

  it("shows the table in miles, yards and feet", () => {
    useUnitsNow("imperial");
    const row = (a: Activity) => [formatDistance(a), formatPace(a)];
    expect(row(all[0])).toEqual(["4.98 mi", "7:40 /mi"]);
    expect(row(all[3])).toEqual(["15.3 mi", "15.8 mph"]);
    expect(row(all[5])).toEqual(["1,640 yd", "1:54 /100 yd"]);
    expect(formatElevation(64)).toBe("+210 ft");
    expect(formatElevation(null)).toBe("—");
    expect(formatTotals(totals(all))).toBe("15 activities · 87.6 mi · 12:49:47 · Load 1,047");
    expect(formatLapPace("Run", tempo.laps[0])).toBe("8:16.18");
    expect(formatLapDistance("Run", tempo.laps[0])).toBe("0.62");
    expect(recordPace(437.44, 1609.344)).toBe("7:17 /mi");
  });

  it("filters in 3 and 6 mile bands", () => {
    useUnitsNow("imperial");
    expect(distanceBands().map((b) => b.label)).toEqual(["Any distance", "Under 3 mi", "3 to 6 mi", "Over 6 mi"]);
    expect(inDistanceBand({ distanceM: 4800 }, "under5")).toBe(true);
    expect(inDistanceBand({ distanceM: 4900 }, "5to10")).toBe(true);
    expect(inDistanceBand({ distanceM: 9700 }, "over10")).toBe(true);
  });

  it("labels the axis, the position and the route marks in miles", () => {
    useUnitsNow("imperial");
    expect(axisTicks("Run", tempo.streams)).toEqual(["0 mi", "1.2", "2.5", "3.7", "5 mi"]);
    expect(formatPosition("Run", "distance", 4500)).toBe("2.8 mi");
    expect(formatPosition("Swim", "distance", 750)).toBe("820 yd");
    expect(distanceMarkers(8020)).toEqual([{ label: "2", metres: 3218.688 }]);
    expect(distanceMarkers(18040).map((m) => m.label)).toEqual(["5"]);
  });

  it("writes the CSV in miles and feet", () => {
    useUnitsNow("imperial");
    const [head, first] = toCsv(all.slice(0, 1)).split("\r\n");
    expect(head).toContain("Distance (mi)");
    expect(head).toContain("Elevation (ft)");
    expect(first).toContain(",4.983,");
    expect(first).toContain("7:40.43 /mi");
  });

  it("keeps metric as it was", () => {
    expect(distanceBands().map((b) => b.label)).toEqual(["Any distance", "Under 5 km", "5 to 10 km", "Over 10 km"]);
    expect(distanceMarkers(8020)).toEqual([{ label: "2", metres: 2000 }, { label: "4", metres: 4000 }, { label: "6", metres: 6000 }]);
    expect(formatElevation(64)).toBe("+64 m");
    expect(recordPace(268.9, 1000)).toBe("4:29 /km");
  });
});
