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
  createDuplicateProjectName,
  encryptMobileLoginField,
  exportCorosWatchfaceProject,
  extractDecimalProperty,
  findHttpsUrlInJson,
  normalizeCorosBatteryReport,
  normalizeCorosPairedDevices,
  normalizeCorosWatchfaceThemes,
  parseCorosMobileJson,
  parseCorosWatchfaceSharePage,
  readCorosWatchfaceProjectPackage,
  repairStandaloneBatteryConfigOverrides,
  stripBlankCorosWatchfaceConfigKeys,
  synthesizeScaledCorosAodConfig,
  normalizeWatchfaceIdOverride,
  setWatchfaceTemplateId,
  setWatchfaceTemplateName,
  selectCorosWatchfaceArchive,
  validateConfigTextReplacements
} = await import(`${distUrl("corosWatchfaceService.js")}?cacheBust=${Date.now()}`);
const { createStoreZip } = await import(
  `${distUrl("zipStore.js")}?cacheBust=${Date.now()}`
);

const configWithoutWeather = "[time_hour_high_pos]={1,2}\r\n";
assert.equal(
  createDuplicateProjectName("Morning Run", []),
  "Morning Run copy"
);
assert.equal(
  createDuplicateProjectName("Morning Run", [
    "Morning Run copy",
    "morning run COPY 2"
  ]),
  "Morning Run copy 3",
  "duplicate names should be unique regardless of casing"
);
assert.equal(
  createDuplicateProjectName("Morning Run copy", ["Morning Run copy"]),
  "Morning Run copy 2",
  "duplicating an existing copy should increment the suffix"
);
assert.equal(
  createDuplicateProjectName("Morning Run copy 2", ["Morning Run copy 2"]),
  "Morning Run copy 3",
  "duplicating a numbered copy should continue from its suffix"
);
assert.equal(
  createDuplicateProjectName("x".repeat(80), []).length,
  80,
  "duplicate names must stay within the project-name limit"
);
assert.equal(
  setWatchfaceTemplateId(
    '{"o_template_id":251134,"o_diy_version":1}',
    "478814257230741704"
  ),
  '{"o_template_id":478814257230741704,"o_diy_version":1}',
  "template ID override must preserve IDs larger than Number.MAX_SAFE_INTEGER"
);
assert.throws(
  () => setWatchfaceTemplateId('{"o_template_id":251134}', "not-a-number"),
  /1–20 decimal digits/
);
assert.equal(normalizeWatchfaceIdOverride("54"), "54");
assert.equal(normalizeWatchfaceIdOverride("0x3B9ACE60"), "0x3B9ACE60");
assert.equal(
  normalizeWatchfaceIdOverride("0x26"),
  "0x00000026",
  "short hex watch-face IDs are padded to 8 digits like AODconfig"
);
assert.throws(
  () => normalizeWatchfaceIdOverride("not-an-id"),
  /32-bit decimal or 0x hex/
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[watchface_id]=0\r\n[time_hour_high_pos]={1,2}\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[watchface_id]=0x3B9ACE60\r\n[time_hour_high_pos]={1,2}\r\n",
  "watch-face ID override must rewrite config.txt [watchface_id]"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[watchface_id]=0x00000026\r\n[background_icon]=background.png\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[watchface_id]=0x3B9ACE60\r\n[background_icon]=background.png\r\n",
  "watch-face ID override must rewrite AODconfig.txt [watchface_id]"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[background_icon]=background.png\r\n",
    { watchface_id: "0x3B9ACE60" }
  ),
  "[background_icon]=background.png\r\n[watchface_id]=0x3B9ACE60\r\n",
  "watch-face ID override must append [watchface_id] when AOD omits it"
);
assert.deepEqual(
  [...validateConfigTextReplacements([
    {
      path: "watchface_416x416/AODconfig.txt",
      text: "[watchface_id]=0x3B9ACE60\r\n"
    }
  ])],
  [["watchface_416x416/AODconfig.txt", "[watchface_id]=0x3B9ACE60\r\n"]],
  "config text replacements must accept AODconfig paths"
);
assert.throws(
  () =>
    validateConfigTextReplacements([
      { path: "watchface_416x416/missing.ini", text: "x" }
    ]),
  /existing template config file/
);
assert.throws(
  () =>
    validateConfigTextReplacements([
      {
        path: "watchface_416x416/config.txt",
        text: "a"
      },
      {
        path: "watchface_416x416/config.txt",
        text: "b"
      }
    ]),
  /duplicated config file/
);

