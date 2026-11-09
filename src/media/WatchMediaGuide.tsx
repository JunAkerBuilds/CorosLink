import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  FolderUp,
  Loader2,
  Music,
  Podcast,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import type { WatchStatus } from "../../electron/types";
import { t, useLanguage } from "../i18n/tools";
import type { TrackTransferProgress } from "./LibraryPanels";
import type { MediaTab } from "./mediaTabs";
import "./watchMediaGuide.css";

const COLLAPSED_STORAGE_KEY = "coroslink.watchMediaGuideCollapsed";
// While the guide waits for the watch, check far more often than the app-wide
// poll so plugging in (or approving on the phone) shows up within seconds.
const WAITING_POLL_MS = 3_000;

export interface WatchMediaGuideProps {
  watchStatus: WatchStatus | null;
  /** Library downloads not yet on the watch. */
  pendingCount: number;
  /** Library downloads already on the watch (for the finished state). */
  onWatchCount: number;
  sending: boolean;
  transferProgress: TrackTransferProgress | null;
  onOpenSource: (tab: MediaTab) => void;
  onImportFiles: () => void;
  onSendAll: () => void;
  onRefreshWatch: () => Promise<void> | void;
}

type ConnectState = "connected" | "approve" | "unplugged";

function connectState(status: WatchStatus | null): ConnectState {
  if (status?.connected) return "connected";
  if (status?.usbAwaitingApproval) return "approve";
  return "unplugged";
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatFree(bytes: number | undefined): string | null {
  if (bytes === undefined) return null;
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * One path from "I want this on my watch" to "go for a run": pick something to
 * play, connect the watch (including the phone approval newer COROS firmware
 * asks for), then send everything in one tap.
 */
export function WatchMediaGuide({
  watchStatus,
  pendingCount,
  onWatchCount,
  sending,
  transferProgress,
  onOpenSource,
  onImportFiles,
  onSendAll,
  onRefreshWatch,
}: WatchMediaGuideProps) {
  useLanguage();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [checking, setChecking] = useState(false);
  const state = connectState(watchStatus);
  const haveAudio = pendingCount > 0 || onWatchCount > 0;
  const done = state === "connected" && pendingCount === 0 && onWatchCount > 0 && !sending;

  useEffect(() => {
    if (state === "connected" || collapsed) return;
    const timer = window.setInterval(() => void onRefreshWatch(), WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [state, collapsed, onRefreshWatch]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // The choice still lasts this session.
    }
  }

  async function checkAgain() {
    setChecking(true);
    try {
      await onRefreshWatch();
    } finally {
      setChecking(false);
    }
  }

  const summary = sending
    ? t("Sending to your watch…")
    : done
      ? t("All set. Unplug your watch and go.")
      : state === "approve"
        ? t("Approve the connection on your phone")
        : state === "unplugged"
          ? t("Plug in your watch")
          : pendingCount > 0
            ? t("{{p0}} ready to send", { p0: pendingCount })
            : t("Pick something to play");

  return (
    <section
      className={collapsed ? "watch-guide is-collapsed" : "watch-guide"}
      aria-label={t("Put it on your watch")}
    >
      <header className="watch-guide-head">
        <button
          type="button"
          className="watch-guide-toggle"
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          <strong>{t("Put it on your watch")}</strong>
          <span className="watch-guide-summary">{summary}</span>
          <ChevronDown size={15} aria-hidden="true" className="watch-guide-chevron" />
        </button>
        {collapsed && state === "connected" && pendingCount > 0 ? (
          <button
            type="button"
            className="primary-button watch-guide-send is-compact"
            disabled={sending}
            onClick={onSendAll}
          >
            <Send size={14} aria-hidden="true" />
            {t("Send {{p0}}", { p0: pendingCount })}
          </button>
        ) : null}
      </header>

      {collapsed ? null : (
        <ol className="watch-guide-steps">
          <li className={haveAudio ? "watch-guide-step is-done" : "watch-guide-step is-current"}>
            <StepMark index={1} done={haveAudio} />
            <div className="watch-guide-body">
              <h3>{t("Choose something to play")}</h3>
              <p>
                {pendingCount > 0
                  ? t("{{p0}} in your library, waiting to go on the watch. Add more any time.", { p0: pendingCount })
                  : t("Download a podcast episode or some music. It lands in your Library.")}
              </p>
              <div className="watch-guide-sources">
                <button type="button" className="watch-guide-source" onClick={() => onOpenSource("apple-podcasts")}>
                  <Podcast size={15} aria-hidden="true" /> {t("Podcast")}
                </button>
                <button type="button" className="watch-guide-source" onClick={() => onOpenSource("youtube")}>
                  <Music size={15} aria-hidden="true" /> {t("Music")}
                </button>
                <button type="button" className="watch-guide-source" onClick={() => onOpenSource("audiobooks")}>
                  <BookOpen size={15} aria-hidden="true" /> {t("Audiobook")}
                </button>
                <button type="button" className="watch-guide-source" onClick={onImportFiles}>
                  <FolderUp size={15} aria-hidden="true" /> {t("My MP3 files")}
                </button>
              </div>
            </div>
          </li>

          <li
            className={[
              "watch-guide-step",
              state === "connected" ? "is-done" : haveAudio ? "is-current" : "",
              state === "approve" ? "is-warning" : "",
            ].filter(Boolean).join(" ")}
            aria-live="polite"
          >
            <StepMark index={2} done={state === "connected"} />
            <div className="watch-guide-body">
              <h3>
                {state === "connected"
                  ? t("{{p0}} connected", { p0: watchStatus?.name ?? t("Watch") })
                  : state === "approve"
                    ? t("Approve on your phone")
                    : t("Plug in your watch")}
              </h3>
              {state === "connected" ? (
                <p>
                  {formatFree(watchStatus?.freeBytes)
                    ? t("{{p0}} free on the watch.", { p0: formatFree(watchStatus?.freeBytes) })
                    : t("Ready to receive audio.")}
                </p>
              ) : state === "approve" ? (
                <>
                  <p>
                    {t("Your watch is plugged in but waiting for permission. Open the COROS app on your phone and allow the connection to this computer.")}
                  </p>
                  <p className="watch-guide-note">
                    <Smartphone size={13} aria-hidden="true" />
                    {t("New watch? Pair it in the COROS app first, then plug it in again.")}
                  </p>
                </>
              ) : (
                <>
                  <p>{t("Connect it to this computer with its charging cable.")}</p>
                  <p className="watch-guide-note">
                    <Smartphone size={13} aria-hidden="true" />
                    {t("Keep your phone nearby: since a recent COROS update, the COROS app asks you to allow the connection.")}
                  </p>
                </>
              )}
              {state !== "connected" ? (
                <button type="button" className="watch-guide-link" disabled={checking} onClick={() => void checkAgain()}>
                  {checking ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
                  {t("Check again")}
                </button>
              ) : null}
            </div>
          </li>

          <li
            className={[
              "watch-guide-step",
              done ? "is-done" : state === "connected" && pendingCount > 0 ? "is-current" : "",
            ].filter(Boolean).join(" ")}
          >
            <StepMark index={3} done={done} />
            <div className="watch-guide-body">
              <h3>{done ? t("On your watch") : t("Send to your watch")}</h3>
              {sending && transferProgress ? (
                <>
                  <p>
                    {t("Sending {{p0}} of {{p1}}: {{p2}}", {
                      p0: transferProgress.index,
                      p1: transferProgress.total,
                      p2: transferProgress.name,
                    })}
                  </p>
                  <div className="watch-guide-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={Math.round(((transferProgress.index - 1 + transferProgress.fileProgress) / transferProgress.total) * 100)}>
                    <span style={{ width: `${((transferProgress.index - 1 + transferProgress.fileProgress) / transferProgress.total) * 100}%` }} />
                  </div>
                </>
              ) : done ? (
                <p>{t("Unplug the watch, then find it under Music on the watch when you start a run.")}</p>
              ) : (
                <p>
                  {state !== "connected"
                    ? t("Once the watch is connected, everything new goes over in one tap.")
                    : pendingCount > 0
                      ? t("{{p0}} new item(s) will be copied. Leave the watch plugged in until it finishes.", { p0: pendingCount })
                      : t("Nothing new to send yet. Choose something to play first.")}
                </p>
              )}
              {!done ? (
                <button
                  type="button"
                  className="primary-button watch-guide-send"
                  disabled={sending || state !== "connected" || pendingCount === 0}
                  onClick={onSendAll}
                >
                  {sending ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                  {pendingCount > 0 ? t("Send {{p0}} to watch", { p0: pendingCount }) : t("Send to watch")}
                </button>
              ) : null}
            </div>
          </li>
        </ol>
      )}
    </section>
  );
}

function StepMark({ index, done }: { index: number; done: boolean }) {
  return (
    <span className="watch-guide-mark" aria-hidden="true">
      {done ? <Check size={14} strokeWidth={2.6} /> : index}
    </span>
  );
}
