import { useLanguage, t } from "../i18n/training";
// The export status line is the app-wide one, translated in the core catalog.
import { t as coreT } from "../i18n";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, MessageCircle, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type TrainingHubActivity,
  type TrainingHubActivityDetail,
  type TrainingHubActivityFileType,
  type TrainingHubSportType
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ActivityDetailPanel } from "../training/components/ActivityDetailPanel";
import { ActivityTitleEditor } from "../training/components/ActivityTitleEditor";
import { ActivityDetailDialog } from "../training/components/TrainingActivities";
import { useRaceJournal } from "../training/useRaceJournal";
import { runViewMorph } from "../viewMorph";
import { formatHappenDayLabel } from "../training/formatters";
import type { CalendarSelection } from "./calendarTypes";
import { ScheduledWorkoutDetail } from "./ScheduledWorkoutDetail";
import { CalendarEventEditor } from "./CalendarEventEditor";
import type { CalendarWorkoutEvent } from "../../electron/calendarSyncTypes";
import type { WorkoutJournalEntry, WorkoutJournalRef } from "../../electron/workoutJournalTypes";
import { findJournalEntry } from "../../electron/workoutJournalModel";
import { journalRefForSelection } from "./journalRefs";
import { WorkoutJournal } from "./WorkoutJournal";
import "./activityPageMorph.css";

/** Set on <html> while the aside morphs into the full activity page or back. */
const ACTIVITY_PAGE_MORPH = "is-activity-page-morph";

