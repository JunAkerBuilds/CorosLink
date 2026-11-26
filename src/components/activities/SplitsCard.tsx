"use client";
import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import type { Sport } from "@/data/activities";
import { paceUnit } from "@/lib/activities";
import { exact, fastestIndex, groupRows, rowPace, showsGap, totalRow, type SplitRow } from "@/lib/activityDetail";
import { clock, signed, thousands } from "@/lib/format";
import { t } from "@/lib/i18n";

interface Column { key: string; head: string; unit: string; width: number; soft?: boolean; has: (r: SplitRow) => boolean; cell: (r: SplitRow) => string }

const whole = (v: number | null) => (v == null ? "—" : String(Math.round(v)));

function columnsFor(sport: Sport, rows: readonly SplitRow[], gap: boolean): Column[] {
  const run = paceUnit(sport) === "min/km", ride = sport === "Ride";
  const all: Column[] = [
    { key: "gap", head: "GAP", unit: "/km", width: 64, soft: true, has: () => gap, cell: (r) => (r.gapS == null ? "—" : clock(Math.round(r.gapS))) },
    { key: "bar", head: "", unit: "", width: 0, has: () => true, cell: () => "" },
    { key: "hr", head: t("Avg HR"), unit: "bpm", width: 68, has: (r) => r.avgHr != null, cell: (r) => whole(r.avgHr) },
    { key: "max", head: t("Max HR"), unit: "bpm", width: 68, soft: true, has: (r) => r.maxHr != null, cell: (r) => whole(r.maxHr) },
    { key: "cad", head: t("Cadence"), unit: ride ? "rpm" : "spm", width: 68, has: (r) => r.cadence != null, cell: (r) => whole(r.cadence) },
    { key: "stride", head: t("Stride"), unit: "m", width: 68, has: (r) => run && r.strideM != null, cell: (r) => (r.strideM == null ? "—" : r.strideM.toFixed(2)) },
    { key: "gct", head: "GCT", unit: "ms", width: 68, has: (r) => r.groundContactMs != null, cell: (r) => whole(r.groundContactMs) },
    { key: "vo", head: t("Vert. osc."), unit: "cm", width: 78, has: (r) => r.verticalOscCm != null, cell: (r) => (r.verticalOscCm == null ? "—" : r.verticalOscCm.toFixed(1)) },
    { key: "pw", head: t("Power"), unit: "W", width: 68, has: (r) => r.powerW != null, cell: (r) => whole(r.powerW) },
    { key: "maxpw", head: t("Max power"), unit: "W", width: 84, soft: true, has: (r) => ride && r.maxPowerW != null, cell: (r) => whole(r.maxPowerW) },
    { key: "asc", head: t("Ascent"), unit: "m", width: 68, soft: true, has: (r) => r.ascentM != null, cell: (r) => (r.ascentM == null ? "—" : signed(Math.round(r.ascentM))) },
    { key: "desc", head: t("Descent"), unit: "m", width: 68, soft: true, has: (r) => r.descentM != null, cell: (r) => (r.descentM == null ? "—" : signed(-Math.round(r.descentM))) },
  ];
  return all.filter((c) => rows.some(c.has));
}

export type SplitChoice = { fromM: number; toM: number } | null;

/**
 * Splits (the recording cut every kilometre, or longer) and the watch's own laps in one table. Columns appear
 * only when some row has the value; on a narrow screen the table scrolls inside its card.
 */
