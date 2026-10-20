import type Database from "better-sqlite3";
import { corosSportName } from "../corosSportTypes";
import type { TrainingHubActivity } from "../types";
import type {
  LocalActivityProvenance,
  LocalActivityRecord,
  LocalActivitySource,
  LocalDevice,
  LocalSyncCheckpoint,
  LocalSyncRun,
  LocalSyncRunKind,
  LocalSyncRunState
} from "./localDataTypes";

/** SQLite access for locally held activities, devices and watch sync bookkeeping. */

interface ActivityRow {
  activity_id: string;
  device_id: string | null;
  watch_activity_id: string | null;
  source: LocalActivitySource;
  provenance: LocalActivityProvenance;
  file_path: string;
  payload_id: number | null;
  format: LocalActivityRecord["format"];
  sha256: string;
  size_bytes: number;
  verification: LocalActivityRecord["verification"];
  sport_type: number;
  sport_name: string | null;
  name: string | null;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  moving_time: number | null;
  distance: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
  original_name: string | null;
  imported_at: string;
}

const optional = <T>(value: T | null): T | undefined => value === null ? undefined : value;

function recordFromRow(row: ActivityRow): LocalActivityRecord {
  return {
    activityId: row.activity_id,
    deviceId: optional(row.device_id),
    watchActivityId: optional(row.watch_activity_id),
    source: row.source,
    provenance: row.provenance,
    filePath: row.file_path,
    payloadId: optional(row.payload_id),
    format: row.format,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    verification: row.verification,
    sportType: row.sport_type,
    sportName: optional(row.sport_name),
    name: optional(row.name),
    startTime: optional(row.start_time),
    endTime: optional(row.end_time),
    duration: optional(row.duration),
    movingTime: optional(row.moving_time),
    distance: optional(row.distance),
    avgHr: optional(row.avg_hr),
    maxHr: optional(row.max_hr),
    calories: optional(row.calories),
    elevationGain: optional(row.elevation_gain),
    originalName: optional(row.original_name),
    importedAt: row.imported_at
  };
}

export interface LocalSyncPayload {
  id: number;
  deviceId: string;
  fileIndex: number;
  selector: number;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  receivedAt: string;
  decoder?: string;
  decodedRecords?: number;
  decodeError?: string;
}

function payloadFromRow(row: Record<string, unknown>): LocalSyncPayload {
  return {
    id: row.id as number,
    deviceId: row.device_id as string,
    fileIndex: row.file_index as number,
    selector: row.selector as number,
    filePath: row.file_path as string,
    sha256: row.sha256 as string,
    sizeBytes: row.size_bytes as number,
    receivedAt: row.received_at as string,
    decoder: (row.decoder as string | null) ?? undefined,
    decodedRecords: (row.decoded_records as number | null) ?? undefined,
    decodeError: (row.decode_error as string | null) ?? undefined
  };
}

function runFromRow(row: Record<string, unknown>): LocalSyncRun {
  return {
    id: row.id as number,
    deviceId: (row.device_id as string | null) ?? undefined,
    kind: row.kind as LocalSyncRunKind,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? undefined,
    state: row.state as LocalSyncRunState,
    receivedBytes: row.received_bytes as number,
    totalBytes: (row.total_bytes as number | null) ?? undefined,
    newRecords: row.new_records as number,
    error: (row.error as string | null) ?? undefined
  };
}

export function toTrainingHubActivity(record: LocalActivityRecord): TrainingHubActivity {
  return {
    activityId: record.activityId,
    name: record.name,
    sportType: record.sportType,
    sportName: record.sportName ?? corosSportName(record.sportType),
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration === undefined ? undefined : Math.round(record.duration),
    movingTime: record.movingTime === undefined ? undefined : Math.round(record.movingTime),
    distance: record.distance,
    avgHr: record.avgHr,
    maxHr: record.maxHr,
    calories: record.calories,
    elevationGain: record.elevationGain
  };
}

/** COROS "YYYYMMDD" day bounds → unix seconds in local time (end exclusive). */
function dayBounds(startDay?: string, endDay?: string): { from?: number; to?: number } {
  const parse = (day?: string) => {
    if (!day || !/^\d{8}$/.test(day)) return undefined;
    return new Date(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))).getTime() / 1000;
  };
  const from = parse(startDay);
  const end = parse(endDay);
  return { from, to: end === undefined ? undefined : end + 86_400 };
}

export interface ListLocalActivitiesQuery {
  page?: number;
  size?: number;
  startDay?: string;
  endDay?: string;
}

