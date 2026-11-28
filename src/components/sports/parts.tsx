"use client";
// The shared pieces of the Sports hub and each sport's page (styles in sports.css).
import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { CountUp, OriginBadge } from "@/components/ui";
import type { Origin } from "@/data/core";
import { coachHref, isMissing, type BarChart, type Chip, type Figure, type Hue, type LineChart, type Missing, type Reading, type SplitShare, type Tile } from "@/data/sports";
import { msg, t } from "@/lib/i18n";
import { sportOrderStore, useSportOrder } from "@/data/local/sportOrder";
import { moveKey } from "@/lib/dashboard";
import { savedSportOrder, shownSports, sportTabs, type Family } from "@/lib/sports";

export const SPORT_HUE: Record<Family, Hue> = { run: "run", ride: "ride", swim: "swim", strength: "strength", walk: "gold", hike: "coral", snow: "violet", climb: "rose", other: "slate" };
/** The `Icon` each sport is drawn with. */
export const SPORT_ICON: Record<Family, string> = { run: "run", ride: "ride", swim: "swim", strength: "strength", walk: "walk", hike: "hike", snow: "snow", climb: "climber", other: "pulse" };

const ICONS: Record<string, ReactNode> = {
  run: <><circle cx="14.5" cy="4.5" r="1.8" /><path d="M5 20l4-4.500 1.500-4.500 4-1.500 2.500 3.500 3 .800M10.500 11l-3 .500-1.500 3M12.500 13.500l2.500 3 .500 4.500" /></>,
  ride: <><circle cx="6" cy="16.5" r="3.5" /><circle cx="18" cy="16.5" r="3.5" /><path d="M6 16.500l4-8h5.500l2.500 8M10 8.500l2.500 8M8.500 6h3M14.500 6h2l-1 2.500" /></>,
  swim: <><circle cx="16.5" cy="7" r="1.8" /><path d="M3 12.500l5.500-3.500 3.500 3.500 4-1.500M3 17c1.500 1.200 3 1.200 4.500 0s3-1.200 4.500 0 3 1.200 4.500 0 3-1.200 4.500 0" /></>,
  strength: <path d="M4 9v6M7.500 6.500v11M16.500 6.500v11M20 9v6M7.500 12h9" />,
  walk: <><circle cx="13" cy="4.500" r="1.800" /><path d="M8 21l2.500-6 2-2.500-.500-4-3 2-1 3.500M12.500 8.500l2.500 3 3 1M12.500 12.500l2 3.500.500 5" /></>,
  hike: <><path d="M3 20l6-11 4 6 2.500-4L21 20z" /><path d="M7.500 12.500l1.500 1 1.500-1" /></>,
  snow: <path d="M12 3v18M4.200 7.500l15.600 9M4.200 16.500l15.600-9M9.500 4.500L12 6.500l2.500-2M9.500 19.500L12 17.500l2.500 2" />,
  climber: <><circle cx="15.500" cy="4.500" r="1.800" /><path d="M19 3v18M15 8l-3 4 1.500 4-2 5M12 12l-4-1-2-4M13.500 16l-5 1" /></>,
  bars: <path d="M5 20v-7M10 20V9M15 20V11M20 20V5" />,
  pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  trend: <path d="M3 17l6-6 4 4 8-9M15 6h6v6" />,
  heart: <path d="M12 20s-7-4.500-7-10a4 4 0 0 1 7-2.500a4 4 0 0 1 7 2.500c0 5.500-7 10-7 10z" />,
  medal: <><circle cx="12" cy="15" r="5" /><path d="M9 4l3 6 3-6" /></>,
  climb: <path d="M3 19l6-9 4 5 3-4 5 8z" />,
  lungs: <path d="M12 4v8M12 12c-2 0-3 1-3.500 3l-1 4.500c-2.500.500-3.500-1-3.500-3 0-4 2-8 5-8M12 12c2 0 3 1 3.500 3l1 4.500c2.500.500 3.500-1 3.500-3 0-4-2-8-5-8" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  spark: <path d="M12 4l1.800 4.700 4.700 1.800-4.700 1.800L12 17l-1.800-4.700-4.700-1.800 4.700-1.800z" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.010" /></>,
};

