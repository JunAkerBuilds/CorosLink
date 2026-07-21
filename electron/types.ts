export type BinaryName = "yt-dlp" | "ffmpeg";

export interface BinaryCheck {
  name: BinaryName;
  available: boolean;
  command?: string;
  source: "bundled" | "path" | "missing";
  version?: string;
  error?: string;
}

export interface BinaryStatus {
  ytDlp: BinaryCheck;
  ffmpeg: BinaryCheck;
}

export interface DriveCandidate {
  name: string;
  rootPath: string;
  musicPath?: string;
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  reason: string;
}

export interface WatchTrack {
  name: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export type WatchModelId =
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "pace-2"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-4"
  | "apex-2-pro"
  | "apex-2"
  | "apex-pro"
  | "apex";

export type CorosWatchfaceResolutionProfile =
  | "mip-240-260-800"
  | "amoled-416-800"
  | "amoled-390-800"
  | "other";

export type WatchConnectionSmokeOptionId =
  | "auto"
  | "none"
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "pace-2"
  | "nomad"
  | "vertix-2"
  | "vertix-2s"
  | "apex-4"
  | "apex-2-pro"
  | "apex-2"
  | "apex-pro"
  | "apex"
  | "unknown-pace"
  | "installer";

export interface WatchStatus {
  connected: boolean;
  checkedAt: string;
  name?: string;
  model?: WatchModelId;
  rootPath?: string;
  musicPath?: string;
  mapPath?: string;
  mapSizeBytes?: number;
  mapFileCount?: number;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  tracks: WatchTrack[];
  candidates: DriveCandidate[];
  error?: string;
}

/** COROS account region, selecting the regional mobile API host. */
export type CorosWatchfaceRegion = "eu" | "us" | "cn";

/** A separate COROS mobile-app session used only for custom-watchface sharing. */
export interface CorosWatchfaceStatus {
  authenticated: boolean;
  secureStorageAvailable: boolean;
  /** Whether an encrypted COROS account is available to create a new mobile session. */
  savedCredentialsAvailable: boolean;
  /** Account identifier only; the saved password digest never leaves the main process. */
  savedEmail?: string;
  /** Region of the active mobile session, when signed in. */
  region?: CorosWatchfaceRegion;
  /** Best-guess region to preselect in the login form. */
  suggestedRegion: CorosWatchfaceRegion;
}

/** The only carrier currently approved for the guarded legacy editor. */
export type CorosLegacy614aCarrierProfile = "multidata-elev-416";

export interface CorosLegacy614aCarrierInspection {
  profile: CorosLegacy614aCarrierProfile;
  profileName: string;
  fileName: string;
  watchFaceId: number;
  sizeBytes: number;
  payloadCrc16: number;
  fullFileCrc16: number;
  weatherSpriteSize: number;
  weatherPosition: { x: number; y: number };
  temperatureRect: { x0: number; y0: number; x1: number; y1: number };
}

/** Opaque main-process handle returned after an exact reference is inspected. */
export interface CorosLegacy614aCarrierSelection {
  selectionId: string;
  inspection: CorosLegacy614aCarrierInspection;
}

/** Safe normal-display geometry only. Carrier identity and resources are locked. */
export interface CorosLegacy614aCarrierPatchInput {
  weatherPosition: { x: number; y: number };
  temperatureRect: { x0: number; y0: number; x1: number; y1: number };
}

export interface CorosLegacy614aCarrierExportResult {
  saved: boolean;
  filePath?: string;
  watchFaceId: number;
}

/** A source-template, on-watch, or user-created watchface catalog. */
export type CorosWatchfaceThemeCatalog = "editable" | "official" | "custom";

/** Parameters required by a COROS watchface catalog request. */
export interface CorosWatchfaceThemeListInput {
  firmwareType: string;
  language?: string;
  maxWatchFaceVersion?: number;
  /** Optional watch serial for on-watch/custom catalogs; any value works (defaults to `"x"`). */
  snCode?: string;
  /** Optional firmware model header captured from the mobile app. */
  modelVersion?: string;
  catalog?: CorosWatchfaceThemeCatalog;
}

/** An entry returned by a COROS watchface catalog. */
export interface CorosWatchfaceTheme {
  id?: string;
  /** Original editable template used to create a custom watch face. */
  sourceTemplateId?: string;
  name: string;
  previewImageUrl?: string;
  /** The theme's downloadable package resource, when the catalog exposes one. */
  packageUrl?: string;
  firmwareType?: string;
  backgroundImageId?: number;
  watchFaceVersion?: number;
  diyVersion?: number;
  templateType?: number;
  category?: string;
}

/** Device identifiers supplied by the user for the COROS battery-history API. */
export interface CorosBatteryQueryInput {
  deviceId: string;
  firmwareType: string;
  uuid: string;
}

/** A paired watch returned by the signed-in COROS account profile. */
export interface CorosPairedDevice {
  deviceId: string;
  firmwareType: string;
  uuid: string;
  mac?: string;
  /** Optional cosmetic variant reported by the authenticated mobile profile. */
  colorType?: string;
  /** Optional official device artwork pack, accepted only when served over HTTPS. */
  imagePackUrl?: string;
  /** Profile revision returned by COROS for this paired device. */
  profileVersion?: number;
}

/** A nearby Bluetooth device exposed by Electron's Web Bluetooth chooser. */
export interface CorosBluetoothDeviceChoice {
  deviceId: string;
  deviceName: string;
}

export interface CorosBatteryUsageDetail {
  name: string;
  percent?: number;
}

export interface CorosBatteryUsageGroup {
  name: string;
  percent?: number;
  details: CorosBatteryUsageDetail[];
}

/** A daily battery-consumption record normalized from COROS's mobile API. */
export interface CorosBatteryDay {
  date: string;
  percentAtQueryTime?: number;
  totalPercent?: number;
  groups: CorosBatteryUsageGroup[];
}

export interface CorosBatteryReport {
  alarmStatus?: number;
  updatedAt?: string;
  days: CorosBatteryDay[];
}

/** A validated archive held by the main process after the user selected it. */
export interface CorosWatchfaceArchive {
  archiveId: string;
  fileName: string;
  sizeBytes: number;
  /** Decimal text: official template IDs exceed Number.MAX_SAFE_INTEGER. */
  sourceTemplateId: string;
  diyVersion: number;
  /** Effective `o_wf_ver` declared by info.json (defaults to 0 when absent). */
  watchFaceVersion: number;
  /** Target firmware family retained from template selection/import. */
  firmwareType?: string;
  /** Detected from resolution folders, independent of COROS's firmware ID. */
  resolutionProfile: CorosWatchfaceResolutionProfile;
  /** Portable CorosLink project metadata bundled with an editable website ZIP. */
  editableProject?: CorosWatchfaceEditableProject;
}

export interface CorosWatchfaceProjectExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  /** Absolute path to the editable website ZIP, when saved. */
  filePath?: string;
}

export interface CorosWatchfaceArchiveExportInput {
  archiveId: string;
  name: string;
}

/** A public COROS share page downloaded and registered as a Studio archive. */
export interface CorosWatchfaceShareImport {
  archive: CorosWatchfaceArchive;
  name: string;
  /** Firmware recorded by COROS for the shared face, when present. */
  firmwareType?: string;
}

export interface CommunityWatchface {
  id: string;
  slug: string;
  title: string;
  description: string;
  creatorName: string;
  creatorHandle: string | null;
  models: string[];
  tags: string[];
  publishedAt: string | null;
  previewUrl: string;
  detailUrl: string;
  downloadUrl: string;
  packageBytes: number;
  packageSha256: string;
  validatorVersion: string | null;
}

export interface CommunityWatchfaceCatalogQuery {
  q?: string;
  model?: string;
  style?: string;
  sort?: "newest" | "title";
  page?: number;
  pageSize?: number;
}

