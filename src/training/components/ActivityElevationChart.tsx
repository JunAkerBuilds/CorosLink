import { getLocale, useLanguage, t } from "../../i18n/training";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ReferenceArea,
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
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  distanceUnit,
  elevationUnit,
  metersToDisplayDistance,
  metersToElevation
} from "../../units/units";
import type { UnitSystem } from "../../../electron/types";

interface ActivityElevationChartProps {
  track?: TrainingHubActivityTrack;
  /** A stretch (a lap, a chart selection) to shade, in metres from the start. */
  highlight?: [number, number] | null;
}

interface ElevationDatum {
  /** Position along the profile: the x axis is numeric so a stretch can be shaded. */
  index: number;
  label: string;
  elevation: number;
  meters?: number;
}

function ElevationTooltip({
  active,
  payload,
  unitSystem
}: TooltipContentProps & { unitSystem: UnitSystem }) {
  useLanguage();
  if (!active || !payload?.length) {
    return null;
  }

  const elevation = payload[0]?.value;
  const label = (payload[0]?.payload as ElevationDatum | undefined)?.label;

  return (
    <div className="training-chart-tooltip">
      <span>{(label == null ? label : t(String(label)))}</span>
      <strong>{typeof elevation === "number" ? `${Math.round(elevation)} ${elevationUnit(unitSystem)}` : "-"}</strong>
    </div>
  );
}

export function ActivityElevationChart({ track, highlight }: ActivityElevationChartProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const { data, hasDistance } = useMemo(() => {
    const points = track?.points ?? [];
    const withElevation = points.filter(
      (point) => point.elevation !== undefined && Number.isFinite(point.elevation)
    );

    if (withElevation.length < 2) {
      return { data: [], hasDistance: false };
    }

    const useDistance = withElevation.some(
      (point) => point.distance !== undefined && point.distance > 0
    );
    // A flat line with nowhere travelled (a treadmill, a run that never got
    // going) is no profile at all.
    if (!useDistance) {
      const heights = withElevation.map((point) => point.elevation!);
      if (Math.max(...heights) - Math.min(...heights) < 1) return { data: [], hasDistance: false };
    }

    const data = withElevation.map((point, index): ElevationDatum => {
      const distance =
        useDistance && point.distance !== undefined
          ? metersToDisplayDistance(point.distance, unitSystem)
          : index;

      return {
        index,
        label: useDistance
          ? `${distance.toFixed(1)} ${distanceUnit(unitSystem)}`
          : `Point ${index + 1}`,
        elevation: metersToElevation(point.elevation!, unitSystem),
        meters: useDistance ? point.distance : undefined
      };
    });
    return { data, hasDistance: useDistance };
  }, [track, unitSystem, getLocale()]);

  // The shaded stretch snaps to the profile's own points.
  const band = (() => {
    if (!highlight || !hasDistance) return null;
    const [from, to] = highlight;
    const inside = data.filter((datum) => datum.meters !== undefined && datum.meters >= from && datum.meters <= to);
    const first = inside[0] ?? data.find((datum) => (datum.meters ?? -1) >= from);
    const last = inside[inside.length - 1] ?? first;
    return first && last ? { x1: first.index, x2: last.index } : null;
  })();

  if (data.length < 2) {
    return (
      <div className="activity-elevation-empty">
        <p>{t("No elevation profile available for this activity.")}</p>
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
            dataKey="index"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => data[Math.round(value)]?.label ?? ""}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tickMargin={4}
            // Sample numbers mean nothing on an axis; without distance it stays bare.
            tick={hasDistance ? { fill: trainingChartColors.text, fontSize: 11 } : false}
          />
          <YAxis
            tick={{ fill: trainingChartColors.text, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={42}
            tickFormatter={(value) => `${value}`}
          />
          <Tooltip
            content={(props) => <ElevationTooltip {...props} unitSystem={unitSystem} />}
            cursor={{ stroke: trainingChartColors.cursor }}
            contentStyle={trainingChartTooltipStyle}
          />
          {band ? (
            <ReferenceArea
              x1={band.x1}
              x2={band.x2}
              className="activity-elevation-highlight"
              fill="currentColor"
              fillOpacity={0.14}
              stroke="currentColor"
              strokeOpacity={0.5}
            />
          ) : null}
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
