// The training profile the watch keeps (LitePb.UserInfo, setting 10): heart-rate, pace and power thresholds and zones.
// A port of CorosKit's WatchData/WatchProfile.swift. The COROS app writes it with SYSTEM_SETTINGS_SET; the watch also
// returns it to SYSTEM_SETTINGS_GET. Fields C-LINK doesn't edit go back exactly as the watch sent them.
import { CorosError } from "./bytes";
import { fieldBytes, fieldInt32, packedVarints, protoFields, ProtoWriter, type ProtoField } from "./protobuf";

export type ZoneType = "maxHR" | "reserve" | "threshold";
const ZONE_RAW: Record<ZoneType, number> = { maxHR: 1, reserve: 2, threshold: 3 };
const ZONE_OF: Record<number, ZoneType> = { 1: "maxHR", 2: "reserve", 3: "threshold" };

/** Swift's `.rounded()`: half away from zero. */
const rounded = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

export type Span = { below: number } | { between: [number, number] } | { above: number };
/** A heart-rate zone as COROS's app lists it: bpm, and % of its zone type's reference (null when there's none). */
export interface HRZone { bpm: Span; percent: Span | null }

/** New thresholds; pace in ms per km. */
export interface ProfileEdits { maxHR?: number; restingHR?: number; thresholdHR?: number; zoneType?: ZoneType; thresholdPace?: number }

export const MAX_HR_RANGE = [100, 240] as const;
export const RESTING_HR_RANGE = [25, 120] as const;
export const THRESHOLD_HR_RANGE = [80, 230] as const;
/** Watts: below 50 or over 700 is a slip or unset. */
export const FTP_RANGE = [50, 700] as const;
/** 2:00 to 15:00 per km. */
export const THRESHOLD_PACE_RANGE = [120_000, 900_000] as const;

export class WatchProfile {
  /** The five bounds between COROS's six heart-rate zones (bpm, lowest first). */
  maxHRZones: number[] = [];
  reserveHRZones: number[] = [];
  thresholdHRZones: number[] = [];
  /** Lower bounds of the pace zones, ms per km (slowest first). */
  paceZones: number[] = [];
  runPowerZones: number[] = [];
  ftpZones: number[] = [];
  maxHR = 0;
  restingHR = 0;
  thresholdHR = 0;
  /** The zones the watch uses, as it stores them (0 when it holds none). */
  zoneTypeValue = 0;
  /** ms per km. */
  thresholdPace = 0;
  criticalPower = 0;
  ftp = 0;
  /** Fields C-LINK doesn't edit (user ID, nickname, climbing grades), as the watch sent them. */
  passthrough: ProtoField[] = [];

  static decode(bytes: Uint8Array): WatchProfile {
    const p = new WatchProfile();
    for (const field of protoFields(bytes)) {
      const n = field.number, kind = field.value.kind;
      if ((n >= 1 && n <= 5) || n === 16) {
        let values: number[];
        const one = fieldInt32(field);
        const packed = one === null ? (() => { const b = fieldBytes(field); return b ? packedVarints(b) : null; })() : null;
        if (one !== null) values = [one];
        else if (packed) values = packed.map((v) => Number(BigInt.asIntN(32, v)));
        else throw new CorosError("The watch's profile is damaged.");
        const list = n === 1 ? p.maxHRZones : n === 2 ? p.reserveHRZones : n === 3 ? p.thresholdHRZones : n === 4 ? p.paceZones : n === 5 ? p.runPowerZones : p.ftpZones;
        list.push(...values);
      } else if (n >= 9 && n <= 15 && kind === "varint") {
        const v = fieldInt32(field) ?? 0;
        if (n === 9) p.maxHR = v;
        else if (n === 10) p.restingHR = v;
        else if (n === 11) p.thresholdHR = v;
        else if (n === 12) p.zoneTypeValue = v;
        else if (n === 13) p.thresholdPace = v;
        else if (n === 14) p.criticalPower = v;
        else p.ftp = v;
      } else if (kind === "varint" || kind === "bytes") {
        p.passthrough.push(field);
      } else {
        throw new CorosError("The watch's profile has an unexpected field.");
      }
    }
    return p;
  }

  copy(): WatchProfile {
    const next = Object.assign(new WatchProfile(), this);
    for (const k of ["maxHRZones", "reserveHRZones", "thresholdHRZones", "paceZones", "runPowerZones", "ftpZones", "passthrough"] as const) {
      (next[k] as unknown[]) = [...this[k]];
    }
    return next;
  }

  get zoneType(): ZoneType | null { return ZONE_OF[this.zoneTypeValue] ?? null; }
  set zoneType(value: ZoneType | null) { if (value) this.zoneTypeValue = ZONE_RAW[value]; }

