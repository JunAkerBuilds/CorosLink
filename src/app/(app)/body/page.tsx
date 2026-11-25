"use client";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { BodyAgeArc } from "@/components/viz/BodyAgeArc";
import { Pearl } from "@/components/viz/Pearl";
import { Button, Card, Field, OriginBadge, Segmented, Select, CountUp } from "@/components/ui";
import {
  deleteSyncedMeasurement, GOAL_LABEL, loadBody, saveSyncedMeasurement, saveSyncedProfile,
  type BodyData, type BodyProfile, type GoalKind, type Hue, type OwnMeasurement, type ProfileEdit,
} from "@/data/body";
import { useLoaded } from "@/data/core";
import { loadBodyAlert } from "@/data/bodyAlert";
import { LOOK_ADVICE, LOOK_HUE, LOOK_TITLE, SIGNALS, isOff, lastNight, lookOf, signalChange, signalTitle, signalValue, type BodyAlertData, type Look } from "@/lib/bodyAlert";
import { NO_EDIT, NO_MEASUREMENTS, ownMeasurements, profileEdit } from "@/data/local/body";
import { useToday } from "@/data/local/fuel";
import { useStore } from "@/data/local/store";
import {
  ageDifference, bmi, bmiBand, daysBetween, deleteMeasurement, goalProgress, isDay, leanMass, mergeMeasurements, monthlyAverages,
  nearestIndex, oneOrTwo, rangeStart, resample, saveMeasurement, series, shiftDay, spark, trend, weeksToGoal, weightDomain, within,
  xAt, yAt, type Entry, type Point, type Range,
} from "@/lib/body";
import { parseDay, signed, thousands } from "@/lib/format";
import { parseAmount } from "@/lib/fuel";
import { Dialog } from "../fuel/Dialog";
import "./body.css";

