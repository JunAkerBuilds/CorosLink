import { runViewMorph } from "../viewMorph";

/** Set on <html> while a Coach morph runs; coach.css names the morphing regions under it. */
export const COACH_MORPH_CLASS = "is-coach-morph";

/**
 * Commit a Coach state change inside a View Transition so the regions named in
 * coach.css (composer, hero, creations panel, active conversation) morph from
 * their old boxes to their new ones instead of cutting. `prepare` commits
 * synchronously before the old state is captured, so the morph starts from the
 * element the user acted on. See runViewMorph for when it cuts instead.
 */
export function morph(update: () => void, prepare?: () => void): void {
  runViewMorph(COACH_MORPH_CLASS, update, { prepare });
}
