import type {
  ChatMessage,
  CorosMcpTool,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  LocalChatServerCandidate
} from "./types";

export const DEFAULT_LOCAL_CHAT_BASE_URL = "http://localhost:11434/v1";

const LOCAL_CHAT_SERVER_CANDIDATES: Array<
  Pick<LocalChatServerCandidate, "kind" | "label" | "baseUrl">
> = [
  {
    kind: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1"
  },
  {
    kind: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1"
  }
];

export interface LocalChatRuntimeConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  toolsEnabled: boolean;
}

export interface LocalToolCall {
  call_id: string;
  name: string;
  arguments: string;
}

interface LocalChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface StreamLocalChatOptions {
  config: LocalChatRuntimeConfig;
  instructions: string;
  fallbackInstructions?: string;
  messages: ChatMessage[];
  tools: CorosMcpTool[];
  maxToolRounds: number;
  signal: AbortSignal;
  onToken: (delta: string) => void;
  onToolsDisabled: () => void;
  onToolCall: (call: LocalToolCall) => Promise<string>;
  onToolCallStart: (call: LocalToolCall) => void;
  onToolCallError: (call: LocalToolCall, message: string) => void;
}

export function normalizeLocalChatBaseUrl(input: string): string {
  const raw = input.trim() || DEFAULT_LOCAL_CHAT_BASE_URL;
  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw)
    ? raw
    : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Local model URL is not valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local model URL must use http or https.");
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Local model URL must point to localhost or 127.0.0.1.");
  }

  const pathName = url.pathname.replace(/\/+$/, "");
  if (!pathName || pathName === "/") {
    url.pathname = "/v1";
  } else if (pathName === "/v1") {
    url.pathname = "/v1";
  } else {
    throw new Error("Local model URL must end at the server root or /v1.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildLocalFunctionTools(
  tools: CorosMcpTool[]
): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

export function parseSseData(frame: string): string | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join("");
}

export function parseLocalChatContentDelta(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const choices = (event as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";

  let text = "";
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const delta = (choice as { delta?: { content?: unknown } }).delta;
    if (typeof delta?.content === "string") {
      text += delta.content;
    }
  }
  return text;
}

export class LocalToolCallAccumulator {
  private readonly calls = new Map<
    number,
    { call_id: string; name: string; arguments: string }
  >();

  addEvent(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const choices = (event as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) return;

    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as { delta?: { tool_calls?: unknown } }).delta;
      if (!Array.isArray(delta?.tool_calls)) continue;
      for (const rawCall of delta.tool_calls) {
        if (!rawCall || typeof rawCall !== "object") continue;
        const call = rawCall as {
          index?: unknown;
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const index =
          typeof call.index === "number" && Number.isInteger(call.index)
            ? call.index
            : this.calls.size;
        const existing = this.calls.get(index) ?? {
          call_id: "",
          name: "",
          arguments: ""
        };
        if (typeof call.id === "string" && call.id) {
          existing.call_id = call.id;
        }
        if (typeof call.function?.name === "string") {
          existing.name += call.function.name;
        }
        if (typeof call.function?.arguments === "string") {
          existing.arguments += call.function.arguments;
        }
        this.calls.set(index, existing);
      }
    }
  }

  toCalls(): LocalToolCall[] {
    return [...this.calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        call_id: call.call_id || `local-tool-call-${index}`,
        name: call.name,
        arguments: call.arguments
      }))
      .filter((call) => call.name);
  }
}

