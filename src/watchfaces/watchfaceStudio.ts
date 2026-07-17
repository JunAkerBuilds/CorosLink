import type {
  CorosWatchfaceArtwork,
  CorosWatchfaceAssetReplacement,
  CorosWatchfaceConfigAssetOverride,
  CorosWatchfaceConfigOverride,
  CorosWatchfaceEffectBinding,
  CorosWatchfaceEffectStyle,
  CorosWatchfaceRasterFont,
  CorosWatchfaceResolutionDetails,
  CorosWatchfaceSpriteFolder,
  CorosWatchfaceSpriteFile,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  renderWatchfaceCanvasEffects,
  resolveWatchfaceLayerEffects
} from "./watchfaceEditorEffects.ts";

const COROS_CONFIG_DELETE_VALUE = "__COROSLINK_DELETE_CONFIG_KEY__";

/**
 * Styling choices the studio applies to a template. Digit bitmaps are
 * re-rendered from a locally installed font; weekday labels, battery digits,
 * and icons are recolored in place so their glyph shapes stay intact.
 */
export interface WatchfaceTypography {
  /** CSS-like weight, constrained to the 100–900 font-weight scale. */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Character spacing expressed as a fraction of the rendered font size. */
  letterSpacing?: number;
  /** Optional portable PNG atlas used when no desktop font family is set. */
  rasterFont?: CorosWatchfaceRasterFont;
}

export interface WatchfaceStudioOptions extends WatchfaceTypography {
  /** Empty string keeps the template's original digit bitmaps. */
  fontFamily: string;
  digitColor: string;
  accentColor: string;
  tintLabels: boolean;
  tintIcons: boolean;
  /** Changes only the studio preview; the watch rotates the control slot. */
  previewComplication?: WatchfaceComplicationId;
  /** Per-fixed-metric bitmap styles, isolated into their own sprite folders. */
  metricStyles?: WatchfaceMetricStyles;
  /** Shared bitmap style for values shown in the selectable control slot. */
  complicationStyle?: WatchfaceMetricSpriteStyle;
  /** Scales a Studio-created standalone battery folder from authoring size. */
  batteryIconResolutionScale?: number;
  /** Independent hour/minute bitmap styles. */
  timeStyles?: WatchfaceTimeStyles;
  /** Independent weekday/month/day bitmap sizing and styling. */
  dateStyles?: WatchfaceDateStyles;
  /** Colors for firmware layers without a specialized style object. */
  layerColors?: Record<string, string>;
  /** Preview-time config PNG replacements, keyed by config/aod scope. */
  configAssetOverrides?: Record<string, CorosWatchfaceConfigAssetOverride>;
  /** Selects which config tree owns direct PNG references in this preview. */
  configAssetScope?: WatchfaceConfigAssetScope;
  /** Live AM/PM indicator sprite styling, when the template supports it. */
  ampmStyle?: WatchfaceAmPmStyle;
  /** Reusable shadow styles used by the live preview. */
  effectStyles?: CorosWatchfaceEffectStyle[];
  /** Local or live-linked effects keyed by editor layer id. */
  layerEffects?: Record<string, CorosWatchfaceEffectBinding>;
  /** Target-resolution/master-resolution ratio for 800px-authored effects. */
  effectResolutionScale?: number;
  /**
   * Target/master ratio applied to master-authored native PNG dimensions
   * (date sizes, control icons, imported digit fonts) in a device preview.
   */
  nativeSpriteResolutionScale?: number;
}

/** Converts 800px-authored effect values into the active preview canvas. */
export function watchfaceEffectRenderScale(
  canvasToResolutionScale: number,
  resolutionToMasterScale = 1
): number {
  return canvasToResolutionScale * resolutionToMasterScale;
}

export type WatchfaceAssetLoader = (
  paths: string[]
) => Promise<CorosWatchfaceTemplateAsset[]>;

/** Always-on-display sprites are dimmed to limit OLED burn-in and drain. */
export const AOD_DIM_FACTOR = 0.55;

