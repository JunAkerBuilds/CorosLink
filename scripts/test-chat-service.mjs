import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  LocalToolCallAccumulator,
  detectLocalChatServersRequest,
  isLocalToolsUnsupportedError,
  normalizeLocalToolCall,
  normalizeLocalChatBaseUrl,
  parseLocalChatContentDelta,
  streamLocalChatCompletion,
  testLocalChatConnectionRequest
} = await import(`${distUrl("localChatProvider.js")}?cacheBust=${Date.now()}`);
const { parseFunctionCallArguments } = await import(
  `${distUrl("chatToolArguments.js")}?cacheBust=${Date.now()}`
);

assert.equal(
  normalizeLocalChatBaseUrl("localhost:11434"),
  "http://localhost:11434/v1"
);
assert.equal(
  normalizeLocalChatBaseUrl("http://localhost:1234/v1/"),
  "http://localhost:1234/v1"
);
assert.throws(
  () => normalizeLocalChatBaseUrl("http://192.168.1.2:11434/v1"),
  /localhost/
);
assert.throws(
  () => normalizeLocalChatBaseUrl("http://localhost:11434/api"),
  /server root or \/v1/
);

assert.equal(
  parseLocalChatContentDelta({
    choices: [{ delta: { content: "Run easy today." } }]
  }),
  "Run easy today."
);

const accumulator = new LocalToolCallAccumulator();
accumulator.addEvent({
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            function: { name: "get_activity", arguments: "{\"id\":" }
          }
        ]
      }
    }
  ]
});
accumulator.addEvent({
  choices: [
    {
      delta: {
        tool_calls: [
          { index: 0, function: { arguments: "\"abc\"}" } }
        ]
      }
    }
  ]
});
assert.deepEqual(accumulator.toCalls(), [
  { call_id: "call_1", name: "get_activity", arguments: "{\"id\":\"abc\"}" }
]);

assert.deepEqual(
  normalizeLocalToolCall(
    {
      call_id: "call_fit",
      name: 'downloadActivityFitFiles "ueryActivityFitFileDownloadUrls',
      arguments: "{}"
    },
    [
      {
        name: "downloadActivityFitFiles",
        description: "Download activity FIT files",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "queryActivityFitFileDownloadUrls",
        description: "Return activity FIT file URLs",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  ),
  {
    call_id: "call_fit",
    name: "downloadActivityFitFiles",
    arguments: "{}"
  }
);

const noArgTool = {
  name: "queryFitnessAssessment",
  inputSchema: { type: "object", properties: {} }
};
assert.deepEqual(
  parseFunctionCallArguments(
    { name: "queryFitnessAssessment", arguments: "" },
    noArgTool
  ),
  {}
);
assert.deepEqual(
  parseFunctionCallArguments(
    { name: "queryFitnessAssessment", arguments: "{\"since\":\"2026-07-01\"}" },
    noArgTool
  ),
  { since: "2026-07-01" }
);
assert.deepEqual(
  parseFunctionCallArguments(
    { name: "queryFitnessAssessment", arguments: "undefined" },
    noArgTool
  ),
  {}
);
assert.throws(
  () =>
    parseFunctionCallArguments(
      { name: "queryActivity", arguments: "undefined" },
      {
        name: "queryActivity",
        inputSchema: { type: "object", required: ["id"], properties: {} }
      }
    ),
  /Invalid arguments/
);

assert.equal(isLocalToolsUnsupportedError(400, "tools are unsupported"), true);
assert.equal(isLocalToolsUnsupportedError(500, "tools are unsupported"), false);

const originalFetch = globalThis.fetch;

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }
  );
}

globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.includes(":11434")) {
    return new Response(JSON.stringify({ data: [{ id: "llama3.2" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (href.includes(":1234")) {
    return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response("not found", { status: 404 });
};

const discovery = await detectLocalChatServersRequest(undefined, 50);
assert.deepEqual(
  discovery.servers.map((server) => ({
    label: server.label,
    baseUrl: server.baseUrl,
    ok: server.ok,
    models: server.models
  })),
  [
    {
      label: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      ok: true,
      models: ["llama3.2"]
    },
    {
      label: "LM Studio",
      baseUrl: "http://localhost:1234/v1",
      ok: true,
      models: ["local-model"]
    }
  ]
);

globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.includes(":11434/v1/models")) {
    return new Response(JSON.stringify({ object: "list", data: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (href.includes(":11434/api/tags")) {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  throw new Error("not running");
};

const emptyOllamaDiscovery = await detectLocalChatServersRequest(undefined, 50);
assert.equal(emptyOllamaDiscovery.servers[0]?.label, "Ollama");
assert.equal(emptyOllamaDiscovery.servers[0]?.ok, true);
assert.deepEqual(emptyOllamaDiscovery.servers[0]?.models, []);
assert.match(emptyOllamaDiscovery.servers[0]?.message ?? "", /no models/);
assert.equal(emptyOllamaDiscovery.servers[1]?.ok, false);

globalThis.fetch = async () =>
  streamResponse([
    'data: {"choices":[{"delta":{"content":"Easy "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"run."}}]}\n\n',
    "data: [DONE]\n\n"
  ]);

let streamed = "";
const success = await streamLocalChatCompletion({
  config: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    toolsEnabled: false
  },
  instructions: "Coach",
  messages: [{ role: "user", content: "Plan today" }],
  tools: [],
  maxToolRounds: 2,
  signal: new AbortController().signal,
  onToken: (delta) => {
    streamed += delta;
  },
  onToolsDisabled: () => {
    throw new Error("tools should not be disabled");
  },
  onToolCall: async () => "",
  onToolCallStart: () => undefined,
  onToolCallError: () => undefined
});
assert.equal(streamed, "Easy run.");
assert.equal(success.fullText, "Easy run.");

globalThis.fetch = async () =>
  new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
const missingModel = await testLocalChatConnectionRequest({
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.2",
  toolsEnabled: true
});
assert.equal(missingModel.ok, false);
assert.match(missingModel.message, /not found/);

const requests = [];
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body ?? "{}")));
  if (requests.length === 1) {
    return new Response("tools are unsupported", { status: 400 });
  }
  return streamResponse([
    'data: {"choices":[{"delta":{"content":"Snapshot fallback."}}]}\n\n',
    "data: [DONE]\n\n"
  ]);
};

let toolsDisabled = false;
const fallback = await streamLocalChatCompletion({
  config: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    toolsEnabled: true
  },
  instructions: "USE TOOLS",
  fallbackInstructions: "SNAPSHOT ONLY",
  messages: [{ role: "user", content: "How am I doing?" }],
  tools: [
    {
      name: "list_activities",
      description: "List activities",
      inputSchema: { type: "object", properties: {} }
    }
  ],
  maxToolRounds: 2,
  signal: new AbortController().signal,
  onToken: () => undefined,
  onToolsDisabled: () => {
    toolsDisabled = true;
  },
  onToolCall: async () => "",
  onToolCallStart: () => undefined,
  onToolCallError: () => undefined
});
assert.equal(toolsDisabled, true);
assert.equal(fallback.fullText, "Snapshot fallback.");
assert.ok("tools" in requests[0]);
assert.equal("tools" in requests[1], false);
assert.equal(requests[1].messages[0].content, "SNAPSHOT ONLY");

globalThis.fetch = originalFetch;

const { readChatSettingsFromStore, saveChatSettingsToStore } = await import(
  `${distUrl("chatSettingsStore.js")}?cacheBust=${Date.now()}`
);

const settingsValues = new Map();
let storedApiKey = "";
const fakeStore = {
  get: (key) => settingsValues.get(key),
  set: (key, value) => {
    settingsValues.set(key, value);
  },
  delete: (keys) => {
    for (const key of keys) settingsValues.delete(key);
  }
};
const fakeApiKeyStore = {
  hasApiKey: () => Boolean(storedApiKey),
  saveApiKey: (apiKey) => {
    storedApiKey = apiKey;
  },
  clearApiKey: () => {
    storedApiKey = "";
  }
};

const saved = saveChatSettingsToStore(fakeStore, fakeApiKeyStore, {
  provider: "local",
  local: {
    baseUrl: "localhost:11434",
    model: "llama3.2",
    hasApiKey: false,
    apiKey: "secret",
    toolsEnabled: false
  }
});
assert.equal(saved.provider, "local");
assert.equal(saved.local.baseUrl, "http://localhost:11434/v1");
assert.equal(saved.local.model, "llama3.2");
assert.equal(saved.local.toolsEnabled, false);
assert.equal(saved.local.apiKey, undefined);
assert.equal(saved.local.hasApiKey, true);
assert.equal(storedApiKey, "secret");

const loaded = readChatSettingsFromStore(fakeStore, fakeApiKeyStore);
assert.deepEqual(loaded, saved);

const cleared = saveChatSettingsToStore(fakeStore, fakeApiKeyStore, {
  ...loaded,
  local: { ...loaded.local, clearApiKey: true }
});
assert.equal(cleared.local.hasApiKey, false);
assert.equal(storedApiKey, "");

console.log("chat service tests passed");
