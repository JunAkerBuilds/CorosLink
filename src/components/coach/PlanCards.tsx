"use client";
// Coach's cards for saved plans (canvas: Plans with Coach › "Coach plan tools"). A plan edit lists the changes week
// by week and applies them to the plan, in the open editor when that plan is on screen (its Undo works too); a new
// plan shows the whole build (weeks, load by phase, the first weeks) and saves to the Library or opens in the editor.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, LinkButton } from "@/components/ui";
import { usePageCoachState } from "@/components/coach/pageCoach";
import {
  applyCoachPlanEdit, keepCoachPlanEdit, openCoachPlanDraft, replaceOpenPlanWithDraft, saveCoachPlanDraft, undoCoachPlanEdit, undoReplaceOpenPlan,
  type CoachHue, type OpenPlanEditor, type PlanDraftCard, type PlanEditCard, type PlanSession,
} from "@/data/coach";
import { draftWeekLoads } from "@/lib/coach/plans";
import { thousands } from "@/lib/format";
import { inferPhaseKinds } from "@/lib/planGenerate";
import { PHASE_LABELS, type PhaseKind } from "@/lib/plan";
import { CardShell, hueVar, ICONS, Outcome, Read } from "./CardShell";
import { useThread } from "./thread";
import { dateText, language, locale, t } from "@/lib/i18n";

const PHASE_HUE: Record<PhaseKind, CoachHue> = { base: "blue", build: "coral", peak: "pink", taper: "mint", recovery: "cyan", custom: "gold" };
const PLUS = "M12 5v14M5 12h14";

function Session({ s, strong }: { s: PlanSession; strong?: boolean }) {
  return (
    <span className="cc-session">
      <i aria-hidden="true" style={{ background: s.hue === "none" ? "rgba(var(--fg-rgb), 0.18)" : hueVar(s.hue) }} />
      <span className={strong && s.changed ? undefined : "soft"} style={strong && s.changed ? { fontWeight: 600 } : undefined}>{s.name}</span>
    </span>
  );
}

/** The open plan editor, when the side Coach is on it. */
function useEditor(): OpenPlanEditor | null {
  const page = usePageCoachState();
  return page?.plan ?? null;
}

