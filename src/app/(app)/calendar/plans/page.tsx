"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LibraryTabs } from "@/components/training/LibraryTabs";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Icon, ICONS, PhaseRibbon, PlanBars, PlanCalendarDialog, PlanDialog } from "@/components/training/PlanParts";
import { Button, Card, CountUp, LinkButton, OriginBadge } from "@/components/ui";
import { useLoaded, type Origin } from "@/data/core";
import { deletePlan, duplicatePlan, loadPlans, setPlanFavorite, type PlansData } from "@/data/plans";
import { thousands } from "@/lib/format";
import {
  installStanding, PLAN_GOAL_PRESETS, PLAN_SOURCE_LABELS, planGoalPreset, planScopes, planStatus, planView, summarizeTrainingPlan, upcomingTrainingPlanCalendarWorkoutCount, visiblePlans,
  type PlanScope, type TrainingPlanDocument,
} from "@/lib/plan";
import "./plans.css";
import { t } from "@/lib/i18n";

export default function PlansPage() {
  const state = useLoaded(loadPlans);
  if (state.status === "loading") return <LoadingPage label={t("Plans")} />;
  if (state.status === "error") return <LoadError error={state.error} onRetry={state.reload}><LinkButton href="/calendar">{t("Back to the calendar")}</LinkButton></LoadError>;
  return <Plans data={state.data} origin={state.origin} reload={state.reload} />;
}

type Pending = { kind: "install" | "remove" | "delete"; plan: TrainingPlanDocument };

