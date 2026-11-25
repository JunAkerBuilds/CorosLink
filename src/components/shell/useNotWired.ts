"use client";
import { useCallback, useState } from "react";

/**
 * Runs data-layer calls and keeps what a failed one said, by place on the page: the server's refusal (blocked,
 * rate-limited, locked), a lost connection, or NotWiredError for something with no server behind it.
 * `run("post", () => createPost(draft))` shows `notes.post` once the call throws. `onSettled` runs either way.
 */
export function useNotWired() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const run = useCallback((key: string, action: () => Promise<unknown>, onDone?: () => void, onSettled?: () => void) => {
    action().then(
      () => {
        setNotes((n) => { const next = { ...n }; delete next[key]; return next; });
        onDone?.();
      },
      (e: unknown) => {
        const text = e instanceof Error ? e.message : String(e);
        setNotes((n) => ({ ...n, [key]: text }));
      },
    ).finally(() => onSettled?.());
  }, []);
  const clear = useCallback((key: string) => {
    setNotes((n) => { if (!(key in n)) return n; const next = { ...n }; delete next[key]; return next; });
  }, []);
  return { notes, run, clear };
}
