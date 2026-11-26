"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CountUp, LinkButton, OriginBadge, PageHead, Select } from "@/components/ui";
import { hiddenColumnsStore, listActivities, SPORTS, type Activity, type Sport } from "@/data/activities";
import { SAMPLE_TODAY, useLoaded } from "@/data/core";
import { useStore } from "@/data/local/store";
import {
  DATE_RANGES, DEFAULT_FILTERS, DISTANCE_BANDS, dayStrip, filterActivities, filtersToQuery, formatDay, formatDistance, formatElevation, formatPace,
  formatTime, formatTotals, groupByWeek, nextSort, parseFilters, sortActivities, toCsv, totals, weekTitle, type DateRange, type DistanceBand, type Filters, type SortKey,
} from "@/lib/activities";
import { dayKey, thousands } from "@/lib/format";
import { locale, msg, t } from "@/lib/i18n";
import { sportWord } from "./parts";
import "@/app/(app)/activities/activities.css";

const PAGE_SIZE = 25;

const SPORT_HUE: Record<Sport, string> = { Run: "var(--sport-run)", Ride: "var(--sport-ride)", Strength: "var(--sport-strength)", Swim: "var(--sport-swim)", Other: "var(--sport-other)" };

interface Column { key: SortKey; label: string; right?: boolean; fixed?: boolean; cell: (a: Activity) => string | number }

const COLUMNS: Column[] = [
  { key: "date", label: msg("Date"), fixed: true, cell: (a) => formatDay(a.start) },
  { key: "name", label: msg("Activity"), fixed: true, cell: (a) => a.name },
  { key: "sport", label: msg("Sport"), cell: (a) => a.sportName ?? sportWord(a.sport) },
  { key: "distance", label: msg("Distance"), right: true, cell: formatDistance },
  { key: "time", label: msg("Time"), right: true, cell: (a) => (a.durationS > 0 ? formatTime(a.durationS) : "—") },
  { key: "pace", label: msg("Pace / speed"), right: true, cell: formatPace },
  { key: "hr", label: msg("Avg HR"), right: true, cell: (a) => a.avgHr ?? "—" },
  { key: "elevation", label: msg("Elevation"), right: true, cell: (a) => formatElevation(a.elevationGainM) },
  { key: "cadence", label: msg("Cadence"), right: true, cell: (a) => a.cadence ?? "—" },
  { key: "load", label: msg("Load"), right: true, cell: (a) => a.load ?? "—" },
];

const NO_HIDDEN: string[] = [];
/** The load that fills a row's bar and the strip's height: the sample athlete's hardest day. */
const FULL_LOAD = 120;

