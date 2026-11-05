import { formatDate, localizedText, renderLocalizedText, type LocalizableText, t, useLanguage } from "../../i18n/training";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type {
  ManualRaceInput,
  RaceDistanceKey,
  RaceEditInput,
  RaceEntry,
  RaceLookupCandidate,
  RaceLookupEvent,
  RaceLookupResult,
  RacePriority,
  RaceRegistration,
  RaceTarget,
  RaceTargetEditInput,
  RaceTargetInput
} from "../../../electron/raceTypes";
import { RACE_DISTANCES, RACE_REGISTRATIONS, raceDistanceLabel, raceDistanceMeters } from "../../../electron/raceModel";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { displayDistanceToMeters, distanceUnit, formatPaceValue, metersToDisplayDistance } from "../../units/units";
import {
  applyRaceLookup,
  preferredLookupEvent,
  undoRaceLookup,
  type RaceDraft,
  type RaceLookupField
} from "../raceDraft";
import { formatRaceStartTime, formatRaceTime, fromDateInputValue, parseRaceTime, toDateInputValue } from "../raceFormat";
import type { RaceJournal } from "../useRaceJournal";
import { useRaceLookup } from "../useRaceLookup";
import { RaceFinder } from "./RaceFinder";
import { RacePreview } from "./RacePreview";

/** "result" adds a race already run; "upcoming" adds one the athlete is training for. */
export type RaceAddKind = "result" | "upcoming";
export type RaceEditorTarget =
  | { mode: "edit"; race: RaceEntry }
  | { mode: "add"; kind?: RaceAddKind }
  | { mode: "editTarget"; upcoming: RaceTarget };

interface RaceEditorDialogProps {
  target: RaceEditorTarget | null;
  busy: boolean;
  error: string | null;
  lookup: RaceJournal["lookup"];
  onClose: () => void;
  onSave: (input: RaceEditInput) => Promise<boolean>;
  onAdd: (input: ManualRaceInput) => Promise<boolean>;
  onAddTarget: (input: RaceTargetInput) => Promise<boolean>;
  onUpdateTarget: (input: RaceTargetEditInput) => Promise<boolean>;
  onRemove: (raceId: string) => Promise<boolean>;
  onRemoveTarget: (targetId: string) => Promise<boolean>;
}

type SectionId = "registration" | "raceDay" | "pickup" | "notes";

/** Which folded sections hold each field the AI can fill. */
const SECTION_FIELDS: Record<SectionId, readonly RaceLookupField[]> = {
  registration: ["registrationDeadline", "website"],
  raceDay: ["startTime"],
  pickup: ["bibPickupDay", "bibPickupHours", "bibPickupLocation"],
  notes: ["notes"]
};

const NO_FIELDS: ReadonlySet<RaceLookupField> = new Set();

const NO_LOGISTICS = {
  registration: "",
  registrationDeadline: "",
  bibNumber: "",
  startTime: "",
  wave: "",
  bibPickupLocation: "",
  bibPickupDay: "",
  bibPickupHours: "",
  website: ""
} as const satisfies Partial<RaceDraft>;

