import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The Coach's athlete memory in SQLite: what the Coach and Coach settings write,
// change events for open views, and Undo that never discards the athlete's edit.
const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) => `${pathToFileURL(path.join(repoRoot, "dist-electron", file)).href}?cacheBust=${Date.now()}`;
const database = await import(distUrl("database.js"));
const store = await import(distUrl("athleteMemoryStore.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-memory-test-"));
database.initializeDatabase(tempRoot);

const seen = [];
const stop = store.onAthleteMemoryChanged((facts) => seen.push(facts.length));
assert.deepEqual(store.listAthleteFacts(), []);

const injury = store.saveAthleteFact({ category: "injury", text: "Left calf strain since 2026-10-18" }, "coach");
assert.equal(injury.action, "remembered");
assert.match(injury.fact.id, /^f[0-9a-z]{6}$/);
const goal = store.saveAthleteFact({ category: "goal", text: "Valencia Marathon, sub-3:15" }, "coach");
assert.equal(store.saveAthleteFact({ category: "goal", text: "valencia marathon, sub-3:15" }, "coach").action, "unchanged");
assert.deepEqual(store.listAthleteFacts().map((fact) => fact.category), ["goal", "injury"], "grouped in category order");
assert.deepEqual(seen, [1, 2], "an unchanged save is not announced");

// Undo a new fact: it goes away.
store.undoAthleteMemoryChange(goal);
assert.deepEqual(store.listAthleteFacts().map((fact) => fact.id), [injury.fact.id]);

// The athlete edits the Coach's fact; the Coach's old notice can no longer undo it.
await new Promise((resolve) => setTimeout(resolve, 5));
const edited = store.saveAthleteFact({ id: injury.fact.id, category: "injury", text: "Calf strain healed; full training" }, "athlete");
assert.equal(edited.action, "updated");
assert.equal(edited.fact.author, "athlete");
assert.throws(() => store.undoAthleteMemoryChange(injury), /changed since/);
assert.equal(store.listAthleteFacts()[0].text, "Calf strain healed; full training");

// Undo an update puts the earlier words back; undo a forget restores the fact.
store.undoAthleteMemoryChange(edited);
assert.equal(store.listAthleteFacts()[0].text, "Left calf strain since 2026-10-18");
const forgot = store.deleteAthleteFact(injury.fact.id);
assert.equal(forgot.action, "forgot");
assert.equal(store.deleteAthleteFact(injury.fact.id), undefined);
store.undoAthleteMemoryChange(forgot);
assert.equal(store.listAthleteFacts()[0].id, injury.fact.id);
assert.throws(() => store.undoAthleteMemoryChange(forgot), /changed since/, "a restored fact can't be restored twice");

store.saveAthleteFact({ category: "equipment", text: "Has a turbo trainer and 2 × 12 kg kettlebells" }, "athlete");
store.clearAthleteMemory();
assert.deepEqual(store.listAthleteFacts(), []);
stop();


fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("athlete memory store tests passed");
