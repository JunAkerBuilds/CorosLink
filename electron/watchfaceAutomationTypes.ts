export interface WatchfaceAutomationStatus {
  enabled: boolean;
  url: string | null;
  token: string | null;
  port: number | null;
  error?: string;
}

export interface WatchfaceAutomationRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface WatchfaceAutomationResponse {
  id: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface WatchfaceAutomationAssetRef {
  assetId: string;
}

export type WatchfacePlacementAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export type WatchfacePlaceLayersCommand = {
  op: "place_layers";
  layerIds: string[];
  anchor?: WatchfacePlacementAnchor;
} & (
  | { x: number; y?: number }
  | { x?: number; y: number }
);

export type WatchfaceLayerAlignment =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";

export type WatchfaceAlignmentReference =
  | "canvas"
  | "selection"
  | { layerId: string };

/**
 * Commands are applied as one editor-history entry. Paths use RFC 6901 JSON
 * Pointer syntax and are rooted at the live document returned by get_document.
 */
export type WatchfaceAutomationCommand =
  | { op: "set"; path: string; value: unknown }
  | { op: "unset"; path: string }
  | { op: "merge"; path: string; value: Record<string, unknown> }
  | { op: "array_insert"; path: string; index?: number; value: unknown }
  | { op: "array_remove"; path: string; index: number }
  | { op: "array_move"; path: string; from: number; to: number }
  | { op: "replace_design"; design: Record<string, unknown> }
  | { op: "add_sprite"; sprite: Record<string, unknown> }
  | { op: "update_sprite"; id: string; patch: Record<string, unknown> }
  | { op: "remove_sprite"; id: string }
  | { op: "duplicate_sprite"; id: string; newId: string; offset?: number }
  | { op: "add_element"; element: Record<string, unknown> }
  | { op: "update_element"; id: string; patch: Record<string, unknown> }
  | { op: "remove_element"; id: string }
  | { op: "duplicate_element"; id: string; newId: string; offset?: number }
  | { op: "move_layer"; id: string; dx: number; dy: number }
  | WatchfacePlaceLayersCommand
  | {
      op: "align_layers";
      layerIds: string[];
      alignment: WatchfaceLayerAlignment;
      reference?: WatchfaceAlignmentReference;
    }
  | {
      op: "distribute_layers";
      layerIds: string[];
      direction: "horizontal" | "vertical";
      gap?: number;
    }
  | {
      op: "set_style";
      id: string;
      color?: string;
      opacity?: number;
      effects?: Record<string, unknown>;
      strokes?: Record<string, unknown>[];
    }
  | { op: "set_visibility"; id: string; visible: boolean }
  | { op: "set_locked"; id: string; locked: boolean }
  | { op: "group"; id: string; name: string; layerIds: string[] }
  | { op: "ungroup"; id: string }
  | {
      op: "reorder_layer";
      id: string;
      targetId: string;
      placement: "before" | "after";
    }
  | { op: "add_guide"; guide: Record<string, unknown> }
  | { op: "update_guide"; id: string; patch: Record<string, unknown> }
  | { op: "remove_guide"; id: string }
  | {
      op: "import_raster_font";
      folder: Record<string, unknown>;
      target: {
        kind: "global" | "time" | "metric" | "date" | "selectable";
        id?: string;
      };
      mode?: "current" | "aod";
      tint?: boolean;
    }
  | {
      op: "set_mode_overrides";
      mode: "aod";
      /** Null removes independent AOD state; otherwise shallow-merges overrides. */
      overrides: Record<string, unknown> | null;
      /** Start the override from a dimmed copy of Current before merging. */
      copyFrom?: "current";
    };

export interface WatchfaceAutomationApplyCommandsInput {
  sessionId: string;
  baseRevision: number;
  commands: WatchfaceAutomationCommand[];
  label?: string;
  mode?: "current" | "aod";
}

export const WATCHFACE_AUTOMATION_PROTOCOL_VERSION = 1;

export const WATCHFACE_AUTOMATION_METHODS = {
  getContext: "get_context",
  getDocument: "get_document",
  applyCommands: "apply_commands",
  select: "select",
  undo: "undo",
  redo: "redo",
  setView: "set_view",
  renderPreview: "render_preview",
  validate: "validate",
  save: "save",
  close: "close",
  open: "open",
  convert: "convert",
  listProjects: "list_projects",
  listTemplates: "list_templates",
  loadTemplate: "load_template",
  listFonts: "list_fonts",
  duplicateProject: "duplicate_project",
  deleteProject: "delete_project",
  importArchive: "import_archive",
  exportProject: "export_project",
  buildArchive: "build_archive",
  exportArchive: "export_archive",
  publish: "publish"
} as const;

export const WATCHFACE_AUTOMATION_SCENE_SCHEMA = {
  schemaVersion: 1,
  protocolVersion: WATCHFACE_AUTOMATION_PROTOCOL_VERSION,
  coordinateSystems: {
    master:
      "Placement uses the largest native resolution in the open template as its master canvas; this is often, but not always, 800 x 800.",
    device:
      "Firmware-backed raw config fields remain in their declared referenceWidth/referenceHeight coordinate system. Placement commands translate their rendered bounds into master pixels and export scales the resulting native offsets for each required resolution.",
    normalized:
      "Crop rectangles and transform origins use normalized 0..1 coordinates.",
    angles: "Rotation, skew and gradient angles are degrees clockwise from +x.",
    opacity: "Opacity values are normalized from 0 (transparent) through 1 (opaque)."
  },
  concurrency: {
    rule: "Call get_document, then pass its revision as baseRevision to apply_commands.",
    conflict:
      "A stale baseRevision is rejected. Read the document again and rebase the intended edits.",
    history: "Every apply_commands call is atomic and becomes one human-undoable history entry."
  },
  document: {
    required: ["revision", "scope", "design", "layers", "capabilities"],
    fields: {
      revision: "Monotonic integer for optimistic concurrency.",
      scope: "hub or editor; editing tools require editor.",
      projectId: "Saved project UUID when available.",
      name: "Project display name.",
      sourceArchiveId: "Selected starter archive identifier.",
      firmwareType: "Target COROS firmware family.",
      watchModel: "Target watch model when known.",
      mode: "current or aod.",
      selection: "Selected semantic editor layer ids.",
      layers:
        "Resolved semantic layers. Use their ids for selection and inspect capability/readOnly/locked flags plus placement.bounds, placement.movable and placement.movementKey before moving them.",
      capabilities:
        "Template and firmware feature gates, supported modes, resolution trees, safe areas, export constraints, and capabilities.placement describing the authoritative master-pixel coordinate frame.",
      design: "Editable CorosWatchfaceDesignState version 1, with image data externalized as {assetId}."
    }
  },
  design: {
    archiveWide: [
      "version", "archiveWatchFaceVersion", "stripBlankConfigKeys", "configTextEdits"
    ],
    appearance: [
      "backgroundColor", "accentColor", "artwork", "artworkVisible", "zoom",
      "fontFamily", "rasterFont", "fontWeight", "fontStyle", "letterSpacing",
      "digitColor", "tintLabels", "tintIcons", "previewComplication"
    ],
    firmwareComponents: [
      "metricChanges", "metricStyles", "kcalProgress", "exerciseProgress",
      "exerciseSeparator", "selectableMetricStyle", "controlComplicationEnabled",
      "controlBarometerMode", "controlBatteryEnabled", "controlSunriseEnabled",
      "controlSunsetEnabled", "controlFloorEnabled", "controlTemperatureEnabled",
      "controlIconOffsets", "separateAutoTime", "timeStyles", "dateStyles",
      "staticSeparators", "ampmIndicator", "weatherIndicator", "layoutOffsets"
    ],
    editor: [
      "linkedLayerGroups", "editorGroups", "editorGuides", "lockedLayerIds",
      "effectStyles", "layerEffects", "layerStrokes", "layerVisibility",
      "layerOpacities", "layerColors", "configAssetOverrides"
    ],
    artwork: [
      "designSprites", "artworkLayerOrder", "backgroundElements"
    ],
    alternateModes:
      "modeDesigns.aod may override any visual/editor field above and adds backgroundEdited.",
    imageFields:
      "artwork, designSprites[].dataUrl, configAssetOverrides replacements, rasterFont.dataUrl/sprites, and AOD equivalents are returned as opaque {assetId} refs. Pass those refs unchanged in commands."
  },
  objectShapes: {
    placementCapabilities:
      "{width,height,unit:'pixels'} defines the authoritative placement canvas. Width and height come from the template's largest native resolution.",
    layerPlacement:
      "{bounds:{x0,y0,x1,y1}|null,movable,movementKey}. Bounds are rotation-aware rendered AABBs in placement pixels, use real browser text metrics, and exclude decorative shadows and strokes. Equal movementKey values identify shared stored native positions; editor groups additionally form rigid selections.",
    placeLayersCommand:
      "{op:'place_layers',layerIds:string[],x?:number,y?:number,anchor?:'top-left'|'top'|'top-right'|'left'|'center'|'right'|'bottom-left'|'bottom'|'bottom-right'}. At least one of x/y is required; default anchor center.",
    alignLayersCommand:
      "{op:'align_layers',layerIds:string[],alignment:'left'|'center-x'|'right'|'top'|'center-y'|'bottom',reference?:'canvas'|'selection'|{layerId:string}}.",
    distributeLayersCommand:
      "{op:'distribute_layers',layerIds:string[],direction:'horizontal'|'vertical',gap?:number}. gap is nonnegative; omitted gap distributes between endpoints.",
    visibilityCommand:
      "{op:'set_visibility',id:string,visible:boolean}. Use a semantic layer id or group:<editorGroup.id>; hidden layers remain editable and can be shown again. Individual members hide independently; group operations respect every member lock.",
    moveLayerCommand:
      "{op:'move_layer',id:string,dx:number,dy:number}. Deltas use the placement frame and include linked companions.",
    designSprite:
      "{id,name?,dataUrl:{assetId},sourceWidth,sourceHeight,width,height,x,y,scale,rotation,opacity?,flipX?,flipY?,skewX?,skewY?,aspectLocked?,crop?,origin?,visible?,tintColor?}",
    backgroundRect:
      "{id,kind:'rect',x,y,width,height,rotation,cornerRadius,fill,gradient?,strokeColor?,strokeWidth?,opacity?,visible?,aspectLocked?}",
    backgroundEllipse:
      "{id,kind:'ellipse',x,y,width,height,rotation,fill,gradient?,strokeColor?,strokeWidth?,opacity?,visible?,aspectLocked?}",
    backgroundLine:
      "{id,kind:'line',x,y,dx,dy,rotation,color,strokeWidth,opacity?,visible?}",
    backgroundText:
      "{id,kind:'text',x,y,rotation,text,fontFamily,fontSize,color,weight,align,opacity?,visible?}",
    shadow:
      "{id,kind:'outer-shadow'|'inner-shadow',enabled,color,opacity,blur,spread,distance,angle}",
    stroke:
      "{id,enabled,paint:{kind:'solid',color}|{kind:'linear-gradient',from,to,angle},opacity,position:'inside'|'center'|'outside',weight}",
    guide: "{id,axis:'x'|'y',position}",
    group: "{id,name,layerIds:string[]}"
  },
  commands: {
    path: "RFC 6901 JSON Pointer rooted at the document. Editable design paths begin /design/....",
    set: "Replace or create one property.",
    unset: "Delete one optional property.",
    merge: "Shallow-merge an object.",
    array_insert: "Insert at index or append when index is omitted.",
    array_remove: "Remove one array item by index.",
    array_move: "Move one array item while preserving identity.",
    replace_design:
      "Replace the complete active-mode design state. Prefer small commands for reviewability.",
    sprites:
      "add_sprite, update_sprite, remove_sprite and duplicate_sprite manage imported image layers by stable id.",
    elements:
      "add_element, update_element, remove_element and duplicate_element manage freeform vector/text layers by stable id.",
    layers:
      "move_layer applies master-pixel dx/dy to every supported layer type and moves its complete editor or linked movement group. set_style and set_locked update a semantic layer id. set_visibility hides/shows semantic layers or group:<editorGroup.id> without deleting their assets, styling or position; it follows the editor eye-button behavior in the requested display mode. Locked layers reject every edit except set_locked.",
    placeLayers:
      "place_layers positions the rotation-aware AABB anchor of the rigid selected/group-linked union. x or y (or both) is required; omitted axes do not move, and anchor defaults to center.",
    alignLayers:
      "align_layers aligns physical selection units to canvas, selection, or {layerId}. reference defaults to canvas for one unit and selection for multiple units. A reference layer stays fixed and cannot belong to the moved selection.",
    distributeLayers:
      "distribute_layers sorts physical units spatially. Explicit nonnegative gap requires at least two units and keeps the first fixed. Omitted gap requires at least three units, keeps both endpoints fixed, and makes equal edge gaps.",
    placementFailures:
      "Movement rejects locked or unsupported layers, unreliable bounds, invalid/overlapping reference units, and out-of-bounds results. Native movement rounds to whole pixels, including every member of a mixed rigid selection. Artwork-only movement preserves fractions. Existing off-canvas layers may move toward the canvas or remain unchanged on an axis. Analog hands may clip while the shared pivot stays inside the face.",
    organization:
      "group, ungroup and reorder_layer preserve layer identity and synchronized legacy groups.",
    guides: "add_guide, update_guide and remove_guide manage ruler guides.",
    rasterFonts:
      "import_raster_font consumes a hydrated PNG sprite folder and assigns it globally or to a time, metric, date, or selectable target.",
    modes:
      "set_mode_overrides creates, merges, copies from Current, or resets independent AOD state."
  }
} as const;
