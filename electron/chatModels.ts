export interface ChatModelOption {
  value: string;
  label: string;
  /** Version an alias resolves to, shown after the label (e.g. "Opus 5.5"). */
  detail?: string;
}

export const CHATGPT_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Auto" },
  { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-6-sol", label: "GPT-6 Sol" },
  { value: "gpt-6-luna", label: "GPT-6 Luna" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" }
];

// Aliases follow Claude Code's own catalog; versions are what they resolve to
// with Claude Code 2.1.296. The live list replaces these when the CLI answers.
export const CLAUDE_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "", label: "Account default" },
  { value: "opus", label: "Claude Opus 5.5" },
  { value: "fable", label: "Claude Fable 5.1" },
  { value: "sonnet", label: "Claude Sonnet 5.5" },
  { value: "haiku", label: "Claude Haiku 5.5" }
];

export const OPENROUTER_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "openrouter/auto", label: "Auto Router" },
  { value: "openrouter/free", label: "Free Router" }
];

const CHATGPT_AUTO_MODEL_IDS = [
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-codex"
];

/** Changes whenever the Auto order does, so a model cached under an older order is re-probed. */
export const CHATGPT_AUTO_CATALOG = CHATGPT_AUTO_MODEL_IDS.join(",");

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
  if (provider === "claude-code") return CLAUDE_MODEL_OPTIONS;
  if (provider === "openrouter") return OPENROUTER_MODEL_OPTIONS;
  return CHATGPT_MODEL_OPTIONS;
}

/** A model the signed-in ChatGPT account offers, as listed by the Codex backend. */
export interface ChatGptModelInfo {
  slug: string;
  displayName: string;
  /** Reasoning efforts the model accepts, e.g. low…ultra. */
  efforts: string[];
  defaultEffort?: string;
}

/** Used when the live model list cannot be fetched. */
export const CHATGPT_FALLBACK_MODELS: ChatGptModelInfo[] = CHATGPT_MODEL_OPTIONS
  .filter((option) => option.value)
  .map((option) => ({ slug: option.value, displayName: option.label, efforts: ["low", "medium", "high"] }));

/** "GPT-5.6-Sol" → "GPT-5.6 Sol", matching the static labels. */
function formatChatGptModelName(displayName: string): string {
  return displayName.replace(/-(?=[A-Z][a-z])/g, " ");
}

/** Picker rows for the models the signed-in ChatGPT account offers. */
export function chatGptModelOptionsFromCatalog(
  models: ChatGptModelInfo[]
): ChatModelOption[] {
  return [
    CHATGPT_MODEL_OPTIONS[0],
    ...models.map((model) => ({
      value: model.slug,
      label: formatChatGptModelName(model.displayName)
    }))
  ];
}

/** A model row as Claude Code reports it (Agent SDK `supportedModels()`). */
export interface ClaudeCliModel {
  value: string;
  resolvedModel?: string;
  displayName: string;
}

/** "claude-opus-5-5" → Opus 5.5; "claude-haiku-4-5-20251001" → Haiku 4.5. */
function parseClaudeModelId(
  id?: string
): { family: string; name: string } | undefined {
  const match = id?.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/);
  if (!match) return undefined;
  const [, family, major, minor] = match;
  const version = minor ? `${major}.${minor}` : major;
  return { family, name: `${family[0].toUpperCase()}${family.slice(1)} ${version}` };
}

/**
 * Picker rows for Claude Code: the account default plus one row per model
 * family, labelled with the version it runs today ("Claude Opus 5.5").
 * Aliases (opus, sonnet…) track their family's newest model; a pinned id is
 * kept only for a family the CLI offers no alias for, such as Fable on
 * subscription sign-ins.
 */
export function claudeModelOptionsFromCli(
  models: ClaudeCliModel[]
): ChatModelOption[] {
  const isAlias = (model: ClaudeCliModel) => !model.value.startsWith("claude-");
  const familyOf = (model: ClaudeCliModel) =>
    parseClaudeModelId(model.resolvedModel ?? model.value)?.family ??
    (isAlias(model) ? model.value : undefined);
  const rows = models.filter((model) => model.value !== "default");
  const aliasFamilies = new Set(rows.filter(isAlias).map(familyOf));
  const shown = new Set<string>();
  const options: ChatModelOption[] = [];
  for (const model of rows) {
    const family = familyOf(model);
    if (!isAlias(model) && (!family || aliasFamilies.has(family) || shown.has(family))) {
      continue;
    }
    if (family) shown.add(family);
    const name =
      parseClaudeModelId(model.resolvedModel ?? model.value)?.name ?? model.displayName;
    options.push({
      value: model.value,
      label: /^claude\b/i.test(name) ? name : `Claude ${name}`
    });
  }
  const defaultVersion = parseClaudeModelId(
    models.find((model) => model.value === "default")?.resolvedModel
  )?.name;
  // "Default · Opus 5.5" fits the composer pill; "Account default · …" truncates.
  return [
    defaultVersion
      ? { value: "", label: "Default", detail: defaultVersion }
      : CLAUDE_MODEL_OPTIONS[0],
    ...options
  ];
}
