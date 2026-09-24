import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "communityWatchfaceService.js")
).href;
const { parseCommunityWatchfaceDeepLink, trustedDownloadLocation } = await import(
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

const catalog = "https://watchfaces.coroslink.com";
const release = "releases/4a6f96bf-0bed-4942-bd66-7b9cf7850a5f/be926c6e-b254-4aba-8ee6-42f95f41304b.zip";
const signed = "expires=1790210000&filename=face.zip&signature=abc_DEF-123";
for (const location of [
  `${catalog}/api/storage/${release}?${signed}`,
  `https://store.private.blob.vercel-storage.com/${release}?token=x`,
]) {
  assert.ok(trustedDownloadLocation(location, catalog), location);
}
for (const location of [
  `https://attacker.test/api/storage/${release}?${signed}`,
  `http://watchfaces.coroslink.com/api/storage/${release}?${signed}`,
  `${catalog}/api/storage/${release}`,
  `${catalog}/api/storage/${release}?expires=1790210000`,
  `${catalog}/api/storage/quarantine/4a6f96bf-0bed-4942-bd66-7b9cf7850a5f.zip?${signed}`,
  `${catalog}/api/storage/releases/../quarantine/x.zip?${signed}`,
  `${catalog}/api/downloads/4a6f96bf-0bed-4942-bd66-7b9cf7850a5f?${signed}`,
  `https://user:pass@watchfaces.coroslink.com/api/storage/${release}?${signed}`,
  "https://blob.vercel-storage.com.attacker.test/x.zip",
  "not a url",
]) {
  assert.equal(trustedDownloadLocation(location, catalog), null, location);
}

console.log("Community watchface service tests passed");
