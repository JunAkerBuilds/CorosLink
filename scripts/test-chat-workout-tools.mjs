import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildPlanPreview,
  formatEntryStepsSummary,
  validatePlanDraft
} = await import(`${distUrl("corosWorkoutBuilder.js")}?cacheBust=${Date.now()}`);

const draft = {
  name: "Test Week",
  workouts: [
    {
      key: "intervals",
      name: "400 Repeats",
      schedule_date: "20991201",
      steps: [
        {
          repeat: 6,
          steps: [
            {
              kind: "training",
              target_type: "distance",
              target_distance_meters: 400,
              pace: "4:30/km"
            },
            {
              kind: "rest",
              target_type: "time",
              target_duration_seconds: 90
            }
          ]
        }
      ]
    }
  ]
};

const validation = validatePlanDraft(draft, { todayDay: "20260101" });
assert.equal(validation.ok, true);

const stepsSummary = formatEntryStepsSummary(draft.workouts[0]);
assert.match(stepsSummary ?? "", /6x/);

const preview = buildPlanPreview("draft-test-1", draft);
assert.equal(preview.entries[0]?.stepsSummary, stepsSummary);
assert.match(preview.entries[0]?.stepsSummary ?? "", /training/);

console.log("test-chat-workout-tools: ok");