  /** Zone lists packed, as the app writes them; kept fields go back exactly as the watch sent them. */
  encoded(): Buffer {
    const head = new ProtoWriter().packed(1, this.maxHRZones).packed(2, this.reserveHRZones).packed(3, this.thresholdHRZones)
      .packed(4, this.paceZones).packed(5, this.runPowerZones);
    const tail = new ProtoWriter().int(9, this.maxHR).int(10, this.restingHR).int(11, this.thresholdHR).int(12, this.zoneTypeValue)
      .int(13, this.thresholdPace).int(14, this.criticalPower).int(15, this.ftp).packed(16, this.ftpZones);
    // A stable sort by field number, as the Swift sorts by (number, position).
    const kept = this.passthrough.map((f, i) => ({ f, i })).sort((a, b) => a.f.number - b.f.number || a.i - b.i).map((x) => x.f);
    return Buffer.concat([head.data, ...kept.filter((f) => f.number < 9).map((f) => f.encoded), tail.data, ...kept.filter((f) => f.number >= 9).map((f) => f.encoded)]);
  }

  /** The bounds of the zones the watch uses now. */
  get activeHRZones(): number[] {
    switch (this.zoneType) {
      case "reserve": return this.reserveHRZones;
      case "threshold": return this.thresholdHRZones;
      default: return this.maxHRZones;
    }
  }

  /**
   * The zones the watch uses now, as COROS's app lists them: six for its five bounds. The first runs below the first
   * bound, the second from it to the second bound, each next one from just above a bound, and the last above the last.
   */
  get hrZones(): HRZone[] {
    const bounds = this.activeHRZones;
    const percents = bounds.map((b) => this.percentOfReference(b)).filter((p): p is number => p !== null);
    const bpm = spans(bounds);
    const percent = percents.length === bounds.length ? spans(percents) : null;
    return bpm.map((span, i) => ({ bpm: span, percent: percent ? percent[i] : null }));
  }

  /** A bound as a whole percentage of max HR, heart-rate reserve or threshold HR, by the zone type in use. */
  percentOfReference(bpm: number): number | null {
    let base = 0, top = 0;
    switch (this.zoneType) {
      case "reserve": if (this.restingHR > 0) { base = this.restingHR; top = this.maxHR; } break;
      case "threshold": top = this.thresholdHR; break;
      default: top = this.maxHR;
    }
    if (top <= base) return null;
    return rounded(((bpm - base) / (top - base)) * 100);
  }

  /** New thresholds, each zone set moved with its reference so the zones keep their proportions. */
  editing(edits: ProfileEdits): WatchProfile {
    const check = (value: number | undefined, [low, high]: readonly [number, number], message: string) => {
      if (value !== undefined && !(value >= low && value <= high)) throw new CorosError(message);
    };
    check(edits.maxHR, MAX_HR_RANGE, "Max heart rate must be between 100 and 240.");
    check(edits.restingHR, RESTING_HR_RANGE, "Resting heart rate must be between 25 and 120.");
    check(edits.thresholdHR, THRESHOLD_HR_RANGE, "Threshold heart rate must be between 80 and 230.");
    check(edits.thresholdPace, THRESHOLD_PACE_RANGE, "Threshold pace must be between 2:00 and 15:00 per km.");
    const next = this.copy();
    next.maxHR = edits.maxHR ?? this.maxHR;
    next.restingHR = edits.restingHR ?? this.restingHR;
    next.thresholdHR = edits.thresholdHR ?? this.thresholdHR;
    if (!(next.restingHR < next.thresholdHR && next.thresholdHR < next.maxHR)) {
      throw new CorosError("Resting, threshold and max heart rate must increase in that order.");
    }
    if (edits.zoneType) next.zoneType = edits.zoneType;
    next.thresholdPace = edits.thresholdPace ?? this.thresholdPace;
    next.maxHRZones = scale(this.maxHRZones, this.maxHR, next.maxHR);
    next.thresholdHRZones = scale(this.thresholdHRZones, this.thresholdHR, next.thresholdHR);
    next.paceZones = scale(this.paceZones, this.thresholdPace, next.thresholdPace);
    if (this.maxHR > this.restingHR && next.maxHR > next.restingHR) {
      next.reserveHRZones = this.reserveHRZones.map((v) =>
        rounded(next.restingHR + ((v - this.restingHR) * (next.maxHR - next.restingHR)) / (this.maxHR - this.restingHR)));
    }
    return next;
  }
}

export function spans(bounds: number[]): Span[] {
  if (bounds.length === 0) return [];
  const first = bounds[0], last = bounds[bounds.length - 1];
  const middle: Span[] = bounds.slice(1).map((b, k) => ({ between: [k === 0 ? first : bounds[k] + 1, b] }));
  return [{ below: first }, ...middle, { above: last }];
}

/** Zones scaled from one reference value to another; unchanged when either is unknown or they're equal. */
export function scale(zones: number[], from: number, to: number): number[] {
  if (from <= 0 || to <= 0 || from === to) return zones;
  return zones.map((z) => rounded((z * to) / from));
}
