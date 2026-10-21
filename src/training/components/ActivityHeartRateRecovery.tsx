import { HeartPulse } from "lucide-react";
import { formatNumber, t, useLanguage } from "../../i18n/training";
import type { TrainingHubHeartRateRecovery } from "../../../electron/types";
import { useTheme } from "../../theme/ThemeProvider";
import { getActivityChannelColors } from "../chartConfig";
import "../activityChannels.css";

interface ActivityHeartRateRecoveryProps {
  recovery: TrainingHubHeartRateRecovery;
}

const WIDTH = 240;
const HEIGHT = 56;

/** A fall reads as "−23 bpm"; a rise (rare, e.g. walking off) as "+4 bpm". */
function signedDrop(drop: number): string {
  return `${drop >= 0 ? "−" : "+"}${formatNumber(Math.abs(Math.round(drop)))} bpm`;
}

/** Heart rate in the two minutes after the workout ended, as the watch measured it. */
export function ActivityHeartRateRecovery({ recovery }: ActivityHeartRateRecoveryProps) {
  useLanguage();
  const { theme } = useTheme();
  const color = getActivityChannelColors(theme).hr;
  const { samples } = recovery;
  // Seconds without a reading (0) are skipped; the line bridges them.
  const readings = samples.map((bpm, index) => ({ bpm, index })).filter(({ bpm }) => bpm > 0);
  const low = Math.min(...readings.map(({ bpm }) => bpm));
  const high = Math.max(...readings.map(({ bpm }) => bpm));
  const span = Math.max(high - low, 1);
  const last = Math.max(samples.length - 1, 1);
  const x = (index: number) => ((index / last) * WIDTH).toFixed(1);
  const y = (bpm: number) => (HEIGHT - 4 - ((bpm - low) / span) * (HEIGHT - 8)).toFixed(1);
  const line = readings.map(({ bpm, index }) => `${x(index)},${y(bpm)}`).join(" ");
  const area = readings.length > 1
    ? `${x(readings[0]!.index)},${HEIGHT} ${line} ${x(readings[readings.length - 1]!.index)},${HEIGHT}`
    : "";
  // Sample i is i + 1 s after the end, so the 1-minute mark is sample 59.
  const minuteX = x(59);
  return (
    <section className="activity-detail-visual-panel activity-hr-recovery">
      <div className="activity-detail-visual-heading">
        <h3>
          <HeartPulse size={17} aria-hidden="true" />
          {t("Heart-rate recovery")}</h3>
        <span className="activity-detail-visual-note">
          <span>{t("1 min")} <strong>{signedDrop(recovery.dropOneMinute)}</strong></span>
          <span>{t("2 min")} <strong>{signedDrop(recovery.dropTwoMinutes)}</strong></span>
        </span>
      </div>
      {readings.length > 1 ? (
        // The caption below states the same numbers, so the curve is decorative for screen readers.
        <div className="activity-hr-recovery-chart" aria-hidden="true">
          <svg className="activity-hr-recovery-curve" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" focusable="false">
            {samples.length > 60 ? <line className="activity-hr-recovery-mark" x1={minuteX} x2={minuteX} y1="0" y2={HEIGHT} vectorEffect="non-scaling-stroke" /> : null}
            <polygon className="activity-hr-recovery-area" points={area} fill={color} />
            <polyline className="activity-hr-recovery-line" points={line} stroke={color} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="activity-hr-recovery-axis">
            <span>0:00</span>
            <span>1:00</span>
            <span>2:00</span>
          </div>
        </div>
      ) : null}
      <p className="activity-hr-recovery-caption">
        {t("{{value0}} → {{value1}} bpm in the two minutes after the workout.", { value0: recovery.startBpm, value1: recovery.twoMinuteBpm })}
      </p>
    </section>
  );
}
