"use client";
import { useState, type KeyboardEvent } from "react";
import { Button, LinkButton, Segmented } from "@/components/ui";
import { useNotWired } from "@/components/shell/useNotWired";
import { PetalDial } from "@/components/viz/PetalDial";
import { PetalRow } from "@/components/viz/PetalFan";
import { logCoachMeal, undoCoachMeal, type CompareCard, type DebriefCard, type FuelCard, type PlanCheckCard, type PlanDayState, type RecapCard, type TodayCard, type TrendCard } from "@/data/coach";
import { addDays, dayMonth, shortDay } from "@/lib/calendar";
import { extent, indexAt, linePath } from "@/lib/chart";
import { averageText, lastValues, paceBars, rangeNote, shareOf } from "@/lib/coach";
import { clock, pace, thousands } from "@/lib/format";
import { ARROW, CardShell, CROSS, hueVar, Icon, ICONS, inkVar, OUT, Outcome, Stat, TICK, tint } from "./CardShell";
import { useThread } from "./thread";

/** Arrow keys walk a chart's readout the way the pointer does. */
function stepKey(e: KeyboardEvent, index: number, count: number, set: (i: number) => void) {
  const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
  if (!step) return;
  e.preventDefault();
  set(Math.max(0, Math.min(count - 1, index + step)));
}

const Open = ({ href, children }: { href: string; children: string }) => (
  <LinkButton href={href} className="co-sm">{children}<Icon d={OUT} size={14} width={2.2} /></LinkButton>
);

/* ───────────── Activity recap ───────────── */

export function Recap({ card }: { card: RecapCard }) {
  const n = card.heartRate.length, km = card.splits.length;
  const [picked, setPicked] = useState(Math.round((n - 1) * 0.56));
  const i = Math.min(picked, n - 1);
  const [hrMin, hrMax] = extent(card.heartRate);
  const lo = hrMin - 14, hi = hrMax + 6;
  const slot = 640 / km, secs = card.splits.map((s) => s.seconds);
  const blocks = card.splits.map((s, k) => (s.block ? k : -1)).filter((k) => k >= 0);
  const bars = (want: boolean) => paceBars(secs, secs, 110, slot, slot - 18, 9, 5, (k) => !!card.splits[k].block === want);
  return (
    <CardShell id={card.id} hue="mint" icon={ICONS.run} eyebrow={card.eyebrow} title={card.title} read={card.read}
      actions={<Open href={`/activities/${encodeURIComponent(card.activityId)}`}>Open activity</Open>}>
      <div className="cc-body">
        <div className="cc-split">
          <div className="cc-route">
            <svg role="img" aria-label={card.routeLabel} className="no-wipe" width="150" height="96" viewBox="60 60 660 340" preserveAspectRatio="xMidYMid slice">
              <path d="M-20 330C100 270 190 350 310 290S520 130 780 180" fill="none" style={{ stroke: "rgba(92,207,230,0.22)", strokeWidth: 44, strokeLinecap: "round" }} />
              <path d="M0 90h760M0 210h760M0 360h760M150 0v420M400 0v420M640 0v420" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", strokeWidth: 3 }} />
              <path d={card.routePath} fill="none" style={{ stroke: "var(--h-mint)", strokeWidth: 13, strokeLinejoin: "round", strokeLinecap: "round" }} />
            </svg>
          </div>
          <div className="cc-stats">{card.stats.map((s) => <Stat key={s.label} stat={s} />)}</div>
        </div>
        <div className="cc-chart">
          <div className="cc-legend">
            <span>
              <span><i aria-hidden="true" style={{ background: "var(--h-mint)" }} />Pace per km</span>
              <span><i aria-hidden="true" data-line style={{ background: "var(--h-rose)" }} />Heart rate</span>
            </span>
            <span aria-live="polite">
              <span>km {((i / (n - 1)) * km).toFixed(1)}</span><span>{pace(card.paceSeconds[i])}</span>
              <span style={{ color: "var(--h-rose-ink)" }}>{Math.round(card.heartRate[i])} bpm</span>
            </span>
          </div>
          {/* Each split keeps its time to the hundredth: on a narrow card the chart scrolls sideways rather than squeeze them. */}
          <div className="cc-plotwrap"><div style={{ minWidth: km * 60 }}>
          <div className="cc-plot" style={{ height: 112 }} role="group" tabIndex={0}
            aria-label="Pace and heart rate through the run. Left and right arrows move the reading."
            onMouseMove={(e) => setPicked(indexAt(e.clientX, e.currentTarget.getBoundingClientRect(), n))}
            onKeyDown={(e) => stepKey(e, i, n, setPicked)}>
            {blocks.length ? (
              <span aria-hidden="true" className="cc-band" style={{ left: `${(blocks[0] / km) * 100}%`, width: `${(blocks.length / km) * 100}%`, top: 0, bottom: 0, background: tint("mint"), opacity: 0.55 }} />
            ) : null}
            <svg role="img" aria-label={card.chartLabel} width="100%" height="112" viewBox="0 0 640 110" preserveAspectRatio="none">
              <path d={bars(false)} style={{ fill: "rgba(var(--fg-rgb), 0.18)" }} />
              <path d={bars(true)} style={{ fill: "var(--h-mint)", opacity: 0.85 }} />
              <path d={linePath(card.heartRate, 640, 110, lo, hi)} fill="none" style={{ stroke: "var(--h-rose)", strokeWidth: 2, vectorEffect: "non-scaling-stroke", strokeLinejoin: "round" }} />
            </svg>
            <span aria-hidden="true" className="cc-cursor" style={{ left: `${(i / (n - 1)) * 100}%` }} />
            <span aria-hidden="true" className="cc-dot" style={{ left: `${(i / (n - 1)) * 100}%`, top: `${(1 - shareOf(card.heartRate[i], lo, hi)) * 100}%`, background: "var(--h-rose)" }} />
          </div>
          <div className="cc-kms" style={{ gridTemplateColumns: `repeat(${km}, minmax(0, 1fr))` }}>
            {card.splits.map((s, k) => (
              <span key={k}><span>{k + 1}</span><span style={{ color: s.block ? "var(--h-mint-ink)" : undefined }}>{clock(s.seconds, 2)}</span></span>
            ))}
          </div>
          </div></div>
        </div>
      </div>
    </CardShell>
  );
}

