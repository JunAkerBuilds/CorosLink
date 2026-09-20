export interface CorosBinPoint { x: number; y: number }
export interface CorosBinRect {
  x0: number; y0: number; x1: number; y1: number; align: number;
  horizontal: "left" | "center" | "right"; vertical: "top" | "center" | "bottom";
}
export interface CorosBinReference { pointer: number; pointerHex: string; fieldOffset: number; group: number | null }
export interface CorosBinElement {
  id: string; kind: "icon" | "number" | "resource" | "combinedDate";
  position?: CorosBinPoint; rect?: CorosBinRect; geometryOffset?: number;
  control?: string; indirectFieldOffset?: number;
  /** Chart readout group (`WFChartInfo` member) an icon shares with its value rectangles. */
  chart?: string;
  asset?: CorosBinReference; assets?: (CorosBinReference | null)[];
  active: boolean; evidence: string; note?: string; inactiveReason?: string;
  config?: { position?: string; rect?: string; asset: string };
}
/** Shared graph geometry and styling from `WFChartInfo`; colors are 0xRRGGBB. */
export interface CorosBinChart {
  rect: CorosBinRect; barWidth: number; barInterval: number; curvesWidth: number;
  selectedBarColor: number; unselectedBarColor: number; curvesUpperColor: number; curvesLowerColor: number;
  /** Stored words before any RGB222 expansion, for exact retention. */
  rawColors: { selectedBar: number; unselectedBar: number; curvesUpper: number; curvesLower: number };
}
/**
 * The calorie goal arc the firmware sweeps over its backdrop, stored right
 * after the calorie value as eight int16s. Official PARTICLES keeps its bottom
 * arc here: centre (208,208), radius 195, −138°…−41°, ten pixels wide. Angles
 * use the same clock convention as the DIY `kcal_progress_arc` key. The
 * trailing word is read as an rgb222 color; that reading and the remainder
 * ("background") direction come from the official artwork, not the compiler.
 */
export interface CorosBinProgressArc {
  centerX: number; centerY: number; radiusX: number; radiusY: number;
  startAngle: number; endAngle: number; strokeWidth: number;
  /** Stored trailing word, kept exactly as found. */
  rawColor: number; color: number;
}
interface BitmapLink { index: number; offset: number | string; encoding?: number | string; viaPointer?: boolean; note?: string }
type PositionedField = [string, number, number, string, string];

// Read-only recovery of COROS's compiled layout family. Offsets were checked
// against WFBinExporter in COROS 4.9.9 and official PLANET v4 / NOMAD v2 /
// DASHBOARD v4 binaries. This is a partial format decoder, not a claim that
// unknown records can be recompiled. Every generation shares one record table
// that simply ends earlier in older/smaller headers: 0xbaa (260px MIP v0, after
// the date tables), 0xfd8 (416px v2, after the chart block), 0x1164 (v4),
// 0x11a0 (NOMAD v2) and 0x1202 (4.9.9 exporter). Records past a header's end
// do not exist and are skipped rather than guessed.
export const hex = (value: number) => `0x${value.toString(16)}`;
/** The magic is the screen size reversed plus a variant letter: `614A` = A416, `062R` = R260. */
export function parseCorosFaceMagic(magic: string): { size: number; variant: "A" | "R" } | null {
  const match = magic.match(/^(\d)(\d)(\d)([AR])$/);
  if (!match) return null;
  const size = Number(`${match[3]}${match[2]}${match[1]}`);
  return size >= 200 && size <= 800 ? { size, variant: match[4] as "A" | "R" } : null;
}
const MIN_HEADER = 0x340, MAX_HEADER = 0x2000;

export function readLayoutHeaders(bytes: Buffer) {
  const magic = bytes.length >= 4 ? bytes.toString("latin1", 0, 4) : "";
  const face = parseCorosFaceMagic(magic);
  const header = (offset: number, mode: "normal" | "aod") => {
    if (offset < 0 || offset + MIN_HEADER > bytes.length || !face || bytes.toString("latin1", offset, offset + 4) !== magic) {
      throw new Error(`Invalid ${mode} layout header at ${hex(offset)}.`);
    }
    // Version-0 headers leave the size field empty; the background bitmap is
    // always the first block, so its pointer marks the end of that header.
    const declared = bytes.readUInt16LE(offset + 0x138);
    const length = declared || (mode === "normal" ? bytes.readUInt32LE(offset + 0x1a) : 0);
    if (length < MIN_HEADER || length > MAX_HEADER) throw new Error(`Unsupported layout size ${hex(length)}; refusing to guess offsets.`);
    if (offset + length > bytes.length) throw new Error(`Truncated ${mode} layout.`);
    return { mode, offset, length, version: bytes[offset + 0x13a], magic, width: face.size, height: face.size, variant: face.variant };
  };
  const normal = header(0, "normal");
  const aodOffset = normal.length >= 0x326 ? bytes.readUInt32LE(0x322) : 0;
  if (!aodOffset) return [normal];
  if (aodOffset < normal.length) throw new Error("AOD header overlaps the normal header.");
  return [normal, header(aodOffset, "aod")];
}

export interface CorosBitmapBlock {
  index: number; offset: number; width: number; height: number;
  /**
   * Encoding word. 0x2002 (416px AMOLED) and 0x3002 (DIGITAL's normal-mode
   * clock fonts) share RLE palette (version 1) / RGBA (version 3) frames;
   * 0x1800 is uncompressed RGB888 (version 2, TWILIGHT's exercise icon);
   * 0x0802 is RLE with one A2R2G2B2 byte per pixel (MIP, version 0). Any
   * other word reaches the editor only through `viaPointer`.
   */
  encoding: number; version: number; frameCount: number; dataOffset: number; frameEnds: number[];
  /** A layout pointer vouched for this block; the linear scan did not recognize its header. */
  viaPointer?: true;
  /** Why the header alone was not enough, for the layout warnings. */
  note?: string;
}
type BitmapBlockShape = Omit<CorosBitmapBlock, "index" | "viaPointer" | "note">;

/**
 * Parse one block header at `offset`. Frame layout follows the version: 0 is
 * MIP (four reserved bytes, u16 ends), 1/2/3 AMOLED (six reserved bytes, u32
 * ends). MIP hand sprites (NOMAD 062R/082R seconds hand) keep 0x0f in the
 * frame-count byte over a single u16 end; a hand is one frame, and the lenient
 * path tries that reading when the declared table does not fit.
 */
