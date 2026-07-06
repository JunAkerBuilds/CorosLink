import { useEffect, useRef, useState } from "react";
import {
  Download,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { AppUpdateSnapshot } from "../../electron/types";

interface AppUpdateControlsProps {
  snapshot: AppUpdateSnapshot;
  busy: boolean;
  downloading: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onPreferencesChange: (prefs: {
    autoCheck?: boolean;
    autoDownload?: boolean;
  }) => void;
}

function UpdatePreferencesMenu({
  snapshot,
  busy,
  downloading,
  onCheck,
  onDownload,
  onInstall,
  onPreferencesChange,
}: AppUpdateControlsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="update-settings" ref={containerRef}>
      <button
        className="update-settings-trigger update-settings-trigger--labeled"
        type="button"
        aria-label="Update settings"
        aria-expanded={open}
        title="Update settings"
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 size={14} aria-hidden="true" />
        <span className="update-settings-trigger-label">Updates</span>
      </button>

      {open ? (
        <div className="update-settings-popover" role="menu">
          <p className="update-settings-heading">Updates</p>

          {snapshot.supported ? (
            <div className="update-settings-actions">
              {snapshot.status === "downloaded" && snapshot.availableVersion ? (
                <button
                  className="update-settings-action"
                  type="button"
                  onClick={() => {
                    onInstall();
                    setOpen(false);
                  }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {snapshot.installMethod === "manual"
                    ? `Download ${snapshot.availableVersion}`
                    : "Restart to update"}
                </button>
              ) : snapshot.status === "available" && !snapshot.autoDownload ? (
                <button
                  className="update-settings-action"
                  type="button"
                  disabled={downloading}
                  onClick={() => {
                    onDownload();
                    setOpen(false);
                  }}
                >
                  {downloading ? (
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Download size={14} aria-hidden="true" />
                  )}
                  {downloading
                    ? "Starting…"
                    : `Download ${snapshot.availableVersion}`}
                </button>
              ) : (
                <button
                  className="update-settings-action"
                  type="button"
                  disabled={busy || snapshot.status === "checking"}
                  onClick={() => {
                    onCheck();
                    setOpen(false);
                  }}
                >
                  {busy || snapshot.status === "checking" ? (
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <RefreshCw size={14} aria-hidden="true" />
                  )}
                  Check for updates
                </button>
              )}
            </div>
          ) : (
            <p className="update-settings-note">
              Auto-updates run in installed builds. Preferences below apply
              when you install CorosLink.
            </p>
          )}

          <label className="update-settings-option">
            <input
              type="checkbox"
              checked={snapshot.autoCheck}
              onChange={(event) =>
                onPreferencesChange({ autoCheck: event.target.checked })
              }
            />
            <span>
              <span className="update-settings-option-label">
                Check automatically
              </span>
              <span className="update-settings-option-hint">
                Look for updates on startup.
              </span>
            </span>
          </label>
          <label className="update-settings-option">
            <input
              type="checkbox"
              checked={snapshot.autoDownload}
              onChange={(event) =>
                onPreferencesChange({ autoDownload: event.target.checked })
              }
            />
            <span>
              <span className="update-settings-option-label">
                Download automatically
              </span>
              <span className="update-settings-option-hint">
                Otherwise, download only when you ask.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function AppUpdateControls({
  snapshot,
  busy,
  downloading,
  onCheck,
  onDownload,
  onInstall,
  onPreferencesChange,
}: AppUpdateControlsProps) {
  const settings = (
    <UpdatePreferencesMenu
      snapshot={snapshot}
      busy={busy}
      downloading={downloading}
      onCheck={onCheck}
      onDownload={onDownload}
      onInstall={onInstall}
      onPreferencesChange={onPreferencesChange}
    />
  );

  if (!snapshot.supported) {
    return (
      <div className="app-update-controls">
        <span className="app-version-chip" title="Development build">
          v{snapshot.currentVersion}
        </span>
        {settings}
      </div>
    );
  }

  if (snapshot.status === "downloaded" && snapshot.availableVersion) {
    const manual = snapshot.installMethod === "manual";

    return (
      <div className="app-update-controls">
        <button
          className="update-chip ready"
          type="button"
          onClick={onInstall}
          title={
            manual
              ? `Download CorosLink ${snapshot.availableVersion} from GitHub (required for this macOS build)`
              : `Install CorosLink ${snapshot.availableVersion}`
          }
        >
          <Sparkles size={15} aria-hidden="true" />
          {manual
            ? `Download ${snapshot.availableVersion}`
            : "Restart to update"}
        </button>
        {settings}
      </div>
    );
  }

  // An update was found but auto-download is off: let the user start it.
  if (snapshot.status === "available" && !snapshot.autoDownload) {
    return (
      <div className="app-update-controls">
        <button
          className="update-chip ready"
          type="button"
          onClick={onDownload}
          disabled={downloading}
          title={
            snapshot.releaseNotes ??
            `Download CorosLink ${snapshot.availableVersion}`
          }
        >
          {downloading ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <Download size={15} aria-hidden="true" />
          )}
          {downloading
            ? "Starting…"
            : `Download ${snapshot.availableVersion}`}
        </button>
        {settings}
      </div>
    );
  }

  if (snapshot.status === "available" || snapshot.status === "downloading") {
    const label =
      snapshot.status === "downloading"
        ? `Downloading ${Math.round(snapshot.downloadPercent ?? 0)}%`
        : `Update ${snapshot.availableVersion}`;

    return (
      <div className="app-update-controls">
        <div
          className="update-chip downloading"
          title={
            snapshot.releaseNotes ??
            `CorosLink ${snapshot.availableVersion} is available`
          }
        >
          {snapshot.status === "downloading" ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <Download size={15} aria-hidden="true" />
          )}
          <span>{label}</span>
        </div>
        {settings}
      </div>
    );
  }

  return (
    <div className="app-update-controls">
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
      {settings}
    </div>
  );
}