export class ActivityRepository {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}

  upsertDevice(device: Omit<LocalDevice, "firstSeenAt" | "lastSeenAt">): void {
    const at = this.now().toISOString();
    this.db.prepare(
      `INSERT INTO local_devices (device_id, name, model, firmware, first_seen_at, last_seen_at)
       VALUES (@deviceId, @name, @model, @firmware, @at, @at)
       ON CONFLICT(device_id) DO UPDATE SET
         name = COALESCE(excluded.name, local_devices.name),
         model = COALESCE(excluded.model, local_devices.model),
         firmware = COALESCE(excluded.firmware, local_devices.firmware),
         last_seen_at = excluded.last_seen_at`
    ).run({ deviceId: device.deviceId, name: device.name ?? null, model: device.model ?? null, firmware: device.firmware ?? null, at });
  }

  listDevices(): LocalDevice[] {
    return (this.db.prepare("SELECT * FROM local_devices ORDER BY last_seen_at DESC").all() as Array<Record<string, string | null>>)
      .map(row => ({
        deviceId: row.device_id!,
        name: optional(row.name),
        model: optional(row.model),
        firmware: optional(row.firmware),
        firstSeenAt: row.first_seen_at!,
        lastSeenAt: row.last_seen_at!
      }));
  }

  /**
   * Inserts unless the same bytes (sha256) or the same watch record is
   * already stored; repeated syncs and re-imports never duplicate.
   */
  insertActivity(record: Omit<LocalActivityRecord, "importedAt">): { inserted: boolean; activityId: string } {
    const existing = this.db.prepare(
      `SELECT activity_id FROM local_activity_files
       WHERE sha256 = ? OR (device_id IS NOT NULL AND device_id = ? AND watch_activity_id = ?)`
    ).get(record.sha256, record.deviceId ?? null, record.watchActivityId ?? null) as { activity_id: string } | undefined;
    if (existing) return { inserted: false, activityId: existing.activity_id };
    this.db.prepare(
      `INSERT INTO local_activity_files (
         activity_id, device_id, watch_activity_id, source, provenance, file_path, payload_id, format, sha256,
         size_bytes, verification, sport_type, sport_name, name, start_time, end_time, duration, moving_time,
         distance, avg_hr, max_hr, calories, elevation_gain, original_name, imported_at)
       VALUES (
         @activityId, @deviceId, @watchActivityId, @source, @provenance, @filePath, @payloadId, @format, @sha256,
         @sizeBytes, @verification, @sportType, @sportName, @name, @startTime, @endTime, @duration, @movingTime,
         @distance, @avgHr, @maxHr, @calories, @elevationGain, @originalName, @importedAt)`
    ).run({
      activityId: record.activityId,
      deviceId: record.deviceId ?? null,
      watchActivityId: record.watchActivityId ?? null,
      source: record.source,
      provenance: record.provenance,
      filePath: record.filePath,
      payloadId: record.payloadId ?? null,
      format: record.format,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes,
      verification: record.verification,
      sportType: record.sportType,
      sportName: record.sportName ?? null,
      name: record.name ?? null,
      startTime: record.startTime ?? null,
      endTime: record.endTime ?? null,
      duration: record.duration ?? null,
      movingTime: record.movingTime ?? null,
      distance: record.distance ?? null,
      avgHr: record.avgHr ?? null,
      maxHr: record.maxHr ?? null,
      calories: record.calories ?? null,
      elevationGain: record.elevationGain ?? null,
      originalName: record.originalName ?? null,
      importedAt: this.now().toISOString()
    });
    return { inserted: true, activityId: record.activityId };
  }

  getActivity(activityId: string): LocalActivityRecord | undefined {
    const row = this.db.prepare("SELECT * FROM local_activity_files WHERE activity_id = ?").get(activityId) as ActivityRow | undefined;
    return row ? recordFromRow(row) : undefined;
  }

  listActivities(query: ListLocalActivitiesQuery = {}): LocalActivityRecord[] {
    const size = Math.min(Math.max(Math.trunc(query.size ?? 50), 1), 1000);
    const page = Math.max(Math.trunc(query.page ?? 1), 1);
    const { from, to } = dayBounds(query.startDay, query.endDay);
    const rows = this.db.prepare(
      `SELECT * FROM local_activity_files
       WHERE (@from IS NULL OR COALESCE(start_time, end_time) >= @from) AND (@to IS NULL OR COALESCE(start_time, end_time) < @to)
       ORDER BY COALESCE(start_time, end_time) DESC, activity_id
       LIMIT @limit OFFSET @offset`
    ).all({ from: from ?? null, to: to ?? null, limit: size, offset: (page - 1) * size }) as ActivityRow[];
    return rows.map(recordFromRow);
  }

  allActivities(): LocalActivityRecord[] {
    return (this.db.prepare("SELECT * FROM local_activity_files ORDER BY COALESCE(start_time, end_time) DESC").all() as ActivityRow[]).map(recordFromRow);
  }

  /** The stored activity for a watch record, if any. */
  findWatchActivity(deviceId: string, watchActivityId: string): LocalActivityRecord | undefined {
    const row = this.db.prepare("SELECT activity_id FROM local_activity_files WHERE device_id = ? AND watch_activity_id = ?")
      .get(deviceId, watchActivityId) as { activity_id: string } | undefined;
    return row ? this.getActivity(row.activity_id) : undefined;
  }

  /** Points an activity at a re-decoded file (same activity, another decoder version's output). */
  replaceActivityFile(activityId: string, file: { filePath: string; sha256: string; sizeBytes: number }): void {
    this.db.prepare("UPDATE local_activity_files SET file_path = ?, sha256 = ?, size_bytes = ? WHERE activity_id = ?")
      .run(file.filePath, file.sha256, file.sizeBytes, activityId);
  }

  /** Whether any row still references the archived file (content-addressed files can be shared). */
  isFileReferenced(filePath: string): boolean {
    const activity = this.db.prepare("SELECT 1 FROM local_activity_files WHERE file_path = ? LIMIT 1").get(filePath);
    const payload = this.db.prepare("SELECT 1 FROM local_sync_payloads WHERE file_path = ? LIMIT 1").get(filePath);
    return Boolean(activity || payload);
  }

  countActivities(): { total: number; fromWatch: number; imported: number } {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN provenance = 'watch' THEN 1 ELSE 0 END) AS fromWatch,
              SUM(CASE WHEN provenance <> 'watch' THEN 1 ELSE 0 END) AS imported
       FROM local_activity_files`
    ).get() as { total: number; fromWatch: number | null; imported: number | null };
    return { total: row.total, fromWatch: row.fromWatch ?? 0, imported: row.imported ?? 0 };
  }

  // ----- raw sync payloads -----

  insertPayload(payload: { deviceId: string; fileIndex: number; selector: number; filePath: string; sha256: string; sizeBytes: number }): { id: number; inserted: boolean } {
    const existing = this.db.prepare(
      "SELECT id FROM local_sync_payloads WHERE device_id = ? AND file_index = ? AND sha256 = ?"
    ).get(payload.deviceId, payload.fileIndex, payload.sha256) as { id: number } | undefined;
    if (existing) return { id: existing.id, inserted: false };
    const result = this.db.prepare(
      `INSERT INTO local_sync_payloads (device_id, file_index, selector, file_path, sha256, size_bytes, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(payload.deviceId, payload.fileIndex, payload.selector, payload.filePath, payload.sha256, payload.sizeBytes, this.now().toISOString());
    return { id: Number(result.lastInsertRowid), inserted: true };
  }

  /** Whether an activity row points at the file (coros-record summaries point at their payload). */
  isFileReferencedByActivity(filePath: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM local_activity_files WHERE file_path = ? LIMIT 1").get(filePath));
  }

  /** The stored payload of a watch file with these exact bytes, if any. */
  findPayload(deviceId: string, fileIndex: number, sha256: string): LocalSyncPayload | undefined {
    const row = this.db.prepare("SELECT * FROM local_sync_payloads WHERE device_id = ? AND file_index = ? AND sha256 = ?").get(deviceId, fileIndex, sha256) as Record<string, unknown> | undefined;
    return row ? payloadFromRow(row) : undefined;
  }

  /** The most recently stored payload of a watch file. */
  latestPayload(deviceId: string, fileIndex: number): LocalSyncPayload | undefined {
    const row = this.db.prepare("SELECT * FROM local_sync_payloads WHERE device_id = ? AND file_index = ? ORDER BY id DESC LIMIT 1").get(deviceId, fileIndex) as Record<string, unknown> | undefined;
    return row ? payloadFromRow(row) : undefined;
  }

  hasPayload(id: number): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM local_sync_payloads WHERE id = ?").get(id));
  }

  /** Drops a payload whose bytes a newer one fully contains; its activities now point at the newer one. */
  removeSupersededPayload(id: number, supersededBy: number): void {
    this.transaction(() => {
      this.db.prepare("UPDATE local_activity_files SET payload_id = ? WHERE payload_id = ?").run(supersededBy, id);
      this.db.prepare("DELETE FROM local_sync_payloads WHERE id = ?").run(id);
    });
  }

  /** `decoder` undefined: not decoded yet (restores a payload's state when storing its activities failed). */
  recordPayloadDecode(id: number, decoder: string | undefined, records: number, error?: string): void {
    this.db.prepare("UPDATE local_sync_payloads SET decoder = ?, decoded_records = ?, decode_error = ? WHERE id = ?")
      .run(decoder ?? null, records, error ?? null, id);
  }

  listPayloads(): LocalSyncPayload[] {
    return (this.db.prepare("SELECT * FROM local_sync_payloads ORDER BY id").all() as Array<Record<string, unknown>>).map(payloadFromRow);
  }

  // ----- sync runs -----

  startRun(kind: LocalSyncRunKind, deviceId: string | undefined): number {
    const result = this.db.prepare(
      "INSERT INTO local_sync_runs (device_id, kind, started_at, state) VALUES (?, ?, ?, 'running')"
    ).run(deviceId ?? null, kind, this.now().toISOString());
    return Number(result.lastInsertRowid);
  }

  updateRun(id: number, progress: { receivedBytes?: number; totalBytes?: number; newRecords?: number }): void {
    this.db.prepare(
      `UPDATE local_sync_runs SET
         received_bytes = COALESCE(@receivedBytes, received_bytes),
         total_bytes = COALESCE(@totalBytes, total_bytes),
         new_records = COALESCE(@newRecords, new_records)
       WHERE id = @id`
    ).run({ id, receivedBytes: progress.receivedBytes ?? null, totalBytes: progress.totalBytes ?? null, newRecords: progress.newRecords ?? null });
  }

  finishRun(id: number, state: Exclude<LocalSyncRunState, "running">, error?: string): void {
    this.db.prepare("UPDATE local_sync_runs SET state = ?, finished_at = ?, error = ? WHERE id = ?")
      .run(state, this.now().toISOString(), error ?? null, id);
  }

  recentRuns(limit = 10): LocalSyncRun[] {
    return (this.db.prepare("SELECT * FROM local_sync_runs ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>).map(runFromRow);
  }

  lastSuccessfulRun(kind: LocalSyncRunKind): LocalSyncRun | undefined {
    const row = this.db.prepare("SELECT * FROM local_sync_runs WHERE kind = ? AND state = 'done' ORDER BY id DESC LIMIT 1").get(kind) as Record<string, unknown> | undefined;
    return row ? runFromRow(row) : undefined;
  }

  // ----- checkpoints (resumable transfers) -----

  getCheckpoint(deviceId: string, fileIndex: number, selector: number): LocalSyncCheckpoint | undefined {
    const row = this.db.prepare(
      "SELECT * FROM local_sync_checkpoints WHERE device_id = ? AND file_index = ? AND selector = ?"
    ).get(deviceId, fileIndex, selector) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      deviceId, fileIndex, selector,
      partialPath: (row.partial_path as string | null) ?? undefined,
      offsetBytes: row.offset_bytes as number,
      totalBytes: (row.total_bytes as number | null) ?? undefined,
      lastPayloadSha256: (row.last_payload_sha256 as string | null) ?? undefined,
      lastCompleteAt: (row.last_complete_at as string | null) ?? undefined,
      updatedAt: row.updated_at as string
    };
  }

  saveCheckpoint(checkpoint: Omit<LocalSyncCheckpoint, "updatedAt">): void {
    this.db.prepare(
      `INSERT INTO local_sync_checkpoints (device_id, file_index, selector, partial_path, offset_bytes, total_bytes, last_payload_sha256, last_complete_at, updated_at)
       VALUES (@deviceId, @fileIndex, @selector, @partialPath, @offsetBytes, @totalBytes, @lastPayloadSha256, @lastCompleteAt, @updatedAt)
       ON CONFLICT(device_id, file_index, selector) DO UPDATE SET
         partial_path = excluded.partial_path, offset_bytes = excluded.offset_bytes, total_bytes = excluded.total_bytes,
         last_payload_sha256 = excluded.last_payload_sha256, last_complete_at = excluded.last_complete_at,
         updated_at = excluded.updated_at`
    ).run({
      deviceId: checkpoint.deviceId,
      fileIndex: checkpoint.fileIndex,
      selector: checkpoint.selector,
      partialPath: checkpoint.partialPath ?? null,
      offsetBytes: checkpoint.offsetBytes,
      totalBytes: checkpoint.totalBytes ?? null,
      lastPayloadSha256: checkpoint.lastPayloadSha256 ?? null,
      lastCompleteAt: checkpoint.lastCompleteAt ?? null,
      updatedAt: this.now().toISOString()
    });
  }

  transaction<T>(body: () => T): T {
    return this.db.transaction(body)();
  }
}
