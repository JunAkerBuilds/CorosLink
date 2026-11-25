"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Button, Card, LinkButton, OriginBadge } from "@/components/ui";
import { loadActivityLog, logActivity, type LogDay } from "@/data/activityLog";
import { useLoaded, type Origin } from "@/data/core";
import { useHubSession } from "@/data/hub";
import type { CalendarEntry } from "@/data/training";
import { logActivityInput, logSport, visibleLogSports, type LogForm, type LogIcon } from "@/lib/activityLog";
import { monthOf, shortDay } from "@/lib/calendar";
import "../training.css";

export default function LogActivityPage() {
  return (
    <Suspense fallback={<LoadingPage label="Log activity" />}>
      <LogScreen />
    </Suspense>
  );
}

function LogScreen() {
  const asked = useSearchParams().get("date");
  const state = useLoaded(() => loadActivityLog(asked), asked ?? "");
  if (state.status === "loading") return <LoadingPage label="Log activity" />;
  if (state.status === "error") {
    return <LoadError error={state.error} onRetry={state.reload}><LinkButton href="/calendar">Back to the calendar</LinkButton></LoadError>;
  }
  return <LogActivity key={state.data.date} day={state.data} origin={state.origin} />;
}

const ICONS: Record<LogIcon, string> = {
  run: "M3 12h4l3-8 4 16 3-8h4",
  ride: "M6.5 13a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7zM17.5 13a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7zM6.5 16.5L10 8h5l2.5 8.5M10 8l4 8.5",
  walk: "M12 3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM10 21l1.5-6-2-2.5 1-4.5 3 2.5 2.5 1M14.5 21l-1-4",
  hike: "M3 20l6-11 4 6 2.5-4L21 20z",
  swim: "M3 17c2 0 2-1.5 4-1.5S9 17 11 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 2-1.5M5 12l5-3.5 3.5 3M16.5 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z",
  strength: "M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9",
  yoga: "M12 4a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM12 9v6M5 12l7-3 7 3M7 20l5-5 5 5",
  other: "M6 12h.01M12 12h.01M18 12h.01",
};

/** The time field's opening value: an hour ago when logging for today (never before midnight), 07:00 for an earlier day. */
function openingTime(isToday: boolean): string {
  if (!isToday) return "07:00";
  const now = new Date();
  const hour = Math.max(0, now.getHours() - 1);
  return `${String(hour).padStart(2, "0")}:${String(now.getHours() === 0 ? 0 : now.getMinutes()).padStart(2, "0")}`;
}

const HEAD = { fontSize: 13, fontWeight: 700 } as const;
const UNIT = { display: "flex", alignItems: "center", gap: 8, fontWeight: 500 } as const;

