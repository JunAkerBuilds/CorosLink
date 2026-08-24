import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  createChatSession,
  deleteChatSession,
  deriveSessionTitleFromEntries,
  getChatSession,
  listChatSessions,
  migrateLegacyTranscriptRow,
  parseChatTranscriptJson,
  restoreChatPlanDraftSources,
  saveChatSession
} = await import(`${distUrl("chatHistoryStore.js")}?cacheBust=${Date.now()}`);

function createMemoryDatabase() {
  /** @type {Map<string, { id: string, provider: string, title: string, messages_json: string, created_at: string, updated_at: string }>} */
  const rows = new Map();

  return {
    listSessions(provider) {
      return [...rows.values()]
        .filter((row) => row.provider === provider)
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime()
        );
    },
    getSession(id) {
      return rows.get(id);
    },
    insertSession(id, provider, title, messagesJson, createdAt, updatedAt) {
      rows.set(id, {
        id,
        provider,
        title,
        messages_json: messagesJson,
        created_at: createdAt,
        updated_at: updatedAt
      });
    },
    updateSession(id, title, messagesJson, updatedAt) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, {
        ...row,
        title,
        messages_json: messagesJson,
        updated_at: updatedAt
      });
    },
    deleteSession(id) {
      rows.delete(id);
    }
  };
}

assert.deepEqual(parseChatTranscriptJson("not-json"), []);
assert.deepEqual(parseChatTranscriptJson("{}"), []);
assert.deepEqual(parseChatTranscriptJson('[{"role":"nope","content":"x"}]'), []);

assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([
      { kind: "message", role: "user", content: "Hello" },
      {
        kind: "message",
        role: "assistant",
        content: "Hi",
        reasoningSummary: "I should greet the athlete briefly.",
        source: {
          snapshotIncluded: true,
          mcpEnabled: false,
          mcpUsed: false,
          mcpTools: []
        }
      }
    ])
  ),
  [
    { kind: "message", role: "user", content: "Hello" },
    {
      kind: "message",
      role: "assistant",
      content: "Hi",
      reasoningSummary: "I should greet the athlete briefly.",
      source: {
        snapshotIncluded: true,
        mcpEnabled: false,
        mcpUsed: false,
        mcpTools: []
      }
    }
  ]
);

const waitingPromptEntry = {
  kind: "coachPrompt",
  prompt: {
    promptId: "prompt-1",
    question: "Which strength option should Coach use?",
    choices: [
      {
        id: "choice-1",
        label: "Use split squats",
        description: "Recommended supported alternative.",
        response: "Use split squats."
      },
      {
        id: "choice-2",
        label: "I’ll provide the exact name",
        response: "I’ll provide the exact COROS exercise name."
      }
    ],
    allowCustom: true
  }
};
assert.deepEqual(
  parseChatTranscriptJson(JSON.stringify([waitingPromptEntry])),
  [waitingPromptEntry]
);

