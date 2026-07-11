import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  Flame,
  Footprints,
  HeartPulse,
  ImagePlus,
  Loader2,
  Mountain,
  Move,
  Palette,
  Save,
  Sparkles,
  Trash2,
  Type,
  WandSparkles
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork,
  CorosWatchfaceDesignSprite,
  CorosWatchfaceDesignState,
  CorosWatchfaceProject,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  applyConfigOverridesToDetails,
  applyLayoutToDetails,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildMetricSpriteReplacements,
  buildMetricStyleOverrides,
  buildStaticSeparatorOverrides,
  buildStudioReplacements,
  buildTimeSpriteReplacements,
  buildTimeStyleOverrides,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  drawStudioPreview,
  getAvailableComplications,
  getFixedMetricCapabilities,
  inferStaticSeparators,
  layoutGroupAtPoint,
  layoutGroupKeys,
  loadStudioImage,
  mergeAssetReplacements,
  mergeConfigOverrides,
  pickPreviewResolution,
  summarizeStudioReplacements,
  WATCHFACE_LAYOUT_GROUPS,
  type WatchfaceLayoutGroupBounds,
  type WatchfaceLayoutOffset,
  type WatchfaceMetricChanges,
  type WatchfaceMetricId,
  type WatchfaceMetricStyles,
  type WatchfaceTimePartId,
  type WatchfaceTimeStyles,
  type WatchfaceComplicationId,
  type WatchfaceStudioOptions,
  type WatchfaceStaticSeparatorId,
  type WatchfaceStaticSeparators
} from "./watchfaceStudio";

interface WatchfaceCreatorProps {
  api: CorosLinkApi;
  starterArchive: CorosWatchfaceArchive;
  disabled?: boolean;
  initialProject?: CorosWatchfaceProject | null;
  onProjectSaved?: (project: CorosWatchfaceProject) => void;
  onCreated: (archive: CorosWatchfaceArchive) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

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

const PREVIEW_SIZE = 360;

const METRIC_ICONS = {
  heartRate: HeartPulse,
  steps: Footprints,
  calories: Flame,
  elevation: Mountain
} satisfies Record<WatchfaceMetricId, typeof HeartPulse>;

const DEFAULT_STATIC_SEPARATORS: WatchfaceStaticSeparators = {
  colon: { enabled: false, x: 400, y: 320, size: 64, color: "#ffffff" },
  dateSlash: { enabled: false, x: 400, y: 240, size: 48, color: "#ffffff" }
};

const MAX_DESIGN_SPRITES = 12;

function separatorIdForGroup(groupId: string): WatchfaceStaticSeparatorId | null {
  if (groupId === "staticColon") {
    return "colon";
  }
  if (groupId === "staticDateSlash") {
    return "dateSlash";
  }
  return null;
}

export function WatchfaceCreator({
  api,
  starterArchive,
  disabled = false,
  initialProject = null,
  onProjectSaved,
  onCreated,
  onError,
  onNotice
}: WatchfaceCreatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const assetCacheRef = useRef(new Map<string, CorosWatchfaceTemplateAsset>());
  const [artwork, setArtwork] = useState<CorosWatchfaceArtwork | null>(null);
  const [designSprites, setDesignSprites] = useState<CorosWatchfaceDesignSprite[]>([]);
  const [backgroundColor, setBackgroundColor] = useState("#081116");
  const [accentColor, setAccentColor] = useState("#51e0b5");
  const [zoom, setZoom] = useState(1);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [loadingArtwork, setLoadingArtwork] = useState(false);
  const [loadingSprite, setLoadingSprite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(
    initialProject?.projectId ?? null
  );
  const [projectName, setProjectName] = useState(
    initialProject?.name ?? starterArchive.fileName.replace(/\.(zip|dat)$/i, "")
  );
  const [details, setDetails] = useState<CorosWatchfaceTemplateDetails | null>(null);
  const [fontFamily, setFontFamily] = useState("");
  const [digitColor, setDigitColor] = useState("#ffffff");
  const [tintLabels, setTintLabels] = useState(false);
  const [tintIcons, setTintIcons] = useState(false);
  const [metricChanges, setMetricChanges] = useState<WatchfaceMetricChanges>({});
  const [metricStyles, setMetricStyles] = useState<WatchfaceMetricStyles>({});
  const [timeStyles, setTimeStyles] = useState<WatchfaceTimeStyles>({});
  const [staticSeparators, setStaticSeparators] =
    useState<WatchfaceStaticSeparators>(DEFAULT_STATIC_SEPARATORS);
  const [previewComplication, setPreviewComplication] =
    useState<WatchfaceComplicationId>("heartRate");
  const [layoutOffsets, setLayoutOffsets] = useState<
    Record<string, WatchfaceLayoutOffset>
  >({});
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    groupId: string;
    kind: "layout" | "separator" | "sprite";
    startX: number;
    startY: number;
    baseDx: number;
    baseDy: number;
  } | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);

