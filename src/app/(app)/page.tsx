"use client";
import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FitnessChart } from "@/components/training/FitnessChart";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { Button, Card, CountUp, LinkButton, OriginBadge } from "@/components/ui";
import { useLoaded } from "@/data/core";
import { setFeel } from "@/data/feel";
import { createStore, useStore } from "@/data/local/store";
import { loadDashboard, PHONE_ONLY, sliceSeries, WIDGETS, type Dashboard, type HueName, type Scale, type TimeShare, type WidgetKey } from "@/data/training";
import { addDays, dayMonth, longDay, shortDay } from "@/lib/calendar";
import { linePath, sparkPath } from "@/lib/chart";
import { boardOrder, columnBars, dayTime, HEAT_STEP, heatCell, heatIndexAt, heatPaths, hMin, hoursClock, monthCells, openingLine, placeShown } from "@/lib/dashboard";
import { FEEL_LEVELS, FEEL_TAGS, feelAdjustment, loadHue } from "@/lib/feel";
import { clock, thousands } from "@/lib/format";
import { distanceIn, distanceUnit, paceText } from "@/lib/units";
import { sky, type WeatherNow } from "@/lib/openMeteo";
import { loadWeatherNow } from "@/data/weatherNow";
import { dateText, locale, msg, t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { platformSlots } from "@/lib/platform";
import { Board, type BoardHandle, type BoardItem } from "./Board";
import "./dashboard.css";

/** What the host app adds to the header (the desktop's mobile beta invite). */
const DashboardNote = platformSlots.dashboardNote;

/** Widgets the person switched off, saved in this browser. */
const hiddenStore = createStore<Partial<Record<WidgetKey, boolean>>>("dashboard.hidden", {});
const NONE: Partial<Record<WidgetKey, boolean>> = {};
/** The person's order of the widgets, saved in this browser; hidden widgets keep their place in it. */
const orderStore = createStore<string[]>("dashboard.order", []);
const NO_ORDER: string[] = [];
const WIDGET_KEYS = WIDGETS.map((w) => w.key);

/** True on a board worked out on this computer, with no phone paired: empty widgets then don't wait on a phone. */
const LocalBoard = createContext(false);

/** How wide each widget sits on the 12-column board. */
const SPAN: Record<WidgetKey, string> = {
  rings: "db-w5", today: "db-w4", latest: "db-w3", fitness: "db-w8 db-tall", load: "db-w4", streak: "db-w4", heat: "db-w8",
  goal: "db-w4", volume: "db-w4", year: "db-w4", intensity: "db-w4", sleep: "db-w4", hrv: "db-w4", mix: "db-w4",
  thresholds: "db-w5", bests: "db-w4", month: "db-w3",
};

function widget(k: WidgetKey, d: Dashboard): ReactNode {
  switch (k) {
    case "rings": return <Morning m={d.morning} today={d.today} />;
    case "today": return <Today t={d.todayWorkout} />;
    case "latest": return <Latest a={d.latest} />;
    case "fitness": return <Fitness f={d.fitness} />;
    case "load": return <Load l={d.load} />;
    case "streak": return <Streak s={d.streak} />;
    case "heat": return <Heat h={d.heat} />;
    case "goal": return <Goal g={d.goal} />;
    case "volume": return <Volume v={d.volume} />;
    case "year": return <Year y={d.year} />;
    case "intensity": return <Shares label={t("Easy vs hard")} title={t("Easy vs hard")} status={d.intensity.status} statusInk="var(--h-mint-ink)" parts={d.intensity.parts} />;
    case "sleep": return <Sleep s={d.sleep} />;
    case "hrv": return <Hrv h={d.hrv} />;
    case "mix": return <Shares label={t("Sport mix")} title={t("Sport mix")} status={d.mix.parts.length ? hMin(d.mix.parts.reduce((sum, p) => sum + p.minutes, 0)) : undefined} statusInk="var(--muted)" parts={d.mix.parts} />;
    case "thresholds": return <Thresholds t={d.thresholds} />;
    case "bests": return <Bests b={d.bests} />;
    case "month": return <Month m={d.month} today={d.today} />;
  }
}

const hue = (h: HueName) => `var(--h-${h})`;
const dateWords = (day: string) => `${dayMonth(day)} ${day.slice(0, 4)}`;
/** A month's name in the app's language, 0 = January. */
const monthName = (k: number, month: "long" | "short") => dateText(new Date(Date.UTC(2000, k, 1)), locale("en-GB"), { month, timeZone: "UTC" });

export default function DashboardPage() {
  const state = useLoaded(loadDashboard);
  const hidden = useStore(hiddenStore, NONE);
  const savedOrder = useStore(orderStore, NO_ORDER);
  const [editing, setEditing] = useState(false);
  const board = useRef<BoardHandle>(null);

  // Escape ends Customise (a widget picked up with Space takes the first Escape itself).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setEditing(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  if (state.status === "loading") return <LoadingPage label={t("Dashboard")} />;
  if (state.status === "error") return <LoadError error={state.error} onRetry={state.reload} />;

  const d = state.data;
  // With no phone, the widgets only a phone fills leave the board and the Customise list.
  const offered = d.local ? WIDGETS.filter((w) => !PHONE_ONLY.includes(w.key)) : WIDGETS;
  const on = (k: WidgetKey) => !hidden[k];
  const onCount = offered.filter((w) => on(w.key)).length;
  const order = boardOrder(savedOrder, WIDGET_KEYS).filter((k) => offered.some((w) => w.key === k));
  const items: BoardItem<WidgetKey>[] = order.filter(on).map((k) => ({ key: k, span: SPAN[k], label: t(WIDGETS.find((w) => w.key === k)!.name), node: widget(k, d) }));
  const off = order.filter((k) => !on(k));
  const customised = off.length > 0 || order.some((k, i) => k !== offered[i].key);
  const show = (k: WidgetKey) => { board.current?.prepare(); hiddenStore.set((prev) => ({ ...prev, [k]: false })); };
  const reset = () => { board.current?.prepare(); orderStore.clear(); hiddenStore.clear(); };
  const headline = openingLine(d.morning?.status);

  return (
    <main className="page db-page">
      <header className="db-open">
        <div>
          {headline ? <p className="db-date">{longDay(d.today)}</p> : null}
          <h1>{headline ?? longDay(d.today)}</h1>
          {d.coach ? (
            <div className="db-coachline">
              <Image src="/img/coach-listen.webp" alt="" width={56} height={56} />
              <p>{d.coach.text} <Link href="/calendar">{d.coach.nextLabel}</Link></p>
            </div>
          ) : null}
        </div>
        <div className="actions">
        <OriginBadge origin={state.origin} />
        {DashboardNote ? <DashboardNote /> : null}
        <WeatherChip />
        <Button aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round" }}>
            <rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><path d="M16.5 13.5v6M13.5 16.5h6" />
          </svg>
          {editing ? t("Done") : t("Customise")}
        </Button>
        <LinkButton variant="primary" href="/coach">{t("Ask Coach")}</LinkButton>
        </div>
      </header>

      {editing ? (
        <section aria-label={t("Widgets on this dashboard")} className="db-panel">
          <div className="db-panel-top">
            <div className="db-panel-words">
              <h2>{t("Customise")}</h2>
              <p>{t("Drag a widget to move it. − hides it.")}</p>
            </div>
            <span className="db-panel-count">{t("{n} of {total} on", { n: onCount, total: offered.length })}</span>
            {customised ? <button type="button" className="db-panel-reset" onClick={reset}>{t("Reset")}</button> : null}
            <Button variant="primary" onClick={() => setEditing(false)}>{t("Done")}</Button>
          </div>
          {off.length ? (
            <div className="db-chips">
              {off.map((k) => (
                <button key={k} type="button" onClick={() => show(k)} aria-label={t("Show {name}", { name: t(WIDGETS.find((w) => w.key === k)!.name) })}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.5, strokeLinecap: "round" }}><path d="M12 5v14M5 12h14" /></svg>
                  {t(WIDGETS.find((w) => w.key === k)!.name)}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <LocalBoard.Provider value={!!d.local}>
        <Board ref={board} items={items} editing={editing}
          onReorder={(shown) => orderStore.set(placeShown(boardOrder(savedOrder, WIDGET_KEYS), shown))}
          onHide={(k) => hiddenStore.set((prev) => ({ ...prev, [k]: true }))} />
      </LocalBoard.Provider>
      {onCount === 0 ? <p className="muted" style={{ margin: 0 }}>{t("Every widget is off. Customise brings them back.")}</p> : null}
    </main>
  );
}

/* ───────────── Pieces ───────────── */

function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="db-head"><h2>{title}</h2>{children}</div>;
}

function Status({ text, color = "var(--h-mint-ink)" }: { text?: string; color?: string }) {
  return text ? <span className="db-status" style={{ color }}>{t(text)}</span> : null;
}

type Ghost = "lines" | "rings" | "chart" | "map" | "rows";
const GHOST_BARS = [40, 64, 30, 78, 52, 90, 20];

/**
 * What a widget shows when the phone (or, with none paired, this computer) has too little for it: the outline of its usual content in
 * dashes, so the tile keeps its place on the board, and one line saying why it is empty.
 */
function Empty({ text, shape = "lines" }: { text?: string; shape?: Ghost }) {
  const local = useContext(LocalBoard);
  text ??= local ? t("Not enough on this computer yet") : t("Nothing from your phone yet");
  return (
    <div className="db-empty">
      <div aria-hidden="true" className="db-ghost" data-shape={shape}>
        {shape === "rings" ? [0, 1, 2].map((k) => <i key={k} />) : null}
        {shape === "chart" ? GHOST_BARS.map((h, k) => <i key={k} style={{ height: `${h}%` }} />) : null}
        {shape === "map" ? <><i /><i /><i /></> : null}
        {shape === "rows" ? [0, 1, 2].map((k) => <i key={k} />) : null}
        {shape === "lines" ? <><i /><i /><i /></> : null}
      </div>
      <p>{text}</p>
    </div>
  );
}

/** The big figure with its small coloured word after it. */
function Big({ value, unit, unitColor }: { value: string; unit?: string; unitColor?: string }) {
  return (
    <span className="db-big"><CountUp text={value} />{unit ? <small style={{ color: unitColor }}> {unit}</small> : null}</span>
  );
}

function ScaleBar({ scale, label }: { scale: Scale; label: string }) {
  return (
    <div className="db-scale" role="img" aria-label={label}>
      <div>
        <div aria-hidden="true" className="db-scale-bar">
          {scale.segments.map((s, k) => <span key={k} style={{ flex: `${s.weight} 0 0`, background: hue(s.hue) }} />)}
        </div>
        <span aria-hidden="true" className="db-scale-mark" style={{ left: `calc(${(scale.marker * 100).toFixed(1)}% - 3px)` }} />
      </div>
      <div aria-hidden="true" className="db-scale-labels">{scale.labels.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}

/* ───────────── Widgets ───────────── */

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

function Morning({ m, today }: { m: Dashboard["morning"]; today: string }) {
  if (!m) return <Card aria-label={t("Readiness, sleep and load")} className="db-card db-w5"><Head title={t("This morning")} /><Empty shape="rings" /></Card>;
  return (
    <Card aria-label={t("Readiness, sleep and load")} className="db-card db-w5">
      <Head title={t("This morning")}><Status text={m.status} color={`var(--h-${m.rings[0]?.hue ?? "mint"}-ink)`} /></Head>
      <div className="db-trio" style={{ gap: 12 }}>
        {m.rings.map((r) => (
          <div key={r.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div className="db-ring">
              <svg aria-hidden="true" width="92" height="92" viewBox="0 0 92 92" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="46" cy="46" r={RING_R} fill="none" style={{ stroke: "var(--db-track)", strokeWidth: 9 }} />
                <circle className="cl-ring" cx="46" cy="46" r={RING_R} fill="none"
                  style={{ stroke: hue(r.hue), strokeWidth: 9, strokeLinecap: "round", strokeDasharray: `${(r.fraction * RING_C).toFixed(1)} ${RING_C.toFixed(0)}` }} />
              </svg>
              <CountUp text={r.value} />
            </div>
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</span>
          </div>
        ))}
      </div>
      {m.tiles.length ? <div className="db-trio db-foot" style={{ gap: 12 }}>
        {m.tiles.map((tile) => (
          <div key={tile.label} className="db-tile">
            <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.label}</span>
            <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: "nowrap" }}>
              {tile.value}{tile.unit ? <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}> {tile.unit}</span> : null}
            </span>
            <svg aria-hidden="true" className="spark" width="100%" height="24" viewBox="0 0 80 24" preserveAspectRatio="none">
              <path d={sparkPath(tile.trend)} fill="none" style={{ stroke: hue(tile.hue), strokeWidth: 1.75, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--h-mint-ink)" }}>{tile.note}</span>
          </div>
        ))}
      </div> : null}
      <FeelCheck key={`${today}-${m.feel?.level ?? 0}-${m.feel?.tags.join(",") ?? ""}`} today={today} feel={m.feel ?? null} />
    </Card>
  );
}

/**
 * Coach's head for a feel level: tired, pondering, idle, waving, cheering, recoloured red → green as the phone's
 * FeelFace does. Drawn from the app's CoachBot (`AppStore/showreel/coachbot.js`) with each colour baked in.
 */
function Face({ level, hueName, size = 30, ring = false }: { level: number; hueName: HueName; size?: number; ring?: boolean }) {
  return (
    <span aria-hidden="true" className="db-face-art" style={{ width: size, height: size, background: ring ? `color-mix(in srgb, var(--h-${hueName}) 20%, transparent)` : undefined }}>
      <Image src={`/img/coach-feel-${level}.webp`} alt="" width={size} height={size} unoptimized
        style={{ width: size * (ring ? 0.86 : 1), height: size * (ring ? 0.86 : 1) }} />
    </span>
  );
}

/** The phone's feel check: five faces in one tap, then optional tags. Sent to the phone, which moves readiness by it. */
function FeelCheck({ today, feel }: { today: string; feel: { level: number; tags: string[] } | null }) {
  const [editing, setEditing] = useState(feel == null);
  const [level, setLevel] = useState(feel?.level ?? 0);
  const [tags, setTags] = useState<string[]>(feel?.tags ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  // Worked out here, readiness takes the feel in at once.
  const local = useContext(LocalBoard);
  const send = (nextLevel: number, nextTags: string[]) => {
    setLevel(nextLevel); setTags(nextTags); setProblem(null);
    setFeel(today, nextLevel, nextTags).catch((e: unknown) => setProblem(e instanceof Error ? e.message : t("That didn't save.")));
  };
  const chosen = FEEL_LEVELS.find((f) => f.level === level);
  const points = level ? feelAdjustment(level, tags) : 0;
  return (
    <div className="db-feel" role="group" aria-label={t("How do you feel today?")}>
      {chosen && !editing ? (
        <div className="db-feel-row">
          <Face level={chosen.level} hueName={chosen.hue} size={40} ring />
          <span style={{ fontWeight: 700 }}>{t("Feeling {feel}", { feel: t(chosen.title).toLowerCase() })}</span>
          {points !== 0 ? <span className="db-feel-points" style={{ color: `var(--h-${chosen.hue}-ink)`, background: `color-mix(in srgb, var(--h-${chosen.hue}) 18%, transparent)` }}>{points > 0 ? `+${points}` : `−${-points}`}</span> : null}
          <button type="button" className="db-feel-change" onClick={() => setEditing(true)}>{t("Change")}</button>
        </div>
      ) : (
        <div className="db-feel-row">
          <span style={{ fontWeight: 700, marginRight: "auto" }}>{t("How do you feel?")}</span>
          <div role="radiogroup" aria-label={t("How do you feel?")} style={{ display: "flex", gap: 4 }}>
            {FEEL_LEVELS.map((f) => (
              <button key={f.level} type="button" role="radio" aria-checked={level === f.level} aria-label={t(f.title)} title={t(f.title)}
                className="db-face" data-on={level === f.level || undefined}
                onClick={() => { send(f.level, tags); setEditing(false); }}>
                <Face level={f.level} hueName={f.hue} size={32} />
              </button>
            ))}
          </div>
        </div>
      )}
      {level ? (
        <div className="db-feel-tags">
          {FEEL_TAGS.map((ft) => {
            const on = tags.includes(ft.tag);
            return <button key={ft.tag} type="button" aria-pressed={on} className="db-feel-tag" onClick={() => send(level, on ? tags.filter((x) => x !== ft.tag) : [...tags, ft.tag])}>{t(ft.title)}</button>;
          })}
        </div>
      ) : null}
      {problem ? <span role="alert" style={{ fontSize: 12, color: "var(--h-rose-ink)" }}>{problem}</span> : null}
      {level && !problem && !local ? <span className="muted" style={{ fontSize: 12 }}>{t("Readiness takes it in when your phone next syncs.")}</span> : null}
    </div>
  );
}

function Today({ t: tw }: { t: Dashboard["todayWorkout"] }) {
  // Nothing today but something coming: the next session, so the card says what is next rather than nothing.
  const shown = tw.name != null ? { status: tw.status, name: tw.name, detail: tw.detail, stats: tw.stats }
    : tw.next ? { status: msg("Next"), name: tw.next.name, detail: tw.next.when, stats: [] } : null;
  return (
    <Card aria-label={t("Today")} className="db-card db-w4">
      <Head title={t("Today")}><Link href="/calendar">{t("Open calendar")}</Link></Head>
      {shown == null ? <Empty text={t("Nothing planned today")} /> : (
        <div className="db-today">
          <span className="db-today-status" data-status={shown.status}>{tx("status", shown.status)}</span>
          <span className="db-today-name">{shown.name}</span>
          {shown.detail ? <span className="soft" style={{ fontSize: 13 }}>{shown.detail}</span> : null}
        </div>
      )}
      {shown && shown.stats.length ? (
        <div className="db-trio db-split" style={shown.stats.length > 3 ? { gridTemplateColumns: `repeat(${shown.stats.length}, minmax(0, 1fr))` } : undefined}>
          {shown.stats.map((s) => <div key={s.label} className="db-stat"><span>{t(s.label)}</span><span>{s.value}</span></div>)}
        </div>
      ) : null}
      <div className="db-week db-foot db-split">
        {tw.week.map((w, k) => (
          <div key={k} data-state={w.state} data-current={w.current ? "" : undefined}>
            <span>{w.day}</span><i aria-hidden="true" /><span>{w.what}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Shown beside the title, or under the trace for heart rate; everything else is a headline number. */
const LATEST_SIDE = new Set(["Heart rate", "Load", "Calories"]);
const FAMILY_ICON: Record<NonNullable<Dashboard["latest"]>["family"], string> = {
  Run: "M13.5 4.5a1.8 1.8 0 1 0 0 .1M7 21l3-6 3 2v5M5 12l3.5-4 5 1 2 4 3.5 1",
  Ride: "M5.5 14a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM18.5 14a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM15 4.5a1 1 0 1 0 0 .1M12 17.5V14l-3-3 4-3 2 3h2",
  Swim: "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M15 4.5a1.5 1.5 0 1 0 0 .1M7 10l4-3 3 3",
  Strength: "M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11",
  Other: "M3 12h4l3-8 4 16 3-8h4",
};
const SportGlyph = ({ family, size = 13 }: { family: NonNullable<Dashboard["latest"]>["family"]; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={FAMILY_ICON[family]} /></svg>
);
/** "4.01 km" → ["4.01", "km"], "6:15 /km" → ["6:15", "/km"], "25:05" → ["25:05", ""]. */
function numberAndUnit(value: string): [string, string] {
  const m = /^(.*\d)\s+(\S+)$/.exec(value);
  return m ? [m[1], m[2]] : [value, ""];
}

function Latest({ a }: { a: Dashboard["latest"] }) {
  if (!a) return <Card aria-label={t("Latest activity")} className="db-card db-w3"><Head title={t("Latest activity")} /><Empty shape="map" /></Card>;
  const href = `/activities/${encodeURIComponent(a.activityId)}`;
  const stat = (label: string) => a.stats.find((s) => s.label === label);
  const big = a.stats.filter((s) => !LATEST_SIDE.has(s.label)).slice(0, 3);
  const heartRate = stat("Heart rate");
  // Beside the title: load and burn; heart rate joins them when there is no trace to put it on.
  const side = [
    ...(heartRate && !a.heart ? [{ label: t("Heart"), value: heartRate.value, hue: "rose" }] : []),
    ...(stat("Load") ? [{ label: t("Load"), value: stat("Load")!.value, hue: "violet" }] : []),
    ...(stat("Calories") ? [{ label: t("Burned"), value: stat("Calories")!.value, hue: "orange" }] : []),
  ];
  return (
    <Card aria-label={t("Latest activity")} className="db-card db-w3 db-latest">
      <div className="db-latest-map">
        {a.routePath ? (
          <svg role="img" aria-label={a.routeLabel} width="100%" height="100%" viewBox="0 0 300 170" preserveAspectRatio="xMidYMid meet">
            <path d={a.routePath} fill="none" className="db-latest-halo" />
            <path d={a.routePath} fill="none" className="db-latest-route" />
            <circle cx={a.routeStart[0]} cy={a.routeStart[1]} r="5.5" className="db-latest-start" />
            <circle cx={a.routeEnd[0]} cy={a.routeEnd[1]} r="10" className="db-latest-glow" />
            <circle cx={a.routeEnd[0]} cy={a.routeEnd[1]} r="5" className="db-latest-end" />
          </svg>
        ) : <span aria-hidden="true" className="db-latest-icon"><SportGlyph family={a.family} size={40} /></span>}
        <div className="db-latest-top">
          <h2 className="db-latest-chip db-latest-kind"><SportGlyph family={a.family} />{t("Latest {sport}", { sport: a.sport.toLowerCase() })}</h2>
          <Link href={href} className="db-latest-chip" aria-label={t("Open {name}", { name: a.name })}>
            {t("Open")}<svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M8 7h9v9" /></svg>
          </Link>
        </div>
      </div>
      <div className="db-latest-body">
        <div className="db-latest-title">
          <div className="db-latest-name"><span>{a.name}</span><span className="muted">{a.when}</span></div>
          {side.length ? (
            <div className="db-latest-side">
              {side.map((s) => <span key={s.label} className="db-latest-pill" style={{ "--hue": `var(--h-${s.hue})`, "--ink": `var(--h-${s.hue}-ink)` } as React.CSSProperties}><i aria-hidden="true" />{s.label}<b>{s.value}</b></span>)}
            </div>
          ) : null}
        </div>
        {big.length ? (
          <div className="db-latest-big">
            {big.map((s) => {
              const [n, unit] = numberAndUnit(s.value);
              return <div key={s.label}><span className="num">{n}{unit ? <small> {unit}</small> : null}</span><span>{t(s.label)}</span></div>;
            })}
          </div>
        ) : null}
        {a.heart ? (
          <div className="db-latest-hr">
            <div><span><i aria-hidden="true" />{t("Heart rate")}</span>{heartRate ? <span>{tr("avg {hr} bpm", { hr: <b>{numberAndUnit(heartRate.value)[0]}</b> })}</span> : null}</div>
            <svg role="img" aria-label={a.heart.label} width="100%" height="56" viewBox="0 0 300 56" preserveAspectRatio="none">
              <defs><linearGradient id="db-latest-hr-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--h-rose)" stopOpacity="0.26" /><stop offset="1" stopColor="var(--h-rose)" stopOpacity="0" /></linearGradient></defs>
              <path d={a.heart.area} fill="url(#db-latest-hr-fill)" />
              <path d={a.heart.line} fill="none" style={{ stroke: "var(--h-rose)", strokeWidth: 1.8, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
            </svg>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Fitness({ f }: { f: Dashboard["fitness"] }) {
  if (!f) return <Card aria-label={t("Fitness and freshness")} className="db-card db-w8 db-tall"><Head title={t("Fitness & freshness")} /><Empty shape="chart" /></Card>;
  const series = sliceSeries(f.series, 12);
  return (
    <Card aria-label={t("Fitness and freshness")} className="db-card db-w8 db-tall">
      <FitnessChart series={series} rangeLabel={t("12 weeks")} title={t("Fitness & freshness")} height={220} barHeight={56}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "14px 28px" }}>
          <Big value={String(f.value)} unit={f.status && t(f.status)} unitColor="var(--h-blue-ink)" />
          <div style={{ flex: "1 1 260px" }}><ScaleBar scale={f.scale} label={t("Form on a scale from fresh to strained: {form}", { form: f.scale.labels[1] })} /></div>
        </div>
      </FitnessChart>
    </Card>
  );
}

function Load({ l }: { l: Dashboard["load"] }) {
  if (!l) return <Card aria-label={t("Training load")} className="db-card db-w4"><Head title={t("Training load")} /><Empty /></Card>;
  return (
    <Card aria-label={t("Training load")} className="db-card db-w4">
      <Head title={t("Training load")}><Status text={l.status} color={`var(--h-${loadHue(l.status)}-ink)`} /></Head>
      <Big value={l.ratio} unit={t("ratio")} unitColor="var(--h-mint-ink)" />
      <ScaleBar scale={l.scale} label={l.status ? t("Load ratio {ratio} on a scale from 0 to 2.0, {status}", { ratio: l.ratio, status: t(l.status).toLowerCase() }) : t("Load ratio {ratio} on a scale from 0 to 2.0", { ratio: l.ratio })} />
      <div className="db-pair db-foot db-split">
        <div className="db-stat"><span>{t("Last 7 days")}</span><span>{l.last7 ?? "—"}</span></div>
        <div className="db-stat"><span>{t("Usual week")}</span><span>{l.usual ?? "—"}</span></div>
      </div>
    </Card>
  );
}

function Streak({ s }: { s: Dashboard["streak"] }) {
  return (
    <Card aria-label={t("Streak")} className="db-card db-w4">
      <Head title={t("Streak")}><Status text={s.bestWeeks === 1 ? t("Best 1 week") : t("Best {n} weeks", { n: s.bestWeeks })} color="var(--muted)" /></Head>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <Big value={String(s.weeks)} unit={s.weeks === 1 ? t("week") : t("weeks")} unitColor="var(--db-streak-ink)" />
        <span className="soft" style={{ fontSize: 13, fontWeight: 600 }}>{s.daysInRow === 1 ? t("1 day in a row") : t("{n} days in a row", { n: s.daysInRow })}</span>
      </div>
      {s.weeks > 0 ? (
        <div aria-hidden="true" className="db-foot" style={{ display: "grid", gridTemplateColumns: `repeat(${s.weeks}, minmax(0, 1fr))`, gap: 4 }}>
          {Array.from({ length: s.weeks }, (_, k) => (
            <span key={k} style={{ height: 26, borderRadius: 7, background: "var(--db-streak)", opacity: s.weeks > 1 ? 0.35 + (0.65 * k) / (s.weeks - 1) : 1 }} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function Heat({ h }: { h: Dashboard["heat"] }) {
  const last = h.days.length - 1;
  const weeks = Math.ceil(h.days.length / 7);
  const [picked, setPicked] = useState<number | null>(null);
  const idx = picked ?? last;
  const day = h.days[idx];
  const date = addDays(h.start, idx);
  const paths = heatPaths(h.days.map((x) => x.level));
  const [hx, hy] = heatCell(idx);
  // The twelve months the map covers, ending with the month of its last day.
  const endMonth = Number(addDays(h.start, last).slice(5, 7));
  const months = Array.from({ length: 12 }, (_, k) => monthName((endMonth + k) % 12, "short"));
  const text = day.minutes ? `${day.what ? `${day.what} · ` : ""}${dayTime(day.minutes)} · ${t("Load {n}", { n: day.load })}` : t("Rest day");
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (step == null) return;
    e.preventDefault();
    setPicked(Math.max(0, Math.min(last, idx + step)));
  };
  return (
    <Card aria-label={t("Training heat map")} className="db-card db-w8">
      <Head title={t("Training heat map")}>
        <div aria-live="polite" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>{shortDay(date, true)}</span><span className="soft">{text}</span>
        </div>
      </Head>
      <div className="db-chart-focus" role="group" tabIndex={0}
        aria-label={t("Training heat map. Arrow keys move the day shown: left and right by a week, up and down by a day.")}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPicked(heatIndexAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, weeks, h.days.length));
        }}
        onMouseLeave={() => setPicked(null)} onKeyDown={onKey}>
        <svg role="img" aria-label={t("Every day of the last 12 months, coloured by how hard you trained")} viewBox={`0 0 ${weeks * HEAT_STEP} 105`} style={{ display: "block", width: "100%", height: "auto" }}>
          {paths.map((p, lv) => (
            <path key={lv} d={p} style={{ fill: `var(--db-heat-${lv})`, stroke: `var(--db-heat-${lv})`, strokeWidth: 2, strokeLinejoin: "round" }} />
          ))}
          <rect x={hx - 1} y={hy - 1} width="13" height="13" rx="3" fill="none" style={{ stroke: "var(--fg)", strokeWidth: 1.5 }} />
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--muted)" }}>
        <div style={{ flex: "1 1 420px", display: "flex", justifyContent: "space-between" }}>{months.map((m) => <span key={m}>{m}</span>)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 24 }}>
          <span>{t("Rest")}</span>
          {[0, 1, 2, 3, 4].map((lv) => <span key={lv} aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 3, background: `var(--db-heat-${lv})` }} />)}
          <span>{t("Hard")}</span>
        </div>
      </div>
    </Card>
  );
}

function Goal({ g }: { g: Dashboard["goal"] }) {
  if (!g) return <Card aria-label={t("Weekly goal")} className="db-card db-w4"><Head title={t("Weekly goal")} /><Empty /></Card>;
  const done = Math.min(1, g.doneMinutes / g.goalMinutes);
  const planned = g.plannedByTodayMinutes != null ? Math.min(1, g.plannedByTodayMinutes / g.goalMinutes) : null;
  return (
    <Card aria-label={t("Weekly goal")} className="db-card db-w4">
      <Head title={t("Weekly goal")}><Status text={g.status} /></Head>
      <Big value={hMin(g.doneMinutes)} unit={t("of {total}", { total: hMin(g.goalMinutes) })} unitColor="var(--muted)" />
      <div className="db-foot" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ position: "relative", padding: "5px 0" }}>
          <div aria-hidden="true" style={{ height: 10, borderRadius: 999, background: "var(--db-track)", overflow: "hidden" }}>
            <div className="cl-bar" style={{ width: `${(done * 100).toFixed(0)}%`, height: "100%", borderRadius: 999, background: "var(--h-mint)" }} />
          </div>
          {planned != null ? <span aria-hidden="true" style={{ position: "absolute", top: 0, left: `${(planned * 100).toFixed(0)}%`, width: 2, height: 20, borderRadius: 2, background: "var(--fg)" }} /> : null}
        </div>
        <div className="db-legend">{g.plannedByTodayMinutes != null ? <span>{t("Planned by today {time}", { time: hMin(g.plannedByTodayMinutes) })}</span> : <span />}<span>{t("{time} to go", { time: hMin(Math.max(0, g.goalMinutes - g.doneMinutes)) })}</span></div>
      </div>
    </Card>
  );
}

const dashed = { stroke: "rgba(var(--fg-rgb), 0.5)", strokeDasharray: "3 4", vectorEffect: "non-scaling-stroke" } as const;

function Volume({ v }: { v: Dashboard["volume"] }) {
  const toH = (x: number) => (x / 7) * 90;
  const past = v.hours.slice(0, -1), now = v.hours[v.hours.length - 1];
  const avgY = (90 - toH(v.averageHours)).toFixed(1);
  const lo = Math.min(...past), hi = Math.max(...past);
  return (
    <Card aria-label={t("Weekly volume")} className="db-card db-w4">
      <Head title={t("Weekly volume")}><Status text={v.status} color="var(--h-blue-ink)" /></Head>
      <Big value={hMin(now * 60)} unit={t("this week")} unitColor="var(--muted)" />
      <svg role="img" aria-label={t("Training time for {n} weeks, between {low} and {high}, against an average of {avg}", { n: v.hours.length, low: hMin(lo * 60), high: hMin(hi * 60), avg: hMin(v.averageHours * 60) })}
        width="100%" height="90" viewBox="0 0 300 90" preserveAspectRatio="none" className="db-foot">
        <path d={columnBars(past, 90, toH, 25, 19, 3)} style={{ fill: "var(--h-blue)", opacity: 0.4 }} />
        <path d={columnBars([now], 90, toH, 25, 19, 3 + 25 * past.length)} style={{ fill: "var(--h-blue)" }} />
        <line x1="0" x2="300" y1={avgY} y2={avgY} style={dashed} />
      </svg>
      <div className="db-legend"><span>{t("{n} weeks", { n: v.hours.length })}</span><span>{t("Average {time}", { time: hMin(v.averageHours * 60) })}</span></div>
    </Card>
  );
}

function Year({ y }: { y: Dashboard["year"] }) {
  // The taller curve ends just under the top (the canvas's 1,842 km on a 1,900 km scale).
  const top = Math.max(y.km, y.lastYear[y.lastYear.length - 1] ?? 0, 1) / 0.97;
  const line = (a: readonly number[]) => a.map((v, k) => `${k ? "L" : "M"}${((k / 364) * 300).toFixed(1)} ${(90 - (v / top) * 90).toFixed(1)}`).join(" ");
  return (
    <Card aria-label={t("Year to date")} className="db-card db-w4">
      <Head title={t("Year to date")}><Status text={y.status} /></Head>
      <Big value={thousands(distanceIn(y.km * 1000))} unit={distanceUnit()} unitColor="var(--h-mint-ink)" />
      <svg role="img" aria-label={y.label} width="100%" height="90" viewBox="0 0 300 90" preserveAspectRatio="none" className="db-foot">
        <path d={line(y.lastYear)} fill="none" style={{ stroke: "var(--db-ghost-line)", strokeDasharray: "4 4", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" }} />
        <path d={line(y.thisYear)} fill="none" style={{ stroke: "var(--h-mint)", strokeWidth: 2.5, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
      </svg>
      <div className="db-legend"><span>{monthName(0, "short")}</span>{y.lastYearByNowKm != null ? <span>{t("Last year {distance} by now", { distance: `${thousands(distanceIn(y.lastYearByNowKm * 1000))} ${distanceUnit()}` })}</span> : null}<span>{monthName(11, "short")}</span></div>
    </Card>
  );
}

/** A part's share of the whole in words: a sliver reads "<1%" and the rest never rounds up to 100% beside it. */
function shareText(minutes: number, total: number): string {
  if (!(total > 0) || !(minutes > 0)) return "0%";
  const pct = (minutes / total) * 100;
  if (pct < 1) return "<1%";
  if (pct > 99 && minutes < total) return ">99%";
  return `${Math.round(pct)}%`;
}

function Shares({ label, title, status, statusInk, parts }: { label: string; title: string; status?: string; statusInk: string; parts: TimeShare[] }) {
  if (!parts.length) return <Card aria-label={label} className="db-card db-w4"><Head title={title} /><Empty /></Card>;
  const total = parts.reduce((sum, p) => sum + p.minutes, 0);
  return (
    <Card aria-label={label} className="db-card db-w4">
      <Head title={title}><Status text={status} color={statusInk} /></Head>
      <div aria-hidden="true" className="db-shares">
        {parts.map((p) => <span key={p.label} style={{ flex: `${Math.max(p.minutes, 0)} 0 0`, minWidth: p.minutes > 0 ? 4 : 0, background: hue(p.hue) }} />)}
      </div>
      <div className="db-foot" style={{ display: "flex", flexDirection: "column" }}>
        {parts.map((p) => (
          <div key={p.label} className="db-share-row">
            <i aria-hidden="true" style={{ background: hue(p.hue) }} />
            <span style={{ fontWeight: 500 }}>{p.label}</span><span>{shareText(p.minutes, total)}</span><span>{hMin(p.minutes)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Sleep({ s }: { s: Dashboard["sleep"] }) {
  if (!s) return <Card aria-label={t("Sleep, two weeks")} className="db-card db-w4"><Head title={t("Sleep")}><Link href="/health">{t("Health")}</Link></Head><Empty shape="chart" /></Card>;
  const toH = (v: number) => ((v - 4) / 5) * 90;
  const past = s.nights.slice(0, -1), last = s.nights[s.nights.length - 1];
  const avgY = (90 - toH(s.averageHours)).toFixed(1);
  return (
    <Card aria-label={t("Sleep, two weeks")} className="db-card db-w4">
      <Head title={t("Sleep")}><Link href="/health">{t("Health")}</Link></Head>
      <Big value={hoursClock(last)} unit={t("last night")} unitColor="var(--h-violet-ink)" />
      <svg role="img" aria-label={t("Sleep for the last {n} nights, between {low} and {high}, against an average of {avg}", { n: s.nights.length, low: hoursClock(Math.min(...s.nights)), high: hoursClock(Math.max(...s.nights)), avg: hoursClock(s.averageHours) })}
        width="100%" height="90" viewBox="0 0 300 90" preserveAspectRatio="none" className="db-foot">
        <path d={columnBars(past, 90, toH, 21.5, 15, 2)} style={{ fill: "var(--h-violet)", opacity: 0.4 }} />
        <path d={columnBars([last], 90, toH, 21.5, 15, 2 + 21.5 * past.length)} style={{ fill: "var(--h-violet)" }} />
        <line x1="0" x2="300" y1={avgY} y2={avgY} style={dashed} />
      </svg>
      <div className="db-legend"><span>{t("{n} nights", { n: s.nights.length })}</span><span>{t("Average {time}", { time: hoursClock(s.averageHours) })}</span></div>
    </Card>
  );
}

function Hrv({ h }: { h: Dashboard["hrv"] }) {
  if (!h) return <Card aria-label={t("HRV trend")} className="db-card db-w4"><Head title="HRV" /><Empty shape="chart" /></Card>;
  const [lo, hi] = h.usual;
  // The canvas scale (44 to 72 ms), widened when a reading or the usual range goes outside it.
  const min = Math.min(44, Math.floor(Math.min(lo, ...h.days)) - 2), max = Math.max(72, Math.ceil(Math.max(hi, ...h.days)) + 2);
  const hy = (v: number) => 90 - ((v - min) / (max - min)) * 90;
  const latest = Math.round(h.days[h.days.length - 1]);
  return (
    <Card aria-label={t("HRV trend")} className="db-card db-w4">
      <Head title="HRV"><Status text={h.status} /></Head>
      <Big value={String(latest)} unit="ms" unitColor="var(--h-cyan-ink)" />
      <svg role="img" aria-label={t("HRV for {n} days, against the usual range of {low} to {high} ms, latest {latest}", { n: h.days.length, low: lo, high: hi, latest })}
        width="100%" height="90" viewBox="0 0 300 90" preserveAspectRatio="none" className="db-foot">
        <rect x="0" y={hy(hi).toFixed(1)} width="300" height={(hy(lo) - hy(hi)).toFixed(1)} rx="4" style={{ fill: "var(--h-cyan)", opacity: 0.14 }} />
        <path d={linePath(h.days, 300, 90, min, max)} fill="none" style={{ stroke: "var(--h-cyan)", strokeWidth: 2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
      </svg>
      <div className="db-legend"><span>{t("{n} days", { n: h.days.length })}</span><span>{t("Usual range {low}–{high} ms", { low: lo, high: hi })}</span></div>
    </Card>
  );
}

const RACE_COLS = "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) 56px";

function Thresholds({ t: th }: { t: Dashboard["thresholds"] }) {
  if (!th) return <Card aria-label={t("Threshold and VO2max")} className="db-card db-w5"><Head title={t("Threshold & VO₂max")} /><Empty shape="rows" /></Card>;
  return (
    <Card aria-label={t("Threshold and VO2max")} className="db-card db-w5">
      <Head title={t("Threshold & VO₂max")}><Status text={th.status} /></Head>
      {th.vo2max != null ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "14px 28px" }}>
          <Big value={String(th.vo2max)} unit="VO₂max" unitColor="var(--h-mint-ink)" />
          {th.scale ? <div style={{ flex: "1 1 200px" }}><ScaleBar scale={th.scale} label={th.status ? t("VO2max {value} on a scale from 30 to 70, {status}", { value: th.vo2max, status: th.status.toLowerCase() }) : t("VO2max {value} on a scale from 30 to 70", { value: th.vo2max })} /></div> : null}
        </div>
      ) : null}
      <div className="db-pair">
        <div className="db-stat"><span>{t("Threshold pace")}</span><span>{th.paceSecPerKm != null ? paceText(th.paceSecPerKm) : "—"}</span></div>
        <div className="db-stat"><span>{t("Threshold heart rate")}</span><span>{th.heartRate != null ? `${th.heartRate} bpm` : "—"}</span></div>
      </div>
      <div className="db-rows db-foot" style={{ display: "flex", flexDirection: "column" }}>
        {th.races.map((r) => (
          <div key={r.name} className="row" style={{ gridTemplateColumns: RACE_COLS, minHeight: 36 }}>
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            <span style={{ textAlign: "right", fontWeight: 700, color: "var(--h-gold-ink)" }}>{clock(r.seconds)}</span>
            <span className="soft" style={{ textAlign: "right" }}>{paceText(r.paceSecPerKm)}</span>
            {r.deltaSeconds != null
              ? <span style={{ textAlign: "right", color: r.deltaSeconds <= 0 ? "var(--h-mint-ink)" : "var(--muted)" }}>{r.deltaSeconds > 0 ? "+" : ""}{clock(r.deltaSeconds)}</span>
              : <span />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Bests({ b }: { b: Dashboard["bests"] }) {
  return (
    <Card aria-label={t("Personal bests")} className="db-card db-w4">
      <Head title={t("Personal bests")}><Link href="/activities">{t("All activities")}</Link></Head>
      {b.length ? null : <Empty shape="rows" />}
      <div className="db-rows db-foot" style={{ display: "flex", flexDirection: "column" }}>
        {b.map((x) => (
          <div key={x.name} className="row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 12, minHeight: 44, alignItems: "baseline", paddingTop: 11, paddingBottom: 11 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500, minWidth: 0 }}>{x.name}{x.isNew ? <span className="db-new">{t("New")}</span> : null}</span>
            <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{x.date ? dateWords(x.date) : ""}</span>
            <CountUp text={clock(x.seconds, 2)} style={{ minWidth: 84, textAlign: "right", fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Month({ m, today }: { m: Dashboard["month"]; today: string }) {
  const cells = monthCells(m.month, today, m.done, m.planned);
  const name = monthName(Number(m.month.slice(5)) - 1, "long");
  // Monday first: 3 January 2000 was a Monday.
  const letters = Array.from({ length: 7 }, (_, k) => dateText(new Date(Date.UTC(2000, 0, 3 + k)), locale("en-GB"), { weekday: "narrow", timeZone: "UTC" }));
  return (
    <Card aria-label={t("This month")} className="db-card db-w3">
      <Head title={name}><Status text={m.done.length === 1 ? t("1 day") : t("{n} days", { n: m.done.length })} /></Head>
      <div aria-hidden="true" className="db-month db-month-head">{letters.map((l, k) => <span key={k}>{l}</span>)}</div>
      <div className="db-month db-foot" role="img" aria-label={t("{month}: {done} days trained, {planned} more planned", { month: name, done: m.done.length, planned: m.planned.length })}>
        {cells.map((c, k) => (
          <span key={k} data-done={c.done ? "" : undefined} data-planned={c.planned ? "" : undefined} data-today={c.today ? "" : undefined}>{c.day ?? ""}</span>
        ))}
      </div>
    </Card>
  );
}

/** Which drawing a WMO weather code gets. */
function skyKind(code: number, isDay: boolean): "sun" | "moon" | "part" | "cloud" | "fog" | "rain" | "snow" | "storm" {
  if (code <= 1) return isDay ? "sun" : "moon";
  if (code === 2) return "part";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

function SkyIcon({ kind }: { kind: ReturnType<typeof skyKind> }) {
  const sunRays = "M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7";
  const cloudBig = "M7.2 19.5h10.3a4.3 4.3 0 0 0 .5-8.57 6.2 6.2 0 0 0-11.9 1.4A3.6 3.6 0 0 0 7.2 19.5Z";
  const cloudHigh = "M7.2 15.5h10.3a4.3 4.3 0 0 0 .5-8.57 6.2 6.2 0 0 0-11.9 1.4A3.6 3.6 0 0 0 7.2 15.5Z";
  const cloudSide = "M10 20.5h8.2a3.6 3.6 0 0 0 .4-7.17 5.2 5.2 0 0 0-10-1.2A3.4 3.4 0 0 0 10 20.5Z";
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" className="db-sky">
      <defs>
        <radialGradient id="db-sun" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#ffe58a" /><stop offset="0.6" stopColor="#ffc233" /><stop offset="1" stopColor="#ff9a1f" /></radialGradient>
        <linearGradient id="db-moon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff6d6" /><stop offset="1" stopColor="#c9c3ff" /></linearGradient>
        <linearGradient id="db-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#bcc7d3" /></linearGradient>
        <linearGradient id="db-cloud-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c3ccd8" /><stop offset="1" stopColor="#7d8a9c" /></linearGradient>
        <linearGradient id="db-drop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fd3ff" /><stop offset="1" stopColor="#3b8cff" /></linearGradient>
        <linearGradient id="db-bolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff07a" /><stop offset="1" stopColor="#ffb020" /></linearGradient>
      </defs>
      {kind === "sun" ? <><path d={sunRays} stroke="#ffb627" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="12" r="5" fill="url(#db-sun)" /></> : null}
      {kind === "moon" ? <><path d="M19.5 14.8A8 8 0 0 1 9.2 4.5a8 8 0 1 0 10.3 10.3Z" fill="url(#db-moon)" /><circle cx="18" cy="5" r="0.9" fill="#fff6d6" /><circle cx="21" cy="9" r="0.6" fill="#fff6d6" /></> : null}
      {kind === "part" ? <><circle cx="8.5" cy="8.5" r="4.6" fill="url(#db-sun)" /><path d="M8.5 1.6v1.5M1.6 8.5h1.5M3.6 3.6l1 1M13.4 3.6l-1 1M3.6 13.4l1-1" stroke="#ffb627" strokeWidth="1.5" strokeLinecap="round" /><path d={cloudSide} fill="url(#db-cloud)" /></> : null}
      {kind === "cloud" ? <><path d="M14 9.5h5.5a2.8 2.8 0 0 0 .2-5.6 4 4 0 0 0-7.6.9" fill="url(#db-cloud-dark)" /><path d={cloudBig} fill="url(#db-cloud)" /></> : null}
      {kind === "fog" ? <><path d={cloudHigh} fill="url(#db-cloud)" opacity="0.9" /><path d="M4 18.5h16M6.5 21.5h11" stroke="#bcc7d3" strokeWidth="1.8" strokeLinecap="round" /></> : null}
      {kind === "rain" ? <><path d={cloudHigh} fill="url(#db-cloud-dark)" /><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3" stroke="url(#db-drop)" strokeWidth="2" strokeLinecap="round" /></> : null}
      {kind === "snow" ? <><path d={cloudHigh} fill="url(#db-cloud)" /><g fill="#dff1ff"><circle cx="8" cy="19" r="1.3" /><circle cx="12" cy="21.3" r="1.3" /><circle cx="16" cy="19" r="1.3" /></g></> : null}
      {kind === "storm" ? <><path d={cloudHigh} fill="url(#db-cloud-dark)" /><path d="M13 13.5l-3.6 5h3l-1.4 4.5 4.8-6.2h-3.1l1.6-3.3Z" fill="url(#db-bolt)" /></> : null}
    </svg>
  );
}

/** Weather now beside Customise, from Open-Meteo. Shows nothing until there is an answer. */
function WeatherChip() {
  const [w, setW] = useState<WeatherNow | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void loadWeatherNow().then((x) => { if (live && x) setW(x); });
    read();
    const timer = setInterval(read, 20 * 60_000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!w) return null;
  const words = sky(w.code);
  const range = w.highC != null && w.lowC != null ? t("H {high}° · L {low}°", { high: Math.round(w.highC), low: Math.round(w.lowC) }) : null;
  return (
    <p className="db-weather" title={t("Weather from Open-Meteo, where your latest route started")}>
      <SkyIcon kind={skyKind(w.code, w.isDay)} />
      <strong>{Math.round(w.tempC)}°</strong>
      {words ? <span>{words}</span> : null}
      {range ? <span className="db-weather-range">{range}</span> : null}
    </p>
  );
}

