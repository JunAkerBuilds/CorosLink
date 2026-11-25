// Coach's message box on the desktop: which AI answers, its model, and how hard it thinks, switched right there.
// The picks are the same ones the AI settings page makes (main process: ai/service.ts); setting a provider up
// (a key, a sign-in) still happens on that page.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { listAIModels, pickAI, readAI, readAIEfforts, setAIEffort, setAIModel, type AIStatus, type ProviderView } from "../ai";
import "./coachAI.css";

const EFFORT_NAMES: Record<string, string> = {
  none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra",
};
/** "xhigh" → "Extra high"; a level this build doesn't know keeps its own name. */
export const effortName = (level: string) => EFFORT_NAMES[level] ?? `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
/** "" → "Default", "gpt-5.5" → "GPT-5.5", "opus" → "Opus". */
const cap = (w: string) => `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
/** "" → "Default", "gpt-6.1-sol" → "GPT-6.1 Sol", "gpt-5.4-mini" → "GPT-5.4 Mini", "opus" → "Opus"; anything else as it is. */
export const modelName = (model: string) => {
  if (!model) return "Default";
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/i.exec(model);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split("-").map(cap).join(" ")}` : ""}`;
  return /^[a-z]+$/.test(model) ? cap(model) : model;
};

const SPARK = <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>;
const GAUGE = <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></svg>;
const CHEVRON = <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M6 9l6 6 6-6" /></svg>;
const CHECK = <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** Each AI's tile colour in the menu. */
const TONE: Record<string, string> = {
  chatgpt: "mint", openai: "mint", "claude-code": "orange", anthropic: "orange", "gemini-cli": "cyan", gemini: "cyan", antigravity: "cyan",
  opencode: "violet", openrouter: "violet", deepseek: "cyan", local: "honey",
};
const Tile = ({ p }: { p: ProviderView }) => (
  <span aria-hidden="true" className="cai-tile" style={{ background: `color-mix(in srgb, var(--h-${TONE[p.id] ?? "mint"}) 16%, transparent)`, color: `var(--h-${TONE[p.id] ?? "mint"}-ink)` }}>
    {p.id === "local" ? "PC" : p.name.charAt(0)}
  </span>
);

/** Each AI's models, kept while the app is open so the menu opens on them. */
const listed = new Map<string, string[]>();

