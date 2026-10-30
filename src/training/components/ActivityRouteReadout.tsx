import { formatNumber, t, useLanguage } from "../../i18n/training";
import { Gauge, Heart, Mountain, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import type { TrainingHubActivityTrack, UnitSystem } from "../../../electron/types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  kmhToDisplaySpeed,
  metersToDisplayDistance,
  metersToElevation,
  secondsPerKmToDisplayPace,
  speedUnit
} from "../../units/units";
import type { ActivityStreams, StreamChannelKey } from "../activityStreams";
import { formatDurationSeconds } from "../formatters";

/**
 * Without per-second samples (imports, older syncs) the route's own track
 * still knows where and how high each point is: enough for distance and
 * elevation on hover.
 */
export function trackRouteProbe(track: TrainingHubActivityTrack | undefined): ActivityStreams | null {
  const points = (track?.points ?? []).filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)
  );
  if (points.length < 2) return null;
  const length = points.length;
  const d = new Float64Array(length);
  const elevation = new Float64Array(length);
  let hasDistance = false;
  for (let index = 0; index < length; index += 1) {
    const distance = points[index]!.distance;
    d[index] = distance !== undefined && Number.isFinite(distance) ? distance : Number.NaN;
    if (distance) hasDistance = true;
    elevation[index] = points[index]!.elevation ?? Number.NaN;
  }
  return {
    length,
    t: new Float64Array(length).fill(Number.NaN),
    d,
    lat: Float64Array.from(points, (point) => point.lat!),
    lon: Float64Array.from(points, (point) => point.lon!),
    channels: { elevation },
    speedKind: "pace",
    hasDistance,
    hasGps: true,
    structured: false,
    laps: [],
    pauses: [],
    zones: {}
  };
}

/** Samples either side averaged into a reading: per-second pace and power jump around. */
const WINDOW = 5;

function windowMean(values: Float64Array | undefined, index: number): number | undefined {
  if (!values) return undefined;
  let sum = 0;
  let count = 0;
  for (let at = Math.max(0, index - WINDOW); at <= Math.min(values.length - 1, index + WINDOW); at += 1) {
    const value = values[at]!;
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : undefined;
}

function clock(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

interface ReadoutRow {
  key: StreamChannelKey;
  label: string;
  value: string;
  unit: string;
  icon: typeof Heart;
  tone: string;
}

function readoutRows(streams: ActivityStreams, index: number, unitSystem: UnitSystem): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  const pace = windowMean(streams.channels.pace, index);
  if (pace !== undefined && pace > 0) {
    if (streams.speedKind === "speed") {
      rows.push({ key: "pace", label: t("Speed"), value: formatNumber(kmhToDisplaySpeed(pace, unitSystem), { maximumFractionDigits: 1 }),
        unit: speedUnit(unitSystem), icon: Gauge, tone: "#57dce9" });
    } else if (streams.speedKind === "swimPace") {
      const imperial = unitSystem === "imperial";
      rows.push({ key: "pace", label: t("Pace"), value: clock(imperial ? pace * 0.9144 : pace),
        unit: imperial ? "/100yd" : "/100m", icon: Gauge, tone: "#57dce9" });
    } else {
      rows.push({ key: "pace", label: t("Pace"), value: clock(secondsPerKmToDisplayPace(pace, unitSystem)),
        unit: `/${distanceUnit(unitSystem)}`, icon: Gauge, tone: "#57dce9" });
    }
  }
  const hr = windowMean(streams.channels.hr, index);
  if (hr !== undefined && hr > 0) {
    rows.push({ key: "hr", label: t("Heart rate"), value: String(Math.round(hr)), unit: "bpm", icon: Heart, tone: "#ff7288" });
  }
  const power = windowMean(streams.channels.power, index);
  if (power !== undefined && power > 0) {
    rows.push({ key: "power", label: t("Power"), value: String(Math.round(power)), unit: "W", icon: Zap, tone: "#f5d34e" });
  }
  const elevation = streams.channels.elevation?.[index];
  if (elevation !== undefined && Number.isFinite(elevation)) {
    rows.push({ key: "elevation", label: t("Elevation"), value: String(Math.round(metersToElevation(elevation, unitSystem))),
      unit: elevationUnit(unitSystem), icon: Mountain, tone: "#5ce5a2" });
  }
  return rows;
}

/** Card that follows the route under the pointer: where you were and how it felt there. */
export function ActivityRouteReadout({ streams, index, x, y, width }: {
  streams: ActivityStreams;
  index: number;
  /** Snapped point in the map container's pixels, and the container's width. */
  x: number;
  y: number;
  width: number;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const rows = readoutRows(streams, index, unitSystem);
  const distance = streams.hasDistance ? streams.d[index] : undefined;
  const seconds = streams.t[index];
  // Sits above the point; flips under it near the top edge and stays inside the map sideways.
  const below = y < 150;
  const half = 92;
  const left = Math.min(Math.max(x, half + 8), Math.max(half + 8, width - half - 8));
  return (
    <div
      className={`activity-route-readout${below ? " is-below" : ""}`}
      style={{ left, top: y, "--readout-shift": `${x - left}px` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="activity-route-readout-head">
        {distance !== undefined && Number.isFinite(distance) ? (
          <strong>
            {formatNumber(metersToDisplayDistance(distance, unitSystem), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <small>{distanceUnit(unitSystem)}</small>
          </strong>
        ) : null}
        {seconds !== undefined && Number.isFinite(seconds) ? <span>{formatDurationSeconds(seconds)}</span> : null}
      </div>
      {rows.length ? (
        <dl>
          {rows.map(({ key, label, value, unit, icon: Icon, tone }) => (
            <div key={key} style={{ "--readout-tone": tone } as CSSProperties}>
              <dt><Icon size={12} strokeWidth={2.4} />{label}</dt>
              <dd>{value}<small>{unit}</small></dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
