import { t, useLanguage } from "../i18n/tools";
import { useEffect, useState } from "react";
import { Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import {
  getChatModelOptions,
  type ChatModelOption
} from "../../electron/chatModels";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown, type SelectOption } from "../components/SelectDropdown";

// Last live list per provider, so a remounted picker opens on real versions.
const liveModelOptions = new Map<ChatProvider, ChatModelOption[]>();

/**
 * The provider's live model catalog (Claude Code's or the ChatGPT account's),
 * starting from the last known or static list while it loads.
 */
export function useChatModelOptions(
  api: CorosLinkApi | undefined,
  provider: ChatProvider
): ChatModelOption[] {
  const initial = () =>
    liveModelOptions.get(provider) ?? getChatModelOptions(provider);
  const [options, setOptions] = useState(initial);
  useEffect(() => {
    setOptions(initial());
    if (!api || (provider !== "claude-code" && provider !== "chatgpt")) return;
    let active = true;
    api
      .listChatModels(provider)
      .then((listed) => {
        if (!listed.length) return;
        liveModelOptions.set(provider, listed);
        if (active) setOptions(listed);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, provider]);
  return options;
}

/** "Account default · Opus 5.5"; model names stay literal, only "Auto"-style rows translate. */
export function formatChatModelLabel(option: ChatModelOption): string {
  const label = option.value ? option.label : t(option.label);
  return option.detail ? `${label} · ${option.detail}` : label;
}

function renderChatGptIcon() {
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderClaudeIcon() {
  return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderOpenRouterIcon() {
  return <Network size={14} strokeWidth={2.1} aria-hidden="true" />;
}

export function ModelSwitch({
  api,
  provider,
  model,
  disabled,
  onChange
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  useLanguage();
  const modelOptions = useChatModelOptions(api, provider);
  if (provider === "local") {
    return null;
  }

  const baseOptions: SelectOption<string>[] = modelOptions.map((option) => ({
    value: option.value,
    label: formatChatModelLabel(option),
    translate: false
  }));
  const options: SelectOption<string>[] = baseOptions.some(
    (option) => option.value === model
  )
    ? baseOptions
    : [...baseOptions, { value: model, label: model, translate: false }];
  const providerLabel =
    provider === "claude-code"
      ? "Claude"
      : provider === "openrouter"
        ? "OpenRouter"
        : "ChatGPT";
  const tone =
    provider === "claude-code"
      ? "claude"
      : provider === "openrouter"
        ? "openrouter"
        : "gpt";
  const renderIcon =
    provider === "claude-code"
      ? renderClaudeIcon
      : provider === "openrouter"
        ? renderOpenRouterIcon
        : renderChatGptIcon;
  const selectedLabel =
    options.find((option) => option.value === model)?.label ?? model;

  return (
    <SelectDropdown translateLabel={t}
      className={`app-select--pill chat-model-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-select-menu--${tone}`}
      value={model}
      options={options}
      onChange={onChange}
      renderIcon={renderIcon}
      label={t("{{p0}} model", { p0: providerLabel })}
      title={t("{{p0}} model: {{p1}}", { p0: providerLabel, p1: selectedLabel })}
      disabled={disabled}
      portal
    />
  );
}
