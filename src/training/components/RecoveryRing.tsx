import { useLanguage, t } from "../../i18n/training";
import { useEffect, useState } from "react";
import { recoveryHoursLeft, recoveryTone } from "../parsers";
import type { TrainingSummaryMetrics } from "../types";

interface RecoveryRingProps {
  summary: TrainingSummaryMetrics;
  /**
   * Local-Only Mode: recovery % is calculated by COROS; without it the card
   * counts down the watch's own recovery time from its latest activity.
   */
  local?: boolean;
  /** The clock, in ms (injected by tests). */
  now?: () => number;
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

export function RecoveryRing({ summary, local = false, now = Date.now }: RecoveryRingProps) {
  useLanguage();
  const [isReady, setIsReady] = useState(false);
  const recovery = summary.recoveryPct ?? 0;
  const hasPercent = recovery > 0;
  // Local-Only Mode without COROS's recovery %: the watch's recovery time, counted down from now.
  const recoveredAt = local && !hasPercent ? summary.recoveredAt : undefined;
  const [nowMs, setNowMs] = useState(now);
  useEffect(() => {
    if (recoveredAt === undefined) return;
    setNowMs(now());
    const timer = window.setInterval(() => setNowMs(now()), 60_000);
    return () => window.clearInterval(timer);
  }, [recoveredAt, now]);
  const hoursLeft = recoveredAt !== undefined ? recoveryHoursLeft(recoveredAt, nowMs) : undefined;
  const percent = hoursLeft === 0 ? 100 : Math.max(0, Math.min(100, recovery));
  const hasData = percent > 0;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference - (percent / 100) * circumference;
  const tone = hoursLeft !== undefined ? (hoursLeft === 0 ? "high" : "mid") : hasData ? recoveryTone(percent) : "neutral";
  const watch = hoursLeft === undefined ? undefined : hoursLeft > 0
    ? { value: `${hoursLeft} h`, message: t("Recovered in {{value1}} h", { value1: String(hoursLeft) }) }
    : { value: t("Recovered"), message: t("From your watch") };
  const { label, message } = readinessCopy(local && !hasPercent ? "neutral" : tone);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className={`panel training-ring-panel tone-${tone}`}>
      <div className="training-ring-header">
        <p className="eyebrow">{t("Recovery")}</p>
      </div>

      <div className="training-ring-content">
        <div
          className={`storage-ring training-recovery-ring${
            isReady ? " is-ready" : ""
          }`}
          aria-label={watch ? watch.message : hasData ? t("{{value1}}% recovery", { value1: String(Math.round(percent)) }) : t("No data yet.")}
        >
          <svg viewBox="0 0 128 128" aria-hidden="true">
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
            <strong>{watch ? watch.value : hasData ? `${Math.round(percent)}%` : "–"}</strong>
            {!watch && label ? <span>{t(label)}</span> : null}
          </div>
        </div>

        {/* Local-Only Mode before a sync: the banner above says how to fill it, so the card just says it's empty. */}
        <p className="training-ring-message">{watch ? watch.message : local && !hasData ? t("No data yet.") : t(message)}</p>
      </div>
    </section>
  );
}
