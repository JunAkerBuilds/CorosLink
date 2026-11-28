"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HeroText, Icon, Ring, SPORT_HUE, SPORT_ICON, SportHead, Spark, Stats, ToneChip } from "@/components/sports/parts";
import { useLoaded, type Origin } from "@/data/core";
import { loadSports, type HoursWeek, type Sports, type SportsHub } from "@/data/sports";
import { FAMILY_NAME } from "@/data/sync/sports";
import { useSportOrder } from "@/data/local/sportOrder";
import { dateText, locale, t } from "@/lib/i18n";
import { shownSports, type Family } from "@/lib/sports";
import "./sports.css";

export default function SportsPage() {
  const loaded = useLoaded(loadSports);
  if (loaded.status === "loading") return <main className="page sp-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page sp-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  return <HubScreen data={loaded.data} origin={loaded.origin} />;
}

function HubScreen({ data, origin }: { data: Sports; origin: Origin }) {
  const hub = data.hub;
  const saved = useSportOrder();
  // The person's own order from the switcher, when they have dragged one.
  const rank = shownSports(data.families, saved);
  const bySaved = (a: { family: Family }, b: { family: Family }) => rank.indexOf(a.family) - rank.indexOf(b.family);
  return (
    <main className="page sp-page">
      <SportHead title={t("Sports")} crumb={hub.day} current={null} families={data.families} origin={origin} />

      <section aria-label={t("This week across your sports")} className="sp-hero" data-hue="run">
        <HeroText chip={hub.range} headline={hub.headline} text={hub.text} figures={hub.figures} mascot basis={400} />
        <div className="sp-rings">
          {hub.rings.slice().sort(bySaved).map((r) => (
            <Link key={r.family} href={r.href} aria-label={r.label} data-hue={SPORT_HUE[r.family]}>
              <Ring percent={r.percent} size={122} stroke={13} label={r.label}>
                <span aria-hidden="true"><Icon name={SPORT_ICON[r.family]} size={26} width={2} /></span>
                {r.percent != null ? <b className="num">{r.percent}%</b> : null}
              </Ring>
              <span className="sp-ring-cap"><span>{r.name}</span><b className="num">{r.value}</b>{r.of ? <span className="sp-small">{r.of}</span> : null}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="sp-hub-grid">
        <section aria-label={t("What stands out")} className="sp-card" style={{ gap: 6, paddingBottom: 12 }}>
          <div className="sp-card-head" style={{ marginBottom: 6 }}><h2>{t("What stands out")}</h2></div>
          {hub.standouts.map((s) => (
            <Link key={s.family} href={s.href} className="sp-stand">
              <span aria-hidden="true" className="sp-icon lg sp-tint" data-hue={SPORT_HUE[s.family]}><Icon name={SPORT_ICON[s.family]} size={21} /></span>
              <span className="t"><b>{s.title}</b>{s.detail ? <span>{s.detail}</span> : null}</span>
              <ToneChip chip={s.chip} />
              <Icon name="chevron" size={18} width={2.2} />
            </Link>
          ))}
        </section>
        <section aria-label={t("Hours a week")} className="sp-card" style={{ gap: 12 }}>
          <div className="sp-card-head" style={{ flexWrap: "wrap", justifyContent: "space-between" }}><h2>{t("Hours a week")}</h2><span className="sp-note">{hub.hours.total}</span></div>
          <HoursChart hours={hub.hours} />
          <div className="sp-legend">
            {hub.hours.families.map((f) => <span key={f} data-hue={SPORT_HUE[f]}><i aria-hidden="true" />{t(FAMILY_NAME[f])}</span>)}
            {hub.hours.planned ? <span><i aria-hidden="true" className="sp-swatch-plan" style={{ background: "none" }} />{t("Planned")}</span> : null}
          </div>
        </section>
      </div>

      <div className="sp-hub-grid" style={hub.cards.length > 2 ? { gridTemplateColumns: `repeat(${Math.min(hub.cards.length, 4)}, minmax(0, 1fr))` } : undefined}>
        {hub.cards.slice().sort(bySaved).map((c) => (
          <Link key={c.family} href={c.href} aria-label={`${c.name}: ${c.headline}`} className="sp-sport-card" data-hue={SPORT_HUE[c.family]}>
            <div className="sp-card-head">
              <span aria-hidden="true" className="sp-icon sp-tint"><Icon name={SPORT_ICON[c.family]} /></span>
              <span className="name">{c.name}</span>
              <span aria-hidden="true" className="sp-end muted"><Icon name="chevron" size={18} width={2.2} /></span>
            </div>
            <div className="mid"><b>{c.headline}</b>{c.spark && c.spark.length > 1 ? <Spark values={c.spark} hue={SPORT_HUE[c.family]} /> : null}</div>
            <Stats items={c.figures} />
          </Link>
        ))}
      </div>

      <div className="sp-hub-grid">
        {hub.also.length ? (
          <section aria-label={t("Also in the last 90 days")} className="sp-card">
            <div className="sp-card-head"><h2>{t("Also in the last 90 days")}</h2><Link href="/activities" className="sp-end">{t("All activities")}</Link></div>
            <div className="sp-list">
              {hub.also.map((a) => (
                <Link key={a.name} href="/activities" className="row" style={{ gridTemplateColumns: "minmax(0, 1fr) 90px 110px 60px", color: "var(--fg)", textDecoration: "none", margin: "0 -10px", padding: "0 10px", borderRadius: 10 }}>
                  <span style={{ fontWeight: 600 }}>{a.name}</span><span className="sp-note">{a.sessions}</span><b className="num" style={{ fontSize: 15 }}>{a.time}</b><span className="date">{a.last}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <section aria-label={t("Your sports")} className="sp-card">
          <div className="sp-card-head"><h2>{t("Your sports")}</h2></div>
          <div className="sp-pills">
            {hub.rings.map((r) => <span key={r.family} data-hue={SPORT_HUE[r.family]}><Icon name={SPORT_ICON[r.family]} />{r.name}</span>)}
          </div>
          <p className="sp-note">{t("Worked out from your workouts of the last 90 days.")}</p>
        </section>
      </div>
    </main>
  );
}

/** "1 h 14" / "45 min" for a number of hours. */
function hoursText(h: number): string {
  const m = Math.round(h * 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`;
}

/** "26 Oct – 1 Nov" for the week starting on that Monday. */
function weekRange(monday: string): string {
  const d = new Date(`${monday}T12:00:00`), e = new Date(d); e.setDate(d.getDate() + 6);
  const f = (x: Date) => dateText(x, locale("en-GB"), { day: "numeric", month: "short" });
  return `${f(d)} – ${f(e)}`;
}

/** Hours of training a week, stacked by sport, with what is still planned as a dashed outline on this week.
 *  Hovering (or focusing) a week shows its breakdown; clicking opens that week in the calendar. */
function HoursChart({ hours }: { hours: SportsHub["hours"] }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 246, base = 208, top = 30;
  const max = Math.max(1, ...hours.weeks.map((w) => w.total + w.planned));
  const slot = W / hours.weeks.length, bar = Math.min(30, slot * 0.66), unit = (base - top) / max;
  const open = (w: HoursWeek) => router.push(`/calendar?week=${w.start}`);
  const tip = hover != null ? hours.weeks[hover] : null;
  return (
    <div className="sp-chart-wrap" onMouseLeave={() => setHover(null)}>
      <svg role="group" aria-label={hours.label} className="sp-chart sp-chart-live" viewBox={`0 0 ${W} ${H}`}>
        {hours.weeks.map((w, k) => {
          const x = k * slot + (slot - bar) / 2, cx = k * slot + slot / 2;
          let y = base;
          const rects = w.parts.filter((p) => p.hours > 0).map((p) => {
            const h = Math.max(3, p.hours * unit - 2);
            y -= h + 2;
            return <rect key={p.family} data-hue={SPORT_HUE[p.family]} x={x} y={y + 2} width={bar} height={h} rx="4" style={{ fill: "var(--sp)", opacity: w.now || hover === k ? 1 : 0.62 }} />;
          });
          const planH = w.planned * unit;
          return (
            <g key={k} className={hover === k ? "on" : undefined} role="link" tabIndex={0}
              aria-label={t("Week of {week}: {time}. Open in calendar", { week: weekRange(w.start), time: w.total > 0 ? hoursText(w.total) : t("no training") })}
              onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} onBlur={() => setHover(null)}
              onClick={() => open(w)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(w); } }}>
              <rect className="hit" x={k * slot + 2} y={top - 22} width={slot - 4} height={H - top + 22} rx="10" />
              {rects}
              {w.total === 0 ? <rect className="track" x={x} y={base - 4} width={bar} height="4" rx="2" /> : null}
              {planH > 4 ? <rect className="plan" x={x + 0.7} y={y - planH} width={bar - 1.4} height={planH - 1} rx="4" /> : null}
              {w.total > 0 ? <text className={w.now ? "now" : undefined} x={cx} y={y - (planH > 4 ? planH : 0) - 5} textAnchor="middle">{w.total.toFixed(1)}</text> : null}
              <text className={w.now ? "now" : undefined} x={cx} y={base + 18} textAnchor="middle">{w.label}</text>
              {w.sub ? <text x={cx} y={base + 33} textAnchor="middle">{w.sub}</text> : null}
            </g>
          );
        })}
      </svg>
      {tip && hover != null ? (
        <div className="sp-tip" aria-hidden="true" style={{ left: `${Math.min(84, Math.max(16, ((hover + 0.5) / hours.weeks.length) * 100))}%` }}>
          <span className="sp-tip-head">{tip.now ? t("This week") : weekRange(tip.start)}</span>
          <b className="num">{tip.total > 0 ? hoursText(tip.total) : t("No training")}</b>
          {tip.parts.filter((p) => p.hours > 0).map((p) => (
            <span key={p.family} className="sp-tip-row" data-hue={SPORT_HUE[p.family]}><i />{t(FAMILY_NAME[p.family])}<em className="num">{hoursText(p.hours)}</em></span>
          ))}
          {tip.planned > 0 ? <span className="sp-tip-row"><i className="sp-swatch-plan" />{t("Planned")}<em className="num">{hoursText(tip.planned)}</em></span> : null}
          <span className="sp-tip-foot">{t("Click to open in Calendar")}</span>
        </div>
      ) : null}
    </div>
  );
}
