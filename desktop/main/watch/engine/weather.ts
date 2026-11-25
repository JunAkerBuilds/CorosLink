// The watch's weather: Open-Meteo's forecast, air quality and tides at a place, written as the watch's weather file
// (HF file 80) and sent in one SendFile block. A port of the CorosKit helper's Weather.swift (OpenMeteoWeather) and
// sendWeather (main.swift), with CorosKit's WatchData/WatchWeather.swift (WatchForecast), WatchData/Tides.swift and
// WatchSession.sendWeather. Only the place rounded to two decimals leaves the computer.
//
// The file is a run of sections, each a 6-byte header (kind, index, protobuf length u16 LE, 0 u16) and a protobuf:
// kind 0 the forecast header with "now", kind 1 one day per index (0–13), kind 2 one hour per index (0–95), the
// pressure-only past hours first (the barometer chart starts 6 hours back). Units are what a PACE 4 displays:
// tenths of °C, tenths of a percent humidity, tenths of km/h, wind from compass sector 0 N … 7 NW, pascals (sint32),
// tide height in centimetres (sint32), Unix seconds. Conditions are Apple Weather codes.
//
// Times in the model are Unix seconds (numbers), as Swift's Dates are doubles: no millisecond rounding.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CorosError } from "./bytes";
import { BLOCK_BYTES, blockHeader, encodeDataFile, WEATHER_FILE } from "./dataFile";
import { supports } from "./models";
import { type CalendarDay, fromRefSeconds, refSeconds } from "./native";
import { ProtoWriter } from "./protobuf";
import type { WatchSession } from "./session";

// MARK: The forecast

export interface Conditions {
  /** Unix seconds. */
  time: number;
  /** Apple Weather's condition code. */
  condition: number;
  /** °C; NaN when unknown. */
  temperature: number;
  feelsLike?: number;
  /** 0–100 %. */
  humidity?: number;
  /** Chance of precipitation, 0–100 %. */
  precipitationChance?: number;
  windSpeedKmh?: number;
  /** Where the wind comes from, degrees. */
  windDirection?: number;
  uvIndex?: number;
  usAQI?: number;
  /** Sea-level pressure, hPa. */
  pressureHpa?: number;
}

/** Sea-level pressure in an hour before the one under way (for the barometer chart). */
export interface PastPressure { time: number; hpa: number }

export interface ForecastDay {
  /** The calendar date at the place. */
  date: CalendarDay;
  condition: number;
  low: number;
  high: number;
  precipitationChance?: number;
}

export interface WatchForecast {
  latitude: number;
  longitude: number;
  current: Conditions;
  /** From the hour under way, up to 96. */
  hourly: Conditions[];
  /** Up to 6 hours before the hour under way, pressure only. */
  pastPressure: PastPressure[];
  daily: ForecastDay[];
  /** Whether air quality came with the forecast (the watch then shows its AQI). */
  airQuality: boolean;
  /** The sea's height near the place, for the tide chart; null inland. */
  tides: Tides | null;
}

const HOURS = 96;
const DAYS = 14;
const PAST_HOURS = 6;
const FORECAST_SECTION = 0, DAY_SECTION = 1, HOUR_SECTION = 2;
/** Set explicitly, as COROS does: the watch's refresh interval and how long the forecast stays valid. */
const REFRESH_SECONDS = 3600, VALID_SECONDS = 72 * 3600;
/** ProviderEnum APPLE. */
const PROVIDER_APPLE = 3;

/**
 * A forecast as WatchForecast.init keeps it: 6 past hours, 14 days, 96 hours from the hour under way, and that hour
 * carrying the current readings (the watch shows its entry as now), filled in from the hour where now lacks one.
 */
