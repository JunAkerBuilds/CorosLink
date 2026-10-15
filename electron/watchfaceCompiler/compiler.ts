import { decodePng, type RgbaImage } from "./png";
import { encodeFramesBlock, encodeImageBlock, encodeMipFramesBlock, encodeMipImageBlock, InsideType, mipBlockOverflows } from "./bitmap";
import { configPath, parseConfig, parseNumber, parsePos, parseRect, rgb222 } from "./config";
import { ALIASES, COLORS, FIELDS, VERSIONS, WRITE_ORDER } from "./fields";
import { scaleImage } from "./scale";
import { getWatchfaceTarget, watchfaceBinTarget, type WatchfaceBinTarget } from "../watchfaceTargets";

/**
 * A TypeScript reimplementation of the COROS 4.9.9 watch face compiler
 * (`WFTemplateParser::Parse` + `WFBin8888Exporter`). For PACE Pro it writes COROS's
 * bytes; other watches use the same header at their own layout, magic and thumbnail
 * size, with memory-in-pixel image blocks (`WFBin2222Exporter`) for PACE 3, APEX 4,
 * NOMAD and VERTIX (see `bitmap.ts`).
 *
 * File: normal header (0x1202 bytes), AOD header (0x1202, only with an
 * AODconfig.txt), then image blocks and indirect records in COROS's write
 * order. Bytes 8–11 hold the file length − 18 and 12–13 a CRC-16/CCITT-FALSE
 * of everything from byte 18.
 */
export const PACE_PRO_BIN = watchfaceBinTarget(getWatchfaceTarget("pace-pro")!);
const HEADER = 0x1202;

export interface CompileOptions {
  /** Face ID stored at byte 4; CorosLink derives a stable one from the archive. */
  faceId: number;
  /** The watch to build for; PACE Pro when omitted. */
  target?: WatchfaceBinTarget;
}

/** Files of a final archive, keyed by their path inside it (`info.json`, `watchface_416x416/...`). */
export type ArchiveFiles = ReadonlyMap<string, Uint8Array>;

/** The face itself cannot be compiled (as opposed to a fault in the compiler). */
export class WatchfaceCompileError extends Error {}

class BlockStream {
  private readonly parts: Buffer[] = [];
  private readonly positions = new Map<string, number>();
  private readonly decoded = new Map<string, RgbaImage | null>();
  offset: number;
  constructor(start: number, private readonly files: ArchiveFiles, private readonly warnings: Set<string>, readonly target: WatchfaceBinTarget) { this.offset = start; }

  private get layout(): string { return this.target.layout; }

  append(bytes: Buffer): number {
    const at = this.offset;
    this.parts.push(bytes);
    this.offset += bytes.length;
    return at;
  }

  image(path: string): RgbaImage | null {
    if (!this.decoded.has(path)) {
      const data = this.files.get(path);
      let image: RgbaImage | null = null;
      try { image = data ? decodePng(data) : null; } catch { image = null; }
      this.decoded.set(path, image);
    }
    return this.decoded.get(path)!;
  }

  /** Why a referenced image could not be used; the paths are case-sensitive, as on the phone. */
  private missing(path: string): void {
    if (!path) return;
    const name = path.slice(this.layout.length + 1);
    if (this.files.has(path)) { this.warnings.add(`${name} is not a readable PNG.`); return; }
    const lower = path.toLowerCase(), near = [...this.files.keys()].find(file => file.toLowerCase() === lower);
    this.warnings.add(near ? `${name} is missing; the archive has ${near.slice(this.layout.length + 1)} (paths are case-sensitive).` : `${name} is missing.`);
  }

  /** Memory-in-pixel blocks index their data with u16 offsets; COROS wraps them past 64 KB. */
  private checked(block: Buffer, path: string): Buffer {
    if (this.target.display === "mip" && mipBlockOverflows(block)) {
      this.warnings.add(`${path.slice(this.layout.length + 1)} is too detailed for ${this.target.label} (over 64 KB in one element) and may show garbled on the watch.`);
    }
    return block;
  }

  /** A single image, deduplicated by path. Missing or unreadable images point at 0, as in COROS. */
  single(path: string, inside: InsideType = InsideType.Normal, transform?: (image: RgbaImage) => RgbaImage): number {
    const cached = this.positions.get(path);
    if (cached !== undefined) return cached;
    const image = this.image(path);
    if (!image) this.missing(path);
    const encode = this.target.display === "mip" ? encodeMipImageBlock : encodeImageBlock;
    const at = image ? this.append(this.checked(encode(transform ? transform(image) : image, inside), path)) : 0;
    this.positions.set(path, at);
    return at;
  }

