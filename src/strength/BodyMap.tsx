import { useId, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BACK_CONTOUR,
  BACK_DETAILS,
  BACK_MUSCLES,
  BODY_VIEWBOX,
  FRONT_CONTOUR,
  FRONT_DETAILS,
  FRONT_MUSCLES,
  type MusclePath
} from "./bodyPaths";
import { MUSCLE_BY_ID, type MuscleId } from "./muscles";
import {
  heatLevel,
  metricValue,
  type HeatMetric,
  type MuscleStat
} from "./strengthAnalytics";

export type BodyView = "front" | "back";

interface BodyMapProps {
  view: BodyView;
  metric: HeatMetric;
  muscleById: Record<MuscleId, MuscleStat>;
  max: number;
  selected: MuscleId | null;
  hovered: MuscleId | null;
  onHover: (muscle: MuscleId | null) => void;
  onSelect: (muscle: MuscleId) => void;
}

const MIRROR = `translate(${BODY_VIEWBOX.width}, 0) scale(-1, 1)`;

function MuscleLayer({
  muscles,
  mirrored,
  levels,
  selected,
  hovered,
  onHover,
  onSelect
}: {
  muscles: MusclePath[];
  mirrored: boolean;
  levels: Record<MuscleId, number>;
  selected: MuscleId | null;
  hovered: MuscleId | null;
  onHover: (muscle: MuscleId | null) => void;
  onSelect: (muscle: MuscleId) => void;
}) {
  return (
    <g transform={mirrored ? MIRROR : undefined}>
      {muscles.map((muscle) => {
        const meta = MUSCLE_BY_ID[muscle.id];
        const level = levels[muscle.id] ?? 0;
        const isActive = selected === muscle.id || hovered === muscle.id;
        return (
          <path
            key={`${muscle.id}-${mirrored ? "l" : "r"}`}
            className={`body-muscle${isActive ? " is-active" : ""}${
              selected && selected !== muscle.id ? " is-dimmed" : ""
            }`}
            data-level={level}
            d={muscle.d}
            role="button"
            tabIndex={mirrored ? -1 : 0}
            aria-label={meta.label}
            onPointerEnter={() => onHover(muscle.id)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(muscle.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(muscle.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(muscle.id);
              }
            }}
          />
        );
      })}
    </g>
  );
}

export function BodyMap({
  view,
  metric,
  muscleById,
  max,
  selected,
  hovered,
  onHover,
  onSelect
}: BodyMapProps) {
  const reducedMotion = useReducedMotion();
  const clipId = useId();

  const levels = useMemo(() => {
    const result = {} as Record<MuscleId, number>;
    for (const [id, stat] of Object.entries(muscleById) as [MuscleId, MuscleStat][]) {
      result[id] = heatLevel(metricValue(stat, metric), max);
    }
    return result;
  }, [metric, max, muscleById]);

  const contour = view === "front" ? FRONT_CONTOUR : BACK_CONTOUR;
  const muscles = view === "front" ? FRONT_MUSCLES : BACK_MUSCLES;
  const details = view === "front" ? FRONT_DETAILS : BACK_DETAILS;
  const clipPathId = `${clipId}-${view}`;

  return (
    <div className="body-map">
      <AnimatePresence initial={false} mode="wait">
        <motion.svg
          key={view}
          className="body-map-svg"
          viewBox={`0 0 ${BODY_VIEWBOX.width} ${BODY_VIEWBOX.height}`}
          role="img"
          aria-label={`${view === "front" ? "Front" : "Back"} view of trained muscles`}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, rotateY: view === "front" ? -70 : 70 }}
          animate={{ opacity: 1, rotateY: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, rotateY: view === "front" ? 70 : -70 }}
          transition={
            reducedMotion
              ? { duration: 0.12 }
              : { type: "spring", stiffness: 220, damping: 26, mass: 0.9 }
          }
        >
          <defs>
            <clipPath id={clipPathId}>
              <path d={contour} fillRule="evenodd" />
              <path d={contour} fillRule="evenodd" transform={MIRROR} />
            </clipPath>
            <radialGradient id={`${clipPathId}-sheen`} cx="50%" cy="26%" r="72%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
          </defs>

          <g className="body-base">
            <path d={contour} fillRule="evenodd" />
            <path d={contour} fillRule="evenodd" transform={MIRROR} />
          </g>

          <g clipPath={`url(#${clipPathId})`}>
            <MuscleLayer
              muscles={muscles}
              mirrored={false}
              levels={levels}
              selected={selected}
              hovered={hovered}
              onHover={onHover}
              onSelect={onSelect}
            />
            <MuscleLayer
              muscles={muscles}
              mirrored
              levels={levels}
              selected={selected}
              hovered={hovered}
              onHover={onHover}
              onSelect={onSelect}
            />
            <rect
              className="body-sheen"
              width={BODY_VIEWBOX.width}
              height={BODY_VIEWBOX.height}
              fill={`url(#${clipPathId}-sheen)`}
            />
          </g>

          <g className="body-detail" clipPath={`url(#${clipPathId})`}>
            {details.map((d, index) => (
              <path key={`d-${index}`} d={d} />
            ))}
            {details.map((d, index) => (
              <path key={`m-${index}`} d={d} transform={MIRROR} />
            ))}
          </g>

          <g className="body-outline">
            <path d={contour} />
            <path d={contour} transform={MIRROR} />
          </g>
        </motion.svg>
      </AnimatePresence>
    </div>
  );
}
