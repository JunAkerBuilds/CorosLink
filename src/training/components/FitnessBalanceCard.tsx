import { useLanguage, t } from "../../i18n/training";
import { Scale } from "lucide-react";
import "../chartSizing.css";
import "../profileSizing.css";
import { formatHappenDayLabel, formatOptionalNumber } from "../formatters";
import type { TrainingSummaryMetrics } from "../types";

/**
 * Local-Only Mode: Base Fitness, Load Impact and fatigue as the watch stored
 * them with its latest activity (the watch's own figures; nothing is
 * calculated here). Fatigue is Load Impact as a percentage of Base Fitness.
 */
export function FitnessBalanceCard({ summary }: { summary: TrainingSummaryMetrics }) {
  useLanguage();
  const balance = summary.fitnessBalance;
  const items = [
    { label: t("Base Fitness"), value: formatOptionalNumber(balance?.baseFitness) },
    { label: t("Load Impact"), value: formatOptionalNumber(balance?.loadImpact) },
    { label: t("Fatigue"), value: balance?.fatigue !== undefined ? `${Math.round(balance.fatigue)}%` : "-" }
  ];
  return (
    <section className="panel training-scores-panel fitness-balance-panel">
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
      {/* Nothing synced yet: one line, as the other cards say it. */}
      {!balance ? <p className="training-empty-state">{t("No data yet.")}</p> : <div className="training-threshold-grid">
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
        <div>
          <span>{t("Updated")}</span>
          <strong>{formatHappenDayLabel(balance.happenDay)}</strong>
        </div>
      </div>}
    </section>
  );
}
