import type { EnergyStep } from "@/lib/health";

const COL = 100, BW = 56, H = 232;
const Y = (v: number) => 220 - (Math.max(0, Math.min(100, v)) / 100) * 200;

/**
 * The day step by step: the level it started from, each charge or use as a floating bar, then where it ended,
 * joined by dashed links. `colors` paints each kind; the two ends are neutral. Labels sit under it in HTML.
 */
export function EnergySteps({ steps, colors, label }: {
  steps: readonly EnergyStep[]; colors: Record<string, string>; label: string;
}) {
  const width = steps.length * COL;
  const x = (i: number) => i * COL + (COL - BW) / 2;
  const links = steps.slice(0, -1).map((s, i) => `M${x(i) + BW} ${Y(s.to).toFixed(1)}H${x(i + 1)}`).join("");
  return (
    <>
      <svg role="img" aria-label={label} className="no-wipe" viewBox={`0 0 ${width} ${H}`} style={{ display: "block", width: "100%", height: "auto" }}>
        <path d={`M0 20H${width}M0 120H${width}M0 220H${width}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)" }} />
        <path d={links} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.28)", strokeDasharray: "2 4" }} />
        {steps.map((s, i) => {
          const end = s.kind === "end";
          const lo = end ? 0 : Math.min(s.from, s.to), hi = end ? s.to : Math.max(s.from, s.to);
          const top = Y(hi), h = Math.max(6, Y(lo) - top);
          // Charges grow up from the level before them, uses grow down from it.
          const fromTop = !end && s.to < s.from;
          return (
            <rect key={i} className="energy-step" x={x(i)} y={top.toFixed(1)} width={BW} height={h.toFixed(1)} rx="6"
              style={{
                fill: end ? "rgba(var(--fg-rgb), 0.22)" : colors[s.kind], transformOrigin: fromTop ? "top" : "bottom",
                animationDelay: `${(0.5 + i * 0.09).toFixed(2)}s`,
              }} />
          );
        })}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, textAlign: "center" }}>
        {steps.map((s, i) => {
          const d = s.to - s.from;
          const v = s.kind === "end" ? String(s.to) : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="num" style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{v}</span>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
              <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{s.when}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
