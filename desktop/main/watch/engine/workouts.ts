// Every workout in the watch's sport-record file as sync items, as the CorosKit helper's `Syncer.workouts` made them
// (the retired clink-watch helper's main.swift): an `activity` for each, its FIT file written once and kept as
// fit/<watchActivityId>.fit, and its `activity.detail` once per id. Activities come first, then the details.
import { activityDetailBody, activityItems, COLLECTION_ACTIVITY_DETAIL, type SyncItemBody } from "./activityItems";
import { recordingFromFit } from "./activityRecording";
import { writeFit } from "./fitWriter";
import { decodeSportRecord, type SportRecordFile } from "./sportRecord";
import { summaryActivity, workoutSummary, type ActivitySummary } from "./workoutSummary";

/** What the engine keeps between syncs: the FIT files by watch activity id, and the ids whose detail was sent. */
export interface KeptWorkouts {
  readFit(id: string): Uint8Array | null;
  writeFit(id: string, bytes: Uint8Array): void;
  /** Ids already sent as `activity.detail`; the caller saves `details` from the result. */
  details: Set<string>;
}

export interface WorkoutItems {
  items: SyncItemBody[];
  /** Workouts decoded from the file, blips included. */
  count: number;
  /** `kept.details` with this sync's details added, sorted as the helper saved them. */
  details: string[];
}

/** The `activity` and `activity.detail` items for the sport-record file `file`. A file that isn't one gives none. */
export function workoutItems(file: Uint8Array, kept: KeptWorkouts, thresholdHR?: number): WorkoutItems {
  const details = new Set(kept.details);
  let decoded: SportRecordFile;
  try {
    decoded = decodeSportRecord(file);
  } catch {
    return { items: [], count: 0, details: [...details].sort() };
  }
  const detailItems: SyncItemBody[] = [];
  const summaries: ActivitySummary[] = [];
  for (const session of decoded.sessions) {
    const summary = summaryActivity(workoutSummary(session));
    summaries.push(summary);
    let fit = kept.readFit(session.watchActivityId);
    if (!fit) {
      try {
        const made = writeFit(session);
        try { kept.writeFit(session.watchActivityId, made); } catch { /* kept next time, as the helper's try? */ }
        fit = made;
      } catch {
        fit = null;
      }
    }
    if (details.has(summary.id) || !fit) continue;
    const recording = recordingFromFit(fit);
    if (!recording) continue;
    detailItems.push({ collection: COLLECTION_ACTIVITY_DETAIL, id: summary.id, body: activityDetailBody(recording, summary.sport, thresholdHR) });
    details.add(summary.id);
  }
  return { items: [...activityItems(summaries), ...detailItems], count: summaries.length, details: [...details].sort() };
}