export function dimHexColor(hex: string, factor: number): string {
  const normalized = hex.replace("#", "");
  const channel = (offset: number) =>
    Math.round(
      Number.parseInt(normalized.slice(offset, offset + 2), 16) * factor
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * Styled text is written into Studio-owned sprite folders, not over the
 * template files. Those folders may use any positive bitmap scale; the
 * archive writer still enforces PNG byte limits before export.
 */
function normalizeSpriteScale(scale: number | undefined): number {
  return Number.isFinite(scale) && scale! > 0 ? scale! : 1;
}

/** Component styles override the face-wide raster font and digit spacing. */
function componentTypography(
  typography: WatchfaceTypography,
  style:
    | { rasterFont?: CorosWatchfaceRasterFont; letterSpacing?: number }
    | undefined
): WatchfaceTypography {
  return {
    ...typography,
    rasterFont: style?.rasterFont ?? typography.rasterFont,
    letterSpacing: style?.letterSpacing ?? typography.letterSpacing
  };
}

/** Parses a firmware position value such as `{524,234}`. */
export function parseConfigPos(
  value: string | undefined
): { x: number; y: number } | null {
  const match = value?.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** Parses a firmware rect value such as `{582,538,734,587,hcenter|vcenter}`. */
export function parseConfigRect(
  value: string | undefined
): { x0: number; y0: number; x1: number; y1: number } | null {
  const match = value?.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/
  );
  return match
    ? {
        x0: Number(match[1]),
        y0: Number(match[2]),
        x1: Number(match[3]),
        y1: Number(match[4])
      }
    : null;
}

export type WatchfaceConfigAssetScope = "config" | "aod";
export type WatchfacePreviewMode = "current" | "aod";

export interface WatchfaceConfigAssetReference {
  id: string;
  scope: WatchfaceConfigAssetScope;
  configKey: string;
  configPath: string;
  label: string;
  relativePath: string;
  archivePath: string;
  source: CorosWatchfaceSpriteFile | null;
}

export function watchfaceConfigAssetId(
  scope: WatchfaceConfigAssetScope,
  configKey: string
): string {
  return `${scope}:${configKey}`;
}

/** Whether this archive contains a usable always-on configuration. */
export function hasWatchfaceAod(
  details: CorosWatchfaceTemplateDetails
): boolean {
  return details.resolutions.some(
    (resolution) => Object.keys(resolution.aodConfig).length > 0
  );
}

/**
 * Presents AODconfig.txt through the normal preview renderer without mutating
 * the archive description. Resolutions without an AOD layout are omitted from
 * the device selector while the current-face tree remains unchanged.
 */
export function detailsForPreviewMode(
  details: CorosWatchfaceTemplateDetails,
  mode: WatchfacePreviewMode
): CorosWatchfaceTemplateDetails {
  if (mode === "current" || !hasWatchfaceAod(details)) return details;
  return {
    ...details,
    resolutions: details.resolutions
      .filter((resolution) => Object.keys(resolution.aodConfig).length > 0)
      .map((resolution) => ({
        ...resolution,
        config: { ...resolution.aodConfig }
      }))
  };
}

function configAssetLabel(configKey: string, _scope: WatchfaceConfigAssetScope): string {
  const special: Record<string, string> = {
    background_icon: "Background image",
    watchface_thmb_icon: "Watch face thumbnail",
    colon_icon: "Time colon",
    control_colon_icon: "Control value colon",
    control_bluetooth_off_icon: "Bluetooth off indicator",
    control_no_disturb_on_icon: "Do Not Disturb indicator",
    negative_sign_icon: "Negative sign",
    control_negative_sign_icon: "Control negative sign",
    arc_cut_icon: "Date separator",
    time_hour_icon: "Analog hour hand",
    time_minute_icon: "Analog minute hand",
    time_second_icon: "Analog second hand",
    time_center_polygon_icon1: "Analog center overlay (hour + minute)",
    time_center_polygon_icon2: "Analog center overlay (topmost)"
  };
  const base = special[configKey] ?? configKey
    .replace(/_icon\d*$/i, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
  return base;
}

function pngConfigEntries(
  resolution: CorosWatchfaceResolutionDetails,
  scope: WatchfaceConfigAssetScope
): Array<[string, string]> {
  const config = scope === "aod" ? resolution.aodConfig : resolution.config;
  return Object.entries(config).filter(([, value]) => /\.png$/i.test(value.trim()));
}

/** Every direct PNG reference in config.txt and AODconfig.txt. */
export function listWatchfaceConfigAssets(
  details: CorosWatchfaceTemplateDetails,
  resolutionDirectory?: string
): WatchfaceConfigAssetReference[] {
  const selectedResolution = resolutionDirectory
    ? details.resolutions.find((candidate) => candidate.directory === resolutionDirectory)
    : pickPreviewResolution(details);
  if (!selectedResolution) {
    return [];
  }
  const resolutions = resolutionDirectory
    ? [selectedResolution]
    : [
        selectedResolution,
        ...details.resolutions.filter(
          (candidate) => candidate.directory !== selectedResolution.directory
        )
      ];
  const byId = new Map<string, WatchfaceConfigAssetReference>();
  for (const resolution of resolutions) {
    for (const scope of ["config", "aod"] as const) {
      for (const [configKey, rawPath] of pngConfigEntries(resolution, scope)) {
        const id = watchfaceConfigAssetId(scope, configKey);
        if (byId.has(id)) continue;
        const relativePath = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
        const archivePath = `${resolution.directory}/${relativePath}`;
        byId.set(id, {
          id,
          scope,
          configKey,
          configPath: `${resolution.directory}/${scope === "aod" ? "AODconfig" : "config"}.txt`,
          label: configAssetLabel(configKey, scope),
          relativePath,
          archivePath,
          source: resolution.icons.find((file) => file.path === archivePath) ?? null
        });
      }
    }
  }
  const references = [...byId.values()];
  return references.sort((left, right) =>
    (left.scope === right.scope ? 0 : left.scope === "config" ? -1 : 1) ||
    left.label.localeCompare(right.label)
  );
}

export interface WatchfaceAnalogPreviewLayer {
  configKey:
    | "time_hour_icon"
    | "time_minute_icon"
    | "time_center_polygon_icon1"
    | "time_second_icon"
    | "time_center_polygon_icon2";
  source: CorosWatchfaceSpriteFile;
  center: { x: number; y: number };
  /** Null means a fixed center overlay; hands rotate clockwise from 12. */
  rotationDegrees: number | null;
}

function directConfigSprite(
  resolution: CorosWatchfaceResolutionDetails,
  configKey: string
): CorosWatchfaceSpriteFile | null {
  const value = resolution.config[configKey]?.trim().replace(/\\/g, "/");
  if (!value) return null;
  const path = `${resolution.directory}/${value.replace(/^\.\//, "")}`;
  return resolution.icons.find((candidate) => candidate.path === path) ?? null;
}

export interface WatchfaceControlStatusPreviewLayer {
  layoutGroupId: WatchfaceControlStatusLayoutGroupId;
  configKey:
    | "control_bluetooth_off_icon"
    | "control_no_disturb_on_icon";
  source: CorosWatchfaceSpriteFile;
  position: { x: number; y: number };
}

const CONTROL_STATUS_PREVIEW_DEFINITIONS = [
  {
    layoutGroupId: "bluetoothOff",
    label: "Bluetooth off indicator",
    configKey: "control_bluetooth_off_icon",
    positionKey: "control_bluetooth_icon_pos"
  },
  {
    layoutGroupId: "doNotDisturbOn",
    label: "Do Not Disturb indicator",
    configKey: "control_no_disturb_on_icon",
    positionKey: "control_no_disturb_icon_pos"
  }
] as const;

export type WatchfaceControlStatusLayoutGroupId =
  (typeof CONTROL_STATUS_PREVIEW_DEFINITIONS)[number]["layoutGroupId"];

export function controlStatusLayoutGroupId(
  configKey: string
): WatchfaceControlStatusLayoutGroupId | null {
  return CONTROL_STATUS_PREVIEW_DEFINITIONS.find(
    (definition) => definition.configKey === configKey
  )?.layoutGroupId ?? null;
}

/**
 * Resolves the two condition-driven icons that share the selectable-control
 * origin. Studio shows their active states together so both assets can be
 * reviewed; firmware still decides when each one appears on the watch.
 */
export function getWatchfaceControlStatusPreviewLayers(
  resolution: CorosWatchfaceResolutionDetails
): WatchfaceControlStatusPreviewLayer[] {
  const originKey = Object.keys(resolution.config).find((key) =>
    /^rect_control\d+_pos$/.test(key)
  );
  const origin = parseConfigPos(
    originKey ? resolution.config[originKey] : undefined
  ) ?? { x: 0, y: 0 };
  return CONTROL_STATUS_PREVIEW_DEFINITIONS.flatMap(
    ({ layoutGroupId, configKey, positionKey }) => {
      const source = directConfigSprite(resolution, configKey);
      const relativePosition = parseConfigPos(resolution.config[positionKey]);
      return source && relativePosition
        ? [{
            layoutGroupId,
            configKey,
            source,
            position: {
              x: origin.x + relativePosition.x,
              y: origin.y + relativePosition.y
            }
          }]
        : [];
    }
  );
}

/**
 * Recreates the firmware's analog compositing order. The two center overlays
 * are fixed images: icon1 sits above hour/minute, while icon2 also sits above
 * the second hand.
 */
export function getWatchfaceAnalogPreviewLayers(
  resolution: CorosWatchfaceResolutionDetails,
  now: Date
): WatchfaceAnalogPreviewLayer[] {
  const center = parseConfigPos(resolution.config.time_center_pos) ?? {
    x: resolution.width / 2,
    y: resolution.height / 2
  };
  const hourRotation =
    ((now.getHours() % 12) + now.getMinutes() / 60 + now.getSeconds() / 3600) * 30;
  const minuteRotation = (now.getMinutes() + now.getSeconds() / 60) * 6;
  const secondRotation = (now.getSeconds() + now.getMilliseconds() / 1000) * 6;
  const plan: Array<[
    WatchfaceAnalogPreviewLayer["configKey"],
    number | null
  ]> = [
    ["time_hour_icon", hourRotation],
    ["time_minute_icon", minuteRotation],
    ["time_center_polygon_icon1", null],
    ["time_second_icon", secondRotation],
    ["time_center_polygon_icon2", null]
  ];
  return plan.flatMap(([configKey, rotationDegrees]) => {
    const source = directConfigSprite(resolution, configKey);
    return source ? [{ configKey, source, center, rotationDegrees }] : [];
  });
}

function configAssetFolder(id: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${safe.slice(0, 52)}-${(hash >>> 0).toString(36)}`.slice(0, 64);
}

function configAssetCreatedRelativePath(id: string): string {
  return `studio/${configAssetFolder(id)}/00.png`;
}

const NATIVE_CONTROL_ICON_KEYS = new Set([
  "control_barometer_icon",
  "control_bluetooth_off_icon",
  "control_bluetooth_on_icon",
  "control_elevation_icon",
  "control_exercise_icon",
  "control_floor_icon",
  "control_hr_icon",
  "control_kcal_icon",
  "control_no_disturb_off_icon",
  "control_no_disturb_on_icon",
  "control_step_icon",
  "control_sunrise_icon",
  "control_sunset_icon",
  "control_temperature_icon"
]);

/** Direct selectable-control icons whose firmware entries accept a resized PNG. */
export function configAssetSupportsNativeSize(configKey: string): boolean {
  return NATIVE_CONTROL_ICON_KEYS.has(configKey);
}

function normalizePositiveScale(scale: number | undefined): number {
  const candidate = scale ?? 1;
  return Number.isFinite(candidate) ? Math.max(0.1, candidate) : 1;
}

/**
 * Resolves a config asset's exported/preview canvas without mutating its
 * position. Imported replacement dimensions are authored in the master
 * resolution; `nativeScale` converts them to the target tree.
 */
export function configAssetCanvasSize(
  configKey: string,
  override: CorosWatchfaceConfigAssetOverride | undefined,
  fallback: { width: number; height: number },
  nativeScale = 1
): { width: number; height: number; native: boolean } {
  if (
    !override?.nativeSize ||
    !override.replacement ||
    !configAssetSupportsNativeSize(configKey)
  ) {
    return { ...fallback, native: false };
  }
  const scale = normalizePositiveScale(override.scale) * nativeScale;
  return {
    width: Math.max(1, Math.round(override.replacement.width * scale)),
    height: Math.max(1, Math.round(override.replacement.height * scale)),
    native: true
  };
}

function replaceConfigAssetInPlace(configKey: string): boolean {
  return configAssetSupportsNativeSize(configKey);
}

/**
 * Applies per-reference visibility in preview and isolated replacement paths
 * during export. A replacement never mutates another config key that happens
 * to point at the same original PNG.
 */
export function buildWatchfaceConfigAssetOverrides(
  details: CorosWatchfaceTemplateDetails,
  overrides: Record<string, CorosWatchfaceConfigAssetOverride> = {},
  includeReplacementPaths = false
): CorosWatchfaceConfigOverride[] {
  const result: CorosWatchfaceConfigOverride[] = [];
  const batteryOverride = overrides["config:battery_icon"];
  const controlBatteryOverride = overrides["config:control_battery_icon"];
  const hasCustomControlBattery = Boolean(
    controlBatteryOverride?.replacement ||
    Object.keys(controlBatteryOverride?.stateReplacements ?? {}).length > 0
  );
  const baseResolution = pickPreviewResolution(details);
  const baseConfiguredBatteryFolder = baseResolution
    ? baseResolution.config.battery_icon_dir?.replace(/\\/g, "/")
    : undefined;
  const baseBatteryFolder = baseResolution
    ? (baseConfiguredBatteryFolder
        ? baseResolution.spriteFolders.find(
            (folder) =>
              folder.kind === "state" &&
              folder.folder === baseConfiguredBatteryFolder
          )
        : undefined) ??
      baseResolution.spriteFolders.find(
        (folder) =>
          folder.kind === "state" &&
          folder.folder.replace(/^a\//, "") === "cl_battery_icon"
      ) ??
      baseResolution.spriteFolders.find(
        (folder) =>
          folder.kind === "state" &&
          folder.folder.replace(/^a\//, "") === "battery"
      )
    : undefined;
  const baseImportedBattery =
    batteryOverride?.replacement ??
    Object.values(batteryOverride?.stateReplacements ?? {})[0];
  const baseBatteryWidth =
    baseImportedBattery?.width ?? baseBatteryFolder?.files[0]?.width ?? 40;
  const baseBatteryHeight =
    baseImportedBattery?.height ?? baseBatteryFolder?.files[0]?.height ?? 40;
  const baseBatteryPosition = baseResolution
    ? {
        x: Math.max(0, Math.round(baseResolution.width * 0.5 - baseBatteryWidth / 2)),
        y: Math.max(0, Math.round(baseResolution.height * 0.82 - baseBatteryHeight / 2))
      }
    : null;
  for (const resolution of details.resolutions) {
    for (const scope of ["config", "aod"] as const) {
      const values: Record<string, string> = {};
      for (const [configKey] of pngConfigEntries(resolution, scope)) {
        // The current background is always a composed Studio PNG written back
        // to the template's original path. Artwork visibility is handled while
        // composing that PNG, never by clearing or repointing this config key.
        if (scope === "config" && configKey === "background_icon") continue;
        const id = watchfaceConfigAssetId(scope, configKey);
        const override = overrides[id];
        if (!override) continue;
        if (override.enabled === false) {
          values[configKey] = "";
        } else if (
          includeReplacementPaths &&
          override.replacement &&
          !replaceConfigAssetInPlace(configKey)
        ) {
          values[configKey] = configAssetCreatedRelativePath(id).replace(/\//g, "\\");
        }
      }
      const scopedConfig = scope === "aod"
        ? resolution.aodConfig
        : resolution.config;
      if (
        hasCustomControlBattery &&
        controlBatteryOverride?.enabled !== false &&
        Object.prototype.hasOwnProperty.call(
          scopedConfig,
          "control_battery_icon_dir"
        )
      ) {
        values.control_battery_icon_dir = "cl_control_battery_icon";
      }
      if (scope === "config") {
        const configuredBatteryFolder =
          resolution.config.battery_icon_dir?.replace(/\\/g, "/");
        const batteryFolder =
          (configuredBatteryFolder
            ? resolution.spriteFolders.find(
                (folder) =>
                  folder.kind === "state" &&
                  folder.folder === configuredBatteryFolder
              )
            : undefined) ??
          resolution.spriteFolders.find(
            (folder) =>
              folder.kind === "state" &&
              folder.folder.replace(/^a\//, "") === "cl_battery_icon"
          ) ??
          resolution.spriteFolders.find(
            (folder) =>
              folder.kind === "state" &&
              folder.folder.replace(/^a\//, "") === "battery"
          );
        const importedBattery =
          batteryOverride?.replacement ??
          Object.values(batteryOverride?.stateReplacements ?? {})[0];
        const controlBatteryFolder =
          resolution.config.control_battery_icon_dir?.replace(/\\/g, "/");
        const existingStudioBattery =
          batteryFolder?.folder.replace(/^a\//, "") === "cl_battery_icon";
        const batteryEnabled = batteryOverride
          ? batteryOverride.enabled !== false
          : existingStudioBattery &&
            parseConfigPos(resolution.config.battery_icon_pos) !== null;
        if (batteryEnabled && (batteryFolder || importedBattery)) {
          // A template's control battery folder belongs to the selectable
          // complication. Imported fixed-battery states must get an isolated
          // folder or the two battery elements overwrite each other.
          const configuredFolderName =
            resolution.config.battery_icon_dir?.replace(/\\/g, "/");
          const sharesControlFolder = Boolean(
            importedBattery &&
            configuredFolderName &&
            controlBatteryFolder &&
            configuredFolderName === controlBatteryFolder
          );
          const folderName =
            (sharesControlFolder ? "cl_battery_icon" : configuredFolderName) ||
            (importedBattery || existingStudioBattery
              ? "cl_battery_icon"
              : batteryFolder?.folder) ||
            "cl_battery_icon";
          if (resolution.config.battery_icon_dir !== folderName) {
            values.battery_icon_dir = folderName.replace(/\//g, "\\");
          }
          if (!parseConfigPos(resolution.config.battery_icon_pos)) {
            const ratio = baseResolution
              ? resolution.width / baseResolution.width
              : 1;
            values.battery_icon_pos = `{${Math.round((baseBatteryPosition?.x ?? 0) * ratio)},${Math.round((baseBatteryPosition?.y ?? 0) * ratio)}}`;
          }
        }
      }
      // `battery_icon_pos` is the bitmap's firmware position. Scaling changes
      // only the PNG dimensions; preserving this value keeps Studio and the
      // watch on the same coordinate instead of shifting the icon up-left.
      if (Object.keys(values).length > 0) {
        result.push({
          path: `${resolution.directory}/${scope === "aod" ? "AODconfig" : "config"}.txt`,
          values
        });
      }
    }
  }
  return result;
}

/** Builds native-sized created PNGs for every customized config reference. */
export async function buildWatchfaceConfigAssetReplacements(
  details: CorosWatchfaceTemplateDetails,
  overrides: Record<string, CorosWatchfaceConfigAssetOverride> = {}
): Promise<CorosWatchfaceAssetReplacement[]> {
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const masterWidth = pickPreviewResolution(details)?.width;
  for (const resolution of details.resolutions) {
    const nativeScale = masterWidth ? resolution.width / masterWidth : 1;
    for (const scope of ["config", "aod"] as const) {
      for (const [configKey, rawPath] of pngConfigEntries(resolution, scope)) {
        const id = watchfaceConfigAssetId(scope, configKey);
        const override = overrides[id];
        if (!override?.replacement || override.enabled === false) continue;
        if (scope === "config" && configKey === "background_icon") continue;
        const relativePath = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
        const source = resolution.icons.find(
          (file) => file.path === `${resolution.directory}/${relativePath}`
        );
        const canvasSize = configAssetCanvasSize(
          configKey,
          override,
          {
            width: source?.width ??
              Math.max(1, Math.round(override.replacement.width * nativeScale)),
            height: source?.height ??
              Math.max(1, Math.round(override.replacement.height * nativeScale))
          },
          nativeScale
        );
        const replaceInPlace = Boolean(source) && replaceConfigAssetInPlace(configKey);
        replacements.push({
          path: replaceInPlace
            ? source!.path
            : `${resolution.directory}/${configAssetCreatedRelativePath(id)}`,
          dataUrl: canvasSize.native
            ? await resizeAndTintSprite(
                override.replacement.dataUrl,
                canvasSize.width,
                canvasSize.height
              )
            : await fitVisibleSpriteToCanvas(
                override.replacement.dataUrl,
                canvasSize.width,
                canvasSize.height,
                override.scale ?? 1
              ),
          create: !replaceInPlace,
          ...(canvasSize.native ? { allowDimensionOverride: true } : {})
        });
      }
    }
    const batteryOverride = overrides["config:battery_icon"];
    if (
      (batteryOverride?.replacement || batteryOverride?.stateReplacements) &&
      batteryOverride.enabled !== false
    ) {
      const batteryFolderName =
        resolution.config.battery_icon_dir?.replace(/\\/g, "/");
      const batteryFolder =
        (batteryFolderName
          ? resolution.spriteFolders.find(
              (folder) => folder.kind === "state" && folder.folder === batteryFolderName
            )
          : undefined) ??
        resolution.spriteFolders.find(
          (folder) =>
            folder.kind === "state" &&
            folder.folder.replace(/^a\//, "") === "cl_battery_icon"
        );
      const configuredControlFolder =
        resolution.config.control_battery_icon_dir?.replace(/\\/g, "/");
      const isolateFixedBattery = Boolean(
        batteryFolderName &&
        configuredControlFolder &&
        batteryFolderName === configuredControlFolder
      );
      const fixedTargetFolder = isolateFixedBattery
        ? "cl_battery_icon"
        : batteryFolder?.folder;
      for (const [index, sprite] of (batteryFolder?.files ?? []).entries()) {
        const replacement =
          batteryOverride.stateReplacements?.[String(index)] ??
          batteryOverride.replacement;
        if (!replacement) continue;
        replacements.push({
          path: fixedTargetFolder
            ? `${resolution.directory}/${fixedTargetFolder}/${sprite.path.split("/").at(-1)}`
            : sprite.path,
          dataUrl: await renderScaledSpriteInSlot(
            replacement.dataUrl,
            Math.max(1, sprite.width),
            Math.max(1, sprite.height),
            batteryOverride.scale ?? 1
          ),
          ...(isolateFixedBattery ? { create: true } : {}),
          allowDimensionOverride: (batteryOverride.scale ?? 1) !== 1
        });
      }
      if (!batteryFolder) {
        const createdFolder = "cl_battery_icon";
        const baseResolution = pickPreviewResolution(details);
        const resolutionScale = baseResolution
          ? resolution.width / baseResolution.width
          : 1;
        const states = Object.entries(batteryOverride.stateReplacements ?? {})
          .filter(([key]) => /^\d+$/.test(key))
          .sort(([left], [right]) => Number(left) - Number(right));
        if (states.length === 0 && batteryOverride.replacement) {
          states.push(["0", batteryOverride.replacement]);
        }
        for (const [state, replacement] of states) {
          replacements.push({
            path: `${resolution.directory}/${createdFolder}/${String(Number(state)).padStart(2, "0")}.png`,
            dataUrl: await renderScaledSpriteInSlot(
              replacement.dataUrl,
              Math.max(1, Math.round(replacement.width * resolutionScale)),
              Math.max(1, Math.round(replacement.height * resolutionScale)),
              batteryOverride.scale ?? 1
            ),
            create: true
          });
        }
      }
    }
    const controlBatteryOverride =
      overrides["config:control_battery_icon"];
    if (
      (controlBatteryOverride?.replacement ||
        controlBatteryOverride?.stateReplacements) &&
      controlBatteryOverride.enabled !== false
    ) {
      const configuredControlFolder =
        resolution.config.control_battery_icon_dir?.replace(/\\/g, "/");
      const controlBatteryFolder = configuredControlFolder
        ? resolution.spriteFolders.find(
            (folder) =>
              folder.kind === "state" &&
              folder.folder === configuredControlFolder
          )
        : undefined;
      const baseResolution = pickPreviewResolution(details);
      const resolutionScale = baseResolution
        ? resolution.width / baseResolution.width
        : 1;
      let states = Object.entries(
        controlBatteryOverride.stateReplacements ?? {}
      )
        .filter(([key]) => /^\d+$/.test(key))
        .sort(([left], [right]) => Number(left) - Number(right));
      if (states.length === 0 && controlBatteryOverride.replacement) {
        states = (controlBatteryFolder?.files.length
          ? controlBatteryFolder.files.map((_, index) => String(index))
          : ["0"]
        ).map((state) => [state, controlBatteryOverride.replacement!] as const);
      }
      for (const [state, replacement] of states) {
        const templateState = controlBatteryFolder?.files[Number(state)];
        replacements.push({
          path: `${resolution.directory}/cl_control_battery_icon/${String(Number(state)).padStart(2, "0")}.png`,
          dataUrl: await renderScaledSpriteInSlot(
            replacement.dataUrl,
            Math.max(
              1,
              templateState?.width ??
                Math.round(replacement.width * resolutionScale)
            ),
            Math.max(
              1,
              templateState?.height ??
                Math.round(replacement.height * resolutionScale)
            ),
            controlBatteryOverride.scale ?? 1
          ),
          create: true
        });
      }
    }
  }
  return replacements;
}

export type WatchfaceStaticSeparatorId = "colon" | "dateSlash";

export interface WatchfaceStaticSeparatorStyle {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  color: string;
  /** Optional per-separator font; falls back to the design font. */
  fontFamily?: string;
}

export type WatchfaceStaticSeparators = Record<
  WatchfaceStaticSeparatorId,
  WatchfaceStaticSeparatorStyle
>;

/** Suggested separator centers inferred from the surrounding template fields. */
export function inferStaticSeparators(
  details: CorosWatchfaceTemplateDetails,
  color = "#ffffff"
): WatchfaceStaticSeparators {
  const resolution = pickPreviewResolution(details);
  const fallbackWidth = resolution?.width ?? 800;
  const fallbackHeight = resolution?.height ?? 800;
  const fallback: WatchfaceStaticSeparators = {
    colon: {
      enabled: false,
      x: fallbackWidth / 2,
      y: fallbackHeight * 0.4,
      size: Math.round(fallbackHeight * 0.08),
      color
    },
    dateSlash: {
      enabled: false,
      x: fallbackWidth / 2,
      y: fallbackHeight * 0.3,
      size: Math.round(fallbackHeight * 0.06),
      color
    }
  };
  if (!resolution) {
    return fallback;
  }
  const config = resolution.config;
  const hourPos = parseConfigPos(config["time_hour_low_pos"]);
  const minutePos = parseConfigPos(config["time_minute_high_pos"]);
  const hourSource = findSpriteFolder(resolution, config["time_hour_low_font"]);
  const minuteSource = findSpriteFolder(resolution, config["time_minute_high_font"]);
  const hourFile = hourSource?.files[0];
  const minuteFile = minuteSource?.files[0];
  if (hourPos && minutePos && hourFile && minuteFile) {
    fallback.colon.x = Math.round(
      (hourPos.x + hourFile.width + minutePos.x) / 2
    );
    fallback.colon.y = Math.round(
      (hourPos.y + hourFile.height / 2 + minutePos.y + minuteFile.height / 2) / 2
    );
    fallback.colon.size = Math.max(hourFile.height, minuteFile.height);
  }
  const monthRect = parseConfigRect(config["english_date_month_rect"]);
  const dayRect = parseConfigRect(config["english_date_day_rect"]);
  if (monthRect && dayRect) {
    fallback.dateSlash.x = Math.round((monthRect.x1 + dayRect.x0) / 2);
    fallback.dateSlash.y = Math.round(
      (monthRect.y0 + monthRect.y1 + dayRect.y0 + dayRect.y1) / 4
    );
    fallback.dateSlash.size = Math.max(
      12,
      Math.round(Math.max(monthRect.y1 - monthRect.y0, dayRect.y1 - dayRect.y0))
    );
  }
  return fallback;
}

/** Hides the firmware colon when a draggable static replacement is enabled. */
export function buildStaticSeparatorOverrides(
  details: CorosWatchfaceTemplateDetails,
  separators: WatchfaceStaticSeparators
): CorosWatchfaceConfigOverride[] {
  if (!separators.colon.enabled && !separators.dateSlash.enabled) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    const values: Record<string, string> = {};
    if (
      separators.colon.enabled &&
      Object.prototype.hasOwnProperty.call(resolution.config, "colon_icon")
    ) {
      values.colon_icon = "";
    }
    if (
      separators.dateSlash.enabled &&
      Object.prototype.hasOwnProperty.call(resolution.config, "arc_cut_icon")
    ) {
      values.arc_cut_icon = "";
    }
    return Object.keys(values).length > 0
      ? [{ path: `${resolution.directory}/config.txt`, values }]
      : [];
  });
}

/**
 * The AM/PM indicator stays a live sprite (the firmware swaps am/pm by the
 * clock, in 12-hour mode), so unlike the static separators it cannot be baked
 * into the background. Styling instead re-points the template's am/pm config
 * keys at studio-generated sprites.
 */
export interface WatchfaceAmPmStyle {
  enabled: boolean;
  /** Top-left corner in preview-resolution coordinates (`am_pm_icon_pos`). */
  x: number;
  y: number;
  scale: number;
  /** Optional tint; absent preserves the template sprite color. */
  color?: string;
  /** Optional desktop font rasterized into the live AM and PM sprites. */
  fontFamily?: string;
}

/**
 * Converts the master authoring position to a device resolution for preview.
 * Export performs the same conversion while building each config override.
 */
export function scaleAmPmStyleForResolution(
  style: WatchfaceAmPmStyle,
  source: Pick<CorosWatchfaceResolutionDetails, "width" | "height">,
  target: Pick<CorosWatchfaceResolutionDetails, "width" | "height">
): WatchfaceAmPmStyle {
  if (source.width === target.width && source.height === target.height) {
    return style;
  }
  return {
    ...style,
    x: style.x * (target.width / source.width),
    y: style.y * (target.height / source.height)
  };
}

const AMPM_CONFIG_KEYS = ["am_icon", "pm_icon", "am_pm_icon_pos"] as const;
// The main process only accepts created sprites under studio/<name>/NN.png,
// so the AM icon becomes 00.png and the PM icon 01.png of one studio folder.
const AMPM_SPRITE_FILES = { am: "studio/ampm/00.png", pm: "studio/ampm/01.png" };
const AMPM_CONFIG_VALUES = { am: "studio\\ampm\\00.png", pm: "studio\\ampm\\01.png" };

function findAmPmIcons(
  resolution: CorosWatchfaceResolutionDetails
): { am: CorosWatchfaceSpriteFile; pm: CorosWatchfaceSpriteFile } | null {
  const lookup = (name: string) =>
    resolution.icons.find(
      (icon) =>
        icon.path.toLowerCase() ===
        `${resolution.directory}/icon/${name}`.toLowerCase()
    ) ?? null;
  const am = lookup("am.png");
  const pm = lookup("pm.png");
  return am && pm ? { am, pm } : null;
}

function resolutionSupportsAmPm(
  resolution: CorosWatchfaceResolutionDetails
): boolean {
  return (
    AMPM_CONFIG_KEYS.every((key) =>
      Object.prototype.hasOwnProperty.call(resolution.config, key)
    ) && findAmPmIcons(resolution) !== null
  );
}

export interface WatchfaceAmPmCapability {
  /** The preview resolution's AM icon, for bounds and preview sizing. */
  icon: CorosWatchfaceSpriteFile;
  /** Whether the template ships with the indicator already wired up. */
  active: boolean;
  defaultPos: { x: number; y: number };
}

/** Whether the template can show an AM/PM indicator, and where to start it. */
export function getAmPmCapability(
  details: CorosWatchfaceTemplateDetails
): WatchfaceAmPmCapability | null {
  const resolution = pickPreviewResolution(details);
  if (!resolution || !resolutionSupportsAmPm(resolution)) {
    return null;
  }
  const icons = findAmPmIcons(resolution)!;
  let defaultPos = parseConfigPos(resolution.config["am_pm_icon_pos"]);
  if (!defaultPos) {
    const minutePos = parseConfigPos(resolution.config["time_minute_low_pos"]);
    const minuteFile = findSpriteFolder(
      resolution,
      resolution.config["time_minute_low_font"]
    )?.files[0];
    defaultPos =
      minutePos && minuteFile
        ? {
            x: minutePos.x + minuteFile.width + 12,
            y: Math.round(
              minutePos.y + minuteFile.height / 2 - icons.am.height / 2
            )
          }
        : {
            x: Math.round(resolution.width * 0.6),
            y: Math.round(resolution.height * 0.45)
          };
  }
  return {
    icon: icons.am,
    active: (resolution.config["am_icon"] ?? "") !== "",
    defaultPos
  };
}

/** Points the firmware's AM/PM keys at the studio sprites, or clears them. */
export function buildAmPmOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceAmPmStyle
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    if (!resolutionSupportsAmPm(resolution)) {
      return [];
    }
    if (!style.enabled) {
      // Restore the dormant form templates ship with, but only when the
      // template arrived active; otherwise leave the config untouched.
      return (resolution.config["am_icon"] ?? "") !== ""
        ? [
            {
              path: `${resolution.directory}/config.txt`,
              values: { am_icon: "", pm_icon: "", am_pm_icon_pos: "" }
            }
          ]
        : [];
    }
    const scale = resolution.width / base.width;
    return [
      {
        path: `${resolution.directory}/config.txt`,
        values: {
          am_icon: AMPM_CONFIG_VALUES.am,
          pm_icon: AMPM_CONFIG_VALUES.pm,
          am_pm_icon_pos: `{${Math.round(style.x * scale)},${Math.round(style.y * scale)}}`
        }
      }
    ];
  });
}

/** Generates the resized and tinted AM/PM sprites as new studio entries. */
export async function buildAmPmSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceAmPmStyle,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  if (!style.enabled) {
    return [];
  }
  const normalizedScale = Math.max(0.5, Math.min(2, style.scale));
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    label: "AM" | "PM";
  }[] = [];
  for (const resolution of details.resolutions) {
    if (!resolutionSupportsAmPm(resolution)) {
      continue;
    }
    const icons = findAmPmIcons(resolution)!;
    jobs.push(
      {
        source: icons.am,
        path: `${resolution.directory}/${AMPM_SPRITE_FILES.am}`,
        label: "AM"
      },
      {
        source: icons.pm,
        path: `${resolution.directory}/${AMPM_SPRITE_FILES.pm}`,
        label: "PM"
      }
    );
  }
  const assets = style.fontFamily
    ? []
    : await loadAssets([...new Set(jobs.map((job) => job.source.path))]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const width = Math.max(1, Math.round(job.source.width * normalizedScale));
    const height = Math.max(1, Math.round(job.source.height * normalizedScale));
    replacements.push({
      path: job.path,
      dataUrl: style.fontFamily
        ? renderDigitSprite(
            job.label,
            width,
            height,
            style.fontFamily,
            style.color ?? "#ffffff"
          )
        : await resizeAndTintSprite(
            assetsByPath.get(job.source.path)?.dataUrl ?? "",
            width,
            height,
            style.color
          ),
      create: true
    });
  }
  return replacements;
}

/** Removes separators and duplicate mappings from a PNG-atlas glyph label. */
export function normalizeRasterFontGlyphs(value: string): string {
  const seen = new Set<string>();
  const glyphs: string[] = [];
  for (const glyph of value.toUpperCase()) {
    if (/\s/.test(glyph) || seen.has(glyph)) {
      continue;
    }
    seen.add(glyph);
    glyphs.push(glyph);
  }
  return glyphs.join("");
}

/** Returns whether a PNG font atlas contains every character in `text`. */
export function rasterFontSupportsText(
  rasterFont: CorosWatchfaceRasterFont | undefined,
  text: string
): boolean {
  if (!rasterFont) {
    return false;
  }
  const normalizedText = text.toUpperCase();
  if (rasterFont.sprites?.[normalizedText] || rasterFont.labels?.[normalizedText]) {
    return true;
  }
  if (!rasterFont.dataUrl) return false;
  const glyphs = new Set(normalizeRasterFontGlyphs(rasterFont.glyphs));
  return [...normalizedText].every((glyph) => glyphs.has(glyph));
}

/** A desktop family takes priority; otherwise use the atlas when it has the text. */
export function shouldRenderWatchfaceText(
  text: string,
  fontFamily: string,
  typography: WatchfaceTypography = {}
): boolean {
  return Boolean(fontFamily) || rasterFontSupportsText(typography.rasterFont, text);
}

/**
 * Renders text from a user-provided PNG atlas. The atlas is deliberately
 * preserved as a single data URL in the project so a design remains portable
 * even when its original desktop font is not installed elsewhere.
 */
export async function renderRasterFontSprite(
  text: string,
  width: number,
  height: number,
  rasterFont: CorosWatchfaceRasterFont,
  color: string,
  typography: WatchfaceTypography = {}
): Promise<string> {
  const glyphs = normalizeRasterFontGlyphs(rasterFont.glyphs);
  const characters = [...text.toUpperCase()];
  if (!rasterFontSupportsText(rasterFont, text) || characters.length === 0) {
    throw new Error("The uploaded PNG font does not include every requested glyph.");
  }
  const directSprite =
    rasterFont.sprites?.[text.toUpperCase()] ??
    rasterFont.labels?.[text.toUpperCase()];
  if (directSprite) {
    // A font folder contains individual glyph artwork. Fit those glyphs by
    // height, rather than independently constraining each one by width: a wide
    // "5" must not become shorter than a narrow "1" in the same font.
    return renderRasterImageSprite(
      directSprite,
      width,
      height,
      color,
      rasterFont.tint,
      characters.length === 1
    );
  }
  const directGlyphSprites = characters.map(
    (character) => rasterFont.sprites?.[character]
  );
  if (directGlyphSprites.every((sprite): sprite is string => Boolean(sprite))) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Sprite rendering is unavailable in this window.");
    }
    const tracking = Math.max(-0.35, Math.min(0.25, typography.letterSpacing ?? 0));
    const gap = height * tracking;
    const glyphWidth = Math.max(
      1,
      Math.round((width - gap * Math.max(0, characters.length - 1)) / characters.length)
    );
    let x = Math.round((width - (glyphWidth * characters.length + gap * Math.max(0, characters.length - 1))) / 2);
    for (const sprite of directGlyphSprites) {
      const image = await loadStudioImage(
        await renderRasterImageSprite(sprite, glyphWidth, height, color, rasterFont.tint)
      );
      context.drawImage(image, x, 0, glyphWidth, height);
      x += Math.round(glyphWidth + gap);
    }
    return canvas.toDataURL("image/png");
  }
  if (!rasterFont.dataUrl) {
    throw new Error("The PNG font does not include an atlas for this glyph.");
  }
  const atlas = await loadStudioImage(rasterFont.dataUrl);
  const columns = Math.max(1, Math.min(glyphs.length, Math.round(rasterFont.columns)));
  const rows = Math.ceil(glyphs.length / columns);
  const cellWidth = atlas.naturalWidth / columns;
  const cellHeight = atlas.naturalHeight / rows;
  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error("The uploaded PNG font atlas has no drawable cells.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = false;
  const aspect = cellWidth / cellHeight;
  const tracking = Math.max(-0.35, Math.min(0.25, typography.letterSpacing ?? 0));
  const occupiedAspect = Math.max(
    0.1,
    characters.length * aspect + Math.max(0, characters.length - 1) * tracking
  );
  const heightByWidth =
    (width * 0.94) / occupiedAspect;
  const glyphHeight = Math.max(1, Math.min(height * 0.94, heightByWidth));
  const glyphWidth = glyphHeight * aspect;
  const gap = glyphHeight * tracking;
  const totalWidth = glyphWidth * characters.length + gap * Math.max(0, characters.length - 1);
  let x = (width - totalWidth) / 2;
  const y = (height - glyphHeight) / 2;

  for (const character of characters) {
    const index = glyphs.indexOf(character);
    const sourceX = (index % columns) * cellWidth;
    const sourceY = Math.floor(index / columns) * cellHeight;
    context.drawImage(
      atlas,
      sourceX,
      sourceY,
      cellWidth,
      cellHeight,
      x,
      y,
      glyphWidth,
      glyphHeight
    );
    x += glyphWidth + gap;
  }
  if (rasterFont.tint) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

/** Fits one pre-rasterized label sprite inside a watchface sprite slot. */
async function renderRasterImageSprite(
  dataUrl: string,
  width: number,
  height: number,
  color: string,
  tint: boolean,
  fitByHeight = false
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  if (
    !tint &&
    image.naturalWidth === Math.round(width) &&
    image.naturalHeight === Math.round(height)
  ) {
    return dataUrl;
  }
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const sourceX = right >= left ? left : 0;
  const sourceY = bottom >= top ? top : 0;
  const sourceWidth = right >= left ? right - left + 1 : source.width;
  const sourceHeight = bottom >= top ? bottom - top + 1 : source.height;
  const scale = fitByHeight
    ? (height * 0.98) / sourceHeight
    : Math.min((width * 0.98) / sourceWidth, (height * 0.98) / sourceHeight);
  const drawWidth = Math.max(1, sourceWidth * scale);
  const drawHeight = Math.max(1, sourceHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
  if (tint) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

/**
 * Renders either a host-installed font or a project-local PNG font atlas.
 */
export async function renderWatchfaceTextSprite(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  color: string,
  typography: WatchfaceTypography = {}
): Promise<string> {
  if (!fontFamily && typography.rasterFont && rasterFontSupportsText(typography.rasterFont, text)) {
    return renderRasterFontSprite(text, width, height, typography.rasterFont, color, typography);
  }
  return renderDigitSprite(text, width, height, fontFamily, color, typography);
}

/**
 * Renders text at its natural width while retaining the requested native
 * height. This is used by weekday labels so a wide font is never condensed
 * merely to fit the template's original rectangle.
 */
export async function renderNativeWatchfaceTextSprite(
  text: string,
  height: number,
  fontFamily: string,
  color: string,
  typography: WatchfaceTypography = {}
): Promise<string> {
  const targetHeight = Math.max(1, Math.round(height));
  if (
    !fontFamily &&
    typography.rasterFont &&
    rasterFontSupportsText(typography.rasterFont, text)
  ) {
    return renderNativeRasterFontSprite(
      text,
      targetHeight,
      typography.rasterFont,
      color,
      typography
    );
  }

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  const fontWeight = normalizeFontWeight(typography.fontWeight);
  const fontStyle = typography.fontStyle === "italic" ? "italic" : "normal";
  const fontSize = Math.max(5, Math.floor(targetHeight * 0.92));
  const letterSpacing = Math.max(
    -0.35,
    Math.min(0.25, typography.letterSpacing ?? 0)
  );
  measureContext.font =
    `${fontStyle} ${fontWeight} ${fontSize}px ${quoteFontFamily(fontFamily)}`;
  setCanvasLetterSpacing(measureContext, fontSize * letterSpacing);
  const metrics = measureContext.measureText(text);
  const padding = Math.max(1, Math.ceil(targetHeight * 0.03));
  const width = Math.max(1, Math.ceil(metrics.width + padding * 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.font =
    `${fontStyle} ${fontWeight} ${fontSize}px ${quoteFontFamily(fontFamily)}`;
  setCanvasLetterSpacing(context, fontSize * letterSpacing);
  context.textBaseline = "alphabetic";
  context.fillStyle = color;
  const glyphHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  context.fillText(
    text,
    (width - metrics.width) / 2,
    (targetHeight - glyphHeight) / 2 + metrics.actualBoundingBoxAscent
  );
  return canvas.toDataURL("image/png");
}

async function renderNativeRasterFontSprite(
  text: string,
  height: number,
  rasterFont: CorosWatchfaceRasterFont,
  color: string,
  typography: WatchfaceTypography
): Promise<string> {
  const normalizedText = text.toUpperCase();
  const directSprite =
    rasterFont.sprites?.[normalizedText] ??
    rasterFont.labels?.[normalizedText];
  if (directSprite) {
    return renderNativeRasterImageSprite(
      directSprite,
      height,
      color,
      rasterFont.tint
    );
  }

  const characters = [...normalizedText];
  const directGlyphSprites = characters.map(
    (character) => rasterFont.sprites?.[character]
  );
  if (
    directGlyphSprites.length > 0 &&
    directGlyphSprites.every((sprite): sprite is string => Boolean(sprite))
  ) {
    const glyphs = await Promise.all(
      directGlyphSprites.map((sprite) =>
        renderNativeRasterImageSprite(sprite, height, color, rasterFont.tint)
      )
    );
    const images = await Promise.all(
      glyphs.map((dataUrl) => loadStudioImage(dataUrl))
    );
    const tracking = Math.max(
      -0.35,
      Math.min(0.25, typography.letterSpacing ?? 0)
    );
    const gap = Math.round(height * tracking);
    const width = Math.max(
      1,
      images.reduce((total, image) => total + image.naturalWidth, 0) +
        gap * Math.max(0, images.length - 1)
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Sprite rendering is unavailable in this window.");
    }
    let x = 0;
    for (const image of images) {
      context.drawImage(image, x, 0);
      x += image.naturalWidth + gap;
    }
    return canvas.toDataURL("image/png");
  }

  if (!rasterFont.dataUrl) {
    throw new Error("The PNG font does not include an atlas for this label.");
  }
  const atlas = await loadStudioImage(rasterFont.dataUrl);
  const glyphs = normalizeRasterFontGlyphs(rasterFont.glyphs);
  const columns = Math.max(1, Math.min(glyphs.length, Math.round(rasterFont.columns)));
  const rows = Math.ceil(glyphs.length / columns);
  const cellWidth = atlas.naturalWidth / columns;
  const cellHeight = atlas.naturalHeight / rows;
  const glyphHeight = Math.max(1, Math.round(height * 0.94));
  const glyphWidth = Math.max(1, glyphHeight * (cellWidth / cellHeight));
  const tracking = Math.max(
    -0.35,
    Math.min(0.25, typography.letterSpacing ?? 0)
  );
  const gap = glyphHeight * tracking;
  const width = Math.max(
    1,
    Math.ceil(
      glyphWidth * characters.length +
        gap * Math.max(0, characters.length - 1)
    )
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = false;
  let x = 0;
  const y = (height - glyphHeight) / 2;
  for (const character of characters) {
    const index = glyphs.indexOf(character);
    if (index < 0) {
      throw new Error("The PNG font does not include every weekday glyph.");
    }
    context.drawImage(
      atlas,
      (index % columns) * cellWidth,
      Math.floor(index / columns) * cellHeight,
      cellWidth,
      cellHeight,
      x,
      y,
      glyphWidth,
      glyphHeight
    );
    x += glyphWidth + gap;
  }
  if (rasterFont.tint) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

async function renderNativeRasterImageSprite(
  dataUrl: string,
  height: number,
  color?: string,
  tint = false
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(
    0,
    0,
    source.width,
    source.height
  ).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const sourceX = right >= left ? left : 0;
  const sourceY = bottom >= top ? top : 0;
  const sourceWidth = right >= left ? right - left + 1 : source.width;
  const sourceHeight = bottom >= top ? bottom - top + 1 : source.height;
  const padding = Math.max(1, Math.ceil(height * 0.03));
  const drawHeight = Math.max(1, height - padding * 2);
  const drawWidth = Math.max(
    1,
    Math.round(sourceWidth * (drawHeight / sourceHeight))
  );
  const canvas = document.createElement("canvas");
  canvas.width = drawWidth + padding * 2;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    padding,
    padding,
    drawWidth,
    drawHeight
  );
  if (tint && color) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}

async function centerSpriteOnCanvas(
  dataUrl: string,
  width: number,
  height: number
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  if (image.naturalWidth === width && image.naturalHeight === height) {
    return dataUrl;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.drawImage(
    image,
    Math.round((width - image.naturalWidth) / 2),
    Math.round((height - image.naturalHeight) / 2)
  );
  return canvas.toDataURL("image/png");
}

/**
 * Renders one digit into a sprite of the template's exact pixel size. The
 * glyph is measured and centered so mixed fonts still align on the face.
 */
export function renderDigitSprite(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  color: string,
  typography: WatchfaceTypography = {}
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }

  const fontWeight = normalizeFontWeight(typography.fontWeight);
  const fontStyle = typography.fontStyle === "italic" ? "italic" : "normal";
  const letterSpacing = Math.max(-0.35, Math.min(0.25, typography.letterSpacing ?? 0));
  let fontSize = Math.floor(height * 0.92);
  context.textBaseline = "alphabetic";
  context.fillStyle = color;
  for (; fontSize > 4; fontSize -= 1) {
    // Use the font's Regular face by default, matching what desktop editors
    // such as Word show when a family is chosen without applying Bold.
    context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${quoteFontFamily(fontFamily)}`;
    setCanvasLetterSpacing(context, fontSize * letterSpacing);
    const metrics = context.measureText(text);
    const glyphHeight =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (metrics.width <= width * 0.96 && glyphHeight <= height * 0.96) {
      break;
    }
  }
  const metrics = context.measureText(text);
  const glyphHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  context.fillText(
    text,
    (width - metrics.width) / 2,
    (height - glyphHeight) / 2 + metrics.actualBoundingBoxAscent
  );
  return canvas.toDataURL("image/png");
}

function normalizeFontWeight(weight: number | undefined): number {
  const rounded = Math.round((weight ?? 400) / 100) * 100;
  return Math.max(100, Math.min(900, rounded));
}

/** Electron's Chromium supports canvas letter spacing; older runtimes ignore it safely. */
function setCanvasLetterSpacing(context: CanvasRenderingContext2D, pixels: number): void {
  if ("letterSpacing" in context) {
    context.letterSpacing = `${pixels}px`;
  }
}

/** Recolors a sprite while preserving its alpha silhouette. */
export async function tintSprite(
  dataUrl: string,
  width: number,
  height: number,
  color: string
): Promise<string> {
  return resizeAndTintSprite(dataUrl, width, height, color);
}

/** Resizes a source bitmap and optionally recolors its non-transparent pixels. */
export async function resizeAndTintSprite(
  dataUrl: string,
  width: number,
  height: number,
  color?: string
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite tinting is unavailable in this window.");
  }
  context.drawImage(image, 0, 0, width, height);
  if (color) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

/**
 * Removes transparent source padding and fits the visible artwork into a
 * firmware-sized canvas without distorting its aspect ratio. Zoom may enlarge
 * the artwork beyond the canvas; the excess is intentionally clipped while
 * the exported PNG dimensions remain firmware-safe.
 */
export async function fitVisibleSpriteToCanvas(
  dataUrl: string,
  width: number,
  height: number,
  zoom = 1
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Sprite fitting is unavailable in this window.");
  }
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(
    0,
    0,
    source.width,
    source.height
  ).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    return resizeAndTintSprite(dataUrl, width, height);
  }
  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const safeZoom = normalizePositiveScale(zoom);
  const fit = Math.min(width / contentWidth, height / contentHeight) * safeZoom;
  const outputWidth = Math.max(1, Math.round(contentWidth * fit));
  const outputHeight = Math.max(1, Math.round(contentHeight * fit));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite fitting is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    left,
    top,
    contentWidth,
    contentHeight,
    Math.round((width - outputWidth) / 2),
    Math.round((height - outputHeight) / 2),
    outputWidth,
    outputHeight
  );
  return canvas.toDataURL("image/png");
}

