"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/*
  The Body page's aura: the app's morphing blob (BodyAlertAura in BodyAlertArt.swift) at the canvas's stronger
  wobble, with two blurred halos, a body lit from the top left, a slow swirl inside, a bounce light, the rim and
  two highlights. It breathes over 5 s and 14 particles orbit it, twinkling. Everything holds still for people
  who ask for less motion. Highlights and lettering stay white in both themes; body, halos and particles change.
*/
const CSS = `
:root {
  --aura: #12b886; --aura-edge: rgba(6, 90, 71, 0.6); --aura-rim: 0.7;
  --aura-halo-far: 0.28; --aura-halo-near: 0.35; --aura-mote: #12b886; --aura-mote-big: #0b7d62;
}
[data-theme="dark"], .night {
  --aura: #53cba1; --aura-edge: rgba(0, 0, 0, 0.6); --aura-rim: 0.6;
  --aura-halo-far: 0.38; --aura-halo-near: 0.5; --aura-mote: #53cba1; --aura-mote-big: #ffffff;
}
@keyframes aura-breathe { 0%, 100% { transform: scale(0.97); } 50% { transform: scale(1.03); } }
@keyframes aura-spin { to { transform: rotate(360deg); } }
@keyframes aura-orbit { from { transform: rotate(var(--a0)); } to { transform: rotate(calc(var(--a0) + 360deg)); } }
@keyframes aura-twinkle { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.95; } }
.aura-breathe, .aura-swirl, .aura-mote { transform-box: view-box; transform-origin: 125px 125px; }
.aura-breathe { animation: aura-breathe 5s ease-in-out infinite; }
.aura-swirl { animation: aura-spin 26s linear infinite; }
.aura-mote { animation: aura-orbit 60s linear infinite; }
.aura-mote circle { animation: aura-twinkle 3.6s ease-in-out infinite; }
.pearl-words {
  position: absolute; left: 15.1%; top: 1.8%; width: 69.8%; aspect-ratio: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; color: #ffffff;
}
@media (prefers-reduced-motion: reduce) {
  .aura-breathe, .aura-swirl, .aura-mote, .aura-mote circle { animation: none; }
}
`;

const P = 96;
const R = 116;
/** Seconds for the wobble to come back to where it started. */
const LOOP = 16;

/** The blob's outline at phase `ph` (radians): a circle of radius 116 around (125, 125) with three slow waves. */
export function blobPath(ph: number): string {
  let out = "";
  for (let s = 0; s < P; s++) {
    const th = (s / P) * 2 * Math.PI;
    const rr = R * (1 + 0.034 * Math.sin(3 * th + ph) + 0.022 * Math.sin(5 * th - 2 * ph + 1) + 0.026 * Math.sin(2 * th + ph + 2));
    out += `${s ? "L" : "M"}${(125 + rr * Math.cos(th)).toFixed(1)} ${(125 + rr * Math.sin(th)).toFixed(1)}`;
  }
  return out + "Z";
}

const MOTES = Array.from({ length: 14 }, (_, mi) => {
  const seed = mi * 2.39996;
  const big = mi % 3 === 0;
  return {
    a0: `${((seed * 180) / Math.PI % 360).toFixed(1)}deg`,
    dur: `${46 + (mi % 4) * 14}s`,
    dir: mi % 2 ? "reverse" : "normal",
    x: (125 + R * (1.3 + 0.24 * Math.sin(seed * 3.1))).toFixed(1),
    r: big ? 4.2 : 3,
    core: big ? 2.2 : 1.4,
    color: big ? "var(--aura-mote-big)" : "var(--aura-mote)",
    tw: `${(-(mi * 0.73) % 3.6).toFixed(2)}s`,
  };
});

const D0 = blobPath(0);

