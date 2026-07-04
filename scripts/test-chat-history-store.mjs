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
      source: {
        snapshotIncluded: true,
        mcpEnabled: false,
        mcpUsed: false,
        mcpTools: []
      }
    }
  ]
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

console.log("chat history store tests passed");