export interface CommunityWatchfaceCatalogPage {
  schemaVersion: 1;
  items: CommunityWatchface[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  facets: {
    models: string[];
    styles: Array<{ value: string; label: string }>;
  };
}

export interface CommunityWatchfaceImport {
  face: CommunityWatchface;
  archive: CorosWatchfaceArchive;
}

export interface CommunityWatchfaceDownloadProgress {
  slug: string;
  stage: "downloading" | "verifying" | "opening";
  receivedBytes: number;
  totalBytes?: number;
}

export interface CommunityWatchfaceOpenRequest {
  slug: string;
}

export interface CorosWatchfacePublishInput {
  archiveId: string;
  name: string;
  firmwareType: string;
  backgroundImageId: number;
  language?: string;
}

/** Existing custom face metadata used to request a fresh COROS share link. */
export interface CorosWatchfaceExistingShareInput {
  templateId: string;
  sourceTemplateId: string;
  name: string;
  firmwareType: string;
  backgroundImageId: number;
}

/** A browser-rendered 800×800 face background, kept within a selected template. */
export interface CorosWatchfaceCreatorInput {
  sourceArchiveId: string;
  backgroundDataUrl: string;
  /** Fully composed face preview written to the archive's root preview PNG. */
  previewDataUrl?: string;
  /** Target firmware used to validate that required device resolutions exist. */
  firmwareType?: string;
  /** Connected watch model, used when firmware identifiers change over time. */
  watchModel?: WatchModelId;
  /** Exact `o_wf_ver` to write. Omit to preserve/auto-raise the template value. */
  watchFaceVersion?: number;
  /**
   * Experimental export-only `o_template_id` override in info.json. Decimal
   * text is used because official COROS template IDs can exceed
   * Number.MAX_SAFE_INTEGER.
   */
  templateIdOverride?: string;
  /**
   * Experimental export-only `[watchface_id]` override written to every
   * `config.txt` / `AODconfig.txt`. Accepts decimal or `0x` hex (32-bit).
   */
  watchfaceIdOverride?: string;
  /** Experimental export-only `m_name` override for template-identity tests. */
  templateNameOverride?: string;
  /**
   * Deletes every `[key]=` line whose value is blank from each `config.txt` /
   * `AODconfig.txt`. Firmware treats a declared key as feature-present even
   * when empty (an empty `control_*` group still adds a blank entry to the
   * on-watch selector), so absent lines are the only reliable "off".
   */
  stripBlankConfigKeys?: boolean;
  /**
   * Renderer-generated PNG sprites (bitmap-font digits, tinted icons and
   * weekday labels) that replace template assets of identical size.
   */
  assetReplacements?: CorosWatchfaceAssetReplacement[];
  /**
   * Layout experiments: rewrites the values of keys that already exist in a
   * template config file (element positions, rects, colors). Keys absent from
   * the original file are rejected rather than appended.
   */
  configOverrides?: CorosWatchfaceConfigOverride[];
  /**
   * Full-file replacements for existing `config.txt` / `AODconfig.txt` entries.
   * Applied as the new base text before structured `configOverrides`.
   */
  configTextReplacements?: CorosWatchfaceConfigTextFile[];
  /**
   * Raises info.json's `o_wf_ver` to at least this value. The phone-app
   * compiler only bakes weather/temperature elements into the on-watch binary
   * when the template declares a high-enough watchface version (official
   * weather-bearing faces ship `o_wf_ver:4`); a stock DIY face at version 0
   * renders those elements in the preview but drops them on the watch.
   */
  minWatchFaceVersion?: number;
}

export interface CorosWatchfaceConfigOverride {
  /** A config file entry of the archive, e.g. "watchface_800x800/config.txt". */
  path: string;
  values: Record<string, string>;
}

/** Raw UTF-8 body for an existing template config file path. */
export interface CorosWatchfaceConfigTextFile {
  /** Archive entry such as "watchface_416x416/AODconfig.txt". */
  path: string;
  text: string;
}

export interface CorosWatchfaceAssetReplacement {
  /** Zip entry path inside the selected template archive or a studio sprite path. */
  path: string;
  dataUrl: string;
  /** Adds a new isolated sprite instead of replacing a template entry. */
  create?: boolean;
  /** Allows a supported state-sprite replacement to change template PNG dimensions. */
  allowDimensionOverride?: boolean;
}

/** One PNG inside a template archive, addressed by its zip entry path. */
export interface CorosWatchfaceSpriteFile {
  path: string;
  width: number;
  height: number;
}

/**
 * A numbered sprite folder inside a resolution directory. `month` folders
 * contain one label image per month; `state` folders are firmware-swapped icon
 * sets such as battery and weather, never bitmap fonts.
 */
export interface CorosWatchfaceSpriteFolder {
  /** Folder path relative to the resolution directory, e.g. "01" or "a/01". */
  folder: string;
  kind: "digits" | "week" | "month" | "state";
  /** True when the folder belongs to the always-on-display asset tree. */
  aod: boolean;
  files: CorosWatchfaceSpriteFile[];
}

export interface CorosWatchfaceResolutionDetails {
  /** e.g. "watchface_800x800" */
  directory: string;
  width: number;
  height: number;
  /** Raw `[key]=value` pairs from config.txt. */
  config: Record<string, string>;
  /** Raw `[key]=value` pairs from AODconfig.txt, when present. */
  aodConfig: Record<string, string>;
  spriteFolders: CorosWatchfaceSpriteFolder[];
  icons: CorosWatchfaceSpriteFile[];
}

/** Everything the renderer needs to restyle a selected template archive. */
export interface CorosWatchfaceTemplateDetails {
  archiveId: string;
  resolutions: CorosWatchfaceResolutionDetails[];
}

/** A template PNG exported to the renderer for tinting or preview. */
/** The outcome of downloading an official theme's package resource. */
export interface CorosWatchfaceThemeDownload {
  fileName: string;
  sizeBytes: number;
  /** True when the package validated as a DIY starter template archive. */
  usableAsTemplate: boolean;
  /** Set when usable: the registered archive, ready for the creator. */
  archive?: CorosWatchfaceArchive;
  /** Top-level entries when the package is a ZIP but not a starter template. */
  entries?: string[];
  /** Local copy retained so it can be inspected or shared. */
  savedPath?: string;
  message: string;
}

export interface CorosWatchfaceThemeDownloadInput {
  packageUrl: string;
  /** Display name used for the downloaded archive, usually the theme name. */
  name?: string;
  /** Firmware family used to query the catalog that returned this template. */
  firmwareType?: string;
}

export interface CorosWatchfaceTemplateAsset extends CorosWatchfaceSpriteFile {
  dataUrl: string;
}

export interface CorosWatchfaceArtwork {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * An edit applied to one PNG-valued config entry. The map key is scoped to
 * either config.txt or AODconfig.txt so two entries may share a source bitmap
 * without sharing visibility or replacement state.
 */
export interface CorosWatchfaceConfigAssetOverride {
  /** Absent means the template config entry remains enabled. */
  enabled?: boolean;
  /** Battery/native canvas scale, or artwork zoom inside a fixed direct-asset canvas. */
  scale?: number;
  /** Allow supported selectable-control icons to use the imported PNG dimensions. */
  nativeSize?: boolean;
  /** One source PNG is resized independently for every device resolution. */
  replacement?: CorosWatchfaceArtwork;
  /** Per-state PNGs for a stateful sprite folder such as the battery indicator. */
  stateReplacements?: Record<string, CorosWatchfaceArtwork>;
}

/**
 * A user-supplied PNG font atlas. Glyphs are laid out left-to-right,
 * top-to-bottom in equally sized cells; `glyphs` maps those cells to text.
 */
export interface CorosWatchfaceRasterFont {
  /** Friendly name shown in the font selector and saved with the project. */
  label: string;
  /** PNG data URL for the full glyph atlas. */
  dataUrl: string;
  /** One character per atlas cell, in reading order. */
  glyphs: string;
  /** Number of equally sized cells across the atlas. */
  columns: number;
  /** Optional pre-rasterized labels such as MON, TUE, and WED. */
  labels?: Record<string, string>;
  /**
   * Optional independent PNGs keyed by their exact glyph or label (for
   * example `"7"`, `"MON"`, or `"PM"`). These take priority over the atlas,
   * so a font does not have to reuse a uniformly gridded source image.
   */
  sprites?: Record<string, string>;
  /** Native pixel dimensions for independently imported glyph/label PNGs. */
  spriteSizes?: Record<string, { width: number; height: number }>;
  /** Native pixel dimensions of the uploaded atlas image. */
  atlasSize?: { width: number; height: number };
  /** When true, use the design's selected digit colour for the atlas alpha. */
  tint: boolean;
}

/** A PNG decoded from a sprite folder by the main process. */
export interface CorosWatchfaceRasterFontSprite {
  name: string;
  relativePath: string;
  dataUrl: string;
  sizeBytes: number;
}

/** A user-selected folder of PNG digit and optional weekday sprites. */
export interface CorosWatchfaceRasterFontFolder {
  label: string;
  sprites: CorosWatchfaceRasterFontSprite[];
}

export interface CorosWatchfaceSpriteCrop {
  /** Normalized source coordinates in the inclusive 0..1 image space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CorosWatchfaceTransformOrigin {
  /** Normalized horizontal pivot, where 0.5 is the visual center. */
  x: number;
  /** Normalized vertical pivot, where 0.5 is the visual center. */
  y: number;
}

export interface CorosWatchfaceShadowEffect {
  id: string;
  kind: "outer-shadow" | "inner-shadow";
  enabled: boolean;
  color: string;
  /** Normalized 0..1 alpha multiplied with the shadow color. */
  opacity: number;
  /** Blur radius in 800px master watch-face pixels. */
  blur: number;
  /** Positive values expand the mask; negative values contract it. */
  spread: number;
  /** Offset distance in 800px master watch-face pixels. */
  distance: number;
  /** Clockwise degrees from the positive X axis. */
  angle: number;
}

export interface CorosWatchfaceEffectStyle {
  id: string;
  name: string;
  effects: CorosWatchfaceShadowEffect[];
}

export type CorosWatchfaceEffectBinding =
  | { kind: "local"; effects: CorosWatchfaceShadowEffect[] }
  | { kind: "style"; styleId: string };

export type CorosWatchfaceStrokePaint =
  | {
      kind: "solid";
      color: string;
    }
  | {
      kind: "linear-gradient";
      from: string;
      to: string;
      /** Clockwise degrees from the positive X axis. */
      angle: number;
    };

export interface CorosWatchfaceStroke {
  id: string;
  enabled: boolean;
  paint: CorosWatchfaceStrokePaint;
  /** Normalized 0..1 alpha applied to the stroke paint. */
  opacity: number;
  position: "inside" | "center" | "outside";
  /** Width in the Studio's 800px master watch-face space. */
  weight: number;
}

export interface CorosWatchfaceEditorGroup {
  id: string;
  name: string;
  /** Flat editor-layer ids. Groups are flattened during watch export. */
  layerIds: string[];
}

export interface CorosWatchfaceEditorGuide {
  id: string;
  axis: "x" | "y";
  /** Position in the editor's largest preview-resolution coordinate space. */
  position: number;
}

export interface CorosWatchfaceDesignSprite {
  id: string;
  /** User-facing layer name. Absent keeps the legacy “Imported sprite” label. */
  name?: string;
  dataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Absent means fully opaque for legacy projects. */
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Skew angles are clamped to -80..80 degrees by the editor. */
  skewX?: number;
  skewY?: number;
  /** Imported images preserve proportions unless explicitly unlocked. */
  aspectLocked?: boolean;
  /** Normalized source crop. Absent means the complete source image. */
  crop?: CorosWatchfaceSpriteCrop;
  /** Normalized pivot for rotation and skew. */
  origin?: CorosWatchfaceTransformOrigin;
  /** Absent means visible for projects saved before layer toggles. */
  visible?: boolean;
  /** Optional monochrome tint while preserving the imported image alpha. */
  tintColor?: string | null;
}

/** A two-stop linear gradient fill, angle in degrees clockwise from +x. */
export interface CorosWatchfaceGradientFill {
  from: string;
  to: string;
  angle: number;
}

/** Base fields shared by every freeform background shape (in 800px space). */
interface CorosWatchfaceBackgroundElementBase {
  id: string;
  x: number;
  y: number;
  rotation: number;
  /** Absent means visible for projects saved before group visibility controls. */
  visible?: boolean;
  /** Absent means fully opaque for legacy projects. */
  opacity?: number;
}

export interface CorosWatchfaceBackgroundRect extends CorosWatchfaceBackgroundElementBase {
  kind: "rect";
  width: number;
  height: number;
  /** When true, editing width or height preserves the shape's proportions. */
  aspectLocked?: boolean;
  cornerRadius: number;
  fill: string;
  gradient?: CorosWatchfaceGradientFill;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface CorosWatchfaceBackgroundEllipse extends CorosWatchfaceBackgroundElementBase {
  kind: "ellipse";
  width: number;
  height: number;
  /** When true, editing width or height preserves the shape's proportions. */
  aspectLocked?: boolean;
  fill: string;
  gradient?: CorosWatchfaceGradientFill;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface CorosWatchfaceBackgroundLine extends CorosWatchfaceBackgroundElementBase {
  kind: "line";
  /** End point relative to (x, y). */
  dx: number;
  dy: number;
  color: string;
  strokeWidth: number;
}

export interface CorosWatchfaceBackgroundText extends CorosWatchfaceBackgroundElementBase {
  kind: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  weight: number;
  align: "left" | "center" | "right";
}

export type CorosWatchfaceBackgroundElement =
  | CorosWatchfaceBackgroundRect
  | CorosWatchfaceBackgroundEllipse
  | CorosWatchfaceBackgroundLine
  | CorosWatchfaceBackgroundText;

/** Firmware-drawn calorie goal progress. */
export interface CorosWatchfaceKcalProgressStyle {
  /** Resolution whose pixel coordinate system the stored geometry uses. */
  referenceWidth?: number;
  referenceHeight?: number;
  arcEnabled: boolean;
  rectEnabled: boolean;
  arcColor: string;
  rectColor: string;
  /** Editor-only sample used by the live preview; the watch supplies the real percentage. */
  previewPercent: number;
  arc: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    startAngle: number;
    endAngle: number;
    strokeWidth: number;
    /** COROS flag: draw the uncompleted portion instead of the completed portion. */
    background: boolean;
  };
  rect: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    direction: "left" | "right" | "top" | "bottom";
  };
}

/** Firmware-drawn exercise-goal progress arc/bar. */
export interface CorosWatchfaceExerciseProgressStyle {
  /** Resolution whose pixel coordinate system the stored geometry uses. */
  referenceWidth?: number;
  referenceHeight?: number;
  /** Keeps the legacy serialized name for the rectangular progress bar. */
  enabled: boolean;
  arcEnabled: boolean;
  color: string;
  /** Editor-only sample used by the live preview; the watch supplies the real percentage. */
  previewPercent: number;
  arc: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    startAngle: number;
    endAngle: number;
    strokeWidth: number;
    /** COROS flag: draw the uncompleted portion instead of the completed portion. */
    background: boolean;
  };
  rect: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    direction: "left" | "right" | "top" | "bottom";
  };
}