/** Returns the exported dimensions for a scaled, aspect-preserving battery PNG. */
export function scaledBatterySpriteCanvasSize(
  sourceWidth: number,
  sourceHeight: number,
  templateWidth: number,
  templateHeight: number,
  scale = 1
): { width: number; height: number } {
  const safeScale = normalizePositiveScale(scale);
  if (safeScale === 1) return { width: templateWidth, height: templateHeight };
  const fit = Math.min(templateWidth / sourceWidth, templateHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * fit * safeScale)),
    height: Math.max(1, Math.round(sourceHeight * fit * safeScale))
  };
}

/** Representative normal-charge state used consistently by preview and bounds. */
export function batteryPreviewStateIndex(stateCount: number): number {
  return Math.min(8, Math.max(0, stateCount - 1));
}

/** Renders a battery-state sprite at the selected bitmap scale. */
export async function renderScaledSpriteInSlot(
  dataUrl: string,
  width: number,
  height: number,
  scale = 1
): Promise<string> {
  const image = await loadStudioImage(dataUrl);
  const { width: outputWidth, height: outputHeight } = scaledBatterySpriteCanvasSize(
    image.naturalWidth,
    image.naturalHeight,
    width,
    height,
    scale
  );
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Sprite rendering is unavailable in this window.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    0,
    0,
    outputWidth,
    outputHeight
  );
  return canvas.toDataURL("image/png");
}

const STUDIO_IMAGE_CACHE_LIMIT = 96;
const STUDIO_IMAGE_CACHE_MAX_SOURCE_LENGTH = 256_000;
const studioImageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadStudioImage(
  dataUrl: string,
  cache = true
): Promise<HTMLImageElement> {
  const cacheable = cache && dataUrl.length <= STUDIO_IMAGE_CACHE_MAX_SOURCE_LENGTH;
  const cached = cacheable ? studioImageCache.get(dataUrl) : undefined;
  if (cached) {
    // Refresh insertion order so frequently reused template sprites stay hot.
    studioImageCache.delete(dataUrl);
    studioImageCache.set(dataUrl, cached);
    return cached;
  }
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A studio image failed to load."));
    image.src = dataUrl;
  });
  if (cacheable) {
    studioImageCache.set(dataUrl, pending);
    while (studioImageCache.size > STUDIO_IMAGE_CACHE_LIMIT) {
      const oldest = studioImageCache.keys().next().value;
      if (oldest === undefined) break;
      studioImageCache.delete(oldest);
    }
    void pending.catch(() => {
      if (studioImageCache.get(dataUrl) === pending) {
        studioImageCache.delete(dataUrl);
      }
    });
  }
  return pending;
}

const MAX_ARTWORK_DIMENSION = 1400;

/**
 * Caps imported artwork at 1400px on its longest side so project files stay
 * small. Runs in the renderer because Chromium's decode honors the source
 * ICC profile, and uses a wide-gamut canvas so P3 colors survive the resize.
 */
export async function downscaleArtwork(
  artwork: CorosWatchfaceArtwork
): Promise<CorosWatchfaceArtwork> {
  const largest = Math.max(artwork.width, artwork.height);
  if (largest <= MAX_ARTWORK_DIMENSION) {
    return artwork;
  }
  const image = await loadStudioImage(artwork.dataUrl);
  const scale = MAX_ARTWORK_DIMENSION / largest;
  const width = Math.max(1, Math.round(artwork.width * scale));
  const height = Math.max(1, Math.round(artwork.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) {
    return artwork;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

function isAodSprite(file: CorosWatchfaceSpriteFile): boolean {
  return /\/a\//.test(file.path);
}

function quoteFontFamily(fontFamily: string): string {
  return /[^a-zA-Z0-9-]/.test(fontFamily) ? `"${fontFamily}"` : fontFamily;
}

/**
 * Produces every sprite replacement the selected style implies, across all
 * resolutions and the AOD tree. Untouched template entries are left alone.
 */
export async function buildStudioReplacements(
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const tintJobs: { file: CorosWatchfaceSpriteFile; color: string }[] = [];
  const labelColor = options.digitColor;

  for (const resolution of details.resolutions) {
    for (const folder of resolution.spriteFolders) {
      if (
        folder.kind === "digits" &&
        shouldRenderWatchfaceText("0123456789", options.fontFamily, options)
      ) {
        const color = folder.aod
          ? dimHexColor(options.digitColor, AOD_DIM_FACTOR)
          : options.digitColor;
        for (const [digit, file] of folder.files.entries()) {
          replacements.push({
            path: file.path,
            dataUrl: await renderWatchfaceTextSprite(
              String(digit),
              file.width,
              file.height,
              options.fontFamily,
              color,
              options
            )
          });
        }
      } else if (folder.kind === "week") {
        const color = folder.aod
          ? dimHexColor(labelColor, AOD_DIM_FACTOR)
          : labelColor;
        for (const [index, file] of folder.files.entries()) {
          const label = WEEKDAY_LABELS[index] ?? "DAY";
          if (rasterFontSupportsText(options.rasterFont, label)) {
            replacements.push({
              path: file.path,
              dataUrl: await renderRasterFontSprite(
                label,
                file.width,
                file.height,
                options.rasterFont!,
                color,
                options
              )
            });
          } else if (options.tintLabels) {
            tintJobs.push({ file, color });
          }
        }
      } else if (folder.kind === "month") {
        const color = folder.aod
          ? dimHexColor(labelColor, AOD_DIM_FACTOR)
          : labelColor;
        for (const [index, file] of folder.files.entries()) {
          const label =
            corosMonthLabelForSpriteIndex(index) ?? String(index);
          if (shouldRenderWatchfaceText(label, options.fontFamily, options)) {
            replacements.push({
              path: file.path,
              dataUrl: await renderWatchfaceTextSprite(
                label,
                file.width,
                file.height,
                options.fontFamily,
                color,
                options
              )
            });
          } else if (options.tintLabels) {
            tintJobs.push({ file, color });
          }
        }
      }
    }
    if (options.tintIcons) {
      for (const icon of resolution.icons) {
        const color = isAodSprite(icon)
          ? dimHexColor(options.accentColor, AOD_DIM_FACTOR)
          : options.accentColor;
        tintJobs.push({ file: icon, color });
      }
    }
  }

  if (tintJobs.length > 0) {
    const assets = await loadAssets([
      ...new Set(tintJobs.map((job) => job.file.path))
    ]);
    const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
    for (const job of tintJobs) {
      const asset = assetsByPath.get(job.file.path);
      if (!asset) {
        continue;
      }
      replacements.push({
        path: asset.path,
        dataUrl: await tintSprite(
          asset.dataUrl,
          asset.width,
          asset.height,
          job.color
        )
      });
    }
  }
  return replacements;
}

/** Counts what a style selection will regenerate, for the UI summary. */
export function summarizeStudioReplacements(
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions
): { digits: number; labels: number; icons: number } {
  let digits = 0;
  let labels = 0;
  let icons = 0;
  for (const resolution of details.resolutions) {
    for (const folder of resolution.spriteFolders) {
      if (
        folder.kind === "digits" &&
        shouldRenderWatchfaceText("0123456789", options.fontFamily, options)
      ) {
        digits += folder.files.length;
      } else if (folder.kind === "week") {
        labels += folder.files.filter(
          (_, index) =>
            rasterFontSupportsText(options.rasterFont, WEEKDAY_LABELS[index] ?? "DAY") ||
            options.tintLabels
        ).length;
      } else if (folder.kind === "month") {
        labels += folder.files.filter(
          (_, index) =>
            shouldRenderWatchfaceText(
              corosMonthLabelForSpriteIndex(index) ?? String(index),
              options.fontFamily,
              options
            ) || options.tintLabels
        ).length;
      }
    }
    if (options.tintIcons) {
      icons += resolution.icons.length;
    }
  }
  return { digits, labels, icons };
}

export interface WatchfaceLayoutOffset {
  dx: number;
  dy: number;
}

export interface WatchfaceLayoutGroup {
  id: string;
  label: string;
  patterns: RegExp[];
}

export type WatchfaceMetricId =
  | "battery"
  | "heartRate"
  | "steps"
  | "calories"
  | "elevation"
  | "temperature";

export interface WatchfaceMetricSpriteStyle {
  /** Absent preserves the template sprite color. */
  color?: string;
  /** Scale relative to the source template digit sprites. */
  scale: number;
  /** Optional per-layer font; falls back to the design font. */
  fontFamily?: string;
  /** Digit spacing for this component only; falls back to the design value. */
  letterSpacing?: number;
  /** A PNG set scoped to this component rather than the shared face font. */
  rasterFont?: CorosWatchfaceRasterFont;
  /** Preserve natural glyph width instead of fitting the template digit cell. */
  nativeSize?: boolean;
}

export type WatchfaceMetricStyles = Partial<
  Record<WatchfaceMetricId, WatchfaceMetricSpriteStyle>
>;

export type WatchfaceTimePartId = "hours" | "minutes" | "seconds" | "autoTime";

export type WatchfaceTimeStyles = Partial<
  Record<WatchfaceTimePartId, WatchfaceMetricSpriteStyle>
>;

export type WatchfaceDatePartId = "weekday" | "dateMonth" | "dateDay";

export interface WatchfaceDateSpriteStyle {
  /** Legacy artwork zoom used when exact dimensions are not set. */
  scale: number;
  /** Exact PNG canvas dimensions; omitted to use an imported PNG's native size. */
  width?: number;
  height?: number;
  /** Date-month rendering mode; absent preserves the starter's format. */
  monthFormat?: "digits" | "labels";
  /** Optional per-layer font; falls back to the design font. */
  fontFamily?: string;
  color?: string;
  /** Digit spacing for this component only; falls back to the design value. */
  letterSpacing?: number;
  /** A PNG set scoped to this date layer rather than the shared face font. */
  rasterFont?: CorosWatchfaceRasterFont;
  /** Weekday/date-day: use natural glyph width instead of the template canvas. */
  nativeSize?: boolean;
}

export type WatchfaceDateStyles = Partial<
  Record<WatchfaceDatePartId, WatchfaceDateSpriteStyle>
>;

interface WatchfaceDatePartDefinition {
  id: WatchfaceDatePartId;
  rectKey: string;
  fontKey: string;
  studioFolder: string;
  kind: "digits" | "week";
}

export const WATCHFACE_DATE_PARTS: WatchfaceDatePartDefinition[] = [
  {
    id: "weekday",
    rectKey: "english_date_week_rect",
    fontKey: "english_date_week_font",
    studioFolder: "cl_weekday",
    kind: "week"
  },
  {
    id: "dateMonth",
    rectKey: "english_date_month_rect",
    fontKey: "english_date_month_font",
    studioFolder: "cl_date_month",
    kind: "digits"
  },
  {
    id: "dateDay",
    rectKey: "english_date_day_rect",
    fontKey: "english_date_day_font",
    studioFolder: "cl_date_day",
    kind: "digits"
  }
];

/** Returns the stored native size of an imported PNG glyph or atlas cell. */
export function rasterFontNativeSpriteSize(
  rasterFont: CorosWatchfaceRasterFont | undefined,
  text: string
): { width: number; height: number } | null {
  if (!rasterFont) return null;
  const normalizedText = text.toUpperCase();
  const direct = rasterFont.spriteSizes?.[normalizedText];
  if (direct?.width && direct.height) {
    return { width: direct.width, height: direct.height };
  }
  const atlas = rasterFont.atlasSize;
  const glyphs = normalizeRasterFontGlyphs(rasterFont.glyphs);
  if (!atlas || normalizedText.length !== 1 || !glyphs.includes(normalizedText)) {
    return null;
  }
  const columns = Math.max(1, Math.min(glyphs.length, Math.round(rasterFont.columns)));
  const rows = Math.max(1, Math.ceil(glyphs.length / columns));
  return {
    width: Math.max(1, Math.round(atlas.width / columns)),
    height: Math.max(1, Math.round(atlas.height / rows))
  };
}

function dateMonthUsesLabels(
  source: Pick<CorosWatchfaceSpriteFolder, "kind"> | null | undefined,
  style: WatchfaceDateSpriteStyle | undefined
): boolean {
  return style?.monthFormat === "labels" ||
    (style?.monthFormat !== "digits" && source?.kind === "month");
}

/**
 * Resolves the actual exported canvas size for one month/day PNG.
 * Entered and imported dimensions are authored in the master resolution;
 * `nativeScale` (target width / master width) converts them to this tree.
 */
export function dateSpriteCanvasSize(
  resolution: CorosWatchfaceResolutionDetails,
  partId: WatchfaceDatePartId,
  style: WatchfaceDateSpriteStyle | undefined,
  value = 0,
  nativeScale = 1
): { width: number; height: number; native: boolean } | null {
  const part = WATCHFACE_DATE_PARTS.find((candidate) => candidate.id === partId);
  const source = part
    ? findSpriteFolder(resolution, resolution.config[part.fontKey])
    : null;
  const file = source?.files[value] ?? source?.files[0];
  if (!part || !file) return null;
  const spriteText = partId === "dateMonth" && dateMonthUsesLabels(source, style)
    ? corosMonthLabelForSpriteIndex(value) ?? String(value)
    : String(value);
  const imported = rasterFontNativeSpriteSize(style?.rasterFont, spriteText);
  const toTargetSize = (size: number) =>
    Math.max(1, Math.round(size * nativeScale));
  const requestedWidth = style?.width;
  const requestedHeight = style?.height;
  const exactWidth = typeof requestedWidth === "number" &&
      Number.isFinite(requestedWidth) && requestedWidth > 0
    ? toTargetSize(requestedWidth)
    : imported
      ? toTargetSize(imported.width)
      : undefined;
  const exactHeight = typeof requestedHeight === "number" &&
      Number.isFinite(requestedHeight) && requestedHeight > 0
    ? toTargetSize(requestedHeight)
    : imported
      ? toTargetSize(imported.height)
      : undefined;
  return {
    width: exactWidth ?? file.width,
    height: exactHeight ?? file.height,
    native: exactWidth !== undefined || exactHeight !== undefined
  };
}

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const WATCHFACE_MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
];

/**
 * COROS addresses label-month folders with calendar month numbers modulo 12:
 * 01=JAN through 11=NOV, while 00 wraps to DEC.
 */
export function corosMonthSpriteIndex(calendarMonthIndex: number): number {
  return ((Math.trunc(calendarMonthIndex) + 1) % 12 + 12) % 12;
}

/** Returns the calendar label stored at one COROS month-sprite file index. */
export function corosMonthLabelForSpriteIndex(
  spriteIndex: number
): string | null {
  const normalized = ((Math.trunc(spriteIndex) % 12) + 12) % 12;
  return WATCHFACE_MONTH_LABELS[(normalized + 11) % 12] ?? null;
}

/** COROS weekday sprites are indexed Monday=0 through Sunday=6. */
export function corosWeekdayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

interface WatchfaceTimePartDefinition {
  id: WatchfaceTimePartId;
  label: string;
  digits: {
    slot: "high" | "low";
    posKey: string;
    fontKey: string;
  }[];
}

export const WATCHFACE_TIME_PARTS: WatchfaceTimePartDefinition[] = [
  {
    id: "hours",
    label: "Hours",
    digits: [
      { slot: "high", posKey: "time_hour_high_pos", fontKey: "time_hour_high_font" },
      { slot: "low", posKey: "time_hour_low_pos", fontKey: "time_hour_low_font" }
    ]
  },
  {
    id: "minutes",
    label: "Minutes",
    digits: [
      { slot: "high", posKey: "time_minute_high_pos", fontKey: "time_minute_high_font" },
      { slot: "low", posKey: "time_minute_low_pos", fontKey: "time_minute_low_font" }
    ]
  },
  {
    id: "seconds",
    label: "Seconds",
    digits: [
      { slot: "high", posKey: "time_second_high_pos", fontKey: "time_second_high_font" },
      { slot: "low", posKey: "time_second_low_pos", fontKey: "time_second_low_font" }
    ]
  }
];

export type WatchfaceComplicationId =
  | "heartRate"
  | "steps"
  | "calories"
  | "floors"
  | "elevation"
  | "exercise"
  | "sunrise"
  | "sunset"
  | "battery"
  | "temperature";

interface WatchfaceFixedMetricDefinition {
  id: WatchfaceMetricId;
  label: string;
  rectKey: string;
  fontKey?: string;
  fontColorKey?: string;
  controlPrefix: string;
  sampleValue: string;
  maxDigits: number;
  center: { x: number; y: number };
}

interface WatchfaceComplicationDefinition {
  id: WatchfaceComplicationId;
  label: string;
  controlPrefix: string;
  sampleValue: string;
  /** Controls such as sunrise use separate hour and minute rectangles. */
  valueParts?: ReadonlyArray<{
    rectSuffix: "hour" | "minute";
    sampleValue: string;
  }>;
}

export const WATCHFACE_FIXED_METRICS: WatchfaceFixedMetricDefinition[] = [
  {
    id: "battery",
    label: "Battery data",
    rectKey: "battery_level_rect",
    fontKey: "battery_level_font",
    fontColorKey: "battery_level_font_color",
    controlPrefix: "battery",
    sampleValue: "82",
    maxDigits: 3,
    center: { x: 0.5, y: 0.9 }
  },
  {
    id: "heartRate",
    label: "Heart rate",
    // `heartreate` is the spelling used by COROS's source templates.
    rectKey: "heartreate_level_rect",
    fontKey: "heartreate_level_font",
    controlPrefix: "hr",
    sampleValue: "96",
    maxDigits: 3,
    center: { x: 0.25, y: 0.76 }
  },
  {
    id: "steps",
    label: "Steps",
    rectKey: "step_rect",
    fontKey: "step_font",
    controlPrefix: "step",
    sampleValue: "8420",
    maxDigits: 5,
    center: { x: 0.73, y: 0.76 }
  },
  {
    id: "calories",
    label: "Calories",
    rectKey: "kcal_rect",
    fontKey: "kcal_font",
    controlPrefix: "kcal",
    sampleValue: "534",
    maxDigits: 5,
    center: { x: 0.25, y: 0.86 }
  },
  {
    id: "elevation",
    label: "Elevation",
    rectKey: "elevation_rect",
    fontKey: "elevation_font",
    controlPrefix: "elevation",
    sampleValue: "1284",
    maxDigits: 5,
    center: { x: 0.73, y: 0.86 }
  },
  {
    id: "temperature",
    label: "Temperature",
    rectKey: "temperature_rect",
    fontKey: "temperature_font",
    fontColorKey: "temperature_font_color",
    controlPrefix: "temperature",
    sampleValue: "18",
    maxDigits: 3,
    center: { x: 0.5, y: 0.7 }
  }
];

const METRIC_STUDIO_FOLDERS: Record<WatchfaceMetricId, string> = {
  battery: "cl_battery",
  heartRate: "cl_hr",
  steps: "cl_steps",
  calories: "cl_kcal",
  elevation: "cl_elev",
  temperature: "cl_ftemp"
};

/**
 * Temporary experiment (July 2026): on-watch, every element backed by the
 * template's own files renders, while weather and temperature — the features
 * that depend on folders we create (`weather`, `cl_ftemp`) — do not. To test
 * whether the COROS pipeline drops newly created folders, this flag makes the
 * fixed temperature block reuse the template's existing digit folder with a
 * firmware color tint instead of generated `cl_ftemp` sprites. Trade-off
 * while enabled: the temperature size slider only scales the rect, not the
 * digits, and custom fonts don't apply to this block.
 */
export const TEMPERATURE_FONT_COMPAT = true;

function timeStudioFolder(
  part: WatchfaceTimePartId,
  slot: "high" | "low"
): string {
  if (part === "autoTime") return "cl_auto_time";
  const prefix = part === "hours" ? "h" : part === "minutes" ? "m" : "s";
  return `cl_${prefix}${slot === "high" ? "h" : "l"}`;
}

/** True when firmware lays out the complete HH:MM value inside one rectangle. */
export function hasAutoAlignedTime(
  resolution: CorosWatchfaceResolutionDetails
): boolean {
  return (
    resolution.config.watchface_time_format?.trim() === "1" &&
    parseConfigRect(resolution.config.autoalign_time_rect) !== null &&
    Boolean(resolution.config.autoalign_time_font?.trim())
  );
}

/**
 * Converts firmware's shared auto-aligned HH:MM block into the four position
 * keys used by normal digital faces. The original font and colon artwork are
 * reused, so conversion changes layout behavior without changing appearance.
 */
export function buildSeparateTimeOverrides(
  details: CorosWatchfaceTemplateDetails,
  enabled: boolean
): CorosWatchfaceConfigOverride[] {
  if (!enabled) return [];
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    if (!hasAutoAlignedTime(resolution)) continue;
    const rect = parseConfigRect(resolution.config.autoalign_time_rect);
    const font = resolution.config.autoalign_time_font?.trim();
    const source = findSpriteFolder(resolution, font);
    const sample = source?.files[0];
    if (!rect || !font || !sample) continue;

    const colonValue = resolution.config.autoalign_time_colon_icon?.trim();
    const colon = colonValue
      ? resolution.icons.find(
          (icon) =>
            icon.path ===
            `${resolution.directory}/${colonValue.replace(/\\/g, "/")}`
        )
      : undefined;
    const colonWidth = colon?.width ?? 0;
    const totalWidth = sample.width * 4 + colonWidth;
    const x = Math.round((rect.x0 + rect.x1 - totalWidth) / 2);
    const y = Math.round((rect.y0 + rect.y1 - sample.height) / 2);
    const values: Record<string, string> = {
      watchface_time_format: "0",
      time_hour_high_pos: `{${x},${y}}`,
      time_hour_high_font: font,
      time_hour_low_pos: `{${x + sample.width},${y}}`,
      time_hour_low_font: font,
      time_minute_high_pos: `{${x + sample.width * 2 + colonWidth},${y}}`,
      time_minute_high_font: font,
      time_minute_low_pos: `{${x + sample.width * 3 + colonWidth},${y}}`,
      time_minute_low_font: font
    };
    if (colonValue) values.colon_icon = colonValue;
    overrides.push({ path: `${resolution.directory}/config.txt`, values });
  }
  return overrides;
}

export const WATCHFACE_COMPLICATIONS: WatchfaceComplicationDefinition[] = [
  { id: "heartRate", label: "Heart rate", controlPrefix: "hr", sampleValue: "96" },
  { id: "steps", label: "Steps", controlPrefix: "step", sampleValue: "8420" },
  { id: "calories", label: "Calories", controlPrefix: "kcal", sampleValue: "534" },
  { id: "floors", label: "Floors", controlPrefix: "floor", sampleValue: "12" },
  { id: "elevation", label: "Elevation", controlPrefix: "elevation", sampleValue: "1284" },
  {
    id: "exercise",
    label: "Exercise",
    controlPrefix: "exercise",
    sampleValue: "1:24",
    valueParts: [
      { rectSuffix: "hour", sampleValue: "1" },
      { rectSuffix: "minute", sampleValue: "24" }
    ]
  },
  {
    id: "sunrise",
    label: "Sunrise",
    controlPrefix: "sunrise",
    sampleValue: "6:30",
    valueParts: [
      { rectSuffix: "hour", sampleValue: "6" },
      { rectSuffix: "minute", sampleValue: "30" }
    ]
  },
  {
    id: "sunset",
    label: "Sunset",
    controlPrefix: "sunset",
    sampleValue: "19:45",
    valueParts: [
      { rectSuffix: "hour", sampleValue: "19" },
      { rectSuffix: "minute", sampleValue: "45" }
    ]
  },
  { id: "battery", label: "Battery", controlPrefix: "battery", sampleValue: "82" },
  { id: "temperature", label: "Temperature", controlPrefix: "temperature", sampleValue: "18" }
];

export type WatchfaceMetricChanges = Partial<Record<WatchfaceMetricId, boolean>>;

export interface WatchfaceMetricCapability {
  id: WatchfaceMetricId;
  label: string;
  active: boolean;
}

/** Fixed metrics available to the editor and whether they are already active. */
export function getFixedMetricCapabilities(
  details: CorosWatchfaceTemplateDetails
): WatchfaceMetricCapability[] {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return [];
  }
  return WATCHFACE_FIXED_METRICS.flatMap((metric) => {
    // Battery can be added to templates that did not originally declare it;
    // buildMetricOverrides supplies both missing config entries when enabled.
    const canAdd = metric.id === "battery";
    const hasRect = Object.prototype.hasOwnProperty.call(
      resolution.config,
      metric.rectKey
    );
    const hasFont =
      !metric.fontKey ||
      metric.id === "temperature" ||
      Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey);
    return canAdd || (hasRect && hasFont)
      ? [{
          id: metric.id,
          label: metric.label,
          active: parseConfigRect(resolution.config[metric.rectKey]) !== null
        }]
      : [];
  });
}

