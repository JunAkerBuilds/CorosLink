import { CountUp } from "@/components/ui";
import { ScoreDial } from "./ScoreDial";

const SIZE = 250, R = 106;

/**
 * The lime Energy gauge: the open-bottom dial at 250 px with the level out of 100 in the middle.
 * `woke`, when given, puts a short mark across the ring at the waking level.
 */
export function EnergyGauge({ level, woke, label }: { level: number; woke?: number; label: string }) {
  let mark = null;
  if (woke != null) {
    const a = ((135 + (Math.max(0, Math.min(100, woke)) / 100) * 270) * Math.PI) / 180;
    const c = SIZE / 2, x = c + (R - 13) * Math.cos(a), y = c + (R - 13) * Math.sin(a);
    mark = (
      <path className="energy-mark" d={`M${x.toFixed(1)} ${y.toFixed(1)}l${(26 * Math.cos(a)).toFixed(1)} ${(26 * Math.sin(a)).toFixed(1)}`}
        fill="none" style={{ stroke: "var(--soft)", strokeWidth: 3, strokeLinecap: "round" }} />
    );
  }
  return (
    <ScoreDial
      value={level} size={SIZE} radius={R} stroke={22}
      color="var(--h-lime-deep)" glow="var(--energy-glow)" glowBlur={14} trackOpacity={0.12}
      label={label} overlay={mark}
    >
      <CountUp className="num" style={{ fontSize: 84, fontWeight: 900, lineHeight: 1 }} text={String(Math.round(level))} />
      <span className="muted" style={{ fontSize: 15, fontWeight: 600 }}>/ 100</span>
    </ScoreDial>
  );
}
