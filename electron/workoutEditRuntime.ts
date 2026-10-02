import { getSetting, setSetting } from "./database";
import { formatScheduleDay } from "./corosWorkoutBuilder";
import { getTrainingHubStatus, resolveStrengthWorkoutEditSource, calculateExistingWorkoutProgram, writeReviewedStrengthProgram, listStrengthEditLibraryRefs, listStrengthEditCalendarRefs } from "./trainingHubService";
import { WorkoutEditService } from "./workoutEditService";
import type { WorkoutEditRef } from "./types";

let instance: WorkoutEditService | undefined;
function account(): string {
  const status = getTrainingHubStatus();
  if (!status.authenticated || !status.userId || !status.regionId) throw new Error("Connect your COROS Training Hub account first.");
  return `${status.regionId}:${status.userId}`;
}
export function workoutEdits(): WorkoutEditService {
  return instance ??= new WorkoutEditService({
    account,
    today: () => formatScheduleDay(new Date()),
    read: resolveStrengthWorkoutEditSource,
    find: async input => {
      const refs: WorkoutEditRef[] = [];
      if (input.source !== "calendar") refs.push(...await listStrengthEditLibraryRefs());
      if (input.source !== "library") {
        refs.push(...await listStrengthEditCalendarRefs(input.startDay!, input.endDay!));
      }
      return { refs: [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()], exclusions: [] };
    },
    preview: (_source, program) => calculateExistingWorkoutProgram(program),
    write: (source, program) => writeReviewedStrengthProgram(source, program, account()),
    load: () => getSetting("workouts.reviewedEdits.v1"),
    persist: value => setSetting("workouts.reviewedEdits.v1", value)
  });
}
