import {
  Brush,
  Loader2,
  MousePointerClick,
  Route,
  Save,
  Shapes,
  Trash2,
  Type,
  Undo2,
  Wand2
} from "lucide-react";
import type { RouteActivityType } from "../../../electron/types";
import type { SketchFidelity } from "../../../electron/routing/sketchGeometry";
import { SportPicker } from "./panels";
import { SKETCH_TEMPLATES } from "./sketchShapes";
import { isSketchTextSupported } from "./strokeFont";
import type { RouteSketch, SketchTool } from "./useRouteSketch";
import { formatDistance } from "./utils";

const TOOL_OPTIONS: Array<{
  id: SketchTool;
  label: string;
  icon: typeof Brush;
}> = [
  { id: "freehand", label: "Freehand", icon: Brush },
  { id: "template", label: "Shapes", icon: Shapes },
  { id: "text", label: "Text", icon: Type }
];

const FIDELITY_OPTIONS: Array<{ value: SketchFidelity; label: string }> = [
  { value: "loose", label: "Loose" },
  { value: "balanced", label: "Balanced" },
  { value: "strict", label: "Strict" }
];

/** Maps the dimensionless similarity score onto a friendly 0–100%. */
function matchPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(100 * (1 - 1.5 * score))));
}

function describeAutoFit(result: { scale: number; rotationDeg: number }): string {
  const parts: string[] = [];
  if (result.scale !== 1) {
    parts.push(`×${result.scale} size`);
  }
  if (result.rotationDeg !== 0) {
    parts.push(
      `${result.rotationDeg > 0 ? "+" : ""}${result.rotationDeg}° rotation`
    );
  }
  return parts.length > 0 ? parts.join(", ") : "kept as placed";
}

