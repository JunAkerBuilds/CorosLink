// Remote Coach, protocol 1: what CoachSessionHub sends to its clients (the
// desktop window today; LAN and tunnel phones later). C-LINK's mirror is
// CorosKit/Sources/CorosKit/Coach/CoachContract.swift, and both sides test
// against scripts/fixtures/coach-contract.json. Type-only imports keep this
// file safe for the renderer bundle.
import type { ChatEntry } from "../chatTranscript";
import type {
  ChatFileAttachment,
  ChatMessageAttachment,
  ChatProvider,
  ChatSessionSummary,
  TrainingPlanDestination,
  UnitSystem
} from "../types";

export const COACH_PROTOCOL_VERSION = 1;

/** What a client may do. Pairing grants read, operate and approve; view-only is read alone. */
export type CoachPermission = "coach:read" | "coach:operate" | "coach:approve" | "access:write";

export interface CoachSessionInfo {
  id: string;
  title: string;
  provider: ChatProvider;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** The answer being written right now; it becomes entries when the turn ends. */
export interface CoachActiveTurn {
  requestId: string;
  text: string;
  thinking: string;
  /** The tool Coach is calling, while it is calling one. */
  tool?: string;
}

/** A whole session as of `cursor`, the number of its last event. */
export interface CoachSnapshot {
  session: CoachSessionInfo;
  entries: ChatEntry[];
  cursor: number;
  activeTurn: CoachActiveTurn | null;
}

export interface CoachEventDataMap {
  /** `index` is the entry's place in the timeline; entries are only appended or replaced. */
  "entry.appended": { index: number; entry: ChatEntry };
  "entry.updated": { index: number; entry: ChatEntry };
  "turn.started": { requestId: string };
  "turn.delta": { requestId: string; delta: string };
  "turn.thinking": { requestId: string; delta: string };
  /** `call` while a tool runs, `failed` when it fails. */
  "turn.tool": { requestId: string; tool?: string; status: "call" | "failed"; message?: string };
  "turn.completed": { requestId: string };
  "turn.failed": { requestId: string; message: string; authError: boolean };
  "session.updated": { session: CoachSessionInfo };
}

export type CoachEventName = keyof CoachEventDataMap;

/** One numbered event. Each session numbers its events from 1, saved and live alike. */
export type CoachEventFrame = {
  [K in CoachEventName]: { event: K; sessionId: string; seq: number; data: CoachEventDataMap[K] };
}[CoachEventName];

/** Events that change what a snapshot holds; they are saved and can be replayed after a restart. */
export const SAVED_COACH_EVENTS: ReadonlySet<CoachEventName> = new Set<CoachEventName>([
  "entry.appended",
  "entry.updated",
  "session.updated",
  "turn.started",
  "turn.completed",
  "turn.failed"
]);

/** `coach.subscribe`'s answer: replayed events follow, or the cursor was too old. */
export type CoachSubscribeResult =
  | { mode: "replay" }
  | { mode: "snapshot"; snapshot: CoachSnapshot };

export interface CoachPromptAnswer {
  promptId: string;
  choiceId?: string;
  text?: string;
}

export interface CoachSendInput {
  sessionId: string;
  /** Makes the send idempotent: a retry with the same id gets the same requestId. */
  clientMessageId: string;
  text?: string;
  promptAnswer?: CoachPromptAnswer;
  /** Desktop only: a chart or table dropped into the composer. */
  attachment?: ChatMessageAttachment;
  /**
   * Desktop only: files already in the attachment store. The main process sets
   * these after storing the window's uploads; a message may be only files.
   */
  files?: ChatFileAttachment[];
  /** The sender's units; remote senders get the last ones the desktop used. */
  unitSystem?: UnitSystem;
}

export type CoachConfirmKind = "corosAction" | "workoutDelete" | "planUpload" | "strengthEdit";

export interface CoachConfirmInput {
  sessionId: string;
  kind: CoachConfirmKind;
  /** A COROS action's or delete's requestId, a draft's draftId, or a strength edit's proposalId. */
  id: string;
  decision: "confirm" | "cancel";
  /** Strength edits only: refused unless it matches the proposal's current hash. */
  reviewHash?: string;
  /** Choices the desktop cards offer; remote approvals use the card's defaults. */
  options?: {
    destination?: TrainingPlanDestination;
    scheduleDate?: string;
    unitSystem?: UnitSystem;
    /** Strength edit items to save; defaults to every prepared item. */
    selectedIds?: string[];
  };
}

/** The entry after the decision, at its place in the timeline. */
export interface CoachConfirmResult {
  index: number;
  entry: ChatEntry;
}

export type CoachErrorCode = "forbidden" | "not_found" | "busy" | "conflict" | "invalid" | "unsupported";

export interface CoachErrorBody {
  code: CoachErrorCode;
  message: string;
  requiredPermission?: CoachPermission;
}

/** A change to the session list, for clients that show every conversation. */
export type CoachSessionsChange =
  | { kind: "upsert"; session: ChatSessionSummary }
  | { kind: "delete"; sessionId: string };

export function coachSessionInfo(summary: ChatSessionSummary): CoachSessionInfo {
  return {
    id: summary.id,
    title: summary.title,
    provider: summary.provider,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };
}

// ----- Client side -----

/** What a client keeps for the session it shows. */
export interface CoachClientState {
  sessionId: string;
  session: CoachSessionInfo;
  entries: ChatEntry[];
  cursor: number;
  activeTurn: CoachActiveTurn | null;
}

export function coachStateFromSnapshot(snapshot: CoachSnapshot): CoachClientState {
  return {
    sessionId: snapshot.session.id,
    session: snapshot.session,
    entries: snapshot.entries,
    cursor: snapshot.cursor,
    activeTurn: snapshot.activeTurn
  };
}

/**
 * Applies one event. Events at or below the cursor were already applied. A
 * gap in `seq` is normal: replay skips the live text of turns that finished.
 * Returns "resync" when the event cannot apply, and the client should fetch
 * a snapshot.
 */
export function applyCoachEvent(
  state: CoachClientState,
  frame: { event: string; sessionId: string; seq: number; data: unknown }
): CoachClientState | "resync" {
  if (frame.sessionId !== state.sessionId || frame.seq <= state.cursor) return state;
  const next: CoachClientState = { ...state, cursor: frame.seq };
  const known = frame as CoachEventFrame;
  switch (known.event) {
    case "entry.appended":
    case "entry.updated": {
      const { index, entry } = known.data;
      const limit = known.event === "entry.appended" ? state.entries.length : state.entries.length - 1;
      if (!Number.isInteger(index) || index < 0 || index > limit) return "resync";
      const entries = [...state.entries];
      entries[index] = entry;
      return { ...next, entries };
    }
    case "turn.started":
      return { ...next, activeTurn: { requestId: known.data.requestId, text: "", thinking: "" } };
    case "turn.delta": {
      const turn = state.activeTurn ?? { requestId: known.data.requestId, text: "", thinking: "" };
      return { ...next, activeTurn: { requestId: turn.requestId, text: turn.text + known.data.delta, thinking: turn.thinking } };
    }
    case "turn.thinking": {
      const turn = state.activeTurn ?? { requestId: known.data.requestId, text: "", thinking: "" };
      return { ...next, activeTurn: { ...turn, thinking: turn.thinking + known.data.delta } };
    }
    case "turn.tool": {
      const turn = state.activeTurn ?? { requestId: known.data.requestId, text: "", thinking: "" };
      const { tool: _previous, ...rest } = turn;
      return {
        ...next,
        activeTurn: known.data.status === "call" && known.data.tool ? { ...rest, tool: known.data.tool } : rest
      };
    }
    case "turn.completed":
    case "turn.failed":
      return { ...next, activeTurn: null };
    case "session.updated":
      return { ...next, session: known.data.session };
    default:
      // Events this version doesn't know still advance the cursor.
      return next;
  }
}
