import { useLayoutEffect, useMemo, useRef } from "react";

type Handler = (...args: never[]) => unknown;

/**
 * Wraps event handlers in functions that keep their identity across renders
 * and always call the latest version, so a memoized child stays put when its
 * parent re-renders. The key set must not change between renders, and the
 * wrappers are for events and effects, not for calling during render.
 */
export function useStableHandlers<T extends Record<string, Handler>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  return useMemo(
    () =>
      Object.fromEntries(
        Object.keys(handlers).map((key) => [
          key,
          (...args: never[]) => latest.current[key](...args),
        ]),
      ) as T,
    // The key set is fixed for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
