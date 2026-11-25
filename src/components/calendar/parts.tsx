"use client";
// Pieces of the training calendar: entry chips, the week column, filters, the day panel, the changes bar,
// the review dialog and the right-click menu.
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Button, Field, LinkButton, Segmented } from "@/components/ui";
import { destination } from "@/data/calendarEdits";
import type { CalendarEntry, CalendarSport } from "@/data/training";
import { longDay, shortDay } from "@/lib/calendar";
import { clock } from "@/lib/format";
import { doneOfPlanned, kmText, metresText, tone, type Drafted, type Filter, type NetChange, type PlanState, type Show, type WeekNumbers } from "@/lib/calendarPlan";

export type Entry = Drafted<CalendarEntry>;

export const SPORT_HUE: Record<CalendarSport, string> = {
  run: "var(--sport-run)", ride: "var(--sport-ride)", strength: "var(--sport-strength)", swim: "var(--sport-swim)", other: "var(--sport-other)",
};
export const SPORTS: { sport: CalendarSport; label: string; hue: string }[] = [
  { sport: "run", label: "Run", hue: SPORT_HUE.run },
  { sport: "ride", label: "Bike", hue: SPORT_HUE.ride },
  { sport: "strength", label: "Strength", hue: SPORT_HUE.strength },
  { sport: "swim", label: "Swim", hue: SPORT_HUE.swim },
  { sport: "other", label: "Other", hue: SPORT_HUE.other },
];

/* ───────────── Icons ───────────── */

const ICON: Record<string, string> = {
  prev: "M15 5l-7 7 7 7", next: "M9 5l7 7-7 7", plus: "M12 5v14M5 12h14", x: "M6 6l12 12M18 6L6 18",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1", paste: "M9 4h6v3H9zM7 5H5v15h14V5h-2", filter: "M4 6h16M7 12h10M10 18h4",
  undo: "M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2", trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13", coach: "M5 5h14v10.5h-8.5L5 20z",
  check: "M5 12l5 5 9-10", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  unlink: "M15.7 14l3-3a4 4 0 0 0-5.7-5.7l-1 1M8.3 10l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16", select: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 17l2 2 4-4",
};
export function Icon({ name, size = 15 }: { name: keyof typeof ICON | string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.3, strokeLinecap: "round", strokeLinejoin: "round", flex: "none" }}>
      <path d={ICON[name]} />
    </svg>
  );
}

/* ───────────── Entry chip ───────────── */

export interface ChipProps {
  entry: Entry;
  /** For a recorded activity: the plan it did and how much of it. */
  plan?: Entry | null;
  percent?: number | null;
  /** For a planned workout. */
  state?: PlanState;
  draggable: boolean;
  copied: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onHover: (on: boolean) => void;
  onMenu: (e: MouseEvent) => void;
  tall?: boolean;
  /** Something is being dragged over this entry that would link to it. */
  linkTarget?: boolean;
  /** Drop handlers for linking an activity and a plan by dropping one on the other. */
  dropProps?: { onDragOver: (e: DragEvent) => void; onDragLeave: () => void; onDrop: (e: DragEvent) => void };
}

export function entryHref(e: CalendarEntry): string | null {
  if (e.status === "done") return e.activityId ? `/activities/${encodeURIComponent(e.activityId)}` : "/activities";
  if (e.workoutId) return `/calendar/workout?id=${encodeURIComponent(e.workoutId)}`;
  return null;
}

export function badgeOf(entry: Entry, plan: Entry | null | undefined, percent: number | null | undefined, state: PlanState | undefined): { text: string; tone: string } | null {
  if (entry.status === "done") {
    if (plan) return percent != null ? { text: `${percent}%`, tone: tone(percent) } : { text: "Done", tone: "complete" };
    return null;
  }
  if (state === "missed") return { text: "Missed", tone: "missed" };
  if (state === "today") return { text: "Today", tone: "today" };
  return null;
}

