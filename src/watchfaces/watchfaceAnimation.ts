import type {
  CorosWatchfaceAnimation,
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { COROS_CONFIG_DELETE_VALUE, loadStudioImage, parseConfigPos, pickPreviewResolution } from "./watchfaceStudio";

/**
 * Native sprite animation (compiled header 0x312). PACE 4 (W336) and PACE Pro
 * (W332) firmware draw the frames over the background and advance on their own
 * timer, delay[i] ms per frame. COROS's DIY compiler has no key for it, so the
 * archive carries Studio-owned keys that CorosLink's compiler writes back.
 */
export const ANIMATION_POS_KEY = "cl_animation_pos";
export const ANIMATION_DIR_KEY = "cl_animation_dir";
export const ANIMATION_DELAYS_KEY = "cl_animation_delays_ms";
export const ANIMATION_CONFIG_KEYS = [ANIMATION_POS_KEY, ANIMATION_DIR_KEY, ANIMATION_DELAYS_KEY] as const;
/**
 * Studio's own frame folder, named by frame count: a `cl_` namespace, so a folder
 * left behind by an earlier export with more frames is unreferenced and pruned
 * instead of feeding the compiler stale frames.
 */
export function animationFolder(frameCount: number): string {
  return `cl_animation_${String(frameCount).padStart(2, "0")}`;
}
/** The firmware record times at most this many frames ((0x94 − 0x3c) / 2). */
export const MAX_ANIMATION_FRAMES = 44;
export const MIN_ANIMATION_DELAY = 1;
export const MAX_ANIMATION_DELAY = 65535;
export const DEFAULT_ANIMATION_DELAY = 100;

export function clampAnimationDelay(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_ANIMATION_DELAY, Math.max(MIN_ANIMATION_DELAY, Math.round(value))) : DEFAULT_ANIMATION_DELAY;
}

/** One delay per frame: a short list repeats its last value, a long one is cut. */
export function normalizeAnimationDelays(delays: readonly number[] | undefined, frameCount: number): number[] {
  const list = (delays ?? []).map(clampAnimationDelay);
  const fallback = list.at(-1) ?? DEFAULT_ANIMATION_DELAY;
  return Array.from({ length: frameCount }, (_, i) => list[i] ?? fallback);
}

/** Parse `100,100,70`; null when the value is not a list of whole milliseconds. */
export function parseAnimationDelays(value: string | undefined): number[] | null {
  const parts = (value ?? "").split(/[\s,]+/).filter(Boolean);
  if (!parts.length || parts.some(part => !/^\d+$/.test(part))) return null;
  return parts.map(Number);
}

/** Why an animation cannot be exported, or null. Mirrors the compiler's checks. */
export function animationProblem(animation: CorosWatchfaceAnimation | undefined, frameSizes?: { width: number; height: number }[]): string | null {
  // Disabled animations are dropped from the export, so they never block it.
  if (!animation?.enabled) return null;
  if (!animation.frames.length) return "The animation has no frames.";
  if (animation.frames.length > MAX_ANIMATION_FRAMES) return `The animation has ${animation.frames.length} frames; the watch times at most ${MAX_ANIMATION_FRAMES}.`;
  if (animation.delays.length !== animation.frames.length) return "Give the animation one delay per frame.";
  if (animation.delays.some(delay => !Number.isInteger(delay) || delay < MIN_ANIMATION_DELAY || delay > MAX_ANIMATION_DELAY)) {
    return `Animation delays must be whole milliseconds between ${MIN_ANIMATION_DELAY} and ${MAX_ANIMATION_DELAY}.`;
  }
  if (frameSizes?.length) {
    const [first] = frameSizes;
    if (frameSizes.some(size => size.width !== first!.width || size.height !== first!.height)) {
      return `Every animation frame must be ${first!.width} × ${first!.height}, like the first one.`;
    }
  }
  return null;
}

/** Index of the frame showing `elapsed` ms into a looping sequence (no drift from late ticks). */
export function animationFrameAt(delays: readonly number[], elapsed: number): number {
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  if (!delays.length || total <= 0) return 0;
  let remaining = ((elapsed % total) + total) % total;
  for (let i = 0; i < delays.length; i++) {
    if (remaining < delays[i]!) return i;
    remaining -= delays[i]!;
  }
  return delays.length - 1;
}

/** Milliseconds from `elapsed` until the next frame starts (for a timer, not a 60 Hz loop). */
export function animationNextChange(delays: readonly number[], elapsed: number): number {
  const total = delays.reduce((sum, delay) => sum + delay, 0);
  if (!delays.length || total <= 0) return Infinity;
  let position = ((elapsed % total) + total) % total;
  for (const delay of delays) {
    if (position < delay) return Math.max(1, delay - position);
    position -= delay;
  }
  return 1;
}

