import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceDesignSprite,
  CorosWatchfaceDesignState,
  CorosWatchfaceRasterFont,
  CorosWatchfaceRasterFontFolder
} from "../../electron/types";
import { resolveWatchfaceArtworkLayerOrder } from "./watchfaceArtworkLayers.ts";
import {
  normalizeWatchfaceEditorGroups,
  syncLegacyWatchfaceGroups
} from "./watchfaceEditorLayout.ts";
import {
  materializeLegacyAodDesign,
  resolveWatchfaceModeDesign,
  writeWatchfaceModeDesign
} from "./watchfaceDisplayModes.ts";
import { classifyRasterSpriteFolder } from "./watchfaceRasterFolder.ts";
import { applyWatchfaceLayoutCommand, isWatchfacePlacementCommand } from "./watchfaceAutomationLayoutCommands";
import { setWatchfaceAutomationVisibility } from "./watchfaceAutomationVisibility";
import {
  WATCHFACE_AUTOMATION_LIMITS,
  type WatchfaceAutomationCommandContext,
  type WatchfaceAutomationDiagnostic,
  type WatchfaceAutomationDocumentValue,
  validateWatchfaceAutomationDocument
} from "./watchfaceAutomationSchema.ts";

export {
  validateWatchfaceAutomationDocument,
  type WatchfaceAutomationCommandContext,
  type WatchfaceAutomationDiagnostic,
  type WatchfaceAutomationDocumentValue,
  type WatchfaceAutomationMode
} from "./watchfaceAutomationSchema.ts";

export interface WatchfaceAutomationApplyResult {
  value: WatchfaceAutomationDocumentValue;
  changedLayerIds: string[];
  diagnostics: WatchfaceAutomationDiagnostic[];
}

export class WatchfaceAutomationCommandError extends Error {
  readonly diagnostics: WatchfaceAutomationDiagnostic[];

  constructor(diagnostics: WatchfaceAutomationDiagnostic[]) {
    super(diagnostics[0]?.message ?? "The watch-face commands are invalid.");
    this.name = "WatchfaceAutomationCommandError";
    this.diagnostics = diagnostics;
  }
}

type JsonObject = Record<string, unknown>;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const GLOBAL_DESIGN_FIELDS = new Set([
  "version", "archiveWatchFaceVersion", "stripBlankConfigKeys", "configTextEdits"
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function fail(code: string, message: string, path?: string, commandIndex?: number): never {
  throw new WatchfaceAutomationCommandError([{
    severity: "error",
    code,
    message,
    ...(path ? { path } : {}),
    ...(commandIndex !== undefined ? { commandIndex } : {})
  }]);
}

function assertExactKeys(command: JsonObject, allowed: string[], index: number): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(command)) {
    if (DANGEROUS_KEYS.has(key) || !allowedSet.has(key)) {
      fail("command.unknown_field", `Unknown field ${key} for ${String(command.op)}.`, undefined, index);
    }
  }
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    fail("command.field", `${field} must be a non-empty string.`, undefined, index);
  }
  return value;
}

function requireObject(value: unknown, field: string, index: number): JsonObject {
  if (!isObject(value)) fail("command.field", `${field} must be an object.`, undefined, index);
  return value;
}

function requireInteger(value: unknown, field: string, index: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail("command.field", `${field} must be a non-negative integer.`, undefined, index);
  return Number(value);
}

function decodePointer(path: string, index: number): string[] {
  if (path === "") return [];
  if (!path.startsWith("/") || path.length > 2048) fail("pointer.invalid", "Paths must use RFC 6901 JSON Pointer syntax.", path, index);
  const segments = path.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) fail("pointer.invalid", "A path contains an invalid JSON Pointer escape.", path, index);
    const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (DANGEROUS_KEYS.has(decoded)) fail("pointer.dangerous", `The path segment ${decoded} is not allowed.`, path, index);
    return decoded;
  });
  if (segments[0] !== "design" && segments[0] !== "projectName") fail("pointer.scope", "Editable paths begin with /design or /projectName.", path, index);
  if (segments[0] === "projectName" && segments.length !== 1) fail("pointer.scope", "projectName has no child fields.", path, index);
  if (segments[0] === "design" && segments[1] === "modeDesigns") fail("pointer.mode", "Use set_mode_overrides or choose the AOD view instead of editing modeDesigns directly.", path, index);
  if (segments[0] === "design" && segments[1] === "lockedLayerIds") fail("lock.explicit", "Use set_locked to change layer locks.", path, index);
  return segments;
}