const oneOffWorkoutEntry = {
  kind: "planDraft",
  draft: {
    draftId: "workout-1",
    artifactType: "workout",
    name: "Full Gym Push Day",
    summary: "Strength · 16 sets · structured",
    entries: [{
      key: "push-day",
      name: "Full Gym Push Day",
      sport: "strength",
      volume: "16 sets",
      scheduleDate: "2026-07-31",
      saveToLibrary: true,
      workoutType: "structured",
      stepsSummary: "warmup 10 min → Chest Press Machine 4 × 8 reps",
      source: {
        key: "push-day",
        name: "Full Gym Push Day",
        sport: "strength",
        save_to_library: true,
        steps: [
          {
            kind: "warmup",
            target_type: "time",
            target_duration_seconds: 600
          },
          {
            kind: "training",
            target_type: "reps",
            target_reps: 8,
            exercise_id: "1338",
            exercise_name: "Chest Press Machine",
            sets: 4,
            rest_type: 1,
            rest_value: 120,
            intensity: { type: "weight", mode: "weight", value: 0, unit: "kg" }
          }
        ]
      }
    }],
    conflicts: [],
    warnings: [],
    uploadedAt: 1234,
    uploadResult: {
      workoutsScheduled: 1,
      workoutsCreated: 0,
      destination: "calendar"
    }
  }
};
assert.equal(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.artifactType,
  "workout"
);
assert.equal(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.uploadResult.destination,
  "calendar"
);
const groupedLocalPlanEntry = structuredClone(oneOffWorkoutEntry);
groupedLocalPlanEntry.draft.artifactType = "plan";
groupedLocalPlanEntry.draft.uploadResult.destination = "localPlan";
groupedLocalPlanEntry.draft.uploadResult.localPlanId = "plan:coach:workout-1";
groupedLocalPlanEntry.draft.uploadResult.groupedPlanCreated = true;
assert.equal(
  parseChatTranscriptJson(JSON.stringify([groupedLocalPlanEntry]))[0].draft.uploadResult.destination,
  "localPlan"
);
assert.deepEqual(
  parseChatTranscriptJson(JSON.stringify([oneOffWorkoutEntry]))[0].draft.entries[0].source,
  oneOffWorkoutEntry.draft.entries[0].source
);
const flattenedWorkoutEntry = structuredClone(oneOffWorkoutEntry);
delete flattenedWorkoutEntry.draft.entries[0].source;
const restoredWorkoutEntry = restoreChatPlanDraftSources(
  parseChatTranscriptJson(JSON.stringify([flattenedWorkoutEntry])),
  (draftId) => draftId === oneOffWorkoutEntry.draft.draftId
    ? JSON.stringify(oneOffWorkoutEntry.draft)
    : undefined
)[0];
assert.deepEqual(
  restoredWorkoutEntry.draft.entries[0].source,
  oneOffWorkoutEntry.draft.entries[0].source
);
const legacyPlanEntry = structuredClone(oneOffWorkoutEntry);
delete legacyPlanEntry.draft.artifactType;
assert.equal(
  parseChatTranscriptJson(JSON.stringify([legacyPlanEntry]))[0].draft.artifactType,
  "plan"
);
assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([
      {
        ...waitingPromptEntry,
        prompt: {
          ...waitingPromptEntry.prompt,
          answer: "Use split squats.",
          selectedChoiceId: "choice-1",
          answeredAt: 1234
        }
      }
    ])
  )[0].prompt,
  {
    ...waitingPromptEntry.prompt,
    answer: "Use split squats.",
    selectedChoiceId: "choice-1",
    answeredAt: 1234
  }
);

assert.equal(
  deriveSessionTitleFromEntries([
    { kind: "message", role: "user", content: "How was my long run yesterday?" }
  ]),
  "How was my long run yesterday?"
);

const db = createMemoryDatabase();

const migrated = migrateLegacyTranscriptRow(
  "chatgpt",
  JSON.stringify([{ kind: "message", role: "user", content: "Plan my week" }]),
  "2026-07-01T12:00:00.000Z",
  db
);
assert.equal(migrated.title, "Plan my week");
assert.equal(migrated.messageCount, 1);

const first = createChatSession("chatgpt", db);
assert.equal(first.title, "New chat");
assert.equal(first.messageCount, 0);

const saved = saveChatSession(
  first.id,
  [{ kind: "message", role: "user", content: "Build a 5K plan" }],
  db
);
assert.ok(saved);
assert.equal(saved.title, "Build a 5K plan");
assert.equal(saved.preview, "Build a 5K plan");
assert.equal(saved.messageCount, 1);

assert.deepEqual(getChatSession(first.id, db), [
  { kind: "message", role: "user", content: "Build a 5K plan" }
]);

const second = createChatSession("chatgpt", db);
assert.equal(listChatSessions("chatgpt", db).length, 3);

deleteChatSession(first.id, db);
assert.equal(listChatSessions("chatgpt", db).length, 2);

const local = createChatSession("local", db);
saveChatSession(
  local.id,
  [{ kind: "message", role: "assistant", content: "Easy day tomorrow." }],
  db
);
assert.equal(listChatSessions("local", db).length, 1);
assert.equal(listChatSessions("chatgpt", db).length, 2);

const claude = createChatSession("claude-code", db);
saveChatSession(
  claude.id,
  [{ kind: "message", role: "assistant", content: "Claude CLI response." }],
  db
);
assert.equal(listChatSessions("claude-code", db).length, 1);
assert.equal(listChatSessions("local", db).length, 1);

const openRouter = createChatSession("openrouter", db);
saveChatSession(
  openRouter.id,
  [{ kind: "message", role: "assistant", content: "OpenRouter response." }],
  db
);
assert.equal(listChatSessions("openrouter", db).length, 1);
assert.equal(listChatSessions("chatgpt", db).length, 2);

console.log("chat history store tests passed");
