import { getLocale, useLanguage, t } from "../i18n/training";
import { AlertCircle, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  useLanguage();
  const reducedMotion = useReducedMotion();
  const [angleIndex, setAngleIndex] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [paused, setPaused] = useState(Boolean(reducedMotion));
  const videoRef = useRef<HTMLVideoElement>(null);

  const angles = useMemo(
    () => option?.media?.filter((entry) => entry.videoUrl) ?? [],
    [option, getLocale()]
  );
  const angle = angles[angleIndex] ?? angles[0];

  const targets = useMemo(
    () => (showTargets ? resolveExerciseTargets(name) : undefined),
    [name, showTargets, getLocale()]
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
  }, [targets, getLocale()]);

  useEffect(() => {
    setAngleIndex(0);
    setStatus("loading");
  }, [option?.id]);

  useEffect(() => {
    setStatus("loading");
    setPaused(Boolean(reducedMotion));
  }, [angle?.videoUrl, reducedMotion]);

  /*
   * A looping demo needs one control, not the browser's full bar (scrubber,
   * fullscreen, download menu) laid over a 270 px plate. Clicking the clip
   * itself pauses it too.
   */
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  if (!angle?.videoUrl) return null;
  /*
   * With a cover frame the clip is shown from the start: the poster stands in
   * until the first frame, which is the same picture, so nothing swaps. The
   * spinner is only for clips COROS ships without one.
   */
  const poster = angle.coverUrl ?? option?.thumbnailUrl;

  return (
    <section
      className={`exercise-preview ${className}`.trim()}
      aria-label={t("{{value1}} demonstration", { value1: String(name || t("Exercise")) })}
    >
      <div className="exercise-preview-stage">
        {status === "loading" && !poster ? (
          <div className="exercise-preview-status" role="status">
            <span className="exercise-preview-spinner" aria-hidden="true" />
            <strong>{t("Loading demonstration")}</strong>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="exercise-preview-status is-error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <strong>{t("Demonstration unavailable")}</strong>
            {angles.length > 1 ? <span>{t("Try another angle.")}</span> : null}
          </div>
        ) : null}
        <video
          key={angle.videoUrl}
          ref={videoRef}
          className={status === "ready" || (status === "loading" && poster) ? "is-ready" : ""}
          src={angle.videoUrl}
          poster={poster}
          autoPlay={!reducedMotion}
          muted
          loop={!reducedMotion}
          playsInline
          preload="metadata"
          onLoadedData={() => setStatus("ready")}
          onError={() => setStatus("error")}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onClick={togglePlayback}
          aria-label={t("{{value1}} demonstration, angle {{value2}} of {{value3}}", { value1: String(name || t("Exercise")), value2: String(angleIndex + 1), value3: String(angles.length) })}
        />
        {status === "ready" ? (
          <button
            type="button"
            className={`exercise-preview-playback${paused ? " is-paused" : ""}`}
            aria-label={paused ? t("Play demonstration") : t("Pause demonstration")}
            title={paused ? t("Play demonstration") : t("Pause demonstration")}
            onClick={togglePlayback}
          >
            {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      {angles.length > 1 ? (
        <div className="exercise-preview-angles">
          <button
            type="button"
            aria-label={t("Show previous angle")}
            onClick={() => setAngleIndex((current) => (current - 1 + angles.length) % angles.length)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span aria-live="polite">{t("Angle")} {angleIndex + 1} {t("of")} {angles.length}</span>
          <button
            type="button"
            aria-label={t("Show next angle")}
            onClick={() => setAngleIndex((current) => (current + 1) % angles.length)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {showTargets && targets?.mobility ? (
        <p className="exercise-preview-note">{t("Mobility work. It carries no training load.")}</p>
      ) : null}

      {showTargets && muscles.length > 0 ? (
        <div className="exercise-preview-targets">
          <h5>{t("Trains")}</h5>
          <ul>
            {muscles.map((muscle) => (
              <li key={muscle.id} className={muscle.isPrime ? "is-prime" : ""} title={t(muscle.anatomy)}>
                {t(muscle.label)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
