// The workout pieces against CorosKit: WatchWorkoutTests (sport-record file 14, FIT written from it, the list summary),
// ActivityRecordingTests (FIT read back), SyncBodiesTests' activity parts, and the items the CorosKit helper made for
// the fixtures (workout-items.golden.json, printed once by a Swift program against CorosKit with SyncJSON.canonical).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe as group, expect, it } from "vitest";
import { canonical } from "@/data/sync/canonical";
import { crc16Ccitt } from "./bytes";
import { activityDetailBody, activityItems } from "./activityItems";
import { fitMessages, FIT_LAP, FIT_RECORD, isFit, makeRecording, recordingFromFit, type RecordingLap, type RecordingSample } from "./activityRecording";
import { writeFit } from "./fitWriter";
import { refSeconds } from "./native";
import { decodeSportRecord, INFO_START, INFO_SUMMARY, jsRound, KIND_SPORT_INFO, walk, workoutName, type Session, type Training } from "./sportRecord";
import { activityBody, isWatchID, summaryActivity, workoutSummary, type ActivitySummary, type WatchWorkoutSummary } from "./workoutSummary";
import { workoutItems } from "./workouts";
import golden from "./fixtures/workout-items.golden.json";
import detailVector from "./fixtures/sync-activity-detail.json";

const fixture = (name: string): Buffer => readFileSync(path.join(import.meta.dirname, "fixtures", name));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const first = (file: Uint8Array): Session => {
  const session = decodeSportRecord(file).sessions[0];
  expect(session).toBeDefined();
  return session;
};

