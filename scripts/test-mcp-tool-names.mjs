import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "mcpToolNames.ts"));
const { prefixToolName, splitToolName, isValidServerId } = await import(
  `${modUrl.href}?c=${Date.now()}`
);

assert.equal(prefixToolName("freddy", "get_sleep"), "freddy__get_sleep");
// Tool names may themselves contain "__" — split on the FIRST separator only.
assert.deepEqual(splitToolName("strava__list__activities"), {
  serverId: "strava",
  toolName: "list__activities"
});
assert.deepEqual(splitToolName("coros__query"), {
  serverId: "coros",
  toolName: "query"
});
assert.equal(splitToolName("noseparator"), undefined);

assert.equal(isValidServerId("freddy"), true);
assert.equal(isValidServerId("Freddy"), false); // uppercase rejected
assert.equal(isValidServerId(""), false);
assert.equal(isValidServerId("a".repeat(40)), false); // too long

console.log("mcp-tool-names tests passed");
