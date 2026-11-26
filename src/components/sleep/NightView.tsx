"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Card, CountUp } from "@/components/ui";
import { NightSky } from "@/components/viz/NightSky";
import { ScoreDial } from "@/components/viz/ScoreDial";
import type { Origin } from "@/data/core";
import type { SleepStage } from "@/data/health";
import type { SleepData, SleepRecord } from "@/data/sleep";
import { parseDay } from "@/lib/format";
import { msg, t, tx } from "@/lib/i18n";
import { clockOfDay, dayLabel, dayMonth, stageSpans } from "@/lib/health";
import {
  STRESS_BANDS, TYPICAL_SHARE, coachQuestions, hm, nightFacts, quality, signedHm, stageShare, stressBand, stressStats, tonightPlan, usual,
} from "@/lib/sleep";
import { BAND_VAR, DeltaChip, PAGE_NOTE, SleepHead, STAGE_LABEL, STAGE_VAR, IconStep, scoreGlow, scoreInk, scoreVar, TonightChips, tonightSource } from "./common";

const STRIP = 30;
const ROW_Y: Record<SleepStage, number> = { awake: 4, rem: 46.5, light: 89, deep: 131.5 };
const ROWS: SleepStage[] = ["awake", "rem", "light", "deep"];
const SKY_STAGE: Record<SleepStage, string> = { awake: "var(--h-orange)", rem: "var(--h-cyan)", light: "var(--stage-light)", deep: "var(--stage-deep)" };

const nightTitle = (n: SleepRecord) => dayLabel(parseDay(n.day));

export function NightView({ data, origin, initialDay }: { data: SleepData; origin: Origin; initialDay: string | null }) {
  const { nights } = data;
  const last = nights.length - 1;
  const start = useMemo(() => {
    const i = initialDay ? nights.findIndex((n) => n.day === initialDay) : -1;
    return i >= 0 ? i : last;
  }, [initialDay, nights, last]);
  const [sel, setSel] = useState(start);
  const [stripEnd, setStripEnd] = useState(Math.min(last, Math.max(start, STRIP - 1)));
  const [hover, setHover] = useState<number | null>(null);

  const go = (i: number) => {
    const next = Math.max(0, Math.min(last, i));
    setSel(next);
    setHover(null);
    setStripEnd((end) => (next > end ? next : next < end - (STRIP - 1) ? next + STRIP - 1 : end));
  };

  if (nights.length === 0) {
    return (
      <>
        <SleepHead tab="night" origin={origin} title={t("Last night")}
          back={{ label: t("Previous night"), disabled: true, go: () => {} }} forward={{ label: t("Next night"), disabled: true, go: () => {} }}
          latest={{ label: t("Last night"), disabled: true, go: () => {} }} />
        <div className="notice">{t("Nothing from your phone yet")}</div>
      </>
    );
  }

  const n = nights[sel];
  return (
    <>
      <SleepHead
        tab="night" origin={origin} title={sel === last ? t("Last night") : nightTitle(n)}
        back={{ label: t("Previous night"), disabled: sel === 0, go: () => go(sel - 1) }}
        forward={{ label: t("Next night"), disabled: sel === last, go: () => go(sel + 1) }}
        latest={{ label: t("Last night"), disabled: sel === last, go: () => go(last) }}
      />
      <NightStrip nights={nights} end={stripEnd} sel={sel} onPick={go}
        onEarlier={() => setStripEnd((e) => Math.max(Math.min(last, STRIP - 1), e - STRIP))}
        onLater={() => setStripEnd((e) => Math.min(last, e + STRIP))} />
      <Night key={n.day} nights={nights} index={sel} isLatest={sel === last} hover={hover} onHover={setHover}
        tonight={{ scheduleWake: data.schedule?.wake, workout: data.tomorrow }} />
      <p className="sl-note">{t(PAGE_NOTE)}</p>
    </>
  );
}

