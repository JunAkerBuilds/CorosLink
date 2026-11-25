"use client";
import Image from "next/image";
import { useState } from "react";
import { Button, Field, LinkButton } from "@/components/ui";
import { useNotWired } from "@/components/shell/useNotWired";
import { addCoachWorkout, answerQuestion, declineCoachWorkout, removeCoachWorkoutFromLibrary, saveCoachWorkoutToLibrary, applyPlanChange, forgetFact, keepPlan, removeCoachBrief, saveCoachBrief, undoCoachWorkout, undoPlanChange, type BriefCard, type FailedCard, type NoteLine, type PlanCard, type PlanSession, type QuestionCard, type WorkingCard, type WorkoutCard } from "@/data/coach";
import { useHubSession } from "@/data/hub";
import { answerTime, weekShares } from "@/lib/coach";
import { CardShell, hueVar, Icon, ICONS, Outcome, Read, Stat, TICK } from "./CardShell";
import { useThread } from "./thread";
import { SPORT_ICONS, SportBody } from "./WorkoutBodies";

/* ───────────── Plan change ───────────── */

function Session({ s, strong }: { s: PlanSession; strong?: boolean }) {
  return (
    <span className="cc-session">
      <i aria-hidden="true" style={{ background: s.hue === "none" ? "rgba(var(--fg-rgb), 0.18)" : hueVar(s.hue) }} />
      <span className={strong && s.changed ? undefined : "soft"} style={strong && s.changed ? { fontWeight: 600 } : undefined}>{s.name}</span>
    </span>
  );
}

