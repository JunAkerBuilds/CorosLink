/**
 * Weather now for the dashboard, from Open-Meteo. The place is where the latest recorded route started
 * (nothing leaves the computer but rounded coordinates), kept so later visits skip looking it up.
 */
import { getActivity, listActivities } from "@/data/activities";
import { createStore } from "@/data/local/store";
import { currentWeatherUrl, weatherNowFrom, type WeatherNow } from "@/lib/openMeteo";

const placeStore = createStore<{ lat: number; lon: number; from: string } | null>("weather.place.v1", null);
const nowStore = createStore<{ at: number; lat: number; lon: number; weather: WeatherNow } | null>("weather.now.v1", null);

/** How long an answer is shown before asking again. */
const FRESH_MS = 20 * 60_000;
/** Recent activities looked at for a route start. */
const LOOK_BACK = 8;

async function place(): Promise<{ lat: number; lon: number } | null> {
  const list = await listActivities();
  const recent = [...list.data].sort((a, b) => b.start.localeCompare(a.start)).slice(0, LOOK_BACK);
  const kept = placeStore.get();
  if (kept && recent[0] && kept.from === recent[0].id) return kept;
  for (const a of recent) {
    const detail = (await getActivity(a.id)).data;
    const at = detail?.route?.find((p) => p.lat != null && p.lon != null);
    if (at?.lat != null && at.lon != null) {
      const found = { lat: at.lat, lon: at.lon, from: recent[0].id };
      placeStore.set(found);
      return found;
    }
  }
  return kept;
}

/** Weather now, or null when there is no known place or Open-Meteo can't be reached. */
export async function loadWeatherNow(): Promise<WeatherNow | null> {
  if (typeof fetch === "undefined") return null;
  const where = await place();
  if (!where) return null;
  const cached = nowStore.get();
  if (cached && cached.lat === where.lat && cached.lon === where.lon && Date.now() - cached.at < FRESH_MS) return cached.weather;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 8000);
  try {
    const response = await fetch(currentWeatherUrl(where.lat, where.lon), { signal: stop.signal });
    if (!response.ok) return cached?.weather ?? null;
    const weather = weatherNowFrom(await response.json());
    if (weather) nowStore.set({ at: Date.now(), lat: where.lat, lon: where.lon, weather });
    return weather ?? cached?.weather ?? null;
  } catch {
    return cached?.weather ?? null;
  } finally {
    clearTimeout(timer);
  }
}
