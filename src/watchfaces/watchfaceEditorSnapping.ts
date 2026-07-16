import type {
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceEditorGuide
} from "../../electron/types";
import type { WatchfaceEditorBounds } from "./watchfaceEditorGeometry";

export const WATCHFACE_PLACEMENT_STORAGE_KEY =
  "coroslink.watchfacePlacement.v1";
export const WATCHFACE_SNAP_SCREEN_THRESHOLD = 6;

export type WatchfaceGridStep = 4 | 8 | 16 | 32;

export interface WatchfacePlacementPreferences {
  snapEnabled: boolean;
  guidesVisible: boolean;
  gridVisible: boolean;
  gridStep: WatchfaceGridStep;
  safeAreaInsetPercent: number;
}

export const DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES: WatchfacePlacementPreferences = {
  snapEnabled: true,
  guidesVisible: false,
  gridVisible: false,
  gridStep: 8,
  safeAreaInsetPercent: 10
};

interface PlacementPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const GRID_STEPS = new Set<WatchfaceGridStep>([4, 8, 16, 32]);

export function normalizeWatchfacePlacementPreferences(
  value: unknown
): WatchfacePlacementPreferences {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES };
  }
  const input = value as Partial<WatchfacePlacementPreferences>;
  const inset = Number(input.safeAreaInsetPercent);
  const gridStep = Number(input.gridStep) as WatchfaceGridStep;
  return {
    snapEnabled:
      typeof input.snapEnabled === "boolean"
        ? input.snapEnabled
        : DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES.snapEnabled,
    guidesVisible:
      typeof input.guidesVisible === "boolean"
        ? input.guidesVisible
        : DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES.guidesVisible,
    gridVisible:
      typeof input.gridVisible === "boolean"
        ? input.gridVisible
        : DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES.gridVisible,
    gridStep: GRID_STEPS.has(gridStep)
      ? gridStep
      : DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES.gridStep,
    safeAreaInsetPercent: Number.isFinite(inset)
      ? Math.max(0, Math.min(25, Math.round(inset)))
      : DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES.safeAreaInsetPercent
  };
}

export function readWatchfacePlacementPreferences(
  storage: PlacementPreferenceStorage | undefined
): WatchfacePlacementPreferences {
  if (!storage) {
    return { ...DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES };
  }
  try {
    const stored = storage.getItem(WATCHFACE_PLACEMENT_STORAGE_KEY);
    return stored
      ? normalizeWatchfacePlacementPreferences(JSON.parse(stored))
      : { ...DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES };
  } catch {
    return { ...DEFAULT_WATCHFACE_PLACEMENT_PREFERENCES };
  }
}

export function writeWatchfacePlacementPreferences(
  storage: PlacementPreferenceStorage | undefined,
  preferences: WatchfacePlacementPreferences
): void {
  if (!storage) return;
  try {
    storage.setItem(
      WATCHFACE_PLACEMENT_STORAGE_KEY,
      JSON.stringify(normalizeWatchfacePlacementPreferences(preferences))
    );
  } catch {
    // Editor preferences are optional when local storage is unavailable.
  }
}

export interface WatchfaceSnapTarget {
  id: string;
  label: string;
  bounds: WatchfaceEditorBounds;
  visible?: boolean;
}

export type WatchfaceSnapGuideKind =
  | "face-center"
  | "face-edge"
  | "safe-area"
  | "guide"
  | "layer"
  | "spacing"
  | "grid";

export interface WatchfaceSnapGuide {
  axis: "x" | "y";
  value: number;
  kind: WatchfaceSnapGuideKind;
  message: string;
  targetId?: string;
}

export interface WatchfaceSnapMeasurement {
  axis: "x" | "y";
  start: number;
  end: number;
  cross: number;
  label: string;
  kind: "distance" | "spacing";
}

export interface SnapWatchfaceBoundsInput {
  movingBounds: WatchfaceEditorBounds;
  faceWidth: number;
  faceHeight: number;
  threshold: number;
  safeAreaInsetPercent: number;
  targets: WatchfaceSnapTarget[];
  movingId?: string;
  guides?: CorosWatchfaceEditorGuide[];
  /** Previously acquired guides retained until releaseThreshold is exceeded. */
  retainedGuides?: WatchfaceSnapGuide[];
  releaseThreshold?: number;
  /** Grid spacing in preview-resolution pixels. Omit when the grid is off. */
  gridStep?: number;
  /** Human-readable grid spacing in watch pixels. */
  gridLabel?: string;
}

export interface SnapWatchfaceBoundsResult {
  dx: number;
  dy: number;
  guides: WatchfaceSnapGuide[];
  measurements: WatchfaceSnapMeasurement[];
}

