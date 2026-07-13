// Regenerate src/training/exerciseNames.json from the COROS exercise catalogue.
//
// The catalogue endpoint (GET /training/exercise/query) requires a MOBILE token.
// This is a maintainer-only, one-time step — the app ships the static JSON and
// never fetches it at runtime.
//
// Usage:
//   1. Obtain the catalogue JSON array once (e.g. via the coros-mcp Python
//      package: authenticate, then call fetch_exercises(auth, 4)) and save it to
//      a local file, e.g. /tmp/coros-catalog.json  (NOT committed — personal data).
//   2. node scripts/build-exercise-names.mjs /tmp/coros-catalog.json
//
// Only built-in library codes (T####/S####) whose `overview` starts with `sid_`
// are emitted. Custom exercises (personal names) are skipped.
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/build-exercise-names.mjs <catalogue.json>");
  process.exit(1);
}
const items = JSON.parse(fs.readFileSync(input, "utf8"));
const humanize = (s) =>
  s
    .replace(/^sid_[a-z]+_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const dict = {};
for (const it of items) {
  const key = it.name;
  if (!key || !/^[TS]\d/.test(key)) continue;
  if (!it.overview || !/^sid_/.test(it.overview)) continue;
  dict[key] = humanize(it.overview);
}
const ordered = {};
for (const k of Object.keys(dict).sort()) ordered[k] = dict[k];
const out = path.resolve(import.meta.dirname, "..", "src", "training", "exerciseNames.json");
fs.writeFileSync(out, JSON.stringify(ordered, null, 2) + "\n");
console.log(`wrote ${out} (${Object.keys(ordered).length} entries)`);
