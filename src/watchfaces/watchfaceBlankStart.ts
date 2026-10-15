import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails,
  CorosWatchfaceTheme
} from "../../electron/types";
import { setWatchfaceAutomationVisibility } from "./watchfaceAutomationVisibility";
import {
  resolveWatchfaceModeDesign,
  writeWatchfaceModeDesign
} from "./watchfaceDisplayModes";
import { deriveEditorLayers, type EditorLayer } from "./watchfaceEditorModel";
import { watchfaceEditorLayerIsListed } from "./watchfaceEditorVisibility";
import { isSelectableSlotConfigAssetKey } from "./watchfaceSpritePreview";
import {
  applyConfigTextEditsToDetails,
  detailsForCompositionMode,
  hasWatchfaceAod,
  inferStaticSeparators,
  layoutGroupKeys,
  loadStudioImage,
  parseConfigPos,
  pickPreviewResolution,
  WATCHFACE_LAYOUT_GROUPS,
  type WatchfaceAssetLoader,
  type WatchfacePreviewMode
} from "./watchfaceStudio";

/**
 * Template images that never draw on their own: the archive thumbnail, and
 * the minus sign the watch adds only to negative values. A blank face keeps
 * them so a value added later still shows its sign.
 */
const KEPT_CONFIG_ASSET_IDS = new Set([
  "config:watchface_thmb_icon",
  "config:negative_sign_icon"
]);

/** Analog hands, which Add can put on any face, need the shared center. */
const UNMODELED_GROUPS_KEPT = new Set(["analogCenter"]);

/**
 * Whether Start blank removes this layer: the editor's Delete rule, firmware
 * layers only and never artwork, less the images that never draw.
 */
export function isBlankRemovableLayer(layer: EditorLayer): boolean {
  if (
    !layer.canHide ||
    layer.kind === "background" ||
    layer.kind === "customSprite" ||
    layer.kind === "backgroundElement"
  ) {
    return false;
  }
  if (!layer.configAssetId) return true;
  // Selectable-slot icons belong to the Selectable metric layer, which is
  // removed as a whole.
  return (
    !KEPT_CONFIG_ASSET_IDS.has(layer.configAssetId) &&
    !isSelectableSlotConfigAssetKey(layer.configAssetId.replace(/^config:/, ""))
  );
}

function blankModeDesign(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode
): CorosWatchfaceDesignState {
  const modeDetails = detailsForCompositionMode(
    applyConfigTextEditsToDetails(details, design.configTextEdits),
    mode
  );
  const removableLayers = (current: CorosWatchfaceDesignState) =>
    deriveEditorLayers(modeDetails, current).filter(
      (layer) =>
        watchfaceEditorLayerIsListed(layer, mode, current) &&
        isBlankRemovableLayer(layer)
    );
  let next = design;
  const removedIds = new Set<string>();
  // Hiding one layer can turn another into a new one: with the calorie arc
  // gone, the arc-cut mask becomes the "Time & date separators" layer. Repeat
  // until a pass finds nothing left on, so a renamed layer is hidden too.
  for (let pass = 0; pass < 4; pass += 1) {
    const removable = removableLayers(next);
    for (const layer of removable) removedIds.add(layer.id);
    const shown = removable.filter((layer) => layer.visible && !layer.nativeDataId);
    if (shown.length === 0) break;
    for (const layer of shown) {
      try {
        next = setWatchfaceAutomationVisibility(next, details, mode, layer.id, false);
      } catch {
        // A layer this mode cannot hide stays as the template drew it.
      }
    }
  }
  // The editor models the master (800) tree. A smaller watch tree can lay out
  // more (a digit used as a decoration, or an AOD only the 390 tree fills),
  // which no present layer represents; hide those groups too so the watch
  // shows the same empty face. Fixed metrics hide through metricChanges.
  const modeledGroups = new Set(
    deriveEditorLayers(modeDetails, next).flatMap((layer) =>
      layer.layoutGroupId && (layer.present || layer.metricId) ? [layer.layoutGroupId] : []
    )
  );
  const unmodeled = WATCHFACE_LAYOUT_GROUPS.filter((group) =>
    !UNMODELED_GROUPS_KEPT.has(group.id) &&
    !modeledGroups.has(group.id) &&
    modeDetails.resolutions.some((resolution) => layoutGroupKeys(resolution, group).length > 0)
  );
  if (unmodeled.length > 0) {
    next = {
      ...next,
      layerVisibility: {
        ...next.layerVisibility,
        ...Object.fromEntries(unmodeled.map((group) => [group.id, false]))
      }
    };
  }
  return {
    ...next,
    // Native fields stay as switched-off entries: export clears the keys of
    // every entry it has, but leaves a field the template's own config draws
    // (recovered and converted faces) on the watch when its entry is gone.
    nativeData: Object.fromEntries(
      Object.entries(next.nativeData ?? {}).map(([id, style]) => [id, { ...style, enabled: false }])
    ),
    removedLayerIds: [...new Set([...(next.removedLayerIds ?? []), ...removedIds])],
    editorGroups: [],
    linkedLayerGroups: [],
    artwork: null,
    artworkVisible: true,
    zoom: 1,
    backgroundColor: "#000000"
  };
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function hexLuminance(color: string | undefined): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return relativeLuminance(value >> 16, (value >> 8) & 0xff, value & 0xff);
}

