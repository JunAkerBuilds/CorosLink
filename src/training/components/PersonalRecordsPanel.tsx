import { Footprints, Mountain, Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  TrainingHubDashboard,
  TrainingHubPersonalRecord
} from "../../../electron/types";
import {
  formatPersonalRecordHero,
  formatPersonalRecordMeta,
  formatRecordDateShort,
  isPersonalRecordPopulated,
  isPersonalRecordVisible
} from "../formatters";

interface PersonalRecordsPanelProps {
  dashboard: TrainingHubDashboard | null;
}

const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;

function recordIcon(type: number) {
  if (type === RECORD_TYPE_LONGEST_RUN) {
    return Route;
  }

  if (type === RECORD_TYPE_ELEVATION_GAIN) {
    return Mountain;
  }

  return Footprints;
}

/** Split "12.01km" / "84m" into a bold value and a muted unit. */
function splitHero(hero: string): { value: string; unit: string | null } {
  const match = hero.match(/^([\d.:]+)\s*(km|m)$/i);

  if (match) {
    return { value: match[1]!, unit: match[2]! };
  }

  return { value: hero, unit: null };
}

/** Deterministic pseudo-random values in [0, 1) seeded from a record. */
function seededValues(seed: string, count: number): number[] {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const values: number[] = [];

  for (let index = 0; index < count; index += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    values.push((Math.abs(hash) % 1000) / 1000);
  }

  return values;
}

/** Decorative upward-trending bars (progress motif) for time-based records. */
function RecordSparkbars({ seed }: { seed: string }) {
  const noise = seededValues(seed, 7);
  const bars = noise.map((value, index) => {
    const base = 0.28 + (index / (noise.length - 1)) * 0.62;
    return Math.min(1, Math.max(0.14, base * 0.72 + value * 0.28));
  });

  const barWidth = 4;
  const gap = 2.6;

  return (
    <svg
      className="training-record-spark is-bars"
      viewBox="0 0 46 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((value, index) => {
        const height = value * 26;
        return (
          <rect
            key={index}
            x={index * (barWidth + gap)}
            y={28 - height}
            width={barWidth}
            height={height}
            rx={1.3}
          />
        );
      })}
    </svg>
  );
}

/** Decorative area sparkline for distance / elevation records. */
function RecordSparkarea({ seed }: { seed: string }) {
  const points = seededValues(seed, 12);
  const width = 60;
  const height = 28;
  const step = width / (points.length - 1);

  const line = points
    .map((value, index) => {
      const x = (index * step).toFixed(1);
      const y = (height - (0.18 + value * 0.72) * height).toFixed(1);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <svg
      className="training-record-spark is-area"
      viewBox="0 0 60 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="training-record-spark-fill" d={`${line} L ${width} ${height} L 0 ${height} Z`} />
      <path className="training-record-spark-line" d={line} />
    </svg>
  );
}

function RecordEmptyGraphic() {
  return (
    <svg
      className="training-record-empty-graphic"
      viewBox="0 0 60 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 28 L13 13 L21 20 L33 6 L43 17 L51 11 L60 28 Z" />
    </svg>
  );
}

const PR_ASSET_BASE = "./assets/training-hub/PR";

function LaurelBadge() {
  return (
    <img
      className="training-record-pr"
      src={`${PR_ASSET_BASE}/pr-logo_no_bg.png`}
      alt="Personal record"
    />
  );
}

export function PersonalRecordsPanel({ dashboard }: PersonalRecordsPanelProps) {
  const groups = dashboard?.personalRecords ?? [];
  const [activeGroupType, setActiveGroupType] = useState<number>(1);

  useEffect(() => {
    if (groups.length === 0) {
      return;
    }

    if (!groups.some((group) => group.type === activeGroupType)) {
      setActiveGroupType(groups.find((group) => group.type === 1)?.type ?? groups[0]!.type);
    }
  }, [activeGroupType, groups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.type === activeGroupType) ?? groups[0],
    [activeGroupType, groups]
  );

  const records = (activeGroup?.records ?? []).filter(isPersonalRecordVisible);
  const hasRecords = records.length > 0;

  return (
    <section className="panel training-records-panel">
      <div className="training-records-banner">
        <span className="training-records-embers" aria-hidden="true" />
        <img
          className="training-records-banner-wheat is-left"
          src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
          alt=""
          aria-hidden="true"
        />
        <div className="training-records-banner-text">
          <p className="training-records-banner-headline">Personal Records</p>
        </div>
        <img
          className="training-records-banner-wheat is-right"
          src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
          alt=""
          aria-hidden="true"
        />
      </div>

      {groups.length > 0 ? (
        <div className="training-records-tabs" role="tablist" aria-label="Record period">
          {groups.map((group) => (
            <button
              key={group.type}
              type="button"
              role="tab"
              aria-selected={group.type === activeGroup?.type}
              className={
                group.type === activeGroup?.type
                  ? "training-records-tab active"
                  : "training-records-tab"
              }
              onClick={() => setActiveGroupType(group.type)}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}

      {hasRecords ? (
        <div className="training-records-grid">
          {records.map((record, index) => (
            <RecordCard
              key={`${record.type}-${record.happenDay ?? index}`}
              record={record}
            />
          ))}
        </div>
      ) : (
        <div className="training-empty-state">
          <p>No personal records loaded from your COROS dashboard yet.</p>
        </div>
      )}
    </section>
  );
}

function RecordCard({ record }: { record: TrainingHubPersonalRecord }) {
  const Icon = recordIcon(record.type);
  const hero = formatPersonalRecordHero(record);
  const meta = formatPersonalRecordMeta(record);
  const populated = isPersonalRecordPopulated(record);
  const { value, unit } = splitHero(hero);
  const seed = `${record.type}-${record.happenDay ?? ""}-${hero}`;
  const isDistanceLike =
    record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN;

  return (
    <article
      className={
        populated ? "training-record-card" : "training-record-card is-empty"
      }
    >
      <div className="training-record-card-top">
        <span className="training-record-card-lead">
          <span className="training-record-card-icon" aria-hidden="true">
            <Icon size={16} strokeWidth={2.2} />
          </span>
          <span className="training-record-card-label">{record.label}</span>
        </span>
        {populated ? <LaurelBadge /> : null}
      </div>

      <p className="training-record-card-hero">
        {value}
        {unit ? <span className="training-record-card-unit"> {unit}</span> : null}
      </p>
      {meta ? <p className="training-record-card-meta">{meta}</p> : null}

      <div className="training-record-card-foot">
        <span className="training-record-card-date">
          {populated ? formatRecordDateShort(record.happenDay) : "—"}
        </span>
        {populated ? (
          isDistanceLike ? (
            <RecordSparkarea seed={seed} />
          ) : (
            <RecordSparkbars seed={seed} />
          )
        ) : (
          <RecordEmptyGraphic />
        )}
      </div>
    </article>
  );
}
