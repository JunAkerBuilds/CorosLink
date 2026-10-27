import { formatNumber, t, useLanguage } from "../../i18n/training";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Flame, Footprints, Gauge, Heart, HeartPulse, Moon, Sparkles, Trophy, TrendingDown, Zap } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { TrainingHubActivity, TrainingHubDailyHealthRecord } from "../../../electron/types";
import type { TrainingTrendPoint } from "../types";
import { formatDurationSeconds } from "../formatters";
import { resolveSportName } from "../sportTypes";
import { sportColorCategory } from "../sportColors";
import { formatSleepDuration } from "../sleepWeek";
import {
  METRIC_RANGES,
  STEP_GOAL,
  activitiesOn,
  buildMetricSummary,
  formatMetricValue,
  loadBalanceLabel,
  metricIsSum,
  metricReadings,
  metricTitle,
  metricUnit,
  type MetricDay,
  type MetricKind,
  type MetricRange,
  type MetricSummary
} from "../metricDetail";
import "../sleepWeek.css";
import "../metricDetail.css";

/** Steps and calories history the page asks COROS for when it opens (the hub keeps only today). */
const HISTORY_DAYS = 2 * Math.max(...METRIC_RANGES) + 1;

interface MetricDetailPageProps {
  kind: MetricKind;
  trendPoints?: TrainingTrendPoint[];
  healthRecords?: TrainingHubDailyHealthRecord[];
  activities?: TrainingHubActivity[];
  /** Local-Only Mode: calories are the watch's active calories. */
  local?: boolean;
  /** Reads more days of steps and calories than the hub loaded. */
  loadHealthHistory?: (days: number) => Promise<TrainingHubDailyHealthRecord[]>;
  /** Back to the Training Hub; the hub morphs the page into the card. */
  onBack: () => void;
}

function MetricIcon({ kind, size = 17 }: { kind: MetricKind; size?: number }) {
  switch (kind) {
    case "heart": return <Heart size={size} />;
    case "steps": return <Footprints size={size} />;
    case "calories": return <Zap size={size} />;
    default: return <Flame size={size} />;
  }
}

function unitFor(kind: MetricKind, value?: number): string {
  if (kind === "steps") return value === 1 ? t("step", undefined, "daily") : t("steps", undefined, "daily");
  return metricUnit(kind);
}

function ChangePill({ summary }: { summary: MetricSummary }) {
  useLanguage();
  const { change, kind, range } = summary;
  if (change === undefined) return null;
  const heart = kind === "heart";
  const rounded = heart ? Math.round(change) : Math.round(change);
  const label = t("vs previous {{value1}} days", { value1: String(range) });
  if (rounded === 0) return <span className="metric-change">{t("Same as the previous {{value1}} days", { value1: String(range) })}</span>;
  const Icon = rounded > 0 ? ArrowUp : ArrowDown;
  const amount = heart ? `${Math.abs(rounded)} bpm` : `${Math.abs(rounded)}%`;
  const signed = `${rounded > 0 ? "+" : "−"}${amount}`;
  // A lower resting HR is the good direction; for the totals, more is simply more.
  const tone = heart ? (rounded < 0 ? "is-good" : "is-watch") : rounded > 0 ? "is-up" : "is-down";
  return (
    <span className={`metric-change ${tone}`} role="img" aria-label={`${signed} ${label}`}>
      <Icon size={12} strokeWidth={2.6} aria-hidden="true" />
      {amount} {label}
    </span>
  );
}

function StatTile({ label, icon, value, unit, foot, accent }: {
  label: string; icon: ReactNode; value: string; unit?: string; foot?: ReactNode; accent?: boolean;
}) {
  return (
    <div className={`metric-stat${accent ? " is-accent" : ""}`}>
      <span className="metric-stat-icon" aria-hidden="true">{icon}</span>
      <span className="metric-stat-label">{label}</span>
      <strong className="metric-stat-value">{value}{unit ? <small>{unit}</small> : null}</strong>
      <span className="metric-stat-foot">{foot}</span>
    </div>
  );
}

