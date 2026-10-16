import type { StrengthEditPreview } from "../../electron/workoutEditTypes";
import type {
  ActivityVisualPreview,
  ChatMessage,
  ChatMessageAttachment,
  CoachCorosActionPreview,
  CoachChartPreview,
  CoachInputPrompt,
  FitnessTrendPreview,
  HrZonePreview,
  PersistedChatEntry,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  TrainingPlanDestination,
  UploadPlanResult,
  WorkoutDeletePreview,
  WorkoutSport
} from "../../electron/types";

/** Where an assistant answer's data came from, for the source indicator. */
export interface SourceInfo {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

export interface ChatMessageEntry {
  kind: "message";
  role: ChatMessage["role"];
  content: string;
  attachment?: ChatMessageAttachment;
  source?: SourceInfo;
  reasoningSummary?: string;
}

/** Text dropped into the Coach composer from elsewhere in the app. */
export interface CoachPrefill {
  text: string;
  attachment?: ChatMessageAttachment;
}

export interface ChatPlanDraftEntry {
  kind: "planDraft";
  draft: PlanDraftPreview;
}

export interface ChatCoachPromptEntry {
  kind: "coachPrompt";
  prompt: CoachInputPrompt;
}

export interface ChatWorkoutDeleteEntry {
  kind: "workoutDelete";
  preview: WorkoutDeletePreview;
}

export interface ChatActivityVisualEntry {
  kind: "activityVisual";
  preview: ActivityVisualPreview;
}

export interface ChatFitnessTrendEntry {
  kind: "fitnessTrend";
  preview: FitnessTrendPreview;
}

export interface ChatHrZoneEntry {
  kind: "hrZoneSummary";
  preview: HrZonePreview;
}

export interface ChatCoachChartEntry {
  kind: "coachChart";
  preview: CoachChartPreview;
}

export interface ChatToolNoticeEntry {
  kind: "toolNotice";
  message: string;
}

export type ChatEntry =
  | { kind: "workoutEdit"; preview: StrengthEditPreview }
  | { kind: "corosAction"; preview: CoachCorosActionPreview }
  | ChatMessageEntry
  | ChatCoachPromptEntry
  | ChatPlanDraftEntry
  | ChatWorkoutDeleteEntry
  | ChatActivityVisualEntry
  | ChatFitnessTrendEntry
  | ChatHrZoneEntry
  | ChatCoachChartEntry
  | ChatToolNoticeEntry;

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

/**
 * Automatic visuals that the "show charts" setting can hide. Coach charts are
 * excluded on purpose: the athlete asked for them explicitly.
 */
export function isChatVisualEntry(
  entry: ChatEntry
): entry is ChatActivityVisualEntry | ChatFitnessTrendEntry | ChatHrZoneEntry {
  return (
    entry.kind === "activityVisual" ||
    entry.kind === "fitnessTrend" ||
    entry.kind === "hrZoneSummary"
  );
}

export function upsertPlanDraftEntry(
  entries: ChatEntry[],
  draft: PlanDraftPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "planDraft" && entry.draft.draftId === draft.draftId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "planDraft", draft };
    return next;
  }
  return [...entries, { kind: "planDraft", draft }];
}

export function upsertCoachPromptEntry(
  entries: ChatEntry[],
  prompt: CoachInputPrompt
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "coachPrompt" && entry.prompt.promptId === prompt.promptId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "coachPrompt", prompt };
    return next;
  }
  return [...entries, { kind: "coachPrompt", prompt }];
}

export function upsertCorosActionEntry(entries: ChatEntry[], preview: CoachCorosActionPreview): ChatEntry[] {
  const index = entries.findIndex(entry => entry.kind === "corosAction" && entry.preview.requestId === preview.requestId);
  if (index < 0) return [...entries, { kind: "corosAction", preview }];
  return entries.map((entry, i) => i === index ? { kind: "corosAction", preview } : entry);
}

export function upsertWorkoutDeleteEntry(
  entries: ChatEntry[],
  preview: WorkoutDeletePreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "workoutDelete" &&
      entry.preview.requestId === preview.requestId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "workoutDelete", preview };
    return next;
  }
  return [...entries, { kind: "workoutDelete", preview }];
}

export function upsertActivityVisualEntry(
  entries: ChatEntry[],
  preview: ActivityVisualPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "activityVisual" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "activityVisual", preview };
    return next;
  }
  return [...entries, { kind: "activityVisual", preview }];
}

export function upsertFitnessTrendEntry(
  entries: ChatEntry[],
  preview: FitnessTrendPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "fitnessTrend" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "fitnessTrend", preview };
    return next;
  }
  return [...entries, { kind: "fitnessTrend", preview }];
}

export function upsertHrZoneEntry(
  entries: ChatEntry[],
  preview: HrZonePreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "hrZoneSummary" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "hrZoneSummary", preview };
    return next;
  }
  return [...entries, { kind: "hrZoneSummary", preview }];
}

export function upsertCoachChartEntry(
  entries: ChatEntry[],
  preview: CoachChartPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "coachChart" &&
      entry.preview.previewId === preview.previewId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "coachChart", preview };
    return next;
  }
  return [...entries, { kind: "coachChart", preview }];
}

