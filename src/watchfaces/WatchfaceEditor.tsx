import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Loader2,
  Save,
  Trash2,
  WandSparkles
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceDesignState,
  CorosWatchfaceProject,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  deriveEditorLayers,
  editorLayerAtPoint,
  type EditorLayer
} from "./watchfaceEditorModel";
import {
  composeWatchfaceReplacements,
  deriveDesignDetails,
  toStudioOptions
} from "./watchfaceCompose";
import { makeDefaultDesign, renderDesignBackground } from "./watchfaceBackground";
import {
  drawStudioPreview,
  pickPreviewResolution,
  type WatchfaceMetricId,
  type WatchfaceTimePartId
} from "./watchfaceStudio";

interface WatchfaceEditorProps {
  api: CorosLinkApi;
  starterArchive: CorosWatchfaceArchive;
  initialDesign?: CorosWatchfaceDesignState;
  initialProjectId?: string;
  initialProjectName?: string;
  onArchiveCreated: (archive: CorosWatchfaceArchive) => void;
  onProjectSaved?: (project: CorosWatchfaceProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const PREVIEW_SIZE = 400;

const DIGIT_FONT_OPTIONS = [
  "American Typewriter",
  "Arial Black",
  "Avenir Next",
  "Courier New",
  "DIN Alternate",
  "Futura",
  "Georgia",
  "Gill Sans",
  "Helvetica Neue",
  "Impact",
  "Menlo",
  "Trebuchet MS"
];

export function WatchfaceEditor({
  api,
  starterArchive,
  initialDesign,
  initialProjectId,
  initialProjectName,
  onArchiveCreated,
  onProjectSaved,
  onError,
  onNotice
}: WatchfaceEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const assetCacheRef = useRef(new Map<string, CorosWatchfaceTemplateAsset>());
  const dragRef = useRef<{
    groupId: string;
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);

  const [details, setDetails] = useState<CorosWatchfaceTemplateDetails | null>(null);
  const [design, setDesign] = useState<CorosWatchfaceDesignState>(
    () => initialDesign ?? makeDefaultDesign()
  );
  const [selectedId, setSelectedId] = useState<string>("background");
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [projectName, setProjectName] = useState(initialProjectName ?? "");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAssets = useCallback(
    async (paths: string[]): Promise<CorosWatchfaceTemplateAsset[]> => {
      const cache = assetCacheRef.current;
      const missing = paths.filter((p) => !cache.has(p));
      if (missing.length > 0) {
        for (const asset of await api.loadCorosWatchfaceTemplateAssets(
          starterArchive.archiveId,
          missing
        )) {
          cache.set(asset.path, asset);
        }
      }
      return paths
        .map((p) => cache.get(p))
        .filter((a): a is CorosWatchfaceTemplateAsset => Boolean(a));
    },
    [api, starterArchive.archiveId]
  );

  useEffect(() => {
    assetCacheRef.current.clear();
    let cancelled = false;
    api
      .describeCorosWatchfaceTemplate(starterArchive.archiveId)
      .then((described) => {
        if (!cancelled) {
          setDetails(described);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          onError(caught instanceof Error ? caught.message : "Could not read the template.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, onError, starterArchive.archiveId]);

  const previewDetails = useMemo(
    () => (details ? deriveDesignDetails(details, design).previewDetails : null),
    [details, design]
  );
  const previewResolution = useMemo(
    () => (previewDetails ? pickPreviewResolution(previewDetails) : null),
    [previewDetails]
  );
  const previewWidth = previewResolution?.width ?? 800;
  const layers = useMemo(
    () => (details ? deriveEditorLayers(details, design) : []),
    [details, design]
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;

  // Repaint the background PNG whenever a background-affecting field changes.
  useEffect(() => {
    let cancelled = false;
    void renderDesignBackground(design, previewWidth)
      .then((url) => {
        if (!cancelled) {
          setBackgroundDataUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [design, previewWidth]);

  // Draw the live sprite preview from the composed design.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !previewDetails || !backgroundDataUrl) {
      return;
    }
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    const timer = window.setTimeout(() => {
      void drawStudioPreview(
        canvas,
        backgroundDataUrl,
        previewDetails,
        toStudioOptions(design),
        loadAssets
      ).catch(() => undefined);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [previewDetails, backgroundDataUrl, design, loadAssets]);

  // Draw the selection / layer outlines on the overlay.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    const scale = canvas.width / previewWidth;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of layers) {
      if (!layer.bounds || layer.kind === "background" || !layer.visible) {
        continue;
      }
      const active = layer.id === selectedId;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.16)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [5, 6]);
      context.strokeRect(
        layer.bounds.x0 * scale,
        layer.bounds.y0 * scale,
        (layer.bounds.x1 - layer.bounds.x0) * scale,
        (layer.bounds.y1 - layer.bounds.y0) * scale
      );
    }
    context.setLineDash([]);
  }, [layers, selectedId, previewWidth]);

  const toResolutionPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * previewWidth,
        y: ((event.clientY - rect.top) / rect.height) * previewWidth
      };
    },
    [previewWidth]
  );

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = toResolutionPoint(event);
    if (!point) {
      return;
    }
    const hit = editorLayerAtPoint(layers, point.x, point.y);
    if (!hit) {
      return;
    }
    setSelectedId(hit.id);
    if (hit.capabilities.position && hit.layoutGroupId) {
      const offset = design.layoutOffsets?.[hit.layoutGroupId] ?? { dx: 0, dy: 0 };
      dragRef.current = {
        groupId: hit.layoutGroupId,
        startX: point.x,
        startY: point.y,
        baseDx: offset.dx,
        baseDy: offset.dy
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const point = toResolutionPoint(event);
    if (!point) {
      return;
    }
    const clamp = (v: number) => Math.max(-400, Math.min(400, Math.round(v)));
    const dx = clamp(drag.baseDx + point.x - drag.startX);
    const dy = clamp(drag.baseDy + point.y - drag.startY);
    setDesign((prev) => ({
      ...prev,
      layoutOffsets: { ...prev.layoutOffsets, [drag.groupId]: { dx, dy } }
    }));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  }

  function patchDesign(partial: Partial<CorosWatchfaceDesignState>) {
    setDesign((prev) => ({ ...prev, ...partial }));
  }

  function setMetricVisible(metricId: WatchfaceMetricId, visible: boolean) {
    setDesign((prev) => ({
      ...prev,
      metricChanges: { ...prev.metricChanges, [metricId]: visible }
    }));
  }

  function setMetricStyle(
    metricId: WatchfaceMetricId,
    patch: { color?: string; scale?: number }
  ) {
    setDesign((prev) => {
      const current = prev.metricStyles?.[metricId] ?? {
        color: prev.digitColor,
        scale: 1
      };
      return {
        ...prev,
        metricStyles: { ...prev.metricStyles, [metricId]: { ...current, ...patch } }
      };
    });
  }

  function setTimeStyle(
    partId: WatchfaceTimePartId,
    patch: { color?: string; scale?: number }
  ) {
    setDesign((prev) => {
      const current = prev.timeStyles?.[partId] ?? { color: prev.digitColor, scale: 1 };
      return {
        ...prev,
        timeStyles: { ...prev.timeStyles, [partId]: { ...current, ...patch } }
      };
    });
  }

  async function chooseArtwork() {
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (selected) {
        patchDesign({ artwork: selected, zoom: 1 });
        onNotice("Artwork added. Select the Background layer to scale it.");
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not load artwork.");
    }
  }

  function removeSprite(spriteId: string) {
    setDesign((prev) => ({
      ...prev,
      designSprites: (prev.designSprites ?? []).filter((s) => s.id !== spriteId)
    }));
    setSelectedId("background");
  }

  async function createArchive() {
    if (!details || !backgroundDataUrl) {
      onError("The editor is still loading. Try again in a moment.");
      return;
    }
    setCreating(true);
    try {
      const { assetReplacements, configOverrides } = await composeWatchfaceReplacements(
        details,
        design,
        loadAssets
      );
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl,
        ...(assetReplacements.length > 0 ? { assetReplacements } : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {})
      });
      onArchiveCreated(archive);
      onNotice("Created an upload-ready archive from your design.");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not build the archive.");
    } finally {
      setCreating(false);
    }
  }

  async function saveProject() {
    const name = projectName.trim();
    if (!name) {
      onError("Name your project before saving.");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveCorosWatchfaceProject({
        ...(projectId ? { projectId } : {}),
        name,
        sourceArchiveId: starterArchive.archiveId,
        design
      });
      setProjectId(saved.projectId);
      setProjectName(saved.name);
      onProjectSaved?.(saved);
      onNotice(`Saved project “${saved.name}”.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel watchface-editor">
      <div className="watchface-editor-topbar">
        <div className="watchface-editor-title">
          <span className="watchfaces-panel-icon"><Layers size={18} /></span>
          <input
            className="watchface-editor-name"
            value={projectName}
            placeholder="Untitled watchface"
            onChange={(event) => setProjectName(event.target.value)}
          />
        </div>
        <div className="watchface-editor-actions">
          <button className="secondary-button" type="button" disabled={saving} onClick={() => void saveProject()}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save
          </button>
          <button className="primary-button" type="button" disabled={creating || !backgroundDataUrl} onClick={() => void createArchive()}>
            {creating ? <Loader2 className="spin" size={15} /> : <WandSparkles size={15} />} Create archive
          </button>
        </div>
      </div>

      <div className="watchface-editor-grid">
        <aside className="watchface-editor-layers">
          <p className="watchface-editor-pane-title">Layers</p>
          {details ? (
            <ul>
              {layers.map((layer) => (
                <li key={layer.id}>
                  <button
                    type="button"
                    className={`watchface-layer-row${layer.id === selectedId ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(layer.id)}
                  >
                    <span className={`watchface-layer-name${layer.visible ? "" : " is-hidden"}`}>
                      {layer.label}
                    </span>
                  </button>
                  {layer.canHide ? (
                    <button
                      type="button"
                      className="watchface-layer-visibility"
                      aria-label={layer.visible ? "Hide layer" : "Show layer"}
                      onClick={() => {
                        if (layer.metricId) {
                          setMetricVisible(layer.metricId, !layer.visible);
                        } else if (layer.spriteId) {
                          removeSprite(layer.spriteId);
                        }
                      }}
                    >
                      {layer.spriteId ? (
                        <Trash2 size={14} />
                      ) : layer.visible ? (
                        <Eye size={14} />
                      ) : (
                        <EyeOff size={14} />
                      )}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="watchface-studio-summary">Reading template…</p>
          )}
        </aside>

        <div className="watchface-editor-stage">
          <div className="watchface-preview-stack watchface-editor-device">
            <canvas ref={previewCanvasRef} className="watchface-studio-preview" width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
            <canvas
              ref={overlayCanvasRef}
              className="watchface-preview-overlay"
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              style={{ cursor: selectedLayer?.capabilities.position ? "grab" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            />
          </div>
          <p className="watchface-editor-hint">
            Click a layer to select it; drag it on the face to reposition.
          </p>
        </div>

        <aside className="watchface-editor-inspector">
          <p className="watchface-editor-pane-title">{selectedLayer?.label ?? "Inspector"}</p>
          {selectedLayer ? renderInspector(selectedLayer) : null}
        </aside>
      </div>
    </section>
  );

  function renderInspector(layer: EditorLayer) {
    if (layer.kind === "background") {
      return (
        <div className="watchface-inspector-group">
          <label className="field">
            Base color
            <span className="watchface-color-control">
              <input type="color" value={design.backgroundColor} onChange={(e) => patchDesign({ backgroundColor: e.target.value })} />
              <code>{design.backgroundColor}</code>
            </span>
          </label>
          <label className="field">
            Accent color
            <span className="watchface-color-control">
              <input type="color" value={design.accentColor} onChange={(e) => patchDesign({ accentColor: e.target.value })} />
              <code>{design.accentColor}</code>
            </span>
          </label>
          <button className="secondary-button" type="button" onClick={() => void chooseArtwork()}>
            <ImagePlus size={15} /> {design.artwork ? "Replace artwork" : "Add artwork"}
          </button>
          {design.artwork ? (
            <>
              <label className="field watchface-zoom-control">
                Artwork scale <span>{design.zoom.toFixed(2)}×</span>
                <input type="range" min="1" max="2.25" step="0.01" value={design.zoom} onChange={(e) => patchDesign({ zoom: Number(e.target.value) })} />
              </label>
              <button className="secondary-button" type="button" onClick={() => patchDesign({ artwork: null })}>
                <Trash2 size={15} /> Remove artwork
              </button>
            </>
          ) : null}
        </div>
      );
    }

    if (layer.timePartId) {
      const style = design.timeStyles?.[layer.timePartId];
      return (
        <div className="watchface-inspector-group">
          <label className="field">
            Digit font
            <select value={design.fontFamily} onChange={(e) => patchDesign({ fontFamily: e.target.value })}>
              <option value="">Keep template digits</option>
              {DIGIT_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="field">
            Digit color
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setTimeStyle(layer.timePartId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
            </span>
          </label>
          <label className="field watchface-zoom-control">
            Scale <span>{(style?.scale ?? 1).toFixed(2)}×</span>
            <input type="range" min="0.5" max="1.6" step="0.02" value={style?.scale ?? 1} onChange={(e) => setTimeStyle(layer.timePartId!, { scale: Number(e.target.value) })} />
          </label>
          {renderPositionReadout(layer)}
        </div>
      );
    }

    if (layer.kind === "metric" && layer.metricId) {
      const style = design.metricStyles?.[layer.metricId];
      return (
        <div className="watchface-inspector-group">
          <label className="watchface-studio-toggle">
            <input type="checkbox" checked={layer.visible} onChange={(e) => setMetricVisible(layer.metricId!, e.target.checked)} />
            Show this metric
          </label>
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setMetricStyle(layer.metricId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
            </span>
          </label>
          <label className="field watchface-zoom-control">
            Scale <span>{(style?.scale ?? 1).toFixed(2)}×</span>
            <input type="range" min="0.5" max="1.6" step="0.02" value={style?.scale ?? 1} onChange={(e) => setMetricStyle(layer.metricId!, { scale: Number(e.target.value) })} />
          </label>
          {renderPositionReadout(layer)}
        </div>
      );
    }

    if (layer.kind === "customSprite" && layer.spriteId) {
      return (
        <div className="watchface-inspector-group">
          <p className="watchface-studio-summary">Drag the sprite on the face to move it.</p>
          <button className="secondary-button" type="button" onClick={() => removeSprite(layer.spriteId!)}>
            <Trash2 size={15} /> Remove sprite
          </button>
        </div>
      );
    }

    return (
      <div className="watchface-inspector-group">
        {renderPositionReadout(layer)}
        <p className="watchface-studio-summary">
          This element is drawn live by the watch. Drag it on the face to reposition it.
        </p>
      </div>
    );
  }

  function renderPositionReadout(layer: EditorLayer) {
    if (!layer.capabilities.position || !layer.layoutGroupId) {
      return null;
    }
    const offset = design.layoutOffsets?.[layer.layoutGroupId] ?? { dx: 0, dy: 0 };
    const nudge = (dx: number, dy: number) =>
      setDesign((prev) => {
        const current = prev.layoutOffsets?.[layer.layoutGroupId!] ?? { dx: 0, dy: 0 };
        return {
          ...prev,
          layoutOffsets: {
            ...prev.layoutOffsets,
            [layer.layoutGroupId!]: {
              dx: Math.max(-400, Math.min(400, current.dx + dx)),
              dy: Math.max(-400, Math.min(400, current.dy + dy))
            }
          }
        };
      });
    return (
      <div className="watchface-inspector-position">
        <span>Offset {offset.dx}, {offset.dy}px</span>
        <div className="watchface-nudge-pad">
          <button type="button" onClick={() => nudge(0, -5)} aria-label="Nudge up">↑</button>
          <button type="button" onClick={() => nudge(-5, 0)} aria-label="Nudge left">←</button>
          <button type="button" onClick={() => nudge(5, 0)} aria-label="Nudge right">→</button>
          <button type="button" onClick={() => nudge(0, 5)} aria-label="Nudge down">↓</button>
          {(offset.dx !== 0 || offset.dy !== 0) ? (
            <button type="button" className="watchface-nudge-reset" onClick={() => nudge(-offset.dx, -offset.dy)}>Reset</button>
          ) : null}
        </div>
      </div>
    );
  }
}
