"use client";
import { useMemo } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { EnergyBandKind, EnergyDay } from "@/data/energy";
import { bandAt, clockOfDay, energyAt } from "@/lib/health";

const W = 980, H = 322, PLOT = 940, TOP = 10, BASE = 270;
const X = (minute: number) => (minute / 1440) * PLOT;
const Y = (level: number) => BASE - (level / 100) * (BASE - TOP);

export const ENERGY_BAND: Record<EnergyBandKind, { name: string; color: string }> = {
  sleep: { name: "Sleep", color: "var(--h-violet)" },
  workout: { name: "Workout", color: "var(--h-mint)" },
  rest: { name: "Rest", color: "var(--h-lime-deep)" },
  stress: { name: "Stress", color: "var(--h-coral)" },
};
const BAND_KINDS = Object.keys(ENERGY_BAND) as EnergyBandKind[];

const axis = { fill: "var(--muted)", fontSize: 11, fontWeight: 500 } as const;

export interface EnergyReading { minute: number; level: number | null; projected: boolean; what: string }

/** What the chart says at a minute of the day: the level (measured, or on the projection to bedtime) and what was going on. */
export function energyReadingAt(day: EnergyDay, minute: number): EnergyReading {
  const band = bandAt(day.bands, minute);
  if (day.now && minute > day.now.minute) {
    const projected = day.bedtime ? energyAt([day.now, day.bedtime], Math.min(minute, day.bedtime.minute)) : null;
    const atBed = day.bedtime != null && minute >= day.bedtime.minute;
    return { minute, level: projected, projected: true, what: atBed ? "Bedtime, projected" : "Projected" };
  }
  return { minute, level: energyAt(day.points, minute), projected: false, what: band ? band.label : "Awake" };
}

/** The minute a pointer or key lands on, kept inside the day (and before bedtime on the current day). */
function clampMinute(day: EnergyDay, m: number): number {
  const last = day.bedtime?.minute ?? 1440;
  return Math.max(0, Math.min(last, Math.round(m / 5) * 5));
}

/**
 * Energy through one day: the level line with its fill and, on the current day, "now" and the dashed projection
 * to bedtime. A strip under it marks sleep, workouts, rest and stress. Hover, touch or the arrow keys pick a minute;
 * the page shows the readout above the chart.
 */
