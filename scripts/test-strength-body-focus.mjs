import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceUrl = pathToFileURL(
  path.join(repoRoot, "src", "strength", "bodyFocus.ts")
);
const {
  FOCUS_MAX_DISTANCE_RATIO,
  FOCUS_MIN_DISTANCE_RATIO,
  calculateFocusDistance,
  cinematicDollyProgress,
  cinematicEaseOut,
  nearestOrbitAngle,
  resolveMuscleView
} = await import(`${sourceUrl.href}?cacheBust=${Date.now()}`);

assert.equal(resolveMuscleView("front", "back"), "front");
assert.equal(resolveMuscleView("back", "front"), "back");
assert.equal(resolveMuscleView("both", "front"), "front");
assert.equal(resolveMuscleView("both", "back"), "back");

const fullBodyDistance = 10;
const distance = (width, height, aspect = 1) =>
  calculateFocusDistance({
    width,
    height,
    aspect,
    verticalFovDegrees: 25,
    fullBodyDistance
  });

assert.equal(distance(0.001, 0.001), fullBodyDistance * FOCUS_MIN_DISTANCE_RATIO);
assert.equal(distance(100, 100), fullBodyDistance * FOCUS_MAX_DISTANCE_RATIO);
assert.ok(distance(1, 0.2, 0.6) > distance(1, 0.2, 1.6));
assert.ok(distance(0.2, 1.2) > distance(0.2, 0.3));

assert.equal(cinematicEaseOut(-1), 0);
assert.equal(cinematicEaseOut(0), 0);
assert.equal(cinematicEaseOut(1), 1);
assert.equal(cinematicEaseOut(2), 1);
assert.equal(cinematicDollyProgress(0.08), 0);
assert.equal(cinematicDollyProgress(1), 1);
assert.ok(cinematicDollyProgress(0.25) < cinematicEaseOut(0.25));

const nearBack = Math.PI - 0.05;
const targetBack = nearestOrbitAngle(-Math.PI + 0.05, Math.PI);
assert.ok(Math.abs(targetBack - (-Math.PI)) < 0.06);
assert.ok(Math.abs(nearestOrbitAngle(nearBack, 0) - nearBack) < Math.PI);

console.log("strength body focus tests passed");
