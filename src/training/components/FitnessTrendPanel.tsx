import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TrainingHubActivity } from "../../../electron/types";
import { formatHappenDayLabel } from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import type { TrainingHubSnapshot } from "../types";
import {
  buildWeeklyActivitySeries,
  buildWeeklyActivityYAxisTicks,
  enrichDayListWithActivityTotals,
  formatWeeklyActivityAxisTick,
  getWeeklyActivityMetricLabel,
  getWeeklyActivityYAxisUnitLabel,
  WEEKLY_ACTIVITY_METRICS,
  type WeeklyActivityMetric
} from "../weeklyActivity";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  defineSelectionPreference,
  selectionIsArrayOf,
  selectionIsOneOf,
  useSelectionPreference
} from "../../preferences/selectionPreferences";

const FITNESS_METRICS_PREFERENCE =
  defineSelectionPreference<WeeklyActivityMetric[]>({
    key: "training.weeklyMetrics",
    defaultValue: ["distance"],
    validate: selectionIsArrayOf(selectionIsOneOf(WEEKLY_ACTIVITY_METRICS), {
      minLength: 1,
      unique: true
    })
  });

interface FitnessTrendPanelProps {
  snapshot: TrainingHubSnapshot | null;
  activities?: TrainingHubActivity[];
}

// Short chip labels keep grouped legends compact; the dropdown uses full labels.
const METRIC_SHORT_LABELS: Record<WeeklyActivityMetric, string> = {
  distance: "Distance",
  duration: "Duration",
  trainingLoad: "Load"
};

interface MetricMultiSelectProps {
  selected: WeeklyActivityMetric[];
  onChange: (next: WeeklyActivityMetric[]) => void;
}

