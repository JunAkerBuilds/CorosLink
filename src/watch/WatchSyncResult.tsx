import { useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { t, useLanguage } from "../i18n/tools";
import type { CorosLinkApi } from "../coroslink-api";
import { syncFailure, syncHeadline, syncIssues, type SyncIssue } from "../settings/watchSyncSummary";
import type { LastWatchSync } from "./watchSyncState";
import "./watchConnection.css";

/**
 * How the last watch sync went: one line when it worked, then a warning row for each part that
 * didn't. A training plan from the COROS app is replaced only after the user agrees, here.
 */
export function WatchSyncResult({ api, last, disabled, onSync }: {
  api: CorosLinkApi | undefined;
  last: LastWatchSync;
  disabled?: boolean;
  /** Starts another sync (after the user agreed to replace the watch's plan). */
  onSync: () => void;
}) {
  useLanguage();
  const automaticAt = last.automatic ? last.at : undefined;
  if (!last.ok) {
    // A background run that missed the watch (out of range, say) tries again by itself: a warning, not an alarm.
    return (
      <div className="watch-sync-result">
        {last.automatic ? <p className="watch-menu-result is-warning" role="status">
          <AlertTriangle size={15} aria-hidden="true" /><span>{syncFailure(last.error, automaticAt)}</span>
        </p> : <p className="watch-menu-result is-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" /><span>{syncFailure(last.error)}</span>
        </p>}
      </div>
    );
  }
  const issues = syncIssues(last.result);
  return (
    <div className="watch-sync-result" role="status">
      <p className="watch-menu-result is-success">
        <CheckCircle2 size={15} aria-hidden="true" /><span>{syncHeadline(last.result, automaticAt)}</span>
      </p>
      {issues.map((issue, index) => <SyncIssueRow key={`${issue.part}-${index}`} issue={issue} api={api} disabled={disabled} onSync={onSync} />)}
    </div>
  );
}

function SyncIssueRow({ issue, api, disabled, onSync }: { issue: SyncIssue; api: CorosLinkApi | undefined; disabled?: boolean; onSync: () => void }) {
  useLanguage();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const canReplace = issue.foreignPlan && typeof api?.allowWatchPlanReplacement === "function";

  async function replace() {
    setError(false);
    try {
      await api!.allowWatchPlanReplacement();
      setConfirming(false);
      onSync();
    } catch {
      setError(true);
    }
  }

  return (
    <div className={`watch-menu-result ${error ? "is-error" : "is-warning"}`} data-part={issue.part}>
      {error ? <AlertCircle size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
      <span>
        {confirming ? t("Replace the plan on the watch with CorosLink's calendar?") : error ? t("Couldn't save that. Try again.") : issue.text}
        {canReplace ? confirming ? <span className="watch-sync-actions">
          <button type="button" className="watch-link-inline-button" disabled={disabled} onClick={() => void replace()}>{t("Replace")}</button>
          <button type="button" className="watch-link-inline-button" onClick={() => setConfirming(false)}>{t("Cancel")}</button>
        </span> : <span className="watch-sync-actions">
          <button type="button" className="watch-link-inline-button" disabled={disabled} onClick={() => { setError(false); setConfirming(true); }}>{t("Replace it")}</button>
        </span> : null}
      </span>
    </div>
  );
}