/** The menu: AIs on the left, the one under the pointer's models on the right; a model picks both. */
function ModelMenu({ ready, picked, models, onChoose, close }: {
  ready: ProviderView[]; picked: ProviderView; models: string[]; onChoose: (p: ProviderView, model: string) => void; close: () => void;
}) {
  const [browse, setBrowse] = useState(picked.id);
  const [lists, setLists] = useState<Record<string, string[]>>(() => ({ ...Object.fromEntries(listed), [picked.id]: models }));
  const shown = ready.find((p) => p.id === browse) ?? picked;
  const look = (p: ProviderView) => {
    setBrowse(p.id);
    if (lists[p.id]) return;
    listAIModels(p.id).then((m) => {
      const all = m.models.length ? (m.models.includes(p.model) ? m.models : [p.model, ...m.models]) : [p.model];
      listed.set(p.id, all);
      setLists((l) => ({ ...l, [p.id]: all }));
    }, () => setLists((l) => ({ ...l, [p.id]: [p.model] })));
  };
  const list = lists[shown.id];
  return (
    <div className="cai-menu">
      {ready.length > 1 ? (
        <div className="cai-side" role="group" aria-label="AI">
          {ready.map((p) => (
            <button key={p.id} type="button" className="cai-ai" aria-current={p.id === browse ? true : undefined}
              onPointerEnter={() => look(p)} onFocus={() => look(p)} onClick={() => look(p)}>
              <Tile p={p} />
              <span><span>{p.name}</span>{p.id === picked.id ? <small>In use</small> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="cai-main" role="group" aria-label={`${shown.name} models`}>
        <span className="cai-head">{shown.name}{shown.account ? <small>{shown.account}</small> : null}</span>
        <div className="cai-list">
          {!list ? <span className="cai-wait">Loading models…</span> : list.map((m) => {
            const on = shown.id === picked.id && m === picked.model;
            return (
              <button key={m || "default"} type="button" className="cai-row" aria-pressed={on} onClick={() => { if (!on) onChoose(shown, m); close(); }}>
                <span title={m || undefined}><span>{modelName(m.includes("/") ? m.slice(m.indexOf("/") + 1) : m)}</span>{m.includes("/") ? <small>{m.slice(0, m.indexOf("/"))}</small> : null}</span>
                {on ? CHECK : null}
              </button>
            );
          })}
        </div>
        <Link href="/coach/settings" className="cai-more" onClick={close}>Set up another AI</Link>
      </div>
    </div>
  );
}

/** A pill in the message box's bar that opens a panel above it; closes on a click outside or Escape. */
function Pop({ label, title, pill, wide, children }: { label: string; title: string; pill: ReactNode; wide?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="cai" ref={root}>
      <button type="button" className="co-model" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} title={title} onClick={() => setOpen((o) => !o)}>
        {pill}
      </button>
      {open ? <div id={id} role="dialog" aria-label={label} className="cai-pop" data-wide={wide || undefined}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

interface Loaded { status: AIStatus; models: string[]; efforts: { levels: string[]; default?: string } }

/** The picked provider's models and power levels, next to the status they belong to. */
async function load(status: AIStatus): Promise<Loaded> {
  const p = status.providers.find((x) => x.id === status.picked && x.ready);
  if (!p) return { status, models: [], efforts: { levels: [] } };
  const [m, e] = await Promise.all([
    listAIModels(p.id).catch(() => ({ models: [] as string[], model: p.model })),
    readAIEfforts(p.id, p.model).catch(() => ({ levels: [] as string[] })),
  ]);
  return { status, models: m.models.includes(p.model) ? m.models : [p.model, ...m.models], efforts: e };
}

export function CoachAI() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [efforts, setEfforts] = useState<{ levels: string[]; default?: string }>({ levels: [] });
  const [problem, setProblem] = useState<string | null>(null);

  const picked: ProviderView | undefined = status?.providers.find((p) => p.id === status.picked && p.ready);
  const ready = status?.providers.filter((p) => p.ready) ?? [];

  const show = (v: Loaded) => { setStatus(v.status); setModels(v.models); setEfforts(v.efforts); };

  useEffect(() => {
    let on = true;
    readAI().then(load).then((v) => { if (on) show(v); }, () => { if (on) setProblem("Couldn't read the AI settings."); });
    return () => { on = false; };
  }, []);

  const run = (work: Promise<AIStatus>) => {
    setProblem(null);
    work.then(load).then(show).catch((e: unknown) => setProblem(e instanceof Error ? e.message : "That didn't work."));
  };

  if (!status) return null;
  if (!picked) {
    return <Link href="/coach/settings" className="co-model" title="Set up Coach's AI">{SPARK}<span>Set up AI</span></Link>;
  }

  const saved = efforts.levels.includes(picked.effort) ? picked.effort : "";
  const shownEffort = saved ? effortName(saved) : "Default";
  // On Default the track shows the model's own level, when it says.
  const at = saved ? efforts.levels.indexOf(saved) : efforts.default ? efforts.levels.indexOf(efforts.default) : -1;

  return (
    <>
      <Pop wide label="Coach's AI" title={`${picked.name} · ${modelName(picked.model)}`}
        pill={<>{SPARK}<span>{picked.name}<span className="cai-dim"> · {modelName(picked.model)}</span></span>{CHEVRON}</>}>
        {(close) => (
          <ModelMenu ready={ready} picked={picked} models={models} close={close}
            onChoose={(p, m) => run(p.id === picked.id ? setAIModel(p.id, m) : pickAI(p.id, m))} />
        )}
      </Pop>
      {efforts.levels.length ? (
        <Pop label="Power" title={`Power: ${shownEffort}`} pill={<>{GAUGE}<span>{shownEffort}</span>{CHEVRON}</>}>
          {() => (
            <div className="cai-power">
              <div className="cai-power-head">
                <span>
                  <strong>{shownEffort}</strong>
                  <small>{!saved && efforts.default ? `${effortName(efforts.default)} · ` : ""}{picked.name} · {modelName(picked.model)}</small>
                </span>
                <button type="button" className="cai-reset" disabled={!saved} onClick={() => run(setAIEffort(picked.id, ""))}>Default</button>
              </div>
              <div className="cai-steps" role="radiogroup" aria-label="Power" data-default={saved ? undefined : true}>
                {efforts.levels.map((level, i) => (
                  <button key={level} type="button" role="radio" aria-checked={level === saved} aria-label={effortName(level)} title={effortName(level)}
                    className="cai-step" data-on={i <= at ? true : undefined} onClick={() => run(setAIEffort(picked.id, level))} />
                ))}
              </div>
              <div className="cai-ends" aria-hidden="true"><span>{effortName(efforts.levels[0])}</span><span>{effortName(efforts.levels[efforts.levels.length - 1])}</span></div>
              <p>Higher thinks longer before answering: slower, and uses more of your plan.</p>
            </div>
          )}
        </Pop>
      ) : null}
      {problem ? <span className="cai-problem" role="status">{problem}</span> : null}
    </>
  );
}
