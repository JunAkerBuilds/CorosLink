"use client";
import Image from "next/image";
import Link from "next/link";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button, Card, CountUp, LinkButton, OriginBadge, Switch } from "@/components/ui";
import { BodyAlertAura } from "@/components/viz/BodyAlertAura";
import { loadBody } from "@/data/body";
import { browserSpells, loadBodyAlert, setIllnessMode, type BodyAlertPage } from "@/data/bodyAlert";
import { useLoaded, type Origin } from "@/data/core";
import { useStore } from "@/data/local/store";
import {
  ALERT_LINE, LEARN_NIGHTS, LEVEL_TOP, LOOK_ADVICE, LOOK_HUE, LOOK_PILL, LOOK_TITLE, SIGNALS, alertNightsInRow, illnessDay, illnessSince, isOff,
  lastNight, lookLine, lookOf, nightHue, nightWords, signalChange, signalChart, signalTitle, signalValue,
  type AlertNight, type Look, type SignalName, type Spell,
} from "@/lib/bodyAlert";
import { parseDay } from "@/lib/format";
import { dayLabel } from "@/lib/health";

const ICON: Record<SignalName, string> = {
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5a4 4 0 0 1 7 2.5c0 5.5-7 10-7 10z",
  hrv: "M3 12h4l2-5 3 10 3-7 2 2h4",
  breathing: "M12 4v8M12 12c-2 1-3 0-4-2-2-4-5-1-5 4 0 4 1 6 4 6 3 0 5-2 5-5M12 12c2 1 3 0 4-2 2-4 5-1 5 4 0 4-1 6-4 6-3 0-5-2-5-5",
};
const SIGNAL_HUE: Record<SignalName, string> = { heart: "amber", hrv: "cyan", breathing: "sky" };
const TINT: Record<string, string> = { amber: "rgba(240,176,44,0.16)", cyan: "rgba(92,207,230,0.16)", sky: "rgba(125,211,252,0.16)" };
const GLOW: Record<Look | "off", string> = {
  alert: "rgba(255,107,129,0.22)", watch: "rgba(216,155,34,0.2)", clear: "rgba(83,203,161,0.2)", learning: "rgba(92,207,230,0.2)", settling: "rgba(165,148,255,0.2)", off: "rgba(139,151,146,0.14)",
};

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={d} /></svg>;
}

export default function BodyAlertRoute() {
  const state = useLoaded(loadBodyAlert);
  const body = useLoaded(loadBody);
  const stored = useStore(browserSpells, []);
  if (state.status === "loading") return <main className="page"><div className="skeleton" style={{ minHeight: 480 }} /></main>;
  if (state.status === "error") return <main className="page"><p className="notice" role="alert">Body Alert could not be loaded. {state.error.message}</p></main>;
  const synced = state.origin === "synced";
  const age = body.status === "ready" ? body.data.bodyAge : null;
  const yourAge = body.status === "ready" ? body.data.profile.age : null;
  return <BodyAlertScreen data={state.data} origin={state.origin} spells={synced ? state.data.spells : stored} bodyAge={age?.value ?? null} age={yourAge} />;
}

