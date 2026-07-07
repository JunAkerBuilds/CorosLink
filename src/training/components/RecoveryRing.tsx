import { useEffect, useId, useState } from "react";
import { TrainingSummaryTiles } from "./TrainingSummaryTiles";
import { recoveryTone } from "../parsers";
import type { TrainingSummaryMetrics } from "../types";

interface RecoveryRingProps {
  summary: TrainingSummaryMetrics;
}

function readinessCopy(
  tone: "low" | "mid" | "high" | "neutral"
): { label: string; message: string } {
  switch (tone) {
    case "high":
      return {
        label: "Ready",
        message:
          "Recovery is strong. You're cleared for a hard session."
      };
    case "mid":
      return {
        label: "Moderate",
        message: "Recovery is climbing back. Keep today's effort easy to moderate."
      };
    case "low":
      return {
        label: "Recover",
        message:
          "Recovery is low. Prioritise rest and sleep before your next hard effort."
      };
    default:
      return {
        label: "Waiting",
        message: "Sync your watch to see live recovery guidance here."
      };
  }
}

export function RecoveryRing({ summary }: RecoveryRingProps) {
  const [isReady, setIsReady] = useState(false);
  const ambientFilterId = useId();
  const recovery = summary.recoveryPct ?? 0;
  const percent = Math.max(0, Math.min(100, recovery));
  const hasData = percent > 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percent / 100) * circumference;
  const tone = hasData ? recoveryTone(percent) : "neutral";
  const { label, message } = readinessCopy(tone);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [percent]);

  return (
    <section className={`panel training-ring-panel tone-${tone}`}>
      <div className="training-ring-header">
        <p className="eyebrow">Recovery</p>
      </div>

      <div className="training-ring-content">
        <div
          className={`storage-ring training-recovery-ring${
            isReady ? " is-ready" : ""
          }`}
          aria-label={`${Math.round(percent)}% recovery`}
        >
          <svg viewBox="0 0 128 128" aria-hidden="true">
            <defs>
              <filter
                id={ambientFilterId}
                x="-120%"
                y="-120%"
                width="340%"
                height="340%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation="10" />
              </filter>
            </defs>
            <circle
              className="training-recovery-ring-ambient"
              cx="64"
              cy="64"
              r={radius}
              filter={`url(#${ambientFilterId})`}
            />
            <circle className="storage-ring-track" cx="64" cy="64" r={radius} />
            <circle
              className="storage-ring-progress training-recovery-ring-progress"
              cx="64"
              cy="64"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={isReady ? targetOffset : circumference}
              transform="rotate(-90 64 64)"
            />
          </svg>
          <div className="storage-ring-label">
            <strong>{hasData ? `${Math.round(percent)}%` : "–"}</strong>
            <span>{label}</span>
          </div>
        </div>

        <p className="training-ring-message">{message}</p>

        <TrainingSummaryTiles
          summary={summary}
          layout="stack"
          metrics={["load", "heart", "steps", "calories"]}
          className="training-ring-metrics"
        />
      </div>
    </section>
  );
}