const HUE: Record<Hue, string> = {
  rose: "var(--h-rose)", cyan: "var(--h-cyan)", sky: "var(--h-sky)", blue: "var(--h-blue)", mint: "var(--h-mint)", gold: "var(--h-gold)", violet: "var(--h-violet)",
};
const RANGES: readonly Range[] = ["1M", "3M", "1Y", "All"];
const RANGE_WORDS: Record<Range, string> = { "1M": "in 1 month", "3M": "in 3 months", "1Y": "in 1 year", All: "in all" };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const dayMonth = (day: string) => parseDay(day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fullDate = (day: string) => parseDay(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthDay = (day: string) => parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthYear = (month: string) => parseDay(`${month}-01`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

export default function BodyPage() {
  const body = useLoaded(loadBody);
  const alert = useLoaded(loadBodyAlert);
  if (body.status === "loading") return <main className="page"><div className="skeleton" style={{ minHeight: 420 }} /></main>;
  if (body.status === "error") return <main className="page"><p className="notice" role="alert">Body could not be loaded. {body.error.message}</p></main>;
  return <Body data={body.data} synced={body.origin === "synced"} alert={alert.status === "ready" ? alert.data.alert : null} />;
}

/** Body Alert's Tonight: the phone's state and last night's three signals, when the phone has sent them. */
function tonightFrom(alert: BodyAlertData | null) {
  if (!alert || !alert.on) return null;
  const look = lookOf(alert.state), night = lastNight(alert);
  const signals = SIGNALS.flatMap((sig) => {
    const r = night?.signals.find((x) => x.signal === sig);
    if (!r) return [];
    const values = alert.nights.slice(-14).map((n) => n.signals.find((x) => x.signal === sig)).filter((x) => x != null).map((x) => (sig === "hrv" ? Math.exp(x.value) : x.value));
    return [{
      name: signalTitle(r), detail: `${signalValue(r, r.value)} · Usual ${signalValue(r, r.usual)}`,
      pill: look === "learning" ? "Learning" : isOff(r) ? signalChange(r) : "Usual", off: look !== "learning" && isOff(r),
      hue: (sig === "heart" ? "rose" : sig === "hrv" ? "cyan" : "sky") as Hue, values,
    }];
  });
  return { look, signals };
}

const AURA: Record<Look, string> = { learning: "var(--h-cyan)", clear: "var(--h-mint)", watch: "var(--h-gold)", alert: "var(--h-rose)", settling: "var(--h-violet)" };

interface TileData { name: string; value: string; unit: string; note: string; hue: Hue; values: number[] }

/** `synced`: signed in, so measurements and profile edits are the account's and are written to it instead of this browser. */
function Body({ data, synced, alert }: { data: BodyData; synced: boolean; alert: BodyAlertData | null }) {
  const tonight = tonightFrom(alert);
  const paused = tonight?.look === "alert" || tonight?.look === "settling";
  const today = useToday();
  const saved = useStore(ownMeasurements, NO_MEASUREMENTS);
  const savedEdit = useStore(profileEdit, NO_EDIT);
  const [dialog, setDialog] = useState<"measure" | "profile" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const own = synced ? data.own ?? NO_MEASUREMENTS : saved;
  const edited = synced ? NO_EDIT : savedEdit;
  /** Signed in: the change goes to the account, and the page re-reads once it is in. */
  const sync = (work: Promise<void>) => {
    work.catch((e: unknown) => setFailed(e instanceof Error ? e.message : "That did not work. Nothing was changed."));
  };
  const profile: BodyProfile = { ...data.profile, ...edited };
  const height = profile.heightCm;
  const entries = mergeMeasurements(data.measurements, own);
  const latest = entries.at(-1);
  const end = latest && latest.day > today ? latest.day : today;
  const from3 = rangeStart("3M", end);
  const recent = (metric: Parameters<typeof series>[1]) => (metric === "bmi" && height == null ? [] : within(series(entries, metric, height ?? 0), from3, end));
  const weight3 = recent("weight"), fat3 = recent("bodyFat"), lean3 = recent("lean"), bmi3 = recent("bmi");
  const last = (points: Point[]) => points.at(-1)?.value;
  const change = (points: Point[], unit: string) => { const t = trend(points); return t == null ? "" : `${signed(t, 1)}${unit} · 3M`; };

  // Breathing rate isn't in the daily readings; the phone sends it with Body Alert's nights.
  const breathing = alert?.nights.map((n) => n.signals.find((x) => x.signal === "breathing")?.value).filter((v): v is number => v != null) ?? [];
  const stats: TileData[] = [...data.stats];
  if (breathing.length && !stats.some((t) => t.name === "Breathing")) {
    const at = stats.findIndex((t) => t.name === "HRV");
    const first = breathing.slice(0, 7), lastWeek = breathing.slice(-7);
    const change = lastWeek.reduce((p, v) => p + v, 0) / lastWeek.length - first.reduce((p, v) => p + v, 0) / first.length;
    stats.splice(at < 0 ? stats.length : at + 1, 0, {
      name: "Breathing", value: breathing.at(-1)!.toFixed(1), unit: "a minute", note: Math.abs(change) < 0.3 ? "Steady" : `${signed(change, 1)} in 4 weeks`, hue: "sky", values: resample(breathing, 14),
    });
  }
  const tiles: TileData[] = [
    ...stats,
    { name: "Weight", value: latest ? oneOrTwo(latest.weightKg) : "—", unit: "kg", note: change(weight3, " kg"), hue: "mint", values: resample(weight3.map((p) => p.value), 14) },
    { name: "Body fat", value: last(fat3) == null ? "—" : oneOrTwo(last(fat3)!), unit: "%", note: change(fat3, ""), hue: "gold", values: resample(fat3.map((p) => p.value), 14) },
    { name: "Lean body mass", value: last(lean3)?.toFixed(1) ?? "—", unit: "kg", note: change(lean3, " kg"), hue: "mint", values: resample(lean3.map((p) => p.value), 14) },
    { name: "BMI", value: latest && height != null ? bmi(latest.weightKg, height).toFixed(1) : "—", unit: "", note: latest && height != null ? bmiBand(bmi(latest.weightKg, height)) : "", hue: "violet", values: resample(bmi3.map((p) => p.value), 14) },
  ];

  const origin = synced ? "synced" : own.length > 0 || Object.keys(edited).length > 0 ? "browser" : "sample";
  const age = data.bodyAge;
  const asOf = [age?.asOf ? `Body age as of ${monthDay(age.asOf)}` : null, age?.nextUpdate ? `next update ${age.nextUpdate}` : null].filter(Boolean).join(" · ");

  return (
    <main className="page" style={{ gap: 32 }}>
      {failed ? (
        <p className="notice" role="alert" style={{ margin: 0, justifyContent: "space-between" }}>
          <span>{failed}</span>
          <Button variant="plain" onClick={() => setFailed(null)}>Dismiss</Button>
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "24px 56px", ...(tonight ? { ["--aura" as string]: AURA[tonight.look], ["--aura-mote" as string]: AURA[tonight.look] } : {}) }}>
        <Pearl label="Body age" arc={age && profile.age != null ? (
          <BodyAgeArc age={profile.age} bodyAge={age.value}
            label={`Body age ${age.value.toFixed(1)}, shown on an arc from ${profile.age - 5} to ${profile.age + 5} with your age ${profile.age} at the bottom`} />
        ) : undefined}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", color: "rgba(255,255,255,0.92)", textShadow: "0 1px 4px rgba(0,0,0,0.35)" }}>BODY AGE</span>
          <CountUp className="num" style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, textShadow: "0 2px 10px rgba(0,0,0,0.35)" }} text={age ? age.value.toFixed(1) : "—"} />
          {paused ? (
            <span className="body-paused"><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="3" height="8" rx="1" fill="currentColor" /><rect x="6" y="1" width="3" height="8" rx="1" fill="currentColor" /></svg>Paused</span>
          ) : age && profile.age != null ? <span style={{ fontSize: 13, fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}>{ageDifference(age.value, profile.age)}</span> : null}
        </Pearl>

        <section aria-label="Tonight" style={{ flex: "1 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", color: "var(--h-mint-soft-ink)" }}>{tonight ? "TONIGHT · BODY ALERT" : "TONIGHT"}</span>
              <span className="actions">
                <OriginBadge origin={origin} />
                <Button onClick={() => setDialog("measure")}>Add a measurement</Button>
              </span>
            </div>
            {tonight || data.headline ? (
              <h1 className="num body-headline" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-0.01em", color: tonight && tonight.look !== "clear" ? `var(--h-${LOOK_HUE[tonight.look]}-ink)` : undefined }}>
                {tonight ? LOOK_TITLE[tonight.look] : data.headline}
              </h1>
            ) : null}
            {asOf ? <span style={{ fontSize: 13, color: "var(--mint-grey)" }}>{asOf}</span> : null}
          </div>
          <Card clip>
            {(tonight ? tonight.signals : data.signals).map((s) => {
              const line = spark(s.values, 78, 26, 4)?.line ?? "";
              return (
                <div key={s.name} className="body-signal">
                  <svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34" style={{ flex: "none" }}>
                    <rect width="34" height="34" rx="11" style={{ fill: HUE[s.hue], opacity: 0.14 }} /><circle cx="17" cy="17" r="5" style={{ fill: HUE[s.hue] }} />
                  </svg>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{s.name}</span><span className="muted" style={{ fontSize: 13 }}>{s.detail}</span>
                  </span>
                  <svg aria-hidden="true" width="78" height="26" viewBox="0 0 78 26" style={{ flex: "none" }}>
                    <path d={line} fill="none" style={{ stroke: HUE[s.hue], strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
                  </svg>
                  {s.pill ? <span className={`body-pill${"off" in s && s.off ? " body-pill-off" : ""}`}>{s.pill}</span> : null}
                </div>
              );
            })}
            {(tonight ? tonight.signals : data.signals).length === 0 ? <div className="body-signal"><span className="muted" style={{ fontSize: 13 }}>Nothing from your phone yet</span></div> : null}
            <Link href="/body/alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", background: "rgba(83,203,161,0.08)", color: "var(--fg)", textDecoration: "none", fontSize: 13 }}>
              <span>{tonight ? LOOK_ADVICE[tonight.look].title : data.advice ?? ""}</span><span style={{ fontWeight: 600, color: "var(--h-mint-soft-ink)" }}>Nights ›</span>
            </Link>
          </Card>
        </section>
      </div>

      <section aria-label="Measurements" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(230px, 100%), 1fr))", gap: 14 }}>
        {tiles.map((t) => <Tile key={t.name} tile={t} />)}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 20 }}>
        <WeightChart entries={entries} end={end} goal={profile.goalWeightKg} />
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <Goal weight3={weight3} goal={profile.goalWeightKg} />
          <Card clip aria-label="You">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 8px" }}>
              <h2 className="h2">You</h2>
              <Button variant="plain" onClick={() => setDialog("profile")}>Edit</Button>
            </div>
            <div className="body-you"><span className="soft">Body weight</span><span style={{ fontWeight: 600 }}>{latest ? `${oneOrTwo(latest.weightKg)} kg` : "—"}</span></div>
            <div className="body-you"><span className="soft">Height</span><span style={{ fontWeight: 600 }}>{height == null ? "—" : `${oneOrTwo(height).replace(/\.0$/, "")} cm`}</span></div>
            <div className="body-you"><span className="soft">Age</span><span style={{ fontWeight: 600 }}>{profile.age ?? "—"}</span></div>
            <div className="body-you"><span className="soft">Goal</span><span style={{ fontWeight: 600 }}>{profile.goal ? GOAL_LABEL[profile.goal] : "—"}</span></div>
            <Link className="body-you" href="/fuel" style={{ minHeight: 52 }}>
              <span style={{ display: "flex", flexDirection: "column" }}><span className="soft">Resting energy</span><span className="muted" style={{ fontSize: 12 }}>Estimated from your numbers, used by Fuel</span></span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{profile.restingKcal == null ? "—" : `${thousands(profile.restingKcal)} kcal`}</span>
            </Link>
          </Card>
        </div>
      </div>

      {own.length > 0 ? (
        <OwnTable own={own} heightCm={height}
          onDelete={(id) => (synced ? sync(deleteSyncedMeasurement(id)) : ownMeasurements.set((list) => deleteMeasurement(list, id)))} />
      ) : null}

      {dialog === "measure" ? (
        <MeasureDialog today={today} own={own} onClose={() => setDialog(null)}
          onSave={(m) => (synced ? sync(saveSyncedMeasurement(m)) : ownMeasurements.set((list) => saveMeasurement(list, m)))} />
      ) : null}
      {dialog === "profile" ? (
        <ProfileDialog profile={profile} synced={synced} onClose={() => setDialog(null)}
          onSave={(p) => (synced ? sync(saveSyncedProfile(p)) : profileEdit.set((prev) => ({ ...prev, ...p })))} />
      ) : null}
    </main>
  );
}

