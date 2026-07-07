import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  TrainingHubActivityDetail,
  TrainingHubSportType
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityDetailPanel } from "../training/components/ActivityDetailPanel";
import {
  formatHappenDayLabel,
  formatUpcomingWorkoutLoad,
  formatUpcomingWorkoutVolumeDisplay,
  inferUpcomingWorkoutCategory
} from "../training/formatters";
import type { CalendarSelection } from "./calendarTypes";

interface DayDetailPanelProps {
  api: CorosLinkApi;
  selection: CalendarSelection | null;
  sportTypes: TrainingHubSportType[];
  deleting: boolean;
  onClose: () => void;
  onDelete: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
  onAskCoach: (selection: CalendarSelection) => void;
  onError: (message: string | null) => void;
}

export function DayDetailPanel({
  api,
  selection,
  sportTypes,
  deleting,
  onClose,
  onDelete,
  onAskCoach,
  onError
}: DayDetailPanelProps) {
  const [detail, setDetail] = useState<TrainingHubActivityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activity = selection?.kind === "activity" ? selection.activity : null;

  useEffect(() => {
    setConfirmDelete(false);
    setDetail(null);
    if (!activity) {
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void api
      .getTrainingHubActivityDetail(activity.activityId, activity.sportType, activity)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.activityId]);

  return (
    <AnimatePresence>
      {selection ? (
        <>
          <motion.div
            className="calendar-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="calendar-detail-panel"
            initial={{ x: "104%" }}
            animate={{ x: 0 }}
            exit={{ x: "104%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <header className="calendar-detail-header">
              <div>
                <p className="eyebrow">
                  {formatHappenDayLabel(
                    selection.kind === "scheduled"
                      ? selection.entry.happenDay
                      : selection.day.dateKey
                  )}
                </p>
                <h3>
                  {selection.kind === "scheduled"
                    ? selection.entry.name
                    : selection.activity.name ??
                      selection.activity.sportName ??
                      "Activity"}
                </h3>
              </div>
              <div className="calendar-detail-actions">
                <button
                  type="button"
                  className="ghost-button calendar-detail-action"
                  onClick={() => onAskCoach(selection)}
                  title="Ask Coach"
                >
                  <MessageCircle size={15} aria-hidden="true" />
                  Ask Coach
                </button>
                {selection.kind === "scheduled" && !selection.day.isPast ? (
                  <button
                    type="button"
                    className={`ghost-button calendar-detail-action calendar-detail-delete ${confirmDelete ? "is-armed" : ""}`}
                    disabled={deleting}
                    onClick={() => {
                      if (confirmDelete) {
                        onDelete(selection);
                      } else {
                        setConfirmDelete(true);
                      }
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {deleting
                      ? "Removing…"
                      : confirmDelete
                        ? "Confirm remove"
                        : "Remove"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost-button calendar-detail-action"
                  onClick={onClose}
                  aria-label="Close details"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="calendar-detail-body">
              {selection.kind === "scheduled" ? (
                <ScheduledDetail selection={selection} />
              ) : (
                <ActivityDetailPanel
                  embedded
                  detail={detail}
                  listActivity={selection.activity}
                  sportTypes={sportTypes}
                  busy={loadingDetail ? "Loading activity…" : null}
                />
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function ScheduledDetail({
  selection
}: {
  selection: Extract<CalendarSelection, { kind: "scheduled" }>;
}) {
  const { entry } = selection;
  const category = inferUpcomingWorkoutCategory(entry.name);

  return (
    <div className="calendar-detail-scheduled">
      <div className="calendar-detail-stats">
        <div className="calendar-detail-stat">
          <span>Type</span>
          <strong>{category}</strong>
        </div>
        <div className="calendar-detail-stat">
          <span>Volume</span>
          <strong>{formatUpcomingWorkoutVolumeDisplay(entry.volume)}</strong>
        </div>
        <div className="calendar-detail-stat">
          <span>Planned Load</span>
          <strong>{formatUpcomingWorkoutLoad(entry.trainingLoad)}</strong>
        </div>
      </div>

      {entry.exercises && entry.exercises.length > 0 ? (
        <div className="calendar-detail-steps">
          <h4>Structure</h4>
          <ol>
            {entry.exercises.map((exercise, index) => (
              <li key={`${exercise.name}-${index}`}>
                <span className="calendar-detail-step-name">{exercise.name}</span>
                <span className="calendar-detail-step-target">
                  {[
                    exercise.sets && exercise.sets > 1 ? `${exercise.sets}×` : null,
                    exercise.targetLabel
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="calendar-detail-empty">
          No structured steps — this workout runs by feel.
        </p>
      )}
    </div>
  );
}
