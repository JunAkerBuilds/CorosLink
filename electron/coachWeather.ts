import type { WatchConditions, WatchForecast } from "./corosWatchWeather";
import type { UnitSystem } from "./types";

// Forecast summaries for the Coach: the hours of one day (when the hourly
// forecast reaches it), dew point, a heat pace estimate and air quality, so it
// can adjust paces, move a hard session to a cooler day, or warn about smoke.

export interface CoachWeatherHour {
  time: string;
  temperature: string;
  feels_like?: string;
  humidity_pct?: number;
  dew_point?: string;
  precipitation_pct?: number;
  wind?: string;
  uv_index?: number;
  us_aqi?: number;
}

export interface CoachWeatherDay {
  date: string;
  low: string;
  high: string;
  precipitation_pct?: number;
  conditions?: string;
}

export interface CoachWeatherReport {
  place: string;
  date: string;
  units: "metric" | "imperial";
  day?: CoachWeatherDay;
  /** Daylight hours, 05:00–21:00 at the place, when the hourly forecast covers the day. */
  hours?: CoachWeatherHour[];
  /** The coolest and hottest two-hour windows in those hours, by feels-like temperature. */
  coolest_window?: string;
  hottest_window?: string;
  heat?: {
    /** Temperature plus dew point, in °F, at the hottest hour: the rule of thumb behind the estimate. */
    temperature_plus_dew_point_f: number;
    pace_adjustment: string;
  };
  air_quality?: { worst_us_aqi: number; category: string };
  note?: string;
}

const FIRST_HOUR = 5;
const LAST_HOUR = 21;

