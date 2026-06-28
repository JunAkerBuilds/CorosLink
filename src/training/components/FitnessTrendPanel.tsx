import { useEffect, useState } from "react";
import {
  formatHappenDayLabel,
  formatOptionalNumber,
  recentTrainingHubDateList
} from "../formatters";
import { mergeTrainingDayLists } from "../parsers";
import type { TrainingHubSnapshot } from "../types";

interface FitnessTrendPanelProps {
  snapshot: TrainingHubSnapshot | null;
}

function formatCompactHappenDay(value: string): string {
  if (!/^\d{8}$/.test(value)) {
    return value;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(year, month, day));
}

export function FitnessTrendPanel({ snapshot }: FitnessTrendPanelProps) {
  const [isReady, setIsReady] = useState(false);
  const days = mergeTrainingDayLists(
    snapshot?.dailyMetrics ?? null,
    snapshot?.analytics ?? null
  );
  const dayMap = new Map(days.map((day) => [day.happenDay, day]));
  const dateKeys = recentTrainingHubDateList(7).reverse();
  const hasFitnessScore = dateKeys.some((key) =>
    Number.isFinite(dayMap.get(key)?.staminaLevel)
  );
  const metricLabel = hasFitnessScore ? "Fitness" : "Training load";
  const bars = dateKeys.map((key) => {
    const day = dayMap.get(key);
    const value = hasFitnessScore ? day?.staminaLevel : day?.trainingLoad;

    return {
      key,
      day,
      value: Number.isFinite(value) ? value : undefined,
      label: formatCompactHappenDay(key),
      fullLabel: formatHappenDayLabel(key)
    };
  });
  const hasTrendData = bars.some((bar) => Number.isFinite(bar.value));
  const maxValue =
    bars.reduce((max, bar) => Math.max(max, bar.value ?? 0), 0) || 1;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [bars.length]);

  return (
    <section className="panel training-fitness-panel">
      <div className="training-fitness-header">
        <p className="eyebrow">Fitness Trend</p>
        <span className="training-range-pill">
          {hasTrendData ? "Last 7 days" : "No data"}
        </span>
      </div>

      {hasTrendData ? (
        <div
          className="training-fitness-bars"
          role="list"
          aria-label={`${metricLabel} trend over the last 7 days`}
        >
          {bars.map((bar, index) => {
            const valueLabel =
              bar.value !== undefined ? formatOptionalNumber(bar.value) : "No data";
            const loadLabel =
              bar.day?.trainingLoad !== undefined
                ? formatOptionalNumber(bar.day.trainingLoad)
                : "No data";
            const fatigueLabel =
              bar.day?.tiredRateNew !== undefined
                ? formatOptionalNumber(bar.day.tiredRateNew)
                : "No data";

            return (
              <span
                key={bar.key}
                className={`training-fitness-day${
                  bar.value === undefined ? " is-empty" : ""
                }`}
                role="listitem"
                tabIndex={0}
                aria-label={`${bar.fullLabel}: ${metricLabel} ${valueLabel}, load ${loadLabel}, fatigue ${fatigueLabel}`}
              >
                <span
                  className="training-fitness-bar"
                  style={{
                    height:
                      isReady && bar.value !== undefined
                        ? `${Math.max(10, (bar.value / maxValue) * 100)}%`
                        : "0%",
                    transitionDelay: `${index * 60}ms`
                  }}
                />
                <span className="training-fitness-date">{bar.label}</span>
                <span className="training-fitness-tooltip" role="tooltip">
                  <strong>{bar.fullLabel}</strong>
                  <span>
                    {metricLabel}: {valueLabel}
                  </span>
                  <span>Load: {loadLabel}</span>
                  <span>Fatigue: {fatigueLabel}</span>
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="training-empty-state">No fitness trend data yet.</p>
      )}
    </section>
  );
}
