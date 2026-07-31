import type { ChatProvider } from "../../electron/types";
import {
  getChatModelOptions,
  type ChatModelOption
} from "../../electron/chatModels";
import { SelectDropdown } from "../components/SelectDropdown";

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
  const selectedLabel =
    options.find((option) => option.value === model)?.label ?? model;

  return (
    <SelectDropdown
      className="app-select--pill chat-model-select"
      menuClassName="chat-select-menu"
      value={model}
      options={options}
      onChange={onChange}
      label={`${providerLabel} model`}
      title={`${providerLabel} model: ${selectedLabel}`}
      disabled={disabled}
      portal
    />
  );
}