function atPointer(root: unknown, segments: string[], path: string, index: number): unknown {
  let cursor = root;
  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const offset = Number(segment);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= cursor.length) fail("pointer.missing", `Path does not exist: ${path}.`, path, index);
      cursor = cursor[offset];
    } else if (isObject(cursor) && own(cursor, segment)) {
      cursor = cursor[segment];
    } else {
      fail("pointer.missing", `Path does not exist: ${path}.`, path, index);
    }
  }
  return cursor;
}

function parentAtPointer(root: unknown, segments: string[], path: string, index: number): { parent: JsonObject | unknown[]; key: string } {
  if (segments.length === 0) fail("pointer.root", "The document root cannot be replaced by a pointer command.", path, index);
  const key = segments.at(-1)!;
  const parent = atPointer(root, segments.slice(0, -1), path, index);
  if (!isObject(parent) && !Array.isArray(parent)) fail("pointer.parent", "The path parent is not a collection.", path, index);
  return { parent, key };
}

function arrayIndex(key: string, length: number, allowEnd: boolean, path: string, index: number): number {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) fail("pointer.index", "Array path segments must be canonical non-negative integers.", path, index);
  const offset = Number(key);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length || (!allowEnd && offset === length)) fail("pointer.index", "Array index is outside the collection.", path, index);
  return offset;
}

function setPointer(root: JsonObject, segments: string[], value: unknown, path: string, index: number): void {
  const { parent, key } = parentAtPointer(root, segments, path, index);
  if (Array.isArray(parent)) parent[arrayIndex(key, parent.length, false, path, index)] = structuredClone(value);
  else parent[key] = structuredClone(value);
}

function unsetPointer(root: JsonObject, segments: string[], path: string, index: number): void {
  const { parent, key } = parentAtPointer(root, segments, path, index);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, false, path, index), 1);
  else {
    if (!own(parent, key)) fail("pointer.missing", `Path does not exist: ${path}.`, path, index);
    delete parent[key];
  }
}

function activeLayerIds(design: CorosWatchfaceDesignState, context: WatchfaceAutomationCommandContext): Set<string> {
  const ids = new Set([
    "background", "artwork", "hours", "minutes", "seconds", "autoTime",
    "weekday", "dateMonth", "dateDay", "ampm", "weather", "batteryIcon",
    "controlBatteryIcon", "complication", "kcalProgress", "exerciseProgress",
    "exerciseSeparator", "battery", "heartRate", "steps", "calories",
    "exercise", "elevation", "temperature", "floors", "barometer", "sunrise",
    "sunset", "analogHour", "analogMinute", "analogSecond"
  ]);
  for (const record of [design.layoutOffsets, design.layerVisibility, design.layerOpacities, design.layerColors, design.layerEffects, design.layerStrokes]) {
    for (const id of Object.keys(record ?? {})) ids.add(id);
  }
  for (const group of design.editorGroups ?? []) for (const id of group.layerIds) ids.add(id);
  for (const resolution of context.details.resolutions) {
    for (const key of [...Object.keys(resolution.config), ...Object.keys(resolution.aodConfig)]) {
      if (key.endsWith("_icon") || key.endsWith("_dir")) ids.add(`configAsset:config:${key}`);
    }
  }
  for (const sprite of design.designSprites) ids.add(`sprite:${sprite.id}`);
  for (const element of design.backgroundElements ?? []) ids.add(`bgel:${element.id}`);
  return ids;
}

function findSprite(design: CorosWatchfaceDesignState, layerId: string): CorosWatchfaceDesignSprite | undefined {
  const id = layerId.startsWith("sprite:") ? layerId.slice(7) : layerId;
  return design.designSprites.find((sprite) => sprite.id === id);
}

function findElement(design: CorosWatchfaceDesignState, layerId: string): CorosWatchfaceBackgroundElement | undefined {
  const id = layerId.startsWith("bgel:") ? layerId.slice(5) : layerId;
  return design.backgroundElements?.find((element) => element.id === id);
}

function requireLayer(design: CorosWatchfaceDesignState, id: string, context: WatchfaceAutomationCommandContext, index: number): void {
  if (!activeLayerIds(design, context).has(id)) fail("layer.missing", `Layer ${id} does not exist in this template and mode.`, undefined, index);
}

function requireUnlocked(design: CorosWatchfaceDesignState, ids: Iterable<string>, index: number): void {
  const locked = new Set(design.lockedLayerIds ?? []);
  const blocked = [...ids].filter((id) => locked.has(id));
  if (blocked.length) fail("layer.locked", `Unlock ${blocked.join(", ")} before editing.`, undefined, index);
}

