import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "watchService.js")
);

async function loadWatchService() {
  return import(`${serviceUrl.href}?cacheBust=${Date.now()}`);
}

async function runPaceProSmoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-pro-")
  );
  const watchRoot = path.join(tempRoot, "COROS PACE PRO");
  const musicPath = path.join(watchRoot, "Music");
  const sourceTrack = path.join(tempRoot, "Workout Mix.mp3");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(
      path.join(musicPath, "Existing Track.mp3"),
      "mp3"
    );
    await fs.promises.writeFile(path.join(musicPath, "._Ghost.mp3"), "junk");
    await fs.promises.writeFile(path.join(musicPath, ".DS_Store"), "junk");
    await fs.promises.writeFile(path.join(musicPath, "notes.txt"), "ignore");
    await fs.promises.writeFile(sourceTrack, "new mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { deleteWatchTrack, getWatchStatus, transferFileToWatch } =
      await loadWatchService();

    const initial = await getWatchStatus();
    assert.equal(initial.connected, true);
    assert.equal(initial.name, "COROS PACE PRO");
    assert.equal(initial.model, "pace-pro");
    assert.equal(initial.rootPath, watchRoot);
    assert.equal(initial.musicPath, musicPath);
    assert.equal(initial.tracks.length, 1);
    assert.equal(initial.tracks[0].name, "Existing Track.mp3");

    const copied = await transferFileToWatch(sourceTrack);
    assert.equal(copied.name, "Workout Mix.mp3");
    assert.equal(
      fs.existsSync(path.join(musicPath, "Workout Mix.mp3")),
      true
    );

    await deleteWatchTrack("Existing Track.mp3");
    assert.equal(
      fs.existsSync(path.join(musicPath, "Existing Track.mp3")),
      false
    );

    const afterDelete = await getWatchStatus();
    assert.deepEqual(
      afterDelete.tracks.map((track) => track.name),
      ["Workout Mix.mp3"]
    );
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runPace4Smoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-4-")
  );
  const watchRoot = path.join(tempRoot, "COROS PACE 4");
  const musicPath = path.join(watchRoot, "Music");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(path.join(musicPath, "Warmup.mp3"), "mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, true);
    assert.equal(status.name, "COROS PACE 4");
    assert.equal(status.model, "pace-4");
    assert.equal(status.rootPath, watchRoot);
    assert.equal(status.musicPath, musicPath);
    assert.equal(status.tracks.length, 1);
    assert.equal(status.tracks[0].name, "Warmup.mp3");
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runInstallerVolumeIgnoredSmoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-installer-")
  );
  const watchRoot = path.join(tempRoot, "COROS Desktop-0.1.0-arm64");

  try {
    await fs.promises.mkdir(watchRoot, { recursive: true });

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, false);
    assert.equal(status.tracks.length, 0);
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runPace3Smoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-3-")
  );
  const watchRoot = path.join(tempRoot, "COROS PACE 3");
  const musicPath = path.join(watchRoot, "Music");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(path.join(musicPath, "Cooldown.mp3"), "mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, true);
    assert.equal(status.name, "COROS PACE 3");
    assert.equal(status.model, "pace-3");
    assert.equal(status.rootPath, watchRoot);
    assert.equal(status.musicPath, musicPath);
    assert.equal(status.tracks.length, 1);
    assert.equal(status.tracks[0].name, "Cooldown.mp3");
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runPace3NameVariantSmoke(volumeName, label) {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `coros-watch-smoke-3-${label}-`)
  );
  const watchRoot = path.join(tempRoot, volumeName);
  const musicPath = path.join(watchRoot, "Music");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(path.join(musicPath, "Track.mp3"), "mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, true, `${label}: connected`);
    assert.equal(status.name, volumeName, `${label}: name`);
    assert.equal(status.model, "pace-3", `${label}: model`);
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runAmbiguousCorosPaceSmoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-ambiguous-")
  );
  const watchRoot = path.join(tempRoot, "COROS PACE");
  const musicPath = path.join(watchRoot, "Music");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(path.join(musicPath, "Track.mp3"), "mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, true);
    assert.equal(status.name, "COROS PACE");

    const modelsUrl = pathToFileURL(
      path.join(repoRoot, "dist-electron", "watchModels.js")
    );
    const { resolveWatchModel } = await import(
      `${modelsUrl.href}?cacheBust=${Date.now()}`
    );
    const fourGb = 4 * 1024 * 1024 * 1024;
    assert.equal(resolveWatchModel("COROS PACE", fourGb), undefined);
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runNomadSmoke() {
  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coros-watch-smoke-nomad-")
  );
  const watchRoot = path.join(tempRoot, "COROS NOMAD");
  const musicPath = path.join(watchRoot, "Music");

  try {
    await fs.promises.mkdir(musicPath, { recursive: true });
    await fs.promises.writeFile(path.join(musicPath, "Trail Mix.mp3"), "mp3");

    process.env.COROS_WATCH_PATH = watchRoot;

    const { getWatchStatus } = await loadWatchService();
    const status = await getWatchStatus();

    assert.equal(status.connected, true);
    assert.equal(status.name, "COROS NOMAD");
    assert.equal(status.model, "nomad");
    assert.equal(status.rootPath, watchRoot);
    assert.equal(status.musicPath, musicPath);
    assert.equal(status.tracks.length, 1);
    assert.equal(status.tracks[0].name, "Trail Mix.mp3");
  } finally {
    delete process.env.COROS_WATCH_PATH;
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function runStaleFixtureCleanupSmoke() {
  const staleRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coroslink-watch-smoke-stale-")
  );
  const freshRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "coroslink-watch-smoke-fresh-")
  );

  try {
    await fs.promises.writeFile(path.join(staleRoot, "leftover.map"), "map");
    const agedTime = new Date(Date.now() - 60 * 60 * 1000);
    await fs.promises.utimes(staleRoot, agedTime, agedTime);

    const { cleanupStaleSmokeFixtures } = await loadWatchService();
    await cleanupStaleSmokeFixtures();

    assert.equal(fs.existsSync(staleRoot), false, "stale fixture swept");
    assert.equal(fs.existsSync(freshRoot), true, "fresh fixture kept");
  } finally {
    await fs.promises.rm(staleRoot, { recursive: true, force: true });
    await fs.promises.rm(freshRoot, { recursive: true, force: true });
  }
}

async function runSyncClearSmoke() {
  const { clearActiveSmokeFixtureSync, setWatchConnectionSmokeOption } =
    await loadWatchService();

  try {
    const status = await setWatchConnectionSmokeOption("pace-pro");
    assert.equal(status.connected, true);
    assert.ok(status.rootPath, "fixture root path set");

    const tempRoot = path.dirname(status.rootPath);
    assert.equal(fs.existsSync(tempRoot), true, "fixture exists before clear");

    clearActiveSmokeFixtureSync();
    assert.equal(fs.existsSync(tempRoot), false, "fixture removed by sync clear");
  } finally {
    delete process.env.COROS_WATCH_PATH;
  }
}

await runPaceProSmoke();
await runPace4Smoke();
await runPace3Smoke();
await runNomadSmoke();
await runPace3NameVariantSmoke("PACE 3", "pace-3-space");
await runPace3NameVariantSmoke("PACE-3", "pace-3-hyphen");
await runPace3NameVariantSmoke("PACE3", "pace-3-compact");
await runAmbiguousCorosPaceSmoke();
await runInstallerVolumeIgnoredSmoke();
await runStaleFixtureCleanupSmoke();
await runSyncClearSmoke();

console.log("Watch service smoke checks passed.");
