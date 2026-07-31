export interface ChatModelOption {
  value: string;
  label: string;
}

export const CHATGPT_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Auto" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" }
];

export const CLAUDE_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Account default" },
  { value: "opus", label: "Claude Opus" },
  { value: "sonnet", label: "Claude Sonnet" },
  { value: "haiku", label: "Claude Haiku" }
];

const CHATGPT_AUTO_MODEL_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-codex"
];

export function getChatGptModelCandidates(
  selectedModel?: string,
  cachedModel?: string
): string[] {
  const selected = selectedModel?.trim();
  if (selected) {
    return [selected];
  }

  const cached = cachedModel?.trim();
  return cached
    ? [cached, ...CHATGPT_AUTO_MODEL_IDS.filter((model) => model !== cached)]
    : [...CHATGPT_AUTO_MODEL_IDS];
}

export function getChatModelOptions(provider: string): ChatModelOption[] {
  return provider === "claude-code"
    ? CLAUDE_MODEL_OPTIONS
    : CHATGPT_MODEL_OPTIONS;
}
