import { t, useLanguage } from "../i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import appLogo from "../../build/icon-animated.svg";
import type { AppUpdateSnapshot } from "../../electron/types";

// The Markdown pipeline loads only once a prompt is actually shown.
const UpdateReleaseNotes = lazy(() => import("./UpdateReleaseNotes"));

const DISMISSED_UPDATE_VERSION_KEY =
  "coroslink.updatePrompt.dismissedVersion";

interface UpdateAvailablePromptProps {
  snapshot: AppUpdateSnapshot;
  onAccept: (version: string) => void;
  onDecline?: (version: string) => void;
  /** Forces a fresh, non-persistent preview whenever this value changes. */
  previewKey?: number;
}

function readDismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

function rememberDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version);
  } catch {
    // The in-memory guard still prevents the prompt from repeating this run.
  }
}

function canPromptForUpdate(snapshot: AppUpdateSnapshot): boolean {
  return (
    snapshot.supported &&
    Boolean(snapshot.availableVersion) &&
    (snapshot.status === "available" ||
      snapshot.status === "downloading" ||
      snapshot.status === "downloaded")
  );
}

export function UpdateAvailablePrompt({
  snapshot,
  onAccept,
  onDecline,
  previewKey,
}: UpdateAvailablePromptProps) {
  useLanguage();
  const [visibleVersion, setVisibleVersion] = useState<string | null>(null);
  const promptedVersions = useRef(new Set<string>());
  const handledPreviewKey = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!canPromptForUpdate(snapshot) || !snapshot.availableVersion) {
      return;
    }

    const version = snapshot.availableVersion;
    if (
      previewKey !== undefined &&
      handledPreviewKey.current !== previewKey
    ) {
      handledPreviewKey.current = previewKey;
      promptedVersions.current.add(version);
      setVisibleVersion(version);
      return;
    }

    if (promptedVersions.current.has(version)) {
      return;
    }

    promptedVersions.current.add(version);
    if (readDismissedVersion() !== version) {
      setVisibleVersion(version);
    }
  }, [
    previewKey,
    snapshot.availableVersion,
    snapshot.status,
    snapshot.supported,
  ]);

  useEffect(() => {
    if (!visibleVersion) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewKey === undefined) {
          rememberDismissedVersion(visibleVersion);
        }
        setVisibleVersion(null);
        onDecline?.(visibleVersion);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDecline, previewKey, visibleVersion]);

  if (!visibleVersion) {
    return null;
  }

  const releaseNotes = snapshot.releaseNotes?.trim();
  const isDownloaded = snapshot.status === "downloaded";
  const isManualInstall =
    isDownloaded && snapshot.installMethod === "manual";
  const actionLabel = isManualInstall
    ? t("Open download")
    : isDownloaded
      ? t("Restart and update")
      : t("Update now");
  const progress = Math.round(snapshot.downloadPercent ?? 0);
  const statusText =
    snapshot.status === "downloading"
      ? t("Downloading {{percent}}% — CorosLink will restart when it is ready.", { percent: progress })
      : isManualInstall
        ? t("The installer will open in your browser.")
        : isDownloaded
          ? t("The update is downloaded and ready to install.")
          : t("CorosLink will download the update and restart to finish installing it.");

  const decline = () => {
    if (previewKey === undefined) {
      rememberDismissedVersion(visibleVersion);
    }
    setVisibleVersion(null);
    onDecline?.(visibleVersion);
  };

  const accept = () => {
    const version = visibleVersion;
    setVisibleVersion(null);
    onAccept(version);
  };

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section
        className="update-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
        aria-describedby="update-prompt-description"
      >
        <header className="update-prompt-header">
          <img
            className="update-prompt-icon"
            src={appLogo}
            alt=""
            width={46}
            height={46}
            aria-hidden="true"
          />
          <div>
            <p className="update-prompt-eyebrow">{t("Update available")}</p>
            <h2 id="update-prompt-title">CorosLink {visibleVersion}</h2>
            <p id="update-prompt-description">
              {t("Everything new since CorosLink")} {snapshot.currentVersion}.
            </p>
          </div>
        </header>

        <div className="update-prompt-changelog" tabIndex={0}>
          {releaseNotes ? (
            <Suspense fallback={null}>
              <UpdateReleaseNotes markdown={releaseNotes} />
            </Suspense>
          ) : (
            <p>
              {t("This release includes the latest improvements and bug fixes.")} </p>
          )}
        </div>

        <footer className="update-prompt-footer">
          <p>{statusText}</p>
          <div className="update-prompt-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={decline}
            >
              {t("Not now")} </button>
            <button
              className="primary-button"
              type="button"
              autoFocus
              onClick={accept}
            >
              {isDownloaded ? (
                <Sparkles size={16} aria-hidden="true" />
              ) : (
                <Download size={16} aria-hidden="true" />
              )}
              {actionLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
