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
  trainingChartActiveDot,
  trainingChartColors,
  trainingChartFillStops,
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../chartConfig";
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
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={trainingChartFillStops.top} stopOpacity={0.5} />
      <stop offset="55%" stopColor={trainingChartFillStops.mid} stopOpacity={0.16} />
      <stop offset="100%" stopColor={trainingChartFillStops.bottom} stopOpacity={0} />
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
  return (
    <>
      <CartesianGrid
        stroke={trainingChartColors.grid}
        vertical={false}
        strokeDasharray="3 6"
      />
      <XAxis
        dataKey="label"
        tick={{ fill: trainingChartColors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        dy={8}
      />
      <YAxis
        tick={{ fill: trainingChartColors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        width={36}
      />
      <Tooltip
        content={(props) => <TrendChartTooltip {...props} />}
        contentStyle={trainingChartTooltipStyle}
        cursor={{ stroke: trainingChartColors.cursor, strokeWidth: 1 }}
      />
    </>
  );
}

const trendDot = {
  r: 3,
  fill: trainingChartColors.accentGlow,
  stroke: trainingChartColors.dotStroke,
  strokeWidth: 2
};

export function TrainingTrendCharts({ points }: TrainingTrendChartsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const loadPoints = points.filter((point) => point.trainingLoad !== undefined);
  const hrvPoints = points.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );

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
                  stroke={trainingChartColors.accentBright}
                  fill="url(#trainingLoadFill)"
                  strokeWidth={2.5}
                  dot={trendDot}
                  activeDot={trainingChartActiveDot}
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
                  stroke={trainingChartColors.accentBright}
                  fill="url(#hrvFill)"
                  strokeWidth={2.5}
                  dot={trendDot}
                  activeDot={trainingChartActiveDot}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={850}
                />
                <Line
                  type="monotone"
                  dataKey="sleepHrvBase"
                  name="Baseline"
                  stroke={trainingChartColors.gold}
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
    </div>
  );
}
