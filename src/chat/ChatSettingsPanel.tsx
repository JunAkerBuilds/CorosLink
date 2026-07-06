import {
  Bot,
  Database,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Save
} from "lucide-react";
import type {
  ChatAuthStatus,
  ChatSettings,
  CorosMcpStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery
} from "../../electron/types";

export function ChatSettingsPanel({
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
        <h3>COROS data</h3>
        <div className="chat-settings-mcp">
          {mcpStatus?.connected ? (
            <>
              <button
                type="button"
                className="chat-mcp-pill connected chat-mcp-pill-settings"
                onClick={onToggleTools}
              >
                <Database size={13} aria-hidden="true" />
                COROS · {mcpStatus.tools.length} tools
              </button>
              {showTools ? (
                <div className="chat-mcp-panel chat-mcp-panel-settings">
                  <div className="chat-mcp-panel-head">
                    <span>{mcpStatus.tools.length} COROS tools</span>
                    <button type="button" onClick={onDisconnectMcp}>
                      Disconnect
                    </button>
                  </div>
                  <ul>
                    {mcpStatus.tools.map((tool) => (
                      <li key={tool.name}>
                        <code>{tool.name}</code>
                        {tool.description ? <span>{tool.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="chat-mcp-pill chat-mcp-pill-settings"
              onClick={onConnectMcp}
              disabled={mcpBusy || busy}
            >
              {mcpBusy ? (
                <Loader2 className="chat-spinner" size={13} aria-hidden="true" />
              ) : (
                <Database size={13} aria-hidden="true" />
              )}
              {mcpBusy
                ? "Connecting…"
                : mcpStatus?.authorized
                  ? "Reconnect COROS"
                  : "Connect COROS"}
            </button>
          )}
          <p className="chat-settings-copy">
            Connect Training Hub so the coach can read activities, create training
            plans, and upload workouts to your COROS calendar.
          </p>
        </div>
      </section>
    </div>
  );
}
