import { getLocale, formatDate } from "../i18n/trainingLocale";
/** Time and number helpers shared by the health insight cards. */
export const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const toEpoch = (time: string) => new Date(DAY_ONLY.test(time) ? `${time}T12:00:00` : time).getTime();

export function formatTime(value: string | number, mode: "day" | "clock" | "full"): string {
  const date = new Date(typeof value === "number" ? value : toEpoch(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  if (mode === "day") return formatDate(date, { month: "short", day: "numeric" });
  if (mode === "clock") return formatDate(date, { hour: "numeric", minute: "2-digit" });
  return formatDate(date, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const formatNumber = (value: number, digits = 0) => value.toLocaleString(getLocale(), { maximumFractionDigits: digits });

/** COROS wording → badge tone. Only labels COROS itself reports are shown. */
export function badgeTone(value: string): "good" | "watch" | "alert" | "neutral" {
  if (/\b(normal|relaxed|low|good|balanced|optimal)\b/i.test(value)) return "good";
  if (/\b(medium|moderate|elevated|slightly)\b/i.test(value)) return "watch";
  if (/\b(high|poor|below|above|unbalanced)\b/i.test(value)) return "alert";
  return "neutral";
}

export function parseRange(value: string | number): [number, number] | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/.exec(String(value));
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/** Local calendar day (YYYY-MM-DD) of a COROS time. */
export function localDay(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : toEpoch(value));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