export interface CorosWatchfaceDesignState {
  version: 1;
  /**
   * Independent visual state for alternate firmware display modes. Current
   * display fields remain at the top level for backwards compatibility.
   */
  modeDesigns?: {
    aod?: CorosWatchfaceModeDesignState;
  };
  /** Exact archive `o_wf_ver`; absent keeps automatic compatibility behavior. */
  archiveWatchFaceVersion?: number;
  /** Deletes blank `[key]=` config lines from built archives (see creator input). */
  stripBlankConfigKeys?: boolean;
  /**
   * Studio raw-text edits for template `config.txt` / `AODconfig.txt` paths.
   * Keys are archive-relative paths; values are full UTF-8 file bodies.
   */
  configTextEdits?: Record<string, string>;
  /** Solid base colour painted behind artwork and freeform background elements. */
  backgroundColor?: string;
  accentColor: string;
  artwork: CorosWatchfaceArtwork | null;
  /** Whether the source artwork is painted into the composed background. */
  artworkVisible?: boolean;
  zoom: number;
  fontFamily: string;
  /** Optional portable PNG glyph atlas, used when no local font is selected. */
  rasterFont?: CorosWatchfaceRasterFont;
  /** Typography settings for rasterized digit and date sprites. */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Character spacing as a fraction of the font size (for example 0.04). */
  letterSpacing?: number;
  digitColor: string;
  tintLabels: boolean;
  tintIcons: boolean;
  previewComplication: string;
  metricChanges: Record<string, boolean>;
  metricStyles: Record<string, { color?: string; scale: number; rotation?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont }>;
  /** Optional native calorie goal arc/bar configuration. */
  kcalProgress?: CorosWatchfaceKcalProgressStyle;
  /** Optional native exercise-goal bar configuration. */
  exerciseProgress?: CorosWatchfaceExerciseProgressStyle;
  /** Shared digit style for every value shown in the selectable control slot. */
  selectableMetricStyle?: {
    color?: string;
    scale: number;
    /** Clockwise rotation applied inside each firmware sprite canvas. */
    rotation?: number;
    fontFamily?: string;
    letterSpacing?: number;
    rasterFont?: CorosWatchfaceRasterFont;
    /** Preserve each selectable digit's natural width and expand value rectangles. */
    nativeSize?: boolean;
  };
  /**
   * Per-component selectable-control state. Missing entries inherit whether
   * the imported template already declares that component.
   */
  controlComplicationEnabled?: Record<string, boolean>;
  /** Selects one mutually exclusive native barometer parser branch. */
  controlBarometerMode?: "static" | "directional";
  /** False removes the Battery choice from the firmware-selectable control slot. */
  controlBatteryEnabled?: boolean;
  /** False removes the Sunrise choice from the firmware-selectable control slot. */
  controlSunriseEnabled?: boolean;
  /** False removes the Sunset choice from the firmware-selectable control slot. */
  controlSunsetEnabled?: boolean;
  /** False removes the Floors choice from the firmware-selectable control slot. */
  controlFloorEnabled?: boolean;
  /** False removes the Temperature choice from the firmware-selectable control slot. */
  controlTemperatureEnabled?: boolean;
  /** Per selectable-control icon offsets, independent from the slot origin/value. */
  controlIconOffsets?: Record<string, { dx: number; dy: number }>;
  /** Converts firmware auto-aligned HH:MM into four independently positioned digits. */
  separateAutoTime?: boolean;
  timeStyles: Record<string, { color?: string; scale: number; rotation?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont }>;
  /** Weekday/month/day sizing; absent in projects saved before resizing. */
  dateStyles?: Record<
    string,
    {
      scale: number;
      /** Clockwise rotation applied inside each firmware sprite canvas. */
      rotation?: number;
      /** Exact exported PNG dimensions when set. */
      width?: number;
      height?: number;
      /** Imported PNG dimensions preserve their proportions unless unlocked. */
      aspectLocked?: boolean;
      /** Date-month rendering mode; absent preserves the starter's format. */
      monthFormat?: "digits" | "labels";
      fontFamily?: string;
      color?: string;
      letterSpacing?: number;
      rasterFont?: CorosWatchfaceRasterFont;
      /** Legacy weekday/date-day natural-width mode. */
      nativeSize?: boolean;
    }
  >;
  staticSeparators: Record<
    "colon" | "dateSlash",
    {
      enabled: boolean;
      x: number;
      y: number;
      size: number;
      color: string;
      fontFamily?: string;
    }
  >;
  /** AM/PM indicator styling; absent in projects saved before the feature. */
  ampmIndicator?: {
    enabled: boolean;
    x: number;
    y: number;
    scale: number;
    /** Optional tint; absent preserves the template sprite color. */
    color?: string;
    fontFamily?: string;
  };
  /** Dynamic 41-state weather icon; absent in older projects. */
  weatherIndicator?: {
    enabled: boolean;
    x: number;
    y: number;
    scale: number;
    /** Optional tint applied to all weather states. */
    color?: string;
  };
  layoutOffsets: Record<string, { dx: number; dy: number }>;
  /**
   * Editor layer ids whose positions should change together. The ids are kept
   * at editor level so firmware-backed layers and freeform artwork can share a
   * link group without changing the exported watch-face format.
   */
  linkedLayerGroups?: string[][];
  /** Persistent flat groups used by the modern editor. */
  editorGroups?: CorosWatchfaceEditorGroup[];
  /** Project-specific ruler guides in preview coordinates. */
  editorGuides?: CorosWatchfaceEditorGuide[];
  /**
   * Editor layer ids whose positions are protected from drag, nudge, and
   * inspector position edits. This is an editor-only setting and does not
   * alter the exported watch-face format.
   */
  lockedLayerIds?: string[];
  /** Reusable, live-linked visual-effect styles. */
  effectStyles?: CorosWatchfaceEffectStyle[];
  /** Effects keyed by editor layer id, or by `aod:<id>` for always-on assets. */
  layerEffects?: Record<string, CorosWatchfaceEffectBinding>;
  /** Ordered front-to-back stroke stacks keyed by editor layer id. */
  layerStrokes?: Record<string, CorosWatchfaceStroke[]>;
  /** Visibility overrides for firmware-backed editor layers. */
  layerVisibility?: Record<string, boolean>;
  /** Normalized 0..1 opacity keyed by editor layer id. */
  layerOpacities?: Record<string, number>;
  /** Per-layer colors for firmware components without specialized styles. */
  layerColors?: Record<string, string>;
  /** Per-config PNG visibility and isolated replacement choices. */
  configAssetOverrides?: Record<string, CorosWatchfaceConfigAssetOverride>;
  designSprites: CorosWatchfaceDesignSprite[];
  /**
   * Imported-image and freeform-element ids in bottom-to-top paint order.
   * Absent preserves the legacy order: shapes first, imported images above.
   */
  artworkLayerOrder?: string[];
  /**
   * Freeform vector shapes baked into the background PNG (800px space).
   * Absent in projects saved before the background design canvas.
   */
  backgroundElements?: CorosWatchfaceBackgroundElement[];
}

