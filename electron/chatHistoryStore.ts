import {
  deleteChatTranscriptRow,
  getChatTranscriptRow,
  saveChatTranscriptRow
} from "./database";
import type {
  ChatProvider,
  PersistedChatEntry,
  PersistedChatMessageEntry,
  PersistedChatSource,
  PlanDraftPreview,
  PlanDraftPreviewEntry,
  WorkoutDeletePreview
} from "./types";

export interface ChatTranscriptRow {
  provider: string;
  messages_json: string;
  updated_at: string;
}

export interface ChatTranscriptDatabase {
  getTranscript(provider: ChatProvider): ChatTranscriptRow | undefined;
  saveTranscript(
    provider: ChatProvider,
    messagesJson: string,
    updatedAt: string
  ): void;
  deleteTranscript(provider: ChatProvider): void;
}

function createSqliteTranscriptDatabase(): ChatTranscriptDatabase {
  return {
    getTranscript: (provider) => getChatTranscriptRow(provider),
    saveTranscript: (provider, messagesJson, updatedAt) =>
      saveChatTranscriptRow(provider, messagesJson, updatedAt),
    deleteTranscript: (provider) => deleteChatTranscriptRow(provider)
  };
}

const defaultDatabase = createSqliteTranscriptDatabase();

function normalizeProvider(value: unknown): ChatProvider {
  return value === "local" ? "local" : "chatgpt";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): PersistedChatSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.snapshotIncluded !== "boolean" ||
    typeof value.mcpEnabled !== "boolean" ||
    typeof value.mcpUsed !== "boolean" ||
    !Array.isArray(value.mcpTools) ||
    !value.mcpTools.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }

  const source: PersistedChatSource = {
    snapshotIncluded: value.snapshotIncluded,
    mcpEnabled: value.mcpEnabled,
    mcpUsed: value.mcpUsed,
    mcpTools: value.mcpTools
  };
  if (typeof value.mcpError === "string" && value.mcpError.trim()) {
    source.mcpError = value.mcpError;
  }
  return source;
}

function parsePlanDraftEntry(value: unknown): PlanDraftPreviewEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    typeof value.saveToLibrary !== "boolean" ||
    typeof value.workoutType !== "string"
  ) {
    return null;
  }

  return {
    key: value.key,
    name: value.name,
    scheduleDate:
      typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
    volume: typeof value.volume === "string" ? value.volume : undefined,
    saveToLibrary: value.saveToLibrary,
    workoutType: value.workoutType
  };
}

function parsePlanDraft(value: unknown): PlanDraftPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.draftId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.warnings)
  ) {
    return null;
  }

  const entries = value.entries
    .map((entry) => parsePlanDraftEntry(entry))
    .filter((entry): entry is PlanDraftPreviewEntry => entry !== null);
  if (entries.length !== value.entries.length) {
    return null;
  }

  if (
    !value.conflicts.every((entry) => typeof entry === "string") ||
    !value.warnings.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    draftId: value.draftId,
    name: value.name,
    summary: value.summary,
    entries,
    conflicts: value.conflicts,
    warnings: value.warnings
  };
}

function parseWorkoutDeletePreview(value: unknown): WorkoutDeletePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.requestId !== "string" ||
    (value.target !== "scheduled" &&
      value.target !== "library" &&
      value.target !== "both") ||
    typeof value.summary !== "string"
  ) {
    return null;
  }

  return {
    requestId: value.requestId,
    target: value.target,
    workoutName:
      typeof value.workoutName === "string" ? value.workoutName : undefined,
    scheduleDate:
      typeof value.scheduleDate === "string" ? value.scheduleDate : undefined,
    programId: typeof value.programId === "string" ? value.programId : undefined,
    summary: value.summary
  };
}

function parseMessageEntry(value: unknown): PersistedChatMessageEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind !== "message") {
    const role =
      value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
    if (!role || typeof value.content !== "string") {
      return null;
    }

    const source = parseSource(value.source);
    return source
      ? { kind: "message", role, content: value.content, source }
      : { kind: "message", role, content: value.content };
  }

  const role =
    value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  if (!role || typeof value.content !== "string") {
    return null;
  }

  const source = parseSource(value.source);
  return source
    ? { kind: "message", role, content: value.content, source }
    : { kind: "message", role, content: value.content };
}

function parseEntry(value: unknown): PersistedChatEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "planDraft") {
    const draft = parsePlanDraft(value.draft);
    return draft ? { kind: "planDraft", draft } : null;
  }

  if (value.kind === "workoutDelete") {
    const preview = parseWorkoutDeletePreview(value.preview);
    return preview ? { kind: "workoutDelete", preview } : null;
  }

  return parseMessageEntry(value);
}

export function parseChatTranscriptJson(raw: string): PersistedChatEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

function normalizeEntries(entries: PersistedChatEntry[]): PersistedChatEntry[] {
  return entries
    .map((entry) => parseEntry(entry))
    .filter((entry): entry is PersistedChatEntry => entry !== null);
}

export function loadChatTranscript(
  provider: ChatProvider,
  database: ChatTranscriptDatabase = defaultDatabase
): PersistedChatEntry[] {
  const row = database.getTranscript(normalizeProvider(provider));
  if (!row) {
    return [];
  }

  return parseChatTranscriptJson(row.messages_json);
}

export function saveChatTranscript(
  provider: ChatProvider,
  entries: PersistedChatEntry[],
  database: ChatTranscriptDatabase = defaultDatabase
): void {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedEntries = normalizeEntries(entries);
  database.saveTranscript(
    normalizedProvider,
    JSON.stringify(normalizedEntries),
    new Date().toISOString()
  );
}

export function clearChatTranscript(
  provider: ChatProvider,
  database: ChatTranscriptDatabase = defaultDatabase
): void {
  database.deleteTranscript(normalizeProvider(provider));
}