interface SnapCandidate extends WatchfaceSnapGuide {
  adjustment: number;
  priority: number;
}

interface AxisAnchors {
  start: number;
  center: number;
  end: number;
}

const SNAP_PRIORITY: Record<WatchfaceSnapGuideKind, number> = {
  "face-center": 0,
  guide: 1,
  "face-edge": 2,
  "safe-area": 3,
  layer: 4,
  spacing: 5,
  grid: 6
};

export function watchfaceSafeAreaBounds(
  width: number,
  height: number,
  insetPercent: number
): WatchfaceEditorBounds {
  const diameter = Math.max(0, Math.min(width, height));
  const inset = diameter * (Math.max(0, Math.min(25, insetPercent)) / 100);
  const radius = Math.max(0, diameter / 2 - inset);
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    x0: centerX - radius,
    y0: centerY - radius,
    x1: centerX + radius,
    y1: centerY + radius
  };
}

export function watchfaceDesignThreshold(
  screenPixels: number,
  facePixels: number,
  renderedPixels: number
): number {
  if (renderedPixels <= 0 || facePixels <= 0) return 0;
  return (Math.max(0, screenPixels) * facePixels) / renderedPixels;
}

export function translateWatchfaceBounds(
  bounds: WatchfaceEditorBounds,
  dx: number,
  dy: number
): WatchfaceEditorBounds {
  return {
    x0: bounds.x0 + dx,
    y0: bounds.y0 + dy,
    x1: bounds.x1 + dx,
    y1: bounds.y1 + dy
  };
}

export function scaleWatchfaceBounds(
  bounds: WatchfaceEditorBounds,
  scaleX: number,
  scaleY = scaleX
): WatchfaceEditorBounds {
  return {
    x0: bounds.x0 * scaleX,
    y0: bounds.y0 * scaleY,
    x1: bounds.x1 * scaleX,
    y1: bounds.y1 * scaleY
  };
}

/** Rotation-aware bounds for freeform elements authored in 800px space. */
export function backgroundElementSnapBounds(
  element: CorosWatchfaceBackgroundElement
): WatchfaceEditorBounds {
  if (element.kind === "line") {
    const radians = (element.rotation * Math.PI) / 180;
    const endX =
      element.x + element.dx * Math.cos(radians) - element.dy * Math.sin(radians);
    const endY =
      element.y + element.dx * Math.sin(radians) + element.dy * Math.cos(radians);
    const padding = element.strokeWidth / 2;
    return {
      x0: Math.min(element.x, endX) - padding,
      y0: Math.min(element.y, endY) - padding,
      x1: Math.max(element.x, endX) + padding,
      y1: Math.max(element.y, endY) + padding
    };
  }
  if (element.kind === "text") {
    const width = Math.max(element.text.length, 1) * element.fontSize * 0.64;
    const height = element.fontSize * 1.4;
    return rotationAwareCenterBounds(
      element.x,
      element.y,
      width,
      height,
      element.rotation
    );
  }
  return rotationAwareCenterBounds(
    element.x,
    element.y,
    element.width,
    element.height,
    element.rotation
  );
}

function rotationAwareCenterBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number
): WatchfaceEditorBounds {
  const radians = (rotation * Math.PI) / 180;
  const rotatedWidth =
    Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const rotatedHeight =
    Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
  return {
    x0: x - rotatedWidth / 2,
    y0: y - rotatedHeight / 2,
    x1: x + rotatedWidth / 2,
    y1: y + rotatedHeight / 2
  };
}

