// Test stand-ins (no network): a clock that moves only when slept, and a fake brouter.de.
import type { LatLon } from "../../../maps/types";
import { lengthOf } from "./geo";
import type { Net } from "./net";

export function fakeClock(start = 1_800_000_000_000) {
  let now = start;
  const slept: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => { slept.push(ms); now += ms; },
    advance: (ms: number) => { now += ms; },
    slept,
  };
}

export function netWith(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, clock = fakeClock()): Net & { clock: ReturnType<typeof fakeClock> } {
  return { fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetchImpl(String(input), init)) as typeof fetch, now: clock.now, sleep: clock.sleep, clock };
}

/** A straight line through the asked points, with a residential, asphalt way tag. */
export function brouterAnswer(points: LatLon[], tags = "highway=residential surface=asphalt", ele = 100): Response {
  const coordinates = points.map((p, i) => [p[1], p[0], ele + i]);
  const length = Math.round(lengthOf(points));
  return Response.json({
    features: [{
      geometry: { coordinates },
      properties: { "track-length": String(length), "filtered ascend": String(points.length - 1), messages: [["Longitude", "Latitude", "Distance", "WayTags"], ["0", "0", String(length), tags]] },
    }],
  });
}

export const lonlatsOf = (url: string): LatLon[] =>
  (new URL(url).searchParams.get("lonlats") ?? "").split("|").map((pair) => { const [lon, lat] = pair.split(",").map(Number); return [lat, lon]; });

/** brouter.de: profile uploads answer an id; routes answer a line through the points. */
export function fakeBrouter(opts: { delayMs?: number; tags?: (url: string) => string } = {}) {
  const calls: string[] = [];
  let inFlight = 0, maxInFlight = 0, uploads = 0;
  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (url.endsWith("/profile") && init?.method === "POST") { uploads++; return Response.json({ profileid: `custom_${uploads}` }); }
      return brouterAnswer(lonlatsOf(url), opts.tags?.(url));
    } finally {
      inFlight--;
    }
  };
  return { handler, calls, get maxInFlight() { return maxInFlight; }, get uploads() { return uploads; } };
}
