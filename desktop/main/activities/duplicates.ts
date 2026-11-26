// One workout, one activity. The same run can reach the store twice: from the phone (COROS's id, with COROS's
// detail) and read from the watch (Local mode's `coros-<start>-<type>` id, with a FIT file), or from CorosLink's
// watch archive by the move. COROS and the watch round a start differently, so a copy is the same workout when the
// sport matches and the starts are within two minutes.
//
// The rule, kept here only (LocalStore runs it on every write, the launch runs it over everything once):
// - Keep COROS's id when one copy has it (the phone and Training Hub know the workout by it); between watch copies,
//   the one with more data (detail with a route, streams, laps), then the earlier id.
// - Before a copy goes, the kept one takes what only it had: summary fields, detail (its missing parts), Coach's
//   notes, strength corrections, the FIT file. Nothing only one copy has is lost.
// - Merged ids are remembered, so a later watch sync writing the old id again goes straight to the kept one.
// A watch workout with a FIT file and no detail gets its detail from the FIT, as the watch sync makes it.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LocalStore } from "../localStore";
import { activityDetailBody } from "../watch/engine/activityItems";
import { recordingFromFit } from "../watch/engine/activityRecording";
import type { Sport } from "../watch/engine/workoutSummary";

/** Two copies are one workout when their starts are this close (seconds). */
export const SAME_START_S = 120;
const FIT_ID = /^[A-Za-z0-9._-]{1,80}$/;

type Body = Record<string, unknown>;
export interface Change { collection: string; id: string; body?: object; deleted?: true }
export interface Copy { id: string; body: Body; detail?: Body }

/** COROS's own activity ids are numbers; the watch's are `coros-<start>-<type>`. */
export const isCorosId = (id: string): boolean => /^\d+$/.test(id);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The same sport (COROS's code when both have one) and starts within SAME_START_S. */
export function sameWorkout(a: Body, b: Body): boolean {
  const sa = num(a.start), sb = num(b.start);
  if (sa === undefined || sb === undefined || Math.abs(sa - sb) > SAME_START_S) return false;
  const ca = num(a.sportCode), cb = num(b.sportCode);
  return ca !== undefined && cb !== undefined ? ca === cb : a.sport === b.sport;
}

const filled = (v: unknown) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);

/** How much a detail shows: a map, then streams (charts), then laps (splits), then zones. */
export function detailScore(detail: Body | undefined): number {
  if (!detail) return 0;
  return (filled(detail.route) ? 8 : 0) + (filled(detail.streams) ? 4 : 0) + (filled(detail.laps) ? 2 : 0) + (filled(detail.zones) ? 1 : 0);
}

/** The copy to keep: COROS's id first, then more detail, then more summary fields, then the smaller id. */
export function keeper(copies: readonly Copy[]): Copy {
  const fields = (c: Copy) => Object.values(c.body).filter(filled).length;
  return [...copies].sort((a, b) =>
    Number(isCorosId(b.id)) - Number(isCorosId(a.id)) || detailScore(b.detail) - detailScore(a.detail) || fields(b) - fields(a) || a.id.localeCompare(b.id))[0];
}

/** `kept` with what only `other` has added; nothing of `kept` is replaced. */
export function fillIn(kept: Body, other: Body): Body {
  const out = { ...kept };
  for (const [k, v] of Object.entries(other)) if (!filled(out[k]) && filled(v)) out[k] = v;
  return out;
}

/** The detail from a watch FIT file, as the watch sync makes it; null when the file can't be read. */
export function detailFromFit(fit: Uint8Array, sport: string, thresholdHR?: number): Body | null {
  try {
    const recording = recordingFromFit(fit);
    return recording ? activityDetailBody(recording, sport as Sport, thresholdHR) : null;
  } catch {
    return null;
  }
}

/** The store as the rule reads it. */
export interface Items {
  get(collection: string, id: string): Body | undefined;
  list(collection: string): { id: string; body: Body }[];
}

/**
 * The changes that fold `drop` into `keep`: the kept activity and detail filled in, notes and corrections moved,
 * then the dropped copy's items deleted.
 */
