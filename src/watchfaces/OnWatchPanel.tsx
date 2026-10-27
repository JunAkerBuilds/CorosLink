import { t, useLanguage } from "../i18n/watchfaces";
import { lazy, Suspense, useState } from "react";
import { BatteryMedium, Bluetooth, Settings2, Watch } from "lucide-react";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { CorosDirectWatchfacePanel } from "./CorosDirectWatchfacePanel";
import { connectedWatch, watchBetaNote, watchConnectionState, watchDisplayName, watchFaceSyncReady, watchFirmware } from "./watchLink";
import "./watchLink.css";

const ActivityScreenPanel = import.meta.env.DEV ? lazy(() => import("./CorosActivityScreenPanel").then(module => ({ default: module.CorosActivityScreenPanel }))) : null;

/**
 * Watch Faces' On watch tab: the faces stored on the watch and installing new
 * ones. Connecting lives in the toolbar's watch menu, which this tab opens.
 */
export function OnWatchPanel({ api, snapshot, onOpenWatchMenu, showDevelopmentTools = false }: {
  api: CorosLinkApi;
  snapshot: CorosNativeBleSnapshot | null;
  onOpenWatchMenu: () => void;
  showDevelopmentTools?: boolean;
}) {
  useLanguage();
  const [busy, setBusy] = useState(false);
  const state = watchConnectionState(snapshot);
  const connected = Boolean(snapshot?.connected);
  const linking = snapshot?.phase === "connecting" || snapshot?.phase === "scanning";
  const firmware = watchFirmware(snapshot);

  return (
    <section id="watchface-watch-panel" className="watch-link watch-on-watch" role="tabpanel"
      aria-labelledby="watchface-watch-tab" aria-busy={busy || linking || undefined}>
      <header className="watch-link-head">
        <div className="watch-link-identity">
          <span className={`watch-link-glyph is-${state.tone}`} aria-hidden="true"><Watch size={22} /></span>
          <div>
            <p className="watch-link-eyebrow">{t("On your watch")}</p>
            <h2 id="watch-link-title">{connected ? watchDisplayName(snapshot?.deviceName) : t("COROS watch")}</h2>
            <p className="watch-link-meta">
              <span className={`watch-link-state is-${state.tone}`} role="status">{t(state.label)}</span>
              {connected && snapshot?.batteryPercent !== undefined ? <span className="watch-link-chip">
                <BatteryMedium size={14} aria-hidden="true" />{snapshot.batteryPercent}%</span> : null}
              {connected && firmware ? <span className="watch-link-chip">{t("Firmware")}{" "}{firmware}</span> : null}
            </p>
          </div>
        </div>
        <div className="watch-link-actions">
          <button className={`${connected ? "secondary-button" : "primary-button"} watch-link-button`} type="button" onClick={onOpenWatchMenu}>
            {connected ? <Settings2 size={15} aria-hidden="true" /> : <Bluetooth size={15} aria-hidden="true" />}
            {connected ? t("Watch connection") : t("Connect watch")}
          </button>
        </div>
      </header>

      {snapshot?.authenticationError && connected ? <p className="watch-link-note is-error" role="alert">{snapshot.authenticationError}</p> : null}

      <CorosDirectWatchfacePanel api={api} ready={watchFaceSyncReady(snapshot)} connected={connected}
        watch={connectedWatch(snapshot)} betaNote={watchBetaNote(snapshot)} disabled={busy || linking} onBusy={setBusy} />
      {ActivityScreenPanel && showDevelopmentTools ? <Suspense fallback={<p>{t("Loading activity screens…")}</p>}>
        <ActivityScreenPanel api={api} snapshot={snapshot} disabled={busy || linking} onBusy={setBusy} />
      </Suspense> : null}
    </section>
  );
}
