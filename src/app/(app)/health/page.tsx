"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, LinkButton, OriginBadge, Segmented, CountUp } from "@/components/ui";
import { HealthHypnogram, STAGE_COLOR, STAGE_NAME } from "@/components/viz/HealthHypnogram";
import { HealthTrendChart } from "@/components/viz/HealthTrendChart";
import { NightSky } from "@/components/viz/NightSky";
import { ScoreDial } from "@/components/viz/ScoreDial";
import { useLoaded, type Origin } from "@/data/core";
import { loadHealth, type HealthData, type SleepStage, type TrendFormat } from "@/data/health";
import { loadSleep, type SleepData } from "@/data/sleep";
import { HealthSleepCards, HealthSleepStrip } from "@/components/sleep/HealthSleep";
import { scoreGlow, scoreVar } from "@/components/sleep/common";
import { parseDay, thousands } from "@/lib/format";
import { msg, t } from "@/lib/i18n";
import { addDays, clockOfDay, dayLabel, dayMonth, durationShort, hoursLong, lastDays, mean, nightTotals, present } from "@/lib/health";

type Range = "7" | "30" | "90" | "365";
const RANGES = [
  { value: "7", label: msg("7 days") },
  { value: "30", label: msg("30 days") },
  { value: "90", label: msg("90 days") },
  { value: "365", label: msg("1 year") },
] as const;

const FORMAT: Record<TrendFormat, (v: number) => string> = {
  int: (v) => String(Math.round(v)),
  hours: hoursLong,
  thousands,
};

const MORNING_COLUMNS = "minmax(0, 1.3fr) 72px 56px minmax(80px, 1fr)";
const STAGE_TILES: SleepStage[] = ["deep", "light", "rem", "awake"];

export default function HealthPage() {
  const state = useLoaded(loadHealth);
  return (
    <main className="page">
      {state.status === "ready" ? <Health data={state.data} origin={state.origin} /> : (
        <>
          <div className="page-head"><h1>{t("Health")}</h1></div>
          {state.status === "error"
            ? <div className="notice" role="alert">{t("Health could not be loaded.")} {state.error.message}</div>
            : <div className="skeleton" aria-busy="true" aria-label={t("Loading Health")} style={{ minHeight: 360 }} />}
        </>
      )}
    </main>
  );
}

