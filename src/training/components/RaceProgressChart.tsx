import { t, useLanguage, getLocale } from "../../i18n/training";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatRaceDate, formatRaceTime } from "../raceFormat";

export interface RaceChartPoint {
  raceId: string;
  /** Epoch seconds. */
  startTime: number;
  /** Seconds plotted: the finish time, or its 5K equivalent. */
  value: number;
  name: string;
  /** Secondary tooltip line, for example "Half Marathon · 1:45:15". */
  detail: string;
  isBest: boolean;
  /** Set a personal best on the day: drawn gold, so the chart shows each step down. */
  isPb?: boolean;
}

interface RaceProgressChartProps {
  points: RaceChartPoint[];
  /** Names the plotted value for screen readers, for example "5K finish time". */
  valueLabel: string;
  selectedId?: string | null;
  onSelect?: (raceId: string) => void;
  /** Series colour, a CSS colour or variable; the selected distance's colour. */
  color?: string;
}

const HEIGHT = 236;
const MARGIN = { top: 26, right: 28, bottom: 30, left: 62 };
const TIME_STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600, 7200];
const DAY = 86_400;

function niceTicks(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 1);
  const step = TIME_STEPS.find((candidate) => span / candidate <= 4) ?? 7200;
  const first = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= hi; value += step) ticks.push(value);
  return ticks;
}

/** Month starts across the span, thinned to at most `max` labels. */
function dateTicks(lo: number, hi: number, max: number): { value: number; label: string }[] {
  const start = new Date(lo * 1000);
  const end = new Date(hi * 1000);
  const months: Date[] = [];
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    months.push(cursor);
  }
  const spanYears = (hi - lo) / (365 * DAY);
  const yearsOnly = spanYears > 3;
  const candidates = yearsOnly ? months.filter((month) => month.getMonth() === 0) : months;
  const stride = Math.max(1, Math.ceil(candidates.length / max));
  // Past a year every month carries its year, as "Jun ’24" so it never reads as a day.
  const label = (month: Date) => {
    const name = month.toLocaleDateString(getLocale(), { month: "short" });
    return spanYears > 1 ? `${name} ’${String(month.getFullYear()).slice(-2)}` : name;
  };
  return candidates
    .filter((_, index) => index % stride === 0)
    .map((month) => ({
      value: month.getTime() / 1000,
      label: yearsOnly ? String(month.getFullYear()) : label(month)
    }));
}

/** Calendar years crossing the domain, for the alternating bands behind the plot. */
function yearBands(lo: number, hi: number): { year: number; from: number; to: number }[] {
  const bands = [];
  for (let year = new Date(lo * 1000).getFullYear(); year <= new Date(hi * 1000).getFullYear(); year += 1) {
    const from = Math.max(lo, new Date(year, 0, 1).getTime() / 1000);
    const to = Math.min(hi, new Date(year + 1, 0, 1).getTime() / 1000);
    if (to > from) bands.push({ year, from, to });
  }
  return bands;
}

