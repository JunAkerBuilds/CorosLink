import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  HeartPulse,
  MoonStar
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import type { TrainingMetricPalette } from "../chartConfig";
import { useChartColors } from "../useChartColors";
import type { TrainingTrendPoint } from "../types";

interface TrainingTrendChartsProps {
  points: TrainingTrendPoint[];
}

type ChartValueFormatter = (value: number) => string;

function formatRoundedValue(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1
  }).format(value);
}

function formatSleepDuration(value: number): string {
  const totalMinutes = Math.max(0, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatSleepAxisTick(value: number): string {
  return `${formatRoundedValue(value / 60)}h`;
}

function formatTooltipValue(
  value: unknown,
  valueFormatter?: ChartValueFormatter
): string {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (Number.isFinite(numericValue)) {
    return valueFormatter
      ? valueFormatter(numericValue)
      : formatRoundedValue(numericValue);
  }

  if (Array.isArray(value)) {
    return value.join(" – ");
  }

  return value === undefined || value === null ? "—" : String(value);
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

function formatTooltipHeading(date: unknown, fallback: unknown): string {
  const raw =
    typeof date === "string" && /^\d{8}$/.test(date) ? date : undefined;

  if (!raw) {
    return typeof fallback === "string" || typeof fallback === "number"
      ? String(fallback)
      : "";
  }

  const parsed = new Date(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8))
  );

  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function TrendChartTooltip({
  active,
  payload,
  label,
  valueFormatter
}: TooltipContentProps & { valueFormatter?: ChartValueFormatter }) {
  if (!active || !payload?.length) {
    return null;
  }

  const heading = formatTooltipHeading(
    (payload[0]?.payload as TrainingTrendPoint | undefined)?.date,
    label
  );
  const accentColor = payload[0]?.color ?? "var(--accent)";

  return (
    <div className="training-chart-tooltip">
      <span
        className="training-chart-tooltip-accent"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`
        }}
      />
      {heading ? (
        <span className="training-chart-tooltip-label">{heading}</span>
      ) : null}
      <ul className="training-chart-tooltip-rows">
        {payload.map((entry) => {
          const dotColor = entry.color ?? "var(--accent)";
          return (
            <li
              className="training-chart-tooltip-row"
              key={String(entry.dataKey ?? entry.name)}
            >
              <span className="training-chart-tooltip-key">
                <i
                  aria-hidden="true"
                  style={{
                    background: dotColor,
                    boxShadow: `0 0 8px ${dotColor}`
                  }}
                />
                {entry.name}
              </span>
              <strong>{formatTooltipValue(entry.value, valueFormatter)}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChartAreaGradient({
  id,
  stops
}: {
  id: string;
  stops?: { top: string; mid: string; bottom: string };
}) {
  const { fillStops } = useChartColors();
  const resolved = stops ?? fillStops;
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={resolved.top} stopOpacity={0.5} />
      <stop offset="55%" stopColor={resolved.mid} stopOpacity={0.16} />
      <stop offset="100%" stopColor={resolved.bottom} stopOpacity={0} />
    </linearGradient>
  );
}

function EmptyChartNotice({
  icon: Icon,
  palette,
  title,
  children
}: {
  icon: LucideIcon;
  palette: TrainingMetricPalette;
  title: string;
  children: string;
}) {
  return (
    <div className="training-chart-empty">
      <span
        className="training-chart-empty-icon"
        style={{ background: palette.soft, color: palette.chip }}
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="training-chart-empty-text">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </div>
  );
}

interface ChartLatestStatProps {
  points: TrainingTrendPoint[];
  dataKey: keyof Pick<
    TrainingTrendPoint,
    "trainingLoad" | "rpeLoad" | "avgSleepHrv" | "sleepMinutes"
  >;
  palette: TrainingMetricPalette;
  formatValue: ChartValueFormatter;
  formatDelta: (delta: number) => string;
}

function ChartLatestStat({
  points,
  dataKey,
  palette,
  formatValue,
  formatDelta
}: ChartLatestStatProps) {
  const values = points
    .map((point) => point[dataKey])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );

  if (values.length === 0) {
    return null;
  }

  const latest = values[values.length - 1]!;
  const previous = values.length > 1 ? values[values.length - 2]! : undefined;
  const delta = previous === undefined ? undefined : latest - previous;

  return (
    <div className="training-chart-stat">
      <span className="training-chart-stat-value">{formatValue(latest)}</span>
      {delta !== undefined && Math.abs(delta) > 1e-9 ? (
        <span
          className="training-chart-stat-delta"
          style={{ background: palette.soft, color: palette.chip }}
        >
          {delta > 0 ? (
            <ArrowUpRight size={12} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <ArrowDownRight size={12} strokeWidth={2.5} aria-hidden="true" />
          )}
          {formatDelta(Math.abs(delta))}
        </span>
      ) : null}
    </div>
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

type TrendAxisDomain = [
  number | ((dataMin: number) => number),
  number | ((dataMax: number) => number)
];

/** Zero-based domain with a little headroom so peaks never touch the panel. */
function paddedZeroDomain(dataMax: number): number {
  return Math.ceil(dataMax * 1.15) || 1;
}

function TrendChartAxes({
  tooltipValueFormatter,
  yAxisTickFormatter,
  yAxisWidth = 36,
  yAxisDomain
}: {
  tooltipValueFormatter?: ChartValueFormatter;
  yAxisTickFormatter?: ChartValueFormatter;
  yAxisWidth?: number;
  yAxisDomain?: TrendAxisDomain;
}) {
  const { colors } = useChartColors();
  return (
    <>
      <CartesianGrid
        stroke={colors.grid}
        vertical={false}
        strokeDasharray="2 8"
      />
      <XAxis
        dataKey="label"
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        dy={8}
        padding={{ left: 14, right: 14 }}
      />
      <YAxis
        tick={{ fill: colors.text, fontSize: 11, fontWeight: 500 }}
        axisLine={false}
        tickLine={false}
        tickFormatter={yAxisTickFormatter}
        width={yAxisWidth}
        tickCount={5}
        domain={yAxisDomain ?? [0, paddedZeroDomain]}
      />
      <Tooltip
        content={(props) => (
          <TrendChartTooltip
            {...props}
            valueFormatter={tooltipValueFormatter}
          />
        )}
        contentStyle={trainingChartTooltipStyle}
        cursor={{ stroke: colors.cursorBand, strokeWidth: 26 }}
      />
    </>
  );
}

export function TrainingTrendCharts({ points }: TrainingTrendChartsProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { colors, metrics } = useChartColors();

  const metricDot = (palette: TrainingMetricPalette) => ({
    r: 3,
    fill: palette.stroke,
    stroke: colors.dotStroke,
    strokeWidth: 2
  });
  const metricActiveDot = (palette: TrainingMetricPalette) => ({
    r: 5,
    fill: palette.stroke,
    stroke: palette.halo,
    strokeWidth: 6
  });

  const loadPoints = points.filter((point) => point.trainingLoad !== undefined);
  const rpePoints = points.filter((point) => point.rpeLoad !== undefined);
  const hrvPoints = points.filter(
    (point) => point.avgSleepHrv !== undefined || point.sleepHrvBase !== undefined
  );
  const sleepPoints = points.filter((point) => point.sleepMinutes !== undefined);

  return (
    <div className="training-chart-grid">
      <section className="panel training-chart-panel" data-metric="load">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">Training Load</p>
            <h2>Last 7 days</h2>
          </div>
          {loadPoints.length > 0 ? (
            <ChartLatestStat
              points={loadPoints}
              dataKey="trainingLoad"
              palette={metrics.load}
              formatValue={formatRoundedValue}
              formatDelta={formatRoundedValue}
            />
          ) : null}
        </div>
        {loadPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={loadPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient
                    id="trainingLoadFill"
                    stops={metrics.load.stops}
                  />
                </defs>
                <TrendChartAxes />
                <Area
                  type="monotone"
                  dataKey="trainingLoad"
                  name="Training load"
                  stroke={metrics.load.stroke}
                  fill="url(#trainingLoadFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.load)}
                  activeDot={metricActiveDot(metrics.load)}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChartNotice
            icon={Activity}
            palette={metrics.load}
            title="No training load yet"
          >
            Complete a workout and sync from COROS to see your load trend.
          </EmptyChartNotice>
        )}
      </section>

      <section className="panel training-chart-panel" data-metric="rpe">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">RPE Load · AU</p>
            <h2>Last 7 days</h2>
          </div>
          {rpePoints.length > 0 ? (
            <ChartLatestStat
              points={rpePoints}
              dataKey="rpeLoad"
              palette={metrics.rpe}
              formatValue={(value) => `${formatRoundedValue(value)} AU`}
              formatDelta={(delta) => `${formatRoundedValue(delta)} AU`}
            />
          ) : null}
        </div>
        {rpePoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rpePoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="rpeLoadFill" stops={metrics.rpe.stops} />
                </defs>
                <TrendChartAxes
                  tooltipValueFormatter={(value) => `${formatRoundedValue(value)} AU`}
                />
                <Area
                  type="monotone"
                  dataKey="rpeLoad"
                  name="RPE load"
                  stroke={metrics.rpe.stroke}
                  fill="url(#rpeLoadFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.rpe)}
                  activeDot={metricActiveDot(metrics.rpe)}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChartNotice
            icon={Gauge}
            palette={metrics.rpe}
            title="No RPE data yet"
          >
            Rate your activities in COROS to track perceived effort.
          </EmptyChartNotice>
        )}
      </section>

      <section className="panel training-chart-panel" data-metric="hrv">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">HRV vs Baseline · ms</p>
            <h2>Last 7 days</h2>
          </div>
          <div className="training-chart-heading-side">
            {hrvPoints.length > 0 ? (
              <ChartLatestStat
                points={hrvPoints}
                dataKey="avgSleepHrv"
                palette={metrics.hrv}
                formatValue={(value) => `${formatRoundedValue(value)} ms`}
                formatDelta={(delta) => `${formatRoundedValue(delta)} ms`}
              />
            ) : null}
            <HrvChartLegend />
          </div>
        </div>
        {hrvPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hrvPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient id="hrvFill" stops={metrics.hrv.stops} />
                </defs>
                <TrendChartAxes
                  tooltipValueFormatter={(value) => `${formatRoundedValue(value)} ms`}
                  yAxisDomain={[
                    (dataMin: number) => Math.max(0, Math.floor(dataMin - 14)),
                    (dataMax: number) => Math.ceil(dataMax + 12) || 1
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="avgSleepHrv"
                  name="HRV"
                  stroke={metrics.hrv.stroke}
                  fill="url(#hrvFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.hrv)}
                  activeDot={metricActiveDot(metrics.hrv)}
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
          <EmptyChartNotice
            icon={HeartPulse}
            palette={metrics.hrv}
            title="No HRV readings"
          >
            Wear your device during sleep to capture nightly HRV.
          </EmptyChartNotice>
        )}
      </section>

      <section className="panel training-chart-panel" data-metric="sleep">
        <div className="section-heading compact training-chart-heading">
          <div>
            <p className="eyebrow">Sleep Duration · hours</p>
            <h2>Last 7 days</h2>
          </div>
          {sleepPoints.length > 0 ? (
            <ChartLatestStat
              points={sleepPoints}
              dataKey="sleepMinutes"
              palette={metrics.sleep}
              formatValue={formatSleepDuration}
              formatDelta={formatSleepDuration}
            />
          ) : null}
        </div>
        {sleepPoints.length > 0 ? (
          <div className="training-chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sleepPoints} margin={trainingChartMargin}>
                <defs>
                  <ChartAreaGradient
                    id="sleepDurationFill"
                    stops={metrics.sleep.stops}
                  />
                </defs>
                <TrendChartAxes
                  tooltipValueFormatter={formatSleepDuration}
                  yAxisTickFormatter={formatSleepAxisTick}
                  yAxisWidth={42}
                />
                <Area
                  type="monotone"
                  dataKey="sleepMinutes"
                  name="Sleep duration"
                  stroke={metrics.sleep.stroke}
                  fill="url(#sleepDurationFill)"
                  strokeWidth={2.5}
                  dot={metricDot(metrics.sleep)}
                  activeDot={metricActiveDot(metrics.sleep)}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChartNotice
            icon={MoonStar}
            palette={metrics.sleep}
            title="No sleep data"
          >
            Sync sleep sessions from COROS to see duration trends.
          </EmptyChartNotice>
        )}
      </section>
    </div>
  );
}
