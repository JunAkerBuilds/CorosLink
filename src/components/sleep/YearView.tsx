"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Card } from "@/components/ui";
import type { Origin } from "@/data/core";
import type { SleepData, SleepRecord } from "@/data/sleep";
import { dayKey, parseDay } from "@/lib/format";
import { msg, t } from "@/lib/i18n";
import { clockOfDay, dayLabel } from "@/lib/health";
import { hm, monthName, nightFacts, period, quality, stageShare, stressStats, summarise } from "@/lib/sleep";
import { DeltaChip, PAGE_NOTE, SleepHead, scoreInk, scoreVar } from "./common";
import { SummarySky } from "./PeriodView";

const MONTH_COLS = "140px 70px 80px 90px 100px 100px 80px 80px 80px minmax(80px, 1fr)";
const avg = (a: number[]) => (a.length ? a.reduce((p, v) => p + v, 0) / a.length : null);

export function YearView({ data, origin }: { data: SleepData; origin: Origin }) {
  const thisYear = parseDay(data.today).getFullYear();
  const firstYear = data.nights.length ? parseDay(data.nights[0].day).getFullYear() : thisYear;
  const [year, setYear] = useState(thisYear);
  const [cell, setCell] = useState<number | null>(null);
  const byDay = useMemo(() => new Map(data.nights.map((n) => [n.day, n])), [data.nights]);
  const anchor = `${year}-06-01`;
  const days = period("year", anchor, 0).days;
  const nights = days.map((d) => byDay.get(d)).filter((n): n is SleepRecord => n != null);
  const prevNights = period("year", anchor, -1).days.map((d) => byDay.get(d)).filter((n): n is SleepRecord => n != null);
  const s = summarise(nights), prev = prevNights.length ? summarise(prevNights) : null;
  const move = (y: number) => { setYear(y); setCell(null); };

  // Heat map: weeks as columns, Monday on top.
  const lead = (parseDay(days[0]).getDay() + 6) % 7;
  const cols = Math.ceil((days.length + lead) / 7);
  const paths = ["", "", "", "", ""];
  days.forEach((d, i) => {
    const k = i + lead, x = Math.floor(k / 7) * 20, y = (k % 7) * 20;
    const n = byDay.get(d);
    const lvl = n?.score == null ? 0 : n.score >= 85 ? 4 : n.score >= 70 ? 3 : n.score >= 55 ? 2 : 1;
    paths[lvl] += `M${x + 1.5} ${y + 1.5}h17v17h-17z`;
  });
  const VW = cols * 20;
  const ticks = Array.from({ length: 12 }, (_, m) => {
    const i = days.indexOf(dayKey(new Date(year, m, 1))) + lead;
    return { left: ((Math.floor(i / 7) * 20) / VW) * 100, text: monthName(m, true) };
  });
  const cellDay = cell != null ? days[cell] : null;
  const cellNight = cellDay ? byDay.get(cellDay) : undefined;
  const readout = cellDay == null ? t("Point at a day")
    : cellNight ? [
      dayLabel(parseDay(cellDay)),
      cellNight.score != null ? t("score {n}, {quality}", { n: cellNight.score, quality: t(quality(cellNight.score)) }) : t("score {n}", { n: "–" }),
      nightFacts(cellNight).asleep != null ? t("{time} asleep", { time: hm(nightFacts(cellNight).asleep!) }) : "",
      ...(stressStats(cellNight) ? [t("stress {n}", { n: stressStats(cellNight)!.average })] : []),
    ].join("  ·  ")
    : `${dayLabel(parseDay(cellDay))}  ·  ${t("no night")}`;
  const pickCell = (col: number, row: number) => {
    const i = col * 7 + row - lead;
    setCell(i >= 0 && i < days.length ? i : null);
  };
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) pickCell(Math.floor(((e.clientX - r.left) / r.width) * cols), Math.min(6, Math.floor(((e.clientY - r.top) / r.height) * 7)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0;
    if (!step && e.key !== "Escape") return;
    e.preventDefault();
    setCell(e.key === "Escape" ? null : Math.max(0, Math.min(days.length - 1, (cell ?? (step > 0 ? -step : days.length)) + step)));
  };

  const months = Array.from({ length: 12 }, (_, m) => {
    const list = nights.filter((n) => parseDay(n.day).getMonth() === m);
    const pList = prevNights.filter((n) => parseDay(n.day).getMonth() === m);
    const sum = list.length ? summarise(list) : null;
    return {
      m, nights: list.length, sum,
      stress: avg(list.map((n) => stressStats(n)?.average).filter((v): v is number => v != null)),
      prevStress: avg(pList.map((n) => stressStats(n)?.average).filter((v): v is number => v != null)),
      deep: avg(list.map((n) => stageShare(nightFacts(n), "deep")).filter((v): v is number => v != null)),
      rem: avg(list.map((n) => stageShare(nightFacts(n), "rem")).filter((v): v is number => v != null)),
      hrv: avg(list.map((n) => n.hrv).filter((v): v is number => v != null)),
    };
  });
  const sPts = months.map((x) => x.stress), pPts = months.map((x) => x.prevStress);
  const sAll = [...sPts, ...pPts].filter((v): v is number => v != null);
  const smin = sAll.length ? Math.max(0, Math.floor(Math.min(...sAll) - 8)) : 0, smax = sAll.length ? Math.ceil(Math.max(...sAll) + 6) : 40;
  const SY = (v: number) => 150 - ((v - smin) / (smax - smin || 1)) * 150;
  const lineOf = (a: (number | null)[]) => { let d = "", pen = false; a.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${i * 20 + 10} ${SY(v).toFixed(1)}`; pen = true; }); return d; };
  const sA = avg(nights.map((n) => stressStats(n)?.average).filter((v): v is number => v != null));
  const sP = avg(prevNights.map((n) => stressStats(n)?.average).filter((v): v is number => v != null));

  return (
    <>
      <SleepHead tab="year" origin={origin} title={String(year)}
        back={{ label: t("Previous year"), disabled: year <= firstYear, go: () => move(year - 1) }}
        forward={{ label: t("Next year"), disabled: year >= thisYear, go: () => move(year + 1) }}
        latest={{ label: t("This year"), disabled: year === thisYear, go: () => move(thisYear) }} />
      {nights.length === 0 ? <div className="notice">{t("No sleep in {year}.", { year })}</div> : (
        <>
          <SummarySky s={s} prev={prev} prevWord="year" />

          <Card aria-label={t("Every night of the year")} className="sl-card">
            <div className="sl-card-head"><h2 className="h2">{t("Every night")}</h2><span aria-live="polite" style={{ fontSize: 13, fontWeight: 600 }}>{readout}</span></div>
            <div style={{ display: "flex", gap: 10 }}>
              <div aria-hidden="true" className="sl-heat-days"><span>{t("Mon")}</span><span /><span>{t("Wed")}</span><span /><span>{t("Fri")}</span><span /><span>{t("Sun")}</span></div>
              <div className="sl-chart">
                <svg role="img" aria-label={t("Sleep score for every night of {year}, coloured Excellent, Good, Fair or Low", { year })} width="100%" height="140" viewBox={`0 0 ${VW} 140`} preserveAspectRatio="none" style={{ display: "block" }}>
                  <path d={paths[0]} style={{ fill: "rgba(var(--fg-rgb), 0.08)" }} />
                  <path d={paths[1]} style={{ fill: "var(--h-coral)", opacity: 0.8 }} />
                  <path d={paths[2]} style={{ fill: "var(--h-gold)", opacity: 0.85 }} />
                  <path d={paths[3]} style={{ fill: "var(--h-violet)", opacity: 0.55 }} />
                  <path d={paths[4]} style={{ fill: "var(--h-violet)" }} />
                  {cell != null ? <rect x={Math.floor((cell + lead) / 7) * 20} y={((cell + lead) % 7) * 20} width="20" height="20" fill="none" style={{ stroke: "var(--fg)", strokeWidth: 2, vectorEffect: "non-scaling-stroke" }} /> : null}
                </svg>
                <div className="chart-hit" role="slider" tabIndex={0} aria-label={t("Day of the year")} aria-valuemin={0} aria-valuemax={days.length - 1}
                  aria-valuenow={cell ?? 0} aria-valuetext={readout} onPointerMove={point} onPointerDown={point} onPointerLeave={() => setCell(null)} onKeyDown={key} />
                <div aria-hidden="true" style={{ position: "relative", height: 16, marginTop: 6, fontSize: 11, color: "var(--dim)" }}>
                  {ticks.map((tk) => <span key={tk.text} style={{ position: "absolute", left: `${tk.left}%` }}>{t(tk.text)}</span>)}
                </div>
              </div>
            </div>
            <div className="sl-legend">
              <span><span className="sl-key" style={{ background: "var(--h-violet)" }} />{t("Excellent")}</span>
              <span><span className="sl-key" style={{ background: "var(--h-violet)", opacity: 0.55 }} />{t("Good")}</span>
              <span><span className="sl-key" style={{ background: "var(--h-gold)" }} />{t("Fair")}</span>
              <span><span className="sl-key" style={{ background: "var(--h-coral)" }} />{t("Low")}</span>
              <span><span className="sl-key" style={{ background: "rgba(var(--fg-rgb), 0.08)" }} />{t("No night")}</span>
            </div>
          </Card>

          <div className="sl-two">
            <Card aria-label={t("Month by month")} className="sl-card" style={{ flex: "3 1 640px" }}>
              <div className="sl-card-head"><h2 className="h2">{t("Month by month")}</h2><span className="muted" style={{ fontSize: 12 }}>{t("Average asleep from 5 h, average score on top; open a month")}</span></div>
              <div className="sl-months">
                <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `calc(${((420 - 300) / 240) * 100}% * (240 - 26) / 240)`, borderTop: "1px dashed var(--sl-band-line)", pointerEvents: "none" }} />
                {months.map((x) => {
                  const sc = x.sum?.score != null ? Math.round(x.sum.score) : null, asl = x.sum?.asleep ?? null;
                  const at = `${year}-${String(x.m + 1).padStart(2, "0")}-01`;
                  if (!x.nights) return <span key={x.m} aria-label={t("{month}, no nights", { month: t(monthName(x.m)) })} />;
                  return (
                    <Link key={x.m} href={`/health/sleep/month?at=${at}`} aria-label={[t(monthName(x.m)), ...(sc != null ? [t("score {n}", { n: sc })] : []), ...(asl != null ? [t("{time} asleep", { time: hm(asl) })] : [])].join(", ")}>
                      <span className="num" style={{ textAlign: "center", fontSize: 15, fontWeight: 800, color: sc != null ? scoreInk(sc) : "var(--dim)" }}>{sc ?? "–"}</span>
                      <span aria-hidden="true" style={{ height: `${Math.max(2, Math.min(100, (((asl ?? 300) - 300) / 240) * 100))}%`, borderRadius: "10px 10px 4px 4px", background: sc != null ? scoreVar(sc) : "rgba(var(--fg-rgb), 0.1)" }} />
                    </Link>
                  );
                })}
              </div>
              <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 10, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                {months.map((x) => <span key={x.m}>{t(monthName(x.m, true))}</span>)}
              </div>
              <div className="sl-legend"><span><span aria-hidden="true" style={{ width: 14, borderTop: "1.5px dashed var(--sl-band-line)" }} />{t("7 hours")}</span></div>
            </Card>
            <Card aria-label={t("Sleep stress by month")} className="sl-card" style={{ flex: "2 1 420px", minWidth: 0 }}>
              <h2 className="h2">{t("Sleep stress")}</h2>
              {sA == null ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("Nothing from your phone yet")}</p> : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "6px 28px" }}>
                    <span className="sl-fig"><span>{t("Average")}</span><span><span className="num" style={{ fontSize: 26, fontWeight: 800 }}>{Math.round(sA)}</span><span style={{ fontSize: 13, fontWeight: 700, color: "var(--sl-b0)" }}>{sA <= 25 ? t("Rest") : sA <= 50 ? t("Low") : t("Medium")}</span></span></span>
                    <span className="sl-fig"><span>{t("Previous year")}</span><span className="num" style={{ fontSize: 26, fontWeight: 800, color: "var(--dim)" }}>{sP != null ? Math.round(sP) : "–"}</span></span>
                    <span style={{ marginLeft: "auto" }}><DeltaChip good={sP == null || Math.abs(sA - sP) < 1 ? null : sA < sP}>{sP == null ? t("No year before") : Math.abs(sA - sP) < 1 ? t("About the same") : sA < sP ? t("Down on the year before") : t("Up on the year before")}</DeltaChip></span>
                  </div>
                  <svg role="img" aria-label={t("Average sleep stress by month in {year} against the year before", { year })} width="100%" height="150" viewBox="0 0 240 150" preserveAspectRatio="none" style={{ display: "block" }}>
                    <rect x="0" y={Math.max(0, SY(25))} width="240" height={Math.max(0, Math.min(150, 150 - SY(25)))} style={{ fill: "var(--sl-b0)", opacity: 0.1 }} />
                    <path d={lineOf(pPts)} fill="none" style={{ stroke: "var(--dim)", strokeWidth: 1.5, strokeDasharray: "4 4", vectorEffect: "non-scaling-stroke" }} />
                    <path d={lineOf(sPts)} fill="none" style={{ stroke: "var(--h-coral)", strokeWidth: 2.4, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
                    <path d={sPts.map((v, i) => (v == null ? "" : `M${i * 20 + 10} ${SY(v).toFixed(1)}h0.01`)).join("")} fill="none" style={{ stroke: "var(--h-coral)", strokeWidth: 7, strokeLinecap: "round", vectorEffect: "non-scaling-stroke" }} />
                  </svg>
                  <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", textAlign: "center", fontSize: 11, color: "var(--dim)" }}>
                    {months.map((x) => <span key={x.m}>{t(monthName(x.m)).charAt(0)}</span>)}
                  </div>
                  <div className="sl-legend">
                    <span><span aria-hidden="true" style={{ width: 14, borderTop: "2px solid var(--h-coral)" }} />{year}</span>
                    <span><span aria-hidden="true" style={{ width: 14, borderTop: "1.5px dashed var(--dim)" }} />{t("Year before")}</span>
                    <span><span className="sl-key" style={{ background: "var(--sl-b0)", opacity: 0.4 }} />{t("Rest band")}</span>
                  </div>
                </>
              )}
            </Card>
          </div>

          <Card clip aria-label={t("Months")} className="sl-table">
            <div style={{ padding: "18px 20px 12px" }}><h2 className="h2">{t("Months")}</h2></div>
            <div className="scroll-x">
              <div role="table" aria-label={t("Months")} style={{ minWidth: 960 }}>
                <div role="row" className="thead" style={{ gridTemplateColumns: MONTH_COLS, gap: 12 }}>
                  {[msg("Month"), msg("Nights"), msg("Score"), msg("Asleep"), msg("Bedtime"), msg("Wake time"), msg("Deep"), "REM", msg("Stress"), "HRV"].map((h, i) => (
                    <span key={h} role="columnheader" style={{ textAlign: i ? "right" : undefined }}>{t(h)}</span>
                  ))}
                </div>
                {[...months].reverse().filter((x) => x.nights > 0).map((x) => {
                  const sc = x.sum?.score != null ? Math.round(x.sum.score) : null;
                  return (
                    <Link key={x.m} role="row" className="row" href={`/health/sleep/month?at=${year}-${String(x.m + 1).padStart(2, "0")}-01`} style={{ gridTemplateColumns: MONTH_COLS, gap: 12, minHeight: 44 }}>
                      <span role="cell" style={{ fontWeight: 600 }}>{t(monthName(x.m))}</span>
                      <span role="cell" className="muted" style={{ textAlign: "right" }}>{x.nights}</span>
                      <span role="cell" style={{ textAlign: "right", fontWeight: 800, color: sc != null ? scoreInk(sc) : "var(--dim)" }}>{sc ?? "–"}</span>
                      <span role="cell" style={{ textAlign: "right", fontWeight: 600 }}>{x.sum?.asleep != null ? hm(x.sum.asleep) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.sum?.bed != null ? clockOfDay(x.sum.bed) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.sum?.wake != null ? clockOfDay(x.sum.wake) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.deep != null ? `${Math.round(x.deep)}%` : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.rem != null ? `${Math.round(x.rem)}%` : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.stress != null ? Math.round(x.stress) : "–"}</span>
                      <span role="cell" style={{ textAlign: "right" }}>{x.hrv != null ? `${Math.round(x.hrv)} ms` : "–"}</span>
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
