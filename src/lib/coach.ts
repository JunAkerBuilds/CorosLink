/** Pure helpers for Coach's conversation cards. */
import { t } from "@/lib/i18n";

/** Where a reading sits against the person's usual range, in the words the trend card uses. */
export function rangeNote(value: number, usual: readonly [number, number]): string {
  return value < usual[0] ? t("below your range") : value > usual[1] ? t("above your range") : t("in range");
}

/** The last `count` values, or all of them when there are fewer. */
export function lastValues<T>(values: readonly T[], count: number): T[] {
  return values.slice(Math.max(0, values.length - count));
}

/** The mean to one decimal, written without a trailing ".0". Null for an empty list. */
export function averageText(values: readonly number[]): string | null {
  if (!values.length) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return String(Math.round(mean * 10) / 10);
}

/** A value's place between `min` and `max` as a share from 0 to 1, kept inside the scale. */
export function shareOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * One rounded bar per kilometre where a quicker kilometre stands taller. `slot` is the room a kilometre has,
 * `width` the bar's, `inset` its start inside the slot; the scale runs from a little slower than the slowest
 * kilometre to a little quicker than the quickest, so every bar shows. `only` keeps some kilometres and leaves
 * the others' places empty, for drawing a block of them in another colour.
 */
export function paceBars(seconds: readonly number[], scale: readonly number[], h: number, slot: number, width: number, inset: number, radius = 4, only?: (k: number) => boolean): string {
  if (!seconds.length) return "";
  const slow = Math.max(...scale) + 12, fast = Math.min(...scale) - 6;
  return seconds
    .map((s, k) => {
      if (only && !only(k)) return "";
      const bh = Math.max(radius, shareOf(slow - s, 0, slow - fast) * h);
      const x = k * slot + inset, top = h - bh;
      return `M${x} ${h}V${(top + radius).toFixed(1)}q0 -${radius} ${radius} -${radius}h${width - 2 * radius}q${radius} 0 ${radius} ${radius}V${h}z`;
    })
    .join("");
}

/** How much of the week's plan is done and how much is still to come after a change, as shares of the old plan. */
export function weekShares(week: { before: number; after: number; done: number }): { planned: number; done: number } {
  const top = Math.max(week.before, week.after, 1);
  return { planned: Math.min(1, week.after / top), done: Math.min(1, week.done / top) };
}

/** The time of day an answer was given: 09:21. */
export function answerTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
