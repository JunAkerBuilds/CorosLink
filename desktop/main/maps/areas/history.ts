// What Maps keeps about the watch, as JSON in its folder: the map areas put on the watch from here (with their
// files, so they can be taken off again over USB, and the Wi-Fi task id, so the watch's list can be labelled), and
// the routes sent to it (track ID and CRC16, so "on watch" can be told without asking it).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AreaHistory } from "../../../maps/types";
import type { AreaFile } from "./client";

export interface AreaRecord extends AreaHistory { files: AreaFile[]; taskId?: string; model: string }
export interface RouteRecord { routeId: string; trackId: string; crc: number; name: string; at: string }

interface Kept { areas: AreaRecord[]; routes: RouteRecord[] }

const MAX_AREAS = 200;

export class AreasHistory {
  private readonly file: string;
  private kept: Kept = { areas: [], routes: [] };

  constructor(folder: string) {
    mkdirSync(folder, { recursive: true });
    this.file = path.join(folder, "history.json");
    try {
      const read = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Kept>;
      this.kept = { areas: Array.isArray(read.areas) ? read.areas : [], routes: Array.isArray(read.routes) ? read.routes : [] };
    } catch { /* starts empty */ }
  }

  private save(): void {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.kept, null, 2));
    renameSync(temp, this.file);
  }

  /** Newest first, as the page lists them (without the file lists). */
  areas(): AreaHistory[] {
    return this.kept.areas.map(({ id, label, tiles, fileCount, sizeBytes, via, at }) => ({ id, label, tiles, fileCount, sizeBytes, via, at }));
  }

  area(id: string): AreaRecord | undefined { return this.kept.areas.find((a) => a.id === id); }

  /** The label C-LINK gave a Wi-Fi task. */
  labelFor(taskId: string): string | undefined { return this.kept.areas.find((a) => a.taskId === taskId)?.label; }

  addArea(record: AreaRecord): void {
    this.kept.areas = [record, ...this.kept.areas.filter((a) => a.id !== record.id)].slice(0, MAX_AREAS);
    this.save();
  }

  removeArea(id: string): void {
    this.kept.areas = this.kept.areas.filter((a) => a.id !== id);
    this.save();
  }

  /** Files another kept area still uses: removing one area never takes a square another still needs. */
  filesInUseBesides(id: string): Set<string> {
    return new Set(this.kept.areas.filter((a) => a.id !== id).flatMap((a) => a.files.map((f) => `${f.layer}/${f.name}`)));
  }

  route(routeId: string): RouteRecord | undefined { return this.kept.routes.find((r) => r.routeId === routeId); }

  routeByTrack(trackId: string): RouteRecord | undefined { return this.kept.routes.find((r) => r.trackId === trackId); }

  noteRoute(record: RouteRecord): void {
    this.kept.routes = [record, ...this.kept.routes.filter((r) => r.routeId !== record.routeId)].slice(0, 500);
    this.save();
  }
}
