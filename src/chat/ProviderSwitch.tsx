import { t, useLanguage } from "../i18n/tools";
import { Bot, Gem, Network, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";

const OPTIONS: Array<{ value: ChatProvider; label: string }> = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-code", label: "Claude" },
  { value: "gemini-cli", label: "Gemini" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "local", label: "Local model" }
];

function getProviderTone(provider: ChatProvider) {
  if (provider === "claude-code") return "claude";
  if (provider === "gemini-cli") return "gemini";
  if (provider === "openrouter") return "openrouter";
  if (provider === "local") return "local";
  return "gpt";
}

function renderProviderIcon(provider: ChatProvider) {
  if (provider === "claude-code") {
    return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "gemini-cli") {
    return <Gem size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "local") {
    return <Bot size={14} strokeWidth={2.1} aria-hidden="true" />;
  }
  if (provider === "openrouter") {
    return <Network size={14} strokeWidth={2.1} aria-hidden="true" />;
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
  useLanguage();
  const selectedLabel =
    OPTIONS.find((option) => option.value === provider)?.label ?? provider;
  const tone = getProviderTone(provider);

  return (
    <SelectDropdown translateLabel={t}
      className={`app-select--pill chat-provider-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-provider-menu chat-select-menu--${tone}`}
      value={provider}
      options={OPTIONS.map(option => ({ ...option, label: t(option.label) }))}
      onChange={onChange}
      renderIcon={renderProviderIcon}
      label={t("Coach provider")}
      title={t("Coach provider: {{p0}}", { p0: selectedLabel })}
      disabled={disabled}
      portal
    />
  );
}
