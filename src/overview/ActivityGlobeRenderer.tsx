import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  MeshStandardMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";
import type { GeoHeatBucket, GlobePoint } from "./activityVisitHeatmap";

interface ActivityGlobeRendererProps {
  frameKey: string;
  locations: GeoHeatBucket[];
  routePoints: GlobePoint[];
  selectedLocation: GeoHeatBucket | null;
  selectedLabel: string;
  streetMode: boolean;
  onError: (error: boolean) => void;
  onHoverChange: (hovering: boolean) => void;
  onRequestStreet: (focus: { lat: number; lon: number }) => void;
  onSelectLocation: (bucket: GeoHeatBucket) => void;
  onViewChange: (changed: boolean) => void;
}

export interface ActivityGlobeRendererHandle {
  resetView: (duration?: number) => void;
}

interface GlobeView {
  lat: number;
  lng: number;
  altitude: number;
}

interface ActivityPoint extends GeoHeatBucket {
  intensity: number;
}

interface LandLayerData {
  kind: "geography";
  object: Points<BufferGeometry, ShaderMaterial>;
}

interface LandGeometryData {
  positions: Float32Array;
  strengths: Float32Array;
}

interface LandGeometryMessage {
  positions: ArrayBuffer;
  strengths: ArrayBuffer;
}

interface RouteLayerData {
  points: GlobePoint[];
}

const GLOBE_RADIUS = 100;
const DEFAULT_VIEW: GlobeView = { lat: 18, lng: -20, altitude: 2.2 };
const SELECTED_VIEW_ALTITUDE = 2.2;
const FRAMING_VERSION = "full-panel-v3";
const SELECTED_LATITUDE_OFFSET = 6.5;
const CAMERA_FOCUS_MS = 600;
const STREET_VIEW_ALTITUDE = 0.42;
const IDLE_DELAY_MS = 4_200;
const IDLE_ROTATION_SPEED = 0.08;

let landGeometryCache: LandGeometryData | null = null;
let landGeometryPromise: Promise<LandGeometryData> | null = null;

function loadLandGeometry(): Promise<LandGeometryData> {
  if (landGeometryCache) {
    return Promise.resolve(landGeometryCache);
  }
  if (landGeometryPromise) {
    return landGeometryPromise;
  }

  landGeometryPromise = new Promise<LandGeometryData>((resolve, reject) => {
    const worker = new Worker(
      new URL("./activityGlobeLand.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<LandGeometryMessage>) => {
      landGeometryCache = {
        positions: new Float32Array(event.data.positions),
        strengths: new Float32Array(event.data.strengths),
      };
      worker.terminate();
      resolve(landGeometryCache);
    };
    worker.onerror = (event) => {
      landGeometryPromise = null;
      worker.terminate();
      reject(new Error(event.message || "Unable to prepare globe geography."));
    };
  });
  return landGeometryPromise;
}

function createGeographyPoints(
  paperTheme: boolean,
  landGeometry: LandGeometryData,
): LandLayerData {

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(landGeometry.positions, 3),
  );
  geometry.setAttribute(
    "aStrength",
    new BufferAttribute(landGeometry.strengths, 1),
  );

  const material = new ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uColor: {
        value: new Color(paperTheme ? "#667179" : "#c4d5e1"),
      },
      uOpacity: { value: paperTheme ? 0.5 : 0.32 },
      uPointSize: { value: paperTheme ? 1.9 : 1.78 },
      uPixelRatio: {
        value: Math.min(window.devicePixelRatio || 1, 2),
      },
    },
    vertexShader: `
      attribute float aStrength;
      uniform float uPointSize;
      uniform float uPixelRatio;
      varying float vAlpha;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normalize(position));
        float facing = clamp(viewNormal.z, 0.0, 1.0);
        vAlpha = aStrength * smoothstep(0.03, 0.72, facing);
        gl_PointSize = uPointSize * uPixelRatio * (220.0 / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float radius = dot(point, point);
        if (radius > 0.25) discard;
        float edge = 1.0 - smoothstep(0.16, 0.25, radius);
        gl_FragColor = vec4(uColor, uOpacity * vAlpha * edge);
      }
    `,
  });
  const object = new Points(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = 2;
  return { kind: "geography", object };
}

function viewChanged(current: GlobeView, baseline: GlobeView): boolean {
  const longitudeDelta = Math.abs(
    ((current.lng - baseline.lng + 540) % 360) - 180,
  );
  return (
    Math.abs(current.lat - baseline.lat) > 2 ||
    longitudeDelta > 2 ||
    Math.abs(current.altitude - baseline.altitude) > 0.05
  );
}