function MetricMultiSelect({ selected, onChange }: MetricMultiSelectProps) {
  const { unitSystem } = useUnitSystem();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function toggle(metric: WeeklyActivityMetric) {
    if (selected.includes(metric)) {
      // Keep at least one metric on the chart at all times.
      if (selected.length === 1) {
        return;
      }
      onChange(selected.filter((value) => value !== metric));
    } else {
      onChange(
        WEEKLY_ACTIVITY_METRICS.filter(
          (value) => selected.includes(value) || value === metric
        )
      );
    }
  }

  const triggerLabel =
    selected.length === WEEKLY_ACTIVITY_METRICS.length
      ? "All metrics"
      : selected.length === 1
        ? getWeeklyActivityMetricLabel(selected[0], unitSystem)
        : `${METRIC_SHORT_LABELS[selected[0]]} +${selected.length - 1}`;

  return (
    <div className="metric-multiselect" ref={rootRef}>
      <button
        type="button"
        className="metric-multiselect-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="metric-multiselect-swatches" aria-hidden="true">
          {selected.map((metric) => (
            <span
              key={metric}
              className={`training-fitness-swatch training-fitness-swatch--${metric}`}
            />
          ))}
        </span>
        <span className="metric-multiselect-label">{triggerLabel}</span>
        <ChevronDown
          className={
            isOpen
              ? "metric-multiselect-icon is-open"
              : "metric-multiselect-icon"
          }
          size={16}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div className="metric-multiselect-menu" role="listbox" aria-multiselectable="true">
          <p className="metric-multiselect-hint">Stack up to three metrics</p>
          {WEEKLY_ACTIVITY_METRICS.map((metric) => {
            const isSelected = selected.includes(metric);
            const isLastSelected = isSelected && selected.length === 1;

            return (
              <button
                type="button"
                key={metric}
                className={
                  isSelected
                    ? "metric-multiselect-option is-selected"
                    : "metric-multiselect-option"
                }
                role="option"
                aria-selected={isSelected}
                aria-disabled={isLastSelected}
                onClick={() => toggle(metric)}
              >
                <span
                  className={
                    isSelected
                      ? `metric-multiselect-check is-on training-fitness-swatch--${metric}`
                      : "metric-multiselect-check"
                  }
                >
                  {isSelected ? (
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  ) : null}
                </span>
                <span>{getWeeklyActivityMetricLabel(metric, unitSystem)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function FitnessTrendPanel({
  snapshot,
  activities = []
}: FitnessTrendPanelProps) {
  const { unitSystem } = useUnitSystem();
  const [barsVisible, setBarsVisible] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useSelectionPreference(
    FITNESS_METRICS_PREFERENCE
  );
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
  const seriesByMetric = useMemo(
    () =>
      selectedMetrics.map((metric) => ({
        metric,
        series: buildWeeklyActivitySeries(dayList, metric, new Date(), unitSystem)
      })),
    [dayList, selectedMetrics, unitSystem]
  );

  const isSingle = seriesByMetric.length === 1;
  const primary = seriesByMetric[0];
  const maxValue = primary.series.yMax || 1;
  const yAxisTicks = useMemo(
    () => buildWeeklyActivityYAxisTicks(maxValue),
    [maxValue]
  );
  const yAxisUnitLabel = isSingle
    ? getWeeklyActivityYAxisUnitLabel(primary.metric, primary.series.yAxisUnit)
    : "rel";
  const hasData = seriesByMetric.some(({ series }) => series.hasData);
  const dayCount = primary.series.days.length;

  useEffect(() => {
    setBarsVisible(false);
    const frame = requestAnimationFrame(() => setBarsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [selectedMetrics, hasData]);

  return (
    <section className="panel training-fitness-panel">
      <div className="training-fitness-header">
        <p className="eyebrow">Weekly Activity</p>
        <div className="training-metric-select-wrap">
          <MetricMultiSelect
            selected={selectedMetrics}
            onChange={setSelectedMetrics}
          />
        </div>
      </div>

      <div className="training-fitness-legend" aria-hidden="true">
        {seriesByMetric.map(({ metric, series }) => (
          <span key={metric} className="training-fitness-legend-item">
            <span
              className={`training-fitness-swatch training-fitness-swatch--${metric}`}
            />
            {getWeeklyActivityMetricLabel(metric, unitSystem)}
            {series.hasData ? (
              <strong className="training-fitness-legend-total">
                {series.weeklyTotal}
              </strong>
            ) : null}
          </span>
        ))}
      </div>

      {hasData ? (
        <div
          className="training-fitness-chart"
          role="img"
          aria-label={`Weekly activity chart for ${seriesByMetric
            .map(({ series }) => series.metricLabel.toLowerCase())
            .join(", ")}.`}
        >
          <div className="training-fitness-y-axis" aria-hidden="true">
            {yAxisUnitLabel ? (
              <span className="training-fitness-y-unit">{yAxisUnitLabel}</span>
            ) : null}
            <div className="training-fitness-y-ticks">
              {[...yAxisTicks].reverse().map((tick) => (
                <span key={tick} className="training-fitness-y-tick">
                  {isSingle
                    ? formatWeeklyActivityAxisTick(
                        tick,
                        primary.metric,
                        primary.series.yAxisUnit
                      )
                    : ""}
                </span>
              ))}
            </div>
          </div>

          <div className="training-fitness-plot">
            <div className="training-fitness-grid-lines" aria-hidden="true">
              {yAxisTicks.map((tick) => (
                <span
                  key={tick}
                  className="training-fitness-grid-line"
                  style={{ bottom: `${(tick / maxValue) * 100}%` }}
                />
              ))}
            </div>

            <div
              className="training-fitness-bars"
              role="list"
              aria-label="Weekly activity for the current calendar week"
            >
              {Array.from({ length: dayCount }, (_unused, dayIndex) => {
                const dayInfo = primary.series.days[dayIndex];
                const fullLabel = formatHappenDayLabel(dayInfo.happenDay);
                const dayHasValue = seriesByMetric.some(
                  ({ series }) => series.days[dayIndex].value > 0
                );

                return (
                  <span
                    key={dayInfo.happenDay}
                    className={`training-fitness-day${
                      !dayHasValue ? " is-empty" : ""
                    }${dayInfo.isToday ? " is-today" : ""}`}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${fullLabel}: ${seriesByMetric
                      .map(
                        ({ series }) =>
                          `${series.metricLabel} ${series.days[dayIndex].displayValue}`
                      )
                      .join(", ")}`}
                  >
                    <span className="training-fitness-bar-group">
                      {seriesByMetric.map(({ metric, series }, metricIndex) => {
                        const bar = series.days[dayIndex];
                        const barHasValue = bar.value > 0;
                        const heightPct = barHasValue
                          ? Math.max(
                              10,
                              (bar.value / (series.yMax || 1)) * 100
                            )
                          : 0;

                        return (
                          <span
                            key={metric}
                            className={`training-fitness-bar training-fitness-bar--${metric}${
                              barHasValue ? "" : " is-empty"
                            }`}
                            style={{
                              height:
                                barsVisible && barHasValue
                                  ? `${heightPct}%`
                                  : undefined,
                              transitionDelay: `${
                                dayIndex * 60 + metricIndex * 40
                              }ms`
                            }}
                          />
                        );
                      })}
                    </span>
                    <span className="training-fitness-date">
                      {dayInfo.weekdayLabel}
                    </span>
                    <span className="training-fitness-tooltip" role="tooltip">
                      <strong>{fullLabel}</strong>
                      {seriesByMetric.map(({ metric, series }) => (
                        <span
                          key={metric}
                          className="training-fitness-tooltip-row"
                        >
                          <span
                            className={`training-fitness-swatch training-fitness-swatch--${metric}`}
                          />
                          {series.metricLabel}:{" "}
                          {series.days[dayIndex].displayValue}
                        </span>
                      ))}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="training-empty-state">No weekly activity data yet.</p>
      )}
    </section>
  );
}
