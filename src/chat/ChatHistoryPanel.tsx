import { useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import type { ChatSessionSummary } from "../../electron/types";
import { ChatSessionRow } from "./ChatSessionRow";
import { groupChatSessions } from "./chatSessionGroups";

export function ChatHistoryPanel({
  sessions,
  activeSessionId,
  busy,
  onNewChat,
  onSelectSession,
  onDeleteSession
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  busy?: boolean;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(normalized) ||
        session.preview.toLowerCase().includes(normalized)
    );
  }, [query, sessions]);

  const groups = useMemo(
    () => groupChatSessions(filteredSessions),
    [filteredSessions]
  );

  return (
    <div className="chat-history-panel">
      <div className="chat-history-toolbar">
        <button
          type="button"
          className="chat-new-chat chat-new-chat-sidebar"
          onClick={onNewChat}
          disabled={busy}
        >
          <Plus size={14} aria-hidden="true" />
          New chat
        </button>
        <label className="chat-history-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="chat-session-list">
        {groups.length === 0 ? (
          <p className="chat-history-empty">
            {query.trim() ? "No chats match your search." : "No conversations yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="chat-session-group">
              <h3 className="chat-session-group-label">{group.label}</h3>
              <div className="chat-session-group-list">
                {group.sessions.map((session) => (
                  <ChatSessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    disabled={busy}
                    onSelect={() => onSelectSession(session.id)}
                    onDelete={() => onDeleteSession(session.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {busy ? (
        <div className="chat-sidebar-busy" aria-hidden="true">
          <Loader2 className="chat-spinner" size={16} />
        </div>
      ) : null}
    </div>
  );
}