/**
 * Visual/editor state that can diverge between Current and Always-on without
 * duplicating archive-wide settings or raw config text.
 */
export type CorosWatchfaceModeDesignState = Partial<
  Pick<
    CorosWatchfaceDesignState,
    | "backgroundColor"
    | "accentColor"
    | "artwork"
    | "artworkVisible"
    | "zoom"
    | "fontFamily"
    | "rasterFont"
    | "fontWeight"
    | "fontStyle"
    | "letterSpacing"
    | "digitColor"
    | "tintLabels"
    | "tintIcons"
    | "previewComplication"
    | "metricChanges"
    | "metricStyles"
    | "kcalProgress"
    | "exerciseProgress"
    | "selectableMetricStyle"
    | "controlComplicationEnabled"
    | "controlBarometerMode"
    | "controlIconOffsets"
    | "separateAutoTime"
    | "timeStyles"
    | "dateStyles"
    | "staticSeparators"
    | "ampmIndicator"
    | "weatherIndicator"
    | "layoutOffsets"
    | "linkedLayerGroups"
    | "editorGroups"
    | "editorGuides"
    | "lockedLayerIds"
    | "effectStyles"
    | "layerEffects"
    | "layerStrokes"
    | "layerVisibility"
    | "layerOpacities"
    | "layerColors"
    | "configAssetOverrides"
    | "designSprites"
    | "artworkLayerOrder"
    | "backgroundElements"
  >
> & {
  /** Whether Studio must emit a flattened background for this mode. */
  backgroundEdited?: boolean;
};

export interface CorosWatchfaceProjectSummary {
  projectId: string;
  name: string;
  updatedAt: string;
  /** Decimal text: official template IDs exceed Number.MAX_SAFE_INTEGER. */
  sourceTemplateId: string;
  /** Firmware family the project's starter template was selected for. */
  firmwareType?: string;
  /** Cached dashboard thumbnail, generated when the project was last saved. */
  previewDataUrl?: string;
}

export interface CorosWatchfaceProjectSaveInput {
  projectId?: string;
  name: string;
  sourceArchiveId: string;
  firmwareType?: string;
  design: CorosWatchfaceDesignState;
  /** Small rendered preview used by the projects dashboard. */
  previewDataUrl?: string;
}

export interface CorosWatchfaceEditableProject {
  name: string;
  design: CorosWatchfaceDesignState;
}

export interface CorosWatchfaceProjectExportInput
  extends CorosWatchfaceEditableProject {
  sourceArchiveId: string;
  firmwareType?: string;
  /** Current rendered face used by websites as the package thumbnail. */
  previewDataUrl: string;
}

export interface CorosWatchfaceProject extends CorosWatchfaceProjectSummary {
  archive: CorosWatchfaceArchive;
  design: CorosWatchfaceDesignState;
}

/** The official COROS hand-off link and an offline QR image for opening it. */
export interface CorosWatchfaceShareLink {
  url: string;
  qrDataUrl: string;
  expiresAt: string;
  previewImageUrl?: string;
}

export interface LocalTrack {
  id: string;
  url: string;
  title: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  transferredAt?: string;
}

export interface DownloadAudioResult {
  tracks: LocalTrack[];
  output: string[];
  warnings?: string[];
}

export type DownloadJobStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadActivityPhase =
  | "starting"
  | "downloading"
  | "converting"
  | "between_tracks"
  | "completed"
  | "failed";

export interface DownloadProgressUpdate {
  trackProgress?: number;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  phase?: DownloadActivityPhase;
  activity?: string;
  completedTrackIncrement?: number;
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: DownloadJobStatus;
  progress: number;
  error?: string;
  tracks: LocalTrack[];
  createdAt: string;
  updatedAt: string;
  entryType?: "video" | "playlist" | "search" | "audio";
  query?: string;
  fileBaseName?: string;
  phase?: DownloadActivityPhase;
  trackIndex?: number;
  trackTotal?: number;
  currentTrackTitle?: string;
  trackProgress?: number;
  activity?: string;
  completedTrackCount?: number;
  warning?: string;
}

