"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Activity, ChevronDown, Flame, Heart, type LucideIcon } from "lucide-react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const MOCK_WIDTH = 1120;
const RECOVERY = 88;
const RING_RADIUS = 78;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const WEEKLY_ACTIVITY = [
  { label: "Mon", value: 4.2 },
  { label: "Tue", value: 4.6 },
  { label: "Wed", value: 9.2 },
  { label: "Thu", value: 0 },
  { label: "Fri", value: 0 },
  { label: "Sat", value: 0 },
  { label: "Sun", value: 0 },
];

const WEEKLY_MAX = 12;
const HEATMAP_MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];
const HEATMAP_DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const HEATMAP_COLUMNS = 42;
const VO2_CENTER = { x: 130, y: 130 };
const VO2_RADIUS = 94;
const VO2_SEGMENTS = [
  { className: "is-red", start: 180, end: 146 },
  { className: "is-yellow", start: 142, end: 122 },
  { className: "is-green", start: 118, end: 75 },
  { className: "is-blue", start: 71, end: 0 },
];

function heatmapLevel(index: number) {
  const column = Math.floor(index / 7);
  const row = index % 7;

  if (column < 35) {
    return (column + row) % 11 === 0 ? 1 : 0;
  }

  if (column < 39) {
    return (column + row) % 5 === 0 ? 1 : 0;
  }

  if (column === 39) {
    return [0, 3, 5].includes(row) ? 1 : 0;
  }

  if (column === 40) {
    return [1, 3, 4, 6].includes(row) ? 2 : 0;
  }

  return [1, 2, 4, 5, 6].includes(row) ? 3 : row === 3 ? 1 : 0;
}

function vo2ArcPoint(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: VO2_CENTER.x + VO2_RADIUS * Math.cos(radians),
    y: VO2_CENTER.y - VO2_RADIUS * Math.sin(radians),
  };
}

function vo2ArcPath(startDegrees: number, endDegrees: number) {
  const start = vo2ArcPoint(startDegrees);
  const end = vo2ArcPoint(endDegrees);

  return [
    `M ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
    `A ${VO2_RADIUS} ${VO2_RADIUS} 0 0 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
  ].join(" ");
}

export function FitnessCard() {
  const reduced = usePrefersReducedMotion();
  const shellRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const ringOffset = RING_CIRCUMFERENCE - (RECOVERY / 100) * RING_CIRCUMFERENCE;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const updateScale = () => {
      setScale(Math.min(1, shell.clientWidth / MOCK_WIDTH));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={shellRef}
      className="training-hub-mock"
      style={{ "--training-hub-mock-scale": scale } as CSSProperties}
      aria-label="Training Intelligence dashboard card preview"
    >
      <div className="training-hub-mock__cards">
        <div className="training-hub-mock__top-grid">
          <RecoveryCard ringOffset={ringOffset} reduced={reduced} />
          <WeeklyActivityCard reduced={reduced} />
          <Vo2Card reduced={reduced} />
        </div>
        <HeatmapCard reduced={reduced} />
      </div>
    </div>
  );
}

function RecoveryCard({
  ringOffset,
  reduced,
}: {
  ringOffset: number;
  reduced: boolean;
}) {
  return (
    <motion.article
      className="training-hub-mock__card training-hub-mock__recovery-card"
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: reduced ? 0 : 0.55, ease: "easeOut" }}
    >
      <div className="training-hub-mock__card-header">
        <p>Recovery</p>
      </div>

      <div className="training-hub-mock__recovery-body">
        <div className="training-hub-mock__recovery-ring">
          <svg viewBox="0 0 190 190" aria-hidden="true">
            <circle className="training-hub-mock__recovery-track" cx="95" cy="95" r={RING_RADIUS} />
            <motion.circle
              className="training-hub-mock__recovery-progress"
              cx="95"
              cy="95"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={{ strokeDashoffset: reduced ? ringOffset : RING_CIRCUMFERENCE }}
              whileInView={{ strokeDashoffset: ringOffset }}
              viewport={{ once: true }}
              transition={{ duration: reduced ? 0 : 0.9, ease: "easeOut" }}
            />
          </svg>
          <div>
            <strong>{RECOVERY}%</strong>
            <span>Ready</span>
          </div>
        </div>
        <p>Recovery is strong. You&apos;re cleared for a hard session.</p>
      </div>

      <div className="training-hub-mock__metric-grid">
        <MetricCard Icon={Flame} label="Load" value="0" detail="686 / 7 days" tone="load" />
        <MetricCard Icon={Heart} label="Resting HR" value="50" detail="+0.3 vs avg" tone="heart" />
      </div>
    </motion.article>
  );
}

