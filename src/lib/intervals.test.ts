import { describe, expect, it } from "vitest";
import { useUnitsNow } from "./units";
import {
  filterRecentIds, importDistance, importSummary, importWindow, isAlreadyOnCoros, isImportDays, parseIntervalsActivities, RECENT_IMPORT_WINDOW_MS, withStatus,
  type IntervalsRow, type MatchableActivity,
} from "./intervals";

const start = Date.parse("2026-11-14T07:00:00Z");
const run: MatchableActivity = { startEpochMs: start, movingSec: 3600, distanceM: 12_040 };

describe("already on COROS", () => {
  it("matches the same activity", () => {
    expect(isAlreadyOnCoros(run, [run])).toBe(true);
    expect(isAlreadyOnCoros(run, [])).toBe(false);
  });

  it("allows the start to be 3 minutes apart, not more", () => {
    expect(isAlreadyOnCoros(run, [{ ...run, startEpochMs: start + 180_000 }])).toBe(true);
    expect(isAlreadyOnCoros(run, [{ ...run, startEpochMs: start - 180_000 }])).toBe(true);
    expect(isAlreadyOnCoros(run, [{ ...run, startEpochMs: start + 180_001 }])).toBe(false);
  });

  it("allows the time to be 5% apart, not more", () => {
    expect(isAlreadyOnCoros(run, [{ ...run, movingSec: 3420 }])).toBe(true); // 180 / 3600 = 5%
    expect(isAlreadyOnCoros(run, [{ ...run, movingSec: 3419 }])).toBe(false);
    expect(isAlreadyOnCoros(run, [{ ...run, movingSec: 3789 }])).toBe(true);
    expect(isAlreadyOnCoros(run, [{ ...run, movingSec: 3790 }])).toBe(false);
  });

  it("allows the distance to be 5% apart, and ignores it when one side has none", () => {
    expect(isAlreadyOnCoros(run, [{ ...run, distanceM: 11_440 }])).toBe(true);
    expect(isAlreadyOnCoros(run, [{ ...run, distanceM: 11_400 }])).toBe(false);
    expect(isAlreadyOnCoros(run, [{ ...run, distanceM: 0 }])).toBe(true);
    expect(isAlreadyOnCoros({ ...run, distanceM: 0 }, [run])).toBe(true);
  });

  it("matches two activities with no time at all only by their start", () => {
    expect(isAlreadyOnCoros({ startEpochMs: start, movingSec: 0, distanceM: 0 }, [{ startEpochMs: start + 60_000, movingSec: 0, distanceM: 0 }])).toBe(true);
  });

  it("looks through the whole list", () => {
    expect(isAlreadyOnCoros(run, [{ ...run, startEpochMs: start - 86_400_000 }, { ...run, movingSec: 100 }, run])).toBe(true);
  });
});

describe("intervals.icu's list", () => {
  const raw = [
    { id: "i101", name: "Morning Run", start_date: "2026-11-14T07:00:00Z", start_date_local: "2026-11-14T08:00:00", elapsed_time: 3700, moving_time: 3600, distance: 12_040.4, type: "Run", source: "GARMIN_CONNECT", source_file: { type: "fit" } },
    { id: 202, start_date_local: "2026-11-12T18:30:00", moving_time: 3000, distance: null, type: "VirtualRide", source: "UPLOAD_TCX" },
    { id: "i303", name: "  ", type: 7, source: "STRAVA" },
    "junk", null, { name: "no id" },
  ];

  it("reads ids, names, elapsed time first, and the file type", () => {
    const rows = parseIntervalsActivities(raw);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ intervalsId: "i101", name: "Morning Run", startEpochMs: Date.parse("2026-11-14T07:00:00Z"), movingSec: 3700, distanceM: 12_040.4, type: "Run", fileExt: "fit" });
    expect(rows[1]).toMatchObject({ intervalsId: "202", name: "Unnamed", movingSec: 3000, distanceM: 0, type: "VirtualRide", fileExt: "tcx" });
    expect(rows[2]).toEqual({ intervalsId: "i303", name: "Unnamed", startEpochMs: 0, movingSec: 0, distanceM: 0, type: "", fileExt: "unknown" });
  });

  it("is empty for anything that isn't a list", () => {
    expect(parseIntervalsActivities({ error: "nope" })).toEqual([]);
    expect(parseIntervalsActivities(null)).toEqual([]);
  });

  it("marks what COROS has", () => {
    const rows = withStatus(parseIntervalsActivities(raw), [{ startEpochMs: Date.parse("2026-11-14T07:01:00Z"), movingSec: 3690, distanceM: 12_000 }]);
    expect(rows.map((r) => r.onCoros)).toEqual([true, false, false]);
  });
});

describe("recent imports", () => {
  it("keeps what was imported in the last 14 days", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(filterRecentIds({ a: now - 1000, b: now - RECENT_IMPORT_WINDOW_MS, c: now - RECENT_IMPORT_WINDOW_MS - 1 }, now, RECENT_IMPORT_WINDOW_MS)).toEqual(["a", "b"]);
    expect(filterRecentIds({}, now, RECENT_IMPORT_WINDOW_MS)).toEqual([]);
  });
});

describe("the range", () => {
  it("offers 7, 30, 90 and 365 days only", () => {
    expect([7, 30, 90, 365].every(isImportDays)).toBe(true);
    expect([0, 31, "30", null, 366].some(isImportDays)).toBe(false);
  });

  it("asks intervals.icu for the days, and COROS for one more on each side", () => {
    expect(importWindow(30, Date.parse("2026-11-20T23:30:00Z"))).toEqual({ oldest: "2026-10-21", newest: "2026-11-21", corosFrom: "20261020", corosTo: "20261121" });
    expect(importWindow(7, Date.parse("2026-01-03T00:10:00Z"))).toEqual({ oldest: "2025-12-27", newest: "2026-01-04", corosFrom: "20251226", corosTo: "20260104" });
  });
});

describe("a row's words", () => {
  const row = (patch: Partial<IntervalsRow>): IntervalsRow => ({ intervalsId: "x", name: "x", startEpochMs: 0, movingSec: 0, distanceM: 0, type: "Run", fileExt: "fit", onCoros: false, ...patch });

  it("writes kilometres to the hundredth, metres for a swim, a dash for none", () => {
    expect(importDistance({ distanceM: 12_040, type: "Run" })).toBe("12.04 km");
    expect(importDistance({ distanceM: 1500, type: "Swim" })).toBe("1,500 m");
    expect(importDistance({ distanceM: 1500, type: "OpenWaterSwim" })).toBe("1,500 m");
    expect(importDistance({ distanceM: 0, type: "Yoga" })).toBe("—");
    useUnitsNow("imperial");
    try {
      expect(importDistance({ distanceM: 12_040, type: "Run" })).toBe("7.48 mi");
      expect(importDistance({ distanceM: 1500, type: "Swim" })).toBe("1,640 yd");
    } finally { useUnitsNow("metric"); }
  });

  it("sums up the table", () => {
    expect(importSummary([row({ onCoros: true }), row({}), row({}), row({ onCoros: true })])).toBe("4 activities loaded · 2 missing from COROS");
    expect(importSummary([row({ onCoros: true })])).toBe("1 activity loaded · everything is on COROS");
  });
});
