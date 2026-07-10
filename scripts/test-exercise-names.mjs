import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "src", "training", "exerciseNames.ts"));
const { resolveExerciseName } = await import(`${modUrl.href}?cacheBust=${Date.now()}`);

// Known library code resolves to English name.
assert.equal(resolveExerciseName("T1178"), "Two Arm Kettlebell Swings");
assert.equal(resolveExerciseName("T1310"), "Farmers Walk");

// Custom exercise: rawName is human-readable and not a T#/S# code → use it.
assert.equal(resolveExerciseName("Chaise", "Chaise"), "Chaise");

// Unknown key with no usable rawName → humanized fallback of the key, never a crash.
assert.equal(resolveExerciseName("T9999"), "T9999");

// rawName that is itself a code is ignored in favour of the key.
assert.equal(resolveExerciseName("T9999", "S1234"), "T9999");

console.log("exercise-names tests passed");
