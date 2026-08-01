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
const {
  buildCoachInputPrompt,
  getChatInteractionTools,
  handleChatInteractionTool
} = await import(
  `${distUrl("chatInteractionTools.js")}?cacheBust=${Date.now()}`
);
const {
  buildResponsesRequest,
  extractReasoningSummaryDelta,
  extractResponseTextDelta
} = await import(
  `${distUrl("chatResponsesProtocol.js")}?cacheBust=${Date.now()}`
);
const {
  buildCoachInstructions,
  buildCoachSportCapabilityGuide,
  formatCoachDashboard,
  formatRecentActivityMix,
  formatUpcomingWorkoutSport
} = await import(`${distUrl("chatCoachContext.js")}?cacheBust=${Date.now()}`);

const coachInstructions = buildCoachInstructions();
assert.match(coachInstructions, /multi-sport endurance and strength-training coach/);
assert.match(coachInstructions, /Honor every sport the athlete explicitly requests/);
assert.match(coachInstructions, /Never add an unfamiliar sport merely for variety/);
assert.match(coachInstructions, /Open Water Swim is not Pool Swim/);
assert.match(coachInstructions, /exactly one standalone workout/);
assert.match(coachInstructions, /call draft_workout/);
assert.match(coachInstructions, /Workout Library or Calendar/);
assert.match(coachInstructions, /never disguise it as a one-workout training plan/);
assert.match(coachInstructions, /exercise_resolution_required/);
assert.match(coachInstructions, /call search_coros_exercises first/);
assert.match(coachInstructions, /naming mismatch alone is never a reason/);
assert.match(coachInstructions, /call the same draft tool again in the same response/);
assert.match(coachInstructions, /request_coach_input/);

const interactionTool = getChatInteractionTools()[0];
assert.equal(interactionTool.name, "request_coach_input");
assert.deepEqual(interactionTool.inputSchema.required, ["question", "choices"]);

const prompt = buildCoachInputPrompt(
  {
    question: "Which squat option should I use?",
    choices: [
      {
        label: "Use split squats",
        description: "Uses a supported unilateral movement.",
        response: "Use split squats for the heavy gym sessions."
      },
      { label: "I’ll provide the COROS name" }
    ]
  },
  "prompt-test"
);
assert.equal(prompt.promptId, "prompt-test");
assert.equal(prompt.allowCustom, true);
assert.equal(prompt.choices[0].response, "Use split squats for the heavy gym sessions.");
assert.equal(prompt.choices[1].response, "I’ll provide the COROS name");
assert.throws(
  () =>
    buildCoachInputPrompt({
      question: "Choose",
      choices: [{ label: "Only one" }]
    }),
  /at least two/
);

let emittedPrompt;
const interactionResult = JSON.parse(
  handleChatInteractionTool(
    "request_coach_input",
    {
      question: "Choose a gym movement",
      choices: [{ label: "Split squat" }, { label: "Leg press" }],
      allow_custom: false
    },
    (nextPrompt) => {
      emittedPrompt = nextPrompt;
    }
  )
);
assert.equal(interactionResult.status, "waiting_for_athlete");
assert.equal(emittedPrompt.allowCustom, false);

const responsesRequest = buildResponsesRequest(
  "gpt-test",
  "Coach instructions",
  [{ type: "message", role: "user" }],
  [{ type: "function", name: "get_metrics" }]
);
assert.deepEqual(responsesRequest.reasoning, { summary: "auto" });
assert.equal(responsesRequest.tool_choice, "auto");
assert.equal(
  "reasoning" in
    buildResponsesRequest("gpt-test", "Coach", [], [], false),
  false
);
assert.equal(
  extractReasoningSummaryDelta({
    type: "response.reasoning_summary_text.delta",
    delta: "Reviewing recent training load."
  }),
  "Reviewing recent training load."
);
assert.equal(
  extractReasoningSummaryDelta({
    type: "response.reasoning_text.delta",
    delta: "raw reasoning"
  }),
  ""
);
assert.equal(
  extractResponseTextDelta({
    type: "response.output_text.delta",
    delta: "Your plan is ready."
  }),
  "Your plan is ready."
);

