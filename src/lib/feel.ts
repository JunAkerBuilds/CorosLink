/**
 * The phone app's colour rules for the morning rings, and its feel check (CorosKit `FeelCheck`,
 * `ReadinessHue` and `SleepQuality.paint` in the iOS app), so the web reads the same.
 */
import type { HueName } from "@/data/training";
import { msg } from "@/lib/i18n";

/** Readiness: green from 85, yellow for primed and ready (65–84), coral for steady (50–64), rose below. */
export function readinessHue(score: number): HueName {
  if (score >= 85) return "mint";
  if (score >= 65) return "yellow";
  if (score >= 50) return "coral";
  return "rose";
}

/** Sleep score: violet when good (70 and up), gold when fair (55–69), coral when low. */
export function sleepHue(score: number): HueName {
  if (score >= 70) return "violet";
  if (score >= 55) return "gold";
  return "coral";
}

/** Load ratio by COROS's training-load status, as the phone colours it. Blue when the status is unknown. */
export function loadHue(status: string | undefined): HueName {
  switch ((status ?? "").toLowerCase()) {
    case "decreasing": return "slate";
    case "resuming": return "cyan";
    case "performance": return "violet";
    case "maintaining": return "blue";
    case "optimized": case "optimised": return "mint";
    case "excessive": return "rose";
    default: return "blue";
  }
}

/* ───────────── Feel check ───────────── */

export type FeelTag = "sore" | "stressed" | "unwell" | "heavyLegs";

export const FEEL_LEVELS: readonly { level: number; title: string; hue: HueName }[] = [
  { level: 1, title: msg("Awful"), hue: "rose" },
  { level: 2, title: msg("Low"), hue: "orange" },
  { level: 3, title: msg("OK"), hue: "yellow" },
  { level: 4, title: msg("Good"), hue: "lime" },
  { level: 5, title: msg("Great"), hue: "mint" },
];

export const FEEL_TAGS: readonly { tag: FeelTag; title: string }[] = [
  { tag: "sore", title: msg("Sore") },
  { tag: "heavyLegs", title: msg("Heavy legs") },
  { tag: "stressed", title: msg("Stressed") },
  { tag: "unwell", title: msg("Unwell") },
];

/** Points a check asks to add to or take from readiness: −15…+7, as `FeelCheck.adjustment`. */
export function feelAdjustment(feel: number, tags: readonly string[]): number {
  const level = Math.min(5, Math.max(1, Math.round(feel)));
  let points = [-12, -6, 0, 4, 7][level - 1];
  if (tags.includes("sore")) points -= 4;
  if (tags.includes("heavyLegs")) points -= 4;
  if (tags.includes("stressed")) points -= 3;
  return Math.max(-15, Math.min(7, points));
}
