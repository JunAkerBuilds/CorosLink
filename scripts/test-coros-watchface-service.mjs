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
  applyCorosWatchfaceConfigOverrides,
  buildCreateLinkBody,
  buildMobileLoginRegion,
  encryptMobileLoginField,
  extractDecimalProperty,
  findHttpsUrlInJson,
  normalizeCorosBatteryReport,
  normalizeCorosPairedDevices,
  normalizeCorosWatchfaceThemes,
  selectCorosWatchfaceArchive
} = await import(`${distUrl("corosWatchfaceService.js")}?cacheBust=${Date.now()}`);
const { createStoreZip } = await import(
  `${distUrl("zipStore.js")}?cacheBust=${Date.now()}`
);

const configWithoutWeather = "[time_hour_high_pos]={1,2}\r\n";
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    weather_icon_pos: "{187,57}",
    weather_icon_dir: "weather"
  }),
  "[time_hour_high_pos]={1,2}\r\n[weather_icon_pos]={187,57}\r\n[weather_icon_dir]=weather\r\n",
  "confirmed optional weather keys should be appended without changing CRLF"
);
assert.throws(
  () => applyCorosWatchfaceConfigOverrides(configWithoutWeather, { weather_typo: "x" }),
  /does not define: weather_typo/,
  "unknown config keys must still be rejected"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    control_temperature_rect: "{35,0,145,35,hcenter|vcenter}",
    control_temperature_font: "cl_ctemp",
    control_temperature_font_color: "0xFFFFFF",
    control_negative_sign_icon: "icon\\negative.png"
  }),
  "[time_hour_high_pos]={1,2}\r\n[control_temperature_rect]={35,0,145,35,hcenter|vcenter}\r\n[control_temperature_font]=cl_ctemp\r\n[control_temperature_font_color]=0xFFFFFF\r\n[control_negative_sign_icon]=icon\\negative.png\r\n",
  "confirmed control-temperature keys should be appendable"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    temperature_rect: "{120,180,296,240,hcenter|vcenter}",
    temperature_font: "13x19",
    temperature_font_color: "0xFFFFFF",
    temperature_negative_sign_icon: "icon\\negative.png"
  }),
  "[time_hour_high_pos]={1,2}\r\n[temperature_rect]={120,180,296,240,hcenter|vcenter}\r\n[temperature_font]=13x19\r\n[temperature_font_color]=0xFFFFFF\r\n[temperature_negative_sign_icon]=icon\\negative.png\r\n",
  "confirmed fixed-temperature keys should be appendable"
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
    watchFaceTemplateList: [
      {
        watchFaceTemplateId: "custom-only",
        watchFaceTemplateName: "Must not appear in the official browser"
      }
    ],
    watchFaceThemeList: [
      {
        id: 1,
        watchFaceList: [
          {
            id: 478762815845416960,
            watchFaceName: "Digital dusk",
            imageUrl: "https://s3.coros.com/watchface/digital-dusk.png",
            watchFaceUrl: "https://api.coros.com/coros/watchface/resource/478762815845416960",
            firmwareType: "COROS W332",
            watchFaceVersion: 5
          },
          {
            id: 478762815845416960,
            watchFaceName: "Duplicate should be suppressed"
          },
          {
            id: "blocked-preview",
            watchFaceName: "Unsafe preview is omitted",
            imageUrl: "http://example.test/preview.png"
          }
        ]
      }
    ]
  }),
  [
    {
      id: "478762815845416960",
      name: "Digital dusk",
      previewImageUrl: "https://s3.coros.com/watchface/digital-dusk.png",
      packageUrl: "https://api.coros.com/coros/watchface/resource/478762815845416960",
      firmwareType: "COROS W332",
      watchFaceVersion: 5
    },
    {
      id: "blocked-preview",
      name: "Unsafe preview is omitted"
    }
  ],
  "theme-list normalizer should accept the mobile shape and reject non-HTTPS previews"
);

assert.deepEqual(
  normalizeCorosWatchfaceThemes(
    {
      watchFaceTemplateList: [
        {
          watchFaceTemplateId: "478814257230741704",
          watchFaceTemplateName: "My custom summit face",
          watchFaceTemplatePreviewImageUrl: "https://s3.coros.com/custom/summit-preview.png",
          watchFaceTemplateUserCustomUrl: "https://s3.coros.com/custom/summit-face.dat",
          firmwareType: "COROS W332"
        }
      ],
      watchFaceThemeList: [
        { watchFaceList: [{ id: 123, watchFaceName: "Official only" }] }
      ]
    },
    "custom"
  ),
  [
    {
      id: "478814257230741704",
      name: "My custom summit face",
      previewImageUrl: "https://s3.coros.com/custom/summit-preview.png",
      packageUrl: "https://s3.coros.com/custom/summit-face.dat",
      firmwareType: "COROS W332"
    }
  ],
  "custom catalog should select only the signed-in user's faces and retain their download URL"
);

