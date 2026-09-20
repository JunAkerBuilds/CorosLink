import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { chartConfigValues, decodeCorosBitmapFrame, decodeCorosLayout, findCorosBitmapBlocks, formatConfigPos, formatConfigRect, parseCorosFaceMagic, readLayoutHeaders, type CorosBinLayout, type CorosBitmapBlock } from "./corosBinLayout";
import { createStoreZip } from "./zipStore";

type BitmapBlock = CorosBitmapBlock;
export { findCorosBitmapBlocks, decodeCorosBitmapFrame };

// Encode straight RGBA directly. nativeImage's platform bitmap byte order and
// premultiplied alpha are inappropriate for these compiler payloads.
export function encodeCorosRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("Invalid RGBA dimensions.");
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** Uniform backing only: never erase a decorated or gradient-backed slot. */
function uniformBacking(rgba: Buffer, width: number, height: number, rect: { x0: number; y0: number; x1: number; y1: number }, borderOnly = false): Buffer | null {
  const { x0, y0, x1, y1 } = rect;
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) return null;
  const color = rgba.subarray((y0 * width + x0) * 4, (y0 * width + x0) * 4 + 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (borderOnly && x !== x0 && x !== x1 - 1 && y !== y0 && y !== y1 - 1) continue;
    const p = (y * width + x) * 4;
    if ([0, 1, 2, 3].some(channel => Math.abs(rgba[p + channel] - color[channel]) > 4)) return null;
  }
  return Buffer.from(color);
}

// COROS config values use backslash separators (`icon\colon.png`, Studio's
// `studio\...` folders). A forward-slash nested path compiled to a blank
// element on the watch, so every recovered reference is written this way.
const recoveredFolder = (block: BitmapBlock) => `recovered\\group-${String(block.index).padStart(2, "0")}`;
const recoveredAsset = (block: BitmapBlock) => block.frameCount > 1 ? recoveredFolder(block) : `${recoveredFolder(block)}\\00.png`;

function recoveredConfig(mode: CorosBinLayout["modes"][number], blocks: BitmapBlock[], bytes: Buffer): string {
  const values = new Map<string, string>([
    ["watchface_id", String(mode.id)], ["watchface_theme_color_off", String(Number(mode.themeColorOff))],
    ["watchface_point_layer", String(mode.pointLayer)], ["watchface_time_format", String(mode.timeFormat)], ["bg_color", "0x000000"]
  ]);
  for (const element of mode.elements) {
    if (!element.active || !element.config || element.asset?.group == null) continue;
    const block = blocks[element.asset.group];
    values.set(element.config.asset, recoveredAsset(block));
    if (element.config.position && element.position) values.set(element.config.position, formatConfigPos(element.position));
    if (element.config.rect && element.rect) values.set(element.config.rect, formatConfigRect(element.rect));
    if (element.control) values.set("rect_control1_pos", formatConfigPos(mode.controlOrigin));
  }
  // Graph geometry and colors have no bitmap of their own; keep them with the
  // chart readouts so the block round-trips through the editor's chart layer.
  if (mode.elements.some(element => element.active && element.config?.asset.startsWith("chart_"))) {
    for (const [key, value] of chartConfigValues(mode.chart)) values.set(key, value);
  }
  if (mode.pointerCenter) values.set("time_center_pos", formatConfigPos(mode.pointerCenter));
  // The combined date has no known 4.9.9 config binding. Translate its original
  // fonts into ordinary editable month/day fields, leaving the original record
  // in recovery/layout.json. The editor's standard fields use two-digit dates.
  const date = mode.elements.find(element => element.kind === "combinedDate" && element.active);
  if (date?.rect && date.assets?.every(asset => asset?.group != null) &&
      !values.has("english_date_month_rect") && !values.has("english_date_day_rect")) {
    const [month, day, separator] = date.assets.map(asset => blocks[asset!.group!]);
    if (month?.frameCount === 10 && day?.frameCount === 10 && separator?.frameCount === 1 &&
        date.rect.x1 > date.rect.x0 && date.rect.y1 > date.rect.y0) {
      const totalWidth = month.width * 2 + separator.width + day.width * 2;
      const start = Math.round((date.rect.x0 + date.rect.x1 - totalWidth) / 2);
      for (const [part, block, x] of [["month", month, start], ["day", day, start + month.width * 2 + separator.width]] as const) {
        const y = Math.round((date.rect.y0 + date.rect.y1 - block.height) / 2);
        values.set(`english_date_${part}_rect`, `{${x},${y},${x + block.width * 2},${y + block.height},left|vcenter}`);
        values.set(`english_date_${part}_font`, recoveredFolder(block));
      }
      const x = start + month.width * 2, y = Math.round((date.rect.y0 + date.rect.y1 - separator.height) / 2);
      const background = mode.elements.find(element => element.id === "background" && element.active);
      const bg = background?.asset?.group != null ? blocks[background.asset.group] : undefined;
      const bx = x - (background?.position?.x ?? 0), by = y - (background?.position?.y ?? 0);
      // PLANET already has a slash in the background; MULTIDATA and NOMAD
      // leave a blank gap. Restore the separate asset only in an empty gap.
      if (!values.has("arc_cut_icon") && (!bg || uniformBacking(decodeCorosBitmapFrame(bytes, bg, 0), bg.width, bg.height,
          { x0: bx, y0: by, x1: bx + separator.width, y1: by + separator.height }))) {
        values.set("arc_cut_icon_pos", `{${x},${y}}`);
        values.set("arc_cut_icon", `${recoveredFolder(separator)}\\00.png`);
      }
    }
  }
  if (mode.mode === "normal" && mode.elements.some(e => e.id === "background" && e.active)) values.set("background_icon", "background.png");
  return "// Recovered official face. Some original layout behavior may be unavailable.\n" +
    [...values].map(([key, value]) => `[${key}]=${value}`).join("\n") + "\n";
}

