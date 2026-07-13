import {
  Fragment,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowLeft,
  Circle,
  Image,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Loader2,
  Minus,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Send,
  Square,
  Trash2,
  Type,
  Undo2
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
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  downscaleArtwork,
  drawStudioPreview,
  getAmPmCapability,
  getAvailableComplications,
  inferStaticSeparators,
  loadStudioImage,
  parseConfigPos,
  pickPreviewResolution,
  type WatchfaceDatePartId,
  type WatchfaceMetricId,
  type WatchfaceStaticSeparatorId,
  type WatchfaceTimePartId
} from "./watchfaceStudio";
import {
  getWeatherCapability,
  weatherPreviewUrl
} from "./weatherAssets";
import { LocalFontPicker } from "./LocalFontPicker";
import {
  beginWatchfaceEditorHistoryTransaction,
  canRedoWatchfaceEditorHistory,
  canUndoWatchfaceEditorHistory,
  commitWatchfaceEditorHistoryTransaction,
  createWatchfaceEditorCheckpoint,
  createWatchfaceEditorHistory,
  isWatchfaceEditorHistoryDirty,
  recordWatchfaceEditorHistory,
  redoWatchfaceEditorHistory,
  resetWatchfaceEditorHistory,
  undoWatchfaceEditorHistory,
  updateWatchfaceEditorHistoryTransaction
} from "./watchfaceEditorHistory";

interface WatchfaceEditorProps {
  api: CorosLinkApi;
  sessionId: string;
  starterArchive: CorosWatchfaceArchive;
  initialDesign?: CorosWatchfaceDesignState;
  initialProjectId?: string;
  initialProjectName?: string;
  onBack: () => void;
  onPublish: (archive: CorosWatchfaceArchive, name: string) => void;
  onArchiveCreated?: (archive: CorosWatchfaceArchive) => void;
  onProjectSaved?: (project: CorosWatchfaceProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const PREVIEW_SIZE = 520;

function normalizeEditorDesign(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  if (
    design.metricChanges?.temperature !== true ||
    design.metricStyles?.temperature
  ) {
    return design;
  }
  return {
    ...design,
    metricStyles: {
      ...design.metricStyles,
      temperature: {
        scale: 1
      }
    }
  };
}

export function WatchfaceEditor({
  api,
  sessionId,
  starterArchive,
  initialDesign,
  initialProjectId,
  initialProjectName,
  onBack,
  onPublish,
  onArchiveCreated,
  onProjectSaved,
  onError,
  onNotice
}: WatchfaceEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const assetCacheRef = useRef(new Map<string, CorosWatchfaceTemplateAsset>());
  const dragRef = useRef<{
    kind: "layout" | "bgElement" | "sprite" | "staticSeparator" | "ampm" | "weather" | "selectorIcon";
    targetId: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [loadingSprite, setLoadingSprite] = useState(false);

  type EditorValue = { design: CorosWatchfaceDesignState; projectName: string };
  const initialValue = useMemo<EditorValue>(
    () => ({
      design: normalizeEditorDesign(initialDesign ?? makeDefaultDesign()),
      projectName: initialProjectName ?? ""
    }),
    [initialDesign, initialProjectName, sessionId]
  );
  const [details, setDetails] = useState<CorosWatchfaceTemplateDetails | null>(null);
  const [history, setHistoryState] = useState(() =>
    createWatchfaceEditorHistory(initialValue)
  );
  const historyRef = useRef(history);
  const [checkpoint, setCheckpoint] = useState(() =>
    createWatchfaceEditorCheckpoint(history, sessionId)
  );
  const design = history.present.value.design;
  const projectName = history.present.value.projectName;
  const [selectedId, setSelectedId] = useState<string>("background");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [stageZoom, setStageZoom] = useState<"fit" | number>("fit");

  const isDirty = isWatchfaceEditorHistoryDirty(history, checkpoint, sessionId);
  const canUndo = canUndoWatchfaceEditorHistory(history);
  const canRedo = canRedoWatchfaceEditorHistory(history);

  function applyHistory(next: typeof history) {
    historyRef.current = next;
    setHistoryState(next);
  }

  function setDesign(
    action:
      | CorosWatchfaceDesignState
      | ((value: CorosWatchfaceDesignState) => CorosWatchfaceDesignState)
  ) {
    const current = historyRef.current;
    const currentValue = current.present.value;
    const nextDesign =
      typeof action === "function" ? action(currentValue.design) : action;
    const nextValue = { ...currentValue, design: nextDesign };
    applyHistory(
      current.transactionBase
        ? updateWatchfaceEditorHistoryTransaction(current, nextValue)
        : recordWatchfaceEditorHistory(current, nextValue)
    );
  }

  function setProjectName(projectName: string) {
    const current = historyRef.current;
    applyHistory(
      recordWatchfaceEditorHistory(current, {
        ...current.present.value,
        projectName
      })
    );
  }

  function beginDesignTransaction() {
    applyHistory(beginWatchfaceEditorHistoryTransaction(historyRef.current));
  }

  function endDesignTransaction() {
    applyHistory(commitWatchfaceEditorHistoryTransaction(historyRef.current));
  }

  function undo() {
    applyHistory(undoWatchfaceEditorHistory(historyRef.current));
  }

  function redo() {
    applyHistory(redoWatchfaceEditorHistory(historyRef.current));
  }

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
    const reset = resetWatchfaceEditorHistory(initialValue, historyRef.current);
    historyRef.current = reset;
    setHistoryState(reset);
    setCheckpoint(createWatchfaceEditorCheckpoint(reset, sessionId));
    setProjectId(initialProjectId);
    setSelectedId("background");
    setHoveredId(null);
    setBackgroundDataUrl("");
    setDetails(null);
    assetCacheRef.current.clear();
  }, [initialProjectId, initialValue, sessionId]);

  useEffect(() => {
    assetCacheRef.current.clear();
    let cancelled = false;
    api
      .describeCorosWatchfaceTemplate(starterArchive.archiveId)
      .then((described) => {
        if (!cancelled) {
          setDetails(described);
          const current = historyRef.current;
          let nextDesign = current.present.value.design;
          if (!initialDesign) {
              nextDesign = {
                ...nextDesign,
                staticSeparators: inferStaticSeparators(described, nextDesign.digitColor)
              };
          }
          if (!initialDesign?.ampmIndicator) {
              const capability = getAmPmCapability(described);
              if (capability) {
                nextDesign = {
                  ...nextDesign,
                  ampmIndicator: {
                    enabled: capability.active,
                    ...capability.defaultPos,
                    scale: 1,
                    color: nextDesign.digitColor
                  }
                };
              }
          }
          if (!initialDesign?.weatherIndicator) {
              const capability = getWeatherCapability(described);
              if (capability) {
                nextDesign = {
                  ...nextDesign,
                  weatherIndicator: {
                    enabled: capability.active,
                    ...capability.defaultPos,
                    scale: 1
                  }
                };
              }
          }
          const initialized = {
            ...current,
            present: {
              ...current.present,
              value: { ...current.present.value, design: nextDesign }
            }
          };
          historyRef.current = initialized;
          setHistoryState(initialized);
          setCheckpoint(createWatchfaceEditorCheckpoint(initialized, sessionId));
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
  }, [api, initialDesign, onError, sessionId, starterArchive.archiveId]);

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
  const watchCoordinateResolution = useMemo(
    () => details?.resolutions.reduce((smallest, resolution) =>
      resolution.width < smallest.width ? resolution : smallest
    ) ?? null,
    [details]
  );
  const watchCoordinateWidth = watchCoordinateResolution?.width ?? previewWidth;
  const watchCoordinateHeight = watchCoordinateResolution?.height ?? previewWidth;
  const watchCoordinateScale = previewWidth > 0
    ? watchCoordinateWidth / previewWidth
    : 1;
  const toWatchCoordinate = (value: number) =>
    Math.round(value * watchCoordinateScale);
  const fromWatchCoordinate = (value: number) =>
    value / watchCoordinateScale;
  const layoutLimits = useMemo(() => {
    const base = designDetails
      ? pickPreviewResolution(designDetails.styledMetricDetails)
      : null;
    return base ? computeLayoutOffsetLimits(base) : {};
  }, [designDetails]);
  const baseLayoutBounds = useMemo(() => {
    const base = designDetails
      ? pickPreviewResolution(designDetails.styledMetricDetails)
      : null;
    return base ? computeLayoutGroupBounds(base) : [];
  }, [designDetails]);
  const layers = useMemo(
    () => (details ? deriveEditorLayers(details, design) : []),
    [details, design]
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;
  const selectorIconTarget = useMemo(() => {
    if (!previewDetails || !previewResolution) {
      return null;
    }
    const available = getAvailableComplications(previewDetails);
    const complication = available.find(
      (item) => item.id === design.previewComplication
    ) ?? available[0];
    if (!complication) {
      return null;
    }
    const config = previewResolution.config;
    const originKey = Object.keys(config).find((key) =>
      /^rect_control\d+_pos$/.test(key)
    );
    const origin = parseConfigPos(originKey ? config[originKey] : undefined);
    const position = parseConfigPos(
      config[`control_${complication.controlPrefix}_icon_pos`]
    );
    if (!origin || !position) {
      return null;
    }
    const iconValue = config[`control_${complication.controlPrefix}_icon`]
      ?.replace(/\\/g, "/");
    const icon = iconValue
      ? previewResolution.icons.find(
          (candidate) =>
            candidate.path === `${previewResolution.directory}/${iconValue}`
        )
      : null;
    const stateFolderName = config[
      `control_${complication.controlPrefix}_icon_dir`
    ]?.replace(/\\/g, "/");
    const state = stateFolderName
      ? previewResolution.spriteFolders.find(
          (folder) =>
            folder.kind === "state" && folder.folder === stateFolderName
        )?.files[0]
      : null;
    const width = icon?.width ?? state?.width ?? Math.round(previewWidth * 0.05);
    const height = icon?.height ?? state?.height ?? Math.round(previewWidth * 0.04);
    return {
      complicationId: complication.id,
      x0: origin.x + position.x,
      y0: origin.y + position.y,
      x1: origin.x + position.x + width,
      y1: origin.y + position.y + height
    };
  }, [design.previewComplication, previewDetails, previewResolution, previewWidth]);
  const backgroundElements = design.backgroundElements ?? [];
  const selectedElementId = selectedId.startsWith("bgel:")
    ? selectedId.slice("bgel:".length)
    : null;
  const selectedElement =
    backgroundElements.find((element) => element.id === selectedElementId) ?? null;
  const backgroundContext = selectedId === "background" || selectedElement !== null;

  function updateElement(id: string, patch: BackgroundElementPatch) {
    const boundedPatch = {
      ...patch,
      ...(patch.x !== undefined
        ? { x: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(patch.x))) }
        : {}),
      ...(patch.y !== undefined
        ? { y: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(patch.y))) }
        : {})
    };
    setDesign((prev) => ({
      ...prev,
      backgroundElements: (prev.backgroundElements ?? []).map((element) =>
        element.id === id
          ? ({ ...element, ...boundedPatch } as CorosWatchfaceBackgroundElement)
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
      void (async () => {
        await drawStudioPreview(
          canvas,
          backgroundDataUrl,
          previewDetails,
          toStudioOptions(design),
          loadAssets
        );
        const weather = design.weatherIndicator;
        if (!weather?.enabled) {
          return;
        }
        const url = weatherPreviewUrl(previewWidth);
        if (!url) {
          return;
        }
        const image = await loadStudioImage(url);
        const context = canvas.getContext("2d");
        const scale = canvas.width / previewWidth;
        context?.drawImage(
          image,
          weather.x * scale,
          weather.y * scale,
          image.naturalWidth * weather.scale * scale,
          image.naturalHeight * weather.scale * scale
        );
      })().catch(() => undefined);
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

    // Keep the stage quiet: only the selected or hovered object gets an outline.
    for (const element of backgroundElements) {
      const box = backgroundElementBounds(element);
      const active = selectedId === `bgel:${element.id}`;
      const hovered = hoveredId === `bgel:${element.id}`;
      if (!active && !hovered) continue;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.55)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [4, 4]);
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
      const hovered = layer.id === hoveredId;
      if (!active && !hovered) continue;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.55)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [4, 4]);
      context.strokeRect(
        layer.bounds.x0 * scale,
        layer.bounds.y0 * scale,
        (layer.bounds.x1 - layer.bounds.x0) * scale,
        (layer.bounds.y1 - layer.bounds.y0) * scale
      );
    }
    if (selectorIconTarget && selectedId === "complication") {
      context.strokeStyle = "rgba(255, 206, 84, 0.98)";
      context.lineWidth = 2;
      context.setLineDash([]);
      context.strokeRect(
        selectorIconTarget.x0 * scale,
        selectorIconTarget.y0 * scale,
        (selectorIconTarget.x1 - selectorIconTarget.x0) * scale,
        (selectorIconTarget.y1 - selectorIconTarget.y0) * scale
      );
    }
    context.setLineDash([]);
  }, [layers, selectedId, hoveredId, previewWidth, backgroundElements, selectorIconTarget]);

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

