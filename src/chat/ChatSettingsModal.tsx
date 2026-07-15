import { useEffect } from "react";
import { Settings2, X } from "lucide-react";
import type {
  ChatAuthStatus,
  ChatSettings,
  ClaudeCodeStatus,
  CorosMcpStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ChatSettingsPanel } from "./ChatSettingsPanel";

export function ChatSettingsModal({
  api,
  open,
  chatSettings,
  authStatus,
  claudeStatus,
  localApiKey,
  localConnection,
  localDiscovery,
  savingSettings,
  testingLocal,
  detectingLocal,
  signingIn,
  checkingClaude,
  connectingClaude,
  testingClaude,
  mcpStatus,
  mcpBusy,
  showTools,
  busy,
  onClose,
  onSignIn,
  onSignOut,
  onRefreshClaude,
  onConnectClaude,
  onTestClaude,
  onOpenClaudeSetupGuide,
  onUpdateClaudeCode,
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
  api: CorosLinkApi | undefined;
  open: boolean;
  chatSettings: ChatSettings;
  authStatus: ChatAuthStatus | null;
  claudeStatus: ClaudeCodeStatus | null;
  localApiKey: string;
  localConnection: LocalChatConnectionTest | null;
  localDiscovery: LocalChatDiscovery | null;
  savingSettings: boolean;
  testingLocal: boolean;
  detectingLocal: boolean;
  signingIn: boolean;
  checkingClaude: boolean;
  connectingClaude: boolean;
  testingClaude: boolean;
  mcpStatus: CorosMcpStatus | null;
  mcpBusy: boolean;
  showTools: boolean;
  busy?: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshClaude: () => void;
  onConnectClaude: () => void;
  onTestClaude: () => void;
  onOpenClaudeSetupGuide: () => void;
  onUpdateClaudeCode: (
    patch: Partial<ChatSettings["claudeCode"]>
  ) => void;
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
            api={api}
            chatSettings={chatSettings}
            authStatus={authStatus}
            claudeStatus={claudeStatus}
            localApiKey={localApiKey}
            localConnection={localConnection}
            localDiscovery={localDiscovery}
            savingSettings={savingSettings}
            testingLocal={testingLocal}
            detectingLocal={detectingLocal}
            signingIn={signingIn}
            checkingClaude={checkingClaude}
            connectingClaude={connectingClaude}
            testingClaude={testingClaude}
            mcpStatus={mcpStatus}
            mcpBusy={mcpBusy}
            showTools={showTools}
            busy={busy}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onRefreshClaude={onRefreshClaude}
            onConnectClaude={onConnectClaude}
            onTestClaude={onTestClaude}
            onOpenClaudeSetupGuide={onOpenClaudeSetupGuide}
            onUpdateClaudeCode={onUpdateClaudeCode}
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
