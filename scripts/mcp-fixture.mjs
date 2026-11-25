#!/usr/bin/env node
// A tiny MCP server over stdio, for trying Coach's MCP servers and for the tests (desktop/main/ai/mcp.test.ts).
// Add it in Coach settings → Tools → Add server → Command: node <this repo>/scripts/mcp-fixture.mjs
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const TOOLS = [
  {
    name: "pace_from_speed", description: "Running pace in min/km for a speed in km/h.",
    inputSchema: { type: "object", properties: { kmh: { type: "number", description: "Speed in km/h." } }, required: ["kmh"] },
  },
  { name: "echo", description: "Says back what it is sent, with the fixture's secret word when FIXTURE_WORD is set.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "big", description: "A very long answer.", inputSchema: { type: "object", properties: {} } },
  { name: "picture", description: "An image and a line of text.", inputSchema: { type: "object", properties: {} } },
  { name: "fail", description: "Always fails.", inputSchema: { type: "object", properties: {} } },
];

const server = new Server({ name: "clink-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  switch (request.params.name) {
    case "pace_from_speed": {
      const kmh = Number(args.kmh);
      if (!(kmh > 0)) return { content: [{ type: "text", text: "kmh must be above 0." }], isError: true };
      const total = 3600 / kmh, min = Math.floor(total / 60), sec = Math.round(total % 60);
      return { content: [{ type: "text", text: `${min}:${String(sec).padStart(2, "0")} min/km` }] };
    }
    case "echo":
      return { content: [{ type: "text", text: `${String(args.text ?? "")}${process.env.FIXTURE_WORD ? ` (${process.env.FIXTURE_WORD})` : ""}` }] };
    case "big":
      return { content: [{ type: "text", text: "x".repeat(50_000) }] };
    case "picture":
      return { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }, { type: "text", text: "A dot." }] };
    case "fail":
      return { content: [{ type: "text", text: "Nope." }], isError: true };
    default:
      return { content: [{ type: "text", text: `No tool ${request.params.name}.` }], isError: true };
  }
});
await server.connect(new StdioServerTransport());
