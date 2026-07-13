#!/usr/bin/env node

/** Summarize the stable control slots in raw (614R) or packed (614A) output. */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!inputPath) {
  throw new Error("Usage: node scripts/summarize-coros-raw-bin.mjs <watchface.bin>");
}

const bytes = await fs.readFile(inputPath);
const magic = bytes.subarray(0, 4).toString("latin1");
if (!["614R", "614A"].includes(magic)) {
  throw new Error(`Unsupported magic ${JSON.stringify(magic)} in ${inputPath}`);
}

const has = (offset, length = 1) => offset >= 0 && offset + length <= bytes.length;
const u16 = (offset) => (has(offset, 2) ? bytes.readUInt16LE(offset) : undefined);
const u32 = (offset) => (has(offset, 4) ? bytes.readUInt32LE(offset) : undefined);
const anyNonZero = (offset, length) => has(offset, length) && bytes.subarray(offset, offset + length).some(Boolean);

const CONTROL_RECORD = 0x33a;
const WEATHER_RECORD = 0xc40;
const AOD_WEATHER_RECORD = 0xc80;

const temperature = (record) => ({
  rect: {
    x0: u16(record + 0x16),
    y0: u16(record + 0x18),
    x1: u16(record + 0x1a),
    y1: u16(record + 0x1c)
  },
  digitsPointer: u32(record + 0x20),
  signPointer: u32(record + 0x24),
  suffixPointer: u32(record + 0x28)
});

const summary = {
  source: inputPath,
  magic,
  sizeBytes: bytes.length,
  headerIdentity: u32(4),
  selectableControl: {
    offset: `0x${CONTROL_RECORD.toString(16)}`,
    present: anyNonZero(CONTROL_RECORD, 0xf4),
    x: u32(CONTROL_RECORD),
    y: u32(CONTROL_RECORD + 4)
  },
  weatherTemperature: {
    normalOffset: `0x${WEATHER_RECORD.toString(16)}`,
    normalPresent: anyNonZero(WEATHER_RECORD, 0x40),
    normalWeatherPointer: u32(WEATHER_RECORD + 0x12),
    normalTemperature: temperature(WEATHER_RECORD),
    aodOffset: `0x${AOD_WEATHER_RECORD.toString(16)}`,
    aodPresent: anyNonZero(AOD_WEATHER_RECORD, 0x40),
    aodWeatherPointer: u32(AOD_WEATHER_RECORD + 0x12),
    aodTemperature: temperature(AOD_WEATHER_RECORD)
  }
};

console.log(JSON.stringify(summary, null, 2));
