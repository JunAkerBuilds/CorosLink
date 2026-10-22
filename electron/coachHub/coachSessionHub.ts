import crypto from "node:crypto";
import type { ChatStreamSink } from "../chatService";
import {
  findChatEntryIndex,
  fromPersistedEntries,
  toPersistedEntries,
  toWireMessages,
  type ChatEntry,
  type SourceInfo
} from "../chatTranscript";
import type {
  ChatMessage,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  ChatStreamInfo,
  ChatTurnStage,
  CoachCorosActionPreview,
  CoachInputPrompt,
  DeleteWorkoutResult,
  PlanDraftPreview,
  TrainingPlanDestination,
  UnitSystem,
  UploadPlanResult,
  WorkoutDeletePreview
} from "../types";
import type { StrengthEditPreview } from "../workoutEditTypes";
import {
  SAVED_COACH_EVENTS,
  coachSessionInfo,
  type CoachActiveTurn,
  type CoachConfirmInput,
  type CoachConfirmResult,
  type CoachErrorBody,
  type CoachErrorCode,
  type CoachEventDataMap,
  type CoachEventFrame,
  type CoachEventName,
  type CoachPermission,
  type CoachSendInput,
  type CoachSessionsChange,
  type CoachSnapshot,
  type CoachSubscribeResult
} from "./coachContract";
import type { CoachEventStore, CoachSessionStore } from "./coachStores";

/**
 * Who is asking. The desktop window's IPC is checked in main.ts before it
 * reaches the hub; a remote client carries the permissions its grant holds.
 */
export type CoachActor =
  | { kind: "window" }
  | { kind: "remote"; permissions: readonly string[] };

export const WINDOW_ACTOR: CoachActor = { kind: "window" };

export class CoachHubError extends Error {
  constructor(
    readonly code: CoachErrorCode,
    message: string,
    readonly requiredPermission?: CoachPermission
  ) {
    super(message);
    this.name = "CoachHubError";
  }

  toJSON(): CoachErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.requiredPermission ? { requiredPermission: this.requiredPermission } : {})
    };
  }
}

/** Runs one provider turn (streamChat in the app, a fake in tests). */
export interface CoachStreamDriver {
  start(
    sink: ChatStreamSink,
    requestId: string,
    messages: ChatMessage[],
    unitSystem: UnitSystem,
    provider: ChatProvider,
    /** The conversation, for resolving the files its messages carry. */
    sessionId: string
  ): Promise<void>;
  cancel(requestId: string): void;
}

/** The services that carry out an approval. */
export interface CoachActionDriver {
  confirmCorosAction(requestId: string): Promise<CoachCorosActionPreview>;
  confirmWorkoutDelete(requestId: string): Promise<DeleteWorkoutResult>;
  uploadPlanDraft(
    draftId: string,
    unitSystem: UnitSystem,
    destination: TrainingPlanDestination,
    scheduleDate?: string
  ): Promise<UploadPlanResult>;
  strengthEditStatus(proposalId: string): Promise<StrengthEditPreview>;
  confirmStrengthEdit(proposalId: string, reviewHash: string, selectedIds: string[]): Promise<StrengthEditPreview>;
  cancelStrengthEdit(proposalId: string): Promise<StrengthEditPreview>;
}

export interface CoachSessionHubOptions {
  sessions: CoachSessionStore;
  events: CoachEventStore;
  stream: CoachStreamDriver;
  actions: CoachActionDriver;
  settings: () => Pick<ChatSettings, "visualizationsEnabled">;
  /**
   * Writes a short title from a conversation's first question and answer (the session's
   * provider, in the app). Null keeps the title the first question gave it.
   */
  titler?: (provider: ChatProvider, question: string, answer: string) => Promise<string | null>;
  /** The units remote senders get: the last ones the desktop sent with. */
  unitSystem?: { get(): UnitSystem | undefined; set(value: UnitSystem): void };
  /** Where attached files live; a deleted conversation takes its files with it. */
  attachments?: { removeSession(sessionId: string): Promise<void> | void };
  now?: () => number;
  randomId?: () => string;
  /** Idle sessions kept in memory. */
  maxCachedSessions?: number;
  /** Saved events kept per session; older cursors get a snapshot. */
  maxRetainedEvents?: number;
  /** How long a cancelled turn may take to wind down before it is closed anyway. */
  cancelGraceMs?: number;
}

export type CoachEventListener = (frame: CoachEventFrame) => void;

export interface CoachSubscription {
  response: CoachSubscribeResult;
  /** Events after the cursor, to deliver after `response` and before live ones. */
  replay: CoachEventFrame[];
  unsubscribe(): void;
}

interface TurnState {
  requestId: string;
  text: string;
  thinking: string;
  tool?: string;
  /** The last step reported before the model writes. */
  stage?: ChatTurnStage;
  source: SourceInfo | null;
  /** Coach prompts arrive mid-turn but are shown after the answer, so they read in order. */
  pendingPrompts: CoachInputPrompt[];
  /** The question this turn answers, as it was, so a failed turn can offer it again. */
  resumedPrompt: CoachInputPrompt | null;
  /** A reply the desktop writes itself (the latest-activity FIT export). */
  local: boolean;
  ended: boolean;
}

