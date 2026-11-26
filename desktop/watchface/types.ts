export type WatchModelId =
  | "pace-4-pro"
  | "pace-pro"
  | "pace-4"
  | "pace-3"
  | "pace-2"
  | "nomad"
  | "vertix"
  | "vertix-2"
  | "vertix-2s"
  | "vertix-4"
  | "apex-4"
  | "apex-2-pro"
  | "apex-2"
  | "apex-pro"
  | "apex";

export type CorosWatchfaceResolutionProfile =
  | "mip-240-260-800"
  | "amoled-466-800"
  | "amoled-416-800"
  | "amoled-390-800"
  | "other";

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
  /** Editable starter reconstructed from a compiled official face. */
  recoveredFromCompiled?: boolean;
  /** Target firmware family retained from template selection/import. */
  firmwareType?: string;
  /** Detected from resolution folders, independent of COROS's firmware ID. */
  resolutionProfile: CorosWatchfaceResolutionProfile;
  /** Portable CorosLink project metadata bundled with an editable website ZIP. */
  editableProject?: CorosWatchfaceEditableProject;
}

export interface CorosWatchfaceConfigOverride {
  /** A config file entry of the archive, e.g. "watchface_800x800/config.txt". */
  path: string;
  values: Record<string, string>;
}

export interface CorosWatchfaceAssetReplacement {
  /** Zip entry path inside the selected template archive or a studio sprite path. */
  path: string;
  dataUrl: string;
  /** Adds a new isolated sprite instead of replacing a template entry. */
  create?: boolean;
  /** Allows a supported state-sprite replacement to change template PNG dimensions. */
  allowDimensionOverride?: boolean;
  /**
   * Studio-only, never read by the service: layer opacity, effects or strokes are baked into this
   * sprite, so the always-on cleanup keeps its plain cutoff instead of rescuing it as soft artwork.
   */
  aodKeepCutoff?: boolean;
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
  /** Preserve the template slot's identity while deriving styled/moved details. */
  arcCutRole?: "dateSlash" | "overlay";
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

export interface CorosWatchfaceTemplateAsset extends CorosWatchfaceSpriteFile {
  dataUrl: string;
}

export interface CorosWatchfaceArtwork {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The battery's "%" (`battery_level_percent_icon`). It is one picture the
 * watch puts right after the last digit, so everything here is baked into
 * that picture: colour, size, the gap before it and the height it sits at.
 */
export interface CorosWatchfacePercentStyle {
  /** Absent follows the digits' colour. */
  color?: string;
  /** Height as a share of the digits' height; absent is 1. */
  size?: number;
  /** Master pixels of space between the last digit and the "%". */
  gap?: number;
  /** Where a smaller "%" sits beside the digits; absent is middle. */
  align?: "top" | "middle" | "bottom";
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
  /**
   * Fixed battery only: `scale` multiplies the artwork's own size. Absent on
   * projects whose scale was set against the template frame.
   */
  ownSize?: boolean;
  /**
   * Fixed battery only: clockwise quarter turns (0, 90, 180 or 270 degrees)
   * baked into every state PNG. The firmware has no rotation of its own; the
   * frame keeps its top-left `battery_icon_pos`, like scaling.
   */
  rotation?: number;
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
  /** Shared visible height and baseline, as fractions of the PNG cell height. */
  glyphLayout?: { height: number; baseline: number };
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
  fontStyle?: "normal" | "italic";
  align: "left" | "center" | "right";
  /** Extra space between letters, 800px space; may be negative. */
  letterSpacing?: number;
  /** Line spacing for text on several lines (`\n`), as a multiple of the size. Default 1.2. */
  lineHeight?: number;
  /** Drawn in capitals, small letters or Title Case, whatever was typed. */
  textCase?: "upper" | "lower" | "title";
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

/** Studio-owned fixed-Exercise separator baked into the background artwork. */
export interface CorosWatchfaceExerciseSeparatorStyle {
  enabled: boolean;
  /** Base center in the active mode's authoring resolution. */
  x: number;
  y: number;
  /** Authored glyph/PNG height before applying scale. */
  size: number;
  scale: number;
  color: string;
  /** The generated glyph's weight and style; absent draws it bold (700). */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Optional independent PNG; absent renders a generated colon glyph. */
  artwork?: CorosWatchfaceArtwork | null;
}

/** Authored native 4.9.9 data layer, in master-preview pixels. */
export type CorosWatchfaceNativeAssetRole = "digits" | "icon" | "states" | "unit" | "symbols" | "progress" | "decimal" | "background" | "mask" | "noDataMask" | "separator";

export type CorosWatchfaceNativePart = "value" | Exclude<CorosWatchfaceNativeAssetRole, "digits"> | "plot";

export interface CorosWatchfaceNativePartStyle {
  enabled?: boolean;
  /** Offset from the layer origin, before its scale. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  fontFamily?: string;
  /** Override the layer's weight, style and spacing for this component's text. */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  /** Preserve a recovered glyph's width independently of its value rectangle. */
  digitWidth?: number;
  align?: "left" | "center" | "right";
}

export interface CorosWatchfaceNativeDataStyle {
  enabled: boolean;
  x: number;
  y: number;
  scale: number;
  color: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Space between the characters inside one sprite, in em; digits are spaced by digitWidth. */
  letterSpacing?: number;
  /** Chart data-field prefix; not a verified selector for the watch's plotted history. */
  chartSource?: string;
  /**
   * Chart only: template readouts taken off their page ("Make fixed" moved
   * them to an always-shown field). Export deletes their config keys.
   */
  removedReadouts?: string[];
  /**
   * Chart only: the face's other readouts, by chart source, each where it sits
   * on the face. The layer edits one readout at a time (chartSource) and swaps
   * another in when it is picked; the graph parts stay with the layer.
   */
  readouts?: Record<string, CorosWatchfaceNativeDataStyle>;
  /** State-table size when recovered artwork defines fewer frames than the catalog default. */
  stateCount?: number;
  chartWidth?: number;
  chartHeight?: number;
  previewValue?: string;
  parts?: Partial<Record<CorosWatchfaceNativePart, CorosWatchfaceNativePartStyle>>;
  /** Optional text for individual generated sprites. PNG overrides take precedence. */
  assetTexts?: Partial<Record<CorosWatchfaceNativeAssetRole, Record<string, string>>>;
  assets?: Partial<Record<CorosWatchfaceNativeAssetRole, Record<string, string>>>;
  /** Glyph images (template digits, signs, units) a chosen font draws instead; the template font restores them. */
  fontReplacedAssets?: Partial<Record<CorosWatchfaceNativeAssetRole, Record<string, string>>>;
  chartStyle?: {
    lineWidth?: number;
    upperColor?: string;
    lowerColor?: string;
    selectedBarColor?: string;
    unselectedBarColor?: string;
    barWidth?: number;
    barGap?: number;
    /** Ignored: the watch picks bars or a line by chart group, and the preview follows it. Older projects still carry it. */
    previewType?: "curve" | "bars";
  };
}

/** One glyph of a {@link CorosWatchfaceFontSnapshot}, in pixels at its `size`. */
export interface CorosWatchfaceFontSnapshotGlyph {
  /** Cursor advance, as canvas `measureText().width` reports it. */
  advance: number;
  /** Ink extents around the pen position on the alphabetic baseline. */
  left: number;
  right: number;
  ascent: number;
  descent: number;
  /** The glyph's image rectangle inside the snapshot atlas. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rendered glyph images plus canvas metrics for one desktop font face. A
 * project carries these so it renders and exports the same way on a computer
 * that does not have the font installed. Only the glyph pictures travel, never
 * the font file itself.
 */
export interface CorosWatchfaceFontSnapshot {
  family: string;
  weight: number;
  style: "normal" | "italic";
  /** Font size, in pixels, the glyphs were rendered at. */
  size: number;
  /** Transparent space around each glyph's ink inside its atlas rectangle. */
  padding: number;
  /** Font-wide ascent and descent, in pixels at `size`. */
  fontAscent: number;
  fontDescent: number;
  /** Distance from each canvas text baseline down to the alphabetic one. */
  baselines: Record<string, number>;
  /** Pair adjustments in pixels at `size`, keyed by both characters ("AV"). */
  kerning?: Record<string, number>;
  /** White-on-transparent PNG atlas holding every glyph image. */
  dataUrl: string;
  glyphs: Record<string, CorosWatchfaceFontSnapshotGlyph>;
}

export interface CorosWatchfaceAnimation {
  enabled: boolean;
  x: number;
  y: number;
  /** Frame size in preview-resolution pixels; every frame has it. */
  width: number;
  height: number;
  /** PNG data URLs in playback order, all one size. */
  frames: string[];
  /** Milliseconds each frame stays up, one per frame (1–65535). */
  delays: number[];
}

export interface CorosWatchfaceDesignState {
  version: 1;
  /**
   * Glyph snapshots of the desktop fonts this design names, written when the
   * project is saved or exported. The editor keeps these outside its live
   * design state; see `watchfaceFontSnapshots.ts`.
   */
  fontSnapshots?: CorosWatchfaceFontSnapshot[];
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
   * Identity rewrites for the built archive: `o_template_id` and `m_name` in
   * info.json, `[watchface_id]` in every config.txt and AODconfig.txt. Absent
   * keeps the template's own. Validated again by the archive builder.
   */
  archiveOverrides?: { templateId?: string; watchfaceId?: string; templateName?: string };
  /**
   * Watch languages that get the custom weekday labels, chosen in the Export
   * panel: "all", "english", or extra language prefixes. Absent uses the
   * legacy weekday style fields, then the user's remembered preference.
   */
  watchLanguages?: "all" | "english" | string[];
  /**
   * Studio raw-text edits for template `config.txt` / `AODconfig.txt` paths.
   * Keys are archive-relative paths; values are full UTF-8 file bodies.
   */
  configTextEdits?: Record<string, string>;
  /**
   * MIP theme row (0–13) the face starts with: firmware recolors the face's
   * reds with it (`watchface_default_theme_color`). Absent keeps the template's.
   */
  watchThemeColor?: number;
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
  nativeData?: Record<string, CorosWatchfaceNativeDataStyle>;
  /**
   * Chart pages the design keeps on the watch with nothing visible ("hidden")
   * or takes off ("removed"), by NATIVE_CHART_PAGES id. Covers pages a
   * template declares without a Studio chart layer (templateChartPages.ts).
   */
  chartPageModes?: Partial<Record<string, "hidden" | "removed">>;
  /** Pages the chart's own Delete set to "removed"; Put back on the chart restores only these. */
  chartPagesRemovedWithChart?: string[];
  metricChanges: Record<string, boolean>;
  metricStyles: Record<string, { solidAlpha?: boolean; align?: "left" | "center" | "right"; color?: string; scale: number; fontSize?: number; rotation?: number; fontFamily?: string; fontWeight?: number; fontStyle?: "normal" | "italic"; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont; percent?: CorosWatchfacePercentStyle }>;
  /** Optional native calorie goal arc/bar configuration. */
  kcalProgress?: CorosWatchfaceKcalProgressStyle;
  /** Optional native exercise-goal bar configuration. */
  exerciseProgress?: CorosWatchfaceExerciseProgressStyle;
  /** Independent fixed-Exercise colon flattened into Current/AOD artwork. */
  exerciseSeparator?: CorosWatchfaceExerciseSeparatorStyle;
  /** Shared digit style for every value shown in the selectable control slot. */
  selectableMetricStyle?: {
    /** Export solid glyph pixels after all resizing and effects. */
    solidAlpha?: boolean;
    align?: "left" | "center" | "right";
    color?: string;
    scale: number;
    /** Clockwise rotation applied inside each firmware sprite canvas. */
    rotation?: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
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
  /**
   * Adds seconds digits to a template that declares none, reusing its minute
   * digit sprites. Ignored when the template already ships seconds.
   */
  addSeconds?: boolean;
  /**
   * Add weekday/month/day to a template that lays out none of its own. Month
   * and day reuse a template digit folder; weekday is rendered from a font.
   * Ignored for parts the template already ships.
   */
  addWeekday?: boolean;
  addDateMonth?: boolean;
  addDateDay?: boolean;
  timeStyles: Record<string, { solidAlpha?: boolean; color?: string; scale: number; fontSize?: number; rotation?: number; fontFamily?: string; fontWeight?: number; fontStyle?: "normal" | "italic"; letterSpacing?: number; rasterFont?: CorosWatchfaceRasterFont }>;
  /** Weekday/month/day sizing; absent in projects saved before resizing. */
  dateStyles?: Record<
    string,
    {
      /** Export solid glyph pixels after all resizing and effects. */
      solidAlpha?: boolean;
      scale: number;
      /** Desktop fonts: font size in master pixels, drawn inside width/height. */
      fontSize?: number;
      /** Desktop-font words: TUE/OCT (default), Tue/Oct or Tuesday/October. */
      labelStyle?: "upper" | "title" | "full";
      /** Desktop-font words: translate them for the watch languages picked in Send. */
      translateLabels?: boolean;
      /** Clockwise rotation applied inside each firmware sprite canvas. */
      rotation?: number;
      /** Exact exported PNG dimensions when set. */
      width?: number;
      height?: number;
      /** Imported PNG dimensions preserve their proportions unless unlocked. */
      aspectLocked?: boolean;
      /** Use the custom weekday labels for every watch language. Defaults to false. */
      overwriteAllLanguages?: boolean;
      /** Additional language prefixes to replace when all languages is off. */
      overwriteLanguages?: string[];
      /** Date-month rendering mode; absent preserves the starter's format. */
      monthFormat?: "digits" | "labels";
      /** Absent preserves the template's horizontal alignment. */
      align?: "left" | "center" | "right";
      fontFamily?: string;
      color?: string;
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
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
      /** Absent draws the glyph bold (700). */
      fontWeight?: number;
      fontStyle?: "normal" | "italic";
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
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
    letterSpacing?: number;
    rasterFont?: CorosWatchfaceRasterFont;
  };
  /**
   * Native sprite animation the watch plays on its own (header 0x312): ordered
   * PNG frames drawn over the background, before time and data. Coordinates and
   * frame sizes are in the preview resolution. Absent leaves the template's
   * `cl_animation_*` keys untouched; the always-on layout never animates.
   */
  animation?: CorosWatchfaceAnimation;
  /** Dynamic 41-state weather icon; absent in older projects. */
  weatherIndicator?: {
    enabled: boolean;
    x: number;
    y: number;
    scale: number;
    /** Optional tint applied to all weather states. */
    color?: string;
    /** Native current temperature above the weather icon; defaults to enabled. */
    temperatureEnabled?: boolean;
    /** Optional numbered PNG overrides; missing states retain bundled SIMPLE assets. */
    assets?: Partial<Record<"day" | "night" | "digits" | "symbols" | "units", Record<string, string>>>;
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
  /**
   * Firmware-backed editor layers the user deleted. They are turned off and
   * left out of the Layers list until re-added from the Add menu. Editor-only.
   */
  removedLayerIds?: string[];
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
    | "exerciseSeparator"
    | "selectableMetricStyle"
    | "controlComplicationEnabled"
    | "controlBarometerMode"
    | "controlIconOffsets"
    | "separateAutoTime"
    | "addSeconds"
    | "addWeekday"
    | "addDateMonth"
    | "addDateDay"
    | "timeStyles"
    | "dateStyles"
    | "staticSeparators"
    | "ampmIndicator"
    | "weatherIndicator"
    | "nativeData"
    | "layoutOffsets"
    | "linkedLayerGroups"
    | "editorGroups"
    | "editorGuides"
    | "lockedLayerIds"
    | "removedLayerIds"
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
  /** When the stored thumbnail was written; set when previews are not inlined. */
  previewUpdatedAt?: string;
}

export interface CorosWatchfaceEditableProject {
  name: string;
  design: CorosWatchfaceDesignState;
  /**
   * The starter is a finished face no one has edited in Studio yet (C-LINK on a
   * phone exports these): open it as Studio opens any face, reading its own
   * background, separators and data sprites, rather than starting from `design`.
   */
  openAsTemplate?: boolean;
}

/**
 * A native sprite animation (header 0x312) laid out for the website, which plays it the
 * way Studio's preview does: `under`, then the current frame, then `over`. Frames are the
 * ones the target watch plays (on memory-in-pixel watches, its colors and the frames that
 * fit 64 KB). Written to the project manifest as `previewAnimation`; CorosLink-web reads
 * it when it publishes the face.
 */
export interface CorosWatchfacePreviewAnimation {
  version: 1;
  /** Edge, in pixels, of preview.png, `under` and `over`, which all line up. */
  size: number;
  /** Where every frame is drawn, in those pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Milliseconds each frame shows, one per frame. */
  delays: number[];
  /** PNG data URLs, in playing order, all the same size. */
  frames: string[];
  /** PNG data URL: the face under the animation (its background). */
  under: string;
  /** PNG data URL: the face over the animation, transparent where the animation shows. */
  over: string;
  /** The model the frames were fitted for (WatchfaceTarget.model). */
  watch?: string;
}

export interface CorosWatchfaceProject extends CorosWatchfaceProjectSummary {
  archive: CorosWatchfaceArchive;
  design: CorosWatchfaceDesignState;
}
