import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "src", "preferences", "selectionPreferences.ts")
);
const {
  defineSelectionPreference,
  readSelectionPreference,
  selectionIsArrayOf,
  selectionIsBoolean,
  selectionIsOneOf,
  selectionPreferenceStorageKey,
  writeSelectionPreference
} = await import(`${moduleUrl.href}?cacheBust=${Date.now()}`);

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
const tabPreference = defineSelectionPreference({
  key: "test.tab",
  defaultValue: "overview",
  validate: selectionIsOneOf(["overview", "strength"])
});

assert.deepEqual(readSelectionPreference(tabPreference, storage), {
  value: "overview",
  restored: false
});

writeSelectionPreference(tabPreference, "strength", storage);
assert.equal(
  storage.getItem(selectionPreferenceStorageKey("test.tab")),
  '"strength"'
);
assert.deepEqual(readSelectionPreference(tabPreference, storage), {
  value: "strength",
  restored: true
});

const filterPreference = defineSelectionPreference({
  key: "test.filter",
  defaultValue: { landscape: true, topo: true },
  validate: (value) =>
    typeof value === "object" &&
    value !== null &&
    selectionIsBoolean(value.landscape) &&
    selectionIsBoolean(value.topo)
});
writeSelectionPreference(
  filterPreference,
  { landscape: false, topo: true },
  storage
);
assert.deepEqual(readSelectionPreference(filterPreference, storage), {
  value: { landscape: false, topo: true },
  restored: true
});

const metricPreference = defineSelectionPreference({
  key: "test.metrics",
  defaultValue: ["distance"],
  validate: selectionIsArrayOf(
    selectionIsOneOf(["distance", "duration", "trainingLoad"]),
    { minLength: 1, unique: true }
  )
});
writeSelectionPreference(
  metricPreference,
  ["distance", "trainingLoad"],
  storage
);
assert.deepEqual(readSelectionPreference(metricPreference, storage).value, [
  "distance",
  "trainingLoad"
]);

storage.setItem(selectionPreferenceStorageKey("test.tab"), "{broken");
assert.deepEqual(readSelectionPreference(tabPreference, storage), {
  value: "overview",
  restored: false
});

storage.setItem(
  selectionPreferenceStorageKey("test.tab"),
  JSON.stringify("obsolete-tab")
);
assert.deepEqual(readSelectionPreference(tabPreference, storage), {
  value: "overview",
  restored: false
});

storage.setItem(
  selectionPreferenceStorageKey("test.metrics"),
  JSON.stringify(["distance", "distance"])
);
assert.equal(readSelectionPreference(metricPreference, storage).restored, false);

const throwingStorage = {
  getItem() {
    throw new Error("read blocked");
  },
  setItem() {
    throw new Error("write blocked");
  }
};
assert.deepEqual(readSelectionPreference(tabPreference, throwingStorage), {
  value: "overview",
  restored: false
});
assert.doesNotThrow(() =>
  writeSelectionPreference(tabPreference, "strength", throwingStorage)
);

console.log("selection-preference tests passed");
