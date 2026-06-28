import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarDays } from "lucide-react";
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
import type { HeatmapCell, TrainingHubSnapshot } from "../types";

interface TrainingHeatmapPanelProps {
  snapshot: TrainingHubSnapshot | null;
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

export function TrainingHeatmapPanel({ snapshot }: TrainingHeatmapPanelProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [isReady, setIsReady] = useState(false);

  const dayList = useMemo(
    () =>
      mergeTrainingDayLists(
        snapshot?.dailyMetrics ?? null,
        snapshot?.analytics ?? null
      ),
    [snapshot]
  );
  const cells = useMemo(
    () => buildHeatmapCells(dayList, TRAINING_HEATMAP_DAYS),
    [dayList]
  );
  const grid = useMemo(() => buildHeatmapGrid(cells), [cells]);
  const summary = useMemo(() => buildHeatmapSummary(cells), [cells]);
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
                      style={
                        reducedMotion
                          ? undefined
                          : { animationDelay: `${staggerDelay}ms` }
                      }
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