function Stats({ summary }: { summary: MetricSummary }) {
  useLanguage();
  const { kind, range } = summary;
  const unit = metricUnit(kind);
  const dayFoot = (day?: MetricDay) => day ? day.weekdayLong : t("No data");
  if (kind === "heart") {
    return (
      <div className="metric-stats">
        <StatTile accent label={t("Latest")} icon={<HeartPulse size={15} strokeWidth={2.2} />}
          value={formatMetricValue(summary.current?.value, kind)} unit={unit}
          foot={summary.verdict ? <span className={`metric-verdict is-${summary.verdict.key}`}>{summary.verdict.label}</span> : t("Needs a few nights")} />
        <StatTile label={t("{{value1}}-day average", { value1: String(range) })} icon={<Gauge size={15} strokeWidth={2.2} />}
          value={formatMetricValue(summary.average, kind)} unit={unit}
          foot={t("{{value1}} nights measured", { value1: String(summary.counted) })} />
        <StatTile label={t("Lowest")} icon={<TrendingDown size={15} strokeWidth={2.2} />}
          value={formatMetricValue(summary.low?.value, kind)} unit={unit} foot={dayFoot(summary.low)} />
        <StatTile label={t("Highest")} icon={<ArrowUp size={15} strokeWidth={2.2} />}
          value={formatMetricValue(summary.peak?.value, kind)} unit={unit} foot={dayFoot(summary.peak)} />
      </div>
    );
  }
  const last = kind === "load"
    ? <StatTile label={t("Training days")} icon={<CalendarDays size={15} strokeWidth={2.2} />}
        value={String(summary.counted)} unit={t("of {{value1}}", { value1: String(range) })}
        foot={t("{{value1}} rest days", { value1: String(Math.max(0, summary.days.filter((day) => day.value !== undefined).length - summary.counted)) })} />
    : kind === "steps"
      ? <StatTile label={t("10k days")} icon={<Trophy size={15} strokeWidth={2.2} />}
          value={String(summary.goalDays ?? 0)} unit={t("of {{value1}}", { value1: String(summary.counted) })}
          foot={t("Days at {{value1}} steps or more", { value1: formatNumber(STEP_GOAL) })} />
      : <StatTile label={t("Days measured")} icon={<CalendarDays size={15} strokeWidth={2.2} />}
          value={String(summary.counted)} unit={t("of {{value1}}", { value1: String(range) })}
          foot={t("Days with a reading")} />;
  return (
    <div className="metric-stats">
      <StatTile accent label={t("{{value1}}-day total", { value1: String(range) })} icon={<MetricIcon kind={kind} size={15} />}
        value={formatMetricValue(summary.total, kind)} unit={unit} foot={<ChangePill summary={summary} />} />
      <StatTile label={t("This week")} icon={<Gauge size={15} strokeWidth={2.2} />}
        value={formatMetricValue(summary.weeks.at(-1)?.value, kind)} unit={unit}
        foot={t("Monday to today")} />
      <StatTile label={kind === "load" ? t("Peak day") : t("Best day")} icon={<Sparkles size={15} strokeWidth={2.2} />}
        value={formatMetricValue(summary.peak?.value, kind)} unit={unit} foot={dayFoot(summary.peak)} />
      {last}
    </div>
  );
}

function percent(value: number, summary: MetricSummary): number {
  const span = summary.axisMax - summary.axisMin || 1;
  return Math.min(100, Math.max(0, (value - summary.axisMin) / span * 100));
}

function xLabel(day: MetricDay, range: MetricRange, fromEnd: number): string {
  if (range === 7) return day.weekday;
  // "Today" labels the last column; keep the dates before it clear of it.
  if (fromEnd < (range === 30 ? 4 : 10)) return "";
  if (range === 30) return day.isWeekStart ? day.shortDate : "";
  return day.isMonthStart ? day.shortDate : "";
}

