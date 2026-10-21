import { getSetting, setSetting } from "./database";
import { encodeWatchWeather, fetchWatchForecast } from "./corosWatchWeather";

/**
 * Weather for the watch on each connection, and the place it is for. The user
 * can choose a place (searched with Open-Meteo's geocoding, not a COROS
 * service); until then the Overview's automatic location is used, which comes
 * from the system or, failing that, the internet connection's IP (wrong behind
 * a VPN). A chosen place is never replaced by the automatic one. The forecast
 * is fetched from Open-Meteo and reused for half an hour.
 */

const LOCATION_SETTING = "watch.weatherLocation";
const FRESH_MS = 30 * 60 * 1000;
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  place?: string;
  /** "chosen": picked by the user; "automatic": from the Overview's location lookup. */
  source: "chosen" | "automatic";
}

export interface WeatherPlace { name: string; detail: string; latitude: number; longitude: number }

let cached: { at: number; key: string; file: Buffer } | undefined;

function validLocation(value: unknown): { latitude: number; longitude: number; place?: string } {
  const location = value as Partial<WeatherLocation> | null;
  if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number" ||
      !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
    throw new Error("Invalid weather location.");
  }
  // About 1 km is plenty for a forecast, and keeps the stored location coarse.
  return { latitude: Math.round(location.latitude * 100) / 100, longitude: Math.round(location.longitude * 100) / 100,
    ...(typeof location.place === "string" && location.place.trim() ? { place: location.place.trim().slice(0, 80) } : {}) };
}

export function getWeatherLocation(): WeatherLocation | undefined {
  try {
    const raw = getSetting(LOCATION_SETTING);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as Partial<WeatherLocation>;
    return { ...validLocation(stored), source: stored.source === "chosen" ? "chosen" : "automatic" };
  } catch {
    return undefined;
  }
}

/** The Overview's automatic location; ignored once the user has chosen a place. */
export function setWatchWeatherLocation(location: unknown): void {
  const next = validLocation(location);
  if (getWeatherLocation()?.source === "chosen") return;
  setSetting(LOCATION_SETTING, JSON.stringify({ ...next, source: "automatic" }));
}

/** A place the user picked, or null to go back to the automatic location. */
export function chooseWeatherLocation(location: unknown): WeatherLocation | undefined {
  if (location === null) {
    // The Overview stores the automatic location again on its next refresh.
    setSetting(LOCATION_SETTING, "");
    cached = undefined;
    return undefined;
  }
  const chosen: WeatherLocation = { ...validLocation(location), source: "chosen" };
  setSetting(LOCATION_SETTING, JSON.stringify(chosen));
  cached = undefined;
  return chosen;
}

/** Places matching a name, for the location picker. */
export async function searchWeatherPlaces(query: unknown, language = "en", fetchImpl: typeof fetch = fetch): Promise<WeatherPlace[]> {
  const name = typeof query === "string" ? query.trim() : "";
  if (name.length < 2 || name.length > 80) return [];
  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("name", name);
  url.searchParams.set("count", String(MAX_PLACES));
  url.searchParams.set("language", /^[a-z]{2}$/.test(language) ? language : "en");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Place search isn't available right now (error ${response.status}). Try again later.`);
  const data = await response.json() as { results?: unknown } | null;
  // The answer is checked like any download: at most what was asked for, coordinates on Earth, names of a sane length.
  const results = Array.isArray(data?.results) ? data.results.slice(0, MAX_PLACES) : [];
  const places: WeatherPlace[] = [];
  for (const raw of results) {
    const result = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; latitude?: unknown; longitude?: unknown; admin1?: unknown; country?: unknown };
    const name = placeText(result.name);
    const { latitude, longitude } = result;
    if (!name || typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const detail = [placeText(result.admin1), placeText(result.country)].filter((part): part is string => Boolean(part) && part !== name).join(", ");
    places.push({ name, latitude, longitude, detail });
  }
  return places;
}

const MAX_PLACES = 8;
const MAX_PLACE_TEXT = 80;

/** A place name from the geocoder: text only, control characters removed, at most 80 characters (never splitting a character). */
function placeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, MAX_PLACE_TEXT).join("").trim();
  return text || undefined;
}

/** The weather file to send now, or undefined when CorosLink doesn't know where the watch is. */
export async function watchWeatherFile(now = new Date()): Promise<Buffer | undefined> {
  const location = getWeatherLocation();
  if (!location) return undefined;
  const key = `${location.latitude},${location.longitude},${location.place ?? ""}`;
  if (cached && cached.key === key && now.getTime() - cached.at < FRESH_MS) return cached.file;
  const forecast = await fetchWatchForecast(location.latitude, location.longitude);
  const file = encodeWatchWeather(forecast, location.place ?? "", now);
  cached = { at: now.getTime(), key, file };
  return file;
}