assert.deepEqual(
  parseCorosMobileJson(
    '{"data":{"watchFaceTemplateId":478947569257513340,"srcWatchFaceTemplateId":478943290396344519}}'
  ),
  {
    data: {
      watchFaceTemplateId: "478947569257513340",
      srcWatchFaceTemplateId: "478943290396344519"
    }
  },
  "mobile JSON parser must preserve watch-face IDs above Number.MAX_SAFE_INTEGER"
);
assert.equal(
  setWatchfaceTemplateName(
    '{"m_name":"SLENDER","o_template_id":251134}',
    "TOP PART"
  ),
  '{"m_name":"TOP PART","o_template_id":251134}'
);
assert.throws(
  () => setWatchfaceTemplateName('{"m_name":"SLENDER"}', " "),
  /1–64 characters/
);
assert.deepEqual(
  repairStandaloneBatteryConfigOverrides(
    "[battery_icon_pos]={20,30}\r\n[battery_icon_dir]=\r\n",
    {},
    true
  ),
  { battery_icon_dir: "cl_battery_icon" },
  "a final Studio battery folder must be linked even if renderer overrides omit it"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[control_battery_icon_dir]=battery\r\n[control_step_icon]=icon\\step.png\r\n",
    { control_battery_icon_dir: "__COROSLINK_DELETE_CONFIG_KEY__" }
  ),
  "[control_step_icon]=icon\\step.png\r\n",
  "disabled selectable metrics must be removed instead of exported as blank pages"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(
    "[time_hour_high_pos]={1,2}\n[time_hour_high_pos]={3,4}\n",
    { time_hour_high_pos: "{5,6}" }
  ),
  "[time_hour_high_pos]={5,6}\n[time_hour_high_pos]={5,6}\n",
  "structured overrides must rewrite every duplicate raw-config declaration"
);
assert.equal(
  applyCorosWatchfaceConfigOverrides(configWithoutWeather, {
    weather_icon_pos: "{187,57}",
    weather_icon_dir: "weather"
  }),
  "[time_hour_high_pos]={1,2}\r\n[weather_icon_pos]={187,57}\r\n[weather_icon_dir]=weather\r\n",
  "confirmed optional weather keys should be appended without changing CRLF"
);
const configWithSynthesizedBattery = applyCorosWatchfaceConfigOverrides(
  configWithoutWeather,
  {
    battery_icon_pos: "{20,30}",
    battery_icon_dir: "cl_battery_icon",
    battery_level_rect: "{10,40,90,60,hcenter|vcenter}",
    battery_level_font: "13x19",
    battery_level_font_color: "0xFFFFFF",
    control_step_font_color: "0x12ABEF",
    control_battery_level_font: "13x19",
    control_battery_level_font_color: "0x12ABEF"
  }
);
for (const expected of [
  "[battery_icon_pos]={20,30}",
  "[battery_icon_dir]=cl_battery_icon",
  "[battery_level_rect]={10,40,90,60,hcenter|vcenter}",
  "[battery_level_font]=13x19",
  "[battery_level_font_color]=0xFFFFFF",
  "[control_step_font_color]=0x12ABEF",
  "[control_battery_level_font]=13x19",
  "[control_battery_level_font_color]=0x12ABEF"
]) {
  assert.ok(
    configWithSynthesizedBattery.includes(expected),
    `confirmed Studio battery key should be appendable: ${expected}`
  );
}
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
  stripBlankCorosWatchfaceConfigKeys(
    "//comment\r\n[control_step_rect]={1,2,3,4,hcenter|vcenter}\r\n[control_barometer_icon_pos]=\r\n[control_barometer_font]= \r\n\r\n[control_hr_font]=cl_control\r\n"
  ),
  "//comment\r\n[control_step_rect]={1,2,3,4,hcenter|vcenter}\r\n\r\n[control_hr_font]=cl_control\r\n",
  "blank [key]= lines should be removed; values, comments and spacing kept"
);
assert.equal(
  stripBlankCorosWatchfaceConfigKeys("[a]=1\n[b]=\n[c]=2\n"),
  "[a]=1\n[c]=2\n",
  "blank-key stripping should preserve LF newlines"
);

