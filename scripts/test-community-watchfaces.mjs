import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "communityWatchfaceService.js")
).href;
const { parseCommunityWatchfaceDeepLink } = await import(
  `${serviceUrl}?cacheBust=${Date.now()}`
);

assert.deepEqual(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/ridge-line"),
  { slug: "ridge-line" }
);
assert.equal(
  parseCommunityWatchfaceDeepLink("https://watchfaces.coroslink.com/face/ridge-line"),
  null
);
assert.equal(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/ridge-line?download=https://attacker.test"),
  null
);
assert.equal(
  parseCommunityWatchfaceDeepLink("coroslink://settings/ridge-line"),
  null
);
assert.equal(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/../settings"),
  null
);
assert.equal(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/Ridge_Line"),
  null
);

assert.deepEqual(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/ridge-line?model=PACE+4"),
  { slug: "ridge-line", model: "PACE 4" }
);
assert.deepEqual(
  parseCommunityWatchfaceDeepLink("coroslink://watchfaces/ridge-line?model=PACE+4+Pro"),
  { slug: "ridge-line", model: "PACE 4 Pro" }
);
for (const query of ["model=unknown", "model=", "model=PACE+4&model=PACE+Pro", "model=PACE+4&download=https://attacker.test"]) {
  assert.equal(parseCommunityWatchfaceDeepLink(`coroslink://watchfaces/ridge-line?${query}`), null);
}

console.log("Community watchface service tests passed");
