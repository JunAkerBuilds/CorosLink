import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  clearChatTranscript,
  loadChatTranscript,
  parseChatTranscriptJson,
  saveChatTranscript
} = await import(`${distUrl("chatHistoryStore.js")}?cacheBust=${Date.now()}`);

function createMemoryDatabase() {
  /** @type {Map<string, { provider: string, messages_json: string, updated_at: string }>} */
  const rows = new Map();
  return {
    getTranscript(provider) {
      return rows.get(provider);
    },
    saveTranscript(provider, messagesJson, updatedAt) {
      rows.set(provider, {
        provider,
        messages_json: messagesJson,
        updated_at: updatedAt
      });
    },
    deleteTranscript(provider) {
      rows.delete(provider);
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

assert.deepEqual(
  parseChatTranscriptJson(
    JSON.stringify([{ role: "user", content: "Legacy message shape" }])
  ),
  [{ kind: "message", role: "user", content: "Legacy message shape" }]
);

const db = createMemoryDatabase();

saveChatTranscript(
  "chatgpt",
  [{ kind: "message", role: "user", content: "Plan my week" }],
  db
);
assert.deepEqual(loadChatTranscript("chatgpt", db), [
  { kind: "message", role: "user", content: "Plan my week" }
]);

saveChatTranscript(
  "local",
  [{ kind: "message", role: "assistant", content: "Easy day tomorrow." }],
  db
);
assert.deepEqual(loadChatTranscript("local", db), [
  { kind: "message", role: "assistant", content: "Easy day tomorrow." }
]);
assert.deepEqual(loadChatTranscript("chatgpt", db), [
  { kind: "message", role: "user", content: "Plan my week" }
]);

clearChatTranscript("chatgpt", db);
assert.deepEqual(loadChatTranscript("chatgpt", db), []);
assert.deepEqual(loadChatTranscript("local", db), [
  { kind: "message", role: "assistant", content: "Easy day tomorrow." }
]);

console.log("chat history store tests passed");