function affectedLayerIds(command: JsonObject, design: CorosWatchfaceDesignState, index: number): string[] {
  if (typeof command.id === "string") return [command.id.startsWith("sprite:") || command.id.startsWith("bgel:") ? command.id : command.op?.toString().includes("sprite") ? `sprite:${command.id}` : command.op?.toString().includes("element") ? `bgel:${command.id}` : command.id];
  if (Array.isArray(command.layerIds)) return command.layerIds.filter((id): id is string => typeof id === "string");
  if (typeof command.path !== "string") return [];
  const segments = decodePointer(command.path, index);
  if (segments[0] !== "design") return [];
  if (segments.length === 1) return [...(design.lockedLayerIds ?? [])];
  if (segments[1] === "designSprites" && segments[2] !== undefined) {
    const sprite = design.designSprites[Number(segments[2])];
    return sprite ? [`sprite:${sprite.id}`] : [];
  }
  if (segments[1] === "backgroundElements" && segments[2] !== undefined) {
    const element = design.backgroundElements?.[Number(segments[2])];
    return element ? [`bgel:${element.id}`] : [];
  }
  if (["layoutOffsets", "layerVisibility", "layerOpacities", "layerColors", "layerEffects", "layerStrokes", "configAssetOverrides"].includes(segments[1] ?? "") && segments[2]) return [segments[2]];
  if (["metricStyles", "timeStyles", "dateStyles"].includes(segments[1] ?? "") && segments[2]) return [segments[2]];
  if (["rasterFont", "fontFamily", "fontWeight", "fontStyle", "letterSpacing", "effectStyles"].includes(segments[1] ?? "")) return [...(design.lockedLayerIds ?? [])];
  if (["designSprites", "backgroundElements", "artworkLayerOrder", "editorGroups", "linkedLayerGroups"].includes(segments[1] ?? "")) return [...(design.lockedLayerIds ?? [])];
  return [];
}

function removeLayerReferences(design: CorosWatchfaceDesignState, layerId: string): CorosWatchfaceDesignState {
  const without = (record: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(record ?? {}).filter(([id]) => id !== layerId));
  return syncLegacyWatchfaceGroups({
    ...design,
    artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(design).filter((id) => id !== layerId),
    editorGroups: (design.editorGroups ?? []).map((group) => ({ ...group, layerIds: group.layerIds.filter((id) => id !== layerId) })).filter((group) => group.layerIds.length >= 2),
    lockedLayerIds: (design.lockedLayerIds ?? []).filter((id) => id !== layerId),
    layerEffects: without(design.layerEffects) as CorosWatchfaceDesignState["layerEffects"],
    layerStrokes: without(design.layerStrokes) as CorosWatchfaceDesignState["layerStrokes"],
    layerVisibility: without(design.layerVisibility) as Record<string, boolean>,
    layerOpacities: without(design.layerOpacities) as Record<string, number>,
    layerColors: without(design.layerColors) as Record<string, string>
  });
}

function pngSize(dataUrl: string, index: number): { width: number; height: number } {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail("font.image", "Raster-font sprites must be PNG data URLs.", undefined, index);
  let binary: string;
  try { binary = atob(match[1]); } catch { fail("font.image", "A raster-font sprite has invalid base64 data.", undefined, index); }
  if (binary.length < 24 || binary.slice(1, 4) !== "PNG") fail("font.image", "A raster-font sprite is not a valid PNG.", undefined, index);
  const uint32 = (offset: number) => ((binary.charCodeAt(offset) << 24) | (binary.charCodeAt(offset + 1) << 16) | (binary.charCodeAt(offset + 2) << 8) | binary.charCodeAt(offset + 3)) >>> 0;
  const width = uint32(16); const height = uint32(20);
  if (!width || !height || width > 4096 || height > 4096) fail("font.image", "Raster-font sprite dimensions must be between 1 and 4096 pixels.", undefined, index);
  return { width, height };
}

function rasterFontFromFolder(folder: CorosWatchfaceRasterFontFolder, targetKind: string, targetId: string | undefined, index: number): CorosWatchfaceRasterFont {
  if (!folder.sprites.length || folder.sprites.length > 256) fail("font.folder", "Raster-font folders require between 1 and 256 PNG sprites.", undefined, index);
  const componentKind = targetKind === "date" && targetId === "weekday"
    ? "weekday"
    : targetKind === "date" && targetId === "dateMonth"
      ? "month"
      : undefined;
  let classified;
  try { classified = classifyRasterSpriteFolder(folder, componentKind); }
  catch (error) { fail("font.folder", error instanceof Error ? error.message : "The raster-font folder is invalid.", undefined, index); }
  if (classified.digitSprites.size === 0 && classified.labelSprites.size === 0) fail("font.folder", "The folder does not contain recognized digit, weekday, or month sprites.", undefined, index);
  const entries = [...classified.digitSprites, ...classified.labelSprites];
  const sprites = Object.fromEntries(entries.map(([key, sprite]) => [key, sprite.dataUrl]));
  const spriteSizes = Object.fromEntries(entries.map(([key, sprite]) => [key, pngSize(sprite.dataUrl, index)]));
  const labels = Object.fromEntries(Array.from(classified.labelSprites, ([key, sprite]) => [key, sprite.dataUrl]));
  const glyphs = [...classified.digitSprites.keys()].sort((a, b) => Number(a) - Number(b)).join("");
  const first = entries[0]![1];
  return {
    label: folder.label.replace(/[-_]+/g, " ").trim() || "Custom PNG sprites",
    dataUrl: first.dataUrl,
    glyphs,
    columns: Math.max(1, glyphs.length),
    ...(Object.keys(labels).length ? { labels } : {}),
    sprites,
    spriteSizes,
    atlasSize: pngSize(first.dataUrl, index),
    tint: false
  };
}

