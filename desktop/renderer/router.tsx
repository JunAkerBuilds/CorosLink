// The in-app router: the web app's routes (its src/app folders) on top of the History API.
import { createContext, use, useSyncExternalStore } from "react";

export type Href = string | { pathname?: string; query?: Record<string, string | number | undefined> };

export interface Location { pathname: string; search: string; key: number }

let current: Location = { pathname: location.pathname, search: location.search, key: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Where this window is in its history, for the back and forward arrows (parts/HistoryArrows.tsx). Each entry keeps
// its place in history.state; `last` is the newest entry, the one going forward ends at. A page loaded fresh (the
// menu's Settings… loads one) is the newest entry, so its place is the history's length; a reload keeps both.
const LAST = "router.last";
const placeOf = (state: unknown): number | null => {
  const at = (state as { at?: unknown } | null)?.at;
  return typeof at === "number" ? at : null;
};
let at = placeOf(history.state) ?? history.length - 1;
let last = placeOf(history.state) == null ? at : Math.max(at, Number(sessionStorage.getItem(LAST)) || 0);
const keepLast = () => { try { sessionStorage.setItem(LAST, String(last)); } catch { /* private storage off: the arrows forget on reload */ } };
if (placeOf(history.state) == null) history.replaceState({ ...(history.state ?? {}), at }, "");
keepLast();
let place: { back: boolean; forward: boolean } = { back: at > 0, forward: at < last };
const placeListeners = new Set<() => void>();
function moved(): void {
  const next = { back: at > 0, forward: at < last };
  if (next.back !== place.back || next.forward !== place.forward) {
    place = next;
    placeListeners.forEach((l) => l());
  }
}

function sync(reload = false): void {
  const next = { pathname: location.pathname, search: location.search, key: current.key + (reload ? 1 : 0) };
  if (reload || next.pathname !== current.pathname || next.search !== current.search) {
    current = next;
    emit();
  }
}

addEventListener("popstate", (e) => {
  const was = placeOf(e.state);
  if (was != null) at = was;
  moved();
  sync();
});

export function hrefText(href: Href): string {
  if (typeof href === "string") return href;
  const query = Object.entries(href.query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]);
  const search = query.length ? `?${new URLSearchParams(query)}` : "";
  return `${href.pathname ?? location.pathname}${search}`;
}

/** Moves to `href` inside the app. Anything outside it (other origins, /api) is loaded for real. */
export function navigate(href: string, options: { replace?: boolean; scroll?: boolean; reload?: boolean } = {}): void {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    location.assign(url.href);
    return;
  }
  const target = url.pathname + url.search + url.hash;
  if (options.replace) history.replaceState({ at }, "", target);
  else {
    at += 1;
    last = at;
    keepLast();
    history.pushState({ at }, "", target);
    moved();
  }
  sync(options.reload);
  if (options.scroll !== false) scrollTo(0, 0);
}

export const back = (): void => history.back();
export const forward = (): void => history.forward();

/** Whether there is a page to go back or forward to in this window. */
export function useHistoryPlace(): { back: boolean; forward: boolean } {
  return useSyncExternalStore((l) => { placeListeners.add(l); return () => placeListeners.delete(l); }, () => place);
}

export function useLocation(): Location {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

export const ParamsContext = createContext<Record<string, string>>({});
export const useRouteParams = (): Record<string, string> => use(ParamsContext);

export { matchPattern, patternOf } from "./routePaths";
