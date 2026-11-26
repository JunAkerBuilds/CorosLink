"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { Card, CountUp } from "@/components/ui";
import { NightSky } from "@/components/viz/NightSky";
import { ScoreDial } from "@/components/viz/ScoreDial";
import type { Origin } from "@/data/core";
import type { SleepData, SleepRecord } from "@/data/sleep";
import { parseDay } from "@/lib/format";
import { msg, t, tx } from "@/lib/i18n";
import { clockOfDay, dayLabel } from "@/lib/health";
import {
  hm, nightFacts, period, quality, signedHm, stageShare, stressStats, summarise, trainingSplit, perDay,
  type PeriodSummary, type Range,
} from "@/lib/sleep";
import { DeltaChip, PAGE_NOTE, SleepHead, scoreInk, scoreGlow, scoreVar } from "./common";

const SHORT_DAY = [msg("Sun"), msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat")];
const dayShortName = (d: Date) => t(SHORT_DAY[d.getDay()]);
const label = (key: string) => dayLabel(parseDay(key));
/** "Mon 3, score 82, 7 h 10 min asleep", leaving out what the night lacks. */
const nightLabel = (day: string, score: number | null, asleep: number | null) =>
  [day, ...(score != null ? [t("score {n}", { n: score })] : []), ...(asleep != null ? [t("{time} asleep", { time: hm(asleep) })] : [])].join(", ");

/** The summary sky shared by week, month and year: average score, time asleep, stage mix and eight figures. */
export function SummarySky({ s, prev, prevWord }: { s: PeriodSummary; prev: PeriodSummary | null; prevWord: "week" | "month" | "year" }) {
  const score = s.score != null ? Math.round(s.score) : null;
  const dd = s.asleep != null && prev?.asleep != null ? s.asleep - prev.asleep : null;
  const mixTotal = s.mix.inBed ?? 0;
  const stats: [string, string, string?][] = [
    [t("Best night"), s.best ? `${s.best.score} · ${dayShortName(parseDay(s.best.day))}` : "–"],
    [t("Avg bedtime"), s.bed != null ? clockOfDay(s.bed) : "–"],
    [t("Avg wake time"), s.wake != null ? clockOfDay(s.wake) : "–"],
    [t("Regularity"), s.regularity ? t(s.regularity) : "–", s.regularity === "Steady" ? "var(--h-mint)" : s.regularity === "Irregular" ? "var(--h-gold)" : undefined],
    [t("Naps"), s.napMinutes ? hm(s.napMinutes) : tx("sleep", "None")],
    [t("Sleep debt"), s.debt ? hm(s.debt) : tx("sleep", "None"), s.debt > 120 ? "var(--h-gold)" : undefined],
    [t("Short nights"), String(s.shortNights)],
    [t("Avg efficiency"), s.efficiency != null ? `${Math.round(s.efficiency)}%` : "–"],
  ];
  return (
    <NightSky aria-label={t("Summary")} className="sl-sky">
      <div className="sl-sky-row" style={{ alignItems: "center", gap: "26px 44px" }}>
        <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, margin: "0 auto" }}>
          <ScoreDial value={score ?? 0} size={200} radius={88} stroke={15} color={score != null ? scoreVar(score) : "transparent"}
            glow={score != null ? scoreGlow(score) : "transparent"} glowBlur={9} label={score != null ? t("Average sleep score {score} out of 100, {quality}", { score, quality: t(quality(score)) }) : t("No sleep score")}>
            <CountUp className="num" style={{ fontSize: 62, fontWeight: 900, lineHeight: 1 }} text={score != null ? String(score) : "–"} />
            {score != null ? <span style={{ fontSize: 15, fontWeight: 700, color: "var(--sky-rating)" }}>{t(quality(score))}</span> : null}
            <span style={{ fontSize: 12, color: "var(--sky-text)" }}>{t("Average score")}</span>
          </ScoreDial>
          <span style={{ fontSize: 13, color: "var(--sky-text)" }}>{s.nights === 1 ? t("1 night") : t("{n} nights", { n: s.nights })}</span>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "8px 12px" }}>
            <CountUp className="num" style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }} text={s.asleep != null ? hm(s.asleep) : "–"} />
            <span style={{ color: "var(--sky-text)" }}>{t("average asleep")}</span>
            {dd != null ? <DeltaChip good={dd >= 0}>{prevWord === "week" ? t("{delta} on the week before", { delta: signedHm(dd) }) : prevWord === "month" ? t("{delta} on the month before", { delta: signedHm(dd) }) : t("{delta} on the year before", { delta: signedHm(dd) })}</DeltaChip> : null}
          </div>
          {mixTotal > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div aria-hidden="true" style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden" }}>
                {(["deep", "light", "rem", "awake"] as const).map((k) => <span key={k} style={{ width: `${((s.mix[k] ?? 0) / mixTotal) * 100}%`, background: `var(--sl-${k})` }} />)}
              </div>
              <div className="sl-legend" style={{ color: "var(--sky-text)" }}>
                {(["deep", "light", "rem", "awake"] as const).map((k) => (
                  <span key={k}><span className="sl-key" style={{ width: 8, height: 8, borderRadius: 2, background: `var(--sl-${k})` }} />{{ deep: t("Deep"), light: t("Light"), rem: "REM", awake: t("Awake") }[k]} <strong style={{ color: "#ffffff" }}>{s.mix[k] != null ? hm(s.mix[k]!) : "–"}</strong></span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="sl-panel" style={{ flex: "2 1 480px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "16px 14px", padding: "16px 18px" }}>
          {stats.map(([k, v, c]) => (
            <div key={k} className="sl-stat"><span className="sl-stat-k">{k}</span><span className="sl-stat-v num" style={{ color: c }}>{v}</span></div>
          ))}
        </div>
      </div>
    </NightSky>
  );
}

interface TrendDef {
  title: string;
  color: string;
  kind: "bar" | "line";
  read: (n: SleepRecord) => number | null;
  extra?: (n: SleepRecord) => number;
  fmt: (v: number) => string;
  axis?: (v: number) => string;
  band?: [number, number];
  bandName: string;
  min?: number;
  max?: number;
  zero?: boolean;
  /** Higher is better (true), worse (false) or neither (null). */
  better: boolean | null;
  eps: number;
  low?: (v: number) => boolean;
}

const whole = (unit = "") => (v: number) => `${Math.round(v)}${unit}`;
const pct = (v: number) => `${Math.round(v)}%`;

const TRENDS: TrendDef[] = [
  { title: msg("Sleep score"), color: "var(--h-violet)", kind: "bar", read: (n) => n.score, fmt: whole(), band: [70, 100], bandName: msg("Good or better"), min: 40, max: 100, better: true, eps: 1, low: (v) => v < 70 },
  { title: msg("Total sleep"), color: "var(--h-violet)", kind: "bar", zero: true, read: (n) => { const a = nightFacts(n).asleep; return a != null ? a / 60 : null; }, extra: (n) => nightFacts(n).napMinutes / 60, fmt: (v) => hm(v * 60), axis: (v) => `${Math.round(v)} h`, band: [7, 9], bandName: msg("Recommended 7–9 h"), better: true, eps: 0.1 },
  { title: msg("Bedtime"), color: "var(--sl-deep)", kind: "line", read: (n) => nightFacts(n).bed, fmt: clockOfDay, bandName: msg("Earlier is lower"), better: false, eps: 5 },
  { title: msg("Awake time"), color: "var(--sl-awake)", kind: "bar", zero: true, read: (n) => nightFacts(n).awake, fmt: (v) => hm(v), band: [0, 20], bandName: msg("Typical range"), better: false, eps: 1 },
  { title: msg("Interruptions"), color: "var(--sl-awake)", kind: "line", read: (n) => nightFacts(n).wakings, fmt: (v) => v.toFixed(1), axis: whole(), band: [0, 1], bandName: msg("Typical range"), better: false, eps: 0.2 },
  { title: msg("Deep sleep"), color: "var(--sl-deep)", kind: "bar", read: (n) => stageShare(nightFacts(n), "deep"), fmt: pct, band: [13, 23], bandName: msg("Typical range"), better: true, eps: 0.6 },
  { title: msg("REM sleep"), color: "var(--sl-rem)", kind: "bar", read: (n) => stageShare(nightFacts(n), "rem"), fmt: pct, band: [20, 25], bandName: msg("Typical range"), better: true, eps: 0.6 },
  { title: msg("Sleep stress"), color: "var(--h-coral)", kind: "line", read: (n) => stressStats(n)?.average ?? null, fmt: whole(), band: [0, 25], bandName: msg("Rest band"), better: false, eps: 1 },
  { title: msg("Heart rate asleep"), color: "var(--h-rose)", kind: "line", read: (n) => n.heartRateAsleep, fmt: whole(" bpm"), axis: whole(), bandName: "", better: false, eps: 0.6 },
  { title: msg("Sleep HRV"), color: "var(--h-cyan)", kind: "line", read: (n) => n.hrv, fmt: whole(" ms"), axis: whole(), bandName: "", better: true, eps: 1 },
  { title: msg("Resting heart rate"), color: "var(--h-rose)", kind: "line", read: (n) => n.restingHR, fmt: whole(" bpm"), axis: whole(), bandName: "", better: false, eps: 0.6 },
];

const SLOT = 20;

function TrendCard({ def, days, byDay, prev, prevName, hover, onHover, axis }: {
  def: TrendDef; days: string[]; byDay: Map<string, SleepRecord>; prev: SleepRecord[]; prevName: string;
  hover: number | null; onHover: (i: number | null) => void; axis: string[];
}) {
  const N = days.length, VW = N * SLOT;
  const values = perDay(days, byDay, def.read);
  const real = values.filter((v): v is number => v != null);
  const prevVals = prev.map(def.read).filter((v): v is number => v != null);
  if (real.length === 0) return null;
  let lo = Math.min(...real, ...(def.band ? [def.band[0]] : []));
  let hi = Math.max(...real, ...(def.band ? [def.band[1]] : []), ...(def.extra ? days.map((d) => { const n = byDay.get(d); const v = n ? def.read(n) : null; return v != null && n ? v + def.extra!(n) : 0; }) : []));
  lo = def.zero ? 0 : Math.max(0, lo - (hi - lo) * 0.25);
  hi = hi + (hi - lo) * 0.08;
  if (def.min != null) lo = def.min;
  if (def.max != null) hi = def.max;
  const rg = hi - lo || 1;
  const Y = (v: number) => 150 - ((v - lo) / rg) * 150;
  let bars = "", low = "", extra = "", line = "", dots = "", pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const cx = i * SLOT + SLOT / 2;
    if (def.kind === "bar") {
      const seg = `M${i * SLOT + 4} ${Y(v).toFixed(1)}h${SLOT - 8}V${Y(lo).toFixed(1)}h-${SLOT - 8}z`;
      if (def.low?.(v)) low += seg; else bars += seg;
      const n = byDay.get(days[i]);
      const ev = def.extra && n ? def.extra(n) : 0;
      if (ev > 0) extra += `M${i * SLOT + 4} ${Y(v + ev).toFixed(1)}h${SLOT - 8}V${(Y(v) - 1).toFixed(1)}h-${SLOT - 8}z`;
    } else {
      line += `${pen ? "L" : "M"}${cx} ${Y(v).toFixed(1)}`;
      dots += `M${cx} ${Y(v).toFixed(1)}h0.01`;
      pen = true;
    }
  });
  const avg = real.reduce((p, v) => p + v, 0) / real.length;
  const pAvg = prevVals.length ? prevVals.reduce((p, v) => p + v, 0) / prevVals.length : null;
  const same = pAvg == null || Math.abs(avg - pAvg) < def.eps;
  const up = pAvg != null && avg > pAvg;
  const good = same || def.better == null ? null : up === def.better;
  const hv = hover != null ? values[hover] : null;
  const hovText = hover == null ? "" : `${label(days[hover])}  ·  ${hv == null ? t("no night") : def.fmt(hv)}`;

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) onHover(Math.max(0, Math.min(N - 1, Math.floor(((e.clientX - r.left) / r.width) * N))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") onHover(Math.min(N - 1, (hover ?? -1) + 1));
    else if (e.key === "ArrowLeft") onHover(Math.max(0, (hover ?? N) - 1));
    else if (e.key === "Escape") onHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <Card aria-label={t(def.title)} className="sl-trend">
      <div className="sl-card-head">
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: def.color }} />{t(def.title)}</span>
        <span aria-live="polite" style={{ fontSize: 13, fontWeight: 600 }}>{hovText}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "6px 28px" }}>
        <span className="sl-fig"><span>{t("Average")}</span><span className="num" style={{ fontSize: 24, fontWeight: 800 }}>{def.fmt(avg)}</span></span>
        <span className="sl-fig"><span>{prevName}</span><span className="num" style={{ fontSize: 24, fontWeight: 800, color: "var(--dim)" }}>{pAvg != null ? def.fmt(pAvg) : "–"}</span></span>
        <span style={{ marginLeft: "auto" }}><DeltaChip good={good}>{same ? t("About the same") : up ? t("Up on the period before") : t("Down on the period before")}</DeltaChip></span>
      </div>
      <div style={{ position: "relative" }}>
        <svg role="img" aria-label={pAvg != null
          ? t("{title}, average {avg}, {prev} {prevAvg}", { title: t(def.title), avg: def.fmt(avg), prev: prevName.toLowerCase(), prevAvg: def.fmt(pAvg) })
          : t("{title}, average {avg}", { title: t(def.title), avg: def.fmt(avg) })}
          width="100%" height="150" viewBox={`0 0 ${VW} 150`} preserveAspectRatio="none" style={{ display: "block" }}>
          {def.band ? <rect x="0" y={Y(Math.min(hi, def.band[1]))} width={VW} height={Math.max(0, Y(Math.max(lo, def.band[0])) - Y(Math.min(hi, def.band[1])))} style={{ fill: "var(--sl-band)" }} /> : null}
          <path d={`M0 37.5H${VW}M0 75H${VW}M0 112.5H${VW}`} fill="none" style={{ stroke: "var(--line)", vectorEffect: "non-scaling-stroke" }} />
          {hover != null ? <rect x={hover * SLOT} y="0" width={SLOT} height="150" style={{ fill: "rgba(var(--fg-rgb), 0.06)" }} /> : null}
          <path d={bars} style={{ fill: def.color }} />
          <path d={extra} style={{ fill: "var(--sl-nap)" }} />
          <path d={low} style={{ fill: "var(--h-gold)" }} />
          <path d={line} fill="none" style={{ stroke: def.color, strokeWidth: 2.2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
          <path d={dots} fill="none" style={{ stroke: def.color, strokeWidth: 7, strokeLinecap: "round", vectorEffect: "non-scaling-stroke" }} />
          <path d={`M0 ${Y(avg).toFixed(1)}H${VW}`} fill="none" style={{ stroke: "var(--muted)", strokeDasharray: "5 5", vectorEffect: "non-scaling-stroke" }} />
        </svg>
        <div aria-hidden="true" className="sl-y"><span>{(def.axis ?? def.fmt)(hi)}</span><span>{(def.axis ?? def.fmt)(lo)}</span></div>
        <div className="chart-hit" role="slider" tabIndex={0} aria-label={t("{title} by day", { title: t(def.title) })} aria-valuemin={0} aria-valuemax={N - 1}
          aria-valuenow={hover ?? 0} aria-valuetext={hovText || t("Use the arrow keys to read each day")}
          onPointerMove={point} onPointerDown={point} onPointerLeave={() => onHover(null)} onKeyDown={key} />
      </div>
      <div aria-hidden="true" className="sl-trend-axis" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
        {axis.map((a, i) => <span key={i}>{a}</span>)}
      </div>
      <div className="sl-legend">
        {def.band ? <span><span aria-hidden="true" style={{ width: 12, height: 8, borderRadius: 2, background: "var(--sl-band)", border: "1px solid var(--sl-band-line)" }} />{t(def.bandName)}</span> : null}
        <span><span aria-hidden="true" style={{ width: 14, borderTop: "1.5px dashed var(--muted)" }} />{t("Average")}</span>
        {def.extra ? <span><span className="sl-key" style={{ background: "var(--sl-nap)" }} />{t("Naps")}</span> : null}
      </div>
    </Card>
  );
}

