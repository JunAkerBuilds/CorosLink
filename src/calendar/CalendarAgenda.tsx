import { getLocale, useLanguage, t } from "../i18n/training";
import { Check, CalendarPlus, Moon, Plus } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type {
  TrainingHubActivity,
  TrainingHubScheduledWorkoutEntry,
  UnitSystem
} from "../../electron/types";
import { useUnitSystem } from "../units/UnitSystemProvider";
import {
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import { sportColorCategory } from "../training/sportColors";
import { resolveSportName } from "../training/sportTypes";
import { activityFamily, pairSportFamily } from "./calendarFilters";
import {
  scheduledWorkoutKey,
  type CalendarDay,
  type CalendarWeek,
  type PlannedActualPair
} from "./calendarTypes";
import { readCalendarContextTarget, type CalendarContextTarget } from "./CalendarGrid";
import { dateFromKey, weekRangeLabel } from "./dateUtils";
import { activityStatsLine, completionTone, JournalMark } from "./DayCell";
import { journalEntryForActivity, journalEntryForPair } from "./journalRefs";
import { WEEK_SPORT_FAMILY_META, type WeekSportFamily } from "./weekSportBreakdown";
import { WEEK_SPORT_ICONS } from "./WeekStatsCell";
import "./calendarAgenda.css";

interface CalendarAgendaProps {
  weeks: CalendarWeek[];
  loading: boolean;
  busy: boolean;
  selectionMode: boolean;
  selectedWorkoutKeys: ReadonlySet<string>;
  highlightedWorkoutKey: string | null;
  /** Entries the filters hide among the listed days. */
  hiddenCount: number;
  onShowEverything: () => void;
  onSelectScheduled: (day: CalendarDay, entry: TrainingHubScheduledWorkoutEntry) => void;
  onSelectActivity: (day: CalendarDay, activity: TrainingHubActivity) => void;
  onToggleScheduled: (entry: TrainingHubScheduledWorkoutEntry) => void;
  onAdd: (dateKey: string) => void;
  onContextMenu: (target: CalendarContextTarget) => void;
}

type AgendaEntry =
  | { kind: "pair"; pair: PlannedActualPair; minutes: number }
  | { kind: "activity"; activity: TrainingHubActivity; minutes: number };

// Same hues as the grid's planned-chip categories.
const CATEGORY_COLORS: Record<string, string> = {
  Easy: "#5eb9f0",
  Long: "#a78bfa",
  Intervals: "#f0785e",
  Speed: "var(--accent-gold)",
  Race: "#ef5da8"
};

function minutesOfDay(timestamp: number | undefined): number | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function plannedMinutes(entry: TrainingHubScheduledWorkoutEntry): number | undefined {
  const timing = entry.calendarEvent?.timing;
  return timing?.mode === "timed" ? parseClock(timing.startTime) : undefined;
}

/** Recorded activities by start time; untimed plans first, in COROS's order. */
function agendaEntries(day: CalendarDay): AgendaEntry[] {
  const entries: AgendaEntry[] = [
    ...day.pairs.map((pair) => ({
      kind: "pair" as const,
      pair,
      minutes: minutesOfDay(pair.activity?.startTime) ?? plannedMinutes(pair.scheduled) ?? -1
    })),
    ...day.unplannedActivities.map((activity) => ({
      kind: "activity" as const,
      activity,
      minutes: minutesOfDay(activity.startTime) ?? -1
    }))
  ];
  return entries.sort((left, right) => left.minutes - right.minutes);
}

const clockDate = (minutes: number) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
const clockFormat = () => new Intl.DateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit" });

function clockLabel(minutes: number): string {
  return clockFormat().format(clockDate(minutes));
}

function parseClock(value: string): number | undefined {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours! * 60 + minutes! : undefined;
}

function entryColor(family: WeekSportFamily, activity?: TrainingHubActivity, plannedName?: string): string {
  if (activity) return `var(--sport-${sportColorCategory(activity.sportType)})`;
  if (family === "run") return CATEGORY_COLORS[inferUpcomingWorkoutCategory(plannedName ?? "")] ?? "var(--accent)";
  return `var(--sport-${WEEK_SPORT_FAMILY_META[family].color})`;
}

function plannedKindLabel(entry: TrainingHubScheduledWorkoutEntry, family: WeekSportFamily): string {
  return family === "run" ? t(inferUpcomingWorkoutCategory(entry.name)) : t(WEEK_SPORT_FAMILY_META[family].label);
}

function activityName(activity: TrainingHubActivity): string {
  return activity.name ?? (activity.sportName == null ? undefined : t(String(activity.sportName))) ?? t("Activity");
}

function plannedMeta(entry: TrainingHubScheduledWorkoutEntry, family: WeekSportFamily, unitSystem: UnitSystem): string {
  const volume = formatUpcomingWorkoutVolumeDisplay(entry.volume, unitSystem);
  return [
    plannedKindLabel(entry, family),
    volume !== "--" ? volume : undefined,
    entry.trainingLoad !== undefined ? `${Math.round(entry.trainingLoad)} ${t("TL")}` : undefined
  ]
    .filter(Boolean)
    .join(" · ");
}

function activityMeta(activity: TrainingHubActivity, unitSystem: UnitSystem, plannedLoad?: number): string {
  const family = activityFamily(activity);
  const sport = resolveSportName(activity);
  const load =
    activity.trainingLoad !== undefined
      ? plannedLoad !== undefined
        ? t("{{actual}} / {{planned}} TL", { actual: String(Math.round(activity.trainingLoad)), planned: String(Math.round(plannedLoad)) })
        : `${Math.round(activity.trainingLoad)} ${t("TL")}`
      : undefined;
  return [
    sport ? t(sport) : t(WEEK_SPORT_FAMILY_META[family].label),
    activityStatsLine(activity, unitSystem) || undefined,
    load
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Bring today's group to the top of the list, under its sticky week heading. */
export function scrollAgendaToToday(
  scroller = document.querySelector<HTMLElement>(".calendar-agenda-scroll")
): boolean {
  const today = scroller?.querySelector<HTMLElement>(".calendar-agenda-day.is-today");
  if (!scroller || !today) return false;
  const weekHead = today.closest(".calendar-agenda-week")?.querySelector<HTMLElement>(".calendar-agenda-week-head");
  const offset = today.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, offset - (weekHead?.offsetHeight ?? 0));
  return true;
}

/** The saved calendar slot in the same clock as recorded start times ("6:30 – 7:30 AM"). */
function plannedTime(entry: TrainingHubScheduledWorkoutEntry): string | undefined {
  const timing = entry.calendarEvent?.timing;
  if (!timing) return undefined;
  if (timing.mode === "all-day") return t("All day");
  const start = parseClock(timing.startTime);
  const end = parseClock(timing.endTime);
  if (start === undefined || end === undefined) return `${timing.startTime}–${timing.endTime}`;
  const endDate = clockDate(end);
  if (end <= start) endDate.setDate(endDate.getDate() + 1);
  return `${clockFormat().formatRange(clockDate(start), endDate)}${end <= start ? t(" (+1 day)") : ""}`;
}

export function CalendarAgenda({
  weeks,
  loading,
  busy,
  selectionMode,
  selectedWorkoutKeys,
  highlightedWorkoutKey,
  hiddenCount,
  onShowEverything,
  onSelectScheduled,
  onSelectActivity,
  onToggleScheduled,
  onAdd,
  onContextMenu
}: CalendarAgendaProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listedWeeks = weeks
    .map((week) => ({
      week,
      days: week.days.filter(
        (day) => day.inMonth && (day.isToday || day.pairs.length > 0 || day.unplannedActivities.length > 0)
      )
    }))
    .filter(({ days }) => days.length > 0);
  const monthKey = weeks.find((week) => week.days.some((day) => day.inMonth))?.days.find((day) => day.inMonth)?.dateKey.slice(0, 6);
  const scrolledMonth = useRef<string | null>(null);

  // Open on today in the current month, once per month shown.
  useLayoutEffect(() => {
    if (loading || !monthKey || scrolledMonth.current === monthKey) return;
    scrolledMonth.current = monthKey;
    const scroller = scrollRef.current;
    if (scroller && !scrollAgendaToToday(scroller)) scroller.scrollTop = 0;
  }, [loading, monthKey]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The grid's arrow keys walk days; in a list they walk entries.
    event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
    const entries = [...(scrollRef.current?.querySelectorAll<HTMLButtonElement>(".calendar-agenda-entry:not(:disabled)") ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = entries[index < 0 ? 0 : index + (event.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
  };

  const renderPair = (day: CalendarDay, pair: PlannedActualPair, minutes: number) => {
    const { scheduled, activity } = pair;
    const key = scheduledWorkoutKey(scheduled);
    const family = pairSportFamily(pair);
    const Icon = WEEK_SPORT_ICONS[family];
    const selectable = selectionMode && !day.isPast;
    const selected = selectedWorkoutKeys.has(key);
    const missed = !activity && day.isPast;
    const title = activity ? activityName(activity) : scheduled.name;
    const plannedName = activity && activity.name && activity.name.trim() !== scheduled.name.trim() ? scheduled.name : undefined;
    const time = activity ? (minutes >= 0 ? clockLabel(minutes) : undefined) : plannedTime(scheduled);
    const status = activity
      ? pair.completionPct !== undefined
        ? { tone: completionTone(pair.completionPct) || "is-complete", label: t("{{value1}}% of plan", { value1: String(Math.min(pair.completionPct, 999)) }) }
        : { tone: "is-complete", label: t("Completed") }
      : missed
        ? { tone: "is-missed", label: t("Missed") }
        : { tone: "is-planned", label: t("Planned") };
    return (
      <button
        type="button"
        className={[
          "calendar-agenda-entry",
          activity ? "is-done" : "is-plan",
          missed && "is-missed",
          selectable && "is-selection-enabled",
          selected && "is-selected",
          highlightedWorkoutKey === key && "is-nav-target",
          selectionMode && !selectable && "is-selection-unavailable"
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ "--entry-accent": entryColor(family, activity, scheduled.name) } as CSSProperties}
        data-calendar-workout={key}
        data-calendar-activity={activity?.activityId}
        disabled={selectionMode && !selectable}
        aria-pressed={selectable ? selected : undefined}
        onClick={() => {
          if (selectable) onToggleScheduled(scheduled);
          else if (activity) onSelectActivity(day, activity);
          else onSelectScheduled(day, scheduled);
        }}
      >
        {selectable ? (
          <span className="calendar-agenda-selector" aria-hidden="true">
            {selected ? <Check size={12} strokeWidth={3} /> : null}
          </span>
        ) : null}
        <span className="calendar-agenda-glyph" aria-hidden="true">
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <span className="calendar-agenda-main">
          <span className="calendar-agenda-title">
            <span className="calendar-agenda-name">{title}</span>
            <JournalMark entry={journalEntryForPair(day.journal, pair)} />
          </span>
          <span className="calendar-agenda-meta">
            {activity ? activityMeta(activity, unitSystem, scheduled.trainingLoad) : plannedMeta(scheduled, family, unitSystem)}
          </span>
          {plannedName ? (
            <span className="calendar-agenda-plan">{t("Plan: {{value1}}", { value1: plannedName })}</span>
          ) : null}
        </span>
        <span className="calendar-agenda-aside">
          {/* The outlined glyph already marks a plan; say it only to screen readers. */}
          <span className={status.tone === "is-planned" ? "sr-only" : `calendar-agenda-status ${status.tone}`}>{status.label}</span>
          {time ? <span className="calendar-agenda-time">{time}</span> : null}
        </span>
      </button>
    );
  };

  const renderActivity = (day: CalendarDay, activity: TrainingHubActivity, minutes: number) => {
    const family = activityFamily(activity);
    const Icon = WEEK_SPORT_ICONS[family];
    return (
      <button
        type="button"
        className={["calendar-agenda-entry", "is-done", selectionMode && "is-selection-unavailable"].filter(Boolean).join(" ")}
        style={{ "--entry-accent": entryColor(family, activity) } as CSSProperties}
        data-calendar-activity={activity.activityId}
        disabled={selectionMode}
        onClick={() => onSelectActivity(day, activity)}
      >
        <span className="calendar-agenda-glyph" aria-hidden="true">
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <span className="calendar-agenda-main">
          <span className="calendar-agenda-title">
            <span className="calendar-agenda-name">{activityName(activity)}</span>
            <JournalMark entry={journalEntryForActivity(day.journal, activity.activityId)} />
          </span>
          <span className="calendar-agenda-meta">{activityMeta(activity, unitSystem)}</span>
        </span>
        <span className="calendar-agenda-aside">
          <span className="calendar-agenda-status is-recorded">
            <Check size={11} strokeWidth={2.8} aria-hidden="true" />
            {t("Completed")}
          </span>
          {minutes >= 0 ? <span className="calendar-agenda-time">{clockLabel(minutes)}</span> : null}
        </span>
      </button>
    );
  };

  const listedCount = listedWeeks.reduce(
    (total, { days }) => total + days.reduce((sum, day) => sum + day.pairs.length + day.unplannedActivities.length, 0),
    0
  );

  if (listedCount === 0) {
    // Nothing to list: say why (still loading, all filtered out, or an empty month).
    return (
      <div className="calendar-agenda" aria-busy={loading || busy}>
        {loading ? (
          <div className="calendar-agenda-skeleton" aria-label={t("Loading…")}>
            {[0, 1, 2].map((row) => <span key={row} />)}
          </div>
        ) : (
          <div className="calendar-agenda-empty">
            <span className="calendar-agenda-empty-icon" aria-hidden="true">
              <CalendarPlus size={22} />
            </span>
            {hiddenCount > 0 ? (
              <>
                <h3>{t("Everything this month is filtered out")}</h3>
                <p>{hiddenCount === 1 ? t("1 entry is hidden by your filters.") : t("{{count}} entries are hidden by your filters.", { count: String(hiddenCount) })}</p>
                <button type="button" className="ghost-button" onClick={onShowEverything}>
                  {t("Show everything")}
                </button>
              </>
            ) : (
              <>
                <h3>{t("Nothing this month")}</h3>
                <p>{t("Add a workout from the Month or Week view, or schedule one from the Workout Library.")}</p>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="calendar-agenda" aria-busy={loading || busy}>
      <div
        ref={scrollRef}
        className="calendar-agenda-scroll"
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => {
          const target = readCalendarContextTarget(event);
          if (target) onContextMenu(target);
        }}
      >
        {listedWeeks.map(({ week, days }) => {
          const { actualLoad, plannedLoad } = week.stats;
          return (
            <section key={week.key} className="calendar-agenda-week" aria-label={weekRangeLabel(week.days.map((day) => day.dateKey))}>
              <header className="calendar-agenda-week-head">
                <h3>{weekRangeLabel(week.days.map((day) => day.dateKey))}</h3>
                {actualLoad > 0 || plannedLoad > 0 ? (
                  <span className="calendar-agenda-week-load">
                    {plannedLoad > 0
                      ? t("{{actual}} / {{planned}} TL", { actual: String(actualLoad), planned: String(plannedLoad) })
                      : `${actualLoad} ${t("TL")}`}
                  </span>
                ) : null}
              </header>
              <ol className="calendar-agenda-days">
                {days.map((day) => {
                  const entries = agendaEntries(day);
                  const date = dateFromKey(day.dateKey);
                  return (
                    <li
                      key={day.dateKey}
                      className={["calendar-agenda-day", day.isToday && "is-today", day.isPast && "is-past"].filter(Boolean).join(" ")}
                      data-calendar-day={day.dateKey}
                      tabIndex={-1}
                    >
                      <h4 className="calendar-agenda-date">
                        <span className="sr-only">
                          {new Intl.DateTimeFormat(getLocale(), { weekday: "long", month: "long", day: "numeric" }).format(date)}
                          {day.isToday ? `, ${t("Today")}` : ""}
                        </span>
                        <span className="calendar-agenda-weekday" aria-hidden="true">
                          {day.isToday ? t("Today", undefined, "calendarDay") : new Intl.DateTimeFormat(getLocale(), { weekday: "short" }).format(date)}
                        </span>
                        <span className="calendar-agenda-daynum" aria-hidden="true">
                          {date.getDate()}
                        </span>
                      </h4>
                      <ul className="calendar-agenda-entries">
                        {entries.map((entry) => (
                          <li key={entry.kind === "pair" ? `pair-${scheduledWorkoutKey(entry.pair.scheduled)}` : `activity-${entry.activity.activityId}`}>
                            {entry.kind === "pair"
                              ? renderPair(day, entry.pair, entry.minutes)
                              : renderActivity(day, entry.activity, entry.minutes)}
                          </li>
                        ))}
                        {entries.length === 0 ? (
                          <li className="calendar-agenda-rest">
                            <Moon size={15} aria-hidden="true" />
                            <span>{day.scheduled.length > 0 || day.activities.length > 0 ? t("Nothing shown today with these filters") : t("Nothing planned today")}</span>
                            <button
                              type="button"
                              className="ghost-button calendar-agenda-add"
                              onClick={() => onAdd(day.dateKey)}
                              disabled={busy || selectionMode}
                            >
                              <Plus size={13} aria-hidden="true" />
                              {t("Add workout")}
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
        {hiddenCount > 0 ? (
          <p className="calendar-agenda-hidden-note">
            {hiddenCount === 1 ? t("1 entry is hidden by your filters.") : t("{{count}} entries are hidden by your filters.", { count: String(hiddenCount) })}{" "}
            <button type="button" className="calendar-agenda-link" onClick={onShowEverything}>
              {t("Show everything")}
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