group("sport record and FIT (WatchWorkoutTests)", () => {
  it("decodes the synthetic run and writes CorosLink's FIT", () => {
    const file = decodeSportRecord(fixture("sport-record-synthetic.bin"));
    expect(file.sessions.length).toBe(1);
    expect([file.incomplete, file.rejected, file.skippedRecords]).toEqual([0, 0, 0]);
    const run = file.sessions[0];
    const t0 = 1_767_247_200;
    expect(run.watchActivityId).toBe(`coros-${t0}-0`);
    expect(run.sportType).toBe(100);
    expect([run.startTs, run.endTs]).toEqual([t0, t0 + 30]);
    expect(run.elapsedSec).toBe(30.5);
    expect(run.timerSec).toBe(20);
    expect(run.distanceM).toBe(60);
    expect(run.calories).toBe(16);
    expect([run.avgHr, run.maxHr, run.avgCadence, run.maxCadence, run.avgPower]).toEqual([140, 200, 85, 90, 188]);
    expect(run.activeWindows).toEqual([{ lower: t0, upper: t0 + 10 }, { lower: t0 + 21, upper: t0 + 30 }]);
    expect(run.laps.length).toBe(2);
    expect(run.training?.vo2max).toBe(43);
    expect(run.gear).toBeUndefined();
    expect(hex(writeFit(run))).toBe(hex(fixture("sport-record-synthetic.fit")));
  });

  it("brings the gear picked on the watch with the workout", () => {
    const walkSession = first(fixture("sport-record-gear.bin"));
    expect(walkSession.sportType).toBe(900);
    expect(walkSession.gear).toEqual({ id: 481_336_141_743_063_040n, name: "Novablast 5" });
    expect(hex(writeFit(walkSession))).toBe(hex(fixture("sport-record-gear.fit")));
  });

  it("reads the FIT back as a recording", () => {
    const run = first(fixture("sport-record-synthetic.bin"));
    const fit = writeFit(run);
    expect(isFit(fit)).toBe(true);
    expect(fitMessages(fit, new Set([FIT_RECORD])).length).toBe(run.samples.length);
    expect(fitMessages(fit, new Set([FIT_LAP])).length).toBe(2);
  });

  const summary = (fields: Partial<WatchWorkoutSummary> & { seconds: number }): WatchWorkoutSummary => {
    const start = fields.start ?? new Date(1_793_000_000_000);
    return {
      id: "coros-1", sportCode: 402, timerSeconds: fields.seconds, distanceMeters: 0, calories: 0, ascentMeters: 0, ...fields,
      start, end: new Date(start.getTime() + fields.seconds * 1000),
    };
  };

  it("leaves out impossible calories", () => {
    // 2026-10-30: a 17-second "Workout" read 1,414,595 kcal.
    expect(summaryActivity(summary({ calories: 1_414_595, seconds: 17 })).calories).toBeUndefined();
    expect(summaryActivity(summary({ calories: 4, seconds: 17 })).calories).toBe(4);
    expect(summaryActivity(summary({ calories: 450, seconds: 3600 })).calories).toBe(450);
    expect(summaryActivity(summary({ calories: 0, seconds: 3600 })).calories).toBeUndefined();
  });

  it("leaves out impossible distances", () => {
    // 2026-11-03: a 97-second strength workout listed 6,239 km in 1:05:32.
    const start = new Date(1_793_740_246_000);
    const distance = (meters: number, timer: number, seconds: number) =>
      summaryActivity(summary({ sportCode: 100, start, distanceMeters: meters, timerSeconds: timer, seconds })).distanceMeters;
    expect(distance(6_239_027.24, 3932.16, 97)).toBeUndefined();
    expect(distance(10_120, 3134, 3300)).toBe(10_120);
    expect(distance(16.05, 17.05, 38)).toBe(16.1);
    expect(distance(0, 600, 600)).toBeUndefined();
  });

  /** The synthetic run with its start record's device sport, or its summary's timer, changed in place. */
  const syntheticRun = (change: { deviceSport?: number; timerCs?: number } = {}): Session => {
    const bytes = Buffer.from(fixture("sport-record-synthetic.bin"));
    for (const record of walk(bytes)) {
      if (record.kind !== KIND_SPORT_INFO) continue;
      const at = record.start;
      if (change.deviceSport !== undefined && bytes[at] === INFO_START) bytes[at + 1 + 13] = change.deviceSport;
      if (change.timerCs !== undefined && bytes[at] === INFO_SUMMARY) bytes.writeUInt32LE(change.timerCs, at + 1 + 4);
    }
    return first(bytes);
  };

  it("doesn't read a strength summary as a run's", () => {
    // A 97-second gym session on a PACE Pro gave 6,239 km in 1:05:32 and 65535 W (2026-11-03). Its figures come from the recording.
    const run = syntheticRun();
    const gym = syntheticRun({ deviceSport: 16 });
    expect(gym.sportType).toBe(402);
    expect(gym.elapsedSec).toBe(run.elapsedSec);
    expect(gym.timerSec).toBe(21); // the timer-running windows, 11 s and 10 s
    expect(gym.distanceM).toBe(Math.max(...run.samples.flatMap((s) => (s.dist === undefined ? [] : [s.dist]))));
    expect(gym.calories).toBe(0);
    const rates = run.samples.flatMap((s) => (s.hr === undefined ? [] : [s.hr]));
    expect(gym.maxHr).toBe(Math.trunc(Math.max(...rates)));
    expect(gym.minHr).toBe(Math.trunc(Math.min(...rates)));
    expect(gym.avgHr).toBe(jsRound(rates.reduce((a, b) => a + b, 0) / rates.length));
    expect([gym.ascentM, gym.descentM]).toEqual([0, 0]);
    expect(gym.avgTemperature).toBeUndefined();
    expect(gym.maxSpeed).toBeUndefined();
    expect(gym.totalStrides).toBeUndefined();
    expect(gym.laps).toEqual([]);
    expect(gym.samples.map((s) => s.hr)).toEqual(run.samples.map((s) => s.hr));
    expect(() => writeFit(gym)).not.toThrow();
  });

  it("leaves out a summary longer than its workout", () => {
    const run = syntheticRun({ timerCs: 393_216 });
    expect(run.sportType).toBe(100);
    expect(run.timerSec).toBe(21);
    expect(run.calories).toBe(0);
    expect(run.avgCadence).toBeUndefined();
    expect(run.laps).toEqual([]);
    expect(syntheticRun({ timerCs: 3050 }).timerSec).toBe(30.5); // a timer as long as the workout is fine
  });

  it("rejects other files", () => {
    expect(() => decodeSportRecord(new Uint8Array(4096))).toThrow(); // no block marker
    // WatchDataFile.encode(body: [1, 2, 3], fileId: 84).
    const body = Buffer.from([1, 2, 3]);
    const head = Buffer.alloc(16);
    head[0] = 0x48; head[1] = 0x46; head[3] = 84;
    head.writeUInt32LE(body.length, 8);
    head.writeUInt16LE(crc16Ccitt(body), 12);
    head.writeUInt16LE(crc16Ccitt(head.subarray(0, 14)), 14);
    expect(() => decodeSportRecord(Buffer.concat([head, body]))).toThrow();
  });

  it("has no workouts in an empty file", () => {
    // A watch with nothing recorded sends an empty file; the Gear page showed a FormatError for it.
    expect(decodeSportRecord(new Uint8Array()).sessions.length).toBe(0);
  });

  it("carries the list figures and the watch's analysis in the summary", () => {
    const run = first(fixture("sport-record-synthetic.bin"));
    const s = workoutSummary(run);
    expect(s.id).toBe(run.watchActivityId);
    expect(s.timerSeconds).toBe(20);
    expect(s.averageCadence).toBe(run.avgStepCadence ?? 170); // steps per minute, as COROS lists runs
    expect(s.training?.vo2max).toBe(43);
    const activity = summaryActivity(s);
    expect([activity.sport, activity.name]).toEqual(["run", "Run"]);
    expect(activity.distanceMeters).toBe(60);
    expect(activity.durationSeconds).toBe(20);
    expect(activity.averagePower).toBe(188);
    expect(isWatchID(activity.id)).toBe(true);
  });

  it("takes the planned workout's name from its pieces", () => {
    // As a PACE Pro 3.2106.0 stores it: the workout file in numbered 57-byte pieces. Name and overflow join with a
    // space; a name the watch translates ("T3001") or a file with a piece missing gives none.
    const varint = (v: number) => { const out: number[] = []; do { out.push((v & 0x7f) | (v > 0x7f ? 0x80 : 0)); v >>>= 7; } while (v); return out; };
    const int = (field: number, v: number) => [...varint(field << 3), ...varint(v)];
    const bytes = (field: number, b: Uint8Array | number[]) => [...varint((field << 3) | 2), ...varint(b.length), ...b];
    const text = (field: number, s?: string) => (s ? bytes(field, Buffer.from(s, "utf8")) : []);
    const pieces = (name: string, extend?: string, drop?: number) => {
      const summaryBytes = [...int(1, 4_242), ...text(2, name), ...int(3, 1), ...text(20, extend)];
      const lite = [...bytes(1, summaryBytes), ...int(9, 7)];
      const size = Buffer.alloc(4);
      size.writeUInt32LE(lite.length);
      const file = Buffer.from([0x48, 0x46, 0x00, 41, 0, 0, 0, 0, ...size, 0, 0, 0, 0, ...lite]);
      const out = new Map<number, Uint8Array>();
      for (let index = 0, start = 0; start < file.length; index++, start += 57) {
        if (index !== drop) out.set(index, file.subarray(start, Math.min(start + 57, file.length)));
      }
      return out;
    };
    expect(workoutName(pieces("6km Long Run"))).toBe("6km Long Run");
    expect(workoutName(pieces("Week 3 Day 4: a very long workout name that", "goes on"))).toBe("Week 3 Day 4: a very long workout name that goes on");
    expect(workoutName(pieces("T3001"))).toBeUndefined();
    expect(workoutName(pieces("x".repeat(80), undefined, 1))).toBeUndefined(); // a missing piece
    expect(workoutName(new Map())).toBeUndefined();
    const named: WatchWorkoutSummary = {
      id: "coros-1-0", sportCode: 100, start: new Date(), end: new Date(), timerSeconds: 60, distanceMeters: 200, calories: 9,
      ascentMeters: 0, workoutName: "Tempo 2-1",
    };
    expect(summaryActivity(named).name).toBe("Tempo 2-1");
  });
});

