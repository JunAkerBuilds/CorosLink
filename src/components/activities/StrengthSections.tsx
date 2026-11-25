"use client";
import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import { TurntableFigure } from "@/components/viz/TurntableFigure";
import type { StrengthSession } from "@/data/activities";
import {
  exerciseOneRepMax, MUSCLE_LEVELS, muscleLevel, peakAround, restDrop, sessionNumbers, timedSets, topSetIndex, valueAt, type Track,
} from "@/lib/activityDetail";
import { linePath, roundedBars } from "@/lib/chart";
import { clock, thousands } from "@/lib/format";
import { StatGrid, type Stat } from "./parts";

const EX_HUES = ["ember", "blue", "mint", "violet", "rose", "cyan"];
export const exerciseColor = (k: number) => `var(--h-${EX_HUES[k % EX_HUES.length]})`;
const kg = (v: number) => `${Number(v.toFixed(2))} kg`;

/**
 * Which muscles the session worked. The turning figure is only shown when it was drawn for exactly this
 * session; any other session lists its muscles in effective sets instead, so colours never disagree with the sets.
 */
export function MusclesCard({ session }: { session: StrengthSession }) {
  if (session.figure) {
    return (
      <Card aria-label="Muscles worked" className="ad-figure">
        <TurntableFigure light={session.figure.light} dark={session.figure.dark} label={session.figure.label} width={190} height={594} />
        <div className="ad-fig-scale"><span>LIGHT</span><i aria-hidden="true" /><span>HAMMERED</span></div>
        <span className="ad-sub">Counted in effective sets · drag or move across to turn</span>
      </Card>
    );
  }
  if (!session.muscles?.length) return null;
  const top = Math.max(MUSCLE_LEVELS[0].from, ...session.muscles.map((m) => m.sets));
  return (
    <Card aria-label="Muscles worked" className="ad-figure" style={{ alignItems: "stretch" }}>
      <div className="ad-between"><h2 className="h2">Muscles worked</h2><span className="ad-sub">Effective sets</span></div>
      <div className="ad-muscles">
        {session.muscles.map((m) => (
          <div key={m.name} className="ad-muscle">
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}><b style={{ fontWeight: 600 }}>{m.name}</b><small className="ad-sub">{muscleLevel(m.sets)}</small></span>
            <svg aria-hidden="true" width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
              <rect width="100" height="8" rx="4" style={{ fill: "rgba(var(--fg-rgb), 0.08)" }} />
              <rect width={Math.max(2, (m.sets / top) * 100)} height="8" rx="4" style={{ fill: "var(--h-ember)" }} />
            </svg>
            <span className="ad-r ad-b">{Number(m.sets.toFixed(1))}</span>
          </div>
        ))}
      </div>
      <span className="ad-sub">A set counts 1 for the muscles that move it and less for the ones that help.</span>
    </Card>
  );
}

export function SessionCard({ session, load }: { session: StrengthSession; load: number | null }) {
  const n = sessionNumbers(session.exercises);
  const items: Stat[] = [
    { label: "Working sets", value: String(n.sets), note: `${n.exercises} ${n.exercises === 1 ? "exercise" : "exercises"}` },
    { label: "Total reps", value: thousands(n.reps) },
  ];
  if (n.volumeKg > 0) items.push({ label: "Volume", value: `${thousands(n.volumeKg)} kg`, note: "Reps × weight, every set" });
  if (n.workS != null) items.push({ label: "Under load", value: clock(Math.round(n.workS)) });
  if (n.restS != null) items.push({ label: "Resting", value: clock(Math.round(n.restS)) });
  if (n.density != null) items.push({ label: "Density", value: `${Math.round(n.density * 100)}%`, note: "Of the session under load" });
  return (
    <Card aria-label="Session" clip>
      <div className="ad-head"><h2 className="h2">Session</h2>{load != null ? <span className="ad-load">Load {load}</span> : null}</div>
      <StatGrid items={items} cols={3} />
    </Card>
  );
}

const W = 800;

