/**
 * Framework-agnostic undo/redo state for the watch-face editor.
 *
 * Keep every user-visible value that should participate in undo/dirty tracking
 * in `T` (for example `{ design, projectName }`). Values are expected to be
 * immutable snapshots.
 */

export const WATCHFACE_EDITOR_HISTORY_LIMIT = 50;

export interface WatchfaceEditorHistoryEntry<T> {
  value: T;
  /** A unique identity for this committed state. */
  revision: number;
}

export interface WatchfaceEditorHistory<T> {
  past: WatchfaceEditorHistoryEntry<T>[];
  present: WatchfaceEditorHistoryEntry<T>;
  future: WatchfaceEditorHistoryEntry<T>[];
  /** Maximum number of undoable entries retained in `past`. */
  limit: number;
  /** Revision reserved for the next distinct state. */
  nextRevision: number;
  /**
   * The committed state at the start of a drag/slider gesture. While this is
   * set, repeated updates replace `present` instead of growing `past`.
   */
  transactionBase: WatchfaceEditorHistoryEntry<T> | null;
}

export interface WatchfaceEditorHistoryOptions {
  limit?: number;
}

export interface WatchfaceEditorCheckpoint {
  sessionId: string;
  revision: number;
}

export type WatchfaceEditorHistoryEquality<T> = (left: T, right: T) => boolean;

const sameValue = <T>(left: T, right: T): boolean => Object.is(left, right);

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return WATCHFACE_EDITOR_HISTORY_LIMIT;
  }
  if (!Number.isFinite(limit)) {
    return WATCHFACE_EDITOR_HISTORY_LIMIT;
  }
  return Math.max(1, Math.floor(limit));
}

