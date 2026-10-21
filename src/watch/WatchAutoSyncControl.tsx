import { useEffect, useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { t, useLanguage } from "../i18n/tools";
import type { CorosLinkApi } from "../coroslink-api";
import type { WatchAutoSyncState } from "../../electron/watchAutoSyncService";
import "../settings/watchSystemSettings.css";

const INTERVALS = [1, 3, 6, 12];

/**
 * "Auto-sync" in the watch menu: background sync with the watch last used (Local-Only Mode). A switch
 * like the ones in Settings, and the interval only while it is on. What a background sync found shows
 * with the other sync results; a pause (no remembered watch identity, or another device answered) shows here:
 * a Paused chip, the interval dimmed, and a warning row saying how to resume.
 */
export function WatchAutoSyncControl({ api, disabled }: { api: CorosLinkApi; disabled?: boolean }) {
  useLanguage();
  const [state, setState] = useState<WatchAutoSyncState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  useEffect(() => {
    let live = true;
    void api.getWatchAutoSync().then(value => { if (live) setState(value); }).catch(() => undefined);
    const off = api.onWatchAutoSyncChange(value => setState(value));
    return () => { live = false; off(); };
  }, [api]);

  if (!state) return null;
  const change = (input: { enabled?: boolean; intervalHours?: number }) => {
    setError(null);
    void api.setWatchAutoSync(input).then(setState).catch(() => setError(t("Couldn't save that. Try again.")));
  };

  const paused = state.enabled && state.paused ? state.paused : undefined;
  return (
    <div className={`watch-menu-autosync${paused ? " is-paused" : ""}`}>
      <div className="watch-menu-autosync-row">
        <span id={labelId}>{t("Auto-sync")}{paused ? <span className="watch-menu-autosync-chip">{t("Paused")}</span> : null}</span>
        {state.enabled ? <select value={state.intervalHours} disabled={disabled} aria-label={t("Automatic sync interval")}
          onChange={event => change({ intervalHours: Number(event.target.value) })}>
          {INTERVALS.map(hours => <option key={hours} value={hours}>{hours === 1 ? t("Every hour") : t("Every {{p0}} hours", { p0: hours })}</option>)}
        </select> : null}
        <input type="checkbox" role="switch" className="watch-setting-switch" checked={state.enabled} disabled={disabled}
          aria-labelledby={labelId} onChange={event => change({ enabled: event.target.checked })} />
      </div>
      {/* Paused until the watch is connected from this menu: none remembered yet, or another device answered. */}
      {paused ? <p className="watch-menu-result is-warning watch-menu-autosync-paused" role="status">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>{paused === "mismatch" ? t("Auto-sync paused: another device answered. Connect your watch to resume.") : t("Auto-sync paused. Connect your watch to resume.")}</span></p> : null}
      {error ? <p className="watch-link-note is-error" role="alert">{error}</p> : null}
    </div>
  );
}
