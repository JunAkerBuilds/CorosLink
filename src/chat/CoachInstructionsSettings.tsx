import { t, useLanguage, getLocale } from "../i18n/tools";
import { useEffect, useId, useState } from "react";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  ChatSettingsSectionHeader,
  chatSettingsSectionDomId
} from "./chatSettingsSections";

export function CoachInstructionsSettings({
  api,
  value,
  disabled,
  onSave
}: {
  api: CorosLinkApi | undefined;
  value: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  useLanguage();
  const descriptionId = useId();
  const countId = useId();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseInstructions, setBaseInstructions] = useState<string | null>(null);
  const [loadingBase, setLoadingBase] = useState(false);
  const [baseError, setBaseError] = useState(false);
  const dirty = draft.trim() !== value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const save = async () => {
    if (!dirty || saving || disabled || !api) return;
    setSaving(true);
    setSaveError(false);
    try {
      const ok = await onSave(draft.trim());
      setSaved(ok);
      setSaveError(!ok);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const loadBaseInstructions = async () => {
    if (baseInstructions !== null || loadingBase) return;
    setLoadingBase(true);
    setBaseError(false);
    try {
      if (!api) throw new Error(t("Coach is unavailable"));
      setBaseInstructions(await api.getBaseCoachInstructions());
    } catch {
      setBaseError(true);
    } finally {
      setLoadingBase(false);
    }
  };

  return (
    <section
      className="chat-settings-section chat-coach-instructions-section"
      id={chatSettingsSectionDomId("coach")}
      data-settings-section="coach"
    >
      <ChatSettingsSectionHeader id="coach" />
      <p className="chat-settings-copy" id={descriptionId}>
        {t("Tell your coach about your goals, training days, equipment, or preferred tone. Saved preferences apply to your next message with any provider.")}</p>
      <label className="chat-local-field">
        <span>{t("Custom instructions")}</span>
        <textarea
          className="chat-custom-instructions"
          rows={5}
          maxLength={MAX_CUSTOM_COACH_INSTRUCTIONS}
          aria-describedby={`${descriptionId} ${countId}`}
          placeholder={t("I'm training for an October marathon. I can run Tuesday, Thursday, and Saturday. Keep advice concise.")}
          value={draft}
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaveError(false);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
      </label>
      <div className="chat-custom-instructions-meta">
        <span role="status">
          {saving ? t("Saving…") : dirty ? t("Unsaved changes") : saved || value ? t("Saved") : t("Leave blank to use defaults")}
        </span>
        <span id={countId}>
          {draft.length.toLocaleString(getLocale())} / {MAX_CUSTOM_COACH_INSTRUCTIONS.toLocaleString(getLocale())}  {t("characters")}</span>
      </div>
      {saveError ? (
        <p className="chat-custom-instructions-error" role="alert">
          {t("Could not save your instructions. Your changes are still here. Try again.")}</p>
      ) : null}
      <div className="chat-custom-instructions-footer">
        <p className="chat-settings-copy">
          {t("Stored on this device and sent to your selected AI provider with each message.")}</p>
        <div className="chat-local-actions">
          <button
            type="button"
            className="chat-local-action"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(value);
              setSaveError(false);
              setSaved(false);
            }}
          >
            {t("Discard changes")}</button>
          <button
            type="button"
            className="chat-local-action primary"
            disabled={!dirty || saving || disabled || !api}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {t("Save instructions")}</button>
        </div>
      </div>
      <details
        className="chat-base-instructions"
        onToggle={(event) => {
          if (event.currentTarget.open) void loadBaseInstructions();
        }}
      >
        <summary>
          <ChevronDown size={14} aria-hidden="true" />
          {t("View default coach instructions")}</summary>
        {baseError ? (
          <div className="chat-base-instructions-status" role="alert">
            <p className="chat-settings-copy">{t("Could not load the default instructions.")}</p>
            <button type="button" className="chat-local-action" onClick={() => void loadBaseInstructions()}>
              {t("Try again")}</button>
          </div>
        ) : baseInstructions === null ? (
          <p className="chat-settings-copy chat-base-instructions-status" role="status">{t("Loading…")}</p>
        ) : (
          <pre className="chat-base-instructions-body" tabIndex={0} aria-label={t("Default coach instructions")}>{baseInstructions}</pre>
        )}
      </details>
    </section>
  );
}
