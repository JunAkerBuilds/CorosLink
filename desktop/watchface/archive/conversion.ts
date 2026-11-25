// Converting a watch face to another watch: CorosLink's electron/watchfaceArchiveConversion.ts rewritten without
// Electron (docs/studio-port.md, phase 6). PNGs are read and written with the compiler's own decoder and encoder and
// resized with its shrinkImage (Lanczos-3 down, close to Chromium's "best" that CorosLink used; bilinear up, as
// CorosLink switched to) in place of nativeImage. The rules are CorosLink's;
// see its docs/watchface-conversion.md.
import type { WatchfaceTarget } from "../watchfaceTargets";
import { decodePng, encodePng, type RgbaImage } from "../compiler/png";
import { shrinkImage } from "../compiler/scale";
import { restoreWatchfaceDateLayout } from "./deviceLayout";
import { normalizeConversionPath, RETAINED_AOD_CONFIG } from "./template";

export { normalizeConversionPath, RETAINED_AOD_CONFIG };

export interface WatchfaceConversionEntry { name: string; data: Buffer }

export interface WatchfaceConversion {
  entries: WatchfaceConversionEntry[];
  appliedRawConfigEditCount: number;
  generatedAod: boolean;
  aodDesignScale: number;
}

/** Studio-owned keys for the native sprite animation (header 0x312); Current only. */
const ANIMATION_CONFIG_KEYS = ["cl_animation_pos", "cl_animation_dir", "cl_animation_delays_ms"] as const;
const CONFIG_FILE = /^(?:AODconfig|config|CorosLinkAODconfig)\.txt$/i;
const LAYOUT_CONFIG = /^watchface_\d+x\d+\/(?:AOD)?config\.txt$/i;

function readConfig(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/^\s*\[([^\]]+)\]\s*=([^\r\n]*)/gm)]
    .map(match => [match[1]!.trim(), match[2]!.trim()]));
}

/** Scale geometry only. IDs, flags, alignments, arc angles and colors survive. */
export function scaleWatchfaceConfig(text: string, scale: number): string {
  if (scale === 1) return text;
  return text.replace(/^(\s*\[([^\]]+)\]\s*=)([^\r\n]*)/gm, (_line, prefix: string, key: string, value: string) => {
    const isArc = /_progress_arc$/.test(key);
    const geometry = /_(?:pos|rect)$/.test(key) || isArc || key === "time_center_polygon_icon2";
    if (geometry) {
      value = value.replace(/\{([^}]*)\}/g, (_tuple, body: string) => `{${body.split(",").map((part, index) => {
        const coordinate = isArc ? index < 4 || index === 6 : index < (/_rect$/.test(key) ? 4 : 2);
        return coordinate && /^-?\d+(?:\.\d+)?$/.test(part.trim())
          ? String(Math.round(Number(part) * scale)) : part;
      }).join(",")}}`);
    } else if (key === "autoalign_time_digit_one_real_xsize" || /_(?:radius|width|height)$/.test(key)) {
      if (/^\s*\d+(?:\.\d+)?\s*$/.test(value)) value = String(Number(value) === 0 ? 0 : Math.max(1, Math.round(Number(value) * scale)));
    } else if (/\{/.test(value)) {
      // Unknown raw geometry must not be guessed or silently corrupted.
      throw new Error(`Cannot scale the unrecognized geometry [${key}]. The source project is unchanged.`);
    }
    return prefix + value;
  });
}

function setConfigValue(text: string, key: string, value: string | undefined): string {
  // Horizontal whitespace only: \s can consume the LF of the preceding CRLF
  // and join an edited entry to a comment or another key for line-based readers.
  const pattern = new RegExp(`^[\\t ]*\\[${key}\\][\\t ]*=[^\\r\\n]*`, "gm");
  if (value === undefined) return text.replace(pattern, "");
  return pattern.test(text) ? text.replace(pattern, () => `[${key}]=${value}`) : `${text}\r\n[${key}]=${value}\r\n`;
}

