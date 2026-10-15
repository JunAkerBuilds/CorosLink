/* The pictures on the right of the first-run tour. Each one is a small, fixed
   560×470 composition of raised cards built from the app's own vocabulary
   (rings, bars, wells, glyph tiles) rather than screenshots, so it follows the
   theme and never goes stale. OnboardingTour scales the canvas to its stage. */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Barbell,
  CalendarDots,
  ChartLineUp,
  ChatCircleDots,
  Check,
  CheckCircle,
  Clock,
  DownloadSimple,
  Footprints,
  Heart,
  Heartbeat,
  Lightning,
  MapTrifold,
  Microphone,
  MusicNotes,
  PaperPlaneTilt,
  Path,
  Sparkle,
  SpotifyLogo,
  Stack,
  TextT,
  Trophy,
  Watch,
  YoutubeLogo,
  AppleLogo,
  Books,
  ArrowsClockwise,
  ImageSquare,
  type Icon
} from "@phosphor-icons/react";
import logoBase from "../../build/icon-base.svg";
import logoSync from "../../build/icon-sync.svg";
import { LANGUAGES, formatDate, formatNumber, getLocale, t, useLanguage, type Language } from "../i18n";
import {
  distanceUnit,
  elevationUnit,
  kilogramsToDisplayWeight,
  metersToElevation,
  weightUnit,
  type UnitSystem
} from "../units/units";

export const VIGNETTE_WIDTH = 560;
export const VIGNETTE_HEIGHT = 470;

type Point = readonly [number, number];

const round = (value: number) => Math.round(value * 10) / 10;

/** Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(points: readonly Point[], closed = false): string {
  const count = points.length;
  const at = (index: number) =>
    closed ? points[(index + count) % count] : points[Math.max(0, Math.min(count - 1, index))];
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    d += ` C${round(x1 + (x2 - x0) / 6)} ${round(y1 + (y2 - y0) / 6)} ${round(x2 - (x3 - x1) / 6)} ${round(
      y2 - (y3 - y1) / 6
    )} ${round(x2)} ${round(y2)}`;
  }
  return closed ? `${d}Z` : d;
}

function place(left: number, top: number, width: number, height?: number): CSSProperties {
  return { left, top, width, height };
}

const percent = (fraction: number) => formatNumber(fraction, { style: "percent" });

/** The number and its sign apart, so the sign can sit smaller ("92 %" in French). */
function percentParts(fraction: number): { value: string; sign: string } {
  const parts = new Intl.NumberFormat(getLocale(), { style: "percent" }).formatToParts(fraction);
  const numeric = new Set(["integer", "group", "decimal", "fraction"]);
  return {
    value: parts.filter((part) => numeric.has(part.type)).map((part) => part.value).join(""),
    sign: parts.filter((part) => !numeric.has(part.type)).map((part) => part.value).join("")
  };
}

/** Monday-first narrow weekday names in the app language (1 Jan 2024 was a Monday). */
function weekdayInitials(): string[] {
  return Array.from({ length: 7 }, (_, index) => formatDate(new Date(2024, 0, 1 + index), { weekday: "narrow" }));
}