function Chevron({ up }: { up: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

export function ActivitiesScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useLoaded(listActivities);
  const [filters, setFilters] = useState<Filters>(() => parseFilters(searchParams));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  /** The activity under the pointer, in the strip or the table: each highlights the other. */
  const [hover, setHover] = useState<string | null>(null);
  const hidden = useStore(hiddenColumnsStore, NO_HIDDEN);
  const [now] = useState(() => new Date());
  // The sample athlete lives around its own "today"; a person's own activities are dated from the real one.
  const synced = state.origin === "synced";
  const today = synced ? now : SAMPLE_TODAY;
  const menuRef = useRef<HTMLDivElement>(null);

  // Filters live in the URL so a filtered table can be linked to; replaceState keeps Back leaving the page.
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, page: 1, ...patch };
    setFilters(next);
    const query = filtersToQuery(next);
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const list = state.data;
  const rows = useMemo(
    () => (list ? sortActivities(filterActivities(list, filters, today), filters.sort, filters.dir) : []),
    [list, filters, today],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const picked = rows.filter((a) => selected.has(a.id));
  const sum = totals(rows);
  // The strip always covers the last 30 days; the sport, distance and name filters dim what they leave out.
  const strip = useMemo(() => (list ? dayStrip(list, today) : []), [list, today]);
  const fullLoad = synced ? Math.max(1, strip.reduce((m, d) => Math.max(m, d.load), 0), (list ?? []).reduce((m, a) => Math.max(m, a.load ?? 0), 0)) : FULL_LOAD;
  const kept = useMemo(() => new Set(rows.map((a) => a.id)), [rows]);
  const hovered = hover ? list?.find((a) => a.id === hover) ?? null : null;
  const counts = useMemo(() => {
    const inRange = list ? filterActivities(list, { ...filters, sport: "all" }, today) : [];
    return (sport: Sport | "all") => (sport === "all" ? inRange.length : inRange.filter((a) => a.sport === sport).length);
  }, [list, filters, today]);
  // By date the table is cut into weeks, each under a line with its totals.
  const weeks = filters.sort === "date" ? groupByWeek(rows) : null;
  const firstOfWeek = new Map<string, { title: string; total: string }>();
  if (weeks) for (const w of weeks) firstOfWeek.set(w.rows[0].id, { title: weekTitle(w.key, today), total: formatTotals(w.totals) });
  const columns = COLUMNS.filter((c) => c.fixed || !hidden.includes(c.key));
  const flexible = columns.filter((c) => !c.fixed && c.key !== "sport").length;
  const hasLoad = columns.some((c) => c.key === "load");
  const template = `36px 92px minmax(0, 2.2fr)${columns.some((c) => c.key === "sport") ? " 90px" : ""}${flexible - (hasLoad ? 1 : 0) > 0 ? ` repeat(${flexible - (hasLoad ? 1 : 0)}, minmax(0, 1fr))` : ""}${hasLoad ? " 128px" : ""}`;
  const minWidth = Math.max(420, 1040 - (COLUMNS.length - columns.length) * 86);
  const tail = DATE_RANGES.find((r) => r.value === filters.dates)?.tail ?? "";
  const filtered = filters.q !== "" || filters.sport !== "all" || filters.dates !== DEFAULT_FILTERS.dates || filters.distance !== "any";

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const allPicked = shown.length > 0 && shown.every((a) => selected.has(a.id));
  const somePicked = shown.some((a) => selected.has(a.id));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    for (const a of shown) if (allPicked) next.delete(a.id); else next.add(a.id);
    return next;
  });

  const exportCsv = () => {
    const out = picked.length ? picked : rows;
    const url = URL.createObjectURL(new Blob(["﻿", toCsv(out)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `c-link-activities-${dayKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const open = (a: Activity) => router.push(`/activities/${a.id}`);

  return (
    <main className="page" style={{ gap: 18 }}>
      <PageHead title={t("Activities")}>
        {state.status === "ready" ? <OriginBadge origin={state.origin} /> : null}
        <Button onClick={exportCsv} disabled={rows.length === 0}>{t("Export CSV")}</Button>
        <LinkButton variant="primary" href="/activities/import">{t("Import from intervals.icu")}</LinkButton>
      </PageHead>

      {state.status === "ready" ? (
        <Card aria-label={t("Last 30 days")} className="act-summary-card" onMouseLeave={() => setHover(null)}>
          <div className="act-tiles">
            <div><span>{t("Activities")}</span><CountUp className="num" text={String(sum.count)} /></div>
            <div><span>{t("Distance")}</span><span><CountUp className="num" text={(sum.distanceM / 1000).toFixed(1)} /> <small>km</small></span></div>
            <div><span>{t("Time")}</span><CountUp className="num" text={formatTime(sum.durationS)} /></div>
            <div><span>{t("Load")}</span><CountUp className="num" text={thousands(sum.load)} /></div>
          </div>
          <div className="act-strip-wrap">
            <div className="act-strip-read" role="status" aria-live="polite">
              <strong>{hovered ? formatDay(hovered.start) : t("Last 30 days")}</strong>
              <span className="soft">{hovered ? `${hovered.name} · ${hovered.distanceM ? `${formatDistance(hovered)} · ` : ""}${formatTime(hovered.durationS)}${hovered.load != null ? ` · ${t("Load {n}", { n: hovered.load })}` : ""}` : ""}</span>
            </div>
            <div className="act-strip" role="img" aria-label={t("One bar for each of the last 30 days, as tall as that day's load and coloured by sport")}>
              {strip.map((d, k) => {
                const a = d.activities[0];
                const on = a ? kept.has(a.id) : false;
                return (
                  <div key={k} onMouseEnter={() => setHover(a ? a.id : null)}>
                    <i
                      data-rest={a ? undefined : "true"} data-hover={a && hover === a.id ? "true" : undefined}
                      style={a ? { height: Math.round(10 + Math.min(1, d.load / fullLoad) * 78), background: SPORT_HUE[a.sport], opacity: on ? (hover && hover !== a.id ? 0.45 : 1) : 0.18 } : undefined}
                    />
                    <span>{d.date.toLocaleDateString(locale("en-GB"), { weekday: "narrow" })}</span>
                    <b data-today={k === strip.length - 1 ? "true" : undefined}>{d.date.getDate()}</b>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="act-filters">
        <div role="group" aria-label={t("Sport")} className="act-chips">
          {(["all", ...SPORTS] as const).filter((sp) => sp !== "Other" || filters.sport === "Other" || (state.status === "ready" && counts("Other") > 0)).map((sp) => (
            <button key={sp} type="button" className="act-sport" aria-pressed={filters.sport === sp} onClick={() => update({ sport: sp })}>
              {sp === "all" ? null : <i aria-hidden="true" style={{ background: SPORT_HUE[sp] }} />}
              {sp === "all" ? t("All sports") : sportWord(sp)}
              <span>{state.status === "ready" ? counts(sp) : ""}</span>
            </button>
          ))}
        </div>
        <label className="act-search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", flex: "none" }}>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label={t("Filter by name")} placeholder={t("Filter by name")} value={filters.q} onChange={(e) => update({ q: e.target.value })} />
        </label>
        <Select aria-label={t("Dates")} value={filters.dates} onChange={(e) => update({ dates: e.target.value as DateRange })}>
          {DATE_RANGES.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
        </Select>
        <Select aria-label={t("Distance")} value={filters.distance} onChange={(e) => update({ distance: e.target.value as DistanceBand })}>
          {DISTANCE_BANDS.map((b) => <option key={b.value} value={b.value}>{t(b.label)}</option>)}
        </Select>
        <div ref={menuRef} className="act-columns" style={{ position: "relative" }}>
          <Button aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>{t("Columns")}</Button>
          {menuOpen ? (
            <div className="popover" role="menu" aria-label={t("Columns shown")}>
              {COLUMNS.filter((c) => !c.fixed).map((c) => {
                const on = !hidden.includes(c.key);
                return (
                  <button
                    key={c.key} type="button" role="menuitemcheckbox" aria-checked={on}
                    onClick={() => hiddenColumnsStore.set((prev) => (on ? [...prev, c.key] : prev.filter((k) => k !== c.key)))}
                  >
                    {t(c.label)}<span aria-hidden="true" className="act-menu-check">{on ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {picked.length > 0 ? (
        <div className="act-bulk" role="status">
          <strong>{t("{n} selected", { n: picked.length })}</strong>
          <span>{formatTotals(totals(picked)).split(" · ").slice(1).join(" · ")}</span>
          <div>
            <button type="button" onClick={exportCsv}>{t("Export CSV")}</button>
            <button type="button" onClick={() => setSelected(new Set())}>{t("Clear")}</button>
          </div>
        </div>
      ) : null}

      {state.status === "loading" ? <div className="skeleton" style={{ minHeight: 420 }} aria-busy="true" aria-label={t("Loading activities")} /> : null}
      {state.status === "error" ? (
        <div className="notice" role="alert">
          <span style={{ flex: 1, minWidth: 0 }}>{state.error.message}</span>
          <Button onClick={state.reload}>{t("Try again")}</Button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <Card className="scroll-x">
          <div className="act-table" role="table" aria-label={t("Activities")} aria-rowcount={rows.length + 1} style={{ minWidth }} onMouseLeave={() => setHover(null)}>
            <div className="thead" role="row" style={{ gridTemplateColumns: template, gap: 8, alignItems: "center", minHeight: 40, padding: "4px 16px", borderBottomColor: "rgba(var(--fg-rgb), 0.1)" }}>
              <span role="columnheader" style={{ display: "flex" }}>
                <input
                  type="checkbox" className="act-check" aria-label={t("Select all")} checked={allPicked} disabled={shown.length === 0}
                  ref={(el) => { if (el) el.indeterminate = somePicked && !allPicked; }} onChange={toggleAll}
                />
              </span>
              {columns.map((c) => {
                const active = filters.sort === c.key;
                return (
                  <span key={c.key} role="columnheader" aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"} className={c.right ? "act-right" : undefined} style={{ display: "flex", minWidth: 0 }}>
                    <button type="button" className="sort-btn" style={{ color: active ? "var(--fg)" : undefined, minWidth: 0, lineHeight: 1.2, textAlign: c.right ? "right" : "left" }} onClick={() => update(nextSort(filters, c.key))}>
                      {t(c.label)}{active ? <Chevron up={filters.dir === "asc"} /> : null}
                    </button>
                  </span>
                );
              })}
            </div>

            {shown.map((a) => (
              <Fragment key={a.id}>
              {firstOfWeek.has(a.id) ? (
                <div className="act-week" role="row">
                  <strong role="cell">{firstOfWeek.get(a.id)?.title}</strong>
                  <span role="cell">{firstOfWeek.get(a.id)?.total}</span>
                </div>
              ) : null}
              <div
                className="row" role="row" data-picked={selected.has(a.id)} data-hover={hover === a.id ? "true" : undefined}
                style={{ gridTemplateColumns: template, gap: 8, height: 46, padding: "0 16px", fontSize: 13.5 }}
                onClick={() => open(a)} onMouseEnter={() => setHover(a.id)}
              >
                <span role="cell" style={{ display: "flex" }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="act-check" aria-label={t("Select {name}, {day}", { name: a.name, day: formatDay(a.start) })} checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                </span>
                {columns.map((c) => {
                  if (c.key === "date") return <span key={c.key} role="cell" className="muted">{c.cell(a)}</span>;
                  if (c.key === "name") {
                    return (
                      <span key={c.key} role="cell" style={{ display: "flex", minWidth: 0 }}>
                        <Link className="act-name" href={`/activities/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link>
                      </span>
                    );
                  }
                  if (c.key === "sport") {
                    return (
                      <span key={c.key} role="cell" className="soft" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" style={{ flex: "none" }}>
                          <circle cx="4" cy="4" r="4" style={{ fill: SPORT_HUE[a.sport] }} />
                        </svg>
                        {a.sportName ?? sportWord(a.sport)}
                      </span>
                    );
                  }
                  if (c.key === "load") {
                    return (
                      <span key={c.key} role="cell" className="act-load">
                        <i aria-hidden="true"><b style={{ width: `${Math.min(100, Math.round(((a.load ?? 0) / fullLoad) * 100))}%`, background: SPORT_HUE[a.sport] }} /></i>
                        {a.load ?? "—"}
                      </span>
                    );
                  }
                  return <span key={c.key} role="cell" style={{ textAlign: "right" }}>{c.cell(a)}</span>;
                })}
              </div>
              </Fragment>
            ))}

            {rows.length === 0 ? (
              <div className="act-empty">
                <span>{synced && list?.length === 0 ? t("Nothing from your phone yet.") : t("No activities match these filters.")}</span>
                {filtered ? <Button onClick={() => update({ q: "", sport: "all", dates: DEFAULT_FILTERS.dates, distance: "any" })}>{t("Clear filters")}</Button> : null}
              </div>
            ) : (
              <div className="act-foot">
                <span>{t("{from} to {to} of {total}", { from: (page - 1) * PAGE_SIZE + 1, to: (page - 1) * PAGE_SIZE + shown.length, total: rows.length })}{tail ? ` ${t(tail)}` : ""}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="act-page-btn" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>{t("Previous")}</button>
                  <button type="button" className="act-page-btn" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>{t("Next")}</button>
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
