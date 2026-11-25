"use client";
import Link from "next/link";
import { useState } from "react";
import { Bars, BarsLegend, DISCLAIMER, Figures, Icon, NotYourSport, Ring, SampleBlock, Section, Split, SportHead, Stats, Tiles, TrendLine } from "@/components/sports/parts";
import { CountUp, Segmented } from "@/components/ui";
import { useLoaded, type Origin } from "@/data/core";
import { coachHref, isMissing, loadSports, type Hue, type RunPage } from "@/data/sports";
import type { Family } from "@/lib/sports";
import "../sports.css";

type Chart = "weeks" | "week" | "long";
const KIND_HUE: Record<string, Hue> = { Easy: "run", Long: "ride", Tempo: "gold", Hard: "coral", Unknown: "slate" };

export default function RunningPage() {
  const loaded = useLoaded(loadSports);
  if (loaded.status === "loading") return <main className="page sp-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page sp-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  if (!loaded.data.run) return <NotYourSport name="Running" current="run" families={loaded.data.families} origin={loaded.origin} />;
  return <RunScreen run={loaded.data.run} families={loaded.data.families} origin={loaded.origin} />;
}

function RunScreen({ run, families, origin }: { run: RunPage; families: readonly Family[]; origin: Origin }) {
  const [chart, setChart] = useState<Chart>("weeks");
  const { hero, much, coach, hard, engine, durability, efficiency } = run;
  const options: { value: Chart; label: string }[] = [{ value: "weeks", label: "Weeks" }, { value: "week", label: "This week" }];
  if (much.long) options.push({ value: "long", label: "Long runs" });

  return (
    <main className="page sp-page">
      <SportHead title="Running" current="run" families={families} origin={origin} />

      <section aria-label="Running this week" className="sp-hero" data-hue="run">
        {hero.ring ? (
          <Ring percent={hero.ring.percent} size={196} stroke={20} label={hero.ring.label} className="hero">
            <span className="sp-ring-big"><CountUp text={String(hero.ring.percent)} /><small>%</small></span>
            <span className="sp-small">of your usual week</span>
          </Ring>
        ) : null}
        <div className="sp-hero-text" style={{ flexBasis: 360 }}>
          <span className="sp-pill">{hero.chip}</span>
          <h2>{hero.headline}</h2>
          {hero.text ? <p>{hero.text}</p> : null}
          <Figures items={hero.figures} />
        </div>
        <div className="sp-hero-side">
          <div className="sp-side-head"><b>{hero.chartTitle}</b><BarsLegend chart={hero.chart} /></div>
          <Bars chart={hero.chart} hue="run" width={520} />
        </div>
      </section>

      <Tiles tiles={run.tiles} />

      <div className="sp-row">
        <Section id="much" title="How much" icon="bars" hue="run" how="Against your last 4 weeks" flex="2 1 600px" reading={much}
          ask={["Is a week off a problem?", "How far should my long run be?"]}>
          <Segmented label="Chart" value={chart} onChange={setChart} options={options} className="seg-sm" />
          {chart === "weeks" ? <Bars chart={much.weeks} hue="run" /> : null}
          {chart === "week" ? <Bars chart={much.days} hue="run" height={212} /> : null}
          {chart === "long" && much.long ? (
            <>
              <div className="sp-well sp-limit">
                <div><span className="sp-small">Your next run can go up to</span><b className="num">{much.long.limit}</b></div>
                <div className="sp-stats">
                  <div><b className={`num${much.long.lastOver ? " sp-over" : ""}`}>{much.long.last}</b><span>Last run</span></div>
                  <div><b className="num">{much.long.limit}</b><span>10% limit</span></div>
                  <div><b className="num">{much.long.longest}</b><span>30-day longest</span></div>
                </div>
              </div>
              <Bars chart={much.long.runs} hue="run" height={170} />
            </>
          ) : null}
        </Section>

        <section aria-label="Coach's read" className="sp-card sp-coach" style={{ flex: "1 1 360px" }}>
          <div className="sp-card-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/img/coach-head.webp" width={34} height={34} style={{ flex: "none" }} />
            <h2>Coach&apos;s read</h2>
          </div>
          <h3>{coach.headline}</h3>
          {coach.next ? (
            <div className="sp-well sp-next">
              <span>Your next run</span>
              <b className="num">{coach.next.title}</b>
              {coach.next.chips.length ? <div className="sp-tags">{coach.next.chips.map((c) => <span key={c}>{c}</span>)}</div> : null}
            </div>
          ) : null}
          {coach.facts.length ? <div className="sp-facts">{coach.facts.map((f) => <div key={f.label}><span>{f.label}</span><b>{f.value}</b></div>)}</div> : null}
          <div className="sp-foot" style={{ borderTop: 0, paddingTop: 0 }}>
            <Link className="sp-ask strong" href={coachHref(`How is my running going? ${hero.headline}`)}>Ask Coach</Link>
          </div>
        </section>
      </div>

      <div className="sp-row">
        <Section id="hard" title="How hard" icon="pulse" hue="gold" how="Seiler's three intensity zones" flex="1.25 1 540px" reading={hard}
          ask={["Is my easy running easy enough?", "What should my week of runs look like?"]}>
          {isMissing(hard) ? null : (
            <>
              {hard.split.length ? <Split shares={hard.split} label={hard.split.map((s) => `${s.name} ${s.percent}%`).join(", ")} band /> : null}
              <RunDays weeks={hard.weeks} />
            </>
          )}
        </Section>

        <Section id="engine" title="Your engine" icon="trend" hue="run" how="COROS's figures, as your phone last sent them" flex="1 1 440px" reading={engine}
          ask={["How do I raise my VO₂ max?", "Which race suits me now?"]}>
          {isMissing(engine) ? null : (
            <>
              {engine.trend ? <TrendLine chart={engine.trend} hue="run" /> : null}
              {engine.predictions.length ? (
                <div className="sp-boxes">
                  {engine.predictions.map((p) => (
                    <div key={p.name} data-on={p.focus ? "" : undefined}><span>{p.name}</span><b className="num">{p.time}</b>{p.change ? <em>{p.change}</em> : null}</div>
                  ))}
                </div>
              ) : null}
              {engine.vo2 ? (
                <div className="sp-well" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "0 14px" }}>
                  <span aria-hidden="true" style={{ display: "flex", color: "var(--h-violet-ink)" }}><Icon name="lungs" width={2} /></span>
                  <span className="sp-note">VO₂ max on your runs</span>
                  <b className="num" style={{ marginLeft: "auto", fontSize: 17 }}>{engine.vo2}</b>
                  {engine.vo2Change ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--h-mint-ink)" }}>{engine.vo2Change}</span> : null}
                </div>
              ) : null}
              {engine.marks.length ? <Stats items={engine.marks} /> : null}
              {!engine.trend && engine.sampleTrend ? (
                <SampleBlock title="Over six weeks"><TrendLine chart={engine.sampleTrend.chart} hue="slate" height={120} /><p>{engine.sampleTrend.text}</p></SampleBlock>
              ) : null}
            </>
          )}
        </Section>
      </div>

      {!isMissing(engine) && engine.bests.length ? (
        <section aria-label="Personal bests" className="sp-card">
          <div className="sp-card-head">
            <span aria-hidden="true" className="sp-icon sp-tint" data-hue="gold"><Icon name="medal" /></span>
            <h2>Personal bests</h2><Link href="/activities" className="sp-end">All activities</Link>
          </div>
          <div className="sp-boxes sp-bests">
            {engine.bests.map((b) => (
              <div key={b.name}><span>{b.name}{b.fresh ? <i className="sp-new">New</i> : null}</span><b className="num">{b.value}</b><span>{b.date}</span></div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sp-row">
        <Section title="Long-run durability" icon="heart" hue="rose" how="Friel's under-5% rule of thumb" flex="1 1 440px" reading={durability}>
          {isMissing(durability) ? null : <DriftChart points={durability.points} label={durability.label} />}
        </Section>
        <Section title="Aerobic efficiency" icon="pulse" hue="rose" how="Easy runs only" flex="1 1 440px" reading={efficiency}>
          {isMissing(efficiency) ? null : <TrendLine chart={efficiency.chart} hue="rose" width={620} height={162} />}
        </Section>
      </div>

      <p className="sp-disclaimer">{DISCLAIMER}</p>
    </main>
  );
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Four weeks as rows of seven days, each run a tile in its kind's colour; days still to come are outlined. */
function RunDays({ weeks }: { weeks: { label: string; runs: { kind: string; day: number }[]; today: number | null }[] }) {
  const kinds = ["Easy", "Long", "Tempo", "Hard", "Unknown"].filter((k) => weeks.some((w) => w.runs.some((r) => r.kind === k)));
  return (
    <div className="sp-days">
      <div className="sp-days-head">
        <span>Your runs by week</span>
        <div className="sp-legend">{kinds.map((k) => <span key={k} data-hue={KIND_HUE[k]}><i aria-hidden="true" />{k === "Unknown" ? "No heart rate" : k}</span>)}</div>
      </div>
      <div className="sp-days-row" aria-hidden="true"><span />{DAY_LETTERS.map((d, i) => <b key={i}>{d}</b>)}</div>
      {weeks.map((w) => (
        <div key={w.label} className="sp-days-row" role="img"
          aria-label={`Week of ${w.label}: ${w.runs.length ? w.runs.map((r) => `${DAY_NAMES[r.day]} ${r.kind.toLowerCase()}`).join(", ") : "no runs"}`}>
          <span>{w.label}</span>
          {DAY_LETTERS.map((_, d) => {
            const runs = w.runs.filter((r) => r.day === d);
            return (
              <i key={d} data-later={w.today != null && d > w.today ? "" : undefined} data-today={w.today === d ? "" : undefined}>
                {runs.map((r, k) => <em key={k} data-hue={KIND_HUE[r.kind]}>{runs.length === 1 ? r.kind : r.kind[0]}</em>)}
              </i>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Heart-rate drift on each long run as a dot against the 5% line: mint under it, gold over. */
function DriftChart({ points, label }: { points: { top: string; label: string; percent: number; held: boolean }[]; label: string }) {
  const W = 620, H = 170, plotW = 576, top = 22, base = 142;
  const max = Math.max(8, ...points.map((p) => p.percent + 1.5)), min = Math.min(0, ...points.map((p) => p.percent - 1));
  const y = (v: number) => base - ((v - min) / (max - min)) * (base - top);
  const x = (k: number) => (points.length === 1 ? plotW / 2 : 30 + (k * (plotW - 60)) / (points.length - 1));
  return (
    <svg role="img" aria-label={label} className="sp-chart" viewBox={`0 0 ${W} ${H}`}>
      <rect x="0" y={y(5)} width={plotW} height={base - y(5)} rx="8" style={{ fill: "var(--h-mint)", opacity: 0.1 }} />
      <path className="dash" d={`M0 ${y(5).toFixed(1)}H${plotW}`} />
      <text x={plotW + 8} y={y(5) + 4}>5%</text>
      <path className="grid" d={`M0 ${y(0).toFixed(1)}H${plotW}`} />
      <text x={plotW + 8} y={y(0) + 4}>0%</text>
      <path d={points.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(p.percent).toFixed(1)}`).join(" ")} fill="none" style={{ stroke: "var(--muted)", strokeWidth: 1.5, opacity: 0.5 }} />
      {points.map((p, k) => (
        <g key={k}>
          <circle cx={x(k)} cy={y(p.percent)} r="5.5" style={{ fill: p.held ? "var(--h-mint)" : "var(--h-gold)" }} />
          <text x={x(k)} y={y(p.percent) - 12} textAnchor="middle" style={{ fontWeight: 600 }}>{p.top}</text>
          <text x={x(k)} y={H - 6} textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