function DailyChart({ summary, selected, onSelect }: { summary: MetricSummary; selected: string; onSelect: (date: string) => void }) {
  useLanguage();
  const columns = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const { days, kind, range } = summary;
  const sum = metricIsSum(kind);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const jump = event.key === "Home" ? -days.length : event.key === "End" ? days.length : 0;
    if (!step && !jump) return;
    const index = days.findIndex((day) => day.date === selected);
    const next = days[Math.min(days.length - 1, Math.max(0, index + (step || jump)))];
    if (!next) return;
    event.preventDefault();
    onSelect(next.date);
    columns.current?.querySelector<HTMLButtonElement>(`[data-day="${next.date}"]`)?.focus();
  };
  // Resting HR is a line through each night's dot, broken where a night is missing.
  const line = sum ? "" : days.map((day, index) => day.value === undefined ? "" :
    `${index === 0 || days[index - 1].value === undefined ? "M" : "L"}${index + 0.5},${100 - percent(day.value, summary)}`
  ).join(" ");
  const area = sum ? "" : days.map((day, index) => {
    if (day.value === undefined) return "";
    const x = index + 0.5;
    const y = 100 - percent(day.value, summary);
    const starts = index === 0 || days[index - 1].value === undefined;
    const ends = index === days.length - 1 || days[index + 1].value === undefined;
    return `${starts ? `M${x},100 L` : "L"}${x},${y}${ends ? ` L${x},100 Z` : ""}`;
  }).join(" ");

  return (
    <div className={`metric-chart is-${range}`} style={{ "--cols": days.length } as CSSProperties}>
      <div className="metric-chart-y" aria-hidden="true">
        {summary.ticks.map((tick) => (
          <span key={tick} style={{ bottom: `${percent(tick, summary)}%` }}>{formatMetricValue(tick, kind, { compact: true })}</span>
        ))}
      </div>
      <div className="metric-chart-plot">
        <div className="metric-chart-grid" aria-hidden="true">
          {summary.ticks.map((tick) => <i key={tick} style={{ bottom: `${percent(tick, summary)}%` }} />)}
          {kind === "steps" && STEP_GOAL <= summary.axisMax ? (
            <b className="is-goal" style={{ bottom: `${percent(STEP_GOAL, summary)}%` }}><span>{t("10k")}</span></b>
          ) : null}
          {summary.average !== undefined && summary.counted > 1 ? (
            <b className="is-average" style={{ bottom: `${percent(summary.average, summary)}%` }}>
              <span>{t("Avg {{value1}}", { value1: formatMetricValue(summary.average, kind, { compact: true }) })}</span>
            </b>
          ) : null}
        </div>
        {!sum ? (
          <svg className="metric-chart-line" viewBox={`0 0 ${days.length} 100`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradientId})`} />
            <path d={line} fill="none" stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
        <div className="metric-chart-cols" ref={columns} onKeyDown={move} role="group" aria-label={t("Daily readings")}>
          {days.map((day) => {
            const isSelected = day.date === selected;
            const value = day.value;
            const height = value === undefined ? 0 : percent(value, summary);
            const peak = summary.peak?.date === day.date && (kind !== "load" || (value ?? 0) > 0);
            return (
              <button
                key={day.date}
                type="button"
                data-day={day.date}
                className={`metric-col${isSelected ? " is-selected" : ""}${value === undefined ? " is-missing" : ""}${day.isToday ? " is-today" : ""}${peak && sum ? " is-peak" : ""}`}
                aria-pressed={isSelected}
                aria-label={value === undefined
                  ? t("{{value1}}: no data", { value1: day.weekdayLong })
                  : `${day.weekdayLong}: ${formatMetricValue(value, kind)} ${unitFor(kind, value)}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelect(day.date)}
                style={{ "--h": `${height}%` } as CSSProperties}
              >
                {value === undefined ? null : sum
                  ? <span className={`metric-bar${value === 0 ? " is-zero" : ""}`} />
                  : <span className="metric-dot" />}
                {value !== undefined ? <span className="metric-tip" aria-hidden="true">{formatMetricValue(value, kind)}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="metric-chart-x" aria-hidden="true">
        {days.map((day, index) => (
          <span key={day.date} className={day.isToday ? "is-today" : undefined}>
            {day.isToday && range !== 7 ? t("Today") : xLabel(day, range, days.length - 1 - index)}
          </span>
        ))}
      </div>
    </div>
  );
}

