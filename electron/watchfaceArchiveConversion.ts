import { nativeImage } from "electron";
import type { WatchfaceTarget } from "./watchfaceTargets";

export interface WatchfaceConversionEntry { name: string; data: Buffer }

// Keep AOD editable through a MIP round trip without exposing it to the MIP
// compiler or to Studio's active-mode detection.
export const RETAINED_AOD_CONFIG = "CorosLinkAODconfig.txt";
const CONFIG_FILE = /^(?:AODconfig|config|CorosLinkAODconfig)\.txt$/i;

export function normalizeConversionPath(name: string): string {
  return name.replace(/^watchface_(\d+)(?:×|\?\?)(\d+)\//, "watchface_$1x$2/");
}

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
  // Horizontal whitespace only: \\s can consume the LF of the preceding CRLF
  // and join an edited entry to a comment or another key for line-based readers.
  const pattern = new RegExp(`^[\\t ]*\\[${key}\\][\\t ]*=[^\\r\\n]*`, "gm");
  if (value === undefined) return text.replace(pattern, "");
  return pattern.test(text) ? text.replace(pattern, () => `[${key}]=${value}`) : `${text}\r\n[${key}]=${value}\r\n`;
}

function resizePng(data: Buffer, scale: number, name: string): Buffer {
  if (scale === 1) return data;
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) throw new Error(`Cannot read source image ${name}.`);
  const { width, height } = image.getSize();
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (w > 4096 || h > 4096) throw new Error(`The converted image ${name} would be too large.`);
  return image.resize({ width: w, height: h, quality: "best" }).toPNG();
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
  configTextEdits: Record<string, string> = {}
): { entries: WatchfaceConversionEntry[]; appliedRawConfigEditCount: number; generatedAod: boolean } {
  return convertEntries(input, carrier, target, configTextEdits, false);
}

/** Final composed recovery export, not a replacement for the editor baseline. */
export function prepareRecoveredWatchfaceExport(
  input: WatchfaceConversionEntry[],
  carrier: WatchfaceConversionEntry[],
  target: WatchfaceTarget
): WatchfaceConversionEntry[] {
  // Starters recovered before 2026-09-18 referenced `recovered/group-NN` with
  // forward slashes, which COROS compiles to blank elements on the watch. The
  // firmware convention is backslashes; rewrite saved projects on export.
  return convertEntries(input, carrier, target, {}, true).entries.map(entry => {
    if (!/\/(?:AOD)?config\.txt$/i.test(entry.name)) return entry;
    const text = entry.data.toString("utf8");
    const fixed = text.replace(/^(\s*\[[^\]]+\]\s*=\s*)(recovered\/[^\r\n]*)$/gm, (_, prefix: string, value: string) => `${prefix}${value.replace(/\//g, "\\")}`);
    return fixed === text ? entry : { ...entry, data: Buffer.from(fixed, "utf8") };
  });
}

