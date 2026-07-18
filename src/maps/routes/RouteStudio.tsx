import {
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
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityPaceBaselines,
  DrawnRoutePayload,
  GeneratedRoute,
  GenerateRouteRequest,
  RouteActivityType,
  RouteBackend,
  RouteElevationPreference,
  RouteMode,
  RouteShareSession,
  RouteWaypoint
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import type { RouteBaseLayer, RouteOverlayId } from "./constants";
import { RouteMapCanvas, type RouteStudioMode } from "./RouteMapCanvas";
import { RouteStatsBar, type RouteSummary } from "./RouteStatsBar";
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
import { surfaceForActivity, toErrorMessage } from "./utils";

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
  const [mode, setMode] = useState<RouteStudioMode>("generate");
  const [activityType, setActivityType] = useState<RouteActivityType>("running");

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

  // Shared / preview state
  const [previewRoute, setPreviewRoute] = useState<GeneratedRoute | null>(null);
  const [routes, setRoutes] = useState<GeneratedRoute[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingDraw, setSavingDraw] = useState(false);
  const [importing, setImporting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareSession, setShareSession] = useState<RouteShareSession | null>(
    null
  );
  const [paceBaselines, setPaceBaselines] = useState<ActivityPaceBaselines>({});
  const [fitRequestId, setFitRequestId] = useState(0);

  // Map state
  const [baseLayer, setBaseLayer] = useState<RouteBaseLayer>("outdoors");
  const [overlays, setOverlays] = useState<RouteOverlayId[]>([]);

  const draw = useRouteDraw(api, activityType);
  const sketch = useRouteSketch(api, activityType);
  const [savingSketch, setSavingSketch] = useState(false);

  useEffect(() => {
    void api
      .listGeneratedRoutes()
      .then((next) => {
        setRoutes(next);
        if (next[0]) {
          setPreviewRoute(next[0]);
          setActiveSavedId(next[0].id);
        }
      })
      .catch((caught) => onError(toErrorMessage(caught)));
    void api
      .getActivityPaceBaselines()
      .then(setPaceBaselines)
      .catch(() => setPaceBaselines({}));
  }, [api, onError]);

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
        const label = `Pinned ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
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
    void requestDeviceRouteLocation()
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
  }, [onError]);

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
        surfacePreference: surfaceForActivity(activityType),
        avoidHighways: false,
        elevationPreference,
        variationSeed: regenerate ? Date.now() : undefined
      };
      const route = await api.generateRoute(request);
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      setRoutes(await api.listGeneratedRoutes());
      setFitRequestId((id) => id + 1);
      onMessage(regenerate ? "Generated a fresh loop." : "Route ready.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setGenerating(false);
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
        snap: draw.snap
      };
      const route = await api.saveDrawnRoute(payload);
      setRoutes(await api.listGeneratedRoutes());
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      draw.clear();
      setMode("generate");
      setFitRequestId((id) => id + 1);
      onMessage("Route saved.");
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
          ? `${template.label} sketch`
          : sketch.tool === "text" && sketch.text.trim()
            ? `“${sketch.text.trim().toUpperCase()}” sketch`
            : "Freehand sketch";
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
        snap: true
      };
      const route = await api.saveDrawnRoute(payload);
      setRoutes(await api.listGeneratedRoutes());
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      sketch.clear();
      setMode("generate");
      setFitRequestId((id) => id + 1);
      onMessage("Sketch route saved.");
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
      const route = await api.importRouteGpx(activityType);
      if (!route) {
        return;
      }
      setRoutes(await api.listGeneratedRoutes());
      setPreviewRoute(route);
      setActiveSavedId(route.id);
      setMode("generate");
      setFitRequestId((id) => id + 1);
      onMessage(`Imported "${route.name}".`);
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  function handleSelectSaved(route: GeneratedRoute) {
    setPreviewRoute(route);
    setActiveSavedId(route.id);
    setMode("generate");
    setDrawerOpen(false);
    setFitRequestId((id) => id + 1);
  }

  async function handleExport(route: GeneratedRoute) {
    setBusyId(route.id);
    onError(null);
    try {
      const filePath = await api.exportGeneratedRoute(route.id);
      if (filePath) {
        onMessage("GPX exported.");
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function handleShare(route: GeneratedRoute) {
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

  async function handleDelete(route: GeneratedRoute) {
    onError(null);
    try {
      await api.deleteGeneratedRoute(route.id);
      const next = await api.listGeneratedRoutes();
      setRoutes(next);
      if (activeSavedId === route.id) {
        setPreviewRoute(next[0] ?? null);
        setActiveSavedId(next[0]?.id ?? null);
      }
      onMessage("Route deleted.");
    } catch (caught) {
      onError(toErrorMessage(caught));
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
        points: geometry.points
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
      points: previewRoute.points
    };
  }, [mode, draw.geometry, sketch.geometry, previewRoute, activityType]);

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

      <nav className="route-mode-tabs" aria-label="Route tools">
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
              {tab.label}
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
          title="Import a GPX file as a route"
        >
          {importing ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <FileUp size={16} aria-hidden="true" />
          )}
          Import GPX
        </button>
        <button
          type="button"
          className="route-saved-toggle"
          onClick={() => setDrawerOpen(true)}
        >
          <FolderOpen size={16} aria-hidden="true" />
          Saved
          {routes.length > 0 ? <span className="badge">{routes.length}</span> : null}
        </button>
      </div>

      <section className="route-panel">
        <header className="route-panel-head">
          <h2>
            {mode === "generate"
              ? "Generate a route"
              : mode === "draw"
                ? "Draw a route"
                : mode === "sketch"
                  ? "Sketch GPS art"
                  : "Explore trails"}
          </h2>
          <p>
            {mode === "generate"
              ? "Pick a start — CorosLink builds the rest."
              : mode === "draw"
                ? "Click the map to drop points; drag to refine."
                : mode === "sketch"
                  ? "Draw a shape or word, then snap it to streets."
                  : "Real-world marked routes from OpenStreetMap."}
          </p>
        </header>

        {mode === "generate" ? (
          <>
            <GeneratePanel
              api={api}
              activityType={activityType}
              onActivityChange={setActivityType}
              mode={routeMode}
              onModeChange={setRouteMode}
              distanceKm={distanceKm}
              onDistanceChange={setDistanceKm}
              elevationPreference={elevationPreference}
              onElevationChange={setElevationPreference}
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
            />
            <AdvancedRouting api={api} onMessage={onMessage} onError={onError} />
          </>
        ) : mode === "draw" ? (
          <DrawPanel
            draw={draw}
            activityType={activityType}
            onActivityChange={setActivityType}
            onSave={() => void handleSaveDraw()}
            saving={savingDraw}
            canSave={draw.hasRoute}
          />
        ) : mode === "sketch" ? (
          <SketchPanel
            sketch={sketch}
            activityType={activityType}
            onActivityChange={setActivityType}
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

      <div className="route-statsbar-wrap">
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
        routes={routes}
        activeId={activeSavedId}
        busyId={busyId}
        onClose={() => setDrawerOpen(false)}
        onSelect={handleSelectSaved}
        onExport={(route) => void handleExport(route)}
        onShare={(route) => void handleShare(route)}
        onDelete={(route) => void handleDelete(route)}
      />

      {shareSession ? (
        <ShareModal session={shareSession} onClose={() => void handleCloseShare()} />
      ) : null}
    </div>
  );
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
      onMessage("Routing settings saved.");
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
        Advanced routing
        {open ? (
          <ChevronUp size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="route-advanced-body">
          <div className="route-toggle" role="group" aria-label="Routing engine">
            <button
              type="button"
              className={backend === "keyless" ? "is-active" : ""}
              onClick={() => setBackend("keyless")}
            >
              Keyless
            </button>
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
              placeholder="OpenRouteService API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          ) : (
            <small>
              Keyless routing uses BRouter &amp; Nominatim — free, no signup.
            </small>
          )}
          <button
            type="button"
            className="button ghost"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
            Save settings
          </button>
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
  return (
    <div className="route-share-overlay" role="dialog" aria-modal="true">
      <div className="route-share-modal">
        <div className="route-share-header">
          <div>
            <p className="eyebrow">Share to phone</p>
            <h3>Scan to open on your phone</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <img
          className="route-share-qr"
          src={session.qrDataUrl}
          alt="QR code linking to the route GPX"
          width={240}
          height={240}
        />
        <ol className="route-share-steps">
          <li>Make sure your phone is on the same Wi-Fi as this computer.</li>
          <li>Open the camera and scan the code to download the GPX.</li>
          <li>
            Tap <strong>Share / Open with…</strong> and choose the COROS app to
            import the route.
          </li>
        </ol>
        <p className="route-share-url">{session.url}</p>
        <small className="route-share-note">
          Link works on your local network only and expires in ~10 minutes.
        </small>
      </div>
    </div>
  );
}
