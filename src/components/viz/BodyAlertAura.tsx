"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { LOOK_HUE, SIGNALS, toneHue, type Look, type SignalName } from "@/lib/bodyAlert";

/*
  Body Alert's aura, drawn like the phone's BodyAlertAura (BodyAlertArt.swift): a soft blob that breathes about twelve
  times a minute, with a lobe for each signal (heart at the top, HRV lower right, breathing lower left). Where a signal
  is off its lobe swells and pools with that signal's colour. Two halos, a body lit from the top left, colour turning
  inside it, a bounce light, the rim, two highlights, nine motes in orbit and, while learning, fourteen beads.
  It holds still for people who ask for less motion.
*/
const CSS = `
.ba-aura { --ba-halo-far: 0.28; --ba-halo-near: 0.35; }
[data-theme="dark"] .ba-aura, .night .ba-aura { --ba-halo-far: 0.38; --ba-halo-near: 0.5; }
@keyframes ba-breathe { 0%, 100% { transform: scale(0.97); } 50% { transform: scale(1.03); } }
@keyframes ba-twinkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.7; } }
@keyframes ba-next { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.35); } }
.ba-breathe { transform-box: view-box; transform-origin: 150px 150px; animation: ba-breathe 5s ease-in-out infinite; }
.ba-twinkle { animation: ba-twinkle 7s ease-in-out infinite; }
.ba-next { transform-box: fill-box; transform-origin: center; animation: ba-next 2.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .ba-breathe, .ba-twinkle, .ba-next { animation: none; } }
`;

const C = 150, R = 90;
const ANGLE: Record<SignalName, number> = { heart: -Math.PI / 2, hrv: Math.PI / 6, breathing: (Math.PI * 5) / 6 };
const amp = (z: number | undefined) => (z == null ? 0 : z >= 0 ? Math.min(z, 3) * 0.075 : -Math.min(-z, 1) * 0.02);

/** The phone's outline at time `t` (s). */
export function auraPath(strain: Partial<Record<SignalName, number>>, radius: number, t: number, swell = 1, steps = 72): string {
  let d = "";
  for (let k = 0; k < steps; k++) {
    const th = (k / steps) * 2 * Math.PI;
    let r = 1 + 0.014 * Math.sin(3 * th + t * 0.6) + 0.008 * Math.sin(5 * th - t * 0.9) + 0.008 * Math.sin(2 * th + t * 0.4);
    for (const s of SIGNALS) {
      const a = Math.atan2(Math.sin(th - ANGLE[s]), Math.cos(th - ANGLE[s]));
      r += amp(strain[s]) * swell * Math.exp((-a * a) / (2 * 0.38 * 0.38));
    }
    d += `${k ? "L" : "M"}${(C + radius * r * Math.cos(th)).toFixed(1)} ${(C + radius * r * Math.sin(th)).toFixed(1)}`;
  }
  return `${d}Z`;
}

const MOTES = Array.from({ length: 9 }, (_, i) => {
  const seed = i * 2.39996;
  return { seed, orbit: R * (1.42 + 0.22 * Math.sin(seed * 3.1)), speed: 0.05 + 0.02 * (i % 3), r: R * (0.012 + 0.008 * (i % 2)) * 1.6, white: i % 3 === 0 };
});

