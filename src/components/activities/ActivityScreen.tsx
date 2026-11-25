"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, CountUp, LinkButton, OriginBadge } from "@/components/ui";
import { ActivityChartStack, type ChartRow } from "@/components/viz/ActivityChartStack";
import { ActivityRoutePlayback } from "@/components/viz/ActivityRoutePlayback";
import { compareActivity, exportActivityFit, getActivity, type ActivityDetail, type Lap, type Sport, type Streams, type ZoneTime } from "@/data/activities";
import { useLoaded, type Origin } from "@/data/core";
import { axisTicks, formatDayTime, formatDistance, formatPaceValue, nearestSample, paceOver, paceUnit, parseStart } from "@/lib/activities";
import {
  decoupling, decouplingTitle, EFFORT_LEVELS, effortIndex, exact, findClimbs, hrZoneOf, hrZoneRange, hrZonesFromThreshold, intensityLabel,
  lapsAreAutomatic, pacingFinding, pacingSplit, paceZoneOf, paceZoneRange, PACE_ZONE_RATIOS, powerNumbers, powerZoneOf, POWER_ZONE_NAMES, powerZoneRange,
  rowsFromLaps, sessionNumbers, splitsFromTrack, swimNumbers, thresholdPaceSentence, thresholdPercent, timeInZones, totalRow, trackOf,
  variabilityLabel, workoutKind, ZONE_HUES, zoneShares, type Climb, type Finding, type SplitRow, type Track,
} from "@/lib/activityDetail";
import { extent } from "@/lib/chart";
import { clock, thousands } from "@/lib/format";
import {
  EffortCard, FindingsCard, GearCard, JournalCard, MissingCard, RecordsCard, RelativeEffortCard, StatGrid, SummaryCard, ThresholdMeter, TimeCard, WeatherCard, WeekCard,
  ZoneBar, ZoneCard, ZoneRows, type Stat, type ZoneLine,
} from "./parts";
import { SplitsCard, type SplitChoice } from "./SplitsCard";
import { ExercisesSection, hasRests, MusclesCard, RestCard, SessionCard, TimelineCard, VolumeCard } from "./StrengthSections";
import { LengthChart, LengthsTable, SwimCard, SwimSetsCard } from "./SwimSections";
import "@/app/(app)/activities/activities.css";
import "@/app/(app)/activities/activity.css";

const SPORT_STYLE: Record<Sport, { hue: string; tint: string }> = {
  Run: { hue: "mint", tint: "rgba(83,203,161,0.16)" },
  Ride: { hue: "blue", tint: "rgba(106,165,255,0.16)" },
  Strength: { hue: "orange", tint: "rgba(255,169,77,0.16)" },
  Swim: { hue: "cyan", tint: "rgba(92,207,230,0.16)" },
  Other: { hue: "violet", tint: "rgba(165,148,255,0.16)" },
};
const EFFORT_TINT = ["rgba(92,207,230,0.16)", "rgba(83,203,161,0.16)", "rgba(216,155,34,0.16)", "rgba(255,122,89,0.16)", "rgba(255,107,129,0.16)"];
const zoneColor = (i: number) => `var(--h-${ZONE_HUES[i] ?? "violet"})`;
/** A chart is drawn only with enough readings to mean something. */
const enough = (v: readonly number[] | null | undefined): v is number[] => !!v && v.length >= 8;
const round = (v: number) => String(Math.round(v));

export function ActivityScreen({ id }: { id: string }) {
  const state = useLoaded(() => getActivity(id), id);
  const frame = (children: ReactNode) => <main className="page" style={{ paddingTop: 24, gap: 20 }}>{children}</main>;

  if (state.status === "loading") return frame(<div className="skeleton" style={{ minHeight: 520 }} aria-busy="true" aria-label="Loading activity" />);
  if (state.status === "error") {
    return frame(
      <div className="notice" role="alert">
        <span style={{ flex: 1, minWidth: 0 }}>{state.error.message}</span>
        <Button onClick={state.reload}>Try again</Button>
      </div>,
    );
  }
  if (!state.data) {
    return frame(
      <>
        <nav aria-label="Breadcrumb" className="act-crumb"><Link href="/activities">Activities</Link></nav>
        <h1 className="ad-title">Activity not found</h1>
        <div><LinkButton href="/activities">Back to activities</LinkButton></div>
      </>,
    );
  }
  return frame(<Detail key={id} detail={state.data} origin={state.origin} />);
}

/** Everything the layouts share, worked out once from the detail. */
interface Model {
  detail: ActivityDetail;
  origin: Origin;
  track: Track | null;
  index: number;
  setIndex: (i: number) => void;
  /** Metres and seconds at the marker. */
  atM: number | null;
  atS: number | null;
  percent: number | null;
  level: number;
  hrZones: ZoneTime[];
  hue: string;
  chosen: SplitChoice;
  choose: (c: SplitChoice) => void;
  /**
   * A card for a section the phone has sent nothing for, at the section's usual size. Null for the sample
   * athlete (whose cards are simply not drawn) and for sports with no layout of their own.
   */
  miss: (title: string, flex?: string, minHeight?: number) => ReactNode;
}

