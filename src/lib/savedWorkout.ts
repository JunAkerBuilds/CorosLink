// A builder workout as C-LINK keeps it on the calendar (a `training.workout` item, src/data/local/workouts.ts). Pure, so
// the desktop's main process makes the same shape (the move from CorosLink).
import type { SavedWorkout } from "@/data/workouts";
import { calendarSport, DEFAULT_NAME, docSummary, docToLegacy, docTotals, pacingFor, type BuilderDoc } from "@/lib/builder";
import { t } from "@/lib/i18n";
import { totals, type Pacing, type Sport } from "@/lib/workout";

/** A builder workout as the calendar store keeps it. `pacing` is the athlete's usual paces when they are known. */
export function savedFromDoc(doc: BuilderDoc, date: string, id: string, pacing: Record<Sport, Pacing> | null, repeatWeeks = 1, now: Date = new Date()): SavedWorkout {
  const sport = calendarSport(doc.sport);
  const own = pacingFor(doc.sport, pacing);
  const items = docToLegacy(doc) ?? [];
  return {
    id, name: doc.name.trim() || t(DEFAULT_NAME), sport, date, repeatWeeks, items, doc,
    summary: { detail: docSummary(doc, own), metres: Math.round(docTotals(doc, own).meters), load: own && items.length > 0 ? totals(items, own).load : 0 },
    savedAt: now.toISOString(),
  };
}