function readBitmapBlockAt(buffer: Buffer, offset: number, knownEncodingsOnly: boolean): (BitmapBlockShape & { note?: string }) | null {
  if (offset < 0 || offset + 14 > buffer.length) return null;
  const width = buffer.readUInt16LE(offset), height = buffer.readUInt16LE(offset + 2), encoding = buffer.readUInt16LE(offset + 4);
  const declared = buffer[offset + 6], version = buffer[offset + 7];
  if (!width || width > 800 || !height || height > 800 || !declared || declared > 64) return null;
  // 0x3002 decodes byte-for-byte like 0x2002 (indexed pixels + 256-entry LUT); only the flag word differs.
  const known = ((encoding === 0x2002 || encoding === 0x3002) && (version === 1 || version === 3))
    || (encoding === 0x1800 && version === 2) || (encoding === 0x0802 && version === 0);
  if (knownEncodingsOnly ? !known : ![0, 1, 2, 3].includes(version)) return null;
  const mip = version === 0;
  const reserved = mip ? 4 : 6, entry = mip ? 2 : 4;
  if (buffer.subarray(offset + 8, offset + 8 + reserved).some(Boolean)) return null;
  const table = (frameCount: number): BitmapBlockShape | null => {
    const dataOffset = offset + 8 + reserved + frameCount * entry;
    if (dataOffset > buffer.length) return null;
    const frameEnds: number[] = [];
    for (let i = 0; i < frameCount; i++) {
      const at = offset + 8 + reserved + i * entry;
      const end = mip ? buffer.readUInt16LE(at) : buffer.readUInt32LE(at);
      if (end <= (frameEnds.at(-1) ?? 0) || dataOffset + end > buffer.length) return null;
      frameEnds.push(end);
    }
    return { offset, width, height, encoding, frameCount, version, dataOffset, frameEnds };
  };
  const block = table(declared);
  if (block || knownEncodingsOnly || !mip || declared === 1) return block;
  const hand = table(1);
  return hand && { ...hand, note: `header declares ${declared} frames over a single frame table; read as one frame` };
}

function everyFrameDecodes(buffer: Buffer, block: BitmapBlockShape): boolean {
  try {
    for (let frame = 0; frame < block.frameCount; frame++) decodeCorosBitmapFrame(buffer, block, frame);
    return true;
  } catch { return false; }
}

/**
 * Locate bitmap blocks after the layout headers, which occupy [0, start).
 * The linear scan admits only the encoding words this decoder has met. A u32
 * in the headers that lands on a well-formed block the scan skipped is then
 * admitted once every frame proves to decode: a new flag bit must not silently
 * drop an element the way 0x3002 once dropped DIGITAL's clock digits.
 */
export function findCorosBitmapBlocks(buffer: Buffer, start = 0): CorosBitmapBlock[] {
  const blocks: CorosBitmapBlock[] = [];
  let decodedBytes = 0;
  const admit = (block: BitmapBlockShape & { note?: string }, viaPointer = false) => {
    decodedBytes += block.width * block.height * 4 * block.frameCount;
    if (decodedBytes > 256 * 1024 * 1024 || blocks.length >= 512) throw new Error("This face contains too much image data to open in the editor.");
    blocks.push({ index: blocks.length, ...block, ...(viaPointer ? { viaPointer: true } : {}) });
  };
  for (let offset = start; offset + 14 <= buffer.length; offset++) {
    const block = readBitmapBlockAt(buffer, offset, true);
    if (!block) continue;
    admit(block);
    offset = block.dataOffset + block.frameEnds.at(-1)! - 1;
  }
  const blockEnd = (block: BitmapBlockShape) => block.dataOffset + block.frameEnds.at(-1)!;
  const covered = (at: number) => blocks.some((b) => at >= b.offset && at < blockEnd(b));
  const tried = new Set<number>();
  for (let field = 0; field + 4 <= start; field++) {
    const pointer = buffer.readUInt32LE(field);
    if (pointer < start || pointer + 14 > buffer.length || tried.has(pointer) || covered(pointer)) continue;
    tried.add(pointer);
    const block = readBitmapBlockAt(buffer, pointer, false);
    if (!block || !everyFrameDecodes(buffer, block)) continue;
    // Scan hits inside the vouched block were false positives from its RLE stream.
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].offset > block.offset && blocks[i].offset < blockEnd(block)) blocks.splice(i, 1);
    admit(block, true);
  }
  blocks.sort((a, b) => a.offset - b.offset);
  blocks.forEach((block, index) => { block.index = index; });
  return blocks;
}

export function decodeCorosBitmapFrame(bytes: Buffer, block: BitmapBlockShape, frame: number): Buffer {
  if (!Number.isInteger(frame) || frame < 0 || frame >= block.frameCount) throw new Error("Invalid bitmap frame.");
  const encoded = bytes.subarray(block.dataOffset + (block.frameEnds[frame - 1] ?? 0), block.dataOffset + block.frameEnds[frame]);
  const pixels = block.width * block.height;
  if (block.version === 2) {
    // Uncompressed RGB888 (encoding 0x1800): three bytes per pixel, no alpha, no RLE.
    if (encoded.length !== pixels * 3) throw new Error("Invalid watchface image data.");
    const rgba = Buffer.alloc(pixels * 4);
    for (let pixel = 0; pixel < pixels; pixel++) {
      encoded.copy(rgba, pixel * 4, pixel * 3, pixel * 3 + 3);
      rgba[pixel * 4 + 3] = 255;
    }
    return rgba;
  }
  const mip = block.version === 0; // Only MIP (0x0802) blocks are version 0.
  const decoded = Buffer.alloc(mip ? pixels : block.version === 3 ? pixels * 4 : pixels + 1024);
  let cursor = 0;
  for (let i = 0; i < encoded.length; i++) {
    const control = encoded[i];
    const count = control >= 0xc0 ? control & 0x3f : 1;
    if (control >= 0xc0 && i + 1 >= encoded.length) throw new Error("Truncated watchface image.");
    const value = control >= 0xc0 ? encoded[++i] : control;
    if (!count || cursor + count > decoded.length) throw new Error("Invalid watchface image data.");
    decoded.fill(value, cursor, cursor + count);
    cursor += count;
  }
  if (cursor !== decoded.length) throw new Error("Incomplete watchface image data.");
  if (mip) {
    // MIP panels are 64-colour: aa rr gg bb per byte, alpha 0 opaque … 3 transparent.
    const rgba = Buffer.alloc(pixels * 4);
    for (let pixel = 0; pixel < pixels; pixel++) {
      const value = decoded[pixel];
      rgba[pixel * 4] = ((value >> 4) & 3) * 85; rgba[pixel * 4 + 1] = ((value >> 2) & 3) * 85;
      rgba[pixel * 4 + 2] = (value & 3) * 85; rgba[pixel * 4 + 3] = (3 - ((value >> 6) & 3)) * 85;
    }
    return rgba;
  }
  if (block.version === 3) return decoded;
  const rgba = Buffer.alloc(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const index = decoded[pixel];
    // COROS stores the LUT transposed: logical index 1 lives in slot 16.
    const palette = pixels + (((index & 15) << 4) | (index >>> 4)) * 4;
    decoded.copy(rgba, pixel * 4, palette, palette + 4);
  }
  return rgba;
}