function Health({ data, origin }: { data: HealthData; origin: Origin }) {
  const sleepState = useLoaded(loadSleep);
  const sleep: SleepData | null = sleepState.status === "ready" ? sleepState.data : null;
  const [range, setRange] = useState<Range>("30");
  /** The picked day, counted back from the newest reading, so it survives a range switch. */
  const [back, setBack] = useState(0);

  const { night } = data;
  const totals = useMemo(() => (night ? nightTotals(night) : null), [night]);
  const empty = !night && data.morning.length === 0 && data.trends.length === 0;
  const lastDay = useMemo(() => parseDay(data.lastDay), [data.lastDay]);

  const shown = useMemo(
    () => data.trends.map((tr) => ({ ...tr, values: lastDays(tr.values, Number(range)) })),
    [data.trends, range],
  );
  const count = shown.reduce((n, tr) => Math.max(n, tr.values.length), 0);
  const index = Math.max(0, count - 1 - Math.min(back, count - 1));
  const pickedDay = addDays(lastDay, index - (count - 1));
  const firstDay = addDays(lastDay, -(count - 1));
  const withYear = firstDay.getFullYear() !== lastDay.getFullYear();

  return (
    <>
      <div className="page-head">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
          <h1>{t("Health")}</h1>
          <LinkButton href="/health/energy">
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: "var(--h-lime-deep)" }} />
            {t("Energy")}{data.energyNow != null ? ` ${data.energyNow}` : ""}
          </LinkButton>
          <LinkButton href="/health/sleep">
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: "var(--h-violet)" }} />
            {t("Sleep")}{night?.score != null ? ` ${night.score}` : ""}
          </LinkButton>
          <OriginBadge origin={origin} />
        </div>
        <Segmented label={t("Range")} options={RANGES.map((r) => ({ ...r, label: t(r.label) }))} value={range} onChange={setRange} />
      </div>

      {empty ? <div className="notice">{t("Nothing from your phone yet")}</div> : (
      <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 24 }}>
        <NightSky aria-label={t("Last night")} className="health-night">
          {night && totals ? (
          <>
          <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <ScoreDial
              value={night.score ?? 0} size={210} radius={93} stroke={16}
              color={night.score != null ? scoreVar(night.score) : "transparent"} glow={night.score != null ? scoreGlow(night.score) : "transparent"} glowBlur={9}
              label={night.score == null ? t("No sleep score") : night.rating ? t("Sleep score {score} out of 100, {rating}", { score: night.score, rating: t(night.rating).toLowerCase() }) : t("Sleep score {score} out of 100", { score: night.score })}
            >
              <CountUp className="num" style={{ fontSize: 66, fontWeight: 900, lineHeight: 1 }} text={night.score != null ? String(night.score) : "–"} />
              {night.rating ? <span style={{ fontSize: 15, fontWeight: 700, color: "var(--sky-rating)" }}>{t(night.rating)}</span> : null}
              <span style={{ fontSize: 11, color: "var(--sky-text)" }}>{t("Sleep score")}</span>
            </ScoreDial>
            {totals.asleep != null ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <CountUp className="num" style={{ fontSize: 24, fontWeight: 800 }} text={durationShort(totals.asleep)} />
                <span style={{ color: "var(--sky-text)" }}>{t("asleep")}</span>
              </div>
            ) : null}
          </div>

          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
                <h2 className="h2">{t("Last night")}</h2>
                {night.startMinute != null && totals.inBed != null ? (
                  <span style={{ fontSize: 13, color: "var(--sky-text)" }}>
                    {t("{from} to {to}", { from: clockOfDay(night.startMinute), to: clockOfDay(night.startMinute + totals.inBed) })}
                  </span>
                ) : null}
              </div>
              <Link href="/health/sleep" className="sl-open">
                {t("Open sleep")}
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            {night.segments.length > 0 ? <HealthHypnogram night={night} /> : null}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10, padding: "14px 16px",
              borderRadius: 16, background: "rgba(var(--fg-rgb), 0.06)", border: "1px solid rgba(var(--fg-rgb), 0.12)",
            }}>
              {STAGE_TILES.map((s) => (
                <div key={s} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sky-text)" }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: STAGE_COLOR[s] }} />
                    {t(STAGE_NAME[s])}
                  </span>
                  <span className="num" style={{ fontSize: 18, fontWeight: 800 }}>{totals[s] != null ? durationShort(totals[s]) : "–"}</span>
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, color: "var(--sky-text)" }}>{t("HR asleep")}</span>
                <span className="num" style={{ fontSize: 18, fontWeight: 800 }}>{night.heartRateAsleep != null ? `${night.heartRateAsleep} bpm` : "–"}</span>
              </div>
            </div>
          </div>
          {sleep && sleep.nights.length > 1 ? <HealthSleepStrip nights={sleep.nights} /> : null}
          </>
          ) : <span style={{ fontSize: 13, color: "var(--sky-text)" }}>{t("Nothing from your phone yet")}</span>}
        </NightSky>

        <Card clip aria-label={t("This morning")} style={{ flex: "1 1 400px", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 18px 12px" }}><h2 className="h2">{t("This morning")}</h2></div>
          <div className="scroll-x morning-fill">
            <div role="table" aria-label={t("This morning")} style={{ minWidth: 380 }}>
              <div role="row" className="thead" style={{ gridTemplateColumns: MORNING_COLUMNS, gap: 20, borderBottomColor: "rgba(var(--fg-rgb), 0.1)" }}>
                <span role="columnheader">{t("Measure")}</span>
                <span role="columnheader" style={{ textAlign: "right" }}>{t("Today")}</span>
                <span role="columnheader" style={{ textAlign: "right" }}>{t("7 days")}</span>
                <span role="columnheader">{t("30-day range")}</span>
              </div>
              {data.morning.map((m, k) => (
                <div key={m.name} role="row" className="row morning-row" style={{ gridTemplateColumns: MORNING_COLUMNS, gap: 20, minHeight: 42 }}>
                  <span role="cell" style={{ fontWeight: 500 }}>{t(m.name)}</span>
                  <span role="cell" style={{ textAlign: "right", fontWeight: 700 }}>{m.today}</span>
                  <span role="cell" className="soft" style={{ textAlign: "right" }}>{m.week}</span>
                  <span role="cell">
                    {m.position == null ? null : (
                    <svg role="img" className="no-wipe" aria-label={t("Today is {n}% of the way from the lowest to the highest", { n: m.position })} width="100%" height="12" viewBox="0 0 100 12" preserveAspectRatio="none" style={{ display: "block" }}>
                      <rect x="0" y="4" width="100" height="4" rx="2" style={{ fill: "rgba(var(--fg-rgb), 0.12)" }} />
                      <rect className="range-mark" x={Math.max(0, Math.min(96, m.position))} y="0" width="4" height="12" rx="2"
                        style={{ fill: `var(--h-${m.hue})`, ["--from" as string]: `${-Math.max(0, Math.min(96, m.position))}px`, animationDelay: `${(0.5 + k * 0.07).toFixed(2)}s` }} />
                    </svg>
                    )}
                  </span>
                </div>
              ))}
              {data.morning.length === 0 ? (
                <div role="row" className="row muted" style={{ minHeight: 42 }}><span role="cell">{t("Nothing from your phone yet")}</span></div>
              ) : null}
            </div>
          </div>
          <p className="muted" style={{ margin: 0, padding: "12px 18px", fontSize: 13 }}>
            {t("The marker shows today inside your lowest and highest value of the last 30 days.")}
          </p>
        </Card>
      </div>

      {sleep && sleep.nights.length ? <HealthSleepCards data={sleep} /> : null}

      <section aria-label={t("Trends")} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h2 className="h2">{t("Trends")}</h2>
          <span aria-live="polite" style={{ fontSize: 13, fontWeight: 600 }}>{dayLabel(pickedDay)}{withYear ? ` ${pickedDay.getFullYear()}` : ""}</span>
        </div>
        <div className="health-trends">
          {shown.map((tr) => {
            const fmt = FORMAT[tr.format];
            const at = tr.values[Math.min(index, tr.values.length - 1)];
            const have = present(tr.values);
            return (
              <HealthTrendChart
                key={tr.id} name={t(tr.name)} values={tr.values} color={`var(--h-${tr.hue})`}
                index={Math.min(index, tr.values.length - 1)}
                onIndex={(i) => setBack(tr.values.length - 1 - i)}
                valueText={at != null ? `${fmt(at)}${tr.unit}` : "–"}
                averageText={t("Average {value}", { value: have.length ? `${fmt(mean(have))}${tr.unit}` : "–" })}
                fromLabel={dayMonth(firstDay, withYear)} toLabel={dayMonth(lastDay, withYear)}
                pickedLabel={dayLabel(pickedDay)}
              />
            );
          })}
        </div>
        {shown.length === 0 ? <div className="notice">{t("Nothing from your phone yet")}</div> : null}
      </section>
      </>
      )}
    </>
  );
}