export function snapWatchfaceBounds(
  input: SnapWatchfaceBoundsInput
): SnapWatchfaceBoundsResult {
  const x = anchorsForAxis(input.movingBounds.x0, input.movingBounds.x1);
  const y = anchorsForAxis(input.movingBounds.y0, input.movingBounds.y1);
  const safeArea = watchfaceSafeAreaBounds(
    input.faceWidth,
    input.faceHeight,
    input.safeAreaInsetPercent
  );
  const xCandidates: SnapCandidate[] = [];
  const yCandidates: SnapCandidate[] = [];

  addCandidate(
    xCandidates,
    "x",
    x.center,
    input.faceWidth / 2,
    "face-center",
    "Snapped to face center"
  );

  addCandidate(xCandidates, "x", x.start, 0, "face-edge", "Snapped to face edge");
  addCandidate(xCandidates, "x", x.end, input.faceWidth, "face-edge", "Snapped to face edge");
  addCandidate(yCandidates, "y", y.start, 0, "face-edge", "Snapped to face edge");
  addCandidate(yCandidates, "y", y.end, input.faceHeight, "face-edge", "Snapped to face edge");
  addCandidate(
    yCandidates,
    "y",
    y.center,
    input.faceHeight / 2,
    "face-center",
    "Snapped to face center"
  );

  addCandidate(
    xCandidates,
    "x",
    x.start,
    safeArea.x0,
    "safe-area",
    "Snapped to safe area"
  );
  addCandidate(
    xCandidates,
    "x",
    x.end,
    safeArea.x1,
    "safe-area",
    "Snapped to safe area"
  );
  addCandidate(
    yCandidates,
    "y",
    y.start,
    safeArea.y0,
    "safe-area",
    "Snapped to safe area"
  );
  addCandidate(
    yCandidates,
    "y",
    y.end,
    safeArea.y1,
    "safe-area",
    "Snapped to safe area"
  );

  for (const target of input.targets) {
    if (target.visible === false || target.id === input.movingId) continue;
    const targetX = anchorsForAxis(target.bounds.x0, target.bounds.x1);
    const targetY = anchorsForAxis(target.bounds.y0, target.bounds.y1);
    for (const moving of Object.values(x)) {
      for (const fixed of Object.values(targetX)) {
        addCandidate(
          xCandidates,
          "x",
          moving,
          fixed,
          "layer",
          `Aligned with ${target.label}`,
          target.id
        );
      }
    }
    for (const moving of Object.values(y)) {
      for (const fixed of Object.values(targetY)) {
        addCandidate(
          yCandidates,
          "y",
          moving,
          fixed,
          "layer",
          `Aligned with ${target.label}`,
          target.id
        );
      }
    }
  }

  for (const guide of input.guides ?? []) {
    const anchors = guide.axis === "x" ? x : y;
    const candidates = guide.axis === "x" ? xCandidates : yCandidates;
    for (const anchor of Object.values(anchors)) {
      addCandidate(
        candidates,
        guide.axis,
        anchor,
        guide.position,
        "guide",
        "Snapped to guide",
        guide.id
      );
    }
  }

  addSpacingCandidates(input, xCandidates, yCandidates);

  if (input.gridStep && input.gridStep > 0) {
    const message = `Snapped to ${input.gridLabel ?? `${input.gridStep}px`} grid`;
    addGridCandidates(
      xCandidates,
      "x",
      x,
      input.gridStep,
      input.faceWidth,
      message
    );
    addGridCandidates(
      yCandidates,
      "y",
      y,
      input.gridStep,
      input.faceHeight,
      message
    );
  }

  const snappedX = pickCandidate(
    xCandidates,
    input.threshold,
    input.retainedGuides?.find((guide) => guide.axis === "x"),
    input.releaseThreshold
  );
  const snappedY = pickCandidate(
    yCandidates,
    input.threshold,
    input.retainedGuides?.find((guide) => guide.axis === "y"),
    input.releaseThreshold
  );
  const dx = snappedX?.adjustment ?? 0;
  const dy = snappedY?.adjustment ?? 0;
  const moved = translateWatchfaceBounds(input.movingBounds, dx, dy);
  return {
    dx,
    dy,
    guides: [snappedX, snappedY].filter(
      (guide): guide is SnapCandidate => guide !== null
    ),
    measurements: watchfaceSpacingMeasurements(moved, input.targets)
  };
}

export function formatWatchfaceSnapStatus(
  guides: WatchfaceSnapGuide[]
): string | null {
  const messages = [...new Set(guides.map((guide) => guide.message))];
  return messages.length > 0 ? messages.join(" + ") : null;
}

function anchorsForAxis(start: number, end: number): AxisAnchors {
  return { start, center: (start + end) / 2, end };
}

function addCandidate(
  candidates: SnapCandidate[],
  axis: "x" | "y",
  movingValue: number,
  targetValue: number,
  kind: WatchfaceSnapGuideKind,
  message: string,
  targetId?: string
): void {
  candidates.push({
    axis,
    value: targetValue,
    kind,
    message,
    adjustment: targetValue - movingValue,
    priority: SNAP_PRIORITY[kind],
    ...(targetId ? { targetId } : {})
  });
}

