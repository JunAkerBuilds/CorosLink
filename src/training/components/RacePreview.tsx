import { formatDate, t, useLanguage } from "../../i18n/training";
import { Check, Flag, MapPin } from "lucide-react";
import { RACE_REGISTRATIONS, raceDistanceLabel } from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { formatDistanceValue, formatPaceValue } from "../../units/units";
import { formatRaceStartTime, formatRaceTime, parseRaceTime } from "../raceFormat";
import type { RaceDraft } from "../raceDraft";

function inputDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysFromToday(value: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((inputDay(value).getTime() - today.getTime()) / 86_400_000);
}

function relativeDay(days: number): string {
  if (days === 0) return t("today");
  if (days === 1) return t("tomorrow");
  if (days < 0) return t("passed");
  return t("in {{count}} days", { count: days });
}

const PRIORITY_LABELS = { A: "Goal race", B: "Important", C: "Tune-up" } as const;

/**
 * How the race will read in Up next while the athlete fills the form in, and
 * the dates it will put on their calendar.
 */
export function RacePreview({
  draft,
  distanceMeters,
  unitSystem
}: {
  draft: RaceDraft;
  distanceMeters: number | undefined;
  unitSystem: UnitSystem;
}) {
  useLanguage();
  const days = draft.date ? daysFromToday(draft.date) : null;
  const goal = draft.time.trim() ? parseRaceTime(draft.time) : undefined;
  const registration = RACE_REGISTRATIONS.find((option) => option.key === draft.registration);
  const distance = !draft.distanceKey
    ? undefined
    : draft.distanceKey === "other"
      ? distanceMeters ? formatDistanceValue(distanceMeters, unitSystem) : t("Other distance")
      : t(raceDistanceLabel(draft.distanceKey));

  // The same dates the Calendar shows: a deadline stops mattering once they're in.
  const entered = draft.registration === "registered" || draft.registration === "deferred";
  const dates = [
    draft.registrationDeadline && !entered
      ? { key: "deadline", label: t("Registration closes"), day: draft.registrationDeadline }
      : null,
    draft.bibPickupDay ? { key: "pickup", label: t("Bib pickup"), day: draft.bibPickupDay } : null,
    draft.date
      ? { key: "race", label: t("Race day"), day: draft.date, time: draft.startTime ? formatRaceStartTime(draft.startTime) : undefined }
      : null
  ]
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.day.localeCompare(b.day));

  return (
    <aside className="race-preview" data-distance={draft.distanceKey || "other"} aria-label={t("Preview")}>
      <p className="race-eyebrow">{t("Preview")}</p>

      <div className="race-preview-count">
        {days === null ? (
          <span className="is-prompt">{t("Pick a date to start the countdown")}</span>
        ) : days <= 0 ? (
          <strong className="is-word">{days === 0 ? t("Today") : t("Past")}</strong>
        ) : (
          <>
            <strong>{days}</strong>
            <span>{days === 1 ? t("day to go") : t("days to go")}</span>
          </>
        )}
      </div>

      <div className="race-preview-title">
        <strong className={draft.name.trim() ? undefined : "is-empty"}>{draft.name.trim() || t("Your race")}</strong>
        {distance || draft.location.trim() ? (
          <span className="race-preview-meta">
            {distance ? <span className="race-target-distance"><Flag size={12} aria-hidden="true" />{distance}</span> : null}
            {draft.location.trim() ? <span><MapPin size={12} aria-hidden="true" />{draft.location.trim()}</span> : null}
          </span>
        ) : null}
        {draft.priority || registration ? (
          <span className="race-preview-tags">
            {draft.priority ? (
              <span className={`race-target-priority is-${draft.priority.toLowerCase()}`}>
                {draft.priority} · {t(PRIORITY_LABELS[draft.priority])}
              </span>
            ) : null}
            {registration ? (
              <span className={`race-target-entry is-${registration.key}`}>
                {registration.key === "registered" ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : null}
                {t(registration.label)}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {goal ? (
        <dl className="race-preview-goal">
          <div>
            <dt>{t("Goal time")}</dt>
            <dd>{formatRaceTime(goal)}</dd>
          </div>
          {distanceMeters ? (
            <div>
              <dt>{t("Goal pace")}</dt>
              <dd>{formatPaceValue(goal / (distanceMeters / 1000), unitSystem)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="race-preview-dates">
        <p className="race-preview-heading">{t("On your calendar")}</p>
        {dates.length ? (
          <ol>
            {dates.map((entry) => {
              const until = daysFromToday(entry.day);
              return (
                <li key={entry.key} className={entry.key === "race" ? "is-race" : undefined}>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>{relativeDay(until)}</small>
                  </span>
                  <span className="race-preview-day">
                    {formatDate(inputDay(entry.day), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                    {"time" in entry && entry.time ? ` · ${entry.time}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>{t("Race day, bib pickup and the registration deadline appear here.")}</p>
        )}
      </div>
    </aside>
  );
}
