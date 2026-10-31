import { t, useLanguage, getLocale, formatNumber } from "../../i18n/training";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Activity, Layers, RotateCcw, Rows2, Rows3, X, ZoomIn } from "lucide-react";
import type { UnitSystem } from "../../../electron/types";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import { useTheme } from "../../theme/ThemeProvider";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  displayDistanceToMeters,
  distanceUnit,
  elevationUnit,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace,
  speedUnit
} from "../../units/units";
import {
  STREAM_CHANNEL_ORDER,
  nearestIndex,
  niceTicks,
  robustExtent,
  smoothSeries,
  summarizeRange,
  type ActivityStreams,
  type StreamChannelKey,
  type StreamLap,
  type StreamLapKind,
  type StreamZone
} from "../activityStreams";
import { getActivityChannelColors, getIntensityZoneColors } from "../chartConfig";
import { formatDurationSeconds } from "../formatters";
import type { RouteCursor } from "../routeCursor";
import "../activityChannels.css";

type ChannelLayout = "overlay" | "split" | "stacked";
type ChannelAxis = "time" | "distance";
const SMOOTHING_OPTIONS = [0, 5, 15, 30] as const;
type Smoothing = (typeof SMOOTHING_OPTIONS)[number];

const DEFAULT_CHANNELS: StreamChannelKey[] = ["pace", "hr", "elevation"];

const CHANNELS_PREFERENCE = defineSelectionPreference<StreamChannelKey[]>({
  key: "training.activityChannels.selected",
  defaultValue: DEFAULT_CHANNELS,
  validate: selectionIsArrayOf(selectionIsOneOf(STREAM_CHANNEL_ORDER), { unique: true })
});
const LAYOUT_PREFERENCE = defineSelectionPreference<ChannelLayout>({
  key: "training.activityChannels.layout",
  defaultValue: "overlay",
  validate: selectionIsOneOf(["overlay", "split", "stacked"])
});
const AXIS_PREFERENCE = defineSelectionPreference<ChannelAxis>({
  key: "training.activityChannels.axis",
  defaultValue: "time",
  validate: selectionIsOneOf(["time", "distance"])
});
const SMOOTHING_PREFERENCE = defineSelectionPreference<Smoothing>({
  key: "training.activityChannels.smoothing",
  defaultValue: 5,
  validate: selectionIsOneOf(SMOOTHING_OPTIONS)
});

// Geometry, in CSS pixels. The plot keeps the same left edge in both layouts so
// switching does not shift the time axis under the cursor.
const LEFT = 54;
const RIGHT_OVERLAY = 54;
// Stacked keeps a narrow right gutter for the heart-rate zone labels.
const RIGHT_STACKED = 34;
const LAP_STRIP = 20;
const AXIS_HEIGHT = 28;
const OVERLAY_PLOT = 280;
const OVERLAY_ELEVATION_SHARE = 0.42;
const LANE_TITLE = 24;
const LANE_PLOT = 78;
const ELEVATION_LANE_PLOT = 56;
const LANE_GAP = 8;
const NAVIGATOR_HEIGHT = 38;
const SPLIT_PLOT = 150;

/**
 * Split layout: what the athlete produced on top, what it cost the body below,
 * on one clock. Grade sits with output, as the terrain the pace was run on;
 * elevation is drawn behind both plots.
 */
const OUTPUT_CHANNELS = new Set<StreamChannelKey>(["pace", "gap", "power", "grade"]);
const SPLIT_PLOT_TITLES = ["Output", "Body & form"] as const;
const MIN_VIEW_SAMPLES = 20;
const PAUSE_MARKER_SECONDS = 10;

const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800];
const CLOCK_STEPS = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600];
// Channels whose axis never goes below zero, even after padding.
const NON_NEGATIVE = new Set<StreamChannelKey>(["pace", "gap", "hr", "cadence", "power", "stride", "gct", "vo", "vr"]);

const LAP_KIND_LABELS: Record<StreamLapKind, string> = {
  lap: "Lap",
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cool-down"
};

interface ChannelSpec {
  key: StreamChannelKey;
  label: string;
  short: string;
  unit: string;
  /** Faster pace = smaller number, drawn higher. */
  inverted: boolean;
  /** Smooth in the reciprocal domain (pace). */
  inverse: boolean;
  /** Smallest axis span in display units, so a flat line is not blown up into noise. */
  minSpan: number;
  toDisplay: (value: number) => number;
  format: (display: number) => string;
  tickSteps?: readonly number[];
}

function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function trimNumber(value: number, digits: number): string {
  return formatNumber(value, { maximumFractionDigits: digits });
}

