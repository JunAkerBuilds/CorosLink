import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const providerUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "claudeCodeProvider.js")
).href;

const {
  compareClaudeCodeVersions,
  createClaudeSubscriptionEnvironment,
  getClaudeCodeStatus,
  getClaudeExecutableCandidates,
  normalizeClaudeCodeError,
  parseClaudeAuthStatusOutput,
  pickClaudeCodeInstall,
  streamClaudeCodeCompletion
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
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  APPDATA: "C:\\Users\\tester\\AppData\\Roaming"
});
assert.ok(
  windowsCandidates.some((candidate) =>
    candidate.endsWith(path.join("Programs", "Claude", "claude.exe"))
  )
);
assert.ok(
  windowsCandidates.some((candidate) =>
    candidate.endsWith(path.join("npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"))
  ),
  "the npm package's native binary is a candidate"
);

// ----- Choosing among several installs -----
assert.equal(compareClaudeCodeVersions("2.0.10 (Claude Code)", "2.0.9 (Claude Code)"), 1);
assert.equal(compareClaudeCodeVersions("2.1.0", "2.1.0 (Claude Code)"), 0);
assert.equal(compareClaudeCodeVersions(undefined, "0.0.1"), -1, "an unknown version sorts first");
assert.equal(
  pickClaudeCodeInstall([
    { path: "/opt/homebrew/bin/claude", version: "2.0.9 (Claude Code)" },
    { path: "/Users/tester/.local/bin/claude", version: "2.0.10 (Claude Code)" }
  ], "darwin"),
  "/Users/tester/.local/bin/claude",
  "the newest version wins, not the first found"
);
assert.equal(
  pickClaudeCodeInstall([
    { path: "/first/claude", version: "2.1.0" },
    { path: "/second/claude", version: "2.1.0" }
  ], "darwin"),
  "/first/claude",
  "equal versions keep the order they were found in"
);
assert.equal(
  pickClaudeCodeInstall([{ path: "/broken/claude" }, { path: "/working/claude", version: "1.0.0" }], "darwin"),
  "/working/claude",
  "an install that could not report its version loses"
);
assert.equal(
  pickClaudeCodeInstall([
    { path: "C:\\npm\\claude.cmd", version: "2.1.0" },
    { path: "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe", version: "2.1.0" }
  ], "win32"),
  "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
  "Windows prefers the .exe over a shim of the same version"
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

if (process.platform !== "win32") {
  // A stand-in CLI that logs where and how it was launched.
  const scratch = await mkdtemp(path.join(os.tmpdir(), "coroslink-claude-test-"));
  const fake = path.join(scratch, "claude");
  const log = path.join(scratch, "calls.log");
  const workspace = path.join(scratch, "claude-coach", "workspace");
  await writeFile(
    fake,
    [
      "#!/bin/sh",
      'echo "$(pwd -P)|$*" >> "$FAKE_CLAUDE_LOG"',
      'case "$1" in',
      '  --version) echo "2.1.7 (Claude Code)" ;;',
      `  auth) echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}' ;;`,
      "esac",
      ""
    ].join("\n")
  );
  await chmod(fake, 0o755);
  process.env.FAKE_CLAUDE_LOG = log;
  const calls = async () =>
    (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => {
      const [cwd, args] = line.split("|");
      return { cwd, args };
    });

  try {
    const first = await getClaudeCodeStatus(fake, workspace);
    assert.equal(first.state, "connected");
    assert.equal(first.version, "2.1.7 (Claude Code)");
    await getClaudeCodeStatus(fake, workspace);
    let launched = await calls();
    assert.equal(launched.filter((call) => call.args === "--version").length, 1, "the version is read once per install");
    assert.equal(launched.filter((call) => call.args === "auth status").length, 2, "sign-in is checked every time");
    const workspaceRealPath = await realpath(workspace);
    assert.ok(launched.every((call) => call.cwd === workspaceRealPath), "the CLI runs in Coach's own empty folder");

    // An update replaces the file, so its version is read again.
    const later = new Date(Date.now() + 60_000);
    await utimes(fake, later, later);
    await getClaudeCodeStatus(fake, workspace);
    launched = await calls();
    assert.equal(launched.filter((call) => call.args === "--version").length, 2);

    // Stop pressed before the turn reached the CLI: nothing is launched.
    const stopped = new AbortController();
    stopped.abort();
    const before = launched.length;
    await assert.rejects(
      streamClaudeCodeCompletion({
        executablePath: fake,
        workspaceDir: workspace,
        instructions: "Reply with OK.",
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        signal: stopped.signal,
        onToken: () => undefined,
        onToolCall: async () => ""
      }),
      (error) => error.kind === "cancelled"
    );
    assert.equal((await calls()).length, before, "a cancelled turn never starts Claude Code");
  } finally {
    delete process.env.FAKE_CLAUDE_LOG;
    await rm(scratch, { recursive: true, force: true });
  }
}

console.log("claude code provider tests passed");
