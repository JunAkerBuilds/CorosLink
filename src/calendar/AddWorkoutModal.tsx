import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Mountain,
  Pencil,
  PersonStanding,
  Search,
  Waves,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ManualActivityInput,
  PlanWorkoutEntryInput,
  RunWorkoutStepInput,
  TrainingHubLibraryWorkout,
  TrainingHubSportType
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";
import { dateFromKey } from "./dateUtils";

type AddTab = "quick" | "library" | "builder" | "activity";

type UploadSport = ManualActivityInput["sport"];
type ActivityDistanceUnit = "km" | "m" | "none";

interface LogSportOption {
  id: string;
  label: string;
  uploadSport: UploadSport;
  distanceUnit: ActivityDistanceUnit;
  Icon: LucideIcon;
  sportType?: number;
}

const DEFAULT_LOG_SPORT_OPTION: LogSportOption = {
  id: "suggested-run",
  label: "Run",
  uploadSport: "run",
  distanceUnit: "km",
  Icon: Footprints
};

const SUGGESTED_LOG_SPORT_OPTIONS: LogSportOption[] = [
  DEFAULT_LOG_SPORT_OPTION,
  { id: "suggested-ride", label: "Ride", uploadSport: "bike", distanceUnit: "km", Icon: Bike },
  { id: "suggested-walk", label: "Walk", uploadSport: "other", distanceUnit: "km", Icon: Footprints },
  { id: "suggested-hike", label: "Hike", uploadSport: "other", distanceUnit: "km", Icon: Mountain },
  { id: "suggested-swim", label: "Swim", uploadSport: "other", distanceUnit: "m", Icon: Waves },
  { id: "suggested-strength", label: "Strength", uploadSport: "other", distanceUnit: "none", Icon: Dumbbell },
  { id: "suggested-yoga", label: "Yoga", uploadSport: "other", distanceUnit: "none", Icon: PersonStanding },
  { id: "suggested-other", label: "Other", uploadSport: "other", distanceUnit: "none", Icon: Activity }
];

const RUN_TERMS = ["run", "running", "treadmill", "trail run", "track"];
const BIKE_TERMS = ["bike", "biking", "bicycle", "cycle", "cycling", "ride", "mtb", "gravel"];
const SWIM_TERMS = ["swim", "swimming"];
const WALK_TERMS = ["walk", "walking"];
const HIKE_TERMS = ["hike", "hiking", "trek", "trail"];
const ROW_TERMS = ["row", "rowing"];
const SKI_TERMS = ["ski", "skiing", "snowboard", "skate", "skating"];
const PADDLE_TERMS = ["kayak", "canoe", "paddle", "sup"];
const STATIONARY_TERMS = [
  "strength",
  "gym",
  "weight",
  "weights",
  "yoga",
  "pilates",
  "stretch",
  "mobility",
  "meditation",
  "cardio",
  "indoor",
  "fitness"
];

function normalizeSportLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesSportTerm(label: string, terms: string[]): boolean {
  return terms.some((term) => label.includes(term));
}

function inferUploadSport(label: string): UploadSport {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return "bike";
  }
  if (includesSportTerm(normalized, RUN_TERMS)) {
    return "run";
  }
  return "other";
}

function inferDistanceUnit(label: string): ActivityDistanceUnit {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return "m";
  }
  if (
    includesSportTerm(normalized, [
      ...RUN_TERMS,
      ...BIKE_TERMS,
      ...WALK_TERMS,
      ...HIKE_TERMS,
      ...ROW_TERMS,
      ...SKI_TERMS,
      ...PADDLE_TERMS
    ])
  ) {
    return "km";
  }
  if (includesSportTerm(normalized, STATIONARY_TERMS)) {
    return "none";
  }
  return "none";
}

