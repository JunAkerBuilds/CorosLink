"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CountUp } from "@/components/ui";
import type { ActivityExtras, RecordRow, Sport, WeekShare } from "@/data/activities";
import { EFFORT_LEVELS, type Finding, type RelativeEffort } from "@/lib/activityDetail";
import { clock } from "@/lib/format";
import { t, tx } from "@/lib/i18n";

/** A sport's name in the app's language. */
export function sportWord(sport: Sport): string {
  switch (sport) {
    case "Run": return tx("sport", "Run");
    case "Ride": return tx("sport", "Ride");
    case "Swim": return tx("sport", "Swim");
    case "Strength": return tx("sport", "Strength");
    default: return tx("sport", "Other");
  }
}

/** A section the phone has sent nothing for, kept at about the section's usual size so the page keeps its shape. */
export function MissingCard({ title, style }: { title: string; style?: React.CSSProperties }) {
  return (
    <Card aria-label={title} className="ad-pad ad-missing" style={style}>
      <h2 className="h2">{title}</h2>
      <p>{t("Nothing from your phone yet")}</p>
    </Card>
  );
}

export interface Stat { label: string; value: string; note?: string }

/** Labelled figures in a grid of `cols` columns (two on a phone). */
export function StatGrid({ items, cols = 2, fit, keep }: { items: readonly Stat[]; cols?: number; fit?: boolean; keep?: boolean }) {
  return (
    <div className="ad-stats" data-fit={fit || undefined} data-keep={keep || undefined} style={{ ["--ad-cols" as string]: cols }}>
      {items.map((d) => (
        <div key={d.label} className="ad-stat"><span>{d.label}</span><span className="num">{d.value}</span><small>{d.note ?? ""}</small></div>
      ))}
    </div>
  );
}

/** The threshold meter in the headline: five effort bands with a tick at the activity's average heart rate. */
export function ThresholdMeter({ percent, label }: { percent: number; label: string }) {
  const x = (p: number) => Math.max(0, Math.min(100, p / 1.5));
  const bands = EFFORT_LEVELS.map((l, i) => ({ from: x(l.from), to: i < EFFORT_LEVELS.length - 1 ? x(EFFORT_LEVELS[i + 1].from) : 100, hue: l.hue }));
  return (
    <svg role="img" aria-label={label} width="100%" height="12" viewBox="0 0 100 12" preserveAspectRatio="none">
      {bands.map((b, i) => (
        <rect key={b.hue} x={b.from + (i ? 0.5 : 0)} y="3" width={Math.max(0.5, b.to - b.from - (i ? 0.5 : 0))} height="6" rx={i === 0 || i === bands.length - 1 ? 3 : 1} style={{ fill: `var(--h-${b.hue})` }} />
      ))}
      <rect x={x(percent) - 0.6} y="0" width="1.2" height="12" rx="0.6" style={{ fill: "var(--fg)" }} />
    </svg>
  );
}

export interface ZoneLine { name: string; range: string; seconds: number; share: number; color: string }

/**
 * Time in zones: one bar split by zone, the zone most time went to in a sentence, then a row per zone
 * (hardest first, as the phone lists them).
 */
export function ZoneCard({ title, aside, sentence, zones, dot, className, style }: {
  title: string; aside?: string; sentence?: string; /** Easiest first. */ zones: readonly ZoneLine[]; dot?: boolean; className?: string; style?: React.CSSProperties;
}) {
  const top = Math.max(...zones.map((z) => z.share), 0.0001);
  return (
    <Card aria-label={title} className={`ad-pad ${className ?? ""}`} style={style}>
      <div className="ad-between"><h2 className="h2">{title}</h2>{aside ? <span className="ad-sub">{aside}</span> : null}</div>
      <ZoneBar zones={zones} />
      {sentence ? <span className="ad-text">{sentence}</span> : null}
      <ZoneRows zones={zones} dot={dot} top={top} />
    </Card>
  );
}

export function ZoneBar({ zones }: { zones: readonly Pick<ZoneLine, "seconds" | "color" | "name">[] }) {
  return (
    <div aria-hidden="true" className="ad-zonebar">
      {zones.map((z) => (z.seconds > 0 ? <div key={z.name} style={{ flex: `${z.seconds} 1 0`, background: z.color }} /> : null))}
    </div>
  );
}

