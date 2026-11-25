"use client";
import { useEffect, useState } from "react";
import { Button, LinkButton, OriginBadge, Segmented, CountUp } from "@/components/ui";
import { TurntableFigure } from "@/components/viz/TurntableFigure";
import { BARS_H, BARS_W, liftCurve, pillBars } from "@/components/strength/charts";
import { useNotWired } from "@/components/shell/useNotWired";
import { useLoaded, type Origin } from "@/data/core";
import { openHevy, useHevy } from "@/data/hevy";
import { loadStrength, strengthAction, type MuscleState, type RangeKey, type Strength, type StrengthAction } from "@/data/strength";
import { clock, thousands } from "@/lib/format";
import "./strength.css";

const STATE_INK: Record<MuscleState, string> = {
  ready: "var(--h-mint-bright-ink)",
  recovering: "var(--h-iris-soft-ink)",
  overdue: "var(--h-honey-soft-ink)",
};
const STATE_NAME: Record<MuscleState, string> = { ready: "Ready", recovering: "Recovering", overdue: "Overdue" };
const STATES: MuscleState[] = ["ready", "recovering", "overdue"];

export default function StrengthPage() {
  // Hevy workouts this browser has read are part of the gym log: the screen reads again when they change.
  const hevy = useHevy();
  useEffect(() => { void openHevy(); }, []);
  const loaded = useLoaded(loadStrength, String(hevy.revision));
  if (loaded.status === "loading") return <main className="page st-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page st-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  return <StrengthScreen data={loaded.data} origin={loaded.origin} />;
}

