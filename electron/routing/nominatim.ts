import type { RouteGeocodeResult } from "../types";

// Nominatim's usage policy requires a descriptive User-Agent and no more than
// one request per second. We funnel every call through a single-flight throttle
// so bursts (e.g. type-ahead search) can never exceed that rate.
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT =
  "CorosLink/1.0 (https://github.com/Akerrules/CorosLink)";
const NOMINATIM_MIN_INTERVAL_MS = 1_100;

let lastRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

/** Serialises requests and spaces them out to respect the 1 req/s policy. */
function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const waitMs = lastRequestAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive regardless of individual failures.
  requestChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

interface NominatimPlace {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state_district?: string;
    hamlet?: string;
    suburb?: string;
    country?: string;
  };
}

async function requestJson<T>(url: URL): Promise<T> {
  const response = await throttle(() =>
    fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    })
  );

  if (!response.ok) {
    throw new Error(
      `Location search failed: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as T;
}

function toResult(place: NominatimPlace): RouteGeocodeResult | undefined {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return undefined;
  }
  return {
    label: place.display_name || place.name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat,
    lon,
    city:
      place.address?.city ||
      place.address?.town ||
      place.address?.village ||
      place.address?.municipality ||
      place.address?.county ||
      place.address?.state_district ||
      place.address?.hamlet ||
      place.address?.suburb,
    country: place.address?.country
  };
}

/** Forward geocode: free-text place → coordinates. Returns the best match. */
export async function geocodeNominatim(
  query: string
): Promise<RouteGeocodeResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Enter a location to find on the map.");
  }

  const url = new URL(`${NOMINATIM_BASE_URL}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const places = await requestJson<NominatimPlace[]>(url);
  const result = places.map(toResult).find(Boolean);
  if (!result) {
    throw new Error(`Couldn't find "${trimmed}". Try a more specific place.`);
  }
  return result;
}

/** Returns up to `limit` matches for type-ahead search suggestions. */
export async function searchNominatim(
  query: string,
  limit = 5
): Promise<RouteGeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return [];
  }

  const url = new URL(`${NOMINATIM_BASE_URL}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 10))));
  url.searchParams.set("addressdetails", "0");

  const places = await requestJson<NominatimPlace[]>(url);
  return places
    .map(toResult)
    .filter((value): value is RouteGeocodeResult => Boolean(value));
}

/** Reverse geocode: coordinates → a human-readable place label. */
export async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<RouteGeocodeResult> {
  const url = new URL(`${NOMINATIM_BASE_URL}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");

  const place = await requestJson<NominatimPlace>(url);
  const result = toResult({ ...place, lat: String(lat), lon: String(lon) });
  return (
    result ?? {
      label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon
    }
  );
}
