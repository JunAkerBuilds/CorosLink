import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, FlaskConical, Loader2, LogOut, RefreshCw } from "lucide-react";
import type { TrainingHubStatus } from "../../../electron/types";

export const trainingHubTabs = [
  { id: "overview", label: "Overview" },
  { id: "activities", label: "Activities" },
  { id: "records", label: "Records & PRs" }
] as const;

export type TrainingHubTab = typeof trainingHubTabs[number]["id"];

interface TrainingHubHeaderProps {
  dashboardToolbarRef?: (element: HTMLDivElement | null) => void;
  connected: boolean;
  status: TrainingHubStatus | null;
  busy: string | null;
  sampleMode: boolean;
  activeTab: TrainingHubTab;
  tabIdPrefix: string;
  activityCount: number;
  onTabChange: (tab: TrainingHubTab) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onToggleSample?: () => void;
}

export function TrainingHubHeader({
  connected, status, busy, sampleMode, activeTab, tabIdPrefix, activityCount,
  onTabChange, onRefresh, onLogout, onToggleSample, dashboardToolbarRef
}: TrainingHubHeaderProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const accountId = useId();
  const refreshing = busy === "training-refresh";
  const loggingOut = busy === "training-logout";

  useEffect(() => {
    if (!accountOpen) return;
    const dismissOutside = (event: PointerEvent | FocusEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [accountOpen]);

  return (
    <header className="training-hub-header">
      <div className="training-hub-heading-row">
        <div className="training-hub-heading">
          <h1>Training <span>Hub</span></h1>
          <p>{sampleMode
            ? "Exploring sample training data."
            : "Your training, progress and personal bests."}</p>
        </div>
        <p className="training-hub-motto">explore <span>prefection</span></p>
        <div className="training-hub-actions">
          {onToggleSample ? (
            <button
              type="button"
              className="training-hub-sample-button"
              aria-pressed={sampleMode}
              title={sampleMode ? "Return to your training data" : "Preview with sample data"}
              onClick={onToggleSample}
            >
              <FlaskConical size={14} aria-hidden="true" />
              Sample data
            </button>
          ) : null}
          {connected && !sampleMode ? (
            <>
              <div className="training-hub-account" ref={accountRef}>
                <button
                  ref={accountButtonRef}
                  className="training-hub-account-button"
                  type="button"
                  aria-expanded={accountOpen}
                  aria-controls={accountId}
                  onClick={() => setAccountOpen(open => !open)}
                >
                  <span className="training-hub-connected-dot" aria-hidden="true" />
                  COROS connected
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {accountOpen ? (
                  <div id={accountId} className="training-hub-account-popover" role="region" aria-label="COROS account">
                    <div className="training-hub-account-summary">
                      <strong>COROS account</strong>
                      <span>{status?.email || "Connected to Training Hub"}</span>
                    </div>
                    <dl className="training-hub-account-details">
                      <div><dt>User ID</dt><dd>{status?.userId ?? "Unknown"}</dd></div>
                      <div><dt>Region</dt><dd>{status?.regionId ?? "Unknown"}</dd></div>
                      <div><dt>API host</dt><dd>{status?.baseUrl ?? "Unknown"}</dd></div>
                    </dl>
                    <button
                      type="button"
                      className="training-hub-disconnect-button"
                      disabled={loggingOut || refreshing}
                      onClick={onLogout}
                    >
                      {loggingOut ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <LogOut size={15} aria-hidden="true" />}
                      {loggingOut ? "Disconnecting…" : "Disconnect account"}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                className="training-hub-refresh-button"
                type="button"
                aria-label={refreshing ? "Refreshing training data" : "Refresh training data"}
                disabled={refreshing || loggingOut}
                onClick={onRefresh}
              >
                <RefreshCw size={15} className={refreshing ? "spin" : undefined} aria-hidden="true" />
                <span role="status">{refreshing ? "Refreshing…" : "Refresh"}</span>
              </button>
            </>
          ) : null}
        </div>
      </div>
      {connected ? (
        <div className="training-hub-navigation-row">
        <div className="training-hub-tabs" role="tablist" aria-label="Training Hub sections">
          {trainingHubTabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={element => { tabRefs.current[index] = element; }}
              id={`${tabIdPrefix}-tab-${tab.id}`}
              className="training-hub-tab"
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`${tabIdPrefix}-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={event => {
                let next = index;
                if (event.key === "ArrowRight") next = (index + 1) % trainingHubTabs.length;
                else if (event.key === "ArrowLeft") next = (index + trainingHubTabs.length - 1) % trainingHubTabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = trainingHubTabs.length - 1;
                else return;
                event.preventDefault();
                onTabChange(trainingHubTabs[next]!.id);
                tabRefs.current[next]?.focus();
              }}
            >
              {tab.label}
              {tab.id === "activities" && activityCount > 0 ? (
                <span className="training-hub-tab-count">{activityCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="training-hub-dashboard-actions" ref={dashboardToolbarRef} hidden={activeTab !== "overview"} />
        </div>
      ) : null}
    </header>
  );
}
