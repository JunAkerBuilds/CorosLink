import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_RESULT, McpHub, resultText, schemaOf } from "./mcp";
import { MAX_NAME, serverSlug, toolName, uniqueSlug } from "./mcpNames";
import { checkInput, McpInputError, McpStore } from "./mcpStore";
import { AIVault } from "./vault";

const sealer = { encrypt: async (t: string) => Buffer.from(`sealed:${Buffer.from(t).toString("base64")}`), decrypt: async (b: Buffer) => ({ text: Buffer.from(b.toString().slice(7), "base64").toString(), stale: false }) };
const FIXTURE = path.resolve(import.meta.dirname, "../../../scripts/mcp-fixture.mjs");

function setup() {
  const folder = mkdtempSync(path.join(tmpdir(), "clink-mcp-"));
  const vault = new AIVault(folder, sealer);
  const store = new McpStore(folder, vault);
  const hub = new McpHub(store, { openExternal: () => {} });
  return { folder, vault, store, hub };
}

const hubs: McpHub[] = [];
afterEach(async () => { await Promise.all(hubs.splice(0).map((h) => h.closeAll())); });

const ask = (hub: McpHub, action: string, body?: unknown) =>
  hub.answer(new Request(`http://app/api/desktop/mcp${action}`, body ? { method: "POST", body: JSON.stringify(body) } : {}))
    .then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> & { servers: { id: string; state: string; error?: string; tools: { name: string; on: boolean; as: string }[]; envNames: string[] }[] } }));

describe("MCP tool names", () => {
  it("are <server>__<tool>, safe for every provider and short enough for Claude Code's prefix", () => {
    expect(serverSlug("Strava MCP!")).toBe("strava_mcp");
    expect(serverSlug("???")).toBe("mcp");
    expect(uniqueSlug("Strava", ["strava", "strava_2"])).toBe("strava_3");
    expect(toolName("strava", "get_activity")).toBe("strava__get_activity");
    const odd = toolName("hevy", "workouts.list/all");
    expect(odd).toMatch(/^hevy__workouts_list_all_[0-9a-f]{6}$/);
    const long = toolName("a_long_server_nm", "x".repeat(90));
    expect(long.length).toBeLessThanOrEqual(MAX_NAME);
    expect(long).not.toBe(toolName("a_long_server_nm", `${"x".repeat(89)}y`));
    expect(`mcp__clink__${long}`.length).toBeLessThanOrEqual(64);
  });
});

describe("MCP results", () => {
  it("come back as text, without pictures, cut when very long", () => {
    expect(resultText({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "A dot." }] })).toBe("[an image (image/png) that can't be shown here]\n\nA dot.");
    expect(resultText({ structuredContent: { a: 1 } })).toBe('{"a":1}');
    const cut = resultText({ content: [{ type: "text", text: "x".repeat(MAX_RESULT + 500) }] });
    expect(cut.length).toBeLessThan(MAX_RESULT + 100);
    expect(cut).toMatch(/cut: 500 more characters/);
  });

  it("have object schemas without $schema", () => {
    expect(schemaOf({ inputSchema: { type: "object", $schema: "http://json-schema.org/draft-07/schema#" } as never })).toEqual({ type: "object", properties: {} });
  });
});

describe("MCP server settings", () => {
  it("keep env values, headers and tokens in the vault, never in mcp.json or the page's answers", async () => {
    const { folder, store, hub } = setup();
    hubs.push(hub);
    await store.add(checkInput({ name: "Local", transport: "stdio", command: "node", args: ["x.mjs"], env: { API_KEY: "env-secret-1" } }));
    const remote = await store.add(checkInput({ name: "Remote", transport: "http", url: "https://mcp.example.com/mcp", auth: "bearer", bearer: "bearer-secret-2", headers: { "X-Team": "header-secret-3" } }));
    await store.setOAuth(remote.id, { tokens: { access_token: "oauth-secret-4", token_type: "Bearer" } });
    const json = readFileSync(path.join(folder, "mcp.json"), "utf8");
    const sealed = readFileSync(path.join(folder, "ai-secrets.bin"), "utf8");
    const page = JSON.stringify((await ask(hub, "")).body);
    for (const secret of ["env-secret-1", "bearer-secret-2", "header-secret-3", "oauth-secret-4"]) {
      expect(json).not.toContain(secret);
      expect(sealed).not.toContain(secret);
      expect(page).not.toContain(secret);
    }
    expect(json).toContain("API_KEY");
    expect((await store.secrets(remote.id)).bearer).toBe("bearer-secret-2");
    await store.remove(remote.id);
    expect(await store.secrets(remote.id)).toEqual({});
  });

  it("refuse what can't work", () => {
    const bad = (input: unknown) => expect(() => checkInput(input)).toThrow(McpInputError);
    bad({ transport: "stdio", command: "x" });
    bad({ name: "A", transport: "stdio", command: " " });
    bad({ name: "A", transport: "http", url: "ftp://x" });
    bad({ name: "A", transport: "http", url: "https://u:p@x.com/mcp" });
    bad({ name: "A", transport: "http", url: "https://x.com/mcp", auth: "bearer" });
    bad({ name: "A", transport: "stdio", command: "x", env: { "BAD NAME": "1" } });
  });
});