/** Build an ordinary editable starter; the source binary is retained as data. */
export function recoverCompiledCorosWatchface(bytes: Buffer, name: string, templateId?: string) {
  if (!parseCorosFaceMagic(bytes.length >= 4 ? bytes.toString("latin1", 0, 4) : "")) {
    throw new Error("This official face's format cannot be opened in the editor yet. You can still download it.");
  }
  let headers;
  try { headers = readLayoutHeaders(bytes); }
  catch { throw new Error("This official face's layout cannot be opened in the editor yet. You can still download it."); }
  const blocks = findCorosBitmapBlocks(bytes, Math.max(...headers.map((h) => h.offset + h.length)));
  if (!blocks.length) throw new Error("No editable images could be recovered from this official face.");
  const layout = decodeCorosLayout(bytes, blocks);
  if (!layout.modes.some((m) => m.elements.some((e) => e.active && ["icon", "number"].includes(e.kind)))) {
    throw new Error("No editable layout could be recovered from this official face.");
  }
  const entries: { name: string; data: Buffer }[] = [];
  const { width, height } = layout.screen;
  const directory = `watchface_${width}x${height}`;
  const thumbnail = layout.modes[0].elements.find((e) => e.id === "thumbnail")?.asset?.group;
  let preview: Buffer | undefined;
  for (const block of blocks) {
    for (let frame = 0; frame < block.frameCount; frame++) {
      const png = encodeCorosRgbaPng(block.width, block.height, decodeCorosBitmapFrame(bytes, block, frame));
      entries.push({ name: `${directory}/recovered/group-${String(block.index).padStart(2, "0")}/${String(frame).padStart(2, "0")}.png`, data: png });
      if (frame === 0 && (block.index === thumbnail || !preview)) preview = png;
    }
  }
  // Studio initializes the background from this conventional path. Never let
  // it fall back to the flattened catalog thumbnail behind editable digits.
  const background = layout.modes[0].elements.find(e => e.id === "background" && e.active)?.asset?.group;
  if (background != null) {
    const block = blocks[background];
    const rgba = decodeCorosBitmapFrame(bytes, block, 0);
    const position = layout.modes[0].elements.find(e => e.id === "background")?.position ?? { x: 0, y: 0 };
    // Some training faces bake dim zero placeholders into the backdrop. Clear
    // these value slots when their surrounding backing is uniform, so a short
    // live value does not leave old zeroes behind. The original asset is kept.
    for (const element of layout.modes[0].elements) {
      if (!element.active || !element.rect || !/^(today|week)_elev_rect$/.test(element.config?.rect ?? "")) continue;
      const r = element.rect;
      const slot = { x0: r.x0 - position.x - 2, y0: r.y0 - position.y - 2, x1: r.x1 - position.x + 2, y1: r.y1 - position.y + 2 };
      const color = uniformBacking(rgba, block.width, block.height, slot, true);
      if (!color) continue;
      for (let y = slot.y0; y < slot.y1; y++) for (let x = slot.x0; x < slot.x1; x++) color.copy(rgba, (y * block.width + x) * 4);
    }
    entries.push({ name: `${directory}/background.png`, data: encodeCorosRgbaPng(block.width, block.height, rgba) });
  } else {
    entries.push({ name: `${directory}/background.png`, data: encodeCorosRgbaPng(width, height, Buffer.alloc(width * height * 4)) });
  }
  const unmapped = layout.modes.reduce((sum, mode) => sum + mode.unmappedBitmapReferences.length, 0);
  // A record whose image never resolved is dropped from the face; say so
  // instead of letting a clock or readout vanish without a trace.
  const layoutEnd = Math.max(...headers.map((h) => h.offset + h.length));
  const unresolved = new Set(layout.modes.flatMap((mode) => mode.elements
    .filter((e) => e.asset && e.asset.group === null && e.asset.pointer >= layoutEnd).map((e) => e.asset!.pointer)));
  const recovery = { partial: true, unmappedBitmapReferences: unmapped, unresolvedBitmapPointers: unresolved.size,
    message: "Opened an editable copy. Some elements and behavior may differ from the official face."
      + (unresolved.size ? ` ${unresolved.size} image ${unresolved.size === 1 ? "set" : "sets"} could not be decoded, so the elements that use ${unresolved.size === 1 ? "it were" : "them were"} left out.` : "") };
  const id = templateId && /^[1-9]\d{0,19}$/.test(templateId) ? templateId : String(layout.modes[0].id || 1);
  // m_app and m_preview are the DIY manifest fields official templates carry;
  // the website's upload validator requires both.
  entries.push({ name: "info.json", data: Buffer.from(JSON.stringify({ m_name: name, m_app: directory, m_preview: "watchface_customize.png",
    o_template_id: id, o_diy_version: 1, o_wf_ver: Math.max(...headers.map((h) => h.version)), coroslinkRecovery: recovery })) });
  entries.push({ name: "watchface_customize.png", data: preview! });
  for (const mode of layout.modes) entries.push({ name: `${directory}/${mode.mode === "aod" ? "AODconfig.txt" : "config.txt"}`, data: Buffer.from(recoveredConfig(mode, blocks, bytes)) });
  entries.push({ name: "recovery/source.bin", data: bytes });
  entries.push({ name: "recovery/layout.json", data: Buffer.from(JSON.stringify({ ...layout,
    sourceSha256: createHash("sha256").update(bytes).digest("hex") }, null, 2)) });
  return { zip: createStoreZip(entries), recovery, layout, bitmapFrames: blocks.reduce((sum, b) => sum + b.frameCount, 0) };
}
