"use client";
import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import type { Stroke, SwimData } from "@/data/activities";
import { exact, SWIM_REST_S, swimNumbers, swimSets, swimSetText } from "@/lib/activityDetail";
import { indexAt, roundedBars } from "@/lib/chart";
import { clock, thousands } from "@/lib/format";
import { StatGrid, ZoneBar, type Stat } from "./parts";

const STROKE_HUE: Record<Stroke, string> = { Freestyle: "cyan", Breaststroke: "violet", Backstroke: "orange", Butterfly: "rose", Medley: "gold", Drill: "mint" };
const strokeColor = (s: Stroke) => `var(--h-${STROKE_HUE[s]})`;
const per100 = (seconds: number, poolM: number) => `${clock(Math.round((seconds / poolM) * 100))} /100 m`;

/** The swim's own numbers and how the distance split between strokes. */
export function SwimCard({ data, style }: { data: SwimData; style?: React.CSSProperties }) {
  const n = swimNumbers(data);
  const items: Stat[] = [{ label: "Distance", value: `${thousands(n.distanceM)} m`, note: `${n.lengths} lengths` }];
  if (n.paceS != null) items.push({ label: "Pace", value: `${clock(Math.round(n.paceS))} /100 m`, note: "While swimming" });
  if (n.swolf != null) items.push({ label: "SWOLF", value: n.swolf.toFixed(1), note: "Seconds + strokes a length" });
  if (n.strokesPerLength != null) items.push({ label: "Strokes", value: n.strokesPerLength.toFixed(1), note: "Per length" });
  if (n.strokeRate != null) items.push({ label: "Stroke rate", value: `${Math.round(n.strokeRate)} spm` });
  if (n.perStrokeM != null) items.push({ label: "Per stroke", value: `${n.perStrokeM.toFixed(2)} m` });
  if (n.restS > 0) items.push({ label: "Resting", value: clock(Math.round(n.restS)), note: `${clock(Math.round(n.activeS))} swimming` });
  return (
    <Card aria-label="Swim" clip style={style}>
      <div className="ad-head"><h2 className="h2">Swim</h2><span className="ad-sub">{data.poolM} m pool</span></div>
      <StatGrid items={items} fit />
      {n.mix.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 20px 16px", borderTop: "1px solid var(--line)" }}>
          <ZoneBar zones={n.mix.map((m) => ({ name: m.stroke, seconds: m.distanceM, color: strokeColor(m.stroke) }))} />
          <div className="ad-legend">
            {n.mix.map((m) => <span key={m.stroke}><i aria-hidden="true" style={{ background: strokeColor(m.stroke) }} />{m.stroke} {thousands(m.distanceM)} m · {Math.round(m.share * 100)}%</span>)}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function SwimSetsCard({ data, style }: { data: SwimData; style?: React.CSSProperties }) {
  const sets = swimSets(data);
  if (sets.length === 0) return null;
  return (
    <Card aria-label="Sets" clip style={style}>
      <div className="ad-head"><h2 className="h2">Sets</h2><span className="ad-sub">{sets.length} found</span></div>
      {sets.map((set, k) => {
        const text = swimSetText(set);
        return (
          <div key={k} className="ad-item">
            <span><b>{text.title}</b><span className="ad-sub">{text.detail}</span></span>
            <span className="num">{exact(set.seconds)}</span>
          </div>
        );
      })}
    </Card>
  );
}

type Measure = "pace" | "swolf" | "strokes";
const W = 960, H = 180;

/** One bar a length, coloured by stroke, with a dashed rule wherever the swimmer stopped at the wall. */
export function LengthChart({ data }: { data: SwimData }) {
  const [measure, setMeasure] = useState<Measure>("pace");
  const [hover, setHover] = useState<number | null>(null);
  const L = data.lengths, n = L.length;
  const counted = L.some((l) => l.strokes != null);
  const value = (i: number) => (measure === "pace" ? L[i].seconds : measure === "swolf" ? L[i].seconds + (L[i].strokes ?? 0) : L[i].strokes ?? 0);
  const values = L.map((_, i) => value(i));
  const lo = Math.min(...values), hi = Math.max(...values);
  const floor = Math.max(0, lo - (hi - lo || 1) * 0.8);
  const strokes = [...new Set(L.map((l) => l.stroke))];
  const bars = roundedBars(values.map((v) => v - floor), (i) => strokes.indexOf(L[i].stroke), strokes.length, W, H - 6, hi - floor);
  const rests = L.map((l, i) => (l.restAfterS >= SWIM_REST_S && i < n - 1 ? `M${(((i + 1) / n) * W).toFixed(1)} 0V${H}` : "")).join("");
  const fastest = L.reduce((best, l, i) => (l.seconds < L[best].seconds ? i : best), 0);
  const at = hover != null ? L[hover] : null;
  const ticks = [1, Math.round(n / 4), Math.round(n / 2), Math.round((n * 3) / 4), n];
  const word = measure === "pace" ? "Time" : measure === "swolf" ? "SWOLF" : "Strokes";
  return (
    <Card aria-label="Length by length" className="ad-pad" style={{ gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 14px" }}>
          <h2 className="h2">Length by length</h2>
          <span className="ad-note" aria-live="polite">
            {at && hover != null
              ? `Length ${hover + 1} · ${at.stroke} · ${exact(at.seconds)}${at.strokes != null ? ` · ${at.strokes} strokes · SWOLF ${(at.seconds + at.strokes).toFixed(1)}` : ""}`
              : `${n} lengths · fastest ${exact(L[fastest].seconds)} on length ${fastest + 1}`}
          </span>
        </div>
        {counted ? (
          <Segmented small label="Measure" value={measure} options={[{ value: "pace", label: "Pace" }, { value: "swolf", label: "SWOLF" }, { value: "strokes", label: "Strokes" }]} onChange={setMeasure} />
        ) : null}
      </div>
      <svg
        role="img" aria-label={`${word} for each of the ${n} lengths, coloured by stroke, from ${measure === "pace" ? exact(lo) : lo.toFixed(measure === "swolf" ? 1 : 0)} to ${measure === "pace" ? exact(hi) : hi.toFixed(measure === "swolf" ? 1 : 0)}`}
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ touchAction: "pan-y" }}
        onPointerMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect(), n))} onPointerLeave={() => setHover(null)}
      >
        <path d={`M0 ${H / 4}H${W}M0 ${H / 2}H${W}M0 ${(H * 3) / 4}H${W}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", vectorEffect: "non-scaling-stroke" }} />
        {rests ? <path d={rests} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.28)", strokeDasharray: "3 5", vectorEffect: "non-scaling-stroke" }} /> : null}
        <g transform="translate(0 6)">
          {bars.map((d, k) => <path key={strokes[k]} d={d} style={{ fill: strokeColor(strokes[k]) }} />)}
        </g>
        {hover != null ? <rect x={(hover / n) * W} y="0" width={W / n} height={H} style={{ fill: "rgba(var(--fg-rgb), 0.12)" }} /> : null}
      </svg>
      <div className="ad-axis"><span>Length {ticks[0]}</span>{ticks.slice(1).map((t, k) => <span key={k}>{t}</span>)}</div>
    </Card>
  );
}

const SHOWN = 16;

export function LengthsTable({ data, style }: { data: SwimData; style?: React.CSSProperties }) {
  const [all, setAll] = useState(false);
  const L = data.lengths, n = L.length;
  const rows = all ? L : L.slice(0, SHOWN);
  const grid = { gridTemplateColumns: "40px minmax(96px, 1.4fr) repeat(4, minmax(64px, 1fr))" };
  return (
    <Card aria-label="Lengths" className="ad-table" style={style}>
      <div style={{ minWidth: 460 }}>
        <div className="ad-head"><h2 className="h2">Lengths</h2><span className="ad-sub">{all || n <= SHOWN ? `${n} lengths` : `Showing ${SHOWN} of ${n}`}</span></div>
        <div role="table" aria-label="Lengths">
          <div className="ad-th" role="row" style={grid}>
            <span role="columnheader">#</span><span role="columnheader">Stroke</span><span role="columnheader" className="ad-r">Time</span>
            <span role="columnheader" className="ad-r">Strokes</span><span role="columnheader" className="ad-r">SWOLF</span><span role="columnheader" className="ad-r">Pace</span>
          </div>
          {rows.map((l, i) => (
            <div key={i} role="rowgroup">
              <div className="ad-tr" role="row" style={{ ...grid, minHeight: 34 }}>
                <span role="cell" className="ad-dimcell">{i + 1}</span>
                <span role="cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" style={{ fill: strokeColor(l.stroke) }} /></svg>{l.stroke}
                </span>
                <span role="cell" className="ad-r ad-b">{exact(l.seconds)}</span>
                <span role="cell" className="ad-r">{l.strokes ?? "—"}</span>
                <span role="cell" className="ad-r">{l.strokes != null ? (l.seconds + l.strokes).toFixed(1) : "—"}</span>
                <span role="cell" className="ad-r ad-softcell">{per100(l.seconds, data.poolM)}</span>
              </div>
              {l.restAfterS >= 5 && i < n - 1 ? <div className="ad-rest" role="row"><span role="cell">Rest {clock(Math.round(l.restAfterS))}</span></div> : null}
            </div>
          ))}
        </div>
        {n > SHOWN ? <button type="button" className="ad-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? `Show the first ${SHOWN}` : `Show all ${n} rows`}</button> : null}
      </div>
    </Card>
  );
}
