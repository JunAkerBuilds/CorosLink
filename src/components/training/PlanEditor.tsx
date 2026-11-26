"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePageCoach, type PageCoach } from "@/components/coach/pageCoach";
import { Icon, ICONS, PhaseRibbon, PlanCalendarDialog, PlanDialog, PlanOverviewChart } from "@/components/training/PlanParts";
import { Button, Card, OriginBadge, Select } from "@/components/ui";
import type { Origin } from "@/data/core";
import { saveTrainingPlan, type PlanEditorData } from "@/data/plans";
import { dayMonth } from "@/lib/calendar";
import { thousands } from "@/lib/format";
import { inferPhases, planOutline } from "@/lib/planGenerate";
import { TYPE_ORDER, WORKOUT_TYPES, workoutType, type WorkoutType } from "@/lib/workoutType";
import {
  addRestDay, addTrainingPlanPhase, addTrainingPlanWeek, calendarBlockedEntries, duplicateTrainingPlanWeek, durationText, entryMeta, holdingEntries, insertRecoveryWeek, installStanding,
  MAX_PLAN_WEEKS, moveTrainingPlanEntry, peakOf, PHASE_KINDS, PHASE_LABELS, phaseForWeek, phaseLabel, planDate, planDay, planDayNames, planSuggestions,
  planToday, planView, removeTrainingPlanEntry, removeTrainingPlanPhase, removeTrainingPlanWeek, reorderTrainingPlanWeek, saveStatus, scheduledWeeks, shiftTrainingPlan,
  summarizeTrainingPlan, trainingPlanEntryMetrics, updateTrainingPlanPhase, validateTrainingPlan, withDerivedSportMix, withPhaseKind,
  type PhaseKind, type PlanCalendarInstall, type PlanDifficulty, type TrainingPlanDocument, type TrainingPlanEntry, type TrainingPlanPhase,
} from "@/lib/plan";
import { msg, t } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";

const DIFFICULTIES: readonly { value: PlanDifficulty; label: string; full: string }[] = [
  { value: "beginner", label: msg("Beginner"), full: msg("Beginner") }, { value: "intermediate", label: msg("Interm."), full: msg("Intermediate") },
  { value: "advanced", label: msg("Advanced"), full: msg("Advanced") }, { value: "custom", label: msg("Custom"), full: msg("Custom") },
];

/** What makes a plan "changed": its content, not when it was touched or where it sits on the calendar. */
const contentOf = (plan: TrainingPlanDocument): string => JSON.stringify({ ...plan, updatedAt: "", syncState: "", calendarInstalls: undefined });

/** What kind of session a workout is (easy, long, tempo, intervals…), so each kind looks different in the weeks. */
const entryType = (entry: TrainingPlanEntry): WorkoutType =>
  workoutType(entry.title, entry.workout?.sport, entry.workout?.doc, trainingPlanEntryMetrics(entry).durationSeconds / 60);

/** A phase's first or last week: typed, and taken when the box is left or Enter is pressed. */
function WeekBox({ label, value, onCommit }: { label: string; value: number; onCommit: (week: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isInteger(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input type="text" inputMode="numeric" className="field" aria-label={label} value={text} onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 2))}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  );
}

