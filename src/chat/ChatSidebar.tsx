import { useEffect } from "react";
import { PanelLeft } from "lucide-react";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import type { ChatSessionSummary } from "../../electron/types";

export function ChatSidebar({
  open,
  overlay,
  sessions,
  activeSessionId,
  busy,
  onClose,
  onOpen,
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
  onOpen: () => void;
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
      {overlay ? (
        <button
          type="button"
          className={[
            "chat-sidebar-overlay",
            open ? "is-visible" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Close sidebar"
          aria-hidden={!open}
          tabIndex={open ? 0 : -1}
          onClick={onClose}
        />
      ) : null}

      <div
        className={[
          "chat-sidebar-shell",
          open && !overlay ? "is-open" : "",
          overlay ? "is-overlay-mode" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <aside
          id="chat-conversation-sidebar"
          className={[
            "chat-sidebar",
            open ? "is-open" : "",
            overlay ? "is-overlay" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden={!open}
        >
          <div className="chat-sidebar-inner">
            <ChatHistoryPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              busy={busy}
              onCollapse={onClose}
              onNewChat={onNewChat}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
            />
          </div>
        </aside>
      </div>
      {!open && !overlay ? (
        <button
          type="button"
          className="chat-sidebar-expand-button"
          onClick={onOpen}
          aria-expanded="false"
          aria-controls="chat-conversation-sidebar"
          aria-label="Expand conversations"
          title="Expand conversations"
        >
          <PanelLeft size={17} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