/**
 * A tint for the template's time digits when they would be lost on this
 * mode's background, as dark digits are on a blank face's black: some
 * templates draw black digits and rely on their artwork for contrast.
 * Undefined when the digits read well, or cannot be measured.
 */
export async function templateTimeTint(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode,
  loadAssets: WatchfaceAssetLoader
): Promise<string | undefined> {
  const background = design.backgroundColor === "transparent"
    ? 0
    : hexLuminance(design.backgroundColor ?? "#000000");
  if (background === null) return undefined;
  const resolution = pickPreviewResolution(detailsForCompositionMode(
    applyConfigTextEditsToDetails(details, design.configTextEdits),
    mode
  ));
  const fontFolder = (resolution?.config.time_hour_high_font || resolution?.config.autoalign_time_font)
    ?.trim()
    .replace(/\\/g, "/");
  const files = resolution?.spriteFolders.find((folder) => folder.folder === fontFolder)?.files ?? [];
  const sample = files[8] ?? files[0];
  if (!sample) return undefined;
  const [asset] = await loadAssets([sample.path]);
  if (!asset) return undefined;
  const image = await loadStudioImage(asset.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3]! < 128) continue;
    total += relativeLuminance(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!);
    count += 1;
  }
  if (count === 0) return undefined;
  const digits = total / count;
  // WCAG contrast ratio; under 3:1 large digits stop reading clearly.
  const contrast = (Math.max(digits, background) + 0.05) / (Math.min(digits, background) + 0.05);
  if (contrast >= 3) return undefined;
  const preferred = hexLuminance(design.digitColor);
  const preferredContrast = preferred === null
    ? 0
    : (Math.max(preferred, background) + 0.05) / (Math.min(preferred, background) + 0.05);
  return preferredContrast >= 3
    ? design.digitColor
    : background < 0.18 ? "#ffffff" : "#000000";
}

/** Hours over minutes, as on stacked faces, where no colon belongs. */
function timeIsStacked(config: Record<string, string> | undefined): boolean {
  const hour = parseConfigPos(config?.time_hour_low_pos);
  const minute = parseConfigPos(config?.time_minute_high_pos);
  if (!hour || !minute) return false;
  return minute.x <= hour.x || Math.abs(minute.y - hour.y) >= minute.x - hour.x;
}

/**
 * Turns a blank face's template time back on in one display mode: the hour
 * and minute digits (or auto-aligned time) and, for digits side by side, a
 * colon between them. The colon is the template's own image when it ships
 * one; otherwise the Studio colon, since many templates bake theirs into the
 * background a blank face drops. `tint` colors digits the template draws in
 * a color the background hides (see templateTimeTint). Seconds stay a
 * separate Add-menu choice. With `removedOnly`, parts merely hidden with the
 * eye toggle stay hidden.
 */
