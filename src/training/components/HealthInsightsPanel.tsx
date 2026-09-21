import { useEffect, useId, useMemo, useState } from "react";
import { Activity, Flower2, HeartPulse, Inbox, Loader2, MoonStar, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HealthInsightKind, HealthInsightMetric, HealthInsightResult, HealthInsightSeries } from "../../../electron/healthInsightsTypes";
import type { CorosLinkApi } from "../../coroslink-api";
import { sampleHealthInsight } from "../healthInsightsSample";
import { useChartColors } from "../useChartColors";
import "../healthInsights.css";

const cards: { kind: HealthInsightKind; title: string; subtitle: string; icon: LucideIcon }[] = [
  { kind: "stress", title: "Stress", subtitle: "Stress throughout your day", icon: Activity },
  { kind: "sleepHrv", title: "Sleep HRV", subtitle: "Your overnight variability", icon: MoonStar },
  { kind: "healthCheck", title: "Health check", subtitle: "Measurements recorded on your watch", icon: HeartPulse },
  { kind: "cycle", title: "Menstrual cycle", subtitle: "Cycle information from COROS", icon: Flower2 }
];

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Points further apart than this are drawn as separate segments (e.g. one night per segment). */
const GAP_MS = 3 * 60 * 60 * 1000;

const toEpoch = (time: string) => new Date(DAY_ONLY.test(time) ? `${time}T12:00:00` : time).getTime();

