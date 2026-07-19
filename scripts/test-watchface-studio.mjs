import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analogCenterLayoutGroupId,
  applyConfigOverridesToDetails,
  applyConfigTextEditsToDetails,
  sanitizeWatchfaceAodAlpha,
  buildAmPmOverrides,
  buildControlTemperatureOverrides,
  buildControlIconPositionOverrides,
  buildControlBatteryVisibilityOverrides,
  buildControlComplicationConfigurationOverrides,
  buildControlComplicationVisibilityOverrides,
  buildDisabledControlComplicationOverrides,
  buildDisabledWatchfaceConfigAssetOverrides,
  buildDateSpriteComposition,
  buildDateStyleOverrides,
  dateSpriteCanvasSize,
  buildLayerVisibilityOverrides,
  buildLayerColorOverrides,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricStyleOverrides,
  buildSelectableMetricSpriteComposition,
  buildSelectableMetricSpriteReplacements,
  buildSelectableMetricStyleOverrides,
  buildSeparateTimeOverrides,
  buildStaticSeparatorOverrides,
  buildTimeStyleOverrides,
  buildTimeTrackingOverrides,
  buildWatchfaceConfigAssetOverrides,
  buildWatchfaceConfigAssetReplacements,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  configAssetCanvasSize,
  configAssetSupportsNativeSize,
  corosMonthLabelForSpriteIndex,
  corosMonthSpriteIndex,
  corosWeekdayIndex,
  detailsForCompositionMode,
  detailsForPreviewMode,
  detailsForPreviewResolution,
  getAvailableComplications,
  getAmPmCapability,
  getFixedMetricCapabilities,
  getTemplateBackgroundAssetPaths,
  getWatchfaceAnalogPreviewLayers,
  getWatchfaceControlStatusPreviewLayers,
  hasControlBattery,
  hasControlComplication,
  hasAutoAlignedTime,
  hasWatchfaceAod,
  inferStaticSeparators,
  isControlComplicationEnabled,
  listWatchfaceConfigAssets,
  loadStudioImage,
  mergeAssetReplacements,
  mergeConfigOverrides,
  normalizeRasterFontGlyphs,
  parseWatchfaceConfigText,
  pickWatchPreviewResolution,
  rasterFontSupportsText,
  rasterFontNativeSpriteSize,
  removeWatchfaceDateFontOverride,
  rebaseNegativeControlChildren,
  retargetWatchfaceCompositionToAod,
  retargetWatchfaceCompositionToCurrent,
  resizeConfigRectToCanvas,
  resolveWatchfaceSpriteRotation,
  rotateSpriteInCanvas,
  scaledBatterySpriteCanvasSize,
  scaleConfigRectValue,
  supportsWatchfaceSpriteRotation,
  timeSpriteCanvasSize,
  WATCHFACE_COMPLICATIONS,
  watchfaceEffectRenderScale
} from "../src/watchfaces/watchfaceStudio.ts";
import {
  materializeLegacyAodDesign,
  resolveWatchfaceModeDesign,
  writeWatchfaceModeDesign
} from "../src/watchfaces/watchfaceDisplayModes.ts";
import {
  classifyRasterSpriteFolder,
  createRasterFontFolderReplacement
} from "../src/watchfaces/watchfaceRasterFolder.ts";
import { WatchfaceSpriteImportTracker } from "../src/watchfaces/watchfaceSpriteImportTracker.ts";

const rasterFolderSprite = (relativePath, dataUrl = relativePath) => ({
  name: relativePath.split("/").at(-1),
  relativePath,
  dataUrl,
  sizeBytes: dataUrl.length
});

const folderB = {
  label: "folder_b",
  sprites: [
    rasterFolderSprite("digits/01.png", "b-one"),
    rasterFolderSprite("digits/00.png", "b-zero"),
    rasterFolderSprite("weekdays/MON.png", "b-mon"),
    rasterFolderSprite("months/JAN.png", "b-jan")
  ]
};
const classifiedFolderB = classifyRasterSpriteFolder(folderB);
assert.deepEqual([...classifiedFolderB.digitSprites.keys()], ["0", "1"]);
assert.deepEqual([...classifiedFolderB.labelSprites.keys()], ["JAN", "MON"]);

// A pure 00–09 set on a month component is a digit font (firmware composes
// 1–12 numerically), while a 00–11 set fills the twelve JAN–DEC label slots.
const monthDigitsFolder = {
  label: "month_digits",
  sprites: Array.from({ length: 10 }, (_, digit) =>
    rasterFolderSprite(`month_digits/${String(digit).padStart(2, "0")}.png`)
  )
};
const classifiedMonthDigits = classifyRasterSpriteFolder(
  monthDigitsFolder,
  "month"
);
assert.equal(classifiedMonthDigits.importedDigitCount, 10);
assert.equal(classifiedMonthDigits.importedMonthCount, 0);
assert.deepEqual(
  [...classifiedMonthDigits.digitSprites.keys()],
  ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
);
const monthLabelsFolder = {
  label: "month_labels",
  sprites: Array.from({ length: 12 }, (_, index) =>
    rasterFolderSprite(`month_labels/${String(index).padStart(2, "0")}.png`)
  )
};
const classifiedMonthLabels = classifyRasterSpriteFolder(
  monthLabelsFolder,
  "month"
);
assert.equal(classifiedMonthLabels.importedDigitCount, 0);
assert.equal(classifiedMonthLabels.importedMonthCount, 12);
const replacementFolderB = await createRasterFontFolderReplacement(folderB, {
  tint: true,
  createDigitAtlas: async (sprites) => ({
    dataUrl: `atlas:${[...sprites.values()].join(",")}`,
    glyphs: [...sprites.keys()].join(""),
    columns: sprites.size,
    atlasSize: { width: 20, height: 10 }
  }),
  readSpriteSize: async () => ({ width: 10, height: 10 })
});
assert.equal(replacementFolderB.rasterFont.label, "folder b");
assert.equal(replacementFolderB.rasterFont.tint, true);
assert.deepEqual(Object.keys(replacementFolderB.rasterFont.sprites), [
  "0",
  "1",
  "JAN",
  "MON"
]);
assert.equal(replacementFolderB.rasterFont.sprites["9"], undefined);
assert.equal(replacementFolderB.rasterFont.labels.OLD, undefined);
assert.deepEqual(replacementFolderB.rasterFont.atlasSize, {
  width: 20,
  height: 10
});
await assert.rejects(
  createRasterFontFolderReplacement(
    {
      label: "duplicates",
      sprites: [
        rasterFolderSprite("second/0.png"),
        rasterFolderSprite("first/00.png")
      ]
    },
    {
      tint: false,
      createDigitAtlas: async () => {
        throw new Error("duplicate validation must run before atlas creation");
      },
      readSpriteSize: async () => ({ width: 1, height: 1 })
    }
  ),
  (error) =>
    /Duplicate PNG sprite “00”/.test(error.message) &&
    error.message.includes("first/00.png") &&
    error.message.includes("second/0.png")
);

const importTracker = new WatchfaceSpriteImportTracker();
const olderImport = importTracker.begin("component:Date month", "session-a");
const newerImport = importTracker.begin("component:Date month", "session-a");
const parallelImport = importTracker.begin("component:Weekday", "session-a");
assert.equal(importTracker.pendingCount, 3);
assert.equal(importTracker.isCurrent(olderImport, "session-a"), false);
assert.equal(importTracker.isCurrent(newerImport, "session-a"), true);
assert.equal(importTracker.isCurrent(parallelImport, "session-a"), true);
assert.equal(importTracker.isCurrent(newerImport, "session-b"), false);
importTracker.finish(olderImport);
assert.equal(importTracker.pendingCount, 2);
assert.equal(importTracker.isCurrent(newerImport, "session-a"), true);
importTracker.finish(newerImport);
importTracker.finish(parallelImport);
assert.equal(importTracker.pendingCount, 0);

assert.equal(corosWeekdayIndex(0), 6);
assert.equal(corosWeekdayIndex(1), 0);
assert.equal(corosWeekdayIndex(6), 5);
assert.equal(corosMonthSpriteIndex(0), 1);
assert.equal(corosMonthSpriteIndex(6), 7);
assert.equal(corosMonthSpriteIndex(11), 0);
assert.equal(corosMonthLabelForSpriteIndex(0), "DEC");
assert.equal(corosMonthLabelForSpriteIndex(7), "JUL");
assert.equal(watchfaceEffectRenderScale(520 / 416, 416 / 800), 0.65);
assert.deepEqual(
  [...sanitizeWatchfaceAodAlpha(
    new Uint8ClampedArray([
      10, 20, 30, 0,
      40, 50, 60, 1,
      70, 80, 90, 4,
      95, 100, 105, 249,
      96, 101, 106, 250,
      100, 110, 120, 255
    ])
  )],
  [
    10, 20, 30, 0,
    40, 50, 60, 0,
    70, 80, 90, 0,
    95, 100, 105, 0,
    96, 101, 106, 255,
    100, 110, 120, 255
  ],
  "AOD cleanup should discard faint residue and retain a binary outline"
);
const smoothedAodEdge = new Uint8ClampedArray(5 * 5 * 4);
const setAodAlpha = (x, y, alpha) => {
  smoothedAodEdge[(y * 5 + x) * 4 + 3] = alpha;
};
setAodAlpha(2, 2, 255);
setAodAlpha(1, 1, 80);
setAodAlpha(2, 1, 200);
setAodAlpha(3, 2, 249);
setAodAlpha(4, 4, 249);
sanitizeWatchfaceAodAlpha(smoothedAodEdge, 5, 5);
const aodAlphaAt = (x, y) => smoothedAodEdge[(y * 5 + x) * 4 + 3];
assert.equal(aodAlphaAt(2, 2), 255, "opaque outline core should remain on");
assert.equal(
  aodAlphaAt(1, 1),
  255,
  "ordered dithering should retain eligible coverage beside the outline"
);
assert.equal(
  aodAlphaAt(2, 1),
  0,
  "ordered dithering should omit edge coverage below its pixel threshold"
);
assert.equal(
  aodAlphaAt(3, 2),
  255,
  "strong adjacent coverage should smooth the binary outline"
);
assert.equal(
  aodAlphaAt(4, 4),
  0,
  "partial-alpha fill away from the outline must remain transparent"
);

assert.equal(normalizeRasterFontGlyphs("0 1 2 2 a"), "012A");
const rasterFont = {
  label: "Pixel digits",
  dataUrl: "data:image/png;base64,AA==",
  glyphs: "0123456789SUN",
  columns: 10,
  labels: { MON: "data:image/png;base64,AA==" },
  tint: true
};
assert.equal(rasterFontSupportsText(rasterFont, "08"), true);
assert.equal(rasterFontSupportsText(rasterFont, "sun"), true);
assert.equal(rasterFontSupportsText(rasterFont, "mon"), true);
assert.equal(rasterFontSupportsText(rasterFont, "wed"), false);
assert.equal(
  rasterFontSupportsText(
    { label: "Independent", dataUrl: "", glyphs: "", columns: 1, tint: false, sprites: { "7": "data:image/png;base64,AA==" } },
    "7"
  ),
  true,
  "an individually imported glyph should not require an atlas"
);
assert.deepEqual(
  rasterFontNativeSpriteSize(
    {
      label: "Native digits",
      dataUrl: "data:image/png;base64,AA==",
      glyphs: "0",
      columns: 1,
      sprites: { "0": "data:image/png;base64,AA==" },
      spriteSizes: { "0": { width: 31, height: 47 } },
      tint: false
    },
    "0"
  ),
  { width: 31, height: 47 }
);

function digitFiles(width, height, directory, folder) {
  return Array.from({ length: 10 }, (_, digit) => ({
    path: `${directory}/${folder}/${String(digit).padStart(2, "0")}.png`,
    width,
    height
  }));
}

function weekFiles(width, height, directory, folder) {
  return Array.from({ length: 7 }, (_, day) => ({
    path: `${directory}/${folder}/${String(day).padStart(2, "0")}.png`,
    width,
    height
  }));
}