group("FIT read back (ActivityRecordingTests)", () => {
  const semicircles = 2_147_483_648 / 180;
  const le = (value: number, n: number) => Array.from({ length: n }, (_, i) => Number((BigInt(value) >> BigInt(8 * i)) & 0xffn));
  const be = (value: number, n: number) => le(value, n).reverse();
  /** A FIT file around the given messages (header with no CRC check, then a zero CRC). */
  const fit = (body: number[]) => Uint8Array.from([14, 0x20, 0, 0, ...le(body.length, 4), ...Buffer.from(".FIT"), 0, 0, ...body, 0, 0]);

  it("reads records, laps and invalid values", () => {
    // Local 0: record with timestamp, lat, long, distance, heart rate, cadence, fractional cadence, power, enhanced speed.
    let body = [0x40, 0, 0, ...le(20, 2), 9, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 5, 4, 0x86, 3, 1, 0x02, 4, 1, 0x02, 53, 1, 0x02, 7, 2, 0x84, 73, 4, 0x86];
    const fixes = [[40.78, -73.96], [40.781, -73.961], [40.782, -73.962]];
    fixes.forEach(([lat, lon], index) => {
      body.push(0x00, ...le(1_100_000_000 + index * 5, 4), ...le(Math.trunc(lat * semicircles), 4), ...le(Math.trunc(lon * semicircles), 4));
      body.push(...le(index * 1500, 4), 130 + index, 86, 64, ...le(index === 1 ? 0xffff : 250, 2), ...le(3200, 4));
    });
    // Local 1: a big-endian lap: start time, timer time, distance, average heart rate.
    body = [...body, 0x41, 0, 1, ...be(19, 2), 4, 2, 4, 0x86, 8, 4, 0x86, 9, 4, 0x86, 15, 1, 0x02];
    body = [...body, 0x01, ...be(1_100_000_000, 4), ...be(10_000, 4), ...be(3000, 4), 131];
    // Local 2: a record without a timestamp field, sent with a compressed-time header 3 s on.
    body = [...body, 0x42, 0, 0, ...le(20, 2), 1, 3, 1, 0x02, 0x80 | (2 << 5) | 0x0d, 150];

    const recording = recordingFromFit(fit(body))!;
    expect(recording.samples.length).toBe(4);
    const second = recording.samples[1];
    expect(second.elapsed).toBe(5);
    expect(second.latitude).toBeCloseTo(40.781, 6);
    expect(second.distance).toBe(15);
    expect(second.heartRate).toBe(131);
    expect(second.cadence).toBeCloseTo(86.5, 9);
    expect(second.power).toBeUndefined(); // 0xFFFF is FIT's no-value marker
    expect(recording.samples[0].power).toBe(250);
    expect(second.speed).toBeCloseTo(3.2, 9);
    expect(recording.samples[3].elapsed).toBe(13);
    expect(recording.samples[3].heartRate).toBe(150);
    expect(recording.samples[3].latitude).toBeUndefined();
    expect(recording.laps.length).toBe(1);
    expect(recording.laps[0].seconds).toBe(10);
    expect(recording.laps[0].meters).toBe(30);
    expect(recording.laps[0].averageHR).toBe(131);
    // The route keeps only the samples with a GPS fix.
    expect(recording.route?.points.length).toBe(3);
  });

  it("keeps every number the watch wrote on a lap", () => {
    let body = [0x40, 0, 0, ...le(20, 2), 1, 253, 4, 0x86, 0x00, ...le(1_100_000_000, 4)];
    // A lap as a COROS watch writes one: times to the millisecond, climb both ways, running dynamics.
    body = [...body, 0x41, 0, 0, ...le(19, 2), 15,
      2, 4, 0x86, 7, 4, 0x86, 8, 4, 0x86, 9, 4, 0x86, 15, 1, 0x02, 16, 1, 0x02, 17, 1, 0x02, 80, 1, 0x02,
      19, 2, 0x84, 20, 2, 0x84, 21, 2, 0x84, 22, 2, 0x84, 77, 2, 0x84, 79, 2, 0x84, 120, 2, 0x84];
    body = [...body, 0x01, ...le(1_100_000_000, 4), ...le(1_882_670, 4), ...le(1_831_450, 4), ...le(500_000, 4), 175, 197, 73, 64];
    body = [...body, ...le(201, 2), ...le(323, 2), ...le(26, 2), ...le(32, 2), ...le(1030, 2), ...le(2950, 2), ...le(11_200, 2)];
    const lap = recordingFromFit(fit(body))!.laps[0];
    expect(lap.seconds).toBeCloseTo(1831.45, 9);
    expect(lap.elapsed).toBeCloseTo(1882.67, 9);
    expect(lap.meters).toBe(5000);
    expect([lap.averageHR, lap.maxHR]).toEqual([175, 197]);
    expect(lap.averageCadence).toBeCloseTo(73.5, 9);
    expect([lap.averagePower, lap.maxPower, lap.ascent, lap.descent]).toEqual([201, 323, 26, 32]);
    expect(lap.verticalOscillation).toBeCloseTo(103, 9);
    expect(lap.groundContact).toBeCloseTo(295, 9);
    expect(lap.stepLength).toBeCloseTo(1120, 9);
  });

  it("reads nothing from what isn't FIT", () => {
    expect(recordingFromFit(Buffer.from("PK\u0003\u0004 not a fit file"))).toBeNull();
    expect(recordingFromFit(fit([]))).toBeNull();
  });
});

