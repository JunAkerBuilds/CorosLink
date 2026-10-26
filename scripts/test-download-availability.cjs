// Run with: ELECTRON_RUN_AS_NODE=1 electron scripts/test-download-availability.cjs
// The batch availability check must answer exactly like the single-item
// lookup while probing only files whose metadata matches.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const distElectron = process.env.COROSLINK_DIST_ELECTRON ?? path.join(__dirname, "..", "dist-electron");
const database = require(path.join(distElectron, "database.js"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-download-availability-"));
const library = path.join(root, "library");
fs.mkdirSync(library);
database.initializeDatabase(path.join(root, "data"));
const db = database.requireDatabase();
const insert = db.prepare(
  "INSERT INTO downloads (id, url, title, file_path, size_bytes, created_at) VALUES (?, ?, ?, ?, 1, ?)"
);
let rowNumber = 0;
function addRow(url, title, fileName, present = true) {
  const filePath = path.join(library, fileName);
  if (present) fs.writeFileSync(filePath, "x");
  insert.run(`row-${rowNumber++}`, url, title, filePath, new Date().toISOString());
}

addRow("https://music.youtube.com/watch?v=AAAAAAAAAAA", "Song A", "Song A.m4a");
addRow("https://example.com/missing", "Missing Song", "Missing Song.m4a", false);
addRow("spotify:track:42", "Spotify Song", "Spotify Song.m4a");
addRow("spotify:album:9:track:77", "Gone Spotify", "Gone Spotify.m4a", false);
addRow("search:apple", "Café del Mar (1)", "Café del Mar (1).m4a");
addRow("search:apple-2", "Twice", "Twice.m4a", false);
addRow("search:apple-3", "Twice", "Twice (1).m4a");
addRow("search:apple-4", "Only Missing", "Only Missing.m4a", false);
addRow("https://other.example/watch", "Video [BBBBBBBBBBB]", "Video [BBBBBBBBBBB].m4a");
addRow("https://other.example/file", "Renamed", "Renamed [CCCCCCCCCCC].mp3");

const cases = [
  ["https://music.youtube.com/watch?v=AAAAAAAAAAA", undefined, true],
  ["https://example.com/missing", undefined, false],
  ["https://example.com/missing", "Missing Song", false],
  ["spotify:track:42", undefined, true],
  ["spotify:playlist:1:track:42", undefined, true],
  ["spotify:track:77", undefined, false],
  ["search:new", "cafe del mar", true],
  ["search:new", "CAFÉ — DEL MAR", true],
  ["search:new", "Twice", true],
  ["search:new", "Only Missing", false],
  ["search:new", "Nothing Like It", false],
  ["search:new", "", false],
  ["https://youtu.be/BBBBBBBBBBB", undefined, true],
  ["https://www.youtube.com/watch?v=CCCCCCCCCCC&list=x", undefined, true],
  ["https://www.youtube.com/shorts/DDDDDDDDDDD", undefined, false],
  ["https://unknown.example/", undefined, false],
];

const check = database.createDownloadAvailabilityCheck();
for (const [url, title, expected] of cases) {
  const label = `${url} / ${title}`;
  assert.equal(database.hasAvailableDownloadForUrl(url, title), expected, `single: ${label}`);
  assert.equal(check(url, title), expected, `batch: ${label}`);
}

// Batch benchmark: many unrelated rows, many new search tracks. Count file probes.
const benchmarkRows = Number(process.env.BENCH_ROWS ?? 5000);
const benchmarkTracks = Number(process.env.BENCH_TRACKS ?? 200);
db.transaction(() => {
  for (let index = 0; index < benchmarkRows; index++) {
    addRow(`search:existing-${index}`, `Existing Track ${index}`, `Existing Track ${index}.m4a`);
  }
})();
const realExistsSync = fs.existsSync;
let probes = 0;
fs.existsSync = (target) => { probes++; return realExistsSync(target); };
function measure(run) {
  probes = 0;
  const started = performance.now();
  for (let index = 0; index < benchmarkTracks; index++) {
    assert.equal(run(`search:new-${index}`, `Brand New Track ${index}`), false);
  }
  return { ms: performance.now() - started, probes };
}
const single = measure((url, title) => database.hasAvailableDownloadForUrl(url, title));
const batch = measure(database.createDownloadAvailabilityCheck());
fs.existsSync = realExistsSync;
assert.equal(batch.probes, 0, "unrelated rows must not be probed");

fs.rmSync(root, { recursive: true, force: true });
console.log(
  `Download availability passed: ${cases.length} cases. ${benchmarkTracks} new tracks vs ${benchmarkRows} rows: ` +
  `per-item ${single.ms.toFixed(1)} ms / ${single.probes} probes, batch ${batch.ms.toFixed(1)} ms / ${batch.probes} probes.`
);