export function Icon({ name, size = 17, width = 2.1 }: { name: string; size?: number; width?: number }) {
  return (
    <svg aria-hidden="true" className="no-wipe" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" }}>
      {ICONS[name]}
    </svg>
  );
}

/* ───────────── Head ───────────── */

/** Breadcrumb and title, where the numbers come from, and the switcher between the person's sports. */
export function SportHead({ title, crumb, current, families, origin }: { title: string; crumb?: string; current: Family | null; families: readonly Family[]; origin: Origin }) {
  return (
    <div className="sp-head">
      <div className="sp-head-text">
        <nav aria-label={t("Breadcrumb")} className="sp-crumb">
          {crumb ? <span>{crumb}</span> : <><Link href="/sports">{t("Sports")}</Link><span aria-hidden="true">/</span><span>{title}</span></>}
          <OriginBadge origin={origin} />
        </nav>
        <h1>{title}</h1>
      </div>
      <SportSwitch families={families} current={current} />
    </div>
  );
}

/** How far the pointer goes before a press on a tab becomes a drag. */
const DRAG_START = 5;
/** How the tabs glide into their places: easing in as well as out, so no frame moves a tab much more than the next. */
const GLIDE = { duration: 260, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };
const stillMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

interface TabDrag { key: Family; id: number; startX: number; grabX: number; x: number; live: boolean; order: Family[] }

/**
 * The switcher between the person's sports. Their sports' tabs can be dragged into another order, or moved with Alt
 * and the arrow keys; the order is saved on this computer and the hub and the Go to palette follow it. The dragged
 * tab stays under the pointer while the others glide out of its way, and on letting go it settles into its place.
 */
