#!/usr/bin/env node
import assert from "node:assert/strict";
import { chartConfigValues, decodeCorosLayout, expandChartColor, readLayoutHeaders } from "./lib/coros-bin-layout.mjs";

const HEADER = 0x1164;
const AOD = HEADER + 48; // Deliberately not adjacent: follow the pointer.
const DATA = AOD + HEADER;
const bytes = Buffer.alloc(DATA + 512);
for (const offset of [0, AOD]) {
  bytes.write("614A", offset, "latin1");
  bytes.writeUInt16LE(HEADER, offset + 0x138);
  bytes[offset + 0x13a] = 4;
}
bytes.writeUInt32LE(AOD, 0x322);
const blocks = [0, 1, 2, 3].map((index) => ({ index, offset: DATA + 128 + index * 64, frameCount: index < 3 ? 41 : 10 }));
const pointer = (field, index) => bytes.writeUInt32LE(blocks[index].offset, field);
const point = (offset, x, y) => { bytes.writeInt32LE(x, offset); bytes.writeInt32LE(y, offset + 4); };
const rect = (offset, values, align = 18) => { values.forEach((n, i) => bytes.writeInt16LE(n, offset + i * 2)); bytes[offset + 8] = align; };
pointer(0xc52, 0);
pointer(0xc92, 1);
pointer(AOD + 0xc52, 2);
point(0xc4a, -17, 70000);
point(AOD + 0xc4a, 9, -8);
rect(0xc56, [-30, -2, 28, 29], 20);
pointer(0xc60, 3);
pointer(AOD + 0xc60, 3); // A font pointer does not activate a zero-size rect.
point(0x3fc, 0, 0);
pointer(0x404, 0);
rect(0x408, [0, 0, 40, 20]);
pointer(0x412, 3);
pointer(AOD + 0x420, 0); // Dormant AOD sunrise, no value geometry.
bytes.writeUInt32LE(DATA, 0x316);
rect(DATA, [280, 240, 335, 269], 17);
pointer(DATA + 10, 3);
pointer(0xb00, 0); // A bitmap pointer outside the known schema is retained.
// WFChartInfo at 0xdc4 (SetChart): graph geometry, a rise/set readout with a
// shared font, the solar angle in a temperature-like slot, a dormant readout
// icon without a value rectangle, and the keyless heart-rate member.
rect(0xdd0, [89, 273, 323, 325]);
bytes.writeUInt16LE(7, 0xdda); bytes.writeUInt16LE(3, 0xddc);
bytes.writeUInt32LE(0xaaaaaa, 0xdde); bytes.writeUInt32LE(0x15, 0xde2); // RGB888 and rgb222 forms.
bytes.writeUInt32LE(0x555555, 0xe5e); bytes.writeUInt32LE(0x3f, 0xe62); bytes[0xe66] = 4;
point(0xdc4, 0, 0); pointer(0xdcc, 0); // chart background
point(0xe68, 129, 346); pointer(0xe70, 1); pointer(0xe74, 2); rect(0xe78, [172, 346, 218, 380]); rect(0xe82, [231, 346, 276, 380]); pointer(0xe8c, 3);
point(0xe9c, 200, 47); pointer(0xea4, 1); rect(0xea8, [236, 47, 290, 77], 17); pointer(0xeb2, 3);
point(0xf04, 77, 293); pointer(0xf0c, 2); // stress icon, empty value rectangle
point(0xf86, 227, 293); pointer(0xf8e, 2); rect(0xf92, [270, 293, 335, 328]); pointer(0xf9c, 3);
pointer(0xfa4, 1); pointer(0xfa8, 1);
pointer(0xdb4, 0); pointer(0x308, 0); // fish pointer and second hand share one strip
point(0x2f8, 207, 207);

