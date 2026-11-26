// Place search: OpenStreetMap's Nominatim. Its policy asks for an identifying User-Agent and at most one request a
// second, so every call waits its turn with 1.1 s between starts. Requests carry the typed text or the point only.
import type { Place } from "../../../maps/types";
import { asProblem, RoutingProblem, Spacer, USER_AGENT, type Net } from "./net";
import { t } from "@/lib/i18n";

const BASE = "https://nominatim.openstreetmap.org";
export const NOMINATIM_GAP_MS = 1_100;

interface Found { lat?: string; lon?: string; name?: string; display_name?: string }

export class Nominatim {
  private readonly spacer: Spacer;
  constructor(private readonly net: Net) {
    this.spacer = new Spacer(net, NOMINATIM_GAP_MS);
  }

  async search(q: string, limit = 6): Promise<Place[]> {
    const text = q.trim().slice(0, 200);
    if (text.length < 2) return [];
    const url = new URL(`${BASE}/search`);
    url.searchParams.set("q", text);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(Math.max(1, Math.min(10, limit))));
    const found = await this.get<Found[]>(url);
    return (Array.isArray(found) ? found : []).flatMap((f) => toPlace(f) ?? []);
  }

  async reverse(lat: number, lon: number): Promise<Place> {
    const url = new URL(`${BASE}/reverse`);
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lon.toFixed(6));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("zoom", "16");
    const found = await this.get<Found>(url).catch((e: unknown) => {
      if (e instanceof RoutingProblem && e.code === "not_found") return {} as Found;
      throw e;
    });
    return toPlace({ ...found, lat: String(lat), lon: String(lon) }) ?? { name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
  }

  private get<T>(url: URL): Promise<T> {
    return this.spacer.run(async () => {
      let res: Response;
      try {
        res = await this.net.fetch(url.toString(), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      } catch (e) {
        throw asProblem(e, "Place search");
      }
      if (res.status === 429) throw new RoutingProblem(t("Place search is busy. Try again in a minute."), "busy", 503);
      if (res.status === 404) throw new RoutingProblem(t("Nothing found there."), "not_found", 404);
      if (!res.ok) throw new RoutingProblem(t("Place search had a problem ({status}). Try again.", { status: res.status }), "search", 502);
      return (await res.json()) as T;
    });
  }
}

function toPlace(f: Found): Place | null {
  const lat = Number(f.lat), lon = Number(f.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const parts = (f.display_name ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const name = f.name?.trim() || parts[0] || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const rest = parts[0] === name ? parts.slice(1) : parts;
  return { name, ...(rest.length ? { detail: rest.join(", ") } : {}), lat, lon };
}
