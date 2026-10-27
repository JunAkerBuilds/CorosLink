import { formatNumber, t, useLanguage, formatDate } from "../../i18n/training";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Gauge, Loader2 } from "lucide-react";
import type { TrainingHubActivity, TrainingHubActivityDetail } from "../../../electron/types";
import {
  cachedEfficiencyRuns,
  deriveActivityInsight,
  fillEfficiencyHistory,
  fillEfficiencyWindow,
  lastKnownEfficiencyProfile,
  runsMissingEfficiency,
  useActivityInsights
} from "../activityInsights";
import { activityTimestamp } from "../activityCollection";
import { formatTrainingTimestamp } from "../formatters";
import {
  BASELINE_DAYS,
  EFFICIENCY_CURVE_VERSION,
  efficiencyProfile,
  efficiencyTrend,
  median,
  readRunEfficiency,
  sportHasRunEfficiency,
  type CachedEfficiencyRun,
  type EfficiencyProfile,
  type EfficiencyTrendPoint,
  type EfficiencyVerdict
} from "../runEfficiency";
import type { TrainingHubSnapshot } from "../types";
import type { ChartCardSize } from "../widgetSizing";
import "../runEfficiency.css";

const DAY = 86_400;
const VERDICT_TEXT: Record<EfficiencyVerdict, string> = {
  better: "Better than usual",
  usual: "As usual",
  worse: "Below usual"
};

