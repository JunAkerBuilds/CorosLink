"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Button, Card, LinkButton, OriginBadge } from "@/components/ui";
import { NotWiredError, useLoaded, type Origin } from "@/data/core";
import type { HubSport } from "@/data/hub";
import { loadAddToCalendar, newStepId, scheduleLibraryWorkout, scheduleWorkout, type AddData, type LibraryRow, type ScheduleResult } from "@/data/workouts";
import { docShape, pacingFor, parseNumber, QUICK_DISTANCES, quickRunDoc, SPORTS } from "@/lib/builder";
import { isDayKey, monthOf, shortDay } from "@/lib/calendar";
import { formatClock, parseClock } from "@/lib/workout";
import "../training.css";

export default function AddToCalendarPage() {
  return (
    <Suspense fallback={<LoadingPage label="Add to calendar" />}>
      <AddScreen />
    </Suspense>
  );
}

function AddScreen() {
  const params = useSearchParams();
  const state = useLoaded(loadAddToCalendar);
  if (state.status === "loading") return <LoadingPage label="Add to calendar" />;
  if (state.status === "error") {
    return <LoadError error={state.error} onRetry={state.reload}><LinkButton href="/calendar">Back to the calendar</LinkButton></LoadError>;
  }
  const asked = params.get("date");
  return <AddToCalendar data={state.data} origin={state.origin} date={isDayKey(asked) ? asked : state.data.today} />;
}

const ICONS = {
  quick: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  structured: "M4 7h10M4 12h16M4 17h7M17 7h3M14 17h6",
  log: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  import: "M12 4v11M8 11l4 4 4-4M5 19h14",
  coach: "M5 5h14v10.5h-8.5L5 20z",
};

function TileHead({ icon, title, sub, children }: { icon: keyof typeof ICONS; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" className="add-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={ICONS[icon]} /></svg>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 className="h2">{title}</h2>
          <span className="muted" style={{ fontSize: 13 }}>{sub}</span>
        </span>
      </span>
      {children}
    </div>
  );
}

const LIBRARY_SPORTS: readonly HubSport[] = ["run", "bike", "swim", "strength"];

