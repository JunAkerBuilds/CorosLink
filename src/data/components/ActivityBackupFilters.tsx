import { t, useLanguage, getLocale } from "../../i18n/tools";
import {
  Bike,
  Dumbbell,
  Footprints,
  Layers,
  Medal,
  Mountain,
  MountainSnow,
  RotateCcw,
  Ruler,
  Sailboat,
  Shapes,
  Snowflake,
  Timer,
  WavesLadder,
  type LucideIcon
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ACTIVITY_BACKUP_SPORT_GROUPS } from "../../../electron/activityBackupFilters";
import type { ActivityBackupFilters as BackupFilters } from "../../../electron/types";
import {
  displayDistanceToMeters,
  distanceUnit,
  type UnitSystem
} from "../../units/units";

const SPORT_GROUP_ICONS: Record<string, LucideIcon> = {
  run: Footprints,
  bike: Bike,
  swim: WavesLadder,
  hike: Mountain,
  strength: Dumbbell,
  snow: Snowflake,
  water: Sailboat,
  climb: MountainSnow,
  multisport: Medal,
  other: Shapes
};

export type BackupDatePreset = "all" | "30" | "90" | "365" | "year" | "custom";

const DATE_PRESETS: { value: BackupDatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" }
];

export interface BackupFilterDraft {
  sportGroups: string[];
  datePreset: BackupDatePreset;
  customFrom: string;
  customTo: string;
  /** Display units (km or mi). */
  distanceMin: string;
  distanceMax: string;
  /** Minutes. */
  durationMin: string;
  durationMax: string;
}

export const EMPTY_BACKUP_FILTER_DRAFT: BackupFilterDraft = {
  sportGroups: [],
  datePreset: "all",
  customFrom: "",
  customTo: "",
  distanceMin: "",
  distanceMax: "",
  durationMin: "",
  durationMax: ""
};

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function presetStartDay(preset: BackupDatePreset, now = new Date()): string | undefined {
  if (preset === "year") {
    return `${now.getFullYear()}-01-01`;
  }
  const days = Number(preset);
  if (!Number.isFinite(days)) {
    return undefined;
  }
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return isoDay(start);
}

