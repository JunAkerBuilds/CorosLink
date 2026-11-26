"use client";
// The side Coach, on every page but Coach's own (canvas: Plans with Coach › "Plan editor: Coach on the side"). Shut,
// it is the mascot's head floating on the left edge, with a count of what Coach noticed here. Open, it is a panel
// docked beside the sidebar that pushes the page over: a conversation that knows the page (its own words from
// usePageCoach, else its visible text), and on pages that can be changed from words a "Change …" mode that does it.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CoachBlockView } from "@/components/coach/CoachBlockView";
import { ThreadContext, type ThreadApi } from "@/components/coach/thread";
import { CoachError, latestCard, newConversationId, onCardChanged, sendToCoach, type CoachBlock, type WorkingCard } from "@/data/coach";
import { usePageCoachState, type PageCoach } from "./pageCoach";
import "@/app/(app)/coach/coach.css";
import { t, tx } from "@/lib/i18n";

type Line =
  | { id: string; kind: "you"; text: string; change?: boolean }
  | { id: string; kind: "coach"; blocks: CoachBlock[] }
  | { id: string; kind: "changed"; title: string; sub: string; undone?: boolean; path?: string; stale?: boolean }
  | { id: string; kind: "problem"; text: string; key?: boolean };

interface Live { text: string; blocks: CoachBlock[]; working: WorkingCard | null; stages?: string[] }

const OPEN_KEY = "coach.dock.open";
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const keepOpen = (open: boolean) => { try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* fine */ } };
const lineId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* The conversation outlives the window: closing, moving between pages and restarting keep it. A change from an
   earlier session can't be undone any more (the editor's history is gone), so it comes back without its Undo. */
const CHAT_KEY = "coach.dock.chat";
interface Kept { conversation: string; lines: Line[] }
function readChat(): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "null") as Kept | null;
    if (!kept || typeof kept.conversation !== "string" || !Array.isArray(kept.lines)) return null;
    return { conversation: kept.conversation, lines: kept.lines.map((l) => (l.kind === "changed" ? { ...l, stale: true } : l)) };
  } catch { return null; }
}
function keepChat(kept: Kept): void {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify({ conversation: kept.conversation, lines: kept.lines.slice(-80) })); } catch { /* fine */ }
}

const answeredOnCard = (before: Line | undefined, text: string): boolean =>
  before?.kind === "coach" && before.blocks.some((b) => b.kind === "question" && (latestCard(b) as typeof b).answered?.text === text);

/** The page in words for Coach: its own description, then what is on screen. */
function pageText(page: PageCoach | null): { title: string; text: string } {
  const main = typeof document !== "undefined" ? document.getElementById("main") : null;
  const seen = (main?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, page?.about ? 5000 : 10000);
  const title = page?.title ?? (typeof document !== "undefined" ? document.title.replace(/\s*·\s*C-LINK$/, "") : "") ?? "This page";
  return { title: title || "This page", text: [page?.about ? `What this page holds:\n${page.about}` : "", seen ? `What is on screen:\n${seen}` : ""].filter(Boolean).join("\n\n") };
}