function resolution(width, digitWidth, digitHeight) {
  const directory = `watchface_${width}x${width}`;
  return {
    directory,
    width,
    height: width,
    config: {
      heartreate_level_rect: "",
      heartreate_level_font: "",
      step_rect: "",
      step_font: "",
      kcal_rect: "",
      kcal_font: "",
      elevation_rect: "",
      elevation_font: "",
      temperature_rect: "",
      temperature_font: "",
      temperature_font_color: "",
      control_temperature_icon_pos: "",
      control_temperature_icon: "",
      control_temperature_rect: "",
      control_temperature_font: "",
      control_temperature_font_color: "",
      control_temperature_negative_sign_icon: "",
      control_negative_sign_icon: "",
      am_icon: "icon\\am.png",
      pm_icon: "icon\\pm.png",
      am_pm_icon_pos: `{${Math.round(width * 0.6)},${Math.round(width * 0.125)}}`,
      background_icon: "background.png",
      colon_icon: "icon\\colon.png",
      control_colon_icon: "icon\\colon.png",
      watchface_thmb_icon: "thmb.png",
      arc_cut_icon_pos: `{${Math.round(width * 0.3)},${Math.round(width * 0.2)}}`,
      arc_cut_icon: "icon\\cut.png",
      time_hour_high_pos: `{${Math.round(width * 0.125)},${Math.round(width * 0.125)}}`,
      time_hour_high_font: "13x19",
      time_hour_low_pos: `{${Math.round(width * 0.2)},${Math.round(width * 0.125)}}`,
      time_hour_low_font: "13x19",
      time_minute_high_pos: `{${Math.round(width * 0.35)},${Math.round(width * 0.125)}}`,
      time_minute_high_font: "13x19",
      time_minute_low_pos: `{${Math.round(width * 0.425)},${Math.round(width * 0.125)}}`,
      time_minute_low_font: "13x19",
      time_second_high_pos: `{${Math.round(width * 0.55)},${Math.round(width * 0.125)}}`,
      time_second_high_font: "13x19",
      time_second_low_pos: `{${Math.round(width * 0.6)},${Math.round(width * 0.125)}}`,
      time_second_low_font: "13x19",
      time_second_high_font_color: "",
      time_second_low_font_color: "",
      english_date_week_rect: `{${Math.round(width * 0.1)},${Math.round(width * 0.4)},${Math.round(width * 0.3)},${Math.round(width * 0.48)},hcenter|vcenter}`,
      english_date_week_font: "english_week",
      english_date_week_font_color: "",
      english_date_month_rect: `{${Math.round(width * 0.4)},${Math.round(width * 0.4)},${Math.round(width * 0.48)},${Math.round(width * 0.48)},hcenter|vcenter}`,
      english_date_month_font: "13x19",
      english_date_month_font_color: "",
      english_date_day_rect: `{${Math.round(width * 0.5)},${Math.round(width * 0.4)},${Math.round(width * 0.58)},${Math.round(width * 0.48)},hcenter|vcenter}`,
      english_date_day_font: "13x19",
      english_date_day_font_color: "",
      battery_level_font_color: "",
      battery_icon_pos: `{${Math.round(width * 0.2)},${Math.round(width * 0.1)}}`,
      battery_icon_dir: "battery",
      rect_control1_pos: `{${Math.round(width * 0.125)},${Math.round(width * 0.25)}}`,
      control_hr_rect: `{${Math.round(width * 0.2)},0,${Math.round(width * 0.36)},${digitHeight},hcenter|vcenter}`,
      control_hr_font: "13x19",
      control_step_rect: `{${Math.round(width * 0.1)},0,${Math.round(width * 0.38)},${digitHeight},hcenter|vcenter}`,
      control_step_font: "13x19"
    },
    aodConfig: {
      background_icon: "a\\icon\\aod-background.png"
    },
    spriteFolders: [
      {
        folder: "13x19",
        kind: "digits",
        aod: false,
        files: digitFiles(digitWidth, digitHeight, directory, "13x19")
      },
      {
        folder: "english_week",
        kind: "week",
        aod: false,
        files: weekFiles(digitWidth * 3, digitHeight, directory, "english_week")
      },
      {
        folder: "battery",
        kind: "state",
        aod: false,
        files: digitFiles(digitWidth * 2, digitHeight, directory, "battery")
      }
    ],
    icons: [
      {
        path: `${directory}/icon/cut.png`,
        width: Math.round(width * 0.2),
        height: Math.round(width * 0.3)
      },
      {
        path: `${directory}/icon/colon.png`,
        width: Math.max(4, Math.round(width * 0.04)),
        height: Math.max(7, Math.round(width * 0.065))
      },
      {
        path: `${directory}/background.png`,
        width,
        height: width
      },
      {
        path: `${directory}/thmb.png`,
        width,
        height: width
      },
      {
        path: `${directory}/a/icon/aod-background.png`,
        width,
        height: width
      },
      {
        path: `${directory}/icon/am.png`,
        width: Math.round(width * 0.08),
        height: Math.round(width * 0.04)
      },
      {
        path: `${directory}/icon/pm.png`,
        width: Math.round(width * 0.08),
        height: Math.round(width * 0.04)
      }
    ]
  };
}

const apexPreviewDetails = {
  archiveId: "apex-preview",
  resolutions: [
    resolution(240, 7, 11),
    resolution(260, 8, 12),
    resolution(280, 9, 13),
    resolution(800, 24, 38)
  ]
};
assert.equal(
  pickWatchPreviewResolution(apexPreviewDetails)?.width,
  260,
  "240/260/800 MIP bundles should preview the APEX 4 46 mm tree by default"
);
assert.deepEqual(
  detailsForPreviewResolution(apexPreviewDetails, "watchface_240x240")
    .resolutions.map(({ width }) => width),
  [240],
  "Studio should be able to render one physical watch tree without changing the master"
);
assert.equal(
  pickWatchPreviewResolution({
    archiveId: "amoled-preview",
    resolutions: [resolution(416, 12, 20), resolution(800, 24, 38)]
  })?.width,
  416,
  "AMOLED bundles should preview the physical 416px tree instead of the 800px master"
);

assert.deepEqual(
  getTemplateBackgroundAssetPaths({
    archiveId: "fixture",
    resolutions: [resolution(416, 12, 20), resolution(800, 24, 38)]
  }),
  [
    "watchface_800x800/background.png",
    "watchface_800x800/watchface_customize.png",
    "watchface_customize.png"
  ],
  "Studio should initialize imported artwork from the largest on-watch background"
);

const details = {
  archiveId: "fixture",
  resolutions: [resolution(416, 23, 33), resolution(800, 44, 64)]
};

assert.equal(WATCHFACE_COMPLICATIONS.length, 10);
assert.equal(
  isControlComplicationEnabled(details, {}, "heartRate"),
  true,
  "a selectable declared by the imported template should default on"
);
assert.equal(
  isControlComplicationEnabled(details, {}, "calories"),
  false,
  "a selectable missing from the imported template should default off"
);
assert.equal(hasControlComplication(details, "steps"), true);
assert.equal(hasControlComplication(details, "calories"), false);

const noControlDetails = {
  ...details,
  resolutions: details.resolutions.map((candidate) => ({
    ...candidate,
    config: Object.fromEntries(
      Object.entries(candidate.config).filter(
        ([key]) =>
          !key.startsWith("control_") &&
          !/^rect_control\d+_pos$/.test(key)
      )
    )
  }))
};
const enabledMissingCalories =
  buildControlComplicationConfigurationOverrides(noControlDetails, {
    controlComplicationEnabled: { calories: true }
  });
for (const candidate of noControlDetails.resolutions) {
  const override = enabledMissingCalories.find(
    ({ path }) => path === `${candidate.directory}/config.txt`
  );
  assert.equal(override?.values.rect_control1_pos, "{0,0}");
  assert.match(
    override?.values.control_kcal_rect ?? "",
    /^\{\d+,\d+,\d+,\d+,hcenter\|vcenter\}$/
  );
  assert.ok(
    override?.values.control_kcal_font,
    "enabling a missing selectable should inject a usable digit font"
  );
}
const configuredCalories = applyConfigOverridesToDetails(
  noControlDetails,
  enabledMissingCalories
);
assert.equal(
  hasControlComplication(configuredCalories, "calories"),
  true,
  "the synthesized configuration should be recognized when the project reloads"
);

const virtualExerciseAsset = listWatchfaceConfigAssets(
  details,
  undefined,
  ["exercise"]
).find(({ id }) => id === "config:control_exercise_icon");
assert.equal(virtualExerciseAsset?.label, "Control Exercise");
assert.equal(virtualExerciseAsset?.source, null);
assert.match(
  virtualExerciseAsset?.relativePath ?? "",
  /^studio\/.+\/00\.png$/,
  "an enabled injected selectable should expose an editable virtual icon row"
);
const exerciseDetails = applyConfigOverridesToDetails(
  details,
  buildControlComplicationConfigurationOverrides(details, {
    controlComplicationEnabled: { exercise: true }
  })
);
const exerciseIconOverrides = buildWatchfaceConfigAssetOverrides(
  exerciseDetails,
  {
    "config:control_exercise_icon": {
      enabled: true,
      nativeSize: true,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 32,
        height: 32
      }
    }
  }
);
for (const candidate of details.resolutions) {
  const override = exerciseIconOverrides.find(
    ({ path }) => path === `${candidate.directory}/config.txt`
  );
  assert.match(
    override?.values.control_exercise_icon ?? "",
    /^studio\\.+\\00\.png$/,
    "a custom icon for an injected selectable should add its config path"
  );
  assert.match(
    override?.values.control_exercise_icon_pos ?? "",
    /^\{\d+,\d+\}$/,
    "a custom icon for an injected selectable should receive an editable position"
  );
}
const positionedVirtualExercise = buildControlIconPositionOverrides(
  applyConfigOverridesToDetails(exerciseDetails, exerciseIconOverrides),
  { exercise: { dx: 10, dy: -6 } }
);
assert.deepEqual(
  positionedVirtualExercise.map(({ values }) => values.control_exercise_icon_pos),
  ["{88,-3}", "{170,-6}"],
  "an imported virtual selectable icon should participate in position editing"
);
const finalVirtualExerciseVisibility =
  buildDisabledWatchfaceConfigAssetOverrides(exerciseDetails, {
    "config:control_exercise_icon": {
      enabled: true,
      nativeSize: true,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 32,
        height: 32
      }
    }
  });
assert.deepEqual(
  finalVirtualExerciseVisibility,
  [],
  "the final visibility safeguard must not restore a virtual icon's fallback position"
);
const pace4ExerciseExportDetails = {
  archiveId: "pace4-exercise-export",
  resolutions: [
    {
      directory: "watchface_390x390",
      width: 390,
      height: 390,
      config: { rect_control1_pos: "{140,-246}" },
      aodConfig: {},
      spriteFolders: [],
      icons: []
    },
    {
      directory: "watchface_800x800",
      width: 800,
      height: 800,
      config: { rect_control1_pos: "{286,-504}" },
      aodConfig: {},
      spriteFolders: [],
      icons: []
    }
  ]
};
const pace4MovedExerciseOverrides = rebaseNegativeControlChildren(
  pace4ExerciseExportDetails,
  [
    {
      path: "watchface_390x390/config.txt",
      values: {
        rect_control1_pos: "{120,-231}",
        control_step_icon_pos: "{153,300}",
        control_step_rect: "{166,349,248,375,hcenter|vcenter}",
        control_exercise_hour_rect: "{166,349,204,375,hcenter|vcenter}",
        control_exercise_minute_rect: "{210,349,248,375,hcenter|vcenter}",
        control_exercise_icon_pos: "{135,351}"
      }
    },
    {
      path: "watchface_800x800/config.txt",
      values: {
        rect_control1_pos: "{246,-473}",
        control_step_icon_pos: "{313,615}",
        control_step_rect: "{340,716,510,770,hcenter|vcenter}",
        control_exercise_hour_rect: "{340,716,418,770,hcenter|vcenter}",
        control_exercise_minute_rect: "{432,716,510,770,hcenter|vcenter}",
        control_exercise_icon_pos: "{276,720}"
      }
    }
  ]
);
assert.equal(
  pace4MovedExerciseOverrides.find(({ path }) =>
    path === "watchface_390x390/config.txt"
  )?.values.control_exercise_icon_pos,
  "{135,120}"
);
assert.equal(
  pace4MovedExerciseOverrides.find(({ path }) =>
    path === "watchface_800x800/config.txt"
  )?.values.control_exercise_icon_pos,
  "{276,247}",
  "PACE 4 Exercise movement must survive shared-origin rebasing at every resolution"
);

const disabledSteps = buildControlComplicationConfigurationOverrides(details, {
  controlComplicationEnabled: { steps: false }
});
for (const candidate of details.resolutions) {
  const override = disabledSteps.find(
    ({ path }) => path === `${candidate.directory}/config.txt`
  );
  for (const key of Object.keys(candidate.config).filter((key) =>
    key.startsWith("control_step_")
  )) {
    assert.equal(
      override?.values[key],
      "__COROSLINK_DELETE_CONFIG_KEY__",
      "turning off a selectable should delete every related config field"
    );
  }
}
for (const override of buildDisabledControlComplicationOverrides(details, {
  controlComplicationEnabled: { steps: false }
})) {
  assert.ok(
    Object.values(override.values).every(
      (value) => value === "__COROSLINK_DELETE_CONFIG_KEY__"
    ),
    "the final cleanup pass must contain deletions only"
  );
}

assert.deepEqual(
  parseWatchfaceConfigText(
    "// note\r\n[watchface_id]=0x26\r\n[background_icon]=background.png\r\n"
  ),
  {
    watchface_id: "0x26",
    background_icon: "background.png"
  },
  "raw config text parsing should ignore comments and keep key values"
);
const editedDetails = applyConfigTextEditsToDetails(details, {
  "watchface_416x416/AODconfig.txt":
    "[watchface_id]=0x3B9ACE60\r\n[background_icon]=a\\icon\\aod-background.png\r\n"
});
assert.equal(
  editedDetails.resolutions[0]?.aodConfig.watchface_id,
  "0x3B9ACE60",
  "raw AOD text edits should update aodConfig maps used by preview"
);
assert.equal(
  editedDetails.resolutions[0]?.config.background_icon,
  details.resolutions[0]?.config.background_icon,
  "AOD text edits must not rewrite the current config map"
);

const monthLabelResolution = resolution(800, 44, 64);
monthLabelResolution.config.english_date_month_rect =
  "{283,573,283,573,hcenter|vcenter}";
monthLabelResolution.config.english_date_month_font = "english_month";
monthLabelResolution.spriteFolders.push({
  folder: "english_month",
  kind: "month",
  aod: false,
  files: Array.from({ length: 12 }, (_, month) => ({
    path: `${monthLabelResolution.directory}/english_month/${String(month).padStart(2, "0")}.png`,
    width: 51,
    height: 26
  }))
});
const monthLabelStyle = {
  scale: 1,
  rasterFont: {
    label: "Month labels",
    dataUrl: "data:image/png;base64,AA==",
    glyphs: "",
    columns: 1,
    sprites: { JAN: "data:image/png;base64,AA==" },
    spriteSizes: { JAN: { width: 73, height: 29 } },
    tint: false
  }
};
assert.deepEqual(
  dateSpriteCanvasSize(monthLabelResolution, "dateMonth", monthLabelStyle, 1),
  { width: 73, height: 29, native: true },
  "12-sprite month folders should resolve JAN from firmware slot 01"
);
assert.equal(
  removeWatchfaceDateFontOverride({
    scale: 1,
    fontFamily: "Fixture Sans",
    letterSpacing: 0.08,
    nativeSize: true
  }),
  undefined,
  "restoring a rasterized weekday font should remove its inert style entry"
);
assert.deepEqual(
  removeWatchfaceDateFontOverride({
    scale: 1.25,
    color: "#44ccaa",
    fontFamily: "Fixture Sans",
    rasterFont: monthLabelStyle.rasterFont,
    nativeSize: true,
    monthFormat: "labels"
  }),
  {
    scale: 1.25,
    color: "#44ccaa"
  },
  "font reset should preserve independent artwork edits while clearing raster sizing"
);
assert.equal(
  buildDateStyleOverrides(
    { archiveId: "month-labels", resolutions: [monthLabelResolution] },
    { dateMonth: monthLabelStyle }
  )[0]?.values.english_date_month_rect,
  "{247,559,320,588,hcenter|vcenter}",
  "single-image month rectangles should follow one native PNG, not two digits"
);
assert.deepEqual(
  computeLayoutGroupBounds(monthLabelResolution).find(
    (entry) => entry.id === "dateMonth"
  ),
  {
    id: "dateMonth",
    label: "Date month",
    x0: 257.5,
    y0: 560,
    x1: 308.5,
    y1: 586
  },
  "point month rects should expose the full JAN–DEC sprite bounds in Studio"
);

