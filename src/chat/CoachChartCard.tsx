import { useMemo } from "react";
import { Pin, PinOff, RefreshCw } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type {
  CoachChartColor,
  CoachChartPreview,
  CoachChartResolvedSeries
} from "../../electron/types";
import { trainingChartTooltipStyle } from "../training/chartConfig";
import { useChartColors } from "../training/useChartColors";
import "./coachChart.css";

export interface CoachChartCardProps {
  preview: CoachChartPreview;
  /** "chat" renders inside a chat bubble; "panel" is the Training Hub tile. */
  variant?: "chat" | "panel";
  pinned?: boolean;
  busy?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onRefresh?: () => void;
}

interface SeriesPalette {
  stroke: string;
  stops: { top: string; mid: string; bottom: string };
}

function useSeriesPalette(): (color: CoachChartColor) => SeriesPalette {
  const { colors, metrics } = useChartColors();
  return useMemo(() => {
    const flat = (stroke: string): SeriesPalette => ({
      stroke,
      stops: { top: stroke, mid: stroke, bottom: stroke }
    });
    const table: Record<CoachChartColor, SeriesPalette> = {
      load: { stroke: metrics.load.stroke, stops: metrics.load.stops },
      hrv: { stroke: metrics.hrv.stroke, stops: metrics.hrv.stops },
      sleep: { stroke: metrics.sleep.stroke, stops: metrics.sleep.stops },
      rpe: { stroke: metrics.rpe.stroke, stops: metrics.rpe.stops },
      gold: flat(colors.gold),
      blue: flat(colors.blue),
      accent: flat(colors.accentBright),
      muted: flat(colors.text)
    };
    return (color) => table[color];
  }, [colors, metrics]);
}

function formatValue(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return Math.abs(value) >= 100 || Number.isInteger(value)
    ? String(Math.round(value))
    : value.toFixed(1);
}

function formatWindow(preview: CoachChartPreview): string {
  const count = preview.labels.length;
  const first = preview.labels[0];
  const last = preview.labels[count - 1];
  if (preview.dates) {
    return `Last ${count} days · ${first} – ${last}`;
  }
  return `${first} – ${last}`;
}

function formatResolvedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CoachChartTooltip({
  active,
  payload,
  label,
  labels,
  series,
  palette
}: TooltipContentProps & {
  labels: string[];
  series: CoachChartResolvedSeries[];
  palette: (color: CoachChartColor) => SeriesPalette;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const index = typeof label === "number" ? label : Number(label);
  const heading = Number.isFinite(index) ? labels[index] : String(label ?? "");
  const byKey = new Map(payload.map((entry) => [String(entry.dataKey), entry.value]));

  return (
    <div className="training-chart-tooltip">
      <span className="training-chart-tooltip-label">{heading}</span>
      <ul className="training-chart-tooltip-rows">
        {series.map((entry) => (
          <li key={entry.key} className="training-chart-tooltip-row">
            <span className="training-chart-tooltip-key">
              <i style={{ background: palette(entry.color).stroke }} aria-hidden="true" />
              {entry.label}
            </span>
            <strong>{formatValue(byKey.get(entry.key))}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoachChartCard({
  preview,
  variant = "chat",
  pinned = false,
  busy = false,
  onPin,
  onUnpin,
  onRefresh
}: CoachChartCardProps) {
  const { colors, activeDot } = useChartColors();
  const palette = useSeriesPalette();

  const rows = useMemo(
    () =>
      preview.labels.map((_label, index) => {
        const row: Record<string, number | null> = { x: index };
        for (const entry of preview.series) {
          row[entry.key] = entry.values[index] ?? null;
        }
        return row;
      }),
    [preview]
  );

  const hasRightAxis = preview.series.some((entry) => entry.axis === "right");
  // Bars read wrong on a clipped axis, so anchor any bar-bearing axis at zero.
  const axisDomain = (axis: "left" | "right"): [number | "auto", "auto"] =>
    preview.series.some(
      (entry) =>
        entry.kind === "bar" &&
        (entry.axis === axis || (axis === "left" && !hasRightAxis))
    )
      ? [0, "auto"]
      : ["auto", "auto"];
  const hasData = preview.series.some((entry) =>
    entry.values.some((value) => typeof value === "number")
  );
  const gradientPrefix = `coachChart-${preview.previewId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tickGap = preview.labels.length > 40 ? 48 : 28;

  const subtitle = preview.spec.subtitle ?? formatWindow(preview);
  const stamp =
    variant === "panel" && preview.resolvedAt
      ? `${preview.live ? "Updated" : "Pinned"} ${formatResolvedAt(preview.resolvedAt)}`
      : null;

  return (
    <div className={`chat-visual-card coach-chart-card coach-chart-card-${variant}`}>
      <div className="chat-visual-card-header">
        <div>
          <h4>{preview.spec.title}</h4>
          <span className="chat-visual-card-subtitle">
            {subtitle}
            {stamp ? <> · {stamp}</> : null}
          </span>
        </div>
        {onPin || onUnpin || onRefresh ? (
          <div className="coach-chart-actions">
            {onRefresh && preview.live ? (
              <button
                type="button"
                className="coach-chart-action"
                onClick={onRefresh}
                disabled={busy}
                title="Refresh with the latest data"
              >
                <RefreshCw
                  size={13}
                  aria-hidden="true"
                  className={busy ? "is-spinning" : undefined}
                />
                <span>Refresh</span>
              </button>
            ) : null}
            {pinned && onUnpin ? (
              <button
                type="button"
                className="coach-chart-action is-pinned"
                onClick={onUnpin}
                disabled={busy}
                title="Remove from Training Hub"
              >
                <PinOff size={13} aria-hidden="true" />
                <span>{variant === "panel" ? "Unpin" : "Pinned"}</span>
              </button>
            ) : onPin ? (
              <button
                type="button"
                className="coach-chart-action"
                onClick={onPin}
                disabled={busy}
                title="Keep this chart on the Training Hub"
              >
                <Pin size={13} aria-hidden="true" />
                <span>Pin to Training Hub</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {preview.tiles.length > 0 ? (
        <div className="coach-chart-tiles">
          {preview.tiles.map((tile, index) => (
            <div key={`${tile.label}-${index}`} className="coach-chart-tile">
              <span className="coach-chart-tile-label">{tile.label}</span>
              <strong className="coach-chart-tile-value">{tile.value}</strong>
              {tile.caption ? (
                <span className="coach-chart-tile-caption">{tile.caption}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <ul className="coach-chart-legend">
        {preview.series.map((entry) => (
          <li key={entry.key}>
            <i
              className={`coach-chart-legend-swatch is-${entry.kind}${
                entry.dashed ? " is-dashed" : ""
              }`}
              style={{ color: palette(entry.color).stroke }}
              aria-hidden="true"
            />
            {entry.label}
            {entry.axis === "right" && hasRightAxis ? (
              <span className="coach-chart-legend-axis">R</span>
            ) : null}
          </li>
        ))}
        {preview.ranges.length > 0 ? (
          <li>
            <i className="coach-chart-legend-swatch is-range" aria-hidden="true" />
            {preview.ranges.length === 1 && preview.ranges[0].label
              ? preview.ranges[0].label
              : "Highlighted block"}
          </li>
        ) : null}
      </ul>

      {hasData ? (
        <div className="coach-chart-shell">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 12, right: hasRightAxis ? 4 : 12, left: -6, bottom: 4 }}
            >
              <defs>
                {preview.series
                  .filter((entry) => entry.kind === "area")
                  .map((entry) => {
                    const stops = palette(entry.color).stops;
                    return (
                      <linearGradient
                        key={entry.key}
                        id={`${gradientPrefix}-${entry.key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={stops.top} stopOpacity={0.45} />
                        <stop offset="55%" stopColor={stops.mid} stopOpacity={0.14} />
                        <stop offset="100%" stopColor={stops.bottom} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
              </defs>
              <CartesianGrid stroke={colors.grid} vertical={false} strokeDasharray="3 3" />
              {preview.ranges.map((range, index) => (
                <ReferenceArea
                  key={`range-${index}`}
                  x1={range.fromIndex}
                  x2={range.toIndex}
                  yAxisId="left"
                  fill={colors.accentSoft}
                  fillOpacity={0.35}
                  stroke="none"
                  ifOverflow="extendDomain"
                  label={
                    range.label
                      ? {
                          value: range.label,
                          position: "insideTop",
                          fill: colors.text,
                          fontSize: 10,
                          fontWeight: 650
                        }
                      : undefined
                  }
                />
              ))}
              <XAxis
                dataKey="x"
                type="category"
                tickFormatter={(value) => preview.labels[Number(value)] ?? ""}
                tick={{ fill: colors.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={tickGap}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: colors.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={40}
                domain={axisDomain("left")}
                label={
                  preview.spec.leftAxisLabel
                    ? {
                        value: preview.spec.leftAxisLabel,
                        angle: -90,
                        position: "insideLeft",
                        fill: colors.text,
                        fontSize: 10,
                        offset: 14
                      }
                    : undefined
                }
              />
              {hasRightAxis ? (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: colors.text, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  domain={axisDomain("right")}
                  label={
                    preview.spec.rightAxisLabel
                      ? {
                          value: preview.spec.rightAxisLabel,
                          angle: 90,
                          position: "insideRight",
                          fill: colors.text,
                          fontSize: 10,
                          offset: 14
                        }
                      : undefined
                  }
                />
              ) : null}
              <Tooltip
                cursor={{ stroke: colors.cursor, strokeWidth: 1 }}
                content={(props) => (
                  <CoachChartTooltip
                    {...props}
                    labels={preview.labels}
                    series={preview.series}
                    palette={palette}
                  />
                )}
                contentStyle={trainingChartTooltipStyle}
              />
              {preview.series.map((entry) => {
                const stroke = palette(entry.color).stroke;
                const yAxisId = entry.axis === "right" && hasRightAxis ? "right" : "left";
                if (entry.kind === "bar") {
                  return (
                    <Bar
                      key={entry.key}
                      dataKey={entry.key}
                      name={entry.label}
                      yAxisId={yAxisId}
                      fill={stroke}
                      fillOpacity={0.55}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                      isAnimationActive={false}
                    />
                  );
                }
                if (entry.kind === "area") {
                  return (
                    <Area
                      key={entry.key}
                      type="monotone"
                      dataKey={entry.key}
                      name={entry.label}
                      yAxisId={yAxisId}
                      stroke={stroke}
                      fill={`url(#${gradientPrefix}-${entry.key})`}
                      strokeWidth={2}
                      strokeDasharray={entry.dashed ? "5 4" : undefined}
                      dot={false}
                      activeDot={activeDot}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                }
                return (
                  <Line
                    key={entry.key}
                    type="monotone"
                    dataKey={entry.key}
                    name={entry.label}
                    yAxisId={yAxisId}
                    stroke={stroke}
                    strokeWidth={2}
                    strokeDasharray={entry.dashed ? "5 4" : undefined}
                    dot={false}
                    activeDot={activeDot}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="chat-visual-empty">No data in this window.</p>
      )}

      {preview.spec.note ? (
        <p className="coach-chart-note">{preview.spec.note}</p>
      ) : null}
    </div>
  );
}
