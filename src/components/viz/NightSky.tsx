import type { ComponentProps } from "react";
import { scatter } from "@/lib/health";

/** 150 stars on a 900×420 field, denser towards the top, every ninth one bright. Same positions as the canvas. */
function starPaths(): { dim: string; bright: [string, string, string] } {
  let dim = "";
  const bright: [string, string, string] = ["", "", ""];
  for (let q = 0; q < 150; q++) {
    const x = (scatter(q, 21) + 0.5) * 900;
    const depth = scatter(q, 22) + 0.5;
    const y = depth * depth * 420;
    const r = 0.4 + (scatter(q, 23) + 0.5) * 1.1;
    const dot = `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 -${(2 * r).toFixed(2)} 0z`;
    if (q % 9 === 0) bright[(q / 9) % 3] += dot; else dim += dot;
  }
  return { dim, bright };
}

const STARS = starPaths();

/**
 * The sleep panel's night sky: indigo gradient, stars, a crescent moon and a warm glow at the horizon.
 * It carries `night`, so everything inside uses the dark tokens in both themes. Styles are in health.css.
 */
export function NightSky({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={`night sky${className ? ` ${className}` : ""}`} {...rest}>
      <svg aria-hidden="true" className="sky-layer" width="100%" height="100%" viewBox="0 0 900 420" preserveAspectRatio="xMidYMid slice">
        <path className="sky-stars" d={STARS.dim} />
        {STARS.bright.map((d, g) => <path key={g} className="sky-bright" data-group={g} d={d} />)}
        <circle className="sky-moon" cx="826" cy="58" r="20" />
        <circle className="sky-moon-shade" cx="834.4" cy="51.2" r="17.2" />
      </svg>
      <div aria-hidden="true" className="sky-layer sky-horizon" />
      {children}
    </section>
  );
}