// [id, position offset, bitmap pointer offset, position config key, asset key]
const ICONS: PositionedField[] = [
  ["background", 0x12, 0x1a, "background_icon_pos", "background_icon"],
  ["bluetooth.on", 0x26, 0x2e, "bluetooth_icon_pos", "bluetooth_on_icon"],
  ["bluetooth.off", 0x26, 0x32, "bluetooth_icon_pos", "bluetooth_off_icon"],
  // SetStatus stores WFStatusInfo.sedentary (field 6) here: official DASHBOARD
  // keeps a seven-frame activity ring at (148,287). No touch-lock writer exists.
  ["sedentary.states", 0x36, 0x3e, "sedentary_icon_pos", "sedentary_icon_dir"],
  ["doNotDisturb.on", 0x42, 0x4a, "no_disturb_icon_pos", "no_disturb_on_icon"],
  ["doNotDisturb.off", 0x42, 0x4e, "no_disturb_icon_pos", "no_disturb_off_icon"],
  ["battery.states", 0x5e, 0x66, "battery_icon_pos", "battery_icon_dir"],
  ["arcCut", 0x128, 0x130, "arc_cut_icon_pos", "arc_cut_icon"],
  ...["hour_high", "hour_low", "minute_high", "minute_low", "second_high", "second_low"].map((part, i) =>
    [`time.${part}`, 0x1b0 + i * 14, 0x1b8 + i * 14, `time_${part}_pos`, `time_${part}_font`] as PositionedField),
  ["time.am", 0x204, 0x20c, "am_pm_icon_pos", "am_icon"],
  ["time.pm", 0x204, 0x210, "am_pm_icon_pos", "pm_icon"],
  ["weather.day", 0xc4a, 0xc52, "weather_icon_pos", "weather_icon_dir"],
  ["weather.night", 0xc4a, 0xc92, "weather_icon_pos", "weather_dark_icon_dir"],
  ["weather.windIcon", 0xc6c, 0xc74, "weather_wind_icon_pos", "weather_wind_icon"],
  ["weather.direction", 0xc86, 0xc8e, "weather_direction_icon_pos", "weather_direction_icon_dir"],
  ["weather.separator", 0xcb2, 0xcba, "weather_temp_separator_icon_pos", "weather_temp_separator_icon"],
  ["weather.rainIcon", 0xcc6, 0xcce, "weather_rainfall_icon_pos", "weather_rainfall_icon"],
  ["weather.humidityIcon", 0xce4, 0xcec, "weather_humidity_icon_pos", "weather_humidity_icon"],
  ["weather.uvIcon", 0xd02, 0xd0a, "weather_uv_icon_pos", "weather_uv_icon"],
  ["weather.uvLevel", 0xd1c, 0xd24, "weather_uv_level_pos", "weather_uv_level_icon"],
  ["weather.aqiIcon", 0xd28, 0xd30, "weather_aqi_icon_pos", "weather_aqi_icon"],
  ["weather.aqiLevel", 0xd42, 0xd4a, "weather_aqi_level_pos", "weather_aqi_level_icon"],
  ["todayElevation.icon", 0x10ce, 0x10d6, "today_elev_icon_pos", "today_elev_icon"],
  ["weekElevation.icon", 0x1146, 0x114e, "week_elev_icon_pos", "week_elev_icon"],
  ["weekLoad.icon", 0xfd8, 0xfe0, "week_tl_icon_pos", "week_tl_icon"],
  ["weekLoad.states", 0xff2, 0xffa, "week_tl_level_pos", "week_tl_level_icon"],
  ["stamina.icon", 0xffe, 0x1006, "stamina_icon_pos", "stamina_icon"],
  ["stamina.states", 0x101c, 0x1024, "stamina_level_pos", "stamina_level_icon"],
  ["stress.icon", 0x1028, 0x1030, "stress_icon_pos", "stress_icon"],
  // SetExtendedStatus continues in WFExtendedStatusInfo field order: stress
  // level, sleep HRV level, barometer, today's and weekly run/swim/bike
  // (WFMetricValue = icon + value + unit), sunrise/sunset progress at 0x1164
  // (two icons, hour/minute rects, font, colon, progress) and sleep score.
  // RUBY HORIZON's barometer column (0x105a–0x1070) confirmed the block.
  ["stress.states", 0x1042, 0x104a, "stress_level_icon_pos", "stress_level_icon"],
  ["sleepHrv.states", 0x104e, 0x1056, "sleep_hrv_level_pos", "sleep_hrv_level_icon"],
  ["barometer.icon", 0x105a, 0x1062, "baro_icon_pos", "baro_icon"],
  ...([["today_run", 0x1074], ["today_swim", 0x1092], ["today_bike", 0x10b0], ["week_run", 0x10ec], ["week_swim", 0x110a], ["week_bike", 0x1128]] as const)
    .map(([key, pos]) => [`${key.replace(/_(\w)/, (_, c: string) => c.toUpperCase())}.icon`, pos, pos + 8, `${key}_icon_pos`, `${key}_icon`] as PositionedField),
  ["sunriseset.icon", 0x1164, 0x116c, "sunriseset_icon_pos", "sunriseset_sunrise_icon"],
  ["sunriseset.setIcon", 0x1164, 0x1170, "sunriseset_icon_pos", "sunriseset_sunset_icon"],
  ["sunriseset.progress", 0x1190, 0x1198, "sunriseset_progress_pos", "sunrise_progress"],
  ["sunriseset.setProgress", 0x1190, 0x119c, "sunriseset_progress_pos", "sunset_progress"],
  ["sleepScore.icon", 0x11a0, 0x11a8, "sleep_score_icon_pos", "sleep_score_icon"]
];
// [id, rectangle offset, font pointer offset, rectangle config key, font key]
const NUMBERS: PositionedField[] = [
  ["battery.value", 0x6a, 0x74, "battery_level_rect", "battery_level_font"],
  ["temperature.legacy", 0x7e, 0x88, "temperature_rect", "temperature_font"],
  ["steps", 0x92, 0x9c, "step_rect", "step_font"],
  // Read against the official artwork rather than record order: TWILIGHT
  // labels 0xa2 "ALTITUDE" and 0xde "KCAL"; COLOR PALETTE, KHATA, MODULE and
  // Wahoo 2 also draw calories at 0xde. The heart rate is the auxiliary
  // record at 0x316, so 0xde is not a second (legacy) HR slot. 0xc6 carries a
  // rectangle and a small integer with no bitmap pointer (COLOR PALETTE's
  // calorie progress bar); no config key is invented for it.
  ["elevation", 0xa2, 0xac, "elevation_rect", "elevation_font"],
  ["calories", 0xde, 0xe8, "kcal_rect", "kcal_font"],
  ["exercise.hours", 0xfe, 0x112, "exercise_hour_rect", "exercise_font"],
  ["exercise.minutes", 0x108, 0x112, "exercise_minute_rect", "exercise_font"],
  ["date.english.month", 0x13c, 0x146, "english_date_month_rect", "english_date_month_font"],
  ["date.chinese.month", 0x14c, 0x156, "chinese_date_month_rect", "chinese_date_month_font"],
  ["date.english.day", 0x15c, 0x166, "english_date_day_rect", "english_date_day_font"],
  ["date.chinese.day", 0x16c, 0x176, "chinese_date_day_rect", "chinese_date_day_font"],
  ["date.english.week", 0x17c, 0x186, "english_date_week_rect", "english_date_week_font"],
  ["date.chinese.week", 0x18c, 0x196, "chinese_date_week_rect", "chinese_date_week_font"],
  // SetDate (0x17e700–0x18346c) looks up Map<WF_LANGUAGE, WFDateValue> per
  // language and writes month/day/week records of 16 bytes (rect + font + pad).
  // Verified against NOMAD's glyph sets (DE/ES/FR/PL/PT/IT weekday names;
  // CH_TW reuses the Chinese set; JA/TH fall back to English glyphs).
  ...([
    ["germany", 0x61a, 0x63a, 0x65a], ["spanish", 0x62a, 0x64a, 0x66a], ["french", 0x67a, 0x68a, 0x69a],
    ["japanese", 0x93a, 0x94a, 0x95a], ["thai", 0x96a, 0x97a, 0x98a], ["polish", 0x99a, 0x9aa, 0x9ba],
    ["chinese_tw", 0x9ca, 0x9da, 0x9ea], ["portugal", 0x9fa, 0xa0a, 0xa1a], ["italian", 0xa2a, 0xa3a, 0xa4a],
    ["korean", 0xa5a, 0xa6a, 0xa7a], ["russian", 0xa8a, 0xa9a, 0xaaa]
  ] as const).flatMap(([language, month, day, week]) => ([["month", month], ["day", day], ["week", week]] as const).map(([part, offset]) =>
    [`date.${language}.${part}`, offset, offset + 10, `${language}_date_${part}_rect`, `${language}_date_${part}_font`] as PositionedField)),
  ["weather.temperature", 0xc56, 0xc60, "weather_temp_rect", "weather_temp_font"],
  ["weather.wind", 0xc78, 0xc82, "weather_wind_rect", "weather_wind_font"],
  ["weather.minimum", 0xc96, 0xca0, "weather_temp_min_rect", "weather_temp_min_font"],
  ["weather.maximum", 0xca4, 0xcae, "weather_temp_max_rect", "weather_temp_max_font"],
  ["weather.rainfall", 0xcd2, 0xcdc, "weather_rainfall_rect", "weather_rainfall_font"],
  ["weather.humidity", 0xcf0, 0xcfa, "weather_humidity_rect", "weather_humidity_font"],
  ["weather.uv", 0xd0e, 0xd18, "weather_uv_rect", "weather_uv_font"],
  ["weather.aqi", 0xd34, 0xd3e, "weather_aqi_rect", "weather_aqi_font"],
  ["todayElevation.value", 0x10da, 0x10e4, "today_elev_rect", "today_elev_font"],
  ["weekElevation.value", 0x1152, 0x115c, "week_elev_rect", "week_elev_font"],
  ["weekLoad.value", 0xfe4, 0xfee, "week_tl_rect", "week_tl_font"],
  ["stamina.value", 0x100a, 0x1014, "stamina_rect", "stamina_font"],
  ["stress.value", 0x1034, 0x103e, "stress_rect", "stress_font"],
  ["barometer.value", 0x1066, 0x1070, "baro_rect", "baro_font"],
  ...([["today_run", 0x1074], ["today_swim", 0x1092], ["today_bike", 0x10b0], ["week_run", 0x10ec], ["week_swim", 0x110a], ["week_bike", 0x1128]] as const)
    .map(([key, pos]) => [`${key.replace(/_(\w)/, (_, c: string) => c.toUpperCase())}.value`, pos + 12, pos + 22, `${key}_rect`, `${key}_font`] as PositionedField),
  ["sunriseset.hour", 0x1174, 0x1188, "sunriseset_hour_rect", "sunriseset_font"],
  ["sunriseset.minute", 0x117e, 0x1188, "sunriseset_minute_rect", "sunriseset_font"],
  ["sleepScore.value", 0x11ac, 0x11b6, "sleep_score_rect", "sleep_score_font"]
];
const RESOURCES: [string, number, string][] = [
  ["thumbnail", 0x1e, "watchface_thmb_icon"],
  ["battery.percent", 0x7a, "battery_level_percent_icon"],
  ["sleepMode", 0x52, "sleep_mode_icon"],
  ["airplane", 0x56, "airplane_icon"],
  // SetPoint (0x184c94–0x184be8) writes WFClockPointerGroup: centre polygon
  // icons, then hour/minute/second hand images that rotate about
  // time_center_pos at 0x2f8. Official NOMAD sweeps a chevron strip as its
  // seconds hand; rgb222 tint bytes at 0x30c–0x30e are not reconstructed.
  ["time.centerPolygon1", 0x2f0, "time_center_polygon_icon1"],
  ["time.centerPolygon2", 0x2f4, "time_center_polygon_icon2"],
  ["time.hourHand", 0x300, "time_hour_icon"],
  ["time.minuteHand", 0x304, "time_minute_icon"],
  ["time.secondHand", 0x308, "time_second_icon"],
  ["negativeSign", 0x8e, "negative_sign_icon"],
  ["colon", 0x134, "colon_icon"],
  ["date.chinese.monthIcon", 0x19c, "chinese_month_icon"],
  ["control.colon", 0x4c6, "control_colon_icon"],
  ["control.percent", 0x4ca, "control_percent_icon"],
  ["control.negativeSign", 0x392, "control_negative_sign_icon"],
  ["weather.minus", 0xc64, "weather_negasign_icon"],
  ["weather.unit", 0xc68, "weather_dgree_icon"],
  ["weather.minMaxMinus", 0xcbe, "weather_temp_max_min_negasign_icon"],
  ["weather.minMaxUnit", 0xcc2, "weather_temp_max_min_dgree_icon"],
  ["weather.rainPercent", 0xce0, "weather_rainfall_percent_icon"],
  ["weather.humidityPercent", 0xcfe, "weather_humidity_percent_icon"],
  ["todayElevation.unit", 0x10e8, "today_elev_unit_icon"],
  ["weekElevation.unit", 0x1160, "week_elev_unit_icon"],
  ["todayRun.unit", 0x108e, "today_run_unit_icon"], ["todaySwim.unit", 0x10ac, "today_swim_unit_icon"], ["todayBike.unit", 0x10ca, "today_bike_unit_icon"],
  ["weekRun.unit", 0x1106, "week_run_unit_icon"], ["weekSwim.unit", 0x1124, "week_swim_unit_icon"], ["weekBike.unit", 0x1142, "week_bike_unit_icon"],
  ["sunriseset.colon", 0x118c, "sunriseset_colon_icon"],
  ["stamina.percent", 0x1018, "stamina_percent_icon"]
];
// SetControl looks items up by WF_DATA_TYPE: HR (5) at 0x3c4, floor (6) at
// 0x3e0, elevation (7), sunrise (8), sunset (9), step (10), kcal (11) and
// exercise (12) follow as 28-byte records (position, icon, rect, font, tint).
const CONTROLS: [string, number, number, number][] = [
  ["temperature", 0x376, 0x382, 0x38c],
  ["barometer", 0x39e, 0x3aa, 0x3be],
  ["hr", 0x3c4, 0x3d0, 0x3da],
  ["floor", 0x3e0, 0x3ec, 0x3f6],
  ["elevation", 0x3fc, 0x408, 0x412],
  ["step", 0x464, 0x470, 0x47a],
  ["kcal", 0x480, 0x48c, 0x496]
];
// WFBinExporter::SetChart at 0x18f984 writes WFChartInfo at 0xdc4 in protobuf
// field order: WFPositionIcon = int32 x/y + pointer (12 bytes), WFRect = four
// int16 + alignment byte (10), WFIconValue = icon + rect + font (26). Rise/set
// records hold one position, rise/set icons, hour/minute rectangles and a font.
// Official NOMAD (0x11a0, v2) uses exactly these offsets. Config keys are the
// 4.9.9 parser prefixes with their `_icon_pos/_icon/_rect/_font` suffixes.
const CHART_ICONS: PositionedField[] = [
  ["chart.background", 0xdc4, 0xdcc, "chart_pos", "chart_bg"],
  ["chart.barMask", 0xde6, 0xdee, "chart_bar_mask_pos", "chart_bar_mask"],
  ["chart.fish.background", 0xe26, 0xe2e, "chart_fish_bg_pos", "chart_fish_bg"],
  ["chart.sun", 0xe90, 0xe98, "chart_sun_icon_pos", "chart_sun_icon"],
  ["chart.moon", 0xede, 0xee6, "chart_moon_icon_pos", "chart_moon_icon"],
  ["chart.item3.background", 0xfb0, 0xfb8, "chart_item3_bg_pos", "chart_item3_bg"],
  ["chart.item3.mask", 0xfbc, 0xfc4, "chart_item3_mask_pos", "chart_item3_mask"],
  ["chart.noDataMask", 0xfc8, 0xfd0, "chart_bar_nodata_mask_pos", "chart_bar_nodata_mask"]
];
// [readout, position, config prefix]; icon pointer = +8, rect = +12, font = +22.
const CHART_READOUTS: [string, number, string | null][] = [
  ["tide", 0xdf2, "chart_tide"], ["barometer", 0xe0c, "chart_baro"], ["sunAngle", 0xe9c, "chart_sun_angle"],
  ["moonPercent", 0xeea, "chart_moon_percent"], ["stress", 0xf04, "chart_stress"], ["stamina", 0xf1e, "chart_stamina"],
  ["elevation", 0xf38, "chart_elevation"], ["kcal", 0xf52, "chart_kcal"], ["step", 0xf6c, "chart_step"],
  // WFChartInfo.heart_rate is written at 0xf86, but no 4.9.9 config key was found for it.
  ["heartRate", 0xf86, null]
];
// [readout, position, config prefix, set-icon key]; rise icon = +8, set icon = +12,
// hour rect = +16, minute rect = +26, shared font = +36.
const CHART_RISE_SET: [string, number, string, string][] = [
  ["sunrise", 0xe68, "chart_sunrise", "chart_sunset_icon"],
  ["moonrise", 0xeb6, "chart_moonrise", "chart_moonset_icon"]
];
const CHART_RESOURCES: [string, number, string][] = [
  ["chart.point", 0xfa0, "chart_point_icon"], ["chart.colon", 0xfa4, "chart_colon_icon"],
  ["chart.degree", 0xfa8, "chart_dgree_icon"], ["chart.negativeSign", 0xfac, "chart_negasign_icon"],
  ["chart.percent", 0xfd4, "chart_percent_icon"]
];
// WFBinExporter::SetFish at 0x18f5b8 writes WFFishInfo at 0xd92; SetPoint at
// 0x1845xx writes the clock pointer group, whose second-hand icon lives at 0x308.
const FISH = 0xd92;