function Detail({ detail, origin }: { detail: ActivityDetail; origin: Origin }) {
  const { activity: a, streams } = detail;
  const n = streams?.x.length ?? 0;
  const [picked, setIndex] = useState(() => Math.round(Math.max(0, n - 1) * 0.5625));
  // A recording re-read by the phone can come back shorter.
  const index = Math.min(picked, Math.max(0, n - 1));
  const [chosen, setChosen] = useState<SplitChoice>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const track = useMemo(() => (streams ? trackOf(streams, a.sport, a.durationS) : null), [streams, a.sport, a.durationS]);
  const thresholdHr = detail.thresholds?.hr;
  const hrZones = useMemo(() => {
    if (detail.zones.some((z) => z.seconds > 0)) return detail.zones;
    if (!thresholdHr || !streams?.hr || !track) return [];
    const zones = hrZonesFromThreshold(thresholdHr);
    const seconds = timeInZones(streams.hr, track.dt, (v) => hrZoneOf(zones, v), zones.length, (v) => v <= 30);
    return zones.map((z, i) => ({ ...z, seconds: seconds[i] }));
  }, [detail.zones, thresholdHr, streams, track]);

  const percent = thresholdPercent(a.avgHr, thresholdHr);
  const level = percent == null ? 0 : effortIndex(percent);
  const style = SPORT_STYLE[a.sport];
  const expects = origin === "synced" && a.sport !== "Other";
  const model: Model = {
    miss: (title, flex, minHeight) => (expects ? <MissingCard key={title} title={title} style={{ flex, minHeight }} /> : null),
    detail, origin, track, index, setIndex, percent, level, hrZones, hue: style.hue, chosen,
    atM: track?.dist ? track.dist[index] ?? null : null,
    atS: track ? track.time[index] ?? null : null,
    choose: (c) => {
      setChosen(c);
      if (c && track?.dist) setIndex(nearestSample(track.dist, (c.fromM + c.toM) / 2));
    },
  };

  const refuse = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e));
  const share = async () => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: a.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice("Link copied.");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNotice("This browser would not share or copy the link.");
    }
  };

  return (
    <>
      <div className="act-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <nav aria-label="Breadcrumb" className="act-crumb">
            <Link href="/activities">Activities</Link><span aria-hidden="true">/</span>
            <span>{formatDayTime(a.start)}{detail.extras?.device ? ` · ${detail.extras.device}` : ""}</span>
          </nav>
          <h1 className="ad-title">
            {a.name}
            <span className="ad-chip" style={{ background: style.tint, color: `var(--h-${style.hue}-ink)` }}>{a.sportName ?? a.sport}</span>
            {percent != null && a.sport !== "Strength" ? (
              <span className="ad-chip" style={{ background: EFFORT_TINT[level], color: `var(--h-${EFFORT_LEVELS[level].hue}-ink)` }}>{EFFORT_LEVELS[level].title} effort</span>
            ) : null}
          </h1>
        </div>
        <div className="actions">
          <OriginBadge origin={origin} />
          {a.sport === "Strength" ? null : (
            <>
              <Button onClick={() => compareActivity(a.id).catch(refuse)}>Compare</Button>
              <Button onClick={() => exportActivityFit(a.id).catch(refuse)}>Export FIT</Button>
            </>
          )}
          <Button variant="primary" onClick={share}>Share</Button>
        </div>
      </div>

      {notice ? (
        <div className="notice" role="status">
          <span style={{ flex: 1, minWidth: 0 }}>{notice}</span>
          <Button variant="plain" onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      ) : null}

      {a.sport === "Strength" ? <StrengthLayout m={model} /> : a.sport === "Swim" ? <SwimLayout m={model} /> : <PaceLayout m={model} />}
    </>
  );
}

// ------------------------------------------------------------ shared pieces

function Headline({ m, items, narrow }: { m: Model; items: { label: string; value: ReactNode; text?: string }[]; narrow?: boolean }) {
  const { activity: a } = m.detail;
  return (
    <Card aria-label="Headline" className="ad-headline" data-narrow={narrow || undefined}>
      {items.map((s) => (
        <div key={s.label}><span>{s.label}</span>{s.text ? <CountUp className="num" text={s.text} /> : <span className="num">{s.value}</span>}</div>
      ))}
      {m.percent != null ? (
        <div className="ad-meter">
          <div><span>{Math.round(m.percent)}% of threshold heart rate</span>{a.load != null ? <span className="ad-load">Load {a.load}</span> : null}</div>
          <ThresholdMeter percent={m.percent} label={`Average heart rate at ${Math.round(m.percent)} percent of threshold: ${EFFORT_LEVELS[m.level].title.toLowerCase()} effort`} />
        </div>
      ) : a.load != null ? (
        <div><span>Training load</span><CountUp className="num" style={{ color: "var(--h-pink-ink)" }} text={String(a.load)} /></div>
      ) : null}
    </Card>
  );
}

function paceItems(m: Model): { label: string; value: ReactNode; text?: string }[] {
  const { activity: a } = m.detail;
  const unit = paceUnit(a.sport);
  const items: { label: string; value: ReactNode; text?: string }[] = [];
  if (a.distanceM != null) items.push({ label: "Distance", value: null, text: formatDistance(a) });
  if (a.durationS > 0) items.push({ label: "Time", value: null, text: exact(a.durationS) });
  const pace = paceOver(a.sport, a.distanceM, a.durationS);
  if (unit && pace != null) {
    items.push(unit === "min/100m"
      ? { label: "Avg pace", value: <>{clock(Math.round(pace))} <small>/100 m</small></> }
      : { label: unit === "km/h" ? "Avg speed" : "Avg pace", value: null, text: formatPaceValue(a.sport, pace) });
  }
  if (a.calories != null) items.push({ label: "Calories", value: null, text: `${thousands(a.calories)} kcal` });
  else if (a.avgHr != null && m.percent == null) items.push({ label: "Avg heart rate", value: null, text: `${a.avgHr} bpm` });
  return items;
}

function hrZoneLines(zones: readonly ZoneTime[]): ZoneLine[] {
  const named = zones.length === EFFORT_LEVELS.length;
  return zoneShares(zones).rows.map((z, i) => ({
    name: named ? `Z${i + 1} ${EFFORT_LEVELS[i].title}` : `Zone ${z.zone}`, range: hrZoneRange(z), seconds: z.seconds, share: z.share, color: zoneColor(i),
  }));
}

function mostly(lines: readonly ZoneLine[], titles: readonly string[], meanings?: readonly string[]): string | undefined {
  if (!lines.some((l) => l.seconds > 0)) return undefined;
  let main = 0;
  lines.forEach((l, i) => { if (l.seconds > lines[main].seconds) main = i; });
  return `Mostly ${titles[main]}: ${Math.round(lines[main].share * 100)}% of the time.${meanings?.[main] ? ` ${meanings[main]}` : ""}`;
}

function HrZones({ m, style, missing }: { m: Model; style?: React.CSSProperties; missing?: boolean }) {
  if (!m.hrZones.some((z) => z.seconds > 0)) return missing ? m.miss("Heart rate zones", undefined, 220) : null;
  const lines = hrZoneLines(m.hrZones);
  const five = lines.length === EFFORT_LEVELS.length;
  const thr = m.detail.thresholds?.hr;
  return (
    <ZoneCard
      title="Heart rate zones" aside={thr ? `Threshold ${Math.round(thr)} bpm` : undefined} zones={lines} style={style}
      sentence={five ? mostly(lines, EFFORT_LEVELS.map((l) => l.title), EFFORT_LEVELS.map((l) => l.meaning)) : undefined}
    />
  );
}