function formatTime(value: string | number, mode: "day" | "clock" | "full"): string {
  const date = new Date(typeof value === "number" ? value : toEpoch(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  if (mode === "day") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (mode === "clock") return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const formatNumber = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });

function metricText(metric: HealthInsightMetric): string {
  return typeof metric.value === "number" ? formatNumber(metric.value, 1) : metric.value;
}

/** COROS wording → badge tone. Only labels COROS itself reports are shown. */
function badgeTone(value: string): "good" | "watch" | "alert" | "neutral" {
  if (/\b(normal|relaxed|low|good|balanced|optimal)\b/i.test(value)) return "good";
  if (/\b(medium|moderate|elevated|slightly)\b/i.test(value)) return "watch";
  if (/\b(high|poor|below|above|unbalanced)\b/i.test(value)) return "alert";
  return "neutral";
}

function parseRange(value: string | number): [number, number] | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/.exec(String(value));
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function HealthChart({ series, range, baseline }: { series: HealthInsightSeries; range?: [number, number]; baseline?: number }) {
  const { colors } = useChartColors();
  const gradientId = useId();
  const { points, span, dayOnly } = useMemo(() => {
    const dayOnly = series.points.every(point => DAY_ONLY.test(point.time));
    const points: { epoch: number; value: number | null }[] = [];
    for (const point of series.points) {
      const epoch = toEpoch(point.time);
      const previous = points.at(-1);
      if (previous && previous.value !== null && !dayOnly && epoch - previous.epoch > GAP_MS) points.push({ epoch: previous.epoch + 1, value: null });
      points.push({ epoch, value: point.value });
    }
    const span = points.length ? points[points.length - 1].epoch - points[0].epoch : 0;
    return { points, span, dayOnly };
  }, [series]);
  const tickMode = dayOnly || span > 36 * 60 * 60 * 1000 ? "day" : "clock";
  const latest = series.points.at(-1);
  return <div className="health-insight-chart" role="img" aria-label={`${series.label}: ${series.points.length} measurements. Latest ${latest?.value} ${series.unit ?? ""}.`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accentBright} stopOpacity={0.35} />
            <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis dataKey="epoch" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={value => formatTime(value, tickMode)} tick={{ fill: colors.text, fontSize: 11 }} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: colors.text, fontSize: 11 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={36} />
        {range && <ReferenceArea y1={range[0]} y2={range[1]} fill={colors.accentSoft} fillOpacity={0.45} stroke="none" ifOverflow="extendDomain" />}
        {baseline !== undefined && <ReferenceLine y={baseline} stroke={colors.text} strokeDasharray="4 4" strokeOpacity={0.6} ifOverflow="extendDomain" />}
        <Tooltip cursor={{ stroke: colors.cursor }} labelFormatter={value => formatTime(typeof value === "number" ? value : String(value), dayOnly ? "day" : "full")} formatter={value => [`${value} ${series.unit ?? ""}`.trim(), series.label]} contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 10, color: colors.text, fontSize: 12 }} />
        <Area type="monotone" dataKey="value" name={series.label} stroke={colors.accentBright} strokeWidth={2} fill={`url(#${gradientId})`} dot={series.points.length < 15 ? { r: 3, fill: colors.accentBright, strokeWidth: 0 } : false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="health-segmented" role="group" aria-label={label}>
    {options.map(option => <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

function SeriesSummary({ result, series }: { result: HealthInsightResult; series: HealthInsightSeries }) {
  const values = series.points.map(point => point.value);
  const latest = series.points.at(-1)!;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const digits = max >= 20 ? 0 : 1;
  const badge = result.metrics.find(metric => typeof metric.value === "string" && ["level", "evaluation", "status", "phase"].includes(metric.key));
  const extras = result.metrics.filter(metric => metric !== badge && !result.series.some(item => item.key === metric.key));
  return <>
    <div className="health-insight-hero">
      <div className="health-insight-primary">
        <span className="health-insight-value">{formatNumber(latest.value, 1)}{series.unit && <small>{series.unit}</small>}</span>
        <span className="health-insight-caption">Latest · {formatTime(latest.time, DAY_ONLY.test(latest.time) ? "day" : "full")}</span>
        {badge && <span className={`health-insight-badge is-${badgeTone(String(badge.value))}`}>{badge.value}</span>}
      </div>
      {values.length > 1 && <dl className="health-insight-stats">
        <div><dt>Average</dt><dd>{formatNumber(average, digits)}</dd></div>
        <div><dt>Low</dt><dd>{formatNumber(min, 1)}</dd></div>
        <div><dt>High</dt><dd>{formatNumber(max, 1)}</dd></div>
      </dl>}
    </div>
    {extras.length > 0 && <ul className="health-insight-chips">
      {extras.map(metric => <li key={metric.key}><span>{metric.label}</span>{metricText(metric)}{metric.unit && <small> {metric.unit}</small>}</li>)}
    </ul>}
  </>;
}

function InsightCard({ kind, title, subtitle, icon: Icon, api, days, refreshToken, sampleMode, onConnect, connecting }: typeof cards[number] & {
  api: CorosLinkApi; days: number; refreshToken: number; sampleMode: boolean; onConnect: () => void; connecting: boolean;
}) {
  const [result, setResult] = useState<HealthInsightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showCycle, setShowCycle] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState("");
  const id = useId();
  const enabled = kind !== "cycle" || showCycle;
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (!enabled) { setLoading(false); return; }
    if (sampleMode) { setResult(sampleHealthInsight(kind, days)); setLoading(false); return; }
    setLoading(true);
    void Promise.resolve().then(() => api.getTrainingHealthInsight(kind, days)).then(data => {
      if (!cancelled) setResult(data);
    }).catch(error => {
      if (!cancelled) setResult({ kind, days, status: "error", metrics: [], series: [], message: error instanceof Error ? error.message : "Could not load health data." });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, kind, days, refreshToken, retry, sampleMode, enabled]);
  // Prefer the first series that can actually draw a line.
  const series = result?.series.find(item => item.key === selectedSeries) ?? result?.series.find(item => item.points.length > 1) ?? result?.series[0];
  const message = result?.status === "empty" ? (result.message ?? "No measurements for this period. Sync your watch with the COROS app to update your data.")
    : result?.status === "unavailable" ? "This data is not available from your COROS connection yet."
    : result?.status === "disconnected" ? "Connect COROS data access to see your health information."
    : result?.status === "error" ? "Could not load this data. Try refreshing this panel." : undefined;
  const rangeMetric = result?.metrics.find(metric => metric.key === "normalRange");
  const range = series && rangeMetric && rangeMetric.unit === series.unit ? parseRange(rangeMetric.value) : undefined;
  const baselineMetric = result?.metrics.find(metric => metric.key === "baseline");
  const baseline = series && baselineMetric && typeof baselineMetric.value === "number" && baselineMetric.unit === series.unit ? baselineMetric.value : undefined;
  const report = result?.report;
  const longReport = Boolean(report && report.length > 320);

  return <article className={`panel health-insight-card health-insight-${kind}`} aria-labelledby={id} aria-busy={loading}>
    <div className="health-insight-heading">
      <div className="health-insight-title">
        <span className="health-insight-icon" aria-hidden="true"><Icon size={17} /></span>
        <div><h3 id={id}>{title}</h3><p>{subtitle}</p></div>
      </div>
      {enabled && <button type="button" className="secondary-button" aria-label={`Refresh ${title.toLowerCase()}`} disabled={loading} onClick={() => setRetry(value => value + 1)}>
        {loading ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
      </button>}
    </div>
    {kind === "cycle" && <button type="button" className="secondary-button health-cycle-toggle" aria-expanded={showCycle} aria-controls={`${id}-content`} onClick={() => setShowCycle(value => !value)}>{showCycle ? "Hide cycle details" : "Show cycle details"}</button>}
    <div id={`${id}-content`} className="health-insight-body" hidden={!enabled}>
      {loading && <div className="health-insight-state" role="status"><Loader2 size={18} className="spin" aria-hidden="true" /><p>Loading {title.toLowerCase()}…</p></div>}
      {!loading && message && <div className="health-insight-state" role="status">
        <Inbox size={18} aria-hidden="true" /><p>{message}</p>
        {result?.status === "disconnected" && <button type="button" className="secondary-button" onClick={onConnect} disabled={connecting}>{connecting ? "Connecting…" : "Connect COROS data access"}</button>}
        {result?.status === "error" && result.message && <details className="health-insight-error"><summary>Error details</summary><p>{result.message}</p></details>}
      </div>}
      {!loading && result?.status === "ready" && <>
        {series ? <SeriesSummary result={result} series={series} /> : <dl className="health-insight-metrics">
          {result.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metricText(metric)}{metric.unit && <small> {metric.unit}</small>}</dd></div>)}
        </dl>}
        {result.series.length > 1 && <Segmented label="Chart" value={series?.key ?? ""} options={result.series.map(item => ({ value: item.key, label: item.label }))} onChange={setSelectedSeries} />}
        {series && <HealthChart series={series} range={range} baseline={baseline} />}
        {(range || baseline !== undefined) && <p className="health-insight-legend">
          {range && <span><i className="is-range" />Normal range {range[0]}–{range[1]} {series?.unit}</span>}
          {baseline !== undefined && <span><i className="is-baseline" />Baseline {baseline} {series?.unit}</span>}
        </p>}
        {report && !longReport && <div className="health-insight-note"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></div>}
        {report && longReport && <details className="health-insight-report" open={result.metrics.length === 0 && !series}><summary>COROS report</summary><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></details>}
      </>}
      {!loading && result && result.status !== "disconnected" && <p className="health-insight-source">{sampleMode ? "Sample data" : "Reported by COROS"}{result.fetchedAt ? ` · Updated ${formatTime(result.fetchedAt, "clock")}` : ""}</p>}
    </div>
  </article>;
}

export function HealthInsightsPanel({ api, refreshToken = 0, sampleMode = false }: { api: CorosLinkApi; refreshToken?: number; sampleMode?: boolean }) {
  const [days, setDays] = useState(7);
  const [connectionRefresh, setConnectionRefresh] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  async function connect() {
    if (connecting || sampleMode) return;
    setConnecting(true);
    setConnectionError(null);
    try {
      await api.connectCorosMcp();
      setConnectionRefresh(value => value + 1);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Could not connect to COROS."); }
    finally { setConnecting(false); }
  }
  return <section className="health-insights" aria-label="Health and recovery">
    <div className="health-insights-heading"><div><p className="eyebrow">Health & recovery</p><h2>A closer look at your health</h2></div>
      <Segmented label="Period" value={days} options={[{ value: 1, label: "Today" }, { value: 7, label: "Last 7 days" }]} onChange={setDays} />
    </div>
    {connectionError && <p role="alert" className="health-insight-message">{connectionError}</p>}
    <div className="health-insights-grid">{cards.map(card => <InsightCard key={card.kind} {...card} api={api} days={days} refreshToken={refreshToken + connectionRefresh} sampleMode={sampleMode} onConnect={() => void connect()} connecting={connecting} />)}</div>
  </section>;
}
