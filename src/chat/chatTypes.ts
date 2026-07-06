import type {
  ActivityVisualPreview,
  ChatMessage,
  FitnessTrendPreview,
  HrZonePreview,
  PersistedChatEntry,
  PlanDraftPreview,
  WorkoutDeletePreview
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
  source?: SourceInfo;
}

export interface ChatPlanDraftEntry {
  kind: "planDraft";
  draft: PlanDraftPreview;
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

export interface ChatToolNoticeEntry {
  kind: "toolNotice";
  message: string;
}

export type ChatEntry =
  | ChatMessageEntry
  | ChatPlanDraftEntry
  | ChatWorkoutDeleteEntry
  | ChatActivityVisualEntry
  | ChatFitnessTrendEntry
  | ChatHrZoneEntry
  | ChatToolNoticeEntry;

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

export function toWireMessages(entries: ChatEntry[]): ChatMessage[] {
  return entries
    .filter((entry): entry is ChatMessageEntry => entry.kind === "message")
    .map(({ role, content }) => ({ role, content }));
}

function persistVisualEntry(entry: ChatEntry): PersistedChatEntry | null {
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
  if (entry.kind === "toolNotice") {
    return {
      kind: "message",
      role: "assistant",
      content: entry.message
    };
  }
  if (entry.kind === "message") {
    return entry.source
      ? {
          kind: "message",
          role: entry.role,
          content: entry.content,
          source: entry.source
        }
      : { kind: "message", role: entry.role, content: entry.content };
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
    result.push(
      entry.source
        ? {
            kind: "message",
            role: entry.role,
            content: entry.content,
            source: entry.source
          }
        : {
            kind: "message",
            role: entry.role,
            content: entry.content
          }
    );
  }

  return result;
}
