import type { ChatProvider } from "../../electron/types";
import { SelectDropdown } from "../components/SelectDropdown";

const OPTIONS: Array<{ value: ChatProvider; label: string }> = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude-code", label: "Claude" },
  { value: "local", label: "Local model" }
];

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

  return (
    <SelectDropdown
      className="app-select--pill chat-provider-select"
      menuClassName="chat-select-menu"
      value={provider}
      options={OPTIONS}
      onChange={onChange}
      label="Coach provider"
      title={`Coach provider: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
