import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  getChatSessionSummary,
  listChatSessions,
  normalizePersistedChatEntry,
  renameChatSession,
  saveChatSession,
  type ChatSessionDatabase
} from "../chatHistoryStore";
import {
  appendChatSessionEvents,
  getChatSessionLastSeq,
  listChatSessionEventRows,
  pruneChatSessionEvents,
  resetChatSessionEvents
} from "../database";
import type { ChatProvider, ChatSessionSummary, PersistedChatEntry } from "../types";

/** Where the hub keeps transcripts: chat_sessions, through chatHistoryStore. */
export interface CoachSessionStore {
  list(provider: ChatProvider): ChatSessionSummary[];
  summary(id: string): ChatSessionSummary | undefined;
  load(id: string): PersistedChatEntry[];
  create(provider: ChatProvider): ChatSessionSummary;
  save(id: string, entries: PersistedChatEntry[]): ChatSessionSummary | null;
  /** Sets just the title; null when the session is gone. */
  rename(id: string, title: string): ChatSessionSummary | null;
  remove(id: string): void;
  /** The entry as it reads back after a save, or null when a save would drop it. */
  normalize(entry: PersistedChatEntry): PersistedChatEntry | null;
}

export function createChatHistorySessionStore(
  database?: ChatSessionDatabase,
  overrides: Partial<CoachSessionStore> = {}
): CoachSessionStore {
  return {
    list: (provider) => listChatSessions(provider, database),
    summary: (id) => getChatSessionSummary(id, database),
    load: (id) => getChatSession(id, database),
    create: (provider) => createChatSession(provider, database),
    save: (id, entries) => saveChatSession(id, entries, database),
    rename: (id, title) => renameChatSession(id, title, database),
    remove: (id) => deleteChatSession(id, database),
    normalize: normalizePersistedChatEntry,
    ...overrides
  };
}

export interface StoredCoachEvent {
  seq: number;
  kind: string;
  payloadJson: string;
  createdAt: string;
  /** Set on turn.started, so a retried send stays idempotent across restarts. */
  clientMessageId?: string;
}

/** Saved events per session, plus each session's cursor (chat_sessions.last_seq). */
export interface CoachEventStore {
  lastSeq(sessionId: string): number;
  /** Appends events and raises the cursor to at least `lastSeq`. */
  append(sessionId: string, events: StoredCoachEvent[], lastSeq: number): void;
  list(sessionId: string, afterSeq: number): StoredCoachEvent[];
  prune(sessionId: string, throughSeq: number): void;
  /** Forgets every event and sets the cursor. */
  reset(sessionId: string, lastSeq: number): void;
  remove(sessionId: string): void;
}

export function createSqliteCoachEventStore(): CoachEventStore {
  return {
    lastSeq: getChatSessionLastSeq,
    append: appendChatSessionEvents,
    list: (sessionId, afterSeq) =>
      listChatSessionEventRows(sessionId, afterSeq).map((row) => ({
        seq: row.seq,
        kind: row.kind,
        payloadJson: row.payload_json,
        createdAt: row.created_at,
        ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {})
      })),
    prune: pruneChatSessionEvents,
    reset: resetChatSessionEvents,
    remove: (sessionId) => pruneChatSessionEvents(sessionId, Number.MAX_SAFE_INTEGER)
  };
}

/** For tests and tools that run without SQLite. */
export function createMemoryCoachEventStore(): CoachEventStore {
  const sessions = new Map<string, { lastSeq: number; events: StoredCoachEvent[] }>();
  const session = (id: string) => {
    let entry = sessions.get(id);
    if (!entry) {
      entry = { lastSeq: 0, events: [] };
      sessions.set(id, entry);
    }
    return entry;
  };
  return {
    lastSeq: (id) => sessions.get(id)?.lastSeq ?? 0,
    append(id, events, lastSeq) {
      const entry = session(id);
      for (const event of events) {
        entry.events = entry.events.filter((existing) => existing.seq !== event.seq);
        entry.events.push({ ...event });
      }
      entry.events.sort((left, right) => left.seq - right.seq);
      entry.lastSeq = Math.max(entry.lastSeq, lastSeq);
    },
    list: (id, afterSeq) => (sessions.get(id)?.events ?? []).filter((event) => event.seq > afterSeq).map((event) => ({ ...event })),
    prune(id, throughSeq) {
      const entry = sessions.get(id);
      if (entry) entry.events = entry.events.filter((event) => event.seq > throughSeq);
    },
    reset(id, lastSeq) {
      sessions.set(id, { lastSeq, events: [] });
    },
    remove(id) {
      sessions.delete(id);
    }
  };
}