function inferSportIcon(label: string): LucideIcon {
  const normalized = normalizeSportLabel(label);
  if (includesSportTerm(normalized, SWIM_TERMS)) {
    return Waves;
  }
  if (includesSportTerm(normalized, BIKE_TERMS)) {
    return Bike;
  }
  if (includesSportTerm(normalized, ["strength", "gym", "weight", "weights"])) {
    return Dumbbell;
  }
  if (includesSportTerm(normalized, ["yoga", "pilates", "stretch", "mobility"])) {
    return PersonStanding;
  }
  if (includesSportTerm(normalized, [...RUN_TERMS, ...WALK_TERMS])) {
    return Footprints;
  }
  if (includesSportTerm(normalized, HIKE_TERMS)) {
    return Mountain;
  }
  return Activity;
}

function createCorosLogSportOption(sportType: TrainingHubSportType): LogSportOption {
  const label = sportType.sportName.trim() || `Sport ${sportType.sportType}`;
  return {
    id: `coros-${sportType.sportType}-${normalizeSportLabel(label).replace(/[^a-z0-9]+/g, "-")}`,
    label,
    uploadSport: inferUploadSport(label),
    distanceUnit: inferDistanceUnit(label),
    Icon: inferSportIcon(label),
    sportType: sportType.sportType
  };
}

function describeLogSportOption(option: LogSportOption): string {
  if (option.distanceUnit === "m") {
    return "meters";
  }
  if (option.distanceUnit === "km") {
    return "distance";
  }
  return "time only";
}

type BuilderKind = "warmup" | "training" | "intervals" | "cooldown";

interface BuilderRow {
  id: number;
  kind: BuilderKind;
  targetType: "distance" | "time";
  distanceKm: string;
  timeMin: string;
  pace: string;
  // intervals only
  repeats: string;
  restMin: string;
}

interface AddWorkoutModalProps {
  api: CorosLinkApi;
  dateKey: string;
  sportTypes: TrainingHubSportType[];
  onClose: () => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
  onEditLibrary: (programId: string) => void;
}

let builderRowId = 0;

function emptyRow(kind: BuilderKind): BuilderRow {
  builderRowId += 1;
  return {
    id: builderRowId,
    kind,
    targetType: "distance",
    distanceKm: "",
    timeMin: "",
    pace: "",
    repeats: "4",
    restMin: "2"
  };
}

function rowToSteps(row: BuilderRow): RunWorkoutStepInput[] {
  const target =
    row.targetType === "distance"
      ? { target_distance_meters: Math.round(Number(row.distanceKm) * 1000) }
      : { target_duration_seconds: Math.round(Number(row.timeMin) * 60) };
  const pace = row.pace.trim() ? { pace: row.pace.trim() } : {};

  if (row.kind === "intervals") {
    return [
      {
        repeat: Math.max(1, Math.round(Number(row.repeats) || 1)),
        steps: [
          { kind: "interval", ...target, ...pace },
          {
            kind: "rest",
            target_duration_seconds: Math.max(
              10,
              Math.round(Number(row.restMin || "1") * 60)
            )
          }
        ]
      }
    ];
  }

  return [{ kind: row.kind, ...target, ...pace }];
}

function rowIsValid(row: BuilderRow): boolean {
  const value = row.targetType === "distance" ? row.distanceKm : row.timeMin;
  if (!(Number(value) > 0)) {
    return false;
  }
  if (row.kind === "intervals" && !(Number(row.repeats) > 0)) {
    return false;
  }
  return true;
}

