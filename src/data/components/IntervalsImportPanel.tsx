import {
  Activity as ActivityIcon,
  Bike,
  CheckCircle2,
  Download,
  Dumbbell,
  Footprints,
  KeyRound,
  Link2,
  Loader2,
  Mountain,
  RefreshCw,
  Unlink,
  Waves,
  XCircle
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  IntervalsActivityWithStatus,
  IntervalsStatus
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import {
  formatDistanceMeters,
  formatTrainingTimestamp
} from "../../training/formatters";

const DEFAULT_DAYS_BACK = 30;

const RANGE_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" }
] as const;

interface RowState {
  busy: boolean;
  error: string | null;
}

function activityTypeIcon(type: string) {
  const normalized = type.toLowerCase();
  if (
    normalized.includes("ride") ||
    normalized.includes("bike") ||
    normalized.includes("cycl")
  ) {
    return Bike;
  }
  if (
    normalized.includes("swim") ||
    normalized.includes("row") ||
    normalized.includes("paddle")
  ) {
    return Waves;
  }
  if (normalized.includes("hike") || normalized.includes("climb")) {
    return Mountain;
  }
  if (normalized.includes("run") || normalized.includes("walk")) {
    return Footprints;
  }
  if (
    normalized.includes("weight") ||
    normalized.includes("strength") ||
    normalized.includes("workout")
  ) {
    return Dumbbell;
  }
  return ActivityIcon;
}

