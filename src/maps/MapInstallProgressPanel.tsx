import { t, useLanguage } from "../i18n/tools";
import type { CorosMapInstallProgress } from "../../electron/types";
import { formatBytes } from "../media/libraryUtils";

/** A map copy to the watch's USB drive: COROS region packages and chosen map areas. */
export function MapInstallProgressPanel({
  progress,
  onCancel
}: {
  progress: CorosMapInstallProgress;
  onCancel: () => void;
}) {
  useLanguage();
  const percent = Math.round(Math.max(0, Math.min(progress.progress, 1)) * 100);
  // One verb throughout, as on the buttons that start a copy.
  const phaseLabel =
    progress.phase === "failed"
      ? t("Copy failed")
      : progress.phase === "cancelled"
        ? t("Copy cancelled")
        : progress.phase === "completed"
          ? t("Copied to watch")
          : progress.phase === "preparing"
            ? t("Preparing…")
            : progress.phase === "downloading"
              ? t("Downloading maps")
              : t("Copying to watch");

  return (
    <div
      className={
        progress.phase === "failed"
          ? "map-install-progress is-failed"
          : progress.phase === "cancelled"
            ? "map-install-progress is-cancelled"
            : "map-install-progress"
      }
    >
      <div className="map-install-progress-heading">
        {/* Only the phase is announced; the percentage changes too often to read out. */}
        <strong aria-live="polite">{phaseLabel}</strong>
        <span>{percent}%</span>
      </div>
      <div className="map-download-progress-track" role="progressbar" aria-label={phaseLabel}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      {/* The size isn't known until the files are listed. */}
      <small>
        {progress.label}{progress.totalBytes > 0 ? <> · {formatBytes(progress.copiedBytes)}  {t("of")}{" "}
        {formatBytes(progress.totalBytes)} · {progress.copiedFiles}/
        {progress.totalFiles}  {t("files")}</> : null}</small>
      {progress.error ? (
        <p className="map-install-error">{progress.error}</p>
      ) : progress.active ? (
        <div className="map-install-progress-actions">
          <p>{t("Keep the watch connected until the copy finishes.")}</p>
          <button
            type="button"
            className="secondary-button map-install-cancel"
            onClick={onCancel}
          >
            {t("Cancel")}</button>
        </div>
      ) : null}
    </div>
  );
}