function Figure({ k, children }: { k: string; children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="muted" style={{ fontSize: 12 }}>{k}</span>{children}</div>;
}

const RECORD_COLS = "150px 70px 90px 130px repeat(3, 76px) 70px 70px 70px minmax(110px, 1fr)";

export function PeriodView({ data, origin, range, initialAt }: { data: SleepData; origin: Origin; range: Exclude<Range, "year">; initialAt: string | null }) {
  const [anchor, setAnchor] = useState(initialAt && /^\d{4}-\d{2}-\d{2}$/.test(initialAt) ? initialAt : data.today);
  const [hover, setHover] = useState<number | null>(null);
  const byDay = useMemo(() => new Map(data.nights.map((n) => [n.day, n])), [data.nights]);
  const shown = period(range, anchor, 0);
  const before = period(range, anchor, -1);
  const latest = period(range, data.today, 0);
  const atLatest = shown.days[0] >= latest.days[0];
  const first = data.nights[0]?.day ?? data.today;
  const atFirst = shown.days[shown.days.length - 1] < first;
  const nights = shown.days.map((d) => byDay.get(d)).filter((n): n is SleepRecord => n != null);
  const prevNights = before.days.map((d) => byDay.get(d)).filter((n): n is SleepRecord => n != null);
  const s = summarise(nights);
  const prev = prevNights.length ? summarise(prevNights) : null;
  const move = (k: number) => { setAnchor(period(range, anchor, k).days[0]); setHover(null); };
  const isWeek = range === "week";
  const word = isWeek ? "week" : "month";
  const thisLabel = isWeek ? t("This week") : t("This month");
  const title = atLatest ? thisLabel : shown.title;
  const letters = Array.from(t("SMTWTFS"));
  const axis = shown.days.map((d, i) => { const x = parseDay(d); return isWeek ? `${letters[x.getDay()]} ${x.getDate()}` : i % 5 === 0 ? String(x.getDate()) : ""; });

  const scores = nights.map((n) => n.score).filter((v): v is number => v != null);
  const hi = scores.length ? Math.max(...scores) : null, lo = scores.length ? Math.min(...scores) : null;
  const daysWith = (v: number) => nights.filter((n) => n.score === v).map((n) => { const d = parseDay(n.day); return `${dayShortName(d)} ${d.getDate()}`; }).join(", ");
  const split = trainingSplit(nights);
  const trainLine = split.trained.score == null || split.rest.score == null
    ? t("Needs nights after both training and rest days.")
    : Math.round(split.trained.score) === Math.round(split.rest.score)
      ? t("You score about the same after training and rest days.")
      : split.trained.score > split.rest.score
        ? t("You score {n} points higher after training than after rest days.", { n: Math.round(split.trained.score - split.rest.score) })
        : t("You score {n} points lower after training than after rest days. Hard sessions late in the day can cost sleep.", { n: Math.round(split.rest.score - split.trained.score) });

  return (
    <>
      <SleepHead tab={range} origin={origin} title={title}
        back={{ label: isWeek ? t("Previous week") : t("Previous month"), disabled: atFirst, go: () => move(-1) }}
        forward={{ label: isWeek ? t("Next week") : t("Next month"), disabled: atLatest, go: () => move(1) }}
        latest={{ label: thisLabel, disabled: atLatest, go: () => { setAnchor(data.today); setHover(null); } }} />
      {nights.length === 0 ? <div className="notice">{isWeek ? t("No sleep in this week.") : t("No sleep in this month.")}</div> : (
        <>
          <SummarySky s={s} prev={prev} prevWord={word} />
          <div className="sl-two">
            <Card aria-label={isWeek ? t("Night by night") : t("Every night")} className="sl-card sl-wide">
              <div className="sl-card-head">
                <h2 className="h2">{isWeek ? t("Night by night") : t("Every night")}</h2>
                <span className="muted" style={{ fontSize: 12 }}>{isWeek ? t("Stages to scale; open a night for its detail") : t("Score and time asleep; open a night for its detail")}</span>
              </div>
              {isWeek ? <WeekColumns days={shown.days} byDay={byDay} hover={hover} /> : <MonthCalendar days={shown.days} byDay={byDay} today={data.today} />}
            </Card>
            <div className="sl-narrow">
              <Card aria-label={t("Highest and lowest")} className="sl-card" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
                <Figure k={t("Highest score")}><span className="num" style={{ fontSize: 34, fontWeight: 900, color: "var(--h-mint-ink)" }}>{hi ?? "–"}</span><span className="muted" style={{ fontSize: 13 }}>{hi != null ? daysWith(hi) : ""}</span></Figure>
                <Figure k={t("Lowest score")}><span className="num" style={{ fontSize: 34, fontWeight: 900, color: "var(--h-rose-ink)" }}>{lo ?? "–"}</span><span className="muted" style={{ fontSize: 13 }}>{lo != null ? daysWith(lo) : ""}</span></Figure>
              </Card>
              <Card aria-label={t("Sleep and training")} className="sl-card" style={{ flex: 1 }}>
                <h2 className="h2">{t("Sleep and training")}</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  {([[t("After training"), split.trained], [t("After rest days"), split.rest]] as const).map(([k, g]) => (
                    <div key={k} className="sl-inset" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "12px 14px" }}>
                      <span className="muted" style={{ fontSize: 12 }}>{k}</span>
                      <span className="num" style={{ fontSize: 28, fontWeight: 900, color: g.score != null ? scoreInk(g.score) : "var(--dim)" }}>{g.score != null ? Math.round(g.score) : "–"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{g.asleep != null ? t("{time} asleep", { time: hm(g.asleep) }) : t("No nights")}</span>
                      <span style={{ fontSize: 12, color: "var(--dim)" }}>{g.nights === 1 ? t("1 night") : t("{n} nights", { n: g.nights })}</span>
                    </div>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{trainLine}</p>
              </Card>
            </div>
          </div>

          <div className="sl-card-head" style={{ marginTop: 6 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{isWeek ? t("Night by night, against the week before") : t("Night by night, against the month before")}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{t("Point at any chart; all of them follow")}</span>
          </div>
          <div className="sl-trends">
            {TRENDS.map((d) => (
              <TrendCard key={d.title} def={d} days={shown.days} byDay={byDay} prev={prevNights} prevName={isWeek ? t("Previous week") : t("Previous month")} hover={hover} onHover={setHover} axis={axis} />
            ))}
          </div>

          <Card clip aria-label={t("Sleep records")} className="sl-table">
            <div className="sl-card-head" style={{ padding: "18px 20px 12px" }}><h2 className="h2">{t("Sleep records")}</h2><span className="muted" style={{ fontSize: 12 }}>{t("Newest first")}</span></div>
            <div className="scroll-x">
              <div role="table" aria-label={t("Sleep records")} style={{ minWidth: 1060 }}>
                <div role="row" className="thead" style={{ gridTemplateColumns: RECORD_COLS, gap: 12 }}>
                  {[msg("Night"), msg("Score"), msg("Asleep"), msg("In bed"), msg("Deep"), "REM", msg("Awake"), "HR", "HRV", msg("Stress"), msg("Day before")].map((h, i) => (
                    <span key={h} role="columnheader" style={{ textAlign: i > 0 && i !== 3 && i !== 10 ? "right" : undefined }}>{t(h)}</span>
                  ))}
                </div>
                {[...nights].reverse().map((n) => {
                  const f = nightFacts(n), st = stressStats(n);
                  return (
                    <Link key={n.day} role="row" className="row" href={`/health/sleep?night=${n.day}`} style={{ gridTemplateColumns: RECORD_COLS, gap: 12, minHeight: 44 }}>
                      <span role="cell" style={{ fontWeight: 600 }}>{label(n.day)}</span>
                      <span role="cell" style={{ textAlign: "right", fontWeight: 800, color: n.score != null ? scoreInk(n.score) : "var(--dim)" }}>{n.score ?? "–"}</span>
                      <span role="cell" style={{ textAlign: "right", fontWeight: 600 }}>{f.asleep != null ? hm(f.asleep) : "–"}</span>
                      <span role="cell" className="muted">{f.bed != null && f.wake != null ? `${clockOfDay(f.bed)} – ${clockOfDay(f.wake)}` : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{f.deep != null ? hm(f.deep) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{f.rem != null ? hm(f.rem) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{f.awake != null ? hm(f.awake) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{n.heartRateAsleep ?? "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{n.hrv ?? "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{st?.average ?? "–"}</span>
                      <span role="cell" className="muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.dayBefore == null ? "–" : n.dayBefore.length ? n.dayBefore.join(", ") : t("Rest day")}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </Card>
        </>
      )}
      <p className="sl-note">{t(PAGE_NOTE)}</p>
    </>
  );
}

function WeekColumns({ days, byDay, hover }: { days: string[]; byDay: Map<string, SleepRecord>; hover: number | null }) {
  const scale = 560;
  return (
    <>
      <div className="sl-week">
        {days.map((d, i) => {
          const n = byDay.get(d), x = parseDay(d), name = `${dayShortName(x)} ${x.getDate()}`;
          if (!n) {
            return (
              <div key={d} aria-label={t("{day}, no night", { day: name })}>
                <span className="num" style={{ textAlign: "center", fontSize: 18, fontWeight: 800, color: "var(--dim)" }}>–</span>
                <span className="sl-stack" style={{ background: "transparent", border: "1px dashed var(--line)" }} />
                <span style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--dim)" }}>{t("No night")}</span>
                <span className="muted" style={{ textAlign: "center", fontSize: 12 }}>{name}</span>
              </div>
            );
          }
          const f = nightFacts(n);
          return (
            <Link key={d} href={`/health/sleep?night=${d}`} aria-label={nightLabel(name, n.score, f.asleep)}
              style={{ background: hover === i ? "rgba(var(--fg-rgb), 0.06)" : undefined }}>
              <span className="num" style={{ textAlign: "center", fontSize: 18, fontWeight: 800, color: n.score != null ? scoreInk(n.score) : "var(--dim)" }}>{n.score ?? "–"}</span>
              <span aria-hidden="true" className="sl-stack">
                {(["deep", "light", "rem", "awake"] as const).map((k) => <span key={k} style={{ height: `${((f[k] ?? 0) / scale) * 100}%`, background: `var(--sl-${k})` }} />)}
                {f.napMinutes > 0 ? <span style={{ height: `${(f.napMinutes / scale) * 100}%`, background: "var(--sl-nap)", borderBottom: "2px solid var(--card-bg)" }} /> : null}
              </span>
              <span style={{ textAlign: "center", fontSize: 13, fontWeight: 700 }}>{f.asleep != null ? hm(f.asleep) : "–"}</span>
              <span className="muted" style={{ textAlign: "center", fontSize: 12 }}>{name}</span>
            </Link>
          );
        })}
      </div>
      <div className="sl-legend">
        {[[msg("Deep"), "var(--sl-deep)"], [msg("Light"), "var(--sl-light)"], ["REM", "var(--sl-rem)"], [msg("Awake"), "var(--sl-awake)"], [msg("Nap"), "var(--sl-nap)"]].map(([k, c]) => (
          <span key={k}><span className="sl-key" style={{ background: c }} />{t(k)}</span>
        ))}
      </div>
    </>
  );
}

const CELL_BG: Record<"violet" | "gold" | "coral", string> = {
  violet: "rgba(165,148,255,0.12)", gold: "rgba(216,155,34,0.13)", coral: "rgba(255,122,89,0.13)",
};

function MonthCalendar({ days, byDay, today }: { days: string[]; byDay: Map<string, SleepRecord>; today: string }) {
  const lead = (parseDay(days[0]).getDay() + 6) % 7;
  return (
    <>
      <div aria-hidden="true" className="sl-cal-head">{[...SHORT_DAY.slice(1), SHORT_DAY[0]].map((d) => <span key={d}>{t(d)}</span>)}</div>
      <div className="sl-cal">
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden="true" />)}
        {days.map((d) => {
          const n = byDay.get(d), dom = parseDay(d).getDate();
          if (!n) return <span key={d} className="sl-cell sl-cell-empty" aria-label={t("{day}, no night", { day: label(d) })}>{dom}</span>;
          const f = nightFacts(n), s = n.score;
          const tone = s == null ? null : s >= 70 ? "violet" : s >= 55 ? "gold" : "coral";
          return (
            <Link key={d} className="sl-cell" href={`/health/sleep?night=${d}`} aria-label={nightLabel(label(d), s, f.asleep)}
              style={{ background: tone ? CELL_BG[tone] : "rgba(var(--fg-rgb), 0.04)", borderColor: d === today ? "var(--h-violet)" : undefined, opacity: s != null && s >= 85 ? 1 : undefined }}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                <span>{dom}</span>{f.napMinutes > 0 ? <span style={{ color: "var(--sl-nap)", fontWeight: 700 }}>{t("nap")}</span> : null}
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0 4px" }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 800, color: s != null ? scoreInk(s) : "var(--dim)" }}>{s ?? "–"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{f.asleep != null ? hm(f.asleep) : ""}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
