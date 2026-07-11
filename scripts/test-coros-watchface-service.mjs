import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildCreateLinkBody,
  buildMobileLoginRegion,
  encryptMobileLoginField,
  extractDecimalProperty,
  normalizeCorosWatchfaceThemes,
  selectCorosWatchfaceArchive
} = await import(`${distUrl("corosWatchfaceService.js")}?cacheBust=${Date.now()}`);
const { createStoreZip } = await import(
  `${distUrl("zipStore.js")}?cacheBust=${Date.now()}`
);

assert.equal(
  encryptMobileLoginField("fixture@example.com"),
  "gEKTo01dr4WWsaqHSs8+wr1/TKGhdN5Ph7F1mR2+gwA=",
  "mobile-login compatibility cipher changed"
);
assert.equal(
  encryptMobileLoginField(
    crypto.createHash("md5").update("fixture-password", "utf8").digest("hex")
  ).length,
  64,
  "mobile password must encrypt the 32-character MD5 digest"
);

assert.equal(
  buildMobileLoginRegion({ locale: "en-US", timeZone: "America/Toronto" }),
  "DomainRegion(simMcc=310,countryCode=US,timeZoneId=America/Toronto,language=en,countryIso=us)",
  "mobile login region no longer matches the Android request shape"
);

const rawSavedResponse =
  '{"result":"0000","data":{"watchFaceTemplateId":478814257230741704}}';
assert.equal(
  extractDecimalProperty(rawSavedResponse, "watchFaceTemplateId"),
  "478814257230741704",
  "template IDs must remain lossless"
);
assert.match(
  buildCreateLinkBody({
    backgroundImageId: 13,
    firmwareType: "COROS W332",
    sourceTemplateId: 250601,
    templateId: "478814257230741704",
    name: "Fixture"
  }),
  /"watchFaceTemplateId":478814257230741704/,
  "template ID must be serialized as a JSON number, without precision loss"
);

assert.deepEqual(
  normalizeCorosWatchfaceThemes({
    watchFaceThemeList: [
      {
        watchFaceTemplateId: 250601,
        watchFaceTemplateName: "Digital dusk",
        previewImageUrl: "https://s3.coros.com/watchface/digital-dusk.png",
        firmwareType: "COROS W332",
        backgroundImageId: 13,
        watchFaceVersion: 5
      },
      {
        watchFaceTemplateId: 250601,
        watchFaceTemplateName: "Duplicate should be suppressed"
      },
      {
        id: "blocked-preview",
        name: "Unsafe preview is omitted",
        imageUrl: "http://example.test/preview.png"
      }
    ]
  }),
  [
    {
      id: "250601",
      name: "Digital dusk",
      previewImageUrl: "https://s3.coros.com/watchface/digital-dusk.png",
      firmwareType: "COROS W332",
      backgroundImageId: 13,
      watchFaceVersion: 5
    },
    {
      id: "blocked-preview",
      name: "Unsafe preview is omitted"
    }
  ],
  "theme-list normalizer should accept the mobile shape and reject non-HTTPS previews"
);

const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "coros-watchface-test-"));
try {
  const archivePath = path.join(tempDirectory, "fixture.dat");
  const archive = createStoreZip([
    {
      name: "info.json",
      data: Buffer.from(
        JSON.stringify({ o_template_id: 250601, o_diy_version: 1 }),
        "utf8"
      )
    },
    { name: "watchface_customize.png", data: Buffer.from("PNG") }
  ]);
  await fs.writeFile(archivePath, archive);

  const selected = await selectCorosWatchfaceArchive(archivePath);
  assert.equal(selected.fileName, "fixture.dat");
  assert.equal(selected.sourceTemplateId, 250601);
  assert.equal(selected.diyVersion, 1);
  assert.ok(selected.archiveId.length > 0);
} finally {
  await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log("COROS watchface service tests passed");
