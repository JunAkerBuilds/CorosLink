"use client";
// The middle of a workout card, one picture per sport: exercises and muscles for the gym, a block strip for
// runs, rides and skiing, sets for a swim, stations for HYROX, route blocks for climbing. The data is built in
// `@/lib/coach/sportCard`; nothing here works a number out.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { BodyExtra, BodyGroup, BodyLift, BodyNumber, BodyRow, BodyShare, BodyStepKind, CoachHue, WorkoutBody } from "@/data/coach";
import type { HubSport } from "@/data/hub";
import { hueVar, inkVar, tint } from "./CardShell";

/** The icon in a workout card's header tile, by sport. */
export const SPORT_ICONS: Record<HubSport, string> = {
  run: "M3 12h4l3-8 4 16 3-8h4",
  trailRun: "M3 19l6-11 4 6 2-3 6 8z",
  bike: "M6 18a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM18 18a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM6 14.5l4-7h5l3 7M10 7.5l3 7",
  swim: "M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0",
  strength: "M4 9v6M7 6v12M17 6v12M20 9v6M7 12h10",
  hyrox: "M12 8v5l3 2M9 3h6M12 21a8 8 0 1 0 0-16a8 8 0 0 0 0 16z",
  xcSki: "M4 20l16-6M7 16l4-9 4 6",
  indoorClimb: "M5 21V9l4-6 3 5 3-3 4 6v10M9 14h.01M14 11h.01M13 17h.01",
  bouldering: "M4 19l2-9 6-5 7 4 1 10zM9 13h.01M14 11h.01M12 16h.01",
};

/** A step's colour: work in the card's colour, the easy ends softer, rests in grey. */
function kindStyle(kind: BodyStepKind, hue: CoachHue): CSSProperties {
  if (kind === "work") return { background: hueVar(hue) };
  if (kind === "warmup" || kind === "cooldown") return { background: hueVar(hue), opacity: 0.45 };
  return { background: "rgba(var(--fg-rgb), 0.22)" };
}

const CAP = 6;
/** Step names that only repeat the step's kind: a one-step session leaves them out. */
const PLAIN_NAMES = new Set(["Work", "Swim", "Run", "Warm up", "Cool down", "Rest", "Recovery"]);
const unitWord = (body: WorkoutBody) => (body.count === 1 ? body.unit.slice(0, -1) : body.unit);

function Row({ row, hue, children }: { row: BodyRow; hue: CoachHue; children?: ReactNode }) {
  return (
    <div className="cw-row cc-row" data-kind={row.kind}>
      {row.mark && !children ? <i aria-hidden="true" className="cw-num" style={{ background: tint(hue), color: inkVar(hue) }}>{row.mark}</i> : <i aria-hidden="true" className="cw-dot" style={kindStyle(row.kind, hue)} />}
      <b>{row.name}</b>
      <span className="cw-amt">{row.amount}{children}</span>
      <span className="cw-tgt soft">{row.target}</span>
      <span className="cw-rest muted">{row.rest}</span>
    </div>
  );
}

/** Dots for the routes of a climbing block, twelve at most. */
function Pips({ count, hue }: { count: number; hue: CoachHue }) {
  return <span aria-hidden="true" className="cw-pips">{Array.from({ length: Math.min(12, count) }, (_, i) => <i key={i} style={{ background: hueVar(hue) }} />)}</span>;
}

/** Every step in order, repeats under a "5 ×" line. `limit` cuts the list short until it is opened. */
function StepList({ groups, hue, limit = Infinity, pips }: { groups: readonly BodyGroup[]; hue: CoachHue; limit?: number; pips?: boolean }) {
  // Rows before each group, so a short list can stop part-way through one.
  const before = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.rows.length, 0));
  return (
    <div className="cc-table">
      {groups.map((g, gi) => {
        const rows = g.rows.slice(0, Math.max(0, limit - before[gi]));
        if (!rows.length) return null;
        const lines = rows.map((r, ri) => <Row key={ri} row={r} hue={hue}>{pips && r.mark ? <Pips count={r.mark} hue={hue} /> : null}</Row>);
        return g.repeats > 1
          ? <div key={gi} className="cw-rep"><span style={{ color: inkVar(hue) }}>{g.repeats} ×</span><div>{lines}</div></div>
          : <div key={gi}>{lines}</div>;
      })}
    </div>
  );
}

