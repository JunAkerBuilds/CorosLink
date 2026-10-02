import { type ComponentProps, useCallback, useLayoutEffect, useRef, useState } from "react";

const COLOR_SETTLE_MS = 140;
const pendingInputs = new Map<() => void, HTMLInputElement>();

/** Flush before reading/saving the scene or switching its editing target. */
export function flushWatchfaceColorInputs() {
  for (const commit of [...pendingInputs.keys()]) commit();
}

function finishBeforeAction(event: Event) {
  if (event instanceof KeyboardEvent &&
      !event.metaKey && !event.ctrlKey && !["Enter", "Escape", "Tab"].includes(event.key)) return;
  for (const [commit, input] of [...pendingInputs]) {
    if (event instanceof KeyboardEvent || event.target !== input) commit();
  }
}

function observeActions() {
  for (const event of ["pointerdown", "click", "focusin", "keydown"]) {
    document.addEventListener(event, finishBeforeAction, true);
  }
}

function forgetPending(commit: () => void) {
  pendingInputs.delete(commit);
  if (!pendingInputs.size) {
    for (const event of ["pointerdown", "click", "focusin", "keydown"]) {
      document.removeEventListener(event, finishBeforeAction, true);
    }
  }
}

/** Keep native-picker dragging local; regenerate the face only after settling. */
export function WatchfaceColorInput({
  value, onValueChange, onPreview, onBlur, ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "onInput" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
  onPreview?: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onValueChange, onPreview });
  callbacks.current = { onValueChange, onPreview };

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const commit = useCallback(() => {
    cancelTimer();
    forgetPending(commit);
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next !== null && next.toLowerCase() !== valueRef.current.toLowerCase()) {
      callbacks.current.onValueChange(next);
    }
  }, [cancelTimer]);

  const cancel = useCallback(() => {
    cancelTimer();
    forgetPending(commit);
    pendingRef.current = null;
  }, [cancelTimer, commit]);

  // Undo/redo and external edits replace drafts, including their queued timers.
  useLayoutEffect(() => {
    if (value !== valueRef.current) {
      cancel();
      valueRef.current = value;
      setDraft(value);
    }
  }, [value, cancel]);

  const receive = (next: string, finished: boolean) => {
    setDraft(next);
    callbacks.current.onPreview?.(next);
    cancelTimer();
    if (next.toLowerCase() === valueRef.current.toLowerCase()) {
      cancel();
      return;
    }
    pendingRef.current = next;
    if (!pendingInputs.size) observeActions();
    pendingInputs.set(commit, inputRef.current!);
    if (finished) commit();
    else timerRef.current = setTimeout(commit, COLOR_SETTLE_MS);
  };
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  useLayoutEffect(() => {
    const input = inputRef.current!;
    // React can suppress change after an input event with the same value.
    // Listen directly so closing the native picker always flushes its final color.
    const finish = () => receiveRef.current(input.value, true);
    input.addEventListener("change", finish);
    return () => {
      input.removeEventListener("change", finish);
      cancel();
    };
  }, [cancel]);

  return <input {...props} ref={inputRef} type="color" value={draft}
    onChange={event => {
      if (event.nativeEvent.type === "input") receive(event.currentTarget.value, false);
    }}
    onBlur={event => { commit(); onBlur?.(event); }}
  />;
}
