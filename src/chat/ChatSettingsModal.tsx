import { useEffect, useRef } from "react";
import { Settings2, X } from "lucide-react";
import type {
  ChatAuthStatus,
  ChatSettings,
  ClaudeCodeStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  OpenRouterConnectionTest
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { ChatSettingsPanel } from "./ChatSettingsPanel";

export function ChatSettingsModal({
  api,
  open,
  chatSettings,
  authStatus,
  claudeStatus,
  openRouterApiKey,
  openRouterConnection,
  localApiKey,
  localConnection,
  localDiscovery,
  savingSettings,
  testingLocal,
  testingOpenRouter,
  detectingLocal,
  signingIn,
  checkingClaude,
  connectingClaude,
  testingClaude,
  mcpRefreshVersion,
  busy,
  onClose,
  onSignIn,
  onSignOut,
  onRefreshClaude,
  onConnectClaude,
  onTestClaude,
  onOpenClaudeSetupGuide,
  onUpdateClaudeCode,
  onOpenRouterApiKeyChange,
  onUpdateOpenRouterDraft,
  onTestOpenRouterConnection,
  onSaveOpenRouterSettings,
  onClearOpenRouterApiKey,
  onOpenOpenRouterKeys,
  onOpenOpenRouterModels,
  onLocalApiKeyChange,
  onUpdateLocalDraft,
  onDetectLocalServers,
  onTestLocalConnection,
  onSaveLocalSettings,
  onClearLocalApiKey,
  onMcpServersChange,
  onUpdateChatSettings
}: {
  api: CorosLinkApi | undefined;
  open: boolean;
  chatSettings: ChatSettings;
  authStatus: ChatAuthStatus | null;
  claudeStatus: ClaudeCodeStatus | null;
  openRouterApiKey: string;
  openRouterConnection: OpenRouterConnectionTest | null;
  localApiKey: string;
  localConnection: LocalChatConnectionTest | null;
  localDiscovery: LocalChatDiscovery | null;
  savingSettings: boolean;
  testingLocal: boolean;
  testingOpenRouter: boolean;
  detectingLocal: boolean;
  signingIn: boolean;
  checkingClaude: boolean;
  connectingClaude: boolean;
  testingClaude: boolean;
  mcpRefreshVersion: number;
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
  onOpenRouterApiKeyChange: (value: string) => void;
  onUpdateOpenRouterDraft: (
    patch: Partial<ChatSettings["openRouter"]>
  ) => void;
  onTestOpenRouterConnection: () => void;
  onSaveOpenRouterSettings: () => void;
  onClearOpenRouterApiKey: () => void;
  onOpenOpenRouterKeys: () => void;
  onOpenOpenRouterModels: () => void;
  onLocalApiKeyChange: (value: string) => void;
  onUpdateLocalDraft: (patch: Partial<ChatSettings["local"]>) => void;
  onDetectLocalServers: () => void;
  onTestLocalConnection: () => void;
  onSaveLocalSettings: () => void;
  onClearLocalApiKey: () => void;
  onMcpServersChange: () => void | Promise<void>;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => Promise<boolean>;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement;
    const modal = modalRef.current;
    const focusableElements = () => Array.from(
      modal?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]'
      ) ?? []
    ).filter((element) => element.getClientRects().length > 0);
    focusableElements()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = focusableElements();
        const first = elements[0];
        const last = elements.at(-1);
        if (!modal?.contains(document.activeElement) ||
            (event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={modalRef}
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
            openRouterApiKey={openRouterApiKey}
            openRouterConnection={openRouterConnection}
            localApiKey={localApiKey}
            localConnection={localConnection}
            localDiscovery={localDiscovery}
            savingSettings={savingSettings}
            testingLocal={testingLocal}
            testingOpenRouter={testingOpenRouter}
            detectingLocal={detectingLocal}
            signingIn={signingIn}
            checkingClaude={checkingClaude}
            connectingClaude={connectingClaude}
            testingClaude={testingClaude}
            mcpRefreshVersion={mcpRefreshVersion}
            busy={busy}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            onRefreshClaude={onRefreshClaude}
            onConnectClaude={onConnectClaude}
            onTestClaude={onTestClaude}
            onOpenClaudeSetupGuide={onOpenClaudeSetupGuide}
            onUpdateClaudeCode={onUpdateClaudeCode}
            onOpenRouterApiKeyChange={onOpenRouterApiKeyChange}
            onUpdateOpenRouterDraft={onUpdateOpenRouterDraft}
            onTestOpenRouterConnection={onTestOpenRouterConnection}
            onSaveOpenRouterSettings={onSaveOpenRouterSettings}
            onClearOpenRouterApiKey={onClearOpenRouterApiKey}
            onOpenOpenRouterKeys={onOpenOpenRouterKeys}
            onOpenOpenRouterModels={onOpenOpenRouterModels}
            onLocalApiKeyChange={onLocalApiKeyChange}
            onUpdateLocalDraft={onUpdateLocalDraft}
            onDetectLocalServers={onDetectLocalServers}
            onTestLocalConnection={onTestLocalConnection}
            onSaveLocalSettings={onSaveLocalSettings}
            onClearLocalApiKey={onClearLocalApiKey}
            onMcpServersChange={onMcpServersChange}
            onUpdateChatSettings={onUpdateChatSettings}
          />
        </div>
      </section>
    </div>
  );
}