export function EntryChip(p: ChipProps) {
  const { entry } = p;
  const hue = SPORT_HUE[entry.sport];
  const badge = badgeOf(entry, p.plan, p.percent, p.state);
  const href = entryHref(entry);
  const done = entry.status === "done";
  const sub = done && p.plan
    ? `${entry.detail}${entry.load != null && p.plan.load != null ? ` · ${entry.load} / ${p.plan.load} TL` : ""}`
    : entry.detail + (!done && entry.load ? ` · ${entry.load} TL` : "");
  const label = `${done ? "Done" : p.state === "missed" ? "Missed" : "Planned"}: ${entry.name}${entry.detail ? `, ${entry.detail}` : ""}${p.plan ? `, ${badge?.text} of “${p.plan.name}”` : ""}`;
  const body = (
    <>
      <span className="cal-line">
        {p.selectable ? (
          <input type="checkbox" className="cal-check" checked={p.selected} onChange={p.onSelect} onClick={(e) => e.stopPropagation()} aria-label={`Select ${entry.name}, ${shortDay(entry.date)}`} />
        ) : null}
        <i aria-hidden="true" className="cal-dot" style={done ? { background: hue } : { border: `2px solid ${p.state === "missed" ? "var(--dim)" : hue}` }} />
        <span className="cal-name" style={p.state === "missed" ? { color: "var(--muted)" } : undefined}>{entry.name}</span>
        {badge ? <span className="cal-badge" data-tone={badge.tone}>{badge.text}</span> : null}
      </span>
      {sub ? <span className="cal-sub">{sub}</span> : null}
      {entry.pending ? <span className="cal-pending">Not saved</span> : null}
      {entry.source === "browser" && !entry.pending ? <span className="cal-note">On this computer</span> : null}
      {p.tall && p.plan ? <span className="cal-note">Planned: {p.plan.name}</span> : null}
    </>
  );
  const common = {
    className: `cal-entry ${done ? "cal-done" : "cal-plan"}`,
    "data-entry": entry.id,
    "data-state": p.state,
    "data-copied": p.copied || undefined,
    "data-link": p.linkTarget || undefined,
    ...p.dropProps,
    "data-pending": entry.pending,
    draggable: p.draggable,
    onDragStart: p.draggable ? p.onDragStart : undefined,
    onDragEnd: p.onDragEnd,
    onMouseEnter: () => p.onHover(true),
    onMouseLeave: () => p.onHover(false),
    onContextMenu: p.onMenu,
    "aria-label": label,
    title: !p.draggable ? undefined : done ? "Drop on a plan to link them." : "Drag to move. Hold Option to copy.",
  };
  if (href && !p.selectable && !entry.pending) return <Link href={href} {...common}>{body}</Link>;
  return <div tabIndex={0} {...common}>{body}</div>;
}

/* ───────────── Week column ───────────── */

const SPORT_ICON: Record<CalendarSport, string> = {
  other: "M3 12h4l3-8 4 16 3-8h4",
  run: "M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0zM20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0zM16 17h4M4 13h4",
  ride: "M5.5 14a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM18.5 14a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM15 4.5a1 1 0 1 0 0 .1M12 17.5V14l-3-3 4-3 2 3h2",
  strength: "M14.4 14.4L9.6 9.6M18.7 21.5a2 2 0 1 1-2.9-2.8l-1.7 1.7a2 2 0 1 1-2.9-2.8l6.4-6.4a2 2 0 1 1 2.8 2.9l-1.7 1.7a2 2 0 1 1 2.8 2.9zM21.5 21.5l-1.4-1.4M3.9 3.9L2.5 2.5M6.4 12.8a2 2 0 1 1-2.8-2.9l1.7-1.7a2 2 0 1 1-2.8-2.9l2.8-2.8a2 2 0 1 1 2.9 2.8l1.7-1.7a2 2 0 1 1 2.8 2.9z",
  swim: "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
};
const SPORT_NAME: Record<CalendarSport, string> = { run: "Run", ride: "Bike", strength: "Strength", swim: "Swim", other: "Other" };

const pair = doneOfPlanned;