interface SessionState {
  summary: ChatSessionSummary;
  entries: ChatEntry[];
  cursor: number;
  /** Replay reconstructs the session from any cursor at or after this one. */
  floor: number;
  /** Saved events after `floor`, plus the live events of the turn in progress. */
  log: CoachEventFrame[];
  turn: TurnState | null;
  /** clientMessageId -> requestId. */
  sends: Map<string, string>;
  subscribers: Set<CoachEventListener>;
  lastUsed: number;
}

type EntryChange = { event: "entry.appended" | "entry.updated"; index: number; entry: ChatEntry };

const PROVIDERS: ChatProvider[] = ["chatgpt", "claude-code", "gemini-cli", "openrouter", "local"];
const MAX_REMEMBERED_SENDS = 256;
/**
 * After an unclean stop the live events of the turn in progress were never
 * saved, so clients may hold numbers the store never saw. Numbering jumps
 * past anything they could hold, and their cursors fall back to a snapshot.
 */
const UNCLEAN_STOP_SEQ_GAP = 1_000_000;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function unansweredPrompt(prompt: CoachInputPrompt): CoachInputPrompt {
  const { answer: _answer, answeredAt: _answeredAt, selectedChoiceId: _choice, ...rest } = prompt;
  return rest;
}

/** A COROS YYYYMMDD date as YYYY-MM-DD, as the desktop card reads it. */
function isoFromCompactDate(value: string | undefined): string | undefined {
  const match = value ? /^(\d{4})(\d{2})(\d{2})$/.exec(value) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/**
 * Owns every Coach conversation: the transcript, the turn in progress, and a
 * numbered event log per session that every client (the desktop window, and
 * later phones) subscribes to on equal terms.
 */
export class CoachSessionHub {
  private readonly cache = new Map<string, SessionState>();
  private readonly sessionListeners = new Set<(change: CoachSessionsChange) => void>();
  private readonly eventListeners = new Set<CoachEventListener>();
  private readonly confirming = new Set<string>();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly maxCachedSessions: number;
  private readonly maxRetainedEvents: number;
  private readonly cancelGraceMs: number;
  private lastUnitSystem: UnitSystem | undefined;
  private stopped = false;

  constructor(private readonly options: CoachSessionHubOptions) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.maxCachedSessions = options.maxCachedSessions ?? 16;
    this.maxRetainedEvents = options.maxRetainedEvents ?? 500;
    this.cancelGraceMs = options.cancelGraceMs ?? 10_000;
  }

  // ----- Sessions -----

  listSessions(provider?: ChatProvider): ChatSessionSummary[] {
    if (provider) return this.options.sessions.list(provider);
    return PROVIDERS.flatMap((candidate) => this.options.sessions.list(candidate)).sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
  }

  createSession(provider: ChatProvider): ChatSessionSummary {
    const summary = this.options.sessions.create(provider);
    this.notifySessions({ kind: "upsert", session: summary });
    return summary;
  }

  getSession(sessionId: string): CoachSnapshot {
    return this.snapshot(this.state(sessionId));
  }

  deleteSession(sessionId: string): void {
    const state = this.cache.get(sessionId);
    if (state?.turn) {
      const turn = state.turn;
      turn.ended = true;
      state.turn = null;
      if (!turn.local) this.options.stream.cancel(turn.requestId);
    }
    state?.subscribers.clear();
    this.cache.delete(sessionId);
    this.options.sessions.remove(sessionId);
    this.options.events.remove(sessionId);
    void Promise.resolve(this.options.attachments?.removeSession(sessionId)).catch((error) =>
      console.warn("[coach] could not remove a conversation's files:", error)
    );
    this.notifySessions({ kind: "delete", sessionId });
  }

  /** Deletes every conversation of one provider; returns how many went. */
  deleteAllSessions(provider: ChatProvider): number {
    const ids = this.options.sessions.list(provider).map((session) => session.id);
    for (const id of ids) this.deleteSession(id);
    return ids.length;
  }

  /**
   * The transcript changed outside the hub (the legacy chat:saveSession path).
   * Reload it, and send any client that replays from before now a snapshot.
   */
  invalidate(sessionId: string): void {
    const state = this.cache.get(sessionId);
    if (!state) {
      const cursor = this.options.events.lastSeq(sessionId);
      this.options.events.reset(sessionId, cursor + 1);
    } else if (!state.turn) {
      state.entries = this.loadEntries(sessionId);
      state.summary = this.options.sessions.summary(sessionId) ?? state.summary;
      state.cursor += 1;
      state.floor = state.cursor;
      state.log = [];
      this.options.events.reset(sessionId, state.cursor);
    }
    const summary = this.options.sessions.summary(sessionId);
    if (summary) this.notifySessions({ kind: "upsert", session: summary });
  }

  onSessionsChanged(listener: (change: CoachSessionsChange) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  /** Every event of every session, for the cloud link's text-free activity pushes. */
  onEvent(listener: CoachEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ----- Subscriptions -----

  subscribe(sessionId: string, afterSeq: number, listener: CoachEventListener): CoachSubscription {
    const state = this.state(sessionId);
    state.subscribers.add(listener);
    const unsubscribe = () => {
      state.subscribers.delete(listener);
    };
    const replayable =
      Number.isInteger(afterSeq) && afterSeq >= state.floor && afterSeq <= state.cursor;
    if (!replayable) {
      return { response: { mode: "snapshot", snapshot: this.snapshot(state) }, replay: [], unsubscribe };
    }
    return {
      response: { mode: "replay" },
      replay: state.log.filter((frame) => frame.seq > afterSeq),
      unsubscribe
    };
  }

  // ----- Turns -----

  send(input: CoachSendInput): { requestId: string } {
    this.assertRunning();
    if (typeof input.clientMessageId !== "string" || !input.clientMessageId.trim()) {
      throw new CoachHubError("invalid", "A message needs a clientMessageId.");
    }
    const state = this.state(input.sessionId);
    const repeated = state.sends.get(input.clientMessageId);
    if (repeated) return { requestId: repeated };
    if (state.turn) {
      throw new CoachHubError("busy", "Coach is still answering in this conversation.");
    }
    if (input.unitSystem) this.rememberUnitSystem(input.unitSystem);

    const text = (input.text ?? "").trim();
    const files = input.files?.length ? input.files : undefined;
    let promptIndex = -1;
    let answer = text;
    let choiceId: string | undefined;
    if (input.promptAnswer) {
      promptIndex = state.entries.findIndex(
        (entry) => entry.kind === "coachPrompt" && entry.prompt.promptId === input.promptAnswer?.promptId
      );
      const entry = state.entries[promptIndex];
      if (!entry || entry.kind !== "coachPrompt") {
        throw new CoachHubError("not_found", "This question is no longer in the conversation.");
      }
      if (entry.prompt.answeredAt !== undefined) {
        throw new CoachHubError("conflict", "This question was already answered.");
      }
      if (input.promptAnswer.choiceId) {
        const choice = entry.prompt.choices.find((candidate) => candidate.id === input.promptAnswer?.choiceId);
        if (!choice) throw new CoachHubError("invalid", "That answer is not one of the choices.");
        answer = choice.response;
        choiceId = choice.id;
      } else {
        answer = (input.promptAnswer.text ?? text).trim();
      }
      if (!answer) throw new CoachHubError("invalid", "Write an answer first.");
    } else {
      if (!text && !files) throw new CoachHubError("invalid", "Write a message first.");
      // Free text answers the newest open question, unless it carries an
      // attachment or files: then it is its own request.
      if (!input.attachment && !files) {
        for (let index = state.entries.length - 1; index >= 0; index -= 1) {
          const entry = state.entries[index];
          if (entry.kind === "coachPrompt" && entry.prompt.answeredAt === undefined) {
            promptIndex = index;
            break;
          }
        }
      }
    }

    const requestId = this.randomId();
    const turn = this.beginTurn(state, requestId, input.clientMessageId, false);
    const changes: EntryChange[] = [];
    const promptEntry = promptIndex >= 0 ? state.entries[promptIndex] : undefined;
    if (promptEntry?.kind === "coachPrompt") {
      turn.resumedPrompt = promptEntry.prompt;
      this.replaceEntry(state, promptIndex, {
        kind: "coachPrompt",
        prompt: { ...promptEntry.prompt, answer, answeredAt: this.now(), selectedChoiceId: choiceId }
      }, changes);
    } else {
      this.appendEntry(state, {
        kind: "message",
        role: "user",
        content: text,
        ...(input.attachment ? { attachment: input.attachment } : {}),
        ...(files ? { files } : {})
      }, changes);
    }
    this.commit(state, changes);
    this.emit(state, "turn.started", { requestId }, input.clientMessageId);

    const sink: ChatStreamSink = {
      send: (channel, payload) => this.onStreamEvent(state, turn, channel, payload)
    };
    let running: Promise<void>;
    try {
      running = this.options.stream.start(
        sink,
        requestId,
        toWireMessages(state.entries),
        this.unitSystem(input.unitSystem),
        state.summary.provider,
        state.summary.id
      );
    } catch (error) {
      running = Promise.reject(error);
    }
    void running.then(
      () => {
        // A stream that stopped without saying done keeps what it wrote.
        if (!turn.ended) this.completeTurn(state, turn, turn.text);
      },
      (error) => this.failTurn(state, turn, message(error, "Chat request failed."), false)
    );
    return { requestId };
  }

  cancel(sessionId: string): { cancelled: boolean } {
    const state = this.state(sessionId);
    const turn = state.turn;
    if (!turn) return { cancelled: false };
    if (turn.local) {
      this.completeTurn(state, turn, "", "cancelled");
      return { cancelled: true };
    }
    this.options.stream.cancel(turn.requestId);
    // A provider that ignores the abort must not hold the session forever.
    const timer = setTimeout(() => {
      if (!turn.ended) this.completeTurn(state, turn, "", "cancelled");
    }, this.cancelGraceMs);
    timer.unref?.();
    return { cancelled: true };
  }

  /**
   * A reply the desktop writes itself, such as the latest-activity FIT export,
   * which opens a save dialog. Other clients see it as an ordinary turn.
   */
  beginLocalTurn(sessionId: string, clientMessageId: string, text: string): { requestId: string } {
    this.assertRunning();
    const state = this.state(sessionId);
    const repeated = state.sends.get(clientMessageId);
    if (repeated) return { requestId: repeated };
    if (state.turn) throw new CoachHubError("busy", "Coach is still answering in this conversation.");
    const content = text.trim();
    if (!content) throw new CoachHubError("invalid", "Write a message first.");
    const requestId = this.randomId();
    this.beginTurn(state, requestId, clientMessageId, true);
    const changes: EntryChange[] = [];
    this.appendEntry(state, { kind: "message", role: "user", content }, changes);
    this.commit(state, changes);
    this.emit(state, "turn.started", { requestId }, clientMessageId);
    return { requestId };
  }

  finishLocalTurn(sessionId: string, requestId: string, reply: string): void {
    const state = this.state(sessionId);
    const turn = state.turn;
    if (!turn?.local || turn.requestId !== requestId) return;
    this.completeTurn(state, turn, reply);
  }

  /** Ends every turn, saved as failed, so clients and the next launch see why. */
  shutdown(): void {
    this.stopped = true;
    for (const state of this.cache.values()) {
      const turn = state.turn;
      if (!turn) continue;
      // Closed first, so the stream's own "cancelled" ending is ignored.
      this.failTurn(state, turn, "Coach stopped because CorosLink quit.", false);
      if (!turn.local) this.options.stream.cancel(turn.requestId);
    }
  }

  // ----- Confirmations -----

  async confirm(input: CoachConfirmInput, actor: CoachActor = WINDOW_ACTOR): Promise<CoachConfirmResult> {
    if (actor.kind === "remote" && !actor.permissions.includes("coach:approve")) {
      throw new CoachHubError("forbidden", "This device can view Coach but not approve changes.", "coach:approve");
    }
    if (input.decision !== "confirm" && input.decision !== "cancel") {
      throw new CoachHubError("invalid", "Choose confirm or cancel.");
    }
    const state = this.state(input.sessionId);
    const key = `${input.sessionId}:${input.kind}:${input.id}`;
    if (this.confirming.has(key)) {
      throw new CoachHubError("busy", "This change is already being saved.");
    }
    this.confirming.add(key);
    try {
      switch (input.kind) {
        case "corosAction":
          return await this.confirmCorosAction(state, input);
        case "workoutDelete":
          return await this.confirmWorkoutDelete(state, input);
        case "planUpload":
          return await this.confirmPlanUpload(state, input);
        case "strengthEdit":
          return await this.confirmStrengthEdit(state, input);
        default:
          throw new CoachHubError("invalid", "Unknown confirmation kind.");
      }
    } finally {
      this.confirming.delete(key);
    }
  }

  /** A strength edit changed through its own review card; refresh the cached entries. */
  async syncStrengthEdit(proposalId: string): Promise<void> {
    for (const state of this.cache.values()) {
      const index = state.entries.findIndex(
        (entry) => entry.kind === "workoutEdit" && entry.preview.proposalId === proposalId
      );
      if (index < 0) continue;
      const preview = await this.options.actions.strengthEditStatus(proposalId);
      const current = state.entries[index];
      if (current?.kind === "workoutEdit" && JSON.stringify(current.preview) === JSON.stringify(preview)) continue;
      const changes: EntryChange[] = [];
      this.replaceEntry(state, index, { kind: "workoutEdit", preview }, changes);
      this.commit(state, changes);
    }
  }

  private async confirmCorosAction(state: SessionState, input: CoachConfirmInput): Promise<CoachConfirmResult> {
    const index = this.requireEntry(state, "corosAction", input.id);
    const entry = state.entries[index] as Extract<ChatEntry, { kind: "corosAction" }>;
    if (input.decision === "cancel") {
      throw new CoachHubError("unsupported", "A COROS review can't be dismissed. Leave it unsaved instead.");
    }
    if (entry.preview.state === "saved" || entry.preview.state === "uncertain") return { index, entry };
    const original = entry.preview;
    this.update(state, index, { kind: "corosAction", preview: { ...original, state: "saving" } });
    let preview: CoachCorosActionPreview;
    try {
      preview = await this.options.actions.confirmCorosAction(input.id);
    } catch (error) {
      // Nothing was sent; every client goes back to the Save button.
      this.update(state, index, { kind: "corosAction", preview: original });
      throw error;
    }
    return this.update(state, index, { kind: "corosAction", preview });
  }

  private async confirmWorkoutDelete(state: SessionState, input: CoachConfirmInput): Promise<CoachConfirmResult> {
    const index = this.requireEntry(state, "workoutDelete", input.id);
    const entry = state.entries[index] as Extract<ChatEntry, { kind: "workoutDelete" }>;
    if (input.decision === "cancel") {
      throw new CoachHubError("unsupported", "A delete request can't be dismissed. Leave it instead.");
    }
    if (entry.preview.state === "deleted") return { index, entry };
    let preview: WorkoutDeletePreview;
    try {
      const result = await this.options.actions.confirmWorkoutDelete(input.id);
      preview = { ...entry.preview, state: "deleted", message: result.message };
    } catch (error) {
      preview = { ...entry.preview, state: "failed", message: message(error, "Failed to delete workout from COROS.") };
    }
    return this.update(state, index, { kind: "workoutDelete", preview });
  }

  private async confirmPlanUpload(state: SessionState, input: CoachConfirmInput): Promise<CoachConfirmResult> {
    const index = this.requireEntry(state, "planDraft", input.id);
    const entry = state.entries[index] as Extract<ChatEntry, { kind: "planDraft" }>;
    if (input.decision === "cancel") {
      throw new CoachHubError("unsupported", "A draft can't be dismissed. Leave it unsaved instead.");
    }
    const draft = entry.draft;
    if (draft.uploadedAt || draft.uploadResult) return { index, entry };
    const firstDate = draft.entries[0]
      ? draft.entries[0].scheduleDate ?? isoFromCompactDate(draft.entries[0].source?.schedule_date)
      : undefined;
    // The same defaults the desktop cards start with.
    const destination: TrainingPlanDestination =
      input.options?.destination ??
      (draft.artifactType === "workout" ? (firstDate ? "calendar" : "workoutLibrary") : "localPlan");
    const scheduleDate =
      input.options?.scheduleDate ??
      (draft.artifactType === "workout" && destination === "calendar" ? firstDate : undefined);
    const result = await this.options.actions.uploadPlanDraft(
      input.id,
      this.unitSystem(input.options?.unitSystem),
      destination,
      scheduleDate
    );
    return this.update(state, index, { kind: "planDraft", draft: uploadedDraft(draft, result, destination, this.now()) });
  }

  private async confirmStrengthEdit(state: SessionState, input: CoachConfirmInput): Promise<CoachConfirmResult> {
    const index = this.requireEntry(state, "workoutEdit", input.id);
    const current = await this.options.actions.strengthEditStatus(input.id);
    if (current.origin !== "coach") {
      throw new CoachHubError("forbidden", "Only the CorosLink window can approve this review.");
    }
    let preview: StrengthEditPreview;
    if (input.decision === "cancel") {
      preview = await this.options.actions.cancelStrengthEdit(input.id);
    } else if (current.state !== "awaiting_confirmation") {
      preview = current;
    } else {
      if (!input.reviewHash || input.reviewHash !== current.reviewHash) {
        throw new CoachHubError("conflict", "This review changed. Open it again to approve the current version.");
      }
      const selected =
        input.options?.selectedIds ?? current.items.filter((item) => item.state === "prepared").map((item) => item.id);
      preview = await this.options.actions.confirmStrengthEdit(input.id, current.reviewHash, selected);
    }
    return this.update(state, index, { kind: "workoutEdit", preview });
  }

  private requireEntry(state: SessionState, kind: ChatEntry["kind"], id: string): number {
    const index = state.entries.findIndex((entry) => {
      if (entry.kind !== kind) return false;
      if (entry.kind === "corosAction" || entry.kind === "workoutDelete") return entry.preview.requestId === id;
      if (entry.kind === "planDraft") return entry.draft.draftId === id;
      if (entry.kind === "workoutEdit") return entry.preview.proposalId === id;
      return false;
    });
    if (index < 0) throw new CoachHubError("not_found", "This card is no longer in the conversation.");
    return index;
  }

  private update(state: SessionState, index: number, entry: ChatEntry): CoachConfirmResult {
    const changes: EntryChange[] = [];
    this.replaceEntry(state, index, entry, changes);
    this.commit(state, changes);
    return { index, entry: state.entries[index] };
  }

  // ----- Stream events -----

  private beginTurn(state: SessionState, requestId: string, clientMessageId: string, local: boolean): TurnState {
    const turn: TurnState = {
      requestId,
      text: "",
      thinking: "",
      source: null,
      pendingPrompts: [],
      resumedPrompt: null,
      local,
      ended: false
    };
    state.turn = turn;
    state.sends.set(clientMessageId, requestId);
    while (state.sends.size > MAX_REMEMBERED_SENDS) {
      const oldest = state.sends.keys().next().value;
      if (oldest === undefined) break;
      state.sends.delete(oldest);
    }
    return turn;
  }

  private onStreamEvent(state: SessionState, turn: TurnState, channel: string, payload: unknown): void {
    if (turn.ended || state.turn !== turn) return;
    const value = (payload ?? {}) as Record<string, unknown>;
    switch (channel) {
      case "chat:streamStart":
        turn.text = "";
        turn.thinking = "";
        turn.tool = undefined;
        turn.pendingPrompts = [];
        return;
      case "chat:streamToken": {
        const delta = typeof value.delta === "string" ? value.delta : "";
        if (!delta) return;
        turn.tool = undefined;
        turn.text += delta;
        this.emit(state, "turn.delta", { requestId: turn.requestId, delta });
        return;
      }
      case "chat:streamInfo":
        this.onStreamInfo(state, turn, payload as ChatStreamInfo);
        return;
      case "chat:streamDone":
        this.completeTurn(
          state,
          turn,
          typeof value.fullText === "string" ? value.fullText : turn.text,
          typeof value.finishReason === "string" ? value.finishReason : undefined
        );
        return;
      case "chat:streamError":
        this.failTurn(
          state,
          turn,
          typeof value.message === "string" ? value.message : "Chat request failed.",
          Boolean(value.authError)
        );
        return;
      default:
        return;
    }
  }

  private onStreamInfo(state: SessionState, turn: TurnState, info: ChatStreamInfo): void {
    const changes: EntryChange[] = [];
    switch (info.kind) {
      case "context":
        turn.source = {
          snapshotIncluded: info.snapshotIncluded,
          mcpEnabled: info.mcpEnabled,
          mcpUsed: false,
          mcpTools: []
        };
        return;
      case "thinking":
        if (!info.delta) return;
        turn.thinking += info.delta;
        this.emit(state, "turn.thinking", { requestId: turn.requestId, delta: info.delta });
        return;
      case "stage":
        if (turn.stage === info.stage) return;
        turn.stage = info.stage;
        this.emit(state, "turn.status", { requestId: turn.requestId, stage: info.stage });
        return;
      case "mcp": {
        const failed = info.status !== "call" && (/fail|error/i.test(info.status) || Boolean(info.message));
        turn.tool = info.status === "call" ? info.tool : undefined;
        const base: SourceInfo = turn.source ?? { snapshotIncluded: false, mcpEnabled: true, mcpUsed: false, mcpTools: [] };
        turn.source = {
          ...base,
          mcpUsed: true,
          mcpTools: info.tool ? [...base.mcpTools, info.tool] : base.mcpTools,
          mcpError: /fail|error/i.test(info.status) || info.message ? info.message ?? info.status : base.mcpError
        };
        if (info.status === "call" || failed) {
          this.emit(state, "turn.tool", {
            requestId: turn.requestId,
            ...(info.tool ? { tool: info.tool } : {}),
            status: info.status === "call" ? "call" : "failed",
            ...(info.message ? { message: info.message } : {})
          });
        }
        return;
      }
      case "coachPrompt":
        turn.pendingPrompts = [
          ...turn.pendingPrompts.filter((prompt) => prompt.promptId !== info.prompt.promptId),
          info.prompt
        ];
        return;
      case "planDraft":
        this.upsertEntry(state, { kind: "planDraft", draft: info.draft }, changes);
        break;
      case "workoutEdit":
        this.upsertEntry(state, { kind: "workoutEdit", preview: info.preview }, changes);
        break;
      case "corosAction":
        this.upsertEntry(state, { kind: "corosAction", preview: info.preview }, changes);
        break;
      case "workoutDelete":
        this.upsertEntry(state, { kind: "workoutDelete", preview: info.preview }, changes);
        break;
      case "activityVisual":
        if (this.options.settings().visualizationsEnabled) {
          this.upsertEntry(state, { kind: "activityVisual", preview: info.preview }, changes);
        }
        break;
      case "fitnessTrend":
        if (this.options.settings().visualizationsEnabled) {
          this.upsertEntry(state, { kind: "fitnessTrend", preview: info.preview }, changes);
        }
        break;
      case "hrZoneSummary":
        if (this.options.settings().visualizationsEnabled) {
          this.upsertEntry(state, { kind: "hrZoneSummary", preview: info.preview }, changes);
        }
        break;
      case "coachChart":
        // Explicitly requested by the coach, so not subject to the visuals toggle.
        this.upsertEntry(state, { kind: "coachChart", preview: info.preview }, changes);
        break;
      default:
        return;
    }
    this.commit(state, changes);
  }

  private completeTurn(state: SessionState, turn: TurnState, finalText: string, finishReason?: string): void {
    if (turn.ended) return;
    turn.ended = true;
    if (state.turn === turn) state.turn = null;
    const changes: EntryChange[] = [];
    if (finishReason === "cancelled") {
      // A stopped answer is dropped, and an answered question is offered again.
      this.restoreResumedPrompt(state, turn, changes);
    } else {
      if (turn.source?.mcpError) {
        this.appendEntry(state, { kind: "toolNotice", message: turn.source.mcpError }, changes);
      }
      if (finalText) {
        const reasoningSummary = turn.thinking.trim();
        this.appendEntry(state, {
          kind: "message",
          role: "assistant",
          content: finalText,
          ...(turn.source ? { source: turn.source } : {}),
          ...(reasoningSummary ? { reasoningSummary } : {})
        }, changes);
      }
      for (const prompt of turn.pendingPrompts) {
        this.upsertEntry(state, { kind: "coachPrompt", prompt }, changes);
      }
    }
    this.commit(state, changes);
    this.emit(state, "turn.completed", { requestId: turn.requestId });
    this.compact(state);
    if (finishReason !== "cancelled" && finalText) this.nameSession(state);
  }

  /**
   * After the first answer, a short title from the provider replaces the first question.
   * It comes a few seconds later, so it is saved and announced on its own.
   */
  private nameSession(state: SessionState): void {
    const titler = this.options.titler;
    if (!titler) return;
    const messages = state.entries.flatMap((entry) => (entry.kind === "message" ? [entry] : []));
    const answers = messages.filter((entry) => entry.role === "assistant");
    const asked = messages.find((entry) => entry.role === "user");
    // A question that is only files is about those files.
    const question = asked?.content.trim() || asked?.files?.map((file) => file.name).join(", ");
    if (answers.length !== 1 || !question) return;
    const sessionId = state.summary.id;
    const firstTitle = state.summary.title;
    void titler(state.summary.provider, question, answers[0].content).then(
      (title) => {
        if (!title || this.stopped) return;
        // Deleted meanwhile, or already retitled: leave it.
        const current = this.cache.get(sessionId)?.summary ?? this.options.sessions.summary(sessionId);
        if (!current || current.title !== firstTitle || title === firstTitle) return;
        const renamed = this.options.sessions.rename(sessionId, title);
        if (!renamed) return;
        const live = this.cache.get(sessionId);
        if (live) {
          live.summary = renamed;
          this.emit(live, "session.updated", { session: coachSessionInfo(renamed) });
        } else {
          // Not in memory: clients replaying from before now get a snapshot with the new title.
          this.invalidate(sessionId);
          return;
        }
        this.notifySessions({ kind: "upsert", session: renamed });
      },
      (error) => console.warn("[coach] could not name the conversation:", error)
    );
  }

  private failTurn(state: SessionState, turn: TurnState, failure: string, authError: boolean): void {
    if (turn.ended) return;
    turn.ended = true;
    if (state.turn === turn) state.turn = null;
    const changes: EntryChange[] = [];
    this.restoreResumedPrompt(state, turn, changes);
    this.commit(state, changes);
    this.emit(state, "turn.failed", { requestId: turn.requestId, message: failure, authError });
    this.compact(state);
  }

  private restoreResumedPrompt(state: SessionState, turn: TurnState, changes: EntryChange[]): void {
    const original = turn.resumedPrompt;
    if (!original) return;
    const index = state.entries.findIndex(
      (entry) => entry.kind === "coachPrompt" && entry.prompt.promptId === original.promptId
    );
    if (index >= 0) this.replaceEntry(state, index, { kind: "coachPrompt", prompt: original }, changes);
  }

  // ----- Entries and events -----

  private appendEntry(state: SessionState, entry: ChatEntry, changes: EntryChange[]): void {
    const normalized = this.normalize(entry);
    if (!normalized) return;
    state.entries = [...state.entries, normalized];
    changes.push({ event: "entry.appended", index: state.entries.length - 1, entry: normalized });
  }

  private replaceEntry(state: SessionState, index: number, entry: ChatEntry, changes: EntryChange[]): void {
    const normalized = this.normalize(entry);
    if (!normalized || index < 0 || index >= state.entries.length) return;
    const entries = [...state.entries];
    entries[index] = normalized;
    state.entries = entries;
    changes.push({ event: "entry.updated", index, entry: normalized });
  }

  private upsertEntry(state: SessionState, entry: ChatEntry, changes: EntryChange[]): void {
    const index = findChatEntryIndex(state.entries, entry);
    if (index < 0) this.appendEntry(state, entry, changes);
    else this.replaceEntry(state, index, entry, changes);
  }

  /** Keeps the in-memory timeline identical to what a reload reads back. */
  private normalize(entry: ChatEntry): ChatEntry | null {
    if (entry.kind === "toolNotice") return entry;
    const [persisted] = toPersistedEntries([entry]);
    const normalized = persisted ? this.options.sessions.normalize(persisted) : null;
    return normalized ? fromPersistedEntries([normalized])[0] ?? null : null;
  }

  /** Saves the transcript first, then announces each change, so no client sees an unsaved entry. */
  private commit(state: SessionState, changes: EntryChange[]): void {
    if (changes.length === 0) return;
    const previousTitle = state.summary.title;
    try {
      const summary = this.options.sessions.save(state.summary.id, toPersistedEntries(state.entries));
      if (summary) state.summary = summary;
    } catch (error) {
      console.warn("[coach] could not save the conversation:", error);
    }
    for (const change of changes) {
      this.emit(state, change.event, { index: change.index, entry: change.entry });
    }
    if (state.summary.title !== previousTitle) {
      this.emit(state, "session.updated", { session: coachSessionInfo(state.summary) });
    }
    this.notifySessions({ kind: "upsert", session: state.summary });
  }

  private emit<K extends CoachEventName>(
    state: SessionState,
    event: K,
    data: CoachEventDataMap[K],
    clientMessageId?: string
  ): CoachEventFrame {
    const frame = { event, sessionId: state.summary.id, seq: state.cursor + 1, data } as CoachEventFrame;
    state.cursor = frame.seq;
    state.log.push(frame);
    if (SAVED_COACH_EVENTS.has(event)) {
      try {
        this.options.events.append(
          state.summary.id,
          [{
            seq: frame.seq,
            kind: event,
            payloadJson: JSON.stringify(data),
            createdAt: new Date(this.now()).toISOString(),
            ...(clientMessageId ? { clientMessageId } : {})
          }],
          frame.seq
        );
      } catch (error) {
        console.warn("[coach] could not save an event:", error);
      }
    }
    for (const listener of [...state.subscribers, ...this.eventListeners]) {
      try {
        listener(frame);
      } catch (error) {
        console.warn("[coach] event listener failed:", error);
      }
    }
    return frame;
  }

  /** Drops a finished turn's live text (its entries carry the result) and old events. */
  private compact(state: SessionState): void {
    state.log = state.log.filter((frame) => SAVED_COACH_EVENTS.has(frame.event));
    const excess = state.log.length - this.maxRetainedEvents;
    if (excess > 0) {
      const dropped = state.log.splice(0, excess);
      state.floor = dropped[dropped.length - 1].seq;
      try {
        this.options.events.prune(state.summary.id, state.floor);
      } catch (error) {
        console.warn("[coach] could not prune events:", error);
      }
    }
  }

  // ----- Loading -----

  private state(sessionId: string): SessionState {
    const cached = this.cache.get(sessionId);
    if (cached) {
      cached.lastUsed = this.now();
      return cached;
    }
    const summary = this.options.sessions.summary(sessionId);
    if (!summary) throw new CoachHubError("not_found", "This Coach conversation no longer exists.");
    const entries = this.loadEntries(sessionId);
    const stored = this.options.events.list(sessionId, 0);
    const log: CoachEventFrame[] = [];
    const sends = new Map<string, string>();
    for (const row of stored) {
      let data: unknown;
      try {
        data = JSON.parse(row.payloadJson);
      } catch {
        continue;
      }
      const frame = { event: row.kind, sessionId, seq: row.seq, data } as CoachEventFrame;
      log.push(frame);
      if (frame.event === "turn.started" && row.clientMessageId) sends.set(row.clientMessageId, frame.data.requestId);
    }
    let cursor = Math.max(this.options.events.lastSeq(sessionId), log.at(-1)?.seq ?? 0);
    let floor = log.length > 0 ? log[0].seq - 1 : cursor;
    if (log.length === 0 && cursor === 0 && entries.length > 0) {
      // A conversation from before the hub: its entries have no events, so
      // only a snapshot can bring a client up to date.
      cursor = 1;
      floor = 1;
      this.options.events.reset(sessionId, cursor);
    }
    const state: SessionState = {
      summary,
      entries,
      cursor,
      floor,
      log,
      turn: null,
      sends,
      subscribers: new Set(),
      lastUsed: this.now()
    };
    this.cache.set(sessionId, state);
    this.recoverInterruptedTurn(state);
    this.evict();
    return state;
  }

  private loadEntries(sessionId: string): ChatEntry[] {
    return fromPersistedEntries(this.options.sessions.load(sessionId));
  }

  /** A turn that started before CorosLink stopped without ending gets its ending now. */
  private recoverInterruptedTurn(state: SessionState): void {
    let started: string | undefined;
    for (let index = state.log.length - 1; index >= 0; index -= 1) {
      const frame = state.log[index];
      if (frame.event === "turn.started") {
        started = frame.data.requestId;
        break;
      }
      if (frame.event === "turn.completed" || frame.event === "turn.failed") break;
    }
    if (!started) return;
    state.cursor += UNCLEAN_STOP_SEQ_GAP;
    state.floor = state.cursor;
    state.log = [];
    this.options.events.reset(state.summary.id, state.cursor);
    // An answered question with nothing after it was what the lost turn was answering.
    const changes: EntryChange[] = [];
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (entry.kind === "message") break;
      if (entry.kind === "coachPrompt") {
        if (entry.prompt.answeredAt !== undefined) {
          this.replaceEntry(state, index, { kind: "coachPrompt", prompt: unansweredPrompt(entry.prompt) }, changes);
        }
        break;
      }
    }
    this.commit(state, changes);
    this.emit(state, "turn.failed", {
      requestId: started,
      message: "Coach stopped before it finished, because CorosLink closed.",
      authError: false
    });
  }

  private evict(): void {
    if (this.cache.size <= this.maxCachedSessions) return;
    const idle = [...this.cache.values()]
      .filter((state) => !state.turn && state.subscribers.size === 0)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const state of idle) {
      if (this.cache.size <= this.maxCachedSessions) break;
      this.cache.delete(state.summary.id);
    }
  }

  private snapshot(state: SessionState): CoachSnapshot {
    const turn = state.turn;
    const activeTurn: CoachActiveTurn | null = turn
      ? {
          requestId: turn.requestId,
          text: turn.text,
          thinking: turn.thinking,
          ...(turn.tool ? { tool: turn.tool } : {}),
          ...(turn.stage ? { stage: turn.stage } : {})
        }
      : null;
    return {
      session: coachSessionInfo(state.summary),
      entries: [...state.entries],
      cursor: state.cursor,
      activeTurn
    };
  }

  private notifySessions(change: CoachSessionsChange): void {
    for (const listener of [...this.sessionListeners]) {
      try {
        listener(change);
      } catch (error) {
        console.warn("[coach] session listener failed:", error);
      }
    }
  }

  private rememberUnitSystem(unitSystem: UnitSystem): void {
    this.lastUnitSystem = unitSystem;
    try {
      this.options.unitSystem?.set(unitSystem);
    } catch {
      // Remembering units is a convenience for remote senders.
    }
  }

  private unitSystem(requested?: UnitSystem): UnitSystem {
    return requested ?? this.lastUnitSystem ?? this.options.unitSystem?.get() ?? "metric";
  }

  private assertRunning(): void {
    if (this.stopped) throw new CoachHubError("unsupported", "CorosLink is quitting.");
  }
}

