// Coach settings: who answers Coach (and the workout notes, meal estimates and titles), what Coach remembers, and
// reaching this computer from a phone. Keys and sign-ins are checked and kept by the main process (ai/service.ts).
// Sections the app has nothing behind yet say so.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, Field, Select } from "@/components/ui";
import { TOOLS } from "@/lib/coach/tools";
import { factsFrom, forgetMemory, rememberOwnFact } from "@/data/coach";
import { useSyncItems } from "@/data/sync";
import {
  AIProblem, connectAI, detectLocalAI, forgetAI, listAIModels, pickAI, readAI, readAIProvider, setAIModel, setAIProgram, signInAI, testAI,
  type AIStatus, type ProviderView,
} from "../ai";
import { readMcp, type McpStatus } from "../mcp";
import { McpServers } from "../parts/McpServers";
import { ThisComputer } from "../parts/ThisComputer";
import { dateText, language, locale, msg, t, tx } from "@/lib/i18n";
import "./coachSettings.css";

type Section = "display" | "instructions" | "memory" | "remote" | "mcp" | string;

/** How each provider is shown: its badge, one line about it, and what it means for the athlete's data. */
const SHOWN: Record<string, { mono: string; hue: string; line: string; note: string; guide?: string }> = {
  chatgpt: { mono: "GP", hue: "mint", line: msg("Your ChatGPT account"), note: msg("Usage counts against your ChatGPT plan.") },
  "claude-code": { mono: "CL", hue: "orange", line: msg("Your Claude subscription, through Claude Code"), note: msg("C-LINK never reads your Claude sign-in."), guide: "https://claude.com/code" },
  "gemini-cli": { mono: "GC", hue: "cyan", line: msg("Gemini CLI on this computer"), note: msg("Needs a Gemini API key or Vertex AI set up in Gemini CLI."), guide: "https://github.com/google-gemini/gemini-cli" },
  antigravity: { mono: "AG", hue: "amber", line: msg("Google's Antigravity agent"), note: msg("Signing in opens Google in your browser.") },
  opencode: { mono: "OC", hue: "grey", line: msg("OpenCode with the providers you set up in it"), note: msg("Uses the models you connected in OpenCode."), guide: "https://opencode.ai" },
  openai: { mono: "OA", hue: "mint", line: msg("Your own OpenAI key"), note: "" },
  anthropic: { mono: "AN", hue: "orange", line: msg("Your own Anthropic key"), note: "" },
  gemini: { mono: "GE", hue: "blue", line: msg("Your own Gemini key"), note: "" },
  deepseek: { mono: "DS", hue: "blue", line: msg("Your own DeepSeek key"), note: "" },
  openrouter: { mono: "OR", hue: "iris", line: msg("Your own key, any model"), note: msg("Pick a model with tool calling.") },
  qwen: { mono: "QW", hue: "iris", line: msg("Your own Qwen key"), note: "" },
  "qwen-cn": { mono: "QC", hue: "iris", line: msg("Your own Qwen key, China region"), note: "" },
  mimo: { mono: "MI", hue: "coral", line: msg("Your own Xiaomi MiMo key"), note: "" },
  local: { mono: "LM", hue: "mint", line: msg("Ollama, LM Studio or any OpenAI-compatible server"), note: msg("Nothing leaves this computer when the server runs here.") },
};

const GROUPS = [
  { group: "account", title: msg("Sign in") },
  { group: "key", title: msg("API key") },
  { group: "computer", title: msg("On this computer") },
] as const;

const said = (error: unknown) => (error instanceof AIProblem || error instanceof Error ? error.message : t("That didn't work."));
const day = (ms: number) => (ms ? dateText(new Date(ms), language() === "en" ? undefined : locale(), { day: "numeric", month: "short" }) : "");

function Tag({ tone, children }: { tone?: "ok"; children: ReactNode }) {
  return <span className="cs-tag" data-tone={tone}>{children}</span>;
}

function Mono({ id }: { id: string }) {
  const s = SHOWN[id];
  return <span aria-hidden="true" className="cs-mono" data-hue={s?.hue ?? "grey"}>{s?.mono ?? "AI"}</span>;
}

