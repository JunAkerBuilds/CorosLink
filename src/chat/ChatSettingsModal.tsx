import { useEffect, useRef, useState } from "react";
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
import {
  CHAT_SETTINGS_SECTIONS,
  chatSettingsSectionDomId,
  type ChatSettingsSectionId
} from "./chatSettingsSections";
import "./chatSettings.css";

const SECTION_GROUPS = ["Coach", "Providers", "Tools"] as const;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] =
    useState<ChatSettingsSectionId>("display");
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

  // Highlight the rail entry for whichever section sits nearest the top of
  // the scroll area.
  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (!root) return;
    const update = () => {
      const top = root.getBoundingClientRect().top + 96;
      const sections = Array.from(
        root.querySelectorAll<HTMLElement>("[data-settings-section]")
      );
      let current = sections[0]?.dataset.settingsSection;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= top) {
          current = section.dataset.settingsSection;
        }
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        current = sections.at(-1)?.dataset.settingsSection ?? current;
      }
      if (current) setActiveSection(current as ChatSettingsSectionId);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    return () => root.removeEventListener("scroll", update);
  }, [open]);

  if (!open) {
    return null;
  }

  const jumpTo = (id: ChatSettingsSectionId) => {
    setActiveSection(id);
    document
      .getElementById(chatSettingsSectionDomId(id))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
        className="chat-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="chat-settings-rail">
          <div className="chat-settings-modal-title">
            <span className="chat-settings-modal-mark" aria-hidden="true">
              <Settings2 size={17} strokeWidth={1.8} />
            </span>
            <div>
              <h2 id="chat-settings-title">Settings</h2>
              <span>Training Coach</span>
            </div>
          </div>
          <nav className="chat-settings-nav" aria-label="Settings sections">
            {SECTION_GROUPS.map((group) => (
              <div key={group} className="chat-settings-nav-group">
                <span className="chat-settings-nav-label">{group}</span>
                {CHAT_SETTINGS_SECTIONS.filter(
                  (section) => section.group === group
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      activeSection === id
                        ? "chat-settings-nav-item is-active"
                        : "chat-settings-nav-item"
                    }
                    aria-current={activeSection === id ? "true" : undefined}
                    onClick={() => jumpTo(id)}
                  >
                    <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <p className="chat-settings-rail-note">
            <kbd>Esc</kbd> to close
          </p>
        </aside>
        <button
          type="button"
          className="icon-button chat-settings-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <div className="chat-settings-modal-body" ref={scrollRef}>
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
