"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  ChangesDock, ContextMenu, DayPanel, EntryChip, FilterBar, Icon, ReviewDialog, SPORT_HUE, WeekColumn,
  badgeOf, entryHref, type Entry, type MenuItem, type PanelEntry,
} from "@/components/calendar/parts";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Button, LinkButton, OriginBadge, Segmented } from "@/components/ui";
import { draftStore, filterStore, linkStore, NO_DRAFT, NO_LINKS, opsFor, saveChange } from "@/data/calendarEdits";
import { useLoaded } from "@/data/core";
import { useStore } from "@/data/local/store";
import { syncNow, useSyncStatus } from "@/data/sync";
import { cleanWorkouts, NO_WORKOUTS, workoutStore } from "@/data/local/workouts";
import { loadCalendar } from "@/data/training";
import { workoutEntries } from "@/data/workouts";
import {
  addDays, addMonths, dayMonth, isDayKey, isMonthKey, mondayOf, monthOf, monthOfWeek, monthTitle, monthWeeks,
  placeEntries, shortDay, weekDays, weekdayName, weekInMonth, weekTitle,
} from "@/lib/calendar";
import {
  applyDraft, canCopy, canDropOn, canMove, canRemove, dropOnDay, linkOptions, linkPair, liveOps, netChanges, NO_FILTER, pairEntries, passes, planState, weekNumbers,
  withLink, withoutLink,
  type DraftOp, type Filter, type Pairing,
} from "@/lib/calendarPlan";
import "./training.css";
import { locale, t, tx } from "@/lib/i18n";

const GRID = "repeat(7, minmax(0, 1fr)) 208px";
/** Marks a drag as the calendar's own, so files dragged in from elsewhere are never taken for workouts. */
const DRAG_TYPE = "application/x-clink-calendar";
/** How long a drag rests on ‹ or › before the calendar turns the page. */
const PAGE_HOLD_MS = 600;
let pageTimer: ReturnType<typeof setTimeout> | undefined;
const stopPaging = () => { clearTimeout(pageTimer); pageTimer = undefined; };
type View = "week" | "month" | "list";
interface Clip { ids: string[]; label: string }
interface Menu { x: number; y: number; day: string; entryId: string | null }

export default function CalendarPage() {
  return (
    <Suspense fallback={<LoadingPage label={t("Calendar")} />}>
      <CalendarScreen />
    </Suspense>
  );
}