export function RaceProgressChart({ points, valueLabel, selectedId, onSelect, color }: RaceProgressChartProps) {
  useLanguage();
  // React ids carry ":" or "«»", which a url(#…) reference would need escaped.
  const gradientId = `race-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.startTime - b.startTime);
    if (sorted.length === 0) return null;
    let xLo = sorted[0].startTime;
    let xHi = sorted[sorted.length - 1].startTime;
    if (xHi - xLo < 60 * DAY) {
      const middle = (xLo + xHi) / 2;
      xLo = middle - 45 * DAY;
      xHi = middle + 45 * DAY;
    }
    const xPad = (xHi - xLo) * 0.04;
    xLo -= xPad;
    xHi += xPad;
    const values = sorted.map((point) => point.value);
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const vPad = Math.max((vMax - vMin) * 0.18, 20);
    const yLo = vMin - vPad;
    const yHi = vMax + vPad;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + ((time - xLo) / (xHi - xLo)) * plotWidth;
    // Faster is higher: the smallest time sits at the top of the plot.
    const y = (value: number) => MARGIN.top + ((value - yLo) / (yHi - yLo)) * plotHeight;
    return {
      sorted,
      x,
      y,
      yTicks: niceTicks(yLo, yHi),
      xTicks: dateTicks(xLo, xHi, Math.max(2, Math.floor(plotWidth / 110))),
      // Year bands only help once the history crosses a new year.
      bands: new Date(xLo * 1000).getFullYear() !== new Date(xHi * 1000).getFullYear() ? yearBands(xLo, xHi) : [],
      plotWidth,
      plotHeight
    };
  }, [points, width, getLocale()]);

  if (!chart) return null;
  const { sorted, x, y, yTicks, xTicks, bands, plotHeight } = chart;
  const floor = MARGIN.top + plotHeight;
  const latest = sorted[sorted.length - 1];
  const best = sorted.find((point) => point.isBest);
  const active = sorted.find((point) => point.raceId === hovered);
  const path = sorted.map((point, index) => `${index ? "L" : "M"}${x(point.startTime)},${y(point.value)}`).join(" ");

  return (
    <div className="race-chart" ref={wrapRef}>
      <svg
        className="race-chart-svg"
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="group"
        aria-label={t("{{p0}} over time, faster results higher", { p0: String(valueLabel) })}
        style={color ? ({ "--race-series": color } as CSSProperties) : undefined}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="race-chart-wash-top" />
            <stop offset="100%" className="race-chart-wash-bottom" />
          </linearGradient>
        </defs>
        {bands.map((band, index) => (
          <g key={band.year}>
            {index % 2 === 1 ? (
              <rect
                className="race-chart-band"
                x={x(band.from)}
                y={MARGIN.top}
                width={x(band.to) - x(band.from)}
                height={plotHeight}
              />
            ) : null}
            {x(band.to) - x(band.from) > 44 ? (
              <text className="race-chart-year" x={x(band.from) + 8} y={MARGIN.top + 14}>
                {band.year}
              </text>
            ) : null}
          </g>
        ))}
        <text className="race-chart-axis-note" x={MARGIN.left - 10} y={MARGIN.top - 12} textAnchor="end">{t("Faster ↑")}</text>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="race-chart-grid"
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="race-chart-tick" x={MARGIN.left - 10} y={y(tick)} dy="0.32em" textAnchor="end">
              {formatRaceTime(tick)}
            </text>
          </g>
        ))}
        <line
          className="race-chart-baseline"
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={MARGIN.top + plotHeight}
          y2={MARGIN.top + plotHeight}
        />
        {xTicks.map((tick) => (
          <text
            key={tick.value}
            className="race-chart-tick"
            x={x(tick.value)}
            y={HEIGHT - 8}
            textAnchor="middle"
          >
            {tick.label}
          </text>
        ))}
        {sorted.length > 1 ? (
          <path
            className="race-chart-wash"
            d={`${path} L${x(latest.startTime)},${floor} L${x(sorted[0].startTime)},${floor} Z`}
            fill={`url(#${gradientId})`}
          />
        ) : null}
        {sorted.length > 1 ? <path className="race-chart-line" d={path} /> : null}
        {sorted.map((point) => {
          const cx = x(point.startTime);
          const cy = y(point.value);
          const selected = point.raceId === selectedId;
          return (
            <g
              key={point.raceId}
              className={`race-chart-point${point.isBest ? " is-best" : point.isPb ? " is-pb" : ""}${selected ? " is-selected" : ""}${
                point.raceId === hovered ? " is-hovered" : ""
              }`}
              tabIndex={0}
              role="button"
              aria-label={`${point.name}, ${formatRaceDate(point.startTime)}: ${formatRaceTime(point.value)}${
                point.isBest ? ", best" : ""
              }`}
              onPointerEnter={() => setHovered(point.raceId)}
              onPointerLeave={() => setHovered((current) => (current === point.raceId ? null : current))}
              onFocus={() => setHovered(point.raceId)}
              onBlur={() => setHovered((current) => (current === point.raceId ? null : current))}
              onClick={() => onSelect?.(point.raceId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(point.raceId);
                }
              }}
            >
              <circle className="race-chart-hit" cx={cx} cy={cy} r={14} />
              <circle className="race-chart-dot" cx={cx} cy={cy} r={point.isBest ? 5.5 : 4.5} />
            </g>
          );
        })}
        {best ? (
          <text
            className="race-chart-label is-best"
            x={x(best.startTime)}
            y={y(best.value) - 13}
            textAnchor={x(best.startTime) > width - 90 ? "end" : x(best.startTime) < MARGIN.left + 40 ? "start" : "middle"}
          >{t("Best {{p0}}", { p0: String(formatRaceTime(best.value)) })}</text>
        ) : null}
        {latest && latest !== best && sorted.length > 1 ? (
          <text
            className="race-chart-label"
            x={x(latest.startTime)}
            y={y(latest.value) + 22}
            textAnchor={x(latest.startTime) > width - 90 ? "end" : "middle"}
          >
            {formatRaceTime(latest.value)}
          </text>
        ) : null}
      </svg>
      {active ? (
        <div
          className="race-chart-tooltip"
          role="presentation"
          style={{
            left: Math.min(Math.max(x(active.startTime), 96), width - 96),
            top: y(active.value)
          }}
        >
          <strong>{formatRaceTime(active.value)}</strong>
          <span>{active.name}</span>
          <small>
            {formatRaceDate(active.startTime)} · {active.detail}
          </small>
        </div>
      ) : null}
    </div>
  );
}
