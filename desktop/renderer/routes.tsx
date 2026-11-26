// Every screen of the web app, found from its src/app folders. Pages load when first opened; layouts (titles and
// screen CSS) load with the app.
import { lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { Metadata } from "next";
import { msg, t } from "@/lib/i18n";
import { matchPattern, patternOf } from "./routePaths";

type Page = LazyExoticComponent<ComponentType>;
interface LayoutModule { default: (props: { children: ReactNode }) => ReactNode; metadata?: Metadata }

// Paths are relative to this file (Vite's root is desktop/renderer).
const APP = "../../src/app";
const pages = import.meta.glob<{ default: ComponentType }>("../../src/app/**/page.tsx");
const layouts = import.meta.glob<LayoutModule>("../../src/app/**/layout.tsx", { eager: true });

/** `name` is the screen's English name ("Settings"), translated where it's shown (`pageTitle`); null is the app's own. */
export interface Route { pattern: string; page: Page; layouts: LayoutModule[]; name: string | null }

const nameOf = (chain: LayoutModule[]): string | null => {
  for (let i = chain.length - 1; i >= 0; i--) {
    const title = chain[i].metadata?.title;
    if (typeof title === "string") return title;
    if (title?.absolute) return title.absolute.replace(/ · C-LINK$/, "");
  }
  return null;
};

/** The window title for a screen, in the app's language. */
export const pageTitle = (route: Route): string => (route.name ? `${t(route.name)} · C-LINK` : "C-LINK");

/** The layouts around a page folder, outermost first. */
const chainFor = (dir: string): LayoutModule[] => Object.entries(layouts)
  .filter(([f]) => dir.startsWith(f.slice(0, -"/layout.tsx".length)))
  .sort(([a], [b]) => a.length - b.length)
  .map(([, m]) => m);

/** The desktop's own screens, inside the app's shell like the web's. */
const DESKTOP: Route[] = [
  { pattern: "/developer", page: lazy(() => import("./pages/Developer")), layouts: chainFor(`${APP}/(app)/developer`), name: msg("Developer") },
  { pattern: "/settings", page: lazy(() => import("./pages/Settings")), layouts: chainFor(`${APP}/(app)/settings`), name: msg("Settings") },
  { pattern: "/settings/[section]", page: lazy(() => import("./pages/Settings")), layouts: chainFor(`${APP}/(app)/settings`), name: msg("Settings") },
  { pattern: "/media", page: lazy(() => import("./pages/Media")), layouts: chainFor(`${APP}/(app)/media`), name: msg("Media") },
  { pattern: "/maps", page: lazy(() => import("./pages/Maps")), layouts: chainFor(`${APP}/(app)/maps`), name: msg("Maps") },
  { pattern: "/maps/[tab]", page: lazy(() => import("./pages/Maps")), layouts: chainFor(`${APP}/(app)/maps`), name: msg("Maps") },
  { pattern: "/studio", page: lazy(() => import("./pages/Studio")), layouts: chainFor(`${APP}/(app)/studio`), name: msg("Studio") },
  { pattern: "/studio/[id]", page: lazy(() => import("./pages/StudioEditor")), layouts: chainFor(`${APP}/(app)/studio`), name: msg("Studio") },
  { pattern: "/coach/settings", page: lazy(() => import("./pages/CoachSettings")), layouts: chainFor(`${APP}/(app)/coach/settings`), name: msg("Coach settings") },
];

export const ROUTES: Route[] = [...DESKTOP, ...Object.entries(pages).map(([file, load]) => {
  const chain = chainFor(file.slice(0, -"/page.tsx".length));
  return { pattern: patternOf(file, APP), page: lazy(load), layouts: chain, name: nameOf(chain) };
})].sort((a, b) => Number(a.pattern.includes("[")) - Number(b.pattern.includes("[")));

export function findRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, pathname);
    if (params) return { route, params };
  }
  return null;
}