function addSpacingCandidates(
  input: SnapWatchfaceBoundsInput,
  xCandidates: SnapCandidate[],
  yCandidates: SnapCandidate[]
): void {
  const targets = input.targets.filter(
    (target) => target.visible !== false && target.id !== input.movingId
  );
  const addAxis = (
    axis: "x" | "y",
    candidates: SnapCandidate[],
    startKey: "x0" | "y0",
    endKey: "x1" | "y1"
  ) => {
    const movingStart = input.movingBounds[startKey];
    const movingEnd = input.movingBounds[endKey];
    const movingSize = movingEnd - movingStart;
    const before = targets
      .filter((target) => target.bounds[endKey] <= movingStart)
      .sort((left, right) => right.bounds[endKey] - left.bounds[endKey]);
    const after = targets
      .filter((target) => target.bounds[startKey] >= movingEnd)
      .sort((left, right) => left.bounds[startKey] - right.bounds[startKey]);

    if (before[0] && after[0]) {
      const targetStart =
        (before[0].bounds[endKey] + after[0].bounds[startKey] - movingSize) / 2;
      addCandidate(
        candidates,
        axis,
        movingStart,
        targetStart,
        "spacing",
        "Matched equal spacing",
        `${before[0].id}|${after[0].id}`
      );
    }
    if (before[0] && before[1]) {
      const gap = before[0].bounds[startKey] - before[1].bounds[endKey];
      addCandidate(
        candidates,
        axis,
        movingStart,
        before[0].bounds[endKey] + gap,
        "spacing",
        "Matched equal spacing",
        `${before[1].id}|${before[0].id}`
      );
    }
    if (after[0] && after[1]) {
      const gap = after[1].bounds[startKey] - after[0].bounds[endKey];
      addCandidate(
        candidates,
        axis,
        movingEnd,
        after[0].bounds[startKey] - gap,
        "spacing",
        "Matched equal spacing",
        `${after[0].id}|${after[1].id}`
      );
    }
  };
  addAxis("x", xCandidates, "x0", "x1");
  addAxis("y", yCandidates, "y0", "y1");
}

export function watchfaceSpacingMeasurements(
  moving: WatchfaceEditorBounds,
  targets: WatchfaceSnapTarget[]
): WatchfaceSnapMeasurement[] {
  const visible = targets.filter((target) => target.visible !== false);
  const measurements: WatchfaceSnapMeasurement[] = [];
  const left = visible
    .filter((target) => target.bounds.x1 <= moving.x0)
    .sort((a, b) => b.bounds.x1 - a.bounds.x1)[0];
  const right = visible
    .filter((target) => target.bounds.x0 >= moving.x1)
    .sort((a, b) => a.bounds.x0 - b.bounds.x0)[0];
  const top = visible
    .filter((target) => target.bounds.y1 <= moving.y0)
    .sort((a, b) => b.bounds.y1 - a.bounds.y1)[0];
  const bottom = visible
    .filter((target) => target.bounds.y0 >= moving.y1)
    .sort((a, b) => a.bounds.y0 - b.bounds.y0)[0];
  if (left) measurements.push({
    axis: "x",
    start: left.bounds.x1,
    end: moving.x0,
    cross: Math.max(left.bounds.y0, moving.y0),
    label: `${Math.round(moving.x0 - left.bounds.x1)} px`,
    kind: "distance"
  });
  if (right) measurements.push({
    axis: "x",
    start: moving.x1,
    end: right.bounds.x0,
    cross: Math.max(right.bounds.y0, moving.y0),
    label: `${Math.round(right.bounds.x0 - moving.x1)} px`,
    kind: "distance"
  });
  if (top) measurements.push({
    axis: "y",
    start: top.bounds.y1,
    end: moving.y0,
    cross: Math.max(top.bounds.x0, moving.x0),
    label: `${Math.round(moving.y0 - top.bounds.y1)} px`,
    kind: "distance"
  });
  if (bottom) measurements.push({
    axis: "y",
    start: moving.y1,
    end: bottom.bounds.y0,
    cross: Math.max(bottom.bounds.x0, moving.x0),
    label: `${Math.round(bottom.bounds.y0 - moving.y1)} px`,
    kind: "distance"
  });
  return measurements;
}

function addGridCandidates(
  candidates: SnapCandidate[],
  axis: "x" | "y",
  anchors: AxisAnchors,
  step: number,
  faceSize: number,
  message: string
): void {
  for (const anchor of Object.values(anchors)) {
    const nearest = Math.max(0, Math.min(faceSize, Math.round(anchor / step) * step));
    addCandidate(candidates, axis, anchor, nearest, "grid", message);
  }
}

function pickCandidate(
  candidates: SnapCandidate[],
  threshold: number,
  retained?: WatchfaceSnapGuide,
  releaseThreshold = threshold * 1.5
): SnapCandidate | null {
  if (retained) {
    const held = candidates.find(
      (candidate) =>
        candidate.axis === retained.axis &&
        candidate.kind === retained.kind &&
        candidate.value === retained.value &&
        candidate.targetId === retained.targetId &&
        Math.abs(candidate.adjustment) <= releaseThreshold
    );
    if (held) return held;
  }
  const eligible = candidates.filter(
    (candidate) => Math.abs(candidate.adjustment) <= threshold
  );
  eligible.sort((left, right) => {
    const distance =
      Math.abs(left.adjustment) - Math.abs(right.adjustment);
    return Math.abs(distance) > 1e-6
      ? distance
      : left.priority - right.priority;
  });
  return eligible[0] ?? null;
}
