// BRouter: the free, keyless OpenStreetMap router at brouter.de, answering GeoJSON with [lon, lat, ele] points,
// length, filtered ascent and per-segment way tags.
//
// brouter.de is a community server. It throttles bursty clients ("403 Please, retry later!") and, under load, kills a
// client's oldest request, so every call here goes through one gate: at most two requests at a time, 150 ms between
// starts, at most 30 a minute (refused after ~36 at a steady 1/s, measured 2026-10-15), and a 30 s pause after a
// throttle answer so parallel requests stop too. Our profiles are uploaded once and their `custom_…` id kept 6 h
// (brouter.de prunes uploads eventually); if the upload fails we route with brouter.de's stock profile for a while.
import { createHash } from "node:crypto";
import type { LatLon, TrackPoint } from "../../../maps/types";
import { lengthOf, trackPoint } from "./geo";
import { makeupOf, segmentsFrom, tallyOf, type Routed } from "./makeup";
import { asProblem, isTimeout, RoutingProblem, USER_AGENT, type Net } from "./net";
import { isCycling, profileText, routerFor, STOCK_PROFILE, type ProfileOptions } from "./sports";
import { t } from "@/lib/i18n";

const BASE = "https://brouter.de/brouter";
export const BROUTER_MAX_CONCURRENT = 2;
export const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;
const PROFILE_DOWN_MS = 2 * 60 * 1000;
const SPACING_MS = 150;
const WINDOW_MS = 60_000;
const PER_WINDOW = 30;
const MAX_BUDGET_WAIT_MS = 10_000;
const THROTTLED_MS = 30_000;
const RETRY_MS = [600, 1_500];
const ROUTE_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15_000;

class HttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`brouter.de answered ${status}`);
  }
}
class ProfileDown extends Error {}

const busy = (seconds: number) =>
  new RoutingProblem(t("brouter.de, the free routing service, asks us to slow down. Try again in about {seconds} seconds.", { seconds }), "busy", 503);

interface Payload { features?: { geometry?: { coordinates?: number[][] }; properties?: Record<string, unknown> }[] }

