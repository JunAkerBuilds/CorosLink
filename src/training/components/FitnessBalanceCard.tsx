import { useLanguage, t } from "../../i18n/training";
import { useEffect, useState, type CSSProperties } from "react";
import { Scale } from "lucide-react";
import "../chartSizing.css";
import "../profileSizing.css";
import "../overviewCards.css";
import { formatHappenDayLabel, formatOptionalNumber } from "../formatters";
import type { TrainingSummaryMetrics } from "../types";

interface BalanceReading {
  key: "base" | "load" | "fatigue";
  label: string;
  value: string;
  /** Bar fill, 0–100. */
  fill: number;
}

/**
 * Local-Only Mode: Base Fitness, Load Impact and fatigue as the watch stored
 * them with its latest activity (the watch's own figures; nothing is
 * calculated here). Fatigue is Load Impact as a percentage of Base Fitness.
 */
export function FitnessBalanceCard({ summary }: { summary: TrainingSummaryMetrics }) {
  useLanguage();
  const balance = summary.fitnessBalance;
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  // Base Fitness and Load Impact share one scale so their lengths compare; fatigue is already a percentage.
  const scale = Math.max(balance?.baseFitness ?? 0, balance?.loadImpact ?? 0, 1) * 1.15;
  const fill = (value: number | undefined, max: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? Math.max(3, Math.min(100, (value / max) * 100)) : 0;
  const readings: BalanceReading[] = [
    { key: "base", label: t("Base Fitness"), value: formatOptionalNumber(balance?.baseFitness), fill: fill(balance?.baseFitness, scale) },
    { key: "load", label: t("Load Impact"), value: formatOptionalNumber(balance?.loadImpact), fill: fill(balance?.loadImpact, scale) },
    {
      key: "fatigue",
      label: t("Fatigue"),
      value: balance?.fatigue !== undefined ? `${Math.round(balance.fatigue)}%` : "-",
      fill: fill(balance?.fatigue, 100)
    }
  ];
  return (
    <section className={`panel training-scores-panel fitness-balance-panel${balance ? "" : " is-empty"}${isReady ? " is-ready" : ""}`}>
      <header className="training-scores-header">
        <div className="training-scores-heading">
          <p className="eyebrow">{t("Training load")}</p>
          <h2>{t("Fitness and fatigue")}</h2>
          <p className="card-source-note">{t("From your watch")}</p>
        </div>
        <span className="training-panel-icon" aria-hidden="true">
          <Scale />
        </span>
      </header>
      {/* Without a sync the bars stay as empty tracks and one line says why, instead of a big empty box. */}
      <dl className="fitness-balance-bars">
        {readings.map((reading, index) => (
          <div key={reading.key} className={`fitness-balance-row is-${reading.key}`}>
            <dt>{reading.label}</dt>
            <dd>{reading.value}</dd>
            <span className="fitness-balance-track" aria-hidden="true">
              <span
                className="fitness-balance-fill"
                style={{ "--balance-fill": `${isReady ? reading.fill : 0}%`, transitionDelay: `${index * 90}ms` } as CSSProperties}
              />
            </span>
          </div>
        ))}
      </dl>
      {balance ? (
        <p className="fitness-balance-updated">
          {t("Updated")} <strong>{formatHappenDayLabel(balance.happenDay)}</strong>
        </p>
      ) : (
        <p className="fitness-balance-empty">{t("No data yet.")}</p>
      )}
    </section>
  );
}
