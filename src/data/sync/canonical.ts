/** Canonical JSON (docs/sync-contract.md section 3): keys sorted, no insignificant whitespace. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(",")}]`;
  const bag = value as Record<string, unknown>;
  return `{${Object.keys(bag).filter((k) => bag[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(bag[k])}`).join(",")}}`;
}
