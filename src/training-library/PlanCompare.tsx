import { formatNumber, getLocale, useLanguage, t } from "../i18n/training";
import { AlertTriangle, Check, Scale, X } from "lucide-react";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TrainingPlanDocument } from "../../electron/types";
import { compareTrainingPlans } from "../../electron/trainingPlanDomain";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { formatDistanceValue } from "../units/units";

interface PlanCompareProps {
  plans: TrainingPlanDocument[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onClose: () => void;
}
const COLORS = ["var(--accent-strong)", "var(--accent-gold)", "#5f8fc9"];

function durationLabel(seconds: number): string {
  const hours = seconds / 3600;
  return hours < 10 ? `${formatNumber(hours, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hr` : `${Math.round(hours)} hr`;
}

export function PlanCompare({ plans, selectedIds, onSelectionChange, onClose }: PlanCompareProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const selected = plans.filter((plan) => selectedIds.includes(plan.id)).slice(0, 3);
  const comparison = useMemo(() => compareTrainingPlans(selected), [selected, getLocale()]);
  const chartData = useMemo(() => {
    const maxWeeks = Math.max(0, ...comparison.summaries.map((summary) => summary.weekCount));
    return Array.from({ length: maxWeeks }, (_, weekIndex) => {
      const row: Record<string, string | number> = { week: `W${weekIndex + 1}` };
      for (const summary of comparison.summaries) {
        row[summary.planId] = Math.round(summary.weekly[weekIndex]?.trainingLoad ?? 0);
      }
      return row;
    });
  }, [comparison, getLocale()]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((value) => value !== id));
    } else if (selectedIds.length < 3) {
      onSelectionChange([...selectedIds, id]);
    }
  };

  return <section className="plan-compare" aria-labelledby="plan-compare-title">
    <header>
      <div><p className="tl-eyebrow">{t("Plan comparison")}</p><h2 id="plan-compare-title">{t("Compare structure and load")}</h2><p>{t("Select two or three plans. Estimates come from their structured workout definitions.")}</p></div>
      <button type="button" className="ghost-button" onClick={onClose}><X size={15} /> {t("Close")}</button>
    </header>

    <div className="plan-compare-picker" aria-label={t("Plans to compare")}>
      {plans.map((plan) => {
        const active = selectedIds.includes(plan.id);
        return <button type="button" className={active ? "is-selected" : ""} aria-pressed={active} key={plan.id} onClick={() => toggle(plan.id)} disabled={!active && selectedIds.length >= 3}>{active ? <Check size={14} /> : <Scale size={14} />}<span><strong>{plan.name}</strong><small>{plan.weekCount} {t("weeks")}</small></span></button>;
      })}
    </div>

    {selected.length < 2 ? <div className="tl-empty"><h3>{t("Pick a second plan")}</h3><p>{t("The comparison appears as soon as two plans are selected.")}</p></div> : <>
      <div className="plan-compare-grid" style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(0, 1fr))` }}>
        {comparison.summaries.map((summary) => <article key={summary.planId}>
          <h3>{summary.name}</h3>
          <dl>
            <div><dt>{t("Total duration")}</dt><dd>{durationLabel(summary.durationSeconds)}</dd></div>
            <div><dt>{t("Total distance")}</dt><dd>{formatDistanceValue(summary.distanceMeters, unitSystem, { digits: 1 })}</dd></div>
            <div><dt>{t("Estimated load")}</dt><dd>{Math.round(summary.trainingLoad)}</dd></div>
            <div><dt>{t("Workouts")}</dt><dd>{summary.workouts}</dd></div>
            <div><dt>{t("Peak week")}</dt><dd>{summary.peakWeek ?? "-"}</dd></div>
            <div><dt>{t("Recovery days")}</dt><dd>{summary.restDays}</dd></div>
            <div><dt>{t("Strength sets")}</dt><dd>{summary.strengthSets || "-"}</dd></div>
            <div><dt>{t("Conflicts")}</dt><dd>{summary.conflictCount}</dd></div>
            <div><dt>{t("Clear taper")}</dt><dd>{summary.taperDetected ? t("Yes") : t("No")}</dd></div>
          </dl>
          <div className="plan-compare-sports">{Object.entries(summary.sportDistribution).map(([sport, count]) => <span key={sport}>{sport} <strong>{count}</strong></span>)}</div>
          {summary.longestWorkout ? <p className="plan-compare-longest"><small>{t("Longest workout")}</small><strong>{summary.longestWorkout.name}</strong><span>{durationLabel(summary.longestWorkout.durationSeconds)}</span></p> : null}
        </article>)}
      </div>

      <section className="plan-compare-chart" aria-label={t("Weekly training-load chart comparing {{value1}}", { value1: String(comparison.summaries.map((summary) => summary.name).join(", ")) })}>
        <div><h3>{t("Weekly load progression")}</h3><p>{t("The chart shows estimated structured-workout load by week.")}</p></div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 12, right: 18, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--glass-border)" vertical={false} />
            <XAxis dataKey="week" stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <YAxis stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--glass-border)", borderRadius: 10 }} />
            <Legend />
            {comparison.summaries.map((summary, index) => <Line key={summary.planId} dataKey={summary.planId} name={summary.name} type="monotone" stroke={COLORS[index]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="plan-compare-insights">
        <h3>{t("Structural insights")}</h3>
        {comparison.insights.length ? comparison.insights.map((insight) => <p key={insight}><AlertTriangle size={15} />{insight}</p>) : <p><Check size={15} />{t("No major progression or scheduling flags were found in these estimates.")}</p>}
        {comparison.sharedWorkoutNames.length ? <p><Check size={15} />{t("Shared workouts:")} {comparison.sharedWorkoutNames.join(", ")}.</p> : null}
        <small>{t("These flags support planning review and are not medical advice.")}</small>
      </section>
    </>}
  </section>;
}