  /**
   * A directory's PNGs (sorted bytewise) as one block, deduplicated by its
   * first frame's path. `repeat` duplicates the list, as COROS does for the
   * battery level font.
   */
  frames(directory: string, repeat = 1): number {
    const prefix = directory.replace(/\/+$/, "") + "/";
    const names = [...this.files.keys()]
      .filter(name => name.startsWith(prefix) && !name.slice(prefix.length).includes("/") && name.endsWith(".png") && name.length - prefix.length > 4)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (!names.length) { this.missing(prefix.slice(0, -1)); return 0; }
    const cached = this.positions.get(names[0]!);
    if (cached !== undefined) return cached;
    if (names.length * repeat > 255) throw new WatchfaceCompileError(`${directory.slice(this.layout.length + 1)} has too many images for one element (COROS allows 255).`);
    const images = Array.from({ length: repeat }, () => names.map(name => this.image(name))).flat();
    if (!images[0]) { this.missing(names[0]!); this.positions.set(names[0]!, 0); return 0; }
    const encode = this.target.display === "mip" ? encodeMipFramesBlock : encodeFramesBlock;
    const at = this.append(this.checked(encode(images.map(image => image ?? { width: 0, height: 0, data: new Uint8Array() })), directory));
    this.positions.set(names[0]!, at);
    return at;
  }

  bytes(): Buffer[] { return this.parts; }
}

function writeRect(header: Buffer, offset: number, value: string): void {
  const rect = parseRect(value);
  header.writeInt16LE(rect.x0, offset); header.writeInt16LE(rect.y0, offset + 2);
  header.writeInt16LE(rect.x1, offset + 4); header.writeInt16LE(rect.y1, offset + 6);
  header[offset + 8] = rect.align;
}

/** Canonical key → the spelling that fills its slot when the canonical key is absent ("X_on_icon"). */
const ALIAS_OF = new Map(Object.entries(ALIASES).map(([alias, key]) => [key, alias]));

/** The key a config actually supplies for a slot: the canonical key, else its alias. */
function source(config: Map<string, string>, key: string): string | undefined {
  if (config.has(key)) return key;
  const alias = ALIAS_OF.get(key);
  return alias && config.has(alias) ? alias : undefined;
}

/** A gated field is written only when one of its companions (or a companion's alias) is present. */
function gated(config: Map<string, string>, key: string): boolean {
  const gates = FIELDS[key]?.[2];
  return !gates?.length || gates.some(gate => source(config, gate) !== undefined);
}

/** Whether COROS writes `key`'s field for this config (present, not overridden by its canonical key, gated). */
function written(config: Map<string, string>, key: string): boolean {
  const canonical = ALIASES[key];
  if (canonical && config.has(canonical)) return false;
  // The control panel is laid out relative to rect_control1_pos; without it COROS writes no control field.
  if (key.startsWith("control_") && !config.has("rect_control1_pos")) return false;
  return config.has(key) && gated(config, key);
}

/** Icon keys that name a folder (unit and level icons) compile as frame lists, as in COROS. */
function isDirectory(files: ArchiveFiles, path: string): boolean {
  const prefix = path.replace(/\/+$/, "") + "/";
  for (const name of files.keys()) if (name.startsWith(prefix)) return true;
  return false;
}

