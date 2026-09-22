import crypto from "node:crypto";
import { z } from "zod/v4";
import type { WorkoutEditRef, CorosMcpTool } from "./types";
import type { WorkoutEditSource } from "./corosWorkoutEditor";
import type { StrengthEditPreview, StrengthStepPatch } from "./workoutEditTypes";
import { strengthPatchSchema, patchStrengthProgram, sourceRevision, strengthSteps, weightKg, stableJson, prescriptionMatches, calculationPreservesProgram } from "./strengthWorkoutPatch";

const MAX_BATCH = 25;
const MAX_DISCOVERY = 200;
const TTL = 24 * 60 * 60_000;
const id = z.string().min(1).max(200);
const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), programId: id }).strict(),
  z.object({ kind: z.literal("scheduled"), happenDay: z.string().regex(/^\d{8}$/), planId: z.string().max(200), idInPlan: id, planProgramId: z.string().max(200) }).strict()
]);
export const workoutEditSchemas = {
  find_editable_workouts: z.object({ source: z.enum(["library", "calendar", "both"]), startDay: z.string().optional(), endDay: z.string().optional() }).strict(),
  read_workout_for_edit: z.object({ ref: refSchema }).strict(),
  prepare_workout_edit: z.object({ documentId: id, revision: id, patches: z.array(strengthPatchSchema).min(1).max(200) }).strict(),
  prepare_exercise_load_update: z.object({ documents: z.array(z.object({ documentId: id, revision: id }).strict()).min(1).max(MAX_BATCH), exerciseIds: z.array(id).min(1).max(100), oldLoad: z.object({ value: z.number().finite().min(0).max(2000), unit: z.enum(["kg", "lb"]) }).strict(), newLoad: z.object({ value: z.number().finite().min(0).max(2000), unit: z.enum(["kg", "lb"]) }).strict() }).strict(),
  get_workout_edit_status: z.object({ proposalId: id }).strict(),
  cancel_workout_edit: z.object({ proposalId: id }).strict()
};
export type WorkoutEditToolName = keyof typeof workoutEditSchemas;
const descriptions: Record<WorkoutEditToolName, string> = {
  find_editable_workouts: "Find Strength library workouts and independent future calendar workouts through Training Hub. Calendar requires explicit YYYYMMDD startDay and endDay, at most 90 days. Returns scope and exclusions. Read each intended workout next. Never claim this searches history, native plans, or all future dates.",
  read_workout_for_edit: "Read an existing Strength workout, documentId, revision, and exact step IDs. Use before preparing edits. Handles expire in 24 hours. Only future independent occurrences and library workouts are supported.",
  prepare_workout_edit: "Prepare in-place changes to existing Strength sets, reps/time/open target, load, or timed inter-set rest. Use exact documentId and revision from read_workout_for_edit. Does not save. Athlete must review and Save to COROS in the app. Never draft a replacement or claim it is saved.",
  prepare_exercise_load_update: "Prepare a one-time load replacement across explicitly read workouts (maximum 25). Match exact catalog exerciseIds AND old load at COROS precision. Select IDs matching the requested equipment; do not infer kettlebells from weight alone. Library and scheduled copies are independent. Does not save; athlete reviews and selects workouts in CorosLink. Similar labels such as 26 lb and 12 kg are not exact matches.",
  get_workout_edit_status: "Read persisted per-workout edit results. Distinguish prepared, verified, saved but unverified, and unknown outcomes; never claim all saved on partial success.",
  cancel_workout_edit: "Cancel pending edits or stop a batch after the current write settles. Does not undo saved workouts."
};
export function getWorkoutEditTools(): CorosMcpTool[] {
  return (Object.keys(workoutEditSchemas) as WorkoutEditToolName[]).map(name => ({ name, description: descriptions[name], inputSchema: z.toJSONSchema(workoutEditSchemas[name]) }));
}
export function isWorkoutEditTool(name: string): name is WorkoutEditToolName { return Object.hasOwn(workoutEditSchemas, name); }