/** The watch's own laps: workout steps when the activity followed a workout, else laps that are not just the automatic splits. */
function watchLaps(detail: ActivityDetail): Lap[] | null {
  if (detail.steps?.length) return detail.steps;
  if (detail.laps.length >= 2 && !lapsAreAutomatic(detail.laps)) return detail.laps;
  return null;
}

function lapMarks(laps: readonly Lap[] | null, streams: Streams): number[] {
  if (!laps) return [];
  const byDistance = streams.axis === "distance";
  const total = streams.x[streams.x.length - 1] || 1;
  let at = 0;
  return laps.slice(0, -1).map((l) => { at += byDistance ? l.distanceM ?? 0 : l.durationS; return at / total; });
}

function positionText(m: Model): string {
  const { activity: a } = m.detail;
  const parts: string[] = [];
  if (m.atM != null) parts.push(a.sport === "Swim" ? `${thousands(m.atM)} m` : `${(m.atM / 1000).toFixed(2)} km`);
  if (m.atS != null) parts.push(clock(Math.round(m.atS)));
  return parts.join(" · ");
}

function chartRows(m: Model): ChartRow[] {
  const { activity: a, streams, scales, labels, thresholds } = m.detail;
  if (!streams || !scales) return [];
  const rows: ChartRow[] = [];
  const unit = paceUnit(a.sport);
  const ends = (v: readonly number[], text: (x: number) => string, u: string) => `from ${text(Math.min(...v))} to ${text(Math.max(...v))} ${u}`;
  if (enough(streams.pace) && scales.pace && unit) {
    const avg = paceOver(a.sport, a.distanceM, a.durationS);
    if (unit === "km/h") {
      const text = (v: number) => v.toFixed(1);
      rows.push({
        key: "speed", label: "Speed", sub: `${avg != null ? `Avg ${avg.toFixed(1)} km/h · ` : ""}Max ${Math.max(...streams.pace).toFixed(1)} km/h`, height: 110,
        values: streams.pace, low: scales.pace[0], high: scales.pace[1], text, unit: "km/h", describe: labels?.pace ?? `Speed ${ends(streams.pace, text, "km/h")}`,
        draw: { kind: "line", color: "var(--h-mint)", area: true },
      });
    } else {
      const u = unit === "min/km" ? "/km" : "/100 m";
      const text = (v: number) => clock(Math.round(v));
      const thr = a.sport === "Run" && unit === "min/km" ? thresholds?.paceSPerKm : undefined;
      rows.push({
        key: "pace", label: "Pace", sub: `${avg != null ? `Avg ${text(avg)} ${u} · ` : ""}Best ${text(Math.min(...streams.pace))} ${u}`, height: 120,
        // Faster is up: the slowest pace of the scale sits at the bottom.
        values: streams.pace, low: scales.pace[1], high: scales.pace[0], text, unit: u, describe: labels?.pace ?? `Pace ${ends(streams.pace, text, u)}`,
        draw: thr ? { kind: "zones", zoneOf: (v) => paceZoneOf(v, thr), colors: ZONE_HUES.map((_, i) => zoneColor(i)), avg: avg ?? undefined } : { kind: "line", color: `var(--h-${m.hue})` },
      });
    }
  }
  if (enough(streams.hr) && scales.hr) {
    const zones = m.hrZones;
    const banded = zones.length > 1 && zones.slice(1).every((z) => z.fromBpm != null);
    rows.push({
      key: "hr", label: "Heart rate", sub: [a.avgHr != null ? `Avg ${a.avgHr} bpm` : "", a.maxHr != null ? `Max ${a.maxHr} bpm` : ""].filter(Boolean).join(" · "), height: 120,
      values: streams.hr, low: scales.hr[0], high: scales.hr[1], text: round, unit: "bpm", describe: labels?.hr ?? `Heart rate ${ends(streams.hr, round, "bpm")}`,
      draw: banded ? { kind: "zones", zoneOf: (v) => hrZoneOf(zones, v), colors: zones.map((_, i) => zoneColor(i)), avg: a.avgHr ?? undefined } : { kind: "line", color: "var(--h-rose)", area: true },
    });
  }
  const plain = (key: string, label: string, values: number[], u: string, color: string, avg: number | null | undefined) => {
    const [lo, hi] = extent(values, (Math.max(...values) - Math.min(...values)) * 0.12 || 1);
    rows.push({
      key, label, sub: `${avg != null ? `Avg ${Math.round(avg)} ${u} · ` : ""}Max ${Math.round(Math.max(...values))} ${u}`, height: 96,
      values, low: Math.max(0, lo), high: hi, text: round, unit: u, describe: `${label} ${ends(values, round, u)}`, draw: { kind: "line", color, area: true },
    });
  };
  if (enough(streams.power)) plain("power", "Power", streams.power, "W", "var(--h-gold)", a.avgPowerW ?? (m.track ? powerNumbers(m.track, streams.power, null).avg : null));
  if (enough(streams.cadence)) plain("cadence", "Cadence", streams.cadence, a.sport === "Ride" ? "rpm" : "spm", "var(--h-blue)", a.cadence);
  if (enough(streams.elevation) && scales.elevation) {
    const whole = m.track?.dist ? totalClimb(m, streams) : null;
    const lo = Math.min(...streams.elevation), hi = Math.max(...streams.elevation);
    rows.push({
      key: "elevation", label: "Elevation", sub: `${whole ? `↑${Math.round(whole.up)} ↓${Math.round(whole.down)} · ` : ""}${Math.round(lo)}–${Math.round(hi)} m`, height: 80,
      values: streams.elevation, low: scales.elevation[0], high: scales.elevation[1], text: round, unit: "m",
      describe: labels?.elevation ?? `Elevation ${ends(streams.elevation, round, "m")}`, draw: { kind: "area" },
    });
  }
  return rows;
}

