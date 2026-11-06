import { encodeWatchFile, ProtoWriter, TRAINING_BLOCK_BYTES, WEATHER_FILE } from "./corosBleTrainingProtocol";

/**
 * Weather for the watch, built on this computer from Open-Meteo (not a COROS
 * service) in an "HF" file 80, which the COROS app sends as SEND_WEATHER_24H.
 * The app doesn't build the file: it forwards the `weatherStruct` bytes COROS's
 * weather service returns, so the units below are the ones the PACE 4 (W336,
 * firmware 3.2008.0) displays, and agree with the app's own weather view where
 * it reads the same field.
 *
 * The file is COROS's section-per-entry form (weatherStruct): sections of a
 * 6-byte header (kind u8, index u8, protobuf length u16 LE, 0 u16) and a
 * protobuf. Kind 0 (index 0) is a `WeatherForecastUI` without hourly/daily
 * entries (current, provider, sent-at, place, query interval, expiry); kind 1
 * is one daily `WeatherUI` per index (0–13), kind 2 one hourly `WeatherUI` per
 * index (0–95). The watch's other decoder, for a single `WeatherForecastUI`,
 * keeps no hourly pressure, so the barometer chart pages draw no bars from it
 * (confirmed on a PACE Pro, 2026-11-05). Their chart (firmware 0x4a2c2c) is
 * the 24 hours from 6 hours ago, each filled from the hourly entry whose
 * obs_timestamp is exactly that hour: pressure (sint32, pascals; the watch
 * keeps tenths of hPa) is sent for up to 6 past hours too, as entries with
 * nothing else (weather_type 255, as COROS sends its past hours). Tide pages
 * need tide_height (cm) per hour, which Open-Meteo doesn't have.
 *
 * - The watch keeps weather_type, temperature, body_feel_temp, humidity,
 *   precip, wind_direction_type, wind_speed, uvi, aqi and obs_timestamp (and
 *   per hour tide_height, moon_altitude, wind_gust); per day weather_type,
 *   min/max and precip. It drops provider, wind_direction in degrees,
 *   min/max outside daily entries, and the timezone and app_query_interval.
 * - It replaces "current" with the hourly entry for the hour under way (and
 *   again each hour), so the main screen shows an hourly entry: every hourly
 *   entry carries every field. Each hour gets the high/low of the day it
 *   falls in.
 * - Screens: now, UV/AQI/wind, next 6 hours, next 7 days and the glance.
 *   - temperature, body_feel_temp ("Feels Like"), min/max: tenths of °C
 *     (value / 10, converted to °F on the watch; the app also reads
 *     temperature / 10).
 *   - humidity: tenths of a percent (value / 10 + "%"; app the same).
 *   - precip: chance of precipitation in percent, 0–100 (shown "%d" + "%"
 *     by a rain icon; values of 128 and up show "--").
 *   - uvi: the whole UV index (levels Low/Moderate/High/Very high/Extreme
 *     at 3/6/8/11).
 *   - wind_speed: tenths of km/h (shown as m/s = value / 36, or mph =
 *     value / 10 / 1.609344; the app reads value / 10 as km/h).
 *   - wind_direction_type: compass sector 0 N, 1 NE … 7 NW, where the wind
 *     comes from.
 *   - aqi: US EPA AQI (Good … Hazardous at 50/100/150/200/300), shown only
 *     when aqi_provider isn't 0 (the only test the watch makes of it); a
 *     negative 16-bit value shows "--".
 *   - obs_timestamp: Unix seconds (the watch subtracts the 2014 epoch; the
 *     app compares it with the clock). For daily entries the watch subtracts
 *     one hour more, and the day list names each day from that in the
 *     watch's time zone, so a day is sent as the watch's midnight of the
 *     place's date + 1 hour (watchDayTimestamp).
 * - The watch takes files up to 8 KB and, when unset, defaults
 *   bsp_query_interval to 1 hour and weather_expire to 72 hours.
 * Not sent: tide_height, moon_altitude and wind_gust (no data, or no screen
 * here reads them), and the timezone (unused).
 */

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
/** ProviderEnum APPLE: conditions are Apple Weather codes, which the watch's icon table uses. */
const PROVIDER_APPLE = 3;
/** Any value but 0 turns the watch's AQI on; what COROS's values mean is not known, so the same provider is named. */
const AQI_PROVIDER = PROVIDER_APPLE;
/** The daily decoder takes an hour off obs_timestamp (see the header). */
const DAY_TIMESTAMP_OFFSET = 3600;
/** The watch keeps 96 hourly and 14 daily entries. */
const HOURS = 96;
const DAYS = 14;
const CONDITIONS = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,uv_index,pressure_msl";
/** Past hours sent with pressure only: the barometer chart starts 6 hours back. */
const PAST_HOURS = 6;
/** weather_type for those hours, as COROS sends its past hours. */
const NO_WEATHER_TYPE = 255;
/** Section kinds (see the header). */
const FORECAST_SECTION = 0;
const DAY_SECTION = 1;
const HOUR_SECTION = 2;
/** Set explicitly, as COROS does: the watch's refresh interval and how long the forecast stays valid. */
const BSP_QUERY_INTERVAL = 3600;
const WEATHER_EXPIRE = 72 * 3600;

