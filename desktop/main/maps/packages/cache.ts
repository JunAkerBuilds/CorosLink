// The downloaded region zips on this computer: `<folder>/<id>.zip` (colons become underscores) and `index.json`,
// which names each one with its region, layer, version and a fingerprint for finding it on a watch. An entry whose
// zip is gone is forgotten on the next read.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedPackage } from "../../../maps/types";
import { discardPartial, partPath } from "./download";
import type { Fingerprint } from "./install";

export interface CachedRecord extends CachedPackage { url: string; fingerprint: Fingerprint }

export class PackageCache {
  private records: CachedRecord[];

  constructor(readonly folder: string) {
    this.records = this.load();
  }

  private get indexFile() { return path.join(this.folder, "index.json"); }

  private load(): CachedRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, "utf8")) as { packages?: CachedRecord[] };
      return Array.isArray(parsed.packages) ? parsed.packages.filter((r) => typeof r?.packageId === "string") : [];
    } catch {
      return [];
    }
  }

  private saving: Promise<void> = Promise.resolve();
  private writes = 0;

  /**
   * Writes the index one save at a time: two downloads can finish together, and two writes through one temp file
   * lost an entry (the second rename found no file, so a finished download showed as failed). Each write is the
   * latest list, under its own temp name.
   */
  private save(): Promise<void> {
    const write = async () => {
      await mkdir(this.folder, { recursive: true });
      const temp = `${this.indexFile}.${process.pid}.${++this.writes}.tmp`;
      await writeFile(temp, JSON.stringify({ packages: this.records }, null, 1));
      await rename(temp, this.indexFile);
    };
    const run = this.saving.then(write, write);
    this.saving = run.catch(() => undefined);
    return run;
  }

  /** Where a package's zip lives. Ids are "v5:topo:asia1", so the name is safe. */
  fileOf(packageId: string): string {
    return path.join(this.folder, `${packageId.replace(/[^a-z0-9-]+/gi, "_")}.zip`);
  }

  list(): CachedRecord[] {
    const kept = this.records.filter((r) => existsSync(this.fileOf(r.packageId)));
    if (kept.length !== this.records.length) {
      this.records = kept;
      void this.save().catch(() => undefined);
    }
    return [...kept].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  get(packageId: string): CachedRecord | undefined {
    return this.list().find((r) => r.packageId === packageId);
  }

  async put(record: CachedRecord): Promise<void> {
    this.records = [...this.records.filter((r) => r.packageId !== record.packageId), record];
    await this.save();
  }

  /** Removes the zip, any partial download of it, and its entry. */
  async remove(packageId: string): Promise<void> {
    const file = this.fileOf(packageId);
    await rm(file, { force: true });
    await discardPartial(file);
    this.records = this.records.filter((r) => r.packageId !== packageId);
    await this.save();
  }

  /** Bytes the cache takes: finished zips and partial downloads. */
  async bytes(): Promise<number> {
    let total = 0;
    for (const r of this.list()) total += r.sizeBytes;
    return total + (await this.partialBytes());
  }

  private async partialBytes(): Promise<number> {
    const names = await readdir(this.folder).catch(() => [] as string[]);
    let total = 0;
    for (const n of names) if (n.endsWith(".part")) total += (await stat(path.join(this.folder, n)).catch(() => ({ size: 0 }))).size;
    return total;
  }

  /** Bytes of a partial download waiting to be resumed. */
  async partialOf(packageId: string): Promise<number> {
    return (await stat(partPath(this.fileOf(packageId))).catch(() => ({ size: 0 }))).size;
  }
}
