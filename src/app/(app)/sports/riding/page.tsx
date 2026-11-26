"use client";
import Link from "next/link";
import { Bars, BarsLegend, DISCLAIMER, HeroText, Icon, NotYourSport, SampleBlock, Section, Split, SportHead, Stats, Tiles, TrendLine } from "@/components/sports/parts";
import { useLoaded, type Origin } from "@/data/core";
import { isMissing, loadSports, type RidePage } from "@/data/sports";
import { t } from "@/lib/i18n";
import type { Family } from "@/lib/sports";
import "../sports.css";

export default function RidingPage() {
  const loaded = useLoaded(loadSports);
  if (loaded.status === "loading") return <main className="page sp-page"><div className="skeleton" style={{ minHeight: 520 }} /></main>;
  if (loaded.status === "error") return <main className="page sp-page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  if (!loaded.data.ride) return <NotYourSport name={t("Riding")} current="ride" families={loaded.data.families} origin={loaded.origin} />;
  return <RideScreen ride={loaded.data.ride} families={loaded.data.families} origin={loaded.origin} />;
}

function RideScreen({ ride, families, origin }: { ride: RidePage; families: readonly Family[]; origin: Origin }) {
  const { hero, much, climb, zones, ftp, vo2, balance, perBeat, records } = ride;
  return (
    <main className="page sp-page">
      <SportHead title={t("Riding")} current="ride" families={families} origin={origin} />

      <section aria-label={t("Riding now")} className="sp-hero" data-hue="ride">
        <HeroText chip={hero.chip} headline={hero.headline} text={hero.text} figures={hero.figures} />
        <div className="sp-hero-side" style={{ flex: "1.35 1 520px", gap: 10 }}>
          <div className="sp-side-head">
            <b>{t("Power curve")}</b>
            {isMissing(hero.curve) ? null : (
              <span className="sp-legend">
                <span data-hue="strength"><i aria-hidden="true" className="sp-swatch-line" />{t("Last 90 days")}</span>
                <span><i aria-hidden="true" className="sp-swatch-dash" style={{ background: "none", borderRadius: 0, height: 0 }} />{t("Your best ever")}</span>
              </span>
            )}
          </div>
          {isMissing(hero.curve) ? <p className="sp-missing">{hero.curve.missing}</p> : (
            <>
              <PowerCurve curve={hero.curve} />
              <div className="sp-boxes center" style={{ gridTemplateColumns: `repeat(${hero.curve.tiles.length}, minmax(0, 1fr))`, marginRight: 54 }}>
                {hero.curve.tiles.map((tile) => (
                  <div key={tile.name} data-on={tile.best ? "" : undefined}>
                    <span>{tile.name}</span><b className="num" style={{ fontSize: 17 }}>{tile.watts}</b>
                    {tile.perKg ? <span style={{ fontSize: 11 }}>{tile.perKg}</span> : null}<em>{tile.note}</em>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <Tiles tiles={ride.tiles} />

      <div className="sp-row">
        <Section id="much" title={t("How much")} icon="bars" hue="ride" how={t("Hours first: wind and hills make distance unfair")} flex="1.25 1 540px" reading={much}>
          <div className="sp-side-head"><b>{t("Hours a week")}</b><BarsLegend chart={much.weeks} /></div>
          <Bars chart={much.weeks} hue="ride" width={640} height={206} />
          <Stats items={much.figures} />
        </Section>
        <Section id="climb" title={t("Climbing")} icon="climb" hue="violet" how={t("From your watch's barometer")} flex="1 1 440px" reading={climb}>
          {isMissing(climb) ? null : (
            <>
              <Bars chart={climb.weeks} hue="violet" width={520} height={180} />
              {climb.sampleBiggest ? (
                <SampleBlock title={t("Biggest climb, last 4 weeks")}>
                  <b className="num">{climb.sampleBiggest.title} · {climb.sampleBiggest.detail} · {climb.sampleBiggest.tag}</b>
                  <p>{climb.sampleBiggest.rate}</p>
                </SampleBlock>
              ) : null}
            </>
          )}
        </Section>
      </div>

      <div className="sp-row">
        <Section id="zones" title={t("Power zones")} icon="bars" hue="gold" how={t("Coggan's seven zones, from your FTP")} flex="1.3 1 400px" reading={zones}>
          {isMissing(zones) ? null : (
            <>
              <div role="img" aria-label={t("Share of riding time by power zone")} className="sp-split" style={{ height: 16 }}>
                {zones.rows.map((z) => <span key={z.zone} data-hue={z.hue} style={{ flex: `${Math.max(z.percent, 0.5)} 1 0` }} />)}
              </div>
              <div className="sp-zones">
                {zones.rows.map((z) => (
                  <div key={z.zone} data-hue={z.hue}>
                    <span className="z">{z.zone}</span><span className="n">{z.name}</span><span className="r">{z.range}</span>
                    <span className="bar" aria-hidden="true"><i className="cl-bar" style={{ width: `${Math.min(100, z.percent * 2)}%` }} /></span>
                    <b className="num">{z.text}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
        <Section id="ftp" title={t("FTP and W/kg")} icon="trend" hue="gold" how={t("95% of your best 20 minutes in each 4 weeks")} flex="1 1 290px" reading={ftp}>
          {isMissing(ftp) ? null : (<>{ftp.trend ? <TrendLine chart={ftp.trend} hue="gold" width={440} height={160} /> : null}<Stats items={ftp.figures} /></>)}
        </Section>
        <Section title={t("Cycling VO₂ max")} icon="lungs" hue="violet" how={t("C-LINK's estimate from your best 5 minutes")} flex="0.8 1 240px" reading={vo2}>
          {isMissing(vo2) ? null : <Stats items={vo2.figures} />}
        </Section>
      </div>

      <div className="sp-row">
        <Section id="balance" title={t("Easy vs hard")} icon="pulse" hue="rose" how={t("Seiler's three intensity zones")} flex="1.3 1 400px" reading={balance}>
          {isMissing(balance) ? null : (<><Split shares={balance.split} label={balance.split.map((s) => `${s.name} ${s.percent}%`).join(", ")} /><p className="sp-note">{balance.note}</p></>)}
        </Section>
        <Section title={t("Watts per beat")} icon="heart" hue="rose" how={t("Rides of 30 minutes or more")} flex="1 1 290px" reading={perBeat}>
          {isMissing(perBeat) || !perBeat.chart ? null : <TrendLine chart={perBeat.chart} hue="rose" width={440} height={160} />}
        </Section>
        {records.length ? (
          <section aria-label={t("Records")} className="sp-card" style={{ flex: "0.8 1 240px", gap: 10, paddingBottom: 14 }}>
            <div className="sp-card-head">
              <span aria-hidden="true" className="sp-icon sp-tint" data-hue="gold"><Icon name="medal" /></span>
              <h2>{t("Records")}</h2><Link href="/activities" className="sp-end">{t("All activities")}</Link>
            </div>
            <div className="sp-list">
              {records.map((r) => (
                <div key={r.name} style={{ gridTemplateColumns: "minmax(0, 1fr) auto 52px", minHeight: 46 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span><b className="num">{r.value}</b><span className="date">{r.date}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <p className="sp-disclaimer">{t(DISCLAIMER)}</p>
    </main>
  );
}

/** The power curve on a log scale: the last 90 days as a glowing line over the best ever as a dashed one. */
function PowerCurve({ curve }: { curve: Exclude<RidePage["hero"]["curve"], { missing: string }> }) {
  const W = 640, H = 214, plotW = 586, top = 16, base = 190;
  const lo = Math.log(Math.max(40, Math.min(...curve.best, ...curve.marks) * 0.75)), hi = Math.log(Math.max(...curve.best, ...curve.marks));
  const y = (w: number) => base - ((Math.log(Math.max(w, 1)) - lo) / (hi - lo)) * (base - top);
  const n = curve.best.length;
  const x = (k: number) => (n === 1 ? plotW / 2 : 24 + (k * (plotW - 48)) / (n - 1));
  const path = (values: readonly (number | null)[]) => {
    let d = "", pen = false;
    values.forEach((v, k) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
    return d.trim();
  };
  const recent = path(curve.recent);
  const known = curve.recent.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0);
  const stroke = { stroke: "var(--sp)", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg role="img" aria-label={curve.label} className="sp-chart" data-hue="strength" viewBox={`0 0 ${W} ${H}`}>
      {curve.marks.map((m) => <g key={m}><path className="grid" d={`M0 ${y(m).toFixed(1)}H${plotW}`} /><text x={plotW + 8} y={y(m) + 4}>{m} W</text></g>)}
      {known.length > 1 ? <path d={`${recent} L${x(known[known.length - 1]).toFixed(1)} ${H - 8} L${x(known[0]).toFixed(1)} ${H - 8} Z`} style={{ fill: "var(--sp)", opacity: 0.13 }} /> : null}
      <path className="dash" d={path(curve.best)} />
      <path d={recent} fill="none" style={{ ...stroke, strokeWidth: 6, filter: "blur(7px)", opacity: 0.5 }} />
      <path d={recent} fill="none" style={{ ...stroke, strokeWidth: 3 }} />
      {known.map((k) => <circle key={k} cx={x(k)} cy={y(curve.recent[k] as number)} r="5" style={{ fill: "var(--sp)" }} />)}
    </svg>
  );
}