function readPng(data: Buffer, name: string): RgbaImage {
  try { return decodePng(data); } catch { throw new Error(`Cannot read source image ${name}.`); }
}

function resizePngTo(data: Buffer, width: number, height: number, name: string): Buffer {
  const image = readPng(data, name);
  if (image.width === width && image.height === height) return data;
  if (width > 4096 || height > 4096) throw new Error(`The converted image ${name} would be too large.`);
  return encodePng(shrinkImage(image, width, height));
}

function resizePng(data: Buffer, scale: number, name: string): Buffer {
  if (scale === 1) return data;
  const { width, height } = readPng(data, name);
  return resizePngTo(data, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), name);
}

/** The size of a PNG, or undefined when it can't be read. */
function pngDimensions(data: Buffer | undefined): { width: number; height: number } | undefined {
  if (!data) return undefined;
  try { const { width, height } = decodePng(data); return { width, height }; } catch { return undefined; }
}

/**
 * Transplant the source template, never the destination's visual defaults.
 * The carrier contributes its manifest/device IDs only. Studio edits remain
 * live against the same 800px baseline, so offsets/effects are not baked twice.
 */
export function convertWatchfaceEntries(
  input: WatchfaceConversionEntry[],
  carrier: WatchfaceConversionEntry[],
  target: WatchfaceTarget,
  configTextEdits: Record<string, string> = {},
  /** False leaves an AMOLED destination with no AOD when the source has none, instead of a copy of Current. */
  generateAod = true
): WatchfaceConversion {
  return convertEntries(input, carrier, target, configTextEdits, false, undefined, generateAod);
}

/** Final composed recovery export, not a replacement for the editor baseline. */
export function prepareRecoveredWatchfaceExport(
  input: WatchfaceConversionEntry[],
  carrier: WatchfaceConversionEntry[],
  target: WatchfaceTarget,
  /** The editor's 800px background render: each size's background.png is drawn from it, not enlarged from the native tree. */
  masterBackground?: Buffer
): WatchfaceConversionEntry[] {
  // Starters recovered before 2026-09-18 referenced `recovered/group-NN` with
  // forward slashes, which COROS compiles to blank elements on the watch. The
  // firmware convention is backslashes; rewrite saved projects on export.
  return convertEntries(input, carrier, target, {}, true, masterBackground).entries.map(entry => {
    if (!/\/(?:AOD)?config\.txt$/i.test(entry.name)) return entry;
    const text = entry.data.toString("utf8");
    const fixed = text.replace(/^(\s*\[[^\]]+\]\s*=\s*)(recovered\/[^\r\n]*)$/gm, (_, prefix: string, value: string) => `${prefix}${value.replace(/\//g, "\\")}`);
    return fixed === text ? entry : { ...entry, data: Buffer.from(fixed, "utf8") };
  });
}

/** Every key a face's layouts set to something (blank declarations left out), lower-cased. */
export function configKeysOf(entries: WatchfaceConversionEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!LAYOUT_CONFIG.test(normalizeConversionPath(entry.name))) continue;
    for (const match of entry.data.toString("utf8").matchAll(/^[\t ]*\[([a-z0-9_]+)\][\t ]*=[\t ]*\S/gim)) keys.add(match[1]!.toLowerCase());
  }
  return keys;
}

/**
 * Every `[key]=` a template declares, blank values included. COROS's compiler
 * fills the slots its template owns and drops keys the template never declared,
 * so this list is the template's capability surface, not just its content.
 */
export function declaredConfigKeys(entries: WatchfaceConversionEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!LAYOUT_CONFIG.test(normalizeConversionPath(entry.name))) continue;
    for (const match of entry.data.toString("utf8").matchAll(/^[\t ]*\[([a-z0-9_]+)\][\t ]*=/gim)) keys.add(match[1]!.toLowerCase());
  }
  return keys;
}