/** Open-Meteo's WMO weather code → the Apple Weather condition codes the watch knows. */
export function appleWeatherCode(wmo: number): number {
  if (wmo === 0) return 0; // clear
  if (wmo === 1) return 5; // mostly clear
  if (wmo === 2) return 7; // partly cloudy
  if (wmo === 3) return 1; // cloudy
  if (wmo === 45 || wmo === 48) return 3; // fog
  if (wmo === 56 || wmo === 57) return 29; // freezing drizzle
  if (wmo >= 51 && wmo <= 55) return 12; // drizzle
  if (wmo === 66 || wmo === 67) return 30; // freezing rain
  if (wmo === 65 || wmo === 82) return 13; // heavy rain
  if (wmo >= 61 && wmo <= 63) return 14; // rain
  if (wmo === 80 || wmo === 81) return 15; // showers
  if (wmo === 75) return 17; // heavy snow
  if (wmo === 77) return 16; // flurries (snow grains)
  if (wmo === 71 || wmo === 73) return 25; // snow
  if (wmo === 85 || wmo === 86) return 26; // snow showers
  if (wmo >= 95 && wmo <= 99) return 37; // thunderstorms
  return 255; // unknown
}

const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Compass sector 0–7 (north, north-east … north-west), as the watch labels it. */
const windSector = (degrees: number) => Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
const tenths = (value: number | undefined) => value === undefined ? undefined : Math.round(value * 10);
const whole = (value: number | undefined, high: number) => value === undefined ? undefined : clamp(Math.round(value), 0, high);

/** One hour (or now): the values the watch shows for it. */
export interface WatchConditions {
  time: number;
  weatherCode: number;
  temperature: number;
  apparentTemperature?: number;
  /** %. */
  humidity?: number;
  /** Chance of precipitation, %. */
  precipitationProbability?: number;
  windSpeedKmh?: number;
  /** Where the wind comes from, degrees. */
  windDirection?: number;
  uvIndex?: number;
  /** US AQI. */
  usAqi?: number;
  /** Sea-level pressure, hPa. */
  pressureHpa?: number;
}

/** One day; `time` is its local midnight at the place (Unix seconds), `date` its calendar date there (YYYY-MM-DD). */
export interface WatchForecastDay { time: number; date: string; weatherCode: number; min: number; max: number; precipitationProbability?: number }

