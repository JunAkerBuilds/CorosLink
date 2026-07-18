import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const overlapUrl = pathToFileURL(
  path.join(repoRoot, "src", "maps", "routes", "routeOverlap.ts")
);
const { findRetracedRouteSections } = await import(
  `${overlapUrl.href}?cacheBust=${Date.now()}`
);

const a = [45, -75];
const b = [45.001, -75.001];
const c = [45.002, -75.002];
const d = [45.003, -75.001];

assert.deepEqual(findRetracedRouteSections([a, b, c, d]), []);

assert.deepEqual(findRetracedRouteSections([a, b, c, b, a]), [[a, b, c]]);

const jitteredB = [45.001003, -75.000997];
assert.deepEqual(findRetracedRouteSections([a, b, c, jitteredB, a]), [
  [a, b, c]
]);

assert.deepEqual(
  findRetracedRouteSections([a, b, a, c, d, c]),
  [
    [a, b],
    [c, d]
  ]
);

console.log("route overlap tests passed");
