// The in-app router: the web app's routes (its src/app folders) on top of the History API.
import { createContext, use, useSyncExternalStore } from "react";

export type Href = string | { pathname?: string; query?: Record<string, string | number | undefined> };

export interface Location { pathname: string; search: string; key: number }

let current: Location = { pathname: location.pathname, search: location.search, key: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function sync(reload = false): void {
  const next = { pathname: location.pathname, search: location.search, key: current.key + (reload ? 1 : 0) };
  if (reload || next.pathname !== current.pathname || next.search !== current.search) {
    current = next;
    emit();
  }
}

addEventListener("popstate", () => sync());

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
  if (options.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  sync(options.reload);
  if (options.scroll !== false) scrollTo(0, 0);
}

export const back = (): void => history.back();

export function useLocation(): Location {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

export const ParamsContext = createContext<Record<string, string>>({});
export const useRouteParams = (): Record<string, string> => use(ParamsContext);

export { matchPattern, patternOf } from "./routePaths";
