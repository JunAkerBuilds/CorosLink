import { t, useLanguage } from "../i18n/tools";
import { Trash2 } from "lucide-react";
import { memo, type MouseEvent } from "react";
import type { ChatSessionSummary } from "../../electron/types";
import { formatSessionRelativeTime } from "./chatSessionGroups";

/**
 * One conversation in the sidebar. Memoized: Coach re-renders on every streamed
 * token, and a row only changes with its session, so its callbacks take the id
 * and must stay stable.
 */
export const ChatSessionRow = memo(function ChatSessionRow({
  session,
  active,
  disabled,
  onSelect: selectSession,
  onDelete: deleteSession
}: {
  session: ChatSessionSummary;
  active: boolean;
  disabled?: boolean;
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

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={[
        "chat-session-row",
        active ? "is-active" : "",
        disabled ? "is-disabled" : ""
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
      title={session.preview || title}
    >
      {active ? (
        <span className="chat-session-row-indicator" aria-hidden="true" />
      ) : null}
      <span className="chat-session-row-body">
        <span className="chat-session-row-title">{title}</span>
        {session.preview ? (
          <span className="chat-session-row-preview">{session.preview}</span>
        ) : null}
      </span>
      <span className="chat-session-row-meta">
        <span className="chat-session-row-time">
          {formatSessionRelativeTime(session.updatedAt)}
        </span>
        <button
          type="button"
          className="chat-session-row-delete"
          aria-label={t("Delete {{p0}}", { p0: title })}
          onClick={handleDelete}
          disabled={disabled}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
});
