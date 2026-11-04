import { formatDate, t, useLanguage } from "../../i18n/training";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CalendarClock, Check, ExternalLink, Flag, Loader2, MapPin, Pencil, Target, Ticket, X } from "lucide-react";
import type { RaceEntry, RaceTarget } from "../../../electron/raceTypes";
import type { TrainingHubActivity, TrainingHubRacePredictor } from "../../../electron/types";
import {
  BUILD_UP_WEEKS,
  computeBuildUp,
  equivalentTime,
  RACE_REGISTRATIONS,
  raceDistanceLabel
} from "../../../electron/raceModel";
import type { UnitSystem } from "../../../electron/types";
import { formatDistanceValue, formatPaceValue } from "../../units/units";
import { formatRaceStartTime, formatRaceTime } from "../raceFormat";
import type { RaceJournal } from "../useRaceJournal";

const PRIORITY_LABELS: Record<NonNullable<RaceTarget["priority"]>, string> = {
  A: "Goal race",
  B: "Important",
  C: "Tune-up"
};

/** Runs that count toward a build-up, as the race service counts them. */
const BUILD_UP_SPORT_TYPES = new Set([100, 101, 102, 103]);

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

/** The gun time as a local Date, when the athlete gave a start time. */
function startDate(target: RaceTarget): Date | undefined {
  if (!target.startTime) return undefined;
  const [hours, minutes] = target.startTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  const day = dayDate(target.raceDay);
  day.setHours(hours, minutes, 0, 0);
  return day;
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

function targetDistance(target: RaceTarget, unitSystem: UnitSystem): string {
  return target.distanceKey === "other"
    ? formatDistanceValue(target.distance, unitSystem)
    : t(raceDistanceLabel(target.distanceKey));
}

/**
 * COROS's prediction for the race distance; any other distance it predicts is
 * scaled with Riegel's formula, as the 5K equivalents are.
 */
function predictionFor(
  target: RaceTarget,
  predictor: TrainingHubRacePredictor | null | undefined
): { seconds: number; from?: string } | undefined {
  const scores = (predictor?.runScoreList ?? []).filter(
    (score) => (score.distance ?? 0) > 0 && (score.predictSeconds ?? 0) > 0
  );
  if (!scores.length || !(target.distance > 0)) return undefined;
  const nearest = scores.reduce((best, score) =>
    Math.abs(Math.log(score.distance! / target.distance)) < Math.abs(Math.log(best.distance! / target.distance)) ? score : best
  );
  const ratio = nearest.distance! / target.distance;
  if (Math.abs(ratio - 1) < 0.015) return { seconds: nearest.predictSeconds! };
  if (ratio < 0.25 || ratio > 4) return undefined;
  return {
    seconds: equivalentTime(nearest.predictSeconds!, nearest.distance!, target.distance),
    from: nearest.distanceLabel ?? undefined
  };
}

/**
 * Ticks once a second while the countdown is on screen; stops when the tab
 * panel is hidden, the window is in the background, or the hero unmounts.
 */
function useTicker(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    let onScreen = false;
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      if (timer !== undefined || !onScreen || document.visibilityState !== "visible") return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    observer.observe(element);
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
  return { ref, now };
}

function Countdown({ target }: { target: RaceTarget }) {
  useLanguage();
  const start = startDate(target);
  const { ref, now } = useTicker(Boolean(start));
  const days = daysUntil(target.raceDay, new Date(now));

  if (days <= 0) {
    return (
      <div className="race-hero-countdown is-today" ref={ref}>
        <strong>{t("Race day")}</strong>
        {start ? <span>{formatRaceStartTime(target.startTime!)}</span> : null}
      </div>
    );
  }

  // Without a start time only whole days are honest.
  if (!start) {
    return (
      <div className="race-hero-countdown" ref={ref}>
        <div className="race-hero-unit" role="timer" aria-label={t("{{count}} days to go", { count: days })}>
          <strong aria-hidden="true">{days}</strong>
          <span aria-hidden="true">{t("Days")}</span>
        </div>
        <p className="race-hero-countdown-note">{t("Add a start time for a countdown to the gun.")}</p>
      </div>
    );
  }

  const left = Math.max(0, Math.floor((start.getTime() - now) / 1000));
  const units = [
    { key: "days", value: Math.floor(left / 86_400), label: t("Days") },
    { key: "hours", value: Math.floor((left % 86_400) / 3600), label: t("Hours") },
    { key: "minutes", value: Math.floor((left % 3600) / 60), label: t("Minutes") },
    { key: "seconds", value: left % 60, label: t("Seconds") }
  ];
  return (
    <div
      className="race-hero-countdown"
      ref={ref}
      role="timer"
      aria-label={t("{{p0}} days, {{p1}} hours and {{p2}} minutes to the start", {
        p0: String(units[0].value),
        p1: String(units[1].value),
        p2: String(units[2].value)
      })}
    >
      {units.map((unit) => (
        <div key={unit.key} className={`race-hero-unit is-${unit.key}`} aria-hidden="true">
          <strong>{unit.key === "days" ? unit.value : String(unit.value).padStart(2, "0")}</strong>
          <span>{unit.label}</span>
        </div>
      ))}
    </div>
  );
}

interface ReadyBar {
  key: string;
  label: string;
  value: string;
  fill: number;
  tone: "mint" | "sky" | "gold";
}

/** "Are you ready?", built only from synced runs, past races and COROS's prediction. */
function useReadiness({
  target,
  races,
  activities,
  predicted,
  unitSystem
}: {
  target: RaceTarget;
  races: readonly RaceEntry[];
  activities: readonly TrainingHubActivity[];
  predicted?: number;
  unitSystem: UnitSystem;
}) {
  return useMemo(() => {
    const bars: ReadyBar[] = [];
    const notes: string[] = [];
    if (target.goalTime && predicted) {
      bars.push({
        key: "goal",
        label: t("Predicted vs goal"),
        value: t("{{p0}} predicted · {{p1}} goal", { p0: formatRaceTime(Math.round(predicted)), p1: formatRaceTime(target.goalTime) }),
        fill: Math.min(1, target.goalTime / predicted),
        tone: predicted <= target.goalTime ? "mint" : "gold"
      });
    }

    let coverageStart: number | undefined;
    const runs: { startTime: number; distance: number }[] = [];
    for (const activity of activities) {
      if (activity.startTime === undefined) continue;
      coverageStart = coverageStart === undefined ? activity.startTime : Math.min(coverageStart, activity.startTime);
      if (BUILD_UP_SPORT_TYPES.has(activity.sportType) && (activity.distance ?? 0) > 0) {
        runs.push({ startTime: activity.startTime, distance: activity.distance! });
      }
    }
    const recent = computeBuildUp(Math.floor(Date.now() / 1000), runs, coverageStart);
    // The build-up to the athlete's fastest race over this distance, when there is one.
    const reference = target.distanceKey === "other"
      ? undefined
      : races
          .filter((race) => race.distanceKey === target.distanceKey && race.buildUp && race.buildUp.runs > 0)
          .reduce<RaceEntry | undefined>((best, race) => (!best || race.officialTime < best.officialTime ? race : best), undefined);
    const km = (meters: number, digits = 1) => formatDistanceValue(meters, unitSystem, { digits });

    if (recent.runs > 0) {
      const longest = recent.longestRun ?? 0;
      const refLongest = reference?.buildUp?.longestRun;
      bars.push({
        key: "longest",
        label: t("Longest run, last {{p0}} weeks", { p0: String(BUILD_UP_WEEKS) }),
        value: refLongest ? t("{{p0}} of {{p1}}", { p0: km(longest), p1: km(refLongest) }) : km(longest),
        fill: Math.min(1, longest / (refLongest ?? target.distance)),
        tone: "sky"
      });
      const refDistance = reference?.buildUp?.distance;
      if (refDistance) {
        bars.push({
          key: "volume",
          label: t("Distance, last {{p0}} weeks", { p0: String(BUILD_UP_WEEKS) }),
          value: t("{{p0}} of {{p1}}", { p0: km(recent.distance, 0), p1: km(refDistance, 0) }),
          fill: Math.min(1, recent.distance / refDistance),
          tone: "mint"
        });
      }
      notes.push(
        reference
          ? t("Measured against the build-up to {{p0}}, your fastest {{p1}}.", {
              p0: reference.name,
              p1: targetDistance(target, unitSystem)
            })
          : t("Longest run measured against the race distance.")
      );
      if (!recent.complete) notes.push(t("Your synced history starts partway through these weeks."));
    }
    return { bars, notes };
  }, [target, races, activities, predicted, unitSystem]);
}

/** The next race, front and centre: a live countdown, goal against prediction, logistics. */
function RaceHero({
  target,
  races,
  activities,
  racePredictor,
  unitSystem,
  journal,
  confirming,
  setConfirming,
  onEdit
}: {
  target: RaceTarget;
  races: readonly RaceEntry[];
  activities: readonly TrainingHubActivity[];
  racePredictor?: TrainingHubRacePredictor | null;
  unitSystem: UnitSystem;
  journal: RaceJournal;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  onEdit: () => void;
}) {
  useLanguage();
  const today = localDayKey();
  const prediction = predictionFor(target, racePredictor);
  const { bars, notes } = useReadiness({ target, races, activities, predicted: prediction?.seconds, unitSystem });
  const registration = RACE_REGISTRATIONS.find((option) => option.key === target.registration);
  const alert = registrationAlert(target, today);
  const removing = journal.pending === `target:${target.targetId}`;
  const distance = targetDistance(target, unitSystem);
  const gap = prediction && target.goalTime ? Math.round(prediction.seconds) - target.goalTime : undefined;
  const pickupMeta = [target.bibPickupHours, target.bibPickupLocation].filter(Boolean).join(" · ");
  const mark = target.distanceKey === "half" ? "HM" : target.distanceKey === "marathon" ? "M" : target.distanceKey === "other" ? "" : t(raceDistanceLabel(target.distanceKey)).replace(/\s+/g, "").toUpperCase();

  const tiles: { key: string; label: string; value: ReactNode; meta?: ReactNode; tone?: string; title?: string }[] = [];
  if (target.goalTime) {
    tiles.push({
      key: "goal",
      label: t("Goal time"),
      value: formatRaceTime(target.goalTime),
      meta: formatPaceValue(target.goalTime / (target.distance / 1000), unitSystem)
    });
  }
  if (prediction) {
    tiles.push({
      key: "predicted",
      label: t("Predicted"),
      value: formatRaceTime(Math.round(prediction.seconds)),
      title: prediction.from ? t("Scaled from your {{p0}} prediction with Riegel's formula", { p0: t(prediction.from) }) : undefined,
      meta: gap === undefined
        ? formatPaceValue(prediction.seconds / (target.distance / 1000), unitSystem)
        : Math.abs(gap) < 1
          ? t("Right on goal")
          : gap > 0
            ? t("{{p0}} to find", { p0: formatRaceTime(gap) })
            : t("{{p0}} under goal", { p0: formatRaceTime(-gap) }),
      tone: gap === undefined ? undefined : gap > 0 ? "is-behind" : "is-ahead"
    });
  }
  if (target.bibPickupDay || target.bibPickupLocation) {
    tiles.push({
      key: "pickup",
      label: t("Bib pickup"),
      value: target.bibPickupDay ? shortDay(target.bibPickupDay) : target.bibPickupLocation,
      meta: target.bibPickupDay ? pickupMeta || undefined : target.bibPickupHours
    });
  }
  if (target.bibNumber || target.wave) {
    tiles.push({
      key: "bib",
      label: t("Bib"),
      value: target.bibNumber ? `#${target.bibNumber}` : target.wave,
      meta: target.bibNumber ? target.wave : undefined
    });
  }

  return (
    <section className="race-hero" data-distance={target.distanceKey} aria-labelledby="race-hero-title">
      {mark ? <span className="race-hero-mark" aria-hidden="true">{mark}</span> : null}
      <div className="race-hero-main">
        <div className="race-hero-tags">
          <span className="race-hero-eyebrow">
            {t("Up next")}
            {target.priority ? ` · ${t(PRIORITY_LABELS[target.priority])}` : ""}
          </span>
          <span className="race-hero-when">
            {formatDate(dayDate(target.raceDay), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            {target.startTime ? ` · ${formatRaceStartTime(target.startTime)}` : ""}
          </span>
        </div>
        <h3 className="race-hero-title" id="race-hero-title">{target.name}</h3>
        <p className="race-hero-meta">
          <span className="race-hero-distance"><Flag size={13} aria-hidden="true" />{distance}</span>
          {target.location ? <span><MapPin size={13} aria-hidden="true" />{target.location}</span> : null}
          {registration ? (
            <span className={`race-target-entry is-${registration.key}`}>
              {registration.key === "registered" ? <Check size={11} strokeWidth={2.6} aria-hidden="true" /> : null}
              {t(registration.label)}
            </span>
          ) : null}
        </p>
        <Countdown target={target} />
        {tiles.length ? (
          <dl className="race-hero-tiles">
            {tiles.map((tile) => (
              <div key={tile.key} className={`race-hero-tile is-${tile.key}`} title={tile.title}>
                <dt>{tile.label}</dt>
                <dd>
                  <strong>{tile.value}</strong>
                  {tile.meta ? <span className={tile.tone}>{tile.meta}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {alert ? <p className={`race-target-alert${alert.urgent ? " is-urgent" : ""}`}>{alert.text}</p> : null}
      </div>

      <div className="race-hero-side">
        <h4 className="race-hero-ready-title">{t("Are you ready?")}</h4>
        {bars.length ? (
          <ul className="race-hero-ready">
            {bars.map((bar) => (
              <li key={bar.key} className={`is-${bar.tone}`}>
                <span className="race-hero-ready-row">
                  <span>{bar.label}</span>
                  <strong>{bar.value}</strong>
                </span>
                <span className="race-hero-ready-track" aria-hidden="true">
                  <span style={{ "--fill": `${Math.round(bar.fill * 100)}%` } as CSSProperties} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="race-hero-ready-empty">{t("Set a goal time and sync your runs to see how your training stacks up.")}</p>
        )}
        {notes.map((note) => (
          <p key={note} className="race-hero-ready-note">{note}</p>
        ))}
        {target.notes ? <p className="race-hero-notes">{target.notes}</p> : null}
        <div className="race-hero-actions">
          {confirming ? (
            <>
              <button type="button" className="race-text-button" onClick={() => setConfirming(false)}>{t("Keep")}</button>
              <button
                type="button"
                className="race-action is-compact is-danger"
                disabled={journal.pending !== null || journal.readOnly}
                onClick={() => void journal.removeTarget(target.targetId).then(() => setConfirming(false))}
              >
                {removing ? <Loader2 className="spin" size={14} aria-hidden="true" /> : null}
                {t("Remove")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="race-action is-compact"
                title={t("Edit registration, bib and race-day details")}
                disabled={journal.pending !== null || journal.readOnly}
                onClick={onEdit}
              >
                <Pencil size={14} aria-hidden="true" />
                {t("Edit race")}
              </button>
              {target.website ? (
                <a className="race-action is-compact" href={target.website} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden="true" />
                  {t("Website")}
                </a>
              ) : null}
              <button
                type="button"
                className="race-text-button"
                aria-label={t("Remove {{p0}}", { p0: target.name })}
                title={t("Remove target race")}
                disabled={journal.pending !== null || journal.readOnly}
                onClick={() => setConfirming(true)}
              >
                {t("Remove")}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Races the athlete is training for, soonest first. The athlete adds them from
 * Add race → Upcoming, or the Coach adds one after the athlete approves its card.
 * The season's goal race (else the next one) gets the hero; the rest follow as rows.
 */
export function RaceTargets({
  targets,
  journal,
  unitSystem,
  races = [],
  activities = [],
  racePredictor,
  onEdit
}: {
  targets: RaceTarget[];
  journal: RaceJournal;
  unitSystem: UnitSystem;
  races?: readonly RaceEntry[];
  activities?: readonly TrainingHubActivity[];
  racePredictor?: TrainingHubRacePredictor | null;
  onEdit: (target: RaceTarget) => void;
}) {
  useLanguage();
  const [confirming, setConfirming] = useState<string | null>(null);
  const today = localDayKey();
  const upcoming = targets.filter((target) => target.raceDay >= today);
  if (!upcoming.length) return null;
  const hero = upcoming.find((target) => target.priority === "A") ?? upcoming[0];
  const rest = upcoming.filter((target) => target !== hero);

  return (
    <>
      <RaceHero
        target={hero}
        races={races}
        activities={activities}
        racePredictor={racePredictor}
        unitSystem={unitSystem}
        journal={journal}
        confirming={confirming === hero.targetId}
        setConfirming={(value) => setConfirming(value ? hero.targetId : null)}
        onEdit={() => onEdit(hero)}
      />
      {rest.length ? (
        <section className="races-targets" aria-labelledby="races-targets-title">
          <div className="races-targets-head">
            <h3 id="races-targets-title"><Target size={15} aria-hidden="true" />{t("Also on the calendar")}</h3>
            <p>{t("Races you're training for. Your coach plans around them.")}</p>
          </div>
          <ul>
            {rest.map((target) => (
              <TargetRow
                key={target.targetId}
                target={target}
                today={today}
                journal={journal}
                unitSystem={unitSystem}
                confirming={confirming === target.targetId}
                setConfirming={(value) => setConfirming(value ? target.targetId : null)}
                onEdit={() => onEdit(target)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function TargetRow({
  target,
  today,
  journal,
  unitSystem,
  confirming,
  setConfirming,
  onEdit
}: {
  target: RaceTarget;
  today: string;
  journal: RaceJournal;
  unitSystem: UnitSystem;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  onEdit: () => void;
}) {
  useLanguage();
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
  const distance = targetDistance(target, unitSystem);
  return (
    <li className={`race-target${confirming ? " is-confirming" : ""}`} data-distance={target.distanceKey}>
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
        {confirming ? (
          <>
            <button type="button" className="race-text-button" onClick={() => setConfirming(false)}>{t("Keep")}</button>
            <button
              type="button"
              className="race-action is-compact is-danger"
              disabled={journal.pending !== null || journal.readOnly}
              onClick={() => void journal.removeTarget(target.targetId).then(() => setConfirming(false))}
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
              onClick={onEdit}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="race-icon-button"
              aria-label={t("Remove {{p0}}", { p0: target.name })}
              title={t("Remove target race")}
              disabled={journal.pending !== null || journal.readOnly}
              onClick={() => setConfirming(true)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