export function mergeChanges(keep: Copy, drop: Copy, items: Items): Change[] {
  const out: Change[] = [];
  const body = fillIn(keep.body, { ...drop.body, id: keep.id });
  if (JSON.stringify(body) !== JSON.stringify(keep.body)) out.push({ collection: "activity", id: keep.id, body });
  if (drop.detail) {
    const detail = keep.detail ? fillIn(keep.detail, drop.detail) : drop.detail;
    if (JSON.stringify(detail) !== JSON.stringify(keep.detail)) out.push({ collection: "activity.detail", id: keep.id, body: detail });
    out.push({ collection: "activity.detail", id: drop.id, deleted: true });
  }
  // Coach's notes on the workout: `workout.<activity id>.<language>`.
  for (const note of items.list("ai.note")) {
    const m = /^workout\.(.+)\.([^.]+)$/.exec(note.id);
    if (!m || m[1] !== drop.id) continue;
    const id = `workout.${keep.id}.${m[2]}`;
    if (!items.get("ai.note", id)) out.push({ collection: "ai.note", id, body: { ...note.body, key: keep.id } });
    out.push({ collection: "ai.note", id: note.id, deleted: true });
  }
  const correction = items.get("strength.correction", drop.id);
  if (correction) {
    if (!items.get("strength.correction", keep.id)) out.push({ collection: "strength.correction", id: keep.id, body: correction });
    out.push({ collection: "strength.correction", id: drop.id, deleted: true });
  }
  out.push({ collection: "activity", id: drop.id, deleted: true });
  return out;
}

/** Groups of two or more copies of one workout among `activities`, each sorted by start. */
export function duplicateGroups(activities: readonly { id: string; body: Body }[]): { id: string; body: Body }[][] {
  const timed = activities.filter((a) => num(a.body.start) !== undefined).sort((a, b) => num(a.body.start)! - num(b.body.start)!);
  const groups: { id: string; body: Body }[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    if (used.has(timed[i].id)) continue;
    const group = [timed[i]];
    for (let j = i + 1; j < timed.length && num(timed[j].body.start)! - num(timed[i].body.start)! <= SAME_START_S; j++) {
      if (!used.has(timed[j].id) && sameWorkout(timed[i].body, timed[j].body)) group.push(timed[j]);
    }
    if (group.length > 1) { groups.push(group); group.forEach((a) => used.add(a.id)); }
  }
  return groups;
}

export interface RulesHost {
  /** Local mode's FIT files (watch/fit/<id>.fit). */
  fitFolder: string;
  /** Where merged ids are remembered. */
  ledger: string;
  log?: (line: string) => void;
}

/** The rule, run by the store (LocalStore.attachRules) and once at launch. */
export class ActivityRules {
  private aliases: Record<string, string>;
  private busy = false;

  constructor(private readonly store: LocalStore, private readonly host: RulesHost) {
    try { this.aliases = JSON.parse(readFileSync(host.ledger, "utf8")) as Record<string, string>; } catch { this.aliases = {}; }
  }

  private items(): Items {
    return { get: (c, id) => this.store.get(c, id), list: (c) => this.store.list(c) };
  }

  private remember(drop: string, keep: string): void {
    this.aliases[drop] = keep;
    for (const [from, to] of Object.entries(this.aliases)) if (to === drop) this.aliases[from] = keep;
    const temp = `${this.host.ledger}.tmp`;
    try { writeFileSync(temp, JSON.stringify(this.aliases)); renameSync(temp, this.host.ledger); } catch (e) { this.host.log?.(`Merged workouts weren't remembered (${e instanceof Error ? e.name : "error"})`); }
  }

  private fit(id: string): string | null {
    return FIT_ID.test(id) ? path.join(this.host.fitFolder, `${id}.fit`) : null;
  }

  /** The FIT file follows the kept copy, so it can be exported from it (the dropped one's stays for Local mode). */
  private carryFit(from: string, to: string): void {
    const source = this.fit(from), target = this.fit(to);
    if (source && target && existsSync(source) && !existsSync(target)) {
      try { copyFileSync(source, target); } catch { /* kept under its own id */ }
    }
  }

  private thresholdHR(): number | undefined {
    return num(this.store.get("view.training", "me")?.thresholdHr);
  }

