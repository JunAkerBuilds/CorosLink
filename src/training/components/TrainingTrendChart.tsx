import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../chartConfig";
import { useChartColors } from "../useChartColors";
import type { TrainingTrendPoint } from "../types";

interface TrainingTrendChartsProps {
  points: TrainingTrendPoint[];
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

function TrendChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="training-zone-tooltip training-chart-tooltip">
      {label ? <span>{label}</span> : null}
      {payload.map((entry) => (
        <strong key={String(entry.dataKey ?? entry.name)}>
          {entry.name}: {entry.value}
        </strong>
      ))}
    </div>
  );
}

export function ChartAreaGradient({ id }: { id: string }) {
  const { fillStops } = useChartColors();
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={fillStops.top} stopOpacity={0.5} />
      <stop offset="55%" stopColor={fillStops.mid} stopOpacity={0.16} />
      <stop offset="100%" stopColor={fillStops.bottom} stopOpacity={0} />
    </linearGradient>
  );
}

function HrvChartLegend() {
  return (
    <div className="training-chart-legend" aria-hidden="true">
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-dot is-accent" />
        HRV
      </span>
      <span className="training-chart-legend-item">
        <span className="training-chart-legend-line is-gold" />
        Baseline
      </span>
    </div>
  );
}

function TrendChartAxes() {
  const { colors } = useChartColors();
  return (
    <>
      <CartesianGrid
        stroke={colors.grid}
        vertical={false}
        strokeDasharray="3 6"
      />
      <XAxis
        dataKey="label"
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        dy={8}
      />
      <YAxis
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        width={36}
      />
      <Tooltip
        content={(props) => <TrendChartTooltip {...props} />}
        contentStyle={trainingChartTooltipStyle}
        cursor={{ stroke: colors.cursor, strokeWidth: 1 }}
      />
    </>
  );
}

export function TrainingTrendCharts({ points }: TrainingTrendChartsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, activeDot } = useChartColors();
  const trendDot = {
    r: 3,
    fill: colors.accentGlow,
    stroke: colors.dotStroke,
    strokeWidth: 2
  };
  const loadPoints = points.filter((point) => point.trainingLoad !== undefined);
  const hrvPoints = points.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );
  const sleepPoints = points.filter((point) => point.sleepMinutes !== undefined);

  return (
    <div className="training-chart-grid">
      <section className="panel training-chart-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Training Load</p>
            <h2>Last 7 days</h2>
          </div>
        </div>
        {loadPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={loadPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="trainingLoadFill" />
                </defs>
                <TrendChartAxes />
                <Area
                  type="monotone"
                  dataKey="trainingLoad"
                  name="Load"
                  stroke={colors.accentBright}
                  fill="url(#trainingLoadFill)"
                  strokeWidth={2.5}
                  dot={trendDot}
                  activeDot={activeDot}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="training-empty-chart">No training load data this week.</p>
        )}
      </section>

      <section className="panel training-chart-panel">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">HRV vs Baseline</p>
            <h2>Last 7 days</h2>
          </div>
          <HrvChartLegend />
        </div>
        {hrvPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="hrvFill" />
                </defs>
                <TrendChartAxes />
                <Area
                  type="monotone"
                  dataKey="avgSleepHrv"
                  name="HRV"
                  stroke={colors.accentBright}
                  fill="url(#hrvFill)"
                  strokeWidth={2.5}
                  dot={trendDot}
                  activeDot={activeDot}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={850}
                />
                <Line
                  type="monotone"
                  dataKey="sleepHrvBase"
                  name="Baseline"
                  stroke={colors.gold}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={850}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="training-empty-chart">No HRV data this week.</p>
        )}
      </section>

      <section className="panel training-chart-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Sleep Duration</p>
            <h2>Last 7 days</h2>
          </div>
        </div>
        {sleepPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sleepPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="sleepDurationFill" />
                </defs>
                <TrendChartAxes />
                <Area
                  type="monotone"
                  dataKey="sleepMinutes"
                  name="Sleep"
                  stroke={colors.accentBright}
                  fill="url(#sleepDurationFill)"
                  strokeWidth={2.5}
                  dot={trendDot}
                  activeDot={activeDot}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="training-empty-chart">No sleep duration data this week.</p>
        )}
      </section>
    </div>
  );
}
