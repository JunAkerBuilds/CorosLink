import { describe, expect, it } from "vitest";
import { runCoach } from "@/lib/coach/loop";
import { athleteItems } from "@/lib/coach/items";
import { planEntries } from "@/lib/coach/read";
import { seedItems } from "@/data/sampleSeed";
import { geminiModel, toGemini } from "./gemini";

const sse = (chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(""), { status: 200 });

const NOW = new Date(2026, 10, 20, 14, 10);
const tools = () => {
  const items = athleteItems(seedItems(NOW));
  return { items, clock: { nowMs: NOW.getTime(), offsetMin: NOW.getTimezoneOffset() }, entries: planEntries(items, null, []), hubNote: null, hub: null, browser: [], newId: () => "ID", asked: false };
};

describe("Coach on Gemini", () => {
  it("streams words, keeps function calls with their signatures, and reads usage", async () => {
    let sent: Record<string, unknown> | null = null;
    const seen: string[] = [];
    const model = geminiModel("k", "gemini-3.8-flash", async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return sse([
        { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "Let me " }] } }] },
        { candidates: [{ content: { parts: [{ text: "look." }, { functionCall: { name: "read_activities", args: { days: 7 } }, thoughtSignature: "sig" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 } },
      ]);
    });
    const turn = await model.turn({ rules: "R", context: "C", messages: [{ role: "user", content: "hi" }], tools: [{ name: "read_activities", description: "d", input_schema: { type: "object", properties: {} } }], allowTools: true, onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("Let me look.");
    expect(turn.calls).toEqual([{ id: "call_3", name: "read_activities", input: { days: 7 } }]);
    expect(turn.stop).toBe("tools");
    expect(turn.inputTokens + turn.outputTokens).toBe(125);
    expect((sent!.systemInstruction as { parts: { text: string }[] }).parts[0].text).toBe("R\n\nC");
    expect(sent!.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });

    // The result goes back named after the call it answers, after the model's own parts.
    const contents = toGemini([{ role: "user", content: "hi" }, { role: "assistant", content: turn.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_3", content: "none" }] }]);
    expect(contents[1].parts[1]).toEqual({ functionCall: { id: "call_3", name: "read_activities", args: { days: 7 } }, thoughtSignature: "sig" });
    expect(contents[2].parts[0]).toEqual({ functionResponse: { id: "call_3", name: "read_activities", response: { result: "none" } } });
  });

  it("runs Coach's loop to a worded answer", async () => {
    let round = 0;
    const model = geminiModel("k", "m", async () => sse(round++ === 0
      ? [{ candidates: [{ content: { parts: [{ functionCall: { name: "read_profile", args: {} } }] }, finishReason: "STOP" }] }]
      : [{ candidates: [{ content: { parts: [{ text: "You look ready." }] }, finishReason: "STOP" }] }]));
    const { blocks } = await runCoach({ model, rules: "R", context: "C", history: [{ role: "user", content: "How do I look?" }], tools: tools(), emit: () => {} });
    expect(blocks.at(-1)).toEqual({ kind: "text", text: "You look ready." });
  });

  it("says a refused key is the key", async () => {
    const model = geminiModel("bad", "m", async () => new Response(JSON.stringify({ error: { message: "API key not valid." } }), { status: 400 }));
    await expect(model.turn({ rules: "", context: "", messages: [{ role: "user", content: "hi" }], tools: [], allowTools: false, onText: () => {} })).rejects.toMatchObject({ code: "bad_key" });
  });
});