  const studioOptions: WatchfaceStudioOptions = {
    fontFamily,
    digitColor,
    accentColor,
    tintLabels,
    tintIcons,
    previewComplication,
    metricStyles,
    timeStyles
  };
  const studioActive = Boolean(fontFamily) || tintLabels || tintIcons;
  const metricStyleActive = Object.keys(metricStyles).length > 0;
  const timeStyleActive = Object.keys(timeStyles).length > 0;
  const summary = details
    ? summarizeStudioReplacements(details, studioOptions)
    : null;
  const layoutActive = Object.values(layoutOffsets).some(
    (offset) => offset.dx !== 0 || offset.dy !== 0
  );
  const fixedMetricCapabilities = useMemo(
    () => (details ? getFixedMetricCapabilities(details) : []),
    [details]
  );
  const availableComplications = useMemo(
    () => (details ? getAvailableComplications(details) : []),
    [details]
  );
  const metricOverrides = useMemo(
    () => (details ? buildMetricOverrides(details, metricChanges) : []),
    [details, metricChanges]
  );
  const metricDetails = useMemo(
    () =>
      details
        ? applyConfigOverridesToDetails(details, metricOverrides)
        : null,
    [details, metricOverrides]
  );
  const metricStyleOverrides = useMemo(
    () =>
      metricDetails
        ? buildMetricStyleOverrides(metricDetails, metricStyles)
        : [],
    [metricDetails, metricStyles]
  );
  const timeStyleOverrides = useMemo(
    () =>
      metricDetails
        ? buildTimeStyleOverrides(metricDetails, timeStyles)
        : [],
    [metricDetails, timeStyles]
  );
  const staticSeparatorOverrides = useMemo(
    () =>
      details
        ? buildStaticSeparatorOverrides(details, staticSeparators)
        : [],
    [details, staticSeparators]
  );
  const componentStyleOverrides = useMemo(
    () =>
      mergeConfigOverrides(
        metricStyleOverrides,
        timeStyleOverrides,
        staticSeparatorOverrides
      ),
    [metricStyleOverrides, timeStyleOverrides, staticSeparatorOverrides]
  );
  const styledMetricDetails = useMemo(
    () =>
      metricDetails
        ? applyConfigOverridesToDetails(metricDetails, componentStyleOverrides)
        : null,
    [metricDetails, componentStyleOverrides]
  );
  const previewDetails = useMemo(
    () =>
      styledMetricDetails
        ? applyLayoutToDetails(styledMetricDetails, layoutOffsets)
        : null,
    [styledMetricDetails, layoutOffsets]
  );
  const movableGroups = useMemo(() => {
    const base = styledMetricDetails
      ? pickPreviewResolution(styledMetricDetails)
      : null;
    if (!base) {
      return [];
    }
    return WATCHFACE_LAYOUT_GROUPS.filter(
      (group) => layoutGroupKeys(base, group).length > 0
    );
  }, [styledMetricDetails]);
  const customizableTimeParts = useMemo(
    () =>
      movableGroups.filter(
        (group) => group.id === "hours" || group.id === "minutes"
      ) as (typeof movableGroups[number] & { id: WatchfaceTimePartId })[],
    [movableGroups]
  );
  const previewResolution = useMemo(
    () => (previewDetails ? pickPreviewResolution(previewDetails) : null),
    [previewDetails]
  );
  const layoutLimits = useMemo(() => {
    const base = styledMetricDetails
      ? pickPreviewResolution(styledMetricDetails)
      : null;
    return base ? computeLayoutOffsetLimits(base) : {};
  }, [styledMetricDetails]);
  const groupBounds = useMemo<WatchfaceLayoutGroupBounds[]>(() => {
    if (!previewResolution) {
      return [];
    }
    const movable = new Set(movableGroups.map((group) => group.id));
    const templateBounds = computeLayoutGroupBounds(previewResolution).filter((box) =>
      movable.has(box.id)
    );
    const separatorBounds = ([
      ["colon", "staticColon", "Static colon"],
      ["dateSlash", "staticDateSlash", "Static date slash"]
    ] as const).flatMap(([separatorId, id, label]) => {
      const separator = staticSeparators[separatorId];
      if (!separator.enabled) {
        return [];
      }
      const width = Math.max(24, separator.size * 0.65);
      const height = Math.max(24, separator.size * 1.15);
      return [{
        id,
        label,
        x0: separator.x - width / 2,
        y0: separator.y - height / 2,
        x1: separator.x + width / 2,
        y1: separator.y + height / 2
      }];
    });
    const spriteBounds = designSprites.map((sprite) => {
      const width = sprite.width * sprite.scale;
      const height = sprite.height * sprite.scale;
      const radians = (sprite.rotation * Math.PI) / 180;
      const rotatedWidth =
        Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
      const rotatedHeight =
        Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
      return {
        id: `sprite:${sprite.id}`,
        label: "Custom image sprite",
        x0: sprite.x - rotatedWidth / 2,
        y0: sprite.y - rotatedHeight / 2,
        x1: sprite.x + rotatedWidth / 2,
        y1: sprite.y + rotatedHeight / 2
      };
    });
    return [...templateBounds, ...separatorBounds, ...spriteBounds];
  }, [previewResolution, movableGroups, staticSeparators, designSprites]);

