"use client";
// The Workout Library's Workouts tab: every saved workout as a card, to open, plan on a day, or (when kept in this
// browser) take out of the library. Plans are the other tab.
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LibraryTabs } from "@/components/training/LibraryTabs";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Icon, ICONS, PlanDialog } from "@/components/training/PlanParts";
import { Button, Card, LinkButton, OriginBadge } from "@/components/ui";
import { NotWiredError, useLoaded, type Origin } from "@/data/core";
import type { HubSport } from "@/data/hub";
import { loadAddToCalendar, removeLibraryWorkout, scheduleLibraryWorkout, type AddData, type LibraryRow } from "@/data/workouts";
import { docShape, pacingFor, SPORTS } from "@/lib/builder";
import { monthOf, shortDay } from "@/lib/calendar";
import "../plans/plans.css";
import "../training.css";

export default function WorkoutLibraryPage() {
  const state = useLoaded(loadAddToCalendar);
  if (state.status === "loading") return <LoadingPage label="Workout Library" />;
  if (state.status === "error") return <LoadError error={state.error} onRetry={state.reload}><LinkButton href="/calendar">Back to the calendar</LinkButton></LoadError>;
  return <Library data={state.data} origin={state.origin} reload={state.reload} />;
}

function Library({ data, origin, reload }: { data: AddData; origin: Origin; reload: () => void }) {
  const { library, today, toCoros, pacing } = data;
  const [sport, setSport] = useState<HubSport | "all">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; date: string } | null>(null);
  const [removing, setRemoving] = useState<LibraryRow | null>(null);
  // Only workouts kept in this browser can be taken out here; COROS's library is changed in the COROS app.
  const canRemove = origin === "browser";

  const sports = useMemo(() => SPORTS.filter((s) => library.some((w) => w.sport === s.sport)), [library]);
  const shown = sports.some((s) => s.sport === sport) ? sport : "all";
  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return library.filter((w) => (shown === "all" || w.sport === shown) && words.every((word) => `${w.name} ${w.sportName} ${w.tags.join(" ")}`.toLowerCase().includes(word)));
  }, [library, shown, query]);

  const schedule = (row: LibraryRow, date: string) => {
    setBusy(row.id); setProblem(null); setDone(null);
    scheduleLibraryWorkout(row, date, toCoros, pacing).then((result) => {
      setBusy(null);
      setDone({ id: row.id, date });
      if (result.libraryProblem) setProblem(`It is on your calendar for ${shortDay(date)}, but COROS didn't save the library copy: ${result.libraryProblem}`);
    }, (e: unknown) => {
      setBusy(null);
      const text = e instanceof Error ? e.message : "unknown error";
      setProblem(e instanceof NotWiredError || !toCoros ? text : `COROS didn't take it: ${text}`);
    });
  };

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <OriginBadge origin={origin} />
          <h1 className="pl-h1">Workout Library</h1>
          <LibraryTabs current="workouts" />
        </div>
        <div className="actions">
          <LinkButton href={`/calendar/new?date=${today}`}>Add to calendar</LinkButton>
          <LinkButton variant="primary" href={`/calendar/workout?date=${today}`}>New workout</LinkButton>
        </div>
      </div>
      {problem ? <p role="alert" className="pl-bad" style={{ margin: 0, fontWeight: 600 }}>{problem}</p> : null}

      {library.length > 0 ? <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        {sports.length > 1 ? (
          <div className="pl-chips" role="group" aria-label="Sport">
            <button type="button" className="chip" aria-pressed={shown === "all"} onClick={() => setSport("all")}>All</button>
            {sports.map((s) => <button key={s.sport} type="button" className="chip" aria-pressed={shown === s.sport} onClick={() => setSport(s.sport)}>{s.label}</button>)}
          </div>
        ) : <span />}
        <input type="search" className="field" aria-label="Search workouts and tags" placeholder="Search workouts" value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ width: 220, maxWidth: "100%", height: 34, padding: "0 12px", fontSize: 13, fontWeight: 500 }} />
      </div> : null}

      {rows.length > 0 ? (
        <div className="pl-grid wl-grid">
          {rows.map((row) => (
            <WorkoutTile key={row.id} row={row} today={today} pacing={pacing} busy={busy === row.id} locked={busy !== null}
              done={done?.id === row.id ? done.date : null} canRemove={canRemove}
              onSchedule={(date) => schedule(row, date)} onRemove={() => setRemoving(row)} />
          ))}
        </div>
      ) : (
        <Card className="pl-card pl-empty">
          <Image src={library.length === 0 ? "/img/coach-write.webp" : "/img/coach-search.webp"} alt="" width={88} height={88} style={{ display: "block", objectFit: "contain" }} />
          <h2 className="h2">{data.libraryError ? "Your COROS library couldn't be loaded" : library.length === 0 ? "No saved workouts yet" : "No workout matches"}</h2>
          {data.libraryError ? <p className="muted" style={{ margin: 0 }}>{data.libraryError}</p> : null}
          {library.length === 0 ? (
            <div className="actions" style={{ justifyContent: "center" }}>
              {!toCoros ? <LinkButton href="/connect">Sign in to COROS</LinkButton> : null}
              <LinkButton variant="primary" href={`/calendar/workout?date=${today}`}>New workout</LinkButton>
            </div>
          ) : null}
        </Card>
      )}

      {removing ? (
        <PlanDialog title={`Remove “${removing.name}”?`} onClose={() => setRemoving(null)} busy={false}
          actions={<>
            <Button data-first onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="ink" onClick={() => {
              const id = removing.id;
              setRemoving(null);
              removeLibraryWorkout(id).then(reload, (e: unknown) => setProblem(e instanceof Error ? e.message : "That didn't work."));
            }}>Remove</Button>
          </>}>
          <p>It comes out of the library on this computer. Days it is already planned on stay.</p>
        </PlanDialog>
      ) : null}
    </main>
  );
}

