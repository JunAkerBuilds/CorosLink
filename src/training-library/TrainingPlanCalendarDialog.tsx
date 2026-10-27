import { getLocale, getDateTimeFormat, useLanguage, t, formatDate } from "../i18n/training";
import { useLocalOnlyView } from "../privacy/localOnlyView";
import {
  AlertTriangle,
  CalendarPlus,
  CalendarX,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  TrainingPlanCalendarConflict,
  TrainingPlanCalendarMutationResult,
  TrainingPlanCalendarPreview,
  TrainingPlanCalendarPreviewEntry,
  TrainingPlanDocument,
  WorkoutSport
} from "../../electron/types";
import { activeTrainingPlanCalendarInstall } from "../../electron/trainingPlanDomain";
import type { CorosLinkApi } from "../coroslink-api";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { sportChipStyle, sportTheme } from "./sportTheme";

interface TrainingPlanCalendarDialogProps {
  api: CorosLinkApi;
  plan: TrainingPlanDocument;
  offline: boolean;
  requestedOperation?: "install" | "remove";
  onClose: () => void;
  onComplete: (result: TrainingPlanCalendarMutationResult) => void;
}

function calendarDay(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function startDateProblem(value: string): string | null {
  const date = new Date(`${value}T12:00:00`);
  if (!value || Number.isNaN(date.valueOf())) return "Choose a start date.";
  return null;
}

function fromDateProblem(value: string, today: string): string | null {
  const date = new Date(`${value}T12:00:00`);
  if (!value || Number.isNaN(date.valueOf())) return "Choose the first day to add.";
  if (value < today) return "Workouts can't be added to past dates.";
  return null;
}

function userFacingError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function parseDay(value: string): Date | undefined {
  const digits = value.replaceAll("-", "");
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function displayDay(value: string): string {
  return parseDay(value)?.toLocaleDateString(getLocale(), { weekday: "short", month: "short", day: "numeric" }) ?? value;
}

function displayRange(first: Date, last: Date): string {
  const format = getDateTimeFormat({ month: "short", day: "numeric" });
  if (first.valueOf() === last.valueOf()) return format.format(first);
  // formatRange adds the year once a range crosses one, which the summary cell has no room for.
  return first.getFullYear() === last.getFullYear()
    ? format.formatRange(first, last)
    : `${format.format(first)} – ${format.format(last)}`;
}

interface PreviewRow {
  entry: TrainingPlanCalendarPreviewEntry;
  sport?: WorkoutSport;
  conflict?: TrainingPlanCalendarConflict;
  /** Dated before the first day to add, so it stays off the calendar. */
  skipped?: boolean;
}

interface PreviewWeek {
  number: number;
  range: string;
  rows: PreviewRow[];
}

/** Plan weeks counted from the preview's start date, so Week 1 matches the plan editor. */
function groupPreviewWeeks(preview: TrainingPlanCalendarPreview, plan: TrainingPlanDocument): PreviewWeek[] {
  const start = parseDay(preview.startDate);
  const sports = new Map(plan.entries.map((entry) => [entry.id, entry.workout?.sport]));
  const weeks = new Map<number, PreviewRow[]>();
  const sorted = [
    ...preview.entries.map((entry) => ({ entry, skipped: false })),
    ...(preview.skipped ?? []).map((entry) => ({ entry, skipped: true }))
  ].sort((left, right) => left.entry.happenDay.localeCompare(right.entry.happenDay));
  for (const { entry, skipped } of sorted) {
    const day = parseDay(entry.happenDay);
    const index = start && day ? Math.max(0, Math.floor(Math.round((day.valueOf() - start.valueOf()) / 86_400_000) / 7)) : 0;
    const rows = weeks.get(index) ?? [];
    rows.push({
      entry,
      sport: sports.get(entry.planEntryId) ?? entry.sport,
      conflict: skipped ? undefined : preview.conflicts.find((item) => item.happenDay === entry.happenDay && item.existing.length > 0),
      skipped
    });
    weeks.set(index, rows);
  }
  return [...weeks.entries()].map(([index, rows]) => {
    const weekStart = start ? new Date(start.valueOf() + index * 7 * 86_400_000) : parseDay(rows[0].entry.happenDay);
    const weekEnd = weekStart ? new Date(weekStart.valueOf() + 6 * 86_400_000) : undefined;
    return { number: index + 1, range: weekStart && weekEnd ? displayRange(weekStart, weekEnd) : "", rows };
  });
}

/** Keeps the plan's own Week 1 while any of it is still ahead, so a plan you're partway through keeps its days. */
function initialInstallDate(plan: TrainingPlanDocument): string {
  const start = plan.startDate ? parseDay(plan.startDate) : undefined;
  if (start) {
    const lastDay = new Date(start);
    lastDay.setDate(lastDay.getDate() + Math.max(1, plan.weekCount) * 7 - 1);
    if (calendarDay(lastDay) >= calendarDay()) return calendarDay(start);
  }
  return calendarDay();
}

/** A retried install keeps the first day it was started with, matching the main process. */
function initialFromDate(plan: TrainingPlanDocument, today: string): string {
  const partial = [...(plan.calendarInstalls ?? [])]
    .filter((install) => install.state === "partial" && install.lastOperation === "install")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const value = partial ? parseDay(partial.fromDate ?? partial.startDate) : undefined;
  const day = value ? calendarDay(value) : today;
  return day > today ? day : today;
}

function weekdayName(value: Date): string {
  return formatDate(value, { weekday: "long" });
}

export function TrainingPlanCalendarDialog({ api, plan, offline, requestedOperation, onClose, onComplete }: TrainingPlanCalendarDialogProps) {
  useLanguage();
  const localOnly = useLocalOnlyView();
  const { unitSystem } = useUnitSystem();
  const install = activeTrainingPlanCalendarInstall(plan);
  const operation = requestedOperation ?? (install && !(install.state === "partial" && install.lastOperation === "install") ? "remove" : "install");
  const [startDate, setStartDate] = useState(() => initialInstallDate(plan));
  const [today] = useState(() => calendarDay());
  const [fromDate, setFromDate] = useState(() => initialFromDate(plan, today));
  const [preview, setPreview] = useState<TrainingPlanCalendarPreview | null>(null);
  const [loading, setLoading] = useState(operation === "remove" && !offline);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const startProblem = operation === "install" ? startDateProblem(startDate) : null;
  const fromProblem = operation === "install" ? fromDateProblem(fromDate, today) : null;
  // Re-anchoring Week 1 to another weekday moves every workout; say so before the preview.
  const weekdayShift = useMemo(() => {
    const original = plan.startDate ? parseDay(plan.startDate) : undefined;
    const chosen = startDate ? parseDay(startDate) : undefined;
    if (!original || !chosen || original.getDay() === chosen.getDay()) return null;
    return t("Weekdays shift: the plan’s {{value1}} becomes {{value2}}.", { value1: weekdayName(original), value2: weekdayName(chosen) });
  }, [plan.startDate, startDate, getLocale()]);

  const conflictCount = useMemo(
    () => preview?.conflicts.reduce((sum, conflict) => sum + conflict.existing.length, 0) ?? 0,
    [preview, getLocale()]
  );
  const weeks = useMemo(() => preview ? groupPreviewWeeks(preview, plan) : [], [preview, plan, getLocale()]);
  const dateSpan = useMemo(() => {
    const days = preview?.entries.map((entry) => parseDay(entry.happenDay)).filter((day): day is Date => Boolean(day)).sort((a, b) => a.valueOf() - b.valueOf()) ?? [];
    return days.length ? displayRange(days[0], days[days.length - 1]) : "";
  }, [preview, getLocale()]);
  const workoutCount = preview?.entries.length ?? 0;

  const loadPreview = async () => {
    if (offline || startProblem || fromProblem) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(operation === "install"
        ? await api.previewTrainingPlanCalendar(plan.id, startDate, fromDate)
        : await api.previewTrainingPlanCalendarRemoval(plan.id));
    } catch (cause) {
      setError({ title: "Couldn’t preview calendar", message: userFacingError(cause) });
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
        ? await api.addTrainingPlanToCalendar(preview.previewId, true, unitSystem)
        : await api.removeTrainingPlanFromCalendar(preview.previewId, true);
      onComplete(result);
    } catch (cause) {
      setError({ title: "Calendar update needs attention", message: userFacingError(cause) });
      setPreview(null);
    } finally {
      setMutating(false);
    }
  };

  const confirmLabel = operation === "install"
    ? mutating
      ? t("Adding workouts…")
      : conflictCount
        ? t("Add alongside conflicts")
        : workoutCount === 1 ? t("Add 1 workout") : t("Add {{value1}} workouts", { value1: String(workoutCount) })
    : mutating
      ? t("Removing workouts…")
      : workoutCount === 1 ? t("Remove 1 workout") : t("Remove {{value1}} workouts", { value1: String(workoutCount) });

  return <div className="plan-calendar-backdrop">
    <section className={`plan-calendar-dialog is-${operation}`} role="dialog" aria-modal="true" aria-labelledby="plan-calendar-title" aria-busy={loading || mutating}>
      <header>
        <div className="plan-calendar-heading">
          <span className="plan-calendar-title-icon" aria-hidden="true">{operation === "install" ? <CalendarPlus size={17} /> : <CalendarX size={17} />}</span>
          <div><p className="tl-eyebrow">{localOnly ? t("Calendar") : t("COROS calendar")}</p><h2 id="plan-calendar-title">{operation === "install" ? t("Add plan to calendar") : t("Remove plan from calendar")}</h2><p>{plan.name}</p></div>
        </div>
        <button type="button" className="icon-button" aria-label={t("Close calendar preview")} disabled={mutating} onClick={onClose}><X size={17} /></button>
      </header>

      <div className="plan-calendar-body">
        {offline ? <div className="plan-calendar-offline"><AlertTriangle size={18} /><div><strong>{t("Calendar actions are unavailable offline")}</strong><p>{t("Reconnect to COROS, refresh the Training Library, and try again.")}</p></div></div> : null}

        {!offline && operation === "install" && !preview ? <div className="plan-calendar-start">
          <label><span>{t("Week 1 starts")}</span><input autoFocus type="date" value={startDate} aria-invalid={Boolean(startProblem)} aria-describedby={startProblem ? "plan-calendar-start-error" : weekdayShift ? "plan-calendar-start-hint" : undefined} disabled={loading} onChange={(event) => { setStartDate(event.target.value); setError(null); }} />{startProblem ? <small id="plan-calendar-start-error" className="plan-calendar-date-error" role="alert">{t(startProblem)}</small> : weekdayShift ? <small id="plan-calendar-start-hint" className="plan-calendar-date-hint">{weekdayShift}</small> : null}</label>
          <label><span>{t("Add workouts from")}</span><input type="date" value={fromDate} min={today} aria-invalid={Boolean(fromProblem)} aria-describedby={fromProblem ? "plan-calendar-from-error" : undefined} disabled={loading} onChange={(event) => { setFromDate(event.target.value); setError(null); }} />{fromProblem ? <small id="plan-calendar-from-error" className="plan-calendar-date-error" role="alert">{t(fromProblem)}</small> : null}</label>
          <button type="button" className="primary-button" disabled={loading || Boolean(startProblem) || Boolean(fromProblem)} onClick={() => void loadPreview()}>{loading ? <LoaderCircle className="is-spinning" size={15} /> : <CalendarPlus size={15} />}{loading ? t("Checking calendar...") : t("Preview dates")}</button>
          <p>{t("Week 1 sets the plan’s dates. Workouts before the first day are skipped, so a plan you’re partway through keeps its days. Existing workouts stay.")}</p>
        </div> : null}

        {!offline && loading ? <div className="plan-calendar-loading"><LoaderCircle className="is-spinning" size={22} /><strong>{localOnly ? t("Checking the calendar") : t("Checking the COROS calendar")}</strong><p>{t("Comparing plan dates with current scheduled workouts.")}</p></div> : null}

        {error ? <div className="plan-calendar-error" role="alert"><AlertTriangle size={17} /><div><strong>{error.title}</strong><p>{t(error.message)}</p></div><button type="button" className="ghost-button" disabled={loading || mutating} onClick={() => void loadPreview()}><RefreshCw size={14} /> {t("Try again")}</button></div> : null}

        {preview ? <div className="plan-calendar-preview">
          <div className="plan-calendar-summary">
            <span><strong>{workoutCount}</strong><small>{operation === "install" ? t("workouts to add") : t("future workouts to remove")}</small></span>
            {operation === "install"
              ? <span><strong>{displayDay(preview.startDate)}</strong><small>{t("Week 1 starts")}</small></span>
              : <span><strong>{dateSpan}</strong><small>{t("upcoming dates")}</small></span>}
            {operation === "install"
              ? <span className={conflictCount ? "has-conflict" : ""}><strong>{conflictCount}</strong><small>{t("same-day conflicts")}</small></span>
              : <span><strong>{weeks.length}</strong><small>{t("weeks with workouts")}</small></span>}
          </div>
          <p className="plan-calendar-safety"><ShieldCheck size={15} aria-hidden="true" />{operation === "remove"
            ? t("Only workouts this plan added for today or later are removed. Past, completed and unrelated workouts stay on your calendar.")
            : t("Existing workouts stay. Plan workouts are added next to them.")}</p>
          {preview.blockers.length ? <div className="plan-calendar-blockers"><strong><AlertTriangle size={15} /> {t("Resolve before continuing")}</strong>{preview.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}</div> : null}
          <ol className="plan-calendar-weeks">{weeks.map((week) => {
            const added = week.rows.filter((row) => !row.skipped).length;
            const skipped = week.rows.length - added;
            const addedLabel = added === 1 ? t("1 workout") : t("{{value1}} workouts", { value1: String(added) });
            const skippedLabel = t("{{value1}} skipped", { value1: String(skipped) });
            return <li key={week.number} className="plan-calendar-week">
              <div className="plan-calendar-week-head"><strong>{t("Week {{value1}}", { value1: String(week.number) })}</strong><span>{week.range}</span><small>{!added ? skippedLabel : skipped ? `${addedLabel} · ${skippedLabel}` : addedLabel}</small></div>
              <ul>{week.rows.map(({ entry, sport, conflict, skipped: isSkipped }) => {
                const SportIcon = sportTheme(sport).icon;
                return <li key={`${entry.planEntryId}:${entry.happenDay}`} className={isSkipped ? "is-skipped" : conflict ? "has-conflict" : undefined} style={sportChipStyle(sport)}>
                  <time dateTime={entry.happenDay}>{displayDay(entry.happenDay)}</time>
                  <SportIcon size={14} aria-hidden="true" />
                  <strong title={entry.name}>{entry.name}</strong>
                  {isSkipped ? <small>{t("Skipped")}</small> : conflict ? <small><AlertTriangle size={12} aria-hidden="true" />{t("Same day as {{value1}}", { value1: conflict.existing.map((item) => item.name).join(", ") })}</small> : null}
                </li>;
              })}</ul>
            </li>;
          })}</ol>
        </div> : null}
      </div>

      <footer>
        {mutating ? <p className="plan-calendar-footer-hint" role="status"><LoaderCircle className="is-spinning" size={13} aria-hidden="true" />{t("One workout at a time. Keep this window open.")}</p> : null}
        <button type="button" className="ghost-button" disabled={mutating} onClick={onClose}>{t("Cancel")}</button>
        {preview ? <button type="button" className={operation === "remove" ? "primary-button danger" : "primary-button"} aria-busy={mutating} disabled={mutating || preview.blockers.length > 0} onClick={() => void confirm()}>{mutating ? <LoaderCircle className="is-spinning" size={15} /> : operation === "install" ? <CalendarPlus size={15} /> : <CalendarX size={15} />}{confirmLabel}</button> : null}
      </footer>
    </section>
  </div>;
}
