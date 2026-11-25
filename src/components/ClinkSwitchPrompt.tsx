import { t, useLanguage } from "../i18n";
import { useEffect } from "react";
import { ArrowRightLeft, Sparkles } from "lucide-react";
import "./restartUnsavedPrompt.css";
import "./clinkSwitchPrompt.css";

interface ClinkSwitchPromptProps {
  /** Moves this Mac to the C-LINK beta; it arrives through the normal update flow. */
  onSwitch: () => void;
  /** "Not now": remembered, so the offer never opens by itself again. */
  onDecline: () => void;
}

/**
 * The one-time offer to move from CorosLink to the C-LINK desktop beta.
 * Same shell as the update and restart prompts.
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
        className="update-prompt restart-unsaved-prompt clink-switch-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clink-switch-title"
        aria-describedby="clink-switch-description"
      >
        <header className="update-prompt-header">
          <span className="restart-unsaved-icon" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <div>
            <p className="update-prompt-eyebrow">{t("C-LINK beta")}</p>
            <h2 id="clink-switch-title">{t("The new C-LINK desktop app is here (beta)")}</h2>
            <p id="clink-switch-description">
              {t("C-LINK is the rebuilt CorosLink. It replaces CorosLink on this Mac and brings over your watch, plans, Coach chats and settings.")}
            </p>
          </div>
        </header>

        <ul className="restart-unsaved-list">
          <li>
            <span>{t("CorosLink's data is kept as a copy.")}</span>
          </li>
          <li>
            <span>{t("It's a beta, so some things may still change.")}</span>
          </li>
        </ul>

        <footer className="update-prompt-footer">
          <p>{t("C-LINK downloads like an update and installs when you restart.")}</p>
          <div className="update-prompt-actions">
            <button className="secondary-button" type="button" onClick={onDecline}>
              {t("Not now")}
            </button>
            <button className="primary-button" type="button" autoFocus onClick={onSwitch}>
              <ArrowRightLeft size={16} aria-hidden="true" />
              {t("Switch to C-LINK")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
