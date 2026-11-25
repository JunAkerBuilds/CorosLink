// Writes record files in the watch's layout, for the health tests: a port of CorosKit's DailyHistoryWriter.swift
// (the same pages and record headers as CorosLink's fixtures).
import { put16, put32 } from "../bytes";
import type { BatteryCounter } from "../dailyHistory";
import { ProtoWriter } from "../protobuf";
import { COROS_EPOCH } from "../systemBind";

const device = (time: Date): number => (Math.floor(time.getTime() / 1000) - COROS_EPOCH) >>> 0;
const u32 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const u24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const minute = (time: Date): number => Math.trunc(device(time) / 60);
const swiftRound = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));

export class DailyHistoryWriter {
  readonly records: Uint8Array[] = [];

  static header(kind: number, length: number): number[] {
    if (kind < 8 && length < 16) return [((length << 4) | (kind << 1)) & 0xff];
    const value = 1 | ((kind & 7) << 1) | (((kind >> 3) & 3) << 8) | ((length & 0xf) << 4) | (((length >> 4) & 0x3f) << 10);
    return [value & 0xff, (value >> 8) & 0xff];
  }

  static record(kind: number, body: ArrayLike<number>): Uint8Array {
    return Uint8Array.from([...DailyHistoryWriter.header(kind, body.length), ...Array.from(body)]);
  }

  zone(time: Date, quarters: number): void { this.records.push(DailyHistoryWriter.record(0, [...u32(device(time)), quarters & 0xff])); }

  heartRate(time: Date, bpm: number, flags = 0x10): void { this.records.push(DailyHistoryWriter.record(1, [...u24(minute(time)), bpm, flags])); }

  activity(start: Date, end: Date, steps: number, smallCalories: number, activeSeconds = 0): void {
    this.records.push(DailyHistoryWriter.record(2, [...u24(minute(start)), ...u24(minute(end)), activeSeconds & 0xff, ...u32((steps * 0x100000 + smallCalories * 4) >>> 0)]));
  }

  sleepStatus(time: Date, status: number): void { this.records.push(DailyHistoryWriter.record(4, [...u32(device(time)), status])); }

  /** A whole night in one kind-15 record, as firmware 3.2206 writes it when the night ends. */
  sleepNight(events: [Date, number][]): void {
    const body = [events.length, 3, 0, 0, 0, 0];
    for (const [time, status] of events) body.push(...u32(device(time)), status);
    this.records.push(DailyHistoryWriter.record(15, body));
  }

  stress(time: Date, quarters: number, stress: number, score = 0): void {
    const body = new Uint8Array(21);
    body[0] = 4; put32(body, device(time), 1); body[5] = quarters & 0xff; body[6] = stress; body[9] = score;
    this.records.push(DailyHistoryWriter.record(8, body));
  }

  healthCheck(time: Date, quarters: number, v: { heartRate: number; hrv: number; breathingRate: number; spo2: number; stress: number; stressLevel: number }): void {
    const body = new Uint8Array(27);
    body[0] = 3; put32(body, device(time), 1); body[5] = quarters & 0xff;
    body[6] = v.heartRate; body[7] = v.hrv; body[8] = 55; put16(body, v.breathingRate | (v.spo2 << 6), 9);
    body[11] = v.stress; body[12] = v.stressLevel;
    this.records.push(DailyHistoryWriter.record(8, body));
  }

  spotHeartRate(time: Date, bpm: number): void { this.records.push(DailyHistoryWriter.record(10, [...u32(device(time)), bpm, 0, 0, 0, 0])); }

  hrv(time: Date, quarters: number, rmssd: number, heartRate: number, breathingRate: number, status = 4): void {
    const body = new Uint8Array(36);
    body[0] = 1; put32(body, device(time), 1); body[5] = quarters & 0xff;
    const put = (shift: number, width: number, value: number): void => {
      for (let index = 0; index < width; index++) {
        if (Math.floor(value / 2 ** index) % 2 === 1) body[6 + Math.trunc((shift + index) / 8)] |= 1 << ((shift + index) % 8);
      }
    };
    put(0, 3, status); put(3, 29, rmssd); put(55, 17, swiftRound(heartRate * 1000)); put(73, 17, swiftRound(breathingRate * 1000));
    this.records.push(DailyHistoryWriter.record(8, body));
  }

  /** A night's summary (kind 11/4) with sub-scores A–J, stored × 10 as the watch does. */
  sleepSummary(time: Date, subScores: number[]): void {
    const body = new Uint8Array(62);
    body[0] = 4; put32(body, device(time), 1);
    subScores.slice(0, 10).forEach((score, index) => put16(body, swiftRound(score * 10), 30 + 2 * index));
    this.records.push(DailyHistoryWriter.record(11, body));
  }

  /** The hourly battery record (kind 11/7), with one power counter as the watch writes several. */
  battery(time: Date, percent: number, utcOffsetSeconds: number, usage: BatteryCounter[] = [{ key: 0x180e, value: 60 }]): void {
    const proto = new ProtoWriter().int(1, device(time)).int(2, utcOffsetSeconds).int(3, percent).int(4, 1).int(5, 69_310).int(6, usage.length);
    for (const counter of usage) {
      const item = new ProtoWriter().int(1, counter.key).int(2, counter.value);
      if (counter.param !== undefined) item.int(3, counter.param);
      proto.message(7, item.data);
    }
    const data = proto.data;
    this.records.push(DailyHistoryWriter.record(11, [7, data.length & 0xff, data.length >> 8, ...data]));
  }

  raw(kind: number, body: ArrayLike<number>): void { this.records.push(DailyHistoryWriter.record(kind, body)); }

