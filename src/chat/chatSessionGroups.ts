import type { ChatSessionSummary } from "../../electron/types";

export type ChatSessionGroupLabel =
  | "Today"
  | "Yesterday"
  | "Previous 7 days"
  | "Older";

export interface ChatSessionGroup {
  label: ChatSessionGroupLabel;
  sessions: ChatSessionSummary[];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sessionGroupLabel(updatedAt: string, now = new Date()): ChatSessionGroupLabel {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return "Older";
  }

  const todayStart = startOfLocalDay(now).getTime();
  const updatedStart = startOfLocalDay(updated).getTime();
  const dayDiff = Math.floor((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  if (dayDiff <= 7) {
    return "Previous 7 days";
  }
  return "Older";
}

const GROUP_ORDER: ChatSessionGroupLabel[] = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older"
];

export function groupChatSessions(
  sessions: ChatSessionSummary[]
): ChatSessionGroup[] {
  const buckets = new Map<ChatSessionGroupLabel, ChatSessionSummary[]>();
  for (const label of GROUP_ORDER) {
    buckets.set(label, []);
  }

  for (const session of sessions) {
    const label = sessionGroupLabel(session.updatedAt);
    buckets.get(label)?.push(session);
  }

  return GROUP_ORDER.map((label) => ({
    label,
    sessions: buckets.get(label) ?? []
  })).filter((group) => group.sessions.length > 0);
}

export function formatSessionRelativeTime(updatedAt: string): string {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) {
    return "";
  }

  const now = new Date();
  const todayStart = startOfLocalDay(now).getTime();
  const updatedStart = startOfLocalDay(updated).getTime();
  const dayDiff = Math.floor((todayStart - updatedStart) / 86_400_000);

  if (dayDiff <= 0) {
    return updated.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  if (dayDiff < 7) {
    return updated.toLocaleDateString(undefined, { weekday: "short" });
  }
  return updated.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}
