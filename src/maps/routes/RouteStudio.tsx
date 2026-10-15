import { t, useLanguage , getLocale} from "../../i18n/tools";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  FolderOpen,
  KeyRound,
  Loader2,
  PenLine,
  Shapes,
  Sparkles,
  Telescope,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityPaceBaselines,
  DrawnRoutePayload,
  GeneratedRoute,
  GeneratedRoutePage,
  GeneratedRouteSummary,
  GenerateRouteRequest,
  RouteActivityType,
  RouteBackend,
  RouteElevationPreference,
  RouteGeometry,
  RouteMode,
  RouteShareSession,
  RouteSurfacePreference,
  RouteWaypoint
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import type { CorosRouteSyncStatus } from "../../../electron/corosBleRouteTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import type { RouteBaseLayer, RouteOverlayId } from "./constants";
import { RouteMapCanvas, type RouteStudioMode } from "./RouteMapCanvas";
import { RouteStatsBar, type RouteSummary } from "./RouteStatsBar";
import { LoopOptions } from "./LoopOptions";
import { SavedRoutesDrawer } from "./SavedRoutesDrawer";
import {
  DrawPanel,
  ExplorePanel,
  GeneratePanel,
  MapLayerControl,
  type ResolvedPoint
} from "./panels";
import { requestDeviceRouteLocation } from "./currentLocation";
import { SketchPanel } from "./SketchPanel";
import { SKETCH_TEMPLATES } from "./sketchShapes";
import { useRouteDraw } from "./useRouteDraw";
import { useRouteSketch } from "./useRouteSketch";
import { formatShortDistance, surfaceForActivity, toErrorMessage } from "./utils";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

const ROUTE_STUDIO_MODE_PREFERENCE =
  defineSelectionPreference<RouteStudioMode>({
    key: "maps.routeStudio.mode",
    defaultValue: "generate",
    validate: selectionIsOneOf(["generate", "draw", "sketch", "explore"])
  });

const ROUTE_STUDIO_BASE_LAYER_PREFERENCE =
  defineSelectionPreference<RouteBaseLayer>({
    key: "maps.routeStudio.baseLayer",
    defaultValue: "outdoors",
    validate: selectionIsOneOf([
      "street",
      "outdoors",
      "light",
      "dark",
      "topo",
      "satellite"
    ])
  });

const ROUTE_STUDIO_OVERLAYS_PREFERENCE =
  defineSelectionPreference<RouteOverlayId[]>({
    key: "maps.routeStudio.overlays",
    defaultValue: [],
    validate: selectionIsArrayOf(
      selectionIsOneOf(["hiking", "cycling", "mtb"]),
      { unique: true }
    )
  });

const MODE_TABS: Array<{
  id: RouteStudioMode;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: "generate", label: "Generate", icon: Sparkles },
  { id: "draw", label: "Draw", icon: PenLine },
  { id: "sketch", label: "Sketch", icon: Shapes },
  { id: "explore", label: "Explore", icon: Telescope }
];

