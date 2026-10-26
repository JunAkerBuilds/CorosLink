/* eslint-disable @typescript-eslint/no-require-imports */
// The MCP SDK takes tens of milliseconds to load, which used to be paid while
// the app started. Callers load it here on first use instead: the client half
// when an MCP server connects, the server half when CorosLink serves tools.
// Import types from the SDK directly; take runtime values only from here.
type ClientIndex = typeof import("@modelcontextprotocol/sdk/client/index.js");
type ClientTransport = typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js");
type ClientAuth = typeof import("@modelcontextprotocol/sdk/client/auth.js");
type ServerMcp = typeof import("@modelcontextprotocol/sdk/server/mcp.js");
type ServerTransport = typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js");
type Types = typeof import("@modelcontextprotocol/sdk/types.js");

export interface McpClientSdk {
  Client: ClientIndex["Client"];
  StreamableHTTPClientTransport: ClientTransport["StreamableHTTPClientTransport"];
  UnauthorizedError: ClientAuth["UnauthorizedError"];
  ToolListChangedNotificationSchema: Types["ToolListChangedNotificationSchema"];
}

export interface McpServerSdk {
  McpServer: ServerMcp["McpServer"];
  StreamableHTTPServerTransport: ServerTransport["StreamableHTTPServerTransport"];
  isInitializeRequest: Types["isInitializeRequest"];
  CallToolRequestSchema: Types["CallToolRequestSchema"];
  ListToolsRequestSchema: Types["ListToolsRequestSchema"];
}

let clientSdk: McpClientSdk | undefined;
let serverSdk: McpServerSdk | undefined;

export function mcpClientSdk(): McpClientSdk {
  return (clientSdk ??= {
    Client: (require("@modelcontextprotocol/sdk/client/index.js") as ClientIndex).Client,
    StreamableHTTPClientTransport: (require("@modelcontextprotocol/sdk/client/streamableHttp.js") as ClientTransport)
      .StreamableHTTPClientTransport,
    UnauthorizedError: (require("@modelcontextprotocol/sdk/client/auth.js") as ClientAuth).UnauthorizedError,
    ToolListChangedNotificationSchema: (require("@modelcontextprotocol/sdk/types.js") as Types)
      .ToolListChangedNotificationSchema
  });
}

export function mcpServerSdk(): McpServerSdk {
  if (!serverSdk) {
    const types = require("@modelcontextprotocol/sdk/types.js") as Types;
    serverSdk = {
      McpServer: (require("@modelcontextprotocol/sdk/server/mcp.js") as ServerMcp).McpServer,
      StreamableHTTPServerTransport: (require("@modelcontextprotocol/sdk/server/streamableHttp.js") as ServerTransport)
        .StreamableHTTPServerTransport,
      isInitializeRequest: types.isInitializeRequest,
      CallToolRequestSchema: types.CallToolRequestSchema,
      ListToolsRequestSchema: types.ListToolsRequestSchema
    };
  }
  return serverSdk;
}