function applySemantic(command: JsonObject, design: CorosWatchfaceDesignState, context: WatchfaceAutomationCommandContext, index: number, changed: Set<string>): CorosWatchfaceDesignState | null {
  const op = command.op;
  if (op === "import_raster_font") {
    assertExactKeys(command, ["op", "folder", "target", "mode", "tint"], index);
    if (command.mode !== undefined && command.mode !== (context.mode ?? "current")) fail("mode.mismatch", "The command mode must match the active editor mode.", undefined, index);
    const folder = requireObject(command.folder, "folder", index) as unknown as CorosWatchfaceRasterFontFolder;
    if (typeof folder.label !== "string" || !Array.isArray(folder.sprites)) fail("font.folder", "folder requires a label and sprites array.", undefined, index);
    const target = requireObject(command.target, "target", index); const kind = requireString(target.kind, "target.kind", index); const targetId = typeof target.id === "string" ? target.id : undefined; const font = rasterFontFromFolder(folder, kind, targetId, index); font.tint = command.tint === true;
    if (kind === "global") return { ...design, rasterFont: font };
    const id = requireString(target.id, "target.id", index);
    if (kind === "time") { if (!["hours", "minutes", "seconds", "autoTime"].includes(id)) fail("font.target", `Unknown time target ${id}.`, undefined, index); changed.add(id); return { ...design, timeStyles: { ...design.timeStyles, [id]: { ...(design.timeStyles[id] ?? { scale: 1 }), rasterFont: font } } }; }
    if (kind === "metric") { changed.add(id); return { ...design, metricStyles: { ...design.metricStyles, [id]: { ...(design.metricStyles[id] ?? { scale: 1 }), rasterFont: font } } }; }
    if (kind === "date") { if (!["weekday", "dateMonth", "dateDay"].includes(id)) fail("font.target", `Unknown date target ${id}.`, undefined, index); changed.add(id); return { ...design, dateStyles: { ...(design.dateStyles ?? {}), [id]: { ...(design.dateStyles?.[id] ?? { scale: 1 }), rasterFont: font } } }; }
    if (kind === "selectable") { changed.add("complication"); return { ...design, selectableMetricStyle: { ...(design.selectableMetricStyle ?? { scale: 1 }), rasterFont: font } }; }
    fail("font.target", `Unknown raster-font target kind ${kind}.`, undefined, index);
  }
  if (op === "add_sprite") {
    assertExactKeys(command, ["op", "sprite"], index);
    const sprite = requireObject(command.sprite, "sprite", index) as unknown as CorosWatchfaceDesignSprite;
    requireString(sprite.id, "sprite.id", index);
    if (design.designSprites.some((candidate) => candidate.id === sprite.id)) fail("id.duplicate", `Sprite ${sprite.id} already exists.`, undefined, index);
    const id = `sprite:${sprite.id}`; changed.add(id);
    return { ...design, designSprites: [...design.designSprites, structuredClone(sprite)], artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design), id] };
  }
  if (op === "update_sprite") {
    assertExactKeys(command, ["op", "id", "patch"], index);
    const id = requireString(command.id, "id", index); const layerId = `sprite:${id}`;
    const patch = requireObject(command.patch, "patch", index);
    if (own(patch, "id")) fail("id.immutable", "Sprite ids cannot be changed.", undefined, index);
    if (!findSprite(design, id)) fail("layer.missing", `Sprite ${id} does not exist.`, undefined, index);
    requireUnlocked(design, [layerId], index); changed.add(layerId);
    return { ...design, designSprites: design.designSprites.map((sprite) => sprite.id === id ? { ...sprite, ...structuredClone(patch) } as CorosWatchfaceDesignSprite : sprite) };
  }
  if (op === "remove_sprite") {
    assertExactKeys(command, ["op", "id"], index); const id = requireString(command.id, "id", index); const layerId = `sprite:${id}`;
    if (!findSprite(design, id)) fail("layer.missing", `Sprite ${id} does not exist.`, undefined, index);
    requireUnlocked(design, [layerId], index); changed.add(layerId);
    return { ...removeLayerReferences(design, layerId), designSprites: design.designSprites.filter((sprite) => sprite.id !== id) };
  }
  if (op === "duplicate_sprite") {
    assertExactKeys(command, ["op", "id", "newId", "offset"], index); const id = requireString(command.id, "id", index); const newId = requireString(command.newId, "newId", index);
    const source = findSprite(design, id); if (!source) fail("layer.missing", `Sprite ${id} does not exist.`, undefined, index);
    if (findSprite(design, newId)) fail("id.duplicate", `Sprite ${newId} already exists.`, undefined, index);
    requireUnlocked(design, [`sprite:${id}`], index); const offset = command.offset === undefined ? 16 : Number(command.offset);
    if (!Number.isFinite(offset)) fail("command.field", "offset must be finite.", undefined, index);
    const copy = structuredClone(source); copy.id = newId; copy.name = `${(source.name || "Imported sprite").slice(0, 55)} copy`; copy.x += offset; copy.y += offset;
    const layerId = `sprite:${newId}`; changed.add(layerId);
    return { ...design, designSprites: [...design.designSprites, copy], artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design), layerId] };
  }
  if (op === "add_element") {
    assertExactKeys(command, ["op", "element"], index); const element = requireObject(command.element, "element", index) as unknown as CorosWatchfaceBackgroundElement;
    requireString(element.id, "element.id", index); if (findElement(design, element.id)) fail("id.duplicate", `Element ${element.id} already exists.`, undefined, index);
    const layerId = `bgel:${element.id}`; changed.add(layerId);
    return { ...design, backgroundElements: [...(design.backgroundElements ?? []), structuredClone(element)], artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design), layerId] };
  }
  if (op === "update_element") {
    assertExactKeys(command, ["op", "id", "patch"], index); const id = requireString(command.id, "id", index); const layerId = `bgel:${id}`; const patch = requireObject(command.patch, "patch", index);
    if (own(patch, "id") || own(patch, "kind")) fail("id.immutable", "Element id and kind cannot be changed.", undefined, index);
    if (!findElement(design, id)) fail("layer.missing", `Element ${id} does not exist.`, undefined, index); requireUnlocked(design, [layerId], index); changed.add(layerId);
    return { ...design, backgroundElements: (design.backgroundElements ?? []).map((element) => element.id === id ? { ...element, ...structuredClone(patch) } as CorosWatchfaceBackgroundElement : element) };
  }
  if (op === "remove_element") {
    assertExactKeys(command, ["op", "id"], index); const id = requireString(command.id, "id", index); const layerId = `bgel:${id}`;
    if (!findElement(design, id)) fail("layer.missing", `Element ${id} does not exist.`, undefined, index); requireUnlocked(design, [layerId], index); changed.add(layerId);
    return { ...removeLayerReferences(design, layerId), backgroundElements: (design.backgroundElements ?? []).filter((element) => element.id !== id) };
  }
  if (op === "duplicate_element") {
    assertExactKeys(command, ["op", "id", "newId", "offset"], index); const id = requireString(command.id, "id", index); const newId = requireString(command.newId, "newId", index); const source = findElement(design, id);
    if (!source) fail("layer.missing", `Element ${id} does not exist.`, undefined, index); if (findElement(design, newId)) fail("id.duplicate", `Element ${newId} already exists.`, undefined, index); requireUnlocked(design, [`bgel:${id}`], index);
    const offset = command.offset === undefined ? 16 : Number(command.offset); if (!Number.isFinite(offset)) fail("command.field", "offset must be finite.", undefined, index);
    const copy = structuredClone(source); copy.id = newId; copy.x += offset; copy.y += offset; const layerId = `bgel:${newId}`; changed.add(layerId);
    return { ...design, backgroundElements: [...(design.backgroundElements ?? []), copy], artworkLayerOrder: [...resolveWatchfaceArtworkLayerOrder(design), layerId] };
  }
  if (isWatchfacePlacementCommand(op)) {
    const errors = validateWatchfaceAutomationDocument({ projectName: "Placement", design }, context)
      .filter((item) => item.severity === "error");
    if (errors.length) throw new WatchfaceAutomationCommandError(errors.map((item) => ({ ...item, commandIndex: index })));
    try {
      const result = applyWatchfaceLayoutCommand(design, command, context);
      for (const id of result.changedLayerIds) changed.add(id);
      return result.design;
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code : "placement.invalid_geometry";
      fail(code, error instanceof Error ? error.message : "Unable to resolve placement geometry.", undefined, index);
    }
  }
  if (op === "set_style") {
    assertExactKeys(command, ["op", "id", "color", "opacity", "effects", "strokes"], index); const id = requireString(command.id, "id", index); requireLayer(design, id, context, index); requireUnlocked(design, [id], index); changed.add(id);
    return { ...design,
      ...(command.color !== undefined ? { layerColors: { ...(design.layerColors ?? {}), [id]: command.color as string } } : {}),
      ...(command.opacity !== undefined ? { layerOpacities: { ...(design.layerOpacities ?? {}), [id]: command.opacity as number } } : {}),
      ...(command.effects !== undefined ? { layerEffects: { ...(design.layerEffects ?? {}), [id]: structuredClone(command.effects) as never } } : {}),
      ...(command.strokes !== undefined ? { layerStrokes: { ...(design.layerStrokes ?? {}), [id]: structuredClone(command.strokes) as never } } : {})
    };
  }
  if (op === "set_visibility") {
    assertExactKeys(command, ["op", "id", "visible"], index);
    const id = requireString(command.id, "id", index);
    if (typeof command.visible !== "boolean") fail("command.field", "visible must be boolean.", undefined, index);
    try {
      const next = setWatchfaceAutomationVisibility(design, context.details, context.mode ?? "current", id, command.visible);
      if (id.startsWith("group:")) {
        const group = normalizeWatchfaceEditorGroups(design.editorGroups, design.linkedLayerGroups).find((candidate) => candidate.id === id.slice(6));
        for (const member of group?.layerIds ?? []) changed.add(member);
      } else changed.add(id === "artwork" ? "background" : id);
      return next;
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code : "visibility.invalid";
      fail(code, error instanceof Error ? error.message : "Unable to change layer visibility.", undefined, index);
    }
  }
  if (op === "set_locked") {
    assertExactKeys(command, ["op", "id", "locked"], index); const id = requireString(command.id, "id", index); if (typeof command.locked !== "boolean") fail("command.field", "locked must be boolean.", undefined, index); requireLayer(design, id, context, index); changed.add(id);
    const locks = new Set(design.lockedLayerIds ?? []); if (command.locked) locks.add(id); else locks.delete(id); return { ...design, lockedLayerIds: [...locks] };
  }
  if (op === "group") {
    assertExactKeys(command, ["op", "id", "name", "layerIds"], index); const id = requireString(command.id, "id", index); const name = requireString(command.name, "name", index); if (!Array.isArray(command.layerIds) || command.layerIds.length < 2) fail("command.field", "layerIds must contain at least two layers.", undefined, index);
    const layerIds = [...new Set(command.layerIds.map((item) => requireString(item, "layerIds[]", index)))]; if (layerIds.length < 2) fail("command.field", "A group requires two distinct layers.", undefined, index); layerIds.forEach((layerId) => requireLayer(design, layerId, context, index)); requireUnlocked(design, layerIds, index);
    if ((design.editorGroups ?? []).some((group) => group.id === id)) fail("id.duplicate", `Group ${id} already exists.`, undefined, index);
    const touching = (design.editorGroups ?? []).filter((group) => group.layerIds.some((layerId) => layerIds.includes(layerId))); const merged = [...new Set([...layerIds, ...touching.flatMap((group) => group.layerIds)])]; requireUnlocked(design, merged, index); merged.forEach((layerId) => changed.add(layerId));
    return syncLegacyWatchfaceGroups({ ...design, editorGroups: [...(design.editorGroups ?? []).filter((group) => !touching.includes(group)), { id, name, layerIds: merged }] });
  }
  if (op === "ungroup") {
    assertExactKeys(command, ["op", "id"], index); const id = requireString(command.id, "id", index); const group = (design.editorGroups ?? []).find((candidate) => candidate.id === id); if (!group) fail("group.missing", `Group ${id} does not exist.`, undefined, index); requireUnlocked(design, group.layerIds, index); group.layerIds.forEach((layerId) => changed.add(layerId));
    return syncLegacyWatchfaceGroups({ ...design, editorGroups: (design.editorGroups ?? []).filter((candidate) => candidate.id !== id) });
  }
  if (op === "reorder_layer") {
    assertExactKeys(command, ["op", "id", "targetId", "placement"], index); const id = requireString(command.id, "id", index); const targetId = requireString(command.targetId, "targetId", index); if (command.placement !== "before" && command.placement !== "after") fail("command.field", "placement must be before or after.", undefined, index); requireUnlocked(design, [id, targetId], index);
    const order = resolveWatchfaceArtworkLayerOrder(design); if (!order.includes(id) || !order.includes(targetId)) fail("order.reference", "Only authored sprite and background-element layers can be reordered.", undefined, index); const next = order.filter((item) => item !== id); const at = next.indexOf(targetId); next.splice(command.placement === "before" ? at + 1 : at, 0, id); changed.add(id); return { ...design, artworkLayerOrder: next };
  }
  if (op === "add_guide") {
    assertExactKeys(command, ["op", "guide"], index); const guide = requireObject(command.guide, "guide", index); const id = requireString(guide.id, "guide.id", index); if ((design.editorGuides ?? []).some((item) => item.id === id)) fail("id.duplicate", `Guide ${id} already exists.`, undefined, index); return { ...design, editorGuides: [...(design.editorGuides ?? []), structuredClone(guide) as never] };
  }
  if (op === "update_guide") {
    assertExactKeys(command, ["op", "id", "patch"], index); const id = requireString(command.id, "id", index); const patch = requireObject(command.patch, "patch", index);
    if (own(patch, "id")) fail("id.immutable", "Guide ids cannot be changed.", undefined, index); if (!(design.editorGuides ?? []).some((item) => item.id === id)) fail("guide.missing", `Guide ${id} does not exist.`, undefined, index);
    return { ...design, editorGuides: (design.editorGuides ?? []).map((item) => item.id === id ? { ...item, ...structuredClone(patch) } as never : item) };
  }
  if (op === "remove_guide") {
    assertExactKeys(command, ["op", "id"], index); const id = requireString(command.id, "id", index); if (!(design.editorGuides ?? []).some((item) => item.id === id)) fail("guide.missing", `Guide ${id} does not exist.`, undefined, index); return { ...design, editorGuides: (design.editorGuides ?? []).filter((item) => item.id !== id) };
  }
  return null;
}