function formatFigure(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatChange(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${formatNumber(Math.abs(rounded), { maximumFractionDigits: 1 })}%`;
}

/** A callback ref, so a chart box that appears after the first render (once runs are read) is measured too. */
function useElementWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

/** The account's heart-rate profile: the snapshot's when it has one, else the one last kept. */
export function useEfficiencyProfile(snapshot?: TrainingHubSnapshot | null): EfficiencyProfile | undefined {
  useActivityInsights();
  const fromSnapshot = efficiencyProfile(snapshot?.dashboard?.fitnessMaxHr, snapshot?.dashboard?.rhr);
  if (fromSnapshot) return fromSnapshot;
  const kept = lastKnownEfficiencyProfile();
  return kept ? efficiencyProfile(kept.maxHr, kept.restingHr) : undefined;
}

// ---------------------------------------------------------------------------
// One run's page.
// ---------------------------------------------------------------------------

interface RunEfficiencyPanelProps {
  detail: TrainingHubActivityDetail;
  listActivity: TrainingHubActivity | null;
}

/** How much speed a road or track run bought for its heart rate, against the six weeks before it. */
export function RunEfficiencyPanel({ detail, listActivity }: RunEfficiencyPanelProps) {
  useLanguage();
  const store = useActivityInsights();
  const profile = useEfficiencyProfile();
  const insight = deriveActivityInsight(detail, listActivity);
  const sportType = detail.sportType ?? listActivity?.sportType;
  const startTime = insight?.startTime;
  useEffect(() => {
    if (startTime) fillEfficiencyWindow(startTime);
  }, [startTime]);
  const [chartRef, width] = useElementWidth<HTMLDivElement>();

  const reading = useMemo(() => {
    if (!insight?.curve || !profile || startTime === undefined) return undefined;
    const run: CachedEfficiencyRun = { activityId: insight.activityId, startTime, seconds: insight.seconds, curve: insight.curve };
    const history = cachedEfficiencyRuns(store).filter((entry) => entry.activityId !== run.activityId);
    return readRunEfficiency(run, [...history, run], profile);
  }, [insight, profile, store, startTime]);

  if (!sportHasRunEfficiency(sportType) || !insight?.curve) return null;

  const pending = profile && reading && reading.verdict === undefined;
  return (
    <section className="activity-detail-visual-panel run-efficiency-panel">
      <div className="activity-detail-visual-heading">
        <h3>
          <Gauge size={17} aria-hidden="true" />
          {t("Running efficiency")}</h3>
        {reading?.verdict ? (
          <span className={`run-efficiency-verdict is-${reading.verdict}`}>{t(VERDICT_TEXT[reading.verdict])}</span>
        ) : null}
      </div>
      {!profile ? (
        <p className="run-efficiency-note">{t("Needs your maximum and resting heart rate from COROS. Open Training Hub once to read them.")}</p>
      ) : !reading ? (
        <p className="run-efficiency-note">{t("Too little steady running after the warm-up to read this run.")}</p>
      ) : (
        <>
          <div className="run-efficiency-figures">
            <div className="run-efficiency-figure">
              <strong>{formatFigure(reading.value)}</strong>
              <small>{reading.scaled ? t("on your VO2 max scale") : "ml/kg/min"}</small>
            </div>
            {reading.usual !== undefined && reading.change !== undefined ? (
              <div className="run-efficiency-figure is-usual">
                <strong>{formatChange(reading.change)}</strong>
                <small>{t("vs your usual {{value}}", { value: formatFigure(reading.usual) })}</small>
              </div>
            ) : null}
            {reading.durability ? (
              <div className="run-efficiency-figure is-durability">
                <strong>{formatChange(reading.durability.change)}</strong>
                <small>
                  {reading.durability.usual !== undefined
                    ? t("last 20 min vs minutes 10–40 (usual {{usual}})", { usual: formatChange(reading.durability.usual) })
                    : t("last 20 min vs minutes 10–40")}
                </small>
              </div>
            ) : null}
          </div>
          <div ref={chartRef} className="run-efficiency-chart">
            {width > 0 && reading.points.length > 1 ? (
              <EfficiencyCurveChart points={reading.points} usual={reading.usual} width={width} />
            ) : null}
          </div>
          <p className="run-efficiency-note">
            {pending
              ? t("Compared with your usual once three road or track runs from the six weeks before have been read.")
              : t("Speed for the heart rate it cost, read on effort pace after the warm-up, against your road and track runs of the six weeks before.")}
          </p>
        </>
      )}
    </section>
  );
}

function EfficiencyCurveChart({ points, usual, width }: { points: { t: number; value: number }[]; usual?: number; width: number }) {
  const height = 92;
  const pad = { left: 4, right: 4, top: 8, bottom: 16 };
  const values = points.map((point) => point.value);
  const band = usual !== undefined ? [usual * 0.97, usual * 1.03] : undefined;
  const low = Math.min(...values, ...(band ? [band[0]] : [])) * 0.98;
  const high = Math.max(...values, ...(band ? [band[1]] : [])) * 1.02;
  const first = points[0]!.t;
  const last = points[points.length - 1]!.t;
  const x = (t: number) => pad.left + ((t - first) / Math.max(1, last - first)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - low) / Math.max(1e-6, high - low)) * (height - pad.top - pad.bottom);
  // A gap of more than two steps (an unsteady stretch) breaks the line.
  const path = points
    .map((point, index) => `${index === 0 || point.t - points[index - 1]!.t > 60 ? "M" : "L"}${x(point.t).toFixed(1)} ${y(point.value).toFixed(1)}`)
    .join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("Efficiency through the run")}>
      {band ? (
        <>
          <rect className="run-efficiency-band" x={pad.left} y={y(band[1])} width={width - pad.left - pad.right} height={Math.max(1, y(band[0]) - y(band[1]))} />
          <line className="run-efficiency-usual" x1={pad.left} x2={width - pad.right} y1={y(usual!)} y2={y(usual!)} />
        </>
      ) : null}
      <path className="run-efficiency-line" d={path} />
      <text className="run-efficiency-axis" x={pad.left} y={height - 3}>{Math.round(first / 60)}′</text>
      <text className="run-efficiency-axis" x={width - pad.right} y={height - 3} textAnchor="end">{Math.round(last / 60)}′</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dashboard widget: the last six weeks of runs.
// ---------------------------------------------------------------------------

const PERIOD_DAYS = 42;
/** Runs read for the widget: the period plus the six weeks each needs before it. */
const FILL_DAYS = PERIOD_DAYS + BASELINE_DAYS;
const FILL_LIMIT = 60;

/** Deterministic curves for the sample dashboard: steady runs at each sample's pace and heart rate. */
function sampleEfficiencyRuns(activities: readonly TrainingHubActivity[]): CachedEfficiencyRun[] {
  return activities
    .filter((activity) => sportHasRunEfficiency(activity.sportType) && activity.distance && activity.duration)
    .map((activity, index) => {
      const seconds = activity.movingTime ?? activity.duration!;
      const speed = (activity.distance! / seconds) * 60;
      const hr = activity.avgHr ?? 148;
      const points: [number, number, number][] = [];
      for (let step = 600; step < seconds - 120; step += 30) {
        points.push([step, Math.round((speed * (1 + 0.012 * Math.sin(step / 400 + index))) * 10) / 10, hr]);
      }
      return {
        activityId: activity.activityId,
        startTime: Math.round(activityTimestamp(activity.startTime) / 1000),
        seconds,
        curve: { version: EFFICIENCY_CURVE_VERSION, corosVo2max: 53, points }
      };
    });
}

interface RunningEfficiencyWidgetProps {
  size?: ChartCardSize;
  snapshot: TrainingHubSnapshot | null;
  activities: readonly TrainingHubActivity[];
  loadDetail: (activity: TrainingHubActivity) => Promise<TrainingHubActivityDetail>;
  sampleMode?: boolean;
}

export function RunningEfficiencyWidget({ size = "standard", snapshot, activities, loadDetail, sampleMode = false }: RunningEfficiencyWidgetProps) {
  useLanguage();
  const store = useActivityInsights();
  const profile = useEfficiencyProfile(snapshot) ?? (sampleMode ? efficiencyProfile(190, 50) : undefined);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    if (sampleMode || !profile) return;
    const missing = runsMissingEfficiency(activities, now - FILL_DAYS * DAY).slice(0, FILL_LIMIT);
    if (missing.length === 0) return;
    let stopped = false;
    setProgress({ done: 0, total: missing.length });
    void fillEfficiencyHistory(missing, loadDetail, (done, total) => {
      if (!stopped) setProgress({ done, total });
    }, () => stopped).finally(() => {
      if (!stopped) setProgress(null);
    });
    return () => {
      stopped = true;
    };
    // `now` moves every render; the activity list and the profile decide what is missing.
  }, [activities, loadDetail, sampleMode, Boolean(profile)]);

  const trend = useMemo<EfficiencyTrendPoint[]>(() => {
    if (!profile) return [];
    const runs = sampleMode ? sampleEfficiencyRuns(activities) : cachedEfficiencyRuns(store);
    return efficiencyTrend(runs, profile, now - PERIOD_DAYS * DAY);
  }, [profile, store, activities, sampleMode, Math.floor(now / 3600)]);

  const latest = trend.at(-1);
  const latestReading = latest
    ? (() => {
        const runs = sampleMode ? sampleEfficiencyRuns(activities) : cachedEfficiencyRuns(store);
        const run = runs.find((entry) => entry.activityId === latest.activityId);
        return run && profile ? readRunEfficiency(run, runs, profile) : undefined;
      })()
    : undefined;
  const periodMedian = trend.length > 0 ? median(trend.map((point) => point.value)) : undefined;
  const [chartRef, width] = useElementWidth<HTMLDivElement>();
  const chartHeight = size === "tall" ? 220 : size === "mini" ? 72 : size === "short" ? 110 : 150;

  return (
    <section className={`panel run-efficiency-widget size-${size}`}>
      <div className="run-efficiency-widget-header">
        <div>
          <p className="eyebrow">{t("Running efficiency")}</p>
          <h2>{t("Speed for heart rate")}</h2>
        </div>
        {latestReading?.verdict ? (
          <span className={`run-efficiency-verdict is-${latestReading.verdict}`}>{t(VERDICT_TEXT[latestReading.verdict])}</span>
        ) : progress ? (
          <span className="run-efficiency-progress">
            <Loader2 className="spin" size={13} aria-hidden="true" />
            {t("Reading runs {{done}} of {{total}}", { done: progress.done, total: progress.total })}
          </span>
        ) : null}
      </div>

      {!profile ? (
        <p className="run-efficiency-note">{t("Needs your maximum and resting heart rate from COROS.")}</p>
      ) : trend.length === 0 ? (
        <p className="run-efficiency-note">
          {progress
            ? t("Reading your road and track runs from the last twelve weeks…")
            : t("Run on the road or track with heart rate, ten minutes or more past the warm-up, to see your efficiency.")}
        </p>
      ) : (
        <>
          <div ref={chartRef} className="run-efficiency-trend" style={{ "--chart-height": `${chartHeight}px` } as CSSProperties}>
            {width > 0 ? (
              <EfficiencyTrendChart points={trend} usual={latestReading?.usual} width={width} height={chartHeight} from={now - PERIOD_DAYS * DAY} to={now} />
            ) : null}
          </div>
          <div className="vo2-widget-footer run-efficiency-footer">
            <div>
              <span>{t("Latest run")}</span>
              <strong title={latest ? formatTrainingTimestamp(latest.startTime) : undefined}>
                {latest ? formatFigure(latest.value) : "-"}
                {latestReading?.change !== undefined ? <em> {formatChange(latestReading.change)}</em> : null}
              </strong>
            </div>
            <div>
              <span>{t("6-week median")}</span>
              <strong>{periodMedian !== undefined ? formatFigure(periodMedian) : "-"}</strong>
            </div>
            <div>
              <span>{t("Runs read")}</span>
              <strong>{formatNumber(trend.length)}</strong>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function EfficiencyTrendChart({ points, usual, width, height, from, to }: {
  points: EfficiencyTrendPoint[];
  usual?: number;
  width: number;
  height: number;
  from: number;
  to: number;
}) {
  useLanguage();
  const pad = { left: 30, right: 8, top: 10, bottom: 18 };
  const values = points.map((point) => point.value);
  const low = Math.floor(Math.min(...values, ...(usual !== undefined ? [usual * 0.97] : [])) - 1);
  const high = Math.ceil(Math.max(...values, ...(usual !== undefined ? [usual * 1.03] : [])) + 1);
  const x = (time: number) => pad.left + ((time - from) / Math.max(1, to - from)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - low) / Math.max(1e-6, high - low)) * (height - pad.top - pad.bottom);
  // A rolling seven-day median, so one hot day does not read as a trend.
  const rolling = points.map((point) => ({
    startTime: point.startTime,
    value: median(points.filter((other) => other.startTime <= point.startTime && other.startTime > point.startTime - 7 * DAY).map((other) => other.value))
  }));
  const rollingPath = rolling.map((point, index) => `${index ? "L" : "M"}${x(point.startTime).toFixed(1)} ${y(point.value).toFixed(1)}`).join("");
  const ticks = [low, Math.round((low + high) / 2), high];
  const weeks = [6, 4, 2, 0].map((week) => to - week * 7 * DAY);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("Running efficiency, each run of the last six weeks")}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="run-efficiency-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
          <text className="run-efficiency-axis" x={pad.left - 6} y={y(tick)} dy="0.35em" textAnchor="end">{tick}</text>
        </g>
      ))}
      {usual !== undefined ? (
        <>
          <rect className="run-efficiency-band" x={pad.left} y={y(usual * 1.03)} width={width - pad.left - pad.right} height={Math.max(1, y(usual * 0.97) - y(usual * 1.03))} />
          <line className="run-efficiency-usual" x1={pad.left} x2={width - pad.right} y1={y(usual)} y2={y(usual)} />
        </>
      ) : null}
      {rolling.length > 1 ? <path className="run-efficiency-line" d={rollingPath} /> : null}
      {points.map((point) => (
        <circle key={point.activityId} className={`run-efficiency-dot is-${point.verdict ?? "unrated"}`} cx={x(point.startTime)} cy={y(point.value)} r={3.5}>
          <title>{`${formatTrainingTimestamp(point.startTime)} · ${formatFigure(point.value)}${point.verdict ? ` · ${t(VERDICT_TEXT[point.verdict])}` : ""}`}</title>
        </circle>
      ))}
      {weeks.map((time) => (
        <text key={time} className="run-efficiency-axis" x={x(time)} y={height - 4} textAnchor={time === to ? "end" : time === from ? "start" : "middle"}>
          {formatDate(new Date(time * 1000), { month: "short", day: "numeric" })}
        </text>
      ))}
    </svg>
  );
}
