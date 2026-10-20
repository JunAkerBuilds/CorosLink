import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { t, useLanguage } from "../i18n/tools";
import type { CorosLinkApi } from "../coroslink-api";
import { syncFailure, syncHeadline, syncIssues, type SyncIssue } from "../settings/watchSyncSummary";
import type { LastWatchSync } from "./watchSyncState";
import "./watchConnection.css";

/**
 * How the last watch sync went: one line when it worked, then a warning row for each part that
 * didn't.
 */
export function WatchSyncResult({ api, last, disabled, onSync }: {
  api: CorosLinkApi | undefined;
  last: LastWatchSync;
  disabled?: boolean;
  /** Starts another sync. */
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
      {issues.map((issue, index) => <SyncIssueRow key={`${issue.part}-${index}`} issue={issue} />)}
    </div>
  );
}

function SyncIssueRow({ issue }: { issue: SyncIssue }) {
  useLanguage();
  return (
    <div className="watch-menu-result is-warning" data-part={issue.part}>
      <AlertTriangle size={15} aria-hidden="true" />
      <span>{issue.text}</span>
    </div>
  );
}