export function RouteStudio({
  api,
  onMessage,
  onError
}: {
  api: CorosLinkApi;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { language } = useLanguage();
  const { unitSystem } = useUnitSystem();
  const [mode, setMode] = useSelectionPreference(
    ROUTE_STUDIO_MODE_PREFERENCE
  );
  const [activityType, setActivityType] = useState<RouteActivityType>("running");
  const [surfacePreference, setSurfacePreference] = useState<RouteSurfacePreference>(
    () => surfaceForActivity("running")
  );
  // Surface choices differ per sport (MTB has no "road"), so a sport switch
  // restarts from that sport's default.
  const handleActivityChange = useCallback((next: RouteActivityType) => {
    setActivityType(next);
    setSurfacePreference(surfaceForActivity(next));
  }, []);

  // Generate state
  const [routeMode, setRouteMode] = useState<RouteMode>("loop");
  const [distanceKm, setDistanceKm] = useState(5);
  const [elevationPreference, setElevationPreference] =
    useState<RouteElevationPreference>("any");
  const [start, setStart] = useState<ResolvedPoint | null>(null);
  const [destination, setDestination] = useState<ResolvedPoint | null>(null);
  const [pinTarget, setPinTarget] = useState<"start" | "destination" | null>(
    null
  );
  const [currentLocation, setCurrentLocation] = useState<RouteWaypoint | null>(
    null
  );
  const [generating, setGenerating] = useState(false);
  // Loops from the latest generation: the saved best match, then runner-ups.
  const [loopChoice, setLoopChoice] = useState<{
    routeId: string;
    options: RouteGeometry[];
    selected: number;
  } | null>(null);
  const [hoveredLoop, setHoveredLoop] = useState<number | null>(null);
  const [pickingLoop, setPickingLoop] = useState(false);

  // Shared / preview state
  const [previewRoute, setPreviewRouteState] = useState<GeneratedRoute | null>(null);
  const [routePage, setRoutePage] = useState<GeneratedRoutePage>({
    routes: [], total: 0, offset: 0, pageSize: 20
  });
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectingRouteId, setSelectingRouteId] = useState<string | null>(null);
  const pageRequestId = useRef(0);
  const previewRequestId = useRef(0);
  const setPreviewRoute = useCallback((route: GeneratedRoute | null) => {
    previewRequestId.current += 1;
    setSelectingRouteId(null);
    setPreviewRouteState(route);
  }, []);
  const refreshRoutes = useCallback(async (offset = 0) => {
    const requestId = ++pageRequestId.current;
    setLoadingRoutes(true);
    try {
      const page = await api.listGeneratedRoutes(offset);
      if (requestId !== pageRequestId.current) return null;
      setRoutePage(page);
      return page;
    } finally {
      if (requestId === pageRequestId.current) setLoadingRoutes(false);
    }
  }, [api]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CorosRouteSyncStatus | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const syncing = syncStatus !== null && ["connecting", "preparing", "transferring", "verifying"].includes(syncStatus.phase);
  const footerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const footer = footerRef.current;
    const studio = footer?.parentElement;
    if (!footer || !studio) return;
    const update = () => studio.style.setProperty("--route-footer-clearance", `${Math.ceil(footer.getBoundingClientRect().height) + 104}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api.getCorosRouteSyncStatus();
        if (!stopped && state && state.phase !== "idle") setSyncStatus(state);
      } catch { /* The send operation reports actionable errors. */ }
      if (!stopped && syncing) timer = setTimeout(() => void poll(), 700);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, syncing]);
  const [savingDraw, setSavingDraw] = useState(false);
  const [importing, setImporting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareSession, setShareSession] = useState<RouteShareSession | null>(
    null
  );
  const [paceBaselines, setPaceBaselines] = useState<ActivityPaceBaselines>({});
  const [fitRequestId, setFitRequestId] = useState(0);

  // Map state
  const [baseLayer, setBaseLayer] = useSelectionPreference(
    ROUTE_STUDIO_BASE_LAYER_PREFERENCE
  );
  const [overlays, setOverlays] = useSelectionPreference(
    ROUTE_STUDIO_OVERLAYS_PREFERENCE
  );

  const draw = useRouteDraw(api, activityType, surfacePreference);
  const sketch = useRouteSketch(api, activityType);
  const [savingSketch, setSavingSketch] = useState(false);

  useEffect(() => {
    const previewVersion = previewRequestId.current;
    void refreshRoutes()
      .then(async (page) => {
        if (!page?.routes[0] || previewVersion !== previewRequestId.current) return;
        const route = await api.getGeneratedRoute(page.routes[0].id);
        if (previewVersion === previewRequestId.current) {
          setPreviewRoute(route);
          setActiveSavedId(route?.id ?? null);
        }
      })
      .catch((caught) => onError(toErrorMessage(caught)));
    void api
      .getActivityPaceBaselines()
      .then(setPaceBaselines)
      .catch(() => setPaceBaselines({}));
    return () => {
      pageRequestId.current += 1;
      previewRequestId.current += 1;
    };
  }, [api, onError, refreshRoutes, setPreviewRoute]);

  // Tear down the LAN share server when leaving the studio.
  useEffect(() => {
    return () => {
      void api.stopRouteShare().catch(() => undefined);
    };
  }, [api]);

  const handleMapClick = useCallback(
    (point: RouteWaypoint) => {
      if (mode === "draw") {
        draw.addPoint(point);
        return;
      }
      if (mode === "sketch") {
        if (sketch.tool !== "freehand") {
          sketch.setCenter(point);
        }
        return;
      }
      if (pinTarget) {
        const label = t("Pinned {{p0}}, {{p1}}", { p0: point.lat.toFixed(4), p1: point.lon.toFixed(4) });
        const resolved: ResolvedPoint = {
          ...point,
          label,
          query: `${point.lat},${point.lon}`
        };
        if (pinTarget === "start") {
          setStart(resolved);
          setCurrentLocation(null);
        } else {
          setDestination(resolved);
        }
        setPreviewRoute(null);
        setActiveSavedId(null);
        setPinTarget(null);
        setFitRequestId((id) => id + 1);
      }
    },
    [mode, pinTarget, draw, sketch]
  );

  const handleUseCurrent = useCallback(() => {
    onError(null);
    void requestDeviceRouteLocation(undefined, unitSystem)
      .then((result) => {
        const resolved: ResolvedPoint = {
          lat: result.lat,
          lon: result.lon,
          label: result.label,
          query: `${result.lat},${result.lon}`
        };
        setStart(resolved);
        setCurrentLocation({ lat: result.lat, lon: result.lon });
        setPreviewRoute(null);
        setActiveSavedId(null);
        setPinTarget(null);
        setFitRequestId((id) => id + 1);
      })
      .catch((caught) => onError(toErrorMessage(caught)));
  }, [onError, unitSystem]);

  const handleSelectStart = useCallback(
    (point: ResolvedPoint) => {
      onError(null);
      setStart(point);
      setCurrentLocation(null);
      setPreviewRoute(null);
      setActiveSavedId(null);
      setPinTarget(null);
      setFitRequestId((id) => id + 1);
    },
    [onError]
  );

  const handleSelectDestination = useCallback(
    (point: ResolvedPoint) => {
      onError(null);
      setDestination(point);
      setPreviewRoute(null);
      setActiveSavedId(null);
      setPinTarget(null);
      setFitRequestId((id) => id + 1);
    },
    [onError]
  );

  const handleClearStart = useCallback(() => {
    setStart(null);
    setCurrentLocation(null);
    setPreviewRoute(null);
    setActiveSavedId(null);
    setPinTarget(null);
  }, []);

  const handleClearDestination = useCallback(() => {
    setDestination(null);
    setPreviewRoute(null);
    setActiveSavedId(null);
    setPinTarget(null);
  }, []);

  // Escape cancels an armed map pin.
  useEffect(() => {
    if (!pinTarget) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pinTarget]);

  async function runGenerate(regenerate: boolean) {
    if (!start) {
      return;
    }
    setGenerating(true);
    onError(null);
    onMessage(null);
    try {
      const request: GenerateRouteRequest = {
        startLocation: start.query ?? `${start.lat},${start.lon}`,
        destinationLocation:
          routeMode === "point-to-point" && destination
            ? destination.query ?? `${destination.lat},${destination.lon}`
            : undefined,
        distanceKm,
        mode: routeMode,
        activityType,
        surfacePreference,
        avoidHighways: false,
        elevationPreference,
        unitSystem,
        variationSeed: regenerate ? Date.now() : undefined
      };
      const { alternatives = [], ...route } = await api.generateRoute(request);
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      setHoveredLoop(null);
      setLoopChoice(
        alternatives.length > 0
          ? { routeId: route.id, options: [routeGeometryOf(route), ...alternatives], selected: 0 }
          : null
      );
      await refreshRoutes();
      setFitRequestId((id) => id + 1);
      const targetMeters = distanceKm * 1_000;
      // Sparse road grids only allow certain loop lengths; say so rather than
      // let a clean but off-target loop pass for the requested distance.
      if (
        routeMode === "loop" &&
        Math.abs(route.distanceMeters - targetMeters) / targetMeters > 0.06
      ) {
        onMessage(
          alternatives.length > 0
            ? t("Best loop here is {{distance}} (you asked for {{target}}). Compare the other loops below, or try New variation.", {
                distance: formatShortDistance(route.distanceMeters, unitSystem),
                target: formatShortDistance(targetMeters, unitSystem)
              })
            : t("Closest clean loop here is {{distance}} (you asked for {{target}}). Try New variation for other shapes.", {
                distance: formatShortDistance(route.distanceMeters, unitSystem),
                target: formatShortDistance(targetMeters, unitSystem)
              })
        );
      } else {
        onMessage(regenerate ? t("Generated a fresh loop.") : t("Route ready."));
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  }

  /** Makes another generated loop the saved route, keeping its id and name. */
  async function handlePickLoop(index: number) {
    const option = loopChoice?.options[index];
    if (!loopChoice || !option || !previewRoute || pickingLoop || index === loopChoice.selected) {
      return;
    }
    const before = { route: previewRoute, selected: loopChoice.selected };
    // Show the pick at once; saving only rewrites a local file and row.
    setLoopChoice({ ...loopChoice, selected: index });
    setPreviewRoute(withRouteGeometry(previewRoute, option));
    const previewVersion = previewRequestId.current;
    setPickingLoop(true);
    onError(null);
    try {
      const saved = await api.replaceGeneratedRouteGeometry(before.route.id, option);
      if (previewVersion === previewRequestId.current) setPreviewRoute(saved);
      await refreshRoutes(routePage.offset);
    } catch (caught) {
      if (previewVersion === previewRequestId.current) {
        setLoopChoice((current) =>
          current?.routeId === before.route.id ? { ...current, selected: before.selected } : current
        );
        setPreviewRoute(before.route);
      }
      onError(toErrorMessage(caught));
    } finally {
      setPickingLoop(false);
    }
  }

  async function handleSaveDraw() {
    if (!draw.geometry || draw.geometry.points.length < 2) {
      return;
    }
    setSavingDraw(true);
    onError(null);
    onMessage(null);
    try {
      const payload: DrawnRoutePayload = {
        waypoints: draw.waypoints,
        points: draw.geometry.points,
        distanceMeters: draw.geometry.distanceMeters,
        durationSeconds: draw.geometry.durationSeconds,
        ascentMeters: draw.geometry.ascentMeters,
        descentMeters: draw.geometry.descentMeters,
        activityType,
        closed: draw.closed,
        snap: draw.snap,
        surfacePreference,
        elevationPreference: "any",
        insights: draw.geometry.insights,
        unitSystem
      };
      const route = await api.saveDrawnRoute(payload);
      await refreshRoutes();
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      draw.clear();
      setMode("generate");
      setFitRequestId((id) => id + 1);
      onMessage(t("Route saved."));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setSavingDraw(false);
    }
  }

  async function handleSaveSketch() {
    if (!sketch.geometry || sketch.geometry.points.length < 2) {
      return;
    }
    setSavingSketch(true);
    onError(null);
    onMessage(null);
    try {
      const template = SKETCH_TEMPLATES.find(
        (entry) => entry.id === sketch.templateId
      );
      const name =
        sketch.tool === "template" && template
          ? t("{{p0}} sketch", { p0: template.label })
          : sketch.tool === "text" && sketch.text.trim()
            ? t("“{{p0}}” sketch", { p0: sketch.text.trim().toUpperCase() })
            : t("Freehand sketch");
      const payload: DrawnRoutePayload = {
        name,
        waypoints: sketch.waypoints,
        points: sketch.geometry.points,
        distanceMeters: sketch.geometry.distanceMeters,
        durationSeconds: sketch.geometry.durationSeconds,
        ascentMeters: sketch.geometry.ascentMeters,
        descentMeters: sketch.geometry.descentMeters,
        activityType,
        closed: sketch.closed,
        snap: true,
        surfacePreference: surfaceForActivity(activityType),
        elevationPreference: "any",
        insights: sketch.geometry.insights,
        unitSystem
      };
      const route = await api.saveDrawnRoute(payload);
      await refreshRoutes();
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      sketch.clear();
      setMode("generate");
      setFitRequestId((id) => id + 1);
      onMessage(t("Sketch route saved."));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setSavingSketch(false);
    }
  }

  async function handleImportGpx() {
    setImporting(true);
    onError(null);
    onMessage(null);
    try {
      const summary = await api.importRouteGpx(activityType);
      if (!summary) {
        return;
      }
      const { routes: imported, failures } = summary;
      if (imported.length > 0) {
        await refreshRoutes();
        const lastRoute = imported[imported.length - 1]!;
        setPreviewRoute(lastRoute);
        setActiveSavedId(lastRoute.id);
        setMode("generate");
        setFitRequestId((id) => id + 1);
      }

      if (imported.length > 0) {
        onMessage(
          imported.length === 1
            ? t("Imported \"{{p0}}\".", { p0: imported[0]!.name })
            : t("Imported {{p0}} routes.", { p0: imported.length })
        );
      }
      if (failures.length > 0) {
        const failureDetails = failures
          .map(({ fileName, message }) => `${fileName}: ${message}`)
          .join("; ");
        onError(
          t("Could not import {{p0}} file{{p1}}. {{p2}}", { p0: failures.length, p1: failures.length === 1 ? "" : "s", p2: failureDetails })
        );
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  async function handleSelectSaved(summary: GeneratedRouteSummary) {
    const requestId = ++previewRequestId.current;
    setSelectingRouteId(summary.id);
    onError(null);
    try {
      const route = await api.getGeneratedRoute(summary.id);
      if (requestId !== previewRequestId.current) return;
      if (!route) throw new Error(t("Saved route was not found. Refresh the route list and try again."));
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      setMode("generate");
      setDrawerOpen(false);
      setFitRequestId((id) => id + 1);
    } catch (caught) {
      if (requestId === previewRequestId.current) onError(toErrorMessage(caught));
    } finally {
      if (requestId === previewRequestId.current) setSelectingRouteId(null);
    }
  }

  async function handleExport(route: GeneratedRouteSummary) {
    setBusyId(route.id);
    onError(null);
    try {
      const filePath = await api.exportGeneratedRoute(route.id);
      if (filePath) {
        onMessage(t("GPX exported."));
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync(route: GeneratedRouteSummary) {
    if (syncing) return;
    setBusyId(route.id); setCancelPending(false);
    setSyncStatus({ phase: "connecting", routeId: route.id, routeName: route.name, sentBytes: 0, totalBytes: 0 });
    onError(null);
    try {
      const result = await api.syncCorosRoute(route.id);
      setSyncStatus(result);
      if (result.phase === "complete") onMessage(t("\"{{p0}}\" synced and verified on your watch.", { p0: result.routeName }));
      else if (result.phase === "cancelled") onMessage(t("Route sync cancelled."));
    } catch (caught) {
      const message = toErrorMessage(caught);
      setSyncStatus(current => ({ ...current!, phase: "failed", error: message }));
      onError(message);
    } finally { setBusyId(null); setCancelPending(false); }
  }

  async function handleCancelSync() {
    setCancelPending(true);
    try { await api.cancelCorosRouteSync(); }
    catch (caught) { setCancelPending(false); onError(toErrorMessage(caught)); }
  }

  async function handleShare(route: GeneratedRouteSummary) {
    onError(null);
    try {
      const session = await api.startRouteShare(route.id);
      setShareSession(session);
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  async function handleCloseShare() {
    setShareSession(null);
    await api.stopRouteShare().catch(() => undefined);
  }

  async function handleDelete(route: GeneratedRouteSummary) {
    onError(null);
    try {
      await api.deleteGeneratedRoute(route.id);
      // Invalidate an in-flight preview of this route before it can reappear.
      if (selectingRouteId === route.id) {
        previewRequestId.current += 1;
        setSelectingRouteId(null);
      }
      if (activeSavedId === route.id) {
        setPreviewRoute(null);
        setActiveSavedId(null);
      }
      if (loopChoice?.routeId === route.id) {
        setLoopChoice(null);
      }
      await refreshRoutes(routePage.offset);
      onMessage(t("Route deleted."));
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  async function handleDeleteAll() {
    onError(null);
    setDeletingAll(true);
    try {
      const removed = await api.deleteAllGeneratedRoutes();
      // Every saved route is gone: drop an in-flight preview, the shown one and its loop picker.
      if (selectingRouteId) {
        previewRequestId.current += 1;
        setSelectingRouteId(null);
      }
      if (activeSavedId) {
        setPreviewRoute(null);
        setActiveSavedId(null);
      }
      setLoopChoice(null);
      await refreshRoutes(0);
      onMessage(removed === 1 ? t("Deleted 1 route.") : t("Deleted {{p0}} routes.", { p0: removed }));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setDeletingAll(false);
    }
  }

  const summary = useMemo<RouteSummary | null>(() => {
    if (mode === "draw" || mode === "sketch") {
      const geometry = mode === "draw" ? draw.geometry : sketch.geometry;
      if (!geometry) {
        return null;
      }
      return {
        distanceMeters: geometry.distanceMeters,
        durationSeconds: geometry.durationSeconds,
        ascentMeters: geometry.ascentMeters,
        descentMeters: geometry.descentMeters,
        activityType,
        points: geometry.points,
        insights: geometry.insights,
        surfacePreference: mode === "draw" ? surfacePreference : surfaceForActivity(activityType)
      };
    }
    if (!previewRoute) {
      return null;
    }
    return {
      distanceMeters: previewRoute.distanceMeters,
      durationSeconds: previewRoute.durationSeconds,
      ascentMeters: previewRoute.ascentMeters,
      descentMeters: previewRoute.descentMeters,
      activityType: previewRoute.activityType,
      points: previewRoute.points,
      insights: previewRoute.insights,
      surfacePreference: previewRoute.surfacePreference
    };
  }, [mode, draw.geometry, sketch.geometry, previewRoute, activityType, surfacePreference, language]);

  const showLoopChoice =
    mode === "generate" &&
    routeMode === "loop" &&
    loopChoice !== null &&
    previewRoute?.id === loopChoice.routeId;
  // The loops not picked stay on the map, faintly, so shapes can be compared.
  const ghostRoutes = useMemo(
    () =>
      showLoopChoice && loopChoice
        ? loopChoice.options
            .map((option, index) => ({ points: option.points, highlighted: index === hoveredLoop, index }))
            .filter((ghost) => ghost.index !== loopChoice.selected)
        : [],
    [showLoopChoice, loopChoice, hoveredLoop]
  );

  const showStartPin = mode === "generate" && !previewRoute && Boolean(start);
  const showEndPin =
    mode === "generate" &&
    !previewRoute &&
    routeMode === "point-to-point" &&
    Boolean(destination);

  return (
    <div className="route-studio">
      <RouteMapCanvas
        mode={mode}
        baseLayer={baseLayer}
        overlays={overlays}
        route={mode === "draw" || mode === "sketch" ? null : previewRoute}
        ghostRoutes={ghostRoutes}
        drawGeometry={mode === "sketch" ? sketch.geometry : draw.geometry}
        waypoints={mode === "sketch" ? sketch.waypoints : draw.waypoints}
        startPin={showStartPin ? start : null}
        destinationPin={showEndPin ? destination : null}
        currentLocation={mode === "generate" ? currentLocation : null}
        pinTarget={mode === "generate" ? pinTarget : null}
        fitRequestId={fitRequestId}
        onMapClick={handleMapClick}
        onWaypointMove={mode === "sketch" ? sketch.moveWaypoint : draw.movePoint}
        onWaypointRemove={
          mode === "sketch" ? sketch.removeWaypoint : draw.removePoint
        }
        sketchTool={mode === "sketch" ? sketch.tool : null}
        sketchGhost={mode === "sketch" ? sketch.ghost : []}
        sketchCenter={mode === "sketch" ? sketch.center : null}
        onSketchStroke={sketch.addStroke}
        onSketchCenterMove={sketch.setCenter}
      />

      <div className="route-topbar">
        <nav className="route-mode-tabs" aria-label={t("Route tools")}>
          {MODE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={tab.id === mode ? "is-active" : ""}
                onClick={() => setMode(tab.id)}
              >
                <Icon size={16} aria-hidden="true" />
                {t(tab.label)}
              </button>
            );
          })}
        </nav>

        <div className="route-top-actions">
          <button
            type="button"
            className="route-saved-toggle route-import-toggle"
            onClick={() => void handleImportGpx()}
            disabled={importing}
            title={t("Import one or more GPX files as routes")}
          >
            {importing ? (
              <Loader2 size={16} className="spin" aria-hidden="true" />
            ) : (
              <FileUp size={16} aria-hidden="true" />
            )}
            <span className="route-top-label">{t("Import GPX")}</span>
          </button>
          <button
            type="button"
            className="route-saved-toggle"
            onClick={() => setDrawerOpen(true)}
            title={t("Saved routes")}
          >
            <FolderOpen size={16} aria-hidden="true" />
            <span className="route-top-label">{t("Saved")}</span>
            {routePage.total > 0 ? <span className="badge">{routePage.total}</span> : null}
          </button>
        </div>
      </div>

      <section className="route-panel">
        <header className="route-panel-head">
          <h2>
            {mode === "generate"
              ? t("Generate a route")
              : mode === "draw"
                ? t("Draw a route")
                : mode === "sketch"
                  ? t("Sketch GPS art")
                  : t("Explore trails")}
          </h2>
          <p>
            {mode === "generate"
              ? t("Pick a start — CorosLink builds the rest.")
              : mode === "draw"
                ? t("Click the map to drop points; drag to refine.")
                : mode === "sketch"
                  ? t("Draw a shape or word, then snap it to streets.")
                  : t("Real-world marked routes from OpenStreetMap.")}
          </p>
        </header>

        {mode === "generate" ? (
          <>
            <GeneratePanel
              api={api}
              activityType={activityType}
              onActivityChange={handleActivityChange}
              mode={routeMode}
              onModeChange={setRouteMode}
              distanceKm={distanceKm}
              onDistanceChange={setDistanceKm}
              elevationPreference={elevationPreference}
              onElevationChange={setElevationPreference}
              surfacePreference={surfacePreference}
              onSurfaceChange={setSurfacePreference}
              start={start}
              destination={destination}
              onSelectStart={handleSelectStart}
              onSelectDestination={handleSelectDestination}
              onClearStart={handleClearStart}
              onClearDestination={handleClearDestination}
              pinTarget={pinTarget}
              onPinTargetChange={setPinTarget}
              onUseCurrent={handleUseCurrent}
              onGenerate={() => void runGenerate(false)}
              onRegenerate={() => void runGenerate(true)}
              onError={onError}
              busy={generating}
              hasResult={Boolean(previewRoute)}
              results={
                showLoopChoice && loopChoice && previewRoute ? (
                  <LoopOptions
                    options={loopChoice.options}
                    selected={loopChoice.selected}
                    activityType={previewRoute.activityType}
                    surfacePreference={previewRoute.surfacePreference}
                    disabled={generating}
                    onPick={(index) => void handlePickLoop(index)}
                    onHover={setHoveredLoop}
                  />
                ) : null
              }
            />
            <AdvancedRouting api={api} onMessage={onMessage} onError={onError} />
          </>
        ) : mode === "draw" ? (
          <DrawPanel
            draw={draw}
            activityType={activityType}
            onActivityChange={handleActivityChange}
            surfacePreference={surfacePreference}
            onSurfaceChange={setSurfacePreference}
            onSave={() => void handleSaveDraw()}
            saving={savingDraw}
            canSave={draw.hasRoute}
          />
        ) : mode === "sketch" ? (
          <SketchPanel
            sketch={sketch}
            activityType={activityType}
            onActivityChange={handleActivityChange}
            onSave={() => void handleSaveSketch()}
            saving={savingSketch}
            canSave={sketch.hasRoute}
          />
        ) : (
          <ExplorePanel
            overlays={overlays}
            onToggleOverlay={(id) =>
              setOverlays((current) =>
                current.includes(id)
                  ? current.filter((value) => value !== id)
                  : [...current, id]
              )
            }
          />
        )}
      </section>

      <MapLayerControl
        value={baseLayer}
        onChange={setBaseLayer}
        overlays={overlays}
        onToggleOverlay={(id) =>
          setOverlays((current) =>
            current.includes(id)
              ? current.filter((value) => value !== id)
              : [...current, id]
          )
        }
      />

      <div className="route-statsbar-wrap" ref={footerRef}>
        {syncStatus ? (
          <div className={`route-sync-status is-${syncStatus.phase}`} role="status" aria-live="polite">
            {syncStatus.phase === "complete" ? <CheckCircle2 size={18} aria-hidden="true" /> :
              syncStatus.phase === "failed" ? <AlertCircle size={18} aria-hidden="true" /> :
              syncing ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
            <div className="route-sync-copy">
              <strong>{syncStatus.phase === "complete" ? t("Synced to watch") :
                syncStatus.phase === "failed" ? t("Route sync failed") : syncStatus.phase === "cancelled" ? t("Route sync cancelled") :
                syncStatus.phase === "connecting" ? t("Connecting to your watch…") : syncStatus.phase === "preparing" ? t("Preparing route…") :
                syncStatus.phase === "verifying" ? t("Verifying route…") : t("Syncing route…")}</strong>
              <span title={syncStatus.error ?? syncStatus.routeName}>{syncStatus.error ?? syncStatus.routeName}</span>
            </div>
            {syncing && syncStatus.totalBytes > 0 ? <progress aria-label={t("Route sync progress")} max={syncStatus.totalBytes} value={syncStatus.sentBytes} /> : null}
            {syncing ? <button type="button" className="button ghost" disabled={cancelPending} onClick={() => void handleCancelSync()}>
              {cancelPending ? t("Cancelling…") : t("Cancel sync")}
            </button> : <button type="button" className="icon-button route-sync-dismiss" aria-label={t("Dismiss route sync message")}
              title={t("Dismiss route sync message")} onClick={() => setSyncStatus(null)}><X size={16} aria-hidden="true" /></button>}
          </div>
        ) : null}
        <RouteStatsBar
          summary={summary}
          paceBaselines={paceBaselines}
          routeName={
            mode === "generate" && previewRoute ? previewRoute.name : null
          }
          onExport={
            mode === "generate" && previewRoute
              ? () => void handleExport(previewRoute)
              : undefined
          }
          onShare={
            mode === "generate" && previewRoute
              ? () => void handleShare(previewRoute)
              : undefined
          }
          onSync={mode === "generate" && previewRoute ? () => void handleSync(previewRoute) : undefined}
          syncing={syncing}
          exporting={busyId !== null}
          busy={
            mode === "draw"
              ? draw.routing
              : mode === "sketch"
                ? sketch.routing
                : generating
          }
        />
      </div>

      <SavedRoutesDrawer
        open={drawerOpen}
        page={routePage}
        loading={loadingRoutes}
        selectingId={selectingRouteId}
        onPageChange={(offset) => void refreshRoutes(offset).catch((caught) => onError(toErrorMessage(caught)))}
        activeId={activeSavedId}
        busyId={busyId}
        onClose={() => setDrawerOpen(false)}
        onSelect={(route) => void handleSelectSaved(route)}
        onExport={(route) => void handleExport(route)}
        onShare={(route) => void handleShare(route)}
        onSync={(route) => void handleSync(route)}
        syncing={syncing}
        onDelete={(route) => void handleDelete(route)}
        onDeleteAll={() => void handleDeleteAll()}
        deletingAll={deletingAll}
      />

      {shareSession ? (
        <ShareModal session={shareSession} onClose={() => void handleCloseShare()} />
      ) : null}
    </div>
  );
}

function routeGeometryOf(route: GeneratedRoute): RouteGeometry {
  return {
    points: route.points,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    ascentMeters: route.ascentMeters,
    descentMeters: route.descentMeters,
    insights: route.insights
  };
}

function withRouteGeometry(route: GeneratedRoute, geometry: RouteGeometry): GeneratedRoute {
  return {
    ...route,
    points: geometry.points,
    distanceMeters: geometry.distanceMeters,
    durationSeconds: geometry.durationSeconds,
    ascentMeters: geometry.ascentMeters,
    descentMeters: geometry.descentMeters,
    insights: geometry.insights,
    bounds: undefined
  };
}

/** Optional power-user backend: paste an OpenRouteService key to use ORS. */
function AdvancedRouting({
  api,
  onMessage,
  onError
}: {
  api: CorosLinkApi;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [backend, setBackend] = useState<RouteBackend>("keyless");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getRouteBuilderConfig()
      .then((config) => {
        setBackend(config.backend ?? "keyless");
        setApiKey(config.openRouteServiceApiKey);
      })
      .catch(() => undefined);
  }, [api]);

  async function handleSave() {
    setSaving(true);
    onError(null);
    try {
      await api.saveRouteBuilderConfig({
        openRouteServiceApiKey: apiKey.trim(),
        backend
      });
      if (backend === "ors" && apiKey.trim()) {
        const validation = await api.validateRouteApiKey(apiKey.trim());
        if (validation.status !== "valid") {
          onError(validation.message);
          return;
        }
      }
      onMessage(t("Routing settings saved."));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`route-advanced${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="route-advanced-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <KeyRound size={14} aria-hidden="true" />
        {t("Advanced routing")}{open ? (
          <ChevronUp size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="route-advanced-body">
          <div className="route-toggle" role="group" aria-label={t("Routing engine")}>
            <button
              type="button"
              className={backend === "keyless" ? "is-active" : ""}
              onClick={() => setBackend("keyless")}
            >
              {t("Keyless")}</button>
            <button
              type="button"
              className={backend === "ors" ? "is-active" : ""}
              onClick={() => setBackend("ors")}
            >
              OpenRouteService
            </button>
          </div>
          {backend === "ors" ? (
            <input
              type="password"
              className="route-advanced-key"
              placeholder={t("OpenRouteService API key")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          ) : (
            <small>
              {t("Keyless routing uses BRouter &amp; Nominatim — free, no signup.")}</small>
          )}
          <button
            type="button"
            className="button ghost"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
            {t("Save settings")}</button>
        </div>
      ) : null}
    </div>
  );
}

function ShareModal({
  session,
  onClose
}: {
  session: RouteShareSession;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  return (
    <div className="route-share-overlay" role="dialog" aria-modal="true">
      <div className="route-share-modal">
        <div className="route-share-header">
          <div>
            <p className="eyebrow">{t("Share to phone")}</p>
            <h3>{t("Scan to open on your phone")}</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("Close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <img
          className="route-share-qr"
          src={session.qrDataUrl}
          alt={t("QR code linking to the route GPX")}
          width={240}
          height={240}
        />
        <ol className="route-share-steps">
          <li>{t("Make sure your phone is on the same Wi-Fi as this computer.")}</li>
          <li>{t("Open the camera and scan the code to download the GPX.")}</li>
          <li>
            {t("Tap")} <strong>{t("Share / Open with…")}</strong>  {t("and choose the COROS app to import the route.")}</li>
        </ol>
        <p className="route-share-url">{session.url}</p>
        <small className="route-share-note">
          {t("Link works on your local network only and expires in ~10 minutes.")}</small>
      </div>
    </div>
  );
}
