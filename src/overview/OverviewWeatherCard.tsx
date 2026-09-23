import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  MapPin,
  Moon,
  RefreshCw,
  Sun,
  Wind
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  describeWeatherCode,
  formatTemperature,
  formatWindSpeed,
  isOverviewWeatherFresh,
  loadOverviewWeather,
  OVERVIEW_WEATHER_MAX_AGE_MS,
  readCachedOverviewWeather,
  temperatureUnitLabel,
  type OverviewWeatherKind,
  type OverviewWeatherSnapshot
} from "./overviewWeather";
import "./overviewWeather.css";

function WeatherGlyph({
  kind,
  isDay
}: {
  kind: OverviewWeatherKind;
  isDay: boolean;
}) {
  const props = { size: 30, strokeWidth: 1.6, "aria-hidden": true } as const;
  switch (kind) {
    case "clear":
      return isDay ? <Sun {...props} /> : <Moon {...props} />;
    case "partly-cloudy":
      return isDay ? <CloudSun {...props} /> : <CloudMoon {...props} />;
    case "fog":
      return <CloudFog {...props} />;
    case "drizzle":
      return <CloudDrizzle {...props} />;
    case "rain":
      return <CloudRain {...props} />;
    case "snow":
      return <CloudSnow {...props} />;
    case "thunder":
      return <CloudLightning {...props} />;
    case "cloudy":
    default:
      return <Cloud {...props} />;
  }
}

export function OverviewWeatherCard() {
  const { unitSystem } = useUnitSystem();
  const [snapshot, setSnapshot] = useState<OverviewWeatherSnapshot | null>(
    readCachedOverviewWeather
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback((force: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    loadOverviewWeather(controller.signal, { force })
      .then((next) => {
        if (controller.signal.aborted) return;
        setSnapshot(next);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Weather is unavailable."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    refresh(false);
    const interval = window.setInterval(
      () => refresh(true),
      OVERVIEW_WEATHER_MAX_AGE_MS
    );
    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [refresh]);

  if (!snapshot) {
    return (
      <div
        className={[
          "overview-weather",
          "overview-weather--empty",
          loading && "overview-weather--loading"
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
      >
        <Cloud size={18} strokeWidth={1.6} aria-hidden="true" />
        <div className="overview-weather-empty-copy">
          <span>{loading ? "Finding local weather…" : "Weather unavailable"}</span>
          {error && !loading ? (
            <span className="overview-weather-error">{error}</span>
          ) : null}
        </div>
        {!loading ? (
          <button
            type="button"
            className="overview-weather-refresh"
            onClick={() => refresh(true)}
            aria-label="Retry loading weather"
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  const condition = describeWeatherCode(snapshot.weatherCode);
  const stale = !isOverviewWeatherFresh(snapshot);
  const title = [
    `Feels like ${formatTemperature(snapshot.apparentTemperatureC, unitSystem)}`,
    `Humidity ${Math.round(snapshot.humidityPercent)}%`,
    `Wind ${formatWindSpeed(snapshot.windKmh, unitSystem)}`,
    error ?? (stale ? "Showing the last forecast — refresh to update." : null)
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={[
        "overview-weather",
        `overview-weather--${condition.kind}`,
        !snapshot.isDay && "overview-weather--night",
        loading && "overview-weather--loading"
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
    >
      <div className="overview-weather-glyph">
        <WeatherGlyph kind={condition.kind} isDay={snapshot.isDay} />
      </div>
      <div className="overview-weather-main">
        <div className="overview-weather-temp">
          {formatTemperature(snapshot.temperatureC, unitSystem)}
          <span className="overview-weather-unit">
            {temperatureUnitLabel(unitSystem).slice(1)}
          </span>
        </div>
        <div className="overview-weather-condition">{condition.label}</div>
      </div>
      <div className="overview-weather-meta">
        <div className="overview-weather-range">
          <span>H {formatTemperature(snapshot.highC, unitSystem)}</span>
          <span>L {formatTemperature(snapshot.lowC, unitSystem)}</span>
        </div>
        <div className="overview-weather-details">
          <span>
            <Wind size={12} aria-hidden="true" />
            {formatWindSpeed(snapshot.windKmh, unitSystem)}
          </span>
          <span>
            <Droplets size={12} aria-hidden="true" />
            {Math.round(snapshot.humidityPercent)}%
          </span>
        </div>
        {snapshot.place ? (
          <div className="overview-weather-place">
            <MapPin size={11} aria-hidden="true" />
            {snapshot.place}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="overview-weather-refresh"
        onClick={() => refresh(true)}
        disabled={loading}
        aria-label="Refresh weather"
      >
        <RefreshCw size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
