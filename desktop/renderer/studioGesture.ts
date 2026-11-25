// One continuous gesture (a number field being scrubbed) makes many edits; the editor folds them into one undo step.
// The field opens a gesture when the drag starts and closes it when the pointer lets go.

let next = 0;
let open: number | null = null;

/** Starts a gesture: edits from now until `endGesture` are one undo step. */
export function beginGesture() { open = ++next; }
export function endGesture() { open = null; }
/** The gesture under way, or null. */
export const currentGesture = () => open;
