import {
  Fragment,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

/** A numeric field that permits clearing/retyping without snapping to zero. */
function EditableNumberInput({
  value,
  fallback = 0,
  onValueChange,
  onBlur,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value: number;
  fallback?: number;
  onValueChange: (value: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      {...props}
      ref={inputRef}
      type="number"
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next !== "" && Number.isFinite(Number(next))) onValueChange(Number(next));
      }}
      onBlur={(event) => {
        if (draft.trim() === "") {
          setDraft(String(fallback));
          onValueChange(fallback);
        }
        onBlur?.(event);
      }}
    />
  );
}
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowLeft,
  Battery,
  ChevronDown,
  Circle,
  Copy,
  Crop,
  Download,
  Image,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  ImagePlus,
  Layers,
  Link2,
  Lock,
  Loader2,
  Magnet,
  Minus,
  Plus,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Save,
  Send,
  SunMedium,
  Square,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  Undo2,
  MoonStar
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceBackgroundElement,
  CorosWatchfaceBackgroundEllipse,
  CorosWatchfaceBackgroundLine,
  CorosWatchfaceBackgroundRect,
  CorosWatchfaceBackgroundText,
  CorosWatchfaceDesignState,
  CorosWatchfaceDesignSprite,
  CorosWatchfaceEditorGuide,
  CorosWatchfaceShadowEffect,
  CorosWatchfaceProject,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails,
  WatchModelId
} from "../../electron/types";

/** Any subset of shape fields, minus the discriminant, for in-place edits. */
type BackgroundElementPatch = Partial<
  Omit<CorosWatchfaceBackgroundRect, "kind"> &
    Omit<CorosWatchfaceBackgroundEllipse, "kind"> &
    Omit<CorosWatchfaceBackgroundLine, "kind"> &
    Omit<CorosWatchfaceBackgroundText, "kind">
>;

/** Centers visible pixels on a shared canvas used by every state in a set. */
function centerSpriteArtwork(
  image: HTMLImageElement,
  canvasWidth = image.naturalWidth,
  canvasHeight = image.naturalHeight
): string | null {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) return null;
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(
    source,
    left,
    top,
    contentWidth,
    contentHeight,
    Math.round((canvas.width - contentWidth) / 2),
    Math.round((canvas.height - contentHeight) / 2),
    contentWidth,
    contentHeight
  );
  return canvas.toDataURL("image/png");
}

import type { CorosLinkApi } from "../coroslink-api";
import {
  deriveEditorLayers,
  editorLayerAtPoint,
  type EditorLayer
} from "./watchfaceEditorModel";
import type { WatchfaceEditorBounds } from "./watchfaceEditorGeometry";
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
  backgroundElementLabel,
  createBackgroundElement
} from "./watchfaceBackgroundElements";
import {
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  AOD_DIM_FACTOR,
  detailsForPreviewMode,
  detailsForPreviewResolution,
  dimHexColor,
  downscaleArtwork,
  drawStudioPreview,
  getAmPmCapability,
  scaleAmPmStyleForResolution,
  getAvailableComplications,
  getTemplateBackgroundAssetPaths,
  hasWatchfaceAod,
  inferStaticSeparators,
  listWatchfaceConfigAssets,
  loadStudioImage,
  parseConfigPos,
  pickPreviewResolution,
  pickWatchPreviewResolution,
  type WatchfaceDatePartId,
  type WatchfaceAssetLoader,
  type WatchfaceConfigAssetReference,
  type WatchfaceMetricId,
  type WatchfacePreviewMode,
  type WatchfaceStudioOptions,
  type WatchfaceStaticSeparatorId,
  type WatchfaceTimePartId
} from "./watchfaceStudio";
import {
  getWeatherCapability,
  weatherPreviewDataUrl
} from "./weatherAssets";
import { CustomPngFontPanel } from "./CustomPngFontPanel";
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
import {
  WATCHFACE_SNAP_SCREEN_THRESHOLD,
  backgroundElementSnapBounds,
  formatWatchfaceSnapStatus,
  readWatchfacePlacementPreferences,
  scaleWatchfaceBounds,
  snapWatchfaceBounds,
  translateWatchfaceBounds,
  watchfaceDesignThreshold,
  watchfaceSafeAreaBounds,
  writeWatchfacePlacementPreferences,
  type WatchfaceGridStep,
  type WatchfacePlacementPreferences,
  type WatchfaceSnapGuide,
  type WatchfaceSnapMeasurement,
  type WatchfaceSnapTarget
} from "./watchfaceEditorSnapping";
import {
  normalizeWatchfaceCrop,
  normalizeWatchfaceOpacity,
  normalizeWatchfaceRotation,
  normalizeWatchfaceSkew,
  normalizeWatchfaceTransformOrigin,
  resizeWatchfaceTransformGroup,
  resizeWatchfaceSprite,
  rotateWatchfaceTransformGroup,
  rotateWatchfaceSprite,
  type WatchfaceGroupTransformItem,
  type WatchfaceSpriteResizeHandle,
  type WatchfaceSpriteTransform
} from "./watchfaceSpriteTransform";
import {
  alignWatchfaceItems,
  distributeWatchfaceItems,
  editorGroupForLayer,
  expandWatchfaceGroupSelection,
  normalizeWatchfaceEditorGroups,
  syncLegacyWatchfaceGroups,
  unionWatchfaceBounds,
  watchfaceSelectionUnits,
  type WatchfaceAlignment,
  type WatchfaceDistribution
} from "./watchfaceEditorLayout";
import {
  createWatchfaceShadowEffect,
  localWatchfaceEffectBinding,
  normalizeWatchfaceShadowEffect,
  resolveWatchfaceLayerEffects
} from "./watchfaceEditorEffects";
import {
  paintWatchfaceMeasurements,
  resizeWatchfaceCanvasBackings
} from "./watchfaceInteractiveRenderer";
import { WatchfacePointerController } from "./watchfacePointerController";

interface WatchfaceEditorProps {
  api: CorosLinkApi;
  sessionId: string;
  starterArchive: CorosWatchfaceArchive;
  targetFirmwareType?: string;
  targetWatchModel?: WatchModelId;
  initialDesign?: CorosWatchfaceDesignState;
  initialProjectId?: string;
  initialProjectName?: string;
  showDevelopmentTools?: boolean;
  onBack: () => void;
  onPublish: (archive: CorosWatchfaceArchive, name: string) => void;
  onArchiveCreated?: (archive: CorosWatchfaceArchive) => void;
  onProjectSaved?: (project: CorosWatchfaceProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

interface WatchfaceDragState {
  kind:
    | "layout"
    | "bgElement"
    | "sprite"
    | "spriteResize"
    | "spriteRotate"
    | "staticSeparator"
    | "ampm"
    | "weather"
    | "selectorIcon";
  targetId: string;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  snapId: string;
  baseBounds: WatchfaceEditorBounds;
  /** The complete unlocked selection translated by this gesture. */
  selectionIds?: string[];
  spriteTransform?: {
    initial: WatchfaceSpriteTransform;
    scale: number;
    handle?: WatchfaceSpriteResizeHandle;
    startPointer?: { x: number; y: number };
    groupItems?: WatchfaceGroupTransformItem[];
  };
}

interface WatchfaceMarqueeState {
  start: { x: number; y: number };
  current: { x: number; y: number };
  additive: boolean;
  openingSelection: string[];
  snapshot: ImageData | null;
}

interface WatchfaceContextMenuState {
  x: number;
  y: number;
}

interface PendingWatchfaceDrag {
  drag: WatchfaceDragState;
  point: { x: number; y: number };
  bypassSnap: boolean;
}

interface WatchfacePreviewRenderRequest {
  canvas: HTMLCanvasElement;
  sessionId: string;
  backgroundDataUrl: string;
  details: CorosWatchfaceTemplateDetails;
  options: ReturnType<typeof toStudioOptions>;
  weather: CorosWatchfaceDesignState["weatherIndicator"];
  previewWidth: number;
  loadAssets: WatchfaceAssetLoader;
  dragCommitId: number | null;
}

interface WatchfaceBackgroundRenderRequest {
  sessionId: string;
  design: CorosWatchfaceDesignState;
  previewWidth: number;
}

interface WatchfaceDragVisual {
  drag: WatchfaceDragState;
  baseFrame: HTMLCanvasElement | null;
  movingFrame: HTMLCanvasElement | null;
  movement: { dx: number; dy: number };
  clipBounds: WatchfaceEditorBounds;
  preparationId: number;
  awaitingCommitId: number | null;
  spriteTransform?: WatchfaceSpriteTransform & {
    scaleX: number;
    scaleY: number;
    rotationDelta: number;
  };
}

interface WatchfacePrecomposedDrag {
  design: CorosWatchfaceDesignState;
  selectionKey: string;
  previewDirectory: string;
  baseFrame: HTMLCanvasElement;
  movingFrame: HTMLCanvasElement;
  clipBounds: WatchfaceEditorBounds;
}

interface WatchfaceSpriteTransformDraft {
  targetId: string;
  transform: WatchfaceSpriteTransform;
}

function isSpriteTransformDrag(
  drag: WatchfaceDragState
): drag is WatchfaceDragState & {
  kind: "spriteResize" | "spriteRotate";
  spriteTransform: NonNullable<WatchfaceDragState["spriteTransform"]>;
} {
  return (
    (drag.kind === "spriteResize" || drag.kind === "spriteRotate") &&
    drag.spriteTransform !== undefined
  );
}

const PREVIEW_SIZE = 520;

function maskCanvasToCircle(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.beginPath();
  context.arc(
    canvas.width / 2,
    canvas.height / 2,
    Math.min(canvas.width, canvas.height) / 2,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();
}

function solidPreviewBackground(colorValue: string | undefined): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  const hex = colorValue?.trim().match(/^0x([0-9a-f]{6})$/i)?.[1];
  if (context) {
    context.fillStyle = hex ? `#${hex}` : "#000000";
    context.fillRect(0, 0, 1, 1);
  }
  return canvas.toDataURL("image/png");
}

function parseBackgroundColor(colorValue: string | undefined): {
  hex: string;
  alpha: number;
  isTransparent: boolean;
} {
  const value = colorValue?.trim().toLowerCase();
  if (value === "transparent") {
    return { hex: "#000000", alpha: 0, isTransparent: true };
  }
  const hex = value?.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return { hex: `#${hex}`, alpha: 1, isTransparent: false };
  }
  const rgba = value?.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/
  );
  if (rgba) {
    const [red, green, blue] = rgba.slice(1, 4).map((part) =>
      Math.max(0, Math.min(255, Number(part)))
    );
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return {
      hex: `#${[red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`,
      alpha,
      isTransparent: false
    };
  }
  return { hex: "#000000", alpha: 1, isTransparent: false };
}

function toRgbaColor(hex: string, alpha: number): string {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => parseInt(value, 16));
  if (!channels || channels.length !== 3) return "#000000";
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function browserPlacementStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeEditorDesign(
  design: CorosWatchfaceDesignState
): CorosWatchfaceDesignState {
  const legacyBackgroundOverride =
    design.configAssetOverrides?.["config:background_icon"];
  const normalized = {
    ...design,
    artworkVisible:
      design.artworkVisible ?? legacyBackgroundOverride?.enabled !== false,
    configAssetOverrides: design.configAssetOverrides ?? {},
    editorGroups: normalizeWatchfaceEditorGroups(
      design.editorGroups,
      design.linkedLayerGroups
    ),
    editorGuides: (design.editorGuides ?? []).filter(
      (guide) => guide.axis === "x" || guide.axis === "y"
    ),
    effectStyles: design.effectStyles ?? [],
    layerEffects: design.layerEffects ?? {},
    designSprites: (design.designSprites ?? []).map((sprite) => ({
      ...sprite,
      opacity: normalizeWatchfaceOpacity(sprite.opacity),
      flipX: sprite.flipX === true,
      flipY: sprite.flipY === true,
      skewX: normalizeWatchfaceSkew(sprite.skewX),
      skewY: normalizeWatchfaceSkew(sprite.skewY),
      aspectLocked: sprite.aspectLocked !== false,
      crop: normalizeWatchfaceCrop(sprite.crop),
      origin: normalizeWatchfaceTransformOrigin(sprite.origin)
    })),
    backgroundElements: (design.backgroundElements ?? []).map((element) => ({
      ...element,
      visible: element.visible !== false,
      opacity: normalizeWatchfaceOpacity(element.opacity)
    })),
    lockedLayerIds: [...new Set((design.lockedLayerIds ?? []).filter(Boolean))],
    // Global tinting has been replaced by explicit controls in each layer.
    tintLabels: false,
    tintIcons: false
  };
  if (
    normalized.metricChanges?.temperature !== true ||
    normalized.metricStyles?.temperature
  ) {
    return syncLegacyWatchfaceGroups(normalized);
  }
  return syncLegacyWatchfaceGroups({
    ...normalized,
    metricStyles: {
      ...normalized.metricStyles,
      temperature: {
        scale: 1
      }
    }
  });
}

