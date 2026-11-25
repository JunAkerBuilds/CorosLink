"use client";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button, LinkButton, OriginBadge } from "@/components/ui";
import { Composer, type Attached } from "@/components/coach/Composer";
import { CoachBlockView } from "@/components/coach/CoachBlockView";
import { latestCard, type CoachMessage } from "@/data/coach";

/** An answer picked on Coach's question card shows on the card, not again as a bubble. */
const answeredOnCard = (before: CoachMessage | undefined, text: string): boolean =>
  before?.from === "coach" && before.blocks.some((b) => b.kind === "question" && (latestCard(b) as typeof b).answered?.text === text);
import { ThreadContext, type ThreadApi } from "@/components/coach/thread";
import { useNotWired } from "@/components/shell/useNotWired";
import {
  CoachError, deleteConversation, loadCoach, loadCoachAccess, newConversationId, sendToCoach,
  type CoachAccessInfo, type CoachBlock, type CoachData, type Conversation, type WorkingCard,
} from "@/data/coach";
import { useLoaded, type Origin } from "@/data/core";
import { NEW_TITLE } from "@/data/local/coach";
import { COACH_KEY_WORDS } from "@/lib/connections";
import { platformSlots } from "@/lib/platform";
import "./coach.css";

const GROUPS = ["Today", "This week", "Earlier"] as const;
const LEVEL_C = 2 * Math.PI * 70;
const STARTER_TILES = [
  { text: "How does today look?", hue: "mint", tint: "rgba(83,203,161,0.16)", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></> },
  { text: "How did my last workout go?", hue: "orange", tint: "rgba(255,169,77,0.16)", icon: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
  { text: "How did I sleep this week?", hue: "violet", tint: "rgba(165,148,255,0.18)", icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> },
  { text: "Create a run for tomorrow", hue: "cyan", tint: "rgba(92,207,230,0.16)", icon: <path d="M12 5v14M5 12h14" /> },
];
const KEY_WORDS = COACH_KEY_WORDS;

/** "Fitness / fatigue / form" with three values becomes three tiles; the other rows stay as they are. */
function splitLoad(looking: { label: string; value: string }[]) {
  const i = looking.findIndex((s) => s.label.split(" / ").length === 3 && s.value.split(" / ").length === 3);
  if (i < 0) return { load: null, rest: looking };
  const labels = looking[i].label.split(" / "), values = looking[i].value.split(" / ");
  const formTone = /^[−-]/.test(values[2]) ? "low" : "high";
  const load = labels.map((l, k) => ({ label: l.charAt(0).toUpperCase() + l.slice(1), value: values[k], tone: k === 0 ? "fit" : k === 1 ? "tired" : formTone }));
  return { load, rest: looking.filter((_, k) => k !== i) };
}

/** An answer on its way: what has streamed so far. `replyId` is set once it is saved, until the thread shows it. */
interface Live {
  conversationId: string;
  text: string;
  blocks: CoachBlock[];
  working: WorkingCard | null;
  replyId?: string;
}

export default function CoachPage() {
  return <Suspense fallback={<main className="page"><div className="skeleton" style={{ minHeight: 480 }} /></main>}><CoachLoaded /></Suspense>;
}

function CoachLoaded() {
  // `?ask=` (from "Ask Coach" elsewhere, such as a night on the Sleep page) opens a new conversation with the question typed in.
  const ask = useSearchParams().get("ask");
  const loaded = useLoaded(loadCoach);
  if (loaded.status === "loading") return <main className="page"><div className="skeleton" style={{ minHeight: 480 }} /></main>;
  if (loaded.status === "error") return <main className="page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  return <CoachScreen key={ask ?? ""} data={loaded.data} origin={loaded.origin} ask={ask} />;
}

function CoachScreen({ data, origin, ask: asked }: { data: CoachData; origin: Origin; ask: string | null }) {
  const real = origin === "synced";
  // A conversation started here has no messages yet, so it is not in the account until its first question.
  const [opening] = useState(() => (asked?.trim() ? { id: newConversationId(), text: asked.trim().slice(0, 2000) } : null));
  const [fresh, setFresh] = useState<string | null>(opening?.id ?? null);
  const [chosen, setChosen] = useState<string | null>(opening?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>(opening ? { [opening.id]: opening.text } : {});
  const [attached, setAttached] = useState<Record<string, Attached[]>>({});
  const [live, setLive] = useState<Live | null>(null);
  const [access, setAccess] = useState<CoachAccessInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { notes, run } = useNotWired();
  const heading = useRef<HTMLHeadingElement>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!real) return;
    let on = true;
    loadCoachAccess().then((a) => { if (on) setAccess(a); }, () => {});
    return () => { on = false; };
  }, [real]);

  const current: Conversation | undefined = data.conversations.find((c) => c.id === chosen) ?? (chosen === null && !fresh ? data.conversations[0] : undefined);
  const id = current?.id ?? chosen ?? fresh ?? "";
  const title = current?.title ?? NEW_TITLE;
  const draft = drafts[id] ?? "";
  const files = attached[id] ?? [];
  // The saved reply takes over from the streamed one as soon as the thread holds it.
  const streaming = live && live.conversationId === id && !(live.replyId && current?.messages.some((m) => m.id === live.replyId)) ? live : null;
  const busy = !!live && !live.replyId;
  const needsKey = real && access?.key === "none";

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [streaming?.text, streaming?.blocks.length, current?.messages.length]);

  const choose = (next: string) => { setChosen(next); setProblem(null); heading.current?.focus(); };
  const startNew = () => {
    const next = fresh && !data.conversations.some((c) => c.id === fresh) ? fresh : newConversationId();
    setFresh(next);
    choose(next);
  };

  const ask = (text: string, retry = false) => {
    const body = text.trim();
    const target = id || newConversationId();
    const sending = retry ? [] : (attached[id] ?? []);
    if ((!body && !sending.length && !retry) || busy) return;
    if (!id) { setFresh(target); setChosen(target); }
    setProblem(null);
    setDrafts((d) => ({ ...d, [target]: "" }));
    setAttached((a) => ({ ...a, [id]: [], [target]: [] }));
    const controller = new AbortController();
    abort.current = controller;
    setLive({ conversationId: target, text: "", blocks: [], working: { kind: "working", id: "working", title: "Coach is on it", steps: [{ text: "Reading your question", done: false }] } });
    const update = (change: (l: Live) => Live) => setLive((l) => (l && l.conversationId === target && !l.replyId ? change(l) : l));
    sendToCoach(target, body, {
      retry, signal: controller.signal, files: sending.map((a) => a.file),
      onEvent: (event) => {
        if (event.t === "text") update((l) => ({ ...l, text: l.text + event.delta }));
        else if (event.t === "reset") update((l) => ({ ...l, text: "" }));
        else if (event.t === "working") update((l) => ({ ...l, working: event.card }));
        else if (event.t === "block") update((l) => {
          const b = event.block, at = b.kind === "text" ? -1 : l.blocks.findIndex((x) => x.kind !== "text" && x.id === b.id);
          if (at >= 0) return { ...l, blocks: l.blocks.map((x, i) => (i === at ? b : x)) };
          return { ...l, blocks: [...l.blocks, ...(l.text.trim() ? [{ kind: "text" as const, text: l.text.trim() }] : []), b], text: "" };
        });
      },
    }).then(
      (reply) => setLive((l) => (l && l.conversationId === target ? { ...l, replyId: reply.id } : l)),
      (e: unknown) => {
        setLive(null);
        if (e instanceof CoachError && e.code === "no_key") setAccess((a) => (a ? { ...a, key: "none" } : a));
        else setProblem(e instanceof Error ? e.message : "Coach couldn't answer.");
      },
    );
  };

  const thread: ThreadApi = useMemo(() => ({
    conversationId: real ? id : "", busy,
    send: (text) => ask(text),
    retry: () => ask("", true),
    stop: () => abort.current?.abort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [real, id, busy]);

  const suggestions = busy ? [] : current ? current.suggestions : [];

  const CoachAI = platformSlots.coachAI;
  return (
    <ThreadContext.Provider value={thread}>
      <main className="co-wrap">
        <aside className="co-list">
          <Button className="co-new" onClick={startNew}>New conversation</Button>
          <nav aria-label="Conversations" className="co-convs">
            {fresh && !data.conversations.some((c) => c.id === fresh) ? (
              <button type="button" className="co-conv" aria-current={fresh === id ? "true" : undefined} onClick={() => choose(fresh)}>
                <span>{NEW_TITLE}</span><span>Now</span>
              </button>
            ) : null}
            {GROUPS.map((g) => {
              const items = data.conversations.filter((c) => c.group === g);
              if (!items.length) return null;
              return (
                <div key={g} style={{ display: "contents" }}>
                  <span className="co-group">{g}</span>
                  {items.map((c) => (
                    <button key={c.id} type="button" className="co-conv" aria-current={c.id === id ? "true" : undefined} onClick={() => choose(c.id)}>
                      <span>{c.title}</span><span>{c.stamp}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        <section id="thread" aria-label="Conversation" className="co-thread">
          <div className="co-head">
            <h1 ref={heading} tabIndex={-1}>{title}</h1>
            <div className="co-badges">
              <OriginBadge origin={origin} />
              {real && current && !busy ? (
                <button type="button" className="cc-quiet" onClick={() => run("delete", () => deleteConversation(current.id), () => setChosen(null))}>Delete</button>
              ) : null}
            </div>
          </div>

          <div className="co-col">
            {current?.messages.map((m, i, all) =>
              m.from === "you" && answeredOnCard(all[i - 1], m.text) ? null : m.from === "you" ? (
                <div key={m.id} className="co-you-wrap">
                  {m.files?.length ? (
                    <ul className="co-you-files" aria-label="Files sent">
                      {m.files.map((f) => <li key={f}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M20.5 11.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7" /></svg>{f}</li>)}
                    </ul>
                  ) : null}
                  <p className="co-you">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className="co-coach">
                  <Image aria-hidden="true" className="co-avatar" src="/img/coach-head.webp" alt="" width={36} height={36} />
                  <div className="co-blocks">
                    <span className="sr-only">Coach</span>
                    {m.blocks.map((b, i) => <CoachBlockView key={b.kind === "text" ? i : b.id} block={b} />)}
                  </div>
                </div>
              ),
            )}
            {streaming ? (
              <div className="co-coach" aria-live="polite">
                <Image aria-hidden="true" className="co-avatar" src="/img/coach-head.webp" alt="" width={36} height={36} />
                <div className="co-blocks">
                  <span className="sr-only">Coach</span>
                  {streaming.blocks.map((b, i) => <CoachBlockView key={b.kind === "text" ? `t${i}` : b.id} block={b} />)}
                  {streaming.text ? <p>{streaming.text}</p> : null}
                  {!streaming.text && !streaming.replyId && streaming.working ? <CoachBlockView block={streaming.working} /> : null}
                </div>
              </div>
            ) : null}
            {!current && !streaming && !needsKey ? (
              real ? (
                <div className="co-start">
                  <Image aria-hidden="true" src="/img/coach-head.webp" alt="" width={56} height={56} />
                  <h2>What are we working on?</h2>
                  <p>Coach reads what your phone has synced: training, sleep, food and your plan. Attach a photo, a PDF or a file to ask about it.</p>
                  <div className="co-starters">
                    {STARTER_TILES.map((s) => (
                      <button key={s.text} type="button" className="co-starter" onClick={() => ask(s.text)} disabled={busy}>
                        <span aria-hidden="true" className="co-starter-icon" style={{ background: s.tint, color: `var(--h-${s.hue}-ink)` }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>{s.icon}</svg>
                        </span>
                        <span className="co-starter-text">{s.text}</span>
                        <svg aria-hidden="true" className="co-starter-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </button>
                    ))}
                  </div>
                </div>
              ) : <p className="co-empty">This sample conversation has no messages.</p>
            ) : null}
            {problem ? <p className="notice" role="alert">{problem}</p> : null}
            {notes.delete ? <p className="notice" role="alert">{notes.delete}</p> : null}

            {needsKey && platformSlots.aiSettingsHref ? (
              <div className="co-key">
                <h2>Coach needs an AI</h2>
                <div><LinkButton href={platformSlots.aiSettingsHref} variant="primary">Set up AI</LinkButton></div>
              </div>
            ) : needsKey ? (
              <div className="co-key"><h2>Coach needs an AI</h2></div>
            ) : null}

            <div className="co-bottom" ref={bottom}>
              {suggestions.length && !needsKey ? (
                <div className="co-chips">
                  {suggestions.map((s) => <Button key={s} className="co-chip" onClick={() => ask(s)}>{s}</Button>)}
                </div>
              ) : null}
              <Composer
                value={draft} files={files} busy={busy} disabled={needsKey}
                onChange={(text) => setDrafts((d) => ({ ...d, [id]: text }))}
                onFiles={(next) => setAttached((a) => ({ ...a, [id]: next }))}
                onSend={() => ask(draft)}
                onStop={() => abort.current?.abort()}
                tools={CoachAI ? <CoachAI /> : real && access ? (platformSlots.aiSettingsHref
                  ? <Link href={platformSlots.aiSettingsHref} className="co-model" title="Change Coach's AI"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg><span>{access.model || KEY_WORDS.none}</span><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M6 9l6 6 6-6" /></svg></Link>
                  : <span className="co-model" title="Coach's AI"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg><span>{access.model || KEY_WORDS[access.key]}</span></span>) : null}
              />
            </div>
          </div>
        </section>

        <aside aria-label="What Coach is looking at" className="co-side">
          <div className="co-hero">
            <div className="co-level" data-plain={data.level ? undefined : true}>
              {data.level ? (
                <svg role="img" aria-label={`Progress to Coach's next look: ${Math.round(data.level.fraction * 100)} percent`} className="no-wipe" width="156" height="156" viewBox="0 0 156 156">
                  <circle cx="78" cy="78" r="70" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.08)", strokeWidth: 8 }} />
                  <circle className="cl-ring" cx="78" cy="78" r="70" fill="none" transform="rotate(-90 78 78)"
                    style={{ stroke: "var(--h-mint)", strokeWidth: 8, strokeLinecap: "round", strokeDasharray: `${(data.level.fraction * LEVEL_C).toFixed(1)} ${LEVEL_C.toFixed(1)}` }} />
                </svg>
              ) : null}
              <span aria-hidden="true" className="coach-strip" data-pose="wave"><Image src="/img/coach-wave.webp" alt="" width={2688} height={112} unoptimized /></span>
              {data.level ? <span className="co-level-chip">Level {data.level.number}</span> : null}
            </div>
            {data.level ? <><span>{data.level.line}</span><span>{data.level.next}</span></> : null}
          </div>
          <section className="co-card" aria-labelledby="co-looking-title">
            <h2 id="co-looking-title">What Coach is looking at</h2>
            {data.looking.length ? (() => {
              const { load, rest } = splitLoad(data.looking);
              return (
                <>
                  {load ? (
                    <dl className="co-load">
                      {load.map((p) => <div key={p.label} data-tone={p.tone}><dt>{p.label}</dt><dd className="num">{p.value}</dd></div>)}
                    </dl>
                  ) : null}
                  {rest.length ? (
                    <dl className="co-counts">
                      {rest.map((s) => <div key={s.label}><dt>{s.label}</dt><dd className="num">{s.value}</dd></div>)}
                    </dl>
                  ) : null}
                </>
              );
            })() : <p className="co-empty">Nothing from your phone yet</p>}
          </section>
          {data.goal ? (
            <section className="co-card co-block">
              <h3>Goal</h3>
              <span>{data.goal.title}</span>
              <span>{data.goal.detail}</span>
            </section>
          ) : null}
          {current?.sources.length ? (
            <section className="co-card co-block">
              <h3>Used in this answer</h3>
              {current.sources.map((s) => (
                <Link key={`${s.title}-${s.detail}`} href={s.href} className="co-source"><span>{s.title}</span><span>{s.detail}</span></Link>
              ))}
            </section>
          ) : null}
          {platformSlots.aiSettingsHref ? (
            <Link href={platformSlots.aiSettingsHref} className="co-settings">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
              <span>Coach settings</span>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M9 6l6 6-6 6" /></svg>
            </Link>
          ) : null}
        </aside>
      </main>
    </ThreadContext.Provider>
  );
}