function buildChannelSpecs(
  streams: ActivityStreams,
  unitSystem: UnitSystem,
  cycling: boolean
): Record<StreamChannelKey, ChannelSpec> {
  const imperial = unitSystem === "imperial";
  const runPace = (key: StreamChannelKey, label: string, short: string): ChannelSpec => ({
    key,
    label,
    short,
    unit: `/${distanceUnit(unitSystem)}`,
    inverted: true,
    inverse: true,
    minSpan: 30,
    toDisplay: (value) => secondsPerKmToDisplayPace(value, unitSystem),
    format: clock,
    tickSteps: CLOCK_STEPS
  });
  const plain = (
    key: StreamChannelKey,
    label: string,
    short: string,
    unit: string,
    minSpan: number,
    digits = 0,
    toDisplay: (value: number) => number = (value) => value
  ): ChannelSpec => ({
    key,
    label,
    short,
    unit,
    inverted: false,
    inverse: false,
    minSpan,
    toDisplay,
    format: (value) => formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  });

  const pace: ChannelSpec =
    streams.speedKind === "speed"
      ? plain("pace", "Speed", "Speed", speedUnit(unitSystem), 5, 1, (value) => kmhToDisplaySpeed(value, unitSystem))
      : streams.speedKind === "swimPace"
        ? {
            ...runPace("pace", "Pace", "Pace"),
            unit: imperial ? "/100yd" : "/100m",
            toDisplay: (value) => (imperial ? value * 0.9144 : value)
          }
        : runPace("pace", "Pace", "Pace");

  return {
    pace,
    // COROS calls its grade-adjusted pace "effort pace".
    gap: runPace("gap", "Effort pace", "Effort"),
    hr: plain("hr", "Heart rate", "HR", "bpm", 12),
    // A swim's cadence is the watch's stroke rate (strokes per minute).
    cadence: streams.speedKind === "swimPace"
      ? plain("cadence", t("Stroke rate"), "Stroke rate", "spm", 10)
      : plain("cadence", cycling ? t("Cycling cadence") : t("Cadence"), "Cadence", cycling ? "rpm" : "spm", 10),
    power: plain("power", "Power", "Power", "W", 40),
    stride: plain("stride", "Stride length", "Stride", imperial ? "ft" : "m", imperial ? 0.3 : 0.1, 2, (value) =>
      imperial ? value * 3.28084 : value
    ),
    gct: plain("gct", "Ground contact", "Contact", "ms", 20),
    vo: plain("vo", "Vertical oscillation", "Vert. osc.", imperial ? "in" : "cm", 1, 1, (value) =>
      imperial ? value / 2.54 : value
    ),
    vr: plain("vr", "Vertical ratio", "Vert. ratio", "%", 1, 1),
    elevation: plain("elevation", "Elevation", "Elevation", elevationUnit(unitSystem), imperial ? 30 : 10, 0, (value) =>
      metersToElevation(value, unitSystem)
    ),
    grade: plain("grade", "Grade", "Grade", "%", 4, 1),
    // In a swim, the watch measures the water. The sensor reads whole degrees: a wide axis keeps a 1° flicker small.
    temperature: plain(
      "temperature", streams.speedKind === "swimPace" ? t("Water temperature") : t("Temperature"), "Temp", imperial ? "°F" : "°C", imperial ? 14 : 8, 0,
      (value) => (imperial ? (value * 9) / 5 + 32 : value)
    )
  };
}

function channelDomain(spec: ChannelSpec, values: Float64Array, from: number, to: number): [number, number] | null {
  const key = spec.key;
  const [lowQ, highQ] =
    // Pace trims only the slow tail (restarts after a stop), never the fastest efforts.
    key === "pace" || key === "gap" ? [0.003, 0.97] : key === "elevation" || key === "grade" ? [0, 1] : [0.005, 0.995];
  const extent = robustExtent(values, from, to, lowQ, highQ);
  if (!extent) return null;
  let [low, high] = extent;
  if (high - low < spec.minSpan) {
    const middle = (low + high) / 2;
    low = middle - spec.minSpan / 2;
    high = middle + spec.minSpan / 2;
  }
  const pad = (high - low) * 0.08;
  low -= pad;
  high += pad;
  if (NON_NEGATIVE.has(key) && low < 0) low = 0;
  return [low, high];
}

type Point = [number, number];

/**
 * Screen-space polyline segments for values[from..to]. Dense ranges collapse to
 * a min/max pair per pixel column, which keeps spikes (an interval rep, a
 * stop) that plain decimation would drop.
 */
function lineSegments(
  xs: Float64Array,
  values: Float64Array,
  from: number,
  to: number,
  sx: (x: number) => number,
  sy: (value: number) => number,
  plotWidth: number
): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] | null = null;
  const push = (x: number, y: number) => {
    if (!current) {
      current = [];
      segments.push(current);
    }
    current.push([x, y]);
  };
  if (to - from <= plotWidth * 2) {
    for (let index = from; index <= to; index += 1) {
      const value = values[index]!;
      if (Number.isFinite(value)) push(sx(xs[index]!), sy(value));
      else current = null;
    }
    return segments;
  }
  let column = Number.NaN;
  let low = 0;
  let high = 0;
  let lowAt = 0;
  let highAt = 0;
  let open = false;
  const flush = () => {
    if (!open) return;
    const x = column + 0.5;
    const [first, second] = lowAt <= highAt ? [low, high] : [high, low];
    push(x, sy(first));
    if (second !== first) push(x, sy(second));
    open = false;
  };
  for (let index = from; index <= to; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) {
      flush();
      current = null;
      column = Number.NaN;
      continue;
    }
    const nextColumn = Math.floor(sx(xs[index]!));
    if (nextColumn !== column) {
      flush();
      column = nextColumn;
      low = high = value;
      lowAt = highAt = index;
      open = true;
    } else if (value < low) {
      low = value;
      lowAt = index;
    } else if (value > high) {
      high = value;
      highAt = index;
    }
  }
  flush();
  return segments;
}

function linePath(segments: Point[][]): string {
  return segments
    .map((segment) => segment.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(""))
    .join("");
}

function areaPath(segments: Point[][], baseline: number): string {
  return segments
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0]!;
      const last = segment[segment.length - 1]!;
      return `M${first[0].toFixed(1)} ${baseline}${segment
        .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
        .join("")}L${last[0].toFixed(1)} ${baseline}Z`;
    })
    .join("");
}

interface Lane {
  key: StreamChannelKey;
  top: number;
  height: number;
  domain: [number, number];
  ticks: number[];
  axis: "left" | "right" | "none";
  area: boolean;
  path: string;
  fill?: string;
  /** Stacked and split layouts: y of the lane title row. */
  titleY?: number;
  /** Split layout: 0 the output plot, 1 the body plot. */
  plot?: number;
}

function laneY(lane: Pick<Lane, "top" | "height" | "domain">, inverted: boolean, value: number): number {
  const [low, high] = lane.domain;
  const ratio = inverted ? (value - low) / (high - low) : (high - value) / (high - low);
  return lane.top + Math.min(1, Math.max(0, ratio)) * lane.height;
}

interface ActivityChannelsProps {
  streams: ActivityStreams;
  cycling: boolean;
  /** Watch-reported ascent, shown for the whole-activity readout instead of our estimate. */
  elevationGain?: number;
  cursor?: RouteCursor;
}

