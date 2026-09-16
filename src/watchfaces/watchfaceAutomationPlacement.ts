import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import { deriveDesignDetails } from "./watchfaceCompose";
import { BACKGROUND_SPACE } from "./watchfaceBackgroundElements";
import type { WatchfaceEditorBounds } from "./watchfaceEditorGeometry";
import { deriveEditorLayers } from "./watchfaceEditorModel";
import { editorGroupForLayer } from "./watchfaceEditorLayout";
import {
  backgroundElementSnapBounds,
  scaleWatchfaceBounds
} from "./watchfaceEditorSnapping";
import {
  applyConfigTextEditsToDetails,
  computeLayoutOffsetLimits,
  detailsForCompositionMode,
  pickPreviewResolution,
  type WatchfaceLayoutOffsetLimits,
  type WatchfacePreviewMode
} from "./watchfaceStudio";
import { watchfaceEditorLayerIsListed } from "./watchfaceEditorVisibility";

const PLACEMENT_EPSILON = 1e-6;

export interface WatchfacePlacementLayer {
  id: string;
  bounds: WatchfaceEditorBounds | null;
  movable: boolean;
  /** Equal keys identify editor layers backed by the same stored position. */
  movementKey: string | null;
}

export interface WatchfacePlacementScene {
  width: number;
  height: number;
  layers: WatchfacePlacementLayer[];
  /** Limits for `layout:<groupId>` movement keys, in native-master pixels. */
  nativeOffsetLimits: Record<string, WatchfaceLayoutOffsetLimits>;
}

export interface WatchfacePlacementMovement {
  layerIds: string[];
  dx: number;
  dy: number;
}

export class WatchfacePlacementError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WatchfacePlacementError";
    this.code = code;
  }
}

function movementKeyForLayer(layer: ReturnType<typeof deriveEditorLayers>[number]): string | null {
  if (layer.kind === "customSprite") return layer.id;
  if (layer.staticSeparatorId || layer.ampmIndicator || layer.weatherIndicator) {
    return layer.id;
  }
  if (layer.layoutGroupId && layer.capabilities.position) {
    return `layout:${layer.layoutGroupId}`;
  }
  return null;
}

/**
 * Resolves the placement geometry exposed by the editor in the active mode's
 * largest native coordinate system. The supplied design is already the active
 * mode design; `mode` selects only the corresponding template configuration.
 */
export function resolveWatchfacePlacementScene(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  mode: WatchfacePreviewMode = "current"
): WatchfacePlacementScene {
  const modeDetails = detailsForCompositionMode(
    applyConfigTextEditsToDetails(details, design.configTextEdits),
    mode
  );
  const nativeReference = pickPreviewResolution(modeDetails);
  const width = nativeReference?.width ?? BACKGROUND_SPACE;
  const height = nativeReference?.height ?? BACKGROUND_SPACE;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    placementFail(
      "placement.invalid_geometry",
      "The placement scene has invalid native dimensions."
    );
  }
  const nativeLayers = deriveEditorLayers(modeDetails, design)
    .filter((layer) => watchfaceEditorLayerIsListed(layer, mode, design))
    .map((layer) => ({
      id: layer.id,
      bounds: layer.bounds
        ? {
            x0: layer.bounds.x0,
            y0: layer.bounds.y0,
            x1: layer.bounds.x1,
            y1: layer.bounds.y1
          }
        : null,
      movable: Boolean(layer.bounds && movementKeyForLayer(layer)),
      movementKey: movementKeyForLayer(layer)
    }));
  const elementLayers: WatchfacePlacementLayer[] = (design.backgroundElements ?? [])
    .map((element) => ({
      id: `bgel:${element.id}`,
      bounds: scaleWatchfaceBounds(
        backgroundElementSnapBounds(element),
        width / BACKGROUND_SPACE,
        height / BACKGROUND_SPACE
      ),
      movable: true,
      movementKey: `bgel:${element.id}`
    }));

  const layers = [...nativeLayers, ...elementLayers];
  for (const layer of layers) {
    const bounds = layer.bounds;
    if (
      bounds &&
      (
        ![bounds.x0, bounds.y0, bounds.x1, bounds.y1].every(Number.isFinite) ||
        bounds.x0 > bounds.x1 ||
        bounds.y0 > bounds.y1
      )
    ) {
      placementFail(
        "placement.invalid_geometry",
        `Layer ${layer.id} has non-finite placement bounds.`
      );
    }
  }
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const explicitlyLocked = new Set(design.lockedLayerIds ?? []);
  const lockedMovementKeys = new Set<string>();
  for (const layer of layers) {
    if (explicitlyLocked.has(layer.id) && layer.movementKey) {
      lockedMovementKeys.add(layer.movementKey);
    }
  }
  for (const group of design.editorGroups ?? []) {
    if (!group.layerIds.some((id) => explicitlyLocked.has(id))) continue;
    for (const id of group.layerIds) {
      const movementKey = byId.get(id)?.movementKey;
      if (movementKey) lockedMovementKeys.add(movementKey);
    }
  }
  for (const layer of layers) {
    const group = editorGroupForLayer(design.editorGroups, layer.id);
    const groupLocked = group?.layerIds.some((id) => explicitlyLocked.has(id)) ?? false;
    if (
      explicitlyLocked.has(layer.id) ||
      groupLocked ||
      (layer.movementKey !== null && lockedMovementKeys.has(layer.movementKey))
    ) {
      layer.movable = false;
    }
  }

  const styledDetails = deriveDesignDetails(modeDetails, design).styledMetricDetails;
  const base = pickPreviewResolution(styledDetails);
  const limits = base
    ? computeLayoutOffsetLimits(base, {
        timeStyles: design.timeStyles,
        letterSpacing: design.letterSpacing,
        rasterFont: design.rasterFont
      })
    : {};
  for (const [id, limit] of Object.entries(limits)) {
    if (![limit.minDx, limit.maxDx, limit.minDy, limit.maxDy].every(Number.isFinite)) {
      placementFail(
        "placement.invalid_geometry",
        `Native layout limits for ${id} are non-finite.`
      );
    }
  }
  return {
    width,
    height,
    layers,
    nativeOffsetLimits: Object.fromEntries(
      Object.entries(limits).map(([id, value]) => [`layout:${id}`, value])
    )
  };
}