function buildLayout(config: Map<string, string>, mode: "normal" | "aod", stream: BlockStream, info: Record<string, unknown>,
  options: CompileOptions, files: ArchiveFiles, warnings: Set<string>): Buffer {
  const header = Buffer.alloc(HEADER), target = stream.target;
  // COROS resolves only backslash-separated paths; a "/" makes the image unreadable (pointer 0).
  const path = (value: string) => {
    if (value.includes("/")) { warnings.add(`${value} uses "/"; write it as ${value.replace(/\//g, "\\")}.`); return ""; }
    return `${target.layout}/${configPath(value)}`;
  };
  // COROS keeps only the digits of {x,y}, so a negative coordinate flips sign.
  const position = (key: string): [number, number] => {
    const value = config.get(key)!, [x, y] = parsePos(value);
    if (value.includes("-")) warnings.add(`${key} is ${value}, but COROS drops minus signs, so it lands at {${x},${y}}.`);
    return [x, y];
  };
  let version = typeof info.o_wf_ver === "number" ? info.o_wf_ver : 0;
  // SetHead. The AOD header carries no face ID of its own.
  header.write(target.magic, 0, "latin1");
  header.writeUInt32LE(mode === "normal" ? options.faceId >>> 0 : 0xffffffff, 4);
  const flag = (key: string) => config.has(key) ? parseNumber(config.get(key)!) : 0;
  header[0x10] = ((flag("watchface_theme_color_off") & 1) | ((flag("watchface_point_layer") & 1) << 1) |
    ((flag("watchface_time_format") & 3) << 2) | (flag("watchface_default_theme_color") << 4)) & 0xff;
  // Firmware fills AOD with black regardless of this color byte.
  if (mode === "normal" && config.has("bg_color")) header[0x22] = rgb222(parseNumber(config.get("bg_color")!));
  header.writeUInt16LE(HEADER, 0x138);
  header[0x13b] = typeof info.o_diy_version === "number" ? info.o_diy_version & 0xff : 0;
  // Official BINs include an AOD background, although COROS's DIY exporter
  // skips it. Studio's AOD artwork may omit its position; default to {0,0}.
  if (written(config, "background_icon_pos") || (mode === "aod" && config.has("background_icon"))) {
    const [x, y] = config.has("background_icon_pos") ? position("background_icon_pos") : [0, 0];
    header.writeInt32LE(x, 0x12); header.writeInt32LE(y, 0x16);
    if (config.has("background_icon")) {
      header.writeUInt32LE(stream.single(path(config.get("background_icon")!), InsideType.Background,
        image => scaleImage(image, target.screen, target.screen)), 0x1a);
    }
  }
  // Only the normal layout has a picker thumbnail.
  if (mode === "normal") {
    // COROS ignores both images here and renders the picker thumbnail itself
    // (background plus elements with demo values), so watchface_thmb_icon, often
    // just the bare background, showed an empty face. The composed preview is
    // the closest stand-in; watchface_thmb_icon is the fallback.
    const thumbnail = config.get("watchface_thmb_icon");
    const candidates = [typeof info.m_preview === "string" ? info.m_preview : "", thumbnail ? path(thumbnail) : ""];
    const thumbnailPath = candidates.find(candidate => candidate && stream.image(candidate));
    if (thumbnailPath) {
      header.writeUInt32LE(stream.single(thumbnailPath, InsideType.Thumbnail, image => scaleImage(image, target.thumbnail, target.thumbnail)), 0x1e);
    }
  }
  // Positions and rectangles carry no blocks, so they can be written in any order.
  for (const [key, [kind, offset]] of Object.entries(FIELDS)) {
    if (!written(config, key)) continue;
    version = Math.max(version, VERSIONS[key] ?? 0);
    const value = config.get(key)!;
    if (kind === "pos") { const [x, y] = position(key); header.writeInt32LE(x, offset); header.writeInt32LE(y, offset + 4); }
    else if (kind === "rect") writeRect(header, offset, value);
  }
  for (const key of WRITE_ORDER) {
    if (key === "#heartrate") { writeHeartRate(config, header, stream, path); continue; }
    if (key === "#autoalign") { writeAutoAlign(config, header, stream, path); continue; }
    const supplied = source(config, key);
    if (!supplied || !written(config, supplied)) continue;
    const [kind] = FIELDS[supplied]!, offset = FIELDS[key]![1], value = path(config.get(supplied)!);
    const frames = kind === "frames" || isDirectory(files, value);
    header.writeUInt32LE(frames ? stream.frames(value, key === "battery_level_font" ? 2 : 1) : stream.single(value), offset);
  }
  // Colors after their owners; a "_font_color" wins over a plain "_color" sharing its byte.
  for (const [key, [offset, owner]] of Object.entries(COLORS).sort(([a], [b]) => Number(a.endsWith("_font_color")) - Number(b.endsWith("_font_color")))) {
    const value = config.get(key), ownerKey = source(config, owner);
    if (value !== undefined && ownerKey && written(config, ownerKey)) header[offset] = rgb222(parseNumber(value));
  }
  writeSpecials(config, header);
  header[0x13a] = version & 0xff;
  return header;
}

/** SetStatus ends with heart rate: a 34-byte record (rect, align, font pointer) followed by its font. */
function writeHeartRate(config: Map<string, string>, header: Buffer, stream: BlockStream, path: (v: string) => string): void {
  const rect = config.get("heartreate_level_rect"), font = config.get("heartreate_level_font");
  if (!rect || !font) return;
  const record = Buffer.alloc(34);
  writeRect(record, 0, rect);
  const color = config.get("heartreate_level_font_color");
  if (color) record[14] = rgb222(parseNumber(color));
  const at = stream.append(record);
  record.writeUInt32LE(stream.frames(path(font)), 10);
  header.writeUInt32LE(at, 0x316);
}