export function restoreWatchfaceTemplateTime(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode,
  { removedOnly = false, tint }: { removedOnly?: boolean; tint?: string } = {}
): CorosWatchfaceDesignState {
  const removedIds = new Set(design.removedLayerIds ?? []);
  const modeDetails = detailsForCompositionMode(
    applyConfigTextEditsToDetails(details, design.configTextEdits),
    mode
  );
  const config = pickPreviewResolution(modeDetails)?.config;
  const stacked = timeIsStacked(config);
  const colonShipped = /\.png$/i.test(config?.colon_icon?.trim() ?? "");
  const timeLayers = deriveEditorLayers(modeDetails, design).filter(
    (layer) =>
      !layer.visible &&
      (!removedOnly || removedIds.has(layer.id)) &&
      watchfaceEditorLayerIsListed(layer, mode, design) &&
      ((layer.timePartId !== undefined && layer.timePartId !== "seconds") ||
        // The watch places the template colon between hour and minute
        // digits by itself, which lands on a digit when they are stacked.
        (colonShipped && !stacked && layer.configAssetId === "config:colon_icon"))
  );
  let next = design;
  for (const layer of timeLayers) {
    try {
      next = setWatchfaceAutomationVisibility(next, details, mode, layer.id, true);
    } catch {
      // A locked part stays off.
    }
  }
  const restored = new Set(timeLayers.map((layer) => layer.id));
  // A clock only a watch-size tree lays out (no present master layer) was
  // hidden by group in blankModeDesign; show it again with the rest.
  const presentGroups = new Set(
    deriveEditorLayers(modeDetails, next).flatMap((layer) => layer.layoutGroupId && layer.present ? [layer.layoutGroupId] : [])
  );
  const clockGroups = ["autoTime", "hours", "minutes"].filter((id) =>
    next.layerVisibility?.[id] === false && !presentGroups.has(id)
  );
  if (clockGroups.length > 0) {
    next = {
      ...next,
      layerVisibility: Object.fromEntries(
        Object.entries(next.layerVisibility ?? {}).filter(([id]) => !clockGroups.includes(id))
      )
    };
  }
  if (tint) {
    const timeStyles = { ...next.timeStyles };
    for (const layer of timeLayers) {
      if (!layer.timePartId || timeStyles[layer.timePartId]?.color) continue;
      timeStyles[layer.timePartId] = { ...(timeStyles[layer.timePartId] ?? { scale: 1 }), color: tint };
    }
    next = { ...next, timeStyles };
  }
  if (
    !colonShipped &&
    restored.has("hours") &&
    !stacked &&
    !next.staticSeparators.colon.enabled &&
    !(next.lockedLayerIds ?? []).includes("staticColon")
  ) {
    const color = next.timeStyles?.hours?.color ?? next.digitColor;
    const { colon } = inferStaticSeparators(modeDetails, color);
    next = {
      ...next,
      staticSeparators: {
        ...next.staticSeparators,
        colon: { ...next.staticSeparators.colon, ...colon, enabled: true }
      }
    };
    restored.add("staticColon");
  }
  return {
    ...next,
    removedLayerIds: (next.removedLayerIds ?? []).filter((id) => !restored.has(id))
  };
}

/**
 * Empties a freshly opened template for a face started from scratch. Every
 * template layer is removed the way the editor's Delete removes it, so each
 * one can be added back from the Add menu. The template picture is replaced
 * by plain black, in Current and, when the template has one, Always-on.
 */
export function blankWatchfaceDesign(
  design: CorosWatchfaceDesignState,
  details: CorosWatchfaceTemplateDetails
): CorosWatchfaceDesignState {
  let root = writeWatchfaceModeDesign(
    design,
    "current",
    blankModeDesign(resolveWatchfaceModeDesign(design, "current"), details, "current")
  );
  if (hasWatchfaceAod(details) && root.modeDesigns?.aod) {
    root = writeWatchfaceModeDesign(
      root,
      "aod",
      blankModeDesign(resolveWatchfaceModeDesign(root, "aod"), details, "aod")
    );
    root = {
      ...root,
      modeDesigns: {
        ...root.modeDesigns,
        // Export keeps the template's AOD background unless this is set.
        aod: { ...root.modeDesigns!.aod, backgroundEdited: true }
      }
    };
  }
  return root;
}

/** COROS marks digital editable templates 1 and analog (hands) ones 2. */
const DIGITAL_TEMPLATE_TYPE = 1;

/**
 * The editable template a face started from scratch is built on: the
 * catalog's first digital one, so Add the time brings back digits rather
 * than hands, else the first that can be downloaded at all.
 */
export function pickScratchBaseTheme(
  themes: readonly CorosWatchfaceTheme[]
): CorosWatchfaceTheme | undefined {
  const downloadable = themes.filter((theme) => theme.packageUrl);
  return (
    downloadable.find((theme) => theme.templateType === DIGITAL_TEMPLATE_TYPE) ??
    downloadable[0]
  );
}