export function watchForecast(input: {
  latitude: number; longitude: number; current: Conditions; hourly: Conditions[]; pastPressure?: PastPressure[];
  daily: ForecastDay[]; airQuality?: boolean; tides?: Tides | null;
}): WatchForecast {
  let current = input.current;
  const hours = input.hourly.filter((h) => h.time > current.time - 3600 && Number.isFinite(h.temperature)).slice(0, HOURS);
  const index = hours.findLastIndex((h) => h.time <= current.time);
  if (index >= 0) {
    const hour = hours[index];
    current = {
      ...current,
      feelsLike: current.feelsLike ?? hour.feelsLike,
      humidity: current.humidity ?? hour.humidity,
      precipitationChance: current.precipitationChance ?? hour.precipitationChance,
      windSpeedKmh: current.windSpeedKmh ?? hour.windSpeedKmh,
      windDirection: current.windDirection ?? hour.windDirection,
      uvIndex: current.uvIndex ?? hour.uvIndex,
      usAQI: current.usAQI ?? hour.usAQI,
      pressureHpa: current.pressureHpa ?? hour.pressureHpa,
    };
    hours[index] = { ...current, time: hour.time };
  }
  const past = input.pastPressure ?? [];
  return {
    latitude: input.latitude, longitude: input.longitude, current, hourly: hours,
    pastPressure: past.slice(Math.max(0, past.length - PAST_HOURS)), daily: input.daily.slice(0, DAYS),
    airQuality: input.airQuality ?? false, tides: input.tides ?? null,
  };
}

/** Apple Weather's condition codes by WeatherKit's `WeatherCondition` raw value (WatchForecast.appleCode); 255 unknown. */
export function weatherKitCode(condition: string): number {
  return WEATHER_KIT[condition] ?? 255;
}
const WEATHER_KIT: Record<string, number> = {
  clear: 0, cloudy: 1, blowingDust: 2, foggy: 3, haze: 4, mostlyClear: 5, mostlyCloudy: 6, partlyCloudy: 7,
  scatteredThunderstorms: 8, smoky: 9, breezy: 10, windy: 11, drizzle: 12, heavyRain: 13, rain: 14, sunShowers: 15,
  flurries: 16, sunFlurries: 16, heavySnow: 17, wintryMix: 19, sleet: 24, snow: 25, blizzard: 27, blowingSnow: 28,
  freezingDrizzle: 29, freezingRain: 30, frigid: 31, hail: 32, hot: 33, hurricane: 34, isolatedThunderstorms: 35,
  strongStorms: 36, thunderstorms: 37, tropicalStorm: 39,
};

// MARK: Tides

export interface TideReading { time: number; meters: number }
export interface TideTurn { time: number; meters: number; isHigh: boolean }

/**
 * The sea's height by the hour at the nearest coast, from Open-Meteo's marine model (`sea_level_height_msl`). Inland
 * the model has no sea cell and every value is null, so there are no tides.
 */
export class Tides {
  /** By time. */
  readonly readings: TideReading[];

  constructor(readings: TideReading[]) { this.readings = [...readings].sort((a, b) => a.time - b.time); }

  /** From 6 hours before now's hour (where the watch's tide chart starts) to 4 days ahead. */
  static url(latitude: number, longitude: number): string {
    return "https://marine-api.open-meteo.com/v1/marine?" + query([
      ["latitude", fixed4(latitude)], ["longitude", fixed4(longitude)], ["hourly", "sea_level_height_msl"],
      ["timeformat", "unixtime"], ["past_hours", "7"], ["forecast_hours", "97"],
    ]);
  }

  /** The readings in an answer, or null when it has none (inland, or no answer). */
  static parse(data: Uint8Array | string): Tides | null {
    const series = object(object(json(data))?.hourly);
    if (!series) return null;
    const times = Array.isArray(series.time) ? series.time : [];
    const values = Array.isArray(series.sea_level_height_msl) ? series.sea_level_height_msl : [];
    const readings: TideReading[] = [];
    times.forEach((t, i) => {
      const time = number(t), meters = i < values.length ? number(values[i]) : undefined;
      if (time !== undefined && meters !== undefined) readings.push({ time, meters });
    });
    // A handful of hours can't make a tide chart; the model gives all or none.
    return readings.length >= 6 ? new Tides(readings) : null;
  }

  /** The height at `time`, straight between the hours either side; undefined outside the readings or across a gap over 2 hours. */
  meters(time: number): number | undefined {
    const after = this.readings.findIndex((r) => r.time >= time);
    if (after < 0) return undefined;
    const next = this.readings[after];
    if (next.time === time) return next.meters;
    if (after === 0) return undefined;
    const previous = this.readings[after - 1];
    const span = next.time - previous.time;
    if (!(span > 0 && span <= 2 * 3600)) return undefined;
    return previous.meters + (next.meters - previous.meters) * (time - previous.time) / span;
  }