/** Heart rate across the session with each set as a band in its exercise's colour. */
export function TimelineCard({ session, track, hr, range, durationS, label }: {
  session: StrengthSession | null; track: Track; hr: readonly number[]; range: [number, number]; durationS: number; label: string;
}) {
  const H = 150;
  const end = track.time[track.n - 1] || durationS || 1;
  // The line is drawn sample by sample, so a set sits where its seconds fall among the samples.
  const order = track.time.map((_, i) => i);
  const x = (s: number) => (track.n > 1 ? (valueAt(track.time, order, s) / (track.n - 1)) * W : 0);
  const sets = session ? timedSets(session.exercises).filter((s) => s.endS != null) : [];
  const bands = (session?.exercises ?? []).map((_, e) => sets.filter((s) => s.exercise === e).map((s) => {
    const to = x(s.endS as number), from = Math.min(to - 2, x(s.startS ?? (s.endS as number)));
    return `M${from.toFixed(1)} 0H${to.toFixed(1)}V${H}H${from.toFixed(1)}Z`;
  }).join(""));
  const line = linePath(hr, W, H, range[0], range[1]);
  return (
    <Card aria-label="Timeline" className="ad-pad" style={{ gap: 10 }}>
      <div className="ad-between"><h2 className="h2">Timeline</h2><span className="ad-sub">{sets.length ? "Heart rate, with each set as a band" : "Heart rate"}</span></div>
      <svg role="img" aria-label={label} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {bands.map((d, e) => (d ? <path key={e} d={d} style={{ fill: exerciseColor(e), opacity: 0.32 }} /> : null))}
        <path d={line} fill="none" style={{ stroke: "var(--h-rose)", strokeWidth: 2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
      </svg>
      <div className="ad-axis">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{clock(Math.round(end * f))}</span>)}</div>
    </Card>
  );
}