export interface WatchForecast {
  latitude: number;
  longitude: number;
  current: WatchConditions;
  hourly: WatchConditions[];
  /** Sea-level pressure for up to 6 hours before the hour under way (for the barometer chart). */
  pastPressure: Array<{ time: number; pressureHpa: number }>;
  daily: WatchForecastDay[];
  /** Whether air quality came with the forecast (the watch then shows its AQI). */
  airQuality: boolean;
  /** The place's offset from UTC now, when Open-Meteo reported it (for the Coach's local hours). */
  utcOffsetSeconds?: number;
}

type Series = Record<string, Array<number | null> | undefined> & { time?: number[] };

/**
 * The place's calendar date of a day Open-Meteo starts at `time` (the place's local midnight). The
 * offset is the place's now; the nearest midnight is taken, so a daylight-saving change at the
 * place during the 14 days doesn't move a day.
 */
function placeDate(time: number, placeOffsetSeconds: number): string {
  return new Date(Math.floor((time + placeOffsetSeconds + 43_200) / 86_400) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * obs_timestamp for a day (see the header): the watch takes an hour off and names the day in its
 * own time zone, which is this computer's offset when the clock was set on connecting
 * (encodeSyncTime, in 15-minute units). The watch keeps that offset until the next clock sync, also
 * across a daylight-saving change, so every day is sent as the watch's midnight of that date + 1 hour.
 */
function watchDayTimestamp(date: string, now: Date): number {
  const [year, month, day] = date.split("-").map(Number);
  const watchOffsetSeconds = Math.trunc(-now.getTimezoneOffset() / 15) * 15 * 60;
  return Date.UTC(year!, month! - 1, day!) / 1000 - watchOffsetSeconds + DAY_TIMESTAMP_OFFSET;
}

/** Conditions from Open-Meteo's variables (current, or one hour of the hourly series). */
function conditions(at: (name: string) => number | undefined, time: number): WatchConditions {
  return {
    time, weatherCode: at("weather_code") ?? -1, temperature: at("temperature_2m") ?? NaN, apparentTemperature: at("apparent_temperature"),
    humidity: at("relative_humidity_2m"), precipitationProbability: at("precipitation_probability"), windSpeedKmh: at("wind_speed_10m"),
    windDirection: at("wind_direction_10m"), uvIndex: at("uv_index"), pressureHpa: at("pressure_msl")
  };
}

const defined = <T extends object>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !Number.isNaN(item))) as Partial<T>;

