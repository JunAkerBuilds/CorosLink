import { requireDatabase } from "./database";
import type { WorkoutBrief, WorkoutDebrief, WorkoutJournalEntry, WorkoutJournalRef } from "./workoutJournalTypes";

// Briefs and debriefs live in their own table, created on first use and keyed
// by a hash of the COROS user ID so two accounts on one machine stay apart.

interface JournalRow {
  entry_id: string;
  happen_day: string;
  plan_id: string | null;
  id_in_plan: string | null;
  activity_id: string | null;
  workout_name: string | null;
  sport_type: number | null;
  brief_json: string | null;
  debrief_json: string | null;
  created_at: string;
  updated_at: string;
}

let preparedFor: unknown;

function database() {
  const db = requireDatabase();
  if (preparedFor !== db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workout_journal (
        entry_id TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        happen_day TEXT NOT NULL,
        plan_id TEXT,
        id_in_plan TEXT,
        activity_id TEXT,
        workout_name TEXT,
        sport_type INTEGER,
        brief_json TEXT,
        debrief_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workout_journal_day
        ON workout_journal(user_key, happen_day);
      CREATE INDEX IF NOT EXISTS idx_workout_journal_plan
        ON workout_journal(user_key, plan_id, id_in_plan);
      CREATE INDEX IF NOT EXISTS idx_workout_journal_activity
        ON workout_journal(user_key, activity_id);
    `);
    preparedFor = db;
  }
  return db;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function toEntry(row: JournalRow): WorkoutJournalEntry {
  const brief = parseJson<WorkoutBrief>(row.brief_json);
  const debrief = parseJson<WorkoutDebrief>(row.debrief_json);
  return {
    entryId: row.entry_id,
    happenDay: row.happen_day,
    ...(row.plan_id && row.id_in_plan ? { planId: row.plan_id, idInPlan: row.id_in_plan } : {}),
    ...(row.activity_id ? { activityId: row.activity_id } : {}),
    ...(row.workout_name ? { workoutName: row.workout_name } : {}),
    ...(row.sport_type ? { sportType: row.sport_type } : {}),
    ...(brief ? { brief } : {}),
    ...(debrief ? { debrief } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listJournalRows(userKey: string, startDay: string, endDay: string): WorkoutJournalEntry[] {
  return (database()
    .prepare(
      `SELECT * FROM workout_journal
       WHERE user_key = ? AND happen_day BETWEEN ? AND ?
       ORDER BY happen_day, created_at`
    )
    .all(userKey, startDay, endDay) as JournalRow[]).map(toEntry);
}

/** Entries attached to this scheduled occurrence or activity, on any day. */
export function findJournalRows(
  userKey: string,
  ref: Pick<WorkoutJournalRef, "planId" | "idInPlan" | "activityId">
): WorkoutJournalEntry[] {
  return (database()
    .prepare(
      `SELECT * FROM workout_journal
       WHERE user_key = ?
         AND ((plan_id = ? AND id_in_plan = ?) OR activity_id = ?)`
    )
    .all(userKey, ref.planId ?? null, ref.idInPlan ?? null, ref.activityId ?? null) as JournalRow[]).map(toEntry);
}

export function upsertJournalRow(userKey: string, entry: WorkoutJournalEntry): void {
  database()
    .prepare(
      `INSERT INTO workout_journal (
         entry_id, user_key, happen_day, plan_id, id_in_plan, activity_id,
         workout_name, sport_type, brief_json, debrief_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         happen_day = excluded.happen_day,
         plan_id = excluded.plan_id,
         id_in_plan = excluded.id_in_plan,
         activity_id = excluded.activity_id,
         workout_name = excluded.workout_name,
         sport_type = excluded.sport_type,
         brief_json = excluded.brief_json,
         debrief_json = excluded.debrief_json,
         updated_at = excluded.updated_at
       WHERE workout_journal.user_key = excluded.user_key`
    )
    .run(
      entry.entryId,
      userKey,
      entry.happenDay,
      entry.planId ?? null,
      entry.idInPlan ?? null,
      entry.activityId ?? null,
      entry.workoutName ?? null,
      entry.sportType ?? null,
      entry.brief ? JSON.stringify(entry.brief) : null,
      entry.debrief ? JSON.stringify(entry.debrief) : null,
      entry.createdAt,
      entry.updatedAt
    );
}

export function deleteJournalRow(userKey: string, entryId: string): void {
  database()
    .prepare("DELETE FROM workout_journal WHERE user_key = ? AND entry_id = ?")
    .run(userKey, entryId);
}

/** COROS moves a workout by re-adding it, so its notes follow the new occurrence. */
export function moveScheduledJournalRows(
  userKey: string,
  from: { planId: string; idInPlan: string },
  to: { planId: string; idInPlan: string; happenDay: string }
): number {
  return database()
    .prepare(
      `UPDATE workout_journal
       SET plan_id = ?, id_in_plan = ?, happen_day = ?
       WHERE user_key = ? AND plan_id = ? AND id_in_plan = ? AND activity_id IS NULL`
    )
    .run(to.planId, to.idInPlan, to.happenDay, userKey, from.planId, from.idInPlan).changes;
}
