import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { WorkoutExerciseOption } from "../../electron/types";
import { MUSCLE_BY_ID, resolveExerciseTargets } from "../strength/muscles";

interface ExercisePreviewProps {
  option?: WorkoutExerciseOption;
  /** Resolved display name; drives both the heading and the muscle lookup. */
  name: string;
  /** Show which muscles the movement trains, from the anatomy rule set. */
  showTargets?: boolean;
  className?: string;
}

/** Muscles within this much of the top share are the movement's prime movers. */
const PRIMARY_SHARE_TOLERANCE = 0.02;
const MAX_LISTED_MUSCLES = 6;

/**
 * The movement plate: a demonstration clip, one angle at a time, plus what the
 * movement trains. COROS ships the clips on a white cyclorama, so the stage is
 * a light plate rather than a dark well — the video meets its own background
 * instead of a letterbox.
 */
export function ExercisePreview({
  option,
  name,
  showTargets = false,
  className = ""
}: ExercisePreviewProps) {
  const reducedMotion = useReducedMotion();
  const [angleIndex, setAngleIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const angles = useMemo(
    () => option?.media?.filter((entry) => entry.videoUrl) ?? [],
    [option]
  );
  const angle = angles[angleIndex] ?? angles[0];

  const targets = useMemo(
    () => (showTargets ? resolveExerciseTargets(name) : undefined),
    [name, showTargets]
  );
  const muscles = useMemo(() => {
    const activations = targets?.activations ?? [];
    if (activations.length === 0) return [];
    const top = Math.max(...activations.map((entry) => entry.share));
    return activations.slice(0, MAX_LISTED_MUSCLES).map((entry) => ({
      id: entry.muscle,
      label: MUSCLE_BY_ID[entry.muscle].label,
      anatomy: MUSCLE_BY_ID[entry.muscle].anatomy,
      isPrime: entry.share >= top - PRIMARY_SHARE_TOLERANCE
    }));
  }, [targets]);

  useEffect(() => {
    setAngleIndex(0);
    setStatus("loading");
  }, [option?.id]);

  useEffect(() => {
    setStatus("loading");
  }, [angle?.videoUrl]);

  if (!angle?.videoUrl) return null;

  return (
    <section
      className={`exercise-preview ${className}`.trim()}
      aria-label={`${name || "Exercise"} demonstration`}
    >
      <div className="exercise-preview-stage">
        {status === "loading" ? (
          <div className="exercise-preview-status" role="status">
            <span className="exercise-preview-spinner" aria-hidden="true" />
            <strong>Loading demonstration</strong>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="exercise-preview-status is-error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <strong>Demonstration unavailable</strong>
            {angles.length > 1 ? <span>Try another angle.</span> : null}
          </div>
        ) : null}
        <video
          key={angle.videoUrl}
          className={status === "ready" ? "is-ready" : ""}
          src={angle.videoUrl}
          poster={angle.coverUrl ?? option?.thumbnailUrl}
          controls
          autoPlay={!reducedMotion}
          muted
          loop={!reducedMotion}
          playsInline
          preload="metadata"
          onLoadedData={() => setStatus("ready")}
          onError={() => setStatus("error")}
          aria-label={`${name || "Exercise"} demonstration, angle ${angleIndex + 1} of ${angles.length}`}
        />
      </div>

      {angles.length > 1 ? (
        <div className="exercise-preview-angles">
          <button
            type="button"
            aria-label="Show previous angle"
            onClick={() => setAngleIndex((current) => (current - 1 + angles.length) % angles.length)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span aria-live="polite">Angle {angleIndex + 1} of {angles.length}</span>
          <button
            type="button"
            aria-label="Show next angle"
            onClick={() => setAngleIndex((current) => (current + 1) % angles.length)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {showTargets && targets?.mobility ? (
        <p className="exercise-preview-note">Mobility work. It carries no training load.</p>
      ) : null}

      {showTargets && muscles.length > 0 ? (
        <div className="exercise-preview-targets">
          <h5>Trains</h5>
          <ul>
            {muscles.map((muscle) => (
              <li key={muscle.id} className={muscle.isPrime ? "is-prime" : ""} title={muscle.anatomy}>
                {muscle.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
