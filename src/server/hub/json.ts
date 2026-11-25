// COROS's wire JSON, read the forgiving way the Swift client reads it (numbers that arrive as strings and
// the other way round). No Node imports: safe anywhere.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value[key]`, or undefined when `value` isn't an object or has no such key. */
export function at(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

export function list(value: Json | undefined): Json[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** A string, or a number as COROS's IDs print (TrainingHub.text). */
export function text(value: Json | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) < 1e18 ? value.toFixed(0) : String(value);
  return undefined;
}

/** `text`, with "" as nothing (HubWorkout.text). */
export function word(value: Json | undefined): string | undefined {
  const found = text(value);
  return found ? found : undefined;
}

/** A number, a numeric string, or a flag as 1/0 (HubWorkout.number). */
export function num(value: Json | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value !== "" && value.trim() === value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** `num`, cut to a whole number (HubWorkout.int). */
export function int(value: Json | undefined): number | undefined {
  const found = num(value);
  return found === undefined || !Number.isFinite(found) ? undefined : Math.trunc(found);
}

/** Swift's `rounded()`: halves away from zero. */
export function round(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