/** Anything that moves, swaps or removes calendar workouts waits for an OK. */
export function PlanChange({ card }: { card: PlanCard }) {
  const thread = useThread();
  const { notes, run, clear } = useNotWired();
  const [busy, setBusy] = useState(false);
  const kept = !!card.kept, applied = card.applied;
  const shares = weekShares(card.week);
  const w = card.week;
  const act = (action: () => Promise<unknown>) => { setBusy(true); run("apply", action, undefined, () => setBusy(false)); };
  const changes = applied ? `${applied.steps} ${applied.steps === 1 ? "change" : "changes"} on your calendar${card.ops && applied.steps < card.ops.length ? ` of ${card.ops.length}` : ""}` : "";
  return (
    <CardShell id={card.id} hue="mint" icon={ICONS.calendar} foldable={false} label="Plan change" busy={busy}
      eyebrow={applied ? "Calendar · applied" : kept ? "Calendar · not applied" : "Calendar · needs your OK"} title={card.title}
      footer={
        <footer className="cc-foot">
          {applied ? (
            <Outcome kind="done" title="Applied" detail={changes}>
              <LinkButton href="/calendar" className="co-sm">Open calendar</LinkButton>
              <Button className="co-sm" disabled={busy} onClick={() => act(() => undoPlanChange(thread.conversationId, card))}>Undo</Button>
            </Outcome>
          ) : kept ? (
            <Outcome kind="none" title="Kept as it was" detail="Nothing changed on your calendar">
              <Button className="co-sm" onClick={() => act(() => keepPlan(thread.conversationId, card, false))}>Review again</Button>
            </Outcome>
          ) : (
            <>
              <Read hue="mint">{card.note}</Read>
              <div className="cc-actions">
                <button type="button" className="cc-quiet" disabled={busy} onClick={() => { clear("apply"); act(() => keepPlan(thread.conversationId, card, true)); }}>Keep as is</button>
                <LinkButton href="/calendar" className="co-sm">Open calendar</LinkButton>
                <Button variant="primary" className="co-sm" disabled={busy} onClick={() => act(() => applyPlanChange(thread.conversationId, card))}>{busy ? "Applying" : "Apply changes"}</Button>
              </div>
            </>
          )}
          {notes.apply && !kept ? (
            <Outcome kind="failed" title={applied ? "Not finished" : "Didn't move"} detail={notes.apply}>
              {applied ? null : <Button className="co-sm" disabled={busy} onClick={() => act(() => applyPlanChange(thread.conversationId, card))}>Try again</Button>}
            </Outcome>
          ) : null}
        </footer>
      }>
      <div className="cc-body">
        <div className="scroll-x">
          <div className="cc-table" role="table" aria-label="Proposed plan change" style={{ minWidth: 460 }}>
            <div className="cc-plan" data-head role="row">
              <span role="columnheader">Day</span><span role="columnheader">Now</span><span role="columnheader">Proposed</span><span role="columnheader">Load</span>
            </div>
            {card.rows.map((r) => (
              <div key={r.day} className="cc-plan cc-row" role="row">
                <span role="cell" className="muted">{r.day}</span>
                <div role="cell">{r.now.map((s, i) => <Session key={i} s={s} />)}</div>
                <div role="cell">{r.proposed.map((s, i) => <Session key={i} s={s} strong />)}</div>
                <span role="cell" className="muted">{r.loadNow || r.loadNext ? <>{r.loadNow} → <strong>{r.loadNext}</strong></> : <span aria-label="Load not known">—</span>}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="cc-week">
          <div>
            <span>{w.label}</span>
            <span>{w.after !== w.before ? <s>{w.before}</s> : null} <strong className="num">{w.after}</strong> planned · {w.done} done</span>
          </div>
          <div role="img" className="cc-track" data-tall
            aria-label={`Week load: ${w.done} done, ${Math.max(0, w.after - w.done)} still planned after the change, ${Math.abs(w.before - w.after)} ${w.after <= w.before ? "less" : "more"} than before`}>
            <span style={{ width: `${(shares.planned * 100).toFixed(1)}%`, background: "color-mix(in srgb, var(--h-pink) 42%, transparent)" }} />
            <span className="cl-bar" style={{ width: `${(shares.done * 100).toFixed(1)}%`, background: "var(--h-pink)" }} />
          </div>
        </div>
      </div>
    </CardShell>
  );
}

/* ───────────── Workout ───────────── */

/** A suggested session, ready for the calendar or the builder. */
export function Workout({ card }: { card: WorkoutCard }) {
  const thread = useThread();
  const [steps, setSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notes, run } = useNotWired();
  const added = card.added;
  const builder = added?.where === "browser" ? `/calendar/workout?id=${encodeURIComponent(added.ref)}` : `/calendar/workout?date=${card.date}`;
  const act = (action: () => Promise<unknown>, key = "add") => { setBusy(true); run(key, action, undefined, () => setBusy(false)); };
  const change = card.replaces;
  // The COROS workout library needs Training Hub: the button is offered only while it is connected here.
  const hubOn = useHubSession()?.state === "signedIn";
  const hue = card.hue ?? "mint";
  // The strength card says its day in the kicker and its size in one line, instead of the row of figures.
  const lined = card.body?.kind === "strength" && !!card.body.lifts;
  const declined = !added && !!card.declined;
  // Said before the button is pressed, so nobody expects it on the watch: a workout only this browser can hold.
  const browserOnly = !added && !change && !!card.workout && (!card.hub || !hubOn);
  return (
    <CardShell id={card.id} hue={hue} icon={card.sport ? SPORT_ICONS[card.sport] : ICONS.run} foldable={false}
      eyebrow={`${lined ? `${card.eyebrow.split(" · ")[0]} · ${card.dayLabel}` : card.eyebrow}${change ? ` · replaces “${change.name}”` : ""}`}
      title={card.title} subtitle={lined ? card.body?.line : undefined} busy={busy}
      footer={
        <footer className="cc-foot">
          {added ? (
            <Outcome kind="done" title={change ? "Changed" : "Added to your calendar"} detail={added.where === "coros" ? `On your COROS calendar, ${card.dayLabel}` : `Saved on this computer, ${card.dayLabel}`}>
              <LinkButton href={added.where === "browser" ? builder : "/calendar"} className="co-sm">{added.where === "browser" ? "Open in builder" : "Open calendar"}</LinkButton>
              <Button className="co-sm" disabled={busy} onClick={() => act(() => undoCoachWorkout(thread.conversationId, card))}>Undo</Button>
            </Outcome>
          ) : declined ? (
            <Outcome kind="none" title="Not now" detail="Nothing went on your calendar">
              <Button className="co-sm" disabled={busy} onClick={() => act(() => declineCoachWorkout(thread.conversationId, card, false))}>Review again</Button>
            </Outcome>
          ) : (
            <>
              {browserOnly ? <span className="cw-where muted" title="Saves on this computer, not on your watch"><Icon d={ICONS.calendar} size={13} width={2} />Not on your watch</span> : null}
              <div className="cc-actions">
                {card.hub && hubOn && !change && !card.saved && !card.inLibrary ? <Button className="co-sm" disabled={busy} onClick={() => act(() => saveCoachWorkoutToLibrary(thread.conversationId, card), "library")}>Save to library</Button> : null}
                <Button className="co-sm" disabled={busy} onClick={() => act(() => declineCoachWorkout(thread.conversationId, card, true))}>Not now</Button>
                <Button variant="primary" className="co-sm" disabled={busy} onClick={() => act(() => addCoachWorkout(thread.conversationId, card))}>{busy ? "Working" : change ? "Apply change" : "Add to calendar"}</Button>
              </div>
            </>
          )}
          {card.inLibrary ? (
            <Outcome kind="done" title="Saved to your library" detail="In your COROS workout library">
              <Button className="co-sm" disabled={busy} onClick={() => act(() => removeCoachWorkoutFromLibrary(thread.conversationId, card), "library")}>Remove</Button>
            </Outcome>
          ) : null}
          {notes.library ? <Outcome kind="failed" title="Library not changed" detail={notes.library} /> : null}
          {notes.add ? (
            <Outcome kind="failed" title={added ? "Not undone" : change ? "Not changed" : "Not added"} detail={notes.add}>
              {added ? null : <Button className="co-sm" disabled={busy} onClick={() => act(() => addCoachWorkout(thread.conversationId, card))}>Try again</Button>}
            </Outcome>
          ) : null}
        </footer>
      }>
      <div className="cc-body">
        {/* Coach's own words, so Coach's colour, whatever the sport. */}
        {card.note ? (
          <div className="cw-why">
            <span className="cw-why-by"><Image src="/img/coach-head.webp" alt="" width={20} height={20} unoptimized />Coach</span>
            <p>{card.note}</p>
          </div>
        ) : null}
        {lined ? null : (
          <div className="cc-workout-top">
            <div className="cc-stat"><span>Day</span><span className="cc-daychip">{card.dayLabel}</span></div>
            {card.stats.map((s) => <Stat key={s.label} stat={s} />)}
          </div>
        )}
        {card.body ? <SportBody body={card.body} hue={hue} /> : (
        <div className="cc-chart" style={{ gap: 8 }}>
          <div role="img" aria-label={card.shapeLabel} className="cc-shape">
            {card.steps.map((s) => <span key={s.name} style={{ flex: `${s.weight} 1 0`, height: `${s.height * 100}%`, background: hueVar(s.hue), opacity: s.soft ? 0.55 : 1 }} />)}
          </div>
          <div className="cc-shape-foot">
            <span>{card.summary}</span>
            <button type="button" className="cc-quiet" aria-expanded={steps} onClick={() => setSteps((v) => !v)}>{steps ? "Hide steps" : `Show ${card.steps.length} steps`}</button>
          </div>
          {steps ? (
            <div className="cc-table">
              {card.steps.map((s) => (
                <div key={s.name} className="cc-step cc-row">
                  <i aria-hidden="true" style={{ background: hueVar(s.hue), opacity: s.soft ? 0.55 : 1 }} />
                  <span style={{ fontWeight: 600 }}>{s.name}</span><span>{s.length}</span><span className="soft">{s.target}</span><span className="muted">{s.note}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        )}
      </div>
    </CardShell>
  );
}

/* ───────────── Question ───────────── */

/** One decision Coach needs before going on. The answer is kept in this browser until Coach can read it. */
export function Question({ card }: { card: QuestionCard }) {
  const thread = useThread();
  const { notes, run } = useNotWired();
  const [own, setOwn] = useState("");
  const answer = card.answered;
  const say = (text: string) => run("answer", async () => { await answerQuestion(thread.conversationId, card, text); thread.send(text); });
  const sendOwn = () => { if (own.trim()) { say(own.trim()); setOwn(""); } };
  return (
    <CardShell id={card.id} hue="violet" icon={ICONS.question} foldable={false} label="Question" eyebrow="Coach asks" title={card.title} note={notes.answer}>
      <div className="cc-body" style={{ paddingBottom: 14 }}>
        {answer ? (() => {
          // Only the choice made stays, marked as chosen; the others go.
          const chosen = card.options.find((o) => o.title === answer.text);
          return (
            <div className="cc-opt" data-chosen role="status">
              <i aria-hidden="true"><Icon d={TICK} size={11} width={3.4} /></i>
              <span>
                <span>{answer.text}{chosen?.recommended ? <em>Recommended</em> : null}</span>
                <span>{chosen?.detail ? `${chosen.detail} · ` : ""}You chose this at {answerTime(answer.at)}</span>
              </span>
            </div>
          );
        })() : (
          <>
            {card.options.map((o) => (
              <button key={o.id} type="button" className="cc-opt" disabled={thread.busy} onClick={() => say(o.title)}>
                <i aria-hidden="true" />
                <span>
                  <span>{o.title}{o.recommended ? <em>Recommended</em> : null}</span>
                  <span>{o.detail}</span>
                </span>
              </button>
            ))}
            <form className="cc-own" onSubmit={(e) => { e.preventDefault(); sendOwn(); }}>
              <Field aria-label="Your own answer" placeholder="Your own answer" value={own} onChange={(e) => setOwn(e.target.value)} />
              <Button type="submit" className="co-sm" disabled={!own.trim() || thread.busy}>Send</Button>
            </form>
          </>
        )}
      </div>
    </CardShell>
  );
}

/* ───────────── Brief ───────────── */

/** Saved on a planned workout: goal, cues, fuel. */
export function Brief({ card }: { card: BriefCard }) {
  const thread = useThread();
  const { notes, run } = useNotWired();
  return (
    <CardShell id={card.id} hue="honey" icon={ICONS.page} eyebrow={card.eyebrow} title={card.title} note={notes.save}
      footer={
        <footer className="cc-foot">
          {card.saved ? (
            <Outcome kind="done" title={card.saved} detail={card.savedNote}>
              {card.briefId ? <Button className="co-sm" onClick={() => run("save", () => removeCoachBrief(thread.conversationId, card))}>Remove</Button> : null}
            </Outcome>
          ) : (
            <div className="cc-actions">
              <Button variant="primary" className="co-sm" onClick={() => run("save", () => saveCoachBrief(thread.conversationId, card))}>Save brief</Button>
            </div>
          )}
        </footer>
      }>
      <div className="cc-body">
        <dl className="cc-dl">
          <dt>Goal</dt><dd style={{ fontWeight: 600 }}>{card.goal}</dd>
          <dt>Cues</dt>
          <dd><ul className="cc-cues" data-plain>{card.cues.map((c) => <li key={c}><span>{c}</span></li>)}</ul></dd>
          {card.fuel ? <><dt>Fuel</dt><dd>{card.fuel}</dd></> : null}
        </dl>
      </div>
    </CardShell>
  );
}

/* ───────────── Working, couldn't load, notes ───────────── */

/** While Coach reads data and builds a card. */
export function Working({ card }: { card: WorkingCard }) {
  const thread = useThread();
  return (
    <article className="cc-card" aria-label="Coach is working" aria-busy="true">
      <div className="cc-working">
        <span aria-hidden="true" className="coach-strip" data-pose="run"><Image src="/img/coach-run.webp" alt="" width={896} height={56} unoptimized /></span>
        <div>
          <h3>{card.title}</h3>
          <ul>
            {card.steps.map((s) => (
              <li key={s.text} data-done={s.done ? "" : undefined}>
                {s.done ? <Icon d={TICK} size={14} width={2.8} /> : <i aria-hidden="true" className="cc-spin" />}
                <span>{s.text}<span className="sr-only">{s.done ? ", done" : ", in progress"}</span></span>
              </li>
            ))}
          </ul>
        </div>
        {thread.busy ? <Button className="co-sm" onClick={() => thread.stop()}>Stop</Button> : null}
      </div>
      <div aria-hidden="true" className="cc-skels"><div><i /><i /><i /></div><i /></div>
    </article>
  );
}

/** When the data for a card isn't available. */
export function Failed({ card }: { card: FailedCard }) {
  const thread = useThread();
  return (
    <CardShell id={card.id} hue="coral" icon={ICONS.warn} foldable={false} eyebrow="Couldn't load" title={card.title}>
      <div className="cc-body">
        <p style={{ margin: 0 }} className="soft">{card.text}</p>
        <div className="cc-failed-foot">
          <span className="muted">{card.tried}</span>
          <div className="cc-actions">
            <Button className="co-sm" disabled={thread.busy || !thread.conversationId} onClick={() => thread.retry()}>
              <Icon d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" size={14} width={2.2} />Try again
            </Button>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

/** A small line in the thread, not a card: what Coach saved or read. */
export function Note({ line }: { line: NoteLine }) {
  const thread = useThread();
  const { notes, run } = useNotWired();
  const remembered = line.note === "remembered";
  return (
    <div className="cc-line">
      <span aria-hidden="true" style={{ color: remembered ? "var(--h-violet-ink)" : "var(--muted)" }}><Icon d={remembered ? ICONS.bookmark : ICONS.check} size={15} width={2.2} /></span>
      <span style={line.forgotten ? { textDecoration: "line-through" } : undefined}>{remembered ? <><strong>{line.forgotten ? "Forgotten:" : "Remembered:"}</strong> </> : null}{line.text}</span>
      {remembered && !line.forgotten ? <button type="button" className="cc-quiet" onClick={() => run("forget", () => forgetFact(thread.conversationId, line))}>Forget</button> : null}
      {notes.forget ? <span className="cc-line-note" role="status">{notes.forget}</span> : null}
    </div>
  );
}