interface DragState {
  pointerId: number;
  startX: number;
  startIndex: number;
  moved: boolean;
}

export function ActivityChannels({ streams, cycling, elevationGain, cursor }: ActivityChannelsProps) {
  useLanguage();
  const { theme } = useTheme();
  const { unitSystem } = useUnitSystem();
  const colors = getActivityChannelColors(theme);
  const zoneColors = getIntensityZoneColors(theme);
  const [preferred, setPreferred] = useSelectionPreference(CHANNELS_PREFERENCE);
  const [layout, setLayout] = useSelectionPreference(LAYOUT_PREFERENCE);
  const [preferredAxis, setAxis] = useSelectionPreference(AXIS_PREFERENCE);
  const [smoothing, setSmoothing] = useSelectionPreference(SMOOTHING_PREFERENCE);
  const axis: ChannelAxis = streams.hasDistance ? preferredAxis : "time";
  const last = streams.length - 1;

  const available = useMemo(
    () => STREAM_CHANNEL_ORDER.filter((key) => streams.channels[key]),
    [streams]
  );
  const selected = useMemo(() => {
    const picked = available.filter((key) => preferred.includes(key));
    if (picked.length > 0 || preferred.length === 0) return picked;
    // Nothing the user prefers was recorded here (a ride with no power meter): fall back.
    const fallback = available.filter((key) => DEFAULT_CHANNELS.includes(key));
    return fallback.length > 0 ? fallback : available.slice(0, 1);
  }, [available, preferred]);

  const toggleChannel = (key: StreamChannelKey) => {
    const next = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
    // Keep preferences for channels this activity simply does not have.
    setPreferred([...preferred.filter((item) => !available.includes(item)), ...next]);
  };

  const specs = useMemo(() => buildChannelSpecs(streams, unitSystem, cycling), [streams, unitSystem, cycling, getLocale()]);
  const display = useMemo(() => {
    const result: Partial<Record<StreamChannelKey, Float64Array>> = {};
    for (const key of available) {
      const spec = specs[key];
      const smoothed = smoothSeries(streams.t, streams.channels[key]!, smoothing, spec.inverse);
      const values = new Float64Array(smoothed.length);
      for (let index = 0; index < smoothed.length; index += 1) {
        const value = smoothed[index]!;
        values[index] = Number.isFinite(value) ? spec.toDisplay(value) : Number.NaN;
      }
      result[key] = values;
    }
    return result;
  }, [available, specs, streams, smoothing]);

  const xs = axis === "distance" ? streams.d : streams.t;
  const [view, setView] = useState<[number, number]>([0, last]);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const zoomed = view[0] > 0 || view[1] < last;

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const lines = useMemo(() => selected.filter((key) => key !== "elevation"), [selected]);
  const showElevation = selected.includes("elevation");
  // Split needs something on each side; with one side empty it draws as overlay.
  const splitGroups = useMemo(() => {
    const output = lines.filter((key) => OUTPUT_CHANNELS.has(key));
    const body = lines.filter((key) => !OUTPUT_CHANNELS.has(key));
    return output.length > 0 && body.length > 0 ? [output, body] : null;
  }, [lines]);
  const shownLayout: ChannelLayout = layout === "split" && !splitGroups ? "overlay" : layout;

  const right = shownLayout === "stacked" ? RIGHT_STACKED : RIGHT_OVERLAY;
  const plotWidth = Math.max(40, width - LEFT - right);
  const hasLaps = streams.laps.length > 0;
  // Overlay needs the strip for its axis unit labels even without laps.
  const plotTop = hasLaps || shownLayout === "overlay" ? LAP_STRIP : 6;
  const [v0, v1] = view;
  const x0 = xs[v0]!;
  const x1 = xs[v1]!;
  const xSpan = x1 - x0 || 1;
  const sx = useCallback((x: number) => LEFT + ((x - x0) / xSpan) * plotWidth, [x0, xSpan, plotWidth]);

  const lanes = useMemo<Lane[]>(() => {
    if (width === 0) return [];
    const domainOf = (key: StreamChannelKey) => channelDomain(specs[key], display[key]!, v0, v1);
    const result: Lane[] = [];
    const build = (key: StreamChannelKey, top: number, height: number, axisSide: Lane["axis"], area: boolean, tickTarget: number, titleY?: number, plot?: number) => {
      const domain = domainOf(key);
      if (!domain) return;
      const spec = specs[key];
      const geometry = { top, height, domain };
      const segments = lineSegments(xs, display[key]!, v0, v1, sx, (value) => laneY(geometry, spec.inverted, value), plotWidth);
      result.push({
        key,
        top,
        height,
        domain,
        ticks: niceTicks(domain[0], domain[1], tickTarget, spec.tickSteps).filter((tick) => {
          const y = laneY(geometry, spec.inverted, tick);
          return tick >= domain[0] && tick <= domain[1] && y >= top + 7 && y <= top + height - 5;
        }),
        axis: axisSide,
        area,
        path: linePath(segments),
        fill: area ? areaPath(segments, top + height) : undefined,
        titleY,
        plot
      });
    };

    if (shownLayout === "split" && splitGroups) {
      let top = plotTop;
      splitGroups.forEach((group, plot) => {
        const plotY = top + LANE_TITLE;
        if (showElevation) {
          const height = SPLIT_PLOT * OVERLAY_ELEVATION_SHARE;
          build("elevation", plotY + SPLIT_PLOT - height, height, "none", true, 4, undefined, plot);
        }
        group.forEach((key, position) => {
          build(key, plotY, SPLIT_PLOT, position === 0 ? "left" : position === 1 ? "right" : "none", false, 4, top + 15, plot);
        });
        top = plotY + SPLIT_PLOT + LANE_GAP;
      });
      return result;
    }

    if (shownLayout === "overlay") {
      if (showElevation) {
        const height = lines.length > 0 ? OVERLAY_PLOT * OVERLAY_ELEVATION_SHARE : OVERLAY_PLOT;
        build("elevation", plotTop + OVERLAY_PLOT - height, height, lines.length > 0 ? "none" : "left", true, 4);
      }
      lines.forEach((key, position) => {
        build(key, plotTop, OVERLAY_PLOT, position === 0 ? "left" : position === 1 ? "right" : "none", false, 4);
      });
      return result;
    }

    let top = plotTop;
    for (const key of [...lines, ...(showElevation ? (["elevation"] as const) : [])]) {
      const height = key === "elevation" ? ELEVATION_LANE_PLOT : LANE_PLOT;
      build(key, top + LANE_TITLE, height, "left", key === "elevation", key === "elevation" ? 2 : 4, top + 15);
      top += LANE_TITLE + height + LANE_GAP;
    }
    return result;
  }, [width, shownLayout, splitGroups, lines, showElevation, specs, display, v0, v1, xs, sx, plotWidth, plotTop]);

  const plotBottom =
    shownLayout === "overlay"
      ? plotTop + OVERLAY_PLOT
      : lanes.length > 0
        ? Math.max(...lanes.map((lane) => lane.top + lane.height))
        : plotTop + LANE_PLOT;
  const height = plotBottom + AXIS_HEIGHT;

  const xTicks = useMemo(() => {
    const target = Math.max(2, Math.floor(plotWidth / 110));
    if (axis === "time") {
      return niceTicks(x0, x1, target, TIME_STEPS).map((value) => ({ x: value, label: formatDurationSeconds(value) }));
    }
    const low = metersToDisplayDistance(x0, unitSystem);
    const high = metersToDisplayDistance(x1, unitSystem);
    return niceTicks(low, high, target).map((value) => ({
      x: displayDistanceToMeters(value, unitSystem),
      label: `${trimNumber(value, 2)} ${distanceUnit(unitSystem)}`
    }));
  }, [axis, x0, x1, plotWidth, unitSystem, getLocale()]);

  const laps = useMemo(
    () =>
      streams.laps
        .filter((lap) => lap.to >= v0 && lap.from <= v1)
        .map((lap) => {
          const start = sx(xs[Math.max(lap.from, v0)]!);
          const end = sx(xs[Math.min(lap.to + 1, v1, last)]!);
          return { lap, start, end };
        }),
    [streams.laps, v0, v1, sx, xs, last]
  );

  // Pauses closer than a marker's width merge into one, with their time summed.
  const pauses = useMemo(() => {
    const markers: Array<{ index: number; seconds: number; x: number }> = [];
    for (const pause of streams.pauses) {
      if (pause.seconds < PAUSE_MARKER_SECONDS || pause.index <= v0 || pause.index >= v1) continue;
      const x = sx(xs[pause.index]!);
      const previous = markers[markers.length - 1];
      if (previous && x - previous.x < 10) previous.seconds += pause.seconds;
      else markers.push({ index: pause.index, seconds: pause.seconds, x });
    }
    return markers;
  }, [streams.pauses, v0, v1, sx, xs]);

  // --- Route map sync -------------------------------------------------------
  useEffect(() => {
    if (!cursor) return;
    const latitude = hover === null ? Number.NaN : streams.lat[hover]!;
    const longitude = hover === null ? Number.NaN : streams.lon[hover]!;
    cursor.set({ point: Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null });
  }, [cursor, hover, streams]);
  useEffect(() => {
    if (!cursor) return;
    if (!selection || !streams.hasGps) {
      cursor.set({ segment: null });
      return;
    }
    const [from, to] = selection;
    const step = Math.max(1, Math.floor((to - from) / 400));
    const segment: [number, number][] = [];
    for (let index = from; index <= to; index += step) {
      const latitude = streams.lat[index]!;
      const longitude = streams.lon[index]!;
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) segment.push([latitude, longitude]);
    }
    cursor.set({ segment: segment.length > 1 ? segment : null });
  }, [cursor, selection, streams]);
  useEffect(() => () => cursor?.set({ point: null, segment: null }), [cursor]);

  // --- Interaction ----------------------------------------------------------
  const indexAt = useCallback(
    (clientX: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return v0;
      const x = Math.min(LEFT + plotWidth, Math.max(LEFT, clientX - rect.left));
      return nearestIndex(xs, x0 + ((x - LEFT) / plotWidth) * xSpan, v0, v1);
    },
    [plotWidth, xs, x0, xSpan, v0, v1]
  );

  const zoomTo = useCallback(
    (from: number, to: number) => {
      let start = Math.max(0, Math.min(from, to));
      let end = Math.min(last, Math.max(from, to));
      if (end - start < MIN_VIEW_SAMPLES) {
        const middle = Math.round((start + end) / 2);
        start = Math.max(0, middle - MIN_VIEW_SAMPLES / 2);
        end = Math.min(last, start + MIN_VIEW_SAMPLES);
      }
      setView([start, end]);
    },
    [last]
  );

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event.clientX);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startIndex: index, moved: false };
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const index = indexAt(event.clientX);
    setHover(index);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;
    drag.moved = true;
    setSelection(index === drag.startIndex ? null : [Math.min(index, drag.startIndex), Math.max(index, drag.startIndex)]);
  };
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) setSelection(null);
    dragRef.current = null;
  };
  const resetZoom = () => {
    setView([0, last]);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = Math.max(1, Math.round((v1 - v0) / 100)) * (event.shiftKey ? 10 : 1);
      const start = hover ?? (event.key === "ArrowLeft" ? v1 : v0);
      setHover(Math.min(v1, Math.max(v0, start + (event.key === "ArrowLeft" ? -step : step))));
    } else if (event.key === "Enter" && selection) {
      event.preventDefault();
      zoomTo(selection[0], selection[1]);
      setSelection(null);
    } else if (event.key === "Escape") {
      // Consume Escape only while it has something to undo; otherwise it closes the dialog.
      if (selection || zoomed) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (selection) setSelection(null);
      else if (zoomed) resetZoom();
      else setHover(null);
    }
  };

  // Pinch (ctrl + wheel on macOS trackpads) zooms around the pointer; plain
  // wheel keeps scrolling the dialog. Needs a non-passive listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const centre = indexAt(event.clientX);
      const span = v1 - v0;
      const nextSpan = Math.min(last, Math.max(MIN_VIEW_SAMPLES, Math.round(span * Math.exp(event.deltaY * 0.012))));
      const ratio = span > 0 ? (centre - v0) / span : 0.5;
      const start = Math.round(centre - ratio * nextSpan);
      const clamped = Math.min(last - nextSpan, Math.max(0, start));
      setView([clamped, clamped + nextSpan]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [indexAt, v0, v1, last]);

  // --- Readout --------------------------------------------------------------
  const summaryRange: [number, number] = selection ?? view;
  const summary = useMemo(
    () => (hover === null ? summarizeRange(streams, summaryRange[0], summaryRange[1]) : null),
    [hover, streams, summaryRange[0], summaryRange[1]]
  );
  const wholeActivity = !selection && !zoomed;
  const lapAt = (index: number): StreamLap | undefined =>
    streams.laps.find((lap) => index >= lap.from && index <= lap.to);

  const formatDistance = (meters: number) =>
    `${trimNumber(metersToDisplayDistance(meters, unitSystem), 2)} ${distanceUnit(unitSystem)}`;

  const readoutTitle = (() => {
    if (hover !== null) {
      const lap = lapAt(hover);
      return {
        label: formatDurationSeconds(streams.t[hover]),
        detail: [
          streams.hasDistance ? formatDistance(streams.d[hover]!) : null,
          lap ? `${streams.structured ? LAP_KIND_LABELS[lap.kind] : "Lap"} ${lap.index}` : null
        ]
          .filter(Boolean)
          .join(" · ")
      };
    }
    const [from, to] = summaryRange;
    const span = `${formatDurationSeconds(streams.t[from])}–${formatDurationSeconds(streams.t[to])}`;
    const facts = [
      formatDurationSeconds(summary?.seconds),
      streams.hasDistance && summary ? formatDistance(summary.meters) : null
    ].filter(Boolean);
    return {
      label: selection ? t("Selection") : zoomed ? t("Visible range") : t("Whole activity"),
      detail: [wholeActivity ? null : span, ...facts].filter(Boolean).join(" · ")
    };
  })();

  const readoutValue = (key: StreamChannelKey): { value: string; note?: string } => {
    const spec = specs[key];
    if (hover !== null) {
      const value = display[key]![hover]!;
      return { value: Number.isFinite(value) ? spec.format(value) : "–" };
    }
    if (key === "elevation") {
      const gain = wholeActivity && elevationGain !== undefined ? elevationGain : summary?.elevationGain;
      if (gain === undefined) return { value: "–" };
      return {
        value: `+${Math.round(metersToElevation(gain, unitSystem))}`,
        note:
          summary?.elevationLoss !== undefined && !wholeActivity
            ? `−${Math.round(metersToElevation(summary.elevationLoss, unitSystem))} ${elevationUnit(unitSystem)}`
            : t("gain")
      };
    }
    const average = summary?.averages[key];
    return {
      value: average === undefined ? "–" : spec.format(spec.toDisplay(average)),
      note: t("avg")
    };
  };

  // --- Render ---------------------------------------------------------------
  const hoverX = hover === null ? null : sx(xs[hover]!);
  const selectionBox =
    selection && selection[1] >= v0 && selection[0] <= v1
      ? { start: sx(xs[Math.max(selection[0], v0)]!), end: sx(xs[Math.min(selection[1], v1)]!) }
      : null;
  const leftLane = lanes.find((lane) => lane.axis === "left" && lane.key !== "elevation") ?? lanes.find((lane) => lane.axis === "left");
  const gridLane = shownLayout === "overlay" ? leftLane : undefined;
  // Split: each plot's bed, title row and grid, from its left-axis lane.
  const splitPlots =
    shownLayout === "split" && splitGroups
      ? splitGroups.map((group, plot) => {
          const axisLane = lanes.find((lane) => lane.plot === plot && lane.axis === "left");
          const anyLane = lanes.find((lane) => lane.plot === plot && lane.key !== "elevation") ?? axisLane;
          return { plot, group, axisLane, top: anyLane?.top, height: anyLane?.height, titleY: anyLane?.titleY };
        })
      : [];
  const hrZones = streams.zones.hr?.zones;
  const zoneBands = (lane: Lane) => {
    if (lane.key !== "hr" || shownLayout !== "stacked" || !hrZones) return null;
    return hrZones.map((zone: StreamZone, position) => {
      const lower = zone.start ?? Number.NEGATIVE_INFINITY;
      const upper = hrZones[position + 1]?.start ?? Number.POSITIVE_INFINITY;
      const [low, high] = lane.domain;
      if (upper <= low || lower >= high) return null;
      const top = laneY(lane, false, Math.min(upper, high));
      const bottom = laneY(lane, false, Math.max(lower, low));
      const color = zoneColors[position % zoneColors.length];
      return (
        <g key={zone.index} className="activity-channels-zone-band">
          <rect x={LEFT} y={top} width={plotWidth} height={Math.max(0, bottom - top)} style={{ fill: color }} />
          {bottom - top >= 11 ? (
            <text x={LEFT + plotWidth + 6} y={(top + bottom) / 2} dy="0.35em" style={{ fill: color }}>
              Z{position + 1}
            </text>
          ) : null}
        </g>
      );
    });
  };

  return (
    <section className="activity-detail-visual-panel activity-channels" data-layout={shownLayout}>
      <div className="activity-detail-visual-heading">
        <h3>
          <Activity size={17} aria-hidden="true" />
          {t("Channels")}</h3>
        <div className="activity-channels-controls">
          <div className="library-filter-group" role="group" aria-label={t("Chart layout")}>
            <button type="button" className={`library-filter-option${shownLayout === "overlay" ? " active" : ""}`} aria-pressed={shownLayout === "overlay"} onClick={() => setLayout("overlay")}>
              <Layers size={13} aria-hidden="true" />
              {t("Overlay")}</button>
            <button
              type="button"
              className={`library-filter-option${shownLayout === "split" ? " active" : ""}`}
              aria-pressed={shownLayout === "split"}
              disabled={!splitGroups}
              title={splitGroups ? t("Output on top, what it cost the body below, on one clock") : t("Pick an output channel, such as pace or power, and a body channel, such as heart rate, to split them")}
              onClick={() => setLayout("split")}
            >
              <Rows2 size={13} aria-hidden="true" />
              {t("Split")}</button>
            <button type="button" className={`library-filter-option${shownLayout === "stacked" ? " active" : ""}`} aria-pressed={shownLayout === "stacked"} onClick={() => setLayout("stacked")}>
              <Rows3 size={13} aria-hidden="true" />
              {t("Stacked")}</button>
          </div>
          {streams.hasDistance ? (
            <div className="library-filter-group" role="group" aria-label={t("Horizontal axis")}>
              {(["time", "distance"] as const).map((option) => (
                <button key={option} type="button" className={`library-filter-option${axis === option ? " active" : ""}`} aria-pressed={axis === option} onClick={() => setAxis(option)}>
                  {option === "time" ? t("Time") : t("Distance")}
                </button>
              ))}
            </div>
          ) : null}
          <label className="activity-channels-smoothing">
            <span>{t("Smoothing")}</span>
            <select value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value) as Smoothing)}>
              {SMOOTHING_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? t("Raw") : `${option} s`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="activity-channels-picker" role="group" aria-label={t("Channels to plot")}>
        {available.map((key) => {
          const active = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              className="activity-channels-chip"
              aria-pressed={active}
              style={{ "--channel-color": colors[key] } as CSSProperties}
              onClick={() => toggleChannel(key)}
            >
              <i aria-hidden="true" />
              {t(specs[key].label)}
            </button>
          );
        })}
      </div>

      <div className={`activity-channels-readout${hover !== null ? " is-live" : ""}`}>
        <div className="activity-channels-readout-title">
          <strong>{t(readoutTitle.label)}</strong>
          {readoutTitle.detail ? <span>{readoutTitle.detail}</span> : null}
          <span className="activity-channels-readout-actions">
            {selection ? (
              <>
                <button type="button" onClick={() => { zoomTo(selection[0], selection[1]); setSelection(null); }}>
                  <ZoomIn size={13} aria-hidden="true" />
                  {t("Zoom to selection")}</button>
                <button type="button" aria-label={t("Clear selection")} title={t("Clear selection")} onClick={() => setSelection(null)}>
                  <X size={13} aria-hidden="true" />
                </button>
              </>
            ) : zoomed ? (
              <button type="button" onClick={resetZoom}>
                <RotateCcw size={13} aria-hidden="true" />
                {t("Reset zoom")}</button>
            ) : null}
          </span>
        </div>
        {selected.length > 0 ? (
          <dl className="activity-channels-readout-values">
            {selected.map((key) => {
              const { value, note } = readoutValue(key);
              return (
                <div key={key} style={{ "--channel-color": colors[key] } as CSSProperties}>
                  <dt>{specs[key].short}</dt>
                  <dd>
                    <strong>{value}</strong>
                    <small>{specs[key].unit}</small>
                    {note && hover === null ? <em>{note}</em> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
      </div>

      <div
        ref={stageRef}
        className="activity-channels-stage"
        tabIndex={0}
        role="group"
        aria-label={t("Channel chart. Arrow keys move the cursor, drag to select a stretch, Escape clears it.")}
        onKeyDown={handleKeyDown}
        onBlur={() => setHover(null)}
      >
        {selected.length === 0 ? (
          <p className="activity-channels-empty">{t("Pick a channel above to plot it.")}</p>
        ) : width > 0 ? (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="activity-channels-svg"
            aria-hidden="true"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => { dragRef.current = null; }}
            onPointerLeave={() => { if (!dragRef.current) setHover(null); }}
            onDoubleClick={() => { resetZoom(); setSelection(null); }}
          >
            {/* Laps: bands first so every line sits on top. */}
            {laps.map(({ lap, start, end }) => (
              <rect
                key={`band-${lap.index}`}
                className={`activity-channels-lap is-${lap.kind}${streams.structured ? "" : lap.index % 2 === 0 ? " is-even" : ""}`}
                x={start}
                y={plotTop}
                width={Math.max(0, end - start)}
                height={plotBottom - plotTop}
              />
            ))}

            {gridLane?.ticks.map((tick) => (
              <line key={`grid-${tick}`} className="activity-channels-grid" x1={LEFT} x2={LEFT + plotWidth} y1={laneY(gridLane, specs[gridLane.key].inverted, tick)} y2={laneY(gridLane, specs[gridLane.key].inverted, tick)} />
            ))}

            {splitPlots.map(({ plot, group, axisLane, top, height: plotHeight, titleY }) =>
              top === undefined || plotHeight === undefined ? null : (
                <g key={`plot-${plot}`} className="activity-channels-split-plot">
                  <rect className="activity-channels-lane-bed" x={LEFT} y={top} width={plotWidth} height={plotHeight} />
                  {axisLane?.ticks.map((tick) => (
                    <line key={tick} className="activity-channels-grid" x1={LEFT} x2={LEFT + plotWidth} y1={laneY(axisLane, specs[axisLane.key].inverted, tick)} y2={laneY(axisLane, specs[axisLane.key].inverted, tick)} />
                  ))}
                  <text className="activity-channels-lane-title" x={LEFT} y={titleY}>
                    <tspan>{t(SPLIT_PLOT_TITLES[plot]!)}</tspan>
                    {group.map((key) => (
                      <Fragment key={key}>
                        <tspan dx={12} style={{ fill: colors[key] }}>●</tspan>
                        <tspan dx={5} className="is-unit">{specs[key].short} {specs[key].unit}</tspan>
                      </Fragment>
                    ))}
                  </text>
                </g>
              )
            )}

            {lanes.map((lane) => {
              const spec = specs[lane.key];
              const color = colors[lane.key];
              return (
                <g key={`${lane.key}-${lane.plot ?? 0}`} className={`activity-channels-lane is-${lane.key}`}>
                  {shownLayout === "stacked" ? (
                    <>
                      <rect className="activity-channels-lane-bed" x={LEFT} y={lane.top} width={plotWidth} height={lane.height} />
                      {zoneBands(lane)}
                      {lane.ticks.map((tick) => (
                        <line key={tick} className="activity-channels-grid" x1={LEFT} x2={LEFT + plotWidth} y1={laneY(lane, spec.inverted, tick)} y2={laneY(lane, spec.inverted, tick)} />
                      ))}
                      <text className="activity-channels-lane-title" x={LEFT} y={lane.titleY}>
                        <tspan style={{ fill: color }}>●</tspan>
                        <tspan dx={6}>{t(spec.label)}</tspan>
                        <tspan dx={6} className="is-unit">{spec.unit}</tspan>
                      </text>
                    </>
                  ) : null}
                  {lane.fill ? <path className="activity-channels-area" d={lane.fill} style={{ fill: color }} /> : null}
                  <path className={`activity-channels-line${lane.area ? " is-area" : ""}`} d={lane.path} style={{ stroke: color }} />
                  {lane.axis !== "none"
                    ? lane.ticks.map((tick) => (
                        <text
                          key={`tick-${tick}`}
                          className="activity-channels-tick"
                          x={lane.axis === "left" ? LEFT - 8 : LEFT + plotWidth + 8}
                          y={laneY(lane, spec.inverted, tick)}
                          dy="0.35em"
                          textAnchor={lane.axis === "left" ? "end" : "start"}
                          style={shownLayout === "stacked" ? undefined : { fill: color }}
                        >
                          {spec.format(tick)}
                        </text>
                      ))
                    : null}
                  {shownLayout === "overlay" && lane.axis !== "none" ? (
                    <text
                      className="activity-channels-axis-unit"
                      x={lane.axis === "left" ? LEFT - 8 : LEFT + plotWidth + 8}
                      y={plotTop - 6}
                      textAnchor={lane.axis === "left" ? "end" : "start"}
                      style={{ fill: color }}
                    >
                      {spec.unit}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {selectionBox ? (
              <rect className="activity-channels-selection" x={selectionBox.start} y={plotTop} width={Math.max(1, selectionBox.end - selectionBox.start)} height={plotBottom - plotTop} />
            ) : null}

            {laps.slice(1).map(({ lap, start }) => (
              <line key={`divider-${lap.index}`} className="activity-channels-lap-divider" x1={start} x2={start} y1={plotTop} y2={plotBottom} />
            ))}
            {hasLaps
              ? laps.map(({ lap, start, end }) =>
                  end - start >= 18 ? (
                    <g
                      key={`lap-label-${lap.index}`}
                      className={`activity-channels-lap-label is-${lap.kind}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => setSelection([lap.from, lap.to])}
                    >
                      <title>{t("{{p0}} {{p1}} · {{p2}}{{p3}} — click to select", { p0: String(t(streams.structured ? LAP_KIND_LABELS[lap.kind] : "Lap")), p1: String(lap.index), p2: String(formatDurationSeconds(streams.t[lap.to]! - streams.t[lap.from]!)), p3: String(streams.hasDistance ? ` · ${formatDistance(streams.d[lap.to]! - streams.d[lap.from]!)}` : "") })}</title>
                      <rect x={start} y={0} width={end - start} height={LAP_STRIP - 2} />
                      <text x={(start + end) / 2} y={LAP_STRIP / 2} dy="0.3em" textAnchor="middle">
                        {lap.index}
                      </text>
                    </g>
                  ) : null
                )
              : null}

            {pauses.map((pause) => (
              <g key={`pause-${pause.index}`} className="activity-channels-pause" transform={`translate(${pause.x} ${plotBottom - 9})`}>
                <title>{t("Paused {{p0}}", { p0: String(formatDurationSeconds(pause.seconds)) })}</title>
                <rect x={-3.5} y={0} width={2} height={7} rx={1} />
                <rect x={1.5} y={0} width={2} height={7} rx={1} />
              </g>
            ))}

            <line className="activity-channels-axis-line" x1={LEFT} x2={LEFT + plotWidth} y1={plotBottom} y2={plotBottom} />
            {xTicks.map((tick) =>
              tick.x >= x0 && tick.x <= x1 && (hoverX === null || Math.abs(sx(tick.x) - hoverX) > 46) ? (
                <text key={`x-${tick.x}`} className="activity-channels-tick" x={sx(tick.x)} y={plotBottom + 18} textAnchor="middle">
                  {tick.label}
                </text>
              ) : null
            )}

            {hoverX !== null && hover !== null ? (
              <g className="activity-channels-cursor">
                <line x1={hoverX} x2={hoverX} y1={plotTop} y2={plotBottom} />
                {lanes.map((lane) => {
                  const value = display[lane.key]![hover]!;
                  return Number.isFinite(value) ? (
                    <circle key={`${lane.key}-${lane.plot ?? 0}`} cx={hoverX} cy={laneY(lane, specs[lane.key].inverted, value)} r={4} style={{ fill: colors[lane.key] }} />
                  ) : null;
                })}
                <g transform={`translate(${Math.min(LEFT + plotWidth - 28, Math.max(LEFT + 28, hoverX))} ${plotBottom + 14})`}>
                  <rect x={-28} y={-10} width={56} height={20} rx={10} />
                  <text dy="0.35em" textAnchor="middle">
                    {axis === "time"
                      ? formatDurationSeconds(streams.t[hover])
                      : trimNumber(metersToDisplayDistance(streams.d[hover]!, unitSystem), 2)}
                  </text>
                </g>
              </g>
            ) : null}
          </svg>
        ) : null}
      </div>

      {selected.length > 0 && width > 0 && last > MIN_VIEW_SAMPLES * 2 ? (
        <ChannelNavigator
          xs={xs}
          values={display.elevation ?? display.hr ?? display[selected[0]!]!}
          inverted={!display.elevation && !display.hr && specs[selected[0]!].inverted}
          width={width}
          plotWidth={plotWidth}
          view={view}
          last={last}
          onViewChange={setView}
        />
      ) : null}

      <div className="activity-channels-footer">
        {streams.structured ? (
          <span className="activity-channels-legend">
            {(["warmup", "work", "recovery", "cooldown"] as const)
              .filter((kind) => streams.laps.some((lap) => lap.kind === kind))
              .map((kind) => (
                <span key={kind} className={`is-${kind}`}>
                  <i aria-hidden="true" />
                  {t(LAP_KIND_LABELS[kind])}
                </span>
              ))}
          </span>
        ) : hasLaps ? (
          <span className="activity-channels-legend">{t("Click a lap number to select it")}</span>
        ) : (
          <span />
        )}
        <span className="activity-channels-hint">{t("Drag across the chart to measure a stretch · pinch or drag the handles to zoom · double-click to reset")}</span>
      </div>
    </section>
  );
}

interface ChannelNavigatorProps {
  xs: Float64Array;
  values: Float64Array;
  inverted: boolean;
  width: number;
  plotWidth: number;
  view: [number, number];
  last: number;
  onViewChange: (view: [number, number]) => void;
}

type NavigatorDrag = { mode: "start" | "end" | "pan"; pointerId: number; anchor: number; view: [number, number] };

/** Whole-activity silhouette with a draggable window that sets the chart's zoom. */
function ChannelNavigator({ xs, values, inverted, width, plotWidth, view, last, onViewChange }: ChannelNavigatorProps) {
  useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<NavigatorDrag | null>(null);
  const first = xs[0]!;
  const span = xs[last]! - first || 1;
  const sx = (x: number) => LEFT + ((x - first) / span) * plotWidth;
  const silhouette = useMemo(() => {
    const extent = robustExtent(values, 0, last, 0, 1);
    if (!extent) return "";
    const [low, high] = extent[1] - extent[0] < 1e-6 ? [extent[0] - 1, extent[1] + 1] : extent;
    const top = 6;
    const bottom = NAVIGATOR_HEIGHT - 2;
    const scaleX = (x: number) => LEFT + ((x - first) / span) * plotWidth;
    const scaleY = (value: number) => {
      const ratio = inverted ? (value - low) / (high - low) : (high - value) / (high - low);
      return top + Math.min(1, Math.max(0, ratio)) * (bottom - top);
    };
    return areaPath(lineSegments(xs, values, 0, last, scaleX, scaleY, plotWidth), bottom);
  }, [values, last, xs, first, span, plotWidth, inverted]);

  const indexAt = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = Math.min(LEFT + plotWidth, Math.max(LEFT, clientX - rect.left));
    return nearestIndex(xs, first + ((x - LEFT) / plotWidth) * span, 0, last);
  };
  const windowStart = sx(xs[view[0]]!);
  const windowEnd = sx(xs[view[1]]!);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const index = indexAt(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (Math.abs(x - windowStart) <= 8) {
      dragRef.current = { mode: "start", pointerId: event.pointerId, anchor: index, view };
    } else if (Math.abs(x - windowEnd) <= 8) {
      dragRef.current = { mode: "end", pointerId: event.pointerId, anchor: index, view };
    } else {
      let next = view;
      if (x < windowStart || x > windowEnd) {
        // Jump: centre the window on the click, keeping its width.
        const width = view[1] - view[0];
        const start = Math.min(last - width, Math.max(0, index - Math.round(width / 2)));
        next = [start, start + width];
        onViewChange(next);
      }
      dragRef.current = { mode: "pan", pointerId: event.pointerId, anchor: index, view: next };
    }
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const index = indexAt(event.clientX);
    const [start, end] = drag.view;
    if (drag.mode === "start") {
      onViewChange([Math.max(0, Math.min(index, end - MIN_VIEW_SAMPLES)), end]);
    } else if (drag.mode === "end") {
      onViewChange([start, Math.min(last, Math.max(index, start + MIN_VIEW_SAMPLES))]);
    } else {
      const width = end - start;
      const next = Math.min(last - width, Math.max(0, start + index - drag.anchor));
      onViewChange([next, next + width]);
    }
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const full = view[0] === 0 && view[1] === last;

  return (
    <div className="activity-channels-navigator">
      <svg
        ref={svgRef}
        width={width}
        height={NAVIGATOR_HEIGHT}
        viewBox={`0 0 ${width} ${NAVIGATOR_HEIGHT}`}
        role="img"
        aria-label={t("Zoom window. Drag the handles to zoom, drag the window to pan.")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => onViewChange([0, last])}
      >
        <rect className="activity-channels-navigator-bed" x={LEFT} y={0} width={plotWidth} height={NAVIGATOR_HEIGHT} rx={8} />
        <path className="activity-channels-navigator-area" d={silhouette} />
        {!full ? (
          <>
            <rect className="activity-channels-navigator-shade" x={LEFT} y={0} width={Math.max(0, windowStart - LEFT)} height={NAVIGATOR_HEIGHT} />
            <rect className="activity-channels-navigator-shade" x={windowEnd} y={0} width={Math.max(0, LEFT + plotWidth - windowEnd)} height={NAVIGATOR_HEIGHT} />
          </>
        ) : null}
        <rect className="activity-channels-navigator-window" x={windowStart} y={0.5} width={Math.max(2, windowEnd - windowStart)} height={NAVIGATOR_HEIGHT - 1} rx={8} />
        {[windowStart, windowEnd].map((x, position) => (
          <rect key={position} className="activity-channels-navigator-handle" x={x - 3} y={NAVIGATOR_HEIGHT / 2 - 9} width={6} height={18} rx={3} />
        ))}
      </svg>
    </div>
  );
}
