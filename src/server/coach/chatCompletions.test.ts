import { describe, expect, it } from "vitest";
import { runCoach } from "@/lib/coach/loop";
import { parseFiles, withFiles } from "@/lib/coach/files";
import { chatCompletionsModel, toOpenAI, type ChatEndpoint } from "./chatCompletions";
import { CoachModelError } from "./anthropic";

const sse = (chunks: unknown[]) => {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + ": OPENROUTER PROCESSING\n\ndata: [DONE]\n\n";
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 40)); c.enqueue(bytes.slice(40)); c.close(); } }), { status: 200 });
};

const openRouter = (model: string): ChatEndpoint => ({
  url: "https://openrouter.ai/api/v1/chat/completions", key: "k", model, name: "OpenRouter", extra: { usage: { include: true } },
});

describe("Coach through a chat-completions API", () => {
  it("streams words, gathers split tool calls and reads usage", async () => {
    const seen: string[] = [];
    let sent: Record<string, unknown> | null = null;
    const model = chatCompletionsModel(openRouter("openai/gpt-6.2-sol"), async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return sse([
        { choices: [{ delta: { content: "Let me " } }] },
        { choices: [{ delta: { content: "look." } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_", arguments: '{"da' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "activities", arguments: 'ys":7}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } },
      ]);
    });
    const turn = await model.turn({ rules: "R", context: "C", messages: [{ role: "user", content: "hi" }], tools: [{ name: "read_activities", description: "d", input_schema: { type: "object", properties: {} } }], allowTools: true, onText: (d) => seen.push(d) });
    expect(seen.join("")).toBe("Let me look.");
    expect(turn.calls).toEqual([{ id: "c1", name: "read_activities", input: { days: 7 } }]);
    expect(turn.stop).toBe("tools");
    expect(turn.inputTokens + turn.outputTokens).toBe(150);
    expect(sent!.model).toBe("openai/gpt-6.2-sol");
    expect(sent!.tool_choice).toBe("auto");
    expect((sent!.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "system", "user"]);
  });

  it("turns tool results and kept assistant turns into OpenAI messages", () => {
    const msgs = toOpenAI({
      rules: "R", context: "C",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: { openai: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_profile", arguments: "{}" } }] } } },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "profile", is_error: false }] },
      ],
    });
    expect(msgs.slice(2)).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_profile", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "profile" },
    ]);
  });

  it("sends photos as images, PDFs as files and text files inline", () => {
    const files = parseFiles([
      { name: "plan.png", mime: "image/png", data: "iVBORw0KGgo=" },
      { name: "labs.pdf", mime: "application/pdf", data: "JVBERi0xLjQ=" },
      { name: "splits.csv", mime: "text/csv", data: "km,time\n1,4:58" },
      { name: "virus.exe", mime: "application/octet-stream", data: "AAAA" },
    ]);
    expect(files.map((f) => f.kind)).toEqual(["image", "pdf", "text"]);
    const [user] = toOpenAI({ rules: "", context: "", messages: [{ role: "user", content: withFiles("Look", files) }] }).slice(2) as { content: { type: string }[] }[];
    expect(user.content.map((p) => p.type)).toEqual(["text", "image_url", "file", "text"]);
  });

  it("names the problem when the service says no", async () => {
    const model = chatCompletionsModel(openRouter("m"), async () => new Response(JSON.stringify({ error: { message: "No credit" } }), { status: 402 }));
    await expect(model.turn({ rules: "", context: "", messages: [], tools: [], allowTools: false, onText: () => {} })).rejects.toMatchObject({ code: "rate_limited" });
    expect(new CoachModelError("bad_key", "x").name).toBe("CoachModelError");
  });

  it("puts the files on the newest question in the loop", async () => {
    let first: unknown = null;
    const files = parseFiles([{ name: "a.txt", mime: "text/plain", data: "hello" }]);
    await runCoach({
      model: { async turn(r) { first ??= r.messages[r.messages.length - 1].content; return { content: "ok", text: "ok", calls: [], stop: "end", inputTokens: 1, outputTokens: 1 }; } },
      rules: "", context: "", history: [{ role: "user", content: "Read this" }], files,
      tools: { items: {} as never, clock: { nowMs: 0, offsetMin: 0 }, entries: [], hubNote: null, hub: null, browser: [], newId: () => "x", asked: false },
      emit: () => {},
    });
    expect(first).toEqual([{ type: "text", text: "Read this" }, { type: "file", file: files[0] }]);
  });
});
