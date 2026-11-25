/**
 * Weather during an activity from Open-Meteo (https://open-meteo.com): the request for the start of the route
 * and the hourly answer read at the start and finish times. Pure: no fetching here.
 */
import type { Weather } from "@/data/activities";

const HOURLY = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code"] as const;

/** Days back the forecast API still holds; older days come from the archive. */
const FORECAST_DAYS_BACK = 85;

/**
 * The address to ask. `start` is the local start, YYYY-MM-DDTHH:MM; the answer comes in the place's own time.
 * Latitude and longitude are cut to two decimals (about a kilometre), enough for weather.
 */
export function weatherUrl(lat: number, lon: number, start: string, finish: string, now: Date): string {
  const day = start.slice(0, 10), endDay = finish.slice(0, 10);
  const ageDays = (now.getTime() - Date.parse(`${day}T12:00:00Z`)) / 86_400_000;
  const base = ageDays > FORECAST_DAYS_BACK ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const q = new URLSearchParams({
    latitude: lat.toFixed(2), longitude: lon.toFixed(2), start_date: day, end_date: endDay,
    hourly: HOURLY.join(","), timezone: "auto", wind_speed_unit: "kmh",
  });
  return `${base}?${q}`;
}

/** Minutes after midnight of a local time, plus 1440 per day after `day`. */
function minutesFrom(day: string, local: string): number {
  const days = Math.round((Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return days * 1440 + Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}

/** Adds minutes to a local time written YYYY-MM-DDTHH:MM. */
export function addMinutes(local: string, minutes: number): string {
  const d = new Date(Date.parse(`${local}:00Z`) + Math.round(minutes) * 60_000);
  return d.toISOString().slice(0, 16);
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** WMO weather code in words. */
export function sky(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 95) return "Thunderstorm";
  return "";
}

interface Hourly { time?: string[]; [key: string]: unknown }

/** The hourly answer read at the start (linear between hours) and the finish. Null when it holds no temperature then. */
export function weatherFrom(answer: unknown, start: string, finish: string): Weather | null {
  const hourly = (answer as { hourly?: Hourly } | null)?.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times) || times.length < 2) return null;
  const day = times[0].slice(0, 10);
  const series = (k: string): (number | null)[] | null => (Array.isArray(hourly[k]) ? (hourly[k] as (number | null)[]) : null);
  const at = (k: string, local: string): number | undefined => {
    const v = series(k);
    if (!v) return undefined;
    const m = minutesFrom(day, local);
    const i = Math.floor(m / 60), f = (m % 60) / 60;
    const a = v[i], b = v[i + 1];
    if (a == null || !Number.isFinite(a)) return undefined;
    return b == null || !Number.isFinite(b) ? a : a + (b - a) * f;
  };
  const tempC = at("temperature_2m", start);
  if (tempC == null) return null;
  const w: Weather = { tempC };
  const set = <K extends keyof Weather>(key: K, value: Weather[K] | undefined) => { if (value != null) w[key] = value; };
  set("feelsC", at("apparent_temperature", start));
  set("humidityPct", at("relative_humidity_2m", start));
  set("dewPointC", at("dew_point_2m", start));
  set("windKmh", at("wind_speed_10m", start));
  set("gustKmh", at("wind_gusts_10m", start));
  const dir = series("wind_direction_10m")?.[Math.floor(minutesFrom(day, start) / 60)];
  if (dir != null && Number.isFinite(dir)) w.windFrom = compass(dir);
  if (finish.slice(0, 13) !== start.slice(0, 13)) set("finishTempC", at("temperature_2m", finish));
  const code = series("weather_code")?.[Math.floor(minutesFrom(day, start) / 60)];
  if (code != null && Number.isFinite(code) && sky(code)) w.sky = sky(code);
  w.note = "From Open-Meteo, for where the route starts.";
  return w;
}

/** Weather right now, for the dashboard's date line. */
export interface WeatherNow { tempC: number; code: number; isDay: boolean; highC?: number; lowC?: number }

/** The address for the current weather and today's high and low at a place. */
export function currentWeatherUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(2), longitude: lon.toFixed(2),
    current: "temperature_2m,weather_code,is_day", daily: "temperature_2m_max,temperature_2m_min",
    forecast_days: "1", timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Reads the current-weather answer. Null when it holds no temperature. */
export function weatherNowFrom(answer: unknown): WeatherNow | null {
  const a = answer as { current?: Record<string, unknown>; daily?: Record<string, unknown> } | null;
  const temp = a?.current?.temperature_2m, code = a?.current?.weather_code;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  const first = (k: string) => { const v = a?.daily?.[k]; return Array.isArray(v) && typeof v[0] === "number" ? v[0] : undefined; };
  const w: WeatherNow = { tempC: temp, code: typeof code === "number" ? code : -1, isDay: a?.current?.is_day !== 0 };
  const hi = first("temperature_2m_max"), lo = first("temperature_2m_min");
  if (hi != null) w.highC = hi;
  if (lo != null) w.lowC = lo;
  return w;
}
