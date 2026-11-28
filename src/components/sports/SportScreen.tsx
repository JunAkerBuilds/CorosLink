"use client";
// The page of a sport the activity list alone reads (Walking, Hiking, Skiing, Climbing): the week, the last four weeks,
// the climb when the sport has one, recent sessions and records. Styles in sports.css.
import Link from "next/link";
import { Bars, BarsLegend, DISCLAIMER, HeroText, NotYourSport, Section, SPORT_HUE, Split, SportHead, Stats } from "@/components/sports/parts";
import { useLoaded, type Origin } from "@/data/core";
import { isMissing, loadSports, type SportPage } from "@/data/sports";
import { t } from "@/lib/i18n";
import type { Family } from "@/lib/sports";

type Own = "walk" | "hike" | "snow" | "climb";

export function SportScreen({ family, name }: { family: Own; name: string }) {
  const loaded = useLoaded(loadSports);
  if (loaded.status === "loading") return <main className="page sp-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page sp-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  const page = loaded.data[family];
  if (!page) return <NotYourSport name={name} current={family} families={loaded.data.families} origin={loaded.origin} />;
  return <Screen page={page} name={name} families={loaded.data.families} origin={loaded.origin} />;
}

function Screen({ page, name, families, origin }: { page: SportPage; name: string; families: readonly Family[]; origin: Origin }) {
  const { hero, month, climb, recent, records } = page;
  const hue = SPORT_HUE[page.family];
  return (
    <main className="page sp-page">
      <SportHead title={name} current={page.family} families={families} origin={origin} />

      <section id="now" aria-label={t("{sport} now", { sport: name })} className="sp-hero" data-hue={hue}>
        <HeroText chip={hero.chip} headline={hero.headline} text={hero.text} figures={hero.figures} basis={400} />
        <div className="sp-hero-side" style={{ flex: "1.2 1 480px", gap: 10 }}>
          <div className="sp-side-head"><b>{t("Hours a week")}</b><BarsLegend chart={hero.chart} /></div>
          <Bars chart={hero.chart} hue={hue} width={640} height={206} />
        </div>
      </section>

      <div className="sp-row">
        <Section id="month" title={t("Last 4 weeks")} icon="bars" hue={hue} how={t("Against the 4 weeks before")} flex="1.1 1 420px" reading={month}>
          <Stats items={month.figures} />
          {month.kinds ? <Split shares={month.kinds} label={month.kinds.map((k) => `${k.name} ${k.percent}%`).join(", ")} /> : null}
        </Section>
        {climb ? (
          <Section id="climb" title={t("Climbing")} icon="climb" hue="violet" how={t("From your watch's barometer")} flex="1 1 420px" reading={climb}>
            {isMissing(climb) ? null : <Bars chart={climb.weeks} hue="violet" width={520} height={180} />}
          </Section>
        ) : null}
      </div>

      <div className="sp-row">
        <Section id="recent" title={t("Recent sessions")} icon="pulse" hue={hue} flex="1.4 1 460px"
          reading={recent.length ? { chip: null, headline: recent[0].name, sub: `${recent[0].kind} · ${recent[0].date}` } : { missing: t("No sessions yet") }}>
          <div className="sp-list">
            {recent.map((r) => (
              <Link key={r.id} href={`/activities/${encodeURIComponent(r.id)}`} className="row"
                style={{ gridTemplateColumns: "minmax(0, 1fr) auto 60px", color: "var(--fg)", textDecoration: "none", margin: "0 -10px", padding: "0 10px", borderRadius: 10, minHeight: 46 }}>
                <span style={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}<span className="sp-note"> · {r.kind}</span></span>
                <b className="num" style={{ fontSize: 15 }}>{r.figures.join(" · ")}</b>
                <span className="date">{r.date}</span>
              </Link>
            ))}
          </div>
        </Section>
        {records.length ? (
          <Section id="records" title={t("Records")} icon="medal" hue="gold" flex="1 1 320px" reading={{ chip: null, headline: t("Your bests"), sub: null }}>
            <div className="sp-list">
              {records.map((r) => (
                <div key={r.name} style={{ gridTemplateColumns: "minmax(0, 1fr) auto 60px", minHeight: 46 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span><b className="num">{r.value}</b><span className="date">{r.date}</span>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
      </div>

      <p className="sp-disclaimer">{t(DISCLAIMER)}</p>
    </main>
  );
}
