import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import type { TrainingHubActivity } from "../../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatOptionalNumber
} from "../formatters";
import { TRAINING_HEATMAP_DAYS } from "../chartConfig";
import {
  buildHeatmapCells,
  buildHeatmapGrid,
  buildHeatmapSummary,
  mergeTrainingDayLists
} from "../parsers";
import {
  enrichDayListWithActivityTotals
} from "../weeklyActivity";
import {
  buildDominantSportByDay,
  buildSportCategoriesByDay,
  SPORT_COLOR_CATEGORIES,
  SPORT_COLOR_LABELS,
  type SportColorCategory
} from "../sportColors";
import type {
  HeatmapCell,
  HeatmapMetric,
  TrainingHubSnapshot
} from "../types";

interface TrainingHeatmapPanelProps {
  snapshot: TrainingHubSnapshot | null;
  activities?: TrainingHubActivity[];
  rpeBackfill?: { pending: number; running: boolean } | null;
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const LEGEND_LEVELS = [0, 1, 2, 3, 4] as const;
const HEATMAP_PROXIMITY_RADIUS = 120;
const HEATMAP_WAVE_SETTLE_MS = 220;
const HEATMAP_WAVE_COLUMN_MS = 16;
const HEATMAP_WAVE_ROW_MS = 5;
const HEATMAP_WAVE_CELL_DURATION_MS = 600;

interface ProximityCell {
  element: HTMLSpanElement;
  centerX: number;
  centerY: number;
}

function resetProximityCells(cells: Set<HTMLSpanElement>) {
  for (const cell of cells) {
    cell.style.removeProperty("--heatmap-brightness");
    cell.style.removeProperty("--heatmap-glow-opacity");
  }
  cells.clear();
}

// Opacity per intensity level, mirroring the single-sport CSS levels so a
// multi-sport pie reads at the same darkness as a solid cell of the same load.
const LEVEL_ALPHA: Record<number, number> = { 1: 28, 2: 48, 3: 72, 4: 100 };

function sliceColor(cat: SportColorCategory, level: number): string {
  const pct = LEVEL_ALPHA[level] ?? 100;
  return `color-mix(in srgb, var(--sport-${cat}) ${pct}%, transparent)`;
}

// Split a day's cell into equal pie slices, one per distinct sport category.
function pieBackground(
  categories: SportColorCategory[],
  level: number
): string {
  const n = categories.length;
  const stops = categories.map((cat, index) => {
    const from = ((index / n) * 360).toFixed(3);
    const to = (((index + 1) / n) * 360).toFixed(3);
    return `${sliceColor(cat, level)} ${from}deg ${to}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);

    update();
    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function formatCellAriaLabel(cell: HeatmapCell, metric: HeatmapMetric): string {
  const distance = formatDistanceMeters(cell.distance);
  const duration = formatDurationSeconds(cell.duration);
  const metricLabel =
    metric === "rpeLoad"
      ? `RPE load ${formatOptionalNumber(cell.rpeLoad)} AU`
      : `training load ${formatOptionalNumber(cell.trainingLoad)}`;

  return `${cell.label}: ${metricLabel}, distance ${distance}, duration ${duration}`;
}

export function TrainingHeatmapPanel({
  snapshot,
  activities = [],
  rpeBackfill = null
}: TrainingHeatmapPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [metric, setMetric] = useState<HeatmapMetric>("trainingLoad");
  const gridRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pointerClientRef = useRef({ x: 0, y: 0 });
  const proximityCellsRef = useRef<ProximityCell[]>([]);
  const activeProximityCellsRef = useRef<Set<HTMLSpanElement>>(new Set());
  const heatmapWaveHasPlayedRef = useRef(false);
  const isRpe = metric === "rpeLoad";

  const dayList = useMemo(
    () =>
      enrichDayListWithActivityTotals(
        mergeTrainingDayLists(
          snapshot?.dailyMetrics ?? null,
          snapshot?.analytics ?? null
        ),
        activities
      ),
    [snapshot, activities]
  );
  const cells = useMemo(
    () => buildHeatmapCells(dayList, TRAINING_HEATMAP_DAYS, metric),
    [dayList, metric]
  );
  // RPE feelTypes may still be backfilling from the COROS detail endpoint.
  const rpeBackfillActive =
    rpeBackfill !== null && (rpeBackfill.pending > 0 || rpeBackfill.running);
  const grid = useMemo(() => buildHeatmapGrid(cells), [cells]);
  const summary = useMemo(() => buildHeatmapSummary(cells), [cells]);
  // Color each day by the sport of that day's highest-training-load activity.
  const sportByDay = useMemo(
    () => buildDominantSportByDay(activities),
    [activities]
  );
  // Distinct sport categories per day → equal pie slices when there are 2+.
  const sportsByDay = useMemo(
    () => buildSportCategoriesByDay(activities),
    [activities]
  );
  // Only show sports that actually appear in the visible range, in canonical
  // order — including those that only ever show up as a pie slice.
  const presentSports = useMemo(() => {
    const seen = new Set<SportColorCategory>();
    for (const set of sportsByDay.values()) {
      for (const cat of set) {
        seen.add(cat);
      }
    }
    return SPORT_COLOR_CATEGORIES.filter((cat) => seen.has(cat));
  }, [sportsByDay]);
  const hasData = cells.some((cell) => cell.level > 0);

  useLayoutEffect(() => {
    const gridElement = gridRef.current;
    if (!hasData || !gridElement) {
      return;
    }

    if (reducedMotion) {
      heatmapWaveHasPlayedRef.current = true;
      gridElement.classList.remove("is-wave-loading");
      return;
    }

    if (heatmapWaveHasPlayedRef.current) {
      return;
    }

    const cellElements = Array.from(
      gridElement.querySelectorAll<HTMLSpanElement>(".training-heatmap-cell")
    )
      .map((element, index) => ({
        element,
        delay:
          HEATMAP_WAVE_SETTLE_MS +
          Math.floor(index / 7) * HEATMAP_WAVE_COLUMN_MS +
          (index % 7) * HEATMAP_WAVE_ROW_MS
      }))
      .filter(({ element }) => !element.classList.contains("is-empty"))
      .sort((left, right) => left.delay - right.delay);

    if (cellElements.length === 0) {
      heatmapWaveHasPlayedRef.current = true;
      return;
    }

    gridElement.classList.add("is-wave-loading");

    const bounds = gridElement.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.className = "training-heatmap-wave-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
    gridElement.append(canvas);

    const context = canvas.getContext("2d");
    if (!context) {
      canvas.remove();
      gridElement.classList.remove("is-wave-loading");
      heatmapWaveHasPlayedRef.current = true;
      return;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const waveCells = cellElements.map(({ element, delay }) => {
      const computedStyle = window.getComputedStyle(element);
      const level = Number(element.dataset.level ?? 0);
      const baseColor =
        computedStyle.getPropertyValue("--cell-color").trim() || "#2d9a74";
      const backgroundColor = computedStyle.backgroundColor;
      const sportColors = (element.dataset.waveSports ?? "")
        .split(",")
        .filter(Boolean)
        .map((sport) =>
          computedStyle.getPropertyValue(`--sport-${sport}`).trim()
        )
        .filter(Boolean);
      const hasImage = computedStyle.backgroundImage !== "none";

      return {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
        radius: Math.min(element.offsetWidth, element.offsetHeight) * 0.24,
        delay,
        fill: hasImage ? baseColor : backgroundColor,
        fillAlpha: hasImage ? (LEVEL_ALPHA[level] ?? 100) / 100 : 1,
        sportColors,
        level
      };
    });

    let frame: number | null = null;
    const startedAt = performance.now();
    const finalDelay = waveCells.at(-1)?.delay ?? 0;

    const drawRoundedCell = (
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number
    ) => {
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
    };

    const advanceWave = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, bounds.width, bounds.height);

      if (elapsed >= HEATMAP_WAVE_SETTLE_MS) {
        heatmapWaveHasPlayedRef.current = true;
      }

      for (const cell of waveCells) {
        const progress = Math.max(
          0,
          Math.min(1, (elapsed - cell.delay) / HEATMAP_WAVE_CELL_DURATION_MS)
        );
        if (progress <= 0) {
          continue;
        }

        let scale: number;
        if (progress < 0.7) {
          const localProgress = progress / 0.7;
          const shifted = localProgress - 1;
          const eased = 1 + 2.70158 * shifted ** 3 + 1.70158 * shifted ** 2;
          scale = 0.35 + (1.06 - 0.35) * eased;
        } else {
          const localProgress = (progress - 0.7) / 0.3;
          const eased = 1 - (1 - localProgress) ** 3;
          scale = 1.06 + (1 - 1.06) * eased;
        }

        const opacity = Math.min(1, progress / 0.7);
        const width = cell.width * scale;
        const height = cell.height * scale;
        const x = cell.x + (cell.width - width) / 2;
        const y = cell.y + (cell.height - height) / 2;
        const radius = cell.radius * scale;

        context.save();
        context.globalAlpha = opacity * cell.fillAlpha;
        drawRoundedCell(x, y, width, height, radius);

        if (cell.sportColors.length >= 2) {
          context.clip();
          const centerX = x + width / 2;
          const centerY = y + height / 2;
          const sweepRadius = Math.hypot(width, height);
          cell.sportColors.forEach((color, index) => {
            const startAngle = -Math.PI / 2 +
              (index / cell.sportColors.length) * Math.PI * 2;
            const endAngle = -Math.PI / 2 +
              ((index + 1) / cell.sportColors.length) * Math.PI * 2;
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.arc(centerX, centerY, sweepRadius, startAngle, endAngle);
            context.closePath();
            context.fillStyle = color;
            context.fill();
          });
        } else {
          context.fillStyle = cell.fill;
          context.fill();
        }
        context.restore();
      }

      if (elapsed < finalDelay + HEATMAP_WAVE_CELL_DURATION_MS) {
        frame = requestAnimationFrame(advanceWave);
      } else {
        frame = null;
        canvas.remove();
        gridElement.classList.remove("is-wave-loading");
      }
    };

    frame = requestAnimationFrame(advanceWave);

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      canvas.remove();
      gridElement.classList.remove("is-wave-loading");
    };
  }, [hasData, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      resetProximityCells(activeProximityCellsRef.current);
    }

    return () => {
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
      }
      resetProximityCells(activeProximityCellsRef.current);
    };
  }, [reducedMotion]);

  const handleGridPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (reducedMotion) {
      return;
    }

    pointerClientRef.current = { x: event.clientX, y: event.clientY };
    if (pointerFrameRef.current !== null) {
      return;
    }

    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const gridElement = gridRef.current;
      if (!gridElement) {
        return;
      }

      const bounds = gridElement.getBoundingClientRect();
      const pointerX = pointerClientRef.current.x - bounds.left;
      const pointerY = pointerClientRef.current.y - bounds.top;
      const nextActiveCells = new Set<HTMLSpanElement>();

      for (const cell of proximityCellsRef.current) {
        const distance = Math.hypot(
          pointerX - cell.centerX,
          pointerY - cell.centerY
        );
        if (distance >= HEATMAP_PROXIMITY_RADIUS) {
          continue;
        }

        const linearStrength = 1 - distance / HEATMAP_PROXIMITY_RADIUS;
        const strength =
          linearStrength * linearStrength * (3 - 2 * linearStrength);
        cell.element.style.setProperty(
          "--heatmap-brightness",
          (1 + strength * 0.2).toFixed(3)
        );
        cell.element.style.setProperty(
          "--heatmap-glow-opacity",
          (strength * 0.68).toFixed(3)
        );
        nextActiveCells.add(cell.element);
      }

      for (const cell of activeProximityCellsRef.current) {
        if (!nextActiveCells.has(cell)) {
          cell.style.removeProperty("--heatmap-brightness");
          cell.style.removeProperty("--heatmap-glow-opacity");
        }
      }
      activeProximityCellsRef.current = nextActiveCells;
    });
  };

  const handleGridPointerEnter = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (reducedMotion) {
      return;
    }

    proximityCellsRef.current = Array.from(
      event.currentTarget.querySelectorAll<HTMLSpanElement>(
        ".training-heatmap-cell:not(.is-empty)"
      )
    ).map((element) => ({
      element,
      centerX: element.offsetLeft + element.offsetWidth / 2,
      centerY: element.offsetTop + element.offsetHeight / 2
    }));
    handleGridPointerMove(event);
  };

  const handleGridPointerLeave = () => {
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    proximityCellsRef.current = [];
    resetProximityCells(activeProximityCellsRef.current);
  };

  return (
    <section className="panel training-heatmap-panel">
      <div className="training-heatmap-header">
        <div>
          <p className="eyebrow">Training Activity</p>
          <h2>{isRpe ? "RPE load heatmap" : "Load heatmap"}</h2>
        </div>
        <div className="training-heatmap-controls">
          <div
            className="training-metric-toggle"
            role="group"
            aria-label="Heatmap metric"
          >
            <button
              type="button"
              className={`training-metric-option${!isRpe ? " is-active" : ""}`}
              aria-pressed={!isRpe}
              onClick={() => setMetric("trainingLoad")}
            >
              Training Load
            </button>
            <button
              type="button"
              className={`training-metric-option${isRpe ? " is-active" : ""}`}
              aria-pressed={isRpe}
              onClick={() => setMetric("rpeLoad")}
            >
              RPE
            </button>
          </div>
          <span className="training-range-pill">
            Last {TRAINING_HEATMAP_DAYS} days
          </span>
        </div>
      </div>

      {isRpe && rpeBackfill && rpeBackfillActive ? (
        <div className="training-heatmap-loading" role="status">
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>
            Loading RPE data… {rpeBackfill.pending} to go
          </span>
        </div>
      ) : null}

      {hasData ? (
        <>
          <div className="training-heatmap-scroll">
            <div
              className="training-heatmap-layout"
              style={
                {
                  "--heatmap-weeks": grid.weeks
                } as CSSProperties
              }
            >
              <div className="training-heatmap-months" aria-hidden="true">
                {grid.monthLabels.map((month) => (
                  <span
                    key={`${month.column}-${month.label}`}
                    className="training-heatmap-month"
                    style={{ gridColumn: month.column + 1 }}
                  >
                    {month.label}
                  </span>
                ))}
              </div>

              <div className="training-heatmap-weekdays" aria-hidden="true">
                {WEEKDAY_LABELS.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="training-heatmap-weekday"
                  >
                    {label}
                  </span>
                ))}
              </div>

              <div
                ref={gridRef}
                className="training-heatmap-grid"
                role="grid"
                onPointerEnter={handleGridPointerEnter}
                onPointerMove={handleGridPointerMove}
                onPointerLeave={handleGridPointerLeave}
                aria-label={`${
                  isRpe ? "RPE load" : "Training load"
                } over the last ${TRAINING_HEATMAP_DAYS} days`}
              >
                {grid.cells.map((cell, index) => {
                  if (!cell) {
                    return (
                      <span
                        key={`empty-${index}`}
                        className="training-heatmap-cell is-empty"
                        role="presentation"
                        aria-hidden="true"
                      />
                    );
                  }

                  const loadLabel = isRpe
                    ? `${formatOptionalNumber(cell.rpeLoad)} AU`
                    : formatOptionalNumber(cell.trainingLoad);
                  const distanceLabel = formatDistanceMeters(cell.distance);
                  const durationLabel = formatDurationSeconds(cell.duration);
                  const dominantSport =
                    cell.level > 0 ? sportByDay.get(cell.happenDay) : undefined;
                  const daySports =
                    cell.level > 0
                      ? [...(sportsByDay.get(cell.happenDay) ?? [])]
                      : [];
                  const cellStyle: Record<string, string> = {};
                  // Dominant sport sets the hue for glow/hover and the single-
                  // sport fill; 2+ sports split the cell into equal pie slices.
                  if (dominantSport) {
                    cellStyle["--cell-color"] = `var(--sport-${dominantSport})`;
                  }
                  if (daySports.length >= 2) {
                    cellStyle.background = pieBackground(daySports, cell.level);
                  }

                  return (
                    <span
                      key={cell.happenDay}
                      className={`training-heatmap-cell${
                        cell.level === 4 ? " is-peak" : ""
                      }`}
                      data-level={cell.level}
                      data-wave-sports={
                        daySports.length >= 2 ? daySports.join(",") : undefined
                      }
                      role="gridcell"
                      tabIndex={0}
                      aria-label={formatCellAriaLabel(cell, metric)}
                      style={cellStyle as CSSProperties}
                    >
                      <span className="training-heatmap-tooltip" role="tooltip">
                        <strong>{cell.label}</strong>
                        <span>{isRpe ? "RPE load" : "Load"}: {loadLabel}</span>
                        <span>Distance: {distanceLabel}</span>
                        <span>Duration: {durationLabel}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="training-heatmap-footer">
            <div className="training-heatmap-legends">
              <div className="training-heatmap-legend" aria-hidden="true">
                <span className="training-heatmap-legend-label">Less</span>
                {LEGEND_LEVELS.map((level) => (
                  <span
                    key={level}
                    className="training-heatmap-legend-cell"
                    data-level={level}
                  />
                ))}
                <span className="training-heatmap-legend-label">More</span>
              </div>

              {presentSports.length > 0 ? (
                <ul className="training-heatmap-sport-legend">
                  {presentSports.map((cat) => (
                    <li key={cat} className="training-heatmap-sport-legend-item">
                      <span
                        className="training-heatmap-sport-swatch"
                        style={
                          {
                            "--cell-color": `var(--sport-${cat})`
                          } as CSSProperties
                        }
                        aria-hidden="true"
                      />
                      <span>{SPORT_COLOR_LABELS[cat]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="training-heatmap-summary">
              <span>{summary.activeDays} {isRpe ? "rated" : "active"} days</span>
              <span aria-hidden="true">·</span>
              <span>{summary.currentStreak}-day streak</span>
              <span aria-hidden="true">·</span>
              <span>
                {formatOptionalNumber(summary.totalLoad)}
                {isRpe ? " total AU" : " total load"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="training-heatmap-empty">
          <CalendarDays size={22} aria-hidden="true" />
          <p>
            {isRpe
              ? rpeBackfillActive
                ? "RPE data is still loading — rate activities in COROS to see it here."
                : `No rated sessions in the last ${TRAINING_HEATMAP_DAYS} days.`
              : `No training data in the last ${TRAINING_HEATMAP_DAYS} days.`}
          </p>
        </div>
      )}
    </section>
  );
}
