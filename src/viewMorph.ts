import { flushSync } from "react-dom";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

let running = false;

/**
 * Commit a React state change inside a View Transition so the regions a
 * stylesheet names under `className` (set on <html> while the morph runs) move
 * from their old boxes to their new ones instead of cutting. Without the API,
 * under reduced motion, in a hidden window, or while another morph is in
 * flight the update is applied directly. `prepare` commits synchronously
 * before the old state is captured, so the morph starts from the element the
 * user acted on; `after` runs once the new state is in the DOM, before it is
 * captured (for example to set a scroll position).
 */
export function runViewMorph(
  className: string,
  update: () => void,
  { prepare, after }: { prepare?: () => void; after?: () => void } = {}
): void {
  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;
  // Without a morph, `after` still needs the new state committed first.
  const commit = () => {
    if (after) {
      flushSync(update);
      after();
    } else {
      update();
    }
  };
  if (
    typeof doc.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.visibilityState === "hidden" ||
    running
  ) {
    prepare?.();
    commit();
    return;
  }
  // Commit the pre-state (e.g. the row about to open) before the old snapshot is taken.
  if (prepare) {
    flushSync(prepare);
  }
  running = true;
  root.classList.add(className);
  let transition: { finished: Promise<void> };
  try {
    transition = doc.startViewTransition(() => {
      flushSync(update);
      after?.();
    });
  } catch {
    running = false;
    root.classList.remove(className);
    commit();
    return;
  }
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      running = false;
      root.classList.remove(className);
    });
}
