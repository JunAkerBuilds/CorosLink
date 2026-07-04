import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { FitnessTrendPreview } from "../../electron/types";
import {
  trainingChartActiveDot,
  trainingChartColors,
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../training/chartConfig";
import { ChartAreaGradient } from "../training/components/TrainingTrendChart";

interface FitnessTrendCardProps {
  preview: FitnessTrendPreview;
}

function TrendTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="training-chart-tooltip">
      {label ? <span>{label}</span> : null}
      {payload.map((entry) => (
        <strong key={String(entry.dataKey ?? entry.name)}>
          {entry.name}: {entry.value}
        </strong>
      ))}
    </div>
  );
}

export function FitnessTrendCard({ preview }: FitnessTrendCardProps) {
  const loadPoints = preview.trendPoints.filter(
    (point) => point.trainingLoad !== undefined
  );
  const hrvPoints = preview.trendPoints.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );
  const rhrPoints = preview.trendPoints.filter((point) => point.rhr !== undefined);

  return (
    <div className="chat-visual-card">
      <div className="chat-visual-card-header">
        <div>
          <h4>Fitness trends</h4>
          <span className="chat-visual-card-subtitle">Last 7 days</span>
        </div>
      </div>

      {loadPoints.length > 0 ? (
        <section className="chat-visual-section">
          <h5>Training load</h5>
          <div className="chat-visual-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={loadPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id={`chatLoadFill-${preview.previewId}`} />
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  content={(props) => <TrendTooltip {...props} />}
                  contentStyle={trainingChartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="trainingLoad"
                  name="Load"
                  stroke={trainingChartColors.accentBright}
                  fill={`url(#chatLoadFill-${preview.previewId})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={trainingChartActiveDot}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {hrvPoints.length > 0 ? (
        <section className="chat-visual-section">
          <h5>HRV vs baseline</h5>
          <div className="chat-visual-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id={`chatHrvFill-${preview.previewId}`} />
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  content={(props) => <TrendTooltip {...props} />}
                  contentStyle={trainingChartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="avgSleepHrv"
                  name="HRV"
                  stroke={trainingChartColors.accentBright}
                  fill={`url(#chatHrvFill-${preview.previewId})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={trainingChartActiveDot}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sleepHrvBase"
                  name="Baseline"
                  stroke={trainingChartColors.gold}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {rhrPoints.length > 0 ? (
        <section className="chat-visual-section">
          <h5>Resting heart rate</h5>
          <div className="chat-visual-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rhrPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id={`chatRhrFill-${preview.previewId}`} />
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: trainingChartColors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  content={(props) => <TrendTooltip {...props} />}
                  contentStyle={trainingChartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="rhr"
                  name="RHR"
                  stroke={trainingChartColors.accentBright}
                  fill={`url(#chatRhrFill-${preview.previewId})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={trainingChartActiveDot}
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {loadPoints.length === 0 &&
      hrvPoints.length === 0 &&
      rhrPoints.length === 0 ? (
        <p className="chat-visual-empty">No fitness trend data available.</p>
      ) : null}
    </div>
  );
}