interface Document { id: string; account: string; origin: string; createdAt: number; source: WorkoutEditSource; revision: string }
interface StoredItem { document: Document; program: Record<string, unknown> }
interface Proposal { account: string; preview: StrengthEditPreview; items: StoredItem[]; cancelRequested?: boolean; selectedIds?: string[] }
export interface WorkoutEditAdapter {
  account(): string;
  today(): string;
  read(ref: WorkoutEditRef): Promise<WorkoutEditSource>;
  find(input: { source: "library" | "calendar" | "both"; startDay?: string; endDay?: string }): Promise<{ refs: WorkoutEditRef[]; exclusions: string[] }>;
  preview(source: WorkoutEditSource, program: Record<string, unknown>): Promise<Record<string, unknown>>;
  write(source: WorkoutEditSource, program: Record<string, unknown>): Promise<void>;
  load(): string | undefined;
  persist(value: string): void;
  wait?(ms: number): Promise<void>;
}
function hasUnresolvedWrite(p: Proposal): boolean {
  return p.preview.state === "saving" || p.preview.items.some(item =>
    ["writing", "unknown_outcome", "saved_unverified"].includes(item.state));
}
function date(day: string): number {
  if (!/^\d{8}$/.test(day)) throw new Error("Dates must use YYYYMMDD.");
  const value = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  if (new Date(value).toISOString().slice(0, 10).replaceAll("-", "") !== day) throw new Error("Invalid calendar date.");
  return value;
}
export function requireStrengthEligibility(source: WorkoutEditSource, today: string): void {
  for (const value of [source.program.id, source.entity?.idInPlan, source.entity?.planId, source.entity?.planProgramId]) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("COROS returned an unsafe numeric identity.");
  }
  if (source.ref.kind === "library" && String(source.program.id) !== source.ref.programId) throw new Error("Library identity does not match the requested workout.");
  if (Number(source.program.sportType) !== 4) throw new Error("Only Strength workouts are supported.");
  if (source.ref.kind === "scheduled") {
    date(source.ref.happenDay);
    if (source.ref.happenDay <= today) throw new Error("Today and past workouts are excluded; use an independent future occurrence.");
    const entity = source.entity;
    if (!entity || entity.planId === undefined) throw new Error("Calendar ownership is unavailable.");
    for (const key of ["happenDay", "planId", "idInPlan", "planProgramId"] as const) {
      if (String(entity[key] ?? "") !== source.ref[key]) throw new Error("Calendar identity changed. Read the occurrence again.");
    }
    if (source.strengthEditOwnership === "native") throw new Error("Native plan-owned workouts are not supported.");
    if (source.strengthEditOwnership !== "independent") throw new Error("Calendar plan ownership cannot be established safely. Edit its library template instead.");
    const hasActivityId = (value: unknown) => value !== undefined && value !== null && !["", "0"].includes(String(value).trim());
    if (Number(entity.status) === 3 || [true, 1, "1"].includes(entity.finished as boolean | number | string) ||
      Number(entity.finishTime) > 0 || Number(entity.actualStartTime) > 0 ||
      hasActivityId(entity.activityId) || hasActivityId(entity.labelId)) {
      throw new Error("This occurrence is completed, active, or removed.");
    }
  }
}

