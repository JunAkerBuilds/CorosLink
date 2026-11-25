import { describe, expect, it } from "vitest";
import type { LibraryTrack, WatchTrack } from "./media";
import { clock, filterRows, mediaRows, sortRows } from "./mediaRows";

const lib = (id: string, title: string, onWatch: string | null = null): LibraryTrack =>
  ({ id, file: `${title}.mp3`, title, artist: "A", album: "B", secs: 60, bytes: 1e6, addedAt: 1, onWatch });
const wat = (path: string, order: number, capital?: true): WatchTrack =>
  ({ path, name: path, bytes: 1e6, order, title: null, artist: null, album: null, secs: 61, ...(capital ? { capital } : {}) });

describe("media rows", () => {
  const rows = mediaRows([lib("1", "Sent", "Sent.mp3"), lib("2", "Waiting")], [wat("Sent.mp3", 2), wat("Old.MP3", 1, true)]);

  it("shows each file once: library tracks with their place on the watch, then tracks only on the watch", () => {
    expect(rows.map((r) => [r.title, r.order, !!r.watchPath])).toEqual([["Sent", 2, true], ["Waiting", null, false], ["Old", 1, true]]);
    expect(rows[2].capital).toBe(true);
  });

  it("filters by where a track is and by text, and sorts tracks not on the watch last", () => {
    expect(filterRows(rows, "watch", "").map((r) => r.title)).toEqual(["Sent", "Old"]);
    expect(filterRows(rows, "computer", "").map((r) => r.title)).toEqual(["Waiting"]);
    expect(filterRows(rows, "all", "sen").map((r) => r.title)).toEqual(["Sent"]);
    expect(sortRows(rows, "order", 1).map((r) => r.title)).toEqual(["Old", "Sent", "Waiting"]);
    expect(sortRows(rows, "order", -1).map((r) => r.title)).toEqual(["Sent", "Old", "Waiting"]);
  });

  it("writes lengths as the watch does", () => {
    expect(clock(222)).toBe("3:42");
    expect(clock(16092)).toBe("4:28:12");
    expect(clock(null)).toBe("—");
  });
});
