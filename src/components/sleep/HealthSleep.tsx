"use client";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { SleepData, SleepRecord } from "@/data/sleep";
import { parseDay } from "@/lib/format";
import { clockOfDay, dayLabel, dayMonth } from "@/lib/health";
import { STRESS_BANDS, hm, nightFacts, period, stressBand, stressStats, summarise, tonightPlan } from "@/lib/sleep";
import { BAND_VAR, scoreInk, scoreGlow, scoreVar, TonightChips, tonightSource } from "./common";

/** The last 14 nights inside the Health page's night sky; each opens that night on the Sleep page. */
export function HealthSleepStrip({ nights }: { nights: SleepRecord[] }) {
  const shown = nights.slice(-14);
  return (
    <div style={{ flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--sky-text)" }}><span>Last 14 nights</span><span>Score</span></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 6, alignItems: "end", height: 70 }}>
        {shown.map((n, k) => {
          const f = nightFacts(n);
          return (
            <Link key={n.day} href={`/health/sleep?night=${n.day}`} className="sl-mini"
              aria-label={`${dayLabel(parseDay(n.day))}${n.score != null ? `, score ${n.score}` : ""}, open sleep`}>
              <span style={{ textAlign: "center", fontSize: 11, fontWeight: 800, color: n.score != null ? scoreVar(n.score) : "var(--sky-text)" }}>{n.score ?? "–"}</span>
              <span aria-hidden="true" style={{ height: `${Math.min(100, ((f.asleep ?? 0) / 560) * 100)}%`, borderRadius: 5, background: n.score != null ? scoreVar(n.score) : "rgba(255,255,255,0.2)", boxShadow: k === shown.length - 1 && n.score != null ? `0 0 14px 2px ${scoreGlow(n.score)}` : undefined }} />
            </Link>
          );
        })}
      </div>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 6, textAlign: "center", fontSize: 11, color: "var(--sky-text)" }}>
        {shown.map((n) => { const d = parseDay(n.day); return <span key={n.day}>{"SMTWTFS"[d.getDay()]} {d.getDate()}</span>; })}
      </div>
    </div>
  );
}

/** Three cards under the Health page's first row: last night's sleep stress, tonight's bedtime, and this week. */
export function HealthSleepCards({ data }: { data: SleepData }) {
  const last = data.nights[data.nights.length - 1];
  const stress = stressStats(last);
  const f = nightFacts(last);
  const plan = tonightPlan(data.nights, { scheduleWake: data.schedule?.wake, workout: data.tomorrow });
  const byDay = new Map(data.nights.map((n) => [n.day, n]));
  const week = period("week", data.today, 0);
  const weekNights = week.days.map((d) => byDay.get(d)).filter((n): n is SleepRecord => n != null);
  const ws = weekNights.length ? summarise(weekNights) : null;
  const span = Math.max(f.inBed ?? 0, stress ? stress.readings[stress.readings.length - 1].offset + 5 : 1);
  let line = "", pen = false;
  for (const r of stress?.readings ?? []) {
    if (r.stage === "awake") { pen = false; continue; }
    line += `${pen ? "L" : "M"}${((r.offset / span) * 1000).toFixed(1)} ${(100 - r.value).toFixed(1)}`;
    pen = true;
  }
  const level = stress ? stressBand(stress.average) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 22 }}>
      <Link href={`/health/sleep?night=${last.day}`} className="card sl-card sl-link-card" aria-label="Sleep stress last night, open sleep">
        <div className="sl-card-head">
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: "var(--h-coral)" }} />Sleep stress</span>
          <span className="muted" style={{ fontSize: 12 }}>{dayLabel(parseDay(last.day))}</span>
        </div>
        {stress ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="num" style={{ fontSize: 34, fontWeight: 900 }}>{stress.average}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: BAND_VAR[level] }}>{STRESS_BANDS[level]}</span>
              <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>Peak {stress.peak} at {clockOfDay((f.bed ?? 0) + stress.peakOffset)}</span>
            </div>
            <svg aria-hidden="true" className="spark" width="100%" height="70" viewBox="0 0 1000 100" preserveAspectRatio="none">
              <rect x="0" y="75" width="1000" height="25" style={{ fill: "var(--sl-b0)", opacity: 0.1 }} />
              <path d={line} fill="none" style={{ stroke: "var(--h-coral)", strokeWidth: 2.2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
            </svg>
            <span className="muted" style={{ fontSize: 12 }}>Restful for {stress.restful}% of your sleep</span>
          </>
        ) : <span className="muted" style={{ fontSize: 14 }}>Nothing from your phone yet</span>}
      </Link>

      <Card aria-label="Tonight" className="sl-card" style={{ gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: "var(--h-violet)" }} />Tonight</span>
        {plan ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>In bed by</span>
              <span className="num" style={{ fontSize: 34, fontWeight: 900 }}>{clockOfDay(plan.bed)}</span>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>For {hm(plan.asleep)} asleep before you wake at {clockOfDay(plan.wake)}.</p>
            <TonightChips plan={plan} />
            <p className="sl-note" style={{ margin: 0 }}>{tonightSource(plan)}</p>
          </>
        ) : <span className="muted" style={{ fontSize: 14 }}>Needs a few more nights</span>}
      </Card>

      <Link href="/health/sleep/week" className="card sl-card sl-link-card" aria-label="This week's sleep, open the week">
        <div className="sl-card-head">
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}><span aria-hidden="true" className="sl-key" style={{ background: "var(--sl-deep)" }} />This week</span>
          <span className="muted" style={{ fontSize: 12 }}>{dayMonth(parseDay(week.days[0]))} – {dayMonth(parseDay(week.days[6]))}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <span className="sl-fig"><span>Avg score</span><span className="num" style={{ fontSize: 28, fontWeight: 900, color: ws?.score != null ? scoreInk(ws.score) : "var(--dim)" }}>{ws?.score != null ? Math.round(ws.score) : "–"}</span></span>
          <span className="sl-fig"><span>Avg asleep</span><span className="num" style={{ fontSize: 22, fontWeight: 800 }}>{ws?.asleep != null ? hm(ws.asleep) : "–"}</span></span>
          <span className="sl-fig"><span>Sleep debt</span><span className="num" style={{ fontSize: 22, fontWeight: 800, color: "var(--h-gold-ink)" }}>{ws ? (ws.debt ? hm(ws.debt) : "None") : "–"}</span></span>
        </div>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, alignItems: "end", height: 46 }}>
          {week.days.map((d) => {
            const n = byDay.get(d), a = n ? nightFacts(n).asleep : null;
            return <span key={d} style={{ height: a != null ? `${Math.min(100, (a / 560) * 100)}%` : "4px", borderRadius: 4, background: n?.score != null ? scoreVar(n.score) : "rgba(var(--fg-rgb), 0.08)" }} />;
          })}
        </div>
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, textAlign: "center", fontSize: 11, color: "var(--dim)" }}>
          {"MTWTFSS".split("").map((c, i) => <span key={i}>{c}</span>)}
        </div>
      </Link>
    </div>
  );
}
