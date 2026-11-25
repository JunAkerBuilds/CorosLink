import { t, useLanguage } from "../i18n";
import { useEffect, useId } from "react";
import { ArrowRightLeft, Check, Command, MessageCircle, Palette, Sparkles } from "lucide-react";
import "./clinkSwitchPrompt.css";

interface ClinkSwitchPromptProps {
  /** Moves this Mac to the C-LINK beta; it arrives through the normal update flow. */
  onSwitch: () => void;
  /** "Not now": remembered, so the offer never opens by itself again. */
  onDecline: () => void;
}

/** C-LINK's mark (its app icon's "C" and dot), drawn here so CorosLink needs no image of it. */
function ClinkMark() {
  const id = useId();
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0.15" y1="0.1" x2="0.85" y2="0.9">
          <stop offset="0" stopColor="#8cf0c9" />
          <stop offset="1" stopColor="#1fa577" />
        </linearGradient>
      </defs>
      <path d="M665 318A255 255 0 1 0 665 705" fill="none" stroke={`url(#${id})`} strokeWidth="112" strokeLinecap="round" />
      <circle cx="690" cy="512" r="72" fill="#53cba1" />
    </svg>
  );
}

const FEATURES = [
  { icon: Sparkles, title: "A fresh design", text: "Every screen rebuilt, in light and dark." },
  { icon: MessageCircle, title: "Coach on every screen", text: "Ask from anywhere, with the AI you pick." },
  { icon: Palette, title: "Studio", text: "Design watch faces from a template or from scratch." },
  { icon: Command, title: "Go anywhere", text: "⌘K jumps to any screen or setting." },
] as const;

/**
 * The one-time offer to move from CorosLink to the C-LINK desktop beta, in C-LINK's own look: its dark green, its
 * mark and its mint, so it reads as something new rather than another CorosLink notice.
 */
export function ClinkSwitchPrompt({ onSwitch, onDecline }: ClinkSwitchPromptProps) {
  useLanguage();

  // Keys stay in the dialog, as in the restart prompt: Escape means Not now.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onDecline();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onDecline]);

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section
        className="update-prompt clink-switch-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clink-switch-title"
        aria-describedby="clink-switch-description"
      >
        <header className="clink-switch-hero">
          <div className="clink-switch-brand">
            <span className="clink-switch-mark"><ClinkMark /></span>
            <span className="clink-switch-word">C-LINK</span>
            <span className="clink-switch-badge">{t("New")}</span>
            <span className="clink-switch-badge is-quiet">{t("Beta")}</span>
          </div>
          <h2 id="clink-switch-title">{t("Meet the new C-LINK")}</h2>
          <p id="clink-switch-description">
            {t("C-LINK is the rebuilt CorosLink. It replaces CorosLink on this Mac and brings over your watch, plans, Coach chats and settings.")}
          </p>
        </header>

        <ul className="clink-switch-features">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="clink-switch-feature-icon" aria-hidden="true"><Icon size={17} /></span>
              <span>
                <strong>{t(title)}</strong>
                <small>{t(text)}</small>
              </span>
            </li>
          ))}
        </ul>

        <ul className="clink-switch-notes">
          <li><Check size={14} aria-hidden="true" />{t("CorosLink's data is kept as a copy.")}</li>
          <li><Check size={14} aria-hidden="true" />{t("It's a beta, so some things may still change.")}</li>
          <li><Check size={14} aria-hidden="true" />{t("C-LINK downloads like an update and installs when you restart.")}</li>
        </ul>

        <footer className="update-prompt-footer clink-switch-footer">
          <div className="update-prompt-actions">
            <button className="secondary-button clink-switch-later" type="button" onClick={onDecline}>
              {t("Not now")}
            </button>
            <button className="primary-button clink-switch-go" type="button" autoFocus onClick={onSwitch}>
              <ArrowRightLeft size={16} aria-hidden="true" />
              {t("Switch to C-LINK")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