  /**
   * Before C-LINK's own writes (the watch sync, the move): a workout already here under another id, or merged into
   * one, goes to that one instead of making a second.
   */
  prepare(changes: readonly Change[]): Change[] {
    const live = this.store.list("activity");
    const redirect = new Map<string, string>();
    const out: Change[] = [];
    const target = (id: string): string | undefined => {
      const to = redirect.get(id) ?? this.aliases[id];
      return to && to !== id && this.store.get("activity", to) ? to : undefined;
    };
    for (const c of changes) {
      if (c.collection !== "activity" || c.deleted || !c.body) continue;
      if (this.store.get("activity", c.id)) continue;
      // COROS's id is never folded into a watch copy: that pair is merged after the write, keeping COROS's id.
      const twin = target(c.id) ?? live.find((a) => a.id !== c.id && sameWorkout(a.body, c.body as Body) && (isCorosId(a.id) || !isCorosId(c.id)))?.id;
      if (twin) redirect.set(c.id, twin);
    }
    for (const c of changes) {
      const to = c.collection === "activity" || c.collection === "activity.detail" ? target(c.id) : undefined;
      if (!to || c.deleted || !c.body) { out.push(c); continue; }
      const had = this.store.get(c.collection, to);
      const body = had ? fillIn(had, { ...(c.body as Body), ...(c.collection === "activity" ? { id: to } : {}) }) : { ...(c.body as Body), ...(c.collection === "activity" ? { id: to } : {}) };
      if (!had || JSON.stringify(body) !== JSON.stringify(had)) out.push({ collection: c.collection, id: to, body });
      if (c.collection === "activity") { this.carryFit(c.id, to); if (!this.aliases[c.id]) this.remember(c.id, to); }
    }
    return out;
  }

  /** After any write (a phone's push too): merges the workouts touched that now have a twin, and gives a watch workout with a FIT file its detail. */
  afterWrite(touched: readonly { collection: string; id: string }[]): void {
    if (this.busy) return;
    const ids = new Set(touched.filter((t) => t.collection === "activity" || t.collection === "activity.detail").map((t) => t.id));
    if (!ids.size) return;
    this.run(ids);
  }

  /** Every workout, once at launch: merges every pair already here, and fills details from FIT files. Safe to repeat. */
  cleanup(): { merged: number; details: number } {
    return this.run(null);
  }

  private run(only: Set<string> | null): { merged: number; details: number } {
    this.busy = true;
    let merged = 0, details = 0;
    try {
      const items = this.items();
      const activities = this.store.list("activity");
      const groups = duplicateGroups(activities).filter((g) => !only || g.some((a) => only.has(a.id)));
      const changes: Change[] = [];
      for (const group of groups) {
        const copies: Copy[] = group.map((a) => ({ ...a, detail: items.get("activity.detail", a.id) }));
        let keep = keeper(copies);
        for (const drop of copies) {
          if (drop.id === keep.id) continue;
          const made = mergeChanges(keep, drop, items);
          changes.push(...made);
          const body = made.find((c) => c.collection === "activity" && c.id === keep.id)?.body as Body | undefined;
          const detail = made.find((c) => c.collection === "activity.detail" && c.id === keep.id)?.body as Body | undefined;
          keep = { ...keep, ...(body ? { body } : {}), ...(detail ? { detail } : {}) };
          this.carryFit(drop.id, keep.id);
          this.remember(drop.id, keep.id);
          merged++;
        }
      }
      if (changes.length) this.store.write(changes);
      // A detail for a copy merged away (a phone's, arriving after its activity) goes to the kept one.
      for (const id of only ?? []) {
        const to = this.aliases[id], detail = items.get("activity.detail", id);
        if (!to || !detail || items.get("activity", id) || !items.get("activity", to)) continue;
        const had = items.get("activity.detail", to);
        this.store.write([...(had ? [] : [{ collection: "activity.detail", id: to, body: detail }]), ...(had ? [{ collection: "activity.detail", id: to, body: fillIn(had, detail) }] : []), { collection: "activity.detail", id, deleted: true as const }]);
      }
      // Watch workouts with a FIT file and no detail (CorosLink's archive, or a FIT carried to a kept copy).
      const threshold = this.thresholdHR();
      const made: Change[] = [];
      for (const a of this.store.list("activity")) {
        if (only && !only.has(a.id) && !groups.some((g) => g.some((x) => x.id === a.id))) continue;
        if (items.get("activity.detail", a.id)) continue;
        const file = this.fit(a.id);
        if (!file || !existsSync(file)) continue;
        const detail = detailFromFit(readFileSync(file), String(a.body.sport ?? "other"), threshold);
        if (detail && Object.values(detail).some(filled)) { made.push({ collection: "activity.detail", id: a.id, body: detail }); details++; }
      }
      if (made.length) this.store.write(made);
    } catch (e) {
      this.host.log?.(`Merging workouts stopped (${e instanceof Error ? e.name : "error"})`);
    } finally {
      this.busy = false;
    }
    return { merged, details };
  }
}
