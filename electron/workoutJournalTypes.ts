// A workout's journal: a brief written before it (by the athlete or the Coach)
// and a debrief written after it. Entries are local to CorosLink — COROS has
// no field for either.

export type WorkoutJournalAuthor = "athlete" | "coach";
export type WorkoutCueOutcome = "hit" | "partial" | "missed";
export type WorkoutFuelOutcome = "good" | "mixed" | "bad";
export type WorkoutFeel = 1 | 2 | 3 | 4 | 5;

/**
 * One workout: a scheduled occurrence, a recorded activity, or both once the
 * calendar pairs them. Name and sport are snapshots for the Coach's listing
 * and are never used to match.
 */
export interface WorkoutJournalRef {
  /** YYYYMMDD. */
  happenDay: string;
  planId?: string;
  idInPlan?: string;
  activityId?: string;
  workoutName?: string;
  sportType?: number;
}

export interface WorkoutFocusCue {
  id: string;
  text: string;
}

export interface WorkoutBrief {
  /** What the session is for, in a line. */
  goal?: string;
  /** Things to watch for during the session; checked off in the debrief. */
  cues: WorkoutFocusCue[];
  fuelPlan?: string;
  notes?: string;
  author: WorkoutJournalAuthor;
  /** The athlete changed a brief the Coach wrote. */
  edited?: boolean;
  updatedAt: string;
}

export interface WorkoutFueling {
  taken?: string;
  /** Something new being tried; the Coach looks these up later. */
  experiment?: boolean;
  outcome?: WorkoutFuelOutcome;
}

export interface WorkoutDebrief {
  feel?: WorkoutFeel;
  /** Keyed by brief cue id. */
  cueOutcomes: Record<string, WorkoutCueOutcome>;
  fueling?: WorkoutFueling;
  notes?: string;
  /** Logged by the Coach from what the athlete said in chat. */
  viaCoach?: boolean;
  updatedAt: string;
}

export interface WorkoutJournalEntry extends WorkoutJournalRef {
  entryId: string;
  brief?: WorkoutBrief;
  debrief?: WorkoutDebrief;
  createdAt: string;
  updatedAt: string;
}

export type WorkoutBriefInput = Omit<WorkoutBrief, "author" | "edited" | "updatedAt">;
export type WorkoutDebriefInput = Omit<WorkoutDebrief, "viaCoach" | "updatedAt">;

/** `null` clears a section; leaving it out keeps what is saved. */
export interface WorkoutJournalSaveInput {
  ref: WorkoutJournalRef;
  brief?: WorkoutBriefInput | null;
  debrief?: WorkoutDebriefInput | null;
}
