import {
  Fragment,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  className,
  title,
  min,
  max,
  step,
  disabled,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value: number;
  fallback?: number;
  onValueChange: (value: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  useEffect(
    () => () => {
      document.body.classList.remove("wf-value-scrubbing");
    },
    []
  );
  const finishScrub = (event: ReactPointerEvent<HTMLInputElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    if (inputRef.current?.hasPointerCapture(event.pointerId)) {
      inputRef.current.releasePointerCapture(event.pointerId);
    }
    scrubRef.current = null;
    setScrubbing(false);
    document.body.classList.remove("wf-value-scrubbing");
  };
  return (
    <input
      {...props}
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft}
      className={`${className ?? ""} wf-scrubbable-number${
        scrubbing ? " is-scrubbing" : ""
      }`.trim()}
      title={title ?? "Drag left or right to adjust. Click to type."}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next !== "" && Number.isFinite(Number(next))) onValueChange(Number(next));
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (
          event.defaultPrevented ||
          disabled ||
          event.button !== 0
        ) {
          return;
        }
        scrubRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: Number.isFinite(value) ? value : fallback,
          moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const scrub = scrubRef.current;
        if (!scrub || scrub.pointerId !== event.pointerId) return;
        const delta = event.clientX - scrub.startX;
        if (!scrub.moved && Math.abs(delta) < 3) return;
        scrub.moved = true;
        if (!scrubbing) {
          setScrubbing(true);
          document.body.classList.add("wf-value-scrubbing");
        }
        event.preventDefault();
        const numericStep = Math.abs(Number(step)) || 1;
        const multiplier = event.shiftKey ? 10 : 1;
        const stepCount = Math.round(delta / 4);
        const lower = min === undefined ? -Infinity : Number(min);
        const upper = max === undefined ? Infinity : Number(max);
        const precision = Math.min(
          8,
          Math.max(0, (String(numericStep).split(".")[1] ?? "").length)
        );
        const next = Math.min(
          Number.isFinite(upper) ? upper : Infinity,
          Math.max(
            Number.isFinite(lower) ? lower : -Infinity,
            scrub.startValue + stepCount * numericStep * multiplier
          )
        );
        const rounded = Number(next.toFixed(precision));
        setDraft(String(rounded));
        onValueChange(rounded);
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        finishScrub(event);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        finishScrub(event);
      }}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        if (!event.defaultPrevented) event.currentTarget.select();
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

/** A six-digit color field that stays editable while the user is typing. */
function EditableHexColorInput({
  value,
  onValueChange,
  onBlur,
  ...props
}: Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedValue = value.replace(/^#/, "").toUpperCase();
  const [draft, setDraft] = useState(normalizedValue);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(normalizedValue);
  }, [normalizedValue]);
  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      value={draft}
      maxLength={6}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value
          .replace(/[^0-9a-f]/gi, "")
          .slice(0, 6)
          .toUpperCase();
        setDraft(next);
        if (/^[0-9A-F]{6}$/.test(next)) onValueChange(`#${next}`);
      }}
      onBlur={(event) => {
        if (!/^[0-9A-F]{6}$/.test(draft)) setDraft(normalizedValue);
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
  AlignJustify,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Battery,
  CalendarDays,
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
  GripVertical,
  ImagePlus,
  Info,
  Layers,
  Link2,
  Lock,
  Loader2,
  Magnet,
  Minus,
  Package,
  Plus,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  SunMedium,
  Square,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  Undo2,
  XCircle,
  MoonStar
} from "lucide-react";
import {
  resizeWatchfaceDimensions,
  type WatchfaceDimensionAxis,
  type WatchfaceDimensions
} from "./watchfaceDimensions";
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
  CorosWatchfaceStroke,
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
import { WatchfaceInspectorSection } from "./WatchfaceInspectorSection";
import {
  watchfaceInspectorSpecificTitle,
  type WatchfaceInspectorSectionId
} from "./watchfaceInspectorSections";
import {
  listWatchfaceEditorConfigAssets,
  watchfaceEditorLayerIsListed
} from "./watchfaceEditorVisibility";
import {
  watchfaceEditorSelectionExists,
  type WatchfaceEditorBounds
} from "./watchfaceEditorGeometry";
import {
  buildAodBackgroundComposition,
  buildAodSafeSpriteReplacements,
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
  makeWatchfaceDragForegroundDesign
} from "./watchfaceDragIsolation";
import {
  materializeLegacyAodDesign,
  resolveWatchfaceModeDesign,
  writeWatchfaceModeDesign
} from "./watchfaceDisplayModes";
import {
  BACKGROUND_SPACE,
  backgroundElementAtPoint,
  backgroundElementLabel,
  createBackgroundElement
} from "./watchfaceBackgroundElements";
import {
  moveWatchfaceArtworkLayer,
  reorderWatchfaceArtworkLayer,
  resolveWatchfaceArtworkLayerOrder,
  watchfaceBackgroundElementLayerId,
  watchfaceSpriteLayerId
} from "./watchfaceArtworkLayers";
import {
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  configAssetCanUseNativeSize,
  configAssetCanvasSize,
  configAssetSupportsNativeSize,
  applyConfigTextEditsToDetails,
  buildDisabledControlComplicationOverrides,
  buildDisabledWatchfaceConfigAssetOverrides,
  buildWatchfaceConfigAssetOverrides,
  detailsForCompositionMode,
  detailsForPreviewResolution,
  dateSpriteCanvasSize,
  downscaleArtwork,
  drawStudioPreview,
  getAmPmCapability,
  scaleAmPmStyleForResolution,
  getAvailableComplications,
  getTemplateBackgroundAssetPaths,
  hasControlComplication,
  hasWatchfaceAod,
  inferStaticSeparators,
  loadStudioImage,
  mergeAssetReplacements,
  mergeConfigOverrides,
  parseConfigPos,
  pickPreviewResolution,
  pickWatchPreviewResolution,
  rasterFontSupportsText,
  removeWatchfaceDateFontOverride,
  retargetWatchfaceCompositionToAod,
  retargetWatchfaceCompositionToCurrent,
  supportsWatchfaceSpriteRotation,
  virtualControlIconCanvasSize,
  isControlComplicationEnabled,
  WATCHFACE_COMPLICATIONS,
  WATCHFACE_MONTH_LABELS,
  type WatchfaceDatePartId,
  type WatchfaceAssetLoader,
  type WatchfaceConfigAssetReference,
  type WatchfaceComplicationId,
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
import { WatchfaceSpriteImportTracker } from "./watchfaceSpriteImportTracker";
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
  duplicateWatchfaceDesignSprite,
  normalizeWatchfaceCrop,
  normalizeWatchfaceOpacity,
  normalizeWatchfaceRotation,
  normalizeWatchfaceSkew,
  normalizeWatchfaceTransformOrigin,
  resizeWatchfaceTransformGroup,
  resizeWatchfaceSprite,
  rotateWatchfaceTransformGroup,
  rotateWatchfaceSprite,
  watchfaceDesignSpriteName,
  type WatchfaceGroupTransformItem,
  type WatchfaceSpriteResizeHandle,
  type WatchfaceSpriteTransform
} from "./watchfaceSpriteTransform";
import {
  normalizeWatchfaceLayerOpacity,
  resolveWatchfaceLayerOpacity
} from "./watchfaceLayerOpacity";
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
  createWatchfaceStroke,
  migrateLegacyBackgroundElementStrokes,
  normalizeWatchfaceStroke,
  renderWatchfaceCanvasDecorations,
  resolveWatchfaceLayerStrokes,
  watchfaceStrokePadding
} from "./watchfaceEditorStrokes";
import {
  paintWatchfaceMeasurements,
  resizeWatchfaceCanvasBackings
} from "./watchfaceInteractiveRenderer";
import { WatchfacePointerController } from "./watchfacePointerController";

function LinkedDimensionInputs({
  width,
  height,
  linked,
  minimum = 1,
  maximum = Number.POSITIVE_INFINITY,
  onDimensionsChange,
  onLinkedChange
}: {
  width: number;
  height: number;
  linked: boolean;
  minimum?: number;
  maximum?: number;
  onDimensionsChange: (dimensions: WatchfaceDimensions) => void;
  onLinkedChange: (linked: boolean) => void;
}) {
  const updateDimension = (axis: WatchfaceDimensionAxis, value: number) => {
    onDimensionsChange(
      resizeWatchfaceDimensions(
        { width, height },
        axis,
        value,
        linked,
        minimum,
        maximum
      )
    );
  };
  const toggleLabel = linked
    ? "Unlink width and height"
    : "Link width and height";
  const finiteMaximum = Number.isFinite(maximum) ? maximum : undefined;

  return (
    <div
      className="watchface-position-inputs wf-linked-dimension-inputs"
      role="group"
      aria-label="Dimensions"
    >
      <label>
        W
        <EditableNumberInput
          aria-label="Width"
          min={minimum}
          max={finiteMaximum}
          step="1"
          value={width}
          fallback={minimum}
          onValueChange={(value) => updateDimension("width", value)}
        />
      </label>
      <button
        type="button"
        className="wf-linked-dimension-toggle"
        aria-label={toggleLabel}
        aria-pressed={linked}
        title={toggleLabel}
        onClick={() => onLinkedChange(!linked)}
      >
        <Link2 size={14} aria-hidden="true" />
      </button>
      <label>
        H
        <EditableNumberInput
          aria-label="Height"
          min={minimum}
          max={finiteMaximum}
          step="1"
          value={height}
          fallback={minimum}
          onValueChange={(value) => updateDimension("height", value)}
        />
      </label>
    </div>
  );
}