export function BodyAlertAura({ look, strain, nightsLearned = 0, size = 300, label, children }: {
  look: Look | "off";
  /** Each signal's z towards strain last night. */
  strain: Partial<Record<SignalName, number>>;
  nightsLearned?: number;
  size?: number;
  label: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const shape = useRef<SVGPathElement>(null), far = useRef<SVGPathElement>(null), near = useRef<SVGPathElement>(null);
  const swirl = useRef<SVGGElement>(null), motes = useRef<SVGGElement>(null);
  const tint = look === "off" ? "var(--dim)" : `var(--h-${LOOK_HUE[look]})`;
  const key = SIGNALS.map((s) => strain[s] ?? "").join(",");

  useEffect(() => {
    const z = Object.fromEntries(key.split(",").map((v, i) => [SIGNALS[i], v === "" ? undefined : Number(v)])) as Partial<Record<SignalName, number>>;
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = (ms: number) => {
      const t = still ? 0 : ms / 1000;
      shape.current?.setAttribute("d", auraPath(z, R, t));
      far.current?.setAttribute("d", auraPath(z, R * 1.35, t * 0.6, 1.6, 48));
      near.current?.setAttribute("d", auraPath(z, R * 1.06, t * 0.9, 1.3, 48));
      swirl.current?.setAttribute("transform", `rotate(${((t * 0.25 * 180) / Math.PI) % 360} ${C} ${C})`);
      motes.current?.querySelectorAll("circle").forEach((el, i) => {
        const m = MOTES[i], th = m.seed + t * m.speed;
        el.setAttribute("cx", (C + m.orbit * Math.cos(th)).toFixed(1));
        el.setAttribute("cy", (C + m.orbit * Math.sin(th) * 0.92).toFixed(1));
      });
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [key]);

  const lit = { x: C - R * 0.32, y: C - R * 0.4 };
  const off = SIGNALS.filter((s) => (strain[s] ?? 0) >= 1);
  const at = (s: SignalName, k: number) => ({ x: C + R * k * Math.cos(ANGLE[s]), y: C + R * k * Math.sin(ANGLE[s]) });

  return (
    <div className="ba-aura" style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <style>{CSS}</style>
      <svg role="img" aria-label={label} className="no-wipe" width={size} height={size} viewBox="0 0 300 300" style={{ overflow: "visible", display: "block" }}>
        <defs>
          <path id={`${id}s`} ref={shape} d={auraPath(strain, R, 0)} />
          <clipPath id={`${id}c`}><use href={`#${id}s`} /></clipPath>
          <radialGradient id={`${id}b`} gradientUnits="userSpaceOnUse" cx={lit.x} cy={lit.y} r={R * 2.05}>
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.9 }} />
            <stop offset="0.32" style={{ stopColor: tint }} />
            <stop offset="0.62" style={{ stopColor: tint, stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: "#000000", stopOpacity: 0.55 }} />
          </radialGradient>
          <linearGradient id={`${id}r`} gradientUnits="userSpaceOnUse" x1={C - R} y1={C - R} x2={C + R} y2={C + R}>
            <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.7 }} />
            <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0.08 }} />
            <stop offset="1" style={{ stopColor: tint, stopOpacity: 0.5 }} />
          </linearGradient>
          {[["f", 50], ["n", 18], ["w", 25], ["p", 22], ["o", 11], ["h", 12.6], ["k", 2.2]].map(([k, sd]) => (
            <filter key={k} id={`${id}${k}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation={sd} /></filter>
          ))}
        </defs>
        <g className="ba-breathe">
          <path ref={far} d={auraPath(strain, R * 1.35, 0, 1.6, 48)} filter={`url(#${id}f)`} style={{ fill: tint, opacity: "var(--ba-halo-far)" }} />
          <g filter={`url(#${id}n)`} style={{ opacity: "var(--ba-halo-near)" }}>
            <path ref={near} d={auraPath(strain, R * 1.06, 0, 1.3, 48)} style={{ fill: tint }} />
            {off.map((s) => { const p = at(s, 1); return <circle key={s} cx={p.x} cy={p.y} r={R * (0.4 + Math.min(strain[s]!, 3) * 0.1)} style={{ fill: `var(--h-${toneHue(strain[s]!)})` }} />; })}
          </g>
          <use href={`#${id}s`} fill={`url(#${id}b)`} />
          <g clipPath={`url(#${id}c)`}>
            <g filter={`url(#${id}w)`} style={{ mixBlendMode: "screen", opacity: 0.55 }}>
              <g ref={swirl}>
                <ellipse cx={C - 45} cy={C} rx={42} ry={84} style={{ fill: "#ffffff", opacity: 0.55 }} />
                <ellipse cx={C + 45} cy={C} rx={42} ry={84} style={{ fill: tint, opacity: 0.9 }} />
              </g>
            </g>
            <g filter={`url(#${id}p)`}>
              {off.map((s) => { const p = at(s, 0.8); return <circle key={s} cx={p.x} cy={p.y} r={R * 0.62} style={{ fill: `var(--h-${toneHue(strain[s]!)})`, opacity: 0.95 }} />; })}
            </g>
            <ellipse cx={C + R * 0.15} cy={C + R * 0.92} rx={R * 0.6} ry={R * 0.21} filter={`url(#${id}o)`} style={{ fill: tint, mixBlendMode: "screen", opacity: 0.5 }} />
          </g>
          <use href={`#${id}s`} fill="none" stroke={`url(#${id}r)`} strokeWidth={1.2} />
          <ellipse cx={lit.x} cy={lit.y} rx={R * 0.34} ry={R * 0.23} filter={`url(#${id}h)`} style={{ fill: "#ffffff", opacity: 0.32 }} />
          <ellipse cx={lit.x - R * 0.04} cy={lit.y - R * 0.02} rx={R * 0.1} ry={R * 0.062} filter={`url(#${id}k)`} style={{ fill: "#ffffff", opacity: 0.85 }} />
        </g>
        <g ref={motes} aria-hidden="true">
          {MOTES.map((m, i) => (
            <circle key={i} className="ba-twinkle" cx={C + m.orbit * Math.cos(m.seed)} cy={C + m.orbit * Math.sin(m.seed) * 0.92} r={m.r}
              style={{ fill: m.white ? "#ffffff" : tint, animationDelay: `${-((m.seed * 4) % 7)}s` }} />
          ))}
        </g>
        {look === "learning" ? Array.from({ length: 14 }, (_, i) => {
          const th = -Math.PI / 2 + (i / 14) * 2 * Math.PI, done = i < nightsLearned, next = i === nightsLearned;
          return <circle key={i} className={next ? "ba-next" : undefined} cx={C + 132 * Math.cos(th)} cy={C + 132 * Math.sin(th)} r={done ? 4.8 : 3}
            style={{ fill: tint, opacity: done ? 1 : next ? 0.6 : 0.22 }} />;
        }) : null}
      </svg>
      {children ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#ffffff", textShadow: "0 1px 8px rgba(0,0,0,0.25)", pointerEvents: "none" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
