import { describe, expect, it } from "vitest";
import type { ModelMessage, ModelRequest } from "@/lib/coach/loop";
import { agentModel, promptFrom, type AgentDriver } from "./agent";
import { claudeArgs, claudeInput } from "./claudeCode";

/** Calls a tool on the bridge the way an MCP client does. */
async function callTool(bridge: { url: string; token: string }, name: string, args: unknown, token = bridge.token) {
  const response = await fetch(bridge.url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return response.status === 200 ? ((await response.json()) as { result: { content: { text: string }[]; isError: boolean } }).result : response.status;
}

const tool = { name: "read_profile", description: "d", input_schema: { type: "object" as const, properties: {} } };
const ask = (messages: ModelMessage[], over: Partial<ModelRequest> = {}): ModelRequest => ({ rules: "R", context: "C", messages, tools: [tool], allowTools: true, onText: () => {}, ...over });

describe("An agent as a Coach model", () => {
  it("holds each tool call open until Coach's loop has run it, then carries on", async () => {
    let seen: unknown = null, wrongToken: unknown = null, unknown: unknown = null;
    const driver: AgentDriver = async (a) => {
      expect(a.system).toBe("R\n\nC");
      a.onText("Checking. ");
      wrongToken = await callTool(a.bridge, "read_profile", {}, "nope");
      unknown = await callTool(a.bridge, "run_shell", {});
      seen = await callTool(a.bridge, "read_profile", { x: 1 });
      a.onText("You look ready.");
      return { text: "You look ready.", inputTokens: 10, outputTokens: 2 };
    };
    const model = agentModel(driver);
    const first = await model.turn(ask([{ role: "user", content: "How do I look?" }]));
    expect(first.stop).toBe("tools");
    expect(first.text).toBe("Checking.");
    expect(first.calls).toEqual([{ id: expect.any(String), name: "read_profile", input: { x: 1 } }]);
    expect(wrongToken).toBe(401);
    expect(unknown).toMatchObject({ isError: true });

    const second = await model.turn(ask([{ role: "user", content: "How do I look?" }, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: first.calls[0].id, content: "VO2max 58" }] }]));
    expect(seen).toEqual({ content: [{ type: "text", text: "VO2max 58" }], isError: false });
    expect(second).toMatchObject({ stop: "end", text: "You look ready.", inputTokens: 10, outputTokens: 2 });
  });

  it("turns away look-ups on Coach's last round", async () => {
    let answer: unknown = null;
    const model = agentModel(async (a) => { answer = await callTool(a.bridge, "read_profile", {}); return { text: "Done.", inputTokens: 0, outputTokens: 0 }; });
    const turn = await model.turn(ask([{ role: "user", content: "hi" }], { allowTools: false }));
    expect(turn.stop).toBe("end");
    expect(answer).toMatchObject({ isError: true });
  });

  it("starts fresh with the conversation so far written out", () => {
    const { prompt } = promptFrom([{ role: "user", content: "First?" }, { role: "assistant", content: "First answer." }, { role: "user", content: "Second?" }]);
    expect(prompt).toBe("The conversation so far:\n\nAthlete: First?\n\nCoach: First answer.\n\nThe athlete now asks:\n\nSecond?");
  });

  it("runs Claude Code with Coach's tools only", () => {
    const args = claudeArgs("haiku", "S", { url: "http://127.0.0.1:1/mcp", token: "t" });
    expect(args).toEqual(expect.arrayContaining(["--tools", "", "--strict-mcp-config", "--no-session-persistence", "--model", "haiku"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__clink__*");
    expect(args).not.toContain("--effort");
    const strong = claudeArgs("opus", "S", { url: "http://127.0.0.1:1/mcp", token: "t" }, "xhigh");
    expect(strong[strong.indexOf("--effort") + 1]).toBe("xhigh");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1])).toEqual({ mcpServers: { clink: { type: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer t" } } } });
    const input = JSON.parse(claudeInput({ prompt: "Look", files: [{ name: "a.png", mime: "image/png", kind: "image", data: "AAAA" }] }));
    expect(input.message.content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  });
});
