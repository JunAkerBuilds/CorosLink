import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCalendarEventTiming, calendarWallTime, expectedWorkoutSeconds } from "../dist-electron/calendarEventTiming.js";
import { workoutCalendarData } from "../dist-electron/calendarSyncUtils.js";
const timing = { mode: "timed", startTime: "18:00", timeZone: "America/Toronto", fallbackDurationMinutes: 60 };
const workout = { planId: "p", idInPlan: "w", name: "Run", happenDay: "20260904" };

test("timing defaults keep all-day events and reject invalid preferences", () => {
  assert.equal(validateCalendarEventTiming().mode, "all-day");
  for (const patch of [{mode:"bad"}, {startTime:"24:00"}, {startTime:"7:00"}, {timeZone:"Moon/Base"}, {fallbackDurationMinutes:0}, {fallbackDurationMinutes:1441}, {fallbackDurationMinutes:1.5}, {fallbackDurationMinutes:"60"}]) {
    assert.throws(() => validateCalendarEventTiming({...timing, ...patch}));
  }
  assert.throws(() => validateCalendarEventTiming(null));
});

test("expected durations prefer a complete COROS estimate and count timed repeat groups", () => {
  const duration = rawProgram => expectedWorkoutSeconds({...workout, rawProgram});
  assert.equal(duration({ planDuration: 2700, duration: 1800, estimatedTime: 3600 }), 2700);
  assert.equal(duration({ planDuration: 0, duration: "1800" }), 1800);
  assert.equal(duration({ estimatedTime: 3300 }), 3300);
  assert.equal(duration({ targetType: 2, targetValue: 2400 }), 2400);
  const exercises = [{id:"warmup",targetType:2,targetValue:600}, {id:"repeat",isGroup:true,sets:6}, {id:"work",groupId:"repeat",targetType:2,targetValue:180}, {id:"rest",groupId:"repeat",targetType:2,targetValue:90}];
  assert.equal(duration({exercises}), 600 + 6 * 270);
  assert.equal(duration({exercises:[...exercises,{targetType:5,targetValue:100000}]}), undefined, "partial timed steps are not total duration");
  assert.equal(duration({estimatedTime:2220, exercises:[...exercises,{targetType:5,targetValue:100000}]}), undefined, "builder estimatedTime can be only the timed portion");
  assert.equal(duration({duration:4800, estimatedTime:2220, exercises:[...exercises,{targetType:5,targetValue:100000}]}),4800,"server-calculated duration covers the entire mixed workout");
  assert.equal(duration({exercises:[{targetType:1,targetValue:0}]}), undefined);
  assert.equal(duration({exercises:[{isGroup:true,id:"empty",sets:2}]}), undefined);
  assert.equal(duration({exercises:[{targetType:2,targetValue:60,groupId:"missing"}]}), undefined);
  assert.equal(duration({duration:Infinity,estimatedTime:-1}), undefined);
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

test("timed workouts cross midnight, label fallback duration and leave legacy events unchanged", () => {
  const event = workoutCalendarData("u", {...workout,happenDay:"20261231"}, {...timing,startTime:"23:30",fallbackDurationMinutes:90});
  assert.equal(event.startTime, "2027-01-01T04:30:00.000Z");
  assert.equal(event.endTime, "2027-01-01T06:00:00.000Z");
  assert.match(event.description,/Fallback duration.*90 minutes/);
  const estimated = workoutCalendarData("u", {...workout,rawProgram:{estimatedTime:2700}}, timing);
  assert.equal(estimated.durationSeconds,2700);
  assert.match(estimated.description,/Expected duration: 45 minutes/);
  assert.equal(workoutCalendarData("u",workout).startTime,undefined);
});
