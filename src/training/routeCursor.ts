/**
 * Hover point and selected stretch that a chart shares with the route map.
 * A tiny external store instead of React state, so moving the cursor across
 * the chart updates the Leaflet layers without re-rendering the detail panel.
 */
export interface RouteCursorState {
  point: [number, number] | null;
  segment: [number, number][] | null;
}

export interface RouteCursor {
  get: () => RouteCursorState;
  set: (next: Partial<RouteCursorState>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createRouteCursor(): RouteCursor {
  let state: RouteCursorState = { point: null, segment: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