function clampLatitude(lat: number): number {
  return Math.max(-78, Math.min(78, lat));
}

const ActivityGlobeRendererComponent = forwardRef<
  ActivityGlobeRendererHandle,
  ActivityGlobeRendererProps
>(function ActivityGlobeRenderer(
  {
    frameKey,
    locations,
    routePoints,
    selectedLocation,
    selectedLabel,
    streetMode,
    onError,
    onHoverChange,
    onRequestStreet,
    onSelectLocation,
    onViewChange,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const baselineRef = useRef<GlobeView>(DEFAULT_VIEW);
  const framedKeyRef = useRef<string | null>(null);
  const interactionRef = useRef(false);
  const streetRequestedRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [paperTheme, setPaperTheme] = useState(
    () => document.documentElement.dataset.theme === "paper",
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [landGeometry, setLandGeometry] = useState<LandGeometryData | null>(
    landGeometryCache,
  );

  const globeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: paperTheme ? "#cfd7dc" : "#121e28",
        roughness: paperTheme ? 0.78 : 0.8,
        metalness: paperTheme ? 0.12 : 0.18,
        emissive: new Color(paperTheme ? "#000000" : "#061018"),
        emissiveIntensity: paperTheme ? 0 : 0.08,
        dithering: true,
      }),
    [paperTheme],
  );

  const lights = useMemo(() => {
    const hemisphere = new HemisphereLight(
      paperTheme ? "#ffffff" : "#a9c6db",
      paperTheme ? "#687681" : "#03080c",
      paperTheme ? 0.96 : 0.72,
    );
    const directional = new DirectionalLight(
      paperTheme ? "#f8fbff" : "#d7e7f2",
      paperTheme ? 0.58 : 0.62,
    );
    directional.position.set(-3.5, 4.5, 5.5);
    return [hemisphere, directional];
  }, [paperTheme]);

  const landLayer = useMemo(
    () =>
      landGeometry
        ? createGeographyPoints(paperTheme, landGeometry)
        : null,
    [landGeometry, paperTheme],
  );
  const landLayerData = useMemo(
    () => (landLayer ? [landLayer] : []),
    [landLayer],
  );

  const activityPoints = useMemo<ActivityPoint[]>(() => {
    const maxCount = Math.max(1, ...locations.map((location) => location.count));
    return locations.map((location) => ({
      ...location,
      intensity: Math.sqrt(location.count / maxCount),
    }));
  }, [locations]);

  const pathsData = useMemo<RouteLayerData[]>(
    () => (routePoints.length >= 2 ? [{ points: routePoints }] : []),
    [routePoints],
  );
  const selectedData = useMemo(
    () => (selectedLocation ? [selectedLocation] : []),
    [selectedLocation],
  );
  const ringData = useMemo(
    () => (!reducedMotion && selectedLocation ? [selectedLocation] : []),
    [reducedMotion, selectedLocation],
  );

  const stopIdleRotation = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = false;
    }
  }, []);

  const scheduleIdleRotation = useCallback(() => {
    stopIdleRotation();
    if (reducedMotion || selectedLocation || streetMode) {
      return;
    }
    idleTimerRef.current = window.setTimeout(() => {
      const controls = globeRef.current?.controls();
      if (controls && !interactionRef.current) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = IDLE_ROTATION_SPEED;
      }
    }, IDLE_DELAY_MS);
  }, [reducedMotion, selectedLocation, stopIdleRotation, streetMode]);

  const resetView = useCallback(
    (duration = 600) => {
      streetRequestedRef.current = false;
      stopIdleRotation();
      globeRef.current?.pointOfView(
        baselineRef.current,
        reducedMotion ? 0 : duration,
      );
      onViewChange(false);
      scheduleIdleRotation();
    },
    [onViewChange, reducedMotion, scheduleIdleRotation, stopIdleRotation],
  );

  useImperativeHandle(forwardedRef, () => ({ resetView }), [resetView]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPaperTheme(document.documentElement.dataset.theme === "paper");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (landGeometry) {
      return;
    }
    let active = true;
    void loadLandGeometry()
      .then((geometry) => {
        if (active) {
          setLandGeometry(geometry);
        }
      })
      .catch(() => {
        // Geography is decorative. Keep the interactive globe usable if the
        // worker is unavailable on an older WebView.
      });
    return () => {
      active = false;
    };
  }, [landGeometry]);

  useEffect(() => {
    if (!ready || !globeRef.current) {
      return;
    }
    globeRef.current.lights(lights);
  }, [lights, ready]);

  useEffect(() => {
    const framingKey = `${frameKey}:${FRAMING_VERSION}`;
    if (!ready || framedKeyRef.current === framingKey) {
      return;
    }
    framedKeyRef.current = framingKey;
    const peak = locations.reduce<GeoHeatBucket | null>(
      (current, location) =>
        !current || location.count > current.count ? location : current,
      null,
    );
    baselineRef.current = peak
      ? {
          lat: clampLatitude(peak.lat + 2.5),
          lng: peak.lon,
          altitude: DEFAULT_VIEW.altitude,
        }
      : DEFAULT_VIEW;
    if (!selectedLocation) {
      globeRef.current?.pointOfView(
        baselineRef.current,
        reducedMotion ? 0 : 720,
      );
      onViewChange(false);
    }
  }, [frameKey, locations, onViewChange, ready, reducedMotion, selectedLocation]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (!selectedLocation) {
      scheduleIdleRotation();
      return;
    }

    stopIdleRotation();
    globeRef.current?.pointOfView(
      {
        lat: clampLatitude(selectedLocation.lat + SELECTED_LATITUDE_OFFSET),
        lng: selectedLocation.lon,
        altitude: SELECTED_VIEW_ALTITUDE,
      },
      reducedMotion ? 0 : CAMERA_FOCUS_MS,
    );
    onViewChange(true);
  }, [
    onViewChange,
    ready,
    reducedMotion,
    scheduleIdleRotation,
    selectedLocation?.key,
    stopIdleRotation,
  ]);

  useEffect(() => {
    if (!ready || !globeRef.current) {
      return;
    }
    const controls = globeRef.current.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.72;
    controls.minDistance = GLOBE_RADIUS * 1.32;
    controls.maxDistance = GLOBE_RADIUS * 5.2;
    controls.autoRotate = false;
    controls.autoRotateSpeed = IDLE_ROTATION_SPEED;

    const handleStart = () => {
      interactionRef.current = true;
      stopIdleRotation();
    };
    const handleEnd = () => {
      interactionRef.current = false;
      scheduleIdleRotation();
    };
    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);
    scheduleIdleRotation();
    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
      controls.autoRotate = false;
    };
  }, [ready, scheduleIdleRotation, stopIdleRotation]);

  useEffect(() => {
    if (streetMode) {
      stopIdleRotation();
    } else {
      streetRequestedRef.current = false;
      scheduleIdleRotation();
    }
  }, [scheduleIdleRotation, stopIdleRotation, streetMode]);

  useEffect(
    () => () => {
      globeMaterial.dispose();
    },
    [globeMaterial],
  );

  useEffect(
    () => () => {
      if (!landLayer) {
        return;
      }
      landLayer.object.geometry.dispose();
      landLayer.object.material.dispose();
    },
    [landLayer],
  );

  useEffect(
    () => () => {
      stopIdleRotation();
    },
    [stopIdleRotation],
  );

  const handleReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) {
      onError(true);
      return;
    }
    const renderer = globe.renderer();
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    globe.lights(lights);
    globe.pointOfView(DEFAULT_VIEW, 0);
    setReady(true);
    onError(false);
  }, [lights, onError]);

  const handleZoom = useCallback(
    (view: GlobeView) => {
      onViewChange(viewChanged(view, baselineRef.current));
      if (
        interactionRef.current &&
        !streetMode &&
        !streetRequestedRef.current &&
        view.altitude <= STREET_VIEW_ALTITUDE &&
        (locations.length > 0 || routePoints.length > 0)
      ) {
        streetRequestedRef.current = true;
        stopIdleRotation();
        onRequestStreet({ lat: view.lat, lon: view.lng });
      }
    },
    [
      locations.length,
      onRequestStreet,
      onViewChange,
      routePoints.length,
      stopIdleRotation,
      streetMode,
    ],
  );

  const handlePointClick = useCallback(
    (point: object) => onSelectLocation(point as GeoHeatBucket),
    [onSelectLocation],
  );

  const handlePointHover = useCallback(
    (point: object | null) => onHoverChange(Boolean(point)),
    [onHoverChange],
  );

  const makeHtmlLabel = useCallback((datum: object) => {
    const location = datum as GeoHeatBucket;
    const anchor = document.createElement("div");
    anchor.className = "training-map-globe-label-anchor";
    anchor.dataset.locationKey = location.key;
    const label = document.createElement("span");
    label.className = "training-map-globe-label";
    label.textContent = selectedLabel;
    anchor.append(label);
    return anchor;
  }, [selectedLabel]);

  const modifyHtmlLabelVisibility = useCallback(
    (element: HTMLElement, visible: boolean) => {
      element.classList.toggle("is-hidden", !visible);
      element.setAttribute("aria-hidden", visible ? "false" : "true");
    },
    [],
  );

  const customThreeObject = useCallback(
    (datum: object) => (datum as LandLayerData).object,
    [],
  );

  const pointerEventsFilter = useCallback(
    (_object: unknown, data?: object) =>
      Boolean(data && "key" in data && "count" in data),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={`activity-globe-webgl${streetMode ? " is-street-hidden" : ""}`}
      onPointerEnter={stopIdleRotation}
      onPointerLeave={scheduleIdleRotation}
    >
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0, 0, 0, 0)"
        rendererConfig={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        animateIn={false}
        waitForGlobeReady={false}
        globeOffset={[0, 8]}
        globeMaterial={globeMaterial}
        globeCurvatureResolution={3}
        showAtmosphere
        atmosphereColor={paperTheme ? "#477f9f" : "#73b4e2"}
        atmosphereAltitude={0.08}
        customLayerData={landLayerData}
        customThreeObject={customThreeObject}
        pointsData={activityPoints}
        pointLat={(point) => (point as ActivityPoint).lat}
        pointLng={(point) => (point as ActivityPoint).lon}
        pointAltitude={(point) =>
          (point as ActivityPoint).key === selectedLocation?.key ? 0.008 : 0.0035
        }
        pointRadius={(point) => {
          const activity = point as ActivityPoint;
          return activity.key === selectedLocation?.key
            ? 0.28
            : 0.1 + activity.intensity * 0.1;
        }}
        pointColor={(point) => {
          const activity = point as ActivityPoint;
          if (activity.key === selectedLocation?.key) {
            return paperTheme ? "#087b5b" : "#83f3ce";
          }
          return paperTheme
            ? "rgba(8, 123, 91, 0.76)"
            : "rgba(66, 214, 165, 0.55)";
        }}
        pointResolution={12}
        pointsMerge={false}
        pointsTransitionDuration={0}
        pointLabel={() => ""}
        onPointClick={handlePointClick}
        onPointHover={handlePointHover}
        pathsData={pathsData}
        pathPoints={(path) => (path as RouteLayerData).points}
        pathPointLat={(point) => (point as GlobePoint).lat}
        pathPointLng={(point) => (point as GlobePoint).lon}
        pathPointAlt={0.006}
        pathResolution={0.7}
        pathColor={() => (paperTheme ? "#087b5b" : "#83f3ce")}
        pathStroke={0.13}
        pathTransitionDuration={0}
        ringsData={ringData}
        ringLat={(point) => (point as GeoHeatBucket).lat}
        ringLng={(point) => (point as GeoHeatBucket).lon}
        ringAltitude={0.007}
        ringColor={() =>
          paperTheme
            ? [
                "rgba(8, 123, 91, 0.62)",
                "rgba(8, 123, 91, 0.22)",
                "rgba(8, 123, 91, 0)",
              ]
            : [
                "rgba(131, 243, 206, 0.7)",
                "rgba(73, 207, 163, 0.24)",
                "rgba(73, 207, 163, 0)",
              ]
        }
        ringMaxRadius={2.8}
        ringPropagationSpeed={2.3}
        ringRepeatPeriod={820}
        ringResolution={64}
        htmlElementsData={selectedData}
        htmlLat={(point) => (point as GeoHeatBucket).lat}
        htmlLng={(point) => (point as GeoHeatBucket).lon}
        htmlAltitude={0.012}
        htmlElement={makeHtmlLabel}
        htmlElementVisibilityModifier={modifyHtmlLabelVisibility}
        htmlTransitionDuration={0}
        enablePointerInteraction
        pointerEventsFilter={pointerEventsFilter}
        showPointerCursor={(type) => type === "point"}
        onZoom={handleZoom}
        onGlobeReady={handleReady}
      />
    </div>
  );
});

export const ActivityGlobeRenderer = memo(ActivityGlobeRendererComponent);
