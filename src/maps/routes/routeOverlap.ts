export type RouteLinePoint = [number, number];

const COORDINATE_PRECISION = 5;

/**
 * Finds road sections traversed more than once, regardless of direction.
 *
 * Routed geometry commonly returns the same road vertices for an out-and-back
 * leg. Coordinates are rounded to roughly one metre so harmless response
 * jitter does not prevent a match. Each repeated segment is emitted once,
 * grouped with adjacent repeated segments for efficient map rendering.
 */
export function findRetracedRouteSections(
  points: RouteLinePoint[]
): RouteLinePoint[][] {
  const segments = points.slice(1).map((point, index) => {
    const start = points[index]!;
    return {
      start,
      end: point,
      key: segmentKey(start, point)
    };
  });
  const counts = new Map<string, number>();

  for (const segment of segments) {
    if (segment.key) {
      counts.set(segment.key, (counts.get(segment.key) ?? 0) + 1);
    }
  }

  const emitted = new Set<string>();
  const sections: RouteLinePoint[][] = [];
  let active: RouteLinePoint[] = [];

  const flush = () => {
    if (active.length >= 2) {
      sections.push(active);
    }
    active = [];
  };

  for (const segment of segments) {
    const repeated =
      segment.key !== null &&
      (counts.get(segment.key) ?? 0) > 1 &&
      !emitted.has(segment.key);

    if (!repeated) {
      flush();
      continue;
    }

    emitted.add(segment.key!);
    if (active.length === 0) {
      active = [segment.start, segment.end];
    } else {
      active.push(segment.end);
    }
  }
  flush();

  return sections;
}

function segmentKey(
  start: RouteLinePoint,
  end: RouteLinePoint
): string | null {
  const startKey = pointKey(start);
  const endKey = pointKey(end);
  if (startKey === endKey) {
    return null;
  }
  return startKey < endKey
    ? `${startKey}|${endKey}`
    : `${endKey}|${startKey}`;
}

function pointKey([lat, lon]: RouteLinePoint): string {
  const factor = 10 ** COORDINATE_PRECISION;
  return `${Math.round(lat * factor)},${Math.round(lon * factor)}`;
}