/** Complication choices implemented by the template's control slot. */
export function getAvailableComplications(
  details: CorosWatchfaceTemplateDetails
): WatchfaceComplicationDefinition[] {
  const resolution = pickPreviewResolution(details);
  if (!resolution) {
    return [];
  }
  const hasControlSlot = Object.keys(resolution.config).some((key) =>
    /^rect_control\d+_pos$/.test(key)
  );
  return WATCHFACE_COMPLICATIONS.filter((complication) =>
    complication.id === "temperature" || complication.id === "battery"
      ? hasControlSlot
      : Boolean(
          (complication.valueParts
            ? complication.valueParts.every(({ rectSuffix }) =>
                parseConfigRect(
                  resolution.config[
                    `control_${complication.controlPrefix}_${rectSuffix}_rect`
                  ]
                )
              )
            : parseConfigRect(
                resolution.config[`control_${complication.controlPrefix}_rect`]
              )) &&
          findSpriteFolder(
            resolution,
            resolution.config[`control_${complication.controlPrefix}_font`]
          )
        )
  );
}

/** Whether the current-face config actually declares Battery as a selector choice. */
export function hasControlBattery(
  details: CorosWatchfaceTemplateDetails
): boolean {
  return details.resolutions.some((resolution) =>
    Object.keys(resolution.config).some((key) =>
      key.startsWith("control_battery_")
    )
  );
}

/** Removes control-battery from the firmware selector without affecting the fixed icon. */
export function buildControlBatteryVisibilityOverrides(
  details: CorosWatchfaceTemplateDetails,
  enabled: boolean | undefined
): CorosWatchfaceConfigOverride[] {
  if (enabled ?? hasControlBattery(details)) return [];
  return details.resolutions.flatMap((resolution) =>
    [
      { fileName: "config.txt", config: resolution.config },
      { fileName: "AODconfig.txt", config: resolution.aodConfig }
    ].flatMap(({ fileName, config }) => {
      const values = Object.fromEntries(
        Object.keys(config)
          .filter((key) => key.startsWith("control_battery_"))
          .map((key) => [key, COROS_CONFIG_DELETE_VALUE])
      );
      return Object.keys(values).length > 0
        ? [{ path: `${resolution.directory}/${fileName}`, values }]
        : [];
    })
  );
}

/** Moves selectable-control icons independently from their value rectangles. */
export function buildControlIconPositionOverrides(
  details: CorosWatchfaceTemplateDetails,
  offsets: Record<string, { dx: number; dy: number }>
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  return details.resolutions.flatMap((resolution) => {
    const scale = resolution.width / base.width;
    const values: Record<string, string> = {};
    for (const complication of WATCHFACE_COMPLICATIONS) {
      const offset = offsets[complication.id];
      if (!offset) {
        continue;
      }
      const key = `control_${complication.controlPrefix}_icon_pos`;
      const position = parseConfigPos(resolution.config[key]);
      if (!position) {
        continue;
      }
      const dx = Math.round(offset.dx * scale);
      const dy = Math.round(offset.dy * scale);
      values[key] = `{${position.x + dx},${position.y + dy}}`;
    }
    return Object.keys(values).length > 0
      ? [{ path: `${resolution.directory}/config.txt`, values }]
      : [];
  });
}

/**
 * Every `control_*` child coordinate is relative to `rect_controlN_pos`, and
 * stock templates keep all children non-negative. Icon drags can push a child
 * above/left of the origin, and negative child values are unproven on-watch
 * (COROS's pipeline may clamp or drop them). This rewrites the merged export
 * overrides so the origin absorbs any negative child offsets: absolute screen
 * positions are unchanged, but every child coordinate stays non-negative.
 */
export function rebaseNegativeControlChildren(
  details: CorosWatchfaceTemplateDetails,
  overrides: CorosWatchfaceConfigOverride[]
): CorosWatchfaceConfigOverride[] {
  const rebaseGroups: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const path = `${resolution.directory}/config.txt`;
    const overridden = overrides.find((entry) => entry.path === path)?.values;
    const effective: Record<string, string> = {
      ...resolution.config,
      ...(overridden ?? {})
    };
    const originKey = Object.keys(effective).find((key) =>
      /^rect_control\d+_pos$/.test(key)
    );
    const origin = parseConfigPos(originKey ? effective[originKey] : undefined);
    if (!originKey || !origin) {
      continue;
    }
    const childKeys = Object.keys(effective).filter(
      (key) =>
        /^control_[a-z0-9_]+_(icon_pos|rect)$/.test(key) &&
        offsetConfigValue(effective[key]!, 0, 0) !== null
    );
    let minX = 0;
    let minY = 0;
    for (const key of childKeys) {
      const pos = parseConfigPos(effective[key]);
      const rect = pos ? null : parseConfigRect(effective[key]);
      const x = pos?.x ?? rect?.x0;
      const y = pos?.y ?? rect?.y0;
      if (x === undefined || y === undefined) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }
    if (minX === 0 && minY === 0) {
      continue;
    }
    const shiftX = -minX;
    const shiftY = -minY;
    const values: Record<string, string> = {
      [originKey]: `{${origin.x - shiftX},${origin.y - shiftY}}`
    };
    for (const key of childKeys) {
      const shifted = offsetConfigValue(effective[key]!, shiftX, shiftY);
      if (shifted !== null) {
        values[key] = shifted;
      }
    }
    rebaseGroups.push({ path, values });
  }
  return rebaseGroups.length > 0
    ? mergeConfigOverrides(overrides, rebaseGroups)
    : overrides;
}

function controlTemperatureFontFolder(
  resolution: CorosWatchfaceResolutionDetails
): PreviewDigitSource | null {
  for (const key of [
    "control_temperature_font",
    "control_step_font",
    "time_second_high_font",
    "time_hour_high_font"
  ]) {
    const folder = findSpriteFolder(resolution, resolution.config[key]);
    if (folder) {
      return folder;
    }
  }
  const folder = resolution.spriteFolders.find(
    (candidate) => candidate.kind === "digits" && !candidate.aod
  );
  return folder
    ? { folder: folder.folder, kind: folder.kind, files: folder.files }
    : null;
}

/** Configures temperature for the selectable control slot, not the fixed block. */
export function buildControlTemperatureOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceMetricSpriteStyle,
  useStudioFolder = false
): CorosWatchfaceConfigOverride[] {
  return details.resolutions.flatMap((resolution) => {
    const hasControlSlot = Object.keys(resolution.config).some((key) =>
      /^rect_control\d+_pos$/.test(key)
    );
    const source = controlTemperatureFontFolder(resolution);
    if (!hasControlSlot || !source) {
      return [];
    }
    const ratio = resolution.width / 416;
    const defaultRect = resolution.config.control_step_rect ||
      `{${Math.round(35 * ratio)},0,${Math.round(145 * ratio)},${Math.round(35 * ratio)},hcenter|vcenter}`;
    const baseRect = resolution.config.control_temperature_rect || defaultRect;
    const values: Record<string, string> = {
      control_temperature_rect:
        scaleConfigRectValue(baseRect, style.scale) ?? defaultRect,
      control_temperature_font: useStudioFolder ? "cl_ctemp" : source.folder
    };
    if (style.color) {
      values.control_temperature_font_color = configHexColor(style.color);
    }
    const negative = resolution.config.control_negative_sign_icon ||
      resolution.icons.find((icon) => /negative/i.test(icon.path))?.path
        .slice(`${resolution.directory}/`.length)
        .replace(/\//g, "\\");
    if (negative) {
      values.control_negative_sign_icon = negative;
      if (
        Object.prototype.hasOwnProperty.call(
          resolution.config,
          "control_temperature_negative_sign_icon"
        )
      ) {
        values.control_temperature_negative_sign_icon = negative;
      }
    }
    const temperatureIcon = resolution.config.control_temperature_icon ||
      resolution.icons.find((icon) => /(?:temperature|temp)/i.test(icon.path))?.path
        .slice(`${resolution.directory}/`.length)
        .replace(/\//g, "\\");
    if (temperatureIcon) {
      values.control_temperature_icon = temperatureIcon;
      values.control_temperature_icon_pos =
        resolution.config.control_temperature_icon_pos ||
        `{${Math.round(5 * ratio)},${Math.round(4 * ratio)}}`;
    }
    return [{ path: `${resolution.directory}/config.txt`, values }];
  });
}

/** Generates the ten selectable-temperature digits in an isolated folder. */
export async function buildControlTemperatureSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceMetricSpriteStyle,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader,
  typography: WatchfaceTypography = {}
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: Array<{
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    create: boolean;
  }> = [];
  for (const resolution of details.resolutions) {
    const source = controlTemperatureFontFolder(resolution);
    if (!source) continue;
    const scale = normalizeSpriteScale(style.scale);
    source.files.slice(0, 10).forEach((file, digit) => {
      const path = `${resolution.directory}/cl_ctemp/${String(digit).padStart(2, "0")}.png`;
      jobs.push({
        source: file,
        path,
        digit,
        width: Math.max(1, Math.round(file.width * scale)),
        height: Math.max(1, Math.round(file.height * scale)),
        create: !resolution.spriteFolders.some((folder) =>
          folder.files.some((candidate) => candidate.path === path)
        )
      });
    });
  }
  const selectedFont = style.fontFamily ?? fontFamily;
  const spriteTypography = componentTypography(typography, style);
  const rasterized = shouldRenderWatchfaceText("0123456789", selectedFont, spriteTypography);
  const assets = rasterized
    ? []
    : await loadAssets([...new Set(jobs.map((job) => job.source.path))]);
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  return Promise.all(jobs.map(async (job) => ({
    path: job.path,
    create: job.create,
    dataUrl: rasterized
      ? await renderWatchfaceTextSprite(
          String(job.digit), job.width, job.height, selectedFont,
          style.color ?? "#ffffff", spriteTypography
        )
      : await resizeAndTintSprite(
          byPath.get(job.source.path)?.dataUrl ?? "",
          job.width,
          job.height,
          style.color
        )
  })));
}

/** Applies one isolated digit style to every implemented selectable value. */
export function buildSelectableMetricStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceMetricSpriteStyle,
  useStudioFolder = false
): CorosWatchfaceConfigOverride[] {
  const masterWidth = pickPreviewResolution(details)?.width;
  return details.resolutions.flatMap((resolution) => {
    const nativeScale = masterWidth ? resolution.width / masterWidth : 1;
    const values: Record<string, string> = {};
    for (const complication of WATCHFACE_COMPLICATIONS) {
      const rectKeys = complication.id === "battery"
        ? ["control_battery_level_rect"]
        : complication.valueParts
          ? complication.valueParts.map(
              ({ rectSuffix }) =>
                `control_${complication.controlPrefix}_${rectSuffix}_rect`
            )
          : [`control_${complication.controlPrefix}_rect`];
      const implementedRects = rectKeys.flatMap((key) => {
        const value = resolution.config[key];
        return value && parseConfigRect(value) ? [{ key, value }] : [];
      });
      if (implementedRects.length === 0) continue;
      const fontKey = complication.id === "battery"
        ? "control_battery_level_font"
        : `control_${complication.controlPrefix}_font`;
      const source = findSpriteFolder(resolution, resolution.config[fontKey]) ??
        controlTemperatureFontFolder(resolution);
      if (!source) continue;
      for (const rect of implementedRects) {
        if (style.nativeSize) {
          const parsed = parseConfigRect(rect.value);
          const sourceWidth = Math.max(
            1,
            ...source.files.slice(0, 10).map((file) => file.width)
          );
          const sourceHeight = Math.max(
            1,
            ...source.files.slice(0, 10).map((file) => file.height)
          );
          const importedSizes = Array.from({ length: 10 }, (_, digit) =>
            rasterFontNativeSpriteSize(style.rasterFont, String(digit))
          ).filter((size): size is NonNullable<typeof size> => Boolean(size));
          const scale = normalizeSpriteScale(style.scale);
          // Imported glyph PNGs are master-authored; template folders are
          // already sized for this tree.
          const nativeWidth = Math.max(
            1,
            Math.round(
              (importedSizes.length > 0
                ? Math.max(...importedSizes.map((size) => size.width)) *
                  nativeScale
                : sourceWidth) * scale
            )
          );
          const nativeHeight = Math.max(
            1,
            Math.round(
              (importedSizes.length > 0
                ? Math.max(...importedSizes.map((size) => size.height)) *
                  nativeScale
                : sourceHeight) * scale
            )
          );
          const glyphCount = parsed
            ? Math.max(1, Math.round((parsed.x1 - parsed.x0) / sourceWidth))
            : 1;
          values[rect.key] =
            resizeConfigRectToCanvas(
              rect.value,
              nativeWidth * glyphCount,
              nativeHeight
            ) ?? rect.value;
        } else {
          values[rect.key] =
            scaleConfigRectValue(rect.value, style.scale) ?? rect.value;
        }
      }
      values[fontKey] = useStudioFolder ? "cl_control" : source.folder;
      if (style.color) values[`${fontKey}_color`] = configHexColor(style.color);
    }
    return Object.keys(values).length > 0
      ? [{ path: `${resolution.directory}/config.txt`, values }]
      : [];
  });
}

export interface WatchfaceSelectableMetricSpriteComposition {
  replacements: CorosWatchfaceAssetReplacement[];
  /** Native-size value rectangles, centered on the template positions. */
  configOverrides: CorosWatchfaceConfigOverride[];
}

/**
 * Generates the shared ten-digit folder used by selectable control values and
 * expands their rectangles when natural-width rendering is enabled.
 */
