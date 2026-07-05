import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import {
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../../training/chartConfig";
import { useChartColors } from "../../training/useChartColors";
import { ChartAreaGradient } from "../../training/components/TrainingTrendChart";

export interface ChartDatum {
  label: string;
  value: number;
}

interface ChatMiniAreaChartProps {
  data: ChartDatum[];
  gradientId: string;
  name: string;
  formatValue: (value: number) => string;
  yAxisFormatter?: (value: number) => string;
}

function MiniAreaTooltip({
  active,
  payload,
  label,
  formatValue
}: TooltipContentProps & { formatValue: (value: number) => string }) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value;

  return (
    <div className="training-chart-tooltip">
      <span>{label}</span>
      <strong>
        {typeof value === "number" ? formatValue(value) : "-"}
      </strong>
    </div>
  );
}

export function ChatMiniAreaChart({
  data,
  gradientId,
  name,
  formatValue,
  yAxisFormatter = (value) => `${value}`
}: ChatMiniAreaChartProps) {
  const { colors, activeDot } = useChartColors();

  if (data.length < 2) {
    return null;
  }

  return (
    <div className="chat-visual-chart-shell">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={trainingChartMargin}>
          <defs>
            <ChartAreaGradient id={gradientId} />
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: colors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={["auto", "auto"]}
            tickFormatter={yAxisFormatter}
          />
          <Tooltip
            content={(props) => (
              <MiniAreaTooltip {...props} formatValue={formatValue} />
            )}
            cursor={{ stroke: colors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={name}
            stroke={colors.accentBright}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            activeDot={activeDot}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function buildDistanceSeriesData(
  series: { distance?: number; hr?: number; pace?: number; power?: number }[],
  valueKey: "hr" | "pace" | "power"
): ChartDatum[] {
  const withValue = series.filter(
    (point) =>
      point[valueKey] !== undefined && Number.isFinite(point[valueKey] as number)
  );

  if (withValue.length < 2) {
    return [];
  }

  const useDistance = withValue.some(
    (point) => point.distance !== undefined && point.distance > 0
  );

  return withValue.map((point, index): ChartDatum => {
    const distanceKm =
      useDistance && point.distance !== undefined
        ? point.distance / 1000
        : index;

    return {
      label: useDistance
        ? `${distanceKm.toFixed(1)} km`
        : `Point ${index + 1}`,
      value: point[valueKey] as number
    };
  });
}

export function buildElevationSeriesData(
  points: { elevation?: number; distance?: number }[]
): ChartDatum[] {
  const withElevation = points.filter(
    (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
  );

  if (withElevation.length < 2) {
    return [];
  }

  const useDistance = withElevation.some(
    (point) => point.distance !== undefined && point.distance > 0
  );

  return withElevation.map((point, index): ChartDatum => {
    const distanceKm =
      useDistance && point.distance !== undefined
        ? point.distance / 1000
        : index;

    return {
      label: useDistance
        ? `${distanceKm.toFixed(1)} km`
        : `Point ${index + 1}`,
      value: point.elevation!
    };
  });
}
