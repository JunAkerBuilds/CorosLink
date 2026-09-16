import { useEffect, useState } from "react";
import { Bug, Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { DiagnosticsSnapshot } from "../../electron/diagnosticsTypes";
import type { CorosLinkApi } from "../coroslink-api";
import "./diagnosticsSettings.css";

export function DiagnosticsSettings({ api }: { api: CorosLinkApi }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState<"refresh" | "copy" | "clear" | null>("refresh");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!api.getDiagnostics) {
      setError("Restart CorosLink to enable error logs.");
      setBusy(null);
      return;
    }
    let active = true;
    void api.getDiagnostics().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setError("Could not load error logs. Try refreshing.");
    }).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function perform(action: "refresh" | "copy" | "clear") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const next = action === "clear" ? await api.clearDiagnostics()
        : action === "copy" ? await api.copyDiagnostics() : await api.getDiagnostics();
      setSnapshot(next);
      if (action === "copy") {
        setNotice("Copied. Paste the report into your GitHub issue.");
      } else if (action === "clear") {
        setNotice("Error logs cleared.");
      }
    } catch {
      setError(action === "copy"
        ? "Could not copy the report. Open the preview below to select and copy it."
        : action === "clear" ? "Could not clear error logs. Try again." : "Could not refresh error logs. Try again.");
    } finally { setBusy(null); }
  }

  return (
    <section className="panel diagnostics-settings" aria-labelledby="diagnostics-title">
      <div className="diagnostics-heading">
        <Bug size={22} aria-hidden="true" />
        <div>
          <h2 id="diagnostics-title">Error logs</h2>
          <p>Having trouble? Copy a report to include in your GitHub issue.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void perform("copy")} disabled={busy !== null || !snapshot}>
          {busy === "copy" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : notice.startsWith("Copied") ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          Copy error report
        </button>
      </div>
      <p className="diagnostics-description">Logs stay on this computer. The report includes recent errors and app details, with common credentials, email addresses, and local paths redacted. Nothing is uploaded automatically.</p>
      <div className="diagnostics-toolbar">
        <span>{snapshot ? `${snapshot.entryCount} ${snapshot.entryCount === 1 ? "error" : "errors"} recorded · Last 7 days · Up to 200 errors` : "Loading error logs…"}</span>
        <div>
          <button type="button" className="secondary-button" onClick={() => void perform("refresh")} disabled={busy !== null}>
            <RefreshCw size={14} className={busy === "refresh" ? "spin" : ""} aria-hidden="true" />Refresh
          </button>
          <button type="button" className="secondary-button" onClick={() => void perform("clear")} disabled={busy !== null || !snapshot?.entryCount}>
            <Trash2 size={14} aria-hidden="true" />Clear logs
          </button>
        </div>
      </div>
      {snapshot && !snapshot.persistent ? <p className="diagnostics-error" role="status">Logs could not be saved to disk. Copy this report before closing CorosLink.</p> : null}
      {snapshot ? (
        <details className="diagnostics-preview">
          <summary>Preview report</summary>
          <textarea readOnly aria-label="Error report" value={snapshot.report} spellCheck={false} />
        </details>
      ) : null}
      {error ? <p className="diagnostics-error" role="alert">{error}</p> : null}
      <p className="diagnostics-notice" role="status">{notice}</p>
    </section>
  );
}
