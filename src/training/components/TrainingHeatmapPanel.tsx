import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarDays } from "lucide-react";
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
  SPORT_COLOR_CATEGORIES,
  SPORT_COLOR_LABELS
} from "../sportColors";
import type { HeatmapCell, TrainingHubSnapshot } from "../types";

interface TrainingHeatmapPanelProps {
  snapshot: TrainingHubSnapshot | null;
  activities?: TrainingHubActivity[];
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const LEGEND_LEVELS = [0, 1, 2, 3, 4] as const;

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

function formatCellAriaLabel(cell: HeatmapCell): string {
  const load = formatOptionalNumber(cell.trainingLoad);
  const distance = formatDistanceMeters(cell.distance);
  const duration = formatDurationSeconds(cell.duration);

  return `${cell.label}: training load ${load}, distance ${distance}, duration ${duration}`;
}

export function TrainingHeatmapPanel({
  snapshot,
  activities = []
}: TrainingHeatmapPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [isReady, setIsReady] = useState(false);

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
    () => buildHeatmapCells(dayList, TRAINING_HEATMAP_DAYS),
    [dayList]
  );
  const grid = useMemo(() => buildHeatmapGrid(cells), [cells]);
  const summary = useMemo(() => buildHeatmapSummary(cells), [cells]);
  // Color each day by the sport of that day's highest-training-load activity.
  const sportByDay = useMemo(
    () => buildDominantSportByDay(activities),
    [activities]
  );
  // Only show sports that actually appear in the visible range, in canonical order.
  const presentSports = useMemo(() => {
    const seen = new Set(sportByDay.values());
    return SPORT_COLOR_CATEGORIES.filter((cat) => seen.has(cat));
  }, [sportByDay]);
  const hasData = cells.some((cell) => cell.level > 0);

  useEffect(() => {
    if (reducedMotion) {
      setIsReady(true);
      return;
    }

    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [cells.length, reducedMotion]);

  return (
    <section className="panel training-heatmap-panel">
      <div className="training-heatmap-header">
        <div>
          <p className="eyebrow">Training Activity</p>
          <h2>Load heatmap</h2>
        </div>
        <span className="training-range-pill">Last {TRAINING_HEATMAP_DAYS} days</span>
      </div>

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
                className={`training-heatmap-grid${isReady ? " is-ready" : ""}`}
                role="grid"
                aria-label={`Training load over the last ${TRAINING_HEATMAP_DAYS} days`}
              >
                {grid.cells.map((cell, index) => {
                  const row = index % 7;
                  const column = Math.floor(index / 7);
                  const staggerDelay = Math.min(column * 16 + row * 5, 900);

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

                  const loadLabel = formatOptionalNumber(cell.trainingLoad);
                  const distanceLabel = formatDistanceMeters(cell.distance);
                  const durationLabel = formatDurationSeconds(cell.duration);
                  const sportCategory =
                    cell.level > 0 ? sportByDay.get(cell.happenDay) : undefined;
                  const cellStyle: Record<string, string> = {};
                  if (!reducedMotion) {
                    cellStyle.animationDelay = `${staggerDelay}ms`;
                  }
                  if (sportCategory) {
                    cellStyle["--cell-color"] = `var(--sport-${sportCategory})`;
                  }

                  return (
                    <span
                      key={cell.happenDay}
                      className={`training-heatmap-cell${
                        cell.level === 4 ? " is-peak" : ""
                      }`}
                      data-level={cell.level}
                      role="gridcell"
                      tabIndex={0}
                      aria-label={formatCellAriaLabel(cell)}
                      style={cellStyle as CSSProperties}
                    >
                      <span className="training-heatmap-tooltip" role="tooltip">
                        <strong>{cell.label}</strong>
                        <span>Load: {loadLabel}</span>
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
              <span>{summary.activeDays} active days</span>
              <span aria-hidden="true">·</span>
              <span>{summary.currentStreak}-day streak</span>
              <span aria-hidden="true">·</span>
              <span>{formatOptionalNumber(summary.totalLoad)} total load</span>
            </div>
          </div>
        </>
      ) : (
        <div className="training-heatmap-empty">
          <CalendarDays size={22} aria-hidden="true" />
          <p>No training data in the last {TRAINING_HEATMAP_DAYS} days.</p>
        </div>
      )}
    </section>
  );
}
