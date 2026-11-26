"use client";
import Link from "next/link";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { PetalDial } from "@/components/viz/PetalDial";
import { PetalFan, PetalRow } from "@/components/viz/PetalFan";
import { Button, Card, OriginBadge, Segmented, CountUp } from "@/components/ui";
import { loadBody } from "@/data/body";
import { useLoaded } from "@/data/core";
import {
  addSyncedFood, changeSyncedAmount, copySyncedDay, loadFuel, MEAL_KEYS, removeSyncedFood,
  type DayBurn, type DayLog, type FuelData, type LoggedFood, type MealKey, type Targets,
} from "@/data/fuel";
import { NO_MEASUREMENTS, ownMeasurements } from "@/data/local/body";
import { fuelDays, NO_DAYS, useToday } from "@/data/local/fuel";
import { useStore } from "@/data/local/store";
import { mergeMeasurements, oneOrTwo } from "@/lib/body";
import { parseDay, signed, thousands } from "@/lib/format";
import {
  addFood, burnedKcal, changeAmount, copyFoods, dayTotals, daysEnding, dial, DIAL_PETALS, emptyDay, FAN_PETALS, foodCount, foodLabel, foodNutrients,
  macroPercents, mealTargetKcal, mealTotals, mean, petalsLit, remaining, removeFood, ROW_PETALS, shiftDay, trim,
} from "@/lib/fuel";
import { EstimateDialog } from "./EstimateDialog";
import { locale, msg, t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { FoodDialog, MEAL_NAME, type FoodDialogState } from "./FoodDialog";
import "./fuel.css";

type RangeKey = "day" | "week" | "month";
const RANGE_DAYS: Record<RangeKey, number> = { day: 7, week: 7, month: 30 };

const icon = (stroke: string, children: ReactNode) => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ stroke, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>{children}</svg>
);