function BodyAlertScreen({ data, origin, spells, bodyAge, age }: { data: BodyAlertPage; origin: Origin; spells: Spell[]; bodyAge: number | null; age: number | null }) {
  const [problem, setProblem] = useState<string | null>(null);
  const alert = data.alert;
  const [now] = useState(() => Date.now());
  const since = illnessSince(spells, now);
  const illness = since != null;
  const toggle = () => setIllnessMode(!illness).catch((e: unknown) => setProblem(e instanceof Error ? e.message : "That didn't work. Nothing was changed."));

  const look: Look | "off" = !alert || !alert.on ? "off" : lookOf(alert.state);
  const night = alert ? lastNight(alert) : null;
  const strain = Object.fromEntries((night?.signals ?? []).map((s) => [s.signal, s.z])) as Partial<Record<SignalName, number>>;
  const inRow = alert ? alertNightsInRow(alert) : 0;
  const title = !alert ? "Nothing from your phone yet" : look === "off" ? "Body Alert is off" : LOOK_TITLE[look];
  const line = !alert ? "Update the C-LINK app on your phone, then Body Alert shows here after its next sync."
    : look === "off" ? "Turn it on in the C-LINK app on your phone to get a heads-up when your nights suggest your body may be fighting something, often before you feel it."
    : lookLine(look, night);
  const ink = look === "off" ? "var(--muted)" : `var(--h-${LOOK_HUE[look]}-ink)`;
  const orb = look === "learning" ? { label: "NIGHTS", value: `${alert!.nightsLearned}/${LEARN_NIGHTS}`, sub: "learning" }
    : look === "alert" ? { label: "NIGHT", value: String(Math.max(1, inRow)), sub: "above your usual" }
    : look === "watch" ? { label: "NIGHT", value: "1", sub: "a little off" }
    : look === "settling" ? { label: "NIGHTS", value: "Easing", sub: "back to usual" }
    : look === "clear" ? { label: "LAST NIGHT", value: "Usual", sub: "all signals" }
    : { label: "BODY ALERT", value: "Off", sub: "on your phone" };
  const advice = look === "off" ? null : LOOK_ADVICE[look];
  const paused = look === "alert" || look === "settling";
  const offNames = (night?.signals ?? []).filter(isOff).map((s) => `${signalTitle(s).toLowerCase()} ${signalChange(s)}`).join(", ");
  const ask = `About my Body Alert: ${title.toLowerCase()}${offNames ? ` (${offNames})` : ""}. What should I do with training today?`;

  return (
    <main className="page" style={{ gap: 22 }}>
      <div className="page-head">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px" }}>
          <div className="ba-crumb"><Link href="/health">Health</Link><span aria-hidden="true">/</span><Link href="/body">Body</Link><span aria-hidden="true">/</span><h1>Body Alert</h1></div>
          <OriginBadge origin={origin} />
        </div>
        {alert ? (
          <span className="ba-pill"><span aria-hidden="true" style={{ background: look === "off" ? "var(--dim)" : `var(--h-${LOOK_HUE[look]})` }} />{look === "off" ? "Off" : LOOK_PILL[look]}</span>
        ) : null}
      </div>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}

      <section aria-label="Tonight" className="ba-hero" style={{ ["--ba-glow" as string]: GLOW[look] }}>
        <BodyAlertAura look={look} strain={strain} nightsLearned={alert?.nightsLearned ?? 0} size={260}
          label={`${title}. ${(night?.signals ?? []).map((s) => `${signalTitle(s)} ${signalValue(s, s.value)}, usual ${signalValue(s, s.usual)}`).join("; ")}`}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", opacity: 0.9 }}>{orb.label}</span>
          <span className="num" style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.05 }}>{orb.value}</span>
          <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.92 }}>{orb.sub}</span>
        </BodyAlertAura>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="ba-eyebrow">TONIGHT · BODY ALERT</span>
          <h2 className="num" style={{ margin: 0, fontSize: 38, lineHeight: 1.12, fontWeight: 900, letterSpacing: "-0.01em", color: ink }}>{title}</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 560, fontSize: 15, lineHeight: 1.5 }}>{line}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
            {look === "alert" || look === "watch" || look === "settling" ? (
              <Button variant="primary" onClick={toggle}>{illness ? "Illness mode is on" : "Turn on illness mode"}</Button>
            ) : null}
            {alert ? (
              <LinkButton href={`/coach?ask=${encodeURIComponent(ask)}`}><Image src="/img/coach-head.webp" alt="" width={22} height={22} />Ask Coach about this</LinkButton>
            ) : null}
          </div>
        </div>
        {advice ? (
          <div className="ba-advice">
            <span style={{ color: ink }}><Icon d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7" size={16} />{advice.title}</span>
            <span className="muted">{advice.line}</span>
          </div>
        ) : null}
      </section>

      {illness ? (
        <div role="status" className="ba-illness">
          <span aria-hidden="true" className="ba-badge" style={{ background: "rgba(165,148,255,0.2)", color: "var(--h-violet-ink)" }}><Icon d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></span>
          <span style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 14 }}>Illness mode is on · Day {illnessDay(since!, now)}</strong>
            <span className="muted" style={{ fontSize: 13 }}>C-LINK and Coach are keeping things to rest and easy movement.{origin === "synced" ? " Your phone follows at its next sync." : ""}</span>
          </span>
          <Button onClick={toggle}>I feel better</Button>
        </div>
      ) : null}

      {alert && alert.nights.length ? (
        <>
          <div className="ba-two">
            <Card clip aria-label="Last night against your usual" style={{ flex: "2 1 640px" }}>
              <div className="ba-card-head" style={{ padding: "18px 20px 6px" }}>
                <h2 className="h2">Last night against your usual</h2>
                <span className="muted" style={{ fontSize: 12 }}>{alert.nights.length} nights · band = your usual range, after what training explains</span>
              </div>
              {SIGNALS.map((sig) => <SignalRow key={sig} signal={sig} nights={alert.nights} learning={look === "learning"} />)}
            </Card>
            <Card pad aria-label="Body age" style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="ba-card-head">
                <h2 className="h2">Body age</h2>
                {paused ? <span className="ba-paused"><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="3" height="8" rx="1" fill="currentColor" /><rect x="6" y="1" width="3" height="8" rx="1" fill="currentColor" /></svg>Paused</span> : null}
              </div>
              {bodyAge != null ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <CountUp className="num" style={{ fontSize: 44, fontWeight: 900 }} text={bodyAge.toFixed(1)} />
                  {age != null ? <span style={{ fontSize: 14, fontWeight: 700, color: "var(--h-mint-ink)" }}>{Math.abs(age - bodyAge).toFixed(1)} years {bodyAge <= age ? "younger" : "older"}</span> : null}
                </div>
              ) : <span className="muted">Nothing from your phone yet</span>}
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                {paused ? "Body age waits while Body Alert is on, so a few off nights don't move it. It picks up again at the next weekly update." : "Updated weekly. Nights inside a Body Alert are left out."}
              </p>
              <Link href="/body" className="ba-more">Open Body<Icon d="M9 5l7 7-7 7" size={14} /></Link>
            </Card>
          </div>
          <NightsChart nights={alert.nights} />
        </>
      ) : null}

      <div className="ba-three">
        <Card pad aria-label="Illness mode" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="ba-card-head">
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span aria-hidden="true" className="ba-badge" style={{ background: "rgba(165,148,255,0.16)", color: "var(--h-violet-ink)" }}><Icon d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></span><h2 className="h2">Illness mode</h2></span>
            <Switch checked={illness} onChange={() => toggle()} label="Illness mode" />
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Feeling unwell? Illness mode sets C-LINK and Coach to rest and easy movement until you’re better.</p>
          <p className="ba-note">It checks in after three days and turns itself off after a week. Readiness, Fuel and the strength suggestion follow it.</p>
        </Card>
        <Card pad aria-label="How Body Alert works" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="h2">How it works</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.45 }}>
            <li>Watches your sleeping heart rate, HRV and breathing every night you wear the watch.</li>
            <li>Learns your usual over two weeks, then keeps to the last four.</li>
            <li>Leaves out what your training explains, so a hard day isn’t an alert.</li>
          </ul>
          <p className="ba-note">Your nights are worked out on your phone. The web shows what the phone sends.</p>
        </Card>
        <Card pad aria-label="Not a medical device" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span aria-hidden="true" className="ba-badge" style={{ background: "rgba(255,107,129,0.16)", color: "var(--h-rose-ink)" }}><Icon d="M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5" /></span><h2 className="h2">Not a medical device</h2></span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>If you have a fever, chest pain, trouble breathing or a racing heart at rest, don’t train, and talk to a doctor.</p>
          <p className="ba-note">Body Alert can’t tell you whether you’re ill. Alcohol, stress, travel and altitude can raise these numbers too.</p>
        </Card>
      </div>
    </main>
  );
}

