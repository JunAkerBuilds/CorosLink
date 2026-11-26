/** Body Alert's words and numbers on the web, ported from the phone's BodyAlertViews.swift / BodyAlertArt.swift. Pure. */
import { language, locale, msg, t } from "@/lib/i18n";

export type BodyAlertState = "learning" | "normal" | "watch" | "strain" | "strainHigh" | "recovering";
export type NightClass = "noData" | "statusOnly" | "normal" | "deviating" | "strong";
export type SignalName = "heart" | "hrv" | "breathing";
/** The phone's looks: the colour and words follow these. */
export type Look = "learning" | "clear" | "watch" | "alert" | "settling";

export interface SignalReading { signal: SignalName; channel: string; value: number; usual: number; spread: number; z: number }
export interface AlertNight { day: string; state: BodyAlertState; nightClass: NightClass; level: number; signals: SignalReading[] }

export interface BodyAlertData {
  on: boolean;
  state: BodyAlertState;
  nightsLearned: number;
  /** Oldest first, up to 28. */
  nights: AlertNight[];
}

export const SIGNALS: readonly SignalName[] = ["heart", "hrv", "breathing"];
/** The alert line on the nights chart, and the chart's top, in the phone's level units. */
export const ALERT_LINE = 2.5;
export const LEVEL_TOP = 6;
export const LEARN_NIGHTS = 14;

export function lookOf(state: BodyAlertState): Look {
  switch (state) {
    case "learning": return "learning";
    case "normal": return "clear";
    case "watch": return "watch";
    case "strain": case "strainHigh": return "alert";
    case "recovering": return "settling";
  }
}

/** Hue token per look (BodyAlertStatus.tint): learning hrv, clear recovery, watch gold, alert heart, settling sleep. */
export const LOOK_HUE: Record<Look, "cyan" | "mint" | "gold" | "rose" | "violet"> = {
  learning: "cyan", clear: "mint", watch: "gold", alert: "rose", settling: "violet",
};

export const LOOK_TITLE: Record<Look, string> = {
  learning: msg("Learning your usual"),
  clear: msg("All in your usual range"),
  watch: msg("Last night was a little off"),
  alert: msg("Your body may be fighting something"),
  settling: msg("Settling back"),
};

export const LOOK_PILL: Record<Look, string> = { learning: msg("Learning"), clear: msg("Usual"), watch: msg("A little off"), alert: msg("Body Alert"), settling: msg("Settling") };

/** What to do, in a few words, and in a line. */
export const LOOK_ADVICE: Record<Look, { title: string; line: string }> = {
  learning: { title: msg("Keep wearing your watch to bed"), line: msg("Body Alert starts after about two weeks of nights.") },
  clear: { title: msg("Nothing to change"), line: msg("Train as planned.") },
  watch: { title: msg("Train as planned, keep an eye on it"), line: msg("Nothing changes yet. A second night like this would raise a Body Alert.") },
  alert: { title: msg("An easy day or rest may help"), line: msg("Keep today to rest and easy movement until your nights settle.") },
  settling: { title: msg("Ease back in"), line: msg("Start with easy sessions while your nights come back to your usual.") },
};

export function signalTitle(r: Pick<SignalReading, "signal" | "channel">): string {
  if (r.signal === "heart") return r.channel === "restingHR" ? t("Resting heart rate") : t("Sleeping heart rate");
  return r.signal === "hrv" ? "HRV" : t("Breathing rate");
}

/** HRV channels are ln ms. */
const shown = (r: Pick<SignalReading, "signal">, v: number) => (r.signal === "hrv" ? Math.exp(v) : v);

/** The reading as the athlete knows it: "57 bpm", "80 ms", "14.4 brpm". */
export function signalValue(r: Pick<SignalReading, "signal">, v: number): string {
  if (r.signal === "heart") return `${Math.round(v)} bpm`;
  if (r.signal === "hrv") return `${Math.round(Math.exp(v))} ms`;
  return `${v.toFixed(1)} brpm`;
}

