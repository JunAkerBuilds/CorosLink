// Watchmaker, the inspector's AI tab (main: watchface/watchmaker). A chat that edits the open face live: each applied
// step is one undo step, and Stop interrupts. Pictures pasted, dropped or attached go with the message as a design
// reference or a screenshot. It always runs the athlete's own Codex CLI, with Codex's sign-in, model and harness
// (shell and image generation in a temporary folder), so the bar shows Codex rather than Coach's AI pills.
// Chats are saved with the face. Loaded on demand.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { dateText, language, locale, t, tx } from "@/lib/i18n";
import { Icon } from "./StudioIcon";
// The chat list menu uses its menu colours.
import "./coachAI.css";
import "./studioWatchmaker.css";

interface Picture { assetId: string; why?: string }
interface Step { tool: string; label: string; ok: boolean; message?: string }
interface PlanItem { text: string; status: "pending" | "doing" | "done" }
export interface ChatMessage {
  id: string; role: "user" | "assistant"; at: string; text: string;
  attachments?: (Picture & { use: "reference" | "screenshot" })[];
  steps?: Step[]; pictures?: Picture[]; plan?: PlanItem[]; edits?: number; stopped?: boolean; error?: string; by?: string;
}
interface ChatSummary { id: string; title: string; updatedAt: string; messages: number }
interface Attachment { dataUrl: string; use: "reference" | "screenshot" }
interface Status { ready: boolean; label: string; account?: string; problem?: string; running: string[] }

const BASE = "/api/desktop/studio/watchmaker";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_ATTACHMENTS = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const assetUrl = (id: string) => `/api/desktop/studio/automation/asset/${id}`;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json", "x-clink-hub": "1" }, body: JSON.stringify(body) });
  const json = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok || !json) throw new Error(json?.message ?? t("That didn't work."));
  return json;
}

const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error(t("That picture can't be read.")));
  reader.readAsDataURL(file);
});

/** "3 min ago", "Yesterday"… for the chat list. */
function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{mins} min ago", { mins: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{hours} h ago", { hours });
  return dateText(new Date(iso), language() === "en" ? undefined : locale(), { day: "numeric", month: "short" });
}

const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => <p key={i}>{p}</p>);

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  // Sections start open (every Studio panel does).
  return (
    <details className="st-wm-sec" open>
      <summary><span>{title}</span><span className="st-fold-note">{note}<Icon name="chevD" size={13} /></span></summary>
      {children}
    </details>
  );
}