function appendPast<T>(
  past: WatchfaceEditorHistoryEntry<T>[],
  entry: WatchfaceEditorHistoryEntry<T>,
  limit: number
): WatchfaceEditorHistoryEntry<T>[] {
  const next = [...past, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function createWatchfaceEditorHistory<T>(
  initialValue: T,
  options: WatchfaceEditorHistoryOptions = {}
): WatchfaceEditorHistory<T> {
  return {
    past: [],
    present: { value: initialValue, revision: 0 },
    future: [],
    limit: normalizedLimit(options.limit),
    nextRevision: 1,
    transactionBase: null
  };
}

/** Reset all undo state when a different project/template/archive is opened. */
export function resetWatchfaceEditorHistory<T>(
  value: T,
  previous?: Pick<WatchfaceEditorHistory<T>, "limit">
): WatchfaceEditorHistory<T> {
  return createWatchfaceEditorHistory(value, { limit: previous?.limit });
}

/** Record one immediately committed edit and clear the redo branch. */
export function recordWatchfaceEditorHistory<T>(
  history: WatchfaceEditorHistory<T>,
  value: T,
  isEqual: WatchfaceEditorHistoryEquality<T> = sameValue
): WatchfaceEditorHistory<T> {
  const committed = commitWatchfaceEditorHistoryTransaction(history, isEqual);
  if (isEqual(committed.present.value, value)) {
    return committed;
  }
  return {
    ...committed,
    past: appendPast(committed.past, committed.present, committed.limit),
    present: { value, revision: committed.nextRevision },
    future: [],
    nextRevision: committed.nextRevision + 1
  };
}

/** Start a gesture that should become a single undo entry. */
export function beginWatchfaceEditorHistoryTransaction<T>(
  history: WatchfaceEditorHistory<T>
): WatchfaceEditorHistory<T> {
  if (history.transactionBase) {
    return history;
  }
  return { ...history, transactionBase: history.present };
}

/**
 * Replace the in-progress gesture value. The reserved revision makes dirty
 * checks accurate even before the pointer/slider gesture is committed.
 */
export function updateWatchfaceEditorHistoryTransaction<T>(
  history: WatchfaceEditorHistory<T>,
  value: T
): WatchfaceEditorHistory<T> {
  const started = beginWatchfaceEditorHistoryTransaction(history);
  return {
    ...started,
    present: { value, revision: started.nextRevision }
  };
}

/** Commit all gesture updates as one undo entry. */
export function commitWatchfaceEditorHistoryTransaction<T>(
  history: WatchfaceEditorHistory<T>,
  isEqual: WatchfaceEditorHistoryEquality<T> = sameValue
): WatchfaceEditorHistory<T> {
  const base = history.transactionBase;
  if (!base) {
    return history;
  }
  if (isEqual(base.value, history.present.value)) {
    return { ...history, present: base, transactionBase: null };
  }
  return {
    ...history,
    past: appendPast(history.past, base, history.limit),
    future: [],
    nextRevision: history.nextRevision + 1,
    transactionBase: null
  };
}

/** Discard an unfinished gesture without affecting undo/redo. */
export function cancelWatchfaceEditorHistoryTransaction<T>(
  history: WatchfaceEditorHistory<T>
): WatchfaceEditorHistory<T> {
  if (!history.transactionBase) {
    return history;
  }
  return {
    ...history,
    present: history.transactionBase,
    transactionBase: null
  };
}

export function undoWatchfaceEditorHistory<T>(
  history: WatchfaceEditorHistory<T>,
  isEqual: WatchfaceEditorHistoryEquality<T> = sameValue
): WatchfaceEditorHistory<T> {
  const committed = commitWatchfaceEditorHistoryTransaction(history, isEqual);
  const previous = committed.past.at(-1);
  if (!previous) {
    return committed;
  }
  return {
    ...committed,
    past: committed.past.slice(0, -1),
    present: previous,
    future: [committed.present, ...committed.future]
  };
}

export function redoWatchfaceEditorHistory<T>(
  history: WatchfaceEditorHistory<T>,
  isEqual: WatchfaceEditorHistoryEquality<T> = sameValue
): WatchfaceEditorHistory<T> {
  const committed = commitWatchfaceEditorHistoryTransaction(history, isEqual);
  const [next, ...remaining] = committed.future;
  if (!next) {
    return committed;
  }
  return {
    ...committed,
    past: appendPast(committed.past, committed.present, committed.limit),
    present: next,
    future: remaining
  };
}

export function canUndoWatchfaceEditorHistory<T>(
  history: WatchfaceEditorHistory<T>
): boolean {
  return (
    history.past.length > 0 ||
    (history.transactionBase !== null &&
      history.transactionBase.revision !== history.present.revision)
  );
}

export function canRedoWatchfaceEditorHistory<T>(
  history: WatchfaceEditorHistory<T>
): boolean {
  return history.transactionBase === null && history.future.length > 0;
}

let sessionCounter = 0;

/**
 * Creates a mount-local identity for an opened source. Passing `nonce` makes
 * deterministic tests possible; normal callers should omit it.
 */
export function createWatchfaceEditorSessionId(
  sourceKey: string,
  nonce?: string | number
): string {
  const safeSource = sourceKey.trim() || "watchface";
  const uniquePart = nonce ?? `${Date.now().toString(36)}-${++sessionCounter}`;
  return `${safeSource}:${String(uniquePart)}`;
}

/** Capture the exact state that was loaded or most recently saved. */
export function createWatchfaceEditorCheckpoint<T>(
  history: WatchfaceEditorHistory<T>,
  sessionId: string,
  options: { dirty?: boolean } = {}
): WatchfaceEditorCheckpoint {
  return {
    sessionId,
    // History revisions start at zero, so -1 cannot collide with a real
    // loaded/edited state. Saving replaces this forced-dirty checkpoint with
    // the current revision through the normal two-argument call.
    revision: options.dirty ? -1 : history.present.revision
  };
}

/**
 * A source change is always dirty relative to an old checkpoint. Within one
 * source, undoing back to the saved revision clears the dirty state.
 */
export function isWatchfaceEditorHistoryDirty<T>(
  history: WatchfaceEditorHistory<T>,
  checkpoint: WatchfaceEditorCheckpoint,
  sessionId: string
): boolean {
  return (
    checkpoint.sessionId !== sessionId ||
    checkpoint.revision !== history.present.revision
  );
}
