import { useEffect, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchfaceAutomationStatus } from "../../electron/watchfaceAutomationTypes";
import type { StrengthEditPreview } from "../../electron/workoutEditTypes";
import { WorkoutEditCard } from "../chat/WorkoutEditCard";

export function WorkoutAutomationSettings({ api }: { api: CorosLinkApi }) {
  const [status, setStatus] = useState<WatchfaceAutomationStatus>();
  const [reviews, setReviews] = useState<StrengthEditPreview[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = async () => {
    setError("");
    try { setStatus(await api.getWorkoutAutomationStatus()); setReviews(await api.listWorkoutEdits()); }
    catch (e) { setError(String(e)); }
  };
  useEffect(() => { void refresh(); return api.onWorkoutEditsChanged(() => void refresh()); }, [api]);
  const toggle = async () => {
    setBusy(true); setError("");
    try { setStatus(await api.configureWorkoutAutomation({ enabled: !status?.enabled })); setReviews(await api.listWorkoutEdits()); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <section className="panel wf-automation-settings" aria-label="Strength workout automation">
    <div className="wf-automation-heading"><div><h2>Strength workouts · External AI</h2><p>Let local MCP clients prepare edits to existing strength workouts.</p></div>
      <button className="secondary-button" disabled={busy || !status} onClick={() => void toggle()}>{status?.enabled ? "Disable workout access" : "Enable workout access"}</button></div>
    <p>Review sets, reps, weight, and rest changes here before saving. Workout access uses its own connection token. Keep CorosLink open. Hosted ChatGPT connections are not supported by this local endpoint.</p>
    {status?.enabled && <div className="wf-automation-connection">
      <label className="field">Workout MCP URL<input value={status.url ?? ""} readOnly /></label>
      <label className="field">Workout token<input type="password" value={status.token ?? ""} readOnly autoComplete="off" /></label>
      <button className="secondary-button" onClick={() => { void navigator.clipboard.writeText(`[mcp_servers.coroslink_workouts]\nurl = ${JSON.stringify(status.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${status.token}`)} }\ntool_timeout_sec = 180\n`).then(() => setCopied(true)).catch(() => setError("Could not copy configuration.")); }}>{copied ? "Configuration copied" : "Copy Codex configuration"}</button>
      <p>Other local MCP clients can use the URL with a Bearer authorization header.</p>
    </div>}
    <h3>Workout reviews</h3><p>Coach and external workout requests appear here. Refresh to see new proposals.</p>
    <button className="secondary-button" onClick={() => void refresh()}>Refresh reviews</button>
    {error && <p role="alert">{error}</p>}
    {status?.error && <p role="alert">{status.error}</p>}
    <div className="workout-edit-inbox">{reviews.map(p => <WorkoutEditCard key={p.proposalId + p.state} preview={p} api={api} />)}</div>
  </section>;
}
