import type { ClaudeCodePermissions, CorosMcpTool } from "./types";

export const COROS_WORKOUT_WRITES = new Set([
  "createSingleWorkout", "createScheduledWorkout", "scheduleWorkout",
  "updateWorkoutDetails", "updateScheduledWorkout", "createTrainingPlan", "updateTrainingPlan"
]);

const READ_PERMISSIONS: Record<keyof ClaudeCodePermissions, readonly string[]> = {
  recentActivities: [
    "querySportRecords", "getActivityDetail", "analyzeActivityDetail",
    "queryActivityLapData", "queryCustomActivityLapData",
    "get_recent_activities", "get_activity_details", "get_activity_detail"
  ],
  trainingMetrics: [
    "queryFitnessAssessmentOverview", "queryTrainingLoadAssessment", "queryRecoveryStatus",
    "queryAvgHeartRate", "queryRestingHeartRate", "queryStressLevel", "queryStressTimeSeries",
    "queryHealthCheckTimeSeries", "get_training_metrics", "get_fitness_metrics",
    "get_recovery_metrics", "get_training_load"
  ],
  upcomingWorkouts: [
    "queryTrainingSchedule", "queryWorkoutLibrary", "queryWorkoutDetails",
    "queryScheduledWorkoutDetails", "queryTrainingPlanLibrary", "queryTrainingPlanDetails",
    "get_upcoming_workouts", "get_training_calendar", ...COROS_WORKOUT_WRITES
  ],
  sleepData: ["querySleepData", "querySleepHrv", "get_sleep_summary", "get_sleep_data"],
  fullActivityFiles: ["downloadActivityFitFiles", "queryActivityFitFileDownloadUrls"]
};

export function claudeCanUseCorosTool(name: string, permissions: ClaudeCodePermissions): boolean {
  // The daily summary contains both sleep and training/health metrics.
  if (name === "queryDailyHealthData") return permissions.trainingMetrics && permissions.sleepData;
  return Object.entries(READ_PERMISSIONS).some(([permission, names]) =>
    permissions[permission as keyof ClaudeCodePermissions] && names.includes(name)
  );
}

export function isCorosWorkoutWrite(name: string): boolean {
  return name.startsWith("coros__") && COROS_WORKOUT_WRITES.has(name.slice(7));
}

// COROS currently nests $defs under course while its references are rooted at #/$defs.
// Hoist those definitions for standard JSON Schema validation, without changing the wire payload.
export function corosInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = structuredClone(schema);
  const defs: Record<string, unknown> = { ...record(result.$defs) };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = record(value);
    for (const [name, definition] of Object.entries(record(object.$defs))) {
      if (defs[name] && JSON.stringify(defs[name]) !== JSON.stringify(definition)) throw new Error("Conflicting COROS schema definitions.");
      defs[name] = definition;
    }
    Object.values(object).forEach(child => { if (child && typeof child === "object") visit(child); });
  };
  visit(result);
  if (Object.keys(defs).length) result.$defs = defs;
  return result;
}
/** Keep the server's live schema; all providers receive the same review contract. */
export function coachMcpTools(tools: CorosMcpTool[]): CorosMcpTool[] {
  return tools.flatMap(tool => {
    if (!isCorosWorkoutWrite(tool.name)) return [tool];
    try {
      const schema = corosInputSchema(tool.inputSchema);
      return [{
        ...tool,
        description: "COROSLINK REVIEW: Calling this tool prepares a review card only; it does not save yet. " +
          "The athlete saves with the card's Save to COROS button. After receiving awaiting_confirmation, " +
          "describe the preview and stop; never claim it was saved or call another creation tool for the same request. " +
          "Provide review_summary explaining the specific change in plain language. " + (tool.description ?? ""),
        inputSchema: {
          ...schema,
          properties: {
            ...(schema.properties as Record<string, unknown> ?? {}),
            review_summary: { type: "string", description: "Short athlete-facing summary of exactly what will change, including the workout name and destination. No internal IDs." }
          },
          required: [...(schema.required as string[] ?? []), "review_summary"]
        }
      }];
    } catch (error) {
      console.warn(`[chat] Unavailable COROS tool ${tool.name}: ${error instanceof Error ? error.message : "invalid schema"}`);
      return [];
    }
  });
}

