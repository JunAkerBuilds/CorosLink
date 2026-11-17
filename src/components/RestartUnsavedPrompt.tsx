import { t, useLanguage } from "../i18n";
import { useEffect, useState } from "react";
import { FileWarning, Loader2, Save } from "lucide-react";
import { listUnsavedWork, saveAllUnsavedWork, type PendingUnsavedWork } from "../unsavedWork";
import "./restartUnsavedPrompt.css";

interface RestartUnsavedPromptProps {
  /** Installs the update now; the app quits. */
  onRestart: () => void;
  onCancel: () => void;
}

type SaveProblem = { label: string; reason: "failed" | "manual" };

/**
 * Asked before an update restarts CorosLink while something is unsaved:
 * save it all first, restart without saving, or keep working.
 */
export function RestartUnsavedPrompt({ onRestart, onCancel }: RestartUnsavedPromptProps) {
  useLanguage();
  const [items, setItems] = useState<PendingUnsavedWork[]>(() => listUnsavedWork());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<SaveProblem | null>(null);

  // Keys stay in the dialog: an editor underneath (Studio, the workout editor)
  // must not act on Escape or its shortcuts. Buttons and Tab still work.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (!saving) onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel, saving]);

  const saveAndRestart = async () => {
    setSaving(true);
    setProblem(null);
    const result = await saveAllUnsavedWork();
    if (result.ok) {
      onRestart();
      return;
    }
    setProblem({ label: result.label, reason: result.reason });
    setItems(listUnsavedWork());
    setSaving(false);
  };

  return (
    <div className="update-prompt-backdrop" role="presentation">
      <section
        className="update-prompt restart-unsaved-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restart-unsaved-title"
        aria-describedby="restart-unsaved-description"
        aria-busy={saving}
      >
        <header className="update-prompt-header">
          <span className="restart-unsaved-icon" aria-hidden="true">
            <FileWarning size={22} />
          </span>
          <div>
            <p className="update-prompt-eyebrow">{t("Restart to update")}</p>
            <h2 id="restart-unsaved-title">{t("Save your work before restarting?")}</h2>
            <p id="restart-unsaved-description">
              {t("CorosLink closes to install the update. These changes aren't saved yet:")}
            </p>
          </div>
        </header>

        <ul className="restart-unsaved-list">
          {items.map((item, index) => (
            <li key={index}>
              <span>{item.label}</span>
              {item.save ? null : <small>{t("Save this one yourself")}</small>}
            </li>
          ))}
        </ul>

        {problem ? (
          <p className="restart-unsaved-error" role="alert">
            {problem.reason === "manual"
              ? t("{{value1}} can't be saved from here. Save it yourself, then restart again.", { value1: problem.label })
              : t("{{value1}} couldn't be saved. CorosLink didn't restart.", { value1: problem.label })}
          </p>
        ) : null}

        <footer className="update-prompt-footer restart-unsaved-footer">
          <button className="secondary-button danger-button" type="button" disabled={saving} onClick={onRestart}>
            {t("Restart without saving")}
          </button>
          <div className="update-prompt-actions">
            <button className="secondary-button" type="button" disabled={saving} onClick={onCancel}>
              {t("Cancel")}
            </button>
            <button
              className="primary-button"
              type="button"
              autoFocus
              disabled={saving}
              onClick={() => void saveAndRestart()}
            >
              {saving ? (
                <Loader2 size={16} className="restart-unsaved-spin" aria-hidden="true" />
              ) : (
                <Save size={16} aria-hidden="true" />
              )}
              {saving ? t("Saving…") : t("Save and restart")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