const autoTimeResolution = resolution(240, 12, 20);
Object.assign(autoTimeResolution.config, {
  watchface_time_format: "1",
  autoalign_time_rect: "{60,80,180,120,hcenter|vcenter}",
  autoalign_time_font: "13x19",
  autoalign_time_font_color: "",
  autoalign_time_colon_icon: "icon\\colon.png"
});
const autoTimeDetails = {
  archiveId: "auto-time",
  resolutions: [autoTimeResolution]
};
assert.equal(hasAutoAlignedTime(autoTimeResolution), true);
assert.deepEqual(
  computeLayoutGroupBounds(autoTimeResolution).find(({ id }) => id === "autoTime"),
  { id: "autoTime", label: "Time", x0: 60, y0: 80, x1: 180, y1: 120 },
  "Auto-aligned time should be one movable editor layer"
);
assert.deepEqual(
  buildTimeStyleOverrides(
    autoTimeDetails,
    { autoTime: { color: "#12abef", scale: 1.5 } },
    true
  )[0],
  {
    path: "watchface_240x240/config.txt",
    values: {
      autoalign_time_rect: "{30,70,210,130,hcenter|vcenter}",
      autoalign_time_font: "cl_auto_time"
    }
  },
  "Auto-aligned time styling should scale its shared rect and use an isolated font folder"
);
assert.deepEqual(
  buildLayoutOverrides(autoTimeDetails, { autoTime: { dx: 7, dy: -5 } })[0],
  {
    path: "watchface_240x240/config.txt",
    values: {
      autoalign_time_rect: "{67,75,187,115,hcenter|vcenter}"
    }
  },
  "Dragging auto-aligned time should move its shared firmware rect"
);
assert.equal(
  computeLayoutGroupBounds(autoTimeResolution).some(
    ({ id }) => id === "hours" || id === "minutes"
  ),
  false,
  "Inactive individually positioned time keys must not create duplicate layers"
);
const separateTimeOverrides = buildSeparateTimeOverrides(autoTimeDetails, true);
assert.deepEqual(separateTimeOverrides[0], {
  path: "watchface_240x240/config.txt",
  values: {
    watchface_time_format: "0",
    time_hour_high_pos: "{91,90}",
    time_hour_high_font: "13x19",
    time_hour_low_pos: "{103,90}",
    time_hour_low_font: "13x19",
    time_minute_high_pos: "{125,90}",
    time_minute_high_font: "13x19",
    time_minute_low_pos: "{137,90}",
    time_minute_low_font: "13x19",
    colon_icon: "icon\\colon.png"
  }
});
const separateTimeResolution = applyConfigOverridesToDetails(
  autoTimeDetails,
  separateTimeOverrides
).resolutions[0];
assert.equal(hasAutoAlignedTime(separateTimeResolution), false);
assert.deepEqual(
  computeLayoutGroupBounds(separateTimeResolution)
    .filter(({ id }) => id === "hours" || id === "minutes")
    .map(({ id }) => id),
  ["hours", "minutes"],
  "Converted time should expose independent hour and minute layers"
);
assert.equal(hasWatchfaceAod(details), true);
assert.equal(
  hasWatchfaceAod({
    archiveId: "no-aod",
    resolutions: [{ ...resolution(260, 8, 12), aodConfig: {} }]
  }),
  false
);
const hiddenAodDetails = applyConfigOverridesToDetails(details, [
  {
    path: "watchface_800x800/AODconfig.txt",
    values: { background_icon: "" }
  }
]);
assert.equal(
  hiddenAodDetails.resolutions[1].aodConfig.background_icon,
  "",
  "AOD overrides should be reflected in preview details"
);
assert.equal(
  hiddenAodDetails.resolutions[1].config.background_icon,
  "background.png",
  "AOD preview overrides must not alter the current-face config"
);
const aodPreviewDetails = detailsForPreviewMode(hiddenAodDetails, "aod");
assert.equal(aodPreviewDetails.resolutions[1].config.background_icon, "");
assert.equal(
  detailsForPreviewMode(details, "current"),
  details,
  "The current preview should retain the original details object"
);

const sharedModeResolution = resolution(260, 8, 12);
sharedModeResolution.config.time_hour_high_font = "shared_digits";
sharedModeResolution.aodConfig = {
  time_hour_high_pos: "{20,30}",
  time_hour_high_font: "shared_digits"
};
sharedModeResolution.spriteFolders = [{
  folder: "shared_digits",
  kind: "digits",
  aod: false,
  files: digitFiles(8, 12, sharedModeResolution.directory, "shared_digits")
}];
const sharedModeDetails = {
  archiveId: "shared-mode-assets",
  resolutions: [sharedModeResolution]
};
const isolatedAodDetails = detailsForCompositionMode(
  sharedModeDetails,
  "aod"
);
assert.equal(
  isolatedAodDetails.resolutions[0].config.time_hour_high_font,
  "shared_digits"
);
assert.deepEqual(isolatedAodDetails.resolutions[0].aodConfig, {});
assert.equal(isolatedAodDetails.resolutions[0].spriteFolders.length, 1);
assert.equal(
  isolatedAodDetails.resolutions[0].spriteFolders[0].aod,
  false,
  "independent AOD colors must not be dimmed a second time"
);
const isolatedAodComposition = retargetWatchfaceCompositionToAod(
  isolatedAodDetails,
  {
    assetReplacements: [{
      path: `${sharedModeResolution.directory}/shared_digits/00.png`,
      dataUrl: "aod-zero"
    }],
    configOverrides: [{
      path: `${sharedModeResolution.directory}/config.txt`,
      values: { time_hour_high_pos: "{24,34}" }
    }]
  }
);
assert.match(
  isolatedAodComposition.assetReplacements[0].path,
  /\/studio\/aod_shared_digits_[a-z0-9]+\/00\.png$/
);
assert.equal(
  isolatedAodComposition.assetReplacements[0].create,
  true
);
assert.ok(
  isolatedAodComposition.configOverrides.every((override) =>
    override.path.endsWith("/AODconfig.txt")
  )
);
assert.match(
  isolatedAodComposition.configOverrides
    .flatMap((override) => Object.values(override.values))
    .find((value) => value.includes("aod_shared_digits")),
  /^studio\\aod_shared_digits_[a-z0-9]+$/
);
const isolatedCurrentComposition = retargetWatchfaceCompositionToCurrent(
  detailsForCompositionMode(sharedModeDetails, "current"),
  {
    assetReplacements: [{
      path: `${sharedModeResolution.directory}/shared_digits/00.png`,
      dataUrl: "current-zero"
    }],
    configOverrides: []
  }
);
assert.match(
  isolatedCurrentComposition.assetReplacements[0].path,
  /\/studio\/current_shared_digits_[a-z0-9]+\/00\.png$/
);
assert.ok(
  isolatedCurrentComposition.configOverrides.every((override) =>
    override.path.endsWith("/config.txt")
  )
);

const legacyModeRoot = {
  version: 1,
  accentColor: "#51e0b5",
  digitColor: "#ffffff",
  fontFamily: "",
  tintLabels: false,
  tintIcons: false,
  metricStyles: {},
  timeStyles: {},
  dateStyles: {},
  layerColors: {},
  effectStyles: [],
  layerEffects: {},
  configAssetOverrides: {
    "aod:background_icon": { enabled: false }
  },
  layoutOffsets: {}
};
const materializedAod = materializeLegacyAodDesign(
  legacyModeRoot,
  null
);
assert.equal(materializedAod.digitColor, "#8c8c8c");
assert.equal(
  materializedAod.configAssetOverrides["config:background_icon"].enabled,
  false
);
const independentModeRoot = {
  ...legacyModeRoot,
  modeDesigns: { aod: materializedAod }
};
const activeAod = resolveWatchfaceModeDesign(independentModeRoot, "aod");
const movedAodRoot = writeWatchfaceModeDesign(
  independentModeRoot,
  "aod",
  {
    ...activeAod,
    layoutOffsets: { hours: { dx: 5, dy: 7 } }
  }
);
assert.deepEqual(movedAodRoot.layoutOffsets, {});
assert.deepEqual(
  movedAodRoot.modeDesigns.aod.layoutOffsets.hours,
  { dx: 5, dy: 7 }
);
assert.equal(movedAodRoot.modeDesigns.aod.backgroundEdited, undefined);
const fadedAodRoot = writeWatchfaceModeDesign(
  movedAodRoot,
  "aod",
  {
    ...resolveWatchfaceModeDesign(movedAodRoot, "aod"),
    layerOpacities: { hours: 0.35 }
  }
);
assert.equal(fadedAodRoot.layerOpacities, undefined);
assert.equal(fadedAodRoot.modeDesigns.aod.layerOpacities.hours, 0.35);
const strokedAodRoot = writeWatchfaceModeDesign(
  fadedAodRoot,
  "aod",
  {
    ...resolveWatchfaceModeDesign(fadedAodRoot, "aod"),
    layerStrokes: {
      hours: [{
        id: "aod-stroke",
        enabled: true,
        paint: { kind: "solid", color: "#ff0000" },
        opacity: 1,
        position: "outside",
        weight: 2
      }]
    }
  }
);
assert.equal(strokedAodRoot.layerStrokes, undefined);
assert.equal(
  strokedAodRoot.modeDesigns.aod.layerStrokes.hours[0].id,
  "aod-stroke"
);
const repaintedAodRoot = writeWatchfaceModeDesign(
  strokedAodRoot,
  "aod",
  { ...resolveWatchfaceModeDesign(strokedAodRoot, "aod"), backgroundColor: "#112233" }
);
assert.equal(repaintedAodRoot.modeDesigns.aod.backgroundEdited, true);

const analogResolution = resolution(260, 8, 12);
analogResolution.config.time_center_pos = "{130,130}";
Object.assign(analogResolution.config, {
  time_hour_icon: "icon\\hour.png",
  time_minute_icon: "icon\\minute.png",
  time_center_polygon_icon1: "center-behind.png",
  time_second_icon: "icon\\second.png",
  time_center_polygon_icon2: "center-top.png"
});
analogResolution.icons.push(
  { path: `${analogResolution.directory}/icon/hour.png`, width: 40, height: 260 },
  { path: `${analogResolution.directory}/icon/minute.png`, width: 40, height: 260 },
  { path: `${analogResolution.directory}/center-behind.png`, width: 72, height: 260 },
  { path: `${analogResolution.directory}/icon/second.png`, width: 20, height: 260 },
  { path: `${analogResolution.directory}/center-top.png`, width: 30, height: 30 }
);
const analogLayers = getWatchfaceAnalogPreviewLayers(
  analogResolution,
  new Date(2026, 0, 1, 3, 15, 30)
);
assert.deepEqual(
  analogLayers.map(({ configKey }) => configKey),
  [
    "time_hour_icon",
    "time_minute_icon",
    "time_center_polygon_icon1",
    "time_second_icon",
    "time_center_polygon_icon2"
  ],
  "Analog assets should follow the firmware hand and center-overlay stack"
);
assert.deepEqual(
  analogLayers.map(({ center }) => center),
  Array.from({ length: 5 }, () => ({ x: 130, y: 130 })),
  "Every analog asset should share time_center_pos"
);
assert.equal(analogLayers[0].rotationDegrees, 97.75);
assert.equal(analogLayers[1].rotationDegrees, 93);
assert.equal(analogLayers[2].rotationDegrees, null);
assert.equal(analogLayers[3].rotationDegrees, 180);
assert.equal(analogLayers[4].rotationDegrees, null);

