import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const servicePath = path.resolve(import.meta.dirname, "../dist-electron/watchService.js");
const require = createRequire(servicePath);
const source = fs.readFileSync(servicePath, "utf8");

// Exercise the Windows enumeration and public status/write APIs without hardware.
function loadService(initialVolumes, env = {}) {
  let volumes = initialVolumes;
  const reads = [];
  const execFile = () => { throw new Error("Unexpected subprocess"); };
  execFile[promisify.custom] = async () => ({ stdout: JSON.stringify(volumes.map(v => ({
    DeviceID: v.root.slice(0, 2), VolumeName: v.name
  }))) });
  const fakeFs = {
    statSync(target) {
      for (const v of volumes) {
        if ((v.folders ?? ["Music"]).some(folder => path.win32.join(v.root, folder) === target)) {
          return { isDirectory: () => true };
        }
      }
      throw new Error("Not found");
    },
    statfsSync: () => ({ blocks: 4e9, bsize: 1024, bavail: 3e9 }),
    readdirSync(target) { reads.push(target); return []; },
    existsSync: () => true,
    rmSync() { throw new Error("Unexpected deletion"); },
    mkdirSync() { throw new Error("Unexpected write"); }
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, process: { platform: "win32", env },
    require(id) {
      if (id === "node:child_process") return { execFile };
      if (id === "node:fs") return fakeFs;
      if (id === "node:path") return path.win32;
      return require(id);
    }
  }, { filename: servicePath });
  return { service: exports, reads, setVolumes(next) { volumes = next; } };
}

const hdd = { name: "4TB-HDD", root: "D:\\", folders: ["Music", "map"] };
for (const name of ["4TB-HDD", "Backup", "COROS Backup", "APEX archives", "COROS APEX 4 Backup", "COROS Desktop installer", "PACE 30"]) {
  const { service, reads } = loadService([{ ...hdd, name }]);
  const status = await service.getWatchStatus();
  assert.equal(status.connected, false, name);
  assert.equal(status.candidates.length, 0, name);
  assert.equal(reads.length, 0, "Rejected drives must not be walked");
  await assert.rejects(service.transferFileToWatch("C:\\track.mp3"), /No COROS watch/);
  await assert.rejects(service.deleteWatchTrack("track.mp3"), /No COROS watch/);
}

for (const name of ["COROS", "COROS WATCH", "COROS PACE", "COROS PACE PRO", "PACE3", "pace-3", "COROS_NOMAD", "VERTIX 2S", "COROS APEX 2 PRO", "Apex 4", "APEX4", "COROS APEX 4 42MM", "COROS APEX 4 46 mm", "APEX4 46"]) {
  for (const folders of [[], ["Music"], ["map"], ["Map"], ["Music", "map"]]) {
    const { service, reads } = loadService([hdd, { name, root: "E:\\", folders }]);
    const status = await service.getWatchStatus();
    assert.equal(status.connected, true, name);
    assert.equal(status.rootPath, "E:\\", name);
    assert.equal(status.candidates.length, 1);
    assert.ok(reads.every(p => p.startsWith("E:\\")));
  }
}

const emptyWatch = await loadService([{ name: "Apex 4", root: "E:\\", folders: [] }]).service.getWatchStatus();
assert.equal(emptyWatch.connected, true, "Recognized empty watch volumes are connected");
assert.equal(emptyWatch.candidates[0]?.reason, "Recognized COROS watch volume");
const explicit = loadService([hdd], { COROS_WATCH_PATH: "D:\\" });
assert.equal((await explicit.service.getWatchStatus()).connected, true, "Explicit override remains supported");

const renamed = loadService([{ name: "COROS", root: "E:\\" }]);
assert.equal((await renamed.service.getWatchStatus()).connected, true);
renamed.setVolumes([{ name: "Backup", root: "E:\\" }]);
assert.equal((await renamed.service.getWatchStatus()).connected, false, "Label changes invalidate cached selection");
console.log("Watch detection regression checks passed.");