function SportSwitch({ families, current }: { families: readonly Family[]; current: Family | null }) {
  const saved = useSportOrder();
  const mine = shownSports(families, saved);
  const [preview, setPreview] = useState<Family[] | null>(null);
  const [lifted, setLifted] = useState<Family | null>(null);
  const [said, setSaid] = useState("");
  const drag = useRef<TabDrag | null>(null);
  const dragged = useRef(false);
  const nav = useRef<HTMLElement>(null);
  const tabs = useRef(new Map<Family, HTMLAnchorElement>());
  /** Where every tab was on screen just before the order changed, to glide each from there. */
  const before = useRef<Map<Family, number> | null>(null);
  const hint = useId();
  const order = preview ?? mine;
  const all = sportTabs(families, current, saved);
  const byFamily = new Map(all.map((s) => [s.family, s]));
  const rows = [all[0], ...order.flatMap((f) => byFamily.get(f) ?? []), ...all.filter((s) => s.family && !order.includes(s.family))];
  const name = (f: Family) => t(byFamily.get(f)?.label ?? "");

  /** A tab's left edge where the layout puts it, leaving out any transform or glide (offsetLeft ignores both). */
  const slotLeft = (el: HTMLElement) => {
    const n = nav.current;
    return n ? n.getBoundingClientRect().left + n.clientLeft + el.offsetLeft : el.getBoundingClientRect().left;
  };
  const snapshot = () => {
    before.current = new Map([...tabs.current].map(([f, el]) => [f, el.getBoundingClientRect().left]));
  };
  /** Keeps the dragged tab under the pointer, held inside the switcher. */
  const follow = (d: TabDrag) => {
    const el = tabs.current.get(d.key), n = nav.current;
    if (!el || !n) return;
    const box = n.getBoundingClientRect(), slot = slotLeft(el);
    const left = Math.min(Math.max(d.x - d.grabX, box.left + 3), box.right - 3 - el.offsetWidth);
    el.style.transform = `translateX(${left - slot}px)`;
  };

  // After the order changes: each tab glides from where it was to its new place, and the dragged one follows on.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    const d = drag.current;
    if (d?.live) follow(d);
    if (!was) return;
    const still = stillMotion();
    for (const [f, el] of tabs.current) {
      if (d?.live && f === d.key) continue;
      const from = was.get(f);
      el.style.transform = "";
      const dx = from == null ? 0 : from - slotLeft(el);
      if (still || Math.abs(dx) < 0.5) continue;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], GLIDE);
    }
  });

  const save = (next: Family[]) => sportOrderStore.set(savedSportOrder(saved, next));

  const down = (f: Family, e: PointerEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || mine.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { key: f, id: e.pointerId, startX: e.clientX, grabX: e.clientX - r.left, x: e.clientX, live: false, order: [...mine] };
  };
  const move = (e: PointerEvent<HTMLAnchorElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    if (!d.live) {
      if (Math.abs(e.clientX - d.startX) < DRAG_START) return;
      d.live = true;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      el.getAnimations().forEach((a) => a.cancel());
      setLifted(d.key);
      setPreview(d.order);
    }
    follow(d);
    // Past the middle of a neighbour's place, the dragged tab takes it.
    const at = d.order.indexOf(d.key);
    for (const f of d.order) {
      const el = f === d.key ? null : tabs.current.get(f);
      if (!el) continue;
      const to = d.order.indexOf(f), middle = slotLeft(el) + el.offsetWidth / 2;
      if ((to > at && e.clientX > middle) || (to < at && e.clientX < middle)) {
        snapshot();
        d.order = moveKey(d.order, d.key, f);
        setPreview(d.order);
        break;
      }
    }
  };
  const end = (e: PointerEvent<HTMLAnchorElement>, keep: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!d.live) return;
    dragged.current = true;
    // Every tab, the dragged one included, settles from where it is now. The new order is saved before the preview
    // goes, so no render shows the old one in between.
    snapshot();
    if (keep && d.order.join() !== mine.join()) {
      save(d.order);
      setSaid(t("{name}, {n} of {total}", { name: name(d.key), n: d.order.indexOf(d.key) + 1, total: d.order.length }));
    }
    setPreview(null);
    setLifted(null);
  };
  const key = (f: Family, e: KeyboardEvent<HTMLAnchorElement>) => {
    const step = e.altKey ? ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[e.key] : undefined;
    if (step == null) return;
    e.preventDefault();
    const at = mine.indexOf(f), target = mine[at + step];
    if (!target) return;
    snapshot();
    save(moveKey(mine, f, target));
    setSaid(t("{name}, {n} of {total}", { name: name(f), n: at + step + 1, total: mine.length }));
  };

  return (
    <>
      <nav ref={nav} aria-label={t("Sport")} className="sp-switch" data-dragging={lifted ? true : undefined}
        onClickCapture={(e) => { if (dragged.current) { dragged.current = false; e.preventDefault(); } }}>
        {rows.map((s) => {
          const f = s.family, movable = f != null && order.includes(f) && mine.length > 1;
          return (
            <Link key={s.href} href={s.href} aria-current={f === current ? "page" : undefined} draggable={false}
              ref={(el) => { if (!f) return; if (el) tabs.current.set(f, el); else tabs.current.delete(f); }}
              data-lifted={(f != null && lifted === f) || undefined}
              aria-describedby={movable ? hint : undefined}
              onPointerDown={movable ? (e) => down(f, e) : undefined} onPointerMove={movable ? move : undefined}
              onPointerUp={movable ? (e) => end(e, true) : undefined} onPointerCancel={movable ? (e) => end(e, false) : undefined}
              onKeyDown={movable ? (e) => key(f, e) : undefined}>{t(s.label)}</Link>
          );
        })}
      </nav>
      <p id={hint} hidden>{t("Drag to reorder, or press Alt with the arrow keys.")}</p>
      <p className="sr-only" aria-live="polite">{said}</p>
    </>
  );
}

/** The page for a sport that is not one of the person's. */
export function NotYourSport({ name, families, origin, current }: { name: string; families: readonly Family[]; origin: Origin; current: Family }) {
  return (
    <main className="page sp-page">
      <SportHead title={name} current={current} families={families.filter((f) => f !== current)} origin={origin} />
      <p className="notice">{t("{sport} isn't one of your sports in the last 90 days.", { sport: name })}<Link href="/sports" className="sp-link">{t("All sports")}</Link></p>
    </main>
  );
}

/* ───────────── Hero ───────────── */

export function Figures({ items }: { items: readonly Figure[] }) {
  return (
    <div className="sp-figures">
      {items.map((f) => <div key={f.label}><b className="num"><CountUp text={f.value} /></b><span>{f.label}</span></div>)}
    </div>
  );
}