export function toWireMessages(entries: ChatEntry[]): ChatMessage[] {
  return entries.flatMap((entry): ChatMessage[] => {
    if (entry.kind === "message") {
      return [{
        role: entry.role,
        content: entry.attachment
          ? `${entry.content}\n\n${entry.attachment.content}`
          : entry.content
      }];
    }
    if (entry.kind === "workoutEdit") return [{ role: "assistant", content: `Strength edit proposal ${entry.preview.proposalId}. Last recorded state: ${entry.preview.state}. Call get_workout_edit_status for current results; never assume it was saved.` }];
    if (entry.kind === "corosAction") {
      const { state, summary, destination, date, message } = entry.preview;
      const fallback = {
        pending: "Awaiting the athlete's Save to COROS button.",
        saving: "Save is in progress. Do not submit another copy.",
        saved: "COROS accepted the change.",
        uncertain: "Save status is uncertain. Check COROS before preparing another copy."
      }[state];
      return [{ role: "assistant", content: `COROS action ${state}: ${summary}. Destination: ${destination}${date ? ` on ${date}` : ""}. ${message ?? fallback}` }];
    }
    if (entry.kind === "coachPrompt") {
      const choices = entry.prompt.choices
        .map((choice) => `- ${choice.label}`)
        .join("\n");
      const promptMessage: ChatMessage =
        {
          role: "assistant",
          content: `I need the athlete's answer before continuing:\n${entry.prompt.question}\n${choices}`
        };
      return entry.prompt.answer
        ? [
            promptMessage,
            { role: "user", content: entry.prompt.answer }
          ]
        : [promptMessage];
    }
    return [];
  });
}

function persistVisualEntry(entry: ChatEntry): PersistedChatEntry | null {
  if (entry.kind === "workoutEdit" || entry.kind === "corosAction") return entry;
  if (entry.kind === "coachPrompt") {
    return { kind: "coachPrompt", prompt: entry.prompt };
  }
  if (entry.kind === "planDraft") {
    return { kind: "planDraft", draft: entry.draft };
  }
  if (entry.kind === "workoutDelete") {
    return { kind: "workoutDelete", preview: entry.preview };
  }
  if (entry.kind === "activityVisual") {
    return { kind: "activityVisual", preview: entry.preview };
  }
  if (entry.kind === "fitnessTrend") {
    return { kind: "fitnessTrend", preview: entry.preview };
  }
  if (entry.kind === "hrZoneSummary") {
    return { kind: "hrZoneSummary", preview: entry.preview };
  }
  if (entry.kind === "coachChart") {
    return { kind: "coachChart", preview: entry.preview };
  }
  if (entry.kind === "toolNotice") {
    return {
      kind: "message",
      role: "assistant",
      content: entry.message
    };
  }
  if (entry.kind === "message") {
    return {
      kind: "message",
      role: entry.role,
      content: entry.content,
      ...(entry.attachment ? { attachment: entry.attachment } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.reasoningSummary
        ? { reasoningSummary: entry.reasoningSummary }
        : {})
    };
  }
  return null;
}

export function toPersistedEntries(entries: ChatEntry[]): PersistedChatEntry[] {
  return entries
    .map((entry) => persistVisualEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

export function fromPersistedEntries(entries: PersistedChatEntry[]): ChatEntry[] {
  const result: ChatEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "workoutEdit" || entry.kind === "corosAction") { result.push(entry); continue; }
    if (entry.kind === "coachPrompt") {
      result.push({ kind: "coachPrompt", prompt: entry.prompt });
      continue;
    }
    if (entry.kind === "planDraft") {
      result.push({ kind: "planDraft", draft: entry.draft });
      continue;
    }
    if (entry.kind === "workoutDelete") {
      result.push({ kind: "workoutDelete", preview: entry.preview });
      continue;
    }
    if (entry.kind === "activityVisual") {
      result.push({ kind: "activityVisual", preview: entry.preview });
      continue;
    }
    if (entry.kind === "activityHrTrend") {
      result.push({
        kind: "activityVisual",
        preview: {
          previewId: entry.preview.previewId,
          activityId: entry.preview.activityId,
          name: entry.preview.name,
          startTime: entry.preview.startTime,
          avgHr: entry.preview.avgHr,
          maxHr: entry.preview.maxHr,
          sections: {
            hr: {
              chartKind: entry.preview.chartKind,
              series: entry.preview.series,
              laps: entry.preview.laps
            }
          }
        }
      });
      continue;
    }
    if (entry.kind === "fitnessTrend") {
      result.push({ kind: "fitnessTrend", preview: entry.preview });
      continue;
    }
    if (entry.kind === "hrZoneSummary") {
      result.push({ kind: "hrZoneSummary", preview: entry.preview });
      continue;
    }
    if (entry.kind === "coachChart") {
      result.push({ kind: "coachChart", preview: entry.preview });
      continue;
    }
    result.push({
      kind: "message",
      role: entry.role,
      content: entry.content,
      ...(entry.attachment ? { attachment: entry.attachment } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.reasoningSummary
        ? { reasoningSummary: entry.reasoningSummary }
        : {})
    });
  }

  return result;
}
