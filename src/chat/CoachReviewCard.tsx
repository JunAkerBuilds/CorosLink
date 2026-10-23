import { t, useLanguage } from "../i18n/tools";
import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleCheck, Flag, HeartPulse, Info, Loader2, X } from "lucide-react";
import type { CoachReviewAction, CoachReviewPreview } from "../../electron/coachReviewTypes";
import "./coachReviewCard.css";

const ACTION_ICONS: Record<CoachReviewAction, typeof Flag> = {
  addTargetRace: Flag,
  updateZones: HeartPulse
};

function confirmLabel(preview: CoachReviewPreview): string {
  if (preview.action === "addTargetRace") return t("Add race");
  return t("Update watch");
}

// Labels the Coach's tools write; anything else (a workout's name) is shown as written.
const ITEM_LABELS = new Set(["Race", "Date", "Distance", "Goal", "Priority", "Location", "Max heart rate", "Threshold heart rate", "Resting heart rate", "Heart-rate zones", "Threshold pace"]);

function errorText(caught: unknown): string {
  const message = caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "";
  return message || t("The change couldn't be saved.");
}

/**
 * A Coach write waiting for the athlete: moving calendar workouts, adding a
 * target race, or changing the watch's thresholds. Nothing changes until the
 * athlete clicks the card's button; the hub's entry is the truth afterwards.
 */
export function CoachReviewCard({
  preview,
  onConfirm,
  onDismiss
}: {
  preview: CoachReviewPreview;
  onConfirm: () => Promise<CoachReviewPreview | undefined>;
  onDismiss: () => Promise<CoachReviewPreview | undefined>;
}) {
  useLanguage();
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CoachReviewPreview>();
  useEffect(() => setResult(undefined), [preview]);
  const current = result ?? preview;
  const Icon = ACTION_ICONS[current.action] ?? Info;
  const saving = busy === "confirm" || current.state === "saving";
  const settled = current.state !== "pending" && current.state !== "saving";
  // Line-by-line results matter only when something didn't go through.
  const showResults = current.state === "partial" || current.state === "failed";

  const act = async (kind: "confirm" | "dismiss") => {
    if (busy) return;
    setBusy(kind);
    setError(undefined);
    try {
      setResult(await (kind === "confirm" ? onConfirm() : onDismiss()));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`chat-plan-card chat-review-card is-${current.state}`}>
      <div className="chat-plan-card-header">
        <div className="chat-review-heading">
          <span className="chat-review-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
          <div className="chat-plan-card-title">
            <span className="chat-workout-card-kicker">{t("Review")}</span>
            <h4>{t(current.title)}</h4>
            <span className="chat-plan-card-summary">{current.summary}</span>
          </div>
        </div>
      </div>

      <ol className="chat-review-items">
        {current.items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className={`chat-review-item${showResults && item.result ? (item.result.ok ? " is-ok" : " is-failed") : ""}`}
          >
            <span className="chat-review-item-label">{ITEM_LABELS.has(item.label) ? t(item.label) : item.label}</span>
            <span className="chat-review-item-change">
              {item.before ? (
                <>
                  <span className="chat-review-item-before">{item.before}</span>
                  <ArrowRight size={13} aria-label={t("to")} />
                </>
              ) : null}
              <span className="chat-review-item-after">{item.after}</span>
            </span>
            {showResults && item.result ? (
              <span className="chat-review-item-result">
                {item.result.ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                {item.result.ok ? t("Done") : item.result.message ?? t("Not changed")}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {current.notes?.length && !settled ? (
        <ul className="chat-review-notes">
          {current.notes.map((note) => (
            <li key={note}><Info size={13} aria-hidden="true" />{note}</li>
          ))}
        </ul>
      ) : null}

      {current.state === "saved" ? (
        <p className="chat-plan-success">
          <CircleCheck size={15} aria-hidden="true" />
          <span>{current.message ?? t("Saved.")}</span>
        </p>
      ) : current.state === "dismissed" ? (
        <p className="chat-review-status">{t("Dismissed. Nothing changed.")}</p>
      ) : current.state === "partial" || current.state === "failed" ? (
        <p className="chat-review-status is-failed" role="status">
          {current.message ?? (current.state === "partial" ? t("Only part of this was saved.") : t("Nothing was changed."))}
        </p>
      ) : null}

      {error ? <p className="chat-review-error" role="alert">{error}</p> : null}

      {!settled ? (
        <div className="chat-plan-actions">
          <button type="button" className="chat-plan-upload" disabled={busy !== null || saving} onClick={() => void act("confirm")}>
            {saving ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
            {saving ? t("Saving…") : confirmLabel(current)}
          </button>
          <button type="button" className="chat-plan-review" disabled={busy !== null || saving} onClick={() => void act("dismiss")}>
            {busy === "dismiss" ? <Loader2 className="chat-spinner" size={14} aria-hidden="true" /> : null}
            {t("Dismiss")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
