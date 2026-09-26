import { Mountain, Route } from "lucide-react";
import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
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
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  defineSelectionPreference,
  useSelectionPreference
} from "../../preferences/selectionPreferences";
import {
  PR_ASSET_BASE,
  RecordBurst,
  RollingText,
  recordLabel,
  recordSignature,
  splitHero,
  type RecordCelebration
} from "./PersonalRecordCelebration";
import "../personalRecords.css";

interface PersonalRecordsPanelProps {
  dashboard: TrainingHubDashboard | null;
  /** Set while a record's on-card celebration plays (after the full-screen moment). */
  celebration?: RecordCelebration | null;
  /** Replays the full-screen celebration for a record. */
  onCelebrate?: (record: TrainingHubPersonalRecord) => void;
}

const RECORD_TYPE_LONGEST_RUN = 101;
const RECORD_TYPE_ELEVATION_GAIN = 103;
const RECENT_RECORD_DAYS = 30;

const PERSONAL_RECORD_GROUP_PREFERENCE = defineSelectionPreference<number>({
  key: "training.personalRecordGroup",
  defaultValue: 1,
  validate: (value): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0
});

function isEnduranceRecord(record: TrainingHubPersonalRecord): boolean {
  return record.type === RECORD_TYPE_LONGEST_RUN || record.type === RECORD_TYPE_ELEVATION_GAIN;
}

/** Split "6:40 /km" into the pace and its unit. */
function splitPace(meta: string): { value: string; unit: string | null } {
  const match = meta.match(/^(\S+)\s*(\/\s*\S+)$/);
  return match ? { value: match[1]!, unit: match[2]!.replace(/\s+/g, "") } : { value: meta, unit: null };
}

function happenDayTime(happenDay?: string): number | null {
  if (!happenDay || !/^\d{8}$/.test(happenDay)) {
    return null;
  }

  return new Date(
    Number(happenDay.slice(0, 4)),
    Number(happenDay.slice(4, 6)) - 1,
    Number(happenDay.slice(6, 8))
  ).getTime();
}

/** Compact engraving for the card watermark: "Half Marathon" → "HM". */
function recordMark(label: string): string {
  if (/^half/i.test(label)) {
    return "HM";
  }

  if (/^marathon/i.test(label)) {
    return "M";
  }

  return label.replace(/\s+/g, "").toUpperCase();
}

function Laurels({ children, celebrating }: { children: ReactNode; celebrating: boolean }) {
  return (
    <div className={celebrating ? "pr-emblem is-celebrating" : "pr-emblem"} aria-hidden="true">
      <img className="pr-emblem-wheat is-left" src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`} alt="" />
      <span className="pr-emblem-medal">{children}</span>
      <img className="pr-emblem-wheat is-right" src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`} alt="" />
    </div>
  );
}

