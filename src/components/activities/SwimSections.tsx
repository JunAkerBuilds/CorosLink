"use client";
import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import type { Stroke, SwimData } from "@/data/activities";
import { exact, SWIM_REST_S, swimNumbers, swimSets, swimSetText } from "@/lib/activityDetail";
import { indexAt, roundedBars } from "@/lib/chart";
import { clock } from "@/lib/format";
import { msg, t } from "@/lib/i18n";
import { imperial, swimDistance, swimIn, swimPaceIn, swimPaceUnitLabel, swimUnit } from "@/lib/units";
import { StatGrid, ZoneBar, type Stat } from "./parts";

const STROKE_HUE: Record<Stroke, string> = { Freestyle: "cyan", Breaststroke: "violet", Backstroke: "orange", Butterfly: "rose", Medley: "gold", Drill: "mint" };
const strokeColor = (s: Stroke) => `var(--h-${STROKE_HUE[s]})`;
const STROKE_WORD: Record<Stroke, string> = {
  Freestyle: msg("Freestyle"), Breaststroke: msg("Breaststroke"), Backstroke: msg("Backstroke"), Butterfly: msg("Butterfly"), Medley: msg("Medley"), Drill: msg("Drill"),
};
/** A stroke's name in the app's language. */
const strokeWord = (s: Stroke) => t(STROKE_WORD[s] ?? s);
const per100 = (seconds: number, poolM: number) => `${clock(Math.round(swimPaceIn((seconds / poolM) * 100)))} ${swimPaceUnitLabel()}`;
/** The pool's length: in yards when it is a yard pool and the page shows yards, else in metres as set. */
const poolLength = (poolM: number) => {
  const yards = swimIn(poolM);
  return imperial() && Math.abs(yards - Math.round(yards)) < 0.05 ? `${Math.round(yards)} ${swimUnit()}` : `${poolM} m`;
};

