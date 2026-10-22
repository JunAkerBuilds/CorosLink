import { t, useLanguage } from "../i18n/tools";
import { useCallback, useMemo, useRef, useState } from "react";
import { MessagesSquare, PanelLeftClose, Search, SquarePen, Trash2, X } from "lucide-react";
import type { ChatSessionSummary } from "../../electron/types";
import { ChatSessionRow } from "./ChatSessionRow";
import { groupChatSessions } from "./chatSessionGroups";

export function ChatHistoryPanel({
  sessions,
  activeSessionId,
  busy,
  activeStatus,
  onCollapse,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onDeleteAllSessions
}: {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  busy?: boolean;
  activeStatus?: string | null;
  onCollapse: () => void;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteAllSessions: () => void;
}) {
  const { language } = useLanguage();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = query.trim();

  const filteredSessions = useMemo(() => {
    const normalized = trimmedQuery.toLowerCase();
    if (!normalized) {
      return sessions;
    }
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(normalized) ||
        session.preview.toLowerCase().includes(normalized)
    );
  }, [trimmedQuery, sessions, language]);

  const groups = useMemo(
    () => groupChatSessions(filteredSessions),
    [filteredSessions, language]
  );

  // Rows are memoized, so they get stable callbacks that always call the latest handlers.
  const handlersRef = useRef({ onSelectSession, onDeleteSession });
  handlersRef.current = { onSelectSession, onDeleteSession };
  const selectSession = useCallback(
    (sessionId: string) => handlersRef.current.onSelectSession(sessionId),
    []
  );
  const deleteSession = useCallback(
    (sessionId: string) => handlersRef.current.onDeleteSession(sessionId),
    []
  );

  const clearSearch = () => {
    setQuery("");
    searchRef.current?.focus();
  };

  // Only worth offering once something has been said; a lone blank chat stays.
  const canClear = sessions.some((session) => session.messageCount > 0);
  const handleDeleteAll = () => {
    if (busy) return;
    const count = sessions.length;
    const question =
      count === 1
        ? t("Delete this conversation? This can’t be undone.")
        : t("Delete all {{count}} conversations? This can’t be undone.", { count });
    if (window.confirm(question)) {
      onDeleteAllSessions();
    }
  };

  return (
    <div className="chat-history-panel">
      <div className="chat-history-toolbar">
        <div className="chat-history-header">
          <p className="eyebrow">{t("Conversations")}</p>
          <div className="chat-history-actions">
            <button
              type="button"
              className="chat-history-icon-button chat-history-new"
              onClick={onNewChat}
              disabled={busy}
              aria-label={t("New chat")}
              title={t("New chat")}
            >
              <SquarePen size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="chat-history-icon-button chat-history-collapse-button"
              onClick={onCollapse}
              aria-expanded="true"
              aria-controls="chat-conversation-sidebar"
              aria-label={t("Collapse conversations")}
              title={t("Collapse conversations")}
            >
              <PanelLeftClose size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <label className="chat-history-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            aria-label={t("Search conversations")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("Search chats")}
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="chat-history-search-clear"
              onClick={clearSearch}
              aria-label={t("Clear search")}
              title={t("Clear search")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      <div className="chat-session-list">
        {groups.length === 0 ? (
          <p className="chat-history-empty">
            {trimmedQuery ? t("No chats match your search.") : t("No conversations yet.")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="chat-session-group">
              <h3 className="chat-session-group-label">{t(group.label)}</h3>
              <div className="chat-session-group-list">
                {group.sessions.map((session) => {
                  const active = session.id === activeSessionId;
                  return (
                    <ChatSessionRow
                      key={session.id}
                      session={session}
                      active={active}
                      disabled={busy}
                      status={active ? activeStatus ?? null : null}
                      query={trimmedQuery}
                      onSelect={selectSession}
                      onDelete={deleteSession}
                    />
                  );
                })}
              </div>
            </section>
          ))
        )}
        {!trimmedQuery && !canClear ? (
          <div className="chat-history-hint">
            <span className="chat-history-hint-icon" aria-hidden="true">
              <MessagesSquare size={16} />
            </span>
            <p>{t("Ask Coach anything. Each chat is saved here so you can pick it up later.")}</p>
          </div>
        ) : null}
      </div>

      {canClear ? (
        <div className="chat-history-footer">
          <button
            type="button"
            className="chat-history-clear"
            onClick={handleDeleteAll}
            disabled={busy}
          >
            <Trash2 size={13} aria-hidden="true" />
            {t("Clear all chats")}</button>
        </div>
      ) : null}
    </div>
  );
}