function compareLine(value: number, summary: MetricSummary): string | undefined {
  const { average, kind, range } = summary;
  if (average === undefined || summary.counted < 3) return undefined;
  if (kind === "heart") {
    const delta = Math.round(value - average);
    if (delta === 0) return t("Right on your {{value1}}-day average", { value1: String(range) });
    return delta > 0
      ? t("{{value1}} bpm above your {{value2}}-day average", { value1: String(delta), value2: String(range) })
      : t("{{value1}} bpm below your {{value2}}-day average", { value1: String(-delta), value2: String(range) });
  }
  if (average <= 0) return undefined;
  const pct = Math.round((value - average) / average * 100);
  if (Math.abs(pct) < 3) return t("Right on your {{value1}}-day average", { value1: String(range) });
  return pct > 0
    ? t("{{value1}}% above your {{value2}}-day average", { value1: String(pct), value2: String(range) })
    : t("{{value1}}% below your {{value2}}-day average", { value1: String(-pct), value2: String(range) });
}

function ActivityRows({ kind, activities }: { kind: MetricKind; activities: TrainingHubActivity[] }) {
  useLanguage();
  return (
    <ul className="metric-activities">
      {activities.map((activity) => {
        const contribution = kind === "load"
          ? activity.trainingLoad !== undefined && activity.trainingLoad > 0 ? `${Math.round(activity.trainingLoad)}` : undefined
          : kind === "calories"
            ? activity.calories !== undefined ? `${formatNumber(Math.round(activity.calories))} kcal` : undefined
            : undefined;
        return (
          <li key={activity.activityId} style={{ "--sport": `var(--sport-${sportColorCategory(activity.sportType)})` } as CSSProperties}>
            <i aria-hidden="true" />
            <span className="metric-activity-name">{activity.name || resolveSportName(activity) || t("Activity")}</span>
            <span className="metric-activity-meta">{formatDurationSeconds(activity.movingTime ?? activity.duration)}</span>
            {contribution ? <strong className="metric-activity-value">{contribution}</strong> : null}
          </li>
        );
      })}
    </ul>
  );
}