export function SketchPanel({
  sketch,
  activityType,
  onActivityChange,
  onSave,
  saving,
  canSave
}: {
  sketch: RouteSketch;
  activityType: RouteActivityType;
  onActivityChange: (activity: RouteActivityType) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  const needsCenter = sketch.tool !== "freehand" && !sketch.center;
  const busyFitting = sketch.autoFitProgress !== null;
  const textUnsupported =
    sketch.tool === "text" &&
    sketch.text.length > 0 &&
    !isSketchTextSupported(sketch.text);

  return (
    <div className="route-panel-body">
      <SportPicker value={activityType} onChange={onActivityChange} />

      <div className="route-toggle route-sketch-tools" role="group" aria-label="Sketch tool">
        {TOOL_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              className={option.id === sketch.tool ? "is-active" : ""}
              onClick={() => sketch.setTool(option.id)}
            >
              <Icon size={14} aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>

      {sketch.tool === "freehand" ? (
        <div className="route-draw-hint">
          <MousePointerClick size={15} aria-hidden="true" />
          <span>
            Drag on the map to draw your shape. Each stroke snaps to real
            streets a moment after you let go.
          </span>
        </div>
      ) : null}

      {sketch.tool === "template" ? (
        <>
          <div className="route-template-grid" role="group" aria-label="Shape">
            {SKETCH_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={
                  template.id === sketch.templateId ? "is-active" : ""
                }
                onClick={() => sketch.setTemplateId(template.id)}
                title={template.label}
                aria-pressed={template.id === sketch.templateId}
              >
                <svg
                  className="route-template-preview"
                  viewBox="-1.15 -1.15 2.3 2.3"
                  aria-hidden="true"
                >
                  <polyline
                    points={template.points
                      .map((point) => `${point.x},${-point.y}`)
                      .join(" ")}
                  />
                </svg>
                <em>{template.label}</em>
              </button>
            ))}
          </div>
          {needsCenter ? (
            <div className="route-draw-hint">
              <MousePointerClick size={15} aria-hidden="true" />
              <span>Click the map to place the shape, then drag to move it.</span>
            </div>
          ) : null}
        </>
      ) : null}

      {sketch.tool === "text" ? (
        <>
          <input
            type="text"
            className="route-sketch-text"
            placeholder="Write something… (A–Z, 0–9)"
            value={sketch.text}
            maxLength={16}
            onChange={(event) => sketch.setText(event.target.value)}
          />
          {textUnsupported ? (
            <p className="route-inline-error">
              Only letters, numbers and spaces can be drawn.
            </p>
          ) : null}
          {needsCenter && sketch.text.trim() ? (
            <div className="route-draw-hint">
              <MousePointerClick size={15} aria-hidden="true" />
              <span>Click the map to place the text, then drag to move it.</span>
            </div>
          ) : null}
        </>
      ) : null}

      {sketch.tool !== "freehand" && sketch.center ? (
        <>
          <div className="route-distance">
            <div className="route-distance-head">
              <span>Size</span>
              <strong>{formatDistance(sketch.sizeMeters)} km</strong>
            </div>
            <input
              type="range"
              min={200}
              max={8000}
              step={100}
              value={sketch.sizeMeters}
              onChange={(event) =>
                sketch.setSizeMeters(Number(event.target.value))
              }
            />
          </div>
          <div className="route-distance">
            <div className="route-distance-head">
              <span>Rotation</span>
              <strong>{sketch.rotationDeg}°</strong>
            </div>
            <input
              type="range"
              min={0}
              max={355}
              step={5}
              value={sketch.rotationDeg}
              onChange={(event) =>
                sketch.setRotationDeg(Number(event.target.value))
              }
            />
          </div>
        </>
      ) : null}

      <div className="route-field-inline">
        <label>Fidelity</label>
        <div className="route-chip-group" role="group" aria-label="Shape fidelity">
          {FIDELITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === sketch.fidelity ? "is-active" : ""}
              onClick={() => sketch.setFidelity(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {sketch.ghost.length >= 2 ? (
        <p className="route-sketch-readout">
          Sketch outline ≈ {formatDistance(sketch.ghostDistanceMeters)} km
          before snapping.
        </p>
      ) : null}

      <div className="route-draw-tools route-sketch-actions">
        <button
          type="button"
          className="button primary"
          onClick={sketch.snapNow}
          disabled={!sketch.canSnap || sketch.routing || busyFitting}
        >
          {sketch.routing && !busyFitting ? (
            <Loader2 size={15} className="spin" aria-hidden="true" />
          ) : (
            <Route size={15} aria-hidden="true" />
          )}
          Snap to streets
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={sketch.autoFit}
          disabled={!sketch.canSnap || sketch.routing || busyFitting}
          title="Try nearby sizes and rotations, keep the best-matching route"
        >
          {busyFitting ? (
            <Loader2 size={15} className="spin" aria-hidden="true" />
          ) : (
            <Wand2 size={15} aria-hidden="true" />
          )}
          {busyFitting
            ? `Fit ${sketch.autoFitProgress!.step}/${sketch.autoFitProgress!.total}…`
            : "Auto fit"}
        </button>
        {sketch.tool === "freehand" ? (
          <button
            type="button"
            className="button ghost"
            onClick={sketch.undoStroke}
            disabled={!sketch.canUndoStroke}
          >
            <Undo2 size={15} aria-hidden="true" /> Undo
          </button>
        ) : null}
        <button
          type="button"
          className="button ghost danger"
          onClick={sketch.clear}
          disabled={sketch.ghost.length === 0 && sketch.waypoints.length === 0}
        >
          <Trash2 size={15} aria-hidden="true" /> Clear
        </button>
      </div>

      {sketch.hasRoute && sketch.match ? (
        <p className="route-sketch-readout">
          Shape match ≈ <strong>{matchPercent(sketch.match.score)}%</strong>
          {sketch.autoFitResult
            ? ` · best fit: ${describeAutoFit(sketch.autoFitResult)}`
            : ""}
          . Drag a waypoint to nudge the route; click one to remove it.
        </p>
      ) : null}

      {sketch.error ? <p className="route-inline-error">{sketch.error}</p> : null}

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
