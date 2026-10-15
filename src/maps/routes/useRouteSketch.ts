import { t } from "../../i18n/toolsLocale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RouteActivityType,
  RouteGeometry,
  RouteWaypoint
} from "../../../electron/types";
import {
  pathCentroid,
  pathDistanceMeters,
  projectUnitShape,
  resampleWithCorners,
  shapeSimilarityScore,
  simplifyPath,
  sketchSpacingMeters,
  transformPath,
  type SketchFidelity,
  type SketchMatch
} from "../../../electron/routing/sketchGeometry";
import type { CorosLinkApi } from "../../coroslink-api";
import { SKETCH_TEMPLATES, type SketchTemplateId } from "./sketchShapes";
import { textToUnitPath } from "./strokeFont";
import { haversineMeters, toErrorMessage } from "./utils";

const ROUTE_DEBOUNCE_MS = 300;
const LOOP_CLOSE_THRESHOLD_M = 40;
/** Strokes are discrete gestures, so give the hand a beat before snapping. */
const FREEHAND_SNAP_DELAY_MS = 600;
const DEFAULT_SIZE_METERS = 1000;
/** Courtesy pause between sequential Auto-fit requests to public BRouter. */
const AUTO_FIT_PAUSE_MS = 300;
/** Scale sweep (~√2 steps, half to double size) tried at the placed rotation. */
const AUTO_FIT_SCALES = [0.5, 0.7, 1, 1.4, 2];
/** Rotation candidates tried at the winning scale (0° covered by stage 1). */
const AUTO_FIT_ROTATIONS = [-20, 20];
/**
 * Bigger shapes score better almost automatically (street blocks become
 * relatively finer), so ranking adds this per-size-octave penalty; a size
 * change must genuinely improve the shape to win. Display keeps the raw score.
 */
const SCALE_CHANGE_PENALTY = 0.05;
/** Candidate outlines outside this perimeter range are skipped. */
const MIN_SHAPE_PERIMETER_M = 400;
const MAX_SHAPE_PERIMETER_M = 50_000;
/** Template/text size slider bounds (candidates must stay writable). */
const MIN_SIZE_METERS = 200;
const MAX_SIZE_METERS = 8000;

export type SketchTool = "freehand" | "template" | "text";

export interface AutoFitProgress {
  step: number;
  total: number;
}

export interface AutoFitResult {
  scale: number;
  rotationDeg: number;
}

export interface RouteSketch {
  tool: SketchTool;
  setTool: (tool: SketchTool) => void;
  fidelity: SketchFidelity;
  setFidelity: (fidelity: SketchFidelity) => void;
  /** The original sketch outline, before street snapping. */
  ghost: RouteWaypoint[];
  ghostDistanceMeters: number;
  addStroke: (stroke: RouteWaypoint[]) => void;
  undoStroke: () => void;
  canUndoStroke: boolean;
  templateId: SketchTemplateId;
  setTemplateId: (id: SketchTemplateId) => void;
  /** Anchor for template/text placement; set by map click, moved by drag. */
  center: RouteWaypoint | null;
  setCenter: (point: RouteWaypoint) => void;
  sizeMeters: number;
  setSizeMeters: (meters: number) => void;
  rotationDeg: number;
  setRotationDeg: (degrees: number) => void;
  text: string;
  setText: (text: string) => void;
  /** Snap waypoints; draggable/removable once a snap has run. */
  waypoints: RouteWaypoint[];
  geometry: RouteGeometry | null;
  routing: boolean;
  error: string | null;
  closed: boolean;
  hasRoute: boolean;
  canSnap: boolean;
  /** How closely the current route reproduces the sketch (null before snap). */
  match: SketchMatch | null;
  snapNow: () => void;
  /** Searches size/rotation candidates and applies the best-scoring snap. */
  autoFit: () => void;
  autoFitProgress: AutoFitProgress | null;
  /** Winning transform of the last Auto fit (identity when manual). */
  autoFitResult: AutoFitResult | null;
  moveWaypoint: (index: number, point: RouteWaypoint) => void;
  removeWaypoint: (index: number) => void;
  clear: () => void;
}

