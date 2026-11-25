// The bitmap sets inside an official (compiled) COROS face, for building the asset library on this computer when the
// hosted one can't be reached (desktop/main/watchface/officialAssets.ts). Rewritten from CorosLink's
// electron/corosOfficialAssetLibrary.ts. Main process only: no files, no network.
import { createHash } from "node:crypto";
import { decodeCorosBitmapFrame, decodeCorosLayout, findCorosBitmapBlocks, parseCorosFaceMagic, readLayoutHeaders } from "./corosBinLayout";

export interface OfficialFaceSet {
  /** The content hash: the same pixels in any face or resolution are one set. */
  id: string;
  width: number;
  height: number;
  encoding: string;
  elementIds: string[];
  configKeys: string[];
  /** Straight-alpha RGBA, one buffer a frame. */
  frames: Buffer[];
}

/** Every bitmap set of a compiled face, with the layout elements that use it (current and always-on). */
export function officialFaceSets(bin: Buffer): { screen: number; sets: OfficialFaceSet[]; failures: string[] } {
  const magic = bin.toString("latin1", 0, 4);
  const size = parseCorosFaceMagic(magic);
  if (!size) throw new Error(`Unsupported watch-face magic ${JSON.stringify(magic)}.`);
  const headers = readLayoutHeaders(bin);
  const blocks = findCorosBitmapBlocks(bin, Math.max(...headers.map((h) => h.offset + h.length)));
  let layout: ReturnType<typeof decodeCorosLayout> | null = null;
  try { layout = decodeCorosLayout(bin, blocks); } catch { /* the bitmaps alone still make sets, in "other" */ }

  const used = new Map<number, { ids: Set<string>; keys: Set<string> }>();
  for (const mode of layout?.modes ?? []) {
    for (const element of mode.elements) {
      for (const group of [element.asset?.group, ...(element.assets ?? []).map((ref) => ref?.group)]) {
        if (group == null) continue;
        const entry = used.get(group) ?? { ids: new Set<string>(), keys: new Set<string>() };
        entry.ids.add(element.id);
        if (element.config?.asset) entry.keys.add(element.config.asset);
        used.set(group, entry);
      }
    }
  }

  const sets: OfficialFaceSet[] = [], failures: string[] = [];
  for (const block of blocks) {
    let frames: Buffer[];
    try { frames = Array.from({ length: block.frameCount }, (_, frame) => decodeCorosBitmapFrame(bin, block, frame)); } catch (e) {
      failures.push(`group ${block.index}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const by = used.get(block.index);
    sets.push({
      id: createHash("sha256").update(`${block.width}x${block.height}`).update(Buffer.concat(frames)).digest("hex").slice(0, 16),
      width: block.width, height: block.height, encoding: `0x${block.encoding.toString(16)}`,
      elementIds: [...(by?.ids ?? [])].sort(), configKeys: [...(by?.keys ?? [])].sort(), frames,
    });
  }
  return { screen: size.size, sets, failures };
}

/** The frames side by side with a 2 px gap, wrapping so the strip stays about square (the library's preview). */
export function officialStrip(width: number, height: number, frames: readonly Buffer[]): { rgba: Buffer; width: number; height: number } {
  const gap = 2;
  const perRow = frames.length <= 1 ? 1
    : Math.max(1, Math.min(frames.length, Math.ceil(Math.sqrt((frames.length * height) / Math.max(width, 1))), Math.floor(2048 / (width + gap))));
  const rows = Math.ceil(frames.length / perRow);
  const stripWidth = perRow * width + (perRow - 1) * gap, stripHeight = rows * height + (rows - 1) * gap;
  const rgba = Buffer.alloc(stripWidth * stripHeight * 4);
  frames.forEach((frame, index) => {
    const ox = (index % perRow) * (width + gap), oy = Math.floor(index / perRow) * (height + gap);
    for (let y = 0; y < height; y++) frame.copy(rgba, ((oy + y) * stripWidth + ox) * 4, y * width * 4, (y + 1) * width * 4);
  });
  return { rgba, width: stripWidth, height: stripHeight };
}