function convertEntries(
  input: WatchfaceConversionEntry[],
  carrier: WatchfaceConversionEntry[],
  target: WatchfaceTarget,
  configTextEdits: Record<string, string>,
  recoveredExport: boolean
): { entries: WatchfaceConversionEntry[]; appliedRawConfigEditCount: number; generatedAod: boolean } {
  const source = new Map<string, Buffer>();
  for (const entry of input) {
    const name = normalizeConversionPath(entry.name);
    if (source.has(name)) throw new Error(`Duplicate source entry ${name}.`);
    source.set(name, entry.data);
  }
  if (recoveredExport && JSON.parse(source.get("info.json")?.toString("utf8") ?? "{}").coroslinkRecovery?.partial !== true) {
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
  const edits = Object.entries(configTextEdits).map(([name, text]) => [normalizeConversionPath(name), text] as const);
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
  const current = applyRawChanges(textAt(masterSize, "config.txt")!, "config.txt");
  const masterAssets = new Map<string, Buffer>();
  for (const [name, data] of source) {
    if (name.startsWith(`${dir(masterSize)}/`) && !CONFIG_FILE.test(name.slice(dir(masterSize).length + 1))) {
      masterAssets.set(name.slice(dir(masterSize).length + 1), data);
    }
  }
  // Some official AMOLED templates only supply AOD at the physical size.
  const aodSize = resolutions.find(size => textAt(size, "AODconfig.txt") || textAt(size, RETAINED_AOD_CONFIG));
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
      return prefix + (relative && isAsset ? `cl_aod_source/${relative}` : value);
    });
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
    // The catalog watchFaceId is not a DIY srcWatchFaceTemplateId. Use the
    // complete editable carrier manifest, including its DIY/app metadata.
    info = carrierInfo;
    const name = JSON.parse(sourceInfo).m_name;
    if (typeof name === "string") {
      info = /"m_name"\s*:/.test(info)
        ? info.replace(/"m_name"\s*:\s*"(?:\\.|[^"\\])*"/, () => `"m_name":${JSON.stringify(name)}`)
        : info.replace("{", () => `{"m_name":${JSON.stringify(name)},`);
    }
    if (!/"m_app"\s*:/.test(info)) info = info.replace("{", '{"m_app":"watchface_800x800",');
    if (!/"m_preview"\s*:/.test(info)) info = info.replace("{", '{"m_preview":"watchface_customize.png",');
    info = info.replace(/"m_preview"\s*:\s*"[^"]*"/, '"m_preview":"watchface_customize.png"');
    const carrierPreview = destination.get("watchface_customize.png");
    const dimensions = carrierPreview ? nativeImage.createFromBuffer(carrierPreview).getSize() : undefined;
    const image = nativeImage.createFromBuffer(preview);
    if (image.isEmpty() || !dimensions?.width || !dimensions.height) throw new Error("The export template is missing a readable preview.");
    preview = image.resize({ ...dimensions, quality: "best" }).toPNG();
  }
  info = info.replace(/"m_app"\s*:\s*"[^"]*"/, '"m_app":"watchface_800x800"');
  info = /"o_wf_ver"\s*:/.test(info) ? info.replace(/("o_wf_ver"\s*:)\s*\d+/, `$1${version}`) : info.replace("{", `{"o_wf_ver":${version},`);
  const entries: WatchfaceConversionEntry[] = [{ name: "info.json", data: Buffer.from(info) }, { name: "watchface_customize.png", data: preview }];
  for (const size of target.sizes) {
    for (const [relative, data] of masterAssets) {
      if (/\.DS_Store$|\.pb$|\.bin$/i.test(relative)) continue;
      if (recoveredExport && relative === "thmb.png") continue;
      entries.push({ name: `${dir(size)}/${relative}`, data: /\.png$/i.test(relative) ? resizePng(data, size / masterSize, relative) : data });
    }
    if (recoveredExport) {
      const thumbnail = destination.get(`${dir(size)}/thmb.png`);
      const image = nativeImage.createFromBuffer(preview);
      const dimensions = thumbnail ? nativeImage.createFromBuffer(thumbnail).getSize() : undefined;
      if (image.isEmpty() || !dimensions?.width || !dimensions.height) throw new Error("The export template is missing a readable thumbnail.");
      entries.push({ name: `${dir(size)}/thmb.png`, data: image.resize({ ...dimensions, quality: "best" }).toPNG() });
    }
    const carrierConfig = destination.get(`${dir(size)}/config.txt`);
    if (!carrierConfig) throw new Error(`The destination template lacks the ${size}px layout.`);
    const id = readConfig(carrierConfig.toString("utf8")).watchface_id;
    for (const [file, text] of [["config.txt", current], [target.display === "amoled" ? "AODconfig.txt" : RETAINED_AOD_CONFIG, aod]] as const) {
      // On MIP retain only the master AOD, avoiding unused device mode files.
      if (file === RETAINED_AOD_CONFIG && (size !== 800 || !aodSize)) continue;
      let scaled = scaleWatchfaceConfig(text, size / masterSize);
      if (id !== undefined) scaled = setConfigValue(scaled, "watchface_id", id);
      if (recoveredExport) scaled = setConfigValue(scaled, "watchface_thmb_icon", "thmb.png");
      entries.push({ name: `${dir(size)}/${file}`, data: Buffer.from(scaled) });
    }
  }
  return { entries, appliedRawConfigEditCount: edits.length, generatedAod: !aodSize && target.display === "amoled" };
}
