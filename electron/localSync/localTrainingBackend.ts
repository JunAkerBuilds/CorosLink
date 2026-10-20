import type Database from "better-sqlite3";

/**
 * Local-Only Mode's answer to CorosLink's COROS training API calls: the
 * workout library and the training calendar live in SQLite instead of the
 * COROS cloud. It speaks the same request and response shapes as the COROS
 * endpoints it replaces, so the Training Library, the calendar and the
 * workout editor work unchanged, and the watch gets workouts over Bluetooth.
 *
 * COROS's own calculations stay out: estimates sum the steps' time and
 * distance, and training load is left unknown. COROS's native training plans
 * are a cloud feature and are refused.
 */

const LOCAL_TRAINING_PLAN_ID = "0";

class LocalTrainingUnavailableError extends Error {
  constructor(message: string) {
    super(`Local-Only Mode: ${message}`);
    this.name = "LocalTrainingUnavailableError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number>;
}

/** Program fields COROS fills on its side; a local program gets the same shape. */
type Program = Record<string, unknown>;

const HANDLED = new Set([
  "/training/program/query", "/training/program/add", "/training/program/detail", "/training/program/update",
  "/training/program/delete", "/training/program/calculate", "/training/program/estimate",
  "/training/schedule/query", "/training/schedule/update", "/training/schedule/executeSubPlan", "/training/schedule/quitSubPlan",
  "/training/plan/query", "/training/plan/detail", "/training/plan/add", "/training/plan/update", "/training/plan/copy", "/training/plan/delete",
  "/account/query"
]);

const NATIVE_PLANS = "COROS training plans live in the COROS cloud. Use CorosLink plans in the Training Library instead.";

const number = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
};

/** Time (s) and distance (cm) the steps add up to, counting repeat groups' sets. */
export function estimateProgram(program: Program): { duration: number; distance: number; sets: number } {
  const exercises = Array.isArray(program.exercises) ? program.exercises.filter((item): item is Program => Boolean(item) && typeof item === "object") : [];
  const groupSets = new Map<string, number>();
  for (const exercise of exercises) if (exercise.isGroup === true) groupSets.set(String(exercise.id), Math.max(1, number(exercise.sets) ?? 1));
  let duration = 0;
  let distance = 0;
  for (const exercise of exercises) {
    // restType 1 is a timed rest (seconds); 3 is none.
    if (exercise.isGroup === true) {
      if (number(exercise.restType) === 1) duration += (number(exercise.restValue) ?? 0) * Math.max(0, (number(exercise.sets) ?? 1) - 1);
      continue;
    }
    const repeat = (groupSets.get(String(exercise.groupId ?? "0")) ?? 1) * Math.max(1, number(exercise.sets) ?? 1);
    const value = number(exercise.targetValue) ?? 0;
    if (number(exercise.targetType) === 2) duration += value * repeat;
    if (number(exercise.targetType) === 5) distance += value * repeat;
    if (number(exercise.restType) === 1) duration += (number(exercise.restValue) ?? 0) * repeat;
  }
  return {
    duration: duration || (number(program.estimatedTime) ?? 0),
    distance: distance || (number(program.estimatedDistance) ?? 0),
    sets: exercises.length
  };
}

export class LocalTrainingBackend {
  constructor(private readonly db: Database.Database, private readonly profile: () => Record<string, unknown> = () => ({}), private readonly now: () => Date = () => new Date()) {}

  handles(path: string): boolean {
    return HANDLED.has(path);
  }

  /** Answers one request the way COROS would (the unwrapped `data`). */
  request(path: string, options: RequestOptions = {}): unknown {
    const body = typeof options.body === "string" ? JSON.parse(options.body) as unknown : options.body;
    const params = options.params ?? {};
    switch (path) {
      case "/training/program/query": return this.programs();
      case "/training/program/detail": return this.program(String(params.id ?? (body as Program | undefined)?.id ?? ""));
      case "/training/program/add": return this.addProgram(body as Program);
      case "/training/program/update": this.updateProgram(body as Program); return undefined;
      case "/training/program/delete": this.deletePrograms(Array.isArray(body) ? body.map(String) : []); return undefined;
      case "/training/program/calculate": return this.calculate(body as Program);
      case "/training/program/estimate": return this.estimate(body as { program?: Program });
      case "/training/schedule/query": return this.schedule(String(params.startDate ?? ""), String(params.endDate ?? ""));
      case "/training/schedule/update": this.updateSchedule(body as Program); return undefined;
      case "/training/plan/query": return [];
      case "/account/query": return this.profile();
      default: throw new LocalTrainingUnavailableError(NATIVE_PLANS);
    }
  }