/* ───────────── Comparison ───────────── */

export function Compare({ card }: { card: CompareCard }) {
  const km = card.afterSeconds.length, slot = 640 / km;
  const scale = [...card.beforeSeconds, ...card.afterSeconds];
  return (
    <CardShell id={card.id} hue="blue" icon={ICONS.compare} eyebrow={card.eyebrow} title={card.title} read={card.read}
      actions={<><LinkButton href={card.before.href} className="co-sm">Open {card.before.short}</LinkButton><Open href={card.after.href}>{`Open ${card.after.short}`}</Open></>}>
      <div className="cc-body">
        <div className="scroll-x">
          <div className="cc-table" role="table" aria-label={card.title} style={{ minWidth: 420 }}>
            <div className="cc-tr" data-head role="row">
              <span role="columnheader"><span className="sr-only">Measure</span></span>
              <span role="columnheader">{card.before.label}</span>
              <span role="columnheader" style={{ color: "var(--h-mint-ink)" }}>{card.after.label}</span>
              <span role="columnheader">Change</span>
            </div>
            {card.rows.map((r) => (
              <div key={r.label} className="cc-tr cc-row" role="row">
                <span role="cell" className="muted">{r.label}</span>
                <span role="cell" className="soft">{r.before}</span>
                <span role="cell" style={{ fontWeight: 700 }}>{r.after}</span>
                <span role="cell" style={{ fontWeight: 700, color: r.better ? "var(--h-mint-ink)" : "var(--muted)" }}>{r.change}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cc-chart">
          <div className="cc-legend">
            <span>
              <span><i aria-hidden="true" style={{ background: "rgba(var(--fg-rgb), 0.18)" }} />{card.before.short}</span>
              <span><i aria-hidden="true" style={{ background: "var(--h-mint)" }} />{card.after.short}</span>
              <span>Pace per km, taller is faster</span>
            </span>
          </div>
          <svg role="img" aria-label={card.chartLabel} width="100%" height="90" viewBox="0 0 640 90" preserveAspectRatio="none" style={{ display: "block" }}>
            <path d={paceBars(card.beforeSeconds, scale, 90, slot, 26, 14)} style={{ fill: "rgba(var(--fg-rgb), 0.18)" }} />
            <path d={paceBars(card.afterSeconds, scale, 90, slot, 26, 42)} style={{ fill: "var(--h-mint)" }} />
          </svg>
          <div className="cc-kms" data-plain style={{ gridTemplateColumns: `repeat(${km}, minmax(0, 1fr))` }}>
            {card.afterSeconds.map((_, k) => <span key={k}>km {k + 1}</span>)}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

/* ───────────── Fuel ───────────── */

export function Fuel({ card }: { card: FuelCard }) {
  const { notes, run } = useNotWired();
  const thread = useThread();
  const meal = card.meal;
  const filled = Math.round(shareOf(card.eatenKcal, 0, card.targetKcal) * 36);
  return (
    <CardShell id={card.id} hue="gold" icon={ICONS.fuel} eyebrow={card.eyebrow} title={card.title} read={card.read}
      actions={<Open href="/fuel">Open Fuel</Open>} note={notes.meal}>
      <div className="cc-body">
        <div className="cc-split" style={{ gap: "16px 24px" }}>
          <div style={{ flex: "none", width: 116 }}>
            <PetalDial filled={filled} moved={0} label={`${thousands(card.leftKcal)} kcal left of a ${thousands(card.targetKcal)} kcal target; ${filled} of 36 petals filled`}>
              <span className="num" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{thousands(card.leftKcal)}</span>
              <span className="muted" style={{ fontSize: 10.5 }}>kcal left</span>
            </PetalDial>
          </div>
          <div className="cc-macros">
            <span className="muted" style={{ fontSize: 12 }}>Eaten {thousands(card.eatenKcal)} of {thousands(card.targetKcal)} kcal{card.burnedKcal == null ? "" : ` · burned ${thousands(card.burnedKcal)} so far`}</span>
            {card.macros.map((m) => (
              <div key={m.name}>
                <span style={{ fontWeight: 600, color: inkVar(m.hue) }}>{m.name}</span>
                <PetalRow lit={Math.round(shareOf(m.grams, 0, m.grams + m.leftGrams) * 8)} color={hueVar(m.hue)} />
                <span style={{ whiteSpace: "nowrap" }}><strong>{m.grams} g</strong> <span className="muted">· {m.leftGrams} g left</span></span>
              </div>
            ))}
          </div>
        </div>
        {meal ? (
          <div className="cc-inset cc-meal">
            <div>
              <span style={{ color: "var(--h-honey-ink)" }}>{meal.slot} idea</span>
              <span>{meal.name}</span>
              <span className="muted">{meal.detail}</span>
            </div>
            {meal.logged ? (
              <Outcome kind="done" title={`Logged for ${meal.slot.toLowerCase()}`} detail="In Fuel">
                <Button className="co-sm" onClick={() => run("meal", () => undoCoachMeal(thread.conversationId, card))}>Undo</Button>
              </Outcome>
            ) : (
              <div className="cc-actions">
                <Button className="co-sm" disabled={thread.busy} onClick={() => thread.send("Another meal idea, please.")}>Another idea</Button>
                <Button variant="primary" className="co-sm" onClick={() => run("meal", () => logCoachMeal(thread.conversationId, card))}>Log for {meal.slot.toLowerCase()}</Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

/* ───────────── Trend ───────────── */

const RANGES = [{ value: "7", label: "7 d" }, { value: "30", label: "30 d" }, { value: "90", label: "90 d" }] as const;
type Range = (typeof RANGES)[number]["value"];

export function Trend({ card }: { card: TrendCard }) {
  const [range, setRange] = useState<Range>("30");
  const [picked, setPicked] = useState<number | null>(null);
  const shown = lastValues(card.values, Number(range));
  const n = shown.length, last = n - 1;
  const i = Math.min(picked ?? last, last);
  const firstDay = addDays(card.lastDay, -last);
  const lo = Math.min(card.usual[0], ...shown) - 6, hi = Math.max(card.usual[1], ...shown) + 6;
  const y = (v: number) => `${((1 - shareOf(v, lo, hi)) * 100).toFixed(2)}%`;
  const x = (k: number) => `${(last ? (k / last) * 100 : 0).toFixed(2)}%`;
  const mark = card.markBack != null && card.markBack <= last ? last - card.markBack : null;
  const markDay = mark != null ? addDays(firstDay, mark) : null;
  const latest = card.values[card.values.length - 1];
  const stats = [
    { label: "This morning", value: String(latest), unit: card.unit, hue: "cyan" as const },
    { label: "7-night average", value: averageText(lastValues(card.values, 7)) ?? "—", unit: card.unit },
    { label: "30-night average", value: averageText(lastValues(card.values, 30)) ?? "—", unit: card.unit },
    { label: "Your usual range", value: `${card.usual[0]} to ${card.usual[1]}`, unit: card.unit },
  ];
  const ticks = [0, 1, 2, 3].map((k) => dayMonth(addDays(firstDay, Math.round((last * k) / 3))));
  return (
    <CardShell id={card.id} hue="cyan" icon={ICONS.trend} eyebrow={`${card.eyebrow} · last ${n} nights`} title={card.title} read={card.read}
      head={<Segmented small label="Range" options={RANGES} value={range} onChange={(r) => { setRange(r); setPicked(null); }} />}
      actions={<Open href={card.href}>{card.hrefLabel}</Open>}>
      <div className="cc-body">
        <div className="cc-trend-top">
          <div>{stats.map((s) => <Stat key={s.label} stat={s} />)}</div>
          <span aria-live="polite">
            <span>{shortDay(addDays(firstDay, i))}</span>
            <span style={{ color: "var(--h-cyan-ink)" }}>{shown[i]} {card.unit}</span>
            <span className="muted">{rangeNote(shown[i], card.usual)}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="cc-plot" style={{ flex: 1, minWidth: 0, height: 150 }} role="group" tabIndex={0}
            aria-label={`${card.metric} night by night. Left and right arrows move the reading.`}
            onMouseMove={(e) => setPicked(indexAt(e.clientX, e.currentTarget.getBoundingClientRect(), n))}
            onMouseLeave={() => setPicked(null)}
            onKeyDown={(e) => stepKey(e, i, n, setPicked)}>
            <span aria-hidden="true" className="cc-band" style={{ left: 0, right: 0, top: y(card.usual[1]), height: `${(shareOf(card.usual[1], lo, hi) - shareOf(card.usual[0], lo, hi)) * 100}%`, background: tint("cyan") }} />
            <svg role="img" width="100%" height="150" viewBox="0 0 600 150" preserveAspectRatio="none" style={{ overflow: "visible" }}
              aria-label={`${card.metric} for the last ${n} nights, between ${Math.min(...shown)} and ${Math.max(...shown)} ${card.unit}, against a usual range of ${card.usual[0]} to ${card.usual[1]}`}>
              <path d={linePath(shown, 600, 150, lo, hi)} fill="none" style={{ stroke: "var(--h-cyan)", strokeWidth: 2, vectorEffect: "non-scaling-stroke", strokeLinejoin: "round", strokeLinecap: "round" }} />
            </svg>
            {mark != null && markDay ? (
              <>
                <span aria-hidden="true" className="cc-dot" data-marked style={{ left: x(mark), top: y(shown[mark]), background: "var(--h-coral)" }} />
                <span aria-hidden="true" className="cc-flag" style={{ left: x(mark), top: y(shown[mark]) }}>{shortDay(markDay).split(" ").slice(0, 2).join(" ")} · {shown[mark]} {card.unit}</span>
              </>
            ) : null}
            <span aria-hidden="true" className="cc-dot" style={{ left: x(last), top: y(shown[last]), background: "var(--h-cyan)" }} />
            <span aria-hidden="true" className="cc-cursor" style={{ left: x(i) }} />
            <span aria-hidden="true" className="cc-dot" data-ring style={{ left: x(i), top: y(shown[i]), borderColor: "var(--h-cyan)" }} />
          </div>
          <div aria-hidden="true" className="cc-axis">
            <span style={{ top: y(card.usual[1]) }}>{card.usual[1]}</span>
            <span style={{ top: y(card.usual[0]) }}>{card.usual[0]}</span>
            {mark != null && shown[mark] < card.usual[0] - 4 ? <span style={{ top: y(shown[mark]) }}>{shown[mark]}</span> : null}
          </div>
        </div>
        <div aria-hidden="true" className="cc-ticks">{ticks.map((t, k) => <span key={k}>{t}</span>)}</div>
      </div>
    </CardShell>
  );
}

/* ───────────── How today looks ───────────── */

const DIAL_C = 2 * Math.PI * 19;

export function Today({ card }: { card: TodayCard }) {
  const f = card.form;
  const at = (v: number) => 2 + (1 - shareOf(v, f?.min ?? -1, f?.max ?? 1)) * 36;
  const mark = at(f?.value ?? 0), zero = at(0);
  return (
    <CardShell id={card.id} hue="mint" icon={ICONS.today} eyebrow={card.eyebrow} title={card.title} read={card.read} actions={<Open href="/health">Open Health</Open>}>
      <div className="cc-body">
        <div className="cc-dials">
          {card.dials.map((d) => (
            <div key={d.label} className="cc-inset">
              <svg role="img" aria-label={`${d.label} ${Math.round(d.fraction * 100)} of 100`} className="no-wipe" width="46" height="46" viewBox="0 0 46 46" style={{ flex: "none" }}>
                <circle cx="23" cy="23" r="19" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.08)", strokeWidth: 5 }} />
                <circle className="cl-ring" cx="23" cy="23" r="19" fill="none" transform="rotate(-90 23 23)"
                  style={{ stroke: hueVar(d.hue), strokeWidth: 5, strokeLinecap: "round", strokeDasharray: `${(d.fraction * DIAL_C).toFixed(1)} ${DIAL_C.toFixed(1)}` }} />
              </svg>
              <div>
                <span style={{ color: inkVar(d.hue) }}>{d.label}</span>
                <span><span className="num">{d.value}</span>{d.unit ? <small>{d.unit}</small> : null}</span>
                <span>{d.note}</span>
              </div>
            </div>
          ))}
          {f ? (
          <div className="cc-inset">
            <span role="img" aria-label={`Form ${f.value} on a scale from ${f.min} to plus ${f.max}`} className="cc-form">
              <i />
              <i style={{ top: Math.min(mark, zero) + 3, height: Math.max(4, Math.abs(mark - zero)), background: "color-mix(in srgb, var(--h-blue) 50%, transparent)" }} />
              <i style={{ top: mark, background: "var(--h-blue)" }} />
            </span>
            <div>
              <span style={{ color: "var(--h-blue-ink)" }}>Form</span>
              <span><span className="num">{f.value < 0 ? `−${Math.abs(f.value)}` : `+${f.value}`}</span></span>
              <span>{f.note}</span>
            </div>
          </div>
          ) : null}
        </div>
        <div className="cc-pairs">
          {card.rows.map((r) => (
            <div key={r.label}><span className="muted">{r.label}</span><span>{r.value}{r.note ? <span className="muted"> {r.note}</span> : null}</span></div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

/* ───────────── Plan check ───────────── */

function DayMark({ state, hue }: { state: PlanDayState; hue?: PlanCheckCard["days"][number]["hue"] }) {
  if (state === "rest") return <span className="cc-day" data-state="rest"><i /></span>;
  if (state === "planned") return <span className="cc-day" data-state="rest" style={{ boxShadow: `inset 0 0 0 2px ${hueVar(hue ?? "mint")}` }}><i style={{ background: hueVar(hue ?? "mint") }} /></span>;
  if (state === "skipped") return <span className="cc-day" data-state="skipped"><Icon d={CROSS} size={11} width={3.2} /></span>;
  if (state === "moved-away") return <span className="cc-day" data-state="moved"><Icon d={ARROW} size={11} width={3} /></span>;
  return (
    <span className="cc-day" data-state="done" style={{ background: hueVar(hue ?? "mint") }}>
      <Icon d={state === "moved-here" ? ARROW : TICK} size={13} width={3} />
    </span>
  );
}

export function PlanCheck({ card }: { card: PlanCheckCard }) {
  return (
    <CardShell id={card.id} hue="blue" icon={ICONS.check} eyebrow={card.eyebrow} title={card.title} read={card.read} actions={<Open href="/calendar">Open calendar</Open>}>
      <div className="cc-body">
        <div className="cc-days" role="img" aria-label={card.daysLabel} style={{ gridTemplateColumns: `repeat(${card.days.length}, minmax(0, 1fr))` }}>
          {card.days.map((d) => <span key={d.label}><DayMark state={d.state} hue={d.hue} /><span>{d.label}</span></span>)}
        </div>
        <div className="cc-totals">
          {card.totals.map((t) => (
            <div key={t.label}>
              <span><span>{t.label}</span><span><strong>{t.done}</strong> of {t.planned}</span></span>
              <span className="cc-track"><span className="cl-bar" style={{ width: `${(t.fraction * 100).toFixed(1)}%`, background: hueVar(t.hue) }} /></span>
            </div>
          ))}
        </div>
        {card.misses.length ? (
          <div className="cc-table" style={{ marginTop: -2 }}>
            <div className="cc-th">Not as planned</div>
            {card.misses.map((m) => (
              <div key={m.day} className="cc-miss cc-row">
                <span className="muted">{m.day}</span>
                <span>{m.name}</span>
                <span style={{ color: m.state === "skipped" ? "var(--h-coral-ink)" : "var(--h-orange-ink)" }}><Icon d={m.state === "skipped" ? CROSS : ARROW} size={13} width={2.8} />{m.note}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

/* ───────────── Debrief ───────────── */

export function Debrief({ card }: { card: DebriefCard }) {
  return (
    <CardShell id={card.id} hue="gold" icon={ICONS.page} eyebrow={card.eyebrow} title={card.title} read={card.read}
      actions={<Open href={`/activities/${encodeURIComponent(card.activityId)}`}>Open activity</Open>}>
      <div className="cc-body">
        <dl className="cc-dl">
          <dt>Feel</dt>
          <dd role="img" aria-label={`Feel ${card.feel.score} of ${card.feel.of}`} className="cc-feel">
            {Array.from({ length: card.feel.of }, (_, k) => <i key={k} data-on={k < card.feel.score ? "" : undefined} />)}
            <strong>{card.feel.score} of {card.feel.of}</strong><span className="muted">{card.feel.word}</span>
          </dd>
          <dt>Cues</dt>
          <dd>
            <ul className="cc-cues">
              {card.cues.map((c) => (
                <li key={c.text} data-hit={c.hit ? "" : undefined}>
                  <i aria-hidden="true"><Icon d={c.hit ? TICK : CROSS} size={10} width={3.6} /></i>
                  <span>{c.text}<span className="sr-only">{c.hit ? ", hit" : ", missed"}</span></span>
                </li>
              ))}
            </ul>
          </dd>
          {card.fuel ? <><dt>Fuel</dt><dd>{card.fuel}</dd></> : null}
          {card.said ? <><dt>You said</dt><dd className="soft">“{card.said}”</dd></> : null}
        </dl>
      </div>
    </CardShell>
  );
}
