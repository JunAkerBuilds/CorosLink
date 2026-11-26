import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStore } from "../localStore";
import { decodeSportRecord } from "../watch/engine/sportRecord";
import { workoutItems } from "../watch/engine/workouts";
import { activityBody, summaryActivity, workoutSummary } from "../watch/engine/workoutSummary";
import { ActivityRules, detailFromFit, duplicateGroups, keeper, sameWorkout } from "./duplicates";

const FIXTURES = path.join(__dirname, "..", "watch", "engine", "fixtures");

function setup() {
  const folder = mkdtempSync(path.join(tmpdir(), "clink-dupes-"));
  const fitFolder = path.join(folder, "watch", "fit");
  mkdirSync(fitFolder, { recursive: true });
  const store = new LocalStore(path.join(folder, "clink.db"));
  const rules = new ActivityRules(store, { fitFolder, ledger: path.join(folder, "activity-merges.json") });
  store.attachRules(rules);
  return { folder, fitFolder, store, rules };
}

// The same run, as the phone sends it (COROS's id and detail) and as the watch read it (its id, cadence, a FIT file).
const START = 815_000_000;
const phone = { id: "481944391810842725", name: "Morning Run", sport: "run", sportCode: 100, start: START, distanceMeters: 8012, durationSeconds: 2400, averageHR: 151, trainingLoad: 88 };
const watch = { id: "coros-1793307200-0", name: "Run", sport: "run", sportCode: 100, start: START + 41, distanceMeters: 8010, durationSeconds: 2398, averageHR: 151, averageCadence: 172, elevationGain: 23 };
const phoneDetail = { laps: [{ n: 1, durationS: 2400, distanceM: 8012 }], streams: { axis: "distance", x: [0, 8012], hr: [120, 160] } };
const watchDetail = { laps: [{ n: 1, durationS: 2398 }], route: [[45.1, -75.1], [45.2, -75.2]], zones: [{ zone: 1, fromBpm: null, toBpm: 120, seconds: 60 }] };

