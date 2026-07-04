import { useEffect } from "react";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import type { ChatSessionSummary } from "../../electron/types";

export function ChatSidebar({
  open,
  overlay,
  sessions,
  activeSessionId,
  busy,
  onClose,
  onNewChat,
  onSelectSession,
  onDeleteSession
}: {
  open: boolean;
  overlay: boolean;
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  busy?: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  useEffect(() => {
    if (!overlay || !open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [overlay, open, onClose]);

  return (
    <>
      {overlay && open ? (
        <button
          type="button"
          className="chat-sidebar-overlay"
          aria-label="Close sidebar"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={[
          "chat-sidebar",
          open ? "is-open" : "",
          overlay ? "is-overlay" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden={!open && overlay}
      >
        <ChatHistoryPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          busy={busy}
          onNewChat={onNewChat}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
        />
      </aside>
    </>
  );
}
