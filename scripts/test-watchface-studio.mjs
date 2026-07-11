import assert from "node:assert/strict";
import {
  applyConfigOverridesToDetails,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricStyleOverrides,
  buildStaticSeparatorOverrides,
  buildTimeStyleOverrides,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  getAvailableComplications,
  getFixedMetricCapabilities,
  inferStaticSeparators,
  mergeAssetReplacements,
  mergeConfigOverrides,
  scaleConfigRectValue
} from "../src/watchfaces/watchfaceStudio.ts";

function digitFiles(width, height, directory, folder) {
  return Array.from({ length: 10 }, (_, digit) => ({
    path: `${directory}/${folder}/${String(digit).padStart(2, "0")}.png`,
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
      english_date_week_rect: `{${Math.round(width * 0.1)},${Math.round(width * 0.4)},${Math.round(width * 0.3)},${Math.round(width * 0.48)},hcenter|vcenter}`,
      english_date_month_rect: `{${Math.round(width * 0.4)},${Math.round(width * 0.4)},${Math.round(width * 0.48)},${Math.round(width * 0.48)},hcenter|vcenter}`,
      english_date_day_rect: `{${Math.round(width * 0.5)},${Math.round(width * 0.4)},${Math.round(width * 0.58)},${Math.round(width * 0.48)},hcenter|vcenter}`,
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
      }
    ],
    icons: [
      {
        path: `${directory}/icon/cut.png`,
        width: Math.round(width * 0.2),
        height: Math.round(width * 0.3)
      }
    ]
  };
}

const details = {
  archiveId: "fixture",
  resolutions: [resolution(416, 23, 33), resolution(800, 44, 64)]
};

assert.deepEqual(
  getFixedMetricCapabilities(details),
  [
    { id: "heartRate", label: "Heart rate", active: false },
    { id: "steps", label: "Steps", active: false },
    { id: "calories", label: "Calories", active: false },
    { id: "elevation", label: "Elevation", active: false }
  ]
);
assert.deepEqual(
  getAvailableComplications(details).map(({ id }) => id),
  ["heartRate", "steps"]
);

const metricOverrides = buildMetricOverrides(details, {
  heartRate: true,
  steps: true,
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
assert.equal(full.values.kcal_rect, "");
assert.equal(full.values.kcal_font, "");
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
  { heartRate: { color: "#ff3366", scale: 1.5 } },
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

const merged = mergeConfigOverrides(metricOverrides, layoutOverrides);
assert.equal(merged.length, 2);
assert.equal(
  merged.find((entry) => entry.path.includes("800x800"))?.values.heartreate_level_rect,
  "{144,596,276,660,hcenter|vcenter}"
);

console.log("COROS watchface studio tests passed");