export async function buildSelectableMetricSpriteComposition(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceMetricSpriteStyle,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader,
  typography: WatchfaceTypography = {}
): Promise<WatchfaceSelectableMetricSpriteComposition> {
  const jobs: Array<{
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    targetHeight: number;
    groupKey: string;
    create: boolean;
  }> = [];
  const masterWidth = pickPreviewResolution(details)?.width;
  for (const resolution of details.resolutions) {
    const source = controlTemperatureFontFolder(resolution);
    if (!source) continue;
    const nativeScale = masterWidth ? resolution.width / masterWidth : 1;
    const scale = normalizeSpriteScale(style.scale);
    source.files.slice(0, 10).forEach((file, digit) => {
      const path = `${resolution.directory}/cl_control/${String(digit).padStart(2, "0")}.png`;
      const importedSize = rasterFontNativeSpriteSize(
        style.rasterFont,
        String(digit)
      );
      jobs.push({
        source: file,
        path,
        digit,
        width: Math.max(1, Math.round(file.width * scale)),
        height: Math.max(1, Math.round(file.height * scale)),
        targetHeight: Math.max(
          1,
          Math.round(
            (importedSize
              ? importedSize.height * nativeScale
              : file.height) * scale
          )
        ),
        groupKey: resolution.directory,
        create: !resolution.spriteFolders.some((folder) =>
          folder.files.some((candidate) => candidate.path === path)
        )
      });
    });
  }
  const selectedFont = style.fontFamily ?? fontFamily;
  const spriteTypography = componentTypography(typography, style);
  const rasterized = shouldRenderWatchfaceText(
    "0123456789",
    selectedFont,
    spriteTypography
  );
  const assets = rasterized
    ? []
    : await loadAssets([...new Set(jobs.map((job) => job.source.path))]);
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  if (!style.nativeSize) {
    return {
      replacements: await Promise.all(jobs.map(async (job) => ({
        path: job.path,
        create: job.create,
        dataUrl: rasterized
          ? await renderWatchfaceTextSprite(
              String(job.digit), job.width, job.height, selectedFont,
              style.color ?? "#ffffff", spriteTypography
            )
          : await resizeAndTintSprite(
              byPath.get(job.source.path)?.dataUrl ?? "",
              job.width,
              job.height,
              style.color
            )
      }))),
      configOverrides: []
    };
  }

  const nativeGroups = new Map<
    string,
    Array<{ job: (typeof jobs)[number]; dataUrl: string; width: number; height: number }>
  >();
  for (const job of jobs) {
    const sourceDataUrl = byPath.get(job.source.path)?.dataUrl;
    if (!rasterized && !sourceDataUrl) continue;
    const dataUrl = rasterized
      ? await renderNativeWatchfaceTextSprite(
          String(job.digit),
          job.targetHeight,
          selectedFont,
          style.color ?? "#ffffff",
          spriteTypography
        )
      : await renderNativeRasterImageSprite(
          sourceDataUrl!,
          job.targetHeight,
          style.color,
          Boolean(style.color)
        );
    const image = await loadStudioImage(dataUrl);
    const group = nativeGroups.get(job.groupKey) ?? [];
    group.push({
      job,
      dataUrl,
      width: image.naturalWidth,
      height: image.naturalHeight
    });
    nativeGroups.set(job.groupKey, group);
  }

  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const configOverrides: CorosWatchfaceConfigOverride[] = [];
  for (const [directory, group] of nativeGroups) {
    const width = Math.max(...group.map((entry) => entry.width));
    const height = Math.max(...group.map((entry) => entry.height));
    for (const entry of group) {
      replacements.push({
        path: entry.job.path,
        dataUrl: await centerSpriteOnCanvas(entry.dataUrl, width, height),
        create: entry.job.create,
        allowDimensionOverride: true
      });
    }
    const resolution = details.resolutions.find(
      (candidate) => candidate.directory === directory
    );
    const source = resolution ? controlTemperatureFontFolder(resolution) : null;
    if (!resolution || !source) continue;
    const values: Record<string, string> = {};
    for (const complication of WATCHFACE_COMPLICATIONS) {
      const fontKey = complication.id === "battery"
        ? "control_battery_level_font"
        : `control_${complication.controlPrefix}_font`;
      const complicationSource =
        findSpriteFolder(resolution, resolution.config[fontKey]) ?? source;
      const sourceWidth = Math.max(
        1,
        ...complicationSource.files.slice(0, 10).map((file) => file.width)
      );
      const rectKeys = complication.id === "battery"
        ? ["control_battery_level_rect"]
        : complication.valueParts
          ? complication.valueParts.map(
              ({ rectSuffix }) =>
                `control_${complication.controlPrefix}_${rectSuffix}_rect`
            )
          : [`control_${complication.controlPrefix}_rect`];
      for (const rectKey of rectKeys) {
        const rectValue = resolution.config[rectKey];
        const rect = parseConfigRect(rectValue);
        if (!rectValue || !rect) continue;
        const glyphCount = Math.max(
          1,
          Math.round((rect.x1 - rect.x0) / sourceWidth)
        );
        const resized = resizeConfigRectToCanvas(
          rectValue,
          width * glyphCount,
          height
        );
        if (resized) values[rectKey] = resized;
      }
    }
    if (Object.keys(values).length > 0) {
      configOverrides.push({
        path: `${resolution.directory}/config.txt`,
        values
      });
    }
  }
  return { replacements, configOverrides };
}

/** Generates only selectable-control sprites for callers that do not need geometry. */
export async function buildSelectableMetricSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  style: WatchfaceMetricSpriteStyle,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader,
  typography: WatchfaceTypography = {}
): Promise<CorosWatchfaceAssetReplacement[]> {
  return (
    await buildSelectableMetricSpriteComposition(
      details,
      style,
      fontFamily,
      loadAssets,
      typography
    )
  ).replacements;
}

function metricFontFolder(
  resolution: CorosWatchfaceResolutionDetails,
  metric: WatchfaceFixedMetricDefinition
): PreviewDigitSource | null {
  const candidates = [
    metric.fontKey ? resolution.config[metric.fontKey] : undefined,
    resolution.config[`control_${metric.controlPrefix}_font`],
    resolution.config["control_step_font"],
    resolution.config["time_second_high_font"],
    resolution.config["time_hour_high_font"]
  ];
  for (const candidate of candidates) {
    const folder = findSpriteFolder(resolution, candidate);
    if (folder) {
      return folder;
    }
  }
  const folder = resolution.spriteFolders.find(
    (candidate) => candidate.kind === "digits" && !candidate.aod
  );
  return folder
    ? { folder: folder.folder, kind: folder.kind, files: folder.files }
    : null;
}

function configHexColor(color: string): string {
  return `0x${color.replace(/^#/, "").toUpperCase()}`;
}

/** Activates or removes fixed live metrics in every template resolution. */
export function buildMetricOverrides(
  details: CorosWatchfaceTemplateDetails,
  changes: WatchfaceMetricChanges
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const metric of WATCHFACE_FIXED_METRICS) {
      const enabled = changes[metric.id];
      if (
        metric.id === "temperature" &&
        enabled === undefined &&
        parseConfigRect(resolution.config.temperature_rect)
      ) {
        const font = metricFontFolder(resolution, metric);
        // Compat mode ignores a configured folder that may not exist in the
        // template (e.g. a baked `cl_ftemp` from an earlier round trip);
        // metricFontFolder only returns folders present in the archive.
        values.temperature_font = TEMPERATURE_FONT_COMPAT
          ? font?.folder ?? "13x19"
          : resolution.config.temperature_font || font?.folder || "13x19";
        if (
          !resolution.config.temperature_negative_sign_icon &&
          Object.prototype.hasOwnProperty.call(
            resolution.config,
            "temperature_negative_sign_icon"
          )
        ) {
          values.temperature_negative_sign_icon = "icon\\negative.png";
        }
        continue;
      }
      if (
        enabled === undefined ||
        (metric.id !== "battery" &&
          !Object.prototype.hasOwnProperty.call(resolution.config, metric.rectKey)) ||
        (metric.fontKey &&
          metric.id !== "battery" &&
          metric.id !== "temperature" &&
          !Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey))
      ) {
        continue;
      }
      if (!enabled) {
        values[metric.rectKey] = "";
        if (
          metric.fontKey &&
          Object.prototype.hasOwnProperty.call(resolution.config, metric.fontKey)
        ) {
          values[metric.fontKey] = "";
        }
        continue;
      }
      if (metric.id === "temperature") {
        const reference = { width: 416, x0: 34, y0: 312, x1: 164, y1: 356 };
        const ratio = resolution.width / reference.width;
        values[metric.rectKey] = `{${Math.round(reference.x0 * ratio)},${Math.round(reference.y0 * ratio)},${Math.round(reference.x1 * ratio)},${Math.round(reference.y1 * ratio)},hcenter|vcenter}`;
        const font = metricFontFolder(resolution, metric);
        values.temperature_font = font?.folder ?? "13x19";
        if (Object.prototype.hasOwnProperty.call(resolution.config, "temperature_negative_sign_icon")) {
          values.temperature_negative_sign_icon = "icon\\negative.png";
        }
        continue;
      }
      const font = metricFontFolder(resolution, metric);
      const sample = font?.files[0];
      if (!font || !sample) {
        continue;
      }
      const rectWidth = sample.width * metric.maxDigits;
      const rectHeight = sample.height;
      const centerX = Math.round(resolution.width * metric.center.x);
      const centerY = Math.round(resolution.height * metric.center.y);
      const x0 = Math.max(0, Math.round(centerX - rectWidth / 2));
      const y0 = Math.max(0, Math.round(centerY - rectHeight / 2));
      const x1 = Math.min(resolution.width, x0 + rectWidth);
      const y1 = Math.min(resolution.height, y0 + rectHeight);
      values[metric.rectKey] = `{${x0},${y0},${x1},${y1},hcenter|vcenter}`;
      if (metric.fontKey) {
        values[metric.fontKey] = font.folder;
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Scales a firmware rect around its center while preserving alignment flags. */
export function scaleConfigRectValue(value: string, scale: number): string | null {
  const match = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (!match) {
    return null;
  }
  const x0 = Number(match[1]);
  const y0 = Number(match[2]);
  const x1 = Number(match[3]);
  const y1 = Number(match[4]);
  const normalizedScale = normalizeSpriteScale(scale);
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const width = Math.max(1, Math.round((x1 - x0) * normalizedScale));
  const height = Math.max(1, Math.round((y1 - y0) * normalizedScale));
  const nextX0 = Math.round(centerX - width / 2);
  const nextY0 = Math.round(centerY - height / 2);
  return `{${nextX0},${nextY0},${nextX0 + width},${nextY0 + height}${match[5]}}`;
}

/** Resizes a firmware rect around its center to exact native pixel dimensions. */
export function resizeConfigRectValue(
  value: string,
  width: number,
  height: number
): string | null {
  const match = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (!match) return null;
  const centerX = (Number(match[1]) + Number(match[3])) / 2;
  const centerY = (Number(match[2]) + Number(match[4])) / 2;
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  const x0 = Math.round(centerX - nextWidth / 2);
  const y0 = Math.round(centerY - nextHeight / 2);
  return `{${x0},${y0},${x0 + nextWidth},${y0 + nextHeight}${match[5]}}`;
}

/**
 * Config changes for per-metric sprite sizes. Export mode also points each
 * metric at its dedicated generated bitmap folder.
 */
export function buildMetricStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceMetricStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const metric of WATCHFACE_FIXED_METRICS) {
      const style = styles[metric.id];
      const rect = style
        ? scaleConfigRectValue(resolution.config[metric.rectKey] ?? "", style.scale)
        : null;
      if (!style || !rect || !metricFontFolder(resolution, metric)) {
        continue;
      }
      values[metric.rectKey] = rect;
      if (useStudioFolders && metric.fontKey) {
        values[metric.fontKey] =
          metric.id === "temperature" && TEMPERATURE_FONT_COMPAT
            ? metricFontFolder(resolution, metric)!.folder
            : METRIC_STUDIO_FOLDERS[metric.id];
      }
      if (metric.fontColorKey && style.color) {
        // Generated digit sprites are pre-colored, so a firmware tint would
        // recolor them twice. In compat mode temperature reuses the
        // template's own digits and needs the tint.
        values[metric.fontColorKey] =
          metric.id === "temperature" && !TEMPERATURE_FONT_COMPAT
            ? ""
            : configHexColor(style.color);
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Generates an isolated ten-digit bitmap folder for every customized metric. */
export async function buildMetricSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceMetricStyles,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader,
  typography: WatchfaceTypography = {}
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    color?: string;
    fontFamily: string;
    typography: WatchfaceTypography;
    rasterized: boolean;
    create: boolean;
  }[] = [];
  for (const resolution of details.resolutions) {
    for (const metric of WATCHFACE_FIXED_METRICS) {
      if (metric.id === "temperature" && TEMPERATURE_FONT_COMPAT) {
        continue;
      }
      const style = styles[metric.id];
      const rect = parseConfigRect(resolution.config[metric.rectKey]);
      const source = style ? metricFontFolder(resolution, metric) : null;
      if (!style || !rect || !source) {
        continue;
      }
      const normalizedScale = normalizeSpriteScale(style.scale);
      const metricFontFamily = style.fontFamily ?? fontFamily;
      const metricTypography = componentTypography(typography, style);
      source.files.slice(0, 10).forEach((file, digit) => {
        const path = `${resolution.directory}/${METRIC_STUDIO_FOLDERS[metric.id]}/${String(digit).padStart(2, "0")}.png`;
        const existsInTemplate = resolution.spriteFolders.some((folder) =>
          folder.files.some((candidate) => candidate.path === path)
        );
        jobs.push({
          source: file,
          path,
          digit,
          width: Math.max(1, Math.round(file.width * normalizedScale)),
          height: Math.max(1, Math.round(file.height * normalizedScale)),
          color: style.color,
          fontFamily: metricFontFamily,
          typography: metricTypography,
          rasterized: shouldRenderWatchfaceText(
            String(digit),
            metricFontFamily,
            metricTypography
          ),
          create: !existsInTemplate
        });
      });
    }
  }
  const sourceAssets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.rasterized).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(sourceAssets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const dataUrl = job.rasterized
      ? await renderWatchfaceTextSprite(
          String(job.digit),
          job.width,
          job.height,
          job.fontFamily,
          job.color ??
            ("digitColor" in typography && typeof typography.digitColor === "string"
              ? typography.digitColor
              : "#ffffff"),
          job.typography
        )
      : await resizeAndTintSprite(
          assetsByPath.get(job.source.path)?.dataUrl ?? "",
          job.width,
          job.height,
          job.color
        );
    replacements.push({ path: job.path, dataUrl, create: job.create });
  }
  return replacements;
}