/** The draft as the desktop card showed it after a successful upload. */
function uploadedDraft(
  draft: PlanDraftPreview,
  result: UploadPlanResult,
  destination: TrainingPlanDestination,
  uploadedAt: number
): PlanDraftPreview {
  const scheduledDates = new Map(
    result.entries.flatMap((entry) => {
      if (!entry.date) return [];
      const normalized = entry.date.replace(/-/g, "");
      if (!/^\d{8}$/.test(normalized)) return [];
      return [[
        entry.key,
        `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`
      ] as const];
    })
  );
  const clearDate = destination === "workoutLibrary" && draft.artifactType === "workout";
  return {
    ...draft,
    uploadedAt,
    entries: draft.entries.map((draftEntry) => {
      const scheduledDate = scheduledDates.get(draftEntry.key);
      return {
        ...draftEntry,
        scheduleDate: clearDate ? undefined : scheduledDate ?? draftEntry.scheduleDate,
        source: draftEntry.source
          ? {
              ...draftEntry.source,
              schedule_date: clearDate
                ? undefined
                : scheduledDate?.replace(/-/g, "") ?? draftEntry.source.schedule_date
            }
          : undefined
      };
    }),
    uploadResult: {
      workoutsScheduled: result.workoutsScheduled,
      workoutsCreated: result.workoutsCreated,
      destination: result.destination,
      localPlanId: result.localPlanId,
      groupedPlanCreated: result.groupedPlanCreated
    }
  };
}