/** US AQI by hour (and now) from Open-Meteo's air-quality service, or nothing when it isn't available. */
async function fetchAirQuality(latitude: number, longitude: number, fetchImpl: typeof fetch): Promise<{ current?: number; hourly: Map<number, number> } | undefined> {
  try {
    const url = new URL(AIR_QUALITY_ENDPOINT);
    url.searchParams.set("latitude", latitude.toFixed(4));
    url.searchParams.set("longitude", longitude.toFixed(4));
    url.searchParams.set("current", "us_aqi");
    url.searchParams.set("hourly", "us_aqi");
    url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("forecast_days", "5");
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    const data = await response.json() as { current?: { us_aqi?: unknown }; hourly?: { time?: unknown[]; us_aqi?: unknown[] } };
    const hourly = new Map<number, number>();
    (data.hourly?.time ?? []).forEach((time, index) => {
      const aqi = finite(data.hourly?.us_aqi?.[index]);
      if (typeof time === "number" && aqi !== undefined) hourly.set(time, aqi);
    });
    const current = finite(data.current?.us_aqi);
    return hourly.size || current !== undefined ? { current, hourly } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetches current conditions, the next 96 hours and 14 days for a place: as
 * many as the watch keeps. Air quality is fetched alongside; without it the
 * forecast is sent without AQI.
 */
export async function fetchWatchForecast(latitude: number, longitude: number, fetchImpl: typeof fetch = fetch): Promise<WatchForecast> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("Invalid location for weather.");
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("current", CONDITIONS);
  url.searchParams.set("hourly", CONDITIONS);
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", String(DAYS));
  // Yesterday too, for the hours before today's midnight the barometer chart starts with.
  url.searchParams.set("past_days", "1");
  const [response, air] = await Promise.all([fetchImpl(url, { signal: AbortSignal.timeout(15_000) }), fetchAirQuality(latitude, longitude, fetchImpl)]);
  if (!response.ok) throw new Error(`The weather service isn't available right now (error ${response.status}).`);
  const data = await response.json() as { current?: Record<string, number | null>; hourly?: Series; daily?: Series; utc_offset_seconds?: unknown };
  const now = finite(data.current?.time);
  if (now === undefined || finite(data.current?.temperature_2m) === undefined) throw new Error("The weather service returned no current conditions.");
  const series = data.hourly ?? {};
  const allHours = (series.time ?? []).map((time, index) => conditions(name => finite(series[name]?.[index]), time));
  // From the hour under way: the watch shows it as "now" until the next hour starts.
  const hourly = allHours.filter(hour => hour.time > now - 3600 && Number.isFinite(hour.temperature)).slice(0, HOURS);
  const underWay = hourly[0]?.time ?? Math.floor(now / 3600) * 3600;
  const pastPressure = allHours
    .filter(hour => hour.time < underWay && hour.time >= underWay - PAST_HOURS * 3600 && hour.pressureHpa !== undefined)
    .map(hour => ({ time: hour.time, pressureHpa: hour.pressureHpa! }));
  if (air) for (const hour of hourly) hour.usAqi = air.hourly.get(hour.time);
  // Open-Meteo's current values, completed from the hour under way. That hour
  // carries them too: the watch shows its entry as "now" (see the header).
  const index = hourly.findIndex(hour => hour.time <= now);
  const reported = { ...conditions(name => finite(data.current?.[name]), now), usAqi: air?.current };
  const current: WatchConditions = { ...hourly[index], ...defined(reported), time: now } as WatchConditions;
  if (reported.weatherCode === -1 && index >= 0) current.weatherCode = hourly[index].weatherCode;
  if (index >= 0) hourly[index] = { ...current, time: hourly[index].time };
  const days = data.daily ?? {};
  // Days are in the place's time zone (timezone=auto); without its offset, this computer's.
  const placeOffset = (time: number) => finite(data.utc_offset_seconds) ?? -new Date(time * 1000).getTimezoneOffset() * 60;
  const daily = (days.time ?? []).map((time, index) => ({
    time, date: placeDate(time, placeOffset(time)), weatherCode: finite(days.weather_code?.[index]) ?? -1, min: finite(days.temperature_2m_min?.[index]) ?? NaN,
    max: finite(days.temperature_2m_max?.[index]) ?? NaN, precipitationProbability: finite(days.precipitation_probability_max?.[index])
  }))
    // Days from today: yesterday came with the past hours.
    .filter(day => day.time + 86_400 > now && Number.isFinite(day.min) && Number.isFinite(day.max)).slice(0, DAYS);
  const utcOffsetSeconds = finite(data.utc_offset_seconds);
  return { latitude, longitude, current, hourly, pastPressure, daily, airQuality: Boolean(air), ...(utcOffsetSeconds !== undefined ? { utcOffsetSeconds } : {}) };
}

/**
 * One WeatherUI entry in the units the watch reads (see the header). Fields
 * its decoder drops (provider, wind_direction in degrees, min/max outside
 * daily entries) are left out: the file has to fit one 4 KB block.
 */
function weatherUI(entry: Partial<WatchConditions> & { time: number; weatherCode: number; min?: number; max?: number }, airQuality: boolean, feelsLike = true): Buffer {
  return new ProtoWriter()
    .int(2, appleWeatherCode(entry.weatherCode)).int(3, tenths(entry.temperature)).int(4, feelsLike ? tenths(entry.apparentTemperature) : undefined)
    .int(5, entry.humidity === undefined ? undefined : clamp(Math.round(entry.humidity * 10), 0, 1000))
    .int(6, entry.windDirection === undefined ? undefined : windSector(entry.windDirection))
    .int(8, entry.windSpeedKmh === undefined ? undefined : Math.max(0, Math.round(entry.windSpeedKmh * 10)))
    .int(9, tenths(entry.min)).int(10, tenths(entry.max)).int(11, whole(entry.precipitationProbability, 100)).int(12, whole(entry.uvIndex, 30))
    // The watch hides an AQI it reads as negative; 0xffff is -1 in its 16-bit copy.
    .int(13, airQuality ? entry.usAqi === undefined ? 0xffff : whole(entry.usAqi, 999) : undefined).int(14, entry.time)
    .sint(16, pascals(entry.pressureHpa)).toBuffer();
}

/** hPa → whole pascals, the unit COROS sends (the watch keeps tenths of hPa). */
const pascals = (hpa: number | undefined) => hpa === undefined ? undefined : Math.round(hpa * 100);

/** One weatherStruct section: kind, index, protobuf length (LE), 0, then the protobuf. */
function section(kind: number, index: number, body: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header[0] = kind;
  header[1] = index;
  header.writeUInt16LE(body.length, 2);
  return Buffer.concat([header, body]);
}

/** The weatherStruct with the first `hours` hours, "feels like" in the first `feelsLikeHours`. */
function forecastBody(forecast: WatchForecast, city: string, now: Date, hours: number, feelsLikeHours: number): Buffer {
  const air = forecast.airQuality;
  const header = new ProtoWriter().message(1, weatherUI(forecast.current, air))
    .int(4, PROVIDER_APPLE).int(5, air ? AQI_PROVIDER : undefined).int(6, Math.floor(now.getTime() / 1000))
    .sint(8, Math.round(forecast.latitude * 1e7)).sint(9, Math.round(forecast.longitude * 1e7))
    .string(10, city.trim().slice(0, 40)).int(11, BSP_QUERY_INTERVAL).int(12, WEATHER_EXPIRE).toBuffer();
  const sections = [section(FORECAST_SECTION, 0, header)];
  forecast.daily.slice(0, DAYS).forEach((day, index) =>
    sections.push(section(DAY_SECTION, index, weatherUI({ ...day, time: watchDayTimestamp(day.date, now) }, false))));
  const past = forecast.pastPressure.slice(-PAST_HOURS).map(hour =>
    new ProtoWriter().int(2, NO_WEATHER_TYPE).int(14, hour.time).sint(16, pascals(hour.pressureHpa)).toBuffer());
  const ahead = forecast.hourly.slice(0, Math.min(hours, HOURS - past.length)).map((hour, index) => weatherUI(hour, air, index < feelsLikeHours));
  [...past, ...ahead].forEach((entry, index) => sections.push(section(HOUR_SECTION, index, entry)));
  return Buffer.concat(sections);
}

/**
 * The weather file the watch takes (HF 80 around a weatherStruct), kept
 * to one transfer block (4 KB; the watch takes up to 8 KB) so a failed send
 * never leaves a transfer half done. Each entry carries a 6-byte section
 * header, so hours after the first 48 (then 24) go without "feels like" when
 * needed (the watch shows it only for the hour under way, and CorosLink sends
 * a new forecast on every connection), and then the furthest hours are left
 * out, down to a day ahead (the barometer chart needs 18 hours ahead).
 */
export function encodeWatchWeather(forecast: WatchForecast, city: string, now: Date): Buffer {
  const encode = (hours: number, feelsLikeHours: number) => encodeWatchFile(forecastBody(forecast, city, now, hours, feelsLikeHours), WEATHER_FILE);
  let hours = Math.min(forecast.hourly.length, HOURS - Math.min(forecast.pastPressure.length, PAST_HOURS));
  let file = encode(hours, hours);
  for (const feelsLikeHours of [48, 24]) if (file.length > TRAINING_BLOCK_BYTES) file = encode(hours, feelsLikeHours);
  while (file.length > TRAINING_BLOCK_BYTES && hours > 24) file = encode(--hours, 24);
  return file;
}