export function normalizeLocalToolCall(
  call: LocalToolCall,
  tools: CorosMcpTool[]
): LocalToolCall {
  if (tools.some((tool) => tool.name === call.name)) {
    return call;
  }

  const rawName = call.name.trim();
  const match = [...tools]
    .sort((left, right) => right.name.length - left.name.length)
    .find((tool) => {
      if (!rawName.startsWith(tool.name)) {
        return false;
      }
      const next = rawName[tool.name.length];
      return next === undefined || /[\s"'`({:,\-]/.test(next);
    });

  return match ? { ...call, name: match.name } : call;
}

export function normalizeLocalToolCalls(
  calls: LocalToolCall[],
  tools: CorosMcpTool[]
): LocalToolCall[] {
  return calls.map((call) => normalizeLocalToolCall(call, tools));
}

export function isLocalToolsUnsupportedError(
  status: number,
  detail: string
): boolean {
  if (![400, 404, 422].includes(status)) return false;
  return /tool|tools|tool_choice|function_call|functions/i.test(detail);
}

export async function detectLocalChatServersRequest(
  apiKey?: string,
  timeoutMs = 1200
): Promise<LocalChatDiscovery> {
  const servers = await Promise.all(
    LOCAL_CHAT_SERVER_CANDIDATES.map(async (candidate) => {
      const baseUrl = normalizeLocalChatBaseUrl(candidate.baseUrl);
      try {
        const models = await fetchCandidateModels(
          candidate.kind,
          baseUrl,
          apiKey,
          timeoutMs
        );
        return {
          ...candidate,
          baseUrl,
          ok: true,
          models,
          message:
            models.length > 0
              ? `${candidate.label} is running.`
              : `${candidate.label} is running, but no models are installed or loaded.`
        } satisfies LocalChatServerCandidate;
      } catch (error) {
        return {
          ...candidate,
          baseUrl,
          ok: false,
          models: [],
          message:
            error instanceof Error ? error.message : `${candidate.label} not found.`
        } satisfies LocalChatServerCandidate;
      }
    })
  );
  return { servers };
}

export async function testLocalChatConnectionRequest(
  config: LocalChatRuntimeConfig,
  signal?: AbortSignal
): Promise<LocalChatConnectionTest> {
  const baseUrl = normalizeLocalChatBaseUrl(config.baseUrl);
  const model = config.model.trim();
  if (!model) {
    return {
      ok: false,
      message: "Choose a local model name first.",
      normalizedBaseUrl: baseUrl
    };
  }

  try {
    const models = await fetchLocalModels(baseUrl, config.apiKey, undefined, signal);
    if (!models.includes(model)) {
      return {
        ok: false,
        message:
          models.length > 0
            ? `Model "${model}" was not found on the local server.`
            : "The local server responded, but did not list any models.",
        normalizedBaseUrl: baseUrl,
        models
      };
    }

    return {
      ok: true,
      message: `Connected to local model "${model}".`,
      normalizedBaseUrl: baseUrl,
      models
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Local model check failed.",
      normalizedBaseUrl: baseUrl
    };
  }
}

export async function streamLocalChatCompletion(
  options: StreamLocalChatOptions
): Promise<{ fullText: string }> {
  const baseUrl = normalizeLocalChatBaseUrl(options.config.baseUrl);
  const model = options.config.model.trim();
  if (!model) {
    throw new Error("Choose a local model name first.");
  }

  let fullText = "";
  let input = buildLocalInputMessages(options.instructions, options.messages);
  let tools = options.config.toolsEnabled
    ? buildLocalFunctionTools(options.tools)
    : [];
  let toolsDisabled = false;

  for (let round = 0; round < options.maxToolRounds; round++) {
    const opened = await openLocalChatStream(
      baseUrl,
      model,
      input,
      tools,
      options.config.apiKey,
      options.signal
    );

    if ("toolsUnsupported" in opened) {
      tools = [];
      toolsDisabled = true;
      input = buildLocalInputMessages(
        options.fallbackInstructions ?? options.instructions,
        options.messages
      );
      options.onToolsDisabled();
      continue;
    }

    const { delta, functionCalls: rawFunctionCalls } = await readLocalChatStream(
      opened.response,
      options.signal,
      options.onToken
    );
    const functionCalls = normalizeLocalToolCalls(rawFunctionCalls, options.tools);
    fullText += delta;

    if (functionCalls.length === 0) {
      break;
    }

    input.push({
      role: "assistant",
      content: "",
      tool_calls: functionCalls.map((call) => ({
        id: call.call_id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments
        }
      }))
    });

    for (const call of functionCalls) {
      options.onToolCallStart(call);
      let output: string;
      try {
        output = await options.onToolCall(call);
      } catch (toolError) {
        output =
          "Error: " +
          (toolError instanceof Error ? toolError.message : "tool call failed");
        options.onToolCallError(call, output);
      }
      input.push({
        role: "tool",
        tool_call_id: call.call_id,
        content: output
      });
    }
  }

  if (toolsDisabled && fullText.length === 0) {
    // The retry should normally produce content; this keeps the failure mode
    // explicit if the local server accepts the no-tool request but emits nothing.
    return { fullText };
  }
  return { fullText };
}