describe("MCP servers for Coach", () => {
  it("connect over stdio, list tools off, and forward only the ones turned on", async () => {
    const { hub } = setup();
    hubs.push(hub);
    const added = await ask(hub, "/add", { name: "Fixture", transport: "stdio", command: process.execPath, args: [FIXTURE], env: { FIXTURE_WORD: "tempo" } });
    expect(added.status).toBe(200);
    const server = added.body.servers[0];
    expect(server.state).toBe("connected");
    expect(server.tools.map((t) => t.name)).toEqual(["pace_from_speed", "echo", "big", "picture", "fail"]);
    expect(server.tools.every((t) => !t.on)).toBe(true);
    expect(server.tools[0].as).toBe("fixture__pace_from_speed");

    // Nothing goes to Coach until a tool is turned on.
    expect(await hub.coachTools()).toBeNull();
    await ask(hub, "/tools", { id: server.id, tool: "pace_from_speed", on: true });
    await ask(hub, "/tools", { id: server.id, tool: "echo", on: true });
    const extra = await hub.coachTools();
    expect(extra?.defs.map((d) => d.name)).toEqual(["fixture__pace_from_speed", "fixture__echo"]);
    expect(extra?.defs[0].input_schema.required).toEqual(["kmh"]);
    expect(extra?.words?.fixture__echo).toBe("Asking Fixture");

    expect(await extra!.run("fixture__pace_from_speed", { kmh: 12 })).toEqual({ text: "5:00 min/km", source: { title: "Fixture", detail: "pace_from_speed", href: "/coach/settings?section=mcp" } });
    expect((await extra!.run("fixture__echo", { text: "hi" })).text).toBe("hi (tempo)");
    expect((await extra!.run("fixture__pace_from_speed", { kmh: 0 })).isError).toBe(true);
    expect((await extra!.run("fixture__big", {})).text).toMatch(/^Error: .*turned fixture__big off|^Error: there is no tool/);

    // Turned off after the answer began: refused, not run.
    await ask(hub, "/tools", { id: server.id, tool: "echo", on: false });
    expect((await extra!.run("fixture__echo", { text: "hi" })).text).toMatch(/turned fixture__echo off/);

    // All on, then the server off: no tools at all.
    await ask(hub, "/tools", { id: server.id, all: true });
    expect((await hub.coachTools())?.defs).toHaveLength(5);
    expect((await (await hub.coachTools())!.run("fixture__big", {})).text.length).toBeLessThan(MAX_RESULT + 100);
    const off = await ask(hub, "/enable", { id: server.id, enabled: false });
    expect(off.body.servers[0].state).toBe("off");
    expect(await hub.coachTools()).toBeNull();

    await ask(hub, "/remove", { id: server.id });
    expect((await ask(hub, "")).body.servers).toEqual([]);
  });

  it("reconnects when the program quits", async () => {
    const { hub } = setup();
    hubs.push(hub);
    const { body } = await ask(hub, "/add", { name: "Fixture", transport: "stdio", command: process.execPath, args: [FIXTURE] });
    const id = body.servers[0].id;
    await ask(hub, "/tools", { id, tool: "pace_from_speed", on: true });
    const extra = (await hub.coachTools())!;
    hub.stopNow();
    await new Promise((r) => setTimeout(r, 300));
    expect((await extra.run("fixture__pace_from_speed", { kmh: 10 })).text).toBe("6:00 min/km");
  });

  it("says why a server can't start", async () => {
    const { hub } = setup();
    hubs.push(hub);
    const { body } = await ask(hub, "/add", { name: "Missing", transport: "stdio", command: "clink-no-such-program-xyz" });
    expect(body.servers[0].state).toBe("error");
    expect(body.servers[0].error).toMatch(/clink-no-such-program-xyz|Couldn't find/);
  });

  it("answers the page's mistakes with words", async () => {
    const { hub } = setup();
    expect((await ask(hub, "/add", { name: "", transport: "stdio" })).status).toBe(400);
    expect((await ask(hub, "/remove", { id: "nope" })).status).toBe(404);
    expect((await ask(hub, "/nothing", {})).status).toBe(404);
  });
});
