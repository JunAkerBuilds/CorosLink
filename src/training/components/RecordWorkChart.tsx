import { t, useLanguage, getLocale } from "../../i18n/training";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkBucket } from "../hallOfBests";
import {
  SPORT_COLOR_CATEGORIES,
  SPORT_COLOR_LABELS,
  type SportColorCategory
} from "../sportColors";

interface RecordWorkChartProps {
  unit: "week" | "month";
  buckets: WorkBucket[];
  /** Records set within each bucket, keyed by the bucket's start. */
  medals: Map<number, string[]>;
}

const MIN_HEIGHT = 248;
const MARGIN = { top: 34, right: 20, bottom: 30, left: 44 };
const HOUR_STEPS = [0.5, 1, 2, 3, 4, 5, 10, 20, 50];

/** Stack order, bottom up: the main sports first. */
const STACK: SportColorCategory[] = ["run", "trail", "bike", "strength", "other"];

export function formatHours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

function bucketLabel(start: number, unit: "week" | "month", withYear = false): string {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    ...(unit === "week" ? { day: "numeric" } : {}),
    ...(withYear ? { year: "numeric" } : {})
  }).format(new Date(start));
}

export function RecordWorkChart({ unit, buckets, medals }: RecordWorkChartProps) {
  useLanguage();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  // The plot fills its frame when the column beside it is taller.
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.round(entry.contentRect.width)));
      setHeight(Math.max(MIN_HEIGHT, Math.round(entry.contentRect.height)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (buckets.length === 0) return null;
    const maxHours = Math.max(...buckets.map((bucket) => bucket.total / 3600), 0.5);
    const step = HOUR_STEPS.find((candidate) => maxHours / candidate <= 4) ?? 100;
    const top = Math.ceil((maxHours * 1.08) / step) * step;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const band = plotWidth / buckets.length;
    const barWidth = Math.max(4, Math.min(34, band * 0.62));
    const y = (hours: number) => MARGIN.top + plotHeight - (hours / top) * plotHeight;
    const ticks: number[] = [];
    for (let value = 0; value <= top + 1e-9; value += step) ticks.push(value);
    // Thin the axis labels so they never collide.
    const labelEvery = Math.max(1, Math.ceil(56 / band));
    return { band, barWidth, y, ticks, plotHeight, labelEvery };
  }, [buckets, width, height]);

  if (!chart) return null;
  const { band, barWidth, y, ticks, plotHeight, labelEvery } = chart;
  const floor = MARGIN.top + plotHeight;
  const present = SPORT_COLOR_CATEGORIES.filter((category) =>
    buckets.some((bucket) => bucket.seconds[category] > 0)
  );
  const active = hovered === null ? null : (buckets[hovered] ?? null);
  const activeMedals = active ? (medals.get(active.start) ?? []) : [];
  const centre = (index: number) => MARGIN.left + band * index + band / 2;

  return (
    <div className="pr-work">
      <ul className="pr-chart-legend pr-work-legend">
        {present.map((category) => (
          <li key={category}>
            <i
              className="is-sport"
              style={{ background: `var(--sport-${category})` }}
              aria-hidden="true"
            />
            {t(SPORT_COLOR_LABELS[category])}
          </li>
        ))}
        <li>
          <i className="is-medal" aria-hidden="true" />
          {t("Records set")}</li>
      </ul>
      <div className="pr-chart" ref={wrapRef}>
        <svg
          className="pr-chart-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={unit === "week"
            ? t("Training time per week, with record-setting weeks marked")
            : t("Training time per month, with record-setting months marked")}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "pr-chart-baseline" : "pr-chart-grid"}
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="pr-chart-tick"
                x={MARGIN.left - 10}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {tick === 0 ? "0" : `${tick}h`}
              </text>
            </g>
          ))}

          {buckets.map((bucket, index) => {
            const records = medals.get(bucket.start) ?? [];
            const x = centre(index) - barWidth / 2;
            let base = 0;
            const segments = STACK.filter((category) => bucket.seconds[category] > 0).map(
              (category) => {
                const hours = bucket.seconds[category] / 3600;
                const segment = { category, from: base, to: base + hours };
                base += hours;
                return segment;
              }
            );
            const topY = y(bucket.total / 3600);
            return (
              <g
                key={bucket.start}
                className={`pr-work-bucket${records.length ? " has-medal" : ""}${
                  hovered === index ? " is-hovered" : ""
                }`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
              >
                {records.length ? (
                  <rect
                    className="pr-work-glory"
                    x={MARGIN.left + band * index + 2}
                    y={MARGIN.top - 8}
                    width={band - 4}
                    height={plotHeight + 8}
                    rx={6}
                  />
                ) : null}
                <rect
                  className="pr-work-hit"
                  x={MARGIN.left + band * index}
                  y={MARGIN.top - 20}
                  width={band}
                  height={plotHeight + 20}
                />
                {segments.map((segment, segmentIndex) => (
                  <rect
                    key={segment.category}
                    className="pr-work-bar"
                    x={x}
                    y={y(segment.to)}
                    width={barWidth}
                    height={Math.max(0, y(segment.from) - y(segment.to))}
                    rx={segmentIndex === segments.length - 1 ? Math.min(4, barWidth / 3) : 0}
                    style={{ fill: `var(--sport-${segment.category})` }}
                  />
                ))}
                {records.length ? (
                  <g
                    className="pr-work-medal"
                    transform={`translate(${centre(index)}, ${Math.min(topY, floor) - 16})`}
                  >
                    <circle r={10} />
                    <text dy="0.35em" textAnchor="middle">
                      {records.length}
                    </text>
                  </g>
                ) : null}
                {index % labelEvery === 0 ? (
                  <text
                    className="pr-chart-tick is-distance"
                    x={centre(index)}
                    y={height - 9}
                    textAnchor="middle"
                  >
                    {bucketLabel(bucket.start, unit)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {active ? (
          <div
            className="pr-chart-tooltip"
            role="presentation"
            style={{
              left: Math.min(Math.max(centre(hovered!), 100), width - 100),
              top: Math.min(y(active.total / 3600), floor) - (activeMedals.length ? 28 : 6)
            }}
          >
            <span className="pr-chart-tooltip-series">
              {unit === "week" ? t("Week of ") : ""}
              {bucketLabel(active.start, unit, true)}
            </span>
            <strong>{active.total > 0 ? formatHours(active.total) : t("Rest")}</strong>
            <small>
              {active.count} {active.count === 1 ? t("session") : t("sessions")}
            </small>
            {activeMedals.length ? (
              <small className="pr-work-tooltip-medals">
                {activeMedals.length === 1 ? t("Record: ") : t("{{p0}} records: ", { p0: String(activeMedals.length) })}
                {activeMedals.join(", ")}
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
