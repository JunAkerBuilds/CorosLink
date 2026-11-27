"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type DragEvent } from "react";
import { Button, Card, CountUp, LinkButton, OriginBadge, Select } from "@/components/ui";
import { WorkoutShape } from "@/components/viz/WorkoutShape";
import { NotWiredError, useLoaded, type Origin } from "@/data/core";
import type { HubClimbSystem, HubExercise, HubSport, HubStepTarget } from "@/data/hub";
import { loadExerciseList, newStepId, removeWorkout, scheduleWorkout, type BuilderData } from "@/data/workouts";
import {
  allowsRepeats, CUSTOM_ZONE, DEFAULT_NAME, defaultIntensity, defaultPool, defaultTarget, derivedText, DESCRIPTION_MAX, distanceText, docChecks, docReady, docShape,
  docTotals, docUnwired, fitToSport, formatPaceRange, GRADE_SYSTEMS, gradesOf, gradeSystemOf, HEART_BASES, INTENSITY_LABEL, intensitiesFor, isCard, KIND_LABEL,
  kindsFor, listSteps, newRepeat, newStep, OPEN_TEXT, pacingFor, parseNumber, parsePaceRange, PER_SET_LABEL, repeatText, REST_CHIPS, setsText, shapeLabel, SPORTS,
  stepProblem, STROKES, TARGET_LABEL, targetsFor, withGradeSystem, withKind, zonesFor,
  type BuilderDoc, type BuilderIntensity, type BuilderIntensityKind, type BuilderItem, type BuilderKind, type BuilderRepeat, type BuilderStep, type HeartBasis,
} from "@/lib/builder";
import { monthOf, shortDay } from "@/lib/calendar";
import { thousands } from "@/lib/format";
import {
  distanceFromInput, distanceIn, distanceUnit, heightFromInput, heightIn, heightUnit, imperial, speedFromInput, speedIn, speedUnit, swimFromInput, swimIn, swimUnit,
  weightFromInput, weightIn, weightUnit,
} from "@/lib/units";
import { addItem, canMove, formatClock, moveItem, moveNear, moveTo, parseClock, removeItem, setRepeatCount, updateStep, type Pacing } from "@/lib/workout";
import { t, tx } from "@/lib/i18n";

const KIND_BAR: Record<BuilderKind, string> = {
  warmup: "var(--h-blue)", cooldown: "var(--h-blue)", training: "var(--h-coral)", rest: "rgba(var(--fg-rgb), 0.4)", sendOff: "rgba(var(--fg-rgb), 0.4)",
};

type Drop = { id: string; after: boolean } | { block: string } | null;
const sameDrop = (a: Drop, b: Drop) => JSON.stringify(a) === JSON.stringify(b);
type StepPatch = Partial<Omit<BuilderStep, "id" | "type">>;

