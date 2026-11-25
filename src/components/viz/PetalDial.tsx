import type { ReactNode } from "react";

/**
 * One petal standing up from (cx, cy) and turned by `deg`: the shape the Fuel dial, the macro fans and the
 * meal rows are built from. `inner` and `outer` are its base and tip, `side` its half width.
 */
export function petalPath(cx: number, cy: number, deg: number, inner: number, outer: number, side: number): string {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const p = (x: number, y: number) => `${(cx + x * cs - y * sn).toFixed(1)} ${(cy + x * sn + y * cs).toFixed(1)}`;
  const sh = -inner - 0.35 * (outer - inner);
  return `M${p(0, -inner)}C${p(side, sh)} ${p(side, -outer)} ${p(0, -outer)}C${p(-side, -outer)} ${p(-side, sh)} ${p(0, -inner)}Z`;
}

const R = 140;

/**
 * The calorie dial: a ring of petals lit clockwise from the top. The last `moved` petals stand for what
 * moving added to the day and wait in green; `children` sit in the middle.
 */
export function PetalDial({ filled, moved, count = 36, label, children }: {
  filled: number; moved: number; count?: number; label: string; children?: ReactNode;
}) {
  type Petal = { d: string; delay: string };
  const lit: Petal[] = [], gold: Petal[] = [], mint: Petal[] = [];
  for (let i = 0; i < count; i++) {
    const p = { d: petalPath(150, 150, ((i + 0.5) * 360) / count, 0.677 * R, 0.93 * R, 0.08 * R), delay: `${(0.35 + i * 0.045).toFixed(3)}s` };
    if (i < filled) lit.push(p);
    else if (i >= count - moved) mint.push(p);
    else gold.push(p);
  }
  // Every petal pops in from the dial's centre, clockwise from the top; the faint ones sit in a faded group.
  const pop = (list: Petal[], fill: string) =>
    list.map((p) => <path key={p.delay} className="cl-petal" d={p.d} style={{ fill, animationDelay: p.delay }} />);
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 320 }}>
      <svg role="img" aria-label={label} className="no-wipe" viewBox="0 0 300 300" style={{ display: "block", width: "100%" }}>
        <g style={{ opacity: 0.2 }}>{pop(gold, "var(--h-gold)")}</g>
        <g style={{ opacity: 0.28 }}>{pop(mint, "var(--h-mint)")}</g>
        {/* Lit petals glow, and the glow breathes once they are in. */}
        <g className="cl-petals" style={{ filter: "drop-shadow(0 0 6px rgba(216,155,34,0.45))" }}>{pop(lit, "var(--h-gold)")}</g>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        {children}
      </div>
    </div>
  );
}
