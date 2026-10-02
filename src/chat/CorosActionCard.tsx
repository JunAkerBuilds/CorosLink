import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { CoachCorosActionPreview } from "../../electron/types";

export function CorosActionCard({ preview, onConfirm }: {
  preview: CoachCorosActionPreview;
  onConfirm: () => Promise<CoachCorosActionPreview | undefined>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CoachCorosActionPreview>();
  const current = result ?? preview;
  const date = current.date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try { setResult(await onConfirm()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save this workout."); }
    finally { setSaving(false); }
  };
  return <div className="chat-plan-card chat-coros-action-card">
    <div className="chat-plan-card-header">
      <h4>{current.title}</h4>
      <span className="chat-plan-card-summary">{current.destination}{date ? ` · ${date}` : ""}</span>
    </div>
    <p className="chat-plan-card-summary">{current.summary}</p>
    {current.details.length > 0 && <details className="chat-coros-action-details">
      <summary>Workout details</summary>
      <ul>{current.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
    </details>}
    {current.message && <p role="status">{current.state === "saved" && <Check size={14} aria-hidden="true" />} {current.message}</p>}
    {error && <p role="alert">{error}</p>}
    {(current.state === "pending" || current.state === "saving") && <div className="chat-plan-actions">
      <button type="button" className="chat-plan-upload" onClick={() => void save()} disabled={saving}>
        {saving && <Loader2 className="chat-spinner" size={14} aria-hidden="true" />}
        {saving ? "Saving…" : current.state === "saving" ? "Check save status" : "Save to COROS"}
      </button>
    </div>}
  </div>;
}
