/** Workout dates follow the computer's local calendar, like Coach's current clock. */
export function coachActivityDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "unknown date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
