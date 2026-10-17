import { t, useLanguage, getLocale } from "../../i18n/training";
import { CloudOff } from "lucide-react";
import type { HealthInsightResult } from "../../../electron/healthInsightsTypes";
import { DAY_ONLY, badgeTone, formatNumber, localDay, parseRange, toEpoch } from "../healthInsightsFormat";

/** Overnight samples further apart than this belong to different nights. */
const NIGHT_GAP_MS = 3 * 60 * 60 * 1000;

/** COROS boilerplate that the card already says in its own layout. */
const BOILERPLATE = [/^note:\s*dates are wake-up days/i, /\bno\b.*\b(?:data|found)\b/i];

/** COROS files each night under the morning it ended (its "wake-up day"). */
export function sleepHrvNight(result: HealthInsightResult): string | undefined {
  const average = result.series.find(item => item.key === "average")?.points.at(-1)?.time;
  if (average && DAY_ONLY.test(average)) return average;
  const sample = result.series.find(item => item.key === "hrv")?.points.at(-1)?.time;
  return sample ? localDay(sample) : undefined;
}

/** Narrow a multi-night window to its latest night: that morning's summary and the samples leading up to it. */
export function latestSleepHrvNight(result: HealthInsightResult): HealthInsightResult | undefined {
  const night = sleepHrvNight(result);
  if (!night || !result.metrics.some(metric => metric.key === "average")) return undefined;
  const series = result.series.map(item => {
    if (DAY_ONLY.test(item.points.at(-1)?.time ?? "")) return { ...item, points: item.points.filter(point => point.time === night) };
    let start = item.points.length - 1;
    while (start > 0 && toEpoch(item.points[start].time) - toEpoch(item.points[start - 1].time) <= NIGHT_GAP_MS) start--;
    const points = item.points.slice(Math.max(start, 0));
    return { ...item, points: points.length && localDay(points[points.length - 1].time) === night ? points : [] };
  }).filter(item => item.points.length);
  return { ...result, days: 1, series };
}

/** "Last night · Oct 13 – 14" for this morning, otherwise "Night of Oct 12 – 13". */
export function sleepHrvNightLabel(night: string, now = new Date()): string {
  const end = new Date(`${night}T12:00:00`);
  const start = new Date(end);
  start.setDate(end.getDate() - 1);
  const span = new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).formatRange(start, end);
  return night === localDay(now) ? t("Last night · {{span}}", { span }) : t("Night of {{span}}", { span });
}

/** Lines of the COROS report the card does not already show. */
export function sleepHrvNotes(report: string | undefined): string | undefined {
  const lines = (report ?? "").split("\n").map(line => line.trim()).filter(line => line && !BOILERPLATE.some(pattern => pattern.test(line)));
  return lines.length ? lines.join("\n\n") : undefined;
}

function ReferenceGauge({ value, range, baseline }: { value: number; range?: [number, number]; baseline?: number }) {
  useLanguage();
  const marks = [value, ...(range ?? []), ...(baseline !== undefined ? [baseline] : [])];
  const low = Math.min(...marks);
  const high = Math.max(...marks);
  const pad = Math.max((high - low) * 0.3, 8);
  const min = Math.max(0, low - pad);
  const max = high + pad;
  const at = (point: number) => ((point - min) / (max - min)) * 100;
  const label = [`${formatNumber(value)} ms`, range && `normal range ${range[0]} to ${range[1]} ms`, baseline !== undefined && `baseline ${baseline} ms`].filter(Boolean).join(", ");
  return <div className="health-hrv-gauge" role="img" aria-label={label}>
    {range && <span className="health-hrv-gauge-range" style={{ left: `${at(range[0])}%`, width: `${at(range[1]) - at(range[0])}%` }} />}
    {baseline !== undefined && <span className="health-hrv-gauge-baseline" style={{ left: `${at(baseline)}%` }} />}
    <span className="health-hrv-gauge-value" style={{ left: `${at(value)}%` }} />
  </div>;
}

/**
 * Sleep HRV headline: COROS' nightly average and assessment for the latest night, where it sits against the
 * normal range and baseline, and the spread of the window (overnight samples today, nightly averages for a week).
 */
export function SleepHrvSummary({ result, part }: { result: HealthInsightResult; part?: "primary" | "details" }) {
  useLanguage();
  const average = result.metrics.find(metric => metric.key === "average");
  if (typeof average?.value !== "number") return null;
  const evaluation = result.metrics.find(metric => metric.key === "evaluation");
  const rangeMetric = result.metrics.find(metric => metric.key === "normalRange");
  const range = rangeMetric ? parseRange(rangeMetric.value) : undefined;
  const baselineMetric = result.metrics.find(metric => metric.key === "baseline");
  const baseline = typeof baselineMetric?.value === "number" ? baselineMetric.value : undefined;
  const night = sleepHrvNight(result);
  const nights = result.series.find(item => item.key === "average")?.points ?? [];
  const samples = result.series.find(item => item.key === "hrv")?.points ?? [];
  const week = nights.length > 1;
  const spread = (week ? nights : samples).map(point => point.value);
  const stats = spread.length > 1 ? [
    ...(week ? [{ label: t("Average"), value: spread.reduce((sum, value) => sum + value, 0) / spread.length }] : []),
    { label: t("Low"), value: Math.min(...spread) },
    { label: t("High"), value: Math.max(...spread) }
  ] : [];
  return <>
    <div className="health-insight-hero">
      {part !== "details" && <div className="health-insight-primary">
        <span className="health-insight-value">{formatNumber(average.value)}<small>ms</small></span>
        {night && <span className="health-insight-caption">{sleepHrvNightLabel(night)}</span>}
        {typeof evaluation?.value === "string" && <span className={`health-insight-badge is-${badgeTone(evaluation.value)}`}>{t(evaluation.value)}</span>}
      </div>}
      {part !== "primary" && stats.length > 0 && <dl className="health-insight-stats" aria-label={week ? t("Nightly averages") : t("Overnight samples")}>
        {stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{formatNumber(stat.value)}</dd></div>)}
      </dl>}
    </div>
    {part !== "primary" && (range || baseline !== undefined) && <div className="health-hrv-reference">
      <ReferenceGauge value={average.value} range={range} baseline={baseline} />
      <p className="health-insight-legend">
        {range && <span><i className="is-range" />{t("Normal range")} {range[0]}–{range[1]} ms</span>}
        {baseline !== undefined && <span><i className="is-baseline" />{t("Baseline")}{baseline} ms</span>}
      </p>
    </div>}
  </>;
}

/** Shown when today's window is empty and the card fell back to the latest synced night. */
export function SleepHrvNotSynced({ compact }: { compact?: boolean }) {
  useLanguage();
  const hint = "Showing your latest night until your watch syncs with the COROS app.";
  return <p className="health-hrv-notice" role="note" title={compact ? hint : undefined}>
    <CloudOff size={14} aria-hidden="true" />
    <span><strong>{t("Last night isn’t synced yet.")}</strong>{!compact && <> {hint}</>}</span>
  </p>;
}

export function SleepHrvEmpty({ week }: { week: boolean }) {
  useLanguage();
  return <>
    <strong>{week ? t("No sleep HRV this week") : t("No HRV for last night yet")}</strong>
    <p>{t("Wear your watch to sleep, then sync it in the COROS app. Each night appears on the morning you wake up.")}</p>
  </>;
}