export function SplitsCard({ sport, base, lengths, startLength, laps, total, hue, elapsedS, movingS, zoneColor, currentM, chosen, onChoose }: {
  sport: Sport;
  /** One-kilometre rows. */
  base: readonly SplitRow[];
  /** Split lengths on offer, in km. */
  lengths: readonly number[];
  startLength: number;
  /** The watch's own laps, when they are more than its automatic splits. */
  laps: readonly SplitRow[] | null;
  /** Whole-activity figures that override the sum of the rows where the watch gave them. */
  total: Partial<SplitRow>;
  hue: string;
  elapsedS?: number;
  movingS: number;
  /** Bar colour by pace, when pace zones are known. */
  zoneColor?: (row: SplitRow) => string;
  /** Metres at the charts' marker, to mark the row it is in. */
  currentM: number | null;
  chosen: SplitChoice;
  onChoose: (c: SplitChoice) => void;
}) {
  const [km, setKm] = useState(startLength);
  const [mode, setMode] = useState<"splits" | "laps">(base.length > 0 ? "splits" : "laps");
  const lapMode = mode === "laps" && laps != null;
  const rows = lapMode ? laps : km === 1 ? base : groupRows(base, km, 1000);
  if (rows.length === 0) return null;
  const swim = sport === "Swim", speed = paceUnit(sport) === "km/h", timed = paceUnit(sport) == null;
  const gap = !lapMode && showsGap(rows);
  const columns = columnsFor(sport, rows, gap);
  const sumRow = { ...totalRow(rows, "Total"), ...total };
  const fastest = fastestIndex(rows);
  const speeds = rows.map((r) => (r.durationS > 0 ? r.distanceM / r.durationS : 0));
  const lo = Math.min(...speeds.filter((v) => v > 0)), hi = Math.max(...speeds);
  const bar = (v: number) => (hi === lo || !(v > 0) ? 66 : Math.round(30 + (66 * (v - lo)) / (hi - lo)));
  const first = lapMode ? (swim ? 64 : 84) : 52;
  const template = `${first}px ${lapMode ? "72px " : ""}84px ${timed ? "" : speed ? "72px " : "64px "}${columns.map((c) => (c.key === "bar" ? "minmax(110px, 1fr)" : `${c.width}px`)).join(" ")}`;
  const minWidth = 40 + first + (lapMode ? 80 : 0) + 92 + (timed ? 0 : 76) + columns.reduce((s, c) => s + (c.key === "bar" ? 118 : c.width + 8), 0);
  const grid = { gridTemplateColumns: template };
  const dist = (r: SplitRow) => (swim ? `${thousands(r.distanceM)} m` : `${(r.distanceM / 1000).toFixed(2)}`);
  const stopped = elapsedS != null ? elapsedS - movingS : 0;
  const unit = speed ? "km/h" : swim ? "/100 m" : "/km";

  return (
    <Card aria-label={lapMode ? t("Laps") : t("Splits")} className="ad-table">
      <div style={{ minWidth }}>
        <div className="ad-table-head">
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <h2 className="h2">{lapMode ? t("Laps") : t("Splits")}</h2>
            {fastest >= 0 && !timed ? <span className="ad-note">{t("Fastest {pace} {unit}", { pace: rowPace(sport, rows[fastest]), unit })}</span> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            {laps && base.length > 0 ? (
              <Segmented small label={t("Rows")} value={mode} options={[{ value: "splits", label: t("Splits") }, { value: "laps", label: t("Laps") }]} onChange={(m) => { setMode(m); onChoose(null); }} />
            ) : null}
            {!lapMode && lengths.length > 1 ? (
              <Segmented small label={t("Split length")} value={String(km)} options={lengths.map((l) => ({ value: String(l), label: `${l} km` }))} onChange={(v) => { setKm(Number(v)); onChoose(null); }} />
            ) : null}
          </div>
        </div>
        <div role="table" aria-label={lapMode ? t("Laps") : t("Splits")}>
          <div className="ad-th" role="row" style={grid}>
            <span role="columnheader">{lapMode ? t("Lap") : "Km"}</span>
            {lapMode ? <span role="columnheader" className="ad-r">{swim ? "M" : "Km"}</span> : null}
            <span role="columnheader" className="ad-r">{t("Time")}</span>
            {timed ? null : <span role="columnheader" className="ad-r">{speed ? t("Speed") : t("Pace")}</span>}
            {columns.map((c) => <span key={c.key} role="columnheader" className="ad-r" aria-hidden={c.key === "bar" || undefined}>{c.head}</span>)}
          </div>
          <div className="ad-tu" aria-hidden="true" style={grid}>
            <span />{lapMode ? <span /> : null}<span />
            {timed ? null : <span className="ad-r">{unit}</span>}
            {columns.map((c) => <span key={c.key} className="ad-r">{c.unit}</span>)}
          </div>
          {rows.map((r, k) => {
            const picked = chosen != null && chosen.fromM === r.fromM && chosen.toM === r.toM;
            const current = currentM != null && r.toM > r.fromM && currentM >= r.fromM && (currentM < r.toM || k === rows.length - 1);
            const can = r.toM > r.fromM;
            const pick = () => onChoose(picked ? null : { fromM: r.fromM, toM: r.toM });
            return (
              <div key={k} className="ad-tr" role="row" style={grid} data-current={current} data-chosen={picked} data-pick={can || undefined} onClick={can ? pick : undefined}>
                <span role="cell" className="ad-dimcell" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {can ? (
                    <button type="button" className="ad-rowbtn" aria-pressed={picked} title={r.name} aria-label={r.name ? (lapMode ? t("Lap {n}, {name}, show on the map", { n: r.label, name: r.name }) : t("Split {n}, {name}, show on the map", { n: r.label, name: r.name })) : lapMode ? t("Lap {n}, show on the map", { n: r.label }) : t("Split {n}, show on the map", { n: r.label })} onClick={(e) => { e.stopPropagation(); pick(); }}>{r.name ?? r.label}</button>
                  ) : (r.name ?? r.label)}
                </span>
                {lapMode ? <span role="cell" className="ad-r">{r.distanceM > 0 ? dist(r) : "—"}</span> : null}
                <span role="cell" className="ad-r ad-b">{exact(r.durationS)}</span>
                {timed ? null : <span role="cell" className="ad-r">{rowPace(sport, r)}</span>}
                {columns.map((c) => c.key === "bar" ? (
                  <span key={c.key} role="cell" className="ad-bar">
                    <svg aria-hidden="true" width="100%" height="10" viewBox="0 0 100 10" preserveAspectRatio="none">
                      <rect x="0" y="0" width={bar(speeds[k])} height="10" rx="2" style={{ fill: zoneColor ? zoneColor(r) : `var(--h-${hue})` }} />
                    </svg>
                    <span>{k === fastest ? t("Fastest") : ""}</span>
                  </span>
                ) : (
                  <span key={c.key} role="cell" className={`ad-r${c.soft ? " ad-softcell" : ""}`}>{c.has(r) ? c.cell(r) : "—"}</span>
                ))}
              </div>
            );
          })}
          <div className="ad-total" role="row" style={grid}>
            <span role="cell">{t("Total")}</span>
            {lapMode ? <span role="cell" className="ad-r">{sumRow.distanceM > 0 ? dist(sumRow) : "—"}</span> : null}
            <span role="cell" className="ad-r">{exact(sumRow.durationS)}</span>
            {timed ? null : <span role="cell" className="ad-r">{rowPace(sport, sumRow)}</span>}
            {columns.map((c) => <span key={c.key} role="cell" className="ad-r">{c.key === "bar" ? "" : c.cell(sumRow)}</span>)}
          </div>
        </div>
        {stopped >= 0.5 ? <div className="ad-note" style={{ padding: "10px 20px 14px" }}>{t("Elapsed time {elapsed}, with {stopped} stopped", { elapsed: clock(Math.round(elapsedS as number)), stopped: clock(Math.round(stopped)) })}</div> : null}
      </div>
    </Card>
  );
}
