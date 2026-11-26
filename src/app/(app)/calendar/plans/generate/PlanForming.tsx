"use client";
// While Coach writes a plan: the plan's own calendar (weeks × days) fills in, workout by workout in each sport's
// colour, and Coach's steps build up underneath as they arrive. All CSS; still under prefers-reduced-motion.
import Image from "next/image";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import type { PlanGenerationRequest } from "@/lib/planGenerate";
import { locale, t } from "@/lib/i18n";

type Sport = PlanGenerationRequest["sports"][number];

const MAX_ROWS = 16;

const SPORT_TONE: Partial<Record<Sport, string>> = {
  run: "var(--sport-run)", trailRun: "var(--sport-run)", bike: "var(--sport-ride)", swim: "var(--sport-swim)",
  strength: "var(--sport-strength)", hyrox: "var(--sport-strength)",
};

/** Which days of the week get a workout: the asked number, spread evenly over the available days. */
export function sessionDays(available: number[], perWeek: number): number[] {
  const days = [...available].sort((a, b) => a - b);
  if (perWeek >= days.length) return days;
  return Array.from({ length: perWeek }, (_, i) => days[Math.floor((i * days.length) / perWeek)]);
}

/**
 * The canvas board "Generate: Coach writing the plan": the running mascot over the plan's own calendar filling in,
 * Coach's steps ticking off, the time so far and Cancel. One sport: the first and third sessions of a week are the
 * quality days (blue), the rest easy (mint); several sports: each in its own colour.
 */
export function PlanForming({ request, stage, onCancel }: { request: PlanGenerationRequest; stage: string; onCancel: () => void }) {
  const [steps, setSteps] = useState<string[]>([stage]);
  const [secs, setSecs] = useState(0);
  // A new stage joins the list as it arrives (set during render, React's pattern for state that follows a prop).
  if (steps[steps.length - 1] !== stage) setSteps([...steps.filter((x) => x !== stage), stage]);
  useEffect(() => { const tick = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(tick); }, []);

  const rows = Math.min(MAX_ROWS, Math.max(1, request.weeks));
  const on = new Set(sessionDays(request.availableDayIndexes, request.sessionsPerWeek));
  const sports = request.sports.length ? request.sports : (["run"] as Sport[]);
  const total = rows * on.size;
  // One-letter weekday heads, Monday first, in the app's language (2024-01-01 was a Monday).
  const narrow = new Intl.DateTimeFormat(locale("en-GB"), { weekday: "narrow", timeZone: "UTC" });
  const DAYS = Array.from({ length: 7 }, (_, i) => narrow.format(Date.UTC(2024, 0, 1 + i)));
  let n = 0;

  return (
    <div className="pf">
      <div className="pf-head-row">
        <span aria-hidden="true" className="pc-run"><Image src="/img/coach-run.webp" alt="" width={896} height={56} unoptimized /></span>
        <span className="pc-words"><h2 className="h2">{t("Coach is writing your plan")}</h2><span>{request.weeks === 1 ? t("1 week · {n} a week · from your recent training", { n: request.sessionsPerWeek }) : t("{weeks} weeks · {n} a week · from your recent training", { weeks: request.weeks, n: request.sessionsPerWeek })}</span></span>
      </div>
      <div className="pf-cal" style={{ ["--pf-rows" as string]: rows }} aria-hidden="true">
        {DAYS.map((d, i) => <span key={`h${i}`} className="pf-head">{d}</span>)}
        {Array.from({ length: rows }, (_, w) => DAYS.map((_, d) => {
          if (!on.has(d)) return <span key={`${w}-${d}`} className="pf-cell" />;
          const i = n++;
          const slot = [...on].indexOf(d);
          const tone = sports.length > 1 ? SPORT_TONE[sports[i % sports.length]] ?? "var(--sport-other)"
            : (slot === 0 || (slot === 2 && on.size >= 4)) ? "var(--h-blue)" : SPORT_TONE[sports[0]] ?? "var(--sport-other)";
          return <span key={`${w}-${d}`} className="pf-cell pf-slot" style={{ ["--pf-i" as string]: i / Math.max(1, total), ["--pf-tone" as string]: tone }} />;
        }))}
        <span className="pf-sweep" />
      </div>
      <ol className="pf-steps">
        {steps.map((s, i) => {
          const now = i === steps.length - 1;
          return (
            <li key={s} data-now={now || undefined}>
              <span className="pf-mark">{now ? <span className="pf-dot" /> : <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
              <span>{s}{now ? <span className="pf-ell" /> : null}</span>
            </li>
          );
        })}
      </ol>
      <div className="pf-foot">
        <span className="pf-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · {t("usually under a minute")}</span>
        <Button style={{ height: 32 }} onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </div>
  );
}