function Tile({ tile }: { tile: TileData }) {
  const s = spark(tile.values, 84, 44, 6);
  const color = HUE[tile.hue];
  return (
    <article className="tile body-tile">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <h2>{tile.name}</h2>
        <svg aria-hidden="true" width="92" height="44" viewBox="0 0 92 44" style={{ flex: "none", overflow: "visible" }}>
          {s ? (
            <>
              <path d={s.area} style={{ fill: color, opacity: 0.16 }} />
              <path d={s.line} fill="none" style={{ stroke: color, strokeWidth: 2.2, strokeLinejoin: "round", strokeLinecap: "round" }} />
              <circle cx="84" cy={s.endY.toFixed(1)} r="7" style={{ fill: color, opacity: 0.25 }} />
              <circle cx="84" cy={s.endY.toFixed(1)} r="3.5" style={{ fill: color }} />
              <circle cx="84" cy={s.endY.toFixed(1)} r="1.4" style={{ fill: "var(--fg)" }} />
            </>
          ) : null}
        </svg>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <span className="num" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
          <CountUp text={tile.value} /> <span className="muted" style={{ font: "500 13px var(--font-inter), Inter, sans-serif" }}>{tile.unit}</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mint-grey)", textAlign: "right" }}>{tile.note}</span>
      </div>
    </article>
  );
}