export function PersonalRecordsPanel({
  dashboard,
  celebration = null,
  onCelebrate
}: PersonalRecordsPanelProps) {
  const { unitSystem } = useUnitSystem();
  const groups = dashboard?.personalRecords ?? [];
  const [activeGroupType, setActiveGroupType] = useSelectionPreference(
    PERSONAL_RECORD_GROUP_PREFERENCE
  );

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
  const raceRecords = records.filter((record) => !isEnduranceRecord(record));
  const enduranceRecords = records.filter(isEnduranceRecord);
  const populated = records.filter(isPersonalRecordPopulated);

  const newest = populated.reduce<TrainingHubPersonalRecord | null>((best, record) => {
    const time = happenDayTime(record.happenDay);
    const bestTime = best ? happenDayTime(best.happenDay) : null;
    return time !== null && (bestTime === null || time > bestTime) ? record : best;
  }, null);
  const newestTime = newest ? happenDayTime(newest.happenDay) : null;
  const newestIsRecent =
    newestTime !== null && Date.now() - newestTime <= RECENT_RECORD_DAYS * 86_400_000;

  const celebrated = celebration
    ? groups
        .flatMap((group) => group.records)
        .find((record) => recordSignature(record) === celebration.signature) ?? null
    : null;
  const celebrate = (record: TrainingHubPersonalRecord) => onCelebrate?.(record);

  return (
    <section className="panel training-records-panel">
      <header className="pr-head">
        <span className="pr-head-light" aria-hidden="true" />
        <span className="pr-head-embers" aria-hidden="true" />
        <div className="pr-head-title">
          <Laurels celebrating={celebrated !== null}>{populated.length}</Laurels>
          <div className="pr-head-copy">
            <p className="pr-eyebrow">Hall of bests</p>
            <h2 className="pr-title">Personal Records</h2>
            {celebrated ? (
              <p className="pr-announce" key={celebration?.nonce} role="status">
                <span className="pr-announce-spark" aria-hidden="true" />
                New personal record: <strong>{recordLabel(celebrated, unitSystem)}</strong> in{" "}
                <strong>{formatPersonalRecordHero(celebrated, unitSystem)}</strong>
              </p>
            ) : (
              <p className="pr-summary">
                {populated.length} of {records.length} set
                {newest ? (
                  <>
                    <span className="pr-summary-sep" aria-hidden="true" />
                    Latest: <strong>{recordLabel(newest, unitSystem)}</strong> on{" "}
                    {formatRecordDateShort(newest.happenDay)}
                  </>
                ) : null}
              </p>
            )}
          </div>
        </div>

        {groups.length > 0 ? (
          <div className="pr-periods" role="tablist" aria-label="Record period">
            {groups.map((group) => (
              <button
                key={group.type}
                type="button"
                role="tab"
                aria-selected={group.type === activeGroup?.type}
                className={group.type === activeGroup?.type ? "pr-period active" : "pr-period"}
                onClick={() => setActiveGroupType(group.type)}
              >
                {group.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {records.length > 0 ? (
        <div className="pr-body" key={activeGroup?.type}>
          {raceRecords.length > 0 ? (
            <div className="pr-section">
              <p className="pr-section-label">Race distances</p>
              <div
                className="pr-race-grid"
                style={
                  {
                    "--pr-race-cols": raceRecords.length,
                    "--pr-race-cols-mid":
                      raceRecords.length <= 3 ? raceRecords.length : Math.ceil(raceRecords.length / 2)
                  } as CSSProperties
                }
              >
                {raceRecords.map((record, index) => (
                  <RaceRecordCard
                    key={`${record.type}-${record.happenDay ?? index}`}
                    record={record}
                    celebrationNonce={
                      celebration?.signature === recordSignature(record) ? celebration.nonce : null
                    }
                    onCelebrate={() => celebrate(record)}
                    index={index}
                    isLatest={newestIsRecent && record === newest}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {enduranceRecords.length > 0 ? (
            <div className="pr-section">
              <p className="pr-section-label">Endurance</p>
              <div className="pr-endurance-grid">
                {enduranceRecords.map((record, index) => (
                  <EnduranceRecordCard
                    key={`${record.type}-${record.happenDay ?? index}`}
                    record={record}
                    celebrationNonce={
                      celebration?.signature === recordSignature(record) ? celebration.nonce : null
                    }
                    onCelebrate={() => celebrate(record)}
                    index={raceRecords.length + index}
                    isLatest={newestIsRecent && record === newest}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="training-empty-state">
          <p>No personal records loaded from your COROS dashboard yet.</p>
        </div>
      )}
    </section>
  );
}

interface RecordCardProps {
  record: TrainingHubPersonalRecord;
  index: number;
  isLatest: boolean;
  /** Set while this record's celebration plays; changes restart the animation. */
  celebrationNonce: number | null;
  onCelebrate: () => void;
}

function LatestChip({ onCelebrate }: { onCelebrate: () => void }) {
  return (
    <button
      type="button"
      className="pr-latest-chip"
      onClick={onCelebrate}
      title="Celebrate again"
    >
      <img src={`${PR_ASSET_BASE}/pr-logo_no_bg.png`} alt="" aria-hidden="true" />
      New PR
    </button>
  );
}

function cardClass(
  base: string,
  populated: boolean,
  isLatest: boolean,
  celebrating: boolean
): string {
  return [
    base,
    populated ? null : "is-empty",
    isLatest ? "is-latest" : null,
    celebrating ? "is-celebrating" : null
  ]
    .filter(Boolean)
    .join(" ");
}

function CardSlot({
  celebrationNonce,
  children
}: {
  celebrationNonce: number | null;
  children: ReactNode;
}) {
  return (
    <div className={celebrationNonce !== null ? "pr-card-slot is-celebrating" : "pr-card-slot"}>
      {children}
      {celebrationNonce !== null ? <RecordBurst key={`burst-${celebrationNonce}`} /> : null}
    </div>
  );
}

function RaceRecordCard({ record, index, isLatest, celebrationNonce, onCelebrate }: RecordCardProps) {
  const { unitSystem } = useUnitSystem();
  const populated = isPersonalRecordPopulated(record);
  const label = recordLabel(record, unitSystem);
  const meta = formatPersonalRecordMeta(record, unitSystem);
  const pace = meta ? splitPace(meta) : null;
  const celebrating = celebrationNonce !== null;

  return (
    <CardSlot celebrationNonce={celebrationNonce}>
      <article
        key={celebrationNonce === null ? "card" : `card-${celebrationNonce}`}
        className={cardClass("pr-card", populated, isLatest, celebrating)}
        style={{ "--pr-index": index } as CSSProperties}
      >
        <span className="pr-card-mark" aria-hidden="true">
          {recordMark(label)}
        </span>

        <div className="pr-card-top">
          <span className="pr-card-label">{label}</span>
          {isLatest ? <LatestChip onCelebrate={onCelebrate} /> : null}
        </div>

        {populated ? (
          <>
            <p className="pr-card-hero">
              <RollingText text={formatPersonalRecordHero(record, unitSystem)} rolling={celebrating} />
            </p>
            <div className="pr-card-foot">
              {pace ? (
                <span className="pr-card-pace">
                  {pace.value}
                  {pace.unit ? <small>{pace.unit}</small> : null}
                </span>
              ) : null}
              <span className="pr-card-date">{formatRecordDateShort(record.happenDay)}</span>
            </div>
          </>
        ) : (
          <>
            <p className="pr-card-hero is-empty">Not yet set</p>
            <div className="pr-card-foot">
              <span className="pr-card-date">Your first {label.toLowerCase()} lands here</span>
            </div>
          </>
        )}
      </article>
    </CardSlot>
  );
}

function EnduranceRecordCard({
  record,
  index,
  isLatest,
  celebrationNonce,
  onCelebrate
}: RecordCardProps) {
  const { unitSystem } = useUnitSystem();
  const populated = isPersonalRecordPopulated(record);
  const Icon = record.type === RECORD_TYPE_ELEVATION_GAIN ? Mountain : Route;
  const { value, unit } = splitHero(formatPersonalRecordHero(record, unitSystem));
  const meta = formatPersonalRecordMeta(record, unitSystem);
  const celebrating = celebrationNonce !== null;

  return (
    <CardSlot celebrationNonce={celebrationNonce}>
      <article
        key={celebrationNonce === null ? "card" : `card-${celebrationNonce}`}
        className={cardClass("pr-card pr-card-wide", populated, isLatest, celebrating)}
        style={{ "--pr-index": index } as CSSProperties}
      >
        <span className="pr-card-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={1.8} />
        </span>

        <div className="pr-card-wide-body">
          <div className="pr-card-top">
            <span className="pr-card-label">{recordLabel(record, unitSystem)}</span>
            {isLatest ? <LatestChip onCelebrate={onCelebrate} /> : null}
          </div>
          {populated ? (
            <p className="pr-card-hero">
              <RollingText text={value} rolling={celebrating} />
              {unit ? <span className="pr-card-unit">{unit}</span> : null}
            </p>
          ) : (
            <p className="pr-card-hero is-empty">Not yet set</p>
          )}
        </div>

        <div className="pr-card-wide-meta">
          {populated && meta ? <span className="pr-card-pace">{meta}</span> : null}
          <span className="pr-card-date">
            {populated ? formatRecordDateShort(record.happenDay) : "—"}
          </span>
        </div>
      </article>
    </CardSlot>
  );
}