/** WMO weather codes, short. */
const CONDITIONS: Array<[number[], string]> = [
  [[0], "clear"],
  [[1, 2], "partly cloudy"],
  [[3], "overcast"],
  [[45, 48], "fog"],
  [[51, 53, 55, 56, 57], "drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "rain"],
  [[71, 73, 75, 77, 85, 86], "snow"],
  [[95, 96, 99], "thunderstorms"]
];

function conditionName(code: number | undefined): string | undefined {
  return CONDITIONS.find(([codes]) => code !== undefined && codes.includes(code))?.[1];
}

/** Magnus formula, °C. */
export function dewPointC(temperatureC: number, humidityPct: number): number | undefined {
  if (!Number.isFinite(temperatureC) || !(humidityPct > 0) || humidityPct > 100) return undefined;
  const gamma = Math.log(humidityPct / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  return (243.04 * gamma) / (17.625 - gamma);
}

const toF = (celsius: number) => celsius * 9 / 5 + 32;

/**
 * The common "temperature + dew point" rule of thumb for running pace in heat
 * (both in °F): under 100 no change, rising to about 10% slower near 180, and
 * above that hard running isn't advised. An estimate, not a measurement.
 */
export function heatPaceAdjustment(sumF: number): string {
  const bands: Array<[number, string]> = [
    [100, "none"],
    [110, "0–0.5% slower"],
    [120, "0.5–1% slower"],
    [130, "1–2% slower"],
    [140, "2–3% slower"],
    [150, "3–4.5% slower"],
    [160, "4.5–6% slower"],
    [170, "6–8% slower"],
    [180, "8–10% slower"]
  ];
  return bands.find(([limit]) => sumF <= limit)?.[1] ?? "hard running not advised";
}

/** US AQI bands as the EPA names them. */
export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for sensitive groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very unhealthy";
  return "hazardous";
}

function temperature(celsius: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial" ? `${Math.round(toF(celsius))}°F` : `${Math.round(celsius)}°C`;
}

function wind(kmh: number | undefined, unitSystem: UnitSystem): string | undefined {
  if (kmh === undefined || !Number.isFinite(kmh)) return undefined;
  return unitSystem === "imperial" ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
}

/** The place's wall clock for a Unix time: its date (YYYYMMDD) and hour. */
function placeClock(time: number, offsetSeconds: number): { day: string; hour: number; label: string } {
  const date = new Date((time + offsetSeconds) * 1000);
  const day = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return { day, hour: date.getUTCHours(), label: `${String(date.getUTCHours()).padStart(2, "0")}:00` };
}

function windowLabel(hours: Array<{ label: string; hour: number }>, start: number): string {
  const first = hours[start]!;
  return `${first.label}–${String(first.hour + 2).padStart(2, "0")}:00`;
}

export function summarizeForecastDay(
  forecast: WatchForecast,
  day: string,
  place: string,
  unitSystem: UnitSystem = "metric"
): CoachWeatherReport {
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const offset = forecast.utcOffsetSeconds ?? -new Date().getTimezoneOffset() * 60;
  const report: CoachWeatherReport = { place, date, units: unitSystem === "imperial" ? "imperial" : "metric" };
  const daily = forecast.daily.find((entry) => entry.date === date);
  if (daily) {
    report.day = {
      date,
      low: temperature(daily.min, unitSystem),
      high: temperature(daily.max, unitSystem),
      ...(daily.precipitationProbability !== undefined ? { precipitation_pct: Math.round(daily.precipitationProbability) } : {}),
      ...(conditionName(daily.weatherCode) ? { conditions: conditionName(daily.weatherCode) } : {})
    };
  }

  const hours = forecast.hourly
    .map((hour) => ({ hour, clock: placeClock(hour.time, offset) }))
    .filter(({ clock }) => clock.day === day && clock.hour >= FIRST_HOUR && clock.hour <= LAST_HOUR);
  if (!hours.length) {
    if (!daily) {
      report.note = "The forecast doesn't reach this date yet (it covers the next 14 days). Check again closer to the day.";
    } else {
      report.note = "Hourly detail, dew point and air quality are available within about 4 days of the date.";
    }
    return report;
  }

  const feels = (hour: WatchConditions) => hour.apparentTemperature ?? hour.temperature;
  report.hours = hours.map(({ hour, clock }) => {
    const dew = hour.humidity !== undefined ? dewPointC(hour.temperature, hour.humidity) : undefined;
    return {
      time: clock.label,
      temperature: temperature(hour.temperature, unitSystem),
      ...(hour.apparentTemperature !== undefined ? { feels_like: temperature(hour.apparentTemperature, unitSystem) } : {}),
      ...(hour.humidity !== undefined ? { humidity_pct: Math.round(hour.humidity) } : {}),
      ...(dew !== undefined ? { dew_point: temperature(dew, unitSystem) } : {}),
      ...(hour.precipitationProbability !== undefined ? { precipitation_pct: Math.round(hour.precipitationProbability) } : {}),
      ...(wind(hour.windSpeedKmh, unitSystem) ? { wind: wind(hour.windSpeedKmh, unitSystem) } : {}),
      ...(hour.uvIndex !== undefined ? { uv_index: Math.round(hour.uvIndex * 10) / 10 } : {}),
      ...(hour.usAqi !== undefined ? { us_aqi: Math.round(hour.usAqi) } : {})
    };
  });

  if (hours.length >= 2) {
    const clocks = hours.map(({ clock }) => clock);
    const pairs = hours.slice(0, -1).map(({ hour }, index) => (feels(hour) + feels(hours[index + 1]!.hour)) / 2);
    const coolest = pairs.indexOf(Math.min(...pairs));
    const hottest = pairs.indexOf(Math.max(...pairs));
    report.coolest_window = windowLabel(clocks, coolest);
    report.hottest_window = windowLabel(clocks, hottest);
  }

  const sums = hours
    .map(({ hour }) => {
      const dew = hour.humidity !== undefined ? dewPointC(hour.temperature, hour.humidity) : undefined;
      return dew === undefined ? undefined : toF(hour.temperature) + toF(dew);
    })
    .filter((value): value is number => value !== undefined);
  if (sums.length) {
    const worst = Math.round(Math.max(...sums));
    report.heat = { temperature_plus_dew_point_f: worst, pace_adjustment: heatPaceAdjustment(worst) };
  }
  const aqi = hours.map(({ hour }) => hour.usAqi).filter((value): value is number => value !== undefined);
  if (aqi.length) {
    const worst = Math.round(Math.max(...aqi));
    report.air_quality = { worst_us_aqi: worst, category: aqiCategory(worst) };
  }
  return report;
}
