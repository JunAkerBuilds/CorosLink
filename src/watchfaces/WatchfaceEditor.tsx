import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Loader2,
  Minus,
  Save,
  Square,
  Trash2,
  Type,
  WandSparkles
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceBackgroundEllipse,
  CorosWatchfaceBackgroundLine,
  CorosWatchfaceBackgroundRect,
  CorosWatchfaceBackgroundText,
  CorosWatchfaceDesignState,
  CorosWatchfaceProject,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";

/** Any subset of shape fields, minus the discriminant, for in-place edits. */
type BackgroundElementPatch = Partial<
  Omit<CorosWatchfaceBackgroundRect, "kind"> &
    Omit<CorosWatchfaceBackgroundEllipse, "kind"> &
    Omit<CorosWatchfaceBackgroundLine, "kind"> &
    Omit<CorosWatchfaceBackgroundText, "kind">
>;
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
import {
  makeDefaultDesign,
  MAX_DESIGN_SPRITES,
  renderDesignBackground
} from "./watchfaceBackground";
import {
  BACKGROUND_SPACE,
  backgroundElementAtPoint,
  backgroundElementBounds,
  backgroundElementLabel,
  createBackgroundElement
} from "./watchfaceBackgroundElements";
import {
  computeLayoutOffsetLimits,
  drawStudioPreview,
  inferStaticSeparators,
  pickPreviewResolution,
  type WatchfaceDatePartId,
  type WatchfaceMetricId,
  type WatchfaceStaticSeparatorId,
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

const PREVIEW_SIZE = 520;

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
    kind: "layout" | "bgElement" | "sprite" | "staticSeparator";
    targetId: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [loadingSprite, setLoadingSprite] = useState(false);

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
          if (!initialDesign) {
            setDesign((current) => ({
              ...current,
              staticSeparators: inferStaticSeparators(
                described,
                current.digitColor
              )
            }));
          }
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
  }, [api, initialDesign, onError, starterArchive.archiveId]);

  const designDetails = useMemo(
    () => (details ? deriveDesignDetails(details, design) : null),
    [details, design]
  );
  const previewDetails = designDetails?.previewDetails ?? null;
  const previewResolution = useMemo(
    () => (previewDetails ? pickPreviewResolution(previewDetails) : null),
    [previewDetails]
  );
  const previewWidth = previewResolution?.width ?? 800;
  const layoutLimits = useMemo(() => {
    const base = designDetails
      ? pickPreviewResolution(designDetails.styledMetricDetails)
      : null;
    return base ? computeLayoutOffsetLimits(base) : {};
  }, [designDetails]);
  const layers = useMemo(
    () => (details ? deriveEditorLayers(details, design) : []),
    [details, design]
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;
  const backgroundElements = design.backgroundElements ?? [];
  const selectedElementId = selectedId.startsWith("bgel:")
    ? selectedId.slice("bgel:".length)
    : null;
  const selectedElement =
    backgroundElements.find((element) => element.id === selectedElementId) ?? null;
  const backgroundContext = selectedId === "background" || selectedElement !== null;

  function updateElement(id: string, patch: BackgroundElementPatch) {
    setDesign((prev) => ({
      ...prev,
      backgroundElements: (prev.backgroundElements ?? []).map((element) =>
        element.id === id
          ? ({ ...element, ...patch } as CorosWatchfaceBackgroundElement)
          : element
      )
    }));
  }

  function addElement(kind: CorosWatchfaceBackgroundElement["kind"]) {
    const element = createBackgroundElement(
      kind,
      { x: BACKGROUND_SPACE / 2, y: BACKGROUND_SPACE / 2 },
      design.fontFamily
    );
    setDesign((prev) => ({
      ...prev,
      backgroundElements: [...(prev.backgroundElements ?? []), element]
    }));
    setSelectedId(`bgel:${element.id}`);
  }

  function removeElement(id: string) {
    setDesign((prev) => ({
      ...prev,
      backgroundElements: (prev.backgroundElements ?? []).filter((e) => e.id !== id)
    }));
    setSelectedId("background");
  }

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
    const bgScale = canvas.width / BACKGROUND_SPACE;
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Freeform background shapes (drawn faint unless selected).
    for (const element of backgroundElements) {
      const box = backgroundElementBounds(element);
      const active = selectedId === `bgel:${element.id}`;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(120, 200, 255, 0.28)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [4, 5]);
      context.strokeRect(
        box.x0 * bgScale,
        box.y0 * bgScale,
        (box.x1 - box.x0) * bgScale,
        (box.y1 - box.y0) * bgScale
      );
    }

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
  }, [layers, selectedId, previewWidth, backgroundElements]);

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
    const toBg = BACKGROUND_SPACE / previewWidth;

    // When working on the background, clicks target the freeform shapes that
    // sit above it; otherwise the live firmware elements take priority.
    const liveHit = editorLayerAtPoint(layers, point.x, point.y);
    const liveIsElement = liveHit !== null && liveHit.kind !== "background";
    if (backgroundContext || !liveIsElement) {
      const bgHit = backgroundElementAtPoint(
        backgroundElements,
        point.x * toBg,
        point.y * toBg
      );
      if (bgHit) {
        setSelectedId(`bgel:${bgHit.id}`);
        dragRef.current = {
          kind: "bgElement",
          targetId: bgHit.id,
          startX: point.x * toBg,
          startY: point.y * toBg,
          baseX: bgHit.x,
          baseY: bgHit.y
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (!liveHit) {
      return;
    }
    setSelectedId(liveHit.id);
    if (liveHit.staticSeparatorId) {
      const separator = design.staticSeparators[liveHit.staticSeparatorId];
      dragRef.current = {
        kind: "staticSeparator",
        targetId: liveHit.staticSeparatorId,
        startX: point.x,
        startY: point.y,
        baseX: separator.x,
        baseY: separator.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (liveHit.kind === "customSprite" && liveHit.spriteId) {
      const sprite = (design.designSprites ?? []).find((s) => s.id === liveHit.spriteId);
      if (sprite) {
        dragRef.current = {
          kind: "sprite",
          targetId: sprite.id,
          startX: point.x,
          startY: point.y,
          baseX: sprite.x,
          baseY: sprite.y
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (liveHit.capabilities.position && liveHit.layoutGroupId) {
      const offset = design.layoutOffsets?.[liveHit.layoutGroupId] ?? { dx: 0, dy: 0 };
      dragRef.current = {
        kind: "layout",
        targetId: liveHit.layoutGroupId,
        startX: point.x,
        startY: point.y,
        baseX: offset.dx,
        baseY: offset.dy
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
    if (drag.kind === "bgElement") {
      const toBg = BACKGROUND_SPACE / previewWidth;
      const clampBg = (v: number) => Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(v)));
      updateElement(drag.targetId, {
        x: clampBg(drag.baseX + point.x * toBg - drag.startX),
        y: clampBg(drag.baseY + point.y * toBg - drag.startY)
      });
      return;
    }
    if (drag.kind === "sprite") {
      const clampRes = (v: number) => Math.max(0, Math.min(previewWidth, Math.round(v)));
      updateSprite(drag.targetId, {
        x: clampRes(drag.baseX + point.x - drag.startX),
        y: clampRes(drag.baseY + point.y - drag.startY)
      });
      return;
    }
    if (drag.kind === "staticSeparator") {
      const separatorId = drag.targetId as WatchfaceStaticSeparatorId;
      const separator = design.staticSeparators[separatorId];
      const halfWidth = Math.max(24, separator.size * 0.65) / 2;
      const halfHeight = Math.max(24, separator.size * 1.15) / 2;
      updateStaticSeparator(separatorId, {
        x: Math.round(
          Math.max(
            halfWidth,
            Math.min(previewWidth - halfWidth, drag.baseX + point.x - drag.startX)
          )
        ),
        y: Math.round(
          Math.max(
            halfHeight,
            Math.min(
              (previewResolution?.height ?? previewWidth) - halfHeight,
              drag.baseY + point.y - drag.startY
            )
          )
        )
      });
      return;
    }
    const limits = layoutLimits[drag.targetId];
    const fallbackLimit = Math.max(
      previewResolution?.width ?? 800,
      previewResolution?.height ?? 800
    );
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Math.round(v)));
    const dx = clamp(
      drag.baseX + point.x - drag.startX,
      limits?.minDx ?? -fallbackLimit,
      limits?.maxDx ?? fallbackLimit
    );
    const dy = clamp(
      drag.baseY + point.y - drag.startY,
      limits?.minDy ?? -fallbackLimit,
      limits?.maxDy ?? fallbackLimit
    );
    setDesign((prev) => ({
      ...prev,
      layoutOffsets: { ...prev.layoutOffsets, [drag.targetId]: { dx, dy } }
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

  function setFirmwareLayerVisible(layerId: string, visible: boolean) {
    setDesign((prev) => ({
      ...prev,
      layerVisibility: {
        ...prev.layerVisibility,
        [layerId]: visible
      }
    }));
  }

  function setLayerColor(layerId: string, color: string) {
    setDesign((prev) => ({
      ...prev,
      layerColors: {
        ...prev.layerColors,
        [layerId]: color
      }
    }));
  }

  function updateStaticSeparator(
    separatorId: WatchfaceStaticSeparatorId,
    patch: Partial<
      CorosWatchfaceDesignState["staticSeparators"][WatchfaceStaticSeparatorId]
    >
  ) {
    setDesign((prev) => ({
      ...prev,
      staticSeparators: {
        ...prev.staticSeparators,
        [separatorId]: {
          ...prev.staticSeparators[separatorId],
          ...patch
        }
      }
    }));
  }

  function setMetricStyle(
    metricId: WatchfaceMetricId,
    patch: { color?: string; scale?: number; fontFamily?: string }
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
    patch: { color?: string; scale?: number; fontFamily?: string }
  ) {
    setDesign((prev) => {
      const current = prev.timeStyles?.[partId] ?? { color: prev.digitColor, scale: 1 };
      return {
        ...prev,
        timeStyles: { ...prev.timeStyles, [partId]: { ...current, ...patch } }
      };
    });
  }

  function setDateStyle(
    partId: WatchfaceDatePartId,
    patch: { scale?: number; fontFamily?: string; color?: string }
  ) {
    setDesign((prev) => {
      const current = prev.dateStyles?.[partId] ?? { scale: 1 };
      return {
        ...prev,
        dateStyles: {
          ...prev.dateStyles,
          [partId]: { ...current, ...patch }
        }
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

  function updateSprite(
    spriteId: string,
    patch: Partial<{
      x: number;
      y: number;
      scale: number;
      rotation: number;
      visible: boolean;
      tintColor: string | null;
    }>
  ) {
    setDesign((prev) => ({
      ...prev,
      designSprites: (prev.designSprites ?? []).map((sprite) =>
        sprite.id === spriteId ? { ...sprite, ...patch } : sprite
      )
    }));
  }

  async function chooseSprite() {
    if ((design.designSprites ?? []).length >= MAX_DESIGN_SPRITES) {
      onError(`A design can contain up to ${MAX_DESIGN_SPRITES} imported images.`);
      return;
    }
    setLoadingSprite(true);
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (!selected) {
        return;
      }
      const maxSize = previewWidth * 0.28;
      const fitScale = Math.min(1, maxSize / Math.max(selected.width, selected.height));
      const sprite = {
        id: window.crypto.randomUUID(),
        dataUrl: selected.dataUrl,
        sourceWidth: selected.width,
        sourceHeight: selected.height,
        width: Math.max(1, Math.round(selected.width * fitScale)),
        height: Math.max(1, Math.round(selected.height * fitScale)),
        x: Math.round(previewWidth / 2),
        y: Math.round((previewResolution?.height ?? previewWidth) / 2),
        scale: 1,
        rotation: 0,
        visible: true,
        tintColor: null
      };
      setDesign((prev) => ({
        ...prev,
        designSprites: [...(prev.designSprites ?? []), sprite]
      }));
      setSelectedId(`sprite:${sprite.id}`);
      onNotice("Image added. Drag it on the face to position it.");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not add the image.");
    } finally {
      setLoadingSprite(false);
    }
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
          <div className="watchface-editor-pane-heading">
            <p className="watchface-editor-pane-title">Layers</p>
            <button
              type="button"
              className="watchface-add-sprite"
              disabled={loadingSprite || (design.designSprites ?? []).length >= MAX_DESIGN_SPRITES}
              onClick={() => void chooseSprite()}
            >
              {loadingSprite ? <Loader2 className="spin" size={13} /> : <ImagePlus size={13} />}
              Add sprite
            </button>
          </div>
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
                        } else if (layer.staticSeparatorId) {
                          updateStaticSeparator(layer.staticSeparatorId, {
                            enabled: !layer.visible
                          });
                        } else if (layer.spriteId) {
                          updateSprite(layer.spriteId, { visible: !layer.visible });
                        } else if (layer.layoutGroupId) {
                          setFirmwareLayerVisible(layer.layoutGroupId, !layer.visible);
                        }
                      }}
                    >
                      {layer.visible ? (
                        <Eye size={14} />
                      ) : (
                        <EyeOff size={14} />
                      )}
                    </button>
                  ) : null}
                  {layer.kind === "background" && backgroundElements.length > 0 ? (
                    <ul className="watchface-bg-sublayers">
                      {backgroundElements.map((element) => (
                        <li key={element.id}>
                          <button
                            type="button"
                            className={`watchface-layer-row${selectedId === `bgel:${element.id}` ? " is-selected" : ""}`}
                            onClick={() => setSelectedId(`bgel:${element.id}`)}
                          >
                            <span className="watchface-layer-name">
                              {backgroundElementLabel(element)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="watchface-layer-visibility"
                            aria-label="Remove shape"
                            onClick={() => removeElement(element.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
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
          <p className="watchface-editor-pane-title">
            {selectedElement
              ? backgroundElementLabel(selectedElement)
              : selectedLayer?.label ?? "Inspector"}
          </p>
          {selectedElement
            ? renderElementInspector(selectedElement)
            : selectedLayer
              ? renderInspector(selectedLayer)
              : null}
        </aside>
      </div>
    </section>
  );

  function renderInspector(layer: EditorLayer) {
    if (layer.staticSeparatorId) {
      return renderStaticSeparatorInspector(layer.staticSeparatorId);
    }

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
          <div className="watchface-shape-tools">
            <span className="watchface-shape-tools-label">Add shape</span>
            <div className="watchface-shape-tools-row">
              <button type="button" onClick={() => addElement("rect")} aria-label="Add rectangle"><Square size={15} /></button>
              <button type="button" onClick={() => addElement("ellipse")} aria-label="Add ellipse"><Circle size={15} /></button>
              <button type="button" onClick={() => addElement("line")} aria-label="Add line"><Minus size={15} /></button>
              <button type="button" onClick={() => addElement("text")} aria-label="Add text"><Type size={15} /></button>
            </div>
            <button className="secondary-button" type="button" disabled={loadingSprite} onClick={() => void chooseSprite()}>
              {loadingSprite ? <Loader2 className="spin" size={15} /> : <ImagePlus size={15} />} Add image
            </button>
          </div>
        </div>
      );
    }

    if (layer.timePartId) {
      const style = design.timeStyles?.[layer.timePartId];
      return (
        <div className="watchface-inspector-group">
          {renderLayerVisibilityToggle(layer)}
          <label className="field">
            Digit font
            <select
              value={style?.fontFamily ?? design.fontFamily}
              onChange={(e) => setTimeStyle(layer.timePartId!, { fontFamily: e.target.value })}
            >
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
            Size <span>{(style?.scale ?? 1).toFixed(2)}×</span>
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
            Digit font
            <select
              value={style?.fontFamily ?? design.fontFamily}
              onChange={(e) => setMetricStyle(layer.metricId!, { fontFamily: e.target.value })}
            >
              <option value="">Keep template digits</option>
              {DIGIT_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setMetricStyle(layer.metricId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
            </span>
          </label>
          <label className="field watchface-zoom-control">
            Size <span>{(style?.scale ?? 1).toFixed(2)}×</span>
            <input type="range" min="0.5" max="1.6" step="0.02" value={style?.scale ?? 1} onChange={(e) => setMetricStyle(layer.metricId!, { scale: Number(e.target.value) })} />
          </label>
          {renderPositionReadout(layer)}
        </div>
      );
    }

    if (
      layer.kind === "weekday" ||
      (layer.kind === "date" &&
        (layer.layoutGroupId === "dateMonth" || layer.layoutGroupId === "dateDay"))
    ) {
      const partId = layer.layoutGroupId as WatchfaceDatePartId;
      const style = design.dateStyles?.[partId];
      const scale = style?.scale ?? 1;
      return (
        <div className="watchface-inspector-group">
          {renderLayerVisibilityToggle(layer)}
          <label className="field">
            Font
            <select
              value={style?.fontFamily ?? design.fontFamily}
              onChange={(e) => setDateStyle(partId, { fontFamily: e.target.value })}
            >
              <option value="">Keep template font</option>
              {DIGIT_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input
                type="color"
                value={style?.color ?? design.digitColor}
                onChange={(e) => setDateStyle(partId, { color: e.target.value })}
              />
              <code>{style?.color ?? design.digitColor}</code>
            </span>
          </label>
          <label className="field watchface-zoom-control">
            Scale <span>{scale.toFixed(2)}×</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.02"
              value={scale}
              onChange={(e) => setDateStyle(partId, { scale: Number(e.target.value) })}
            />
          </label>
          {renderPositionReadout(layer)}
        </div>
      );
    }

    if (layer.kind === "customSprite" && layer.spriteId) {
      const sprite = (design.designSprites ?? []).find((s) => s.id === layer.spriteId);
      if (!sprite) {
        return null;
      }
      return (
        <div className="watchface-inspector-group">
          {renderLayerVisibilityToggle(layer)}
          <label className="field watchface-zoom-control">
            Size <span>{(sprite.scale * 100).toFixed(0)}%</span>
            <input
              type="range"
              min="0.2"
              max="3"
              step="0.02"
              value={sprite.scale}
              onChange={(e) => updateSprite(sprite.id, { scale: Number(e.target.value) })}
            />
          </label>
          <label className="field watchface-zoom-control">
            Rotation <span>{sprite.rotation}°</span>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={sprite.rotation}
              onChange={(e) => updateSprite(sprite.id, { rotation: Number(e.target.value) })}
            />
          </label>
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={Boolean(sprite.tintColor)}
              onChange={(e) =>
                updateSprite(sprite.id, {
                  tintColor: e.target.checked ? design.accentColor : null
                })
              }
            />
            Tint this sprite
          </label>
          {sprite.tintColor ? (
            <label className="field">
              Tint color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={sprite.tintColor}
                  onChange={(e) =>
                    updateSprite(sprite.id, { tintColor: e.target.value })
                  }
                />
                <code>{sprite.tintColor}</code>
              </span>
            </label>
          ) : null}
          <p className="watchface-studio-summary">Drag the image on the face to move it.</p>
          <button className="secondary-button" type="button" onClick={() => removeSprite(layer.spriteId!)}>
            <Trash2 size={15} /> Remove image
          </button>
        </div>
      );
    }

    return (
      <div className="watchface-inspector-group">
        {renderLayerVisibilityToggle(layer)}
        {layer.capabilities.color && layer.layoutGroupId ? (
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input
                type="color"
                value={
                  design.layerColors?.[layer.layoutGroupId] ??
                  (layer.kind === "separators"
                    ? design.accentColor
                    : design.digitColor)
                }
                onChange={(e) =>
                  setLayerColor(layer.layoutGroupId!, e.target.value)
                }
              />
              <code>
                {design.layerColors?.[layer.layoutGroupId] ??
                  (layer.kind === "separators"
                    ? design.accentColor
                    : design.digitColor)}
              </code>
            </span>
          </label>
        ) : null}
        {renderPositionReadout(layer)}
        <p className="watchface-studio-summary">
          This element is drawn live by the watch. Drag it on the face to reposition it.
        </p>
      </div>
    );
  }

  function renderLayerVisibilityToggle(layer: EditorLayer) {
    if (!layer.canHide || layer.staticSeparatorId || layer.metricId) {
      return null;
    }
    const setVisible = (visible: boolean) => {
      if (layer.spriteId) {
        updateSprite(layer.spriteId, { visible });
      } else if (layer.layoutGroupId) {
        setFirmwareLayerVisible(layer.layoutGroupId, visible);
      }
    };
    return (
      <label className="watchface-studio-toggle">
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        Show this layer
      </label>
    );
  }

  function renderPositionReadout(layer: EditorLayer) {
    if (!layer.capabilities.position || !layer.layoutGroupId) {
      return null;
    }
    const offset = design.layoutOffsets?.[layer.layoutGroupId] ?? { dx: 0, dy: 0 };
    const limits = layoutLimits[layer.layoutGroupId];
    const fallbackLimit = Math.max(
      previewResolution?.width ?? 800,
      previewResolution?.height ?? 800
    );
    const clamp = (value: number, minimum: number, maximum: number) =>
      Math.max(minimum, Math.min(maximum, Math.round(value)));
    const setOffset = (dx: number, dy: number) =>
      setDesign((prev) => {
        return {
          ...prev,
          layoutOffsets: {
            ...prev.layoutOffsets,
            [layer.layoutGroupId!]: {
              dx: clamp(
                dx,
                limits?.minDx ?? -fallbackLimit,
                limits?.maxDx ?? fallbackLimit
              ),
              dy: clamp(
                dy,
                limits?.minDy ?? -fallbackLimit,
                limits?.maxDy ?? fallbackLimit
              )
            }
          }
        };
      });
    const alignX = (position: "start" | "center" | "end") => {
      const min = limits?.minDx ?? -fallbackLimit;
      const max = limits?.maxDx ?? fallbackLimit;
      setOffset(position === "start" ? min : position === "end" ? max : (min + max) / 2, offset.dy);
    };
    const alignY = (position: "start" | "center" | "end") => {
      const min = limits?.minDy ?? -fallbackLimit;
      const max = limits?.maxDy ?? fallbackLimit;
      setOffset(offset.dx, position === "start" ? min : position === "end" ? max : (min + max) / 2);
    };
    return (
      <div className="watchface-inspector-position">
        <span>Exact offset</span>
        <div className="watchface-position-inputs">
          <label>
            X
            <input
              type="number"
              min={limits?.minDx ?? -fallbackLimit}
              max={limits?.maxDx ?? fallbackLimit}
              value={offset.dx}
              onChange={(e) => setOffset(Number(e.target.value) || 0, offset.dy)}
            />
          </label>
          <label>
            Y
            <input
              type="number"
              min={limits?.minDy ?? -fallbackLimit}
              max={limits?.maxDy ?? fallbackLimit}
              value={offset.dy}
              onChange={(e) => setOffset(offset.dx, Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <span>Align to face</span>
        <div className="watchface-align-grid">
          <button type="button" onClick={() => alignX("start")}>Left</button>
          <button type="button" onClick={() => alignX("center")}>Center</button>
          <button type="button" onClick={() => alignX("end")}>Right</button>
          <button type="button" onClick={() => alignY("start")}>Top</button>
          <button type="button" onClick={() => alignY("center")}>Middle</button>
          <button type="button" onClick={() => alignY("end")}>Bottom</button>
        </div>
        <span>Fine tune · 1 px</span>
        <div className="watchface-nudge-pad">
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy - 1)} aria-label="Nudge up">↑</button>
          <button type="button" onClick={() => setOffset(offset.dx - 1, offset.dy)} aria-label="Nudge left">←</button>
          <button type="button" onClick={() => setOffset(offset.dx + 1, offset.dy)} aria-label="Nudge right">→</button>
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy + 1)} aria-label="Nudge down">↓</button>
          {(offset.dx !== 0 || offset.dy !== 0) ? (
            <button type="button" className="watchface-nudge-reset" onClick={() => setOffset(0, 0)}>Reset</button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderStaticSeparatorInspector(separatorId: WatchfaceStaticSeparatorId) {
    const separator = design.staticSeparators[separatorId];
    const faceWidth = previewResolution?.width ?? previewWidth;
    const faceHeight = previewResolution?.height ?? previewWidth;
    const boundsForSize = (size: number) => ({
      halfWidth: Math.max(24, size * 0.65) / 2,
      halfHeight: Math.max(24, size * 1.15) / 2
    });
    const setPosition = (x: number, y: number, size = separator.size) => {
      const { halfWidth, halfHeight } = boundsForSize(size);
      updateStaticSeparator(separatorId, {
        x: Math.round(Math.max(halfWidth, Math.min(faceWidth - halfWidth, x))),
        y: Math.round(Math.max(halfHeight, Math.min(faceHeight - halfHeight, y)))
      });
    };
    const alignX = (position: "start" | "center" | "end") => {
      const { halfWidth } = boundsForSize(separator.size);
      setPosition(
        position === "start"
          ? halfWidth
          : position === "end"
            ? faceWidth - halfWidth
            : faceWidth / 2,
        separator.y
      );
    };
    const alignY = (position: "start" | "center" | "end") => {
      const { halfHeight } = boundsForSize(separator.size);
      setPosition(
        separator.x,
        position === "start"
          ? halfHeight
          : position === "end"
            ? faceHeight - halfHeight
            : faceHeight / 2
      );
    };
    return (
      <div className="watchface-inspector-group">
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={separator.enabled}
            onChange={(e) => updateStaticSeparator(separatorId, { enabled: e.target.checked })}
          />
          Show {separatorId === "colon" ? "time colon" : "date slash"}
        </label>
        <label className="field">
          Font
          <select
            value={separator.fontFamily ?? design.fontFamily}
            onChange={(e) =>
              updateStaticSeparator(separatorId, { fontFamily: e.target.value })
            }
          >
            <option value="">System font</option>
            {DIGIT_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="field watchface-zoom-control">
          Size <span>{separator.size}px</span>
          <input
            type="range"
            min="12"
            max="200"
            step="1"
            value={separator.size}
            onChange={(e) => {
              const size = Number(e.target.value);
              updateStaticSeparator(separatorId, { size });
              setPosition(separator.x, separator.y, size);
            }}
          />
        </label>
        <label className="field">
          Color
          <span className="watchface-color-control">
            <input
              type="color"
              value={separator.color}
              onChange={(e) => updateStaticSeparator(separatorId, { color: e.target.value })}
            />
            <code>{separator.color}</code>
          </span>
        </label>
        <div className="watchface-inspector-position">
          <span>Exact position</span>
          <div className="watchface-position-inputs">
            <label>
              X
              <input
                type="number"
                min="0"
                max={faceWidth}
                value={separator.x}
                onChange={(e) => setPosition(Number(e.target.value) || 0, separator.y)}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max={faceHeight}
                value={separator.y}
                onChange={(e) => setPosition(separator.x, Number(e.target.value) || 0)}
              />
            </label>
          </div>
          <span>Align to face</span>
          <div className="watchface-align-grid">
            <button type="button" onClick={() => alignX("start")}>Left</button>
            <button type="button" onClick={() => alignX("center")}>Center</button>
            <button type="button" onClick={() => alignX("end")}>Right</button>
            <button type="button" onClick={() => alignY("start")}>Top</button>
            <button type="button" onClick={() => alignY("center")}>Middle</button>
            <button type="button" onClick={() => alignY("end")}>Bottom</button>
          </div>
          <span>Fine tune · 1 px</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(separator.x, separator.y - 1)} aria-label="Nudge up">↑</button>
            <button type="button" onClick={() => setPosition(separator.x - 1, separator.y)} aria-label="Nudge left">←</button>
            <button type="button" onClick={() => setPosition(separator.x + 1, separator.y)} aria-label="Nudge right">→</button>
            <button type="button" onClick={() => setPosition(separator.x, separator.y + 1)} aria-label="Nudge down">↓</button>
          </div>
        </div>
        <p className="watchface-studio-summary">
          Enable it, then drag its outline on the face or use the exact controls.
        </p>
      </div>
    );
  }

  function renderElementInspector(element: CorosWatchfaceBackgroundElement) {
    const set = (patch: BackgroundElementPatch) => updateElement(element.id, patch);
    const hasFill = element.kind === "rect" || element.kind === "ellipse";
    return (
      <div className="watchface-inspector-group">
        {hasFill ? (
          <>
            <label className="watchface-studio-toggle">
              <input
                type="checkbox"
                checked={Boolean(element.gradient)}
                onChange={(e) =>
                  set(
                    e.target.checked
                      ? { gradient: { from: element.fill, to: "#04140f", angle: 90 } }
                      : { gradient: undefined }
                  )
                }
              />
              Gradient fill
            </label>
            {element.gradient ? (
              <>
                <label className="field">
                  From
                  <span className="watchface-color-control">
                    <input type="color" value={element.gradient.from} onChange={(e) => set({ gradient: { ...element.gradient!, from: e.target.value } })} />
                    <code>{element.gradient.from}</code>
                  </span>
                </label>
                <label className="field">
                  To
                  <span className="watchface-color-control">
                    <input type="color" value={element.gradient.to} onChange={(e) => set({ gradient: { ...element.gradient!, to: e.target.value } })} />
                    <code>{element.gradient.to}</code>
                  </span>
                </label>
                <label className="field watchface-zoom-control">
                  Angle <span>{element.gradient.angle}°</span>
                  <input type="range" min="0" max="360" step="5" value={element.gradient.angle} onChange={(e) => set({ gradient: { ...element.gradient!, angle: Number(e.target.value) } })} />
                </label>
              </>
            ) : (
              <label className="field">
                Fill
                <span className="watchface-color-control">
                  <input type="color" value={element.fill} onChange={(e) => set({ fill: e.target.value })} />
                  <code>{element.fill}</code>
                </span>
              </label>
            )}
            <label className="field watchface-zoom-control">
              Width <span>{element.width}px</span>
              <input type="range" min="8" max="800" step="2" value={element.width} onChange={(e) => set({ width: Number(e.target.value) })} />
            </label>
            <label className="field watchface-zoom-control">
              Height <span>{element.height}px</span>
              <input type="range" min="8" max="800" step="2" value={element.height} onChange={(e) => set({ height: Number(e.target.value) })} />
            </label>
            {element.kind === "rect" ? (
              <label className="field watchface-zoom-control">
                Corner radius <span>{element.cornerRadius}px</span>
                <input type="range" min="0" max="200" step="2" value={element.cornerRadius} onChange={(e) => set({ cornerRadius: Number(e.target.value) })} />
              </label>
            ) : null}
          </>
        ) : null}

        {element.kind === "line" ? (
          <>
            <label className="field">
              Color
              <span className="watchface-color-control">
                <input type="color" value={element.color} onChange={(e) => set({ color: e.target.value })} />
                <code>{element.color}</code>
              </span>
            </label>
            <label className="field watchface-zoom-control">
              Length <span>{element.dx}px</span>
              <input type="range" min="10" max="800" step="2" value={element.dx} onChange={(e) => set({ dx: Number(e.target.value) })} />
            </label>
            <label className="field watchface-zoom-control">
              Thickness <span>{element.strokeWidth}px</span>
              <input type="range" min="1" max="60" step="1" value={element.strokeWidth} onChange={(e) => set({ strokeWidth: Number(e.target.value) })} />
            </label>
          </>
        ) : null}

        {element.kind === "text" ? (
          <>
            <label className="field">
              Text
              <input value={element.text} maxLength={40} onChange={(e) => set({ text: e.target.value })} />
            </label>
            <label className="field">
              Color
              <span className="watchface-color-control">
                <input type="color" value={element.color} onChange={(e) => set({ color: e.target.value })} />
                <code>{element.color}</code>
              </span>
            </label>
            <label className="field">
              Font
              <select value={element.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
                <option value="">System</option>
                {DIGIT_FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="field watchface-zoom-control">
              Size <span>{element.fontSize}px</span>
              <input type="range" min="12" max="200" step="2" value={element.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
            </label>
            <label className="field">
              Align
              <select value={element.align} onChange={(e) => set({ align: e.target.value as CorosWatchfaceBackgroundText["align"] })}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </>
        ) : null}

        <label className="field watchface-zoom-control">
          Rotation <span>{element.rotation}°</span>
          <input type="range" min="0" max="360" step="5" value={element.rotation} onChange={(e) => set({ rotation: Number(e.target.value) })} />
        </label>
        <button className="secondary-button" type="button" onClick={() => removeElement(element.id)}>
          <Trash2 size={15} /> Remove shape
        </button>
      </div>
    );
  }
}