export class WorkoutEditService {
  private documents = new Map<string, Document>();
  private proposals = new Map<string, Proposal>();
  private executing = false;
  constructor(private readonly adapter: WorkoutEditAdapter) {
    const saved = adapter.load();
    if (saved) {
      const state = JSON.parse(saved) as { version: number; documents: Document[]; proposals: Proposal[] };
      if (state.version !== 1 || !Array.isArray(state.documents) || !Array.isArray(state.proposals)) throw new Error("Unsupported workout edit store.");
      for (const d of state.documents) if (d.createdAt + TTL > Date.now()) this.documents.set(d.id, d);
      for (const p of state.proposals) {
        if (p.preview.createdAt + 7 * TTL < Date.now() && !hasUnresolvedWrite(p)) continue;
        for (const item of p.preview.items) if (item.state === "writing") { item.state = "unknown_outcome"; item.message = "Interrupted save. Check status to reconcile; no automatic retry."; }
        if (p.preview.state === "saving") p.preview.state = "finished";
        this.proposals.set(p.preview.proposalId, p);
      }
      this.persist();
    }
  }
  private persist() {
    const now = Date.now();
    for (const [key, d] of this.documents) if (d.createdAt + TTL < now) this.documents.delete(key);
    for (const [key, p] of this.proposals) if (p.preview.createdAt + 7 * TTL < now && !hasUnresolvedWrite(p)) this.proposals.delete(key);
    this.adapter.persist(JSON.stringify({ version: 1, documents: [...this.documents.values()], proposals: [...this.proposals.values()] }));
  }
  private assertAccount(account: string) { if (this.adapter.account() !== account) throw new Error("COROS account changed. Prepare a new review."); }
  private proposal(proposalId: string, origin?: string): Proposal {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error("Workout edit proposal not found or expired.");
    this.assertAccount(p.account);
    if (origin && p.preview.origin !== origin) throw new Error("This proposal belongs to another client capability.");
    if (p.preview.state === "awaiting_confirmation" && p.preview.expiresAt < Date.now()) p.preview.state = "expired";
    return p;
  }
  private document(documentId: string, revision: string, origin: string): Document {
    const d = this.documents.get(documentId);
    if (!d || d.createdAt + TTL < Date.now() || d.revision !== revision || d.origin !== origin) throw new Error("Workout document expired or revision is invalid. Read it again.");
    this.assertAccount(d.account);
    return d;
  }
  list(): StrengthEditPreview[] {
    const account = this.adapter.account();
    return [...this.proposals.values()].filter(p => p.account === account).map(p => structuredClone(this.proposal(p.preview.proposalId).preview)).reverse();
  }
  cancelExternal(): void {
    for (const p of this.proposals.values()) if (p.preview.origin === "external") this.cancelProposal(p);
    for (const [key, d] of this.documents) if (d.origin === "external") this.documents.delete(key);
    this.persist();
  }
  private cancelProposal(p: Proposal) {
    p.cancelRequested = true;
    for (const item of p.preview.items) if (item.state === "prepared") item.state = "cancelled";
    if (p.preview.state === "awaiting_confirmation") p.preview.state = "cancelled";
  }
  async tool(name: WorkoutEditToolName, args: unknown, origin: "coach" | "external" = "coach"): Promise<unknown> {
    const account = this.adapter.account();
    if (name === "find_editable_workouts") {
      const input = workoutEditSchemas.find_editable_workouts.parse(args);
      if (input.source !== "library") {
        if (!input.startDay || !input.endDay || date(input.endDay) < date(input.startDay) || date(input.endDay) - date(input.startDay) > 89 * 86400000) throw new Error("Choose a calendar range of at most 90 days.");
      }
      const found = await this.adapter.find(input);
      this.assertAccount(account);
      if (found.refs.length > MAX_DISCOVERY) throw new Error("More than 200 candidates. Narrow the calendar range or edit specific library references; no truncated search is returned.");
      const workouts: Array<{ ref: WorkoutEditRef; name: string }> = [];
      const exclusions = [...found.exclusions];
      for (const ref of found.refs) {
        try { const source = await this.adapter.read(ref); requireStrengthEligibility(source, this.adapter.today()); workouts.push({ ref, name: String(source.program.name ?? "Workout") }); }
        catch (error) { exclusions.push(`${ref.kind === "library" ? ref.programId : ref.happenDay + "/" + ref.idInPlan}: ${message(error)}`); }
        this.assertAccount(account);
      }
      return { workouts, exclusions, scope: input, complete: exclusions.length === 0, limits: { maxBatch: MAX_BATCH, maxCalendarDays: 90 }, message: "Only listed references are in scope. Read intended workouts before preparing changes. Today, history and native plan-owned occurrences are excluded." };
    }
    if (name === "read_workout_for_edit") {
      const { ref } = workoutEditSchemas.read_workout_for_edit.parse(args);
      const source = await this.adapter.read(ref);
      this.assertAccount(account);
      requireStrengthEligibility(source, this.adapter.today());
      if (stableJson(source).length > 200_000) throw new Error("Workout payload is too large for a reviewed edit.");
      this.persist();
      if (this.documents.size >= 200) this.documents.delete(this.documents.keys().next().value!);
      const d: Document = { id: crypto.randomUUID(), account, origin, createdAt: Date.now(), source, revision: sourceRevision(source) };
      this.documents.set(d.id, d); this.persist();
      return { documentId: d.id, revision: d.revision, ref, name: source.program.name, steps: strengthSteps(source.program), expiresAt: d.createdAt + TTL };
    }
    if (name === "cancel_workout_edit") {
      const { proposalId } = workoutEditSchemas.cancel_workout_edit.parse(args);
      const p = this.proposal(proposalId, origin); this.cancelProposal(p); this.persist(); return structuredClone(p.preview);
    }
    if (name === "get_workout_edit_status") {
      const { proposalId } = workoutEditSchemas.get_workout_edit_status.parse(args);
      return this.status(proposalId, origin);
    }
    const edits: Array<{ document: Document; patches: StrengthStepPatch[] }> = [];
    const exclusions: string[] = [];
    if (name === "prepare_workout_edit") {
      const input = workoutEditSchemas.prepare_workout_edit.parse(args);
      edits.push({ document: this.document(input.documentId, input.revision, origin), patches: input.patches });
    } else {
      const input = workoutEditSchemas.prepare_exercise_load_update.parse(args);
      for (const handle of input.documents) {
        const document = this.document(handle.documentId, handle.revision, origin);
        const raws = document.source.program.exercises as Record<string, unknown>[];
        const patches = strengthSteps(document.source.program).filter(s => s.exerciseId && input.exerciseIds.includes(s.exerciseId) && s.editable && s.kind === "training" && s.intensity.type === "weight" && s.intensity.mode === "weight" && raws.some(r => String(r.id) === s.sourceExerciseId && Number(r.intensityValue) === weightKg(input.oldLoad.value, input.oldLoad.unit))).map(s => ({ stepId: s.id, load: { mode: "weight" as const, ...input.newLoad } }));
        if (patches.length) edits.push({ document, patches });
        else exclusions.push(`${String(document.source.program.name)}: no exact exercise/load matches.`);
      }
    }
    return this.prepare(edits, exclusions, origin, account);
  }
  private requireNoUncertainWrite(ref: WorkoutEditRef, account: string, except?: string): void {
    for (const p of this.proposals.values()) {
      if (p.account !== account || p.preview.proposalId === except) continue;
      if (p.preview.items.some(i => stableJson(i.ref) === stableJson(ref) && ["writing", "unknown_outcome", "saved_unverified"].includes(i.state))) {
        throw new Error("An earlier save for this workout is unresolved. Refresh that proposal's status before preparing or saving another edit.");
      }
    }
  }
  private async prepare(edits: Array<{ document: Document; patches: StrengthStepPatch[] }>, exclusions: string[], origin: "coach" | "external", account: string) {
    const preview: StrengthEditPreview = { proposalId: crypto.randomUUID(), reviewHash: "", createdAt: Date.now(), expiresAt: Date.now() + TTL, origin, state: "awaiting_confirmation", scope: "Only the explicitly listed library workouts and dated calendar copies; one-time update.", items: [], exclusions };
    const items: StoredItem[] = [];
    const seen = new Set<string>();
    for (const edit of edits) {
      this.requireNoUncertainWrite(edit.document.source.ref, account);
      const ref = stableJson(edit.document.source.ref);
      if (seen.has(ref)) throw new Error("The same workout was selected more than once.");
      seen.add(ref);
      const source = await this.adapter.read(edit.document.source.ref);
      this.assertAccount(account); requireStrengthEligibility(source, this.adapter.today());
      if (sourceRevision(source) !== edit.document.revision) throw new Error("Workout changed since reading. Read it again before preparing edits.");
      const { program, changes } = patchStrengthProgram(source.program, edit.patches);
      if (!changes.length) { exclusions.push(`${String(source.program.name)}: already matches; no update needed.`); continue; }
      const calculated = await this.adapter.preview(source, program);
      this.assertAccount(account);
      if (!calculationPreservesProgram(program, calculated)) throw new Error("COROS calculation changed the prescription, identity, or unrelated metadata. No review was staged.");
      items.push({ document: edit.document, program: calculated });
      preview.items.push({ id: crypto.randomUUID(), name: String(source.program.name ?? "Workout"), ref: source.ref, changes, state: "prepared" });
    }
    if (!items.length) return { state: "no_changes", exclusions, message: "No matching changes; nothing saved." };
    if (this.proposals.size >= 100) throw new Error("Too many retained edit proposals. Older proposals expire after seven days.");
    preview.reviewHash = crypto.createHash("sha256").update(stableJson({ account, preview, items })).digest("hex");
    this.proposals.set(preview.proposalId, { account, preview, items }); this.persist();
    return structuredClone(preview);
  }
  private updateSummary(p: Proposal): void {
    if (p.preview.state !== "finished") return;
    const total = p.selectedIds?.length ?? p.preview.items.length;
    const verified = p.preview.items.filter(i => i.state === "verified").length;
    p.preview.message = `${verified} of ${total} selected workouts verified.` + (verified < total ? " Unsent items require a new review; saved items are not rolled back." : "");
  }
  async status(proposalId: string, origin?: string): Promise<StrengthEditPreview> {
    const p = this.proposal(proposalId, origin);
    if (!this.executing) for (let i = 0; i < p.items.length; i++) {
      const item = p.preview.items[i]!;
      if (!["unknown_outcome", "saved_unverified"].includes(item.state)) continue;
      try {
        const actual = await this.adapter.read(item.ref); this.assertAccount(p.account);
        if (prescriptionMatches(p.items[i]!.program, actual.program)) { item.state = "verified"; item.message = "Desired prescription verified in COROS."; }
      } catch { /* Preserve uncertainty; never retry a mutation from a status read. */ }
    }
    this.assertAccount(p.account); this.updateSummary(p); this.persist(); return structuredClone(p.preview);
  }
  /** Trusted renderer only. This method is deliberately absent from every AI tool schema. */
  async confirm(proposalId: string, reviewHash: string, selectedIds: string[]): Promise<StrengthEditPreview> {
    const p = this.proposal(proposalId);
    if (p.preview.reviewHash !== reviewHash) throw new Error("Review changed. Reload before saving.");
    if (this.executing) throw new Error("Another workout edit is saving. Wait for its result.");
    if (p.preview.state !== "awaiting_confirmation") return this.status(proposalId);
    const selected = new Set(selectedIds);
    if (!Array.isArray(selectedIds) || !selected.size || selected.size !== selectedIds.length || selectedIds.some(key => !p.preview.items.some(i => i.id === key))) throw new Error("Choose valid workouts from this review.");
    this.executing = true;
    try {
      // Preflight the entire selection before the first remote write.
      for (let i = 0; i < p.items.length; i++) if (selected.has(p.preview.items[i]!.id)) {
        const item = p.items[i]!;
        this.requireNoUncertainWrite(item.document.source.ref, p.account, proposalId);
        const current = await this.adapter.read(item.document.source.ref);
        this.assertAccount(p.account); requireStrengthEligibility(current, this.adapter.today());
        if (sourceRevision(current) !== item.document.revision) throw new Error("A selected workout changed. No workouts saved; prepare a new review.");
      }
      if (p.cancelRequested) return structuredClone(p.preview);
      if (p.preview.expiresAt < Date.now()) throw new Error("Review expired before saving. Prepare a new review.");
      p.selectedIds = [...selectedIds];
      p.preview.state = "saving";
      for (const item of p.preview.items) if (!selected.has(item.id)) item.state = "cancelled";
      this.persist();
      for (let i = 0; i < p.items.length; i++) {
        const item = p.preview.items[i]!;
        if (item.state !== "prepared" || p.cancelRequested) continue;
        const stored = p.items[i]!;
        try {
          const current = await this.adapter.read(item.ref);
          this.assertAccount(p.account); requireStrengthEligibility(current, this.adapter.today());
          if (sourceRevision(current) !== stored.document.revision) throw new Error("Workout changed after review.");
          if (p.cancelRequested) break;
          item.state = "writing"; this.persist();
          await this.adapter.write(current, stored.program);
          item.state = "saved_unverified"; item.message = "Save acknowledged; waiting for read-back."; this.persist();
          for (const delay of [0, 250, 600, 1200]) {
            if (delay) await (this.adapter.wait?.(delay) ?? new Promise(r => setTimeout(r, delay)));
            this.assertAccount(p.account);
            try {
              const actual = await this.adapter.read(item.ref);
              this.assertAccount(p.account);
              if (prescriptionMatches(stored.program, actual.program)) { item.state = "verified"; item.message = "Prescription verified in COROS."; break; }
            } catch { this.assertAccount(p.account); /* Retry reads only; leave the acknowledged save unverified. */ }
          }
          this.persist();
          if (item.state !== "verified") break;
        } catch (error) {
          item.state = error instanceof Error && "code" in error && error.code === "WORKOUT_EDIT_NOT_SENT" ? "conflicted" : item.state === "writing" ? "unknown_outcome" : item.state === "saved_unverified" ? "saved_unverified" : "conflicted";
          item.message = item.state === "unknown_outcome" ? "Save outcome unknown. Check status before preparing another edit." : message(error);
          this.persist(); break;
        }
      }
      p.preview.state = "finished";
      this.updateSummary(p);
      this.persist(); return structuredClone(p.preview);
    } finally { this.executing = false; }
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : "Unable to read or update this workout."; }

export const strengthEditPreviewSchema = z.object({
  proposalId: z.string().uuid(), reviewHash: z.string().length(64), createdAt: z.number(), expiresAt: z.number(),
  origin: z.enum(["coach", "external"]), state: z.enum(["awaiting_confirmation", "saving", "finished", "cancelled", "expired"]),
  scope: z.string(), message: z.string().optional(), exclusions: z.array(z.string()).max(500),
  items: z.array(z.object({ id: z.string().uuid(), name: z.string(), ref: refSchema,
    changes: z.array(z.object({ exercise: z.string(), stepId: z.string(), field: z.string(), before: z.string(), after: z.string() })),
    state: z.enum(["prepared", "writing", "verified", "saved_unverified", "conflicted", "unknown_outcome", "cancelled"]), message: z.string().optional()
  })).max(MAX_BATCH)
});