function VCard({
  index,
  style,
  className,
  children
}: {
  index: number;
  style: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  useLanguage();
  return (
    <div
      className={["onb-vcard", className].filter(Boolean).join(" ")}
      style={{ ...style, "--i": index } as CSSProperties}
    >
      {children}
    </div>
  );
}

function VHead({
  icon: Glyph,
  title,
  sub,
  hue,
  children
}: {
  icon: Icon;
  title: string;
  sub?: string;
  hue?: string;
  children?: ReactNode;
}) {
  useLanguage();
  return (
    <div className="onb-vhead">
      <span className="onb-vglyph" style={hue ? ({ "--glyph": hue } as CSSProperties) : undefined}>
        <Glyph size={15} weight="duotone" aria-hidden="true" />
      </span>
      <span className="onb-vhead-copy">
        <strong>{title}</strong>
        {sub ? <span>{sub}</span> : null}
      </span>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- Hello */

/** Each UI language says hello in its own words. Never translated: the point is
    that every reader finds their own greeting. */
export const GREETINGS: Record<Language, string> = { en: "Hello", fr: "Bonjour", "zh-CN": "你好" };

const RING_RADIUS = 182;

/** Card centres spread evenly round the outer ring, starting top-left. */
function helloSlot(index: number, count: number): Point {
  const angle = ((-90 - 180 / count + (index * 360) / count) * Math.PI) / 180;
  return [
    round(VIGNETTE_WIDTH / 2 + RING_RADIUS * Math.cos(angle)),
    round(VIGNETTE_HEIGHT / 2 + RING_RADIUS * Math.sin(angle))
  ];
}

/** Rings, glow and the spinning logo that both opening pictures share. */
function OrbitBackdrop() {
  return (
    <>
      <svg className="onb-orbit-rings" viewBox="0 0 560 470" aria-hidden="true">
        <circle cx="280" cy="235" r={RING_RADIUS} className="is-outer" />
        <circle cx="280" cy="235" r="122" className="is-inner" />
      </svg>
      <div className="onb-orbit-glow" />
      {/* Base and arrows are separate images so only the arrows' cached texture spins. */}
      <div className="onb-orbit-icon">
        <img src={logoBase} alt="" />
        <img className="is-sync" src={logoSync} alt="" />
      </div>
    </>
  );
}

export function HelloVignette({ language }: { language: Language }) {
  useLanguage();
  return (
    <div className="onb-vignette">
      <OrbitBackdrop />
      {LANGUAGES.map((option, index) => {
        const [left, top] = helloSlot(index, LANGUAGES.length);
        return (
          <div key={option.value} className="onb-hello-slot" style={{ left, top, "--i": index } as CSSProperties}>
            <div
              className={["onb-hello-card", option.value === language && "is-selected"].filter(Boolean).join(" ")}
              lang={option.value}
            >
              <strong>{GREETINGS[option.value]}</strong>
              <span className="onb-hello-name">{option.label}</span>
              <span className="onb-hello-check">
                <Check size={11} weight="bold" aria-hidden="true" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Welcome */

const ORBIT: Array<{ icon: Icon; hue: string }> = [
  { icon: ChartLineUp, hue: "var(--onb-cyan)" },
  { icon: CalendarDots, hue: "var(--onb-violet)" },
  { icon: Barbell, hue: "var(--onb-amber)" },
  { icon: Watch, hue: "var(--onb-pink)" },
  { icon: MapTrifold, hue: "var(--onb-blue)" },
  { icon: MusicNotes, hue: "var(--onb-rose)" }
];

export function WelcomeVignette() {
  useLanguage();
  return (
    <div className="onb-vignette onb-v-welcome">
      <OrbitBackdrop />
      <div className="onb-orbit">
        {ORBIT.map(({ icon: Glyph, hue }, index) => (
          <div
            key={index}
            className="onb-orbit-slot"
            style={{ "--angle": `${-90 + index * 60}deg` } as CSSProperties}
          >
            <div className="onb-orbit-counter">
              <span
                className="onb-orbit-tile"
                style={{ "--glyph": hue, "--i": index } as CSSProperties}
              >
                <Glyph size={22} weight="duotone" aria-hidden="true" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Training */

const LOAD_BARS = [38, 58, 0, 86, 48, 104, 24];

export function TrainingVignette({ unitSystem }: { unitSystem: UnitSystem }) {
  useLanguage();
  const split = unitSystem === "imperial" ? t("last 3 miles") : t("last 5 km");
  const weekdays = weekdayInitials();
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(20, 34, 206, 236)} className="onb-v-recovery">
        <VHead icon={Heartbeat} title={t("Recovery")} />
        <div className="onb-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <linearGradient id="onb-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--onb-mint)" />
                <stop offset="1" stopColor="var(--onb-cyan)" />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="50" className="onb-ring-track" />
            <circle
              cx="60"
              cy="60"
              r="50"
              className="onb-ring-arc"
              pathLength={100}
              stroke="url(#onb-ring-gradient)"
              style={{ "--ring-to": 6 } as CSSProperties}
            />
          </svg>
          <span className="onb-ring-copy">
            <strong>{percent(0.94)}</strong>
            <span>{t("Ready")}</span>
          </span>
        </div>
        <p className="onb-vnote">{t("Cleared for a hard session")}</p>
      </VCard>

      <VCard index={1} style={place(242, 52, 298, 204)}>
        <VHead icon={Lightning} title={t("Training load")} sub={t("This week")} hue="var(--onb-amber)">
          <span className="onb-vchip">{formatNumber(412)}</span>
        </VHead>
        <div className="onb-bars">
          <span className="onb-bars-band" />
          {LOAD_BARS.map((height, index) => (
            <span key={index} className="onb-bar-col">
              <span
                className={["onb-bar", index === 5 && "is-peak", height === 0 && "is-rest"]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--h": `${Math.max(height, 4)}px`, "--b": index } as CSSProperties}
              />
              <em>{weekdays[index]}</em>
            </span>
          ))}
        </div>
      </VCard>

      <VCard index={2} style={place(52, 286, 478)} className="onb-v-coach">
        <VHead icon={ChatCircleDots} title={t("Coach")} hue="var(--onb-blue)" />
        <p className="onb-bubble is-you">{t("How did Sunday’s long run go?")}</p>
        <div className="onb-bubble-row">
          <span className="onb-typing" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p className="onb-bubble is-coach">
            {t("Strong one. You negative-split the {{split}}, and heart-rate drift stayed under {{drift}}.", {
              split,
              drift: percent(0.04)
            })}
          </p>
        </div>
      </VCard>
    </div>
  );
}

/* --------------------------------------------------------------------- Plan */

interface PlannedPill {
  day: number;
  name: string;
  detail: string;
  sport: "run" | "bike" | "strength";
}

function currentWeek(): { dates: number[]; today: number } {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return day.getDate();
  });
  return { dates, today: mondayOffset };
}

export function PlanVignette({ unitSystem }: { unitSystem: UnitSystem }) {
  useLanguage();
  const { dates, today } = currentWeek();
  const weekdays = weekdayInitials();
  const unit = distanceUnit(unitSystem);
  const easy = unitSystem === "imperial" ? "5 mi" : "8 km";
  const long = unitSystem === "imperial" ? "12 mi" : "20 km";
  const pills: PlannedPill[] = [
    { day: 0, name: "Easy run", detail: easy, sport: "run" },
    { day: 1, name: "Strength", detail: t("45 min"), sport: "strength" },
    { day: 2, name: "Tempo", detail: t("6 × 4 min"), sport: "run" },
    { day: 4, name: "Ride", detail: t("1h 30m"), sport: "bike" },
    { day: 5, name: "Long run", detail: long, sport: "run" }
  ];
  const steps: Array<{ grow: number; height: number; work?: boolean }> = [
    { grow: 3, height: 26 },
    ...Array.from({ length: 6 }, () => [
      { grow: 1.3, height: 70, work: true },
      { grow: 0.7, height: 22 }
    ]).flat(),
    { grow: 2.4, height: 20 }
  ];
  const onPlan = percentParts(0.92);
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 46, 524)}>
        <VHead icon={CalendarDots} title={t("This week")} hue="var(--onb-violet)">
          <span className="onb-vchip is-synced">
            <ArrowsClockwise size={11} weight="bold" aria-hidden="true" />
            {t("Google Calendar")}</span>
        </VHead>
        <div className="onb-week">
          {dates.map((date, index) => (
            <div key={index} className={["onb-week-day", index === today && "is-today"].filter(Boolean).join(" ")}>
              <span className="onb-week-label">
                {weekdays[index]}
                <b>{formatNumber(date)}</b>
              </span>
              {pills
                .filter((pill) => pill.day === index)
                .map((pill) => (
                  <span key={pill.name} className={`onb-pill is-${pill.sport}${pill.day === 4 ? " is-lifted" : ""}`}>
                    <strong>{t(pill.name, undefined, "calendarPill")}</strong>
                    <span>{pill.detail}</span>
                  </span>
                ))}
              {index === 3 ? <span className="onb-pill-drop" aria-hidden="true" /> : null}
              {index === 6 ? <span className="onb-week-rest">{t("Rest")}</span> : null}
            </div>
          ))}
        </div>
      </VCard>

      <VCard index={1} style={place(34, 240, 312)}>
        <VHead
          icon={Path}
          title={t("Tempo intervals")}
          sub={t("Run · 6 × 4 min · {{distance}}", {
            distance: `${formatNumber(unitSystem === "imperial" ? 6.2 : 10)} ${unit}`
          })}
          hue="var(--onb-mint)"
        />
        <div className="onb-steps">
          {steps.map((step, index) => (
            <span
              key={index}
              className={step.work ? "is-work" : undefined}
              style={{ flexGrow: step.grow, "--h": `${step.height}px`, "--b": index } as CSSProperties}
            />
          ))}
        </div>
        <p className="onb-vnote is-left">{t("Warm up · 6 × 4 min hard, 2 min easy · Cool down")}</p>
      </VCard>

      <VCard index={2} style={place(362, 254, 180, 168)} className="onb-v-plan">
        <VHead icon={Trophy} title={t("Half marathon")} hue="var(--onb-amber)" />
        <div className="onb-phases" aria-hidden="true">
          <span className="is-done" />
          <span className="is-now" />
          <span />
          <span />
        </div>
        <span className="onb-vcaption">
          {t("Build · week {{week}} of {{total}}", { week: formatNumber(5), total: formatNumber(12) })}
        </span>
        <span className="onb-vstat">
          {onPlan.value}
          <small>{onPlan.sign}</small>
          <em>{t("on plan")}</em>
        </span>
      </VCard>
    </div>
  );
}

/* ----------------------------------------------------------------- Strength */

const MUSCLE_ROWS: Array<{ name: string; load: number[] }> = [
  { name: "Chest", load: [0.5, 0.7, 0.3, 0.8, 0.6, 0.9, 0.7, 0.8] },
  { name: "Back", load: [0.6, 0.5, 0.8, 0.7, 0.9, 0.6, 0.8, 1] },
  { name: "Shoulders", load: [0.3, 0.4, 0.2, 0.5, 0.4, 0.6, 0.5, 0.6] },
  { name: "Quads", load: [0.8, 0.9, 0.7, 1, 0.8, 0.9, 1, 0.9] },
  { name: "Hamstrings", load: [0.4, 0.3, 0.5, 0.4, 0.6, 0.5, 0.4, 0.7] },
  { name: "Glutes", load: [0.6, 0.7, 0.6, 0.8, 0.7, 0.8, 0.9, 0.8] },
  { name: "Core", load: [0.2, 0.3, 0.1, 0.3, 0.2, 0.4, 0.3, 0.2] }
];

function donutArc(start: number, end: number, radius: number): string {
  const point = (fraction: number): Point => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    return [60 + Math.cos(angle) * radius, 60 + Math.sin(angle) * radius];
  };
  const [x0, y0] = point(start);
  const [x1, y1] = point(end);
  const large = end - start > 0.5 ? 1 : 0;
  return `M${round(x0)} ${round(y0)} A${radius} ${radius} 0 ${large} 1 ${round(x1)} ${round(y1)}`;
}

export function StrengthVignette({ unitSystem }: { unitSystem: UnitSystem }) {
  useLanguage();
  const unit = weightUnit(unitSystem);
  const best = Math.round(kilogramsToDisplayWeight(142.5, unitSystem) * 2) / 2;
  const gain = Math.round(kilogramsToDisplayWeight(5, unitSystem));
  const split = [
    { label: t("Push"), share: 0.34, hue: "var(--onb-amber)" },
    { label: t("Pull"), share: 0.31, hue: "var(--onb-rose)" },
    { label: t("Legs"), share: 0.35, hue: "var(--onb-violet)" }
  ];
  let cursor = 0;
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 36, 316, 280)}>
        <VHead icon={Barbell} title={t("Muscle coverage")} sub={t("Last 8 weeks")} hue="var(--onb-amber)" />
        <div className="onb-heat" role="presentation">
          {MUSCLE_ROWS.map((row, rowIndex) => (
            <div key={row.name} className="onb-heat-row">
              <span>{t(row.name, undefined, "muscle")}</span>
              {row.load.map((value, column) => (
                <i
                  key={column}
                  style={{ "--v": value, "--b": rowIndex + column } as CSSProperties}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="onb-heat-legend" aria-hidden="true">
          <span>{t("Less")}</span>
          {[0.15, 0.4, 0.65, 0.9].map((value) => (
            <i key={value} style={{ "--v": value } as CSSProperties} />
          ))}
          <span>{t("More")}</span>
        </div>
      </VCard>

      <VCard index={1} style={place(350, 50, 192, 230)} className="onb-v-balance">
        <VHead icon={Stack} title={t("Balance")} hue="var(--onb-violet)" />
        <div className="onb-donut">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="46" className="onb-donut-track" />
            {split.map((part, index) => {
              const start = cursor + 0.012;
              cursor += part.share;
              return (
                <path
                  key={part.label}
                  d={donutArc(start, cursor - 0.012, 46)}
                  stroke={part.hue}
                  pathLength={100}
                  style={{ "--b": index } as CSSProperties}
                />
              );
            })}
          </svg>
          <span className="onb-donut-copy">{t("Even", undefined, "balance")}</span>
        </div>
        <div className="onb-legend">
          {split.map((part) => (
            <span key={part.label} style={{ "--dot": part.hue } as CSSProperties}>
              {t(part.label)}
              <b>{percent(part.share)}</b>
            </span>
          ))}
        </div>
      </VCard>

      <VCard index={2} style={place(350, 296, 192)} className="onb-v-pr">
        <span className="onb-pr-eyebrow">
          <Trophy size={13} weight="fill" aria-hidden="true" />
          {t("New best")}
        </span>
        <strong className="onb-pr-lift">{t("Back squat")}</strong>
        <span className="onb-pr-value">
          {formatNumber(best, { maximumFractionDigits: 1 })}
          <small>{unit}</small>
        </span>
        <span className="onb-pr-note">{t("Estimated 1RM · +{{gain}} {{unit}}", { gain: formatNumber(gain), unit })}</span>
      </VCard>

      <VCard index={3} style={place(18, 332, 316)} className="onb-v-hevy">
        <VHead
          icon={ArrowsClockwise}
          title="Hevy"
          sub={t("{{count}} workouts merged this month", { count: formatNumber(12) })}
          hue="var(--onb-cyan)"
        >
          <span className="onb-vchip">
            <Check size={11} weight="bold" aria-hidden="true" />
            {t("Synced")}
          </span>
        </VHead>
      </VCard>
    </div>
  );
}

/* -------------------------------------------------------------- Watch faces */

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const TICKS = Array.from({ length: 60 }, (_, index) => index);

export function WatchfacesVignette() {
  useLanguage();
  const now = useClock();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  // Watch faces print the bare abbreviation: "THU", "JEU" (not "JEU.").
  const weekday = formatDate(now, { weekday: "short" }).replace(/\.$/, "").toLocaleUpperCase(getLocale());
  return (
    <div className="onb-vignette">
      <div className="onb-watch" style={{ "--i": 0 } as CSSProperties}>
        <svg className="onb-watch-bezel" viewBox="0 0 300 300" aria-hidden="true">
          {TICKS.map((tick) => {
            const angle = (tick / 60) * Math.PI * 2;
            const major = tick % 5 === 0;
            const inner = major ? 132 : 136;
            return (
              <line
                key={tick}
                x1={150 + Math.sin(angle) * inner}
                y1={150 - Math.cos(angle) * inner}
                x2={150 + Math.sin(angle) * 142}
                y2={150 - Math.cos(angle) * 142}
                className={major ? "is-major" : undefined}
              />
            );
          })}
        </svg>
        <div className="onb-watch-face">
          <svg className="onb-watch-arc" viewBox="0 0 220 220" aria-hidden="true">
            <circle cx="110" cy="110" r="100" className="onb-watch-arc-track" />
            <circle cx="110" cy="110" r="100" className="onb-watch-arc-fill" pathLength={100} />
          </svg>
          <span className="onb-watch-date">
            {weekday} {now.getDate()}
          </span>
          <span className="onb-watch-time">
            {hours}
            <b>
              {minutes}
              <span className="onb-watch-selection" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </b>
          </span>
          <span className="onb-watch-metrics">
            <span>
              <Heart size={12} weight="fill" aria-hidden="true" />
              62
            </span>
            <span>
              <Footprints size={12} weight="fill" aria-hidden="true" />
              {formatNumber(8432)}
            </span>
          </span>
        </div>
      </div>

      <VCard index={1} style={place(16, 148, 164)} className="onb-v-layers">
        <VHead icon={Stack} title={t("Layers")} hue="var(--onb-pink)" />
        <ul className="onb-layers">
          {[
            { icon: TextT, label: t("Minutes"), selected: true },
            { icon: TextT, label: t("Hours") },
            { icon: CalendarDots, label: t("Date") },
            { icon: Footprints, label: t("Steps ring") },
            { icon: ImageSquare, label: t("Background") }
          ].map(({ icon: Glyph, label, selected }) => (
            <li key={label} className={selected ? "is-selected" : undefined}>
              <Glyph size={13} weight="bold" aria-hidden="true" />
              {t(label)}
            </li>
          ))}
        </ul>
      </VCard>

      <VCard index={2} style={place(380, 42, 166, 92)} className="onb-v-ai">
        <span className="onb-ai-label">
          <Sparkle size={13} weight="fill" aria-hidden="true" />
          {t("Ask AI")}
        </span>
        <p>{t("Make the minutes pink and a little bolder")}</p>
      </VCard>

      <VCard index={3} style={place(384, 320, 158)} className="onb-v-style">
        <span className="onb-vcaption">{t("Color")}</span>
        <span className="onb-swatches" aria-hidden="true">
          <i style={{ "--sw": "#e889c8" } as CSSProperties} className="is-picked" />
          <i style={{ "--sw": "#53cba1" } as CSSProperties} />
          <i style={{ "--sw": "#e0a93a" } as CSSProperties} />
          <i style={{ "--sw": "#7fb2f5" } as CSSProperties} />
          <i style={{ "--sw": "#f2f4f5" } as CSSProperties} />
        </span>
        <span className="onb-send">
          <PaperPlaneTilt size={13} weight="fill" aria-hidden="true" />
          {t("Install on watch", undefined, "onboarding")}
        </span>
      </VCard>
    </div>
  );
}

/* --------------------------------------------------------------------- Maps */

function contour(cx: number, cy: number, radius: number, seed: number): string {
  const points: Point[] = [];
  for (let step = 0; step < 18; step += 1) {
    const angle = (step / 18) * Math.PI * 2;
    const wobble = 1 + 0.13 * Math.sin(3 * angle + seed) + 0.07 * Math.cos(5 * angle + seed * 1.7);
    points.push([cx + Math.cos(angle) * radius * wobble * 1.3, cy + Math.sin(angle) * radius * wobble * 0.82]);
  }
  return smoothPath(points, true);
}

const CONTOURS = [
  ...[16, 36, 58, 82, 108, 136, 166].map((radius, index) => ({ d: contour(352, 104, radius, 0.6), index })),
  ...[14, 32, 52, 74, 98].map((radius, index) => ({ d: contour(118, 214, radius, 2.1), index }))
];

const ROUTE: Point[] = [
  [44, 250],
  [92, 222],
  [146, 232],
  [196, 196],
  [226, 146],
  [286, 128],
  [338, 94],
  [404, 104],
  [470, 62]
];
const ROUTE_PATH = smoothPath(ROUTE);

const PROFILE: Point[] = Array.from({ length: 40 }, (_, index) => {
  const x = index / 39;
  const height = 0.18 + 0.62 * x + 0.12 * Math.sin(x * 9 + 0.4) + 0.06 * Math.sin(x * 23);
  return [x * 300, 70 - Math.max(0.04, Math.min(1, height)) * 62];
});
const PROFILE_LINE = smoothPath(PROFILE);
const PROFILE_AREA = `${PROFILE_LINE} L300 72 L0 72Z`;

export function MapsVignette({ unitSystem }: { unitSystem: UnitSystem }) {
  useLanguage();
  const distance = formatNumber(unitSystem === "imperial" ? 7.7 : 12.4);
  const climb = formatNumber(Math.round(metersToElevation(386, unitSystem)));
  const climbUnit = elevationUnit(unitSystem);
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 18, 524, 290)} className="onb-v-map">
        <svg className="onb-map" viewBox="0 0 524 290" preserveAspectRatio="none" aria-hidden="true">
          {CONTOURS.map((line, index) => (
            <path key={index} d={line.d} className={line.index % 3 === 2 ? "is-index" : undefined} />
          ))}
          <path d={ROUTE_PATH} className="onb-route-casing" pathLength={1} />
          <path d={ROUTE_PATH} className="onb-route" pathLength={1} />
          <circle cx={ROUTE[0][0]} cy={ROUTE[0][1]} r="6" className="onb-route-start" />
          <circle cx={ROUTE[8][0]} cy={ROUTE[8][1]} r="6" className="onb-route-end" />
        </svg>
        <span className="onb-map-chip">
          <Path size={13} weight="bold" aria-hidden="true" />
          {distance} {distanceUnit(unitSystem)}
          <i />
          ↑ {climb} {climbUnit}
        </span>
        <span className="onb-map-layer">{t("Topo")}</span>
      </VCard>

      <VCard index={1} style={place(18, 322, 340, 122)}>
        <VHead icon={Path} title={t("Elevation")} hue="var(--onb-blue)">
          <span className="onb-vchip">
            ↑ {climb} {climbUnit}
          </span>
        </VHead>
        <svg className="onb-profile" viewBox="0 0 300 72" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="onb-profile-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--onb-hue)" stopOpacity="0.38" />
              <stop offset="1" stopColor="var(--onb-hue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={PROFILE_AREA} fill="url(#onb-profile-fill)" />
          <path d={PROFILE_LINE} className="onb-profile-line" />
        </svg>
      </VCard>

      <VCard index={2} style={place(374, 322, 168, 122)} className="onb-v-download">
        <VHead
          icon={DownloadSimple}
          title={t("Alps topo")}
          sub={t("{{p0}} GB", { p0: formatNumber(1.2) })}
          hue="var(--onb-mint)"
        />
        <span className="onb-progress" style={{ "--p": 0.64 } as CSSProperties}>
          <i />
        </span>
        <span className="onb-vcaption">{t("Installing on watch · {{progress}}", { progress: percent(0.64) })}</span>
      </VCard>
    </div>
  );
}

/* -------------------------------------------------------------------- Music */

/* Titles are provider content and stay as published; `detail` is translated. */
const TRACKS: Array<{
  title: string;
  source: string;
  detail: string;
  count: number;
  art: string;
  initial: string;
  state: "done" | "copying" | "queued";
}> = [
  { title: "Tempo Run Mix", source: "Spotify", detail: "{{count}} tracks", count: 24, art: "#53cba1", initial: "T", state: "done" },
  { title: "Trail Talk", source: "Podcast", detail: "Episode {{count}}", count: 112, art: "#a495ff", initial: "T", state: "done" },
  { title: "Pride and Prejudice", source: "LibriVox", detail: "{{count}} parts", count: 18, art: "#e0a93a", initial: "P", state: "copying" },
  { title: "Long Run Lo-fi", source: "YouTube Music", detail: "{{count}} tracks", count: 31, art: "#f47a86", initial: "L", state: "queued" }
];

const SOURCES: Array<{ icon: Icon; label: string; tint: string }> = [
  { icon: YoutubeLogo, label: "YouTube", tint: "var(--onb-rose)" },
  { icon: SpotifyLogo, label: "Spotify", tint: "var(--onb-mint)" },
  { icon: AppleLogo, label: "Apple Music", tint: "var(--text-primary)" },
  { icon: Microphone, label: "Podcasts", tint: "var(--onb-violet)" },
  { icon: Books, label: "Audiobooks", tint: "var(--onb-amber)" },
  { icon: MusicNotes, label: "Your files", tint: "var(--onb-blue)" }
];

export function MusicVignette() {
  useLanguage();
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 16, 340)}>
        <VHead icon={MusicNotes} title={t("Library")} sub={t("Ready for your watch")} hue="var(--onb-rose)" />
        <ul className="onb-tracks">
          {TRACKS.map((track) => (
            <li key={track.title} className={track.state === "copying" ? "is-copying" : undefined}>
              <span className="onb-art" style={{ "--art": track.art } as CSSProperties}>
                {track.initial}
              </span>
              <span className="onb-track-copy">
                <strong>{track.title}</strong>
                <span>
                  {t(track.source)} · {t(track.detail, { count: formatNumber(track.count) })}
                </span>
              </span>
              {track.state === "done" ? (
                <CheckCircle className="onb-track-state is-done" size={17} weight="fill" aria-hidden="true" />
              ) : track.state === "copying" ? (
                <span className="onb-track-state is-copying" aria-hidden="true" />
              ) : (
                <Clock className="onb-track-state" size={16} weight="bold" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      </VCard>

      <VCard index={1} style={place(374, 28, 168, 214)} className="onb-v-storage">
        <VHead icon={Watch} title={t("On your watch", undefined, "onboarding")} hue="var(--onb-pink)" />
        <div className="onb-ring is-small">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="48" className="onb-ring-track" />
            <circle
              cx="60"
              cy="60"
              r="48"
              className="onb-ring-arc"
              pathLength={100}
              stroke="var(--onb-hue)"
              style={{ "--ring-to": 38 } as CSSProperties}
            />
          </svg>
          <span className="onb-ring-copy">
            <strong>
              {formatNumber(2.4)}
              <small>{t("GB")}</small>
            </strong>
            <span>{t("free", undefined, "storage")}</span>
          </span>
        </div>
      </VCard>

      <VCard index={2} style={place(374, 258, 168)} className="onb-v-sources">
        <span className="onb-vcaption">{t("Sources")}</span>
        <span className="onb-sources">
          {SOURCES.map(({ icon: Glyph, label, tint }) => (
            <span key={label} title={t(label)} style={{ "--tint": tint } as CSSProperties}>
              <Glyph size={17} weight="duotone" aria-hidden="true" />
            </span>
          ))}
        </span>
      </VCard>

      <VCard index={3} style={place(18, 340, 340)} className="onb-v-transfer">
        <VHead
          icon={Books}
          title={t("Copying to watch")}
          sub={t("{{title}} · part {{part}} of {{total}}", {
            title: t("Pride and Prejudice"),
            part: formatNumber(7),
            total: formatNumber(18)
          })}
          hue="var(--onb-amber)"
        />
        <span className="onb-progress is-live" style={{ "--p": 0.39 } as CSSProperties}>
          <i />
        </span>
      </VCard>
    </div>
  );
}

/* ---------------------------------------------------------------- Connect */

export function ConnectedBadge() {
  useLanguage();
  return (
    <span className="onb-connected">
      <Check size={13} weight="bold" aria-hidden="true" />
      {t("Connected")}
    </span>
  );
}
