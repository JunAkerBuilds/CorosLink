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
  return (
    <div className="onb-vignette onb-v-welcome">
      <svg className="onb-orbit-rings" viewBox="0 0 560 470" aria-hidden="true">
        <circle cx="280" cy="235" r="182" className="is-outer" />
        <circle cx="280" cy="235" r="122" className="is-inner" />
      </svg>
      <div className="onb-orbit-glow" />
      {/* Base and arrows are separate images so only the arrows' cached texture spins. */}
      <div className="onb-orbit-icon">
        <img src={logoBase} alt="" />
        <img className="is-sync" src={logoSync} alt="" />
      </div>
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
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

export function TrainingVignette({ unitSystem }: { unitSystem: UnitSystem }) {
  const split = unitSystem === "imperial" ? "last 3 miles" : "last 5 km";
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(20, 34, 206, 236)} className="onb-v-recovery">
        <VHead icon={Heartbeat} title="Recovery" />
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
            <strong>94%</strong>
            <span>Ready</span>
          </span>
        </div>
        <p className="onb-vnote">Cleared for a hard session</p>
      </VCard>

      <VCard index={1} style={place(242, 52, 298, 204)}>
        <VHead icon={Lightning} title="Training load" sub="This week" hue="var(--onb-amber)">
          <span className="onb-vchip">412</span>
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
              <em>{WEEKDAY_INITIALS[index]}</em>
            </span>
          ))}
        </div>
      </VCard>

      <VCard index={2} style={place(52, 286, 478)} className="onb-v-coach">
        <VHead icon={ChatCircleDots} title="Coach" hue="var(--onb-blue)" />
        <p className="onb-bubble is-you">How did Sunday’s long run go?</p>
        <div className="onb-bubble-row">
          <span className="onb-typing" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p className="onb-bubble is-coach">
            Strong one. You negative-split the {split}, and heart-rate drift stayed under 4%.
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
  const { dates, today } = currentWeek();
  const unit = distanceUnit(unitSystem);
  const easy = unitSystem === "imperial" ? "5 mi" : "8 km";
  const long = unitSystem === "imperial" ? "12 mi" : "20 km";
  const pills: PlannedPill[] = [
    { day: 0, name: "Easy run", detail: easy, sport: "run" },
    { day: 1, name: "Strength", detail: "45 min", sport: "strength" },
    { day: 2, name: "Tempo", detail: "6 × 4 min", sport: "run" },
    { day: 4, name: "Ride", detail: "1h 30m", sport: "bike" },
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
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 46, 524)}>
        <VHead icon={CalendarDots} title="This week" hue="var(--onb-violet)">
          <span className="onb-vchip is-synced">
            <ArrowsClockwise size={11} weight="bold" aria-hidden="true" />
            Google Calendar
          </span>
        </VHead>
        <div className="onb-week">
          {dates.map((date, index) => (
            <div key={index} className={["onb-week-day", index === today && "is-today"].filter(Boolean).join(" ")}>
              <span className="onb-week-label">
                {WEEKDAY_INITIALS[index]}
                <b>{date}</b>
              </span>
              {pills
                .filter((pill) => pill.day === index)
                .map((pill) => (
                  <span key={pill.name} className={`onb-pill is-${pill.sport}${pill.day === 4 ? " is-lifted" : ""}`}>
                    <strong>{pill.name}</strong>
                    <span>{pill.detail}</span>
                  </span>
                ))}
              {index === 3 ? <span className="onb-pill-drop" aria-hidden="true" /> : null}
              {index === 6 ? <span className="onb-week-rest">Rest</span> : null}
            </div>
          ))}
        </div>
      </VCard>

      <VCard index={1} style={place(34, 240, 312)}>
        <VHead icon={Path} title="Tempo intervals" sub={`Run · 6 × 4 min · ${unitSystem === "imperial" ? "6.2" : "10"} ${unit}`} hue="var(--onb-mint)" />
        <div className="onb-steps">
          {steps.map((step, index) => (
            <span
              key={index}
              className={step.work ? "is-work" : undefined}
              style={{ flexGrow: step.grow, "--h": `${step.height}px`, "--b": index } as CSSProperties}
            />
          ))}
        </div>
        <p className="onb-vnote is-left">Warm up · 6 × 4 min hard, 2 min easy · Cool down</p>
      </VCard>

      <VCard index={2} style={place(362, 254, 180, 168)} className="onb-v-plan">
        <VHead icon={Trophy} title="Half marathon" hue="var(--onb-amber)" />
        <div className="onb-phases" aria-hidden="true">
          <span className="is-done" />
          <span className="is-now" />
          <span />
          <span />
        </div>
        <span className="onb-vcaption">Build · week 5 of 12</span>
        <span className="onb-vstat">
          92<small>%</small>
          <em>on plan</em>
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
  const unit = weightUnit(unitSystem);
  const best = Math.round(kilogramsToDisplayWeight(142.5, unitSystem) * 2) / 2;
  const gain = Math.round(kilogramsToDisplayWeight(5, unitSystem));
  const split = [
    { label: "Push", share: 0.34, hue: "var(--onb-amber)" },
    { label: "Pull", share: 0.31, hue: "var(--onb-rose)" },
    { label: "Legs", share: 0.35, hue: "var(--onb-violet)" }
  ];
  let cursor = 0;
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 36, 316, 280)}>
        <VHead icon={Barbell} title="Muscle coverage" sub="Last 8 weeks" hue="var(--onb-amber)" />
        <div className="onb-heat" role="presentation">
          {MUSCLE_ROWS.map((row, rowIndex) => (
            <div key={row.name} className="onb-heat-row">
              <span>{row.name}</span>
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
          <span>Less</span>
          {[0.15, 0.4, 0.65, 0.9].map((value) => (
            <i key={value} style={{ "--v": value } as CSSProperties} />
          ))}
          <span>More</span>
        </div>
      </VCard>

      <VCard index={1} style={place(350, 50, 192, 230)} className="onb-v-balance">
        <VHead icon={Stack} title="Balance" hue="var(--onb-violet)" />
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
          <span className="onb-donut-copy">Even</span>
        </div>
        <div className="onb-legend">
          {split.map((part) => (
            <span key={part.label} style={{ "--dot": part.hue } as CSSProperties}>
              {part.label}
              <b>{Math.round(part.share * 100)}%</b>
            </span>
          ))}
        </div>
      </VCard>

      <VCard index={2} style={place(350, 296, 192)} className="onb-v-pr">
        <span className="onb-pr-eyebrow">
          <Trophy size={13} weight="fill" aria-hidden="true" />
          New best
        </span>
        <strong className="onb-pr-lift">Back squat</strong>
        <span className="onb-pr-value">
          {best.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          <small>{unit}</small>
        </span>
        <span className="onb-pr-note">Estimated 1RM · +{gain} {unit}</span>
      </VCard>

      <VCard index={3} style={place(18, 332, 316)} className="onb-v-hevy">
        <VHead icon={ArrowsClockwise} title="Hevy" sub="12 workouts merged this month" hue="var(--onb-cyan)">
          <span className="onb-vchip">
            <Check size={11} weight="bold" aria-hidden="true" />
            Synced
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
  const now = useClock();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
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
              8,432
            </span>
          </span>
        </div>
      </div>

      <VCard index={1} style={place(16, 148, 164)} className="onb-v-layers">
        <VHead icon={Stack} title="Layers" hue="var(--onb-pink)" />
        <ul className="onb-layers">
          {[
            { icon: TextT, label: "Minutes", selected: true },
            { icon: TextT, label: "Hours" },
            { icon: CalendarDots, label: "Date" },
            { icon: Footprints, label: "Steps ring" },
            { icon: ImageSquare, label: "Background" }
          ].map(({ icon: Glyph, label, selected }) => (
            <li key={label} className={selected ? "is-selected" : undefined}>
              <Glyph size={13} weight="bold" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </VCard>

      <VCard index={2} style={place(380, 42, 166, 92)} className="onb-v-ai">
        <span className="onb-ai-label">
          <Sparkle size={13} weight="fill" aria-hidden="true" />
          Ask AI
        </span>
        <p>Make the minutes pink and a little bolder</p>
      </VCard>

      <VCard index={3} style={place(384, 320, 158)} className="onb-v-style">
        <span className="onb-vcaption">Color</span>
        <span className="onb-swatches" aria-hidden="true">
          <i style={{ "--sw": "#e889c8" } as CSSProperties} className="is-picked" />
          <i style={{ "--sw": "#53cba1" } as CSSProperties} />
          <i style={{ "--sw": "#e0a93a" } as CSSProperties} />
          <i style={{ "--sw": "#7fb2f5" } as CSSProperties} />
          <i style={{ "--sw": "#f2f4f5" } as CSSProperties} />
        </span>
        <span className="onb-send">
          <PaperPlaneTilt size={13} weight="fill" aria-hidden="true" />
          Install on watch
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
  const distance = unitSystem === "imperial" ? "7.7" : "12.4";
  const climb = Math.round(metersToElevation(386, unitSystem)).toLocaleString();
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
        <span className="onb-map-layer">Topo</span>
      </VCard>

      <VCard index={1} style={place(18, 322, 340, 122)}>
        <VHead icon={Path} title="Elevation" hue="var(--onb-blue)">
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
        <VHead icon={DownloadSimple} title="Alps topo" sub="1.2 GB" hue="var(--onb-mint)" />
        <span className="onb-progress" style={{ "--p": 0.64 } as CSSProperties}>
          <i />
        </span>
        <span className="onb-vcaption">Installing on watch · 64%</span>
      </VCard>
    </div>
  );
}

/* -------------------------------------------------------------------- Music */

const TRACKS: Array<{
  title: string;
  source: string;
  art: string;
  initial: string;
  state: "done" | "copying" | "queued";
}> = [
  { title: "Tempo Run Mix", source: "Spotify · 24 tracks", art: "#53cba1", initial: "T", state: "done" },
  { title: "Trail Talk", source: "Podcast · Episode 112", art: "#a495ff", initial: "T", state: "done" },
  { title: "Pride and Prejudice", source: "LibriVox · 18 parts", art: "#e0a93a", initial: "P", state: "copying" },
  { title: "Long Run Lo-fi", source: "YouTube Music · 31 tracks", art: "#f47a86", initial: "L", state: "queued" }
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
  return (
    <div className="onb-vignette">
      <VCard index={0} style={place(18, 16, 340)}>
        <VHead icon={MusicNotes} title="Library" sub="Ready for your watch" hue="var(--onb-rose)" />
        <ul className="onb-tracks">
          {TRACKS.map((track) => (
            <li key={track.title} className={track.state === "copying" ? "is-copying" : undefined}>
              <span className="onb-art" style={{ "--art": track.art } as CSSProperties}>
                {track.initial}
              </span>
              <span className="onb-track-copy">
                <strong>{track.title}</strong>
                <span>{track.source}</span>
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
        <VHead icon={Watch} title="On your watch" hue="var(--onb-pink)" />
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
              2.4<small>GB</small>
            </strong>
            <span>free</span>
          </span>
        </div>
      </VCard>

      <VCard index={2} style={place(374, 258, 168)} className="onb-v-sources">
        <span className="onb-vcaption">Sources</span>
        <span className="onb-sources">
          {SOURCES.map(({ icon: Glyph, label, tint }) => (
            <span key={label} title={label} style={{ "--tint": tint } as CSSProperties}>
              <Glyph size={17} weight="duotone" aria-hidden="true" />
            </span>
          ))}
        </span>
      </VCard>

      <VCard index={3} style={place(18, 340, 340)} className="onb-v-transfer">
        <VHead icon={Books} title="Copying to watch" sub="Pride and Prejudice · part 7 of 18" hue="var(--onb-amber)" />
        <span className="onb-progress is-live" style={{ "--p": 0.39 } as CSSProperties}>
          <i />
        </span>
      </VCard>
    </div>
  );
}

/* ---------------------------------------------------------------- Connect */

export function ConnectedBadge() {
  return (
    <span className="onb-connected">
      <Check size={13} weight="bold" aria-hidden="true" />
      Connected
    </span>
  );
}