/** Short weekday names, Monday first, in the app's language (2024-01-01 was a Monday). */
function weekHeads(): string[] {
  const short = new Intl.DateTimeFormat(locale("en-GB"), { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => short.format(Date.UTC(2024, 0, 1 + i)));
}

let copyCounter = 0;
const copyKey = () => `copy-${Date.now().toString(36)}-${(copyCounter++).toString(36)}`;

function CalendarScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const state = useLoaded(loadCalendar);
  const stored = useStore(workoutStore, NO_WORKOUTS);
  const savedEntries = useMemo(() => cleanWorkouts(stored).flatMap(workoutEntries), [stored]);
  const ops = useStore(draftStore, NO_DRAFT);
  const filter = useStore(filterStore, NO_FILTER);
  const links = useStore(linkStore, NO_LINKS);
  const sync = useSyncStatus();
  const [refreshing, setRefreshing] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [panelDay, setPanelDay] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(44);
  const [clip, setClip] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [say, setSay] = useState("");
  const hover = useRef<{ day: string | null; entry: string | null; keys: boolean }>({ day: null, entry: null, keys: false });
  const dragging = useRef<{ ids: string[]; anchor: string } | null>(null);
  const [overEntry, setOverEntry] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : null;
  const today = data?.today ?? "";
  const placed = useMemo(() => (data ? placeEntries(data.entries, savedEntries) : null), [data, savedEntries]);
  const base = useMemo(() => (placed ? [...placed.byDay.values()].flat() : []), [placed]);
  const live = useMemo(() => liveOps(base, ops), [base, ops]);
  const drafted = useMemo(() => applyDraft(base, live), [base, live]);
  const changes = useMemo(() => netChanges(base, live), [base, live]);
  const pairing = useMemo(() => pairEntries(drafted, links), [drafted, links]);
  const weekLoad = useMemo(() => new Map((data?.weeks ?? []).map((w) => [w.weekStart, w.load])), [data]);
  const byId = useMemo(() => new Map(drafted.map((e) => [e.id, e])), [drafted]);

  const weekParam = params.get("week");
  const monthParam = params.get("month");
  const view: View = params.get("view") === "list" ? "list" : isDayKey(weekParam) ? "week" : "month";
  const week = isDayKey(weekParam) ? mondayOf(weekParam) : mondayOf(today || "2026-01-05");
  const month = view === "week" ? monthOfWeek(week) : isMonthKey(monthParam) ? monthParam : monthOf(today || "2026-01-05");
  const rows = useMemo(() => (view === "week" ? [weekDays(week)] : monthWeeks(month)), [view, week, month]);
  const shownDays = useMemo(() => rows.flat(), [rows]);

  /* ───── Edits ───── */
  const push = useCallback((...next: DraftOp[]) => { draftStore.set((prev) => [...prev, ...next]); setSaveError(null); }, []);
  const undo = useCallback(() => { draftStore.set((prev) => prev.slice(0, -1)); setSay(t("Undone.")); }, []);
  const discard = useCallback(() => { draftStore.set([]); setReview(false); setSaveError(null); setSay(t("Changes discarded.")); }, []);

  const copyEntries = useCallback((list: Entry[], label: string) => {
    const ok = list.filter((e) => canCopy(e));
    if (!ok.length) { setSay(t("Nothing here can be copied.")); return; }
    setClip({ ids: ok.map((e) => e.id), label });
    setSay(t("Copied {what}. Paste on a day with ⌘V or right-click.", { what: label }));
  }, []);
  const pasteOn = useCallback((day: string) => {
    if (!clip || !canDropOn(day, today)) return;
    push(...clip.ids.filter((id) => byId.has(id)).map((id): DraftOp => ({ op: "copy", id, to: day, key: copyKey() })));
    setSay(t("Pasted {what} on {day}.", { what: clip.label, day: shortDay(day) }));
  }, [clip, today, byId, push]);
  const moveEntry = useCallback((e: Entry, to: string) => {
    if (!canMove(e, today) || !canDropOn(to, today) || e.date === to) return;
    push({ op: "move", id: e.id, to });
    setSay(t("Moved “{name}” to {day}.", { name: e.name, day: shortDay(to) }));
  }, [today, push]);
  const removeEntry = useCallback((e: Entry) => { push({ op: "remove", id: e.id }); setSay(t("Removed “{name}”.", { name: e.name })); }, [push]);

  const dayEntries = useCallback((day: string) => drafted.filter((e) => e.date === day), [drafted]);

  useEffect(() => {
    if (!say) return;
    const timer = setTimeout(() => setSay(""), 3500);
    return () => clearTimeout(timer);
  }, [say]);

  /* ───── Keyboard: copy, paste, undo, arrows ───── */
  const keys = useRef({ copyEntries, pasteOn, undo, dayEntries, byId, shownDays, removeEntry, today, clip });
  useEffect(() => { keys.current = { copyEntries, pasteOn, undo, dayEntries, byId, shownDays, removeEntry, today, clip }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") || target.closest("[role='dialog'], [role='menu']"))) return;
      const k = keys.current;
      const mod = e.metaKey || e.ctrlKey;
      const focusEntry = target?.closest<HTMLElement>("[data-entry]")?.dataset.entry ?? null;
      const focusDay = target?.closest<HTMLElement>("[data-day]")?.dataset.day ?? null;
      // The last thing used points: the mouse after it moved over the calendar, the focus after Tab or an arrow key.
      if (e.key === "Tab" || e.key.startsWith("Arrow")) hover.current.keys = true;
      const byKeys = hover.current.keys || (!hover.current.day && !hover.current.entry);
      const entryId = byKeys ? focusEntry : hover.current.entry;
      const day = byKeys ? focusDay : hover.current.day;
      if (mod && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        const entry = entryId ? k.byId.get(entryId) : undefined;
        if (entry) { e.preventDefault(); k.copyEntries([entry], `“${entry.name}”`); return; }
        if (day) { e.preventDefault(); const list = k.dayEntries(day); k.copyEntries(list, t("{n} from {day}", { n: list.filter((x) => canCopy(x)).length, day: shortDay(day) })); }
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && day && k.clip) { e.preventDefault(); k.pasteOn(day); return; }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && draftStore.get().length) { e.preventDefault(); k.undo(); return; }
      if (e.key === "Escape") { setClip(null); setMenu(null); setPanelDay(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && entryId) {
        const entry = k.byId.get(entryId);
        if (entry && canRemove(entry, k.today)) { e.preventDefault(); k.removeEntry(entry); }
        return;
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step && focusDay && !focusEntry) {
        const at = k.shownDays.indexOf(focusDay);
        const next = k.shownDays[at + step];
        if (next) { e.preventDefault(); document.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state.status === "loading") return <LoadingPage label={t("Calendar")} />;
  if (state.status === "error") return <LoadError error={state.error} onRetry={state.reload} />;

  /* ───── Navigation ───── */
  const at = (v: View, key: string) => (v === "week" ? `/calendar?week=${key}` : v === "list" ? `/calendar?view=list&month=${key}` : key === monthOf(today) ? "/calendar" : `/calendar?month=${key}`);
  const prev = view === "week" ? at("week", addDays(week, -7)) : at(view, addMonths(month, -1));
  const next = view === "week" ? at("week", addDays(week, 7)) : at(view, addMonths(month, 1));
  const home = view === "week" ? at("week", mondayOf(today)) : at(view, monthOf(today));
  const unit = view === "week" ? "week" : "month";
  const todayShown = shownDays.includes(today) && (view === "week" || monthOf(today) === month);
  const planDay = todayShown ? today : view === "week" ? week : `${month}-01`;

  /* ───── What each day shows ───── */
  const visible = (e: Entry) => passes(e, filter) && !(e.status === "planned" && pairing.doneBy.has(e.id));
  const inView = drafted.filter((e) => shownDays.includes(e.date) && (view === "week" || monthOf(e.date) === month));
  const counts: Record<string, number> = {};
  for (const e of inView) counts[e.sport] = (counts[e.sport] ?? 0) + 1;
  const hiddenCount = inView.filter((e) => !passes(e, filter)).length;
  const planOf = (e: Entry) => (e.status === "done" ? byId.get(pairing.did.get(e.id) ?? "") ?? null : null);

  /* ───── Drag and drop ───── */
  // A planned workout drags to another day (Option copies); a selection or a whole day (its date) drags as a group,
  // keeping its spacing; an activity dropped on a plan, or a plan on an activity, links the two.
  const ours = (ev: DragEvent) => Array.from(ev.dataTransfer.types).includes(DRAG_TYPE);
  const draggedEntries = () => (dragging.current?.ids ?? []).map((id) => byId.get(id)).filter((x): x is Entry => !!x);
  const canDrag = (e: Entry) => !e.pending && (canCopy(e) || canMove(e, today) || e.status === "done");
  const startDrag = (ids: string[], anchor: string, label: string, ev: DragEvent, effect: DataTransfer["effectAllowed"]) => {
    dragging.current = { ids, anchor };
    ev.dataTransfer.setData(DRAG_TYPE, "1");
    ev.dataTransfer.setData("text/plain", label);
    ev.dataTransfer.effectAllowed = effect;
  };
  const endDrag = () => { dragging.current = null; setOverDay(null); setOverEntry(null); stopPaging(); };
  const onDragStart = (e: Entry) => (ev: DragEvent) => {
    if (e.status === "done") { startDrag([e.id], e.date, e.name, ev, "link"); return; }
    const group = selecting && picked.has(e.id) ? [...picked].map((id) => byId.get(id)).filter((x): x is Entry => !!x && x.status === "planned") : [e];
    startDrag(group.map((x) => x.id), e.date, group.length > 1 ? t("{n} workouts", { n: group.length }) : e.name, ev, group.some((x) => canMove(x, today)) ? "all" : "copyLink");
  };
  const onDayDragStart = (day: string) => (ev: DragEvent) => {
    const list = dayEntries(day).filter((x) => x.status === "planned" && canDrag(x));
    if (!list.length) { ev.preventDefault(); return; }
    startDrag(list.map((x) => x.id), day, t("{n} from {day}", { n: list.length, day: shortDay(day) }), ev, list.some((x) => canMove(x, today)) ? "copyMove" : "copy");
  };
  const askCopy = (ev: DragEvent) => ev.altKey || ev.ctrlKey || ev.metaKey;
  const dropProps = (day: string) => ({
    onDragOver: (ev: DragEvent) => {
      const list = draggedEntries().filter((x) => x.status === "planned");
      if (!ours(ev) || !list.length || !canDropOn(day, today)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = askCopy(ev) || list.every((x) => !canMove(x, today)) ? "copy" : "move";
      if (overDay !== day) setOverDay(day);
    },
    onDragLeave: (ev: DragEvent) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) setOverDay((d) => (d === day ? null : d)); },
    onDrop: (ev: DragEvent) => {
      if (!ours(ev)) return;
      ev.preventDefault();
      const list = draggedEntries().filter((x) => x.status === "planned");
      const anchor = dragging.current?.anchor;
      endDrag();
      if (!list.length || !anchor || !canDropOn(day, today)) return;
      const r = dropOnDay(list, anchor, day, today, askCopy(ev), copyKey);
      if (r.ops.length) push(...r.ops);
      const what = list.length === 1 ? `“${list[0].name}”` : t("{n} workouts", { n: r.ops.length });
      const done = r.copied ? t("Copied {what} to {day}.", { what, day: shortDay(day) }) : t("Moved {what} to {day}.", { what, day: shortDay(day) });
      setSay(r.ops.length ? `${done}${r.left ? ` ${t("{n} couldn’t go before today and stayed.", { n: r.left })}` : ""}` : t("Nothing could go there."));
      if (r.ops.length && selecting) { setPicked(new Set()); setSelecting(false); }
    },
  });
  const linkDropProps = (target: Entry) => ({
    onDragOver: (ev: DragEvent) => {
      const list = draggedEntries();
      if (!ours(ev) || list.length !== 1 || !linkPair(list[0], target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "link";
      setOverDay(null);
      if (overEntry !== target.id) setOverEntry(target.id);
    },
    onDragLeave: () => setOverEntry((id) => (id === target.id ? null : id)),
    onDrop: (ev: DragEvent) => {
      const list = draggedEntries();
      const pair = list.length === 1 ? linkPair(list[0], target) : null;
      if (!ours(ev) || !pair) return;
      ev.preventDefault();
      ev.stopPropagation();
      endDrag();
      link(...pair);
    },
  });
  // Resting a drag on ‹ or › turns the page, so a workout can go further than the days on screen.
  const pageOnHold = (href: string) => ({
    onDragEnter: (ev: DragEvent) => {
      if (!ours(ev) || !dragging.current) return;
      stopPaging();
      pageTimer = setTimeout(() => router.replace(href, { scroll: false }), PAGE_HOLD_MS);
    },
    onDragOver: (ev: DragEvent) => { if (ours(ev)) ev.preventDefault(); },
    onDragLeave: stopPaging,
    onDrop: (ev: DragEvent) => { ev.preventDefault(); stopPaging(); },
  });

  /* ───── Refresh ───── */
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (sync.account === "signedIn") await syncNow();
      state.reload();
      setSay(t("Calendar refreshed."));
    } catch (err) {
      setSay(err instanceof Error ? err.message : t("Refresh didn’t work."));
    } finally {
      setRefreshing(false);
    }
  };

  /* ───── Linking done to planned by hand ───── */
  const link = (plan: Entry, done: Entry) => { linkStore.set((l) => withLink(l, plan.id, done.id)); setSay(t("Linked “{done}” to “{plan}”.", { done: done.name, plan: plan.name })); };
  const unlink = (plan: Entry, done: Entry) => { linkStore.set((l) => withoutLink(l, plan.id, done.id)); setSay(t("Unlinked “{done}” from “{plan}”.", { done: done.name, plan: plan.name })); };

  /* ───── Right-click ───── */
  const openMenu = (day: string, entryId: string | null) => (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); setMenu({ x: ev.clientX, y: ev.clientY, day, entryId }); };
  const menuItems = (m: Menu): MenuItem[] => {
    const items: MenuItem[] = [];
    const e = m.entryId ? byId.get(m.entryId) : undefined;
    const list = dayEntries(m.day).filter((x) => canCopy(x));
    if (e) items.push({ label: t("Copy workout"), icon: "copy", onPick: () => copyEntries([e], `“${e.name}”`), disabled: !canCopy(e) });
    items.push({ label: t("Copy day ({n})", { n: list.length }), icon: "copy", onPick: () => copyEntries(list, t("{n} from {day}", { n: list.length, day: shortDay(m.day) })), disabled: !list.length });
    if (clip) items.push({ label: clip.ids.length === 1 ? t("Paste workout") : t("Paste {n} workouts", { n: clip.ids.length }), icon: "paste", onPick: () => pasteOn(m.day), disabled: !canDropOn(m.day, today) });
    if (e && entryHref(e) && !e.pending) items.push({ label: e.status === "done" ? t("Open activity") : t("Edit workout"), onPick: () => router.push(entryHref(e)!) });
    if (e && !e.pending) {
      const partnerId = e.status === "done" ? pairing.did.get(e.id) : pairing.doneBy.get(e.id);
      const partner = partnerId ? byId.get(partnerId) : undefined;
      if (partner) {
        const [plan, done] = e.status === "done" ? [partner, e] : [e, partner];
        items.push({ label: t("Unlink from “{name}”", { name: partner.name }), icon: "unlink", onPick: () => unlink(plan, done) });
      } else {
        for (const o of linkOptions(e, drafted.filter((x) => !x.pending), pairing)) {
          const [plan, done] = e.status === "done" ? [o, e] : [e, o];
          items.push({ label: t("Link to “{name}”, {day}", { name: o.name, day: shortDay(o.date) }), icon: "link", onPick: () => link(plan, done) });
        }
      }
    }
    if (m.day >= today) items.push({ label: t("Add workout"), icon: "plus", onPick: () => router.push(`/calendar/new?date=${m.day}`) });
    if (e && canRemove(e, today)) items.push({ label: t("Remove"), icon: "trash", danger: true, onPick: () => removeEntry(e) });
    return items;
  };

  /* ───── Select ───── */
  const selectable = (e: Entry) => selecting && canRemove(e, today);
  const toggle = (id: string) => { setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setConfirmRemove(false); };
  const removablesInView = inView.filter((e) => visible(e) && canRemove(e, today));
  const pickedLive = [...picked].filter((id) => byId.has(id));

  /* ───── Saving ───── */
  const save = async () => {
    const list = changes;
    setSaveError(null);
    for (let i = 0; i < list.length; i++) {
      setSaving({ done: i, total: list.length });
      try {
        await saveChange(list[i], today);
      } catch (err) {
        draftStore.set(opsFor(list.slice(i)));
        setSaving(null);
        const why = err instanceof Error ? err.message : t("That change didn’t save.");
        setSaveError(i ? t("{n} saved. {why} The rest are still waiting.", { n: i, why }) : t("{why} The rest are still waiting.", { why }));
        state.reload();
        return;
      }
    }
    draftStore.set([]);
    setSaving(null);
    setReview(false);
    setSay(list.length === 1 ? t("1 change saved.") : t("{n} changes saved.", { n: list.length }));
    state.reload();
  };

  /* ───── Day panel ───── */
  const panelItems = (day: string): PanelEntry[] => dayEntries(day).map((e) => ({
    entry: e, plan: planOf(e), percent: e.status === "done" ? pairing.percent.get(e.id) ?? null : null,
    state: e.status === "planned" ? planState(e, pairing, today) : undefined, canMove: canMove(e, today), canCopy: canCopy(e),
  }));

  const chipFor = (e: Entry, tall = false) => (
    <EntryChip key={e.id} entry={e} tall={tall}
      plan={planOf(e)} percent={e.status === "done" ? pairing.percent.get(e.id) ?? null : null}
      state={e.status === "planned" ? planState(e, pairing, today) : undefined}
      draggable={canDrag(e) && (!selecting || picked.has(e.id) || e.status === "done")} copied={!!clip?.ids.includes(e.id)} linkTarget={overEntry === e.id}
      dropProps={linkDropProps(e)}
      selectable={selectable(e)} selected={picked.has(e.id)} onSelect={() => toggle(e.id)}
      onDragStart={onDragStart(e)} onDragEnd={endDrag}
      onHover={(on) => { hover.current.entry = on ? e.id : hover.current.entry === e.id ? null : hover.current.entry; if (on) hover.current.keys = false; }}
      onMenu={openMenu(e.date, e.id)} />
  );

  return (
    <main className="page" style={{ gap: 20 }}>
      <div className="page-head">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <h1>{view === "week" ? weekTitle(week) : monthTitle(month)}</h1>
          <div style={{ display: "flex", gap: 4 }}>
            <LinkButton href={prev} replace scroll={false} aria-label={unit === "week" ? t("Previous week") : t("Previous month")} style={{ width: 36, padding: 0 }} {...pageOnHold(prev)}><Icon name="prev" size={16} /></LinkButton>
            <LinkButton href={next} replace scroll={false} aria-label={unit === "week" ? t("Next week") : t("Next month")} style={{ width: 36, padding: 0 }} {...pageOnHold(next)}><Icon name="next" size={16} /></LinkButton>
            <LinkButton href={home} replace scroll={false}>{t("Today")}</LinkButton>
          </div>
        </div>
        <div className="actions" style={{ gap: 10 }}>
          <OriginBadge origin={state.origin} />
          <Button onClick={() => void refresh()} disabled={refreshing} aria-label={t("Refresh")} title={sync.account === "signedIn" ? t("Sync now and reload") : t("Reload")} style={{ width: 36, padding: 0 }}><Icon name="refresh" /></Button>
          {savedEntries.length > 0 ? <OriginBadge origin="browser" /> : null}
          <Button aria-pressed={showFilters} onClick={() => setShowFilters((s) => !s)}><Icon name="filter" />{t("Filters")}{hiddenCount > 0 ? <span className="cal-count">{hiddenCount}</span> : null}</Button>
          <Button aria-pressed={selecting} onClick={() => { setSelecting((s) => !s); setPicked(new Set()); setConfirmRemove(false); }}>{selecting ? t("Cancel") : t("Select")}</Button>
          <Segmented<View> label={t("View")} value={view}
            options={[{ value: "month", label: t("Month") }, { value: "week", label: t("Week") }, { value: "list", label: t("List") }]}
            onChange={(v) => { if (v !== view) router.replace(v === "week" ? at("week", weekInMonth(month, today)) : at(v, month), { scroll: false }); }} />
          <LinkButton href="/calendar/plans">{t("Plans")}</LinkButton>
          <LinkButton href="/calendar/library">{tx("nav", "Library")}</LinkButton>
          <LinkButton variant="primary" href={`/calendar/new?date=${planDay}`}><Icon name="plus" />{t("Add to calendar")}</LinkButton>
        </div>
      </div>

      {showFilters || hiddenCount > 0 ? <FilterBar filter={filter} counts={counts} hiddenCount={hiddenCount} onChange={(f: Filter) => filterStore.set(f)} /> : null}

      {selecting ? (
        <div className="cal-dock">
          <b style={{ fontSize: 15 }}>{pickedLive.length === 1 ? t("1 selected") : tx("workouts", "{n} selected", { n: pickedLive.length })}</b>
          <span className="muted" style={{ fontSize: 13 }}>{t("Planned workouts from today on")}</span>
          <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button onClick={() => setPicked(new Set(removablesInView.map((e) => e.id)))}>{t("Select all")}</Button>
            <Button onClick={() => setPicked(new Set())} disabled={!pickedLive.length}>{t("Deselect all")}</Button>
            {confirmRemove && pickedLive.length ? (
              <Button className="cal-danger" onClick={() => { push(...pickedLive.map((id): DraftOp => ({ op: "remove", id }))); setSay(t("Removed {n}.", { n: pickedLive.length })); setPicked(new Set()); setConfirmRemove(false); setSelecting(false); }}>{t("Confirm remove")}</Button>
            ) : (
              <Button disabled={!pickedLive.length} onClick={() => setConfirmRemove(true)} style={{ color: "var(--h-rose-ink)" }}><Icon name="trash" />{t("Remove {n}", { n: pickedLive.length })}</Button>
            )}
          </span>
        </div>
      ) : null}

      {changes.length > 0 ? <ChangesDock count={changes.length} onUndo={undo} onDiscard={discard} onReview={() => { setReview(true); setSaveError(null); }} /> : null}
      {saveError && !review ? <div className="notice" role="alert" style={{ color: "var(--h-rose-ink)" }}>{saveError}</div> : null}

      {view === "list" ? (
        <ListView rows={rows} month={month} drafted={drafted} pairing={pairing} weekLoad={weekLoad} today={today} visible={visible} planOf={planOf}
          selectable={selectable} picked={picked} toggle={toggle} hiddenCount={hiddenCount} onMenu={openMenu} />
      ) : (
        <div style={{ position: "relative" }}>
        <div className="card scroll-x">
          <div role="grid" aria-label={view === "week" ? weekTitle(week) : monthTitle(month)} style={{ minWidth: 1060 }}>
            <div role="row" className="muted" style={{ display: "grid", gridTemplateColumns: GRID, fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--line)" }}>
              {weekHeads().map((n, i) => <span role="columnheader" key={i} style={{ padding: "10px 12px" }}>{n}</span>)}
              <span role="columnheader" style={{ padding: "10px 14px", background: "rgba(var(--fg-rgb), 0.03)" }}>{t("Weekly Statistics")}</span>
            </div>
            {rows.map((days) => {
              const n = weekNumbers(drafted, days, pairing, weekLoad.get(days[0]));
              return (
                <div role="row" key={days[0]} style={{ display: "grid", gridTemplateColumns: GRID, borderBottom: "1px solid rgba(var(--fg-rgb), 0.06)" }}>
                  {days.map((day) => {
                    const out = view === "month" && monthOf(day) !== month;
                    const isToday = day === today;
                    const items = dayEntries(day).filter(visible);
                    const all = dayEntries(day);
                    return (
                      <div role="gridcell" key={day} data-day={day} tabIndex={0} className="cal-cell"
                        aria-label={[`${weekdayName(day)} ${dayMonth(day)}`, isToday ? t("today") : "", all.length === 1 ? t("1 entry") : all.length ? t("{n} entries", { n: all.length }) : ""].filter(Boolean).join(", ")}
                        data-over={overDay === day || undefined} data-past={day < today || undefined} data-tall={view === "week" || undefined}
                        onMouseEnter={() => { hover.current.day = day; hover.current.keys = false; }} onMouseLeave={() => { if (hover.current.day === day) hover.current.day = null; }}
                        onContextMenu={openMenu(day, null)}
                        onKeyDown={(ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) { setPanelTop(Math.max(44, ev.currentTarget.closest<HTMLElement>("[role='row']")?.offsetTop ?? 44)); setPanelDay(day); } }}
                        {...dropProps(day)}>
                        <div className="cal-cellhead">
                          <button type="button" className="cal-num" data-today={isToday || undefined}
                            draggable={!selecting && all.some((x) => x.status === "planned" && canDrag(x))} onDragStart={onDayDragStart(day)} onDragEnd={endDrag}
                            title={all.some((x) => x.status === "planned" && canDrag(x)) ? t("Drag to move the day’s workouts. Hold Option to copy.") : undefined} data-out={out || undefined} data-on={panelDay === day || undefined}
                            aria-label={t("Open {day}", { day: `${weekdayName(day)} ${dayMonth(day)}` })}
                            onClick={(ev) => { const row = ev.currentTarget.closest<HTMLElement>("[role='row']"); setPanelTop(Math.max(44, row?.offsetTop ?? 44)); setPanelDay(panelDay === day ? null : day); }}>
                            {Number(day.slice(8))}
                          </button>
                          <span className="cal-hv">
                            {clip && day >= today ? <button type="button" aria-label={t("Paste on {day}", { day: shortDay(day) })} title={t("Paste")} onClick={() => pasteOn(day)}><Icon name="paste" size={13} /></button> : null}
                            {all.some((x) => canCopy(x)) ? <button type="button" aria-label={t("Copy {day}’s workouts", { day: shortDay(day) })} title={t("Copy day’s workouts")} onClick={() => copyEntries(all, t("{n} from {day}", { n: all.filter((x) => canCopy(x)).length, day: shortDay(day) }))}><Icon name="copy" size={13} /></button> : null}
                            <Link href={day < today ? `/calendar/log?date=${day}` : `/calendar/new?date=${day}`} aria-label={day < today ? t("Log activity on {day}", { day: shortDay(day) }) : t("Add workout on {day}", { day: shortDay(day) })} title={day < today ? t("Log activity") : t("Add workout")}><Icon name="plus" size={13} /></Link>
                          </span>
                        </div>
                        {items.map((e) => chipFor(e, view === "week"))}
                        {!all.length && day < today ? <span className="cal-rest">{t("Rest day")}</span> : null}
                      </div>
                    );
                  })}
                  <WeekColumn n={n} now={days.includes(today) ? state.data.now : undefined} weekLabel={dayMonth(days[0])} />
                </div>
              );
            })}
          </div>
        </div>
        {panelDay ? (
          <DayPanel day={panelDay} today={today} items={panelItems(panelDay)} clipboard={clip?.ids.length ?? 0}
            side={(new Date(`${panelDay}T12:00:00`).getDay() + 6) % 7 >= 3 ? "left" : "right"} top={panelTop}
            onClose={() => setPanelDay(null)} onCopy={(e) => copyEntries([e], `“${e.name}”`)}
            onCopyDay={() => { const list = dayEntries(panelDay); copyEntries(list, t("{n} from {day}", { n: list.filter((x) => canCopy(x)).length, day: shortDay(panelDay) })); }}
            onPaste={() => pasteOn(panelDay)} onMove={moveEntry} onRemove={removeEntry} />
        ) : null}
        </div>
      )}

      <Legend />

      <p className="sr-only" role="status" aria-live="polite">{say}</p>
      {say ? <div className="cal-toast" aria-hidden="true" key={say}>{say}</div> : null}


      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} /> : null}
      {review ? <ReviewDialog changes={changes} saving={saving} error={saveError} onClose={() => setReview(false)} onSave={save} onDiscard={discard} /> : null}
    </main>
  );
}