const sign = (n: number, text: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${text}`;

/** How far it is from usual: "+4 bpm", "−12%", "+1.2 brpm". */
export function signalChange(r: SignalReading): string {
  const d = r.value - r.usual;
  if (r.signal === "heart") { const bpm = Math.round(d); return sign(bpm, `${Math.abs(bpm)} bpm`); }
  if (r.signal === "hrv") { const pct = Math.round((Math.exp(d) - 1) * 100); return sign(pct, `${Math.abs(pct)}%`); }
  const b = Math.round(d * 10) / 10;
  return sign(b, `${Math.abs(b).toFixed(1)} brpm`);
}

/** A signal is off when it's a spread or more towards strain, as the phone counts it. */
export const isOff = (r: SignalReading): boolean => r.z >= 1;

/** A reading's colour: calm, a little off, or well off towards strain. */
export const toneHue = (z: number): "mint" | "gold" | "rose" => (z >= 2 ? "rose" : z >= 1 ? "gold" : "mint");

/** The newest night that had any signal. */
export function lastNight(d: BodyAlertData): AlertNight | null {
  for (let i = d.nights.length - 1; i >= 0; i--) if (d.nights[i].nightClass !== "noData" && d.nights[i].signals.length) return d.nights[i];
  return null;
}

/** The line under the title, naming what was off ("Your nights have been above your usual: resting heart rate +3 bpm."). */
export function lookLine(look: Look, night: AlertNight | null): string {
  const off = (night?.signals ?? []).filter(isOff).map((r) => `${signalTitle(r).toLowerCase()} ${signalChange(r)}`);
  const list = off.length > 1
    ? language() === "en" ? `${off.slice(0, -1).join(", ")} and ${off.at(-1)}` : new Intl.ListFormat(locale(), { type: "conjunction" }).format(off)
    : off[0];
  switch (look) {
    case "learning": return t("Sleep with your watch on. Body Alert starts after about two weeks of nights.");
    case "clear": return t("Last night's heart rate, HRV and breathing looked like you.");
    case "watch": return list ? t("Off your usual: {list}. One night is often nothing. If it happens again tonight, Body Alert will tell you.", { list }) : t("One night is often nothing. If it happens again tonight, Body Alert will tell you.");
    case "alert": return list ? t("Your nights have been above your usual: {list}. An easy day or rest may help.", { list }) : t("Your nights have been above your usual. An easy day or rest may help.");
    case "settling": return t("Your nights are heading back to your usual. Ease back into training.");
  }
}

/** Nights in a row up to the newest that counted towards the alert (deviating or strong). */
export function alertNightsInRow(d: BodyAlertData): number {
  let n = 0;
  for (let i = d.nights.length - 1; i >= 0; i--) {
    const c = d.nights[i].nightClass;
    if (c === "deviating" || c === "strong") n++;
    else if (c !== "noData") break;
  }
  return n;
}

/** The colour of a night's bar on the chart (BodyAlertTrail): strong heart, deviating gold, else violet in an episode, else mint. */
export function nightHue(n: AlertNight): "rose" | "gold" | "violet" | "mint" | null {
  if (n.nightClass === "noData" || n.signals.length === 0) return null;
  if (n.nightClass === "strong") return "rose";
  if (n.nightClass === "deviating") return "gold";
  return n.state === "strain" || n.state === "strainHigh" || n.state === "recovering" ? "violet" : "mint";
}

export function nightWords(n: AlertNight): string {
  if (n.nightClass === "noData" || n.signals.length === 0) return t("no reading");
  if (n.nightClass === "statusOnly") return t("too few signals to count");
  if (n.nightClass === "strong") return t("well off your usual, counts towards an alert");
  if (n.nightClass === "deviating") return t("off your usual, counts towards an alert");
  return t("in your usual range");
}

/** One signal's line over the nights, the usual band around it, scaled into `w`×`h`. Gaps where a night had no reading. */
export function signalChart(nights: readonly AlertNight[], signal: SignalName, w: number, h: number) {
  const rows = nights.map((n) => n.signals.find((s) => s.signal === signal) ?? null);
  const have = rows.filter((r): r is SignalReading => r != null);
  if (!have.length) return null;
  const vals = have.flatMap((r) => [shown(r, r.value), shown(r, r.usual - r.spread), shown(r, r.usual + r.spread)]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const X = (i: number) => (nights.length <= 1 ? w : (i / (nights.length - 1)) * w);
  const Y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  let line = "", top = "", bottom = "", pen = false;
  rows.forEach((r, i) => {
    if (!r) { pen = false; return; }
    line += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(shown(r, r.value)).toFixed(1)}`;
    pen = true;
  });
  const banded = rows.map((r, i) => (r ? { x: X(i), a: Y(shown(r, r.usual + r.spread)), b: Y(shown(r, r.usual - r.spread)) } : null)).filter((p): p is { x: number; a: number; b: number } => p != null);
  top = banded.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)} ${p.a.toFixed(1)}`).join("");
  bottom = [...banded].reverse().map((p) => `L${p.x.toFixed(1)} ${p.b.toFixed(1)}`).join("");
  const last = rows.at(-1);
  return { line, band: banded.length ? `${top}${bottom}Z` : "", dot: last ? { x: X(rows.length - 1), y: Y(shown(last, last.value)) } : null };
}

/* ---------- Illness mode ---------- */

export interface Spell { start: number; end?: number }

/** The open spell's start (ms) when Illness mode is on, else null. */
export const illnessSince = (spells: readonly Spell[], now: number): number | null => {
  const last = spells.at(-1);
  if (!last || last.end != null) return null;
  // It turns itself off after a week, as on the phone.
  return now - last.start > 7 * 86_400_000 ? null : last.start;
};

/** Spells after turning Illness mode on or off at `now` (ms). */
export function illnessToggled(spells: readonly Spell[], on: boolean, now: number): Spell[] {
  const out = spells.map((s) => ({ ...s }));
  const last = out.at(-1);
  if (on) { if (!last || last.end != null) out.push({ start: now }); }
  else if (last && last.end == null) last.end = Math.max(now, last.start);
  return out;
}

/** Day of the spell, 1 on the day it started. */
export const illnessDay = (start: number, now: number): number => Math.max(1, Math.floor((now - start) / 86_400_000) + 1);
