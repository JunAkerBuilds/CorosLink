import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  FolderUp,
  Loader2,
  Music,
  PartyPopper,
  Podcast,
  RefreshCw,
  Send,
  Smartphone,
  Unplug,
  Usb,
  Watch,
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
  /** Ejects the watch's drive; resolves true once it is safe to unplug. */
  onEject: () => Promise<boolean>;
}

type ConnectState = "connected" | "approve" | "unplugged";
type StepId = 1 | 2 | 3;
type StepTone = "done" | "current" | "warning" | "upcoming";

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
 * asks for), then send everything in one tap. A stepper shows where you are;
 * one row below spells out the step in hand and its action.
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
  onEject,
}: WatchMediaGuideProps) {
  useLanguage();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [checking, setChecking] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  // Set by a successful eject; plugging the watch back in clears it.
  const [ejected, setEjected] = useState(false);
  // A step the person clicked to look at; null follows the current step.
  const [viewed, setViewed] = useState<StepId | null>(null);
  const state = connectState(watchStatus);
  const haveAudio = pendingCount > 0 || onWatchCount > 0;
  const done = state === "connected" && pendingCount === 0 && onWatchCount > 0 && !sending;
  const current: StepId = sending ? 3 : !haveAudio ? 1 : state !== "connected" ? 2 : 3;
  const shown: StepId = viewed ?? current;

  // Moving on (plugging in, finishing a send) returns the row to the live step.
  useEffect(() => setViewed(null), [current]);

  useEffect(() => {
    if (state === "connected") setEjected(false);
  }, [state]);
  const showEjected = ejected && state !== "connected" && viewed === null;

  // Only while the open guide is on screen: collapsed, or with the window in
  // the background, the app-wide poll is enough.
  useEffect(() => {
    if (state === "connected" || collapsed) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void onRefreshWatch();
    }, WAITING_POLL_MS);
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

  async function eject() {
    setEjecting(true);
    try {
      if (await onEject()) {
        setEjected(true);
        setViewed(null);
      }
    } finally {
      setEjecting(false);
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

  const tones: Record<StepId, StepTone> = ejected && state !== "connected"
    ? { 1: "done", 2: "done", 3: "done" }
    : {
        1: haveAudio ? "done" : "current",
        2: state === "connected" ? "done" : state === "approve" ? "warning" : current === 2 ? "current" : "upcoming",
        3: done ? "done" : current === 3 ? "current" : "upcoming",
      };
  const labels: Record<StepId, string> = {
    1: t("Choose"),
    2: state === "approve" ? t("Approve on phone") : t("Connect"),
    3: t("Send"),
  };
  const canSend = state === "connected" && pendingCount > 0 && !sending;
  const sendLabel = pendingCount > 0 ? t("Send {{p0}} to watch", { p0: pendingCount }) : t("Send to watch");
  // Nothing left to copy: the next move is to eject and unplug.
  const canEject = state === "connected" && pendingCount === 0 && !sending;
  const ejectButton = (
    <button type="button" className="secondary-button watch-guide-eject" disabled={ejecting} onClick={() => void eject()}>
      {ejecting ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Unplug size={15} aria-hidden="true" />}
      {t("Eject")}
    </button>
  );
  const sendButton = (
    <button type="button" className="primary-button watch-guide-send" disabled={!canSend} onClick={onSendAll}>
      {sending ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
      {sendLabel}
    </button>
  );

  let detail: { tone: StepTone; icon: ReactNode; title: string; body: ReactNode; action?: ReactNode };
  if (showEjected) {
    detail = {
      tone: "done",
      icon: <PartyPopper size={17} aria-hidden="true" />,
      title: t("Safe to unplug"),
      body: t("After you unplug, the watch shows a loading icon for about a minute while it reads the new files. Music appears on the watch once your headphones are connected."),
    };
  } else if (shown === 1) {
    detail = {
      tone: haveAudio ? "done" : "current",
      icon: <Podcast size={17} aria-hidden="true" />,
      title: haveAudio ? t("Add more to play") : t("Choose something to play"),
      body: pendingCount > 0
        ? t("{{p0}} waiting in your Library. Downloads land there automatically.", { p0: pendingCount })
        : t("Download a podcast episode or some music. It lands in your Library."),
      action: (
        <div className="watch-guide-sources" role="group" aria-label={t("Sources")}>
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
            <FolderUp size={15} aria-hidden="true" /> {t("My MP3s")}
          </button>
        </div>
      ),
    };
  } else if (shown === 2) {
    const checkButton = (
      <button type="button" className="secondary-button watch-guide-check" disabled={checking} onClick={() => void checkAgain()}>
        {checking ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
        {t("Check again")}
      </button>
    );
    detail = state === "connected"
      ? {
          tone: "done",
          icon: <Watch size={17} aria-hidden="true" />,
          title: t("{{p0}} connected", { p0: watchStatus?.name ?? t("Watch") }),
          body: formatFree(watchStatus?.freeBytes)
            ? t("{{p0}} free on the watch.", { p0: formatFree(watchStatus?.freeBytes) })
            : t("Ready to receive audio."),
          action: canEject ? ejectButton : undefined,
        }
      : state === "approve"
        ? {
            tone: "warning",
            icon: <Smartphone size={17} aria-hidden="true" />,
            title: t("Approve the connection on your phone"),
            body: t("Your watch is plugged in. Open the COROS app and allow it to connect to this computer. No request in the app? If CorosLink connected to the watch over Bluetooth, reconnect the watch in the COROS app first."),
            action: checkButton,
          }
        : {
            tone: "current",
            icon: <Usb size={17} aria-hidden="true" />,
            title: t("Plug in your watch"),
            body: t("Use its charging cable. Keep your phone close: the COROS app will ask you to allow the connection. Charging but not showing up? Try another USB port or a dock."),
            action: checkButton,
          };
  } else if (sending && transferProgress) {
    const percent = ((transferProgress.index - 1 + transferProgress.fileProgress) / transferProgress.total) * 100;
    detail = {
      tone: "current",
      icon: <Loader2 size={17} className="spin" aria-hidden="true" />,
      title: t("Sending {{p0}} of {{p1}}", { p0: transferProgress.index, p1: transferProgress.total }),
      body: (
        <>
          <span className="watch-guide-track">{transferProgress.name}</span>
          <span className="watch-guide-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
            <span style={{ width: `${percent}%` }} />
          </span>
        </>
      ),
      action: <span className="watch-guide-hint">{t("Keep the watch plugged in")}</span>,
    };
  } else if (done) {
    detail = {
      tone: "done",
      icon: <PartyPopper size={17} aria-hidden="true" />,
      title: t("All set. Eject and go"),
      body: t("Eject the watch, then unplug it. Start a run and open Music on the watch to play."),
      action: ejectButton,
    };
  } else {
    detail = {
      tone: current === 3 ? "current" : "upcoming",
      icon: <Send size={17} aria-hidden="true" />,
      title: t("Send to your watch"),
      body: state !== "connected"
        ? t("Once the watch is connected, everything new goes over in one tap.")
        : pendingCount > 0
          ? t("{{p0}} new item(s) will be copied. Leave the watch plugged in until it finishes.", { p0: pendingCount })
          : t("Nothing new to send yet. Choose something to play first."),
      action: canEject ? ejectButton : sendButton,
    };
  }

  return (
    <section
      className={collapsed ? "watch-guide is-collapsed" : "watch-guide"}
      aria-label={t("Put it on your watch")}
    >
      <header className="watch-guide-head">
        <span className="watch-guide-title">{t("Put it on your watch")}</span>
        <ol className="watch-guide-stepper">
          {([1, 2, 3] as const).map((step) => (
            <Fragment key={step}>
              {step > 1 ? (
                <li className={tones[(step - 1) as StepId] === "done" ? "watch-guide-rail is-done" : "watch-guide-rail"} aria-hidden="true" />
              ) : null}
              <li>
                <button
                  type="button"
                  className={`watch-guide-step is-${tones[step]}${(showEjected ? 3 : shown) === step && !collapsed ? " is-shown" : ""}`}
                  aria-current={current === step ? "step" : undefined}
                  onClick={() => {
                    if (collapsed) toggleCollapsed();
                    setViewed(step === current ? null : step);
                  }}
                >
                  <span className="watch-guide-mark" aria-hidden="true">
                    {tones[step] === "done" ? <Check size={12} strokeWidth={3} /> : step}
                  </span>
                  <span className="watch-guide-step-label">{labels[step]}</span>
                </button>
              </li>
            </Fragment>
          ))}
        </ol>
        <div className="watch-guide-head-end">
          {collapsed && canSend ? sendButton : null}
          {collapsed && canEject ? ejectButton : null}
          <button
            type="button"
            className="watch-guide-collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("Show steps") : t("Hide steps")}
            title={collapsed ? t("Show steps") : t("Hide steps")}
            onClick={toggleCollapsed}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {collapsed ? null : (
        <div className={`watch-guide-detail is-${detail.tone}`} aria-live="polite">
          <span className="watch-guide-tile" aria-hidden="true">{detail.icon}</span>
          <div className="watch-guide-copy">
            <strong>{detail.title}</strong>
            <span>{detail.body}</span>
          </div>
          {detail.action ? <div className="watch-guide-action">{detail.action}</div> : null}
        </div>
      )}
    </section>
  );
}
