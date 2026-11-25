import { petalPath } from "./PetalDial";

/*
  Macro fans and meal rows grow in petal by petal, left to right, instead of a hard wipe.
  The faint petals sit in a faded group so each petal can animate to full opacity inside it.
*/
function Petals({ count, lit, at, color, origin, start }: {
  count: number; lit: number; at: (k: number) => string; color: string;
  /** Where each petal grows from, in the drawing's units, or null for its own base. */
  origin: (k: number) => string; start: number;
}) {
  const one = (k: number) => (
    <path key={k} className="cl-sprout" d={at(k)} style={{ fill: color, transformOrigin: origin(k), animationDelay: `${(start + k * 0.05).toFixed(2)}s` }} />
  );
  const ks = Array.from({ length: count }, (_, k) => k);
  return (
    <>
      <g style={{ opacity: 0.22 }}>{ks.filter((k) => k >= lit).map(one)}</g>
      <g>{ks.filter((k) => k < lit).map(one)}</g>
    </>
  );
}

/** Nine petals fanned in a half circle, lit from the left: a macro's gauge. `color` is a CSS colour (a hue token). */
export function PetalFan({ lit, color, count = 9 }: { lit: number; color: string; count?: number }) {
  const step = 160 / (count - 1);
  return (
    <svg aria-hidden="true" className="no-wipe" width="114" height="69" viewBox="0 0 76 46">
      <Petals count={count} lit={lit} color={color} start={0.5}
        at={(k) => petalPath(38, 44, -80 + k * step, 23, 41, 6)} origin={() => "38px 44px"} />
    </svg>
  );
}

/** Eight petals standing in a row, lit from the left: a meal's meter. */
export function PetalRow({ lit, color, count = 8 }: { lit: number; color: string; count?: number }) {
  return (
    <svg aria-hidden="true" className="no-wipe" width={count * 13} height="16" viewBox={`0 0 ${count * 13} 16`}>
      <Petals count={count} lit={lit} color={color} start={0.6}
        at={(k) => petalPath(6.5 + k * 13, 15, 0, 0, 14, 5)} origin={(k) => `${6.5 + k * 13}px 15px`} />
    </svg>
  );
}
