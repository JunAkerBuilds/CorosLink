"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CountUp, OriginBadge, Segmented } from "@/components/ui";
import { ENERGY_BAND, EnergyDayChart, energyReadingAt } from "@/components/viz/EnergyDayChart";
import { EnergyGauge } from "@/components/viz/EnergyGauge";
import { EnergyRangeBars, type EnergyRangeDay } from "@/components/viz/EnergyRangeBars";
import { EnergySteps } from "@/components/viz/EnergySteps";
import { useLoaded, type Origin } from "@/data/core";
import { loadEnergy, type EnergyData, type EnergyDay, type EnergyEventKind } from "@/data/energy";
import { parseDay, signed } from "@/lib/format";
import { msg, t } from "@/lib/i18n";
import { clockOfDay, dayLabel, energySteps, energyTotals, lastDays, lowestSinceWaking, shareWords, weekdayShort, type EnergyShare } from "@/lib/health";

type Range = "day" | "week" | "month";
const RANGES = [
  { value: "day", label: msg("Day") },
  { value: "week", label: msg("Week") },
  { value: "month", label: msg("Month") },
] as const;

const KIND: Record<EnergyEventKind, { name: string; color: string }> = {
  sleep: { name: msg("Sleep"), color: "var(--h-violet)" },
  workout: { name: msg("Workout"), color: "var(--h-mint)" },
  rest: { name: msg("Rest"), color: "var(--h-lime-deep)" },
  stress: { name: msg("Stress"), color: "var(--h-coral)" },
  awake: { name: msg("Awake"), color: "var(--dim)" },
};
const STEP_COLORS: Record<string, string> = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.color]));
const LEGEND = ["sleep", "workout", "rest", "stress"] as const;
const WEEKDAY_LONG = [msg("Sunday"), msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday")];

export default function EnergyPage() {
  const state = useLoaded(loadEnergy);
  return (
    <main className="page" style={{ paddingBottom: 56 }}>
      {state.status === "ready" && state.data.days.length > 0 ? <Energy data={state.data} origin={state.origin} /> : (
        <>
          <div className="page-head" style={{ alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <nav aria-label={t("Breadcrumb")} className="muted" style={{ fontSize: 13 }}>
                <Link href="/health" style={{ textDecoration: "none", fontWeight: 600 }}>{t("Health")}</Link>
              </nav>
              <h1 style={{ fontSize: 26 }}>{t("Energy")}</h1>
            </div>
          </div>
          {state.status === "error"
            ? <div className="notice" role="alert">{t("Energy could not be loaded.")} {state.error.message}</div>
            : state.status === "ready"
              ? <div className="notice">{t("No Energy readings yet.")}</div>
              : <div className="skeleton" aria-busy="true" aria-label={t("Loading Energy")} style={{ minHeight: 360 }} />}
        </>
      )}
    </main>
  );
}

function rangeDays(days: readonly EnergyDay[], todayKey: string, labelEvery: number): EnergyRangeDay[] {
  return days.map((d, i) => {
    const date = parseDay(d.date);
    const isToday = d.date === todayKey;
    const labelled = isToday || ((days.length - 1 - i) % labelEvery === 0);
    return {
      key: d.date,
      label: !labelled ? "" : isToday ? t("Today") : labelEvery === 1 ? weekdayShort(date) : String(date.getDate()),
      title: dayLabel(date),
      low: d.low, high: d.high, waking: d.woke?.level ?? null,
    };
  });
}

function weekLabel(days: readonly EnergyDay[]): string {
  const woken = days.flatMap((d) => (d.woke ? [{ date: d.date, level: d.woke.level }] : []));
  if (woken.length === 0) return t("Each day's lowest and highest energy");
  let best = woken[0], worst = woken[0];
  for (const d of woken) {
    if (d.level > best.level) best = d;
    if (d.level < worst.level) worst = d;
  }
  const name = (d: { date: string }) => t(WEEKDAY_LONG[parseDay(d.date).getDay()]);
  return t("Each day's lowest and highest energy; waking energy was highest on {best} at {high} and lowest on {worst} at {low}", {
    best: name(best), high: best.level, worst: name(worst), low: worst.level,
  });
}

const byAmount = (list: readonly EnergyShare[]) => [...list].sort((a, b) => b.amount - a.amount);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function Energy({ data, origin }: { data: EnergyData; origin: Origin }) {
  const { days } = data;
  const today = days[days.length - 1];
  const [range, setRange] = useState<Range>("day");
  const [picked, setPicked] = useState(today.date);
  const [hover, setHover] = useState<number | null>(null);
  const day = days.find((d) => d.date === picked) ?? today;
  const isToday = day.date === today.date && day.now != null;
  const date = parseDay(day.date);

  const totals = useMemo(() => energyTotals(day.events), [day.events]);
  const charged = byAmount(totals.chargedBy), used = byAmount(totals.usedBy);
  const largest = Math.max(1, ...charged.map((s) => s.amount), ...used.map((s) => s.amount));
  const week = useMemo(() => lastDays(days, 7), [days]);
  const weekBars = useMemo(() => rangeDays(week, today.date, 1), [week, today.date]);
  const span = range === "month" ? days : week;
  const spanBars = useMemo(() => rangeDays(span, today.date, range === "month" ? 5 : 1), [span, today.date, range]);

  const last = day.points[day.points.length - 1];
  const endLevel = isToday && day.now ? day.now.level : last?.level ?? day.woke?.level ?? day.low;
  const level = isToday && day.now ? day.now.level : day.woke?.level ?? endLevel;
  const lowest = lowestSinceWaking(day.points, day.woke?.minute ?? 0);
  const minute = hover ?? (isToday && day.now ? day.now.minute : day.woke?.minute ?? last?.minute ?? 0);
  const reading = energyReadingAt(day, minute);
  const steps = energySteps(day.events, endLevel, isToday && day.now
    ? { name: t("Now"), when: clockOfDay(day.now.minute) }
    : { name: t("End of day"), when: last ? clockOfDay(last.minute) : "" });
  const stepList = steps.slice(1, -1)
    .map((s) => {
      const vars = { what: lowerFirst(t(s.name)), n: Math.abs(s.to - s.from) };
      return s.to > s.from ? t("{what} added {n}", vars) : t("{what} took {n}", vars);
    }).join(", ");
  const stepsLabel = isToday
    ? t("Step by step: {start} at bedtime, {steps}, leaving {end} now", { start: steps[0].to, steps: stepList, end: endLevel })
    : t("Step by step: {start} at bedtime, {steps}, leaving {end}", { start: steps[0].to, steps: stepList, end: endLevel });

  const topCharge = charged[0], topUse = used[0];
  const chargedShare = topCharge && totals.charged > 0 ? t(shareWords(topCharge.amount / totals.charged)) : "";
  const chargedNote = !topCharge || totals.charged <= 0 ? t("Nothing charged yet.")
    : topCharge.kind === "sleep" && day.sleep
      ? t("Sleep did {share} of it: {h} h {m} min at a score of {score}.", { share: chargedShare, h: Math.floor(day.sleep.minutes / 60), m: day.sleep.minutes % 60, score: day.sleep.score })
      : t("{what} did {share} of it.", { what: t(KIND[topCharge.kind].name), share: chargedShare });
  const topUseEvent = topUse ? day.events.filter((e) => e.kind === topUse.kind).sort((a, b) => a.delta - b.delta)[0] : undefined;
  const usedShare = topUse && totals.used > 0 ? t(shareWords(topUse.amount / totals.used)) : "";
  const usedNote = !topUse || totals.used <= 0 ? t("Nothing used yet.")
    : topUse.kind === "awake" ? t("Being awake took {share} of it.", { share: usedShare })
    : topUse.kind === "stress" ? t("Stress took {share} of it.", { share: usedShare })
    : t("The {what} took {share} of it.", { what: lowerFirst(t(topUseEvent?.name ?? KIND[topUse.kind].name)), share: usedShare });

  const openDay = (key: string) => { setPicked(key); setRange("day"); setHover(null); };
  const bars = (list: EnergyShare[]) => list.map((s) => (
    <div key={s.kind} style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr) 34px", gap: 12, alignItems: "center" }}>
      <span style={{ fontWeight: 500 }}>{t(KIND[s.kind].name)}</span>
      <svg aria-hidden="true" className="no-wipe" width="100%" height="12" viewBox="0 0 100 12" preserveAspectRatio="none">
        <rect width="100" height="12" rx="6" style={{ fill: "var(--line)" }} />
        <rect className="energy-share" width={((s.amount / largest) * 100).toFixed(1)} height="12" rx="6" style={{ fill: KIND[s.kind].color }} />
      </svg>
      <span className="num" style={{ textAlign: "right", fontSize: 16, fontWeight: 800 }}>{s.amount}</span>
    </div>
  ));

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <nav aria-label={t("Breadcrumb")} className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Link href="/health" style={{ textDecoration: "none", fontWeight: 600 }}>{t("Health")}</Link>
            <span aria-hidden="true">/</span>
            <span>{dayLabel(date)}{isToday && day.now ? `, ${clockOfDay(day.now.minute)}` : ""}</span>
          </nav>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
            <h1 style={{ fontSize: 26 }}>{t("Energy")}</h1>
            <OriginBadge origin={origin} />
          </div>
        </div>
        <Segmented label={t("Range")} className="energy-seg" options={RANGES.map((r) => ({ ...r, label: t(r.label) }))} value={range} onChange={setRange} />
      </div>

      {day.learning ? <div className="notice">{t("Energy is learning your normal. It settles after a night with your watch.")}</div> : null}

      <Card aria-label={isToday ? t("Energy today") : t("Energy on {day}", { day: dayLabel(date) })} className="energy-hero">
        <div className="energy-gauge">
          <EnergyGauge level={level} woke={isToday ? day.woke?.level : undefined} label={t("Energy {n} out of 100", { n: level })} />
          <span className="energy-chip">
            {isToday && day.pace ? (
              <>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  style={{ strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round", transform: day.pace.direction === "up" ? "rotate(180deg)" : day.pace.direction === "flat" ? "rotate(-90deg)" : undefined }}>
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
                {day.pace.label}
              </>
            ) : day.woke ? t("On waking, {time}", { time: clockOfDay(day.woke.minute) }) : last ? t("At {time}", { time: clockOfDay(last.minute) }) : null}
          </span>
          {isToday && day.woke ? <span className="muted" style={{ fontSize: 12 }}>{t("The mark on the ring is where you woke")}</span> : null}
        </div>

        <div style={{ flex: "1 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "12px 24px" }}>
            {isToday && day.headline ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Image src="/img/coach-listen.webp" alt="" width={76} height={76} style={{ flex: "none", margin: "-8px 0" }} />
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: "30px", maxWidth: "22ch" }}>{day.headline}</h2>
              </div>
            ) : <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>{dayLabel(date)}</h2>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px" }}>
              {day.woke ? <Stat label={t("Woke at {time}", { time: clockOfDay(day.woke.minute) })} value={day.woke.level} /> : null}
              {lowest ? <Stat label={t("Lowest, {time}", { time: clockOfDay(lowest.minute) })} value={lowest.level} /> : null}
              {isToday && day.bedtime ? <Stat label={t("Bedtime, about")} value={day.bedtime.level} muted /> : null}
            </div>
          </div>

          {range === "day" ? (
            <>
              <div className="energy-readout">
                <div aria-live="polite" style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="num" style={{ fontSize: 20, fontWeight: 800 }}>{clockOfDay(reading.minute)}</span>
                  <span className="num" style={{ fontSize: 20, fontWeight: 800, color: "var(--h-lime-ink)" }}>
                    {reading.level != null ? Math.round(reading.level) : "–"}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>{reading.what}</span>
                </div>
                <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 13 }}>
                  {LEGEND.map((k) => (
                    <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: ENERGY_BAND[k].color }} />
                      {t(ENERGY_BAND[k].name)}
                    </span>
                  ))}
                </div>
              </div>
              <EnergyDayChart key={day.date} day={day} minute={minute} onMinute={setHover} />
            </>
          ) : (
            <>
              <div className="energy-readout">
                <span style={{ fontSize: 15, fontWeight: 700 }}>{range === "week" ? t("Last 7 days") : t("Last 30 days")}</span>
                <span className="muted" style={{ fontSize: 13 }}>{t("Low to high each day, dot at waking. Pick a day to open it.")}</span>
              </div>
              <EnergyRangeBars days={spanBars} selected={day.date} onSelect={openDay} width={940} label={weekLabel(span)} />
            </>
          )}
        </div>
      </Card>

      <div className="energy-row">
        <Card aria-label={t("Charged")} className="energy-card">
          <div className="energy-card-head"><h2 className="h2">{t("Charged")}</h2>
            <CountUp className="num" style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, color: "var(--h-lime-ink)" }} text={signed(totals.charged)} />
          </div>
          {bars(charged)}
          <span className="muted energy-note">{chargedNote}</span>
        </Card>
        <Card aria-label={t("Used")} className="energy-card">
          <div className="energy-card-head"><h2 className="h2">{t("Used")}</h2>
            <CountUp className="num" style={{ fontSize: 34, fontWeight: 900, lineHeight: 1 }} text={signed(-totals.used)} />
          </div>
          {bars(used)}
          <span className="muted energy-note">{usedNote}</span>
        </Card>
        <Card aria-label={t("How it’s read")} className="energy-card" style={{ gap: 12 }}>
          <h2 className="h2">{t("How it’s read")}</h2>
          <div className="energy-how"><span aria-hidden="true" data-sign="+">+</span>
            <p><strong>{t("Charges")}</strong>&nbsp; {t("Sleep, and calm stretches while you’re awake.")}</p></div>
          <div className="energy-how"><span aria-hidden="true">−</span>
            <p><strong>{t("Uses")}</strong>&nbsp; {t("Workouts, stress, and simply being awake.")}</p></div>
          <span className="muted energy-note">{t("Read from your watch’s stress, sleep and workouts.")}</span>
        </Card>
      </div>

      <div className="energy-row">
        <Card aria-label={isToday ? t("Since last night") : t("Through the day")} className="energy-card" style={{ flex: "2 1 560px", gap: 12 }}>
          <div className="energy-card-head" style={{ gap: 12 }}>
            <h2 className="h2">{isToday ? t("Since last night") : t("Through the day")}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{isToday ? t("From {start} at bedtime to {end} now", { start: steps[0].to, end: endLevel }) : t("From {start} at bedtime to {end}", { start: steps[0].to, end: endLevel })}</span>
          </div>
          <div className="scroll-x"><div style={{ minWidth: steps.length * 92 }}>
            <EnergySteps steps={steps} colors={STEP_COLORS} label={stepsLabel} />
          </div></div>
        </Card>
        <Card aria-label={t("This week")} className="energy-card" style={{ flex: "1 1 360px", gap: 12 }}>
          <div className="energy-card-head" style={{ gap: 12 }}>
            <h2 className="h2">{t("This week")}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{t("Low to high, dot at waking")}</span>
          </div>
          <EnergyRangeBars days={weekBars} selected={day.date} onSelect={openDay} label={weekLabel(week)} compact />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${weekBars.length}, minmax(0, 1fr))`, textAlign: "center" }}>
            {weekBars.map((d) => (
              <div key={d.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: d.key === day.date ? 700 : 600 }}>{d.label}</span>
                <span className="muted" style={{ fontSize: 11 }}>{t("Woke {n}", { n: d.waking ?? "–" })}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <CountUp className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: muted ? "var(--muted)" : undefined }} text={String(value)} />
    </div>
  );
}