export function IntervalsImportPanel({ api }: { api: CorosLinkApi }) {
  const [status, setStatus] = useState<IntervalsStatus>({ connected: false });
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [apiKey, setApiKey] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [daysBack, setDaysBack] = useState(DEFAULT_DAYS_BACK);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [rows, setRows] = useState<IntervalsActivityWithStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [importingAll, setImportingAll] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingStatus(true);
    api
      .getIntervalsStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!status.connected) {
      return;
    }

    let cancelled = false;
    setRefreshing(true);
    setRefreshError(null);
    api
      .listMissingIntervalsActivities(daysBack)
      .then((next) => {
        if (!cancelled) {
          setRows(next);
          setRowState({});
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setRefreshError(
            caught instanceof Error
              ? caught.message
              : "Failed to load intervals.icu activities."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, status.connected, daysBack, refreshNonce]);

  async function handleConnect() {
    setConnectError(null);
    setConnecting(true);
    try {
      const next = await api.connectIntervals(apiKey.trim(), athleteId.trim());
      setStatus(next);
      setApiKey("");
    } catch (caught) {
      setConnectError(
        caught instanceof Error ? caught.message : "Failed to connect to intervals.icu."
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await api.disconnectIntervals();
      setStatus({ connected: false });
      setRows([]);
      setRowState({});
      setRefreshError(null);
    } catch (caught) {
      setRefreshError(
        caught instanceof Error ? caught.message : "Failed to disconnect."
      );
    } finally {
      setDisconnecting(false);
    }
  }

  async function importOne(
    intervalsId: string,
    fileExt: "fit" | "tcx" | "unknown"
  ) {
    setRowState((current) => ({
      ...current,
      [intervalsId]: { busy: true, error: null }
    }));
    try {
      await api.importIntervalsActivity(intervalsId, fileExt);
      setRows((current) =>
        current.map((row) =>
          row.intervalsId === intervalsId ? { ...row, onCoros: true } : row
        )
      );
      setRowState((current) => ({
        ...current,
        [intervalsId]: { busy: false, error: null }
      }));
    } catch (caught) {
      setRowState((current) => ({
        ...current,
        [intervalsId]: {
          busy: false,
          error: caught instanceof Error ? caught.message : "Import failed."
        }
      }));
    }
  }

  async function handleImportAllMissing() {
    setImportingAll(true);
    try {
      const missing = rows.filter((row) => !row.onCoros);
      for (const row of missing) {
        await importOne(row.intervalsId, row.fileExt);
      }
    } finally {
      setImportingAll(false);
    }
  }

  const missingCount = rows.filter((row) => !row.onCoros).length;
  const anyRowBusy = Object.values(rowState).some((state) => state.busy);

  return (
    <section className="data-tool-card data-intervals-card">
      <header className="data-tool-header">
        <div className="training-backup-heading">
          <p className="eyebrow">Import</p>
          <h2>Import from intervals.icu</h2>
          <p className="training-backup-hint">
            Pull activities logged on intervals.icu into COROS. Connect your
            account, then import any activities that are missing.
          </p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <Download size={22} />
        </div>
      </header>

      {loadingStatus ? (
        <div className="training-empty-state">
          <Loader2 className="spin" size={18} aria-hidden="true" />
          <p>Checking intervals.icu connection…</p>
        </div>
      ) : !status.connected ? (
        <form
          className="data-intervals-connect-card"
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect();
          }}
        >
          <div className="data-intervals-connect-copy">
            <strong>Connect your intervals.icu account</strong>
            <span>
              Use an API key and athlete ID to compare intervals.icu activities
              against COROS.
            </span>
          </div>

          <div className="data-intervals-fields">
            <label className="field training-login-field">
              <span>intervals.icu API key</span>
              <div className="training-login-input">
                <KeyRound size={18} aria-hidden="true" />
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API key"
                  type="password"
                  autoComplete="off"
                  disabled={connecting}
                />
              </div>
            </label>
            <label className="field training-login-field">
              <span>Athlete ID</span>
              <div className="training-login-input">
                <input
                  value={athleteId}
                  onChange={(event) => setAthleteId(event.target.value)}
                  placeholder="e.g. i123456"
                  type="text"
                  autoComplete="off"
                  disabled={connecting}
                />
              </div>
            </label>
          </div>

          <div className="data-intervals-connect-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={connecting || !apiKey.trim() || !athleteId.trim()}
            >
              {connecting ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Link2 size={16} aria-hidden="true" />
              )}
              Connect
            </button>
          </div>

          {connectError ? (
            <p className="training-backup-error">{connectError}</p>
          ) : null}
        </form>
      ) : (
        <div className="data-intervals-connected">
          <div className="data-intervals-topbar">
            <div className="data-intervals-identity">
              <span className="badge ready">
                <CheckCircle2 size={14} aria-hidden="true" />
                Connected
              </span>
              {status.athleteId ? (
                <span className="badge">Athlete {status.athleteId}</span>
              ) : null}
            </div>
            <button
              type="button"
              className="secondary-button danger-button compact-button"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Unlink size={14} aria-hidden="true" />
              )}
              Disconnect
            </button>
          </div>

          <div className="data-intervals-toolbar">
            <div
              className="data-intervals-range"
              role="radiogroup"
              aria-label="How far back to look"
            >
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  role="radio"
                  aria-checked={daysBack === option.days}
                  className={daysBack === option.days ? "active" : undefined}
                  disabled={refreshing || importingAll || anyRowBusy}
                  onClick={() => setDaysBack(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="data-intervals-toolbar-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={refreshing}
                onClick={() => setRefreshNonce((nonce) => nonce + 1)}
              >
                {refreshing ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={16} aria-hidden="true" />
                )}
                Refresh
              </button>
              <button
                type="button"
                className="primary-button compact-button"
                disabled={missingCount === 0 || importingAll || anyRowBusy || refreshing}
                onClick={() => void handleImportAllMissing()}
              >
                {importingAll ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                Import all missing
                {missingCount > 0 ? ` (${missingCount})` : ""}
              </button>
            </div>
          </div>

          {refreshError ? (
            <p className="training-backup-error">{refreshError}</p>
          ) : null}

          {rows.length === 0 ? (
            <div className="training-empty-state">
              {refreshing ? (
                <p>
                  <Loader2 size={16} className="spin" aria-hidden="true" />{" "}
                  Loading intervals.icu activities…
                </p>
              ) : (
                <p>
                  No intervals.icu activities found in the last {daysBack} days.
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="data-intervals-summary">
                {refreshing
                  ? "Refreshing…"
                  : missingCount > 0
                    ? `${rows.length} activities loaded · ${missingCount} missing from COROS`
                    : `${rows.length} activities loaded · everything is on COROS`}
              </p>
              <div className="table-shell data-intervals-table">
                <table>
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="data-intervals-num">Distance</th>
                      <th className="data-intervals-status-col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const state = rowState[row.intervalsId];
                      const busy = Boolean(state?.busy);
                      const TypeIcon = activityTypeIcon(row.type);

                      return (
                        <tr
                          key={row.intervalsId}
                          className={
                            row.onCoros ? undefined : "data-intervals-row-missing"
                          }
                        >
                          <td>
                            <strong
                              className="data-intervals-name"
                              title={row.name}
                            >
                              {row.name}
                            </strong>
                          </td>
                          <td className="data-intervals-when">
                            {formatTrainingTimestamp(row.startEpochMs)}
                          </td>
                          <td>
                            <span className="data-intervals-type">
                              <TypeIcon size={14} aria-hidden="true" />
                              {row.type}
                            </span>
                          </td>
                          <td className="data-intervals-num">
                            {formatDistanceMeters(row.distanceM)}
                          </td>
                          <td className="data-intervals-status-col">
                            <div className="data-intervals-status">
                              {row.onCoros ? (
                                <span className="data-intervals-synced">
                                  <CheckCircle2 size={14} aria-hidden="true" />
                                  On COROS
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="secondary-button compact-button"
                                  disabled={busy || importingAll}
                                  onClick={() =>
                                    void importOne(row.intervalsId, row.fileExt)
                                  }
                                >
                                  {busy ? (
                                    <Loader2
                                      size={14}
                                      className="spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Download size={14} aria-hidden="true" />
                                  )}
                                  Import
                                </button>
                              )}
                              {state?.error ? (
                                <span
                                  className="data-intervals-row-error"
                                  title={state.error}
                                >
                                  <XCircle size={12} aria-hidden="true" />
                                  {state.error}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
