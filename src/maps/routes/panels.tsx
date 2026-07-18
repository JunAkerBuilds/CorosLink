import {
  Compass,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  MousePointerClick,
  PenLine,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  RouteActivityType,
  RouteElevationPreference,
  RouteGeocodeResult,
  RouteMode,
  RouteWaypoint
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import {
  ROUTE_ACTIVITY_OPTIONS,
  ROUTE_BASE_LAYERS,
  ROUTE_BASE_LAYER_ORDER,
  ROUTE_ELEVATION_OPTIONS,
  ROUTE_OVERLAY_LAYERS,
  ROUTE_OVERLAY_ORDER,
  type RouteBaseLayer,
  type RouteOverlayId
} from "./constants";
import type { RouteDraw } from "./useRouteDraw";
import { isCyclingActivity, maxDistanceForActivity, toErrorMessage } from "./utils";

export interface ResolvedPoint extends RouteWaypoint {
  label: string;
  /** String sent to the backend for generation (place text or "lat,lon"). */
  query?: string;
}

/** Debounced Nominatim autocomplete with an inline "pin on map" toggle. */
export function LocationSearchField({
  api,
  value,
  placeholder,
  onSelect,
  onError,
  pinActive,
  onTogglePin,
  onUseCurrent,
  onClear,
  accent
}: {
  api: CorosLinkApi;
  value: ResolvedPoint | null;
  placeholder: string;
  onSelect: (point: ResolvedPoint) => void;
  onError: (message: string | null) => void;
  pinActive: boolean;
  onTogglePin: () => void;
  onUseCurrent?: () => void;
  onClear?: () => void;
  accent: "start" | "end";
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RouteGeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  // Reflect an externally resolved point (e.g. dropped as a pin) in the input,
  // and blank the input again when the point is cleared.
  useEffect(() => {
    setQuery(value ? value.label : "");
    setOpen(false);
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || trimmed === value?.label) {
      seq.current += 1;
      setResults([]);
      setSearching(false);
      return;
    }
    const current = ++seq.current;
    const timer = setTimeout(() => {
      setSearching(true);
      void api
        .searchRouteLocations(trimmed)
        .then((next) => {
          if (current === seq.current) {
            setResults(next);
            setOpen(true);
          }
        })
        .catch((caught) => onError(toErrorMessage(caught)))
        .finally(() => {
          if (current === seq.current) {
            setSearching(false);
          }
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, api, onError, value?.label]);

  return (
    <div className={`route-search route-search-${accent}`}>
      <span className="route-search-dot" aria-hidden="true" />
      <div className="route-search-input">
        <Search size={15} aria-hidden="true" />
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {searching ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
        {value && onClear ? (
          <button
            type="button"
            className="route-search-icon route-search-clear"
            title={`Clear ${accent === "start" ? "start point" : "destination"}`}
            aria-label={`Clear ${accent === "start" ? "start point" : "destination"}`}
            onClick={onClear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
        {onUseCurrent ? (
          <button
            type="button"
            className="route-search-icon"
            title="Use my location"
            aria-label="Use my location"
            onClick={onUseCurrent}
          >
            <LocateFixed size={15} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className={`route-search-icon${pinActive ? " is-active" : ""}`}
          title={pinActive ? "Click the map to place (Esc to cancel)" : "Pick on map"}
          aria-label={pinActive ? "Cancel map pin" : "Pick on map"}
          aria-pressed={pinActive}
          onClick={onTogglePin}
        >
          <MapPin size={15} aria-hidden="true" />
        </button>
      </div>

      {open && results.length > 0 ? (
        <ul className="route-search-results">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon}`}>
              <button
                type="button"
                onClick={() => {
                  onSelect({
                    lat: result.lat,
                    lon: result.lon,
                    label: result.label,
                    query: `${result.lat},${result.lon}`
                  });
                  setQuery(result.label);
                  setResults([]);
                  setSearching(false);
                  setOpen(false);
                }}
              >
                <MapPin size={13} aria-hidden="true" />
                <span>{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SportPicker({
  value,
  onChange
}: {
  value: RouteActivityType;
  onChange: (activity: RouteActivityType) => void;
}) {
  return (
    <div className="route-sport-picker" role="group" aria-label="Activity">
      {ROUTE_ACTIVITY_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            title={option.label}
            aria-pressed={option.value === value}
          >
            <Icon size={16} aria-hidden="true" />
            <em>{option.shortLabel}</em>
          </button>
        );
      })}
    </div>
  );
}

/** One-tap distance shortcuts, filtered to the activity's range. */
const DISTANCE_PRESETS: Record<
  "foot" | "bike",
  Array<{ value: number; label: string }>
> = {
  foot: [
    { value: 5, label: "5K" },
    { value: 10, label: "10K" },
    { value: 21.1, label: "21K" },
    { value: 42.2, label: "42K" }
  ],
  bike: [
    { value: 20, label: "20K" },
    { value: 50, label: "50K" },
    { value: 80, label: "80K" },
    { value: 100, label: "100K" }
  ]
};

function StepTitle({ index, children }: { index: number; children: string }) {
  return (
    <h3 className="route-step-title">
      <span className="route-step-num" aria-hidden="true">
        {index}
      </span>
      {children}
    </h3>
  );
}

export function GeneratePanel({
  api,
  activityType,
  onActivityChange,
  mode,
  onModeChange,
  distanceKm,
  onDistanceChange,
  elevationPreference,
  onElevationChange,
  start,
  destination,
  onSelectStart,
  onSelectDestination,
  onClearStart,
  onClearDestination,
  pinTarget,
  onPinTargetChange,
  onUseCurrent,
  onGenerate,
  onRegenerate,
  onError,
  busy,
  hasResult
}: {
  api: CorosLinkApi;
  activityType: RouteActivityType;
  onActivityChange: (activity: RouteActivityType) => void;
  mode: RouteMode;
  onModeChange: (mode: RouteMode) => void;
  distanceKm: number;
  onDistanceChange: (value: number) => void;
  elevationPreference: RouteElevationPreference;
  onElevationChange: (value: RouteElevationPreference) => void;
  start: ResolvedPoint | null;
  destination: ResolvedPoint | null;
  onSelectStart: (point: ResolvedPoint) => void;
  onSelectDestination: (point: ResolvedPoint) => void;
  onClearStart: () => void;
  onClearDestination: () => void;
  pinTarget: "start" | "destination" | null;
  onPinTargetChange: (target: "start" | "destination" | null) => void;
  onUseCurrent: () => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onError: (message: string | null) => void;
  busy: boolean;
  hasResult: boolean;
}) {
  const maxDistance = maxDistanceForActivity(activityType);
  const canGenerate =
    Boolean(start) &&
    (mode === "loop" || Boolean(destination)) &&
    distanceKm > 0;
  const presets = (
    isCyclingActivity(activityType)
      ? DISTANCE_PRESETS.bike
      : DISTANCE_PRESETS.foot
  ).filter((preset) => preset.value <= maxDistance);
  const ctaHint = !start
    ? "Pick a start point — search above, use your location, or drop a pin on the map."
    : mode === "point-to-point" && !destination
      ? "Add a destination to route from A to B."
      : null;

  return (
    <div className="route-panel-body">
      <section className="route-step">
        <StepTitle index={1}>Sport &amp; route type</StepTitle>
        <SportPicker value={activityType} onChange={onActivityChange} />

        <div className="route-mode-switch" role="group" aria-label="Route type">
          <button
            type="button"
            className={mode === "loop" ? "is-active" : ""}
            aria-pressed={mode === "loop"}
            onClick={() => onModeChange("loop")}
          >
            Loop
          </button>
          <button
            type="button"
            className={mode === "point-to-point" ? "is-active" : ""}
            aria-pressed={mode === "point-to-point"}
            onClick={() => onModeChange("point-to-point")}
          >
            A → B
          </button>
        </div>
      </section>

      <section className="route-step">
        <StepTitle index={2}>
          {mode === "loop" ? "Where to start?" : "Start & destination"}
        </StepTitle>
        <div className="route-search-stack">
          <LocationSearchField
            api={api}
            value={start}
            placeholder="Start location"
            onSelect={onSelectStart}
            onError={onError}
            pinActive={pinTarget === "start"}
            onTogglePin={() =>
              onPinTargetChange(pinTarget === "start" ? null : "start")
            }
            onUseCurrent={onUseCurrent}
            onClear={onClearStart}
            accent="start"
          />
          {mode === "point-to-point" ? (
            <LocationSearchField
              api={api}
              value={destination}
              placeholder="Destination"
              onSelect={onSelectDestination}
              onError={onError}
              pinActive={pinTarget === "destination"}
              onTogglePin={() =>
                onPinTargetChange(
                  pinTarget === "destination" ? null : "destination"
                )
              }
              onClear={onClearDestination}
              accent="end"
            />
          ) : null}
        </div>
      </section>

      <section className="route-step">
        <StepTitle index={3}>
          {mode === "loop" ? "Distance & terrain" : "Terrain"}
        </StepTitle>
        {mode === "loop" ? (
          <div className="route-distance">
            <div className="route-distance-head">
              <span>Distance</span>
              <strong>{distanceKm.toFixed(1)} km</strong>
            </div>
            <input
              type="range"
              min={1}
              max={maxDistance}
              step={0.5}
              value={Math.min(distanceKm, maxDistance)}
              aria-label="Distance in kilometres"
              onChange={(event) => onDistanceChange(Number(event.target.value))}
            />
            <div
              className="route-distance-presets"
              role="group"
              aria-label="Distance presets"
            >
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={
                    Math.abs(distanceKm - preset.value) < 0.05
                      ? "is-active"
                      : ""
                  }
                  onClick={() => onDistanceChange(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="route-field-inline">
          <label>Elevation</label>
          <div className="route-chip-group" role="group" aria-label="Elevation preference">
            {ROUTE_ELEVATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === elevationPreference ? "is-active" : ""}
                aria-pressed={option.value === elevationPreference}
                onClick={() => onElevationChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="route-panel-actions">
        <button
          type="button"
          className="button primary route-generate"
          disabled={!canGenerate || busy}
          onClick={onGenerate}
        >
          {busy ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {busy ? "Building…" : "Generate route"}
        </button>
        {mode === "loop" && hasResult ? (
          <button
            type="button"
            className="button ghost route-variation"
            disabled={busy}
            onClick={onRegenerate}
            title="Try a different loop with the same settings"
          >
            <RefreshCw size={14} aria-hidden="true" />
            New variation
          </button>
        ) : null}
      </div>
      {ctaHint && !busy ? <p className="route-cta-hint">{ctaHint}</p> : null}
    </div>
  );
}

export function DrawPanel({
  draw,
  activityType,
  onActivityChange,
  onSave,
  saving,
  canSave
}: {
  draw: RouteDraw;
  activityType: RouteActivityType;
  onActivityChange: (activity: RouteActivityType) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  return (
    <div className="route-panel-body">
      <SportPicker value={activityType} onChange={onActivityChange} />

      <div className="route-draw-hint">
        <MousePointerClick size={15} aria-hidden="true" />
        <span>
          Click the map to drop points. Drag any point to reshape, click a point
          to remove it.
        </span>
      </div>

      <div className="route-field-inline">
        <label>Follow paths</label>
        <div className="route-toggle" role="group" aria-label="Snap to paths">
          <button
            type="button"
            className={draw.snap ? "is-active" : ""}
            aria-pressed={draw.snap}
            onClick={() => draw.setSnap(true)}
          >
            Snap to roads
          </button>
          <button
            type="button"
            className={!draw.snap ? "is-active" : ""}
            aria-pressed={!draw.snap}
            onClick={() => draw.setSnap(false)}
          >
            Freehand
          </button>
        </div>
      </div>

      <div className="route-draw-tools">
        <button
          type="button"
          className="button ghost"
          onClick={draw.undo}
          disabled={!draw.canUndo}
        >
          <Undo2 size={15} aria-hidden="true" /> Undo
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={draw.closeLoop}
          disabled={draw.waypoints.length < 3 || draw.closed}
        >
          <Compass size={15} aria-hidden="true" /> Close loop
        </button>
        <button
          type="button"
          className="button ghost danger"
          onClick={draw.clear}
          disabled={draw.waypoints.length === 0}
        >
          <Trash2 size={15} aria-hidden="true" /> Clear
        </button>
      </div>

      {draw.error ? <p className="route-inline-error">{draw.error}</p> : null}

      <div className="route-panel-actions">
        <button
          type="button"
          className="button primary"
          onClick={onSave}
          disabled={!canSave || saving}
        >
          {saving ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Save size={16} aria-hidden="true" />
          )}
          {saving ? "Saving…" : "Save route"}
        </button>
      </div>
    </div>
  );
}

export function ExplorePanel({
  overlays,
  onToggleOverlay
}: {
  overlays: RouteOverlayId[];
  onToggleOverlay: (id: RouteOverlayId) => void;
}) {
  return (
    <div className="route-panel-body">
      <p className="route-explore-lead">
        <PenLine size={14} aria-hidden="true" />
        Discover routes people actually use — official marked trails and cycle
        networks from OpenStreetMap.
      </p>
      <div className="route-overlay-list">
        {ROUTE_OVERLAY_ORDER.map((id) => {
          const config = ROUTE_OVERLAY_LAYERS[id];
          const active = overlays.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`route-overlay-item${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => onToggleOverlay(id)}
            >
              <span
                className="route-overlay-swatch"
                style={{ background: config.swatch }}
                aria-hidden="true"
              />
              <span className="route-overlay-text">
                <strong>{config.label}</strong>
                <em>{config.description}</em>
              </span>
              <span className={`route-overlay-check${active ? " is-on" : ""}`} />
            </button>
          );
        })}
      </div>
      <small className="route-explore-note">
        Tip: zoom in to reveal more local trails. Overlay data © Waymarked Trails
        &amp; OpenStreetMap contributors.
      </small>
    </div>
  );
}

/** Floating base-map switcher (bottom-right of the map). */
export function MapLayerControl({
  value,
  onChange,
  overlays,
  onToggleOverlay
}: {
  value: RouteBaseLayer;
  onChange: (layer: RouteBaseLayer) => void;
  overlays?: RouteOverlayId[];
  onToggleOverlay?: (overlay: RouteOverlayId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`route-basemap${open ? " is-open" : ""}`}>
      {open ? (
        <div className="route-basemap-menu">
          <div className="route-basemap-head">
            <span>Base map</span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          {ROUTE_BASE_LAYER_ORDER.map((id) => {
            const config = ROUTE_BASE_LAYERS[id];
            return (
              <button
                key={id}
                type="button"
                className={`route-basemap-option${id === value ? " is-active" : ""}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <strong>{config.label}</strong>
                <em>{config.description}</em>
              </button>
            );
          })}
          {overlays && onToggleOverlay && (
            <>
              <div className="route-basemap-divider" />
              <div className="route-basemap-head">
                <span>Trail overlays</span>
              </div>
              {ROUTE_OVERLAY_ORDER.map((id) => {
                const config = ROUTE_OVERLAY_LAYERS[id];
                const active = overlays.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`route-basemap-option${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onToggleOverlay(id)}
                  >
                    <strong>
                      <span
                        className="route-basemap-swatch"
                        style={{ background: config.swatch }}
                        aria-hidden="true"
                      />
                      {config.label}
                    </strong>
                    <em>{config.description}</em>
                  </button>
                );
              })}
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="route-basemap-toggle"
          onClick={() => setOpen(true)}
          title="Change base map"
          aria-label="Change base map"
        >
          <Layers size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
