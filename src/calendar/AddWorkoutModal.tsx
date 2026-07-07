import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PlanWorkoutEntryInput,
  TrainingHubLibraryWorkout
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel } from "../training/formatters";

type AddTab = "quick" | "library" | "builder";

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
  onClose: () => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
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

function rowToSteps(row: BuilderRow): unknown[] {
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
  onClose,
  onScheduled,
  onError
}: AddWorkoutModalProps) {
  const [tab, setTab] = useState<AddTab>("quick");
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

  const quickValid = Number(quickDistanceKm) > 0;
  const builderValid = rows.length > 0 && rows.every(rowIsValid);

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
                ["quick", "Quick training"],
                ["library", "From library"],
                ["builder", "Structured"]
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
                    <button
                      key={item.id}
                      type="button"
                      className={`calendar-library-item ${selectedProgramId === item.id ? "is-selected" : ""}`}
                      onClick={() => setSelectedProgramId(item.id)}
                    >
                      <span className="calendar-chip-name">{item.name}</span>
                      <span className="calendar-chip-meta">
                        {[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </button>
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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