function Plans({ data, origin, reload }: { data: PlansData; origin: Origin; reload: () => void }) {
  const { plans, today, toCoros, pacing, sample } = data;
  const [goal, setGoal] = useState<string | null>(null);
  const [scope, setScope] = useState<PlanScope>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scopes = useMemo(() => planScopes(plans, today), [plans, today]);
  const shownScope = scopes.some((s) => s.id === scope) ? scope : "all";
  const visible = useMemo(() => visiblePlans(plans, shownScope, query, today), [plans, shownScope, query, today]);
  const preset = planGoalPreset(goal);

  /** Runs a change to the saved plans, then reads them again. */
  const act = (work: () => Promise<unknown>) => {
    setProblem(null);
    work().then(reload, (e: unknown) => { setProblem(e instanceof Error ? e.message : t("That didn’t work.")); reload(); });
  };

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <OriginBadge origin={origin} />
          <h1 className="pl-h1">{t("Workout Library")}</h1>
          <LibraryTabs current="plans" />
        </div>
        <div className="actions">
          <LinkButton href="/calendar/plans/edit">{t("Blank plan")}</LinkButton>
          <LinkButton variant="primary" href="/calendar/plans/generate">{t("Generate plan")}</LinkButton>
        </div>
      </div>
      {problem ? <p role="alert" className="pl-bad" style={{ margin: 0, fontWeight: 600 }}>{problem}</p> : null}

      <Card aria-label={t("Build me a plan")} className="pl-card">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <Image src="/img/coach-write.webp" alt="" width={60} height={60} style={{ display: "block", objectFit: "contain", flex: "none" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <h2 className="h2">{t("Build me a plan")}</h2>
              <div className="pl-chips" role="group" aria-label={t("Goal")}>
                {PLAN_GOAL_PRESETS.map((p) => (
                  <button key={p.id} type="button" className="chip" aria-pressed={goal === p.id} onClick={() => setGoal(goal === p.id ? null : p.id)}>{t(p.label)}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            {preset ? <span className="muted" style={{ fontSize: 13 }}>{t("{goal} · {weeks} weeks · {n} sessions a week", { goal: t(preset.goal), weeks: preset.weeks, n: preset.sessionsPerWeek })}</span> : null}
            <LinkButton variant="primary" href={preset ? `/calendar/plans/generate?preset=${preset.id}` : "/calendar/plans/generate"}>
              {preset ? t("Generate {weeks}-week plan", { weeks: preset.weeks }) : t("Generate plan")}
            </LinkButton>
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="pl-chips" role="group" aria-label={t("Show")}>
          {scopes.map((s) => <button key={s.id} type="button" className="chip" aria-pressed={shownScope === s.id} onClick={() => setScope(s.id)}>{t(s.label)}</button>)}
        </div>
        <input type="search" className="field" aria-label={t("Search plans")} placeholder={t("Search plans")} value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ width: 220, maxWidth: "100%", height: 34, padding: "0 12px", fontSize: 13, fontWeight: 500 }} />
      </div>

      {visible.length > 0 ? (
        <div className="pl-grid">
          {visible.map((plan) => (
            <PlanTile key={plan.id} plan={plan} today={today} pacing={pacing} sample={sample} busy={busy}
              onFavorite={() => act(() => setPlanFavorite(plan.id, !plan.favorite))}
              onDuplicate={() => act(() => duplicatePlan(plan))}
              onCalendar={(kind) => setPending({ kind, plan })}
              onDelete={() => setPending({ kind: "delete", plan })} />
          ))}
        </div>
      ) : (
        <Card className="pl-card pl-empty">
          <Image src="/img/coach-search.webp" alt="" width={88} height={88} style={{ display: "block", objectFit: "contain" }} />
          <h2 className="h2">{plans.length === 0 ? t("No plans yet") : t("No plan matches")}</h2>
        </Card>
      )}

      {pending && pending.kind !== "delete" ? (
        <PlanCalendarDialog plan={pending.plan} operation={pending.kind} today={today} toCoros={toCoros} onClose={() => setPending(null)} onChanged={reload} />
      ) : null}
      {pending?.kind === "delete" ? (() => {
        const upcoming = upcomingTrainingPlanCalendarWorkoutCount(pending.plan, today);
        return (
          <PlanDialog title={t("Delete “{name}”?", { name: pending.plan.name })} onClose={() => setPending(null)} busy={busy}
            actions={<>
              <Button data-first disabled={busy} onClick={() => setPending(null)}>{t("Keep plan")}</Button>
              <Button variant="ink" disabled={busy} onClick={() => {
                setBusy(true); setProblem(null);
                deletePlan(pending.plan.id).then(() => { setBusy(false); setPending(null); reload(); },
                  (e: unknown) => { setBusy(false); setPending(null); setProblem(e instanceof Error ? e.message : t("That didn’t work.")); reload(); });
              }}>{busy ? t("Deleting…") : t("Delete plan")}</Button>
            </>}>
            <p>{upcoming > 0
              ? (upcoming === 1 ? t("This deletes the plan from this computer and removes its 1 upcoming workout from the calendar first. Past days stay.") : t("This deletes the plan from this computer and removes its {n} upcoming workouts from the calendar first. Past days stay.", { n: upcoming }))
              : t("This deletes the plan from this computer. It can’t be undone.")}</p>
          </PlanDialog>
        );
      })() : null}
    </main>
  );
}

function PlanTile({ plan, today, pacing, sample, busy, onFavorite, onDuplicate, onCalendar, onDelete }: {
  plan: TrainingPlanDocument; today: string; pacing: PlansData["pacing"]; sample: boolean; busy: boolean;
  onFavorite: () => void; onDuplicate: () => void; onCalendar: (kind: "install" | "remove") => void; onDelete: () => void;
}) {
  const view = useMemo(() => planView(plan, summarizeTrainingPlan(plan, pacing)), [plan, pacing]);
  const status = planStatus(plan, today), standing = installStanding(plan, today);
  const sampleTitle = sample ? t("A sample plan: duplicate it to get your own") : undefined;
  const edit = `/calendar/plans/edit?id=${encodeURIComponent(plan.id)}`;
  return (
    <Card aria-label={plan.name} className="pl-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <Link className="pl-name" href={edit}>{plan.name || t("Untitled plan")}</Link>
          {view.note ? <span className="muted" style={{ fontSize: 13 }}>{view.note}</span> : null}
        </div>
        <button type="button" className="pl-icon" aria-pressed={plan.favorite} disabled={sample} title={sampleTitle}
          aria-label={plan.favorite ? t("Remove {name} from favorites", { name: plan.name }) : t("Favorite {name}", { name: plan.name })} onClick={onFavorite}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={plan.favorite ? "currentColor" : "none"} stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={ICONS.heart} /></svg>
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span className="pl-badge">{t(PLAN_SOURCE_LABELS[plan.source])}</span>
        {view.facts ? <span className="muted" style={{ fontSize: 13 }}>{view.facts}</span> : null}
        {standing.differs && !standing.retrying ? <span className="pl-badge pl-warn">{t("Calendar differs")}</span> : null}
      </div>
      <Link href={edit} className="pl-open" aria-label={plan.name ? t("Open {name} in the editor", { name: plan.name }) : t("Open this plan in the editor")}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t(view.chart)}</span>
        <PlanBars bars={view.bars} label={t("{chart} by week", { chart: t(view.chart) })} />
        <PhaseRibbon ribbon={view.ribbon} />
      </Link>
      <div className="pl-figs">
        <div className="pl-fig"><span>{t("Weeks")}</span><span><CountUp text={String(plan.weekCount)} /></span></div>
        <div className="pl-fig"><span>{t("Sessions")}</span><span>{view.sessions ? <CountUp text={thousands(view.sessions)} /> : "—"}</span></div>
        <div className="pl-fig"><span>{t("Peak load")}</span><span className={view.peakLoad ? "pl-load" : undefined}>{view.peakLoad ? <CountUp text={thousands(view.peakLoad)} /> : "—"}</span></div>
      </div>
      <div className="pl-foot">
        <span className={standing.retrying || standing.removing ? "pl-bad" : status.live ? "pl-good" : "muted"} style={{ fontSize: 13, fontWeight: 600 }}>
          {standing.removing ? t("Removal incomplete") : status.text}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <LinkButton variant="primary" href={edit}>{sample ? t("Open") : t("Edit plan")}</LinkButton>
          <Button disabled={busy} onClick={onDuplicate}>{t("Duplicate")}</Button>
          {standing.retrying ? (
            <>
              <Button disabled={busy || sample} onClick={() => onCalendar("install")}>{t("Retry calendar install")}</Button>
              <Button disabled={busy || sample} onClick={() => onCalendar("remove")}>{t("Remove partial install")}</Button>
            </>
          ) : (
            <Button disabled={busy || sample} title={sampleTitle} onClick={() => onCalendar(standing.install ? "remove" : "install")}>{standing.install ? t("Remove from calendar") : t("Add to calendar")}</Button>
          )}
          <Button className="pl-round" disabled={busy || sample} title={sampleTitle} aria-label={t("Delete {name}", { name: plan.name })} onClick={onDelete}><Icon d={ICONS.trash} size={15} /></Button>
        </span>
      </div>
    </Card>
  );
}