const capabilityGuide = buildCoachSportCapabilityGuide();
for (const sport of [
  "run",
  "trailRun",
  "bike",
  "swim",
  "strength",
  "indoorClimb",
  "bouldering",
  "xcSki",
  "hyrox"
]) {
  assert.match(capabilityGuide, new RegExp(`sport=${sport}(?:\\)|;)`));
}

const activityMix = formatRecentActivityMix(
  [
    { activityId: "run-1", sportType: 100, duration: 3_600, distance: 10_000, trainingLoad: 90 },
    { activityId: "bike-1", sportType: 200, duration: 5_400, distance: 40_000, trainingLoad: 80 },
    { activityId: "bike-2", sportType: 201, duration: 3_600, distance: 25_000, trainingLoad: 60 },
    { activityId: "swim-1", sportType: 300, duration: 1_800, distance: 1_500, trainingLoad: 35 },
    { activityId: "open-water-1", sportType: 301, duration: 2_400, distance: 2_000, trainingLoad: 45 }
  ],
  "metric"
);
assert.match(activityMix, /Bike \(plan sport=bike\): 2 activities/);
assert.match(activityMix, /Run \(plan sport=run\): 1 activity/);
assert.match(activityMix, /Pool Swim \(plan sport=swim\): 1 activity/);
assert.match(activityMix, /Open Water Swim \(not directly plan-authorable\)/);
assert.equal(formatUpcomingWorkoutSport(2), "Bike");
assert.equal(formatUpcomingWorkoutSport(9), "HYROX");
assert.equal(formatUpcomingWorkoutSport(undefined), undefined);

const dashboardSummary = formatCoachDashboard({
  rhr: 48,
  recoveryPct: 82,
  racePredictor: {
    staminaLevel: 71,
    runScoreList: [{ distanceLabel: "5K", predictSeconds: 1_200 }]
  }
});
assert.match(dashboardSummary, /Running stamina level: 71/);
assert.match(dashboardSummary, /Running race predictions: 5K ~20:00/);

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
const { getChatGptModelCandidates } = await import(
  `${distUrl("chatModels.js")}?cacheBust=${Date.now()}`
);

assert.deepEqual(
  getChatGptModelCandidates("gpt-5.6-terra", "gpt-5.5"),
  ["gpt-5.6-terra"]
);
assert.deepEqual(
  getChatGptModelCandidates(undefined, "gpt-5.5").slice(0, 2),
  ["gpt-5.5", "gpt-5.6-sol"]
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
  provider: "claude-code",
  chatgpt: {
    model: "gpt-5.6-terra"
  },
  claudeCode: {
    model: "sonnet",
    executablePath: "/opt/claude/bin/claude",
    lastConnectionStatus: "connected",
    lastCheckedAt: "2026-07-10T12:00:00.000Z",
    permissions: {
      recentActivities: true,
      trainingMetrics: false,
      upcomingWorkouts: true,
      sleepData: true,
      fullActivityFiles: false
    }
  },
  local: {
    baseUrl: "localhost:11434",
    model: "llama3.2",
    hasApiKey: false,
    apiKey: "secret",
    toolsEnabled: false
  }
});
assert.equal(saved.provider, "claude-code");
assert.equal(saved.chatgpt.model, "gpt-5.6-terra");
assert.equal(saved.claudeCode.executablePath, "/opt/claude/bin/claude");
assert.equal(saved.claudeCode.model, "sonnet");
assert.equal(saved.claudeCode.lastConnectionStatus, "connected");
assert.deepEqual(saved.claudeCode.permissions, {
  recentActivities: true,
  trainingMetrics: false,
  upcomingWorkouts: true,
  sleepData: true,
  fullActivityFiles: false
});
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
