import type { MuscleView } from "./muscles";

export type BodySide = "front" | "back";

export const FOCUS_MIN_DISTANCE_RATIO = 0.28;
export const FOCUS_MAX_DISTANCE_RATIO = 0.68;

/** Pick the semantic side that actually exposes a selected muscle. */
export function resolveMuscleView(
  muscleView: MuscleView,
  current: BodySide
): BodySide {
  return muscleView === "both" ? current : muscleView;
}

/** Return the equivalent target angle reached by the shortest orbit. */
export function nearestOrbitAngle(current: number, target: number): number {
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current)
  );
  return current + delta;
}

interface FocusDistanceInput {
  width: number;
  height: number;
  verticalFovDegrees: number;
  aspect: number;
  fullBodyDistance: number;
  /** Extra anatomical context around the selected mesh bounds. */
  padding?: number;
}

/**
 * Fit a muscle's bounds inside both camera axes, then keep extreme muscle
 * shapes from producing either a macro shot or a nearly full-body frame.
 */
export function calculateFocusDistance({
  width,
  height,
  verticalFovDegrees,
  aspect,
  fullBodyDistance,
  padding = 1.48
}: FocusDistanceInput): number {
  const safeAspect = Math.max(0.2, aspect);
  const verticalFov = (verticalFovDegrees * Math.PI) / 180;
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const widthDistance =
    Math.max(0, width) / 2 / Math.max(0.001, Math.tan(horizontalFov / 2));
  const heightDistance =
    Math.max(0, height) / 2 / Math.max(0.001, Math.tan(verticalFov / 2));
  const fitted = Math.max(widthDistance, heightDistance) * padding;
  const minimum = fullBodyDistance * FOCUS_MIN_DISTANCE_RATIO;
  const maximum = fullBodyDistance * FOCUS_MAX_DISTANCE_RATIO;
  return Math.min(maximum, Math.max(minimum, fitted));
}

/** Fast arrival with a long, controlled settle for the orbit and target. */
export function cinematicEaseOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clamped, 5);
}

/** Let the orbit establish direction before the camera begins its push. */
export function cinematicDollyProgress(progress: number): number {
  const delayed = (Math.min(1, Math.max(0, progress)) - 0.08) / 0.92;
  return cinematicEaseOut(delayed);
}
