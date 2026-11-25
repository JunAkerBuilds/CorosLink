// Every AI the desktop app can answer with, and how each is reached. Pure: the main process and its tests read it.
// The key providers and their preferred models are the phones' (OwnAI.swift / OwnAI.kt); ChatGPT, the CLIs and
// the OpenAI-compatible presets are CorosLink's.

export type ProviderId =
  | "chatgpt" | "claude-code" | "gemini-cli" | "antigravity" | "opencode"
  | "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "qwen" | "qwen-cn" | "mimo"
  | "local";

/** How the athlete gets in: an account sign-in, a pasted key, or a server on their own network. */
export type ProviderGroup = "account" | "key" | "computer";

export interface Provider {
  id: ProviderId;
  name: string;
  group: ProviderGroup;
  /** Models tried first, best default first. The live list from the provider is shown when it has one. */
  preferred: readonly string[];
  /** OpenAI-compatible chat completions at this base (…/chat/completions, …/models). */
  base?: string;
  /** What a key looks like, for the field's placeholder. */
  keyHint?: string;
  /** Where the athlete makes a key. */
  keyPage?: string;
  /** Newer OpenAI models take only `max_completion_tokens`. */
  tokensField?: "max_completion_tokens";
  /** How this API is asked to report token use in a stream. */
  usage?: Record<string, unknown>;
}

const STREAM_USAGE = { stream_options: { include_usage: true } };

export const PROVIDERS: readonly Provider[] = [
  { id: "chatgpt", name: "ChatGPT", group: "account", preferred: [] },
  { id: "claude-code", name: "Claude Code", group: "account", preferred: [] },
  { id: "gemini-cli", name: "Gemini CLI", group: "account", preferred: [] },
  { id: "antigravity", name: "Antigravity", group: "account", preferred: [] },
  { id: "opencode", name: "OpenCode", group: "account", preferred: [] },
  {
    id: "openai", name: "OpenAI", group: "key", base: "https://api.openai.com/v1", keyHint: "sk-…", keyPage: "https://platform.openai.com/api-keys",
    preferred: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"], tokensField: "max_completion_tokens", usage: STREAM_USAGE,
  },
  { id: "anthropic", name: "Anthropic", group: "key", keyHint: "sk-ant-…", keyPage: "https://console.anthropic.com/settings/keys", preferred: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-haiku-4-5", "claude-sonnet-4-5"] },
  { id: "gemini", name: "Gemini", group: "key", keyHint: "AIza…", keyPage: "https://aistudio.google.com/apikey", preferred: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"] },
  { id: "deepseek", name: "DeepSeek", group: "key", base: "https://api.deepseek.com", keyHint: "sk-…", keyPage: "https://platform.deepseek.com/api_keys", preferred: ["deepseek-flash", "deepseek-v4-flash", "deepseek-chat"], usage: STREAM_USAGE },
  { id: "openrouter", name: "OpenRouter", group: "key", base: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", keyPage: "https://openrouter.ai/keys", preferred: ["openrouter/auto"], usage: { usage: { include: true } } },
  { id: "qwen", name: "Qwen", group: "key", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyHint: "sk-…", preferred: ["qwen-plus"], usage: STREAM_USAGE },
  { id: "qwen-cn", name: "Qwen (China)", group: "key", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", keyHint: "sk-…", preferred: ["qwen-plus"], usage: STREAM_USAGE },
  { id: "mimo", name: "Xiaomi MiMo", group: "key", base: "https://api.xiaomimimo.com/v1", keyHint: "sk-…", preferred: ["mimo-v2.5-pro"], usage: STREAM_USAGE },
  { id: "local", name: "On this computer", group: "computer", preferred: [], usage: STREAM_USAGE },
];

export const provider = (id: unknown): Provider | null => PROVIDERS.find((p) => p.id === id) ?? null;

/** Ollama's and LM Studio's own addresses, tried in this order. */
export const LOCAL_SERVERS = ["http://localhost:11434/v1", "http://localhost:1234/v1"] as const;

/**
 * A local server's base URL, cleaned, or null. Plain http is only for this computer and the local network: anything
 * else must be https, so a key never crosses the internet in the clear.
 */
export function localBase(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const nearby = host === "localhost" || host.endsWith(".local") || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^f[cd]/i.test(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && nearby)) return null;
  return url.href.replace(/\/+$/, "");
}

/** Models that write text, from a provider's whole list (no speech, pictures, embeddings or moderation). */
export const writesText = (id: string): boolean => !/(embed|tts|whisper|audio|transcribe|realtime|dall-e|image|moderation|sora|davinci|babbage|search|computer-use|veo|imagen|aqa|-live)/i.test(id);

/** Gemini models retired from the picker: 1.x, 2.0 and 2.5 (but 2.5 flash-lite). */
export const retiredGemini = (id: string): boolean => /^gemini-(1\.|2\.0)/.test(id) || (/^gemini-2\.5/.test(id) && !/flash-lite/.test(id));

/** The default model for a key: the first preferred one it can reach, else a small one, else the first listed. */
export function defaultModel(p: Pick<Provider, "preferred">, listed: readonly string[]): string {
  if (!listed.length) return p.preferred[0] ?? "";
  return p.preferred.find((m) => listed.includes(m)) ?? listed.find((m) => /mini|haiku|flash/.test(m)) ?? listed[0];
}
