import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { TrainingHubActivityTrack } from "../../../electron/types";
import {
  trainingChartActiveDot,
  trainingChartColors,
  trainingChartMargin,
  trainingChartTooltipStyle
} from "../chartConfig";
import { ChartAreaGradient } from "./TrainingTrendChart";

interface ActivityElevationChartProps {
  track?: TrainingHubActivityTrack;
}

interface ElevationDatum {
  label: string;
  elevation: number;
}

function ElevationTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const elevation = payload[0]?.value;

  return (
    <div className="training-chart-tooltip">
      <span>{label}</span>
      <strong>{typeof elevation === "number" ? `${Math.round(elevation)} m` : "-"}</strong>
    </div>
  );
}

export function ActivityElevationChart({ track }: ActivityElevationChartProps) {
  const data = useMemo(() => {
    const points = track?.points ?? [];
    const withElevation = points.filter(
      (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
    );

    if (withElevation.length < 2) {
      return [];
    }

    const useDistance = withElevation.some(
      (point) => point.distance !== undefined && point.distance > 0
    );

    return withElevation.map((point, index): ElevationDatum => {
      const distanceKm =
        useDistance && point.distance !== undefined
          ? point.distance / 1000
          : index;

      return {
        label: useDistance
          ? `${distanceKm.toFixed(1)} km`
          : `Point ${index + 1}`,
        elevation: point.elevation!
      };
    });
  }, [track]);

  if (data.length < 2) {
    return (
      <div className="activity-elevation-empty">
        <p>No elevation profile available for this activity.</p>
      </div>
    );
  }

  return (
    <div className="activity-elevation-chart-shell">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={trainingChartMargin}>
          <defs>
            <ChartAreaGradient id="activityElevationFill" />
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: trainingChartColors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: trainingChartColors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={42}
            tickFormatter={(value) => `${value}`}
          />
          <Tooltip
            content={(props) => <ElevationTooltip {...props} />}
            cursor={{ stroke: trainingChartColors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          <Area
            type="monotone"
            dataKey="elevation"
            name="Elevation"
            stroke={trainingChartColors.accentBright}
            fill="url(#activityElevationFill)"
            strokeWidth={2}
            dot={false}
            activeDot={trainingChartActiveDot}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
