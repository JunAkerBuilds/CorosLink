import { mkdtempSync, writeFileSync } from "node:fs";
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

describe("AI program path", () => {
  it("keeps a path to the program itself and refuses any other file", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "clink-ai-"));
    const vault = new AIVault(folder, sealer);
    const claude = path.join(folder, "claude");
    writeFileSync(claude, "");
    const ai = new AIService(vault, { "claude-code": { ...account([]), programName: "claude" } });

    const after = await call(ai, "/api/desktop/ai/program", { provider: "claude-code", program: `"${claude}"` });
    expect(vault.current.programs["claude-code"]).toBe(claude);
    expect((after.providers as { id: string; programName?: string }[]).find((p) => p.id === "claude-code")?.programName).toBe("claude");

    // Some other program, a relative path, or one that isn't there is refused and the saved one kept.
    const other = path.join(folder, "calc");
    writeFileSync(other, "");
    expect((await call(ai, "/api/desktop/ai/program", { provider: "claude-code", program: other })).error).toBe("invalid");
    expect((await call(ai, "/api/desktop/ai/program", { provider: "claude-code", program: "claude" })).error).toBe("invalid");
    expect((await call(ai, "/api/desktop/ai/program", { provider: "claude-code", program: path.join(folder, "gone", "claude") })).error).toBe("invalid");
    expect((await call(ai, "/api/desktop/ai/program", { provider: "chatgpt", program: claude })).error).toBe("invalid");
    expect(vault.current.programs["claude-code"]).toBe(claude);

    await call(ai, "/api/desktop/ai/program", { provider: "claude-code", program: "" });
    expect(vault.current.programs["claude-code"]).toBeUndefined();
  });
});

describe("AI sign-in", () => {
  it("picks the provider once signed in, and not while the sign-in is still open", async () => {
    const vault = new AIVault(mkdtempSync(path.join(tmpdir(), "clink-ai-")), sealer);
    let signingIn = false;
    const claude: AccountProvider = { ...account([]), status: async () => ({ ready: false, signingIn }), signIn: async () => { signingIn = true; } };
    const ai = new AIService(vault, { "claude-code": claude, chatgpt: account([]) });

    await call(ai, "/api/desktop/ai/signin", { provider: "chatgpt" });
    expect(vault.current.picked).toBe("chatgpt");

    // Claude Code's sign-in finishes in the browser: the page picks it once the provider reads as ready.
    await call(ai, "/api/desktop/ai/signin", { provider: "claude-code" });
    expect(vault.current.picked).toBe("chatgpt");
    const one = await call(ai, "/api/desktop/ai/provider?provider=claude-code");
    expect(one.provider).toMatchObject({ id: "claude-code", ready: false, signingIn: true });
  });
});
