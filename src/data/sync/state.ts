// The browser's copy of the person's synced items and the rules for changing it (docs/sync-contract.md
// section 3). Pure: the engine in ./engine.ts adds the network, the timers and IndexedDB around it.
import { canonical } from "./canonical";

export interface StoredItem { collection: string; id: string; version: number; body: unknown }

/**
 * An edit made here that the server has not confirmed yet. `body` absent means a delete. `base` is the version
 * the server said the item had when it refused the edit as out of date.
 */
export interface Unsent { collection: string; id: string; body?: unknown; deleted?: true; at: number; base?: number }

export interface SyncState {
  /** The highest version pulled. */
  cursor: number;
  /** Live items as the server has them, by `collection/id`. */
  items: Record<string, StoredItem>;
  /** Edits waiting to be sent, by `collection/id`. They are laid over `items` when reading. */
  unsent: Record<string, Unsent>;
}

export interface ServerItem { collection: string; id: string; version: number; deleted?: boolean; body?: unknown }
/**
 * `hub`: this pull changed the shared Training Hub sign-in (the server kept the session itself).
 * `connections`: it changed these shared connections (Hevy, intervals.icu), whose keys the server kept too.
 */
export interface PullPage { items: ServerItem[]; cursor: number; more: boolean; hub?: "session" | "signedOut"; connections?: string[] }
/** `conflict`: the item had changed on the server since this browser read it, so the edit was not written. */
export interface PushResult { collection: string; id: string; version: number; changed?: boolean; conflict?: boolean }

export const emptyState = (): SyncState => ({ cursor: 0, items: {}, unsent: {} });
export const keyOf = (collection: string, id: string): string => `${collection}/${id}`;

const isBag = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown): boolean => canonical(a ?? null) === canonical(b ?? null);

/**
 * Two edits of one item brought together, field by field (docs/sync-contract.md section 3): a field only one
 * side changed since `base` keeps that side's value; a field both changed keeps `mine`, unless both hold
 * objects, which are merged the same way. Lists are one value. Without a `base` every differing field is `mine`.
 */
export function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (!isBag(mine) || !isBag(theirs)) return mine;
  const from = isBag(base) ? base : {};
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const m = mine[key], t = theirs[key], b = from[key];
    const value = same(m, b) ? t : same(t, b) ? m : isBag(m) && isBag(t) ? merge3(b, m, t) : m;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * One pulled page applied. Nothing typed here is dropped for a change made elsewhere:
 * - an unsent edit and a remote change to the same item are merged field by field (`merge3`), and what still
 *   differs from the server stays unsent;
 * - an edit wins over a deletion, whichever side made which: an item edited here and deleted elsewhere is
 *   sent again, and an item deleted here and edited elsewhere stays.
 * Returns the new state and whether anything a screen reads changed.
 */
export function applyPull(state: SyncState, page: PullPage): { state: SyncState; changed: boolean } {
  const items = { ...state.items }, unsent = { ...state.unsent };
  let changed = false;
  for (const item of page.items) {
    const key = keyOf(item.collection, item.id), had = items[key], edit = unsent[key];
    if (item.deleted) {
      if (had) { delete items[key]; changed = true; }
      // Deleted on both sides: done. Edited here: the edit stands and is sent again.
      if (edit?.deleted) { delete unsent[key]; changed = true; }
      continue;
    }
    const moved = !had || !same(had.body, item.body);
    items[key] = { collection: item.collection, id: item.id, version: item.version, body: item.body };
    if (moved) changed = true;
    if (!edit) continue;
    if (edit.deleted) {
      // Edited elsewhere since: the item stays.
      if (moved) delete unsent[key];
      continue;
    }
    if (same(edit.body, item.body)) { delete unsent[key]; continue; }
    if (!moved) continue;
    const merged = merge3(had?.body, edit.body, item.body);
    if (same(merged, item.body)) delete unsent[key];
    else unsent[key] = { collection: edit.collection, id: edit.id, body: merged, at: edit.at + 1e-6 };
  }
  return { state: { cursor: Math.max(state.cursor, page.cursor), items, unsent }, changed };
}

/** An edit made here, kept until the server takes it. */
export function applyEdit(state: SyncState, edit: Unsent): SyncState {
  const key = keyOf(edit.collection, edit.id), had = state.items[key];
  const unsent = { ...state.unsent };
  // Nothing to send when the edit puts back exactly what the server has, or deletes what it never had.
  if ((edit.deleted && !had) || (!edit.deleted && had && canonical(had.body) === canonical(edit.body))) delete unsent[key];
  else unsent[key] = edit;
  return { ...state, unsent };
}

/** The version an edit is sent against: what the server last told this browser the item had. */
export function baseOf(state: SyncState, edit: Unsent): number {
  return Math.max(state.items[keyOf(edit.collection, edit.id)]?.version ?? 0, edit.base ?? 0);
}

/**
 * The server's answer to a push. An edit that was changed again while the request was in flight stays unsent,
 * and so does one the server refused as out of date (`conflict`): the next pull brings the newer item, the two
 * are merged, and it is sent again. Versions above the cursor do not move it: the next pull re-reads those
 * items and finds them identical.
 */
export function applyPushed(state: SyncState, sent: Unsent[], results: PushResult[]): SyncState {
  const items = { ...state.items }, unsent = { ...state.unsent };
  const answers = new Map(results.map((r) => [keyOf(r.collection, r.id), r]));
  for (const edit of sent) {
    const key = keyOf(edit.collection, edit.id), answer = answers.get(key);
    if (!answer) continue;
    const version = answer.version;
    if (answer.conflict) {
      if (unsent[key]) unsent[key] = { ...unsent[key], base: Math.max(unsent[key].base ?? 0, version) };
      continue;
    }
    if (edit.deleted) delete items[key];
    else items[key] = { collection: edit.collection, id: edit.id, version, body: edit.body };
    if (unsent[key] && unsent[key].at === edit.at) delete unsent[key];
  }
  return { ...state, items, unsent };
}

/** What a screen sees: the server's items with the unsent edits laid over them. */
export function visible(state: SyncState, collection: string): StoredItem[] {
  const out: StoredItem[] = [];
  const prefix = `${collection}/`;
  for (const key in state.items) {
    if (!key.startsWith(prefix) || state.items[key].collection !== collection) continue;
    const edit = state.unsent[key];
    if (edit?.deleted) continue;
    out.push(edit ? { ...state.items[key], body: edit.body } : state.items[key]);
  }
  for (const key in state.unsent) {
    const edit = state.unsent[key];
    if (edit.collection === collection && !edit.deleted && !state.items[key]) out.push({ collection, id: edit.id, version: 0, body: edit.body });
  }
  return out;
}

export function visibleOne(state: SyncState, collection: string, id: string): StoredItem | undefined {
  const key = keyOf(collection, id), edit = state.unsent[key], had = state.items[key];
  if (edit) return edit.deleted ? undefined : { collection, id, version: had?.version ?? 0, body: edit.body };
  return had;
}

/** Unsent edits cut into requests the server takes: at most 200 changes and about 900 KB each. */
export function batches(unsent: Unsent[], maxChanges = 200, maxBytes = 900_000): Unsent[][] {
  const out: Unsent[][] = [];
  let batch: Unsent[] = [], bytes = 0;
  for (const edit of unsent) {
    const size = JSON.stringify(edit.body ?? null).length + 200;
    if (batch.length && (batch.length >= maxChanges || bytes + size > maxBytes)) { out.push(batch); batch = []; bytes = 0; }
    batch.push(edit);
    bytes += size;
  }
  if (batch.length) out.push(batch);
  return out;
}
