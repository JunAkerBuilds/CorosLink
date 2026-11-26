"use client";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { indexAt } from "@/lib/chart";
import { parseDay } from "@/lib/format";
import { language, locale, t } from "@/lib/i18n";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const W = 700, H = 150;

function dayLabel(firstDay: string, index: number): string {
  const d = parseDay(firstDay);
  d.setDate(d.getDate() + index);
  return language() === "en" ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** Battery level, one reading a day. Hover, or focus and use the arrow keys, to read a day. */
export function BatteryChart({ levels, firstDay, alt }: { levels: number[]; firstDay: string; alt: string }) {
  const [at, setAt] = useState<number | null>(null);
  const n = levels.length;
  const line = levels.map((v, i) => `${i ? "L" : "M"}${((i * W) / (n - 1)).toFixed(1)} ${(H - (v / 100) * H).toFixed(1)}`).join(" ");
  // A short history lands several ticks on the same day: each day is labelled once.
  const ticks = [...new Set([0, Math.round((n - 1) * 0.31), Math.round((n - 1) * 0.62), n - 1])];

  const onMove = (e: PointerEvent<HTMLDivElement>) => setAt(indexAt(e.clientX, e.currentTarget.getBoundingClientRect(), n));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setAt((i) => Math.min(n - 1, (i ?? -1) + 1));
    else if (e.key === "ArrowLeft") setAt((i) => Math.max(0, (i ?? n) - 1));
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };
  const x = at === null ? 0 : (at / (n - 1)) * 100;

  return (
    <>
      <div className="wa-batt" tabIndex={0} role="group" aria-label={t("Battery level by day. Arrow keys read each day.")} onPointerMove={onMove} onPointerLeave={() => setAt(null)} onKeyDown={onKeyDown} onBlur={() => setAt(null)}>
        <svg role="img" aria-label={alt} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d="M0 37.5H700M0 75H700M0 112.5H700" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", vectorEffect: "non-scaling-stroke" }} />
          <path d={`${line} L${W} ${H} L0 ${H} Z`} style={{ fill: "rgba(83, 203, 161, 0.12)" }} />
          <path d={line} fill="none" style={{ stroke: "var(--h-mint)", strokeWidth: 2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
        </svg>
        {at !== null ? (
          <>
            <span className="wa-batt-mark" style={{ left: `${x}%` }} />
            <span className="wa-batt-dot" style={{ left: `${x}%`, top: `${100 - levels[at]}%` }} />
            <span className="tip" role="status" style={{ left: `clamp(48px, ${x}%, calc(100% - 48px))` }}>{dayLabel(firstDay, at)} · {levels[at]}%</span>
          </>
        ) : null}
      </div>
      <div className="wa-batt-axis" aria-hidden="true">
        {ticks.map((i) => <span key={i}>{dayLabel(firstDay, i)}</span>)}
      </div>
    </>
  );
}
