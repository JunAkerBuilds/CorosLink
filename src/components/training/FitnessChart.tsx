"use client";
import { useId, useState } from "react";
import type { FitnessSeries } from "@/data/training";
import { addDays, dayMonth, shortDay } from "@/lib/calendar";
import { areaPath, barsPath, indexAt, linePath } from "@/lib/chart";
import { signed } from "@/lib/format";

const W = 840;

/**
 * Fitness (42-day) and fatigue (7-day) lines over weekly load bars, with one crosshair across both.
 * The readout in the header follows the pointer, or the arrow keys when the chart has focus.
 */
export function FitnessChart({ series, rangeLabel, title = "Fitness and freshness", height: H = 300, barHeight: BAR_H = 80, children }: {
  series: FitnessSeries; rangeLabel: string; title?: string;
  /** Height of the lines and of the weekly load bars, in px. */
  height?: number; barHeight?: number;
  /** Shown between the header and the chart (the dashboard's figure and form scale). */
  children?: React.ReactNode;
}) {
  const n = series.fitness.length;
  const weeks = series.weeklyLoad;
  const [picked, setPicked] = useState<number | null>(null);
  const readoutId = useId();
  const idx = Math.min(n - 1, picked ?? n - 1);

  // The canvas scale (30 to 90), widened in tens when a longer range goes outside it.
  const all = [...series.fitness, ...series.fatigue];
  const lo = Math.min(30, Math.floor(Math.min(...all) / 10) * 10);
  const hi = Math.max(90, Math.ceil(Math.max(...all) / 10) * 10);

  const slot = W / weeks.length;
  const bar = Math.round(((slot * 5) / 7) * 100) / 100;
  const barMax = Math.max(480, ...weeks);

  const day = addDays(series.start, idx);
  const lastDay = addDays(series.start, n - 1);
  const crossesYears = series.start.slice(0, 4) !== lastDay.slice(0, 4);
  const fit = Math.round(series.fitness[idx]), fat = Math.round(series.fatigue[idx]);
  const cx = n > 1 ? ((idx * W) / (n - 1)).toFixed(1) : "0";
  const cross = { stroke: "rgba(var(--fg-rgb), 0.5)", vectorEffect: "non-scaling-stroke" } as const;

  const first = Math.round(series.fitness[0]), last = Math.round(series.fitness[n - 1]);
  const trend = last > first ? "rising" : last < first ? "falling" : "level";
  const ticks = [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1];

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 7 : 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = idx - step;
    else if (e.key === "ArrowRight") next = idx + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next == null) return;
    e.preventDefault();
    setPicked(Math.max(0, Math.min(n - 1, next)));
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 20px" }}>
        <h2 className="h2">{title}</h2>
        <div id={readoutId} aria-live="polite" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 18px", fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>{shortDay(day, crossesYears)}</span>
          <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 12, height: 3, borderRadius: 2, background: "var(--h-blue)" }} />
            Fitness <strong style={{ color: "var(--fg)" }}>{fit}</strong>
          </span>
          <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span aria-hidden="true" style={{ width: 12, height: 2, borderRadius: 2, background: "var(--h-pink)" }} />
            Fatigue <strong style={{ color: "var(--fg)" }}>{fat}</strong>
          </span>
          <span className="muted">Form <strong style={{ color: "var(--fg)" }}>{signed(fit - fat)}</strong></span>
        </div>
      </div>
      {children}
      <div
        role="group" tabIndex={0} aria-label="Fitness and weekly load chart. Left and right arrow keys move the day shown." aria-describedby={readoutId}
        onMouseMove={(e) => setPicked(indexAt(e.clientX, e.currentTarget.getBoundingClientRect(), n))}
        onMouseLeave={() => setPicked(null)}
        onKeyDown={onKey}
        style={{ display: "flex", flexDirection: "column", gap: 10, cursor: "crosshair", borderRadius: 8 }}
      >
        <svg role="img" aria-label={`Fitness ${trend} from ${first} to ${last} over ${rangeLabel}, with fatigue moving above and below it`}
          width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={`M0 ${H / 4}H${W}M0 ${H / 2}H${W}M0 ${(3 * H) / 4}H${W}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", vectorEffect: "non-scaling-stroke" }} />
          <path d={areaPath(series.fitness, W, H, lo, hi)} style={{ fill: "var(--fit-area)" }} />
          <path d={linePath(series.fatigue, W, H, lo, hi)} fill="none" style={{ stroke: "var(--h-pink)", strokeWidth: 1.5, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
          <path d={linePath(series.fitness, W, H, lo, hi)} fill="none" style={{ stroke: "var(--h-blue)", strokeWidth: 2.5, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
          <line x1={cx} x2={cx} y1="0" y2={H} style={cross} />
        </svg>
        <div className="muted" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
          <span>Weekly load</span><span>{weeks[weeks.length - 1]} so far this week</span>
        </div>
        <svg role="img" aria-label={`Weekly load for ${rangeLabel}, building from ${weeks[0]} to ${Math.max(...weeks)}`}
          width="100%" height={BAR_H} viewBox={`0 0 ${W} ${BAR_H}`} preserveAspectRatio="none">
          <path d={barsPath(weeks, BAR_H, barMax, slot, bar)} style={{ fill: "var(--fit-bars)" }} />
          <line x1={cx} x2={cx} y1="0" y2={BAR_H} style={cross} />
        </svg>
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        {ticks.map((k) => {
          const d = addDays(series.start, k);
          return <span key={k}>{dayMonth(d)}{crossesYears ? ` ${d.slice(0, 4)}` : ""}</span>;
        })}
      </div>
    </>
  );
}