function StrengthScreen({ data, origin }: { data: Strength; origin: Origin }) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("12w");
  const hevy = useHevy();
  const { notes, run } = useNotWired();
  const act = (place: string, action: StrengthAction) => () => run(place, () => strengthAction(action));

  const count = (s: MuscleState) => data.muscles.filter((m) => m.state === s).length;
  const most = data.muscles.length ? data.muscles.reduce((a, b) => (b.fatigue > a.fatigue ? b : a)) : null;
  const range = data.ranges.find((r) => r.key === rangeKey) ?? data.ranges[0];
  const total = range.totals.reduce((a, b) => a + b, 0);
  const bars = pillBars(range.totals);
  const first = range.totals[0], last = range.totals[range.totals.length - 1];
  const barsLabel = `Weight lifted each ${range.per} for ${range.totals.length} ${range.per}s, ${last > first ? "rising " : ""}from ${first.toFixed(1)} to ${last.toFixed(1)} thousand kg`;

  return (
    <main className="page st-page">
      <div className="st-pair">
        <section aria-label="Suggested workout" className="st-hero">
          {/* eslint-disable @next/next/no-img-element */}
          <img aria-hidden="true" alt="" src="/img/figure-push-light.webp" className="st-hero-fig" data-look="light" data-glow />
          <img aria-hidden="true" alt="" src="/img/figure-push-dark.webp" className="st-hero-fig" data-look="dark" data-glow />
          <img alt={data.suggestion.figureAlt} src="/img/figure-push-light.webp" className="st-hero-fig" data-look="light" />
          <img alt={data.suggestion.figureAlt} src="/img/figure-push-dark.webp" className="st-hero-fig" data-look="dark" />
          {/* eslint-enable @next/next/no-img-element */}
          <OriginBadge origin={origin} className="st-origin" />
          <div className="st-hero-text">
            <span>Suggested next</span>
            <h1>{data.suggestion.title}</h1>
            <p>{data.suggestion.text}</p>
          </div>
          <div className="st-hero-actions">
            <Button variant="ink" className="st-big" onClick={act("hero", "calendar")}>Add to calendar</Button>
            <Button className="st-big-glass" onClick={act("hero", "edit")}>Edit exercises</Button>
            <Button className="st-big-glass" onClick={act("hero", "hevy")}>Send to Hevy</Button>
          </div>
          {notes.hero ? <p className="notice st-hero-note" role="status">{notes.hero}</p> : null}
          <div className="st-counts">
            {STATES.map((s, i) => (
              <span key={s} style={{ display: "contents" }}>
                {i ? <span aria-hidden="true" className="st-hair" /> : null}
                <span className="st-stat"><b className="num" style={{ color: STATE_INK[s] }}><CountUp text={String(count(s))} /></b><span>{STATE_NAME[s]}</span></span>
              </span>
            ))}
          </div>
        </section>

        <section aria-label="Muscles right now" className="st-card st-muscles">
          <div className="st-turn">
            <TurntableFigure
              light="/img/figure-turn-light.webp"
              dark="/img/figure-turn-dark.webp"
              label="The muscle figure coloured by state: mint ready, violet recovering, amber overdue."
            />
            <span>Move across to turn</span>
          </div>
          <div className="st-list">
            <div className="st-list-head">
              <span>Right now</span>
              <h2>{count("ready")} of {data.muscles.length} ready</h2>
              {most ? <span>Most fatigue: {most.name}</span> : null}
            </div>
            <ul className="st-muscle-rows">
              {data.muscles.map((m) => (
                <li key={m.name} className="st-muscle" title={m.note}>
                  <span>{m.name}</span>
                  <span className="st-track" data-state={m.state} aria-hidden="true"><i style={{ width: `${Math.max(m.fatigue, 2)}%` }} /></span>
                  <span className="num">{m.fatigue}%<span className="sr-only"> fatigue, {m.note}</span></span>
                </li>
              ))}
            </ul>
            <div className="st-legend">
              {STATES.map((s) => <span key={s}><i aria-hidden="true" data-state={s} />{STATE_NAME[s]}</span>)}
            </div>
          </div>
        </section>
      </div>

      <h2 className="st-h2">Progress</h2>

      <div className="st-pair">
        <section aria-label="Weight lifted" className="st-card st-lifted">
          <div className="st-lifted-head">
            <span>Weight lifted</span>
            <Segmented
              label="Range" className="st-seg" value={rangeKey} onChange={setRangeKey}
              options={data.ranges.map((r) => ({ value: r.key, label: r.label }))}
            />
          </div>
          <div className="st-total">
            <span className="num"><CountUp text={`${total.toFixed(1)}k`} /> <small>kg</small></span>
            <span>{range.change}</span>
          </div>
          <svg role="img" aria-label={barsLabel} className="st-bars" width="100%" height={BARS_H} viewBox={`0 0 ${BARS_W} ${BARS_H}`} preserveAspectRatio="none">
            {bars.map((d, k) => (
              <path key={k} d={d} data-last={k === bars.length - 1 ? "" : undefined}>
                <title>{`${range.totals[k].toFixed(1)}k kg`}</title>
              </path>
            ))}
          </svg>
          <div className="st-three">
            <div className="st-stat"><b className="num"><CountUp text={thousands(range.workouts)} /></b><span>Workouts</span></div>
            <div className="st-stat"><b className="num"><CountUp text={thousands(range.sets)} /></b><span>Sets</span></div>
            <div className="st-stat"><b className="num"><CountUp text={range.hours.toFixed(1)} /></b><span>Hours</span></div>
          </div>
        </section>

        <section aria-label="Your main lifts" className="st-lifts">
          {data.lifts.map((l) => {
            const c = liftCurve(l.history);
            return (
              <article key={l.name} className="st-card st-lift">
                <h3>{l.name}</h3>
                <span className="num st-lift-best"><CountUp text={String(l.bestKg)} /> <small>kg</small></span>
                <span className="st-lift-note">{l.note}</span>
                <svg aria-hidden="true" height="84" viewBox="0 0 250 84" preserveAspectRatio="none">
                  <path d={c.area} style={{ fill: "rgba(239, 145, 80, 0.2)" }} />
                  <path d={c.line} fill="none" style={{ stroke: "var(--h-ember)", strokeWidth: 2.5, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
                </svg>
              </article>
            );
          })}
        </section>
      </div>

      <section aria-label="Workouts" className="st-card scroll-x">
        <div className="st-table">
          <div className="st-table-head">
            <h2>Workouts</h2>
            <div className="actions">
              <Button onClick={act("table", "routines")}>Routines</Button>
              <Button onClick={act("table", "log")}>Log a past workout</Button>
            </div>
          </div>
          {notes.table ? <p className="notice st-table-note" role="status">{notes.table}</p> : null}
          {hevy.syncProblem ? (
            <p className="notice st-table-note" role="alert">
              <span>Hevy couldn&apos;t be read. {hevy.syncProblem}</span>
              <span className="actions"><LinkButton href="/connect">Connections</LinkButton></span>
            </p>
          ) : hevy.syncing && hevy.workouts === null ? <p className="notice st-table-note" role="status">Reading your Hevy workouts…</p> : null}
          <div role="table" aria-label="Gym workouts">
            <div role="row" className="st-cols st-thead">
              <span role="columnheader">Date</span><span role="columnheader">Workout</span><span role="columnheader">Top sets</span>
              <span role="columnheader" className="st-right">Sets</span><span role="columnheader" className="st-right">Weight lifted</span><span role="columnheader" className="st-right">Time</span>
            </div>
            {data.workouts.map((w) => (
              <div role="row" key={w.id ?? w.date} className="st-cols st-row">
                <span role="cell" className="muted">{w.date}</span>
                <span role="cell" className="st-name"><b>{w.name}</b>{w.source === "hevy" ? <span className="st-src">Hevy</span> : null}</span>
                <span role="cell" className="soft st-clip" title={w.top}>{w.top}</span>
                <span role="cell" className="st-right">{w.sets}</span>
                <span role="cell" className="st-right" style={{ fontWeight: 700 }}>{thousands(w.liftedKg)} kg</span>
                <span role="cell" className="st-right soft">{clock(w.seconds)}</span>
              </div>
            ))}
          </div>
          {data.workouts.length ? null : <p className="notice st-table-note">Nothing from your phone yet</p>}
        </div>
      </section>

      <p className="st-credit">
        Muscle figure adapted from Z-Anatomy and BodyParts3D, CC BY-SA 4.0. <a href="/img/MuscleFigure-LICENSE.txt">Credit and licence</a>
      </p>
    </main>
  );
}
