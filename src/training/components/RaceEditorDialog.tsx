import { localizedText, renderLocalizedText, type LocalizableText, t, useLanguage } from "../../i18n/training";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import type { ManualRaceInput, RaceDistanceKey, RaceEditInput, RaceEntry, RacePriority, RaceTargetInput } from "../../../electron/raceTypes";
import { RACE_DISTANCES } from "../../../electron/raceModel";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { displayDistanceToMeters, distanceUnit, metersToDisplayDistance } from "../../units/units";
import { formatRaceTime, fromDateInputValue, parseRaceTime, toDateInputValue } from "../raceFormat";

/** "result" adds a race already run; "upcoming" adds one the athlete is training for. */
export type RaceAddKind = "result" | "upcoming";
export type RaceEditorTarget = { mode: "edit"; race: RaceEntry } | { mode: "add"; kind?: RaceAddKind };

interface RaceEditorDialogProps {
  target: RaceEditorTarget | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: RaceEditInput) => Promise<boolean>;
  onAdd: (input: ManualRaceInput) => Promise<boolean>;
  onAddTarget: (input: RaceTargetInput) => Promise<boolean>;
  onRemove: (raceId: string) => Promise<boolean>;
}

interface Draft {
  kind: RaceAddKind;
  name: string;
  date: string;
  distanceKey: RaceDistanceKey;
  otherDistance: string;
  time: string;
  placing: string;
  priority: RacePriority | "";
  location: string;
  notes: string;
}

const PRIORITY_OPTIONS: { value: RacePriority; label: string }[] = [
  { value: "A", label: "Goal race" },
  { value: "B", label: "Important" },
  { value: "C", label: "Tune-up" }
];

function todayInputValue(): string {
  return toDateInputValue(Math.floor(Date.now() / 1000));
}

function draftFor(target: RaceEditorTarget, unitSystem: "metric" | "imperial"): Draft {
  if (target.mode === "add") {
    return {
      kind: target.kind ?? "result",
      name: "",
      date: todayInputValue(),
      distanceKey: "5k",
      otherDistance: "",
      time: "",
      placing: "",
      priority: "",
      location: "",
      notes: ""
    };
  }
  const { race } = target;
  return {
    kind: "result",
    name: race.name,
    date: toDateInputValue(race.startTime),
    distanceKey: race.distanceKey,
    otherDistance:
      race.distanceKey === "other"
        ? String(Math.round(metersToDisplayDistance(race.officialDistance, unitSystem) * 100) / 100)
        : "",
    time: race.officialTimeIsManual || race.source === "manual" ? formatRaceTime(race.officialTime) : "",
    placing: race.placing ?? "",
    priority: "",
    location: "",
    notes: race.notes ?? ""
  };
}