export function PlanEdit({ card }: { card: PlanEditCard }) {
  const thread = useThread();
  const editor = useEditor();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = editor?.plan.id === card.planId;
  const act = (work: () => Promise<unknown>) => { if (busy) return; setBusy(true); setProblem(null); work().catch((e: unknown) => setProblem(e instanceof Error ? e.message : t("That didn’t work."))).finally(() => setBusy(false)); };
  const href = `/calendar/plans/edit?id=${encodeURIComponent(card.planId)}`;
  const { before, after, weeks } = card.load;
  return (
    <CardShell id={card.id} hue="mint" icon={ICONS.calendar} foldable={false} label={t("Plan edit")} busy={busy}
      eyebrow={card.applied ? t("Plan · applied") : card.kept ? t("Plan · not applied") : t("Plan · needs your OK")} title={card.title} subtitle={card.planName}
      footer={
        <footer className="cc-foot">
          {card.applied ? (
            <Outcome kind="done" title={t("Applied to “{name}”", { name: card.planName })} detail={card.applied.in === "editor"
              ? (card.ops.length === 1 ? t("1 change · not saved until you press Save plan") : t("{n} changes · not saved until you press Save plan", { n: card.ops.length }))
              : (card.ops.length === 1 ? t("1 change saved to the plan") : t("{n} changes saved to the plan", { n: card.ops.length }))}>
              {open ? null : <LinkButton href={href} className="co-sm">{t("Open plan")}</LinkButton>}
              <Button className="co-sm" disabled={busy} onClick={() => act(() => undoCoachPlanEdit(thread.conversationId, card, editor))}>{t("Undo")}</Button>
            </Outcome>
          ) : card.kept ? (
            <Outcome kind="none" title={t("Kept as it was")} detail={t("Nothing changed in the plan")}>
              <Button className="co-sm" onClick={() => act(() => keepCoachPlanEdit(thread.conversationId, card, false))}>{t("Review again")}</Button>
            </Outcome>
          ) : (
            <>
              {card.note ? <Read hue="mint">{card.note}</Read> : null}
              <div className="cc-actions">
                <button type="button" className="cc-quiet" disabled={busy} onClick={() => act(() => keepCoachPlanEdit(thread.conversationId, card, true))}>{t("Keep as is")}</button>
                {open ? null : <LinkButton href={href} className="co-sm">{t("Open plan")}</LinkButton>}
                <Button variant="primary" className="co-sm" disabled={busy} onClick={() => act(() => applyCoachPlanEdit(thread.conversationId, card, editor))}>{busy ? t("Applying") : t("Apply changes")}</Button>
              </div>
            </>
          )}
          {problem ? <Outcome kind="failed" title={t("Didn’t change")} detail={problem} /> : null}
        </footer>
      }>
      <div className="cc-body">
        <div className="scroll-x">
          <div className="cc-table" role="table" aria-label={t("Proposed plan changes")} style={{ minWidth: 440 }}>
            <div className="cc-plan pc-edit" data-head role="row">
              <span role="columnheader">{t("Week")}</span><span role="columnheader">{t("Now")}</span><span role="columnheader">{t("Proposed")}</span><span role="columnheader">{t("Load")}</span>
            </div>
            {card.rows.map((r, i) => (
              <div key={i} className="cc-plan pc-edit cc-row" role="row">
                <span role="cell" className="muted">{r.label}</span>
                <div role="cell">{r.now.map((s, j) => <Session key={j} s={s} />)}</div>
                <div role="cell">{r.proposed.map((s, j) => <Session key={j} s={s} strong />)}</div>
                <span role="cell" className="muted">{r.loadNow || r.loadNext ? <>{r.loadNow || "—"} → <strong>{r.loadNext}</strong></> : null}</span>
              </div>
            ))}
          </div>
        </div>
        {before || after ? (
          <div className="cc-week">
            <div>
              <span>{weeks === 1 ? t("Plan load, 1 week") : t("Plan load, {n} weeks", { n: weeks })}</span>
              <span>{after !== before ? <s>{thousands(before)}</s> : null} <strong className="num">{thousands(after)}</strong></span>
            </div>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

export function PlanDraft({ card }: { card: PlanDraftCard }) {
  const thread = useThread();
  const editor = useEditor();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const d = card.draft;
  const loads = useMemo(() => draftWeekLoads(d), [d]);
  const kinds = useMemo(() => inferPhaseKinds(loads), [loads]);
  const top = Math.max(1, ...loads);
  const peak = loads.indexOf(Math.max(...loads));
  // The bands under the bars: a single easier week stays inside the phase around it (its bar keeps its colour).
  const ribbon = useMemo(() => kinds.map((k, i) => (k === "recovery" && i > 0 ? kinds.slice(0, i).reverse().find((x) => x !== "recovery") ?? k : k)).reduce<{ kind: PhaseKind; weeks: number }[]>((out, k) => {
    const last = out[out.length - 1];
    if (last && last.kind === k) last.weeks += 1; else out.push({ kind: k, weeks: 1 });
    return out;
  }, []), [kinds]);
  const firstWeeks = Array.from({ length: Math.min(3, d.weeks) }, (_, w) => d.workouts.filter((x) => Math.floor(x.offset / 7) === w));
  const start = dateText(new Date(`${d.start}T12:00:00Z`), language() === "en" ? undefined : locale(), { day: "numeric", month: "short", timeZone: "UTC" });
  const act = (work: () => Promise<unknown>, failed: string) => {
    if (busy) return;
    setBusy(true); setProblem(null);
    work().catch((e: unknown) => setProblem(e instanceof Error ? e.message : failed)).finally(() => setBusy(false));
  };
  const save = () => act(() => saveCoachPlanDraft(thread.conversationId, card), t("Couldn’t save the plan."));
  const openIt = () => { try { router.push(openCoachPlanDraft(card)); } catch (e) { setProblem(e instanceof Error ? e.message : t("Couldn’t open the plan.")); } };
  return (
    <CardShell id={card.id} hue="mint" icon={PLUS} foldable={false} label={t("New plan")} busy={busy}
      eyebrow={card.saved ? t("New plan · saved") : card.replaced ? t("New plan · in the editor") : t("New plan · needs your OK")} title={d.name}
      footer={
        <footer className="cc-foot">
          {card.saved ? (
            <Outcome kind="done" title={t("Saved to your Library")} detail={t("“{name}” · add it to your calendar from the plan when you’re happy with it", { name: d.name })}>
              <LinkButton href={`/calendar/plans/edit?id=${encodeURIComponent(card.saved.planId)}`} className="co-sm">{t("Open plan")}</LinkButton>
            </Outcome>
          ) : card.replaced ? (
            <Outcome kind="done" title={t("Replaced “{name}”", { name: card.replaced.planName })} detail={t("In the editor · not saved until you press Save plan")}>
              <Button className="co-sm" disabled={busy} onClick={() => act(() => undoReplaceOpenPlan(thread.conversationId, card, editor), t("Couldn’t undo."))}>{t("Undo")}</Button>
            </Outcome>
          ) : (
            <>
              {d.overview ? <Read hue="mint">{d.overview}</Read> : null}
              <div className="cc-actions">
                {editor ? (
                  <>
                    <Button className="co-sm" disabled={busy} onClick={save}>{busy ? t("Saving") : t("Save as a new plan")}</Button>
                    <Button variant="primary" className="co-sm" disabled={busy} onClick={() => act(() => replaceOpenPlanWithDraft(thread.conversationId, card, editor), t("Couldn’t replace the plan."))}>{editor.plan.name ? t("Replace “{name}”", { name: editor.plan.name }) : t("Replace this plan")}</Button>
                  </>
                ) : (
                  <>
                    <Button className="co-sm" disabled={busy} onClick={openIt}>{t("Open in editor")}</Button>
                    <Button variant="primary" className="co-sm" disabled={busy} onClick={save}>{busy ? t("Saving") : t("Save to Library")}</Button>
                  </>
                )}
              </div>
            </>
          )}
          {problem ? <Outcome kind="failed" title={t("Not saved")} detail={problem} /> : null}
        </footer>
      }>
      <div className="cc-body">
        <div className="pd-stats">
          <div><span>{t("Weeks")}</span><strong>{d.weeks}</strong></div>
          <div><span>{t("Workouts")}</span><strong>{d.workouts.length}</strong></div>
          <div><span>{t("Peak week")}</span><strong style={{ color: "var(--h-pink-ink)" }}>{loads[peak] ? `${peak + 1} · ${thousands(loads[peak])}` : "—"}</strong></div>
          <div><span>{t("Starts")}</span><strong>{start}</strong></div>
        </div>
        {loads.some(Boolean) ? (
          <div className="pd-load">
            <span className="muted">{t("Weekly load")}</span>
            <div role="img" aria-label={t("Weekly load over {n} weeks", { n: d.weeks })} className="pd-bars">
              {loads.map((l, i) => <span key={i} style={{ height: `${Math.max(4, Math.round((l / top) * 100))}%`, background: hueVar(PHASE_HUE[kinds[i] ?? "base"]) }} title={t("Week {n}: {load}", { n: i + 1, load: l })} />)}
            </div>
            {ribbon.length ? <div className="pd-ribbon">{ribbon.map((r, i) => <span key={i} style={{ flex: `${r.weeks} 1 0`, borderColor: hueVar(PHASE_HUE[r.kind]) }}>{t(PHASE_LABELS[r.kind])}</span>)}</div> : null}
          </div>
        ) : null}
        <div className="cc-table">
          <div className="cc-plan pd-week" data-head><span style={{ gridColumn: "1 / -1", textAlign: "left" }}>{t("The first weeks")}</span></div>
          {firstWeeks.map((ws, w) => (
            <div key={w} className="cc-plan pd-week">
              <span className="muted">{t("Week {n}", { n: w + 1 })}</span>
              <div className="pd-list">{ws.length ? ws.map((x, i) => <Session key={i} s={{ name: x.name, hue: "mint" }} />) : <span className="muted">{t("Rest week")}</span>}</div>
            </div>
          ))}
          {d.weeks > 3 ? <div className="cc-plan pd-week"><span className="muted" style={{ gridColumn: "1 / -1", textAlign: "left" }}>{t("and {n} more weeks, all in the plan", { n: d.weeks - 3 })}</span></div> : null}
        </div>
      </div>
    </CardShell>
  );
}

