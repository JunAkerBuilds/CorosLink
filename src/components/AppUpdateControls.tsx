import { Download, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { AppUpdateSnapshot } from "../../electron/types";

interface AppUpdateControlsProps {
  snapshot: AppUpdateSnapshot;
  busy: boolean;
  onCheck: () => void;
  onInstall: () => void;
}

export function AppUpdateControls({
  snapshot,
  busy,
  onCheck,
  onInstall
}: AppUpdateControlsProps) {
  if (!snapshot.supported) {
    return (
      <span className="app-version-chip" title="Development build">
        v{snapshot.currentVersion}
      </span>
    );
  }

  if (snapshot.status === "downloaded" && snapshot.availableVersion) {
    return (
      <button
        className="update-chip ready"
        type="button"
        onClick={onInstall}
        title={`Install CorosLink ${snapshot.availableVersion}`}
      >
        <Sparkles size={15} aria-hidden="true" />
        Restart to update
      </button>
    );
  }

  if (
    snapshot.status === "available" ||
    snapshot.status === "downloading"
  ) {
    const label =
      snapshot.status === "downloading"
        ? `Downloading ${Math.round(snapshot.downloadPercent ?? 0)}%`
        : `Update ${snapshot.availableVersion}`;

    return (
      <div
        className="update-chip downloading"
        title={snapshot.releaseNotes ?? `CorosLink ${snapshot.availableVersion} is available`}
      >
        {snapshot.status === "downloading" ? (
          <Loader2 className="spin" size={15} aria-hidden="true" />
        ) : (
          <Download size={15} aria-hidden="true" />
        )}
        <span>{label}</span>
      </div>
    );
  }

  return (
    <button
      className="app-version-chip button"
      type="button"
      onClick={onCheck}
      disabled={busy || snapshot.status === "checking"}
      title={
        snapshot.status === "error"
          ? snapshot.error
          : `CorosLink ${snapshot.currentVersion}`
      }
    >
      {busy || snapshot.status === "checking" ? (
        <Loader2 className="spin" size={14} aria-hidden="true" />
      ) : (
        <RefreshCw size={14} aria-hidden="true" />
      )}
      v{snapshot.currentVersion}
    </button>
  );
}