export function VolumeCard({ session }: { session: StrengthSession }) {
  const sets = timedSets(session.exercises);
  const weighted = sets.some((s) => s.volume > 0);
  const [measure, setMeasure] = useState<"volume" | "reps">("volume");
  const m = weighted ? measure : "reps";
  const values = sets.map((s) => (m === "volume" ? s.volume : s.reps));
  const top = Math.max(...values, 1), H = 120, VW = 720;
  const paths = roundedBars(values, (i) => sets[i].exercise, session.exercises.length, VW, H - 4, top);
  const best = values.indexOf(top);
  return (
    <Card aria-label={m === "volume" ? "Volume by set" : "Reps by set"} className="ad-pad" style={{ gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 16px" }}>
        <h2 className="h2">{m === "volume" ? "Volume by set" : "Reps by set"}</h2>
        {weighted ? <Segmented small label="Measure" value={m} options={[{ value: "volume", label: "Volume" }, { value: "reps", label: "Reps" }]} onChange={setMeasure} /> : null}
      </div>
      <svg
        role="img" width="100%" height={H} viewBox={`0 0 ${VW} ${H}`} preserveAspectRatio="none"
        aria-label={`${m === "volume" ? "Volume" : "Reps"} of each of the ${sets.length} sets, coloured by exercise: the largest is ${m === "volume" ? `${thousands(top)} kg` : `${top} reps`}, in ${session.exercises[sets[best]?.exercise ?? 0]?.name ?? "the session"}`}
      >
        <path d={`M0 ${H / 3}H${VW}M0 ${(H * 2) / 3}H${VW}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", vectorEffect: "non-scaling-stroke" }} />
        <g transform="translate(0 4)">{paths.map((d, e) => (d ? <path key={e} d={d} style={{ fill: exerciseColor(e) }} /> : null))}</g>
      </svg>
    </Card>
  );
}

/** Rests are shown only when most of them are known: a couple out of a dozen would read as the whole session's. */
const restsKnown = (sets: readonly { restS: number | null }[]) => sets.length > 1 && sets.filter((s) => s.restS != null).length >= (sets.length - 1) / 2;

/** A card per exercise: every set with its load, and the time, heart rate and rest where they are known. */
export function ExercisesSection({ session, time, hr }: { session: StrengthSession; time: readonly number[] | null; hr: readonly number[] | null }) {
  const sets = timedSets(session.exercises);
  const total = session.exercises.reduce((s, ex) => s + ex.sets.length, 0);
  const starred = session.exercises.some((ex) => topSetIndex(ex.sets) >= 0);
  // Time under load is its own column only beside a load; a timed hold already shows its time as the load.
  const anyTime = session.exercises.some((ex) => ex.sets.some((s) => s.seconds != null && s.reps != null));
  const anyHr = !!(time && hr) && session.exercises.some((ex) => ex.sets.some((s) => s.endS != null));
  const anyRest = restsKnown(sets);
  const columns = `44px minmax(0, 1.4fr)${anyTime ? " minmax(0, 1fr)" : ""}${anyHr ? " minmax(0, 1fr)" : ""}${anyRest ? " minmax(0, 1fr)" : ""}`;
  const grid = { gridTemplateColumns: columns };
  return (
    <section aria-label="Exercises" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ad-between">
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Exercises</h2>
        <span className="ad-note">{total} {total === 1 ? "set" : "sets"}{starred ? " · the star marks each exercise's top set" : ""}</span>
      </div>
      <div className="ad-exercises">
        {session.exercises.map((ex, e) => {
          const orm = exerciseOneRepMax(ex), star = topSetIndex(ex.sets);
          let n = 0;
          return (
            <article key={e} className="card card-clip ad-ex">
              <div className="ad-ex-head">
                <h3><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{ flex: "none" }}><rect width="10" height="10" rx="3" style={{ fill: exerciseColor(e) }} /></svg>{ex.name}</h3>
                {orm != null ? <span>1RM ≈ {kg(orm)}</span> : null}
              </div>
              <div role="table" aria-label={`${ex.name} sets`}>
                <div className="ad-th" role="row" style={{ ...grid, paddingTop: 6, paddingBottom: 6 }}>
                  <span role="columnheader">Set</span><span role="columnheader">Load</span>
                  {anyTime ? <span role="columnheader" className="ad-r">Time</span> : null}
                  {anyHr ? <span role="columnheader" className="ad-r">HR</span> : null}
                  {anyRest ? <span role="columnheader" className="ad-r">Rest</span> : null}
                </div>
                {ex.sets.map((s, k) => {
                  const load = s.weightKg != null && s.reps != null ? `${ex.bodyweight ? "+" : ""}${kg(s.weightKg)} × ${s.reps}`
                    : s.reps != null ? `${s.reps} reps` : s.weightKg != null ? kg(s.weightKg) : s.seconds != null ? clock(Math.round(s.seconds)) : "—";
                  const peak = anyHr && s.endS != null ? peakAround(time as number[], hr as number[], s.endS) : null;
                  const rest = sets.find((t) => t.exercise === e && t.set === k)?.restS ?? null;
                  return (
                    <div key={k} className="ad-tr" role="row" style={grid}>
                      <span role="cell" className="ad-dimcell">{s.warmUp ? "W" : ++n}</span>
                      <span role="cell" className="ad-b">{load}{k === star ? <span className="ad-star" role="img" aria-label="Top set">★</span> : null}</span>
                      {anyTime ? <span role="cell" className="ad-r">{s.seconds != null ? clock(Math.round(s.seconds)) : "—"}</span> : null}
                      {anyHr ? <span role="cell" className="ad-r">{peak != null ? Math.round(peak) : "—"}</span> : null}
                      {anyRest ? <span role="cell" className="ad-r ad-softcell">{rest != null && rest > 0 ? clock(Math.round(rest)) : ""}</span> : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Whether the session's rests are known well enough for the Rest & recovery card. */
export function hasRests(session: StrengthSession): boolean {
  const sets = timedSets(session.exercises);
  return restsKnown(sets) && sets.some((s) => s.restS != null && s.restS > 0 && s.endS != null);
}

/** Average rest between sets and how far heart rate fell in it. Null when neither is known. */
export function RestCard({ session, time, hr, style }: { session: StrengthSession; time: readonly number[] | null; hr: readonly number[] | null; style?: React.CSSProperties }) {
  const sets = timedSets(session.exercises);
  const rests = sets.filter((s) => s.restS != null && s.restS > 0 && s.endS != null);
  if (rests.length === 0 || !restsKnown(sets)) return null;
  const avg = rests.reduce((s, r) => s + (r.restS as number), 0) / rests.length;
  const drops = time && hr ? rests.map((r) => restDrop(time, hr, r.endS as number, (r.endS as number) + (r.restS as number))).filter((v): v is number => v != null) : [];
  const items: Stat[] = [{ label: "Avg", value: clock(Math.round(avg)), note: "Between sets" }];
  if (drops.length) items.push({ label: "HR drop", value: `${Math.round(drops.reduce((s, v) => s + v, 0) / drops.length)} bpm`, note: "Peak to the lowest in each rest" });
  return (
    <Card aria-label="Rest and recovery" clip style={style}>
      <div className="ad-head"><h2 className="h2">Rest &amp; recovery</h2></div>
      <StatGrid items={items} keep />
    </Card>
  );
}