/** The swim's own numbers and how the distance split between strokes. */
export function SwimCard({ data, style }: { data: SwimData; style?: React.CSSProperties }) {
  const n = swimNumbers(data);
  const items: Stat[] = [{ label: t("Distance"), value: swimDistance(n.distanceM), note: t("{n} lengths", { n: n.lengths }) }];
  if (n.paceS != null) items.push({ label: t("Pace"), value: `${clock(Math.round(swimPaceIn(n.paceS)))} ${swimPaceUnitLabel()}`, note: t("While swimming") });
  if (n.swolf != null) items.push({ label: "SWOLF", value: n.swolf.toFixed(1), note: t("Seconds + strokes a length") });
  if (n.strokesPerLength != null) items.push({ label: t("Strokes"), value: n.strokesPerLength.toFixed(1), note: t("Per length") });
  if (n.strokeRate != null) items.push({ label: t("Stroke rate"), value: `${Math.round(n.strokeRate)} spm` });
  if (n.perStrokeM != null) items.push({ label: t("Per stroke"), value: `${swimIn(n.perStrokeM).toFixed(2)} ${swimUnit()}` });
  if (n.restS > 0) items.push({ label: t("Resting"), value: clock(Math.round(n.restS)), note: t("{time} swimming", { time: clock(Math.round(n.activeS)) }) });
  return (
    <Card aria-label={t("Swim")} clip style={style}>
      <div className="ad-head"><h2 className="h2">{t("Swim")}</h2><span className="ad-sub">{t("{length} pool", { length: poolLength(data.poolM) })}</span></div>
      <StatGrid items={items} fit />
      {n.mix.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 20px 16px", borderTop: "1px solid var(--line)" }}>
          <ZoneBar zones={n.mix.map((m) => ({ name: m.stroke, seconds: m.distanceM, color: strokeColor(m.stroke) }))} />
          <div className="ad-legend">
            {n.mix.map((m) => <span key={m.stroke}><i aria-hidden="true" style={{ background: strokeColor(m.stroke) }} />{strokeWord(m.stroke)} {swimDistance(m.distanceM)} · {Math.round(m.share * 100)}%</span>)}
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
    <Card aria-label={t("Sets")} clip style={style}>
      <div className="ad-head"><h2 className="h2">{t("Sets")}</h2><span className="ad-sub">{t("{n} found", { n: sets.length })}</span></div>
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
  const word = measure === "pace" ? t("Time") : measure === "swolf" ? "SWOLF" : t("Strokes");
  return (
    <Card aria-label={t("Length by length")} className="ad-pad" style={{ gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 14px" }}>
          <h2 className="h2">{t("Length by length")}</h2>
          <span className="ad-note" aria-live="polite">
            {at && hover != null
              ? `${t("Length {n}", { n: hover + 1 })} · ${strokeWord(at.stroke)} · ${exact(at.seconds)}${at.strokes != null ? ` · ${t("{n} strokes", { n: at.strokes })} · SWOLF ${(at.seconds + at.strokes).toFixed(1)}` : ""}`
              : `${t("{n} lengths", { n })} · ${t("fastest {time} on length {k}", { time: exact(L[fastest].seconds), k: fastest + 1 })}`}
          </span>
        </div>
        {counted ? (
          <Segmented small label={t("Measure")} value={measure} options={[{ value: "pace", label: t("Pace") }, { value: "swolf", label: "SWOLF" }, { value: "strokes", label: t("Strokes") }]} onChange={setMeasure} />
        ) : null}
      </div>
      <svg
        role="img" aria-label={t("{what} for each of the {n} lengths, coloured by stroke, from {low} to {high}", { what: word, n, low: measure === "pace" ? exact(lo) : lo.toFixed(measure === "swolf" ? 1 : 0), high: measure === "pace" ? exact(hi) : hi.toFixed(measure === "swolf" ? 1 : 0) })}
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
      <div className="ad-axis"><span>{t("Length {n}", { n: ticks[0] })}</span>{ticks.slice(1).map((tick, k) => <span key={k}>{tick}</span>)}</div>
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
    <Card aria-label={t("Lengths")} className="ad-table" style={style}>
      <div style={{ minWidth: 460 }}>
        <div className="ad-head"><h2 className="h2">{t("Lengths")}</h2><span className="ad-sub">{all || n <= SHOWN ? t("{n} lengths", { n }) : t("Showing {shown} of {n}", { shown: SHOWN, n })}</span></div>
        <div role="table" aria-label={t("Lengths")}>
          <div className="ad-th" role="row" style={grid}>
            <span role="columnheader">#</span><span role="columnheader">{t("Stroke")}</span><span role="columnheader" className="ad-r">{t("Time")}</span>
            <span role="columnheader" className="ad-r">{t("Strokes")}</span><span role="columnheader" className="ad-r">SWOLF</span><span role="columnheader" className="ad-r">{t("Pace")}</span>
          </div>
          {rows.map((l, i) => (
            <div key={i} role="rowgroup">
              <div className="ad-tr" role="row" style={{ ...grid, minHeight: 34 }}>
                <span role="cell" className="ad-dimcell">{i + 1}</span>
                <span role="cell" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" style={{ fill: strokeColor(l.stroke) }} /></svg>{strokeWord(l.stroke)}
                </span>
                <span role="cell" className="ad-r ad-b">{exact(l.seconds)}</span>
                <span role="cell" className="ad-r">{l.strokes ?? "—"}</span>
                <span role="cell" className="ad-r">{l.strokes != null ? (l.seconds + l.strokes).toFixed(1) : "—"}</span>
                <span role="cell" className="ad-r ad-softcell">{per100(l.seconds, data.poolM)}</span>
              </div>
              {l.restAfterS >= 5 && i < n - 1 ? <div className="ad-rest" role="row"><span role="cell">{t("Rest {time}", { time: clock(Math.round(l.restAfterS)) })}</span></div> : null}
            </div>
          ))}
        </div>
        {n > SHOWN ? <button type="button" className="ad-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? t("Show the first {n}", { n: SHOWN }) : t("Show all {n} rows", { n })}</button> : null}
      </div>
    </Card>
  );
}
