"use client";
import { useMemo, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { SleepNight, SleepStage } from "@/data/health";
import { clockOfDay, durationShort, stageAt, stageSpans } from "@/lib/health";
import { msg, t } from "@/lib/i18n";

export const STAGE_NAME: Record<SleepStage, string> = { awake: msg("Awake"), rem: "REM", light: msg("Light"), deep: msg("Deep") };
/** Stage colours on the night sky (the panel is dark in both themes). */
export const STAGE_COLOR: Record<SleepStage, string> = {
  awake: "var(--h-orange)", rem: "var(--h-cyan)", light: "var(--stage-light)", deep: "var(--stage-deep)",
};
const ROW_Y: Record<SleepStage, number> = { awake: 4, rem: 38, light: 72, deep: 106 };
const ROWS: SleepStage[] = ["awake", "rem", "light", "deep"];
const H = 136;

function describe(night: SleepNight): string {
  const count = (stage: SleepStage) => night.segments.filter((s) => s.stage === stage).length;
  const deep = count("deep"), rem = count("rem"), wake = count("awake");
  return t("Sleep stages through the night: {deep}, {rem}, {wake}", {
    deep: deep === 1 ? t("1 deep sleep block") : t("{n} deep sleep blocks", { n: deep }),
    rem: rem === 1 ? t("1 REM period") : t("{n} REM periods", { n: rem }),
    wake: wake === 1 ? t("1 wake-up") : t("{n} wake-ups", { n: wake }),
  });
}

/** The night as four rows (awake, REM, light, deep) with a block for every stretch; hover or arrow keys read one out. */
export function HealthHypnogram({ night }: { night: SleepNight }) {
  const spans = useMemo(() => stageSpans(night.segments), [night.segments]);
  const startMinute = night.startMinute ?? 0;
  const total = spans.length ? spans[spans.length - 1].to : 0;
  const w = Math.max(1, total * 2);
  const [picked, setPicked] = useState<number | null>(null);

  const paths = useMemo(() => {
    const out: Record<SleepStage, string> = { awake: "", rem: "", light: "", deep: "" };
    for (const s of spans) out[s.stage] += `M${s.from * 2} ${ROW_Y[s.stage]}h${(s.to - s.from) * 2}v26h-${(s.to - s.from) * 2}z`;
    return out;
  }, [spans]);

  // Hour marks at their real places, then the time of getting up at the right edge.
  const ticks = useMemo(() => {
    const list: { at: number; text: string }[] = [];
    const firstHour = Math.ceil(startMinute / 60) * 60;
    for (let m = firstHour; m - startMinute < total - 50; m += 120) list.push({ at: (m - startMinute) / (total || 1), text: clockOfDay(m) });
    return list;
  }, [startMinute, total]);

  const hit = picked != null ? spans[picked] : null;
  const readout = hit
    ? `${t(STAGE_NAME[hit.stage])} · ${clockOfDay(startMinute + hit.from)} – ${clockOfDay(startMinute + hit.to)} · ${durationShort(hit.to - hit.from)}`
    : null;

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const span = stageAt(night.segments, ((e.clientX - r.left) / r.width) * total);
    setPicked(span ? span.index : null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = spans.length - 1;
    if (last < 0) return;
    let next: number | null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = picked == null ? 0 : Math.min(last, picked + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = picked == null ? last : Math.max(0, picked - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setPicked(next);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 12 }}>
        <div aria-hidden="true" style={{ flex: "none", width: 44, display: "flex", flexDirection: "column", justifyContent: "space-around", fontSize: 12, color: "var(--sky-text)" }}>
          {ROWS.map((s) => <span key={s}>{t(STAGE_NAME[s])}</span>)}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg role="img" aria-label={describe(night)} width="100%" height={H} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
            <path d={`M0 34H${w}M0 68H${w}M0 102H${w}`} fill="none" style={{ stroke: "var(--line)", vectorEffect: "non-scaling-stroke" }} />
            {ROWS.map((s) => <path key={s} d={paths[s]} style={{ fill: STAGE_COLOR[s], opacity: hit && hit.stage !== s ? 0.55 : 1 }} />)}
            {hit ? (
              <rect x={hit.from * 2} y={ROW_Y[hit.stage]} width={(hit.to - hit.from) * 2} height={26} fill="none"
                style={{ stroke: "var(--fg)", strokeWidth: 2, vectorEffect: "non-scaling-stroke" }} />
            ) : null}
          </svg>
          {hit && readout ? (
            <div className="tip health-stage-tip" aria-hidden="true"
              style={{ left: `clamp(90px, ${(((hit.from + hit.to) / 2 / (total || 1)) * 100).toFixed(2)}%, calc(100% - 90px))` }}>
              <span style={{ fontWeight: 700 }}>{readout}</span>
            </div>
          ) : null}
          <div
            className="chart-hit" role="slider" tabIndex={0} aria-label={t("Sleep stage")} aria-orientation="horizontal"
            aria-valuemin={0} aria-valuemax={Math.max(0, spans.length - 1)} aria-valuenow={picked ?? 0}
            aria-valuetext={readout ?? t("Use the arrow keys to step through the night")}
            onPointerMove={point} onPointerDown={point} onPointerLeave={() => setPicked(null)} onBlur={() => setPicked(null)} onKeyDown={key}
          />
        </div>
      </div>
      <div aria-hidden="true" style={{ position: "relative", height: 16, marginLeft: 56, fontSize: 12, color: "var(--sky-text)" }}>
        {ticks.map((tick) => (
          <span key={tick.text} style={{ position: "absolute", left: `${(tick.at * 100).toFixed(2)}%`, transform: tick.at < 0.04 ? undefined : "translateX(-50%)" }}>{tick.text}</span>
        ))}
        <span style={{ position: "absolute", right: 0 }}>{clockOfDay(startMinute + total)}</span>
      </div>
    </>
  );
}
