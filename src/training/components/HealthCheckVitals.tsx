import { useMemo } from "react";
import type { CSSProperties } from "react";
import { Activity, Droplets, Heart, Wind, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HealthInsightMetric, HealthInsightPoint, HealthInsightResult, HealthInsightSeries } from "../../../electron/healthInsightsTypes";
import { useTheme } from "../../theme/ThemeProvider";
import { getHealthVitalColors } from "../chartConfig";
import type { HealthVitalKey } from "../chartConfig";
import { DAY_ONLY, formatNumber, formatTime, toEpoch } from "../healthInsightsFormat";

/** Tile wording, reused by the trend title and hint so a vital keeps one name across the card. */
export const HEALTH_VITAL_LABELS: Record<HealthVitalKey, string> = {
  heartRate: "Heart rate",
  hrv: "HRV",
  stress: "Stress",
  respiratoryRate: "Breathing",
  spo2: "Blood oxygen"
};

const VITALS: { key: HealthVitalKey; icon: LucideIcon }[] = [
  { key: "heartRate", icon: Heart },
  { key: "hrv", icon: Activity },
  { key: "stress", icon: Zap },
  { key: "respiratoryRate", icon: Wind },
  { key: "spo2", icon: Droplets }
];

/** COROS stress bands in the order the watch reports them (score 0–25, 26–50, 51–75, 76–100). */
const STRESS_BANDS = ["Relaxed", "Low", "Medium", "High"];

const SPARK_W = 100;
const SPARK_H = 30;
const SPARK_PAD = 4;

/**
 * Tiny time-scaled trend for a tile. Drawn in a fixed viewBox stretched to the tile,
 * so strokes and dots use non-scaling-stroke to keep their on-screen size.
 */
