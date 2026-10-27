import { t, useLanguage, getLocale } from "../i18n/tools";
import { useMemo } from "react";
import { Pin, PinOff, RefreshCw, Sparkles } from "lucide-react";
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
import {
  coachChartFreshness,
  formatRelativeTime,
  freshnessHint,
  freshnessLabel
} from "./coachChartFreshness";
import "./coachChart.css";

export interface CoachChartCardProps {
  preview: CoachChartPreview;
  /** "chat" renders inside a chat bubble; "panel" is the Training Hub tile. */
  variant?: "chat" | "panel";
  pinned?: boolean;
  /** A pin with this chart's title already exists, so pinning updates it in place. */
  replaces?: boolean;
  busy?: boolean;
  /** One-line confirmation shown under the header after pinning. */
  notice?: string | null;
  onPin?: () => void;
  onUnpin?: () => void;
  onRefresh?: () => void;
  /** Asks Coach to rebuild a snapshot chart with bound metrics. */
  onMakeLive?: () => void;
  /** Panel only: names the source in the status line when the card is the whole widget. */
  eyebrow?: string;
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
  if (preview.times) {
    const days = preview.window?.days ?? 1;
    return days > 1
      ? t("Last {{p0}} days · {{p1}} – {{p2}}", { p0: days, p1: first, p2: last })
      : t("Today · {{p0}} – {{p1}}", { p0: first, p1: last });
  }
  if (preview.dates) {
    return t("Last {{p0}} days · {{p1}} – {{p2}}", { p0: count, p1: first, p2: last });
  }
  return `${first} – ${last}`;
}

function formatResolvedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
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
  useLanguage();
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
  replaces = false,
  busy = false,
  notice = null,
  onPin,
  onUnpin,
  onRefresh,
  onMakeLive,
  eyebrow
}: CoachChartCardProps) {
  const { language } = useLanguage();
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
    [preview, language]
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

  const freshness = coachChartFreshness(preview);
  const subtitle = preview.spec.subtitle ?? formatWindow(preview);
  const isPanel = variant === "panel";
  // On the dashboard, freshness and age share one quiet line above the title
  // ("Live · 5 min ago", "Snapshot · Oct 13") instead of a badge plus a stamp.
  const statusTime =
    isPanel && preview.resolvedAt
      ? freshness === "snapshot"
        ? formatResolvedAt(preview.resolvedAt)
        : formatRelativeTime(preview.resolvedAt, new Date(), getLocale())
      : "";
  const showMakeLive = Boolean(onMakeLive) && freshness !== "live";
  const showRefresh = Boolean(onRefresh) && freshness !== "snapshot";

  return (
    <div
      className={`chat-visual-card coach-chart-card coach-chart-card-${variant} is-${freshness}`}
    >
      <div className="chat-visual-card-header">
        <div className="coach-chart-heading">
          {isPanel ? (
            <p className="coach-chart-kicker">
              {eyebrow ? <span>{eyebrow}</span> : null}
              <span
                className={`coach-chart-status is-${freshness}`}
                title={freshnessHint(freshness)}
              >
                <i aria-hidden="true" />
                {freshnessLabel(freshness)}
              </span>
              {statusTime ? <span>{statusTime}</span> : null}
            </p>
          ) : null}
          <h4>
            {preview.spec.title}
            {isPanel ? null : (
              <span
                className={`coach-chart-freshness is-${freshness}`}
                title={freshnessHint(freshness)}
              >
                <i aria-hidden="true" />
                {freshnessLabel(freshness)}
              </span>
            )}
          </h4>
          <span className="chat-visual-card-subtitle">{subtitle}</span>
        </div>
        {onPin || onUnpin || showRefresh || showMakeLive ? (
          <div className="coach-chart-actions">
            {showMakeLive ? (
              <button
                type="button"
                className="coach-chart-action is-make-live"
                onClick={onMakeLive}
                disabled={busy}
                title={t("Ask Coach to rebuild this chart from your data so it refreshes itself")}
              >
                <Sparkles size={13} aria-hidden="true" />
                <span>{t("Make live")}</span>
              </button>
            ) : null}
            {/* Live charts refresh themselves, so the manual refresh stays an icon. */}
            {showRefresh ? (
              <button
                type="button"
                className="coach-chart-action is-icon"
                onClick={onRefresh}
                disabled={busy}
                aria-label={t("Refresh")}
                title={t("Refresh with the latest data")}
              >
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className={busy ? "is-spinning" : undefined}
                />
              </button>
            ) : null}
            {pinned && onUnpin ? (
              isPanel ? (
                <button
                  type="button"
                  className="coach-chart-action is-icon"
                  onClick={onUnpin}
                  disabled={busy}
                  aria-label={t("Unpin")}
                  title={t("Remove from Training Hub")}
                >
                  <PinOff size={14} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className="coach-chart-action is-pinned"
                  onClick={onUnpin}
                  disabled={busy}
                  title={t("On your Training Hub dashboard under Coach charts. Click to unpin.")}
                >
                  <PinOff size={13} aria-hidden="true" />
                  <span>{t("Pinned")}</span>
                </button>
              )
            ) : onPin ? (
              <button
                type="button"
                className="coach-chart-action"
                onClick={onPin}
                disabled={busy}
                title={
                  replaces
                    ? t("Replace the pinned chart that has this title")
                    : t("Keep this chart on the Training Hub")
                }
              >
                <Pin size={13} aria-hidden="true" />
                <span>{replaces ? t("Update pin") : t("Pin to Training Hub")}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="coach-chart-pin-note" role="status">
          {notice}
        </p>
      ) : null}

      {preview.tiles.length > 0 ? (
        <div className="coach-chart-tiles">
          {preview.tiles.map((tile, index) => (
            <div
              key={`${tile.label}-${index}`}
              className={`coach-chart-tile${tile.metric ? " is-bound" : ""}`}
            >
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
              : t("Highlighted block")}
          </li>
        ) : null}
      </ul>

      {hasData ? (
        <div className="coach-chart-shell">
          {/* The plot fills the shell absolutely so a panel card can grow it to the widget's height. */}
          <div className="coach-chart-plot">
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
                  // A rotated axis title needs its own lane beside the tick numbers.
                  width={preview.spec.leftAxisLabel ? 52 : 40}
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
                    width={preview.spec.rightAxisLabel ? 52 : 40}
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
        </div>
      ) : (
        <p className="chat-visual-empty">{t("No data in this window.")}</p>
      )}

      {preview.spec.note ? (
        <p className="coach-chart-note">{preview.spec.note}</p>
      ) : null}
    </div>
  );
}
