// COROS's own lap table for one activity, read from the JSON its `queryActivityLapData` answers with. Ported from
// ActivityLapTable.swift. COROS serves this through its MCP data access (its own OAuth sign-in), not through
// Training Hub, so there is no Hub request for it here: only the reading.
import type { HubLap, HubLapGroup, HubLapTable } from "@/data/hub";
import { at, list, round, type Json } from "./json";

/** A number, or a numeric string. */
function number(value: Json | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** Above zero: COROS's 0 means the watch didn't record it. */
function positive(value: Json | undefined): number | undefined {
  const found = number(value);
  return found !== undefined && found > 0 && Number.isFinite(found) ? found : undefined;
}

function readLap(lap: Json, offset: number): HubLap | null {
  // A Hybrid Fitness segment has a name and may have no distance at all.
  const rawName = at(lap, "lapProjectName");
  const name = typeof rawName === "string" && rawName !== "" ? rawName : undefined;
  const centimetres = number(at(lap, "distance")) ?? (name !== undefined ? 0 : undefined);
  const seconds = positive(at(lap, "time"));
  if (centimetres === undefined || seconds === undefined) return null;
  const whole = (key: string): number | undefined => {
    const found = positive(at(lap, key));
    return found === undefined ? undefined : round(found);
  };
  const scaled = (key: string, by: number): number | undefined => {
    const found = positive(at(lap, key));
    return found === undefined ? undefined : found / by;
  };
  const atLeastZero = (key: string): number | undefined => {
    const found = number(at(lap, key));
    return found === undefined ? undefined : Math.max(found, 0);
  };
  const meters = Math.max(centimetres, 0) / 100;
  // Paces come per kilometre, or per mile on an imperial account: the lap's own pace says which. The whole
  // activity's row has no `avgPace` and holds its pace in `avgSpeedV2` instead.
  const pace = positive(at(lap, "avgPace")) ?? positive(at(lap, "avgSpeedV2"));
  const perMile = pace !== undefined && meters > 0 && Math.abs(pace / (seconds / meters * 1609.344) - 1) < 0.03;
  const adjusted = positive(at(lap, "adjustedPace"));
  const index = number(at(lap, "lapIndex"));
  const out: HubLap = { index: index !== undefined ? Math.trunc(index) : offset + 1, meters, seconds };
  const optional: Partial<HubLap> = {
    name, cumulativeSeconds: positive(at(lap, "totalLength")),
    adjustedPace: adjusted === undefined ? undefined : perMile ? adjusted / 1.609344 : adjusted,
    averageHR: whole("avgHr"), maxHR: whole("maxHr"), averagePower: whole("avgPower"),
    averageCadence: whole("avgCadence"), maxCadence: whole("maxCadence"),
    stride: scaled("avgStrideLength", 100), groundContact: positive(at(lap, "groundTime")),
    verticalOscillation: scaled("strideHeight", 10), verticalRatio: scaled("strideRatio", 10),
    ascent: atLeastZero("elevGain"), descent: atLeastZero("totalDescent"),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** The lap table in COROS's JSON; null when it isn't one. */
export function readLapTable(json: Json | undefined): HubLapTable | null {
  const raw = list(at(json, "lapGroups"));
  if (!raw) return null;
  const groups: HubLapGroup[] = [];
  for (const group of raw) {
    const typeNumber = number(at(group, "type"));
    if (typeNumber === undefined) continue;
    const type = Math.trunc(typeNumber);
    const kind = type === 2 ? "laps" : type === 10 || type === 11 || type === 12 ? "splits" : type === -1 ? "whole" : null;
    if (!kind) continue;
    const laps = (list(at(group, "laps")) ?? []).map(readLap).filter((lap): lap is HubLap => lap !== null);
    if (laps.length === 0) continue;
    const lapDistance = positive(at(group, "lapDistance"));
    groups.push({
      kind, type, lapMeters: lapDistance === undefined ? null : lapDistance / 100, laps,
      fastest: (list(at(group, "fastLapIndexList")) ?? []).map(number).filter((n): n is number => n !== undefined).map(Math.trunc),
    });
  }
  if (groups.length === 0) return null;
  const columns = (list(at(json, "columns")) ?? []).map((column) => at(column, "name")).filter((name): name is string => typeof name === "string");
  return { groups, columns };
}

/**
 * The splits of `meters` each: COROS's group of that length, or for single ones, the watch's laps when they
 * are its automatic ones (COROS sends no 1 km group then). null when COROS has neither.
 */
export function splitsEvery(table: HubLapTable, meters: number): HubLap[] | null {
  const group = table.groups.find((g) => g.kind === "splits" && g.lapMeters !== null && Math.abs(g.lapMeters - meters) <= meters * 0.01);
  if (group) return group.laps;
  const laps = table.groups.find((g) => g.kind === "laps")?.laps ?? [];
  const automatic = laps.length >= 2 && laps.slice(0, -1).every((lap) => Math.abs(lap.meters - meters) <= meters * 0.02)
    && laps[laps.length - 1].meters <= meters * 1.02;
  return automatic ? laps : null;
}
