import { Languages } from "lucide-react";
import { LANGUAGES, t, useLanguage } from "../i18n";

export function LanguageSettings() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="panel settings-units-panel settings-language-panel">
      <div className="settings-units-heading">
        <span className="settings-units-icon" aria-hidden="true"><Languages size={22} /></span>
        <div>
          <p className="eyebrow">{t("Language")}</p>
          <h2>{t("App language")}</h2>
          <p>{t("Choose the language used throughout the desktop app. Changes apply immediately.")}</p>
        </div>
      </div>
      <div className="settings-unit-options" role="radiogroup" aria-label={t("App language")}>
        {LANGUAGES.map(option => (
          <button key={option.value} type="button" role="radio" lang={option.value}
            aria-checked={language === option.value}
            className={language === option.value ? "is-active" : ""}
            onClick={() => setLanguage(option.value)}>
            <span className="settings-unit-radio" aria-hidden="true" />
            <strong>{option.label}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