function applyPointer(command: JsonObject, document: JsonObject, design: CorosWatchfaceDesignState, index: number): void {
  const op = command.op;
  if (op === "replace_design") {
    assertExactKeys(command, ["op", "design"], index); const replacement = requireObject(command.design, "design", index);
    requireUnlocked(design, design.lockedLayerIds ?? [], index);
    const nextLocks = Array.isArray(replacement.lockedLayerIds) ? replacement.lockedLayerIds : [];
    if (JSON.stringify(nextLocks) !== JSON.stringify(design.lockedLayerIds ?? [])) fail("lock.explicit", "replace_design cannot change locks; use set_locked.", undefined, index);
    document.design = structuredClone(replacement); return;
  }
  if (!["set", "unset", "merge", "array_insert", "array_remove", "array_move"].includes(String(op))) fail("command.op", `Unsupported command: ${String(op)}.`, undefined, index);
  const allowed = op === "set" ? ["op", "path", "value"] : op === "unset" ? ["op", "path"] : op === "merge" ? ["op", "path", "value"] : op === "array_insert" ? ["op", "path", "index", "value"] : op === "array_remove" ? ["op", "path", "index"] : ["op", "path", "from", "to"];
  assertExactKeys(command, allowed, index); const path = requireString(command.path, "path", index); const segments = decodePointer(path, index);
  if (segments.length === 1 && segments[0] === "design" && op !== "merge") fail("pointer.design_root", "Use replace_design for a complete design replacement.", path, index);
  if (segments.length === 1 && segments[0] === "design" && op === "merge" && isObject(command.value) && (own(command.value, "lockedLayerIds") || own(command.value, "modeDesigns"))) fail("pointer.protected", "Design merges cannot change locks or display modes.", path, index);
  requireUnlocked(design, affectedLayerIds(command, design, index), index);
  if (op === "set") { if (!own(command, "value")) fail("command.field", "set requires value.", path, index); setPointer(document, segments, command.value, path, index); return; }
  if (op === "unset") { unsetPointer(document, segments, path, index); return; }
  const target = atPointer(document, segments, path, index);
  if (op === "merge") {
    if (!isObject(target)) fail("command.target", "merge target must be an object.", path, index); const patch = requireObject(command.value, "value", index); for (const [key, value] of Object.entries(patch)) { if (DANGEROUS_KEYS.has(key)) fail("object.dangerous_key", `The key ${key} is not allowed.`, path, index); target[key] = structuredClone(value); } return;
  }
  if (!Array.isArray(target)) fail("command.target", `${String(op)} target must be an array.`, path, index);
  if (op === "array_insert") { if (target.length >= WATCHFACE_AUTOMATION_LIMITS.maximumCollectionLength) fail("limit.array", "The target array is full.", path, index); const offset = command.index === undefined ? target.length : requireInteger(command.index, "index", index); if (offset > target.length) fail("command.index", "Insert index is outside the array.", path, index); target.splice(offset, 0, structuredClone(command.value)); return; }
  if (op === "array_remove") { const offset = requireInteger(command.index, "index", index); if (offset >= target.length) fail("command.index", "Remove index is outside the array.", path, index); target.splice(offset, 1); return; }
  const from = requireInteger(command.from, "from", index); const to = requireInteger(command.to, "to", index); if (from >= target.length || to >= target.length) fail("command.index", "Move indices are outside the array.", path, index); const [item] = target.splice(from, 1); target.splice(to, 0, item);
}

