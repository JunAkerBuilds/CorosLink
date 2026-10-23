import { useLanguage, t } from "../../i18n/training";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { clipActivityName, normalizeActivityName } from "../../../electron/activityName";
import { ipcErrorText } from "../../ipcErrorText";
import "../activityTitle.css";

interface ActivityTitleEditorProps {
  /** The heading as shown, fallbacks applied (the activity's name, or its sport). */
  title: string;
  /** The stored name, which the field starts from; empty when the activity has none. */
  name?: string;
  as?: "h2" | "h3";
  /** Lands on the title text alone, so aria-labelledby never reads the buttons. */
  id?: string;
  /** Saves the new name; without it the title is read-only. */
  onRename?: (name: string) => Promise<unknown>;
}

/**
 * An activity's title that renames in place, like Training Hub's list: Enter
 * or leaving the field saves, Escape cancels, an empty name keeps the old one.
 * Key it by activity so a half-typed name never follows you to the next one.
 */
export function ActivityTitleEditor({ title, name, as: Heading = "h2", id, onRename }: ActivityTitleEditorProps) {
  useLanguage();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The saved name, shown until the activity list catches up with it.
  const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // Finished from the keyboard: hand focus back to the pencil, not the page.
  const refocus = useRef(false);
  const editing = draft !== null;
  const shown = renamed && renamed.from === title ? renamed.to : title;

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function begin() {
    if (!onRename) return;
    setError(null);
    setDraft(name || shown);
  }

  function cancel() {
    setDraft(null);
    setError(null);
  }

  async function save() {
    if (draft === null || saving || !onRename) return;
    const next = normalizeActivityName(draft);
    if (!next || next === (name || shown)) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(next);
      setRenamed({ from: title, to: next });
      setDraft(null);
    } catch (caught) {
      refocus.current = false;
      setError(t(ipcErrorText(caught)));
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      refocus.current = true;
      void save();
    } else if (event.key === "Escape") {
      // Escape ends the edit only; the activity dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      refocus.current = true;
      cancel();
    }
  }

  if (!editing) {
    return (
      <Heading className="activity-title">
        <span id={id} className="activity-title-text" title={shown} onDoubleClick={onRename ? begin : undefined}>{shown}</span>
        {onRename ? (
          <button ref={editButton} type="button" className="activity-title-edit" onClick={begin}
            aria-label={t("Rename activity")} title={t("Rename activity")}>
            <Pencil size={14} aria-hidden="true" />
          </button>
        ) : null}
      </Heading>
    );
  }

  const errorId = id ? `${id}-rename-error` : undefined;
  return (
    <>
      <Heading className="activity-title is-editing">
        <span id={id} className="sr-only">{shown}</span>
        <input
          ref={input}
          className="activity-title-input"
          value={draft}
          readOnly={saving}
          aria-label={t("Activity name")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          spellCheck={false}
          onChange={(event) => {
            setError(null);
            setDraft(clipActivityName(event.target.value));
          }}
          onKeyDown={onKeyDown}
          onBlur={() => { if (!error) void save(); }}
        />
        {/* Holding focus in the field on mousedown stops a click here from blur-saving first. */}
        <button type="button" className="activity-title-action is-save" disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { refocus.current = event.detail === 0; void save(); }}
          aria-label={t("Save name")} title={t("Save name")}>
          {saving ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="activity-title-action" disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { refocus.current = event.detail === 0; cancel(); }}
          aria-label={t("Cancel")} title={t("Cancel")}>
          <X size={15} aria-hidden="true" />
        </button>
      </Heading>
      {error ? <p className="activity-title-error" id={errorId} role="alert">{error}</p> : null}
    </>
  );
}
