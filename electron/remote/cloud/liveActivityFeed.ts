import type { ChatEntry } from "../../chatTranscript";
import type { CoachEventFrame } from "../../coachHub/coachContract";
import {
  LIVE_UPDATE_MIN_INTERVAL_SECONDS,
  REQUEST_ID_PATTERN,
  SESSION_ID_PATTERN,
  type LiveEvent,
  type LivePhase,
  type LiveRunningPhase
} from "./relayProtocol";

/**
 * C-LINK's Coach Live Activity while iOS has suspended the app: what Coach is
 * doing in each running turn, reported to the relay, which pushes it to the
 * Lock Screen. Only the phase and the reply's word count leave this computer;
 * the text and the tool names (which say what health data Coach reads) don't.
 *
 * The phase follows C-LINK's own reading of the active turn
 * (`LiveActivities.content`): calling a tool, else writing once a word
 * arrived, else thinking. An end says whether the turn left an approval card
 * or a question waiting, as C-LINK's `waitsForMember` does.
 */

export interface LiveTurnReport {
  sessionId: string;
  requestId: string;
  event: LiveEvent;
  phase: LivePhase;
  words: number;
}

export interface LiveActivityFeedOptions {
  send: (report: LiveTurnReport) => Promise<unknown>;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /**
   * A phase change waits at least this long after the turn's last report.
   * Keep it above the relay's LIVE_UPDATE_MIN_INTERVAL_SECONDS, so the relay
   * never has to skip one.
   */
  phaseIntervalMs?: number;
  /** A word count alone waits at least this long. */
  wordsIntervalMs?: number;
}

interface Track {
  requestId: string;
  words: number;
  inWord: boolean;
  tool: boolean;
  /** Entries appended during the turn, by timeline index: whether each waits for the member. */
  waiting: Map<number, boolean>;
  sent: { phase: LiveRunningPhase; words: number };
  sentAt: number;
  timer: unknown;
  timerDue: number;
}

/** Whether an entry waits for the member: an unanswered question or a card not yet approved. */
export function entryWaitsForMember(entry: ChatEntry): boolean {
  switch (entry.kind) {
    case "coachPrompt":
      return entry.prompt.answer === undefined || entry.prompt.answer === null;
    case "corosAction":
      return entry.preview.state === "pending";
    case "workoutDelete":
      return (entry.preview.state ?? "pending") === "pending";
    case "planDraft":
      return !entry.draft.uploadedAt;
    case "workoutEdit":
      return entry.preview.state === "awaiting_confirmation";
    default:
      return false;
  }
}

export class LiveActivityFeed {
  private readonly tracks = new Map<string, Track>();
  /** One report in flight per conversation, so the relay sees them in order. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly phaseIntervalMs: number;
  private readonly wordsIntervalMs: number;

  constructor(private readonly options: LiveActivityFeedOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((run, ms) => {
        const timer = setTimeout(run, ms);
        timer.unref?.();
        return timer;
      });
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.phaseIntervalMs = options.phaseIntervalMs ?? LIVE_UPDATE_MIN_INTERVAL_SECONDS * 2 * 1000;
    this.wordsIntervalMs = Math.max(options.wordsIntervalMs ?? 30_000, this.phaseIntervalMs);
  }

  note(frame: CoachEventFrame): void {
    const sessionId = frame.sessionId;
    if (!SESSION_ID_PATTERN.test(sessionId)) return;
    if (frame.event === "turn.started") {
      this.drop(sessionId);
      if (!REQUEST_ID_PATTERN.test(frame.data.requestId)) return;
      // The phone starts its activity thinking, so that needs no report.
      this.tracks.set(sessionId, {
        requestId: frame.data.requestId,
        words: 0,
        inWord: false,
        tool: false,
        waiting: new Map(),
        sent: { phase: "thinking", words: 0 },
        sentAt: 0,
        timer: null,
        timerDue: 0
      });
      return;
    }
    const track = this.tracks.get(sessionId);
    if (!track) return;
    switch (frame.event) {
      case "turn.delta":
        if (frame.data.requestId !== track.requestId) return;
        track.tool = false;
        for (const character of frame.data.delta) {
          const space = /\s/u.test(character);
          if (!space && !track.inWord) track.words += 1;
          track.inWord = !space;
        }
        this.schedule(sessionId, track);
        return;
      case "turn.tool":
        if (frame.data.requestId !== track.requestId) return;
        track.tool = frame.data.status === "call" && Boolean(frame.data.tool);
        this.schedule(sessionId, track);
        return;
      case "entry.appended":
        track.waiting.set(frame.data.index, entryWaitsForMember(frame.data.entry));
        return;
      case "entry.updated":
        if (track.waiting.has(frame.data.index)) track.waiting.set(frame.data.index, entryWaitsForMember(frame.data.entry));
        return;
      case "turn.completed":
      case "turn.failed": {
        if (frame.data.requestId !== track.requestId) return;
        this.drop(sessionId);
        const waits = [...track.waiting.values()].some(Boolean);
        const phase: LivePhase = frame.event === "turn.failed" ? "failed" : waits ? "needsYou" : "replied";
        this.enqueue({ sessionId, requestId: track.requestId, event: "end", phase, words: track.words });
        return;
      }
      default:
        return;
    }
  }

  /** Turns being followed, for tests. */
  get followed(): number {
    return this.tracks.size;
  }

  private phase(track: Track): LiveRunningPhase {
    if (track.tool) return "usingTool";
    return track.words > 0 ? "writing" : "thinking";
  }

  /** Reports the turn's state once its interval since the last report has passed; newer state replaces waiting state. */
  private schedule(sessionId: string, track: Track): void {
    const phase = this.phase(track);
    if (phase === track.sent.phase && track.words === track.sent.words) return;
    const interval = phase === track.sent.phase ? this.wordsIntervalMs : this.phaseIntervalMs;
    const due = track.sentAt + interval;
    if (due <= this.now()) {
      this.flush(sessionId, track);
      return;
    }
    if (track.timer && track.timerDue <= due) return;
    if (track.timer) this.clearTimer(track.timer);
    track.timerDue = due;
    track.timer = this.setTimer(() => {
      track.timer = null;
      if (this.tracks.get(sessionId) === track) this.schedule(sessionId, track);
    }, due - this.now());
  }

  private flush(sessionId: string, track: Track): void {
    if (track.timer) this.clearTimer(track.timer);
    track.timer = null;
    const phase = this.phase(track);
    track.sent = { phase, words: track.words };
    track.sentAt = this.now();
    this.enqueue({ sessionId, requestId: track.requestId, event: "update", phase, words: track.words });
  }

  private drop(sessionId: string): void {
    const track = this.tracks.get(sessionId);
    if (track?.timer) this.clearTimer(track.timer);
    this.tracks.delete(sessionId);
  }

  private enqueue(report: LiveTurnReport): void {
    const previous = this.queues.get(report.sessionId) ?? Promise.resolve();
    const next = previous.then(() => this.options.send(report)).catch(() => undefined);
    this.queues.set(report.sessionId, next);
    void next.then(() => {
      if (this.queues.get(report.sessionId) === next) this.queues.delete(report.sessionId);
    });
  }
}
