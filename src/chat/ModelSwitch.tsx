import { t, useLanguage } from "../i18n/tools";
import { Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import { getChatModelOptions } from "../../electron/chatModels";
import { SelectDropdown, type SelectOption } from "../components/SelectDropdown";

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
  provider,
  model,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  useLanguage();
  if (provider === "local") {
    return null;
  }

  const baseOptions = getChatModelOptions(provider);
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