export function WatchfaceEditor({
  api,
  sessionId,
  starterArchive,
  targetFirmwareType,
  targetWatchModel,
  initialDesign,
  initialProjectId,
  initialProjectName,
  showDevelopmentTools = false,
  onBack,
  onPublish,
  onArchiveCreated,
  onProjectSaved,
  onError,
  onNotice
}: WatchfaceEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewStackRef = useRef<HTMLDivElement>(null);
  const transformGroupRef = useRef<SVGGElement>(null);
  const marqueeRef = useRef<WatchfaceMarqueeState | null>(null);
  const dragOverlaySnapshotRef = useRef<ImageData | null>(null);
  const snapGuidesRef = useRef<WatchfaceSnapGuide[]>([]);
  const snapMeasurementsRef = useRef<WatchfaceSnapMeasurement[]>([]);
  const snapStatusElementRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(true);
  const previewSessionRef = useRef(sessionId);
  previewSessionRef.current = sessionId;
  const previewRenderQueueRef = useRef<{
    running: boolean;
    pending: WatchfacePreviewRenderRequest | null;
  }>({ running: false, pending: null });
  const backgroundRenderQueueRef = useRef<{
    running: boolean;
    pending: WatchfaceBackgroundRenderRequest | null;
  }>({ running: false, pending: null });
  const dragPaintCallbackRef = useRef<(pending: PendingWatchfaceDrag) => void>(() => {});
  const pointerControllerRef = useRef<WatchfacePointerController<PendingWatchfaceDrag> | null>(null);
  if (!pointerControllerRef.current) {
    pointerControllerRef.current = new WatchfacePointerController((pending) =>
      dragPaintCallbackRef.current(pending)
    );
  }
  const dragVisualRef = useRef<WatchfaceDragVisual | null>(null);
  const precomposedDragRef = useRef<WatchfacePrecomposedDrag | null>(null);
  const precomposeRevisionRef = useRef(0);
  const dragPreparationIdRef = useRef(0);
  const dragCommitIdRef = useRef(0);
  const placementMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const assetCacheRef = useRef(new Map<string, CorosWatchfaceTemplateAsset>());
  const dragRef = useRef<WatchfaceDragState | null>(null);
  const [loadingSprite, setLoadingSprite] = useState(false);
  const [configAssetPreviews, setConfigAssetPreviews] = useState(
    () => new Map<string, CorosWatchfaceTemplateAsset>()
  );

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
  const [selectedIds, setSelectedIds] = useState<string[]>(["background"]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [aodBackgroundDataUrl, setAodBackgroundDataUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<WatchfacePreviewMode>("current");
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewingExport, setPreviewingExport] = useState(false);
  const [exportPreviewDataUrl, setExportPreviewDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [stageZoom, setStageZoom] = useState<"fit" | number>("fit");
  const [watchPreviewDirectory, setWatchPreviewDirectory] = useState("");
  const [placementMenuOpen, setPlacementMenuOpen] = useState(false);
  const [placementPreferences, setPlacementPreferences] =
    useState<WatchfacePlacementPreferences>(() =>
      readWatchfacePlacementPreferences(browserPlacementStorage())
    );
  const [canvasBackingRevision, setCanvasBackingRevision] = useState(0);
  const [dragVisualActive, setDragVisualActive] = useState(false);
  const [spriteTransformDraft, setSpriteTransformDraft] =
    useState<WatchfaceSpriteTransformDraft | null>(null);
  const [cropSpriteId, setCropSpriteId] = useState<string | null>(null);
  const cropOpeningRef = useRef<CorosWatchfaceDesignSprite["crop"]>(undefined);
  const [contextMenu, setContextMenu] =
    useState<WatchfaceContextMenuState | null>(null);

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

  function patchPlacementPreferences(
    patch: Partial<WatchfacePlacementPreferences>
  ) {
    setPlacementPreferences((current) => ({ ...current, ...patch }));
  }

  function clearSnapGuides() {
    snapGuidesRef.current = [];
    snapMeasurementsRef.current = [];
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (context && dragOverlaySnapshotRef.current) {
      context.putImageData(dragOverlaySnapshotRef.current, 0, 0);
    }
    if (snapStatusElementRef.current) {
      snapStatusElementRef.current.textContent = selectedElement
        ? backgroundElementLabel(selectedElement)
        : selectedLayer?.label ?? "No selection";
      snapStatusElementRef.current.classList.remove("is-snap-status");
    }
  }

  function paintPlacementFeedback() {
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !dragOverlaySnapshotRef.current) return;
    context.putImageData(dragOverlaySnapshotRef.current, 0, 0);
    const scaleX = canvas.width / previewWidth;
    const scaleY = canvas.height / previewHeight;
    context.save();
    context.beginPath();
    context.arc(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) / 2,
      0,
      Math.PI * 2
    );
    context.clip();
    if (snapGuidesRef.current.length > 0) {
      context.beginPath();
      for (const guide of snapGuidesRef.current) {
        if (guide.axis === "x") {
          context.moveTo(guide.value * scaleX, 0);
          context.lineTo(guide.value * scaleX, canvas.height);
        } else {
          context.moveTo(0, guide.value * scaleY);
          context.lineTo(canvas.width, guide.value * scaleY);
        }
      }
      context.strokeStyle = "rgba(81, 224, 181, 0.98)";
      context.lineWidth = 1.5;
      context.setLineDash([]);
      context.stroke();
    }
    paintWatchfaceMeasurements(
      context,
      snapMeasurementsRef.current,
      scaleX,
      scaleY
    );
    context.restore();
    const status = formatWatchfaceSnapStatus(snapGuidesRef.current);
    if (snapStatusElementRef.current && status) {
      snapStatusElementRef.current.textContent = status;
      snapStatusElementRef.current.classList.add("is-snap-status");
    }
  }

  useEffect(() => {
    const stage = previewStackRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const preview = previewCanvasRef.current;
        if (!preview) return;
        const changed = resizeWatchfaceCanvasBackings([
          previewCanvasRef.current,
          dragPreviewCanvasRef.current,
          overlayCanvasRef.current
        ], window.devicePixelRatio || 1);
        if (changed) setCanvasBackingRevision((revision) => revision + 1);
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    writeWatchfacePlacementPreferences(
      browserPlacementStorage(),
      placementPreferences
    );
  }, [placementPreferences]);

  useEffect(() => {
    if (!placementMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!placementMenuRef.current?.contains(event.target as Node)) {
        setPlacementMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacementMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [placementMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleSnapBypass = (event: KeyboardEvent) => {
      if (event.key === "Alt" && dragRef.current) {
        pointerControllerRef.current?.updatePending((pending) => ({
          ...pending,
          bypassSnap: true
        }));
        clearSnapGuides();
      }
    };
    window.addEventListener("keydown", handleSnapBypass);
    return () => window.removeEventListener("keydown", handleSnapBypass);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pointerControllerRef.current?.cancel();
      dragPreparationIdRef.current += 1;
      dragVisualRef.current = null;
      backgroundRenderQueueRef.current.pending = null;
      previewRenderQueueRef.current.pending = null;
    };
  }, []);

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
    setSelectedIds(["background"]);
    setHoveredId(null);
    setBackgroundDataUrl("");
    setAodBackgroundDataUrl("");
    setPreviewMode("current");
    setDetails(null);
    setPlacementMenuOpen(false);
    setContextMenu(null);
    clearSnapGuides();
    pointerControllerRef.current?.cancel();
    dragRef.current = null;
    dragPreparationIdRef.current += 1;
    dragVisualRef.current = null;
    setDragVisualActive(false);
    if (dragPreviewCanvasRef.current) {
      dragPreviewCanvasRef.current.style.visibility = "hidden";
    }
    backgroundRenderQueueRef.current.pending = null;
    previewRenderQueueRef.current.pending = null;
    assetCacheRef.current.clear();
  }, [initialProjectId, initialValue, sessionId]);

  useEffect(() => {
    assetCacheRef.current.clear();
    let cancelled = false;
    api
      .describeCorosWatchfaceTemplate(starterArchive.archiveId)
      .then(async (described) => {
        let templateArtwork: CorosWatchfaceTemplateAsset | undefined;
        if (!initialDesign) {
          for (const assetPath of getTemplateBackgroundAssetPaths(described)) {
            try {
              const [asset] = await loadAssets([assetPath]);
              if (asset) {
                templateArtwork = asset;
                break;
              }
            } catch {
              // Older templates may only include one of the preview variants.
            }
          }
        }
        if (cancelled) return;

        setDetails(described);
        const current = historyRef.current;
        let nextDesign = current.present.value.design;
        if (!initialDesign) {
          nextDesign = {
            ...nextDesign,
            ...(templateArtwork
              ? {
                  artwork: {
                    dataUrl: templateArtwork.dataUrl,
                    width: templateArtwork.width,
                    height: templateArtwork.height
                  },
                  zoom: 1
                }
              : {}),
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
                color: undefined
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
      })
      .catch((caught) => {
        if (!cancelled) {
          onError(caught instanceof Error ? caught.message : "Could not read the template.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    initialDesign,
    loadAssets,
    onError,
    sessionId,
    starterArchive.archiveId
  ]);

  const backgroundDesign = useMemo(
    () => design,
    [
      design.artwork,
      design.artworkVisible,
      design.backgroundColor,
      design.zoom,
      design.backgroundElements,
      design.designSprites,
      design.configAssetOverrides,
      design.staticSeparators,
      design.fontFamily
    ]
  );
  const supportsAod = useMemo(
    () => (details ? hasWatchfaceAod(details) : false),
    [details]
  );
  const studioOptions = useMemo(
    () => toStudioOptions(design),
    [
      design.fontFamily,
      design.fontWeight,
      design.fontStyle,
      design.letterSpacing,
      design.rasterFont,
      design.digitColor,
      design.accentColor,
      design.tintLabels,
      design.tintIcons,
      design.previewComplication,
      design.metricStyles,
      design.selectableMetricStyle,
      design.controlBatteryEnabled,
      design.separateAutoTime,
      design.timeStyles,
      design.dateStyles,
      design.layerColors,
      design.configAssetOverrides,
      design.ampmIndicator
    ]
  );
  const previewStudioOptions = useMemo(
    () => previewMode === "current" || !supportsAod
      ? studioOptions
      : {
          ...studioOptions,
          digitColor: dimHexColor(studioOptions.digitColor, AOD_DIM_FACTOR),
          accentColor: dimHexColor(studioOptions.accentColor, AOD_DIM_FACTOR),
          previewComplication: undefined,
          metricStyles: {},
          complicationStyle: undefined,
          timeStyles: {},
          dateStyles: {},
          layerColors: {},
          ampmStyle: undefined,
          configAssetScope: "aod" as const
        },
    [previewMode, studioOptions, supportsAod]
  );
  const designDetails = useMemo(
    () => (details ? deriveDesignDetails(details, design) : null),
    [
      details,
      design.metricChanges,
      design.metricStyles,
      design.selectableMetricStyle,
      design.controlBatteryEnabled,
      design.separateAutoTime,
      design.timeStyles,
      design.dateStyles,
      design.layerColors,
      design.controlIconOffsets,
      design.configAssetOverrides,
      design.staticSeparators,
      design.layoutOffsets,
      design.layerVisibility,
      design.digitColor
    ]
  );
  const basePreviewDetails = designDetails?.previewDetails ?? null;
  const previewDetails = useMemo(
    () => basePreviewDetails
      ? detailsForPreviewMode(basePreviewDetails, previewMode)
      : null,
    [basePreviewDetails, previewMode]
  );
  const previewResolution = useMemo(
    () => (previewDetails ? pickPreviewResolution(previewDetails) : null),
    [previewDetails]
  );
  const previewWidth = previewResolution?.width ?? 800;
  const previewHeight = previewResolution?.height ?? previewWidth;
  const watchPreviewResolution = useMemo(
    () => previewDetails?.resolutions.find(
      (resolution) => resolution.directory === watchPreviewDirectory
    ) ?? (previewDetails ? pickWatchPreviewResolution(previewDetails) : null),
    [previewDetails, watchPreviewDirectory]
  );
  const renderedPreviewDetails = useMemo(
    () => previewDetails && watchPreviewResolution
      ? detailsForPreviewResolution(
          previewDetails,
          watchPreviewResolution.directory
        )
      : previewDetails,
    [previewDetails, watchPreviewResolution]
  );
  const watchCoordinateResolution = watchPreviewResolution;
  const watchCoordinateWidth = watchCoordinateResolution?.width ?? previewWidth;
  const watchCoordinateHeight = watchCoordinateResolution?.height ?? previewWidth;
  const watchCoordinateScale = previewWidth > 0
    ? watchCoordinateWidth / previewWidth
    : 1;
  const toWatchCoordinate = (value: number) =>
    Math.round(value * watchCoordinateScale);
  const fromWatchCoordinate = (value: number) =>
    value / watchCoordinateScale;
  const studioOptionsForResolution = useCallback(
    (
      options: WatchfaceStudioOptions,
      resolutionDetails: CorosWatchfaceTemplateDetails
    ): WatchfaceStudioOptions => {
      const target = pickPreviewResolution(resolutionDetails);
      if (!previewResolution || !target) {
        return options;
      }
      return {
        ...options,
        batteryIconResolutionScale: target.width / previewResolution.width,
        effectResolutionScale: target.width / previewResolution.width,
        ...(options.ampmStyle
          ? {
              ampmStyle: scaleAmPmStyleForResolution(
                options.ampmStyle,
                previewResolution,
                target
              )
            }
          : {})
      };
    },
    [previewResolution]
  );

  useEffect(() => {
    setWatchPreviewDirectory("");
  }, [sessionId]);

  useEffect(() => {
    if (!previewDetails) return;
    setWatchPreviewDirectory((current) =>
      previewDetails.resolutions.some(
        (resolution) => resolution.directory === current
      )
        ? current
        : pickWatchPreviewResolution(previewDetails)?.directory ?? ""
    );
  }, [previewDetails]);
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
  const layers = useMemo(() => {
    if (!details) return [];
    return deriveEditorLayers(details, design).filter((layer) =>
      previewMode === "current"
        ? !layer.configAssetId || layer.configAssetId.startsWith("config:")
        : layer.configAssetId?.startsWith("aod:")
    );
  }, [details, design, previewMode]);
  const configAssetReferences = useMemo(
    () => (details
      ? listWatchfaceConfigAssets(details).filter(
          (reference) => reference.scope === (previewMode === "aod" ? "aod" : "config")
        )
      : []),
    [details, previewMode]
  );
  const configAssetsById = useMemo(
    () => new Map(configAssetReferences.map((reference) => [reference.id, reference])),
    [configAssetReferences]
  );
  const backgroundElements = design.backgroundElements ?? [];
  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;
  const selectedSprite = selectedLayer?.kind === "customSprite" && selectedLayer.spriteId
    ? (design.designSprites ?? []).find((sprite) => sprite.id === selectedLayer.spriteId) ?? null
    : null;
  const selectedFreeformTransformItems = selectedIds.length > 1
    ? selectedIds.flatMap<WatchfaceGroupTransformItem>((id) => {
        if (id.startsWith("bgel:")) {
          const element = backgroundElements.find(
            (candidate) => `bgel:${candidate.id}` === id
          );
          const bounds = selectionBoundsForId(id);
          return element && bounds
            ? [{
                id,
                x: element.x * (previewWidth / BACKGROUND_SPACE),
                y: element.y * (previewHeight / BACKGROUND_SPACE),
                width: Math.max(8, bounds.x1 - bounds.x0),
                height: Math.max(8, bounds.y1 - bounds.y0),
                rotation: element.rotation
              }]
            : [];
        }
        const layer = layers.find((candidate) => candidate.id === id);
        const sprite = layer?.kind === "customSprite" && layer.spriteId
          ? (design.designSprites ?? []).find((candidate) => candidate.id === layer.spriteId)
          : null;
        return sprite
          ? [{
              id,
              x: sprite.x,
              y: sprite.y,
              width: sprite.width * sprite.scale,
              height: sprite.height * sprite.scale,
              rotation: sprite.rotation
            }]
          : [];
      })
    : [];
  const selectedFreeformBounds = selectedIds.length > 1
    ? unionWatchfaceBounds(
        selectedIds
          .map(selectionBoundsForId)
          .filter((bounds): bounds is WatchfaceEditorBounds => Boolean(bounds))
      )
    : null;
  const multiFreeformCanTransform = Boolean(
    previewMode === "current" &&
    selectedIds.length > 1 &&
    selectedFreeformTransformItems.length === selectedIds.length &&
    selectedFreeformBounds &&
    selectedIds.every((id) => !isMovementLockedForId(id))
  );
  const multiFreeformBounds = multiFreeformCanTransform
    ? selectedFreeformBounds
    : null;
  const transformTargetId = multiFreeformCanTransform
    ? `selection:${selectedIds.slice().sort().join("|")}`
    : selectedSprite?.id ?? null;
  const baseSpriteTransform = multiFreeformBounds
    ? {
        x: (multiFreeformBounds.x0 + multiFreeformBounds.x1) / 2,
        y: (multiFreeformBounds.y0 + multiFreeformBounds.y1) / 2,
        width: multiFreeformBounds.x1 - multiFreeformBounds.x0,
        height: multiFreeformBounds.y1 - multiFreeformBounds.y0,
        rotation: 0
      }
    : selectedSprite
      ? {
          x: selectedSprite.x,
          y: selectedSprite.y,
          width: selectedSprite.width * selectedSprite.scale,
          height: selectedSprite.height * selectedSprite.scale,
          rotation: selectedSprite.rotation
        }
      : null;
  const spriteTransform = transformTargetId &&
      spriteTransformDraft?.targetId === transformTargetId
    ? spriteTransformDraft.transform
    : baseSpriteTransform;
  const selectedSpriteCanTransform = Boolean(
    multiFreeformCanTransform || (
      selectedLayer &&
      selectedSprite &&
      selectedIds.length === 1 &&
      previewMode === "current" &&
      !isMovementLockedForId(selectedLayer.id)
    )
  );

  useEffect(() => {
    setSelectedId(previewMode === "current" ? "background" : "");
    setSelectedIds(previewMode === "current" ? ["background"] : []);
    setHoveredId(null);
    setPlacementMenuOpen(false);
    clearSnapGuides();
  }, [previewMode]);

  useEffect(() => {
    if (layers.some((layer) => layer.id === selectedId)) return;
    const nextId = previewMode === "current"
      ? layers.find((layer) => layer.id === "background")?.id ?? layers[0]?.id ?? ""
      : layers[0]?.id ?? "";
    setSelectedId(nextId);
    setSelectedIds(nextId ? [nextId] : []);
  }, [layers, previewMode, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const paths = [...new Set(
      configAssetReferences
        .filter((reference) => reference.source)
        .map((reference) => reference.archivePath)
    )];
    setConfigAssetPreviews(new Map());
    if (paths.length === 0) {
      return () => {
        cancelled = true;
      };
    }
    void loadAssets(paths)
      .then((assets) => {
        if (!cancelled) {
          setConfigAssetPreviews(new Map(assets.map((asset) => [asset.path, asset])));
        }
      })
      .catch(() => {
        // Missing optional assets remain visible in the list with a text fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [configAssetReferences, loadAssets, sessionId]);

  useEffect(() => {
    if (previewMode !== "aod" || !supportsAod) {
      setAodBackgroundDataUrl("");
      return;
    }
    const resolution = watchPreviewResolution;
    if (!resolution) {
      setAodBackgroundDataUrl("");
      return;
    }
    const fallback = solidPreviewBackground(resolution.config.bg_color);
    const override = design.configAssetOverrides?.["aod:background_icon"];
    if (override?.enabled === false) {
      setAodBackgroundDataUrl(fallback);
      return;
    }
    if (override?.replacement) {
      setAodBackgroundDataUrl(override.replacement.dataUrl);
      return;
    }
    const relativePath = resolution.config.background_icon
      ?.trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (!relativePath) {
      setAodBackgroundDataUrl(fallback);
      return;
    }
    let cancelled = false;
    setAodBackgroundDataUrl(fallback);
    void loadAssets([`${resolution.directory}/${relativePath}`])
      .then(([asset]) => {
        if (!cancelled && asset) {
          setAodBackgroundDataUrl(asset.dataUrl);
        }
      })
      .catch(() => {
        // The configured background may be optional; retain the config color.
      });
    return () => {
      cancelled = true;
    };
  }, [
    design.configAssetOverrides,
    loadAssets,
    previewMode,
    sessionId,
    supportsAod,
    watchPreviewResolution
  ]);
  const selectorIconTarget = useMemo(() => {
    const resolution = watchPreviewResolution ?? previewResolution;
    if (!previewDetails || !resolution) {
      return null;
    }
    const available = getAvailableComplications(previewDetails);
    const complication = available.find(
      (item) => item.id === design.previewComplication
    ) ?? available[0];
    if (!complication) {
      return null;
    }
    const config = resolution.config;
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
      ? resolution.icons.find(
          (candidate) =>
            candidate.path === `${resolution.directory}/${iconValue}`
        )
      : null;
    const stateFolderName = config[
      `control_${complication.controlPrefix}_icon_dir`
    ]?.replace(/\\/g, "/");
    const state = stateFolderName
      ? resolution.spriteFolders.find(
          (folder) =>
            folder.kind === "state" && folder.folder === stateFolderName
        )?.files[0]
      : null;
    const baseWidth = icon?.width ?? state?.width ?? Math.round(resolution.width * 0.05);
    const baseHeight = icon?.height ?? state?.height ?? Math.round(resolution.width * 0.04);
    // The preview frame is rendered from the selected watch's native tree,
    // while the interaction overlay uses the largest template coordinate
    // space. Convert the bitmap's native top-left bounds into that space so
    // the box follows the pixels at every device resolution and scale.
    const coordinateScale = previewWidth / resolution.width;
    const x = (origin.x + position.x) * coordinateScale;
    const y = (origin.y + position.y) * coordinateScale;
    return {
      complicationId: complication.id,
      x0: x,
      y0: y,
      x1: x + baseWidth * coordinateScale,
      y1: y + baseHeight * coordinateScale
    };
  }, [
    design.previewComplication,
    previewDetails,
    previewResolution,
    previewWidth,
    watchPreviewResolution
  ]);
  const activeBackgroundElements = previewMode === "current"
    ? backgroundElements.filter((element) => element.visible !== false)
    : [];
  const visibleEditorGroups = previewMode === "current"
    ? design.editorGroups ?? []
    : [];
  const groupedEditorLayerIds = new Set(
    visibleEditorGroups.flatMap((group) => group.layerIds)
  );
  const previewBackgroundDataUrl = previewMode === "aod" && supportsAod
    ? aodBackgroundDataUrl
    : backgroundDataUrl;
  const selectedElementId = selectedId.startsWith("bgel:")
    ? selectedId.slice("bgel:".length)
    : null;
  const selectedElement =
    backgroundElements.find((element) => element.id === selectedElementId) ?? null;
  const backgroundContext = selectedId === "background" || selectedElement !== null;

  function linkedIdsFor(id: string): string[] {
    return editorGroupForLayer(design.editorGroups, id)?.layerIds ?? [id];
  }

  function isPositionLocked(id: string): boolean {
    return (design.lockedLayerIds ?? []).includes(id);
  }

  /** A linked group cannot move when any of its components is position-locked. */
  function isMovementLockedForId(id: string): boolean {
    return linkedIdsFor(id).some(isPositionLocked);
  }

  function isMovableSelectionId(id: string): boolean {
    if (id.startsWith("bgel:")) {
      return backgroundElements.some((element) => `bgel:${element.id}` === id);
    }
    const layer = layers.find((candidate) => candidate.id === id);
    return Boolean(
      layer &&
        (layer.capabilities.position ||
          layer.kind === "customSprite" ||
          layer.staticSeparatorId ||
          layer.ampmIndicator ||
          layer.weatherIndicator)
    );
  }

  function movableIdsForGesture(primaryId: string): string[] {
    const source = selectedIds.includes(primaryId)
      ? selectedIds
      : linkedIdsFor(primaryId);
    return expandWatchfaceGroupSelection(design.editorGroups, source).filter(
      (id) => isMovableSelectionId(id) && !isMovementLockedForId(id)
    );
  }

  function dragMovementIds(drag: WatchfaceDragState): string[] {
    if (isSpriteTransformDrag(drag)) {
      return drag.selectionIds?.length ? drag.selectionIds : [drag.snapId];
    }
    const primaryId = drag.kind === "selectorIcon" ? "complication" : drag.snapId;
    return drag.selectionIds?.length ? drag.selectionIds : linkedIdsFor(primaryId);
  }

  function selectEditorItem(id: string, additive = false) {
    setContextMenu(null);
    const members = linkedIdsFor(id);
    if (!additive) {
      setSelectedId(id);
      setSelectedIds(members);
      return;
    }
    setSelectedIds((current) => {
      const selected = new Set(current);
      const remove = members.every((member) => selected.has(member));
      for (const member of members) {
        if (remove) selected.delete(member);
        else selected.add(member);
      }
      const next = [...selected];
      if (remove) {
        if (members.includes(selectedId)) setSelectedId(next.at(-1) ?? "");
        return next;
      }
      setSelectedId(id);
      return next;
    });
  }

  function openLayerContextMenu(
    event: { preventDefault(): void; clientX: number; clientY: number },
    id: string
  ) {
    event.preventDefault();
    if (!selectedIds.includes(id)) selectEditorItem(id);
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 246)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 198))
    });
  }

  function linkSelectedLayers() {
    const movable = [...new Set(selectedIds.filter(
      (id) => isMovableSelectionId(id) && !isMovementLockedForId(id)
    ))];
    if (movable.length < 2) return;
    setDesign((current) => {
      const groups = normalizeWatchfaceEditorGroups(
        current.editorGroups,
        current.linkedLayerGroups
      );
      const touching = groups.filter((group) =>
        group.layerIds.some((id) => movable.includes(id))
      );
      const merged = [
        ...new Set([...movable, ...touching.flatMap((group) => group.layerIds)])
      ];
      return syncLegacyWatchfaceGroups({
        ...current,
        editorGroups: [
          ...groups.filter((group) => !touching.includes(group)),
          {
            id: touching[0]?.id ?? `group-${Date.now().toString(36)}`,
            name: touching[0]?.name ?? `Group ${groups.length + 1}`,
            layerIds: merged
          }
        ]
      });
    });
    const mergedSelection = [
      ...new Set([
        ...movable,
        ...(design.editorGroups ?? [])
          .filter((group) => group.layerIds.some((id) => movable.includes(id)))
          .flatMap((group) => group.layerIds)
      ])
    ];
    setSelectedIds(mergedSelection);
    setContextMenu(null);
    onNotice(`${mergedSelection.length} components grouped. They now move together.`);
  }

  function unlinkSelectedLayers() {
    const groups = design.editorGroups ?? [];
    const removed = groups.filter((group) =>
      group.layerIds.some((id) => selectedIds.includes(id)) &&
      group.layerIds.every((id) => !isPositionLocked(id))
    );
    if (removed.length === 0) return;
    setDesign((current) => syncLegacyWatchfaceGroups({
      ...current,
      editorGroups: (current.editorGroups ?? []).filter(
        (group) => !group.layerIds.some((id) => selectedIds.includes(id))
      )
    }));
    setSelectedIds(selectedId ? [selectedId] : []);
    setContextMenu(null);
    onNotice("Group removed. Components can now move independently.");
  }

  function setLayerPositionLocked(id: string, locked: boolean) {
    setDesign((current) => {
      const lockedIds = new Set(current.lockedLayerIds ?? []);
      if (locked) lockedIds.add(id);
      else lockedIds.delete(id);
      return { ...current, lockedLayerIds: [...lockedIds] };
    });
  }

  function lockSelectedLayers() {
    const movable = [...new Set(selectedIds.filter(isMovableSelectionId))];
    if (movable.length === 0) return;
    setDesign((current) => ({
      ...current,
      lockedLayerIds: [...new Set([...(current.lockedLayerIds ?? []), ...movable])]
    }));
    setContextMenu(null);
    onNotice(
      movable.length === 1
        ? "Component position locked."
        : `${movable.length} component positions locked.`
    );
  }

  function unlockSelectedLayers() {
    const movable = new Set(selectedIds.filter(isMovableSelectionId));
    if (movable.size === 0) return;
    setDesign((current) => ({
      ...current,
      lockedLayerIds: (current.lockedLayerIds ?? []).filter(
        (id) => !movable.has(id)
      )
    }));
    setContextMenu(null);
    onNotice(
      movable.size === 1
        ? "Component position unlocked."
        : `${movable.size} component positions unlocked.`
    );
  }

  function setEditorGroupLocked(groupId: string, locked: boolean) {
    const group = design.editorGroups?.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setDesign((current) => {
      const ids = new Set(current.lockedLayerIds ?? []);
      for (const id of group.layerIds) {
        if (locked) ids.add(id);
        else ids.delete(id);
      }
      return { ...current, lockedLayerIds: [...ids] };
    });
  }

  function editorGroupVisible(groupId: string): boolean {
    const group = design.editorGroups?.find((candidate) => candidate.id === groupId);
    if (!group) return true;
    return group.layerIds.some((id) => {
      if (id.startsWith("bgel:")) {
        return backgroundElements.find(
          (element) => `bgel:${element.id}` === id
        )?.visible !== false;
      }
      return layers.find((layer) => layer.id === id)?.visible ?? false;
    });
  }

  function toggleEditorGroupVisibility(groupId: string) {
    const group = design.editorGroups?.find((candidate) => candidate.id === groupId);
    if (!group || group.layerIds.some(isPositionLocked)) return;
    const visible = editorGroupVisible(groupId);
    beginDesignTransaction();
    for (const id of group.layerIds) {
      if (id.startsWith("bgel:")) {
        updateElement(id.slice("bgel:".length), { visible: !visible });
        continue;
      }
      const layer = layers.find((candidate) => candidate.id === id);
      if (layer && layer.visible === visible) toggleLayerVisibility(layer);
    }
    endDesignTransaction();
  }

  const selectedMovableIds = selectedIds.filter(isMovableSelectionId);
  const selectionHasLink = (design.editorGroups ?? []).some((group) =>
    group.layerIds.some((id) => selectedIds.includes(id))
  );
  const selectionCanUnlink = (design.editorGroups ?? []).some((group) =>
    group.layerIds.some((id) => selectedIds.includes(id)) &&
    group.layerIds.every((id) => !isPositionLocked(id))
  );
  const selectionHasLockedPosition = selectedMovableIds.some(isPositionLocked);

  function selectedLayoutItems() {
    return watchfaceSelectionUnits(design.editorGroups, selectedMovableIds)
      .filter((unit) => unit.layerIds.every((id) => !isMovementLockedForId(id)))
      .flatMap((unit) => {
        const bounds = unionWatchfaceBounds(
          unit.layerIds
            .map(selectionBoundsForId)
            .filter((box): box is WatchfaceEditorBounds => Boolean(box))
        );
        return bounds ? [{ ...unit, bounds }] : [];
      });
  }

  function applyLayoutMovements(
    movements: Record<string, { dx: number; dy: number }>,
    items = selectedLayoutItems()
  ) {
    setDesign((current) => items.reduce(
      (next, item) => {
        const movement = movements[item.id];
        return movement
          ? moveLinkedSelectionIds(next, item.layerIds, movement)
          : next;
      },
      current
    ));
  }

  function alignSelection(alignment: WatchfaceAlignment) {
    const items = selectedLayoutItems();
    if (items.length === 0) return;
    applyLayoutMovements(
      alignWatchfaceItems(
        items,
        alignment,
        items.length === 1
          ? { x0: 0, y0: 0, x1: previewWidth, y1: previewHeight }
          : undefined
      ),
      items
    );
  }

  function distributeSelection(direction: WatchfaceDistribution) {
    const items = selectedLayoutItems();
    if (items.length < 3) return;
    applyLayoutMovements(distributeWatchfaceItems(items, direction), items);
  }

  function hideDragVisual() {
    dragPreparationIdRef.current += 1;
    dragVisualRef.current = null;
    const canvas = dragPreviewCanvasRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.visibility = "hidden";
    }
    setDragVisualActive(false);
    setSpriteTransformDraft(null);
  }

  function drawDragVisual() {
    const visual = dragVisualRef.current;
    const canvas = dragPreviewCanvasRef.current;
    if (!visual?.baseFrame || !visual.movingFrame || !canvas) return;
    const context = canvas.getContext("2d", { colorSpace: "display-p3" });
    if (!context) return;
    const scaleX = canvas.width / previewWidth;
    const scaleY = canvas.height / previewHeight;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.arc(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) / 2,
      0,
      Math.PI * 2
    );
    context.clip();
    context.drawImage(visual.baseFrame, 0, 0, canvas.width, canvas.height);
    const spriteTransform = visual.spriteTransform;
    if (spriteTransform && isSpriteTransformDrag(visual.drag)) {
      const centerX = spriteTransform.x * scaleX;
      const centerY = spriteTransform.y * scaleY;
      const baseCenterX = visual.drag.spriteTransform.initial.x * scaleX;
      const baseCenterY = visual.drag.spriteTransform.initial.y * scaleY;
      context.translate(centerX, centerY);
      if (visual.drag.kind === "spriteResize") {
        const baseRotation = (visual.drag.spriteTransform.initial.rotation * Math.PI) / 180;
        context.rotate(baseRotation);
        context.scale(spriteTransform.scaleX, spriteTransform.scaleY);
        context.rotate(-baseRotation);
      } else {
        context.rotate((spriteTransform.rotationDelta * Math.PI) / 180);
      }
      context.translate(-baseCenterX, -baseCenterY);
      // The isolated moving frame contains only this sprite. Transforming the
      // full transparent frame avoids clipping an image while it is rotated.
      context.drawImage(visual.movingFrame, 0, 0, canvas.width, canvas.height);
    } else {
      context.translate(
        visual.movement.dx * scaleX,
        visual.movement.dy * scaleY
      );
      const x = visual.clipBounds.x0 * scaleX;
      const y = visual.clipBounds.y0 * scaleY;
      const width = (visual.clipBounds.x1 - visual.clipBounds.x0) * scaleX;
      const height = (visual.clipBounds.y1 - visual.clipBounds.y0) * scaleY;
      context.drawImage(
        visual.movingFrame,
        x,
        y,
        width,
        height,
        x,
        y,
        width,
        height
      );
    }
    context.restore();

    const primaryId = visual.drag.kind === "selectorIcon"
      ? "complication"
      : visual.drag.snapId;
    const movedIds = dragMovementIds(visual.drag);
    const linkedBounds = movedIds
      .map(selectionBoundsForId)
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    const baseBounds = linkedBounds.length > 1
      ? linkedBounds.reduce((result, box) => ({
          x0: Math.min(result.x0, box.x0),
          y0: Math.min(result.y0, box.y0),
          x1: Math.max(result.x1, box.x1),
          y1: Math.max(result.y1, box.y1)
        }))
      : visual.drag.baseBounds;
    if (!spriteTransform) {
      const bounds = translateWatchfaceBounds(
        baseBounds,
        visual.movement.dx,
        visual.movement.dy
      );
      context.strokeStyle = "rgba(81, 224, 181, 0.95)";
      context.lineWidth = 2;
      context.setLineDash([]);
      context.strokeRect(
        bounds.x0 * scaleX,
        bounds.y0 * scaleY,
        (bounds.x1 - bounds.x0) * scaleX,
        (bounds.y1 - bounds.y0) * scaleY
      );
    }
    canvas.style.visibility = "visible";
  }

  function isolateDragDesigns(drag: WatchfaceDragState): {
    base: CorosWatchfaceDesignState;
    moving: CorosWatchfaceDesignState;
    clipBounds: WatchfaceEditorBounds;
  } {
    const primaryId = drag.kind === "selectorIcon" ? "complication" : drag.snapId;
    const movingIds = dragMovementIds(drag);
    const movingIdSet = new Set(movingIds);
    const movingElementIds = new Set(
      movingIds
        .filter((id) => id.startsWith("bgel:"))
        .map((id) => id.slice("bgel:".length))
    );
    const movingLayers = layers.filter((layer) => movingIdSet.has(layer.id));
    const movingSpriteIds = new Set(
      movingLayers
        .map((layer) => layer.spriteId)
        .filter((id): id is string => Boolean(id))
    );
    const movingSeparatorIds = new Set(
      movingLayers
        .map((layer) => layer.staticSeparatorId)
        .filter((id): id is WatchfaceStaticSeparatorId => Boolean(id))
    );
    const movesAmPm = movingLayers.some((layer) => layer.ampmIndicator);
    const movesWeather = movingLayers.some((layer) => layer.weatherIndicator);
    const hiddenLayerVisibility = { ...design.layerVisibility };
    for (const layer of layers) {
      if (layer.layoutGroupId) {
        hiddenLayerVisibility[layer.layoutGroupId] = false;
      }
    }
    for (const layer of movingLayers) {
      if (layer.layoutGroupId) hiddenLayerVisibility[layer.layoutGroupId] = true;
    }
    if (drag.kind === "selectorIcon") {
      hiddenLayerVisibility.complication = true;
    }

    const baseSeparators = { ...design.staticSeparators };
    for (const separatorId of movingSeparatorIds) {
      baseSeparators[separatorId] = {
        ...baseSeparators[separatorId],
        enabled: false
      };
    }
    const base: CorosWatchfaceDesignState = {
      ...design,
      backgroundElements: (design.backgroundElements ?? []).filter(
        (element) => !movingElementIds.has(element.id)
      ),
      designSprites: (design.designSprites ?? []).filter(
        (sprite) => !movingSpriteIds.has(sprite.id)
      ),
      staticSeparators: baseSeparators,
      ampmIndicator:
        movesAmPm && design.ampmIndicator
          ? { ...design.ampmIndicator, enabled: false }
          : design.ampmIndicator,
      weatherIndicator:
        movesWeather && design.weatherIndicator
          ? { ...design.weatherIndicator, enabled: false }
          : design.weatherIndicator,
      layerVisibility: {
        ...design.layerVisibility,
        ...Object.fromEntries(
          movingLayers
            .map((layer) => layer.layoutGroupId)
            .filter((id): id is string => Boolean(id))
            .map((id) => [id, false])
        )
      },
      ...(drag.kind === "selectorIcon"
        ? {
            controlIconOffsets: {
              ...(design.controlIconOffsets ?? {}),
              [drag.targetId]: {
                dx: previewWidth * 8,
                dy: previewHeight * 8
              }
            }
          }
        : {})
    };

    const moving: CorosWatchfaceDesignState = {
      ...design,
      artwork: null,
      // The moving frame is composited over the stationary base frame. Keep
      // its background transparent so a clipped piece of project artwork does
      // not travel with the selected components while dragging.
      artworkVisible: false,
      backgroundElements: (design.backgroundElements ?? []).filter(
        (element) => movingElementIds.has(element.id)
      ),
      designSprites: (design.designSprites ?? []).filter((sprite) =>
        movingSpriteIds.has(sprite.id)
      ),
      staticSeparators: {
        colon: {
          ...design.staticSeparators.colon,
          enabled:
            movingSeparatorIds.has("colon")
        },
        dateSlash: {
          ...design.staticSeparators.dateSlash,
          enabled:
            movingSeparatorIds.has("dateSlash")
        }
      },
      ampmIndicator: design.ampmIndicator
        ? { ...design.ampmIndicator, enabled: movesAmPm }
        : undefined,
      weatherIndicator: design.weatherIndicator
        ? { ...design.weatherIndicator, enabled: movesWeather }
        : undefined,
      layerVisibility: hiddenLayerVisibility
    };

    const linkedBounds = movingIds
      .map(selectionBoundsForId)
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    const movingBounds = linkedBounds.length > 0
      ? linkedBounds.reduce((result, box) => ({
          x0: Math.min(result.x0, box.x0),
          y0: Math.min(result.y0, box.y0),
          x1: Math.max(result.x1, box.x1),
          y1: Math.max(result.y1, box.y1)
        }))
      : drag.baseBounds;
    const clipPadding = 2;
    return {
      base,
      moving,
      clipBounds: {
        x0: Math.max(0, movingBounds.x0 - clipPadding),
        y0: Math.max(0, movingBounds.y0 - clipPadding),
        x1: Math.min(previewWidth, movingBounds.x1 + clipPadding),
        y1: Math.min(previewHeight, movingBounds.y1 + clipPadding)
      }
    };
  }

  async function renderDragFrame(
    frameDesign: CorosWatchfaceDesignState
  ): Promise<HTMLCanvasElement> {
    if (!details) {
      throw new Error("Watch face details are not ready.");
    }
    const frame = document.createElement("canvas");
    frame.width = dragPreviewCanvasRef.current?.width ?? PREVIEW_SIZE;
    frame.height = dragPreviewCanvasRef.current?.height ?? PREVIEW_SIZE;
    const allFrameDetails = deriveDesignDetails(details, frameDesign).previewDetails;
    const frameDetails = watchPreviewResolution
      ? detailsForPreviewResolution(
          allFrameDetails,
          watchPreviewResolution.directory
        )
      : allFrameDetails;
    const frameBackground = await renderDesignBackground(
      frameDesign,
      previewWidth
    );
    await drawStudioPreview(
      frame,
      frameBackground,
      frameDetails,
      studioOptionsForResolution(toStudioOptions(frameDesign), frameDetails),
      loadAssets
    );
    if (frameDesign.weatherIndicator?.enabled) {
      const url = await weatherPreviewDataUrl(
        previewWidth,
        frameDesign.weatherIndicator.color
      );
      if (url) {
        const image = await loadStudioImage(url);
        const context = frame.getContext("2d");
        const scale = frame.width / previewWidth;
        context?.drawImage(
          image,
          frameDesign.weatherIndicator.x * scale,
          frameDesign.weatherIndicator.y * scale,
          image.naturalWidth * frameDesign.weatherIndicator.scale * scale,
          image.naturalHeight * frameDesign.weatherIndicator.scale * scale
        );
      }
    }
    return frame;
  }

  function prepareDragVisual(drag: WatchfaceDragState) {
    if (!details) return;
    const preparationId = ++dragPreparationIdRef.current;
    const isolated = isolateDragDesigns(drag);
    const selectionKey = dragMovementIds(drag).slice().sort().join("|");
    const cached = precomposedDragRef.current;
    const cacheMatches = Boolean(
      cached &&
      cached.design === design &&
      cached.selectionKey === selectionKey &&
      cached.previewDirectory === (watchPreviewResolution?.directory ?? "")
    );
    dragVisualRef.current = {
      drag,
      baseFrame: cacheMatches ? cached!.baseFrame : null,
      movingFrame: cacheMatches ? cached!.movingFrame : null,
      movement: { dx: 0, dy: 0 },
      clipBounds: cacheMatches ? cached!.clipBounds : isolated.clipBounds,
      preparationId,
      awaitingCommitId: null
    };
    const canvas = dragPreviewCanvasRef.current;
    if (canvas) {
      canvas.style.visibility = "hidden";
    }
    setDragVisualActive(true);
    if (cacheMatches) drawDragVisual();
  }

  useEffect(() => {
    if (!details || previewMode !== "current") {
      precomposedDragRef.current = null;
      return;
    }
    const selectionIds = selectedIds.filter(
      (id) => isMovableSelectionId(id) && !isPositionLocked(id)
    );
    const bounds = selectionIds
      .map(selectionBoundsForId)
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    if (selectionIds.length === 0 || bounds.length === 0) {
      precomposedDragRef.current = null;
      return;
    }
    const baseBounds = bounds.slice(1).reduce((result, box) => ({
      x0: Math.min(result.x0, box.x0),
      y0: Math.min(result.y0, box.y0),
      x1: Math.max(result.x1, box.x1),
      y1: Math.max(result.y1, box.y1)
    }), { ...bounds[0]! });
    const primaryId = selectionIds.at(-1)!;
    const synthetic: WatchfaceDragState = {
      kind: "layout",
      targetId: primaryId,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0,
      snapId: primaryId,
      baseBounds,
      selectionIds
    };
    const isolated = isolateDragDesigns(synthetic);
    const revision = ++precomposeRevisionRef.current;
    const selectionKey = selectionIds.slice().sort().join("|");
    const previewDirectory = watchPreviewResolution?.directory ?? "";
    void Promise.all([
      renderDragFrame(isolated.base),
      renderDragFrame(isolated.moving)
    ]).then(([baseFrame, movingFrame]) => {
      if (
        !mountedRef.current ||
        revision !== precomposeRevisionRef.current ||
        previewSessionRef.current !== sessionId
      ) return;
      const cached: WatchfacePrecomposedDrag = {
        design,
        selectionKey,
        previewDirectory,
        baseFrame,
        movingFrame,
        clipBounds: isolated.clipBounds
      };
      precomposedDragRef.current = cached;
      const active = dragVisualRef.current;
      if (
        active &&
        active.baseFrame === null &&
        dragMovementIds(active.drag).slice().sort().join("|") === selectionKey
      ) {
        active.baseFrame = baseFrame;
        active.movingFrame = movingFrame;
        active.clipBounds = isolated.clipBounds;
        drawDragVisual();
      }
    }).catch(() => {
      if (revision === precomposeRevisionRef.current) {
        precomposedDragRef.current = null;
      }
    });
    return () => {
      precomposeRevisionRef.current += 1;
    };
  }, [
    design,
    selectedIds,
    details,
    previewMode,
    previewWidth,
    previewHeight,
    watchPreviewResolution?.directory,
    canvasBackingRevision,
    sessionId
  ]);

  function previewSpriteTransform(
    drag: WatchfaceDragState,
    point: { x: number; y: number },
    shiftKey: boolean,
    fromCenter: boolean
  ) {
    if (!isSpriteTransformDrag(drag)) return;
    const { initial, handle, startPointer } = drag.spriteTransform;
    const sprite = (design.designSprites ?? []).find(
      (candidate) => candidate.id === drag.targetId
    );
    const isGroupTransform = Boolean(drag.spriteTransform.groupItems?.length);
    let next: WatchfaceSpriteTransform;
    let rotationDelta = 0;
    if (drag.kind === "spriteResize" && handle) {
      next = resizeWatchfaceSprite(
        initial,
        handle,
        point.x - drag.startX,
        point.y - drag.startY,
        (isGroupTransform || sprite?.aspectLocked !== false) !== shiftKey,
        fromCenter
      );
    } else {
      const rotation = rotateWatchfaceSprite(
        initial,
        startPointer ?? { x: drag.startX, y: drag.startY },
        point,
        isGroupTransform
          ? { x: 0.5, y: 0.5 }
          : normalizeWatchfaceTransformOrigin(sprite?.origin),
        shiftKey ? 15 : 0
      );
      next = {
        ...initial,
        ...(rotation.x !== undefined ? { x: rotation.x } : {}),
        ...(rotation.y !== undefined ? { y: rotation.y } : {}),
        rotation: rotation.rotation
      };
      rotationDelta = rotation.rotationDelta;
    }
    const transform = {
      x: Math.max(0, Math.min(previewWidth, next.x)),
      y: Math.max(0, Math.min(previewHeight, next.y)),
      width: next.width,
      height: next.height,
      rotation: next.rotation,
      scaleX: next.width / initial.width,
      scaleY: next.height / initial.height,
      rotationDelta
    };
    const visual = dragVisualRef.current;
    if (visual?.drag === drag) {
      visual.spriteTransform = transform;
      if (visual.baseFrame && visual.movingFrame) drawDragVisual();
    }
    paintSpriteTransformOverlay(transform);
  }

  function paintSpriteTransformOverlay(transform: WatchfaceSpriteTransform) {
    const group = transformGroupRef.current;
    if (!group) return;
    group.setAttribute(
      "transform",
      `translate(${transform.x} ${transform.y}) rotate(${transform.rotation})`
    );
    const box = group.querySelector<SVGRectElement>(".wf-sprite-transform-box");
    box?.setAttribute("x", String(-transform.width / 2));
    box?.setAttribute("y", String(-transform.height / 2));
    box?.setAttribute("width", String(transform.width));
    box?.setAttribute("height", String(transform.height));
    const stem = group.querySelector<SVGLineElement>(".wf-sprite-transform-stem");
    stem?.setAttribute("y1", String(-transform.height / 2));
    stem?.setAttribute("y2", String(-transform.height / 2 - 20));
    const rotate = group.querySelector<SVGCircleElement>("[data-sprite-transform-control='rotate']");
    rotate?.setAttribute("cy", String(-transform.height / 2 - 24));
    const positions: Record<WatchfaceSpriteResizeHandle, [number, number]> = {
      nw: [-transform.width / 2, -transform.height / 2],
      n: [0, -transform.height / 2],
      ne: [transform.width / 2, -transform.height / 2],
      e: [transform.width / 2, 0],
      se: [transform.width / 2, transform.height / 2],
      s: [0, transform.height / 2],
      sw: [-transform.width / 2, transform.height / 2],
      w: [-transform.width / 2, 0]
    };
    for (const [handle, [x, y]] of Object.entries(positions)) {
      const node = group.querySelector<SVGCircleElement>(
        `[data-sprite-transform-control='${handle}']`
      );
      node?.setAttribute("cx", String(x));
      node?.setAttribute("cy", String(y));
    }
    const origin = normalizeWatchfaceTransformOrigin(
      dragRef.current?.spriteTransform?.groupItems?.length
        ? undefined
        : (design.designSprites ?? []).find(
            (sprite) => sprite.id === selectedSprite?.id
          )?.origin
    );
    const marker = group.querySelector<SVGCircleElement>(".wf-transform-origin-marker");
    marker?.setAttribute("cx", String((origin.x - 0.5) * transform.width));
    marker?.setAttribute("cy", String((origin.y - 0.5) * transform.height));
  }

  function startSpriteTransform(
    event: React.PointerEvent<SVGSVGElement>,
    control: "rotate" | WatchfaceSpriteResizeHandle
  ) {
    if (
      previewMode === "aod" ||
      event.button !== 0 ||
      !selectedSpriteCanTransform ||
      !spriteTransform ||
      !transformTargetId
    ) {
      return;
    }
    const groupItems = multiFreeformCanTransform
      ? selectedFreeformTransformItems
      : undefined;
    const sprite = !groupItems && selectedLayer?.spriteId
      ? (design.designSprites ?? []).find(
          (candidate) => candidate.id === selectedLayer.spriteId
        )
      : null;
    const point = toResolutionPoint(event);
    if (!point || (!sprite && !groupItems)) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = { ...spriteTransform };
    const kind = control === "rotate" ? "spriteRotate" : "spriteResize";
    const drag: WatchfaceDragState = {
      kind,
      targetId: transformTargetId,
      startX: point.x,
      startY: point.y,
      baseX: initial.x,
      baseY: initial.y,
      snapId: groupItems ? selectedIds.at(-1)! : selectedLayer!.id,
      baseBounds: multiFreeformBounds ?? selectedLayer?.bounds ?? {
        x0: initial.x - initial.width / 2,
        y0: initial.y - initial.height / 2,
        x1: initial.x + initial.width / 2,
        y1: initial.y + initial.height / 2
      },
      ...(groupItems ? { selectionIds: [...selectedIds] } : {}),
      spriteTransform: {
        initial,
        scale: sprite?.scale ?? 1,
        ...(groupItems ? { groupItems } : {}),
        ...(control === "rotate"
          ? { startPointer: point }
          : { handle: control })
      }
    };
    beginDesignTransaction();
    dragRef.current = drag;
    setSpriteTransformDraft({ targetId: transformTargetId, transform: initial });
    prepareDragVisual(drag);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSpriteTransformPointerDown(
    event: React.PointerEvent<SVGSVGElement>
  ) {
    const target = event.target as SVGElement;
    const control = target.getAttribute("data-sprite-transform-control");
    if (control === "rotate") startSpriteTransform(event, control);
    else if (["nw", "n", "ne", "e", "se", "s", "sw", "w"].includes(control ?? "")) {
      startSpriteTransform(event, control as WatchfaceSpriteResizeHandle);
    }
  }

  function commitSpriteTransform(drag: WatchfaceDragState) {
    if (!isSpriteTransformDrag(drag)) return false;
    const transform = dragVisualRef.current?.drag === drag
      ? dragVisualRef.current.spriteTransform
      : undefined;
    if (!transform) return false;
    const initial = drag.spriteTransform.initial;
    const changed =
      Math.round(transform.x) !== Math.round(initial.x) ||
      Math.round(transform.y) !== Math.round(initial.y) ||
      Math.abs(transform.width - initial.width) > 0.01 ||
      Math.abs(transform.height - initial.height) > 0.01 ||
      Math.abs(transform.rotation - initial.rotation) > 0.01;
    if (!changed) return false;
    const commitId = ++dragCommitIdRef.current;
    if (dragVisualRef.current?.drag === drag) {
      dragVisualRef.current.awaitingCommitId = commitId;
    }
    const groupItems = drag.spriteTransform.groupItems;
    if (groupItems?.length) {
      const nextItems = drag.kind === "spriteRotate"
        ? rotateWatchfaceTransformGroup(
            groupItems,
            { x: initial.x, y: initial.y },
            transform.rotationDelta
          )
        : resizeWatchfaceTransformGroup(groupItems, initial, transform);
      const nextById = new Map(nextItems.map((item) => [item.id, item]));
      const initialById = new Map(groupItems.map((item) => [item.id, item]));
      const spriteIdsByLayer = new Map(
        layers.flatMap((layer) => layer.spriteId ? [[layer.id, layer.spriteId] as const] : [])
      );
      const backgroundScaleX = BACKGROUND_SPACE / previewWidth;
      const backgroundScaleY = BACKGROUND_SPACE / previewHeight;
      setDesign((current) => ({
        ...current,
        designSprites: (current.designSprites ?? []).map((sprite) => {
          const editorId = [...spriteIdsByLayer.entries()].find(
            ([, spriteId]) => spriteId === sprite.id
          )?.[0];
          const next = editorId ? nextById.get(editorId) : null;
          return next
            ? {
                ...sprite,
                x: Math.max(0, Math.min(previewWidth, next.x)),
                y: Math.max(0, Math.min(previewHeight, next.y)),
                width: next.width / sprite.scale,
                height: next.height / sprite.scale,
                rotation: normalizeWatchfaceRotation(next.rotation)
              }
            : sprite;
        }),
        backgroundElements: (current.backgroundElements ?? []).map((element) => {
          const editorId = `bgel:${element.id}`;
          const opening = initialById.get(editorId);
          const next = nextById.get(editorId);
          if (!opening || !next) return element;
          const widthScale = next.width / Math.max(opening.width, 0.001);
          const heightScale = next.height / Math.max(opening.height, 0.001);
          const uniformScale = Math.sqrt(Math.abs(widthScale * heightScale));
          const common = {
            ...element,
            x: Math.max(0, Math.min(BACKGROUND_SPACE, next.x * backgroundScaleX)),
            y: Math.max(0, Math.min(BACKGROUND_SPACE, next.y * backgroundScaleY)),
            rotation: normalizeWatchfaceRotation(next.rotation)
          };
          if (element.kind === "rect") {
            return {
              ...common,
              width: Math.max(8, element.width * widthScale),
              height: Math.max(8, element.height * heightScale),
              cornerRadius: Math.max(0, element.cornerRadius * uniformScale),
              ...(element.strokeWidth !== undefined
                ? { strokeWidth: element.strokeWidth * uniformScale }
                : {})
            };
          }
          if (element.kind === "ellipse") {
            return {
              ...common,
              width: Math.max(8, element.width * widthScale),
              height: Math.max(8, element.height * heightScale),
              ...(element.strokeWidth !== undefined
                ? { strokeWidth: element.strokeWidth * uniformScale }
                : {})
            };
          }
          if (element.kind === "line") {
            return {
              ...common,
              dx: element.dx * widthScale,
              dy: element.dy * heightScale,
              strokeWidth: Math.max(1, element.strokeWidth * uniformScale)
            };
          }
          return {
            ...common,
            fontSize: Math.max(8, element.fontSize * uniformScale)
          };
        })
      }));
      return true;
    }
    updateSprite(drag.targetId, {
      x: transform.x,
      y: transform.y,
      width: transform.width / drag.spriteTransform.scale,
      height: transform.height / drag.spriteTransform.scale,
      rotation: normalizeWatchfaceRotation(transform.rotation)
    });
    return true;
  }

  function updateElement(id: string, patch: BackgroundElementPatch) {
    if (isPositionLocked(`bgel:${id}`)) return;
    const { x, y, ...otherPatch } = patch;
    const boundedPatch = {
      ...otherPatch,
      ...(x !== undefined
        ? { x: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(x))) }
        : {}),
      ...(y !== undefined
        ? { y: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(y))) }
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
    setSelectedIds([`bgel:${element.id}`]);
  }

  function removeElement(id: string) {
    const editorId = `bgel:${id}`;
    if (isPositionLocked(editorId)) return;
    setDesign((prev) => syncLegacyWatchfaceGroups({
      ...prev,
      backgroundElements: (prev.backgroundElements ?? []).filter((e) => e.id !== id),
      editorGroups: (prev.editorGroups ?? [])
        .map((group) => ({
          ...group,
          layerIds: group.layerIds.filter((candidate) => candidate !== editorId)
        }))
        .filter((group) => group.layerIds.length >= 2),
      lockedLayerIds: (prev.lockedLayerIds ?? []).filter(
        (candidate) => candidate !== editorId
      )
    }));
    setSelectedId("background");
    setSelectedIds(["background"]);
  }

  const queueBackgroundRender = useCallback(
    (request: WatchfaceBackgroundRenderRequest) => {
      const queue = backgroundRenderQueueRef.current;
      queue.pending = request;
      if (queue.running) return;
      queue.running = true;
      void (async () => {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = null;
          try {
            const url = await renderDesignBackground(
              next.design,
              next.previewWidth
            );
            if (
              mountedRef.current &&
              previewSessionRef.current === next.sessionId
            ) {
              setBackgroundDataUrl(url);
            }
          } catch {
            // Keep the last complete background when a draft frame fails.
          }
        }
        queue.running = false;
      })();
    },
    []
  );

  // Background composition is also single-flight. Rapid sprite and shape
  // updates replace the pending draft instead of stacking 800px PNG encodes.
  useEffect(() => {
    queueBackgroundRender({
      sessionId,
      design: backgroundDesign,
      previewWidth
    });
  }, [
    backgroundDesign,
    previewWidth,
    queueBackgroundRender,
    sessionId
  ]);

  const queuePreviewRender = useCallback(
    (request: WatchfacePreviewRenderRequest) => {
      const queue = previewRenderQueueRef.current;
      queue.pending = request;
      if (queue.running) return;
      queue.running = true;
      void (async () => {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = null;
          try {
            const frame = document.createElement("canvas");
            frame.width = PREVIEW_SIZE;
            frame.height = PREVIEW_SIZE;
            await drawStudioPreview(
              frame,
              next.backgroundDataUrl,
              next.details,
              studioOptionsForResolution(next.options, next.details),
              next.loadAssets
            );
            if (next.weather?.enabled) {
              const url = await weatherPreviewDataUrl(
                next.previewWidth,
                next.weather.color
              );
              if (url) {
                const image = await loadStudioImage(url);
                const frameContext = frame.getContext("2d");
                const scale = frame.width / next.previewWidth;
                frameContext?.drawImage(
                  image,
                  next.weather.x * scale,
                  next.weather.y * scale,
                  image.naturalWidth * next.weather.scale * scale,
                  image.naturalHeight * next.weather.scale * scale
                );
              }
            }
            if (
              mountedRef.current &&
              previewSessionRef.current === next.sessionId &&
              previewCanvasRef.current === next.canvas &&
              !dragRef.current &&
              (!dragVisualRef.current?.awaitingCommitId ||
                dragVisualRef.current.awaitingCommitId === next.dragCommitId)
            ) {
              const context = next.canvas.getContext("2d", {
                colorSpace: "display-p3"
              });
              if (context) {
                context.clearRect(0, 0, next.canvas.width, next.canvas.height);
                context.drawImage(
                  frame,
                  0,
                  0,
                  next.canvas.width,
                  next.canvas.height
                );
              }
              if (
                dragVisualRef.current?.awaitingCommitId &&
                dragVisualRef.current.awaitingCommitId === next.dragCommitId
              ) {
                dragPreparationIdRef.current += 1;
                dragVisualRef.current = null;
                const dragCanvas = dragPreviewCanvasRef.current;
                if (dragCanvas) {
                  dragCanvas.getContext("2d")?.clearRect(
                    0,
                    0,
                    dragCanvas.width,
                    dragCanvas.height
                  );
                  dragCanvas.style.visibility = "hidden";
                }
                setDragVisualActive(false);
              }
            }
          } catch {
            // Keep the last complete frame if one preview pass fails.
          }
        }
        queue.running = false;
      })();
    },
    [studioOptionsForResolution]
  );

  // Coalesce accurate preview work into one active render plus the newest
  // pending frame. Pointer movement is handled by the isolated drag canvas, so
  // this path only reconciles the full face after a gesture ends.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !renderedPreviewDetails || !previewBackgroundDataUrl) return;
    queuePreviewRender({
      canvas,
      sessionId,
      backgroundDataUrl: previewBackgroundDataUrl,
      details: renderedPreviewDetails,
      options: previewStudioOptions,
      weather: previewMode === "current" ? design.weatherIndicator : undefined,
      previewWidth,
      loadAssets,
      dragCommitId: dragVisualRef.current?.awaitingCommitId ?? null
    });
  }, [
    renderedPreviewDetails,
    previewBackgroundDataUrl,
    previewStudioOptions,
    design.weatherIndicator,
    previewMode,
    previewWidth,
    loadAssets,
    queuePreviewRender,
    sessionId,
    canvasBackingRevision
  ]);

  // Draw placement aids and selection outlines on the interaction overlay.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scaleX = canvas.width / previewWidth;
    const scaleY = canvas.height / previewHeight;
    const bgScaleX = canvas.width / BACKGROUND_SPACE;
    const bgScaleY = canvas.height / BACKGROUND_SPACE;
    const activeDrag = dragVisualActive ? dragVisualRef.current?.drag : null;
    const activeDragId = activeDrag?.kind === "selectorIcon"
      ? "complication"
      : activeDrag?.snapId;
    const activeDragIds = activeDrag ? dragMovementIds(activeDrag) : [];
    context.clearRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.beginPath();
    context.arc(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) / 2,
      0,
      Math.PI * 2
    );
    context.clip();

    if (previewMode === "current" && placementPreferences.gridVisible) {
      const gridStep = placementPreferences.gridStep / watchCoordinateScale;
      context.beginPath();
      for (let x = gridStep; x < previewWidth; x += gridStep) {
        context.moveTo(x * scaleX, 0);
        context.lineTo(x * scaleX, canvas.height);
      }
      for (let y = gridStep; y < previewHeight; y += gridStep) {
        context.moveTo(0, y * scaleY);
        context.lineTo(canvas.width, y * scaleY);
      }
      context.strokeStyle = "rgba(81, 224, 181, 0.2)";
      context.lineWidth = 1;
      context.setLineDash([]);
      context.stroke();
    }

    if (previewMode === "current" && placementPreferences.guidesVisible) {
      const safeArea = watchfaceSafeAreaBounds(
        previewWidth,
        previewHeight,
        placementPreferences.safeAreaInsetPercent
      );
      context.beginPath();
      context.moveTo((previewWidth / 2) * scaleX, 0);
      context.lineTo((previewWidth / 2) * scaleX, canvas.height);
      context.moveTo(0, (previewHeight / 2) * scaleY);
      context.lineTo(canvas.width, (previewHeight / 2) * scaleY);
      context.strokeStyle = "rgba(81, 224, 181, 0.58)";
      context.lineWidth = 1;
      context.setLineDash([5, 5]);
      context.stroke();

      context.beginPath();
      context.ellipse(
        ((safeArea.x0 + safeArea.x1) / 2) * scaleX,
        ((safeArea.y0 + safeArea.y1) / 2) * scaleY,
        ((safeArea.x1 - safeArea.x0) / 2) * scaleX,
        ((safeArea.y1 - safeArea.y0) / 2) * scaleY,
        0,
        0,
        Math.PI * 2
      );
      context.strokeStyle = "rgba(81, 224, 181, 0.68)";
      context.setLineDash([7, 5]);
      context.stroke();

      context.beginPath();
      for (const guide of design.editorGuides ?? []) {
        if (guide.axis === "x") {
          context.moveTo(guide.position * scaleX, 0);
          context.lineTo(guide.position * scaleX, canvas.height);
        } else {
          context.moveTo(0, guide.position * scaleY);
          context.lineTo(canvas.width, guide.position * scaleY);
        }
      }
      context.strokeStyle = "rgba(96, 176, 255, 0.88)";
      context.setLineDash([]);
      context.stroke();
    }

    context.restore();

    // Keep the stage quiet: only the selected or hovered object gets an outline.
    for (const element of activeBackgroundElements) {
      const box = backgroundElementSnapBounds(element);
      const active = selectedIds.includes(`bgel:${element.id}`);
      const hovered = hoveredId === `bgel:${element.id}`;
      if (!active && !hovered) continue;
      if (selectedSpriteCanTransform && active) continue;
      if (activeDragIds.includes(`bgel:${element.id}`)) continue;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.55)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [4, 4]);
      context.strokeRect(
        box.x0 * bgScaleX,
        box.y0 * bgScaleY,
        (box.x1 - box.x0) * bgScaleX,
        (box.y1 - box.y0) * bgScaleY
      );
    }

    for (const layer of layers) {
      if (!layer.bounds || layer.kind === "background" || !layer.visible) {
        continue;
      }
      if (selectedSpriteCanTransform && selectedIds.includes(layer.id)) {
        continue;
      }
      const active = selectedIds.includes(layer.id);
      const hovered = layer.id === hoveredId;
      if (!active && !hovered) continue;
      if (activeDragIds.includes(layer.id)) continue;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.55)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [4, 4]);
      context.strokeRect(
        layer.bounds.x0 * scaleX,
        layer.bounds.y0 * scaleY,
        (layer.bounds.x1 - layer.bounds.x0) * scaleX,
        (layer.bounds.y1 - layer.bounds.y0) * scaleY
      );
    }
    if (
      selectorIconTarget &&
      !isMovementLockedForId("complication") &&
      selectedIds.includes("complication") &&
      activeDrag?.kind !== "selectorIcon"
    ) {
      context.strokeStyle = "rgba(255, 206, 84, 0.98)";
      context.lineWidth = 2;
      context.setLineDash([]);
      context.strokeRect(
        selectorIconTarget.x0 * scaleX,
        selectorIconTarget.y0 * scaleY,
        (selectorIconTarget.x1 - selectorIconTarget.x0) * scaleX,
        (selectorIconTarget.y1 - selectorIconTarget.y0) * scaleY
      );
    }
    context.setLineDash([]);
    dragOverlaySnapshotRef.current = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
    if (activeDrag) paintPlacementFeedback();
  }, [
    layers,
    selectedId,
    selectedIds,
    hoveredId,
    previewWidth,
    previewHeight,
    activeBackgroundElements,
    selectorIconTarget,
    placementPreferences,
    watchCoordinateScale,
    dragVisualActive,
    previewMode,
    design.linkedLayerGroups,
    design.editorGuides,
    selectedLayer?.id,
    selectedSpriteCanTransform,
    canvasBackingRevision
  ]);

  const toResolutionPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * previewWidth,
        y: ((event.clientY - rect.top) / rect.height) * previewHeight
      };
    },
    [previewWidth, previewHeight]
  );

  function startProjectGuide(
    axis: CorosWatchfaceEditorGuide["axis"],
    event: React.PointerEvent<HTMLElement>,
    existingId?: string
  ) {
    if (previewMode !== "current" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const id = existingId ?? `guide-${Date.now().toString(36)}`;
    const guideLayer = previewStackRef.current?.querySelector<HTMLElement>(
      ".wf-project-guide-layer"
    );
    const original = existingId
      ? guideLayer?.querySelector<HTMLElement>(`[data-guide-id='${existingId}']`)
      : null;
    if (original) original.style.visibility = "hidden";
    const preview = document.createElement("div");
    preview.className = `wf-project-guide is-${axis}`;
    guideLayer?.appendChild(preview);
    let latestPosition = 0;
    const update = (pointer: { clientX: number; clientY: number }) => {
      const point = toResolutionPoint(pointer);
      if (!point) return;
      latestPosition = axis === "x" ? point.x : point.y;
      if (axis === "x") preview.style.left = `${(latestPosition / previewWidth) * 100}%`;
      else preview.style.top = `${(latestPosition / previewHeight) * 100}%`;
    };
    update(event);
    const move = (pointer: PointerEvent) => update(pointer);
    const end = (pointer: PointerEvent) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      const rect = overlayCanvasRef.current?.getBoundingClientRect();
      const outside = !rect || pointer.clientX < rect.left || pointer.clientX > rect.right ||
        pointer.clientY < rect.top || pointer.clientY > rect.bottom;
      preview.remove();
      if (original) original.style.visibility = "";
      if (outside && !existingId) return;
      setDesign((current) => ({
        ...current,
        editorGuides: outside
          ? (current.editorGuides ?? []).filter((guide) => guide.id !== id)
          : [
              ...(current.editorGuides ?? []).filter((guide) => guide.id !== id),
              { id, axis, position: latestPosition }
            ]
      }));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  function removeProjectGuide(id: string) {
    setDesign((current) => ({
      ...current,
      editorGuides: (current.editorGuides ?? []).filter(
        (guide) => guide.id !== id
      )
    }));
  }

  function editorItemAtPoint(point: { x: number; y: number }): string | null {
    if (
      selectorIconTarget &&
      !isPositionLocked("complication") &&
      point.x >= selectorIconTarget.x0 &&
      point.x <= selectorIconTarget.x1 &&
      point.y >= selectorIconTarget.y0 &&
      point.y <= selectorIconTarget.y1
    ) {
      return "complication";
    }
    const liveHit = editorLayerAtPoint(
      layers.filter((layer) => !isMovementLockedForId(layer.id)),
      point.x,
      point.y
    );
    const backgroundHit = backgroundElementAtPoint(
      backgroundElements.filter(
        (element) => !isMovementLockedForId(`bgel:${element.id}`)
      ),
      point.x * (BACKGROUND_SPACE / previewWidth),
      point.y * (BACKGROUND_SPACE / previewHeight)
    );
    return backgroundContext && backgroundHit
      ? `bgel:${backgroundHit.id}`
      : liveHit?.id ?? (backgroundHit ? `bgel:${backgroundHit.id}` : null);
  }

  function startMarqueeSelection(
    event: React.PointerEvent<HTMLCanvasElement>,
    point: { x: number; y: number },
    additive: boolean
  ) {
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    marqueeRef.current = {
      start: point,
      current: point,
      additive,
      openingSelection: [...selectedIds],
      snapshot: canvas && context
        ? context.getImageData(0, 0, canvas.width, canvas.height)
        : null
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drawMarqueeSelection(point: { x: number; y: number }) {
    const marquee = marqueeRef.current;
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!marquee || !canvas || !context) return;
    marquee.current = point;
    if (marquee.snapshot) context.putImageData(marquee.snapshot, 0, 0);
    const scaleX = canvas.width / previewWidth;
    const scaleY = canvas.height / previewHeight;
    const x0 = Math.min(marquee.start.x, point.x) * scaleX;
    const y0 = Math.min(marquee.start.y, point.y) * scaleY;
    const x1 = Math.max(marquee.start.x, point.x) * scaleX;
    const y1 = Math.max(marquee.start.y, point.y) * scaleY;
    context.save();
    context.fillStyle = "rgba(81, 224, 181, 0.12)";
    context.strokeStyle = "rgba(81, 224, 181, 0.98)";
    context.lineWidth = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    context.setLineDash([5, 4]);
    context.fillRect(x0, y0, x1 - x0, y1 - y0);
    context.strokeRect(x0, y0, x1 - x0, y1 - y0);
    context.restore();
  }

  function finishMarqueeSelection() {
    const marquee = marqueeRef.current;
    marqueeRef.current = null;
    if (!marquee) return;
    const box = {
      x0: Math.min(marquee.start.x, marquee.current.x),
      y0: Math.min(marquee.start.y, marquee.current.y),
      x1: Math.max(marquee.start.x, marquee.current.x),
      y1: Math.max(marquee.start.y, marquee.current.y)
    };
    const intersects = (candidate: WatchfaceEditorBounds) =>
      candidate.x1 >= box.x0 && candidate.x0 <= box.x1 &&
      candidate.y1 >= box.y0 && candidate.y0 <= box.y1;
    const hits = [
      ...layers
        .filter((layer) =>
          layer.kind !== "background" && layer.visible && layer.present &&
          layer.bounds && !isMovementLockedForId(layer.id) && intersects(layer.bounds)
        )
        .map((layer) => layer.id),
      ...backgroundElements
        .filter((element) => {
          if (
            element.visible === false ||
            isMovementLockedForId(`bgel:${element.id}`)
          ) return false;
          return intersects(scaleWatchfaceBounds(
            backgroundElementSnapBounds(element),
            previewWidth / BACKGROUND_SPACE,
            previewHeight / BACKGROUND_SPACE
          ));
        })
        .map((element) => `bgel:${element.id}`)
    ];
    const hitUnits = watchfaceSelectionUnits(design.editorGroups, hits);
    let next: string[];
    if (marquee.additive) {
      const selected = new Set(marquee.openingSelection);
      for (const unit of hitUnits) {
        const remove = unit.layerIds.every((id) => selected.has(id));
        for (const id of unit.layerIds) {
          if (remove) selected.delete(id);
          else selected.add(id);
        }
      }
      next = [...selected];
    } else {
      next = hitUnits.flatMap((unit) => unit.layerIds);
    }
    if (next.length === 0 && !marquee.additive) next = ["background"];
    setSelectedIds(next);
    setSelectedId(next.at(-1) ?? "");
    setHoveredId(null);
  }

  function handleCanvasContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    if (previewMode === "aod") return;
    const point = toResolutionPoint(event);
    const hitId = point ? editorItemAtPoint(point) : null;
    if (!hitId) return;
    openLayerContextMenu(event, hitId);
  }

  function placementSnapTargets(movingId: string): WatchfaceSnapTarget[] {
    const activeDrag = dragRef.current;
    const movingIds = new Set(
      activeDrag ? dragMovementIds(activeDrag) : linkedIdsFor(movingId)
    );
    const backgroundScaleX = previewWidth / BACKGROUND_SPACE;
    const backgroundScaleY = previewHeight / BACKGROUND_SPACE;
    const targets: WatchfaceSnapTarget[] = layers
      .filter(
        (layer) =>
          layer.kind !== "background" &&
          layer.bounds &&
          !movingIds.has(layer.id) &&
          !(movingId.startsWith("selectorIcon:") && layer.id === "complication")
      )
      .map((layer) => ({
        id: layer.id,
        label: layer.label,
        bounds: layer.bounds!,
        visible: layer.visible && layer.present
      }));

    for (const element of backgroundElements) {
      if (element.visible === false || movingIds.has(`bgel:${element.id}`)) continue;
      targets.push({
        id: `bgel:${element.id}`,
        label: backgroundElementLabel(element),
        bounds: scaleWatchfaceBounds(
          backgroundElementSnapBounds(element),
          backgroundScaleX,
          backgroundScaleY
        )
      });
    }
    if (selectorIconTarget && movingId !== "complication") {
      targets.push({
        id: `selectorIcon:${selectorIconTarget.complicationId}`,
        label: "Complication icon",
        bounds: selectorIconTarget
      });
    }
    return targets;
  }

  function resolveDragMovement(
    drag: NonNullable<typeof dragRef.current>,
    point: { x: number; y: number },
    bypassSnap: boolean
  ): { dx: number; dy: number } {
    const rawDx = point.x - drag.startX;
    const rawDy = point.y - drag.startY;
    if (!placementPreferences.snapEnabled || bypassSnap) {
      clearSnapGuides();
      return { dx: rawDx, dy: rawDy };
    }
    const renderedWidth =
      overlayCanvasRef.current?.getBoundingClientRect().width ?? PREVIEW_SIZE;
    const threshold = watchfaceDesignThreshold(
      WATCHFACE_SNAP_SCREEN_THRESHOLD,
      previewWidth,
      renderedWidth
    );
    const primaryId = drag.kind === "selectorIcon" ? "complication" : drag.snapId;
    const linkedIds = dragMovementIds(drag);
    const linkedBounds = linkedIds
      .map(selectionBoundsForId)
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    const baseBounds = linkedBounds.length > 1
      ? linkedBounds.reduce((result, box) => ({
          x0: Math.min(result.x0, box.x0),
          y0: Math.min(result.y0, box.y0),
          x1: Math.max(result.x1, box.x1),
          y1: Math.max(result.y1, box.y1)
        }))
      : drag.baseBounds;
    const result = snapWatchfaceBounds({
      movingId: drag.snapId,
      movingBounds: translateWatchfaceBounds(
        baseBounds,
        rawDx,
        rawDy
      ),
      faceWidth: previewWidth,
      faceHeight: previewHeight,
      threshold,
      releaseThreshold: threshold * 1.5,
      retainedGuides: snapGuidesRef.current,
      guides: design.editorGuides ?? [],
      safeAreaInsetPercent: placementPreferences.safeAreaInsetPercent,
      targets: placementSnapTargets(drag.snapId),
      ...(placementPreferences.gridVisible
        ? {
            gridStep: placementPreferences.gridStep / watchCoordinateScale,
            gridLabel: `${placementPreferences.gridStep} px`
          }
        : {})
    });
    snapGuidesRef.current = result.guides;
    snapMeasurementsRef.current = result.measurements.map((measurement) => ({
      ...measurement,
      label: `${Math.round(
        Math.abs(measurement.end - measurement.start) * watchCoordinateScale
      )} px`
    }));
    paintPlacementFeedback();
    return { dx: rawDx + result.dx, dy: rawDy + result.dy };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (previewMode === "aod" || event.button !== 0) return;
    const point = toResolutionPoint(event);
    if (!point) {
      return;
    }
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const hitId = editorItemAtPoint(point);
      if (hitId && hitId !== "background") selectEditorItem(hitId, true);
      else startMarqueeSelection(event, point, true);
      return;
    }
    const toBgX = BACKGROUND_SPACE / previewWidth;
    const toBgY = BACKGROUND_SPACE / previewHeight;

    if (
      selectorIconTarget &&
      !isMovementLockedForId("complication") &&
      point.x >= selectorIconTarget.x0 &&
      point.x <= selectorIconTarget.x1 &&
      point.y >= selectorIconTarget.y0 &&
      point.y <= selectorIconTarget.y1
    ) {
      const movementIds = movableIdsForGesture("complication");
      if (!selectedIds.includes("complication")) selectEditorItem("complication");
      beginDesignTransaction();
      const iconOffset = design.controlIconOffsets?.[
        selectorIconTarget.complicationId
      ] ?? { dx: 0, dy: 0 };
      dragRef.current = {
        kind: "selectorIcon",
        targetId: selectorIconTarget.complicationId,
        startX: point.x,
        startY: point.y,
        baseX: iconOffset.dx,
        baseY: iconOffset.dy,
        snapId: `selectorIcon:${selectorIconTarget.complicationId}`,
        baseBounds: selectorIconTarget,
        selectionIds: movementIds
      };
      prepareDragVisual(dragRef.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    // When working on the background, clicks target the freeform shapes that
    // sit above it; otherwise the live firmware elements take priority.
    const liveHit = editorLayerAtPoint(
      layers.filter((layer) => !isMovementLockedForId(layer.id)),
      point.x,
      point.y
    );
    const liveIsElement = liveHit !== null && liveHit.kind !== "background";
    if (backgroundContext || !liveIsElement) {
      const bgHit = backgroundElementAtPoint(
        backgroundElements.filter(
          (element) => !isMovementLockedForId(`bgel:${element.id}`)
        ),
        point.x * toBgX,
        point.y * toBgY
      );
      if (bgHit) {
        const hitId = `bgel:${bgHit.id}`;
        const movementIds = movableIdsForGesture(hitId);
        if (!selectedIds.includes(hitId)) selectEditorItem(hitId);
        beginDesignTransaction();
        dragRef.current = {
          kind: "bgElement",
          targetId: bgHit.id,
          startX: point.x,
          startY: point.y,
          baseX: bgHit.x,
          baseY: bgHit.y,
          snapId: `bgel:${bgHit.id}`,
          baseBounds: scaleWatchfaceBounds(
            backgroundElementSnapBounds(bgHit),
            previewWidth / BACKGROUND_SPACE,
            previewHeight / BACKGROUND_SPACE
          ),
          selectionIds: movementIds
        };
        prepareDragVisual(dragRef.current);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (!liveHit || liveHit.kind === "background") {
      startMarqueeSelection(event, point, false);
      return;
    }
    const movementIds = movableIdsForGesture(liveHit.id);
    if (!selectedIds.includes(liveHit.id)) selectEditorItem(liveHit.id);
    if (liveHit.weatherIndicator && design.weatherIndicator) {
      beginDesignTransaction();
      dragRef.current = {
        kind: "weather",
        targetId: "weather",
        startX: point.x,
        startY: point.y,
        baseX: design.weatherIndicator.x,
        baseY: design.weatherIndicator.y,
        snapId: liveHit.id,
        baseBounds: liveHit.bounds!,
        selectionIds: movementIds
      };
      prepareDragVisual(dragRef.current);
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
        baseY: design.ampmIndicator.y,
        snapId: liveHit.id,
        baseBounds: liveHit.bounds!,
        selectionIds: movementIds
      };
      prepareDragVisual(dragRef.current);
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
        baseY: separator.y,
        snapId: liveHit.id,
        baseBounds: liveHit.bounds!,
        selectionIds: movementIds
      };
      prepareDragVisual(dragRef.current);
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
          baseY: sprite.y,
          snapId: liveHit.id,
          baseBounds: liveHit.bounds!,
          selectionIds: movementIds
        };
        prepareDragVisual(dragRef.current);
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
        baseY: offset.dy,
        snapId: liveHit.id,
        baseBounds: liveHit.bounds!,
        selectionIds: movementIds
      };
      prepareDragVisual(dragRef.current);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function clampSingleDragMovement(
    drag: WatchfaceDragState,
    movement: { dx: number; dy: number }
  ): { dx: number; dy: number } {
    if (drag.kind === "bgElement") {
      const toBgX = BACKGROUND_SPACE / previewWidth;
      const toBgY = BACKGROUND_SPACE / previewHeight;
      const x = Math.max(
        0,
        Math.min(BACKGROUND_SPACE, Math.round(drag.baseX + movement.dx * toBgX))
      );
      const y = Math.max(
        0,
        Math.min(BACKGROUND_SPACE, Math.round(drag.baseY + movement.dy * toBgY))
      );
      return {
        dx: (x - drag.baseX) / toBgX,
        dy: (y - drag.baseY) / toBgY
      };
    }
    if (drag.kind === "sprite") {
      const x = Math.max(
        0,
        Math.min(previewWidth, Math.round(drag.baseX + movement.dx))
      );
      const y = Math.max(
        0,
        Math.min(previewHeight, Math.round(drag.baseY + movement.dy))
      );
      return { dx: x - drag.baseX, dy: y - drag.baseY };
    }
    if (drag.kind === "staticSeparator") {
      const separator = design.staticSeparators[
        drag.targetId as WatchfaceStaticSeparatorId
      ];
      const halfWidth = Math.max(24, separator.size * 0.65) / 2;
      const halfHeight = Math.max(24, separator.size * 1.15) / 2;
      const x = Math.round(
        Math.max(
          halfWidth,
          Math.min(previewWidth - halfWidth, drag.baseX + movement.dx)
        )
      );
      const y = Math.round(
        Math.max(
          halfHeight,
          Math.min(previewHeight - halfHeight, drag.baseY + movement.dy)
        )
      );
      return { dx: x - drag.baseX, dy: y - drag.baseY };
    }
    if (drag.kind === "ampm") {
      const capability = details ? getAmPmCapability(details) : null;
      const style = design.ampmIndicator;
      if (!capability || !style) return { dx: 0, dy: 0 };
      const width = capability.icon.width * style.scale;
      const height = capability.icon.height * style.scale;
      const x = Math.round(
        Math.max(0, Math.min(previewWidth - width, drag.baseX + movement.dx))
      );
      const y = Math.round(
        Math.max(0, Math.min(previewHeight - height, drag.baseY + movement.dy))
      );
      return { dx: x - drag.baseX, dy: y - drag.baseY };
    }
    if (drag.kind === "weather") {
      const capability = details ? getWeatherCapability(details) : null;
      const style = design.weatherIndicator;
      if (!capability || !style) return { dx: 0, dy: 0 };
      const width = capability.size.width * style.scale;
      const height = capability.size.height * style.scale;
      const x = Math.round(
        Math.max(0, Math.min(previewWidth - width, drag.baseX + movement.dx))
      );
      const y = Math.round(
        Math.max(0, Math.min(previewHeight - height, drag.baseY + movement.dy))
      );
      return { dx: x - drag.baseX, dy: y - drag.baseY };
    }
    if (drag.kind === "selectorIcon") {
      return {
        dx: Math.round(drag.baseX + movement.dx) - drag.baseX,
        dy: Math.round(drag.baseY + movement.dy) - drag.baseY
      };
    }
    const limits = layoutLimits[drag.targetId];
    const fallbackLimit = Math.max(previewWidth, previewHeight);
    const x = Math.max(
      limits?.minDx ?? -fallbackLimit,
      Math.min(
        limits?.maxDx ?? fallbackLimit,
        Math.round(drag.baseX + movement.dx)
      )
    );
    const y = Math.max(
      limits?.minDy ?? -fallbackLimit,
      Math.min(
        limits?.maxDy ?? fallbackLimit,
        Math.round(drag.baseY + movement.dy)
      )
    );
    return { dx: x - drag.baseX, dy: y - drag.baseY };
  }

  function selectionBoundsForId(id: string): WatchfaceEditorBounds | null {
    if (id.startsWith("bgel:")) {
      const element = backgroundElements.find(
        (candidate) => `bgel:${candidate.id}` === id
      );
      return element
        ? scaleWatchfaceBounds(
            backgroundElementSnapBounds(element),
            previewWidth / BACKGROUND_SPACE,
            previewHeight / BACKGROUND_SPACE
          )
        : null;
    }
    return layers.find((layer) => layer.id === id)?.bounds ?? null;
  }

  function clampMovementForSelectionIds(
    ids: string[],
    movement: { dx: number; dy: number }
  ): { dx: number; dy: number } {
    const bounds = ids
      .map(selectionBoundsForId)
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    if (bounds.length === 0) return movement;
    const union = bounds.reduce((result, box) => ({
      x0: Math.min(result.x0, box.x0),
      y0: Math.min(result.y0, box.y0),
      x1: Math.max(result.x1, box.x1),
      y1: Math.max(result.y1, box.y1)
    }));
    let minDx = -union.x0;
    let maxDx = previewWidth - union.x1;
    let minDy = -union.y0;
    let maxDy = previewHeight - union.y1;
    for (const id of ids) {
      const layer = layers.find((candidate) => candidate.id === id);
      if (!layer?.layoutGroupId || !layer.capabilities.position) continue;
      const offset = design.layoutOffsets?.[layer.layoutGroupId] ?? { dx: 0, dy: 0 };
      const limits = layoutLimits[layer.layoutGroupId];
      if (!limits) continue;
      minDx = Math.max(minDx, limits.minDx - offset.dx);
      maxDx = Math.min(maxDx, limits.maxDx - offset.dx);
      minDy = Math.max(minDy, limits.minDy - offset.dy);
      maxDy = Math.min(maxDy, limits.maxDy - offset.dy);
    }
    if (minDx > maxDx) minDx = maxDx = 0;
    if (minDy > maxDy) minDy = maxDy = 0;
    return {
      dx: Math.max(minDx, Math.min(maxDx, movement.dx)),
      dy: Math.max(minDy, Math.min(maxDy, movement.dy))
    };
  }

  function clampDragMovement(
    drag: WatchfaceDragState,
    movement: { dx: number; dy: number }
  ): { dx: number; dy: number } {
    const clamped = clampSingleDragMovement(drag, movement);
    const primaryId = drag.kind === "selectorIcon" ? "complication" : drag.snapId;
    const linked = dragMovementIds(drag);
    if (linked.length < 2) return clamped;
    return clampMovementForSelectionIds(linked, clamped);
  }

  function previewDragMovement(
    drag: WatchfaceDragState,
    point: { x: number; y: number },
    bypassSnap: boolean
  ) {
    const movement = clampDragMovement(
      drag,
      resolveDragMovement(drag, point, bypassSnap)
    );
    const visual = dragVisualRef.current;
    if (visual?.drag === drag) {
      visual.movement = movement;
      drawDragVisual();
    }
  }

  function commitSingleDragMovement(
    drag: WatchfaceDragState,
    movement: { dx: number; dy: number }
  ) {
    if (drag.kind === "bgElement") {
      const toBgX = BACKGROUND_SPACE / previewWidth;
      const toBgY = BACKGROUND_SPACE / previewHeight;
      const clampBg = (v: number) => Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(v)));
      updateElement(drag.targetId, {
        x: clampBg(drag.baseX + movement.dx * toBgX),
        y: clampBg(drag.baseY + movement.dy * toBgY)
      });
      return;
    }
    if (drag.kind === "sprite") {
      const clampX = (v: number) => Math.max(0, Math.min(previewWidth, Math.round(v)));
      const clampY = (v: number) => Math.max(0, Math.min(previewHeight, Math.round(v)));
      updateSprite(drag.targetId, {
        x: clampX(drag.baseX + movement.dx),
        y: clampY(drag.baseY + movement.dy)
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
            Math.min(previewWidth - halfWidth, drag.baseX + movement.dx)
          )
        ),
        y: Math.round(
          Math.max(
            halfHeight,
            Math.min(
              previewHeight - halfHeight,
              drag.baseY + movement.dy
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
      const faceHeight = previewResolution?.height ?? previewHeight;
      const width = capability.icon.width * style.scale;
      const height = capability.icon.height * style.scale;
      updateAmPmIndicator({
        x: Math.round(
          Math.max(0, Math.min(faceWidth - width, drag.baseX + movement.dx))
        ),
        y: Math.round(
          Math.max(0, Math.min(faceHeight - height, drag.baseY + movement.dy))
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
      const faceHeight = previewResolution?.height ?? previewHeight;
      const width = capability.size.width * style.scale;
      const height = capability.size.height * style.scale;
      updateWeatherIndicator({
        x: Math.round(
          Math.max(0, Math.min(faceWidth - width, drag.baseX + movement.dx))
        ),
        y: Math.round(
          Math.max(0, Math.min(faceHeight - height, drag.baseY + movement.dy))
        )
      });
      return;
    }
    if (drag.kind === "selectorIcon") {
      const dx = Math.round(drag.baseX + movement.dx);
      const dy = Math.round(drag.baseY + movement.dy);
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
      drag.baseX + movement.dx,
      limits?.minDx ?? -fallbackLimit,
      limits?.maxDx ?? fallbackLimit
    );
    const dy = clamp(
      drag.baseY + movement.dy,
      limits?.minDy ?? -fallbackLimit,
      limits?.maxDy ?? fallbackLimit
    );
    setDesign((prev) => ({
      ...prev,
      layoutOffsets: { ...prev.layoutOffsets, [drag.targetId]: { dx, dy } }
    }));
  }

  function moveLinkedSelectionIds(
    current: CorosWatchfaceDesignState,
    ids: string[],
    movement: { dx: number; dy: number }
  ): CorosWatchfaceDesignState {
    let next = current;
    const movedLayoutGroups = new Set<string>();
    for (const id of ids) {
      if (isPositionLocked(id)) continue;
      if (id.startsWith("bgel:")) {
        const elementId = id.slice("bgel:".length);
        const toBgX = BACKGROUND_SPACE / previewWidth;
        const toBgY = BACKGROUND_SPACE / previewHeight;
        next = {
          ...next,
          backgroundElements: (next.backgroundElements ?? []).map((element) =>
            element.id === elementId
              ? {
                  ...element,
                  x: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(element.x + movement.dx * toBgX))),
                  y: Math.max(0, Math.min(BACKGROUND_SPACE, Math.round(element.y + movement.dy * toBgY)))
                }
              : element
          )
        };
        continue;
      }
      const layer = layers.find((candidate) => candidate.id === id);
      if (!layer) continue;
      if (layer.kind === "customSprite" && layer.spriteId) {
        next = {
          ...next,
          designSprites: (next.designSprites ?? []).map((sprite) =>
            sprite.id === layer.spriteId
              ? {
                  ...sprite,
                  x: Math.max(0, Math.min(previewWidth, Math.round(sprite.x + movement.dx))),
                  y: Math.max(0, Math.min(previewHeight, Math.round(sprite.y + movement.dy)))
                }
              : sprite
          )
        };
        continue;
      }
      if (layer.staticSeparatorId) {
        const separator = next.staticSeparators[layer.staticSeparatorId];
        const halfWidth = Math.max(24, separator.size * 0.65) / 2;
        const halfHeight = Math.max(24, separator.size * 1.15) / 2;
        next = {
          ...next,
          staticSeparators: {
            ...next.staticSeparators,
            [layer.staticSeparatorId]: {
              ...separator,
              x: Math.round(Math.max(halfWidth, Math.min(previewWidth - halfWidth, separator.x + movement.dx))),
              y: Math.round(Math.max(halfHeight, Math.min(previewHeight - halfHeight, separator.y + movement.dy)))
            }
          }
        };
        continue;
      }
      if (layer.ampmIndicator && next.ampmIndicator) {
        const capability = details ? getAmPmCapability(details) : null;
        const width = (capability?.icon.width ?? 0) * next.ampmIndicator.scale;
        const height = (capability?.icon.height ?? 0) * next.ampmIndicator.scale;
        next = {
          ...next,
          ampmIndicator: {
            ...next.ampmIndicator,
            x: Math.round(Math.max(0, Math.min(previewWidth - width, next.ampmIndicator.x + movement.dx))),
            y: Math.round(Math.max(0, Math.min(previewHeight - height, next.ampmIndicator.y + movement.dy)))
          }
        };
        continue;
      }
      if (layer.weatherIndicator && next.weatherIndicator) {
        const capability = details ? getWeatherCapability(details) : null;
        const width = (capability?.size.width ?? 0) * next.weatherIndicator.scale;
        const height = (capability?.size.height ?? 0) * next.weatherIndicator.scale;
        next = {
          ...next,
          weatherIndicator: {
            ...next.weatherIndicator,
            x: Math.round(Math.max(0, Math.min(previewWidth - width, next.weatherIndicator.x + movement.dx))),
            y: Math.round(Math.max(0, Math.min(previewHeight - height, next.weatherIndicator.y + movement.dy)))
          }
        };
        continue;
      }
      if (
        layer.layoutGroupId &&
        layer.capabilities.position &&
        !movedLayoutGroups.has(layer.layoutGroupId)
      ) {
        movedLayoutGroups.add(layer.layoutGroupId);
        const groupId = layer.layoutGroupId;
        const offset = next.layoutOffsets?.[groupId] ?? { dx: 0, dy: 0 };
        const limits = layoutLimits[groupId];
        const fallback = Math.max(previewWidth, previewHeight);
        next = {
          ...next,
          layoutOffsets: {
            ...next.layoutOffsets,
            [groupId]: {
              dx: Math.max(limits?.minDx ?? -fallback, Math.min(limits?.maxDx ?? fallback, Math.round(offset.dx + movement.dx))),
              dy: Math.max(limits?.minDy ?? -fallback, Math.min(limits?.maxDy ?? fallback, Math.round(offset.dy + movement.dy)))
            }
          }
        };
      }
    }
    return next;
  }

  function commitDragMovement(
    drag: WatchfaceDragState,
    movement: { dx: number; dy: number }
  ) {
    commitSingleDragMovement(drag, movement);
    const primaryId = drag.kind === "selectorIcon" ? "complication" : drag.snapId;
    const companions = dragMovementIds(drag).filter((id) => id !== primaryId);
    if (companions.length > 0) {
      setDesign((current) => moveLinkedSelectionIds(current, companions, movement));
    }
  }

  function flushPendingDragFrame() {
    pointerControllerRef.current?.flush();
  }

  function scheduleDragMovement(pending: PendingWatchfaceDrag) {
    pointerControllerRef.current?.schedule(pending);
  }

  dragPaintCallbackRef.current = (pending) => {
    if (dragRef.current === pending.drag) {
      previewDragMovement(pending.drag, pending.point, pending.bypassSnap);
    }
  };

  function handlePointerMove(event: React.PointerEvent<Element>) {
    if (previewMode === "aod") {
      setHoveredId(null);
      return;
    }
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const pointer = coalesced?.[coalesced.length - 1] ?? event;
    const point = toResolutionPoint(pointer);
    if (!point) return;
    if (marqueeRef.current) {
      drawMarqueeSelection(point);
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      const liveHit = editorLayerAtPoint(layers, point.x, point.y);
      const backgroundHit = backgroundElementAtPoint(
        backgroundElements,
        point.x * (BACKGROUND_SPACE / previewWidth),
        point.y * (BACKGROUND_SPACE / previewHeight)
      );
      setHoveredId(
        backgroundContext && backgroundHit
          ? `bgel:${backgroundHit.id}`
          : liveHit?.id ?? (backgroundHit ? `bgel:${backgroundHit.id}` : null)
      );
      return;
    }
    if (isSpriteTransformDrag(drag)) {
      previewSpriteTransform(drag, point, event.shiftKey, event.altKey);
      return;
    }
    scheduleDragMovement({ drag, point, bypassSnap: event.altKey });
  }

  function handlePointerEnd(event: React.PointerEvent<Element>) {
    if (marqueeRef.current) {
      if (event.type === "pointerup") {
        const point = toResolutionPoint(event);
        if (point) drawMarqueeSelection(point);
      }
      const snapshot = marqueeRef.current.snapshot;
      const context = overlayCanvasRef.current?.getContext("2d");
      if (snapshot && context) context.putImageData(snapshot, 0, 0);
      finishMarqueeSelection();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      if (isSpriteTransformDrag(drag)) {
        if (event.type === "pointerup") {
          const point = toResolutionPoint(event);
          if (point) previewSpriteTransform(drag, point, event.shiftKey, event.altKey);
        }
        const committed = commitSpriteTransform(drag);
        if (!committed) hideDragVisual();
        dragRef.current = null;
        setSpriteTransformDraft(null);
        clearSnapGuides();
        endDesignTransaction();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
      if (event.type === "pointerup") {
        const point = toResolutionPoint(event);
        if (point) {
          pointerControllerRef.current?.schedule({
            drag,
            point,
            bypassSnap: event.altKey
          });
        }
      }
      flushPendingDragFrame();
      const movement = dragVisualRef.current?.drag === drag
        ? dragVisualRef.current.movement
        : { dx: 0, dy: 0 };
      if (movement.dx !== 0 || movement.dy !== 0) {
        const commitId = ++dragCommitIdRef.current;
        if (dragVisualRef.current?.drag === drag) {
          dragVisualRef.current.awaitingCommitId = commitId;
        }
        commitDragMovement(drag, movement);
      } else {
        hideDragVisual();
      }
      dragRef.current = null;
      clearSnapGuides();
      endDesignTransaction();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function patchDesign(partial: Partial<CorosWatchfaceDesignState>) {
    setDesign((prev) => ({ ...prev, ...partial }));
  }

  function setBackgroundArtwork(
    artwork: CorosWatchfaceDesignState["artwork"]
  ) {
    setDesign((prev) => {
      const configAssetOverrides = { ...(prev.configAssetOverrides ?? {}) };
      // Background replacements from the former duplicate template-asset row
      // are now owned by the single Artwork → Background layer.
      delete configAssetOverrides["config:background_icon"];
      return {
        ...prev,
        artwork,
        artworkVisible: artwork ? true : prev.artworkVisible,
        ...(artwork ? { zoom: 1 } : {}),
        configAssetOverrides
      };
    });
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

  function setBatteryIconVisible(visible: boolean) {
    setDesign((prev) => ({
      ...prev,
      layerVisibility: {
        ...prev.layerVisibility,
        batteryIcon: visible
      },
      configAssetOverrides: {
        ...(prev.configAssetOverrides ?? {}),
        "config:battery_icon": {
          ...(prev.configAssetOverrides?.["config:battery_icon"] ?? {}),
          enabled: visible
        }
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
    const editorId = separatorId === "colon" ? "staticColon" : "staticDateSlash";
    const { x, y, ...otherPatch } = patch;
    const safePatch = isPositionLocked(editorId)
      ? otherPatch
      : {
          ...otherPatch,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {})
        };
    setDesign((prev) => {
      const next: CorosWatchfaceDesignState = {
        ...prev,
        staticSeparators: {
          ...prev.staticSeparators,
          [separatorId]: {
            ...prev.staticSeparators[separatorId],
            ...safePatch
          }
        }
      };
      if (safePatch.enabled === true) {
        const configAssetId = separatorId === "colon"
          ? "config:colon_icon"
          : "config:arc_cut_icon";
        next.configAssetOverrides = {
          ...(prev.configAssetOverrides ?? {}),
          [configAssetId]: {
            ...(prev.configAssetOverrides?.[configAssetId] ?? {}),
            enabled: false
          }
        };
      }
      return next;
    });
  }

  function updateConfigAsset(
    reference: WatchfaceConfigAssetReference,
    patch: NonNullable<CorosWatchfaceDesignState["configAssetOverrides"]>[string]
  ) {
    setDesign((prev) => {
      const current = prev.configAssetOverrides?.[reference.id] ?? {};
      const nextDesign: CorosWatchfaceDesignState = {
        ...prev,
        configAssetOverrides: {
          ...(prev.configAssetOverrides ?? {}),
          [reference.id]: { ...current, ...patch }
        }
      };
      if (
        reference.id === "config:colon_icon" &&
        (patch.enabled === false || patch.replacement)
      ) {
        nextDesign.staticSeparators = {
          ...prev.staticSeparators,
          colon: { ...prev.staticSeparators.colon, enabled: false }
        };
      }
      return nextDesign;
    });
  }

  function restoreConfigAsset(reference: WatchfaceConfigAssetReference) {
    setDesign((prev) => {
      const configAssetOverrides = { ...(prev.configAssetOverrides ?? {}) };
      const current = configAssetOverrides[reference.id];
      if (!current) return prev;
      if (current.enabled === false) {
        configAssetOverrides[reference.id] = { enabled: false };
      } else {
        delete configAssetOverrides[reference.id];
      }
      return { ...prev, configAssetOverrides };
    });
  }

  async function chooseConfigAsset(reference: WatchfaceConfigAssetReference) {
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (!selected) return;
      updateConfigAsset(reference, {
        enabled: true,
        replacement: await downscaleArtwork(selected)
      });
      onNotice(`${reference.label} replaced for every supported resolution.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not replace the template image.");
    }
  }

  async function chooseBatterySpriteFolder() {
    try {
      const folder = await api.chooseCorosWatchfaceRasterFontFolder();
      if (!folder) return;
      const decoded = await Promise.all(folder.sprites.map(async (sprite) => {
        // The shared PNG-folder picker is recursive for custom fonts. Battery
        // imports are different: only numbered PNGs directly inside the
        // selected folder are states. Ignoring descendants prevents an
        // extracted watch-face/template below that folder from overwriting
        // 00.png–10.png with weekday or digit sprites.
        const relativePath = sprite.relativePath.replace(/\\/g, "/");
        if (relativePath.includes("/")) return null;
        const match = sprite.name.match(/^(\d{1,2})\.png$/i);
        if (!match) return null;
        const image = await loadStudioImage(sprite.dataUrl);
        return { state: String(Number(match[1])), sprite, image };
      }));
      const validSprites = decoded.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null
      );
      if (validSprites.length === 0) {
        throw new Error("Name battery sprites 00.png, 01.png, and so on.");
      }
      const canvasWidth = Math.max(
        ...validSprites.map(({ image }) => image.naturalWidth)
      );
      const canvasHeight = Math.max(
        ...validSprites.map(({ image }) => image.naturalHeight)
      );
      const entries = validSprites.map(({ state, sprite, image }) => {
        const centeredDataUrl =
          centerSpriteArtwork(image, canvasWidth, canvasHeight) ?? sprite.dataUrl;
        return [state, {
          dataUrl: centeredDataUrl,
          width: canvasWidth,
          height: canvasHeight
        }] as const;
      });
      const stateReplacements = Object.fromEntries(entries);
      setDesign((prev) => ({
        ...prev,
        configAssetOverrides: {
          ...(prev.configAssetOverrides ?? {}),
          "config:battery_icon": {
            ...(prev.configAssetOverrides?.["config:battery_icon"] ?? {}),
            enabled: true,
            stateReplacements
          }
        },
        layerVisibility: {
          ...prev.layerVisibility,
          batteryIcon: true
        }
      }));
      onNotice(
        `Imported ${Object.keys(stateReplacements).length} battery sprite states on a shared ${canvasWidth}×${canvasHeight}px canvas.`
      );
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not load the battery sprite folder.");
    }
  }

  function restoreBatteryIcon() {
    setDesign((prev) => {
      const configAssetOverrides = { ...(prev.configAssetOverrides ?? {}) };
      delete configAssetOverrides["config:battery_icon"];
      return { ...prev, configAssetOverrides };
    });
  }

  function setBatteryIconScale(scale: number) {
    setDesign((prev) => ({
      ...prev,
      configAssetOverrides: {
        ...(prev.configAssetOverrides ?? {}),
        "config:battery_icon": {
          ...(prev.configAssetOverrides?.["config:battery_icon"] ?? {}),
          enabled: true,
          scale: Math.max(0.1, Math.min(4, Number.isFinite(scale) ? scale : 1))
        }
      }
    }));
  }

  function updateAmPmIndicator(
    patch: Partial<NonNullable<CorosWatchfaceDesignState["ampmIndicator"]>>
  ) {
    const { x, y, ...otherPatch } = patch;
    const safePatch = isPositionLocked("ampm")
      ? otherPatch
      : {
          ...otherPatch,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {})
        };
    setDesign((prev) => ({
      ...prev,
      ampmIndicator: {
        enabled: prev.ampmIndicator?.enabled ?? false,
        x: prev.ampmIndicator?.x ?? 0,
        y: prev.ampmIndicator?.y ?? 0,
        scale: prev.ampmIndicator?.scale ?? 1,
        color: prev.ampmIndicator?.color,
        ...safePatch
      }
    }));
  }

  function updateWeatherIndicator(
    patch: Partial<NonNullable<CorosWatchfaceDesignState["weatherIndicator"]>>
  ) {
    const { x, y, ...otherPatch } = patch;
    const safePatch = isPositionLocked("weather")
      ? otherPatch
      : {
          ...otherPatch,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {})
        };
    setDesign((prev) => ({
      ...prev,
      weatherIndicator: {
        enabled: prev.weatherIndicator?.enabled ?? false,
        x: prev.weatherIndicator?.x ?? 0,
        y: prev.weatherIndicator?.y ?? 0,
        scale: prev.weatherIndicator?.scale ?? 1,
        ...safePatch
      }
    }));
  }

  function setMetricStyle(
    metricId: WatchfaceMetricId,
    patch: { color?: string; scale?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceDesignState["rasterFont"] }
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

  function setSelectableMetricStyle(
    patch: Partial<NonNullable<CorosWatchfaceDesignState["selectableMetricStyle"]>>
  ) {
    setDesign((prev) => ({
      ...prev,
      selectableMetricStyle: {
        scale: prev.selectableMetricStyle?.scale ?? 1,
        ...prev.selectableMetricStyle,
        ...patch
      }
    }));
  }

  function clearSelectableMetricColor() {
    setDesign((prev) => {
      if (!prev.selectableMetricStyle) return prev;
      const { color: _color, ...selectableMetricStyle } =
        prev.selectableMetricStyle;
      return { ...prev, selectableMetricStyle };
    });
  }

  function setTimeStyle(
    partId: WatchfaceTimePartId,
    patch: { color?: string; scale?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceDesignState["rasterFont"] }
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

  function convertAutoTimeToSeparate() {
    setDesign((prev) => {
      const timeStyles = { ...prev.timeStyles };
      const autoStyle = timeStyles.autoTime;
      delete timeStyles.autoTime;
      if (autoStyle) {
        timeStyles.hours = { ...autoStyle };
        timeStyles.minutes = { ...autoStyle };
      }
      const layoutOffsets = { ...prev.layoutOffsets };
      const autoOffset = layoutOffsets.autoTime;
      delete layoutOffsets.autoTime;
      if (autoOffset) {
        layoutOffsets.hours = { ...autoOffset };
        layoutOffsets.minutes = { ...autoOffset };
      }
      const layerVisibility = { ...prev.layerVisibility };
      const autoVisible = layerVisibility.autoTime;
      delete layerVisibility.autoTime;
      if (autoVisible !== undefined) {
        layerVisibility.hours = autoVisible;
        layerVisibility.minutes = autoVisible;
      }
      return {
        ...prev,
        separateAutoTime: true,
        timeStyles,
        layoutOffsets,
        layerVisibility
      };
    });
    setSelectedId("hours");
    setSelectedIds(["hours"]);
  }

  function setDateStyle(
    partId: WatchfaceDatePartId,
    patch: { scale?: number; fontFamily?: string; color?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceDesignState["rasterFont"] }
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
        setBackgroundArtwork(await downscaleArtwork(selected));
        onNotice("Artwork added. Select the Background layer to scale it.");
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not load artwork.");
    }
  }

  function removeSprite(spriteId: string) {
    const editorId = `sprite:${spriteId}`;
    if (isPositionLocked(editorId)) return;
    setDesign((prev) => syncLegacyWatchfaceGroups({
      ...prev,
      designSprites: (prev.designSprites ?? []).filter((s) => s.id !== spriteId),
      editorGroups: (prev.editorGroups ?? [])
        .map((group) => ({
          ...group,
          layerIds: group.layerIds.filter((candidate) => candidate !== editorId)
        }))
        .filter((group) => group.layerIds.length >= 2),
      lockedLayerIds: (prev.lockedLayerIds ?? []).filter(
        (candidate) => candidate !== editorId
      )
    }));
    setSelectedId("background");
    setSelectedIds(["background"]);
  }

  function updateSprite(
    spriteId: string,
    patch: Partial<CorosWatchfaceDesignSprite>
  ) {
    if (isPositionLocked(`sprite:${spriteId}`)) return;
    const { x, y, ...otherPatch } = patch;
    const boundedPatch = {
      ...otherPatch,
      ...(patch.width !== undefined
        ? { width: Math.max(1, Math.round(patch.width * 100) / 100) }
        : {}),
      ...(patch.height !== undefined
        ? { height: Math.max(1, Math.round(patch.height * 100) / 100) }
        : {}),
      ...(x !== undefined
        ? { x: Math.max(0, Math.min(previewWidth, Math.round(x))) }
        : {}),
      ...(y !== undefined
        ? {
            y: Math.max(
              0,
              Math.min(previewResolution?.height ?? previewWidth, Math.round(y))
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

  function enterSpriteCrop(sprite: CorosWatchfaceDesignSprite) {
    if (isPositionLocked(`sprite:${sprite.id}`)) return;
    if (cropSpriteId === sprite.id) return;
    cropOpeningRef.current = normalizeWatchfaceCrop(sprite.crop);
    beginDesignTransaction();
    setCropSpriteId(sprite.id);
  }

  function applySpriteCrop() {
    if (!cropSpriteId) return;
    setCropSpriteId(null);
    cropOpeningRef.current = undefined;
    endDesignTransaction();
  }

  function cancelSpriteCrop() {
    if (!cropSpriteId) return;
    const opening = cropOpeningRef.current;
    if (opening) updateSprite(cropSpriteId, { crop: opening });
    setCropSpriteId(null);
    cropOpeningRef.current = undefined;
    endDesignTransaction();
  }

  function handleCanvasDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (previewMode !== "current") return;
    const point = toResolutionPoint(event);
    const id = point ? editorItemAtPoint(point) : null;
    const layer = layers.find((candidate) => candidate.id === id);
    const sprite = layer?.spriteId
      ? (design.designSprites ?? []).find((candidate) => candidate.id === layer.spriteId)
      : undefined;
    if (sprite) {
      selectEditorItem(layer!.id);
      enterSpriteCrop(sprite);
      setPropertiesOpen(true);
    }
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
      const sprite: CorosWatchfaceDesignSprite = {
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
        opacity: 1,
        flipX: false,
        flipY: false,
        skewX: 0,
        skewY: 0,
        aspectLocked: true,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        origin: { x: 0.5, y: 0.5 },
        visible: true,
        tintColor: null
      };
      setDesign((prev) => ({
        ...prev,
        designSprites: [...(prev.designSprites ?? []), sprite]
      }));
      setSelectedId(`sprite:${sprite.id}`);
      setSelectedIds([`sprite:${sprite.id}`]);
      onNotice("Image added. Drag it on the face to position it.");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not add the image.");
    } finally {
      setLoadingSprite(false);
    }
  }

  async function renderExportPreview(): Promise<string> {
    if (!details || !backgroundDataUrl) {
      throw new Error("The editor is still loading. Try again in a moment.");
    }
    const archivePreview = document.createElement("canvas");
    archivePreview.width = 800;
    archivePreview.height = 800;
    // The archive/phone thumbnail always represents the current face, even if
    // the editor happens to be displaying the Always-on tab when previewed.
    const exportDetails = basePreviewDetails
      ? watchPreviewResolution
        ? detailsForPreviewResolution(
            basePreviewDetails,
            watchPreviewResolution.directory
          )
        : basePreviewDetails
      : details;
    await drawStudioPreview(
      archivePreview,
      backgroundDataUrl,
      exportDetails,
      studioOptionsForResolution(studioOptions, exportDetails),
      loadAssets
    );
    if (design.weatherIndicator?.enabled) {
      const url = await weatherPreviewDataUrl(
        previewWidth,
        design.weatherIndicator.color
      );
      if (url) {
        const image = await loadStudioImage(url);
        const context = archivePreview.getContext("2d");
        const scale = archivePreview.width / previewWidth;
        context?.drawImage(
          image,
          design.weatherIndicator.x * scale,
          design.weatherIndicator.y * scale,
          image.naturalWidth * design.weatherIndicator.scale * scale,
          image.naturalHeight * design.weatherIndicator.scale * scale
        );
      }
    }
    maskCanvasToCircle(archivePreview);
    return archivePreview.toDataURL("image/png");
  }

  async function renderExportBackground(): Promise<string> {
    if (!backgroundDataUrl) {
      throw new Error("The editor is still loading. Try again in a moment.");
    }
    const exportBackground = document.createElement("canvas");
    exportBackground.width = 800;
    exportBackground.height = 800;
    const context = exportBackground.getContext("2d", {
      colorSpace: "display-p3"
    });
    if (!context) {
      throw new Error("Could not render the circular watch background.");
    }
    context.drawImage(
      await loadStudioImage(backgroundDataUrl, false),
      0,
      0,
      exportBackground.width,
      exportBackground.height
    );
    maskCanvasToCircle(exportBackground);
    return exportBackground.toDataURL("image/png");
  }

  async function openExportPreview() {
    setPreviewingExport(true);
    try {
      setExportPreviewDataUrl(await renderExportPreview());
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not render the export preview.");
    } finally {
      setPreviewingExport(false);
    }
  }

  async function exportEditableProject() {
    if (!details || !backgroundDataUrl) {
      onError("The editor is still loading. Try again in a moment.");
      return;
    }
    setExporting(true);
    try {
      const name = projectName.trim() || "Custom watch face";
      const result = await api.exportCorosWatchfaceProject({
        sourceArchiveId: starterArchive.archiveId,
        name,
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
        design,
        previewDataUrl: await renderExportPreview()
      });
      if (result.saved) {
        onNotice(`Exported “${name}” as an editable website ZIP.`);
      }
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not export the editable project."
      );
    } finally {
      setExporting(false);
    }
  }

  async function createArchive(action: "publish" | "export" = "publish") {
    if (!details || !backgroundDataUrl) {
      onError("The editor is still loading. Try again in a moment.");
      return;
    }
    setCreating(true);
    try {
      const [composition, exportPreview, exportBackground] = await Promise.all([
        composeWatchfaceReplacements(details, design, loadAssets),
        renderExportPreview(),
        renderExportBackground()
      ]);
      const { assetReplacements, configOverrides, minWatchFaceVersion } =
        composition;
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl: exportBackground,
        previewDataUrl: exportPreview,
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
        ...(targetWatchModel ? { watchModel: targetWatchModel } : {}),
        ...(design.archiveWatchFaceVersion !== undefined
          ? { watchFaceVersion: design.archiveWatchFaceVersion }
          : {}),
        ...(assetReplacements.length > 0 ? { assetReplacements } : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {}),
        ...(minWatchFaceVersion !== undefined ? { minWatchFaceVersion } : {})
      });
      onArchiveCreated?.(archive);
      const name = projectName.trim() || "Custom watch face";
      if (action === "export") {
        const result = await api.exportCorosWatchfaceArchive({
          archiveId: archive.archiveId,
          name
        });
        if (result.saved) onNotice(`Exported final watch-face ZIP for “${name}”.`);
      } else {
        onPublish(archive, name);
        onNotice("Watch face prepared for COROS.");
      }
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
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
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
    const ids = new Set(selectedIds.filter((id) => !isMovementLockedForId(id)));
    const elementIds = new Set(
      [...ids].filter((id) => id.startsWith("bgel:")).map((id) => id.slice(5))
    );
    const spriteIds = new Set(
      layers
        .filter((layer) => ids.has(layer.id) && layer.kind === "customSprite")
        .map((layer) => layer.spriteId)
        .filter((id): id is string => Boolean(id))
    );
    if (elementIds.size === 0 && spriteIds.size === 0) return;
    const removedEditorIds = new Set([
      ...[...elementIds].map((id) => `bgel:${id}`),
      ...[...spriteIds].map((id) => `sprite:${id}`)
    ]);
    setDesign((current) => syncLegacyWatchfaceGroups({
      ...current,
      backgroundElements: (current.backgroundElements ?? []).filter(
        (element) => !elementIds.has(element.id)
      ),
      designSprites: (current.designSprites ?? []).filter(
        (sprite) => !spriteIds.has(sprite.id)
      ),
      editorGroups: (current.editorGroups ?? [])
        .map((group) => ({
          ...group,
          layerIds: group.layerIds.filter((id) => !removedEditorIds.has(id))
        }))
        .filter((group) => group.layerIds.length >= 2),
      lockedLayerIds: (current.lockedLayerIds ?? []).filter(
        (id) => !removedEditorIds.has(id)
      ),
      layerEffects: Object.fromEntries(
        Object.entries(current.layerEffects ?? {}).filter(
          ([id]) => !removedEditorIds.has(id)
        )
      )
    }));
    setSelectedId("background");
    setSelectedIds(["background"]);
  }

  function nudgeSingleSelected(dx: number, dy: number) {
    if (selectedElement) {
      updateElement(selectedElement.id, {
        x: Math.max(
          0,
          Math.min(
            BACKGROUND_SPACE,
            selectedElement.x + dx * (BACKGROUND_SPACE / previewWidth)
          )
        ),
        y: Math.max(
          0,
          Math.min(
            BACKGROUND_SPACE,
            selectedElement.y + dy * (BACKGROUND_SPACE / previewHeight)
          )
        )
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

  function nudgeSelected(dx: number, dy: number) {
    const linked = movableIdsForGesture(selectedId);
    if (linked.length === 0) return;
    const movement = linked.length > 1
      ? clampMovementForSelectionIds(linked, { dx, dy })
      : { dx, dy };
    setDesign((current) => moveLinkedSelectionIds(current, linked, movement));
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']")
      );
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (cropSpriteId && event.key === "Escape") {
        event.preventDefault();
        cancelSpriteCrop();
        return;
      }
      if (cropSpriteId && event.key === "Enter" && !editable) {
        event.preventDefault();
        applySpriteCrop();
        return;
      }

      if (command && key === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (editable) return;
      if (command && key === "g") {
        event.preventDefault();
        if (event.shiftKey) unlinkSelectedLayers();
        else linkSelectedLayers();
        return;
      }
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
        if (selectedIds.some((id) =>
          id.startsWith("bgel:") || layers.some(
            (layer) => layer.id === id && layer.kind === "customSprite"
          )
        )) {
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
        beginDesignTransaction();
        nudgeSelected(delta[0], delta[1]);
        endDesignTransaction();
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
    layoutLimits,
    cropSpriteId
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
            title={layersOpen ? "Hide layers" : "Show layers"}
            aria-pressed={layersOpen}
            onClick={() => setLayersOpen((open) => !open)}
          >
            <PanelLeft size={17} />
          </button>
          <button
            className="wf-icon-button wf-pane-toggle"
            type="button"
            aria-label="Toggle properties"
            title={propertiesOpen ? "Hide properties" : "Show properties"}
            aria-pressed={propertiesOpen}
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            <PanelRight size={17} />
          </button>
          <span className="wf-command-separator" aria-hidden="true" />
          <button className="wf-icon-button" type="button" disabled={!canUndo} aria-label="Undo" title="Undo" onClick={undo}>
            <Undo2 size={17} />
          </button>
          <button className="wf-icon-button" type="button" disabled={!canRedo} aria-label="Redo" title="Redo" onClick={redo}>
            <Redo2 size={17} />
          </button>
          <button className="secondary-button wf-save-button" type="button" disabled={saving || !isDirty} onClick={() => void saveProject()}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            Save
          </button>
          <button
            className="secondary-button wf-export-preview-button"
            type="button"
            disabled={previewingExport || creating || exporting || !backgroundDataUrl}
            onClick={() => void openExportPreview()}
          >
            {previewingExport ? <Loader2 className="spin" size={15} /> : <Eye size={15} />}
            Preview export
          </button>
          <button
            className="secondary-button wf-export-button"
            type="button"
            disabled={creating || exporting || !backgroundDataUrl}
            onClick={() => void exportEditableProject()}
          >
            {exporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
            Export editable ZIP
          </button>
          {showDevelopmentTools ? (
            <button
              className="secondary-button wf-export-button"
              type="button"
              disabled={creating || exporting || !backgroundDataUrl}
              onClick={() => void createArchive("export")}
            >
              {creating ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
              Export final ZIP
            </button>
          ) : null}
          <button className="primary-button wf-send-button" type="button" disabled={creating || exporting || !backgroundDataUrl} onClick={() => void createArchive()}>
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
              <span>
                {previewMode === "aod"
                  ? supportsAod
                    ? `${layers.length} always-on assets`
                    : "Uses the current face"
                  : `${layers.length + activeBackgroundElements.length} items`}
              </span>
            </div>
            {previewMode === "current" ? <div className="wf-add-menu">
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
            </div> : null}
          </div>
          {details ? (
            <ul className="wf-layer-list">
              {visibleEditorGroups.length > 0 ? (
                <li className="wf-layer-group">Groups</li>
              ) : null}
              {visibleEditorGroups.map((group) => {
                const locked = group.layerIds.some(isPositionLocked);
                const visible = editorGroupVisible(group.id);
                return (
                  <li className="wf-editor-group-tree" key={group.id}>
                    <button
                      type="button"
                      className={`watchface-layer-row${group.layerIds.every((id) => selectedIds.includes(id)) ? " is-selected" : ""}`}
                      onClick={() => {
                        setSelectedIds(group.layerIds);
                        setSelectedId(group.layerIds.at(-1) ?? "");
                      }}
                    >
                      <span className="wf-layer-icon"><Group size={14} /></span>
                      <span className="watchface-layer-name">{group.name}</span>
                      <span className="wf-layer-state">{group.layerIds.length}</span>
                    </button>
                    <button
                      type="button"
                      className="watchface-layer-lock"
                      aria-label={locked ? `Unlock ${group.name}` : `Lock ${group.name}`}
                      onClick={() => setEditorGroupLocked(group.id, !locked)}
                    >
                      {locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button
                      type="button"
                      className="watchface-layer-visibility"
                      disabled={group.layerIds.some(isPositionLocked)}
                      aria-label={visible ? `Hide ${group.name}` : `Show ${group.name}`}
                      onClick={() => toggleEditorGroupVisibility(group.id)}
                    >
                      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <ul>
                      {group.layerIds.map((id) => {
                        const layer = layers.find((candidate) => candidate.id === id);
                        const element = id.startsWith("bgel:")
                          ? backgroundElements.find((candidate) => `bgel:${candidate.id}` === id)
                          : undefined;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              aria-selected={selectedIds.includes(id)}
                              onClick={(event) => {
                                selectEditorItem(id, event.shiftKey || event.metaKey || event.ctrlKey);
                                setPropertiesOpen(true);
                              }}
                            >
                              <span className={`watchface-layer-name${
                                (layer && !layer.visible) || element?.visible === false
                                  ? " is-hidden"
                                  : ""
                              }`}>
                                {layer?.label ?? (element ? backgroundElementLabel(element) : id)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
              {groupLayersForDisplay(
                layers.filter((layer) => !groupedEditorLayerIds.has(layer.id))
              ).map(({ label: group, layers: groupedLayers }) => (
                <Fragment key={group}>
                  <li className="wf-layer-group">{group}</li>
                  {groupedLayers.map((layer) => (
                    <li key={layer.id}>
                      <button
                        type="button"
                        aria-selected={selectedIds.includes(layer.id)}
                        className={`watchface-layer-row${selectedIds.includes(layer.id) ? " is-selected" : ""}`}
                        onMouseEnter={() => setHoveredId(layer.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={(event) => {
                          selectEditorItem(layer.id, event.shiftKey || event.metaKey || event.ctrlKey);
                          setPropertiesOpen(true);
                        }}
                        onContextMenu={(event) => openLayerContextMenu(event, layer.id)}
                      >
                        <span className="wf-layer-icon" aria-hidden="true">{layerIcon(layer)}</span>
                        <span className={`watchface-layer-name${layer.visible ? "" : " is-hidden"}`}>{layer.label}</span>
                        {(design.linkedLayerGroups ?? []).some((group) => group.includes(layer.id)) ? (
                          <span className="wf-layer-link-state" title="Linked component" aria-label="Linked component">
                            <Link2 size={12} aria-hidden="true" />
                          </span>
                        ) : null}
                        {layer.configAssetReplaced ? <span className="wf-layer-state">Custom</span> : null}
                      </button>
                      {renderLayerPositionLockButton(layer.id, layer.label)}
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
                      {layer.kind === "background" && backgroundElements.some(
                        (element) => !groupedEditorLayerIds.has(`bgel:${element.id}`)
                      ) ? (
                        <ul className="watchface-bg-sublayers">
                          {backgroundElements
                            .filter((element) => !groupedEditorLayerIds.has(`bgel:${element.id}`))
                            .map((element) => (
                            <li key={element.id}>
                              <button
                                type="button"
                                aria-selected={selectedIds.includes(`bgel:${element.id}`)}
                                className={`watchface-layer-row${selectedIds.includes(`bgel:${element.id}`) ? " is-selected" : ""}`}
                                onMouseEnter={() => setHoveredId(`bgel:${element.id}`)}
                                onMouseLeave={() => setHoveredId(null)}
                                onClick={(event) => {
                                  selectEditorItem(`bgel:${element.id}`, event.shiftKey || event.metaKey || event.ctrlKey);
                                  setPropertiesOpen(true);
                                }}
                                onContextMenu={(event) => openLayerContextMenu(event, `bgel:${element.id}`)}
                              >
                                <span className="wf-layer-icon"><Square size={14} /></span>
                                <span className={`watchface-layer-name${element.visible === false ? " is-hidden" : ""}`}>{backgroundElementLabel(element)}</span>
                                {(design.linkedLayerGroups ?? []).some((group) => group.includes(`bgel:${element.id}`)) ? (
                                  <span className="wf-layer-link-state" title="Linked component" aria-label="Linked component">
                                    <Link2 size={12} aria-hidden="true" />
                                  </span>
                                ) : null}
                              </button>
                              {renderLayerPositionLockButton(
                                `bgel:${element.id}`,
                                backgroundElementLabel(element)
                              )}
                              <button type="button" className="watchface-layer-visibility" aria-label={`Remove ${backgroundElementLabel(element)}`} onClick={() => removeElement(element.id)}>
                                <Trash2 size={14} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          ) : (
            <div className="wf-pane-loading" role="status"><Loader2 className="spin" size={16} /> Reading template</div>
          )}
        </aside>

        <main className="watchface-editor-stage wf-stage">
          <div className="wf-stage-toolbar" aria-label="Preview controls">
            <div className="wf-zoom-control">
              <button type="button" aria-pressed={stageZoom === "fit"} onClick={() => setStageZoom("fit")}>Fit</button>
              <button type="button" aria-pressed={stageZoom === 1} onClick={() => setStageZoom(1)}>100%</button>
              <button type="button" aria-label="Zoom out" onClick={() => setStageZoom((zoom) => Math.max(0.6, (zoom === "fit" ? 1 : zoom) - 0.1))}>-</button>
              <button type="button" aria-label="Zoom in" onClick={() => setStageZoom((zoom) => Math.min(1.4, (zoom === "fit" ? 1 : zoom) + 0.1))}>+</button>
            </div>
            <div className="wf-preview-mode-switch" role="group" aria-label="Watch display preview">
              <button
                type="button"
                aria-pressed={previewMode === "current"}
                onClick={() => setPreviewMode("current")}
              >
                <SunMedium size={14} aria-hidden="true" /> Current
              </button>
              <button
                type="button"
                aria-pressed={previewMode === "aod"}
                title={supportsAod
                  ? "Preview and edit always-on assets"
                  : "This MIP template uses the current face when always on"}
                onClick={() => setPreviewMode("aod")}
              >
                <MoonStar size={14} aria-hidden="true" /> Always-on
              </button>
            </div>
            {previewDetails && previewDetails.resolutions.length > 1 ? (
              <label className="wf-preview-resolution">
                Watch preview
                <select
                  value={watchPreviewResolution?.directory ?? ""}
                  onChange={(event) => setWatchPreviewDirectory(event.target.value)}
                >
                  {[...previewDetails.resolutions]
                    .sort((left, right) => left.width - right.width)
                    .map((resolution) => (
                      <option key={resolution.directory} value={resolution.directory}>
                        {resolution.width === 240 &&
                        (targetWatchModel === "apex-4" || targetFirmwareType?.toUpperCase() === "COROS W541")
                          ? "APEX 4 42 mm · 240×240"
                          : resolution.width === 260 &&
                              (targetWatchModel === "apex-4" || targetFirmwareType?.toUpperCase() === "COROS W541")
                            ? "APEX 4 46 mm · 260×260"
                            : resolution.width === 800
                              ? "Master · 800×800"
                              : `${resolution.width}×${resolution.height}`}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {previewMode === "current" ? <div className="wf-placement-menu" ref={placementMenuRef}>
              <button
                className={`wf-placement-trigger${
                  placementPreferences.snapEnabled ||
                  placementPreferences.guidesVisible ||
                  placementPreferences.gridVisible
                    ? " is-active"
                    : ""
                }`}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={placementMenuOpen}
                aria-controls={`wf-placement-panel-${sessionId}`}
                onClick={() => setPlacementMenuOpen((open) => !open)}
              >
                <Magnet size={15} aria-hidden="true" />
                <span>Placement</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {placementMenuOpen ? (
                <div
                  id={`wf-placement-panel-${sessionId}`}
                  className="wf-placement-popover"
                  role="dialog"
                  aria-label="Placement tools"
                >
                  <div className="wf-placement-heading">
                    <strong>Placement tools</strong>
                    <span>Editor only</span>
                  </div>
                  <label className="watchface-studio-toggle">
                    <input
                      type="checkbox"
                      checked={placementPreferences.snapEnabled}
                      onChange={(event) => {
                        patchPlacementPreferences({ snapEnabled: event.target.checked });
                        if (!event.target.checked) clearSnapGuides();
                      }}
                    />
                    Snap while dragging
                  </label>
                  <label className="watchface-studio-toggle">
                    <input
                      type="checkbox"
                      checked={placementPreferences.guidesVisible}
                      onChange={(event) =>
                        patchPlacementPreferences({ guidesVisible: event.target.checked })
                      }
                    />
                    Show center and safe-area guides
                  </label>
                  <label className="field wf-placement-field">
                    Grid
                    <select
                      value={
                        placementPreferences.gridVisible
                          ? String(placementPreferences.gridStep)
                          : "off"
                      }
                      onChange={(event) => {
                        if (event.target.value === "off") {
                          patchPlacementPreferences({ gridVisible: false });
                          return;
                        }
                        patchPlacementPreferences({
                          gridVisible: true,
                          gridStep: Number(event.target.value) as WatchfaceGridStep
                        });
                      }}
                    >
                      <option value="off">Off</option>
                      <option value="4">4 px</option>
                      <option value="8">8 px</option>
                      <option value="16">16 px</option>
                      <option value="32">32 px</option>
                    </select>
                  </label>
                  <label className="field watchface-zoom-control wf-placement-safe-area">
                    Safe-area inset
                    <span>{placementPreferences.safeAreaInsetPercent}%</span>
                    <input
                      type="range"
                      min="0"
                      max="25"
                      step="1"
                      value={placementPreferences.safeAreaInsetPercent}
                      onChange={(event) =>
                        patchPlacementPreferences({
                          safeAreaInsetPercent: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <p className="wf-placement-note">
                    The safe area is a design aid, not a COROS firmware limit.
                    Hold Alt or Option while dragging to bypass snapping.
                  </p>
                </div>
              ) : null}
            </div> : (
              <span className="wf-aod-preview-label">
                <MoonStar size={14} aria-hidden="true" />
                {supportsAod ? "AODconfig.txt" : "Current face stays on"}
              </span>
            )}
          </div>
          {previewMode === "current" && selectedMovableIds.some((id) => !isPositionLocked(id)) ? (
            <div className="wf-contextual-align-bar" role="toolbar" aria-label="Align and distribute selection">
              <button type="button" title="Align left" aria-label="Align left" onClick={() => alignSelection("left")}><AlignHorizontalJustifyStart size={15} /></button>
              <button type="button" title="Align horizontal centers" aria-label="Align horizontal centers" onClick={() => alignSelection("center-x")}><AlignHorizontalJustifyCenter size={15} /></button>
              <button type="button" title="Align right" aria-label="Align right" onClick={() => alignSelection("right")}><AlignHorizontalJustifyEnd size={15} /></button>
              <span aria-hidden="true" />
              <button type="button" title="Align top" aria-label="Align top" onClick={() => alignSelection("top")}><AlignVerticalJustifyStart size={15} /></button>
              <button type="button" title="Align vertical centers" aria-label="Align vertical centers" onClick={() => alignSelection("center-y")}><AlignVerticalJustifyCenter size={15} /></button>
              <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignSelection("bottom")}><AlignVerticalJustifyEnd size={15} /></button>
              <span aria-hidden="true" />
              <button type="button" title="Distribute horizontal spacing" aria-label="Distribute horizontal spacing" disabled={selectedLayoutItems().length < 3} onClick={() => distributeSelection("horizontal")}><AlignHorizontalSpaceBetween size={15} /></button>
              <button type="button" title="Distribute vertical spacing" aria-label="Distribute vertical spacing" disabled={selectedLayoutItems().length < 3} onClick={() => distributeSelection("vertical")}><AlignVerticalSpaceBetween size={15} /></button>
              <span aria-hidden="true" />
              <button type="button" title="Group selection" aria-label="Group selection" disabled={selectedLayoutItems().length < 2} onClick={linkSelectedLayers}><Group size={15} /></button>
              <button type="button" title="Ungroup selection" aria-label="Ungroup selection" disabled={!selectionCanUnlink} onClick={unlinkSelectedLayers}><Ungroup size={15} /></button>
            </div>
          ) : null}
          <div
            ref={previewStackRef}
            className={`watchface-preview-stack watchface-editor-device${stageZoom === "fit" ? " is-fit" : ""}`}
            style={{ "--wf-stage-scale": stageZoom === "fit" ? 1 : stageZoom } as CSSProperties}
          >
            {previewMode === "current" && placementPreferences.guidesVisible ? (
              <>
                <div
                  className="wf-stage-ruler is-horizontal"
                  aria-label="Drag to create a vertical guide"
                  onPointerDown={(event) => startProjectGuide("x", event)}
                />
                <div
                  className="wf-stage-ruler is-vertical"
                  aria-label="Drag to create a horizontal guide"
                  onPointerDown={(event) => startProjectGuide("y", event)}
                />
                <div className="wf-project-guide-layer" aria-label="Project guides">
                  {(design.editorGuides ?? []).map((guide) => (
                    <button
                      key={guide.id}
                      type="button"
                      className={`wf-project-guide is-${guide.axis}`}
                      data-guide-id={guide.id}
                      style={guide.axis === "x"
                        ? { left: `${(guide.position / previewWidth) * 100}%` }
                        : { top: `${(guide.position / previewHeight) * 100}%` }}
                      aria-label="Drag guide; double-click to delete"
                      onPointerDown={(event) => startProjectGuide(guide.axis, event, guide.id)}
                      onDoubleClick={() => removeProjectGuide(guide.id)}
                    />
                  ))}
                </div>
              </>
            ) : null}
            <canvas ref={previewCanvasRef} className="watchface-studio-preview" width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
            <canvas
              ref={dragPreviewCanvasRef}
              className="watchface-preview-drag"
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              aria-hidden="true"
            />
            <canvas
              ref={overlayCanvasRef}
              className="watchface-preview-overlay"
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              tabIndex={0}
              role="img"
              aria-label={previewMode === "aod"
                ? "Always-on watch face preview"
                : "Interactive watch face preview. Select a layer, then use arrow keys to move it."}
              style={{
                cursor: selectedLayer?.capabilities.position &&
                    !isMovementLockedForId(selectedLayer.id)
                  ? "grab"
                  : "default"
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoveredId(null)}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
              onDoubleClick={handleCanvasDoubleClick}
              onContextMenu={handleCanvasContextMenu}
            />
            {spriteTransform && selectedSpriteCanTransform && previewMode === "current" ? (
              <svg
                className={`wf-sprite-transform${selectedSpriteCanTransform ? "" : " is-locked"}`}
                viewBox={`0 0 ${previewWidth} ${previewHeight}`}
                aria-hidden="true"
                onPointerDown={handleSpriteTransformPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
                onLostPointerCapture={handlePointerEnd}
              >
                <g
                  ref={transformGroupRef}
                  transform={`translate(${spriteTransform.x} ${spriteTransform.y}) rotate(${spriteTransform.rotation}) skewX(${normalizeWatchfaceSkew(multiFreeformCanTransform ? undefined : selectedSprite?.skewX)}) skewY(${normalizeWatchfaceSkew(multiFreeformCanTransform ? undefined : selectedSprite?.skewY)})`}
                >
                  <rect
                    className="wf-sprite-transform-box"
                    x={-spriteTransform.width / 2}
                    y={-spriteTransform.height / 2}
                    width={spriteTransform.width}
                    height={spriteTransform.height}
                  />
                  <line
                    className="wf-sprite-transform-stem"
                    x1="0"
                    y1={-spriteTransform.height / 2}
                    x2="0"
                    y2={-spriteTransform.height / 2 - 20}
                  />
                  <circle
                    className="wf-sprite-transform-handle wf-sprite-transform-rotate"
                    data-sprite-transform-control="rotate"
                    cx="0"
                    cy={-spriteTransform.height / 2 - 24}
                    r="5"
                  />
                  {([
                    ["nw", -1, -1],
                    ["n", 0, -1],
                    ["ne", 1, -1],
                    ["e", 1, 0],
                    ["se", 1, 1],
                    ["s", 0, 1],
                    ["sw", -1, 1],
                    ["w", -1, 0]
                  ] as const).map(([handle, x, y]) => (
                    <circle
                      key={handle}
                      className="wf-sprite-transform-handle"
                      data-sprite-transform-control={handle}
                      cx={(spriteTransform.width / 2) * x}
                      cy={(spriteTransform.height / 2) * y}
                      r="4.5"
                    />
                  ))}
                  <circle
                    className="wf-transform-origin-marker"
                    cx={(normalizeWatchfaceTransformOrigin(multiFreeformCanTransform ? undefined : selectedSprite?.origin).x - 0.5) * spriteTransform.width}
                    cy={(normalizeWatchfaceTransformOrigin(multiFreeformCanTransform ? undefined : selectedSprite?.origin).y - 0.5) * spriteTransform.height}
                    r="3.5"
                  />
                </g>
              </svg>
            ) : null}
          </div>
          {contextMenu ? (
            <div
              ref={contextMenuRef}
              className="wf-layer-context-menu"
              role="menu"
              aria-label="Component actions"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayoutItems().length < 2}
                onClick={linkSelectedLayers}
              >
                <Group size={15} aria-hidden="true" />
                <span>Group components</span>
              </button>
              {selectionHasLink ? (
                <button type="button" role="menuitem" disabled={!selectionCanUnlink} onClick={unlinkSelectedLayers}>
                  <Ungroup size={15} aria-hidden="true" />
                  <span>Ungroup components</span>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                disabled={selectedMovableIds.length === 0}
                onClick={selectionHasLockedPosition ? unlockSelectedLayers : lockSelectedLayers}
              >
                {selectionHasLockedPosition ? <Unlock size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
                <span>{selectionHasLockedPosition ? "Unlock position" : "Lock position"}</span>
              </button>
              <p>
                {selectedMovableIds.length >= 2
                  ? `${selectedMovableIds.length} components selected`
                  : selectedMovableIds.length === 1
                    ? "Lock this component to prevent accidental moves"
                    : "Shift-click to select another component"}
              </p>
            </div>
          ) : null}
          <div className="wf-stage-status" role="status">
            <span ref={snapStatusElementRef}>
              {selectedElement ? backgroundElementLabel(selectedElement) : selectedLayer?.label ?? "No selection"}
            </span>
            <span>{watchCoordinateWidth} × {watchCoordinateHeight} preview</span>
            <span>
              {previewMode === "aod"
                ? supportsAod ? "Always-on display" : "Always-on uses Current"
                : "Current display"}
            </span>
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
          <div className="watchface-inspector-group wf-archive-settings">
            <h3 className="wf-inspector-heading">Archive</h3>
            <label className="field">
              Watch-face version
              <input
                type="number"
                min="0"
                max="999"
                step="1"
                placeholder={`Auto (template v${starterArchive.watchFaceVersion})`}
                value={design.archiveWatchFaceVersion ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  patchDesign({
                    archiveWatchFaceVersion:
                      value === "" ? undefined : Number(value)
                  });
                }}
              />
            </label>
            <p className="wf-archive-note">
              Leave blank to preserve the template version and automatically
              raise it only when selected features require a newer version.
            </p>
          </div>
          {selectedElement ? renderElementInspector(selectedElement) : selectedLayer ? renderInspector(selectedLayer) : previewMode === "aod" ? (
            <div className="watchface-inspector-group wf-aod-empty-inspector">
              <MoonStar size={20} aria-hidden="true" />
              <strong>{supportsAod ? "No replaceable AOD assets" : "Current is already always on"}</strong>
              <p className="watchface-studio-summary">
                {supportsAod
                  ? "This template has an always-on layout, but it does not reference a standalone PNG that Studio can replace."
                  : "This MIP template has no separate AOD configuration. The Current face shown here is the same face the watch keeps visible."}
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      {(layersOpen || propertiesOpen) ? (
        <button className="wf-sheet-scrim is-open" type="button" aria-label="Close editor panel" onClick={() => { setLayersOpen(false); setPropertiesOpen(false); }} />
      ) : null}

      {exportPreviewDataUrl ? (
        <div className="wf-modal-backdrop" role="presentation">
          <section
            className="wf-modal wf-export-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wf-export-preview-title"
          >
            <header className="wf-export-preview-header">
              <div>
                <h2 id="wf-export-preview-title">Export preview</h2>
                <p>This is rendered by the same path used when you send the face to COROS.</p>
              </div>
              <span>{watchCoordinateWidth} × {watchCoordinateHeight}</span>
            </header>
            <div className="wf-export-preview-grid">
              <article>
                <div className="wf-export-preview-label">
                  <strong>COROS app</strong>
                  <span>Archive preview</span>
                </div>
                <div className="wf-export-phone-preview">
                  <img src={exportPreviewDataUrl} alt="COROS app archive preview" />
                </div>
                <p>The exact 800 × 800 <code>watchface_customize.png</code> included in the archive.</p>
              </article>
              <article>
                <div className="wf-export-preview-label">
                  <strong>On watch</strong>
                  <span>Circular display</span>
                </div>
                <div className="wf-export-watch-preview">
                  <img src={exportPreviewDataUrl} alt="Circular on-watch preview" />
                </div>
                <p>How the same rendered face is cropped on the selected watch display.</p>
              </article>
            </div>
            <div className="wf-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setExportPreviewDataUrl(null)}>
                Close
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={exporting}
                onClick={() => {
                  setExportPreviewDataUrl(null);
                  void exportEditableProject();
                }}
              >
                {exporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                Export editable ZIP
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={creating}
                onClick={() => {
                  setExportPreviewDataUrl(null);
                  void createArchive();
                }}
              >
                {creating ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                Send to COROS
              </button>
            </div>
          </section>
        </div>
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
    if (layer.kind === "configAsset") {
      return previewMode === "aod" ? "Always-on assets" : "Template assets";
    }
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

  function groupLayersForDisplay(
    sourceLayers: EditorLayer[]
  ): Array<{ label: string; layers: EditorLayer[] }> {
    const groups = new Map<string, EditorLayer[]>();
    for (const layer of sourceLayers) {
      const label = layerGroupLabel(layer);
      const group = groups.get(label);
      if (group) {
        group.push(layer);
      } else {
        groups.set(label, [layer]);
      }
    }
    return [...groups].map(([label, groupLayers]) => ({
      label,
      layers: groupLayers
    }));
  }

  function layerIcon(layer: EditorLayer) {
    if (
      layer.kind === "background" ||
      layer.kind === "customSprite" ||
      layer.kind === "configAsset"
    ) {
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
    if (layer.kind === "battery" || layer.kind === "batteryIcon") {
      return <Battery size={14} />;
    }
    return <Layers size={14} />;
  }

  function layerEffectKey(layerId: string): string {
    return previewMode === "aod" ? `aod:${layerId}` : layerId;
  }

  function writeLayerEffects(
    layerId: string,
    effects: CorosWatchfaceShadowEffect[]
  ) {
    if (isPositionLocked(layerId)) return;
    const key = layerEffectKey(layerId);
    setDesign((current) => {
      const binding = current.layerEffects?.[key];
      if (binding?.kind === "style") {
        return {
          ...current,
          effectStyles: (current.effectStyles ?? []).map((style) =>
            style.id === binding.styleId
              ? { ...style, effects: effects.map(normalizeWatchfaceShadowEffect) }
              : style
          )
        };
      }
      return {
        ...current,
        layerEffects: {
          ...(current.layerEffects ?? {}),
          [key]: localWatchfaceEffectBinding(effects)
        }
      };
    });
  }

  function bindLayerEffectStyle(layerId: string, styleId: string) {
    const key = layerEffectKey(layerId);
    setDesign((current) => {
      const layerEffects = { ...(current.layerEffects ?? {}) };
      if (styleId) layerEffects[key] = { kind: "style", styleId };
      else layerEffects[key] = localWatchfaceEffectBinding(
        resolveWatchfaceLayerEffects(
          current,
          layerId,
          previewMode === "aod" ? "aod" : "current"
        )
      );
      return { ...current, layerEffects };
    });
  }

  function detachLayerEffectStyle(layerId: string) {
    const effects = resolveWatchfaceLayerEffects(
      design,
      layerId,
      previewMode === "aod" ? "aod" : "current"
    );
    const key = layerEffectKey(layerId);
    setDesign((current) => ({
      ...current,
      layerEffects: {
        ...(current.layerEffects ?? {}),
        [key]: localWatchfaceEffectBinding(effects)
      }
    }));
  }

  function saveLayerEffectStyle(layerId: string) {
    const effects = resolveWatchfaceLayerEffects(
      design,
      layerId,
      previewMode === "aod" ? "aod" : "current"
    );
    if (effects.length === 0) return;
    const id = `effect-style-${Date.now().toString(36)}`;
    setDesign((current) => ({
      ...current,
      effectStyles: [
        ...(current.effectStyles ?? []),
        { id, name: `Shadow style ${(current.effectStyles?.length ?? 0) + 1}`, effects }
      ],
      layerEffects: {
        ...(current.layerEffects ?? {}),
        [layerEffectKey(layerId)]: { kind: "style", styleId: id }
      }
    }));
  }

  function renderEffectsInspector(layerId: string, warning?: string) {
    const scope = previewMode === "aod" ? "aod" : "current";
    const effects = resolveWatchfaceLayerEffects(design, layerId, scope);
    const binding = design.layerEffects?.[layerEffectKey(layerId)];
    const patchEffect = (id: string, patch: Partial<CorosWatchfaceShadowEffect>) =>
      writeLayerEffects(layerId, effects.map((effect) =>
        effect.id === id ? normalizeWatchfaceShadowEffect({ ...effect, ...patch }) : effect
      ));
    return (
      <div className="watchface-inspector-group wf-effects-inspector">
        <div className="wf-effects-heading">
          <div>
            <h3 className="wf-inspector-heading">Effects</h3>
            <span>{scope === "aod" ? "Always-on only" : "Current display only"}</span>
          </div>
          <button
            type="button"
            className="wf-icon-button"
            aria-label="Add outer shadow"
            title="Add outer shadow"
            onClick={() => writeLayerEffects(layerId, [
              ...effects,
              createWatchfaceShadowEffect()
            ])}
          >
            <Plus size={15} />
          </button>
        </div>
        <label className="field wf-effect-style-select">
          Effect style
          <select
            value={binding?.kind === "style" ? binding.styleId : ""}
            onChange={(event) => bindLayerEffectStyle(layerId, event.target.value)}
          >
            <option value="">Local effects</option>
            {(design.effectStyles ?? []).map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </label>
        <div className="wf-effect-style-actions">
          {binding?.kind === "style" ? (
            <button type="button" onClick={() => detachLayerEffectStyle(layerId)}>Detach style</button>
          ) : (
            <button type="button" disabled={effects.length === 0} onClick={() => saveLayerEffectStyle(layerId)}>Save as style</button>
          )}
        </div>
        {effects.map((effect, index) => (
          <section className="wf-shadow-card" key={effect.id}>
            <div className="wf-shadow-card-heading">
              <label className="watchface-studio-toggle">
                <input type="checkbox" checked={effect.enabled} onChange={(event) => patchEffect(effect.id, { enabled: event.target.checked })} />
                <span>{effect.kind === "inner-shadow" ? "Inner shadow" : "Drop shadow"}</span>
              </label>
              <div>
                <button type="button" aria-label="Duplicate shadow" title="Duplicate" onClick={() => writeLayerEffects(layerId, [
                  ...effects.slice(0, index + 1),
                  { ...effect, id: createWatchfaceShadowEffect(effect.kind).id },
                  ...effects.slice(index + 1)
                ])}><Copy size={13} /></button>
                <button type="button" aria-label="Move shadow up" disabled={index === 0} onClick={() => {
                  const next = [...effects];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  writeLayerEffects(layerId, next);
                }}>↑</button>
                <button type="button" aria-label="Move shadow down" disabled={index === effects.length - 1} onClick={() => {
                  const next = [...effects];
                  [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                  writeLayerEffects(layerId, next);
                }}>↓</button>
                <button type="button" aria-label="Remove shadow" title="Remove" onClick={() => writeLayerEffects(layerId, effects.filter((candidate) => candidate.id !== effect.id))}><Trash2 size={13} /></button>
              </div>
            </div>
            <label className="field">
              Type
              <select value={effect.kind} onChange={(event) => patchEffect(effect.id, { kind: event.target.value as CorosWatchfaceShadowEffect["kind"] })}>
                <option value="outer-shadow">Outer shadow</option>
                <option value="inner-shadow">Inner shadow</option>
              </select>
            </label>
            <label className="field">
              Color
              <span className="watchface-color-control">
                <input type="color" value={effect.color} onChange={(event) => patchEffect(effect.id, { color: event.target.value })} />
                <code>{effect.color}</code>
              </span>
            </label>
            {([
              ["Opacity", "opacity", 0, 100, 1, Math.round(effect.opacity * 100)],
              ["Blur", "blur", 0, 64, 1, effect.blur],
              ["Spread", "spread", -32, 64, 1, effect.spread],
              ["Distance", "distance", 0, 128, 1, effect.distance],
              ["Angle", "angle", 0, 359, 1, effect.angle]
            ] as const).map(([label, key, min, max, step, value]) => (
              <label className="field watchface-zoom-control" key={key}>
                {label} <span>{value}{key === "opacity" ? "%" : key === "angle" ? "°" : " px"}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  onChange={(event) => patchEffect(effect.id, {
                    [key]: key === "opacity"
                      ? Number(event.target.value) / 100
                      : Number(event.target.value)
                  })}
                />
              </label>
            ))}
          </section>
        ))}
        {effects.length === 0 ? (
          <p className="watchface-studio-summary">No effects. Add a shadow to build an ordered effect stack.</p>
        ) : null}
        {warning ? <p className="wf-effect-warning">{warning}</p> : null}
      </div>
    );
  }

  function toggleLayerVisibility(layer: EditorLayer) {
    if (isPositionLocked(layer.id)) return;
    if (layer.configAssetId) {
      const reference = configAssetsById.get(layer.configAssetId);
      if (reference) updateConfigAsset(reference, { enabled: !layer.visible });
    } else if (layer.metricId) {
      setMetricVisible(layer.metricId, !layer.visible);
    } else if (layer.weatherIndicator) {
      updateWeatherIndicator({ enabled: !layer.visible });
    } else if (layer.ampmIndicator) {
      updateAmPmIndicator({ enabled: !layer.visible });
    } else if (layer.staticSeparatorId) {
      updateStaticSeparator(layer.staticSeparatorId, { enabled: !layer.visible });
    } else if (layer.spriteId) {
      updateSprite(layer.spriteId, { visible: !layer.visible });
    } else if (layer.kind === "background") {
      patchDesign({ artworkVisible: !layer.visible });
    } else if (layer.kind === "batteryIcon") {
      setBatteryIconVisible(!layer.visible);
    } else if (layer.layoutGroupId) {
      setFirmwareLayerVisible(layer.layoutGroupId, !layer.visible);
    }
  }

  function renderConfigAssetInspector(reference: WatchfaceConfigAssetReference) {
    const override = design.configAssetOverrides?.[reference.id];
    const enabled = override?.enabled !== false;
    const artworkZoom = override?.scale ?? 1;
    const templatePreview = configAssetPreviews.get(reference.archivePath);
    const previewDataUrl = override?.replacement?.dataUrl ?? templatePreview?.dataUrl;
    const dimensions = override?.replacement
      ? `${override.replacement.width} × ${override.replacement.height} source`
      : reference.source
        ? `${reference.source.width} × ${reference.source.height}px`
        : "Source file unavailable";
    const deviceResolution = watchPreviewResolution ?? previewResolution;
    const center = parseConfigPos(deviceResolution?.config.time_center_pos);
    const centerLabel = center && deviceResolution
      ? `Centered at ${center.x}, ${center.y} on the ${deviceResolution.width}px preview.`
      : "Centered on the watch face.";
    const onWatchBehavior = (() => {
      switch (reference.configKey) {
        case "time_center_polygon_icon1":
          return `${centerLabel} Fixed above the hour and minute hands.`;
        case "time_center_polygon_icon2":
          return `${centerLabel} Fixed above all analog hands.`;
        case "time_hour_icon":
          return `${centerLabel} Rotates as the analog hour hand.`;
        case "time_minute_icon":
          return `${centerLabel} Rotates as the analog minute hand.`;
        case "time_second_icon":
          return `${centerLabel} Rotates as the analog second hand.`;
        case "colon_icon":
          return "Placed automatically between the hour and minute digits.";
        case "control_colon_icon":
          return "Shown automatically between split values in the selected data slot.";
        case "watchface_thmb_icon":
          return "Archive thumbnail only; this image is not drawn on the watch face.";
        case "negative_sign_icon":
        case "control_negative_sign_icon":
          return "Shown only when the watch renders a negative value.";
        default:
          return reference.configKey.startsWith("control_")
            ? "Shown when this data type is active in the selectable watch slot."
            : null;
      }
    })();
    return (
      <div className="watchface-inspector-group wf-config-asset-inspector">
        <div className={`wf-config-asset-preview${enabled ? "" : " is-disabled"}`}>
          {previewDataUrl ? (
            <img src={previewDataUrl} alt={`${reference.label} preview`} />
          ) : (
            <Image size={24} aria-hidden="true" />
          )}
        </div>
        <div className="wf-config-asset-meta">
          <strong>{reference.label}</strong>
          <span>{dimensions}</span>
          <code>{reference.relativePath}</code>
          <code>[{reference.configKey}]</code>
        </div>
        {onWatchBehavior ? (
          <p className="watchface-studio-summary">{onWatchBehavior}</p>
        ) : null}
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              updateConfigAsset(reference, { enabled: event.target.checked })
            }
          />
          Use this config asset
        </label>
        <div className="wf-config-asset-actions">
          <button type="button" className="secondary-button" onClick={() => void chooseConfigAsset(reference)}>
            <ImagePlus size={15} /> {override?.replacement ? "Replace again" : "Replace image"}
          </button>
          {override?.replacement ? (
            <button type="button" className="secondary-button" onClick={() => restoreConfigAsset(reference)}>
              <RotateCcw size={15} /> Restore original
            </button>
          ) : null}
        </div>
        {override?.replacement ? (
          <>
            <label className="field watchface-zoom-control">
              Artwork zoom <span>{artworkZoom.toFixed(2)}×</span>
              <input
                type="range"
                min="0.1"
                max="4"
                step="0.01"
                value={artworkZoom}
                onChange={(event) =>
                  updateConfigAsset(reference, {
                    scale: Number(event.target.value)
                  })
                }
              />
            </label>
            <label className="watchface-inspector-field">
              <span>Precise zoom</span>
              <EditableNumberInput
                min="0.1"
                max="4"
                step="0.01"
                value={artworkZoom}
                fallback={1}
                onValueChange={(value) =>
                  updateConfigAsset(reference, {
                    scale: Math.max(0.1, Math.min(4, value))
                  })
                }
              />
            </label>
          </>
        ) : null}
        <p className="watchface-studio-summary">
          Parsed from {reference.scope === "aod" ? "AODconfig.txt" : "config.txt"}.
          Visibility changes only this key. Transparent padding is removed automatically. Artwork zoom enlarges and crops the image inside the firmware-required native canvas; it never changes the exported PNG dimensions. Other keys that share the original file are not altered.
        </p>
      </div>
    );
  }

  function renderInspector(layer: EditorLayer) {
    if (isPositionLocked(layer.id)) {
      return (
        <div className="watchface-inspector-group wf-locked-inspector">
          <Lock size={20} aria-hidden="true" />
          <strong>Layer locked</strong>
          <p className="watchface-studio-summary">
            Position, transforms, alignment, and appearance are protected.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLayerPositionLocked(layer.id, false)}
          >
            <Unlock size={15} /> Unlock layer
          </button>
        </div>
      );
    }
    if (layer.configAssetId) {
      const reference = configAssetsById.get(layer.configAssetId);
      return reference ? renderConfigAssetInspector(reference) : null;
    }

    if (layer.weatherIndicator) {
      return renderWeatherInspector();
    }

    if (layer.ampmIndicator) {
      return renderAmPmInspector();
    }

    if (layer.staticSeparatorId) {
      return <>{renderStaticSeparatorInspector(layer.staticSeparatorId)}{renderEffectsInspector(layer.id)}</>;
    }

    if (layer.kind === "background") {
      const backgroundOverride =
        design.configAssetOverrides?.["config:background_icon"];
      const backgroundArtwork = backgroundOverride?.replacement ?? design.artwork;
      const backgroundVisible = design.artworkVisible !== false;
      const backgroundColor = parseBackgroundColor(design.backgroundColor);
      return (
        <div className="watchface-inspector-group">
          <h3 className="wf-inspector-heading">Color</h3>
          <label className="field">
            Background color
            <span className="watchface-color-control">
              <input
                type="color"
                value={backgroundColor.hex}
                onChange={(event) =>
                  patchDesign({
                    backgroundColor: toRgbaColor(
                      event.target.value,
                      backgroundColor.isTransparent ? 1 : backgroundColor.alpha
                    )
                  })
                }
              />
              <code>{backgroundColor.isTransparent ? "none" : design.backgroundColor}</code>
            </span>
          </label>
          <label className="field watchface-zoom-control">
            Opacity <span>{Math.round(backgroundColor.alpha * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              disabled={backgroundColor.isTransparent}
              value={Math.round(backgroundColor.alpha * 100)}
              onChange={(event) =>
                patchDesign({
                  backgroundColor: toRgbaColor(
                    backgroundColor.hex,
                    Number(event.target.value) / 100
                  )
                })
              }
            />
          </label>
          <button
            className="watchface-color-none"
            type="button"
            disabled={backgroundColor.isTransparent}
            onClick={() => patchDesign({ backgroundColor: "transparent" })}
          >
            No background color
          </button>
          <h3 className="wf-inspector-heading">Artwork</h3>
          <div
            className={`wf-config-asset-preview wf-background-asset-preview${
              backgroundVisible ? "" : " is-disabled"
            }`}
          >
            {backgroundArtwork ? (
              <img src={backgroundArtwork.dataUrl} alt="Background artwork preview" />
            ) : (
              <Image size={28} aria-hidden="true" />
            )}
          </div>
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={backgroundVisible}
              disabled={!backgroundArtwork}
              onChange={(event) =>
                patchDesign({ artworkVisible: event.target.checked })
              }
            />
            Show background artwork
          </label>
          <button className="secondary-button" type="button" onClick={() => void chooseArtwork()}>
            <ImagePlus size={15} /> {backgroundArtwork ? "Replace artwork" : "Add artwork"}
          </button>
          {backgroundArtwork ? (
            <>
              <label className="field watchface-zoom-control">
                Artwork scale <span>{design.zoom.toFixed(2)}×</span>
                <input type="range" min="1" max="2.25" step="0.01" value={design.zoom} onChange={(e) => patchDesign({ zoom: Number(e.target.value) })} />
              </label>
              <button className="secondary-button" type="button" onClick={() => setBackgroundArtwork(null)}>
                <Trash2 size={15} /> Remove artwork
              </button>
            </>
          ) : null}
          {backgroundArtwork ? renderEffectsInspector("background") : null}
        </div>
      );
    }

    if (layer.kind === "batteryIcon") {
      const stateReplacements = design.configAssetOverrides?.["config:battery_icon"]?.stateReplacements;
      const stateCount = Object.keys(stateReplacements ?? {}).length;
      const iconScale = design.configAssetOverrides?.["config:battery_icon"]?.scale ?? 1;
      return (
        <div className="watchface-inspector-group">
          {renderLayerVisibilityToggle(layer)}
          <h3 className="wf-inspector-heading">Battery sprite folder</h3>
          <div className="wf-config-asset-actions">
            <button className="secondary-button" type="button" onClick={() => void chooseBatterySpriteFolder()}>
              <ImagePlus size={15} /> {stateCount > 0 ? "Replace sprite folder" : "Import sprite folder"}
            </button>
            {stateCount > 0 ? (
              <button className="secondary-button" type="button" onClick={restoreBatteryIcon}>
                <RotateCcw size={15} /> Restore template icon
              </button>
            ) : null}
          </div>
          <p className="watchface-studio-summary">
            Import PNGs named 00.png, 01.png, and so on. Each file replaces its matching battery charge state. Icon scale resizes every state bitmap; X and Y are exported directly as the bitmap position.
          </p>
          <label className="watchface-inspector-field">
            <span>Icon scale</span>
            <EditableNumberInput
              min="0.1"
              max="4"
              step="0.01"
              value={iconScale}
              fallback={1}
              onValueChange={setBatteryIconScale}
            />
          </label>
          {renderPositionReadout(layer)}
          {renderEffectsInspector(
            layer.id,
            "Native battery states keep their firmware slot dimensions. Shadows are clipped unless the artwork is a Studio-owned sprite folder."
          )}
        </div>
      );
    }

    if (layer.kind === "battery") {
      const style = design.metricStyles?.battery;
      return (
        <div className="watchface-inspector-group">
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(event) =>
                setMetricVisible("battery", event.target.checked)
              }
            />
            Show this metric
          </label>
          <h3 className="wf-inspector-heading">Battery digit sprites</h3>
          <LocalFontPicker
            api={api}
            label="Digit font"
            value={style?.fontFamily ?? design.fontFamily}
            emptyLabel="Keep template digits"
            onChange={(fontFamily) =>
              setMetricStyle("battery", {
                fontFamily,
                rasterFont: undefined
              })
            }
            rasterFont={design.rasterFont}
            onRasterFontChange={setRasterFont}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
            onLetterSpacingChange={(letterSpacing) =>
              setMetricStyle("battery", { letterSpacing })
            }
          />
          <CustomPngFontPanel
            api={api}
            rasterFont={design.rasterFont}
            componentRasterFont={style?.rasterFont}
            componentLabel="Battery data"
            onActivate={() => setMetricStyle("battery", { fontFamily: "" })}
            onRasterFontChange={setRasterFont}
            onComponentRasterFontChange={(rasterFont) =>
              setMetricStyle("battery", { rasterFont })
            }
          />
          <label className="field">
            Tint
            <span className="watchface-color-control">
              <input
                type="color"
                value={style?.color ?? design.digitColor}
                onChange={(event) =>
                  setMetricStyle("battery", { color: event.target.value })
                }
              />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearMetricColor("battery")}
              >
                Remove tint
              </button>
            </span>
          </label>
          <label className="field">
            Sprite scale
            <EditableNumberInput
              min="0.01"
              step="0.01"
              value={style?.scale ?? 1}
              fallback={1}
              onValueChange={(value) =>
                setMetricStyle("battery", {
                  scale: Math.max(0.01, value)
                })
              }
            />
          </label>
          {renderPositionReadout(layer)}
          {renderEffectsInspector(layer.id)}
        </div>
      );
    }

    if (layer.timePartId) {
      const style = design.timeStyles?.[layer.timePartId];
      return (
        <div className="watchface-inspector-group">
          {renderLayerVisibilityToggle(layer)}
          {layer.timePartId === "autoTime" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={convertAutoTimeToSeparate}
            >
              Separate hours and minutes
            </button>
          ) : null}
          <LocalFontPicker
            api={api}
            label="Digit font"
            value={style?.fontFamily ?? design.fontFamily}
            emptyLabel="Keep template digits"
            onChange={(fontFamily) =>
              setTimeStyle(layer.timePartId!, { fontFamily })
            }
            rasterFont={design.rasterFont}
            onRasterFontChange={setRasterFont}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
            onLetterSpacingChange={(letterSpacing) =>
              setTimeStyle(layer.timePartId!, { letterSpacing })
            }
          />
          <CustomPngFontPanel
            api={api}
            rasterFont={design.rasterFont}
            componentRasterFont={style?.rasterFont}
            componentLabel={layer.label}
            onActivate={() => setTimeStyle(layer.timePartId!, { fontFamily: "" })}
            onRasterFontChange={setRasterFont}
            onComponentRasterFontChange={(rasterFont) => setTimeStyle(layer.timePartId!, { rasterFont })}
          />
          <label className="field">
            Digit tint
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setTimeStyle(layer.timePartId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearTimeColor(layer.timePartId!)}
              >
                Remove tint
              </button>
            </span>
          </label>
          <label className="field">
            Sprite scale
            <EditableNumberInput min="0.01" step="0.01" value={style?.scale ?? 1} fallback={1} onValueChange={(value) => setTimeStyle(layer.timePartId!, { scale: Math.max(0.01, value) })} />
          </label>
          {renderPositionReadout(layer)}
          {renderEffectsInspector(layer.id)}
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
            onRasterFontChange={setRasterFont}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
            onLetterSpacingChange={(letterSpacing) =>
              setMetricStyle(layer.metricId!, { letterSpacing })
            }
          />
          <CustomPngFontPanel
            api={api}
            rasterFont={design.rasterFont}
            componentRasterFont={style?.rasterFont}
            componentLabel={layer.label}
            onActivate={() => setMetricStyle(layer.metricId!, { fontFamily: "" })}
            onRasterFontChange={setRasterFont}
            onComponentRasterFontChange={(rasterFont) => setMetricStyle(layer.metricId!, { rasterFont })}
          />
          <label className="field">
            Tint
            <span className="watchface-color-control">
              <input type="color" value={style?.color ?? design.digitColor} onChange={(e) => setMetricStyle(layer.metricId!, { color: e.target.value })} />
              <code>{style?.color ?? design.digitColor}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!style?.color}
                onClick={() => clearMetricColor(layer.metricId!)}
              >
                Remove tint
              </button>
            </span>
          </label>
          <label className="field">
            Sprite scale
            <EditableNumberInput min="0.01" step="0.01" value={style?.scale ?? 1} fallback={1} onValueChange={(value) => setMetricStyle(layer.metricId!, { scale: Math.max(0.01, value) })} />
          </label>
          {renderPositionReadout(layer)}
          {renderEffectsInspector(layer.id)}
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
            onRasterFontChange={setRasterFont}
            typography={{
              fontWeight: design.fontWeight ?? 400,
              fontStyle: design.fontStyle ?? "normal",
              letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0
            }}
            onTypographyChange={(typography) => patchDesign(typography)}
            onLetterSpacingChange={(letterSpacing) =>
              setDateStyle(partId, { letterSpacing })
            }
          />
          <CustomPngFontPanel
            api={api}
            rasterFont={design.rasterFont}
            componentRasterFont={style?.rasterFont}
            componentLabel={layer.label}
            onActivate={() => setDateStyle(partId, { fontFamily: "" })}
            onRasterFontChange={setRasterFont}
            onComponentRasterFontChange={(rasterFont) => setDateStyle(partId, { rasterFont })}
          />
          <label className="field">
            Tint
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
                Remove tint
              </button>
            </span>
          </label>
          <label className="field">
            Artwork zoom
            <EditableNumberInput
              min="0.01"
              step="0.01"
              value={scale}
              fallback={1}
              onValueChange={(value) => setDateStyle(partId, { scale: Math.max(0.01, value) })}
            />
            <span className="watchface-studio-summary">
              Zooms and crops inside the component's fixed COROS canvas.
            </span>
          </label>
          {renderPositionReadout(layer)}
          {renderEffectsInspector(layer.id)}
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
            Scale <span>{(sprite.scale * 100).toFixed(0)}%</span>
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
          <div className="watchface-sprite-transform-fields" aria-label="Image transform">
            <label>
              Width
              <EditableNumberInput
                min="1"
                step="1"
                value={toWatchCoordinate(sprite.width * sprite.scale)}
                fallback={1}
                onValueChange={(value) =>
                  updateSprite(sprite.id, {
                    width: fromWatchCoordinate(Math.max(1, value)) / sprite.scale,
                    ...(sprite.aspectLocked !== false
                      ? {
                          height: (fromWatchCoordinate(Math.max(1, value)) / sprite.scale) *
                            (sprite.height / sprite.width)
                        }
                      : {})
                  })
                }
              />
            </label>
            <label>
              Height
              <EditableNumberInput
                min="1"
                step="1"
                value={toWatchCoordinate(sprite.height * sprite.scale)}
                fallback={1}
                onValueChange={(value) =>
                  updateSprite(sprite.id, {
                    height: fromWatchCoordinate(Math.max(1, value)) / sprite.scale,
                    ...(sprite.aspectLocked !== false
                      ? {
                          width: (fromWatchCoordinate(Math.max(1, value)) / sprite.scale) *
                            (sprite.width / sprite.height)
                        }
                      : {})
                  })
                }
              />
            </label>
            <label>
              Rotation
              <EditableNumberInput
                min="0"
                max="360"
                step="1"
                value={Math.round(sprite.rotation)}
                fallback={0}
                onValueChange={(value) =>
                  updateSprite(sprite.id, { rotation: normalizeWatchfaceRotation(value) })
                }
              />
            </label>
            <label>
              Skew X
              <EditableNumberInput
                min="-80"
                max="80"
                step="1"
                value={normalizeWatchfaceSkew(sprite.skewX)}
                fallback={0}
                onValueChange={(value) => updateSprite(sprite.id, { skewX: normalizeWatchfaceSkew(value) })}
              />
            </label>
            <label>
              Skew Y
              <EditableNumberInput
                min="-80"
                max="80"
                step="1"
                value={normalizeWatchfaceSkew(sprite.skewY)}
                fallback={0}
                onValueChange={(value) => updateSprite(sprite.id, { skewY: normalizeWatchfaceSkew(value) })}
              />
            </label>
          </div>
          <label className="field watchface-zoom-control">
            Opacity <span>{Math.round(normalizeWatchfaceOpacity(sprite.opacity) * 100)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(normalizeWatchfaceOpacity(sprite.opacity) * 100)}
              onChange={(event) => updateSprite(sprite.id, {
                opacity: normalizeWatchfaceOpacity(Number(event.target.value) / 100)
              })}
            />
          </label>
          <div className="wf-image-transform-actions" role="group" aria-label="Image transform options">
            <button type="button" aria-pressed={sprite.flipX === true} onClick={() => updateSprite(sprite.id, { flipX: !sprite.flipX })}>
              <FlipHorizontal2 size={14} /> Flip X
            </button>
            <button type="button" aria-pressed={sprite.flipY === true} onClick={() => updateSprite(sprite.id, { flipY: !sprite.flipY })}>
              <FlipVertical2 size={14} /> Flip Y
            </button>
            <label className="watchface-studio-toggle">
              <input type="checkbox" checked={sprite.aspectLocked !== false} onChange={(event) => updateSprite(sprite.id, { aspectLocked: event.target.checked })} />
              Lock ratio
            </label>
          </div>
          <div className="wf-transform-origin-controls">
            <label className="field">
              Transform origin
              <select
                value={(() => {
                  const origin = normalizeWatchfaceTransformOrigin(sprite.origin);
                  return `${origin.x},${origin.y}`;
                })()}
                onChange={(event) => {
                  const [x, y] = event.target.value.split(",").map(Number);
                  updateSprite(sprite.id, { origin: normalizeWatchfaceTransformOrigin({ x, y }) });
                }}
              >
                <option value="0,0">Top left</option>
                <option value="0.5,0">Top center</option>
                <option value="1,0">Top right</option>
                <option value="0,0.5">Center left</option>
                <option value="0.5,0.5">Center</option>
                <option value="1,0.5">Center right</option>
                <option value="0,1">Bottom left</option>
                <option value="0.5,1">Bottom center</option>
                <option value="1,1">Bottom right</option>
              </select>
            </label>
            <div className="watchface-sprite-transform-fields">
              <label>
                Origin X %
                <EditableNumberInput
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(normalizeWatchfaceTransformOrigin(sprite.origin).x * 100)}
                  fallback={50}
                  onValueChange={(value) => updateSprite(sprite.id, {
                    origin: normalizeWatchfaceTransformOrigin({
                      ...normalizeWatchfaceTransformOrigin(sprite.origin),
                      x: value / 100
                    })
                  })}
                />
              </label>
              <label>
                Origin Y %
                <EditableNumberInput
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(normalizeWatchfaceTransformOrigin(sprite.origin).y * 100)}
                  fallback={50}
                  onValueChange={(value) => updateSprite(sprite.id, {
                    origin: normalizeWatchfaceTransformOrigin({
                      ...normalizeWatchfaceTransformOrigin(sprite.origin),
                      y: value / 100
                    })
                  })}
                />
              </label>
            </div>
          </div>
          <div className={`wf-crop-controls${cropSpriteId === sprite.id ? " is-active" : ""}`}>
            <div className="wf-crop-heading">
              <strong>Crop</strong>
              {cropSpriteId === sprite.id ? <span>Enter applies · Esc cancels</span> : null}
            </div>
            {cropSpriteId === sprite.id ? (
              <>
                <div className="watchface-sprite-transform-fields">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {key[0]!.toUpperCase() + key.slice(1)} %
                      <EditableNumberInput
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(normalizeWatchfaceCrop(sprite.crop)[key] * 100)}
                        fallback={key === "width" || key === "height" ? 100 : 0}
                        onValueChange={(value) => updateSprite(sprite.id, {
                          crop: normalizeWatchfaceCrop({
                            ...normalizeWatchfaceCrop(sprite.crop),
                            [key]: value / 100
                          })
                        })}
                      />
                    </label>
                  ))}
                </div>
                <div className="wf-crop-actions">
                  <button type="button" className="primary-button" onClick={applySpriteCrop}>Apply crop</button>
                  <button type="button" className="secondary-button" onClick={cancelSpriteCrop}>Cancel</button>
                  <button type="button" onClick={() => updateSprite(sprite.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button>
                </div>
              </>
            ) : (
              <div className="wf-crop-actions">
                <button type="button" className="secondary-button" onClick={() => enterSpriteCrop(sprite)}><Crop size={14} /> Crop image</button>
                <button type="button" disabled={JSON.stringify(normalizeWatchfaceCrop(sprite.crop)) === JSON.stringify({ x: 0, y: 0, width: 1, height: 1 })} onClick={() => updateSprite(sprite.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button>
              </div>
            )}
          </div>
          <p className="watchface-studio-summary">
            Drag any edge or corner to resize. Shift inverts ratio locking, Option resizes from center, and Shift snaps rotation to 15°.
          </p>
          {renderPositionPanel(layer.id, "Watch screen position", <>
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
          </>)}
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
                <button
                  type="button"
                  className="watchface-color-none"
                  onClick={() => updateSprite(sprite.id, { tintColor: null })}
                >
                  Remove tint
                </button>
              </span>
            </label>
          ) : null}
          {renderEffectsInspector(layer.id)}
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
            Tint
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
                Remove tint
              </button>
            </span>
          </label>
        ) : null}
        {renderPositionReadout(layer)}
        {layer.capabilities.effects
          ? renderEffectsInspector(
              layer.id,
              layer.id === "batteryIcon"
                ? "This native battery slot keeps its firmware dimensions; shadows are clipped to the slot when padding cannot be represented safely."
                : undefined
            )
          : null}
      </div>
    );
  }

  function renderComplicationPicker() {
    const available = getAvailableComplications(previewDetails ?? details!);
    if (available.length === 0) {
      return null;
    }
    const controlBatteryEnabled = design.controlBatteryEnabled !== false;
    const previewChoices = available.filter(
      (complication) => complication.id !== "battery" || controlBatteryEnabled
    );
    const selected = previewChoices.some(
      (complication) => complication.id === design.previewComplication
    )
      ? design.previewComplication
      : previewChoices[0]?.id ?? "";
    const selectedComplication = available.find(
      (complication) => complication.id === selected
    );
    const controlColonReference = configAssetsById.get("config:control_colon_icon");
    const controlColonEnabled =
      design.configAssetOverrides?.["config:control_colon_icon"]?.enabled !== false;
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
      if (isMovementLockedForId("complication")) return;
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
        {available.some((complication) => complication.id === "battery") ? (
          <label className="watchface-studio-toggle">
            <input
              type="checkbox"
              checked={controlBatteryEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setDesign((current) => ({
                  ...current,
                  controlBatteryEnabled: enabled,
                  ...(!enabled && current.previewComplication === "battery"
                    ? {
                        previewComplication:
                          available.find((item) => item.id !== "battery")?.id ?? ""
                      }
                    : {})
                }));
              }}
            />
            Include Battery in selectable metrics
          </label>
        ) : null}
        <label className="field">
          Preview data
          <select
            value={selected}
            disabled={previewChoices.length === 0}
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
            {previewChoices.map((complication) => (
              <option key={complication.id} value={complication.id}>
                {complication.label}
              </option>
            ))}
          </select>
        </label>
        {selectedComplication?.valueParts && controlColonReference ? (
          <div className="wf-inline-config-asset">
            <label className="watchface-studio-toggle">
              <input
                type="checkbox"
                checked={controlColonEnabled}
                onChange={(event) =>
                  updateConfigAsset(controlColonReference, {
                    enabled: event.target.checked
                  })
                }
              />
              Show colon between values
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSelectedId("configAsset:config:control_colon_icon");
                setSelectedIds(["configAsset:config:control_colon_icon"]);
                setPropertiesOpen(true);
              }}
            >
              Edit colon image
            </button>
          </div>
        ) : null}
        <LocalFontPicker
          api={api}
          label="Selectable value font"
          value={design.selectableMetricStyle?.fontFamily ?? design.fontFamily}
          emptyLabel="Keep template digits"
          onChange={(fontFamily) =>
            setSelectableMetricStyle({ fontFamily, rasterFont: undefined })
          }
          rasterFont={design.rasterFont}
          onRasterFontChange={setRasterFont}
          typography={{
            fontWeight: design.fontWeight ?? 400,
            fontStyle: design.fontStyle ?? "normal",
            letterSpacing:
              design.selectableMetricStyle?.letterSpacing ??
              design.letterSpacing ??
              0
          }}
          onTypographyChange={(typography) => patchDesign(typography)}
          onLetterSpacingChange={(letterSpacing) =>
            setSelectableMetricStyle({ letterSpacing })
          }
        />
        <CustomPngFontPanel
          api={api}
          rasterFont={design.rasterFont}
          componentRasterFont={design.selectableMetricStyle?.rasterFont}
          componentLabel="Selectable metric"
          onActivate={() => setSelectableMetricStyle({ fontFamily: "" })}
          onRasterFontChange={setRasterFont}
          onComponentRasterFontChange={(rasterFont) =>
            setSelectableMetricStyle({ rasterFont })
          }
        />
        <label className="field">
          Selectable value tint
          <span className="watchface-color-control">
            <input
              type="color"
              value={design.selectableMetricStyle?.color ?? design.digitColor}
              onChange={(event) =>
                setSelectableMetricStyle({ color: event.target.value })
              }
            />
            <code>{design.selectableMetricStyle?.color ?? design.digitColor}</code>
            <button
              type="button"
              className="watchface-color-none"
              disabled={!design.selectableMetricStyle?.color}
              onClick={clearSelectableMetricColor}
            >
              Remove tint
            </button>
          </span>
        </label>
        <label className="field">
          Selectable value scale
          <EditableNumberInput
            min="0.01"
            step="0.01"
            value={design.selectableMetricStyle?.scale ?? 1}
            fallback={1}
            onValueChange={(value) =>
              setSelectableMetricStyle({ scale: Math.max(0.01, value) })
            }
          />
        </label>
        {baseIconPosition ? (
          renderPositionPanel("complication", "Selector icon position", <>
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
            <div className="watchface-nudge-pad wf-position-nudge-only">
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
          </>)
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
      } else if (layer.kind === "batteryIcon") {
        setBatteryIconVisible(visible);
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

  function renderLayerPositionLockButton(id: string, label: string) {
    if (!isMovableSelectionId(id)) return null;
    const locked = isPositionLocked(id);
    return (
      <button
        type="button"
        className={`watchface-layer-lock${locked ? " is-locked" : ""}`}
        aria-label={`${locked ? "Unlock" : "Lock"} ${label} position`}
        aria-pressed={locked}
        title={locked ? "Unlock position" : "Lock position"}
        onClick={() => setLayerPositionLocked(id, !locked)}
      >
        {locked ? <Lock size={15} /> : <Unlock size={15} />}
      </button>
    );
  }

  function renderPositionPanel(
    id: string,
    title: string,
    children: ReactNode,
    helper?: ReactNode
  ) {
    return (
      <div className="watchface-inspector-position">
        <div className="wf-position-heading">
          <span>{title}</span>
        </div>
        <fieldset
          className="wf-position-controls"
          disabled={isMovementLockedForId(id)}
        >
          {children}
        </fieldset>
        {helper ? <div className="wf-position-help">{helper}</div> : null}
      </div>
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
    const setOffset = (dx: number, dy: number) => {
      if (isMovementLockedForId(layer.id)) return;
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
    };
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
    return renderPositionPanel(layer.id, "Watch screen position", <>
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
      </>,
      <p className="watchface-studio-summary">
        This element is drawn live by the watch. Drag it on the face to reposition it.
      </p>
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
      if (isMovementLockedForId(separatorId === "colon" ? "staticColon" : "staticDateSlash")) return;
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
          Tint
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
              Remove tint
            </button>
          </span>
        </label>
        {renderPositionPanel(
          separatorId === "colon" ? "staticColon" : "staticDateSlash",
          "Watch screen position",
          <>
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
          </>
        )}
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
      if (isMovementLockedForId("ampm")) return;
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
          Tint
          <span className="watchface-color-control">
            <input
              type="color"
              value={indicator.color ?? design.digitColor}
              onChange={(event) =>
                updateAmPmIndicator({ color: event.target.value })
              }
            />
            <code>{indicator.color ?? "Template colors"}</code>
            <button
              type="button"
              className="watchface-color-none"
              disabled={!indicator.color}
              onClick={() => updateAmPmIndicator({ color: undefined })}
            >
              Remove tint
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
        {renderPositionPanel("ampm", "Watch screen position", <>
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
        </>)}
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
      if (isMovementLockedForId("weather")) return;
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
        <label className="field">
          Tint
          <span className="watchface-color-control">
            <input
              type="color"
              value={indicator.color ?? design.accentColor}
              onChange={(event) =>
                updateWeatherIndicator({ color: event.target.value })
              }
            />
            <code>{indicator.color ?? "Template colors"}</code>
            <button
              type="button"
              className="watchface-color-none"
              disabled={!indicator.color}
              onClick={() => updateWeatherIndicator({ color: undefined })}
            >
              Remove tint
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
              updateWeatherIndicator({ scale });
              setPosition(indicator.x, indicator.y, scale);
            }}
          />
        </label>
        {renderPositionPanel("weather", "Watch screen position", <>
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
        </>)}
        <p className="watchface-studio-summary">
          The editor previews the sunny state. The watch automatically swaps among all 41 weather states.
        </p>
      </div>
    );
  }

  function renderElementInspector(element: CorosWatchfaceBackgroundElement) {
    if (isPositionLocked(`bgel:${element.id}`)) {
      return (
        <div className="watchface-inspector-group wf-locked-inspector">
          <Lock size={20} aria-hidden="true" />
          <strong>Object locked</strong>
          <p className="watchface-studio-summary">
            Unlock it here or from Layers before editing its appearance.
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setLayerPositionLocked(`bgel:${element.id}`, false)}
          >
            <Unlock size={15} /> Unlock object
          </button>
        </div>
      );
    }
    const set = (patch: BackgroundElementPatch) => updateElement(element.id, patch);
    const hasFill = element.kind === "rect" || element.kind === "ellipse";
    return (
      <div className="watchface-inspector-group">
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={element.visible !== false}
            onChange={(event) => set({ visible: event.target.checked })}
          />
          Show object
        </label>
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

        {renderPositionPanel(`bgel:${element.id}`, "Background position", <>
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
        </>)}

        <label className="field watchface-zoom-control">
          Opacity <span>{Math.round(normalizeWatchfaceOpacity(element.opacity) * 100)}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(normalizeWatchfaceOpacity(element.opacity) * 100)}
            onChange={(event) => set({
              opacity: normalizeWatchfaceOpacity(Number(event.target.value) / 100)
            })}
          />
        </label>
        <label className="field watchface-zoom-control">
          Rotation <span>{element.rotation}°</span>
          <input type="range" min="0" max="360" step="5" value={element.rotation} onChange={(e) => set({ rotation: Number(e.target.value) })} />
        </label>
        {renderEffectsInspector(`bgel:${element.id}`)}
        <button className="secondary-button" type="button" onClick={() => removeElement(element.id)}>
          <Trash2 size={15} /> Remove shape
        </button>
      </div>
    );
  }
}
