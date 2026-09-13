import { useEffect, useState } from "react";
import { Check, Copy, Loader2, PlugZap } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchfaceAutomationStatus } from "../../electron/watchfaceAutomationTypes";
import "./watchfaceAutomationSettings.css";

export function WatchfaceAutomationSettings({ api }: { api: CorosLinkApi }) {
  const [status, setStatus] = useState<WatchfaceAutomationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [port, setPort] = useState("");

  useEffect(() => {
    let mounted = true;
    void api.getWatchfaceAutomationStatus().then((next) => {
      if (mounted) {
        setStatus(next);
        if (next.port) setPort(String(next.port));
      }
    }).catch((caught) => { if (mounted) setError(String(caught)); });
    return () => { mounted = false; };
  }, [api]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function toggle() {
    setBusy(true);
    setError("");
    setCopied("");
    try {
      const next = await api.configureWatchfaceAutomation({ enabled: !status?.enabled, ...(port.trim() ? { port: Number(port) } : {}) });
      setStatus(next);
      if (next.port) setPort(String(next.port));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update external AI access.");
    } finally { setBusy(false); }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setError("");
    } catch { setError("Could not copy. Select and copy the connection values below."); }
  }

  const config = status?.enabled && status.url && status.token
    ? `[mcp_servers.coroslink_watchfaces]\nurl = ${JSON.stringify(status.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${status.token}`)} }\ntool_timeout_sec = 180\n`
    : "";

  return (
    <section className="panel wf-automation-settings" aria-labelledby="wf-automation-title">
      <div className="wf-automation-heading">
        <PlugZap size={22} aria-hidden="true" />
        <div>
          <h2 id="wf-automation-title">External AI</h2>
          <p>Let Codex and other AI apps design watch faces in your editor.</p>
        </div>
        <button type="button" className={status?.enabled ? "secondary-button" : "primary-button"} onClick={() => void toggle()} disabled={busy || !status}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
          {status?.enabled ? "Disable access" : "Enable access"}
        </button>
      </div>
      <p className="wf-automation-description">Connected clients can open, edit, save, export, and delete watch-face projects. Keep CorosLink open while working with your AI app. The connection runs on this computer and requires your token.</p>
      <div className="wf-automation-state" role="status">
        <span className={status?.enabled ? "is-enabled" : ""} aria-hidden="true" />
        {status ? status.enabled ? "External AI access is enabled" : "External AI access is disabled" : "Loading connection settings…"}
      </div>
      {status?.enabled ? (
        <div className="wf-automation-connection">
          <label className="field">MCP server URL<input value={status.url ?? ""} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
          <div className="wf-automation-token">
            <label className="field">Connection token<input type="password" value={status.token ?? ""} readOnly autoComplete="off" aria-label="Connection token" /></label>
            <button type="button" className="secondary-button" onClick={() => void copy(status.token ?? "", "token")}>
              {copied === "token" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}Copy token
            </button>
          </div>
          <div className="wf-automation-setup">
            <button type="button" className="secondary-button" onClick={() => void copy(config, "config")}>
              {copied === "config" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}Copy Codex configuration
            </button>
            <p>Add this block to your Codex <code>config.toml</code>, then reconnect its MCP tools. For other clients, use the URL and a Bearer authorization header with your token.</p>
          </div>
          <p className="wf-automation-example">Try: “Use CorosLink to create a watch face with bold time, a mountain background, and battery data. Preview and save the editable project.”</p>
        </div>
      ) : (
        <details className="wf-automation-advanced">
          <summary>Connection options</summary>
          <label className="field">Local port<input type="number" min={1024} max={65535} placeholder="Automatic default" value={port} onChange={(event) => setPort(event.target.value)} disabled={busy} /></label>
        </details>
      )}
      {copied ? <p role="status">{copied === "config" ? "Codex configuration copied, including the connection token." : "Connection token copied."}</p> : null}
      {error || status?.error ? <p className="wf-automation-error" role="alert">{error || status?.error}</p> : null}
    </section>
  );
}
