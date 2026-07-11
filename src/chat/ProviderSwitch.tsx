import { Bot, Sparkles, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";

const OPTIONS = [
  { value: "chatgpt" as const, label: "ChatGPT", icon: Sparkles },
  { value: "claude-code" as const, label: "Claude", icon: Terminal },
  { value: "local" as const, label: "Local model", icon: Bot }
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
  const activeIndex = OPTIONS.findIndex((option) => option.value === provider);

  return (
    <div
      className="chat-provider-switch"
      data-provider={provider}
      role="radiogroup"
      aria-label="Coach provider"
    >
      <span
        className="chat-provider-switch-indicator"
        style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
        aria-hidden="true"
      />
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = provider === option.value;

        return (
          <button
            key={option.value}
            type="button"
            className={isActive ? "active" : ""}
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            disabled={disabled || isActive}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{option.label}</span>
            {isActive ? (
              <span className="chat-provider-switch-dot" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
