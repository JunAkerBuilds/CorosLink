import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "communityWatchfaceService.js")
).href;
const { parseCommunityCatalogPage, parseCommunityWatchfaceDeepLink, trustedDownloadLocation } = await import(
  `${serviceUrl}?cacheBust=${Date.now()}`
);

// The grouped "designs" listing once sent packageBytes as a bigint string,
// which took the whole Community tab down.
const catalogItem = {
  id: "4a6f96bf-0bed-4942-bd66-7b9cf7850a5f",
  slug: "ridge-line",
  title: "Ridge Line",
  description: "",
  creatorName: "Creator",
  creatorHandle: null,
  models: ["PACE Pro"],
  tags: [],
  publishedAt: "2026-10-12T18:00:35.841Z",
  previewUrl: "https://watchfaces.coroslink.com/api/watch-faces/4a6f96bf-0bed-4942-bd66-7b9cf7850a5f/preview",
  detailUrl: "https://watchfaces.coroslink.com/face/ridge-line",
  downloadUrl: "https://watchfaces.coroslink.com/api/downloads/4a6f96bf-0bed-4942-bd66-7b9cf7850a5f",
  packageBytes: 2205409,
  packageSha256: "a".repeat(64),
  validatorVersion: null
};
const catalogPage = (packageBytes) => ({
  schemaVersion: 1,
  items: [{ ...catalogItem, packageBytes }],
  pagination: { page: 1, pageSize: 12, total: 1, pageCount: 1 },
  facets: { models: ["PACE Pro"], styles: [] }
});
for (const packageBytes of [2205409, "2205409"]) {
  assert.equal(parseCommunityCatalogPage(catalogPage(packageBytes)).items[0].packageBytes, 2205409);
}
for (const packageBytes of ["", "0", "-5", "1e6", "12.5", " 42", "104857601", null, true]) {
  assert.throws(() => parseCommunityCatalogPage(catalogPage(packageBytes)), undefined, String(packageBytes));
}

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
