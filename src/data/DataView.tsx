import { Database, LockKeyhole } from "lucide-react";
import type { TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityBackupPanel } from "./components/ActivityBackupPanel";
import { IntervalsImportPanel } from "./components/IntervalsImportPanel";

interface DataViewProps {
  api: CorosLinkApi;
  status: TrainingHubStatus | null;
  onOpenTraining: () => void;
}

export function DataView({ api, status, onOpenTraining }: DataViewProps) {
  const connected = Boolean(status?.authenticated);

  return (
    <section className="data-view">
      <header className="data-view-header">
        <div>
          <p className="eyebrow">Activity data</p>
          <h2>Data</h2>
          <p>
            Import missing activities, back up your COROS history, and manage
            the data tools that sit outside day-to-day training analysis.
          </p>
        </div>
        <div className="data-view-header-icon" aria-hidden="true">
          <Database size={22} />
        </div>
      </header>

      {!connected ? (
        <section className="panel data-connect-panel">
          <LockKeyhole size={24} aria-hidden="true" />
          <div>
            <h3>Connect COROS first</h3>
            <p>
              Data imports and backups use your Training Hub session to read and
              write activity files.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenTraining}>
            Open Training Hub
          </button>
        </section>
      ) : (
        <div className="data-tools-grid">
          <ActivityBackupPanel api={api} />
          <IntervalsImportPanel api={api} />
        </div>
      )}
    </section>
  );
}
