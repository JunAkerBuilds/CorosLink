import { WATCHFACE_SIMULATION_CAPABILITIES } from "./watchfaceSimulation";
import { getNativeDataAutomationCatalog } from "./nativeDataAutomation";
import { NATIVE_DATA_BY_ID, NATIVE_CHART_SOURCES, NATIVE_ASSET_ROLES, NATIVE_PARTS, nativeAssetCount } from "../../electron/watchfaceNativeCatalog";
import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";

export type WatchfaceAutomationMode = "current" | "aod";

export interface WatchfaceAutomationDocumentValue {
  design: CorosWatchfaceDesignState;
  projectName: string;
}

export interface WatchfaceAutomationCommandContext {
  details: CorosWatchfaceTemplateDetails;
  mode?: WatchfaceAutomationMode;
}

export interface WatchfaceAutomationDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  commandIndex?: number;
}

export const WATCHFACE_AUTOMATION_LIMITS = {
  maximumCommands: 200,
  maximumDepth: 64,
  maximumNodes: 50_000,
  maximumStringLength: 16 * 1024 * 1024,
  maximumCollectionLength: 10_000
} as const;

const scalar = { type: ["string", "number", "boolean", "null"] } as const;
const stringMap = { type: "object", additionalProperties: { type: "string" } } as const;
const booleanMap = { type: "object", additionalProperties: { type: "boolean" } } as const;
const numberMap = { type: "object", additionalProperties: { type: "number" } } as const;
const WATCHFACE_SCHEMA_DEFINITIONS = {
  color: { type: "string", description: "CSS color: hex, rgb/rgba, hsl/hsla, transparent, or a named color." },
  imageValue: { anyOf: [{ type: "string", description: "Hydrated data:image URL accepted by apply_commands." }, { type: "object", additionalProperties: false, required: ["assetId"], properties: { assetId: { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" } }, description: "Opaque private asset reference returned by get_document or import_asset." }] },
  artwork: { type: "object", additionalProperties: false, required: ["dataUrl", "width", "height"], properties: { dataUrl: { $ref: "#/$defs/imageValue" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } } },
  imageSize: { type: "object", additionalProperties: false, required: ["width", "height"], properties: { width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } } },
  rasterFont: { type: "object", additionalProperties: false, required: ["label", "dataUrl", "glyphs", "columns", "tint"], properties: { label: { type: "string" }, dataUrl: { $ref: "#/$defs/imageValue" }, glyphs: { type: "string" }, columns: { type: "integer", minimum: 1, maximum: 512 }, labels: { type: "object", additionalProperties: { $ref: "#/$defs/imageValue" } }, sprites: { type: "object", additionalProperties: { $ref: "#/$defs/imageValue" } }, spriteSizes: { type: "object", additionalProperties: { $ref: "#/$defs/imageSize" } }, atlasSize: { $ref: "#/$defs/imageSize" }, glyphLayout: { type: "object", additionalProperties: false, required: ["height", "baseline"], properties: { height: { type: "number", minimum: 0.1, maximum: 1 }, baseline: { type: "number", minimum: 0.1, maximum: 1 } } }, tint: { type: "boolean" } } },
  typography: { type: "object", additionalProperties: false, required: ["scale"], properties: { solidAlpha: { type: "boolean", description: "Use for small raster digits: converts final exported glyph alpha to 0/255 after resizing (128 cutoff). Inspect all digits at native device size; thin strokes can disappear at the cutoff. Does not apply to nativeData assets or guarantee on-watch legibility." }, align: { enum: ["left", "center", "right"] }, color: { $ref: "#/$defs/color" }, scale: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" }, fontFamily: { type: "string" }, fontWeight: { type: "number", minimum: 1, maximum: 1000 }, fontStyle: { enum: ["normal", "italic"] }, letterSpacing: { type: "number" }, rasterFont: { $ref: "#/$defs/rasterFont" }, nativeSize: { type: "boolean" } } },
  dateTypography: { type: "object", additionalProperties: false, required: ["scale"], properties: { solidAlpha: { type: "boolean", description: "Use for small raster digits: converts final exported glyph alpha to 0/255 after resizing (128 cutoff). Inspect all digits at native device size; thin strokes can disappear at the cutoff. Does not apply to nativeData assets or guarantee on-watch legibility." }, align: { enum: ["left", "center", "right"] }, color: { $ref: "#/$defs/color" }, scale: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, aspectLocked: { type: "boolean" }, overwriteAllLanguages: { type: "boolean" }, overwriteLanguages: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^[a-z_]+$" } }, monthFormat: { enum: ["digits", "labels"] }, fontFamily: { type: "string" }, fontWeight: { type: "number", minimum: 1, maximum: 1000 }, fontStyle: { enum: ["normal", "italic"] }, letterSpacing: { type: "number" }, rasterFont: { $ref: "#/$defs/rasterFont" }, nativeSize: { type: "boolean" } } },
  offset: { type: "object", additionalProperties: false, required: ["dx", "dy"], properties: { dx: { type: "number" }, dy: { type: "number" } } },
  guide: { type: "object", additionalProperties: false, required: ["id", "axis", "position"], properties: { id: { type: "string" }, axis: { enum: ["x", "y"] }, position: { type: "number" } } },
  group: { type: "object", additionalProperties: false, required: ["id", "name", "layerIds"], properties: { id: { type: "string" }, name: { type: "string" }, layerIds: { type: "array", minItems: 2, uniqueItems: true, items: { type: "string" } } } },
  shadow: { type: "object", additionalProperties: false, required: ["id", "kind", "enabled", "color", "opacity", "blur", "spread", "distance", "angle"], properties: { id: { type: "string" }, kind: { enum: ["outer-shadow", "inner-shadow"] }, enabled: { type: "boolean" }, color: { $ref: "#/$defs/color" }, opacity: { type: "number", minimum: 0, maximum: 1 }, blur: { type: "number" }, spread: { type: "number" }, distance: { type: "number" }, angle: { type: "number" } } },
  stroke: { type: "object", additionalProperties: false, required: ["id", "enabled", "paint", "opacity", "position", "weight"], properties: { id: { type: "string" }, enabled: { type: "boolean" }, paint: { oneOf: [{ type: "object", additionalProperties: false, required: ["kind", "color"], properties: { kind: { const: "solid" }, color: { $ref: "#/$defs/color" } } }, { type: "object", additionalProperties: false, required: ["kind", "from", "to", "angle"], properties: { kind: { const: "linear-gradient" }, from: { $ref: "#/$defs/color" }, to: { $ref: "#/$defs/color" }, angle: { type: "number" } } }] }, opacity: { type: "number", minimum: 0, maximum: 1 }, position: { enum: ["inside", "center", "outside"] }, weight: { type: "number", minimum: 0 } } },
  sprite: { type: "object", additionalProperties: false, required: ["id", "dataUrl", "sourceWidth", "sourceHeight", "width", "height", "x", "y", "scale", "rotation"], properties: { id: { type: "string" }, name: { type: "string" }, dataUrl: { $ref: "#/$defs/imageValue" }, sourceWidth: { type: "number", exclusiveMinimum: 0 }, sourceHeight: { type: "number", exclusiveMinimum: 0 }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, x: { type: "number" }, y: { type: "number" }, scale: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" }, opacity: { type: "number", minimum: 0, maximum: 1 }, flipX: { type: "boolean" }, flipY: { type: "boolean" }, skewX: { type: "number", minimum: -80, maximum: 80 }, skewY: { type: "number", minimum: -80, maximum: 80 }, aspectLocked: { type: "boolean" }, crop: { type: "object", additionalProperties: false, required: ["x", "y", "width", "height"], properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, width: { type: "number", exclusiveMinimum: 0, maximum: 1 }, height: { type: "number", exclusiveMinimum: 0, maximum: 1 } } }, origin: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } } }, visible: { type: "boolean" }, tintColor: { anyOf: [{ $ref: "#/$defs/color" }, { type: "null" }] } } },
  gradient: { type: "object", additionalProperties: false, required: ["from", "to", "angle"], properties: { from: { $ref: "#/$defs/color" }, to: { $ref: "#/$defs/color" }, angle: { type: "number" } } },
  progressArc: { type: "object", additionalProperties: false, required: ["centerX", "centerY", "radiusX", "radiusY", "startAngle", "endAngle", "strokeWidth", "background"], properties: { centerX: { type: "number" }, centerY: { type: "number" }, radiusX: { type: "number", minimum: 0 }, radiusY: { type: "number", minimum: 0 }, startAngle: { type: "number" }, endAngle: { type: "number" }, strokeWidth: { type: "number", minimum: 0 }, background: { type: "boolean" } } },
  progressRect: { type: "object", additionalProperties: false, required: ["x0", "y0", "x1", "y1", "direction"], properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" }, direction: { enum: ["left", "right", "top", "bottom"] } } },
  kcalProgress: { type: "object", additionalProperties: false, required: ["arcEnabled", "rectEnabled", "arcColor", "rectColor", "previewPercent", "arc", "rect"], properties: { referenceWidth: { type: "number", exclusiveMinimum: 0 }, referenceHeight: { type: "number", exclusiveMinimum: 0 }, arcEnabled: { type: "boolean" }, rectEnabled: { type: "boolean" }, arcColor: { $ref: "#/$defs/color" }, rectColor: { $ref: "#/$defs/color" }, previewPercent: { type: "number", minimum: 0, maximum: 100 }, arc: { $ref: "#/$defs/progressArc" }, rect: { $ref: "#/$defs/progressRect" } } },
  exerciseProgress: { type: "object", additionalProperties: false, required: ["enabled", "arcEnabled", "color", "previewPercent", "arc", "rect"], properties: { referenceWidth: { type: "number", exclusiveMinimum: 0 }, referenceHeight: { type: "number", exclusiveMinimum: 0 }, enabled: { type: "boolean" }, arcEnabled: { type: "boolean" }, color: { $ref: "#/$defs/color" }, previewPercent: { type: "number", minimum: 0, maximum: 100 }, arc: { $ref: "#/$defs/progressArc" }, rect: { $ref: "#/$defs/progressRect" } } },
  exerciseSeparator: { type: "object", additionalProperties: false, required: ["enabled", "x", "y", "size", "scale", "color"], properties: { enabled: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, size: { type: "number", exclusiveMinimum: 0 }, scale: { type: "number", exclusiveMinimum: 0 }, color: { $ref: "#/$defs/color" }, artwork: { anyOf: [{ $ref: "#/$defs/artwork" }, { type: "null" }] } } },
  staticSeparator: { type: "object", additionalProperties: false, required: ["enabled", "x", "y", "size", "color"], properties: { enabled: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, size: { type: "number", exclusiveMinimum: 0 }, color: { $ref: "#/$defs/color" }, fontFamily: { type: "string" } } },
  indicator: { type: "object", additionalProperties: false, required: ["enabled", "x", "y", "scale"], properties: { enabled: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, scale: { type: "number", exclusiveMinimum: 0 }, color: { $ref: "#/$defs/color" }, fontFamily: { type: "string" } } },
  weatherIndicator: { type: "object", additionalProperties: false, required: ["enabled", "x", "y", "scale"], properties: { enabled: { type: "boolean" }, x: { type: "number" }, y: { type: "number" }, scale: { type: "number", exclusiveMinimum: 0 }, color: { $ref: "#/$defs/color" }, temperatureEnabled: { type: "boolean" }, assets: { type: "object", additionalProperties: false, properties: Object.fromEntries(["day", "night", "digits", "symbols", "units"].map(key => [key, { type: "object", additionalProperties: { $ref: "#/$defs/pngImageValue" } }])) } } },
  pngImageValue: { allOf: [{ $ref: "#/$defs/imageValue" }, { if: { type: "string" }, then: { pattern: "^data:image/png;base64," } }], description: "PNG artwork, passed as a reusable assetId or hydrated PNG data URL." },
  nativeColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Six-digit RGB hex color supported by the native compiler." },
  nativeDataMap: { type: "object", propertyNames: { enum: [...NATIVE_DATA_BY_ID.keys()] }, additionalProperties: { $ref: "#/$defs/nativeDataStyle" } },
  nativeDataStyle: { type: "object", additionalProperties: false, required: ["enabled", "x", "y", "scale", "color"], properties: {
    enabled: {type:"boolean"}, x:{type:"number"}, y:{type:"number"}, scale:{type:"number",minimum:0.1,maximum:4}, color:{$ref:"#/$defs/nativeColor"}, fontFamily:{type:"string"}, previewValue:{type:"string",maxLength:6}, chartSource:{enum:NATIVE_CHART_SOURCES.map(source=>source.id)}, chartWidth:{type:"number",minimum:80,maximum:700}, chartHeight:{type:"number",minimum:40,maximum:500}, stateCount:{type:"integer",minimum:1,maximum:64},
    assets:{type:"object",additionalProperties:false,properties:Object.fromEntries(NATIVE_ASSET_ROLES.map(role=>[role,{type:"object",propertyNames:{pattern:"^(0|[1-9][0-9]?)$"},additionalProperties:{$ref:"#/$defs/pngImageValue"}}]))},
    assetTexts:{type:"object",additionalProperties:false,properties:Object.fromEntries(NATIVE_ASSET_ROLES.map(role=>[role,{type:"object",additionalProperties:{type:"string",maxLength:32}}]))},
    parts:{type:"object",additionalProperties:false,properties:Object.fromEntries(NATIVE_PARTS.map(part=>[part,{$ref:"#/$defs/nativeDataPart"}]))},
    chartStyle:{$ref:"#/$defs/nativeChartStyle"}
  } },
  nativeDataPart:{type:"object",additionalProperties:false,properties:{
    enabled:{type:"boolean"},x:{type:"number",minimum:-1600,maximum:1600},y:{type:"number",minimum:-1600,maximum:1600},width:{type:"number",minimum:4,maximum:800},height:{type:"number",minimum:4,maximum:800},color:{$ref:"#/$defs/nativeColor"},fontFamily:{type:"string",maxLength:256},digitWidth:{type:"number",minimum:1,maximum:800},align:{enum:["left","center","right"]}
  }},
  nativeChartStyle:{type:"object",additionalProperties:false,properties:{
    lineWidth:{type:"number",minimum:1,maximum:40},barWidth:{type:"number",minimum:1,maximum:80},barGap:{type:"number",minimum:0,maximum:80},upperColor:{$ref:"#/$defs/nativeColor"},lowerColor:{$ref:"#/$defs/nativeColor"},selectedBarColor:{$ref:"#/$defs/nativeColor"},unselectedBarColor:{$ref:"#/$defs/nativeColor"},previewType:{enum:["curve","bars"],description:"Bars-only preview. The legacy curve value is accepted for existing projects but also renders as bars. Firmware chooses the live representation."}
  }},
  configAssetOverride: { type: "object", additionalProperties: false, properties: { enabled: { type: "boolean" }, scale: { type: "number", exclusiveMinimum: 0 }, nativeSize: { type: "boolean" }, replacement: { $ref: "#/$defs/artwork" }, stateReplacements: { type: "object", additionalProperties: { $ref: "#/$defs/artwork" } } } },
  effectStyle: { type: "object", additionalProperties: false, required: ["id", "name", "effects"], properties: { id: { type: "string" }, name: { type: "string" }, effects: { type: "array", items: { $ref: "#/$defs/shadow" } } } },
  effectBinding: { oneOf: [{ type: "object", additionalProperties: false, required: ["kind", "effects"], properties: { kind: { const: "local" }, effects: { type: "array", items: { $ref: "#/$defs/shadow" } } } }, { type: "object", additionalProperties: false, required: ["kind", "styleId"], properties: { kind: { const: "style" }, styleId: { type: "string" } } }] },
  modeDesign: { type: "object", additionalProperties: false, properties: {
    backgroundColor: { $ref: "#/$defs/color" }, accentColor: { $ref: "#/$defs/color" }, artwork: { anyOf: [{ $ref: "#/$defs/artwork" }, { type: "null" }] }, artworkVisible: { type: "boolean" }, zoom: { type: "number", exclusiveMinimum: 0 }, fontFamily: { type: "string" }, rasterFont: { $ref: "#/$defs/rasterFont" }, fontWeight: { type: "number" }, fontStyle: { enum: ["normal", "italic"] }, letterSpacing: { type: "number" }, digitColor: { $ref: "#/$defs/color" }, tintLabels: { type: "boolean" }, tintIcons: { type: "boolean" }, previewComplication: { type: "string" },
    metricChanges: { type: "object", additionalProperties: { type: "boolean" } }, metricStyles: { type: "object", additionalProperties: { $ref: "#/$defs/typography" } }, kcalProgress: { $ref: "#/$defs/kcalProgress" }, exerciseProgress: { $ref: "#/$defs/exerciseProgress" }, exerciseSeparator: { $ref: "#/$defs/exerciseSeparator" }, selectableMetricStyle: { $ref: "#/$defs/typography" }, controlComplicationEnabled: { type: "object", additionalProperties: { type: "boolean" } }, controlBarometerMode: { enum: ["static", "directional"] }, controlIconOffsets: { type: "object", additionalProperties: { $ref: "#/$defs/offset" } }, separateAutoTime: { type: "boolean" }, timeStyles: { type: "object", additionalProperties: { $ref: "#/$defs/typography" } }, dateStyles: { type: "object", additionalProperties: { $ref: "#/$defs/dateTypography" } }, staticSeparators: { type: "object", additionalProperties: false, required: ["colon", "dateSlash"], properties: { colon: { $ref: "#/$defs/staticSeparator" }, dateSlash: { $ref: "#/$defs/staticSeparator" } } }, ampmIndicator: { $ref: "#/$defs/indicator" }, weatherIndicator: { $ref: "#/$defs/weatherIndicator" }, nativeData: {$ref:"#/$defs/nativeDataMap"}, layoutOffsets: { type: "object", additionalProperties: { $ref: "#/$defs/offset" } },
    linkedLayerGroups: { type: "array", items: { type: "array", items: { type: "string" } } }, editorGroups: { type: "array", items: { $ref: "#/$defs/group" } }, editorGuides: { type: "array", items: { $ref: "#/$defs/guide" } }, lockedLayerIds: { type: "array", items: { type: "string" } }, effectStyles: { type: "array", items: { $ref: "#/$defs/effectStyle" } }, layerEffects: { type: "object", additionalProperties: { $ref: "#/$defs/effectBinding" } }, layerStrokes: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/$defs/stroke" } } }, layerVisibility: { type: "object", additionalProperties: { type: "boolean" } }, layerOpacities: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } }, layerColors: { type: "object", additionalProperties: { $ref: "#/$defs/color" } }, configAssetOverrides: { type: "object", additionalProperties: { $ref: "#/$defs/configAssetOverride" } }, designSprites: { type: "array", items: { $ref: "#/$defs/sprite" } }, artworkLayerOrder: { type: "array", items: { type: "string" } }, backgroundElements: { type: "array", items: { $ref: "#/$defs/backgroundElement" } }, backgroundEdited: { type: "boolean" }
  } },
  backgroundElement: { oneOf: [
    { type: "object", additionalProperties: false, required: ["id", "kind", "x", "y", "rotation", "width", "height", "cornerRadius", "fill"], properties: { id: { type: "string" }, kind: { const: "rect" }, x: { type: "number" }, y: { type: "number" }, rotation: { type: "number" }, visible: { type: "boolean" }, opacity: { type: "number", minimum: 0, maximum: 1 }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, aspectLocked: { type: "boolean" }, cornerRadius: { type: "number", minimum: 0 }, fill: { $ref: "#/$defs/color" }, gradient: { $ref: "#/$defs/gradient" }, strokeColor: { $ref: "#/$defs/color" }, strokeWidth: { type: "number", minimum: 0 } } },
    { type: "object", additionalProperties: false, required: ["id", "kind", "x", "y", "rotation", "width", "height", "fill"], properties: { id: { type: "string" }, kind: { const: "ellipse" }, x: { type: "number" }, y: { type: "number" }, rotation: { type: "number" }, visible: { type: "boolean" }, opacity: { type: "number", minimum: 0, maximum: 1 }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, aspectLocked: { type: "boolean" }, fill: { $ref: "#/$defs/color" }, gradient: { $ref: "#/$defs/gradient" }, strokeColor: { $ref: "#/$defs/color" }, strokeWidth: { type: "number", minimum: 0 } } },
    { type: "object", additionalProperties: false, required: ["id", "kind", "x", "y", "rotation", "dx", "dy", "color", "strokeWidth"], properties: { id: { type: "string" }, kind: { const: "line" }, x: { type: "number" }, y: { type: "number" }, rotation: { type: "number" }, visible: { type: "boolean" }, opacity: { type: "number", minimum: 0, maximum: 1 }, dx: { type: "number" }, dy: { type: "number" }, color: { $ref: "#/$defs/color" }, strokeWidth: { type: "number", minimum: 0 } } },
    { type: "object", additionalProperties: false, required: ["id", "kind", "x", "y", "rotation", "text", "fontFamily", "fontSize", "color", "weight", "align"], properties: { id: { type: "string" }, kind: { const: "text" }, x: { type: "number" }, y: { type: "number" }, rotation: { type: "number" }, visible: { type: "boolean" }, opacity: { type: "number", minimum: 0, maximum: 1 }, text: { type: "string" }, fontFamily: { type: "string" }, fontSize: { type: "number", exclusiveMinimum: 0 }, color: { $ref: "#/$defs/color" }, weight: { type: "number", minimum: 1, maximum: 1000 }, align: { enum: ["left", "center", "right"] } } }
  ] }
} as const;

/**
 * Introspectable JSON Schema for every persisted design field. Nested domain
 * objects are described by the scene guide returned alongside this schema;
 * runtime validation below applies their stronger invariants.
 */
export const WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "CorosLink watch-face editor document",
  $defs: WATCHFACE_SCHEMA_DEFINITIONS,
  type: "object",
  additionalProperties: false,
  required: ["design", "projectName"],
  properties: {
    projectName: { type: "string", maxLength: 80, description: "May be blank while editing; saving requires a non-empty name." },
    design: {
      type: "object",
      additionalProperties: false,
      required: [
        "version", "accentColor", "artwork", "zoom", "fontFamily",
        "digitColor", "tintLabels", "tintIcons", "previewComplication",
        "metricChanges", "metricStyles", "timeStyles", "staticSeparators",
        "layoutOffsets", "designSprites"
      ],
      properties: {
        version: { const: 1 },
        modeDesigns: { type: "object", additionalProperties: false, properties: { aod: { $ref: "#/$defs/modeDesign" } } },
        archiveWatchFaceVersion: { type: "number" },
        stripBlankConfigKeys: { type: "boolean" },
        configTextEdits: stringMap,
        backgroundColor: { $ref: "#/$defs/color", description: "Solid base painted first. Opaque artwork may cover it; set artworkVisible false to show only this color." },
        accentColor: { type: "string" },
        artwork: { anyOf: [{ $ref: "#/$defs/artwork" }, { type: "null" }] },
        artworkVisible: { type: "boolean", description: "Controls the imported/template background artwork independently from backgroundColor." },
        zoom: { type: "number" },
        fontFamily: { type: "string" },
        rasterFont: { $ref: "#/$defs/rasterFont" },
        fontWeight: { type: "number" },
        fontStyle: { enum: ["normal", "italic"] },
        letterSpacing: { type: "number" },
        digitColor: { type: "string" },
        tintLabels: { type: "boolean" },
        tintIcons: { type: "boolean" },
        previewComplication: { type: "string" },
        metricChanges: booleanMap,
        metricStyles: { type: "object", additionalProperties: { $ref: "#/$defs/typography" } },
        kcalProgress: { $ref: "#/$defs/kcalProgress" },
        exerciseProgress: { $ref: "#/$defs/exerciseProgress" },
        exerciseSeparator: { $ref: "#/$defs/exerciseSeparator" },
        selectableMetricStyle: { $ref: "#/$defs/typography" },
        controlComplicationEnabled: booleanMap,
        controlBarometerMode: { enum: ["static", "directional"] },
        controlBatteryEnabled: { type: "boolean" },
        controlSunriseEnabled: { type: "boolean" },
        controlSunsetEnabled: { type: "boolean" },
        controlFloorEnabled: { type: "boolean" },
        controlTemperatureEnabled: { type: "boolean" },
        controlIconOffsets: { type: "object", additionalProperties: { $ref: "#/$defs/offset" } },
        separateAutoTime: { type: "boolean" },
        timeStyles: { type: "object", additionalProperties: { $ref: "#/$defs/typography" } },
        dateStyles: { type: "object", additionalProperties: { $ref: "#/$defs/dateTypography" } },
        staticSeparators: { type: "object", additionalProperties: false, required: ["colon", "dateSlash"], properties: { colon: { $ref: "#/$defs/staticSeparator" }, dateSlash: { $ref: "#/$defs/staticSeparator" } } },
        ampmIndicator: { $ref: "#/$defs/indicator" },
        weatherIndicator: { $ref: "#/$defs/weatherIndicator" }, nativeData: {$ref:"#/$defs/nativeDataMap"},
        layoutOffsets: { type: "object", additionalProperties: { $ref: "#/$defs/offset" } },
        linkedLayerGroups: { type: "array", items: { type: "array", items: { type: "string" } } },
        editorGroups: { type: "array", items: { $ref: "#/$defs/group" } },
        editorGuides: { type: "array", items: { $ref: "#/$defs/guide" } },
        lockedLayerIds: { type: "array", items: { type: "string" } },
        effectStyles: { type: "array", items: { $ref: "#/$defs/effectStyle" } },
        layerEffects: { type: "object", additionalProperties: { $ref: "#/$defs/effectBinding" } },
        layerStrokes: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/$defs/stroke" } } },
        layerVisibility: booleanMap,
        layerOpacities: numberMap,
        layerColors: stringMap,
        configAssetOverrides: { type: "object", additionalProperties: { $ref: "#/$defs/configAssetOverride" } },
        designSprites: { type: "array", items: { $ref: "#/$defs/sprite" } },
        artworkLayerOrder: { type: "array", items: { type: "string" } },
        backgroundElements: { type: "array", items: { $ref: "#/$defs/backgroundElement" } }
      }
    }
  }
} as const;

export const WATCHFACE_AUTOMATION_COMMAND_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Atomic CorosLink watch-face commands",
  $defs: WATCHFACE_SCHEMA_DEFINITIONS,
  type: "array",
  maxItems: WATCHFACE_AUTOMATION_LIMITS.maximumCommands,
  items: {
    oneOf: [
      { type: "object", additionalProperties: false, required: ["op", "path", "value"], properties: { op: { const: "set" }, path: { type: "string" }, value: {} } },
      { type: "object", additionalProperties: false, required: ["op", "path"], properties: { op: { const: "unset" }, path: { type: "string" } } },
      { type: "object", additionalProperties: false, required: ["op", "path", "value"], properties: { op: { const: "merge" }, path: { type: "string" }, value: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "path", "value"], properties: { op: { const: "array_insert" }, path: { type: "string" }, index: { type: "integer", minimum: 0 }, value: {} } },
      { type: "object", additionalProperties: false, required: ["op", "path", "index"], properties: { op: { const: "array_remove" }, path: { type: "string" }, index: { type: "integer", minimum: 0 } } },
      { type: "object", additionalProperties: false, required: ["op", "path", "from", "to"], properties: { op: { const: "array_move" }, path: { type: "string" }, from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 } } },
      { type: "object", additionalProperties: false, required: ["op", "design"], properties: { op: { const: "replace_design" }, design: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "sprite"], properties: { op: { const: "add_sprite" }, sprite: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "patch"], properties: { op: { const: "update_sprite" }, id: { type: "string" }, patch: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "id"], properties: { op: { const: "remove_sprite" }, id: { type: "string" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "newId"], properties: { op: { const: "duplicate_sprite" }, id: { type: "string" }, newId: { type: "string" }, offset: { type: "number" } } },
      { type: "object", additionalProperties: false, required: ["op", "element"], properties: { op: { const: "add_element" }, element: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "patch"], properties: { op: { const: "update_element" }, id: { type: "string" }, patch: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "id"], properties: { op: { enum: ["remove_element", "remove_guide", "ungroup"] }, id: { type: "string" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "newId"], properties: { op: { const: "duplicate_element" }, id: { type: "string" }, newId: { type: "string" }, offset: { type: "number" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "dx", "dy"], properties: { op: { const: "move_layer" }, id: { type: "string" }, dx: { type: "number" }, dy: { type: "number" } } },
      {
        type: "object",
        additionalProperties: false,
        required: ["op", "layerIds"],
        anyOf: [{ required: ["x"] }, { required: ["y"] }],
        properties: {
          op: { const: "place_layers" },
          layerIds: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: { type: "string", minLength: 1 } },
          x: { type: "number" },
          y: { type: "number" },
          anchor: { enum: ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["op", "layerIds", "alignment"],
        properties: {
          op: { const: "align_layers" },
          layerIds: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: { type: "string", minLength: 1 } },
          alignment: { enum: ["left", "center-x", "right", "top", "center-y", "bottom"] },
          reference: {
            anyOf: [
              { enum: ["canvas", "selection"] },
              { type: "object", additionalProperties: false, required: ["layerId"], properties: { layerId: { type: "string", minLength: 1 } } }
            ]
          }
        }
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["op", "layerIds", "direction"],
        properties: {
          op: { const: "distribute_layers" },
          layerIds: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: { type: "string", minLength: 1 } },
          direction: { enum: ["horizontal", "vertical"] },
          gap: { type: "number", minimum: 0 }
        }
      },
      { type: "object", additionalProperties: false, required: ["op", "id"], properties: { op: { const: "set_style" }, id: { type: "string" }, color: { type: "string" }, opacity: { type: "number" }, effects: { type: "object" }, strokes: { type: "array" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "visible"], properties: { op: { const: "set_visibility" }, id: { type: "string", description: "Semantic layer id or group:<editorGroup.id>. Hiding preserves editable content; use visible:true to restore." }, visible: { type: "boolean" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "locked"], properties: { op: { const: "set_locked" }, id: { type: "string" }, locked: { type: "boolean" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "name", "layerIds"], properties: { op: { const: "group" }, id: { type: "string" }, name: { type: "string" }, layerIds: { type: "array", minItems: 2, items: { type: "string" } } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "targetId", "placement"], properties: { op: { const: "reorder_layer" }, id: { type: "string" }, targetId: { type: "string" }, placement: { enum: ["before", "after"] } } },
      { type: "object", additionalProperties: false, required: ["op", "guide"], properties: { op: { const: "add_guide" }, guide: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "id", "patch"], properties: { op: { const: "update_guide" }, id: { type: "string" }, patch: { type: "object" } } },
      { type: "object", additionalProperties: false, required: ["op", "folder", "target"], properties: { op: { const: "import_raster_font" }, folder: { type: "object", additionalProperties: false, required: ["label", "sprites"], properties: { label: { type: "string" }, sprites: { type: "array", minItems: 1, maxItems: 256, items: { type: "object", additionalProperties: false, required: ["name", "relativePath", "dataUrl", "sizeBytes"], properties: { name: { type: "string" }, relativePath: { type: "string" }, dataUrl: { $ref: "#/$defs/imageValue" }, sizeBytes: { type: "integer", minimum: 1 } } } } } }, target: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { enum: ["global", "time", "metric", "date", "selectable"] }, id: { type: "string" } } }, mode: { enum: ["current", "aod"] }, tint: { type: "boolean" } } },
      { type: "object", additionalProperties: false, required: ["op", "mode", "overrides"], properties: { op: { const: "set_mode_overrides" }, mode: { const: "aod" }, overrides: { type: ["object", "null"] }, copyFrom: { const: "current" } } }
    ]
  }
} as const;

export function getWatchfaceAutomationSchema() {
  return {
    document: WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA,
    commands: WATCHFACE_AUTOMATION_COMMAND_JSON_SCHEMA,
    scalar,
    simulation: WATCHFACE_SIMULATION_CAPABILITIES,
    nativeData: getNativeDataAutomationCatalog()
  } as const;
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DESIGN_KEYS = new Set(Object.keys(WATCHFACE_AUTOMATION_DOCUMENT_JSON_SCHEMA.properties.design.properties));
const MODE_KEYS = new Set([
  "backgroundColor", "accentColor", "artwork", "artworkVisible", "zoom", "fontFamily",
  "rasterFont", "fontWeight", "fontStyle", "letterSpacing", "digitColor", "tintLabels",
  "tintIcons", "previewComplication", "metricChanges", "metricStyles", "kcalProgress",
  "exerciseProgress", "exerciseSeparator", "selectableMetricStyle", "controlComplicationEnabled",
  "controlBarometerMode", "controlIconOffsets", "separateAutoTime", "timeStyles", "dateStyles",
  "staticSeparators", "ampmIndicator", "weatherIndicator", "nativeData", "layoutOffsets", "linkedLayerGroups",
  "editorGroups", "editorGuides", "lockedLayerIds", "effectStyles", "layerEffects", "layerStrokes",
  "layerVisibility", "layerOpacities", "layerColors", "configAssetOverrides", "designSprites",
  "artworkLayerOrder", "backgroundElements", "backgroundEdited"
]);

function objectOf(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(diagnostics: WatchfaceAutomationDiagnostic[], code: string, message: string, path?: string): void {
  diagnostics.push({ severity: "error", code, message, ...(path ? { path } : {}) });
}

function validateSafeTree(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[]): void {
  let nodes = 0;
  const seen = new Set<object>();
  const walk = (node: unknown, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > WATCHFACE_AUTOMATION_LIMITS.maximumNodes) return issue(diagnostics, "limit.nodes", "The document contains too many values.", path);
    if (depth > WATCHFACE_AUTOMATION_LIMITS.maximumDepth) return issue(diagnostics, "limit.depth", "The document is nested too deeply.", path);
    if (typeof node === "number" && !Number.isFinite(node)) return issue(diagnostics, "number.nonfinite", "Numbers must be finite.", path);
    if (typeof node === "string" && node.length > WATCHFACE_AUTOMATION_LIMITS.maximumStringLength) return issue(diagnostics, "limit.string", "A string exceeds the maximum supported length.", path);
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return issue(diagnostics, "object.cycle", "Cyclic values are not supported.", path);
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length > WATCHFACE_AUTOMATION_LIMITS.maximumCollectionLength) issue(diagnostics, "limit.array", "An array contains too many items.", path);
      node.forEach((child, index) => walk(child, `${path}/${index}`, depth + 1));
    } else {
      for (const [key, child] of Object.entries(node)) {
        if (DANGEROUS_KEYS.has(key)) issue(diagnostics, "object.dangerous_key", `The key ${key} is not allowed.`, `${path}/${key}`);
        walk(child, `${path}/${key}`, depth + 1);
      }
    }
    seen.delete(node);
  };
  walk(value, "", 0);
}

const colorPattern = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%+-]+\)|hsla?\([\d\s.,%+-]+\)|transparent|[a-z]{3,24})$/i;
const dataImagePattern = /^data:image\/(?:png|jpeg|webp);base64,/i;

function validateImage(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, nullable = false): void {
  if (nullable && value === null) return;
  if (!objectOf(value) || typeof value.dataUrl !== "string" || !dataImagePattern.test(value.dataUrl) || !Number.isFinite(value.width) || !Number.isFinite(value.height) || Number(value.width) <= 0 || Number(value.height) <= 0) {
    issue(diagnostics, "image.invalid", "Images require a supported data URL and positive finite width and height.", path);
  }
}

function requireColor(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (typeof value !== "string" || value.length > 64 || !colorPattern.test(value)) issue(diagnostics, "color.invalid", "Expected a supported CSS color.", path);
}

function requireNativeColor(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) issue(diagnostics, "native.color", "Native data colors must be six-digit RGB hex, for example #ffffff.", path);
}

function validateModeObject(mode: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (!objectOf(mode)) return issue(diagnostics, "mode.invalid", "AOD mode state must be an object.", path);
  for (const key of Object.keys(mode)) if (!MODE_KEYS.has(key)) issue(diagnostics, "design.unknown_field", `Unknown AOD design field: ${key}.`, `${path}/${key}`);
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(diagnostics, "object.unknown_field", `Unknown field: ${key}.`, `${path}/${key}`);
}

function finite(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, options: { positive?: boolean; minimum?: number; maximum?: number; integer?: boolean } = {}): void {
  if (typeof value !== "number" || !Number.isFinite(value) || (options.integer && !Number.isInteger(value)) || (options.positive && value <= 0) || (options.minimum !== undefined && value < options.minimum) || (options.maximum !== undefined && value > options.maximum)) issue(diagnostics, "number.invalid", "Expected a finite number in the supported range.", path);
}

function bool(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (typeof value !== "boolean") issue(diagnostics, "boolean.invalid", "Expected true or false.", path);
}

function text(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, maximum = 4096): void {
  if (typeof value !== "string" || value.length > maximum) issue(diagnostics, "string.invalid", "Expected a string within the supported length.", path);
}

function validateStringRecord(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, kind: "string" | "boolean" | "number"): void {
  if (!objectOf(value)) return issue(diagnostics, "record.invalid", "Expected an object map.", path);
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 512 || DANGEROUS_KEYS.has(key)) issue(diagnostics, "record.key", "Map keys must be safe non-empty strings.", `${path}/${key}`);
    if (kind === "string") text(item, diagnostics, `${path}/${key}`, WATCHFACE_AUTOMATION_LIMITS.maximumStringLength);
    if (kind === "boolean") bool(item, diagnostics, `${path}/${key}`);
    if (kind === "number") finite(item, diagnostics, `${path}/${key}`);
  }
}

function validateRasterFont(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (!objectOf(value)) return issue(diagnostics, "font.invalid", "Raster font must be an object.", path);
  allowedKeys(value, ["label", "dataUrl", "glyphs", "columns", "labels", "sprites", "spriteSizes", "atlasSize", "glyphLayout", "tint"], diagnostics, path);
  text(value.label, diagnostics, `${path}/label`, 120);
  if (typeof value.dataUrl !== "string" || !dataImagePattern.test(value.dataUrl)) issue(diagnostics, "font.image", "Raster font dataUrl must contain a supported image.", `${path}/dataUrl`);
  text(value.glyphs, diagnostics, `${path}/glyphs`, 512);
  finite(value.columns, diagnostics, `${path}/columns`, { positive: true, integer: true, maximum: 512 });
  bool(value.tint, diagnostics, `${path}/tint`);
  for (const field of ["labels", "sprites"] as const) if (value[field] !== undefined) {
    if (!objectOf(value[field])) issue(diagnostics, "font.map", `${field} must be an image map.`, `${path}/${field}`);
    else for (const [key, image] of Object.entries(value[field])) if (!key || typeof image !== "string" || !dataImagePattern.test(image)) issue(diagnostics, "font.image", "Raster-font sprite maps require supported image data URLs.", `${path}/${field}/${key}`);
  }
  const validateSize = (size: unknown, sizePath: string) => {
    if (!objectOf(size)) return issue(diagnostics, "image.size", "Image size must be an object.", sizePath);
    allowedKeys(size, ["width", "height"], diagnostics, sizePath); finite(size.width, diagnostics, `${sizePath}/width`, { positive: true, maximum: 16384 }); finite(size.height, diagnostics, `${sizePath}/height`, { positive: true, maximum: 16384 });
  };
  if (value.glyphLayout !== undefined) {
    if (!objectOf(value.glyphLayout)) issue(diagnostics, "font.layout", "Glyph layout must be an object.", `${path}/glyphLayout`);
    else {
      allowedKeys(value.glyphLayout, ["height", "baseline"], diagnostics, `${path}/glyphLayout`);
      for (const key of ["height", "baseline"]) finite(value.glyphLayout[key], diagnostics, `${path}/glyphLayout/${key}`, { minimum: 0.1, maximum: 1 });
    }
  }
  if (value.atlasSize !== undefined) validateSize(value.atlasSize, `${path}/atlasSize`);
  if (value.spriteSizes !== undefined) {
    if (!objectOf(value.spriteSizes)) issue(diagnostics, "font.sizes", "spriteSizes must be an object map.", `${path}/spriteSizes`);
    else for (const [key, size] of Object.entries(value.spriteSizes)) validateSize(size, `${path}/spriteSizes/${key}`);
  }
}

function validateTypography(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, date = false): void {
  if (!objectOf(value)) return issue(diagnostics, "style.invalid", "Typography style must be an object.", path);
  allowedKeys(value, ["solidAlpha", "align", "color", "scale", "rotation", "fontFamily", "fontWeight", "fontStyle", "letterSpacing", "rasterFont", "nativeSize", ...(date ? ["width", "height", "aspectLocked", "monthFormat", "overwriteAllLanguages", "overwriteLanguages"] : [])], diagnostics, path);
  finite(value.scale, diagnostics, `${path}/scale`, { positive: true, maximum: 100 });
  if (value.rotation !== undefined) finite(value.rotation, diagnostics, `${path}/rotation`);
  if (value.align !== undefined && !["left", "center", "right"].includes(String(value.align))) issue(diagnostics, "enum.align", "align must be left, center, or right.", `${path}/align`);
  if (value.color !== undefined) requireColor(value.color, diagnostics, `${path}/color`);
  if (value.fontFamily !== undefined) text(value.fontFamily, diagnostics, `${path}/fontFamily`, 256);
  if (value.fontWeight !== undefined) finite(value.fontWeight, diagnostics, `${path}/fontWeight`, { minimum: 1, maximum: 1000 });
  if (value.fontStyle !== undefined && !["normal", "italic"].includes(String(value.fontStyle))) issue(diagnostics, "enum.font_style", "fontStyle must be normal or italic.", `${path}/fontStyle`);
  if (value.letterSpacing !== undefined) finite(value.letterSpacing, diagnostics, `${path}/letterSpacing`, { minimum: -10, maximum: 10 });
  if (value.rasterFont !== undefined) validateRasterFont(value.rasterFont, diagnostics, `${path}/rasterFont`);
  for (const field of ["solidAlpha", "nativeSize", "aspectLocked", "overwriteAllLanguages"] as const) if (value[field] !== undefined) bool(value[field], diagnostics, `${path}/${field}`);
  if (value.overwriteLanguages !== undefined && (!Array.isArray(value.overwriteLanguages) ||
    value.overwriteLanguages.some((language) => typeof language !== "string" || !/^[a-z_]+$/.test(language)) ||
    new Set(value.overwriteLanguages).size !== value.overwriteLanguages.length)) {
    issue(diagnostics, "style.languages", "Expected unique language prefixes.", `${path}/overwriteLanguages`);
  }
  for (const field of ["width", "height"] as const) if (value[field] !== undefined) finite(value[field], diagnostics, `${path}/${field}`, { positive: true, maximum: 16384 });
  if (value.monthFormat !== undefined && !["digits", "labels"].includes(String(value.monthFormat))) issue(diagnostics, "enum.month_format", "monthFormat must be digits or labels.", `${path}/monthFormat`);
}

function validateTypographyRecord(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, date = false): void {
  if (!objectOf(value)) return issue(diagnostics, "style.record", "Expected a typography style map.", path);
  for (const [key, style] of Object.entries(value)) validateTypography(style, diagnostics, `${path}/${key}`, date);
}

function validateArtwork(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string, nullable = false): void {
  if (nullable && value === null) return;
  if (!objectOf(value)) return issue(diagnostics, "image.invalid", "Artwork must be an image object.", path);
  allowedKeys(value, ["dataUrl", "width", "height"], diagnostics, path);
  validateImage(value, diagnostics, path);
}

function validateEffect(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (!objectOf(value)) return issue(diagnostics, "effect.invalid", "Effect must be an object.", path);
  allowedKeys(value, ["id", "kind", "enabled", "color", "opacity", "blur", "spread", "distance", "angle"], diagnostics, path);
  text(value.id, diagnostics, `${path}/id`, 120); if (!["outer-shadow", "inner-shadow"].includes(String(value.kind))) issue(diagnostics, "enum.effect", "Unsupported shadow kind.", `${path}/kind`); bool(value.enabled, diagnostics, `${path}/enabled`); requireColor(value.color, diagnostics, `${path}/color`); finite(value.opacity, diagnostics, `${path}/opacity`, { minimum: 0, maximum: 1 });
  for (const field of ["blur", "spread", "distance", "angle"] as const) finite(value[field], diagnostics, `${path}/${field}`);
}

function validateStroke(value: unknown, diagnostics: WatchfaceAutomationDiagnostic[], path: string): void {
  if (!objectOf(value)) return issue(diagnostics, "stroke.invalid", "Stroke must be an object.", path);
  allowedKeys(value, ["id", "enabled", "paint", "opacity", "position", "weight"], diagnostics, path); text(value.id, diagnostics, `${path}/id`, 120); bool(value.enabled, diagnostics, `${path}/enabled`); finite(value.opacity, diagnostics, `${path}/opacity`, { minimum: 0, maximum: 1 }); finite(value.weight, diagnostics, `${path}/weight`, { minimum: 0, maximum: 1000 });
  if (!["inside", "center", "outside"].includes(String(value.position))) issue(diagnostics, "enum.stroke_position", "Unsupported stroke position.", `${path}/position`);
  if (!objectOf(value.paint)) issue(diagnostics, "stroke.paint", "Stroke paint must be an object.", `${path}/paint`);
  else if (value.paint.kind === "solid") { allowedKeys(value.paint, ["kind", "color"], diagnostics, `${path}/paint`); requireColor(value.paint.color, diagnostics, `${path}/paint/color`); }
  else if (value.paint.kind === "linear-gradient") { allowedKeys(value.paint, ["kind", "from", "to", "angle"], diagnostics, `${path}/paint`); requireColor(value.paint.from, diagnostics, `${path}/paint/from`); requireColor(value.paint.to, diagnostics, `${path}/paint/to`); finite(value.paint.angle, diagnostics, `${path}/paint/angle`); }
  else issue(diagnostics, "stroke.paint", "Unsupported stroke paint kind.", `${path}/paint/kind`);
}

function validateAdvancedCollections(design: Record<string, unknown>, diagnostics: WatchfaceAutomationDiagnostic[], base = "/design"): void {
  for (const [field, kind] of [["metricChanges", "boolean"], ["controlComplicationEnabled", "boolean"], ["layerVisibility", "boolean"], ["layerOpacities", "number"], ["layerColors", "string"], ["configTextEdits", "string"]] as const) if (design[field] !== undefined) validateStringRecord(design[field], diagnostics, `${base}/${field}`, kind);
  validateTypographyRecord(design.metricStyles, diagnostics, `${base}/metricStyles`); validateTypographyRecord(design.timeStyles, diagnostics, `${base}/timeStyles`); if (design.dateStyles !== undefined) validateTypographyRecord(design.dateStyles, diagnostics, `${base}/dateStyles`, true); if (design.selectableMetricStyle !== undefined) validateTypography(design.selectableMetricStyle, diagnostics, `${base}/selectableMetricStyle`);
  if (design.rasterFont !== undefined) validateRasterFont(design.rasterFont, diagnostics, `${base}/rasterFont`);
  if (design.staticSeparators !== undefined) {
    if (!objectOf(design.staticSeparators)) issue(diagnostics, "separator.invalid", "staticSeparators must be an object.", `${base}/staticSeparators`);
    else for (const id of ["colon", "dateSlash"]) { const separator = design.staticSeparators[id]; if (!objectOf(separator)) issue(diagnostics, "separator.invalid", `Missing ${id} separator.`, `${base}/staticSeparators/${id}`); else { allowedKeys(separator, ["enabled", "x", "y", "size", "color", "fontFamily"], diagnostics, `${base}/staticSeparators/${id}`); bool(separator.enabled, diagnostics, `${base}/staticSeparators/${id}/enabled`); for (const field of ["x", "y", "size"] as const) finite(separator[field], diagnostics, `${base}/staticSeparators/${id}/${field}`, field === "size" ? { positive: true } : {}); requireColor(separator.color, diagnostics, `${base}/staticSeparators/${id}/color`); } }
  }
  if (design.layoutOffsets !== undefined) { if (!objectOf(design.layoutOffsets)) issue(diagnostics, "layout.invalid", "layoutOffsets must be an object map.", `${base}/layoutOffsets`); else for (const [id, offset] of Object.entries(design.layoutOffsets)) { if (!objectOf(offset)) issue(diagnostics, "layout.invalid", "Layout offset must be an object.", `${base}/layoutOffsets/${id}`); else { allowedKeys(offset, ["dx", "dy"], diagnostics, `${base}/layoutOffsets/${id}`); finite(offset.dx, diagnostics, `${base}/layoutOffsets/${id}/dx`); finite(offset.dy, diagnostics, `${base}/layoutOffsets/${id}/dy`); } } }
  if (design.effectStyles !== undefined) { if (!Array.isArray(design.effectStyles)) issue(diagnostics, "effects.invalid", "effectStyles must be an array.", `${base}/effectStyles`); else for (const [index, style] of design.effectStyles.entries()) { if (!objectOf(style) || typeof style.name !== "string" || typeof style.id !== "string" || !Array.isArray(style.effects)) issue(diagnostics, "effects.invalid", "Effect styles require id, name, and effects.", `${base}/effectStyles/${index}`); else { allowedKeys(style, ["id", "name", "effects"], diagnostics, `${base}/effectStyles/${index}`); style.effects.forEach((effect, effectIndex) => validateEffect(effect, diagnostics, `${base}/effectStyles/${index}/effects/${effectIndex}`)); } } }
  if (design.layerEffects !== undefined) { if (!objectOf(design.layerEffects)) issue(diagnostics, "effects.invalid", "layerEffects must be an object map.", `${base}/layerEffects`); else for (const [id, binding] of Object.entries(design.layerEffects)) { if (!objectOf(binding) || !["local", "style"].includes(String(binding.kind))) issue(diagnostics, "effects.binding", "Invalid effect binding.", `${base}/layerEffects/${id}`); else if (binding.kind === "local") { allowedKeys(binding, ["kind", "effects"], diagnostics, `${base}/layerEffects/${id}`); if (!Array.isArray(binding.effects)) issue(diagnostics, "effects.invalid", "Local effects must be an array.", `${base}/layerEffects/${id}/effects`); else binding.effects.forEach((effect, effectIndex) => validateEffect(effect, diagnostics, `${base}/layerEffects/${id}/effects/${effectIndex}`)); } else { allowedKeys(binding, ["kind", "styleId"], diagnostics, `${base}/layerEffects/${id}`); text(binding.styleId, diagnostics, `${base}/layerEffects/${id}/styleId`, 120); } } }
  if (design.layerStrokes !== undefined) { if (!objectOf(design.layerStrokes)) issue(diagnostics, "strokes.invalid", "layerStrokes must be an object map.", `${base}/layerStrokes`); else for (const [id, strokes] of Object.entries(design.layerStrokes)) if (!Array.isArray(strokes)) issue(diagnostics, "strokes.invalid", "Layer strokes must be arrays.", `${base}/layerStrokes/${id}`); else strokes.forEach((stroke, index) => validateStroke(stroke, diagnostics, `${base}/layerStrokes/${id}/${index}`)); }
  if (design.configAssetOverrides !== undefined) { if (!objectOf(design.configAssetOverrides)) issue(diagnostics, "assets.invalid", "configAssetOverrides must be an object map.", `${base}/configAssetOverrides`); else for (const [id, override] of Object.entries(design.configAssetOverrides)) { if (!objectOf(override)) issue(diagnostics, "assets.invalid", "Config asset override must be an object.", `${base}/configAssetOverrides/${id}`); else { allowedKeys(override, ["enabled", "scale", "nativeSize", "replacement", "stateReplacements"], diagnostics, `${base}/configAssetOverrides/${id}`); for (const field of ["enabled", "nativeSize"] as const) if (override[field] !== undefined) bool(override[field], diagnostics, `${base}/configAssetOverrides/${id}/${field}`); if (override.scale !== undefined) finite(override.scale, diagnostics, `${base}/configAssetOverrides/${id}/scale`, { positive: true }); if (override.replacement !== undefined) validateArtwork(override.replacement, diagnostics, `${base}/configAssetOverrides/${id}/replacement`); if (override.stateReplacements !== undefined) { if (!objectOf(override.stateReplacements)) issue(diagnostics, "assets.invalid", "stateReplacements must be an object map.", `${base}/configAssetOverrides/${id}/stateReplacements`); else for (const [state, image] of Object.entries(override.stateReplacements)) validateArtwork(image, diagnostics, `${base}/configAssetOverrides/${id}/stateReplacements/${state}`); } } } }
  if (design.controlIconOffsets !== undefined) { if (!objectOf(design.controlIconOffsets)) issue(diagnostics, "layout.invalid", "controlIconOffsets must be an object map.", `${base}/controlIconOffsets`); else for (const [id, offset] of Object.entries(design.controlIconOffsets)) { if (!objectOf(offset)) issue(diagnostics, "layout.invalid", "Control icon offset must be an object.", `${base}/controlIconOffsets/${id}`); else { allowedKeys(offset, ["dx", "dy"], diagnostics, `${base}/controlIconOffsets/${id}`); finite(offset.dx, diagnostics, `${base}/controlIconOffsets/${id}/dx`); finite(offset.dy, diagnostics, `${base}/controlIconOffsets/${id}/dy`); } } }
  const validateArc = (arc: unknown, path: string) => { if (!objectOf(arc)) return issue(diagnostics, "progress.arc", "Progress arc must be an object.", path); allowedKeys(arc, ["centerX", "centerY", "radiusX", "radiusY", "startAngle", "endAngle", "strokeWidth", "background"], diagnostics, path); for (const field of ["centerX", "centerY", "radiusX", "radiusY", "startAngle", "endAngle", "strokeWidth"] as const) finite(arc[field], diagnostics, `${path}/${field}`, ["radiusX", "radiusY", "strokeWidth"].includes(field) ? { minimum: 0 } : {}); if (arc.background !== undefined) bool(arc.background, diagnostics, `${path}/background`); };
  const validateRect = (rect: unknown, path: string) => { if (!objectOf(rect)) return issue(diagnostics, "progress.rect", "Progress rectangle must be an object.", path); allowedKeys(rect, ["x0", "y0", "x1", "y1", "direction"], diagnostics, path); for (const field of ["x0", "y0", "x1", "y1"] as const) finite(rect[field], diagnostics, `${path}/${field}`); if (!["left", "right", "top", "bottom"].includes(String(rect.direction))) issue(diagnostics, "enum.direction", "Unsupported progress direction.", `${path}/direction`); };
  if (design.kcalProgress !== undefined) { const value = design.kcalProgress; if (!objectOf(value)) issue(diagnostics, "progress.invalid", "kcalProgress must be an object.", `${base}/kcalProgress`); else { allowedKeys(value, ["referenceWidth", "referenceHeight", "arcEnabled", "rectEnabled", "arcColor", "rectColor", "previewPercent", "arc", "rect"], diagnostics, `${base}/kcalProgress`); bool(value.arcEnabled, diagnostics, `${base}/kcalProgress/arcEnabled`); bool(value.rectEnabled, diagnostics, `${base}/kcalProgress/rectEnabled`); requireColor(value.arcColor, diagnostics, `${base}/kcalProgress/arcColor`); requireColor(value.rectColor, diagnostics, `${base}/kcalProgress/rectColor`); finite(value.previewPercent, diagnostics, `${base}/kcalProgress/previewPercent`, { minimum: 0, maximum: 100 }); validateArc(value.arc, `${base}/kcalProgress/arc`); validateRect(value.rect, `${base}/kcalProgress/rect`); } }
  if (design.exerciseProgress !== undefined) { const value = design.exerciseProgress; if (!objectOf(value)) issue(diagnostics, "progress.invalid", "exerciseProgress must be an object.", `${base}/exerciseProgress`); else { allowedKeys(value, ["referenceWidth", "referenceHeight", "enabled", "arcEnabled", "color", "previewPercent", "arc", "rect"], diagnostics, `${base}/exerciseProgress`); bool(value.enabled, diagnostics, `${base}/exerciseProgress/enabled`); bool(value.arcEnabled, diagnostics, `${base}/exerciseProgress/arcEnabled`); requireColor(value.color, diagnostics, `${base}/exerciseProgress/color`); finite(value.previewPercent, diagnostics, `${base}/exerciseProgress/previewPercent`, { minimum: 0, maximum: 100 }); validateArc(value.arc, `${base}/exerciseProgress/arc`); validateRect(value.rect, `${base}/exerciseProgress/rect`); } }
  if (design.exerciseSeparator !== undefined) { const value = design.exerciseSeparator; if (!objectOf(value)) issue(diagnostics, "separator.invalid", "exerciseSeparator must be an object.", `${base}/exerciseSeparator`); else { allowedKeys(value, ["enabled", "x", "y", "size", "scale", "color", "artwork"], diagnostics, `${base}/exerciseSeparator`); bool(value.enabled, diagnostics, `${base}/exerciseSeparator/enabled`); for (const field of ["x", "y"] as const) finite(value[field], diagnostics, `${base}/exerciseSeparator/${field}`); for (const field of ["size", "scale"] as const) finite(value[field], diagnostics, `${base}/exerciseSeparator/${field}`, { positive: true }); requireColor(value.color, diagnostics, `${base}/exerciseSeparator/color`); if (value.artwork !== undefined && value.artwork !== null) validateArtwork(value.artwork, diagnostics, `${base}/exerciseSeparator/artwork`); } }
  if (design.nativeData !== undefined) {
    if (!objectOf(design.nativeData)) issue(diagnostics,"native.invalid","Native data must be an object map.",`${base}/nativeData`);
    else for (const [id, style] of Object.entries(design.nativeData)) {
      const path = `${base}/nativeData/${id}`;
      if (!NATIVE_DATA_BY_ID.has(id) || !objectOf(style)) {issue(diagnostics,"native.invalid","Unknown or invalid native data field.",path);continue;}
      allowedKeys(style,["enabled","x","y","scale","color","fontFamily","chartSource","chartWidth","chartHeight","stateCount","previewValue","assets","assetTexts","parts","chartStyle"],diagnostics,path);
      bool(style.enabled,diagnostics,`${path}/enabled`);finite(style.x,diagnostics,`${path}/x`);finite(style.y,diagnostics,`${path}/y`);finite(style.scale,diagnostics,`${path}/scale`,{minimum:0.1,maximum:4});requireNativeColor(style.color,diagnostics,`${path}/color`);
      if(style.chartWidth!==undefined)finite(style.chartWidth,diagnostics,`${path}/chartWidth`,{minimum:80,maximum:700});
      if(style.chartHeight!==undefined)finite(style.chartHeight,diagnostics,`${path}/chartHeight`,{minimum:40,maximum:500});
      if(style.stateCount!==undefined&&(typeof style.stateCount!=="number"||!Number.isInteger(style.stateCount)||style.stateCount<1||style.stateCount>64))issue(diagnostics,"native.invalid","State count must be a whole number from 1 to 64.",`${path}/stateCount`);
      if(style.fontFamily!==undefined)text(style.fontFamily,diagnostics,`${path}/fontFamily`,256);
      if(style.previewValue!==undefined)text(style.previewValue,diagnostics,`${path}/previewValue`,6);
      if(style.chartSource!==undefined&&!NATIVE_CHART_SOURCES.some(source=>source.id===style.chartSource))issue(diagnostics,"native.chart","Unknown chart source.",path);
      for (const property of ["assets","assetTexts"] as const) {
        const sets = style[property];
        if (sets === undefined) continue;
        if (!objectOf(sets)) { issue(diagnostics,"native.assets","Expected numbered artwork sets.",`${path}/${property}`); continue; }
        allowedKeys(sets,NATIVE_ASSET_ROLES,diagnostics,`${path}/${property}`);
        for (const [role,states] of Object.entries(sets)) {
          if (!objectOf(states)) { issue(diagnostics,"native.assets","Expected numbered artwork.",`${path}/${property}/${role}`); continue; }
          for (const [state,value] of Object.entries(states)) {
            const location = `${path}/${property}/${role}/${state}`;
            if (!/^(0|[1-9]\d?)$/.test(state) || Number(state) >= nativeAssetCount(id,role)) issue(diagnostics,"native.assets","Invalid artwork state.",location);
            if (property === "assetTexts") text(value,diagnostics,location,32);
            else if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) issue(diagnostics,"native.assets","Expected a PNG image.",location);
          }
        }
      }
      if (style.parts !== undefined) {
        if (!objectOf(style.parts)) issue(diagnostics,"native.parts","Expected component styles.",`${path}/parts`);
        else {
          allowedKeys(style.parts,NATIVE_PARTS,diagnostics,`${path}/parts`);
          for (const [name,part] of Object.entries(style.parts)) {
            const location = `${path}/parts/${name}`;
            if (!objectOf(part)) { issue(diagnostics,"native.parts","Invalid component style.",location); continue; }
            allowedKeys(part,["enabled","x","y","width","height","color","fontFamily","digitWidth","align"],diagnostics,location);
            if (part.enabled !== undefined) bool(part.enabled,diagnostics,`${location}/enabled`);
            for (const key of ["x","y"] as const) if (part[key] !== undefined) finite(part[key],diagnostics,`${location}/${key}`,{minimum:-1600,maximum:1600});
            for (const key of ["width","height"] as const) if (part[key] !== undefined) finite(part[key],diagnostics,`${location}/${key}`,{minimum:4,maximum:800});
            if (part.color !== undefined) requireNativeColor(part.color,diagnostics,`${location}/color`);
            if (part.fontFamily !== undefined) text(part.fontFamily,diagnostics,`${location}/fontFamily`,256);
            if (part.digitWidth !== undefined) finite(part.digitWidth,diagnostics,`${location}/digitWidth`,{minimum:1,maximum:800});
            if (part.align !== undefined && !["left","center","right"].includes(part.align as string)) issue(diagnostics,"native.parts","Unknown number alignment.",`${location}/align`);
          }
        }
      }
      if (style.chartStyle !== undefined) {
        const chart = style.chartStyle, location = `${path}/chartStyle`;
        if (!objectOf(chart)) issue(diagnostics,"native.chart","Invalid graph style.",location);
        else {
          allowedKeys(chart,["lineWidth","barWidth","barGap","upperColor","lowerColor","selectedBarColor","unselectedBarColor","previewType"],diagnostics,location);
          for (const key of ["lineWidth","barWidth","barGap"] as const) if (chart[key] !== undefined) finite(chart[key],diagnostics,`${location}/${key}`,{minimum:key==="barGap"?0:1,maximum:key==="lineWidth"?40:80});
          for (const key of ["upperColor","lowerColor","selectedBarColor","unselectedBarColor"] as const) if (chart[key] !== undefined) requireNativeColor(chart[key],diagnostics,`${location}/${key}`);
          if (chart.previewType !== undefined && !["curve","bars"].includes(String(chart.previewType))) issue(diagnostics,"native.chart","Invalid preview plot.",`${location}/previewType`);
        }
      }
    }
  }
  const weather = design.weatherIndicator;
  if (objectOf(weather)) {
    if (weather.temperatureEnabled !== undefined) bool(weather.temperatureEnabled, diagnostics, `${base}/weatherIndicator/temperatureEnabled`);
    if (weather.assets !== undefined) {
      if (!objectOf(weather.assets)) issue(diagnostics, "weather.assets", "Weather assets must be an object.", `${base}/weatherIndicator/assets`);
      else {
        allowedKeys(weather.assets, ["day", "night", "digits", "symbols", "units"], diagnostics, `${base}/weatherIndicator/assets`);
        for (const [set, states] of Object.entries(weather.assets)) {
          const limit = set === "day" || set === "night" ? 41 : set === "digits" ? 10 : 2;
          if (!objectOf(states)) { issue(diagnostics, "weather.states", "Expected numbered PNG states.", `${base}/weatherIndicator/assets/${set}`); continue; }
          for (const [state, url] of Object.entries(states)) {
            if (!/^(0|[1-9]\d?)$/.test(state) || Number(state) >= limit || typeof url !== "string" || !url.startsWith("data:image/png;base64,")) issue(diagnostics, "weather.state", "Use a valid numbered PNG state.", `${base}/weatherIndicator/assets/${set}/${state}`);
          }
        }
      }
    }
  }
  for (const field of ["ampmIndicator", "weatherIndicator"] as const) if (design[field] !== undefined) { const value = design[field]; if (!objectOf(value)) issue(diagnostics, "indicator.invalid", `${field} must be an object.`, `${base}/${field}`); else { allowedKeys(value, ["enabled", "x", "y", "scale", "color", ...(field === "weatherIndicator" ? ["temperatureEnabled", "assets"] : ["fontFamily"])], diagnostics, `${base}/${field}`); bool(value.enabled, diagnostics, `${base}/${field}/enabled`); finite(value.x, diagnostics, `${base}/${field}/x`); finite(value.y, diagnostics, `${base}/${field}/y`); finite(value.scale, diagnostics, `${base}/${field}/scale`, { positive: true }); if (value.color !== undefined) requireColor(value.color, diagnostics, `${base}/${field}/color`); if (value.fontFamily !== undefined) text(value.fontFamily, diagnostics, `${base}/${field}/fontFamily`, 256); } }
}

export function validateWatchfaceAutomationDocument(
  value: WatchfaceAutomationDocumentValue,
  context?: Partial<WatchfaceAutomationCommandContext>
): WatchfaceAutomationDiagnostic[] {
  const diagnostics: WatchfaceAutomationDiagnostic[] = [];
  validateSafeTree(value, diagnostics);
  if (!objectOf(value)) {
    issue(diagnostics, "document.invalid", "The editor document must be an object.");
    return diagnostics;
  }
  if (typeof value.projectName !== "string" || value.projectName.length > 80) issue(diagnostics, "project.name", "Project name must be at most 80 characters.", "/projectName");
  else if (!value.projectName.trim()) diagnostics.push({ severity: "warning", code: "project.name_empty", message: "Set a project name before saving.", path: "/projectName" });
  const design = value.design;
  if (!objectOf(design)) {
    issue(diagnostics, "design.invalid", "The design must be an object.", "/design");
    return diagnostics;
  }
  for (const key of Object.keys(design)) if (!DESIGN_KEYS.has(key)) issue(diagnostics, "design.unknown_field", `Unknown design field: ${key}.`, `/design/${key}`);
  if (design.version !== 1) issue(diagnostics, "design.version", "Only design version 1 is supported.", "/design/version");
  for (const key of ["artwork", "zoom", "fontFamily", "digitColor", "tintLabels", "tintIcons", "previewComplication", "metricChanges", "metricStyles", "timeStyles", "staticSeparators", "layoutOffsets", "designSprites"] as const) if (!(key in design)) issue(diagnostics, "design.required", `Missing required design field: ${key}.`, `/design/${key}`);
  for (const key of ["accentColor", "digitColor"] as const) requireColor(design[key], diagnostics, `/design/${key}`);
  if (design.backgroundColor !== undefined) requireColor(design.backgroundColor, diagnostics, "/design/backgroundColor");
  if (design.artwork !== null) validateImage(design.artwork, diagnostics, "/design/artwork");
  if (!Number.isFinite(design.zoom) || Number(design.zoom) <= 0) issue(diagnostics, "geometry.zoom", "Zoom must be a positive finite number.", "/design/zoom");
  if (design.fontStyle !== undefined && design.fontStyle !== "normal" && design.fontStyle !== "italic") issue(diagnostics, "enum.font_style", "fontStyle must be normal or italic.", "/design/fontStyle");
  if (design.controlBarometerMode !== undefined && design.controlBarometerMode !== "static" && design.controlBarometerMode !== "directional") issue(diagnostics, "enum.barometer", "controlBarometerMode must be static or directional.", "/design/controlBarometerMode");
  for (const key of ["artworkVisible", "stripBlankConfigKeys", "tintLabels", "tintIcons", "separateAutoTime", "controlBatteryEnabled", "controlSunriseEnabled", "controlSunsetEnabled", "controlFloorEnabled", "controlTemperatureEnabled"] as const) if (design[key] !== undefined) bool(design[key], diagnostics, `/design/${key}`);
  for (const key of ["fontFamily", "previewComplication"] as const) text(design[key], diagnostics, `/design/${key}`, 512);
  if (design.fontWeight !== undefined) finite(design.fontWeight, diagnostics, "/design/fontWeight", { minimum: 1, maximum: 1000 });
  if (design.letterSpacing !== undefined) finite(design.letterSpacing, diagnostics, "/design/letterSpacing", { minimum: -10, maximum: 10 });
  if (design.archiveWatchFaceVersion !== undefined) finite(design.archiveWatchFaceVersion, diagnostics, "/design/archiveWatchFaceVersion", { minimum: 0, maximum: 1000, integer: true });
  validateAdvancedCollections(design, diagnostics);
  if (objectOf(design.modeDesigns)) {
    for (const key of Object.keys(design.modeDesigns)) if (key !== "aod") issue(diagnostics, "mode.unknown", `Unknown display mode: ${key}.`, `/design/modeDesigns/${key}`);
    if (design.modeDesigns.aod !== undefined) {
      validateModeObject(design.modeDesigns.aod, diagnostics, "/design/modeDesigns/aod");
      if (objectOf(design.modeDesigns.aod)) {
        const resolvedAod = { ...design, ...design.modeDesigns.aod };
        validateCollections(resolvedAod, diagnostics);
        if (resolvedAod.backgroundColor !== undefined) requireColor(resolvedAod.backgroundColor, diagnostics, "/design/modeDesigns/aod/backgroundColor");
        requireColor(resolvedAod.accentColor, diagnostics, "/design/modeDesigns/aod/accentColor");
        requireColor(resolvedAod.digitColor, diagnostics, "/design/modeDesigns/aod/digitColor");
        if (resolvedAod.artwork !== null) validateImage(resolvedAod.artwork, diagnostics, "/design/modeDesigns/aod/artwork");
        if (!Number.isFinite(resolvedAod.zoom) || Number(resolvedAod.zoom) <= 0) issue(diagnostics, "geometry.zoom", "AOD zoom must be a positive finite number.", "/design/modeDesigns/aod/zoom");
        validateAdvancedCollections(resolvedAod, diagnostics, "/design/modeDesigns/aod");
      }
    }
  } else if (design.modeDesigns !== undefined) issue(diagnostics, "mode.invalid", "modeDesigns must be an object.", "/design/modeDesigns");
  validateCollections(design, diagnostics);
  if (context?.mode === "aod" && !design.modeDesigns?.aod) diagnostics.push({ severity: "warning", code: "mode.aod_unmaterialized", message: "AOD has not been materialized; edits will create independent AOD state.", path: "/design/modeDesigns/aod" });
  if (context?.details && context.details.resolutions.length === 0) diagnostics.push({ severity: "warning", code: "template.no_resolutions", message: "The starter template has no editable resolution trees." });
  return diagnostics;
}

function validateCollections(design: Record<string, unknown>, diagnostics: WatchfaceAutomationDiagnostic[]): void {
  const sprites = Array.isArray(design.designSprites) ? design.designSprites : [];
  if (!Array.isArray(design.designSprites)) issue(diagnostics, "sprites.invalid", "designSprites must be an array.", "/design/designSprites");
  const ids = new Set<string>();
  for (const [index, raw] of sprites.entries()) {
    const path = `/design/designSprites/${index}`;
    if (!objectOf(raw) || typeof raw.id !== "string" || !raw.id.trim()) { issue(diagnostics, "sprite.invalid", "Each sprite requires a non-empty id.", path); continue; }
    const spriteKeys = new Set(["id", "name", "dataUrl", "sourceWidth", "sourceHeight", "width", "height", "x", "y", "scale", "rotation", "opacity", "flipX", "flipY", "skewX", "skewY", "aspectLocked", "crop", "origin", "visible", "tintColor"]);
    for (const key of Object.keys(raw)) if (!spriteKeys.has(key)) issue(diagnostics, "sprite.unknown_field", `Unknown sprite field: ${key}.`, `${path}/${key}`);
    if (ids.has(raw.id)) issue(diagnostics, "id.duplicate", `Duplicate sprite id: ${raw.id}.`, `${path}/id`); else ids.add(raw.id);
    validateImage({ dataUrl: raw.dataUrl, width: raw.sourceWidth, height: raw.sourceHeight }, diagnostics, path);
    for (const key of ["width", "height", "scale"] as const) if (!Number.isFinite(raw[key]) || Number(raw[key]) <= 0) issue(diagnostics, "geometry.positive", `${key} must be positive and finite.`, `${path}/${key}`);
    for (const key of ["x", "y", "rotation"] as const) if (!Number.isFinite(raw[key])) issue(diagnostics, "number.nonfinite", `${key} must be finite.`, `${path}/${key}`);
    if (raw.opacity !== undefined && (!Number.isFinite(raw.opacity) || Number(raw.opacity) < 0 || Number(raw.opacity) > 1)) issue(diagnostics, "opacity.range", "Opacity must be between 0 and 1.", `${path}/opacity`);
    for (const key of ["flipX", "flipY", "aspectLocked", "visible"] as const) if (raw[key] !== undefined) bool(raw[key], diagnostics, `${path}/${key}`);
    for (const key of ["skewX", "skewY"] as const) if (raw[key] !== undefined) finite(raw[key], diagnostics, `${path}/${key}`, { minimum: -80, maximum: 80 });
    if (raw.tintColor !== undefined && raw.tintColor !== null) requireColor(raw.tintColor, diagnostics, `${path}/tintColor`);
    for (const key of ["crop", "origin"] as const) if (raw[key] !== undefined) {
      const box = raw[key]; if (!objectOf(box)) issue(diagnostics, "geometry.normalized", `${key} must be an object.`, `${path}/${key}`);
      else { const fields = key === "crop" ? ["x", "y", "width", "height"] : ["x", "y"]; allowedKeys(box, fields, diagnostics, `${path}/${key}`); for (const field of fields) finite(box[field], diagnostics, `${path}/${key}/${field}`, { minimum: field === "width" || field === "height" ? Number.EPSILON : 0, maximum: 1 }); }
    }
  }
  const elements = Array.isArray(design.backgroundElements) ? design.backgroundElements : [];
  const elementIds = new Set<string>();
  for (const [index, raw] of elements.entries()) {
    const path = `/design/backgroundElements/${index}`;
    if (!objectOf(raw) || typeof raw.id !== "string" || !raw.id.trim() || !["rect", "ellipse", "line", "text"].includes(String(raw.kind))) { issue(diagnostics, "element.invalid", "Background elements require an id and a supported kind.", path); continue; }
    const commonKeys = ["id", "kind", "x", "y", "rotation", "visible", "opacity"];
    const kindKeys = raw.kind === "rect" ? ["width", "height", "aspectLocked", "cornerRadius", "fill", "gradient", "strokeColor", "strokeWidth"] : raw.kind === "ellipse" ? ["width", "height", "aspectLocked", "fill", "gradient", "strokeColor", "strokeWidth"] : raw.kind === "line" ? ["dx", "dy", "color", "strokeWidth"] : ["text", "fontFamily", "fontSize", "color", "weight", "align"];
    const elementKeys = new Set([...commonKeys, ...kindKeys]);
    for (const key of Object.keys(raw)) if (!elementKeys.has(key)) issue(diagnostics, "element.unknown_field", `Unknown ${String(raw.kind)} element field: ${key}.`, `${path}/${key}`);
    if (elementIds.has(raw.id)) issue(diagnostics, "id.duplicate", `Duplicate background element id: ${raw.id}.`, `${path}/id`); else elementIds.add(raw.id);
    for (const key of ["x", "y", "rotation"] as const) if (!Number.isFinite(raw[key])) issue(diagnostics, "number.nonfinite", `${key} must be finite.`, `${path}/${key}`);
    if ((raw.kind === "rect" || raw.kind === "ellipse") && (!Number.isFinite(raw.width) || !Number.isFinite(raw.height) || Number(raw.width) <= 0 || Number(raw.height) <= 0)) issue(diagnostics, "geometry.size", "Shape width and height must be positive.", path);
    if (raw.kind === "text" && (typeof raw.text !== "string" || !Number.isFinite(raw.fontSize) || Number(raw.fontSize) <= 0 || !["left", "center", "right"].includes(String(raw.align)))) issue(diagnostics, "element.text", "Text elements require text, positive fontSize and a valid alignment.", path);
    for (const key of ["visible", "aspectLocked"] as const) if (raw[key] !== undefined) bool(raw[key], diagnostics, `${path}/${key}`);
    if (raw.opacity !== undefined) finite(raw.opacity, diagnostics, `${path}/opacity`, { minimum: 0, maximum: 1 });
    for (const key of ["fill", "color", "strokeColor"] as const) if (raw[key] !== undefined) requireColor(raw[key], diagnostics, `${path}/${key}`);
    if (raw.strokeWidth !== undefined) finite(raw.strokeWidth, diagnostics, `${path}/strokeWidth`, { minimum: 0, maximum: 1000 });
    if (raw.gradient !== undefined) { const gradient = raw.gradient; if (!objectOf(gradient)) issue(diagnostics, "gradient.invalid", "Gradient must be an object.", `${path}/gradient`); else { allowedKeys(gradient, ["from", "to", "angle"], diagnostics, `${path}/gradient`); requireColor(gradient.from, diagnostics, `${path}/gradient/from`); requireColor(gradient.to, diagnostics, `${path}/gradient/to`); finite(gradient.angle, diagnostics, `${path}/gradient/angle`); } }
  }
  const knownArtworkIds = new Set([...ids].map((id) => `sprite:${id}`).concat([...elementIds].map((id) => `bgel:${id}`)));
  const order = design.artworkLayerOrder;
  if (order !== undefined && (!Array.isArray(order) || order.some((id) => typeof id !== "string" || !knownArtworkIds.has(id)))) issue(diagnostics, "order.reference", "artworkLayerOrder contains an unknown layer id.", "/design/artworkLayerOrder");
  const groups = design.editorGroups;
  if (groups !== undefined && !Array.isArray(groups)) issue(diagnostics, "groups.invalid", "editorGroups must be an array.", "/design/editorGroups");
  const claimed = new Set<string>();
  for (const [index, raw] of (Array.isArray(groups) ? groups : []).entries()) {
    const path = `/design/editorGroups/${index}`;
    if (!objectOf(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.layerIds) || raw.layerIds.length < 2) { issue(diagnostics, "group.invalid", "Groups require id, name and at least two layer ids.", path); continue; }
    for (const key of Object.keys(raw)) if (!["id", "name", "layerIds"].includes(key)) issue(diagnostics, "group.unknown_field", `Unknown group field: ${key}.`, `${path}/${key}`);
    for (const id of raw.layerIds) {
      if (typeof id !== "string" || !id) issue(diagnostics, "group.reference", "Group layer ids must be non-empty strings.", `${path}/layerIds`);
      else if (claimed.has(id)) issue(diagnostics, "group.overlap", `Layer ${id} belongs to more than one group.`, `${path}/layerIds`); else claimed.add(id);
    }
  }
  for (const [index, raw] of (Array.isArray(design.editorGuides) ? design.editorGuides : []).entries()) {
    if (!objectOf(raw) || typeof raw.id !== "string" || !["x", "y"].includes(String(raw.axis)) || !Number.isFinite(raw.position)) issue(diagnostics, "guide.invalid", "Guides require id, x/y axis and finite position.", `/design/editorGuides/${index}`);
    else for (const key of Object.keys(raw)) if (!["id", "axis", "position"].includes(key)) issue(diagnostics, "guide.unknown_field", `Unknown guide field: ${key}.`, `/design/editorGuides/${index}/${key}`);
  }
  for (const [id, opacity] of Object.entries(objectOf(design.layerOpacities) ? design.layerOpacities : {})) if (!Number.isFinite(opacity) || Number(opacity) < 0 || Number(opacity) > 1) issue(diagnostics, "opacity.range", "Layer opacity must be between 0 and 1.", `/design/layerOpacities/${id}`);
}