function AddToCalendar({ data, origin, date }: { data: AddData; origin: Origin; date: string }) {
  const router = useRouter();
  const { today, toCoros, pacing, library } = data;
  const canPlan = date >= today, canLog = date <= today;
  const backHref = `/calendar?month=${monthOf(date)}`;

  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [planned, setPlanned] = useState(false);
  /** Runs a save: back to the calendar when all of it worked, else says what didn't. */
  const run = (key: string, save: () => Promise<ScheduleResult>) => {
    setBusy(key); setProblem(null);
    save().then((result) => {
      if (!result.libraryProblem) { router.push(backHref); return; }
      setPlanned(true); setBusy(null);
      setProblem(`It is on your calendar for ${shortDay(date)}, but COROS didn't save the library copy: ${result.libraryProblem}`);
    }, (e: unknown) => {
      const text = e instanceof Error ? e.message : "unknown error";
      setProblem(e instanceof NotWiredError || !toCoros ? text : `COROS didn't take it: ${text}`);
      setBusy(null);
    });
  };

  /* Quick training */
  const [name, setName] = useState("Quick Run");
  const [km, setKm] = useState("");
  const [pace, setPace] = useState("");
  const [keep, setKeep] = useState(false);
  const distance = parseNumber(km, 0.1, 1000);
  const paceSeconds = pace.trim() === "" ? null : pace.includes(":") ? parseClock(pace) : null;
  const paceOk = pace.trim() === "" || (paceSeconds !== null && paceSeconds >= 60 && paceSeconds <= 3600);
  const quick = () => {
    if (distance === null || !paceOk) return;
    run("quick", () => scheduleWorkout({ doc: quickRunDoc(name, distance, paceSeconds, newStepId()), date, toCoros, saveToLibrary: keep, pacing }));
  };

  /* From library */
  const [sport, setSport] = useState<HubSport | "all">("all");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return library.filter((w) => (sport === "all" || w.sport === sport) && words.every((word) => `${w.name} ${w.tags.join(" ")}`.toLowerCase().includes(word)));
  }, [library, sport, search]);
  const withLoad = library.some((w) => w.load !== null), withUsed = library.some((w) => w.used !== null);
  const grid = `minmax(240px, 1.7fr) 96px 132px minmax(140px, 1fr)${withLoad ? " 64px" : ""}${withUsed ? " 150px" : ""} 110px`;
  const stopped = busy !== null || planned;

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <nav aria-label="Breadcrumb" className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Link href={backHref} style={{ textDecoration: "none", fontWeight: 600 }}>Calendar</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{shortDay(date)}</span>
            <OriginBadge origin={origin} />
          </nav>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Add to calendar</h1>
        </div>
        <LinkButton href={backHref}>{planned ? "Back to the calendar" : "Cancel"}</LinkButton>
      </div>
      {problem ? <p role="alert" style={{ margin: 0, fontWeight: 600, color: "var(--h-rose-ink)" }}>{problem}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <Card aria-label="Quick training" className="add-tile" style={{ flex: "1 1 480px" }}>
          <TileHead icon="quick" title="Quick training" sub={canPlan ? "One run, by distance" : "For today or later"} />
          {canPlan ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
                <label className="add-label">Workout name
                  <input type="text" className="field" value={name} maxLength={80} placeholder="Quick Run" onChange={(e) => setName(e.target.value)} style={{ width: 170 }} />
                </label>
                <div className="add-label" role="group" aria-label="Distance in kilometres">Distance (km)
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {QUICK_DISTANCES.map((d) => <button key={d} type="button" className="chip" aria-pressed={distance === d} onClick={() => setKm(String(d))}>{d}</button>)}
                    <input type="text" inputMode="decimal" className="field" aria-label="Distance in kilometres" value={km} onChange={(e) => setKm(e.target.value)}
                      aria-invalid={km.trim() !== "" && distance === null ? true : undefined} style={{ width: 64, textAlign: "right" }} />
                  </span>
                </div>
                <label className="add-label">Target pace
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="text" className="field" aria-label="Target pace" placeholder="5:30" value={pace} onChange={(e) => setPace(e.target.value)}
                      onBlur={() => { if (paceSeconds && paceOk) setPace(formatClock(paceSeconds)); }} aria-invalid={paceOk ? undefined : true} style={{ width: 68, textAlign: "center" }} />
                    <span style={{ fontWeight: 500 }}>/km</span>
                  </span>
                </label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: "auto" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 500 }}>
                  <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--h-mint)" }} />
                  Save to workout library
                </label>
                <Button variant="primary" disabled={stopped || distance === null || !paceOk} onClick={quick}>{busy === "quick" ? "Saving…" : "Schedule workout"}</Button>
              </div>
            </>
          ) : null}
        </Card>

        <Card aria-label="Structured" className="add-tile" style={{ flex: "1 1 480px" }}>
          <TileHead icon="structured" title="Structured" sub={canPlan ? "Steps, targets and repeats" : "For today or later"} />
          {canPlan ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SPORTS.map((s) => <LinkButton key={s.sport} href={`/calendar/workout?sport=${s.sport}&date=${date}`} style={{ height: 34 }}>{s.label}</LinkButton>)}
            </div>
          ) : null}
        </Card>

        <Card aria-label="Log activity" className="add-tile" style={{ flex: "1 1 280px" }}>
          <TileHead icon="log" title="Log activity" sub={canLog ? "Today or earlier, added to COROS" : "For today or earlier"} />
          {canLog ? <div style={{ marginTop: "auto" }}><LinkButton variant="primary" href={`/calendar/log?date=${date}`}>Log activity</LinkButton></div> : null}
        </Card>

        <Card aria-label="Import from intervals.icu" className="add-tile" style={{ flex: "1 1 280px" }}>
          <TileHead icon="import" title="Import from intervals.icu" sub="What COROS is missing" />
          <div style={{ marginTop: "auto" }}><LinkButton variant="primary" href="/activities/import">Open import</LinkButton></div>
        </Card>

        <Card aria-label="Ask Coach" className="add-tile" style={{ flex: "1 1 280px" }}>
          <TileHead icon="coach" title="Ask Coach" sub="Coach drafts it, you choose Library or Calendar">
            <Image aria-hidden="true" src="/img/coach-write.webp" alt="" width={64} height={64} style={{ display: "block", margin: "-10px -4px -10px 0", objectFit: "contain" }} />
          </TileHead>
          <div style={{ marginTop: "auto" }}><LinkButton variant="primary" href="/coach">Create a workout</LinkButton></div>
        </Card>
      </div>

      <Card aria-label="From library" className="add-tile">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 className="h2">From library</h2>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span role="group" aria-label="Sport" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="chip" aria-pressed={sport === "all"} onClick={() => setSport("all")}>All</button>
              {SPORTS.filter((s) => LIBRARY_SPORTS.includes(s.sport)).map((s) => (
                <button key={s.sport} type="button" className="chip" aria-pressed={sport === s.sport} onClick={() => setSport(s.sport)}>{s.label}</button>
              ))}
            </span>
            <input type="search" className="field" aria-label="Search workouts and tags" placeholder="Search workouts and tags" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: 210, height: 34, padding: "0 12px", fontSize: 13, fontWeight: 500 }} />
          </div>
        </div>
        <div className="scroll-x">
          <div role="table" aria-label="Saved workouts" style={{ minWidth: withLoad || withUsed ? 1000 : 820 }}>
            <div role="row" className="muted" style={{ display: "grid", gridTemplateColumns: grid, gap: 12, padding: "0 4px 8px", fontSize: 12, fontWeight: 600 }}>
              <span role="columnheader">Workout</span><span role="columnheader">Sport</span><span role="columnheader">Shape</span><span role="columnheader">Total</span>
              {withLoad ? <span role="columnheader">Load</span> : null}{withUsed ? <span role="columnheader">Used</span> : null}
              <span role="columnheader"><span className="sr-only">Schedule</span></span>
            </div>
            {rows.map((w) => (
              <LibraryLine key={w.id} row={w} grid={grid} date={date} withLoad={withLoad} withUsed={withUsed} pacing={pacing}
                busy={busy === w.id} disabled={stopped || !canPlan} onSchedule={() => run(w.id, () => scheduleLibraryWorkout(w, date, toCoros, pacing))} />
            ))}
            {rows.length === 0 ? (
              <p className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", margin: 0, padding: "14px 4px", borderTop: "1px solid var(--line)" }}>
                {data.libraryError ? `Your COROS library couldn't be loaded: ${data.libraryError}` : library.length === 0 ? "No saved workouts yet" : "No saved workout matches"}
                {library.length === 0 && !toCoros ? <LinkButton href="/connect" style={{ height: 32 }}>Sign in to COROS for your workout library</LinkButton> : null}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </main>
  );
}

