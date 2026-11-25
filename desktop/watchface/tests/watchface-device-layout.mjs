// Moved from CorosLink scripts/test-watchface-device-layout.cjs (c2ff5110): the config rewrites, without Electron
// (PNGs are written here, not by nativeImage). The archive-build half is covered by watchface-archive-config.
// Must not regress: a 12-frame month table only with a point-sized rect; no PACE 3 date swap on new exports.
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { finalizeWatchfaceDeviceLayout as finalize, restoreWatchfaceDateLayout as restore } from "../archive/deviceLayout";

function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const month = "{91,51,120,68,hcenter|vcenter}";
const day = "{45,28,89,74,hcenter|vcenter}";
const config = [
  "// Date positions from the reported PACE 3 face",
  "[watchface_id]=41", "[background_icon]=background.png",
  `[english_date_month_rect]=${month}`, "[english_date_month_font]=cl_date_month",
  `[english_date_day_rect]=${day}`, "[english_date_day_font]=cl_date_day",
  "[english_date_week_rect]={89,35,120,52,hcenter|vcenter}",
  "[french_date_month_rect]={96,52,114,66,hcenter|vcenter}",
  "[french_date_day_rect]={58,44,76,58,hcenter|vcenter}",
  "[time_hour_high_pos]={24,86}"
].join("\r\n") + "\r\n";
const parse = (text) => Object.fromEntries([...text.matchAll(/^\[([^\]]+)\]=([^\r\n]*)/gm)].map((m) => [m[1], m[2]]));
// The v0.1.41 output, reproduced independently of the exporter.
function legacyConfig(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = text.slice(bom.length);
  const values = parse(body);
  return bom + "// CorosLink device layout: pace-3-date-rects-v1" + (body.includes("\r\n") ? "\r\n" : "\n") +
    body.replace(/^(\[english_date_(month|day)_rect\]=)[^\r\n]*/gm, (_, prefix, part) => prefix + values[`english_date_${part === "month" ? "day" : "month"}_rect`]);
}

// Preserve CRLF/LF/BOM, per-field alignment, disabled fields, and all assets.
for (const text of [config, config.replaceAll("\r\n", "\n"), "﻿" + config, config.replace(month, "{91,51,120,68,left|top}")]) {
  const entries = [{ name: "watchface_240x240/config.txt", data: Buffer.from(text) },
    { name: "watchface_240x240/AODconfig.txt", data: Buffer.from(text) },
    { name: "watchface_800x800/CorosLinkAODconfig.txt", data: Buffer.from(text) },
    { name: "watchface_customize.png", data: png(20, 20) }];
  const result = finalize(entries);
  assert.deepEqual(result, entries, "new exports preserve authored positions without a marker");
  assert.equal(restore(result[0].data.toString()), text);
  assert.equal(restore(text), text, "unmarked starters are already authoring layouts");
  assert.deepEqual(finalize(result), result, "finalization must be idempotent");
  const legacy = legacyConfig(text);
  assert.equal(restore(legacy), text, "legacy swapped output restores authored coordinates");
  assert.equal(restore(restore(legacy)), text, "legacy restoration happens once");
  assert.deepEqual(finalize([{ ...entries[0], data: Buffer.from(legacy) }, ...entries.slice(1)]), entries, "rebuilding removes the legacy swap and marker");
}
for (const text of [config.replace(`[english_date_day_rect]=${day}\r\n`, ""),
  config.replace(`[english_date_month_rect]=${month}`, "[english_date_month_rect]="),
  config + `[english_date_day_rect]=${day}\r\n`]) {
  const entries = [{ name: "watchface_240x240/config.txt", data: Buffer.from(text) }];
  assert.deepEqual(finalize(entries), entries, "incomplete or ambiguous pairs stay untouched");
}

// A 12-frame month table is drawn as one label only from a point rect at its top-left (confirmed on a PACE Pro);
// a box makes the watch compose digits.
const labelConfig = config.replace("[english_date_month_font]=cl_date_month", "[english_date_month_font]=recovered\\group-09")
  .replace("[french_date_month_rect]={96,52,114,66,hcenter|vcenter}", "[chinese_date_month_rect]={88,36,132,59,right|vcenter}\r\n[chinese_date_month_font]=recovered\\group-09");
const labelFrames = Array.from({ length: 12 }, (_, i) => ({ name: `watchface_240x240/recovered/group-09/${String(i).padStart(2, "0")}.png`, data: png(44, 23) }));
for (const name of ["watchface_240x240/config.txt", "watchface_240x240/AODconfig.txt"]) {
  const [exported] = finalize([{ name, data: Buffer.from(labelConfig) }, ...labelFrames]);
  const values = parse(exported.data.toString());
  assert.equal(values.chinese_date_month_rect, "{88,36,88,36,right|vcenter}", "label month exports as its top-left point");
  assert.equal(values.english_date_month_rect, "{84,48,84,48,hcenter|vcenter}", "a box wider than the label keeps the label centered");
  assert.equal(values.english_date_day_rect, day, "digit fields keep their box");
  assert.equal(restore(exported.data.toString()), labelConfig, "reopening restores the editable boxes");
  assert.deepEqual(finalize([exported, ...labelFrames])[0].data, exported.data, "label collapse is idempotent");
  const handEdited = exported.data.toString().replace("{88,36,88,36,", "{90,40,90,40,");
  assert.equal(parse(restore(handEdited)).chinese_date_month_rect, "{90,40,90,40,right|vcenter}", "a hand-moved point stays as written");
  const digitBox = labelConfig.replace("{88,36,132,59,right|vcenter}", "{88,36,176,59,right|vcenter}");
  assert.equal(parse(finalize([{ name, data: Buffer.from(digitBox) }, ...labelFrames])[0].data.toString()).chinese_date_month_rect,
    "{88,36,176,59,right|vcenter}", "a two-glyph box stays a digit month");
  assert.deepEqual(finalize([{ name, data: Buffer.from(labelConfig) }, ...labelFrames.slice(0, 10)])[0].data,
    Buffer.from(labelConfig), "a 10-frame digit font is never collapsed");
}

console.log("device layout tests passed");