/** Template frame files named by `cl_animation_dir`, in the compiler's bytewise order. */
export function templateAnimationFiles(details: CorosWatchfaceTemplateDetails): CorosWatchfaceSpriteFile[] {
  const resolution = pickPreviewResolution(details);
  const relative = resolution?.config[ANIMATION_DIR_KEY]?.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!resolution || !relative) return [];
  const prefix = `${resolution.directory}/${relative}/`;
  const files = [...resolution.icons, ...resolution.spriteFolders.flatMap(folder => folder.files)]
    .filter(file => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/") && /\.png$/i.test(file.path));
  const unique = new Map(files.map(file => [file.path, file]));
  return [...unique.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The template's own animation (a recovered official face), as editable design state. */
export async function readTemplateAnimation(
  details: CorosWatchfaceTemplateDetails,
  loadAssets: (paths: string[]) => Promise<CorosWatchfaceTemplateAsset[]>
): Promise<CorosWatchfaceAnimation | undefined> {
  const resolution = pickPreviewResolution(details);
  const files = templateAnimationFiles(details);
  if (!resolution || !files.length) return undefined;
  const loaded = new Map((await loadAssets(files.map(file => file.path))).map(asset => [asset.path, asset.dataUrl]));
  const frames = files.map(file => loaded.get(file.path)).filter((url): url is string => Boolean(url));
  if (frames.length !== files.length) return undefined;
  const position = parseConfigPos(resolution.config[ANIMATION_POS_KEY]) ?? { x: 0, y: 0 };
  return {
    enabled: true,
    x: position.x,
    y: position.y,
    width: files[0]!.width,
    height: files[0]!.height,
    frames,
    delays: normalizeAnimationDelays(parseAnimationDelays(resolution.config[ANIMATION_DELAYS_KEY]) ?? undefined, frames.length)
  };
}

/** Current config gets the record; AOD loses it (firmware never animates always-on). */
export function buildAnimationOverrides(
  details: CorosWatchfaceTemplateDetails,
  animation: CorosWatchfaceAnimation | undefined
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base || !animation) return [];
  const remove = Object.fromEntries(ANIMATION_CONFIG_KEYS.map(key => [key, COROS_CONFIG_DELETE_VALUE]));
  const active = animation.enabled && animation.frames.length > 0;
  return details.resolutions.flatMap(resolution => {
    const scale = resolution.width / base.width;
    const values = active ? {
      [ANIMATION_POS_KEY]: `{${Math.round(animation.x * scale)},${Math.round(animation.y * scale)}}`,
      [ANIMATION_DIR_KEY]: animationFolder(animation.frames.length),
      [ANIMATION_DELAYS_KEY]: normalizeAnimationDelays(animation.delays, animation.frames.length).join(",")
    } : remove;
    const overrides: CorosWatchfaceConfigOverride[] = [{ path: `${resolution.directory}/config.txt`, values }];
    if (Object.keys(resolution.aodConfig).length > 0) overrides.push({ path: `${resolution.directory}/AODconfig.txt`, values: remove });
    return overrides;
  });
}

async function scaledFrame(url: string, scale: number): Promise<string> {
  if (scale === 1) return url;
  const image = await loadStudioImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot scale an animation frame.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/**
 * Ordered frames for every resolution, all scaled from the preview-resolution
 * frames by one factor so they keep a common size. Zero-padded names keep the
 * compiler's bytewise folder order equal to the editor's order.
 */
export async function buildAnimationSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  animation: CorosWatchfaceAnimation | undefined
): Promise<CorosWatchfaceAssetReplacement[]> {
  const base = pickPreviewResolution(details);
  if (!base || !animation?.enabled || !animation.frames.length) return [];
  const problem = animationProblem(animation);
  if (problem) throw new Error(problem);
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  // Studio-owned paths are upserts in the archive writer, so frames are always created.
  for (const resolution of details.resolutions) {
    const scale = resolution.width / base.width;
    for (const [index, url] of animation.frames.entries()) {
      const path = `${resolution.directory}/${animationFolder(animation.frames.length)}/${String(index).padStart(2, "0")}.png`;
      replacements.push({ path, dataUrl: await scaledFrame(url, scale), allowDimensionOverride: true, create: true });
    }
  }
  return replacements;
}

/** Draws one frame at its watch position, scaled from the preview resolution to the canvas. */
export async function drawAnimationFrame(
  canvas: HTMLCanvasElement,
  animation: CorosWatchfaceAnimation | undefined,
  previewWidth: number,
  frame = 0
): Promise<void> {
  if (!animation?.enabled || !animation.frames.length) return;
  const url = animation.frames[Math.min(frame, animation.frames.length - 1)]!;
  const image = await loadStudioImage(url);
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) return;
  const scale = canvas.width / previewWidth;
  context.drawImage(image, animation.x * scale, animation.y * scale, image.naturalWidth * scale, image.naturalHeight * scale);
}

/**
 * Frames from a chosen folder, ordered by file name the way the compiler
 * stacks them, rescaled by one factor (watch pixels → preview pixels) so they
 * keep a common size. Rejects mixed sizes and more than the record can time.
 */
export async function importAnimationFrames(
  sprites: { name: string; relativePath: string; dataUrl: string }[],
  toPreviewScale: number
): Promise<{ frames: string[]; width: number; height: number }> {
  const pngs = sprites
    .filter(sprite => !sprite.relativePath.replace(/\\/g, "/").includes("/") && /\.png$/i.test(sprite.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!pngs.length) throw new Error("Select a folder of PNG frames, such as 00.png, 01.png, …");
  if (pngs.length > MAX_ANIMATION_FRAMES) throw new Error(`The folder has ${pngs.length} frames; the watch times at most ${MAX_ANIMATION_FRAMES}.`);
  const images = await Promise.all(pngs.map(sprite => loadStudioImage(sprite.dataUrl)));
  const { naturalWidth: width, naturalHeight: height } = images[0]!;
  const odd = images.findIndex(image => image.naturalWidth !== width || image.naturalHeight !== height);
  if (odd >= 0) throw new Error(`${pngs[odd]!.name} is ${images[odd]!.naturalWidth} × ${images[odd]!.naturalHeight}; every frame must be ${width} × ${height}.`);
  const frames = await Promise.all(pngs.map(sprite => scaledFrame(sprite.dataUrl, toPreviewScale)));
  return { frames, width: Math.max(1, Math.round(width * toPreviewScale)), height: Math.max(1, Math.round(height * toPreviewScale)) };
}