function SignalRow({ signal, nights, learning }: { signal: SignalName; nights: AlertNight[]; learning: boolean }) {
  const last = [...nights].reverse().find((n) => n.signals.some((s) => s.signal === signal));
  const r = last?.signals.find((s) => s.signal === signal);
  const chart = signalChart(nights, signal, 280, 56);
  const hue = SIGNAL_HUE[signal];
  const off = r ? isOff(r) : false;
  return (
    <div className="ba-signal">
      <span aria-hidden="true" className="ba-badge ba-badge-lg" style={{ background: TINT[hue], color: `var(--h-${hue}-ink)` }}><Icon d={ICON[signal]} size={22} /></span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{r ? signalTitle(r) : signal === "heart" ? "Sleeping heart rate" : signal === "hrv" ? "HRV" : "Breathing rate"}</span>
        <span className="muted" style={{ fontSize: 13 }}>{r ? `${signalValue(r, r.value)} · Usual ${signalValue(r, r.usual)}` : "No reading last night"}</span>
      </span>
      {chart ? (
        <svg role="img" aria-label={`${r ? signalTitle(r) : signal} over ${nights.length} nights against your usual range`} width="100%" height="56" viewBox="0 0 280 56" preserveAspectRatio="none" className="no-wipe" style={{ overflow: "visible" }}>
          <path d={chart.band} style={{ fill: TINT[hue] }} />
          <path d={chart.line} fill="none" style={{ stroke: `var(--h-${hue})`, strokeWidth: 2, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }} />
          {chart.dot ? <path d={`M${chart.dot.x} ${chart.dot.y}h0.01`} fill="none" style={{ stroke: `var(--h-${hue})`, strokeWidth: 9, strokeLinecap: "round", vectorEffect: "non-scaling-stroke" }} /> : null}
        </svg>
      ) : <span />}
      <span className={`ba-chip ${learning ? "" : off ? "ba-chip-off" : "ba-chip-ok"}`}>{learning ? "Learning" : !r ? "—" : off ? signalChange(r) : "Usual"}</span>
    </div>
  );
}