function Sparkline({ points, reference }: { points: HealthInsightPoint[]; reference?: number }) {
  const epochs = points.map(point => toEpoch(point.time));
  const values = points.map(point => point.value);
  const domain = reference === undefined ? values : [...values, reference];
  let min = Math.min(...domain);
  let max = Math.max(...domain);
  if (min === max) { min -= 1; max += 1; }
  const first = Math.min(...epochs);
  const last = Math.max(...epochs);
  const x = (epoch: number) => last === first ? SPARK_W / 2 : SPARK_PAD + ((epoch - first) / (last - first)) * (SPARK_W - 2 * SPARK_PAD);
  const y = (value: number) => SPARK_H - SPARK_PAD - ((value - min) / (max - min)) * (SPARK_H - 2 * SPARK_PAD);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(epochs[index]).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const latest = points[points.length - 1];
  return <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true" className="health-sparkline">
    {reference !== undefined && <line x1={0} x2={SPARK_W} y1={y(reference)} y2={y(reference)} className="health-sparkline-reference" vectorEffect="non-scaling-stroke" />}
    {points.length > 1 && <>
      <path d={`${line} L${x(last).toFixed(1)} ${SPARK_H} L${x(first).toFixed(1)} ${SPARK_H} Z`} className="health-sparkline-fill" />
      <path d={line} className="health-sparkline-line" vectorEffect="non-scaling-stroke" />
    </>}
    {/* A zero-length round-capped stroke stays circular under the non-uniform stretch. */}
    <path d={`M${x(epochs[epochs.length - 1]).toFixed(1)} ${y(latest.value).toFixed(1)} h0.01`} className="health-sparkline-dot" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** The four COROS stress bands with the reported one lit; the score marker is added when a score exists. */
function StressBands({ level, score }: { level?: string; score?: number }) {
  const lit = level ? STRESS_BANDS.findIndex(band => band.toLowerCase() === level.toLowerCase()) : -1;
  return <span className="health-stress-bands" role="img" aria-label={level ? `Stress band: ${level}` : "Stress bands"}>
    {STRESS_BANDS.map((band, index) => <i key={band} className={index === lit ? "is-lit" : undefined} />)}
    {score !== undefined && score > 0 && <b className="health-stress-marker" style={{ left: `${Math.min(100, score)}%` }} />}
  </span>;
}

interface Vital {
  key: HealthVitalKey;
  label: string;
  icon: LucideIcon;
  metric?: HealthInsightMetric;
  series?: HealthInsightSeries;
  value: number;
  unit?: string;
}

export function HealthCheckVitals({ result, days, selected, onSelect }: {
  result: HealthInsightResult; days: number; selected?: string; onSelect: (key: string) => void;
}) {
  const { theme } = useTheme();
  const colors = getHealthVitalColors(theme);
  const { vitals, resting, level, checks, latest } = useMemo(() => {
    const metric = (key: string) => result.metrics.find(item => item.key === key);
    const vitals: Vital[] = [];
    for (const vital of VITALS) {
      const item = metric(vital.key);
      const series = result.series.find(entry => entry.key === vital.key);
      const value = typeof item?.value === "number" ? item.value : series?.points.at(-1)?.value;
      if (value === undefined) continue;
      vitals.push({ ...vital, label: HEALTH_VITAL_LABELS[vital.key], metric: item, series, value, unit: item?.unit ?? series?.unit });
    }
    const restingMetric = metric("restingHeartRate");
    const levelMetric = metric("level");
    // One check produces one timestamp shared by every list, so distinct times ≈ checks taken.
    const times = new Set(result.series.flatMap(series => series.points.map(point => point.time)));
    const latest = [...times].sort((a, b) => toEpoch(b) - toEpoch(a))[0];
    return {
      vitals,
      resting: typeof restingMetric?.value === "number" ? restingMetric.value : undefined,
      level: typeof levelMetric?.value === "string" ? levelMetric.value : undefined,
      checks: times.size,
      latest
    };
  }, [result]);
  if (!vitals.length) return null;

  const period = days === 1 ? "today" : `in the last ${days} days`;
  return <>
    <p className="health-check-summary">
      <strong>{latest ? formatTime(latest, DAY_ONLY.test(latest) ? "day" : "full") : "Latest check"}</strong>
      {checks > 0 && <span>{checks} {checks === 1 ? "check" : "checks"} {period}{checks > 1 ? " · showing the latest" : ""}</span>}
    </p>
    <div className="health-vitals" role="group" aria-label="Health check readings">
      {vitals.map(vital => {
        const Icon = vital.icon;
        const points = vital.series?.points ?? [];
        const values = points.map(point => point.value);
        const digits = vital.value >= 20 ? 0 : 1;
        // Custom properties drive the tile hue and the beat/breath period (see healthInsights.css).
        const style: Record<string, string> = { "--vital": colors[vital.key] };
        if (vital.key === "heartRate") style["--beat"] = `${60 / Math.max(vital.value, 1)}s`;
        if (vital.key === "respiratoryRate") style["--breath"] = `${60 / Math.max(vital.value, 1)}s`;
        const foot = vital.key === "stress" ? level
          : vital.key === "heartRate" && resting !== undefined ? `Resting ${formatNumber(resting)} ${vital.unit ?? ""}`.trim()
          : points.length > 1 ? `${formatNumber(Math.min(...values), digits)}–${formatNumber(Math.max(...values), digits)} ${vital.unit ?? ""}`.trim()
          : undefined;
        const description = `${vital.label} ${formatNumber(vital.value, 1)} ${vital.unit ?? ""}${foot ? `, ${foot}` : ""}`.trim();
        return <button key={vital.key} type="button" className={`health-vital is-${vital.key}`} style={style as CSSProperties}
          aria-pressed={vital.series ? vital.key === selected : undefined} aria-label={description} disabled={!vital.series} onClick={() => onSelect(vital.key)}>
          <span className="health-vital-head"><span className="health-vital-icon" aria-hidden="true"><Icon size={14} /></span>{vital.label}</span>
          <span className="health-vital-value">{formatNumber(vital.value, 1)}{vital.unit && <small>{vital.unit}</small>}</span>
          <span className="health-vital-instrument">
            {vital.key === "stress" ? <StressBands level={level} score={vital.value} />
              : points.length > 0 ? <Sparkline points={points} reference={vital.key === "heartRate" ? resting : undefined} /> : null}
          </span>
          {foot && <span className={`health-vital-foot${vital.key === "stress" ? " is-level" : ""}`}>{foot}</span>}
        </button>;
      })}
    </div>
  </>;
}
