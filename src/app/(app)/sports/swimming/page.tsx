"use client";
import { DISCLAIMER, HeroText, NotYourSport, SampleBlock, Section, SportHead, Stats, Tiles, TrendLine } from "@/components/sports/parts";
import { useLoaded, type Origin } from "@/data/core";
import { isMissing, loadSports, type LineChart, type SwimPage } from "@/data/sports";
import { t } from "@/lib/i18n";
import type { Family } from "@/lib/sports";
import "../sports.css";

export default function SwimmingPage() {
  const loaded = useLoaded(loadSports);
  if (loaded.status === "loading") return <main className="page sp-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page sp-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  if (!loaded.data.swim) return <NotYourSport name={t("Swimming")} current="swim" families={loaded.data.families} origin={loaded.origin} />;
  return <SwimScreen swim={loaded.data.swim} families={loaded.data.families} origin={loaded.origin} />;
}

function SwimScreen({ swim, families, origin }: { swim: SwimPage; families: readonly Family[]; origin: Origin }) {
  const { hero, css, pace, swolf, strokes, records } = swim;
  return (
    <main className="page sp-page">
      <SportHead title={t("Swimming")} current="swim" families={families} origin={origin} />

      <section id="now" aria-label={t("Swimming now")} className="sp-hero" data-hue="swim">
        <HeroText chip={hero.chip} headline={hero.headline} text={hero.text} figures={hero.figures} basis={400} />
        <div className="sp-hero-side" style={{ flex: "1.1 1 440px", gap: 10 }}>
          <div className="sp-side-head"><b>{t("Metres a week")}</b></div>
          <div role="img" aria-label={hero.lanesLabel} className="sp-pool">
            {hero.lanes.map((l) => (
              <div key={l.label} data-now={l.now ? "" : undefined}>
                <span>{l.label}</span>
                <span className="lane">{l.share > 0 ? <><i className="cl-bar" style={{ width: `${Math.max(4, l.share * 96)}%` }} /><u aria-hidden="true" /></> : null}</span>
                <b className="num">{l.value}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Tiles tiles={swim.tiles} />

      <div className="sp-row">
        <Section id="css" title={t("Critical swim speed")} icon="trend" hue="swim" how={t("From your fastest 200 and 400")} flex="1.3 1 480px" reading={css} sample={css.sample}
          ask={[t("How do I use my critical swim speed?"), t("What should a threshold swim set look like?")]}>
          {css.sample ? <TrendLine chart={css.sampleTrend as LineChart} hue="slate" width={640} height={170} /> : null}
          <div className="sp-boxes">
            {css.bands.map((b) => <div key={b.name} data-hue={b.hue}><span>{b.name}</span><b style={{ fontSize: 15, fontWeight: 600, whiteSpace: "normal" }}>{b.text}</b></div>)}
          </div>
          {!css.sample && css.sampleTrend ? <SampleBlock title={t("Over six weeks")}><TrendLine chart={css.sampleTrend} hue="slate" width={640} height={150} /></SampleBlock> : null}
        </Section>
        <Section id="swolf" title={t("Stroke efficiency")} icon="pulse" hue="swim" how={t("Freestyle at the same pace")} flex="1 1 360px" reading={swolf} sample>
          <Stats items={swolf.compare} />
          <TrendLine chart={swolf.chart} hue="slate" width={480} height={130} />
          <Stats items={swolf.stats} />
        </Section>
      </div>

      <div className="sp-row">
        <Section id="pace" title={t("Pace")} icon="pulse" hue="ride" how={t("Whole swims, rests included")} flex="1 1 290px" reading={pace}>
          {isMissing(pace) || !pace.chart ? null : <TrendLine chart={pace.chart} hue="ride" width={440} height={160} />}
        </Section>
        <Section id="strokes" title={t("Strokes")} icon="swim" hue="swim" how={t("By distance, last 4 weeks")} flex="1 1 290px" reading={strokes} sample>
          <div role="img" aria-label={strokes.rows.map((r) => `${r.name} ${r.percent}%`).join(", ")} className="sp-split" style={{ height: 16 }}>
            {strokes.rows.map((r) => <span key={r.name} data-hue={r.hue} style={{ flex: `${r.percent} 1 0` }} />)}
          </div>
          <div className="sp-list">
            {strokes.rows.map((r) => (
              <div key={r.name} style={{ gridTemplateColumns: "minmax(0, 1fr) auto 48px", minHeight: 40 }}>
                <span style={{ fontWeight: 500 }}>{r.name}</span><span className="sp-note">{r.detail}</span><b className="num" style={{ textAlign: "right" }}>{r.percent}%</b>
              </div>
            ))}
          </div>
        </Section>
        <Section id="records" title={t("Records")} icon="medal" hue="gold" flex="1.2 1 320px" reading={records} sample={records.sample}>
          <div className="sp-list">
            {records.rows.map((r) => (
              <div key={r.name} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto 52px", minHeight: 46 }}>
                <span style={{ fontWeight: 500 }}>{r.name}</span>{r.fresh ? <span className="sp-new">{t("New")}</span> : <span />}<b className="num">{r.value}</b><span className="date">{r.date}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <p className="sp-disclaimer">{t(DISCLAIMER)}</p>
    </main>
  );
}
