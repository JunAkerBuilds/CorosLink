// The Coach timeline as both processes see it. The main process (CoachSessionHub)
// builds and saves it; the renderer only renders it, through src/chat/chatTypes.ts.
// Type-only imports keep this file loadable by Node's strip-types tests.
import type { StrengthEditPreview } from "./workoutEditTypes";
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
  PersistedChatSource,
  PlanDraftPreview,
  WorkoutDeletePreview
} from "./types";

/** Where an assistant answer's data came from, for the source indicator. */
export type SourceInfo = PersistedChatSource;

export interface ChatMessageEntry {
  kind: "message";
  role: ChatMessage["role"];
  content: string;
  attachment?: ChatMessageAttachment;
  source?: SourceInfo;
  reasoningSummary?: string;
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

export interface ChatWorkoutEditEntry {
  kind: "workoutEdit";
  preview: StrengthEditPreview;
}

export interface ChatCorosActionEntry {
  kind: "corosAction";
  preview: CoachCorosActionPreview;
}

export type ChatEntry =
  | ChatWorkoutEditEntry
  | ChatCorosActionEntry
  | ChatMessageEntry
  | ChatCoachPromptEntry
  | ChatPlanDraftEntry
  | ChatWorkoutDeleteEntry
  | ChatActivityVisualEntry
  | ChatFitnessTrendEntry
  | ChatHrZoneEntry
  | ChatCoachChartEntry
  | ChatToolNoticeEntry;

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

/**
 * The identity an entry keeps when it is updated in place: a card's own id,
 * or undefined for messages and notices, which are only ever appended.
 */
export function chatEntryKey(entry: ChatEntry): string | undefined {
  switch (entry.kind) {
    case "planDraft":
      return `planDraft:${entry.draft.draftId}`;
    case "coachPrompt":
      return `coachPrompt:${entry.prompt.promptId}`;
    case "corosAction":
      return `corosAction:${entry.preview.requestId}`;
    case "workoutDelete":
      return `workoutDelete:${entry.preview.requestId}`;
    case "workoutEdit":
      return `workoutEdit:${entry.preview.proposalId}`;
    case "activityVisual":
    case "fitnessTrend":
    case "hrZoneSummary":
    case "coachChart":
      return `${entry.kind}:${entry.preview.previewId}`;
    default:
      return undefined;
  }
}

/** Index of the entry with the same identity, or -1. */
export function findChatEntryIndex(entries: ChatEntry[], entry: ChatEntry): number {
  const key = chatEntryKey(entry);
  return key === undefined ? -1 : entries.findIndex((candidate) => chatEntryKey(candidate) === key);
}

/** Replaces the entry with the same identity in place, or appends it. */
export function upsertChatEntry(entries: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const index = findChatEntryIndex(entries, entry);
  if (index < 0) return [...entries, entry];
  const next = [...entries];
  next[index] = entry;
  return next;
}

export function upsertPlanDraftEntry(entries: ChatEntry[], draft: PlanDraftPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "planDraft", draft });
}

export function upsertCoachPromptEntry(entries: ChatEntry[], prompt: CoachInputPrompt): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "coachPrompt", prompt });
}

export function upsertCorosActionEntry(entries: ChatEntry[], preview: CoachCorosActionPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "corosAction", preview });
}

export function upsertWorkoutDeleteEntry(entries: ChatEntry[], preview: WorkoutDeletePreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "workoutDelete", preview });
}

export function upsertWorkoutEditEntry(entries: ChatEntry[], preview: StrengthEditPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "workoutEdit", preview });
}

export function upsertActivityVisualEntry(entries: ChatEntry[], preview: ActivityVisualPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "activityVisual", preview });
}

export function upsertFitnessTrendEntry(entries: ChatEntry[], preview: FitnessTrendPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "fitnessTrend", preview });
}

export function upsertHrZoneEntry(entries: ChatEntry[], preview: HrZonePreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "hrZoneSummary", preview });
}

export function upsertCoachChartEntry(entries: ChatEntry[], preview: CoachChartPreview): ChatEntry[] {
  return upsertChatEntry(entries, { kind: "coachChart", preview });
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