  /** Each high and low tide: the hour higher (lower) than both neighbours, timed and sized by a parabola through the three. */
  get turns(): TideTurn[] {
    const r = this.readings, turns: TideTurn[] = [];
    for (let i = 1; i < r.length - 1; i++) {
      const [a, b, c] = [r[i - 1], r[i], r[i + 1]];
      const isHigh = b.meters >= a.meters && b.meters > c.meters;
      const isLow = b.meters <= a.meters && b.meters < c.meters;
      if (!(isHigh || isLow) || c.time - a.time > 4 * 3600) continue;
      // Vertex of the parabola through three equally spaced points, in steps from b.
      const curvature = a.meters - 2 * b.meters + c.meters;
      const step = curvature === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (a.meters - c.meters) / (2 * curvature)));
      const meters = b.meters - (a.meters - c.meters) * step / 4;
      turns.push({ time: b.time + step * ((c.time - a.time) / 2), meters, isHigh });
    }
    return turns;
  }

  /** The next high and low tide after `now` (Unix seconds), soonest first. */
  next(now: number): TideTurn[] {
    const ahead = this.turns.filter((t) => t.time > now);
    return [ahead.find((t) => t.isHigh), ahead.find((t) => !t.isHigh)]
      .filter((t): t is TideTurn => t !== undefined).sort((a, b) => a.time - b.time);
  }
}

/** Centimetres, as the watch reads them (sint32). */
const centimeters = (meters: number | undefined): number | undefined =>
  meters !== undefined && Number.isFinite(meters) ? round(meters * 100) : undefined;

// MARK: The weather file

/**
 * The weather file (HF 80), kept to one 4 KB block (WatchForecast.watchFile). Hours after the first 48 (then 24) go
 * without "feels like" and tide height when needed, then the furthest hours are left out; two days ahead always fit.
 * `timeZone` is an IANA name; the computer's when left out.
 */
export function weatherFile(forecast: WatchForecast, city: string, now: Date, timeZone?: string): Buffer {
  const encode = (hours: number, feelsLikeHours: number) =>
    encodeDataFile(body(forecast, city, now, timeZone, hours, feelsLikeHours), WEATHER_FILE);
  let hours = Math.min(forecast.hourly.length, HOURS - forecast.pastPressure.length);
  let file = encode(hours, hours);
  for (const feelsLikeHours of [48, 24]) if (file.length > BLOCK_BYTES) file = encode(hours, feelsLikeHours);
  while (file.length > BLOCK_BYTES && hours > 48) {
    hours -= 1;
    file = encode(hours, 24);
  }
  return file;
}

function body(f: WatchForecast, city: string, now: Date, timeZone: string | undefined, hours: number, feelsLikeHours: number): Buffer {
  const tideAt = (time: number) => centimeters(f.tides?.meters(time));
  const header = new ProtoWriter()
    .message(1, entry(f.current, f.airQuality, { tideCm: tideAt(f.current.time) }))
    .int(4, PROVIDER_APPLE).int(5, f.airQuality ? PROVIDER_APPLE : undefined).int(6, unixSeconds(now))
    .sint(8, round(f.latitude * 1e7)).sint(9, round(f.longitude * 1e7))
    .string(10, characters(trimWhitespace(city), 40))
    .int(11, REFRESH_SECONDS).int(12, VALID_SECONDS);
  const parts = [section(FORECAST_SECTION, 0, header.data)];
  f.daily.slice(0, DAYS).forEach((day, index) => {
    const conditions: Conditions = { time: watchDayTime(day.date, now, timeZone), condition: day.condition, temperature: NaN,
      precipitationChance: day.precipitationChance };
    parts.push(section(DAY_SECTION, index, entry(conditions, false, { low: day.low, high: day.high })));
  });
  const past = f.pastPressure.map((hour) => new ProtoWriter().int(2, 255).int(14, Math.trunc(hour.time))
    .sint(15, tideAt(hour.time)).sint(16, pascals(hour.hpa)).data);
  const ahead = f.hourly.slice(0, Math.min(hours, HOURS - past.length)).map((hour, index) =>
    entry(hour, f.airQuality, { feelsLike: index < feelsLikeHours, tideCm: index < feelsLikeHours ? tideAt(hour.time) : undefined }));
  [...past, ...ahead].forEach((e, index) => parts.push(section(HOUR_SECTION, index, e)));
  return Buffer.concat(parts);
}

