const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Run with Electron's Node runtime to match the installed better-sqlite3 ABI.
// Only native dialogs, app paths, and network requests are mocked. GPX parsing,
// persistence, listing, export, and deletion use the real services and SQLite.
const reload = process.argv[2] === "--reload";
const root = reload
  ? process.argv[3]
  : fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-gpx-import-"));
const userData = path.join(root, "user-data");
let selection = { canceled: false, filePaths: [] };
let exportPath;
const requests = [];
const inputs = new Map();

require.cache[require.resolve("electron")] = {
  exports: {
    app: {
      getPath: (key) => {
        assert.equal(key, "userData");
        return userData;
      }
    },
    dialog: {
      showOpenDialog: async (options) => {
        assert.deepEqual(options.properties, ["openFile", "multiSelections"]);
        return selection;
      },
      showSaveDialog: async () => ({ canceled: false, filePath: exportPath })
    }
  }
};
global.fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url);
  return { ok: true, json: async () => ({ display_name: "Test locality" }) };
};

const service = require("../dist-electron/mapService.js");
const database = require("../dist-electron/database.js");
let db;

function fixture(fileName, name = fileName, content) {
  const filePath = path.join(root, "inputs", fileName);
  const gpx = content ?? `<gpx><metadata><name><![CDATA[${name}]]></name></metadata>
    <trk><trkseg><trkpt lat="43.60" lon="-79.40"/>
    <trkpt lat="43.62" lon="-79.42"/></trkseg></trk></gpx>`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, gpx);
  inputs.set(filePath, gpx);
  return filePath;
}

async function importFiles(filePaths, canceled = false) {
  selection = { canceled, filePaths };
  return service.importRouteFromGpx("running");
}

function storedFiles() {
  return fs.readdirSync(path.join(userData, "routes")).sort();
}