/** YYYYMMDD → the date input's YYYY-MM-DD. */
function dayInputValue(day: string | undefined): string {
  return day ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` : "";
}

const PRIORITY_OPTIONS: { value: RacePriority; label: string }[] = [
  { value: "A", label: "Goal race" },
  { value: "B", label: "Important" },
  { value: "C", label: "Tune-up" }
];

function todayInputValue(): string {
  return toDateInputValue(Math.floor(Date.now() / 1000));
}

function draftFor(target: RaceEditorTarget, unitSystem: "metric" | "imperial"): RaceDraft {
  if (target.mode === "add") {
    const kind = target.kind ?? "result";
    return {
      kind,
      name: "",
      // An upcoming race starts blank so nobody saves one on today by accident.
      date: kind === "upcoming" ? "" : todayInputValue(),
      distanceKey: kind === "upcoming" ? "" : "5k",
      otherDistance: "",
      time: "",
      placing: "",
      priority: "",
      location: "",
      notes: "",
      ...NO_LOGISTICS
    };
  }
  if (target.mode === "editTarget") {
    const { upcoming } = target;
    return {
      kind: "upcoming",
      name: upcoming.name,
      date: dayInputValue(upcoming.raceDay),
      distanceKey: upcoming.distanceKey,
      otherDistance:
        upcoming.distanceKey === "other"
          ? String(Math.round(metersToDisplayDistance(upcoming.distance, unitSystem) * 100) / 100)
          : "",
      time: upcoming.goalTime ? formatRaceTime(upcoming.goalTime) : "",
      placing: "",
      priority: upcoming.priority ?? "",
      location: upcoming.location ?? "",
      notes: upcoming.notes ?? "",
      registration: upcoming.registration ?? "",
      registrationDeadline: dayInputValue(upcoming.registrationDeadline),
      bibNumber: upcoming.bibNumber ?? "",
      startTime: upcoming.startTime ?? "",
      wave: upcoming.wave ?? "",
      bibPickupLocation: upcoming.bibPickupLocation ?? "",
      bibPickupDay: dayInputValue(upcoming.bibPickupDay),
      bibPickupHours: upcoming.bibPickupHours ?? "",
      website: upcoming.website ?? ""
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
    notes: race.notes ?? "",
    ...NO_LOGISTICS
  };
}

/** Sections that open by themselves: on an edit, those with something in them. */
function initialSections(target: RaceEditorTarget, draft: RaceDraft): ReadonlySet<SectionId> {
  if (target.mode !== "editTarget") return new Set();
  const open = new Set<SectionId>();
  if (draft.registration || draft.registrationDeadline || draft.website) open.add("registration");
  if (draft.startTime || draft.wave || draft.bibNumber) open.add("raceDay");
  if (draft.bibPickupDay || draft.bibPickupHours || draft.bibPickupLocation) open.add("pickup");
  if (draft.notes) open.add("notes");
  if (!open.size) open.add("registration");
  return open;
}

function shortDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return formatDate(new Date(year, month - 1, day), { weekday: "short", day: "numeric", month: "short" });
}

function websiteHost(website: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

function FilledMark() {
  const label = t("Filled in by AI. Check it before saving.");
  return (
    <span className="race-filled-mark" title={label} role="img" aria-label={label}>
      <Sparkles size={12} aria-hidden="true" />
    </span>
  );
}

function Field({
  label,
  note,
  filled,
  wide,
  children
}: {
  label: string;
  note?: string;
  filled?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`race-field${wide ? " is-wide" : ""}${filled ? " is-filled" : ""}`}>
      <span>
        {label}
        {note ? <em>{note}</em> : null}
        {filled ? <FilledMark /> : null}
      </span>
      {children}
    </label>
  );
}

/** A short list of choices, all in view. Clicking the chosen one clears it when `clearable`. */
function ChoiceChips<T extends string>({
  label,
  note,
  filled,
  wide,
  value,
  options,
  clearable,
  showDots,
  onChange
}: {
  label: string;
  note?: string;
  filled?: boolean;
  wide?: boolean;
  value: T | "";
  options: readonly { value: T; label: string }[];
  clearable?: boolean;
  showDots?: boolean;
  onChange: (value: T | "") => void;
}) {
  const group = useId();
  return (
    <fieldset className={`race-choices${wide ? " is-wide" : ""}`}>
      <legend>
        {label}
        {note ? <em>{note}</em> : null}
        {filled ? <FilledMark /> : null}
      </legend>
      <div className="race-choices-row">
        {options.map((option) => (
          <label
            key={option.value}
            className={`race-choice${value === option.value ? " is-on" : ""}`}
            data-distance={showDots ? option.value : undefined}
          >
            <input
              type="radio"
              name={group}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              onClick={() => {
                if (clearable && value === option.value) onChange("");
              }}
            />
            {showDots ? <i aria-hidden="true" /> : null}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FoldedSection({
  title,
  summary,
  hint,
  filled,
  open,
  onToggle,
  children
}: {
  title: string;
  /** What's in the section, shown while it's folded. */
  summary: string;
  /** What belongs there, shown while it's empty. */
  hint: string;
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className={`race-section${open ? " is-open" : ""}`}>
      <button type="button" className="race-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <ChevronRight size={15} aria-hidden="true" />
        <strong>{title}</strong>
        <span className={summary ? "race-section-summary" : "race-section-summary is-empty"}>{open ? "" : summary || hint}</span>
        {filled ? <FilledMark /> : null}
      </button>
      {open ? <div id={bodyId} className="race-section-body">{children}</div> : null}
    </div>
  );
}

export function RaceEditorDialog({
  target,
  busy,
  error,
  lookup,
  onClose,
  onSave,
  onAdd,
  onAddTarget,
  onUpdateTarget,
  onRemove,
  onRemoveTarget
}: RaceEditorDialogProps) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [draft, setDraft] = useState<RaceDraft | null>(null);
  const [localError, setLocalError] = useState<LocalizableText | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sections, setSections] = useState<ReadonlySet<SectionId>>(new Set());
  const [filled, setFilled] = useState<ReadonlySet<RaceLookupField>>(NO_FIELDS);
  const [previous, setPrevious] = useState<Partial<Record<RaceLookupField, string>>>({});
  /** False while a past race's distance is still the default, so Upcoming can start it blank. */
  const distanceChosen = useRef(false);
  /** Set once the athlete types anything: a stray click on the backdrop must not lose it. */
  const touched = useRef(false);

  const editingUpcoming = target?.mode === "editTarget" ? target.upcoming : null;
  const upcoming = editingUpcoming !== null || (target?.mode === "add" && draft?.kind === "upcoming");

  const otherDistanceText = (meters: number) => String(Math.round(metersToDisplayDistance(meters, unitSystem) * 100) / 100);

  function fillFrom(candidate: RaceLookupCandidate, event: RaceLookupEvent | undefined) {
    if (!draft) return;
    const fill = applyRaceLookup(draft, candidate, event, filled, otherDistanceText);
    touched.current = true;
    setLocalError(null);
    setDraft(fill.draft);
    setFilled(fill.filled);
    // Filling again keeps the oldest value, so Undo returns to what the athlete had.
    setPrevious((current) => ({ ...fill.previous, ...current }));
    finder.setState({ phase: "found", candidate, event });
  }

  function chooseCandidate(candidate: RaceLookupCandidate) {
    if (!draft) return;
    fillFrom(candidate, preferredLookupEvent(candidate.events, draft, filled));
  }

  function handleLookupResult(result: RaceLookupResult) {
    const [only, ...others] = result.candidates;
    if (!only) finder.setState({ phase: "empty", message: result.message });
    else if (others.length) finder.setState({ phase: "choose", candidates: result.candidates });
    else chooseCandidate(only);
  }

  const finder = useRaceLookup(lookup, target !== null && upcoming, handleLookupResult);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      const next = draftFor(target, unitSystem);
      setDraft(next);
      setLocalError(null);
      setConfirmRemove(false);
      setSections(initialSections(target, next));
      setFilled(NO_FIELDS);
      setPrevious({});
      finder.setState({ phase: "idle" });
      distanceChosen.current = target.mode !== "add";
      touched.current = false;
      if (!dialog.open) dialog.showModal();
      // The form stays mounted between openings, so autoFocus alone only works once.
      requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>(".race-field input")?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `finder.setState` is stable.
  }, [target, unitSystem]);

  const race = target?.mode === "edit" ? target.race : null;
  const recorded = race !== null && race.source !== "manual";
  const update = (patch: Partial<RaceDraft>) => {
    touched.current = true;
    setLocalError(null);
    setDraft((current) => (current ? { ...current, ...patch } : current));
    // Once the athlete changes a field it's theirs: no mark, and Undo leaves it.
    setFilled((current) => {
      const keys = Object.keys(patch) as RaceLookupField[];
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });
  };
  const today = todayInputValue();

  function openSection(section: SectionId) {
    setSections((current) => new Set(current).add(section));
  }

  function toggleSection(section: SectionId) {
    setSections((current) => {
      const next = new Set(current);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  }

  function chooseDistance(distanceKey: RaceDraft["distanceKey"]) {
    distanceChosen.current = true;
    update({ distanceKey });
  }

  function startSearch() {
    if (!draft) return;
    const query = draft.name.trim();
    if (!query) {
      finder.setState({ phase: "needsName" });
      dialogRef.current?.querySelector<HTMLInputElement>(".race-finder input")?.focus();
      return;
    }
    const chosenDistance = draft.distanceKey && draft.distanceKey !== "other" && !filled.has("distanceKey")
      ? raceDistanceLabel(draft.distanceKey)
      : undefined;
    void finder.search({
      query,
      ...(draft.date && !filled.has("date") ? { raceDay: draft.date } : {}),
      ...(chosenDistance ? { distanceLabel: chosenDistance } : {}),
      ...(draft.location.trim() && !filled.has("location") ? { location: draft.location.trim() } : {})
    });
  }

  function undoFill() {
    if (!draft) return;
    const restored = undoRaceLookup(draft, filled, previous);
    setDraft(restored.draft);
    setFilled(restored.filled);
    setPrevious({});
    finder.setState({ phase: "idle" });
  }

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

    if (target.mode === "editTarget" || (target.mode === "add" && draft.kind === "upcoming")) {
      if (!draft.name.trim()) return setLocalError(localizedText(() => t("Enter the race name.")));
      if (!draft.date) return setLocalError(localizedText(() => t("Enter the race date.")));
      if (draft.date < todayInputValue()) {
        return setLocalError(localizedText(() => t("An upcoming race needs a date from today on. Choose Past race to log a race you've run.")));
      }
      if (!draft.distanceKey) return setLocalError(localizedText(() => t("Choose the race distance.")));
      if (draft.distanceKey === "other" && otherDistance === undefined) {
        return setLocalError(localizedText(() => t("Enter the race distance in {{p0}}.", { p0: String(distanceUnit(unitSystem)) })));
      }
      if (draft.registrationDeadline && draft.registrationDeadline > draft.date) {
        openSection("registration");
        return setLocalError(localizedText(() => t("The registration deadline is after race day.")));
      }
      if (draft.bibPickupDay && draft.bibPickupDay > draft.date) {
        openSection("pickup");
        return setLocalError(localizedText(() => t("Bib pickup is after race day.")));
      }
      const input: RaceTargetInput = {
        name: draft.name,
        raceDay: draft.date,
        distanceKey: draft.distanceKey,
        distance: otherDistance,
        goalTime: time,
        priority: draft.priority || undefined,
        location: draft.location,
        notes: draft.notes,
        registration: draft.registration || undefined,
        registrationDeadline: draft.registrationDeadline,
        bibNumber: draft.bibNumber,
        startTime: draft.startTime,
        wave: draft.wave,
        bibPickupLocation: draft.bibPickupLocation,
        bibPickupDay: draft.bibPickupDay,
        bibPickupHours: draft.bibPickupHours,
        website: draft.website
      };
      const saved = target.mode === "editTarget"
        ? await onUpdateTarget({ ...input, targetId: target.upcoming.targetId })
        : await onAddTarget(input);
      if (saved) onClose();
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
      if (!draft.distanceKey) return setLocalError(localizedText(() => t("Choose the race distance.")));
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

    if (target.mode !== "edit") return;
    const input: RaceEditInput = {
      raceId: target.race.raceId,
      name: draft.name.trim() ? draft.name : null,
      officialTime: time ?? null,
      placing: draft.placing.trim() ? draft.placing : null,
      notes: draft.notes.trim() ? draft.notes : null
    };
    if (draft.distanceKey && draft.distanceKey !== target.race.distanceKey) input.distanceKey = draft.distanceKey;
    if (draft.distanceKey === "other") input.officialDistance = otherDistance ?? null;
    if (!recorded && time === undefined) return setLocalError(localizedText(() => t("Enter your finish time.")));
    if (await onSave(input)) onClose();
  }

  const shownError = localError ?? error;
  const recordedTime = race?.recordedTime;
  const distanceOptions: { value: RaceDistanceKey; label: string }[] = [
    ...RACE_DISTANCES.map((distance) => ({ value: distance.key, label: t(distance.label) })),
    { value: "other", label: t("Other distance") }
  ];

  const distanceFields = draft ? (
    <>
      <ChoiceChips
        wide
        label={t("Distance")}
        filled={filled.has("distanceKey")}
        value={draft.distanceKey}
        options={distanceOptions}
        showDots
        onChange={chooseDistance}
      />
      {draft.distanceKey === "other" ? (
        <Field label={t("Course length ({{p0}})", { p0: String(distanceUnit(unitSystem)) })} filled={filled.has("otherDistance")}>
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
        </Field>
      ) : null}
    </>
  ) : null;

  const courseMeters = (() => {
    if (!draft?.distanceKey) return undefined;
    if (draft.distanceKey !== "other") return raceDistanceMeters(draft.distanceKey);
    const value = Number(draft.otherDistance.replace(",", "."));
    return draft.otherDistance.trim() && Number.isFinite(value) && value > 0 ? displayDistanceToMeters(value, unitSystem) : undefined;
  })();
  const goalSeconds = draft?.time.trim() ? parseRaceTime(draft.time) : undefined;
  const goalPace = goalSeconds && courseMeters ? formatPaceValue(goalSeconds / (courseMeters / 1000), unitSystem) : undefined;

  const registrationLabel = RACE_REGISTRATIONS.find((option) => option.key === draft?.registration)?.label;
  const summaries: Record<SectionId, string> = draft ? {
    registration: [
      registrationLabel ? t(registrationLabel) : undefined,
      draft.registrationDeadline ? t("Closes {{p0}}", { p0: shortDay(draft.registrationDeadline) }) : undefined,
      draft.website.trim() ? websiteHost(draft.website.trim()) : undefined
    ].filter(Boolean).join(" · "),
    raceDay: [
      draft.startTime ? formatRaceStartTime(draft.startTime) : undefined,
      draft.wave.trim() || undefined,
      draft.bibNumber.trim() ? t("Bib {{p0}}", { p0: draft.bibNumber.trim() }) : undefined
    ].filter(Boolean).join(" · "),
    pickup: [
      draft.bibPickupDay ? shortDay(draft.bibPickupDay) : undefined,
      draft.bibPickupHours.trim() || undefined,
      draft.bibPickupLocation.trim() || undefined
    ].filter(Boolean).join(" · "),
    notes: draft.notes.trim()
  } : { registration: "", raceDay: "", pickup: "", notes: "" };
  const sectionFilled = (section: SectionId) => SECTION_FIELDS[section].some((field) => filled.has(field));

  return (
    <dialog
      ref={dialogRef}
      className={`race-editor${upcoming ? " is-upcoming" : ""}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !touched.current) onClose();
      }}
    >
      {draft && target ? (
        <form className="race-editor-surface" onSubmit={(event) => void submit(event)} noValidate>
          <header className="race-editor-head">
            <div className="race-editor-heading">
              <p className="race-eyebrow">{upcoming ? t("Up next") : target.mode === "add" ? t("Race journal") : t("Race result")}</p>
              <h2 id={headingId}>
                {editingUpcoming
                  ? t("Edit upcoming race")
                  : upcoming ? t("Add an upcoming race") : target.mode === "add" ? t("Add a race") : t("Edit race")}
              </h2>
            </div>
            {target.mode === "add" ? (
              <div className="race-kind-switch" role="group" aria-label={t("Race type")}>
                <button
                  type="button"
                  aria-pressed={!upcoming}
                  title={t("Log a result")}
                  onClick={() => {
                    setLocalError(null);
                    distanceChosen.current ||= Boolean(draft.distanceKey && draft.distanceKey !== "5k");
                    setDraft({ ...draft, kind: "result", date: draft.date || today, distanceKey: draft.distanceKey || "5k" });
                  }}
                >
                  {t("Past race")}
                </button>
                <button
                  type="button"
                  aria-pressed={upcoming}
                  title={t("Plan your training")}
                  onClick={() => {
                    setLocalError(null);
                    setDraft({
                      ...draft,
                      kind: "upcoming",
                      // Today and earlier were only the past-race default.
                      date: draft.date <= today ? "" : draft.date,
                      distanceKey: distanceChosen.current ? draft.distanceKey : ""
                    });
                  }}
                >
                  {t("Upcoming race")}
                </button>
              </div>
            ) : null}
            <button type="button" className="race-icon-button" aria-label={t("Close")} onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>

          <div className="race-editor-body">
            <div className="race-editor-main">
              {upcoming ? (
                <>
                  <RaceFinder
                    value={draft.name}
                    status={finder.status}
                    state={finder.state}
                    filledCount={[...filled].filter((field) => field !== "otherDistance").length}
                    canUndo={Object.keys(previous).length > 0}
                    enterSearches={
                      finder.status?.ready === true &&
                      finder.status.webSearch &&
                      target.mode === "add" &&
                      finder.state.phase !== "found" &&
                      finder.state.phase !== "searching"
                    }
                    placeholder={t("Valencia Marathon, or paste the race website")}
                    onChange={(name) => update({ name })}
                    onSearch={startSearch}
                    onStop={finder.stop}
                    onUndo={undoFill}
                    onDismiss={() => finder.setState({ phase: "idle" })}
                    onPickCandidate={chooseCandidate}
                    onPickEvent={(event) => {
                      if (finder.state.phase === "found") fillFrom(finder.state.candidate, event);
                    }}
                  />

                  <div className="race-editor-fields">
                    <Field label={t("Date")} filled={filled.has("date")}>
                      <input
                        type="date"
                        className={draft.date ? undefined : "is-blank"}
                        value={draft.date}
                        min={today}
                        onChange={(event) => update({ date: event.target.value })}
                      />
                    </Field>
                    <Field label={t("Location")} filled={filled.has("location")}>
                      <input
                        type="text"
                        value={draft.location}
                        maxLength={120}
                        placeholder={t("Valencia, Spain")}
                        onChange={(event) => update({ location: event.target.value })}
                      />
                    </Field>
                    {distanceFields}
                  </div>

                  <p className="race-field-section">{t("Your goal")}<em>{t("optional")}</em></p>
                  <div className="race-editor-fields race-editor-goal">
                    <Field label={t("Goal time")}>
                      <span className="race-time-input">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={draft.time}
                          placeholder={t("h:mm:ss")}
                          onChange={(event) => update({ time: event.target.value })}
                        />
                        {goalPace ? <small>{goalPace}</small> : null}
                      </span>
                    </Field>
                    <ChoiceChips
                      label={t("Priority")}
                      value={draft.priority}
                      options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: `${option.value} · ${t(option.label)}` }))}
                      clearable
                      onChange={(priority) => update({ priority })}
                    />
                  </div>

                  <p className="race-field-section">{t("More details")}<em>{t("optional")}</em></p>
                  <div className="race-sections">
                    <FoldedSection
                      title={t("Registration")}
                      summary={summaries.registration}
                      hint={t("Status, closing date, website")}
                      filled={sectionFilled("registration")}
                      open={sections.has("registration")}
                      onToggle={() => toggleSection("registration")}
                    >
                      <ChoiceChips
                        wide
                        label={t("Status")}
                        value={draft.registration}
                        options={RACE_REGISTRATIONS.map((option) => ({ value: option.key, label: t(option.label) }))}
                        clearable
                        onChange={(registration: RaceRegistration | "") => update({ registration })}
                      />
                      <Field label={t("Registration closes")} filled={filled.has("registrationDeadline")}>
                        <input
                          type="date"
                          className={draft.registrationDeadline ? undefined : "is-blank"}
                          value={draft.registrationDeadline}
                          max={draft.date || undefined}
                          onChange={(event) => update({ registrationDeadline: event.target.value })}
                        />
                      </Field>
                      <Field label={t("Race website")} filled={filled.has("website")}>
                        <input
                          type="url"
                          value={draft.website}
                          maxLength={500}
                          placeholder="valenciaciudaddelrunning.com"
                          onChange={(event) => update({ website: event.target.value })}
                        />
                      </Field>
                    </FoldedSection>

                    <FoldedSection
                      title={t("Race day")}
                      summary={summaries.raceDay}
                      hint={t("Start time, wave, bib number")}
                      filled={sectionFilled("raceDay")}
                      open={sections.has("raceDay")}
                      onToggle={() => toggleSection("raceDay")}
                    >
                      <Field label={t("Start time")} filled={filled.has("startTime")}>
                        <input
                          type="time"
                          className={draft.startTime ? undefined : "is-blank"}
                          value={draft.startTime}
                          onChange={(event) => update({ startTime: event.target.value })}
                        />
                      </Field>
                      <Field label={t("Bib number")}>
                        <input
                          type="text"
                          value={draft.bibNumber}
                          maxLength={20}
                          placeholder="4127"
                          onChange={(event) => update({ bibNumber: event.target.value })}
                        />
                      </Field>
                      <Field label={t("Wave or corral")} wide>
                        <input
                          type="text"
                          value={draft.wave}
                          maxLength={40}
                          placeholder={t("Wave 2 · Corral C")}
                          onChange={(event) => update({ wave: event.target.value })}
                        />
                      </Field>
                    </FoldedSection>

                    <FoldedSection
                      title={t("Bib pickup")}
                      summary={summaries.pickup}
                      hint={t("Day, hours, location")}
                      filled={sectionFilled("pickup")}
                      open={sections.has("pickup")}
                      onToggle={() => toggleSection("pickup")}
                    >
                      <Field label={t("Bib pickup day")} filled={filled.has("bibPickupDay")}>
                        <input
                          type="date"
                          className={draft.bibPickupDay ? undefined : "is-blank"}
                          value={draft.bibPickupDay}
                          max={draft.date || undefined}
                          onChange={(event) => update({ bibPickupDay: event.target.value })}
                        />
                      </Field>
                      <Field label={t("Pickup hours")} filled={filled.has("bibPickupHours")}>
                        <input
                          type="text"
                          value={draft.bibPickupHours}
                          maxLength={60}
                          placeholder="10:00–20:00"
                          onChange={(event) => update({ bibPickupHours: event.target.value })}
                        />
                      </Field>
                      <Field label={t("Bib pickup location")} filled={filled.has("bibPickupLocation")} wide>
                        <input
                          type="text"
                          value={draft.bibPickupLocation}
                          maxLength={160}
                          placeholder={t("Expo, City of Arts and Sciences")}
                          onChange={(event) => update({ bibPickupLocation: event.target.value })}
                        />
                      </Field>
                    </FoldedSection>

                    <FoldedSection
                      title={t("Notes")}
                      summary={summaries.notes}
                      hint={t("Goals, course, travel plans")}
                      filled={sectionFilled("notes")}
                      open={sections.has("notes")}
                      onToggle={() => toggleSection("notes")}
                    >
                      <Field label={t("Notes")} wide filled={filled.has("notes")}>
                        <textarea
                          rows={3}
                          value={draft.notes}
                          maxLength={2000}
                          placeholder={t("Goals, course, travel plans")}
                          onChange={(event) => update({ notes: event.target.value })}
                        />
                      </Field>
                    </FoldedSection>
                  </div>
                </>
              ) : (
                <div className="race-editor-fields">
                  <Field label={t("Race name")} wide>
                    <input
                      type="text"
                      value={draft.name}
                      maxLength={120}
                      placeholder={race?.activityName ?? t("Spring 10K")}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  {target.mode !== "edit" ? (
                    <Field label={t("Date")}>
                      <input
                        type="date"
                        className={draft.date ? undefined : "is-blank"}
                        value={draft.date}
                        onChange={(event) => update({ date: event.target.value })}
                      />
                    </Field>
                  ) : null}
                  <Field label={recorded ? t("Chip time") : t("Finish time")} wide={target.mode === "edit"}>
                    <span className="race-time-input">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.time}
                        placeholder={recorded && recordedTime ? formatRaceTime(recordedTime) : t("h:mm:ss")}
                        onChange={(event) => update({ time: event.target.value })}
                        aria-describedby={recorded ? `${headingId}-time-hint` : undefined}
                      />
                      {goalPace ? <small>{goalPace}</small> : null}
                    </span>
                  </Field>
                  {recorded ? (
                    <p className="race-field-hint is-wide" id={`${headingId}-time-hint`}>
                      {recordedTime
                        ? t("Leave blank to use the watch time ({{time}}).", { time: formatRaceTime(recordedTime) })
                        : t("Leave blank to use the watch time.")}{" "}
                      {t("Results use the official course distance, not the distance your watch measured.")}</p>
                  ) : null}
                  {distanceFields}
                  <Field label={t("Placing")} note={t("optional")} wide>
                    <input
                      type="text"
                      value={draft.placing}
                      maxLength={120}
                      placeholder={t("48th of 912 · 6th M30–34")}
                      onChange={(event) => update({ placing: event.target.value })}
                    />
                  </Field>
                  <Field label={t("Notes")} note={t("optional")} wide>
                    <textarea
                      rows={3}
                      value={draft.notes}
                      maxLength={2000}
                      placeholder={t("Weather, course, how it felt")}
                      onChange={(event) => update({ notes: event.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>

            {upcoming ? <RacePreview draft={draft} distanceMeters={courseMeters} unitSystem={unitSystem} /> : null}
          </div>

          <footer className="race-editor-foot">
            {shownError ? (
              <p className="race-editor-error" role="alert">
                {renderLocalizedText(shownError)}
              </p>
            ) : null}
            {editingUpcoming ? (
              <button
                type="button"
                className={`race-text-button is-danger${confirmRemove ? " is-confirming" : ""}`}
                disabled={busy}
                onClick={async () => {
                  if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                  }
                  if (await onRemoveTarget(editingUpcoming.targetId)) onClose();
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                {confirmRemove ? t("Remove from Up next?") : t("Remove race")}
              </button>
            ) : null}
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
            {upcoming && target.mode === "add" ? (
              <span className="race-editor-required">{t("Only the name, date and distance are needed.")}</span>
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
