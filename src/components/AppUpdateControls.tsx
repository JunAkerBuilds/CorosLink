import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
  const reducedMotion = useReducedMotion();
  const [collapsedShape, setCollapsedShape] = useState({ scaleX: 0.55, scaleY: 0.14, y: 48 });
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, bottom: 8 });

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCollapsedShape({
        scaleX: rect.width / (popoverRef.current?.offsetWidth || 300),
        scaleY: rect.height / (popoverRef.current?.offsetHeight || 280),
        y: rect.height + 8,
      });
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - (popoverRef.current?.offsetWidth ?? 300) - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node) &&
          !popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        containerRef.current?.querySelector("button")?.focus();
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

      {createPortal(
        <AnimatePresence>
        {open ? <motion.div
          key="update-popover"
          ref={popoverRef}
          className="update-settings-popover update-settings-popover--sidebar"
          style={{ ...position, transformOrigin: "bottom left" }}
          initial="collapsed"
          animate="expanded"
          exit="collapsed"
          variants={{
            collapsed: reducedMotion
              ? { opacity: 0 }
              : { ...collapsedShape, opacity: 0, borderRadius: 26 },
            expanded: {
              scaleX: 1, scaleY: 1, y: 0, opacity: 1, borderRadius: 18,
              transition: reducedMotion
                ? { duration: 0.12 }
                : { type: "spring", stiffness: 380, damping: 32, mass: 0.8, opacity: { duration: 0.14 } },
            },
          }}
          transition={{ duration: reducedMotion ? 0.1 : 0.18, ease: [0.4, 0, 0.8, 0.2] }}
          onAnimationStart={(definition) => {
            if (popoverRef.current) {
              popoverRef.current.inert = definition === "collapsed";
            }
          }}
          role="dialog"
          aria-label="Updates"
        >
          <motion.div
            className="update-settings-content"
            variants={{
              collapsed: { opacity: 0, transition: { duration: 0.06 } },
              expanded: { opacity: 1, transition: { delay: reducedMotion ? 0 : 0.1, duration: 0.16 } },
            }}
          >
          <div className="update-settings-header">
            <p className="update-settings-heading">Updates</p>
            <span className="update-settings-version">v{snapshot.currentVersion}</span>
          </div>

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
              Your preferences will apply when you install CorosLink.
            </p>
          )}

          <label className="update-settings-option">
            <input
              type="checkbox"
              role="switch"
              aria-label="Check automatically"
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
              role="switch"
              aria-label="Download automatically"
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
        </motion.div>
        </motion.div> : null}
        </AnimatePresence>,
        document.body,
      )}
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