group("activity bodies (SyncBodiesTests)", () => {
  it("builds the shared activityDetail vector", () => {
    const input = detailVector.input;
    const samples = input.samples.map((row): RecordingSample => ({ ...row }));
    const laps = input.laps.map((row): RecordingLap => ({ ...row }));
    const body = activityDetailBody(makeRecording(samples, laps), "run", input.thresholdHr);
    expect(canonical(body)).toBe(canonical(detailVector.body));
    // No threshold heart rate: no zones. No steps either way.
    const plain = activityDetailBody(makeRecording(samples, laps), "run");
    expect(plain.zones).toBeUndefined();
    expect(plain.steps).toBeUndefined();
  });

  it("thins a long recording", () => {
    const samples = Array.from({ length: 5000 }, (_, index): RecordingSample => ({
      elapsed: index, latitude: 45 + index * 0.00001, longitude: -73, heartRate: 120 + (index % 40), power: index % 2 === 0 ? 200 : undefined,
    }));
    const body = activityDetailBody(makeRecording(samples), "indoorBike");
    const streams = body.streams as Record<string, unknown[] | string | undefined>;
    // No distance recorded: by time. Streams that weren't recorded are left out; a gap inside one is null.
    expect(streams.axis).toBe("time");
    expect([streams.x?.length, streams.hr?.length, streams.powerW?.length]).toEqual([600, 600, 600]);
    expect([(streams.x as number[])[0], (streams.x as number[])[599]]).toEqual([0, 4999]);
    expect([streams.speedMps, streams.elevationM, streams.cadence]).toEqual([undefined, undefined, undefined]);
    expect((streams.powerW as unknown[]).includes(null)).toBe(true);
    const route = body.route as unknown[];
    expect(route.length).toBeLessThanOrEqual(800);
    expect(route.length).toBeGreaterThan(2);
    expect(Buffer.byteLength(canonical(body))).toBeLessThan(256 * 1024);
  });

  it("leaves blips out of the activities", () => {
    const run: ActivitySummary = { id: "478812345678901201", name: "Tempo Run", sport: "run", start: new Date((816_800_000 + 978_307_200) * 1000), distanceMeters: 8000, durationSeconds: 2400 };
    const blip: ActivitySummary = { id: "2", name: "Run", sport: "run", durationSeconds: 4 };
    const items = activityItems([run, blip]);
    expect(items.map((i) => i.id)).toEqual(["478812345678901201"]);
    expect(items[0].body).toEqual({ id: "478812345678901201", name: "Tempo Run", sport: "run", start: 816_800_000, distanceMeters: 8000, durationSeconds: 2400 });
    expect(refSeconds(run.start!)).toBe(816_800_000);
  });
});

