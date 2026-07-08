// Unit tests for the pure recency-filter logic backing the intervals.icu
// import dedup safety net. recordIntervalsImport/getRecentlyImportedIds
// themselves go through setSetting/getSetting, which hit the real SQLite
// `database` module (better-sqlite3, compiled against Electron's Node ABI) —
// that module cannot be loaded from a plain `node` process (see
// test-intervals-service.mjs's sibling scripts, none of which touch the DB
// directly under plain node). So we test the extracted pure helper,
// filterRecentIds, which takes the imported-at map explicitly and has no DB
// dependency.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { filterRecentIds, RECENT_IMPORT_WINDOW_MS } = await import(
  `${distUrl("intervalsService.js")}?cacheBust=${Date.now()}`
);

const now = Date.parse("2026-07-08T12:00:00Z");

// Empty map -> empty result.
assert.deepEqual(filterRecentIds({}, now, RECENT_IMPORT_WINDOW_MS), []);

// Within window -> included.
const withinMs = RECENT_IMPORT_WINDOW_MS;
const map1 = { i1: now - 1000 };
assert.deepEqual(filterRecentIds(map1, now, withinMs), ["i1"]);

// Exactly at the boundary -> included (inclusive).
const map2 = { i2: now - withinMs };
assert.deepEqual(filterRecentIds(map2, now, withinMs), ["i2"]);

// Outside window -> excluded.
const map3 = { i3: now - withinMs - 1000 };
assert.deepEqual(filterRecentIds(map3, now, withinMs), []);

// Mixed map -> only recent ones kept.
const map4 = {
  recent1: now - 1000,
  recent2: now - 60_000,
  stale1: now - withinMs - 1,
  stale2: now - withinMs * 2
};
assert.deepEqual(
  filterRecentIds(map4, now, withinMs).sort(),
  ["recent1", "recent2"].sort()
);

console.log("intervals-imported-store tests passed");