/** The 4.9.9 exporter stores rgb222 bytes; official NOMAD stores full 0xRRGGBB words. */
export function expandChartColor(raw: number): number {
  if (raw > 0xff) return raw & 0xffffff;
  const channel = (shift: number) => ((raw >> shift) & 3) * 85;
  return (channel(4) << 16) | (channel(2) << 8) | channel(0);
}

export function decodeCorosLayout(bytes: Buffer, blocks: BitmapLink[]) {
  const headers = readLayoutHeaders(bytes);
  const bitmapMap = new Map(blocks.map((b) => [Number(b.offset), b]));
  const layoutEnd = Math.max(...headers.map((h) => h.offset + h.length));
  const warnings: string[] = [];
  for (const block of blocks) {
    if (!block.viaPointer) continue;
    const encoding = typeof block.encoding === "number" ? hex(block.encoding) : block.encoding ?? "unknown";
    warnings.push(`bitmap block ${hex(Number(block.offset))} (encoding ${encoding}${block.note ? `; ${block.note}` : ""}) was not recognized by the scan; admitted because a layout pointer references it and every frame decodes.`);
  }
  const modes = headers.map((header) => {
    const { offset: base, length } = header;
    const elements: CorosBinElement[] = [];
    const pointerFields = new Set();
    // Shorter headers end before later record blocks; reads past the header
    // (or the file) yield zero so the element is skipped, never guessed.
    const inHeader = (absolute: number, size: number) => absolute >= base && absolute + size <= base + length;
    const safe = <T,>(absolute: number, size: number, read: () => T, fallback: T): T => absolute >= 0 && absolute + size <= bytes.length ? read() : fallback;
    const u32 = (offset: number) => safe(base + offset, 4, () => bytes.readUInt32LE(base + offset), 0);
    const point = (offset: number): CorosBinPoint => ({
      x: safe(base + offset, 4, () => bytes.readInt32LE(base + offset), 0),
      y: safe(base + offset + 4, 4, () => bytes.readInt32LE(base + offset + 4), 0)
    });
    const rectangle = (absolute: number): CorosBinRect => {
      const align = safe(absolute + 8, 1, () => bytes[absolute + 8], 0);
      const i16 = (at: number) => safe(at, 2, () => bytes.readInt16LE(at), 0);
      return {
        x0: i16(absolute), y0: i16(absolute + 2), x1: i16(absolute + 4), y1: i16(absolute + 6),
        align,
        horizontal: align & 4 ? "right" : align & 2 ? "center" : "left",
        vertical: align & 32 ? "bottom" : align & 16 ? "center" : "top"
      };
    };
    const reference = (absolute: number, indirect = false): CorosBinReference | null => {
      if (indirect ? absolute < 0 || absolute + 4 > bytes.length : !inHeader(absolute, 4)) return null;
      if (!indirect) pointerFields.add(absolute - base);
      const pointer = bytes.readUInt32LE(absolute);
      if (!pointer) return null;
      const bitmap = bitmapMap.get(pointer);
      if (!bitmap) warnings.push(`${header.mode}: unresolved bitmap pointer ${hex(pointer)} at ${hex(absolute)}.`);
      return { pointer, pointerHex: hex(pointer), fieldOffset: absolute, group: bitmap?.index ?? null };
    };
    const add = (id: string, kind: CorosBinElement["kind"], geometry: Pick<CorosBinElement, "position" | "rect" | "geometryOffset" | "control" | "chart" | "indirectFieldOffset">,
      absolutePointer: number, config: CorosBinElement["config"] | undefined, evidence = "compiler", note?: string) => {
      if (geometry.geometryOffset !== undefined && !geometry.indirectFieldOffset && !inHeader(geometry.geometryOffset, kind === "number" ? 10 : 8)) return;
      const asset = reference(absolutePointer, Boolean(geometry.indirectFieldOffset));
      if (!asset) return;
      const active = asset.group !== null && (kind !== "number" || Boolean(geometry.rect && geometry.rect.x1 > geometry.rect.x0 && geometry.rect.y1 > geometry.rect.y0));
      elements.push({ id, kind, ...geometry, asset, active, evidence, ...(note ? { note } : {}), ...(config ? { config } : {}) });
    };
    for (const [id, pos, ptr, posKey, assetKey] of ICONS) {
      add(id, "icon", { position: point(pos), geometryOffset: base + pos }, base + ptr, { position: posKey, asset: assetKey });
    }
    for (const [id, rect, ptr, rectKey, fontKey] of NUMBERS) {
      add(id, "number", { rect: rectangle(base + rect), geometryOffset: base + rect }, base + ptr, { rect: rectKey, asset: fontKey });
    }
    for (const [id, ptr, assetKey] of RESOURCES) {
      add(id, "resource", {}, base + ptr, { asset: assetKey });
    }
    const controlOrigin = inHeader(base + 0x33a, 8) ? point(0x33a) : { x: 0, y: 0 };
    for (const [name, pos, rect, font] of CONTROLS) {
      add(`control.${name}.icon`, "icon", { position: point(pos), geometryOffset: base + pos, control: name }, base + pos + 8,
        { position: `control_${name}_icon_pos`, asset: `control_${name}_icon` });
      add(`control.${name}.value`, "number", { rect: rectangle(base + rect), geometryOffset: base + rect, control: name }, base + font,
        { rect: `control_${name}_rect`, asset: `control_${name}_font` });
    }
    // WF_DT_BATTERY (2) at 0x35a keeps the level table and value under its own
    // key names; the barometer item carries a second (decimal) rectangle.
    add("control.battery.states", "icon", { position: point(0x35a), geometryOffset: base + 0x35a, control: "battery" }, base + 0x362,
      { position: "control_battery_icon_pos", asset: "control_battery_icon_dir" });
    add("control.battery.value", "number", { rect: rectangle(base + 0x366), geometryOffset: base + 0x366, control: "battery" }, base + 0x370,
      { rect: "control_battery_level_rect", asset: "control_battery_level_font" });
    add("control.barometer.decimal", "number", { rect: rectangle(base + 0x3b4), geometryOffset: base + 0x3b4, control: "barometer" }, base + 0x3be,
      { rect: "control_barometer_decimal_rect", asset: "control_barometer_font" });
    for (const [name, pos, hour, minute, font] of [["sunrise", 0x418, 0x424, 0x42e, 0x438], ["sunset", 0x43e, 0x44a, 0x454, 0x45e], ["exercise", 0x49c, 0x4a8, 0x4b2, 0x4bc]] as const) {
      add(`control.${name}.icon`, "icon", { position: point(pos), geometryOffset: base + pos, control: name }, base + pos + 8,
        { position: `control_${name}_icon_pos`, asset: `control_${name}_icon` });
      for (const [part, rect] of [["hour", hour], ["minute", minute]] as const) {
        add(`control.${name}.${part}`, "number", { rect: rectangle(base + rect), geometryOffset: base + rect, control: name }, base + font,
          { rect: `control_${name}_${part}_rect`, asset: `control_${name}_font` });
      }
    }
    for (const [language, part, rect] of [
      ["english", "month", 0x4ce], ["chinese", "month", 0x4de], ["english", "day", 0x4ee], ["chinese", "day", 0x4fe],
      ["english", "week", 0x50e], ["chinese", "week", 0x51e]
    ] as const) {
      add(`control.date.${language}.${part}`, "number", { rect: rectangle(base + rect), geometryOffset: base + rect, control: "date" }, base + rect + 10,
        { rect: `control_${language}_date_${part}_rect`, asset: `control_${language}_date_${part}_font` });
    }
    // SetControl's per-language date records (Map::at keys 5–13 in the
    // disassembly). German/Spanish/French weekday fonts sit at 0x58c/0x59c/0x5cc
    // in official DASHBOARD; their month/day slots follow the normal-header pattern.
    for (const [language, month, day, week] of [
      ["germany", 0x542, 0x562, 0x582], ["spanish", 0x552, 0x572, 0x592], ["french", 0x5a2, 0x5b2, 0x5c2],
      ["japanese", 0x6ca, 0x6da, 0x6ea], ["thai", 0x6fa, 0x70a, 0x71a], ["polish", 0x72a, 0x73a, 0x74a],
      ["chinese_tw", 0x75a, 0x76a, 0x77a], ["portugal", 0x78a, 0x79a, 0x7aa], ["italian", 0x7ba, 0x7ca, 0x7da],
      ["korean", 0x7ea, 0x7fa, 0x80a], ["russian", 0x81a, 0x82a, 0x83a]
    ] as const) {
      for (const [part, rect] of [["month", month], ["day", day], ["week", week]] as const) {
        add(`control.date.${language}.${part}`, "number", { rect: rectangle(base + rect), geometryOffset: base + rect, control: "date" }, base + rect + 10,
          { rect: `control_${language}_date_${part}_rect`, asset: `control_${language}_date_${part}_font` });
      }
    }
    // Chart block. The watch cycles chart_index % 5 groups at runtime (COROS
    // documents this for NOMAD), so every readout below is an alternative that
    // shares the same graph area, not a layer drawn simultaneously.
    for (const [id, pos, ptr, posKey, assetKey] of CHART_ICONS) {
      add(id, "icon", { position: point(pos), geometryOffset: base + pos }, base + ptr, { position: posKey, asset: assetKey });
    }
    for (const [name, pos, prefix] of CHART_READOUTS) {
      const note = prefix ? undefined : "WFChartInfo.heart_rate: no 4.9.9 config key was established, so it is omitted from config drafts.";
      add(`chart.${name}.icon`, "icon", { position: point(pos), geometryOffset: base + pos, chart: name }, base + pos + 8,
        prefix ? { position: `${prefix}_icon_pos`, asset: `${prefix}_icon` } : undefined, "compiler", note);
      add(`chart.${name}.value`, "number", { rect: rectangle(base + pos + 12), geometryOffset: base + pos + 12, chart: name }, base + pos + 22,
        prefix ? { rect: `${prefix}_rect`, asset: `${prefix}_font` } : undefined, "compiler", note);
    }
    for (const [name, pos, prefix, setKey] of CHART_RISE_SET) {
      add(`chart.${name}.icon`, "icon", { position: point(pos), geometryOffset: base + pos, chart: name }, base + pos + 8, { position: `${prefix}_icon_pos`, asset: `${prefix}_icon` });
      add(`chart.${name}.setIcon`, "icon", { position: point(pos), geometryOffset: base + pos, chart: name }, base + pos + 12, { position: `${prefix}_icon_pos`, asset: setKey });
      for (const [part, offset] of [["hour", 16], ["minute", 26]] as const) {
        add(`chart.${name}.${part}`, "number", { rect: rectangle(base + pos + offset), geometryOffset: base + pos + offset, chart: name }, base + pos + 36,
          { rect: `${prefix}_${part}_rect`, asset: `${prefix}_font` });
      }
    }
    for (const [part, offset] of [["startHour", 0xe32], ["startMinute", 0xe3c], ["endHour", 0xe46], ["endMinute", 0xe50]] as const) {
      add(`chart.fish.${part}`, "number", { rect: rectangle(base + offset), geometryOffset: base + offset, chart: "fish" }, base + 0xe5a,
        { rect: `chart_fish_${part.replace(/([A-Z])/g, "_$1").toLowerCase()}_rect`, asset: "chart_fish_font" });
    }
    for (const [id, ptr, assetKey] of CHART_RESOURCES) add(id, "resource", {}, base + ptr, { asset: assetKey });
    const chartRect = rectangle(base + 0xdd0);
    const rawColors = { selectedBar: u32(0xdde), unselectedBar: u32(0xde2), curvesUpper: u32(0xe5e), curvesLower: u32(0xe62) };
    const chart: CorosBinChart | undefined = inHeader(base + 0xdc4, 0xfd8 - 0xdc4) && chartRect.x1 > chartRect.x0 && chartRect.y1 > chartRect.y0 ? {
      rect: chartRect, barWidth: bytes.readUInt16LE(base + 0xdda), barInterval: bytes.readUInt16LE(base + 0xddc), curvesWidth: bytes[base + 0xe66],
      selectedBarColor: expandChartColor(rawColors.selectedBar), unselectedBarColor: expandChartColor(rawColors.unselectedBar),
      curvesUpperColor: expandChartColor(rawColors.curvesUpper), curvesLowerColor: expandChartColor(rawColors.curvesLower), rawColors
    } : undefined;
    // Calorie goal arc at 0xee, between the calorie value and the exercise
    // time. A radius, a sweep and a stroke width must all be present; nothing
    // is drawn from a partially empty record.
    const arcWords = inHeader(base + 0xee, 16)
      ? Array.from({ length: 8 }, (_, i) => bytes.readInt16LE(base + 0xee + i * 2)) : [];
    const [centerX, centerY, radiusX, radiusY, startAngle, endAngle, strokeWidth, rawColor] = arcWords;
    const kcalProgressArc: CorosBinProgressArc | undefined =
      arcWords.length === 8 && radiusX > 0 && radiusY > 0 && strokeWidth > 0 && startAngle !== endAngle
        ? { centerX, centerY, radiusX, radiusY, startAngle, endAngle, strokeWidth, rawColor, color: expandChartColor(rawColor) }
        : undefined;
    // Fishing arc and clock pointers: retain the links so they are not reported
    // as unknown, but their arc/rotation geometry is not reconstructed.
    add("fish.icon", "icon", { position: point(FISH), geometryOffset: base + FISH }, base + FISH + 8, { position: "fish_time_mask_pos", asset: "fish_time_mask" });
    add("fish.pointer", "resource", {}, base + FISH + 34, { asset: "fish_pointer_icon" });
    const pointerCenter = inHeader(base + 0x2f8, 8) ? point(0x2f8) : { x: 0, y: 0 };
    // Official AOD headers retain some shared icons while clearing all their
    // value rectangles. Keep the links, but don't activate a control from a
    // resource pointer alone. An icon at (0,0) with a live value stays active.
    for (const element of elements) {
      if (element.control && element.kind === "icon" && !elements.some((e) => e.control === element.control && e.kind === "number" && e.active)) {
        element.active = false;
        element.inactiveReason = "control has no nonempty value rectangle (inferred dormant resource)";
      }
      if (element.chart && element.kind === "icon" && !elements.some((e) => e.chart === element.chart && e.kind === "number" && e.active)) {
        element.active = false;
        element.inactiveReason = "chart readout has no nonempty value rectangle (inferred dormant resource)";
      }
      // NOMAD's source pointed fish_pointer_icon at its seconds-hand strip
      // without any fishing arc; exporting it alone makes firmware spin a
      // stray pointer. Keep the link, activate it only with a fishing display.
      if (element.id === "fish.pointer" && !elements.some((e) => e.id === "fish.icon" && e.active)) {
        element.active = false;
        element.inactiveReason = "fishing display has no time-mask icon (inferred dormant resource)";
      }
      if (element.id === "weather.separator" && !elements.some((e) => ["weather.minimum", "weather.maximum"].includes(e.id) && e.active)) {
        element.active = false;
        element.inactiveReason = "minimum/maximum temperature rectangles are empty";
      }
    }
    // SetStatus writes this 34-byte auxiliary record separately from the header.
    // WF_DATA_TYPE_HR == 5, WFRectNumberValue begins at record+0; font at +10.
    const heartRatePointer = inHeader(base + 0x316, 4) ? u32(0x316) : 0;
    if (heartRatePointer) {
      if (heartRatePointer < layoutEnd || heartRatePointer + 34 > bytes.length) {
        warnings.push(`${header.mode}: invalid indirect heart-rate record ${hex(heartRatePointer)}.`);
      } else {
        add("heartRate", "number", { rect: rectangle(heartRatePointer), geometryOffset: heartRatePointer, indirectFieldOffset: base + 0x316 },
          heartRatePointer + 10, { rect: "heartreate_level_rect", asset: "heartreate_level_font" });
      }
    }
    // Present in official PLANET, but no writer for this record was found in
    // 4.9.9. Retain exact geometry and all three pointers; do not invent INI keys.
    const dateFonts = [0x6b4, 0x6b8, 0x6bc].map((off) => reference(base + off));
    if (inHeader(base + 0x6aa, 10) && dateFonts.some(Boolean)) {
      elements.push({ id: "date.combined", kind: "combinedDate", rect: rectangle(base + 0x6aa), geometryOffset: base + 0x6aa,
        assets: dateFonts, active: dateFonts.every((a) => a?.group !== null && a != null), evidence: "inferred-from-official-PLANET",
        note: "Month/day/separator roles and formatting are inferred. Native config keys and runtime date ordering remain unknown." });
      warnings.push(`${header.mode}: combined date is preserved in JSON but omitted from the draft config.`);
    }
    // Find bitmap links not yet assigned semantics. Matching the exact start of
    // a validated block avoids interpreting arbitrary small integers as links.
    const unmappedBitmapReferences = [];
    for (let relative = 0; relative + 4 <= length; relative++) {
      if (pointerFields.has(relative)) continue;
      const bitmap = bitmapMap.get(u32(relative));
      if (bitmap) unmappedBitmapReferences.push({ fieldOffset: base + relative, relativeOffset: relative, pointer: Number(bitmap.offset), group: bitmap.index });
    }
    const flags = bytes[base + 0x10];
    return {
      ...header, offsetHex: hex(base), lengthHex: hex(length),
      id: u32(4), layout: bytes.readUInt16LE(base + 0xe), flags,
      themeColorOff: Boolean(flags & 1), pointLayer: (flags >> 1) & 1, timeFormat: (flags >> 2) & 3, defaultTheme: flags >> 4,
      backgroundColorPacked: bytes[base + 0x22], controlOrigin,
      ...(chart ? { chart } : {}),
      ...(kcalProgressArc ? { kcalProgressArc } : {}),
      ...(elements.some((e) => e.active && /^time\.(hour|minute|second)Hand$/.test(e.id)) ? { pointerCenter } : {}),
      elements, unmappedBitmapReferences,
      rawHeaderHex: bytes.subarray(base, base + length).toString("hex")
    };
  });
  return {
    schemaVersion: 1, format: `COROS-${headers[0].magic}-partial`, screen: { width: headers[0].width, height: headers[0].height },
    magic: headers[0].magic, variant: headers[0].variant,
    completeness: "partial", byteOrder: "little-endian", pointerBase: "absolute-file-offset",
    limitations: [
      "Header sizes 0xbaa–0x1202 share one record table; records beyond a header's end are skipped, never guessed.",
      "Unknown records, analog pointer rotation, fishing arcs, lunar data and auto-alignment are not reconstructed.",
      "Chart readouts are decoded as alternatives; the plotted history and the runtime chart group are supplied by the watch.",
      "Preview values, active control choice, state-frame selection and theme appearance are samples, not recovered runtime state.",
      "The original source names and exact source configuration are unavailable; preserve source.bin for undecoded bytes."
    ], warnings, modes
  };
}

