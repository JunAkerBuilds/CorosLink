/**
 * IPC hands back a fresh object on every call. Polled state keeps its current
 * value when the payload is unchanged, otherwise the view and everything under
 * it re-render for nothing.
 */
export function sameJson(current: unknown, next: unknown): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}
