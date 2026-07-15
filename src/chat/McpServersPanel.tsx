import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, PlugZap, Trash2 } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  McpServerConfig,
  McpServerInput,
  McpServerStatus
} from "../../electron/types";

// One-click presets: hosted URL + OAuth MCP servers (scope discovered from the
// server's own auth metadata by the MCP SDK).
const PRESETS: McpServerInput[] = [
  { id: "freddy", name: "Freddy", url: "https://freddy.coach/mcp", authType: "oauth" },
  { id: "strava", name: "Strava", url: "https://mcp.strava.com/mcp", authType: "oauth" }
];

export function McpServersPanel({ api }: { api: CorosLinkApi | undefined }) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      }
    },
    [api, refresh]
  );

  if (!api) return null;

  const existingIds = new Set(servers.map((s) => s.id));
  const availablePresets = PRESETS.filter((p) => !existingIds.has(p.id ?? ""));

  return (
    <div className="mcp-servers-panel">
      {error ? <p className="mcp-servers-error">{error}</p> : null}

      <ul className="mcp-servers-list">
        {servers.map((server) => {
          const status = statuses[server.id];
          const busy = busyId === server.id;
          return (
            <li key={server.id} className="mcp-server-row">
              <div className="mcp-server-info">
                <div className="mcp-server-title">
                  <strong>{server.name}</strong>
                  <span
                    className={`mcp-server-pill${
                      status?.connected ? " is-connected" : ""
                    }`}
                  >
                    {status?.connected
                      ? `Connected · ${status.toolCount} tools`
                      : status?.authenticated
                        ? "Authorized"
                        : "Not connected"}
                  </span>
                </div>
                <code className="mcp-server-url">{server.url}</code>
                {status?.error ? (
                  <span className="mcp-server-row-error">{status.error}</span>
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
                    title="Remove"
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

      {availablePresets.length > 0 ? (
        <div className="mcp-servers-presets">
          <span>Quick add:</span>
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
              {preset.name}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="mcp-servers-add"
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
        <input
          type="text"
          placeholder="Name"
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
        />
        <input
          type="url"
          placeholder="https://server/mcp"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
        />
        <select
          value={addAuth}
          onChange={(e) =>
            setAddAuth(e.target.value as "oauth" | "bearer" | "none")
          }
          aria-label="Auth type"
        >
          <option value="oauth">OAuth</option>
          <option value="bearer">API key</option>
          <option value="none">None</option>
        </select>
        <button type="submit" disabled={busyId !== null}>
          Add
        </button>
      </form>
    </div>
  );
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
    <div className="mcp-server-bearer">
      <input
        type="password"
        placeholder="API key / bearer token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
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
        Save
      </button>
    </div>
  );
}
