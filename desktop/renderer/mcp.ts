// The athlete's MCP servers (desktop/main/ai/mcp.ts), as Coach settings reads and changes them. Tokens and env
// values go in; nothing secret comes back out.
export type McpState = "off" | "idle" | "connecting" | "connected" | "error" | "signin";

export interface McpToolView { name: string; description: string; on: boolean; as: string }
export interface McpServerView {
  id: string; name: string; enabled: boolean; transport: "stdio" | "http"; auth: "none" | "bearer" | "oauth";
  target: string; envNames: string[]; headerNames: string[];
  state: McpState; error?: string; signedIn: boolean; tools: McpToolView[];
}
export interface McpStatus { servers: McpServerView[]; added?: string }

export interface McpServerInput {
  name: string; transport: "stdio" | "http";
  command?: string; args?: string[]; env?: Record<string, string>;
  url?: string; auth?: "none" | "bearer" | "oauth"; bearer?: string; scope?: string; headers?: Record<string, string>;
}

async function call<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/desktop/mcp${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }
    : { cache: "no-store" });
  const answer = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !answer) throw new Error(answer?.message ?? "That didn't work.");
  return answer;
}

export const readMcp = () => call<McpStatus>("");
export const addMcp = (server: McpServerInput) => call<McpStatus>("/add", server);
export const removeMcp = (id: string) => call<McpStatus>("/remove", { id });
export const enableMcp = (id: string, enabled: boolean) => call<McpStatus>("/enable", { id, enabled });
export const setMcpTool = (id: string, tool: string, on: boolean) => call<McpStatus>("/tools", { id, tool, on });
export const setMcpTools = (id: string, all: boolean) => call<McpStatus>("/tools", { id, all });
export const reconnectMcp = (id: string) => call<McpStatus>("/connect", { id });
export const signInMcp = (id: string) => call<McpStatus>("/signin", { id });
export const signOutMcp = (id: string) => call<McpStatus>("/signout", { id });

/** Splits a typed command line into words, keeping quoted parts together: npx -y "my server" → [npx, -y, my server]. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word = "", quote: string | null = null, any = false;
  for (const ch of line.trim()) {
    if (quote) { if (ch === quote) quote = null; else word += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (word || any) words.push(word); word = ""; any = false; continue; }
    word += ch;
  }
  if (word || any) words.push(word);
  return words;
}

/** NAME=value lines (env) or Name: value lines (headers) into pairs; blank lines skipped. */
export function parsePairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(sep);
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}
