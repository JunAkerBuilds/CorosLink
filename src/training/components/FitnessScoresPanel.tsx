import { BarChart3 } from "lucide-react";
import type {
  TrainingHubDashboard,
  TrainingHubRacePredictor
} from "../../../electron/types";
import { formatOptionalNumber, formatPaceSecondsPerKm } from "../formatters";

interface FitnessScoresPanelProps {
  dashboard: TrainingHubDashboard | null;
  racePredictor: TrainingHubRacePredictor | null;
}

interface ScoreItem {
  label: string;
  value?: number;
}

interface MetricItem {
  label: string;
  value?: number;
  format: (value?: number) => string;
}

function hasValue(value?: number): value is number {
  return value !== undefined && Number.isFinite(value);
}

function ScoreBar({ label, value }: ScoreItem) {
  const percent =
    value !== undefined ? Math.max(0, Math.min(100, value)) : undefined;

  return (
    <div className="score-bar">
      <div className="score-bar-header">
        <span>{label}</span>
        <strong>{formatOptionalNumber(value)}</strong>
      </div>
      <div className="score-bar-track">
        <span
          className="score-bar-fill"
          style={{ width: percent !== undefined ? `${percent}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function formatBpm(value?: number): string {
  return hasValue(value) ? `${Math.round(value)} bpm` : "-";
}

export function FitnessScoresPanel({
  dashboard,
  racePredictor
}: FitnessScoresPanelProps) {
  const predictor = racePredictor ?? dashboard?.racePredictor ?? null;

  if (!dashboard && !predictor) {
    return (
      <section className="panel training-scores-panel">
        <header className="training-scores-header">
          <div className="training-scores-heading">
            <p className="eyebrow">Fitness Scores</p>
            <h2>Not loaded</h2>
          </div>
          <BarChart3 size={22} aria-hidden="true" />
        </header>
        <p className="training-empty-chart">Fitness scores could not be loaded.</p>
      </section>
    );
  }

  const scores: ScoreItem[] = [
    { label: "Aerobic Endurance", value: predictor?.aerobicEnduranceScore },
    {
      label: "Lactate Threshold",
      value: predictor?.lactateThresholdCapacityScore
    },
    { label: "Anaerobic Endurance", value: predictor?.anaerobicEnduranceScore },
    { label: "Anaerobic Capacity", value: predictor?.anaerobicCapacityScore }
  ].filter((score) => hasValue(score.value));

  const metrics: MetricItem[] = [
    { label: "LTHR", value: predictor?.lthr, format: formatBpm },
    { label: "LT Pace", value: predictor?.ltsp, format: formatPaceSecondsPerKm },
    { label: "Max HR", value: dashboard?.fitnessMaxHr, format: formatBpm },
    { label: "Run Level HR", value: dashboard?.runningLevelHr, format: formatBpm }
  ];

  return (
    <section className="panel training-scores-panel">
      <header className="training-scores-header">
        <div className="training-scores-heading">
          <p className="eyebrow">Fitness Scores</p>
          <h2>{scores.length > 0 ? "EvoLab breakdown" : "Threshold profile"}</h2>
        </div>
        <BarChart3 size={22} aria-hidden="true" />
      </header>

      {scores.length > 0 ? (
        <div className="score-bar-list">
          {scores.map((score) => (
            <ScoreBar key={score.label} label={score.label} value={score.value} />
          ))}
        </div>
      ) : null}

      <div className="training-threshold-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.format(metric.value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
