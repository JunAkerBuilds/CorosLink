import {
  ChartSpline,
  Cpu,
  MessageSquareText,
  Plug,
  Sparkles,
  UserRound,
  Waypoints,
  type LucideIcon
} from "lucide-react";

export type ChatSettingsSectionId =
  | "display"
  | "coach"
  | "chatgpt"
  | "openrouter"
  | "claude"
  | "local"
  | "mcp";

export const CHAT_SETTINGS_SECTIONS: ReadonlyArray<{
  id: ChatSettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  group: "Coach" | "Providers" | "Tools";
}> = [
  {
    id: "display",
    label: "Display",
    description: "Charts and activity visuals in the transcript",
    icon: ChartSpline,
    group: "Coach"
  },
  {
    id: "coach",
    label: "Coach instructions",
    description: "Goals, schedule, and tone your coach should know",
    icon: MessageSquareText,
    group: "Coach"
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    description: "Cloud coaching with your ChatGPT account",
    icon: UserRound,
    group: "Providers"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Bring your own key and pick any model",
    icon: Waypoints,
    group: "Providers"
  },
  {
    id: "claude",
    label: "Claude",
    description: "Use Claude Code signed in on this computer",
    icon: Sparkles,
    group: "Providers"
  },
  {
    id: "local",
    label: "Local model",
    description: "An OpenAI-compatible server on your machine or network",
    icon: Cpu,
    group: "Providers"
  },
  {
    id: "mcp",
    label: "MCP servers",
    description: "Extra tools from Model Context Protocol servers",
    icon: Plug,
    group: "Tools"
  }
];

export function chatSettingsSectionDomId(id: ChatSettingsSectionId): string {
  return `chat-settings-${id}`;
}

export function ChatSettingsSectionHeader({
  id,
  badge
}: {
  id: ChatSettingsSectionId;
  badge?: string;
}) {
  const section = CHAT_SETTINGS_SECTIONS.find((entry) => entry.id === id);
  if (!section) return null;
  const Icon = section.icon;
  return (
    <header className="chat-settings-section-header">
      <span className="chat-settings-section-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <div className="chat-settings-section-heading">
        <div className="chat-settings-section-title">
          <h3>{section.label}</h3>
          {badge ? <span className="chat-beta-badge">{badge}</span> : null}
        </div>
        <p>{section.description}</p>
      </div>
    </header>
  );
}
