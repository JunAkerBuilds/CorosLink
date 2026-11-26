"use client";
import { useMemo } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { indexAt } from "@/lib/chart";
import { gapLinePath, present, trendScale } from "@/lib/health";
import { t } from "@/lib/i18n";

/** Horizontal padding of the card, so the pointer maps onto the plot and not the card edge. */
const PAD = 18;
const H = 90;

/**
 * One trend card: name and the picked day's value, a line across the range with a crosshair on the picked day,
 * then first day, average and last day. Several of these share one `index`, so hovering any of them moves all.
 */
export function HealthTrendChart({ name, values, color, index, onIndex, valueText, averageText, fromLabel, toLabel, pickedLabel }: {
  name: string;
  /** One per day; null where the day has no reading (the line breaks there). */
  values: readonly (number | null)[];
  /** Line colour, a hue token such as var(--h-cyan). */
  color: string;
  /** Picked day, 0…values.length-1. */
  index: number;
  onIndex: (index: number) => void;
  valueText: string;
  averageText: string;
  fromLabel: string;
  toLabel: string;
  /** The picked day, for screen readers ("Thu 19 Nov"). */
  pickedLabel: string;
}) {
  const n = values.length;
  const w = Math.max(1, (n - 1) * 10);
  const d = useMemo(() => {
    const [min, max] = trendScale(present(values));
    return gapLinePath(values, w, H, min, max);
  }, [values, w]);

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onIndex(indexAt(e.clientX, { left: r.left + PAD, width: r.width - 2 * PAD }, n));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 7 : 1;
    let next = index;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = index - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = index + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End" || e.key === "Escape") next = n - 1;
    else return;
    e.preventDefault();
    onIndex(Math.max(0, Math.min(n - 1, next)));
  };

  return (
    <div
      className="card health-trend" role="slider" tabIndex={0}
      aria-label={t("{name}, {from} to {to}", { name, from: fromLabel, to: toLabel })} aria-orientation="horizontal"
      aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={index} aria-valuetext={`${pickedLabel}: ${valueText}`}
      onPointerMove={point} onPointerDown={point} onKeyDown={key}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span className="muted" style={{ fontSize: 13 }}>{name}</span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{valueText}</span>
      </div>
      <svg aria-hidden="true" width="100%" height={H} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <path d={`M0 45H${w}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.06)", vectorEffect: "non-scaling-stroke" }} />
        <path d={d} fill="none" style={{ stroke: color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round", vectorEffect: "non-scaling-stroke" }} />
        <line x1={index * 10} x2={index * 10} y1={0} y2={H} style={{ stroke: "rgba(var(--fg-rgb), 0.5)", vectorEffect: "non-scaling-stroke" }} />
      </svg>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
        <span>{fromLabel}</span><span>{averageText}</span><span>{toLabel}</span>
      </div>
    </div>
  );
}
