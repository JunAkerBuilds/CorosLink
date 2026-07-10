import {
  geoCentroid,
  geoDistance,
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import type { Feature, MultiPoint } from "geojson";
import { ArrowRight, LockKeyhole, MapPin } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { feature } from "topojson-client";
import type {
  GeometryCollection,
  Topology,
} from "topojson-specification";
import landAtlas from "world-atlas/land-110m.json";
import type {
  TrainingHubActivityDetail,
  TrainingHubTrackPoint,
} from "../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
} from "../training/formatters";

interface ActivityGlobeCardProps {
  activityCount: number;
  connected: boolean;
  detail: TrainingHubActivityDetail | null;
  loading: boolean;
  onOpenTraining: () => void;
}

interface GlobePoint {
  lat: number;
  lon: number;
}

type LandTopology = Topology<{ land: GeometryCollection }>;

const topology = landAtlas as unknown as LandTopology;
const land = feature(topology, topology.objects.land);
const graticule = geoGraticule10();
const MAX_RENDERED_POINTS = 900;

function isGlobePoint(
  point: TrainingHubTrackPoint,
): point is GlobePoint {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180
  );
}

function samplePoints(points: GlobePoint[]): GlobePoint[] {
  if (points.length <= MAX_RENDERED_POINTS) {
    return points;
  }

  const step = points.length / MAX_RENDERED_POINTS;
  return Array.from(
    { length: MAX_RENDERED_POINTS },
    (_, index) => points[Math.floor(index * step)]!,
  );
}

function initialRotation(points: GlobePoint[]): [number, number, number] {
  if (points.length === 0) {
    return [20, -18, 0];
  }

  const route: Feature<MultiPoint> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPoint",
      coordinates: points.map((point) => [point.lon, point.lat]),
    },
  };
  const [longitude, latitude] = geoCentroid(route);
  return [-longitude, -latitude, 0];
}

function formatActivitySummary(
  detail: TrainingHubActivityDetail | null,
  pointCount: number,
): string {
  if (!detail || pointCount === 0) {
    return "No GPS trace available";
  }

  const values = [
    detail.distance ? formatDistanceMeters(detail.distance) : null,
    detail.duration ? formatDurationSeconds(detail.duration) : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" / ") : "Latest GPS trace";
}

