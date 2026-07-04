import { Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { ChatSessionSummary } from "../../electron/types";
import { formatSessionRelativeTime } from "./chatSessionGroups";

export function ChatSessionRow({
  session,
  active,
  disabled,
  onSelect,
  onDelete
}: {
  session: ChatSessionSummary;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    if (disabled) {
      return;
    }
    if (
      session.messageCount === 0 ||
      window.confirm(`Delete "${session.title}"?`)
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
      title={session.preview || session.title}
    >
      <span className="chat-session-row-body">
        <span className="chat-session-row-title">{session.title}</span>
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
          aria-label={`Delete ${session.title}`}
          onClick={handleDelete}
          disabled={disabled}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
