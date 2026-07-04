import type { ChatProvider } from "../../electron/types";

export function ProviderSwitch({
  provider,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (provider: ChatProvider) => void;
}) {
  return (
    <div className="chat-provider-switch" aria-label="Coach provider">
      {[
        { value: "chatgpt" as const, label: "ChatGPT" },
        { value: "local" as const, label: "Local model" }
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          className={provider === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          disabled={disabled || provider === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
