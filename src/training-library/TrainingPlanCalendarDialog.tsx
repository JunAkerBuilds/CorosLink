import {
  AlertTriangle,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  TrainingPlanCalendarMutationResult,
  TrainingPlanCalendarPreview,
  TrainingPlanDocument
} from "../../electron/types";
import { activeTrainingPlanCalendarInstall } from "../../electron/trainingPlanDomain";
import type { CorosLinkApi } from "../coroslink-api";

interface TrainingPlanCalendarDialogProps {
  api: CorosLinkApi;
  plan: TrainingPlanDocument;
  offline: boolean;
  requestedOperation?: "install" | "remove";
  onClose: () => void;
  onComplete: (result: TrainingPlanCalendarMutationResult) => void;
}

function mondayOnOrAfter(value = new Date()): string {
  const date = new Date(value);
  const offset = (8 - date.getDay()) % 7;
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDay(value: string): string {
  const digits = value.replaceAll("-", "");
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function initialInstallDate(plan: TrainingPlanDocument): string {
  const value = plan.startDate?.replaceAll("-", "");
  if (value && /^\d{8}$/.test(value)) {
    const dashed = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
    const date = new Date(`${dashed}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(date.valueOf()) && date >= today && date.getDay() === 1) return dashed;
  }
  return mondayOnOrAfter();
}

export function TrainingPlanCalendarDialog({ api, plan, offline, requestedOperation, onClose, onComplete }: TrainingPlanCalendarDialogProps) {
  const install = activeTrainingPlanCalendarInstall(plan);
  const operation = requestedOperation ?? (install && !(install.state === "partial" && install.lastOperation === "install") ? "remove" : "install");
  const [startDate, setStartDate] = useState(() => initialInstallDate(plan));
  const [preview, setPreview] = useState<TrainingPlanCalendarPreview | null>(null);
  const [loading, setLoading] = useState(operation === "remove" && !offline);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflictCount = useMemo(
    () => preview?.conflicts.reduce((sum, conflict) => sum + conflict.existing.length, 0) ?? 0,
    [preview]
  );

  const loadPreview = async () => {
    if (offline) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(operation === "install"
        ? await api.previewTrainingPlanCalendar(plan.id, startDate)
        : await api.previewTrainingPlanCalendarRemoval(plan.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (operation === "remove" && !offline) void loadPreview();
    // Removal has no editable date; it previews immediately on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || mutating) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mutating, onClose]);

  const confirm = async () => {
    if (!preview || preview.blockers.length > 0) return;
    setMutating(true);
    setError(null);
    try {
      const result = operation === "install"
        ? await api.addTrainingPlanToCalendar(preview.previewId, true)
        : await api.removeTrainingPlanFromCalendar(preview.previewId, true);
      onComplete(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPreview(null);
    } finally {
      setMutating(false);
    }
  };

  return <div className="plan-calendar-backdrop">
    <section className="plan-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-calendar-title">
      <header>
        <div><p className="tl-eyebrow">COROS calendar</p><h2 id="plan-calendar-title">{operation === "install" ? <CalendarPlus size={20} /> : <CalendarX size={20} />}{operation === "install" ? "Add plan to calendar" : "Remove plan from calendar"}</h2><p>{plan.name}</p></div>
        <button type="button" className="icon-button" aria-label="Close calendar preview" disabled={mutating} onClick={onClose}><X size={17} /></button>
      </header>

      {offline ? <div className="plan-calendar-offline"><AlertTriangle size={18} /><div><strong>Calendar actions are unavailable offline</strong><p>Reconnect to COROS, refresh the Training Library, and try again.</p></div></div> : null}

      {!offline && operation === "install" && !preview ? <div className="plan-calendar-start"><label><span>Week 1 Monday</span><input autoFocus type="date" value={startDate} disabled={loading} onChange={(event) => setStartDate(event.target.value)} /></label><p>The preview checks exact dates and shows same-day workouts. Existing workouts are kept and this plan is added alongside them.</p><button type="button" className="primary-button" disabled={loading || !startDate} onClick={() => void loadPreview()}>{loading ? <LoaderCircle className="is-spinning" size={15} /> : <CalendarPlus size={15} />}{loading ? "Checking calendar..." : "Preview dates"}</button></div> : null}

      {!offline && loading ? <div className="plan-calendar-loading"><LoaderCircle className="is-spinning" size={22} /><strong>Checking the COROS calendar</strong><p>Comparing plan dates with current scheduled workouts.</p></div> : null}

      {error ? <div className="plan-calendar-error" role="alert"><AlertTriangle size={17} /><div><strong>Refresh required</strong><p>{error}</p></div><button type="button" className="ghost-button" disabled={loading || mutating} onClick={() => void loadPreview()}><RefreshCw size={14} /> Try again</button></div> : null}

      {preview ? <div className="plan-calendar-preview">
        <div className="plan-calendar-summary"><span><strong>{preview.entries.length}</strong><small>{operation === "install" ? "workouts to add" : "future workouts to remove"}</small></span><span><strong>{displayDay(preview.startDate)}</strong><small>{operation === "install" ? "Week 1 starts" : "installed start"}</small></span><span className={conflictCount ? "has-conflict" : ""}><strong>{conflictCount}</strong><small>same-day conflicts</small></span></div>
        {preview.blockers.length ? <div className="plan-calendar-blockers"><strong><AlertTriangle size={15} /> Resolve before continuing</strong>{preview.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}</div> : null}
        <div className="plan-calendar-dates" role="list">{preview.entries.map((entry) => {
          const conflict = preview.conflicts.find((item) => item.happenDay === entry.happenDay);
          return <article key={`${entry.planEntryId}:${entry.happenDay}`} role="listitem"><time>{displayDay(entry.happenDay)}</time><div><strong>{entry.name}</strong>{conflict ? <small>{conflict.existing.length} existing: {conflict.existing.map((item) => item.name).join(", ")}</small> : <small><CheckCircle2 size={12} /> No same-day conflict</small>}</div></article>;
        })}</div>
        {operation === "remove" ? <p className="plan-calendar-safety">Only recorded occurrences owned by this plan dated today or later are removed. Past, completed, and unrelated workouts stay untouched.</p> : null}
      </div> : null}

      <footer><button type="button" className="ghost-button" disabled={mutating} onClick={onClose}>Cancel</button>{preview ? <button type="button" className={operation === "remove" ? "danger-button" : "primary-button"} disabled={mutating || preview.blockers.length > 0} onClick={() => void confirm()}>{mutating ? <LoaderCircle className="is-spinning" size={15} /> : operation === "install" ? <CalendarPlus size={15} /> : <CalendarX size={15} />}{mutating ? (operation === "install" ? "Adding serially..." : "Removing serially...") : operation === "install" ? "Add alongside conflicts" : "Remove future workouts"}</button> : null}</footer>
    </section>
  </div>;
}
