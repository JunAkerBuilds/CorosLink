import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarPlus, Library, LoaderCircle, Pencil, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TrainingHubLibraryWorkout, WorkoutEditRef } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatHappenDayLabel, getLocalHappenDayKey } from "../training/formatters";

interface WorkoutLibraryModalProps {
  api: CorosLinkApi;
  onClose: () => void;
  onEdit: (ref: WorkoutEditRef) => void;
  onScheduled: (message: string) => void;
  onError: (message: string | null) => void;
}

function keyToInputDate(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

function inputDateToKey(value: string): string {
  return value.replace(/-/g, "");
}

export function WorkoutLibraryModal({ api, onClose, onEdit, onScheduled, onError }: WorkoutLibraryModalProps) {
  const reducedMotion = useReducedMotion();
  const today = getLocalHappenDayKey();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = `${tomorrowDate.getFullYear()}${String(tomorrowDate.getMonth() + 1).padStart(2, "0")}${String(tomorrowDate.getDate()).padStart(2, "0")}`;
  const [items, setItems] = useState<TrainingHubLibraryWorkout[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState(keyToInputDate(tomorrow));
  const [scheduling, setScheduling] = useState(false);

  const load = () => {
    setItems(null);
    setError(null);
    void api.listLibraryWorkouts().then(setItems).catch((cause: unknown) => {
      setItems([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  useEffect(() => {
    setItems(null);
    setError(null);
    let cancelled = false;
    void api.listLibraryWorkouts().then((result) => {
      if (!cancelled) setItems(result);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setItems([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => { cancelled = true; };
  }, [api]);

  const visible = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return (items ?? []).filter((item) => !filter || item.name.toLowerCase().includes(filter));
  }, [items, query]);

  const schedule = async () => {
    if (!selected) return;
    const happenDay = inputDateToKey(date);
    if (happenDay <= today) {
      onError("Choose a future date.");
      return;
    }
    setScheduling(true);
    try {
      await api.scheduleLibraryWorkout(selected, happenDay);
      const workout = items?.find((item) => item.id === selected);
      onScheduled(`Scheduled "${workout?.name ?? "Workout"}" on ${formatHappenDayLabel(happenDay)}.`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScheduling(false);
    }
  };

  return <AnimatePresence>
    <motion.div className="calendar-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="calendar-modal calendar-library-modal" role="dialog" aria-modal="true" aria-labelledby="library-manager-title" initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
        <header className="calendar-modal-header">
          <div><p className="eyebrow">COROS Training Hub</p><h2 id="library-manager-title">Workout Library</h2></div>
          <button type="button" className="icon-button" aria-label="Close workout library" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="calendar-modal-body">
          <label className="calendar-field calendar-library-search"><span>Search workouts</span><span className="calendar-sport-search-control"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" /></span></label>
          <div className="workout-library-manager-list">
            {items === null ? <div className="workout-library-state"><LoaderCircle className="is-spinning" size={20} aria-hidden="true" /><p>Loading your COROS workout library...</p></div> : error ? <div className="workout-library-state"><p>{error}</p><button type="button" className="ghost-button" onClick={load}>Try again</button></div> : visible.length === 0 ? <div className="workout-library-state"><Library size={24} aria-hidden="true" /><p>{query ? "No workouts match your search." : "Your workout library is empty."}</p></div> : visible.map((item) => {
              const supported = item.sportType === 1;
              return <article key={item.id} className={`workout-library-row ${selected === item.id ? "is-selected" : ""}`}>
                <button type="button" className="workout-library-select" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span><strong>{item.name}</strong><small>{[item.volume, item.trainingLoad !== undefined ? `${Math.round(item.trainingLoad)} TL` : null].filter(Boolean).join(" · ") || "No calculated totals"}</small></span>
                  <span className={`workout-library-sport ${supported ? "is-run" : ""}`}>{supported ? "Run" : "View only"}</span>
                </button>
                {supported ? <button type="button" className="ghost-button workout-library-edit" onClick={() => onEdit({ kind: "library", programId: item.id })}><Pencil size={14} aria-hidden="true" /> Edit</button> : <span className="workout-library-readonly">Editing is not supported for this sport.</span>}
              </article>;
            })}
          </div>
        </div>
        <footer className="calendar-modal-footer workout-library-footer">
          <label className="calendar-field"><span>Schedule selected workout</span><input type="date" min={keyToInputDate(tomorrow)} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <button type="button" className="primary-button" disabled={!selected || !date || scheduling} onClick={() => void schedule()}>{scheduling ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <CalendarPlus size={15} aria-hidden="true" />}{scheduling ? "Scheduling..." : "Schedule"}</button>
        </footer>
      </motion.section>
    </motion.div>
  </AnimatePresence>;
}
