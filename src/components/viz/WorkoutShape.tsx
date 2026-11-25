import type { ShapeBucket } from "@/lib/workout";

/** The workout's intensity over time: a bar per step, coloured easy, hard or recovery. */
export function WorkoutShape({ paths, label, width = 500, height = 120 }: {
  paths: Record<ShapeBucket, string>; label: string; width?: number; height?: number;
}) {
  return (
    <svg role="img" aria-label={label} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={paths.easy} style={{ fill: "var(--h-blue)" }} />
      <path d={paths.rest} style={{ fill: "rgba(var(--fg-rgb), 0.3)" }} />
      <path d={paths.hard} style={{ fill: "var(--h-coral)" }} />
    </svg>
  );
}
