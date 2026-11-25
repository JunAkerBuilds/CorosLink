import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acpFailure, acpPrompt, allowCoachTools, sessionModels } from "./acp";
import { signInLink } from "./antigravity";
import { geminiSignIn } from "./geminiCli";
import { opencodeConfig } from "./opencode";

const options = [{ optionId: "a1", kind: "allow_once" }, { optionId: "r1", kind: "reject_once" }];

describe("Agents over ACP", () => {
  it("allows Coach's own tools once, and nothing that runs or changes something", () => {
    expect(allowCoachTools({ toolCall: { kind: "other", _meta: { is_mcp_tool_call: true, mcp: { server: "clink" } } }, options })).toEqual({ outcome: { outcome: "selected", optionId: "a1" } });
    expect(allowCoachTools({ toolCall: { kind: "execute" }, options })).toEqual({ outcome: { outcome: "cancelled" } });
    expect(allowCoachTools({ toolCall: { kind: "other", _meta: { mcp: { server: "elsewhere" } } }, options })).toEqual({ outcome: { outcome: "cancelled" } });
    expect(allowCoachTools({ toolCall: { kind: "other" }, options: [] })).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("reads a session's models from config options or the older list", () => {
    expect(sessionModels({ configOptions: [{ id: "model", type: "select", currentValue: "b", options: [{ value: "a", name: "A" }, { group: "g", options: [{ value: "b" }] }] }] })).toEqual({ models: [{ value: "a", name: "A" }, { value: "b", name: "b" }], current: "b" });
    expect(sessionModels({ models: { currentModelId: "x", availableModels: [{ modelId: "x", name: "X" }] } })).toEqual({ models: [{ value: "x", name: "X" }], current: "x" });
  });

  it("sends photos as image blocks", () => {
    expect(acpPrompt("Look", [{ name: "p.png", mime: "image/png", kind: "image", data: "AAAA" }])).toEqual([{ type: "text", text: "Look" }, { type: "image", mimeType: "image/png", data: "AAAA" }]);
  });

  it("keeps an agent's own words when they explain more", () => {
    expect(acpFailure("OpenCode", new Error("Internal error: Insufficient balance. Top up.")).message).toBe("OpenCode: Insufficient balance. Top up.");
    expect(acpFailure("Gemini CLI", new Error("This client is no longer supported. Please migrate.")).code).toBe("bad_key");
    expect(acpFailure("OpenCode", new Error("Authentication required: provider authentication required")).code).toBe("bad_key");
  });

  it("gives OpenCode one Coach agent that may use only Coach's tools, with the bridge declared directly", () => {
    const config = opencodeConfig(2, "Rules {env:HOME}", { url: "http://127.0.0.1:1/mcp", token: "t" }) as { agents: Record<string, { system: string }>; mcp: { servers: { clink: { codemode: boolean } } }; permissions: unknown[] };
    expect(config.agents["clink-coach"].system).toBe("Rules { env:HOME}");
    expect(config.mcp.servers.clink.codemode).toBe(false);
    expect(config.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }, { action: "clink_*", resource: "*", effect: "allow" }]);
  });

  it("opens only Google's sign-in link from Antigravity's log", () => {
    expect(signInLink("Open the following link to authenticate the ACP server: https://accounts.google.com/o/oauth2/auth?x=1")).toBe("https://accounts.google.com/o/oauth2/auth?x=1");
    expect(signInLink("Open the following link to authenticate the ACP server: https://evil.example/x")).toBeNull();
  });

  it("knows Gemini CLI's sign-in from its settings, without reading the credentials", () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "gemini-"));
    expect(geminiSignIn(home, {})).toEqual({ signedIn: false });
    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }));
    expect(geminiSignIn(home, {})).toEqual({ method: "oauth-personal", signedIn: false });
    writeFileSync(path.join(home, "oauth_creds.json"), "{}");
    expect(geminiSignIn(home, {}).signedIn).toBe(true);
  });
});