/**
 * Owns the GPS-art sketch state: the un-snapped ghost outline (freehand
 * strokes, a placed template, or projected text) plus the street-snapped
 * waypoints/geometry kept in sync via `api.routeWaypoints`, following the
 * useRouteDraw debounce + stale-drop conventions. Corners of the sketch are
 * guaranteed vias, and Auto fit searches nearby scales/rotations for the
 * best-scoring snap.
 */
export function useRouteSketch(
  api: CorosLinkApi,
  activityType: RouteActivityType
): RouteSketch {
  const [tool, setTool] = useState<SketchTool>("freehand");
  const [fidelity, setFidelity] = useState<SketchFidelity>("balanced");
  const [strokes, setStrokes] = useState<RouteWaypoint[][]>([]);
  const [templateId, setTemplateId] = useState<SketchTemplateId>("heart");
  const [center, setCenter] = useState<RouteWaypoint | null>(null);
  const [sizeMeters, setSizeMeters] = useState(DEFAULT_SIZE_METERS);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [text, setText] = useState("");
  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
  const [geometry, setGeometry] = useState<RouteGeometry | null>(null);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFitProgress, setAutoFitProgress] = useState<AutoFitProgress | null>(
    null
  );
  const [autoFitResult, setAutoFitResult] = useState<AutoFitResult | null>(null);

  // Guards against out-of-order responses when the user edits mid-request.
  const requestSeq = useRef(0);
  // One automatic coarser retry per snap; waypoint edits never auto-retry.
  const retryRef = useRef<{ spacing: number; used: boolean } | null>(null);
  // Auto fit already routed these waypoints — the effect must not re-request.
  const presetRef = useRef<{
    waypoints: RouteWaypoint[];
    geometry: RouteGeometry;
  } | null>(null);
  // Bumped by clear/tool switches to abandon an in-flight Auto fit search.
  const autoFitGen = useRef(0);

  const ghost = useMemo<RouteWaypoint[]>(() => {
    if (tool === "freehand") {
      return strokes.flat();
    }
    if (!center) {
      return [];
    }
    if (tool === "template") {
      const template = SKETCH_TEMPLATES.find((entry) => entry.id === templateId);
      return template
        ? projectUnitShape(template.points, center, sizeMeters, rotationDeg)
        : [];
    }
    const path = textToUnitPath(text);
    return path.length >= 2
      ? projectUnitShape(path, center, sizeMeters, rotationDeg)
      : [];
  }, [tool, strokes, center, templateId, sizeMeters, rotationDeg, text]);

  const ghostDistanceMeters = useMemo(() => pathDistanceMeters(ghost), [ghost]);

  const match = useMemo<SketchMatch | null>(() => {
    if (!geometry || geometry.points.length < 2 || ghost.length < 2) {
      return null;
    }
    const routePoints = geometry.points
      .filter((point) => point.lat !== undefined && point.lon !== undefined)
      .map((point) => ({ lat: point.lat!, lon: point.lon! }));
    return shapeSimilarityScore(routePoints, ghost);
  }, [geometry, ghost]);

  const outlineToWaypoints = useCallback(
    (outline: RouteWaypoint[], spacingMeters: number): RouteWaypoint[] => {
      if (outline.length < 2) {
        return [];
      }
      const cleaned = simplifyPath(
        outline,
        Math.max(5, pathDistanceMeters(outline) / 500)
      );
      return resampleWithCorners(cleaned, spacingMeters);
    },
    []
  );

  const buildWaypoints = useCallback(
    (spacingMeters: number): RouteWaypoint[] =>
      outlineToWaypoints(ghost, spacingMeters),
    [ghost, outlineToWaypoints]
  );

  const snapNow = useCallback(() => {
    const spacing = sketchSpacingMeters(ghostDistanceMeters, fidelity);
    const next = buildWaypoints(spacing);
    if (next.length < 2) {
      return;
    }
    retryRef.current = { spacing, used: false };
    presetRef.current = null;
    setAutoFitResult(null);
    setError(null);
    setWaypoints(next);
  }, [buildWaypoints, ghostDistanceMeters, fidelity]);

  // Route (snap) the current waypoints, debounced, dropping stale responses.
  useEffect(() => {
    if (waypoints.length < 2) {
      setGeometry(null);
      setRouting(false);
      return;
    }

    // Auto fit routed this exact waypoint set already — adopt its result.
    const preset = presetRef.current;
    if (preset && preset.waypoints === waypoints) {
      presetRef.current = null;
      requestSeq.current += 1;
      setGeometry(preset.geometry);
      setRouting(false);
      setError(null);
      return;
    }

    const seq = ++requestSeq.current;
    setRouting(true);
    const timer = setTimeout(() => {
      void api
        .routeWaypoints({ waypoints, activityType, snap: true })
        .then((next) => {
          if (seq === requestSeq.current) {
            setGeometry(next);
            setError(null);
          }
        })
        .catch((caught) => {
          if (seq !== requestSeq.current) {
            return;
          }
          // Retry once with half the waypoints: sparser vias give the router
          // room when the sketch crosses unroutable ground.
          const retry = retryRef.current;
          if (retry && !retry.used) {
            retry.used = true;
            const coarser = buildWaypoints(retry.spacing * 2);
            if (coarser.length >= 2 && coarser.length < waypoints.length) {
              setWaypoints(coarser);
              return;
            }
          }
          setError(toErrorMessage(caught));
        })
        .finally(() => {
          if (seq === requestSeq.current) {
            setRouting(false);
          }
        });
    }, ROUTE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // buildWaypoints is deliberately omitted: it changes with the ghost, and
    // ghost edits must not re-trigger routing until the user snaps again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, waypoints, activityType]);

  // Freehand strokes auto-snap shortly after the pen lifts.
  useEffect(() => {
    if (tool !== "freehand" || strokes.length === 0) {
      return;
    }
    const timer = setTimeout(snapNow, FREEHAND_SNAP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, tool]);

  const runAutoFit = useCallback(async () => {
    if (ghost.length < 2) {
      return;
    }
    const gen = ++autoFitGen.current;
    const anchor = tool === "freehand" ? pathCentroid(ghost) : center;
    if (!anchor) {
      return;
    }
    // Sweep sizes from half to double, skipping unreasonable/unwritable ones.
    const scaleCandidates = AUTO_FIT_SCALES.filter((scale) => {
      const perimeter = ghostDistanceMeters * scale;
      if (
        perimeter < MIN_SHAPE_PERIMETER_M ||
        perimeter > MAX_SHAPE_PERIMETER_M
      ) {
        return false;
      }
      if (tool !== "freehand") {
        const size = sizeMeters * scale;
        return size >= MIN_SIZE_METERS && size <= MAX_SIZE_METERS;
      }
      return true;
    });
    if (!scaleCandidates.includes(1)) {
      scaleCandidates.push(1);
    }
    const total = scaleCandidates.length + AUTO_FIT_ROTATIONS.length;
    setError(null);
    setAutoFitResult(null);
    setAutoFitProgress({ step: 0, total });

    interface Candidate {
      scale: number;
      rotation: number;
    }
    interface CandidateResult {
      candidate: Candidate;
      waypoints: RouteWaypoint[];
      geometry: RouteGeometry;
      match: SketchMatch;
    }

    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tryCandidate = async (
      candidate: Candidate,
      step: number
    ): Promise<CandidateResult | null> => {
      setAutoFitProgress({ step, total });
      const shape = transformPath(
        ghost,
        anchor,
        candidate.scale,
        candidate.rotation
      );
      const spacing = sketchSpacingMeters(pathDistanceMeters(shape), fidelity);
      const vias = outlineToWaypoints(shape, spacing);
      if (vias.length < 2) {
        return null;
      }
      try {
        const routed = await api.routeWaypoints({
          waypoints: vias,
          activityType,
          snap: true
        });
        const routePoints = routed.points
          .filter((point) => point.lat !== undefined && point.lon !== undefined)
          .map((point) => ({ lat: point.lat!, lon: point.lon! }));
        return {
          candidate,
          waypoints: vias,
          geometry: routed,
          match: shapeSimilarityScore(routePoints, shape)
        };
      } catch {
        return null;
      }
    };

    // Rank with the size-change penalty so growth must earn its keep.
    const effectiveScore = (result: CandidateResult): number =>
      result.match.score +
      SCALE_CHANGE_PENALTY * Math.abs(Math.log2(result.candidate.scale));

    const results: CandidateResult[] = [];
    let step = 0;
    for (const scale of scaleCandidates) {
      if (gen !== autoFitGen.current) {
        return;
      }
      step += 1;
      const result = await tryCandidate({ scale, rotation: 0 }, step);
      if (result) {
        results.push(result);
      }
      await pause(AUTO_FIT_PAUSE_MS);
    }
    const bestScale =
      results.length > 0
        ? results.reduce((a, b) => (effectiveScore(b) < effectiveScore(a) ? b : a))
            .candidate.scale
        : 1;
    for (const rotation of AUTO_FIT_ROTATIONS) {
      if (gen !== autoFitGen.current) {
        return;
      }
      step += 1;
      const result = await tryCandidate({ scale: bestScale, rotation }, step);
      if (result) {
        results.push(result);
      }
      await pause(AUTO_FIT_PAUSE_MS);
    }
    if (gen !== autoFitGen.current) {
      return;
    }
    setAutoFitProgress(null);
    if (results.length === 0) {
      setError(
        t("Auto fit couldn't route this shape here — try moving it toward more streets.")
      );
      return;
    }

    const winner = results.reduce((a, b) =>
      effectiveScore(b) < effectiveScore(a) ? b : a
    );
    // Adopt the winning transform so the ghost/sliders reflect what routed.
    if (tool === "freehand") {
      setStrokes((current) =>
        current.map((stroke) =>
          transformPath(stroke, anchor, winner.candidate.scale, winner.candidate.rotation)
        )
      );
    } else {
      setSizeMeters((current) =>
        Math.round((current * winner.candidate.scale) / 10) * 10
      );
      setRotationDeg(
        (current) => ((current + winner.candidate.rotation) % 360 + 360) % 360
      );
    }
    retryRef.current = null;
    presetRef.current = { waypoints: winner.waypoints, geometry: winner.geometry };
    setWaypoints(winner.waypoints);
    setAutoFitResult({
      scale: winner.candidate.scale,
      rotationDeg: winner.candidate.rotation
    });
  }, [
    api,
    activityType,
    ghost,
    ghostDistanceMeters,
    tool,
    center,
    sizeMeters,
    fidelity,
    outlineToWaypoints
  ]);

  const autoFit = useCallback(() => {
    void runAutoFit();
  }, [runAutoFit]);

  const addStroke = useCallback((stroke: RouteWaypoint[]) => {
    if (stroke.length < 2) {
      return;
    }
    setStrokes((current) => [...current, stroke]);
  }, []);

  const undoStroke = useCallback(() => {
    autoFitGen.current += 1;
    setStrokes((current) => current.slice(0, -1));
    setWaypoints([]);
    setGeometry(null);
    setError(null);
    setAutoFitProgress(null);
    setAutoFitResult(null);
  }, []);

  const moveWaypoint = useCallback((index: number, point: RouteWaypoint) => {
    retryRef.current = null;
    setWaypoints((current) =>
      current.map((existing, i) => (i === index ? point : existing))
    );
  }, []);

  const removeWaypoint = useCallback((index: number) => {
    retryRef.current = null;
    setWaypoints((current) => current.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    autoFitGen.current += 1;
    setStrokes([]);
    setWaypoints([]);
    setGeometry(null);
    setError(null);
    setText("");
    setCenter(null);
    setRotationDeg(0);
    setSizeMeters(DEFAULT_SIZE_METERS);
    setAutoFitProgress(null);
    setAutoFitResult(null);
  }, []);

  const switchTool = useCallback((next: SketchTool) => {
    autoFitGen.current += 1;
    setTool(next);
    setWaypoints([]);
    setGeometry(null);
    setError(null);
    setAutoFitProgress(null);
    setAutoFitResult(null);
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
    tool,
    setTool: switchTool,
    fidelity,
    setFidelity,
    ghost,
    ghostDistanceMeters,
    addStroke,
    undoStroke,
    canUndoStroke: strokes.length > 0,
    templateId,
    setTemplateId,
    center,
    setCenter,
    sizeMeters,
    setSizeMeters,
    rotationDeg,
    setRotationDeg,
    text,
    setText,
    waypoints,
    geometry,
    routing,
    error,
    closed,
    hasRoute: Boolean(geometry && geometry.points.length >= 2),
    canSnap: ghost.length >= 2,
    match,
    snapNow,
    autoFit,
    autoFitProgress,
    autoFitResult,
    moveWaypoint,
    removeWaypoint,
    clear
  };
}
