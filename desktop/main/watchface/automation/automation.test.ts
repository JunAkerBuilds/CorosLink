import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStore, sniffImage } from "./assets";
import { EditorBroker, EditorError } from "./broker";
import { admitted, answerRpc, startMcpServer } from "./server";
import { automationTools, schemaSection } from "./tools";
import { cropAsset, cropImage } from "./images";
import { decodePng, encodePng } from "../../../watchface/compiler/png";
import { codexConfig, StudioAutomation } from "./index";

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const temp = () => mkdtempSync(path.join(tmpdir(), "clink-automation-"));

/** A page on the other end of the broker: reads its stream and answers with `answer`. */
async function page(broker: EditorBroker, answer: (method: string, params: Record<string, unknown>) => unknown) {
  const abort = new AbortController();
  const response = broker.open(abort.signal);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const seen: string[] = [];
  void (async () => {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += value;
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        if (!line) continue;
        const r = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        seen.push(r.method);
        try { broker.reply({ id: r.id, result: await answer(r.method, r.params) }); } catch (e) { broker.reply({ id: r.id, error: { code: (e as EditorError).code ?? "X", message: (e as Error).message } }); }
      }
    }
  })();
  return { seen, close: () => abort.abort() };
}

describe("editor broker", () => {
  it("hands requests to the page in order and gives back its answers", async () => {
    const broker = new EditorBroker();
    const order: string[] = [];
    await page(broker, async (method) => { order.push(method); await new Promise((r) => setTimeout(r, method === "slow" ? 30 : 0)); return { method }; });
    const [a, b] = await Promise.all([broker.request("slow"), broker.request("fast")]);
    expect(a).toEqual({ method: "slow" });
    expect(b).toEqual({ method: "fast" });
    expect(order).toEqual(["slow", "fast"]);
  });

  it("passes the page's refusal on as an EditorError", async () => {
    const broker = new EditorBroker();
    await page(broker, () => { throw new EditorError("REVISION_CONFLICT", "stale"); });
    await expect(broker.request("apply_commands")).rejects.toMatchObject({ code: "REVISION_CONFLICT", message: "stale" });
  });

  it("waits for a page, and gives up when none comes", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 30 });
    await expect(broker.request("get_document")).rejects.toMatchObject({ code: "EDITOR_UNAVAILABLE" });
    const late = new EditorBroker({ readyTimeoutMs: 1000 });
    const asked = late.request("get_document");
    await page(late, () => "ok");
    await expect(asked).resolves.toBe("ok");
  });

  it("fails what's pending when the page goes away", async () => {
    const broker = new EditorBroker();
    const p = await page(broker, () => new Promise(() => undefined));
    const asked = broker.request("save");
    await new Promise((r) => setTimeout(r, 10));
    p.close();
    await expect(asked).rejects.toMatchObject({ code: "EDITOR_DISCONNECTED" });
    expect(broker.connected).toBe(false);
  });

  it("times a slow answer out for the caller", async () => {
    const broker = new EditorBroker({ requestTimeoutMs: 20 });
    await page(broker, () => new Promise(() => undefined));
    await expect(broker.request("render_preview")).rejects.toMatchObject({ code: "EDITOR_TIMEOUT" });
  });

  it("stops waiting when the caller stops", async () => {
    const broker = new EditorBroker({ readyTimeoutMs: 5000 });
    const abort = new AbortController();
    const asked = broker.request("get_document", {}, abort.signal);
    abort.abort();
    await expect(asked).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("asset store", () => {
  it("keeps images by content and swaps data URLs for ids and back", async () => {
    const store = new AssetStore(temp());
    const id = await store.put(PNG);
    expect(id).toMatch(/^img_[0-9a-f]{32}$/);
    expect(await store.put(PNG)).toBe(id);
    const doc = { design: { artwork: PNG_URL, sprites: [{ dataUrl: PNG_URL, x: 1 }], text: "data:text/plain;base64,AA==" } };
    const refs = await store.toRefs(doc);
    expect(refs).toEqual({ design: { artwork: { assetId: id }, sprites: [{ dataUrl: { assetId: id }, x: 1 }], text: "data:text/plain;base64,AA==" } });
    expect(await store.fromRefs(refs)).toEqual(doc);
  });

  it("takes only PNG, JPEG and WebP, and refuses unknown ids", async () => {
    const store = new AssetStore(temp());
    await expect(store.put(Buffer.from("<svg/>"))).rejects.toThrow(/Only PNG/);
    await expect(store.get("img_00000000000000000000000000000000")).rejects.toThrow(/no asset/);
    await expect(store.get("../etc/passwd")).rejects.toThrow(/isn't an asset id/);
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  });

  it("drops the oldest past its limit", async () => {
    const store = new AssetStore(temp(), { count: 1, bytes: 1e9, perAsset: 1e6 });
    const first = await store.put(PNG);
    await new Promise((r) => setTimeout(r, 15));
    const second = await store.put(Buffer.concat([PNG, Buffer.from([0])]));
    await expect(store.get(second)).resolves.toBeTruthy();
    await expect(store.get(first)).rejects.toThrow();
  });
});

describe("MCP server", () => {
  const tools = () => automationTools({ broker: new EditorBroker({ readyTimeoutMs: 10 }), assets: new AssetStore(temp()), projects: async () => [{ id: "a", name: "Face" }] });

  it("admits only the token, its own loopback host and no foreign origin", () => {
    const ok = { authorization: "Bearer secret", host: "127.0.0.1:4000" };
    expect(admitted(ok, "secret", 4000)).toBe(0);
    expect(admitted({ ...ok, authorization: "Bearer wrong!" }, "secret", 4000)).toBe(401);
    expect(admitted({ host: ok.host }, "secret", 4000)).toBe(401);
    expect(admitted({ ...ok, host: "evil.example:4000" }, "secret", 4000)).toBe(403);
    expect(admitted({ ...ok, host: "127.0.0.1:4001" }, "secret", 4000)).toBe(403);
    expect(admitted({ ...ok, origin: "https://evil.example" }, "secret", 4000)).toBe(403);
    expect(admitted({ ...ok, origin: "http://127.0.0.1:4000" }, "secret", 4000)).toBe(0);
  });

  it("lists its tools and answers a call, refusals as tool errors", async () => {
    const list = await answerRpc(tools(), { jsonrpc: "2.0", id: 1, method: "tools/list" }) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_document", "apply_commands", "render_preview", "check_contrast", "validate", "import_asset", "open"]));
    const projects = await answerRpc(tools(), { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_projects", arguments: {} } }) as { content: { text: string }[] };
    expect(JSON.parse(projects.content[0].text)).toEqual({ projects: [{ id: "a", name: "Face" }] });
    const noEditor = await answerRpc(tools(), { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_document", arguments: {} } }) as { isError: boolean; content: { text: string }[] };
    expect(noEditor.isError).toBe(true);
    expect(JSON.parse(noEditor.content[0].text).error.code).toBe("EDITOR_UNAVAILABLE");
    const init = await answerRpc(tools(), { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as { instructions: string };
    expect(init.instructions).toMatch(/smallest resolution/);
  });

  it("imports a local image by absolute path only", async () => {
    const dir = temp(), file = path.join(dir, "art.png");
    await writeFile(file, PNG);
    const run = (args: Record<string, unknown>) => tools().find((t) => t.name === "import_asset")!.run(args);
    await expect(run({ path: file })).resolves.toMatchObject({ json: { assetId: expect.stringMatching(/^img_/), width: 1, height: 1 } });
    await expect(run({ path: "art.png" })).rejects.toThrow(/absolute/);
    await writeFile(path.join(dir, "x.txt"), "hello");
    await expect(run({ path: path.join(dir, "x.txt") })).rejects.toThrow(/Only PNG/);
  });

  it("serves over HTTP on loopback with the token", async () => {
    const server = await startMcpServer(tools(), () => "tok", 0);
    const url = `http://127.0.0.1:${server.port}/mcp`;
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await fetch(url, { method: "POST", body })).status).toBe(401);
    const ok = await fetch(url, { method: "POST", body, headers: { Authorization: "Bearer tok", "Content-Type": "application/json" } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(10);
    expect((await fetch(url, { headers: { Authorization: "Bearer tok" } })).status).toBe(405);
    await server.close();
  });

  it("reads the schema by section", () => {
    expect(Object.keys(schemaSection("simulation") as object)).toEqual(["simulation"]);
    expect(() => schemaSection("nope")).toThrow(/section/);
  });
});

describe("automation settings", () => {
  const sealer = { encrypt: async (t: string) => Buffer.from(`sealed:${t}`), decrypt: async (b: Buffer) => ({ text: b.toString().replace(/^sealed:/, ""), stale: false }) };
  const request = (method: string, route = "", body?: unknown) => new Request(`clink://app/api/desktop/studio/automation${route}`, {
    method, headers: { "x-clink-hub": "1", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });

  it("turns the server on with a fresh token, copies the Codex config, and revokes on off", async () => {
    let copied = "";
    const folder = temp();
    const automation = new StudioAutomation(folder, { sealer, projects: async () => [], copy: (t) => { copied = t; } });
    expect(await (await automation.answer(request("GET")))!.json()).toMatchObject({ enabled: false, url: null });
    const on = await (await automation.answer(request("POST", "", { enabled: true })))!.json() as { url: string; tokenHint: string };
    expect(on.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    await automation.answer(request("POST", "/copy"));
    const token = /Bearer ([\w-]+)/.exec(copied)![1];
    expect(token.endsWith(on.tokenHint)).toBe(true);
    expect(copied).toBe(codexConfig(on.url, token));
    // The status never carries the token itself.
    expect(JSON.stringify(on)).not.toContain(token);
    // A restart keeps it working with the same token.
    await automation.stop();
    const again = new StudioAutomation(folder, { sealer, projects: async () => [], copy: () => undefined });
    await again.start();
    const list = await fetch(again.url!, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), headers: { Authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    await again.answer(request("POST", "", { enabled: false }));
    expect(again.url).toBeNull();
    const third = new StudioAutomation(folder, { sealer, projects: async () => [], copy: () => undefined });
    expect(await third.status()).toMatchObject({ enabled: false, tokenHint: null });
  });

  it("refuses changes that don't come from the app's pages", async () => {
    const automation = new StudioAutomation(temp(), { sealer, projects: async () => [], copy: () => undefined });
    const res = await automation.answer(new Request("clink://app/api/desktop/studio/automation", { method: "POST", body: JSON.stringify({ enabled: true }) }));
    expect(res!.status).toBe(403);
  });
});

describe("crop_image", () => {
  // 10×6, transparent, with an opaque red 4×2 block at (3, 2).
  const art = () => {
    const data = new Uint8Array(10 * 6 * 4);
    for (let y = 2; y < 4; y++) for (let x = 3; x < 7; x++) data.set([255, 0, 0, 255], (y * 10 + x) * 4);
    return { width: 10, height: 6, data };
  };

  it("trims transparent margins, crops a region and scales it", () => {
    expect(cropImage(art(), {}).region).toEqual({ x: 3, y: 2, width: 4, height: 2 });
    const { image } = cropImage(art(), { crop: { x: 2, y: 1, width: 6, height: 4 }, trim: false, width: 3 });
    expect([image.width, image.height]).toEqual([3, 2]);
    // Half covered by the block: half as opaque, and still pure red (the transparent half doesn't darken it).
    expect([...image.data.subarray(4, 8)]).toEqual([255, 0, 0, 128]);
    expect(() => cropImage(art(), { crop: { x: 8, y: 0, width: 5, height: 2 } })).toThrow(/leaves/);
    expect(() => cropImage(art(), { crop: { x: 0, y: 0, width: 2, height: 2 } })).toThrow(/Nothing visible/);
  });

  it("works on stored PNGs and stores the result", async () => {
    const store = new AssetStore(temp());
    const id = await store.put(encodePng(art()));
    const out = await cropAsset(store, id, { height: 4 });
    expect(out).toMatchObject({ width: 8, height: 4, region: { x: 3, y: 2, width: 4, height: 2 } });
    const back = decodePng((await store.get(out.assetId)).bytes);
    expect([back.width, back.height]).toEqual([8, 4]);
  });
});
