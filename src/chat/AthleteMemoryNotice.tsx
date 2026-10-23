import { t, useLanguage } from "../i18n/tools";
import { useState } from "react";
import { BookmarkMinus, BookmarkPlus, Loader2, PenLine, Settings2, Undo2 } from "lucide-react";
import { ATHLETE_FACT_CATEGORY_LABELS, type AthleteMemoryNotice } from "../../electron/athleteMemoryModel";
import "./athleteMemory.css";

const KICKERS: Record<AthleteMemoryNotice["action"], string> = {
  remembered: "Coach remembered",
  updated: "Coach updated a memory",
  forgot: "Coach forgot"
};

const ICONS = { remembered: BookmarkPlus, updated: PenLine, forgot: BookmarkMinus } as const;

/**
 * One line in the transcript for each memory write, so nothing is remembered
 * silently: what was saved, Undo, and a way to the full list in Coach settings.
 */
export function AthleteMemoryNoticeRow({
  notice,
  onUndo,
  onManage
}: {
  notice: AthleteMemoryNotice;
  onUndo: () => Promise<void>;
  onManage?: () => void;
}) {
  useLanguage();
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string>();
  const Icon = ICONS[notice.action] ?? BookmarkPlus;

  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    setError(undefined);
    try {
      await onUndo();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
      setError(message || t("This memory change can't be undone."));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className={`chat-memory-notice is-${notice.action}${notice.undone ? " is-undone" : ""}`}>
      <span className="chat-memory-notice-icon" aria-hidden="true"><Icon size={15} strokeWidth={1.9} /></span>
      <div className="chat-memory-notice-body">
        <span className="chat-memory-notice-kicker">{notice.undone ? t("Undone") : t(KICKERS[notice.action])}</span>
        <p className="chat-memory-notice-text">
          <span className="chat-memory-notice-category">{t(ATHLETE_FACT_CATEGORY_LABELS[notice.fact.category])}:</span> {notice.fact.text}
        </p>
        {notice.action === "updated" && notice.previous && notice.previous.text !== notice.fact.text ? (
          <span className="chat-memory-notice-previous">{notice.previous.text}</span>
        ) : null}
      </div>
      <div className="chat-memory-notice-actions">
        {notice.undone ? null : (
          <button type="button" onClick={() => void undo()} disabled={undoing}>
            {undoing ? <Loader2 className="chat-spinner" size={13} aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}
            {t("Undo")}
          </button>
        )}
        {onManage ? (
          <button type="button" onClick={onManage} aria-label={t("Manage Coach memory")} title={t("Manage Coach memory")}>
            <Settings2 size={13} aria-hidden="true" />
            {t("Memory")}
          </button>
        ) : null}
      </div>
      {error ? <p className="chat-memory-notice-error" role="alert">{error}</p> : null}
    </div>
  );
}