/** SetAutoAlign: a 40-byte record (rect, align, "1" width, colon and digit font pointers), then the font and colon. */
function writeAutoAlign(config: Map<string, string>, header: Buffer, stream: BlockStream, path: (v: string) => string): void {
  const rect = config.get("autoalign_time_rect"), font = config.get("autoalign_time_font");
  if (!rect || !font) return;
  const record = Buffer.alloc(40);
  writeRect(record, 0, rect);
  record.writeUInt16LE(parseNumber(config.get("autoalign_time_digit_one_real_xsize") ?? "0") & 0xffff, 10);
  const color = config.get("autoalign_time_font_color");
  if (color) record[20] = rgb222(parseNumber(color));
  const at = stream.append(record);
  record.writeUInt32LE(stream.frames(path(font)), 16);
  const colon = config.get("autoalign_time_colon_icon");
  if (colon) record.writeUInt32LE(stream.single(path(colon)), 12);
  header.writeUInt32LE(at, 0x31e);
}

/** Arcs, chart styling and other scalar records. */
function writeSpecials(config: Map<string, string>, header: Buffer): void {
  for (const [key, offset, colorKey] of [["kcal_progress_arc", 0xee, "kcal_progress_arc_color"], ["exercise_progress_arc", 0x118, "exercise_progress_arc_color"]] as const) {
    const value = config.get(key);
    if (!value) continue;
    const numbers = (value.match(/-?\d+/g) ?? []).map(Number);
    for (let i = 0; i < 6; i++) header.writeInt16LE((numbers[i] ?? 0) << 16 >> 16, offset + i * 2);
    header[offset + 12] = numbers[6] ?? 0;
    header[offset + 13] = numbers[7] ?? 0;
    const color = config.get(colorKey);
    if (color) header.writeUInt16LE(rgb222(parseNumber(color)), offset + 14);
  }
  const chartNumber = (key: string, offset: number, size: 1 | 2) => {
    const value = config.get(key);
    if (value === undefined) return;
    if (size === 2) header.writeUInt16LE(parseNumber(value) & 0xffff, offset); else header[offset] = parseNumber(value) & 0xff;
  };
  chartNumber("chart_bar_width", 0xdda, 2);
  chartNumber("chart_bar_interval", 0xddc, 2);
  chartNumber("chart_curves_width", 0xe66, 1);
  // Chart colors are full 0x00RRGGBB words, as in COROS-built faces. COROS's custom-face compiler packs them to
  // rgb222 here, which PACE Pro reads as 0x0000XX, so every chart drew dark navy; this deliberately differs.
  for (const [key, offset] of [["chart_selected_bar_color", 0xdde], ["chart_unselected_bar_color", 0xde2], ["chart_curves_upper_color", 0xe5e], ["chart_curves_lower_color", 0xe62]] as const) {
    const value = config.get(key);
    if (value !== undefined) header.writeUInt32LE(parseNumber(value) & 0xffffff, offset);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n << 8;
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  return crc;
});
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) crc = ((crc << 8) ^ crcTable[((crc >> 8) ^ byte) & 0xff]!) & 0xffff;
  return crc;
}

export interface CompiledWatchface {
  bin: Buffer;
  /** What COROS would get wrong too: images it cannot load (left blank) and negative positions (sign dropped). */
  warnings: string[];
}

/** Compiles a final archive's layout for one watch (PACE Pro's 416 × 416 by default) to a BIN. */
export function compileWatchface(files: ArchiveFiles, options: CompileOptions): CompiledWatchface {
  const target = options.target ?? PACE_PRO_BIN;
  const text = (name: string) => { const data = files.get(name); return data ? Buffer.from(data).toString("latin1") : undefined; };
  const info = JSON.parse(text("info.json") ?? "{}") as Record<string, unknown>;
  const configText = text(`${target.layout}/config.txt`);
  if (configText === undefined) throw new WatchfaceCompileError(`This archive has no ${target.screen} × ${target.screen} ${target.label} layout.`);
  const aodText = text(`${target.layout}/AODconfig.txt`);
  const warnings = new Set<string>();
  const stream = new BlockStream(aodText !== undefined ? HEADER * 2 : HEADER, files, warnings, target);
  const normal = buildLayout(parseConfig(configText), "normal", stream, info, options, files, warnings);
  const aod = aodText !== undefined ? buildLayout(parseConfig(aodText), "aod", stream, info, options, files, warnings) : null;
  if (aod) normal.writeUInt32LE(HEADER, 0x322);
  const bin = Buffer.concat([normal, ...(aod ? [aod] : []), ...stream.bytes()]);
  bin.writeUInt32LE(bin.length - 18, 8);
  bin.writeUInt16LE(crc16(bin.subarray(18)), 12);
  return { bin, warnings: [...warnings] };
}
