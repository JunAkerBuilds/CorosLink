"use client";
import { useState } from "react";

export interface EnergyRangeDay {
  key: string;
  /** Under the bar ("Mon", "Today"); empty to leave the slot unlabelled. */
  label: string;
  /** Read out on hover and to screen readers ("Mon 16 Nov"). */
  title: string;
  low: number;
  high: number;
  /** Null when the day has no waking level: no dot. */
  waking: number | null;
}

const TOP = 10, BASE = 220;
const y = (level: number) => BASE - (level / 100) * (BASE - TOP);

/**
 * One capsule per day from that day's lowest to highest energy, with a dot at the waking level.
 * The picked day is solid, the others faint. Each day is a button that picks it.
 */
export function EnergyRangeBars({ days, selected, onSelect, width = 420, label, compact }: {
  days: readonly EnergyRangeDay[];
  /** Key of the picked day. */
  selected: string;
  onSelect: (key: string) => void;
  /** viewBox width; the height is 250, or 232 when compact. */
  width?: number;
  label: string;
  /** Leave the day names out of the drawing (the page puts its own under it). */
  compact?: boolean;
}) {
  const H = compact ? 232 : 250;
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, days.length);
  const slot = width / n;
  const bar = Math.min(24, slot * 0.5);

  const capsule = (d: EnergyRangeDay, i: number) => {
    const x = i * slot + (slot - bar) / 2;
    const top = y(d.high);
    const h = Math.max(bar, y(d.low) - top);
    const r = bar / 2;
    return `M${x.toFixed(1)} ${(top + r).toFixed(1)}a${r} ${r} 0 0 1 ${bar} 0v${(h - bar).toFixed(1)}a${r} ${r} 0 0 1 -${bar} 0z`;
  };
  const dotR = Math.min(4, bar / 3);
  const dot = (d: EnergyRangeDay, i: number) => {
    if (d.waking == null) return "";
    const cx = i * slot + slot / 2;
    return `M${(cx - dotR).toFixed(1)} ${y(d.waking).toFixed(1)}a${dotR} ${dotR} 0 1 0 ${2 * dotR} 0a${dotR} ${dotR} 0 1 0 -${2 * dotR} 0z`;
  };
  const describe = (d: EnergyRangeDay) => `${d.title} · ${d.low} to ${d.high}${d.waking != null ? ` · woke at ${d.waking}` : ""}`;
  const shown = hover != null ? days[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
        <path d={`M0 ${TOP}H${width}M0 115H${width}M0 ${BASE}H${width}`} fill="none" style={{ stroke: "var(--line)" }} />
        <path d={days.filter((d) => d.key !== selected).map((d) => capsule(d, days.indexOf(d))).join(" ")} fill="rgba(184,227,90,0.32)" />
        <path d={days.filter((d) => d.key === selected).map((d) => capsule(d, days.indexOf(d))).join(" ")} style={{ fill: "var(--h-lime-deep)" }} />
        <path d={days.map(dot).join(" ")} style={{ fill: "var(--fg)" }} />
        {days.map((d, i) => d.label && !compact ? (
          <text key={d.key} x={(i * slot + slot / 2).toFixed(1)} y="244" style={{
            fill: d.key === selected ? "var(--fg)" : "var(--muted)", fontSize: 11, fontWeight: d.key === selected ? 700 : 500, textAnchor: "middle",
          }}>{d.label}</text>
        ) : null)}
      </svg>
      <div className="energy-days" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {days.map((d, i) => (
          <button
            key={d.key} type="button" aria-pressed={d.key === selected} aria-label={describe(d)}
            onClick={() => onSelect(d.key)}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)} onBlur={() => setHover((h) => (h === i ? null : h))}
          />
        ))}
      </div>
      {shown && hover != null ? (
        <div className="tip energy-tip" aria-hidden="true" style={{ left: `clamp(92px, ${(((hover + 0.5) / n) * 100).toFixed(2)}%, calc(100% - 92px))` }}>
          <span style={{ fontWeight: 700 }}>{describe(shown)}</span>
        </div>
      ) : null}
    </div>
  );
}
