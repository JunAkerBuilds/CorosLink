// First-run setup's steps, kept in the address (/setup?step=…&from=…) so a reload (sample data turning on, a backup
// restoring) lands back on the same step. Pure, so it can be tested without a window.

export type Step = "source" | "phone" | "sports" | "coach" | "mac" | "done";
/** Where the data comes from: the phone, the sample athlete, or a backup restored on the first step. */
export type Source = "phone" | "look" | "backup";

const STEPS: readonly Step[] = ["source", "phone", "sports", "coach", "mac", "done"];
const SOURCES: readonly Source[] = ["phone", "look", "backup"];

export const SETUP_PATH = "/setup";

/** The list down the side: five steps; the phone step is "Connect". */
export const LIST = [
  { id: "source", label: "Your data" },
  { id: "connect", label: "Connect" },
  { id: "sports", label: "Your sports" },
  { id: "coach", label: "Coach" },
  { id: "mac", label: "This Mac" },
] as const;
export type ListId = (typeof LIST)[number]["id"];

export interface Place { step: Step; source: Source }

export function readPlace(search: string): Place {
  const q = new URLSearchParams(search);
  const step = STEPS.find((s) => s === q.get("step")) ?? "source";
  const source = SOURCES.find((s) => s === q.get("from")) ?? "phone";
  return { step, source };
}

export const placeHref = ({ step, source }: Place): string => `${SETUP_PATH}?step=${step}&from=${source}`;

/** Where a step sits on the list (the done step is past all five). */
export function listIndex(step: Step): number {
  return step === "source" ? 0 : step === "phone" ? 1 : step === "sports" ? 2 : step === "coach" ? 3 : step === "mac" ? 4 : 5;
}

export function nextStep(step: Step, source: Source): Step {
  if (step === "source") return source === "phone" ? "phone" : "sports";
  return STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)];
}

export function backStep(step: Step, source: Source): Step {
  if (step === "sports") return source === "phone" ? "phone" : "source";
  return STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
}

export interface Notes { phone: string | null; sports: number; coach: string | null }

/** The short note beside each step once it's done. */
export function stepNote(id: ListId, source: Source, notes: Notes): string {
  switch (id) {
    case "source": return source === "phone" ? "Your phone" : source === "look" ? "Sample data" : "A backup";
    case "connect": return source === "look" ? "Skipped" : source === "backup" ? "Restored" : notes.phone ?? "Later";
    case "sports": return notes.sports ? `${notes.sports} picked` : "None";
    case "coach": return notes.coach ?? "Later";
    case "mac": return "";
  }
}

/** Coach's pose and line for each step, as on the phone's setup. */
export function coachSays(step: Step, { paired, hasData }: { paired: boolean; hasData: boolean }): { pose: string; line: string } {
  switch (step) {
    case "source": return { pose: "ponder", line: "Where does your watch data live today? I'll bring it all here." };
    case "phone": return paired
      ? { pose: "cheer", line: "Got it! Your history is on its way. Keep going while it copies." }
      : { pose: "listen", line: "Scan this with your phone and I'll copy everything over." };
    case "sports": return { pose: "think", line: hasData ? "Here's what I found in your workouts. Anything to add?" : "Which sports do you do? I'll talk about those, not just running." };
    case "coach": return { pose: "write", line: "I need a brain to think with. Pick the one you already pay for." };
    case "mac": return { pose: "listen", line: "Last bit. How should I behave on this Mac?" };
    case "done": return { pose: "cheer", line: "You're all set! Every workout you do helps me earn a new look." };
  }
}

/** "9:42" for a number of seconds. */
export const countdown = (seconds: number): string => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