function Answer({ m, working }: { m: ChatMessage; working: boolean }) {
  const steps = m.steps ?? [];
  const failed = steps.filter((s) => !s.ok).length;
  return (
    <div className="st-wm-msg" data-role="assistant">
      <span className="st-wm-who"><Icon name="spark" size={13} />Watchmaker{m.by ? <small>{m.by}</small> : null}</span>
      {m.plan?.length ? (
        <Section title={t("Plan")} note={`${m.plan.filter((p) => p.status === "done").length}/${m.plan.length}`}>
          <ul className="st-wm-plan">{m.plan.map((p, i) => <li key={i} data-status={p.status}><Icon name={p.status === "done" ? "check" : p.status === "doing" ? "refresh" : "minus"} size={12} />{p.text}</li>)}</ul>
        </Section>
      ) : null}
      {m.text ? <div className="st-wm-text">{paragraphs(m.text)}</div> : working ? <p className="st-wm-thinking">{steps.at(-1)?.label ? `${steps.at(-1)!.label}…` : t("Thinking…")}</p> : null}
      {m.pictures?.length ? (
        <div className="st-wm-pics">{m.pictures.slice(-6).map((p, i) => <a key={`${p.assetId}${i}`} href={assetUrl(p.assetId)} target="_blank" rel="noreferrer" title={p.why}><img src={assetUrl(p.assetId)} alt={p.why ?? t("Picture")} /></a>)}</div>
      ) : null}
      {steps.length ? (
        <Section title={tx("process", "Steps")} note={failed ? `${steps.length} · ${t("{n} failed", { n: failed })}` : String(steps.length)}>
          <ol className="st-wm-steps">
            {steps.map((s, i) => (
              <li key={i} data-ok={s.ok} title={s.message}>
                <Icon name={!s.ok ? "warn" : working && i === steps.length - 1 ? "refresh" : "check"} size={12} />{s.label}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      {m.edits ? <p className="st-wm-note"><Icon name="undo" size={12} />{m.edits === 1 ? t("1 step on the face.") : t("{n} steps on the face.", { n: m.edits })} {t("Undo with ⌘Z.")}</p> : null}
      {m.stopped ? <p className="st-wm-note">{t("Stopped.")}</p> : null}
      {m.error ? <p className="st-wm-error" role="alert">{m.error}</p> : null}
    </div>
  );
}

export default function StudioWatchmaker({ projectId }: { projectId: string }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [engine, setEngine] = useState<Status | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => call<{ chats: ChatSummary[] }>(`/chats?project=${projectId}`).then((r) => { setChats(r.chats); return r.chats; }), [projectId]);
  const open = useCallback(async (id: string | null) => {
    setProblem(null); setListOpen(false);
    if (!id) { setChatId(null); setMessages([]); return; }
    try { const { chat } = await call<{ chat: { id: string; messages: ChatMessage[] } }>(`/chats/${id}?project=${projectId}`); setChatId(chat.id); setMessages(chat.messages); } catch (e) { setProblem(e instanceof Error ? e.message : t("That chat couldn't be opened.")); }
  }, [projectId]);
  // The face's latest chat opens with it; a run still going (after a reload) shows as working.
  useEffect(() => {
    let live = true;
    void refresh().then((list) => { if (live && list[0]) void open(list[0].id); }).catch(() => undefined);
    void call<Status>("").then((s) => { if (live) { setEngine(s); setRunning(s.running.includes(projectId)); } }).catch(() => undefined);
    return () => { live = false; };
  }, [projectId, refresh, open]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages]);
  // A run this panel didn't start (it was reopened mid-run) is followed by asking until it ends, then the chat reloads.
  const streaming = useRef(false);
  useEffect(() => {
    if (!running || streaming.current) return;
    const timer = setInterval(() => {
      void call<Status>("").then((s) => {
        if (s.running.includes(projectId)) return;
        setRunning(false);
        void refresh().then((list) => { if (list[0]) void open(list[0].id); });
      }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [running, projectId, refresh, open]);

  const attach = async (files: File[]) => {
    setProblem(null);
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (!images.length) { if (files.length) setProblem(t("Pictures go in as PNG, JPEG or WebP.")); return; }
    if (images.some((f) => f.size > MAX_BYTES)) { setProblem(t("Pictures go in up to 8 MB each.")); return; }
    const read = await Promise.all(images.slice(0, MAX_ATTACHMENTS - attachments.length).map(readFile)).catch(() => null);
    if (!read) { setProblem(t("That picture can't be read.")); return; }
    // The first picture of a chat is the design reference; later ones are taken as screenshots.
    const use = messages.some((m) => m.attachments?.some((a) => a.use === "reference")) ? "screenshot" : "reference";
    setAttachments((a) => [...a, ...read.map((dataUrl) => ({ dataUrl, use }) as Attachment)].slice(0, MAX_ATTACHMENTS));
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); void attach(files); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDropping(false); void attach([...e.dataTransfer.files]); };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || running) return;
    setProblem(null); streaming.current = true; setRunning(true);
    const sentAttachments = attachments;
    setDraft(""); setAttachments([]);
    try {
      const response = await fetch(`${BASE}/send`, { method: "POST", headers: { "Content-Type": "application/json", "x-clink-hub": "1" }, body: JSON.stringify({ project: projectId, chatId, text, attachments: sentAttachments }) });
      if (!response.ok || !response.body) {
        const json = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? t("Watchmaker couldn't start."));
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "", answerId = "";
      const update = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === answerId ? fn(m) : m)));
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as Record<string, unknown> & { t: string };
          if (e.t === "start") {
            const answer = e.answer as { id: string; by?: string };
            answerId = answer.id;
            setChatId((e.chat as { id: string }).id);
            setMessages((all) => [...all, e.asked as ChatMessage, { id: answer.id, role: "assistant", at: "", text: "", by: answer.by, steps: [], pictures: [] }]);
          } else if (e.t === "text") update((m) => ({ ...m, text: m.text + String(e.delta) }));
          else if (e.t === "step") update((m) => ({ ...m, steps: [...(m.steps ?? []), { tool: String(e.tool), label: String(e.label), ok: true }] }));
          else if (e.t === "step-done") update((m) => ({ ...m, steps: (m.steps ?? []).map((s, i, all) => (i === all.length - 1 ? { ...s, ok: e.ok === true, message: e.message as string | undefined } : s)) }));
          else if (e.t === "picture") update((m) => ({ ...m, pictures: [...(m.pictures ?? []), { assetId: String(e.assetId), why: String(e.why) }] }));
          else if (e.t === "plan") update((m) => ({ ...m, plan: e.items as PlanItem[] }));
          else if (e.t === "edit") update((m) => ({ ...m, edits: (m.edits ?? 0) + 1 }));
          else if (e.t === "done") update(() => e.message as ChatMessage);
        }
      }
      void refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("Watchmaker couldn't finish."));
      setDraft((d) => d || text); setAttachments((a) => (a.length ? a : sentAttachments));
    } finally {
      streaming.current = false;
      setRunning(false);
    }
  };
  const stop = () => { void call("/stop", { project: projectId }).catch(() => undefined); };
  const remove = async (id: string) => {
    const { chats: left } = await call<{ chats: ChatSummary[] }>(`/chats/${id}/delete`, { project: projectId });
    setChats(left);
    if (id === chatId) void open(null);
  };

  const title = chats.find((c) => c.id === chatId)?.title ?? t("New chat");
  const workingId = running ? messages.at(-1)?.id : undefined;

  return (
    <div className="st-wm" data-dropping={dropping || undefined} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }} onDrop={onDrop}>
      <div className="st-wm-head">
        <button type="button" className="st-wm-title" aria-haspopup="menu" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)} disabled={running}>
          <span>{title}</span><Icon name="chevD" size={13} />
        </button>
        <button type="button" className="st-icon-btn" aria-label={t("New chat")} title={t("New chat")} disabled={running || !chatId} onClick={() => void open(null)}><Icon name="plus" size={16} /></button>
        {listOpen ? (
          <div className="st-wm-list" role="menu" aria-label={t("Chats for this face")}>
            {chats.length ? chats.map((c) => (
              <div key={c.id} className="st-wm-list-row" data-on={c.id === chatId || undefined}>
                <button type="button" role="menuitem" onClick={() => void open(c.id)}><b>{c.title}</b><small>{ago(c.updatedAt)}</small></button>
                <button type="button" className="st-icon-btn" aria-label={t("Delete {name}", { name: c.title })} onClick={() => void remove(c.id)}><Icon name="trash" size={14} /></button>
              </div>
            )) : <p className="st-wm-empty-list">{t("No chats yet.")}</p>}
          </div>
        ) : null}
      </div>

      <div className="st-wm-scroll" ref={scroller}>
        {messages.length ? messages.map((m) => (m.role === "user" ? (
          <div key={m.id} className="st-wm-msg" data-role="user">
            {m.attachments?.length ? <div className="st-wm-pics">{m.attachments.map((a, i) => <span key={i} className="st-wm-att"><img src={assetUrl(a.assetId)} alt={a.use === "reference" ? t("Design reference") : t("Screenshot")} /><small>{a.use === "reference" ? t("Reference") : t("Screenshot")}</small></span>)}</div> : null}
            {m.text ? <div className="st-wm-text">{paragraphs(m.text)}</div> : null}
          </div>
        ) : <Answer key={m.id} m={m} working={m.id === workingId} />)) : (
          <div className="st-wm-empty">
            <Icon name="spark" size={22} />
            <b>{t("What should change?")}</b>
            <p>{t("It edits this face as you watch. Each step can be undone.")}</p>
            {engine && !engine.ready ? <p className="st-wm-error" role="alert">{engine.problem}</p> : null}
            <p className="st-wm-notice">{t("Codex works in a temporary folder with its own shell, web access and image generation. Its shell work isn't part of Undo.")}</p>
          </div>
        )}
      </div>

      <div className="st-wm-compose">
        {problem ? <p className="st-wm-error" role="alert">{problem}</p> : null}
        {attachments.length ? (
          <div className="st-wm-chips">
            {attachments.map((a, i) => (
              <span key={i} className="st-wm-chip">
                <img src={a.dataUrl} alt="" />
                <button type="button" className="st-wm-use" title={t("Use as")} onClick={() => setAttachments((all) => all.map((x, j) => (j === i ? { ...x, use: x.use === "reference" ? "screenshot" : "reference" } : x)))}>
                  {a.use === "reference" ? t("Reference") : t("Screenshot")}
                </button>
                <button type="button" className="st-wm-x" aria-label={t("Remove picture {n}", { n: i + 1 })} onClick={() => setAttachments((all) => all.filter((_, j) => j !== i))}><Icon name="close" size={11} /></button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea aria-label={t("Message Watchmaker")} placeholder={running ? t("Watchmaker is working…") : t("Describe a change, or paste a picture")} value={draft} rows={3}
          onChange={(e) => setDraft(e.target.value)} onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <div className="st-wm-bar">
          <button type="button" className="st-icon-btn" aria-label={t("Attach pictures")} title={t("Attach pictures")} disabled={attachments.length >= MAX_ATTACHMENTS} onClick={() => fileInput.current?.click()}><Icon name="attach" size={16} /></button>
          <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <span className="st-wm-engine" title={engine?.label ?? "Codex CLI"} data-off={engine && !engine.ready ? true : undefined}>
            <Icon name="spark" size={12} />{engine?.label ?? "Codex CLI"}
          </span>
          {running
            ? <button type="button" className="st-wm-send" data-stop aria-label={t("Stop")} title={t("Stop")} onClick={stop}><Icon name="pause" size={15} /></button>
            : <button type="button" className="st-wm-send" aria-label={t("Send")} title={t("Send")} disabled={!draft.trim() && !attachments.length} onClick={() => void send()}><Icon name="send" size={15} /></button>}
        </div>
      </div>
    </div>
  );
}
