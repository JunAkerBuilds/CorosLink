// What Coach's AI calls an MCP server's tool: "<server>__<tool>". Tools from several servers share one list with
// Coach's own, so each name says which server it came from, and every provider takes it: letters, digits, _ and -,
// and short enough that Claude Code's "mcp__clink__" in front still fits the 64 characters the APIs allow.
import { createHash } from "node:crypto";

export const SEPARATOR = "__";
/** 64 minus Claude Code's "mcp__clink__". */
export const MAX_NAME = 52;
const MAX_SLUG = 16;

/** A server's part of its tools' names, from the name the athlete gave it: "Strava MCP" → "strava_mcp". */
export function serverSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_").slice(0, MAX_SLUG).replace(/_+$/, "");
  return slug || "mcp";
}

/** A slug no other server has: "strava", "strava_2", … */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken), base = serverSlug(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${base.slice(0, MAX_SLUG - String(n).length - 1)}_${n}`;
    if (!used.has(next)) return next;
  }
}

/** The name the model sees. A tool name too long or with other characters is cut and given a short hash, so it stays one name. */
export function toolName(slug: string, tool: string): string {
  const clean = tool.replace(/[^A-Za-z0-9_-]/g, "_");
  const full = `${slug}${SEPARATOR}${clean}`;
  if (full.length <= MAX_NAME && clean === tool) return full;
  const hash = createHash("sha256").update(tool).digest("hex").slice(0, 6);
  return `${full.slice(0, MAX_NAME - 7)}_${hash}`;
}
