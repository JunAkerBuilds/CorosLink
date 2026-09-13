import type { CorosWatchfaceDesignState } from "../../electron/types";
import type { WatchfaceAutomationCommandContext } from "./watchfaceAutomationSchema";
import {
  alignWatchfaceItems,
  distributeWatchfaceItems,
  normalizeWatchfaceEditorGroups,
  unionWatchfaceBounds,
  type WatchfaceAlignment
} from "./watchfaceEditorLayout";
import {
  moveWatchfacePlacementLayers,
  resolveWatchfacePlacementScene
} from "./watchfaceAutomationPlacement";

type Command = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("command.field", `${field} must be a finite number.`);
  }
  return value;
}

const keys: Record<string, string[]> = {
  move_layer: ["op", "id", "dx", "dy"],
  place_layers: ["op", "layerIds", "x", "y", "anchor"],
  align_layers: ["op", "layerIds", "alignment", "reference"],
  distribute_layers: ["op", "layerIds", "direction", "gap"]
};

export function isWatchfacePlacementCommand(op: unknown): boolean {
  return typeof op === "string" && Object.hasOwn(keys, op);
}

/** Resolve each command against its current batch state, including earlier edits. */
export function applyWatchfaceLayoutCommand(
  design: CorosWatchfaceDesignState,
  command: Command,
  context: WatchfaceAutomationCommandContext
): { design: CorosWatchfaceDesignState; changedLayerIds: string[] } {
  const op = String(command.op);
  for (const key of Object.keys(command)) {
    if (!keys[op]?.includes(key)) fail("command.unknown_field", `Unknown field ${key} for ${op}.`);
  }
  const ids = op === "move_layer" ? [command.id] : command.layerIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 ||
      ids.some((id) => typeof id !== "string" || !id.length) || new Set(ids).size !== ids.length) {
    fail("command.field", "Provide 1–200 unique layer ids.");
  }
  const scene = resolveWatchfacePlacementScene(context.details, design, context.mode);
  const byId = new Map(scene.layers.map((layer) => [layer.id, layer]));
  // Editor groups and shared firmware position fields are both rigid units.
  // Connected components also handle a group containing one of several native aliases.
  const links = normalizeWatchfaceEditorGroups(design.editorGroups, design.linkedLayerGroups)
    .map((group) => group.layerIds);
  const physical = new Map<string, string[]>();
  for (const layer of scene.layers) {
    if (!layer.movementKey) continue;
    const members = physical.get(layer.movementKey) ?? [];
    members.push(layer.id);
    physical.set(layer.movementKey, members);
  }
  links.push(...physical.values());
  const expand = (id: string): Set<string> => {
    const result = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const members of links) {
        if (!members.some((member) => result.has(member))) continue;
        for (const member of members) {
          if (!result.has(member)) { result.add(member); changed = true; }
        }
      }
    }
    return result;
  };
  const locked = new Set(design.lockedLayerIds ?? []);
  const included = new Set<string>();
  const items = (ids as string[]).flatMap((id, index) => {
    if (included.has(id)) return [];
    const members = [...expand(id)];
    for (const member of members) {
      if (locked.has(member)) fail("layer.locked", `Unlock ${member} before moving this selection.`);
    }
    const bounds = members.map((member) => {
      const layer = byId.get(member);
      if (!layer) fail("layer.missing", `Layer ${member} is unavailable in this template and mode.`);
      if (!layer.movable || !layer.bounds) fail("placement.unsupported", `Layer ${member} does not support placement.`);
      included.add(member);
      return layer.bounds;
    });
    return [{ id: `unit:${index}`, layerIds: members, bounds: unionWatchfaceBounds(bounds)! }];
  });
  let movements: Record<string, { dx: number; dy: number }>;
  if (op === "move_layer") {
    const dx = finite(command.dx, "dx");
    const dy = finite(command.dy, "dy");
    movements = Object.fromEntries(items.map((item) => [item.id, { dx, dy }]));
  } else if (op === "place_layers") {
    if (command.x === undefined && command.y === undefined) fail("command.field", "Provide x, y, or both.");
    const anchors: Record<string, [number, number]> = {
      "top-left": [0, 0], top: [0.5, 0], "top-right": [1, 0],
      left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
      "bottom-left": [0, 1], bottom: [0.5, 1], "bottom-right": [1, 1]
    };
    const anchor = command.anchor ?? "center";
    if (typeof anchor !== "string" || !Object.hasOwn(anchors, anchor)) fail("command.field", "Unknown placement anchor.");
    const [ax, ay] = anchors[anchor]!;
    const bounds = unionWatchfaceBounds(items.map((item) => item.bounds))!;
    const dx = command.x === undefined ? 0 : finite(command.x, "x") - (bounds.x0 + (bounds.x1 - bounds.x0) * ax);
    const dy = command.y === undefined ? 0 : finite(command.y, "y") - (bounds.y0 + (bounds.y1 - bounds.y0) * ay);
    movements = Object.fromEntries(items.map((item) => [item.id, { dx, dy }]));
  } else if (op === "align_layers") {
    if (typeof command.alignment !== "string" || !["left", "center-x", "right", "top", "center-y", "bottom"].includes(command.alignment)) {
      fail("command.field", "Unknown alignment.");
    }
    const reference = command.reference ?? (items.length === 1 ? "canvas" : "selection");
    let bounds;
    if (reference === "canvas") bounds = { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
    else if (reference === "selection") bounds = undefined;
    else if (typeof reference === "object" && reference !== null && !Array.isArray(reference) &&
             Object.keys(reference).length === 1 && "layerId" in reference && typeof reference.layerId === "string") {
      if (included.has(reference.layerId)) fail("placement.reference", "The reference layer must be outside the moving selection.");
      bounds = byId.get(reference.layerId)?.bounds;
      if (!bounds) fail("placement.reference", `Reference layer ${reference.layerId} has no placement bounds.`);
    } else fail("command.field", "reference must be canvas, selection, or {layerId}.");
    movements = alignWatchfaceItems(items, command.alignment as WatchfaceAlignment, bounds);
  } else {
    const direction = command.direction;
    if (direction !== "horizontal" && direction !== "vertical") fail("command.field", "direction must be horizontal or vertical.");
    if (items.length < (command.gap === undefined ? 3 : 2)) {
      fail("placement.selection", command.gap === undefined ? "Equal distribution requires at least three independent selections." : "Exact spacing requires at least two independent selections.");
    }
    if (command.gap === undefined) movements = distributeWatchfaceItems(items, direction);
    else {
      const gap = finite(command.gap, "gap");
      if (gap < 0) fail("command.field", "gap must be non-negative.");
      const start = direction === "horizontal" ? "x0" : "y0";
      const end = direction === "horizontal" ? "x1" : "y1";
      const sorted = [...items].sort((a, b) => (a.bounds[start] + a.bounds[end]) - (b.bounds[start] + b.bounds[end]));
      let cursor = sorted[0]!.bounds[start];
      movements = {};
      for (const item of sorted) {
        const delta = cursor - item.bounds[start];
        movements[item.id] = direction === "horizontal" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
        cursor += item.bounds[end] - item.bounds[start] + gap;
      }
    }
  }
  const resolvedMovements = op === "place_layers"
    ? [{ layerIds: [...included], ...movements[items[0]!.id]! }]
    : items.map((item) => ({ layerIds: item.layerIds, ...movements[item.id]! }));
  return {
    design: moveWatchfacePlacementLayers(design, scene, resolvedMovements),
    changedLayerIds: [...included]
  };
}
