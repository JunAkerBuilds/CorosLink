"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Button, Card, LinkButton } from "@/components/ui";
import { CoachError } from "@/data/coach";
import { NotWiredError, useLoaded } from "@/data/core";
import { generateTrainingPlan, loadPlanGenerator, type GeneratorData } from "@/data/plans";
import { DAY_NAMES, planGoalPreset } from "@/lib/plan";
import {
  CONSTRAINTS_MAX, DIFFICULTY_OPTIONS, EXAMPLE_GOALS, GENERATOR_SPORTS, GOAL_MAX, MAX_GENERATED_WEEKS, maxSessions, newPlanRequest, parseSessionLimit, planSnapshot, requestProblem,
  type PlanGenerationRequest,
} from "@/lib/planGenerate";
import "../plans.css";
import { PlanForming } from "./PlanForming";
import { t } from "@/lib/i18n";

export default function GeneratePlanPage() {
  return (
    <Suspense fallback={<LoadingPage label={t("Generate a training plan")} />}>
      <GenerateScreen />
    </Suspense>
  );
}

function GenerateScreen() {
  const params = useSearchParams();
  const state = useLoaded(loadPlanGenerator);
  if (state.status === "loading") return <LoadingPage label={t("Generate a training plan")} />;
  if (state.status === "error") return <LoadError error={state.error} onRetry={state.reload}><LinkButton href="/calendar/plans">{t("Back to Plans")}</LinkButton></LoadError>;
  const preset = params.get("preset");
  return <Generate key={preset ?? ""} data={state.data} preset={preset} />;
}

function Stepper({ label, fewer, more, value, min, max, disabled, onChange }: { label: string; fewer: string; more: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className="pl-label" role="group" aria-label={label}>{label}
      <span className="pl-stepper">
        <Button aria-label={fewer} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</Button>
        <output aria-live="polite">{value}</output>
        <Button aria-label={more} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</Button>
      </span>
    </div>
  );
}

