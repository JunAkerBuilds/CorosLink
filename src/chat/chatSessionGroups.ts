import { getLocale } from "../i18n/toolsLocale";
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

const SESSION_TIME_FORMATS = {
  time: { hour: "numeric", minute: "2-digit" },
  weekday: { weekday: "short" },
  date: { month: "short", day: "numeric" }
} satisfies Record<string, Intl.DateTimeFormatOptions>;

// Building a formatter is costly and the list renders while Coach streams, so
// each one is kept per locale; the language can change while the app runs.
const sessionFormatters = new Map<string, Intl.DateTimeFormat>();

function sessionFormatter(style: keyof typeof SESSION_TIME_FORMATS): Intl.DateTimeFormat {
  const locale = getLocale();
  const key = `${locale}|${style}`;
  let formatter = sessionFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, SESSION_TIME_FORMATS[style]);
    sessionFormatters.set(key, formatter);
  }
  return formatter;
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

  // The group label already says Today or Yesterday; the row adds the hour.
  if (dayDiff <= 1) {
    return sessionFormatter("time").format(updated);
  }
  if (dayDiff < 7) {
    return sessionFormatter("weekday").format(updated);
  }
  return sessionFormatter("date").format(updated);
}