group("workout items (Syncer.workouts)", () => {
  type GoldenItem = { collection: string; id: string; body: string };
  const asGolden = (items: { collection: string; id: string; body: unknown }[]): GoldenItem[] =>
    items.map((i) => ({ collection: i.collection, id: i.id, body: canonical(i.body) }));
  const store = () => {
    const fits = new Map<string, Uint8Array>();
    let writes = 0;
    return {
      fits, writes: () => writes,
      kept: (details: string[] = []) => ({
        readFit: (id: string) => fits.get(id) ?? null,
        writeFit: (id: string, bytes: Uint8Array) => { writes += 1; fits.set(id, bytes); },
        details: new Set(details),
      }),
    };
  };

  for (const name of ["sport-record-synthetic", "sport-record-gear"] as const) {
    it(`matches CorosKit's items for ${name}`, () => {
      const file = fixture(`${name}.bin`);
      const expected = golden[name];
      expect(asGolden(workoutItems(file, store().kept()).items)).toEqual(expected.none);
      expect(asGolden(workoutItems(file, store().kept(), 160).items)).toEqual(expected["160"]);
    });
  }

  it("writes each summary as JSONEncoder does", () => {
    const sessions = ["sport-record-synthetic", "sport-record-gear"].flatMap((n) => decodeSportRecord(fixture(`${n}.bin`)).sessions);
    const native = sessions.map((s) => { const a = summaryActivity(workoutSummary(s)); return { id: a.id, body: canonical(activityBody(a)) }; });
    expect(native).toEqual(golden.summaries.native);
    // Workouts long enough to be listed.
    const start = new Date(1_793_470_599_000);
    const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);
    const training = { trainingLoad: 103 } as Training;
    const listed: WatchWorkoutSummary[] = [
      { id: "coros-1793470599-0", sportCode: 100, start, end: at(2100), timerSeconds: 2035.4, distanceMeters: 5865.25, calories: 516,
        averageHR: 151, maxHR: 172, ascentMeters: 31, averageCadence: 174, averagePower: 251, training, workoutName: "6km Long Run" },
      { id: "coros-1793740246-16", sportCode: 402, start, end: at(97), timerSeconds: 3932.16, distanceMeters: 6_239_027.24, calories: 1_414_595,
        averageHR: 0, ascentMeters: 0 },
      { id: "coros-1793000000-26", sportCode: 900, start, end: at(38), timerSeconds: 17.05, distanceMeters: 16.05, calories: 4, ascentMeters: 0 },
      { id: "coros-1793000001-99", sportCode: 1234, start, end: at(600), timerSeconds: 600, distanceMeters: 0, calories: 40, ascentMeters: 0 },
    ];
    expect(asGolden(activityItems(listed.map(summaryActivity)))).toEqual(golden.summaries.activities);
  });

  it("makes the FIT once and sends each detail once", () => {
    const file = fixture("sport-record-synthetic.bin");
    const kept = store();
    const firstRun = workoutItems(file, kept.kept());
    expect(firstRun.count).toBe(1);
    expect(firstRun.details).toEqual(["coros-1767247200-0"]);
    expect(kept.writes()).toBe(1);
    expect(hex(kept.fits.get("coros-1767247200-0")!)).toBe(hex(fixture("sport-record-synthetic.fit")));
    const again = workoutItems(file, kept.kept(firstRun.details));
    expect(again.items.filter((i) => i.collection === "activity.detail")).toEqual([]);
    expect(again.details).toEqual(firstRun.details);
    expect(kept.writes()).toBe(1);
    // A file that isn't one gives nothing, and keeps what was sent.
    expect(workoutItems(new Uint8Array(4096), kept.kept(["a"]))).toEqual({ items: [], count: 0, details: ["a"] });
  });
});
