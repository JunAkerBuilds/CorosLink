// Facts the athlete told the Coach that should outlast one conversation:
// goals, injuries, the days they can train, equipment, preferences. The Coach
// writes them as it learns them; the athlete sees, edits and deletes them in
// Coach settings. Pure and type-only imports, so Node's strip-types tests load it.

export const ATHLETE_FACT_CATEGORIES = [
  "goal",
  "injury",
  "availability",
  "equipment",
  "preference",
  "health",
  "other"
] as const;

export type AthleteFactCategory = (typeof ATHLETE_FACT_CATEGORIES)[number];

/** Who wrote the fact's current text. */
export type AthleteFactAuthor = "coach" | "athlete";

export interface AthleteFact {
  /** Short and stable, so the Coach can name it when it forgets or replaces it. */
  id: string;
  category: AthleteFactCategory;
  text: string;
  author: AthleteFactAuthor;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** What a write did, for the transcript ("Coach remembered: …") and its Undo. */
export interface AthleteMemoryChange {
  action: "remembered" | "updated" | "forgot" | "unchanged";
  fact: AthleteFact;
  /** The fact before an update or a forget, which Undo puts back. */
  previous?: AthleteFact;
}

/** A memory write as the transcript shows it, with what Undo needs. */
export interface AthleteMemoryNotice {
  noticeId: string;
  action: "remembered" | "updated" | "forgot";
  fact: AthleteFact;
  previous?: AthleteFact;
  /** ISO 8601. */
  at: string;
  /** The athlete undid it from the transcript. */
  undone?: boolean;
}

export const MAX_ATHLETE_FACTS = 60;
export const MAX_ATHLETE_FACT_LENGTH = 280;

export const ATHLETE_FACT_CATEGORY_LABELS: Record<AthleteFactCategory, string> = {
  goal: "Goal",
  injury: "Injury or niggle",
  availability: "Training days",
  equipment: "Equipment",
  preference: "Preference",
  health: "Health",
  other: "Other"
};

export function isAthleteFactCategory(value: unknown): value is AthleteFactCategory {
  return typeof value === "string" && (ATHLETE_FACT_CATEGORIES as readonly string[]).includes(value);
}

/** One line of plain text: control characters and line breaks become spaces, capped without splitting a character. */
export function normalizeAthleteFactText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, MAX_ATHLETE_FACT_LENGTH).join("").trim();
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export interface AthleteFactInput {
  /** Replace this fact instead of adding one. */
  id?: string;
  category: unknown;
  text: unknown;
}

/**
 * The change a write makes to `facts`, or an error the caller reports. A fact
 * already kept in the same words is left alone rather than saved twice.
 */
export function planAthleteFactWrite(
  facts: readonly AthleteFact[],
  input: AthleteFactInput,
  author: AthleteFactAuthor,
  now: string,
  newId: () => string
): AthleteMemoryChange {
  const text = normalizeAthleteFactText(input.text);
  if (!text) throw new Error("Write the fact as one short sentence.");
  const category = isAthleteFactCategory(input.category) ? input.category : "other";
  if (input.id !== undefined) {
    const previous = facts.find((fact) => fact.id === input.id);
    if (!previous) throw new Error("That fact is no longer saved. Read the athlete's memory again.");
    if (previous.category === category && previous.text === text) return { action: "unchanged", fact: previous };
    return {
      action: "updated",
      previous,
      fact: { ...previous, category, text, author, updatedAt: now }
    };
  }
  const duplicate = facts.find((fact) => fact.category === category && sameText(fact.text, text));
  if (duplicate) return { action: "unchanged", fact: duplicate };
  if (facts.length >= MAX_ATHLETE_FACTS) {
    throw new Error(`The athlete's memory is full (${MAX_ATHLETE_FACTS} facts). Replace or forget an outdated fact first.`);
  }
  return {
    action: "remembered",
    fact: { id: newId(), category, text, author, createdAt: now, updatedAt: now }
  };
}

/** A short id the Coach can repeat back: "f" and six base-36 characters. */
export function createAthleteFactId(random: () => number = Math.random): string {
  let id = "f";
  for (let index = 0; index < 6; index += 1) id += Math.floor(random() * 36).toString(36);
  return id;
}

/** Facts grouped by category in a fixed order, oldest first within each. */
export function sortAthleteFacts(facts: readonly AthleteFact[]): AthleteFact[] {
  const order = new Map(ATHLETE_FACT_CATEGORIES.map((category, index) => [category, index]));
  return [...facts].sort(
    (left, right) =>
      (order.get(left.category) ?? 99) - (order.get(right.category) ?? 99) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

/** The memory as the Coach reads it: one line per fact, with its id and when it was last confirmed. */
export function formatAthleteMemoryForCoach(facts: readonly AthleteFact[]): string {
  if (!facts.length) return "";
  return sortAthleteFacts(facts)
    .map((fact) =>
      `- [${fact.id}] ${ATHLETE_FACT_CATEGORY_LABELS[fact.category]}: ${fact.text} ` +
      `(${fact.author === "athlete" ? "athlete wrote" : "noted"} ${fact.updatedAt.slice(0, 10)})`
    )
    .join("\n");
}
