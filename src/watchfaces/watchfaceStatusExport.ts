import type {
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  applyConfigOverridesToDetails,
  loadStudioImage,
  mergeConfigOverrides,
  parseConfigPos,
  type WatchfaceAssetLoader
} from "./watchfaceStudio.ts";

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

const STATUS_GROUPS = [
  { position: "bluetooth_icon_pos", mode: "airplane_icon", companion: "bluetooth_off_icon",
    own: ["bluetooth_icon", "bluetooth_on_icon", "bluetooth_off_icon"] },
  { position: "no_disturb_icon_pos", mode: "sleep_mode_icon", companion: "no_disturb_off_icon",
    own: ["no_disturb_icon", "no_disturb_on_icon", "no_disturb_off_icon"] }
] as const;

/**
 * Finalize status images after visibility, movement and effects. COROS writes
 * each shared position only with a Bluetooth/DND image, even when the airplane
 * or sleep image is present. Check the effective config in every resolution;
 * hidden template icons cannot supply that position.
 *
 * COROS also drops the minus sign from position values. Clip offscreen pixels
 * from every state sharing a negative position, then use a nonnegative origin.
 * The visible artwork stays put, including older drafts that shrank a large
 * image inside its original canvas and dragged that canvas offscreen.
 */
export async function finalizeWatchfaceStatusIcons(
  details: CorosWatchfaceTemplateDetails,
  assetReplacements: CorosWatchfaceAssetReplacement[],
  configOverrides: CorosWatchfaceConfigOverride[],
  loadAssets: WatchfaceAssetLoader
): Promise<{
  assetReplacements: CorosWatchfaceAssetReplacement[];
  configOverrides: CorosWatchfaceConfigOverride[];
}> {
  const effective = applyConfigOverridesToDetails(details, configOverrides);
  const assets = new Map(assetReplacements.map(asset => [asset.path, asset]));
  const addedOverrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of effective.resolutions) {
    for (const scope of ["config", "aod"] as const) {
      const config = { ...(scope === "aod" ? resolution.aodConfig : resolution.config) };
      const values: Record<string, string> = {};
      for (const group of STATUS_GROUPS) {
        const position = parseConfigPos(config[group.position]);
        if (!position) continue;
        if (config[group.mode]?.trim() && !group.own.some(key => config[key]?.trim())) {
          const relativePath = `studio/status_${scope}_${group.companion}/00.png`;
          values[group.companion] = config[group.companion] = relativePath.replaceAll("/", "\\");
          assets.set(`${resolution.directory}/${relativePath}`, {
            path: `${resolution.directory}/${relativePath}`, dataUrl: TRANSPARENT_PIXEL, create: true
          });
        }
        if (position.x >= 0 && position.y >= 0) continue;
        const keys = [...group.own, group.mode].filter(key => config[key]?.trim());
        if (!keys.length) continue;
        const x = Math.max(0, position.x), y = Math.max(0, position.y);
        for (const key of keys) {
          const sourcePath = `${resolution.directory}/${config[key]!.replaceAll("\\", "/").replace(/^\.\//, "")}`;
          const asset = assets.get(sourcePath) ?? (await loadAssets([sourcePath]))[0];
          if (!asset) throw new Error(`Could not load the status image ${sourcePath}.`);
          const image = await loadStudioImage(asset.dataUrl);
          const left = x - position.x, top = y - position.y;
          const width = Math.max(0, Math.min(image.naturalWidth - left, resolution.width - x));
          const height = Math.max(0, Math.min(image.naturalHeight - top, resolution.height - y));
          const canvas = document.createElement("canvas");
          canvas.width = width && height ? width : 1;
          canvas.height = width && height ? height : 1;
          if (width && height) {
            const context = canvas.getContext("2d", { colorSpace: "display-p3" });
            if (!context) throw new Error("Could not prepare the status image for export.");
            context.drawImage(image, left, top, width, height, 0, 0, width, height);
          }
          // Isolate the clipped state; the original PNG may also serve another
          // position, a control, or the always-on face.
          const relativePath = `studio/status_${scope}_${key}/00.png`;
          const path = `${resolution.directory}/${relativePath}`;
          assets.set(path, { path, dataUrl: canvas.toDataURL("image/png"), create: true });
          values[key] = relativePath.replaceAll("/", "\\");
        }
        values[group.position] = `{${x},${y}}`;
      }
      if (Object.keys(values).length) {
        addedOverrides.push({ path: `${resolution.directory}/${scope === "aod" ? "AODconfig" : "config"}.txt`, values });
      }
    }
  }
  return { assetReplacements: [...assets.values()], configOverrides: mergeConfigOverrides(configOverrides, addedOverrides) };
}
