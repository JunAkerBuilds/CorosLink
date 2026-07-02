"use client";

import { type CSSProperties } from "react";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, Music, Upload, Usb } from "lucide-react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const LOCAL_TRACKS = [
  {
    title: "Tempo Run Mix",
    file: "spotify/tempo-run-mix.mp3",
    size: "8.4 MB",
    status: "Synced",
    tone: "done",
  },
  {
    title: "Hill Repeats",
    file: "youtube/hill-repeats.mp3",
    size: "9.8 MB",
    status: "Transferring",
    tone: "active",
  },
  {
    title: "Long Run Drift",
    file: "apple-music/long-run-drift.mp3",
    size: "7.2 MB",
    status: "Queued",
    tone: "queued",
  },
];

const TRANSFER_NOTES = [
  { delay: "0s", y: "-112px", scale: "0.76" },
  { delay: "1.35s", y: "-54px", scale: "0.9" },
  { delay: "2.65s", y: "14px", scale: "0.72" },
];

export function MediaCard() {
  const reduced = usePrefersReducedMotion();

  return (
    <section
      className="music-transfer-mock"
      aria-label="Animated CorosLink music transfer preview"
    >
      <div className="music-transfer-mock__frame">
        <div className="music-transfer-mock__grid">
          <LocalCachePanel reduced={reduced} />
          <TransferBridge reduced={reduced} />
          <WatchPanel reduced={reduced} />
        </div>
      </div>
    </section>
  );
}

function LocalCachePanel({ reduced }: { reduced: boolean }) {
  return (
    <article className="music-transfer-mock__panel music-transfer-mock__panel--local">
      <header className="music-transfer-mock__panel-header">
        <div>
          <span>CorosLink</span>
          <h3>Local cache</h3>
        </div>
        <em>3 tracks · 25.4 MB</em>
      </header>

      <p className="music-transfer-mock__hint">Download tracks from YouTube or Spotify</p>

      <div className="music-transfer-mock__local-empty" aria-hidden="true">
        <Music size={28} />
      </div>

      <div className="music-transfer-mock__track-stack" aria-label="Local tracks ready to transfer">
        {LOCAL_TRACKS.map((track, index) => (
          <motion.div
            className={`music-transfer-mock__track-row is-${track.tone}`}
            key={track.title}
            initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: reduced ? 0 : 0.48,
              delay: reduced ? 0 : index * 0.08,
              ease: "easeOut",
            }}
          >
            {track.tone === "active" ? (
              <motion.span
                className="music-transfer-mock__row-progress"
                initial={{ width: reduced ? "58%" : "18%" }}
                animate={{ width: reduced ? "58%" : ["18%", "82%", "18%"] }}
                transition={{
                  duration: 4.8,
                  repeat: reduced ? 0 : Infinity,
                  ease: "easeInOut",
                }}
              />
            ) : null}
            <span className="music-transfer-mock__art" aria-hidden="true">
              <Music size={17} />
            </span>
            <span className="music-transfer-mock__track-meta">
              <strong>{track.title}</strong>
              <small>{track.file}</small>
            </span>
            <span className="music-transfer-mock__track-size">{track.size}</span>
            <span className={`music-transfer-mock__badge is-${track.tone}`}>
              {track.tone === "done" ? (
                <CheckCircle2 size={13} aria-hidden="true" />
              ) : track.tone === "active" ? (
                <Loader2 className={reduced ? "" : "music-transfer-mock__spin"} size={13} aria-hidden="true" />
              ) : (
                <Upload size={13} aria-hidden="true" />
              )}
              {track.status}
            </span>
          </motion.div>
        ))}
      </div>
    </article>
  );
}

