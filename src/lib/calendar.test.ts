import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, hoursMinutes, isDayKey, isMonthKey, mondayOf, monthOf, monthOfWeek, monthWeeks, occurrences,
  dayMonth, longDay, monthTitle, placeEntries, shortDay, weekDays, weekInMonth, weekTitle, weekdayName, type PlacedEntry,
} from "./calendar";

describe("days and months", () => {
  it("checks day and month keys", () => {
    expect(isDayKey("2026-11-19")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-1-9")).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-11-01")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // across a clock change
  });
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-11-19")).toBe("2026-11-16"); // Thursday
    expect(mondayOf("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // Sunday at a month start
  });
  it("pages months across years", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -14)).toBe("2025-09");
    expect(monthOf("2026-11-19")).toBe("2026-11");
  });
  it("lists seven days from a Monday", () => {
    expect(weekDays("2026-11-30")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  });
});

describe("month grid", () => {
  it("gives November 2026 the six weeks on the canvas, from Mon 26 Oct to Sun 6 Dec", () => {
    const weeks = monthWeeks("2026-11");
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks[0][6]).toBe("2026-11-01");
    expect(weeks[3]).toContain("2026-11-19");
    expect(weeks[5][0]).toBe("2026-11-30");
    expect(weeks[5][6]).toBe("2026-12-06");
  });
  it("uses four rows for a February that starts on a Monday", () => {
    const weeks = monthWeeks("2027-02"); // 1 Feb 2027 is a Monday, 28 days
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe("2027-02-01");
    expect(weeks[3][6]).toBe("2027-02-28");
  });
  it("uses five rows for a usual month", () => {
    const weeks = monthWeeks("2026-12");
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe("2026-11-30");
    expect(weeks[4][6]).toBe("2027-01-03");
  });
  it("always starts rows on Monday, holds every day of the month once, and runs unbroken", () => {
    for (let k = 0; k < 36; k++) {
      const month = addMonths("2025-01", k);
      const weeks = monthWeeks(month);
      const flat = weeks.flat();
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);
      for (const w of weeks) {
        expect(w).toHaveLength(7);
        expect(mondayOf(w[0])).toBe(w[0]);
        expect(w.some((d) => monthOf(d) === month)).toBe(true);
      }
      for (let i = 1; i < flat.length; i++) expect(flat[i]).toBe(addDays(flat[i - 1], 1));
      const inside = flat.filter((d) => monthOf(d) === month);
      expect(inside[0]).toBe(`${month}-01`);
      expect(addDays(inside[inside.length - 1], 1)).toBe(`${addMonths(month, 1)}-01`);
    }
  });
  it("picks the week to show for a month", () => {
    expect(weekInMonth("2026-11", "2026-11-19")).toBe("2026-11-16");
    expect(weekInMonth("2026-12", "2026-11-19")).toBe("2026-11-30");
    expect(monthOfWeek("2026-11-30")).toBe("2026-12");
    expect(monthOfWeek("2026-10-26")).toBe("2026-10");
  });
});

describe("repeats", () => {
  it("repeats on the same weekday", () => {
    expect(occurrences("2026-11-26", 4)).toEqual(["2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17"]);
    expect(occurrences("2026-11-26", 1)).toEqual(["2026-11-26"]);
  });
  it("always gives at least the day itself", () => {
    expect(occurrences("2026-11-26", 0)).toEqual(["2026-11-26"]);
    expect(occurrences("2026-11-26", NaN)).toEqual(["2026-11-26"]);
    expect(occurrences("2026-11-26", 999)).toHaveLength(52);
  });
});

const entry = (id: string, date: string, status: "done" | "planned", source: string, sport = "run", metres?: number, load?: number): PlacedEntry =>
  ({ id, date, status, source, sport, metres, load });

describe("placing entries", () => {
  const account = [
    entry("d19", "2026-11-19", "done", "sample"),
    entry("p20", "2026-11-20", "planned", "sample", "run", 6000, 54),
    entry("p26", "2026-11-26", "planned", "sample", "run", 10000, 110),
  ];
  it("puts each entry on its day", () => {
    const { byDay, replaced } = placeEntries(account, []);
    expect(byDay.get("2026-11-19")?.map((e) => e.id)).toEqual(["d19"]);
    expect(byDay.get("2026-11-26")?.map((e) => e.id)).toEqual(["p26"]);
    expect(byDay.get("2026-11-21")).toBeUndefined();
    expect(replaced).toEqual([]);
  });
  it("lets a saved workout replace the account's plan for that day", () => {
    const { byDay, replaced } = placeEntries(account, [entry("s26", "2026-11-26", "planned", "browser", "run", 9600, 104)]);
    expect(byDay.get("2026-11-26")?.map((e) => e.id)).toEqual(["s26"]);
    expect(byDay.get("2026-11-20")?.map((e) => e.id)).toEqual(["p20"]);
    expect(replaced.map((e) => e.id)).toEqual(["p26"]);
  });
  it("keeps a gym plan the phone synced beside a workout saved here", () => {
    const { byDay, replaced } = placeEntries([entry("g21", "2026-11-21", "planned", "synced", "strength")], [entry("s21", "2026-11-21", "planned", "browser")]);
    expect(byDay.get("2026-11-21")?.map((e) => e.id)).toEqual(["g21", "s21"]);
    expect(replaced).toEqual([]);
  });
  it("keeps recorded activities and lists them first", () => {
    const { byDay, replaced } = placeEntries(account, [entry("s19", "2026-11-19", "planned", "browser")]);
    expect(byDay.get("2026-11-19")?.map((e) => e.id)).toEqual(["d19", "s19"]);
    expect(replaced).toEqual([]);
  });
  it("shows saved workouts on days the account knows nothing about", () => {
    const { byDay } = placeEntries([], [entry("a", "2027-03-02", "planned", "browser"), entry("b", "2027-03-02", "planned", "browser")]);
    expect(byDay.get("2027-03-02")?.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("week totals", () => {
  it("prints hours and minutes", () => {
    expect(hoursMinutes(16320)).toBe("4:32");
    expect(hoursMinutes(10694)).toBe("2:58");
    expect(hoursMinutes(0)).toBe("0:00");
    expect(hoursMinutes(36000 + 5 * 60)).toBe("10:05");
  });
});

describe("names", () => {
  it("names days and months as the screens print them", () => {
    expect(longDay("2026-11-19")).toBe("Thursday 19 November");
    expect(shortDay("2026-11-19")).toBe("Thu 19 Nov");
    expect(shortDay("2025-11-21", true)).toBe("Fri 21 Nov 2025");
    expect(dayMonth("2026-08-28")).toBe("28 Aug");
    expect(monthTitle("2026-11")).toBe("November 2026");
    expect(weekdayName("2026-11-26")).toBe("Thursday");
  });
  it("titles a week", () => {
    expect(weekTitle("2026-11-16")).toBe("16 – 22 November 2026");
    expect(weekTitle("2026-11-30")).toBe("30 Nov – 6 Dec 2026");
    expect(weekTitle("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});
