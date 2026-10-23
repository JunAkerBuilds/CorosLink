// Review cards for the Coach's writes outside COROS MCP and the strength
// editor: moving calendar workouts, adding a target race, updating the watch's
// zones. The Coach prepares one; nothing changes until the athlete approves it.
// Type-only, so the renderer and Node's strip-types tests can import it.

export type CoachReviewAction = "addTargetRace" | "updateZones";

/** One line of the change: what it is, and what it becomes. */
export interface CoachReviewItem {
  label: string;
  before?: string;
  after: string;
  /** Set once the change was approved. */
  result?: { ok: boolean; message?: string };
}

export type CoachReviewState = "pending" | "saving" | "saved" | "partial" | "failed" | "dismissed";

export interface CoachReviewPreview {
  requestId: string;
  action: CoachReviewAction;
  /** "Add target race", "Update watch zones". */
  title: string;
  /** The Coach's plain-language reason for the change. */
  summary: string;
  items: CoachReviewItem[];
  /** What the athlete should know before approving (a watch to connect, a plan the workout leaves). */
  notes?: string[];
  createdAt: number;
  state: CoachReviewState;
  message?: string;
}