export function ZoneRows({ zones, dot, top }: { zones: readonly ZoneLine[]; dot?: boolean; top?: number }) {
  const most = top ?? Math.max(...zones.map((z) => z.share), 0.0001);
  return (
    <>
      {[...zones].reverse().map((z) => (
        <div key={z.name} className="ad-zone" data-dot={dot || undefined}>
          {dot ? (
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="3" style={{ fill: z.color }} /></svg>
          ) : (
            <svg aria-hidden="true" width="30" height="18" viewBox="0 0 30 18"><rect width="30" height="18" rx="6" style={{ fill: z.color, opacity: 0.2 }} /><rect x="4" y="6" width="6" height="6" rx="2" style={{ fill: z.color }} /></svg>
          )}
          <span><b>{z.name}</b><small>{z.range}</small></span>
          <svg aria-hidden="true" width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
            <rect width="100" height="8" rx="4" style={{ fill: "rgba(var(--fg-rgb), 0.08)" }} />
            {z.seconds > 0 ? <rect width={Math.max(2, (z.share / most) * 100)} height="8" rx="4" style={{ fill: z.color }} /> : null}
          </svg>
          <span className="ad-r">{clock(Math.round(z.seconds))}</span>
          <span className="ad-r ad-b">{Math.round(z.share * 100)}%</span>
        </div>
      ))}
    </>
  );
}

export function SummaryCard({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <Card aria-label={t("Summary")} className="ad-pad" style={style}>
      <h2 className="h2">{t("Summary")}</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="ad-summary"><img alt="" src="/img/coach-write.webp" /><p>{text}</p></div>
    </Card>
  );
}

export function FindingsCard({ findings, style }: { findings: readonly Finding[]; style?: React.CSSProperties }) {
  return (
    <Card aria-label={t("Analysis")} clip style={style}>
      <div className="ad-head" style={{ paddingBottom: 8 }}><h2 className="h2">{t("Analysis")}</h2></div>
      {findings.map((f) => <div key={`${f.title} ${f.note}`} className="ad-list-row"><span>{f.title}</span><span>{f.note}</span></div>)}
    </Card>
  );
}

export function RelativeEffortCard({ effort, style, link }: { effort: RelativeEffort; style?: React.CSSProperties; link?: boolean }) {
  return (
    <Card aria-label={t("Relative Effort")} className="ad-pad" style={{ padding: "20px 22px", ...style }}>
      <div className="ad-between"><h2 className="h2">{t("Relative Effort")}</h2>{effort.basis ? <span className="ad-sub">{effort.basis}</span> : null}</div>
      <CountUp className="num" style={{ fontSize: 52, fontWeight: 900, lineHeight: 1 }} text={String(effort.score)} />
      {effort.harderThanPct != null ? (
        <>
          <span className="ad-text" style={{ fontSize: 14, lineHeight: "21px" }}>{t("Harder than {pct}% of your similar workouts in the 3 months before.", { pct: effort.harderThanPct })}</span>
          <div aria-hidden="true" className="ad-scale"><span style={{ left: `${Math.max(3, Math.min(97, effort.harderThanPct))}%` }} /></div>
        </>
      ) : null}
      {link ? <Link href="/" style={{ marginTop: "auto", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>{t("Fitness & Freshness")}</Link> : null}
    </Card>
  );
}

export function TimeCard({ rows, style }: { rows: readonly Stat[]; style?: React.CSSProperties }) {
  return (
    <Card aria-label={t("Time")} clip style={style}>
      <div className="ad-head"><h2 className="h2">{t("Time")}</h2></div>
      {rows.map((r) => (
        <div key={r.label} className="ad-stat" style={{ padding: "10px 20px" }}><span>{r.label}</span><span className="num">{r.value}</span>{r.note ? <small>{r.note}</small> : null}</div>
      ))}
    </Card>
  );
}

export function EffortCard({ percent, level, sentence, style }: { percent: number; level: number; sentence?: string | null; style?: React.CSSProperties }) {
  const l = EFFORT_LEVELS[level];
  return (
    <Card aria-label={t("Effort")} className="ad-pad" style={{ padding: "16px 20px", gap: 10, ...style }}>
      <h2 className="h2">{t("Effort")}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 800, color: `var(--h-${l.hue}-ink)` }}>{t(l.title)}</span>
        <span className="ad-note">{t("{pct}% of threshold HR", { pct: Math.round(percent) })}</span>
      </div>
      <div aria-hidden="true" className="ad-effort-steps">
        {EFFORT_LEVELS.map((e, i) => <span key={e.title} data-on={i === level || undefined} style={{ background: `var(--h-${e.hue})` }} />)}
      </div>
      <span className="ad-text">{t(l.meaning)}</span>
      {sentence ? <span className="ad-text">{sentence}</span> : null}
    </Card>
  );
}

