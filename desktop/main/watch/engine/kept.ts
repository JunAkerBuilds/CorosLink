// What the engine keeps between syncs in the folder the main process names (the app's data folder, `watch/`), laid out
// as the CorosKit helper kept it (its `Kept`), so either reads what the other left: the watch's files as last read (the
// next read only fetches what's new), the health and battery history, the details already sent, the weather last sent
// and the FIT file of each workout. JSON is in Swift JSONEncoder's shape (Dates as seconds since 2001).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromRefSeconds, refSeconds } from "./native";

export interface BatteryReading { at: Date; percent: number }

export class Kept {
  readonly sportRecords: string;
  readonly dailyHistory: string;
  readonly healthFile: string;
  readonly batteryFile: string;
  readonly detailsFile: string;
  readonly weatherFile: string;
  readonly fitFolder: string;

  constructor(readonly folder: string) {
    this.sportRecords = path.join(folder, "sport-records.bin");
    this.dailyHistory = path.join(folder, "daily-history.bin");
    this.healthFile = path.join(folder, "health.json");
    this.batteryFile = path.join(folder, "battery.json");
    this.detailsFile = path.join(folder, "details.json");
    this.weatherFile = path.join(folder, "weather.json");
    this.fitFolder = path.join(folder, "fit");
    mkdirSync(this.fitFolder, { recursive: true });
  }

  read(file: string): Buffer | null {
    try { return readFileSync(file); } catch { return null; }
  }

  /** Written whole or not at all. */
  write(file: string, data: Uint8Array | string): void {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, data);
    renameSync(temp, file);
  }

  readJSON<T>(file: string): T | null {
    const data = this.read(file);
    if (!data) return null;
    try { return JSON.parse(data.toString("utf8")) as T; } catch { return null; }
  }

  writeJSON(file: string, value: unknown): void { this.write(file, JSON.stringify(value)); }

  fitFile(watchActivityId: string): string { return path.join(this.fitFolder, `${watchActivityId}.fit`); }

  battery(): BatteryReading[] {
    const raw = this.readJSON<{ at: number; percent: number }[]>(this.batteryFile);
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.at === "number" && typeof r.percent === "number").map((r) => ({ at: fromRefSeconds(r.at), percent: r.percent })) : [];
  }

  saveBattery(readings: BatteryReading[]): void {
    this.writeJSON(this.batteryFile, readings.map((r) => ({ at: refSeconds(r.at), percent: r.percent })));
  }

  details(): Set<string> {
    const raw = this.readJSON<unknown[]>(this.detailsFile);
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  }

  saveDetails(ids: Set<string>): void { this.writeJSON(this.detailsFile, [...ids].sort()); }
}