export default function CoachSettings() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const replaceProvider = useCallback((v: ProviderView) => setStatus((s) => s && { ...s, providers: s.providers.map((x) => (x.id === v.id ? v : x)) }), []);
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
  const mcpOn = mcp?.servers.reduce((n, s) => n + (s.enabled ? s.tools.filter((tool) => tool.on).length : 0), 0) ?? 0;

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
    { id: "instructions", label: t("Instructions"), value: t("None"), sub: t("Not in this app yet") },
    { id: "memory", label: t("Memory"), value: facts.length === 1 ? t("1 fact") : t("{n} facts", { n: facts.length }), sub: facts[0] ? t("Last saved {date}", { date: day(facts[0].at) }) : t("Nothing yet") },
    { id: "remote", label: "iPhone", value: !phones ? "…" : !phones.phones.length ? t("None") : phones.listening ? t("Online") : t("Off"), sub: lastPhone?.label ?? t("Only this computer") },
    { id: "mcp", label: t("Tools"), value: String(TOOLS.length + mcpOn), sub: mcpOn ? t("{n} from MCP", { n: mcpOn }) : t("Coach's own") },
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
          <Link href="/coach" className="cs-back" aria-label={t("Back to Coach")}>
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          </Link>
          <h1>{t("Coach settings")}</h1>
        </div>
        <span className="cs-kbd"><kbd>⌘ ,</kbd>{t("from Coach")}</span>
      </div>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}

      <section className="cs-now" aria-label={t("Who's coaching")}>
        <div className="cs-now-who">
          <span aria-hidden="true" className="cs-coach"><img src="/img/coach-wave.webp" alt="" /></span>
          <div className="cs-now-what">
            <span className="cs-now-label">{t("Coaching with")}</span>
            <span className="cs-now-name">
              <strong>{picked?.name ?? t("No AI yet")}</strong>
              {picked ? <span className="cs-pill" data-tone="ok">{picked.group === "account" ? t("Signed in") : t("Connected")}</span> : null}
            </span>
            <span className="cs-line">
              {picked ? (
                <Select aria-label={t("Model")} className="cs-now-model" value={picked.model}
                  onChange={(e) => void setAIModel(picked.id, e.target.value).then(setStatus, (err: unknown) => setProblem(said(err)))}>
                  {pickedChoices.map((m) => <option key={m} value={m}>{m || t("Default")}</option>)}
                </Select>
              ) : null}
              <button type="button" className="cs-now-link" onClick={() => setSection(picked?.id ?? "claude-code")}>{picked ? t("Provider settings") : t("Pick one")}</button>
            </span>
          </div>
        </div>
        <div className="cs-tiles">
          {tiles.map((tile) => (
            <button key={tile.id} type="button" className="cs-tile" onClick={() => setSection(tile.id)}>
              <span>{tile.label}</span><strong>{tile.value}</strong><span>{tile.sub}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="cs-grid">
        <nav className="cs-nav" aria-label={t("Coach settings")}>
          <h2>{t("Coach")}</h2>
          {nav("display", t("Display"), glyph("◧"), <Tag tone="ok">{t("On")}</Tag>)}
          {nav("instructions", t("Instructions"), glyph("¶"))}
          {nav("memory", t("Memory"), glyph("✳"), facts.length ? <Tag>{facts.length}</Tag> : null)}
          {nav("remote", t("Remote access"), glyph("⌁"), phones?.phones.length ? <Tag tone={phones.listening ? "ok" : undefined}>{phones.listening ? t("Online") : t("Off")}</Tag> : null)}
          {GROUPS.map(({ group, title }) => (
            <div key={group} className="cs-nav-group">
              <h2>{t(title)}</h2>
              {status?.providers.filter((p) => p.group === group).map((p) =>
                nav(p.id, p.group === "computer" ? t("Local model") : p.name, <Mono id={p.id} />,
                  status.picked === p.id && p.ready ? <Tag tone="ok">{t("In use")}</Tag> : p.ready ? <Tag>{tx("set up", "Ready")}</Tag> : null))}
            </div>
          ))}
          <h2>{t("Tools")}</h2>
          {nav("mcp", t("MCP servers"), glyph("⧉"), mcp?.servers.length ? <Tag tone={mcpOn ? "ok" : undefined}>{mcpOn ? t("{n} on", { n: mcpOn }) : mcp.servers.length}</Tag> : null)}
        </nav>

        <div className="cs-panel" key={shown}>
          {current && status ? <ProviderPage p={current} picked={status.picked === current.id} localUrl={status.localUrl} onChange={setStatus}
            onProvider={replaceProvider} />
            : shown === "memory" ? <Memory facts={facts} />
            : shown === "remote" ? <Panel title={t("Remote access")}><ThisComputer /></Panel>
            : shown === "display" ? <Panel title={t("Display")}><p className="cs-empty">{t("Hiding charts in chat isn't in this app yet. Coach draws a chart when it fits the question.")}</p></Panel>
            : shown === "instructions" ? <Panel title={t("Instructions")}><p className="cs-empty">{t("Custom instructions aren't in this app yet. Tell Coach in a chat what to keep in mind and it saves it to Memory.")}</p></Panel>
            : shown === "mcp" ? <Panel title={t("Tools")}><McpServers status={mcp} onChange={setMcp} /></Panel>
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
    <Panel title={t("What Coach remembers")} side={<span className="muted">{facts.length === 1 ? t("1 fact") : t("{n} facts", { n: facts.length })}</span>}>
      {facts.length ? (
        <ul className="cs-facts">
          {facts.map((f) => (
            <li key={f.id}>
              <span className="cs-fact-text">{f.text}</span>
              <span className="muted">{day(f.at)}</span>
              <button type="button" className="cs-x" aria-label={t("Forget: {fact}", { fact: f.text })} onClick={() => void run(forgetMemory([f.id]))}>×</button>
            </li>
          ))}
        </ul>
      ) : <p className="cs-empty">{t("Nothing yet. Coach saves lasting facts you tell it, like a goal race or an injury.")}</p>}
      <form className="cs-line" onSubmit={add}>
        <Field aria-label={t("New fact")} placeholder={t("New fact")} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim()}>{t("Add")}</Button>
      </form>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {facts.length ? (
        <div className="cs-line">
          {clearing ? (
            <>
              <span>{t("Forget all {n}?", { n: facts.length })}</span>
              <Button onClick={() => { setClearing(false); void run(forgetMemory(facts.map((f) => f.id))); }}>{t("Clear memory")}</Button>
              <Button variant="plain" onClick={() => setClearing(false)}>{t("Cancel")}</Button>
            </>
          ) : <Button variant="plain" onClick={() => setClearing(true)}>{t("Clear memory")}</Button>}
        </div>
      ) : null}
    </Panel>
  );
}

function ProviderPage({ p, picked, localUrl, onChange, onProvider }: { p: ProviderView; picked: boolean; localUrl: string | null; onChange: (s: AIStatus) => void; onProvider: (v: ProviderView) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(localUrl ?? "http://localhost:11434/v1");
  const [models, setModels] = useState<string[] | null>(null);
  // What the athlete typed under Program; null shows where C-LINK found it.
  const [typed, setTyped] = useState<string | null>(null);
  const program = typed ?? p.program ?? "";
  const shown = SHOWN[p.id];

  // While a sign-in is open in the browser, look again every few seconds; once it's done it's picked for Coach, as a
  // sign-in that finishes at once is.
  useEffect(() => {
    if (!p.signingIn) return;
    let live = true;
    const timer = setInterval(() => {
      readAIProvider(p.id).then(async (r) => {
        if (!live) return;
        if (r.provider.ready) { live = false; onChange(await pickAI(p.id)); } else onProvider(r.provider);
      }, () => {});
    }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [p.signingIn, p.id, onProvider, onChange]);

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
  const note = shown?.note ? t(shown.note) : p.group === "key" ? t("The key is kept encrypted on this computer and sent only to {provider}.", { provider: p.name }) : "";
  const status = p.ready ? (p.group === "account" ? t("Signed in") : p.group === "key" ? t("Key saved") : t("Connected")) : p.group === "account" ? t("Not signed in") : t("Not set up");

  return (
    <Card pad className="cs-card">
      <div className="cs-prov-head">
        <Mono id={p.id} />
        <div className="cs-prov-name">
          <div><h2>{p.group === "computer" ? t("Local model") : p.name}</h2><Tag tone={p.ready ? "ok" : undefined}>{status}</Tag></div>
          <span className="muted">{shown ? t(shown.line) : null}</span>
        </div>
        {picked && p.ready ? <Tag tone="ok">{t("Coaching now")}</Tag>
          : p.ready ? <Button variant="primary" disabled={!!busy} onClick={() => run("use", () => pickAI(p.id), update)}>{t("Use for Coach")}</Button> : null}
      </div>

      <div className="cs-fields">
        {p.program !== undefined || (p.group === "account" && shown?.guide) ? (
          <label className="cs-field">{t("Program")}
            <div className="cs-line">
              {/* Typed when C-LINK can't find the program; Check keeps it, and an empty field looks again. */}
              <Field readOnly={!p.programName} spellCheck={false} value={program} onChange={(e) => setTyped(e.target.value)} placeholder={t("Not found on this computer")} />
              <Button disabled={!!busy} onClick={() => run("check", () => (p.programName && program.trim() !== (p.program ?? "") ? setAIProgram(p.id, program) : readAI()), (s) => { setTyped(null); onChange(s); })}>{t("Check")}</Button>
            </div>
          </label>
        ) : null}
        {p.account ? (
          <label className="cs-field">{t("Account")}
            <div className="cs-line">
              <Field readOnly value={p.account} />
              {p.canForget ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>{t("Sign out")}</Button> : null}
            </div>
          </label>
        ) : null}
        {p.group === "computer" ? (
          <label className="cs-field">{t("Server URL")}
            <div className="cs-line">
              <Field spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button disabled={!!busy} onClick={() => run("detect", detectLocalAI, (d) => setUrl(d.url))}>{t("Detect")}</Button>
            </div>
          </label>
        ) : null}
        {p.group !== "account" ? (
          <label className="cs-field">{p.group === "computer" ? t("Key (optional)") : t("API key")}
            <div className="cs-line">
              {p.ready && p.group === "key"
                ? <Field readOnly value={t("Saved on this computer")} />
                : <Field type="password" autoComplete="off" spellCheck={false} placeholder={p.keyHint} value={key} onChange={(e) => setKey(e.target.value)} />}
              {p.ready && p.group === "key"
                ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>{t("Clear")}</Button>
                : <Button variant="primary" disabled={!!busy || (p.group === "key" && !key.trim())} onClick={() => run("connect", () => connectAI(p.id, p.group === "computer" ? { url, key } : { key }), update)}>{busy === "connect" ? t("Checking…") : t("Connect")}</Button>}
            </div>
          </label>
        ) : null}
        {p.ready ? (
          <label className="cs-field">{t("Model")}
            <Select value={p.model} disabled={!!busy} onChange={(e) => run("model", () => setAIModel(p.id, e.target.value), onChange)}>
              {choices.map((m) => <option key={m} value={m}>{m || t("Default")}</option>)}
            </Select>
          </label>
        ) : null}
      </div>

      {p.problem && !p.ready ? <p className="cs-empty">{p.problem}</p> : null}
      {note ? <p className="cs-note">{note}</p> : null}
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {tested ? <p className="cs-ok" role="status">{tested}</p> : null}

      <div className="cs-line">
        {shown?.guide && !p.ready ? <a className="cs-link" href={shown.guide} target="_blank" rel="noreferrer">{t("Setup guide")}</a> : null}
        {p.keyPage && !p.ready ? <a className="cs-link" href={p.keyPage} target="_blank" rel="noreferrer">{t("Get API key")}</a> : null}
        {p.group === "account" && !p.ready ? <Button variant="primary" disabled={!!busy} onClick={() => run("signin", () => signInAI(p.id), update)}>{busy === "signin" ? t("Waiting for sign-in…") : t("Sign in")}</Button> : null}
        {p.ready ? <Button disabled={!!busy} onClick={() => run("test", () => testAI(p.id), (answer) => setTested(t("Answered in {s} s", { s: (answer.ms / 1000).toFixed(1) })))}>{busy === "test" ? t("Testing…") : t("Test connection")}</Button> : null}
        {p.group === "computer" && p.ready ? <Button disabled={!!busy} onClick={() => run("forget", () => forgetAI(p.id), update)}>{t("Forget")}</Button> : null}
      </div>
    </Card>
  );
}