function drawWeatherPreviewLayer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  design: Pick<
    CorosWatchfaceDesignState,
    "weatherIndicator" | "layerStrokes" | "layerEffects" | "effectStyles"
  >,
  previewWidth: number
): void {
  const indicator = design.weatherIndicator;
  if (!indicator?.enabled) return;
  const context = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!context) return;
  const previewScale = canvas.width / previewWidth;
  const width = Math.max(
    1,
    Math.round(image.naturalWidth * indicator.scale * previewScale)
  );
  const height = Math.max(
    1,
    Math.round(image.naturalHeight * indicator.scale * previewScale)
  );
  const strokes = resolveWatchfaceLayerStrokes(design, "weather");
  const effects = resolveWatchfaceLayerEffects(design, "weather");
  if (strokes.length === 0 && effects.length === 0) {
    context.drawImage(
      image,
      indicator.x * previewScale,
      indicator.y * previewScale,
      width,
      height
    );
    return;
  }
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  source.getContext("2d")?.drawImage(image, 0, 0, width, height);
  const rendered = renderWatchfaceCanvasDecorations(
    source,
    strokes,
    effects,
    canvas.width / 800,
    true
  );
  context.drawImage(
    rendered.canvas,
    indicator.x * previewScale - rendered.padding.left,
    indicator.y * previewScale - rendered.padding.top
  );
}

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
const PROJECT_THUMBNAIL_SIZE = 416;

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
  const normalizeBackgroundElements = (
    elements: CorosWatchfaceBackgroundElement[] | undefined
  ) =>
    (elements ?? []).map((element) => ({
      ...element,
      visible: element.visible !== false,
      opacity: normalizeWatchfaceOpacity(element.opacity)
    }));
  const normalizeLayerOpacities = (
    opacities: Record<string, number> | undefined
  ) =>
    Object.fromEntries(
      Object.entries(opacities ?? {}).map(([layerId, opacity]) => [
        layerId,
        normalizeWatchfaceLayerOpacity(opacity)
      ])
    );
  const normalizedBackgroundElements = normalizeBackgroundElements(
    design.backgroundElements
  );
  const migratedStrokes = migrateLegacyBackgroundElementStrokes(
    normalizedBackgroundElements,
    design.layerStrokes
  );
  const aodMode = design.modeDesigns?.aod;
  const migratedAodStrokes = aodMode
    ? migrateLegacyBackgroundElementStrokes(
        normalizeBackgroundElements(aodMode.backgroundElements),
        aodMode.layerStrokes
      )
    : null;
  const normalizedModeDesigns: CorosWatchfaceDesignState["modeDesigns"] =
    aodMode && migratedAodStrokes
      ? {
          ...design.modeDesigns,
          aod: {
            ...aodMode,
            backgroundElements: migratedAodStrokes.elements,
            layerOpacities: normalizeLayerOpacities(aodMode.layerOpacities),
            layerStrokes: migratedAodStrokes.layerStrokes
          }
        }
      : design.modeDesigns;
  const normalized: CorosWatchfaceDesignState = {
    ...design,
    artworkVisible:
      design.artworkVisible ?? legacyBackgroundOverride?.enabled !== false,
    configAssetOverrides: design.configAssetOverrides ?? {},
    controlComplicationEnabled: design.controlComplicationEnabled ?? {},
    editorGroups: normalizeWatchfaceEditorGroups(
      design.editorGroups,
      design.linkedLayerGroups
    ),
    editorGuides: (design.editorGuides ?? []).filter(
      (guide) => guide.axis === "x" || guide.axis === "y"
    ),
    effectStyles: design.effectStyles ?? [],
    layerEffects: design.layerEffects ?? {},
    layerOpacities: normalizeLayerOpacities(design.layerOpacities),
    layerStrokes: migratedStrokes.layerStrokes,
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
    artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(design),
    backgroundElements: migratedStrokes.elements,
    lockedLayerIds: [...new Set((design.lockedLayerIds ?? []).filter(Boolean))],
    modeDesigns: normalizedModeDesigns,
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
  const componentDragBoundsRef = useRef<SVGRectElement>(null);
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
  const [devTemplateIdOverride, setDevTemplateIdOverride] = useState("");
  const [devWatchfaceIdOverride, setDevWatchfaceIdOverride] = useState("");
  const [devTemplateNameOverride, setDevTemplateNameOverride] = useState("");
  const [configTextBaselines, setConfigTextBaselines] = useState<
    Record<string, string>
  >({});
  const [configEditorDirectory, setConfigEditorDirectory] = useState("");
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
  const rootDesign = history.present.value.design;
  const projectName = history.present.value.projectName;
  const [selectedId, setSelectedId] = useState<string>("background");
  const [selectedIds, setSelectedIds] = useState<string[]>(["background"]);
  const previousPreviewModeRef = useRef<WatchfacePreviewMode>("current");
  const selectionByModeRef = useRef<
    Record<WatchfacePreviewMode, { selectedId: string; selectedIds: string[] }>
  >({
    current: { selectedId: "background", selectedIds: ["background"] },
    aod: { selectedId: "background", selectedIds: ["background"] }
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggedArtworkLayerId, setDraggedArtworkLayerId] =
    useState<string | null>(null);
  const [layerDropTarget, setLayerDropTarget] = useState<{
    layerId: string;
    placement: "before" | "after";
  } | null>(null);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<WatchfacePreviewMode>("current");
  const design = useMemo(
    () => resolveWatchfaceModeDesign(rootDesign, previewMode),
    [rootDesign, previewMode]
  );
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewingExport, setPreviewingExport] = useState(false);
  const [exportPreviewImages, setExportPreviewImages] = useState<{
    current: string;
    aod: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const spriteImportTrackerRef = useRef(new WatchfaceSpriteImportTracker());
  const [pendingSpriteImportCount, setPendingSpriteImportCount] = useState(0);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [collapsedLayerSections, setCollapsedLayerSections] = useState(
    () => new Set<string>(["Template assets", "Always-on assets"])
  );
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [collapsedInspectorSections, setCollapsedInspectorSections] = useState(
    () => new Set<WatchfaceInspectorSectionId>(["effects", "advanced"])
  );
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<
    Record<string, string>
  >({});
  const [advancedStrokeLayers, setAdvancedStrokeLayers] = useState(
    () => new Set<string>()
  );
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
  const spriteImportPending = pendingSpriteImportCount > 0;

  const beginSpriteImport = useCallback((target: string): number | null => {
    if (!mountedRef.current) return null;
    const tracker = spriteImportTrackerRef.current;
    const importId = tracker.begin(target, previewSessionRef.current);
    setPendingSpriteImportCount(tracker.pendingCount);
    return importId;
  }, []);

  const finishSpriteImport = useCallback((importId: number): void => {
    const tracker = spriteImportTrackerRef.current;
    tracker.finish(importId);
    if (mountedRef.current) {
      setPendingSpriteImportCount(tracker.pendingCount);
    }
  }, []);

  const isSpriteImportCurrent = useCallback((importId: number): boolean => (
    mountedRef.current &&
    spriteImportTrackerRef.current.isCurrent(
      importId,
      previewSessionRef.current
    )
  ), []);

  const rasterFolderImportProps = {
    importDisabled: spriteImportPending,
    onImportStart: beginSpriteImport,
    onImportFinish: finishSpriteImport,
    isImportCurrent: isSpriteImportCurrent
  };

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
    const activeDesign = resolveWatchfaceModeDesign(
      currentValue.design,
      previewMode
    );
    const nextDesign =
      typeof action === "function" ? action(activeDesign) : action;
    const nextValue = {
      ...currentValue,
      design: writeWatchfaceModeDesign(
        currentValue.design,
        previewMode,
        nextDesign
      )
    };
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
    if (!exportMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [exportMenuOpen]);

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
    previousPreviewModeRef.current = "current";
    selectionByModeRef.current = {
      current: { selectedId: "background", selectedIds: ["background"] },
      aod: { selectedId: "background", selectedIds: ["background"] }
    };
    setHoveredId(null);
    setBackgroundDataUrl("");
    setPreviewMode("current");
    setDetails(null);
    setConfigTextBaselines({});
    setConfigEditorDirectory("");
    setPlacementMenuOpen(false);
    setContextMenu(null);
    clearSnapGuides();
    pointerControllerRef.current?.cancel();
    dragRef.current = null;
    dragPreparationIdRef.current += 1;
    dragVisualRef.current = null;
    setDragVisualActive(false);
    paintComponentDragBounds(null);
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
    Promise.all([
      api.describeCorosWatchfaceTemplate(starterArchive.archiveId),
      api.loadCorosWatchfaceTemplateConfigTexts(starterArchive.archiveId)
    ])
      .then(async ([described, configTexts]) => {
        let templateArtwork: CorosWatchfaceTemplateAsset | undefined;
        let aodArtwork: CorosWatchfaceTemplateAsset | undefined;
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
        if (hasWatchfaceAod(described) && !initialDesign?.modeDesigns?.aod) {
          const preferred = pickWatchPreviewResolution(described);
          const aodResolutions = [
            ...(preferred ? [preferred] : []),
            ...described.resolutions.filter(
              (resolution) => resolution !== preferred
            )
          ];
          for (const resolution of aodResolutions) {
            const relativePath = resolution.aodConfig.background_icon
              ?.trim()
              .replace(/\\/g, "/")
              .replace(/^\.\//, "");
            if (!relativePath) continue;
            try {
              const [asset] = await loadAssets([
                `${resolution.directory}/${relativePath}`
              ]);
              if (asset) {
                aodArtwork = asset;
                break;
              }
            } catch {
              // AOD may use only bg_color and no standalone background PNG.
            }
          }
        }
        if (cancelled) return;

        const baselines: Record<string, string> = {};
        for (const entry of configTexts) {
          baselines[entry.path] = entry.text;
        }
        setConfigTextBaselines(baselines);
        setConfigEditorDirectory((current) => {
          if (
            current &&
            described.resolutions.some(
              (resolution) => resolution.directory === current
            )
          ) {
            return current;
          }
          return described.resolutions[0]?.directory ?? "";
        });
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
        if (hasWatchfaceAod(described) && !nextDesign.modeDesigns?.aod) {
          const sourceResolution =
            pickWatchPreviewResolution(described) ??
            described.resolutions.find(
              (resolution) => Object.keys(resolution.aodConfig).length > 0
            );
          nextDesign = {
            ...nextDesign,
            configAssetOverrides: Object.fromEntries(
              Object.entries(nextDesign.configAssetOverrides ?? {}).filter(
                ([key]) => !key.startsWith("aod:")
              )
            ),
            layerEffects: Object.fromEntries(
              Object.entries(nextDesign.layerEffects ?? {}).filter(
                ([key]) => !key.startsWith("aod:")
              )
            ),
            layerStrokes: Object.fromEntries(
              Object.entries(nextDesign.layerStrokes ?? {}).filter(
                ([key]) => !key.startsWith("aod:")
              )
            ),
            modeDesigns: {
              ...(nextDesign.modeDesigns ?? {}),
              aod: materializeLegacyAodDesign(
                nextDesign,
                aodArtwork
                  ? {
                      dataUrl: aodArtwork.dataUrl,
                      width: aodArtwork.width,
                      height: aodArtwork.height
                    }
                  : null,
                sourceResolution?.aodConfig.bg_color ?? "#000000"
              )
            }
          };
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
      design.artworkLayerOrder,
      design.backgroundElements,
      design.designSprites,
      design.configAssetOverrides,
      design.staticSeparators,
      design.fontFamily,
      design.effectStyles,
      design.layerEffects,
      design.layerOpacities,
      design.layerStrokes
    ]
  );
  const supportsAod = useMemo(
    () => (details ? hasWatchfaceAod(details) : false),
    [details]
  );
  const canEditActiveMode = previewMode === "current" || supportsAod;
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
      design.controlComplicationEnabled,
      design.controlBatteryEnabled,
      design.controlSunriseEnabled,
      design.controlSunsetEnabled,
      design.controlFloorEnabled,
      design.controlTemperatureEnabled,
      design.separateAutoTime,
      design.timeStyles,
      design.dateStyles,
      design.layerColors,
      design.layerOpacities,
      design.configAssetOverrides,
      design.ampmIndicator,
      design.effectStyles,
      design.layerEffects,
      design.layerStrokes
    ]
  );
  const previewStudioOptions = useMemo(
    () => ({ ...studioOptions, previewMode }),
    [studioOptions, previewMode]
  );
  const detailsWithConfigEdits = useMemo(
    () =>
      details
        ? applyConfigTextEditsToDetails(details, design.configTextEdits)
        : null,
    [details, design.configTextEdits]
  );
  const modeSourceDetails = useMemo(
    () => detailsWithConfigEdits
      ? detailsForCompositionMode(detailsWithConfigEdits, previewMode)
      : null,
    [detailsWithConfigEdits, previewMode]
  );
  const designDetails = useMemo(
    () =>
      modeSourceDetails
        ? deriveDesignDetails(modeSourceDetails, design)
        : null,
    [
      modeSourceDetails,
      design.metricChanges,
      design.metricStyles,
      design.selectableMetricStyle,
      design.controlComplicationEnabled,
      design.controlBatteryEnabled,
      design.controlSunriseEnabled,
      design.controlSunsetEnabled,
      design.controlFloorEnabled,
      design.controlTemperatureEnabled,
      design.separateAutoTime,
      design.timeStyles,
      design.dateStyles,
      design.layerColors,
      design.controlIconOffsets,
      design.configAssetOverrides,
      design.staticSeparators,
      design.layoutOffsets,
      design.layerVisibility,
      design.digitColor,
      design.configTextEdits
    ]
  );
  const basePreviewDetails = designDetails?.previewDetails ?? null;
  const previewDetails = basePreviewDetails;
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
        nativeSpriteResolutionScale: target.width / previewResolution.width,
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

  useEffect(() => {
    if (!watchPreviewDirectory) return;
    setConfigEditorDirectory((current) =>
      current === watchPreviewDirectory ? current : watchPreviewDirectory
    );
  }, [watchPreviewDirectory]);
  const layoutLimits = useMemo(() => {
    const base = designDetails
      ? pickPreviewResolution(designDetails.styledMetricDetails)
      : null;
    return base
      ? computeLayoutOffsetLimits(base, {
          timeStyles: design.timeStyles,
          letterSpacing: design.letterSpacing,
          rasterFont: design.rasterFont
        })
      : {};
  }, [
    designDetails,
    design.timeStyles,
    design.letterSpacing,
    design.rasterFont
  ]);
  const baseLayoutBounds = useMemo(() => {
    const base = designDetails
      ? pickPreviewResolution(designDetails.styledMetricDetails)
      : null;
    return base
      ? computeLayoutGroupBounds(base, {
          timeStyles: design.timeStyles,
          letterSpacing: design.letterSpacing,
          rasterFont: design.rasterFont
        })
      : [];
  }, [
    designDetails,
    design.timeStyles,
    design.letterSpacing,
    design.rasterFont
  ]);
  const layers = useMemo(() => {
    if (!modeSourceDetails) return [];
    return deriveEditorLayers(modeSourceDetails, design).filter((layer) => {
      if (layer.configAssetId) {
        return (
          layer.configAssetId.startsWith("config:") &&
          watchfaceEditorLayerIsListed(layer, previewMode, design)
        );
      }
      return watchfaceEditorLayerIsListed(layer, previewMode, design);
    });
  }, [modeSourceDetails, design, previewMode]);
  const configAssetReferences = useMemo(
    () => {
      if (!modeSourceDetails) return [];
      const enabledControlIcons = previewMode === "current"
        ? WATCHFACE_COMPLICATIONS
            .filter(
              (complication) =>
                complication.id !== "battery" &&
                isControlComplicationEnabled(
                  modeSourceDetails,
                  design,
                  complication.id
                )
            )
            .map((complication) => complication.id)
        : [];
      return listWatchfaceEditorConfigAssets(
        modeSourceDetails,
        previewDetails ?? modeSourceDetails,
        enabledControlIcons
      ).filter(
          (reference) => reference.scope === "config"
        );
    },
    [detailsWithConfigEdits, design, modeSourceDetails, previewDetails, previewMode]
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
    canEditActiveMode &&
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
      canEditActiveMode &&
      !isMovementLockedForId(selectedLayer.id)
    )
  );

  useEffect(() => {
    const previousMode = previousPreviewModeRef.current;
    selectionByModeRef.current[previousMode] = {
      selectedId,
      selectedIds: [...selectedIds]
    };
    const saved = selectionByModeRef.current[previewMode];
    const fallback = canEditActiveMode
      ? { selectedId: "background", selectedIds: ["background"] }
      : { selectedId: "", selectedIds: [] };
    const restored = canEditActiveMode ? saved ?? fallback : fallback;
    setSelectedId(restored.selectedId);
    setSelectedIds(restored.selectedIds);
    previousPreviewModeRef.current = previewMode;
    setHoveredId(null);
    setPlacementMenuOpen(false);
    clearSnapGuides();
    // Selection is intentionally restored per display mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode]);

  useEffect(() => {
    if (
      watchfaceEditorSelectionExists(
        selectedId,
        layers,
        backgroundElements
      )
    ) return;
    const nextId = canEditActiveMode
      ? layers.find((layer) => layer.id === "background")?.id ?? layers[0]?.id ?? ""
      : layers[0]?.id ?? "";
    setSelectedId(nextId);
    setSelectedIds(nextId ? [nextId] : []);
  }, [backgroundElements, canEditActiveMode, layers, selectedId]);

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
    const configKey = `control_${complication.controlPrefix}_icon`;
    const configOverride =
      design.configAssetOverrides?.[`config:${configKey}`];
    const virtualIcon = !icon && !state && Boolean(configOverride?.replacement);
    const virtualCanvas = virtualIcon
      ? virtualControlIconCanvasSize(resolution)
      : null;
    const canvasSize = configAssetCanvasSize(
      configKey,
      virtualIcon && configOverride
        ? { ...configOverride, nativeSize: false }
        : configOverride,
      virtualCanvas ?? { width: baseWidth, height: baseHeight },
      previewResolution ? resolution.width / previewResolution.width : 1
    );
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
      x1: x + canvasSize.width * coordinateScale,
      y1: y + canvasSize.height * coordinateScale
    };
  }, [
    design.configAssetOverrides,
    design.previewComplication,
    previewDetails,
    previewResolution,
    previewWidth,
    watchPreviewResolution
  ]);
  const activeBackgroundElements = backgroundElements.filter(
    (element) => element.visible !== false
  );
  const visibleEditorGroups = design.editorGroups ?? [];
  const groupedEditorLayerIds = new Set(
    visibleEditorGroups.flatMap((group) => group.layerIds)
  );
  const previewBackgroundDataUrl = backgroundDataUrl;
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

  function dragBoundsForId(
    drag: WatchfaceDragState,
    id: string
  ): WatchfaceEditorBounds | null {
    return drag.kind === "selectorIcon" && id === "complication"
      ? drag.baseBounds
      : selectionBoundsForId(id);
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
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 236))
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
    paintComponentDragBounds(null);
    const canvas = dragPreviewCanvasRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.visibility = "hidden";
    }
    setDragVisualActive(false);
    setSpriteTransformDraft(null);
  }

  function paintComponentDragBounds(bounds: WatchfaceEditorBounds | null) {
    const box = componentDragBoundsRef.current;
    if (!box) return;
    if (!bounds) {
      box.style.display = "none";
      return;
    }
    box.setAttribute("x", String(bounds.x0));
    box.setAttribute("y", String(bounds.y0));
    box.setAttribute("width", String(Math.max(1, bounds.x1 - bounds.x0)));
    box.setAttribute("height", String(Math.max(1, bounds.y1 - bounds.y0)));
    box.style.display = "block";
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

    const movedIds = dragMovementIds(visual.drag);
    const linkedBounds = movedIds
      .map((id) => dragBoundsForId(visual.drag, id))
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
      paintComponentDragBounds(bounds);
      context.strokeStyle = "rgba(81, 224, 181, 0.95)";
      context.lineWidth = 2;
      context.setLineDash([]);
      context.strokeRect(
        bounds.x0 * scaleX,
        bounds.y0 * scaleY,
        (bounds.x1 - bounds.x0) * scaleX,
        (bounds.y1 - bounds.y0) * scaleY
      );
    } else {
      paintComponentDragBounds(null);
    }
    canvas.style.visibility = "visible";
  }

  function isolateDragDesigns(drag: WatchfaceDragState): {
    base: CorosWatchfaceDesignState;
    moving: CorosWatchfaceDesignState;
    clipBounds: WatchfaceEditorBounds;
  } {
    const movingIds = dragMovementIds(drag);
    const movingIdSet = new Set(movingIds);
    const movingElementIds = new Set(
      movingIds
        .filter((id) => id.startsWith("bgel:"))
        .map((id) => id.slice("bgel:".length))
    );
    const movingLayers = layers.filter((layer) => movingIdSet.has(layer.id));
    const baseMovingLayers = drag.kind === "selectorIcon"
      ? movingLayers.filter((layer) => layer.id !== "complication")
      : movingLayers;
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
          baseMovingLayers
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
      ...makeWatchfaceDragForegroundDesign(design),
      // The moving frame is composited over the stationary base frame. Keep
      // its full-face background transparent so only selected foreground
      // components travel while dragging.
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
      .map((id) => dragBoundsForId(drag, id))
      .filter((box): box is WatchfaceEditorBounds => Boolean(box));
    const movingBounds = linkedBounds.length > 0
      ? linkedBounds.reduce((result, box) => ({
          x0: Math.min(result.x0, box.x0),
          y0: Math.min(result.y0, box.y0),
          x1: Math.max(result.x1, box.x1),
          y1: Math.max(result.y1, box.y1)
        }))
      : drag.baseBounds;
    const clipPadding = Math.max(
      2,
      ...movingIds.map((layerId) =>
        watchfaceStrokePadding(
          resolveWatchfaceLayerStrokes(design, layerId),
          previewWidth / 800
        ).left
      )
    );
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
    frameDesign: CorosWatchfaceDesignState,
    previewComplicationContent: WatchfaceStudioOptions["previewComplicationContent"] = "all"
  ): Promise<HTMLCanvasElement> {
    if (!modeSourceDetails) {
      throw new Error("Watch face details are not ready.");
    }
    const frame = document.createElement("canvas");
    frame.width = dragPreviewCanvasRef.current?.width ?? PREVIEW_SIZE;
    frame.height = dragPreviewCanvasRef.current?.height ?? PREVIEW_SIZE;
    const allFrameDetails = deriveDesignDetails(
      // Use the same display-mode projection as the settled preview. In AOD
      // mode this exposes AODconfig.txt through `config`; starting again from
      // the archive details would briefly render the current-face layout and
      // make every stationary component jump during a drag.
      modeSourceDetails,
      frameDesign
    ).previewDetails;
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
      studioOptionsForResolution(
        {
          ...toStudioOptions(frameDesign),
          previewMode,
          previewComplicationContent
        },
        frameDetails
      ),
      loadAssets
    );
    if (frameDesign.weatherIndicator?.enabled) {
      const url = await weatherPreviewDataUrl(
        previewWidth,
        frameDesign.weatherIndicator.color
      );
      if (url) {
        const image = await loadStudioImage(url);
        drawWeatherPreviewLayer(
          frame,
          image,
          frameDesign,
          previewWidth
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
      drag.kind !== "selectorIcon" &&
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
    paintComponentDragBounds(
      isSpriteTransformDrag(drag) ? null : drag.baseBounds
    );
    const canvas = dragPreviewCanvasRef.current;
    if (canvas) {
      canvas.style.visibility = "hidden";
    }
    setDragVisualActive(true);
    if (cacheMatches) {
      drawDragVisual();
      return;
    }
    if (drag.kind !== "selectorIcon") {
      return;
    }
    void Promise.all([
      renderDragFrame(isolated.base),
      renderDragFrame(isolated.moving, "icon")
    ]).then(([baseFrame, movingFrame]) => {
      const active = dragVisualRef.current;
      if (
        !mountedRef.current ||
        previewSessionRef.current !== sessionId ||
        dragRef.current !== drag ||
        active?.drag !== drag ||
        active.preparationId !== preparationId
      ) {
        return;
      }
      active.baseFrame = baseFrame;
      active.movingFrame = movingFrame;
      active.clipBounds = isolated.clipBounds;
      drawDragVisual();
    }).catch(() => {
      // Keep the accurate main preview visible if drag isolation fails.
    });
  }

  useEffect(() => {
    if (!details || !canEditActiveMode) {
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
        active.drag.kind !== "selectorIcon" &&
        dragRef.current === active.drag &&
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
      !canEditActiveMode ||
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
      backgroundElements: [...(prev.backgroundElements ?? []), element],
      artworkLayerOrder: [
        ...resolveWatchfaceArtworkLayerOrder(prev),
        watchfaceBackgroundElementLayerId(element.id)
      ]
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
      artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(prev).filter(
        (layerId) => layerId !== editorId
      ),
      editorGroups: (prev.editorGroups ?? [])
        .map((group) => ({
          ...group,
          layerIds: group.layerIds.filter((candidate) => candidate !== editorId)
        }))
        .filter((group) => group.layerIds.length >= 2),
      lockedLayerIds: (prev.lockedLayerIds ?? []).filter(
        (candidate) => candidate !== editorId
      ),
      layerEffects: Object.fromEntries(
        Object.entries(prev.layerEffects ?? {}).filter(
          ([candidate]) => candidate !== editorId
        )
      ),
      layerStrokes: Object.fromEntries(
        Object.entries(prev.layerStrokes ?? {}).filter(
          ([candidate]) => candidate !== editorId
        )
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
                drawWeatherPreviewLayer(
                  frame,
                  image,
                  {
                    weatherIndicator: next.weather,
                    layerStrokes: next.options.layerStrokes,
                    layerEffects: next.options.layerEffects,
                    effectStyles: next.options.effectStyles
                  },
                  next.previewWidth
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
                paintComponentDragBounds(null);
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

  // Draw placement aids on the circular interaction overlay.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const scaleX = canvas.width / previewWidth;
    const scaleY = canvas.height / previewHeight;
    const activeDrag = dragVisualActive ? dragVisualRef.current?.drag : null;
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

    if (canEditActiveMode && placementPreferences.gridVisible) {
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

    if (canEditActiveMode && placementPreferences.guidesVisible) {
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

  const outlineDrag = dragVisualActive ? dragVisualRef.current?.drag : null;
  const outlineDragIds = new Set(
    outlineDrag ? dragMovementIds(outlineDrag) : []
  );
  const componentBoundsOutlines: Array<{
    id: string;
    bounds: WatchfaceEditorBounds;
    active: boolean;
    draggable: boolean;
    selector?: boolean;
  }> = [];
  for (const element of activeBackgroundElements) {
    const id = `bgel:${element.id}`;
    const active = selectedIds.includes(id);
    const hovered = hoveredId === id;
    if (
      (!active && !hovered) ||
      (selectedSpriteCanTransform && active) ||
      outlineDragIds.has(id)
    ) {
      continue;
    }
    const box = backgroundElementSnapBounds(element);
    componentBoundsOutlines.push({
      id,
      active,
      draggable:
        isMovableSelectionId(id) && !isMovementLockedForId(id),
      bounds: {
        x0: box.x0 * (previewWidth / BACKGROUND_SPACE),
        y0: box.y0 * (previewHeight / BACKGROUND_SPACE),
        x1: box.x1 * (previewWidth / BACKGROUND_SPACE),
        y1: box.y1 * (previewHeight / BACKGROUND_SPACE)
      }
    });
  }
  for (const layer of layers) {
    const active = selectedIds.includes(layer.id);
    const hovered = hoveredId === layer.id;
    if (
      !layer.bounds ||
      layer.kind === "background" ||
      !layer.visible ||
      (!active && !hovered) ||
      (selectedSpriteCanTransform && active) ||
      outlineDragIds.has(layer.id)
    ) {
      continue;
    }
    componentBoundsOutlines.push({
      id: layer.id,
      bounds: layer.bounds,
      active,
      draggable:
        isMovableSelectionId(layer.id) &&
        !isMovementLockedForId(layer.id)
    });
  }
  if (
    selectorIconTarget &&
    !isMovementLockedForId("complication") &&
    selectedIds.includes("complication") &&
    outlineDrag?.kind !== "selectorIcon"
  ) {
    componentBoundsOutlines.push({
      id: `selectorIcon:${selectorIconTarget.complicationId}`,
      bounds: selectorIconTarget,
      active: true,
      draggable: true,
      selector: true
    });
  }

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
    if (!canEditActiveMode || event.button !== 0) return;
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
    event: React.PointerEvent<Element>,
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
    if (!canEditActiveMode) return;
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
    const linkedIds = dragMovementIds(drag);
    const linkedBounds = linkedIds
      .map((id) => dragBoundsForId(drag, id))
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

  function handlePointerDown(event: React.PointerEvent<Element>) {
    if (!canEditActiveMode || event.button !== 0) return;
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
    if (!canEditActiveMode) {
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
        replacement: await downscaleArtwork(selected),
        ...(configAssetSupportsNativeSize(reference.configKey)
          ? { nativeSize: Boolean(reference.source) }
          : {})
      });
      onNotice(`${reference.label} replaced for every supported resolution.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not replace the template image.");
    }
  }

  async function chooseBatterySpriteFolder(
    overrideId:
      | "config:battery_icon"
      | "config:control_battery_icon" = "config:battery_icon"
  ) {
    if (spriteImportTrackerRef.current.pendingCount > 0) return;
    const importId = beginSpriteImport(`battery-folder:${overrideId}`);
    if (importId === null) return;
    const canCommit = () => isSpriteImportCurrent(importId);
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
      ).sort((left, right) =>
        left.sprite.relativePath.localeCompare(
          right.sprite.relativePath,
          "en",
          { sensitivity: "base", numeric: true }
        )
      );
      if (validSprites.length === 0) {
        throw new Error("Name battery sprites 00.png, 01.png, and so on.");
      }
      const uniqueSprites = new Map<string, (typeof validSprites)[number]>();
      for (const entry of validSprites) {
        const existing = uniqueSprites.get(entry.state);
        if (existing) {
          throw new Error(
            `Duplicate battery sprite “${entry.state.padStart(2, "0")}” was found in “${existing.sprite.relativePath}” and “${entry.sprite.relativePath}”.`
          );
        }
        uniqueSprites.set(entry.state, entry);
      }
      const replacementSprites = [...uniqueSprites.values()];
      const canvasWidth = Math.max(
        ...replacementSprites.map(({ image }) => image.naturalWidth)
      );
      const canvasHeight = Math.max(
        ...replacementSprites.map(({ image }) => image.naturalHeight)
      );
      const entries = replacementSprites.map(({ state, sprite, image }) => {
        const centeredDataUrl =
          centerSpriteArtwork(image, canvasWidth, canvasHeight) ?? sprite.dataUrl;
        return [state, {
          dataUrl: centeredDataUrl,
          width: canvasWidth,
          height: canvasHeight
        }] as const;
      });
      const stateReplacements = Object.fromEntries(entries);
      if (!canCommit()) return;
      setDesign((prev) => ({
        ...prev,
        configAssetOverrides: {
          ...(prev.configAssetOverrides ?? {}),
          [overrideId]: {
            ...(prev.configAssetOverrides?.[overrideId] ?? {}),
            enabled: true,
            stateReplacements
          }
        },
        ...(overrideId === "config:battery_icon"
          ? {
              layerVisibility: {
                ...prev.layerVisibility,
                batteryIcon: true
              }
            }
          : {})
      }));
      onNotice(
        `Imported ${Object.keys(stateReplacements).length} ${
          overrideId === "config:battery_icon"
            ? "battery"
            : "control battery"
        } sprite states on a shared ${canvasWidth}×${canvasHeight}px canvas.`
      );
    } catch (caught) {
      if (canCommit()) {
        onError(caught instanceof Error ? caught.message : "Could not load the battery sprite folder.");
      }
    } finally {
      finishSpriteImport(importId);
    }
  }

  function restoreBatteryIcon(
    overrideId:
      | "config:battery_icon"
      | "config:control_battery_icon" = "config:battery_icon"
  ) {
    setDesign((prev) => {
      const configAssetOverrides = { ...(prev.configAssetOverrides ?? {}) };
      delete configAssetOverrides[overrideId];
      return { ...prev, configAssetOverrides };
    });
  }

  function setBatteryIconScale(
    scale: number,
    overrideId:
      | "config:battery_icon"
      | "config:control_battery_icon" = "config:battery_icon"
  ) {
    setDesign((prev) => ({
      ...prev,
      configAssetOverrides: {
        ...(prev.configAssetOverrides ?? {}),
        [overrideId]: {
          ...(prev.configAssetOverrides?.[overrideId] ?? {}),
          enabled: true,
          scale: Math.max(0.1, Number.isFinite(scale) ? scale : 1)
        }
      }
    }));
  }

  function setControlComplicationEnabled(
    id: WatchfaceComplicationId,
    enabled: boolean
  ) {
    const sourceDetails = modeSourceDetails ?? details;
    if (!sourceDetails) return;
    setDesign((current) => {
      const controlComplicationEnabled = {
        ...(current.controlComplicationEnabled ?? {}),
        [id]: enabled
      };
      const next = {
        ...current,
        controlComplicationEnabled
      };
      const candidates = previewMode === "aod"
        ? getAvailableComplications(sourceDetails)
        : WATCHFACE_COMPLICATIONS;
      const fallbackComplication = candidates.find(
        (complication) =>
          complication.id !== id &&
          isControlComplicationEnabled(sourceDetails, next, complication.id)
      )?.id ?? "";
      return {
        ...next,
        ...(enabled
          ? { previewComplication: id }
          : current.previewComplication === id
            ? { previewComplication: fallbackComplication }
            : {})
      };
    });
  }

  function setControlBatteryEnabled(enabled: boolean) {
    setControlComplicationEnabled("battery", enabled);
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
    patch: { color?: string; scale?: number; rotation?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceDesignState["rasterFont"] }
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
    patch: { color?: string; scale?: number; rotation?: number; fontFamily?: string; letterSpacing?: number; rasterFont?: CorosWatchfaceDesignState["rasterFont"] }
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
    patch: {
      scale?: number;
      rotation?: number;
      width?: number;
      height?: number;
      aspectLocked?: boolean;
      monthFormat?: "digits" | "labels";
      fontFamily?: string;
      color?: string;
      letterSpacing?: number;
      rasterFont?: CorosWatchfaceDesignState["rasterFont"];
      nativeSize?: boolean;
    }
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

  /**
   * Returning a date component to its template font must also remove the
   * natural-size mode that was coupled to rasterization. If no independent
   * visual edits remain, drop the style entry completely so the original PNG
   * bypasses the trim-and-fit sprite pipeline.
   */
  function restoreDateTemplateFont(partId: WatchfaceDatePartId) {
    setDesign((prev) => {
      const dateStyles = { ...prev.dateStyles };
      if (!dateStyles[partId]) return prev;
      const restored = removeWatchfaceDateFontOverride(dateStyles[partId]);
      if (restored) {
        dateStyles[partId] = restored;
      } else {
        delete dateStyles[partId];
      }
      return { ...prev, dateStyles };
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

  function duplicateSprite(spriteId: string) {
    const sprites = design.designSprites ?? [];
    if (sprites.length >= MAX_DESIGN_SPRITES) {
      onError(`A design can contain up to ${MAX_DESIGN_SPRITES} imported images.`);
      return;
    }
    const source = sprites.find((sprite) => sprite.id === spriteId);
    if (!source) return;
    const duplicateId = window.crypto.randomUUID();
    const duplicate = duplicateWatchfaceDesignSprite(
      source,
      duplicateId,
      {
        width: previewWidth,
        height: previewResolution?.height ?? previewWidth
      },
      Math.max(8, Math.round(previewWidth * 0.02))
    );
    const sourceEffect = design.layerEffects?.[`sprite:${spriteId}`];
    const sourceStrokes = resolveWatchfaceLayerStrokes(
      design,
      `sprite:${spriteId}`
    );
    setDesign((current) => ({
      ...current,
      designSprites: [...(current.designSprites ?? []), duplicate],
      artworkLayerOrder: [
        ...resolveWatchfaceArtworkLayerOrder(current),
        watchfaceSpriteLayerId(duplicateId)
      ],
      ...(sourceEffect
        ? {
            layerEffects: {
              ...(current.layerEffects ?? {}),
              [`sprite:${duplicateId}`]: structuredClone(sourceEffect)
            }
        }
        : {}),
      ...(sourceStrokes.length > 0
        ? {
            layerStrokes: {
              ...(current.layerStrokes ?? {}),
              [`sprite:${duplicateId}`]: sourceStrokes.map((stroke) => ({
                ...structuredClone(stroke),
                id: createWatchfaceStroke().id
              }))
            }
          }
        : {})
    }));
    setCropSpriteId(null);
    setSelectedId(`sprite:${duplicateId}`);
    setSelectedIds([`sprite:${duplicateId}`]);
    setContextMenu(null);
    setPropertiesOpen(true);
    onNotice("Imported image duplicated.");
  }

  function removeSprite(spriteId: string) {
    const editorId = `sprite:${spriteId}`;
    if (isPositionLocked(editorId)) return;
    setDesign((prev) => syncLegacyWatchfaceGroups({
      ...prev,
      designSprites: (prev.designSprites ?? []).filter((s) => s.id !== spriteId),
      artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(prev).filter(
        (layerId) => layerId !== editorId
      ),
      editorGroups: (prev.editorGroups ?? [])
        .map((group) => ({
          ...group,
          layerIds: group.layerIds.filter((candidate) => candidate !== editorId)
        }))
        .filter((group) => group.layerIds.length >= 2),
      lockedLayerIds: (prev.lockedLayerIds ?? []).filter(
        (candidate) => candidate !== editorId
      ),
      layerEffects: Object.fromEntries(
        Object.entries(prev.layerEffects ?? {}).filter(
          ([candidate]) => candidate !== editorId
        )
      ),
      layerStrokes: Object.fromEntries(
        Object.entries(prev.layerStrokes ?? {}).filter(
          ([candidate]) => candidate !== editorId
        )
      )
    }));
    setSelectedId("background");
    setSelectedIds(["background"]);
  }

  function reorderArtworkLayer(
    draggedLayerId: string,
    targetLayerId: string,
    placement: "before" | "after"
  ) {
    if (isPositionLocked(draggedLayerId)) return;
    setDesign((current) => ({
      ...current,
      artworkLayerOrder: reorderWatchfaceArtworkLayer(
        resolveWatchfaceArtworkLayerOrder(current),
        draggedLayerId,
        targetLayerId,
        placement
      )
    }));
  }

  function moveArtworkLayer(
    layerId: string,
    direction: "forward" | "backward"
  ) {
    if (isPositionLocked(layerId)) return;
    setDesign((current) => ({
      ...current,
      artworkLayerOrder: moveWatchfaceArtworkLayer(
        resolveWatchfaceArtworkLayerOrder(current),
        layerId,
        direction
      )
    }));
  }

  function renderArtworkLayerOrderControls(layerId: string) {
    const order = resolveWatchfaceArtworkLayerOrder(design);
    const index = order.indexOf(layerId);
    if (index < 0) return null;
    return (
      <div className="wf-config-asset-actions" aria-label="Layer order">
        <button
          className="secondary-button"
          type="button"
          disabled={index === 0 || isPositionLocked(layerId)}
          onClick={() => moveArtworkLayer(layerId, "backward")}
        >
          Move backward
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={index === order.length - 1 || isPositionLocked(layerId)}
          onClick={() => moveArtworkLayer(layerId, "forward")}
        >
          Move forward
        </button>
      </div>
    );
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
    if (!canEditActiveMode) return;
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
        designSprites: [...(prev.designSprites ?? []), sprite],
        artworkLayerOrder: [
          ...resolveWatchfaceArtworkLayerOrder(prev),
          watchfaceSpriteLayerId(sprite.id)
        ]
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

  async function renderExportPreview(
    rootDesignSnapshot: CorosWatchfaceDesignState,
    mode: WatchfacePreviewMode = "current",
    snapshotBackgroundDataUrl?: string,
    outputSize = 800
  ): Promise<string> {
    if (!details) {
      throw new Error("The editor is still loading. Try again in a moment.");
    }
    const designSnapshot = resolveWatchfaceModeDesign(rootDesignSnapshot, mode);
    const snapshotSourceDetails = detailsForCompositionMode(
      applyConfigTextEditsToDetails(
        details,
        rootDesignSnapshot.configTextEdits
      ),
      mode
    );
    const snapshotDetails = deriveDesignDetails(
      snapshotSourceDetails,
      designSnapshot
    );
    const snapshotPreviewDetails = snapshotDetails.previewDetails;
    const snapshotBaseResolution = pickPreviewResolution(snapshotPreviewDetails);
    const snapshotTargetResolution =
      snapshotPreviewDetails?.resolutions.find(
        (resolution) => resolution.directory === watchPreviewDirectory
      ) ??
      (snapshotPreviewDetails
        ? pickWatchPreviewResolution(snapshotPreviewDetails)
        : null);
    const exportDetails =
      snapshotPreviewDetails && snapshotTargetResolution
        ? detailsForPreviewResolution(
            snapshotPreviewDetails,
            snapshotTargetResolution.directory
          )
        : snapshotPreviewDetails ?? snapshotSourceDetails;
    const renderedBackground =
      snapshotBackgroundDataUrl ??
      (await renderDesignBackground(
        designSnapshot,
        snapshotBaseResolution?.width ?? previewWidth
      ));
    const archivePreview = document.createElement("canvas");
    archivePreview.width = outputSize;
    archivePreview.height = outputSize;
    const snapshotOptions = toStudioOptions(designSnapshot);
    const resolutionScale =
      snapshotBaseResolution && snapshotTargetResolution
        ? snapshotTargetResolution.width / snapshotBaseResolution.width
        : 1;
    const exportOptions: WatchfaceStudioOptions = {
      ...snapshotOptions,
      previewMode: mode,
      batteryIconResolutionScale: resolutionScale,
      effectResolutionScale: resolutionScale,
      nativeSpriteResolutionScale: resolutionScale,
      ...(snapshotOptions.ampmStyle &&
      snapshotBaseResolution &&
      snapshotTargetResolution
        ? {
            ampmStyle: scaleAmPmStyleForResolution(
              snapshotOptions.ampmStyle,
              snapshotBaseResolution,
              snapshotTargetResolution
            )
          }
        : {})
    };
    await drawStudioPreview(
      archivePreview,
      renderedBackground,
      exportDetails,
      exportOptions,
      loadAssets
    );
    if (designSnapshot.weatherIndicator?.enabled) {
      const url = await weatherPreviewDataUrl(
        snapshotBaseResolution?.width ?? previewWidth,
        designSnapshot.weatherIndicator.color
      );
      if (url) {
        const image = await loadStudioImage(url);
        drawWeatherPreviewLayer(
          archivePreview,
          image,
          designSnapshot,
          snapshotBaseResolution?.width ?? previewWidth
        );
      }
    }
    maskCanvasToCircle(archivePreview);
    return archivePreview.toDataURL("image/png");
  }

  async function renderExportBackground(
    snapshotBackgroundDataUrl: string
  ): Promise<string> {
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
      await loadStudioImage(snapshotBackgroundDataUrl, false),
      0,
      0,
      exportBackground.width,
      exportBackground.height
    );
    maskCanvasToCircle(exportBackground);
    return exportBackground.toDataURL("image/png");
  }

  async function openExportPreview() {
    if (spriteImportTrackerRef.current.pendingCount > 0) {
      onError("Wait for the sprite import to finish before previewing.");
      return;
    }
    const designSnapshot = historyRef.current.present.value.design;
    setPreviewingExport(true);
    try {
      const [current, aod] = await Promise.all([
        renderExportPreview(designSnapshot, "current"),
        renderExportPreview(designSnapshot, "aod")
      ]);
      setExportPreviewImages({ current, aod });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not render the export preview.");
    } finally {
      setPreviewingExport(false);
    }
  }

  async function exportEditableProject() {
    if (spriteImportTrackerRef.current.pendingCount > 0) {
      onError("Wait for the sprite import to finish before exporting.");
      return;
    }
    if (!details || !backgroundDataUrl) {
      onError("The editor is still loading. Try again in a moment.");
      return;
    }
    const editorSnapshot = historyRef.current.present.value;
    const designSnapshot = editorSnapshot.design;
    setExporting(true);
    try {
      const name = editorSnapshot.projectName.trim() || "Custom watch face";
      const result = await api.exportCorosWatchfaceProject({
        sourceArchiveId: starterArchive.archiveId,
        name,
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
        design: designSnapshot,
        previewDataUrl: await renderExportPreview(designSnapshot, "current")
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
    if (spriteImportTrackerRef.current.pendingCount > 0) {
      onError("Wait for the sprite import to finish before building.");
      return;
    }
    if (!details || !backgroundDataUrl) {
      onError("The editor is still loading. Try again in a moment.");
      return;
    }
    const editorSnapshot = historyRef.current.present.value;
    const designSnapshot = editorSnapshot.design;
    setCreating(true);
    try {
      const templateIdOverride = devTemplateIdOverride.trim();
      const watchfaceIdOverride = devWatchfaceIdOverride.trim();
      const templateNameOverride = devTemplateNameOverride.trim();
      if (
        templateIdOverride &&
        (!/^\d{1,20}$/.test(templateIdOverride) || /^0+$/.test(templateIdOverride))
      ) {
        throw new Error("Template ID overrides must contain 1-20 decimal digits.");
      }
      if (
        watchfaceIdOverride &&
        !/^0x[0-9a-fA-F]{1,8}$/i.test(watchfaceIdOverride) &&
        !/^(?:0|[1-9]\d{0,9})$/.test(watchfaceIdOverride)
      ) {
        throw new Error(
          "Watch-face ID overrides must be a 32-bit decimal or 0x hex value."
        );
      }
      if (templateNameOverride.length > 64) {
        throw new Error("Template name overrides must be 64 characters or fewer.");
      }
      const configTextReplacements = Object.entries(
        designSnapshot.configTextEdits ?? {}
      )
        .filter(
          ([path, text]) =>
            Object.prototype.hasOwnProperty.call(configTextBaselines, path) &&
            configTextBaselines[path] !== text
        )
        .map(([path, text]) => ({ path, text }));
      const exportSourceDetails = applyConfigTextEditsToDetails(
        details,
        designSnapshot.configTextEdits
      );
      const currentDesign = resolveWatchfaceModeDesign(
        designSnapshot,
        "current"
      );
      const currentDetails = detailsForCompositionMode(
        exportSourceDetails,
        "current"
      );
      const [rawCurrentComposition, snapshotBackground] = await Promise.all([
        composeWatchfaceReplacements(
          currentDetails,
          currentDesign,
          loadAssets
        ),
        renderDesignBackground(
          currentDesign,
          pickPreviewResolution(currentDetails)?.width ?? previewWidth
        )
      ]);
      const currentComposition = hasWatchfaceAod(exportSourceDetails)
        ? retargetWatchfaceCompositionToCurrent(
            currentDetails,
            rawCurrentComposition
          )
        : rawCurrentComposition;
      let aodComposition:
        | Awaited<ReturnType<typeof composeWatchfaceReplacements>>
        | undefined;
      if (hasWatchfaceAod(exportSourceDetails) && designSnapshot.modeDesigns?.aod) {
        const aodDetails = detailsForCompositionMode(
          exportSourceDetails,
          "aod"
        );
        const aodDesign = resolveWatchfaceModeDesign(designSnapshot, "aod");
        const retargetedAodComposition = retargetWatchfaceCompositionToAod(
          aodDetails,
          await composeWatchfaceReplacements(aodDetails, aodDesign, loadAssets)
        );
        aodComposition = {
          ...retargetedAodComposition,
          assetReplacements: await buildAodSafeSpriteReplacements(
            retargetedAodComposition.assetReplacements
          )
        };
        if (designSnapshot.modeDesigns.aod.backgroundEdited) {
          const aodBackground = await renderDesignBackground(
            aodDesign,
            pickPreviewResolution(aodDetails)?.width ?? previewWidth
          );
          const backgroundComposition = await buildAodBackgroundComposition(
            aodDetails,
            aodBackground
          );
          aodComposition = {
            ...aodComposition,
            assetReplacements: mergeAssetReplacements(
              aodComposition.assetReplacements,
              backgroundComposition.assetReplacements
            ),
            configOverrides: mergeConfigOverrides(
              aodComposition.configOverrides,
              backgroundComposition.configOverrides
            )
          };
        }
      }
      const composition = {
        assetReplacements: mergeAssetReplacements(
          currentComposition.assetReplacements,
          aodComposition?.assetReplacements ?? []
        ),
        configOverrides: mergeConfigOverrides(
          currentComposition.configOverrides,
          aodComposition?.configOverrides ?? []
        ),
        minWatchFaceVersion: Math.max(
          currentComposition.minWatchFaceVersion ?? 0,
          aodComposition?.minWatchFaceVersion ?? 0
        ) || undefined
      };
      const [exportPreview, exportBackground] = await Promise.all([
        renderExportPreview(designSnapshot, "current", snapshotBackground),
        renderExportBackground(snapshotBackground)
      ]);
      const {
        assetReplacements,
        configOverrides: composedConfigOverrides,
        minWatchFaceVersion
      } = composition;
      // Enforce direct-asset visibility at the final renderer → Electron
      // boundary. This deliberately repeats the compose-stage visibility pass:
      // saved PACE 4 projects may contain the same analog overlay in current
      // and AOD configs, and no later composition step may be allowed to drop
      // those deletion sentinels before the archive service receives them.
      const configOverrides = mergeConfigOverrides(
        composedConfigOverrides,
        buildDisabledWatchfaceConfigAssetOverrides(
          currentDetails,
          currentDesign.configAssetOverrides ?? {}
        ),
        buildDisabledControlComplicationOverrides(
          currentDetails,
          currentDesign
        )
      );
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl: exportBackground,
        previewDataUrl: exportPreview,
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
        ...(targetWatchModel ? { watchModel: targetWatchModel } : {}),
        ...(designSnapshot.archiveWatchFaceVersion !== undefined
          ? { watchFaceVersion: designSnapshot.archiveWatchFaceVersion }
          : {}),
        ...(templateIdOverride ? { templateIdOverride } : {}),
        ...(watchfaceIdOverride ? { watchfaceIdOverride } : {}),
        ...(templateNameOverride ? { templateNameOverride } : {}),
        ...(designSnapshot.stripBlankConfigKeys
          ? { stripBlankConfigKeys: true }
          : {}),
        ...(assetReplacements.length > 0 ? { assetReplacements } : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {}),
        ...(configTextReplacements.length > 0
          ? { configTextReplacements }
          : {}),
        ...(minWatchFaceVersion !== undefined ? { minWatchFaceVersion } : {})
      });
      onArchiveCreated?.(archive);
      const name = editorSnapshot.projectName.trim() || "Custom watch face";
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
    if (spriteImportTrackerRef.current.pendingCount > 0) {
      onError("Wait for the sprite import to finish before saving.");
      return false;
    }
    const editorSnapshot = historyRef.current.present.value;
    const designSnapshot = editorSnapshot.design;
    const name = editorSnapshot.projectName.trim();
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
      let previewDataUrl: string | undefined;
      try {
        previewDataUrl = await renderExportPreview(
          designSnapshot,
          "current",
          undefined,
          PROJECT_THUMBNAIL_SIZE
        );
      } catch {
        // Saving the editable project remains more important than its cache.
        // The projects dashboard can rebuild a missing preview once.
      }
      const saved = await api.saveCorosWatchfaceProject({
        ...(projectId ? { projectId } : {}),
        name,
        sourceArchiveId: starterArchive.archiveId,
        ...(targetFirmwareType ? { firmwareType: targetFirmwareType } : {}),
        design: designSnapshot,
        ...(previewDataUrl ? { previewDataUrl } : {})
      });
      setProjectId(saved.projectId);
      const currentHistory = historyRef.current;
      const snapshotIsStillCurrent =
        currentHistory.present.value.design === designSnapshot &&
        currentHistory.present.value.projectName === editorSnapshot.projectName;
      if (snapshotIsStillCurrent) {
        const savedHistory = recordWatchfaceEditorHistory(currentHistory, {
          ...editorSnapshot,
          projectName: saved.name
        });
        applyHistory(savedHistory);
        setCheckpoint(createWatchfaceEditorCheckpoint(savedHistory, sessionId));
      }
      onProjectSaved?.(saved);
      onNotice(
        snapshotIsStillCurrent
          ? `Saved project “${saved.name}”.`
          : `Saved project “${saved.name}”; newer edits remain unsaved.`
      );
      return snapshotIsStillCurrent;
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
      artworkLayerOrder: resolveWatchfaceArtworkLayerOrder(current).filter(
        (id) => !removedEditorIds.has(id)
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
      ),
      layerStrokes: Object.fromEntries(
        Object.entries(current.layerStrokes ?? {}).filter(
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
      if (command && key === "d" && selectedSprite) {
        event.preventDefault();
        duplicateSprite(selectedSprite.id);
        return;
      }
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
            {spriteImportPending ? "Importing sprites…" : isDirty ? "Unsaved" : "Saved"}
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
          <div className="wf-history-controls" role="group" aria-label="Edit history">
            <button className="wf-icon-button" type="button" disabled={!canUndo} aria-label="Undo" title="Undo" onClick={undo}>
              <Undo2 size={17} />
            </button>
            <button className="wf-icon-button" type="button" disabled={!canRedo} aria-label="Redo" title="Redo" onClick={redo}>
              <Redo2 size={17} />
            </button>
          </div>
          <button className="secondary-button wf-save-button" type="button" disabled={saving || spriteImportPending || !isDirty} onClick={() => void saveProject()}>
            {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            Save
          </button>
          <div className="wf-export-menu" ref={exportMenuRef}>
            <button
              className="secondary-button wf-export-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              disabled={spriteImportPending || creating || exporting || previewingExport || !backgroundDataUrl}
              onClick={() => setExportMenuOpen((open) => !open)}
            >
              {exporting || previewingExport ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
              Export
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {exportMenuOpen ? (
              <div className="wf-export-popover" role="menu" aria-label="Export options">
                <button
                  type="button"
                  role="menuitem"
                  disabled={spriteImportPending || previewingExport || creating || exporting || !backgroundDataUrl}
                  onClick={() => { setExportMenuOpen(false); void openExportPreview(); }}
                >
                  <Eye size={15} aria-hidden="true" /> Preview export
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={spriteImportPending || creating || exporting || !backgroundDataUrl}
                  onClick={() => { setExportMenuOpen(false); void exportEditableProject(); }}
                >
                  <Download size={15} aria-hidden="true" /> Editable project ZIP
                </button>
                {showDevelopmentTools ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={spriteImportPending || creating || exporting || !backgroundDataUrl}
                    onClick={() => { setExportMenuOpen(false); void createArchive("export"); }}
                  >
                    <Package size={15} aria-hidden="true" /> Final watch ZIP (dev)
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <button className="primary-button wf-send-button" type="button" disabled={spriteImportPending || creating || exporting || !backgroundDataUrl} onClick={() => void createArchive()}>
            {creating ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
            Send to COROS
          </button>
        </div>
      </header>

      <div className="watchface-editor-grid wf-studio-grid">
        <aside className={`watchface-editor-layers wf-pane wf-layers-pane${layersOpen ? " is-open" : ""}`} aria-label="Layers">
          <div className="watchface-editor-pane-heading wf-pane-heading">
            <div className="wf-pane-heading-main">
              <span className="wf-pane-heading-icon" aria-hidden="true">
                <Layers size={14} />
              </span>
              <p className="watchface-editor-pane-title">Layers</p>
              <span
                className="wf-pane-count"
                aria-label={
                  previewMode === "aod"
                    ? supportsAod
                      ? `${layers.length} always-on assets`
                      : "Uses the current face"
                    : `${layers.length + activeBackgroundElements.length} items`
                }
              >
                {previewMode === "aod"
                  ? supportsAod
                    ? layers.length
                    : "Current"
                  : layers.length + activeBackgroundElements.length}
              </span>
            </div>
            {canEditActiveMode ? <div className="wf-add-menu">
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
                <li className="wf-layer-group">
                  <button
                    type="button"
                    className="wf-layer-section-toggle"
                    aria-expanded={!collapsedLayerSections.has("Groups")}
                    onClick={() => toggleLayerSection("Groups")}
                  >
                    <ChevronDown
                      className={collapsedLayerSections.has("Groups") ? "is-collapsed" : ""}
                      size={13}
                      aria-hidden="true"
                    />
                    <span>Groups</span>
                    <span className="wf-layer-section-count">
                      {visibleEditorGroups.length}
                    </span>
                  </button>
                </li>
              ) : null}
              {!collapsedLayerSections.has("Groups")
                ? visibleEditorGroups.map((group) => {
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
                      onContextMenu={(event) =>
                        openLayerContextMenu(event, group.layerIds.at(-1) ?? "")
                      }
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
                      {locked ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>
                    <button
                      type="button"
                      className="watchface-layer-visibility"
                      disabled={group.layerIds.some(isPositionLocked)}
                      aria-label={visible ? `Hide ${group.name}` : `Show ${group.name}`}
                      onClick={() => toggleEditorGroupVisibility(group.id)}
                    >
                      {visible ? <Eye size={15} /> : <EyeOff size={15} />}
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
                })
                : null}
              {groupLayersForDisplay(
                layers.filter((layer) => !groupedEditorLayerIds.has(layer.id))
              ).map(({ label: group, layers: groupedLayers }) => {
                const collapsed = collapsedLayerSections.has(group);
                return (
                  <Fragment key={group}>
                    <li className="wf-layer-group">
                      <button
                        type="button"
                        className="wf-layer-section-toggle"
                        aria-expanded={!collapsed}
                        onClick={() => toggleLayerSection(group)}
                      >
                        <ChevronDown
                          className={collapsed ? "is-collapsed" : ""}
                          size={13}
                          aria-hidden="true"
                        />
                        <span>{group}</span>
                        <span className="wf-layer-section-count">
                          {groupedLayers.length}
                        </span>
                      </button>
                    </li>
                    {collapsed ? null : groupedLayers.map((layer) => {
                    const authoredLayer =
                      layer.kind === "customSprite" ||
                      layer.kind === "backgroundElement";
                    const reorderable =
                      authoredLayer &&
                      !isPositionLocked(layer.id);
                    const dropPlacement =
                      authoredLayer &&
                      layerDropTarget?.layerId === layer.id
                        ? layerDropTarget.placement
                        : null;
                    return (
                    <li
                      key={layer.id}
                      className={[
                        "wf-layer-item",
                        reorderable ? "is-reorderable" : "",
                        layer.id === draggedArtworkLayerId ? "is-dragging" : "",
                        dropPlacement ? `is-drop-${dropPlacement}` : ""
                      ].filter(Boolean).join(" ")}
                      draggable={reorderable}
                      onDragStart={(event) => {
                        if (!reorderable) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", layer.id);
                        setDraggedArtworkLayerId(layer.id);
                        setLayerDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        if (
                          !authoredLayer ||
                          !draggedArtworkLayerId ||
                          draggedArtworkLayerId === layer.id
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setLayerDropTarget({
                          layerId: layer.id,
                          placement:
                            event.clientY < bounds.top + bounds.height / 2
                              ? "before"
                              : "after"
                        });
                      }}
                      onDrop={(event) => {
                        if (!authoredLayer) return;
                        const draggedLayerId =
                          draggedArtworkLayerId ||
                          event.dataTransfer.getData("text/plain");
                        if (!draggedLayerId || draggedLayerId === layer.id) {
                          setDraggedArtworkLayerId(null);
                          setLayerDropTarget(null);
                          return;
                        }
                        event.preventDefault();
                        const bounds = event.currentTarget.getBoundingClientRect();
                        reorderArtworkLayer(
                          draggedLayerId,
                          layer.id,
                          event.clientY < bounds.top + bounds.height / 2
                            ? "before"
                            : "after"
                        );
                        setDraggedArtworkLayerId(null);
                        setLayerDropTarget(null);
                      }}
                      onDragEnd={() => {
                        setDraggedArtworkLayerId(null);
                        setLayerDropTarget(null);
                      }}
                    >
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
                    </li>
                    );
                    })}
                  </Fragment>
                );
              })}
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
              <button type="button" aria-label="Zoom out" onClick={() => setStageZoom((zoom) => Math.max(0.6, (zoom === "fit" ? 1 : zoom) - 0.1))}><Minus size={15} aria-hidden="true" /></button>
              <button type="button" aria-label="Zoom in" onClick={() => setStageZoom((zoom) => Math.min(1.4, (zoom === "fit" ? 1 : zoom) + 0.1))}><Plus size={15} aria-hidden="true" /></button>
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
            {canEditActiveMode ? <div className="wf-placement-menu" ref={placementMenuRef}>
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
          {canEditActiveMode && selectedMovableIds.some((id) => !isPositionLocked(id)) ? (
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
            {canEditActiveMode && placementPreferences.guidesVisible ? (
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
            <svg
              className="wf-component-bounds-overlay"
              viewBox={`0 0 ${previewWidth} ${previewHeight}`}
              aria-hidden="true"
              focusable="false"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
            >
              {componentBoundsOutlines.map(
                ({ id, bounds, active, draggable, selector }) => (
                  <Fragment key={id}>
                    <rect
                      className={`wf-component-bounds-box${
                        selector
                          ? " is-selector"
                          : active
                            ? " is-selected"
                            : " is-hovered"
                      }`}
                      x={bounds.x0}
                      y={bounds.y0}
                      width={Math.max(1, bounds.x1 - bounds.x0)}
                      height={Math.max(1, bounds.y1 - bounds.y0)}
                    />
                    {active && draggable ? (
                      <rect
                        className="wf-component-bounds-hitbox"
                        x={bounds.x0}
                        y={bounds.y0}
                        width={Math.max(1, bounds.x1 - bounds.x0)}
                        height={Math.max(1, bounds.y1 - bounds.y0)}
                      />
                    ) : null}
                  </Fragment>
                )
              )}
              <rect
                ref={componentDragBoundsRef}
                className="wf-component-bounds-box is-selected wf-component-drag-bounds"
                x="0"
                y="0"
                width="1"
                height="1"
              />
            </svg>
            {spriteTransform && selectedSpriteCanTransform && canEditActiveMode ? (
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
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div role="menu" aria-label="Component actions">
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
                {selectedSprite ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={(design.designSprites ?? []).length >= MAX_DESIGN_SPRITES}
                    onClick={() => duplicateSprite(selectedSprite.id)}
                  >
                    <Copy size={15} aria-hidden="true" />
                    <span>Duplicate image</span>
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
              </div>
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
            <div className="wf-pane-heading-main">
              <span className="wf-pane-heading-icon" aria-hidden="true">
                <SlidersHorizontal size={14} />
              </span>
              <p className="watchface-editor-pane-title">Properties</p>
            </div>
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
          {(() => {
            const editorDirectory =
              configEditorDirectory ||
              watchPreviewDirectory ||
              details?.resolutions[0]?.directory ||
              "";
            const currentPath = editorDirectory
              ? `${editorDirectory}/config.txt`
              : "";
            const aodPath = editorDirectory
              ? `${editorDirectory}/AODconfig.txt`
              : "";
            const activePath =
              previewMode === "aod" && aodPath in configTextBaselines
                ? aodPath
                : currentPath;
            const hasCurrentConfig = Boolean(
              currentPath && currentPath in configTextBaselines
            );
            const hasAodConfig = Boolean(
              aodPath && aodPath in configTextBaselines
            );
            const activeText =
              (activePath &&
                (design.configTextEdits?.[activePath] ??
                  configTextBaselines[activePath])) ||
              "";
            const activeIsDirty = Boolean(
              activePath &&
                design.configTextEdits &&
                Object.prototype.hasOwnProperty.call(
                  design.configTextEdits,
                  activePath
                ) &&
                design.configTextEdits[activePath] !==
                  configTextBaselines[activePath]
            );
            const resolutionOptions = details?.resolutions ?? [];
            return (
              <details
                className="watchface-inspector-group wf-archive-settings wf-raw-config-editor"
                open={!selectedElement && !selectedLayer}
              >
                <summary className="wf-inspector-heading">Config files</summary>
                <p className="wf-archive-note">
                  Edit the template’s raw layout files. Studio layer moves still
                  apply on top when you export.
                </p>
                {resolutionOptions.length > 1 ? (
                  <label className="field">
                    Resolution
                    <select
                      value={editorDirectory}
                      onChange={(event) =>
                        setConfigEditorDirectory(event.target.value)
                      }
                    >
                      {resolutionOptions.map((resolution) => (
                        <option
                          key={resolution.directory}
                          value={resolution.directory}
                        >
                          {resolution.width}×{resolution.height}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div
                  className="wf-preview-mode-switch wf-raw-config-tabs"
                  role="tablist"
                  aria-label="Config file"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "current"}
                    aria-pressed={previewMode === "current"}
                    disabled={!hasCurrentConfig}
                    onClick={() => setPreviewMode("current")}
                  >
                    Current
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewMode === "aod"}
                    aria-pressed={previewMode === "aod"}
                    disabled={!hasAodConfig}
                    onClick={() => setPreviewMode("aod")}
                  >
                    AOD
                  </button>
                </div>
                <p className="wf-archive-note">
                  <code>{activePath || "Not selected"}</code>
                  {activeIsDirty ? " · edited" : ""}
                </p>
                {activePath &&
                (previewMode === "aod" ? hasAodConfig : hasCurrentConfig) ? (
                  <>
                    <label className="field">
                      Raw config
                      <textarea
                        className="wf-raw-config-textarea"
                        spellCheck={false}
                        rows={16}
                        value={activeText}
                        onChange={(event) => {
                          const nextText = event.target.value;
                          const baseline = configTextBaselines[activePath] ?? "";
                          const currentEdits = design.configTextEdits ?? {};
                          if (nextText === baseline) {
                            if (
                              !Object.prototype.hasOwnProperty.call(
                                currentEdits,
                                activePath
                              )
                            ) {
                              return;
                            }
                            const { [activePath]: _removed, ...rest } =
                              currentEdits;
                            patchDesign({
                              configTextEdits:
                                Object.keys(rest).length > 0 ? rest : undefined
                            });
                            return;
                          }
                          patchDesign({
                            configTextEdits: {
                              ...currentEdits,
                              [activePath]: nextText
                            }
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!activeIsDirty}
                      onClick={() => {
                        const currentEdits = design.configTextEdits ?? {};
                        if (
                          !Object.prototype.hasOwnProperty.call(
                            currentEdits,
                            activePath
                          )
                        ) {
                          return;
                        }
                        const { [activePath]: _removed, ...rest } = currentEdits;
                        patchDesign({
                          configTextEdits:
                            Object.keys(rest).length > 0 ? rest : undefined
                        });
                      }}
                    >
                      Reset file
                    </button>
                  </>
                ) : (
                  <p className="wf-archive-note">
                    {previewMode === "aod"
                      ? "This resolution has no AODconfig.txt."
                      : "This resolution has no config.txt."}
                  </p>
                )}
              </details>
            );
          })()}
          <details className="watchface-inspector-group wf-archive-settings" open={!selectedElement && !selectedLayer}>
            <summary className="wf-inspector-heading">Archive</summary>
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
            <label className="watchface-studio-toggle">
              <input
                type="checkbox"
                checked={design.stripBlankConfigKeys ?? false}
                onChange={(event) =>
                  patchDesign({
                    stripBlankConfigKeys: event.target.checked || undefined
                  })
                }
              />
              Remove blank config fields on build
            </label>
            <p className="wf-archive-note">
              Deletes every empty <code>[key]=</code> line from{" "}
              <code>config.txt</code> and <code>AODconfig.txt</code> in the
              built archive. The watch treats declared-but-empty keys as
              enabled features. An empty <code>control_*</code> group still
              adds a blank entry to the on-watch data selector.
            </p>
            <label className="field">
              Template ID override (info.json)
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={20}
                placeholder={starterArchive.sourceTemplateId}
                value={devTemplateIdOverride}
                onChange={(event) =>
                  setDevTemplateIdOverride(
                    event.target.value.replace(/\D/g, "").slice(0, 20)
                  )
                }
              />
            </label>
            <p className="wf-archive-note">
              Rewrites <code>o_template_id</code> in <code>info.json</code>.
              Leave blank to keep <code>{starterArchive.sourceTemplateId}</code>.
            </p>
            <label className="field">
              Watch-face ID override (config + AOD)
              <input
                type="text"
                maxLength={10}
                placeholder={
                  details?.resolutions.find(
                    (resolution) => resolution.aodConfig.watchface_id
                  )?.aodConfig.watchface_id ??
                  details?.resolutions.find(
                    (resolution) => resolution.config.watchface_id
                  )?.config.watchface_id ??
                  "0x3B9ACE60"
                }
                value={devWatchfaceIdOverride}
                onChange={(event) =>
                  setDevWatchfaceIdOverride(
                    event.target.value.replace(/[^0-9a-fxA-FX]/g, "").slice(0, 10)
                  )
                }
              />
            </label>
            <p className="wf-archive-note">
              Rewrites <code>[watchface_id]</code> in every{" "}
              <code>config.txt</code> and <code>AODconfig.txt</code> so current
              and always-on match. Accepts decimal or <code>0x</code> hex (for
              example <code>54</code> or <code>0x3B9ACE60</code>).
            </p>
            <label className="field">
              Template manifest name override (info.json)
              <input
                type="text"
                maxLength={64}
                placeholder="TOP PART"
                value={devTemplateNameOverride}
                onChange={(event) =>
                  setDevTemplateNameOverride(event.target.value.slice(0, 64))
                }
              />
            </label>
            <p className="wf-archive-note">
              Rewrites <code>m_name</code> in <code>info.json</code>; it does not
              rename the Studio project.
            </p>
          </details>
        </aside>
      </div>

      {(layersOpen || propertiesOpen) ? (
        <button className="wf-sheet-scrim is-open" type="button" aria-label="Close editor panel" onClick={() => { setLayersOpen(false); setPropertiesOpen(false); }} />
      ) : null}

      {exportPreviewImages ? (
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
                  <img src={exportPreviewImages.current} alt="COROS app archive preview" />
                </div>
                <p>The exact 800 × 800 <code>watchface_customize.png</code> included in the archive, rendered from Current.</p>
              </article>
              <article>
                <div className="wf-export-preview-label">
                  <strong>Current</strong>
                  <span>On-watch display</span>
                </div>
                <div className="wf-export-watch-preview">
                  <img src={exportPreviewImages.current} alt="Current on-watch preview" />
                </div>
                <p>How Current is cropped on the selected watch display.</p>
              </article>
              <article>
                <div className="wf-export-preview-label">
                  <strong>Always-on</strong>
                  <span>{supportsAod ? "AODconfig.txt" : "Uses Current"}</span>
                </div>
                <div className="wf-export-watch-preview">
                  <img src={exportPreviewImages.aod} alt="Always-on display preview" />
                </div>
                <p>
                  {supportsAod
                    ? "The independent always-on layout rendered from AODconfig.txt."
                    : "This template has no separate AODconfig.txt, so Current remains visible."}
                </p>
              </article>
            </div>
            <div className="wf-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setExportPreviewImages(null)}>
                Close
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={spriteImportPending || exporting}
                onClick={() => {
                  setExportPreviewImages(null);
                  void exportEditableProject();
                }}
              >
                {exporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
                Export editable ZIP
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={spriteImportPending || creating}
                onClick={() => {
                  setExportPreviewImages(null);
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
              <button className="primary-button" type="button" disabled={saving || spriteImportPending} onClick={() => void saveProject().then((saved) => { if (saved) onBack(); })}>
                {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );

  function layerGroupLabel(layer: EditorLayer): string {
    if (
      layer.kind === "background" ||
      layer.kind === "backgroundElement" ||
      layer.kind === "customSprite"
    ) return "Artwork";
    if (layer.kind === "configAsset") {
      return previewMode === "aod" ? "Always-on assets" : "Template assets";
    }
    if (
      layer.kind === "date" ||
      layer.kind === "weekday" ||
      layer.id === "staticDateSlash"
    ) {
      return "Date";
    }
    if (
      layer.kind === "time" ||
      layer.kind === "seconds" ||
      layer.kind === "separators"
    ) {
      return "Time";
    }
    if (
      layer.kind === "batteryIcon" ||
      layer.kind === "controlBatteryIcon" ||
      layer.kind === "weather"
    ) {
      return "Indicators";
    }
    return "Metrics";
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
    const sections = [...groups].map(([label, groupLayers]) => {
      if (label === "Template assets" || label === "Always-on assets") {
        return {
          label,
          layers: [...groupLayers].sort((left, right) =>
            left.label.localeCompare(right.label)
          )
        };
      }
      if (label !== "Artwork") {
        const layerOrder: Record<string, string[]> = {
          Time: [
            "autoTime",
            "hours",
            "minutes",
            "seconds",
            "ampm",
            "separators",
            "staticColon"
          ],
          Date: ["weekday", "dateMonth", "dateDay", "staticDateSlash"],
          Metrics: [
            "complication",
            "battery",
            "heartRate",
            "steps",
            "calories",
            "elevation",
            "temperature"
          ],
          Indicators: ["weather", "batteryIcon", "controlBatteryIcon"]
        };
        const order = layerOrder[label] ?? [];
        return {
          label,
          layers: groupLayers
            .map((layer, sourceIndex) => ({ layer, sourceIndex }))
            .sort((left, right) => {
              const leftIndex = order.indexOf(left.layer.id);
              const rightIndex = order.indexOf(right.layer.id);
              if (leftIndex < 0 && rightIndex < 0) {
                return left.sourceIndex - right.sourceIndex;
              }
              if (leftIndex < 0) return 1;
              if (rightIndex < 0) return -1;
              return leftIndex - rightIndex;
            })
            .map(({ layer }) => layer)
        };
      }
      const authoredLayers = [
        ...groupLayers.filter((layer) => layer.kind === "customSprite"),
        ...backgroundElements
          .filter(
            (element) =>
              !groupedEditorLayerIds.has(
                watchfaceBackgroundElementLayerId(element.id)
              )
          )
          .map<EditorLayer>((element) => ({
            id: watchfaceBackgroundElementLayerId(element.id),
            kind: "backgroundElement",
            label: backgroundElementLabel(element),
            backgroundElementId: element.id,
            visible: element.visible !== false,
            canHide: true,
            present: true,
            bounds: null,
            capabilities: {
              position: true,
              color: false,
              scale: false,
              font: element.kind === "text",
              resize: element.kind === "rect" || element.kind === "ellipse",
              rotate: true,
              opacity: true,
              grouping: true,
              effects: true,
              stroke: true
            }
          }))
      ];
      const authoredById = new Map(
        authoredLayers.map((layer) => [layer.id, layer])
      );
      const orderedAuthoredLayers = resolveWatchfaceArtworkLayerOrder(design)
        .slice()
        .reverse()
        .flatMap((id) => {
          const layer = authoredById.get(id);
          return layer ? [layer] : [];
        });
      return {
        label,
        layers: [
          ...groupLayers.filter(
            (layer) =>
              layer.kind !== "customSprite" &&
              layer.kind !== "backgroundElement"
          ),
          ...orderedAuthoredLayers
        ]
      };
    });
    const sectionOrder = [
      "Time",
      "Date",
      "Metrics",
      "Indicators",
      "Artwork",
      "Template assets",
      "Always-on assets"
    ];
    return sections.sort(
      (left, right) =>
        sectionOrder.indexOf(left.label) - sectionOrder.indexOf(right.label)
    );
  }

  function toggleLayerSection(section: string) {
    setCollapsedLayerSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function layerIcon(layer: EditorLayer) {
    if (
      layer.kind === "background" ||
      layer.kind === "customSprite" ||
      layer.kind === "configAsset"
    ) {
      return <Image size={14} />;
    }
    if (layer.kind === "backgroundElement") {
      const element = backgroundElements.find(
        (candidate) => candidate.id === layer.backgroundElementId
      );
      if (element?.kind === "text") return <Type size={14} />;
      if (element?.kind === "ellipse") return <Circle size={14} />;
      if (element?.kind === "line") return <Minus size={14} />;
      return <Square size={14} />;
    }
    if (
      layer.kind === "time" ||
      layer.kind === "seconds" ||
      layer.kind === "date" ||
      layer.kind === "weekday"
    ) {
      return <Type size={14} />;
    }
    if (
      layer.kind === "battery" ||
      layer.kind === "batteryIcon" ||
      layer.kind === "controlBatteryIcon"
    ) {
      return <Battery size={14} />;
    }
    return <Layers size={14} />;
  }

  function setInspectorSectionOpen(
    sectionId: WatchfaceInspectorSectionId,
    open: boolean
  ) {
    setCollapsedInspectorSections((current) => {
      const next = new Set(current);
      if (open) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function renderPropertySection(
    sectionId: WatchfaceInspectorSectionId,
    title: string,
    children: ReactNode,
    options?: {
      actions?: ReactNode;
      status?: ReactNode;
      disabled?: boolean;
      className?: string;
    }
  ) {
    return (
      <WatchfaceInspectorSection
        sectionId={sectionId}
        title={title}
        open={sectionId === "layer" || !collapsedInspectorSections.has(sectionId)}
        onOpenChange={(open) => setInspectorSectionOpen(sectionId, open)}
        actions={options?.actions}
        status={options?.status}
        disabled={options?.disabled}
        className={options?.className}
      >
        {children}
      </WatchfaceInspectorSection>
    );
  }

  function editorLayerTypeLabel(layer: EditorLayer): string {
    if (layer.backgroundElementId) {
      const element = backgroundElements.find(
        (candidate) => candidate.id === layer.backgroundElementId
      );
      if (element) {
        return {
          rect: "Rectangle",
          ellipse: "Ellipse",
          line: "Line",
          text: "Text"
        }[element.kind];
      }
    }
    if (layer.timePartId) return "Dynamic time";
    if (layer.metricId) return "Dynamic metric";
    if (layer.weatherIndicator) return "Dynamic weather";
    if (layer.ampmIndicator) return "Dynamic indicator";
    if (layer.staticSeparatorId) return "Text separator";
    return {
      background: "Background",
      backgroundElement: "Artwork object",
      time: "Dynamic time",
      date: "Dynamic date",
      weekday: "Dynamic date",
      seconds: "Dynamic time",
      separators: "Template separator",
      battery: "Dynamic metric",
      batteryIcon: "Battery sprite",
      controlBatteryIcon: "Selectable sprite",
      complication: "Selectable data",
      metric: "Dynamic metric",
      weather: "Dynamic weather",
      configAsset: "Template asset",
      customSprite: "Image"
    }[layer.kind];
  }

  function renderLayerSection(layer: EditorLayer) {
    const sprite = layer.spriteId
      ? (design.designSprites ?? []).find(
          (candidate) => candidate.id === layer.spriteId
        )
      : null;
    const locked = isPositionLocked(layer.id);
    const canLock = isMovableSelectionId(layer.id);
    const element = layer.backgroundElementId
      ? backgroundElements.find(
          (candidate) => candidate.id === layer.backgroundElementId
        )
      : null;
    const opacity = sprite
      ? normalizeWatchfaceOpacity(sprite.opacity)
      : element
        ? normalizeWatchfaceOpacity(element.opacity)
        : resolveWatchfaceLayerOpacity(design, layer.id);
    const setOpacity = (value: number) => {
      const normalizedOpacity = normalizeWatchfaceLayerOpacity(value);
      if (sprite) {
        updateSprite(sprite.id, { opacity: normalizedOpacity });
        return;
      }
      if (element) {
        updateElement(element.id, { opacity: normalizedOpacity });
        return;
      }
      setDesign((current) => {
        const layerOpacities = { ...(current.layerOpacities ?? {}) };
        if (normalizedOpacity === 1) delete layerOpacities[layer.id];
        else layerOpacities[layer.id] = normalizedOpacity;
        return { ...current, layerOpacities };
      });
    };
    const typeIcon =
      layer.kind === "date" || layer.kind === "weekday" ? (
        <CalendarDays size={12} />
      ) : (
        layerIcon(layer)
      );
    return renderPropertySection(
      "layer",
      "Layer",
      <div className="wf-property-stack">
        <div className="wf-layer-summary">
          <div className="wf-layer-property-icon" aria-hidden="true">
            {layerIcon(layer)}
          </div>
          <div className="wf-layer-property-main">
            {sprite ? (
              <label className="wf-layer-title-field">
                <span className="sr-only">Layer name</span>
                <input
                  type="text"
                  value={sprite.name ?? ""}
                  maxLength={60}
                  placeholder={watchfaceDesignSpriteName(sprite)}
                  disabled={locked}
                  onChange={(event) =>
                    updateSprite(sprite.id, { name: event.target.value })
                  }
                  onBlur={() => {
                    const name = sprite.name?.trim() || undefined;
                    if (name !== sprite.name) updateSprite(sprite.id, { name });
                  }}
                />
              </label>
            ) : (
              <strong className="wf-layer-title" title={layer.label}>
                {layer.label}
              </strong>
            )}
            <span className="wf-layer-type-badge">
              {typeIcon}
              {editorLayerTypeLabel(layer)}
            </span>
          </div>
          <div className="wf-layer-summary-actions">
            {layer.canHide ? (
              <button
                type="button"
                className="wf-property-icon-button"
                disabled={locked}
                aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.label}`}
                aria-pressed={!layer.visible}
                title={layer.visible ? "Hide layer" : "Show layer"}
                onClick={() => toggleLayerVisibility(layer)}
              >
                {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            ) : null}
            {canLock ? renderLayerPositionLockButton(layer.id, layer.label) : null}
          </div>
        </div>
        <label className="wf-layer-opacity-control">
          <span>Opacity</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(opacity * 100)}
            aria-label={`${layer.label} opacity`}
            onChange={(event) => setOpacity(Number(event.target.value) / 100)}
          />
          <span className="wf-input-with-unit">
            <EditableNumberInput
              min="0"
              max="100"
              step="1"
              value={Math.round(opacity * 100)}
              fallback={100}
              onValueChange={(nextOpacity) => setOpacity(nextOpacity / 100)}
            />
            <span>%</span>
          </span>
        </label>
      </div>
    );
  }

  function writeLayerStrokes(
    layerId: string,
    strokes: CorosWatchfaceStroke[]
  ) {
    setDesign((current) => {
      const layerStrokes = { ...(current.layerStrokes ?? {}) };
      if (strokes.length > 0) {
        layerStrokes[layerId] = strokes.map(normalizeWatchfaceStroke);
      } else {
        delete layerStrokes[layerId];
      }
      return { ...current, layerStrokes };
    });
  }

  function renderStrokeInspector(layerId: string) {
    const strokes = resolveWatchfaceLayerStrokes(design, layerId);
    const selectedStrokeId =
      selectedStrokeIds[layerId] &&
      strokes.some((stroke) => stroke.id === selectedStrokeIds[layerId])
        ? selectedStrokeIds[layerId]
        : strokes[0]?.id;
    const selectedStroke = strokes.find(
      (stroke) => stroke.id === selectedStrokeId
    );
    const selectedGradient =
      selectedStroke?.paint.kind === "linear-gradient"
        ? selectedStroke.paint
        : null;
    const selectStroke = (strokeId: string) =>
      setSelectedStrokeIds((current) => ({
        ...current,
        [layerId]: strokeId
      }));
    const patchStroke = (
      strokeId: string,
      patch: Partial<CorosWatchfaceStroke>
    ) =>
      writeLayerStrokes(
        layerId,
        strokes.map((stroke) =>
          stroke.id === strokeId
            ? normalizeWatchfaceStroke({ ...stroke, ...patch })
            : stroke
        )
      );
    const addStroke = () => {
      const stroke = createWatchfaceStroke(design.accentColor);
      writeLayerStrokes(layerId, [stroke, ...strokes]);
      selectStroke(stroke.id);
    };
    const removeStroke = (strokeId: string) => {
      const index = strokes.findIndex((stroke) => stroke.id === strokeId);
      const remaining = strokes.filter((stroke) => stroke.id !== strokeId);
      writeLayerStrokes(layerId, remaining);
      const next = remaining[Math.min(index, remaining.length - 1)];
      setSelectedStrokeIds((current) => {
        const selected = { ...current };
        if (next) selected[layerId] = next.id;
        else delete selected[layerId];
        return selected;
      });
    };
    const moveStroke = (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= strokes.length) return;
      const next = [...strokes];
      [next[index], next[target]] = [next[target]!, next[index]!];
      writeLayerStrokes(layerId, next);
    };
    const moveStrokeTo = (strokeId: string, targetId: string) => {
      if (strokeId === targetId) return;
      const sourceIndex = strokes.findIndex((stroke) => stroke.id === strokeId);
      const targetIndex = strokes.findIndex((stroke) => stroke.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const next = [...strokes];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved!);
      writeLayerStrokes(layerId, next);
    };
    const advancedOpen = advancedStrokeLayers.has(layerId);
    const toggleAdvanced = () =>
      setAdvancedStrokeLayers((current) => {
        const next = new Set(current);
        if (next.has(layerId)) next.delete(layerId);
        else next.add(layerId);
        return next;
      });
    const paintPreview = (
      stroke: CorosWatchfaceStroke
    ): CSSProperties => ({
      background:
        stroke.paint.kind === "solid"
          ? stroke.paint.color
          : `linear-gradient(${stroke.paint.angle + 90}deg, ${stroke.paint.from}, ${stroke.paint.to})`
    });
    const primaryColor = (stroke: CorosWatchfaceStroke) =>
      stroke.paint.kind === "solid" ? stroke.paint.color : stroke.paint.from;
    const patchPrimaryColor = (
      stroke: CorosWatchfaceStroke,
      color: string
    ) =>
      patchStroke(stroke.id, {
        paint:
          stroke.paint.kind === "solid"
            ? { kind: "solid", color }
            : { ...stroke.paint, from: color }
      });

    return renderPropertySection(
      "stroke",
      "Stroke",
      <div className="wf-stroke-inspector">
        {strokes.length > 0 ? (
          <div className="wf-stroke-stack">
            {strokes.map((stroke, index) => (
              <div
                className={`wf-stroke-row${
                  stroke.id === selectedStrokeId ? " is-selected" : ""
                }${stroke.enabled ? "" : " is-disabled"}`}
                key={stroke.id}
                draggable={strokes.length > 1}
                title={
                  strokes.length > 1
                    ? "Drag to reorder. Use Alt+Arrow Up or Alt+Arrow Down from a control."
                    : undefined
                }
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-watchface-stroke",
                    stroke.id
                  );
                }}
                onDragOver={(event) => {
                  if (
                    event.dataTransfer.types.includes(
                      "application/x-watchface-stroke"
                    )
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  const movedId = event.dataTransfer.getData(
                    "application/x-watchface-stroke"
                  );
                  if (!movedId) return;
                  event.preventDefault();
                  moveStrokeTo(movedId, stroke.id);
                }}
                onFocusCapture={() => selectStroke(stroke.id)}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveStroke(index, -1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveStroke(index, 1);
                  }
                }}
              >
                <div
                  className="wf-stroke-color-field"
                  onClick={() => selectStroke(stroke.id)}
                >
                  <span
                    className="wf-stroke-swatch"
                    style={paintPreview(stroke)}
                  >
                    <input
                      type="color"
                      value={primaryColor(stroke)}
                      aria-label="Stroke color"
                      onChange={(event) =>
                        patchPrimaryColor(stroke, event.target.value)
                      }
                    />
                  </span>
                  <EditableHexColorInput
                    className="wf-stroke-hex-input"
                    value={primaryColor(stroke)}
                    aria-label="Stroke hex color"
                    onValueChange={(color) => patchPrimaryColor(stroke, color)}
                  />
                </div>
                <label className="wf-stroke-opacity-field">
                  <EditableNumberInput
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(stroke.opacity * 100)}
                    fallback={100}
                    aria-label="Stroke opacity"
                    onValueChange={(opacity) =>
                      patchStroke(stroke.id, { opacity: opacity / 100 })
                    }
                  />
                  <span aria-hidden="true">%</span>
                </label>
                <button
                  type="button"
                  className="wf-stroke-row-action"
                  aria-label={stroke.enabled ? "Hide stroke" : "Show stroke"}
                  aria-pressed={!stroke.enabled}
                  title={stroke.enabled ? "Hide stroke" : "Show stroke"}
                  onClick={() =>
                    patchStroke(stroke.id, { enabled: !stroke.enabled })
                  }
                >
                  {stroke.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  type="button"
                  className="wf-stroke-row-action"
                  aria-label="Remove stroke"
                  title="Remove stroke"
                  onClick={() => removeStroke(stroke.id)}
                >
                  <Minus size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="wf-stroke-empty">
            <div>
              <strong>No stroke applied</strong>
              <p>Add a stroke to outline this layer&apos;s visible pixels.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={addStroke}
            >
              <Plus size={15} aria-hidden="true" />
              Add stroke
            </button>
          </div>
        )}
        {selectedStroke ? (
          <div className="wf-stroke-details">
            <div className="wf-stroke-geometry">
              <label className="wf-stroke-control">
                <span>Position</span>
                <select
                  value={selectedStroke.position}
                  onChange={(event) =>
                    patchStroke(selectedStroke.id, {
                      position: event.target
                        .value as CorosWatchfaceStroke["position"]
                    })
                  }
                >
                  <option value="inside">Inside</option>
                  <option value="center">Center</option>
                  <option value="outside">Outside</option>
                </select>
              </label>
              <label className="wf-stroke-control">
                <span>Weight</span>
                <span className="wf-stroke-weight-field">
                  <AlignJustify size={14} aria-hidden="true" />
                  <EditableNumberInput
                    min="1"
                    max="64"
                    step="1"
                    value={selectedStroke.weight}
                    fallback={1}
                    onValueChange={(weight) =>
                      patchStroke(selectedStroke.id, { weight })
                    }
                  />
                </span>
              </label>
              <button
                type="button"
                className={`wf-stroke-advanced-toggle${
                  advancedOpen ? " is-active" : ""
                }`}
                aria-label="Stroke paint settings"
                aria-expanded={advancedOpen}
                title="Stroke paint settings"
                onClick={toggleAdvanced}
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
            {advancedOpen ? (
              <div className="wf-stroke-advanced">
                <label className="field">
                  Paint
                  <select
                    value={selectedStroke.paint.kind}
                    onChange={(event) => {
                      if (event.target.value === "linear-gradient") {
                        const baseColor =
                          selectedStroke.paint.kind === "solid"
                            ? selectedStroke.paint.color
                            : selectedStroke.paint.from;
                        patchStroke(selectedStroke.id, {
                          paint: {
                            kind: "linear-gradient",
                            from: baseColor,
                            to: "#000000",
                            angle: 90
                          }
                        });
                      } else {
                        patchStroke(selectedStroke.id, {
                          paint: {
                            kind: "solid",
                            color:
                              selectedStroke.paint.kind === "linear-gradient"
                                ? selectedStroke.paint.from
                                : selectedStroke.paint.color
                          }
                        });
                      }
                    }}
                  >
                    <option value="solid">Solid color</option>
                    <option value="linear-gradient">Linear gradient</option>
                  </select>
                </label>
                {selectedGradient ? (
                  <>
                    <div className="wf-inline-property-grid">
                      {(["from", "to"] as const).map((stop) => (
                        <label className="field" key={stop}>
                          {stop === "from" ? "From" : "To"}
                          <span className="watchface-color-control">
                            <input
                              type="color"
                              value={selectedGradient[stop]}
                              onChange={(event) =>
                                patchStroke(selectedStroke.id, {
                                  paint: {
                                    ...selectedGradient,
                                    [stop]: event.target.value
                                  }
                                })
                              }
                            />
                            <code>
                              {selectedGradient[stop]
                                .replace(/^#/, "")
                                .toUpperCase()}
                            </code>
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="watchface-inspector-field">
                      <span>Angle</span>
                      <span className="wf-input-with-unit">
                        <EditableNumberInput
                          min="0"
                          max="359"
                          step="1"
                          value={selectedGradient.angle}
                          fallback={90}
                          onValueChange={(angle) =>
                            patchStroke(selectedStroke.id, {
                              paint: {
                                ...selectedGradient,
                                angle
                              }
                            })
                          }
                        />
                        <span>°</span>
                      </span>
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>,
      {
        className: "wf-stroke-section",
        actions: strokes.length > 0 ? (
          <>
            {strokes.length > 1 ? (
              <span
                className="wf-stroke-order-hint"
                title="Drag stroke rows to reorder"
                aria-label="Stroke rows can be dragged to reorder"
              >
                <GripVertical size={16} />
              </span>
            ) : null}
            <button
              type="button"
              className="wf-property-icon-button"
              aria-label="Add stroke"
              title="Add stroke"
              onClick={addStroke}
            >
              <Plus size={17} />
            </button>
          </>
        ) : undefined
      }
    );
  }

  function layerEffectKey(layerId: string): string {
    return layerId;
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
        resolveWatchfaceLayerEffects(current, layerId)
      );
      return { ...current, layerEffects };
    });
  }

  function detachLayerEffectStyle(layerId: string) {
    const effects = resolveWatchfaceLayerEffects(design, layerId);
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
    const effects = resolveWatchfaceLayerEffects(design, layerId);
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

  function renderFirmwareSpriteRotation(
    rotation: number | undefined,
    onChange: (rotation: number) => void
  ) {
    const value = normalizeWatchfaceRotation(rotation ?? 0);
    return (
      <label className="field">
        Sprite rotation
        <EditableNumberInput
          min="0"
          max="359"
          step="1"
          value={Math.round(value)}
          fallback={0}
          onValueChange={(next) =>
            onChange(normalizeWatchfaceRotation(next))
          }
        />
        <span className="watchface-studio-summary">
          Clockwise degrees, applied to every state inside its fixed COROS PNG canvas.
        </span>
      </label>
    );
  }

  function renderEffectsInspector(layerId: string, warning?: string) {
    const scope = previewMode === "aod" ? "aod" : "current";
    const effects = resolveWatchfaceLayerEffects(design, layerId);
    const binding = design.layerEffects?.[layerEffectKey(layerId)];
    const patchEffect = (id: string, patch: Partial<CorosWatchfaceShadowEffect>) =>
      writeLayerEffects(layerId, effects.map((effect) =>
        effect.id === id ? normalizeWatchfaceShadowEffect({ ...effect, ...patch }) : effect
      ));
    return renderPropertySection(
      "effects",
      "Effects",
      <div className="wf-effects-inspector">
        <span className="wf-effect-scope">
          {scope === "aod" ? "Always-on display only" : "Current display only"}
        </span>
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
                }}><ArrowUp size={13} aria-hidden="true" /></button>
                <button type="button" aria-label="Move shadow down" disabled={index === effects.length - 1} onClick={() => {
                  const next = [...effects];
                  [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                  writeLayerEffects(layerId, next);
                }}><ArrowDown size={13} aria-hidden="true" /></button>
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
      </div>,
      {
        status: effects.length > 0 ? String(effects.length) : undefined,
        disabled: isPositionLocked(layerId),
        className: "wf-effects-section",
        actions: (
          <button
            type="button"
            className="wf-property-icon-button"
            disabled={isPositionLocked(layerId)}
            aria-label="Add outer shadow"
            title="Add outer shadow"
            onClick={() =>
              writeLayerEffects(layerId, [
                ...effects,
                createWatchfaceShadowEffect()
              ])
            }
          >
            <Plus size={15} />
          </button>
        )
      }
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
    } else if (layer.backgroundElementId) {
      updateElement(layer.backgroundElementId, { visible: !layer.visible });
    } else if (layer.spriteId) {
      updateSprite(layer.spriteId, { visible: !layer.visible });
    } else if (layer.kind === "background") {
      patchDesign({ artworkVisible: !layer.visible });
    } else if (layer.kind === "batteryIcon") {
      setBatteryIconVisible(!layer.visible);
    } else if (layer.kind === "controlBatteryIcon") {
      setControlBatteryEnabled(!layer.visible);
    } else if (layer.layoutGroupId) {
      setFirmwareLayerVisible(layer.layoutGroupId, !layer.visible);
    }
  }

  function renderConfigAssetInspector(
    reference: WatchfaceConfigAssetReference,
    layer: EditorLayer
  ) {
    const override = design.configAssetOverrides?.[reference.id];
    const enabled = override?.enabled !== false;
    const artworkZoom = override?.scale ?? 1;
    const supportsNativeSize = configAssetCanUseNativeSize(
      reference.configKey,
      Boolean(reference.source)
    );
    const nativeSize = supportsNativeSize && override?.nativeSize === true;
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
      <>
        {renderPositionReadout(layer)}
        {renderPropertySection(
          "specific",
          "Asset",
          <div className="wf-property-stack wf-config-asset-inspector">
            <div className={`wf-config-asset-preview${enabled ? "" : " is-disabled"}`}>{previewDataUrl ? <img src={previewDataUrl} alt={`${reference.label} preview`} /> : <Image size={24} aria-hidden="true" />}</div>
            <div className="wf-config-asset-actions">
              <button type="button" className="secondary-button" onClick={() => void chooseConfigAsset(reference)}><ImagePlus size={15} /> {override?.replacement ? "Replace again" : "Replace image"}</button>
              {override?.replacement ? <button type="button" className="secondary-button" onClick={() => restoreConfigAsset(reference)}><RotateCcw size={15} /> Restore original</button> : null}
            </div>
            {override?.replacement ? (
              <>
                {supportsNativeSize ? <label className="watchface-studio-toggle"><input type="checkbox" checked={nativeSize} onChange={(event) => updateConfigAsset(reference, { nativeSize: event.target.checked })} />Native PNG size</label> : null}
                <label className="watchface-inspector-field"><span>{nativeSize ? "Native size scale" : "Artwork zoom"}</span><span className="wf-input-with-unit"><EditableNumberInput min="0.1" step="0.01" value={artworkZoom} fallback={1} onValueChange={(scale) => updateConfigAsset(reference, { scale: Math.max(0.1, scale) })} /><span>×</span></span></label>
              </>
            ) : null}
          </div>,
          { disabled: isPositionLocked(layer.id) }
        )}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <div className="wf-property-stack">
            <div className="wf-config-asset-meta"><strong>{reference.label}</strong><span>{dimensions}</span><code>{reference.relativePath}</code><code>[{reference.configKey}]</code></div>
            {onWatchBehavior ? <p className="watchface-studio-summary">{onWatchBehavior}</p> : null}
            <p className="watchface-studio-summary">
              {reference.source
                ? `Parsed from ${reference.scope === "aod" ? "AODconfig.txt" : "config.txt"}.`
                : `Not supplied by the template. Importing an image adds [${reference.configKey}] to config.txt.`} Visibility changes only this key. Other keys that share the original file are not altered.
            </p>
          </div>,
          { disabled: isPositionLocked(layer.id) }
        )}
      </>
    );
  }

  function renderControlBatteryInspector(layer: EditorLayer) {
    if (!layer.visible) {
      return renderPropertySection(
        "specific",
        "Sprite",
        <div className="wf-property-stack">
          <p className="watchface-studio-summary">
            Battery is off. Turn it on in Selectable components to add its
            configuration and show these settings.
          </p>
        </div>,
        { disabled: isPositionLocked(layer.id) }
      );
    }
    const override =
      design.configAssetOverrides?.["config:control_battery_icon"];
    const stateCount = Object.keys(
      override?.stateReplacements ?? {}
    ).length;
    const iconScale = override?.scale ?? 1;
    const sourceResolution = previewDetails
      ? pickPreviewResolution(previewDetails)
      : details
        ? pickPreviewResolution(details)
        : null;
    const iconOffset =
      design.controlIconOffsets?.battery ?? { dx: 0, dy: 0 };
    const configuredIconPosition = parseConfigPos(
      sourceResolution?.config.control_battery_icon_pos
    );
    const baseIconPosition = configuredIconPosition
      ? {
          x: configuredIconPosition.x - iconOffset.dx,
          y: configuredIconPosition.y - iconOffset.dy
        }
      : null;
    const controlOriginKey = sourceResolution
      ? Object.keys(sourceResolution.config).find((key) =>
          /^rect_control\d+_pos$/.test(key)
        )
      : undefined;
    const controlOrigin = parseConfigPos(
      controlOriginKey
        ? sourceResolution?.config[controlOriginKey]
        : undefined
    ) ?? { x: 0, y: 0 };
    const controlOffset =
      design.layoutOffsets?.complication ?? { dx: 0, dy: 0 };
    const iconScreenPosition = baseIconPosition
      ? {
          x: toWatchCoordinate(
            controlOrigin.x +
              controlOffset.dx +
              baseIconPosition.x +
              iconOffset.dx
          ),
          y: toWatchCoordinate(
            controlOrigin.y +
              controlOffset.dy +
              baseIconPosition.y +
              iconOffset.dy
          )
        }
      : null;
    const setIconOffset = (dx: number, dy: number) => {
      if (isMovementLockedForId("complication")) return;
      setDesign((current) => ({
        ...current,
        controlIconOffsets: {
          ...(current.controlIconOffsets ?? {}),
          battery: { dx: Math.round(dx), dy: Math.round(dy) }
        }
      }));
    };

    return (
      <>
        {baseIconPosition
          ? renderPositionPanel("complication", "Watch screen position", <>
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
                        fromWatchCoordinate(
                          Number(event.target.value) || 0
                        ) -
                          controlOrigin.x -
                          controlOffset.dx -
                          baseIconPosition.x,
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
                        fromWatchCoordinate(
                          Number(event.target.value) || 0
                        ) -
                          controlOrigin.y -
                          controlOffset.dy -
                          baseIconPosition.y
                      )
                    }
                  />
                </label>
              </div>
              <span>Nudge</span>
              <div className="watchface-nudge-pad wf-position-nudge-only">
                <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy - fromWatchCoordinate(1))} aria-label="Nudge control battery icon up"><ArrowUp size={13} aria-hidden="true" /></button>
                <button type="button" onClick={() => setIconOffset(iconOffset.dx - fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge control battery icon left"><ArrowLeft size={13} aria-hidden="true" /></button>
                <button type="button" onClick={() => setIconOffset(iconOffset.dx + fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge control battery icon right"><ArrowRight size={13} aria-hidden="true" /></button>
                <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy + fromWatchCoordinate(1))} aria-label="Nudge control battery icon down"><ArrowDown size={13} aria-hidden="true" /></button>
                <button type="button" className="watchface-nudge-reset" onClick={() => setIconOffset(0, 0)}>Reset</button>
              </div>
            </>)
          : null}
        {renderPropertySection(
          "specific",
          "Sprite",
          <div className="wf-property-stack">
            <div className="wf-config-asset-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={spriteImportPending}
                onClick={() => void chooseBatterySpriteFolder("config:control_battery_icon")}
              >
                <ImagePlus size={15} />
                {stateCount > 0 ? "Replace sprite folder" : "Import sprite folder"}
              </button>
              {stateCount > 0 ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={spriteImportPending}
                  onClick={() => restoreBatteryIcon("config:control_battery_icon")}
                >
                  <RotateCcw size={15} /> Restore
                </button>
              ) : null}
            </div>
            <label className="watchface-inspector-field">
              <span>Scale</span>
              <span className="wf-input-with-unit">
                <EditableNumberInput
                  min="0.1"
                  step="0.01"
                  value={iconScale}
                  fallback={1}
                  onValueChange={(scale) => setBatteryIconScale(scale, "config:control_battery_icon")}
                />
                <span>×</span>
              </span>
            </label>
            <div className="wf-asset-dimensions">
              <span>Imported states</span>
              <strong>{stateCount || "Template"}</strong>
            </div>
          </div>,
          { disabled: isPositionLocked(layer.id) }
        )}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <p className="watchface-studio-summary">
            This sprite is used only for the Battery choice in the selectable data slot. Its source, scale, and position are independent from the Selectable metric layer.
          </p>,
          { disabled: isPositionLocked(layer.id) }
        )}
      </>
    );
  }

  function renderInspector(layer: EditorLayer) {
    return (
      <>
        {renderLayerSection(layer)}
        {renderInspectorBody(layer)}
      </>
    );
  }

  function renderInspectorBody(layer: EditorLayer) {
    if (layer.configAssetId) {
      const reference = configAssetsById.get(layer.configAssetId);
      return reference ? renderConfigAssetInspector(reference, layer) : null;
    }

    if (layer.weatherIndicator) {
      return renderWeatherInspector();
    }

    if (layer.ampmIndicator) {
      return renderAmPmInspector();
    }

    if (layer.staticSeparatorId) {
      return (
        <>
          {renderStaticSeparatorInspector(layer.staticSeparatorId)}
          {renderEffectsInspector(layer.id)}
        </>
      );
    }

    if (layer.kind === "controlBatteryIcon") {
      return renderControlBatteryInspector(layer);
    }

    if (layer.kind === "background") {
      const backgroundOverride =
        design.configAssetOverrides?.["config:background_icon"];
      const backgroundArtwork = backgroundOverride?.replacement ?? design.artwork;
      const backgroundVisible = design.artworkVisible !== false;
      const backgroundColor = parseBackgroundColor(design.backgroundColor);
      return (
        <>
          {renderPropertySection(
            "appearance",
            "Appearance",
            <div className="wf-property-stack">
              <label className="field">
                Background color
                <span className="watchface-color-control">
                  <input type="color" value={backgroundColor.hex} onChange={(event) => patchDesign({ backgroundColor: toRgbaColor(event.target.value, backgroundColor.isTransparent ? 1 : backgroundColor.alpha) })} />
                  <code>{backgroundColor.isTransparent ? "none" : design.backgroundColor}</code>
                  <button className="watchface-color-none" type="button" disabled={backgroundColor.isTransparent} onClick={() => patchDesign({ backgroundColor: "transparent" })}>None</button>
                </span>
              </label>
              <label className="watchface-inspector-field">
                <span>Fill opacity</span>
                <span className="wf-input-with-unit">
                  <EditableNumberInput min="0" max="100" step="1" disabled={backgroundColor.isTransparent} value={Math.round(backgroundColor.alpha * 100)} fallback={100} onValueChange={(opacity) => patchDesign({ backgroundColor: toRgbaColor(backgroundColor.hex, opacity / 100) })} />
                  <span>%</span>
                </span>
              </label>
            </div>
          )}
          {backgroundArtwork ? renderStrokeInspector("background") : null}
          {renderPropertySection(
            "specific",
            "Background",
            <div className="wf-property-stack">
              <div className={`wf-config-asset-preview wf-background-asset-preview${backgroundVisible ? "" : " is-disabled"}`}>
                {backgroundArtwork ? <img src={backgroundArtwork.dataUrl} alt="Background artwork preview" /> : <Image size={28} aria-hidden="true" />}
              </div>
              <button className="secondary-button" type="button" onClick={() => void chooseArtwork()}><ImagePlus size={15} /> {backgroundArtwork ? "Replace artwork" : "Add artwork"}</button>
              {backgroundArtwork ? (
                <>
                  <label className="watchface-inspector-field"><span>Artwork scale</span><span className="wf-input-with-unit"><EditableNumberInput min="1" max="2.25" step="0.01" value={design.zoom} fallback={1} onValueChange={(zoom) => patchDesign({ zoom: Math.max(1, Math.min(2.25, zoom)) })} /><span>×</span></span></label>
                  <button className="secondary-button wf-danger-action" type="button" onClick={() => setBackgroundArtwork(null)}><Trash2 size={15} /> Remove artwork</button>
                </>
              ) : <p className="watchface-studio-summary">Add artwork to place an image behind the live watch elements.</p>}
            </div>
          )}
          {backgroundArtwork ? renderEffectsInspector("background") : null}
        </>
      );
    }

    if (layer.kind === "batteryIcon") {
      const stateReplacements = design.configAssetOverrides?.["config:battery_icon"]?.stateReplacements;
      const stateCount = Object.keys(stateReplacements ?? {}).length;
      const iconScale = design.configAssetOverrides?.["config:battery_icon"]?.scale ?? 1;
      return (
        <>
          {renderPositionReadout(layer)}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Sprite",
            <div className="wf-property-stack">
              <div className="wf-config-asset-actions">
                <button className="secondary-button" type="button" disabled={spriteImportPending} onClick={() => void chooseBatterySpriteFolder()}><ImagePlus size={15} /> {stateCount > 0 ? "Replace sprite folder" : "Import sprite folder"}</button>
                {stateCount > 0 ? <button className="secondary-button" type="button" disabled={spriteImportPending} onClick={() => restoreBatteryIcon()}><RotateCcw size={15} /> Restore template</button> : null}
              </div>
              <label className="watchface-inspector-field"><span>Icon scale</span><EditableNumberInput min="0.1" step="0.01" value={iconScale} fallback={1} onValueChange={setBatteryIconScale} /></label>
              <p className="watchface-studio-summary">Import PNGs named 00.png, 01.png, and so on. Each file replaces its matching charge state.</p>
            </div>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderEffectsInspector(
            layer.id,
            "Native battery states keep their firmware slot dimensions. Shadows are clipped unless the artwork is a Studio-owned sprite folder."
          )}
        </>
      );
    }

    if (layer.kind === "battery") {
      const style = design.metricStyles?.battery;
      return (
        <>
          {renderPositionReadout(layer)}
          {renderPropertySection(
            "appearance",
            "Appearance",
            <label className="field">Tint color<span className="watchface-color-control"><input type="color" value={style?.color ?? design.digitColor} onChange={(event) => setMetricStyle("battery", { color: event.target.value })} /><code>{style?.color ?? design.digitColor}</code><button type="button" className="watchface-color-none" disabled={!style?.color} aria-label="Remove tint" title="Remove tint" onClick={() => clearMetricColor("battery")}><XCircle size={14} /></button></span></label>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Typography",
            <div className="wf-property-stack">
              <LocalFontPicker api={api} label="Font" value={style?.fontFamily ?? design.fontFamily} emptyLabel="Keep template font" onChange={(fontFamily) => setMetricStyle("battery", { fontFamily, rasterFont: undefined })} rasterFont={design.rasterFont} onRasterFontChange={setRasterFont} typography={{ fontWeight: design.fontWeight ?? 400, fontStyle: design.fontStyle ?? "normal", letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0 }} onTypographyChange={(typography) => patchDesign(typography)} onLetterSpacingChange={(letterSpacing) => setMetricStyle("battery", { letterSpacing })} />
              <div className="watchface-position-inputs">
                <label>Scale<EditableNumberInput min="0.01" step="0.01" value={style?.scale ?? 1} fallback={1} onValueChange={(scale) => setMetricStyle("battery", { scale: Math.max(0.01, scale) })} /></label>
                <label>Rotation<EditableNumberInput min="0" max="360" step="1" value={normalizeWatchfaceRotation(style?.rotation ?? 0)} fallback={0} onValueChange={(rotation) => setMetricStyle("battery", { rotation: normalizeWatchfaceRotation(rotation) })} /></label>
              </div>
              <details className="wf-nested-disclosure"><summary>Custom PNG font</summary><CustomPngFontPanel api={api} {...rasterFolderImportProps} rasterFont={design.rasterFont} componentRasterFont={style?.rasterFont} componentLabel="Battery data" onActivate={() => setMetricStyle("battery", { fontFamily: "" })} onRasterFontChange={setRasterFont} onComponentRasterFontChange={(rasterFont) => setMetricStyle("battery", { rasterFont })} /></details>
            </div>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderEffectsInspector(layer.id)}
        </>
      );
    }

    if (layer.timePartId) {
      const style = design.timeStyles?.[layer.timePartId];
      return (
        <>
          {renderPositionReadout(layer)}
          {renderPropertySection(
            "appearance",
            "Appearance",
            <label className="field">Tint color<span className="watchface-color-control"><input type="color" value={style?.color ?? design.digitColor} onChange={(event) => setTimeStyle(layer.timePartId!, { color: event.target.value })} /><code>{style?.color ?? design.digitColor}</code><button type="button" className="watchface-color-none" disabled={!style?.color} aria-label="Remove tint" title="Remove tint" onClick={() => clearTimeColor(layer.timePartId!)}><XCircle size={14} /></button></span></label>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Typography",
            <div className="wf-property-stack">
              {layer.timePartId === "autoTime" ? <button type="button" className="secondary-button" onClick={convertAutoTimeToSeparate}>Separate hours and minutes</button> : null}
              <LocalFontPicker api={api} label="Font" value={style?.fontFamily ?? design.fontFamily} emptyLabel="Keep template font" onChange={(fontFamily) => setTimeStyle(layer.timePartId!, { fontFamily, rasterFont: undefined })} rasterFont={style?.rasterFont ?? design.rasterFont} onRasterFontChange={setRasterFont} typography={{ fontWeight: design.fontWeight ?? 400, fontStyle: design.fontStyle ?? "normal", letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0 }} onTypographyChange={(typography) => patchDesign(typography)} onLetterSpacingChange={(letterSpacing) => setTimeStyle(layer.timePartId!, { letterSpacing })} />
              <div className="watchface-position-inputs">
                <label>Scale<EditableNumberInput min="0.01" step="0.01" value={style?.scale ?? 1} fallback={1} onValueChange={(scale) => setTimeStyle(layer.timePartId!, { scale: Math.max(0.01, scale) })} /></label>
                <label>Rotation<EditableNumberInput min="0" max="360" step="1" value={normalizeWatchfaceRotation(style?.rotation ?? 0)} fallback={0} onValueChange={(rotation) => setTimeStyle(layer.timePartId!, { rotation: normalizeWatchfaceRotation(rotation) })} /></label>
              </div>
              <details className="wf-nested-disclosure"><summary>Custom PNG font</summary><CustomPngFontPanel api={api} {...rasterFolderImportProps} rasterFont={design.rasterFont} componentRasterFont={style?.rasterFont} componentLabel={layer.label} onActivate={() => setTimeStyle(layer.timePartId!, { fontFamily: "" })} onRasterFontChange={setRasterFont} onComponentRasterFontChange={(rasterFont) => setTimeStyle(layer.timePartId!, { rasterFont })} /></details>
            </div>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderEffectsInspector(layer.id)}
        </>
      );
    }

    if (layer.kind === "metric" && layer.metricId) {
      const style = design.metricStyles?.[layer.metricId];
      return (
        <>
          {renderPositionReadout(layer)}
          {renderPropertySection(
            "appearance",
            "Appearance",
            <label className="field">Tint color<span className="watchface-color-control"><input type="color" value={style?.color ?? design.digitColor} onChange={(event) => setMetricStyle(layer.metricId!, { color: event.target.value })} /><code>{style?.color ?? design.digitColor}</code><button type="button" className="watchface-color-none" disabled={!style?.color} aria-label="Remove tint" title="Remove tint" onClick={() => clearMetricColor(layer.metricId!)}><XCircle size={14} /></button></span></label>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Typography",
            <div className="wf-property-stack">
              <LocalFontPicker api={api} label="Font" value={style?.fontFamily ?? design.fontFamily} emptyLabel="Keep template font" onChange={(fontFamily) => setMetricStyle(layer.metricId!, { fontFamily })} rasterFont={design.rasterFont} onRasterFontChange={setRasterFont} typography={{ fontWeight: design.fontWeight ?? 400, fontStyle: design.fontStyle ?? "normal", letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0 }} onTypographyChange={(typography) => patchDesign(typography)} onLetterSpacingChange={(letterSpacing) => setMetricStyle(layer.metricId!, { letterSpacing })} />
              <div className="watchface-position-inputs">
                <label>Scale<EditableNumberInput min="0.01" step="0.01" value={style?.scale ?? 1} fallback={1} onValueChange={(scale) => setMetricStyle(layer.metricId!, { scale: Math.max(0.01, scale) })} /></label>
                {supportsWatchfaceSpriteRotation(layer.metricId) ? <label>Rotation<EditableNumberInput min="0" max="360" step="1" value={normalizeWatchfaceRotation(style?.rotation ?? 0)} fallback={0} onValueChange={(rotation) => setMetricStyle(layer.metricId!, { rotation: normalizeWatchfaceRotation(rotation) })} /></label> : null}
              </div>
              <details className="wf-nested-disclosure"><summary>Custom PNG font</summary><CustomPngFontPanel api={api} {...rasterFolderImportProps} rasterFont={design.rasterFont} componentRasterFont={style?.rasterFont} componentLabel={layer.label} onActivate={() => setMetricStyle(layer.metricId!, { fontFamily: "" })} onRasterFontChange={setRasterFont} onComponentRasterFontChange={(rasterFont) => setMetricStyle(layer.metricId!, { rasterFont })} /></details>
            </div>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderEffectsInspector(layer.id)}
        </>
      );
    }

    if (
      layer.kind === "weekday" ||
      (layer.kind === "date" &&
        (layer.layoutGroupId === "dateMonth" || layer.layoutGroupId === "dateDay"))
    ) {
      const partId = layer.layoutGroupId as WatchfaceDatePartId;
      const style = design.dateStyles?.[partId];
      const supportsNativeSize =
        partId === "weekday" || partId === "dateDay";
      // Native sizes are authored in master coordinates; export scales them
      // per device tree, so the inspector reads master fallbacks only.
      const sourceResolution = details ? pickPreviewResolution(details) : null;
      const monthFolderName = sourceResolution?.config.english_date_month_font
        ?.replace(/\\/g, "/");
      const starterUsesMonthLabels = partId === "dateMonth" &&
        sourceResolution?.spriteFolders.some(
          (folder) => folder.folder === monthFolderName && folder.kind === "month"
        );
      const usesMonthLabels = partId === "dateMonth" &&
        (style?.monthFormat === "labels" ||
          (style?.monthFormat !== "digits" && starterUsesMonthLabels));
      const sourceSizes = sourceResolution
        ? Array.from({
            length: partId === "weekday" ? 7 : usesMonthLabels ? 12 : 10
          }, (_, value) =>
            dateSpriteCanvasSize(sourceResolution, partId, style, value)
          ).filter((size): size is NonNullable<typeof size> => Boolean(size))
        : [];
      const nativeWidth = sourceSizes.length > 0
        ? Math.max(...sourceSizes.map((size) => size.width))
        : 1;
      const nativeHeight = sourceSizes.length > 0
        ? Math.max(...sourceSizes.map((size) => size.height))
        : 1;
      return (
        <>
          {renderPositionReadout(layer)}
          {renderPropertySection(
            "appearance",
            "Appearance",
            <label className="field">Tint color<span className="watchface-color-control"><input type="color" value={style?.color ?? design.digitColor} onChange={(event) => setDateStyle(partId, { color: event.target.value })} /><code>{style?.color ?? design.digitColor}</code><button type="button" className="watchface-color-none" disabled={!style?.color} aria-label="Remove tint" title="Remove tint" onClick={() => clearDateColor(partId)}><XCircle size={14} /></button></span></label>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Typography",
            <div className="wf-property-stack">
              <LocalFontPicker
                api={api}
                label="Font"
                value={style?.fontFamily ?? design.fontFamily}
                emptyLabel="Keep template font"
                onChange={(fontFamily) => {
                  if (!fontFamily) {
                    restoreDateTemplateFont(partId);
                    return;
                  }
                  setDateStyle(partId, { fontFamily, rasterFont: undefined, ...(supportsNativeSize ? { nativeSize: true } : {}), ...(partId === "dateMonth" ? { monthFormat: undefined } : {}) });
                }}
                rasterFont={design.rasterFont}
                rasterFontRequiredText={partId === "weekday" ? "MON" : usesMonthLabels ? "JAN" : undefined}
                onRasterFontChange={setRasterFont}
                typography={{ fontWeight: design.fontWeight ?? 400, fontStyle: design.fontStyle ?? "normal", letterSpacing: style?.letterSpacing ?? design.letterSpacing ?? 0 }}
                onTypographyChange={(typography) => patchDesign(typography)}
                onLetterSpacingChange={(letterSpacing) =>
                  setDateStyle(partId, {
                    letterSpacing,
                    ...(partId === "weekday" && Math.abs(letterSpacing) >= 0.001
                      ? { nativeSize: true }
                      : {})
                  })
                }
              />
              <div className="field">
                Native PNG size
                <LinkedDimensionInputs
                  width={style?.width ?? nativeWidth}
                  height={style?.height ?? nativeHeight}
                  linked={style?.aspectLocked !== false}
                  onDimensionsChange={({ width, height }) =>
                    setDateStyle(partId, {
                      width: Math.max(1, Math.round(width)),
                      height: Math.max(1, Math.round(height))
                    })
                  }
                  onLinkedChange={(aspectLocked) =>
                    setDateStyle(partId, { aspectLocked })
                  }
                />
                <button type="button" className="watchface-color-none" disabled={style?.width === undefined && style?.height === undefined} onClick={() => setDateStyle(partId, { width: undefined, height: undefined })}>Use imported size</button>
              </div>
              <label className="watchface-inspector-field"><span>Rotation</span><EditableNumberInput min="0" max="360" step="1" value={normalizeWatchfaceRotation(style?.rotation ?? 0)} fallback={0} onValueChange={(rotation) => setDateStyle(partId, { rotation: normalizeWatchfaceRotation(rotation) })} /></label>
              <details className="wf-nested-disclosure">
                <summary>Custom PNG font</summary>
                <CustomPngFontPanel
                  api={api}
                  {...rasterFolderImportProps}
                  rasterFont={design.rasterFont}
                  componentRasterFont={style?.rasterFont}
                  componentLabel={layer.label}
                  onActivate={() => setDateStyle(partId, { fontFamily: "" })}
                  onRasterFontChange={setRasterFont}
                  onComponentRasterFontChange={(rasterFont) => {
                    if (!rasterFont) {
                      restoreDateTemplateFont(partId);
                      return;
                    }
                    setDateStyle(partId, { rasterFont, ...(supportsNativeSize ? { nativeSize: true } : {}), ...(partId === "dateMonth" ? { monthFormat: WATCHFACE_MONTH_LABELS.every((label) => rasterFontSupportsText(rasterFont, label)) ? "labels" : rasterFontSupportsText(rasterFont, "0123456789") ? "digits" : undefined } : {}) });
                  }}
                />
              </details>
            </div>,
            { disabled: isPositionLocked(layer.id) }
          )}
          {renderEffectsInspector(layer.id)}
        </>
      );
    }

    if (layer.kind === "customSprite" && layer.spriteId) {
      const sprite = (design.designSprites ?? []).find((s) => s.id === layer.spriteId);
      if (!sprite) {
        return null;
      }
      const locked = isPositionLocked(layer.id);
      const faceHeight = previewResolution?.height ?? previewWidth;
      const fullCrop = JSON.stringify({ x: 0, y: 0, width: 1, height: 1 });
      return (
        <>
          {renderPropertySection(
            "transform",
            "Transform",
            <div className="wf-transform-stack">
              <div className="watchface-position-inputs">
                <label>X<EditableNumberInput min="0" max={watchCoordinateWidth} step="1" value={toWatchCoordinate(sprite.x)} fallback={0} onValueChange={(x) => updateSprite(sprite.id, { x: fromWatchCoordinate(x) })} /></label>
                <label>Y<EditableNumberInput min="0" max={watchCoordinateHeight} step="1" value={toWatchCoordinate(sprite.y)} fallback={0} onValueChange={(y) => updateSprite(sprite.id, { y: fromWatchCoordinate(y) })} /></label>
                <label>Scale %<EditableNumberInput min="20" max="300" step="1" value={Math.round(sprite.scale * 100)} fallback={100} onValueChange={(scale) => updateSprite(sprite.id, { scale: Math.max(0.2, Math.min(3, scale / 100)) })} /></label>
                <label>Rotation<EditableNumberInput min="0" max="360" step="1" value={Math.round(sprite.rotation)} fallback={0} onValueChange={(rotation) => updateSprite(sprite.id, { rotation: normalizeWatchfaceRotation(rotation) })} /></label>
              </div>
              <LinkedDimensionInputs
                width={toWatchCoordinate(sprite.width * sprite.scale)}
                height={toWatchCoordinate(sprite.height * sprite.scale)}
                linked={sprite.aspectLocked !== false}
                onDimensionsChange={({ width, height }) =>
                  updateSprite(sprite.id, {
                    width: fromWatchCoordinate(width) / sprite.scale,
                    height: fromWatchCoordinate(height) / sprite.scale
                  })
                }
                onLinkedChange={(aspectLocked) =>
                  updateSprite(sprite.id, { aspectLocked })
                }
              />
              <div className="wf-transform-action-row wf-flip-action-row" role="group" aria-label="Image transform options">
                <button type="button" aria-pressed={sprite.flipX === true} onClick={() => updateSprite(sprite.id, { flipX: !sprite.flipX })}><FlipHorizontal2 size={14} /><span>Flip X</span></button>
                <button type="button" aria-pressed={sprite.flipY === true} onClick={() => updateSprite(sprite.id, { flipY: !sprite.flipY })}><FlipVertical2 size={14} /><span>Flip Y</span></button>
              </div>
              <div className="wf-control-label">Align to face</div>
              <div className="wf-align-icon-grid" role="group" aria-label="Align image to face">
                <button type="button" title="Align left" aria-label="Align left" onClick={() => updateSprite(sprite.id, { x: (sprite.width * sprite.scale) / 2 })}><AlignHorizontalJustifyStart size={14} /></button>
                <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => updateSprite(sprite.id, { x: previewWidth / 2 })}><AlignHorizontalJustifyCenter size={14} /></button>
                <button type="button" title="Align right" aria-label="Align right" onClick={() => updateSprite(sprite.id, { x: previewWidth - (sprite.width * sprite.scale) / 2 })}><AlignHorizontalJustifyEnd size={14} /></button>
                <button type="button" title="Align top" aria-label="Align top" onClick={() => updateSprite(sprite.id, { y: (sprite.height * sprite.scale) / 2 })}><AlignVerticalJustifyStart size={14} /></button>
                <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => updateSprite(sprite.id, { y: faceHeight / 2 })}><AlignVerticalJustifyCenter size={14} /></button>
                <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => updateSprite(sprite.id, { y: faceHeight - (sprite.height * sprite.scale) / 2 })}><AlignVerticalJustifyEnd size={14} /></button>
              </div>
            </div>,
            { disabled: locked }
          )}
          {renderPropertySection(
            "appearance",
            "Appearance",
            <div className="wf-property-stack">
              <label className="watchface-studio-toggle"><input type="checkbox" checked={Boolean(sprite.tintColor)} onChange={(event) => updateSprite(sprite.id, { tintColor: event.target.checked ? design.accentColor : null })} />Tint image</label>
              {sprite.tintColor ? <label className="field">Tint color<span className="watchface-color-control"><input type="color" value={sprite.tintColor} onChange={(event) => updateSprite(sprite.id, { tintColor: event.target.value })} /><code>{sprite.tintColor}</code><button type="button" className="watchface-color-none" aria-label="Remove tint" title="Remove tint" onClick={() => updateSprite(sprite.id, { tintColor: null })}><XCircle size={14} /></button></span></label> : null}
            </div>,
            { disabled: locked }
          )}
          {renderStrokeInspector(layer.id)}
          {renderPropertySection(
            "specific",
            "Image",
            <div className="wf-property-stack">
              <div className="wf-config-asset-preview wf-image-property-preview"><img src={sprite.dataUrl} alt="" /></div>
              <div className="wf-asset-dimensions"><span>Source</span><strong>{sprite.sourceWidth} × {sprite.sourceHeight} px</strong></div>
            </div>,
            { disabled: locked }
          )}
          {renderEffectsInspector(layer.id)}
          {renderPropertySection(
            "advanced",
            "Advanced",
            <div className="wf-property-stack">
              <div className="watchface-position-inputs">
                <label>Skew X<EditableNumberInput min="-80" max="80" step="1" value={normalizeWatchfaceSkew(sprite.skewX)} fallback={0} onValueChange={(skewX) => updateSprite(sprite.id, { skewX: normalizeWatchfaceSkew(skewX) })} /></label>
                <label>Skew Y<EditableNumberInput min="-80" max="80" step="1" value={normalizeWatchfaceSkew(sprite.skewY)} fallback={0} onValueChange={(skewY) => updateSprite(sprite.id, { skewY: normalizeWatchfaceSkew(skewY) })} /></label>
              </div>
              <label className="field">Transform origin<select value={(() => { const origin = normalizeWatchfaceTransformOrigin(sprite.origin); return `${origin.x},${origin.y}`; })()} onChange={(event) => { const [x, y] = event.target.value.split(",").map(Number); updateSprite(sprite.id, { origin: normalizeWatchfaceTransformOrigin({ x, y }) }); }}><option value="0,0">Top left</option><option value="0.5,0">Top center</option><option value="1,0">Top right</option><option value="0,0.5">Center left</option><option value="0.5,0.5">Center</option><option value="1,0.5">Center right</option><option value="0,1">Bottom left</option><option value="0.5,1">Bottom center</option><option value="1,1">Bottom right</option></select></label>
              <div className={`wf-crop-controls${cropSpriteId === sprite.id ? " is-active" : ""}`}>
                <div className="wf-crop-heading"><strong>Crop</strong>{cropSpriteId === sprite.id ? <span>Enter applies, Esc cancels</span> : null}</div>
                {cropSpriteId === sprite.id ? (
                  <>
                    <div className="watchface-sprite-transform-fields">
                      {(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key[0]!.toUpperCase() + key.slice(1)} %<EditableNumberInput min="0" max="100" step="1" value={Math.round(normalizeWatchfaceCrop(sprite.crop)[key] * 100)} fallback={key === "width" || key === "height" ? 100 : 0} onValueChange={(value) => updateSprite(sprite.id, { crop: normalizeWatchfaceCrop({ ...normalizeWatchfaceCrop(sprite.crop), [key]: value / 100 }) })} /></label>)}
                    </div>
                    <div className="wf-crop-actions"><button type="button" className="primary-button" onClick={applySpriteCrop}>Apply crop</button><button type="button" className="secondary-button" onClick={cancelSpriteCrop}>Cancel</button><button type="button" onClick={() => updateSprite(sprite.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset</button></div>
                  </>
                ) : <div className="wf-crop-actions"><button type="button" className="secondary-button" onClick={() => enterSpriteCrop(sprite)}><Crop size={14} /> Crop image</button><button type="button" disabled={JSON.stringify(normalizeWatchfaceCrop(sprite.crop)) === fullCrop} onClick={() => updateSprite(sprite.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button></div>}
              </div>
              <div className="wf-control-label">Nudge</div>
              <div className="watchface-nudge-pad">
                <button type="button" aria-label="Nudge image up" onClick={() => updateSprite(sprite.id, { y: sprite.y - fromWatchCoordinate(1) })}><ArrowUp size={13} /></button>
                <button type="button" aria-label="Nudge image left" onClick={() => updateSprite(sprite.id, { x: sprite.x - fromWatchCoordinate(1) })}><ArrowLeft size={13} /></button>
                <button type="button" aria-label="Nudge image right" onClick={() => updateSprite(sprite.id, { x: sprite.x + fromWatchCoordinate(1) })}><ArrowRight size={13} /></button>
                <button type="button" aria-label="Nudge image down" onClick={() => updateSprite(sprite.id, { y: sprite.y + fromWatchCoordinate(1) })}><ArrowDown size={13} /></button>
                <button type="button" className="watchface-nudge-reset" onClick={() => updateSprite(sprite.id, { x: previewWidth / 2, y: faceHeight / 2 })}>Reset</button>
              </div>
              {renderArtworkLayerOrderControls(watchfaceSpriteLayerId(sprite.id))}
              <p className="watchface-studio-summary">Drag an edge or corner to resize. Shift changes ratio locking, Option resizes from center, and Shift snaps rotation to 15°.</p>
              <div className="wf-config-asset-actions"><button className="secondary-button" type="button" disabled={(design.designSprites ?? []).length >= MAX_DESIGN_SPRITES} onClick={() => duplicateSprite(sprite.id)}><Copy size={15} /> Duplicate image</button><button className="secondary-button wf-danger-action" type="button" onClick={() => removeSprite(sprite.id)}><Trash2 size={15} /> Remove image</button></div>
            </div>,
            { disabled: locked }
          )}
        </>
      );
    }

    return (
      <>
        {renderPositionReadout(layer)}
        {layer.capabilities.color && layer.layoutGroupId
          ? renderPropertySection(
              "appearance",
              "Appearance",
              <label className="field">
                Tint color
                <span className="watchface-color-control">
                  <input
                    type="color"
                    value={
                      design.layerColors?.[layer.layoutGroupId] ??
                      (layer.kind === "separators"
                        ? design.accentColor
                        : design.digitColor)
                    }
                    onChange={(event) =>
                      setLayerColor(layer.layoutGroupId!, event.target.value)
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
                    aria-label="Remove tint"
                    title="Remove tint"
                    onClick={() => clearLayerColor(layer.layoutGroupId!)}
                  >
                    <XCircle size={14} />
                  </button>
                </span>
              </label>,
              { disabled: isPositionLocked(layer.id) }
            )
          : null}
        {layer.capabilities.stroke
          ? renderStrokeInspector(layer.id)
          : null}
        {renderPropertySection(
          "specific",
          watchfaceInspectorSpecificTitle({ kind: layer.kind }),
          layer.layoutGroupId === "complication" ? (
            renderComplicationPicker()
          ) : (
            <p className="watchface-studio-summary">
              This component is rendered live by the watch firmware.
            </p>
          ),
          { disabled: isPositionLocked(layer.id) }
        )}
        {layer.capabilities.effects
          ? renderEffectsInspector(
              layer.id,
              layer.id === "batteryIcon"
                ? "This native battery slot keeps its firmware dimensions; shadows are clipped to the slot when padding cannot be represented safely."
                : undefined
            )
          : null}
      </>
    );
  }

  function renderComplicationPicker() {
    if (!details || !modeSourceDetails) {
      return null;
    }
    const supported = previewMode === "aod"
      ? getAvailableComplications(modeSourceDetails)
      : WATCHFACE_COMPLICATIONS;
    const previewChoices = supported.filter((complication) =>
      isControlComplicationEnabled(modeSourceDetails, design, complication.id)
    );
    const selected = previewChoices.some(
      (complication) => complication.id === design.previewComplication
    )
      ? design.previewComplication
      : previewChoices[0]?.id ?? "";
    const selectedComplication = supported.find(
      (complication) => complication.id === selected
    );
    const controlColonReference = configAssetsById.get("config:control_colon_icon");
    const controlColonEnabled =
      design.configAssetOverrides?.["config:control_colon_icon"]?.enabled !== false;
    const sourceResolution = previewDetails
      ? pickPreviewResolution(previewDetails)
      : pickPreviewResolution(details);
    const iconPositionKey = selectedComplication
      ? `control_${selectedComplication.controlPrefix}_icon_pos`
      : "";
    const iconOffset = design.controlIconOffsets?.[selected] ?? { dx: 0, dy: 0 };
    const configuredIconPosition = iconPositionKey
      ? parseConfigPos(sourceResolution?.config[iconPositionKey])
      : null;
    const baseIconPosition = configuredIconPosition
      ? {
          x: configuredIconPosition.x - iconOffset.dx,
          y: configuredIconPosition.y - iconOffset.dy
        }
      : null;
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
        <section
          className="wf-selectable-components"
          aria-labelledby="wf-selectable-components-title"
        >
          <div className="wf-selectable-components-heading">
            <h3 id="wf-selectable-components-title">Selectable components</h3>
            <span>
              {previewChoices.length}/{supported.length} on
            </span>
          </div>
          <div className="wf-selectable-component-list">
            {supported.map((complication) => {
              const enabled = isControlComplicationEnabled(
                modeSourceDetails,
                design,
                complication.id
              );
              const imported = hasControlComplication(
                modeSourceDetails,
                complication.id
              );
              return (
                <label
                  key={complication.id}
                  className={`wf-selectable-component${enabled ? " is-enabled" : ""}`}
                >
                  <span>
                    <strong>{complication.label}</strong>
                    <small>
                      {enabled
                        ? imported
                          ? "Loaded from template"
                          : "Added on export"
                        : imported
                          ? "Disabled"
                          : "Not in template"}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={enabled}
                    aria-label={`${enabled ? "Disable" : "Enable"} ${complication.label}`}
                    onChange={(event) =>
                      setControlComplicationEnabled(
                        complication.id,
                        event.target.checked
                      )
                    }
                  />
                </label>
              );
            })}
          </div>
        </section>
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
            {previewChoices.length === 0 ? (
              <option value="">No components enabled</option>
            ) : null}
            {previewChoices.map((complication) => (
              <option key={complication.id} value={complication.id}>
                {complication.label}
              </option>
            ))}
          </select>
        </label>
        {selectedComplication ? (
          <>
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
          label="Font"
          value={design.selectableMetricStyle?.fontFamily ?? design.fontFamily}
          emptyLabel="Keep template font"
          onChange={(fontFamily) =>
            setSelectableMetricStyle({
              fontFamily,
              rasterFont: undefined,
              nativeSize: Boolean(fontFamily)
            })
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
          {...rasterFolderImportProps}
          rasterFont={design.rasterFont}
          componentRasterFont={design.selectableMetricStyle?.rasterFont}
          componentLabel="Selectable metric"
          onActivate={() =>
            setSelectableMetricStyle({ fontFamily: "" })
          }
          onRasterFontChange={setRasterFont}
          onComponentRasterFontChange={(rasterFont) =>
            setSelectableMetricStyle({
              rasterFont,
              nativeSize: Boolean(rasterFont)
            })
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
              aria-label="Remove tint"
              title="Remove tint"
              onClick={clearSelectableMetricColor}
            >
              <XCircle size={14} />
            </button>
          </span>
        </label>
        <label className="watchface-studio-toggle">
          <input
            type="checkbox"
            checked={
              design.selectableMetricStyle?.nativeSize ?? false
            }
            onChange={(event) =>
              setSelectableMetricStyle({ nativeSize: event.target.checked })
            }
          />
          Native width (no template bound)
        </label>
        <label className="field">
          Artwork zoom
          <EditableNumberInput
            min="0.01"
            step="0.01"
            value={design.selectableMetricStyle?.scale ?? 1}
            fallback={1}
            onValueChange={(value) =>
              setSelectableMetricStyle({ scale: Math.max(0.01, value) })
            }
          />
          <span className="watchface-studio-summary">
            {(design.selectableMetricStyle?.nativeSize ?? false)
              ? "Changes digit height while preserving each digit's natural width."
            : "Scales digits inside the selectable value's fixed COROS canvas."}
          </span>
        </label>
        {renderFirmwareSpriteRotation(
          design.selectableMetricStyle?.rotation,
          (rotation) => setSelectableMetricStyle({ rotation })
        )}
        {baseIconPosition && selectedComplication?.id !== "battery" ? (
          <div className="wf-inline-position-controls">
            <strong>Selector icon offset</strong>
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
            <span>Nudge</span>
            <div className="watchface-nudge-pad wf-position-nudge-only">
              <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy - fromWatchCoordinate(1))} aria-label="Nudge selector icon up"><ArrowUp size={13} aria-hidden="true" /></button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx - fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge selector icon left"><ArrowLeft size={13} aria-hidden="true" /></button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx + fromWatchCoordinate(1), iconOffset.dy)} aria-label="Nudge selector icon right"><ArrowRight size={13} aria-hidden="true" /></button>
              <button type="button" onClick={() => setIconOffset(iconOffset.dx, iconOffset.dy + fromWatchCoordinate(1))} aria-label="Nudge selector icon down"><ArrowDown size={13} aria-hidden="true" /></button>
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
        ) : (
          <p className="watchface-studio-summary">
            Turn on a selectable component to add its configuration and edit
            its value, icon, and position settings.
          </p>
        )}
      </>
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
    return renderPropertySection(
      "transform",
      "Transform",
      <div className="watchface-inspector-position">
        <div className="wf-position-heading">
          <span>{title}</span>
          <Info
            size={13}
            aria-label="Coordinates use the selected watch display"
          />
        </div>
        <fieldset
          className="wf-position-controls"
          disabled={isMovementLockedForId(id)}
        >
          {children}
        </fieldset>
        {helper ? (
          <div className="wf-position-help">
            <Info size={15} aria-hidden="true" />
            <div>{helper}</div>
          </div>
        ) : null}
      </div>,
      { disabled: isMovementLockedForId(id) }
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
        <div className="wf-align-icon-grid" role="group" aria-label="Align layer to face">
          <button type="button" title="Align left" aria-label="Align left" onClick={() => alignX("start")}><AlignHorizontalJustifyStart size={14} /></button>
          <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignX("center")}><AlignHorizontalJustifyCenter size={14} /></button>
          <button type="button" title="Align right" aria-label="Align right" onClick={() => alignX("end")}><AlignHorizontalJustifyEnd size={14} /></button>
          <button type="button" title="Align top" aria-label="Align top" onClick={() => alignY("start")}><AlignVerticalJustifyStart size={14} /></button>
          <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => alignY("center")}><AlignVerticalJustifyCenter size={14} /></button>
          <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignY("end")}><AlignVerticalJustifyEnd size={14} /></button>
        </div>
        <span>Nudge</span>
        <div className="watchface-nudge-pad">
          <button type="button" onClick={() => setOffset(offset.dx - fromWatchCoordinate(1), offset.dy)} aria-label="Nudge left"><ArrowLeft size={13} aria-hidden="true" /></button>
          <button type="button" onClick={() => setOffset(offset.dx + fromWatchCoordinate(1), offset.dy)} aria-label="Nudge right"><ArrowRight size={13} aria-hidden="true" /></button>
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy - fromWatchCoordinate(1))} aria-label="Nudge up"><ArrowUp size={13} aria-hidden="true" /></button>
          <button type="button" onClick={() => setOffset(offset.dx, offset.dy + fromWatchCoordinate(1))} aria-label="Nudge down"><ArrowDown size={13} aria-hidden="true" /></button>
          <button type="button" className="watchface-nudge-reset" disabled={offset.dx === 0 && offset.dy === 0} onClick={() => setOffset(0, 0)}><RotateCcw size={13} aria-hidden="true" />Reset</button>
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
      <>
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
          <div className="wf-align-icon-grid" role="group" aria-label="Align separator to face">
            <button type="button" title="Align left" aria-label="Align left" onClick={() => alignX("start")}><AlignHorizontalJustifyStart size={14} /></button>
            <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignX("center")}><AlignHorizontalJustifyCenter size={14} /></button>
            <button type="button" title="Align right" aria-label="Align right" onClick={() => alignX("end")}><AlignHorizontalJustifyEnd size={14} /></button>
            <button type="button" title="Align top" aria-label="Align top" onClick={() => alignY("start")}><AlignVerticalJustifyStart size={14} /></button>
            <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => alignY("center")}><AlignVerticalJustifyCenter size={14} /></button>
            <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignY("end")}><AlignVerticalJustifyEnd size={14} /></button>
          </div>
          <span>Nudge</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(separator.x, separator.y - fromWatchCoordinate(1))} aria-label="Nudge up"><ArrowUp size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(separator.x - fromWatchCoordinate(1), separator.y)} aria-label="Nudge left"><ArrowLeft size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(separator.x + fromWatchCoordinate(1), separator.y)} aria-label="Nudge right"><ArrowRight size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(separator.x, separator.y + fromWatchCoordinate(1))} aria-label="Nudge down"><ArrowDown size={13} aria-hidden="true" /></button>
          </div>
          </>
        )}
        {renderPropertySection(
          "appearance",
          "Appearance",
          <label className="field">
            Tint color
            <span className="watchface-color-control">
              <input
                type="color"
                value={separator.color}
                onChange={(event) => updateStaticSeparator(separatorId, { color: event.target.value })}
              />
              <code>{separator.color}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={separator.color === design.digitColor}
                aria-label="Remove tint"
                title="Remove tint"
                onClick={() => updateStaticSeparator(separatorId, { color: design.digitColor })}
              >
                <XCircle size={14} />
              </button>
            </span>
          </label>,
          { disabled: isPositionLocked(separatorId === "colon" ? "staticColon" : "staticDateSlash") }
        )}
        {renderStrokeInspector(
          separatorId === "colon" ? "staticColon" : "staticDateSlash"
        )}
        {renderPropertySection(
          "specific",
          "Separator",
          <div className="wf-property-stack">
            <LocalFontPicker
              api={api}
              label="Font"
              value={separator.fontFamily ?? design.fontFamily}
              emptyLabel="System font"
              onChange={(fontFamily) => updateStaticSeparator(separatorId, { fontFamily })}
            />
            <label className="field watchface-zoom-control">
              Size <span>{separator.size}px</span>
              <input
                type="range"
                min="12"
                max="200"
                step="1"
                value={separator.size}
                onChange={(event) => {
                  const size = Number(event.target.value);
                  updateStaticSeparator(separatorId, { size });
                  setPosition(separator.x, separator.y, size);
                }}
              />
            </label>
          </div>,
          { disabled: isPositionLocked(separatorId === "colon" ? "staticColon" : "staticDateSlash") }
        )}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <p className="watchface-studio-summary">
            Drag the outline on the face for coarse placement, or use the exact transform controls.
          </p>,
          { disabled: isPositionLocked(separatorId === "colon" ? "staticColon" : "staticDateSlash") }
        )}
      </>
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
      <>
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
          <div className="wf-align-icon-grid" role="group" aria-label="Align AM/PM indicator to face">
            <button type="button" title="Align left" aria-label="Align left" onClick={() => alignX("start")}><AlignHorizontalJustifyStart size={14} /></button>
            <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignX("center")}><AlignHorizontalJustifyCenter size={14} /></button>
            <button type="button" title="Align right" aria-label="Align right" onClick={() => alignX("end")}><AlignHorizontalJustifyEnd size={14} /></button>
            <button type="button" title="Align top" aria-label="Align top" onClick={() => alignY("start")}><AlignVerticalJustifyStart size={14} /></button>
            <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => alignY("center")}><AlignVerticalJustifyCenter size={14} /></button>
            <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignY("end")}><AlignVerticalJustifyEnd size={14} /></button>
          </div>
          <span>Nudge</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y - fromWatchCoordinate(1))} aria-label="Nudge up"><ArrowUp size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x - fromWatchCoordinate(1), indicator.y)} aria-label="Nudge left"><ArrowLeft size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x + fromWatchCoordinate(1), indicator.y)} aria-label="Nudge right"><ArrowRight size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y + fromWatchCoordinate(1))} aria-label="Nudge down"><ArrowDown size={13} aria-hidden="true" /></button>
          </div>
        </>)}
        {renderPropertySection(
          "appearance",
          "Appearance",
          <label className="field">
            Tint color
            <span className="watchface-color-control">
              <input
                type="color"
                value={indicator.color ?? design.digitColor}
                onChange={(event) => updateAmPmIndicator({ color: event.target.value })}
              />
              <code>{indicator.color ?? "Template colors"}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!indicator.color}
                aria-label="Remove tint"
                title="Remove tint"
                onClick={() => updateAmPmIndicator({ color: undefined })}
              >
                <XCircle size={14} />
              </button>
            </span>
          </label>,
          { disabled: isPositionLocked("ampm") }
        )}
        {renderStrokeInspector("ampm")}
        {renderPropertySection(
          "specific",
          "Indicator",
          <div className="wf-property-stack">
            <LocalFontPicker
              api={api}
              label="Font"
              value={indicator.fontFamily ?? ""}
              emptyLabel="Keep template lettering"
              onChange={(fontFamily) => updateAmPmIndicator({ fontFamily })}
            />
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
          </div>,
          { disabled: isPositionLocked("ampm") }
        )}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <p className="watchface-studio-summary">
            The watch swaps this sprite between AM and PM in 12-hour mode.
          </p>,
          { disabled: isPositionLocked("ampm") }
        )}
      </>
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
      <>
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
          <div className="wf-align-icon-grid" role="group" aria-label="Align weather indicator to face">
            <button type="button" title="Align left" aria-label="Align left" onClick={() => alignX("start")}><AlignHorizontalJustifyStart size={14} /></button>
            <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => alignX("center")}><AlignHorizontalJustifyCenter size={14} /></button>
            <button type="button" title="Align right" aria-label="Align right" onClick={() => alignX("end")}><AlignHorizontalJustifyEnd size={14} /></button>
            <button type="button" title="Align top" aria-label="Align top" onClick={() => alignY("start")}><AlignVerticalJustifyStart size={14} /></button>
            <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => alignY("center")}><AlignVerticalJustifyCenter size={14} /></button>
            <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => alignY("end")}><AlignVerticalJustifyEnd size={14} /></button>
          </div>
          <span>Nudge</span>
          <div className="watchface-nudge-pad">
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y - fromWatchCoordinate(1))} aria-label="Nudge up"><ArrowUp size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x - fromWatchCoordinate(1), indicator.y)} aria-label="Nudge left"><ArrowLeft size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x + fromWatchCoordinate(1), indicator.y)} aria-label="Nudge right"><ArrowRight size={13} aria-hidden="true" /></button>
            <button type="button" onClick={() => setPosition(indicator.x, indicator.y + fromWatchCoordinate(1))} aria-label="Nudge down"><ArrowDown size={13} aria-hidden="true" /></button>
          </div>
        </>)}
        {renderPropertySection(
          "appearance",
          "Appearance",
          <label className="field">
            Tint color
            <span className="watchface-color-control">
              <input
                type="color"
                value={indicator.color ?? design.accentColor}
                onChange={(event) => updateWeatherIndicator({ color: event.target.value })}
              />
              <code>{indicator.color ?? "Template colors"}</code>
              <button
                type="button"
                className="watchface-color-none"
                disabled={!indicator.color}
                aria-label="Remove tint"
                title="Remove tint"
                onClick={() => updateWeatherIndicator({ color: undefined })}
              >
                <XCircle size={14} />
              </button>
            </span>
          </label>,
          { disabled: isPositionLocked("weather") }
        )}
        {renderStrokeInspector("weather")}
        {renderPropertySection(
          "specific",
          "Indicator",
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
          </label>,
          { disabled: isPositionLocked("weather") }
        )}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <p className="watchface-studio-summary">
            The editor previews the sunny state. The watch swaps among all 41 weather states.
          </p>,
          { disabled: isPositionLocked("weather") }
        )}
      </>
    );
  }

  function renderElementInspector(element: CorosWatchfaceBackgroundElement) {
    const set = (patch: BackgroundElementPatch) => updateElement(element.id, patch);
    const hasFill = element.kind === "rect" || element.kind === "ellipse";
    const layerId = `bgel:${element.id}`;
    const locked = isPositionLocked(layerId);
    const layer: EditorLayer = {
      id: layerId,
      kind: "backgroundElement",
      label: backgroundElementLabel(element),
      backgroundElementId: element.id,
      visible: element.visible !== false,
      canHide: true,
      present: true,
      bounds: null,
      capabilities: {
        position: true,
        color: false,
        scale: false,
        font: element.kind === "text",
        resize: element.kind === "rect" || element.kind === "ellipse",
        rotate: true,
        opacity: true,
        grouping: true,
        effects: true,
        stroke: true
      }
    };
    const alignButtons = (
      <div className="wf-align-icon-grid" role="group" aria-label="Align to face">
        <button type="button" title="Align left" aria-label="Align left" onClick={() => set({ x: 0 })}><AlignHorizontalJustifyStart size={14} /></button>
        <button type="button" title="Align horizontal center" aria-label="Align horizontal center" onClick={() => set({ x: BACKGROUND_SPACE / 2 })}><AlignHorizontalJustifyCenter size={14} /></button>
        <button type="button" title="Align right" aria-label="Align right" onClick={() => set({ x: BACKGROUND_SPACE })}><AlignHorizontalJustifyEnd size={14} /></button>
        <button type="button" title="Align top" aria-label="Align top" onClick={() => set({ y: 0 })}><AlignVerticalJustifyStart size={14} /></button>
        <button type="button" title="Align vertical center" aria-label="Align vertical center" onClick={() => set({ y: BACKGROUND_SPACE / 2 })}><AlignVerticalJustifyCenter size={14} /></button>
        <button type="button" title="Align bottom" aria-label="Align bottom" onClick={() => set({ y: BACKGROUND_SPACE })}><AlignVerticalJustifyEnd size={14} /></button>
      </div>
    );
    return (
      <>
        {renderLayerSection(layer)}
        {renderPropertySection(
          "transform",
          "Transform",
          <div className="wf-transform-stack">
            <div className="watchface-position-inputs">
              <label>X<EditableNumberInput min="0" max={BACKGROUND_SPACE} step="1" value={Math.round(element.x)} fallback={0} onValueChange={(x) => set({ x })} /></label>
              <label>Y<EditableNumberInput min="0" max={BACKGROUND_SPACE} step="1" value={Math.round(element.y)} fallback={0} onValueChange={(y) => set({ y })} /></label>
              {element.kind === "rect" || element.kind === "ellipse" ? (
                null
              ) : element.kind === "line" ? (
                <label>Length<EditableNumberInput min="10" max="800" step="1" value={element.dx} fallback={10} onValueChange={(dx) => set({ dx: Math.max(10, dx) })} /></label>
              ) : null}
              <label>Rotation<EditableNumberInput min="0" max="360" step="1" value={element.rotation} fallback={0} onValueChange={(rotation) => set({ rotation: normalizeWatchfaceRotation(rotation) })} /></label>
            </div>
            {element.kind === "rect" || element.kind === "ellipse" ? (
              <LinkedDimensionInputs
                width={element.width}
                height={element.height}
                minimum={8}
                maximum={800}
                linked={element.aspectLocked === true}
                onDimensionsChange={(dimensions) => set(dimensions)}
                onLinkedChange={(aspectLocked) => set({ aspectLocked })}
              />
            ) : null}
            <div className="wf-control-label">Align to face</div>
            {alignButtons}
          </div>,
          { disabled: locked }
        )}
        {renderPropertySection(
          "appearance",
          "Appearance",
          <div className="wf-property-stack">
            {hasFill ? (
              <>
                <label className="watchface-studio-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(element.gradient)}
                    onChange={(event) =>
                      set(
                        event.target.checked
                          ? { gradient: { from: element.fill, to: "#04140f", angle: 90 } }
                          : { gradient: undefined }
                      )
                    }
                  />
                  Gradient fill
                </label>
                {element.gradient ? (
                  <>
                    <label className="field">From<span className="watchface-color-control"><input type="color" value={element.gradient.from} onChange={(event) => set({ gradient: { ...element.gradient!, from: event.target.value } })} /><code>{element.gradient.from}</code></span></label>
                    <label className="field">To<span className="watchface-color-control"><input type="color" value={element.gradient.to} onChange={(event) => set({ gradient: { ...element.gradient!, to: event.target.value } })} /><code>{element.gradient.to}</code></span></label>
                    <label className="watchface-inspector-field"><span>Gradient angle</span><EditableNumberInput min="0" max="360" step="1" value={element.gradient.angle} fallback={0} onValueChange={(angle) => set({ gradient: { ...element.gradient!, angle: normalizeWatchfaceRotation(angle) } })} /></label>
                  </>
                ) : (
                  <label className="field">Fill<span className="watchface-color-control"><input type="color" value={element.fill} onChange={(event) => set({ fill: event.target.value })} /><code>{element.fill}</code></span></label>
                )}
                {element.kind === "rect" ? (
                  <label className="watchface-inspector-field"><span>Corner radius</span><EditableNumberInput min="0" max="200" step="1" value={element.cornerRadius} fallback={0} onValueChange={(cornerRadius) => set({ cornerRadius: Math.max(0, cornerRadius) })} /></label>
                ) : null}
              </>
            ) : null}
            {element.kind === "line" ? (
              <>
                <label className="field">Color<span className="watchface-color-control"><input type="color" value={element.color} onChange={(event) => set({ color: event.target.value })} /><code>{element.color}</code></span></label>
                <label className="watchface-inspector-field"><span>Thickness</span><EditableNumberInput min="1" max="60" step="1" value={element.strokeWidth} fallback={1} onValueChange={(strokeWidth) => set({ strokeWidth: Math.max(1, strokeWidth) })} /></label>
              </>
            ) : null}
            {element.kind === "text" ? (
              <label className="field">Color<span className="watchface-color-control"><input type="color" value={element.color} onChange={(event) => set({ color: event.target.value })} /><code>{element.color}</code></span></label>
            ) : null}
          </div>,
          { disabled: locked }
        )}
        {renderStrokeInspector(layerId)}
        {element.kind === "text"
          ? renderPropertySection(
              "specific",
              "Text",
              <div className="wf-property-stack">
                <label className="field">Text<input value={element.text} maxLength={40} onChange={(event) => set({ text: event.target.value })} /></label>
                <LocalFontPicker api={api} label="Font" value={element.fontFamily} emptyLabel="System font" onChange={(fontFamily) => set({ fontFamily })} />
                <div className="watchface-position-inputs">
                  <label>Size<EditableNumberInput min="12" max="200" step="1" value={element.fontSize} fallback={12} onValueChange={(fontSize) => set({ fontSize: Math.max(12, fontSize) })} /></label>
                  <label>Weight<EditableNumberInput min="100" max="900" step="100" value={element.weight} fallback={400} onValueChange={(weight) => set({ weight: Math.max(100, Math.min(900, Math.round(weight / 100) * 100)) })} /></label>
                </div>
                <label className="field">Text align<select value={element.align} onChange={(event) => set({ align: event.target.value as CorosWatchfaceBackgroundText["align"] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              </div>,
              { disabled: locked }
            )
          : null}
        {renderEffectsInspector(layerId)}
        {renderPropertySection(
          "advanced",
          "Advanced",
          <div className="wf-property-stack">
            <div className="wf-control-label">Nudge</div>
            <div className="watchface-nudge-pad">
              <button type="button" aria-label="Nudge object up" onClick={() => set({ y: element.y - 1 })}><ArrowUp size={13} /></button>
              <button type="button" aria-label="Nudge object left" onClick={() => set({ x: element.x - 1 })}><ArrowLeft size={13} /></button>
              <button type="button" aria-label="Nudge object right" onClick={() => set({ x: element.x + 1 })}><ArrowRight size={13} /></button>
              <button type="button" aria-label="Nudge object down" onClick={() => set({ y: element.y + 1 })}><ArrowDown size={13} /></button>
              <button type="button" className="watchface-nudge-reset" onClick={() => set({ x: BACKGROUND_SPACE / 2, y: BACKGROUND_SPACE / 2 })}>Reset</button>
            </div>
            {renderArtworkLayerOrderControls(
              watchfaceBackgroundElementLayerId(element.id)
            )}
            <button className="secondary-button wf-danger-action" type="button" onClick={() => removeElement(element.id)}>
              <Trash2 size={15} /> Remove {element.kind === "text" ? "text" : "shape"}
            </button>
          </div>,
          { disabled: locked }
        )}
      </>
    );
  }
}