/** The Structured builder: the steps on the left; the shape, the details and the checks on the right. */
export function WorkoutBuilder({ initial, origin }: { initial: BuilderData; origin: Origin }) {
  const router = useRouter();
  const { date, toCoros, coros, savedId, numbers } = initial;
  const existing = Boolean(coros || savedId);
  const [doc, setDoc] = useState<BuilderDoc>(initial.doc);
  const [keep, setKeep] = useState(!initial.fromLibrary);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const exercises = useLoaded(() => loadExerciseList(doc.sport, toCoros), `${doc.sport}|${toCoros}`);

  // After a keyboard move the row may be rebuilt elsewhere; put the focus back on its grip.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    const id = refocus.current;
    refocus.current = null;
    document.querySelector<HTMLElement>(`[data-item="${id}"] [data-tool="grip"]`)?.focus();
  });

  const { items, sport } = doc;
  const browser = !toCoros;
  const pacing = pacingFor(sport, initial.pacing);
  const checks = docChecks(doc, browser);
  const unwired = toCoros ? docUnwired(doc) : [];
  const numberOf = useMemo(() => new Map(listSteps(items).map((s, k) => [s.id, k + 1])), [items]);
  const backHref = `/calendar?month=${monthOf(date)}`;

  const patchDoc = (p: Partial<BuilderDoc>) => { setProblem(null); setDoc((d) => ({ ...d, ...p })); };
  const edit = (fn: (list: BuilderItem[]) => BuilderItem[]) => { setProblem(null); setDoc((d) => ({ ...d, items: fn(d.items) })); };
  const replaceStep = (next: BuilderStep) => edit((list) => list.map((item) => (item.type === "step" ? (item.id === next.id ? next : item) : { ...item, steps: item.steps.map((s) => (s.id === next.id ? next : s)) })));
  const move = (id: string, dir: -1 | 1) => { refocus.current = id; edit((list) => moveItem(list, id, dir)); };

  /* Drag and drop: a step lands before or after the row it is dropped on, or at the end of a block. */
  const dragProps = (id: string) => ({
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      const row = e.currentTarget.closest("[data-item]");
      if (row) e.dataTransfer.setDragImage(row, 14, 28);
      setDragId(id);
    },
    onDragEnd: () => { setDragId(null); setDrop(null); },
  });
  const overRow = (id: string) => (e: DragEvent<HTMLElement>) => {
    if (!dragId || dragId === id) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const next: Drop = { id, after: e.clientY > r.top + r.height / 2 };
    if (!sameDrop(drop, next)) setDrop(next);
  };
  const overBlock = (id: string) => (e: DragEvent<HTMLElement>) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const next: Drop = { block: id };
    if (!sameDrop(drop, next)) setDrop(next);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    const id = dragId, target = drop;
    setDragId(null); setDrop(null);
    if (!id || !target) return;
    edit((list) => {
      if ("id" in target) return moveNear(list, id, target.id, target.after);
      const block = list.find((i) => i.id === target.block);
      return block?.type === "repeat" ? moveTo(list, id, block.id, block.steps.length) : list;
    });
  };

  const fail = (e: unknown) => {
    const text = e instanceof Error ? e.message : t("unknown error");
    setProblem(e instanceof NotWiredError || !toCoros ? text : t("COROS didn’t take it: {problem}", { problem: text }));
    setBusy(false);
  };
  const save = () => {
    setBusy(true); setProblem(null);
    scheduleWorkout({ doc, date, toCoros, coros, savedId, repeatWeeks: initial.repeatWeeks, saveToLibrary: !existing && keep, pacing: initial.pacing }).then((result) => {
      if (!result.libraryProblem) { router.push(backHref); return; }
      setDone(true); setBusy(false);
      setProblem(t("It is on your calendar for {day}, but COROS didn’t save the library copy: {problem}", { day: shortDay(date), problem: result.libraryProblem }));
    }, fail);
  };
  const remove = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    removeWorkout({ coros, savedId }).then(() => router.push(backHref), fail);
  };

  const rowProps = (step: BuilderStep) => ({
    step, doc, numbers, n: numberOf.get(step.id) ?? 0, browser,
    exercises: exercises.status === "ready" ? exercises.data : [],
    exerciseNote: browser ? null : exercises.status === "loading" ? t("Reading COROS’s exercise library…") : exercises.status === "error" ? t("COROS’s exercise library couldn’t be read: {problem}", { problem: exercises.error.message }) : null,
    dragging: dragId === step.id,
    dropSide: drop && "id" in drop && drop.id === step.id ? (drop.after ? "after" : "before") as "after" | "before" : undefined,
    canUp: canMove(items, step.id, -1), canDown: canMove(items, step.id, 1),
    onChange: (p: StepPatch) => edit((list) => updateStep(list, step.id, p)),
    onReplace: replaceStep,
    onRemove: () => edit((list) => removeItem(list, step.id)),
    onMove: (dir: -1 | 1) => move(step.id, dir),
    grip: dragProps(step.id),
    onDragOver: overRow(step.id), onDrop,
  });
  const row = (step: BuilderStep) => (isCard(step, sport) ? <ExerciseCard key={step.id} {...rowProps(step)} /> : <StepRow key={step.id} {...rowProps(step)} />);
  const addKinds: (BuilderKind | "repeat" | "station")[] = [
    "warmup", "training", ...(sport === "hyrox" ? ["station" as const] : []), ...(allowsRepeats(sport) ? ["repeat" as const] : []), "rest", "cooldown",
    ...(sport === "swim" ? ["sendOff" as const] : []),
  ];
  const add = (kind: BuilderKind | "repeat" | "station") => edit((list) =>
    addItem(list, kind === "repeat" ? newRepeat([newStepId(), newStepId(), newStepId()], doc) : newStep(newStepId(), kind === "station" ? "training" : kind, doc, kind === "station")));

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <nav aria-label={t("Breadcrumb")} className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Link href={backHref} style={{ textDecoration: "none", fontWeight: 600 }}>{t("Calendar")}</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/calendar/new?date=${date}`} style={{ textDecoration: "none", fontWeight: 600 }}>{shortDay(date)}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{t("Structured")}</span>
            <OriginBadge origin={origin} />
          </nav>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
            <h1 className="sr-only">{t("Structured workout")}</h1>
            <input type="text" aria-label={t("Workout name")} placeholder={t(DEFAULT_NAME)} className="field" value={doc.name} maxLength={80} onChange={(e) => patchDoc({ name: e.target.value })}
              style={{ flex: "1 1 280px", minWidth: 0, maxWidth: 460, height: 44, padding: "0 12px", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }} />
            <Select field aria-label={t("Sport")} value={sport} disabled={Boolean(coros)} style={{ height: 44 }}
              onChange={(e) => { setProblem(null); setDoc((d) => fitToSport(d, e.target.value as HubSport, newStepId)); }}>
              {SPORTS.map((s) => <option key={s.sport} value={s.sport}>{t(s.label)}</option>)}
            </Select>
            {sport === "swim" ? (
              <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}>
                {t("Pool length ({unit})", { unit: swimUnit() })}
                <DraftInput inputMode="decimal" value={String(cents(swimIn(doc.poolLength ?? defaultPool())))} style={{ width: 72, height: 44, fontSize: 15, fontWeight: 700, textAlign: "right" }}
                  onCommit={(text) => { const v = parseNumber(text, 1, 1000); if (v !== null) patchDoc({ poolLength: imperial() ? cents(swimFromInput(v)) : v }); return v !== null; }} />
              </label>
            ) : null}
            {doc.gradeSystem ? (
              <Select field aria-label={t("Grade system")} value={gradeSystemOf(doc)} style={{ height: 44 }}
                onChange={(e) => { setProblem(null); setDoc((d) => withGradeSystem(d, e.target.value as HubClimbSystem)); }}>
                {GRADE_SYSTEMS.map((g) => <option key={g.system} value={g.system}>{t(g.label)}</option>)}
              </Select>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {existing ? <Button disabled={busy} onClick={remove} onBlur={() => setConfirmDelete(false)} style={confirmDelete ? { color: "var(--h-rose-ink)" } : undefined}>{confirmDelete ? (coros ? t("Remove from COROS") : t("Delete for good")) : t("Delete")}</Button> : null}
          <LinkButton href={backHref}>{done ? t("Back to the calendar") : t("Cancel")}</LinkButton>
          {done ? null : <Button variant="primary" disabled={busy || !docReady(doc, browser)} onClick={save}>{busy ? t("Saving…") : existing ? t("Save changes") : t("Schedule workout")}</Button>}
        </div>
      </div>
      {problem ? <p role="alert" style={{ margin: 0, fontWeight: 600, color: "var(--h-rose-ink)" }}>{problem}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <section aria-label={tx("workout", "Steps")} style={{ flex: "3 1 700px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {sport === "strength" ? null : (
            <div className="wb-cols wb-head muted" style={{ padding: "0 14px", fontSize: 12, fontWeight: 600 }}>
              <span /><span>{t("Step")}</span><span>{t("Target")}</span><span>{t("Intensity")}</span><span />
            </div>
          )}

          {items.map((item) => item.type === "step" ? row(item) : (
            <BlockBox key={item.id} block={item} total={repeatText(item, doc, pacing)} sport={sport}
              dropHere={drop != null && "block" in drop && drop.block === item.id}
              canUp={canMove(items, item.id, -1)} canDown={canMove(items, item.id, 1)}
              onCount={(n) => edit((list) => setRepeatCount(list, item.id, n))}
              onAdd={(kind) => edit((list) => addItem(list, newStep(newStepId(), kind, doc), item.id))}
              onMove={(dir) => move(item.id, dir)}
              onRemove={() => edit((list) => removeItem(list, item.id))}
              grip={dragProps(item.id)} onDragOver={overBlock(item.id)} onDrop={onDrop}>
              {item.steps.map(row)}
            </BlockBox>
          ))}

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "12px 14px", border: "1px dashed rgba(var(--fg-rgb), 0.24)", borderRadius: 10 }}>
            <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>{t("Add")}</span>
            {addKinds.map((kind) => (
              <Button key={kind} style={{ height: 32 }} onClick={() => add(kind)}>{kind === "repeat" ? t("Repeat") : kind === "station" ? t("Station") : t(KIND_LABEL[kind])}</Button>
            ))}
          </div>
        </section>

        <aside style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <SummaryCard doc={doc} pacing={pacing} />

          <Card aria-label={t("Details")} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="h2">{t("Details")}</h2>
            <label className="muted" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600 }}>
              <span style={{ display: "flex", justifyContent: "space-between" }}><span>{t("Description")}</span><span style={{ fontWeight: 500 }}>{doc.description.length} / {DESCRIPTION_MAX}</span></span>
              <textarea className="field" rows={3} maxLength={DESCRIPTION_MAX} placeholder={t("Add coaching notes or the goal of this workout")} value={doc.description}
                onChange={(e) => patchDoc({ description: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", lineHeight: "20px" }} />
            </label>
            {existing ? null : (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 500 }}>
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--h-mint)" }} />
                {t("Save to library")}
              </label>
            )}
          </Card>

          <Card aria-label={t("Checks")} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="h2">{t("Checks")}</h2>
            <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {checks.filter((c) => !c.ok || unwired.length === 0).map((c) => <CheckLine key={c.text} ok={c.ok} text={c.text} />)}
              {unwired.map((what) => <CheckLine key={what} ok={false} text={t("Can’t go to COROS from here yet: {what}", { what })} />)}
            </div>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function CheckLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, fontWeight: 600, color: ok ? "var(--h-mint-ink)" : "var(--h-amber-soft-ink)" }}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ flex: "none", marginTop: 2, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}>
        <path d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M12 5v8M12 18.5v.5"} />
      </svg>
      {text}
    </span>
  );
}

/** The shape with its four figures, or for strength the count of exercises, sets and reps. */
function SummaryCard({ doc, pacing }: { doc: BuilderDoc; pacing: Pacing | null }) {
  const tot = docTotals(doc, pacing);
  if (doc.sport === "strength") {
    return (
      <Card aria-label={t("Summary")} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 className="h2">{t("Summary")}</h2>
        <div aria-live="polite" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <Figure label={t("Exercises")} value={String(tot.exercises)} /><Figure label={t("Sets")} value={String(tot.sets)} /><Figure label={t("Reps")} value={thousands(tot.reps)} />
        </div>
      </Card>
    );
  }
  const shape = docShape(doc, pacing);
  const duration = tot.seconds === null || tot.seconds <= 0 ? "—" : `${tot.secondsEstimated ? "≈ " : ""}${formatClock(tot.seconds)}`;
  const distance = tot.meters > 0 ? `${tot.metersEstimated ? "≈ " : ""}${distanceText(tot.meters, doc.sport)}` : "—";
  const climb = doc.sport === "indoorClimb" || doc.sport === "bouldering";
  return (
    <Card aria-label={t("Summary")} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 className="h2">{tx("workout", "Shape")}</h2>
      <WorkoutShape paths={shape.paths} label={shapeLabel(doc)} />
      {shape.ticks.length > 0 ? (
        <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          {shape.ticks.map((tick) => <span key={tick}>{tick}</span>)}
        </div>
      ) : null}
      <div aria-live="polite" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 12px", paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        {doc.sport === "swim"
          ? <><Figure label={t("Distance")} value={distance} /><Figure label={t("Rest")} value={formatClock(tot.restSeconds)} /></>
          : <><Figure label={t("Duration")} value={duration} />{climb ? <Figure label={tx("climbing", "Routes")} value={String(tot.routes)} /> : <Figure label={t("Distance")} value={distance} />}</>}
        <Figure label={tx("workout", "Steps")} value={String(tot.steps)} /><Figure label={t("Repeats")} value={String(tot.repeats)} />
      </div>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <CountUp className="num" style={{ fontSize: 20, fontWeight: 700 }} text={value} />
    </div>
  );
}

/** A text box that keeps what is being typed, and hands every readable value on as it changes. */
function DraftInput({ value, onCommit, className, invalid, ...rest }: Omit<ComponentProps<"input">, "value" | "onChange"> & { value: string; invalid?: boolean; onCommit: (text: string) => boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  return (
    <input type="text" {...rest} className={`field wb-field${className ? ` ${className}` : ""}`} value={draft ?? value} aria-invalid={bad || invalid || undefined}
      onFocus={(e) => { setDraft(value); e.currentTarget.select(); }}
      onChange={(e) => { setDraft(e.target.value); setBad(!onCommit(e.target.value)); }}
      onBlur={() => { setDraft(null); setBad(false); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

/** A number box: `value` undefined shows empty and marked as needing a value. */
/** Rounds to the centimetre (or hundredth), the finest COROS keeps. */
const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * A number box. `low`, `high` and `value` are stored (metric) numbers; `shown` and `stored` turn them into what is typed
 * in the athlete's units and back (both rising, so the limits convert with them). `step` is on the typed number.
 */
function NumberBox({ label, value, low, high, step, decimals = 0, width = 64, shown = (v) => v, stored = (v) => v, onChange }: {
  label: string; value: number | undefined; low: number; high: number; step?: number; decimals?: number; width?: number;
  shown?: (stored: number) => number; stored?: (typed: number) => number; onChange: (value: number) => void;
}) {
  return (
    <DraftInput aria-label={label} inputMode="decimal" value={value === undefined ? "" : shown(value).toFixed(decimals)} invalid={value === undefined || value < low || value > high}
      style={{ width, textAlign: "right" }}
      onCommit={(text) => {
        const v = parseNumber(text, shown(low) - 1e-9, shown(high) + 1e-9, step);
        if (v !== null) onChange(Math.min(high, Math.max(low, stored(v))));
        return v !== null;
      }} />
  );
}

const Cross = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

function Grip({ what, canUp, canDown, onMove, grip }: { what: string; canUp: boolean; canDown: boolean; onMove: (dir: -1 | 1) => void; grip: RowProps["grip"] }) {
  return (
    <span role="button" tabIndex={0} className="wb-icon wb-grip" draggable data-tool="grip" {...grip}
      aria-label={t("Reorder {what}: drag, or press the up and down arrow keys", { what })}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" && canUp) { e.preventDefault(); onMove(-1); }
        if (e.key === "ArrowDown" && canDown) { e.preventDefault(); onMove(1); }
      }}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="8" cy="5" r="2" /><circle cx="16" cy="5" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="19" r="2" /><circle cx="16" cy="19" r="2" />
      </svg>
    </span>
  );
}

interface RowProps {
  step: BuilderStep; doc: BuilderDoc; numbers: BuilderData["numbers"]; n: number; browser: boolean;
  exercises: HubExercise[]; exerciseNote: string | null;
  dragging: boolean; dropSide?: "before" | "after"; canUp: boolean; canDown: boolean;
  onChange: (patch: StepPatch) => void;
  onReplace: (step: BuilderStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  grip: { onDragStart: (e: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

/** The kind of a step: the four kinds, Send-off in the pool, and Station for HYROX. */
function KindSelect({ step, doc, n, onReplace }: Pick<RowProps, "step" | "doc" | "n" | "onReplace">) {
  const value = step.station ? "station" : step.kind;
  return (
    <Select field aria-label={t("Step {n} type", { n })} value={value}
      onChange={(e) => onReplace(e.target.value === "station" ? withKind(doc, step, "training", true) : withKind(doc, step, e.target.value as BuilderKind))}>
      {kindsFor(doc.sport).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
      {doc.sport === "hyrox" ? <option value="station">{t("Station")}</option> : null}
    </Select>
  );
}

/** What the step ends on, with its value. */
function TargetFields({ step, doc, n, onChange }: Pick<RowProps, "step" | "doc" | "n" | "onChange">) {
  const sport = doc.sport;
  const pool = sport === "swim";
  return (
    <>
      <Select field aria-label={t("Step {n} target", { n })} value={step.target} style={{ width: 124 }}
        onChange={(e) => onChange(defaultTarget(e.target.value as HubStepTarget, sport, step.kind))}>
        {targetsFor(sport, step).map((tg) => <option key={tg} value={tg}>{tx("target", TARGET_LABEL[tg])}</option>)}
      </Select>
      {step.target === "distance" ? (
        <>
          <DraftInput aria-label={t("Step {n} distance", { n })} inputMode="decimal" invalid={!(step.meters && step.meters > 0)} style={{ width: 64, textAlign: "right" }}
            value={step.meters === undefined ? "" : pool ? String(Math.round(swimIn(step.meters))) : distanceIn(step.meters).toFixed(2)}
            onCommit={(text) => {
              const v = pool ? parseNumber(text, 1, 100_000) : parseNumber(text, 0.01, 1000);
              if (v !== null) onChange({ meters: pool ? (imperial() ? cents(swimFromInput(v)) : Math.round(v)) : Math.round(distanceFromInput(v)) });
              return v !== null;
            }} />
          <span className="muted">{pool ? swimUnit() : distanceUnit()}</span>
        </>
      ) : step.target === "time" ? (
        <DraftInput aria-label={t("Step {n} time", { n })} invalid={!(step.seconds && step.seconds > 0)} value={step.seconds === undefined ? "" : formatClock(step.seconds)} style={{ width: 64, textAlign: "right" }}
          onCommit={(text) => { const s = parseClock(text); const ok = s !== null && s >= 1 && s <= 86_399; if (ok) onChange({ seconds: s }); return ok; }} />
      ) : step.target === "load" ? <NumberBox label={t("Step {n} training load", { n })} value={step.load} low={0} high={999} step={1} onChange={(load) => onChange({ load })} />
        : step.target === "hrRecovery" ? <><NumberBox label={t("Step {n} heart rate to recover to", { n })} value={step.bpm} low={30} high={180} step={1} onChange={(bpm) => onChange({ bpm })} /><span className="muted">bpm</span></>
        : step.target === "elevationGain" ? <><NumberBox label={t("Step {n} elevation gain", { n })} value={step.meters} low={20} high={10_000} step={1} shown={heightIn} stored={(v) => cents(heightFromInput(v))} onChange={(meters) => onChange({ meters })} /><span className="muted">{heightUnit()}</span></>
        : step.target === "reps" ? <NumberBox label={t("Step {n} reps", { n })} value={step.count} low={1} high={500} step={1} onChange={(count) => onChange({ count })} />
        : step.target === "routes" ? <NumberBox label={t("Step {n} routes", { n })} value={step.count} low={1} high={20} step={1} onChange={(count) => onChange({ count })} />
        : <span className="wb-hint">{t(OPEN_TEXT)}</span>}
    </>
  );
}

const RANGE_UNIT: Partial<Record<BuilderIntensityKind, () => string>> = { heartRate: () => "bpm", power: () => "W", speed: speedUnit };
const RANGE_LIMIT: Partial<Record<BuilderIntensityKind, [number, number]>> = { heartRate: [30, 250], power: [1, 2500], speed: [1, 120], cadence: [1, 300] };

/** The values of a target: a range, a zone, a stroke, a weight, a grade. */
function IntensityValues({ step, doc, n, numbers, onChange }: Pick<RowProps, "step" | "doc" | "n" | "numbers" | "onChange">) {
  const i = step.intensity;
  const set = (p: Partial<BuilderIntensity>) => onChange({ intensity: { ...i, ...p } });
  const zoneList = zonesFor(i);
  const derived = derivedText(i, numbers);
  switch (i.kind) {
    case "none": case "bodyweight": return null;
    case "kept": return <span className="wb-hint">{t("Kept as it is in COROS")}</span>;
    case "heartRate": case "power": case "speed": case "cadence": {
      const [low, high] = RANGE_LIMIT[i.kind]!;
      const unit = RANGE_UNIT[i.kind]?.() ?? (doc.sport === "bike" ? "rpm" : "spm");
      const whole = i.kind === "speed" ? undefined : 1;
      const speed = i.kind === "speed" ? { shown: speedIn, stored: (v: number) => cents(speedFromInput(v)) } : {};
      return (
        <>
          <NumberBox label={t("Step {n} {what}, low", { n, what: t(INTENSITY_LABEL[i.kind]) })} value={i.low} low={low} high={high} step={whole} decimals={i.kind === "speed" ? 1 : 0} width={60} {...speed} onChange={(v) => set({ low: v })} />
          <span className="muted">{t("to")}</span>
          <NumberBox label={t("Step {n} {what}, high", { n, what: t(INTENSITY_LABEL[i.kind]) })} value={i.high} low={low} high={high} step={whole} decimals={i.kind === "speed" ? 1 : 0} width={60} {...speed} onChange={(v) => set({ high: v })} />
          <span className="muted">{unit}</span>
        </>
      );
    }
    case "pace": case "effortPace":
      return (
        <>
          <DraftInput aria-label={t("Pace range")} invalid={!(i.low && i.high)} value={i.low && i.high ? formatPaceRange(i.low, i.high) : ""} placeholder={imperial() ? "7:15-7:30/mi" : "4:30-4:40/km"} style={{ width: 132 }}
            onCommit={(text) => { const range = parsePaceRange(text); if (range) set(range); return range !== null; }} />
          <span className="wb-hint">{t("fast to slow")}</span>
        </>
      );
    case "heartRatePercent": case "thresholdPacePercent": case "effortPacePercent": case "ftpPercent":
      return (
        <>
          {i.kind === "heartRatePercent" ? (
            <Select field aria-label={t("Step {n} heart-rate basis", { n })} value={i.basis ?? "maxHr"} style={{ width: 172 }} onChange={(e) => set({ basis: e.target.value as HeartBasis })}>
              {HEART_BASES.map((b) => <option key={b.basis} value={b.basis}>{t(b.label)}</option>)}
            </Select>
          ) : null}
          <Select field aria-label={t("Step {n} zone", { n })} value={i.zone ?? CUSTOM_ZONE} onChange={(e) => set(e.target.value === CUSTOM_ZONE ? { zone: CUSTOM_ZONE } : { zone: e.target.value, low: undefined, high: undefined })}>
            {zoneList.map((z) => <option key={z.key} value={z.key}>{t(z.label)} · {z.low}-{z.high}%</option>)}
            <option value={CUSTOM_ZONE}>{t("Custom range")}</option>
          </Select>
          {i.zone === CUSTOM_ZONE ? (
            <>
              <NumberBox label={t("Step {n} lowest percent", { n })} value={i.low} low={0} high={300} step={1} width={56} onChange={(v) => set({ low: v })} />
              <span className="muted">{t("to")}</span>
              <NumberBox label={t("Step {n} highest percent", { n })} value={i.high} low={1} high={300} step={1} width={56} onChange={(v) => set({ high: v })} />
              <span className="muted">%</span>
            </>
          ) : null}
          {derived ? <span className="wb-hint">{t("Derived: {value}", { value: derived })}</span> : null}
        </>
      );
    case "stroke":
      return (
        <Select field aria-label={t("Step {n} stroke", { n })} value={i.stroke ?? "freestyle"} onChange={(e) => set({ stroke: e.target.value as NonNullable<BuilderIntensity["stroke"]> })}>
          {STROKES.map((s) => <option key={s.stroke} value={s.stroke}>{t(s.label)}</option>)}
        </Select>
      );
    case "weight":
      return <><NumberBox label={t("Step {n} weight", { n })} value={i.low} low={0} high={2000} step={0.5} decimals={1} width={68} shown={weightIn} stored={(v) => (imperial() ? Math.round(weightFromInput(v) * 1000) / 1000 : v)} onChange={(v) => set({ low: v })} /><span className="muted">{weightUnit()}</span></>;
    case "rpe":
      return <NumberBox label={t("Step {n} RPE", { n })} value={i.low} low={1} high={10} step={1} width={56} onChange={(v) => set({ low: v })} />;
    case "grade":
      return (
        <Select field aria-label={t("Step {n} grade", { n })} value={i.gradeOffset !== undefined ? "offset" : i.grade ?? ""} onChange={(e) => set({ grade: e.target.value, gradeOffset: undefined })}>
          {i.gradeOffset !== undefined ? <option value="offset">{t("Onsight")} {i.gradeOffset > 0 ? "+" : i.gradeOffset < 0 ? "−" : ""}{Math.abs(i.gradeOffset) || ""}</option> : null}
          {gradesOf(doc).map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
      );
  }
}

/** The kind of target. `labels` renames a few for the exercise card ("Added weight"). */
function IntensitySelect({ step, doc, label, labels, style, onChange }: Pick<RowProps, "step" | "doc" | "onChange"> & { label: string; labels?: Partial<Record<BuilderIntensityKind, string>>; style?: React.CSSProperties }) {
  const kinds = intensitiesFor(doc.sport, step);
  return (
    <Select field aria-label={label} value={step.intensity.kind} style={style} disabled={kinds.length < 2 && step.intensity.kind !== "kept"}
      onChange={(e) => onChange({ intensity: defaultIntensity(e.target.value as BuilderIntensityKind, doc) })}>
      {step.intensity.kind === "kept" ? <option value="kept">{t(INTENSITY_LABEL.kept)}</option> : null}
      {kinds.map((k) => <option key={k} value={k}>{labels?.[k] ?? t(INTENSITY_LABEL[k])}</option>)}
    </Select>
  );
}

function StepRow(props: RowProps) {
  const { step, doc, n, numbers, dragging, dropSide, canUp, canDown, onChange, onRemove, onMove, grip, onDragOver, onDrop } = props;
  const lower = t(KIND_LABEL[step.kind]).toLowerCase();
  const issue = stepProblem(doc, step, props.browser);
  return (
    <div className="wb-cols wb-step" data-item={step.id} data-dragging={dragging} data-drop={dropSide} data-problem={issue ? true : undefined} title={issue ?? undefined} onDragOver={onDragOver} onDrop={onDrop}>
      <Grip what={lower} canUp={canUp} canDown={canDown} onMove={onMove} grip={grip} />
      <span className="wb-kind"><i aria-hidden="true" style={{ background: KIND_BAR[step.kind] }} /><KindSelect {...props} /></span>
      <span className="wb-cell wb-target"><TargetFields {...props} /></span>
      <span className="wb-cell wb-effort">
        <IntensitySelect step={step} doc={doc} label={t("Step {n} intensity", { n })} onChange={onChange} />
        <IntensityValues step={step} doc={doc} n={n} numbers={numbers} onChange={onChange} />
        {step.kind === "sendOff" ? (
          <>
            <span className="muted">{t("Leave every")}</span>
            <DraftInput aria-label={t("Step {n} send-off time", { n })} value={step.sendOffSeconds === undefined ? "" : formatClock(step.sendOffSeconds)} invalid={!step.sendOffSeconds} style={{ width: 64, textAlign: "right" }}
              onCommit={(text) => { const s = parseClock(text); const ok = s !== null && s >= 1 && s <= 3600; if (ok) onChange({ sendOffSeconds: s }); return ok; }} />
          </>
        ) : null}
      </span>
      <button type="button" className="wb-icon wb-remove" aria-label={t("Remove step {n}", { n })} onClick={onRemove}><Cross /></button>
    </div>
  );
}

/** A strength exercise or a HYROX station: its name from COROS's list, then sets × per set @ load, and the rest between sets. */
function ExerciseCard(props: RowProps) {
  const { step, doc, n, numbers, browser, exercises, exerciseNote, dragging, dropSide, canUp, canDown, onChange, onRemove, onMove, grip, onDragOver, onDrop } = props;
  const station = doc.sport === "hyrox";
  const options = station ? exercises.filter((e) => (e.kind ?? 0) > 0) : exercises;
  const targets = targetsFor(doc.sport, step);
  const rest = step.restSeconds ?? 60;
  const named = Boolean(step.exercise || (browser && step.name?.trim()) || step.coros);
  const issue = stepProblem(doc, step, browser);
  return (
    <div className="wb-card" data-item={step.id} data-dragging={dragging} data-drop={dropSide} data-problem={issue ? true : undefined} title={issue ?? undefined} onDragOver={onDragOver} onDrop={onDrop}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <Grip what={station ? t("station") : t("exercise")} canUp={canUp} canDown={canDown} onMove={onMove} grip={grip} />
        <i aria-hidden="true" style={{ flex: "0 0 4px", width: 4, height: 24, borderRadius: 2, background: KIND_BAR.training }} />
        <KindSelect {...props} />
        <ExerciseBox label={t("Movement {n}", { n })} step={step} options={options} invalid={!named}
          placeholder={browser ? (station ? t("Name the station") : t("Name the exercise")) : station ? t("Search COROS’s HYROX stations") : t("Search the COROS exercise library")}
          onPick={(exercise) => {
            // A station's own kind decides what a set can be counted in and what load it takes.
            let next: BuilderStep = { ...step, exercise, name: undefined };
            if (!targetsFor(doc.sport, next).includes(next.target)) next = { ...next, ...defaultTarget(targetsFor(doc.sport, next)[0], doc.sport, "training") };
            const loads = intensitiesFor(doc.sport, next);
            if (next.intensity.kind !== "kept" && !loads.includes(next.intensity.kind)) next = { ...next, intensity: defaultIntensity(loads[0], doc) };
            props.onReplace(next);
          }}
          onType={(name) => onChange({ name, exercise: undefined })} />
        <button type="button" className="wb-icon wb-remove" aria-label={t("Remove step {n}", { n })} onClick={onRemove}><Cross /></button>
      </div>
      {exerciseNote ? <p className="wb-hint" role="status" style={{ margin: 0, paddingLeft: 38 }}>{exerciseNote}</p> : null}
      <div className="wb-sub" style={{ alignItems: "flex-end" }}>
        <label className="wb-label">{t("Sets")}<span><NumberBox label={t("Step {n} sets", { n })} value={step.sets ?? 1} low={1} high={99} step={1} width={60} onChange={(sets) => onChange({ sets })} /></span></label>
        <span aria-hidden="true" className="muted" style={{ height: 36, lineHeight: "36px" }}>×</span>
        <div className="wb-label">{t("Per set")}
          <span>
            {step.target === "reps" ? <NumberBox label={t("Step {n} reps per set", { n })} value={step.count} low={1} high={500} step={1} width={60} onChange={(count) => onChange({ count })} />
              : step.target === "time" ? <NumberBox label={t("Step {n} seconds per set", { n })} value={step.seconds} low={1} high={86_399} step={1} width={60} onChange={(seconds) => onChange({ seconds })} />
              : step.target === "distance" ? <NumberBox label={t("Step {n} metres per set", { n })} value={step.meters} low={1} high={100_000} step={1} width={68} onChange={(meters) => onChange({ meters })} />
              : null}
            <Select field aria-label={t("Step {n} per set", { n })} value={step.target} onChange={(e) => onChange(defaultTarget(e.target.value as HubStepTarget, doc.sport, "training"))}>
              {targets.map((tg) => <option key={tg} value={tg}>{tx("target", PER_SET_LABEL[tg] ?? TARGET_LABEL[tg])}</option>)}
            </Select>
          </span>
        </div>
        <span aria-hidden="true" className="muted" style={{ height: 36, lineHeight: "36px" }}>@</span>
        <div className="wb-label">{t("Load")}
          <span>
            <IntensitySelect step={step} doc={doc} label={t("Step {n} load", { n })} labels={{ weight: t("Added weight") }} onChange={onChange} />
            <IntensityValues step={step} doc={doc} n={n} numbers={numbers} onChange={onChange} />
          </span>
        </div>
      </div>
      <div className="wb-sub" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <span className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
          <span style={{ marginRight: 4 }}>{t("Rest between sets")}</span>
          {REST_CHIPS.map((s) => <button key={s} type="button" className="chip" aria-pressed={rest === s} onClick={() => onChange({ restSeconds: s })}>{formatClock(s)}</button>)}
          <NumberBox label={t("Step {n} rest between sets, seconds", { n })} value={rest} low={0} high={3600} step={1} onChange={(restSeconds) => onChange({ restSeconds })} />
          <span style={{ fontWeight: 500 }}>{t("sec")}</span>
        </span>
        <span className="wb-hint">{setsText(step)}</span>
      </div>
    </div>
  );
}

/** Search box over COROS's exercise list. Typing clears the pick; without a list the typed name is the exercise. */
function ExerciseBox({ label, step, options, placeholder, invalid, onPick, onType }: {
  label: string; step: BuilderStep; options: HubExercise[]; placeholder: string; invalid: boolean;
  onPick: (exercise: HubExercise) => void; onType: (name: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const text = step.exercise?.name ?? step.name ?? "";
  const matches = useMemo(() => {
    const words = (step.exercise ? "" : text).toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => o.name.toLowerCase().includes(w))).slice(0, 40);
  }, [options, text, step.exercise]);
  const shown = open && options.length > 0;
  const pick = (exercise: HubExercise) => { onPick(exercise); setOpen(false); };
  return (
    <span className="wb-combo" data-invalid={invalid}>
      <i aria-hidden="true" />
      <input type="text" role="combobox" aria-label={label} aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
        aria-activedescendant={shown && matches[active] ? `${listId}-${active}` : undefined} aria-invalid={invalid || undefined}
        placeholder={placeholder} value={text} maxLength={60}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(e) => { onType(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(matches.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && shown && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {shown ? (
        <ul id={listId} role="listbox" aria-label={label} className="wb-pop">
          {matches.length === 0 ? <li role="option" aria-selected="false" aria-disabled="true">{t("Nothing in COROS’s list matches")}</li> : null}
          {matches.map((o, k) => (
            <li key={o.id} id={`${listId}-${k}`} role="option" aria-selected={k === active} onMouseEnter={() => setActive(k)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o.name}</li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

function BlockBox({ block, total, sport, dropHere, canUp, canDown, onCount, onAdd, onMove, onRemove, grip, onDragOver, onDrop, children }: {
  block: BuilderRepeat; total: string; sport: HubSport; dropHere: boolean; canUp: boolean; canDown: boolean;
  onCount: (n: number) => void; onAdd: (kind: BuilderKind) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
  grip: RowProps["grip"]; onDragOver: (e: DragEvent<HTMLElement>) => void; onDrop: (e: DragEvent<HTMLElement>) => void; children: React.ReactNode;
}) {
  const small = { height: 32, padding: "0 8px" } as const;
  return (
    <div className="wb-block" role="group" aria-label={block.count === 1 ? t("Repeat 1 time") : t("Repeat {n} times", { n: block.count })} data-item={block.id} data-drop={dropHere} onDragOver={onDragOver} onDrop={onDrop}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 2px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
          <Grip what={t("repeat")} canUp={canUp} canDown={canDown} onMove={onMove} grip={grip} />
          {t("Repeat")}
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}>
            {t("Times")}
            <DraftInput inputMode="numeric" value={String(block.count)} style={{ width: 60, textAlign: "right", fontWeight: 700 }}
              onCommit={(text) => { const v = parseNumber(text, 1, 99, 1); if (v !== null) onCount(v); return v !== null; }} />
          </label>
        </span>
        <span className="wb-hint">{total}</span>
      </div>
      {children}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "0 2px" }}>
        <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>{t("Add inside")}</span>
        {(["training", "rest"] as const).map((kind) => <Button key={kind} variant="plain" style={small} onClick={() => onAdd(kind)}>{t(KIND_LABEL[kind])}</Button>)}
        {sport === "swim" ? <Button variant="plain" style={small} onClick={() => onAdd("sendOff")}>{t(KIND_LABEL.sendOff)}</Button> : null}
        <Button variant="plain" style={{ ...small, marginLeft: "auto" }} onClick={onRemove}>{t("Remove repeat")}</Button>
      </div>
    </div>
  );
}
