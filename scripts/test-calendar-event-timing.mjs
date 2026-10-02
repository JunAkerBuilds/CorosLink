import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCalendarEventTiming, calendarWallTime, reconcileCalendarTiming } from "../dist-electron/calendarEventTiming.js";
import { calendarHash, workoutCalendarData } from "../dist-electron/calendarSyncUtils.js";
const timing = { mode: "timed", startTime: "18:00", endTime: "19:00", timeZone: "America/Toronto" };
const workout = { planId: "p", idInPlan: "w", name: "Run", happenDay: "20260904" };

test("timing defaults keep all-day events and reject invalid preferences", () => {
  assert.equal(validateCalendarEventTiming().mode, "all-day");
  for (const patch of [{mode:"bad"}, {startTime:"24:00"}, {startTime:"7:00"}, {timeZone:"Moon/Base"}, {endTime:""}, {endTime:"24:00"}, {endTime:"7:00"}, {endTime:60}]) {
    assert.throws(() => validateCalendarEventTiming({...timing, ...patch}));
  }
  assert.throws(() => validateCalendarEventTiming(null));
});

test("workout estimates never determine the user's event times", () => {
  for (const rawProgram of [undefined, {planDuration:7200}, {duration:2700}, {estimatedTime:900}, {exercises:[{targetType:2,targetValue:600,sets:3,restType:1,restValue:90}]}]) {
    const event = workoutCalendarData("u", {...workout, rawProgram}, timing);
    assert.equal(event.startTime, "2026-09-04T22:00:00.000Z");
    assert.equal(event.endTime, "2026-09-04T23:00:00.000Z");
    assert.doesNotMatch(event.description, /Expected duration|Fallback duration/);
  }
});

test("legacy preferences migrate without resetting existing calendar times", () => {
  for (const minutes of [45, 60, 1440]) {
    const legacy = {mode:"timed",startTime:"23:30",timeZone:"America/Toronto",fallbackDurationMinutes:minutes};
    const migrated = validateCalendarEventTiming(legacy);
    assert.equal(migrated.endTime, minutes === 45 ? "00:15" : minutes === 60 ? "00:30" : "23:30");
    const event = workoutCalendarData("u", workout, migrated);
    const remote = {timingKey:calendarHash(JSON.stringify([workout.happenDay,legacy])),startTime:"2026-09-05T13:00:00.000Z",endTime:"2026-09-05T14:30:00.000Z"};
    assert.equal(reconcileCalendarTiming(remote,event).startTime,remote.startTime);
    assert.equal(reconcileCalendarTiming(remote,event).endTime,remote.endTime);
  }
  const {endTime, ...withoutEnd} = timing;
  for (const fallbackDurationMinutes of [0,1441,1.5,"60"]) {
    assert.throws(() => validateCalendarEventTiming({...withoutEnd,fallbackDurationMinutes}));
  }
});

test("timezone conversion handles DST gaps, overlaps and fractional offsets", () => {
  const time = (day, clock, zone="America/Toronto") => new Date(calendarWallTime(day,clock,zone)).toISOString();
  assert.equal(time("2026-03-07","18:00"), "2026-03-07T23:00:00.000Z");
  assert.equal(time("2026-03-08","18:00"), "2026-03-08T22:00:00.000Z");
  assert.equal(time("2026-03-08","02:30"), "2026-03-08T07:30:00.000Z", "nonexistent time advances to 03:30");
  assert.equal(time("2026-11-01","01:30"), "2026-11-01T05:30:00.000Z", "ambiguous time uses first occurrence");
  assert.equal(time("2026-09-04","18:00","Asia/Kathmandu"), "2026-09-04T12:15:00.000Z");
  assert.equal(time("2026-10-04","02:15","Australia/Lord_Howe"), "2026-10-03T15:45:00.000Z");
});

test("explicit end times cross midnight and all-day events stay all-day", () => {
  const event = workoutCalendarData("u", {...workout,happenDay:"20261231"}, {...timing,startTime:"23:30",endTime:"01:00"});
  assert.equal(event.startTime, "2027-01-01T04:30:00.000Z");
  assert.equal(event.endTime, "2027-01-01T06:00:00.000Z");
  assert.equal(workoutCalendarData("u",workout).startTime,undefined);
});

test("start and end use wall times across DST and reject inverted gap times", () => {
  const event = workoutCalendarData("u", {...workout,happenDay:"20260308"}, {...timing,startTime:"01:30",endTime:"03:30"});
  assert.equal(event.startTime,"2026-03-08T06:30:00.000Z");
  assert.equal(event.endTime,"2026-03-08T07:30:00.000Z");
  assert.throws(() => workoutCalendarData("u", {...workout,happenDay:"20260308"}, {...timing,startTime:"02:30",endTime:"03:00"}), /end time must be after/);
});
