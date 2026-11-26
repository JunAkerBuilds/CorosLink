// Coach settings → Tools: Coach's own tools, and the athlete's MCP servers with each one's tools turned on or off.
// Servers are started and reached by the main process (desktop/main/ai/mcp.ts); a tool is off until turned on here.
import { useState, type FormEvent } from "react";
import { Button, Field, Segmented, Switch } from "@/components/ui";
import { TOOLS } from "@/lib/coach/tools";
import {
  addMcp, enableMcp, parsePairs, reconnectMcp, removeMcp, setMcpTool, setMcpTools, signInMcp, signOutMcp, splitCommand,
  type McpServerInput, type McpServerView, type McpStatus,
} from "../mcp";
import { msg, t } from "@/lib/i18n";

/** Hosted servers with browser sign-in, one click to add. */
const PRESETS: { name: string; url: string; line: string }[] = [
  { name: "Strava", url: "https://mcp.strava.com/mcp", line: msg("Activities and routes") },
  { name: "Hevy", url: "https://mcp.hevy-mcp.dev/mcp", line: msg("Gym workouts · Hevy Pro") },
  { name: "Freddy", url: "https://freddy.coach/mcp", line: msg("Training and recovery") },
];

const said = (e: unknown) => (e instanceof Error ? e.message : t("That didn't work."));

function stateWords(s: McpServerView): { text: string; tone?: "ok" | "bad" } {
  if (!s.enabled) return { text: t("Off") };
  if (s.state === "connected") return { text: s.tools.length === 1 ? t("1 tool") : t("{n} tools", { n: s.tools.length }), tone: "ok" };
  if (s.state === "connecting") return { text: t("Connecting…") };
  if (s.state === "signin" || (s.auth === "oauth" && !s.signedIn)) return { text: t("Sign in needed"), tone: "bad" };
  if (s.state === "error") return { text: t("Error"), tone: "bad" };
  return { text: t("Not connected") };
}

