export type WatchfaceDimensionAxis = "width" | "height";

export interface WatchfaceDimensions {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Updates one dimension and, when linked, scales the other by the same amount.
 * The shared scale is constrained so neither dimension can leave its bounds.
 */
export function resizeWatchfaceDimensions(
  current: WatchfaceDimensions,
  axis: WatchfaceDimensionAxis,
  value: number,
  preserveAspectRatio: boolean,
  minimum = 1,
  maximum = Number.POSITIVE_INFINITY
): WatchfaceDimensions {
  const safeMinimum = Number.isFinite(minimum) ? Math.max(0, minimum) : 1;
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(safeMinimum, maximum)
    : Number.POSITIVE_INFINITY;
  const width = Math.max(safeMinimum, Number.isFinite(current.width) ? current.width : safeMinimum);
  const height = Math.max(safeMinimum, Number.isFinite(current.height) ? current.height : safeMinimum);
  const requested = clamp(
    Number.isFinite(value) ? value : current[axis],
    safeMinimum,
    safeMaximum
  );

  if (!preserveAspectRatio) {
    return axis === "width"
      ? { width: requested, height }
      : { width, height: requested };
  }

  const desiredScale = axis === "width" ? requested / width : requested / height;
  const minimumScale = Math.max(safeMinimum / width, safeMinimum / height);
  const maximumScale = Math.min(safeMaximum / width, safeMaximum / height);
  const scale = clamp(desiredScale, minimumScale, maximumScale);

  return {
    width: width * scale,
    height: height * scale
  };
}
