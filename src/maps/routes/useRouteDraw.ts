import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RouteActivityType,
  RouteGeometry,
  RouteSurfacePreference,
  RouteWaypoint
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { haversineMeters, toErrorMessage } from "./utils";

const ROUTE_DEBOUNCE_MS = 300;
const LOOP_CLOSE_THRESHOLD_M = 40;

export interface RouteDraw {
  waypoints: RouteWaypoint[];
  geometry: RouteGeometry | null;
  snap: boolean;
  routing: boolean;
  error: string | null;
  /** True when the last waypoint is back at the start (a closed loop). */
  closed: boolean;
  canUndo: boolean;
  hasRoute: boolean;
  addPoint: (point: RouteWaypoint) => void;
  movePoint: (index: number, point: RouteWaypoint) => void;
  removePoint: (index: number) => void;
  undo: () => void;
  clear: () => void;
  closeLoop: () => void;
  setSnap: (snap: boolean) => void;
}

/**
 * Owns the interactive draw waypoints and keeps a routed geometry in sync by
 * (debounced) calling `api.routeWaypoints`. Snapping follows real paths; when
 * off, legs are straight lines resolved locally without a round-trip.
 */
export function useRouteDraw(
  api: CorosLinkApi,
  activityType: RouteActivityType,
  surfacePreference: RouteSurfacePreference
): RouteDraw {
  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
  const [geometry, setGeometry] = useState<RouteGeometry | null>(null);
  const [snap, setSnap] = useState(true);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against out-of-order responses when the user edits mid-request.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (waypoints.length < 2) {
      setGeometry(null);
      setRouting(false);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setRouting(true);
    const timer = setTimeout(() => {
      void api
        .routeWaypoints({ waypoints, activityType, snap, surfacePreference })
        .then((next) => {
          if (seq === requestSeq.current) {
            setGeometry(next);
            setError(null);
          }
        })
        .catch((caught) => {
          if (seq === requestSeq.current) {
            setError(toErrorMessage(caught));
          }
        })
        .finally(() => {
          if (seq === requestSeq.current) {
            setRouting(false);
          }
        });
    }, ROUTE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [api, waypoints, activityType, snap, surfacePreference]);

  const addPoint = useCallback((point: RouteWaypoint) => {
    setWaypoints((current) => [...current, point]);
  }, []);

  const movePoint = useCallback((index: number, point: RouteWaypoint) => {
    setWaypoints((current) =>
      current.map((existing, i) => (i === index ? point : existing))
    );
  }, []);

  const removePoint = useCallback((index: number) => {
    setWaypoints((current) => current.filter((_, i) => i !== index));
  }, []);

  const undo = useCallback(() => {
    setWaypoints((current) => current.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setWaypoints([]);
    setGeometry(null);
    setError(null);
  }, []);

  const closeLoop = useCallback(() => {
    setWaypoints((current) => {
      if (current.length < 3) {
        return current;
      }
      const first = current[0]!;
      const last = current[current.length - 1]!;
      if (
        haversineMeters(first.lat, first.lon, last.lat, last.lon) <
        LOOP_CLOSE_THRESHOLD_M
      ) {
        return current;
      }
      return [...current, { lat: first.lat, lon: first.lon }];
    });
  }, []);

  const closed =
    waypoints.length >= 3 &&
    haversineMeters(
      waypoints[0]!.lat,
      waypoints[0]!.lon,
      waypoints[waypoints.length - 1]!.lat,
      waypoints[waypoints.length - 1]!.lon
    ) < LOOP_CLOSE_THRESHOLD_M;

  return {
    waypoints,
    geometry,
    snap,
    routing,
    error,
    closed,
    canUndo: waypoints.length > 0,
    hasRoute: Boolean(geometry && geometry.points.length >= 2),
    addPoint,
    movePoint,
    removePoint,
    undo,
    clear,
    closeLoop,
    setSnap
  };
}