export type DownloadQueueItem =
  | {
      url: string;
      title?: string;
    }
  | {
      source: "search";
      query: string;
      title: string;
      sourceUrl: string;
      fileBaseName?: string;
    }
  | {
      /** A directly downloadable public audio asset, such as a podcast RSS enclosure. */
      source: "audio";
      audioUrl: string;
      title: string;
      fileBaseName?: string;
    };

export type YouTubeHistoryEntryType =
  | "video"
  | "playlist"
  | "search"
  | "youtube";

export interface YouTubeHistoryEntry {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
  visits: number;
  lastVisitedAt: string;
  downloadedAt?: string;
}

export interface YouTubeMusicStatus {
  configured: boolean;
  pythonAvailable: boolean;
  ytmusicapiAvailable: boolean;
  authenticated: boolean;
  authMethod?: "headers" | "oauth";
  authUpdatedAt?: string;
  syncedAt?: string;
  songCount: number;
  albumCount: number;
  playlistCount: number;
  dependencyError?: string;
}

export interface YouTubeMusicConfig {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeMusicSong {
  id: string;
  videoId?: string;
  songTitle: string;
  albumTitle?: string;
  artistName?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeMusicAlbum {
  id: string;
  browseId?: string;
  playlistId?: string;
  albumTitle: string;
  artistName?: string;
  year?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicPlaylist {
  id: string;
  playlistId?: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  songCount: number;
  songs: YouTubeMusicSong[];
}

export interface YouTubeMusicLibrary {
  albums: YouTubeMusicAlbum[];
  songs: YouTubeMusicSong[];
  playlists: YouTubeMusicPlaylist[];
  syncedAt?: string;
}

/**
 * Result pushed to the renderer when the embedded YouTube Music sign-in captures
 * credentials: the refreshed status on success, or a message if the ytmusicapi
 * setup failed (e.g. Python/ytmusicapi missing).
 */
export type YouTubeMusicAuthCapture =
  | { status: YouTubeMusicStatus; error?: undefined }
  | { status?: undefined; error: string };

export interface YouTubeMusicSyncResult extends YouTubeMusicLibrary {
  status: YouTubeMusicStatus;
}

export interface AppleMusicStatus {
  authenticated: boolean;
  hasUserToken: boolean;
  authUpdatedAt?: string;
}

export interface AppleMusicTrack {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  durationMs?: number;
  trackNumber?: number;
  isrc?: string;
  artworkUrl?: string;
  catalogUrl?: string;
}

export interface AppleMusicPlaylist {
  id: string;
  kind: "catalog" | "library";
  name: string;
  description?: string;
  curatorName?: string;
  lastModifiedAt?: string;
  artworkUrl?: string;
  url?: string;
  trackCount: number;
  tracks: AppleMusicTrack[];
}

/** A show returned by Apple's public podcast catalogue. */
export interface ApplePodcastShow {
  /** Apple Podcasts collection id, serialized so it is safe across IPC. */
  id: string;
  /** Two-letter storefront used to resolve this show. */
  storefront: string;
  title: string;
  authorName?: string;
  description?: string;
  artworkUrl?: string;
  genre?: string;
  episodeCount?: number;
  /** Canonical Apple Podcasts show URL, when Apple supplies one. */
  applePodcastsUrl?: string;
  /** Public RSS feed URL. Absent for feedless or restricted shows. */
  feedUrl?: string;
}

/** A publicly downloadable audio enclosure from a podcast RSS feed. */
export interface ApplePodcastEpisode {
  /** Stable RSS GUID when present, otherwise the enclosure URL. */
  id: string;
  title: string;
  description?: string;
  publishedAt?: string;
  durationSeconds?: number;
  episodeNumber?: number;
  seasonNumber?: number;
  artworkUrl?: string;
  audioUrl: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ApplePodcastShowDetail extends ApplePodcastShow {
  episodes: ApplePodcastEpisode[];
  /** Total valid public RSS episodes currently available from this feed. */
  totalEpisodeCount: number;
  /** Whether another page of older episodes can be loaded in this session. */
  hasMoreEpisodes: boolean;
}

export interface TransferResult {
  copiedTrack: WatchTrack;
  watch: WatchStatus;
}

/**
 * Streamed progress for a single track being copied to the watch. Emitted from
 * the main process while `watch:transferLocalTrack` runs so the renderer can
 * show live progress instead of freezing on a synchronous copy.
 */
export interface WatchTransferProgress {
  /** Download id of the track currently transferring. */
  id: string;
  /** File name of the track currently transferring. */
  name: string;
  copiedBytes: number;
  totalBytes: number;
  /** 0..1 progress of the current file. */
  progress: number;
}

export type CorosMapType = "landscape" | "topo";

export interface CorosMapPackage {
  id: string;
  region: string;
  parent: string;
  title: string;
  type: CorosMapType;
  sizeBytes: number;
  link: string;
  downloadUrl: string;
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
}

export interface CorosMapManifest {
  version: string;
  bundleVersion?: string;
  updatedAt?: string;
  totalSizeBytes?: number;
  packages: CorosMapPackage[];
}

export type CorosMapDownloadStatus =
  | "queued"
  | "downloading"
  | "cached"
  | "failed"
  | "cancelled";

export interface CorosMapDownloadJob {
  id: string;
  packageId: string;
  title: string;
  region: string;
  type: CorosMapType;
  downloadUrl: string;
  sizeBytes: number;
  status: CorosMapDownloadStatus;
  progress: number;
  receivedBytes: number;
  filePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedCorosMapPackage {
  packageId: string;
  title: string;
  region: string;
  parent: string;
  type: CorosMapType;
  sizeBytes: number;
  downloadUrl: string;
  filePath: string;
  extractedPath?: string;
  downloadedAt: string;
}

export interface CorosMapLocalSelection {
  sourcePath: string;
  mapPath: string;
  sizeBytes: number;
  fileCount: number;
}

export interface CorosMapInstallResult extends CorosMapLocalSelection {
  installedPath: string;
  watch: WatchStatus;
}

export type CorosMapInstallPhase =
  | "preparing"
  | "copying"
  | "completed"
  | "failed"
  | "cancelled";

export interface CorosMapInstallProgress {
  active: boolean;
  phase: CorosMapInstallPhase;
  label: string;
  sourcePath?: string;
  installedPath?: string;
  copiedBytes: number;
  totalBytes: number;
  copiedFiles: number;
  totalFiles: number;
  progress: number;
  error?: string;
  updatedAt: string;
}

export type RouteMode = "loop" | "point-to-point";
export type RouteSurfacePreference = "road" | "trail";
export type RouteElevationPreference = "any" | "flatter" | "hilly";
export type RouteActivityType =
  | "walking"
  | "running"
  | "hiking"
  | "cycling-road"
  | "cycling-mountain";

/**
 * Which routing/geocoding backend the Route Studio uses.
 * - `keyless` (default): BRouter + Nominatim, no signup required.
 * - `ors`: OpenRouteService, requires a saved API key (power users).
 */
export type RouteBackend = "keyless" | "ors";

export interface RouteBuilderConfig {
  /** Optional OpenRouteService key; only used when `backend` is `ors`. */
  openRouteServiceApiKey: string;
  /** Selected routing backend. Absent is treated as `keyless`. */
  backend?: RouteBackend;
}

/** A single map waypoint the draw tool routes through. */
export interface RouteWaypoint {
  lat: number;
  lon: number;
}

/**
 * Request for the interactive draw tool. `snap` routes each leg along real
 * roads/trails (BRouter); otherwise legs are straight lines.
 */
export interface RouteWaypointRequest {
  waypoints: RouteWaypoint[];
  activityType: RouteActivityType;
  snap: boolean;
}

/** Geometry + stats for a routed path, without any persistence. */
export interface RouteGeometry {
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
}

/** Payload used to persist a finished drawn route. */
export interface DrawnRoutePayload {
  name?: string;
  waypoints: RouteWaypoint[];
  points: TrainingHubTrackPoint[];
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  activityType: RouteActivityType;
  /** True when the path returns to its start (a loop). */
  closed: boolean;
  snap: boolean;
}

export interface RouteApiKeyValidation {
  status: "valid" | "invalid" | "quota" | "error" | "empty";
  message: string;
}

export interface ActivityPaceBaseline {
  /** Typical (median) pace in seconds per kilometre for a sport. */
  secondsPerKm: number;
  /** Number of stored activities the pace was derived from. */
  sampleSize: number;
}

/** Personal pace baselines keyed by route activity type (only sports with data). */
export type ActivityPaceBaselines = Partial<
  Record<RouteActivityType, ActivityPaceBaseline>
>;

export interface RouteShareSession {
  /** Full LAN URL the QR encodes; the phone fetches the GPX from here. */
  url: string;
  /** PNG data URL of the QR code for the share URL. */
  qrDataUrl: string;
  fileName: string;
  /** LAN IP the GPX is served from (shown for troubleshooting). */
  lanAddress: string;
  /** ISO timestamp when the share link auto-expires. */
  expiresAt: string;
}

export interface RouteGeocodeResult {
  label: string;
  lat: number;
  lon: number;
  city?: string;
  country?: string;
}

export interface GenerateRouteRequest {
  startLocation: string;
  destinationLocation?: string;
  distanceKm: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  /**
   * Optional nudge used only for loop routes. Changing it produces a different
   * loop for the same inputs (powers the "Regenerate" control). Absent keeps the
   * deterministic default behaviour.
   */
  variationSeed?: number;
}

export interface GeneratedRoute {
  id: string;
  name: string;
  createdAt: string;
  startLocation: string;
  destinationLocation?: string;
  distanceMeters: number;
  durationSeconds?: number;
  ascentMeters?: number;
  descentMeters?: number;
  mode: RouteMode;
  activityType: RouteActivityType;
  surfacePreference: RouteSurfacePreference;
  avoidHighways: boolean;
  elevationPreference: RouteElevationPreference;
  points: TrainingHubTrackPoint[];
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  gpxPath?: string;
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SpotifyStatus {
  configured: boolean;
  authenticated: boolean;
  redirectUri: string;
  displayName?: string;
  userId?: string;
  tokenExpiresAt?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  collaborative: boolean;
  public: boolean | null;
  totalTracks: number;
  snapshotId: string;
  syncable: boolean;
  description?: string;
  artworkUrl?: string;
  url?: string;
}

export interface SpotifyPlaylistTrack {
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  albumName?: string;
  durationMs?: number;
  addedAt?: string;
  filename: string;
  query: string;
  artworkUrl?: string;
}

export type SpotifySyncTrackStatus =
  | "queued"
  | "downloading"
  | "done"
  | "failed";

export interface SpotifySyncTrack {
  playlistId: string;
  spotifyTrackId: string;
  artistName: string;
  trackName: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  localDownloadId?: string;
  filePath?: string;
  error?: string;
  updatedAt: string;
}

export interface SpotifySyncUpdate extends SpotifySyncTrack {}

export interface SpotifySyncResult {
  playlistId: string;
  tracks: SpotifySyncTrack[];
  completed: number;
  failed: number;
}

export interface TrainingHubStatus {
  authenticated: boolean;
  userId?: string;
  regionId?: string;
  baseUrl?: string;
  rememberCredentials?: boolean;
  email?: string;
}

// Result of a login/reconnect attempt. When the COROS account has two-factor
// authentication enabled, the first step returns `twoFactorRequired: true`
// (with the code already emailed) and the caller must complete the flow via
// `verifyTrainingHubTwoFactor(code)`.
export interface TrainingHubLoginResult {
  twoFactorRequired: boolean;
  status: TrainingHubStatus;
  // Account (email) awaiting a 2FA code — used by the UI copy while verifying.
  email?: string;
}

// COROS `/activity/detail/download` file-type codes. Verified against the live
// teamapi.coros.com endpoint: 0=CSV, 1=GPX, 2=KML, 3=TCX, 4=FIT (5/6 are rejected).
export type TrainingHubActivityFileType = 0 | 1 | 2 | 3 | 4;

export interface TrainingHubExportFormat {
  fileType: TrainingHubActivityFileType;
  /** Short label shown in the UI, e.g. "GPX". */
  label: string;
  /** Lower-case file extension without a leading dot, e.g. "gpx". */
  extension: string;
  /** One-line hint describing what the format is good for. */
  description: string;
}

// Ordered for the export menu: the everyday formats first, raw data last.
export const TRAINING_HUB_EXPORT_FORMATS: readonly TrainingHubExportFormat[] = [
  {
    fileType: 4,
    label: "FIT",
    extension: "fit",
    description: "Original COROS activity file"
  },
  {
    fileType: 1,
    label: "GPX",
    extension: "gpx",
    description: "GPS track for GPX Studio, Plotaroute, sharing"
  },
  {
    fileType: 3,
    label: "TCX",
    extension: "tcx",
    description: "Training Center XML with heart rate & laps"
  },
  {
    fileType: 2,
    label: "KML",
    extension: "kml",
    description: "Route for Google Earth"
  },
  {
    fileType: 0,
    label: "CSV",
    extension: "csv",
    description: "Raw data points as a spreadsheet"
  }
];

export interface TrainingHubExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean;
  /** Absolute path the file was written to, when saved. */
  filePath?: string;
  /** Activity metadata for convenience messages after a save dialog closes. */
  activityId?: string;
  activityName?: string;
  activityStartTime?: number;
  fileType?: TrainingHubActivityFileType;
  formatLabel?: string;
}

export type ActivityBackupState =
  | "listing"
  | "downloading"
  | "done"
  | "cancelled"
  | "error";

/** Live progress for a bulk activity backup run. */
export interface ActivityBackupProgress {
  state: ActivityBackupState;
  folder: string;
  fileType: TrainingHubActivityFileType;
  formatLabel: string;
  /** Activities discovered on the COROS account (0 while listing). */
  total: number;
  /** Files downloaded during this run. */
  completed: number;
  /** Activities skipped because the file already exists in the folder. */
  skipped: number;
  failed: number;
  /** Name of the activity currently downloading. */
  currentName?: string;
  error?: string;
}

export interface TrainingHubActivity {
  activityId: string;
  name?: string;
  sportType: number;
  sportName?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  trainingLoad?: number;
  elevationGain?: number;
}

export interface RpeDistributionBucket {
  /** RPE level 1..5. */
  level: number;
  /** Number of rated sessions at this level. */
  frequency: number;
  /** Sum of session sRPE (Foster CR10 × duration minutes) at this level. */
  srpe: number;
  /** Sum of duration seconds at this level. */
  timeSeconds: number;
}

export interface RpeDistribution {
  /** Exactly 5 buckets, level 1..5, always present (zeros allowed). */
  buckets: RpeDistributionBucket[];
  coverage: {
    /** Activities with feel_type in 1..5 within the window. */
    rated: number;
    /** All activities within the window (rated + unrated). */
    total: number;
  };
}

export interface TrainingHubDailyMetric {
  happenDay: string;
  trainingLoad?: number;
  /** Foster session-RPE load (AU) for the day, from cached activity feelType. */
  rpeLoad?: number;
  rhr?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  tiredRateNew?: number;
  tiredRateStateNew?: number;
  trainingLoadRatio?: number;
  staminaLevel?: number;
  vo2max?: number;
  distance?: number;
  duration?: number;
}

export interface TrainingHubDailyMetrics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  raw?: Record<string, unknown>;
}

export interface TrainingHubSportStatistic {
  sportType?: number;
  sportName?: string;
  distance?: number;
  duration?: number;
  count?: number;
  trainingLoad?: number;
}

export interface TrainingHubZoneDistributionEntry {
  index: number;
  ratio?: number;
  value?: number;
}

export interface TrainingHubZoneDistributions {
  hrTrainingLoad: TrainingHubZoneDistributionEntry[];
  hrDistance: TrainingHubZoneDistributionEntry[];
  hrTime: TrainingHubZoneDistributionEntry[];
  distanceFrequency: TrainingHubZoneDistributionEntry[];
  distanceTrainingLoad: TrainingHubZoneDistributionEntry[];
  distanceTime: TrainingHubZoneDistributionEntry[];
}

export interface TrainingHubAnalytics {
  dayList: TrainingHubDailyMetric[];
  weekList: Record<string, unknown>[];
  sportStatistics: TrainingHubSportStatistic[];
  zoneDistributions: TrainingHubZoneDistributions;
  rpeDistribution: RpeDistribution;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRaceScore {
  distance?: number;
  distanceLabel?: string;
  predictSeconds?: number;
  avgPace?: number;
  score?: number;
  raw?: Record<string, unknown>;
}

export interface TrainingHubRacePredictor {
  staminaLevel?: number;
  recoveryPct?: number;
  aerobicEnduranceScore?: number;
  lactateThresholdCapacityScore?: number;
  anaerobicEnduranceScore?: number;
  anaerobicCapacityScore?: number;
  lthr?: number;
  ltsp?: number;
  runScoreList: TrainingHubRaceScore[];
  raw?: Record<string, unknown>;
}

export interface TrainingHubActivityLap {
  index: number;
  distance?: number;
  duration?: number;
  avgHr?: number;
  maxHr?: number;
  pace?: number;
  elevationGain?: number;
}

export interface TrainingHubTrackPoint {
  lat?: number;
  lon?: number;
  elevation?: number;
  distance?: number;
}

export interface TrainingHubActivityTrack {
  points: TrainingHubTrackPoint[];
}

export interface TrainingHubActivitySeriesPoint {
  distance?: number;
  hr?: number;
  pace?: number;
  power?: number;
}

export interface StrengthSet {
  reps: number;
  weightKg: number;
  workSec: number;
  restSec: number;
  calories: number;
}

export interface StrengthExercise {
  nameKey: string;   // "T####"/"S####" library code, or a custom name
  rawName?: string;  // payload name, used to resolve custom exercises
  sets: number;
  totalReps: number;
  entries: StrengthSet[];
}

export interface StrengthSummary {
  sets: number;
  totalReps: number;
  totalWeightKg: number;
  exercises: number;
  calories: number;
  durationSec: number;
  avgHr?: number;
  maxHr?: number;
  trainingLoad?: number;
  aerobicEffect?: number;
  anaerobicEffect?: number;
}

export interface StrengthDetail {
  summary: StrengthSummary;
  exercises: StrengthExercise[];
}

export interface TrainingHubActivityDetail {
  activityId?: string;
  name?: string;
  sportType?: number;
  sportName?: string;
  startTime?: number;
  duration?: number;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGain?: number;
  trainingLoad?: number;
  laps: TrainingHubActivityLap[];
  track?: TrainingHubActivityTrack;
  series?: TrainingHubActivitySeriesPoint[];
  strength?: StrengthDetail;
  raw: Record<string, unknown>;
}

export interface TrainingHubScheduledExercise {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
  targetType?: number;
  targetLabel?: string;
}

export interface TrainingHubSportType {
  sportType: number;
  sportName: string;
}

export interface TrainingHubUpcomingWorkout {
  happenDay: string;
  name: string;
  volume?: string;
  trainingLoad?: number;
  sportType?: number;
  sortNo?: number;
  exercises?: TrainingHubScheduledExercise[];
}

export interface TrainingHubThresholdZone {
  index: number;
  hr?: number;
  pace?: number;
  ratio?: number;
}

export interface TrainingHubPersonalRecord {
  type: number;
  label: string;
  name?: string;
  distance?: number;
  duration?: number;
  avgPace?: number;
  happenDay?: string;
  activityId?: string;
  /** Raw COROS record `type` before alias resolution (used when deduping). */
  apiType?: number;
}

export interface TrainingHubPersonalRecordGroup {
  type: number;
  label: string;
  records: TrainingHubPersonalRecord[];
}

export interface TrainingHubSleepHrvReading {
  happenDay: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
}

export interface TrainingHubSleepHrvSummary {
  happenDay?: string;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  remainWearDays?: number;
  recentReadings: TrainingHubSleepHrvReading[];
}

export interface TrainingHubSleepRecord {
  happenDay: string;
  kind?: "main" | "nap";
  completeness?: "complete" | "partial";
  partialReason?: string;
  totalMinutes?: number;
  score?: number;
  deepMinutes?: number;
  lightMinutes?: number;
  remMinutes?: number;
  awakeMinutes?: number;
  deepPercent?: number;
  lightPercent?: number;
  remPercent?: number;
  awakePercent?: number;
  awakeCountOverFiveMinutes?: number;
  windowMinutes?: number;
  napMinutes?: number;
  napStart?: string;
  napEnd?: string;
  avgHr?: number;
  sleepStart?: string;
  sleepEnd?: string;
}

export interface TrainingHubSleepSummary {
  latest?: TrainingHubSleepRecord;
  records: TrainingHubSleepRecord[];
  mcpConnected: boolean;
}

export interface TrainingHubDailyHealthRecord {
  happenDay: string;
  steps?: number;
  calories?: number;
}

export interface TrainingHubDailyHealthSummary {
  latest?: TrainingHubDailyHealthRecord;
  records: TrainingHubDailyHealthRecord[];
  mcpConnected: boolean;
}

export interface TrainingHubDashboard {
  racePredictor: TrainingHubRacePredictor;
  rhr?: number;
  recoveryPct?: number;
  recoveryState?: number;
  fullRecoveryHours?: number;
  fitnessMaxHr?: number;
  runningLevelHr?: number;
  lthrZones: TrainingHubThresholdZone[];
  ltspZones: TrainingHubThresholdZone[];
  personalRecords: TrainingHubPersonalRecordGroup[];
  sleepHrv?: TrainingHubSleepHrvSummary;
  sportDataCount?: number;
  raw?: Record<string, unknown>;
}

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateSnapshot {
  supported: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  availableVersion?: string;
  downloadPercent?: number;
  releaseNotes?: string;
  error?: string;
  /** macOS ad-hoc builds cannot self-install; user must open the release asset. */
  installMethod?: "restart" | "manual";
  manualInstallUrl?: string;
  /** When false, the app does not check for updates automatically on startup. */
  autoCheck: boolean;
  /** When false, available updates are not downloaded until the user asks. */
  autoDownload: boolean;
}

export interface AppStorageLocation {
  id: string;
  label: string;
  description: string;
  path: string;
  kind: "directory" | "file";
  exists: boolean;
  /** Null when the location does not exist or its size could not be read. */
  sizeBytes: number | null;
}

export interface AppInfo {
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  userDataPath: string;
  storageLocations: AppStorageLocation[];
}

// ----- Training Coach chatbot -----

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Optional assistant attribution metadata stored with a message. */
export interface PersistedChatSource {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

export interface PersistedChatMessageEntry {
  kind: "message";
  role: ChatRole;
  content: string;
  source?: PersistedChatSource;
}

export type ChatProvider = "chatgpt" | "claude-code" | "local";

export type ClaudeCodeConnectionState =
  | "not-installed"
  | "sign-in-required"
  | "connecting"
  | "connected"
  | "connection-failed"
  | "usage-limit-reached";

export interface ClaudeCodePermissions {
  recentActivities: boolean;
  trainingMetrics: boolean;
  upcomingWorkouts: boolean;
  sleepData: boolean;
  fullActivityFiles: boolean;
}

export interface ClaudeCodeConfig {
  /** Optional user-selected path. CorosLink never reads Claude credential files. */
  executablePath?: string;
  /** Model alias (e.g. "opus", "sonnet", "haiku") or full id. Empty = account default. */
  model?: string;
  lastConnectionStatus?: ClaudeCodeConnectionState;
  lastCheckedAt?: string;
  permissions: ClaudeCodePermissions;
}

export interface ClaudeCodeStatus {
  state: ClaudeCodeConnectionState;
  installed: boolean;
  authenticated: boolean;
  executablePath?: string;
  version?: string;
  authMethod?: string;
  subscriptionType?: string;
  checkedAt: string;
  message: string;
}

export interface ClaudeCodeConnectionTest {
  ok: boolean;
  status: ClaudeCodeStatus;
  message: string;
}

export interface LocalChatConfig {
  /** OpenAI-compatible API base URL, normalized to end in /v1. */
  baseUrl: string;
  /** Model id as listed by the local server, e.g. llama3.2 or qwen3:8b. */
  model: string;
  /** True when an encrypted API key is stored; token material is never returned. */
  hasApiKey: boolean;
  /** Optional token used only when saving/testing settings; never returned by get. */
  apiKey?: string;
  /** Set true when saving to remove any stored local API key. */
  clearApiKey?: boolean;
  /** Attach COROS MCP tools when the local endpoint accepts OpenAI-style tools. */
  toolsEnabled: boolean;
}

export interface ChatSettings {
  provider: ChatProvider;
  claudeCode: ClaudeCodeConfig;
  local: LocalChatConfig;
  sidebarOpen?: boolean;
  /** When true, show activity/fitness/HR chart cards in the transcript. Default false. */
  visualizationsEnabled?: boolean;
}

export interface ChatSessionSummary {
  id: string;
  provider: ChatProvider;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}

export interface LocalChatConnectionTest {
  ok: boolean;
  message: string;
  normalizedBaseUrl?: string;
  models?: string[];
}

export type LocalChatServerKind = "ollama" | "lmstudio";

export interface LocalChatServerCandidate {
  kind: LocalChatServerKind;
  label: string;
  baseUrl: string;
  ok: boolean;
  models: string[];
  message?: string;
}

export interface LocalChatDiscovery {
  servers: LocalChatServerCandidate[];
}

/** Sign-in state surfaced to the renderer; never includes token material. */
export interface ChatAuthStatus {
  signedIn: boolean;
  /** From the id_token, for display in the header when signed in. */
  email?: string;
  /** Access-token expiry (unix seconds), for debugging/telemetry only. */
  expiresAt?: number;
}

/**
 * OAuth token blob persisted encrypted via safeStorage. Mirrors the Codex
 * "Sign in with ChatGPT" token set. Kept in the main process only.
 */
export interface StoredChatToken {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  /** ChatGPT account id from the id_token's OpenAI auth claim. */
  account_id?: string;
  email?: string;
  /** Unix seconds: now + expires_in at the time of issue/refresh. */
  expires_at: number;
  token_type: string;
}

// ----- COROS MCP (Model Context Protocol) connection -----

export interface CorosMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface CorosMcpStatus {
  /** A live MCP client session is open. */
  connected: boolean;
  /** OAuth tokens are stored (can reconnect without a browser). */
  authorized: boolean;
  /** Tools discovered from the server. */
  tools: CorosMcpTool[];
}

// ----- Configurable MCP server registry -----

export type McpTransport = "streamable-http";
export type McpAuthType = "oauth" | "bearer" | "none";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  authType: McpAuthType;
  scope?: string;
  enabled: boolean;
  /** Built-in (COROS): non-deletable, url/id immutable, can be disabled. */
  builtin: boolean;
  sortOrder: number;
}

export interface McpServerInput {
  id?: string;
  name: string;
  url: string;
  transport?: McpTransport;
  authType?: McpAuthType;
  scope?: string | null;
  enabled?: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  connected: boolean;
  /** Auth is satisfied (OAuth tokens stored, or bearer set, or authType none). */
  authenticated: boolean;
  toolCount: number;
  error?: string;
}

// Streaming chat is push-based: `chat:send` kicks off the request and the
// assistant text arrives via these main->renderer events, correlated by
// requestId. Renderers must not await `chat:send` for content.
export interface ChatStreamStart {
  requestId: string;
}

export interface ChatStreamToken {
  requestId: string;
  delta: string;
}

export interface ChatStreamDone {
  requestId: string;
  fullText: string;
  finishReason?: string;
}

export interface ChatStreamError {
  requestId: string;
  message: string;
  /** True when the failure is an expired/invalid session (drop to login gate). */
  authError?: boolean;
}

/**
 * Diagnostic signal about where the answer's data is coming from: the static
 * training snapshot injected into `instructions`, and/or live COROS MCP tool
 * calls the model makes mid-stream.
 */
export type ChatStreamInfo =
  | {
      requestId: string;
      kind: "context";
      /** True when real COROS activity/metrics were injected as a snapshot. */
      snapshotIncluded: boolean;
      /** True when the COROS MCP tool was attached to the request. */
      mcpEnabled: boolean;
    }
  | {
      requestId: string;
      kind: "mcp";
      /** The MCP tool name, when known. */
      tool?: string;
      /** Raw event type, e.g. "response.mcp_call.completed". */
      status: string;
      message?: string;
    }
  | {
      requestId: string;
      kind: "thinking";
      /** Incremental extended-thinking text from the model. */
      delta: string;
    }
  | {
      requestId: string;
      kind: "planDraft";
      draft: PlanDraftPreview;
    }
  | {
      requestId: string;
      kind: "workoutDelete";
      preview: WorkoutDeletePreview;
    }
  | {
      requestId: string;
      kind: "activityVisual";
      preview: ActivityVisualPreview;
    }
  | {
      requestId: string;
      kind: "fitnessTrend";
      preview: FitnessTrendPreview;
    }
  | {
      requestId: string;
      kind: "hrZoneSummary";
      preview: HrZonePreview;
    };

// ----- Training plan upload (AI coach) -----

export interface TrainingTrendPoint {
  date: string;
  label: string;
  trainingLoad?: number;
  rpeLoad?: number;
  avgSleepHrv?: number;
  sleepHrvBase?: number;
  rhr?: number;
  sleepMinutes?: number;
  sleepScore?: number;
}

export interface ActivityVisualLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
  duration?: number;
  pace?: number;
}

export interface ActivityVisualHrSection {
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityVisualLapPoint[];
}

export interface ActivityVisualPreview {
  previewId: string;
  activityId: string;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  sections: {
    hr?: ActivityVisualHrSection;
    pace?: { series: TrainingHubActivitySeriesPoint[] };
    power?: { series: TrainingHubActivitySeriesPoint[] };
    elevation?: { points: TrainingHubTrackPoint[] };
    laps?: ActivityVisualLapPoint[];
  };
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendLapPoint {
  index: number;
  avgHr?: number;
  maxHr?: number;
  distance?: number;
}

/** @deprecated Legacy persisted shape — migrated to ActivityVisualPreview */
export interface ActivityHrTrendPreview {
  previewId: string;
  activityId: string;
  name?: string;
  startTime?: string;
  avgHr?: number;
  maxHr?: number;
  chartKind: "series" | "laps";
  series?: TrainingHubActivitySeriesPoint[];
  laps?: ActivityHrTrendLapPoint[];
}

export interface FitnessTrendPreview {
  previewId: string;
  trendPoints: TrainingTrendPoint[];
}

export interface HrZoneEntry {
  index: number;
  label: string;
  percent: number;
  value: number;
}

export interface HrZonePreview {
  previewId: string;
  metric: "time" | "distance" | "trainingLoad";
  zones: HrZoneEntry[];
  lthrZones: TrainingHubThresholdZone[];
}

export interface PlanDraftPreviewEntry {
  key: string;
  name: string;
  scheduleDate?: string;
  volume?: string;
  saveToLibrary: boolean;
  workoutType: string;
  stepsSummary?: string;
}

export interface PlanDraftPreview {
  draftId: string;
  name: string;
  summary: string;
  entries: PlanDraftPreviewEntry[];
  conflicts: string[];
  warnings: string[];
  uploadedAt?: number;
  uploadResult?: {
    workoutsScheduled: number;
    workoutsCreated: number;
  };
}

export interface PlanWorkoutEntryInput {
  key: string;
  name: string;
  steps?: unknown[];
  distance_km?: number;
  schedule_date?: string;
  sort_no?: number;
  save_to_library?: boolean;
}

export interface CorosTrainingPlanDraftInput {
  name: string;
  workouts: PlanWorkoutEntryInput[];
}

export interface UploadPlanResultEntry {
  key: string;
  name: string;
  date?: string;
  programId?: string;
  scheduled: boolean;
  savedToLibrary: boolean;
}

export interface UploadPlanResult {
  planName: string;
  workoutsCreated: number;
  workoutsScheduled: number;
  entries: UploadPlanResultEntry[];
}

export interface TrainingHubScheduledWorkoutEntry {
  planId: string;
  idInPlan: string;
  planProgramId: string;
  happenDay: string;
  name: string;
  programId?: string;
  sportType?: number;
  sortNo?: number;
  volume?: string;
  trainingLoad?: number;
  exercises?: TrainingHubScheduledExercise[];
  /** Raw program payload from schedule/query — required to re-add the workout when rescheduling. */
  rawProgram?: Record<string, unknown>;
}

export interface TrainingHubLibraryWorkout {
  id: string;
  name: string;
  sportType?: number;
  volume?: string;
  trainingLoad?: number;
  createTimestamp?: number;
}

export interface DeleteWorkoutResult {
  removedFromSchedule: boolean;
  removedFromLibrary: boolean;
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  message: string;
}

export interface WorkoutDeletePreview {
  requestId: string;
  target: "scheduled" | "library" | "both";
  workoutName?: string;
  scheduleDate?: string;
  programId?: string;
  summary: string;
}

/** Persisted coach timeline entry (messages plus inline action cards). */
export type PersistedChatEntry =
  | PersistedChatMessageEntry
  | { kind: "planDraft"; draft: PlanDraftPreview }
  | { kind: "workoutDelete"; preview: WorkoutDeletePreview }
  | { kind: "activityVisual"; preview: ActivityVisualPreview }
  | { kind: "activityHrTrend"; preview: ActivityHrTrendPreview }
  | { kind: "fitnessTrend"; preview: FitnessTrendPreview }
  | { kind: "hrZoneSummary"; preview: HrZonePreview };

export interface IntervalsStatus {
  connected: boolean;
  athleteId?: string;
}

export interface IntervalsActivity {
  intervalsId: string;
  name: string;
  startEpochMs: number;
  movingSec: number;
  distanceM: number;
  type: string;
  fileExt: "fit" | "tcx" | "unknown";
}

export interface IntervalsActivityWithStatus extends IntervalsActivity {
  onCoros: boolean;
}

export interface ManualActivityInput {
  sport: "run" | "bike" | "other";
  startTimeIso: string;
  durationSec: number;
  distanceM: number;
  calories?: number;
  avgHr?: number;
}