export function EnergyDayChart({ day, minute, onMinute }: { day: EnergyDay; minute: number; onMinute: (m: number | null) => void }) {
  const shapes = useMemo(() => {
    const line = day.points.map((p, i) => `${i ? "L" : "M"}${X(p.minute).toFixed(1)} ${Y(p.level).toFixed(1)}`).join(" ");
    const first = day.points[0], last = day.points[day.points.length - 1];
    const area = first && last ? `${line} L${X(last.minute).toFixed(1)} ${BASE} L${X(first.minute).toFixed(1)} ${BASE} Z` : "";
    const strips = BAND_KINDS.map((kind) => ({
      kind,
      d: day.bands.filter((b) => b.kind === kind && (!day.now || b.from < day.now.minute)).map((b) => {
        const x = X(b.from) + 1, w = Math.max(10, X(b.to) - X(b.from) - 2);
        return `M${(x + 5).toFixed(1)} 286h${(w - 10).toFixed(1)}a5 5 0 0 1 0 10h-${(w - 10).toFixed(1)}a5 5 0 0 1 0 -10z`;
      }).join(" "),
    }));
    return { line, area, strips };
  }, [day]);

  const label = useMemo(() => {
    const parts = [`Energy through the day${day.woke ? `: woke at ${day.woke.level} at ${clockOfDay(day.woke.minute)}` : ""}`, `lowest ${day.low}`, `highest ${day.high}`];
    if (day.now) parts.push(`${day.now.level} now`);
    if (day.bedtime) parts.push(`with a dashed projection to ${day.bedtime.level} by bedtime`);
    return `${parts.join(", ")}. Below it, a strip marks sleep, workouts, rest and stress.`;
  }, [day]);

  const reading = energyReadingAt(day, minute);
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    onMinute(clampMinute(day, (((e.clientX - r.left) / r.width) * W / PLOT) * 1440));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 60 : 15;
    let next: number | null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = minute - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = minute + step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1440;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    onMinute(next == null ? null : clampMinute(day, next));
  };

  const now = day.now, bed = day.bedtime;
  const nowX = now ? X(now.minute).toFixed(1) : null;
  const cx = X(reading.minute).toFixed(1);
  const cy = reading.level != null ? Y(reading.level).toFixed(1) : null;
  const readout = `${clockOfDay(reading.minute)} · ${reading.level != null ? `${reading.projected ? "about " : ""}${Math.round(reading.level)}` : "no reading"} · ${reading.what}`;

  return (
    <div style={{ position: "relative" }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}>
        <path d={`M0 ${TOP}H${PLOT}M0 140H${PLOT}M0 ${BASE}H${PLOT}`} fill="none" style={{ stroke: "var(--line)" }} />
        <text x="948" y="14" style={axis}>100</text>
        <text x="948" y="144" style={axis}>50</text>
        <text x="948" y="274" style={axis}>0</text>
        <path d={shapes.area} style={{ fill: "var(--h-lime-deep)", opacity: 0.16 }} />
        {now && bed ? (
          <>
            <path d={`M${nowX} ${Y(now.level).toFixed(1)} L${X(bed.minute).toFixed(1)} ${Y(bed.level).toFixed(1)} V${BASE} H${nowX} Z`} style={{ fill: "var(--h-lime-deep)", opacity: 0.06 }} />
            <path d={`M${nowX} ${Y(now.level).toFixed(1)} L${X(bed.minute).toFixed(1)} ${Y(bed.level).toFixed(1)}`} fill="none"
              style={{ stroke: "var(--h-lime-deep)", strokeWidth: 2, strokeDasharray: "3 6", strokeLinecap: "round", opacity: 0.7 }} />
          </>
        ) : null}
        <path d={shapes.line} fill="none" style={{ stroke: "var(--h-lime-deep)", strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" }} />
        {nowX ? (
          <>
            <path d={`M${nowX} ${TOP}V${BASE}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.22)", strokeDasharray: "2 4" }} />
            <text x={nowX} y="6" style={{ ...axis, fontWeight: 600, textAnchor: "middle" }}>Now</text>
          </>
        ) : null}
        <path d={`M0 291H${PLOT}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.1)", strokeWidth: 10, strokeLinecap: "round", opacity: 0.5 }} />
        {shapes.strips.map((s) => s.d ? <path key={s.kind} className="energy-strip" d={s.d} style={{ fill: ENERGY_BAND[s.kind].color }} /> : null)}
        <path d={`M${cx} ${TOP}V${BASE}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.55)" }} />
        {cy ? (
          <>
            <circle cx={cx} cy={cy} r="10" style={{ fill: "var(--h-lime-deep)", opacity: 0.28 }} />
            <circle cx={cx} cy={cy} r="5.5" style={{ fill: "var(--h-lime-deep)", stroke: "var(--inset)", strokeWidth: 2 }} />
          </>
        ) : null}
        <text x="0" y="318" style={axis}>00:00</text>
        <text x="235" y="318" style={{ ...axis, textAnchor: "middle" }}>06:00</text>
        <text x="470" y="318" style={{ ...axis, textAnchor: "middle" }}>12:00</text>
        <text x="705" y="318" style={{ ...axis, textAnchor: "middle" }}>18:00</text>
        <text x="940" y="318" style={{ ...axis, textAnchor: "end" }}>24:00</text>
      </svg>
      <div
        className="chart-hit" role="slider" tabIndex={0} aria-label="Time of day" aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={1440} aria-valuenow={minute} aria-valuetext={readout}
        onPointerMove={point} onPointerDown={point} onPointerLeave={() => onMinute(null)} onBlur={() => onMinute(null)} onKeyDown={key}
      />
    </div>
  );
}
