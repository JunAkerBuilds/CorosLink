import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "claudeCodeProvider.js")
).href;

const {
  createClaudeSubscriptionEnvironment,
  getClaudeCodeStatus,
  getClaudeExecutableCandidates,
  normalizeClaudeCodeError,
  parseClaudeAuthStatusOutput
} = await import(`${providerUrl}?cacheBust=${Date.now()}`);

assert.deepEqual(
  parseClaudeAuthStatusOutput(
    JSON.stringify({
      loggedIn: true,
      authMethod: "claude.ai",
      subscriptionType: "pro"
    })
  ),
  {
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "pro"
  }
);
assert.equal(parseClaudeAuthStatusOutput("not-json"), undefined);
assert.equal(
  parseClaudeAuthStatusOutput('status:\n{"loggedIn":false}')?.loggedIn,
  false
);

const macCandidates = getClaudeExecutableCandidates(undefined, "darwin", {
  HOME: "/Users/tester"
});
assert.ok(macCandidates.includes("/Users/tester/.local/bin/claude"));
assert.ok(macCandidates.includes("/opt/homebrew/bin/claude"));

const windowsCandidates = getClaudeExecutableCandidates(undefined, "win32", {
  USERPROFILE: "C:\\Users\\tester",
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
});
assert.ok(
  windowsCandidates.some((candidate) =>
    candidate.endsWith(path.join("Programs", "Claude", "claude.exe"))
  )
);

const previousApiKey = process.env.ANTHROPIC_API_KEY;
const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
process.env.ANTHROPIC_API_KEY = "must-not-leak";
process.env.ANTHROPIC_BASE_URL = "https://example.invalid";
const subscriptionEnv = createClaudeSubscriptionEnvironment();
assert.equal(subscriptionEnv.ANTHROPIC_API_KEY, undefined);
assert.equal(subscriptionEnv.ANTHROPIC_BASE_URL, undefined);
assert.equal(subscriptionEnv.CLAUDE_AGENT_SDK_CLIENT_APP, "coroslink-coach");
if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
else process.env.ANTHROPIC_API_KEY = previousApiKey;
if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;

assert.equal(normalizeClaudeCodeError(new Error("rate limit 429")).kind, "usage-limit");
assert.equal(
  normalizeClaudeCodeError(new Error("Not logged in · Please run /login")).kind,
  "auth"
);
assert.equal(normalizeClaudeCodeError(new Error("spawn ENOENT")).kind, "not-installed");

const missing = await getClaudeCodeStatus(
  path.join(repoRoot, "scripts", "fixtures", "missing-claude")
);
assert.equal(missing.state, "not-installed");
assert.equal(missing.installed, false);
assert.equal(missing.authenticated, false);

console.log("claude code provider tests passed");
