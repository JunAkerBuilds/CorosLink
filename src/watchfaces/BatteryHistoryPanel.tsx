import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryCharging,
  ChevronDown,
  KeyRound,
  Loader2,
  RefreshCw
} from "lucide-react";
import type { CorosBatteryReport, CorosPairedDevice } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

interface BatteryHistoryPanelProps {
  api: CorosLinkApi;
  disabled: boolean;
  authenticated?: boolean;
}

export function BatteryHistoryPanel({
  api,
  disabled,
  authenticated = true
}: BatteryHistoryPanelProps) {
  const [devices, setDevices] = useState<CorosPairedDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [report, setReport] = useState<CorosBatteryReport | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => (report ? [...report.days].reverse() : []), [report]);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    setDeviceError(null);
    try {
      const nextDevices = await api.listCorosPairedDevices();
      setDevices(nextDevices);
      setSelectedDeviceId((current) =>
        nextDevices.some((device) => device.deviceId === current)
          ? current
          : nextDevices[0]?.deviceId ?? ""
      );
    } catch (caught) {
      setDeviceError(toErrorMessage(caught));
    } finally {
      setLoadingDevices(false);
    }
  }, [api]);

  useEffect(() => {
    if (authenticated) {
      void loadDevices();
    } else {
      setDevices([]);
      setSelectedDeviceId("");
      setReport(null);
      setDeviceError(null);
      setError(null);
    }
  }, [authenticated, loadDevices]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDevice) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setReport(await api.getCorosBatteryReport(selectedDevice));
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel watchfaces-battery-panel">
      <div className="watchfaces-panel-heading">
        <span className="watchfaces-panel-icon"><BatteryCharging size={20} /></span>
        <div>
          <p className="eyebrow">Mobile account data</p>
          <h2>Battery history</h2>
        </div>
      </div>
      <p className="watchfaces-muted">
        View COROS&apos;s daily battery-usage breakdown for a watch paired with your
        connected account. Select a watch; CorosLink retrieves its internal
        identifiers automatically and never displays or saves them here.
      </p>
      {!authenticated ? (
        <div className="watchfaces-battery-local-state">
          <KeyRound size={18} aria-hidden="true" />
          <p>Connect COROS from the Hub header to view account battery data.</p>
        </div>
      ) : (
        <form className="watchfaces-battery-form" onSubmit={handleSubmit}>
          <label className="field">
            Paired watch
            <select
              value={selectedDeviceId}
              disabled={disabled || loadingDevices || devices.length === 0}
              onChange={(event) => {
                setSelectedDeviceId(event.target.value);
                setReport(null);
              }}
            >
              {devices.length === 0 ? <option value="">No paired watch found</option> : null}
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.firmwareType} · {shortUuid(device.uuid)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={disabled || loadingDevices}
            onClick={() => void loadDevices()}
          >
            {loadingDevices ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            Refresh watches
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={disabled || loading || !selectedDevice}
          >
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            Load battery history
          </button>
        </form>
      )}

      {authenticated && deviceError ? <p className="watchfaces-battery-error">{deviceError}</p> : null}
      {authenticated && error ? <p className="watchfaces-battery-error">{error}</p> : null}

      {authenticated && report ? (
        <div className="watchfaces-battery-results">
          <div className="watchfaces-battery-summary">
            <strong>{days.length} daily record{days.length === 1 ? "" : "s"}</strong>
            {report.updatedAt ? <span>Reported {new Date(report.updatedAt).toLocaleString()}</span> : null}
          </div>
          {days.length === 0 ? (
            <p className="watchfaces-empty-themes">COROS returned no battery-history records for this watch.</p>
          ) : (
            <div className="watchfaces-battery-days">
              {days.map((day, index) => (
                <details className="watchfaces-battery-day" key={day.date} open={index === 0}>
                  <summary>
                    <span>{formatDay(day.date)}</span>
                    <span className="watchfaces-battery-day-metrics">
                      {day.percentAtQueryTime !== undefined ? <em>Query {formatPercent(day.percentAtQueryTime)}</em> : null}
                      {day.totalPercent !== undefined ? <em>Total {formatPercent(day.totalPercent)}</em> : null}
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="watchfaces-battery-groups">
                    {day.groups.map((group) => (
                      <div className="watchfaces-battery-group" key={`${day.date}-${group.name}`}>
                        <div>
                          <strong>{group.name}</strong>
                          {group.percent !== undefined ? <span>{formatPercent(group.percent)}</span> : null}
                        </div>
                        {group.details.length > 0 ? (
                          <ul>
                            {group.details.map((detail) => (
                              <li key={`${group.name}-${detail.name}`}>
                                <span>{detail.name}</span>
                                {detail.percent !== undefined ? <span>{formatPercent(detail.percent)}</span> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function formatDay(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatPercent(value: number): string {
  if (Math.abs(value) >= 1) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${value.toFixed(value === 0 ? 0 : 2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function shortUuid(value: string): string {
  return value.length <= 6 ? value : `…${value.slice(-6)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Battery-history request failed.";
}
