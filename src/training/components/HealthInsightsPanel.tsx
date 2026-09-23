import type { ChartCardSize } from "../widgetSizing";
import "../chartSizing.css";
import { useEffect, useId, useMemo, useState } from "react";
import { Activity, Flower2, HeartPulse, Inbox, Loader2, MoonStar } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HealthInsightKind, HealthInsightMetric, HealthInsightResult, HealthInsightSeries } from "../../../electron/healthInsightsTypes";
import type { CorosLinkApi } from "../../coroslink-api";
import { useTheme } from "../../theme/ThemeProvider";
import { getHealthVitalColors } from "../chartConfig";
import type { HealthVitalKey } from "../chartConfig";
import { sampleHealthInsight } from "../healthInsightsSample";
import { DAY_ONLY, formatNumber, formatTime, toEpoch } from "../healthInsightsFormat";
import { useChartColors } from "../useChartColors";
import { HEALTH_VITAL_LABELS, HealthCheckVitals } from "./HealthCheckVitals";
import "../healthInsights.css";

const cards: { kind: HealthInsightKind; title: string; subtitle: string; icon: LucideIcon }[] = [
  { kind: "stress", title: "Stress", subtitle: "Stress throughout your day", icon: Activity },
  { kind: "sleepHrv", title: "Sleep HRV", subtitle: "Your overnight variability", icon: MoonStar },
  { kind: "healthCheck", title: "Health check", subtitle: "Measurements recorded on your watch", icon: HeartPulse },
  { kind: "cycle", title: "Menstrual cycle", subtitle: "Cycle information from COROS", icon: Flower2 }
];

/** Points further apart than this are drawn as separate segments (e.g. one night per segment). */
const GAP_MS = 3 * 60 * 60 * 1000;

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

