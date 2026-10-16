type Field = string | number | boolean | null | undefined | readonly string[];

/**
 * Structured log line. Callers pass only identifiers and counters: never
 * tokens, credentials, connector tokens or request bodies.
 */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, Field> = {}): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
