import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarSyncButtonState } from "../src/calendar/calendarSyncStatus.ts";

const synced = {
  connected: true,
  calendar: { id: "workouts", name: "Workouts", primary: false },
  accountMatches: true,
  lastSyncedAt: "2026-09-15T20:18:41.090Z",
  needsSync: false,
  syncing: false,
  connecting: false,
  autoSync: true,
};

test("Synced requires every connected calendar to be current", () => {
  assert.equal(calendarSyncButtonState([synced]), "synced");
  assert.equal(calendarSyncButtonState([synced, synced]), "synced");
  for (const change of [
    { needsSync: true },
    { lastSyncedAt: undefined },
    { error: "Sync failed" },
    { accountMatches: false },
    { calendar: undefined },
    { connected: false },
    { connecting: true },
  ]) {
    assert.equal(calendarSyncButtonState([synced, { ...synced, ...change }]), "pending");
  }
});

test("disconnected providers do not block a connected provider", () => {
  const disconnected = { ...synced, connected: false, calendar: undefined, needsSync: true };
  assert.equal(calendarSyncButtonState([disconnected, synced]), "synced");
  assert.equal(calendarSyncButtonState([disconnected]), "pending");
  assert.equal(calendarSyncButtonState(null), "pending");
  assert.equal(calendarSyncButtonState([]), "pending");
});

test("manual and automatic sync display Syncing until the operation finishes", () => {
  assert.equal(calendarSyncButtonState([synced], true), "syncing");
  assert.equal(calendarSyncButtonState([{ ...synced, syncing: true }]), "syncing");
  assert.equal(calendarSyncButtonState([{ ...synced, error: "Sync failed" }]), "pending");
  assert.equal(calendarSyncButtonState([synced]), "synced");
});