function LogActivity({ day, origin }: { day: LogDay; origin: Origin }) {
  const { date, today } = day;
  const hub = useHubSession();
  const signedIn = hub?.state === "signedIn";
  const backHref = `/calendar?month=${monthOf(date)}`;

  const [form, setForm] = useState<LogForm>(() => ({ sportId: "suggested-run", date, time: openingTime(date === today), hours: "", minutes: "", distance: "", calories: "", avgHr: "" }));
  const set = (patch: Partial<LogForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);

  const sport = logSport(form.sportId);
  const sports = visibleLogSports(searching ? search : "", form.sportId);
  const activity = logActivityInput(form);

  const save = () => {
    if (!activity || busy) return;
    setBusy(true); setProblem(null); setLogged(false);
    logActivity(activity).then(() => {
      setLogged(true); setBusy(false);
      // Cleared so the same activity isn't sent twice by a second press.
      setForm((prev) => ({ ...prev, hours: "", minutes: "", distance: "", calories: "", avgHr: "" }));
    }, (e: unknown) => {
      setProblem(e instanceof Error ? e.message : "C-LINK couldn't finish that. Try again.");
      setBusy(false);
    });
  };

  const head = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
        <nav aria-label="Breadcrumb" className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
          <Link href={backHref} style={{ textDecoration: "none", fontWeight: 600 }}>Calendar</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/calendar/new?date=${date}`} style={{ textDecoration: "none", fontWeight: 600 }}>{shortDay(date)}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Log activity</span>
          <OriginBadge origin={origin} />
        </nav>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Log activity</h1>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <LinkButton href={backHref}>{logged ? "Back to the calendar" : "Cancel"}</LinkButton>
      </div>
    </div>
  );

  if (date > today) {
    return (
      <main className="page" style={{ gap: 20, paddingTop: 24 }}>
        {head}
        <div className="notice">
          <span style={{ flex: "1 1 240px" }}>Logging is for today or an earlier day. {shortDay(date)} hasn&apos;t happened yet.</span>
          <LinkButton href={`/calendar/new?date=${date}`}>Plan a workout instead</LinkButton>
          <LinkButton href={`/calendar/log?date=${today}`}>Log for today</LinkButton>
        </div>
      </main>
    );
  }

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      {head}
      {hub && !signedIn ? (
        <div className="notice">
          <span style={{ flex: "1 1 240px" }}>{hub.state === "ended" ? "COROS signed you out. Sign in again to log an activity." : "A logged activity goes to your COROS account. Sign in to COROS first."}</span>
          <LinkButton variant="primary" href="/connect">Sign in to COROS</LinkButton>
        </div>
      ) : null}
      {problem ? <p role="alert" style={{ margin: 0, fontWeight: 600, color: "var(--h-rose-ink)" }}>{problem}</p> : null}
      {logged ? <p role="status" style={{ margin: 0, fontWeight: 600, color: "var(--h-mint-ink)" }}>Activity logged on {shortDay(date)}. COROS may take a moment to show it.</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: "2 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Card aria-label="Activity" style={{ boxSizing: "border-box", padding: 18, display: "flex", flexDirection: "column", gap: 22 }}>
            <div role="group" aria-label="Activity type" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={HEAD}>Activity type</span>
              {searching ? (
                <input type="search" className="field log-field" aria-label="Search activity types" placeholder="Rowing, pilates, indoor bike…" autoFocus value={search}
                  onChange={(e) => setSearch(e.target.value)} disabled={busy} style={{ maxWidth: 320 }} />
              ) : null}
              {sports.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>No activity types match that search.</span> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  {sports.map((option) => (
                    <button key={option.id} type="button" className="log-sport" aria-pressed={option.id === sport.id} disabled={busy} onClick={() => set({ sportId: option.id })}>
                      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ flex: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
                        <path d={ICONS[option.icon]} />
                      </svg>
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" aria-expanded={searching} disabled={busy} onClick={() => { setSearching((open) => !open); setSearch(""); }}
                style={{ alignSelf: "flex-start", height: 32, padding: 0, border: 0, background: "transparent", color: "var(--h-mint-ink)", fontSize: 13, fontWeight: 600 }}>
                {searching ? "Hide search" : "Search all types"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={HEAD}>When and how long</span>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 20 }}>
                <label className="add-label">Started at
                  <input type="time" className="field log-field" value={form.time} onChange={(e) => set({ time: e.target.value })} disabled={busy} />
                </label>
                <div className="add-label" role="group" aria-label="Duration">Duration
                  <span style={UNIT}>
                    <input type="text" inputMode="numeric" className="field log-field" aria-label="Duration hours" placeholder="0" maxLength={2} value={form.hours}
                      onChange={(e) => set({ hours: e.target.value.replace(/\D/g, "") })} disabled={busy} style={{ width: 64, textAlign: "right" }} />h
                    <input type="text" inputMode="numeric" className="field log-field" aria-label="Duration minutes" placeholder="0" maxLength={3} value={form.minutes}
                      onChange={(e) => set({ minutes: e.target.value.replace(/\D/g, "") })} disabled={busy} style={{ width: 64, textAlign: "right" }} />m
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={HEAD}>If you know them</span>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 20 }}>
                {sport.distanceUnit !== "none" ? (
                  <label className="add-label">Distance
                    <span style={UNIT}>
                      <input type="text" inputMode="decimal" className="field log-field" placeholder="—" maxLength={8} value={form.distance} onChange={(e) => set({ distance: e.target.value })}
                        disabled={busy} style={{ width: 96, textAlign: "right" }} />{sport.distanceUnit}
                    </span>
                  </label>
                ) : null}
                <label className="add-label">Calories
                  <span style={UNIT}>
                    <input type="text" inputMode="numeric" className="field log-field" placeholder="—" maxLength={6} value={form.calories} onChange={(e) => set({ calories: e.target.value })}
                      disabled={busy} style={{ width: 96, textAlign: "right" }} />kcal
                  </span>
                </label>
                <label className="add-label">Average heart rate
                  <span style={UNIT}>
                    <input type="text" inputMode="numeric" className="field log-field" placeholder="—" maxLength={3} value={form.avgHr} onChange={(e) => set({ avgHr: e.target.value })}
                      disabled={busy} style={{ width: 96, textAlign: "right" }} />bpm
                  </span>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <span className="muted" style={{ fontSize: 13 }}>{activity || logged ? "Goes straight to your COROS account." : "Add a duration to log this activity."}</span>
              <Button variant="primary" style={{ fontSize: 14, fontWeight: 700 }} disabled={!activity || busy || !signedIn} onClick={save}>{busy ? "Adding…" : "Add to COROS"}</Button>
            </div>
          </Card>
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <Card aria-label={shortDay(date)} style={{ boxSizing: "border-box", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="h2">{shortDay(date)}</h2>
            <DayEntries label="Planned" entries={day.planned} empty="Nothing planned" color="var(--h-blue)" />
            <DayEntries label="Recorded" entries={day.recorded} empty="Nothing yet" color="var(--h-mint)" />
          </Card>
        </div>
      </div>
    </main>
  );
}

function DayEntries({ label, entries, empty, color }: { label: string; entries: CalendarEntry[]; empty: string; color: string }) {
  const lines = entries.length > 0 ? entries.map((entry) => ({ key: entry.id, text: entry.detail ? `${entry.name} · ${entry.detail}` : entry.name, color })) : [{ key: "none", text: empty, color: "rgba(var(--fg-rgb), 0.4)" }];
  return (
    <>
      {lines.map((line) => (
        <div key={line.key} className="log-entry">
          <span aria-hidden="true" style={{ background: line.color }} />
          <span style={{ minWidth: 0 }}>
            <span className="muted" style={{ fontSize: 12 }}>{label}</span><br />
            <span style={{ fontWeight: 600 }}>{line.text}</span>
          </span>
        </div>
      ))}
    </>
  );
}