function parseBound(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export interface ResolvedBackupFilters {
  filters?: BackupFilters;
  error?: string;
  summary: string;
}

/** Turns the form draft into IPC filters plus a one-line human summary. */
export function resolveBackupFilters(
  draft: BackupFilterDraft,
  unitSystem: UnitSystem
): ResolvedBackupFilters {
  const unit = distanceUnit(unitSystem);
  const distanceMin = parseBound(draft.distanceMin);
  const distanceMax = parseBound(draft.distanceMax);
  const durationMin = parseBound(draft.durationMin);
  const durationMax = parseBound(draft.durationMax);

  if ([distanceMin, distanceMax, durationMin, durationMax].some(Number.isNaN)) {
    return { error: t("Lengths must be positive numbers."), summary: "" };
  }
  if (distanceMin !== undefined && distanceMax !== undefined && distanceMin > distanceMax) {
    return { error: t("Minimum distance is above the maximum."), summary: "" };
  }
  if (durationMin !== undefined && durationMax !== undefined && durationMin > durationMax) {
    return { error: t("Minimum duration is above the maximum."), summary: "" };
  }

  let startDay: string | undefined;
  let endDay: string | undefined;
  if (draft.datePreset === "custom") {
    startDay = draft.customFrom || undefined;
    endDay = draft.customTo || undefined;
    if (startDay && endDay && startDay > endDay) {
      return { error: t("The start date is after the end date."), summary: "" };
    }
  } else {
    startDay = presetStartDay(draft.datePreset);
  }

  const filters: BackupFilters = {
    sportGroups: draft.sportGroups.length ? draft.sportGroups : undefined,
    startDay,
    endDay,
    minDistanceMeters:
      distanceMin === undefined ? undefined : displayDistanceToMeters(distanceMin, unitSystem),
    maxDistanceMeters:
      distanceMax === undefined ? undefined : displayDistanceToMeters(distanceMax, unitSystem),
    minDurationSeconds: durationMin === undefined ? undefined : durationMin * 60,
    maxDurationSeconds: durationMax === undefined ? undefined : durationMax * 60
  };

  const parts: string[] = [];
  if (filters.sportGroups) {
    const labels = ACTIVITY_BACKUP_SPORT_GROUPS.filter((group) =>
      filters.sportGroups?.includes(group.id)
    ).map((group) => t(group.label));
    parts.push(labels.length > 2 ? t("{{p0}} activity types", { p0: labels.length }) : labels.join(", "));
  }
  if (draft.datePreset === "custom") {
    if (startDay || endDay) {
      parts.push(`${startDay ?? t("Start", undefined, "date")} → ${endDay ?? t("Today")}`);
    }
  } else if (draft.datePreset !== "all") {
    parts.push(t(DATE_PRESETS.find((preset) => preset.value === draft.datePreset)?.label ?? ""));
  }
  const range = (min: number | undefined, max: number | undefined, suffix: string) =>
    min !== undefined && max !== undefined
      ? `${min}–${max} ${suffix}`
      : min !== undefined
        ? `≥ ${min} ${suffix}`
        : max !== undefined
          ? `≤ ${max} ${suffix}`
          : null;
  const distanceText = range(distanceMin, distanceMax, unit);
  const durationText = range(durationMin, durationMax, t("min"));
  if (distanceText) parts.push(distanceText);
  if (durationText) parts.push(durationText);

  return parts.length
    ? { filters, summary: parts.join(" · ") }
    : { summary: t("All activities") };
}

interface ActivityBackupFiltersProps {
  draft: BackupFilterDraft;
  unitSystem: UnitSystem;
  disabled: boolean;
  error?: string;
  /** Per-family match counts from the preview; undefined while counting. */
  groupCounts?: Record<string, number>;
  onChange: Dispatch<SetStateAction<BackupFilterDraft>>;
}

export function ActivityBackupFilters({
  draft,
  unitSystem,
  disabled,
  error,
  groupCounts,
  onChange
}: ActivityBackupFiltersProps) {
  useLanguage();
  const isDirty =
    draft.sportGroups.length > 0 ||
    draft.datePreset !== "all" ||
    Boolean(draft.distanceMin || draft.distanceMax || draft.durationMin || draft.durationMax);
  const update = (patch: Partial<BackupFilterDraft>) =>
    onChange((current) => ({ ...current, ...patch }));

  function toggleGroup(id: string) {
    onChange((current) => {
      const next = current.sportGroups.includes(id)
        ? current.sportGroups.filter((group) => group !== id)
        : [...current.sportGroups, id];
      // Picking every family is the same as no filter; collapse back to "All".
      return {
        ...current,
        sportGroups: next.length === ACTIVITY_BACKUP_SPORT_GROUPS.length ? [] : next
      };
    });
  }

  const allCount = groupCounts
    ? Object.values(groupCounts).reduce((sum, count) => sum + count, 0)
    : undefined;

  return (
    <div className="backup-filters">
      <div className="backup-filters-heading">
        <span className="training-backup-formats-label">{t("Choose activities")}</span>
        {isDirty ? (
          <button
            type="button"
            className="backup-filters-reset"
            disabled={disabled}
            onClick={() => onChange(EMPTY_BACKUP_FILTER_DRAFT)}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {t("Reset")}</button>
        ) : null}
      </div>

      <section className="backup-filter-section" aria-labelledby="backup-filter-type">
        <h3 className="backup-filter-label" id="backup-filter-type">
          {t("Activity type")}</h3>
        <div className="backup-filter-chips" role="group" aria-labelledby="backup-filter-type">
          <SportChip
            label={t("All types")}
            icon={Layers}
            count={allCount}
            active={draft.sportGroups.length === 0}
            disabled={disabled}
            onClick={() => update({ sportGroups: [] })}
          />
          {ACTIVITY_BACKUP_SPORT_GROUPS.map((group) => (
            <SportChip
              key={group.id}
              label={t(group.label)}
              icon={SPORT_GROUP_ICONS[group.id] ?? Shapes}
              count={groupCounts ? groupCounts[group.id] ?? 0 : undefined}
              active={draft.sportGroups.includes(group.id)}
              disabled={disabled}
              onClick={() => toggleGroup(group.id)}
            />
          ))}
        </div>
      </section>

      <div className="backup-filter-split">
        <section className="backup-filter-section" aria-labelledby="backup-filter-time">
          <h3 className="backup-filter-label" id="backup-filter-time">
            {t("Time", undefined, "activityPeriod")}</h3>
          <div
            className="data-intervals-range backup-filter-presets"
            role="radiogroup"
            aria-labelledby="backup-filter-time"
          >
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={draft.datePreset === preset.value}
                className={draft.datePreset === preset.value ? "active" : undefined}
                disabled={disabled}
                onClick={() => update({ datePreset: preset.value })}
              >
                {t(preset.label)}
              </button>
            ))}
          </div>
          {draft.datePreset === "custom" ? (
            <div className="backup-filter-pair backup-filter-dates">
              <label className="backup-filter-input">
                <span>{t("From")}</span>
                <input
                  type="date"
                  value={draft.customFrom}
                  max={draft.customTo || undefined}
                  disabled={disabled}
                  onChange={(event) => update({ customFrom: event.target.value })}
                />
              </label>
              <span className="backup-filter-dash" aria-hidden="true">
                →
              </span>
              <label className="backup-filter-input">
                <span>{t("To")}</span>
                <input
                  type="date"
                  value={draft.customTo}
                  min={draft.customFrom || undefined}
                  disabled={disabled}
                  onChange={(event) => update({ customTo: event.target.value })}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="backup-filter-section" aria-labelledby="backup-filter-length">
          <h3 className="backup-filter-label" id="backup-filter-length">
            {t("Activity length")}</h3>
          <div className="backup-filter-lengths">
            <RangeInputs
              label={t("Distance")}
              icon={Ruler}
              unit={distanceUnit(unitSystem)}
              min={draft.distanceMin}
              max={draft.distanceMax}
              step="0.1"
              disabled={disabled}
              onChange={(distanceMin, distanceMax) => update({ distanceMin, distanceMax })}
            />
            <RangeInputs
              label={t("Duration")}
              icon={Timer}
              unit="min"
              min={draft.durationMin}
              max={draft.durationMax}
              step="1"
              disabled={disabled}
              onChange={(durationMin, durationMax) => update({ durationMin, durationMax })}
            />
          </div>
        </section>
      </div>

      {error ? (
        <p className="backup-filter-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SportChip({
  label,
  icon: Icon,
  count,
  active,
  disabled,
  onClick
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  useLanguage();
  const empty = count === 0 && !active;
  return (
    <button
      type="button"
      className={`backup-chip${active ? " active" : ""}${empty ? " is-empty" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="backup-chip-label">{label}</span>
      {count === undefined ? (
        <span className="backup-chip-count is-pending" aria-hidden="true" />
      ) : (
        <span className="backup-chip-count">{count.toLocaleString(getLocale())}</span>
      )}
    </button>
  );
}

function RangeInputs({
  label,
  icon: Icon,
  unit,
  min,
  max,
  step,
  disabled,
  onChange
}: {
  label: string;
  icon: LucideIcon;
  unit: string;
  min: string;
  max: string;
  step: string;
  disabled: boolean;
  onChange: (min: string, max: string) => void;
}) {
  useLanguage();
  return (
    <div className="backup-filter-range" role="group" aria-label={t("{{p0}} in {{p1}}", { p0: label, p1: unit })}>
      <span className="backup-filter-range-name">
        <Icon size={13} aria-hidden="true" />
        {label}
      </span>
      <div className="backup-filter-pair">
        <label className="backup-filter-input has-unit">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={step}
            placeholder={t("Min")}
            aria-label={t("Minimum {{p0}} ({{p1}})", { p0: label.toLowerCase(), p1: unit })}
            value={min}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value, max)}
          />
          <em>{unit}</em>
        </label>
        <span className="backup-filter-dash" aria-hidden="true">
          –
        </span>
        <label className="backup-filter-input has-unit">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={step}
            placeholder={t("Max")}
            aria-label={t("Maximum {{p0}} ({{p1}})", { p0: label.toLowerCase(), p1: unit })}
            value={max}
            disabled={disabled}
            onChange={(event) => onChange(min, event.target.value)}
          />
          <em>{unit}</em>
        </label>
      </div>
    </div>
  );
}
