// COROS's recorded activities against a mocked fetch.
import { describe, expect, it } from "vitest";
import { recorded, parseRecorded } from "./activities";
import { TrainingHub, type HubSession } from "./client";
import type { Json } from "./json";

const session: HubSession = { accessToken: "tok-123", userId: "4242", regionId: "1", baseURL: "https://teamapi.coros.com" };
const item = (n: number): Json => ({ labelId: `a${n}`, startTime: 1_794_000_000 + n * 3600, totalTime: 3110, workoutTime: 2499, distance: 8010.5, sportType: 100 });

describe("COROS's activity list for matching", () => {
  it("reads the start in milliseconds, the elapsed time and the distance", () => {
    expect(parseRecorded({ count: 1, dataList: [item(0)] })).toEqual([{ startEpochMs: 1_794_000_000_000, movingSec: 3110, distanceM: 8010.5 }]);
    expect(parseRecorded({ dataList: [{ startTime: "1794000000", totalTime: "60" }] })).toEqual([{ startEpochMs: 1_794_000_000_000, movingSec: 60, distanceM: 0 }]);
    expect(parseRecorded(undefined)).toEqual([]);
    expect(parseRecorded({ dataList: null })).toEqual([]);
  });

  it("pages through the days asked for until a short page", async () => {
    const asked: URL[] = [];
    const hub = new TrainingHub(async (input) => {
      const url = new URL(String(input));
      asked.push(url);
      const page = Number(url.searchParams.get("pageNumber"));
      return Response.json({ result: "0000", data: { dataList: Array.from({ length: page < 3 ? 100 : 7 }, (_, n) => item(page * 100 + n)) } });
    });
    const all = await recorded(hub, session, "20261020", "20261121");
    expect(all).toHaveLength(207);
    expect(asked.map((url) => url.pathname)).toEqual(["/activity/query", "/activity/query", "/activity/query"]);
    expect(Object.fromEntries(asked[1].searchParams)).toEqual({ endDay: "20261121", pageNumber: "2", size: "100", startDay: "20261020" });
  });

  it("stops after one page when the range is quiet", async () => {
    let calls = 0;
    const hub = new TrainingHub(async () => { calls += 1; return Response.json({ result: "0000", data: { dataList: [] } }); });
    await expect(recorded(hub, session, "20261113", "20261121")).resolves.toEqual([]);
    expect(calls).toBe(1);
  });
});
