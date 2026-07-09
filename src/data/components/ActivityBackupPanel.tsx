import {
  CheckCircle2,
  DatabaseBackup,
  FolderOpen,
  Loader2,
  Square,
  XCircle
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type ActivityBackupProgress,
  type TrainingHubActivityFileType
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";

const BACKUP_RUNNING_STATES = new Set(["listing", "downloading"]);

export function ActivityBackupPanel({ api }: { api: CorosLinkApi }) {
  const [progress, setProgress] = useState<ActivityBackupProgress | null>(
    null
  );
  const [fileType, setFileType] = useState<TrainingHubActivityFileType>(4);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.getActivityBackupProgress().then(setProgress);
    return api.onActivityBackupProgress(setProgress);
  }, [api]);

  const running = Boolean(progress && BACKUP_RUNNING_STATES.has(progress.state));
  const processed = progress
    ? progress.completed + progress.skipped + progress.failed
    : 0;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((processed / progress.total) * 100))
      : 0;
  const progressWidth =
    progress?.state === "listing" || progress?.total === 0
      ? "10%"
      : `${percent}%`;

  async function handleChooseFolder() {
    setError(null);
    setChoosingFolder(true);
    try {
      const folder = await api.chooseActivityBackupFolder();
      if (folder) {
        setSelectedFolder(folder);
      }
    } finally {
      setChoosingFolder(false);
    }
  }

  async function handleStart() {
    if (!selectedFolder) {
      return;
    }

    setError(null);
    setStarting(true);
    try {
      void api.startActivityBackup(selectedFolder, fileType).catch((caught) => {
        setError(
          caught instanceof Error ? caught.message : "Backup failed to start."
        );
      });
    } finally {
      setStarting(false);
    }
  }

  function formatFolderLabel(folder: string): string {
    const segments = folder.split(/[/\\]/).filter(Boolean);
    if (segments.length <= 2) {
      return folder;
    }

    return `…/${segments.slice(-2).join("/")}`;
  }

  const selectedFormat = TRAINING_HUB_EXPORT_FORMATS.find(
    (format) => format.fileType === fileType
  );

  return (
    <section className="data-tool-card training-backup-panel">
      <header className="data-tool-header">
        <div className="training-backup-heading">
          <p className="eyebrow">Local backup</p>
          <h2>Back up all activities</h2>
          <p className="training-backup-hint">
            Download your entire COROS activity history to a folder on this
            computer — one file per activity. Re-running only fetches new
            activities.
          </p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <DatabaseBackup size={22} />
        </div>
      </header>

      <div className="training-backup-card">
        <div className="training-backup-formats">
          <span className="training-backup-formats-label">Export format</span>
          <div
            className="training-backup-format-grid"
            role="radiogroup"
            aria-label="Export format"
          >
            {TRAINING_HUB_EXPORT_FORMATS.map((format) => {
              const active = fileType === format.fileType;

              return (
                <button
                  key={format.fileType}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    active
                      ? "training-backup-format-option active"
                      : "training-backup-format-option"
                  }
                  disabled={running}
                  onClick={() => setFileType(format.fileType)}
                >
                  <strong>{format.label}</strong>
                  <span>{format.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="training-backup-action-bar">
          {running ? (
            <div className="training-backup-progress">
              <div className="training-backup-progress-meta">
                <span className="training-backup-progress-label">
                  {progress?.state === "listing"
                    ? "Finding activities"
                    : "Backing up"}
                </span>
                {progress && progress.total > 0 ? (
                  <span className="training-backup-progress-count">
                    {processed} / {progress.total}
                  </span>
                ) : null}
              </div>
              <div
                className={`training-backup-progress-track${
                  progress?.state === "listing" || progress?.total === 0
                    ? " is-indeterminate"
                    : ""
                }`}
                style={
                  {
                    "--backup-progress": progressWidth
                  } as CSSProperties
                }
              >
                <span />
              </div>
              {progress?.currentName && progress.state === "downloading" ? (
                <p className="training-backup-current">{progress.currentName}</p>
              ) : progress?.state === "listing" ? (
                <p className="training-backup-current">
                  Scanning your COROS account…
                </p>
              ) : null}
              <button
                type="button"
                className="secondary-button danger-button compact-button training-backup-stop"
                onClick={() => void api.cancelActivityBackup()}
              >
                <Square size={14} aria-hidden="true" />
                Stop backup
              </button>
            </div>
          ) : (
            <>
              {selectedFormat ? (
                <p className="training-backup-selected-format">
                  Saving as{" "}
                  <strong>
                    .{selectedFormat.extension.toUpperCase()}
                  </strong>{" "}
                  files
                </p>
              ) : null}

              <div className="training-backup-folder-row">
                <button
                  type="button"
                  className="secondary-button compact-button training-backup-folder"
                  disabled={choosingFolder || starting}
                  onClick={() => void handleChooseFolder()}
                >
                  {choosingFolder ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : (
                    <FolderOpen size={16} aria-hidden="true" />
                  )}
                  {selectedFolder ? "Change folder" : "Choose folder"}
                </button>
                {selectedFolder ? (
                  <p
                    className="training-backup-folder-path"
                    title={selectedFolder}
                  >
                    {formatFolderLabel(selectedFolder)}
                  </p>
                ) : (
                  <p className="training-backup-folder-hint">
                    Select a destination folder first
                  </p>
                )}
              </div>

              <button
                type="button"
                className="primary-button training-backup-start"
                disabled={!selectedFolder || starting || choosingFolder}
                onClick={() => void handleStart()}
              >
                {starting ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <DatabaseBackup size={16} aria-hidden="true" />
                )}
                Start backup
              </button>
            </>
          )}
        </div>
      </div>

      {progress && !running ? (
        <div
          className={`training-backup-result${
            progress.state === "error"
              ? " is-error"
              : progress.state === "cancelled"
                ? " is-cancelled"
                : " is-success"
          }`}
        >
          {progress.state === "error" ? (
            <>
              <XCircle size={18} aria-hidden="true" />
              <div>
                <strong>Backup failed</strong>
                <p>{progress.error ?? "Unknown error"}</p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>
                  {progress.state === "cancelled"
                    ? "Backup stopped"
                    : "Backup complete"}
                </strong>
                <div className="training-backup-stats">
                  <span className="badge ready">
                    {progress.completed} downloaded
                  </span>
                  <span className="badge">
                    {progress.skipped} already backed up
                  </span>
                  {progress.failed > 0 ? (
                    <span className="badge danger">
                      {progress.failed} failed
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className="training-backup-error">{error}</p> : null}
    </section>
  );
}