assert.equal(
  synthesizeScaledCorosAodConfig(
    [
      "[bg_color]=0x000000",
      "[watchface_id]=0x00000029",
      "[arc_cut_icon_pos]={132,163}",
      "[arc_cut_icon]=icon\\aod_cut.png",
      "[control_english_date_week_font]=aod_",
      "[time_hour_high_pos]={111,197}",
      "[time_hour_high_font]=aod_32x45",
      "[english_date_week_rect]={92,152,214,207,hcenter|vcenter}",
      "[english_date_week_font]=aod_english_week",
      "[empty_key]=",
      ""
    ].join("\r\n"),
    800 / 416,
    new Set([
      "watchface_800x800/icon/aod_cut.png",
      "watchface_800x800/32x45/00.png",
      "watchface_800x800/english_week/00.png"
    ]),
    "watchface_800x800"
  ),
  [
    "[bg_color]=0x000000",
    "[watchface_id]=0x00000029",
    "[arc_cut_icon_pos]={254,313}",
    "[arc_cut_icon]=icon\\aod_cut.png",
    "[time_hour_high_pos]={213,379}",
    "[time_hour_high_font]=32x45",
    "[english_date_week_rect]={177,292,412,398,hcenter|vcenter}",
    "[english_date_week_font]=english_week",
    "[empty_key]=",
    ""
  ].join("\r\n"),
  "AOD synthesis should scale braces, remap aod_ assets and drop danglers"
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

const sharePageState = {
  apiData: {
    data: {
      data: {
        watchFaceTemplateUserCustom: {
          firmwareType: "COROS W541",
          watchFaceTemplateName: "BOLD2",
          watchFaceTemplateUrl:
            "https://s3eu.coros.com/watchface_template_user_custom/0/bold2.zip"
        }
      }
    }
  },
  pageData: { isExpired: false }
};
assert.deepEqual(
  parseCorosWatchfaceSharePage(
    `<html><script> window.__INITIAL_STATE__= ${JSON.stringify(sharePageState)};</script></html>`
  ),
  {
    firmwareType: "COROS W541",
    name: "BOLD2",
    packageUrl:
      "https://s3eu.coros.com/watchface_template_user_custom/0/bold2.zip"
  },
  "public COROS share pages should expose their editable archive metadata"
);
assert.throws(
  () =>
    parseCorosWatchfaceSharePage(
      `<script>window.__INITIAL_STATE__=${JSON.stringify({
        ...sharePageState,
        pageData: { isExpired: true }
      })};</script>`
    ),
  /expired/,
  "expired COROS share links should not import"
);
assert.throws(
  () =>
    parseCorosWatchfaceSharePage(
      `<script>window.__INITIAL_STATE__=${JSON.stringify({
        ...sharePageState,
        apiData: {
          data: {
            data: {
              watchFaceTemplateUserCustom: {
                watchFaceTemplateName: "Untrusted",
                watchFaceTemplateUrl: "https://example.com/watchface.zip"
              }
            }
          }
        }
      })};</script>`
    ),
  /not hosted by COROS/,
  "share imports should reject archives hosted outside COROS"
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
          firmwareType: "COROS W332",
          srcWatchFaceTemplateId: "250506",
          backgroundImageId: 13
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
      sourceTemplateId: "250506",
      name: "My custom summit face",
      previewImageUrl: "https://s3.coros.com/custom/summit-preview.png",
      packageUrl: "https://s3.coros.com/custom/summit-face.dat",
      firmwareType: "COROS W332",
      backgroundImageId: 13
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
  assert.equal(selected.watchFaceVersion, 0);
  assert.ok(selected.archiveId.length > 0);

  const exportedPath = path.join(tempDirectory, "website-face.zip");
  const editableDesign = {
    version: 1,
    accentColor: "#55d6be",
    editorGroups: [{ id: "group-1", name: "Metrics", layerIds: ["steps", "calories"] }],
    linkedLayerGroups: [["steps", "calories"]],
    editorGuides: [{ id: "guide-1", axis: "y", position: 208 }],
    effectStyles: [{
      id: "style-1",
      name: "Inner depth",
      effects: [{ id: "shadow-1", kind: "inner-shadow", enabled: true, color: "#112233", opacity: 0.5, blur: 6, spread: -2, distance: 3, angle: 90 }]
    }],
    layerEffects: { steps: { kind: "style", styleId: "style-1" } }
  };
  const preview = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await exportCorosWatchfaceProject(
    {
      sourceArchiveId: selected.archiveId,
      name: "Website face",
      firmwareType: "COROS W332",
      design: editableDesign,
      previewDataUrl: `data:image/png;base64,${preview.toString("base64")}`
    },
    exportedPath
  );
  const editablePackage = await readCorosWatchfaceProjectPackage(exportedPath);
  assert.ok(editablePackage, "website ZIP should be recognized as an editable project");
  assert.equal(editablePackage.manifest.name, "Website face");
  assert.equal(editablePackage.manifest.firmwareType, "COROS W332");
  assert.deepEqual(editablePackage.manifest.design, editableDesign);
  assert.deepEqual(
    editablePackage.starterArchive,
    archive,
    "editable website ZIP should preserve the original starter archive exactly"
  );
  assert.deepEqual(editablePackage.preview, preview);

  const finderWrappedPath = path.join(tempDirectory, "finder-wrapped-face.zip");
  await fs.writeFile(
    finderWrappedPath,
    createStoreZip([
      {
        name: "Website face/coroslink-project.json",
        data: Buffer.from(JSON.stringify(editablePackage.manifest), "utf8")
      },
      { name: "Website face/starter.dat", data: editablePackage.starterArchive },
      { name: "Website face/preview.png", data: editablePackage.preview },
      {
        name: "__MACOSX/Website face/._coroslink-project.json",
        data: Buffer.from("macOS metadata", "utf8")
      }
    ])
  );
  const wrappedPackage = await readCorosWatchfaceProjectPackage(finderWrappedPath);
  assert.ok(
    wrappedPackage,
    "a project ZIP inside one Finder-created folder should be recognized"
  );
  assert.deepEqual(wrappedPackage.manifest, editablePackage.manifest);
  assert.deepEqual(wrappedPackage.starterArchive, archive);
  assert.deepEqual(wrappedPackage.preview, preview);
} finally {
  await fs.rm(tempDirectory, { recursive: true, force: true });
}

console.log("COROS watchface service tests passed");
