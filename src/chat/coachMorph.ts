import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/** Set on <html> while a Coach morph runs; coach.css names the morphing regions under it. */
export const COACH_MORPH_CLASS = "is-coach-morph";

/**
 * Commit a Coach state change inside a View Transition so the regions named in
 * coach.css (composer, hero, creations panel, active conversation) morph from
 * their old boxes to their new ones instead of cutting. Without the API, under
 * reduced motion, in a hidden window, or while another morph is in flight the
 * update is applied directly. `prepare` commits synchronously before the old
 * state is captured, so the morph starts from the element the user acted on.
 */
export function morph(update: () => void, prepare?: () => void): void {
  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;
  if (
    typeof doc.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.visibilityState === "hidden" ||
    root.classList.contains(COACH_MORPH_CLASS)
  ) {
    prepare?.();
    update();
    return;
  }
  // Commit the pre-state (e.g. the row about to open) before the old snapshot is taken.
  if (prepare) {
    flushSync(prepare);
  }
  root.classList.add(COACH_MORPH_CLASS);
  let transition: { finished: Promise<void> };
  try {
    transition = doc.startViewTransition(() => {
      flushSync(update);
    });
  } catch {
    root.classList.remove(COACH_MORPH_CLASS);
    update();
    return;
  }
  void transition.finished
    .catch(() => undefined)
    .finally(() => root.classList.remove(COACH_MORPH_CLASS));
}
