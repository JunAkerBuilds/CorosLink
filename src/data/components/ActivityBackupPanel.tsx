import {
  CheckCircle2,
  DatabaseBackup,
  Download,
  FolderOpen,
  Loader2,
  Square,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type ActivityBackupPreview,
  type ActivityBackupProgress,
  type TrainingHubActivityFileType
} from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { distanceUnit, metersToDisplayDistance } from "../../units/units";
import {
  ActivityBackupFilters,
  EMPTY_BACKUP_FILTER_DRAFT,
  resolveBackupFilters,
  type BackupFilterDraft
} from "./ActivityBackupFilters";
import "./activityBackupFilters.css";

const BACKUP_RUNNING_STATES = new Set(["listing", "downloading"]);
// Typing in the length fields shouldn't recount on every keystroke.
const PREVIEW_DEBOUNCE_MS = 250;

type PreviewState =
  | { status: "loading"; last?: ActivityBackupPreview }
  | { status: "ready"; preview: ActivityBackupPreview }
  | { status: "error" };

function formatTotalDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours >= 10) {
    return `${Math.round(seconds / 3600).toLocaleString()} h`;
  }
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function formatFolderLabel(folder: string): string {
  const segments = folder.split(/[/\\]/).filter(Boolean);
  if (segments.length <= 2) {
    return folder;
  }

  return `…/${segments.slice(-2).join("/")}`;
}