/** One weatherStruct section: kind, index, protobuf length (LE), 0, then the protobuf. */
const section = (kind: number, index: number, bytes: Uint8Array): Buffer =>
  Buffer.concat([Buffer.from([kind, index & 0xff, bytes.length & 0xff, bytes.length >> 8, 0, 0]), bytes]);

/** hPa → whole pascals, the unit COROS sends. */
const pascals = (hpa: number | undefined): number | undefined => hpa !== undefined && Number.isFinite(hpa) ? round(hpa * 100) : undefined;

/** One WeatherUI entry in the units the watch reads. */
function entry(e: Conditions, airQuality: boolean, extra: { feelsLike?: boolean; low?: number; high?: number; tideCm?: number } = {}): Buffer {
  const ui = new ProtoWriter()
    .int(2, e.condition)
    .int(3, tenths(e.temperature))
    .int(4, (extra.feelsLike ?? true) ? tenths(e.feelsLike) : undefined)
    .int(5, e.humidity === undefined ? undefined : clamp(round(e.humidity * 10), 0, 1000))
    .int(6, e.windDirection === undefined ? undefined : sector(e.windDirection))
    .int(8, e.windSpeedKmh === undefined ? undefined : Math.max(0, round(e.windSpeedKmh * 10)))
    .int(9, tenths(extra.low))
    .int(10, tenths(extra.high))
    .int(11, e.precipitationChance === undefined ? undefined : clamp(round(e.precipitationChance), 0, 100))
    .int(12, e.uvIndex === undefined ? undefined : clamp(round(e.uvIndex), 0, 30));
  // The watch hides an AQI it reads as negative; 0xffff is -1 in its 16-bit copy.
  if (airQuality) ui.int(13, e.usAQI === undefined ? 0xffff : clamp(round(e.usAQI), 0, 999));
  return ui.int(14, Math.trunc(e.time)).sint(15, extra.tideCm).sint(16, pascals(e.pressureHpa)).data;
}

/**
 * The watch's midnight of `date` + 1 hour (Unix seconds): its day list takes an hour off and names the day in the
 * watch's time zone, the computer's offset when the clock was set, in 15-minute units.
 */
export function watchDayTime(date: CalendarDay, now: Date, timeZone?: string): number {
  const midnight = Date.UTC(date.year, date.month - 1, date.day) / 1000;
  const watchOffset = Math.trunc(Math.trunc(offsetSeconds(now, timeZone) / 60) / 15) * 15 * 60;
  return midnight - watchOffset + 3600;
}

/** WatchForecast.round: JavaScript's Math.round (halves up), so the file matches CorosLink's. */
const round = (value: number): number => Math.floor(value + 0.5);
const tenths = (value: number | undefined): number | undefined => value !== undefined && Number.isFinite(value) ? round(value * 10) : undefined;
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const sector = (degrees: number): number => round((((degrees % 360) + 360) % 360) / 45) % 8;
const unixSeconds = (date: Date): number => Math.trunc(date.getTime() / 1000);

/** Seconds east of UTC at `at` in an IANA zone, or this computer's. */
function offsetSeconds(at: Date, timeZone?: string): number {
  if (!timeZone) return -at.getTimezoneOffset() * 60;
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0));
}

/** Swift's whitespacesAndNewlines trim (Zs, tab, U+000A–U+000D, U+0085, U+2028, U+2029). */
const trimWhitespace = (text: string): string =>
  text.replace(/^[\p{Zs}\t\n\v\f\r\u0085\u2028\u2029]+|[\p{Zs}\t\n\v\f\r\u0085\u2028\u2029]+$/gu, "");

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** The first `count` characters, as Swift counts them (grapheme clusters). */
function characters(text: string, count: number): string {
  let out = "", n = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (n++ >= count) break;
    out += segment;
  }
  return out;
}