const result = decodeCorosLayout(bytes, blocks);
const get = (mode, id) => result.modes.find((m) => m.mode === mode).elements.find((e) => e.id === id);
assert.deepEqual(result.modes.map((m) => m.offset), [0, AOD]);
assert.deepEqual(get("normal", "weather.day").position, { x: -17, y: 70000 });
assert.equal(get("normal", "weather.day").asset.group, 0);
assert.equal(get("normal", "weather.night").asset.group, 1);
assert.equal(get("aod", "weather.day").asset.group, 2);
assert.deepEqual(get("aod", "weather.day").position, { x: 9, y: -8 });
assert.equal(get("normal", "weather.temperature").rect.x0, -30);
assert.equal(get("normal", "weather.temperature").rect.horizontal, "right");
assert.equal(get("normal", "weather.temperature").rect.vertical, "center");
assert.equal(get("aod", "weather.temperature").active, false);
assert.equal(get("normal", "control.elevation.icon").active, true);
assert.equal(get("aod", "control.sunrise.icon").active, false);
assert.equal(get("normal", "heartRate").geometryOffset, DATA);
assert.equal(get("normal", "heartRate").rect.x0, 280);
assert.equal(get("normal", "heartRate").asset.group, 3);
assert(result.modes[0].unmappedBitmapReferences.some((r) => r.fieldOffset === 0xb00));
assert.deepEqual(result.modes[0].unmappedBitmapReferences.map((r) => r.fieldOffset), [0xb00], "every chart, fish and pointer link is classified");
const chart = result.modes[0].chart;
assert.deepEqual([chart.rect.x0, chart.rect.y1, chart.barWidth, chart.barInterval, chart.curvesWidth], [89, 325, 7, 3, 4]);
assert.deepEqual([chart.selectedBarColor, chart.unselectedBarColor, chart.curvesUpperColor, chart.curvesLowerColor], [0xaaaaaa, 0x555555, 0x555555, 0xffffff]);
assert.equal(expandChartColor(0x2a), 0xaaaaaa);
assert.equal(Object.fromEntries(chartConfigValues(chart)).chart_curves_lower_color, "0xffffff");
assert.equal(Object.fromEntries(chartConfigValues(chart)).chart_rect, "{89,273,323,325,hcenter|vcenter}");
assert.deepEqual(get("normal", "chart.sunrise.icon").config, { position: "chart_sunrise_icon_pos", asset: "chart_sunrise_icon" });
assert.equal(get("normal", "chart.sunrise.setIcon").config.asset, "chart_sunset_icon");
assert.equal(get("normal", "chart.sunrise.setIcon").asset.group, 2);
assert.deepEqual([get("normal", "chart.sunrise.hour").rect.x0, get("normal", "chart.sunrise.minute").rect.x0], [172, 231]);
assert.equal(get("normal", "chart.sunrise.minute").config.asset, "chart_sunrise_font");
assert.deepEqual(get("normal", "chart.sunAngle.icon").position, { x: 200, y: 47 });
assert.equal(get("normal", "chart.sunAngle.value").rect.horizontal, "left");
assert.equal(get("normal", "chart.sunAngle.value").config.rect, "chart_sun_angle_rect");
assert.equal(get("normal", "chart.stress.icon").active, false, "a readout icon without a value rectangle is dormant");
assert.equal(get("normal", "chart.stress.value"), undefined);
assert.equal(get("normal", "chart.heartRate.value").active, true);
assert.equal(get("normal", "chart.heartRate.value").config, undefined, "no config key is invented for WFChartInfo.heart_rate");
assert.equal(get("normal", "chart.colon").config.asset, "chart_colon_icon");
assert.equal(get("normal", "fish.pointer").config.asset, "fish_pointer_icon");
assert.equal(get("normal", "fish.pointer").active, false, "a fish pointer without a fishing display stays dormant");
assert.equal(get("normal", "time.secondHand").config.asset, "time_second_icon");
assert.deepEqual(result.modes[0].pointerCenter, { x: 207, y: 207 });
assert.equal(result.modes[1].pointerCenter, undefined, "no hands, no centre");
assert.equal(get("aod", "chart.background"), undefined);
assert.equal(result.modes[1].chart, undefined, "an empty chart rectangle produces no chart block");
assert.equal(result.modes[0].rawHeaderHex, bytes.subarray(0, HEADER).toString("hex"));
assert.equal(result.warnings.length, 0);

const badIndirect = Buffer.from(bytes);
badIndirect.writeUInt32LE(bytes.length - 4, 0x316);
assert(decodeCorosLayout(badIndirect, blocks).warnings.some((w) => w.includes("invalid indirect")));
const badBitmap = Buffer.from(bytes);
badBitmap.writeUInt32LE(bytes.length + 123, 0xc60);
assert(decodeCorosLayout(badBitmap, blocks).warnings.some((w) => w.includes("unresolved bitmap")));
assert.throws(() => readLayoutHeaders(bytes.subarray(0, AOD + 100)), /Invalid aod/);
const overlap = Buffer.from(bytes); overlap.writeUInt32LE(4, 0x322);
assert.throws(() => readLayoutHeaders(overlap), /overlaps/);
for (const size of [0x100, 0x3000]) {
  const unknown = Buffer.from(bytes); unknown.writeUInt16LE(size, 0x138);
  assert.throws(() => readLayoutHeaders(unknown), /Unsupported layout size/);
}
assert.throws(() => readLayoutHeaders(Buffer.from("614Bxxxxxxxx".padEnd(0x400, "\0"))), /Invalid normal/);
const single = Buffer.alloc(0x1202); single.write("614A"); single.writeUInt16LE(0x1202, 0x138);
assert.equal(readLayoutHeaders(single).length, 1);
assert.equal(readLayoutHeaders(single)[0].length, 0x1202);
assert.throws(() => readLayoutHeaders(single.subarray(0, 0x1201)), /Truncated/);

