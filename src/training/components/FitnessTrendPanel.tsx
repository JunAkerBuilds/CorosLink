import { formatNumber, getLocale, useLanguage, t, midSentence } from "../../i18n/training";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TrainingHubActivity, TrainingHubUpcomingWorkout, UnitSystem } from "../../../electron/types";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import type { TrainingHubSnapshot } from "../types";
import {
  buildWeeklyActivitySeries,
  buildWeeklyActivityYAxisTicks,
  enrichDayListWithActivityTotals,
  getCalendarWeekDateKeys,
  formatWeeklyActivityAxisTick,
  getWeeklyActivityMetricLabel,
  getWeeklyActivityYAxisUnitLabel,
  WEEKLY_ACTIVITY_METRICS,
  type WeeklyActivityMetric
} from "../weeklyActivity";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { distanceUnit, metersToDisplayDistance } from "../../units/units";
import "../overviewCards.css";
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
  /** Local-Only Mode: before the first sync the card says only that there's no data yet. */
  local?: boolean;
  /** Scheduled workouts: the rest of this week's plan draws as dashed "planned" bars. */
  upcomingWorkouts?: TrainingHubUpcomingWorkout[];
}

/** A scheduled workout's distance in metres, from its volume ("6.00 km", "400 m"); sets and times have none. */
function plannedDistanceMeters(volume: string | undefined): number {
  const match = volume?.trim().match(/^([\d.]+)\s*(km|m)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return match[2].toLowerCase() === "km" ? amount * 1000 : amount;
}

/**
 * Planned volume per day of this week, in chart units, for the metrics a plan
 * carries (distance from the volume, load from the workout). Days already past
 * are left out: their bars show what was done.
 */
function buildPlannedByDay(
  workouts: TrainingHubUpcomingWorkout[],
  metric: WeeklyActivityMetric,
  unitSystem: UnitSystem
): Map<string, number> {
  const planned = new Map<string, number>();
  if (metric === "duration" || workouts.length === 0) return planned;
  const week = new Set(getCalendarWeekDateKeys());
  const today = getLocalHappenDayKey();
  for (const workout of workouts) {
    if (!week.has(workout.happenDay) || workout.happenDay < today) continue;
    const value = metric === "distance"
      ? metersToDisplayDistance(plannedDistanceMeters(workout.volume), unitSystem)
      : workout.trainingLoad ?? 0;
    if (value > 0) planned.set(workout.happenDay, (planned.get(workout.happenDay) ?? 0) + value);
  }
  return planned;
}

function formatPlannedValue(value: number, metric: WeeklyActivityMetric, unitSystem: UnitSystem): string {
  return metric === "distance"
    ? `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${distanceUnit(unitSystem)}`
    : String(Math.round(value));
}

// Short chip labels keep grouped legends compact; the dropdown uses full labels.
const METRIC_SHORT_LABELS: Record<WeeklyActivityMetric, string> = {
  distance: "Distance",
  duration: "Duration",
  trainingLoad: "Load"
};

// Offered from the empty chart when another metric does have data this week.
const SHOW_METRIC_LABELS: Record<WeeklyActivityMetric, string> = {
  distance: "Show distance",
  duration: "Show duration",
  trainingLoad: "Show load"
};

interface MetricMultiSelectProps {
  selected: WeeklyActivityMetric[];
  onChange: (next: WeeklyActivityMetric[]) => void;
}

function MetricMultiSelect({ selected, onChange }: MetricMultiSelectProps) {
  useLanguage();
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
          <p className="metric-multiselect-hint">{t("Stack up to three metrics")}</p>
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
  activities = [],
  local = false,
  upcomingWorkouts = []
}: FitnessTrendPanelProps) {
  useLanguage();
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
    [snapshot, activities, getLocale()]
  );
  const seriesByMetric = useMemo(
    () =>
      selectedMetrics.map((metric) => {
        const series = buildWeeklyActivitySeries(dayList, metric, new Date(), unitSystem);
        // Today keeps its planned bar only until something is recorded.
        const plannedByDay = buildPlannedByDay(upcomingWorkouts, metric, unitSystem);
        const planned = series.days.map((day) =>
          day.value > 0 ? 0 : plannedByDay.get(day.happenDay) ?? 0
        );
        const plannedMax = Math.max(0, ...planned);
        const plannedTotal = planned.reduce((sum, value) => sum + value, 0);
        // The axis grows to fit a planned day longer than anything done.
        const scaleMax = plannedMax > 0
          ? Math.max(series.hasData ? series.yMax : 0, Math.ceil(plannedMax * 1.2))
          : series.yMax;
        return { metric, series, planned, plannedTotal, scaleMax: scaleMax || 1 };
      }),
    [dayList, selectedMetrics, unitSystem, upcomingWorkouts, getLocale()]
  );

  const isSingle = seriesByMetric.length === 1;
  const primary = seriesByMetric[0];
  const maxValue = primary.scaleMax;
  const hasPlanned = seriesByMetric.some(({ plannedTotal }) => plannedTotal > 0);
  const yAxisTicks = useMemo(
    () => buildWeeklyActivityYAxisTicks(maxValue),
    [maxValue, getLocale()]
  );
  const yAxisUnitLabel = isSingle
    ? getWeeklyActivityYAxisUnitLabel(primary.metric, primary.series.yAxisUnit)
    : "rel";
  const hasData = seriesByMetric.some(({ series }) => series.hasData);
  // A week with only an indoor session has time and load but no distance: point to what can be charted.
  const metricWithData = useMemo(
    () =>
      hasData
        ? undefined
        : WEEKLY_ACTIVITY_METRICS.find(
            (metric) =>
              !selectedMetrics.includes(metric) &&
              buildWeeklyActivitySeries(dayList, metric, new Date(), unitSystem).hasData
          ),
    [hasData, dayList, selectedMetrics, unitSystem]
  );
  // Once COROS has answered, a week without training is zero bars, not missing data.
  // Local-Only Mode before the first sync says only that there is no data yet.
  const answered =
    (Boolean(snapshot?.dailyMetrics || snapshot?.analytics) || activities.length > 0) &&
    !(local && !activities.length);
  const showChart = hasData || hasPlanned || (answered && !metricWithData);
  const dayCount = primary.series.days.length;

  useEffect(() => {
    setBarsVisible(false);
    const frame = requestAnimationFrame(() => setBarsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [selectedMetrics, hasData, hasPlanned]);

  return (
    <section className={`panel training-fitness-panel${hasData || hasPlanned ? "" : " is-empty"}`}>
      <div className="training-fitness-header">
        <p className="eyebrow">{t("Weekly Activity")}</p>
        <div className="training-metric-select-wrap">
          <MetricMultiSelect
            selected={selectedMetrics}
            onChange={setSelectedMetrics}
          />
        </div>
      </div>

      {/* Without bars the legend only repeats the metric picker. */}
      {hasData || hasPlanned ? <div className="training-fitness-legend" aria-hidden="true">
        {seriesByMetric.map(({ metric, series, plannedTotal }) => (
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
            {plannedTotal > 0 ? (
              <span className="training-fitness-legend-planned">
                + {formatPlannedValue(plannedTotal, metric, unitSystem)} {t("planned")}
              </span>
            ) : null}
          </span>
        ))}
        {hasPlanned ? (
          <span className="training-fitness-legend-keys">
            <span className="training-fitness-legend-key">
              <span className={`training-fitness-swatch training-fitness-swatch--${primary.metric}`} />
              {t("Done")}
            </span>
            <span className="training-fitness-legend-key">
              <span className={`training-fitness-swatch is-planned training-fitness-swatch--${primary.metric}`} />
              {t("Planned")}
            </span>
          </span>
        ) : null}
      </div> : null}

      {showChart ? (
        <div
          className="training-fitness-chart"
          role="img"
          aria-label={t("Weekly activity chart for {{value1}}.", { value1: String(seriesByMetric
            .map(({ series }) => midSentence(series.metricLabel))
            .join(", ")) })}
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
              aria-label={t("Weekly activity for the current calendar week")}
            >
              {Array.from({ length: dayCount }, (_unused, dayIndex) => {
                const dayInfo = primary.series.days[dayIndex];
                const fullLabel = formatHappenDayLabel(dayInfo.happenDay);
                const dayHasValue = seriesByMetric.some(
                  ({ series, planned }) => series.days[dayIndex].value > 0 || planned[dayIndex] > 0
                );
                const plannedLabel = (metric: WeeklyActivityMetric, value: number) =>
                  value > 0 ? `, ${t("Planned")} ${formatPlannedValue(value, metric, unitSystem)}` : "";

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
                        ({ metric, series, planned }) =>
                          `${series.metricLabel} ${series.days[dayIndex].displayValue}${plannedLabel(metric, planned[dayIndex])}`
                      )
                      .join(", ")}`}
                  >
                    <span className="training-fitness-bar-group">
                      {seriesByMetric.map(({ metric, series, planned, scaleMax }, metricIndex) => {
                        const bar = series.days[dayIndex];
                        const plannedValue = planned[dayIndex];
                        const isPlanned = bar.value <= 0 && plannedValue > 0;
                        const shownValue = isPlanned ? plannedValue : bar.value;
                        const barHasValue = shownValue > 0;
                        const heightPct = barHasValue
                          ? Math.max(10, (shownValue / scaleMax) * 100)
                          : 0;

                        return (
                          <span
                            key={metric}
                            className={`training-fitness-bar training-fitness-bar--${metric}${
                              barHasValue ? "" : " is-empty"
                            }${isPlanned ? " is-planned" : ""}`}
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
                      {t(dayInfo.weekdayLabel)}
                    </span>
                    <span className="training-fitness-tooltip" role="tooltip">
                      <strong>{fullLabel}</strong>
                      {seriesByMetric.map(({ metric, series, planned }) => (
                        <span
                          key={metric}
                          className="training-fitness-tooltip-row"
                        >
                          <span
                            className={`training-fitness-swatch training-fitness-swatch--${metric}${planned[dayIndex] > 0 ? " is-planned" : ""}`}
                          />
                          {series.metricLabel}:{" "}
                          {planned[dayIndex] > 0
                            ? `${formatPlannedValue(planned[dayIndex], metric, unitSystem)} ${t("planned")}`
                            : series.days[dayIndex].displayValue}
                        </span>
                      ))}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : metricWithData ? (
        <div className="training-empty-state training-fitness-empty">
          <p>
            {selectedMetrics.length === 1
              ? t("Nothing recorded for this metric this week.")
              : t("Nothing recorded for these metrics this week.")}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setSelectedMetrics([metricWithData])}
          >
            {t(SHOW_METRIC_LABELS[metricWithData])}
          </button>
        </div>
      ) : (
        // The chart covers the current calendar week (from Monday), not "all data".
        <p className="training-empty-state">{local && !activities.length ? t("No data yet.") : t("No activity this week yet.")}</p>
      )}
    </section>
  );
}