function HealthChart({ series, range, baseline, color, connect = false }: { series: HealthInsightSeries; range?: [number, number]; baseline?: number; color?: string; connect?: boolean }) {
  const { colors } = useChartColors();
  const stroke = color ?? colors.accentBright;
  const gradientId = useId();
  const { points, span, dayOnly } = useMemo(() => {
    const dayOnly = series.points.every(point => DAY_ONLY.test(point.time));
    const points: { epoch: number; value: number | null }[] = [];
    for (const point of series.points) {
      const epoch = toEpoch(point.time);
      const previous = points.at(-1);
      if (previous && previous.value !== null && !dayOnly && !connect && epoch - previous.epoch > GAP_MS) points.push({ epoch: previous.epoch + 1, value: null });
      points.push({ epoch, value: point.value });
    }
    const span = points.length ? points[points.length - 1].epoch - points[0].epoch : 0;
    return { points, span, dayOnly };
  }, [series, connect]);
  const tickMode = dayOnly || span > 36 * 60 * 60 * 1000 ? "day" : "clock";
  const latest = series.points.at(-1);
  return <div className="health-insight-chart" role="img" aria-label={`${series.label}: ${series.points.length} measurements. Latest ${latest?.value} ${series.unit ?? ""}.`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color ?? colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={colors.grid} vertical={false} />
        <XAxis dataKey="epoch" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={value => formatTime(value, tickMode)} tick={{ fill: colors.text, fontSize: 11 }} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: colors.text, fontSize: 11 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={36} />
        {range && <ReferenceArea y1={range[0]} y2={range[1]} fill={color ?? colors.accentSoft} fillOpacity={color ? 0.12 : 0.45} stroke="none" ifOverflow="extendDomain" />}
        {baseline !== undefined && <ReferenceLine y={baseline} stroke={colors.text} strokeDasharray="4 4" strokeOpacity={0.6} ifOverflow="extendDomain" />}
        <Tooltip cursor={{ stroke: colors.cursor }} labelFormatter={value => formatTime(typeof value === "number" ? value : String(value), dayOnly ? "day" : "full")} formatter={value => [`${value} ${series.unit ?? ""}`.trim(), series.label]} contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 10, color: colors.text, fontSize: 12 }} />
        <Area type="monotone" dataKey="value" name={series.label} stroke={stroke} strokeWidth={2} fill={`url(#${gradientId})`} dot={series.points.length < 15 ? { r: 3, fill: stroke, strokeWidth: 0 } : false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="health-segmented" role="group" aria-label={label}>
    {options.map(option => <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

function SeriesSummary({ result, series, part, referenceKeys = [] }: { result: HealthInsightResult; series: HealthInsightSeries; referenceKeys?: string[]; part?: "primary" | "details" }) {
  const values = series.points.map(point => point.value);
  const latest = series.points.at(-1);
  if (!latest) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const digits = max >= 20 ? 0 : 1;
  const badge = result.metrics.find(metric => typeof metric.value === "string" && ["level", "evaluation", "status", "phase"].includes(metric.key));
  const extras = result.metrics.filter(metric => metric !== badge && !referenceKeys.includes(metric.key) && !result.series.some(item => item.key === metric.key));
  return <>
    {part === "details" && <span className="health-insight-caption">Latest · {formatTime(latest.time, DAY_ONLY.test(latest.time) ? "day" : "full")}</span>}
    <div className="health-insight-hero">
      {part !== "details" && <div className="health-insight-primary">
        <span className="health-insight-value">{formatNumber(latest.value, 1)}{series.unit && <small>{series.unit}</small>}</span>
        {part !== "primary" && <span className="health-insight-caption">Latest · {formatTime(latest.time, DAY_ONLY.test(latest.time) ? "day" : "full")}</span>}
        {badge && <span className={`health-insight-badge is-${badgeTone(String(badge.value))}`}>{badge.value}</span>}
      </div>}
      {part !== "primary" && values.length > 1 && <dl className="health-insight-stats">
        <div><dt>Average</dt><dd>{formatNumber(average, digits)}</dd></div>
        <div><dt>Low</dt><dd>{formatNumber(min, 1)}</dd></div>
        <div><dt>High</dt><dd>{formatNumber(max, 1)}</dd></div>
      </dl>}
    </div>
    {part !== "primary" && extras.length > 0 && <ul className="health-insight-chips">
      {extras.map(metric => <li key={metric.key}><span>{metric.label}</span>{metricText(metric)}{metric.unit && <small> {metric.unit}</small>}</li>)}
    </ul>}
  </>;
}

function InsightCard({ kind, title, subtitle, icon: Icon, api, refreshToken, sampleMode, onConnect, connecting, size }: typeof cards[number] & {
  size?: ChartCardSize; api: CorosLinkApi; refreshToken: number; sampleMode: boolean; onConnect: () => void; connecting: boolean;
}) {
  const compact = (kind === "stress" || kind === "sleepHrv") && (size === "mini" || size === "short");
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<HealthInsightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCycle, setShowCycle] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState("");
  const id = useId();
  const { theme } = useTheme();
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
  }, [api, kind, days, refreshToken, sampleMode, enabled]);
  // Prefer the first series that can actually draw a line.
  const series = result?.series.find(item => item.key === selectedSeries) ?? result?.series.find(item => item.points.length > 1) ?? result?.series[0];
  const message = result?.status === "empty" ? (result.message ?? "No measurements for this period. Sync your watch with the COROS app to update your data.")
    : result?.status === "unavailable" ? "This data is not available from your COROS connection yet."
    : result?.status === "disconnected" ? "Connect COROS data access to see your health information."
    : result?.status === "error" ? "Could not load this data. Use Refresh at the top of Training Hub to try again." : undefined;
  const rangeMetric = result?.metrics.find(metric => metric.key === "normalRange");
  const range = series && rangeMetric && rangeMetric.unit === series.unit ? parseRange(rangeMetric.value) : undefined;
  const baselineMetric = result?.metrics.find(metric => metric.key === "baseline");
  const baseline = series && baselineMetric && typeof baselineMetric.value === "number" && baselineMetric.unit === series.unit ? baselineMetric.value : undefined;
  const referenceKeys = [...(range ? ["normalRange"] : []), ...(baseline !== undefined ? ["baseline"] : [])];
  const report = result?.report;
  const longReport = Boolean(report && report.length > 320);
  // A health check is five readings taken together, so it gets its own tile layout instead of the hero + tab strip.
  const vitals = kind === "healthCheck" && result?.status === "ready" && result.metrics.some(metric => typeof metric.value === "number");
  const vitalColors = getHealthVitalColors(theme);
  const vitalColor = series && vitals ? vitalColors[series.key as HealthVitalKey] : undefined;
  // Non-vital cards draw in their identity hue (matches --insight-tone in healthInsights.css).
  const toneColor = kind === "stress" ? vitalColors.stress : kind === "sleepHrv" ? vitalColors.spo2 : undefined;
  const vitalLabel = series && vitals ? HEALTH_VITAL_LABELS[series.key as HealthVitalKey] ?? series.label : undefined;
  const restingMetric = vitals ? result.metrics.find(metric => metric.key === "restingHeartRate") : undefined;
  const resting = series?.key === "heartRate" && typeof restingMetric?.value === "number" ? restingMetric.value : undefined;

  // The health check card is already busy with five tiles, so its footer keeps only the update time.
  const updated = result?.fetchedAt ? `Updated ${formatTime(result.fetchedAt, "clock")}` : "";
  const sourceLine = [sampleMode ? "Sample data" : vitals ? "" : "Reported by COROS", updated].filter(Boolean).join(" · ");

  const chartNotes = <>
    {(range || baseline !== undefined) && <p className="health-insight-legend">
      {range && <span><i className="is-range" />Normal range {range[0]}–{range[1]} {series?.unit}</span>}
      {baseline !== undefined && <span><i className="is-baseline" />Baseline {baseline} {series?.unit}</span>}
    </p>}
    {report && !longReport && (kind === "sleepHrv" && !compact ? <details className="health-insight-report health-hrv-explanation"><summary>About these readings</summary><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></details> : <div className="health-insight-note"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></div>)}
    {report && longReport && <details className="health-insight-report" open={(result?.metrics.length ?? 0) === 0 && !series}><summary>COROS report</summary><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></details>}
  </>;

  return <article className={`panel health-insight-card health-insight-${kind}`} data-chart-size={size} aria-labelledby={id} aria-busy={loading}>
    <div className="health-insight-heading">
      <div className="health-insight-title">
        <span className="health-insight-icon" aria-hidden="true"><Icon size={17} /></span>
        <div><h3 id={id}>{title}</h3><p>{subtitle}</p></div>
      </div>
      {kind !== "cycle" && <div className="health-insight-period">
        {compact ? <select aria-label={`${title} period`} value={days} onChange={event => setDays(Number(event.target.value))}><option value={1}>Today</option><option value={7}>Last 7 days</option></select> : <Segmented label={`${title} period`} value={days} options={[{ value: 1, label: "Today" }, { value: 7, label: "Last 7 days" }]} onChange={setDays} />}
      </div>}
    </div>
    {kind === "cycle" && <button type="button" className="secondary-button health-cycle-toggle" aria-expanded={showCycle} aria-controls={`${id}-content`} onClick={() => setShowCycle(value => !value)}>{showCycle ? "Hide cycle details" : "Show cycle details"}</button>}
    <div id={`${id}-content`} className="health-insight-body" hidden={!enabled}>
      {loading && <div className="health-insight-state" role="status"><Loader2 size={18} className="spin" aria-hidden="true" /><p>Loading {title.toLowerCase()}…</p></div>}
      {!loading && message && <div className="health-insight-state" role="status">
        <Inbox size={18} aria-hidden="true" /><p>{message}</p>
        {result?.status === "disconnected" && <button type="button" className="secondary-button" onClick={onConnect} disabled={connecting}>{connecting ? "Connecting…" : "Connect COROS data access"}</button>}
        {result?.status === "error" && result.message && <details className="health-insight-error"><summary>Error details</summary><p>{result.message}</p></details>}
      </div>}
      {!loading && result?.status === "ready" && vitals && <>
        <HealthCheckVitals result={result} days={days} selected={series?.key} onSelect={setSelectedSeries} />
        {series && series.points.length > 1 && <div className="health-check-trend">
          <p className="health-check-trend-title">{vitalLabel} · {days === 1 ? "today" : `last ${days} days`}</p>
          <HealthChart series={series} color={vitalColor} baseline={resting} connect />
          {resting !== undefined && <p className="health-insight-legend"><span><i className="is-baseline" />Resting heart rate {resting} {series.unit}</span></p>}
        </div>}
        {series && series.points.length === 1 && <p className="health-vital-hint">Only one {vitalLabel === "HRV" ? "HRV" : vitalLabel?.toLowerCase()} reading {days === 1 ? "today" : `in the last ${days} days`}. Run another health check on your watch to see how it moves.</p>}
        {report && <details className="health-insight-report"><summary>COROS report</summary><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{report}</ReactMarkdown></details>}
      </>}
      {!loading && result?.status === "ready" && !vitals && <>
        {series ? <SeriesSummary result={result} series={series} referenceKeys={referenceKeys} part={compact ? "primary" : undefined} /> : <dl className="health-insight-metrics">
          {result.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metricText(metric)}{metric.unit && <small> {metric.unit}</small>}</dd></div>)}
        </dl>}
        {result.series.length > 1 && (compact ? <select aria-label="Chart" value={series?.key ?? ""} onChange={event => setSelectedSeries(event.target.value)}>{result.series.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : <Segmented label="Chart" value={series?.key ?? ""} options={result.series.map(item => ({ value: item.key, label: item.label }))} onChange={setSelectedSeries} />)}
        {series && <HealthChart series={series} range={range} baseline={baseline} color={toneColor} />}
        {compact ? <details className="chart-card-details"><summary>Details &amp; source</summary>
          {series && <SeriesSummary result={result} series={series} referenceKeys={referenceKeys} part="details" />}
          {chartNotes}
          <p className="health-insight-source">{sampleMode ? "Sample data" : "Reported by COROS"}{result.fetchedAt ? ` · Updated ${formatTime(result.fetchedAt, "clock")}` : ""}</p>
        </details> : chartNotes}
      </>}
      {!(compact && result?.status === "ready") && !loading && result && result.status !== "disconnected" && <p className="health-insight-source">{sourceLine}</p>}
    </div>
  </article>;
}

export function HealthInsightsPanel({ api, refreshToken = 0, sampleMode = false, kind, size }: { size?: ChartCardSize; api: CorosLinkApi; refreshToken?: number; sampleMode?: boolean; kind?: HealthInsightKind }) {
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
  return <section className={`health-insights ${kind ? "is-single" : ""}`} aria-label={kind ? cards.find(card => card.kind === kind)?.title : "Health and recovery"}>
    {!kind && <div className="health-insights-heading"><div><p className="eyebrow">Health & recovery</p><h2>A closer look at your health</h2></div></div>}
    {connectionError && <p role="alert" className="health-insight-message">{connectionError}</p>}
    <div className="health-insights-grid">{cards.filter(card => !kind || card.kind === kind).map(card => <InsightCard size={size} key={card.kind} {...card} api={api} refreshToken={refreshToken + connectionRefresh} sampleMode={sampleMode} onConnect={() => void connect()} connecting={connecting} />)}</div>
  </section>;
}
