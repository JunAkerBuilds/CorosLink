#!/usr/bin/env node

/**
 * Build a small, controlled matrix of COROS source archives for testing the
 * local watch-face compiler.  Each archive is identical except for the
 * fields declared below, so an emitted control record can be attributed to a
 * specific parser-recognised config group.
 *
 * Usage:
 *   node --experimental-strip-types scripts/build-coros-weather-probes.mjs \
 *     [source.zip] [output-directory]
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import unzipper from "unzipper";
import { createStoreZip } from "../electron/zipStore.ts";

const defaultSource = "/Users/aker/Downloads/COROS watchfaces/weatherandtemp-068ea35f.zip";
const sourcePath = path.resolve(process.argv[2] ?? defaultSource);
const outputDirectory = path.resolve(process.argv[3] ?? "/tmp/coros-weather-probes");

const LAYOUT_VALUES = {
  watchface_416x416: {
    slotPosition: "{129,358}",
    temperatureIconPosition: "{9,0}",
    wideRect: "{43,0,157,33,hcenter|vcenter}",
    integerRect: "{43,0,93,33,hcenter|vcenter}",
    decimalRect: "{96,0,120,33,hcenter|vcenter}",
    minuteRect: "{96,0,157,33,hcenter|vcenter}"
  },
  watchface_800x800: {
    slotPosition: "{249,687}",
    temperatureIconPosition: "{18,0}",
    wideRect: "{82,0,302,64,hcenter|vcenter}",
    integerRect: "{82,0,182,64,hcenter|vcenter}",
    decimalRect: "{186,0,232,64,hcenter|vcenter}",
    minuteRect: "{186,0,302,64,hcenter|vcenter}"
  }
};

const probes = [
  {
    id: "t0-baseline",
    description: "Original source archive; establishes the no-dynamic-control baseline."
  },
  {
    id: "t1-control-slot",
    description: "Only gives the selectable control a visible position.",
    values: (layout) => ({ rect_control1_pos: layout.slotPosition })
  },
  {
    id: "t2-temperature-core",
    description: "Populates every normal selectable-temperature presentation field.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      control_temperature_icon_pos: layout.temperatureIconPosition,
      control_temperature_icon: "icon\\step.png",
      control_temperature_rect: layout.wideRect,
      control_temperature_font: "cl_ctemp",
      control_temperature_font_color: "0xFFFFFF",
      control_temperature_negative_sign_icon: "icon\\negative.png",
      control_negative_sign_icon: "icon\\negative.png"
    })
  },
  {
    id: "t3-temperature-numeric",
    description: "T2 plus all parser-recognised split-number and point fields.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      control_temperature_icon_pos: layout.temperatureIconPosition,
      control_temperature_icon: "icon\\step.png",
      control_temperature_rect: layout.wideRect,
      control_temperature_font: "cl_ctemp",
      control_temperature_font_color: "0xFFFFFF",
      control_temperature_negative_sign_icon: "icon\\negative.png",
      control_temperature_integer_rect: layout.integerRect,
      control_temperature_decimal_rect: layout.decimalRect,
      control_temperature_hour_rect: layout.integerRect,
      control_temperature_minute_rect: layout.minuteRect,
      control_point_icon: "icon\\colon.png",
      control_negative_sign_icon: "icon\\negative.png"
    })
  },
  {
    id: "t4-temperature-trend",
    description: "T3 plus temperature trend icons used by the parser's control family.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      control_temperature_icon_pos: layout.temperatureIconPosition,
      control_temperature_icon: "icon\\step.png",
      control_temperature_rect: layout.wideRect,
      control_temperature_font: "cl_ctemp",
      control_temperature_font_color: "0xFFFFFF",
      control_temperature_negative_sign_icon: "icon\\negative.png",
      control_temperature_integer_rect: layout.integerRect,
      control_temperature_decimal_rect: layout.decimalRect,
      control_temperature_hour_rect: layout.integerRect,
      control_temperature_minute_rect: layout.minuteRect,
      control_temperature_down_icon: "icon\\step.png",
      control_temperature_flat_icon: "icon\\kcal.png",
      control_temperature_up_icon: "icon\\hr.png",
      control_point_icon: "icon\\colon.png",
      control_negative_sign_icon: "icon\\negative.png"
    })
  },
  {
    id: "t5-barometer-control",
    description: "Checks whether the same selectable-control plumbing accepts barometer fields.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      control_barometer_icon_pos: layout.temperatureIconPosition,
      control_barometer_icon: "icon\\step.png",
      control_barometer_down_icon: "icon\\step.png",
      control_barometer_flat_icon: "icon\\kcal.png",
      control_barometer_up_icon: "icon\\hr.png",
      control_barometer_integer_rect: layout.integerRect,
      control_barometer_decimal_rect: layout.decimalRect,
      control_barometer_font: "13x19",
      control_barometer_font_color: "0xFFFFFF",
      control_point_icon: "icon\\colon.png"
    })
  },
  {
    id: "t6-selectable-temperature-only",
    description: "T4 with direct weather/temperature fields cleared; isolates the selectable path.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      weather_icon_pos: "",
      weather_icon_dir: "",
      temperature_rect: "",
      temperature_font: "",
      temperature_font_color: "",
      temperature_negative_sign_icon: "",
      control_temperature_icon_pos: layout.temperatureIconPosition,
      control_temperature_icon: "icon\\step.png",
      control_temperature_rect: layout.wideRect,
      control_temperature_font: "cl_ctemp",
      control_temperature_font_color: "0xFFFFFF",
      control_temperature_negative_sign_icon: "icon\\negative.png",
      control_temperature_integer_rect: layout.integerRect,
      control_temperature_decimal_rect: layout.decimalRect,
      control_temperature_hour_rect: layout.integerRect,
      control_temperature_minute_rect: layout.minuteRect,
      control_temperature_down_icon: "icon\\step.png",
      control_temperature_flat_icon: "icon\\kcal.png",
      control_temperature_up_icon: "icon\\hr.png",
      control_point_icon: "icon\\colon.png",
      control_negative_sign_icon: "icon\\negative.png"
    })
  },
  {
    id: "t7-speculative-flags",
    description: "T4 plus one low-confidence pass over commonly guessed enable/type keys.",
    values: (layout) => ({
      rect_control1_pos: layout.slotPosition,
      control_temperature_icon_pos: layout.temperatureIconPosition,
      control_temperature_icon: "icon\\step.png",
      control_temperature_rect: layout.wideRect,
      control_temperature_font: "cl_ctemp",
      control_temperature_font_color: "0xFFFFFF",
      control_temperature_negative_sign_icon: "icon\\negative.png",
      control_temperature_integer_rect: layout.integerRect,
      control_temperature_decimal_rect: layout.decimalRect,
      control_temperature_hour_rect: layout.integerRect,
      control_temperature_minute_rect: layout.minuteRect,
      control_temperature_down_icon: "icon\\step.png",
      control_temperature_flat_icon: "icon\\kcal.png",
      control_temperature_up_icon: "icon\\hr.png",
      control_point_icon: "icon\\colon.png",
      control_negative_sign_icon: "icon\\negative.png",
      weather_enable: "1",
      dynamic_data_enable: "1",
      control_type: "temperature",
      data_type: "temperature",
      control_data_type: "temperature",
      control_item_type: "temperature",
      watchface_type: "diy",
      template_type: "diy"
    })
  },
  {
    id: "t8-info-app-416",
    description: "Baseline config with info.json's declared primary layout changed from 800px to 416px.",
    infoValues: { m_app: "watchface_416x416" }
  },
  {
    id: "t9-info-diy-version-4",
    description: "Baseline config with info.json's DIY version raised to the source format version.",
    infoValues: { o_diy_version: 4 }
  }
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setConfigValue(buffer, key, value) {
  const text = buffer.toString("latin1");
  const line = `[${key}]=${value}`;
  const expression = new RegExp(`\\[${escapeRegExp(key)}\\]=[^\\r\\n]*`);

  if (expression.test(text)) {
    return Buffer.from(text.replace(expression, line), "latin1");
  }

  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  return Buffer.from(`${text}${text.endsWith("\n") ? "" : lineEnding}${line}${lineEnding}`, "latin1");
}

function applyValues(buffer, values) {
  return Object.entries(values).reduce(
    (next, [key, value]) => setConfigValue(next, key, value),
    buffer
  );
}

async function readEntries(zipPath) {
  const directory = await unzipper.Open.file(zipPath);
  return Promise.all(
    directory.files
      .filter((entry) => entry.type === "File")
      .map(async (entry) => ({ name: entry.path, data: await entry.buffer() }))
  );
}

const sourceEntries = await readEntries(sourcePath);
const configEntries = sourceEntries.filter((entry) => /\/config\.txt$/i.test(entry.name));

if (configEntries.length === 0) {
  throw new Error(`No layout config.txt entries found in ${sourcePath}`);
}

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const manifest = {
  source: sourcePath,
  generatedAt: new Date().toISOString(),
  layoutConfigs: configEntries.map((entry) => entry.name),
  probes: []
};

for (const probe of probes) {
  const changes = {};
  const entries = sourceEntries.map((entry) => {
    if (entry.name === "info.json" && probe.infoValues) {
      changes[entry.name] = probe.infoValues;
      const info = { ...JSON.parse(entry.data.toString("utf8")), ...probe.infoValues };
      return { ...entry, data: Buffer.from(`${JSON.stringify(info)}\n`, "utf8") };
    }
    const match = entry.name.match(/^(watchface_\d+x\d+)\/config\.txt$/i);
    if (!match || !probe.values) return entry;

    const values = probe.values(LAYOUT_VALUES[match[1]]);
    changes[entry.name] = values;
    return { ...entry, data: applyValues(entry.data, values) };
  });
  const archivePath = path.join(outputDirectory, `${probe.id}.zip`);
  await fs.writeFile(archivePath, createStoreZip(entries));
  manifest.probes.push({
    id: probe.id,
    archive: archivePath,
    description: probe.description,
    changes
  });
}

await fs.writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${probes.length} compiler probes in ${outputDirectory}`);
