"use client";
// What the side Coach (CoachDock) knows about the page on screen. A page that has more to say than its visible text
// registers it with usePageCoach: a name, what it holds in words, what Coach noticed, and, when the page can be
// changed from words (the plan editor), a `change` that does it. Pages that register nothing are read from their
// visible text when a question is sent.
import { useEffect, useSyncExternalStore } from "react";
import type { OpenPlanEditor } from "@/data/coach";

export interface PageFinding {
  text: string;
  tone: "error" | "warning";
  /** The words sent to `change` when the athlete taps "Fix it"; none: no button. */
  fix?: string;
}

export interface PageChange {
  /** The switch's label, e.g. "Change plan". */
  label: string;
  /** One-tap asks shown above the box in change mode. */
  asks: readonly string[];
  /** Does the change; resolves to what changed, in words. Throws with a message the athlete can read. */
  run: (ask: string, options: { signal: AbortSignal; onStage: (stage: string) => void }) => Promise<{ title: string; sub: string }>;
  /** Puts the last change back. */
  undo: () => void;
}

export interface PageCoach {
  /** The page's name, e.g. "Plan editor". */
  title: string;
  /** One line under Coach's name: what Coach is looking at. */
  looking?: string;
  /** What the page holds, in words, sent with each question. */
  about?: string;
  findings?: readonly PageFinding[];
  change?: PageChange;
  /** Questions worth asking here. */
  asks?: readonly string[];
  /** The plan open on this page: Coach reads it as it stands, and its plan cards apply to it through the editor. */
  plan?: OpenPlanEditor;
}

let current: PageCoach | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The page's registration, for CoachDock. */
export function usePageCoachState(): PageCoach | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => null);
}

/** Tells the side Coach about this page while it is shown. Pass a memoised object: a new one re-registers. */
export function usePageCoach(spec: PageCoach | null): void {
  useEffect(() => {
    if (!spec) return;
    current = spec;
    emit();
    return () => { if (current === spec) { current = null; emit(); } };
  }, [spec]);
}