export function AddWorkoutModal({
  api,
  dateKey,
  sportTypes,
  onClose,
  onScheduled,
  onError,
  onEditLibrary
}: AddWorkoutModalProps) {
  const todayKey = getLocalHappenDayKey();
  // Logging makes no sense for a day that hasn't happened yet, and COROS
  // rejects scheduling in the past — so each side of "today" gets the
  // tab set (and default tab) that can actually succeed.
  const canLogActivity = dateKey <= todayKey;
  const canSchedule = dateKey >= todayKey;
  const [tab, setTab] = useState<AddTab>(canSchedule ? "quick" : "activity");
  const [submitting, setSubmitting] = useState(false);

  // Quick training
  const [quickName, setQuickName] = useState("");
  const [quickDistanceKm, setQuickDistanceKm] = useState("");
  const [quickPace, setQuickPace] = useState("");
  const [quickSave, setQuickSave] = useState(false);

  // Library
  const [library, setLibrary] = useState<TrainingHubLibraryWorkout[] | null>(null);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  // Log activity
  const [activitySportId, setActivitySportId] = useState(DEFAULT_LOG_SPORT_OPTION.id);
  const [activitySportSearch, setActivitySportSearch] = useState("");
  const [activityTime, setActivityTime] = useState(() =>
    dateKey === todayKey
      ? new Date(Date.now() - 3_600_000).toTimeString().slice(0, 5)
      : "12:00"
  );
  const [activityHours, setActivityHours] = useState("");
  const [activityMinutes, setActivityMinutes] = useState("");
  const [activityDistance, setActivityDistance] = useState("");
  const [activityCalories, setActivityCalories] = useState("");
  const [activityAvgHr, setActivityAvgHr] = useState("");

  // Builder
  const [builderName, setBuilderName] = useState("");
  const [builderSave, setBuilderSave] = useState(true);
  const [rows, setRows] = useState<BuilderRow[]>([
    emptyRow("warmup"),
    emptyRow("training"),
    emptyRow("cooldown")
  ]);

  useEffect(() => {
    if (tab !== "library" || library !== null) {
      return;
    }
    void api
      .listLibraryWorkouts()
      .then(setLibrary)
      .catch((cause: unknown) => {
        setLibrary([]);
        onError(cause instanceof Error ? cause.message : String(cause));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredLibrary = useMemo(() => {
    const query = libraryFilter.trim().toLowerCase();
    const items = library ?? [];
    if (!query) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [library, libraryFilter]);

  const corosSportOptions = useMemo(() => {
    const seen = new Set<string>();
    return sportTypes
      .map(createCorosLogSportOption)
      .filter((option) => {
        const key = normalizeSportLabel(option.label);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [sportTypes]);

  // One catalog: curated options first (stable defaults), then every COROS
  // sport type that doesn't duplicate a curated label.
  const combinedSportOptions = useMemo(() => {
    const seen = new Set<string>();
    const combined: LogSportOption[] = [];
    for (const option of [...SUGGESTED_LOG_SPORT_OPTIONS, ...corosSportOptions]) {
      const key = normalizeSportLabel(option.label);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push(option);
    }
    return combined;
  }, [corosSportOptions]);

  const selectedActivitySport =
    combinedSportOptions.find((option) => option.id === activitySportId) ??
    DEFAULT_LOG_SPORT_OPTION;

  const visibleSportOptions = useMemo(() => {
    const query = normalizeSportLabel(activitySportSearch);
    if (query) {
      return combinedSportOptions
        .filter((option) => normalizeSportLabel(option.label).includes(query))
        .slice(0, 12);
    }

    const defaults = combinedSportOptions.slice(
      0,
      SUGGESTED_LOG_SPORT_OPTIONS.length
    );
    // Keep a selection made through search visible after the query is cleared.
    if (!defaults.some((option) => option.id === selectedActivitySport.id)) {
      return [selectedActivitySport, ...defaults];
    }
    return defaults;
  }, [activitySportSearch, combinedSportOptions, selectedActivitySport]);

  const showActivityDistance = selectedActivitySport.distanceUnit !== "none";
  const activityDistanceLabel =
    selectedActivitySport.distanceUnit === "m" ? "Distance (m)" : "Distance (km)";
  const activityDistancePlaceholder =
    selectedActivitySport.distanceUnit === "m" ? "1500" : "0";

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setSubmitting(true);
    try {
      await action();
      onScheduled(successMessage);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuick = () =>
    run(async () => {
      const name = quickName.trim() || "Quick Run";
      const distanceKm = Number(quickDistanceKm);
      const entry: PlanWorkoutEntryInput = quickPace.trim()
        ? {
            key: "calendar-quick",
            name,
            steps: [
              {
                kind: "training",
                target_distance_meters: Math.round(distanceKm * 1000),
                pace: quickPace.trim()
              }
            ]
          }
        : { key: "calendar-quick", name, distance_km: distanceKm };
      await api.createAndScheduleWorkout(entry, dateKey, quickSave);
    }, `Scheduled "${quickName.trim() || "Quick Run"}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitLibrary = () =>
    run(async () => {
      if (!selectedProgramId) {
        throw new Error("Pick a workout from your library first.");
      }
      await api.scheduleLibraryWorkout(selectedProgramId, dateKey);
    }, `Workout scheduled on ${formatHappenDayLabel(dateKey)}.`);

  const submitBuilder = () =>
    run(async () => {
      const entry: PlanWorkoutEntryInput = {
        key: "calendar-builder",
        name: builderName.trim() || "Structured Workout",
        steps: rows.flatMap(rowToSteps)
      };
      await api.createAndScheduleWorkout(entry, dateKey, builderSave);
    }, `Scheduled "${builderName.trim() || "Structured Workout"}" on ${formatHappenDayLabel(dateKey)}.`);

  const submitActivity = () =>
    run(async () => {
      const [hourPart, minutePart] = activityTime.split(":").map(Number);
      const start = dateFromKey(dateKey);
      start.setHours(hourPart || 0, minutePart || 0, 0, 0);
      const durationSec = Math.round(
        (Number(activityHours) || 0) * 3600 + (Number(activityMinutes) || 0) * 60
      );
      const calories = Number(activityCalories);
      const avgHr = Number(activityAvgHr);
      const distanceM =
        selectedActivitySport.distanceUnit === "m"
          ? Math.round(Number(activityDistance) || 0)
          : selectedActivitySport.distanceUnit === "km"
            ? Math.round((Number(activityDistance) || 0) * 1000)
            : 0;
      const input: ManualActivityInput = {
        sport: selectedActivitySport.uploadSport,
        startTimeIso: start.toISOString(),
        durationSec,
        distanceM,
        ...(calories > 0 ? { calories } : {}),
        ...(avgHr > 0 ? { avgHr } : {})
      };
      await api.addManualActivityToCoros(input);
    }, `Activity logged on ${formatHappenDayLabel(dateKey)}. COROS may take a moment to show it.`);

  const quickValid = Number(quickDistanceKm) > 0;
  const builderValid = rows.length > 0 && rows.every(rowIsValid);
  const activityValid =
    activityTime.trim() !== "" &&
    (Number(activityHours) || 0) * 60 + (Number(activityMinutes) || 0) > 0;

  return (
    <AnimatePresence>
      <motion.div
        className="calendar-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="calendar-modal panel"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="calendar-modal-header">
            <div>
              <p className="eyebrow">{formatHappenDayLabel(dateKey)}</p>
              <h3>Add to calendar</h3>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="calendar-modal-tabs">
            {(
              [
                // COROS rejects scheduling in the past, and a future activity
                // can't be logged — only offer tabs that can succeed.
                ...(canSchedule
                  ? ([
                      ["quick", "Quick training"],
                      ["library", "From library"],
                      ["builder", "Structured"]
                    ] as const)
                  : []),
                ...(canLogActivity ? ([["activity", "Log activity"]] as const) : [])
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`calendar-modal-tab ${tab === id ? "is-active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "quick" ? (
            <div className="calendar-modal-body">
              <label className="calendar-field">
                <span>Name</span>
                <input
                  type="text"
                  value={quickName}
                  onChange={(event) => setQuickName(event.target.value)}
                  placeholder="Easy Run"
                />
              </label>
              <div className="calendar-field-row">
                <label className="calendar-field">
                  <span>Distance (km)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={quickDistanceKm}
                    onChange={(event) => setQuickDistanceKm(event.target.value)}
                    placeholder="8"
                  />
                </label>
                <label className="calendar-field">
                  <span>Pace (optional)</span>
                  <input
                    type="text"
                    value={quickPace}
                    onChange={(event) => setQuickPace(event.target.value)}
                    placeholder="5:30/km"
                  />
                </label>
              </div>
              <label className="calendar-check">
                <input
                  type="checkbox"
                  checked={quickSave}
                  onChange={(event) => setQuickSave(event.target.checked)}
                />
                Also save to workout library
              </label>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!quickValid || submitting}
                  onClick={() => void submitQuick()}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "library" ? (
            <div className="calendar-modal-body">
              <label className="calendar-field">
                <span>Search</span>
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(event) => setLibraryFilter(event.target.value)}
                  placeholder="Filter workouts…"
                />
              </label>
              <div className="calendar-library-list">
                {library === null ? (
                  <p className="calendar-detail-empty">Loading library…</p>
                ) : filteredLibrary.length === 0 ? (
                  <p className="calendar-detail-empty">No workouts in your library.</p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div key={item.id} className={`calendar-library-item-row ${selectedProgramId === item.id ? "is-selected" : ""}`}>
                      <button
                        type="button"
                        className="calendar-library-item"
                        onClick={() => setSelectedProgramId(item.id)}
                      >
                        <span className="calendar-chip-name">{item.name}</span>
                        <span className="calendar-chip-meta">
                          {[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null]
                            .filter(Boolean)
                            .join(" · ") || "No calculated totals"}
                        </span>
                      </button>
                      {item.sportType === 1 ? (
                        <button type="button" className="ghost-button calendar-library-edit" onClick={() => onEditLibrary(item.id)}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </button>
                      ) : (
                        <span className="calendar-library-readonly">View only</span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedProgramId || submitting}
                  onClick={() => void submitLibrary()}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "builder" ? (
            <div className="calendar-modal-body">
              <label className="calendar-field">
                <span>Name</span>
                <input
                  type="text"
                  value={builderName}
                  onChange={(event) => setBuilderName(event.target.value)}
                  placeholder="6 × 800m"
                />
              </label>
              <div className="calendar-builder-rows">
                {rows.map((row, index) => (
                  <div key={row.id} className="calendar-builder-row">
                    <select
                      value={row.kind}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, kind: event.target.value as BuilderKind }
                              : candidate
                          )
                        )
                      }
                    >
                      <option value="warmup">Warm up</option>
                      <option value="training">Run</option>
                      <option value="intervals">Intervals</option>
                      <option value="cooldown">Cool down</option>
                    </select>
                    {row.kind === "intervals" ? (
                      <input
                        type="number"
                        min="1"
                        className="calendar-builder-repeats"
                        value={row.repeats}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id
                                ? { ...candidate, repeats: event.target.value }
                                : candidate
                            )
                          )
                        }
                        title="Repeats"
                      />
                    ) : null}
                    <select
                      value={row.targetType}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.id === row.id
                              ? {
                                  ...candidate,
                                  targetType: event.target.value as "distance" | "time"
                                }
                              : candidate
                          )
                        )
                      }
                    >
                      <option value="distance">km</option>
                      <option value="time">min</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step={row.targetType === "distance" ? "0.1" : "1"}
                      value={row.targetType === "distance" ? row.distanceKm : row.timeMin}
                      placeholder={row.targetType === "distance" ? "0.8" : "10"}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.id === row.id
                              ? row.targetType === "distance"
                                ? { ...candidate, distanceKm: event.target.value }
                                : { ...candidate, timeMin: event.target.value }
                              : candidate
                          )
                        )
                      }
                    />
                    <input
                      type="text"
                      value={row.pace}
                      placeholder="pace 4:30/km"
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.id === row.id
                              ? { ...candidate, pace: event.target.value }
                              : candidate
                          )
                        )
                      }
                    />
                    {row.kind === "intervals" ? (
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        className="calendar-builder-rest"
                        value={row.restMin}
                        placeholder="rest min"
                        title="Rest between repeats (minutes)"
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id
                                ? { ...candidate, restMin: event.target.value }
                                : candidate
                            )
                          )
                        }
                      />
                    ) : null}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((candidate) => candidate.id !== row.id)
                        )
                      }
                      disabled={rows.length === 1}
                      aria-label={`Remove step ${index + 1}`}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="ghost-button calendar-builder-add"
                onClick={() => setRows((current) => [...current, emptyRow("training")])}
              >
                + Add step
              </button>
              <label className="calendar-check">
                <input
                  type="checkbox"
                  checked={builderSave}
                  onChange={(event) => setBuilderSave(event.target.checked)}
                />
                Also save to workout library
              </label>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!builderValid || submitting}
                  onClick={() => void submitBuilder()}
                >
                  {submitting ? "Scheduling…" : "Schedule"}
                </button>
              </footer>
            </div>
          ) : null}

          {tab === "activity" ? (
            <div className="calendar-modal-body">
              <div
                className="calendar-activity-sport-picker"
                role="group"
                aria-label="Activity type"
              >
                <label className="calendar-field calendar-sport-search">
                  <span>Activity type</span>
                  <span className="calendar-sport-search-control">
                    <Search size={14} aria-hidden="true" />
                    <input
                      type="text"
                      value={activitySportSearch}
                      onChange={(event) => setActivitySportSearch(event.target.value)}
                      placeholder="Search activity types"
                      disabled={submitting}
                    />
                  </span>
                </label>

                {visibleSportOptions.length === 0 ? (
                  <p className="calendar-activity-hint">
                    No activity types match that search.
                  </p>
                ) : (
                  <div className="calendar-sport-grid">
                    {visibleSportOptions.map((option) => {
                      const Icon = option.Icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selectedActivitySport.id === option.id}
                          className={`calendar-sport-card ${selectedActivitySport.id === option.id ? "is-active" : ""}`}
                          onClick={() => setActivitySportId(option.id)}
                          disabled={submitting}
                          title={describeLogSportOption(option)}
                        >
                          <Icon size={14} aria-hidden="true" />
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="calendar-field-row">
                <label className="calendar-field">
                  <span>Start time</span>
                  <input
                    type="time"
                    value={activityTime}
                    onChange={(event) => setActivityTime(event.target.value)}
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Hours</span>
                  <input
                    type="number"
                    min="0"
                    value={activityHours}
                    onChange={(event) => setActivityHours(event.target.value)}
                    placeholder="0"
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={activityMinutes}
                    onChange={(event) => setActivityMinutes(event.target.value)}
                    placeholder="45"
                    disabled={submitting}
                  />
                </label>
              </div>
              <div className="calendar-field-row">
                {showActivityDistance ? (
                  <label className="calendar-field">
                    <span>{activityDistanceLabel}</span>
                    <input
                      type="number"
                      min="0"
                      step={selectedActivitySport.distanceUnit === "m" ? "1" : "0.01"}
                      value={activityDistance}
                      onChange={(event) => setActivityDistance(event.target.value)}
                      placeholder={activityDistancePlaceholder}
                      disabled={submitting}
                    />
                  </label>
                ) : null}
                <label className="calendar-field">
                  <span>Calories (optional)</span>
                  <input
                    type="number"
                    min="0"
                    value={activityCalories}
                    onChange={(event) => setActivityCalories(event.target.value)}
                    placeholder="450"
                    disabled={submitting}
                  />
                </label>
                <label className="calendar-field">
                  <span>Avg HR (optional)</span>
                  <input
                    type="number"
                    min="0"
                    value={activityAvgHr}
                    onChange={(event) => setActivityAvgHr(event.target.value)}
                    placeholder="145"
                    disabled={submitting}
                  />
                </label>
              </div>
              <p className="calendar-activity-hint">
                Logs an activity that wasn&apos;t recorded by a device straight to
                your COROS account.
              </p>
              <footer className="calendar-modal-footer">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!activityValid || submitting}
                  onClick={() => void submitActivity()}
                >
                  {submitting ? "Adding…" : "Add to COROS"}
                </button>
              </footer>
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
