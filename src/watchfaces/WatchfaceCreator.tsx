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
  Sparkles,
  Trash2,
  Type,
  WandSparkles
} from "lucide-react";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceArtwork,
  CorosWatchfaceTemplateAsset,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  applyConfigOverridesToDetails,
  applyLayoutToDetails,
  buildLayoutOverrides,
  buildMetricOverrides,
  buildStudioReplacements,
  computeLayoutGroupBounds,
  computeLayoutOffsetLimits,
  drawStudioPreview,
  getAvailableComplications,
  getFixedMetricCapabilities,
  layoutGroupAtPoint,
  layoutGroupKeys,
  mergeConfigOverrides,
  pickPreviewResolution,
  summarizeStudioReplacements,
  WATCHFACE_LAYOUT_GROUPS,
  type WatchfaceLayoutGroupBounds,
  type WatchfaceLayoutOffset,
  type WatchfaceMetricChanges,
  type WatchfaceMetricId,
  type WatchfaceComplicationId,
  type WatchfaceStudioOptions
} from "./watchfaceStudio";

interface WatchfaceCreatorProps {
  api: CorosLinkApi;
  starterArchive: CorosWatchfaceArchive;
  disabled?: boolean;
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

export function WatchfaceCreator({
  api,
  starterArchive,
  disabled = false,
  onCreated,
  onError,
  onNotice
}: WatchfaceCreatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const assetCacheRef = useRef(new Map<string, CorosWatchfaceTemplateAsset>());
  const [artwork, setArtwork] = useState<CorosWatchfaceArtwork | null>(null);
  const [backgroundColor, setBackgroundColor] = useState("#081116");
  const [accentColor, setAccentColor] = useState("#51e0b5");
  const [zoom, setZoom] = useState(1);
  const [backgroundDataUrl, setBackgroundDataUrl] = useState("");
  const [loadingArtwork, setLoadingArtwork] = useState(false);
  const [creating, setCreating] = useState(false);
  const [details, setDetails] = useState<CorosWatchfaceTemplateDetails | null>(null);
  const [fontFamily, setFontFamily] = useState("");
  const [digitColor, setDigitColor] = useState("#ffffff");
  const [tintLabels, setTintLabels] = useState(false);
  const [tintIcons, setTintIcons] = useState(false);
  const [metricChanges, setMetricChanges] = useState<WatchfaceMetricChanges>({});
  const [previewComplication, setPreviewComplication] =
    useState<WatchfaceComplicationId>("heartRate");
  const [layoutOffsets, setLayoutOffsets] = useState<
    Record<string, WatchfaceLayoutOffset>
  >({});
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    groupId: string;
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
    previewComplication
  };
  const studioActive = Boolean(fontFamily) || tintLabels || tintIcons;
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
  const previewDetails = useMemo(
    () => (metricDetails ? applyLayoutToDetails(metricDetails, layoutOffsets) : null),
    [metricDetails, layoutOffsets]
  );
  const movableGroups = useMemo(() => {
    const base = metricDetails ? pickPreviewResolution(metricDetails) : null;
    if (!base) {
      return [];
    }
    return WATCHFACE_LAYOUT_GROUPS.filter(
      (group) => layoutGroupKeys(base, group).length > 0
    );
  }, [metricDetails]);
  const previewResolution = useMemo(
    () => (previewDetails ? pickPreviewResolution(previewDetails) : null),
    [previewDetails]
  );
  const layoutLimits = useMemo(() => {
    const base = metricDetails ? pickPreviewResolution(metricDetails) : null;
    return base ? computeLayoutOffsetLimits(base) : {};
  }, [metricDetails]);
  const groupBounds = useMemo<WatchfaceLayoutGroupBounds[]>(() => {
    if (!previewResolution) {
      return [];
    }
    const movable = new Set(movableGroups.map((group) => group.id));
    return computeLayoutGroupBounds(previewResolution).filter((box) =>
      movable.has(box.id)
    );
  }, [previewResolution, movableGroups]);

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
    const offset = layoutOffsets[hit.id] ?? { dx: 0, dy: 0 };
    dragRef.current = {
      groupId: hit.id,
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
    assetCacheRef.current.clear();
    setDetails(null);
    setLayoutOffsets({});
    setMetricChanges({});
    let cancelled = false;
    api
      .describeCorosWatchfaceTemplate(starterArchive.archiveId)
      .then((described) => {
        if (!cancelled) {
          setDetails(described);
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
  }, [api, onNotice, starterArchive.archiveId]);

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
    const paint = (image?: HTMLImageElement) => {
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

      // Keep the dynamic time/date/control area clear: COROS draws those from
      // the retained config.txt and number-sprite files on the actual watch.
      context.strokeStyle = "rgba(255, 255, 255, 0.14)";
      context.lineWidth = 1;
      context.setLineDash([8, 12]);
      context.strokeRect(492, 96, 244, 590);
      context.setLineDash([]);
      setBackgroundDataUrl(canvas.toDataURL("image/png"));
    };

    if (!artwork) {
      paint();
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => paint(image);
    image.onerror = () => paint();
    image.src = artwork.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [artwork, backgroundColor, zoom]);

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
          previewComplication
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
          : undefined;
      const layoutOverrides =
        metricDetails && layoutActive
          ? buildLayoutOverrides(metricDetails, layoutOffsets)
          : [];
      const configOverrides = mergeConfigOverrides(
        metricOverrides,
        layoutOverrides
      );
      const archive = await api.createCorosWatchfaceArchive({
        sourceArchiveId: starterArchive.archiveId,
        backgroundDataUrl,
        ...(assetReplacements && assetReplacements.length > 0
          ? { assetReplacements }
          : {}),
        ...(configOverrides.length > 0 ? { configOverrides } : {})
      });
      onCreated(archive);
      const styledParts = [
        ...(assetReplacements && assetReplacements.length > 0
          ? [`${assetReplacements.length} restyled sprites`]
          : []),
        ...(layoutOverrides.length > 0 ? ["a moved layout"] : []),
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
                      return (
                        <label
                          className={`watchface-metric-toggle ${checked ? "active" : ""}`}
                          key={metric.id}
                        >
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
                Drag an element directly on the preview to move it. Use
                fine-tune for exact pixel offsets.
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

          <button
            className="primary-button watchface-create-button"
            type="button"
            disabled={disabled || loadingArtwork || creating || !backgroundDataUrl}
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
                element (time, date, battery, metrics) to move it on the face.
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
