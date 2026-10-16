import { t, useLanguage } from "../i18n/tools";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { CoachCorosActionPreview } from "../../electron/types";
import { isoDateFromCompact } from "./chatTypes";

export function CorosActionCard({ preview, onConfirm }: {
  preview: CoachCorosActionPreview;
  onConfirm: () => Promise<CoachCorosActionPreview | undefined>;
}) {
  useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CoachCorosActionPreview>();
  const current = result ?? preview;
  const date = isoDateFromCompact(current.date);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try { setResult(await onConfirm()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("Unable to save this workout.")); }
    finally { setSaving(false); }
  };
  return <div className="chat-plan-card chat-coros-action-card">
    <div className="chat-plan-card-header">
      <h4>{t(current.title)}</h4>
      <span className="chat-plan-card-summary">{t(current.destination)}{date ? ` · ${date}` : ""}</span>
    </div>
    <p className="chat-plan-card-summary">{current.summary}</p>
    {current.details.length > 0 && <details className="chat-coros-action-details">
      <summary>{t("Workout details")}</summary>
      <ul>{current.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
    </details>}
    {current.message && <p role="status">{current.state === "saved" && <Check size={14} aria-hidden="true" />} {current.message}</p>}
    {error && <p role="alert">{error}</p>}
    {(current.state === "pending" || current.state === "saving") && <div className="chat-plan-actions">
      <button type="button" className="chat-plan-upload" onClick={() => void save()} disabled={saving}>
        {saving && <Loader2 className="chat-spinner" size={14} aria-hidden="true" />}
        {saving ? t("Saving…") : current.state === "saving" ? t("Check save status") : t("Save to COROS")}
      </button>
    </div>}
  </div>;
}