async function fetchLocalModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<string[]> {
  const response = await fetch(joinLocalEndpoint(baseUrl, "models"), {
    method: "GET",
    signal: signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
    headers: buildLocalHeaders(apiKey)
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Local model server rejected /models (${response.status}). ${truncate(bodyText, 240)}`
    );
  }

  const payload = JSON.parse(bodyText) as { data?: Array<{ id?: unknown }> };
  return Array.isArray(payload.data)
    ? payload.data
        .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
        .filter(Boolean)
    : [];
}

async function fetchCandidateModels(
  kind: LocalChatServerCandidate["kind"],
  baseUrl: string,
  apiKey?: string,
  timeoutMs?: number
): Promise<string[]> {
  const models = await fetchLocalModels(baseUrl, apiKey, timeoutMs);
  if (models.length > 0 || kind !== "ollama") {
    return models;
  }
  return fetchOllamaTagModels(baseUrl, timeoutMs);
}

async function fetchOllamaTagModels(
  baseUrl: string,
  timeoutMs?: number
): Promise<string[]> {
  const rootUrl = new URL(baseUrl);
  rootUrl.pathname = "/api/tags";
  rootUrl.search = "";
  rootUrl.hash = "";
  const response = await fetch(rootUrl.toString(), {
    method: "GET",
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Ollama rejected /api/tags (${response.status}). ${truncate(bodyText, 240)}`
    );
  }
  const payload = JSON.parse(bodyText) as { models?: Array<{ name?: unknown }> };
  return Array.isArray(payload.models)
    ? payload.models
        .map((entry) => (typeof entry.name === "string" ? entry.name : ""))
        .filter(Boolean)
    : [];
}

function buildLocalInputMessages(
  instructions: string,
  messages: ChatMessage[]
): LocalChatCompletionMessage[] {
  return [
    { role: "system", content: instructions },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ];
}

async function openLocalChatStream(
  baseUrl: string,
  model: string,
  messages: LocalChatCompletionMessage[],
  tools: Record<string, unknown>[],
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<{ response: Response } | { toolsUnsupported: true }> {
  const request: Record<string, unknown> = {
    model,
    messages,
    stream: true
  };
  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = "auto";
  }

  const response = await fetch(joinLocalEndpoint(baseUrl, "chat/completions"), {
    method: "POST",
    signal,
    headers: {
      ...buildLocalHeaders(apiKey),
      Accept: "text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (response.ok && response.body) {
    return { response };
  }

  const detail = await response.text().catch(() => "");
  if (tools.length > 0 && isLocalToolsUnsupportedError(response.status, detail)) {
    return { toolsUnsupported: true };
  }

  throw new Error(
    `Local chat request failed (${response.status}). ${truncate(detail, 600)}`
  );
}

async function readLocalChatStream(
  response: Response,
  signal: AbortSignal,
  onToken: (delta: string) => void
): Promise<{ delta: string; functionCalls: LocalToolCall[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const accumulator = new LocalToolCallAccumulator();
  let fullDelta = "";
  let buffer = "";

  for (;;) {
    if (signal.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = parseSseData(frame);
      if (data === null || data === "[DONE]") continue;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = parseLocalChatContentDelta(event);
      if (delta) {
        fullDelta += delta;
        onToken(delta);
      }
      accumulator.addEvent(event);
    }
  }

  return { delta: fullDelta, functionCalls: accumulator.toCalls() };
}

function joinLocalEndpoint(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function buildLocalHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