function placementFail(code: string, message: string): never {
  throw new WatchfacePlacementError(code, message);
}

function axisOverflow(start: number, end: number, limit: number): number {
  return Math.max(0, -start) + Math.max(0, end - limit);
}

function axisMovementAllowed(
  start: number,
  end: number,
  delta: number,
  limit: number
): boolean {
  if (Math.abs(delta) <= PLACEMENT_EPSILON) return true;
  const movedStart = start + delta;
  const movedEnd = end + delta;
  const nextOverflow = axisOverflow(movedStart, movedEnd, limit);
  if (nextOverflow <= PLACEMENT_EPSILON) return true;
  const previousOverflow = axisOverflow(start, end, limit);
  return previousOverflow > PLACEMENT_EPSILON &&
    nextOverflow < previousOverflow - PLACEMENT_EPSILON;
}

function assertTranslatedBounds(
  layer: WatchfacePlacementLayer,
  dx: number,
  dy: number,
  scene: WatchfacePlacementScene
): void {
  const bounds = layer.bounds;
  if (!bounds) {
    placementFail("placement.unsupported", `Layer ${layer.id} has no placeable bounds.`);
  }
  if (
    !axisMovementAllowed(bounds.x0, bounds.x1, dx, scene.width) ||
    !axisMovementAllowed(bounds.y0, bounds.y1, dy, scene.height)
  ) {
    placementFail(
      "placement.out_of_bounds",
      `Moving ${layer.id} by (${dx}, ${dy}) would place it outside the ${scene.width}×${scene.height} face.`
    );
  }
}

function sameDelta(
  left: { dx: number; dy: number },
  right: { dx: number; dy: number }
): boolean {
  return Math.abs(left.dx - right.dx) <= PLACEMENT_EPSILON &&
    Math.abs(left.dy - right.dy) <= PLACEMENT_EPSILON;
}

function limitedAxisMovementAllowed(
  current: number,
  next: number,
  delta: number,
  minimum: number,
  maximum: number
): boolean {
  if (Math.abs(delta) <= PLACEMENT_EPSILON) return true;
  if (next >= minimum - PLACEMENT_EPSILON && next <= maximum + PLACEMENT_EPSILON) {
    return true;
  }
  const previousOverflow = Math.max(0, minimum - current) +
    Math.max(0, current - maximum);
  const nextOverflow = Math.max(0, minimum - next) +
    Math.max(0, next - maximum);
  return previousOverflow > PLACEMENT_EPSILON &&
    nextOverflow < previousOverflow - PLACEMENT_EPSILON;
}

