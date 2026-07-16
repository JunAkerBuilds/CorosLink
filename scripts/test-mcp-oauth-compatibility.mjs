import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "electron", "mcpOAuthCompatibility.ts")
);
const { mcpOAuthClientName } = await import(`${modUrl.href}?c=${Date.now()}`);

assert.equal(
  mcpOAuthClientName("https://mcp.strava.com/mcp", "Strava"),
  "Claude Code (Strava via CorosLink)"
);
assert.equal(
  mcpOAuthClientName("https://MCP.STRAVA.COM/mcp", "My Strava"),
  "Claude Code (My Strava via CorosLink)"
);
assert.equal(
  mcpOAuthClientName("https://mcp.strava.com.evil.example/mcp", "Untrusted"),
  "CorosLink"
);
assert.equal(
  mcpOAuthClientName("https://freddy.coach/mcp", "Freddy"),
  "CorosLink"
);

console.log("mcp-oauth-compatibility tests passed");
