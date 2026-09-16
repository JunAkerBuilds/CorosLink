import type { CorosWatchfaceResolutionDetails, CorosWatchfaceTemplateDetails } from "../../electron/types";
import { drawStudioPreview, parseConfigPos, type WatchfaceAssetLoader, type WatchfaceComplicationId, type WatchfacePreviewMode } from "./watchfaceStudio";

export interface CompiledWatchfacePreview {
  dataUrl: string;
  checks: string[];
  width: number;
  height: number;
}

/** Check alpha coverage rather than intersecting PNG boxes: transparent
 * bearings can overlap safely, while two painted pixels cannot. */
export function createCompiledPixelChecks(width: number, height: number) {
  const owners = new Int32Array(width * height);
  const labels: string[] = [""];
  const checks = new Set<string>();
  return {
    checks,
    sprite(label: string, image: CanvasImageSource, x: number, y: number, w: number, h: number, clip?: { x0: number; y0: number; x1: number; y1: number }) {
      const source = document.createElement("canvas");
      source.width = Math.max(1, Math.round(w)); source.height = Math.max(1, Math.round(h));
      const context = source.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, source.width, source.height);
      const pixels = context.getImageData(0, 0, source.width, source.height).data;
      const owner = labels.push(label) - 1;
      for (let sy = 0; sy < source.height; sy++) for (let sx = 0; sx < source.width; sx++) {
        if (pixels[(sy * source.width + sx) * 4 + 3]! < 8) continue;
        const px = Math.round(x) + sx, py = Math.round(y) + sy;
        if (clip && (px < clip.x0 || py < clip.y0 || px >= clip.x1 || py >= clip.y1)) continue;
        if (px < 0 || py < 0 || px >= width || py >= height ||
            ((px + 0.5 - width / 2) / (width / 2)) ** 2 + ((py + 0.5 - height / 2) / (height / 2)) ** 2 > 1) {
          checks.add(`${label}: visible pixels cross the display edge.`);
          continue;
        }
        const index = py * width + px;
        const previous = owners[index]!;
        if (previous) checks.add(`${[labels[previous]!, label].sort().join(" / ")}: visible pixels overlap.`);
        owners[index] = owner;
      }
    },
    rect(label: string, w: number, h: number, rect: { x0: number; y0: number; x1: number; y1: number }) {
      if (w > rect.x1 - rect.x0 || h > rect.y1 - rect.y0) {
        checks.add(`${label}: glyph cells exceed the exported value rectangle; pixels may be clipped.`);
      }
    }
  };
}

/** The caller supplies details and assets read back from the generated ZIP.
 * No editor design, font family, scaling, strokes or effects are reapplied. */
export async function renderCompiledWatchfacePreview(
  details: CorosWatchfaceTemplateDetails,
  resolution: CorosWatchfaceResolutionDetails,
  mode: WatchfacePreviewMode,
  loadAssets: WatchfaceAssetLoader,
  scenario: { date?: Date; complication?: WatchfaceComplicationId; values?: Record<string, string> } = {}
): Promise<CompiledWatchfacePreview> {
  const usesAod = mode === "aod" && Object.keys(resolution.aodConfig ?? {}).length > 0;
  const config = usesAod
    ? resolution.aodConfig! : resolution.config;
  const canvas = document.createElement("canvas");
  canvas.width = resolution.width; canvas.height = resolution.height;
  const backgroundPath = `${resolution.directory}/${(config.background_icon || "background.png").replace(/\\/g, "/")}`;
  const [background] = usesAod ? [] : await loadAssets([backgroundPath]);
  if (!usesAod && !background) throw new Error(`The compiled archive is missing ${backgroundPath}.`);
  // Older archive descriptions omit directly referenced numbered PNGs such as
  // studio/sunset/00.png. Resolve the active config's exact paths, including
  // those in font folders, without guessing icons from folder names.
  const icons = new Map(resolution.icons.map((file) => [file.path, file]));
  const spriteFiles = new Map(resolution.spriteFolders.flatMap((folder) => folder.files).map((file) => [file.path, file]));
  const referencedPaths = [...new Set(Object.values(config)
    .filter((value) => /\.png$/i.test(value))
    .map((value) => `${resolution.directory}/${value.replace(/\\/g, "/")}`))]
    .filter((path) => !usesAod || path !== backgroundPath);
  if (background) icons.set(background.path, background);
  for (const path of referencedPaths) {
    const file = spriteFiles.get(path);
    if (!icons.has(path) && file) icons.set(path, file);
  }
  const missing = referencedPaths.filter((path) => !icons.has(path));
  if (missing.length) {
    for (const { path, width, height } of await loadAssets(missing)) {
      icons.set(path, { path, width, height });
    }
  }
  const checks = createCompiledPixelChecks(canvas.width, canvas.height);
  const ampmPos = parseConfigPos(config.am_pm_icon_pos);
  await drawStudioPreview(canvas, background?.dataUrl ?? "", {
    ...details, resolutions: [{ ...resolution, config, icons: [...icons.values()] }]
  }, {
    fontFamily: "", digitColor: "#ffffff", accentColor: "#ffffff",
    tintLabels: false, tintIcons: false, previewMode: usesAod ? "aod" : "current",
    ...(ampmPos && config.am_icon && config.pm_icon ? { ampmStyle: { enabled: true, ...ampmPos, scale: 1 } } : {}),
    compiledPixels: true, previewDate: scenario.date ?? new Date(2026, 8, 13, 10, 8, 36),
    previewComplication: scenario.complication, previewValues: scenario.values,
    onCompiledSprite: checks.sprite, onCompiledRect: checks.rect
  }, loadAssets);
  const context = canvas.getContext("2d")!;
  context.globalCompositeOperation = "destination-in";
  context.beginPath(); context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2); context.fill();
  return { dataUrl: canvas.toDataURL("image/png"), checks: [...checks.checks], width: canvas.width, height: canvas.height };
}
