import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";

// Since 2026-11-06 COROS answers /activity/detail/query with 1001 "Service
// exceptions" at random; the same request succeeds moments later. The detail
// read retries 1001 and reports only a failure that outlasts the retries.
const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const database = require(path.join(repoRoot, "dist-electron/database.js"));
const diagnostics = require(path.join(repoRoot, "dist-electron/diagnosticsService.js"));
const { getTrainingHubActivityDetail } = await import(
  pathToFileURL(path.join(repoRoot, "dist-electron", "trainingHubService.js")).href
);

const settings = new Map([
  ["trainingHub.accessToken", "live-token"],
  ["trainingHub.userId", "42"],
  ["trainingHub.regionId", "1"],
  ["trainingHub.baseUrl", "https://teamapi.coros.com"]
]);
mock.method(database, "getSetting", (key) => settings.get(key));
mock.method(database, "setSetting", (key, value) => settings.set(key, value));
mock.method(database, "deleteSettings", (keys) => keys.forEach((key) => settings.delete(key)));
const reported = [];
diagnostics.setDiagnosticRecorderForTests((source, error) => reported.push({ source, code: error?.code }));

const serviceException = () => Response.json({ result: "1001", message: "Service exceptions" });
const detail = () =>
  Response.json({ result: "0000", data: { summary: { name: "Indoor Run", sportType: 101, totalTime: 12000 } } });

let calls = 0;
let answers = [];
mock.method(globalThis, "fetch", async (input) => {
  const url = new URL(String(input));
  assert.equal(url.pathname, "/activity/detail/query");
  calls += 1;
  return (answers.shift() ?? serviceException)();
});

// 1. Two transient 1001s, then the detail: it arrives and nothing is reported.
answers = [serviceException, serviceException, detail];
const result = await getTrainingHubActivityDetail("481436602134986757", 101);
assert.equal(result.name, "Indoor Run");
assert.equal(calls, 3);
assert.deepEqual(reported, []);

// 2. 1001 every time: three attempts, then one report and the error.
calls = 0;
answers = [];
await assert.rejects(getTrainingHubActivityDetail("481436602134986757", 101), (error) => error.code === "1001");
assert.equal(calls, 3);
assert.deepEqual(reported, [{ source: "trainingHub:/activity/detail/query", code: "1001" }]);

// 3. Any other COROS error is not retried and is reported at once.
calls = 0;
reported.length = 0;
answers = [() => Response.json({ result: "11002", message: "The data was not found" })];
await assert.rejects(getTrainingHubActivityDetail("481436602134986757", 101), (error) => error.code === "11002");
assert.equal(calls, 1);
assert.deepEqual(reported, [{ source: "trainingHub:/activity/detail/query", code: "11002" }]);

console.log("activity detail retry ok");