function TransferBridge({ reduced }: { reduced: boolean }) {
  return (
    <div className="music-transfer-mock__bridge" aria-hidden="true">
      <span className="music-transfer-mock__bridge-line" />
      <span className="music-transfer-mock__bridge-pill">
        <Usb size={15} />
        Syncing music
      </span>
      <span className="music-transfer-mock__bridge-line" />

      {TRANSFER_NOTES.map((note, index) => (
        <Music
          className="music-transfer-mock__flying-note"
          key={index}
          size={20}
          style={
            {
              "--note-delay": reduced ? "-6s" : note.delay,
              "--note-y": note.y,
              "--note-scale": note.scale,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function WatchPanel({ reduced }: { reduced: boolean }) {
  return (
    <article className="music-transfer-mock__panel music-transfer-mock__panel--watch">
      <header className="music-transfer-mock__panel-header">
        <div>
          <span>Connected</span>
          <h3>On watch</h3>
        </div>
        <em>Transferring</em>
      </header>

      <p className="music-transfer-mock__hint">Pace Pro connected over USB to sync music</p>

      <div className="music-transfer-mock__watch-stage">
        <WatchIllustration reduced={reduced} />
        <div className="music-transfer-mock__watch-copy">
          <strong>Transferring Hill Repeats</strong>
          <span>to view and manage your music</span>
        </div>
      </div>

      <div className="music-transfer-mock__watch-footer">
        <div className="music-transfer-mock__progress-label">
          <span>Music transfer</span>
          <strong>54%</strong>
        </div>
        <div className="music-transfer-mock__progress-track">
          <motion.span
            initial={{ width: reduced ? "54%" : "18%" }}
            animate={{ width: reduced ? "54%" : ["18%", "72%", "54%"] }}
            transition={{
              duration: 5.2,
              repeat: reduced ? 0 : Infinity,
              ease: "easeInOut",
            }}
          />
        </div>
      </div>
    </article>
  );
}

function WatchIllustration({ reduced }: { reduced: boolean }) {
  return (
    <div className="music-transfer-mock__watch-illustration">
      <svg
        className="music-transfer-mock__watch-art"
        viewBox="0 0 260 260"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="130"
          cy="130"
          r="84"
          className={reduced ? "music-transfer-mock__watch-ring" : "music-transfer-mock__watch-ring is-animated"}
        />
        <path
          className="music-transfer-mock__watch-line"
          d="M108 90 L108 58 Q108 48 118 48 L142 48 Q152 48 152 58 L152 90"
        />
        <path
          className="music-transfer-mock__watch-line"
          d="M108 170 L108 202 Q108 212 118 212 L142 212 Q152 212 152 202 L152 170"
        />
        <circle cx="130" cy="130" r="46" className="music-transfer-mock__watch-line" />
        <circle cx="130" cy="130" r="38" className="music-transfer-mock__watch-line is-faint" />
        <rect x="175" y="117" width="7" height="18" rx="3.5" className="music-transfer-mock__watch-line" />
        <rect x="175" y="140" width="6" height="11" rx="3" className="music-transfer-mock__watch-line is-faint" />

        <circle cx="44" cy="150" r="2" className="music-transfer-mock__watch-dot is-accent" />
        <circle cx="30" cy="172" r="1.6" className="music-transfer-mock__watch-dot is-green" />
        <circle cx="52" cy="108" r="1.4" className="music-transfer-mock__watch-dot is-muted" />
        <circle cx="80" cy="52" r="1.5" className="music-transfer-mock__watch-dot is-accent" />
        <circle cx="96" cy="232" r="2" className="music-transfer-mock__watch-dot is-green" />
        <circle cx="122" cy="214" r="1.6" className="music-transfer-mock__watch-dot is-muted" />
        <circle cx="150" cy="228" r="2.1" className="music-transfer-mock__watch-dot is-accent" />
        <circle cx="168" cy="58" r="1.4" className="music-transfer-mock__watch-dot is-muted" />
        <circle cx="200" cy="196" r="1.6" className="music-transfer-mock__watch-dot is-green" />
        <circle cx="212" cy="120" r="1.6" className="music-transfer-mock__watch-dot is-accent" />
        <circle cx="196" cy="150" r="1.5" className="music-transfer-mock__watch-dot is-muted" />
        <circle cx="222" cy="86" r="1.5" className="music-transfer-mock__watch-dot is-green" />
      </svg>
      <Music className="music-transfer-mock__watch-note" size={34} aria-hidden="true" />
    </div>
  );
}
