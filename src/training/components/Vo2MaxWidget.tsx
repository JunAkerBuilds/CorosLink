import { useLanguage, t } from "../../i18n/training";
import { useEffect, useState } from "react";
import { Activity, Bike } from "lucide-react";
import type { TrainingHubDailyMetric } from "../../../electron/types";
import { formatHappenDayLabel, formatSignedDelta } from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import type { TrainingHubSnapshot } from "../types";

type Vo2Sport = "run" | "ride";

const VO2_SPORT_FIELD: Record<Vo2Sport, "vo2max" | "cycleVo2max"> = {
  run: "vo2max",
  ride: "cycleVo2max"
};

interface Vo2MaxWidgetProps {
  snapshot: TrainingHubSnapshot | null;
  /** Local-Only Mode: the figure is the one the watch stored with its activities. */
  local?: boolean;
}

interface Vo2Reading {
  happenDay: string;
  value: number;
}

interface Vo2Band {
  min: number;
  max: number;
  color: string;
}

const VO2_MIN = 20;
const VO2_MAX = 60;
const VO2_CENTER_X = 120;
const VO2_CENTER_Y = 118;
const VO2_RADIUS = 84;

const VO2_BANDS: Vo2Band[] = [
  { min: 20, max: 30, color: "#ff4f5f" },
  { min: 30, max: 35, color: "#ffb23f" },
  { min: 35, max: 45, color: "#3ee88e" },
  { min: 45, max: 60, color: "#4aa3ff" }
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function valueToAngle(value: number): number {
  const percent = (clamp(value, VO2_MIN, VO2_MAX) - VO2_MIN) / (VO2_MAX - VO2_MIN);
  return 180 - percent * 180;
}

function pointOnArc(value: number, radius = VO2_RADIUS) {
  const angle = (valueToAngle(value) * Math.PI) / 180;

  return {
    x: VO2_CENTER_X + radius * Math.cos(angle),
    y: VO2_CENTER_Y - radius * Math.sin(angle)
  };
}

function describeArc(min: number, max: number): string {
  const start = pointOnArc(min);
  const end = pointOnArc(max);

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${VO2_RADIUS} ${VO2_RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  ].join(" ");
}

function vo2Status(value?: number): { label: string; tone: string } {
  if (value === undefined) {
    return { label: "Waiting", tone: "neutral" };
  }

  if (value < 30) {
    return { label: "Base", tone: "low" };
  }

  if (value < 35) {
    return { label: "Building", tone: "mid" };
  }

  if (value < 45) {
    return { label: "Strong", tone: "good" };
  }

  return { label: "Peak", tone: "high" };
}

function isFocusedBand(value: number | undefined, band: Vo2Band): boolean {
  if (value === undefined) {
    return false;
  }

  const clampedValue = clamp(value, VO2_MIN, VO2_MAX);
  return (
    clampedValue >= band.min &&
    (clampedValue < band.max || (band.max === VO2_MAX && clampedValue === band.max))
  );
}

function latestVo2Readings(days: TrainingHubDailyMetric[], sport: Vo2Sport): Vo2Reading[] {
  const field = VO2_SPORT_FIELD[sport];
  return days
    .map((day) => ({
      happenDay: day.happenDay,
      value: day[field]
    }))
    .filter(
      (reading): reading is Vo2Reading =>
        Number.isFinite(reading.value) && reading.value !== undefined
    );
}

export function Vo2MaxWidget({ snapshot, local = false }: Vo2MaxWidgetProps) {
  useLanguage();
  const [isReady, setIsReady] = useState(false);
  const [pickedSport, setPickedSport] = useState<Vo2Sport>("run");
  const days = mergeTrainingDayLists(
    snapshot?.dailyMetrics ?? null,
    snapshot?.analytics ?? null
  );
  const runReadings = latestVo2Readings(days, "run");
  const rideReadings = latestVo2Readings(days, "ride");
  // The switch appears once COROS has a cycling estimate; an athlete who only
  // rides opens on it.
  const sport: Vo2Sport =
    rideReadings.length === 0 ? "run" : runReadings.length === 0 ? "ride" : pickedSport;
  const readings = sport === "ride" ? rideReadings : runReadings;
  const showSwitch = runReadings.length > 0 && rideReadings.length > 0;
  const latest = readings.at(-1);
  const previous = readings.at(-2);
  const value = latest?.value;
  const displayValue = value;
  const needle = pointOnArc(displayValue ?? VO2_MIN, VO2_RADIUS - 18);
  const status = vo2Status(displayValue);
  const delta =
    value !== undefined && previous?.value !== undefined
      ? value - previous.value
      : undefined;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsReady(true));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className={`panel vo2-widget-panel tone-${status.tone}${isReady ? " is-ready" : ""}`}
    >
      <div className="vo2-widget-header">
        <div>
          <p className="eyebrow">VO2 Max</p>
          <h2>{sport === "ride" ? t("Cycling engine") : t("Running engine")}</h2>
          {local ? <p className="card-source-note">{t("From your watch")}</p> : null}
        </div>
        {showSwitch ? (
          <div className="library-filter-group vo2-sport-switch" role="group" aria-label={t("VO2 max sport")}>
            {(["run", "ride"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`library-filter-option${sport === option ? " active" : ""}`}
                aria-pressed={sport === option}
                title={option === "run" ? t("Running VO2 max") : t("Cycling VO2 max")}
                onClick={() => setPickedSport(option)}
              >
                {option === "run" ? <Activity size={13} aria-hidden="true" /> : <Bike size={13} aria-hidden="true" />}
                {option === "run" ? t("Run") : t("Ride")}
              </button>
            ))}
          </div>
        ) : (
          <span className="vo2-widget-icon" aria-hidden="true">
            {sport === "ride" ? <Bike size={16} /> : <Activity size={16} />}
          </span>
        )}
      </div>

      <div className="vo2-gauge" aria-label={t("VO2 max gauge")}>
        <svg viewBox="0 0 240 144" aria-hidden="true">
          <path
            className="vo2-gauge-track"
            d={describeArc(VO2_MIN, VO2_MAX)}
          />
          {VO2_BANDS.map((band) => {
            const isFocused = isFocusedBand(displayValue, band);

            return (
              <path
                key={`${band.min}-${band.max}`}
                className={`vo2-gauge-band${isFocused ? " is-focused" : ""}`}
                d={describeArc(band.min, band.max)}
                pathLength={100}
                stroke={band.color}
              />
            );
          })}
          {/* No figure yet: no needle, which would read as the scale's minimum. */}
          {displayValue !== undefined ? <>
            <line
              className="vo2-gauge-needle"
              x1={VO2_CENTER_X}
              y1={VO2_CENTER_Y}
              x2={needle.x}
              y2={needle.y}
            />
            <circle
              className="vo2-gauge-pin"
              cx={VO2_CENTER_X}
              cy={VO2_CENTER_Y}
              r="5"
            />
          </> : null}
        </svg>

        <div className={`vo2-gauge-value${displayValue !== undefined ? " has-value" : ""}`}>
          <strong>{displayValue !== undefined ? Math.round(displayValue) : "-"}</strong>
        </div>
      </div>

      <div className="vo2-widget-footer">
        <div>
          <span>{t("Level")}</span>
          <strong>{t(status.label)}</strong>
        </div>
        <div>
          <span>{t("Change", undefined, "delta")}</span>
          <strong>{formatSignedDelta(delta)}</strong>
        </div>
        <div>
          <span>{t("Updated")}</span>
          <strong>
            {latest ? formatHappenDayLabel(latest.happenDay) : "-"}
          </strong>
        </div>
      </div>
    </section>
  );
}
