import { t } from "../../i18n/toolsLocale";
import type {
  RouteActivityType,
  RouteGeometry,
  RouteSurfacePreference
} from "../../../electron/types";
import { summarizeRouteMakeup } from "./routeMakeupModel";

/**
 * Pure view-model for Generate's loop choices: one card per loop with a
 * to-scale outline, the numbers athletes compare, and a short note on what
 * sets each runner-up apart from the best match.
 */

export interface LoopOptionCard {
  /** "Best match" for the planner's pick, else what the loop does better. */
  label: string;
  distanceMeters: number;
  ascentMeters?: number;
  /** Absent when the router returned no way-type breakdown. */
  carFreeShare?: number;
  /** Paved share, or unpaved share when `surfaceLabel` is "unpaved". */
  surfaceShare?: number;
  /** SVG path in a LOOP_SHAPE_WIDTH × LOOP_SHAPE_HEIGHT box shared by every card. */
  shapePath: string;
  start: { x: number; y: number } | null;
}

export interface LoopOptionCards {
  cards: LoopOptionCard[];
  surfaceLabel: "paved" | "unpaved";
}

export const LOOP_SHAPE_WIDTH = 100;
export const LOOP_SHAPE_HEIGHT = 64;
const SHAPE_PADDING = 4;
const SHAPE_MAX_POINTS = 160;
/** A runner-up must beat the best match by this much before we call it out. */
const CAR_FREE_MARGIN = 0.05;
const SURFACE_MARGIN = 0.1;
const CLIMB_MIN_METERS = 10;
const CLIMB_MIN_RATIO = 0.15;

interface OptionStats {
  carFree?: number;
  paved?: number;
  unpaved?: number;
}

function statsFor(option: RouteGeometry, activityType: RouteActivityType): OptionStats {
  if (!option.insights) {
    return {};
  }
  const makeup = summarizeRouteMakeup(option.insights, activityType, () => "");
  return {
    carFree: makeup.wayRows.length > 0 ? makeup.carFreeShare : undefined,
    paved: makeup.surfaceRows.length > 0 ? makeup.pavedShare : undefined,
    unpaved: makeup.surfaceRows.length > 0 ? makeup.unpavedShare : undefined
  };
}

/** The runner-up's strongest advantage over the best match, if it has one. */
function highlightFor(
  option: RouteGeometry,
  stats: OptionStats,
  best: RouteGeometry,
  bestStats: OptionStats,
  surfaceLabel: LoopOptionCards["surfaceLabel"]
): string {
  const traits: Array<{ text: string; strength: number }> = [];
  if (stats.carFree !== undefined && bestStats.carFree !== undefined) {
    const gain = stats.carFree - bestStats.carFree;
    if (gain >= CAR_FREE_MARGIN) traits.push({ text: t("More car-free"), strength: gain / CAR_FREE_MARGIN });
  }
  const share = surfaceLabel === "unpaved" ? stats.unpaved : stats.paved;
  const bestShare = surfaceLabel === "unpaved" ? bestStats.unpaved : bestStats.paved;
  if (share !== undefined && bestShare !== undefined && share - bestShare >= SURFACE_MARGIN) {
    traits.push({
      text: surfaceLabel === "unpaved" ? t("More trail") : t("More paved"),
      strength: (share - bestShare) / SURFACE_MARGIN
    });
  }
  if (option.ascentMeters !== undefined && best.ascentMeters !== undefined) {
    const difference = option.ascentMeters - best.ascentMeters;
    const threshold = Math.max(CLIMB_MIN_METERS, best.ascentMeters * CLIMB_MIN_RATIO);
    if (Math.abs(difference) >= threshold) {
      traits.push({
        text: difference < 0 ? t("Flatter") : t("Hillier"),
        strength: Math.abs(difference) / threshold
      });
    }
  }
  traits.sort((a, b) => b.strength - a.strength);
  return traits[0]?.text ?? t("Other streets");
}

/**
 * Outlines every loop centred in its own card but at one shared scale, sized
 * so the largest loop fills the box: sizes compare honestly, shapes stay big.
 */
function buildShapes(options: RouteGeometry[]): Array<Pick<LoopOptionCard, "shapePath" | "start">> {
  const firstPoint = options
    .flatMap((option) => option.points)
    .find((point) => point.lat !== undefined && point.lon !== undefined);
  if (!firstPoint) {
    return options.map(() => ({ shapePath: "", start: null }));
  }
  const lonScale = Math.cos((firstPoint.lat! * Math.PI) / 180);
  const tracks = options.map((option) => {
    const points = option.points
      .filter((point) => point.lat !== undefined && point.lon !== undefined)
      .map((point) => ({ x: point.lon! * lonScale, y: -point.lat! }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      points,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      spanX: Math.max(...xs) - Math.min(...xs),
      spanY: Math.max(...ys) - Math.min(...ys)
    };
  });
  const scale = Math.min(
    ...tracks
      .filter((track) => track.points.length > 0)
      .map((track) =>
        Math.min(
          (LOOP_SHAPE_WIDTH - SHAPE_PADDING * 2) / Math.max(track.spanX, 1e-9),
          (LOOP_SHAPE_HEIGHT - SHAPE_PADDING * 2) / Math.max(track.spanY, 1e-9)
        )
      )
  );

  return tracks.map((track) => {
    if (track.points.length === 0) {
      return { shapePath: "", start: null };
    }
    const offsetX = (LOOP_SHAPE_WIDTH - track.spanX * scale) / 2;
    const offsetY = (LOOP_SHAPE_HEIGHT - track.spanY * scale) / 2;
    const project = (point: { x: number; y: number }) => ({
      x: Math.round((offsetX + (point.x - track.minX) * scale) * 10) / 10,
      y: Math.round((offsetY + (point.y - track.minY) * scale) * 10) / 10
    });
    const stride = Math.max(1, Math.ceil(track.points.length / SHAPE_MAX_POINTS));
    const sampled = track.points.filter(
      (_, index) => index % stride === 0 || index === track.points.length - 1
    );
    const shapePath =
      sampled.length < 2
        ? ""
        : sampled
            .map(project)
            .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
            .join(" ");
    return { shapePath, start: project(track.points[0]!) };
  });
}

/** Cards for the best match (first) and its runner-ups, in the order given. */
export function buildLoopOptionCards(
  options: RouteGeometry[],
  activityType: RouteActivityType,
  surfacePreference: RouteSurfacePreference | undefined
): LoopOptionCards {
  const stats = options.map((option) => statsFor(option, activityType));
  const best = options[0];
  const bestStats = stats[0] ?? {};
  // Trail seekers judge loops by how much is off the tarmac.
  const surfaceLabel =
    surfacePreference === "trail" || (bestStats.unpaved ?? 0) > (bestStats.paved ?? 0)
      ? "unpaved"
      : "paved";
  const shapes = buildShapes(options);

  return {
    surfaceLabel,
    cards: options.map((option, index) => ({
      label:
        index === 0 || !best
          ? t("Best match")
          : highlightFor(option, stats[index]!, best, bestStats, surfaceLabel),
      distanceMeters: option.distanceMeters,
      ascentMeters: option.ascentMeters,
      carFreeShare: stats[index]!.carFree,
      surfaceShare: surfaceLabel === "unpaved" ? stats[index]!.unpaved : stats[index]!.paved,
      ...shapes[index]!
    }))
  };
}