function DayDetail({ summary, day, activities, point }: {
  summary: MetricSummary; day: MetricDay; activities: TrainingHubActivity[]; point?: TrainingTrendPoint;
}) {
  useLanguage();
  const { kind } = summary;
  const dayActivities = useMemo(() => activitiesOn(activities, day.date), [activities, day.date]);
  const value = day.value;
  const compare = value !== undefined ? compareLine(value, summary) : undefined;
  const isPeak = summary.peak?.date === day.date && summary.counted > 1 && (value ?? 0) > 0;
  const isLow = kind === "heart" && summary.low?.date === day.date && summary.counted > 1;
  const activityTotal = kind === "load"
    ? dayActivities.reduce((total, activity) => total + (activity.trainingLoad ?? 0), 0)
    : undefined;

  return (
    <section className="metric-card metric-day" aria-live="polite">
      <header className="metric-day-head">
        <p className="metric-day-date">
          {day.weekdayLong}
          {day.isToday ? <span className="metric-pill">{t("Today")}</span> : null}
          {isPeak && kind !== "heart" ? <span className="metric-pill is-accent"><Sparkles size={11} aria-hidden="true" />{t("Best of the period")}</span> : null}
          {isLow ? <span className="metric-pill is-good">{t("Lowest of the period")}</span> : null}
        </p>
        <div className="metric-day-figure">
          <strong className={value === undefined ? "is-empty" : undefined}>{formatMetricValue(value, kind)}</strong>
          {value !== undefined ? <span>{unitFor(kind, value)}</span> : null}
        </div>
        {compare ? <p className="metric-day-compare">{compare}</p> : null}
        {value === undefined ? (
          <p className="metric-day-compare">
            {day.isToday ? t("Nothing synced for today yet.") : kind === "heart" ? t("No overnight reading this day.") : t("No reading this day.")}
          </p>
        ) : null}
      </header>

      {kind === "steps" && value !== undefined ? (
        <div className="metric-goal">
          <span className="metric-goal-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, value / STEP_GOAL * 100)}%` }} />
          </span>
          <span className="metric-goal-copy">
            {value >= STEP_GOAL
              ? t("Past {{value1}} steps", { value1: formatNumber(STEP_GOAL) })
              : t("{{value1}} to go to {{value2}}", { value1: formatNumber(STEP_GOAL - Math.round(value)), value2: formatNumber(STEP_GOAL) })}
          </span>
        </div>
      ) : null}

      {kind === "heart" ? (
        <dl className="metric-day-metrics">
          <div><dt>{t("Overnight HRV")}</dt><dd>{point?.avgSleepHrv ? `${Math.round(point.avgSleepHrv)} ms` : t("No data")}</dd></div>
          <div><dt>{t("HRV baseline")}</dt><dd>{point?.sleepHrvBase ? `${Math.round(point.sleepHrvBase)} ms` : t("No data")}</dd></div>
          <div><dt>{t("Sleep")}</dt><dd>{point?.sleepMinutes ? formatSleepDuration(point.sleepMinutes) : t("No data")}</dd></div>
          <div><dt>{t("Training load")}</dt><dd>{point?.trainingLoad !== undefined ? String(Math.round(point.trainingLoad)) : t("No data")}</dd></div>
        </dl>
      ) : (
        <div className="metric-day-section">
          <p className="metric-day-section-title">
            {t("Activities")}
            {dayActivities.length ? <span>{dayActivities.length}</span> : null}
          </p>
          {dayActivities.length ? (
            <ActivityRows kind={kind} activities={dayActivities} />
          ) : (
            <p className="metric-muted">
              {kind === "load" ? t("Rest day: no activities recorded.") : t("No activities recorded this day.")}
            </p>
          )}
          {kind === "load" && value !== undefined && activityTotal !== undefined && dayActivities.length > 0 && Math.abs(activityTotal - value) > 1 ? (
            <p className="metric-muted">{t("COROS counts {{value1}} for the day.", { value1: String(Math.round(value)) })}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WeeksCard({ summary }: { summary: MetricSummary }) {
  useLanguage();
  const { kind, weeks } = summary;
  const values = weeks.flatMap((week) => week.value === undefined ? [] : [week.value]);
  if (!values.length) return null;
  const sum = metricIsSum(kind);
  const min = sum ? 0 : Math.min(...values) - 4;
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return (
    <section className="metric-card metric-weeks">
      <header className="metric-card-head">
        <h3>{sum ? t("Weekly totals") : t("Weekly averages")}</h3>
        <p>{t("The last {{value1}} weeks, Monday to Sunday", { value1: String(weeks.length) })}</p>
      </header>
      <div className="metric-weeks-bars">
        {weeks.map((week) => (
          <div key={week.start} className={`metric-week${week.isCurrent ? " is-current" : ""}${week.value === undefined ? " is-missing" : ""}`}
            style={{ "--h": week.value === undefined ? 0 : (week.value - min) / span } as CSSProperties}>
            <span className="metric-week-value">{formatMetricValue(week.value, kind, { compact: true })}</span>
            <span className="metric-week-bar" aria-hidden="true" />
            <span className="metric-week-label">{week.isCurrent ? t("This week") : week.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PatternCard({ summary }: { summary: MetricSummary }) {
  useLanguage();
  const { kind, pattern } = summary;
  const values = pattern.flatMap((day) => day.value === undefined ? [] : [day.value]);
  if (values.length < 4) return null;
  const max = Math.max(...values, 1);
  const top = pattern.reduce((best, day) => (day.value ?? -1) > (best.value ?? -1) ? day : best, pattern[0]);
  return (
    <section className="metric-card metric-pattern">
      <header className="metric-card-head">
        <h3>{t("Your week")}</h3>
        <p>{t("Average by weekday over the last 12 weeks")}</p>
      </header>
      <div className="metric-pattern-bars">
        {pattern.map((day) => (
          <div key={day.weekday} className={`metric-pattern-day${day === top ? " is-top" : ""}`}
            style={{ "--h": day.value === undefined ? 0 : day.value / max } as CSSProperties}>
            <span className="metric-pattern-value">{formatMetricValue(day.value, kind, { compact: true })}</span>
            <span className="metric-pattern-bar" aria-hidden="true" />
            <span className="metric-pattern-label">{day.weekday}</span>
          </div>
        ))}
      </div>
      <p className="metric-card-note">
        {kind === "load"
          ? t("{{value1}} is usually your biggest training day.", { value1: top.weekday })
          : t("{{value1}} is usually your biggest day.", { value1: top.weekday })}
      </p>
    </section>
  );
}

function BalanceCard({ summary }: { summary: MetricSummary }) {
  useLanguage();
  const balance = summary.balance;
  if (!balance) return null;
  const marker = Math.min(100, Math.max(0, balance.ratio / 2 * 100));
  return (
    <section className={`metric-card metric-balance is-${balance.zone}`}>
      <header className="metric-card-head">
        <h3>{t("Load balance")}</h3>
        <p>{t("This week's load against your 4-week average")}</p>
      </header>
      <div className="metric-balance-figure">
        <strong>{formatNumber(balance.ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <span className="metric-balance-zone">{loadBalanceLabel(balance.zone)}</span>
      </div>
      <div className="metric-balance-gauge" aria-hidden="true">
        <span className="is-low" style={{ width: "40%" }} />
        <span className="is-optimal" style={{ width: "25%" }} />
        <span className="is-high" style={{ width: "10%" }} />
        <span className="is-spike" style={{ width: "25%" }} />
        <i style={{ left: `${marker}%` }} />
      </div>
      <div className="metric-balance-scale" aria-hidden="true">
        <span style={{ left: "40%" }}>0.8</span>
        <span style={{ left: "65%" }}>1.3</span>
        <span style={{ left: "75%" }}>1.5</span>
      </div>
      <dl className="metric-balance-split">
        <div><dt>{t("Last 7 days")}</dt><dd>{formatNumber(Math.round(balance.acute))}</dd></div>
        <div><dt>{t("Typical week")}</dt><dd>{formatNumber(Math.round(balance.chronic))}</dd></div>
      </dl>
      <p className="metric-card-note">
        {balance.zone === "low" ? t("Lighter than usual: fine for recovery, but fitness builds slowly here.")
          : balance.zone === "optimal" ? t("A steady build: the range where fitness grows with the least risk.")
            : balance.zone === "high" ? t("Ramping up quickly. Keep an eye on sleep and soreness.")
              : t("Much more than you're used to. A lighter day or two would help you absorb it.")}
      </p>
    </section>
  );
}

function HrvCard({ trendPoints, summary }: { trendPoints: TrainingTrendPoint[]; summary: MetricSummary }) {
  useLanguage();
  const byDay = new Map(trendPoints.map((point) => [point.date, point]));
  const nights = summary.days.map((day) => byDay.get(day.date));
  const values = nights.flatMap((point) => point?.avgSleepHrv ? [point.avgSleepHrv] : []);
  if (values.length < 2) return null;
  const latest = [...nights].reverse().find((point) => point?.avgSleepHrv);
  const baseline = latest?.sleepHrvBase;
  const all = baseline ? [...values, baseline] : values;
  const min = Math.min(...all) - 4;
  const span = Math.max(Math.max(...all) + 4 - min, 1);
  const y = (value: number) => 100 - (value - min) / span * 100;
  const path = nights.map((point, index) => !point?.avgSleepHrv ? "" :
    `${index === 0 || !nights[index - 1]?.avgSleepHrv ? "M" : "L"}${index + 0.5},${y(point.avgSleepHrv)}`).join(" ");
  const delta = latest?.avgSleepHrv !== undefined && baseline ? Math.round(latest.avgSleepHrv - baseline) : undefined;
  return (
    <section className="metric-card metric-hrv">
      <header className="metric-card-head">
        <h3>{t("Overnight HRV")}</h3>
        <p>{t("Read alongside resting HR: a lower HR with steady HRV means you're absorbing training")}</p>
      </header>
      <div className="metric-hrv-figure">
        <strong>{latest?.avgSleepHrv ? Math.round(latest.avgSleepHrv) : "–"}<small>ms</small></strong>
        {delta !== undefined ? (
          <span className={`metric-verdict ${delta >= 3 ? "is-good" : delta <= -3 ? "is-watch" : "is-steady"}`}>
            {delta >= 3 ? t("Above baseline") : delta <= -3 ? t("Below baseline") : t("On baseline")}
          </span>
        ) : null}
        {baseline ? <span className="metric-hrv-base">{t("Baseline {{value1}} ms", { value1: String(Math.round(baseline)) })}</span> : null}
      </div>
      <svg className="metric-hrv-line" viewBox={`0 0 ${nights.length} 100`} preserveAspectRatio="none" aria-hidden="true">
        {baseline ? <line x1="0" x2={nights.length} y1={y(baseline)} y2={y(baseline)} className="metric-hrv-baseline" vectorEffect="non-scaling-stroke" /> : null}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </section>
  );
}

/**
 * A daily stat card's page: Training Hub morphs the card into it (see
 * TrainingHubView and the morph rules at the end of metricDetail.css).
 */
export function MetricDetailPage({
  kind,
  trendPoints = [],
  healthRecords = [],
  activities = [],
  local = false,
  loadHealthHistory,
  onBack
}: MetricDetailPageProps) {
  const { language } = useLanguage();
  const back = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const [range, setRange] = useState<MetricRange>(30);
  const [history, setHistory] = useState<TrainingHubDailyHealthRecord[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const health = kind === "steps" || kind === "calories";

  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!health || !loadHealthHistory) return;
    let live = true;
    setLoadingHistory(true);
    loadHealthHistory(HISTORY_DAYS)
      .then((records) => { if (live) setHistory(records); })
      .catch(() => undefined)
      .finally(() => { if (live) setLoadingHistory(false); });
    return () => { live = false; };
  }, [health, loadHealthHistory]);

  const records = useMemo(() => {
    if (!history?.length) return healthRecords;
    const merged = new Map(history.map((record) => [record.happenDay, record]));
    // The hub's own reading for today is the freshest.
    for (const record of healthRecords) merged.set(record.happenDay, { ...merged.get(record.happenDay), ...record });
    return [...merged.values()];
  }, [history, healthRecords]);

  const readings = useMemo(() => metricReadings(kind, trendPoints, records), [kind, trendPoints, records]);
  const summary = useMemo(() => buildMetricSummary(kind, range, readings), [kind, range, readings, language]);
  const [selected, setSelected] = useState(() => summary.current?.date ?? summary.days.at(-1)!.date);
  const day = summary.days.find((item) => item.date === selected) ?? summary.days.at(-1)!;
  const point = useMemo(() => trendPoints.find((item) => item.date === day.date), [trendPoints, day.date]);

  const first = summary.days[0];
  const last = summary.days.at(-1)!;
  const title = metricTitle(kind, local);
  const current = summary.current;
  const currentDay = current ? summary.days.find((item) => item.date === current.date) : undefined;

  return (
    <section
      className={`metric-page tone-${kind}`}
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) onBack();
      }}
    >
      <div className="sleep-week-page-head">
        <button ref={back} type="button" className="sleep-week-back" onClick={onBack} aria-label={t("Back to Training Hub")}>
          <ArrowLeft size={16} strokeWidth={2.3} aria-hidden="true" />
          <span className="sleep-week-back-label">{t("Training Hub")}</span>
        </button>
      </div>
      <div className="metric-surface">
        <header className="metric-hero">
          <div className="metric-topline">
            <span className="metric-eyebrow">
              <span className="metric-glyph" aria-hidden="true"><MetricIcon kind={kind} /></span>
              {title}
            </span>
            <div className="metric-range" role="radiogroup" aria-label={t("Period")}>
              {METRIC_RANGES.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={range === option}
                  className={range === option ? "is-active" : undefined} onClick={() => setRange(option)}>
                  {t("{{value1}}D", { value1: String(option) })}
                </button>
              ))}
            </div>
          </div>
          <div className="metric-headline">
            <div className="metric-headline-copy">
              <h2 id={headingId}>{t("Past {{value1}} days", { value1: String(range) })}</h2>
              <p className="sleep-week-meta">
                <span>{first.shortDate} – {last.shortDate}</span>
                <span>
                  {kind === "load"
                    ? t("{{value1}} training days", { value1: String(summary.counted) })
                    : t("{{value1}} of {{value2}} days measured", { value1: String(summary.counted), value2: String(range) })}
                </span>
                {loadingHistory ? <span className="metric-loading">{t("Loading history…")}</span> : null}
              </p>
              <div className="metric-figure">
                <strong className={current ? undefined : "is-empty"}>{formatMetricValue(current?.value, kind)}</strong>
                <span className="metric-figure-unit">{current ? unitFor(kind, current.value) : ""}</span>
                <span className="metric-figure-label">
                  {kind === "heart"
                    ? currentDay?.isToday ? t("Last night") : currentDay ? t("Latest · {{value1}}", { value1: currentDay.shortDate }) : t("No reading yet")
                    : t("Today")}
                </span>
                {summary.verdict && kind === "heart" ? <span className={`metric-verdict is-${summary.verdict.key}`}>{summary.verdict.label}</span> : null}
              </div>
            </div>
            <div className="metric-average">
              <span className="metric-average-label">{t("Daily average")}</span>
              <strong>{formatMetricValue(summary.average, kind)}<small>{metricUnit(kind)}</small></strong>
              <ChangePill summary={summary} />
            </div>
          </div>
        </header>

        <div className="metric-body">
          <Stats summary={summary} />

          <div className="metric-main">
            <section className="metric-card metric-trend">
              <header className="metric-card-head">
                <h3>{t("Day by day")}</h3>
                <p>{summary.hasData
                  ? t("Select a day for details. The dashed line is your average.")
                  : health && !local ? t("COROS hasn't sent any daily totals for this period yet.") : t("No readings in this period yet.")}</p>
              </header>
              <DailyChart summary={summary} selected={day.date} onSelect={setSelected} />
            </section>
            <DayDetail summary={summary} day={day} activities={activities} point={point} />
          </div>

          <div className="metric-insights">
            {kind === "load" ? <BalanceCard summary={summary} /> : null}
            {kind === "heart" ? <HrvCard trendPoints={trendPoints} summary={summary} /> : <PatternCard summary={summary} />}
            <WeeksCard summary={summary} />
          </div>

          <p className="sleep-week-footnote metric-footnote">
            {kind === "load"
              ? <><Flame size={12} aria-hidden="true" />{summary.balance
                ? t("Training load is COROS's estimate of each session's strain. Load balance compares your last 7 days with your average week over the last 4.")
                : t("Training load is COROS's estimate of each session's strain. Load balance appears once there are 3 weeks of history.")}</>
              : kind === "heart"
                ? <><Moon size={12} aria-hidden="true" />{t("Resting HR is measured by your watch overnight. A reading a few beats above your usual can mean fatigue, illness or a late night.")}</>
                : local
                  ? t("Daily totals from your watch.")
                  : t("Daily totals from COROS. Today's figure keeps growing until your watch syncs at the end of the day.")}
          </p>
        </div>
      </div>
    </section>
  );
}