// MARK: Open-Meteo

const VARIABLES = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation_probability", "weather_code",
  "wind_speed_10m", "wind_direction_10m", "uv_index", "pressure_msl"];
const DAILY_VARIABLES = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max"];
/** URLSession's request timeout in the helper. */
const TIMEOUT_MS = 15_000;

export function forecastURL(latitude: number, longitude: number): string {
  const conditions = VARIABLES.join(",");
  return "https://api.open-meteo.com/v1/forecast?" + query([
    ["latitude", fixed4(latitude)], ["longitude", fixed4(longitude)], ["current", conditions], ["hourly", conditions],
    ["daily", DAILY_VARIABLES.join(",")], ["timeformat", "unixtime"], ["timezone", "auto"], ["forecast_days", "14"],
    // Yesterday too, for the hours the barometer chart starts with.
    ["past_days", "1"],
  ]);
}

export function airQualityURL(latitude: number, longitude: number): string {
  return "https://air-quality-api.open-meteo.com/v1/air-quality?" + query([
    ["latitude", fixed4(latitude)], ["longitude", fixed4(longitude)], ["current", "us_aqi"], ["hourly", "us_aqi"],
    ["timeformat", "unixtime"], ["forecast_days", "5"],
  ]);
}

/** Open-Meteo's WMO weather code → the Apple Weather condition codes the watch knows. */
export function appleCode(wmo: number): number {
  if (wmo === 0) return 0;
  if (wmo === 1) return 5;
  if (wmo === 2) return 7;
  if (wmo === 3) return 1;
  if (wmo === 45 || wmo === 48) return 3;
  if (wmo === 56 || wmo === 57) return 29;
  if (wmo >= 51 && wmo <= 55) return 12;
  if (wmo === 66 || wmo === 67) return 30;
  if (wmo === 65 || wmo === 82) return 13;
  if (wmo >= 61 && wmo <= 63) return 14;
  if (wmo === 80 || wmo === 81) return 15;
  if (wmo === 75) return 17;
  if (wmo === 77) return 16;
  if (wmo === 71 || wmo === 73) return 25;
  if (wmo === 85 || wmo === 86) return 26;
  if (wmo >= 95 && wmo <= 99) return 37;
  return 255;
}

async function get(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "User-Agent": "C-LINK" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CorosError("The weather service didn't answer.");
  }
  if (response.status !== 200) throw new CorosError("The weather service didn't answer.");
  return new Uint8Array(await response.arrayBuffer());
}

/** The forecast at a place rounded to two decimals, with air quality and tides when they come. */
export async function fetchForecast(latitude: number, longitude: number, fetchImpl: typeof fetch = fetch): Promise<WatchForecast> {
  const lat = roundHalfAway(latitude * 100) / 100, lon = roundHalfAway(longitude * 100) / 100;
  const air = get(airQualityURL(lat, lon), fetchImpl).catch(() => null);
  const tide = get(Tides.url(lat, lon), fetchImpl).catch(() => null);
  const answer = await get(forecastURL(lat, lon), fetchImpl);
  const forecast = parseForecast(answer, await air, lat, lon);
  const tideData = await tide;
  forecast.tides = tideData ? Tides.parse(tideData) : null;
  return forecast;
}

