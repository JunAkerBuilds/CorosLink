import { useEffect, useId, useState } from "react";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";

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
      if (!api) throw new Error("Coach is unavailable");
      setBaseInstructions(await api.getBaseCoachInstructions());
    } catch {
      setBaseError(true);
    } finally {
      setLoadingBase(false);
    }
  };

  return (
    <section className="chat-settings-section chat-coach-instructions-section">
      <h3>Coach instructions</h3>
      <p className="chat-settings-copy" id={descriptionId}>
        Tell your coach about your goals, training days, equipment, or preferred
        tone. Saved preferences apply to your next message with any provider.
      </p>
      <label className="chat-local-field">
        <span>Custom instructions</span>
        <textarea
          className="chat-custom-instructions"
          rows={5}
          maxLength={MAX_CUSTOM_COACH_INSTRUCTIONS}
          aria-describedby={`${descriptionId} ${countId}`}
          placeholder="I'm training for an October marathon. I can run Tuesday, Thursday, and Saturday. Keep advice concise."
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
          {saving ? "Saving…" : dirty ? "Unsaved changes" : saved || value ? "Saved" : "Leave blank to use defaults"}
        </span>
        <span id={countId}>
          {draft.length.toLocaleString()} / {MAX_CUSTOM_COACH_INSTRUCTIONS.toLocaleString()} characters
        </span>
      </div>
      {saveError ? (
        <p className="chat-custom-instructions-error" role="alert">
          Could not save your instructions. Your changes are still here. Try again.
        </p>
      ) : null}
      <div className="chat-custom-instructions-footer">
        <p className="chat-settings-copy">
          Stored on this device and sent to your selected AI provider with each message.
        </p>
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
            Discard changes
          </button>
          <button
            type="button"
            className="chat-local-action primary"
            disabled={!dirty || saving || disabled || !api}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            Save instructions
          </button>
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
          View default coach instructions
        </summary>
        {baseError ? (
          <div className="chat-base-instructions-status" role="alert">
            <p className="chat-settings-copy">Could not load the default instructions.</p>
            <button type="button" className="chat-local-action" onClick={() => void loadBaseInstructions()}>
              Try again
            </button>
          </div>
        ) : baseInstructions === null ? (
          <p className="chat-settings-copy chat-base-instructions-status" role="status">Loading…</p>
        ) : (
          <pre className="chat-base-instructions-body" tabIndex={0} aria-label="Default coach instructions">{baseInstructions}</pre>
        )}
      </details>
    </section>
  );
}