const W = 800, H = 220;

interface Dot { x: number; value: number; words: string }

/** Weight through time with the goal as a dashed line. 1M and 3M draw every weigh-in, 1Y and All the monthly averages. */
function WeightChart({ entries, end, goal }: { entries: Entry[]; end: string; goal: number | null }) {
  const [range, setRange] = useState<Range>("3M");
  const [at, setAt] = useState<number | null>(null);
  const start = rangeStart(range, end);
  const shown = within(entries.map((e) => ({ day: e.day, value: e.weightKg })), start, end);
  const ownDays = new Set(entries.filter((e) => e.own).map((e) => e.day));
  const monthly = range === "1Y" || range === "All";

  let dots: Dot[], labels: string[];
  if (monthly) {
    const months = monthlyAverages(shown);
    dots = months.map((m, i) => ({
      x: months.length === 1 ? W / 2 : (i * W) / (months.length - 1), value: m.value,
      words: `${monthYear(m.month)} · ${m.value.toFixed(2)} kg average of ${m.count}`,
    }));
    const picks = months.length <= 4 ? months.map((_, i) => i) : [0, 1, 2, 3].map((k) => Math.round((k * (months.length - 1)) / 3));
    labels = picks.map((i) => monthYear(months[i].month));
  } else {
    const first = start ?? shown[0]?.day ?? end;
    dots = shown.map((p) => ({ x: xAt(p.day, first, end, W), value: p.value, words: `${fullDate(p.day)} · ${oneOrTwo(p.value)} kg${ownDays.has(p.day) ? " · yours" : ""}` }));
    const span = daysBetween(first, end);
    labels = [0, 1, 2, 3].map((k) => dayMonth(shiftDay(first, Math.ceil((k * span) / 3))));
  }

  const [lo, hi] = weightDomain(dots.map((d) => d.value), goal);
  const y = (v: number) => yAt(v, lo, hi, H);
  const line = dots.map((d, i) => `${i ? "L" : "M"}${d.x.toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const area = dots.length > 1 ? `${line} L${dots[dots.length - 1].x.toFixed(1)} ${H} L${dots[0].x.toFixed(1)} ${H} Z` : "";
  const goalY = goal == null ? null : y(goal);
  const t = trend(shown);
  const latest = entries.at(-1);
  const n = dots.length;
  const cur = at == null || n === 0 ? null : dots[Math.min(at, n - 1)];

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setAt(null); return; }
    const from = at ?? n - 1;
    const next = e.key === "ArrowLeft" ? from - 1 : e.key === "ArrowRight" ? from + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next == null || n === 0) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(n - 1, next)));
  };

  const summary = n === 0
    ? "No weight measurements in this range"
    : `Weight from ${oneOrTwo(shown[0].value)} kg on ${fullDate(shown[0].day)} to ${oneOrTwo(shown[shown.length - 1].value)} kg on ${fullDate(shown[shown.length - 1].day)}${monthly ? ", as monthly averages" : ""}${goal == null ? "" : `, with the ${oneOrTwo(goal)} kg goal as a dashed line`}`;

  return (
    <Card pad aria-label="Weight trend" style={{ flex: "2 1 560px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px" }}>
          <h2 className="h2">Weight</h2>
          <CountUp className="num" style={{ fontSize: 22, fontWeight: 800 }} text={latest ? `${oneOrTwo(latest.weightKg)} kg` : "—"} />
          {t == null ? null : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--h-mint-soft-ink)" }}>{signed(t, 1)} kg {RANGE_WORDS[range]}</span>}
        </div>
        <Segmented small label="Range" value={range} onChange={(r) => { setRange(r); setAt(null); }} options={RANGES.map((r) => ({ value: r, label: r }))} />
      </div>
      <div className="body-chart" tabIndex={0} role="group" aria-label="Weight chart. Left and right arrows read each point."
        onKeyDown={onKey} onFocus={() => setAt((a) => a ?? Math.max(0, n - 1))} onBlur={() => setAt(null)}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(nearestIndex(dots.map((d) => d.x), ((e.clientX - r.left) / (r.width || 1)) * W)); }}
        onPointerLeave={() => setAt(null)}>
        <svg role="img" aria-label={summary} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
          <path d={`M0 55H${W}M0 110H${W}M0 165H${W}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.06)", vectorEffect: "non-scaling-stroke" }} />
          {goalY == null ? null : <path d={`M0 ${goalY.toFixed(1)}H${W}`} fill="none" style={{ stroke: "var(--h-gold)", strokeWidth: 1.5, strokeDasharray: "4 6", vectorEffect: "non-scaling-stroke" }} />}
          <path d={area} style={{ fill: "rgba(83,203,161,0.14)" }} />
          <path d={line} fill="none" style={{ stroke: "var(--h-mint)", strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round", vectorEffect: "non-scaling-stroke" }} />
        </svg>
        {n === 1 ? <span className="dot" aria-hidden="true" style={{ left: `${(dots[0].x / W) * 100}%`, top: y(dots[0].value) }} /> : null}
        {cur ? (
          <>
            <span className="mark" aria-hidden="true" style={{ left: `${(cur.x / W) * 100}%` }} />
            <span className="dot" aria-hidden="true" style={{ left: `${(cur.x / W) * 100}%`, top: y(cur.value) }} />
            <span className="tip" aria-hidden="true" style={{ left: `clamp(100px, ${(cur.x / W) * 100}%, calc(100% - 100px))` }}>{cur.words}</span>
          </>
        ) : null}
        <span className="sr-only" aria-live="polite">{cur?.words ?? ""}</span>
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
      </div>
    </Card>
  );
}

function Goal({ weight3, goal }: { weight3: Point[]; goal: number | null }) {
  const first = weight3[0], last = weight3.at(-1);
  const gap = last && goal != null ? Math.abs(last.value - goal) : null;
  const change = trend(weight3);
  const weeks = first && last && change != null && goal != null ? weeksToGoal(last.value, goal, change, daysBetween(first.day, last.day)) : null;
  const progress = first && last && goal != null ? goalProgress(first.value, last.value, goal) : 0;
  const words = goal == null ? "No goal weight yet"
    : gap == null ? "No weight measured yet"
    : gap < 0.05 ? "Goal reached"
    : `${gap.toFixed(1)} kg to go${weeks == null ? "" : ` · about ${Math.max(1, Math.round(weeks))} week${Math.round(weeks) > 1 ? "s" : ""} at this pace`}`;
  return (
    <section aria-label="Goal" style={{ padding: "18px 20px", borderRadius: 22, background: "rgba(216,155,34,0.10)", border: "1px solid rgba(216,155,34,0.24)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h2 className="h2">Goal</h2>
        <CountUp className="num" style={{ fontSize: 22, fontWeight: 800, color: "var(--h-amber-soft-ink)" }} text={goal == null ? "—" : `${oneOrTwo(goal)} kg`} />
      </div>
      <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: "rgba(var(--fg-rgb), 0.1)" }}>
        <div className="cl-bar" style={{ width: `${Math.round(progress * 100)}%`, height: 8, borderRadius: 999, background: "var(--h-gold)" }} />
      </div>
      <span className="soft" style={{ fontSize: 13 }}>{words}</span>
    </section>
  );
}

/** The person's own measurements, newest first, each with a Delete. */
function OwnTable({ own, heightCm, onDelete }: { own: OwnMeasurement[]; heightCm: number | null; onDelete: (id: string) => void }) {
  const cols = "minmax(120px, 1.4fr) repeat(4, minmax(80px, 1fr)) 88px";
  const right = { textAlign: "right" } as const;
  return (
    <Card clip aria-label="Your measurements">
      <h2 className="h2" style={{ padding: "14px 18px 8px" }}>Your measurements</h2>
      <div className="scroll-x">
        <div role="table" style={{ minWidth: 620 }}>
          <div role="row" className="thead" style={{ gridTemplateColumns: cols }}>
            {["Date", "Weight", "Body fat", "Lean body mass", "BMI", ""].map((h, k) => <span key={k} role="columnheader" style={k ? right : undefined}>{h}</span>)}
          </div>
          {[...own].reverse().map((m) => (
            <div key={m.id} role="row" className="row" style={{ gridTemplateColumns: cols }}>
              <span role="cell" style={{ fontWeight: 600 }}>{fullDate(m.day)}</span>
              <span role="cell" style={right}>{oneOrTwo(m.weightKg)} kg</span>
              <span role="cell" style={right}>{m.bodyFatPct == null ? "—" : `${oneOrTwo(m.bodyFatPct)}%`}</span>
              <span role="cell" style={right}>{m.bodyFatPct == null ? "—" : `${leanMass(m.weightKg, m.bodyFatPct).toFixed(1)} kg`}</span>
              <span role="cell" style={right}>{heightCm == null ? "—" : bmi(m.weightKg, heightCm).toFixed(1)}</span>
              <span role="cell" style={right}><Button variant="plain" aria-label={`Delete the measurement of ${fullDate(m.day)}`} onClick={() => onDelete(m.id)}>Delete</Button></span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function MeasureDialog({ today, own, onSave, onClose }: { today: string; own: OwnMeasurement[]; onSave: (m: OwnMeasurement) => void; onClose: () => void }) {
  const [day, setDay] = useState(today);
  const [weight, setWeight] = useState("");
  const [fat, setFat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const replaces = own.some((m) => m.day === day);
  return (
    <Dialog title="Add a measurement" onClose={onClose}>
      {(close) => {
        const submit = (e: FormEvent) => {
          e.preventDefault();
          const w = parseAmount(weight), f = fat.trim() === "" ? undefined : parseAmount(fat);
          if (!isDay(day) || day > today) { setError("Choose a day up to today."); return; }
          if (w == null || w < 20 || w > 400) { setError("Enter a weight between 20 and 400 kg."); return; }
          if (f === null || (f != null && (f < 2 || f > 70))) { setError("Enter body fat between 2 and 70%, or leave it empty."); return; }
          onSave({ id: newId(), day, weightKg: w, ...(f == null ? {} : { bodyFatPct: f }) });
          close();
        };
        return (
          <form onSubmit={submit} style={{ display: "contents" }} noValidate>
            <div className="dlg-grid">
              <label className="dlg-label">Date<Field type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} /></label>
              <label className="dlg-label">Weight (kg)<Field data-autofocus inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} autoComplete="off" /></label>
              <label className="dlg-label">Body fat (%)<Field inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} autoComplete="off" /></label>
            </div>
            {error ? <p className="dlg-error" role="alert">{error}</p> : null}
            {replaces ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>This replaces the measurement you saved for that day.</p> : null}
            <div className="dlg-foot"><Button onClick={close}>Cancel</Button><Button variant="primary" type="submit">Save</Button></div>
          </form>
        );
      }}
    </Dialog>
  );
}

/** Signed in, height and goal are only offered when the phone app has set up the profile they are saved in. */
function ProfileDialog({ profile, synced, onSave, onClose }: { profile: BodyProfile; synced: boolean; onSave: (p: ProfileEdit) => void; onClose: () => void }) {
  const [height, setHeight] = useState(profile.heightCm == null ? "" : String(profile.heightCm));
  const [goal, setGoal] = useState<GoalKind | null>(profile.goal);
  const [goalWeight, setGoalWeight] = useState(profile.goalWeightKg == null ? "" : oneOrTwo(profile.goalWeightKg));
  const hasHeight = profile.heightCm != null, hasGoal = goal != null;
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="You" onClose={onClose}>
      {(close) => {
        const submit = (e: FormEvent) => {
          e.preventDefault();
          const h = parseAmount(height), g = parseAmount(goalWeight);
          const noGoalWeight = profile.goalWeightKg == null && goalWeight.trim() === "";
          if (hasHeight && (h == null || h < 100 || h > 250)) { setError("Enter a height between 100 and 250 cm."); return; }
          if (!noGoalWeight && (g == null || g < 20 || g > 400)) { setError("Enter a goal weight between 20 and 400 kg."); return; }
          onSave({ ...(hasHeight && h != null ? { heightCm: h } : {}), ...(goal ? { goal } : {}), ...(noGoalWeight || g == null ? {} : { goalWeightKg: g }) });
          close();
        };
        return (
          <form onSubmit={submit} style={{ display: "contents" }} noValidate>
            <div className="dlg-grid">
              {hasHeight ? <label className="dlg-label">Height (cm)<Field data-autofocus inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></label> : null}
              {hasGoal ? (
                <label className="dlg-label">Goal
                  <Select value={goal} onChange={(e) => setGoal(e.target.value as GoalKind)}>
                    {(Object.keys(GOAL_LABEL) as GoalKind[]).filter((k) => k !== "custom" || profile.goal === "custom").map((k) => <option key={k} value={k}>{GOAL_LABEL[k]}</option>)}
                  </Select>
                </label>
              ) : null}
              <label className="dlg-label">Goal weight (kg)<Field inputMode="decimal" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} /></label>
            </div>
            {error ? <p className="dlg-error" role="alert">{error}</p> : null}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{synced ? "Age, resting energy and body age come from the phone app." : "Age, resting energy and body age come from the phone app and stay as sample data here."}</p>
            <div className="dlg-foot"><Button onClick={close}>Cancel</Button><Button variant="primary" type="submit">Save</Button></div>
          </form>
        );
      }}
    </Dialog>
  );
}
