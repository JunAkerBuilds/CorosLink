import { Bot, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";

const OPTIONS: Array<{ value: ChatProvider; label: string }> = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-code", label: "Claude" },
  { value: "local", label: "Local model" }
];

function getProviderTone(provider: ChatProvider) {
  if (provider === "claude-code") return "claude";
  if (provider === "local") return "local";
  return "gpt";
}

function renderProviderIcon(provider: ChatProvider) {
  if (provider === "claude-code") {
    return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "local") {
    return <Bot size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

export function ProviderSwitch({
  provider,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (provider: ChatProvider) => void;
}) {
  const selectedLabel =
    OPTIONS.find((option) => option.value === provider)?.label ?? provider;
  const tone = getProviderTone(provider);

  return (
    <SelectDropdown
      className={`app-select--pill chat-provider-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-provider-menu chat-select-menu--${tone}`}
      value={provider}
      options={OPTIONS}
      onChange={onChange}
      renderIcon={renderProviderIcon}
      label="Coach provider"
      title={`Coach provider: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