/** Resizes time-part positions around each two-digit group's own center. */
export function buildTimeStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceTimeStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    const autoStyle = styles.autoTime;
    if (autoStyle && hasAutoAlignedTime(resolution)) {
      const rect = scaleConfigRectValue(
        resolution.config.autoalign_time_rect ?? "",
        autoStyle.scale
      );
      if (rect) values.autoalign_time_rect = rect;
      if (useStudioFolders) {
        values.autoalign_time_font = timeStudioFolder("autoTime", "high");
      }
    }
    for (const part of WATCHFACE_TIME_PARTS) {
      const style = styles[part.id];
      if (!style) {
        continue;
      }
      const planned = part.digits.flatMap((digit) => {
        const pos = parseConfigPos(resolution.config[digit.posKey]);
        const source = findSpriteFolder(resolution, resolution.config[digit.fontKey]);
        const sample = source?.files[0];
        return pos && source && sample ? [{ digit, pos, source, sample }] : [];
      });
      if (planned.length !== part.digits.length) {
        continue;
      }
      const x0 = Math.min(...planned.map((item) => item.pos.x));
      const y0 = Math.min(...planned.map((item) => item.pos.y));
      const x1 = Math.max(...planned.map((item) => item.pos.x + item.sample.width));
      const y1 = Math.max(...planned.map((item) => item.pos.y + item.sample.height));
      const centerX = (x0 + x1) / 2;
      const centerY = (y0 + y1) / 2;
      const normalizedScale = normalizeSpriteScale(style.scale);
      for (const item of planned) {
        const x = Math.round(centerX + (item.pos.x - centerX) * normalizedScale);
        const y = Math.round(centerY + (item.pos.y - centerY) * normalizedScale);
        values[item.digit.posKey] = `{${x},${y}}`;
        if (useStudioFolders) {
          values[item.digit.fontKey] = timeStudioFolder(
            part.id,
            item.digit.slot
          );
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/**
 * The firmware positions each time digit independently, so canvas text
 * tracking alone cannot alter their gap. Move the high and low slots away
 * from (or toward) each other to make the editor's digit-spacing setting real
 * both in preview and in the final archive.
 */
export function buildTimeTrackingOverrides(
  details: CorosWatchfaceTemplateDetails,
  letterSpacing: number,
  styles: WatchfaceTimeStyles = {}
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const part of WATCHFACE_TIME_PARTS) {
      const partSpacing = Math.max(
        -0.35,
        Math.min(0.25, styles[part.id]?.letterSpacing ?? letterSpacing)
      );
      if (Math.abs(partSpacing) < 0.001) {
        continue;
      }
      const scale = normalizeSpriteScale(styles[part.id]?.scale);
      for (const digit of part.digits) {
        const position = parseConfigPos(resolution.config[digit.posKey]);
        const sample = findSpriteFolder(
          resolution,
          resolution.config[digit.fontKey]
        )?.files[0];
        if (!position || !sample) {
          continue;
        }
        const offset = Math.round((sample.height * scale * partSpacing) / 2);
        const direction = digit.slot === "high" ? -1 : 1;
        values[digit.posKey] = `{${position.x + direction * offset},${position.y}}`;
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Generates isolated high/low digit folders for customized time parts. */
export async function buildTimeSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceTimeStyles,
  fontFamily: string,
  loadAssets: WatchfaceAssetLoader,
  typography: WatchfaceTypography = {}
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    digit: number;
    width: number;
    height: number;
    color?: string;
    fontFamily: string;
    typography: WatchfaceTypography;
    rasterized: boolean;
  }[] = [];
  for (const resolution of details.resolutions) {
    const autoStyle = styles.autoTime;
    const autoSource = autoStyle && hasAutoAlignedTime(resolution)
      ? findSpriteFolder(resolution, resolution.config.autoalign_time_font)
      : null;
    if (autoStyle && autoSource) {
      const normalizedScale = normalizeSpriteScale(autoStyle.scale);
      const partFontFamily = autoStyle.fontFamily ?? fontFamily;
      const partTypography = componentTypography(typography, autoStyle);
      autoSource.files.slice(0, 10).forEach((file, value) => {
        jobs.push({
          source: file,
          path: `${resolution.directory}/${timeStudioFolder("autoTime", "high")}/${String(value).padStart(2, "0")}.png`,
          digit: value,
          width: Math.max(1, Math.round(file.width * normalizedScale)),
          height: Math.max(1, Math.round(file.height * normalizedScale)),
          color: autoStyle.color,
          fontFamily: partFontFamily,
          typography: partTypography,
          rasterized: shouldRenderWatchfaceText(
            String(value),
            partFontFamily,
            partTypography
          )
        });
      });
    }
    for (const part of WATCHFACE_TIME_PARTS) {
      const style = styles[part.id];
      if (!style) {
        continue;
      }
      const normalizedScale = normalizeSpriteScale(style.scale);
      const partFontFamily = style.fontFamily ?? fontFamily;
      const partTypography = componentTypography(typography, style);
      for (const digit of part.digits) {
        const source = findSpriteFolder(resolution, resolution.config[digit.fontKey]);
        if (!source) {
          continue;
        }
        source.files.slice(0, 10).forEach((file, value) => {
          jobs.push({
            source: file,
            path: `${resolution.directory}/${timeStudioFolder(part.id, digit.slot)}/${String(value).padStart(2, "0")}.png`,
            digit: value,
            width: Math.max(1, Math.round(file.width * normalizedScale)),
            height: Math.max(1, Math.round(file.height * normalizedScale)),
            color: style.color,
            fontFamily: partFontFamily,
            typography: partTypography,
            rasterized: shouldRenderWatchfaceText(
              String(value),
              partFontFamily,
              partTypography
            )
          });
        });
      }
    }
  }
  const sourceAssets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.rasterized).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(sourceAssets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const job of jobs) {
    const dataUrl = job.rasterized
      ? await renderWatchfaceTextSprite(
          String(job.digit),
          job.width,
          job.height,
          job.fontFamily,
          job.color ??
            ("digitColor" in typography && typeof typography.digitColor === "string"
              ? typography.digitColor
              : "#ffffff"),
          job.typography
        )
      : await resizeAndTintSprite(
          assetsByPath.get(job.source.path)?.dataUrl ?? "",
          job.width,
          job.height,
          job.color
        );
    replacements.push({ path: job.path, dataUrl, create: true });
  }
  return replacements;
}

/** Isolates date sprite folders and follows exact PNG dimensions when present. */
export function buildDateStyleOverrides(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceDateStyles,
  useStudioFolders = false
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  const masterWidth = pickPreviewResolution(details)?.width;
  for (const resolution of details.resolutions) {
    const nativeScale = masterWidth ? resolution.width / masterWidth : 1;
    const values: Record<string, string> = {};
    for (const part of WATCHFACE_DATE_PARTS) {
      const style = styles[part.id];
      const source = findSpriteFolder(resolution, resolution.config[part.fontKey]);
      if (!style || !source) {
        continue;
      }
      const monthLabels = part.id === "dateMonth" && dateMonthUsesLabels(source, style);
      const sizes = part.kind === "digits"
        ? Array.from({ length: monthLabels ? 12 : 10 }, (_, value) =>
            dateSpriteCanvasSize(resolution, part.id, style, value, nativeScale)
          )
            .filter((size): size is NonNullable<typeof size> => Boolean(size))
        : [];
      const followsNativeSize = sizes.some((size) => size.native);
      const rect = followsNativeSize
        ? resizeConfigRectValue(
            resolution.config[part.rectKey] ?? "",
            Math.max(...sizes.map((size) => size.width)) * (monthLabels ? 1 : 2),
            Math.max(...sizes.map((size) => size.height))
          )
        : resolution.config[part.rectKey];
      if (!rect) continue;
      values[part.rectKey] = rect;
      if (style.color) {
        const colorKey = part.fontKey.replace(/_font$/, "_font_color");
        if (
          Object.prototype.hasOwnProperty.call(resolution.config, colorKey)
        ) {
          values[colorKey] = configHexColor(style.color);
        }
      }
      if (useStudioFolders) {
        values[part.fontKey] = part.studioFolder;
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

export interface WatchfaceDateSpriteComposition {
  replacements: CorosWatchfaceAssetReplacement[];
  /** Native-size weekday rectangles, centered on the template position. */
  configOverrides: CorosWatchfaceConfigOverride[];
}

/** Resizes a firmware rectangle around its center without clamping to the face. */
export function resizeConfigRectToCanvas(
  value: string,
  width: number,
  height: number
): string | null {
  const match = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (!match) {
    return null;
  }
  const centerX = (Number(match[1]) + Number(match[3])) / 2;
  const centerY = (Number(match[2]) + Number(match[4])) / 2;
  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const x0 = Math.round(centerX - normalizedWidth / 2);
  const y0 = Math.round(centerY - normalizedHeight / 2);
  return `{${x0},${y0},${x0 + normalizedWidth},${y0 + normalizedHeight}${match[5]}}`;
}

/** Generates isolated date sprites and any native-size date rectangles. */
export async function buildDateSpriteComposition(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceDateStyles,
  options: Pick<
    WatchfaceStudioOptions,
    "fontFamily" | "digitColor" | "tintLabels" | "fontWeight" | "fontStyle" | "letterSpacing" | "rasterFont"
  >,
  loadAssets: WatchfaceAssetLoader
): Promise<WatchfaceDateSpriteComposition> {
  const jobs: {
    source: CorosWatchfaceSpriteFile;
    path: string;
    value: number;
    width: number;
    height: number;
    kind: "digits" | "week" | "month";
    text: string;
    fontFamily: string;
    typography: WatchfaceTypography;
    rasterized: boolean;
    color?: string;
    zoom: number;
    exactCanvas: boolean;
    nativeSize: boolean;
    configPath: string;
    groupKey: string;
    rectKey: string;
    rectValue: string;
    rectGlyphCount: number;
    create: boolean;
  }[] = [];
  const masterWidth = pickPreviewResolution(details)?.width;
  for (const resolution of details.resolutions) {
    const nativeScale = masterWidth ? resolution.width / masterWidth : 1;
    for (const part of WATCHFACE_DATE_PARTS) {
      const style = styles[part.id];
      const source = style
        ? findSpriteFolder(resolution, resolution.config[part.fontKey])
        : null;
      if (!style || !source) {
        continue;
      }
      const partFontFamily = style.fontFamily ?? options.fontFamily;
      const partTypography = componentTypography(options, style);
      const normalizedScale = normalizeSpriteScale(style.scale);
      const monthLabels = part.id === "dateMonth" && dateMonthUsesLabels(source, style);
      const limit = part.kind === "week" ? 7 : monthLabels ? 12 : 10;
      Array.from({ length: limit }, (_, value) => ({
        value,
        file: source.files[value] ?? source.files[0]
      })).forEach(({ file, value }) => {
        if (!file) return;
        const path = `${resolution.directory}/${part.studioFolder}/${String(value).padStart(2, "0")}.png`;
        const existsInTemplate = resolution.spriteFolders.some((folder) =>
          folder.files.some((candidate) => candidate.path === path)
        );
        const canvasSize = part.kind === "digits"
          ? dateSpriteCanvasSize(resolution, part.id, style, value, nativeScale)
          : null;
        jobs.push({
          source: file,
          path,
          value,
          width: canvasSize?.width ?? file.width,
          height: canvasSize?.height ?? file.height,
          kind: monthLabels ? "month" : part.kind,
          text: monthLabels
            ? corosMonthLabelForSpriteIndex(value) ?? String(value)
            : part.kind === "week"
              ? WEEKDAY_LABELS[value] ?? String(value)
              : String(value),
          fontFamily: partFontFamily,
          typography: partTypography,
          rasterized: shouldRenderWatchfaceText(
            monthLabels
              ? corosMonthLabelForSpriteIndex(value) ?? String(value)
              : part.kind === "week"
                ? WEEKDAY_LABELS[value] ?? String(value)
                : String(value),
            partFontFamily,
            partTypography
          ),
          color: style.color,
          zoom: normalizedScale,
          exactCanvas: canvasSize?.native ?? false,
          nativeSize:
            !canvasSize?.native &&
            (part.id === "weekday" || part.id === "dateDay") &&
            (style.nativeSize ??
              Boolean(style.fontFamily || style.rasterFont)),
          configPath: `${resolution.directory}/config.txt`,
          groupKey: `${resolution.directory}/config.txt|${part.rectKey}`,
          rectKey: part.rectKey,
          rectValue: resolution.config[part.rectKey]!,
          rectGlyphCount: part.id === "dateDay" ? 2 : 1,
          create: !existsInTemplate
        });
      });
    }
  }
  const assets = await loadAssets([
    ...new Set(
      jobs.filter((job) => !job.rasterized).map((job) => job.source.path)
    )
  ]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  const nativeGroups = new Map<
    string,
    Array<{
      job: (typeof jobs)[number];
      dataUrl: string;
      width: number;
      height: number;
    }>
  >();
  for (const job of jobs) {
    const asset = assetsByPath.get(job.source.path);
    if (!asset && !job.rasterized) {
      continue;
    }
    if (job.nativeSize) {
      const targetHeight = Math.max(1, Math.round(job.height * job.zoom));
      const dataUrl = job.rasterized
        ? await renderNativeWatchfaceTextSprite(
            job.kind === "week"
              ? WEEKDAY_LABELS[job.value] ?? String(job.value)
              : String(job.value),
            targetHeight,
            job.fontFamily,
            job.color ?? options.digitColor,
            job.typography
          )
        : await renderNativeRasterImageSprite(
            asset!.dataUrl,
            targetHeight,
            job.color ??
              (job.kind === "week" && options.tintLabels
                ? options.digitColor
                : undefined),
            Boolean(
              job.color ||
                (job.kind === "week" && options.tintLabels)
            )
          );
      const image = await loadStudioImage(dataUrl);
      const group = nativeGroups.get(job.groupKey) ?? [];
      group.push({
        job,
        dataUrl,
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      nativeGroups.set(job.groupKey, group);
      continue;
    }
    const baseDataUrl = job.rasterized
      ? await renderWatchfaceTextSprite(
          job.text,
          job.width,
          job.height,
          job.fontFamily,
          job.color ?? options.digitColor,
          job.typography
        )
      : await resizeAndTintSprite(
          asset!.dataUrl,
          job.width,
          job.height,
          job.color ??
            (job.kind !== "digits" && options.tintLabels
              ? options.digitColor
              : undefined)
        );
    const dataUrl = job.exactCanvas
      ? baseDataUrl
      : await fitVisibleSpriteToCanvas(
          baseDataUrl,
          job.width,
          job.height,
          job.zoom
        );
    replacements.push({
      path: job.path,
      dataUrl,
      create: job.create,
      ...(job.exactCanvas ? { allowDimensionOverride: true } : {})
    });
  }

  const configOverrides: CorosWatchfaceConfigOverride[] = [];
  for (const group of nativeGroups.values()) {
    const width = Math.max(...group.map((entry) => entry.width));
    const height = Math.max(...group.map((entry) => entry.height));
    for (const entry of group) {
      replacements.push({
        path: entry.job.path,
        dataUrl: await centerSpriteOnCanvas(entry.dataUrl, width, height),
        create: entry.job.create,
        allowDimensionOverride: true
      });
    }
    const first = group[0]!;
    const rect = resizeConfigRectToCanvas(
      first.job.rectValue,
      width * first.job.rectGlyphCount,
      height
    );
    if (rect) {
      configOverrides.push({
        path: first.job.configPath,
        values: { [first.job.rectKey]: rect }
      });
    }
  }
  return { replacements, configOverrides };
}

/** Generates isolated date sprites in the template's firmware-native canvases. */
export async function buildDateSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  styles: WatchfaceDateStyles,
  options: Pick<
    WatchfaceStudioOptions,
    "fontFamily" | "digitColor" | "tintLabels" | "fontWeight" | "fontStyle" | "letterSpacing" | "rasterFont"
  >,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  return (
    await buildDateSpriteComposition(details, styles, options, loadAssets)
  ).replacements;
}

/** Applies config overrides to a details copy for live previewing. */
export function applyConfigOverridesToDetails(
  details: CorosWatchfaceTemplateDetails,
  overrides: CorosWatchfaceConfigOverride[]
): CorosWatchfaceTemplateDetails {
  const byPath = new Map(overrides.map((entry) => [entry.path, entry.values]));
  const applyValues = (
    config: Record<string, string>,
    values: Record<string, string>
  ) => {
    const next = { ...config };
    for (const [key, value] of Object.entries(values)) {
      if (value === COROS_CONFIG_DELETE_VALUE) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    return next;
  };
  return {
    ...details,
    resolutions: details.resolutions.map((resolution) => {
      const values = byPath.get(`${resolution.directory}/config.txt`);
      const aodValues = byPath.get(`${resolution.directory}/AODconfig.txt`);
      return values || aodValues
        ? {
            ...resolution,
            ...(values
              ? { config: applyValues(resolution.config, values) }
              : {}),
            ...(aodValues
              ? { aodConfig: applyValues(resolution.aodConfig, aodValues) }
              : {})
          }
        : resolution;
    })
  };
}

/** Combines independent config edits into one entry per config file. */
export function mergeConfigOverrides(
  ...groups: CorosWatchfaceConfigOverride[][]
): CorosWatchfaceConfigOverride[] {
  const merged = new Map<string, Record<string, string>>();
  for (const group of groups) {
    for (const override of group) {
      merged.set(override.path, {
        ...(merged.get(override.path) ?? {}),
        ...override.values
      });
    }
  }
  return [...merged].map(([path, values]) => ({ path, values }));
}

/**
 * Coalesces sprite jobs that target the same archive path. Later groups win,
 * allowing component-specific styling to override a global font/tint pass.
 */
export function mergeAssetReplacements(
  ...groups: CorosWatchfaceAssetReplacement[][]
): CorosWatchfaceAssetReplacement[] {
  const merged = new Map<string, CorosWatchfaceAssetReplacement>();
  for (const group of groups) {
    for (const replacement of group) {
      merged.set(replacement.path, replacement);
    }
  }
  return [...merged.values()];
}

/**
 * Movable element groups, matched against the template's own config keys.
 * Positions (`{x,y}`) and rects (`{x0,y0,x1,y1,align}`) are both shiftable.
 */
export const WATCHFACE_LAYOUT_GROUPS: WatchfaceLayoutGroup[] = [
  {
    id: "autoTime",
    label: "Time",
    patterns: [/^autoalign_time_rect$/]
  },
  {
    id: "hours",
    label: "Hour digits",
    patterns: [/^time_hour_(high|low)_pos$/]
  },
  {
    id: "minutes",
    label: "Minute digits",
    patterns: [/^time_minute_(high|low)_pos$/]
  },
  {
    id: "seconds",
    label: "Seconds",
    patterns: [/^time_second_(high|low)_pos$/]
  },
  {
    id: "weekday",
    label: "Weekday",
    patterns: [/^[a-z_]+_date_week_rect$/]
  },
  {
    id: "dateMonth",
    label: "Date month",
    patterns: [/^[a-z_]+_date_month_rect$/]
  },
  {
    id: "dateDay",
    label: "Date day",
    patterns: [/^[a-z_]+_date_day_rect$/]
  },
  {
    id: "separators",
    label: "Time & date separators",
    patterns: [/^arc_cut_icon_pos$/]
  },
  {
    id: "battery",
    label: "Battery data",
    patterns: [/^battery_level_rect$/]
  },
  {
    id: "batteryIcon",
    label: "Battery icon",
    patterns: [/^battery_icon_pos$/]
  },
  {
    id: "complication",
    label: "Selectable metric",
    // Child control positions are relative to this origin. Moving both the
    // origin and every child would apply the offset twice on the watch.
    patterns: [/^rect_control\d+_pos$/]
  },
  ...CONTROL_STATUS_PREVIEW_DEFINITIONS.map(
    ({ layoutGroupId, label, positionKey }) => ({
      id: layoutGroupId,
      label,
      patterns: [new RegExp(`^${positionKey}$`)]
    })
  ),
  {
    id: "heartRate",
    label: "Heart rate",
    patterns: [/^heartreate_level_rect$/]
  },
  {
    id: "steps",
    label: "Steps",
    patterns: [/^step_rect$/]
  },
  {
    id: "calories",
    label: "Calories",
    patterns: [/^kcal_rect$/]
  },
  {
    id: "elevation",
    label: "Elevation",
    patterns: [/^elevation_rect$/]
  },
  {
    id: "temperature",
    label: "Temperature",
    patterns: [/^temperature_rect$/]
  }
];

/** Shifts a `{x,y}` or `{x0,y0,x1,y1,…}` config value, keeping other syntax. */
export function offsetConfigValue(
  value: string,
  dx: number,
  dy: number
): string | null {
  const pos = value.match(/^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}$/);
  if (pos) {
    return `{${Number(pos[1]) + dx},${Number(pos[2]) + dy}}`;
  }
  const rect = value.match(
    /^\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*((?:,[^}]*)?)\}$/
  );
  if (rect) {
    return `{${Number(rect[1]) + dx},${Number(rect[2]) + dy},${Number(rect[3]) + dx},${Number(rect[4]) + dy}${rect[5]}}`;
  }
  return null;
}

/** The config keys of one resolution that a layout group would move. */
export function layoutGroupKeys(
  resolution: CorosWatchfaceResolutionDetails,
  group: WatchfaceLayoutGroup
): string[] {
  const autoAligned = hasAutoAlignedTime(resolution);
  if (
    (group.id === "autoTime" && !autoAligned) ||
    ((group.id === "hours" || group.id === "minutes") && autoAligned)
  ) {
    return [];
  }
  return Object.keys(resolution.config).filter(
    (key) =>
      group.patterns.some((pattern) => pattern.test(key)) &&
      offsetConfigValue(resolution.config[key]!, 0, 0) !== null
  );
}

/**
 * Turns per-group pixel offsets (in the largest resolution's coordinates)
 * into config.txt overrides for every resolution, scaled proportionally.
 * The AOD layout is intentionally left untouched.
 */
export function buildLayoutOverrides(
  details: CorosWatchfaceTemplateDetails,
  offsets: Record<string, WatchfaceLayoutOffset>
): CorosWatchfaceConfigOverride[] {
  const base = pickPreviewResolution(details);
  if (!base) {
    return [];
  }
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const scale = resolution.width / base.width;
    const values: Record<string, string> = {};
    for (const group of WATCHFACE_LAYOUT_GROUPS) {
      const offset = offsets[group.id];
      if (!offset || (offset.dx === 0 && offset.dy === 0)) {
        continue;
      }
      const dx = Math.round(offset.dx * scale);
      const dy = Math.round(offset.dy * scale);
      if (dx === 0 && dy === 0) {
        continue;
      }
      for (const key of layoutGroupKeys(resolution, group)) {
        const shifted = offsetConfigValue(resolution.config[key]!, dx, dy);
        if (shifted !== null) {
          values[key] = shifted;
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Hides firmware-backed editor layers by clearing their position/rect keys. */
export function buildLayerVisibilityOverrides(
  details: CorosWatchfaceTemplateDetails,
  visibility: Record<string, boolean>
): CorosWatchfaceConfigOverride[] {
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const group of WATCHFACE_LAYOUT_GROUPS) {
      if (visibility[group.id] !== false) {
        continue;
      }
      for (const key of layoutGroupKeys(resolution, group)) {
        values[key] = "";
      }
      if (group.id === "separators") {
        for (const key of ["colon_icon", "arc_cut_icon"]) {
          if (Object.prototype.hasOwnProperty.call(resolution.config, key)) {
            values[key] = "";
          }
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Applies color fields supported directly by COROS firmware config entries. */
export function buildLayerColorOverrides(
  details: CorosWatchfaceTemplateDetails,
  colors: Record<string, string>
): CorosWatchfaceConfigOverride[] {
  const colorKeys: Record<string, RegExp[]> = {
    autoTime: [/^autoalign_time_font_color$/],
    hours: [/^time_hour_(high|low)_font_color$/],
    minutes: [/^time_minute_(high|low)_font_color$/],
    seconds: [/^time_second_(high|low)_font_color$/],
    weekday: [/^[a-z_]+_date_week_font_color$/],
    dateMonth: [/^[a-z_]+_date_month_font_color$/],
    dateDay: [/^[a-z_]+_date_day_font_color$/],
    battery: [/^battery_level_font_color$/],
    complication: [/^control_[a-z_]+_font_color$/]
  };
  const overrides: CorosWatchfaceConfigOverride[] = [];
  for (const resolution of details.resolutions) {
    const values: Record<string, string> = {};
    for (const [layerId, patterns] of Object.entries(colorKeys)) {
      const color = colors[layerId];
      if (!color) {
        continue;
      }
      for (const key of Object.keys(resolution.config)) {
        if (patterns.some((pattern) => pattern.test(key))) {
          values[key] = configHexColor(color);
        }
      }
    }
    if (Object.keys(values).length > 0) {
      overrides.push({ path: `${resolution.directory}/config.txt`, values });
    }
  }
  return overrides;
}

/** Tints icon-backed layers whose firmware config has no direct color field. */
export async function buildLayerColorSpriteReplacements(
  details: CorosWatchfaceTemplateDetails,
  colors: Record<string, string>,
  loadAssets: WatchfaceAssetLoader
): Promise<CorosWatchfaceAssetReplacement[]> {
  const jobs = new Map<string, { file: CorosWatchfaceSpriteFile; color: string }>();
  for (const resolution of details.resolutions) {
    const addIcon = (value: string | undefined, color: string | undefined) => {
      if (!value || !color) {
        return;
      }
      const path = `${resolution.directory}/${value.replace(/\\/g, "/")}`;
      const file = resolution.icons.find((entry) => entry.path === path);
      if (file) {
        jobs.set(file.path, { file, color });
      }
    };
    addIcon(resolution.config["colon_icon"], colors.separators);
    addIcon(resolution.config["autoalign_time_colon_icon"], colors.separators);
    addIcon(resolution.config["arc_cut_icon"], colors.separators);
    if (colors.complication) {
      for (const [key, value] of Object.entries(resolution.config)) {
        if (/^control_[a-z_]+_icon$/.test(key)) {
          addIcon(value, colors.complication);
        }
      }
    }
  }
  const assets = await loadAssets([...jobs.keys()]);
  const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const replacements: CorosWatchfaceAssetReplacement[] = [];
  for (const [path, job] of jobs) {
    const asset = assetsByPath.get(path);
    if (!asset) {
      continue;
    }
    replacements.push({
      path,
      dataUrl: await tintSprite(
        asset.dataUrl,
        job.file.width,
        job.file.height,
        job.color
      )
    });
  }
  return replacements;
}

export interface WatchfaceLayoutGroupBounds {
  id: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WatchfaceLayoutOffsetLimits {
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

/**
 * The screen region each movable group occupies, in resolution coordinates.
 * Rect keys carry their own box; position keys are extended by the sprite
 * size they reference (digit font folder or icon file).
 */
export function computeLayoutGroupBounds(
  resolution: CorosWatchfaceResolutionDetails
): WatchfaceLayoutGroupBounds[] {
  const bounds: WatchfaceLayoutGroupBounds[] = [];
  for (const group of WATCHFACE_LAYOUT_GROUPS) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const controlStatusDefinition =
      CONTROL_STATUS_PREVIEW_DEFINITIONS.find(
        (definition) => definition.layoutGroupId === group.id
      );
    if (controlStatusDefinition) {
      const layer = getWatchfaceControlStatusPreviewLayers(resolution).find(
        (candidate) => candidate.layoutGroupId === group.id
      );
      if (layer) {
        bounds.push({
          id: group.id,
          label: group.label,
          x0: layer.position.x,
          y0: layer.position.y,
          x1: layer.position.x + layer.source.width,
          y1: layer.position.y + layer.source.height
        });
      }
      continue;
    }
    if (group.id === "complication") {
      const originKey = Object.keys(resolution.config).find((key) =>
        /^rect_control\d+_pos$/.test(key)
      );
      const origin = parseConfigPos(originKey ? resolution.config[originKey] : undefined);
      if (origin) {
        for (const [key, value] of Object.entries(resolution.config)) {
          if (/^control_[a-z_]+_rect$/.test(key)) {
            const rect = parseConfigRect(value);
            if (rect) {
              x0 = Math.min(x0, origin.x + rect.x0);
              y0 = Math.min(y0, origin.y + rect.y0);
              x1 = Math.max(x1, origin.x + rect.x1);
              y1 = Math.max(y1, origin.y + rect.y1);
            }
          } else if (/^control_[a-z_]+_icon_pos$/.test(key)) {
            const pos = parseConfigPos(value);
            if (pos) {
              const size = spriteSizeForPosKey(resolution, key);
              x0 = Math.min(x0, origin.x + pos.x);
              y0 = Math.min(y0, origin.y + pos.y);
              x1 = Math.max(x1, origin.x + pos.x + size.width);
              y1 = Math.max(y1, origin.y + pos.y + size.height);
            }
          }
        }
      }
      if (x0 < x1 && y0 < y1) {
        bounds.push({ id: group.id, label: group.label, x0, y0, x1, y1 });
      }
      continue;
    }
    for (const key of layoutGroupKeys(resolution, group)) {
      const value = resolution.config[key]!;
      const rect = parseConfigRect(value);
      if (rect) {
        if (
          group.id === "dateMonth" &&
          rect.x0 === rect.x1 &&
          rect.y0 === rect.y1
        ) {
          const source = findSpriteFolder(
            resolution,
            resolution.config.english_date_month_font
          );
          if (source?.kind === "month" && source.files.length > 0) {
            const width = Math.max(...source.files.map((file) => file.width));
            const height = Math.max(...source.files.map((file) => file.height));
            x0 = Math.min(x0, rect.x0 - width / 2);
            y0 = Math.min(y0, rect.y0 - height / 2);
            x1 = Math.max(x1, rect.x0 + width / 2);
            y1 = Math.max(y1, rect.y0 + height / 2);
            continue;
          }
        }
        x0 = Math.min(x0, rect.x0);
        y0 = Math.min(y0, rect.y0);
        x1 = Math.max(x1, rect.x1);
        y1 = Math.max(y1, rect.y1);
        continue;
      }
      const pos = parseConfigPos(value);
      if (pos) {
        const size = spriteSizeForPosKey(resolution, key);
        x0 = Math.min(x0, pos.x);
        y0 = Math.min(y0, pos.y);
        x1 = Math.max(x1, pos.x + size.width);
        y1 = Math.max(y1, pos.y + size.height);
      }
    }
    if (x0 < x1 && y0 < y1) {
      bounds.push({ id: group.id, label: group.label, x0, y0, x1, y1 });
    }
  }
  return bounds;
}

/**
 * Per-element movement limits that let a component touch every screen edge
 * while keeping its complete bounding box on the face.
 */
export function computeLayoutOffsetLimits(
  resolution: CorosWatchfaceResolutionDetails
): Record<string, WatchfaceLayoutOffsetLimits> {
  return Object.fromEntries(
    computeLayoutGroupBounds(resolution).map((box) => [
      box.id,
      {
        minDx: -box.x0,
        maxDx: resolution.width - box.x1,
        minDy: -box.y0,
        maxDy: resolution.height - box.y1
      }
    ])
  );
}

/** The smallest movable group containing the point, if any. */
export function layoutGroupAtPoint(
  bounds: WatchfaceLayoutGroupBounds[],
  x: number,
  y: number
): WatchfaceLayoutGroupBounds | null {
  return bounds
    .filter((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1)
    .sort(
      (left, right) =>
        (left.x1 - left.x0) * (left.y1 - left.y0) -
        (right.x1 - right.x0) * (right.y1 - right.y0)
    )[0] ?? null;
}

function spriteSizeForPosKey(
  resolution: CorosWatchfaceResolutionDetails,
  posKey: string
): { width: number; height: number } {
  if (posKey.endsWith("_icon_pos")) {
    const iconValue = resolution.config[posKey.replace(/_pos$/, "")];
    if (iconValue) {
      const iconPath = `${resolution.directory}/${iconValue.replace(/\\/g, "/")}`;
      const icon = resolution.icons.find((entry) => entry.path === iconPath);
      if (icon) {
        return { width: icon.width, height: icon.height };
      }
    }
    const iconDir = resolution.config[posKey.replace(/_pos$/, "_dir")]
      ?.replace(/\\/g, "/");
    const state = iconDir
      ? resolution.spriteFolders.find(
          (folder) => folder.kind === "state" && folder.folder === iconDir
        )?.files[0]
      : undefined;
    if (state) {
      return { width: state.width, height: state.height };
    }
  } else {
    const fontValue = resolution.config[posKey.replace(/_pos$/, "_font")];
    const folder = fontValue
      ? resolution.spriteFolders.find(
          (candidate) => candidate.folder === fontValue.replace(/\\/g, "/")
        )
      : undefined;
    const file = folder?.files[0];
    if (file) {
      return { width: file.width, height: file.height };
    }
  }
  return { width: 40, height: 40 };
}

/** Applies layout offsets to a copy of the details, for the live preview. */
export function applyLayoutToDetails(
  details: CorosWatchfaceTemplateDetails,
  offsets: Record<string, WatchfaceLayoutOffset>
): CorosWatchfaceTemplateDetails {
  const overrides = buildLayoutOverrides(details, offsets);
  if (overrides.length === 0) {
    return details;
  }
  const overridesByPath = new Map(
    overrides.map((override) => [override.path, override.values])
  );
  return {
    ...details,
    resolutions: details.resolutions.map((resolution) => {
      const values = overridesByPath.get(`${resolution.directory}/config.txt`);
      return values
        ? { ...resolution, config: { ...resolution.config, ...values } }
        : resolution;
    })
  };
}

/** The master resolution used for authoring and proportional config changes. */
export function pickPreviewResolution(
  details: CorosWatchfaceTemplateDetails
): CorosWatchfaceResolutionDetails | null {
  return (
    [...details.resolutions].sort((left, right) => right.width - left.width)[0] ??
    null
  );
}

/**
 * The physical watch tree used for a device preview. COROS MIP bundles can
 * contain 240, 260, 280 and 800px trees for several watches; APEX-style
 * 240/260/800 bundles default to the 46 mm 260px target. The user can still
 * switch to any other tree in Studio.
 */
export function pickWatchPreviewResolution(
  details: CorosWatchfaceTemplateDetails
): CorosWatchfaceResolutionDetails | null {
  const resolutions = [...details.resolutions];
  const widths = new Set(resolutions.map((resolution) => resolution.width));
  if (widths.has(240) && widths.has(260) && widths.has(800)) {
    return resolutions.find((resolution) => resolution.width === 260) ?? null;
  }
  const deviceResolutions = resolutions.filter(
    (resolution) => resolution.width < 800 && resolution.height < 800
  );
  return (
    deviceResolutions.sort((left, right) => right.width - left.width)[0] ??
    pickPreviewResolution(details)
  );
}

/** Restricts rendering helpers to one native device config without mutating it. */
export function detailsForPreviewResolution(
  details: CorosWatchfaceTemplateDetails,
  directory: string
): CorosWatchfaceTemplateDetails {
  const resolution = details.resolutions.find(
    (candidate) => candidate.directory === directory
  );
  return resolution ? { ...details, resolutions: [resolution] } : details;
}

/** Template artwork candidates, ordered from the on-watch image to previews. */
export function getTemplateBackgroundAssetPaths(
  details: CorosWatchfaceTemplateDetails
): string[] {
  const resolution = pickPreviewResolution(details);
  return [
    ...(resolution
      ? [
          `${resolution.directory}/background.png`,
          `${resolution.directory}/watchface_customize.png`
        ]
      : []),
    "watchface_customize.png"
  ];
}

interface PreviewDigitSource {
  folder: string;
  kind: CorosWatchfaceSpriteFolder["kind"];
  files: CorosWatchfaceSpriteFile[];
}

function findSpriteFolder(
  resolution: CorosWatchfaceResolutionDetails,
  folderName: string | undefined
): PreviewDigitSource | null {
  if (!folderName) {
    return null;
  }
  const normalized = folderName.replace(/\\/g, "/");
  const folder = resolution.spriteFolders.find(
    (candidate) => candidate.folder === normalized
  );
  return folder
    ? { folder: folder.folder, kind: folder.kind, files: folder.files }
    : null;
}

function drawStudioLayerImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  previewScale: number,
  options: WatchfaceStudioOptions,
  layerId?: string
): void {
  const effects = layerId
    ? resolveWatchfaceLayerEffects(options, layerId)
    : [];
  if (effects.length === 0) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.ceil(width));
  source.height = Math.max(1, Math.ceil(height));
  const sourceContext = source.getContext("2d", { colorSpace: "display-p3" });
  if (!sourceContext) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = "high";
  sourceContext.drawImage(image, 0, 0, width, height);
  const rendered = renderWatchfaceCanvasEffects(
    source,
    effects,
    watchfaceEffectRenderScale(
      previewScale,
      options.effectResolutionScale ?? 1
    ),
    true
  );
  context.drawImage(
    rendered.canvas,
    x - rendered.padding.left,
    y - rendered.padding.top
  );
}

/**
 * Draws a live preview of the face: the canvas background plus the actual
 * sprites the watch will render, placed with the template's own layout keys.
 */
export async function drawStudioPreview(
  canvas: HTMLCanvasElement,
  backgroundDataUrl: string,
  details: CorosWatchfaceTemplateDetails,
  options: WatchfaceStudioOptions,
  loadAssets: WatchfaceAssetLoader
): Promise<void> {
  const resolution = pickPreviewResolution(details);
  // Match the wide-gamut background canvas; an sRGB preview canvas would
  // clamp P3 artwork colors and render them darker than the source image.
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!resolution || !context) {
    return;
  }
  const scale = canvas.width / resolution.width;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    await loadStudioImage(backgroundDataUrl, false),
    0,
    0,
    canvas.width,
    canvas.height
  );

  const config = resolution.config;
  const now = new Date();
  const weekdayIndex = corosWeekdayIndex(now.getDay());
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  const wantedSprites = new Map<string, { color: string | null }>();
  const digitPlan: {
    pos: { x: number; y: number } | null;
    source: PreviewDigitSource | null;
    digit: number;
    partId?: WatchfaceTimePartId;
    slot?: "high" | "low";
    componentId: string;
  }[] = [];
  const timeKeys: [string, string, string, WatchfaceTimePartId][] = [
    ["time_hour_high_pos", "time_hour_high_font", hour[0]!, "hours"],
    ["time_hour_low_pos", "time_hour_low_font", hour[1]!, "hours"],
    ["time_minute_high_pos", "time_minute_high_font", minute[0]!, "minutes"],
    ["time_minute_low_pos", "time_minute_low_font", minute[1]!, "minutes"]
  ];
  const autoAlignedTime = hasAutoAlignedTime(resolution);
  if (!autoAlignedTime) {
    for (const [posKey, fontKey, digitText, partId] of timeKeys) {
      const source = findSpriteFolder(resolution, config[fontKey]);
      digitPlan.push({
        pos: parseConfigPos(config[posKey]),
        source,
        digit: Number(digitText),
        partId,
        slot: posKey.includes("_high_") ? "high" : "low",
        componentId: partId
      });
    }
  }
  for (const [posKey, fontKey, digitText, slot] of [
    ["time_second_high_pos", "time_second_high_font", second[0]!, "high"],
    ["time_second_low_pos", "time_second_low_font", second[1]!, "low"]
  ] as const) {
    digitPlan.push({
      pos: parseConfigPos(config[posKey]),
      source: findSpriteFolder(resolution, config[fontKey]),
      digit: Number(digitText),
      partId: "seconds",
      slot,
      componentId: "seconds"
    });
  }
  const colonValue = !autoAlignedTime
    ? config["colon_icon"]?.replace(/\\/g, "/")
    : undefined;
  const colonPath = colonValue ? `${resolution.directory}/${colonValue}` : null;
  const colonFile = colonPath
    ? resolution.icons.find((icon) => icon.path === colonPath) ?? null
    : null;
  const separatorIconColor = options.layerColors?.separators ??
    (options.tintIcons ? options.accentColor : null);
  if (colonFile) {
    wantedSprites.set(colonFile.path, {
      color: separatorIconColor
    });
  }
  const arcCutValue = config["arc_cut_icon"]?.replace(/\\/g, "/");
  const arcCutPath = arcCutValue
    ? `${resolution.directory}/${arcCutValue}`
    : null;
  const arcCutFile = arcCutPath
    ? resolution.icons.find((icon) => icon.path === arcCutPath) ?? null
    : null;
  const arcCutPos = parseConfigPos(config["arc_cut_icon_pos"]);
  if (arcCutFile) {
    wantedSprites.set(arcCutFile.path, {
      color: separatorIconColor
    });
  }
  const analogLayers = getWatchfaceAnalogPreviewLayers(resolution, now);
  const analogIconColor = options.tintIcons ? options.accentColor : null;
  for (const layer of analogLayers) {
    wantedSprites.set(layer.source.path, { color: analogIconColor });
  }

  const ampmIcons = options.ampmStyle?.enabled ? findAmPmIcons(resolution) : null;
  const ampmFile = ampmIcons
    ? now.getHours() < 12
      ? ampmIcons.am
      : ampmIcons.pm
    : null;
  if (ampmFile && !wantedSprites.has(ampmFile.path)) {
    wantedSprites.set(ampmFile.path, { color: null });
  }

  // Weekday label: sprite order inside week folders is firmware-defined, so
  // the preview simply shows one representative label sprite.
  const weekSource = findSpriteFolder(
    resolution,
    config["english_date_week_font"]
  );
  const weekRect = parseConfigRect(config["english_date_week_rect"]);
  const weekFile = weekSource?.files[weekdayIndex] ?? weekSource?.files[0];
  const weekColor =
    options.dateStyles?.weekday?.color ??
    options.layerColors?.weekday ??
    (options.tintLabels ? options.digitColor : null);
  if (weekFile) {
    wantedSprites.set(weekFile.path, { color: weekColor });
  }

  // COROS supports a second month format: one 00.png–11.png image per month.
  const monthSource = findSpriteFolder(
    resolution,
    config["english_date_month_font"]
  );
  const monthUsesLabels = dateMonthUsesLabels(
    monthSource,
    options.dateStyles?.dateMonth
  );
  const monthIndex = now.getMonth();
  const monthSpriteIndex = corosMonthSpriteIndex(monthIndex);
  const monthRect = monthUsesLabels
    ? parseConfigRect(config["english_date_month_rect"])
    : null;
  const monthFile = monthUsesLabels
    ? monthSource?.kind === "month"
      ? monthSource.files[monthSpriteIndex] ?? monthSource.files[0]
      : monthSource?.files[0]
    : null;
  const monthColor = options.dateStyles?.dateMonth?.color ??
    options.layerColors?.dateMonth ??
    (options.tintLabels ? options.digitColor : null);
  if (monthFile) {
    wantedSprites.set(monthFile.path, { color: monthColor });
  }

  const batteryOverride = options.configAssetOverrides?.["config:battery_icon"];
  const importedBatteryStates = Object.entries(
    batteryOverride?.stateReplacements ?? {}
  )
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right));
  const importedBatteryState =
    importedBatteryStates[batteryPreviewStateIndex(importedBatteryStates.length)] ??
    (batteryOverride?.replacement ? ["0", batteryOverride.replacement] as const : null);
  const batteryFolderName = config.battery_icon_dir?.replace(/\\/g, "/");
  const batteryFolder =
    (batteryFolderName
      ? resolution.spriteFolders.find(
          (folder) => folder.kind === "state" && folder.folder === batteryFolderName
        )
      : undefined) ?? null;
  // Prefer a normal high-charge state; the last entries can represent special
  // charging/low-power states in COROS's 12-image battery sets.
  const batteryFileIndex = batteryFolder
    ? batteryPreviewStateIndex(batteryFolder.files.length)
    : Number(importedBatteryState?.[0] ?? 0);
  const batteryReplacement =
    batteryOverride?.stateReplacements?.[String(batteryFileIndex)] ??
    importedBatteryState?.[1] ??
    batteryOverride?.replacement;
  const batteryFile = batteryFolder?.files[batteryFileIndex] ??
    (batteryReplacement
      ? {
          path: "",
          width: batteryReplacement.width,
          height: batteryReplacement.height
        }
      : null);
  const batteryRect = parseConfigRect(config["battery_level_rect"]);
  const batteryIconPos = parseConfigPos(config.battery_icon_pos) ??
    (batteryFile && batteryRect
      ? {
          x: Math.max(0, batteryRect.x0 - batteryFile.width - Math.round(resolution.width * 0.012)),
          y: batteryRect.y0 + Math.round((batteryRect.y1 - batteryRect.y0 - batteryFile.height) / 2)
        }
      : null);
  if (batteryFile && batteryFolder) {
    wantedSprites.set(batteryFile.path, { color: null });
  }
  const controlBatteryOverride =
    options.configAssetOverrides?.["config:control_battery_icon"];
  const importedControlBatteryStates = Object.entries(
    controlBatteryOverride?.stateReplacements ?? {}
  )
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([left], [right]) => Number(left) - Number(right));
  const importedControlBatteryState =
    importedControlBatteryStates[
      batteryPreviewStateIndex(importedControlBatteryStates.length)
    ] ??
    (controlBatteryOverride?.replacement
      ? ["0", controlBatteryOverride.replacement] as const
      : null);
  const controlBatteryFolderName =
    config.control_battery_icon_dir?.replace(/\\/g, "/");
  const controlBatteryFolder =
    (controlBatteryFolderName
      ? resolution.spriteFolders.find(
          (folder) =>
            folder.kind === "state" &&
            folder.folder === controlBatteryFolderName
        )
      : undefined) ??
    resolution.spriteFolders.find(
      (folder) =>
        folder.kind === "state" &&
        folder.folder.replace(/^a\//, "") === "battery"
    ) ??
    null;
  const controlBatteryFileIndex = controlBatteryFolder
    ? batteryPreviewStateIndex(controlBatteryFolder.files.length)
    : Number(importedControlBatteryState?.[0] ?? 0);
  const controlBatteryReplacement =
    controlBatteryOverride?.stateReplacements?.[
      String(controlBatteryFileIndex)
    ] ??
    importedControlBatteryState?.[1] ??
    controlBatteryOverride?.replacement;
  const controlBatteryFile =
    controlBatteryFolder?.files[controlBatteryFileIndex] ??
    (controlBatteryReplacement
      ? {
          path: "",
          width: controlBatteryReplacement.width,
          height: controlBatteryReplacement.height
        }
      : null);
  if (controlBatteryFile && controlBatteryFolder) {
    wantedSprites.set(controlBatteryFile.path, { color: null });
  }

  const controlStatusLayers =
    getWatchfaceControlStatusPreviewLayers(resolution);
  const controlStatusIconColor =
    options.layerColors?.complication ??
    (options.tintIcons ? options.accentColor : null);
  for (const layer of controlStatusLayers) {
    wantedSprites.set(layer.source.path, { color: controlStatusIconColor });
  }

  const availableComplications = getAvailableComplications(details);
  const complication =
    availableComplications.find((item) => item.id === options.previewComplication) ??
    availableComplications[0] ??
    null;
  const complicationPrefix = complication?.controlPrefix;
  const controlOriginKey = Object.keys(config).find((key) =>
    /^rect_control\d+_pos$/.test(key)
  );
  const controlOrigin = parseConfigPos(
    controlOriginKey ? config[controlOriginKey] : undefined
  ) ?? { x: 0, y: 0 };
  const relativeComplicationRects = complicationPrefix && complication
    ? (complication.valueParts ?? [{ rectSuffix: null, sampleValue: complication.sampleValue }])
        .flatMap(({ rectSuffix, sampleValue }) => {
          const key = complication.id === "battery"
            ? "control_battery_level_rect"
            : rectSuffix
              ? `control_${complicationPrefix}_${rectSuffix}_rect`
              : `control_${complicationPrefix}_rect`;
          const rect = parseConfigRect(config[key]);
          return rect ? [{ rect, sampleValue }] : [];
        })
    : [];
  const relativeComplicationRect = relativeComplicationRects[0]?.rect ?? null;
  const complicationSource = complicationPrefix
    ? findSpriteFolder(
        resolution,
        complication?.id === "battery"
          ? config.control_battery_level_font
          : config[`control_${complicationPrefix}_font`]
      )
    : null;
  const complicationIconValue = complicationPrefix
    ? complication?.id === "battery"
      ? undefined
      : config[`control_${complicationPrefix}_icon`]?.replace(/\\/g, "/")
    : undefined;
  const complicationIconPath = complicationIconValue
    ? `${resolution.directory}/${complicationIconValue}`
    : null;
  const complicationIcon = complicationIconPath
    ? resolution.icons.find((icon) => icon.path === complicationIconPath) ?? null
    : complication?.id === "battery"
      ? controlBatteryFile
      : null;
  const configuredComplicationIconPos = complicationPrefix
    ? parseConfigPos(
        config[`control_${complicationPrefix}_icon_pos`]
      )
    : null;
  const relativeComplicationIconPos = configuredComplicationIconPos ??
    (complication?.id === "battery" && relativeComplicationRect
      ? {
          x: Math.max(0, relativeComplicationRect.x0 - Math.round(resolution.width * 0.05)),
          y: relativeComplicationRect.y0
        }
      : null);
  const complicationIconPos = relativeComplicationIconPos
    ? {
        x: relativeComplicationIconPos.x + controlOrigin.x,
        y: relativeComplicationIconPos.y + controlOrigin.y
      }
    : null;
  if (complicationIcon) {
    const complicationIconColor = options.layerColors?.complication ??
      (options.tintIcons ? options.accentColor : null);
    wantedSprites.set(complicationIcon.path, {
      color: complicationIconColor
    });
  }
  const controlColonValue = config.control_colon_icon?.replace(/\\/g, "/");
  const controlColonPath = controlColonValue
    ? `${resolution.directory}/${controlColonValue}`
    : null;
  const controlColonFile = controlColonPath
    ? resolution.icons.find((icon) => icon.path === controlColonPath) ?? null
    : null;
  if (controlColonFile && relativeComplicationRects.length > 1) {
    wantedSprites.set(controlColonFile.path, {
      color: options.layerColors?.complication ??
        (options.tintIcons ? options.accentColor : null)
    });
  }

  const numberPlans: {
    rect: { x0: number; y0: number; x1: number; y1: number };
    source: PreviewDigitSource;
    value: string;
    metricId?: WatchfaceMetricId;
    datePartId?: WatchfaceDatePartId;
    timePartId?: WatchfaceTimePartId;
    componentId?: string;
    separator?: {
      configKey: string;
      file: CorosWatchfaceSpriteFile;
    };
  }[] = [];
  if (autoAlignedTime) {
    const rect = parseConfigRect(config.autoalign_time_rect);
    const source = findSpriteFolder(resolution, config.autoalign_time_font);
    const separatorValue = config.autoalign_time_colon_icon?.replace(/\\/g, "/");
    const separatorPath = separatorValue
      ? `${resolution.directory}/${separatorValue}`
      : null;
    const separatorFile = separatorPath
      ? resolution.icons.find((icon) => icon.path === separatorPath) ?? null
      : null;
    if (rect && source) {
      numberPlans.push({
        rect,
        source,
        value: `${hour}${minute}`,
        timePartId: "autoTime",
        componentId: "autoTime",
        ...(separatorFile
          ? { separator: { configKey: "autoalign_time_colon_icon", file: separatorFile } }
          : {})
      });
      if (separatorFile) {
        wantedSprites.set(separatorFile.path, { color: separatorIconColor });
      }
    }
  }
  if (complication && complicationSource) {
    for (const part of relativeComplicationRects) {
      numberPlans.push({
        rect: {
          x0: part.rect.x0 + controlOrigin.x,
          y0: part.rect.y0 + controlOrigin.y,
          x1: part.rect.x1 + controlOrigin.x,
          y1: part.rect.y1 + controlOrigin.y
        },
        source: complicationSource,
        value: part.sampleValue,
        componentId: "complication"
      });
    }
  }
  const batterySource = findSpriteFolder(
    resolution,
    config["battery_level_font"]
  );
  if (batteryRect && batterySource) {
    numberPlans.push({
      rect: batteryRect,
      source: batterySource,
      value: "82",
      metricId: "battery",
      componentId: "battery"
    });
  }
  const dateFields: [string, string, string, WatchfaceDatePartId][] = [
    [
      "english_date_month_rect",
      "english_date_month_font",
      String(now.getMonth() + 1).padStart(2, "0"),
      "dateMonth"
    ],
    [
      "english_date_day_rect",
      "english_date_day_font",
      String(now.getDate()).padStart(2, "0"),
      "dateDay"
    ]
  ];
  for (const [rectKey, fontKey, value, datePartId] of dateFields) {
    const rect = parseConfigRect(config[rectKey]);
    const source = findSpriteFolder(resolution, config[fontKey]);
    if (
      datePartId === "dateMonth" &&
      dateMonthUsesLabels(source, options.dateStyles?.dateMonth)
    ) {
      continue;
    }
    if (rect && source) {
      numberPlans.push({ rect, source, value, datePartId });
    }
  }
  for (const metric of WATCHFACE_FIXED_METRICS) {
    const rect = parseConfigRect(config[metric.rectKey]);
    const source = metricFontFolder(resolution, metric);
    if (rect && source) {
      numberPlans.push({
        rect,
        source,
        value: metric.sampleValue,
        metricId: metric.id
      });
    }
  }

  // Digits come from the chosen font, or from the template bitmaps otherwise.
  const digitSprites = new Map<string, HTMLImageElement>();
  for (const planned of digitPlan) {
    const file = planned.source?.files[planned.digit];
    const fontFamily =
      (planned.partId
        ? options.timeStyles?.[planned.partId]?.fontFamily
        : undefined) ?? options.fontFamily;
    if (file && !shouldRenderWatchfaceText(String(planned.digit), fontFamily, options)) {
      wantedSprites.set(file.path, { color: null });
    }
  }
  for (const plan of numberPlans) {
    const fontFamily = plan.timePartId
      ? options.timeStyles?.[plan.timePartId]?.fontFamily ?? options.fontFamily
      : plan.datePartId
      ? options.dateStyles?.[plan.datePartId]?.fontFamily ?? options.fontFamily
      : plan.metricId
        ? options.metricStyles?.[plan.metricId]?.fontFamily ?? options.fontFamily
        : options.fontFamily;
    if (shouldRenderWatchfaceText(plan.value, fontFamily, options)) {
      continue;
    }
    for (const digit of plan.value) {
      const file = plan.source.files[Number(digit)];
      if (file) {
        wantedSprites.set(file.path, { color: null });
      }
    }
  }

  const loaded = new Map<string, HTMLImageElement>();
  const loadedAssets = new Map<string, CorosWatchfaceTemplateAsset>();
  if (wantedSprites.size > 0) {
    const assets = await loadAssets([...wantedSprites.keys()]);
    for (const asset of assets) {
      loadedAssets.set(asset.path, asset);
      const tintColor = wantedSprites.get(asset.path)?.color ?? null;
      const dataUrl = tintColor
        ? await tintSprite(asset.dataUrl, asset.width, asset.height, tintColor)
        : asset.dataUrl;
      loaded.set(asset.path, await loadStudioImage(dataUrl));
    }
  }
  const configuredAssetImages = new Map<string, HTMLImageElement>();
  const configuredAssetImage = async (
    configKey: string,
    file: CorosWatchfaceSpriteFile,
    color: string | null = null
  ): Promise<HTMLImageElement | undefined> => {
    const override = options.configAssetOverrides?.[
      watchfaceConfigAssetId(options.configAssetScope ?? "config", configKey)
    ];
    const replacement = override?.replacement;
    const artworkZoom = replacement ? override?.scale ?? 1 : 1;
    const canvasSize = configAssetCanvasSize(
      configKey,
      override,
      { width: file.width, height: file.height },
      options.nativeSpriteResolutionScale ?? 1
    );
    const cacheKey = `${configKey}|${color ?? "original"}|${artworkZoom}|${canvasSize.width}x${canvasSize.height}|${canvasSize.native}`;
    const cached = configuredAssetImages.get(cacheKey);
    if (cached) return cached;
    const sourceDataUrl = replacement?.dataUrl ?? loadedAssets.get(file.path)?.dataUrl;
    if (!sourceDataUrl) return loaded.get(file.path);
    const renderedDataUrl = replacement
      ? canvasSize.native
        ? await resizeAndTintSprite(
            sourceDataUrl,
            canvasSize.width,
            canvasSize.height
          )
        : await fitVisibleSpriteToCanvas(
            sourceDataUrl,
            canvasSize.width,
            canvasSize.height,
            artworkZoom
          )
      : await resizeAndTintSprite(
          sourceDataUrl,
          file.width,
          file.height,
          color ?? undefined
        );
    const image = await loadStudioImage(renderedDataUrl);
    configuredAssetImages.set(cacheKey, image);
    return image;
  };

  if (shouldRenderWatchfaceText("0123456789", options.fontFamily, options)) {
    for (const planned of digitPlan) {
      const file = planned.source?.files[planned.digit];
      if (file) {
        const dataUrl = await renderWatchfaceTextSprite(
          String(planned.digit),
          file.width,
          file.height,
          options.fontFamily,
          options.digitColor,
          options
        );
        digitSprites.set(file.path, await loadStudioImage(dataUrl));
      }
    }
    for (const plan of numberPlans) {
      for (const digit of plan.value) {
        const file = plan.source.files[Number(digit)];
        if (!file || digitSprites.has(file.path)) {
          continue;
        }
        const dataUrl = await renderWatchfaceTextSprite(
          digit,
          file.width,
          file.height,
          options.fontFamily,
          options.digitColor,
          options
        );
        digitSprites.set(file.path, await loadStudioImage(dataUrl));
      }
    }
  }

  const styledTimeGlyphs = new Map<string, HTMLImageElement>();
  for (const planned of digitPlan) {
    const file = planned.source?.files[planned.digit];
    if (!file || !planned.pos) {
      continue;
    }
    const timeStyle = planned.partId
      ? options.timeStyles?.[planned.partId]
      : undefined;
    const componentColor = options.layerColors?.[planned.componentId];
    const timeFontFamily = timeStyle?.fontFamily ?? options.fontFamily;
    const timeTypography = componentTypography(options, timeStyle);
    const timeColor = timeStyle?.color ?? componentColor ?? options.digitColor;
    const timeScale = timeStyle ? normalizeSpriteScale(timeStyle.scale) : 1;
    const width = Math.max(1, Math.round(file.width * timeScale));
    const height = Math.max(1, Math.round(file.height * timeScale));
    const tracking = Math.max(
      -0.35,
      Math.min(0.25, timeTypography.letterSpacing ?? 0)
    );
    const trackingOffset = planned.slot
      ? Math.round((height * tracking) / 2) * (planned.slot === "high" ? -1 : 1)
      : 0;
    let image = digitSprites.get(file.path) ?? loaded.get(file.path);
    if (timeStyle || componentColor) {
      const cacheKey = `${file.path}|${timeFontFamily}|${timeColor}|${timeScale}|${timeTypography.letterSpacing ?? 0}`;
      image = styledTimeGlyphs.get(cacheKey);
      if (!image) {
        if (shouldRenderWatchfaceText(String(planned.digit), timeFontFamily, timeTypography)) {
          image = await loadStudioImage(
            await renderWatchfaceTextSprite(
              String(planned.digit),
              width,
              height,
              timeFontFamily,
              timeColor,
              timeTypography
            )
          );
        } else if (timeStyle?.color || componentColor) {
          image = await loadStudioImage(
            await resizeAndTintSprite(
              loadedAssets.get(file.path)?.dataUrl ?? "",
              width,
              height,
              timeColor
            )
          );
        } else {
          image = loaded.get(file.path);
        }
        if (image) {
          styledTimeGlyphs.set(cacheKey, image);
        }
      }
    }
    if (image) {
      drawStudioLayerImage(
        context,
        image,
        (planned.pos.x + trackingOffset) * scale,
        planned.pos.y * scale,
        width * scale,
        height * scale,
        scale,
        options,
        planned.partId ?? planned.componentId
      );
    }
  }

  if (colonFile) {
    const hourLow = digitPlan[1];
    const minuteHigh = digitPlan[2];
    const hourLowFile = hourLow?.source?.files[hourLow.digit];
    const minuteHighFile = minuteHigh?.source?.files[minuteHigh.digit];
    const image = await configuredAssetImage("colon_icon", colonFile, separatorIconColor);
    if (
      image &&
      hourLow?.pos &&
      minuteHigh?.pos &&
      hourLowFile &&
      minuteHighFile
    ) {
      const hourScale = Math.max(
        0.5,
        Math.min(2, options.timeStyles?.hours?.scale ?? 1)
      );
      const minuteScale = Math.max(
        0.5,
        Math.min(2, options.timeStyles?.minutes?.scale ?? 1)
      );
      const hourWidth = hourLowFile.width * hourScale;
      const hourHeight = hourLowFile.height * hourScale;
      const minuteHeight = minuteHighFile.height * minuteScale;
      const hourCenterY = hourLow.pos.y + hourHeight / 2;
      const minuteCenterY = minuteHigh.pos.y + minuteHeight / 2;
      const gapCenterX =
        (hourLow.pos.x + hourWidth + minuteHigh.pos.x) / 2;
      const gapCenterY = (hourCenterY + minuteCenterY) / 2;
      context.drawImage(
        image,
        (gapCenterX - image.naturalWidth / 2) * scale,
        (gapCenterY - image.naturalHeight / 2) * scale,
        image.naturalWidth * scale,
        image.naturalHeight * scale
      );
    }
  }

  if (arcCutFile && arcCutPos) {
    const image = await configuredAssetImage("arc_cut_icon", arcCutFile, separatorIconColor);
    if (image) {
      context.drawImage(
        image,
        arcCutPos.x * scale,
        arcCutPos.y * scale,
        image.naturalWidth * scale,
        image.naturalHeight * scale
      );
    }
  }

  if (batteryFile && batteryIconPos) {
    const batteryIconScale = batteryOverride?.scale ?? 1;
    const createdBatteryScale = batteryFolder
      ? 1
      : options.batteryIconResolutionScale ?? 1;
    const image = batteryReplacement
      ? await loadStudioImage(
          await renderScaledSpriteInSlot(
            batteryReplacement.dataUrl,
            Math.max(1, Math.round(batteryFile.width * createdBatteryScale)),
            Math.max(1, Math.round(batteryFile.height * createdBatteryScale)),
            batteryIconScale
          )
        )
      : await configuredAssetImage("battery_icon", batteryFile);
    if (image) {
      drawStudioLayerImage(
        context,
        image,
        batteryIconPos.x * scale,
        batteryIconPos.y * scale,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
        scale,
        options,
        "batteryIcon"
      );
    }
  }

  if (weekFile && weekRect) {
    const weekStyle = options.dateStyles?.weekday;
    const weekFontFamily = weekStyle?.fontFamily ?? options.fontFamily;
    const weekTypography = componentTypography(options, weekStyle);
    let image = loaded.get(weekFile.path);
    const weekScale = normalizeSpriteScale(weekStyle?.scale);
    const weekWidth = weekFile.width;
    const weekHeight = weekFile.height;
    const nativeWeekday = Boolean(
      weekStyle &&
        (weekStyle.nativeSize ??
          Boolean(weekStyle.fontFamily || weekStyle.rasterFont))
    );
    let renderedWeekWidth = weekWidth;
    let renderedWeekHeight = weekHeight;
    if (
      nativeWeekday &&
      shouldRenderWatchfaceText(
        WEEKDAY_LABELS[weekdayIndex] ?? "DAY",
        weekFontFamily,
        weekTypography
      )
    ) {
      image = await loadStudioImage(
        await renderNativeWatchfaceTextSprite(
          WEEKDAY_LABELS[weekdayIndex] ?? "DAY",
          weekHeight * weekScale,
          weekFontFamily,
          weekColor ?? options.digitColor,
          weekTypography
        )
      );
      renderedWeekWidth = image.naturalWidth;
      renderedWeekHeight = image.naturalHeight;
    } else if (
      nativeWeekday &&
      loadedAssets.get(weekFile.path)?.dataUrl
    ) {
      image = await loadStudioImage(
        await renderNativeRasterImageSprite(
          loadedAssets.get(weekFile.path)!.dataUrl,
          weekHeight * weekScale,
          weekStyle?.color ??
            (options.tintLabels ? options.digitColor : undefined),
          Boolean(weekStyle?.color || options.tintLabels)
        )
      );
      renderedWeekWidth = image.naturalWidth;
      renderedWeekHeight = image.naturalHeight;
    } else if (shouldRenderWatchfaceText(WEEKDAY_LABELS[weekdayIndex] ?? "DAY", weekFontFamily, weekTypography)) {
      image = await loadStudioImage(
        await fitVisibleSpriteToCanvas(
          await renderWatchfaceTextSprite(
            WEEKDAY_LABELS[weekdayIndex] ?? "DAY",
            weekWidth,
            weekHeight,
            weekFontFamily,
            weekColor ?? options.digitColor,
            weekTypography
          ),
          weekWidth,
          weekHeight,
          weekScale
        )
      );
    } else if (weekStyle && loadedAssets.get(weekFile.path)?.dataUrl) {
      image = await loadStudioImage(
        await fitVisibleSpriteToCanvas(
          await resizeAndTintSprite(
            loadedAssets.get(weekFile.path)!.dataUrl,
            weekWidth,
            weekHeight,
            weekStyle.color ??
              (options.tintLabels ? options.digitColor : undefined)
          ),
          weekWidth,
          weekHeight,
          weekScale
        )
      );
    }
    if (image) {
      const centerX = ((weekRect.x0 + weekRect.x1) / 2) * scale;
      const centerY = ((weekRect.y0 + weekRect.y1) / 2) * scale;
      drawStudioLayerImage(
        context,
        image,
        centerX - (renderedWeekWidth * scale) / 2,
        centerY - (renderedWeekHeight * scale) / 2,
        renderedWeekWidth * scale,
        renderedWeekHeight * scale,
        scale,
        options,
        "weekday"
      );
    }
  }

  if (monthFile && monthRect) {
    const monthStyle = options.dateStyles?.dateMonth;
    const monthFontFamily = monthStyle?.fontFamily ?? options.fontFamily;
    const monthTypography = {
      ...options,
      rasterFont: monthStyle?.rasterFont ?? options.rasterFont
    };
    const label = WATCHFACE_MONTH_LABELS[monthIndex] ?? String(monthIndex + 1);
    const canvasSize = dateSpriteCanvasSize(
      resolution,
      "dateMonth",
      monthStyle,
      monthSpriteIndex,
      options.nativeSpriteResolutionScale ?? 1
    );
    const width = canvasSize?.width ?? monthFile.width;
    const height = canvasSize?.height ?? monthFile.height;
    let image = loaded.get(monthFile.path);
    if (shouldRenderWatchfaceText(label, monthFontFamily, monthTypography)) {
      const rendered = await renderWatchfaceTextSprite(
        label,
        width,
        height,
        monthFontFamily,
        monthColor ?? options.digitColor,
        monthTypography
      );
      image = await loadStudioImage(
        monthStyle && !canvasSize?.native
          ? await fitVisibleSpriteToCanvas(
              rendered,
              width,
              height,
              monthStyle.scale
            )
          : rendered
      );
    } else if (monthStyle && loadedAssets.get(monthFile.path)?.dataUrl) {
      const sourceDataUrl = loadedAssets.get(monthFile.path)!.dataUrl;
      image = await loadStudioImage(
        canvasSize?.native
          ? await resizeAndTintSprite(
              sourceDataUrl,
              width,
              height,
              monthStyle.color ??
                (options.tintLabels ? options.digitColor : undefined)
            )
          : await fitVisibleSpriteToCanvas(
              await resizeAndTintSprite(
                sourceDataUrl,
                width,
                height,
                monthStyle.color ??
                  (options.tintLabels ? options.digitColor : undefined)
              ),
              width,
              height,
              monthStyle.scale
            )
      );
    }
    if (image) {
      const centerX = ((monthRect.x0 + monthRect.x1) / 2) * scale;
      const centerY = ((monthRect.y0 + monthRect.y1) / 2) * scale;
      context.drawImage(
        image,
        centerX - (width * scale) / 2,
        centerY - (height * scale) / 2,
        width * scale,
        height * scale
      );
    }
  }

  for (const layer of controlStatusLayers) {
    const image = await configuredAssetImage(
      layer.configKey,
      layer.source,
      controlStatusIconColor
    );
    if (!image) continue;
    drawStudioLayerImage(
      context,
      image,
      layer.position.x * scale,
      layer.position.y * scale,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
      scale,
      options,
      "complication"
    );
  }

  if (complicationIcon && complicationIconPos) {
    const complicationIconKey = complicationPrefix
      ? `control_${complicationPrefix}_icon`
      : "";
    const image =
      complication?.id === "battery" && controlBatteryReplacement
        ? await loadStudioImage(
            await renderScaledSpriteInSlot(
              controlBatteryReplacement.dataUrl,
              complicationIcon.width,
              complicationIcon.height,
              controlBatteryOverride?.scale ?? 1
            )
          )
        : complicationIconKey
      ? await configuredAssetImage(
          complicationIconKey,
          complicationIcon,
          options.layerColors?.complication ??
            (options.tintIcons ? options.accentColor : null)
        )
      : loaded.get(complicationIcon.path);
    if (image) {
      drawStudioLayerImage(
        context,
        image,
        complicationIconPos.x * scale,
        complicationIconPos.y * scale,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
        scale,
        options,
        "complication"
      );
    }
  } else if (complication?.id === "battery" && complicationIconPos) {
    // Some watches offer Battery as a firmware control even though the source
    // template contains no battery control PNG. Draw a preview-only glyph so
    // the editor still represents the on-watch selector without exporting an
    // invented asset or unsupported config key.
    const sharedIconValue = config.control_step_icon?.replace(/\\/g, "/");
    const sharedIcon = sharedIconValue
      ? resolution.icons.find(
          (icon) => icon.path === `${resolution.directory}/${sharedIconValue}`
        )
      : null;
    const width = sharedIcon?.width ?? Math.max(22, Math.round(resolution.width * 0.045));
    const height = sharedIcon?.height ?? Math.max(14, Math.round(width * 0.58));
    const x = complicationIconPos.x * scale;
    const y = complicationIconPos.y * scale;
    const w = width * scale;
    const h = height * scale;
    const terminalWidth = Math.max(2, w * 0.1);
    const terminalHeight = h * 0.38;
    const stroke = Math.max(1.5, h * 0.1);
    const color = options.layerColors?.complication ?? options.digitColor;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = stroke;
    context.strokeRect(x + stroke / 2, y + stroke / 2, w - terminalWidth - stroke, h - stroke);
    context.fillRect(
      x + w - terminalWidth,
      y + (h - terminalHeight) / 2,
      terminalWidth,
      terminalHeight
    );
    context.fillRect(
      x + stroke * 1.6,
      y + stroke * 1.6,
      Math.max(1, (w - terminalWidth - stroke * 3.2) * 0.82),
      Math.max(1, h - stroke * 3.2)
    );
    context.restore();
  }

  const styledMetricGlyphs = new Map<string, HTMLImageElement>();
  for (const plan of numberPlans) {
    const metricStyle = plan.metricId
      ? options.metricStyles?.[plan.metricId]
      : undefined;
    const dateStyle = plan.datePartId
      ? options.dateStyles?.[plan.datePartId]
      : undefined;
    const timeStyle = plan.timePartId
      ? options.timeStyles?.[plan.timePartId]
      : undefined;
    const complicationStyle = plan.componentId === "complication"
      ? options.complicationStyle
      : undefined;
    const componentColor = plan.componentId
      ? options.layerColors?.[plan.componentId]
      : undefined;
    const glyphFontFamily =
      timeStyle?.fontFamily ?? metricStyle?.fontFamily ?? dateStyle?.fontFamily ?? complicationStyle?.fontFamily ?? options.fontFamily;
    const glyphTypography = componentTypography(
      options,
      timeStyle ?? metricStyle ?? dateStyle ?? complicationStyle
    );
    const glyphs: {
      file: CorosWatchfaceSpriteFile;
      image: HTMLImageElement;
    }[] = [];
    for (const digit of plan.value) {
      const file = plan.source.files[Number(digit)];
      if (!file) {
        continue;
      }
      if (!timeStyle && !metricStyle && !dateStyle && !complicationStyle && !componentColor) {
        const image = digitSprites.get(file.path) ?? loaded.get(file.path);
        if (image) {
          glyphs.push({ file, image });
        }
        continue;
      }
      const glyphScale = Math.max(
        0.5,
        Math.min(2, timeStyle?.scale ?? metricStyle?.scale ?? complicationStyle?.scale ?? 1)
      );
      const dateCanvas = plan.datePartId
        ? dateSpriteCanvasSize(
            resolution,
            plan.datePartId,
            dateStyle,
            Number(digit),
            options.nativeSpriteResolutionScale ?? 1
          )
        : null;
      const nativeDateDay =
        !dateCanvas?.native &&
        plan.datePartId === "dateDay" &&
        Boolean(
          dateStyle &&
            (dateStyle.nativeSize ??
              Boolean(dateStyle.fontFamily || dateStyle.rasterFont))
        );
      const nativeComplication = Boolean(complicationStyle?.nativeSize);
      const nativeGlyph = nativeDateDay || nativeComplication;
      const importedComplicationHeight = nativeComplication
        ? rasterFontNativeSpriteSize(complicationStyle?.rasterFont, digit)
            ?.height
        : undefined;
      const nativeTargetHeight = Math.max(
        1,
        Math.round(
          (importedComplicationHeight !== undefined
            ? importedComplicationHeight *
              (options.nativeSpriteResolutionScale ?? 1)
            : file.height) * glyphScale
        )
      );
      let styledFile = {
        ...file,
        width: dateCanvas?.width ?? Math.max(1, Math.round(file.width * glyphScale)),
        height: dateCanvas?.height ?? Math.max(1, Math.round(file.height * glyphScale))
      };
      const glyphColor =
        timeStyle?.color ??
        metricStyle?.color ??
        dateStyle?.color ??
        complicationStyle?.color ??
        componentColor ??
        options.digitColor;
      const cacheKey = `${file.path}|${glyphFontFamily}|${glyphColor}|${styledFile.width}x${styledFile.height}|${glyphTypography.letterSpacing ?? 0}|${dateCanvas?.native ?? false}|${nativeGlyph ? "native" : "bounded"}`;
      let image = styledMetricGlyphs.get(cacheKey);
      if (!image) {
        if (
          nativeGlyph &&
          shouldRenderWatchfaceText(digit, glyphFontFamily, glyphTypography)
        ) {
          image = await loadStudioImage(
            await renderNativeWatchfaceTextSprite(
              digit,
              nativeTargetHeight,
              glyphFontFamily,
              glyphColor,
              glyphTypography
            )
          );
        } else if (
          nativeGlyph &&
          loadedAssets.get(file.path)?.dataUrl
        ) {
          image = await loadStudioImage(
            await renderNativeRasterImageSprite(
              loadedAssets.get(file.path)!.dataUrl,
              nativeTargetHeight,
              glyphColor,
              Boolean(dateStyle?.color || complicationStyle?.color)
            )
          );
        } else if (shouldRenderWatchfaceText(digit, glyphFontFamily, glyphTypography)) {
          const rendered = await renderWatchfaceTextSprite(
            digit,
            styledFile.width,
            styledFile.height,
            glyphFontFamily,
            glyphColor,
            glyphTypography
          );
          image = await loadStudioImage(
            dateStyle && !dateCanvas?.native
              ? await fitVisibleSpriteToCanvas(
                  rendered,
                  styledFile.width,
                  styledFile.height,
                  dateStyle.scale
                )
              : rendered
          );
        } else if (timeStyle?.color || metricStyle?.color || dateStyle?.color || complicationStyle?.color || componentColor) {
          const rendered = await resizeAndTintSprite(
              loadedAssets.get(file.path)?.dataUrl ?? "",
              styledFile.width,
              styledFile.height,
              glyphColor
            );
          image = await loadStudioImage(
            dateStyle && !dateCanvas?.native
              ? await fitVisibleSpriteToCanvas(
                  rendered,
                  styledFile.width,
                  styledFile.height,
                  dateStyle.scale
                )
              : rendered
          );
        } else if (dateStyle && loadedAssets.get(file.path)?.dataUrl) {
          const sourceDataUrl = loadedAssets.get(file.path)!.dataUrl;
          image = await loadStudioImage(
            dateCanvas?.native
              ? await resizeAndTintSprite(
                  sourceDataUrl,
                  styledFile.width,
                  styledFile.height
                )
              : await fitVisibleSpriteToCanvas(
                  sourceDataUrl,
                  styledFile.width,
                  styledFile.height,
                  dateStyle.scale
                )
          );
        } else {
          image = loaded.get(file.path);
        }
        if (image) {
          styledMetricGlyphs.set(cacheKey, image);
        }
      }
      if (image) {
        if (nativeGlyph) {
          styledFile = {
            ...file,
            width: image.naturalWidth,
            height: image.naturalHeight
          };
        }
        glyphs.push({ file: styledFile, image });
      }
    }
    if (glyphs.length === 0) {
      continue;
    }
    const separatorImage = plan.separator
      ? await configuredAssetImage(
          plan.separator.configKey,
          plan.separator.file,
          separatorIconColor
        )
      : undefined;
    const separatorWidth = separatorImage ? separatorImage.naturalWidth : 0;
    const totalWidth = glyphs.reduce((sum, glyph) => sum + glyph.file.width, 0) + separatorWidth;
    const centerX = (plan.rect.x0 + plan.rect.x1) / 2;
    const centerY = (plan.rect.y0 + plan.rect.y1) / 2;
    let x = centerX - totalWidth / 2;
    const layerId = plan.timePartId ?? plan.metricId ?? plan.datePartId ?? plan.componentId;
    for (const [index, glyph] of glyphs.entries()) {
      if (index === 2 && separatorImage && plan.separator) {
        drawStudioLayerImage(
          context,
          separatorImage,
          x * scale,
          (centerY - separatorImage.naturalHeight / 2) * scale,
          separatorImage.naturalWidth * scale,
          separatorImage.naturalHeight * scale,
          scale,
          options,
          layerId
        );
        x += separatorImage.naturalWidth;
      }
      drawStudioLayerImage(
        context,
        glyph.image,
        x * scale,
        (centerY - glyph.file.height / 2) * scale,
        glyph.file.width * scale,
        glyph.file.height * scale,
        scale,
        options,
        layerId
      );
      x += glyph.file.width;
    }
  }

  if (controlColonFile && relativeComplicationRects.length > 1) {
    const first = relativeComplicationRects[0]!.rect;
    const second = relativeComplicationRects[1]!.rect;
    const image = await configuredAssetImage(
      "control_colon_icon",
      controlColonFile,
      options.layerColors?.complication ??
        (options.tintIcons ? options.accentColor : null)
    );
    if (image) {
      const centerX = controlOrigin.x + (first.x1 + second.x0) / 2;
      const centerY = controlOrigin.y +
        (first.y0 + first.y1 + second.y0 + second.y1) / 4;
      drawStudioLayerImage(
        context,
        image,
        (centerX - image.naturalWidth / 2) * scale,
        (centerY - image.naturalHeight / 2) * scale,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
        scale,
        options,
        "complication"
      );
    }
  }

  // AM/PM indicator: shows whichever sprite matches the preview time, styled
  // the same way the export will restyle the studio copies.
  const ampmStyle = options.ampmStyle;
  if (ampmStyle?.enabled && ampmFile) {
    const ampmScale = Math.max(0.5, Math.min(2, ampmStyle.scale));
    const width = Math.max(1, Math.round(ampmFile.width * ampmScale));
    const height = Math.max(1, Math.round(ampmFile.height * ampmScale));
    const sourceDataUrl = loadedAssets.get(ampmFile.path)?.dataUrl;
    if (sourceDataUrl || ampmStyle.fontFamily) {
      const dataUrl = ampmStyle.fontFamily
        ? renderDigitSprite(
            now.getHours() < 12 ? "AM" : "PM",
            width,
            height,
            ampmStyle.fontFamily,
            ampmStyle.color ?? options.digitColor
          )
        : await resizeAndTintSprite(
            sourceDataUrl!,
            width,
            height,
            ampmStyle.color
          );
      context.drawImage(
        await loadStudioImage(dataUrl),
        ampmStyle.x * scale,
        ampmStyle.y * scale,
        width * scale,
        height * scale
      );
    }
  }

  // Analog artwork uses a centered coordinate system instead of top-left
  // positions. Keep this last so the firmware's hand/center-overlay stack is
  // represented above the digital face content as it is on the watch.
  for (const layer of analogLayers) {
    const image = await configuredAssetImage(
      layer.configKey,
      layer.source,
      analogIconColor
    );
    if (!image) continue;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.save();
    context.translate(layer.center.x * scale, layer.center.y * scale);
    if (layer.rotationDegrees !== null) {
      context.rotate((layer.rotationDegrees * Math.PI) / 180);
    }
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  }
}
