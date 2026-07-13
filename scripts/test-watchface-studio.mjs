import assert from "node:assert/strict";
import {
  applyConfigOverridesToDetails,
  buildAmPmOverrides,
  buildControlTemperatureOverrides,
  buildControlIconPositionOverrides,
  buildDateStyleOverrides,
  buildLayerVisibilityOverrides,
  buildLayerColorOverrides,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricStyleOverrides,
  buildStaticSeparatorOverrides,
  buildTimeStyleOverrides,
  buildTimeTrackingOverrides,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  corosWeekdayIndex,
  getAvailableComplications,
  getAmPmCapability,
  getFixedMetricCapabilities,
  inferStaticSeparators,
  mergeAssetReplacements,
  mergeConfigOverrides,
  normalizeRasterFontGlyphs,
  rasterFontSupportsText,
  rebaseNegativeControlChildren,
  scaleConfigRectValue
} from "../src/watchfaces/watchfaceStudio.ts";

assert.equal(corosWeekdayIndex(0), 6);
assert.equal(corosWeekdayIndex(1), 0);
assert.equal(corosWeekdayIndex(6), 5);

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
      colon_icon: "icon\\colon.png",
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
    aodConfig: {},
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

const details = {
  archiveId: "fixture",
  resolutions: [resolution(416, 23, 33), resolution(800, 44, 64)]
};

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
  heartRate: true,
  steps: true,
  temperature: true,
  calories: false
});
assert.equal(metricOverrides.length, 2);
const full = metricOverrides.find((entry) => entry.path.includes("800x800"));
assert.ok(full);
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
  { hours: { color: "#33ddff", scale: 1.5 } },
  true
);
const fullTimeStyle = timeStyleOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(fullTimeStyle?.values.time_hour_high_pos, "{74,84}");
assert.equal(fullTimeStyle?.values.time_hour_low_pos, "{164,84}");
assert.equal(fullTimeStyle?.values.time_hour_high_font, "cl_hh");
assert.equal(fullTimeStyle?.values.time_hour_low_font, "cl_hl");
const timeTrackingOverrides = buildTimeTrackingOverrides(withMetrics, 0.2);
const fullTimeTracking = timeTrackingOverrides.find((entry) =>
  entry.path.includes("800x800")
);
assert.equal(fullTimeTracking?.values.time_hour_high_pos, "{94,100}");
assert.equal(fullTimeTracking?.values.time_hour_low_pos, "{166,100}");
assert.equal(fullTimeTracking?.values.time_minute_high_pos, "{274,100}");
assert.equal(fullTimeTracking?.values.time_minute_low_pos, "{346,100}");
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
  "{60,312,260,392,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_week_font, "cl_weekday");
assert.equal(
  fullDateStyle?.values.english_date_month_rect,
  "{304,304,400,400,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_month_font, "cl_date_month");
assert.equal(
  fullDateStyle?.values.english_date_day_rect,
  "{408,328,456,376,hcenter|vcenter}"
);
assert.equal(fullDateStyle?.values.english_date_day_font, "cl_date_day");
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
assert.deepEqual(fullBounds.find((entry) => entry.id === "battery"), {
  id: "battery",
  label: "Battery",
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

console.log("COROS watchface studio tests passed");