export function WeekColumn({ n, now, weekLabel }: { n: WeekNumbers; now?: { baseFitness?: number; loadRatio?: number }; weekLabel: string }) {
  const any = n.load > 0 || n.plannedLoad > 0 || n.seconds > 0 || n.plannedSeconds > 0 || n.metres > 0 || n.plannedMetres > 0;
  return (
    <div role="cell" className="cal-week">
      {now?.baseFitness != null ? <WRow k="Base Fitness" v={String(Math.round(now.baseFitness))} tone="accent" /> : null}
      {now?.loadRatio != null ? <WRow k="Load Ratio" v={now.loadRatio.toFixed(2)} tone="warn" /> : null}
      <WRow k="Training Load" v={n.plannedLoad > 0 ? `${n.load} / ${n.plannedLoad} TL` : `${n.load} TL`} />
      <WRow k="Activity Time" v={pair(n.seconds, n.plannedSeconds, (s) => clock(s))} />
      <WRow k="Distance" v={pair(n.metres, n.plannedMetres, kmText, " km")} />
      <WRow k="Elev. Gain" v={n.elevation > 0 ? `${n.elevation} m` : "--"} />
      {n.sports.length ? (
        <ul className="cal-wsports" aria-label="By sport">
          {n.sports.map((s) => {
            const sport = s.sport as CalendarSport;
            const swim = sport === "swim";
            const dist = s.plannedMetres > 0 || s.metres > 0 ? pair(s.metres, s.plannedMetres, swim ? metresText : kmText, swim ? " m" : " km") : null;
            return (
              <li key={s.sport}>
                <div className="cal-wrow">
                  <span className="cal-wsport">
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ color: SPORT_HUE[sport] ?? "var(--h-mint)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", flex: "none" }}><path d={SPORT_ICON[sport] ?? SPORT_ICON.run} /></svg>
                    {SPORT_NAME[sport] ?? s.sport}
                  </span>
                  <b>{s.plannedLoad > 0 ? `${s.load} / ${s.plannedLoad} TL` : `${s.load} TL`}</b>
                </div>
                <div className="cal-wmeta"><span>{pair(s.seconds, s.plannedSeconds, (v) => clock(v))}</span>{dist ? <span>{dist}</span> : null}</div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {any ? (
        <LinkButton className="btn-sm cal-wcoach" href={`/coach?ask=${encodeURIComponent(`How is the week of ${weekLabel} going?`)}`} title="Ask Coach about this week">
          <Icon name="coach" size={13} />Ask Coach
        </LinkButton>
      ) : null}
    </div>
  );
}

function WRow({ k, v, tone }: { k: string; v: string; tone?: "accent" | "warn" }) {
  return (
    <div className="cal-wrow">
      <span className="muted">{k}</span>
      <b style={tone === "accent" ? { color: "var(--h-mint-ink)" } : tone === "warn" ? { color: "var(--h-amber-ink)" } : undefined}>{v}</b>
    </div>
  );
}

/* ───────────── Filters ───────────── */

export function FilterBar({ filter, counts, hiddenCount, onChange }: { filter: Filter; counts: Record<string, number>; hiddenCount: number; onChange: (f: Filter) => void }) {
  return (
    <div role="group" aria-label="Calendar filters" className="cal-filters">
      <Segmented<Show> small label="Show" value={filter.show} onChange={(show) => onChange({ ...filter, show })}
        options={[{ value: "all", label: "All" }, { value: "planned", label: "Planned" }, { value: "completed", label: "Completed" }]} />
      <span aria-hidden="true" className="cal-vr" />
      <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Sports shown</span>
      {SPORTS.filter((s) => s.sport !== "other" || counts.other || filter.hidden.includes("other")).map((s) => {
        const off = filter.hidden.includes(s.sport);
        return (
          <button key={s.sport} type="button" className="cal-sport" aria-pressed={!off} aria-label={`${off ? "Show" : "Hide"} ${s.label}`}
            onClick={() => onChange({ ...filter, hidden: off ? filter.hidden.filter((h) => h !== s.sport) : [...filter.hidden, s.sport] })}>
            <i aria-hidden="true" style={off ? { border: "2px solid var(--dim)" } : { background: s.hue }} />{s.label}<span className="muted">{counts[s.sport] ?? 0}</span>
          </button>
        );
      })}
      {hiddenCount > 0 ? (
        <span className="cal-hidden"><span className="muted">{hiddenCount} hidden</span><Button onClick={() => onChange({ show: "all", hidden: [] })}>Show everything</Button></span>
      ) : null}
    </div>
  );
}

/* ───────────── Day panel ───────────── */

export interface PanelEntry { entry: Entry; plan: Entry | null; percent: number | null; state?: PlanState; canMove: boolean; canCopy: boolean }

export function DayPanel({ day, today, items, clipboard, side, top, onClose, onCopy, onCopyDay, onPaste, onMove, onRemove }: {
  day: string; today: string; items: PanelEntry[]; clipboard: number;
  /** Which side of the grid it sits on: away from the day it is about. */
  side: "left" | "right";
  /** Pixels from the top of the grid: the chosen week's row. */
  top: number;
  onClose: () => void; onCopy: (e: Entry) => void; onCopyDay: () => void; onPaste: () => void; onMove: (e: Entry, to: string) => void; onRemove: (e: Entry) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, [day]);
  const copyable = items.filter((i) => i.canCopy).length;
  return (
    <aside ref={ref} tabIndex={-1} aria-label={`${longDay(day)} details`} className="cal-panel" data-side={side} style={{ top }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{day === today ? "Today" : day < today ? "Past" : "Coming up"}</span>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" }}>{longDay(day)}</h2>
        </div>
        <Button aria-label="Close details" onClick={onClose} style={{ width: 36, padding: 0 }}><Icon name="x" /></Button>
      </div>
      {items.length === 0 ? <p className="muted" style={{ margin: 0, padding: "18px 0", textAlign: "center", fontSize: 13 }}>{day < today ? "Rest day" : "Nothing planned"}</p> : null}
      {items.map((i) => <PanelItem key={i.entry.id} item={i} today={today} onCopy={onCopy} onMove={onMove} onRemove={onRemove} />)}
      <div className="cal-panel-actions">
        {day >= today ? <LinkButton variant="primary" href={`/calendar/new?date=${day}`}><Icon name="plus" />Add workout</LinkButton> : null}
        {day <= today ? <LinkButton href={`/calendar/log?date=${day}`}>Log activity</LinkButton> : null}
        <LinkButton href={`/coach?ask=${encodeURIComponent(`How does ${longDay(day)} fit my week?`)}`}><Icon name="coach" />Ask Coach</LinkButton>
        {clipboard > 0 && day >= today ? <Button onClick={onPaste}><Icon name="paste" />Paste {clipboard === 1 ? "workout" : `${clipboard} workouts`}</Button> : null}
        {copyable > 0 ? <Button onClick={onCopyDay}><Icon name="copy" />Copy day</Button> : null}
      </div>
    </aside>
  );
}

function PanelItem({ item, today, onCopy, onMove, onRemove }: { item: PanelEntry; today: string; onCopy: (e: Entry) => void; onMove: (e: Entry, to: string) => void; onRemove: (e: Entry) => void }) {
  const { entry, plan, percent, state } = item;
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState(entry.date >= today ? entry.date : today);
  const badge = badgeOf(entry, plan, percent, state);
  const gym = entry.source === "synced" && entry.status === "planned";
  const href = entryHref(entry) ?? (gym ? "/strength" : null);
  const where = entry.source === "coros" ? "COROS calendar" : entry.source === "browser" ? "saved on this computer" : gym ? "gym routine from your phone" : "";
  const lead = entry.status === "done"
    ? (plan ? `Done · ${percent != null ? `${percent}% of plan` : `did “${plan.name}”`}` : "Done · not planned")
    : state === "missed" ? "Missed · nothing recorded that day" : state === "today" ? "Today" : "Planned";
  const status = [lead, entry.status === "done" && plan && plan.name !== entry.name ? `planned as “${plan.name}”` : "", where].filter(Boolean).join(" · ");
  const rows: [string, string][] = [];
  if (plan) rows.push(["Planned", plan.detail + (plan.load != null ? ` · ${plan.load} TL` : "")]);
  if (entry.status === "planned" && entry.detail) rows.push(["Planned", entry.detail + (entry.load != null ? ` · ${entry.load} TL` : "")]);
  if (entry.status === "done") rows.push(["Done", entry.detail + (entry.load != null ? ` · ${entry.load} TL` : "")]);
  return (
    <div className="cal-panel-item">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <i aria-hidden="true" className="cal-dot" style={entry.status === "done" ? { background: SPORT_HUE[entry.sport] } : { border: `2px solid ${SPORT_HUE[entry.sport]}` }} />
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{entry.name}</span>
        {badge ? <span className="cal-badge" data-tone={badge.tone}>{badge.text}</span> : null}
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{status}{entry.pending ? " · not saved yet" : ""}</span>
      {rows.map(([k, v]) => <div key={k} className="cal-wrow" style={{ fontSize: 13 }}><span className="muted">{k}</span><b style={{ fontWeight: 600, textAlign: "right" }}>{v}</b></div>)}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
        {href && !entry.pending ? <LinkButton href={href} className="btn-sm">{entry.status === "done" ? "Open the full activity page" : gym ? "Open routines" : "Open workout"}</LinkButton> : null}
        {item.canCopy ? <Button className="btn-sm" onClick={() => onCopy(entry)}><Icon name="copy" size={13} />Copy</Button> : null}
        {item.canMove ? <Button className="btn-sm" aria-expanded={moving} onClick={() => setMoving((m) => !m)}>Move</Button> : null}
        {item.canMove ? <Button className="btn-sm" onClick={() => onRemove(entry)} style={{ color: "var(--h-rose-ink)" }}><Icon name="trash" size={13} />Remove</Button> : null}
      </div>
      {moving ? (
        <form style={{ display: "flex", gap: 6, alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); if (to >= today) { onMove(entry, to); setMoving(false); } }}>
          <Field type="date" aria-label="New day" value={to} min={today} onChange={(e) => setTo(e.target.value)} style={{ flex: 1 }} />
          <Button type="submit" variant="primary" disabled={!to || to < today || to === entry.date}>Move</Button>
        </form>
      ) : null}
    </div>
  );
}

/* ───────────── Changes bar and review ───────────── */

export function ChangesDock({ count, onUndo, onDiscard, onReview }: { count: number; onUndo: () => void; onDiscard: () => void; onReview: () => void }) {
  return (
    <div className="cal-dock" role="region" aria-label="Unsaved calendar changes">
      <b style={{ fontSize: 15 }}>{count === 1 ? "1 change" : `${count} changes`}</b>
      <span className="muted" style={{ fontSize: 13 }}>Only here until you save</span>
      <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button onClick={onUndo}><Icon name="undo" />Undo</Button>
        <Button onClick={onDiscard}>Discard</Button>
        <Button variant="primary" onClick={onReview}>Review</Button>
      </span>
    </div>
  );
}

export function ReviewDialog({ changes, saving, error, onClose, onSave, onDiscard }: {
  changes: NetChange<CalendarEntry>[]; saving: { done: number; total: number } | null; error: string | null;
  onClose: () => void; onSave: () => void; onDiscard: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const groups: [string, NetChange<CalendarEntry>[]][] = [
    ["Moved", changes.filter((c) => c.kind === "move")],
    ["Removed", changes.filter((c) => c.kind === "remove")],
    ["Added", changes.filter((c) => c.kind === "copy")],
  ];
  const allCoros = changes.every((c) => c.entry.source === "coros");
  const n = changes.length;
  return (
    <div className="cal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cal-review-title" className="cal-dialog"
        onKeyDown={(e) => { if (e.key === "Escape" && !saving) onClose(); }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{allCoros ? "COROS calendar" : "Calendar"}</span>
            <h2 id="cal-review-title" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Review changes</h2>
          </div>
          <Button aria-label="Close" onClick={onClose} disabled={!!saving} style={{ width: 36, padding: 0 }}><Icon name="x" /></Button>
        </div>
        {groups.filter(([, list]) => list.length).map(([k, list]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{k}</span>
            {list.map((c, i) => (
              <div key={`${c.entry.id}-${i}`} className="cal-review-row">
                <i aria-hidden="true" className="cal-dot" style={{ background: SPORT_HUE[c.entry.sport] }} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><b style={{ fontWeight: 600 }}>{c.entry.name}</b><span className="muted" style={{ fontSize: 12 }}>{destination(c.entry)}</span></span>
                <span className="muted">{c.kind === "move" ? `${shortDay(c.entry.date)} → ${shortDay(c.to)}` : c.kind === "copy" ? shortDay(c.to) : shortDay(c.entry.date)}</span>
              </div>
            ))}
          </div>
        ))}
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          {changes.some((c) => c.entry.source === "coros") ? "COROS changes go to your COROS calendar, and your watch picks them up, when you save. " : ""}
          {changes.some((c) => c.entry.source === "synced") ? "Gym routines reach your phone at its next sync. " : ""}
          {changes.some((c) => c.entry.source === "browser") ? "Workouts saved on this computer change here only." : ""}
        </p>
        {error ? <div className="notice" role="alert" style={{ color: "var(--h-rose-ink)" }}>{error}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {saving ? <span className="muted" role="status" style={{ marginRight: "auto", fontSize: 13 }}>Saving {saving.done + 1} of {saving.total}… One at a time.</span> : null}
          <Button onClick={onDiscard} disabled={!!saving}>Discard changes</Button>
          <Button variant="primary" onClick={onSave} disabled={!!saving || n === 0}>{allCoros ? `Save ${n === 1 ? "1 change" : `${n} changes`} to COROS` : `Save ${n === 1 ? "1 change" : `${n} changes`}`}</Button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Right-click menu ───────────── */

export interface MenuItem { label: string; icon?: string; onPick: () => void; danger?: boolean; disabled?: boolean }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: globalThis.MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);
  const left = typeof window === "undefined" ? x : Math.min(x, window.innerWidth - 240);
  const top = typeof window === "undefined" ? y : Math.min(y, window.innerHeight - items.length * 40 - 24);
  return (
    <div ref={ref} role="menu" className="popover cal-menu" style={{ position: "fixed", left, top, right: "auto" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
          const at = all.indexOf(document.activeElement as HTMLButtonElement);
          all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
        }
      }}>
      {items.map((m) => (
        <button key={m.label} type="button" role="menuitem" disabled={m.disabled} onClick={() => { m.onPick(); onClose(); }} style={m.danger ? { color: "var(--h-rose-ink)" } : undefined}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{m.icon ? <Icon name={m.icon} size={14} /> : null}{m.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="actions" style={{ gap: 10 }}>{children}</div>;
}