/** Each meal's colour: the tint behind its tile, the hue of its petals and icon, and the ink of its buttons. */
const MEAL_LOOK: Record<MealKey, { rgb: string; hue: string; ink: string; icon: ReactNode }> = {
  breakfast: { rgb: "255,169,77", hue: "var(--h-orange)", ink: "var(--h-orange-ink)", icon: icon("var(--h-orange)", <path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 6v3M5 9l2 2M19 9l-2 2" />) },
  lunch: { rgb: "216,155,34", hue: "var(--h-gold)", ink: "var(--h-amber-soft-ink)", icon: icon("var(--h-gold)", <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>) },
  dinner: { rgb: "165,148,255", hue: "var(--h-violet)", ink: "var(--h-lilac-ink)", icon: icon("var(--h-violet)", <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />) },
  snack: { rgb: "83,203,161", hue: "var(--h-mint)", ink: "var(--h-mint-ink)", icon: icon("var(--h-mint)", <path d="M5 19c6 1 12-5 12-11l-3 1-1-3C8 8 4 14 5 19zM17 8l3-4M14 6l1-3" />) },
};

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const shortDate = (day: string) => parseDay(day).toLocaleDateString(locale("en-US"), { weekday: "short", month: "short", day: "numeric" });
const monthDay = (day: string) => parseDay(day).toLocaleDateString(locale("en-US"), { month: "short", day: "numeric" });
const weekday = (day: string, width: "short" | "long") => parseDay(day).toLocaleDateString(locale("en-US"), { weekday: width });

/** The meal to offer first when adding from the page's Add food button: by the clock today, breakfast on other days. */
function mealForNow(isToday: boolean): MealKey {
  if (!isToday) return "breakfast";
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

export default function FuelPage() {
  const fuel = useLoaded(loadFuel);
  if (fuel.status === "loading") return <main className="page"><div className="skeleton" style={{ minHeight: 420 }} /></main>;
  if (fuel.status === "error") return <main className="page"><p className="notice" role="alert">{t("Fuel could not be loaded.")} {fuel.error.message}</p></main>;
  return <Fuel data={fuel.data} synced={fuel.origin === "synced"} />;
}

/** `synced`: signed in, so the log is the account's and every change is written to it instead of this browser. */
function Fuel({ data, synced }: { data: FuelData; synced: boolean }) {
  const today = useToday();
  const saved = useStore(fuelDays, NO_DAYS);
  const body = useLoaded(loadBody);
  const ownWeights = useStore(ownMeasurements, NO_MEASUREMENTS);
  const [picked, setPicked] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("day");
  const [dialog, setDialog] = useState<FoodDialogState | null>(null);
  const [estimate, setEstimate] = useState<{ meal: MealKey; withPhoto: boolean } | null>(null);
  const [notWired, setNotWired] = useState<string | null>(null);

  const day = picked ?? today;
  const isToday = day === today;
  const logOf = (d: string): DayLog => (synced ? undefined : saved[d]) ?? data.logs[d] ?? emptyDay(d);
  const burnOf = (d: string): DayBurn | null => data.burn[d] ?? (data.restingKcal == null ? null : { resting: data.restingKcal, active: 0 });
  const targetsOf = (d: string): Targets | null => data.targetsByDay?.[d] ?? data.targets;
  const log = logOf(day);
  const burn = burnOf(day);
  const targets = targetsOf(day);
  const eaten = dayTotals(log);

  /** Every change saves the whole day in this browser, starting from what the page was showing. */
  const edit = (d: string, change: (log: DayLog) => DayLog) =>
    fuelDays.set((prev) => ({ ...prev, [d]: change(prev[d] ?? data.logs[d] ?? emptyDay(d)) }));
  /** Signed in: the change goes to the account, and the page re-reads once it is in. */
  const sync = (work: Promise<void>) => {
    work.catch((e: unknown) => setNotWired(e instanceof Error ? e.message : t("That did not work. Nothing was changed.")));
  };
  const go = (d: string) => setPicked(d >= today ? null : d);

  const days = daysEnding(day, RANGE_DAYS[range]);
  const rows = days.map((d): DayRow => {
    const b = burnOf(d);
    return { day: d, eaten: dayTotals(logOf(d)), burned: b ? burnedKcal(b) : null, targetKcal: targetsOf(d)?.kcal ?? null };
  });
  const origin = synced ? "synced" : (range === "day" ? saved[day] != null : days.some((d) => saved[d] != null)) ? "browser" : "sample";

  const yesterday = shiftDay(day, -1);
  const title = range === "week" ? t("7 days") : range === "month" ? t("30 days") : isToday ? t("Today") : day === shiftDay(today, -1) ? t("Yesterday") : weekday(day, "long");
  const dateText = range === "day" ? shortDate(day) : `${monthDay(days[0])} – ${monthDay(day)}`;

  const weight = body.status === "ready"
    ? mergeMeasurements(body.data.measurements, body.origin === "synced" ? body.data.own ?? [] : ownWeights).at(-1)?.weightKg
    : undefined;
  const note = data.notes[day];
  const copyDisabled = isToday ? foodCount(logOf(yesterday)) === 0 : foodCount(log) === 0;

  return (
    <main className="page" style={{ gap: 28 }}>
      <div className="page-head">
        <div className="fuel-title">
          <h1>{title}</h1>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--sand)" }}>{dateText}</span>
          <span className="fuel-daynav">
            <button type="button" className="step" aria-label={t("Previous day")} onClick={() => go(shiftDay(day, -1))}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button type="button" className="step" aria-label={t("Next day")} disabled={isToday} onClick={() => go(shiftDay(day, 1))}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M9 5l7 7-7 7" /></svg>
            </button>
            {isToday ? null : <Button variant="plain" onClick={() => setPicked(null)}>{t("Today")}</Button>}
          </span>
        </div>
        <div className="actions" style={{ gap: 14 }}>
          <OriginBadge origin={origin} />
          <Segmented label={t("Range")} value={range} onChange={setRange} options={[{ value: "day", label: t("Day") }, { value: "week", label: t("Week") }, { value: "month", label: t("Month") }]} />
          <div className="fuel-bar">
            <button type="button" className="add" onClick={() => setDialog({ kind: "add", meal: mealForNow(isToday) })}>{t("+ Add food")}</button>
            <button type="button" onClick={() => setEstimate({ meal: mealForNow(isToday), withPhoto: false })}>{t("Describe a meal")}</button>
            <i aria-hidden="true" />
            <button type="button" onClick={() => setEstimate({ meal: mealForNow(isToday), withPhoto: true })}>{t("Upload a photo")}</button>
          </div>
        </div>
      </div>

      {notWired ? (
        <p className="notice" role="status" style={{ margin: 0, justifyContent: "space-between" }}>
          <span>{notWired}</span>
          <Button variant="plain" onClick={() => setNotWired(null)}>{t("Dismiss")}</Button>
        </p>
      ) : null}

      {synced && data.targets == null ? <p className="notice" style={{ margin: 0 }}>{t("Set up Fuel in the phone app to see your targets.")}</p> : null}

      {range === "day" ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "28px 48px" }}>
            <Calories eatenKcal={eaten.kcal} targetKcal={targets?.kcal ?? null} burn={burn} sampleBurn={origin === "browser"} />
            <div style={{ flex: "2 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              {note ? (
                <p style={{ margin: 0, padding: "12px 16px", borderRadius: 14, background: "rgba(83,203,161,0.10)", fontSize: 14 }}>
                  <strong>{note.title}</strong>&nbsp;&nbsp;{note.detail}
                </p>
              ) : null}
              <Macros eaten={eaten} targets={targets} />
            </div>
          </div>

          <section aria-label={t("Meals")} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t("Meals")}</h2>
              <Button variant="plain" style={{ fontSize: 14 }} disabled={copyDisabled}
                onClick={() => {
                  if (synced) { sync(copySyncedDay(isToday ? yesterday : day, today)); setPicked(null); }
                  else if (isToday) edit(day, (l) => copyFoods(logOf(yesterday), l, newId));
                  else { edit(today, (l) => copyFoods(log, l, newId)); setPicked(null); }
                }}>
                {isToday ? t("Same as yesterday") : t("Copy to today")}
              </Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {MEAL_KEYS.map((meal) => (
                <MealTile key={meal} meal={meal} foods={log.meals[meal]} targetKcal={targets ? mealTargetKcal(meal, targets.kcal) : null}
                  idea={data.idea?.day === day && data.idea.meal === meal ? data.idea.food : undefined}
                  onAdd={(suggestion) => setDialog({ kind: "add", meal, suggestion })}
                  onEdit={(food) => setDialog({ kind: "edit", meal, food })} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <DaysTable rows={rows} today={today} onOpen={(d) => { go(d); setRange("day"); }} />
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 20 }}>
        <EatenBurned rows={rows} today={today} />
        <section aria-label={t("Body and goal")} style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="card fuel-side" href="/body" style={{ borderRadius: 18 }}>
            <span style={{ fontWeight: 600 }}>{t("Body and goal")}</span>
            <span className="muted">{[weight == null ? null : `${oneOrTwo(weight)} kg`, targets ? `${thousands(targets.kcal)} kcal` : null].filter(Boolean).join(" · ")}</span>
          </Link>
          {data.tastes == null ? null : (
            <div className="card fuel-side" style={{ borderRadius: 18 }}>
              <span style={{ fontWeight: 600 }}>{t("Your tastes")}</span>
              <span className="muted">{data.tastes}</span>
            </div>
          )}
          {data.coach && data.coach.day === day && saved[day] == null ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderRadius: 18, background: "rgba(240,176,44,0.10)", border: "1px solid rgba(240,176,44,0.22)" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--h-amber-ink)" }}>{t("Coach on fuel")}</span>
              <span style={{ fontSize: 14, lineHeight: "21px" }}>{data.coach.text}</span>
            </div>
          ) : null}
        </section>
      </div>

      {estimate ? (
        <EstimateDialog meal={estimate.meal} withPhoto={estimate.withPhoto} onClose={() => setEstimate(null)}
          onAdd={(meal, food) => (synced ? sync(addSyncedFood(day, meal, food, { from: "own" })) : edit(day, (l) => addFood(l, meal, food)))} />
      ) : null}
      {dialog ? (
        <FoodDialog state={dialog} foods={data.foods} newId={newId} onClose={() => setDialog(null)}
          onAdd={(meal, food, added) => (synced ? sync(addSyncedFood(day, meal, food, added)) : edit(day, (l) => addFood(l, meal, food)))}
          onChange={(meal, id, amount) => (synced ? sync(changeSyncedAmount(id, amount)) : edit(day, (l) => changeAmount(l, meal, id, amount)))}
          onRemove={(meal, id) => (synced ? sync(removeSyncedFood(id)) : edit(day, (l) => removeFood(l, meal, id)))} />
      ) : null}
    </main>
  );
}

