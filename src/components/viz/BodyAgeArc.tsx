import { ARC, arcPoint, bodyAgeAngle } from "@/lib/body";

const f = (v: number) => v.toFixed(1);

/**
 * The arc under the pearl: five years either side of the person's age, their age at the bottom, a tick every
 * fifth of a year, and the stretch between age and body age filled in.
 */
export function BodyAgeArc({ age, bodyAge, label }: { age: number; bodyAge: number; label: string }) {
  const { r, startDeg, degPerYear, halfSpan } = ARC;
  const endDeg = startDeg - 2 * halfSpan * degPerYear;
  let year = "", fifth = "";
  for (let n = 0; n <= halfSpan * 10; n++) {
    const deg = startDeg - n * (degPerYear / 5), whole = n % 5 === 0, len = whole ? 8 : 5;
    const [x0, y0] = arcPoint(deg, r - len), [x1, y1] = arcPoint(deg, r + len);
    const seg = `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
    if (whole) year += seg; else fifth += seg;
  }
  const [sx, sy] = arcPoint(startDeg), [ex, ey] = arcPoint(endDeg);
  const [ax, ay] = arcPoint(bodyAgeAngle(age, age));
  const [bx, by] = arcPoint(bodyAgeAngle(bodyAge, age));
  // Always drawn from the younger end to the older one, the way the track runs.
  const [fx, fy, tx, ty] = bodyAge <= age ? [bx, by, ax, ay] : [ax, ay, bx, by];
  // The two end numbers sit just above the track's ends, as on the canvas.
  const labelY = Math.min(sy, ey) - 21;
  const text = { font: "600 11px var(--font-inter), Inter, sans-serif", textAnchor: "middle" } as const;
  return (
    <svg role="img" aria-label={label} viewBox="0 0 358 330" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <path d={`M${f(sx)} ${f(sy)}A${r} ${r} 0 0 0 ${f(ex)} ${f(ey)}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.085)", strokeWidth: 26, strokeLinecap: "round" }} />
      <path d={`M${f(fx)} ${f(fy)}A${r} ${r} 0 0 0 ${f(tx)} ${f(ty)}`} fill="none" style={{ stroke: "rgba(83,203,161,0.45)", strokeWidth: 18, strokeLinecap: "round" }} />
      <path d={year} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.6)", strokeWidth: 1.2 }} />
      <path d={fifth} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.3)", strokeWidth: 0.8 }} />
      <circle cx={f(ax)} cy={f(ay)} r="6" style={{ fill: "var(--fg)" }} />
      <circle cx={f(bx)} cy={f(by)} r="13" style={{ fill: "rgba(83,203,161,0.5)", filter: "blur(5px)" }} />
      <circle cx={f(bx)} cy={f(by)} r="9" style={{ fill: "var(--h-mint)", stroke: "#ffffff", strokeWidth: 2.5 }} />
      <text x={f(sx)} y={f(labelY)} style={{ ...text, fill: "rgba(var(--fg-rgb), 0.7)" }}>{age - halfSpan}</text>
      <text x={f(ex)} y={f(labelY)} style={{ ...text, fill: "rgba(var(--fg-rgb), 0.7)" }}>{age + halfSpan}</text>
      <text x="179" y="321" style={{ ...text, fill: "rgba(var(--fg-rgb), 0.85)" }}>Your age {age}</text>
    </svg>
  );
}
