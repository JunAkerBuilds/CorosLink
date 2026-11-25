import { describe, expect, it } from "vitest";
import { chatgptModel, effortsOf, toResponses, tokenFrom, type ChatGPTToken } from "./chatgpt";

const sse = (events: unknown[]) => new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });
const token: ChatGPTToken = { access: "a", refresh: "r", expiresAt: Date.now() + 3600_000, accountId: "acct", email: "me@example.com" };
const tool = { name: "read_profile", description: "d", input_schema: { type: "object" as const, properties: {} } };

describe("ChatGPT", () => {
  it("streams words and function calls from the Responses API, as the Codex app asks", async () => {
    let headers: Headers | null = null, sent: Record<string, unknown> | null = null;
    const model = chatgptModel(async () => token, async () => "gpt-5.5", async (_url, init) => {
      headers = new Headers(init?.headers); sent = JSON.parse(String(init?.body));
      return sse([
        { type: "response.output_text.delta", delta: "Let me " },
        { type: "response.output_text.delta", delta: "look." },
        { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "read_profile", arguments: "{}" } },
        { type: "response.completed", response: { status: "completed", usage: { input_tokens: 90, output_tokens: 10 } } },
      ]);
    });
    const seen: string[] = [];
    const turn = await model.turn({ rules: "R", context: "C", messages: [{ role: "user", content: "hi" }], tools: [tool], allowTools: true, onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("Let me look.");
    expect(turn.calls).toEqual([{ id: "c1", name: "read_profile", input: {} }]);
    expect(turn.stop).toBe("tools");
    expect(turn.inputTokens + turn.outputTokens).toBe(100);
    expect(headers!.get("chatgpt-account-id")).toBe("acct");
    expect(headers!.get("originator")).toBe("codex_cli_rs");
    expect(sent).toMatchObject({ model: "gpt-5.5", instructions: "R\n\nC", stream: true, store: false, tool_choice: "auto" });

    // The next round carries the call and its output.
    const input = toResponses([{ role: "user", content: "hi" }, { role: "assistant", content: turn.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "profile" }] }]);
    expect(input.map((i) => i.type)).toEqual(["message", "message", "function_call", "function_call_output"]);
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "c1", output: "profile" });
  });

  it("asks for sign-in again when the token is refused", async () => {
    const model = chatgptModel(async () => token, async () => "gpt-5.5", async () => new Response("no", { status: 401 }));
    await expect(model.turn({ rules: "", context: "", messages: [{ role: "user", content: "hi" }], tools: [], allowTools: false, onText: () => {} })).rejects.toMatchObject({ code: "bad_key" });
  });

  it("keeps the account and email from the id token, and the refresh token across refreshes", () => {
    const payload = Buffer.from(JSON.stringify({ email: "me@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url");
    const first = tokenFrom({ access_token: "a", refresh_token: "r", expires_in: 100, id_token: `h.${payload}.s` }, null, 0);
    expect(first).toEqual({ access: "a", refresh: "r", expiresAt: 100_000, accountId: "acct", email: "me@example.com" });
    expect(tokenFrom({ access_token: "b" }, first, 0)).toMatchObject({ access: "b", refresh: "r", accountId: "acct" });
  });
  it("sends a power level only when one is picked, and reads each model's levels from the catalog", async () => {
    const bodies: Record<string, unknown>[] = [];
    const answer = async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return sse([{ type: "response.completed", response: { status: "completed" } }]); };
    const ask = { rules: "", context: "", messages: [{ role: "user" as const, content: "hi" }], tools: [], allowTools: false, onText: () => {} };
    await chatgptModel(async () => token, async () => "gpt-5.5", answer, "high").turn(ask);
    await chatgptModel(async () => token, async () => "gpt-5.5", answer).turn(ask);
    expect(bodies[0].reasoning).toEqual({ effort: "high" });
    expect(bodies[1]).not.toHaveProperty("reasoning");

    expect(effortsOf({ supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, "xhigh", { effort: 3 }], default_reasoning_level: "medium" })).toEqual({ levels: ["low", "medium", "xhigh"], default: "medium" });
    expect(effortsOf({ default_reasoning_level: "high" })).toEqual({ levels: [] });
  });
});
