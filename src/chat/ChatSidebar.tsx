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
          className={[
            "chat-sidebar",
            open ? "is-open" : "",
            overlay ? "is-overlay" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden={!open}
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
      </div>
    </>
  );
}
