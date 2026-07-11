import assert from "node:assert/strict";
import {
  applyConfigOverridesToDetails,
  buildLayoutOverrides,
  buildMetricOverrides,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  getAvailableComplications,
  getFixedMetricCapabilities,
  mergeConfigOverrides
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
    icons: []
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

const withMetrics = applyConfigOverridesToDetails(details, metricOverrides);
const fullBounds = computeLayoutGroupBounds(withMetrics.resolutions[1]);
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
  heartRate: { dx: 10, dy: 20 },
  complication: { dx: 20, dy: 30 }
});
const shiftedFull = layoutOverrides.find((entry) => entry.path.includes("800x800"));
assert.equal(
  shiftedFull?.values.heartreate_level_rect,
  "{144,596,276,660,hcenter|vcenter}"
);
assert.equal(shiftedFull?.values.rect_control1_pos, "{120,230}");
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