export function RaceEditorDialog({ target, busy, error, onClose, onSave, onAdd, onAddTarget, onRemove }: RaceEditorDialogProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localError, setLocalError] = useState<LocalizableText | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      setDraft(draftFor(target, unitSystem));
      setLocalError(null);
      setConfirmRemove(false);
      if (!dialog.open) dialog.showModal();
      // The form stays mounted between openings, so autoFocus alone only works once.
      requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>(".race-field input")?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [target, unitSystem]);

  const race = target?.mode === "edit" ? target.race : null;
  const recorded = race !== null && race.source !== "manual";
  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const upcoming = target?.mode === "add" && draft?.kind === "upcoming";
  const today = todayInputValue();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !target) return;
    setLocalError(null);
    const time = draft.time.trim() ? parseRaceTime(draft.time) : undefined;
    if (draft.time.trim() && time === undefined) {
      setLocalError(localizedText(() => t("Enter the time as h:mm:ss or mm:ss, for example 22:11 or 1:40:15.")));
      return;
    }
    let otherDistance: number | undefined;
    if (draft.distanceKey === "other") {
      const value = Number(draft.otherDistance.replace(",", "."));
      if (draft.otherDistance.trim() && (!Number.isFinite(value) || value <= 0)) {
        setLocalError(localizedText(() => t("Enter the race distance in {{p0}}.", { p0: String(distanceUnit(unitSystem)) })));
        return;
      }
      otherDistance = draft.otherDistance.trim() ? displayDistanceToMeters(value, unitSystem) : undefined;
    }

    if (target.mode === "add" && draft.kind === "upcoming") {
      if (!draft.name.trim()) return setLocalError(localizedText(() => t("Enter the race name.")));
      if (!draft.date) return setLocalError(localizedText(() => t("Enter the race date.")));
      if (draft.date < todayInputValue()) {
        return setLocalError(localizedText(() => t("An upcoming race needs a date from today on. Choose Past race to log a race you've run.")));
      }
      if (draft.distanceKey === "other" && otherDistance === undefined) {
        return setLocalError(localizedText(() => t("Enter the race distance in {{p0}}.", { p0: String(distanceUnit(unitSystem)) })));
      }
      if (await onAddTarget({
        name: draft.name,
        raceDay: draft.date,
        distanceKey: draft.distanceKey,
        distance: otherDistance,
        goalTime: time,
        priority: draft.priority || undefined,
        location: draft.location,
        notes: draft.notes
      })) onClose();
      return;
    }

    if (target.mode === "add") {
      const startTime = fromDateInputValue(draft.date);
      if (!draft.name.trim()) return setLocalError(localizedText(() => t("Enter the race name.")));
      if (startTime === undefined) return setLocalError(localizedText(() => t("Enter the race date.")));
      if (time === undefined) {
        return setLocalError(draft.date > todayInputValue()
          ? localizedText(() => t("This race hasn't happened yet. Choose Upcoming race to plan for it."))
          : localizedText(() => t("Enter your finish time.")));
      }
      if (draft.distanceKey === "other" && otherDistance === undefined) {
        return setLocalError(localizedText(() => t("Enter the race distance in {{p0}}.", { p0: String(distanceUnit(unitSystem)) })));
      }
      if (await onAdd({
        name: draft.name,
        startTime,
        distanceKey: draft.distanceKey,
        officialDistance: otherDistance,
        officialTime: time,
        placing: draft.placing,
        notes: draft.notes
      })) onClose();
      return;
    }

    const input: RaceEditInput = {
      raceId: target.race.raceId,
      name: draft.name.trim() ? draft.name : null,
      officialTime: time ?? null,
      placing: draft.placing.trim() ? draft.placing : null,
      notes: draft.notes.trim() ? draft.notes : null
    };
    if (draft.distanceKey !== target.race.distanceKey) input.distanceKey = draft.distanceKey;
    if (draft.distanceKey === "other") input.officialDistance = otherDistance ?? null;
    if (!recorded && time === undefined) return setLocalError(localizedText(() => t("Enter your finish time.")));
    if (await onSave(input)) onClose();
  }

  const shownError = localError ?? error;
  const recordedTime = race?.recordedTime;

  return (
    <dialog
      ref={dialogRef}
      className="race-editor"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {draft && target ? (
        <form className="race-editor-surface" onSubmit={(event) => void submit(event)} noValidate>
          <header className="race-editor-head">
            <div>
              <p className="race-eyebrow">{upcoming ? t("Up next") : target.mode === "add" ? t("Race journal") : t("Race result")}</p>
              <h2 id={headingId}>{upcoming ? t("Add an upcoming race") : target.mode === "add" ? t("Add a race") : t("Edit race")}</h2>
            </div>
            <button type="button" className="race-icon-button" aria-label={t("Close")} onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>

          {target.mode === "add" ? (
            <div className="race-kind-switch" role="group" aria-label={t("Race type")}>
              <button
                type="button"
                aria-pressed={!upcoming}
                onClick={() => {
                  setLocalError(null);
                  update({ kind: "result" });
                }}
              >
                <strong>{t("Past race")}</strong>
                <span>{t("Log a result")}</span>
              </button>
              <button
                type="button"
                aria-pressed={upcoming}
                onClick={() => {
                  setLocalError(null);
                  update({ kind: "upcoming", date: draft.date < today ? today : draft.date });
                }}
              >
                <strong>{t("Upcoming race")}</strong>
                <span>{t("Plan your training")}</span>
              </button>
            </div>
          ) : null}

          <div className="race-editor-fields">
            <label className="race-field is-wide">
              <span>{t("Race name")}</span>
              <input
                type="text"
                value={draft.name}
                maxLength={120}
                placeholder={race?.activityName ?? t("Spring 10K")}
                onChange={(event) => update({ name: event.target.value })}
                autoFocus
              />
            </label>
            {target.mode === "add" ? (
              <label className="race-field">
                <span>{t("Date")}</span>
                <input
                  type="date"
                  value={draft.date}
                  min={upcoming ? today : undefined}
                  onChange={(event) => update({ date: event.target.value })}
                />
              </label>
            ) : null}
            <label className="race-field">
              <span>{t("Distance")}</span>
              <select
                value={draft.distanceKey}
                onChange={(event) => update({ distanceKey: event.target.value as RaceDistanceKey })}
              >
                {RACE_DISTANCES.map((distance) => (
                  <option key={distance.key} value={distance.key}>
                    {t(distance.label)}
                  </option>
                ))}
                <option value="other">{t("Other distance")}</option>
              </select>
            </label>
            {draft.distanceKey === "other" ? (
              <label className="race-field">
                <span>{t("Course length ({{p0}})", { p0: String(distanceUnit(unitSystem)) })}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.otherDistance}
                  placeholder={
                    race?.recordedDistance
                      ? String(Math.round(metersToDisplayDistance(race.recordedDistance, unitSystem) * 100) / 100)
                      : unitSystem === "imperial" ? "4.35" : "7"
                  }
                  onChange={(event) => update({ otherDistance: event.target.value })}
                />
              </label>
            ) : null}
            <label className="race-field">
              {upcoming ? (
                <span>{t("Goal time")}<em>{t("optional")}</em></span>
              ) : (
                <span>{recorded ? t("Chip time") : t("Finish time")}</span>
              )}
              <input
                type="text"
                inputMode="numeric"
                value={draft.time}
                placeholder={recorded && recordedTime ? formatRaceTime(recordedTime) : t("h:mm:ss")}
                onChange={(event) => update({ time: event.target.value })}
                aria-describedby={recorded ? `${headingId}-time-hint` : undefined}
              />
            </label>
            {recorded ? (
              <p className="race-field-hint is-wide" id={`${headingId}-time-hint`}>
                {recordedTime
                  ? t("Leave blank to use the watch time ({{time}}).", { time: formatRaceTime(recordedTime) })
                  : t("Leave blank to use the watch time.")}{" "}
                {t("Results use the official course distance, not the distance your watch measured.")}</p>
            ) : null}
            {upcoming ? (
              <>
                <label className="race-field">
                  <span>{t("Priority")}<em>{t("optional")}</em></span>
                  <select
                    value={draft.priority}
                    onChange={(event) => update({ priority: event.target.value as Draft["priority"] })}
                  >
                    <option value="">{t("Not set")}</option>
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value} · {t(option.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="race-field is-wide">
                  <span>{t("Location")}<em>{t("optional")}</em></span>
                  <input
                    type="text"
                    value={draft.location}
                    maxLength={120}
                    placeholder={t("Valencia, Spain")}
                    onChange={(event) => update({ location: event.target.value })}
                  />
                </label>
              </>
            ) : (
              <label className="race-field is-wide">
                <span>{t("Placing")}<em>{t("optional")}</em></span>
                <input
                  type="text"
                  value={draft.placing}
                  maxLength={120}
                  placeholder={t("48th of 912 · 6th M30–34")}
                  onChange={(event) => update({ placing: event.target.value })}
                />
              </label>
            )}
            <label className="race-field is-wide">
              <span>{t("Notes")}<em>{t("optional")}</em></span>
              <textarea
                rows={3}
                value={draft.notes}
                maxLength={2000}
                placeholder={upcoming ? t("Goals, course, travel plans") : t("Weather, course, how it felt")}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </div>

          {shownError ? (
            <p className="race-editor-error" role="alert">
              {renderLocalizedText(shownError)}
            </p>
          ) : null}

          <footer className="race-editor-foot">
            {race ? (
              <button
                type="button"
                className={`race-text-button is-danger${confirmRemove ? " is-confirming" : ""}`}
                disabled={busy}
                onClick={async () => {
                  if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                  }
                  if (await onRemove(race.raceId)) onClose();
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                {confirmRemove ? t("Remove from races?") : t("Remove race")}
              </button>
            ) : null}
            <span className="race-editor-spacer" />
            <button type="button" className="race-action" onClick={onClose}>{t("Cancel")}</button>
            <button type="submit" className="race-action is-primary" disabled={busy}>
              {busy ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
              {target.mode === "add" ? t("Add race") : t("Save")}
            </button>
          </footer>
        </form>
      ) : null}
    </dialog>
  );
}