export class BRouter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private lastStart = Number.NEGATIVE_INFINITY;
  private readonly recent: number[] = [];
  private throttledUntil = 0;
  private readonly profiles = new Map<string, { id: string; until: number }>();
  private readonly uploads = new Map<string, Promise<string>>();
  private profilesDownUntil = 0;

  constructor(private readonly net: Net) {}

  /** Requests that can go now without tripping the throttle (the loop planner spends these). */
  available(): number {
    const now = this.net.now();
    if (this.throttledUntil > now) return 0;
    this.prune(now);
    return Math.max(0, PER_WINDOW - this.recent.length);
  }

  /** Routes through the points (two or more) with C-LINK's profile, falling back to the stock one. */
  async route(points: LatLon[], o: ProfileOptions): Promise<Routed> {
    if (points.length < 2) throw new RoutingProblem(t("Add at least two points."), "points");
    try {
      return await this.withOurProfile(points, o);
    } catch (e) {
      // Unroutable points, a throttle or a slow server won't do better on the stock profile.
      if (e instanceof RoutingProblem || isTimeout(e)) throw asProblem(e, "The routing service");
      if (e instanceof HttpError && e.status === 400) throw unroutable(e.body);
    }
    try {
      return { ...(await this.request(points, STOCK_PROFILE[routerFor(o.sport)], o)), stock: true };
    } catch (e) {
      if (e instanceof HttpError) throw e.status === 400 ? unroutable(e.body) : new RoutingProblem(serviceError(e), "routing", 502);
      throw asProblem(e, "The routing service");
    }
  }

  private async withOurProfile(points: LatLon[], o: ProfileOptions): Promise<Routed> {
    const text = profileText(o);
    const id = await this.profileId(text);
    try {
      return await this.request(points, id, o);
    } catch (e) {
      // An id the server has dropped comes back as a bare 500: upload again once.
      if (e instanceof HttpError && e.status === 500 && !e.body.trim()) {
        this.profiles.delete(hash(text));
        return this.request(points, await this.profileId(text), o);
      }
      throw e;
    }
  }

  /** The `custom_…` id for this profile text, uploading it when it isn't cached (or is over 6 h old). */
  async profileId(text: string): Promise<string> {
    const key = hash(text);
    const cached = this.profiles.get(key);
    if (cached && cached.until > this.net.now()) return cached.id;
    const pending = this.uploads.get(key);
    if (pending) return pending;
    if (this.profilesDownUntil > this.net.now()) throw new ProfileDown();
    const upload = this.upload(text)
      .then((id) => { this.profiles.set(key, { id, until: this.net.now() + PROFILE_TTL_MS }); return id; })
      .catch((e: unknown) => {
        if (e instanceof RoutingProblem) throw e;
        this.profilesDownUntil = this.net.now() + PROFILE_DOWN_MS;
        throw new ProfileDown(String(e));
      })
      .finally(() => this.uploads.delete(key));
    this.uploads.set(key, upload);
    return upload;
  }

  private async upload(text: string): Promise<string> {
    const body = await this.send(`${BASE}/profile`, {
      method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", "User-Agent": USER_AGENT }, body: text,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const parsed = JSON.parse(body) as { profileid?: unknown; error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) throw new Error(parsed.error);
    if (typeof parsed.profileid !== "string" || !parsed.profileid.startsWith("custom_")) throw new Error("no profile id");
    return parsed.profileid;
  }

  private async request(points: LatLon[], profile: string, o: ProfileOptions): Promise<Routed> {
    const url = new URL(BASE);
    url.searchParams.set("lonlats", points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join("|"));
    url.searchParams.set("profile", profile);
    url.searchParams.set("alternativeidx", "0");
    url.searchParams.set("format", "geojson");
    const body = await this.send(url.toString(), { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
    return fromGeoJson(JSON.parse(body) as Payload, isCycling(o.sport));
  }

  /** One HTTP call through the gate, retrying dropped connections and overload answers (never timeouts). */
  private send(url: string, init: RequestInit): Promise<string> {
    return this.inSlot(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await this.token();
          const res = await this.net.fetch(url, init);
          const body = await res.text().catch(() => "");
          if (res.status === 429 || (res.status === 403 && /retry later|too many|rate/i.test(body))) {
            this.throttledUntil = this.net.now() + THROTTLED_MS;
            throw busy(THROTTLED_MS / 1000);
          }
          if (!res.ok) throw new HttpError(res.status, body);
          return body;
        } catch (e) {
          const transient = e instanceof TypeError ||
            (e instanceof HttpError && ([502, 503, 504].includes(e.status) || /watchdog|overload|too many/i.test(e.body)));
          if (attempt >= RETRY_MS.length || !transient || isTimeout(e)) throw e;
          await this.net.sleep(RETRY_MS[attempt]);
        }
      }
    });
  }

  private async inSlot<T>(task: () => Promise<T>): Promise<T> {
    this.checkThrottle();
    while (this.active >= BROUTER_MAX_CONCURRENT) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** Spaces and budgets each HTTP call, retries included. */
  private async token(): Promise<void> {
    this.checkThrottle();
    this.prune(this.net.now());
    if (this.recent.length >= PER_WINDOW) {
      const wait = this.recent[0] + WINDOW_MS - this.net.now();
      if (wait > MAX_BUDGET_WAIT_MS) throw busy(Math.ceil(wait / 1000));
      await this.net.sleep(wait);
      this.prune(this.net.now());
    }
    const gap = this.lastStart + SPACING_MS - this.net.now();
    if (gap > 0) await this.net.sleep(gap);
    this.checkThrottle();
    this.lastStart = this.net.now();
    this.recent.push(this.lastStart);
  }

  private checkThrottle(): void {
    const left = this.throttledUntil - this.net.now();
    if (left > 0) throw busy(Math.ceil(left / 1000));
  }

  private prune(now: number): void {
    while (this.recent.length && now - this.recent[0] >= WINDOW_MS) this.recent.shift();
  }
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function unroutable(body: string): RoutingProblem {
  if (/datafile.*not found|segment.*not.*found/i.test(body)) return new RoutingProblem(t("There's no routing data for this area yet."), "no_route", 422);
  return new RoutingProblem(t("No path was found near one of your points. Move it closer to a road or trail, or pick another sport."), "no_route", 422);
}

function serviceError(e: HttpError): string {
  return `The routing service had a problem (${e.status}). Try again in a moment.`;
}

/** BRouter's GeoJSON → a routed line with its makeup. Exported for tests. */
export function fromGeoJson(payload: Payload, cycling: boolean): Routed {
  const feature = payload.features?.[0];
  const coords = feature?.geometry?.coordinates?.filter((c) => c.length >= 2) ?? [];
  if (coords.length < 2) throw new RoutingProblem(t("No path was found near one of your points. Move it closer to a road or trail."), "no_route", 422);
  const points: TrackPoint[] = coords.map((c) => trackPoint(c[1], c[0], c[2]));
  const num = (key: string) => {
    const v = Number(feature?.properties?.[key]);
    return feature?.properties?.[key] === undefined || !Number.isFinite(v) ? undefined : v;
  };
  const distanceM = Math.round(num("track-length") ?? lengthOf(points));
  const ascentM = Math.round(num("filtered ascend") ?? 0);
  // Net change = ascent − descent, so the filtered descent follows from the ends' heights.
  const first = points[0][2], last = points[points.length - 1][2];
  const descentM = first !== undefined && last !== undefined ? Math.max(0, Math.round(ascentM + first - last)) : ascentM;
  const tally = tallyOf(segmentsFrom(feature?.properties?.messages), points, cycling);
  return { points, distanceM, ascentM, descentM, makeup: makeupOf(tally), tally };
}
