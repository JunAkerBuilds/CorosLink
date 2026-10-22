import { t, useLanguage } from "../i18n/tools";
import { Trash2 } from "lucide-react";
import { memo, type MouseEvent, type ReactNode } from "react";
import type { ChatSessionSummary } from "../../electron/types";
import { formatSessionRelativeTime } from "./chatSessionGroups";
import { CoachActivityDots } from "./CoachTurnStatus";

/** Marks each case-insensitive occurrence of the search in `text`. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="chat-session-row-match">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  if (!parts.length) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * One conversation in the sidebar. Memoized: Coach re-renders on every streamed
 * token, and a row only changes with its session, so its callbacks take the id
 * and must stay stable.
 */
export const ChatSessionRow = memo(function ChatSessionRow({
  session,
  active,
  disabled,
  status,
  query,
  onSelect: selectSession,
  onDelete: deleteSession
}: {
  session: ChatSessionSummary;
  active: boolean;
  disabled?: boolean;
  /** What Coach is doing in this conversation, while it works. */
  status?: string | null;
  query: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  useLanguage();
  const onSelect = () => selectSession(session.id);
  const onDelete = () => deleteSession(session.id);
  // New sessions are stored with the English default title.
  const title = session.title === "New chat" ? t("New chat") : session.title;
  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (disabled) {
      return;
    }
    if (
      session.messageCount === 0 ||
      window.confirm(t("Delete \"{{p0}}\"?", { p0: title }))
    ) {
      onDelete();
    }
  };
  // While Coach works the list holds still; say why instead of ignoring the click.
  const hint = disabled && !active
    ? t("Coach is still answering. Switch chats when it’s done.")
    : session.preview || title;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-current={active ? "true" : undefined}
      className={[
        "chat-session-row",
        active ? "is-active" : "",
        disabled ? "is-disabled" : "",
        status ? "is-working" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      title={hint}
    >
      {active ? (
        <span className="chat-session-row-indicator" aria-hidden="true" />
      ) : null}
      <span className="chat-session-row-title">{highlight(title, query)}</span>
      <span className="chat-session-row-time">
        {formatSessionRelativeTime(session.updatedAt)}
      </span>
      {status ? (
        <span className="chat-session-row-status">
          <CoachActivityDots />
          <span>{status}</span>
        </span>
      ) : session.preview ? (
        <span className="chat-session-row-preview">
          {highlight(session.preview, query)}
        </span>
      ) : (
        <span className="chat-session-row-preview is-placeholder">
          {t("No messages yet")}
        </span>
      )}
      {disabled ? null : (
        <button
          type="button"
          className="chat-session-row-delete"
          aria-label={t("Delete {{p0}}", { p0: title })}
          title={t("Delete {{p0}}", { p0: title })}
          onClick={handleDelete}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