  private nextId(): string {
    const row = this.db.prepare("SELECT MAX(CAST(id AS INTEGER)) AS id FROM local_training_programs").get() as { id: number | null };
    // Numeric like COROS's ids, so they also fit the watch's int64 program id.
    return String(Math.max(Date.now() * 1000, (row.id ?? 0) + 1));
  }

  programs(): Program[] {
    return (this.db.prepare("SELECT program FROM local_training_programs ORDER BY created_at DESC").all() as Array<{ program: string }>)
      .map(row => JSON.parse(row.program) as Program);
  }

  program(id: string): Program {
    const row = this.db.prepare("SELECT program FROM local_training_programs WHERE id = ?").get(id) as { program: string } | undefined;
    if (!row) throw new LocalTrainingUnavailableError("This workout isn't on this computer.");
    return JSON.parse(row.program) as Program;
  }

  private addProgram(program: Program): string {
    if (!program || typeof program !== "object") throw new Error("A workout is required.");
    const id = this.nextId();
    const created = Math.floor(this.now().getTime() / 1000);
    const stored = { ...program, id, createTimestamp: created, version: 1 };
    this.db.prepare("INSERT INTO local_training_programs (id, program, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, JSON.stringify(stored), created, created);
    return id;
  }

  private updateProgram(program: Program): void {
    const id = String(program?.id ?? "");
    const previous = this.program(id);
    const stored = { ...program, id, createTimestamp: previous.createTimestamp, version: (number(previous.version) ?? 1) + 1 };
    this.db.prepare("UPDATE local_training_programs SET program = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(stored), Math.floor(this.now().getTime() / 1000), id);
  }

  private deletePrograms(ids: string[]): void {
    const remove = this.db.prepare("DELETE FROM local_training_programs WHERE id = ?");
    this.db.transaction(() => { for (const id of ids) remove.run(id); })();
  }

  private calculate(program: Program): Record<string, unknown> {
    const { duration, distance, sets } = estimateProgram(program ?? {});
    return { planDuration: duration, planDistance: distance, planSets: sets, ...(program?.distanceDisplayUnit !== undefined ? { distanceDisplayUnit: program.distanceDisplayUnit } : {}) };
  }

  private estimate(request: { program?: Program }): Record<string, unknown> {
    const { duration, distance } = estimateProgram(request?.program ?? {});
    return { planDuration: duration, planDistance: distance };
  }

  /** Schedule rows in [startDay, endDay] (YYYYMMDD), as /training/schedule/query returns them. */
  schedule(startDay: string, endDay: string): { entities: Program[]; programs: Program[]; maxIdInPlan: number } {
    const rows = this.db.prepare(
      `SELECT * FROM local_training_schedule WHERE (? = '' OR happen_day >= ?) AND (? = '' OR happen_day <= ?)
       ORDER BY happen_day, sort_no`
    ).all(startDay, startDay, endDay, endDay) as Array<{ id_in_plan: number; happen_day: string; sort_no: number; program: string; exercise_bar_chart: string | null }>;
    const max = this.db.prepare("SELECT MAX(id_in_plan) AS id FROM local_training_schedule").get() as { id: number | null };
    return {
      entities: rows.map(row => ({
        happenDay: Number(row.happen_day), idInPlan: String(row.id_in_plan), planProgramId: String(row.id_in_plan),
        planId: LOCAL_TRAINING_PLAN_ID, sortNoInSchedule: row.sort_no, status: 1,
        ...(row.exercise_bar_chart ? { exerciseBarChart: JSON.parse(row.exercise_bar_chart) as unknown } : {})
      })),
      programs: rows.map(row => ({ ...JSON.parse(row.program) as Program, idInPlan: String(row.id_in_plan) })),
      maxIdInPlan: max.id ?? 0
    };
  }

  /** versionObjects status 1 adds, 2 replaces the workout, 3 removes; entities and programs pair by idInPlan. */
  private updateSchedule(request: Program): void {
    const entities = Array.isArray(request?.entities) ? request.entities as Program[] : [];
    const programs = Array.isArray(request?.programs) ? request.programs as Program[] : [];
    const versions = Array.isArray(request?.versionObjects) ? request.versionObjects as Program[] : [];
    const updatedAt = Math.floor(this.now().getTime() / 1000);
    this.db.transaction(() => {
      for (const version of versions) {
        const idInPlan = number(version.id);
        if (idInPlan === undefined) throw new Error("A scheduled workout needs an idInPlan.");
        const status = number(version.status);
        if (status === 3) {
          this.db.prepare("DELETE FROM local_training_schedule WHERE id_in_plan = ?").run(idInPlan);
          continue;
        }
        const entity = entities.find(item => number(item.idInPlan) === idInPlan) ?? entities[0];
        const program = programs.find(item => number(item.idInPlan) === idInPlan) ?? programs[0];
        if (!program) throw new Error("A scheduled workout needs its workout.");
        const existing = this.db.prepare("SELECT happen_day, sort_no FROM local_training_schedule WHERE id_in_plan = ?").get(idInPlan) as { happen_day: string; sort_no: number } | undefined;
        const happenDay = String(entity?.happenDay ?? existing?.happen_day ?? "");
        if (!/^\d{8}$/.test(happenDay)) throw new Error("A scheduled workout needs a day.");
        if (status === 2 && !existing) throw new Error("That scheduled workout no longer exists.");
        const chart = entity?.exerciseBarChart ?? program.exerciseBarChart;
        this.db.prepare(
          `INSERT INTO local_training_schedule (id_in_plan, happen_day, sort_no, program, exercise_bar_chart, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id_in_plan) DO UPDATE SET happen_day = excluded.happen_day, sort_no = excluded.sort_no, program = excluded.program,
             exercise_bar_chart = excluded.exercise_bar_chart, updated_at = excluded.updated_at`
        ).run(idInPlan, happenDay, number(entity?.sortNoInSchedule) ?? existing?.sort_no ?? 1, JSON.stringify({ ...program, idInPlan: String(idInPlan) }),
          chart === undefined ? null : JSON.stringify(chart), updatedAt);
      }
    })();
  }

  /** Everything, for backups. */
  exportData(): { programs: Program[]; schedule: Array<{ idInPlan: number; happenDay: string; sortNo: number; program: Program }> } {
    const schedule = (this.db.prepare("SELECT * FROM local_training_schedule ORDER BY happen_day, sort_no").all() as Array<{ id_in_plan: number; happen_day: string; sort_no: number; program: string }>)
      .map(row => ({ idInPlan: row.id_in_plan, happenDay: row.happen_day, sortNo: row.sort_no, program: JSON.parse(row.program) as Program }));
    return { programs: this.programs(), schedule };
  }

  /** Adds what a backup holds; existing workouts and schedule entries are kept. Returns how many were new. */
  importData(data: { programs?: unknown; schedule?: unknown }): number {
    let added = 0;
    const insertProgram = this.db.prepare("INSERT OR IGNORE INTO local_training_programs (id, program, created_at, updated_at) VALUES (?, ?, ?, ?)");
    const insertEntry = this.db.prepare("INSERT OR IGNORE INTO local_training_schedule (id_in_plan, happen_day, sort_no, program, updated_at) VALUES (?, ?, ?, ?, ?)");
    this.db.transaction(() => {
      for (const program of Array.isArray(data.programs) ? data.programs as Program[] : []) {
        if (!program || typeof program !== "object" || !/^\d+$/.test(String(program.id ?? ""))) continue;
        const created = number(program.createTimestamp) ?? 0;
        added += insertProgram.run(String(program.id), JSON.stringify(program), created, created).changes;
      }
      for (const entry of Array.isArray(data.schedule) ? data.schedule as Array<Record<string, unknown>> : []) {
        const idInPlan = number(entry?.idInPlan);
        if (idInPlan === undefined || !/^\d{8}$/.test(String(entry.happenDay)) || !entry.program || typeof entry.program !== "object") continue;
        added += insertEntry.run(idInPlan, String(entry.happenDay), number(entry.sortNo) ?? 1, JSON.stringify(entry.program), 0).changes;
      }
    })();
    return added;
  }
}