function AuraBlob() {
  const raw = useId().replace(/:/g, "");
  const id = (name: string) => `${raw}-${name}`;
  const shape = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const ph = (((now - start) / 1000) / LOOP) * 2 * Math.PI;
      shape.current?.setAttribute("d", blobPath(ph));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const ref = (name: string) => `url(#${id(name)})`;
  const halo = (scale: number) => `translate(125 125) scale(${scale}) translate(-125 -125)`;
  return (
    <svg aria-hidden="true" viewBox="-70 -70 390 390"
      style={{ position: "absolute", left: "-4.47%", top: "-19.41%", width: "108.94%", aspectRatio: "1", overflow: "visible", pointerEvents: "none" }}>
      <defs>
        <path id={id("shape")} ref={shape} d={D0} />
        <clipPath id={id("clip")}><use href={`#${id("shape")}`} /></clipPath>
        <radialGradient id={id("body")} gradientUnits="userSpaceOnUse" cx="87" cy="78" r="242">
          <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: 0.9 }} />
          <stop offset="0.32" style={{ stopColor: "var(--aura)" }} />
          <stop offset="0.62" style={{ stopColor: "var(--aura)", stopOpacity: 0.85 }} />
          <stop offset="1" style={{ stopColor: "var(--aura-edge)" }} />
        </radialGradient>
        <linearGradient id={id("rim")} gradientUnits="userSpaceOnUse" x1="7" y1="7" x2="243" y2="243">
          <stop offset="0" style={{ stopColor: "#ffffff", stopOpacity: "var(--aura-rim)" }} />
          <stop offset="0.5" style={{ stopColor: "#ffffff", stopOpacity: 0.08 }} />
          <stop offset="1" style={{ stopColor: "var(--aura)", stopOpacity: 0.5 }} />
        </linearGradient>
        <filter id={id("b32")} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="32" /></filter>
        <filter id={id("b12")} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="12" /></filter>
        <filter id={id("b16")} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="16" /></filter>
        <filter id={id("b7")} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" /></filter>
        <filter id={id("b2")} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.6" /></filter>
        <filter id={id("glow")} x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.4" /></filter>
      </defs>
      <g className="aura-breathe">
        <use href={`#${id("shape")}`} transform={halo(1.35)} filter={ref("b32")} style={{ fill: "var(--aura)", opacity: "var(--aura-halo-far)" }} />
        <use href={`#${id("shape")}`} transform={halo(1.06)} filter={ref("b12")} style={{ fill: "var(--aura)", opacity: "var(--aura-halo-near)" }} />
        <use href={`#${id("shape")}`} fill={ref("body")} />
        <g clipPath={ref("clip")}>
          <g className="aura-swirl" style={{ mixBlendMode: "screen", opacity: 0.55 }}>
            <ellipse cx="70" cy="125" rx="60" ry="95" filter={ref("b16")} style={{ fill: "#ffffff", opacity: 0.5 }} />
            <ellipse cx="190" cy="140" rx="55" ry="85" filter={ref("b16")} style={{ fill: "var(--aura)" }} />
          </g>
          <ellipse cx="142.7" cy="233.6" rx="70.8" ry="24.8" filter={ref("b7")} style={{ fill: "var(--aura)", mixBlendMode: "screen", opacity: 0.5 }} />
        </g>
        <use href={`#${id("shape")}`} fill="none" stroke={ref("rim")} style={{ strokeWidth: 1.2 }} />
        <ellipse cx="87" cy="78" rx="40" ry="27" filter={ref("b16")} style={{ fill: "#ffffff", opacity: 0.32 }} />
        <ellipse cx="82" cy="76" rx="11.8" ry="7.3" filter={ref("b2")} style={{ fill: "#ffffff", opacity: 0.85 }} />
      </g>
      {MOTES.map((m, k) => (
        <g key={k} className="aura-mote" style={{ ["--a0" as string]: m.a0, animationDuration: m.dur, animationDirection: m.dir }}>
          <circle cx={m.x} cy="125" r={m.r} filter={ref("glow")} style={{ fill: m.color, animationDelay: m.tw }} />
          <circle cx={m.x} cy="125" r={m.core} style={{ fill: m.color, animationDelay: m.tw }} />
        </g>
      ))}
    </svg>
  );
}

/**
 * The Body page's aura on its 358 × 330 board. `arc` is drawn over it (the body-age arc),
 * `children` are the words inside it.
 */
export function Pearl({ label, arc, children }: { label: string; arc?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label={label} style={{ position: "relative", flex: "none", width: 430, maxWidth: "100%", aspectRatio: "358 / 330" }}>
      <style href="clink-pearl" precedence="default">{CSS}</style>
      <AuraBlob />
      {arc}
      <div className="pearl-words">{children}</div>
    </section>
  );
}
