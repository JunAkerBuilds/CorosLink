import { robustExtent, smoothSeries, type ActivityStreams, type StreamSpeedKind } from "./activityStreams";

/**
 * The route drawn in runs of one colour each, from the watch's per-second
 * pace (or speed on a ride). Slow → fast runs blue → mint → yellow → coral,
 * the ramp the legend shows. Only built from recorded samples: without a pace
 * channel and GPS there is nothing to colour and the map draws its plain line.
 */

/** Slow → fast. */
export const ROUTE_PACE_RAMP = ["#60a5fa", "#34d399", "#facc15", "#fb7185"] as const;

/** Distinct colours along the line: enough to read as a gradient, few enough to keep runs long. */
const BINS = 10;
/** Points drawn on the map; longer recordings are thinned evenly. */
const MAX_POINTS = 2400;
/** Seconds of moving time averaged into each point, so GPS jitter does not paint confetti. */
const SMOOTHING_SECONDS = 20;

export interface RoutePaceRun {
  color: string;
  latLngs: [number, number][];
}

export interface RoutePaceColoring {
  runs: RoutePaceRun[];
  /** Colour-scale ends in canonical units (s/km, s/100 m, or km/h; see speedKind). */
  slowest: number;
  fastest: number;
  speedKind: StreamSpeedKind;
  /** Points across all runs, for progressive drawing. */
  pointCount: number;
}

function hexChannels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 0 = slowest, 1 = fastest, along ROUTE_PACE_RAMP. */
export function routePaceColor(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const scaled = clamped * (ROUTE_PACE_RAMP.length - 1);
  const index = Math.min(ROUTE_PACE_RAMP.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = hexChannels(ROUTE_PACE_RAMP[index]!);
  const to = hexChannels(ROUTE_PACE_RAMP[index + 1]!);
  const mixed = from.map((channel, position) => Math.round(channel + (to[position]! - channel) * local));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function routePaceColoring(streams: ActivityStreams | null | undefined): RoutePaceColoring | null {
  const pace = streams?.channels.pace;
  if (!streams || !pace || !streams.hasGps) return null;
  const speed = streams.speedKind === "speed";
  const smoothed = smoothSeries(streams.t, pace, SMOOTHING_SECONDS, !speed);
  // Trim the tails: a stop-and-go start or a final sprint should not flatten the rest.
  const extent = robustExtent(smoothed, 0, streams.length - 1, 0.05, 0.95);
  if (!extent) return null;
  const [low, high] = extent;
  // A flat-paced session would be one colour; the plain route says the same.
  if (high - low < (speed ? 0.5 : 3)) return null;
  const fastRatio = (value: number) => (speed ? (value - low) / (high - low) : (high - value) / (high - low));

  const step = Math.max(1, Math.ceil(streams.length / MAX_POINTS));
  const runs: RoutePaceRun[] = [];
  let current: RoutePaceRun | null = null;
  let currentBin = -1;
  let pointCount = 0;
  for (let index = 0; index < streams.length; index += step) {
    const lat = streams.lat[index]!;
    const lon = streams.lon[index]!;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const value = smoothed[index]!;
    // A sample without pace (a stop) keeps the colour it arrived with.
    const bin = Number.isFinite(value)
      ? Math.round(Math.min(1, Math.max(0, fastRatio(value))) * (BINS - 1))
      : currentBin === -1 ? 0 : currentBin;
    const point: [number, number] = [lat, lon];
    if (!current || bin !== currentBin) {
      // Each run starts where the last one ended so the line stays unbroken.
      const open = current as RoutePaceRun | null;
      const previous: [number, number] | undefined = open ? open.latLngs[open.latLngs.length - 1] : undefined;
      current = { color: routePaceColor(bin / (BINS - 1)), latLngs: previous ? [previous, point] : [point] };
      runs.push(current);
      currentBin = bin;
    } else {
      current.latLngs.push(point);
    }
    pointCount += 1;
  }
  if (pointCount < 2) return null;
  return {
    runs: runs.filter((run) => run.latLngs.length > 1),
    slowest: speed ? low : high,
    fastest: speed ? high : low,
    speedKind: streams.speedKind,
    pointCount
  };
}
