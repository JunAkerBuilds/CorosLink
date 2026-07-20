import type {
  CorosWatchfaceEditorGroup,
  CorosWatchfaceDesignState
} from "../../electron/types";
import type { WatchfaceEditorBounds } from "./watchfaceEditorGeometry";

export type WatchfaceAlignment =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";

export type WatchfaceDistribution = "horizontal" | "vertical";

export interface WatchfaceLayoutItem {
  id: string;
  bounds: WatchfaceEditorBounds;
}

export interface WatchfaceSelectionUnit {
  id: string;
  layerIds: string[];
}

export function unionWatchfaceBounds(
  bounds: WatchfaceEditorBounds[]
): WatchfaceEditorBounds | null {
  if (bounds.length === 0) return null;
  return bounds.slice(1).reduce(
    (result, box) => ({
      x0: Math.min(result.x0, box.x0),
      y0: Math.min(result.y0, box.y0),
      x1: Math.max(result.x1, box.x1),
      y1: Math.max(result.y1, box.y1)
    }),
    { ...bounds[0]! }
  );
}

export function alignWatchfaceItems(
  items: WatchfaceLayoutItem[],
  alignment: WatchfaceAlignment,
  reference?: WatchfaceEditorBounds
): Record<string, { dx: number; dy: number }> {
  const target = reference ?? unionWatchfaceBounds(items.map((item) => item.bounds));
  if (!target) return {};
  return Object.fromEntries(items.map((item) => {
    const box = item.bounds;
    let dx = 0;
    let dy = 0;
    if (alignment === "left") dx = target.x0 - box.x0;
    if (alignment === "center-x") {
      dx = (target.x0 + target.x1 - box.x0 - box.x1) / 2;
    }
    if (alignment === "right") dx = target.x1 - box.x1;
    if (alignment === "top") dy = target.y0 - box.y0;
    if (alignment === "center-y") {
      dy = (target.y0 + target.y1 - box.y0 - box.y1) / 2;
    }
    if (alignment === "bottom") dy = target.y1 - box.y1;
    return [item.id, { dx, dy }];
  }));
}

export function distributeWatchfaceItems(
  items: WatchfaceLayoutItem[],
  direction: WatchfaceDistribution
): Record<string, { dx: number; dy: number }> {
  if (items.length < 3) return {};
  const horizontal = direction === "horizontal";
  const sorted = [...items].sort((left, right) => {
    const leftCenter = horizontal
      ? (left.bounds.x0 + left.bounds.x1) / 2
      : (left.bounds.y0 + left.bounds.y1) / 2;
    const rightCenter = horizontal
      ? (right.bounds.x0 + right.bounds.x1) / 2
      : (right.bounds.y0 + right.bounds.y1) / 2;
    return leftCenter - rightCenter;
  });
  const first = sorted[0]!.bounds;
  const last = sorted.at(-1)!.bounds;
  const spanStart = horizontal ? first.x0 : first.y0;
  const spanEnd = horizontal ? last.x1 : last.y1;
  const totalSize = sorted.reduce((sum, item) => {
    return sum + (horizontal
      ? item.bounds.x1 - item.bounds.x0
      : item.bounds.y1 - item.bounds.y0);
  }, 0);
  const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);
  let cursor = spanStart;
  const movements: Record<string, { dx: number; dy: number }> = {};
  for (const item of sorted) {
    const start = horizontal ? item.bounds.x0 : item.bounds.y0;
    movements[item.id] = horizontal
      ? { dx: cursor - start, dy: 0 }
      : { dx: 0, dy: cursor - start };
    cursor += (horizontal
      ? item.bounds.x1 - item.bounds.x0
      : item.bounds.y1 - item.bounds.y0) + gap;
  }
  return movements;
}

function stableGroupId(layerIds: string[], index: number): string {
  let hash = 2166136261;
  for (const character of layerIds.join("\u0000")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-group-${index}-${(hash >>> 0).toString(36)}`;
}

export function normalizeWatchfaceEditorGroups(
  groups: CorosWatchfaceEditorGroup[] | undefined,
  legacyGroups: string[][] | undefined
): CorosWatchfaceEditorGroup[] {
  const source = groups !== undefined
    ? groups
    : (legacyGroups ?? []).map((layerIds, index) => ({
        id: stableGroupId(layerIds, index),
        name: `Group ${index + 1}`,
        layerIds
      }));
  const claimed = new Set<string>();
  const normalized: CorosWatchfaceEditorGroup[] = [];
  for (const [index, group] of source.entries()) {
    const layerIds = [...new Set(group.layerIds.filter(Boolean))]
      .filter((id) => !claimed.has(id));
    if (layerIds.length < 2) continue;
    layerIds.forEach((id) => claimed.add(id));
    normalized.push({
      id: group.id.trim() || stableGroupId(layerIds, index),
      name: group.name.trim() || `Group ${normalized.length + 1}`,
      layerIds
    });
  }
  return normalized;
}

export function editorGroupForLayer(
  groups: CorosWatchfaceEditorGroup[] | undefined,
  layerId: string
): CorosWatchfaceEditorGroup | null {
  return groups?.find((group) => group.layerIds.includes(layerId)) ?? null;
}

/** Expands every touched group so editor selection never contains half a group. */
export function expandWatchfaceGroupSelection(
  groups: CorosWatchfaceEditorGroup[] | undefined,
  layerIds: string[]
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const layerId of layerIds) {
    const members = editorGroupForLayer(groups, layerId)?.layerIds ?? [layerId];
    for (const member of members) {
      if (seen.has(member)) continue;
      seen.add(member);
      expanded.push(member);
    }
  }
  return expanded;
}

/**
 * Returns group-or-object selection units. Alignment and distribution operate
 * on these units so a group's internal arrangement remains intact.
 */
export function watchfaceSelectionUnits(
  groups: CorosWatchfaceEditorGroup[] | undefined,
  selectedLayerIds: string[]
): WatchfaceSelectionUnit[] {
  const selected = new Set(expandWatchfaceGroupSelection(groups, selectedLayerIds));
  const emittedGroups = new Set<string>();
  const units: WatchfaceSelectionUnit[] = [];
  for (const layerId of selected) {
    const group = editorGroupForLayer(groups, layerId);
    if (group) {
      if (emittedGroups.has(group.id)) continue;
      emittedGroups.add(group.id);
      units.push({ id: `group:${group.id}`, layerIds: [...group.layerIds] });
    } else {
      units.push({ id: `layer:${layerId}`, layerIds: [layerId] });
    }
  }
  return units;
}

export function syncLegacyWatchfaceGroups(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  const editorGroups = normalizeWatchfaceEditorGroups(
    design.editorGroups,
    design.linkedLayerGroups
  );
  return {
    ...design,
    editorGroups,
    linkedLayerGroups: editorGroups.map((group) => [...group.layerIds])
  };
}
