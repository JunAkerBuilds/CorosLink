import { useEffect, useRef } from "react";

/**
 * Unsaved work, as the restart-to-update prompt names it. Editors register
 * while they are open; the prompt reads the list when an update is about to
 * install, so CorosLink never restarts over edits without asking.
 */
export interface UnsavedWork {
  /** What the prompt lists, already translated. */
  label: string;
  /**
   * Saves the work. Resolves true once it is saved and false when it could not
   * be (the editor shows why). Absent when the prompt cannot save it for the
   * user, for example a new workout that saving would schedule on the calendar.
   */
  save?: () => Promise<boolean>;
}

type UnsavedWorkSource = () => UnsavedWork | null;

export interface PendingUnsavedWork extends UnsavedWork {
  source: UnsavedWorkSource;
}

export type SaveUnsavedWorkResult =
  | { ok: true }
  | { ok: false; label: string; reason: "failed" | "manual" };

const sources = new Set<UnsavedWorkSource>();
let releasedForRestart = false;

export function registerUnsavedWork(source: UnsavedWorkSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** Newest first, so a dialog opened over an editor saves before the editor it feeds. */
export function listUnsavedWork(): PendingUnsavedWork[] {
  return [...sources].reverse().flatMap((source) => {
    const work = source();
    return work ? [{ ...work, source }] : [];
  });
}

/**
 * Registers the calling component's unsaved work while it is mounted. Pass
 * null when nothing is unsaved; the latest value is read at each check.
 */
export function useUnsavedWork(work: UnsavedWork | null): void {
  const latest = useRef(work);
  latest.current = work;
  useEffect(() => registerUnsavedWork(() => latest.current), []);
}

/** Lets React apply what the previous save changed before the list is read again. */
function settle(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 50));
}

/**
 * Saves every registered piece of work, one at a time, newest first. Stops at
 * the first one that cannot be saved. Saving one can leave another unsaved
 * (a workout edit applied to its plan), so the list is read again after each.
 */
export async function saveAllUnsavedWork(): Promise<SaveUnsavedWorkResult> {
  const tried = new Set<UnsavedWorkSource>();
  for (;;) {
    await settle();
    const pending = listUnsavedWork().filter((work) => !tried.has(work.source));
    if (pending.length === 0) return { ok: true };
    const next = pending.find((work) => work.save);
    if (!next?.save) return { ok: false, label: pending[0]!.label, reason: "manual" };
    tried.add(next.source);
    let saved = false;
    try {
      saved = await next.save();
    } catch {
      saved = false;
    }
    if (!saved) return { ok: false, label: next.label, reason: "failed" };
  }
}

/**
 * Set just before an update installs, so leave-page guards let the window
 * close; cleared again when the install does not go ahead.
 */
export function releaseUnsavedWorkForRestart(released: boolean): void {
  releasedForRestart = released;
}

export function unsavedWorkReleasedForRestart(): boolean {
  return releasedForRestart;
}