    if (
      selectorIconTarget &&
      point.x >= selectorIconTarget.x0 &&
      point.x <= selectorIconTarget.x1 &&
      point.y >= selectorIconTarget.y0 &&
      point.y <= selectorIconTarget.y1
    ) {
      beginDesignTransaction();
      const iconOffset = design.controlIconOffsets?.[
        selectorIconTarget.complicationId
      ] ?? { dx: 0, dy: 0 };
      setSelectedId("complication");
      dragRef.current = {
        kind: "selectorIcon",
        targetId: selectorIconTarget.complicationId,
        startX: point.x,
        startY: point.y,
        baseX: iconOffset.dx,
        baseY: iconOffset.dy
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

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
        beginDesignTransaction();
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
    if (liveHit.weatherIndicator && design.weatherIndicator) {
      beginDesignTransaction();
      dragRef.current = {
        kind: "weather",
        targetId: "weather",
        startX: point.x,
        startY: point.y,
        baseX: design.weatherIndicator.x,
        baseY: design.weatherIndicator.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (liveHit.ampmIndicator && design.ampmIndicator) {
      beginDesignTransaction();
      dragRef.current = {
        kind: "ampm",
        targetId: "ampm",
        startX: point.x,
        startY: point.y,
        baseX: design.ampmIndicator.x,
        baseY: design.ampmIndicator.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (liveHit.staticSeparatorId) {
      beginDesignTransaction();
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
        beginDesignTransaction();
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
      beginDesignTransaction();
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
      const point = toResolutionPoint(event);
      if (!point) return;
      const liveHit = editorLayerAtPoint(layers, point.x, point.y);
      const backgroundHit = backgroundElementAtPoint(
        backgroundElements,
        point.x * (BACKGROUND_SPACE / previewWidth),
        point.y * (BACKGROUND_SPACE / previewWidth)
      );
      setHoveredId(
        backgroundContext && backgroundHit
          ? `bgel:${backgroundHit.id}`
          : liveHit?.id ?? (backgroundHit ? `bgel:${backgroundHit.id}` : null)
      );
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
    if (drag.kind === "ampm") {
      const capability = details ? getAmPmCapability(details) : null;
      const style = design.ampmIndicator;
      if (!capability || !style) {
        return;
      }
      const faceWidth = previewResolution?.width ?? previewWidth;
      const faceHeight = previewResolution?.height ?? previewWidth;
      const width = capability.icon.width * style.scale;
      const height = capability.icon.height * style.scale;
      updateAmPmIndicator({
        x: Math.round(
          Math.max(0, Math.min(faceWidth - width, drag.baseX + point.x - drag.startX))
        ),
        y: Math.round(
          Math.max(0, Math.min(faceHeight - height, drag.baseY + point.y - drag.startY))
        )
      });
      return;
    }
    if (drag.kind === "weather") {
      const capability = details ? getWeatherCapability(details) : null;
      const style = design.weatherIndicator;
      if (!capability || !style) {
        return;
      }
      const faceWidth = previewResolution?.width ?? previewWidth;
      const faceHeight = previewResolution?.height ?? previewWidth;
      const width = capability.size.width * style.scale;
      const height = capability.size.height * style.scale;
      updateWeatherIndicator({
        x: Math.round(
          Math.max(0, Math.min(faceWidth - width, drag.baseX + point.x - drag.startX))
        ),
        y: Math.round(
          Math.max(0, Math.min(faceHeight - height, drag.baseY + point.y - drag.startY))
        )
      });
      return;
    }
    if (drag.kind === "selectorIcon") {
      const dx = Math.round(drag.baseX + point.x - drag.startX);
      const dy = Math.round(drag.baseY + point.y - drag.startY);
      setDesign((current) => ({
        ...current,
        controlIconOffsets: {
          ...(current.controlIconOffsets ?? {}),
          [drag.targetId]: { dx, dy }
        }
      }));
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
      endDesignTransaction();
    }
  }

  function patchDesign(partial: Partial<CorosWatchfaceDesignState>) {
    setDesign((prev) => ({ ...prev, ...partial }));
  }

  function setRasterFont(rasterFont: CorosWatchfaceDesignState["rasterFont"]) {
    patchDesign({
      rasterFont,
      // A PNG atlas replaces the font-rendered sprites, so a regular face font
      // must not remain selected as the fallback for this shared pipeline.
      ...(rasterFont ? { fontFamily: "" } : {})
    });
  }

  function setMetricVisible(metricId: WatchfaceMetricId, visible: boolean) {
    setDesign((prev) => {
      const metricStyles = { ...prev.metricStyles };
      if (metricId === "temperature" && visible && !metricStyles.temperature) {
        metricStyles.temperature = {
          scale: 1
        };
      }
      return {
        ...prev,
        metricChanges: { ...prev.metricChanges, [metricId]: visible },
        metricStyles
      };
    });
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

  function clearLayerColor(layerId: string) {
    setDesign((prev) => {
      const layerColors = { ...prev.layerColors };
      delete layerColors[layerId];
      return { ...prev, layerColors };
    });
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

  function updateAmPmIndicator(
    patch: Partial<NonNullable<CorosWatchfaceDesignState["ampmIndicator"]>>
  ) {
    setDesign((prev) => ({
      ...prev,
      ampmIndicator: {
        enabled: prev.ampmIndicator?.enabled ?? false,
        x: prev.ampmIndicator?.x ?? 0,
        y: prev.ampmIndicator?.y ?? 0,
        scale: prev.ampmIndicator?.scale ?? 1,
        color: prev.ampmIndicator?.color ?? prev.digitColor,
        ...patch
      }
    }));
  }

  function updateWeatherIndicator(
    patch: Partial<NonNullable<CorosWatchfaceDesignState["weatherIndicator"]>>
  ) {
    setDesign((prev) => ({
      ...prev,
      weatherIndicator: {
        enabled: prev.weatherIndicator?.enabled ?? false,
        x: prev.weatherIndicator?.x ?? 0,
        y: prev.weatherIndicator?.y ?? 0,
        scale: prev.weatherIndicator?.scale ?? 1,
        ...patch
      }
    }));
  }

  function setMetricStyle(
    metricId: WatchfaceMetricId,
    patch: { color?: string; scale?: number; fontFamily?: string }
  ) {
    setDesign((prev) => {
      const current = prev.metricStyles?.[metricId] ?? { scale: 1 };
      return {
        ...prev,
        metricStyles: { ...prev.metricStyles, [metricId]: { ...current, ...patch } }
      };
    });
  }

  function clearMetricColor(metricId: WatchfaceMetricId) {
    setDesign((prev) => {
      const current = prev.metricStyles?.[metricId] ?? { scale: 1 };
      const { color: _color, ...style } = current;
      return {
        ...prev,
        metricStyles: { ...prev.metricStyles, [metricId]: style }
      };
    });
  }

  function setTimeStyle(
    partId: WatchfaceTimePartId,
    patch: { color?: string; scale?: number; fontFamily?: string }
  ) {
    setDesign((prev) => {
      const current = prev.timeStyles?.[partId] ?? { scale: 1 };
      return {
        ...prev,
        timeStyles: { ...prev.timeStyles, [partId]: { ...current, ...patch } }
      };
    });
  }

  function clearTimeColor(partId: WatchfaceTimePartId) {
    setDesign((prev) => {
      const current = prev.timeStyles?.[partId] ?? { scale: 1 };
      const { color: _color, ...style } = current;
      return {
        ...prev,
        timeStyles: { ...prev.timeStyles, [partId]: style }
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

  function clearDateColor(partId: WatchfaceDatePartId) {
    setDesign((prev) => {
      const current = prev.dateStyles?.[partId] ?? { scale: 1 };
      const { color: _color, ...style } = current;
      return {
        ...prev,
        dateStyles: { ...prev.dateStyles, [partId]: style }
      };
    });
  }

  async function chooseArtwork() {
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (selected) {
        patchDesign({ artwork: await downscaleArtwork(selected), zoom: 1 });
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
    const boundedPatch = {
      ...patch,
      ...(patch.x !== undefined
        ? { x: Math.max(0, Math.min(previewWidth, Math.round(patch.x))) }
        : {}),
      ...(patch.y !== undefined
        ? {
            y: Math.max(
              0,
              Math.min(previewResolution?.height ?? previewWidth, Math.round(patch.y))
            )
          }
        : {})
    };
    setDesign((prev) => ({
      ...prev,
      designSprites: (prev.designSprites ?? []).map((sprite) =>
        sprite.id === spriteId ? { ...sprite, ...boundedPatch } : sprite
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
      const { assetReplacements, configOverrides, minWatchFaceVersion } =
        await composeWatchfaceReplacements(details, design, loadAssets);
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl,
        ...(assetReplacements.length > 0 ? { assetReplacements } : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {}),
        ...(minWatchFaceVersion !== undefined ? { minWatchFaceVersion } : {})
      });
      onArchiveCreated?.(archive);
      onPublish(archive, projectName.trim() || "Custom watch face");
      onNotice("Watch face prepared for COROS.");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not build the archive.");
    } finally {
      setCreating(false);
    }
  }

  async function saveProject(): Promise<boolean> {
    const name = projectName.trim();
    if (!name) {
      onError("Name your project before saving.");
      return false;
    }
    if (name.length > 80) {
      onError("Project names can contain up to 80 characters.");
      return false;
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
      const savedHistory = recordWatchfaceEditorHistory(historyRef.current, {
        ...historyRef.current.present.value,
        projectName: saved.name
      });
      applyHistory(savedHistory);
      setCheckpoint(createWatchfaceEditorCheckpoint(savedHistory, sessionId));
      onProjectSaved?.(saved);
      onNotice(`Saved project “${saved.name}”.`);
      return true;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save the project.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestBack() {
    if (isDirty) {
      setLeaveOpen(true);
    } else {
      onBack();
    }
  }

  function deleteSelected() {
    if (selectedElement) {
      removeElement(selectedElement.id);
      return;
    }
    if (selectedLayer?.kind === "customSprite" && selectedLayer.spriteId) {
      removeSprite(selectedLayer.spriteId);
    }
  }

  function nudgeSelected(dx: number, dy: number) {
    if (selectedElement) {
      updateElement(selectedElement.id, {
        x: Math.max(0, Math.min(BACKGROUND_SPACE, selectedElement.x + dx)),
        y: Math.max(0, Math.min(BACKGROUND_SPACE, selectedElement.y + dy))
      });
      return;
    }
    if (!selectedLayer) return;
    if (selectedLayer.kind === "customSprite" && selectedLayer.spriteId) {
      const sprite = (design.designSprites ?? []).find(
        (candidate) => candidate.id === selectedLayer.spriteId
      );
      if (sprite) {
        updateSprite(sprite.id, {
          x: Math.max(0, Math.min(previewWidth, sprite.x + dx)),
          y: Math.max(
            0,
            Math.min(previewResolution?.height ?? previewWidth, sprite.y + dy)
          )
        });
      }
      return;
    }
    if (selectedLayer.staticSeparatorId) {
      const separator = design.staticSeparators[selectedLayer.staticSeparatorId];
      const halfWidth = Math.max(24, separator.size * 0.65) / 2;
      const halfHeight = Math.max(24, separator.size * 1.15) / 2;
      updateStaticSeparator(selectedLayer.staticSeparatorId, {
        x: Math.max(halfWidth, Math.min(previewWidth - halfWidth, separator.x + dx)),
        y: Math.max(
          halfHeight,
          Math.min((previewResolution?.height ?? previewWidth) - halfHeight, separator.y + dy)
        )
      });
      return;
    }
    if (selectedLayer.ampmIndicator && design.ampmIndicator) {
      const capability = details ? getAmPmCapability(details) : null;
      const width = (capability?.icon.width ?? 0) * design.ampmIndicator.scale;
      const height = (capability?.icon.height ?? 0) * design.ampmIndicator.scale;
      updateAmPmIndicator({
        x: Math.max(0, Math.min(previewWidth - width, design.ampmIndicator.x + dx)),
        y: Math.max(
          0,
          Math.min((previewResolution?.height ?? previewWidth) - height, design.ampmIndicator.y + dy)
        )
      });
      return;
    }
    if (selectedLayer.weatherIndicator && design.weatherIndicator) {
      const capability = details ? getWeatherCapability(details) : null;
      const width = (capability?.size.width ?? 0) * design.weatherIndicator.scale;
      const height = (capability?.size.height ?? 0) * design.weatherIndicator.scale;
      updateWeatherIndicator({
        x: Math.max(0, Math.min(previewWidth - width, design.weatherIndicator.x + dx)),
        y: Math.max(
          0,
          Math.min((previewResolution?.height ?? previewWidth) - height, design.weatherIndicator.y + dy)
        )
      });
      return;
    }
    if (selectedLayer.layoutGroupId && selectedLayer.capabilities.position) {
      const groupId = selectedLayer.layoutGroupId;
      const offset = design.layoutOffsets?.[groupId] ?? { dx: 0, dy: 0 };
      const limits = layoutLimits[groupId];
      const fallback = Math.max(previewWidth, previewResolution?.height ?? previewWidth);
      setDesign((current) => ({
        ...current,
        layoutOffsets: {
          ...current.layoutOffsets,
          [groupId]: {
            dx: Math.max(
              limits?.minDx ?? -fallback,
              Math.min(limits?.maxDx ?? fallback, offset.dx + dx)
            ),
            dy: Math.max(
              limits?.minDy ?? -fallback,
              Math.min(limits?.maxDy ?? fallback, offset.dy + dy)
            )
          }
        }
      }));
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']")
      );
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (command && key === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (editable) return;
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.ctrlKey && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedElement || selectedLayer?.kind === "customSprite") {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      const amount = event.shiftKey ? 10 : 1;
      const movement: Record<string, [number, number]> = {
        ArrowUp: [0, -amount],
        ArrowDown: [0, amount],
        ArrowLeft: [-amount, 0],
        ArrowRight: [amount, 0]
      };
      const delta = movement[event.key];
      if (delta) {
        event.preventDefault();
        nudgeSelected(delta[0], delta[1]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    design,
    isDirty,
    projectId,
    projectName,
    selectedElement,
    selectedLayer,
    sessionId,
    previewWidth,
    previewResolution,
    layoutLimits
  ]);

  return (
    <section className="watchface-editor wf-studio" aria-label="Watch face studio">
      <header className="watchface-editor-topbar wf-command-bar">
        <button className="wf-icon-button wf-back-button" type="button" onClick={requestBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Projects</span>
        </button>
        <div className="watchface-editor-title wf-project-title">
          <label className="sr-only" htmlFor={`watchface-name-${sessionId}`}>
            Project name
          </label>
          <input
            id={`watchface-name-${sessionId}`}
            className="watchface-editor-name"
            value={projectName}
            maxLength={80}
            placeholder="Untitled watch face"
            onChange={(event) => setProjectName(event.target.value)}
          />
          <span className={`wf-save-state${isDirty ? " is-dirty" : ""}`} role="status">
            {isDirty ? "Unsaved" : "Saved"}
          </span>
        </div>
        <div className="watchface-editor-actions wf-command-actions">
          <button
            className="wf-icon-button wf-pane-toggle"
            type="button"
            aria-label="Toggle layers"
            aria-pressed={layersOpen}
            onClick={() => setLayersOpen((open) => !open)}
          >
            <PanelLeft size={17} />
          </button>
          <button
            className="wf-icon-button wf-pane-toggle"
            type="button"
            aria-label="Toggle properties"
            aria-pressed={propertiesOpen}
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            <PanelRight size={17} />
          </button>
          <span className="wf-command-separator" aria-hidden="true" />
          <button className="wf-icon-button" type="button" disabled={!canUndo} aria-label="Undo" onClick={undo}>
            <Undo2 size={17} />
          </button>
          <button className="wf-icon-button" type="button" disabled={!canRedo} aria-label="Redo" onClick={redo}>
            <Redo2 size={17} />
          </button>
          <button className="secondary-button wf-save-button" type="button" disabled={saving || !isDirty} onClick={() => void saveProject()}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            Save
          </button>
          <button className="primary-button wf-send-button" type="button" disabled={creating || !backgroundDataUrl} onClick={() => void createArchive()}>
            {creating ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
            Send to COROS
          </button>
        </div>
      </header>

      <div className="watchface-editor-grid wf-studio-grid">
        <aside className={`watchface-editor-layers wf-pane wf-layers-pane${layersOpen ? " is-open" : ""}`} aria-label="Layers">
          <div className="watchface-editor-pane-heading wf-pane-heading">
            <div>
              <p className="watchface-editor-pane-title">Layers</p>
              <span>{layers.length + backgroundElements.length} items</span>
            </div>
            <div className="wf-add-menu">
              <button
                type="button"
                className="watchface-add-sprite"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <ImagePlus size={14} /> Add
              </button>
              {addMenuOpen ? (
                <div className="wf-add-popover" role="menu">
                  <button type="button" role="menuitem" disabled={loadingSprite || (design.designSprites ?? []).length >= MAX_DESIGN_SPRITES} onClick={() => { setAddMenuOpen(false); void chooseSprite(); }}>
                    <Image size={15} /> Image
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); addElement("rect"); }}><Square size={15} /> Rectangle</button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); addElement("ellipse"); }}><Circle size={15} /> Ellipse</button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); addElement("line"); }}><Minus size={15} /> Line</button>
                  <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); addElement("text"); }}><Type size={15} /> Text</button>
                </div>
              ) : null}
            </div>
          </div>
          {details ? (
            <ul className="wf-layer-list">
              {layers.map((layer, index) => {
                const group = layerGroupLabel(layer);
                const previousGroup = index > 0 ? layerGroupLabel(layers[index - 1]!) : null;
                return (
                  <Fragment key={layer.id}>
                    {group !== previousGroup ? <li className="wf-layer-group">{group}</li> : null}
                    <li>
                      <button
                        type="button"
                        aria-selected={layer.id === selectedId}
                        className={`watchface-layer-row${layer.id === selectedId ? " is-selected" : ""}`}
                        onMouseEnter={() => setHoveredId(layer.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => { setSelectedId(layer.id); setPropertiesOpen(true); }}
                      >
                        <span className="wf-layer-icon" aria-hidden="true">{layerIcon(layer)}</span>
                        <span className={`watchface-layer-name${layer.visible ? "" : " is-hidden"}`}>{layer.label}</span>
                      </button>
                      {layer.canHide ? (
                        <button
                          type="button"
                          className="watchface-layer-visibility"
                          aria-label={layer.visible ? `Hide ${layer.label}` : `Show ${layer.label}`}
                          aria-pressed={!layer.visible}
                          onClick={() => toggleLayerVisibility(layer)}
                        >
                          {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>
                      ) : null}
                      {layer.kind === "background" && backgroundElements.length > 0 ? (
                        <ul className="watchface-bg-sublayers">
                          {backgroundElements.map((element) => (
                            <li key={element.id}>
                              <button
                                type="button"
                                aria-selected={selectedId === `bgel:${element.id}`}
                                className={`watchface-layer-row${selectedId === `bgel:${element.id}` ? " is-selected" : ""}`}
                                onMouseEnter={() => setHoveredId(`bgel:${element.id}`)}
                                onMouseLeave={() => setHoveredId(null)}
                                onClick={() => { setSelectedId(`bgel:${element.id}`); setPropertiesOpen(true); }}
                              >
                                <span className="wf-layer-icon"><Square size={14} /></span>
                                <span className="watchface-layer-name">{backgroundElementLabel(element)}</span>
                              </button>
                              <button type="button" className="watchface-layer-visibility" aria-label={`Remove ${backgroundElementLabel(element)}`} onClick={() => removeElement(element.id)}>
                                <Trash2 size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          ) : (
            <div className="wf-pane-loading" role="status"><Loader2 className="spin" size={16} /> Reading template</div>
          )}
        </aside>

        <main className="watchface-editor-stage wf-stage">
          <div className="wf-stage-toolbar" aria-label="Stage zoom">
            <div className="wf-zoom-control">
              <button type="button" aria-pressed={stageZoom === "fit"} onClick={() => setStageZoom("fit")}>Fit</button>
              <button type="button" aria-pressed={stageZoom === 1} onClick={() => setStageZoom(1)}>100%</button>
              <button type="button" aria-label="Zoom out" onClick={() => setStageZoom((zoom) => Math.max(0.6, (zoom === "fit" ? 1 : zoom) - 0.1))}>-</button>
              <button type="button" aria-label="Zoom in" onClick={() => setStageZoom((zoom) => Math.min(1.4, (zoom === "fit" ? 1 : zoom) + 0.1))}>+</button>
            </div>
          </div>
          <div
            className={`watchface-preview-stack watchface-editor-device${stageZoom === "fit" ? " is-fit" : ""}`}
            style={{ "--wf-stage-scale": stageZoom === "fit" ? 1 : stageZoom } as CSSProperties}
          >
            <canvas ref={previewCanvasRef} className="watchface-studio-preview" width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
            <canvas
              ref={overlayCanvasRef}
              className="watchface-preview-overlay"
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              tabIndex={0}
              role="img"
              aria-label="Interactive watch face preview. Select a layer, then use arrow keys to move it."
              style={{ cursor: selectedLayer?.capabilities.position ? "grab" : "default" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoveredId(null)}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            />
          </div>
          <div className="wf-stage-status" role="status">
            <span>{selectedElement ? backgroundElementLabel(selectedElement) : selectedLayer?.label ?? "No selection"}</span>
            <span>{watchCoordinateWidth} × {watchCoordinateHeight}</span>
            <span>{starterArchive.fileName}</span>
          </div>
        </main>

        <aside
          className={`watchface-editor-inspector wf-pane wf-properties-pane${propertiesOpen ? " is-open" : ""}`}
          aria-label="Properties"
          onPointerDownCapture={(event) => {
            if ((event.target as HTMLInputElement).type === "range") beginDesignTransaction();
          }}
          onPointerUpCapture={(event) => {
            if ((event.target as HTMLInputElement).type === "range") endDesignTransaction();
          }}
          onPointerCancel={endDesignTransaction}
        >
          <div className="wf-pane-heading">
            <div>
              <p className="watchface-editor-pane-title">Properties</p>
              <strong>{selectedElement ? backgroundElementLabel(selectedElement) : selectedLayer?.label ?? "Inspector"}</strong>
            </div>
          </div>
          {selectedElement ? renderElementInspector(selectedElement) : selectedLayer ? renderInspector(selectedLayer) : null}
        </aside>
      </div>

      {(layersOpen || propertiesOpen) ? (
        <button className="wf-sheet-scrim is-open" type="button" aria-label="Close editor panel" onClick={() => { setLayersOpen(false); setPropertiesOpen(false); }} />
      ) : null}

      {leaveOpen ? (
        <div className="wf-modal-backdrop" role="presentation">
          <section className="wf-modal" role="dialog" aria-modal="true" aria-labelledby="wf-unsaved-title">
            <h2 id="wf-unsaved-title">Save changes?</h2>
            <p>Your latest edits have not been saved to this project.</p>
            <div className="wf-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setLeaveOpen(false)}>Cancel</button>
              <button className="secondary-button danger-button" type="button" onClick={onBack}>Discard</button>
              <button className="primary-button" type="button" disabled={saving} onClick={() => void saveProject().then((saved) => { if (saved) onBack(); })}>
                {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );

  function layerGroupLabel(layer: EditorLayer): string {
    if (layer.kind === "background" || layer.kind === "customSprite") return "Artwork";
    if (
      layer.kind === "time" ||
      layer.kind === "seconds" ||
      layer.kind === "date" ||
      layer.kind === "weekday" ||
      layer.kind === "separators"
    ) {
      return "Time and date";
    }
    return "Data";
  }

  function layerIcon(layer: EditorLayer) {
    if (layer.kind === "background" || layer.kind === "customSprite") {
      return <Image size={14} />;
    }
    if (
      layer.kind === "time" ||
      layer.kind === "seconds" ||
      layer.kind === "date" ||
      layer.kind === "weekday"
    ) {
      return <Type size={14} />;
    }
    return <Layers size={14} />;
  }

  function toggleLayerVisibility(layer: EditorLayer) {
    if (layer.metricId) {
      setMetricVisible(layer.metricId, !layer.visible);
    } else if (layer.weatherIndicator) {
      updateWeatherIndicator({ enabled: !layer.visible });
    } else if (layer.ampmIndicator) {
      updateAmPmIndicator({ enabled: !layer.visible });
    } else if (layer.staticSeparatorId) {
      updateStaticSeparator(layer.staticSeparatorId, { enabled: !layer.visible });
    } else if (layer.spriteId) {
      updateSprite(layer.spriteId, { visible: !layer.visible });
    } else if (layer.layoutGroupId) {
      setFirmwareLayerVisible(layer.layoutGroupId, !layer.visible);
    }
  }

  function renderInspector(layer: EditorLayer) {
    if (layer.weatherIndicator) {
      return renderWeatherInspector();
    }

    if (layer.ampmIndicator) {
      return renderAmPmInspector();
    }

    if (layer.staticSeparatorId) {
      return renderStaticSeparatorInspector(layer.staticSeparatorId);
    }

    if (layer.kind === "background") {
      return (
        <div className="watchface-inspector-group">
          <label className="field">
            Accent color
            <span className="watchface-color-control">
              <input type="color" value={design.accentColor} onChange={(e) => patchDesign({ accentColor: e.target.value })} />
              <code>{design.accentColor}</code>
            </span>
          </label>
          <div className="wf-inspector-divider" />
          <h3 className="wf-inspector-heading">Face styles</h3>
          <LocalFontPicker
            api={api}
            label="Face font"
            value={design.fontFamily}
            emptyLabel="Keep template font"
            onChange={(fontFamily) => patchDesign({ fontFamily })}
            rasterFont={design.rasterFont}
            onRasterFontChange={(rasterFont) =>
              patchDesign({
                rasterFont,
                ...(rasterFont ? { fontFamily: "" } : {})
              })
            }
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
          />
          <label className="field">
            Default digit color
            <span className="watchface-color-control">
              <input
                type="color"
                value={design.digitColor}
                onChange={(event) => patchDesign({ digitColor: event.target.value })}
              />
              <code>{design.digitColor}</code>
            </span>
          </label>
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={design.tintLabels}
              onChange={(event) => patchDesign({ tintLabels: event.target.checked })}
            />
            Tint template labels
          </label>
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={design.tintIcons}
              onChange={(event) => patchDesign({ tintIcons: event.target.checked })}
            />
            Tint template icons
          </label>
          <div className="wf-inspector-divider" />
          <h3 className="wf-inspector-heading">Artwork</h3>
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
          {renderLayerVisibilityToggle(layer)}
          <LocalFontPicker
            api={api}
            label="Digit font"
            value={style?.fontFamily ?? design.fontFamily}
            emptyLabel="Keep template digits"
            onChange={(fontFamily) =>
              setTimeStyle(layer.timePartId!, { fontFamily })
            }
            rasterFont={design.rasterFont}
            onRasterFontChange={(rasterFont) => {
              setTimeStyle(layer.timePartId!, { fontFamily: "" });
              setRasterFont(rasterFont);
            }}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
          />
          <label className="field">
            Digit color
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setTimeStyle(layer.timePartId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearTimeColor(layer.timePartId!)}
              >
                Use default
              </button>
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
          <LocalFontPicker
            api={api}
            label="Digit font"
            value={style?.fontFamily ?? design.fontFamily}
            emptyLabel="Keep template digits"
            onChange={(fontFamily) =>
              setMetricStyle(layer.metricId!, { fontFamily })
            }
            rasterFont={design.rasterFont}
            onRasterFontChange={(rasterFont) => {
              setMetricStyle(layer.metricId!, { fontFamily: "" });
              setRasterFont(rasterFont);
            }}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
          />
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setMetricStyle(layer.metricId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearMetricColor(layer.metricId!)}
              >
                Use default
              </button>
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
          <LocalFontPicker
            api={api}
            label="Font"
            value={style?.fontFamily ?? design.fontFamily}
            emptyLabel="Keep template font"
            onChange={(fontFamily) => setDateStyle(partId, { fontFamily })}
            rasterFont={design.rasterFont}
            rasterFontRequiredText={partId === "weekday" ? "MON" : undefined}
            onRasterFontChange={(rasterFont) => {
              setDateStyle(partId, { fontFamily: "" });
              setRasterFont(rasterFont);
            }}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
          />
          <label className="field">
            Color
            <span className="watchface-color-control">
              <input
                type="color"
                value={style?.color ?? design.digitColor}
                onChange={(e) => setDateStyle(partId, { color: e.target.value })}
              />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearDateColor(partId)}
              >
                Use default
              </button>
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
          <div className="watchface-inspector-position">
            <span>Watch screen position</span>
            <div className="watchface-position-inputs">
              <label>
                X
                <input
                  type="number"
                  min="0"
                  max={watchCoordinateWidth}
                  value={toWatchCoordinate(sprite.x)}
                  onChange={(event) =>
                    updateSprite(sprite.id, {
                      x: fromWatchCoordinate(Number(event.target.value) || 0)
                    })
                  }
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  min="0"
                  max={watchCoordinateHeight}
                  value={toWatchCoordinate(sprite.y)}
                  onChange={(event) =>
                    updateSprite(sprite.id, {
                      y: fromWatchCoordinate(Number(event.target.value) || 0)
                    })
                  }
                />
              </label>
            </div>
            <span>Align to face</span>
            <div className="watchface-align-grid">
              <button type="button" onClick={() => updateSprite(sprite.id, { x: (sprite.width * sprite.scale) / 2 })}>Left</button>
              <button type="button" onClick={() => updateSprite(sprite.id, { x: previewWidth / 2 })}>Center</button>
              <button type="button" onClick={() => updateSprite(sprite.id, { x: previewWidth - (sprite.width * sprite.scale) / 2 })}>Right</button>
              <button type="button" onClick={() => updateSprite(sprite.id, { y: (sprite.height * sprite.scale) / 2 })}>Top</button>
              <button type="button" onClick={() => updateSprite(sprite.id, { y: (previewResolution?.height ?? previewWidth) / 2 })}>Middle</button>
              <button type="button" onClick={() => updateSprite(sprite.id, { y: (previewResolution?.height ?? previewWidth) - (sprite.height * sprite.scale) / 2 })}>Bottom</button>
            </div>
            <span>Fine tune (1 px)</span>
            <div className="watchface-nudge-pad">
              <button type="button" aria-label="Nudge image up" onClick={() => updateSprite(sprite.id, { y: sprite.y - fromWatchCoordinate(1) })}>↑</button>
              <button type="button" aria-label="Nudge image left" onClick={() => updateSprite(sprite.id, { x: sprite.x - fromWatchCoordinate(1) })}>←</button>
              <button type="button" aria-label="Nudge image right" onClick={() => updateSprite(sprite.id, { x: sprite.x + fromWatchCoordinate(1) })}>→</button>
              <button type="button" aria-label="Nudge image down" onClick={() => updateSprite(sprite.id, { y: sprite.y + fromWatchCoordinate(1) })}>↓</button>
              <button type="button" className="watchface-nudge-reset" onClick={() => updateSprite(sprite.id, { x: previewWidth / 2, y: (previewResolution?.height ?? previewWidth) / 2 })}>Reset</button>
            </div>
          </div>
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
          <button className="secondary-button" type="button" onClick={() => removeSprite(layer.spriteId!)}>
            <Trash2 size={15} /> Remove image
          </button>
        </div>
      );
    }

    return (
      <div className="watchface-inspector-group">
        {renderLayerVisibilityToggle(layer)}
        {layer.layoutGroupId === "complication" ? renderComplicationPicker() : null}
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
              <button
                type="button"
                className="watchface-color-none"
                disabled={!design.layerColors?.[layer.layoutGroupId]}
                onClick={() => clearLayerColor(layer.layoutGroupId!)}
              >
                Use default
              </button>
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

  function renderComplicationPicker() {
    const available = getAvailableComplications(previewDetails ?? details!);
    if (available.length === 0) {
      return null;
    }
    const selected = available.some(
      (complication) => complication.id === design.previewComplication
    )
      ? design.previewComplication
      : available[0]!.id;
    const selectedComplication = available.find(
      (complication) => complication.id === selected
    );
    const sourceResolution = details ? pickPreviewResolution(details) : null;
    const iconPositionKey = selectedComplication
      ? `control_${selectedComplication.controlPrefix}_icon_pos`
      : "";
    const baseIconPosition = iconPositionKey
      ? parseConfigPos(sourceResolution?.config[iconPositionKey])
      : null;
    const iconOffset = design.controlIconOffsets?.[selected] ?? { dx: 0, dy: 0 };
    const controlOriginKey = sourceResolution
      ? Object.keys(sourceResolution.config).find((key) =>
          /^rect_control\d+_pos$/.test(key)
        )
      : undefined;
    const controlOrigin = parseConfigPos(
      controlOriginKey ? sourceResolution?.config[controlOriginKey] : undefined
    ) ?? { x: 0, y: 0 };
    const controlOffset = design.layoutOffsets?.complication ?? { dx: 0, dy: 0 };
    const iconScreenPosition = baseIconPosition
      ? {
          x: toWatchCoordinate(
            controlOrigin.x + controlOffset.dx + baseIconPosition.x + iconOffset.dx
          ),
          y: toWatchCoordinate(
            controlOrigin.y + controlOffset.dy + baseIconPosition.y + iconOffset.dy
          )
        }
      : null;
    const setIconOffset = (dx: number, dy: number) => {
      setDesign((current) => ({
        ...current,
        controlIconOffsets: {
          ...(current.controlIconOffsets ?? {}),
          [selected]: { dx: Math.round(dx), dy: Math.round(dy) }
        }
      }));
    };
    return (
      <>
        <label className="field">
          Preview data
          <select
            value={selected}
            onChange={(event) => {
              const previewComplication = event.target.value;
              setDesign((current) => ({
                ...current,
                previewComplication,
                metricStyles: previewComplication === "temperature"
                  ? {
                      ...current.metricStyles,
                      temperature: current.metricStyles?.temperature ?? {
                        scale: 1
                      }
                    }
                  : current.metricStyles
              }));
            }}
          >
            {available.map((complication) => (
              <option key={complication.id} value={complication.id}>
                {complication.label}
              </option>
            ))}
          </select>
        </label>
        {selected === "temperature" ? (
          <>
            <LocalFontPicker
              api={api}
              label="Temperature font"
              value={design.metricStyles?.temperature?.fontFamily ?? design.fontFamily}
              emptyLabel="Keep control digits"
              onChange={(fontFamily) => setMetricStyle("temperature", { fontFamily })}
              rasterFont={design.rasterFont}
              onRasterFontChange={(rasterFont) => {
                setMetricStyle("temperature", { fontFamily: "" });
                setRasterFont(rasterFont);
              }}
              typography={{
                fontWeight: design.fontWeight ?? 400,
                fontStyle: design.fontStyle ?? "normal",
                letterSpacing: design.letterSpacing ?? 0
              }}
              onTypographyChange={(typography) => patchDesign(typography)}
            />
            <label className="field">
              Temperature color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={design.metricStyles?.temperature?.color ?? design.digitColor}
                  onChange={(event) => setMetricStyle("temperature", { color: event.target.value })}
                />
                <code>{design.metricStyles?.temperature?.color ?? design.digitColor}</code>
                <button
                  type="button"
                  className="watchface-color-none"
                  disabled={!design.metricStyles?.temperature?.color}
                  onClick={() => clearMetricColor("temperature")}
                >
                  Use default
                </button>
              </span>
            </label>
            <label className="field watchface-zoom-control">
              Temperature size <span>{(design.metricStyles?.temperature?.scale ?? 1).toFixed(2)}×</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.02"
                value={design.metricStyles?.temperature?.scale ?? 1}
                onChange={(event) => setMetricStyle("temperature", { scale: Number(event.target.value) })}
              />
            </label>
          </>
        ) : null}
        {baseIconPosition ? (
          <div className="watchface-inspector-position">
            <span>Selector icon screen position</span>
            <div className="watchface-position-inputs">
              <label>
                X
                <input
                  type="number"
                  min="0"
                  max={watchCoordinateWidth}
                  value={iconScreenPosition?.x ?? 0}
                  onChange={(event) =>
                    setIconOffset(
                      fromWatchCoordinate(Number(event.target.value) || 0) -
                        controlOrigin.x - controlOffset.dx - baseIconPosition.x,
                      iconOffset.dy
                    )
                  }
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  min="0"
                  max={watchCoordinateHeight}
                  value={iconScreenPosition?.y ?? 0}
                  onChange={(event) =>
                    setIconOffset(
                      iconOffset.dx,
                      fromWatchCoordinate(Number(event.target.value) || 0) -
                        controlOrigin.y - controlOffset.dy - baseIconPosition.y
                    )
                  }
                />
              </label>
            </div>
            <span>Fine tune (1 px)</span>
            <div className="watchface-nudge-pad">
              <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy - fromWatchCoordinate(1))} aria-label="Nudge selector icon up">↑</button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx - fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge selector icon left">←</button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx + fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge selector icon right">→</button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy + fromWatchCoordinate(1))} aria-label="Nudge selector icon down">↓</button>
              <button type="button" className="watchface-nudge-reset" onClick={() => setIconOffset(0, 0)}>Reset</button>
            </div>
            <p className="watchface-studio-summary">
              This moves only the {selectedComplication?.label.toLowerCase()} icon.
              Move the Selectable metric layer to reposition its icon and value together.
            </p>
          </div>
        ) : null}
        <p className="watchface-studio-summary">
          Temperature exports only through control_temperature_* and
          control_negative_sign_icon. Move this Selectable metric layer to
          position the control slot on the face.
        </p>
      </>
    );
  }

  function renderLayerVisibilityToggle(layer: EditorLayer) {
    if (
      !layer.canHide ||
      layer.weatherIndicator ||
      layer.ampmIndicator ||
      layer.staticSeparatorId ||
      layer.metricId
    ) {
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
    const baseBounds = baseLayoutBounds.find(
      (bounds) => bounds.id === layer.layoutGroupId
    );
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
        <span>Watch screen position</span>
        <div className="watchface-position-inputs">
          <label>
            X
            <input
              type="number"
              min="0"
              max={watchCoordinateWidth}
              value={toWatchCoordinate((baseBounds?.x0 ?? 0) + offset.dx)}
              onChange={(e) =>
                setOffset(
                  fromWatchCoordinate(Number(e.target.value) || 0) -
                    (baseBounds?.x0 ?? 0),
                  offset.dy
                )
              }
            />
          </label>
          <label>
            Y
            <input
              type="number"
              min="0"
              max={watchCoordinateHeight}
              value={toWatchCoordinate((baseBounds?.y0 ?? 0) + offset.dy)}
              onChange={(e) =>
                setOffset(
                  offset.dx,
                  fromWatchCoordinate(Number(e.target.value) || 0) -
                    (baseBounds?.y0 ?? 0)
                )
              }
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
        <span>Fine tune (1 px)</span>
        <div className="watchface-nudge-pad">
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy - fromWatchCoordinate(1))} aria-label="Nudge up">↑</button>
          <button type="button" onClick={() => setOffset(offset.dx - fromWatchCoordinate(1), offset.dy)} aria-label="Nudge left">←</button>
          <button type="button" onClick={() => setOffset(offset.dx + fromWatchCoordinate(1), offset.dy)} aria-label="Nudge right">→</button>
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy + fromWatchCoordinate(1))} aria-label="Nudge down">↓</button>
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
        <LocalFontPicker
          api={api}
          label="Font"
          value={separator.fontFamily ?? design.fontFamily}
          emptyLabel="System font"
          onChange={(fontFamily) =>
            updateStaticSeparator(separatorId, { fontFamily })
          }
        />
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
            <button
              type="button"
              className="watchface-color-none"
              disabled={separator.color === design.digitColor}
              onClick={() =>
                updateStaticSeparator(separatorId, { color: design.digitColor })
              }
            >
              Use default
            </button>
          </span>
        </label>
        <div className="watchface-inspector-position">
          <span>Watch screen position</span>
          <div className="watchface-position-inputs">
            <label>
              X
              <input
                type="number"
                min="0"
                max={watchCoordinateWidth}
                value={toWatchCoordinate(separator.x)}
                onChange={(e) => setPosition(fromWatchCoordinate(Number(e.target.value) || 0), separator.y)}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max={watchCoordinateHeight}
                value={toWatchCoordinate(separator.y)}
                onChange={(e) => setPosition(separator.x, fromWatchCoordinate(Number(e.target.value) || 0))}
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
          <span>Fine tune (1 px)</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(separator.x, separator.y - fromWatchCoordinate(1))} aria-label="Nudge up">↑</button>
            <button type="button" onClick={() => setPosition(separator.x - fromWatchCoordinate(1), separator.y)} aria-label="Nudge left">←</button>
            <button type="button" onClick={() => setPosition(separator.x + fromWatchCoordinate(1), separator.y)} aria-label="Nudge right">→</button>
            <button type="button" onClick={() => setPosition(separator.x, separator.y + fromWatchCoordinate(1))} aria-label="Nudge down">↓</button>
          </div>
        </div>
        <p className="watchface-studio-summary">
          Enable it, then drag its outline on the face or use the exact controls.
        </p>
      </div>
    );
  }

  function renderAmPmInspector() {
    const capability = details ? getAmPmCapability(details) : null;
    const indicator = design.ampmIndicator;
    if (!capability || !indicator) {
      return null;
    }
    const faceWidth = previewResolution?.width ?? previewWidth;
    const faceHeight = previewResolution?.height ?? previewWidth;
    const boundsForScale = (scale: number) => ({
      width: capability.icon.width * scale,
      height: capability.icon.height * scale
    });
    const setPosition = (x: number, y: number, scale = indicator.scale) => {
      const { width, height } = boundsForScale(scale);
      updateAmPmIndicator({
        x: Math.round(Math.max(0, Math.min(faceWidth - width, x))),
        y: Math.round(Math.max(0, Math.min(faceHeight - height, y)))
      });
    };
    const alignX = (position: "start" | "center" | "end") => {
      const { width } = boundsForScale(indicator.scale);
      setPosition(
        position === "start"
          ? 0
          : position === "end"
            ? faceWidth - width
            : (faceWidth - width) / 2,
        indicator.y
      );
    };
    const alignY = (position: "start" | "center" | "end") => {
      const { height } = boundsForScale(indicator.scale);
      setPosition(
        indicator.x,
        position === "start"
          ? 0
          : position === "end"
            ? faceHeight - height
            : (faceHeight - height) / 2
      );
    };
    return (
      <div className="watchface-inspector-group">
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={indicator.enabled}
            onChange={(event) =>
              updateAmPmIndicator({ enabled: event.target.checked })
            }
          />
          Show AM/PM indicator
        </label>
        <LocalFontPicker
          api={api}
          label="Font"
          value={indicator.fontFamily ?? ""}
          emptyLabel="Keep template lettering"
          onChange={(fontFamily) => updateAmPmIndicator({ fontFamily })}
        />
        <label className="field">
          Color
          <span className="watchface-color-control">
            <input
              type="color"
              value={indicator.color}
              onChange={(event) =>
                updateAmPmIndicator({ color: event.target.value })
              }
            />
            <code>{indicator.color}</code>
            <button
              type="button"
              className="watchface-color-none"
              disabled={indicator.color === design.digitColor}
              onClick={() => updateAmPmIndicator({ color: design.digitColor })}
            >
              Use default
            </button>
          </span>
        </label>
        <label className="field watchface-zoom-control">
          Size <span>{indicator.scale.toFixed(2)}×</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.02"
            value={indicator.scale}
            onChange={(event) => {
              const scale = Number(event.target.value);
              updateAmPmIndicator({ scale });
              setPosition(indicator.x, indicator.y, scale);
            }}
          />
        </label>
        <div className="watchface-inspector-position">
          <span>Watch screen position</span>
          <div className="watchface-position-inputs">
            <label>
              X
              <input
                type="number"
                min="0"
                max={watchCoordinateWidth}
                value={toWatchCoordinate(indicator.x)}
                onChange={(event) =>
                  setPosition(fromWatchCoordinate(Number(event.target.value) || 0), indicator.y)
                }
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max={watchCoordinateHeight}
                value={toWatchCoordinate(indicator.y)}
                onChange={(event) =>
                  setPosition(indicator.x, fromWatchCoordinate(Number(event.target.value) || 0))
                }
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
          <span>Fine tune (1 px)</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y - fromWatchCoordinate(1))} aria-label="Nudge up">↑</button>
            <button type="button" onClick={() => setPosition(indicator.x - fromWatchCoordinate(1), indicator.y)} aria-label="Nudge left">←</button>
            <button type="button" onClick={() => setPosition(indicator.x + fromWatchCoordinate(1), indicator.y)} aria-label="Nudge right">→</button>
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y + fromWatchCoordinate(1))} aria-label="Nudge down">↓</button>
          </div>
        </div>
        <p className="watchface-studio-summary">
          The watch automatically swaps this sprite between AM and PM in 12-hour mode.
        </p>
      </div>
    );
  }

  function renderWeatherInspector() {
    const capability = details ? getWeatherCapability(details) : null;
    const indicator = design.weatherIndicator;
    if (!capability || !indicator) {
      return null;
    }
    const faceWidth = previewResolution?.width ?? previewWidth;
    const faceHeight = previewResolution?.height ?? previewWidth;
    const boundsForScale = (scale: number) => ({
      width: capability.size.width * scale,
      height: capability.size.height * scale
    });
    const setPosition = (x: number, y: number, scale = indicator.scale) => {
      const { width, height } = boundsForScale(scale);
      updateWeatherIndicator({
        x: Math.round(Math.max(0, Math.min(faceWidth - width, x))),
        y: Math.round(Math.max(0, Math.min(faceHeight - height, y)))
      });
    };
    const alignX = (position: "start" | "center" | "end") => {
      const { width } = boundsForScale(indicator.scale);
      setPosition(
        position === "start"
          ? 0
          : position === "end"
            ? faceWidth - width
            : (faceWidth - width) / 2,
        indicator.y
      );
    };
    const alignY = (position: "start" | "center" | "end") => {
      const { height } = boundsForScale(indicator.scale);
      setPosition(
        indicator.x,
        position === "start"
          ? 0
          : position === "end"
            ? faceHeight - height
            : (faceHeight - height) / 2
      );
    };
    return (
      <div className="watchface-inspector-group">
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={indicator.enabled}
            onChange={(event) =>
              updateWeatherIndicator({ enabled: event.target.checked })
            }
          />
          Show weather icon
        </label>
        <label className="field watchface-zoom-control">
          Size <span>{indicator.scale.toFixed(2)}×</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.02"
            value={indicator.scale}
            onChange={(event) => {
              const scale = Number(event.target.value);
              updateWeatherIndicator({ scale });
              setPosition(indicator.x, indicator.y, scale);
            }}
          />
        </label>
        <div className="watchface-inspector-position">
          <span>Watch screen position</span>
          <div className="watchface-position-inputs">
            <label>
              X
              <input
                type="number"
                min="0"
                max={watchCoordinateWidth}
                value={toWatchCoordinate(indicator.x)}
                onChange={(event) =>
                  setPosition(
                    fromWatchCoordinate(Number(event.target.value) || 0),
                    indicator.y
                  )
                }
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max={watchCoordinateHeight}
                value={toWatchCoordinate(indicator.y)}
                onChange={(event) =>
                  setPosition(
                    indicator.x,
                    fromWatchCoordinate(Number(event.target.value) || 0)
                  )
                }
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
          <span>Fine tune (1 px)</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y - fromWatchCoordinate(1))} aria-label="Nudge up">↑</button>
            <button type="button" onClick={() => setPosition(indicator.x - fromWatchCoordinate(1), indicator.y)} aria-label="Nudge left">←</button>
            <button type="button" onClick={() => setPosition(indicator.x + fromWatchCoordinate(1), indicator.y)} aria-label="Nudge right">→</button>
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y + fromWatchCoordinate(1))} aria-label="Nudge down">↓</button>
          </div>
        </div>
        <p className="watchface-studio-summary">
          The editor previews the sunny state. The watch automatically swaps among all 41 weather states.
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
            <LocalFontPicker
              api={api}
              label="Font"
              value={element.fontFamily}
              emptyLabel="System font"
              onChange={(fontFamily) => set({ fontFamily })}
            />
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

        <div className="watchface-inspector-position">
          <span>Background position</span>
          <div className="watchface-position-inputs">
            <label>
              X
              <input
                type="number"
                min="0"
                max={BACKGROUND_SPACE}
                value={Math.round(element.x)}
                onChange={(event) => set({ x: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max={BACKGROUND_SPACE}
                value={Math.round(element.y)}
                onChange={(event) => set({ y: Number(event.target.value) || 0 })}
              />
            </label>
          </div>
          <span>Align to face</span>
          <div className="watchface-align-grid">
            <button type="button" onClick={() => set({ x: 0 })}>Left</button>
            <button type="button" onClick={() => set({ x: BACKGROUND_SPACE / 2 })}>Center</button>
            <button type="button" onClick={() => set({ x: BACKGROUND_SPACE })}>Right</button>
            <button type="button" onClick={() => set({ y: 0 })}>Top</button>
            <button type="button" onClick={() => set({ y: BACKGROUND_SPACE / 2 })}>Middle</button>
            <button type="button" onClick={() => set({ y: BACKGROUND_SPACE })}>Bottom</button>
          </div>
          <span>Fine tune (1 px)</span>
          <div className="watchface-nudge-pad">
            <button type="button" aria-label="Nudge shape up" onClick={() => set({ y: element.y - 1 })}>↑</button>
            <button type="button" aria-label="Nudge shape left" onClick={() => set({ x: element.x - 1 })}>←</button>
            <button type="button" aria-label="Nudge shape right" onClick={() => set({ x: element.x + 1 })}>→</button>
            <button type="button" aria-label="Nudge shape down" onClick={() => set({ y: element.y + 1 })}>↓</button>
            <button type="button" className="watchface-nudge-reset" onClick={() => set({ x: BACKGROUND_SPACE / 2, y: BACKGROUND_SPACE / 2 })}>Reset</button>
          </div>
        </div>

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
