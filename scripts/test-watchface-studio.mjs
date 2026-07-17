import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyConfigOverridesToDetails,
  buildAmPmOverrides,
  buildControlTemperatureOverrides,
  buildControlIconPositionOverrides,
  buildControlBatteryVisibilityOverrides,
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
  detailsForPreviewMode,
  detailsForPreviewResolution,
  getAvailableComplications,
  getAmPmCapability,
  getFixedMetricCapabilities,
  getTemplateBackgroundAssetPaths,
  getWatchfaceAnalogPreviewLayers,
  getWatchfaceControlStatusPreviewLayers,
  hasControlBattery,
  hasAutoAlignedTime,
  hasWatchfaceAod,
  inferStaticSeparators,
  listWatchfaceConfigAssets,
  loadStudioImage,
  mergeAssetReplacements,
  mergeConfigOverrides,
  normalizeRasterFontGlyphs,
  pickWatchPreviewResolution,
  rasterFontSupportsText,
  rasterFontNativeSpriteSize,
  rebaseNegativeControlChildren,
  resizeConfigRectToCanvas,
  scaledBatterySpriteCanvasSize,
  scaleConfigRectValue,
  watchfaceEffectRenderScale
} from "../src/watchfaces/watchfaceStudio.ts";

assert.equal(corosWeekdayIndex(0), 6);
assert.equal(corosWeekdayIndex(1), 0);
assert.equal(corosWeekdayIndex(6), 5);
assert.equal(corosMonthSpriteIndex(0), 1);
assert.equal(corosMonthSpriteIndex(6), 7);
assert.equal(corosMonthSpriteIndex(11), 0);
assert.equal(corosMonthLabelForSpriteIndex(0), "DEC");
assert.equal(corosMonthLabelForSpriteIndex(7), "JUL");
assert.equal(watchfaceEffectRenderScale(520 / 416, 416 / 800), 0.65);

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
      control_battery_level_font: "13x19"
    },
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
}
assert.deepEqual(
  hiddenControlBattery.map(({ path }) => path),
  details.resolutions.flatMap(({ directory }) => [
    `${directory}/config.txt`,
    `${directory}/AODconfig.txt`
  ]),
  "disabling selectable Battery should remove its declarations from current and AOD configs"
);
assert.deepEqual(buildControlBatteryVisibilityOverrides(details, true), []);
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
  assert.equal(override.values.colon_icon, "");
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
  assert.equal(override.values.background_icon, "");
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
  ["heartRate", "steps", "battery", "temperature"]
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
).find(({ path }) => path.includes("800x800"));
assert.equal(
  nativeSelectableStyle?.values.control_hr_rect,
  "{178,9,271,56,hcenter|vcenter}",
  "native selectable digits should expand each value rectangle around its existing center"
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
    "sunset",
    "battery",
    "temperature"
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
  complication: false
});
const hiddenFull = visibilityOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(hiddenFull?.values.time_hour_high_pos, "");
assert.equal(hiddenFull?.values.time_hour_low_pos, "");
assert.equal(hiddenFull?.values.english_date_week_rect, "");
assert.equal(hiddenFull?.values.rect_control1_pos, "");

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