/** The petal dial with what's left inside, and eaten, resting and active under it. */
function Calories({ eatenKcal, targetKcal: target, burn, sampleBurn }: { eatenKcal: number; targetKcal: number | null; burn: DayBurn | null; sampleBurn: boolean }) {
  const targetKcal = target ?? 0, active = burn?.active ?? 0;
  const d = target == null ? { filled: 0, moved: 0, over: false, count: DIAL_PETALS } : dial(eatenKcal, targetKcal, active);
  const left = target == null ? eatenKcal : Math.round(remaining(targetKcal, eatenKcal).left);
  const words = target == null ? t("{n} kcal eaten", { n: thousands(eatenKcal) }) : left >= 0 ? t("{n} kcal left", { n: thousands(Math.abs(left)) }) : t("{n} kcal over", { n: thousands(Math.abs(left)) });
  const percent = targetKcal > 0 ? Math.round((eatenKcal / targetKcal) * 100) : 0;
  const stat = (value: string, label: string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <CountUp className="num" style={{ fontSize: 22, fontWeight: 800 }} text={value} />
      <span className="soft" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color }} />{label}
      </span>
    </div>
  );
  return (
    <section aria-label={t("Calories")} style={{ flex: "1 1 340px", maxWidth: 420, minWidth: 0, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div className="fuel-readout dial" tabIndex={0} role="group" aria-label={t("Calories eaten against the target")} style={{ width: "100%", maxWidth: 320, borderRadius: 999 }}>
        <PetalDial filled={d.filled} moved={d.moved} count={d.count}
          label={target == null ? words : t("{words} of a {target} kcal target; {filled} of {count} petals filled", { words, target: thousands(targetKcal), filled: d.filled, count: d.count })}>
          <CountUp className="num" style={{ fontSize: 52, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1 }} text={thousands(Math.abs(left))} />
          <span style={{ fontSize: 15, fontWeight: 700, color: d.over ? "var(--h-rose-ink)" : "var(--h-amber-ink)" }}>{target == null ? t("kcal eaten") : d.over ? t("kcal over") : t("kcal left")}</span>
          {target == null ? null : <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Target {n} kcal", { n: thousands(targetKcal) })}</span>}
        </PetalDial>
        {target == null ? null : (
          <span className="tip" role="tooltip">
            {t("{eaten} of {target} kcal eaten", { eaten: thousands(eatenKcal), target: thousands(targetKcal) })} · {percent}%{d.moved > 0 ? ` · ${t("{n} kcal from moving", { n: thousands(active) })}` : ""}
          </span>
        )}
      </div>
      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", paddingTop: 14, borderTop: "1px solid rgba(var(--fg-rgb), 0.09)", textAlign: "center" }}>
        {stat(thousands(eatenKcal), t("Eaten"), "var(--h-gold)")}
        {stat(burn ? thousands(burn.resting) : "—", tx("energy", "Resting"), "var(--h-orange)")}
        {stat(burn ? signed(burn.active).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—", tx("energy", "Active"), "var(--h-mint)")}
      </div>
      {sampleBurn ? <span className="origin" data-origin="sample">{t("Resting, Active and the target: sample data")}</span> : null}
    </section>
  );
}

const MACROS = [
  { key: "protein", name: msg("Protein"), color: "var(--h-rose)" },
  { key: "carbs", name: msg("Carbs"), color: "var(--h-mint)" },
  { key: "fat", name: msg("Fat"), color: "var(--h-orange)" },
  { key: "fiber", name: msg("Fiber"), color: "var(--h-violet)" },
] as const;

const EXTRAS = [
  { key: "sugar", name: msg("Sugar"), unit: "g" },
  { key: "satFat", name: msg("Saturated fat"), unit: "g" },
  { key: "sodium", name: msg("Sodium"), unit: "mg" },
  { key: "cholesterol", name: msg("Cholesterol"), unit: "mg" },
] as const;

function Macros({ eaten, targets }: { eaten: ReturnType<typeof dayTotals>; targets: Targets | null }) {
  const share = macroPercents(eaten);
  return (
    <Card clip aria-label={t("Macros")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, padding: "22px 16px 18px" }}>
        {MACROS.map((m) => {
          const target = targets?.[m.key] ?? null, r = remaining(target ?? 0, eaten[m.key]);
          const gap = target == null ? "" : r.over ? t("{n} g over", { n: trim(r.gap) }) : t("{n} g left", { n: trim(r.gap) });
          const energy = m.key === "fiber" ? "" : ` · ${t("{n}% of energy", { n: Math.round(share[m.key]) })}`;
          const name = t(m.name);
          return (
            <div key={m.key} className="fuel-readout" tabIndex={0} role="group" aria-label={target == null ? `${name}: ${trim(eaten[m.key])} g` : `${name}: ${t("{eaten} g of {target} g", { eaten: trim(eaten[m.key]), target: trim(target) })}, ${gap}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ width: 114, height: 69 }}><PetalFan lit={target == null ? 0 : petalsLit(r.progress, eaten[m.key] >= 0.5, FAN_PETALS)} color={m.color} /></div>
              <CountUp className="num" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }} text={`${trim(eaten[m.key])} g`} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
              <span className="muted" style={{ fontSize: 12, color: r.over ? "var(--h-rose-ink)" : undefined }}>{gap}</span>
              {target == null ? null : <span className="tip" role="tooltip">{t("{eaten} of {target} g", { eaten: trim(eaten[m.key]), target: trim(target) })} · {Math.round(r.progress * 100)}%{energy}</span>}
            </div>
          );
        })}
      </div>
      <div className="fuel-extras">
        {EXTRAS.map((x) => (
          <div key={x.key}>
            <span className="soft">{t(x.name)}</span>
            <span style={{ fontWeight: 600 }}>{trim(eaten[x.key])} {x.unit}{targets?.[x.key] == null ? null : <> <span className="muted" style={{ fontWeight: 500 }}>{t("of {n}", { n: trim(targets[x.key]!) })}</span></>}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MealTile({ meal, foods, targetKcal, idea, onAdd, onEdit }: {
  meal: MealKey; foods: LoggedFood[]; targetKcal: number | null; idea?: LoggedFood;
  onAdd: (suggestion?: LoggedFood) => void; onEdit: (food: LoggedFood) => void;
}) {
  const look = MEAL_LOOK[meal];
  const kcal = mealTotals(foods).kcal;
  const started = foods.length > 0;
  const name = t(MEAL_NAME[meal]);
  return (
    <article className="fuel-meal" style={{
      background: `radial-gradient(circle 240px at 0 0, rgba(${look.rgb},var(--fuel-glow)), transparent), var(--fuel-tile-base)`,
      border: `1px solid rgba(${look.rgb},${started ? 0.4 : 0.16})`,
    }}>
      {started ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3>{look.icon}{name}</h3>
          <button type="button" className="fuel-plus" aria-label={t("Add to {meal}", { meal: name.toLowerCase() })} style={{ background: `rgba(${look.rgb},0.22)`, color: look.ink }} onClick={() => onAdd()}>+</button>
        </div>
      ) : <h3 style={{ height: 32 }}>{look.icon}{name}</h3>}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <CountUp className="num" style={{ fontSize: 32, fontWeight: 900, lineHeight: 1, color: started ? undefined : "var(--dim)" }} text={thousands(kcal)} />
        <span className="muted" style={{ fontSize: 12 }}>{targetKcal == null ? "kcal" : t("of {n} kcal", { n: thousands(targetKcal) })}</span>
      </div>
      <PetalRow lit={targetKcal == null ? 0 : petalsLit(targetKcal > 0 ? kcal / targetKcal : 0, kcal >= 0.5, ROW_PETALS)} color={look.hue} />
      {started ? (
        <div style={{ display: "flex", flexDirection: "column", margin: "0 -6px" }}>
          {foods.map((f) => {
            const label = foodLabel(f), k = thousands(foodNutrients(f).kcal);
            return (
              <button key={f.id} type="button" className="fuel-food" aria-label={t("{food}, {kcal} kcal. Change or remove", { food: label, kcal: k })} onClick={() => onEdit(f)}>
                <span>{label}</span><span>{k}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {idea ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 14, background: "rgba(var(--fg-rgb), 0.07)", fontSize: 13 }}>
              <span className="muted">{t("Idea from your kitchen")}</span>
              <span style={{ fontWeight: 600 }}>{foodLabel(idea)} · {thousands(foodNutrients(idea).kcal)} kcal</span>
            </div>
          ) : null}
          <button type="button" className="fuel-add-big" aria-label={t("Add to {meal}", { meal: name.toLowerCase() })} style={{ background: `rgba(${look.rgb},0.16)`, color: look.ink }} onClick={() => onAdd(idea)}>{t("+ Add")}</button>
        </>
      )}
    </article>
  );
}

/** `burned` is null on a day with no calories from the watch, `targetKcal` when Fuel isn't set up. */
interface DayRow { day: string; eaten: ReturnType<typeof dayTotals>; burned: number | null; targetKcal: number | null }

/** Week and Month: one row a day, newest first. A row opens its day. */
function DaysTable({ rows, today, onOpen }: { rows: DayRow[]; today: string; onOpen: (day: string) => void }) {
  const cols = "minmax(120px, 1.4fr) repeat(7, minmax(64px, 1fr))";
  return (
    <Card clip aria-label={t("Days")}>
      <div className="scroll-x">
        <div role="table" style={{ minWidth: 700 }}>
          <div role="row" className="thead" style={{ gridTemplateColumns: cols }}>
            {[msg("Day"), msg("Eaten"), msg("Of target"), msg("Burned"), msg("Protein"), msg("Carbs"), msg("Fat"), msg("Fiber")].map((h, k) => (
              <span key={h} role="columnheader" style={{ textAlign: k ? "right" : "left" }}>{t(h)}</span>
            ))}
          </div>
          {[...rows].reverse().map((r) => {
            const right = { textAlign: "right" } as const;
            return (
              <div key={r.day} role="row" className="row" style={{ gridTemplateColumns: cols }}>
                <span role="cell"><button type="button" className="sort-btn" style={{ fontWeight: 600, minHeight: 36 }} onClick={() => onOpen(r.day)}>{r.day === today ? t("Today") : shortDate(r.day)}</button></span>
                <span role="cell" style={{ ...right, fontWeight: 600 }}>{thousands(r.eaten.kcal)}</span>
                <span role="cell" className="muted" style={right}>{r.targetKcal != null && r.targetKcal > 0 ? `${Math.round((r.eaten.kcal / r.targetKcal) * 100)}%` : ""}</span>
                <span role="cell" style={right}>{r.burned == null ? "—" : thousands(r.burned)}</span>
                <span role="cell" style={right}>{trim(r.eaten.protein)} g</span>
                <span role="cell" style={right}>{trim(r.eaten.carbs)} g</span>
                <span role="cell" style={right}>{trim(r.eaten.fat)} g</span>
                <span role="cell" style={right}>{trim(r.eaten.fiber)} g</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

const CHART_W = 420, CHART_H = 170;

/** Eaten as bars and burned as a line, a day to a column, with a readout for the day under the pointer or the arrow keys. */
function EatenBurned({ rows, today }: { rows: DayRow[]; today: string }) {
  const [at, setAt] = useState<number | null>(null);
  const n = rows.length;
  const top = Math.max(3000, Math.ceil(Math.max(...rows.map((r) => Math.max(r.eaten.kcal, r.burned ?? 0))) / 500) * 500);
  const slot = CHART_W / n, bar = (slot * 32) / 60, rad = Math.min(4, bar / 2);
  const y = (v: number) => CHART_H - (v / top) * CHART_H;
  const bars = rows.map((r, k) => {
    const h = (r.eaten.kcal / top) * CHART_H;
    if (h < rad) return "";
    const x = k * slot + (slot - bar) / 2;
    return `M${x.toFixed(1)} ${(CHART_H - h + rad).toFixed(1)}q0 -${rad} ${rad} -${rad}h${(bar - 2 * rad).toFixed(1)}q${rad} 0 ${rad} ${rad}v${(h - rad).toFixed(1)}h-${bar.toFixed(1)}z`;
  }).join(" ");
  // A day with no burn breaks the line; a day with burn on neither side is drawn as a short dash.
  const line = rows.map((r, k) => {
    if (r.burned == null) return "";
    const x = k * slot + slot / 2, at = `${x.toFixed(1)} ${y(r.burned).toFixed(1)}`;
    const joined = k > 0 && rows[k - 1].burned != null, alone = !joined && rows[k + 1]?.burned == null;
    return alone ? `M${(x - bar / 2).toFixed(1)} ${y(r.burned).toFixed(1)}h${bar.toFixed(1)}` : `${joined ? "L" : "M"}${at}`;
  }).join(" ");
  const average = mean(rows.map((r) => r.eaten.kcal));
  const shown = at == null ? null : rows[Math.min(at, n - 1)];
  const every = n > 10 ? 5 : 1;

  const onKey = (e: KeyboardEvent) => {
    const cur = at ?? n - 1;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (e.key === "Escape") { setAt(null); return; }
    if (next == null) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(n - 1, next)));
  };
  const readout = shown ? `${shown.day === today ? t("Today") : shortDate(shown.day)} · ${shown.burned == null ? t("Eaten {n} kcal", { n: thousands(shown.eaten.kcal) }) : t("Eaten {eaten} · Burned {burned} kcal", { eaten: thousands(shown.eaten.kcal), burned: thousands(shown.burned) })}` : "";
  const leftPct = at == null ? 0 : ((Math.min(at, n - 1) + 0.5) / n) * 100;

  return (
    <Card pad aria-label={t("Eaten and burned")} style={{ flex: "2 1 520px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px 20px" }}>
        <h2 className="h2">{t("Eaten and burned")}</h2>
        <div className="muted" style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 13 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: "var(--h-gold)" }} />{t("Eaten")}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 2, background: "var(--soft)" }} />{t("Burned")}</span>
          <span>{tr("Average {amount}", { amount: <strong style={{ color: "var(--fg)" }}>{t("{n} kcal a day", { n: thousands(average) })}</strong> })}</span>
        </div>
      </div>
      <div className="fuel-chart" tabIndex={0} role="group" aria-label={t("Eaten and burned by day. Left and right arrows read each day.")}
        onKeyDown={onKey} onFocus={() => setAt((a) => a ?? n - 1)} onBlur={() => setAt(null)}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / (r.width || 1)) * n)))); }}
        onPointerLeave={() => setAt(null)}>
        <svg role="img" aria-label={t("Calories eaten each day as bars with calories burned as a line, {from} to {to}; average eaten {n} kcal a day", { from: shortDate(rows[0].day), to: shortDate(rows[n - 1].day), n: thousands(average) })}
          width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" style={{ display: "block" }}>
          <path d={`M0 ${(CHART_H / 3).toFixed(1)}H${CHART_W}M0 ${((CHART_H * 2) / 3).toFixed(1)}H${CHART_W}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.07)", vectorEffect: "non-scaling-stroke" }} />
          <path d={bars} style={{ fill: "var(--h-gold)" }} />
          <path d={line} fill="none" style={{ stroke: "var(--soft)", strokeWidth: 2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
        </svg>
        {shown ? (
          <>
            <span className="mark" aria-hidden="true" style={{ left: `${leftPct}%` }} />
            <span className="tip" aria-hidden="true" style={{ left: `clamp(140px, ${leftPct}%, calc(100% - 140px))` }}>{readout}</span>
          </>
        ) : null}
        <span className="sr-only" aria-live="polite">{readout}</span>
      </div>
      <div className="muted" style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, fontSize: 12, textAlign: "center" }}>
        {rows.map((r, k) => {
          const isToday = r.day === today;
          const text = n <= 10 ? (isToday ? t("Today") : weekday(r.day, "short")) : (n - 1 - k) % every === 0 ? String(parseDay(r.day).getDate()) : "";
          return <span key={r.day} style={isToday ? { color: "var(--fg)", fontWeight: 600 } : undefined}>{text}</span>;
        })}
      </div>
    </Card>
  );
}