export function applyWatchfaceAutomationCommands(
  value: WatchfaceAutomationDocumentValue,
  commands: unknown[],
  context: WatchfaceAutomationCommandContext
): WatchfaceAutomationApplyResult {
  const before = validateWatchfaceAutomationDocument(value, context).filter((item) => item.severity === "error");
  if (before.length) throw new WatchfaceAutomationCommandError(before);
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > WATCHFACE_AUTOMATION_LIMITS.maximumCommands) fail("commands.count", `Provide between 1 and ${WATCHFACE_AUTOMATION_LIMITS.maximumCommands} commands.`);
  const mode = context.mode ?? "current";
  const root = structuredClone(value.design);
  let active = resolveWatchfaceModeDesign(root, mode);
  const document: JsonObject = { projectName: value.projectName, design: active };
  const changed = new Set<string>();
  let activeDirty = false;
  for (const [index, raw] of commands.entries()) {
    if (!isObject(raw) || typeof raw.op !== "string") fail("command.invalid", "Each command must be an object with an op.", undefined, index);
    if (raw.op === "set_mode_overrides") {
      assertExactKeys(raw, ["op", "mode", "overrides", "copyFrom"], index);
      if (raw.mode !== "aod") fail("command.field", "Only aod mode overrides are supported.", undefined, index);
      if (raw.overrides !== null && !isObject(raw.overrides)) fail("command.field", "overrides must be an object or null.", undefined, index);
      if (raw.copyFrom !== undefined && raw.copyFrom !== "current") fail("command.field", "copyFrom must be current.", undefined, index);
      if (isObject(raw.overrides) && own(raw.overrides, "lockedLayerIds")) fail("lock.explicit", "set_mode_overrides cannot change locks; use set_locked in the AOD view.", undefined, index);
      requireUnlocked(resolveWatchfaceModeDesign(root, "aod"), resolveWatchfaceModeDesign(root, "aod").lockedLayerIds ?? [], index);
      if (raw.overrides === null) {
        const modes = { ...(root.modeDesigns ?? {}) }; delete modes.aod;
        root.modeDesigns = Object.keys(modes).length ? modes : undefined;
      } else {
        const base = raw.copyFrom === "current"
          ? materializeLegacyAodDesign(root, root.artwork, root.backgroundColor)
          : root.modeDesigns?.aod ?? {};
        root.modeDesigns = { ...(root.modeDesigns ?? {}), aod: { ...base, ...structuredClone(raw.overrides) } };
      }
      active = resolveWatchfaceModeDesign(root, mode); document.design = active; activeDirty = false;
      continue;
    }
    active = document.design as CorosWatchfaceDesignState;
    const semantic = applySemantic(raw, active, context, index, changed);
    if (semantic) document.design = semantic;
    else {
      for (const id of affectedLayerIds(raw, active, index)) changed.add(id);
      applyPointer(raw, document, active, index);
    }
    if (raw.op !== "set" || raw.path !== "/projectName") activeDirty = true;
  }
  active = document.design as CorosWatchfaceDesignState;
  const stagedDiagnostics = validateWatchfaceAutomationDocument(
    { projectName: String(document.projectName), design: active },
    context
  );
  const stagedErrors = stagedDiagnostics.filter((item) => item.severity === "error");
  if (stagedErrors.length) throw new WatchfaceAutomationCommandError(stagedErrors.map((item) => ({ ...item, commandIndex: item.commandIndex ?? commands.length - 1 })));
  const normalizedActive = syncLegacyWatchfaceGroups({ ...active, artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(active) });
  const nextDesign = activeDirty
    ? writeWatchfaceModeDesign(root, mode, normalizedActive)
    : root;
  const next = { projectName: String(document.projectName), design: nextDesign };
  const diagnostics = validateWatchfaceAutomationDocument(next, context);
  const errors = diagnostics.filter((item) => item.severity === "error");
  if (errors.length) throw new WatchfaceAutomationCommandError(errors.map((item) => ({ ...item, commandIndex: item.commandIndex ?? commands.length - 1 })));
  return { value: next, changedLayerIds: [...changed], diagnostics };
}

export function copyWatchfaceAutomationCurrentToAod(design: CorosWatchfaceDesignState): CorosWatchfaceDesignState {
  const aod = materializeLegacyAodDesign(design, design.artwork, design.backgroundColor);
  return { ...design, modeDesigns: { ...(design.modeDesigns ?? {}), aod } };
}
