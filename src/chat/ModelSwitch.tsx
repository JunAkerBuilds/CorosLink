import { Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import {
  getChatModelOptions,
  type ChatModelOption
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";

function renderChatGptIcon() {
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderClaudeIcon() {
  return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
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
  if (provider === "local") {
    return null;
  }

  const baseOptions = getChatModelOptions(provider);
  const options: ChatModelOption[] = baseOptions.some(
    (option) => option.value === model
  )
    ? baseOptions
    : [...baseOptions, { value: model, label: model }];
  const providerLabel = provider === "claude-code" ? "Claude" : "ChatGPT";
  const tone = provider === "claude-code" ? "claude" : "gpt";
  const renderIcon =
    provider === "claude-code" ? renderClaudeIcon : renderChatGptIcon;
  const selectedLabel =
    options.find((option) => option.value === model)?.label ?? model;

  return (
    <SelectDropdown
      className={`app-select--pill chat-model-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-select-menu--${tone}`}
      value={model}
      options={options}
      onChange={onChange}
      renderIcon={renderIcon}
      label={`${providerLabel} model`}
      title={`${providerLabel} model: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
