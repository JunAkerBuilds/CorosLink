import { useId } from "react";
import type { OverviewWeatherKind } from "./overviewWeather";

// Filled, gradient-shaded weather icons (48×48 canvas). Gradients use
// userSpaceOnUse so overlapping cloud puffs shade as one continuous shape.

const SUN_RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function Sun({
  id,
  cx,
  cy,
  r
}: {
  id: string;
  cx: number;
  cy: number;
  r: number;
}) {
  return (
    <g>
      <defs>
        <radialGradient
          id={`${id}-sun`}
          cx={cx - r * 0.35}
          cy={cy - r * 0.4}
          r={r * 1.5}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff6b8" />
          <stop offset="0.45" stopColor="#ffd23f" />
          <stop offset="1" stopColor="#f59e0b" />
        </radialGradient>
      </defs>
      {SUN_RAY_ANGLES.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <circle
            key={angle}
            cx={cx + Math.cos(rad) * r * 1.55}
            cy={cy + Math.sin(rad) * r * 1.55}
            r={r * 0.14}
            fill="#fbbf24"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-sun)`} />
    </g>
  );
}

function Moon({
  id,
  cx,
  cy,
  r
}: {
  id: string;
  cx: number;
  cy: number;
  r: number;
}) {
  return (
    <g>
      <defs>
        <linearGradient
          id={`${id}-moon`}
          x1={cx - r}
          y1={cy - r}
          x2={cx + r}
          y2={cy + r}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff8dc" />
          <stop offset="1" stopColor="#f2c45a" />
        </linearGradient>
        <mask id={`${id}-moon-mask`}>
          <circle cx={cx} cy={cy} r={r} fill="#fff" />
          <circle cx={cx + r * 0.55} cy={cy - r * 0.45} r={r * 0.85} fill="#000" />
        </mask>
      </defs>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={`url(#${id}-moon)`}
        mask={`url(#${id}-moon-mask)`}
      />
    </g>
  );
}

function Cloud({
  id,
  dx = 0,
  dy = 0,
  scale = 1,
  dark = false
}: {
  id: string;
  dx?: number;
  dy?: number;
  scale?: number;
  dark?: boolean;
}) {
  const gradientId = `${id}-cloud${dark ? "-dark" : ""}${dx}${dy}`;
  return (
    <g transform={`translate(${dx} ${dy}) scale(${scale})`}>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="13"
          x2="0"
          y2="36"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={dark ? "#dfe5ee" : "#ffffff"} />
          <stop offset="1" stopColor={dark ? "#8492a6" : "#c6d1df"} />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <circle cx="16" cy="28" r="7" />
        <circle cx="25" cy="22" r="9" />
        <circle cx="34" cy="27" r="7" />
        <rect x="9" y="26" width="32" height="10" rx="5" />
      </g>
    </g>
  );
}

function Drops({ id, count, long }: { id: string; count: number; long: boolean }) {
  const xs = count === 3 ? [17, 24, 31] : [15, 21.5, 28, 34.5];
  return (
    <g>
      <defs>
        <linearGradient
          id={`${id}-drop`}
          x1="0"
          y1="36"
          x2="0"
          y2="46"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#8fd0ff" />
          <stop offset="1" stopColor="#2f80ed" />
        </linearGradient>
      </defs>
      {xs.map((x, index) => (
        <line
          key={x}
          x1={x}
          y1={37 + (index % 2) * 1.5}
          x2={x - 1.5}
          y2={(long ? 44 : 41) + (index % 2) * 1.5}
          stroke={`url(#${id}-drop)`}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function Snowflakes() {
  return (
    <g fill="#e6f4ff" stroke="#8fc8f0" strokeWidth="0.6">
      <circle cx="16" cy="39" r="2" />
      <circle cx="24" cy="43" r="2" />
      <circle cx="32" cy="39" r="2" />
    </g>
  );
}

function Bolt({ id }: { id: string }) {
  return (
    <g>
      <defs>
        <linearGradient
          id={`${id}-bolt`}
          x1="0"
          y1="28"
          x2="0"
          y2="47"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffe766" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path
        d="M26 28 L18.5 39 H24 L21 47 L30.5 34.5 H25 L28.5 28 Z"
        fill={`url(#${id}-bolt)`}
        stroke="#e08a00"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </g>
  );
}

function FogLines() {
  return (
    <g stroke="#b4c0cf" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="39" x2="34" y2="39" />
      <line x1="17" y1="44" x2="38" y2="44" />
    </g>
  );
}

export function WeatherIcon({
  kind,
  isDay,
  size = 40
}: {
  kind: OverviewWeatherKind;
  isDay: boolean;
  size?: number;
}) {
  const id = `wx${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const celestial = (cx: number, cy: number, r: number) =>
    isDay ? (
      <Sun id={id} cx={cx} cy={cy} r={r} />
    ) : (
      <Moon id={id} cx={cx} cy={cy} r={r * 1.1} />
    );

  let content;
  switch (kind) {
    case "clear":
      content = celestial(24, 24, 10.5);
      break;
    case "partly-cloudy":
      content = (
        <>
          {celestial(17, 17, 8)}
          <Cloud id={id} dx={4} dy={6} />
        </>
      );
      break;
    case "fog":
      content = (
        <>
          <Cloud id={id} dy={-4} />
          <FogLines />
        </>
      );
      break;
    case "drizzle":
      content = (
        <>
          <Cloud id={id} dy={-4} />
          <Drops id={id} count={3} long={false} />
        </>
      );
      break;
    case "rain":
      content = (
        <>
          <Cloud id={id} dy={-4} />
          <Drops id={id} count={4} long />
        </>
      );
      break;
    case "snow":
      content = (
        <>
          <Cloud id={id} dy={-4} />
          <Snowflakes />
        </>
      );
      break;
    case "thunder":
      content = (
        <>
          <Cloud id={id} dy={-5} dark />
          <Bolt id={id} />
        </>
      );
      break;
    case "cloudy":
    default:
      content = (
        <>
          <Cloud id={id} dx={9} dy={-5} scale={0.82} dark />
          <Cloud id={id} dx={-3} dy={3} />
        </>
      );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      {content}
    </svg>
  );
}
