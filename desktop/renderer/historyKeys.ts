// The back and forward shortcuts, as in a browser: ⌘[ ⌘] on a Mac, Alt+← Alt+→ elsewhere (parts/HistoryArrows.tsx).
// Pure, so it can be tested without a window.

type Go = "back" | "forward";
const MAC_KEYS: Record<string, Go> = { "[": "back", "]": "forward" };
const OTHER_KEYS: Record<string, Go> = { ArrowLeft: "back", ArrowRight: "forward" };

/** Whether a key press is the back or forward shortcut. */
export function historyKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): Go | null {
  if (e.shiftKey || e.ctrlKey) return null;
  if (mac) return e.metaKey && !e.altKey ? MAC_KEYS[e.key] ?? null : null;
  return e.altKey && !e.metaKey ? OTHER_KEYS[e.key] ?? null : null;
}
