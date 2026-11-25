// Coach settings: who answers Coach (and the workout notes, meal estimates and titles), what Coach remembers, and
// reaching this computer from a phone. Keys and sign-ins are checked and kept by the main process (ai/service.ts).
// Sections the app has nothing behind yet say so.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, Field, Select } from "@/components/ui";
import { TOOLS } from "@/lib/coach/tools";
import { factsFrom, forgetMemory, rememberOwnFact } from "@/data/coach";
import { useSyncItems } from "@/data/sync";
import {
  AIProblem, connectAI, detectLocalAI, forgetAI, listAIModels, pickAI, readAI, setAIModel, signInAI, testAI,
  type AIStatus, type ProviderView,
} from "../ai";
import { readMcp, type McpStatus } from "../mcp";
import { McpServers } from "../parts/McpServers";
import { ThisComputer } from "../parts/ThisComputer";
import "./coachSettings.css";

type Section = "display" | "instructions" | "memory" | "remote" | "mcp" | string;

/** How each provider is shown: its badge, one line about it, and what it means for the athlete's data. */
const SHOWN: Record<string, { mono: string; hue: string; line: string; note: string; guide?: string }> = {
  chatgpt: { mono: "GP", hue: "mint", line: "Your ChatGPT account", note: "Usage counts against your ChatGPT plan." },
  "claude-code": { mono: "CL", hue: "orange", line: "Your Claude subscription, through Claude Code", note: "C-LINK never reads your Claude sign-in.", guide: "https://claude.com/code" },
  "gemini-cli": { mono: "GC", hue: "cyan", line: "Gemini CLI on this computer", note: "Needs a Gemini API key or Vertex AI set up in Gemini CLI.", guide: "https://github.com/google-gemini/gemini-cli" },
  antigravity: { mono: "AG", hue: "amber", line: "Google's Antigravity agent", note: "Signing in opens Google in your browser." },
  opencode: { mono: "OC", hue: "grey", line: "OpenCode with the providers you set up in it", note: "Uses the models you connected in OpenCode.", guide: "https://opencode.ai" },
  openai: { mono: "OA", hue: "mint", line: "Your own OpenAI key", note: "" },
  anthropic: { mono: "AN", hue: "orange", line: "Your own Anthropic key", note: "" },
  gemini: { mono: "GE", hue: "blue", line: "Your own Gemini key", note: "" },
  deepseek: { mono: "DS", hue: "blue", line: "Your own DeepSeek key", note: "" },
  openrouter: { mono: "OR", hue: "iris", line: "Your own key, any model", note: "Pick a model with tool calling." },
  qwen: { mono: "QW", hue: "iris", line: "Your own Qwen key", note: "" },
  "qwen-cn": { mono: "QC", hue: "iris", line: "Your own Qwen key, China region", note: "" },
  mimo: { mono: "MI", hue: "coral", line: "Your own Xiaomi MiMo key", note: "" },
  local: { mono: "LM", hue: "mint", line: "Ollama, LM Studio or any OpenAI-compatible server", note: "Nothing leaves this computer when the server runs here." },
};

const GROUPS = [
  { group: "account", title: "Sign in" },
  { group: "key", title: "API key" },
  { group: "computer", title: "On this computer" },
] as const;

const said = (error: unknown) => (error instanceof AIProblem || error instanceof Error ? error.message : "That didn't work.");
const day = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

function Tag({ tone, children }: { tone?: "ok"; children: ReactNode }) {
  return <span className="cs-tag" data-tone={tone}>{children}</span>;
}

function Mono({ id }: { id: string }) {
  const s = SHOWN[id];
  return <span aria-hidden="true" className="cs-mono" data-hue={s?.hue ?? "grey"}>{s?.mono ?? "AI"}</span>;
}

