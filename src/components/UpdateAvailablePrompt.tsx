import { useEffect, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppUpdateSnapshot } from "../../electron/types";

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
    ? "Open download"
    : isDownloaded
      ? "Restart and update"
      : "Update now";
  const progress = Math.round(snapshot.downloadPercent ?? 0);
  const statusText =
    snapshot.status === "downloading"
      ? `Downloading ${progress}% — CorosLink will restart when it is ready.`
      : isManualInstall
        ? "The installer will open in your browser."
        : isDownloaded
          ? "The update is downloaded and ready to install."
          : "CorosLink will download the update and restart to finish installing it.";

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
          <span className="update-prompt-icon" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <div>
            <p className="update-prompt-eyebrow">Update available</p>
            <h2 id="update-prompt-title">CorosLink {visibleVersion}</h2>
            <p id="update-prompt-description">
              Everything new since CorosLink {snapshot.currentVersion}.
            </p>
          </div>
        </header>

        <div className="update-prompt-changelog" tabIndex={0}>
          {releaseNotes ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {releaseNotes}
            </ReactMarkdown>
          ) : (
            <p>
              This release includes the latest improvements and bug fixes.
            </p>
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
              Not now
            </button>
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