assert.deepEqual(
  normalizeCorosWatchfaceThemes([
    {
      id: 477764002410233956,
      diyVersion: 1,
      previewImageUrl: "https://s3.coros.com/watchface_template/preview.png",
      watchFaceTemplateId: 250601,
      watchFaceTemplateName: "BOLD",
      watchFaceTemplateType: 1,
      watchFaceTemplateUrl: "https://s3.coros.com/watchface_template/source.zip",
      watchFaceVersion: 0
    }
  ]),
  [
    {
      id: "250601",
      name: "BOLD",
      previewImageUrl: "https://s3.coros.com/watchface_template/preview.png",
      packageUrl: "https://s3.coros.com/watchface_template/source.zip",
      watchFaceVersion: 0,
      diyVersion: 1,
      templateType: 1
    }
  ],
  "template catalog entries should expose their editable source ZIP"
);

assert.equal(
  findHttpsUrlInJson(
    '{"data":{"previewImageUrl":"https://s3.coros.com/p.png","fileUrl":"https://s3.coros.com/faces/dusk.dat"}}'
  ),
  "https://s3.coros.com/faces/dusk.dat",
  "JSON envelopes should yield the first non-image HTTPS URL"
);
assert.equal(
  findHttpsUrlInJson("not json at all"),
  undefined,
  "non-JSON payloads must not yield a URL"
);
assert.equal(
  findHttpsUrlInJson('{"url":"http://insecure.example/x.dat"}'),
  undefined,
  "plain-HTTP URLs inside envelopes must be ignored"
);

assert.deepEqual(
  normalizeCorosBatteryReport({
    alarmStatus: 0,
    timestamp: 1700000000,
    days: [
      {
        happenDay: 20260710,
        pctAtQueryTime: 7,
        totalPct: 8.5,
        groups: [
          { typeName: "General Use", typePct: 2.2 },
          {
            typeName: "Daily Features",
            typePct: 1.6,
            details: [
              { itemName: "Screen / Display", pct: 1.3 },
              { itemName: "Notifications", pct: 0.3 }
            ]
          },
          { itemName: "Ignored without a name", pct: "not-a-number" }
        ]
      }
    ]
  }),
  {
    alarmStatus: 0,
    updatedAt: "2023-11-14T22:13:20.000Z",
    days: [
      {
        date: "2026-07-10",
        percentAtQueryTime: 7,
        totalPercent: 8.5,
        groups: [
          { name: "General Use", percent: 2.2, details: [] },
          {
            name: "Daily Features",
            percent: 1.6,
            details: [
              { name: "Screen / Display", percent: 1.3 },
              { name: "Notifications", percent: 0.3 }
            ]
          },
          { name: "Ignored without a name", details: [] }
        ]
      }
    ]
  },
  "battery report normalizer should preserve daily totals and usage groups"
);

assert.deepEqual(
  normalizeCorosPairedDevices({
    deviceParamList: [
      {
        deviceId: "device-one",
        firmwareType: "COROS W332",
        uuid: "watch-uuid-one",
        mac: "ab12"
      },
      {
        deviceId: "device-one",
        firmwareType: "Duplicate",
        uuid: "duplicate"
      },
      {
        deviceId: "incomplete",
        firmwareType: "COROS W332"
      }
    ]
  }),
  [
    {
      deviceId: "device-one",
      firmwareType: "COROS W332",
      uuid: "watch-uuid-one",
      mac: "ab12"
    }
  ],
  "paired-device normalizer should return complete, unique profile devices"
);

assert.deepEqual(
  normalizeCorosPairedDevices({
    deviceProfiles: [
      {
        colorType: "B",
        deviceId: "pace-pro",
        firmwareType: "COROS W332",
        imagePackUrl: "https://s3.coros.com/device_image_pack/COROS_W332_B.zip",
        uuid: "watch-uuid-profile",
        version: 1752786660
      }
    ]
  }),
  [
    {
      colorType: "B",
      deviceId: "pace-pro",
      firmwareType: "COROS W332",
      imagePackUrl: "https://s3.coros.com/device_image_pack/COROS_W332_B.zip",
      profileVersion: 1752786660,
      uuid: "watch-uuid-profile"
    }
  ],
  "paired-device normalizer should retain the authenticated mobile device-profile shape"
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
  assert.equal(selected.sourceTemplateId, "250601");
  assert.equal(selected.diyVersion, 1);
  assert.ok(selected.archiveId.length > 0);
} finally {
  await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log("COROS watchface service tests passed");