/** Applies already-resolved placement deltas without silently clamping them. */
export function moveWatchfacePlacementLayers(
  design: CorosWatchfaceDesignState,
  scene: WatchfacePlacementScene,
  movements: WatchfacePlacementMovement[]
): CorosWatchfaceDesignState {
  const layersById = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const requestedByKey = new Map<string, { dx: number; dy: number }>();

  for (const movement of movements) {
    if (!Number.isFinite(movement.dx) || !Number.isFinite(movement.dy)) {
      placementFail("placement.invalid", "Placement deltas must be finite numbers.");
    }
    const movementLayers = movement.layerIds.map((id) => {
      const layer = layersById.get(id);
      if (!layer || !layer.movementKey || !layer.bounds) {
        placementFail("placement.unsupported", `Layer ${id} cannot be placed.`);
      }
      if (!layer.movable) {
        placementFail("placement.locked", `Layer ${id} is locked or cannot move.`);
      }
      return layer;
    });
    const containsNativeLayer = movementLayers.some((layer) =>
      layer.movementKey?.startsWith("layout:")
    );
    const requested = containsNativeLayer
      ? { dx: Math.round(movement.dx), dy: Math.round(movement.dy) }
      : { dx: movement.dx, dy: movement.dy };
    for (const layer of movementLayers) {
      const movementKey = layer.movementKey!;
      const previous = requestedByKey.get(movementKey);
      if (previous && !sameDelta(previous, requested)) {
        placementFail(
          "placement.conflicting_movement",
          `Layers sharing ${movementKey} received conflicting movement deltas.`
        );
      }
      requestedByKey.set(movementKey, requested);
    }
  }

  const achievedByKey = new Map<string, { dx: number; dy: number }>();
  for (const [key, requested] of requestedByKey) {
    if (!key.startsWith("layout:")) {
      achievedByKey.set(key, requested);
      continue;
    }
    const groupId = key.slice("layout:".length);
    const current = design.layoutOffsets?.[groupId] ?? { dx: 0, dy: 0 };
    const actualCurrent = {
      dx: Math.round(current.dx),
      dy: Math.round(current.dy)
    };
    const next = {
      dx: actualCurrent.dx + requested.dx,
      dy: actualCurrent.dy + requested.dy
    };
    const limits = scene.nativeOffsetLimits[key];
    if (
      limits &&
      (
        !limitedAxisMovementAllowed(
          actualCurrent.dx,
          next.dx,
          requested.dx,
          limits.minDx,
          limits.maxDx
        ) ||
        !limitedAxisMovementAllowed(
          actualCurrent.dy,
          next.dy,
          requested.dy,
          limits.minDy,
          limits.maxDy
        )
      )
    ) {
      placementFail(
        "placement.out_of_bounds",
        `Movement for ${groupId} exceeds its native layout limits.`
      );
    }
    achievedByKey.set(key, requested);
  }

  for (const layer of scene.layers) {
    const movement = layer.movementKey
      ? achievedByKey.get(layer.movementKey)
      : undefined;
    if (
      movement &&
      layer.bounds &&
      layer.movementKey !== "layout:analogCenter"
    ) {
      assertTranslatedBounds(layer, movement.dx, movement.dy, scene);
    }
  }

  let next = design;
  for (const [key, requested] of requestedByKey) {
    if (key.startsWith("layout:")) {
      const groupId = key.slice("layout:".length);
      const current = next.layoutOffsets?.[groupId] ?? { dx: 0, dy: 0 };
      next = {
        ...next,
        layoutOffsets: {
          ...next.layoutOffsets,
          [groupId]: {
            dx: Math.round(current.dx) + requested.dx,
            dy: Math.round(current.dy) + requested.dy
          }
        }
      };
      continue;
    }
    if (key.startsWith("bgel:")) {
      const id = key.slice("bgel:".length);
      next = {
        ...next,
        backgroundElements: (next.backgroundElements ?? []).map((element) =>
          element.id === id
            ? {
                ...element,
                x: element.x + requested.dx * (BACKGROUND_SPACE / scene.width),
                y: element.y + requested.dy * (BACKGROUND_SPACE / scene.height)
              }
            : element
        )
      };
      continue;
    }
    if (key.startsWith("sprite:")) {
      const id = key.slice("sprite:".length);
      next = {
        ...next,
        designSprites: next.designSprites.map((sprite) =>
          sprite.id === id
            ? { ...sprite, x: sprite.x + requested.dx, y: sprite.y + requested.dy }
            : sprite
        )
      };
      continue;
    }
    if (key === "staticColon" || key === "staticDateSlash") {
      const separatorId = key === "staticColon" ? "colon" : "dateSlash";
      const separator = next.staticSeparators[separatorId];
      next = {
        ...next,
        staticSeparators: {
          ...next.staticSeparators,
          [separatorId]: {
            ...separator,
            x: separator.x + requested.dx,
            y: separator.y + requested.dy
          }
        }
      };
      continue;
    }
    if (key === "ampm") {
      const bounds = scene.layers.find((layer) => layer.id === "ampm")?.bounds;
      const indicator = next.ampmIndicator ?? (bounds
        ? { enabled: true, x: bounds.x0, y: bounds.y0, scale: 1 }
        : null);
      if (!indicator) {
        placementFail("placement.unsupported", "AM/PM placement has no active geometry.");
      }
      next = {
        ...next,
        ampmIndicator: {
          ...indicator,
          x: indicator.x + requested.dx,
          y: indicator.y + requested.dy
        }
      };
      continue;
    }
    if (key === "weather") {
      const bounds = scene.layers.find((layer) => layer.id === "weather")?.bounds;
      const indicator = next.weatherIndicator ?? (bounds
        ? { enabled: true, x: bounds.x0, y: bounds.y0, scale: 1 }
        : null);
      if (!indicator) {
        placementFail("placement.unsupported", "Weather placement has no active geometry.");
      }
      next = {
        ...next,
        weatherIndicator: {
          ...indicator,
          x: indicator.x + requested.dx,
          y: indicator.y + requested.dy
        }
      };
      continue;
    }
    placementFail("placement.unsupported", `Movement key ${key} cannot be applied.`);
  }
  return next;
}