/** Open-Meteo's forecast (and air-quality) answers as a WatchForecast (OpenMeteoWeather.parse). */
export function parseForecast(data: Uint8Array | string, air: Uint8Array | string | null, latitude: number, longitude: number): WatchForecast {
  const root = object(json(data));
  if (!root) throw new CorosError("The weather service returned no forecast.");
  const currentValues = object(root.current);
  const nowSeconds = number(currentValues?.time), temperature = number(currentValues?.temperature_2m);
  if (!currentValues || nowSeconds === undefined || temperature === undefined) throw new CorosError("The weather service returned no current conditions.");

  // US AQI by hour, and now.
  const aqiByHour = new Map<number, number>();
  let aqiNow: number | undefined;
  const airRoot = air ? object(json(air)) : undefined;
  if (airRoot) {
    const hours = object(airRoot.hourly);
    const values = series(hours, "us_aqi");
    series(hours, "time").forEach((time, i) => {
      const aqi = i < values.length ? values[i] : undefined;
      if (time !== undefined && aqi !== undefined) aqiByHour.set(Math.trunc(time), aqi);
    });
    aqiNow = number(object(airRoot.current)?.us_aqi);
  }
  const airQuality = aqiByHour.size > 0 || aqiNow !== undefined;

  const hourlyObject = object(root.hourly);
  const columns = new Map(VARIABLES.map((v) => [v, series(hourlyObject, v)]));
  const at = (name: string, i: number) => columns.get(name)?.[i];
  const hourly: Conditions[] = [];
  series(hourlyObject, "time").forEach((time, i) => {
    if (time === undefined) return;
    const code = at("weather_code", i);
    hourly.push(compactConditions({
      time, condition: code === undefined ? 255 : appleCode(Math.trunc(code)), temperature: at("temperature_2m", i) ?? NaN,
      feelsLike: at("apparent_temperature", i), humidity: at("relative_humidity_2m", i), precipitationChance: at("precipitation_probability", i),
      windSpeedKmh: at("wind_speed_10m", i), windDirection: at("wind_direction_10m", i), uvIndex: at("uv_index", i),
      usAQI: aqiByHour.get(Math.trunc(time)), pressureHpa: at("pressure_msl", i),
    }));
  });

  const underWay = hourly.filter((h) => h.time > nowSeconds - 3600 && Number.isFinite(h.temperature)).findLast((h) => h.time <= nowSeconds);
  const currentCode = number(currentValues.weather_code);
  const current = compactConditions({
    time: nowSeconds, condition: currentCode !== undefined ? appleCode(Math.trunc(currentCode)) : underWay?.condition ?? 255,
    temperature, feelsLike: number(currentValues.apparent_temperature), humidity: number(currentValues.relative_humidity_2m),
    precipitationChance: number(currentValues.precipitation_probability), windSpeedKmh: number(currentValues.wind_speed_10m),
    windDirection: number(currentValues.wind_direction_10m), uvIndex: number(currentValues.uv_index),
    usAQI: aqiNow, pressureHpa: number(currentValues.pressure_msl),
  });

  // Pressure for up to 6 hours before the hour under way: the barometer chart's past hours.
  const firstHour = hourly.find((h) => h.time > nowSeconds - 3600 && Number.isFinite(h.temperature))?.time
    ?? Math.floor(nowSeconds / 3600) * 3600;
  const pastPressure = hourly.filter((h) => h.time >= firstHour - 6 * 3600 && h.time < firstHour && h.pressureHpa !== undefined)
    .map((h) => ({ time: h.time, hpa: h.pressureHpa! }));

  // Days in the place's time zone (timezone=auto).
  const days = object(root.daily);
  const offset = number(root.utc_offset_seconds) ?? -new Date().getTimezoneOffset() * 60;
  const dailyColumns = new Map(DAILY_VARIABLES.map((v) => [v, series(days, v)]));
  const day = (name: string, i: number) => dailyColumns.get(name)?.[i];
  const daily: ForecastDay[] = [];
  series(days, "time").forEach((time, i) => {
    const low = day("temperature_2m_min", i), high = day("temperature_2m_max", i);
    if (time === undefined || !(time + 86_400 > nowSeconds) || low === undefined || high === undefined) return;
    const code = day("weather_code", i), chance = day("precipitation_probability_max", i);
    daily.push({ date: placeDate(time, offset), condition: code === undefined ? 255 : appleCode(Math.trunc(code)), low, high,
      ...(chance === undefined ? {} : { precipitationChance: chance }) });
  });
  return watchForecast({ latitude, longitude, current, hourly, pastPressure, daily, airQuality });
}

