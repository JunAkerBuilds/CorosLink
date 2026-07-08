import {
  CheckCircle2,
  Download,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
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
} from "../formatters";

const DEFAULT_DAYS_BACK = 30;

interface RowState {
  busy: boolean;
  error: string | null;
}

export function IntervalsImportPanel({ api }: { api: CorosLinkApi }) {
  const [status, setStatus] = useState<IntervalsStatus>({ connected: false });
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [apiKey, setApiKey] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [daysBack, setDaysBack] = useState(DEFAULT_DAYS_BACK);
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

  async function handleRefresh() {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const next = await api.listMissingIntervalsActivities(daysBack);
      setRows(next);
      setRowState({});
    } catch (caught) {
      setRefreshError(
        caught instanceof Error
          ? caught.message
          : "Failed to load intervals.icu activities."
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function importOne(intervalsId: string) {
    setRowState((current) => ({
      ...current,
      [intervalsId]: { busy: true, error: null }
    }));
    try {
      await api.importIntervalsActivity(intervalsId);
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
        await importOne(row.intervalsId);
      }
    } finally {
      setImportingAll(false);
    }
  }

  const missingCount = rows.filter((row) => !row.onCoros).length;
  const anyRowBusy = Object.values(rowState).some((state) => state.busy);

  return (
    <section className="panel training-intervals-panel">
      <header className="training-backup-header">
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
          className="training-backup-card"
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect();
          }}
        >
          <div className="training-login-fields">
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

          <div className="settings-actions">
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
        <div className="training-backup-card training-intervals-connected">
          <div className="training-intervals-toolbar">
            <label className="field training-intervals-days">
              <span>Days back</span>
              <input
                type="number"
                min={1}
                max={365}
                value={daysBack}
                disabled={refreshing}
                onChange={(event) =>
                  setDaysBack(
                    Math.max(1, Math.min(365, Number(event.target.value) || DEFAULT_DAYS_BACK))
                  )
                }
              />
            </label>

            <div className="training-intervals-toolbar-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
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
              <button
                type="button"
                className="secondary-button danger-button compact-button"
                disabled={disconnecting}
                onClick={() => void handleDisconnect()}
              >
                {disconnecting ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <Unlink size={16} aria-hidden="true" />
                )}
                Disconnect
              </button>
            </div>
          </div>

          {refreshError ? (
            <p className="training-backup-error">{refreshError}</p>
          ) : null}

          {rows.length === 0 ? (
            <div className="training-empty-state">
              <p>
                No intervals.icu activities loaded yet. Choose a range and hit
                Refresh.
              </p>
            </div>
          ) : (
            <div className="table-shell training-activity-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Distance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const state = rowState[row.intervalsId];
                    const busy = Boolean(state?.busy);

                    return (
                      <tr key={row.intervalsId} className="training-table-row">
                        <td className="training-activity-cell">
                          <div className="training-activity-name">
                            <strong title={row.name}>{row.name}</strong>
                          </div>
                        </td>
                        <td className="training-activity-when">
                          {formatTrainingTimestamp(row.startEpochMs)}
                        </td>
                        <td className="training-activity-metric">{row.type}</td>
                        <td className="training-activity-metric">
                          {formatDistanceMeters(row.distanceM)}
                        </td>
                        <td className="training-activity-export">
                          <div className="row-actions training-intervals-status">
                            {row.onCoros ? (
                              <span className="badge ready">
                                <CheckCircle2 size={14} aria-hidden="true" />
                                On COROS
                              </span>
                            ) : (
                              <>
                                <span className="badge warning">Missing</span>
                                <button
                                  type="button"
                                  className="secondary-button compact-button"
                                  disabled={busy || importingAll}
                                  onClick={() => void importOne(row.intervalsId)}
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
                              </>
                            )}
                            {state?.error ? (
                              <span
                                className="training-backup-error training-intervals-row-error"
                                title={state.error}
                              >
                                <XCircle size={14} aria-hidden="true" />
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
          )}
        </div>
      )}
    </section>
  );
}
