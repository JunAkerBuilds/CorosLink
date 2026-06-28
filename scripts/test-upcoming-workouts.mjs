import assert from "node:assert/strict";
import { parseUpcomingWorkouts } from "../dist-electron/trainingHubService.js";

const fixture = {
  entities: [
    {
      happenDay: 20260627,
      planProgramId: "101",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260628,
      planProgramId: "102",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260629,
      planProgramId: "103",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260630,
      planProgramId: "104",
      sortNo: 1,
      status: 1
    },
    {
      happenDay: 20260704,
      planProgramId: "105",
      sortNo: 1,
      status: 1
    }
  ],
  programs: [
    {
      id: "p101",
      idInPlan: 101,
      name: "Rolling 400s",
      exerciseNum: 13,
      trainingLoad: 94,
      distance: 0
    },
    {
      id: "p102",
      idInPlan: 102,
      name: "Canada Day road race",
      exerciseNum: 1,
      trainingLoad: 167,
      distance: 500000
    },
    {
      id: "p103",
      idInPlan: 103,
      name: "Taper 400s",
      exerciseNum: 15,
      trainingLoad: 83,
      distance: 0
    },
    {
      id: "p104",
      idInPlan: 104,
      name: "7km Easy Run",
      exerciseNum: 1,
      distance: 700000
    },
    {
      id: "p105",
      idInPlan: 105,
      name: "7.5km Long Run",
      exerciseNum: 1,
      distance: 750000
    }
  ]
};

const workoutsToday = parseUpcomingWorkouts(fixture, "20260627");

assert.equal(workoutsToday.length, 5);
assert.equal(workoutsToday[0]?.name, "Rolling 400s");

const workoutsTomorrow = parseUpcomingWorkouts(fixture, "20260628");

assert.equal(workoutsTomorrow.length, 4);
assert.equal(workoutsTomorrow[0]?.name, "Canada Day road race");
assert.equal(
  workoutsTomorrow.some((workout) => workout.name === "Rolling 400s"),
  false
);

const workouts = workoutsToday;
assert.equal(workouts[0]?.name, "Rolling 400s");
assert.equal(workouts[0]?.volume, "13 set(s)");
assert.equal(workouts[0]?.trainingLoad, 94);
assert.equal(workouts[1]?.volume, "5.00km");
assert.equal(workouts[1]?.trainingLoad, 167);
assert.equal(workouts[2]?.volume, "15 set(s)");
assert.equal(workouts[3]?.volume, "7.00km");
assert.equal(workouts[3]?.trainingLoad, undefined);
assert.equal(workouts[4]?.volume, "7.50km");

console.log("upcoming workout parsing tests passed");
