import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modelsUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "watchModels.js")
);

const FOUR_GB = 4 * 1024 * 1024 * 1024;
const THIRTY_TWO_GB = 32 * 1024 * 1024 * 1024;

const {
  getWatchfaceDeviceProfile,
  getWatchfaceDeviceProfileByFirmware,
  normalizeVolumeName,
  resolveWatchModel
} = await import(
  `${modelsUrl.href}?cacheBust=${Date.now()}`
);

const nameCases = [
  ["COROS PACE PRO", "pace-pro"],
  ["PACE PRO", "pace-pro"],
  ["COROS PACE 4", "pace-4"],
  ["PACE 4", "pace-4"],
  ["PACE4", "pace-4"],
  ["PACE-4", "pace-4"],
  ["COROS PACE 3", "pace-3"],
  ["PACE 3", "pace-3"],
  ["Pace 3", "pace-3"],
  ["PACE3", "pace-3"],
  ["PACE-3", "pace-3"],
  ["PACE_3", "pace-3"],
  ["COROS NOMAD", "nomad"],
  ["NOMAD", "nomad"],
  ["COROS-NOMAD", "nomad"],
  ["COROS VERTIX 2", "vertix-2"],
  ["VERTIX 2", "vertix-2"],
  ["COROS-VERTIX-2", "vertix-2"],
  ["VERTIX 2S", "vertix-2s"],
  ["COROS VERTIX 2S", "vertix-2s"],
  ["COROS APEX 2 PRO", "apex-2-pro"],
  ["APEX 2 PRO", "apex-2-pro"],
  ["COROS APEX 4", "apex-4"],
  ["APEX 4", "apex-4"],
  ["APEX4", "apex-4"],
  ["APEX-4", "apex-4"],
  ["COROS APEX 2", "apex-2"],
  ["APEX 2", "apex-2"],
  ["APEX2", "apex-2"],
  ["APEX-2", "apex-2"],
  ["COROS APEX PRO", "apex-pro"],
  ["APEX PRO", "apex-pro"],
  ["COROS APEX", "apex"],
  ["APEX", "apex"],
  ["COROS PACE 2", "pace-2"],
  ["PACE 2", "pace-2"],
  ["PACE2", "pace-2"],
  ["PACE-2", "pace-2"],
  ["COROS PACE", undefined],
  ["PACE", undefined],
  ["PACE 20", undefined],
  ["APEX 20", undefined],
  ["PACE 30", undefined],
];

for (const [name, expected] of nameCases) {
  assert.equal(
    resolveWatchModel(name),
    expected,
    `resolveWatchModel("${name}")`
  );
}

assert.equal(normalizeVolumeName("  coros pace-3  "), "PACE 3");
assert.equal(normalizeVolumeName("PACE3"), "PACE 3");
assert.equal(normalizeVolumeName("coros nomad"), "NOMAD");
assert.equal(normalizeVolumeName("APEX2"), "APEX 2");
assert.equal(normalizeVolumeName("  coros apex-2  "), "APEX 2");

assert.equal(resolveWatchModel("COROS PACE", FOUR_GB), undefined);
assert.equal(resolveWatchModel("UNKNOWN", FOUR_GB), undefined);
assert.equal(resolveWatchModel("UNKNOWN", THIRTY_TWO_GB), undefined);

assert.deepEqual(getWatchfaceDeviceProfile("apex-4"), {
  firmwareType: "COROS W541"
});
assert.deepEqual(getWatchfaceDeviceProfile("pace-pro"), {
  firmwareType: "COROS W332",
  modelVersion: "W332-3.1708.0"
});
assert.deepEqual(getWatchfaceDeviceProfile("pace-4"), {
  firmwareType: "COROS W336",
  modelVersion: "W336-3.1709.0"
});
assert.deepEqual(getWatchfaceDeviceProfileByFirmware("coros w336"), {
  firmwareType: "COROS W336",
  modelVersion: "W336-3.1709.0"
});
assert.deepEqual(getWatchfaceDeviceProfileByFirmware("coros w541"), {
  firmwareType: "COROS W541"
});

console.log("Watch model resolution tests passed.");