interface DayDetailPanelProps {
  api: CorosLinkApi;
  selection: CalendarSelection | null;
  sportTypes: TrainingHubSportType[];
  deleting: boolean;
  userId?: string;
  onEventSaved: (event: CalendarWorkoutEvent) => void;
  onClose: () => void;
  onDelete: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
  onAskCoach: (selection: CalendarSelection) => void;
  onEdit: (selection: Extract<CalendarSelection, { kind: "scheduled" }>) => void;
  onError: (message: string | null) => void;
  /** Status line for the full page's Export action. */
  onMessage?: (message: string | null) => void;
  journal?: WorkoutJournalEntry[];
  onJournalSaved?: (entry: WorkoutJournalEntry | null, ref: WorkoutJournalRef) => void;
  onAskCoachBrief?: (selection: CalendarSelection) => void;
  /** Renames a completed activity; resolves to the saved name. */
  onRenameActivity?: (activity: TrainingHubActivity, name: string) => Promise<string>;
}
export function DayDetailPanel({
  api,
  selection,
  sportTypes,
  deleting,
  userId,
  onEventSaved,
  onClose,
  onDelete,
  onAskCoach,
  onEdit,
  onError,
  onMessage,
  journal,
  onJournalSaved,
  onAskCoachBrief,
  onRenameActivity
}: DayDetailPanelProps) {
  useLanguage();
  const [detail, setDetail] = useState<TrainingHubActivityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The aside can grow into the full activity page; closing that page shrinks it back.
  const [expanded, setExpanded] = useState(false);
  const [detailRequest, setDetailRequest] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const asideScrollTop = useRef(0);

  const activity = selection?.kind === "activity" ? selection.activity : null;
  const journalRef = useMemo(() => (selection ? journalRefForSelection(selection) : null), [selection]);
  const journalEntry = journalRef && journal ? findJournalEntry(journal, journalRef) : undefined;

  // A retry reloads the detail but keeps the page open.
  useEffect(() => {
    setConfirmDelete(false);
    setExpanded(false);
  }, [selection?.kind === "activity" ? selection.activity.activityId : selection]);

  useEffect(() => {
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
  }, [activity?.activityId, detailRequest]);

  // The full page is only for a recorded activity; a closed panel takes it down too.
  const pageOpen = expanded && activity !== null;
  // The page is the Activities tab's own, so it gets the same race toggle and export.
  const raceJournal = useRaceJournal(api, { enabled: pageOpen, sampleMode: false, refreshKey: activity?.activityId });
  const exportFile = async (exported: TrainingHubActivity, fileType: TrainingHubActivityFileType) => {
    const format = TRAINING_HUB_EXPORT_FORMATS.find((item) => item.fileType === fileType);
    setExporting(`training-file:${exported.activityId}:${fileType}`);
    onError(null);
    onMessage?.(null);
    try {
      const result = await api.exportTrainingHubActivityFile(exported.activityId, exported.sportType, fileType, exported.name);
      if (result.saved) {
        onMessage?.(coreT("Saved {{value0}} file to {{value1}}.", { value0: format?.label ?? coreT("activity"), value1: result.filePath ?? "" }));
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(null);
    }
  };
  // While the page is up the aside leaves rendering (see activityPageMorph.css), which drops
  // its scroll position, so it is carried across by hand.
  const asideBody = () => asideRef.current?.querySelector<HTMLElement>(".calendar-detail-body");
  const openPage = () => {
    asideScrollTop.current = asideBody()?.scrollTop ?? 0;
    runViewMorph(ACTIVITY_PAGE_MORPH, () => setExpanded(true));
  };
  const closePage = () =>
    runViewMorph(ACTIVITY_PAGE_MORPH, () => setExpanded(false), {
      after: () => {
        const body = asideBody();
        if (body) body.scrollTop = asideScrollTop.current;
      }
    });

  return (
    <>
      <AnimatePresence>
        {selection ? (
          <>
            <motion.div
              className={`calendar-detail-backdrop${pageOpen ? " is-behind-page" : ""}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              ref={asideRef}
              className={`calendar-detail-panel${pageOpen ? " is-expanded" : ""}`}
              aria-hidden={pageOpen || undefined}
              initial={{ x: "104%" }}
              animate={{ x: 0 }}
              exit={{ x: "104%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              <header className="calendar-detail-header">
                <div className="calendar-detail-heading">
                  <p className="eyebrow">
                    {formatHappenDayLabel(
                      selection.kind === "scheduled"
                        ? selection.entry.happenDay
                        : selection.day.dateKey
                    )}
                  </p>
                  {selection.kind === "scheduled" ? (
                    <h3>{selection.entry.name}</h3>
                  ) : (
                    <ActivityTitleEditor
                      key={selection.activity.activityId}
                      as="h3"
                      name={selection.activity.name}
                      title={
                        selection.activity.name ||
                        (selection.activity.sportName ? t(String(selection.activity.sportName)) : undefined) ||
                        t("Activity")
                      }
                      onRename={onRenameActivity ? async (name) => {
                        const renamed = selection.activity;
                        const saved = await onRenameActivity(renamed, name);
                        setDetail((current) =>
                          current?.activityId === renamed.activityId ? { ...current, name: saved } : current
                        );
                      } : undefined}
                    />
                  )}
                </div>
                <div className="calendar-detail-actions">
                  {selection.kind === "activity" ? (
                    <button
                      type="button"
                      className="ghost-button calendar-detail-action"
                      onClick={openPage}
                      title={t("Open the full activity page")}
                      aria-label={t("Open the full activity page")}
                    >
                      <Maximize2 size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button calendar-detail-action"
                    onClick={() => onAskCoach(selection)}
                    title={t("Ask Coach")}
                  >
                    <MessageCircle size={15} aria-hidden="true" />
                    {t("Ask Coach")} </button>
                  {selection.kind === "scheduled" && !selection.day.isPast ? (
                    <button
                      type="button"
                      className="ghost-button calendar-detail-action"
                      disabled={!selection.entry.sportType || selection.entry.sportType < 1 || selection.entry.sportType > 9}
                      onClick={() => onEdit(selection)}
                      title={selection.entry.sportType && selection.entry.sportType >= 1 && selection.entry.sportType <= 9 ? t("Edit this scheduled occurrence") : t("This COROS sport is not supported by the workout editor")}
                    >
                      <Pencil size={15} aria-hidden="true" />
                      {t("Edit")} </button>
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
                        ? t("Removing…")
                        : confirmDelete
                          ? t("Confirm remove")
                          : t("Remove")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button calendar-detail-action"
                    onClick={onClose}
                    aria-label={t("Close details")}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <div className="calendar-detail-body">
                {selection.kind === "scheduled" && userId ? <CalendarEventEditor
                  key={JSON.stringify([userId, selection.entry.planId, selection.entry.idInPlan, selection.entry.happenDay])}
                  api={api}
                  eventRef={{ userId, planId: selection.entry.planId, idInPlan: selection.entry.idInPlan, happenDay: selection.entry.happenDay }}
                  disabled={deleting}
                  onSaved={onEventSaved}
                /> : null}
                {journalRef && userId ? (
                  <WorkoutJournal
                    key={JSON.stringify([userId, journalRef.planId, journalRef.idInPlan, journalRef.activityId])}
                    api={api}
                    workoutRef={journalRef}
                    entry={journalEntry}
                    canBrief={Boolean(journalRef.planId)}
                    canDebrief={selection.kind === "activity" || selection.day.isPast || selection.day.isToday}
                    onSaved={(entry, ref) => onJournalSaved?.(entry, ref)}
                    onAskCoachBrief={onAskCoachBrief ? () => onAskCoachBrief(selection) : undefined}
                  />
                ) : null}
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
      <ActivityDetailDialog
        className="calendar-activity-page"
        opened={pageOpen ? activity : null}
        activityDetail={detail}
        sportTypes={sportTypes}
        busy={exporting ?? (loadingDetail && activity ? `training-detail:${activity.activityId}` : null)}
        resolveLocation={api.reverseGeocodeRouteLocation}
        raceTags={raceJournal}
        onExportFile={(exported, fileType) => void exportFile(exported, fileType)}
        onLoadDetail={() => setDetailRequest((count) => count + 1)}
        onRename={onRenameActivity ? async (renamed, name) => {
          const saved = await onRenameActivity(renamed, name);
          setDetail((current) =>
            current?.activityId === renamed.activityId ? { ...current, name: saved } : current
          );
        } : undefined}
        onClose={closePage}
      />
    </>
  );
}