function Generate({ data, preset }: { data: GeneratorData; preset: string | null }) {
  const router = useRouter();
  const { today, signedIn, access } = data;
  const [request, setRequest] = useState<PlanGenerationRequest>(() => newPlanRequest(today, planGoalPreset(preset)));
  const [limit, setLimit] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; coach: boolean } | null>(null);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const generating = stage !== null;
  const cap = parseSessionLimit(limit);
  const asked: PlanGenerationRequest = useMemo(() => ({ ...request, maxSessionMinutes: cap ?? undefined }), [request, cap]);
  const hint = cap === null ? t("A session limit goes from 10 to 600 minutes.") : requestProblem(asked, today);
  const snapshot = planSnapshot(asked);
  const noKey = signedIn && access?.key === "none";
  const set = (patch: Partial<PlanGenerationRequest>) => setRequest((r) => ({ ...r, ...patch }));
  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const generate = () => {
    if (hint || generating) return;
    const controller = new AbortController();
    stop.current = controller;
    setFailure(null);
    setStage(t("Asking Coach"));
    generateTrainingPlan(asked, { signal: controller.signal, onStage: setStage }).then(
      () => router.push("/calendar/plans/edit?draft=1"),
      (e: unknown) => {
        setStage(null);
        if (controller.signal.aborted) return;
        const coach = e instanceof CoachError && (e.code === "no_key" || e.code === "daily_limit");
        setFailure({ text: e instanceof Error ? e.message : t("Coach couldn’t make the plan."), coach: coach || e instanceof NotWiredError });
      },
    );
  };
  const cancel = () => { stop.current?.abort(); setStage(null); };

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <nav aria-label={t("Breadcrumb")} className="pl-crumb">
            <Link href="/calendar/plans">{t("Workout Library")}</Link><span aria-hidden="true">/</span>
            <Link href="/calendar/plans">{t("Plans")}</Link><span aria-hidden="true">/</span>
            <span aria-current="page">{t("Generate")}</span>
          </nav>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Training Coach")}</span>
          <h1 className="pl-h1">{t("Generate a training plan")}</h1>
        </div>
        <div className="actions">
          {generating ? <Button onClick={cancel}>{t("Cancel")}</Button> : <LinkButton href="/calendar/plans">{t("Cancel")}</LinkButton>}
          <Button variant="primary" disabled={Boolean(hint) || generating || noKey} onClick={generate}>{generating ? t("Generating…") : t("Generate plan")}</Button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: "2 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Card aria-label={t("Plan request")} className="pl-card" style={{ gap: 20, ...(generating ? { opacity: 0.55, pointerEvents: "none" } : {}) }}>
            <label className="pl-label"><span>{t("What are you training for?")}</span>
              <input type="text" className="field pl-goal" value={request.goal} maxLength={GOAL_MAX} disabled={generating} placeholder={t("Example: Finish my first trail 50K comfortably")}
                onChange={(e) => set({ goal: e.target.value })} />
            </label>
            {!request.goal.trim() ? (
              <div className="pl-chips" role="group" aria-label={t("Example goals")} style={{ marginTop: -10 }}>
                {EXAMPLE_GOALS.map((example) => <button key={example} type="button" className="chip" disabled={generating} onClick={() => set({ goal: t(example) })}>{t(example)}</button>)}
              </div>
            ) : null}
            <div className="pl-label" role="group" aria-label={t("Sports")} style={{ gap: 8 }}>{t("Sports")}
              <div className="pl-chips">
                {GENERATOR_SPORTS.map((s) => (
                  <button key={s.sport} type="button" className="chip" aria-pressed={request.sports.includes(s.sport)} disabled={generating} onClick={() => set({ sports: toggle(request.sports, s.sport) })}>{t(s.label)}</button>
                ))}
              </div>
            </div>
            <div className="pl-label" role="group" aria-label={t("Difficulty")} style={{ gap: 8 }}>{t("Difficulty")}
              <div className="pl-diffs">
                {DIFFICULTY_OPTIONS.map((o) => (
                  <button key={o.value} type="button" className="pl-diff" aria-pressed={request.difficulty === o.value} disabled={generating} onClick={() => set({ difficulty: o.value })}>{t(o.label)}<span>{t(o.hint)}</span></button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 28 }}>
              <Stepper label={t("Weeks")} fewer={t("Fewer weeks")} more={t("More weeks")} value={request.weeks} min={1} max={MAX_GENERATED_WEEKS} disabled={generating} onChange={(weeks) => set({ weeks })} />
              <Stepper label={t("Sessions / week")} fewer={t("Fewer sessions a week")} more={t("More sessions a week")} value={request.sessionsPerWeek} min={1} max={maxSessions(request)} disabled={generating} onChange={(sessionsPerWeek) => set({ sessionsPerWeek })} />
              <label className="pl-label"><span>{t("Plan start date")}</span>
                <input type="date" className="field" value={request.startDate} min={today} disabled={generating} onChange={(e) => set({ startDate: e.target.value })} style={{ height: 40, padding: "0 12px" }} />
              </label>
            </div>
            <div className="pl-label" role="group" aria-label={t("Available days")} style={{ gap: 8 }}>{t("Available days")}
              <div className="pl-chips">
                {DAY_NAMES.map((day, index) => (
                  <button key={day} type="button" className="chip" aria-pressed={request.availableDayIndexes.includes(index)} disabled={generating}
                    onClick={() => set({ availableDayIndexes: toggle(request.availableDayIndexes, index) })}>{t(day)}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 28 }}>
              <label className="pl-label"><span>{t("Session limit")} <span>{t("optional")}</span></span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                  <input type="number" className="field" min={10} max={600} value={limit} placeholder={t("No limit")} disabled={generating} aria-invalid={cap === null ? true : undefined}
                    onChange={(e) => setLimit(e.target.value)} style={{ width: 96, height: 40, padding: "0 12px", textAlign: "right" }} />min
                </span>
              </label>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <label className="pl-label"><span>{t("Constraints")} <span>{t("optional")}</span></span>
                  <textarea className="field" rows={2} maxLength={CONSTRAINTS_MAX} value={request.constraints ?? ""} disabled={generating} placeholder={t("Injuries, equipment, travel, preferred long day…")}
                    onChange={(e) => set({ constraints: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, lineHeight: "20px" }} />
                </label>
              </div>
            </div>
          </Card>
          {hint && !generating ? <p className="pl-help" role="status">{hint}</p> : null}
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <Card aria-label={t("Plan snapshot")} className="pl-card" style={{ gap: 8 }}>
            <h2 className="h2">{t("Plan snapshot")}</h2>
            <div className="pl-snap">
              <div><span>{t("Sports")}</span><span>{snapshot.sports}</span></div>
              <div><span>{t("Structure")}</span><span>{snapshot.structure}</span></div>
              <div><span>{t("Total sessions")}</span><span>{snapshot.total}</span></div>
              <div><span>{t("Dates")}</span><span>{snapshot.dates}</span></div>
              <div><span>{t("Days")}</span><span>{snapshot.days}</span></div>
              {snapshot.cap ? <div><span>{t("Session cap")}</span><span>{snapshot.cap}</span></div> : null}
            </div>
          </Card>
          {generating ? (
            <Card aria-label={t("Coach is writing your plan")} className="pl-card" aria-live="polite" style={{ gap: 16 }}>
              <PlanForming request={asked} stage={stage ?? t("Asking Coach")} onCancel={cancel} />
            </Card>
          ) : failure ? (
            <Card aria-label={t("Draft needs another pass")} className="pl-card">
              <h2 className="h2">{t("Draft needs another pass")}</h2>
              <p className="pl-help pl-bad" role="alert" style={{ fontWeight: 600 }}>{failure.text}</p>
              <div className="actions">
                <Button disabled={Boolean(hint)} onClick={generate}>{t("Retry")}</Button>
                <LinkButton href={failure.coach ? (signedIn ? "/coach" : "/connect") : "/coach"}>{signedIn ? t("Open Coach") : t("Sign in")}</LinkButton>
              </div>
            </Card>
          ) : (
            <Card aria-label={t("Review before saving")} className="pl-card">
              <h2 className="h2">{t("Review before saving")}</h2>
              <p className="pl-help">{t("The result opens as an unsaved Coach plan. You can edit every workout before saving or adding it to your calendar.")}</p>
              {!signedIn ? <p className="pl-help pl-warn" style={{ fontWeight: 600 }}>{t("Coach writes the plan from your own data, which isn’t open yet. Try again in a moment.")}</p> : null}
              {noKey ? <p className="pl-help pl-warn" style={{ fontWeight: 600 }}>{t("Coach needs an AI before it can write a plan.")} <Link href="/coach/settings">{t("Pick one in Coach settings")}</Link></p> : null}
              {access?.key === "mock" ? <p className="pl-help pl-warn" style={{ fontWeight: 600 }}>{t("Development: the scripted stand-in answers, not an AI. Its plan is the same four workouts whatever you ask.")}</p> : null}
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
