"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { addPlanToCalendar, removePlanFromCalendar } from "@/data/plans";
import { shortDay } from "@/lib/calendar";
import { installStanding, planCalendarPreview, upcomingTrainingPlanCalendarWorkoutCount, type InstallProgress, type PlanView, type TrainingPlanDocument } from "@/lib/plan";
import { t } from "@/lib/i18n";

export function Icon({ d, size = 18, width = 1.9 }: { d: string; size?: number; width?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5a4 4 0 0 1 7 2.5c0 5.5-7 10-7 10z",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  close: "M6 6l12 12M18 6L6 18",
  dots: "M6 12h.01M12 12h.01M18 12h.01",
  warn: "M12 8v5M12 16.5v.5",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
};

/** One bar per week, coloured by the phase the week is in. */
export function PlanBars({ bars, label, tall }: { bars: PlanView["bars"]; label: string; tall?: boolean }) {
  return (
    <div role="img" aria-label={label} className={tall ? "pl-bars pe-over" : "pl-bars"}>
      {bars.map((bar, i) => <span key={i} data-phase={bar.phase ?? ""} style={{ height: `${Math.max(4, Math.round(bar.share * 100))}%` }} />)}
    </div>
  );
}

/**
 * The plan editor's overview, as the canvas draws it: one flat bar per week in its phase's colour, the week
 * numbers under them and the peak week's load beside its number. Clicking a week jumps to its row.
 */
export function PlanOverviewChart({ bars, label, peak, onWeek }: { bars: PlanView["bars"]; label: string; peak: number; onWeek?: (weekIndex: number) => void }) {
  const many = bars.length > 12;
  return (
    <div className="pe-chart">
      <div role="img" aria-label={label} className="pe-bars">
        {bars.map((bar, i) => (
          <button key={i} type="button" tabIndex={-1} data-phase={bar.phase ?? "none"} title={t("Week {n}: {load}", { n: i + 1, load: Math.round(bar.value) })} onClick={() => onWeek?.(i)}
            style={{ height: `${Math.max(4, Math.round(bar.share * 100))}%`, animationDelay: `${i * 30}ms` }} />
        ))}
      </div>
      <div aria-hidden="true" className="pe-weeks">
        {bars.map((bar, i) => <span key={i} data-peak={i === peak || undefined}>{many ? i + 1 : t("W{n}", { n: i + 1 })}{i === peak && !many ? ` · ${Math.round(bar.value)}` : ""}</span>)}
      </div>
    </div>
  );
}

/** The phases under the bars, each as wide as the weeks it covers. */
export function PhaseRibbon({ ribbon }: { ribbon: PlanView["ribbon"] }) {
  if (!ribbon.length) return null;
  return (
    <div className="pl-ribbon">
      {/* With many phases, a one-week band (a recovery week) keeps its colour but not a label it has no room for. */}
      {ribbon.map((phase) => <span key={phase.id} data-phase={phase.kind} title={t(phase.label)} style={{ flex: `${phase.weeks} 1 0` }}>{phase.weeks > 1 || ribbon.length <= 6 ? t(phase.label) : "\u00a0"}</span>)}
    </div>
  );
}

/** A small dialog over the page. Escape closes it unless it is busy; focus starts on its first button. */
export function PlanDialog({ title, children, actions, onClose, busy }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; busy?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[data-first]")?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="pl-scrim">
      <div ref={box} className="pl-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>{actions}</div>
      </div>
    </div>
  );
}


/**
 * "Add to calendar" and "Remove from calendar" for a saved plan: what would be written, then the writes one
 * workout at a time with their progress, and an honest account when one is refused.
 */