/** True for the template ID of a face converted on a local carrier (see localConversionCarrier). */
export function isLocalTemplateId(templateId: string): boolean {
  return /^0+$/.test(templateId);
}

/**
 * A minimal carrier for converting without a COROS template. It has no catalog
 * template ID (0), so a face built on it installs directly on the watch but is
 * not recognized as a DIY template by the COROS app. Built in memory on each
 * use and never cached, so the next conversion with COROS's catalog fetches the real one.
 */
export function localConversionCarrier(target: WatchfaceTarget): WatchfaceConversionEntry[] {
  const blank = (size: number) => encodePng({ width: size, height: size, data: new Uint8Array(size * size * 4) });
  const info = { m_name: target.label, m_app: "watchface_800x800", m_preview: "watchface_customize.png", m_style: { m_color: "" },
    o_author: "CorosLink", o_default_language: "en", o_wf_ver: 0, o_template_id: 0, o_diy_version: 1 };
  const entries: WatchfaceConversionEntry[] = [
    { name: "info.json", data: Buffer.from(JSON.stringify(info)) },
    { name: "watchface_customize.png", data: blank(800) },
  ];
  for (const size of target.sizes) {
    // Official carriers ship device thumbnails at about 76% of the screen (315 px on 416).
    entries.push({ name: `watchface_${size}x${size}/thmb.png`, data: blank(size === 800 ? 800 : Math.round(size * 315 / 416)) });
    entries.push({ name: `watchface_${size}x${size}/config.txt`, data: Buffer.from("[watchface_thmb_icon]=thmb.png\r\n") });
  }
  return entries;
}