export function ActivityBackupPanel({ api }: { api: CorosLinkApi }) {
  const [progress, setProgress] = useState<ActivityBackupProgress | null>(
    null
  );
  const [fileType, setFileType] = useState<TrainingHubActivityFileType>(4);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<BackupFilterDraft>(
    EMPTY_BACKUP_FILTER_DRAFT
  );
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "loading"
  });
  const { unitSystem } = useUnitSystem();
  const resolvedFilters = useMemo(
    () => resolveBackupFilters(filterDraft, unitSystem),
    [filterDraft, unitSystem]
  );
  const filtersKey = JSON.stringify(resolvedFilters.filters ?? null);

  useEffect(() => {
    void api.getActivityBackupProgress().then(setProgress);
    return api.onActivityBackupProgress(setProgress);
  }, [api]);

  useEffect(() => {
    if (resolvedFilters.error) {
      return;
    }
    let cancelled = false;
    // Keep showing the previous numbers while the new count arrives.
    setPreviewState((current) => ({
      status: "loading",
      last:
        current.status === "ready"
          ? current.preview
          : current.status === "loading"
            ? current.last
            : undefined
    }));
    const timer = window.setTimeout(() => {
      api
        .previewActivityBackup(resolvedFilters.filters)
        .then((preview) => {
          if (!cancelled) setPreviewState({ status: "ready", preview });
        })
        .catch(() => {
          if (!cancelled) setPreviewState({ status: "error" });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // filtersKey stands in for the filters object, which is rebuilt per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filtersKey, resolvedFilters.error]);

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

  const preview =
    previewState.status === "ready"
      ? previewState.preview
      : previewState.status === "loading"
        ? previewState.last
        : undefined;
  // An invalid filter never starts a count, so don't show one as pending.
  const counting = previewState.status === "loading" && !resolvedFilters.error;
  const matched = preview?.matched;
  const nothingMatches = previewState.status === "ready" && matched === 0;

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
      void api
        .startActivityBackup(selectedFolder, fileType, resolvedFilters.filters)
        .catch((caught) => {
          setError(
            caught instanceof Error ? caught.message : "Backup failed to start."
          );
        });
    } finally {
      setStarting(false);
    }
  }

  const selectedFormat = TRAINING_HUB_EXPORT_FORMATS.find(
    (format) => format.fileType === fileType
  );
  const startLabel =
    matched !== undefined && !counting && previewState.status === "ready"
      ? `Download ${matched.toLocaleString()} ${matched === 1 ? "activity" : "activities"}`
      : resolvedFilters.filters
        ? "Download matching"
        : "Start backup";

  return (
    <section className="data-tool-card training-backup-panel">
      <header className="data-tool-header">
        <div className="training-backup-heading">
          <p className="eyebrow">Cloud activity backup</p>
          <h2>Back up Training Hub activities</h2>
          <p className="training-backup-hint">
            Save activities synced to COROS Training Hub to a folder on this
            computer, one file per activity. Files already in the folder are
            skipped, so running it again only adds what’s new.
          </p>
        </div>
        <div className="training-backup-icon" aria-hidden="true">
          <DatabaseBackup size={22} />
        </div>
      </header>

      <div className="training-backup-card backup-layout">
        <ActivityBackupFilters
          draft={filterDraft}
          unitSystem={unitSystem}
          disabled={running}
          error={resolvedFilters.error}
          groupCounts={preview?.groupCounts}
          onChange={setFilterDraft}
        />

        <aside className="backup-summary" aria-label="Your download">
          <div
            className={`backup-summary-hero${counting ? " is-counting" : ""}`}
            aria-live="polite"
          >
            <span className="training-backup-formats-label">Your download</span>
            {resolvedFilters.error ? (
              <p className="backup-summary-unknown">
                Adjust the filters to see what will download.
              </p>
            ) : previewState.status === "error" ? (
              <p className="backup-summary-unknown">
                Couldn’t count activities right now. You can still start the
                download.
              </p>
            ) : (
              <>
                <p className="backup-summary-count">
                  {matched !== undefined ? (
                    <strong>{matched.toLocaleString()}</strong>
                  ) : (
                    <span className="backup-summary-skeleton" aria-hidden="true" />
                  )}
                  <span>{matched === 1 ? "activity" : "activities"}</span>
                  {counting ? (
                    <Loader2 size={15} className="spin" aria-label="Counting" />
                  ) : null}
                </p>
                <p className="backup-summary-of">
                  {preview
                    ? resolvedFilters.filters
                      ? `of ${preview.total.toLocaleString()} on Training Hub`
                      : "Everything on Training Hub"
                    : "Counting your Training Hub activities…"}
                </p>
                {preview && matched ? (
                  <dl className="backup-summary-stats">
                    <div>
                      <dt>Distance</dt>
                      <dd>
                        {Math.round(
                          metersToDisplayDistance(preview.distanceMeters, unitSystem)
                        ).toLocaleString()}{" "}
                        {distanceUnit(unitSystem)}
                      </dd>
                    </div>
                    <div>
                      <dt>Moving time</dt>
                      <dd>{formatTotalDuration(preview.durationSeconds)}</dd>
                    </div>
                  </dl>
                ) : null}
              </>
            )}
            {resolvedFilters.filters ? (
              <p className="backup-summary-filters" title={resolvedFilters.summary}>
                {resolvedFilters.summary}
              </p>
            ) : null}
          </div>

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
                  {progress.filtered
                    ? "Scanning your COROS account for matches…"
                    : "Scanning your COROS account…"}
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
              <div className="backup-summary-field">
                <span className="backup-summary-field-label" id="backup-format-label">
                  Format
                </span>
                <div
                  className="data-intervals-range backup-format-switch"
                  role="radiogroup"
                  aria-labelledby="backup-format-label"
                >
                  {TRAINING_HUB_EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.fileType}
                      type="button"
                      role="radio"
                      aria-checked={fileType === format.fileType}
                      className={fileType === format.fileType ? "active" : undefined}
                      title={format.description}
                      onClick={() => setFileType(format.fileType)}
                    >
                      {format.label}
                    </button>
                  ))}
                </div>
                {selectedFormat ? (
                  <p className="backup-summary-note">
                    {selectedFormat.description} ·{" "}
                    <strong>.{selectedFormat.extension}</strong>
                  </p>
                ) : null}
              </div>

              <div className="backup-summary-field">
                <span className="backup-summary-field-label">Save to</span>
                <button
                  type="button"
                  className={`backup-folder-button${selectedFolder ? " has-folder" : ""}`}
                  disabled={choosingFolder || starting}
                  title={selectedFolder ?? undefined}
                  onClick={() => void handleChooseFolder()}
                >
                  {choosingFolder ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : (
                    <FolderOpen size={16} aria-hidden="true" />
                  )}
                  <span className="backup-folder-path">
                    {selectedFolder
                      ? formatFolderLabel(selectedFolder)
                      : "Choose a folder…"}
                  </span>
                  {selectedFolder ? (
                    <span className="backup-folder-change">Change</span>
                  ) : null}
                </button>
              </div>

              <button
                type="button"
                className="primary-button training-backup-start"
                disabled={
                  !selectedFolder ||
                  starting ||
                  choosingFolder ||
                  nothingMatches ||
                  Boolean(resolvedFilters.error)
                }
                onClick={() => void handleStart()}
              >
                {starting ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
                {startLabel}
              </button>
              {resolvedFilters.error ? (
                <p className="backup-summary-hint">Fix the filters to continue.</p>
              ) : nothingMatches ? (
                <p className="backup-summary-hint">
                  Nothing matches yet. Try widening the filters.
                </p>
              ) : !selectedFolder ? (
                <p className="backup-summary-hint">
                  Choose where to save the files to start.
                </p>
              ) : null}
            </>
          )}
        </aside>
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
                    : progress.filtered && progress.total === 0
                      ? "No activities matched these filters"
                      : "Training Hub backup complete"}
                </strong>
                <div className="training-backup-stats">
                  <span className="badge ready">
                    {progress.completed} downloaded
                  </span>
                  <span className="badge">
                    {progress.skipped} already backed up
                  </span>
                  {progress.filtered && progress.scanned !== undefined ? (
                    <span className="badge">
                      {Math.max(0, progress.scanned - progress.total)} filtered out
                    </span>
                  ) : null}
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
