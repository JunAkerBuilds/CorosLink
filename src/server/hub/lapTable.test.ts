// Ported from CorosKit's ActivityLapTableTests.swift: the shape of real answers, with made-up numbers.
import { describe, expect, it } from "vitest";
import type { Json } from "./json";
import { readLapTable, splitsEvery } from "./lapTable";

const answer: Json = JSON.parse(`
{"source":"activityDetail","labelId":"999999999999999999","sportType":100,"mode":8,"subMode":1,
 "columns":[{"name":"lapIndex","label":"圈数"},{"name":"time","label":"时间"},{"name":"adjustedPace","label":"等价配速"}],
 "lapGroups":[
  {"type":10,"lapDistance":100000,"fastLapIndexList":[2],"laps":[
    {"lapIndex":1,"distance":100000,"time":312.47,"totalLength":312.47,"avgPace":312.47,"avgSpeedV2":1152.11,"vertSpeed":-12.5,
     "avgPower":231,"avgHr":151,"maxHr":163,"groundTime":271,"groundBalance":0.0,"avgCadence":171,"maxCadence":180,"strideRatio":81,
     "strideHeight":92,"avgStrideLength":113,"formPower":0,"legStiffness":0,"elevGain":4.0,"totalDescent":9.0,"bodyTemperature":0,"adjustedPace":309},
    {"lapIndex":2,"distance":100000,"time":298.03,"totalLength":610.5,"avgPace":298.03,"avgPower":244,"avgHr":163,"maxHr":170,
     "groundTime":265,"avgCadence":174,"maxCadence":181,"strideRatio":79,"strideHeight":90,"avgStrideLength":116,
     "elevGain":0.0,"totalDescent":0.0,"adjustedPace":301},
    {"lapIndex":3,"distance":1250,"time":3.31,"totalLength":613.81,"avgPace":264.8,"avgPower":0,"avgHr":168,"maxHr":168,
     "groundTime":0,"avgCadence":176,"maxCadence":177,"strideRatio":0,"strideHeight":0,"avgStrideLength":120,
     "elevGain":0.0,"totalDescent":0.0,"adjustedPace":0}]},
  {"type":2,"lapDistance":100000,"fastLapIndexList":[],"laps":[
    {"lapIndex":1,"distance":201250,"time":613.75,"totalLength":613.75,"avgPace":304.97,"avgHr":157,"maxHr":170,"avgCadence":172,
     "elevGain":4.0,"totalDescent":9.0,"adjustedPace":305}]},
  {"type":-1,"lapDistance":201250,"fastLapIndexList":[1],"laps":[
    {"lapIndex":1,"distance":201250,"time":613.75,"totalLength":640.12,"avgSpeedV2":304.97,"avgHr":157,"maxHr":170,"groundTime":0,
     "avgCadence":172,"maxCadence":181,"strideRatio":0,"strideHeight":0,"avgStrideLength":114,"elevGain":4.0,"totalDescent":9.0,"adjustedPace":305}]}],
 "sportDataDetails":[]}`) as Json;

describe("COROS's lap table", () => {
  it("reads every group and row, to the hundredth", () => {
    const table = readLapTable(answer)!;
    expect(table.groups.map((group) => group.kind)).toEqual(["splits", "laps", "whole"]);
    expect(table.columns).toEqual(["lapIndex", "time", "adjustedPace"]);
    const splits = splitsEvery(table, 1000)!;
    expect(splits).toHaveLength(3);
    const first = splits[0];
    expect(first).toMatchObject({ index: 1, meters: 1000, seconds: 312.47, adjustedPace: 309, averageHR: 151, maxHR: 163, averagePower: 231, averageCadence: 171, maxCadence: 180, groundContact: 271, ascent: 4, descent: 9 });
    expect(first.stride).toBeCloseTo(1.13, 9);
    expect(first.verticalOscillation).toBeCloseTo(9.2, 9);
    expect(first.verticalRatio).toBeCloseTo(8.1, 9);
    // The last few metres, to the centimetre and the hundredth; COROS's zeros are things not recorded.
    const last = splits[2];
    expect(last.meters).toBeCloseTo(12.5, 9);
    expect(last.seconds).toBe(3.31);
    expect(last.adjustedPace).toBeUndefined();
    expect(last.averagePower).toBeUndefined();
    expect(last.groundContact).toBeUndefined();
    expect(last.verticalRatio).toBeUndefined();
    expect(last.ascent).toBe(0);
    expect(table.groups[0].fastest).toEqual([2]);
    // The whole activity: timer time, and elapsed time pauses and all.
    const whole = table.groups[2].laps[0];
    expect(whole.meters).toBeCloseTo(2012.5, 9);
    expect(whole.seconds).toBe(613.75);
    expect(whole.cumulativeSeconds).toBe(640.12);
    expect(table.groups[1].laps).toHaveLength(1);
    // No 5 km group, and the one watch lap isn't automatic splits.
    expect(splitsEvery(table, 5000)).toBeNull();
  });

  it("lets automatic watch laps stand in for single splits", () => {
    const table = readLapTable({ lapGroups: [{ type: 2, lapDistance: 100000, laps: [
      { lapIndex: 1, distance: 100000, time: 300.5 }, { lapIndex: 2, distance: 100000, time: 301.25 }, { lapIndex: 3, distance: 40000, time: 122.1 }] }] })!;
    expect(splitsEvery(table, 1000)?.map((lap) => lap.seconds)).toEqual([300.5, 301.25, 122.1]);
    expect(splitsEvery(table, 1609.344)).toBeNull();
  });

  it("turns paces per mile into paces per kilometre", () => {
    const table = readLapTable({ lapGroups: [{ type: 10, lapDistance: 160934, laps: [{ lapIndex: 1, distance: 160934, time: 480.0, avgPace: 480.0, adjustedPace: 470 }] }] })!;
    expect(splitsEvery(table, 1609.344)![0].adjustedPace).toBeCloseTo(470 / 1.609344, 9);
    const whole = readLapTable({ lapGroups: [{ type: -1, lapDistance: 4218000, laps: [{ lapIndex: 1, distance: 4218000, time: 29346.0, totalLength: 29590.4,
      avgSpeedV2: 695.73, adjustedPace: 545, elevGain: 2033.0, totalDescent: 2021.0 }] }] })!.groups[0].laps[0];
    expect(whole).toMatchObject({ adjustedPace: 545, ascent: 2033, descent: 2021 });
    const miles = readLapTable({ lapGroups: [{ type: -1, lapDistance: 4218000, laps: [{ lapIndex: 1, distance: 4218000, time: 29346.0, avgSpeedV2: 1119.66, adjustedPace: 877.1 }] }] })!;
    expect(miles.groups[0].laps[0].adjustedPace).toBeCloseTo(877.1 / 1.609344, 9);
  });

  it("reads a named segment with no distance, and refuses what isn't a lap table", () => {
    const table = readLapTable({ lapGroups: [{ type: 2, laps: [{ lapProjectName: "功能性健身", time: 5.92, avgHr: 79, avgCadence: 0 }] }] })!;
    expect(table.groups[0].laps[0]).toEqual({ index: 1, name: "功能性健身", meters: 0, seconds: 5.92, averageHR: 79 });
    expect(readLapTable("No lap data for this activity.")).toBeNull();
    expect(readLapTable({ lapGroups: [] })).toBeNull();
    expect(readLapTable({ lapGroups: [{ type: 99, laps: [{ distance: 1, time: 1 }] }] })).toBeNull();
  });
});