function NightStrip({ nights, end, sel, onPick, onEarlier, onLater }: {
  nights: SleepRecord[]; end: number; sel: number; onPick: (i: number) => void; onEarlier: () => void; onLater: () => void;
}) {
  const from = Math.max(0, end - STRIP + 1);
  const shown = nights.slice(from, end + 1);
  const top = 600;
  const first = shown[0], lastShown = shown[shown.length - 1];
  return (
    <Card aria-label={t("Pick a night")} className="sl-strip">
      <div className="sl-card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2 className="h2">{t("Nights")}</h2>
          <span className="muted" style={{ fontSize: 13 }}>{t("{from} to {to}", { from: dayMonth(parseDay(first.day)), to: dayMonth(parseDay(lastShown.day)) })}</span>
        </div>
        <div className="sl-legend">
          <span><span className="sl-key" style={{ background: "var(--h-violet)" }} />{t("Good or better")}</span>
          <span><span className="sl-key" style={{ background: "var(--h-gold)" }} />{t("Fair")}</span>
          <span><span className="sl-key" style={{ background: "var(--h-coral)" }} />{t("Low")}</span>
          <span><span className="sl-key" style={{ background: "var(--sl-nap)" }} />{t("Nap")}</span>
          <IconStep label={t("Earlier nights")} disabled={from === 0} onClick={onEarlier} />
          <IconStep next label={t("Later nights")} disabled={end >= nights.length - 1} onClick={onLater} />
        </div>
      </div>
      <div className="sl-strip-bars">
        <div aria-hidden="true" className="sl-band" style={{ position: "absolute", left: 0, right: 0, top: `${100 - (540 / top) * 100}%`, height: `${(120 / top) * 100}%`, borderTop: "1px dashed var(--line)", borderBottom: "1px dashed var(--line)", background: "var(--sl-band)", pointerEvents: "none" }} />
        {shown.map((x, k) => {
          const f = nightFacts(x), i = from + k, on = i === sel, s = x.score;
          return (
            <button key={x.day} type="button" className="sl-strip-bar" aria-pressed={on} onClick={() => onPick(i)}
              aria-label={[nightTitle(x), ...(s != null ? [t("score {n}", { n: s })] : []), ...(f.asleep != null ? [t("{time} asleep", { time: hm(f.asleep) })] : [])].join(", ")}
              style={{ boxShadow: on && s != null ? `inset 0 0 0 2px ${scoreVar(s)}` : undefined }}>
              {f.napMinutes > 0 ? <span aria-hidden="true" style={{ height: `${(f.napMinutes / top) * 100}%`, borderRadius: 3, background: "var(--sl-nap)" }} /> : null}
              <span aria-hidden="true" style={{ height: `${(Math.min(f.asleep ?? 0, top) / top) * 100}%`, borderRadius: 4, background: s != null ? scoreVar(s) : "rgba(var(--fg-rgb), 0.2)", boxShadow: on && s != null ? `0 0 16px 2px ${scoreGlow(s)}` : undefined }} />
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="sl-strip-labels">
        {shown.map((x, k) => {
          const d = parseDay(x.day), weekend = d.getDay() === 0 || d.getDay() === 6, on = from + k === sel;
          return (
            <div key={x.day} style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 800, color: x.score != null ? scoreInk(x.score) : "var(--dim)" }}>{x.score ?? "–"}</span>
              <span style={{ color: weekend ? "var(--fg)" : "var(--muted)", fontWeight: on ? 800 : 500 }}>{Array.from(t("SMTWTFS"))[d.getDay()]}</span>
              <span style={{ color: "var(--dim)" }}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function hourTicks(bed: number, inBed: number) {
  const out: { at: number; text: string }[] = [];
  for (let h = Math.ceil(bed / 60) * 60; h <= bed + inBed; h += 60) {
    const at = (h - bed) / inBed;
    if (at > 0.03 && at < 0.97) out.push({ at, text: clockOfDay(h % 1440) });
  }
  return out;
}

function Night({ nights, index, isLatest, hover, onHover, tonight }: {
  nights: SleepRecord[]; index: number; isLatest: boolean; hover: number | null; onHover: (m: number | null) => void;
  /** What tonight's plan needs besides the nights: the watch's wake time and tomorrow's workout. */
  tonight: { scheduleWake?: number | null; workout?: string | null };
}) {
  const n = nights[index];
  const f = useMemo(() => nightFacts(n), [n]);
  const stress = useMemo(() => stressStats(n), [n]);
  const spans = useMemo(() => stageSpans(n.segments), [n.segments]);
  const usualAsleep = usual(nights, index, (x) => nightFacts(x).asleep);
  const usualStress = usual(nights, index, (x) => stressStats(x)?.average ?? null);
  const plan = isLatest ? tonightPlan(nights, tonight) : null;

  // The night's clock: falling asleep to waking, or the stress readings' length when the stages are missing.
  const span = Math.max(f.inBed ?? 0, stress ? stress.readings[stress.readings.length - 1].offset + 5 : 0, 1);
  const bed = f.bed ?? 0;
  const ticks = hourTicks(bed, span);
  const X = (m: number) => (m / span) * 1000;

  const blocks = useMemo(() => {
    const out: Record<SleepStage, string> = { awake: "", rem: "", light: "", deep: "" };
    let links = "";
    spans.forEach((s, k) => {
      const x0 = (s.from / span) * 1000, w = ((s.to - s.from) / span) * 1000;
      out[s.stage] += `M${x0.toFixed(1)} ${ROW_Y[s.stage]}h${w.toFixed(1)}v34.5h-${w.toFixed(1)}z`;
      if (k) links += `M${x0.toFixed(1)} ${ROW_Y[spans[k - 1].stage] + 17}V${ROW_Y[s.stage] + 17}`;
    });
    return { ...out, links };
  }, [spans, span]);

  const hit = hover != null ? spans.find((s) => hover >= s.from && hover < s.to) ?? null : null;
  const reading = hover != null && stress ? stress.readings.reduce<{ v: number; d: number } | null>((p, r) => {
    const d = Math.abs(r.offset - hover);
    return !p || d < p.d ? { v: r.value, d } : p;
  }, null) : null;
  const readout = hover == null
    ? t("Point at the chart to read any moment of the night")
    : [
      clockOfDay(bed + hover),
      ...(hit ? [t("{stage} for {time}", { stage: t(STAGE_LABEL[hit.stage]), time: hm(hit.to - hit.from) })] : []),
      ...(reading && reading.d <= 5 && hit?.stage !== "awake" ? [t("stress {n}", { n: reading.v })] : []),
    ].join("  ·  ");

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) onHover(Math.max(0, Math.min(span - 1, Math.round(((e.clientX - r.left) / r.width) * span))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30 : 5;
    let next: number | null = hover;
    if (e.key === "ArrowRight") next = Math.min(span - 1, (hover ?? -step) + step);
    else if (e.key === "ArrowLeft") next = Math.max(0, (hover ?? span) - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = span - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    onHover(next);
  };
  const hitLayer = (label: string) => (
    <div className="chart-hit" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={span} aria-valuenow={hover ?? 0}
      aria-valuetext={readout} onPointerMove={point} onPointerDown={point} onPointerLeave={() => onHover(null)} onKeyDown={key} />
  );

  const score = n.score;
  const dMin = f.asleep != null && usualAsleep != null ? f.asleep - usualAsleep : null;
  const points = n.naps.reduce((p, x) => p + (x.points ?? 0), 0);

  return (
    <>
      <NightSky aria-label={t("The night")} className="sl-sky">
        <div className="sl-sky-row">
          <div style={{ flex: "none", width: 240, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, margin: "0 auto" }}>
            <ScoreDial value={score ?? 0} size={220} radius={97} stroke={17}
              color={score != null ? scoreVar(score) : "transparent"} glow={score != null ? scoreGlow(score) : "transparent"} glowBlur={9}
              label={score != null ? t("Sleep score {score} out of 100, {rating}", { score, rating: t(quality(score)) }) : t("No sleep score")}>
              <CountUp className="num" style={{ fontSize: 68, fontWeight: 900, lineHeight: 1 }} text={score != null ? String(score) : "–"} />
              {score != null ? <span style={{ fontSize: 15, fontWeight: 700, color: "var(--sky-rating)" }}>{t(quality(score))}</span> : null}
              <span style={{ fontSize: 12, color: "var(--sky-text)" }}>{t("Sleep score")}</span>
            </ScoreDial>
            {points > 0 && n.nightScore != null ? (
              <div style={{ display: "flex", gap: 6 }}>
                <span className="sl-chip sl-chip-glass">{t("Night {n}", { n: n.nightScore })}</span>
                <span className="sl-chip" style={{ background: "rgba(246,193,119,0.18)", border: "1px solid rgba(246,193,119,0.4)", color: "var(--sl-nap)" }}>{t("Naps +{n}", { n: points })}</span>
              </div>
            ) : null}
            {f.asleep != null ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <CountUp className="num" style={{ fontSize: 26, fontWeight: 800 }} text={hm(f.asleep)} />
                <span style={{ color: "var(--sky-text)" }}>{t("asleep")}</span>
              </div>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {dMin != null ? <DeltaChip good={dMin >= 0}>{t("{delta} vs your average", { delta: signedHm(dMin) })}</DeltaChip> : null}
              {f.efficiency != null ? <span className="sl-chip sl-chip-glass">{t("{n}% asleep in bed", { n: Math.round(f.efficiency) })}</span> : null}
            </div>
          </div>

          <div style={{ flex: "1 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="sl-card-head">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px" }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{isLatest ? t("Last night, {day}", { day: nightTitle(n) }) : nightTitle(n)}</h2>
                {f.bed != null && f.wake != null ? (
                  <span style={{ fontSize: 14, color: "var(--sky-text)" }}>{t("{from} to {to}", { from: clockOfDay(f.bed), to: clockOfDay(f.wake) })}{f.inBed != null ? `  ·  ${t("{time} in bed", { time: hm(f.inBed) })}` : ""}</span>
                ) : null}
              </div>
            </div>
            {spans.length > 0 ? (
              <>
                <div className="sl-readout" aria-hidden="true">{readout}</div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div aria-hidden="true" style={{ flex: "none", width: 48, display: "flex", flexDirection: "column", justifyContent: "space-around", fontSize: 12, color: "var(--sky-text)" }}>
                    {ROWS.map((s) => <span key={s}>{t(STAGE_LABEL[s])}</span>)}
                  </div>
                  <div className="sl-chart">
                    <svg role="img" aria-label={t("Sleep stages: deep {deep}, light {light}, REM {rem}, awake {awake}", { deep: hm(f.deep ?? 0), light: hm(f.light ?? 0), rem: hm(f.rem ?? 0), awake: hm(f.awake ?? 0) })}
                      width="100%" height="170" viewBox="0 0 1000 170" preserveAspectRatio="none" style={{ display: "block" }}>
                      <path d={ticks.map((tk) => `M${(tk.at * 1000).toFixed(1)} 0V170`).join("")} fill="none" style={{ stroke: "rgba(255,255,255,0.08)", vectorEffect: "non-scaling-stroke" }} />
                      <path d="M0 42.5H1000M0 85H1000M0 127.5H1000" fill="none" style={{ stroke: "rgba(255,255,255,0.06)", vectorEffect: "non-scaling-stroke" }} />
                      <path d={blocks.links} fill="none" style={{ stroke: "rgba(255,255,255,0.22)", vectorEffect: "non-scaling-stroke" }} />
                      {ROWS.map((s) => <path key={s} d={blocks[s]} style={{ fill: SKY_STAGE[s] }} />)}
                      {hover != null ? <rect x={X(hover)} y="0" width="2" height="170" style={{ fill: "rgba(255,255,255,0.85)" }} /> : null}
                    </svg>
                    {hitLayer(t("Moment of the night"))}
                    <div aria-hidden="true" className="sl-axis" style={{ color: "var(--sky-text)" }}>
                      {ticks.map((tk) => <span key={tk.text} style={{ left: `${(tk.at * 100).toFixed(2)}%` }}>{tk.text}</span>)}
                    </div>
                  </div>
                </div>
              </>
            ) : <span style={{ fontSize: 13, color: "var(--sky-text)" }}>{t("No stages from your watch for this night")}</span>}
            <div className="sl-panel sl-stats">
              {(["deep", "light", "rem", "awake"] as const).map((s) => {
                const v = f[s];
                const share = s === "awake" ? null : stageShare(f, s);
                return (
                  <div key={s} className="sl-stat">
                    <span className="sl-stat-k"><span aria-hidden="true" className="sl-key" style={{ width: 8, height: 8, borderRadius: 2, background: SKY_STAGE[s] }} />{t(STAGE_LABEL[s])}</span>
                    <span className="sl-stat-v num">{v != null ? hm(v) : "–"}</span>
                    <span style={{ fontSize: 12, color: "var(--sky-text)" }}>{s === "awake" ? (f.wakings != null ? (f.wakings === 1 ? t("1 waking") : t("{n} wakings", { n: f.wakings })) : "") : share != null ? t("{n}% of sleep", { n: Math.round(share) }) : ""}</span>
                  </div>
                );
              })}
              {[[t("Fell asleep"), f.bed != null ? clockOfDay(f.bed) : "–"], [t("Woke up"), f.wake != null ? clockOfDay(f.wake) : "–"],
                [t("HR asleep"), n.heartRateAsleep != null ? `${n.heartRateAsleep} bpm` : "–"], [t("Sleep HRV"), n.hrv != null ? `${n.hrv} ms` : "–"]].map(([k, v]) => (
                <div key={k} className="sl-stat"><span className="sl-stat-k">{k}</span><span className="sl-stat-v num">{v}</span></div>
              ))}
            </div>
            <CoachRow questions={coachQuestions(n, usualAsleep, nightTitle(n))} />
          </div>
        </div>
      </NightSky>

      <div className="sl-cols">
        <div className="sl-main-col">
          <StressCard n={n} stress={stress} usualStress={usualStress} span={span} bed={bed} ticks={ticks} spans={spans}
            hover={hover} hitLayer={hitLayer(t("Sleep stress through the night"))} />
          <StagesCard f={f} nights={nights} index={index} />
        </div>
        <div className="sl-side-col">
          {plan ? <TonightCard plan={plan} /> : null}
          <OvernightCard nights={nights} index={index} />
          <NapsCard n={n} />
          <Card aria-label={t("This night")} className="sl-card" style={{ gap: 8 }}>
            <h2 className="h2">{t("This night")}</h2>
            <div className="sl-facts">
              {[
                [t("In bed"), f.bed != null && f.wake != null ? `${clockOfDay(f.bed)} – ${clockOfDay(f.wake)}` : "–"],
                [t("Asleep in bed"), f.efficiency != null ? `${Math.round(f.efficiency)}%` : "–"],
                [t("Interruptions"), f.wakings != null ? String(f.wakings) : "–"],
                [t("Longest awake"), f.longestAwake != null ? hm(f.longestAwake) : "–"],
                [t("Day before"), n.dayBefore == null ? t("Not known") : n.dayBefore.length ? n.dayBefore.join(", ") : t("Rest day")],
                [t("Usual asleep"), usualAsleep != null ? hm(usualAsleep) : "–"],
              ].map(([k, v]) => <div key={k}><span className="muted">{k}</span><span style={{ fontWeight: 700, textAlign: "right" }}>{v}</span></div>)}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function StressCard({ n, stress, usualStress, span, bed, ticks, spans, hover, hitLayer }: {
  n: SleepRecord; stress: ReturnType<typeof stressStats>; usualStress: number | null; span: number; bed: number;
  ticks: { at: number; text: string }[]; spans: ReturnType<typeof stageSpans>; hover: number | null; hitLayer: React.ReactNode;
}) {
  const head = (
    <div className="sl-card-head">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" className="sl-badge" style={{ background: "rgba(255,122,89,0.14)", color: "var(--h-coral-ink)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M3 12h3l2-5 3 10 3-7 2 4h5" /></svg>
        </span>
        <h2 className="h2">{t("Sleep stress")}</h2>
      </div>
      {stress && usualStress != null ? (() => {
        const d = Math.round(stress.average - usualStress);
        return <DeltaChip good={d === 0 ? null : d < 0}>{d > 0 ? "+" : d < 0 ? "−" : "±"}{t("{n} vs your usual", { n: Math.abs(d) })}</DeltaChip>;
      })() : null}
    </div>
  );
  if (!stress) {
    return (
      <Card aria-label={t("Sleep stress")} className="sl-card">
        {head}
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{n.stress ? t("No readings while asleep this night.") : t("Nothing from your phone yet")}</p>
      </Card>
    );
  }
  const X = (m: number) => (m / span) * 1000, Y = (v: number) => 200 - v * 2;
  let line = "", pen = false, area = "";
  const asleep = stress.readings.filter((r) => r.stage !== "awake");
  for (const r of stress.readings) {
    if (r.stage === "awake") { pen = false; continue; }
    line += `${pen ? "L" : "M"}${X(r.offset).toFixed(1)} ${Y(r.value).toFixed(1)}`;
    pen = true;
  }
  if (asleep.length) area = `M${X(asleep[0].offset).toFixed(1)} 200${asleep.map((r) => `L${X(r.offset).toFixed(1)} ${Y(r.value).toFixed(1)}`).join("")}L${X(asleep[asleep.length - 1].offset).toFixed(1)} 200z`;
  const awake = spans.filter((s) => s.stage === "awake").map((s) => `M${X(s.from).toFixed(1)} 0h${(X(s.to) - X(s.from)).toFixed(1)}v200h-${(X(s.to) - X(s.from)).toFixed(1)}z`).join("");
  const ribbon: Record<SleepStage, string> = { deep: "", light: "", rem: "", awake: "" };
  for (const s of spans) ribbon[s.stage] += `M${X(s.from).toFixed(1)} 0h${(X(s.to) - X(s.from)).toFixed(1)}v12h-${(X(s.to) - X(s.from)).toFixed(1)}z`;
  const total = stress.bands.reduce((p, v) => p + v, 0);
  const level = stressBand(stress.average);
  const peakLeft = `${((stress.peakOffset / span) * 100).toFixed(2)}%`;

  return (
    <Card aria-label={t("Sleep stress")} className="sl-card">
      {head}
      <div className="sl-figs">
        <div className="sl-fig"><span>{t("Average")}</span><span><span className="num sl-big">{stress.average}</span><span style={{ fontSize: 14, fontWeight: 700, color: BAND_VAR[level] }}>{t(STRESS_BANDS[level])}</span></span></div>
        <div className="sl-fig"><span>{tx("stress", "Peak")}</span><span><span className="num sl-big">{stress.peak}</span><span className="muted" style={{ fontSize: 14 }}>{t("at {time}", { time: clockOfDay(bed + stress.peakOffset) })}</span></span></div>
        <div className="sl-fig"><span>{t("Restful")}</span><span><span className="num sl-big">{stress.restful}%</span><span className="muted" style={{ fontSize: 14 }}>{t("of your sleep")}</span></span></div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div aria-hidden="true" style={{ position: "relative", flex: "none", width: 52, height: 200, fontSize: 11, color: "var(--dim)" }}>
          {[msg("High"), msg("Medium"), msg("Low"), msg("Rest")].map((b, k) => <span key={b} style={{ position: "absolute", top: `${6 + k * 25}%` }}>{t(b)}</span>)}
        </div>
        <div className="sl-chart">
          <svg role="img" aria-label={t("Stress through the night: average {avg}, peak {peak} at {time}, restful for {n} percent of sleep", { avg: stress.average, peak: stress.peak, time: clockOfDay(bed + stress.peakOffset), n: stress.restful })}
            width="100%" height="200" viewBox="0 0 1000 200" preserveAspectRatio="none" style={{ display: "block" }}>
            <defs>
              <linearGradient id="sl-stress" x1="0" y1="200" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                {BAND_VAR.map((c, k) => <stop key={k} offset={[0, 0.3, 0.6, 1][k]} style={{ stopColor: c }} />)}
              </linearGradient>
              <linearGradient id="sl-stress-area" x1="0" y1="0" x2="0" y2="200" gradientUnits="userSpaceOnUse">
                <stop offset="0" style={{ stopColor: "var(--sl-b2)", stopOpacity: 0.32 }} />
                <stop offset="1" style={{ stopColor: "var(--sl-b0)", stopOpacity: 0.04 }} />
              </linearGradient>
            </defs>
            <rect x="0" y="150" width="1000" height="50" style={{ fill: "var(--sl-b0)", opacity: 0.08 }} />
            <path d="M0 50H1000M0 100H1000M0 150H1000" fill="none" style={{ stroke: "var(--line)", strokeDasharray: "4 6", vectorEffect: "non-scaling-stroke" }} />
            <path d={awake} style={{ fill: "var(--sl-awake)", opacity: 0.14 }} />
            <path d={area} fill="url(#sl-stress-area)" />
            <path d={line} fill="none" stroke="url(#sl-stress)" style={{ strokeWidth: 2.4, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
            {hover != null ? <rect x={X(hover)} y="0" width="2" height="200" style={{ fill: "var(--muted)" }} /> : null}
          </svg>
          <div aria-hidden="true" className="sl-peak" style={{ left: peakLeft, top: Y(stress.peak) }} />
          <div aria-hidden="true" className="tip sl-peak-tip" style={{ left: peakLeft, top: Math.max(0, Y(stress.peak) - 32) }}>{t("Peak {n}", { n: stress.peak })}</div>
          {spans.length ? (
            <svg aria-hidden="true" width="100%" height="12" viewBox="0 0 1000 12" preserveAspectRatio="none" style={{ display: "block", marginTop: 8, borderRadius: 3 }}>
              {(["deep", "light", "rem", "awake"] as const).map((s) => <path key={s} d={ribbon[s]} style={{ fill: STAGE_VAR[s] }} />)}
            </svg>
          ) : null}
          {hitLayer}
          <div aria-hidden="true" className="sl-axis">
            {ticks.map((tk) => <span key={tk.text} style={{ left: `${(tk.at * 100).toFixed(2)}%` }}>{tk.text}</span>)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 36px" }}>
        <div style={{ flex: "2 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Readings while asleep")}</span>
          <div aria-hidden="true" style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "rgba(var(--fg-rgb), 0.08)" }}>
            {stress.bands.map((c, k) => <span key={k} style={{ width: `${(c / total) * 100}%`, background: BAND_VAR[k] }} />)}
          </div>
          <div className="sl-legend">
            {stress.bands.map((c, k) => <span key={k}><span className="sl-key" style={{ width: 8, height: 8, borderRadius: 2, background: BAND_VAR[k] }} />{t(STRESS_BANDS[k])} <strong style={{ color: "var(--fg)" }}>{Math.round((c / total) * 100)}%</strong></span>)}
          </div>
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("By stage")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {(["deep", "light", "rem"] as const).map((s) => (
              <div key={s} className="sl-inset" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px" }}>
                <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}><span aria-hidden="true" className="sl-key" style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_VAR[s] }} />{t(STAGE_LABEL[s])}</span>
                <span className="num" style={{ fontSize: 18, fontWeight: 800 }}>{stress.byStage[s] ?? "–"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="sl-note">{t("Your watch rates stress from heart rate variability every 5 minutes while you’re still. Awake moments aren’t counted in the average.")}</p>
    </Card>
  );
}

const STAGE_COLS = "minmax(110px, 1fr) 80px 56px minmax(200px, 2.4fr) minmax(130px, 1.2fr)";

function StagesCard({ f, nights, index }: { f: ReturnType<typeof nightFacts>; nights: SleepRecord[]; index: number }) {
  return (
    <Card aria-label={t("Stages")} className="sl-card" style={{ gap: 6 }}>
      <div className="sl-card-head" style={{ marginBottom: 6 }}>
        <h2 className="h2">{t("Stages")}</h2>
        {f.inBed != null ? <span className="muted" style={{ fontSize: 13 }}>{t("{time} in bed", { time: hm(f.inBed) })}</span> : null}
      </div>
      <div className="scroll-x">
        <div role="table" aria-label={t("Stages")} style={{ minWidth: 640 }}>
          <div role="row" className="thead" style={{ gridTemplateColumns: STAGE_COLS, gap: 16, padding: "0 0 8px" }}>
            <span role="columnheader">{t("Stage")}</span><span role="columnheader" style={{ textAlign: "right" }}>{tx("duration", "Time")}</span>
            <span role="columnheader" style={{ textAlign: "right" }}>{tx("proportion", "Share")}</span><span role="columnheader">{t("Share of sleep, typical range shaded")}</span>
            <span role="columnheader">{t("Against typical")}</span>
          </div>
          {(["deep", "light", "rem"] as const).map((s) => {
            const share = stageShare(f, s);
            const you = usual(nights, index, (x) => stageShare(nightFacts(x), s));
            const [lo, hi] = TYPICAL_SHARE[s];
            const inRange = share != null && share >= lo && share <= hi;
            const d = share != null && you != null ? Math.round(share - you) : null;
            return (
              <div key={s} role="row" style={{ display: "grid", gridTemplateColumns: STAGE_COLS, gap: 16, alignItems: "center", minHeight: 58, borderBottom: "1px solid var(--line-soft)" }}>
                <span role="cell" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: STAGE_VAR[s] }} />{t(STAGE_LABEL[s])}</span>
                  {d != null ? <span style={{ fontSize: 12, color: "var(--dim)" }}>{t("{n}% vs you", { n: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}` })}</span> : null}
                </span>
                <span role="cell" style={{ textAlign: "right", fontWeight: 700 }}>{f[s] != null ? hm(f[s]!) : "–"}</span>
                <span role="cell" className="muted" style={{ textAlign: "right" }}>{share != null ? `${Math.round(share)}%` : "–"}</span>
                <span role="cell" aria-hidden="true" className="sl-bar">
                  <span className="sl-bar-band" style={{ left: `${(lo / 70) * 100}%`, width: `${((hi - lo) / 70) * 100}%` }} />
                  {share != null ? <span className="sl-bar-fill cl-bar" style={{ width: `${Math.min(100, (share / 70) * 100)}%`, background: STAGE_VAR[s] }} /> : null}
                </span>
                <span role="cell" style={{ fontSize: 13, fontWeight: 600, color: share == null ? "var(--dim)" : inRange ? "var(--h-mint-ink)" : "var(--h-gold-ink)" }}>
                  {share == null ? "–" : inRange ? t("In the typical range") : share < lo ? t("Below typical") : t("Above typical")}
                </span>
              </div>
            );
          })}
          <div role="row" style={{ display: "grid", gridTemplateColumns: STAGE_COLS, gap: 16, alignItems: "center", minHeight: 52 }}>
            <span role="cell" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: STAGE_VAR.awake }} />{t("Awake")}</span>
            <span role="cell" style={{ textAlign: "right", fontWeight: 700 }}>{f.awake != null ? hm(f.awake) : "–"}</span>
            <span role="cell" />
            <span role="cell" className="muted" style={{ fontSize: 13 }}>{f.wakings != null ? (f.wakings === 1 ? t("1 waking over 3 minutes · longest {time}", { time: hm(f.longestAwake ?? 0) }) : t("{n} wakings over 3 minutes · longest {time}", { n: f.wakings, time: hm(f.longestAwake ?? 0) })) : ""}</span>
            <span role="cell" />
          </div>
        </div>
      </div>
      <p className="sl-note">{t("Typical shares are commonly cited adult ranges, not COROS’s figures: deep 13–23%, light 45–60%, REM 20–25%.")}</p>
    </Card>
  );
}

function TonightCard({ plan }: { plan: NonNullable<ReturnType<typeof tonightPlan>> }) {
  return (
    <Card aria-label={t("Tonight")} className="sl-card" style={{ gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" className="sl-badge" style={{ background: "rgba(165,148,255,0.16)", color: "var(--h-violet-ink)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
        </span>
        <h2 className="h2">{t("Tonight")}</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t("In bed by")}</span>
        <CountUp className="num" style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }} text={clockOfDay(plan.bed)} />
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{t("For {time} asleep before you wake at {wake}.", { time: hm(plan.asleep), wake: clockOfDay(plan.wake) })}</p>
      <TonightChips plan={plan} />
      <p className="sl-note">{tonightSource(plan)}</p>
    </Card>
  );
}

function OvernightCard({ nights, index }: { nights: SleepRecord[]; index: number }) {
  const from = Math.max(0, index - 13);
  const window = nights.slice(from, index + 1);
  const rows: { name: string; color: string; unit: string; read: (n: SleepRecord) => number | null; note: (a: number[], v: number) => string }[] = [
    { name: t("Sleep HRV"), color: "var(--h-cyan)", unit: " ms", read: (n) => n.hrv, note: (a, v) => {
      const base = Math.round(a.slice(0, -1).reduce((p, x) => p + x, 0) / Math.max(1, a.length - 1));
      return `${t("Baseline {n} ms", { n: base })} · ${Math.abs(v - base) <= 6 ? t("Balanced") : v > base ? t("Above baseline") : t("Below baseline")}`;
    } },
    { name: t("Resting heart rate"), color: "var(--h-rose)", unit: " bpm", read: (n) => n.restingHR, note: (a) => t("14-night average {n} bpm", { n: Math.round(a.reduce((p, x) => p + x, 0) / a.length) }) },
    { name: t("Heart rate asleep"), color: "var(--h-violet)", unit: " bpm", read: (n) => n.heartRateAsleep, note: (a) => t("Lowest {low}, highest {high}", { low: Math.min(...a), high: Math.max(...a) }) },
  ];
  const last = nights[index];
  return (
    <Card aria-label={t("Overnight")} className="sl-card" style={{ gap: 4 }}>
      <div className="sl-card-head" style={{ marginBottom: 6 }}>
        <h2 className="h2">{t("Overnight")}</h2>
        <span className="muted" style={{ fontSize: 12 }}>{t("14 nights to {day}", { day: dayMonth(parseDay(last.day)) })}</span>
      </div>
      {rows.map((r) => {
        const v = r.read(last);
        const a = window.map(r.read).filter((x): x is number => x != null);
        const lo = Math.min(...a), hi = Math.max(...a), rg = hi - lo || 1;
        const pts = window.map((n, k) => {
          const x = r.read(n);
          return x == null ? null : [(k / Math.max(1, window.length - 1)) * 96, 26 - ((x - lo) / rg) * 22] as const;
        });
        let d = "", pen = false;
        for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`; pen = true; }
        const end = pts[pts.length - 1];
        return (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px 74px", gap: 12, alignItems: "center", minHeight: 60, borderTop: "1px solid var(--line-soft)" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{v != null && a.length ? r.note(a, v) : t("No reading this night")}</span>
            </span>
            <svg aria-hidden="true" className="spark" width="96" height="30" viewBox="0 0 96 30" style={{ overflow: "visible" }}>
              <path d={d} fill="none" style={{ stroke: r.color, strokeWidth: 1.8, strokeLinejoin: "round", strokeLinecap: "round" }} />
              {end ? <circle cx={end[0]} cy={end[1]} r="3.2" style={{ fill: r.color }} /> : null}
            </svg>
            <span className="num" style={{ textAlign: "right", fontSize: 18, fontWeight: 800 }}>{v != null ? `${v}${r.unit}` : "–"}</span>
          </div>
        );
      })}
    </Card>
  );
}

function NapsCard({ n }: { n: SleepRecord }) {
  return (
    <Card aria-label={t("Naps")} className="sl-card" style={{ gap: 10 }}>
      <div className="sl-card-head"><h2 className="h2">{t("Naps")}</h2><span className="muted" style={{ fontSize: 12 }}>{nightTitle(n)}</span></div>
      {n.naps.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("No naps this day.")}</p> : n.naps.map((p, k) => (
        <div key={k} className="sl-inset" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 700 }}>{t("{from} to {to}", { from: clockOfDay(p.startMinute), to: clockOfDay(p.startMinute + p.minutes) })}</span>
            <span className="muted" style={{ fontSize: 12 }}>{t("{time} asleep", { time: hm(p.minutes) })}</span>
          </span>
          {p.points != null ? <span className="num" style={{ fontSize: 18, fontWeight: 800, color: "var(--sl-nap)" }}>+{p.points}</span> : null}
        </div>
      ))}
      {n.naps.some((p) => p.points != null) ? <p className="sl-note">{t("Naps add up to 5 points to the day’s score.")}</p> : null}
    </Card>
  );
}

/** Coach under the night: the mascot, and questions picked from what stands out; each opens Coach with it filled in. */
function CoachRow({ questions }: { questions: ReturnType<typeof coachQuestions> }) {
  return (
    <div className="sl-coach">
      <span className="sl-coach-who">
        <Image src="/img/coach-head.webp" alt="" width={34} height={34} />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: 14 }}>{t("Ask Coach")}</strong>
          <span style={{ fontSize: 12, color: "var(--sky-text)" }}>{t("about this night")}</span>
        </span>
      </span>
      <div className="sl-coach-asks">
        {questions.map((q) => (
          <Link key={q.label} href={`/coach?ask=${encodeURIComponent(q.ask)}`} className="sl-coach-ask">{t(q.label)}</Link>
        ))}
      </div>
    </div>
  );
}
