import {
  Bot,
  CircleCheck,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Terminal
} from "lucide-react";
import type {
  ChatAuthStatus,
  ChatSettings,
  ClaudeCodeStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery
} from "../../electron/types";
import { McpServersPanel } from "./McpServersPanel";
import type { CorosLinkApi } from "../coroslink-api";

function claudeStatusLabel(status: ClaudeCodeStatus | null): string {
  if (!status) return "Not checked";
  if (status.state === "not-installed") return "Not installed";
  if (status.state === "sign-in-required") return "Installed, sign-in required";
  if (status.state === "connecting") return "Connecting";
  if (status.state === "connected") return "Connected";
  if (status.state === "usage-limit-reached") return "Usage limit reached";
  return "Connection failed";
}

export function ChatSettingsPanel({
  api,
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
  mcpRefreshVersion,
  busy,
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
  onMcpServersChange,
  onUpdateChatSettings
}: {
  api: CorosLinkApi | undefined;
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
  mcpRefreshVersion: number;
  busy?: boolean;
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
  onMcpServersChange: () => void | Promise<void>;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => void;
}) {
  const availableLocalServers =
    localDiscovery?.servers.filter(
      (server) => server.ok && server.models.length > 0
    ) ?? [];
  const selectedLocalServer =
    availableLocalServers.find(
      (server) => server.baseUrl === chatSettings.local.baseUrl
    ) ?? availableLocalServers[0];
  const discoveredLocalModels = selectedLocalServer?.models ?? [];

  return (
    <div className="chat-settings-panel">
      <section className="chat-settings-section">
        <h3>Display</h3>
        <label className="chat-local-tools">
          <input
            type="checkbox"
            checked={chatSettings.visualizationsEnabled === true}
            onChange={(event) =>
              onUpdateChatSettings({
                visualizationsEnabled: event.target.checked
              })
            }
          />
          <span>Show charts and activity visuals in chat</span>
        </label>
        <p className="chat-settings-copy">
          When off, heart rate trends, zone summaries, and activity charts are
          hidden. The coach still responds with text.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>ChatGPT account</h3>
        {authStatus?.signedIn ? (
          <div className="chat-settings-account">
            {authStatus.email ? (
              <span className="chat-settings-email">{authStatus.email}</span>
            ) : (
              <span className="chat-settings-email">Signed in</span>
            )}
            <button
              type="button"
              className="chat-signout chat-signout-settings"
              onClick={onSignOut}
              disabled={busy}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="chat-settings-account">
            <p className="chat-settings-copy">
              Sign in with your ChatGPT account to use cloud coaching.
            </p>
            <button
              type="button"
              className="primary-button chat-settings-signin"
              onClick={onSignIn}
              disabled={signingIn || busy}
            >
              {signingIn ? (
                <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
              ) : null}
              Sign in with ChatGPT
            </button>
          </div>
        )}
      </section>

      <section className="chat-settings-section chat-claude-section">
        <div className="chat-settings-section-title">
          <h3>Claude subscription</h3>
          <span className="chat-beta-badge">Beta</span>
        </div>
        <p className="chat-settings-copy">
          Uses Claude Code installed and signed in on this computer. CorosLink
          never reads or stores your Claude password or subscription credentials.
        </p>

        <label className="chat-local-field">
          <span>Claude executable</span>
          <div className="chat-claude-path-row">
            <Terminal size={15} aria-hidden="true" />
            <input
              value={chatSettings.claudeCode.executablePath ?? ""}
              onChange={(event) =>
                onUpdateClaudeCode({ executablePath: event.target.value })
              }
              placeholder="Auto-detect Claude Code"
              spellCheck={false}
            />
          </div>
        </label>

        <label className="chat-local-field">
          <span>Model</span>
          <select
            value={chatSettings.claudeCode.model ?? ""}
            onChange={(event) =>
              onUpdateClaudeCode({ model: event.target.value })
            }
          >
            <option value="">Account default</option>
            <option value="opus">Opus (most capable)</option>
            <option value="sonnet">Sonnet (balanced)</option>
            <option value="haiku">Haiku (fastest)</option>
          </select>
        </label>

        <div className="chat-claude-status" data-state={claudeStatus?.state}>
          {checkingClaude || connectingClaude ? (
            <Loader2 className="chat-spinner" size={15} aria-hidden="true" />
          ) : claudeStatus?.state === "connected" ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <Terminal size={15} aria-hidden="true" />
          )}
          <div>
            <strong>{claudeStatusLabel(claudeStatus)}</strong>
            <span>
              {claudeStatus?.message ??
                "Check this computer for an installed Claude Code runtime."}
            </span>
          </div>
        </div>

        <div className="chat-local-actions chat-claude-actions">
          <button
            type="button"
            className="chat-local-action"
            onClick={onRefreshClaude}
            disabled={checkingClaude || connectingClaude || testingClaude || busy}
          >
            {checkingClaude ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            Check
          </button>
          {claudeStatus?.state === "not-installed" ? (
            <button
              type="button"
              className="chat-local-action"
              onClick={onOpenClaudeSetupGuide}
            >
              <ExternalLink size={14} aria-hidden="true" />
              Install Claude Code
            </button>
          ) : null}
          {claudeStatus?.installed && claudeStatus.state !== "connected" ? (
            <button
              type="button"
              className="chat-local-action primary"
              onClick={onConnectClaude}
              disabled={connectingClaude || busy}
            >
              {connectingClaude ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Terminal size={14} aria-hidden="true" />
              )}
              Sign in with Claude
            </button>
          ) : null}
          {claudeStatus?.state === "connected" ? (
            <button
              type="button"
              className="chat-local-action primary"
              onClick={onTestClaude}
              disabled={testingClaude || busy}
            >
              {testingClaude ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              Test connection
            </button>
          ) : null}
          <button
            type="button"
            className="chat-local-action"
            onClick={onOpenClaudeSetupGuide}
          >
            <ExternalLink size={14} aria-hidden="true" />
            Setup guide
          </button>
        </div>

        <div className="chat-claude-permissions">
          <strong>Claude can access</strong>
          {(
            [
              ["recentActivities", "Recent activities"],
              ["trainingMetrics", "Training metrics"],
              ["upcomingWorkouts", "Upcoming workouts"],
              ["sleepData", "Sleep data"]
            ] as const
          ).map(([permission, label]) => (
            <label key={permission} className="chat-local-tools">
              <input
                type="checkbox"
                checked={chatSettings.claudeCode.permissions[permission]}
                onChange={(event) =>
                  onUpdateClaudeCode({
                    permissions: {
                      ...chatSettings.claudeCode.permissions,
                      [permission]: event.target.checked
                    }
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="chat-local-tools is-disabled">
            <input type="checkbox" checked={false} disabled />
            <span>Full activity files (not available in beta)</span>
          </label>
        </div>
        <p className="chat-settings-copy">
          These selections control built-in COROS and Training Hub data.
          Connected custom MCP servers are trusted separately and can expose
          their tools to Claude. Drafts stay local until you click an upload or
          delete button.
        </p>
      </section>

      <section className="chat-settings-section">
        <h3>Local model</h3>
        <div className="chat-local-settings chat-local-settings-panel">
            <label className="chat-local-field">
              <span>Server</span>
              {availableLocalServers.length > 0 ? (
                <select
                  value={selectedLocalServer?.baseUrl ?? chatSettings.local.baseUrl}
                  onChange={(event) => {
                    const server = availableLocalServers.find(
                      (entry) => entry.baseUrl === event.target.value
                    );
                    if (!server) return;
                    onUpdateLocalDraft({
                      baseUrl: server.baseUrl,
                      model: server.models.includes(chatSettings.local.model)
                        ? chatSettings.local.model
                        : server.models[0] ?? ""
                    });
                  }}
                >
                  {availableLocalServers.map((server) => (
                    <option key={server.baseUrl} value={server.baseUrl}>
                      {server.label} · {server.models.length} model
                      {server.models.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={chatSettings.local.baseUrl}
                  onChange={(event) =>
                    onUpdateLocalDraft({ baseUrl: event.target.value })
                  }
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field">
              <span>Model</span>
              {discoveredLocalModels.length > 0 ? (
                <select
                  value={
                    discoveredLocalModels.includes(chatSettings.local.model)
                      ? chatSettings.local.model
                      : discoveredLocalModels[0]
                  }
                  onChange={(event) =>
                    onUpdateLocalDraft({ model: event.target.value })
                  }
                >
                  {discoveredLocalModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={chatSettings.local.model}
                  onChange={(event) =>
                    onUpdateLocalDraft({ model: event.target.value })
                  }
                  placeholder="Detect models or enter a model id"
                  spellCheck={false}
                />
              )}
            </label>
            <label className="chat-local-field chat-local-field-key">
              <span>API key</span>
              <div className="chat-local-key-row">
                <KeyRound size={14} aria-hidden="true" />
                <input
                  value={localApiKey}
                  onChange={(event) => onLocalApiKeyChange(event.target.value)}
                  placeholder={
                    chatSettings.local.hasApiKey ? "Saved key" : "Optional"
                  }
                  type="password"
                  spellCheck={false}
                />
                {chatSettings.local.hasApiKey ? (
                  <button
                    type="button"
                    onClick={onClearLocalApiKey}
                    disabled={savingSettings}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </label>
            <label className="chat-local-tools">
              <input
                type="checkbox"
                checked={chatSettings.local.toolsEnabled}
                onChange={(event) =>
                  onUpdateLocalDraft({ toolsEnabled: event.target.checked })
                }
              />
              <span>Use COROS tools when supported</span>
            </label>
            <div className="chat-local-actions">
              <button
                type="button"
                className="chat-local-action"
                onClick={onDetectLocalServers}
                disabled={detectingLocal || busy}
              >
                {detectingLocal ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <RefreshCw size={14} aria-hidden="true" />
                )}
                Detect
              </button>
              <button
                type="button"
                className="chat-local-action"
                onClick={onTestLocalConnection}
                disabled={testingLocal || busy}
              >
                {testingLocal ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Bot size={14} aria-hidden="true" />
                )}
                Test
              </button>
              <button
                type="button"
                className="chat-local-action primary"
                onClick={onSaveLocalSettings}
                disabled={savingSettings || busy}
              >
                {savingSettings ? (
                  <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
                ) : (
                  <Save size={14} aria-hidden="true" />
                )}
                Save
              </button>
            </div>
            {localConnection ? (
              <p
                className={
                  localConnection.ok
                    ? "chat-local-result is-ready"
                    : "chat-local-result is-error"
                }
              >
                {localConnection.message}
              </p>
            ) : null}
        </div>
      </section>

      <section className="chat-settings-section">
        <h3>MCP servers</h3>
        <p className="chat-settings-copy">
          Connect additional Model Context Protocol servers so the coach can call
          their tools. Their tools appear alongside COROS, namespaced per server.
          Only add servers you trust because tool descriptions and returned data
          are shared with the selected coach provider.
        </p>
        <McpServersPanel
          api={api}
          refreshVersion={mcpRefreshVersion}
          onChange={onMcpServersChange}
        />
      </section>
    </div>
  );
}
