/** Time and number helpers shared by the health insight cards. */
export const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const toEpoch = (time: string) => new Date(DAY_ONLY.test(time) ? `${time}T12:00:00` : time).getTime();

export function formatTime(value: string | number, mode: "day" | "clock" | "full"): string {
  const date = new Date(typeof value === "number" ? value : toEpoch(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  if (mode === "day") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (mode === "clock") return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const formatNumber = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