function NightsChart({ nights }: { nights: AlertNight[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const N = nights.length, W = 560, H = 180, slot = W / N, bar = Math.max(4, slot * 0.6);
  const Y = (v: number) => H - (Math.min(v, LEVEL_TOP) / LEVEL_TOP) * (H - 8);
  const readout = hover == null ? "Point at a night" : `${dayLabel(parseDay(nights[hover].day))}  ·  ${nightWords(nights[hover])}`;
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) setHover(Math.max(0, Math.min(N - 1, Math.floor(((e.clientX - r.left) / r.width) * N))));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(N - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? N) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  return (
    <Card pad aria-label="Nights" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ba-card-head"><h2 className="h2">Nights</h2><span aria-live="polite" style={{ fontSize: 13, fontWeight: 600 }}>{readout}</span></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div aria-hidden="true" style={{ flex: "none", width: 54, position: "relative", height: H, fontSize: 11, color: "var(--dim)" }}>
          <span style={{ position: "absolute", top: 0 }}>Further</span>
          <span style={{ position: "absolute", top: Y(ALERT_LINE), transform: "translateY(-50%)", color: "var(--h-rose-ink)", fontWeight: 700 }}>Counts</span>
          <span style={{ position: "absolute", bottom: 0 }}>Usual</span>
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg role="img" aria-label={`How far each of the last ${N} nights was from your usual, with the alert line`} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
            <path d={`M0 ${H * 0.25}H${W}M0 ${H * 0.5}H${W}M0 ${H * 0.75}H${W}`} fill="none" style={{ stroke: "var(--line)", vectorEffect: "non-scaling-stroke" }} />
            {hover != null ? <rect x={hover * slot} y="0" width={slot} height={H} style={{ fill: "rgba(var(--fg-rgb), 0.06)" }} /> : null}
            {nights.map((n, i) => {
              const hue = nightHue(n), x = i * slot + (slot - bar) / 2, last = i === N - 1;
              if (!hue) return <circle key={n.day} cx={i * slot + slot / 2} cy={H - 3} r={2} style={{ fill: "var(--dim)", opacity: 0.5 }} />;
              const y = Math.min(Y(Math.max(n.level, 0.25)), H - bar);
              return (
                <g key={n.day}>
                  <rect x={x} y={y} width={bar} height={H - y} rx={bar / 2} style={{ fill: `var(--h-${hue})`, opacity: last ? 1 : 0.75, filter: last ? `drop-shadow(0 0 6px var(--h-${hue}))` : undefined }} />
                  {last ? <circle cx={x + bar / 2} cy={y + bar * 0.5} r={bar * 0.22} style={{ fill: "#ffffff" }} /> : null}
                </g>
              );
            })}
            <path d={`M0 ${Y(ALERT_LINE)}H${W}`} fill="none" style={{ stroke: "var(--h-rose)", strokeDasharray: "6 6", vectorEffect: "non-scaling-stroke" }} />
          </svg>
          <div className="chart-hit" role="slider" tabIndex={0} aria-label="Night" aria-valuemin={0} aria-valuemax={N - 1} aria-valuenow={hover ?? N - 1}
            aria-valuetext={readout} onPointerMove={point} onPointerDown={point} onPointerLeave={() => setHover(null)} onKeyDown={key} />
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, marginTop: 6, textAlign: "center", fontSize: 11, color: "var(--dim)" }}>
            {nights.map((n, i) => <span key={n.day}>{(N - 1 - i) % 7 === 0 ? parseDay(n.day).getDate() : ""}</span>)}
          </div>
        </div>
      </div>
      <div className="ba-legend">
        <span><i style={{ background: "var(--h-mint)" }} />In your usual range</span>
        <span><i style={{ background: "var(--h-gold)" }} />Off your usual</span>
        <span><i style={{ background: "var(--h-rose)" }} />Well off</span>
        <span><i style={{ background: "var(--h-violet)" }} />During an alert</span>
        <span><i className="ba-dash" />Alert line</span>
      </div>
      <p className="ba-note">Taller bars were further from your usual. Above the dashed line, a night counts towards a Body Alert.</p>
    </Card>
  );
}
