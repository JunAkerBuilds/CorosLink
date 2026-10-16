import type {
  ChatMessageAttachment,
  CoachCorosActionPreview,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  TrainingPlanDestination,
  UploadPlanResult,
  WorkoutSport
} from "../../electron/types";
import type { ChatEntry } from "../../electron/chatTranscript.ts";

// The timeline types and helpers live with the Coach hub in the main process,
// which builds and saves the transcript; the renderer only renders it.
export {
  chatEntryKey,
  findChatEntryIndex,
  fromPersistedEntries,
  isChatVisualEntry,
  toPersistedEntries,
  toWireMessages,
  upsertActivityVisualEntry,
  upsertChatEntry,
  upsertCoachChartEntry,
  upsertCoachPromptEntry,
  upsertCorosActionEntry,
  upsertFitnessTrendEntry,
  upsertHrZoneEntry,
  upsertPlanDraftEntry,
  upsertWorkoutDeleteEntry,
  upsertWorkoutEditEntry
} from "../../electron/chatTranscript.ts";
export type {
  ChatActivityVisualEntry,
  ChatCoachChartEntry,
  ChatCoachPromptEntry,
  ChatCorosActionEntry,
  ChatEntry,
  ChatFitnessTrendEntry,
  ChatHrZoneEntry,
  ChatMessageEntry,
  ChatPlanDraftEntry,
  ChatToolNoticeEntry,
  ChatWorkoutDeleteEntry,
  ChatWorkoutEditEntry,
  SourceInfo
} from "../../electron/chatTranscript.ts";

/** Text dropped into the Coach composer from elsewhere in the app. */
export interface CoachPrefill {
  text: string;
  attachment?: ChatMessageAttachment;
}

/** Where a coach creation lands once saved, named as COROS names it. */
export type CoachCreationDestination = CoachCorosActionPreview["destination"];

/** Local drafts are "draft" until uploaded; COROS actions carry their own state. */
export type CoachCreationStatus = "draft" | CoachCorosActionPreview["state"];

interface CoachCreationBase {
  /** Unique across both authoring routes (draft ids and request ids are prefixed). */
  id: string;
  /** The draft's name, or the COROS action's title ("Review workout"). */
  title: string;
  /** The coach's one-line description of the item. */
  summary: string;
  artifact: "plan" | "workout";
  /** Sport of the first workout, for the list icon. */
  sport?: WorkoutSport;
  destination?: CoachCreationDestination;
  /** First scheduled day as YYYY-MM-DD, when the item has one. */
  date?: string;
  status: CoachCreationStatus;
}

/**
 * One reviewable thing the coach prepared, whichever route authored it: a
 * local draft (draft_workout / draft_training_plan) or an official COROS MCP
 * write awaiting "Save to COROS". The Coach creations panel lists these.
 */
export type CoachCreation =
  | (CoachCreationBase & {
      kind: "planDraft";
      status: "draft" | "saved";
      draft: PlanDraftPreview;
    })
  | (CoachCreationBase & {
      kind: "corosAction";
      status: CoachCorosActionPreview["state"];
      destination: CoachCreationDestination;
      preview: CoachCorosActionPreview;
    });

const DRAFT_UPLOAD_DESTINATION: Partial<
  Record<TrainingPlanDestination, CoachCreationDestination>
> = {
  workoutLibrary: "Workout Library",
  calendar: "Calendar",
  nativePlan: "Training Plan",
  nativePlanAndCalendar: "Training Plan"
};

/** Turns a COROS YYYYMMDD date into YYYY-MM-DD; other shapes pass through. */
export function isoDateFromCompact(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

export function planEntryScheduleDate(
  entry: PlanDraftPreviewEntry
): string | undefined {
  if (entry.scheduleDate) return entry.scheduleDate;
  const sourceDate = entry.source?.schedule_date;
  if (!sourceDate || !/^\d{8}$/.test(sourceDate)) return undefined;
  return isoDateFromCompact(sourceDate);
}

/**
 * Everything reviewable the coach has prepared in a conversation, in timeline
 * order. `uploaded` holds this session's upload results for drafts saved after
 * the history was loaded, which the draft itself doesn't know about yet.
 */
export function listCoachCreations(
  entries: ChatEntry[],
  uploaded: Record<string, UploadPlanResult | undefined> = {}
): CoachCreation[] {
  const creations: CoachCreation[] = [];
  for (const entry of entries) {
    if (entry.kind === "planDraft") {
      const { draft } = entry;
      const artifact = draft.artifactType === "workout" ? "workout" : "plan";
      const upload = uploaded[draft.draftId];
      const uploadDestination = upload?.destination ?? draft.uploadResult?.destination;
      const date = draft.entries
        .map(planEntryScheduleDate)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
      creations.push({
        kind: "planDraft",
        id: `draft:${draft.draftId}`,
        title: draft.name,
        summary: draft.summary,
        artifact,
        sport: draft.entries[0]?.sport,
        destination:
          artifact === "workout"
            ? "Workout Library"
            : uploadDestination
              ? DRAFT_UPLOAD_DESTINATION[uploadDestination]
              : undefined,
        ...(date ? { date } : {}),
        status: upload || draft.uploadResult || draft.uploadedAt ? "saved" : "draft",
        draft
      });
    } else if (entry.kind === "corosAction") {
      const { preview } = entry;
      const date = isoDateFromCompact(preview.date);
      creations.push({
        kind: "corosAction",
        id: `coros:${preview.requestId}`,
        title: preview.title,
        summary: preview.summary,
        artifact: preview.destination === "Training Plan" ? "plan" : "workout",
        ...(preview.sport ? { sport: preview.sport } : {}),
        destination: preview.destination,
        ...(date ? { date } : {}),
        status: preview.state,
        preview
      });
    }
  }
  return creations;
}