export function PlanEditor({ initial, origin, draft }: { initial: PlanEditorData; origin: Origin; draft: boolean }) {
  const router = useRouter();
  const { today, toCoros, pacing, differences } = initial;
  const [history, setHistory] = useState<TrainingPlanDocument[]>(() => [structuredClone(initial.plan)]);
  const [at, setAt] = useState(0);
  /* A generated plan is unsaved work; a new blank plan, or a sample one, has nothing to lose yet. */
  const [savedContent, setSavedContent] = useState(() => (draft ? "" : contentOf(initial.plan)));
  const [neverSaved, setNeverSaved] = useState(initial.neverSaved);
  const [installs, setInstalls] = useState<PlanCalendarInstall[] | undefined>(initial.plan.calendarInstalls);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [confirmWeek, setConfirmWeek] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<"install" | "remove" | null>(null);
  const moveBox = useRef<HTMLButtonElement>(null);

  const edited = history[at];
  const plan = useMemo<TrainingPlanDocument>(() => ({ ...edited, calendarInstalls: installs }), [edited, installs]);
  const dirty = contentOf(edited) !== savedContent;
  const validation = useMemo(() => validateTrainingPlan(plan), [plan]);
  const summary = useMemo(() => summarizeTrainingPlan(plan, pacing), [plan, pacing]);
  const weekly = useMemo(() => scheduledWeeks(plan, pacing), [plan, pacing]);
  const view = useMemo(() => planView(plan, { ...summary, weekly: summary.weekly.map((w, i) => ({ ...w, workouts: weekly[i]?.workouts ?? 0, trainingLoad: weekly[i]?.trainingLoad ?? 0 })) }), [plan, summary, weekly]);
  const suggestions = useMemo(() => [
    ...planSuggestions(plan, pacing),
    ...calendarBlockedEntries(plan, toCoros).map((b) => {
      const vars = { name: b.entry.title ?? t("A workout"), why: b.why };
      return toCoros ? t("{name} can’t go on the COROS calendar: {why}", vars) : t("{name} can’t go on the calendar: {why}", vars);
    }),
  ], [plan, pacing, toCoros]);
  const hasError = validation.some((issue) => issue.severity === "error");
  const status = saveStatus(validation, suggestions, dirty, saving);
  /* The plan's checks, also handed to the side Coach, which can fix them: errors first. */
  const checks = useMemo(() => [
    ...[...validation].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((issue) => ({ text: issue.message, tone: issue.severity === "error" ? "error" as const : "warning" as const })),
    ...suggestions.map((text) => ({ text, tone: "warning" as const })),
  ], [validation, suggestions]);
  const standing = installStanding(plan, today);
  const onCalendar = Boolean(standing.install);
  const now = onCalendar ? planToday(plan, today) : { week: -1, day: -1 };
  const peak = peakOf(weekly);
  const dayNames = planDayNames(plan);
  const held = holdingEntries(plan);
  const pickedEntry = plan.entries.find((entry) => entry.id === picked && entry.kind === "workout");
  const canSave = !saving && !hasError && (dirty || neverSaved);

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  /* Every edit lands in one undo history; nothing is saved until Save plan. */
  const commit = (next: TrainingPlanDocument, message = "") => {
    setHistory((list) => [...list.slice(0, at + 1), withDerivedSportMix({ ...next, calendarInstalls: undefined })]);
    setAt((i) => i + 1);
    setConfirmWeek(null);
    setProblem(null);
    setSaid(message);
  };
  const attempt = (work: () => TrainingPlanDocument, message = "") => {
    try { commit(work(), message); } catch (e) { setProblem(e instanceof Error ? e.message : t("That didn’t work.")); }
  };
  const patch = (change: Partial<TrainingPlanDocument>, message?: string) => commit({ ...edited, ...change }, message);
  const step = (by: number, message: string) => { setAt((i) => Math.max(0, Math.min(history.length - 1, i + by))); setConfirmWeek(null); setPicked(null); setSaid(message); };

  /* The side Coach: what this plan is, what stands out, and "Change plan", which re-lays it as one undoable edit. */
  const latest = useRef({ edited, commit, step });
  useEffect(() => { latest.current = { edited, commit, step }; });
  const coach = useMemo<PageCoach>(() => ({
    title: t("Plan editor"),
    looking: [`“${plan.name || t("Untitled plan")}”`, plan.weekCount === 1 ? t("1 week") : t("{n} weeks", { n: plan.weekCount }),
      summary.workouts === 1 ? t("1 workout") : t("{n} workouts", { n: summary.workouts }), peak.index >= 0 ? t("peak week {n}", { n: peak.index + 1 }) : ""].filter(Boolean).join(" · "),
    about: planOutline(plan),
    findings: checks.map((c) => ({ ...c, fix: `Fix this in the plan: ${c.text}` })),
    asks: [t("Long runs on Sunday"), t("Add a recovery week"), t("Is this plan right for my goal?"), t("Make it a bit easier"), t("What should I watch out for?")],
    plan: {
      plan,
      apply: (next, message) => latest.current.commit(next, message),
      undo: () => latest.current.step(-1, t("Undone")),
    },
  }), [plan, summary.workouts, peak.index, checks]);
  usePageCoach(coach);

  const move = (entryId: string, weekIndex: number, dayIndex?: number) => {
    attempt(() => moveTrainingPlanEntry(edited, entryId, weekIndex, dayIndex), dayIndex === undefined ? t("Moved to the holding area") : t("Moved to week {n}", { n: weekIndex + 1 }));
    setPicked(null);
  };
  const pick = (entryId: string) => {
    setPicked((current) => (current === entryId ? null : entryId));
    // The keyboard path: choosing a workout takes the focus to "Move to".
    requestAnimationFrame(() => moveBox.current?.focus());
  };

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    setProblem(null);
    saveTrainingPlan(plan).then((saved) => {
      setSaving(false);
      setSavedContent(contentOf(edited));
      setNeverSaved(false);
      setSaid(t("Saved “{name}”", { name: saved.name }));
      if (saved.id !== plan.id || neverSaved) router.replace(`/calendar/plans/edit?id=${encodeURIComponent(saved.id)}`, { scroll: false });
    }, (e: unknown) => { setSaving(false); setProblem(e instanceof Error ? e.message : t("The plan couldn’t be saved.")); });
  };
  const leave = (href: string) => { if (dirty) setLeaving(href); else router.push(href); };

  /* Dragging: a plan entry onto a day, or onto the holding area. */
  const drop = (event: DragEvent, weekIndex: number, dayIndex?: number) => {
    event.preventDefault();
    setOver(null);
    setDragging(null);
    const entryId = event.dataTransfer.getData("text/plan-entry");
    if (entryId) { move(entryId, weekIndex, dayIndex); return; }
  };
  const dropZone = (key: string, weekIndex: number, dayIndex?: number) => ({
    "data-over": over === key ? "true" : undefined,
    onDragOver: (event: DragEvent) => { event.preventDefault(); if (over !== key) setOver(key); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current === key ? null : current)); },
    onDrop: (event: DragEvent) => drop(event, weekIndex, dayIndex),
  });

  const entryCard = (entry: TrainingPlanEntry) => {
    const type = entryType(entry), { hue } = WORKOUT_TYPES[type], label = t(WORKOUT_TYPES[type].label);
    return (
      <button key={entry.id} type="button" className="pe-entry" draggable aria-pressed={picked === entry.id} data-dragging={dragging === entry.id ? "true" : undefined}
        data-wtype={type} style={{ "--wt": `var(--h-${hue})`, "--wt-ink": `var(--h-${hue}-ink)` } as React.CSSProperties}
        aria-label={t("{type}: {name}, {meta}. Choose to move or remove", { type: label, name: entry.title ?? t("Workout"), meta: entryMeta(entry, pacing) })}
        onClick={() => pick(entry.id)}
        onDragStart={(event) => { event.dataTransfer.setData("text/plan-entry", entry.id); event.dataTransfer.effectAllowed = "move"; setDragging(entry.id); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}>
        <span className="pe-type">{label}</span>
        <span>{entry.title ?? t("Workout")}</span>
        <span>{entryMeta(entry, pacing)}</span>
      </button>
    );
  };
  /** How many of each kind the plan holds, for the legend over the weeks. */
  const typeCounts = TYPE_ORDER.map((kind) => ({ type: kind, n: plan.entries.filter((e) => e.kind === "workout" && e.dayIndex !== undefined && entryType(e) === kind).length })).filter((x) => x.n);

  const calendarTitle = dirty || neverSaved ? t("Save the plan before changing its calendar installation") : undefined;
  const start = planDate(plan.startDate);

  return (
    <main className="page" style={{ gap: 20, paddingTop: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <nav aria-label={t("Breadcrumb")} className="pl-crumb" style={{ marginBottom: 2 }}>
          <button type="button" onClick={() => leave("/calendar/plans")}>{t("Workout Library")}</button><span aria-hidden="true">/</span>
          <button type="button" onClick={() => leave("/calendar/plans")}>{t("Plans")}</button><span aria-hidden="true">/</span>
          <span aria-current="page">{t("Plan editor")}</span>
          <OriginBadge origin={origin} />
        </nav>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, flex: "1 1 360px", minWidth: 0 }}>
            <input type="text" className="field pe-name" aria-label={t("Plan name")} value={plan.name} maxLength={80} aria-invalid={plan.name.trim() ? undefined : true} onChange={(e) => patch({ name: e.target.value })} />
            {dirty ? <span className="pe-pill" data-tone="dirty">{t("Unsaved changes")}</span> : null}
            {standing.retrying ? <span className="pe-pill" data-tone="bad">{t("Calendar install incomplete · {added} of {total} workouts added", { added: standing.added, total: standing.total })}</span> : null}
            {standing.removing ? <span className="pe-pill" data-tone="bad">{t("Removal incomplete · {n} still on the calendar", { n: standing.added })}</span> : null}
            {standing.differs && !standing.retrying ? <span className="pe-pill" data-tone="dirty">{t("Calendar differs · Remove and add again to apply edits")}</span> : null}
          </div>
          <div className="actions">
            <Button disabled={at === 0} onClick={() => step(-1, t("Undone"))}>{t("Undo")}</Button>
            <Button disabled={at === history.length - 1} onClick={() => step(1, t("Redone"))}>{t("Redo")}</Button>
            {standing.retrying ? (
              <>
                <Button disabled={dirty || saving} title={calendarTitle} onClick={() => setCalendar("install")}>{t("Retry calendar install")}</Button>
                <Button disabled={dirty || saving} title={calendarTitle} onClick={() => setCalendar("remove")}>{t("Remove partial install")}</Button>
              </>
            ) : (
              <Button disabled={dirty || neverSaved || saving} title={calendarTitle} onClick={() => setCalendar(onCalendar ? "remove" : "install")}>{onCalendar ? t("Remove from calendar") : t("Add to calendar")}</Button>
            )}
            <Button variant="primary" disabled={!canSave} aria-busy={saving} onClick={save}>{saving ? t("Saving…") : dirty || neverSaved ? t("Save plan") : t("Saved")}</Button>
          </div>
        </div>
      </div>
      {problem ? <p role="alert" className="pl-bad" style={{ margin: 0, fontWeight: 600 }}>{problem}</p> : null}
      {differences.length ? (
        <div className="notice" role="status" style={{ alignItems: "flex-start" }}>
          <span style={{ fontWeight: 700 }}>{t("Coach’s plan differs from what you asked")}</span>
          <ul style={{ flex: "1 1 100%", margin: 0, paddingLeft: 18 }}>{differences.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">{said}</span>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <div className="pe-rail" style={{ flex: "1 1 290px", maxWidth: 340, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <Card aria-label={t("Details")} className="pl-card" style={{ gap: 12 }}>
            <h2 className="h2">{t("Details")}</h2>
            <label className="pl-label"><span>{t("Goal")}</span>
              <input type="text" className="field" value={plan.goal} maxLength={180} placeholder={t("e.g. Run 10K under 50:00")} onChange={(e) => patch({ goal: e.target.value })} style={{ height: 40, padding: "0 12px" }} />
            </label>
            <div className="pl-label">{t("Difficulty")}
              <div role="group" aria-label={t("Difficulty")} className="pe-seg">
                {DIFFICULTIES.map((d) => <button key={d.value} type="button" aria-pressed={plan.difficulty === d.value} aria-label={t(d.full)} onClick={() => patch({ difficulty: d.value })}>{t(d.label)}</button>)}
              </div>
            </div>
            <label className="pl-label"><span>{t("Plan start date")}</span>
              <input type="date" className="field" value={start ?? ""} style={{ height: 40, padding: "0 12px" }}
                onChange={(e) => { const value = e.target.value; if (value) attempt(() => shiftTrainingPlan(edited, value), t("Plan moved to start {day}", { day: dayMonth(value) })); }} />
            </label>
            <p className="pl-help">{t("Changing it moves every week; workouts keep their weekday.")}</p>
            <label className="pl-label"><span>{t("Description")}</span>
              <textarea className="field pe-text" rows={6} value={plan.description} maxLength={600} placeholder={t("What this block is for and how it builds")} onChange={(e) => patch({ description: e.target.value })} />
            </label>
            <label className="pl-label"><span>{t("Notes")}</span>
              <textarea className="field pe-text" rows={2} value={plan.notes} maxLength={4000} placeholder={t("Private notes for this block")} onChange={(e) => patch({ notes: e.target.value })} />
            </label>
          </Card>

          <Card aria-label={t("Phases")} className="pl-card" style={{ gap: 12 }}>
            <h2 className="h2">{t("Phases")}</h2>
            {plan.phases.length ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {plan.phases.map((phase) => <PhaseRow key={`${phase.id}:${phase.startWeek}:${phase.endWeek}`} phase={phase}
                  onChange={(change, message) => commit(updateTrainingPlanPhase(edited, phase.id, change), message)}
                  onRemove={() => commit(removeTrainingPlanPhase(edited, phase.id), t("Phase removed"))} />)}
              </div>
            ) : null}
            {!plan.phases.length ? <p className="pl-help">{t("Phases colour the weeks: Base, Build, Recovery, Peak and Taper. Auto phases reads them off the weekly load.")}</p> : null}
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <Button style={{ height: 32 }} onClick={() => commit(addTrainingPlanPhase(edited), t("Phase added"))}>+ {t("Add phase")}</Button>
              <Button style={{ height: 32 }} disabled={plan.weekCount < 3 || !summary.workouts} title={plan.weekCount < 3 ? t("A plan needs 3 weeks or more for phases") : undefined}
                onClick={() => { const phases = inferPhases(edited); commit({ ...edited, phases }, phases.length === 1 ? t("1 phase set from the weekly load") : phases.length ? t("{n} phases set from the weekly load", { n: phases.length }) : t("No phases fit this plan")); }}>{plan.phases.length ? t("Redo phases") : t("Auto phases")}</Button>
            </div>
          </Card>
        </div>

        <div style={{ flex: "3.4 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card aria-label={t("Plan overview")} className="pl-card">
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <h2 className="h2">{t("Plan overview")}</h2>
              {peak.index >= 0 ? <span className="muted" style={{ fontSize: 13 }}>{t("Peak week {n} · {load} load", { n: peak.index + 1, load: thousands(peak.load) })}</span> : null}
            </div>
            <PlanOverviewChart bars={view.bars} label={t("{chart}, week 1 to week {n}", { chart: view.chart, n: plan.weekCount })} peak={peak.index}
              onWeek={(i) => document.getElementById(`pe-week-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
            <PhaseRibbon ribbon={view.ribbon} />
            <div className="pe-facts">
              <div className="pl-fig"><span>{t("Workouts")}</span><span>{thousands(summary.workouts)}</span></div>
              <div className="pl-fig"><span>{t("Duration")}</span><span>{summary.durationSeconds ? durationText(summary.durationSeconds) : "—"}</span></div>
              <div className="pl-fig"><span>{t("Distance")}</span><span>{summary.distanceMeters ? `${(summary.distanceMeters / 1000).toFixed(2)} km` : "—"}</span></div>
              <div className="pl-fig"><span>{t("Training load")}</span><span className={summary.trainingLoad ? "pl-load" : undefined}>{summary.trainingLoad ? thousands(summary.trainingLoad) : "—"}</span></div>
              <div className="pl-fig"><span>{t("Rest days")}</span><span>{summary.restDays}</span></div>
              <div className="pl-fig"><span>{t("Peak week")}</span><span>{peak.index >= 0 ? t("Week {n}", { n: peak.index + 1 }) : "—"}</span></div>
            </div>
          </Card>

          <section aria-label={t("Holding area")} className="pe-hold" {...dropZone("holding", 0, undefined)}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t("Holding area")}</span>
            {held.map((entry) => <div key={entry.id} style={{ width: 170, maxWidth: "100%" }}>{entryCard(entry)}</div>)}
            <span className="muted" style={{ fontSize: 13 }}>{held.length ? t("Drag these onto a day to schedule them") : t("Drag a workout here to take it off its day")}</span>
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
            <h2 className="h2">{t("Weeks")}</h2>
            {typeCounts.length ? (
              <div className="pe-legend" aria-label={t("Workout types in this plan")}>
                {typeCounts.map(({ type, n }) => <span key={type} style={{ "--wt": `var(--h-${WORKOUT_TYPES[type].hue})` } as React.CSSProperties}><i aria-hidden="true" />{t(WORKOUT_TYPES[type].label)} {n}</span>)}
              </div>
            ) : null}
            <Button aria-pressed={compact} style={{ height: 32 }} onClick={() => setCompact((v) => !v)}>{compact ? t("Roomy weeks") : t("Compact weeks")}</Button>
          </div>

          {pickedEntry ? (
            <div className="pe-bar" role="group" aria-label={pickedEntry.title ? t("Move {name}", { name: pickedEntry.title }) : t("Move workout")}>
              <span style={{ fontWeight: 700 }}>{pickedEntry.title ?? t("Workout")}</span>
              <Select ref={moveBox} aria-label={pickedEntry.title ? t("Move {name} to", { name: pickedEntry.title }) : t("Move workout to")} value="" style={{ height: 32 }}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === "hold") move(pickedEntry.id, 0, undefined);
                  else if (value) { const [w, d] = value.split(":").map(Number); move(pickedEntry.id, w, d); }
                }}>
                <option value="">{t("Move to…")}</option>
                {pickedEntry.dayIndex !== undefined ? <option value="hold">{t("Holding area")}</option> : null}
                {weekly.map((_w, weekIndex) => (
                  <optgroup key={weekIndex} label={t("Week {n}", { n: weekIndex + 1 })}>
                    {dayNames.map((day, dayIndex) => {
                      const date = planDay(plan, weekIndex * 7 + dayIndex);
                      return <option key={dayIndex} value={`${weekIndex}:${dayIndex}`} disabled={pickedEntry.weekIndex === weekIndex && pickedEntry.dayIndex === dayIndex}>{t("Week {n} · {day}", { n: weekIndex + 1, day: t(day) })}{date ? ` ${dayMonth(date)}` : ""}</option>;
                    })}
                  </optgroup>
                ))}
              </Select>
              <Button onClick={() => { commit(removeTrainingPlanEntry(edited, pickedEntry.id), t("{name} removed", { name: pickedEntry.title ?? t("Workout") })); setPicked(null); }}>{t("Remove from plan")}</Button>
              <Button onClick={() => setPicked(null)}>{t("Done")}</Button>
            </div>
          ) : null}

          <div className="scroll-x">
            <div className={`${compact ? "pe-compact " : ""}${pickedEntry ? "pe-place" : ""}`} style={{ minWidth: 860, display: "flex", flexDirection: "column", gap: 8, padding: 3 }}>
              <div className="pe-week7 pe-days" aria-hidden="true">{dayNames.map((day, i) => <span key={i}>{t(day)}</span>)}</div>
              {weekly.map((week, weekIndex) => {
                const phase = phaseForWeek(plan, weekIndex);
                const scheduled = plan.entries.filter((entry) => entry.weekIndex === weekIndex && entry.dayIndex !== undefined);
                const label = String(weekIndex + 1);
                const first = planDay(plan, weekIndex * 7), last = planDay(plan, weekIndex * 7 + 6);
                return (
                  <section key={weekIndex} id={`pe-week-${weekIndex}`} className="pe-row" aria-label={t("Week {n}", { n: label })} data-now={weekIndex === now.week ? "true" : undefined}>
                    {/* The week's facts sit on one line over its seven days, so the days get the whole width. */}
                    <header className="pe-weekhead">
                      <strong>{t("Week {n}", { n: label })}</strong>
                      <span className="pe-phase-tag" data-phase={phase ? phase.kind ?? "custom" : ""}><span aria-hidden="true" className="pl-dot" data-phase={phase ? phase.kind ?? "custom" : ""} />{phase ? t(phaseLabel(phase)) : t("No phase")}</span>
                      {first && last ? <span className="muted">{dayMonth(first)} – {dayMonth(last)}{weekIndex === now.week ? ` · ${t("This week")}` : ""}</span> : null}
                      <span className="pe-weekfacts">
                        <span>{week.workouts === 1 ? t("1 workout") : t("{n} workouts", { n: week.workouts })}{week.trainingLoad ? <> · {tr("{load} load", { load: <strong className="pl-load">{thousands(week.trainingLoad)}</strong> })}</> : null}</span>
                        {week.trainingLoad ? <span aria-hidden="true" className="pe-weekbar"><i style={{ width: `${Math.round((week.trainingLoad / Math.max(1, peak.load)) * 100)}%` }} data-phase={phase ? phase.kind ?? "custom" : "none"} /></span> : null}
                      </span>
                      <button type="button" className="pe-dots" aria-label={t("Week {n} actions", { n: label })} aria-expanded={openWeek === weekIndex} onClick={() => { setOpenWeek(openWeek === weekIndex ? null : weekIndex); setConfirmWeek(null); }}>
                        <Icon d={ICONS.dots} width={2.6} />
                      </button>
                    </header>
                    <div className="pe-week7">
                      {dayNames.map((day, dayIndex) => {
                        const entries = scheduled.filter((entry) => entry.dayIndex === dayIndex).sort((a, b) => a.sortOrder - b.sortOrder);
                        const rest = entries.find((entry) => entry.kind === "rest");
                        const key = `w${weekIndex}d${dayIndex}`;
                        const here = pickedEntry && !(pickedEntry.weekIndex === weekIndex && pickedEntry.dayIndex === dayIndex);
                        return (
                          <div key={key} className="pe-day" {...dropZone(key, weekIndex, dayIndex)}>
                            {entries.filter((entry) => entry.kind === "workout").map(entryCard)}
                            {rest ? (
                              <span className="pe-rest">{t("Rest day")}
                                <button type="button" className="pe-mini" aria-label={t("Remove rest day, {day} of week {n}", { day: t(day), n: label })} onClick={() => commit(removeTrainingPlanEntry(edited, rest.id), t("Rest day removed"))}><Icon d={ICONS.close} size={12} width={2.2} /></button>
                              </span>
                            ) : null}
                            {here ? (
                              <button type="button" className="pe-here" aria-label={t("Move {name} to {day} of week {n}", { name: pickedEntry.title ?? t("workout"), day: t(day), n: label })} onClick={() => move(pickedEntry.id, weekIndex, dayIndex)}>{t("Move here")}</button>
                            ) : !rest && !pickedEntry ? (
                              <button type="button" className="pe-mini" title={t("Mark as rest day")} aria-label={t("Mark {day} of week {n} as a rest day", { day: t(day), n: label })} onClick={() => attempt(() => addRestDay(edited, weekIndex, dayIndex), t("Rest day added"))}><Icon d={ICONS.moon} size={12} width={2.2} /></button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {openWeek === weekIndex ? (
                      <div className="pe-tools" role="toolbar" aria-label={t("Week {n} actions", { n: label })}>
                        <Button disabled={weekIndex === 0} onClick={() => { attempt(() => reorderTrainingPlanWeek(edited, weekIndex, weekIndex - 1), t("Week {n} moved up", { n: label })); setOpenWeek(weekIndex - 1); }}>{t("Move up")}</Button>
                        <Button disabled={weekIndex === plan.weekCount - 1} onClick={() => { attempt(() => reorderTrainingPlanWeek(edited, weekIndex, weekIndex + 1), t("Week {n} moved down", { n: label })); setOpenWeek(weekIndex + 1); }}>{t("Move down")}</Button>
                        <Button disabled={plan.weekCount >= MAX_PLAN_WEEKS} onClick={() => attempt(() => duplicateTrainingPlanWeek(edited, weekIndex), t("Week {n} duplicated", { n: label }))}>{t("Duplicate week")}</Button>
                        <Button disabled={plan.weekCount >= MAX_PLAN_WEEKS} onClick={() => attempt(() => insertRecoveryWeek(edited, weekIndex), t("Recovery week inserted after week {n}", { n: label }))}>{t("Insert recovery week after")}</Button>
                        {confirmWeek === weekIndex ? (
                          <>
                            <Button variant="ink" onClick={() => { attempt(() => removeTrainingPlanWeek(edited, weekIndex), t("Week {n} deleted", { n: label })); setOpenWeek(null); }}>{scheduled.length === 1 ? t("Delete 1 item?") : t("Delete {n} items?", { n: scheduled.length })}</Button>
                            <Button onClick={() => setConfirmWeek(null)}>{t("Keep")}</Button>
                          </>
                        ) : (
                          <Button disabled={plan.weekCount <= 1} onClick={() => {
                            if (scheduled.length) setConfirmWeek(weekIndex);
                            else { attempt(() => removeTrainingPlanWeek(edited, weekIndex), t("Week {n} deleted", { n: label })); setOpenWeek(null); }
                          }}>{t("Delete week")}</Button>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
          <div><Button style={{ height: 34 }} disabled={plan.weekCount >= MAX_PLAN_WEEKS} onClick={() => attempt(() => addTrainingPlanWeek(edited), t("Week {n} added", { n: plan.weekCount + 1 }))}>+ {t("Add week {n}", { n: plan.weekCount + 1 })}</Button></div>

          <Card aria-label={t("Plan checks")} className="pl-card" style={{ gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h2 className="h2">{t("Plan checks")}</h2>
              <span role="status" className={status.tone === "error" ? "pl-bad" : status.tone === "warning" ? "pl-warn" : "pl-good"} style={{ fontSize: 13, fontWeight: 600 }}>{status.text}</span>
            </div>
            {[...validation].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((issue, i) => (
              <span key={`${issue.path}:${i}`} className={`pe-check ${issue.severity === "error" ? "pl-bad" : "pl-warn"}`}><Icon d={ICONS.warn} size={14} width={2.4} />{issue.message}</span>
            ))}
            {suggestions.map((text) => <span key={text} className="pe-check pl-warn"><Icon d={ICONS.warn} size={14} width={2.4} />{text}</span>)}
          </Card>


        </div>
      </div>

      {leaving ? (
        <PlanDialog title={t("Discard unsaved plan changes?")} onClose={() => setLeaving(null)}
          actions={<>
            <Button data-first onClick={() => setLeaving(null)}>{t("Keep editing")}</Button>
            <Button variant="ink" onClick={() => router.push(leaving)}>{t("Discard and leave")}</Button>
          </>}>
          <p>{at <= 1 ? t("You have 1 unsaved change to this plan. Leaving now throws it away.") : t("You have {n} unsaved changes to this plan. Leaving now throws them away.", { n: at })}</p>
        </PlanDialog>
      ) : null}
      {calendar ? (
        <PlanCalendarDialog plan={plan} operation={calendar} today={today} toCoros={toCoros} onClose={() => setCalendar(null)} onChanged={(next) => setInstalls(next.calendarInstalls)} />
      ) : null}
    </main>
  );
}

function PhaseRow({ phase, onChange, onRemove }: { phase: TrainingPlanPhase; onChange: (change: (phase: TrainingPlanPhase) => TrainingPlanPhase, message?: string) => void; onRemove: () => void }) {
  const kind: PhaseKind = phase.kind ?? "custom";
  const label = t(phaseLabel(phase));
  return (
    <div className="pe-phase">
      <span aria-hidden="true" className="pl-dot" data-phase={kind} />
      <Select field aria-label={t("{phase} phase type", { phase: label })} value={kind} onChange={(e) => onChange((p) => withPhaseKind(p, e.target.value as PhaseKind))}>
        {PHASE_KINDS.map((option) => <option key={option} value={option}>{t(PHASE_LABELS[option])}</option>)}
      </Select>
      <span className="sr-only">{t("Weeks")}</span>
      <WeekBox label={t("{phase} first week", { phase: label })} value={phase.startWeek} onCommit={(startWeek) => onChange((p) => ({ ...p, startWeek, endWeek: Math.max(startWeek, p.endWeek) }))} />
      <span aria-label={t("to")}>–</span>
      <WeekBox label={t("{phase} last week", { phase: label })} value={phase.endWeek} onCommit={(endWeek) => onChange((p) => ({ ...p, endWeek, startWeek: Math.min(p.startWeek, Math.max(1, endWeek)) }))} />
      <button type="button" className="pl-icon" aria-label={t("Remove {phase} phase", { phase: label })} onClick={onRemove}><Icon d={ICONS.close} size={16} width={2} /></button>
    </div>
  );
}