function WeeklyActivityCard({ reduced }: { reduced: boolean }) {
  return (
    <motion.article
      className="training-hub-mock__card training-hub-mock__weekly-card"
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.08, ease: "easeOut" }}
    >
      <div className="training-hub-mock__card-header">
        <p>Weekly Activity</p>
        <span className="training-hub-mock__select-pill">
          <i aria-hidden="true" />
          Distance (km)
          <ChevronDown size={14} aria-hidden="true" />
        </span>
      </div>

      <div className="training-hub-mock__weekly-legend">
        <span aria-hidden="true" />
        <strong>Distance (km)</strong>
        <em>17.28 km</em>
      </div>

      <div className="training-hub-mock__activity-chart" aria-label="Weekly distance activity chart">
        <div className="training-hub-mock__y-axis">
          <span>KM</span>
          <span>12</span>
          <span>10</span>
          <span>8.0</span>
          <span>6.0</span>
          <span>4.0</span>
          <span>2.0</span>
          <span>0.0</span>
        </div>
        <div className="training-hub-mock__plot">
          <div className="training-hub-mock__grid-lines" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="training-hub-mock__bars">
            {WEEKLY_ACTIVITY.map((day, index) => (
              <div className={day.value === 0 ? "is-empty" : ""} key={day.label}>
                <motion.span
                  initial={{ height: reduced ? `${Math.max(2, (day.value / WEEKLY_MAX) * 100)}%` : "2%" }}
                  whileInView={{ height: `${Math.max(2, (day.value / WEEKLY_MAX) * 100)}%` }}
                  viewport={{ once: true }}
                  transition={{
                    duration: reduced ? 0 : 0.68,
                    delay: reduced ? 0 : index * 0.05,
                    ease: "easeOut",
                  }}
                />
                <em>{day.label}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function Vo2Card({ reduced }: { reduced: boolean }) {
  return (
    <motion.article
      className="training-hub-mock__card training-hub-mock__vo2-card"
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.16, ease: "easeOut" }}
    >
      <div className="training-hub-mock__vo2-heading">
        <div>
          <p>VO2 Max</p>
          <strong>Running engine</strong>
        </div>
        <span aria-hidden="true">
          <Activity size={18} />
        </span>
      </div>

      <Vo2Gauge reduced={reduced} />

      <div className="training-hub-mock__vo2-footer">
        <div>
          <span>Level</span>
          <strong>Peak</strong>
        </div>
        <div>
          <span>Change</span>
          <strong>0</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>Wed, Jul 1</strong>
        </div>
      </div>
    </motion.article>
  );
}

function HeatmapCard({ reduced }: { reduced: boolean }) {
  const cells = Array.from({ length: HEATMAP_COLUMNS * 7 }, (_, index) => ({
    id: index,
    level: heatmapLevel(index),
  }));

  return (
    <motion.article
      className="training-hub-mock__card training-hub-mock__heatmap-card"
      initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.22, ease: "easeOut" }}
    >
      <div className="training-hub-mock__heatmap-header">
        <div>
          <p>Training Activity</p>
          <strong>Load heatmap</strong>
        </div>
        <span>Last 365 days</span>
      </div>

      <div className="training-hub-mock__heatmap-body" aria-label="Load heatmap for the last 365 days">
        <div className="training-hub-mock__heatmap-months">
          {HEATMAP_MONTHS.map((month, index) => (
            <span key={`${month}-${index}`}>{month}</span>
          ))}
        </div>
        <div className="training-hub-mock__heatmap-days">
          {HEATMAP_DAYS.map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="training-hub-mock__heatmap-grid">
          {cells.map((cell) => (
            <motion.span
              data-level={cell.level}
              key={cell.id}
              initial={{ opacity: reduced ? 1 : 0, scale: reduced ? 1 : 0.65 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: reduced ? 0 : 0.35,
                delay: reduced ? 0 : Math.min(cell.id * 0.002, 0.45),
                ease: "easeOut",
              }}
            />
          ))}
        </div>
      </div>

      <div className="training-hub-mock__heatmap-footer">
        <div className="training-hub-mock__heatmap-legend">
          <span>Less</span>
          {[0, 1, 2, 3].map((level) => (
            <i data-level={level} key={level} aria-hidden="true" />
          ))}
          <span>More</span>
        </div>
        <div className="training-hub-mock__heatmap-stats">
          <strong>7 active days</strong>
          <strong>0-day streak</strong>
          <strong>718 total load</strong>
        </div>
      </div>
    </motion.article>
  );
}

function MetricCard({
  Icon,
  label,
  value,
  detail,
  tone,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "load" | "heart";
}) {
  return (
    <div className={`training-hub-mock__metric-card is-${tone}`}>
      <span aria-hidden="true">
        <Icon size={14} />
      </span>
      <p>{label}</p>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function Vo2Gauge({ reduced }: { reduced: boolean }) {
  return (
    <div className="training-hub-mock__vo2-gauge">
      <svg viewBox="0 0 260 158" aria-hidden="true">
        <path className="training-hub-mock__vo2-track" d="M 36 130 A 94 94 0 0 1 224 130" />
        {VO2_SEGMENTS.map((segment, index) => (
          <motion.path
            className={`training-hub-mock__vo2-band ${segment.className}`}
            d={vo2ArcPath(segment.start, segment.end)}
            initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
            key={segment.className}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{
              duration: reduced ? 0 : 0.48,
              delay: reduced ? 0 : index * 0.1,
              ease: "easeOut",
            }}
          />
        ))}
        <motion.line
          className="training-hub-mock__vo2-needle"
          x1="130"
          y1="130"
          x2="202"
          y2="84"
          initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.36, ease: "easeOut" }}
        />
        <motion.circle
          className="training-hub-mock__vo2-pin"
          cx="130"
          cy="130"
          r="6"
          initial={{ scale: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 0.62, ease: "easeOut" }}
          style={{ transformOrigin: "130px 130px" }}
        />
      </svg>
      <div>
        <strong>53</strong>
      </div>
    </div>
  );
}