export function HeroText({ chip, headline, text, figures, mascot, basis }: { chip: string; headline: string; text: string | null; figures: readonly Figure[]; mascot?: boolean; basis?: number }) {
  return (
    <div className="sp-hero-text" style={basis ? { flexBasis: basis } : undefined}>
      <div className="sp-hero-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {mascot ? <img alt="" src="/img/coach-cheer.webp" /> : null}
        <span className="sp-pill">{chip}</span>
      </div>
      <h2>{headline}</h2>
      {text ? <p>{text}</p> : null}
      <Figures items={figures} />
    </div>
  );
}

/** A progress ring with a soft glow under it. Past 100% it stays full. */
export function Ring({ percent, size, stroke, label, className, children }: { percent: number | null; size: number; stroke: number; label: string; className?: string; children: ReactNode }) {
  const r = (size - stroke) / 2 - (size > 150 ? 0 : 0), c = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, (percent ?? 0) / 100)) * c;
  const arc = { stroke: "var(--sp)", strokeWidth: stroke, strokeLinecap: "round" as const, strokeDasharray: `${fill.toFixed(1)} ${c.toFixed(1)}` };
  return (
    <div className={`sp-ring${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}>
      <svg role="img" aria-label={label} className="no-wipe" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.09)", strokeWidth: stroke }} />
        {fill > 0 ? (
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ ...arc, filter: `blur(${Math.round(stroke * 0.6)}px)`, opacity: 0.4 }} />
            <circle className="cl-ring" cx={size / 2} cy={size / 2} r={r} fill="none" style={arc} />
          </g>
        ) : null}
      </svg>
      <div className="sp-ring-in">{children}</div>
    </div>
  );
}

/* ───────────── Chips, tiles, sections ───────────── */

const TONE_HUE: Record<Chip["tone"], Hue> = { good: "run", attention: "gold", neutral: "slate" };

export function ToneChip({ chip }: { chip: Chip | null }) {
  if (!chip) return null;
  return <span className="sp-chip" data-hue={TONE_HUE[chip.tone]}><i aria-hidden="true" />{chip.text}</span>;
}

/** The small trend with a soft area and a dot on the latest value. */
export function Spark({ values, hue }: { values: readonly number[]; hue: Hue }) {
  const W = 110, H = 38, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, k) => [3 + (k * 100) / Math.max(1, values.length - 1), 33 - ((v - lo) / span) * 28] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg aria-hidden="true" className="spark" data-hue={hue} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: "none" }}>
      <path d={`${line} L${lx.toFixed(1)} ${H} L3 ${H} Z`} style={{ fill: "var(--sp)", opacity: 0.14 }} />
      <path d={line} fill="none" style={{ stroke: "var(--sp)", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }} />
      <circle cx={lx} cy={ly} r="3.5" style={{ fill: "var(--sp)" }} />
    </svg>
  );
}

export function Tiles({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <div className="sp-row tight">
      {tiles.map((tile) => (
        <a key={tile.label} href={tile.href} className="sp-tile">
          <div className="sp-tile-top"><span>{tile.label}</span><ToneChip chip={tile.chip} /></div>
          <div className="sp-tile-mid">
            <b className="num"><CountUp text={tile.value} />{tile.unit ? <small>{tile.unit}</small> : null}</b>
            {tile.spark && tile.spark.length > 1 ? <Spark values={tile.spark} hue={tile.hue} /> : null}
          </div>
          <span>{tile.text}</span>
        </a>
      ))}
    </div>
  );
}

export interface SectionProps {
  id?: string;
  title: string;
  icon: string;
  hue: Hue;
  /** How the section is read, shown by the (i) button. */
  how?: string;
  flex: string;
  reading: Reading | Missing;
  /** The whole card is the sample athlete's: it carries the "Sample data" label. */
  sample?: boolean;
  /** Coach questions for the foot of the card; "Explain this" is added before them. */
  ask?: readonly string[];
  children?: ReactNode;
}

/** A card with the phone's section name, its tone chip, its headline, and Coach's questions at the foot. */
export function Section({ id, title, icon, hue, how, flex, reading, sample, ask, children }: SectionProps) {
  const none = isMissing(reading);
  return (
    <section id={id} aria-label={title} className="sp-card" style={{ flex }}>
      <div className="sp-card-head">
        <span aria-hidden="true" className="sp-icon sp-tint" data-hue={hue}><Icon name={icon} /></span>
        <h2>{title}</h2>
        <span className="sp-end">
          {sample ? <OriginBadge origin="sample" /> : null}
          {none || sample ? null : <ToneChip chip={reading.chip} />}
          {how ? (
            <button type="button" className="sp-how" aria-label={t("How {title} is read: {how}", { title, how })}>
              <Icon name="info" size={18} width={1.8} /><span className="tip">{how}</span>
            </button>
          ) : null}
        </span>
      </div>
      {none ? <p className="sp-missing">{reading.missing}</p> : (
        <>
          <div className="sp-reading"><h3>{reading.headline}</h3>{reading.sub ? <p>{reading.sub}</p> : null}</div>
          {children}
          {ask && !sample ? <CoachRow title={title} headline={reading.headline} questions={ask} /> : null}
        </>
      )}
    </section>
  );
}

/** "Explain this" and the section's questions. Each opens Coach with the question in its message box. */
export function CoachRow({ title, headline, questions }: { title: string; headline: string; questions: readonly string[] }) {
  return (
    <div className="sp-foot">
      <Link className="sp-ask strong" href={coachHref(t('Explain my "{title}" reading: {headline}', { title, headline }))}><Icon name="spark" size={15} width={2} />{t("Explain this")}</Link>
      {questions.map((q) => <Link key={q} className="sp-ask" href={coachHref(q)}>{q}</Link>)}
    </div>
  );
}

/** A block of the sample athlete's inside a card of the person's own readings, marked "Sample data". */
export function SampleBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sp-sample">
      <div className="sp-side-head"><b>{title}</b><OriginBadge origin="sample" /></div>
      {children}
    </div>
  );
}

export function Stats({ items }: { items: readonly Figure[] }) {
  return <div className="sp-stats">{items.map((f) => <div key={f.label}><b className="num">{f.value}</b><span>{f.label}</span></div>)}</div>;
}

/* ───────────── Charts ───────────── */

/** The legend that goes with `Bars`: the dashed line's meaning and the planned outline. */
export function BarsLegend({ chart }: { chart: BarChart }) {
  if (!chart.line && !chart.planned) return null;
  return (
    <span className="sp-legend">
      {chart.line ? <span><i aria-hidden="true" className="sp-swatch-dash" style={{ background: "none", borderRadius: 0, height: 0 }} />{chart.line.text}</span> : null}
      {chart.planned ? <span><i aria-hidden="true" className="sp-swatch-plan" style={{ background: "none" }} />{t("Planned")}</span> : null}
    </span>
  );
}

/** Bars with a value on top and one or two labels under each; planned amounts as dashed outlines; one dashed line across. */
export function Bars({ chart, hue, width = 700, height = 226 }: { chart: BarChart; hue: Hue; width?: number; height?: number }) {
  const two = chart.bars.some((b) => b.sub);
  const top = 30, base = height - (two ? 36 : 22), room = base - top;
  const max = Math.max(1, ...chart.bars.map((b) => b.value + (b.planned ?? 0)), chart.line?.value ?? 0);
  const slot = width / Math.max(1, chart.bars.length), bar = Math.min(62, slot * 0.62);
  const y = (v: number) => base - (v / max) * room;
  return (
    <svg role="img" aria-label={chart.label} className="sp-chart" data-hue={hue} viewBox={`0 0 ${width} ${height}`}>
      {chart.bars.map((b, k) => {
        const x = k * slot + (slot - bar) / 2, cx = k * slot + slot / 2;
        const h = b.value > 0 ? Math.max(5, base - y(b.value)) : 5;
        const planTop = b.planned ? y(b.value + b.planned) : 0;
        return (
          <g key={k}>
            {b.value > 0
              ? <rect x={x} y={base - h} width={bar} height={h} rx="6" style={{ fill: b.over ? "var(--h-coral)" : "var(--sp)", opacity: b.now ? 1 : 0.45 }} />
              : <rect className="track" x={x} y={base - 5} width={bar} height="5" rx="2.5" />}
            {b.planned ? <rect className="plan" x={x + 0.7} y={planTop} width={bar - 1.4} height={Math.max(4, (b.value > 0 ? base - h - 3 : base - 8) - planTop)} rx="6" /> : null}
            {b.top ? <text className={b.now ? "now" : undefined} x={cx} y={(b.planned ? planTop : base - h) - 6} textAnchor="middle">{b.top}</text> : null}
            <text className={b.now ? "now" : undefined} x={cx} y={base + 16} textAnchor="middle">{b.label}</text>
            {b.sub ? <text x={cx} y={base + 31} textAnchor="middle">{b.sub}</text> : null}
          </g>
        );
      })}
      {chart.line ? <path className="dash" d={`M0 ${y(chart.line.value).toFixed(1)}H${width}`} /> : null}
    </svg>
  );
}

/** A line with a soft area, a glow, and a dot on the latest value; three marks on the right and three dates under it. */
export function TrendLine({ chart, hue, width = 520, height = 172 }: { chart: LineChart; hue: Hue; width?: number; height?: number }) {
  const plotW = width - 58, top = 20, bottom = height - 30;
  const lo = Math.min(...chart.values), hi = Math.max(...chart.values), span = hi - lo || 1;
  const yOf = (v: number) => { const f = (v - lo) / span; return hi === lo ? (top + bottom) / 2 : chart.flip ? top + f * (bottom - top - 12) : bottom - 12 - f * (bottom - top - 12); };
  const pts = chart.values.map((v, k) => [8 + (k * (plotW - 16)) / Math.max(1, chart.values.length - 1), yOf(v)] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const marksY = chart.marks.length === 3 ? [top, (top + bottom - 12) / 2, bottom - 12] : [yOf(hi)];
  const datesX = chart.dates.length === 3 ? [8, plotW / 2, plotW - 8] : chart.dates.length === 2 ? [8, plotW - 8] : [plotW / 2];
  const stroke = { stroke: "var(--sp)", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg role="img" aria-label={chart.label} className="sp-chart" data-hue={hue} viewBox={`0 0 ${width} ${height}`}>
      {chart.marks.map((m, k) => (
        <g key={k}><path className="grid" d={`M0 ${marksY[k].toFixed(1)}H${plotW}`} /><text x={plotW + 8} y={marksY[k] + 4}>{m}</text></g>
      ))}
      <path d={`${line} L${lx.toFixed(1)} ${bottom} L${pts[0][0].toFixed(1)} ${bottom} Z`} style={{ fill: "var(--sp)", opacity: 0.12 }} />
      <path d={line} fill="none" style={{ ...stroke, strokeWidth: 6, filter: "blur(7px)", opacity: 0.45 }} />
      <path d={line} fill="none" style={{ ...stroke, strokeWidth: 3 }} />
      <circle cx={lx} cy={ly} r="5" style={{ fill: "var(--sp)" }} />
      {chart.dates.map((d, k) => <text key={k} x={datesX[k]} y={height - 6} textAnchor={k === 0 ? "start" : k === chart.dates.length - 1 && chart.dates.length > 1 ? "end" : "middle"}>{d}</text>)}
    </svg>
  );
}

/** Shares as one split bar with a figure under each part. `band` marks where elite runners' easy share ends. */
export function Split({ shares, label, band }: { shares: readonly SplitShare[]; label: string; band?: boolean }) {
  const bar = (
    <div role="img" aria-label={label} className="sp-split">
      {shares.map((s) => <span key={s.name} data-hue={s.hue} style={{ flex: `${Math.max(s.percent, 0.5)} 1 0` }} />)}
    </div>
  );
  return (
    <>
      {band ? <div className="sp-split-wrap"><em>{t("Easy target 75–80%")}</em><u aria-hidden="true" />{bar}</div> : bar}
      <div className="sp-shares">
        {shares.map((s) => (
          <div key={s.name} style={{ flex: `${Math.max(s.percent, 18)} 1 0` }}><b className="num">{s.percent}%</b><span><i aria-hidden="true" data-hue={s.hue} />{s.name} · {s.detail}</span></div>
        ))}
      </div>
    </>
  );
}

export const DISCLAIMER = msg("C-LINK's reading of your COROS data with published sports-science methods. It isn't medical advice: if something feels wrong, rest and ask a doctor.");