function convertEntries(
  input: WatchfaceConversionEntry[],
  carrier: WatchfaceConversionEntry[],
  target: WatchfaceTarget,
  configTextEdits: Record<string, string>,
  recoveredExport: boolean,
  masterBackground?: Buffer,
  // A finished export (recoveredExport) is never reviewed, so it never invents an AOD.
  generateAod = !recoveredExport
): WatchfaceConversion {
  const source = new Map<string, Buffer>();
  for (const entry of input) {
    const name = normalizeConversionPath(entry.name);
    if (source.has(name)) throw new Error(`Duplicate source entry ${name}.`);
    source.set(name, /\/config\.txt$/i.test(name)
      ? Buffer.from(restoreWatchfaceDateLayout(entry.data.toString("utf8")), "utf8") : entry.data);
  }
  // Faces given a photo in the COROS app keep it in custom/custom_bg.png,
  // pointed to by custom/custom.pb, and leave every layout background blank.
  // That pointer is the app's state, not firmware data: fold the photo into
  // the master background below so it survives on the destination watch.
  const customBackground = source.has("custom/custom.pb") ? source.get("custom/custom_bg.png") : undefined;
  if (customBackground) {
    source.delete("custom/custom.pb");
    source.delete("custom/custom_bg.png");
  }
  // Native-resolution export scales from the face's own layout. That suits a
  // recovered official face and any face that has no 800px master (a COROS-app
  // DIY face carries only its watch's layout); a face with a master keeps it.
  if (recoveredExport && JSON.parse(source.get("info.json")?.toString("utf8") ?? "{}").coroslinkRecovery?.partial !== true &&
    source.has("watchface_800x800/config.txt")) {
    throw new Error("Only a recovered official face can use native-resolution export.");
  }
  if ([...source.keys()].some(name => {
    if (!/\.(?:pb|bin)$/i.test(name)) return false;
    if (recoveredExport && name === "recovery/source.bin") return false;
    // Older official editable packages include cached firmware builds next to
    // their source configs. Those builds are regenerated by COROS on install.
    const cachedBuild = name.match(/^(watchface_\d+x\d+)\/watchface(?:_ota)?\.bin$/i);
    return !cachedBuild || !source.has(`${cachedBuild[1]}/config.txt`);
  })) {
    throw new Error("This archive contains compiled device data. Open its editable source project before converting.");
  }
  const resolutions = [...source.keys()].flatMap(name => {
    const match = name.match(/^watchface_(\d+)x\1\/config\.txt$/);
    return match ? [Number(match[1])] : [];
  }).sort((a, b) => b - a);
  if (!resolutions.includes(800) && !recoveredExport) throw new Error("This source has no 800px master layout. Conversion cannot preserve its authoring coordinates.");
  // Scale final recovery output directly from its native layout. The 416px
  // tree must not make a lossy round trip through an upscaled 800px master.
  const masterSize = resolutions.includes(800) ? 800 : resolutions[0];
  if (!masterSize) throw new Error("The recovered face has no editable layout to export.");
  const dir = (size: number) => `watchface_${size}x${size}`;
  const textAt = (size: number, file: string) => source.get(`${dir(size)}/${file}`)?.toString("utf8");
  const edits = Object.entries(configTextEdits).map(([name, text]) =>
    [normalizeConversionPath(name), restoreWatchfaceDateLayout(text)] as const);
  for (const [name] of edits) {
    if (!source.has(name) || !/^watchface_\d+x\d+\/(?:AOD)?config\.txt$/.test(name)) {
      throw new Error(`The raw layout edit ${name} does not belong to the source template.`);
    }
  }
  // Move per-resolution raw changes into the portable master. A master edit
  // wins a conflict; otherwise the largest edited device tree wins per key.
  const applyRawChanges = (text: string, mode: "config.txt" | "AODconfig.txt") => {
    for (const [name, edited] of [...edits].sort((a, b) => Number(a[0].match(/_(\d+)/)![1]) - Number(b[0].match(/_(\d+)/)![1]))) {
      if (!name.endsWith(`/${mode}`)) continue;
      const before = readConfig(source.get(name)!.toString("utf8"));
      const after = readConfig(edited);
      const size = Number(name.match(/_(\d+)/)![1]);
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!/^[a-z0-9_]+$/i.test(key)) throw new Error(`Unsupported raw config key [${key}].`);
        if (before[key] === after[key] || key === "watchface_id") continue;
        const scaled = after[key] === undefined ? undefined : readConfig(scaleWatchfaceConfig(`[${key}]=${after[key]}`, masterSize / size))[key];
        text = setConfigValue(text, key, scaled);
      }
    }
    return text;
  };
  // The 800px master may leave out or blank keys that the watch trees fill (Nixie's AM/PM exists only
  // at 416; the SLENDER family fills colon_icon, negative_sign_icon and AM/PM only at 390). Every tree
  // is built from the master, so take those keys from the largest tree that has them, scaled; the PNGs
  // they name come from that same tree below (keySources), so artwork and position always match.
  const keySources = new Map<string, { size: number; value: string }>();
  const withDeviceOnlyKeys = (text: string) => {
    const master = readConfig(text);
    // Trees are visited largest first; the first tree with a value wins. A blank declaration only
    // stands in until then, so a blank in a larger tree never hides a value a smaller one sets.
    const filled = new Set<string>();
    const declared = new Set<string>();
    for (const size of resolutions.filter(size => size !== masterSize)) {
      const device = readConfig(textAt(size, "config.txt") ?? "");
      for (const [key, value] of Object.entries(device)) {
        if (key === "watchface_id" || key === "watchface_thmb_icon" || filled.has(key) || master[key]) continue;
        if (!value) {
          // A key the master leaves out is copied even blank (a dormant declaration such as AM/PM, which
          // Studio fills only in trees that declare it); a key the master blanks stays as it is.
          if (key in master || declared.has(key)) continue;
          text = setConfigValue(text, key, "");
          declared.add(key);
          continue;
        }
        let scaled: string | undefined;
        try { scaled = readConfig(scaleWatchfaceConfig(`[${key}]=${value}`, masterSize / size))[key]; } catch { continue; }
        // undefined would delete the key (setConfigValue), including a blank declaration copied above.
        if (scaled === undefined) continue;
        text = setConfigValue(text, key, scaled);
        filled.add(key);
        keySources.set(key, { size, value });
      }
    }
    return text;
  };
  const current = applyRawChanges(withDeviceOnlyKeys(textAt(masterSize, "config.txt")!), "config.txt");
  const masterAssets = new Map<string, Buffer>();
  for (const [name, data] of source) {
    if (name.startsWith(`${dir(masterSize)}/`) && !CONFIG_FILE.test(name.slice(dir(masterSize).length + 1))) {
      masterAssets.set(name.slice(dir(masterSize).length + 1), data);
    }
  }
  if (customBackground) {
    const backgroundName = (readConfig(current).background_icon?.trim().replace(/\\/g, "/").replace(/^\.\//, "")) || "background.png";
    const width = pngDimensions(customBackground)?.width;
    if (!width) throw new Error("Cannot read the face's COROS background photo.");
    masterAssets.set(backgroundName, resizePng(customBackground, masterSize / width, "custom/custom_bg.png"));
  }
  // Some official AMOLED templates only supply AOD at the physical size. Studio's
  // export then fills the missing 800px AOD by rescaling it, dropping every key
  // whose AOD-only assets live in the physical tree alone (time digits,
  // background). A second pass must not convert that thinned copy, or the always-on
  // screen comes out blank: a smaller tree's AOD wins over a larger one only when it
  // draws with images the larger tree has no copy of. Counting keys is not enough:
  // official templates with an intact 800px AOD declare a few more keys at the
  // watch's size (STANDARD's AM/PM and low-power battery, naming files neither tree
  // ships), and the design's AOD was composed against the 800px one.
  const aodText = (size: number) => textAt(size, "AODconfig.txt") ?? textAt(size, RETAINED_AOD_CONFIG);
  const sourcePngs = [...source.keys()].filter(name => /\.png$/i.test(name));
  const carriesImage = (size: number, relative: string) =>
    sourcePngs.some(name => name === `${dir(size)}/${relative}` || name.startsWith(`${dir(size)}/${relative}/`));
  const drawsWithOwnImages = (size: number, larger: number) => {
    const kept = readConfig(aodText(larger)!);
    return Object.entries(readConfig(aodText(size)!)).some(([key, value]) => {
      const relative = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
      return Boolean(relative) && !kept[key] && carriesImage(size, relative) && !carriesImage(larger, relative);
    });
  };
  const aodSize = resolutions.filter(size => aodText(size))
    .reduce<number | undefined>((best, size) => best === undefined || drawsWithOwnImages(size, best) ? size : best, undefined);
  let aod = aodSize ? textAt(aodSize, "AODconfig.txt") ?? textAt(aodSize, RETAINED_AOD_CONFIG)! : current;
  if (aodSize && aodSize !== masterSize) {
    aod = scaleWatchfaceConfig(aod, masterSize / aodSize);
    // Isolate physical AOD assets; they can share filenames with Current.
    for (const [name, data] of source) {
      if (!name.startsWith(`${dir(aodSize)}/`) || !/\.png$/i.test(name)) continue;
      const relative = name.slice(dir(aodSize).length + 1);
      masterAssets.set(`cl_aod_source/${relative}`, resizePng(data, masterSize / aodSize, name));
    }
  }
  aod = applyRawChanges(aod, "AODconfig.txt");
  if (aodSize && aodSize !== masterSize) {
    aod = aod.replace(/^(\s*\[[^\]]+\]\s*=)([^\r\n]*)/gm, (_line, prefix: string, value: string) => {
      const relative = value.trim().replace(/\\/g, "/");
      const isAsset = [...masterAssets.keys()].some(name => name === `cl_aod_source/${relative}` || name.startsWith(`cl_aod_source/${relative}/`));
      // Config paths use backslashes: COROS's compiler reads a "/" path as no image (pointer 0), so the
      // always-on artwork would compile blank. Zip entry names (masterAssets keys) keep "/".
      return prefix + (relative && isAsset ? `cl_aod_source\\${relative.replace(/\//g, "\\")}` : value);
    });
  }

  // A key taken from a watch tree brings the image (or frame folder) it names from that tree, ahead
  // of a same-named file in a larger tree that may be other artwork at another size. The master's own
  // files stay: other keys there already use them.
  for (const { size, value } of keySources.values()) {
    const relative = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!relative) continue;
    for (const [name, data] of source) {
      if (!name.startsWith(`${dir(size)}/`) || !/\.png$/i.test(name)) continue;
      const file = name.slice(dir(size).length + 1);
      if ((file === relative || file.startsWith(`${relative}/`)) && !masterAssets.has(file)) {
        masterAssets.set(file, resizePng(data, masterSize / size, name));
      }
    }
  }
  // Fill resources omitted from the master from the largest physical source.
  // Keep every state and every language, including ones not previewed in Studio.
  for (const size of resolutions.filter(size => size !== masterSize)) {
    for (const [name, data] of source) {
      if (!name.startsWith(`${dir(size)}/`) || !/\.png$/i.test(name)) continue;
      const relative = name.slice(dir(size).length + 1);
      if (!masterAssets.has(relative)) masterAssets.set(relative, resizePng(data, masterSize / size, name));
    }
  }
  const destination = new Map(carrier.map(entry => [normalizeConversionPath(entry.name), entry.data]));
  const manifest = destination.get("info.json");
  let preview = source.get("watchface_customize.png");
  if (!manifest || !preview) throw new Error("The conversion needs a valid source and destination manifest/preview.");
  const sourceInfo = source.get("info.json")?.toString("utf8") ?? "{}";
  const version = Math.max(Number(JSON.parse(sourceInfo).o_wf_ver ?? 0), Number(JSON.parse(manifest.toString("utf8")).o_wf_ver ?? 0));
  // Preserve the carrier's decimal template ID as raw text (it may exceed 2^53).
  const carrierInfo = manifest.toString("utf8");
  const templateId = carrierInfo.match(/"o_template_id"\s*:\s*("?\d+"?)/)?.[1];
  if (!templateId) throw new Error("The destination has no template identity.");
  let info = sourceInfo.replace(/("o_template_id"\s*:)\s*(?:"\d+"|\d+)/, (_match, key: string) => key + templateId);
  if (recoveredExport) {
    if (JSON.parse(sourceInfo).coroslinkRecovery?.partial === true) {
      // The catalog watchFaceId is not a DIY srcWatchFaceTemplateId. Use the
      // complete editable carrier manifest, including its DIY/app metadata.
      info = carrierInfo;
      const name = JSON.parse(sourceInfo).m_name;
      if (typeof name === "string") {
        info = /"m_name"\s*:/.test(info)
          ? info.replace(/"m_name"\s*:\s*"(?:\\.|[^"\\])*"/, () => `"m_name":${JSON.stringify(name)}`)
          : info.replace("{", () => `{"m_name":${JSON.stringify(name)},`);
      }
    } else if (!/"o_template_id"\s*:/.test(info)) {
      // A DIY face keeps its own manifest (author, style, language) under the destination's template.
      info = info.replace("{", () => `{"o_template_id":${templateId},`);
    }
    if (!/"m_app"\s*:/.test(info)) info = info.replace("{", '{"m_app":"watchface_800x800",');
    if (!/"m_preview"\s*:/.test(info)) info = info.replace("{", '{"m_preview":"watchface_customize.png",');
    info = info.replace(/"m_preview"\s*:\s*"[^"]*"/, '"m_preview":"watchface_customize.png"');
    const dimensions = pngDimensions(destination.get("watchface_customize.png"));
    if (!pngDimensions(preview) || !dimensions) throw new Error("The export template is missing a readable preview.");
    preview = resizePngTo(preview, dimensions.width, dimensions.height, "watchface_customize.png");
  }
  info = info.replace(/"m_app"\s*:\s*"[^"]*"/, '"m_app":"watchface_800x800"');
  info = /"o_wf_ver"\s*:/.test(info) ? info.replace(/("o_wf_ver"\s*:)\s*\d+/, `$1${version}`) : info.replace("{", `{"o_wf_ver":${version},`);
  const entries: WatchfaceConversionEntry[] = [{ name: "info.json", data: Buffer.from(info) }, { name: "watchface_customize.png", data: preview }];
  const masterBackgroundWidth = masterBackground ? pngDimensions(masterBackground)?.width ?? 0 : 0;
  if (masterBackground && !masterBackgroundWidth) throw new Error("Cannot read the face's background render.");
  for (const size of target.sizes) {
    for (const [relative, data] of masterAssets) {
      if (/\.DS_Store$|\.pb$|\.bin$/i.test(relative)) continue;
      if (recoveredExport && relative === "thmb.png") continue;
      // The editor drew the background at 800px; shrinking that is sharper than enlarging the native tree's copy.
      const fromRender = masterBackground && recoveredExport && relative.toLowerCase() === "background.png";
      entries.push({ name: `${dir(size)}/${relative}`, data: fromRender ? resizePng(masterBackground, size / masterBackgroundWidth, relative)
        : /\.png$/i.test(relative) ? resizePng(data, size / masterSize, relative) : data });
    }
    if (recoveredExport) {
      const dimensions = pngDimensions(destination.get(`${dir(size)}/thmb.png`));
      if (!pngDimensions(preview) || !dimensions) throw new Error("The export template is missing a readable thumbnail.");
      entries.push({ name: `${dir(size)}/thmb.png`, data: resizePngTo(preview, dimensions.width, dimensions.height, "thmb.png") });
    }
    const carrierConfig = destination.get(`${dir(size)}/config.txt`);
    if (!carrierConfig) throw new Error(`The destination template lacks the ${size}px layout.`);
    const id = readConfig(carrierConfig.toString("utf8")).watchface_id;
    for (const [file, text] of [["config.txt", current], [target.display === "amoled" ? "AODconfig.txt" : RETAINED_AOD_CONFIG, aod]] as const) {
      // On MIP retain only the master AOD, avoiding unused device mode files.
      if (file === RETAINED_AOD_CONFIG && (size !== 800 || !aodSize)) continue;
      // With no source AOD, a generated one is a full-brightness copy of Current: only where it is reviewed.
      if (file !== "config.txt" && !aodSize && !generateAod) continue;
      let scaled = scaleWatchfaceConfig(text, size / masterSize);
      // Firmware never animates always-on; a generated AOD (a copy of Current) must not carry the record.
      if (file !== "config.txt") for (const key of ANIMATION_CONFIG_KEYS) scaled = setConfigValue(scaled, key, undefined);
      if (id !== undefined) scaled = setConfigValue(scaled, "watchface_id", id);
      if (recoveredExport) scaled = setConfigValue(scaled, "watchface_thmb_icon", "thmb.png");
      entries.push({ name: `${dir(size)}/${file}`, data: Buffer.from(scaled) });
    }
  }
  // An AOD that only the physical tree carried was composed against that tree; it is now
  // composed against the master, so the design's AOD sizes grow by this much to stay put.
  const aodDesignScale = aodSize && aodSize !== masterSize ? masterSize / aodSize : 1;
  return { entries, appliedRawConfigEditCount: edits.length, generatedAod: !aodSize && generateAod && target.display === "amoled", aodDesignScale };
}
