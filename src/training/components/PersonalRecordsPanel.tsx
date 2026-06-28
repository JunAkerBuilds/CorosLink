import { Footprints, Gauge, Mountain, Route, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  TrainingHubDashboard,
  TrainingHubPersonalRecord
} from "../../../electron/types";
import {
  formatPersonalRecordHero,
  formatPersonalRecordMeta,
  formatRecordDateShort,
  isPersonalRecordVisible
} from "../formatters";

interface PersonalRecordsPanelProps {
  dashboard: TrainingHubDashboard | null;
}

function recordIcon(type: number) {
  if (type === 102) {
    return Gauge;
  }

  if (type === 101) {
    return Route;
  }

  if (type === 103) {
    return Mountain;
  }

  return Footprints;
}

export function PersonalRecordsPanel({ dashboard }: PersonalRecordsPanelProps) {
  const groups = dashboard?.personalRecords ?? [];
  const [activeGroupType, setActiveGroupType] = useState<number>(4);

  useEffect(() => {
    if (groups.length === 0) {
      return;
    }

    if (!groups.some((group) => group.type === activeGroupType)) {
      setActiveGroupType(groups.find((group) => group.type === 4)?.type ?? groups[0]!.type);
    }
  }, [activeGroupType, groups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.type === activeGroupType) ?? groups[0],
    [activeGroupType, groups]
  );

  const records = (activeGroup?.records ?? []).filter(isPersonalRecordVisible);

  return (
    <section className="panel training-records-panel">
      <header className="training-records-header">
        <div className="training-records-heading">
          <p className="eyebrow">Achievements</p>
          <h2>Personal Records</h2>
        </div>
        <Trophy size={22} aria-hidden="true" />
      </header>

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

      {records.length > 0 ? (
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

  return (
    <article className="training-record-card">
      <div className="training-record-card-top">
        <span className="training-record-card-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={2.2} />
        </span>
        <span className="training-record-card-label">{record.label}</span>
      </div>
      <p className="training-record-card-hero">{hero}</p>
      {meta ? <p className="training-record-card-meta">{meta}</p> : null}
      <p className="training-record-card-date">
        {formatRecordDateShort(record.happenDay)}
      </p>
    </article>
  );
}