export function PlanCalendarDialog({ plan, operation, today, toCoros, onClose, onChanged }: {
  plan: TrainingPlanDocument; operation: "install" | "remove"; today: string; toCoros: boolean; onClose: () => void;
  /** Called with the plan as it now stands, after every run (also one that stopped part-way). */
  onChanged: (plan: TrainingPlanDocument) => void;
}) {
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ plan: TrainingPlanDocument; problem: string | null } | null>(null);
  const preview = planCalendarPreview(plan, today), standing = installStanding(plan, today);
  const upcoming = upcomingTrainingPlanCalendarWorkoutCount(plan, today);
  const left = operation === "install" ? preview.targets.length - (standing.retrying ? standing.added : 0) : upcoming;

  const run = () => {
    setBusy(true);
    (operation === "install" ? addPlanToCalendar(plan.id, setProgress) : removePlanFromCalendar(plan.id, setProgress)).then(
      (result) => { setBusy(false); onChanged(result.plan); if (result.problem) setOutcome(result); else onClose(); },
      (e: unknown) => { setBusy(false); setOutcome({ plan, problem: e instanceof Error ? e.message : t("It didn’t work.") }); },
    );
  };

  const title = operation === "install" ? (standing.retrying ? t("Retry calendar install") : t("Add to calendar")) : standing.retrying ? t("Remove partial install") : t("Remove from calendar");
  if (outcome) {
    const after = installStanding(outcome.plan, today);
    return (
      <PlanDialog title={operation === "install" ? t("Calendar install incomplete") : t("Not everything was removed")} onClose={onClose}
        actions={<Button data-first onClick={onClose}>{t("Close")}</Button>}>
        <p role="alert">{operation === "install" ? t("{added} of {total} workouts added.", { added: after.added, total: after.total }) : t("{n} of this plan’s workouts are still on the calendar.", { n: upcomingTrainingPlanCalendarWorkoutCount(outcome.plan, today) })}</p>
        <p className="pl-bad" style={{ fontWeight: 600 }}>{outcome.problem}</p>
      </PlanDialog>
    );
  }
  return (
    <PlanDialog title={title} onClose={onClose} busy={busy}
      actions={<>
        <Button data-first disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
        <Button variant="primary" disabled={busy || left <= 0 || (operation === "install" && Boolean(preview.blocker))} onClick={run}>
          {busy ? (operation === "install" ? t("Adding…") : t("Removing…")) : operation === "install" ? (left === 1 ? t("Add 1 workout") : t("Add {n} workouts", { n: left })) : left === 1 ? t("Remove 1 workout") : t("Remove {n} workouts", { n: left })}
        </Button>
      </>}>
      {operation === "install" ? (
        preview.blocker ? <p role="alert">{preview.blocker}</p> : (
          <>
            <p>{(() => {
              const vars = { name: plan.name, n: left, from: shortDay(preview.targets[0].day), to: shortDay(preview.targets[preview.targets.length - 1].day) };
              if (toCoros) return left === 1 ? t("“{name}” goes on your COROS calendar: 1 workout on {from}.", vars) : t("“{name}” goes on your COROS calendar, one workout at a time: {n} workouts from {from} to {to}.", vars);
              return left === 1 ? t("“{name}” goes on this computer’s calendar: 1 workout on {from}.", vars) : t("“{name}” goes on this computer’s calendar, one workout at a time: {n} workouts from {from} to {to}.", vars);
            })()}</p>
            {standing.retrying ? <p>{t("{added} of {total} are on the calendar already.", { added: standing.added, total: standing.total })}</p> : null}
            {preview.skipped.length ? <p>{preview.skipped.length === 1 ? t("1 workout on a day that has passed stays off the calendar.") : t("{n} workouts on days that have passed stay off the calendar.", { n: preview.skipped.length })}</p> : null}
          </>
        )
      ) : <p>{left === 1 ? t("1 workout of “{name}” from today on comes off the calendar. Past days stay.", { name: plan.name }) : t("{n} workouts of “{name}” from today on come off the calendar. Past days stay.", { n: left, name: plan.name })}</p>}
      {busy && progress ? (
        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="pl-meter"><span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
          <span className="muted" style={{ fontSize: 13 }}>{t("{done} of {total}", { done: progress.done, total: progress.total })}{progress.name ? ` · ${progress.name}` : ""}</span>
        </div>
      ) : null}
    </PlanDialog>
  );
}
