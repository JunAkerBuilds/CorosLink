"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Select } from "@/components/ui";
import { loadMapToken, type RoutePoint } from "@/data/activities";
import { isPlaced, pointsPath, routePositionAt, routeSlice, type Span } from "@/lib/activities";
import { t } from "@/lib/i18n";
import { lightAt, ROUTE_MAP_TYPES, takesLighting, type RouteMapType } from "@/lib/routeMap";

// Mapbox is large and draws with WebGL: fetched only when a route can go on a real map, never on the server.
const ActivityMapbox = dynamic(() => import("./ActivityMapbox"), { ssr: false });

const ZOOMS = [1, 1.5, 2.25, 3.4];
/** A whole route plays in about this long, whatever its length. */
const PLAY_MS = 24_000;
const TICK_MS = 60;

/**
 * The route with start and finish pins and the marker the charts share, over a play button, a slider and the
 * readout at the marker. A recorded route is drawn on a Mapbox map with the phone app's map types and
 * time-of-day lighting; one without coordinates (the sample athlete), or a site with no map token, gets the
 * sketch in a 760 × 420 box.
 */
export function ActivityRoutePlayback({ route, distanceM, startedAt, at, span, label, hue, n, index, onIndex, readout, sample }: {
  route: readonly RoutePoint[];
  distanceM: number;
  /** When the activity started, for the light on the map. */
  startedAt: Date;
  /** Metres from the start at the marker, when the recording says. */
  at: number | null;
  /** A chosen split or lap, in metres, drawn brighter. */
  span: Span | null;
  label: string;
  hue: string;
  n: number;
  index: number;
  onIndex: (i: number) => void;
  readout: { label: string; value: ReactNode; color?: string }[];
  /** The sample athlete's sketch has a river and a park drawn in; a real route has only the grid. */
  sample?: boolean;
}) {
  const [zoom, setZoom] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [type, setType] = useState<RouteMapType>("standard");
  const [lit, setLit] = useState(true);
  const [follow, setFollow] = useState(false);
  const [fit, setFit] = useState(0);
  /** Undefined while the site is being asked for its map token, null when it has none. */
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const placed = isPlaced(route) ? route : null;
  const hasPlace = placed != null;
  useEffect(() => {
    if (!hasPlace) return;
    let current = true;
    loadMapToken().then((tok) => { if (current) setToken(tok); });
    return () => { current = false; };
  }, [hasPlace]);
  const mapped = placed && token && !failed ? { placed, token } : null;
  const waiting = hasPlace && token === undefined && !failed;
  const live = useRef({ index, n, onIndex });
  useEffect(() => { live.current = { index, n, onIndex }; });

  useEffect(() => {
    if (!playing) return;
    // A short recording steps one sample at a time, slowly; a long one jumps several each tick.
    const every = Math.max(TICK_MS, PLAY_MS / Math.max(1, live.current.n));
    const id = window.setInterval(() => {
      const { index: i, n: count, onIndex: move } = live.current;
      const next = Math.min(count - 1, i + Math.max(1, Math.round((count * every) / PLAY_MS)));
      move(next);
      if (next >= count - 1) setPlaying(false);
    }, every);
    return () => window.clearInterval(id);
  }, [playing]);

  const z = ZOOMS[zoom];
  const total = route[route.length - 1]?.d ?? 0;
  const here = at == null ? null : routePositionAt(route, at);
  const start = route[0], end = route[route.length - 1];
  // Zoomed in, the view follows the marker.
  const cx = zoom > 0 && here ? Math.max(380 / z, Math.min(760 - 380 / z, here.x)) : 380;
  const cy = zoom > 0 && here ? Math.max(210 / z, Math.min(420 - 210 / z, here.y)) : 210;
  const color = { stroke: `var(--h-${hue})` };
  const toggle = () => {
    if (!playing && index >= n - 1) onIndex(0);
    setPlaying((p) => !p);
  };

  return (
    <section aria-label={t("Map")} className="card ad-map">
      <div className="ad-map-box">
        {mapped ? (
          <div role="img" aria-label={label} className="ad-map-live">
            <ActivityMapbox
              accessToken={mapped.token} route={mapped.placed} distanceM={distanceM} at={at} span={span} type={type} hue={hue} follow={follow} fit={fit} onFail={fail}
              timeOfDay={lit ? lightAt(startedAt, mapped.placed[0].lat, mapped.placed[0].lon) : null}
            />
          </div>
        ) : waiting ? null : (
          <>
            <svg role="img" aria-label={label} width="100%" height="100%" viewBox={`${cx - 380 / z} ${cy - 210 / z} ${760 / z} ${420 / z}`} preserveAspectRatio="xMidYMid meet">
              {sample ? (
                <>
                  <path d="M-20 330C100 270 190 350 310 290S520 130 780 180" fill="none" stroke="rgba(92,207,230,0.2)" style={{ strokeWidth: 38, strokeLinecap: "round" }} />
                  <path d="M430 40h190v120h-190z" fill="rgba(83,203,161,0.07)" />
                </>
              ) : null}
              <path d="M0 90h760M0 210h760M0 360h760M150 0v420M400 0v420M640 0v420M0 20L300 420M520 0L760 300" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.055)" }} />
              <path d={pointsPath(route)} fill="none" style={{ ...color, strokeWidth: 4, strokeLinejoin: "round", strokeLinecap: "round", opacity: 0.35 }} />
              {at != null ? <path d={pointsPath(routeSlice(route, 0, at))} fill="none" style={{ ...color, strokeWidth: 4, strokeLinejoin: "round", strokeLinecap: "round" }} /> : null}
              {span ? <path d={pointsPath(routeSlice(route, span.from, Math.min(span.to, total)))} fill="none" style={{ stroke: "var(--fg)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} /> : null}
              <circle cx={start.x} cy={start.y} r="7" style={{ fill: `var(--h-${hue})`, stroke: "var(--fg)", strokeWidth: 2.5 }} />
              <circle cx={end.x} cy={end.y} r="7" style={{ fill: "var(--fg)", stroke: "var(--ad-pin-ring)", strokeWidth: 2.5 }} />
              {here ? (
                <>
                  <circle cx={here.x} cy={here.y} r="13" style={{ fill: `var(--h-${hue})`, opacity: 0.28 }} />
                  <circle cx={here.x} cy={here.y} r="6.5" style={{ fill: "var(--ad-pin-ring)", ...color, strokeWidth: 3 }} />
                </>
              ) : null}
            </svg>
            <div className="ad-map-zoom">
              <button type="button" aria-label={t("Zoom in")} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((v) => Math.min(ZOOMS.length - 1, v + 1))}>+</button>
              <button type="button" aria-label={t("Zoom out")} disabled={zoom === 0} onClick={() => setZoom((v) => Math.max(0, v - 1))}>−</button>
            </div>
            <span className="ad-map-note" role="status">{failed ? t("The map didn't load. This is the route as a sketch.") : t("Route sketch, map tiles not shown")}</span>
          </>
        )}
        {mapped ? (
          <>
            <div className="ad-map-top">
              <Select aria-label={t("Map type")} value={type} onChange={(e) => setType(e.target.value as RouteMapType)}>
                {ROUTE_MAP_TYPES.map((mt) => <option key={mt.value} value={mt.value}>{t(mt.label)}</option>)}
              </Select>
              {takesLighting(type) ? (
                <label className="ad-map-pill"><input type="checkbox" checked={lit} onChange={(e) => setLit(e.target.checked)} />{t("Time-of-day lighting")}</label>
              ) : null}
            </div>
            <div className="ad-map-bottom">
              <button type="button" className="ad-map-pill" aria-pressed={follow} onClick={() => setFollow((v) => !v)}>{t("Follow the marker")}</button>
              <button type="button" className="ad-map-pill" onClick={() => { setFollow(false); setFit((v) => v + 1); }}>{t("Show the whole route")}</button>
            </div>
          </>
        ) : null}
      </div>
      <div className="ad-play">
        <button type="button" className="ad-play-btn" aria-label={playing ? t("Pause") : t("Play the route")} aria-pressed={playing} onClick={toggle}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4l14 8-14 8z" />}</svg>
        </button>
        <input
          type="range" aria-label={t("Position along the route")} min={0} max={Math.max(0, n - 1)} value={index}
          onChange={(e) => { setPlaying(false); onIndex(Math.max(0, Math.min(n - 1, Number(e.target.value) || 0))); }}
        />
        <div className="ad-play-read">
          {readout.map((r) => (
            <div key={r.label}><span>{r.label}</span><span className="num" style={{ color: r.color }}>{r.value}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
}
