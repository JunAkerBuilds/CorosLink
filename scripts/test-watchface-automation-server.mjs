import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WatchfaceAutomationServer } from "../dist-electron/watchfaceAutomationServer.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "coroslink-watchface-mcp-"));
const importedImagePath = path.join(temporaryRoot, "pixel.png");
await fs.promises.writeFile(importedImagePath, PNG);

const calls = [];
const dispatch = async (method, params) => {
  calls.push({ method, params });
  if (method === "get_schema") return { schemaVersion: 1, commandKinds: ["set"] };
  if (method === "get_document") {
    return {
      sessionId: "editor-session",
      revision: 4,
      scope: "editor",
      design: { version: 1, designSprites: [{ id: "sprite-1", dataUrl: DATA_URL }] },
      layers: [], capabilities: {}
    };
  }
  if (method === "render_preview") {
    return { sessionId: "editor-session", revision: 4, mode: "current", width: 1, height: 1, mimeType: "image/png", dataUrl: DATA_URL };
  }
  if (method === "apply_commands") {
    return { ok: true, hydrated: params.commands?.[0]?.value?.dataUrl === DATA_URL };
  }
  return { ok: true, method, params };
};

const automation = new WatchfaceAutomationServer({ dispatch, userDataPath: temporaryRoot });
try {
  const status = await automation.start({ port: 0 });
  assert.equal(status.enabled, true);
  assert.match(status.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.match(status.token, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(status.url);

  let response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 401, "unauthenticated requests must be rejected");
  response = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 401, "wrong bearer tokens must be rejected");
  response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${status.token}`, origin: "https://example.com", "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 403, "foreign browser origins must be rejected");
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: status.port,
      path: "/mcp",
      method: "POST",
      headers: {
        Host: "attacker.example",
        Authorization: `Bearer ${status.token}`,
        "Content-Type": "application/json",
        "Content-Length": 2
      }
    }, (incoming) => {
      incoming.resume();
      incoming.on("end", () => resolve(incoming.statusCode));
    });
    request.on("error", reject);
    request.end("{}");
  });
  assert.equal(invalidHostStatus, 403, "DNS-rebinding Host headers must be rejected");
  response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${status.token}`, "mcp-session-id": "missing", "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 404, "unknown sessions must be rejected");

  const connect = async (name) => {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${status.token}` } }
    });
    const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
  };
  const first = await connect("watchface-test-one");
  const second = await connect("watchface-test-two");
  assert.ok(first.transport.sessionId);
  assert.ok(second.transport.sessionId);
  assert.notEqual(first.transport.sessionId, second.transport.sessionId);

  const tools = await first.client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "get_context"));
  assert.ok(tools.tools.some((tool) => tool.name === "get_document"));
  assert.ok(tools.tools.some((tool) => tool.name === "apply_commands"));
  assert.ok(tools.tools.some((tool) => tool.name === "import_asset"));
  assert.ok(tools.tools.some((tool) => tool.name === "publish"));
  assert.ok(tools.tools.some((tool) => tool.name === "close"));

  const context = await first.client.callTool({ name: "get_context", arguments: {} });
  assert.equal(context.isError, undefined);
  assert.equal(calls.at(-1)?.method, "get_context");

  const callsBeforeInvalidClose = calls.length;
  const invalidClose = await first.client.callTool({
    name: "close",
    arguments: { sessionId: "editor-session", discardChanges: true }
  });
  assert.equal(invalidClose.isError, true, "close must require a base revision");
  assert.equal(calls.length, callsBeforeInvalidClose, "an invalid close must not reach dispatch");

  const inspected = await first.client.callTool({ name: "get_document", arguments: {} });
  const inspectedJson = JSON.parse(inspected.content.find((part) => part.type === "text").text);
  const documentAsset = inspectedJson.design.designSprites[0].dataUrl;
  assert.match(documentAsset.assetId, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(inspectedJson).includes("data:image"), false);

  const preview = await first.client.callTool({
    name: "render_preview",
    arguments: { sessionId: "editor-session", mode: "current" }
  });
  assert.ok(preview.content.some((part) => part.type === "image" && part.mimeType === "image/png"));

  const imported = await first.client.callTool({
    name: "import_asset",
    arguments: { path: importedImagePath, kind: "image" }
  });
  const importedJson = JSON.parse(imported.content.find((part) => part.type === "text").text);
  assert.equal(importedJson.assetId, documentAsset.assetId, "identical image content should reuse an asset id");
  assert.equal(importedJson.width, 1);
  assert.equal(importedJson.height, 1);
  const fontFolderPath = path.join(temporaryRoot, "digits");
  await fs.promises.mkdir(fontFolderPath);
  await fs.promises.writeFile(path.join(fontFolderPath, "00.png"), PNG);
  const fontImport = await first.client.callTool({ name: "import_asset", arguments: { path: fontFolderPath, kind: "raster_font_folder" } });
  const fontJson = JSON.parse(fontImport.content.find(part => part.type === "text").text);
  assert.equal(fontJson.sprites[0].name, "00.png", "preserve PNG extension for the editor font classifier");
  assert.equal(fontJson.sprites[0].dataUrl.assetId, importedJson.assetId);
  const applied = await first.client.callTool({
    name: "apply_commands",
    arguments: {
      sessionId: "editor-session",
      baseRevision: 4,
      commands: [{ op: "set", path: "/design/artwork", value: { dataUrl: { assetId: importedJson.assetId } } }]
    }
  });
  const appliedJson = JSON.parse(applied.content.find((part) => part.type === "text").text);
  assert.equal(appliedJson.hydrated, true, "asset refs must hydrate before renderer dispatch");

  const callsBeforeUnsafeInput = calls.length;
  const unsafeArguments = JSON.parse(
    '{"sessionId":"editor-session","baseRevision":4,"commands":[{"op":"set","path":"/design/backgroundColor","value":{"__proto__":{"polluted":true}}}]}'
  );
  const unsafeResult = await first.client.callTool({
    name: "apply_commands",
    arguments: unsafeArguments
  });
  assert.equal(unsafeResult.isError, true, "unsafe nested object keys must be rejected");
  assert.equal(calls.length, callsBeforeUnsafeInput, "unsafe input must not reach the editor dispatch");
  assert.equal({}.polluted, undefined, "unsafe input must not mutate object prototypes");

  const tokenPath = path.join(temporaryRoot, "watchface-automation", "bearer-token");
  const tokenMode = (await fs.promises.stat(tokenPath)).mode & 0o777;
  assert.equal(tokenMode, 0o600);

  await first.client.close();
  await second.client.close();
  await automation.stop();
  assert.equal(automation.getStatus().enabled, false);
  const restarted = await automation.start({ port: 0 });
  assert.equal(restarted.token, status.token, "bearer token should persist across ordinary restarts");
  await automation.stop({ revokeToken: true });
  await assert.rejects(fs.promises.stat(tokenPath), /ENOENT/);
  console.log("Watch-face automation MCP server test passed");
} finally {
  await automation.stop().catch(() => undefined);
  await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
}
