import { useEffect } from "react";
import { Settings2, X } from "lucide-react";
import type {
  ChatAuthStatus,
  ChatSettings,
  CorosMcpStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery
} from "../../electron/types";
import { ChatSettingsPanel } from "./ChatSettingsPanel";

export function ChatSettingsModal({
  open,
  chatSettings,
  authStatus,
  localApiKey,
  localConnection,
  localDiscovery,
  savingSettings,
  testingLocal,
  detectingLocal,
  signingIn,
  mcpStatus,
  mcpBusy,
  showTools,
  busy,
  onClose,
  onSignIn,
  onSignOut,
  onLocalApiKeyChange,
  onUpdateLocalDraft,
  onDetectLocalServers,
  onTestLocalConnection,
  onSaveLocalSettings,
  onClearLocalApiKey,
  onConnectMcp,
  onDisconnectMcp,
  onToggleTools,
  onUpdateChatSettings
}: {
  open: boolean;
  chatSettings: ChatSettings;
  authStatus: ChatAuthStatus | null;
  localApiKey: string;
  localConnection: LocalChatConnectionTest | null;
  localDiscovery: LocalChatDiscovery | null;
  savingSettings: boolean;
  testingLocal: boolean;
  detectingLocal: boolean;
  signingIn: boolean;
  mcpStatus: CorosMcpStatus | null;
  mcpBusy: boolean;
  showTools: boolean;
  busy?: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onLocalApiKeyChange: (value: string) => void;
  onUpdateLocalDraft: (patch: Partial<ChatSettings["local"]>) => void;
  onDetectLocalServers: () => void;
  onTestLocalConnection: () => void;
  onSaveLocalSettings: () => void;
  onClearLocalApiKey: () => void;
  onConnectMcp: () => void;
  onDisconnectMcp: () => void;
  onToggleTools: () => void;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="chat-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-settings-title"
      onClick={onClose}
    >
      <section
        className="panel chat-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chat-settings-modal-header">
          <div className="chat-settings-modal-title">
            <Settings2 size={16} aria-hidden="true" />
            <h2 id="chat-settings-title">Settings</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-settings-modal-body">
          <ChatSettingsPanel
            chatSettings={chatSettings}
            authStatus={authStatus}
            localApiKey={localApiKey}
            localConnection={localConnection}
            localDiscovery={localDiscovery}
            savingSettings={savingSettings}
            testingLocal={testingLocal}
            detectingLocal={detectingLocal}
            signingIn={signingIn}
            mcpStatus={mcpStatus}
            mcpBusy={mcpBusy}
            showTools={showTools}
            busy={busy}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onLocalApiKeyChange={onLocalApiKeyChange}
            onUpdateLocalDraft={onUpdateLocalDraft}
            onDetectLocalServers={onDetectLocalServers}
            onTestLocalConnection={onTestLocalConnection}
            onSaveLocalSettings={onSaveLocalSettings}
            onClearLocalApiKey={onClearLocalApiKey}
            onConnectMcp={onConnectMcp}
            onDisconnectMcp={onDisconnectMcp}
            onToggleTools={onToggleTools}
            onUpdateChatSettings={onUpdateChatSettings}
          />
        </div>
      </section>
    </div>
  );
}
