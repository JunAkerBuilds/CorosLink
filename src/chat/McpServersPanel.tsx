import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  KeyRound,
  Loader2,
  Network,
  Plus,
  Plug,
  PlugZap,
  Server,
  ShieldCheck,
  Trash2,
  Unplug
} from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  McpServerConfig,
  McpServerInput,
  McpServerStatus
} from "../../electron/types";

// One-click presets: hosted URL + OAuth MCP servers (scope discovered from the
// server's own auth metadata by the MCP SDK).
const PRESETS: Array<McpServerInput & { description: string }> = [
  {
    id: "freddy",
    name: "Freddy",
    url: "https://freddy.coach/mcp",
    authType: "oauth",
    description: "Training and recovery guidance"
  },
  {
    id: "strava",
    name: "Strava",
    url: "https://mcp.strava.com/mcp",
    authType: "oauth",
    description: "Activities, routes, and performance data"
  }
];

export function McpServersPanel({
  api,
  refreshVersion = 0,
  onChange
}: {
  api: CorosLinkApi | undefined;
  refreshVersion?: number;
  onChange?: () => void | Promise<void>;
}) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addAuth, setAddAuth] = useState<"oauth" | "bearer" | "none">("oauth");

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [list, statusList] = await Promise.all([
        api.listMcpServers(),
        api.getMcpStatuses()
      ]);
      setServers(list);
      setStatuses(Object.fromEntries(statusList.map((s) => [s.id, s])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshVersion]);

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      if (!api) return;
      setBusyId(id);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusyId(null);
        await refresh();
        await onChange?.();
      }
    },
    [api, onChange, refresh]
  );

  if (!api) return null;

  const existingIds = new Set(servers.map((s) => s.id));
  const availablePresets = PRESETS.filter((p) => !existingIds.has(p.id ?? ""));
  const connectedCount = Object.values(statuses).filter(
    (status) => status.connected
  ).length;
  const toolCount = Object.values(statuses).reduce(
    (total, status) => total + (status.connected ? status.toolCount : 0),
    0
  );

  return (
    <div className="mcp-servers-panel">
      <div className="mcp-servers-overview" aria-live="polite">
        <span className="mcp-servers-overview-icon" aria-hidden="true">
          <Network size={17} />
        </span>
        <div>
          <strong>
            {loading
              ? "Checking connections"
              : `${connectedCount} of ${servers.length} connected`}
          </strong>
          <span>
            {loading
              ? "Loading server status and available tools"
              : toolCount > 0
                ? `${toolCount} tools ready for the coach`
                : "Connect a server to make its tools available"}
          </span>
        </div>
      </div>

      {error ? (
        <p className="mcp-servers-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="mcp-servers-list" aria-hidden="true">
          <div className="mcp-server-skeleton" />
          <div className="mcp-server-skeleton" />
        </div>
      ) : servers.length > 0 ? (
        <ul className="mcp-servers-list">
          {servers.map((server) => {
            const status = statuses[server.id];
            const busy = busyId === server.id;
            const state =
              status?.enabled === false
                ? "disabled"
                : status?.connected
                  ? "connected"
                  : status?.authenticated
                    ? "authorized"
                    : "disconnected";
            const StatusIcon =
              state === "connected"
                ? CircleCheck
                : state === "authorized"
                  ? ShieldCheck
                  : Unplug;
            const statusLabel =
              state === "connected"
                ? `${status.toolCount} ${status.toolCount === 1 ? "tool" : "tools"} ready`
                : state === "authorized"
                  ? "Ready to connect"
                  : state === "disabled"
                    ? "Disabled"
                    : "Not connected";

            return (
              <li
                key={server.id}
                className="mcp-server-row"
                data-state={state}
              >
                <span className="mcp-server-icon" aria-hidden="true">
                  <Server size={17} />
                </span>
                <div className="mcp-server-info">
                  <div className="mcp-server-title">
                    <strong>{server.name}</strong>
                    <span className={`mcp-server-pill is-${state}`}>
                      <StatusIcon size={12} aria-hidden="true" />
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mcp-server-meta">
                    <code className="mcp-server-url">{server.url}</code>
                    <span>{authLabel(server.authType)}</span>
                  </div>
                  {status?.error ? (
                    <span className="mcp-server-row-error">
                      <AlertCircle size={13} aria-hidden="true" />
                      {status.error}
                    </span>
                  ) : null}
                  {server.authType === "bearer" ? (
                    <BearerField
                      disabled={busy}
                      onSave={(token) =>
                        run(server.id, () => api.setMcpBearer(server.id, token))
                      }
                    />
                  ) : null}
                </div>
                <div className="mcp-server-actions">
                  {status?.connected ? (
                    <button
                      type="button"
                      className="mcp-server-action"
                      disabled={busy}
                      onClick={() =>
                        run(server.id, () => api.disconnectMcpServer(server.id))
                      }
                    >
                      {busy ? (
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                      ) : (
                        <Plug size={14} aria-hidden="true" />
                      )}
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mcp-server-action is-primary"
                      disabled={busy}
                      onClick={() =>
                        run(server.id, () => api.connectMcpServer(server.id))
                      }
                    >
                      {busy ? (
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                      ) : (
                        <PlugZap size={14} aria-hidden="true" />
                      )}
                      Connect
                    </button>
                  )}
                  {server.builtin ? null : (
                    <button
                      type="button"
                      className="mcp-server-remove"
                      disabled={busy}
                      title="Remove server"
                      aria-label={`Remove ${server.name}`}
                      onClick={() =>
                        run(server.id, () => api.removeMcpServer(server.id))
                      }
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mcp-servers-empty">
          <Server size={20} aria-hidden="true" />
          <div>
            <strong>No MCP servers added</strong>
            <span>Use quick connect or add a custom endpoint below.</span>
          </div>
        </div>
      )}

      {availablePresets.length > 0 ? (
        <section className="mcp-servers-presets" aria-labelledby="mcp-quick-add">
          <div className="mcp-servers-subheading">
            <div>
              <strong id="mcp-quick-add">Quick connect</strong>
              <span>Trusted hosted servers with OAuth sign-in</span>
            </div>
          </div>
          <div className="mcp-servers-preset-grid">
            {availablePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={busyId !== null}
                onClick={() =>
                  run(preset.id ?? preset.name, async () => {
                    const added = await api.addMcpServer(preset);
                    await api.connectMcpServer(added.id);
                  })
                }
              >
                <span className="mcp-server-preset-icon" aria-hidden="true">
                  <PlugZap size={16} />
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.description}</small>
                </span>
                {busyId === preset.id ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Plus size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <form
        className="mcp-servers-add"
        aria-labelledby="mcp-custom-server"
        onSubmit={(event) => {
          event.preventDefault();
          if (!addName.trim() || !addUrl.trim()) return;
          void run("__add__", async () => {
            const added = await api.addMcpServer({
              name: addName.trim(),
              url: addUrl.trim(),
              authType: addAuth
            });
            setAddName("");
            setAddUrl("");
            if (added.authType === "oauth") {
              await api.connectMcpServer(added.id);
            }
          });
        }}
      >
        <div className="mcp-servers-subheading">
          <div>
            <strong id="mcp-custom-server">Custom server</strong>
            <span>Add any compatible streamable HTTP endpoint</span>
          </div>
        </div>
        <div className="mcp-servers-add-fields">
          <label className="mcp-server-field">
            <span>Server name</span>
            <input
              type="text"
              placeholder="My training service"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              required
            />
          </label>
          <label className="mcp-server-field is-url">
            <span>MCP endpoint</span>
            <input
              type="url"
              placeholder="https://server.example/mcp"
              value={addUrl}
              onChange={(event) => setAddUrl(event.target.value)}
              required
            />
          </label>
          <label className="mcp-server-field">
            <span>Authentication</span>
            <select
              value={addAuth}
              onChange={(event) =>
                setAddAuth(event.target.value as "oauth" | "bearer" | "none")
              }
            >
              <option value="oauth">OAuth</option>
              <option value="bearer">API key</option>
              <option value="none">None</option>
            </select>
          </label>
          <button
            type="submit"
            className="mcp-servers-add-submit"
            disabled={busyId !== null || !addName.trim() || !addUrl.trim()}
          >
            {busyId === "__add__" ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            Add server
          </button>
        </div>
      </form>
    </div>
  );
}

function authLabel(authType: McpServerConfig["authType"]): string {
  if (authType === "oauth") return "OAuth";
  if (authType === "bearer") return "API key";
  return "No authentication";
}

function BearerField({
  disabled,
  onSave
}: {
  disabled: boolean;
  onSave: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  return (
    <label className="mcp-server-bearer-field">
      <span>API key</span>
      <span className="mcp-server-bearer">
        <KeyRound size={14} aria-hidden="true" />
        <input
          type="password"
          placeholder="Paste bearer token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          disabled={disabled || !token.trim()}
          onClick={() => {
            onSave(token.trim());
            setToken("");
          }}
        >
          Save key
        </button>
      </span>
    </label>
  );
}
