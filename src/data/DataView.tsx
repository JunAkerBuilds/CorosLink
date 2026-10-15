import { t, useLanguage } from "../i18n/tools";
import { Database, LockKeyhole } from "lucide-react";
import type { TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityBackupPanel } from "./components/ActivityBackupPanel";
import { FitIndexPanel } from "./components/FitIndexPanel";
import { IntervalsImportPanel } from "./components/IntervalsImportPanel";

interface DataViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
}

export function DataView({ api, status, onOpenTraining }: DataViewProps) {
  useLanguage();
  const connected = Boolean(status?.authenticated);

  return (
    <section className="data-view">
      <header className="data-view-header">
        <div>
          <p className="eyebrow">{t("Activity data")}</p>
          <h2>{t("Data")}</h2>
          <p>
            {t("Import activity files and back up activities synced to COROS Training Hub.")}</p>
        </div>
        <div className="data-view-header-icon" aria-hidden="true">
          <Database size={22} />
        </div>
      </header>

      <details className="data-sync-help">
        <summary>{t("Activity on your watch but missing here?")}</summary>
        <p>
          {t("Backups include only activities already synced to COROS Training Hub. CorosLink cannot currently list, download, or repair recordings stored only on your watch over USB or Bluetooth.")}</p>
        <ol>
          <li>
            {t("Keep your watch near your phone with Bluetooth enabled. Open the COROS phone app and pull down on the first page to sync. Allow at least two minutes for the transfer.")}</li>
          <li>
            {t("If older activities stay missing, take photos of them in your watch’s Previous Activity widget. In the COROS phone app, go to Profile → Customer Support → Contact Support and attach the photos. COROS support may need to sync those recordings manually.")}</li>
          <li>
            {t("Once the activities appear in Training Hub, run your backup again to download them.")}</li>
        </ol>
        <p>
          <strong>{t("Keep the unsynced recordings:")}</strong>  {t("COROS advises against resetting your watch or uninstalling the phone app while workouts are missing, as this can lose the data.")}</p>
        <a
          href="https://support.coros.com/hc/en-us/articles/4404797030548-Troubleshooting-Unsynced-Workouts-on-COROS-Devices"
          target="_blank"
          rel="noreferrer"
        >
          {t("Read COROS’s full sync troubleshooting guide")}</a>
      </details>

      {!connected ? (
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>{t("Connect COROS first")}</h3>
            <p>
              {t("Data imports and backups use your Training Hub session to read and write activity files.")}</p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenTraining}>
            {t("Open Training Hub")}</button>
        </section>
      ) : (
        <div className="data-tools-grid">
          <FitIndexPanel api={api} />
          <ActivityBackupPanel api={api} />
          <IntervalsImportPanel api={api} />
        </div>
      )}
    </section>
  );
}