function LibraryLine({ row, grid, date, withLoad, withUsed, pacing, busy, disabled, onSchedule }: {
  row: LibraryRow; grid: string; date: string; withLoad: boolean; withUsed: boolean; pacing: AddData["pacing"]; busy: boolean; disabled: boolean; onSchedule: () => void;
}) {
  const shape = row.doc && row.sport ? docShape(row.doc, pacingFor(row.sport, pacing)).paths : null;
  return (
    <div role="row" className="lib-row" style={{ gridTemplateColumns: grid }}>
      <span role="cell" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Link href={`/calendar/workout?library=${encodeURIComponent(row.id)}&date=${date}`} style={{ fontWeight: 600, textDecoration: "none", color: "var(--fg)" }}>{row.name}</Link>
        {row.tags.map((tag) => <span key={tag} className="lib-tag">{tag}</span>)}
      </span>
      <span role="cell" className="soft">{row.sportName}</span>
      <span role="cell">
        {shape ? (
          <svg aria-hidden="true" className="wipe-sm" width="120" height="26" viewBox="0 0 500 120" preserveAspectRatio="none" style={{ display: "block" }}>
            <path d={shape.easy} style={{ fill: "var(--h-blue)" }} /><path d={shape.rest} style={{ fill: "rgba(var(--fg-rgb), 0.3)" }} /><path d={shape.hard} style={{ fill: "var(--h-coral)" }} />
          </svg>
        ) : null}
      </span>
      <span role="cell" className="soft">{row.total}</span>
      {withLoad ? <span role="cell" style={{ fontWeight: 600, color: "var(--h-pink-ink)" }}>{row.load ?? ""}</span> : null}
      {withUsed ? <span role="cell" className="muted">{row.used ?? "Not used yet"}</span> : null}
      <span role="cell" style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button style={{ height: 32 }} disabled={disabled} aria-label={`Schedule ${row.name} on ${shortDay(date)}`} onClick={onSchedule}>{busy ? "Saving…" : "Schedule"}</Button>
      </span>
    </div>
  );
}
