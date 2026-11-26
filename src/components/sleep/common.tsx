"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, OriginBadge } from "@/components/ui";
import type { Origin } from "@/data/core";
import type { SleepStage } from "@/data/health";
import { msg, t } from "@/lib/i18n";
import { hm, qualityHue, type TonightPlan } from "@/lib/sleep";

export const STAGE_VAR: Record<SleepStage, string> = {
  deep: "var(--sl-deep)", light: "var(--sl-light)", rem: "var(--sl-rem)", awake: "var(--sl-awake)",
};
export const STAGE_LABEL: Record<SleepStage, string> = { deep: msg("Deep"), light: msg("Light"), rem: "REM", awake: msg("Awake") };
export const BAND_VAR = ["var(--sl-b0)", "var(--sl-b1)", "var(--sl-b2)", "var(--sl-b3)"] as const;

/** Fill colour for a score: violet, gold or coral. */
export const scoreVar = (score: number) => `var(--h-${qualityHue(score)})`;
/** Soft glow in the score's own colour (dials, picked bars). */
export const scoreGlow = (score: number, strength = 55) => `color-mix(in srgb, var(--h-${qualityHue(score)}) ${strength}%, transparent)`;
/** Text colour for a score. */
export const scoreInk = (score: number) => `var(--h-${qualityHue(score)}-ink)`;

export type RangeTab = "night" | "week" | "month" | "year";
const TABS: { tab: RangeTab; label: string; href: string }[] = [
  { tab: "night", label: msg("Day"), href: "/health/sleep" },
  { tab: "week", label: msg("Week"), href: "/health/sleep/week" },
  { tab: "month", label: msg("Month"), href: "/health/sleep/month" },
  { tab: "year", label: msg("Year"), href: "/health/sleep/year" },
];

function Chevron({ next }: { next?: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d={next ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} />
    </svg>
  );
}

export function IconStep({ next, label, disabled, onClick }: { next?: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button className="sl-icon-btn" aria-label={label} disabled={disabled} onClick={onClick}><Chevron next={next} /></Button>
  );
}

/** Health / Sleep, the Day · Week · Month · Year links, and the stepper for the night or period on show. */
export function SleepHead({ tab, origin, title, back, forward, latest }: {
  tab: RangeTab; origin: Origin; title: string;
  back: { label: string; disabled: boolean; go: () => void };
  forward: { label: string; disabled: boolean; go: () => void };
  latest: { label: string; disabled: boolean; go: () => void };
}) {
  return (
    <div className="page-head">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
        <div className="sl-crumb"><Link href="/health">{t("Health")}</Link><span aria-hidden="true" className="muted">/</span><h1>{t("Sleep")}</h1></div>
        <OriginBadge origin={origin} />
      </div>
      <nav aria-label={t("Sleep range")} className="seg">
        {TABS.map((x) => <Link key={x.tab} href={x.href} aria-current={x.tab === tab ? "page" : undefined}>{t(x.label)}</Link>)}
      </nav>
      <div className="sl-step">
        <IconStep label={back.label} disabled={back.disabled} onClick={back.go} />
        <span className="sl-step-title" aria-live="polite">{title}</span>
        <IconStep next label={forward.label} disabled={forward.disabled} onClick={forward.go} />
        <Button disabled={latest.disabled} onClick={latest.go}>{latest.label}</Button>
      </div>
    </div>
  );
}

/** A chip saying how a number compares: green when better, coral when worse, grey when neither. */
export function DeltaChip({ good, children }: { good: boolean | null; children: ReactNode }) {
  return <span className={`sl-chip ${good == null ? "sl-chip-flat" : good ? "sl-chip-good" : "sl-chip-bad"}`}>{children}</span>;
}

export function SleepLoading({ label, state }: { label: string; state: { status: string; error?: Error } }) {
  return (
    <>
      <div className="page-head"><div className="sl-crumb"><Link href="/health">{t("Health")}</Link><span aria-hidden="true" className="muted">/</span><h1>{t("Sleep")}</h1></div></div>
      {state.status === "error"
        ? <div className="notice" role="alert">{t("Sleep could not be loaded.")} {state.error?.message}</div>
        : <div className="skeleton" aria-busy="true" aria-label={t("Loading {what}", { what: label })} style={{ minHeight: 360 }} />}
    </>
  );
}

export const PAGE_NOTE = msg("A night belongs to the day it ended. Scores, lengths and stages are COROS’s. Excellent, Good, Fair and Low are C-LINK’s words for scores of 85+, 70–84, 55–69 and below.");

/** Tomorrow's workout and the sleep-debt top-up, as the phone shows them under tonight's bedtime. */
export function TonightChips({ plan }: { plan: TonightPlan }) {
  if (!plan.workout && !plan.catchUp) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {plan.workout ? <span className="sl-chip sl-chip-flat">{t("Tomorrow: {workout}", { workout: plan.workout })}</span> : null}
      {plan.catchUp > 0 ? <span className="sl-chip sl-chip-flat">{t("+{time} for sleep debt", { time: hm(plan.catchUp) })}</span> : null}
    </div>
  );
}

export const tonightSource = (plan: { fromSchedule: boolean }) =>
  plan.fromSchedule ? t("Wake time from your watch's sleep schedule; 15 minutes allowed to fall asleep.")
    : t("Wake time from your usual mornings; 15 minutes allowed to fall asleep.");