export function ActivityGlobeCard({
  activityCount,
  connected,
  detail,
  loading,
  onOpenTraining,
}: ActivityGlobeCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef<[number, number, number]>([20, -18, 0]);
  const drawRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotation: [number, number, number];
  } | null>(null);

  const routePoints = useMemo(() => {
    const points = detail?.track?.points ?? [];
    return samplePoints(points.filter(isGlobePoint));
  }, [detail]);

  useEffect(() => {
    rotationRef.current = initialRotation(routePoints);
    drawRef.current?.();
  }, [routePoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let previousTime = performance.now();
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    const draw = () => {
      if (width <= 0 || height <= 0) {
        return;
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const computedStyle = getComputedStyle(canvas);
      const paperTheme = document.documentElement.dataset.theme === "paper";
      const accent = computedStyle.getPropertyValue("--accent").trim();
      const accentStrong = computedStyle
        .getPropertyValue("--accent-strong")
        .trim();
      const gold = computedStyle.getPropertyValue("--accent-gold").trim();
      const sphereRadius = Math.min(width * 0.42, height * 0.48);
      const sphereX = width * (width < 520 ? 0.5 : 0.55);
      const sphereY = height * 0.5;
      const projection = geoOrthographic()
        .translate([sphereX, sphereY])
        .scale(sphereRadius)
        .precision(0.4)
        .clipAngle(90)
        .rotate(rotationRef.current);
      const path = geoPath(projection, context);

      context.save();
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const atmosphere = context.createRadialGradient(
        sphereX - sphereRadius * 0.28,
        sphereY - sphereRadius * 0.36,
        sphereRadius * 0.08,
        sphereX,
        sphereY,
        sphereRadius * 1.08,
      );
      atmosphere.addColorStop(
        0,
        paperTheme ? "rgba(255, 255, 255, 0.96)" : "rgba(27, 45, 42, 0.98)",
      );
      atmosphere.addColorStop(
        0.7,
        paperTheme ? "rgba(222, 233, 227, 0.92)" : "rgba(8, 19, 18, 0.98)",
      );
      atmosphere.addColorStop(
        1,
        paperTheme ? "rgba(192, 211, 202, 0.72)" : "rgba(3, 10, 10, 0.98)",
      );

      context.beginPath();
      context.arc(sphereX, sphereY, sphereRadius, 0, Math.PI * 2);
      context.fillStyle = atmosphere;
      context.fill();
      context.strokeStyle = paperTheme
        ? "rgba(18, 148, 110, 0.28)"
        : "rgba(79, 214, 166, 0.24)";
      context.lineWidth = 1.2;
      context.stroke();

      context.beginPath();
      path(graticule);
      context.strokeStyle = paperTheme
        ? "rgba(43, 42, 40, 0.09)"
        : "rgba(245, 245, 247, 0.075)";
      context.lineWidth = 0.65;
      context.stroke();

      context.beginPath();
      path(land as GeoPermissibleObjects);
      context.fillStyle = paperTheme
        ? "rgba(18, 148, 110, 0.18)"
        : "rgba(65, 111, 98, 0.42)";
      context.fill();
      context.strokeStyle = paperTheme
        ? "rgba(18, 112, 82, 0.3)"
        : "rgba(123, 190, 166, 0.32)";
      context.lineWidth = 0.75;
      context.stroke();

      const center = projection.invert?.([sphereX, sphereY]) ?? [0, 0];
      const buckets = new Map<
        string,
        { count: number; x: number; y: number }
      >();

      routePoints.forEach((point) => {
        const coordinate: [number, number] = [point.lon, point.lat];
        if (geoDistance(coordinate, center) > Math.PI / 2) {
          return;
        }

        const projected = projection(coordinate);
        if (!projected) {
          return;
        }

        const [x, y] = projected;
        const gridX = Math.round(x / 16);
        const gridY = Math.round(y / 16);
        const key = `${gridX}:${gridY}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.count += 1;
          bucket.x = (bucket.x + x) / 2;
          bucket.y = (bucket.y + y) / 2;
        } else {
          buckets.set(key, { count: 1, x, y });
        }
      });

      context.save();
      context.globalCompositeOperation = "lighter";
      const maxCount = Math.max(
        1,
        ...Array.from(buckets.values(), (bucket) => bucket.count),
      );

      buckets.forEach((bucket) => {
        const intensity = Math.sqrt(bucket.count / maxCount);
        const radius = 13 + intensity * 21;
        const heat = context.createRadialGradient(
          bucket.x,
          bucket.y,
          0,
          bucket.x,
          bucket.y,
          radius,
        );
        heat.addColorStop(0, gold);
        heat.addColorStop(0.28, accentStrong);
        heat.addColorStop(0.68, accent);
        heat.addColorStop(1, "rgba(47, 190, 145, 0)");
        context.globalAlpha = 0.34 + intensity * 0.5;
        context.fillStyle = heat;
        context.fillRect(
          bucket.x - radius,
          bucket.y - radius,
          radius * 2,
          radius * 2,
        );
      });
      context.restore();

      context.beginPath();
      context.arc(
        sphereX - sphereRadius * 0.26,
        sphereY - sphereRadius * 0.32,
        sphereRadius * 0.88,
        Math.PI * 1.05,
        Math.PI * 1.55,
      );
      context.strokeStyle = paperTheme
        ? "rgba(255, 255, 255, 0.58)"
        : "rgba(255, 255, 255, 0.13)";
      context.lineWidth = 1.25;
      context.stroke();
      context.restore();
    };

    drawRef.current = draw;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
      draw();
    });
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const animate = (time: number) => {
      const elapsed = Math.min(time - previousTime, 40);
      previousTime = time;
      if (
        routePoints.length === 0 &&
        !reducedMotionQuery.matches &&
        !dragRef.current &&
        !document.body.classList.contains("is-backgrounded")
      ) {
        rotationRef.current = [
          rotationRef.current[0] + elapsed * 0.004,
          rotationRef.current[1],
          0,
        ];
        draw();
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      drawRef.current = null;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [routePoints]);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotation: [...rotationRef.current],
    };
    event.currentTarget.classList.add("is-dragging");
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    rotationRef.current = [
      drag.rotation[0] + (event.clientX - drag.x) * 0.28,
      Math.max(
        -70,
        Math.min(70, drag.rotation[1] - (event.clientY - drag.y) * 0.24),
      ),
      0,
    ];
    drawRef.current?.();
  };

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.classList.remove("is-dragging");
    }
  };

  const hasRoute = routePoints.length > 0;
  const title = detail?.name ?? detail?.sportName ?? "Latest activity";
  const statusLabel = loading
    ? "Loading your latest route"
    : hasRoute
      ? `${routePoints.length.toLocaleString()} mapped GPS samples`
      : connected
        ? "Your latest activity has no GPS trace"
        : "Connect Training Hub to add your route";

  return (
    <section className="activity-globe-card panel">
      <header className="activity-globe-header">
        <div>
          <p className="eyebrow">Activity globe</p>
          <h2>Where you move</h2>
        </div>
        <span className="activity-globe-private">
          <LockKeyhole size={13} aria-hidden="true" />
          Rendered locally
        </span>
      </header>

      <div
        className="activity-globe-stage"
        role="img"
        aria-label={
          hasRoute
            ? `Interactive globe showing heat intensity for ${title}`
            : "Interactive globe waiting for GPS activity data"
        }
      >
        <canvas
          ref={canvasRef}
          className="activity-globe-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-hidden="true"
        />

        <div className="activity-globe-status">
          <MapPin size={14} aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>

        {hasRoute ? (
          <div className="activity-globe-legend" aria-label="Heat intensity">
            <span>Low</span>
            <i aria-hidden="true" />
            <span>High</span>
          </div>
        ) : null}
      </div>

      <footer className="activity-globe-footer">
        <div className="activity-globe-summary">
          <strong>{hasRoute ? title : "Your activity map"}</strong>
          <span>
            {hasRoute
              ? formatActivitySummary(detail, routePoints.length)
              : activityCount > 0
                ? `${activityCount} recent activities available`
                : "GPS activities will appear here"}
          </span>
        </div>
        <button
          type="button"
          className="activity-globe-action"
          onClick={onOpenTraining}
        >
          {connected ? "View training" : "Connect Training Hub"}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}