export function corosCoachRoutingInstructions(tools: CorosMcpTool[]): string {
  const names = new Set(tools.map(tool => tool.name));
  const has = (name: string) => names.has(`coros__${name}`);
  const lines = [
    "For existing Strength edits, use find_editable_workouts, read_workout_for_edit, and prepare_workout_edit or prepare_exercise_load_update. These edit in place after app review; never draft duplicates. Equipment matching requires catalog exercise IDs, not load alone. Native plans and today/past occurrences are excluded. Report per-workout status, not blanket success.",
    "Combine COROS live health/recovery readings with CorosLink's local activity, FIT analysis, and charts. " +
      "Use recent trends and the athlete's goals when proposing changes; a recovery score alone does not prescribe a hard session.",
    "Choose one authoring route for each request. Official workout tools prepare review cards in CorosLink; " +
      "no write occurs until the athlete clicks Save to COROS. Never call both an official creation tool and a local draft tool for the same workout.",
    "Official MCP course numbers differ from local sport enums: MCP course sportType=4 is a REST DAY, never Strength. " +
      "Use local search_coros_exercises plus draft_workout/draft_training_plan for Strength, HYROX, swimming, climbing, " +
      "skiing, mixed-sport plans, and any target/intensity the official schema cannot represent. " +
      "Preserve the requested sport, target and intensity; do not weaken the prescription to fit MCP.",
    "Local draft_workout remains the route when the athlete has not chosen Library versus Calendar. " +
      "Use local drafts when the relevant official tool is unavailable. Advice alone does not authorize preparing account changes.",
    "After a write error with an uncertain outcome, inspect the destination before trying again; do not create a duplicate or switch authoring routes automatically. " +
      "Distinguish pending review, accepted save, and verified read-back in your reply."
  ];
  if (has("createSingleWorkout")) lines.push("For a new running/cycling/trail-running workout explicitly requested in the library, use coros__createSingleWorkout when its schema can represent every step.");
  if (has("createScheduledWorkout")) lines.push("For a new running/cycling/trail-running workout on a named date, use coros__createScheduledWorkout when its schema can represent every step.");
  if (has("createTrainingPlan")) lines.push("For a supported 4–16 week COROS plan with an explicit start date, read coros__queryTrainingPlanLibrary first, then use coros__createTrainingPlan. For other durations or a local plan draft, use draft_training_plan.");
  if (has("queryWorkoutLibrary")) lines.push("Find reusable workouts with coros__queryWorkoutLibrary; read coros__queryWorkoutDetails before scheduling or editing. Keep all returned IDs as strings and never show them to the athlete.");
  if (has("scheduleWorkout")) lines.push("To repeat an existing library workout, use coros__scheduleWorkout with its exact ID and date. This supports existing Strength and swimming templates without recreating their exercises.");
  if (has("updateWorkoutDetails")) lines.push("To edit a library template, read coros__queryWorkoutDetails and use coros__updateWorkoutDetails only when editable=true. Begin with the returned complete course and preserve unrequested fields; scheduled copies remain separate.");
  if (has("updateScheduledWorkout")) lines.push("To change a workout on a date, read coros__queryTrainingSchedule and coros__queryScheduledWorkoutDetails, then use coros__updateScheduledWorkout for an editable standalone copy. Do not create a replacement workout beside the original.");
  if (has("updateTrainingPlan")) lines.push("For a workout belonging to a plan, find the editable in-progress execution through coros__queryTrainingPlanLibrary and coros__queryTrainingPlanDetails, then use coros__updateTrainingPlan. Each submitted day replaces that whole day's sessions; preserve the other sessions that day.");
  return lines.join("\n");
}