const configAssets = listWatchfaceConfigAssets(details);
assert.deepEqual(
  configAssets.map(({ id }) => id),
  [
    "config:am_icon",
    "config:background_icon",
    "config:control_colon_icon",
    "config:arc_cut_icon",
    "config:pm_icon",
    "config:colon_icon",
    "config:watchface_thmb_icon",
    "aod:background_icon"
  ],
  "Every direct PNG reference should appear once per config key and scope"
);
assert.equal(
  configAssets.find(({ id }) => id === "config:colon_icon")?.archivePath,
  "watchface_800x800/icon/colon.png"
);
assert.equal(
  configAssets.find(({ id }) => id === "config:control_colon_icon")?.archivePath,
  "watchface_800x800/icon/colon.png",
  "Shared source files should remain separate editable config entries"
);
const statusPreviewResolution = {
  ...resolution(800, 24, 38),
  config: {
    ...resolution(800, 24, 38).config,
    rect_control1_pos: "{123,551}",
    control_bluetooth_icon_pos: "{3,0}",
    control_bluetooth_off_icon: "icon\\nobt.png",
    control_no_disturb_icon_pos: "{67,0}",
    control_no_disturb_on_icon: "icon\\noxx.png"
  },
  icons: [
    ...resolution(800, 24, 38).icons,
    {
      path: "watchface_800x800/icon/nobt.png",
      width: 42,
      height: 42
    },
    {
      path: "watchface_800x800/icon/noxx.png",
      width: 42,
      height: 42
    }
  ]
};
assert.deepEqual(
  getWatchfaceControlStatusPreviewLayers(statusPreviewResolution).map(
    ({ configKey, position }) => ({ configKey, position })
  ),
  [
    {
      configKey: "control_bluetooth_off_icon",
      position: { x: 126, y: 551 }
    },
    {
      configKey: "control_no_disturb_on_icon",
      position: { x: 190, y: 551 }
    }
  ],
  "Bluetooth-off and Do Not Disturb-on should preview at their control-relative positions"
);
assert.deepEqual(
  computeLayoutGroupBounds(statusPreviewResolution)
    .filter(({ id }) => id === "bluetoothOff" || id === "doNotDisturbOn")
    .map(({ id, x0, y0, x1, y1 }) => ({ id, x0, y0, x1, y1 })),
  [
    {
      id: "bluetoothOff",
      x0: 126,
      y0: 551,
      x1: 168,
      y1: 593
    },
    {
      id: "doNotDisturbOn",
      x0: 190,
      y0: 551,
      x1: 232,
      y1: 593
    }
  ],
  "both status icons should expose independent hit-test bounds"
);
assert.deepEqual(
  buildLayoutOverrides(
    {
      archiveId: "control-status",
      resolutions: [statusPreviewResolution]
    },
    {
      bluetoothOff: { dx: 20, dy: -10 }
    }
  )[0]?.values,
  {
    control_bluetooth_icon_pos: "{23,-10}"
  },
  "status-icon movement should persist through the exported config position"
);
const standaloneStatusResolution = {
  ...statusPreviewResolution,
  config: {
    ...statusPreviewResolution.config,
    bluetooth_icon_pos: "{69,68}",
    bluetooth_off_icon: "icon\\nobt.png",
    no_disturb_icon_pos: "{313,68}",
    no_disturb_on_icon: "icon\\noxx.png"
  }
};
assert.deepEqual(
  getWatchfaceControlStatusPreviewLayers(standaloneStatusResolution)
    .filter(({ controlRelative }) => !controlRelative)
    .map(({ configKey, position }) => ({ configKey, position })),
  [
    { configKey: "bluetooth_off_icon", position: { x: 69, y: 68 } },
    { configKey: "no_disturb_on_icon", position: { x: 313, y: 68 } }
  ],
  "standalone status icons should preview at absolute screen positions"
);
assert.deepEqual(
  buildLayoutOverrides(
    {
      archiveId: "standalone-status",
      resolutions: [standaloneStatusResolution]
    },
    {
      bluetoothStatus: { dx: -9, dy: 12 }
    }
  )[0]?.values,
  {
    bluetooth_icon_pos: "{60,80}"
  },
  "standalone status movement should shift the absolute position key"
);
const hiddenBluetoothStatusDetails = applyConfigOverridesToDetails(
  {
    archiveId: "control-status",
    resolutions: [statusPreviewResolution]
  },
  buildWatchfaceConfigAssetOverrides(
    {
      archiveId: "control-status",
      resolutions: [statusPreviewResolution]
    },
    {
      "config:control_bluetooth_off_icon": { enabled: false }
    }
  )
);
assert.deepEqual(
  getWatchfaceControlStatusPreviewLayers(
    hiddenBluetoothStatusDetails.resolutions[0]
  ).map(({ configKey }) => configKey),
  ["control_no_disturb_on_icon"],
  "the existing config-asset visibility toggle should hide a status preview"
);
assert.equal(
  buildWatchfaceConfigAssetOverrides(
    {
      archiveId: "control-status",
      resolutions: [statusPreviewResolution]
    },
    {
      "config:control_bluetooth_off_icon": { enabled: false }
    }
  )[0]?.values.control_bluetooth_off_icon,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "disabling a direct config asset should delete its declaration"
);
const completeControlStatusResolution = {
  ...statusPreviewResolution,
  config: {
    ...statusPreviewResolution.config,
    control_bluetooth_on_icon: "icon\\bton.png",
    control_no_disturb_off_icon: "icon\\dndoff.png"
  },
  icons: [
    ...statusPreviewResolution.icons,
    {
      path: "watchface_800x800/icon/bton.png",
      width: 42,
      height: 42
    },
    {
      path: "watchface_800x800/icon/dndoff.png",
      width: 42,
      height: 42
    }
  ]
};
assert.deepEqual(
  getWatchfaceControlStatusPreviewLayers(completeControlStatusResolution).map(
    ({ layoutGroupId, configKey }) => ({ layoutGroupId, configKey })
  ),
  [
    {
      layoutGroupId: "bluetoothOff",
      configKey: "control_bluetooth_off_icon"
    },
    {
      layoutGroupId: "bluetoothOff",
      configKey: "control_bluetooth_on_icon"
    },
    {
      layoutGroupId: "doNotDisturbOn",
      configKey: "control_no_disturb_on_icon"
    },
    {
      layoutGroupId: "doNotDisturbOn",
      configKey: "control_no_disturb_off_icon"
    }
  ],
  "all configured Bluetooth and Do Not Disturb control-slot states should be detected"
);
const replacement = {
  dataUrl: "data:image/png;base64,AA==",
  width: 32,
  height: 48
};
const detailsWithControlIcon = {
  ...details,
  resolutions: details.resolutions.map((candidate) => ({
    ...candidate,
    config: {
      ...candidate.config,
      control_hr_icon: "icon\\hr.png"
    },
    icons: [
      ...candidate.icons,
      {
        path: `${candidate.directory}/icon/hr.png`,
        width: Math.max(8, Math.round(candidate.width * 0.04625)),
        height: Math.max(8, Math.round(candidate.width * 0.04625))
      }
    ]
  }))
};
const configAssetOverrides = buildWatchfaceConfigAssetOverrides(
  detailsWithControlIcon,
  {
    "config:colon_icon": { enabled: false },
    "config:control_colon_icon": { enabled: true, replacement },
    "config:control_hr_icon": { enabled: true, replacement },
    "config:background_icon": { enabled: true, replacement },
    "aod:background_icon": { enabled: false }
  },
  true
);
assert.equal(configAssetSupportsNativeSize("control_hr_icon"), true);
assert.equal(configAssetSupportsNativeSize("control_colon_icon"), false);
assert.deepEqual(
  configAssetCanvasSize(
    "control_hr_icon",
    {
      nativeSize: true,
      scale: 1.5,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 96,
        height: 48
      }
    },
    { width: 37, height: 37 }
  ),
  { width: 144, height: 72, native: true },
  "selectable control icons should be able to escape the template PNG canvas"
);
assert.deepEqual(
  configAssetCanvasSize(
    "control_hr_icon",
    {
      nativeSize: true,
      scale: 6,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 96,
        height: 48
      }
    },
    { width: 37, height: 37 }
  ),
  { width: 576, height: 288, native: true },
  "native control icon scale should not have a fixed upper limit"
);
assert.deepEqual(
  scaledBatterySpriteCanvasSize(48, 24, 24, 24, 6),
  { width: 144, height: 72 },
  "battery sprite scale should not have a fixed upper limit"
);
assert.deepEqual(
  configAssetCanvasSize(
    "control_hr_icon",
    {
      nativeSize: true,
      scale: 1.5,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 96,
        height: 48
      }
    },
    { width: 37, height: 37 },
    416 / 800
  ),
  { width: 75, height: 37, native: true },
  "native control icons should scale master-authored dimensions per device tree"
);
assert.deepEqual(
  configAssetCanvasSize(
    "control_colon_icon",
    {
      nativeSize: true,
      scale: 2,
      replacement: {
        dataUrl: "data:image/png;base64,AA==",
        width: 96,
        height: 48
      }
    },
    { width: 20, height: 32 }
  ),
  { width: 20, height: 32, native: false },
  "unsafe direct assets should retain their firmware canvas"
);
const scaledBatteryOverrides = buildWatchfaceConfigAssetOverrides(details, {
  "config:battery_icon": { enabled: true, scale: 2 }
});
assert.equal(
  scaledBatteryOverrides.find(({ path }) => path.includes("416x416")),
  undefined,
  "Battery scaling must not alter the firmware position"
);
const detailsWithoutBatteryIcon = {
  ...details,
  resolutions: details.resolutions.map((candidate) => {
    const config = { ...candidate.config };
    delete config.battery_icon_pos;
    delete config.battery_icon_dir;
    return {
      ...candidate,
      config,
      spriteFolders: candidate.spriteFolders.filter(
        (folder) => folder.folder !== "battery"
      )
    };
  })
};
for (const resolution of detailsWithoutBatteryIcon.resolutions) {
  resolution.config.control_battery_icon_dir = "battery";
}
const createdBatteryIconOverrides = buildWatchfaceConfigAssetOverrides(
  detailsWithoutBatteryIcon,
  {
    "config:battery_icon": {
      stateReplacements: {
        "0": { dataUrl: "data:image/png;base64,AA==", width: 48, height: 24 }
      }
    }
  }
);
const createdFullBatteryIcon = createdBatteryIconOverrides.find(({ path }) =>
  path.includes("800x800")
);
assert.equal(createdFullBatteryIcon?.values.battery_icon_dir, "cl_battery_icon");
assert.equal(createdFullBatteryIcon?.values.battery_icon_pos, "{376,644}");
assert.equal(
  createdBatteryIconOverrides.find(({ path }) => path.includes("416x416"))
    ?.values.battery_icon_pos,
  "{196,335}"
);
const controlBatteryDetails = {
  ...details,
  resolutions: details.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      control_battery_icon_dir: "battery",
      control_battery_icon_pos: "{12,8}",
      control_battery_level_rect: "{30,0,80,24,hcenter|vcenter}",
      control_battery_level_font: "13x19",
      control_bluetooth_icon_pos: "{3,0}",
      control_bluetooth_off_icon: "icon\\nobt.png",
      control_no_disturb_icon_pos: "{67,0}",
      control_no_disturb_on_icon: "icon\\noxx.png"
    },
    aodConfig: {
      ...resolution.aodConfig,
      control_battery_icon_pos: "",
      control_battery_icon_dir: "",
      control_battery_level_rect: "",
      control_battery_level_font: "",
      control_battery_level_font_color: "",
      control_bluetooth_icon_pos: "",
      control_bluetooth_off_icon: "",
      control_no_disturb_icon_pos: "",
      control_no_disturb_on_icon: ""
    }
  }))
};
const separatedBatteryAssetOverrides = buildWatchfaceConfigAssetOverrides(
  controlBatteryDetails,
  {
    "config:battery_icon": {
      stateReplacements: {
        "0": {
          dataUrl: "data:image/png;base64,W48H24",
          width: 48,
          height: 24
        }
      }
    },
    "config:control_battery_icon": {
      stateReplacements: {
        "0": {
          dataUrl: "data:image/png;base64,W36H18",
          width: 36,
          height: 18
        }
      }
    }
  }
);
for (const resolution of controlBatteryDetails.resolutions) {
  const override = separatedBatteryAssetOverrides.find(
    ({ path }) => path === `${resolution.directory}/config.txt`
  );
  assert.equal(
    override?.values.battery_icon_dir,
    "cl_battery_icon",
    "a customized fixed battery must leave the shared control folder untouched"
  );
  assert.equal(
    override?.values.control_battery_icon_dir,
    "cl_control_battery_icon",
    "the selectable Battery icon must export through its own folder"
  );
}
const hiddenControlBattery = buildControlBatteryVisibilityOverrides(
  controlBatteryDetails,
  false
);
assert.equal(hasControlBattery(controlBatteryDetails), true);
assert.equal(hiddenControlBattery.length, details.resolutions.length * 2);
for (const override of hiddenControlBattery) {
  assert.equal(
    override.values.control_battery_icon_dir,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_battery_icon_pos,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_battery_level_rect,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_battery_level_font,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_bluetooth_icon_pos,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_bluetooth_off_icon,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_no_disturb_icon_pos,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.equal(
    override.values.control_no_disturb_on_icon,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
}
assert.deepEqual(
  hiddenControlBattery.map(({ path }) => path),
  details.resolutions.flatMap(({ directory }) => [
    `${directory}/config.txt`,
    `${directory}/AODconfig.txt`
  ]),
  "disabling selectable Battery should remove its declarations and coupled control-status keys from current and AOD configs"
);
assert.deepEqual(buildControlBatteryVisibilityOverrides(details, true), []);
const lowPowerBatteryDetails = {
  ...controlBatteryDetails,
  resolutions: controlBatteryDetails.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      battery_icon_lowpower: "a\\battery_low"
    }
  }))
};
for (const override of buildControlBatteryVisibilityOverrides(
  lowPowerBatteryDetails,
  false
).filter(({ path }) => path.endsWith("/config.txt"))) {
  assert.equal(
    override.values.battery_icon_lowpower,
    "__COROSLINK_DELETE_CONFIG_KEY__",
    "disabling selectable Battery should drop the low-power battery icon from the current face"
  );
}
const aodBatteryDetails = {
  ...controlBatteryDetails,
  resolutions: controlBatteryDetails.resolutions.map((resolution) => ({
    ...resolution,
    aodConfig: {
      ...resolution.aodConfig,
      battery_icon_pos: "{20,30}",
      battery_icon_dir: "a\\battery",
      battery_level_rect: "{40,30,90,54,hcenter|vcenter}",
      battery_level_font: "a\\13x19"
    }
  }))
};
for (const override of buildControlBatteryVisibilityOverrides(
  aodBatteryDetails,
  false
)) {
  const isAod = override.path.endsWith("AODconfig.txt");
  for (const key of [
    "battery_icon_pos",
    "battery_icon_dir",
    "battery_level_rect",
    "battery_level_font"
  ]) {
    assert.equal(
      override.values[key],
      isAod ? "__COROSLINK_DELETE_CONFIG_KEY__" : undefined,
      "hiding selectable Battery should drop fixed battery keys from the AOD only"
    );
  }
}
const reopenedDisabledBatteryDetails = {
  ...details,
  resolutions: details.resolutions.map((resolution) => ({
    ...resolution,
    aodConfig: {
      ...resolution.aodConfig,
      control_battery_icon_pos: "",
      control_battery_icon_dir: "",
      control_battery_level_rect: "",
      control_battery_level_font: "",
      control_battery_level_font_color: ""
    }
  }))
};
assert.equal(hasControlBattery(reopenedDisabledBatteryDetails), false);
assert.equal(
  buildControlBatteryVisibilityOverrides(
    reopenedDisabledBatteryDetails,
    undefined
  ).length,
  details.resolutions.length,
  "a reopened template without current-face Battery should clean stale AOD declarations"
);
const sunControlDetails = {
  ...details,
  resolutions: details.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      control_sunrise_icon: "icon\\sunrise.png",
      control_sunrise_hour_rect: "{30,0,60,24,hcenter|vcenter}",
      control_sunrise_minute_rect: "{70,0,100,24,hcenter|vcenter}",
      control_sunrise_font: "13x19",
      control_sunset_icon: "icon\\sunset.png",
      control_sunset_hour_rect: "{30,0,60,24,hcenter|vcenter}",
      control_sunset_minute_rect: "{70,0,100,24,hcenter|vcenter}",
      control_sunset_font: "13x19",
      control_floor_icon: "icon\\floor.png",
      control_floor_rect: "{30,0,80,24,hcenter|vcenter}",
      control_floor_font: "13x19",
      control_temperature_rect: "{30,0,80,24,hcenter|vcenter}",
      control_temperature_font: "13x19",
      control_temperature_negative_sign_icon: "icon\\negative.png"
    },
    aodConfig: {
      ...resolution.aodConfig,
      control_sunrise_hour_rect: "",
      control_sunset_hour_rect: ""
    }
  }))
};
assert.deepEqual(
  buildControlComplicationVisibilityOverrides(sunControlDetails, {}),
  [],
  "sun complications stay untouched unless explicitly excluded"
);
const hiddenSunset = buildControlComplicationVisibilityOverrides(sunControlDetails, {
  controlSunsetEnabled: false
});
assert.deepEqual(
  hiddenSunset.map(({ path }) => path),
  sunControlDetails.resolutions.flatMap(({ directory }) => [
    `${directory}/config.txt`,
    `${directory}/AODconfig.txt`
  ]),
  "excluding Sunset should clean both current and AOD configs"
);
for (const override of hiddenSunset) {
  for (const key of Object.keys(override.values)) {
    assert.ok(
      key.startsWith("control_sunset_"),
      `only sunset keys may be deleted, saw ${key}`
    );
    assert.equal(override.values[key], "__COROSLINK_DELETE_CONFIG_KEY__");
  }
  if (override.path.endsWith("/config.txt")) {
    assert.equal(Object.keys(override.values).length, 4);
  }
}
const hiddenBothSuns = buildControlComplicationVisibilityOverrides(sunControlDetails, {
  controlSunriseEnabled: false,
  controlSunsetEnabled: false
});
for (const override of hiddenBothSuns) {
  if (!override.path.endsWith("/config.txt")) continue;
  assert.equal(
    Object.keys(override.values).length,
    8,
    "excluding both sun complications should delete every sunrise and sunset key"
  );
}
const hiddenFloor = buildControlComplicationVisibilityOverrides(
  sunControlDetails,
  { controlFloorEnabled: false }
);
for (const override of hiddenFloor) {
  assert.ok(
    override.path.endsWith("/config.txt"),
    "the fixture AOD has no floor keys, so only current configs are touched"
  );
  assert.deepEqual(
    Object.keys(override.values).sort(),
    ["control_floor_font", "control_floor_icon", "control_floor_rect"],
    "excluding Floors should delete exactly the floor keys"
  );
}
assert.equal(hiddenFloor.length, sunControlDetails.resolutions.length);
const hiddenTemperature = buildControlComplicationVisibilityOverrides(
  sunControlDetails,
  { controlTemperatureEnabled: false }
);
assert.equal(hiddenTemperature.length, sunControlDetails.resolutions.length);
for (const override of hiddenTemperature) {
  assert.ok(
    Object.keys(override.values).length >= 3 &&
      Object.keys(override.values).every((key) =>
        key.startsWith("control_temperature_")
      ),
    "excluding Temperature should delete exactly the control-temperature keys"
  );
}
const baseComplicationBounds = computeLayoutGroupBounds(
  details.resolutions.find(({ width }) => width === 800)
).find(({ id }) => id === "complication");
const scaledComplicationDetails = applyConfigOverridesToDetails(
  details,
  buildSelectableMetricStyleOverrides(
    details,
    { fontFamily: "Inter", scale: 2 },
    false
  )
);
const scaledComplicationBounds = computeLayoutGroupBounds(
  scaledComplicationDetails.resolutions.find(({ width }) => width === 800)
).find(({ id }) => id === "complication");
assert.ok(baseComplicationBounds && scaledComplicationBounds);
assert.ok(
  scaledComplicationBounds.x1 - scaledComplicationBounds.x0 >
    baseComplicationBounds.x1 - baseComplicationBounds.x0,
  "selectable style overrides should expand the geometry used by editor layers"
);
const farControlBatteryDetails = {
  ...controlBatteryDetails,
  resolutions: controlBatteryDetails.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      control_battery_icon_pos: `{${Math.round(resolution.width * 0.75)},0}`,
      control_battery_level_rect: `{${Math.round(resolution.width * 0.75)},0,${Math.round(resolution.width * 0.9)},24,hcenter|vcenter}`
    }
  }))
};
const visibleControlBatteryBounds = computeLayoutGroupBounds(
  farControlBatteryDetails.resolutions.find(({ width }) => width === 800)
).find(({ id }) => id === "complication");
const hiddenControlBatteryDetails = applyConfigOverridesToDetails(
  farControlBatteryDetails,
  buildControlBatteryVisibilityOverrides(farControlBatteryDetails, false)
);
const hiddenControlBatteryBounds = computeLayoutGroupBounds(
  hiddenControlBatteryDetails.resolutions.find(({ width }) => width === 800)
).find(({ id }) => id === "complication");
assert.ok(visibleControlBatteryBounds && hiddenControlBatteryBounds);
assert.ok(
  visibleControlBatteryBounds.x1 > hiddenControlBatteryBounds.x1,
  "deleted control-battery children should not remain in editor geometry"
);
const reopenedStudioBatteryDetails = {
  ...detailsWithoutBatteryIcon,
  resolutions: detailsWithoutBatteryIcon.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      battery_icon_pos: "{20,30}",
      battery_icon_dir: ""
    },
    spriteFolders: [
      ...resolution.spriteFolders,
      {
        folder: "cl_battery_icon",
        kind: "state",
        aod: false,
        files: [{
          path: `${resolution.directory}/cl_battery_icon/00.png`,
          width: 48,
          height: 24
        }]
      }
    ]
  }))
};
const reopenedStudioBatteryOverrides = buildWatchfaceConfigAssetOverrides(
  reopenedStudioBatteryDetails,
  {}
);
for (const override of reopenedStudioBatteryOverrides) {
  assert.equal(override.values.battery_icon_dir, "cl_battery_icon");
}
for (const override of configAssetOverrides.filter(({ path }) => /\/config\.txt$/i.test(path))) {
  assert.equal(
    override.values.colon_icon,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
  assert.match(override.values.control_colon_icon, /^studio\\config-control_colon_icon-/);
  assert.equal(
    Object.prototype.hasOwnProperty.call(override.values, "control_hr_icon"),
    false,
    "Live control icons must keep their firmware-native config paths"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(override.values, "background_icon"),
    false,
    "The composed background should keep using the archive's original background path"
  );
}
for (const override of configAssetOverrides.filter(({ path }) => /AODconfig\.txt$/i.test(path))) {
  assert.equal(
    override.values.background_icon,
    "__COROSLINK_DELETE_CONFIG_KEY__"
  );
}

assert.deepEqual(getAmPmCapability(details), {
  icon: {
    path: "watchface_800x800/icon/am.png",
    width: 64,
    height: 32
  },
  active: true,
  defaultPos: { x: 480, y: 100 }
});
const hiddenAmPm = buildAmPmOverrides(details, {
  enabled: false,
  x: 480,
  y: 100,
  scale: 1,
  color: "#ffffff"
});
assert.equal(hiddenAmPm.length, 2);
assert.deepEqual(
  hiddenAmPm.find((entry) => entry.path.includes("800x800"))?.values,
  { am_icon: "", pm_icon: "", am_pm_icon_pos: "" }
);
const positionedAmPm = buildAmPmOverrides(details, {
  enabled: true,
  x: 240,
  y: 50,
  scale: 1,
  color: "#ffffff"
});
assert.equal(
  positionedAmPm.find((entry) => entry.path.includes("416x416"))?.values
    .am_pm_icon_pos,
  "{125,26}"
);

assert.deepEqual(
  getFixedMetricCapabilities(details),
  [
    { id: "battery", label: "Battery data", active: false },
    { id: "heartRate", label: "Heart rate", active: false },
    { id: "steps", label: "Steps", active: false },
    { id: "calories", label: "Calories", active: false },
    { id: "elevation", label: "Elevation", active: false },
    { id: "temperature", label: "Temperature", active: false }
  ]
);
assert.deepEqual(
  getAvailableComplications(details).map(({ id }) => id),
  ["heartRate", "steps"],
  "the effective selector should contain only components with complete config"
);
const selectableStyleOverrides = buildSelectableMetricStyleOverrides(
  details,
  { fontFamily: "Inter", color: "#12abef", scale: 1.25 },
  true
);
const selectableFull = selectableStyleOverrides.find(({ path }) =>
  path.includes("800x800")
);
assert.equal(selectableFull?.values.control_hr_font, "cl_control");
assert.equal(selectableFull?.values.control_step_font, "cl_control");
assert.equal(selectableFull?.values.control_hr_font_color, "0x12ABEF");
assert.equal(
  selectableFull?.values.control_hr_rect,
  "{144,-8,304,72,hcenter|vcenter}"
);
const nativeSelectableStyle = buildSelectableMetricStyleOverrides(
  details,
  {
    scale: 1,
    nativeSize: true,
    rasterFont: {
      label: "Native selectable digits",
      dataUrl: "",
      glyphs: "",
      columns: 1,
      sprites: Object.fromEntries(
        Array.from({ length: 10 }, (_, digit) => [
          String(digit),
          "data:image/png;base64,AA=="
        ])
      ),
      spriteSizes: Object.fromEntries(
        Array.from({ length: 10 }, (_, digit) => [
          String(digit),
          { width: 31, height: 47 }
        ])
      ),
      tint: false
    }
  },
  true
);
assert.equal(
  nativeSelectableStyle.find(({ path }) => path.includes("800x800"))
    ?.values.control_hr_rect,
  "{178,9,271,56,hcenter|vcenter}",
  "native selectable digits should expand each value rectangle around its existing center"
);
assert.equal(
  nativeSelectableStyle.find(({ path }) => path.includes("416x416"))
    ?.values.control_hr_rect,
  "{93,5,141,29,hcenter|vcenter}",
  "imported selectable digit sizes should scale from master into device trees"
);

// A 390px AMOLED tree (PACE 4 class) must scale master-authored values by
// 390/800 exactly like the 416px tree scales by 416/800.
const pace4Details = {
  archiveId: "pace4-fixture",
  resolutions: [resolution(390, 21, 31), resolution(800, 44, 64)]
};
const pace4StatusDetails = {
  ...pace4Details,
  resolutions: pace4Details.resolutions.map((candidate) => {
    const compact = candidate.width === 390;
    return {
      ...candidate,
      config: {
        ...candidate.config,
        bluetooth_icon_pos: "",
        bluetooth_on_icon: "",
        bluetooth_off_icon: "",
        no_disturb_icon_pos: "",
        no_disturb_on_icon: "",
        no_disturb_off_icon: "",
        rect_control1_pos: compact ? "{117,346}" : "{241,709}",
        control_bluetooth_icon_pos: compact ? "{1,0}" : "{3,0}",
        control_bluetooth_off_icon: "icon\\nobt.png",
        control_no_disturb_icon_pos: compact ? "{33,0}" : "{67,0}",
        control_no_disturb_on_icon: "icon\\noxx.png"
      },
      icons: [
        ...candidate.icons,
        {
          path: `${candidate.directory}/icon/nobt.png`,
          width: compact ? 20 : 42,
          height: compact ? 20 : 42
        },
        {
          path: `${candidate.directory}/icon/noxx.png`,
          width: compact ? 20 : 42,
          height: compact ? 20 : 42
        }
      ]
    };
  })
};
assert.deepEqual(
  getWatchfaceControlStatusPreviewLayers(
    pace4StatusDetails.resolutions[1]
  ).map(({ configKey, position }) => ({ configKey, position })),
  [
    {
      configKey: "control_bluetooth_off_icon",
      position: { x: 244, y: 709 }
    },
    {
      configKey: "control_no_disturb_on_icon",
      position: { x: 308, y: 709 }
    }
  ],
  "PACE 4 control-slot Bluetooth and Do Not Disturb icons should use the template's control origin"
);
assert.deepEqual(
  listWatchfaceConfigAssets(pace4StatusDetails)
    .filter(({ configKey }) =>
      configKey.includes("bluetooth") || configKey.includes("no_disturb")
    )
    .map(({ id }) => id)
    .sort(),
  [
    "config:control_bluetooth_off_icon",
    "config:control_no_disturb_on_icon"
  ],
  "PACE 4 should detect only status assets whose config paths are populated"
);
const pace4BluetoothOnlyDetails = applyConfigTextEditsToDetails(
  pace4StatusDetails,
  {
    "watchface_390x390/config.txt": [
      "[rect_control1_pos]={117,346}",
      "[control_bluetooth_icon_pos]={1,0}",
      "[control_bluetooth_off_icon]=icon\\nobt.png"
    ].join("\r\n"),
    "watchface_800x800/config.txt": [
      "[rect_control1_pos]={241,709}",
      "[control_bluetooth_icon_pos]={3,0}",
      "[control_bluetooth_off_icon]=icon\\nobt.png"
    ].join("\r\n")
  }
);
assert.deepEqual(
  listWatchfaceConfigAssets(pace4BluetoothOnlyDetails)
    .filter(({ configKey }) =>
      configKey.includes("bluetooth") || configKey.includes("no_disturb")
    )
    .map(({ id }) => id),
  ["config:control_bluetooth_off_icon"],
  "status detection should follow manually edited PACE 4 config text"
);
assert.equal(
  pickWatchPreviewResolution(pace4Details)?.width,
  390,
  "390/800 AMOLED bundles should preview the physical 390px tree"
);
const pace4AmPm = buildAmPmOverrides(pace4Details, {
  enabled: true,
  x: 240,
  y: 50,
  scale: 1,
  color: "#ffffff"
});
assert.equal(
  pace4AmPm.find((entry) => entry.path.includes("390x390"))?.values
    .am_pm_icon_pos,
  "{117,24}",
  "master AM/PM positions should scale by 390/800 into the 390px tree"
);
const pace4NativeStyle = buildSelectableMetricStyleOverrides(
  pace4Details,
  {
    scale: 1,
    nativeSize: true,
    rasterFont: {
      label: "Native selectable digits",
      dataUrl: "",
      glyphs: "",
      columns: 1,
      sprites: Object.fromEntries(
        Array.from({ length: 10 }, (_, digit) => [
          String(digit),
          "data:image/png;base64,AA=="
        ])
      ),
      spriteSizes: Object.fromEntries(
        Array.from({ length: 10 }, (_, digit) => [
          String(digit),
          { width: 31, height: 47 }
        ])
      ),
      tint: false
    }
  },
  true
);
assert.equal(
  pace4NativeStyle.find(({ path }) => path.includes("390x390"))?.values
    .control_hr_rect,
  "{87,4,132,27,hcenter|vcenter}",
  "master-authored digit sizes should scale by 390/800 around the tree's rect center"
);
const pace4IconDetails = applyConfigOverridesToDetails(pace4Details, [
  {
    path: "watchface_390x390/config.txt",
    values: { control_step_icon_pos: "{12,8}" }
  },
  {
    path: "watchface_800x800/config.txt",
    values: { control_step_icon_pos: "{24,16}" }
  }
]);
assert.deepEqual(
  buildControlIconPositionOverrides(pace4IconDetails, {
    steps: { dx: 10, dy: -6 }
  }).find((entry) => entry.path.includes("390x390"))?.values,
  { control_step_icon_pos: "{17,5}" },
  "master icon drags should scale by 390/800 into the 390px tree"
);
const pace4AnalogDetails = {
  ...pace4Details,
  resolutions: pace4Details.resolutions.map((candidate) => ({
    ...candidate,
    config: {
      ...candidate.config,
      time_center_polygon_icon1: "1.png",
      time_center_pos: `{${candidate.width / 2},${candidate.height / 2}}`
    },
    aodConfig: {
      ...candidate.aodConfig,
      time_center_polygon_icon1: "1.png",
      time_center_pos: `{${candidate.width / 2},${candidate.height / 2}}`
    },
    icons: [
      ...candidate.icons,
      {
        path: `${candidate.directory}/1.png`,
        width: Math.round(candidate.width * 0.28),
        height: candidate.height
      }
    ]
  }))
};
assert.equal(
  analogCenterLayoutGroupId("time_center_polygon_icon1"),
  "analogCenter"
);
assert.equal(analogCenterLayoutGroupId("arc_cut_icon"), null);
assert.deepEqual(
  computeLayoutGroupBounds(pace4AnalogDetails.resolutions[1]).find(
    ({ id }) => id === "analogCenter"
  ),
  {
    id: "analogCenter",
    label: "Analog center",
    x0: 288,
    y0: 0,
    x1: 512,
    y1: 800
  },
  "a centered 224x800 analog overlay should expose its complete canvas for selection"
);
assert.deepEqual(
  computeLayoutOffsetLimits(pace4AnalogDetails.resolutions[1]).analogCenter,
  {
    minDx: -400,
    maxDx: 400,
    minDy: -400,
    maxDy: 400
  },
  "analog movement should clamp its pivot, allowing full-height artwork to clip"
);
const pace4AnalogOverrides = buildLayoutOverrides(pace4AnalogDetails, {
  analogCenter: { dx: 20, dy: -30 }
});
assert.deepEqual(
  pace4AnalogOverrides.find(({ path }) => path.includes("800x800"))?.values,
  { time_center_pos: "{420,370}" }
);
assert.deepEqual(
  pace4AnalogOverrides.find(({ path }) => path.includes("390x390"))?.values,
  { time_center_pos: "{205,180}" },
  "analog-center drags should scale from the 800px master into the PACE 4 tree"
);
const hiddenPace4Analog = buildWatchfaceConfigAssetOverrides(
  pace4AnalogDetails,
  {
    "config:time_center_polygon_icon1": { enabled: false }
  }
);
assert.deepEqual(
  hiddenPace4Analog.map(({ path, values }) => ({
    path,
    value: values.time_center_polygon_icon1
  })),
  [
    {
      path: "watchface_390x390/config.txt",
      value: "__COROSLINK_DELETE_CONFIG_KEY__"
    },
    {
      path: "watchface_390x390/AODconfig.txt",
      value: "__COROSLINK_DELETE_CONFIG_KEY__"
    },
    {
      path: "watchface_800x800/config.txt",
      value: "__COROSLINK_DELETE_CONFIG_KEY__"
    },
    {
      path: "watchface_800x800/AODconfig.txt",
      value: "__COROSLINK_DELETE_CONFIG_KEY__"
    }
  ],
  "hiding the PACE 4 analog center overlay should delete its key from current and AOD configs in both resolution trees"
);

const iconPositionDetails = applyConfigOverridesToDetails(details, [
  {
    path: "watchface_416x416/config.txt",
    values: {
      control_step_icon_pos: "{12,8}",
      control_battery_icon_pos: "{17,10}"
    }
  },
  {
    path: "watchface_800x800/config.txt",
    values: {
      control_step_icon_pos: "{24,16}",
      control_battery_icon_pos: "{32,20}"
    }
  }
]);
const pairedControlDetails = applyConfigOverridesToDetails(details, [
  {
    path: "watchface_800x800/config.txt",
    values: {
      control_exercise_hour_rect: "{94,0,182,64,hcenter|vcenter}",
      control_exercise_minute_rect: "{201,0,289,64,hcenter|vcenter}",
      control_exercise_font: "13x19",
      control_sunrise_hour_rect: "{94,0,182,64,hcenter|vcenter}",
      control_sunrise_minute_rect: "{201,0,289,64,hcenter|vcenter}",
      control_sunrise_font: "13x19",
      control_sunset_hour_rect: "{94,0,182,64,hcenter|vcenter}",
      control_sunset_minute_rect: "{201,0,289,64,hcenter|vcenter}",
      control_sunset_font: "13x19"
    }
  }
]);
assert.deepEqual(
  getAvailableComplications(pairedControlDetails).map(({ id }) => id),
  [
    "heartRate",
    "steps",
    "exercise",
    "sunrise",
    "sunset"
  ]
);
const controlIconOverrides = buildControlIconPositionOverrides(iconPositionDetails, {
  steps: { dx: 10, dy: -6 },
  battery: { dx: -4, dy: 8 },
  temperature: { dx: 20, dy: 20 }
});
assert.deepEqual(
  controlIconOverrides.find((entry) => entry.path.includes("800x800"))?.values,
  {
    control_step_icon_pos: "{34,10}",
    control_battery_icon_pos: "{28,28}"
  }
);
assert.deepEqual(
  controlIconOverrides.find((entry) => entry.path.includes("416x416"))?.values,
  {
    control_step_icon_pos: "{17,5}",
    control_battery_icon_pos: "{15,14}"
  }
);

// Non-negative children pass through untouched.
assert.equal(
  rebaseNegativeControlChildren(iconPositionDetails, controlIconOverrides),
  controlIconOverrides
);

// A drag that pushes a child above/left of the selector origin rebases the
// origin instead: absolute positions are identical, children stay >= 0.
const negativeIconOverrides = buildControlIconPositionOverrides(
  iconPositionDetails,
  { steps: { dx: -30, dy: -20 } }
);
const rebasedOverrides = rebaseNegativeControlChildren(
  iconPositionDetails,
  negativeIconOverrides
);
assert.deepEqual(
  rebasedOverrides.find((entry) => entry.path.includes("800x800"))?.values,
  {
    rect_control1_pos: "{94,196}",
    control_step_icon_pos: "{0,0}",
    control_battery_icon_pos: "{38,24}",
    control_hr_rect: "{166,4,294,68,hcenter|vcenter}",
    control_step_rect: "{86,4,310,68,hcenter|vcenter}"
  }
);
assert.deepEqual(
  rebasedOverrides.find((entry) => entry.path.includes("416x416"))?.values,
  {
    rect_control1_pos: "{48,102}",
    control_step_icon_pos: "{0,0}",
    control_battery_icon_pos: "{21,12}",
    control_hr_rect: "{87,2,154,35,hcenter|vcenter}",
    control_step_rect: "{46,2,162,35,hcenter|vcenter}"
  }
);

// A moved PACE 4 / 416 control can have positive absolute positions despite a
// negative container origin. Fold the negative axis into every relative child
// so the firmware receives the same positions with a non-negative origin.
const pace416NegativeOriginDetails = {
  resolutions: [
    {
      directory: "watchface_416x416",
      config: {
        rect_control1_pos: "{140,-246}",
        control_step_icon_pos: "{186,328}",
        control_step_rect: "{177,372,265,400,hcenter|vcenter}",
        control_kcal_icon_pos: "{148,372}",
        control_kcal_rect: "{177,372,265,400,hcenter|vcenter}",
        control_hr_icon_pos: "{184,334}",
        control_hr_rect: "{177,372,265,400,hcenter|vcenter}",
        control_elevation_icon_pos: "{182,328}",
        control_elevation_rect: "{177,372,265,400,hcenter|vcenter}"
      }
    }
  ]
};
assert.deepEqual(
  rebaseNegativeControlChildren(pace416NegativeOriginDetails, [])[0]?.values,
  {
    rect_control1_pos: "{140,0}",
    control_step_icon_pos: "{186,82}",
    control_step_rect: "{177,126,265,154,hcenter|vcenter}",
    control_kcal_icon_pos: "{148,126}",
    control_kcal_rect: "{177,126,265,154,hcenter|vcenter}",
    control_hr_icon_pos: "{184,88}",
    control_hr_rect: "{177,126,265,154,hcenter|vcenter}",
    control_elevation_icon_pos: "{182,82}",
    control_elevation_rect: "{177,126,265,154,hcenter|vcenter}"
  }
);

const metricOverrides = buildMetricOverrides(details, {
  battery: true,
  heartRate: true,
  steps: true,
  temperature: true,
  calories: false
});
assert.equal(metricOverrides.length, 2);
const full = metricOverrides.find((entry) => entry.path.includes("800x800"));
assert.ok(full);
assert.match(full.values.battery_level_rect, /^\{\d+,\d+,\d+,\d+,hcenter\|vcenter\}$/);
assert.equal(full.values.battery_level_font, "13x19");
assert.equal(
  full.values.heartreate_level_rect,
  "{134,576,266,640,hcenter|vcenter}"
);
assert.equal(full.values.heartreate_level_font, "13x19");
assert.equal(full.values.step_rect, "{474,576,694,640,hcenter|vcenter}");
assert.equal(
  full.values.temperature_rect,
  "{65,600,315,685,hcenter|vcenter}"
);
assert.equal(full.values.temperature_font, "13x19");
assert.equal(full.values.temperature_font_color, undefined);
assert.equal(full.values.control_temperature_font, undefined);
assert.equal(full.values.control_temperature_rect, undefined);
assert.equal(full.values.kcal_rect, "");
assert.equal(full.values.kcal_font, "");
const activeTemperatureDetails = applyConfigOverridesToDetails(details, [
  {
    path: "watchface_416x416/config.txt",
    values: {
      temperature_rect: "{46,320,158,358,hcenter|vcenter}",
      temperature_font_color: "0xFFFFFF",
      temperature_negative_sign_icon: "icon\\negative.png"
    }
  },
  {
    path: "watchface_800x800/config.txt",
    values: {
      temperature_rect: "{-58,442,38,475,hcenter|vcenter}",
      temperature_font_color: "0xFFFFFF",
      temperature_negative_sign_icon: "icon\\negative.png"
    }
  }
]);
const repairedTemperature = buildMetricOverrides(activeTemperatureDetails, {})
  .find((entry) => entry.path.includes("800x800"));
assert.equal(repairedTemperature?.values.temperature_font, "13x19");
assert.equal(repairedTemperature?.values.temperature_rect, undefined);
assert.deepEqual(
  mergeAssetReplacements(
    [{ path: "watchface_800x800/01/00.png", dataUrl: "global" }],
    [
      { path: "watchface_800x800/01/00.png", dataUrl: "specific" },
      { path: "watchface_800x800/01/01.png", dataUrl: "second" }
    ]
  ),
  [
    { path: "watchface_800x800/01/00.png", dataUrl: "specific" },
    { path: "watchface_800x800/01/01.png", dataUrl: "second" }
  ]
);
assert.equal(
  scaleConfigRectValue(full.values.heartreate_level_rect, 1.5),
  "{101,560,299,656,hcenter|vcenter}"
);

const withMetrics = applyConfigOverridesToDetails(details, metricOverrides);

// Drag isolation hides fixed metrics after their empty starter rectangles have
// been created and positioned by the design pipeline. Looking at the original
// template here would miss all four keys and leave the old value visible.
const allFixedMetrics = applyConfigOverridesToDetails(
  details,
  buildMetricOverrides(details, {
    heartRate: true,
    steps: true,
    calories: true,
    elevation: true
  })
);
const isolatedFixedMetrics = applyConfigOverridesToDetails(
  allFixedMetrics,
  buildLayerVisibilityOverrides(allFixedMetrics, {
    heartRate: false,
    steps: false,
    calories: false,
    elevation: false
  })
);
for (const fixedMetricKey of [
  "heartreate_level_rect",
  "step_rect",
  "kcal_rect",
  "elevation_rect"
]) {
  for (const derivedResolution of isolatedFixedMetrics.resolutions) {
    assert.equal(derivedResolution.config[fixedMetricKey], "");
  }
}
const composeSource = await readFile(
  new URL("../src/watchfaces/watchfaceCompose.ts", import.meta.url),
  "utf8"
);
assert.match(
  composeSource,
  /buildLayerVisibilityOverrides\(laidOutDetails, design\.layerVisibility \?\? \{\}\)/
);
const inferredSeparators = inferStaticSeparators(withMetrics);
assert.deepEqual(inferredSeparators.colon, {
  enabled: false,
  x: 242,
  y: 132,
  size: 64,
  color: "#ffffff"
});
assert.deepEqual(inferredSeparators.dateSlash, {
  enabled: false,
  x: 392,
  y: 352,
  size: 64,
  color: "#ffffff"
});
const staticSeparatorOverrides = buildStaticSeparatorOverrides(withMetrics, {
  ...inferredSeparators,
  colon: { ...inferredSeparators.colon, enabled: true }
});
assert.equal(staticSeparatorOverrides.length, 2);
assert.equal(
  staticSeparatorOverrides.find((entry) => entry.path.includes("800x800"))
    ?.values.colon_icon,
  ""
);
const replacedCompositeSeparators = buildStaticSeparatorOverrides(withMetrics, {
  colon: { ...inferredSeparators.colon, enabled: true },
  dateSlash: { ...inferredSeparators.dateSlash, enabled: true }
});
assert.equal(
  replacedCompositeSeparators.find((entry) => entry.path.includes("800x800"))
    ?.values.arc_cut_icon,
  ""
);
const metricStyleOverrides = buildMetricStyleOverrides(
  withMetrics,
  {
    heartRate: { color: "#ff3366", scale: 1.5 },
    temperature: { color: "#33aa55", scale: 1.25 }
  },
  true
);
const fullMetricStyle = metricStyleOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(
  fullMetricStyle?.values.heartreate_level_rect,
  "{101,560,299,656,hcenter|vcenter}"
);
assert.equal(fullMetricStyle?.values.heartreate_level_font, "cl_hr");
assert.equal(
  fullMetricStyle?.values.temperature_rect,
  "{34,590,347,696,hcenter|vcenter}"
);
// With TEMPERATURE_FONT_COMPAT enabled, the fixed temperature block reuses
// the template's digit folder and takes a firmware tint instead of
// pre-colored `cl_ftemp` sprites.
assert.equal(fullMetricStyle?.values.temperature_font_color, "0x33AA55");
assert.equal(fullMetricStyle?.values.temperature_font, "13x19");
assert.equal(fullMetricStyle?.values.control_temperature_font, undefined);
assert.equal(fullMetricStyle?.values.control_temperature_font_color, undefined);
const metricStyleWithoutColor = buildMetricStyleOverrides(
  withMetrics,
  { temperature: { scale: 1 } },
  true
).find((entry) => entry.path.includes("800x800"));
assert.equal(metricStyleWithoutColor?.values.temperature_font_color, undefined);
assert.equal(
  metricStyleWithoutColor?.values.control_temperature_font_color,
  undefined
);
assert.equal(metricStyleWithoutColor?.values.control_temperature_font, undefined);
const controlTemperatureOverrides = buildControlTemperatureOverrides(
  withMetrics,
  { color: "#33aa55", scale: 1 },
  true
);
const fullControlTemperature = controlTemperatureOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(
  fullControlTemperature?.values.control_temperature_rect,
  "{80,0,304,64,hcenter|vcenter}"
);
assert.equal(fullControlTemperature?.values.control_temperature_font, "cl_ctemp");
assert.equal(
  fullControlTemperature?.values.control_temperature_font_color,
  "0x33AA55"
);
assert.equal(
  fullControlTemperature?.values.control_temperature_negative_sign_icon,
  undefined
);
const timeStyleOverrides = buildTimeStyleOverrides(
  withMetrics,
  {
    hours: { color: "#33ddff", scale: 1.5 },
    seconds: { color: "#ffcc22", scale: 2 }
  },
  true
);
const fullTimeStyle = timeStyleOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(fullTimeStyle?.values.time_hour_high_pos, "{74,84}");
assert.equal(fullTimeStyle?.values.time_hour_low_pos, "{164,84}");
assert.equal(fullTimeStyle?.values.time_hour_high_font, "cl_hh");
assert.equal(fullTimeStyle?.values.time_hour_low_font, "cl_hl");
assert.equal(fullTimeStyle?.values.time_second_high_pos, "{398,68}");
assert.equal(fullTimeStyle?.values.time_second_low_pos, "{478,68}");
assert.equal(fullTimeStyle?.values.time_second_high_font, "cl_sh");
assert.equal(fullTimeStyle?.values.time_second_low_font, "cl_sl");
const wideDigitRasterFont = {
  label: "Wide digits",
  dataUrl: "data:image/png;base64,wide",
  glyphs: "",
  columns: 1,
  sprites: Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [String(digit), `digit:${digit}`])
  ),
  spriteSizes: Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [
      String(digit),
      { width: 120, height: 80 }
    ])
  ),
  tint: false
};
assert.deepEqual(
  timeSpriteCanvasSize(
    { width: 60, height: 64 },
    { scale: 1.5, rasterFont: wideDigitRasterFont }
  ),
  { width: 144, height: 96 },
  "wide PNG digits should expand the time canvas at the selected height"
);
const wideTimeStyle = {
  hours: {
    scale: 1.5,
    rasterFont: wideDigitRasterFont
  }
};
const wideTimeDetails = applyConfigOverridesToDetails(
  withMetrics,
  buildTimeStyleOverrides(withMetrics, wideTimeStyle)
);
const wideTimeResolution = wideTimeDetails.resolutions.find(
  ({ directory }) => directory.includes("800x800")
);
assert.equal(
  wideTimeResolution?.config.time_hour_high_pos,
  "{-4,84}",
  "the high hour slot should move left when its PNG canvas widens"
);
assert.equal(
  wideTimeResolution?.config.time_hour_low_pos,
  "{164,84}",
  "the low hour slot should follow the widened high slot without overlap"
);
assert.deepEqual(
  computeLayoutGroupBounds(wideTimeResolution, {
    timeStyles: wideTimeStyle
  }).find(({ id }) => id === "hours"),
  {
    id: "hours",
    label: "Hour digits",
    x0: -4,
    y0: 84,
    x1: 308,
    y1: 180
  },
  "hour selection bounds should include the complete wide PNG canvases"
);
const previewTimeStyles = {
  hours: { color: "#33ddff", scale: 1.5 },
  minutes: { scale: 1.25 },
  seconds: { color: "#ffcc22", scale: 2 }
};
const styledTimeDetails = applyConfigOverridesToDetails(
  withMetrics,
  buildTimeStyleOverrides(withMetrics, previewTimeStyles)
);
const styledTimeBounds = computeLayoutGroupBounds(
  styledTimeDetails.resolutions[1],
  {
    timeStyles: previewTimeStyles,
    letterSpacing: 0.2
  }
);
assert.deepEqual(
  styledTimeBounds.find(({ id }) => id === "hours"),
  {
    id: "hours",
    label: "Hour digits",
    x0: 64,
    y0: 84,
    x1: 240,
    y1: 180
  },
  "scaled hour bounds should use rendered glyph dimensions and tracking"
);
assert.deepEqual(
  styledTimeBounds.find(({ id }) => id === "minutes"),
  {
    id: "minutes",
    label: "Minute digits",
    x0: 259,
    y0: 92,
    x1: 405,
    y1: 172
  },
  "scaled minute bounds should follow both enlarged glyphs"
);
assert.deepEqual(
  styledTimeBounds.find(({ id }) => id === "seconds"),
  {
    id: "seconds",
    label: "Seconds",
    x0: 385,
    y0: 68,
    x1: 579,
    y1: 196
  },
  "seconds should share the same scale-aware selection geometry"
);
const timeTrackingOverrides = buildTimeTrackingOverrides(withMetrics, 0.2);
const fullTimeTracking = timeTrackingOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(fullTimeTracking?.values.time_hour_high_pos, "{94,100}");
assert.equal(fullTimeTracking?.values.time_hour_low_pos, "{166,100}");
assert.equal(fullTimeTracking?.values.time_minute_high_pos, "{274,100}");
assert.equal(fullTimeTracking?.values.time_minute_low_pos, "{346,100}");
const pngTimeTracking = buildTimeTrackingOverrides(
  withMetrics,
  0,
  {
    hours: {
      scale: 1,
      letterSpacing: 0.25,
      rasterFont: {
        label: "Hour PNGs",
        dataUrl: "data:image/png;base64,AA==",
        glyphs: "0123456789",
        columns: 10,
        tint: false
      }
    },
    minutes: {
      scale: 1,
      letterSpacing: -0.25,
      rasterFont: {
        label: "Minute PNGs",
        dataUrl: "data:image/png;base64,AA==",
        glyphs: "0123456789",
        columns: 10,
        tint: false
      }
    }
  }
).find((entry) => entry.path.includes("800x800"));
assert.equal(pngTimeTracking?.values.time_hour_high_pos, "{92,100}");
assert.equal(pngTimeTracking?.values.time_hour_low_pos, "{168,100}");
assert.equal(pngTimeTracking?.values.time_minute_high_pos, "{288,100}");
assert.equal(pngTimeTracking?.values.time_minute_low_pos, "{332,100}");
const dateStyleOverrides = buildDateStyleOverrides(
  withMetrics,
  {
    weekday: { scale: 1.25 },
    dateMonth: { scale: 1.5 },
    dateDay: { scale: 0.75 }
  },
  true
);
const fullDateStyle = dateStyleOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(
  fullDateStyle?.values.english_date_week_rect,
  "{80,320,240,384,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_week_font, "cl_weekday");
assert.equal(
  fullDateStyle?.values.english_date_month_rect,
  "{320,320,384,384,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_month_font, "cl_date_month");
assert.equal(
  fullDateStyle?.values.english_date_day_rect,
  "{400,320,464,384,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_day_font, "cl_date_day");
const detailsWithoutDateDayColor = {
  ...withMetrics,
  resolutions: withMetrics.resolutions.map((candidate) => {
    const config = { ...candidate.config };
    delete config.english_date_day_font_color;
    return { ...candidate, config };
  })
};
const dateStyleWithoutUnsupportedColor = buildDateStyleOverrides(
  detailsWithoutDateDayColor,
  {
    weekday: { scale: 1, color: "#aa44ee" },
    dateDay: { scale: 1, color: "#22cc88" }
  },
  true
);
assert.equal(
  dateStyleWithoutUnsupportedColor[0]?.values.english_date_week_font_color,
  "0xAA44EE"
);
assert.equal(
  dateStyleWithoutUnsupportedColor[0]?.values.english_date_day_font_color,
  undefined,
  "date styling should not add a font-color key missing from the starter"
);
assert.equal(
  resizeConfigRectToCanvas(
    "{100,40,180,84,hcenter|vcenter}",
    132,
    44
  ),
  "{74,40,206,84,hcenter|vcenter}",
  "native weekday width should expand around the existing center without face clamping"
);
const nativeDateStyleOverrides = buildDateStyleOverrides(withMetrics, {
  dateMonth: { scale: 1, width: 31, height: 47 }
});
assert.equal(
  nativeDateStyleOverrides.find((entry) => entry.path.includes("800x800"))
    ?.values.english_date_month_rect,
  "{321,329,383,376,hcenter|vcenter}"
);
assert.deepEqual(
  dateSpriteCanvasSize(
    withMetrics.resolutions[1],
    "dateMonth",
    { scale: 1, width: 31, height: 47 },
    0
  ),
  { width: 31, height: 47, native: true }
);
assert.deepEqual(
  dateSpriteCanvasSize(
    withMetrics.resolutions[0],
    "dateMonth",
    { scale: 1, width: 60, height: 60 },
    0,
    416 / 800
  ),
  { width: 31, height: 31, native: true },
  "device trees should scale master-authored native PNG dimensions"
);
assert.equal(
  nativeDateStyleOverrides.find((entry) => entry.path.includes("416x416"))
    ?.values.english_date_month_rect,
  "{167,171,199,195,hcenter|vcenter}",
  "the 416px month rect should follow the scaled native size, not the 800px one"
);
const importedMonthLabelsOnDigitTemplate = {
  ...monthLabelStyle,
  monthFormat: "labels"
};
assert.deepEqual(
  dateSpriteCanvasSize(
    withMetrics.resolutions[1],
    "dateMonth",
    importedMonthLabelsOnDigitTemplate,
    1
  ),
  { width: 73, height: 29, native: true },
  "importing JAN–DEC should switch a numeric-month template to label mode"
);
assert.deepEqual(
  dateSpriteCanvasSize(
    withMetrics.resolutions[0],
    "dateMonth",
    importedMonthLabelsOnDigitTemplate,
    1,
    416 / 800
  ),
  { width: 38, height: 15, native: true },
  "imported PNG native sizes should also scale from master to device trees"
);
assert.equal(
  buildDateStyleOverrides(withMetrics, {
    dateMonth: { scale: 1, width: 31, height: 47, monthFormat: "labels" }
  }).find((entry) => entry.path.includes("800x800"))
    ?.values.english_date_month_rect,
  "{337,329,368,376,hcenter|vcenter}",
  "label mode should size the month rect for one image rather than two digits"
);
const layerColorOverrides = buildLayerColorOverrides(withMetrics, {
  seconds: "#22cc88",
  weekday: "#aa44ee",
  battery: "#ffaa00"
});
const fullLayerColors = layerColorOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(fullLayerColors?.values.time_second_high_font_color, "0x22CC88");
assert.equal(fullLayerColors?.values.time_second_low_font_color, "0x22CC88");
assert.equal(fullLayerColors?.values.english_date_week_font_color, "0xAA44EE");
assert.equal(fullLayerColors?.values.battery_level_font_color, "0xFFAA00");
const fullBounds = computeLayoutGroupBounds(withMetrics.resolutions[1]);
assert.deepEqual(fullBounds.find((entry) => entry.id === "separators"), {
  id: "separators",
  label: "Time & date separators",
  x0: 240,
  y0: 160,
  x1: 400,
  y1: 400
});
assert.deepEqual(
  fullBounds.filter((entry) =>
    ["hours", "minutes", "weekday", "dateMonth", "dateDay"].includes(entry.id)
  ).map((entry) => entry.id),
  ["hours", "minutes", "weekday", "dateMonth", "dateDay"]
);
assert.deepEqual(
  fullBounds.find((entry) => entry.id === "complication"),
  {
    id: "complication",
    label: "Selectable metric",
    x0: 180,
    y0: 200,
    x1: 404,
    y1: 264
  }
);
assert.deepEqual(fullBounds.find((entry) => entry.id === "batteryIcon"), {
  id: "batteryIcon",
  label: "Battery icon",
  x0: 160,
  y0: 80,
  x1: 248,
  y1: 144
});
const fullLimits = computeLayoutOffsetLimits(withMetrics.resolutions[1]);
assert.deepEqual(fullLimits.heartRate, {
  minDx: -134,
  maxDx: 534,
  minDy: -576,
  maxDy: 160
});
assert.equal(fullLimits.heartRate.minDy < -400, true);
const layoutOverrides = buildLayoutOverrides(withMetrics, {
  hours: { dx: -50, dy: 10 },
  weekday: { dx: 20, dy: -30 },
  heartRate: { dx: 10, dy: 20 },
  complication: { dx: 20, dy: 30 }
});
const shiftedFull = layoutOverrides.find((entry) => entry.path.includes("800x800"));
assert.equal(
  shiftedFull?.values.heartreate_level_rect,
  "{144,596,276,660,hcenter|vcenter}"
);
assert.equal(shiftedFull?.values.rect_control1_pos, "{120,230}");
assert.equal(shiftedFull?.values.time_hour_high_pos, "{50,110}");
assert.equal(
  shiftedFull?.values.english_date_week_rect,
  "{100,290,260,354,hcenter|vcenter}"
);
const shiftedCompact = layoutOverrides.find((entry) => entry.path.includes("416x416"));
assert.equal(
  shiftedCompact?.values.heartreate_level_rect,
  "{75,310,144,343,hcenter|vcenter}"
);
assert.equal(shiftedCompact?.values.rect_control1_pos, "{62,120}");

const visibilityOverrides = buildLayerVisibilityOverrides(withMetrics, {
  hours: false,
  weekday: false,
  complication: false,
  batteryIcon: false
});
const hiddenFull = visibilityOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(hiddenFull?.values.time_hour_high_pos, "");
assert.equal(hiddenFull?.values.time_hour_low_pos, "");
assert.equal(hiddenFull?.values.english_date_week_rect, "");
assert.equal(hiddenFull?.values.rect_control1_pos, "");
assert.equal(
  hiddenFull?.values.battery_icon_pos,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding the battery icon should delete its position key"
);
assert.equal(
  hiddenFull?.values.battery_icon_dir,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding the battery icon should delete its folder-path key"
);

const temperatureLayerDetails = {
  ...withMetrics,
  resolutions: withMetrics.resolutions.map((resolution) => ({
    ...resolution,
    config: {
      ...resolution.config,
      temperature_rect: "{120,180,296,240,hcenter|vcenter}",
      temperature_font: "13x19",
      temperature_font_color: "0xFFFFFF",
      temperature_negative_sign_icon: "icon\\negative.png"
    }
  }))
};
const hiddenStaticTemperature = buildLayerVisibilityOverrides(
  temperatureLayerDetails,
  { temperature: false }
).find((entry) => entry.path.includes("800x800"));
assert.equal(
  hiddenStaticTemperature?.values.temperature_rect,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding static temperature should delete its rect key"
);
assert.equal(
  hiddenStaticTemperature?.values.temperature_font,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding static temperature should delete its font key"
);
assert.equal(
  hiddenStaticTemperature?.values.temperature_font_color,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding static temperature should delete its font-color key"
);
assert.equal(
  hiddenStaticTemperature?.values.temperature_negative_sign_icon,
  "__COROSLINK_DELETE_CONFIG_KEY__",
  "hiding static temperature should delete its negative-sign icon key"
);

const merged = mergeConfigOverrides(metricOverrides, layoutOverrides);
assert.equal(merged.length, 2);
assert.equal(
  merged.find((entry) => entry.path.includes("800x800"))?.values.heartreate_level_rect,
  "{144,596,276,660,hcenter|vcenter}"
);

// Reopening a Studio-produced archive should replace its existing shared
// selectable digit folder instead of attempting to create colliding entries.
const existingControlDetails = {
  ...details,
  resolutions: details.resolutions.map((candidate) => ({
    ...candidate,
    spriteFolders: [
      ...candidate.spriteFolders,
      {
        folder: "cl_control",
        kind: "digits",
        aod: false,
        files: digitFiles(
          candidate.width === 800 ? 44 : 23,
          candidate.width === 800 ? 64 : 33,
          candidate.directory,
          "cl_control"
        )
      }
    ]
  }))
};
const nativeDocument = globalThis.document;
const nativeDateImage = globalThis.Image;
globalThis.document = {
  createElement: () => {
    let renderedText = "";
    const context = {
      fillStyle: "",
      font: "",
      textBaseline: "alphabetic",
      measureText: (text) => ({
        width: text.length * 8,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2
      }),
      fillText: (text) => {
        renderedText = text;
      },
      drawImage: () => {}
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () =>
        `data:image/png;base64,W${canvas.width}H${canvas.height}T${renderedText}`
    };
    return canvas;
  }
};
globalThis.Image = class FakeNativeDateImage {
  naturalWidth = 1;
  naturalHeight = 1;
  onload = null;
  onerror = null;
  set src(value) {
    const dimensions = /W(\d+)H(\d+)/.exec(value);
    this.naturalWidth = Number(dimensions?.[1] ?? 1);
    this.naturalHeight = Number(dimensions?.[2] ?? 1);
    queueMicrotask(() => this.onload?.());
  }
};
try {
  const rotatedMonthComposition = await buildDateSpriteComposition(
    { archiveId: "rotated-months", resolutions: [monthLabelResolution] },
    {
      dateMonth: {
        scale: 1,
        width: 51,
        height: 26,
        monthFormat: "labels",
        fontFamily: "Fixture Sans"
      }
    },
    {
      fontFamily: "",
      digitColor: "#ffffff",
      tintLabels: false
    },
    async () => []
  );
  assert.match(
    rotatedMonthComposition.replacements.find(({ path }) =>
      path.endsWith("/cl_date_month/00.png")
    )?.dataUrl ?? "",
    /TDEC/,
    "firmware month slot 00 should wrap to December"
  );
  assert.match(
    rotatedMonthComposition.replacements.find(({ path }) =>
      path.endsWith("/cl_date_month/07.png")
    )?.dataUrl ?? "",
    /TJUL/,
    "firmware month slot 07 should contain July, not August"
  );

  const nativeControlIconReplacements =
    await buildWatchfaceConfigAssetReplacements(
      detailsWithControlIcon,
      {
        "config:control_hr_icon": {
          nativeSize: true,
          replacement: {
            dataUrl: "data:image/png;base64,W96H48",
            width: 96,
            height: 48
          }
        }
      }
    );
  const nativeFullControlIcon = nativeControlIconReplacements.find(({ path }) =>
    path === "watchface_800x800/icon/hr.png"
  );
  assert.equal(nativeFullControlIcon?.allowDimensionOverride, true);
  assert.equal(nativeFullControlIcon?.create, false);
  assert.match(
    nativeFullControlIcon?.dataUrl ?? "",
    /W96H48/,
    "native selectable icons should export their imported canvas instead of the template slot"
  );

  const separateBatteryReplacements =
    await buildWatchfaceConfigAssetReplacements(
      controlBatteryDetails,
      {
        "config:battery_icon": {
          stateReplacements: {
            "0": {
              dataUrl: "data:image/png;base64,W48H24",
              width: 48,
              height: 24
            }
          }
        },
        "config:control_battery_icon": {
          stateReplacements: {
            "0": {
              dataUrl: "data:image/png;base64,W36H18",
              width: 36,
              height: 18
            }
          }
        }
      }
    );
  assert.ok(
    separateBatteryReplacements.some(({ path }) =>
      path.includes("/cl_battery_icon/00.png")
    ),
    "fixed battery artwork should be written to its isolated folder"
  );
  assert.ok(
    separateBatteryReplacements.some(({ path }) =>
      path.includes("/cl_control_battery_icon/00.png")
    ),
    "control battery artwork should be written to a different isolated folder"
  );
  assert.equal(
    separateBatteryReplacements.some(({ path }) =>
      /\/battery\/00\.png$/.test(path)
    ),
    false,
    "custom battery assets must not overwrite the template's shared battery folder"
  );

  const reopenedControlReplacements =
    await buildSelectableMetricSpriteReplacements(
      existingControlDetails,
      { scale: 1, fontFamily: "Fixture Sans" },
      "",
      async () => {
        throw new Error("local-font rendering should not load source sprites");
      }
    );
  assert.ok(reopenedControlReplacements.length > 0);
  assert.equal(
    reopenedControlReplacements.every(({ create }) => create === false),
    true,
    "existing cl_control digits should be replaced in place on a round trip"
  );
  const nativeControlComposition =
    await buildSelectableMetricSpriteComposition(
      existingControlDetails,
      { scale: 1, fontFamily: "Fixture Sans", nativeSize: true },
      "",
      async () => {
        throw new Error("native local-font rendering should not load source sprites");
      }
    );
  assert.ok(nativeControlComposition.replacements.length > 0);
  assert.equal(
    nativeControlComposition.replacements.every(
      ({ create, allowDimensionOverride }) =>
        create === false && allowDimensionOverride === true
    ),
    true,
    "native selectable digits should replace existing sprites with dimension overrides"
  );
  assert.equal(
    nativeControlComposition.configOverrides.find(({ path }) =>
      path.includes("800x800")
    )?.values.control_hr_rect,
    "{206,0,242,64,hcenter|vcenter}",
    "native selectable export geometry should follow the rendered digit width"
  );

  const existingDateDetails = {
    ...details,
    resolutions: details.resolutions.map((candidate) => ({
      ...candidate,
      spriteFolders: [
        ...candidate.spriteFolders,
        {
          folder: "cl_weekday",
          kind: "week",
          aod: false,
          files: weekFiles(
            candidate.width === 800 ? 132 : 69,
            candidate.width === 800 ? 64 : 33,
            candidate.directory,
            "cl_weekday"
          )
        },
        {
          folder: "cl_date_day",
          kind: "digits",
          aod: false,
          files: digitFiles(
            candidate.width === 800 ? 44 : 23,
            candidate.width === 800 ? 64 : 33,
            candidate.directory,
            "cl_date_day"
          )
        }
      ]
    }))
  };
  const reopenedDateComposition = await buildDateSpriteComposition(
    existingDateDetails,
    {
      weekday: {
        scale: 1,
        fontFamily: "Fixture Sans",
        nativeSize: true
      },
      dateDay: {
        scale: 1,
        fontFamily: "Fixture Sans",
        nativeSize: true
      }
    },
    {
      fontFamily: "",
      digitColor: "#ffffff",
      tintLabels: false
    },
    async (paths) => {
      assert.deepEqual(
        paths,
        [],
        "local date-font rendering should not request source sprites"
      );
      return [];
    }
  );
  assert.ok(reopenedDateComposition.replacements.length > 0);
  assert.equal(
    reopenedDateComposition.replacements.every(
      ({ create }) => create === false
    ),
    true,
    "existing cl_weekday and cl_date_day sprites should be replaced in place"
  );
  assert.match(
    reopenedDateComposition.replacements.find(({ path }) =>
      path.endsWith("/cl_weekday/00.png")
    )?.dataUrl ?? "",
    /TMON$/,
    "weekday sprite zero should render MON"
  );
  assert.match(
    reopenedDateComposition.replacements.find(({ path }) =>
      path.endsWith("/cl_date_day/00.png")
    )?.dataUrl ?? "",
    /T0$/,
    "date-day sprite zero should render 0 rather than MON"
  );
} finally {
  if (nativeDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = nativeDocument;
  }
  if (nativeDateImage === undefined) {
    delete globalThis.Image;
  } else {
    globalThis.Image = nativeDateImage;
  }
}

// Firmware-backed dynamic layers rotate their artwork without changing the
// fixed PNG canvas dimensions expected by COROS.
const rotationOptions = {
  timeStyles: { hours: { scale: 1, rotation: 30 } },
  metricStyles: {
    heartRate: { scale: 1, rotation: 45 },
    temperature: { scale: 1, rotation: 90 }
  },
  complicationStyle: { scale: 1, rotation: 60 }
};
assert.equal(
  resolveWatchfaceSpriteRotation(rotationOptions, "complication"),
  60,
  "selectable value glyphs should use their configured rotation"
);
assert.equal(
  resolveWatchfaceSpriteRotation(rotationOptions, "complication", false),
  0,
  "non-font complication icons must not inherit value-glyph rotation"
);
assert.equal(
  resolveWatchfaceSpriteRotation(rotationOptions, "heartRate"),
  45,
  "supported fixed metrics should rotate in preview and export"
);
assert.equal(supportsWatchfaceSpriteRotation("temperature"), false);
assert.equal(
  resolveWatchfaceSpriteRotation(rotationOptions, "temperature"),
  0,
  "compatibility-mode temperature must not preview an unsupported rotation"
);
const rotationDocument = globalThis.document;
const rotationImage = globalThis.Image;
const rotationCalls = [];
globalThis.document = {
  createElement: () => {
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      save: () => rotationCalls.push(["save"]),
      translate: (x, y) => rotationCalls.push(["translate", x, y]),
      rotate: (radians) => rotationCalls.push(["rotate", radians]),
      drawImage: (...args) => rotationCalls.push(["drawImage", ...args.slice(1)]),
      restore: () => rotationCalls.push(["restore"])
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => `rotated:${canvas.width}x${canvas.height}`
    };
    return canvas;
  }
};
globalThis.Image = class FakeRotationImage {
  naturalWidth = 20;
  naturalHeight = 40;
  onload = null;
  onerror = null;
  set src(_value) {
    queueMicrotask(() => this.onload?.());
  }
};
try {
  assert.equal(
    await rotateSpriteInCanvas("sprite", 20, 40, 90),
    "rotated:20x40"
  );
  assert.deepEqual(rotationCalls[1], ["translate", 10, 20]);
  assert.ok(Math.abs(rotationCalls[2][1] - Math.PI / 2) < 0.000001);
  assert.equal(
    await rotateSpriteInCanvas("unchanged", 20, 40, 360),
    "unchanged"
  );
} finally {
  if (rotationDocument === undefined) delete globalThis.document;
  else globalThis.document = rotationDocument;
  if (rotationImage === undefined) delete globalThis.Image;
  else globalThis.Image = rotationImage;
}

// Stable template assets reuse their decoded image, while dynamic background
// frames can explicitly bypass the cache during drag rendering.
const nativeImage = globalThis.Image;
let imageConstructions = 0;
globalThis.Image = class FakeImage {
  onload = null;
  onerror = null;
  set src(value) {
    this.currentSrc = value;
    imageConstructions += 1;
    queueMicrotask(() => this.onload?.());
  }
};
try {
  const cachedImage = await loadStudioImage("data:image/png;base64,CACHED");
  const cachedAgain = await loadStudioImage("data:image/png;base64,CACHED");
  assert.equal(cachedAgain, cachedImage);
  assert.equal(imageConstructions, 1);
  const uncachedImage = await loadStudioImage(
    "data:image/png;base64,DYNAMIC",
    false
  );
  const uncachedAgain = await loadStudioImage(
    "data:image/png;base64,DYNAMIC",
    false
  );
  assert.notEqual(uncachedAgain, uncachedImage);
  assert.equal(imageConstructions, 3);
} finally {
  if (nativeImage === undefined) {
    delete globalThis.Image;
  } else {
    globalThis.Image = nativeImage;
  }
}

console.log("COROS watchface studio tests passed");