function WorkoutTile({ row, today, pacing, busy, locked, done, canRemove, onSchedule, onRemove }: {
  row: LibraryRow; today: string; pacing: AddData["pacing"]; busy: boolean; locked: boolean; done: string | null; canRemove: boolean;
  onSchedule: (date: string) => void; onRemove: () => void;
}) {
  const [date, setDate] = useState(today);
  const shape = useMemo(() => (row.doc && row.sport ? docShape(row.doc, pacingFor(row.sport, pacing)).paths : null), [row, pacing]);
  const valid = date >= today;
  return (
    <Card aria-label={row.name} className="pl-card">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <Link className="pl-name" href={`/calendar/workout?library=${encodeURIComponent(row.id)}&date=${today}`}>{row.name}</Link>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <span className="pl-badge">{row.sportName}</span>
          {row.tags.map((tag) => <span key={tag} className="lib-tag">{tag}</span>)}
        </span>
      </div>
      <div className="wl-shape">
        {shape ? (
          <svg aria-hidden="true" className="wipe-sm" width="100%" height="44" viewBox="0 0 500 120" preserveAspectRatio="none" style={{ display: "block" }}>
            <path d={shape.easy} style={{ fill: "var(--h-blue)" }} /><path d={shape.rest} style={{ fill: "rgba(var(--fg-rgb), 0.3)" }} /><path d={shape.hard} style={{ fill: "var(--h-coral)" }} />
          </svg>
        ) : <span className="muted" style={{ fontSize: 12 }}>Steps show when it is opened</span>}
      </div>
      <div className="pl-figs">
        <div className="pl-fig"><span>Total</span><span className="wl-total">{row.total || "—"}</span></div>
        <div className="pl-fig"><span>Load</span><span className={row.load !== null ? "pl-load" : undefined}>{row.load ?? "—"}</span></div>
        <div className="pl-fig"><span>Last used</span><span className="wl-used">{row.used ?? "Not yet"}</span></div>
      </div>
      <div className="pl-foot">
        {done ? (
          <span className="pl-good" style={{ fontSize: 13, fontWeight: 600 }}>
            On your calendar for <Link href={`/calendar?month=${monthOf(done)}`}>{shortDay(done)}</Link>
          </span>
        ) : (
          <label className="wl-date">
            <span className="sr-only">Day for {row.name}</span>
            <input type="date" className="field" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {done ? null : <Button disabled={locked || !valid} aria-label={`Schedule ${row.name} on ${valid ? shortDay(date) : "a day from today on"}`} onClick={() => onSchedule(date)}>{busy ? "Saving…" : "Schedule"}</Button>}
          {canRemove ? <Button className="pl-round" disabled={locked} aria-label={`Remove ${row.name} from the library`} onClick={onRemove}><Icon d={ICONS.trash} size={15} /></Button> : null}
        </span>
      </div>
    </Card>
  );
}
