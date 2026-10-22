import { useLanguage, t } from "../i18n/training";
import { RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import {
  CALENDAR_ENTRY_KINDS,
  isCalendarFilterActive,
  type CalendarEntryKind,
  type CalendarFilter
} from "./calendarFilters";
import { WEEK_SPORT_FAMILY_META, type WeekSportFamily } from "./weekSportBreakdown";
import { WEEK_SPORT_ICONS } from "./WeekStatsCell";
import "./calendarFilters.css";

const KIND_LABELS: Record<CalendarEntryKind, string> = {
  all: "All",
  planned: "Planned",
  completed: "Completed"
};

const KIND_HINTS: Record<CalendarEntryKind, string> = {
  all: "Planned workouts and recorded activities",
  planned: "Workouts from your plan, done or not",
  completed: "Activities you recorded, planned or not"
};

interface CalendarFilterBarProps {
  id: string;
  filter: CalendarFilter;
  /** Sports among the shown days (for the chosen kind), with entry counts. */
  sports: Array<{ family: WeekSportFamily; count: number }>;
  hiddenCount: number;
  onChange: (filter: CalendarFilter) => void;
}

export function CalendarFilterBar({ id, filter, sports, hiddenCount, onChange }: CalendarFilterBarProps) {
  useLanguage();
  const hidden = new Set(filter.hiddenSports);
  // A hidden sport keeps its chip even in a range without it, so it can be shown again.
  const chips = [
    ...sports,
    ...filter.hiddenSports
      .filter((family) => !sports.some((sport) => sport.family === family))
      .map((family) => ({ family, count: 0 }))
  ];
  const active = isCalendarFilterActive(filter);

  const toggleSport = (family: WeekSportFamily) =>
    onChange({
      ...filter,
      hiddenSports: hidden.has(family)
        ? filter.hiddenSports.filter((sport) => sport !== family)
        : [...filter.hiddenSports, family]
    });

  return (
    <div id={id} className="calendar-filter-bar" role="region" aria-label={t("Calendar filters")}>
      <div className="calendar-filter-kinds" role="group" aria-label={t("Show")}>
        {CALENDAR_ENTRY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={filter.kind === kind ? "is-active" : undefined}
            aria-pressed={filter.kind === kind}
            title={t(KIND_HINTS[kind])}
            onClick={() => onChange({ ...filter, kind })}
          >
            {t(KIND_LABELS[kind], undefined, "calendarFilter")}
          </button>
        ))}
      </div>

      {chips.length > 0 ? (
        <div className="calendar-filter-sports" role="group" aria-label={t("Sports shown")}>
          {chips.map(({ family, count }) => {
            const meta = WEEK_SPORT_FAMILY_META[family];
            const Icon = WEEK_SPORT_ICONS[family];
            const shown = !hidden.has(family);
            const label = t(meta.label);
            return (
              <button
                key={family}
                type="button"
                className={`calendar-filter-sport${shown ? "" : " is-hidden"}`}
                style={{ "--filter-sport": `var(--sport-${meta.color})` } as CSSProperties}
                aria-pressed={shown}
                aria-label={t("{{sport}}, {{count}} in view", { sport: label, count: String(count) })}
                title={shown ? t("Hide {{sport}}", { sport: label }) : t("Show {{sport}}", { sport: label })}
                onClick={() => toggleSport(family)}
              >
                <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
                <span className="calendar-filter-sport-label">{label}</span>
                <span className="calendar-filter-count" aria-hidden="true">{count}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="calendar-filter-empty">{t("Nothing in view to filter by sport.")}</p>
      )}

      {active ? (
        <div className="calendar-filter-summary">
          <span aria-live="polite">
            {hiddenCount === 1 ? t("1 hidden") : t("{{count}} hidden", { count: String(hiddenCount) })}
          </span>
          <button
            type="button"
            className="ghost-button calendar-filter-reset"
            onClick={() => onChange({ kind: "all", hiddenSports: [] })}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t("Show everything")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