async function run() {
  db = database.initializeDatabase(userData);
  if (reload) {
    const expected = JSON.parse(fs.readFileSync(path.join(root, "expected.json"), "utf8"));
    const listed = service.listGeneratedRoutes();
    assert.deepEqual(listed.map((route) => route.id), expected);
    for (const route of listed) {
      assert.ok(fs.existsSync(route.gpxPath));
    }
    return;
  }

  const first = fixture("a/route.gpx", "First route");
  const last = fixture("b/route.gpx", "Last route");
  const corrupt = fixture("corrupt.gpx", "", "<gpx></gpx>");
  const missing = path.join(root, "inputs", "missing.gpx");

  assert.equal(await importFiles([first], true), null);
  assert.equal(await importFiles([]), null);
  assert.equal(service.listGeneratedRoutes().length, 0);
  const mixed = await importFiles([first, corrupt, missing, last]);
  assert.deepEqual(mixed.routes.map((route) => route.name), ["First route", "Last route"]);
  assert.deepEqual(mixed.failures.map((failure) => failure.fileName), ["corrupt.gpx", "missing.gpx"]);
  assert.match(mixed.failures[0].message, /No track or route points/);
  assert.match(mixed.failures[1].message, /ENOENT/);
  assert.notEqual(mixed.routes[0].gpxPath, mixed.routes[1].gpxPath);

  const partial = await importFiles([corrupt, last]);
  assert.equal(partial.routes.length, 1);
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.routes[0].startLocation, "43.6000, -79.4000");
  assert.equal(partial.routes[0].destinationLocation, "43.6200, -79.4200");
  const failed = await importFiles([corrupt, missing]);
  assert.equal(failed.routes.length, 0);
  assert.equal(failed.failures.length, 2);
  assert.equal(requests.length, 0, "even a batch with one valid file must skip geocoding");

  const single = await importFiles([first]);
  assert.equal(single.routes[0].startLocation, "Test locality");
  assert.equal(single.routes[0].destinationLocation, "Test locality");
  assert.equal(requests.length, 2);
  for (const url of requests) {
    assert.equal(url.origin, "https://nominatim.openstreetmap.org");
    assert.equal(url.pathname, "/reverse");
  }
  requests.length = 0;

  const longName = "山道 🏃 ".repeat(100);
  const hostileName = "../../escape\\payload <script>alert(1)</script> '; DROP TABLE generated_routes;--";
  const special = await importFiles([
    fixture("long.gpx", longName),
    fixture("hostile.gpx", hostileName)
  ]);
  assert.deepEqual(special.failures, []);
  assert.deepEqual(special.routes.map((route) => route.name), [longName.trim(), hostileName]);
  for (const route of special.routes) {
    assert.equal(path.dirname(route.gpxPath), path.join(userData, "routes"));
    assert.ok(Buffer.byteLength(path.basename(route.gpxPath)) < 255);
    assert.equal(database.getGeneratedRoute(route.id).name, route.name);
    const gpx = fs.readFileSync(route.gpxPath, "utf8");
    assert.ok(!gpx.includes("<script>"));
    assert.equal(service.parseGpxRoute(gpx).name, route.name);
  }

  // SQLite rejects one route after its GPX is written; the file is rolled back
  // and the following valid route still imports successfully.
  const beforeFailure = storedFiles();
  db.exec(`CREATE TRIGGER reject_test_route BEFORE INSERT ON generated_routes
    WHEN NEW.name = 'Database failure'
    BEGIN SELECT RAISE(ABORT, 'Simulated database failure'); END`);
  const dbFailed = await importFiles([
    fixture("db-failure.gpx", "Database failure"), last
  ]);
  db.exec("DROP TRIGGER reject_test_route");
  assert.equal(dbFailed.routes.length, 1);
  assert.equal(dbFailed.failures[0].fileName, "db-failure.gpx");
  assert.match(dbFailed.failures[0].message, /Simulated database failure/);
  assert.deepEqual(storedFiles(), [...beforeFailure, path.basename(dbFailed.routes[0].gpxPath)].sort());

  // A filesystem write may create a partial file before failing.
  const beforeDiskFailure = storedFiles();
  const diskInput = fixture("disk-failure.gpx", "Disk failure");
  const originalWrite = fs.promises.writeFile;
  let diskFailed;
  try {
    fs.promises.writeFile = async function (filePath, content, ...options) {
      if (typeof content === "string" && content.includes("<name>Disk failure</name>")) {
        await originalWrite.call(this, filePath, content.slice(0, 20), ...options);
        throw new Error("Simulated disk write failure");
      }
      return originalWrite.call(this, filePath, content, ...options);
    };
    diskFailed = await importFiles([diskInput, last]);
  } finally {
    fs.promises.writeFile = originalWrite;
  }
  assert.equal(diskFailed.routes.length, 1);
  assert.equal(diskFailed.failures[0].fileName, "disk-failure.gpx");
  assert.match(diskFailed.failures[0].message, /Simulated disk write failure/);
  assert.deepEqual(storedFiles(), [...beforeDiskFailure, path.basename(diskFailed.routes[0].gpxPath)].sort());

  // The P2 regression: both an existing library and every route from a batch
  // larger than 20 must remain listed, including after reopening the database.
  const existingIds = service.listGeneratedRoutes().map((route) => route.id);
  const files = Array.from({ length: 25 }, (_, index) =>
    fixture(`batch-${index}.gpx`, `Batch ${index}`)
  );
  const batch = await importFiles(files);
  assert.equal(batch.routes.length, 25);
  assert.deepEqual(batch.failures, []);
  const all = service.listGeneratedRoutes();
  assert.equal(all.length, existingIds.length + 25);
  assert.deepEqual(new Set(all.map((route) => route.id)), new Set([
    ...existingIds, ...batch.routes.map((route) => route.id)
  ]));

  // Force a shared timestamp to reproduce fast-batch ties deterministically.
  const sameTime = "2099-01-01T00:00:00.000Z";
  const setTime = db.prepare("UPDATE generated_routes SET created_at = ? WHERE id = ?");
  for (const route of batch.routes) setTime.run(sameTime, route.id);
  const ordered = service.listGeneratedRoutes().map((route) => route.id);
  assert.deepEqual(ordered.slice(0, 25), batch.routes.map((route) => route.id).reverse());
  fs.writeFileSync(path.join(root, "expected.json"), JSON.stringify(ordered));
  const reopened = spawnSync(process.execPath, [__filename, "--reload", root], {
    encoding: "utf8", timeout: 30_000
  });
  assert.equal(reopened.status, 0, `${reopened.error ?? ""}\n${reopened.stdout}\n${reopened.stderr}`);

  // A route beyond the former limit is still actionable, not just counted.
  const olderRoute = service.listGeneratedRoutes().find((route) => route.id === existingIds.at(-1));
  assert.ok(olderRoute);
  exportPath = path.join(root, "exported.gpx");
  assert.equal(await service.exportGeneratedRoute(olderRoute.id), exportPath);
  assert.equal(fs.readFileSync(exportPath, "utf8"), fs.readFileSync(olderRoute.gpxPath, "utf8"));
  assert.equal(service.deleteGeneratedRoute(olderRoute.id), true);
  assert.equal(database.getGeneratedRoute(olderRoute.id), undefined);
  assert.equal(service.listGeneratedRoutes().length, all.length - 1);
  for (let attempt = 0; attempt < 100 && fs.existsSync(olderRoute.gpxPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(olderRoute.gpxPath), false);
  assert.equal(requests.length, 0, "multi-file imports must not make network requests");
  for (const [filePath, content] of inputs) {
    assert.equal(fs.readFileSync(filePath, "utf8"), content, "source GPX must stay unchanged");
  }
  console.log("GPX integration tests passed (large batches, restart, export/delete, failures, safe storage).");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  db?.close();
  if (!reload) fs.rmSync(root, { recursive: true, force: true });
});