  const toResolutionPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || !previewResolution) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * previewResolution.width,
        y: ((event.clientY - rect.top) / rect.height) * previewResolution.height
      };
    },
    [previewResolution]
  );

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || creating) {
      return;
    }
    const point = toResolutionPoint(event);
    if (!point) {
      return;
    }
    const hit = layoutGroupAtPoint(groupBounds, point.x, point.y);
    if (!hit) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const separatorId = separatorIdForGroup(hit.id);
    const spriteId = hit.id.startsWith("sprite:") ? hit.id.slice(7) : null;
    const sprite = spriteId
      ? designSprites.find((entry) => entry.id === spriteId)
      : undefined;
    const offset = separatorId
      ? {
          dx: staticSeparators[separatorId].x,
          dy: staticSeparators[separatorId].y
        }
      : sprite
        ? { dx: sprite.x, dy: sprite.y }
      : layoutOffsets[hit.id] ?? { dx: 0, dy: 0 };
    dragRef.current = {
      groupId: hit.id,
      kind: separatorId ? "separator" : sprite ? "sprite" : "layout",
      startX: point.x,
      startY: point.y,
      baseDx: offset.dx,
      baseDy: offset.dy
    };
    setDraggingGroup(hit.id);
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = toResolutionPoint(event);
    if (!point) {
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      setHoveredGroup(layoutGroupAtPoint(groupBounds, point.x, point.y)?.id ?? null);
      return;
    }
    if (drag.kind === "separator") {
      const separatorId = separatorIdForGroup(drag.groupId);
      if (!separatorId || !previewResolution) {
        return;
      }
      setStaticSeparators((current) => ({
        ...current,
        [separatorId]: {
          ...current[separatorId],
          x: Math.max(
            0,
            Math.min(
              previewResolution.width,
              Math.round(drag.baseDx + point.x - drag.startX)
            )
          ),
          y: Math.max(
            0,
            Math.min(
              previewResolution.height,
              Math.round(drag.baseDy + point.y - drag.startY)
            )
          )
        }
      }));
      return;
    }
    if (drag.kind === "sprite") {
      const spriteId = drag.groupId.startsWith("sprite:")
        ? drag.groupId.slice(7)
        : "";
      if (!spriteId || !previewResolution) {
        return;
      }
      setDesignSprites((current) =>
        current.map((sprite) =>
          sprite.id === spriteId
            ? {
                ...sprite,
                x: Math.max(
                  0,
                  Math.min(
                    previewResolution.width,
                    Math.round(drag.baseDx + point.x - drag.startX)
                  )
                ),
                y: Math.max(
                  0,
                  Math.min(
                    previewResolution.height,
                    Math.round(drag.baseDy + point.y - drag.startY)
                  )
                )
              }
            : sprite
        )
      );
      return;
    }
    const limits = layoutLimits[drag.groupId];
    const clamp = (value: number, minimum: number, maximum: number) =>
      Math.max(minimum, Math.min(maximum, Math.round(value)));
    const fallbackLimit = Math.max(
      previewResolution?.width ?? 800,
      previewResolution?.height ?? 800
    );
    setLayoutOffsets((current) => ({
      ...current,
      [drag.groupId]: {
        dx: clamp(
          drag.baseDx + point.x - drag.startX,
          limits?.minDx ?? -fallbackLimit,
          limits?.maxDx ?? fallbackLimit
        ),
        dy: clamp(
          drag.baseDy + point.y - drag.startY,
          limits?.minDy ?? -fallbackLimit,
          limits?.maxDy ?? fallbackLimit
        )
      }
    }));
  }

  function handlePreviewPointerEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setDraggingGroup(null);
    }
  }

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !previewResolution) {
      return;
    }
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    const scale = canvas.width / previewResolution.width;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const activeId = draggingGroup ?? hoveredGroup;
    for (const box of groupBounds) {
      const active = box.id === activeId;
      context.strokeStyle = active
        ? "rgba(81, 224, 181, 0.95)"
        : "rgba(255, 255, 255, 0.22)";
      context.lineWidth = active ? 2 : 1;
      context.setLineDash(active ? [] : [6, 6]);
      context.strokeRect(
        box.x0 * scale,
        box.y0 * scale,
        (box.x1 - box.x0) * scale,
        (box.y1 - box.y0) * scale
      );
      if (active) {
        context.setLineDash([]);
        context.font = "600 11px system-ui, sans-serif";
        const labelY = box.y0 * scale - 6;
        context.fillStyle = "rgba(81, 224, 181, 0.95)";
        context.fillText(
          box.label,
          box.x0 * scale,
          labelY > 10 ? labelY : box.y1 * scale + 13
        );
      }
    }
    context.setLineDash([]);
  }, [groupBounds, hoveredGroup, draggingGroup, previewResolution]);

  const loadAssets = useCallback(
    async (paths: string[]): Promise<CorosWatchfaceTemplateAsset[]> => {
      const cache = assetCacheRef.current;
      const missing = paths.filter((path) => !cache.has(path));
      if (missing.length > 0) {
        for (const asset of await api.loadCorosWatchfaceTemplateAssets(
          starterArchive.archiveId,
          missing
        )) {
          cache.set(asset.path, asset);
        }
      }
      return paths
        .map((path) => cache.get(path))
        .filter((asset): asset is CorosWatchfaceTemplateAsset => Boolean(asset));
    },
    [api, starterArchive.archiveId]
  );

  useEffect(() => {
    const saved = initialProject?.design;
    assetCacheRef.current.clear();
    setDetails(null);
    setArtwork(saved?.artwork ?? null);
    setBackgroundColor(saved?.backgroundColor ?? "#081116");
    setAccentColor(saved?.accentColor ?? "#51e0b5");
    setZoom(saved?.zoom ?? 1);
    setFontFamily(saved?.fontFamily ?? "");
    setDigitColor(saved?.digitColor ?? "#ffffff");
    setTintLabels(saved?.tintLabels ?? false);
    setTintIcons(saved?.tintIcons ?? false);
    setPreviewComplication(
      (saved?.previewComplication as WatchfaceComplicationId | undefined) ??
        "heartRate"
    );
    setLayoutOffsets(
      (saved?.layoutOffsets as Record<string, WatchfaceLayoutOffset> | undefined) ?? {}
    );
    setMetricChanges(
      (saved?.metricChanges as WatchfaceMetricChanges | undefined) ?? {}
    );
    setMetricStyles(
      (saved?.metricStyles as WatchfaceMetricStyles | undefined) ?? {}
    );
    setTimeStyles((saved?.timeStyles as WatchfaceTimeStyles | undefined) ?? {});
    setStaticSeparators(
      (saved?.staticSeparators as WatchfaceStaticSeparators | undefined) ??
        DEFAULT_STATIC_SEPARATORS
    );
    setDesignSprites(saved?.designSprites ?? []);
    setProjectId(initialProject?.projectId ?? null);
    setProjectName(
      initialProject?.name ?? starterArchive.fileName.replace(/\.(zip|dat)$/i, "")
    );
    let cancelled = false;
    api
      .describeCorosWatchfaceTemplate(starterArchive.archiveId)
      .then((described) => {
        if (!cancelled) {
          setDetails(described);
          if (!saved) {
            setStaticSeparators(inferStaticSeparators(described));
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          onNotice(
            "This template exposes no restylable sprites; the creator will replace only the background."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, initialProject, onNotice, starterArchive.archiveId, starterArchive.fileName]);

  useEffect(() => {
    if (
      availableComplications.length > 0 &&
      !availableComplications.some((item) => item.id === previewComplication)
    ) {
      setPreviewComplication(availableComplications[0]!.id);
    }
  }, [availableComplications, previewComplication]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = 800;
    canvas.height = 800;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let cancelled = false;
    const paint = (
      image: HTMLImageElement | undefined,
      spriteImages: Map<string, HTMLImageElement>
    ) => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, 800, 800);
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, 800, 800);

      if (image) {
        const scale = Math.max(800 / image.naturalWidth, 800 / image.naturalHeight) * zoom;
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (800 - width) / 2, (800 - height) / 2, width, height);
      }

      const shade = context.createLinearGradient(0, 0, 800, 800);
      shade.addColorStop(0, hexToRgba(backgroundColor, 0.3));
      shade.addColorStop(0.46, "rgba(0, 0, 0, 0.06)");
      shade.addColorStop(1, "rgba(0, 0, 0, 0.56)");
      context.fillStyle = shade;
      context.fillRect(0, 0, 800, 800);

      const separatorScale = 800 / (previewResolution?.width ?? 800);
      for (const sprite of designSprites) {
        const spriteImage = spriteImages.get(sprite.id);
        if (!spriteImage) {
          continue;
        }
        const width = sprite.width * sprite.scale * separatorScale;
        const height = sprite.height * sprite.scale * separatorScale;
        context.save();
        context.translate(
          sprite.x * separatorScale,
          sprite.y * separatorScale
        );
        context.rotate((sprite.rotation * Math.PI) / 180);
        context.drawImage(spriteImage, -width / 2, -height / 2, width, height);
        context.restore();
      }

      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const [separatorId, text] of [
        ["colon", ":"],
        ["dateSlash", "/"]
      ] as const) {
        const separator = staticSeparators[separatorId];
        if (!separator.enabled) {
          continue;
        }
        const family = fontFamily
          ? `"${fontFamily.replace(/["\\]/g, "")}"`
          : "system-ui, sans-serif";
        context.font = `700 ${Math.round(separator.size * separatorScale)}px ${family}`;
        context.fillStyle = separator.color;
        context.fillText(
          text,
          separator.x * separatorScale,
          separator.y * separatorScale
        );
      }
      context.textAlign = "start";
      context.textBaseline = "alphabetic";

      // Keep the dynamic time/date/control area clear: COROS draws those from
      // the retained config.txt and number-sprite files on the actual watch.
      context.strokeStyle = "rgba(255, 255, 255, 0.14)";
      context.lineWidth = 1;
      context.setLineDash([8, 12]);
      context.strokeRect(492, 96, 244, 590);
      context.setLineDash([]);
      setBackgroundDataUrl(canvas.toDataURL("image/png"));
    };

    void (async () => {
      const image = artwork
        ? await loadStudioImage(artwork.dataUrl).catch(() => undefined)
        : undefined;
      const spriteImages = new Map<string, HTMLImageElement>();
      await Promise.all(
        designSprites.map(async (sprite) => {
          const spriteImage = await loadStudioImage(sprite.dataUrl).catch(
            () => undefined
          );
          if (spriteImage) {
            spriteImages.set(sprite.id, spriteImage);
          }
        })
      );
      paint(image, spriteImages);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    artwork,
    backgroundColor,
    zoom,
    staticSeparators,
    designSprites,
    fontFamily,
    previewResolution
  ]);

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
        {
          fontFamily,
          digitColor,
          accentColor,
          tintLabels,
          tintIcons,
          previewComplication,
          metricStyles,
          timeStyles
        },
        loadAssets
      ).catch(() => {
        // The preview is best-effort; creation re-validates everything.
      });
    }, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    backgroundDataUrl,
    previewDetails,
    fontFamily,
    digitColor,
    accentColor,
    tintLabels,
    tintIcons,
    previewComplication,
    metricStyles,
    timeStyles,
    loadAssets
  ]);

  async function chooseArtwork() {
    setLoadingArtwork(true);
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (!selected) {
        return;
      }
      setArtwork(selected);
      setZoom(1);
      onNotice("Artwork added to the canvas. Position it with the scale control.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setLoadingArtwork(false);
    }
  }

  async function chooseDesignSprite() {
    if (designSprites.length >= MAX_DESIGN_SPRITES) {
      onError(`A design can contain up to ${MAX_DESIGN_SPRITES} custom sprites.`);
      return;
    }
    setLoadingSprite(true);
    try {
      const selected = await api.chooseCorosWatchfaceArtwork();
      if (!selected) {
        return;
      }
      const resolutionWidth = previewResolution?.width ?? 800;
      const resolutionHeight = previewResolution?.height ?? 800;
      const maximumSize = Math.min(resolutionWidth, resolutionHeight) * 0.28;
      const fitScale = Math.min(
        1,
        maximumSize / Math.max(selected.width, selected.height)
      );
      setDesignSprites((current) => [
        ...current,
        {
          id: window.crypto.randomUUID(),
          dataUrl: selected.dataUrl,
          sourceWidth: selected.width,
          sourceHeight: selected.height,
          width: Math.max(1, Math.round(selected.width * fitScale)),
          height: Math.max(1, Math.round(selected.height * fitScale)),
          x: Math.round(resolutionWidth / 2),
          y: Math.round(resolutionHeight / 2),
          scale: 1,
          rotation: 0
        }
      ]);
      onNotice("Custom sprite added. Drag its outline on the preview to position it.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setLoadingSprite(false);
    }
  }

  async function saveProject() {
    const name = projectName.trim();
    if (!name) {
      onError("Enter a project name before saving.");
      return;
    }
    setSavingProject(true);
    try {
      const design: CorosWatchfaceDesignState = {
        version: 1,
        backgroundColor,
        accentColor,
        artwork,
        zoom,
        fontFamily,
        digitColor,
        tintLabels,
        tintIcons,
        previewComplication,
        metricChanges: Object.fromEntries(
          Object.entries(metricChanges).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
          )
        ),
        metricStyles: Object.fromEntries(
          Object.entries(metricStyles).filter(
            (entry): entry is [string, { color: string; scale: number }] =>
              Boolean(entry[1])
          )
        ),
        timeStyles: Object.fromEntries(
          Object.entries(timeStyles).filter(
            (entry): entry is [string, { color: string; scale: number }] =>
              Boolean(entry[1])
          )
        ),
        staticSeparators,
        layoutOffsets,
        designSprites
      };
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
      onError(toErrorMessage(caught));
    } finally {
      setSavingProject(false);
    }
  }

  async function createArchive() {
    if (!backgroundDataUrl) {
      onError("The canvas is still rendering. Try again in a moment.");
      return;
    }
    setCreating(true);
    try {
      const assetReplacements =
        details && studioActive
          ? await buildStudioReplacements(details, studioOptions, loadAssets)
          : [];
      const metricSpriteReplacements =
        metricDetails && metricStyleActive
          ? await buildMetricSpriteReplacements(
              metricDetails,
              metricStyles,
              fontFamily,
              loadAssets
            )
          : [];
      const timeSpriteReplacements =
        details && timeStyleActive
          ? await buildTimeSpriteReplacements(
              details,
              timeStyles,
              fontFamily,
              loadAssets
            )
          : [];
      const allAssetReplacements = mergeAssetReplacements(
        assetReplacements,
        metricSpriteReplacements,
        timeSpriteReplacements
      );
      const exportMetricStyleOverrides =
        metricDetails && metricStyleActive
          ? buildMetricStyleOverrides(metricDetails, metricStyles, true)
          : [];
      const exportTimeStyleOverrides =
        details && timeStyleActive
          ? buildTimeStyleOverrides(details, timeStyles, true)
          : [];
      const layoutOverrides =
        styledMetricDetails && layoutActive
          ? buildLayoutOverrides(styledMetricDetails, layoutOffsets)
          : [];
      const configOverrides = mergeConfigOverrides(
        metricOverrides,
        exportMetricStyleOverrides,
        exportTimeStyleOverrides,
        staticSeparatorOverrides,
        layoutOverrides
      );
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl,
        ...(allAssetReplacements.length > 0
          ? { assetReplacements: allAssetReplacements }
          : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {})
      });
      onCreated(archive);
      const styledParts = [
        ...(allAssetReplacements.length > 0
          ? [`${allAssetReplacements.length} restyled sprites`]
          : []),
        ...(layoutOverrides.length > 0 ? ["a moved layout"] : []),
        ...(designSprites.length > 0
          ? [`${designSprites.length} custom design sprite${designSprites.length === 1 ? "" : "s"}`]
          : []),
        ...(staticSeparators.colon.enabled || staticSeparators.dateSlash.enabled
          ? ["static separators"]
          : []),
        ...(Object.keys(metricChanges).length > 0 ? ["live metric changes"] : [])
      ];
      onNotice(
        styledParts.length > 0
          ? `Created a custom watchface archive with ${styledParts.join(" and ")}.`
          : "Created a fresh upload-ready custom watchface archive."
      );
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  const previewStyle = {
    "--creator-background": backgroundDataUrl ? `url(${backgroundDataUrl})` : "none"
  } as CSSProperties;

  return (
    <section className="panel watchface-creator">
      <div className="watchfaces-panel-heading">
        <span className="watchfaces-panel-icon"><Palette size={20} /></span>
        <div>
          <p className="eyebrow">Step 4</p>
          <h2>Create the visual layer</h2>
        </div>
      </div>
      <p className="watchfaces-muted">
        Design the background, digits, and theme here. The starter template
        keeps the live clock, date, battery, and activity fields on the watch.
      </p>

      <div className="watchface-creator-layout">
        <div className="watchface-creator-controls">
          <div className="watchface-color-grid">
            <label className="field">
              Base color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={backgroundColor}
                  onChange={(event) => setBackgroundColor(event.target.value)}
                />
                <code>{backgroundColor}</code>
              </span>
            </label>
            <label className="field">
              Accent color
              <span className="watchface-color-control">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(event) => setAccentColor(event.target.value)}
                />
                <code>{accentColor}</code>
              </span>
            </label>
          </div>
          <div className="watchface-creator-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={disabled || loadingArtwork || creating}
              onClick={() => void chooseArtwork()}
            >
              {loadingArtwork ? <Loader2 className="spin" size={16} /> : <ImagePlus size={16} />}
              {artwork ? "Replace artwork" : "Add artwork"}
            </button>
            {artwork ? (
              <button
                className="secondary-button"
                type="button"
                disabled={disabled || creating}
                onClick={() => setArtwork(null)}
              >
                <Trash2 size={16} /> Remove
              </button>
            ) : null}
          </div>
          {artwork ? (
            <label className="field watchface-zoom-control">
              Artwork scale <span>{zoom.toFixed(2)}×</span>
              <input
                type="range"
                min="1"
                max="2.25"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
          ) : null}

          <div className="watchface-studio-controls">
            <p className="watchface-studio-heading">
              <ImagePlus size={15} aria-hidden="true" /> Custom image sprites
              <span className="watchface-studio-flag">static</span>
            </p>
            <p className="watchface-studio-summary">
              Add transparent PNGs or other images as design layers. Drag a
              sprite on the preview, then fine-tune its transform here.
            </p>
            <button
              className="secondary-button"
              type="button"
              disabled={
                disabled ||
                creating ||
                loadingSprite ||
                designSprites.length >= MAX_DESIGN_SPRITES
              }
              onClick={() => void chooseDesignSprite()}
            >
              {loadingSprite ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <ImagePlus size={16} />
              )}
              Add image sprite
            </button>
            {designSprites.length > 0 ? (
              <div className="watchface-design-sprite-list">
                {designSprites.map((sprite, index) => {
                  const update = (values: Partial<CorosWatchfaceDesignSprite>) =>
                    setDesignSprites((current) =>
                      current.map((entry) =>
                        entry.id === sprite.id ? { ...entry, ...values } : entry
                      )
                    );
                  return (
                    <div className="watchface-design-sprite-card" key={sprite.id}>
                      <div className="watchface-design-sprite-heading">
                        <img src={sprite.dataUrl} alt="" />
                        <strong>Sprite {index + 1}</strong>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Remove sprite ${index + 1}`}
                          disabled={disabled || creating}
                          onClick={() =>
                            setDesignSprites((current) =>
                              current.filter((entry) => entry.id !== sprite.id)
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="watchface-design-sprite-position">
                        <label>
                          X
                          <input
                            type="number"
                            min={0}
                            max={previewResolution?.width ?? 800}
                            value={sprite.x}
                            disabled={disabled || creating}
                            onChange={(event) =>
                              update({
                                x: Math.max(
                                  0,
                                  Math.min(
                                    previewResolution?.width ?? 800,
                                    Number(event.target.value) || 0
                                  )
                                )
                              })
                            }
                          />
                        </label>
                        <label>
                          Y
                          <input
                            type="number"
                            min={0}
                            max={previewResolution?.height ?? 800}
                            value={sprite.y}
                            disabled={disabled || creating}
                            onChange={(event) =>
                              update({
                                y: Math.max(
                                  0,
                                  Math.min(
                                    previewResolution?.height ?? 800,
                                    Number(event.target.value) || 0
                                  )
                                )
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="watchface-design-sprite-range">
                        <span>Scale</span>
                        <input
                          type="range"
                          min="0.1"
                          max="4"
                          step="0.05"
                          value={sprite.scale}
                          disabled={disabled || creating}
                          onChange={(event) =>
                            update({ scale: Number(event.target.value) })
                          }
                        />
                        <output>{sprite.scale.toFixed(2)}×</output>
                      </label>
                      <label className="watchface-design-sprite-range">
                        <span>Rotate</span>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          step="1"
                          value={sprite.rotation}
                          disabled={disabled || creating}
                          onChange={(event) =>
                            update({ rotation: Number(event.target.value) })
                          }
                        />
                        <output>{Math.round(sprite.rotation)}°</output>
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="watchface-studio-controls">
            <p className="watchface-studio-heading">
              <Type size={15} aria-hidden="true" /> Digits &amp; theme
            </p>
            {details ? (
              <>
                <div className="watchface-color-grid">
                  <label className="field">
                    Digit font
                    <select
                      value={fontFamily}
                      onChange={(event) => setFontFamily(event.target.value)}
                      disabled={disabled || creating}
                    >
                      <option value="">Keep template digits</option>
                      {DIGIT_FONT_OPTIONS.map((family) => (
                        <option key={family} value={family}>{family}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Digit color
                    <span className="watchface-color-control">
                      <input
                        type="color"
                        value={digitColor}
                        disabled={disabled || creating}
                        onChange={(event) => setDigitColor(event.target.value)}
                      />
                      <code>{digitColor}</code>
                    </span>
                  </label>
                </div>
                {customizableTimeParts.length > 0 ? (
                  <>
                    <div className="watchface-metric-heading">
                      <strong>Time components</strong>
                      <span>Independent sprite size and color</span>
                    </div>
                    <div className="watchface-metric-grid">
                      {customizableTimeParts.map((part) => {
                        const style = timeStyles[part.id] ?? {
                          color: digitColor,
                          scale: 1
                        };
                        return (
                          <div
                            className={`watchface-metric-card ${timeStyles[part.id] ? "active" : ""}`}
                            key={part.id}
                          >
                            <div className="watchface-time-style-heading">
                              <strong>{part.label}</strong>
                              <span>{Math.round(style.scale * 100)}%</span>
                            </div>
                            <div className="watchface-metric-style">
                              <label>
                                Color
                                <input
                                  type="color"
                                  value={style.color}
                                  disabled={disabled || creating}
                                  onChange={(event) =>
                                    setTimeStyles((current) => ({
                                      ...current,
                                      [part.id]: {
                                        ...style,
                                        color: event.target.value
                                      }
                                    }))
                                  }
                                />
                              </label>
                              <label className="watchface-metric-size">
                                <span>Size</span>
                                <input
                                  type="range"
                                  min="0.5"
                                  max="2"
                                  step="0.05"
                                  value={style.scale}
                                  disabled={disabled || creating}
                                  onChange={(event) =>
                                    setTimeStyles((current) => ({
                                      ...current,
                                      [part.id]: {
                                        ...style,
                                        scale: Number(event.target.value)
                                      }
                                    }))
                                  }
                                />
                                <output>{Math.round(style.scale * 100)}%</output>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                <label className="watchface-studio-toggle">
                  <input
                    type="checkbox"
                    checked={tintLabels}
                    disabled={disabled || creating}
                    onChange={(event) => setTintLabels(event.target.checked)}
                  />
                  Recolor weekday &amp; label sprites with the digit color
                </label>
                <label className="watchface-studio-toggle">
                  <input
                    type="checkbox"
                    checked={tintIcons}
                    disabled={disabled || creating}
                    onChange={(event) => setTintIcons(event.target.checked)}
                  />
                  Tint metric icons with the accent color
                </label>
                {summary && studioActive ? (
                  <p className="watchface-studio-summary">
                    Will regenerate {summary.digits} digit{summary.digits === 1 ? "" : "s"}, {summary.labels} label{summary.labels === 1 ? "" : "s"},
                    and {summary.icons} icon{summary.icons === 1 ? "" : "s"} across all resolutions
                    (always-on display included, auto-dimmed).
                  </p>
                ) : null}
              </>
            ) : (
              <p className="watchface-studio-summary">
                Reading the template's sprite inventory…
              </p>
            )}
          </div>

          {details && previewResolution ? (
            <div className="watchface-studio-controls">
              <p className="watchface-studio-heading">
                <Move size={15} aria-hidden="true" /> Static separators
                <span className="watchface-studio-flag">experimental</span>
              </p>
              <p className="watchface-studio-summary">
                Enable a separator, then drag its outline on the preview or
                enter exact X/Y coordinates. Static separators are baked into
                the background and do not blink. If the template uses a
                combined cut.png, enable both to replace it without duplicates.
              </p>
              <div className="watchface-separator-grid">
                {([
                  ["colon", "Time colon", ":"],
                  ["dateSlash", "Date slash", "/"]
                ] as const).map(([separatorId, label, text]) => {
                  const separator = staticSeparators[separatorId];
                  const update = (
                    values: Partial<typeof separator>
                  ) =>
                    setStaticSeparators((current) => ({
                      ...current,
                      [separatorId]: {
                        ...current[separatorId],
                        ...values
                      }
                    }));
                  return (
                    <div
                      className={`watchface-separator-card ${separator.enabled ? "active" : ""}`}
                      key={separatorId}
                    >
                      <label className="watchface-separator-toggle">
                        <input
                          type="checkbox"
                          checked={separator.enabled}
                          disabled={disabled || creating}
                          onChange={(event) =>
                            update({ enabled: event.target.checked })
                          }
                        />
                        <strong>{label}</strong>
                        <span>{text}</span>
                      </label>
                      {separator.enabled ? (
                        <div className="watchface-separator-controls">
                          <label>
                            X
                            <input
                              type="number"
                              min={0}
                              max={previewResolution.width}
                              value={separator.x}
                              disabled={disabled || creating}
                              onChange={(event) =>
                                update({
                                  x: Math.max(
                                    0,
                                    Math.min(
                                      previewResolution.width,
                                      Number(event.target.value) || 0
                                    )
                                  )
                                })
                              }
                            />
                          </label>
                          <label>
                            Y
                            <input
                              type="number"
                              min={0}
                              max={previewResolution.height}
                              value={separator.y}
                              disabled={disabled || creating}
                              onChange={(event) =>
                                update({
                                  y: Math.max(
                                    0,
                                    Math.min(
                                      previewResolution.height,
                                      Number(event.target.value) || 0
                                    )
                                  )
                                })
                              }
                            />
                          </label>
                          <label>
                            Size
                            <input
                              type="number"
                              min={12}
                              max={200}
                              value={separator.size}
                              disabled={disabled || creating}
                              onChange={(event) =>
                                update({
                                  size: Math.max(
                                    12,
                                    Math.min(200, Number(event.target.value) || 12)
                                  )
                                })
                              }
                            />
                          </label>
                          <label className="watchface-separator-color">
                            Color
                            <input
                              type="color"
                              value={separator.color}
                              disabled={disabled || creating}
                              onChange={(event) =>
                                update({ color: event.target.value })
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {details &&
          (fixedMetricCapabilities.length > 0 || availableComplications.length > 0) ? (
            <div className="watchface-studio-controls">
              <p className="watchface-studio-heading">
                <Activity size={15} aria-hidden="true" /> Live data
                <span className="watchface-studio-flag">experimental</span>
              </p>
              {fixedMetricCapabilities.length > 0 ? (
                <>
                  <div className="watchface-metric-heading">
                    <strong>Always visible</strong>
                    <span>Enable, then drag into place</span>
                  </div>
                  <div className="watchface-metric-grid">
                    {fixedMetricCapabilities.map((metric) => {
                      const Icon = METRIC_ICONS[metric.id];
                      const checked = metricChanges[metric.id] ?? metric.active;
                      const style = metricStyles[metric.id] ?? {
                        color: digitColor,
                        scale: 1
                      };
                      return (
                        <div
                          className={`watchface-metric-card ${checked ? "active" : ""}`}
                          key={metric.id}
                        >
                          <label className="watchface-metric-toggle">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled || creating}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                setMetricChanges((current) => ({
                                  ...current,
                                  [metric.id]: enabled
                                }));
                                if (!enabled) {
                                  setLayoutOffsets((current) => {
                                    const next = { ...current };
                                    delete next[metric.id];
                                    return next;
                                  });
                                }
                              }}
                            />
                            <Icon size={17} aria-hidden="true" />
                            <span>{metric.label}</span>
                          </label>
                          {checked ? (
                            <div className="watchface-metric-style">
                              <label>
                                Color
                                <input
                                  type="color"
                                  value={style.color}
                                  disabled={disabled || creating}
                                  onChange={(event) =>
                                    setMetricStyles((current) => ({
                                      ...current,
                                      [metric.id]: {
                                        ...style,
                                        color: event.target.value
                                      }
                                    }))
                                  }
                                />
                              </label>
                              <label className="watchface-metric-size">
                                <span>Size</span>
                                <input
                                  type="range"
                                  min="0.5"
                                  max="2"
                                  step="0.05"
                                  value={style.scale}
                                  disabled={disabled || creating}
                                  onChange={(event) =>
                                    setMetricStyles((current) => ({
                                      ...current,
                                      [metric.id]: {
                                        ...style,
                                        scale: Number(event.target.value)
                                      }
                                    }))
                                  }
                                />
                                <output>{Math.round(style.scale * 100)}%</output>
                              </label>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="watchface-studio-summary">
                  This template has a selectable metric slot, but no fixed metric
                  fields. Choose a SLENDER template for always-visible data.
                </p>
              )}
              {availableComplications.length > 0 ? (
                <label className="field">
                  Selectable slot preview
                  <select
                    value={previewComplication}
                    disabled={disabled || creating}
                    onChange={(event) =>
                      setPreviewComplication(event.target.value as WatchfaceComplicationId)
                    }
                  >
                    {availableComplications.map((metric) => (
                      <option key={metric.id} value={metric.id}>{metric.label}</option>
                    ))}
                  </select>
                  <small>
                    Preview only. The complication stays selectable on the watch.
                  </small>
                </label>
              ) : null}
              <p className="watchface-studio-summary">
                Live values are generated by COROS firmware. Sample values in the
                preview are used only for layout.
              </p>
            </div>
          ) : null}

          {details && movableGroups.length > 0 ? (
            <div className="watchface-studio-controls">
              <p className="watchface-studio-heading">
                <Move size={15} aria-hidden="true" /> Move elements
                <span className="watchface-studio-flag">experimental</span>
              </p>
              <p className="watchface-studio-summary">
                Drag hours, minutes, weekday, month, and day independently.
                Templates with cut.png also expose “Time &amp; date separators”
                as one movable pair. Use fine-tune for exact pixel offsets.
              </p>
              <details className="watchface-layout-finetune">
                <summary>Fine-tune offsets</summary>
                <div className="watchface-layout-grid">
                {movableGroups.map((group) => {
                  const offset = layoutOffsets[group.id] ?? { dx: 0, dy: 0 };
                  const limits = layoutLimits[group.id] ?? {
                    minDx: -(previewResolution?.width ?? 800),
                    maxDx: previewResolution?.width ?? 800,
                    minDy: -(previewResolution?.height ?? 800),
                    maxDy: previewResolution?.height ?? 800
                  };
                  const setAxis = (axis: "dx" | "dy", raw: string) => {
                    const minimum = axis === "dx" ? limits.minDx : limits.minDy;
                    const maximum = axis === "dx" ? limits.maxDx : limits.maxDy;
                    const parsed = Math.max(
                      minimum,
                      Math.min(maximum, Number(raw) || 0)
                    );
                    setLayoutOffsets((current) => ({
                      ...current,
                      [group.id]: { ...offset, [axis]: parsed }
                    }));
                  };
                  return (
                    <div className="watchface-layout-row" key={group.id}>
                      <span>{group.label}</span>
                      <label>
                        X
                        <input
                          type="number"
                          min={limits.minDx}
                          max={limits.maxDx}
                          step={5}
                          value={offset.dx}
                          disabled={disabled || creating}
                          onChange={(event) => setAxis("dx", event.target.value)}
                        />
                      </label>
                      <label>
                        Y
                        <input
                          type="number"
                          min={limits.minDy}
                          max={limits.maxDy}
                          step={5}
                          value={offset.dy}
                          disabled={disabled || creating}
                          onChange={(event) => setAxis("dy", event.target.value)}
                        />
                      </label>
                    </div>
                  );
                })}
                </div>
              </details>
              {layoutActive ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={disabled || creating}
                  onClick={() => setLayoutOffsets({})}
                >
                  Reset positions
                </button>
              ) : null}
              <p className="watchface-studio-summary">
                Moves scale to smaller resolutions automatically; the
                always-on-display layout is left unchanged. This edits the
                template's config.txt. Verify the published face on the watch.
              </p>
            </div>
          ) : null}

          <div className="watchface-project-save">
            <label className="field">
              Project name
              <input
                value={projectName}
                maxLength={80}
                disabled={disabled || creating || savingProject}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="My watchface design"
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={disabled || creating || savingProject}
              onClick={() => void saveProject()}
            >
              {savingProject ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              {projectId ? "Save changes" : "Save project"}
            </button>
          </div>
          <p className="watchface-studio-summary">
            Saved projects keep the starter template and every editable design
            layer so you can close CorosLink and continue later.
          </p>

          <button
            className="primary-button watchface-create-button"
            type="button"
            disabled={
              disabled ||
              loadingArtwork ||
              loadingSprite ||
              creating ||
              !backgroundDataUrl
            }
            onClick={() => void createArchive()}
          >
            {creating ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />}
            Create upload archive
          </button>
          <p className="watchface-creator-note">
            <Sparkles size={15} aria-hidden="true" /> This creates a new local
            archive from template {starterArchive.sourceTemplateId}; it does not
            publish anything yet.
          </p>
        </div>

        <div className="watchface-creator-preview-shell">
          {details ? (
            <>
              <div className="watchface-preview-stack">
                <canvas
                  ref={previewCanvasRef}
                  className="watchface-studio-preview"
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  aria-label="Live watchface preview with the template's real sprites"
                />
                <canvas
                  ref={overlayCanvasRef}
                  className="watchface-preview-overlay"
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  style={{
                    cursor: draggingGroup ? "grabbing" : hoveredGroup ? "grab" : "default"
                  }}
                  onPointerDown={handlePreviewPointerDown}
                  onPointerMove={handlePreviewPointerMove}
                  onPointerUp={handlePreviewPointerEnd}
                  onPointerCancel={handlePreviewPointerEnd}
                  onPointerLeave={(event) => {
                    handlePreviewPointerEnd(event);
                    setHoveredGroup(null);
                  }}
                  aria-label="Drag the outlined face elements to reposition them"
                />
              </div>
              <p>
                Live preview using the template's own layout. Drag an outlined
                element (hours, minutes, weekday, date, battery, metrics) to
                move it on the face.
              </p>
            </>
          ) : (
            <>
              <div className="watchface-creator-preview" style={previewStyle}>
                <span className="watchface-preview-day">THU&nbsp;&nbsp;10</span>
                <strong className="watchface-preview-time">10:09</strong>
                <span className="watchface-preview-metric">8,420 STEPS</span>
                <span className="watchface-preview-safe-zone" aria-hidden="true" />
              </div>
              <p>Preview only. Dynamic fields remain live on the watch.</p>
            </>
          )}
        </div>
      </div>
      <canvas ref={canvasRef} className="watchface-creator-canvas" aria-hidden="true" />
    </section>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Watchface creator failed.";
}