  /** 4 KB pages, each opened by a block marker (length unit 1) and closed with padding. */
  pages(): Uint8Array {
    const marker = (page: number): Uint8Array => DailyHistoryWriter.record(0x1f, [0xa5, 0x5a, 0x00, 0x05, 0x01, page & 0xff, 0, 0, 0, 0x04, 0x02, 0x11, 0, 0]);
    const out: number[] = [];
    let page: number[] = [...marker(1)];
    const close = (): void => {
      let free = 4096 - page.length;
      while (free > 0) {
        const length = Math.min(free - 2, 1023);
        if (length < 0) { page.push(...new Array<number>(free).fill(0)); break; }
        const pad = DailyHistoryWriter.record(0x1e, new Array<number>(length).fill(0xff));
        page.push(...pad); free -= pad.length;
      }
      out.push(...page);
    };
    for (const record of this.records) {
      if (page.length + record.length > 4096 - 2) {
        close();
        page = [...marker(out.length / 4096 + 1)];
      }
      page.push(...record);
    }
    close();
    return Uint8Array.from(out);
  }
}

export const hex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], (b) => parseInt(b, 16));

const unixOf = (d: Date): number => d.getTime() / 1000;

/** Local time at UTC+7. */
export const local7 = (y: number, mo: number, d: number, h: number, mi: number, s = 0): Date => new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 7 * 3600_000);

/**
 * CorosLink's `syntheticDaily()`: two days in UTC+7, day 1 from 16:00 (partial), a night in two segments with an awake
 * event at the end instant, HRV, stress, activity, a Health Check, a one-off reading and a recovery curve.
 */
export function syntheticDaily(): { file: Uint8Array; heart: [number, number][] } {
  const quarters = 28, local = local7;
  const writer = new DailyHistoryWriter();
  writer.zone(local(2026, 1, 1, 16, 0), quarters);
  // The summary of a night before this file, repeated at its start: it follows no sleep here.
  writer.sleepSummary(local(2026, 1, 1, 16, 0), [99, 99, 99, 99, 99, 99, 99, 0, 0, 99]);
  const heart: [number, number][] = [];
  for (let t = unixOf(local(2026, 1, 1, 16, 0)); t < unixOf(local(2026, 1, 2, 10, 0)); t += 60) {
    const bpm = 55 + (Math.trunc(t / 60) % 20);
    heart.push([t, bpm]); writer.heartRate(new Date(t * 1000), bpm);
  }
  writer.activity(local(2026, 1, 1, 16, 0), local(2026, 1, 1, 16, 5), 120, 9000, 60);
  writer.activity(local(2026, 1, 1, 16, 5), local(2026, 1, 1, 16, 7), 30, 2000);
  writer.activity(local(2026, 1, 1, 16, 7), local(2026, 1, 1, 16, 10), 10, 1000);
  writer.activity(local(2026, 1, 2, 9, 0), local(2026, 1, 2, 9, 5), 400, 30_500);
  writer.stress(local(2026, 1, 1, 18, 0), quarters, 42, 2);
  writer.stress(local(2026, 1, 1, 18, 5), quarters, 61, 3);
  const night: [Date, number][] = [
    [local(2026, 1, 1, 23, 0, 20), 0xfa], [local(2026, 1, 1, 23, 0, 20), 1], [local(2026, 1, 1, 23, 3, 40), 3], [local(2026, 1, 2, 0, 10, 10), 4],
    [local(2026, 1, 2, 1, 0, 0), 5], [local(2026, 1, 2, 1, 20, 29), 1], [local(2026, 1, 2, 1, 22, 31), 3], [local(2026, 1, 2, 6, 30, 10), 1],
    [local(2026, 1, 2, 6, 30, 10), 0xfb],
    [local(2026, 1, 2, 6, 40, 0), 0xfa], [local(2026, 1, 2, 6, 40, 0), 1], [local(2026, 1, 2, 6, 43, 0), 3], [local(2026, 1, 2, 7, 13, 0), 0xfb],
  ];
  for (const [time, status] of night) writer.sleepStatus(time, status);
  // The watch's summary as the first segment ended (time asleep is the lowest part).
  writer.sleepSummary(local(2026, 1, 2, 6, 31, 40), [85, 95, 90, 70, 100, 30, 88, 0, 0, 75]);
  writer.raw(4, [3, 0, 0, 0, 0xe0]);
  for (const [time, rmssd] of [[local(2026, 1, 2, 1, 0), 30], [local(2026, 1, 2, 3, 0), 41], [local(2026, 1, 2, 12, 0), 99]] as const) {
    writer.hrv(time, quarters, rmssd, 58.25, 14.5);
  }
  writer.healthCheck(local(2026, 1, 2, 9, 30, 33), quarters, { heartRate: 72, hrv: 40, breathingRate: 13, spo2: 97, stress: 31, stressLevel: 2 });
  writer.spotHeartRate(local(2026, 1, 2, 9, 32, 12), 80);
  // Recovery after a workout: 120 samples, one second without a reading.
  const samples = Array.from({ length: 120 }, (_, i) => 150 - Math.trunc(i / 4)); samples[59] = 0;
  const recovery = (values: number[]): Uint8Array => {
    const start = 1_767_247_200 - COROS_EPOCH, end = 1_767_247_230 - COROS_EPOCH;
    const curve = new ProtoWriter().int(1, end + 121).int(2, start).int(3, end);
    curve.packed(4, values).packed(5, values.map((_, i) => 1000 + i));
    return new ProtoWriter().message(1, curve.data).data;
  };
  writer.raw(13, recovery(samples));
  writer.raw(13, recovery(samples.slice(0, 10)));
  return { file: writer.pages(), heart };
}
