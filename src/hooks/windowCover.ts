import { useEffect } from "react";

// Full-window overlays (the welcome tour) cover everything behind a
// backdrop blur. Continuous renderers underneath, like the Overview globe,
// pause while one is open: each frame they draw forces the blur to be
// recomposited across the whole window.
let openCovers = 0;
const listeners = new Set<() => void>();

export function isWindowCovered(): boolean {
  return openCovers > 0;
}

export function subscribeWindowCover(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks the window as covered while the calling component is mounted. */
export function useCoversWindow(): void {
  useEffect(() => {
    openCovers += 1;
    listeners.forEach((listener) => listener());
    return () => {
      openCovers -= 1;
      listeners.forEach((listener) => listener());
    };
  }, []);
}