/** The place's date of a day Open-Meteo starts at its local midnight; the nearest midnight, so a DST change doesn't move a day. */
function placeDate(time: number, offset: number): CalendarDay {
  const d = new Date(Math.floor((time + offset + 43_200) / 86_400) * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** A JSON number that isn't a boolean and is finite (JSONSerialization's NSNumber check). */
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const series = (o: Record<string, unknown> | undefined, key: string): (number | undefined)[] =>
  Array.isArray(o?.[key]) ? (o[key] as unknown[]).map(number) : [];
function json(data: Uint8Array | string): unknown {
  try { return JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)); } catch { return undefined; }
}
function compactConditions(c: Conditions): Conditions {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as unknown as Conditions;
}
/** Swift's `.rounded()`: half away from zero. */
const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
/** String(format: "%.4f"), "-0.0000" included. */
const fixed4 = (x: number): string => Object.is(x, -0) ? "-0.0000" : x.toFixed(4);
/** URLComponents' query: these values need no escaping (letters, digits, `_ , . -`). */
const query = (items: [string, string][]): string => items.map(([k, v]) => `${k}=${v}`).join("&");

// MARK: Sending

/** Sends the weather file in one block, so a failure never leaves a transfer half done (WatchSession.sendWeather). */
export async function sendWeather(session: WatchSession, file: Uint8Array): Promise<void> {
  session.requireAuthenticated();
  if (!supports(session.link.info, "weather")) throw new CorosError("Not available on this watch.");
  if (file.length > BLOCK_BYTES) throw new CorosError("The weather file is too large.");
  await session.exclusively(async () => {
    const header = blockHeader(WEATHER_FILE, file, 0, file.length);
    await session.link.sendFileBlock(header, file, WEATHER_FILE);
  });
}

/** The place the watch's weather is for, from the Watch page; the city is what the watch shows. */
export interface WeatherPlace { latitude: number; longitude: number; city: string }

/** A place from a request, or null when it has no usable coordinates (WeatherPlace.init). */
export function weatherPlace(raw: unknown): WeatherPlace | null {
  const o = object(raw);
  const lat = o?.latitude, lon = o?.longitude;
  if (typeof lat !== "number" || typeof lon !== "number" || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return null;
  return { latitude: lat, longitude: lon, city: characters(typeof o?.city === "string" ? o.city : "", 40) };
}

/** When the weather last went to the watch, and for where (the helper's WeatherSent, kept as weather.json). */
interface WeatherSent { at: Date; place: WeatherPlace }
/** Same place within this long: not sent again (CorosLink's freshness). */
const FRESH_MS = 30 * 60 * 1000;

async function readSent(file: string): Promise<WeatherSent | null> {
  try {
    const o = object(JSON.parse(await readFile(file, "utf8")));
    const place = object(o?.place);
    if (typeof o?.at !== "number" || typeof place?.latitude !== "number" || typeof place.longitude !== "number" || typeof place.city !== "string") return null;
    return { at: fromRefSeconds(o.at), place: { latitude: place.latitude, longitude: place.longitude, city: place.city } };
  } catch { return null; }
}

async function writeSent(file: string, sent: WeatherSent): Promise<void> {
  const text = JSON.stringify({ at: refSeconds(sent.at), place: { latitude: sent.place.latitude, longitude: sent.place.longitude, city: sent.place.city } });
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text);
  await rename(temp, file);
}

/**
 * Sends the forecast for `place` unless the same place went less than 30 minutes ago (main.swift's sendWeather).
 * `keptFolder` holds weather.json; without one the weather always goes. True when it was sent.
 */
export async function sendWeatherIfDue(session: WatchSession, place: WeatherPlace, keptFolder: string | null, force: boolean,
                                       deps: { fetchImpl?: typeof fetch; now?: () => Date } = {}): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const keptFile = keptFolder ? path.join(keptFolder, "weather.json") : null;
  if (!force && keptFile) {
    const sent = await readSent(keptFile);
    if (sent && samePlace(sent.place, place) && now().getTime() - sent.at.getTime() < FRESH_MS) return false;
  }
  const forecast = await fetchForecast(place.latitude, place.longitude, deps.fetchImpl ?? fetch);
  await sendWeather(session, weatherFile(forecast, place.city, now()));
  if (keptFile) await writeSent(keptFile, { at: now(), place }).catch(() => {});
  return true;
}

const samePlace = (a: WeatherPlace, b: WeatherPlace): boolean => a.latitude === b.latitude && a.longitude === b.longitude && a.city === b.city;