function Legend() {
  return (
    <div className="cal-legend muted">
      <span><i aria-hidden="true" style={{ width: 16, height: 10, borderRadius: 3, background: "rgba(var(--fg-rgb), 0.12)" }} />{tx("status", "Done")}</span>
      <span><i aria-hidden="true" style={{ width: 14, height: 8, borderRadius: 3, border: "1px dashed rgba(var(--fg-rgb), 0.6)" }} />{t("Planned")}</span>
      <span><span className="cal-badge" data-tone="complete">96%</span><span className="cal-badge" data-tone="partial">64%</span><span className="cal-badge" data-tone="missed">{t("Missed")}</span>{t("of plan")}</span>
      <span>{t("Drag to move · Option copies · drag a date for its day · drop an activity on a plan to link")}</span>
    </div>
  );
}

/* ───────────── List view ───────────── */

const LIST_COLS = "34px 96px minmax(0, 2.2fr) minmax(0, 1.4fr) minmax(0, 1.6fr) 128px 24px";

function ListView({ rows, month, drafted, pairing, weekLoad, today, visible, planOf, selectable, picked, toggle, hiddenCount, onMenu }: {
  rows: string[][]; month: string; drafted: Entry[]; pairing: Pairing; weekLoad: ReadonlyMap<string, number | null>; today: string; visible: (e: Entry) => boolean; planOf: (e: Entry) => Entry | null;
  selectable: (e: Entry) => boolean; picked: ReadonlySet<string>; toggle: (id: string) => void; hiddenCount: number;
  onMenu: (day: string, id: string | null) => (ev: MouseEvent) => void;
}) {
  const groups = rows.map((days) => {
    const list = drafted.filter((e) => days.includes(e.date) && monthOf(e.date) === month && visible(e)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { days, list, n: weekNumbers(drafted, days, pairing, weekLoad.get(days[0])) };
  }).filter((g) => g.list.length);
  return (
    <div className="card scroll-x">
      <div role="table" aria-label={t("{month}, list", { month: monthTitle(month) })} style={{ minWidth: 980 }}>
        <div role="row" className="muted cal-lrow cal-lhead" style={{ gridTemplateColumns: LIST_COLS }}>
          <span /><span role="columnheader">{t("Date")}</span><span role="columnheader">{t("Workout")}</span><span role="columnheader">{t("Planned")}</span><span role="columnheader">{tx("status", "Done")}</span><span role="columnheader">{t("Result")}</span><span />
        </div>
        {groups.length === 0 ? <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>{t("Nothing this month.")}</p> : null}
        {groups.map(({ days, list, n }) => (
          <div key={days[0]} role="rowgroup">
            <div role="row" className="cal-lweek">
              <b>{`${dayMonth(days[0])} – ${dayMonth(days[6])}`}</b>
              <span className="muted">{days[0] > today ? t("{n} planned", { n: n.planned }) : n.planned ? t("{done} of {planned} done", { done: n.done, planned: n.planned }) : ""}</span>
              <span style={{ marginLeft: "auto" }} className="muted"><b style={{ color: "var(--h-pink-ink)" }}>{n.load}</b>{n.plannedLoad > 0 ? ` / ${n.plannedLoad} TL` : " TL"}</span>
            </div>
            {list.map((e) => {
              const plan = planOf(e);
              const percent = e.status === "done" ? pairing.percent.get(e.id) ?? null : null;
              const st = e.status === "planned" ? planState(e, pairing, today) : undefined;
              const badge = badgeOf(e, plan, percent, st) ?? (e.status === "done" ? null : { text: t("Planned"), tone: "plain" });
              const href = entryHref(e);
              const planned = e.status === "planned" ? e : plan;
              return (
                <div role="row" key={e.id} className="cal-lrow" data-entry={e.id} style={{ gridTemplateColumns: LIST_COLS }} onContextMenu={onMenu(e.date, e.id)} data-picked={picked.has(e.id) || undefined}>
                  <span role="cell">{selectable(e) ? <input type="checkbox" className="cal-check" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={t("Select {name}, {day}", { name: e.name, day: shortDay(e.date) })} /> : null}</span>
                  <span role="cell" style={{ display: "flex", flexDirection: "column" }}><b style={e.date === today ? { color: "var(--h-mint-ink)" } : undefined}>{dayMonth(e.date)}</b><span style={{ fontSize: 11, color: "var(--dim)" }}>{weekdayName(e.date)}</span></span>
                  <span role="cell" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <i aria-hidden="true" className="cal-dot" style={e.status === "done" ? { background: SPORT_HUE[e.sport] } : { border: `2px solid ${st === "missed" ? "var(--dim)" : SPORT_HUE[e.sport]}` }} />
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      {href && !e.pending ? <Link href={href} style={{ color: "var(--fg)", fontWeight: 700, textDecoration: "none" }}>{e.name}</Link> : <b>{e.name}</b>}
                      <span className="muted" style={{ fontSize: 12 }}>{e.pending ? t("Not saved") : e.source === "browser" ? t("On this computer") : e.source === "coros" ? t("COROS calendar") : e.status === "planned" ? t("Gym routine") : plan ? t("Planned: {what}", { what: plan.name }) : ""}</span>
                    </span>
                  </span>
                  <span role="cell" className="muted">{planned ? `${planned.detail || "—"}${planned.load != null ? ` · ${planned.load} TL` : ""}` : "—"}</span>
                  <span role="cell" style={{ fontWeight: 600 }}>{e.status === "done" ? `${e.detail}${e.load != null ? ` · ${e.load} TL` : ""}` : "—"}</span>
                  <span role="cell">{badge ? <span className="cal-badge" data-tone={badge.tone}>{percent != null ? t("{amount} of plan", { amount: badge.text }) : badge.text}</span> : null}</span>
                  <span role="cell">{href && !e.pending ? <Link href={href} aria-label={t("Open {name}", { name: e.name })} style={{ color: "var(--dim)", display: "flex" }}><Icon name="next" size={15} /></Link> : null}</span>
                </div>
              );
            })}
          </div>
        ))}
        {hiddenCount > 0 ? <p className="muted" style={{ margin: 0, padding: "14px 18px", fontSize: 13 }}>{hiddenCount === 1 ? t("1 entry is hidden by your filters.") : t("{n} entries are hidden by your filters.", { n: hiddenCount })}</p> : null}
      </div>
    </div>
  );
}

