"use client";
// Look-and-feel choices kept in this browser: which sidebar items show, and the colour of each sport.
import { createStore } from "@/data/local/store";
import { msg } from "@/lib/i18n";

/** Sidebar items the person hid (their hrefs). Dashboard and Watch always show. */
export const hiddenNavStore = createStore<string[]>("shell.hidden", []);
export const ALWAYS_SHOWN: readonly string[] = ["/", "/watch"];

/** The sports that have a colour, the CSS variable that carries it, and the theme colour it starts as. */
export const SPORT_COLORS = [
  { id: "run", label: msg("Running"), token: "--sport-run", base: "--h-mint" },
  { id: "ride", label: msg("Cycling"), token: "--sport-ride", base: "--h-blue" },
  { id: "swim", label: msg("Swimming"), token: "--sport-swim", base: "--h-cyan" },
  { id: "strength", label: msg("Strength"), token: "--sport-strength", base: "--h-orange" },
  { id: "other", label: msg("Other"), token: "--sport-other", base: "--h-violet" },
] as const;
export type SportColorId = (typeof SPORT_COLORS)[number]["id"];

/** Colours the person picked (#rrggbb); a sport left out keeps the theme's colour for light and dark. */
export const sportColorsStore = createStore<Partial<Record<SportColorId, string>>>("sport.colors", {});

export const isHex = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v);

/** Sets the picked colours on the page (or takes them off, back to the theme's). */
export function applySportColors(picked: Partial<Record<SportColorId, string>>): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  for (const s of SPORT_COLORS) {
    const hex = picked[s.id];
    if (hex && isHex(hex)) style.setProperty(s.token, hex);
    else style.removeProperty(s.token);
  }
}