// NOMAD v2 uses 0x11a0 headers. Follow its AOD pointer and retain the extra
// trailing records while decoding the shared clock/weather geometry unchanged.
const nomadHeader = 0x11a0;
const nomadAod = nomadHeader + 24;
const nomadData = nomadAod + nomadHeader;
const nomad = Buffer.alloc(nomadData + 128);
for (const [base, version] of [[0, 2], [nomadAod, 0]]) {
  nomad.write("614A", base);
  nomad.writeUInt16LE(nomadHeader, base + 0x138);
  nomad[base + 0x13a] = version;
  nomad.writeInt32LE(59, base + 0x1b0);
  nomad.writeInt32LE(116, base + 0x1b4);
  nomad.writeUInt32LE(nomadData + (base ? 64 : 0), base + 0x1b8);
}
nomad.writeUInt32LE(nomadAod, 0x322);
nomad.writeUInt32LE(nomadData, 0xb00); // A bitmap link outside the schema is retained.
const nomadLayout = decodeCorosLayout(nomad, [{ index: 0, offset: nomadData }, { index: 1, offset: nomadData + 64 }]);
assert.deepEqual(nomadLayout.modes.map(m => [m.offset, m.length, m.version]), [[0, nomadHeader, 2], [nomadAod, nomadHeader, 0]]);
for (const [index, mode] of nomadLayout.modes.entries()) {
  const clock = mode.elements.find(e => e.id === "time.hour_high");
  assert.deepEqual(clock.position, { x: 59, y: 116 });
  assert.equal(clock.asset.group, index);
}
assert(nomadLayout.modes[0].unmappedBitmapReferences.some(r => r.relativeOffset === 0xb00));
assert.equal(nomadLayout.modes[0].rawHeaderHex, nomad.subarray(0, nomadHeader).toString("hex"));
assert.throws(() => readLayoutHeaders(nomad.subarray(0, nomadData - 1)), /Truncated aod/);
// 260px MIP faces ("062R") use the same record table but a version-0 header
// without a size field: the background pointer ends it, and records that would
// sit beyond it (weather, chart) are skipped instead of read from bitmap data.
const mipHeader = 0xbaa, mipData = mipHeader; // the background block starts exactly at the header end
const mip = Buffer.alloc(mipData + 256);
mip.write("062R", 0, "latin1");
mip.writeUInt32LE(mipData, 0x1a); // background bitmap = first block = header end
mip.writeInt32LE(25, 0x1b0); mip.writeInt32LE(102, 0x1b4); mip.writeUInt32LE(mipData + 64, 0x1b8);
mip.writeUInt32LE(mipData + 128, 0x664); mip.writeInt16LE(10, 0x65a); mip.writeInt16LE(10, 0x65c); mip.writeInt16LE(60, 0x65e); mip.writeInt16LE(30, 0x660);
mip.writeUInt32LE(mipData + 64, 0xc52); // would be a weather icon in a longer header
const mipLayout = decodeCorosLayout(mip, [{ index: 0, offset: mipData }, { index: 1, offset: mipData + 64 }, { index: 2, offset: mipData + 128 }]);
assert.deepEqual([mipLayout.screen.width, mipLayout.magic, mipLayout.variant, mipLayout.modes.length], [260, "062R", "R", 1]);
assert.deepEqual([mipLayout.modes[0].length, mipLayout.modes[0].version], [mipHeader, 0]);
assert.deepEqual(mipLayout.modes[0].elements.find(e => e.id === "time.hour_high").position, { x: 25, y: 102 });
assert.equal(mipLayout.modes[0].elements.find(e => e.id === "date.germany.week").asset.group, 2);
assert.equal(mipLayout.modes[0].elements.find(e => e.id === "weather.day"), undefined, "records past the header end are not decoded");
assert.equal(mipLayout.modes[0].chart, undefined);
assert.equal(mipLayout.modes[0].unmappedBitmapReferences.length, 0);
assert.equal(mipLayout.modes[0].rawHeaderHex.length, mipHeader * 2);
assert.throws(() => readLayoutHeaders(mip.subarray(0, mipHeader - 1)), /Truncated normal/);
console.log("COROS layout: signed geometry, alignment, day/night/AOD separation, indirect HR, chart block, dormant resources, unknown links, MIP headers and bounds checks passed.");