export function WeekCard({ week, style }: { week: WeekShare; style?: React.CSSProperties }) {
  const pct = (v: number | null) => (v == null ? null : `${Math.round(v * 100)}%`);
  const rows: [string, string | null][] = [[t("Workout"), t("{n} of {total}", { n: week.index, total: week.count })], [t("Of the week's time"), pct(week.time)], [t("Of the week's load"), pct(week.load)]];
  return (
    <Card aria-label={t("In the week")} clip style={style}>
      <div className="ad-head"><h2 className="h2">{t("In the week")}</h2></div>
      {rows.map(([label, value]) => (value ? <div key={label} className="ad-week-row"><span>{label}</span><span className="num">{value}</span></div> : null))}
    </Card>
  );
}

/** Records set or approached in this activity. `pace` adds a fifth column for runs. */
export function RecordsCard({ title, rows, medal, link, style }: {
  title: string; rows: readonly RecordRow[]; medal?: boolean; link?: { href: string; label: string }; style?: React.CSSProperties;
}) {
  const prs = rows.filter((r) => r.best).length;
  const withPace = rows.some((r) => r.pace);
  const columns = `${medal ? "22px " : ""}minmax(0, 1fr) minmax(0, 1fr) ${withPace ? "84px 70px" : "110px"}`;
  return (
    <Card aria-label={title} clip style={style}>
      <div className="ad-head"><h2 className="h2">{title}</h2>{prs > 0 ? <span className="ad-pr">{t("PRs: {n}", { n: prs })}</span> : null}</div>
      {rows.map((e) => (
        <div key={e.what} className="ad-rec" style={{ gridTemplateColumns: columns }}>
          {medal ? (
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="8" style={{ fill: e.best ? "var(--h-gold)" : "var(--muted)", opacity: 0.22 }} /><circle cx="9" cy="9" r="4" style={{ fill: e.best ? "var(--h-gold)" : "var(--muted)" }} />
            </svg>
          ) : null}
          <span style={{ fontWeight: 600 }}>{e.what}</span>
          <span className="muted">{e.rank}</span>
          <span className="ad-r ad-b">{e.value}</span>
          {withPace ? <span className="ad-r soft">{e.pace ?? ""}</span> : null}
        </div>
      ))}
      {link ? <Link className="ad-foot" href={link.href}>{link.label}</Link> : null}
    </Card>
  );
}

const deg = (v: number) => `${Math.round(v)}°`;

export function WeatherCard({ weather: w, style }: { weather: NonNullable<ActivityExtras["weather"]>; style?: React.CSSProperties }) {
  const items: Stat[] = [{ label: t("Temperature"), value: deg(w.tempC), note: w.feelsC != null ? t("Feels like {temp}", { temp: deg(w.feelsC) }) : "" }];
  if (w.humidityPct != null) items.push({ label: t("Humidity"), value: `${Math.round(w.humidityPct)}%`, note: w.dewPointC != null ? t("Dew point {temp}", { temp: deg(w.dewPointC) }) : "" });
  if (w.windKmh != null) items.push({ label: t("Wind"), value: `${Math.round(w.windKmh)} km/h`, note: [w.windFrom ? t("From {dir}", { dir: w.windFrom }) : "", w.gustKmh != null ? t("gusts {n}", { n: Math.round(w.gustKmh) }) : ""].filter(Boolean).join(", ") });
  if (w.finishTempC != null) items.push({ label: t("At the finish"), value: deg(w.finishTempC), note: w.sky ?? "" });
  else if (w.sky) items.push({ label: t("Sky"), value: w.sky, note: "" });
  return (
    <Card aria-label={t("Weather")} clip style={style}>
      <div className="ad-head"><h2 className="h2">{t("Weather")}</h2></div>
      <StatGrid items={items} keep />
      {w.note ? <p className="ad-foot">{w.note}</p> : null}
    </Card>
  );
}

export function JournalCard({ journal, children, style }: { journal: NonNullable<ActivityExtras["journal"]>; children?: ReactNode; style?: React.CSSProperties }) {
  return (
    <Card aria-label={t("How it went")} className="ad-pad" style={{ padding: "16px 20px", gap: 8, ...style }}>
      <div className="ad-between"><h2 className="h2">{t("How it went")}</h2>{journal.felt != null ? <span style={{ fontSize: 13, fontWeight: 700, color: "var(--h-mint-ink)" }}>{t("Felt {n} of 5", { n: journal.felt })}</span> : null}</div>
      {journal.tags?.length ? <span className="ad-note">{journal.tags.join(" · ")}</span> : null}
      {journal.note ? <p className="ad-text" style={{ fontSize: 14, lineHeight: "21px" }}>{journal.note}</p> : null}
      {children}
    </Card>
  );
}

export function GearCard({ gear }: { gear: NonNullable<ActivityExtras["gear"]> }) {
  return (
    <Card aria-label={t("Gear")} style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="ad-sub">{t("Gear")}</span><span style={{ fontWeight: 600 }}>{gear.name}</span>{gear.note ? <span className="ad-sub">{gear.note}</span> : null}
    </Card>
  );
}