/** Muscles, zones or strokes as chips, each filled to its share. */
function Shares({ label, shares, hue }: { label?: string; shares: readonly BodyShare[]; hue: CoachHue }) {
  return (
    <div className="cw-shares">
      {label ? <span className="muted">{label}</span> : null}
      <ul>
        {shares.map((s) => (
          <li key={s.name} style={{ background: `linear-gradient(90deg, ${tint(hue, 26)} ${Math.round(s.share * 100)}%, rgba(var(--fg-rgb), 0.05) ${Math.round(s.share * 100)}%)` }}>
            <span>{s.name}</span><b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ open, set, show, hide }: { open: boolean; set: (v: boolean) => void; show: string; hide: string }) {
  return <div className="cc-shape-foot" style={{ justifyContent: "flex-end" }}><button type="button" className="cc-quiet" aria-expanded={open} onClick={() => set(!open)}>{open ? hide : show}</button></div>;
}

/** Runs, rides, skiing: blocks as tall as they are hard and as wide as they are long, repeats drawn together. */
function Strip({ body, hue }: { body: WorkoutBody; hue: CoachHue }) {
  return (
    <div role="img" aria-label={body.label} className="cw-strip">
      {(body.strip ?? []).map((g, gi) => {
        const rows = body.list[gi]?.rows ?? [], lead = rows.find((r) => r.kind === "work") ?? rows[0];
        const drawn = Math.min(g.repeats, 12), weight = g.segs.reduce((t, s) => t + s.weight, 0) * g.repeats;
        return (
          <div key={gi} className="cw-group" data-rep={g.repeats > 1 ? "" : undefined} style={{ flex: `${weight} 1 0` }}>
            <span className="cw-cap"><b>{g.amount}</b><span>{g.target || lead?.name}</span></span>
            <span className="cw-blocks">
              {Array.from({ length: drawn }, (_, k) => g.segs.map((s, si) => <i key={`${k}-${si}`} style={{ flex: `${s.weight} 1 0`, height: `${Math.max(8, Math.round(s.height * 100))}%`, ...kindStyle(s.kind, hue) }} />))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A swim as its sets, one line each, with a bar for the line's metres. */
function SwimSets({ groups, hue, limit }: { groups: readonly BodyGroup[]; hue: CoachHue; limit: number }) {
  return (
    <div className="cc-table">
      {groups.slice(0, limit).map((g, gi) => {
        const swims = g.rows.filter((r) => r.kind !== "rest"), first = g.rows[0];
        const part = (r: BodyRow) => [r.amount, r.kind === "work" ? r.name : ""].filter(Boolean).join(" ");
        const text = swims.length > 1 ? `${g.repeats > 1 ? `${g.repeats} × (` : ""}${swims.map(part).join(" + ")}${g.repeats > 1 ? ")" : ""}` : `${g.repeats > 1 ? `${g.repeats} × ` : ""}${part(first)}`;
        const said = swims.length > 1 ? "" : first.kind === "work" ? first.target : [first.name, first.target].filter(Boolean).join(" · ");
        const rest = g.rows.map((r) => r.rest).filter(Boolean).join(", ");
        return (
          <div key={gi} className="cw-set cc-row">
            <span><b>{text}</b>{said ? <span className="soft">{said}</span> : null}</span><span className="muted">{rest}</span>
            <i aria-hidden="true"><i style={{ width: `${Math.max(2, Math.round((first.bar ?? 0) * 100))}%`, ...kindStyle(first.kind, hue) }} /></i>
          </div>
        );
      })}
    </div>
  );
}

/** HYROX in order: numbered stations, the runs between them as the line that joins them. */
function Rail({ body, hue }: { body: WorkoutBody; hue: CoachHue }) {
  const leg = (r: BodyRow, key: string) =>
    r.mark ? (
      <span key={key} className="cw-station"><i style={{ background: tint(hue, 22), color: inkVar(hue) }}>{r.mark}</i><span><b>{r.name}</b><span>{[r.amount, r.target].filter(Boolean).join(" · ")}</span></span></span>
    ) : (
      <span key={key} className="cw-leg" data-kind={r.kind}><span>{r.name} {r.amount}</span></span>
    );
  return (
    <div role="img" aria-label={body.label} className="cw-rail">
      {body.list.map((g, gi) => g.repeats > 1
        ? <span key={gi} className="cw-round"><em style={{ color: inkVar(hue) }}>{g.repeats} ×</em>{g.rows.map((r, ri) => leg(r, `${gi}-${ri}`))}</span>
        : g.rows.map((r, ri) => leg(r, `${gi}-${ri}`)))}
    </div>
  );
}

/* ───────────── Strength ───────────── */

/** A number and its unit, and the green "+2.5" when today goes up on it. */
function Num({ n, up, className }: { n: BodyNumber; up?: string; className?: string }) {
  return (
    <span className={className ? `cw-n ${className}` : "cw-n"}>
      {n.value ? <b className="num">{n.value}</b> : null}
      {n.unit ? <small>{n.unit}</small> : null}
      {up ? <em>{up}</em> : null}
    </span>
  );
}

function Extras({ label, items, hue }: { label: string; items: readonly BodyExtra[]; hue: CoachHue }) {
  if (!items.length) return null;
  return (
    <div className="cw-block">
      <span className="cw-label">{label}</span>
      {items.map((x, i) => (
        <div key={i} className="cw-extra" style={{ background: tint(hue, 10) }}>
          <i aria-hidden="true" style={{ background: hueVar(hue) }} />
          <span>{x.name}</span>
          <Num n={x.amount} />
        </div>
      ))}
    </div>
  );
}

const liftWords = (l: BodyLift): string => l.kind === "rest"
  ? `Rest ${l.rest}`
  : [l.name, `${l.sets} ${l.sets === 1 ? "set" : "sets"} of ${[l.each.value, l.each.unit].filter(Boolean).join(" ")}`,
    l.load === "bodyweight" ? "bodyweight" : l.load ? `${l.load.value} kg` : "", l.rest ? `${l.rest} rest` : ""].filter(Boolean).join(", ");

/** What a set is, under the "Reps" heading: 6, 45 s, 1:30, to lap button. */
const perSet = (n: BodyNumber): BodyNumber => ({ value: n.value, unit: n.unit === "s hold" ? "s" : n.unit === "reps" || n.unit === "rep" || n.unit === "hold" ? "" : n.unit });

/** Warm-up, then one line per exercise (sets, each set, weight, rest in a block of its own), then cool-down. */
export function StrengthBody({ body, hue }: { body: WorkoutBody; hue: CoachHue }) {
  const lifts = body.lifts ?? [];
  return (
    <div className="cw-strength">
      <Extras label={body.before && body.before.length > 1 ? "Warm-ups" : "Warm-up"} items={body.before ?? []} hue="gold" />
      {lifts.length ? (
        <div className="cw-block">
          <div role="group" aria-label={lifts.map(liftWords).join("; ")} className="cw-lifts">
            <div aria-hidden="true" className="cw-lift cw-lift-head">
              <span className="cw-lift-name">Lifts</span><span>Sets</span><span>Reps</span><span>kg</span><span className="cw-lift-rest">Rest</span>
            </div>
            {lifts.map((l, i) => (
              <div key={i} className="cw-lift" data-kind={l.kind}>
                <span className="cw-lift-name">{l.name}</span>
                {l.kind === "lift" ? (
                  <>
                    <Num n={{ value: String(l.sets), unit: "" }} className="cw-c" />
                    <Num n={perSet(l.each)} up={l.up?.on === "each" ? l.up.by : undefined} className="cw-c cw-x" />
                    {l.load === "bodyweight" ? <span className="cw-bw">Bodyweight</span> : l.load ? <Num n={{ value: l.load.value, unit: "" }} up={l.up?.on === "load" ? l.up.by : undefined} /> : <span />}
                  </>
                ) : <><span /><span /><span /></>}
                <span className="cw-lift-rest">{l.rest ? <b className="num">{l.rest}</b> : null}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Extras label={body.after && body.after.length > 1 ? "Cool-downs" : "Cool-down"} items={body.after ?? []} hue={hue} />
      {body.works?.length ? <span className="cw-works">Works <b>{body.works.join(", ")}</b></span> : null}
    </div>
  );
}

/** The picture and step list for one workout, by its sport. */
export function SportBody({ body, hue }: { body: WorkoutBody; hue: CoachHue }) {
  const [open, setOpen] = useState(false);
  const rows = body.list.reduce((n, g) => n + g.rows.length, 0);
  const shares = body.shares?.length ? <Shares label={body.sharesLabel} shares={body.shares} hue={hue} /> : null;

  if (body.kind === "strength" && body.lifts) return <StrengthBody body={body} hue={hue} />;
  if (body.kind === "simple") {
    const row = body.list[0]?.rows[0];
    if (!row) return null;
    return (
      <div className="cw-simple">
        <span className="num">{row.amount}</span>
        <span><b>{row.target || "No target set"}</b>{row.name && !PLAIN_NAMES.has(row.name) ? <span className="muted">{row.name}</span> : null}</span>
      </div>
    );
  }
  if (body.kind === "intervals" || body.kind === "hyrox") {
    return (
      <div className="cc-chart" style={{ gap: 8 }}>
        {body.kind === "intervals" ? <Strip body={body} hue={hue} /> : <Rail body={body} hue={hue} />}
        {shares}
        <Toggle open={open} set={setOpen} show={`Show ${body.count} ${unitWord(body)}`} hide={`Hide ${body.unit}`} />
        {open ? <StepList groups={body.list} hue={hue} /> : null}
      </div>
    );
  }
  // Strength, swims and climbing are read as lists: the first lines are always there.
  const cut = body.kind === "swim" ? body.list.length > CAP : rows > CAP;
  const limit = open || !cut ? Infinity : CAP;
  return (
    <div className="cc-chart" style={{ gap: 8 }}>
      <div role="group" aria-label={body.label}>
        {body.kind === "swim" ? <SwimSets groups={body.list} hue={hue} limit={limit} /> : <StepList groups={body.list} hue={hue} limit={limit} pips={body.kind === "climb"} />}
      </div>
      {cut ? <Toggle open={open} set={setOpen} show={body.kind === "swim" ? `Show all ${body.list.length} sets` : `Show all ${rows} steps`} hide="Show fewer" /> : null}
      {shares}
    </div>
  );
}