/** Metres climbed and descended over the whole recording. The watch's own gain wins for the climb when it gave one. */
function totalClimb(m: Model, streams: Streams): { up: number; down: number } | null {
  if (!streams.elevation) return null;
  let up = 0, down = 0;
  for (let i = 1; i < streams.elevation.length; i++) {
    const d = streams.elevation[i] - streams.elevation[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  const gain = m.detail.activity.elevationGainM;
  // The descent keeps its distance from the climb, so a loop still ends where it began.
  return gain != null ? { up: gain, down: Math.max(0, gain - (up - down)) } : { up, down };
}

function ChartsCard({ m, marks }: { m: Model; marks: number[] }) {
  const { activity: a, streams } = m.detail;
  const rows = chartRows(m);
  if (!streams || rows.length === 0) return null;
  const at = positionText(m);
  return (
    <Card aria-label="Charts" className="ad-charts">
      <div className="ad-between">
        <h2 className="h2">Charts</h2>
        <span className="ad-note">At <strong style={{ color: "var(--fg)" }}>{at}</strong>{marks.length ? " · dashed lines are your watch's laps" : ""}</span>
      </div>
      <ActivityChartStack rows={rows} n={streams.x.length} index={m.index} onIndex={m.setIndex} marks={marks} valueText={at} />
      <div className="ad-axis">{axisTicks(a.sport, streams).map((t, k) => <span key={k}>{t}</span>)}</div>
    </Card>
  );
}

function MapCard({ m }: { m: Model }) {
  const { activity: a, streams, route, labels } = m.detail;
  if (!route || !streams) return m.detail.streams || a.distanceM == null ? null : m.miss("Map", "1.5 1 560px", 420);
  const hr = streams.hr?.[m.index];
  const readout: { label: string; value: ReactNode; color?: string }[] = [];
  if (m.atM != null) readout.push({ label: "Distance", value: a.sport === "Swim" ? `${thousands(m.atM)} m` : `${(m.atM / 1000).toFixed(2)} km` });
  if (m.atS != null) readout.push({ label: "Time", value: clock(Math.round(m.atS)) });
  if (hr != null) readout.push({ label: "Heart rate", value: `${Math.round(hr)} bpm`, color: "var(--h-rose-ink)" });
  return (
    <ActivityRoutePlayback
      route={route} distanceM={a.distanceM ?? route[route.length - 1].d} startedAt={parseStart(a.start)} at={m.atM} span={m.chosen ? { from: m.chosen.fromM, to: m.chosen.toM } : null} hue={m.hue} sample={m.origin === "sample"}
      label={`${labels?.route ?? `Route, ${formatDistance(a)}`}, with the playback marker on it`} n={streams.x.length} index={m.index} onIndex={m.setIndex} readout={readout}
    />
  );
}

function timeRows(m: Model): Stat[] {
  const { activity: a, extras } = m.detail;
  const rows: Stat[] = [{ label: "Moving time", value: exact(a.durationS) }];
  if (extras?.elapsedS != null && extras.elapsedS - a.durationS >= 0.5) {
    rows.push({ label: "Elapsed time", value: clock(Math.round(extras.elapsedS)), note: `${clock(Math.round(extras.elapsedS - a.durationS))} stopped` });
  }
  if (extras?.watchTempC) {
    const [lo, hi] = extras.watchTempC;
    rows.push({ label: "Temperature", value: lo === hi ? `${lo}°` : `${lo}–${hi}°`, note: "The watch's sensor, warmed by your wrist" });
  }
  return rows;
}

function Closing({ m, time, children }: { m: Model; time?: Stat[]; children?: ReactNode }) {
  const { activity: a, thresholds, week } = m.detail;
  const pace = a.sport === "Run" ? paceOver(a.sport, a.distanceM, a.durationS) : null;
  return (
    <div className="ad-cols">
      {children}
      <TimeCard rows={time ?? timeRows(m)} style={{ flex: "1 1 240px" }} />
      {m.percent != null ? <EffortCard percent={m.percent} level={m.level} sentence={thresholdPaceSentence(pace, thresholds?.paceSPerKm)} style={{ flex: "1 1 280px" }} /> : m.miss("Effort", "1 1 280px", 150)}
      {week ? <WeekCard week={week} style={{ flex: "1 1 240px" }} /> : m.miss("In the week", "1 1 240px", 150)}
    </div>
  );
}

function NotRead({ m }: { m: Model }) {
  const d = m.detail;
  if (m.origin === "synced" || d.streams || d.route || d.laps.length > 0 || d.zones.length > 0) return null;
  return <div className="notice" role="status">Charts appear once your phone has read the recording.</div>;
}

// ------------------------------------------------------- run, ride and others

function PaceLayout({ m }: { m: Model }) {
  const { detail, track } = m;
  const { activity: a, streams, thresholds: thr, extras } = detail;
  const ride = a.sport === "Ride", run = a.sport === "Run";
  const laps = watchLaps(detail);

  const view = useMemo(() => {
    const auto = detail.laps.length > 0 && lapsAreAutomatic(detail.laps);
    const base: SplitRow[] = !paceUnit(a.sport) ? []
      : auto ? rowsFromLaps(detail.laps, track, streams, a.sport, 1000)
      : track?.dist && streams ? splitsFromTrack(track, streams, a.sport, 1000) : [];
    const lapRows = laps ? rowsFromLaps(laps, track, streams, a.sport, 1000) : null;
    const whole = base.length ? totalRow(base, "Total") : null;
    const climbs = ride && track && streams ? findClimbs(track, streams) : [];
    // FTP is a cycling mark: a run's power is charted, never scored against it.
    const power = track && enough(streams?.power) ? powerNumbers(track, streams.power, ride ? thr?.ftp : null) : null;
    return { base, lapRows, whole, climbs, power };
  }, [detail, track, streams, laps, a.sport, ride, thr?.ftp]);
  const { base, lapRows, whole, climbs, power } = view;

  const pace = paceOver(a.sport, a.distanceM, a.durationS);
  const gap = run && whole?.gapS != null && pace != null && Math.abs(whole.gapS - pace) >= 1 ? whole.gapS : null;
  const climb = streams && track ? totalClimb(m, streams) : null;

  const details: Stat[] = [];
  if (gap != null) details.push({ label: "Avg grade-adjusted pace", value: `${clock(Math.round(gap))} /km` });
  if (a.elevationGainM != null) details.push({ label: "Elevation gain", value: `${thousands(a.elevationGainM)} m`, note: climb ? `Loss ${thousands(climb.down)} m` : "" });
  if (a.avgHr != null) details.push({ label: "Avg heart rate", value: `${a.avgHr} bpm`, note: thr?.maxHr ? `${Math.floor((a.avgHr / thr.maxHr) * 100)}% of the max` : "" });
  if (a.maxHr != null) details.push({ label: "Max heart rate", value: `${a.maxHr} bpm` });
  if (ride && enough(streams?.pace)) details.push({ label: "Max speed", value: `${Math.max(...streams.pace).toFixed(1)} km/h` });
  if (a.calories != null) details.push({ label: "Calories", value: `${thousands(a.calories)} kcal` });
  if (a.load != null) details.push({ label: "Training load", value: String(a.load), note: "From time and heart rate" });
  if (a.cadence != null) details.push({ label: "Avg cadence", value: `${a.cadence} ${ride ? "rpm" : "spm"}`, note: enough(streams?.cadence) ? `Max ${Math.round(Math.max(...streams.cadence))}` : "" });
  const avgPower = a.avgPowerW ?? power?.avg ?? null;
  if (avgPower != null) details.push({ label: "Avg power", value: `${Math.round(avgPower)} W`, note: power ? `Max ${Math.round(power.max)}` : "" });
  if (run && whole?.strideM != null) details.push({ label: "Avg stride length", value: `${whole.strideM.toFixed(2)} m` });
  if (whole?.groundContactMs != null) details.push({ label: "Avg ground contact", value: `${Math.round(whole.groundContactMs)} ms` });

  // Analysis rows, in the phone's order.
  const findings: Finding[] = [];
  const kind = track ? workoutKind({ sport: a.sport, laps: laps ?? [], hr: streams?.hr ?? null, dt: track.dt, movingS: a.durationS, thresholdHr: thr?.hr, avgHr: a.avgHr }) : null;
  if (kind) findings.push({ title: kind, note: "Workout type" });
  if (track && streams && kind !== "Intervals") {
    const drift = run && track.dist ? decoupling(track, track.speed, streams.hr) : ride && enough(streams.power) ? decoupling(track, streams.power, streams.hr) : null;
    if (drift != null) findings.push({ title: decouplingTitle(drift), note: ride ? "Heart rate against power" : "Heart rate against pace" });
    const split = run ? pacingSplit(track, streams.elevation) : null;
    if (split != null) findings.push(pacingFinding(split));
  }
  if (gap != null && pace != null && Math.abs(pace - gap) >= 3) {
    findings.push({ title: `Grade-adjusted pace ${clock(Math.round(gap))} /km`, note: pace > gap ? `${Math.round(pace - gap)} s/km of climbing` : `${Math.round(gap - pace)} s/km from the descents` });
  }
  if (run && a.distanceM != null && a.distanceM >= 3000 && a.durationS >= 1200 && a.avgHr) {
    findings.push({ title: `${(((a.distanceM / a.durationS) * 60) / a.avgHr).toFixed(2)} m per heartbeat`, note: "Efficiency" });
  }
  if (ride && power?.intensity != null) findings.push({ title: intensityLabel(power.intensity), note: `Intensity factor ${power.intensity.toFixed(2)}` });
  if (ride && power?.variability != null && a.durationS >= 1200) findings.push({ title: variabilityLabel(power.variability), note: `Variability ${power.variability.toFixed(2)}` });

  // Pace zones: runs with a threshold pace, counting only the samples that were moving.
  const paceLines: ZoneLine[] = [];
  const thrPace = run ? thr?.paceSPerKm : undefined;
  if (thrPace && track && enough(streams?.pace)) {
    const seconds = timeInZones(streams.pace, track.dt, (v) => paceZoneOf(v, thrPace), PACE_ZONE_RATIOS.length + 1, (v) => v > 1250);
    zoneShares(seconds.map((s) => ({ seconds: s }))).rows.forEach((z, i) => {
      paceLines.push({ name: `Z${i + 1} ${EFFORT_LEVELS[i].title}`, range: paceZoneRange(i, thrPace), seconds: z.seconds, share: z.share, color: zoneColor(i) });
    });
  }
  const powerLines: ZoneLine[] = [];
  if (ride && thr?.ftp && track && enough(streams?.power)) {
    const ftp = thr.ftp;
    const seconds = timeInZones(streams.power, track.dt, (v) => powerZoneOf(v, ftp), POWER_ZONE_NAMES.length);
    zoneShares(seconds.map((s) => ({ seconds: s }))).rows.forEach((z, i) => {
      if (z.seconds >= 30) powerLines.push({ name: `Z${i + 1} ${POWER_ZONE_NAMES[i]}`, range: powerZoneRange(i, ftp), seconds: z.seconds, share: z.share, color: `var(--pz-${i + 1})` });
    });
  }

  const powerItems: Stat[] = [];
  if (ride && power) {
    if (power.np != null) powerItems.push({ label: "Normalized power", value: `${Math.round(power.np)} W` });
    powerItems.push({ label: "Avg power", value: `${Math.round(avgPower ?? power.avg)} W`, note: `Max ${Math.round(power.max)} W` });
    if (power.intensity != null) powerItems.push({ label: "Intensity factor", value: power.intensity.toFixed(2) });
    if (power.stress != null) powerItems.push({ label: "Training stress", value: power.stress.toFixed(1) });
    if (power.variability != null) powerItems.push({ label: "Variability", value: power.variability.toFixed(2) });
    if (a.cadence != null) powerItems.push({ label: "Avg cadence", value: `${a.cadence} rpm`, note: enough(streams?.cadence) ? `Max ${Math.round(Math.max(...streams.cadence))} rpm` : "" });
  }
  const climbTime = climbs.reduce((s, c) => s + c.seconds, 0);
  const climbPower = climbs.every((c) => c.powerW != null) && climbTime > 0 ? climbs.reduce((s, c) => s + (c.powerW as number) * c.seconds, 0) / climbTime : null;

  // A longer split is offered once it gives at least two rows.
  const lengths = [1, 5, 10].filter((k) => k === 1 || base.length > k);
  const dynamics: ChartRow[] = [];
  if (run && streams) {
    const dyn = (key: string, label: string, values: number[] | null | undefined, unit: string, color: string, digits: number) => {
      if (!enough(values)) return;
      const [lo, hi] = extent(values, (Math.max(...values) - Math.min(...values)) * 0.15 || 1);
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const text = (v: number) => v.toFixed(digits);
      dynamics.push({ key, label, sub: `Avg ${text(avg)} ${unit}`, height: 80, values, low: lo, high: hi, text, unit, describe: `${label} from ${text(Math.min(...values))} to ${text(Math.max(...values))} ${unit}`, draw: { kind: "line", color } });
    };
    dyn("gct", "Ground contact", streams.groundContact, "ms", "var(--h-cyan)", 0);
    dyn("vo", "Vertical oscillation", streams.verticalOsc, "cm", "var(--h-sky)", 1);
    dyn("stride", "Stride length", streams.stride, "m", "var(--h-orange)", 2);
  }

  const lapSpeeds = (laps ?? []).map((l) => (l.distanceM && l.durationS > 0 ? l.distanceM / l.durationS : 0));
  const quickest = lapSpeeds.filter((v) => v > 0).length >= 2 ? lapSpeeds.indexOf(Math.max(...lapSpeeds)) : -1;
  const records = extras?.records ?? [];
  const sideRecords = ride && records.length > 0;

  return (
    <>
      <Headline m={m} items={paceItems(m)} />
      <NotRead m={m} />

      {detail.route || details.length > 0 || m.origin === "synced" ? (
        <div className="ad-cols">
          <MapCard m={m} />
          {details.length > 0 ? (
            <Card aria-label="Details" clip style={{ flex: "1 1 400px", display: "flex", flexDirection: "column" }}>
              <div className="ad-head"><h2 className="h2">Details</h2></div>
              <div style={{ flex: detail.route ? 1 : undefined, display: "grid" }}><StatGrid items={details} cols={detail.route ? 2 : 4} /></div>
            </Card>
          ) : m.miss("Details", "1 1 400px", 200)}
        </div>
      ) : null}

      {powerItems.length > 0 || powerLines.length > 0 || climbs.length > 1 || (ride && m.origin === "synced") ? (
        <div className="ad-cols">
          {powerItems.length > 0 ? (
            <Card aria-label="Power" clip style={{ flex: "1.2 1 420px" }}>
              <div className="ad-head"><h2 className="h2">Power</h2>{thr?.ftp ? <span className="ad-sub">FTP {Math.round(thr.ftp)}</span> : null}</div>
              <StatGrid items={powerItems} cols={3} />
              {climbs.length > 1 && climbPower != null ? (
                <p className="ad-foot">Most of the work was on the {climbs.length} climbs: {clock(Math.round(climbTime))} of the ride, at an average of {Math.round(climbPower)} W.</p>
              ) : null}
            </Card>
          ) : ride ? m.miss("Power", "1.2 1 420px", 220) : null}
          {powerLines.length > 0 ? (
            <Card aria-label="Power zones" className="ad-pad" style={{ flex: "1 1 360px", gap: 10 }}>
              <h2 className="h2">Power zones</h2>
              <ZoneBar zones={powerLines} />
              <ZoneRows zones={powerLines} dot />
            </Card>
          ) : ride ? m.miss("Power zones", "1 1 360px", 220) : null}
          {climbs.length > 1 ? <ClimbsCard climbs={climbs} gainM={a.elevationGainM} /> : ride && !enough(streams?.elevation) ? m.miss("Climbs", "1 1 320px", 220) : null}
        </div>
      ) : null}

      {extras?.summary || findings.length > 0 || extras?.relativeEffort || m.origin === "synced" ? (
        <div className="ad-cols">
          {extras?.summary ? <SummaryCard text={extras.summary} style={{ flex: "1.3 1 380px" }} /> : m.miss("Summary", "1.3 1 380px", 150)}
          {findings.length > 0 ? <FindingsCard findings={findings} style={{ flex: "1 1 300px" }} /> : m.miss("Analysis", "1 1 300px", 150)}
          {extras?.relativeEffort ? <RelativeEffortCard effort={extras.relativeEffort} link style={{ flex: "1 1 300px" }} /> : m.miss("Relative Effort", "1 1 300px", 150)}
        </div>
      ) : null}

      {base.length === 0 && !lapRows && paceUnit(a.sport) ? m.miss("Splits", undefined, 200) : null}
      <SplitsCard
        key={a.id} sport={a.sport} base={base} lengths={lengths} startLength={ride && lengths.includes(5) ? 5 : 1} laps={lapRows} hue={m.hue}
        total={{
          durationS: a.durationS, distanceM: a.distanceM ?? whole?.distanceM ?? 0,
          ...(a.avgHr != null ? { avgHr: a.avgHr } : {}), ...(a.maxHr != null ? { maxHr: a.maxHr } : {}), ...(a.cadence != null ? { cadence: a.cadence } : {}),
          ...(avgPower != null ? { powerW: avgPower } : {}), ...(climb ? { ascentM: climb.up, descentM: climb.down } : {}),
        }}
        elapsedS={extras?.elapsedS} movingS={a.durationS} currentM={m.atM} chosen={m.chosen} onChoose={m.choose}
        zoneColor={thrPace ? (r) => zoneColor(paceZoneOf(r.distanceM > 0 ? (r.durationS / r.distanceM) * 1000 : thrPace, thrPace)) : undefined}
      />

      {streams ? (
        <div className="ad-cols" data-top>
          <ChartsCard m={m} marks={lapMarks(laps, streams)} />
          <div className="ad-stack" style={{ flex: "1 1 360px" }}>
            <HrZones m={m} missing />
            {paceLines.length > 0 ? (
              <ZoneCard
                title="Pace zones" aside={`Threshold ${clock(Math.round(thrPace as number))} /km`} zones={paceLines}
                sentence={mostly(paceLines, EFFORT_LEVELS.map((l) => l.title), EFFORT_LEVELS.map((l) => l.meaning))}
              />
            ) : run ? m.miss("Pace zones", undefined, 220) : null}
            {sideRecords ? <RecordsCard title="Ride records" rows={records} /> : ride ? m.miss("Ride records", undefined, 150) : null}
          </div>
        </div>
      ) : (
        <div className="ad-cols" data-top>
          {m.miss("Charts", "2 1 620px", 420)}
          <div className="ad-stack" style={{ flex: "1 1 360px" }}>
            <HrZones m={m} missing />
            {run ? m.miss("Pace zones", undefined, 220) : null}
            {ride ? m.miss("Ride records", undefined, 150) : null}
          </div>
        </div>
      )}

      {dynamics.length > 0 && streams ? (
        <Card aria-label="Running dynamics" className="ad-pad" style={{ gap: 14 }}>
          <h2 className="h2">Running dynamics</h2>
          <ActivityChartStack rows={dynamics} n={streams.x.length} index={m.index} onIndex={m.setIndex} grid small valueText={positionText(m)} />
        </Card>
      ) : run ? m.miss("Running dynamics", undefined, 150) : null}

      <Closing m={m}>
        {laps ? (
          <Card aria-label="Laps from your watch" className="ad-table" style={{ flex: "1.3 1 360px" }}>
            <div style={{ minWidth: 340 }}>
              <div className="ad-head"><h2 className="h2">Laps</h2><span className="ad-sub">{laps.length} from your watch</span></div>
              <div className="ad-th" style={{ gridTemplateColumns: "30px repeat(4, minmax(0, 1fr))" }}>
                <span>#</span><span className="ad-r">Dist</span><span className="ad-r">Time</span><span className="ad-r">{ride ? "Speed" : "Pace"}</span><span className="ad-r">HR</span>
              </div>
              {laps.map((l, k) => (
                <div key={k} className="ad-tr" title={l.name} style={{ gridTemplateColumns: "30px repeat(4, minmax(0, 1fr))", minHeight: 40, whiteSpace: "nowrap" }}>
                  <span className="ad-dimcell">{l.n}</span>
                  <span className="ad-r">{l.distanceM != null ? `${(l.distanceM / 1000).toFixed(2)} km` : "—"}</span>
                  <span className="ad-r ad-b">{exact(l.durationS)}</span>
                  <span className="ad-r" style={k === quickest ? { color: "var(--h-rose-ink)", fontWeight: 700 } : undefined}>{formatPaceValue(a.sport, paceOver(a.sport, l.distanceM, l.durationS))}</span>
                  <span className="ad-r">{l.avgHr ?? "—"}</span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </Closing>

      {(records.length > 0 && !sideRecords) || extras?.weather || extras?.journal || extras?.gear || m.origin === "synced" ? (
        <div className="ad-cols">
          {ride ? null : records.length > 0 ? <RecordsCard title="Best efforts" rows={records} medal style={{ flex: "1.3 1 360px" }} /> : run ? m.miss("Best efforts", "1.3 1 360px", 200) : null}
          {extras?.weather ? <WeatherCard weather={extras.weather} style={{ flex: "1 1 280px" }} /> : m.miss("Weather", "1 1 280px", 200)}
          {extras?.journal || extras?.gear || m.origin === "synced" ? (
            <div className="ad-stack" style={{ flex: "1 1 300px" }}>
              {extras?.journal ? <JournalCard journal={extras.journal} /> : m.miss("How it went", undefined, 110)}
              {extras?.gear ? <GearCard gear={extras.gear} /> : m.miss("Gear", undefined, 80)}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ClimbsCard({ climbs, gainM }: { climbs: readonly Climb[]; gainM: number | null }) {
  const total = climbs.reduce((s, c) => s + c.gainM, 0);
  return (
    <Card aria-label="Climbs" clip style={{ flex: "1 1 320px" }}>
      <div className="ad-head"><h2 className="h2">Climbs</h2><span className="ad-sub">{Math.round(total)}{gainM != null ? ` of ${thousands(gainM)}` : ""} m</span></div>
      {climbs.map((c, k) => (
        <div key={k} className="ad-item" data-n>
          <i>{k + 1}</i>
          <span>
            <b>{((c.toM - c.fromM) / 1000).toFixed(2)} km at {(c.grade * 100).toFixed(1)}%</b>
            <span className="ad-sub">{[`+${Math.round(c.gainM)} m`, c.powerW != null ? `${Math.round(c.powerW)} W` : "", c.hr != null ? `${Math.round(c.hr)} bpm` : ""].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="num">{clock(Math.round(c.seconds))}</span>
        </div>
      ))}
    </Card>
  );
}

// -------------------------------------------------------------------- swim

function SwimLayout({ m }: { m: Model }) {
  const { detail, track } = m;
  const { activity: a, streams, extras } = detail;
  const swim = extras?.swim && extras.swim.lengths.length > 0 ? extras.swim : null;
  const numbers = swim ? swimNumbers(swim) : null;
  const laps = detail.steps?.length ? detail.steps : detail.laps;
  const lapRows = !swim && laps.length > 0 ? rowsFromLaps(laps, track, streams, a.sport, 100) : null;
  const lines = hrZoneLines(m.hrZones).filter((z) => z.seconds > 0);
  const hrRow = chartRows(m).filter((r) => r.key === "hr").map((r) => ({ ...r, draw: { kind: "line" as const, color: "var(--h-rose)", area: true } }));
  const others = chartRows(m).filter((r) => r.key !== "hr");
  const time: Stat[] = numbers
    ? [{ label: "Moving time", value: exact(numbers.activeS) }, { label: "Elapsed time", value: exact(a.durationS), ...(numbers.restS > 0 ? { note: `${clock(Math.round(numbers.restS))} resting at the wall` } : {}) }]
    : timeRows(m);
  const pool = a.sportName !== "Open water" && !detail.route;

  const heart = streams && hrRow.length > 0 ? (
    <Card aria-label="Heart rate" className="ad-pad">
      <ActivityChartStack rows={hrRow} n={streams.x.length} index={m.index} onIndex={m.setIndex} valueText={positionText(m)} />
      <div className="ad-axis">{axisTicks(a.sport, streams).map((t, k) => <span key={k}>{t}</span>)}</div>
      {lines.length > 0 ? <><ZoneBar zones={lines} /><ZoneRows zones={lines} dot /></> : null}
    </Card>
  ) : m.miss("Heart rate", undefined, 240);
  const side = (
    <>
      {heart}
      {extras?.records?.length ? <RecordsCard title="Swim records" rows={extras.records} /> : m.miss("Swim records", undefined, 150)}
      {extras?.summary ? <SummaryCard text={extras.summary} /> : m.miss("Summary", undefined, 150)}
    </>
  );

  return (
    <>
      <Headline m={m} items={paceItems(m)} />
      <NotRead m={m} />
      {!swim && pool ? (
        <>
          <div className="ad-cols">
            {m.miss("Swim", "1.3 1 480px", 240)}
            {m.miss("Sets", "1 1 380px", 240)}
          </div>
          {m.miss("Length by length", undefined, 260)}
        </>
      ) : null}
      {swim ? (
        <>
          <div className="ad-cols">
            <SwimCard data={swim} style={{ flex: "1.3 1 480px" }} />
            <SwimSetsCard data={swim} style={{ flex: "1 1 380px" }} />
          </div>
          <LengthChart data={swim} />
          <div className="ad-cols" data-top>
            <LengthsTable data={swim} style={{ flex: "1.4 1 520px" }} />
            <div className="ad-stack" style={{ flex: "1 1 380px" }}>{side}</div>
          </div>
        </>
      ) : (
        <>
          {detail.route ? <div className="ad-cols"><MapCard m={m} /></div> : null}
          {lapRows ? (
            <SplitsCard
              key={a.id} sport={a.sport} base={[]} lengths={[1]} startLength={1} laps={lapRows} hue={m.hue} movingS={a.durationS} elapsedS={extras?.elapsedS}
              total={{ durationS: a.durationS, distanceM: a.distanceM ?? 0, ...(a.avgHr != null ? { avgHr: a.avgHr } : {}), ...(a.maxHr != null ? { maxHr: a.maxHr } : {}) }}
              currentM={m.atM} chosen={m.chosen} onChoose={m.choose}
            />
          ) : null}
          <div className="ad-cols" data-top>
            {streams && others.length > 0 ? (
              <Card aria-label="Charts" className="ad-charts">
                <div className="ad-between"><h2 className="h2">Charts</h2><span className="ad-note">At <strong style={{ color: "var(--fg)" }}>{positionText(m)}</strong></span></div>
                <ActivityChartStack rows={others} n={streams.x.length} index={m.index} onIndex={m.setIndex} valueText={positionText(m)} />
              </Card>
            ) : pool ? m.miss("Lengths", "1.4 1 520px", 320) : null}
            <div className="ad-stack" style={{ flex: "1 1 380px" }}>{side}</div>
          </div>
        </>
      )}
      <Closing m={m} time={time}>{null}</Closing>
      {extras?.journal ? <JournalCard journal={extras.journal} /> : m.miss("How it went", undefined, 110)}
    </>
  );
}

// ---------------------------------------------------------------- strength

function StrengthLayout({ m }: { m: Model }) {
  const { detail, track } = m;
  const { activity: a, streams, scales, extras, labels } = detail;
  const session = extras?.strength ?? null;
  const numbers = session ? sessionNumbers(session.exercises) : null;
  const hr = enough(streams?.hr) ? streams.hr : null;
  const items: { label: string; value: ReactNode; text?: string }[] = [{ label: "Time", value: null, text: exact(a.durationS) }];
  if (numbers) {
    items.push({ label: "Sets", value: null, text: String(numbers.sets) });
    if (numbers.volumeKg > 0) items.push({ label: "Volume", value: null, text: `${thousands(numbers.volumeKg)} kg` });
    else items.push({ label: "Reps", value: null, text: thousands(numbers.reps) });
  }
  if (a.avgHr != null) items.push({ label: "Avg heart rate", value: null, text: `${a.avgHr} bpm` });
  if (!numbers && a.maxHr != null) items.push({ label: "Max heart rate", value: null, text: `${a.maxHr} bpm` });
  if (!numbers && a.calories != null) items.push({ label: "Calories", value: null, text: `${thousands(a.calories)} kcal` });
  const figure = session && (session.figure || session.muscles?.length) ? <MusclesCard session={session} /> : m.miss("Muscles worked", "1 1 380px", 420);
  const sets = session ? session.exercises.reduce((s, ex) => s + ex.sets.filter((x) => !x.warmUp).length, 0) : 0;
  const timeline = track && hr && scales?.hr ? (
    <TimelineCard
      session={session} track={track} hr={hr} range={scales.hr} durationS={a.durationS}
      label={labels?.hr ?? (sets ? `Heart rate across the session with the ${sets} sets marked` : "Heart rate across the session")}
    />
  ) : null;

  return (
    <>
      <NotRead m={m} />
      {!session ? (
        <div className="notice" role="status">
          {m.origin === "sample" ? "No sets were logged for this workout." : "No sets were logged for this workout. Sets, volume and muscles show when it was logged in C-LINK's gym log on your phone."}
        </div>
      ) : null}
      <div className="ad-cols">
        {figure}
        <div className="ad-stack" style={{ flex: "2 1 560px" }}>
          <Card aria-label="Headline" className="ad-headline" data-narrow>
            {items.map((s) => <div key={s.label}><span>{s.label}</span><CountUp className="num" text={s.text as string} /></div>)}
          </Card>
          {session ? <SessionCard session={session} load={a.load} /> : m.miss("Session", undefined, 190)}
          {timeline ?? m.miss("Timeline", undefined, 220)}
          {session && sets > 0 ? <VolumeCard session={session} /> : m.miss("Volume by set", undefined, 190)}
        </div>
      </div>
      {session ? <ExercisesSection session={session} time={track?.time ?? null} hr={hr} /> : m.miss("Exercises", undefined, 200)}
      <div className="ad-cols">
        {session && hasRests(session) ? <RestCard session={session} time={track?.time ?? null} hr={hr} style={{ flex: "1 1 220px" }} /> : m.miss("Rest & recovery", "1 1 220px", 150)}
        {extras?.records?.length ? <RecordsCard title="Lift records" rows={extras.records} link={{ href: "/strength", label: "Strength progress" }} style={{ flex: "1.3 1 300px" }} /> : m.miss("Lift records", "1.3 1 300px", 150)}
        {extras?.relativeEffort ? <RelativeEffortCard effort={extras.relativeEffort} style={{ flex: "1 1 240px" }} /> : m.miss("Relative Effort", "1 1 240px", 150)}
        {detail.week ? <WeekCard week={detail.week} style={{ flex: "1 1 200px" }} /> : m.miss("In the week", "1 1 200px", 150)}
      </div>
    </>
  );
}
