import { t } from "../i18n/toolsLocale";
import type { UnitSystem } from "../../electron/types";

export interface OverviewWeatherSnapshot {
  fetchedAt: number;
  lat: number;
  lon: number;
  /** Nearest locality, when reverse geocoding succeeded. */
  place?: string;
  temperatureC: number;
  apparentTemperatureC: number;
  highC: number;
  lowC: number;
  humidityPercent: number;
  windKmh: number;
  /** WMO weather interpretation code as reported by Open-Meteo. */
  weatherCode: number;
  isDay: boolean;
}

export type OverviewWeatherKind =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export const OVERVIEW_WEATHER_STORAGE_KEY = "coroslink.overviewWeather";
export const OVERVIEW_WEATHER_MAX_AGE_MS = 30 * 60 * 1000;

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const REVERSE_GEOCODE_ENDPOINT =
  "https://api.bigdatacloud.net/data/reverse-geocode-client";

const LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 8_000,
  maximumAge: 10 * 60 * 1000
};

export function describeWeatherCode(code: number): {
  kind: OverviewWeatherKind;
  label: string;
} {
  if (code === 0) return { kind: "clear", label: t("Clear skies") };
  if (code === 1) return { kind: "clear", label: t("Mostly clear") };
  if (code === 2) return { kind: "partly-cloudy", label: t("Partly cloudy") };
  if (code === 3) return { kind: "cloudy", label: t("Overcast") };
  if (code === 45 || code === 48) return { kind: "fog", label: t("Fog") };
  if (code >= 51 && code <= 57) return { kind: "drizzle", label: t("Drizzle") };
  if (code >= 61 && code <= 67) {
    return { kind: "rain", label: code >= 66 ? t("Freezing rain") : t("Rain") };
  }
  if (code >= 71 && code <= 77) return { kind: "snow", label: t("Snow") };
  if (code >= 80 && code <= 82) return { kind: "rain", label: t("Showers") };
  if (code === 85 || code === 86) return { kind: "snow", label: t("Snow showers") };
  if (code >= 95) return { kind: "thunder", label: t("Thunderstorm") };
  return { kind: "cloudy", label: t("Cloudy") };
}

export function formatTemperature(
  celsius: number,
  unitSystem: UnitSystem
): string {
  const value =
    unitSystem === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}

export function temperatureUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === "imperial" ? "°F" : "°C";
}

export function formatWindSpeed(
  kmh: number,
  unitSystem: UnitSystem
): string {
  return unitSystem === "imperial"
    ? t("{{p0}} mph", { p0: Math.round(kmh / 1.609344) })
    : t("{{p0}} km/h", { p0: Math.round(kmh) });
}

export function readCachedOverviewWeather(): OverviewWeatherSnapshot | null {
  try {
    const raw = window.localStorage.getItem(OVERVIEW_WEATHER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OverviewWeatherSnapshot>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.temperatureC !== "number" ||
      typeof parsed.weatherCode !== "number"
    ) {
      return null;
    }
    return parsed as OverviewWeatherSnapshot;
  } catch {
    return null;
  }
}

/** The watch gets its forecast for the same place (sent on each connection; see electron/watchWeatherService.ts). */
export function shareWeatherLocationWithWatch(snapshot: Pick<OverviewWeatherSnapshot, "lat" | "lon" | "place"> | null): void {
  if (!snapshot || !Number.isFinite(snapshot.lat) || !Number.isFinite(snapshot.lon)) return;
  void window.corosLink?.setWatchWeatherLocation?.({ latitude: snapshot.lat, longitude: snapshot.lon, place: snapshot.place })
    .catch(() => undefined);
}

function storeOverviewWeather(snapshot: OverviewWeatherSnapshot): void {
  shareWeatherLocationWithWatch(snapshot);
  try {
    window.localStorage.setItem(
      OVERVIEW_WEATHER_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // localStorage can be unavailable in restricted renderer environments.
  }
}

export function isOverviewWeatherFresh(
  snapshot: OverviewWeatherSnapshot | null,
  now = Date.now()
): snapshot is OverviewWeatherSnapshot {
  return (
    snapshot !== null && now - snapshot.fetchedAt < OVERVIEW_WEATHER_MAX_AGE_MS
  );
}

interface ResolvedPosition {
  lat: number;
  lon: number;
  /** Locality when the position came with one (IP lookup), else undefined. */
  place?: string;
}

class DeviceLocationError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

function requestDevicePosition(): Promise<ResolvedPosition> {
  const geolocation =
    typeof navigator === "undefined" ? undefined : navigator.geolocation;
  if (!geolocation) {
    return Promise.reject(new DeviceLocationError(t("Location services are not available."), 2));
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(new DeviceLocationError(t("Location services returned invalid coordinates."), 2));
          return;
        }
        resolve({ lat: latitude, lon: longitude });
      },
      (error) => reject(new DeviceLocationError(describeLocationError(error), error.code)),
      LOCATION_OPTIONS
    );
  });
}

function describeLocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case 1:
      return t("Allow CorosLink in System Settings › Privacy & Security › Location Services to see local weather.");
    case 2:
      return t("Your device could not determine a location.");
    case 3:
      return t("Location request timed out.");
    default:
      return t("Could not get your current location.");
  }
}

/**
 * Coarse position from the caller's IP. Electron's Chromium resolves precise
 * positions through Google's network-location API, which needs an API key the
 * app does not ship, so on many machines `getCurrentPosition` only ever times
 * out. City-level accuracy is plenty for local weather.
 */
async function requestIpPosition(signal: AbortSignal): Promise<ResolvedPosition> {
  const url = new URL(REVERSE_GEOCODE_ENDPOINT);
  url.searchParams.set("localityLanguage", "en");
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(t("Location lookup responded with {{p0}}.", { p0: response.status }));
  }
  const payload = (await response.json()) as {
    latitude?: number;
    longitude?: number;
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  if (
    typeof payload.latitude !== "number" ||
    typeof payload.longitude !== "number" ||
    !Number.isFinite(payload.latitude) ||
    !Number.isFinite(payload.longitude)
  ) {
    throw new Error(t("Location lookup returned no position."));
  }
  return {
    lat: payload.latitude,
    lon: payload.longitude,
    place:
      payload.city || payload.locality || payload.principalSubdivision || undefined
  };
}

async function requestPosition(signal: AbortSignal): Promise<ResolvedPosition> {
  try {
    return await requestDevicePosition();
  } catch (deviceError) {
    if (!(deviceError instanceof DeviceLocationError) || ![2, 3].includes(deviceError.code)) {
      throw deviceError;
    }
    try {
      return await requestIpPosition(signal);
    } catch {
      throw deviceError;
    }
  }
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    is_day?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

async function fetchForecast(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<Omit<OverviewWeatherSnapshot, "fetchedAt" | "lat" | "lon" | "place">> {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day"
  );
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(t("Weather service responded with {{p0}}.", { p0: response.status }));
  }
  const payload = (await response.json()) as OpenMeteoResponse;
  const current = payload.current;
  if (
    !current ||
    typeof current.temperature_2m !== "number" ||
    typeof current.weather_code !== "number"
  ) {
    throw new Error(t("Weather service returned an incomplete forecast."));
  }
  const high = payload.daily?.temperature_2m_max?.[0];
  const low = payload.daily?.temperature_2m_min?.[0];
  return {
    temperatureC: current.temperature_2m,
    apparentTemperatureC:
      current.apparent_temperature ?? current.temperature_2m,
    highC: typeof high === "number" ? high : current.temperature_2m,
    lowC: typeof low === "number" ? low : current.temperature_2m,
    humidityPercent: current.relative_humidity_2m ?? 0,
    windKmh: current.wind_speed_10m ?? 0,
    weatherCode: current.weather_code,
    isDay: current.is_day !== 0
  };
}

async function fetchPlaceName(
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<string | undefined> {
  try {
    const url = new URL(REVERSE_GEOCODE_ENDPOINT);
    url.searchParams.set("latitude", lat.toFixed(4));
    url.searchParams.set("longitude", lon.toFixed(4));
    url.searchParams.set("localityLanguage", "en");
    const response = await fetch(url, { signal });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
    };
    const name = payload.city || payload.locality;
    return name ? name : payload.principalSubdivision || undefined;
  } catch {
    // The place label is decorative; the forecast still renders without it.
    return undefined;
  }
}

/**
 * Resolves the device position, then loads the current conditions from
 * Open-Meteo. A fresh cached snapshot is returned without any network work.
 */
export async function loadOverviewWeather(
  signal: AbortSignal,
  options: { force?: boolean } = {}
): Promise<OverviewWeatherSnapshot> {
  // A place chosen in Settings wins over the system or IP location (which a VPN moves).
  const chosen = await window.corosLink?.getWeatherLocation?.().catch(() => null);
  const chosenPosition: ResolvedPosition | undefined = chosen?.source === "chosen"
    ? { lat: chosen.latitude, lon: chosen.longitude, place: chosen.place } : undefined;
  const cached = readCachedOverviewWeather();
  const cachedHere = !chosenPosition || (cached && Math.abs(cached.lat - chosenPosition.lat) < 0.01 && Math.abs(cached.lon - chosenPosition.lon) < 0.01);
  if (!options.force && cachedHere && isOverviewWeatherFresh(cached)) {
    return cached;
  }

  const position = chosenPosition ?? await requestPosition(signal);
  const { lat, lon } = position;
  const [forecast, place] = await Promise.all([
    fetchForecast(lat, lon, signal),
    position.place ? Promise.resolve(position.place) : fetchPlaceName(lat, lon, signal)
  ]);
  const snapshot: OverviewWeatherSnapshot = {
    fetchedAt: Date.now(),
    lat,
    lon,
    place: place ?? (cachedHere ? cached?.place : undefined),
    ...forecast
  };
  storeOverviewWeather(snapshot);
  return snapshot;
}