export function McpServers({ status, onChange }: { status: McpStatus | null; onChange: (s: McpStatus) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);

  const run = (what: string, work: () => Promise<McpStatus>, then?: () => void) => {
    setBusy(what);
    setProblem(null);
    work().then((s) => { onChange(s); then?.(); }, (e: unknown) => setProblem(said(e))).finally(() => setBusy(null));
  };
  const servers = status?.servers ?? [];
  const taken = new Set(servers.map((s) => s.target));

  return (
    <>
      <div className="cs-mcp-own">
        <div className="cs-mcp-row">
          <span aria-hidden="true" className="cs-glyph">C</span>
          <div className="cs-mcp-what"><strong>{t("Coach's own")}</strong><span className="muted">{t("{n} tools on your data · always on", { n: TOOLS.length })}</span></div>
          <Button variant="plain" aria-expanded={ownOpen} onClick={() => setOwnOpen(!ownOpen)}>{ownOpen ? t("Hide") : t("Show")}</Button>
        </div>
        {ownOpen ? <ul className="cs-mcp-names">{TOOLS.map((tool) => <li key={tool.name}><code>{tool.name}</code></li>)}</ul> : null}
      </div>

      <div className="cs-mcp-head">
        <h3>{t("Your MCP servers")}</h3>
        {!adding ? <Button onClick={() => setAdding(true)}>{t("Add server")}</Button> : null}
      </div>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}

      {adding ? <AddServer busy={!!busy} onCancel={() => setAdding(false)} onAdd={(input) => run("add", () => addMcp(input), () => setAdding(false))} /> : null}

      {servers.length ? servers.map((s) => <Server key={s.id} s={s} busy={busy} run={run} />)
        : !adding ? <p className="cs-empty">{t("None yet. Add a server to give Coach more tools.")}</p> : null}

      {PRESETS.some((p) => !taken.has(p.url)) ? (
        <div className="cs-mcp-presets">
          <span className="cs-field">{t("Quick add")}</span>
          <div className="cs-line">
            {PRESETS.filter((p) => !taken.has(p.url)).map((p) => (
              <button key={p.url} type="button" className="cs-mcp-preset" disabled={!!busy}
                onClick={() => run(`preset-${p.name}`, () => addMcp({ name: p.name, transport: "http", url: p.url, auth: "oauth" }))}>
                <strong>+ {p.name}</strong><span>{t(p.line)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="cs-note">{t("Tools stay off until you turn them on. Coach sends them what it needs to answer.")}</p>
    </>
  );
}

function Server({ s, busy, run }: { s: McpServerView; busy: string | null; run: (what: string, work: () => Promise<McpStatus>, then?: () => void) => void }) {
  const [removing, setRemoving] = useState(false);
  const words = stateWords(s);
  const onCount = s.tools.filter((tool) => tool.on).length;
  const mine = (what: string) => busy === `${what}-${s.id}`;
  const any = !!busy;
  return (
    <article className="cs-mcp-server" data-off={!s.enabled || undefined}>
      <div className="cs-mcp-row">
        <span aria-hidden="true" className="cs-mono" data-hue={s.transport === "stdio" ? "grey" : "cyan"}>{s.name.slice(0, 2).toUpperCase()}</span>
        <div className="cs-mcp-what">
          <span className="cs-mcp-title"><strong>{s.name}</strong><span className="cs-pill" data-tone={words.tone}>{words.text}</span></span>
          <code className="cs-mcp-target" title={s.target}>{s.target}</code>
        </div>
        <Switch checked={s.enabled} label={t("Use {name}", { name: s.name })} disabled={any} onChange={(on) => run(`enable-${s.id}`, () => enableMcp(s.id, on))} />
      </div>
      {s.error && s.state !== "signin" ? <p className="cs-mcp-error" role="alert">{s.error}</p> : null}
      {s.envNames.length || s.headerNames.length ? (
        <p className="cs-note">{[s.envNames.length ? t("Env: {names}", { names: s.envNames.join(", ") }) : "", s.headerNames.length ? t("Headers: {names}", { names: s.headerNames.join(", ") }) : ""].filter(Boolean).join(" · ")} · {t("kept encrypted")}</p>
      ) : null}

      {s.tools.length ? (
        <div className="cs-mcp-tools">
          <div className="cs-mcp-tools-head">
            <span>{t("{n} of {total} on", { n: onCount, total: s.tools.length })}</span>
            <button type="button" className="cs-now-link" disabled={any} onClick={() => run(`all-${s.id}`, () => setMcpTools(s.id, onCount < s.tools.length))}>{onCount < s.tools.length ? t("All on") : t("All off")}</button>
          </div>
          <ul>
            {s.tools.map((tool) => (
              <li key={tool.name}>
                <div className="cs-mcp-tool"><code>{tool.name}</code>{tool.description ? <span title={tool.description}>{tool.description}</span> : null}</div>
                <Switch checked={tool.on} label={t("Let Coach use {tool}", { tool: tool.name })} disabled={any || !s.enabled} onChange={(on) => run(`tool-${s.id}`, () => setMcpTool(s.id, tool.name, on))} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="cs-line">
        {s.auth === "oauth" && s.enabled && (!s.signedIn || s.state === "signin")
          ? <Button variant="primary" disabled={any} onClick={() => run(`signin-${s.id}`, () => signInMcp(s.id))}>{mine("signin") ? t("Waiting for sign-in…") : t("Sign in")}</Button> : null}
        {s.enabled && !(s.auth === "oauth" && !s.signedIn) ? <Button disabled={any} onClick={() => run(`connect-${s.id}`, () => reconnectMcp(s.id))}>{mine("connect") ? t("Connecting…") : t("Reconnect")}</Button> : null}
        {s.auth === "oauth" && s.signedIn ? <Button variant="plain" disabled={any} onClick={() => run(`signout-${s.id}`, () => signOutMcp(s.id))}>{t("Sign out")}</Button> : null}
        {removing ? (
          <>
            <span>{t("Remove {name}?", { name: s.name })}</span>
            <Button disabled={any} onClick={() => run(`remove-${s.id}`, () => removeMcp(s.id))}>{t("Remove")}</Button>
            <Button variant="plain" onClick={() => setRemoving(false)}>{t("Cancel")}</Button>
          </>
        ) : <Button variant="plain" disabled={any} onClick={() => setRemoving(true)}>{t("Remove")}</Button>}
      </div>
    </article>
  );
}

function AddServer({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (input: McpServerInput) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth">("none");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === "stdio") {
      const [program, ...args] = splitCommand(command);
      onAdd({ name, transport: "stdio", command: program ?? "", args, env: parsePairs(env, "=") });
    } else {
      onAdd({ name, transport: "http", url, auth, ...(auth === "bearer" ? { bearer: token } : {}), headers: parsePairs(headers, ":") });
    }
  };
  const ready = name.trim() && (kind === "stdio" ? command.trim() : url.trim() && (auth !== "bearer" || token.trim()));

  return (
    <form className="cs-mcp-add" onSubmit={submit}>
      <div className="cs-line">
        <Field aria-label={t("Name")} placeholder={t("Name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Segmented label={t("Kind")} small value={kind} onChange={setKind} options={[{ value: "stdio", label: t("Command") }, { value: "http", label: "URL" }]} />
      </div>
      {kind === "stdio" ? (
        <>
          <label className="cs-field">{t("Command")}
            <Field spellCheck={false} placeholder="npx -y @modelcontextprotocol/server-everything" value={command} onChange={(e) => setCommand(e.target.value)} />
          </label>
          <label className="cs-field">{t("Env (optional)")}
            <textarea className="field cs-mcp-text" spellCheck={false} rows={2} placeholder="API_KEY=…" value={env} onChange={(e) => setEnv(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <label className="cs-field">URL
            <Field spellCheck={false} placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="cs-field">{t("Sign-in")}
            <Segmented label={t("Sign-in")} small value={auth} onChange={setAuth} options={[{ value: "none", label: t("None") }, { value: "bearer", label: t("Token") }, { value: "oauth", label: "OAuth" }]} />
          </div>
          {auth === "bearer" ? (
            <label className="cs-field">{t("Token")}
              <Field type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          ) : null}
          <label className="cs-field">{t("Headers (optional)")}
            <textarea className="field cs-mcp-text" spellCheck={false} rows={2} placeholder="X-Api-Key: …" value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </label>
        </>
      )}
      <p className="cs-note">{t("Env, token and headers are kept encrypted on this computer.")}</p>
      <div className="cs-line">
        <Button type="submit" variant="primary" disabled={busy || !ready}>{busy ? t("Adding…") : t("Add")}</Button>
        <Button variant="plain" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}
