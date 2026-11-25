// Route paths from the web app's src/app folders. Pure, so it can be tested without a window.

/** A route's path pattern from its file: "/src/app/(app)/activities/[id]/page.tsx" → "/activities/[id]". */
export function patternOf(file: string, base = "/src/app"): string {
  const parts = file.slice(base.length).split("/").filter((p) => p && !/^\(.*\)$/.test(p));
  parts.pop();
  return "/" + parts.join("/");
}

/** The params a path gives a pattern, or null when it doesn't match. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean), got = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const m = /^\[(\w+)\]$/.exec(want[i]);
    if (m) params[m[1]] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}