export type CorosBinLayout = ReturnType<typeof decodeCorosLayout>;

export function formatConfigPos(p: CorosBinPoint): string { return `{${p.x},${p.y}}`; }
export function formatConfigRect(r: CorosBinRect): string {
  return `{${r.x0},${r.y0},${r.x1},${r.y1},${r.horizontal === "center" ? "hcenter" : r.horizontal}|${r.vertical === "center" ? "vcenter" : r.vertical}}`;
}
/**
 * The DIY keys for a recovered calorie goal arc. The trailing `1` marks the
 * remainder arc: official faces bake the full-length goal gradient into their
 * backdrop and let the firmware cover what is still unearned, which is what
 * PARTICLES's grey bottom segment is. Studio's Goal progress inspector can
 * flip that and recolor the arc.
 */
export function progressArcConfigValues(arc: CorosBinProgressArc | undefined): [string, string][] {
  if (!arc) return [];
  return [
    ["kcal_progress_arc", `{${arc.centerX},${arc.centerY},${arc.radiusX},${arc.radiusY},${arc.startAngle},${arc.endAngle},${arc.strokeWidth},1}`],
    ["kcal_progress_arc_color", `0x${arc.color.toString(16).padStart(6, "0")}`]
  ];
}
/** Shared graph geometry/styling keys, in the editor's 0xRRGGBB color notation. */
export function chartConfigValues(chart: CorosBinChart | undefined): [string, string][] {
  if (!chart) return [];
  const color = (value: number) => `0x${value.toString(16).padStart(6, "0")}`;
  return [
    ["chart_rect", formatConfigRect(chart.rect)],
    ["chart_bar_width", String(chart.barWidth)], ["chart_bar_interval", String(chart.barInterval)],
    ["chart_selected_bar_color", color(chart.selectedBarColor)], ["chart_unselected_bar_color", color(chart.unselectedBarColor)],
    ["chart_curves_upper_color", color(chart.curvesUpperColor)], ["chart_curves_lower_color", color(chart.curvesLowerColor)],
    ["chart_curves_width", String(chart.curvesWidth)]
  ];
}