export default function CoachSettings() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [section, setSection] = useState<Section | null>(() => new URLSearchParams(location.search).get("section"));
  const facts = factsFrom(useSyncItems("coach.memory"));
  const [phones, setPhones] = useState<{ listening: boolean; phones: { label: string; lastUsedAt: string }[] } | null>(null);
  const [pickedModels, setPickedModels] = useState<string[]>([]);
  const [mcp, setMcp] = useState<McpStatus | null>(null);

  useEffect(() => {
    void readAI().then(setStatus, (e: unknown) => setProblem(said(e)));
    fetch("/api/desktop/phones", { cache: "no-store" }).then((r) => r.json()).then(setPhones, () => setPhones(null));
    readMcp().then(setMcp, () => setMcp(null));
  }, []);
  // While a server is still starting, look again shortly.
  const connecting = mcp?.servers.some((s) => s.state === "connecting") ?? false;
  useEffect(() => {
    if (!connecting) return;
    const timer = setTimeout(() => { readMcp().then(setMcp, () => {}); }, 1500);
    return () => clearTimeout(timer);
  }, [connecting, mcp]);
  const mcpOn = mcp?.servers.reduce((n, s) => n + (s.enabled ? s.tools.filter((t) => t.on).length : 0), 0) ?? 0;

  const picked = status?.providers.find((p) => p.id === status.picked && p.ready) ?? null;
  const pickedId = picked?.id ?? null;
  // The models of the provider in use, for the picker at the top.
  useEffect(() => {
    if (!pickedId) return;
    let live = true;
    listAIModels(pickedId).then((m) => { if (live) setPickedModels(m.models); }, () => { if (live) setPickedModels([]); });
    return () => { live = false; };
  }, [pickedId]);
  const pickedChoices = picked ? [...new Set([...(picked.group === "account" ? [""] : []), picked.model, ...pickedModels])] : [];
  const lastPhone = phones?.phones.slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0] ?? null;
  const tiles = [
    { id: "instructions", label: "Instructions", value: "None", sub: "Not in this app yet" },
    { id: "memory", label: "Memory", value: facts.length === 1 ? "1 fact" : `${facts.length} facts`, sub: facts[0] ? `Last saved ${day(facts[0].at)}` : "Nothing yet" },
    { id: "remote", label: "iPhone", value: !phones ? "…" : !phones.phones.length ? "None" : phones.listening ? "Online" : "Off", sub: lastPhone?.label ?? "Only this computer" },
    { id: "mcp", label: "Tools", value: String(TOOLS.length + mcpOn), sub: mcpOn ? `${mcpOn} from MCP` : "Coach's own" },
  ];
  const shown = section ?? picked?.id ?? "memory";
  const current = status?.providers.find((p) => p.id === shown) ?? null;

  const nav = (id: Section, label: ReactNode, icon: ReactNode, tag: ReactNode = null) => (
    <button key={id} type="button" className="cs-nav-item" aria-current={shown === id ? "page" : undefined} onClick={() => setSection(id)}>
      {icon}<span className="cs-nav-label">{label}</span>{tag}
    </button>
  );
  const glyph = (g: string) => <span aria-hidden="true" className="cs-glyph">{g}</span>;

  return (
    <main className="page cs-page">
      <div className="cs-head">
        <div className="cs-head-title">
          <Link href="/coach" className="cs-back" aria-label="Back to Coach">
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          </Link>
          <h1>Coach settings</h1>
        </div>
        <span className="cs-kbd"><kbd>⌘ ,</kbd>from Coach</span>
      </div>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}

      <section className="cs-now" aria-label="Who's coaching">
        <div className="cs-now-who">
          <span aria-hidden="true" className="cs-coach"><img src="/img/coach-wave.webp" alt="" /></span>
          <div className="cs-now-what">
            <span className="cs-now-label">Coaching with</span>
            <span className="cs-now-name">
              <strong>{picked?.name ?? "No AI yet"}</strong>
              {picked ? <span className="cs-pill" data-tone="ok">{picked.group === "account" ? "Signed in" : "Connected"}</span> : null}
            </span>
            <span className="cs-line">
              {picked ? (
                <Select aria-label="Model" className="cs-now-model" value={picked.model}
                  onChange={(e) => void setAIModel(picked.id, e.target.value).then(setStatus, (err: unknown) => setProblem(said(err)))}>
                  {pickedChoices.map((m) => <option key={m} value={m}>{m || "Default"}</option>)}
                </Select>
              ) : null}
              <button type="button" className="cs-now-link" onClick={() => setSection(picked?.id ?? "claude-code")}>{picked ? "Provider settings" : "Pick one"}</button>
            </span>
          </div>
        </div>
        <div className="cs-tiles">
          {tiles.map((t) => (
            <button key={t.id} type="button" className="cs-tile" onClick={() => setSection(t.id)}>
              <span>{t.label}</span><strong>{t.value}</strong><span>{t.sub}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="cs-grid">
        <nav className="cs-nav" aria-label="Coach settings">
          <h2>Coach</h2>
          {nav("display", "Display", glyph("◧"), <Tag tone="ok">On</Tag>)}
          {nav("instructions", "Instructions", glyph("¶"))}
          {nav("memory", "Memory", glyph("✳"), facts.length ? <Tag>{facts.length}</Tag> : null)}
          {nav("remote", "Remote access", glyph("⌁"), phones?.phones.length ? <Tag tone={phones.listening ? "ok" : undefined}>{phones.listening ? "Online" : "Off"}</Tag> : null)}
          {GROUPS.map(({ group, title }) => (
            <div key={group} className="cs-nav-group">
              <h2>{title}</h2>
              {status?.providers.filter((p) => p.group === group).map((p) =>
                nav(p.id, p.group === "computer" ? "Local model" : p.name, <Mono id={p.id} />,
                  status.picked === p.id && p.ready ? <Tag tone="ok">In use</Tag> : p.ready ? <Tag>Ready</Tag> : null))}
            </div>
          ))}
          <h2>Tools</h2>
          {nav("mcp", "MCP servers", glyph("⧉"), mcp?.servers.length ? <Tag tone={mcpOn ? "ok" : undefined}>{mcpOn ? `${mcpOn} on` : mcp.servers.length}</Tag> : null)}
        </nav>

        <div className="cs-panel" key={shown}>
          {current && status ? <ProviderPage p={current} picked={status.picked === current.id} localUrl={status.localUrl} onChange={setStatus} />
            : shown === "memory" ? <Memory facts={facts} />
            : shown === "remote" ? <Panel title="Remote access"><ThisComputer /></Panel>
            : shown === "display" ? <Panel title="Display"><p className="cs-empty">Hiding charts in chat isn&apos;t in this app yet. Coach draws a chart when it fits the question.</p></Panel>
            : shown === "instructions" ? <Panel title="Instructions"><p className="cs-empty">Custom instructions aren&apos;t in this app yet. Tell Coach in a chat what to keep in mind and it saves it to Memory.</p></Panel>
            : shown === "mcp" ? <Panel title="Tools"><McpServers status={mcp} onChange={setMcp} /></Panel>
            : null}
        </div>
      </div>
    </main>
  );
}

function Panel({ title, side, children }: { title: string; side?: ReactNode; children: ReactNode }) {
  return (
    <Card pad className="cs-card">
      <div className="cs-card-head"><h2>{title}</h2>{side}</div>
      {children}
    </Card>
  );
}

function Memory({ facts }: { facts: ReturnType<typeof factsFrom> }) {
  const [text, setText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (work: Promise<void>) => work.catch((e: unknown) => setProblem(said(e)));
  const add = (e: FormEvent) => { e.preventDefault(); if (text.trim()) void run(rememberOwnFact(text).then(() => setText(""))); };
  return (
    <Panel title="What Coach remembers" side={<span className="muted">{facts.length === 1 ? "1 fact" : `${facts.length} facts`}</span>}>
      {facts.length ? (
        <ul className="cs-facts">
          {facts.map((f) => (
            <li key={f.id}>
              <span className="cs-fact-text">{f.text}</span>
              <span className="muted">{day(f.at)}</span>
              <button type="button" className="cs-x" aria-label={`Forget: ${f.text}`} onClick={() => void run(forgetMemory([f.id]))}>×</button>
            </li>
          ))}
        </ul>
      ) : <p className="cs-empty">Nothing yet. Coach saves lasting facts you tell it, like a goal race or an injury.</p>}
      <form className="cs-line" onSubmit={add}>
        <Field aria-label="New fact" placeholder="New fact" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim()}>Add</Button>
      </form>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {facts.length ? (
        <div className="cs-line">
          {clearing ? (
            <>
              <span>Forget all {facts.length}?</span>
              <Button onClick={() => { setClearing(false); void run(forgetMemory(facts.map((f) => f.id))); }}>Clear memory</Button>
              <Button variant="plain" onClick={() => setClearing(false)}>Cancel</Button>
            </>
          ) : <Button variant="plain" onClick={() => setClearing(true)}>Clear memory</Button>}
        </div>
      ) : null}
    </Panel>
  );
}

function ProviderPage({ p, picked, localUrl, onChange }: { p: ProviderView; picked: boolean; localUrl: string | null; onChange: (s: AIStatus) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(localUrl ?? "http://localhost:11434/v1");
  const [models, setModels] = useState<string[] | null>(null);
  const shown = SHOWN[p.id];

  useEffect(() => {
    if (!p.ready) return;
    let live = true;
    listAIModels(p.id).then((m) => { if (live) setModels(m.models); }, () => { if (live) setModels([]); });
    return () => { live = false; };
  }, [p.ready, p.id]);

  const run = <T,>(what: string, work: () => Promise<T>, then?: (value: T) => void) => {
    setBusy(what);
    setProblem(null);
    setTested(null);
    work().then((v) => then?.(v), (e: unknown) => setProblem(said(e))).finally(() => setBusy(null));
  };
  const update = (s: AIStatus) => { onChange(s); setKey(""); };

  const choices = [...new Set([...(p.group === "account" ? [""] : []), ...(p.model ? [p.model] : []), ...(models ?? [])])];
  const note = shown?.note || (p.group === "key" ? `The key is kept encrypted on this computer and sent only to ${p.name}.` : "");
  const status = p.ready ? (p.group === "account" ? "Signed in" : p.group === "key" ? "Key saved" : "Connected") : p.group === "account" ? "Not signed in" : "Not set up";

  return (
    <Card pad className="cs-card">
      <div className="cs-prov-head">
        <Mono id={p.id} />
        <div className="cs-prov-name">
          <div><h2>{p.group === "computer" ? "Local model" : p.name}</h2><Tag tone={p.ready ? "ok" : undefined}>{status}</Tag></div>
          <span className="muted">{shown?.line}</span>
        </div>
        {picked && p.ready ? <Tag tone="ok">Coaching now</Tag>
          : p.ready ? <Button variant="primary" disabled={!!busy} onClick={() => run("use", () => pickAI(p.id), update)}>Use for Coach</Button> : null}
      </div>

      <div className="cs-fields">
        {p.program !== undefined || (p.group === "account" && shown?.guide) ? (
          <label className="cs-field">Program
            <div className="cs-line">
              <Field readOnly value={p.program ?? ""} placeholder="Not found on this computer" />
              <Button disabled={!!busy} onClick={() => run("check", readAI, onChange)}>Check</Button>
            </div>
          </label>
        ) : null}
        {p.account ? (
          <label className="cs-field">Account
            <div className="cs-line">
              <Field readOnly value={p.account} />
              {p.canForget ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>Sign out</Button> : null}
            </div>
          </label>
        ) : null}
        {p.group === "computer" ? (
          <label className="cs-field">Server URL
            <div className="cs-line">
              <Field spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button disabled={!!busy} onClick={() => run("detect", detectLocalAI, (d) => setUrl(d.url))}>Detect</Button>
            </div>
          </label>
        ) : null}
        {p.group !== "account" ? (
          <label className="cs-field">{p.group === "computer" ? "Key (optional)" : "API key"}
            <div className="cs-line">
              {p.ready && p.group === "key"
                ? <Field readOnly value="Saved on this computer" />
                : <Field type="password" autoComplete="off" spellCheck={false} placeholder={p.keyHint} value={key} onChange={(e) => setKey(e.target.value)} />}
              {p.ready && p.group === "key"
                ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>Clear</Button>
                : <Button variant="primary" disabled={!!busy || (p.group === "key" && !key.trim())} onClick={() => run("connect", () => connectAI(p.id, p.group === "computer" ? { url, key } : { key }), update)}>{busy === "connect" ? "Checking…" : "Connect"}</Button>}
            </div>
          </label>
        ) : null}
        {p.ready ? (
          <label className="cs-field">Model
            <Select value={p.model} disabled={!!busy} onChange={(e) => run("model", () => setAIModel(p.id, e.target.value), onChange)}>
              {choices.map((m) => <option key={m} value={m}>{m || "Default"}</option>)}
            </Select>
          </label>
        ) : null}
      </div>

      {p.problem && !p.ready ? <p className="cs-empty">{p.problem}</p> : null}
      {note ? <p className="cs-note">{note}</p> : null}
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {tested ? <p className="cs-ok" role="status">{tested}</p> : null}

      <div className="cs-line">
        {shown?.guide && !p.ready ? <a className="cs-link" href={shown.guide} target="_blank" rel="noreferrer">Setup guide</a> : null}
        {p.keyPage && !p.ready ? <a className="cs-link" href={p.keyPage} target="_blank" rel="noreferrer">Get API key</a> : null}
        {p.group === "account" && !p.ready ? <Button variant="primary" disabled={!!busy} onClick={() => run("signin", () => signInAI(p.id), update)}>{busy === "signin" ? "Waiting for sign-in…" : "Sign in"}</Button> : null}
        {p.ready ? <Button disabled={!!busy} onClick={() => run("test", () => testAI(p.id), (t) => setTested(`Answered in ${(t.ms / 1000).toFixed(1)} s`))}>{busy === "test" ? "Testing…" : "Test connection"}</Button> : null}
        {p.group === "computer" && p.ready ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>Forget</Button> : null}
      </div>
    </Card>
  );
}