export function CoachDock() {
  const pathname = usePathname();
  const page = usePageCoachState();
  const [open, setOpen] = useState(readOpen);
  const [restored] = useState(readChat);
  const [conversation, setConversation] = useState(() => restored?.conversation ?? newConversationId());
  const [lines, setLines] = useState<Line[]>(() => restored?.lines ?? []);
  useEffect(() => keepChat({ conversation, lines }), [conversation, lines]);
  // A card changed by its button (saved, applied, answered) is kept that way in this chat too.
  useEffect(() => onCardChanged((b) => {
    if (b.kind === "text") return;
    setLines((ls) => (ls.some((l) => l.kind === "coach" && l.blocks.some((x) => x.kind !== "text" && x.id === b.id))
      ? ls.map((l) => (l.kind === "coach" ? { ...l, blocks: l.blocks.map((x) => (x.kind !== "text" && x.id === b.id ? b : x)) } : l))
      : ls));
  }), []);
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState("");
  const [changeMode, setChangeMode] = useState(false);
  const [skippedOn, setSkipped] = useState<{ path: string; texts: readonly string[] }>({ path: "", texts: [] });
  const skipped = skippedOn.path === pathname ? skippedOn.texts : [];
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = live !== null;

  // Studio has its own full-width editor; the dock button sat on top of it.
  const hidden = pathname.startsWith("/coach") || pathname.startsWith("/welcome") || pathname.startsWith("/setup") || pathname.startsWith("/studio");
  const findings = (page?.findings ?? []).filter((f) => !skipped.includes(f.text));
  const change = page?.change ?? null;
  const changing = changeMode && change !== null;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [lines.length, live?.text, live?.blocks.length, live?.stages?.length]);

  const show = (next: boolean) => { setOpen(next); keepOpen(next); if (next) requestAnimationFrame(() => box.current?.focus()); };
  const add = (line: Line) => setLines((l) => [...l, line]);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");
    add({ id: lineId(), kind: "you", text: question });
    const controller = new AbortController();
    abort.current = controller;
    setLive({ text: "", blocks: [], working: { kind: "working", id: "working", title: t("Coach is on it"), steps: [{ text: t("Reading this page"), done: false }] } });
    sendToCoach(conversation, question, {
      signal: controller.signal, page: pageText(page), ...(page?.plan ? { openPlan: page.plan.plan } : {}),
      onEvent: (event) => {
        if (event.t === "text") setLive((l) => l && { ...l, text: l.text + event.delta });
        else if (event.t === "reset") setLive((l) => l && { ...l, text: "" });
        else if (event.t === "working") setLive((l) => l && { ...l, working: event.card });
        else if (event.t === "block") setLive((l) => {
          if (!l) return l;
          const b = event.block, at = b.kind === "text" ? -1 : l.blocks.findIndex((x) => x.kind !== "text" && x.id === b.id);
          if (at >= 0) return { ...l, blocks: l.blocks.map((x, i) => (i === at ? b : x)) };
          return { ...l, blocks: [...l.blocks, ...(l.text.trim() ? [{ kind: "text" as const, text: l.text.trim() }] : []), b], text: "" };
        });
      },
    }).then(
      (reply) => { setLive(null); if (reply.from === "coach") add({ id: lineId(), kind: "coach", blocks: reply.blocks }); },
      (e: unknown) => {
        setLive(null);
        const key = e instanceof CoachError && e.code === "no_key";
        add({ id: lineId(), kind: "problem", text: key ? t("Coach needs an AI key before it can answer.") : e instanceof Error ? e.message : t("Coach couldn’t answer."), key });
      },
    );
  };

  const doChange = (text: string) => {
    const words = text.trim();
    if (!words || busy || !change) return;
    setDraft("");
    add({ id: lineId(), kind: "you", text: words, change: true });
    const controller = new AbortController();
    abort.current = controller;
    setLive({ text: "", blocks: [], working: null, stages: [t("Asking Coach")] });
    const onStage = (stage: string) => setLive((l) => l && { ...l, stages: [...(l.stages ?? []).filter((s) => s !== stage), stage] });
    change.run(words, { signal: controller.signal, onStage }).then(
      (done) => { setLive(null); add({ id: lineId(), kind: "changed", ...done, path: pathname }); },
      (e: unknown) => { setLive(null); if (!controller.signal.aborted) add({ id: lineId(), kind: "problem", text: e instanceof Error ? e.message : t("Coach couldn’t change it.") }); },
    );
  };

  const send = () => (changing ? doChange(draft) : ask(draft));
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  };

  const thread: ThreadApi = useMemo(() => ({
    conversationId: conversation, busy,
    send: (text) => ask(text),
    retry: () => undefined,
    stop: () => abort.current?.abort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [conversation, busy]);

  if (hidden) return null;

  /* One shape morphs between the head and the window: the circle grows into the window and the head fades out,
     then shrinks back into the head on close. The window stays mounted (inert while shut) so nothing is lost. */
  const asks = changing ? change!.asks : page?.asks ?? [t("What stands out here?"), t("Explain this page"), t("What should I do next?")];
  return (
    <ThreadContext.Provider value={thread}>
      <div className="cd-morph" data-open={open || undefined} data-busy={busy || undefined}>
      <button type="button" className="cd-head" aria-expanded={open} aria-controls="coach-dock" tabIndex={open ? -1 : 0} aria-hidden={open || undefined}
        aria-label={findings.length === 1 ? t("Ask Coach about this page · 1 thing to look at") : findings.length ? t("Ask Coach about this page · {n} things to look at", { n: findings.length }) : t("Ask Coach about this page")}
        onClick={() => show(true)}>
        <Image className="cd-bob" src="/img/coach-head.webp" alt="" width={46} height={46} />
      </button>
      <aside id="coach-dock" className="cd-panel" aria-label={t("Coach")} inert={!open} onKeyDown={(e) => { if (e.key === "Escape") show(false); }}>
        <header className="cd-top">
          <span className="cd-avatar" aria-hidden="true"><Image src="/img/coach-head.webp" alt="" width={32} height={32} /><i /></span>
          <span className="cd-name"><strong>{t("Coach")}</strong><span title={page?.looking}>{page?.looking ? t("Sees {what}", { what: page.looking.replace(/^Looking at /, "") }) : page?.title ? t("Sees {what}", { what: page.title }) : t("Sees this page")}</span></span>
          <button type="button" className="cd-icon" title={t("New chat")} aria-label={t("New chat")} disabled={busy} onClick={() => { setLines([]); setConversation(newConversationId()); }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <Link className="cd-icon" href="/coach" title={t("Open in Coach")} aria-label={t("Open in Coach")}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
          </Link>
          <button type="button" className="cd-icon" aria-label={t("Close Coach")} onClick={() => show(false)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.2, strokeLinecap: "round" }}><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="cd-thread">
          {findings.length ? (
            <div className="cd-coach">
              <Image aria-hidden="true" src="/img/coach-head.webp" alt="" width={26} height={26} />
              <div className="cd-bubble">
                <span>{findings.length === 1 ? t("One thing stands out here:") : t("{n} things stand out here:", { n: findings.length })}</span>
                {findings.map((f) => (
                  <div key={f.text} className="cd-row" data-tone={f.tone}>
                    <strong>{f.text}</strong>
                    <span className="cd-acts">
                      {f.fix ? <button type="button" className="cd-btn" data-primary disabled={busy} onClick={() => (change ? doChange(f.fix!) : ask(f.fix!))}>{t("Fix it")}</button> : null}
                      {f.tone === "warning" ? <button type="button" className="cd-btn" onClick={() => setSkipped({ path: pathname, texts: [...skipped, f.text] })}>{t("Skip")}</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : !lines.length && !live ? (
            <div className="cd-hello">
              <Image aria-hidden="true" className="cd-bob" src="/img/coach-head.webp" alt="" width={64} height={64} />
              <strong>{page?.title ? t("I can see your {page} too", { page: page.title.toLowerCase() }) : t("I can see this page too")}</strong>
              <span>{change ? t("Ask anything about what’s on screen, or switch to {mode} and I’ll make the change for you.", { mode: change.label }) : t("Ask anything about what’s on screen.")}</span>
            </div>
          ) : null}

          {lines.map((line, i) => {
            // An answer picked on Coach's question card shows on the card, not again as a bubble.
            if (line.kind === "you" && answeredOnCard(lines[i - 1], line.text)) return null;
            if (line.kind === "you") return <p key={line.id} className="cd-you">{line.change ? <small>{change?.label ?? tx("plan change", "Change")}</small> : null}{line.text}</p>;
            if (line.kind === "problem") return (
              <div key={line.id} className="cd-row" data-tone="error"><strong>{line.text}</strong>{line.key ? <Link href="/coach">{t("Add one in Coach")}</Link> : null}</div>
            );
            if (line.kind === "changed") return (
              <div key={line.id} className="cd-coach">
                <Image aria-hidden="true" src="/img/coach-cheer.webp" alt="" width={26} height={26} />
                <div className="cd-bubble">
                  <div className="cd-row" data-tone={line.undone ? "plain" : "done"}>
                    <strong>{line.undone ? t("Put back the way it was") : line.title}</strong>
                    {line.undone ? null : <span>{line.sub}</span>}
                    {line.undone || line.stale || !change || line.path !== pathname ? null : <span className="cd-acts"><button type="button" className="cd-btn" onClick={() => { change.undo(); setLines((l) => l.map((x) => (x.id === line.id ? { ...x, undone: true } : x))); }}>{t("Undo")}</button></span>}
                  </div>
                </div>
              </div>
            );
            return (
              <div key={line.id} className="cd-coach">
                <Image aria-hidden="true" src="/img/coach-head.webp" alt="" width={26} height={26} />
                <div className="cd-bubble co-blocks">{line.blocks.map((b, i) => <CoachBlockView key={b.kind === "text" ? i : b.id} block={b} />)}</div>
              </div>
            );
          })}

          {live ? (
            <div className="cd-coach" aria-live="polite">
              <span aria-hidden="true" className="cd-run"><Image src="/img/coach-run.webp" alt="" width={896} height={56} unoptimized /></span>
              <div className="cd-bubble co-blocks">
                {live.blocks.map((b, i) => <CoachBlockView key={b.kind === "text" ? `t${i}` : b.id} block={b} />)}
                {live.text ? <p>{live.text}</p> : null}
                {!live.text && live.working ? <CoachBlockView block={live.working} /> : null}
                {live.stages ? <span className="cd-stage">{live.stages[live.stages.length - 1]}<span className="cd-ell" /></span> : null}
              </div>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>

        <div className="cd-foot">
          {!busy && asks.length ? (
            <div className="cd-asks" role="group" aria-label={t("Quick asks")}>
              {asks.map((a) => <button key={a} type="button" className="cd-chip" onClick={() => (changing ? doChange(a) : ask(a))}>{a}</button>)}
            </div>
          ) : null}
          <form className="cd-compose" data-change={changing || undefined} onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={box} rows={1} aria-label={t("Message Coach")} value={draft} maxLength={2000} onKeyDown={onKey} onChange={(e) => setDraft(e.target.value)}
              placeholder={changing ? (page?.title ? t("What should change in this {page}?", { page: page.title.toLowerCase() }) : t("What should change in this page?")) : page?.title ? t("Ask about this {page}…", { page: page.title.toLowerCase() }) : t("Ask about this page…")} />
            <div className="cd-bar">
              {change ? (
                <div role="group" aria-label={t("What Coach does")} className="cd-seg">
                  <button type="button" aria-pressed={!changing} onClick={() => setChangeMode(false)}>{t("Ask")}</button>
                  <button type="button" aria-pressed={changing} onClick={() => setChangeMode(true)}>{change.label}</button>
                </div>
              ) : <span className="cd-hint">{t("Enter to send")}</span>}
              {busy ? (
                <button type="button" className="cd-send" aria-label={t("Stop")} onClick={() => abort.current?.abort()}>
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" /></svg>
                </button>
              ) : (
                <button type="submit" className="cd-send" aria-label={t("Send")} disabled={!draft.trim()}>
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
              )}
            </div>
          </form>
        </div>
      </aside>
      </div>
      {findings.length && !open ? <span aria-hidden="true" className="cd-badge">{findings.length}</span> : null}
    </ThreadContext.Provider>
  );
}