describe("one workout, one activity", () => {
  it("is the same workout when the sport matches and the starts are within two minutes", () => {
    expect(sameWorkout(phone, watch)).toBe(true);
    expect(sameWorkout(phone, { ...watch, start: START + 121 })).toBe(false);
    expect(sameWorkout(phone, { ...watch, sportCode: 200, sport: "bike" })).toBe(false);
    expect(sameWorkout({ ...phone, sportCode: undefined }, { ...watch, sportCode: undefined })).toBe(true);
    expect(sameWorkout(phone, { ...watch, start: undefined })).toBe(false);
  });

  it("keeps COROS's id, else the copy with more detail", () => {
    expect(keeper([{ id: watch.id, body: watch, detail: watchDetail }, { id: phone.id, body: phone }]).id).toBe(phone.id);
    const a = { id: "coros-1793746506-16", body: watch }, b = { id: "coros-1793746551-16", body: watch, detail: watchDetail };
    expect(keeper([a, b]).id).toBe(b.id);
    expect(keeper([a, { ...b, detail: undefined }]).id).toBe(a.id);
  });

  it("groups a day's copies, leaving different workouts alone", () => {
    const later = { ...phone, id: "1", start: START + 3600 };
    expect(duplicateGroups([{ id: phone.id, body: phone }, { id: watch.id, body: watch }, { id: "1", body: later }]).map((g) => g.map((a) => a.id))).toEqual([[phone.id, watch.id]]);
  });

  it("merges a pair into COROS's id, and loses nothing only one copy had", async () => {
    const { store, fitFolder } = setup();
    writeFileSync(path.join(fitFolder, `${watch.id}.fit`), "FIT");
    store.write([
      { collection: "activity", id: watch.id, body: watch }, { collection: "activity.detail", id: watch.id, body: watchDetail },
      { collection: "ai.note", id: `workout.${watch.id}.en`, body: { kind: "workout", key: watch.id, language: "en", text: "Steady.", writer: "server" } },
      { collection: "strength.correction", id: watch.id, body: { sets: 3 } },
    ]);
    // The phone pushes its copy as a phone does.
    await store.handle(new Request("http://x/api/v1/me/sync", { method: "POST", headers: { Authorization: `Bearer ${store.token}` }, body: JSON.stringify({ changes: [
      { collection: "activity", id: phone.id, body: phone }, { collection: "activity.detail", id: phone.id, body: phoneDetail }] }) }));
    expect(store.list("activity").map((a) => a.id)).toEqual([phone.id]);
    const kept = store.get("activity", phone.id)!;
    // COROS's figures stay; what only the watch had is added.
    expect(kept).toMatchObject({ name: "Morning Run", distanceMeters: 8012, trainingLoad: 88, averageCadence: 172, elevationGain: 23 });
    const detail = store.get("activity.detail", phone.id)!;
    expect(detail).toMatchObject({ laps: phoneDetail.laps, streams: phoneDetail.streams, route: watchDetail.route, zones: watchDetail.zones });
    expect(store.get("activity.detail", watch.id)).toBeUndefined();
    expect(store.get("ai.note", `workout.${phone.id}.en`)).toMatchObject({ key: phone.id, text: "Steady." });
    expect(store.get("ai.note", `workout.${watch.id}.en`)).toBeUndefined();
    expect(store.get("strength.correction", phone.id)).toEqual({ sets: 3 });
    expect(readFileSync(path.join(fitFolder, `${phone.id}.fit`), "utf8")).toBe("FIT");
    // Local mode keeps its own copy of the file under the watch's id.
    expect(existsSync(path.join(fitFolder, `${watch.id}.fit`))).toBe(true);
    // Every summary field either copy had is on the kept one.
    for (const k of Object.keys({ ...watch, ...phone })) expect(kept[k]).toBeDefined();
  });

  it("sends the watch's later syncs of a merged workout to the kept one, without writing anything new", () => {
    const { store } = setup();
    store.write([{ collection: "activity", id: phone.id, body: phone }]);
    store.write([{ collection: "activity", id: watch.id, body: watch }, { collection: "activity.detail", id: watch.id, body: watchDetail }]);
    expect(store.list("activity").map((a) => a.id)).toEqual([phone.id]);
    expect(store.get("activity.detail", phone.id)).toMatchObject({ route: watchDetail.route });
    const cursor = store.cursor;
    store.write([{ collection: "activity", id: watch.id, body: watch }, { collection: "activity.detail", id: watch.id, body: watchDetail }]);
    expect(store.cursor).toBe(cursor);
    expect(store.list("activity").map((a) => a.id)).toEqual([phone.id]);
  });

  it("keeps the watch copy with detail when both are the watch's", () => {
    const { store } = setup();
    const a = { ...watch, id: "coros-1793746506-16" }, b = { ...watch, id: "coros-1793746551-16", start: START + 45 };
    store.seed([{ collection: "activity", id: a.id, body: a }, { collection: "activity", id: b.id, body: b }, { collection: "activity.detail", id: b.id, body: watchDetail }]);
    const { rules } = { rules: new ActivityRules(store, { fitFolder: "/nowhere", ledger: path.join(mkdtempSync(path.join(tmpdir(), "l-")), "l.json") }) };
    expect(rules.cleanup()).toEqual({ merged: 1, details: 0 });
    expect(store.list("activity").map((x) => x.id)).toEqual([b.id]);
  });

  it("makes a watch workout's detail from its FIT file exactly as the watch sync does", () => {
    const { store, fitFolder } = setup();
    const kept = { readFit: () => null, writeFit: (id: string, bytes: Uint8Array) => writeFileSync(path.join(fitFolder, `${id}.fit`), bytes), details: new Set<string>() };
    const file = new Uint8Array(readFileSync(path.join(FIXTURES, "sport-record-synthetic.bin")));
    const synced = workoutItems(file, kept);
    const summary = summaryActivity(workoutSummary(decodeSportRecord(file).sessions[0]));
    const activity = { id: summary.id, body: { ...activityBody(summary)!, durationSeconds: 600 } };
    const fromSync = synced.items.find((i) => i.collection === "activity.detail" && i.id === activity.id)!.body;
    // CorosLink's archive brought the workout and its FIT file, and no detail.
    store.write([{ collection: "activity", id: activity.id, body: activity.body as object }]);
    expect(store.get("activity.detail", activity.id)).toEqual(JSON.parse(JSON.stringify(fromSync)));
    expect(detailFromFit(new Uint8Array([1, 2, 3]), "run")).toBeNull();
  });

  it("cleans up what's already here once, and finds nothing the second time", () => {
    const { store, rules } = setup();
    store.attachRules(null);
    store.seed([{ collection: "activity", id: phone.id, body: phone }, { collection: "activity", id: watch.id, body: watch }, { collection: "activity.detail", id: watch.id, body: watchDetail }]);
    store.attachRules(rules);
    expect(rules.cleanup()).toEqual({ merged: 1, details: 0 });
    const cursor = store.cursor;
    expect(rules.cleanup()).toEqual({ merged: 0, details: 0 });
    expect(store.cursor).toBe(cursor);
    expect(store.get("activity.detail", phone.id)).toMatchObject({ route: watchDetail.route });
  });
});
