import { formatDate, t, useLanguage } from "../../i18n/training";
import { useState } from "react";
import { CalendarClock, Check, ExternalLink, Flag, Loader2, MapPin, Pencil, Target, Ticket, X } from "lucide-react";
import type { RaceTarget } from "../../../electron/raceTypes";
import { RACE_REGISTRATIONS, raceDistanceLabel } from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { formatDistanceValue, formatPaceValue } from "../../units/units";
import { formatRaceStartTime, formatRaceTime } from "../raceFormat";
import type { RaceJournal } from "../useRaceJournal";

const PRIORITY_LABELS: Record<NonNullable<RaceTarget["priority"]>, string> = {
  A: "Goal race",
  B: "Important",
  C: "Tune-up"
};

function dayDate(raceDay: string): Date {
  return new Date(Number(raceDay.slice(0, 4)), Number(raceDay.slice(4, 6)) - 1, Number(raceDay.slice(6, 8)));
}

function daysUntil(raceDay: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dayDate(raceDay).getTime() - today.getTime()) / 86_400_000);
}

function localDayKey(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function shortDay(day: string): string {
  return formatDate(dayDate(day), { weekday: "short", day: "numeric", month: "short" });
}

/** A nudge while the athlete still has to enter; nothing once they're in. */
function registrationAlert(target: RaceTarget, today: string): { text: string; urgent: boolean } | null {
  if (!target.registrationDeadline || target.registration === "registered" || target.registration === "deferred") return null;
  if (target.registrationDeadline < today) {
    return { text: t("Registration closed {{p0}}", { p0: shortDay(target.registrationDeadline) }), urgent: false };
  }
  const days = daysUntil(target.registrationDeadline);
  return {
    text: days === 0
      ? t("Registration closes today")
      : days === 1 ? t("Registration closes tomorrow") : t("Registration closes in {{count}} days", { count: days }),
    urgent: days <= 14
  };
}

/**
 * Races the athlete is training for, soonest first. The athlete adds them from
 * Add race → Upcoming, or the Coach adds one after the athlete approves its card.
 */
export function RaceTargets({
  targets,
  journal,
  unitSystem,
  onEdit
}: {
  targets: RaceTarget[];
  journal: RaceJournal;
  unitSystem: UnitSystem;
  onEdit: (target: RaceTarget) => void;
}) {
  useLanguage();
  const [confirming, setConfirming] = useState<string | null>(null);
  const today = localDayKey();
  const upcoming = targets.filter((target) => target.raceDay >= today);
  if (!upcoming.length) return null;

  return (
    <section className="races-targets" aria-labelledby="races-targets-title">
      <div className="races-targets-head">
        <h3 id="races-targets-title"><Target size={15} aria-hidden="true" />{t("Up next")}</h3>
        <p>{t("Races you're training for. Your coach plans around them.")}</p>
      </div>
      <ul>
        {upcoming.map((target) => {
          const days = daysUntil(target.raceDay);
          const removing = journal.pending === `target:${target.targetId}`;
          const registration = RACE_REGISTRATIONS.find((option) => option.key === target.registration);
          const alert = registrationAlert(target, today);
          const pickup = [
            target.bibPickupDay ? shortDay(target.bibPickupDay) : undefined,
            target.bibPickupHours,
            target.bibPickupLocation
          ].filter(Boolean).join(" · ");
          const hasLogistics = Boolean(target.bibNumber || target.wave || pickup || target.website);
          const distance = target.distanceKey === "other"
            ? formatDistanceValue(target.distance, unitSystem)
            : t(raceDistanceLabel(target.distanceKey));
          return (
            <li key={target.targetId} className={`race-target${confirming === target.targetId ? " is-confirming" : ""}`} data-distance={target.distanceKey}>
              <div className="race-target-count" aria-label={days === 0 ? t("Race day") : t("{{count}} days to go", { count: days })}>
                <strong>{days === 0 ? t("Today") : days}</strong>
                {days === 0 ? null : <span>{days === 1 ? t("day") : t("days")}</span>}
              </div>
              <div className="race-target-copy">
                <div className="race-target-title">
                  <strong>{target.name}</strong>
                  {target.priority ? (
                    <span className={`race-target-priority is-${target.priority.toLowerCase()}`} title={t(PRIORITY_LABELS[target.priority])}>
                      {target.priority} · {t(PRIORITY_LABELS[target.priority])}
                    </span>
                  ) : null}
                  {registration ? (
                    <span className={`race-target-entry is-${registration.key}`}>
                      {registration.key === "registered" ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : null}
                      {t(registration.label)}
                    </span>
                  ) : null}
                </div>
                <span className="race-target-meta">
                  <span className="race-target-distance"><Flag size={12} aria-hidden="true" />{distance}</span>
                  <span>
                    {formatDate(dayDate(target.raceDay), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                    {target.startTime ? ` · ${formatRaceStartTime(target.startTime)}` : ""}
                  </span>
                  {target.location ? <span><MapPin size={12} aria-hidden="true" />{target.location}</span> : null}
                </span>
                {target.goalTime ? (
                  <span className="race-target-goal">
                    {t("Goal {{p0}}", { p0: formatRaceTime(target.goalTime) })}
                    <span>{formatPaceValue(target.goalTime / (target.distance / 1000), unitSystem)}</span>
                  </span>
                ) : null}
                {hasLogistics ? (
                  <span className="race-target-logistics">
                    {target.bibNumber || target.wave ? (
                      <span>
                        <Ticket size={12} aria-hidden="true" />
                        {[target.bibNumber ? t("Bib {{p0}}", { p0: target.bibNumber }) : undefined, target.wave].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {pickup ? (
                      <span title={t("Bib pickup")}>
                        <CalendarClock size={12} aria-hidden="true" />
                        {t("Pickup {{p0}}", { p0: pickup })}
                      </span>
                    ) : null}
                    {target.website ? (
                      <a href={target.website} target="_blank" rel="noreferrer">
                        <ExternalLink size={12} aria-hidden="true" />
                        {t("Website")}
                      </a>
                    ) : null}
                  </span>
                ) : null}
                {alert ? <span className={`race-target-alert${alert.urgent ? " is-urgent" : ""}`}>{alert.text}</span> : null}
              </div>
              <div className="race-target-actions">
                {confirming === target.targetId ? (
                  <>
                    <button type="button" className="race-text-button" onClick={() => setConfirming(null)}>{t("Keep")}</button>
                    <button
                      type="button"
                      className="race-action is-compact is-danger"
                      disabled={journal.pending !== null || journal.readOnly}
                      onClick={() => void journal.removeTarget(target.targetId).then(() => setConfirming(null))}
                    >
                      {removing ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}
                      {t("Remove")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="race-icon-button"
                      aria-label={t("Edit {{p0}}", { p0: target.name })}
                      title={t("Edit registration, bib and race-day details")}
                      disabled={journal.pending !== null || journal.readOnly}
                      onClick={() => onEdit(target)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="race-icon-button"
                      aria-label={t("Remove {{p0}}", { p0: target.name })}
                      title={t("Remove target race")}
                      disabled={journal.pending !== null || journal.readOnly}
                      onClick={() => setConfirming(target.targetId)}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
