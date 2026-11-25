import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CoachModel } from "@/lib/coach/loop";
import { AIService, type AccountProvider } from "./service";
import { AIVault } from "./vault";

const sealer = { encrypt: async (t: string) => Buffer.from(t), decrypt: async (b: Buffer) => ({ text: b.toString(), stale: false }) };

/** An account that says which model and level it was asked for. */
function account(asked: { model?: string; effort?: string }[]): AccountProvider {
  return {
    status: async () => ({ ready: true }),
    signIn: async () => {}, signOut: async () => {},
    models: async () => ["", "fast", "deep"],
    efforts: async (model) => (model === "fast" ? null : { levels: ["low", "medium", "high"], default: "medium" }),
    model: (model, effort) => { asked.push({ model, effort }); return {} as CoachModel; },
  };
}

const call = (ai: AIService, url: string, body?: unknown) =>
  ai.answer(new Request(`http://app${url}`, body ? { method: "POST", body: JSON.stringify(body) } : {})).then((r) => r.json() as Promise<Record<string, unknown>>);

describe("AI power level", () => {
  it("is kept per provider and sent only to a model that takes it", async () => {
    const asked: { model?: string; effort?: string }[] = [];
    const vault = new AIVault(mkdtempSync(path.join(tmpdir(), "clink-ai-")), sealer);
    vault.choose({ picked: "chatgpt", models: { chatgpt: "deep" } });
    const ai = new AIService(vault, { chatgpt: account(asked) });

    expect(await call(ai, "/api/desktop/ai/efforts?provider=chatgpt&model=deep")).toEqual({ levels: ["low", "medium", "high"], default: "medium", effort: "" });
    expect(await call(ai, "/api/desktop/ai/efforts?provider=chatgpt&model=fast")).toEqual({ levels: [], effort: "" });

    const after = await call(ai, "/api/desktop/ai/effort", { provider: "chatgpt", effort: "high" });
    expect((after.providers as { id: string; effort: string }[]).find((p) => p.id === "chatgpt")?.effort).toBe("high");
    await ai.model();
    expect(asked.at(-1)).toEqual({ model: "deep", effort: "high" });

    // A model without levels gets none, though the level stays saved for the next one that has them.
    vault.choose({ models: { chatgpt: "fast" } });
    await ai.model();
    expect(asked.at(-1)).toEqual({ model: "fast", effort: undefined });

    expect((await call(ai, "/api/desktop/ai/effort", { provider: "chatgpt", effort: "HIGH!" })).error).toBe("invalid");
    await call(ai, "/api/desktop/ai/effort", { provider: "chatgpt", effort: "" });
    expect(vault.current.efforts.chatgpt).toBe("");
  });
});
