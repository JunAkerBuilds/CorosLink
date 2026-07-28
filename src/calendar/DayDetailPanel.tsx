import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  TrainingHubActivityDetail,
  TrainingHubSportType
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityDetailPanel } from "../training/components/ActivityDetailPanel";
import { formatHappenDayLabel } from "../training/formatters";
import type { CalendarSelection } from "./calendarTypes";
import { ScheduledWorkoutDetail } from "./ScheduledWorkoutDetail";

interface DayDetailPanelProps {
  api: CorosLinkApi;
  selection: CalendarSelection | null;
  sportTypes: TrainingHubSportType[];
  deleting: boolean;
  onClose: () => void;
  onDelete: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
  onAskCoach: (selection: CalendarSelection) => void;
  onEdit: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
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
  onEdit,
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
                    className="ghost-button calendar-detail-action"
                    disabled={!selection.entry.sportType || selection.entry.sportType < 1 || selection.entry.sportType > 9}
                    onClick={() => onEdit(selection)}
                    title={selection.entry.sportType && selection.entry.sportType >= 1 && selection.entry.sportType <= 9 ? "Edit this scheduled occurrence" : "This COROS sport is not supported by the workout editor"}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    Edit
                  </button>
                ) : null}
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
                <ScheduledWorkoutDetail
                  entry={selection.entry}
                  sportTypes={sportTypes}
                />
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
