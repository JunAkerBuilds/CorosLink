import { describe, expect, it } from "vitest";
import phone from "./fixtures/phone.json";
import { detailFromBody } from "./activities";
import { energyDayFromItem } from "./energy";
import { watchFromState } from "./watch";
import { strengthFromItems } from "./strength";
import type { ActivityDetailBody, EnergyDayBody, ViewStrengthBody, WatchStateBody } from "./native";
import type { Activity } from "@/data/activities";

/**
 * `fixtures/phone.json` is a copy of docs/sync-fixtures.json: the bodies the iOS and Android builders are tested
 * to produce. These tests read them with the web's mappers, so a field one side renames fails here.
 */
const now = new Date(2026, 10, 20, 12);
const run: Activity = { id: "a", start: "2026-11-19T07:00", name: "Run", sport: "Run", distanceM: 10000, durationS: 3000, avgHr: 150, maxHr: 170, elevationGainM: 50, cadence: 176, load: 90 } as Activity;

describe("bodies written by the phones", () => {
  it("activity.detail draws laps, streams and a route", () => {
    const d = detailFromBody(run, phone.activityDetail.body as unknown as ActivityDetailBody);
    expect(d.laps.length).toBeGreaterThan(0);
    expect(d.streams).not.toBeNull();
    expect(d.streams!.hr!.every(Number.isFinite)).toBe(true);
    expect(d.route).not.toBeNull();
  });

  it("energy.day gives points and events", () => {
    const day = energyDayFromItem("2026-11-20", phone.energyDay.body as unknown as EnergyDayBody, true);
    expect(day).not.toBeNull();
    expect(day!.points.length).toBeGreaterThan(0);
    expect(day!.events.length).toBeGreaterThan(0);
    expect(day!.woke?.level).toBeGreaterThan(0);
  });

  it("watch.state fills the watch page", () => {
    const w = watchFromState(phone.watchState.body as unknown as WatchStateBody, [], now);
    expect(w.name).toBe((phone.watchState.body as { name: string }).name);
    expect(w.goals.length).toBeGreaterThan(0);
    expect(w.alarms.length).toBe((phone.watchState.body as { alarms: unknown[] }).alarms.length);
  });

  it("view.strength gives muscles with the phone's verdict", () => {
    const body = phone.viewStrength.body as unknown as ViewStrengthBody;
    const s = strengthFromItems([], body, now);
    expect(s.muscles.length).toBe(body.muscles!.length);
    for (const [i, m] of body.muscles!.entries()) if (m.state === "overdue") expect(s.muscles[i].state).toBe("overdue");
  });
});
