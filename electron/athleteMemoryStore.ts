import { requireDatabase } from "./database";
import {
  createAthleteFactId,
  isAthleteFactCategory,
  planAthleteFactWrite,
  sortAthleteFacts,
  type AthleteFact,
  type AthleteFactAuthor,
  type AthleteFactInput,
  type AthleteMemoryChange
} from "./athleteMemoryModel";

// The athlete memory lives in its own table, created on first use. It belongs
// to whoever uses this computer, like the Coach's custom instructions, so it
// stays across COROS accounts and data modes.

interface FactRow {
  fact_id: string;
  category: string;
  text: string;
  author: string;
  created_at: string;
  updated_at: string;
}

type Listener = (facts: AthleteFact[]) => void;

let preparedFor: unknown;
const listeners = new Set<Listener>();

function database() {
  const db = requireDatabase();
  if (preparedFor !== db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS athlete_memory (
        fact_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    preparedFor = db;
  }
  return db;
}

function toFact(row: FactRow): AthleteFact {
  return {
    id: row.fact_id,
    category: isAthleteFactCategory(row.category) ? row.category : "other",
    text: row.text,
    author: row.author === "athlete" ? "athlete" : "coach",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listAthleteFacts(): AthleteFact[] {
  const rows = database()
    .prepare("SELECT fact_id, category, text, author, created_at, updated_at FROM athlete_memory")
    .all() as FactRow[];
  return sortAthleteFacts(rows.map(toFact));
}

function write(fact: AthleteFact): void {
  database()
    .prepare(
      `INSERT INTO athlete_memory (fact_id, category, text, author, created_at, updated_at)
       VALUES (@id, @category, @text, @author, @createdAt, @updatedAt)
       ON CONFLICT(fact_id) DO UPDATE SET
         category = excluded.category,
         text = excluded.text,
         author = excluded.author,
         updated_at = excluded.updated_at`
    )
    .run(fact);
}

function changed(): void {
  const facts = listAthleteFacts();
  for (const listener of listeners) {
    try {
      listener(facts);
    } catch (error) {
      console.warn("[athlete-memory] listener failed:", error);
    }
  }
}

/** Add a fact, or replace one by id; the same words twice are kept once. */
export function saveAthleteFact(input: AthleteFactInput, author: AthleteFactAuthor): AthleteMemoryChange {
  const facts = listAthleteFacts();
  const taken = new Set(facts.map((fact) => fact.id));
  const change = planAthleteFactWrite(facts, input, author, new Date().toISOString(), () => {
    let id = createAthleteFactId();
    while (taken.has(id)) id = createAthleteFactId();
    return id;
  });
  if (change.action !== "unchanged") {
    write(change.fact);
    changed();
  }
  return change;
}

export function deleteAthleteFact(id: string): AthleteMemoryChange | undefined {
  const fact = listAthleteFacts().find((candidate) => candidate.id === id);
  if (!fact) return undefined;
  database().prepare("DELETE FROM athlete_memory WHERE fact_id = ?").run(id);
  changed();
  return { action: "forgot", fact, previous: fact };
}

/**
 * Undo a write: put the earlier version back, or remove a fact that was new.
 * A fact edited since is left alone, so Undo never discards the athlete's edit.
 */
export function undoAthleteMemoryChange(change: Pick<AthleteMemoryChange, "action" | "fact" | "previous">): AthleteFact[] {
  const current = listAthleteFacts().find((fact) => fact.id === change.fact.id);
  const untouched = current !== undefined && current.updatedAt === change.fact.updatedAt && current.text === change.fact.text;
  if (change.action === "forgot" ? current !== undefined : !untouched) {
    throw new Error("This fact changed since. Edit it in Coach settings → Memory.");
  }
  if (change.action === "remembered") {
    database().prepare("DELETE FROM athlete_memory WHERE fact_id = ?").run(change.fact.id);
  } else if ((change.action === "updated" || change.action === "forgot") && change.previous) {
    write(change.previous);
  }
  changed();
  return listAthleteFacts();
}

export function clearAthleteMemory(): void {
  database().prepare("DELETE FROM athlete_memory").run();
  changed();
}

/** Hears every change, from the Coach or Coach settings, so open views can follow. */
export function onAthleteMemoryChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
