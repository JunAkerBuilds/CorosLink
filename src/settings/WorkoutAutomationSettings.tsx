import { t, useLanguage } from "../i18n";
import { useEffect, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchfaceAutomationStatus } from "../../electron/watchfaceAutomationTypes";
import type { StrengthEditPreview } from "../../electron/workoutEditTypes";
import { WorkoutEditCard } from "../chat/WorkoutEditCard";

export function WorkoutAutomationSettings({ api }: { api: CorosLinkApi }) {
  useLanguage();
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
  return <section className="panel wf-automation-settings" aria-label={t("Strength workout automation")}>
    <div className="wf-automation-heading"><div><h2>{t("Strength workouts · External AI")}</h2><p>{t("Let local MCP clients prepare edits to existing strength workouts.")}</p></div>
      <button className="secondary-button" disabled={busy || !status} onClick={() => void toggle()}>{status?.enabled ? t("Disable workout access") : t("Enable workout access")}</button></div>
    <p>{t("Review sets, reps, weight, and rest changes here before saving. Workout access uses its own connection token. Keep CorosLink open. Hosted ChatGPT connections are not supported by this local endpoint.")}</p>
    {status?.enabled && <div className="wf-automation-connection">
      <label className="field">{t("Workout MCP URL")}<input value={status.url ?? ""} readOnly /></label>
      <label className="field">{t("Workout token")}<input type="password" value={status.token ?? ""} readOnly autoComplete="off" /></label>
      <button className="secondary-button" onClick={() => { void navigator.clipboard.writeText(`[mcp_servers.coroslink_workouts]\nurl = ${JSON.stringify(status.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${status.token}`)} }\ntool_timeout_sec = 180\n`).then(() => setCopied(true)).catch(() => setError("Could not copy configuration.")); }}>{copied ? t("Configuration copied") : t("Copy Codex configuration")}</button>
      <p>{t("Other local MCP clients can use the URL with a Bearer authorization header.")}</p>
    </div>}
    <h3>{t("Workout reviews")}</h3><p>{t("Coach and external workout requests appear here. Refresh to see new proposals.")}</p>
    <button className="secondary-button" onClick={() => void refresh()}>{t("Refresh reviews")}</button>
    {error && <p role="alert">{t(error)}</p>}
    {status?.error && <p role="alert">{status.error}</p>}
    <div className="workout-edit-inbox">{reviews.map(p => <WorkoutEditCard key={p.proposalId + p.state} preview={p} api={api} />)}</div>
  </section>;
}
