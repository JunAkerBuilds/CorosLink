import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiagnosticsLog, annotateDiagnosticRequest, redactDiagnosticText, withDiagnosticLogging } from "../dist-electron/diagnosticsLog.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-diagnostics-"));
const file = path.join(directory, "diagnostics", "errors.json");
const environment = { appVersion: "0.1.test", platform: "darwin", arch: "arm64", osVersion: "test-os", electronVersion: "42.test", nodeVersion: "24.test", chromeVersion: "test" };
let now = Date.parse("2026-09-16T12:00:00Z");
const open = (target = file) => new DiagnosticsLog(target, environment, ["/Users/test-person"], () => now);

try {
  const log = open();
  assert.equal(log.snapshot().entryCount, 0);
  assert.match(log.snapshot().report, /No errors recorded/);

  const connectionError = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT", hostname: "apieu.coros.com", syscall: "connect" });
  const failure = new TypeError("fetch failed", { cause: new AggregateError([connectionError], "Connection attempts failed") });
  annotateDiagnosticRequest(failure, "POST", "https://apieu.coros.com/coros/user/login?accessToken=private-query#private-fragment");
  const invoke = withDiagnosticLogging(log, "watchfaces:login", () => { throw failure; });
  await assert.rejects(invoke("private-input@example.com", "private-input-password"), (caught) => caught === failure);
  let report = log.snapshot().report;
  assert.match(report, /watchfaces:login/);
  assert.match(report, /ETIMEDOUT/);
  assert.match(report, /apieu.coros.com\/coros\/user\/login/);
  assert.doesNotMatch(report, /private-input|private-query|private-fragment/);
  assert.equal(open().snapshot().entryCount, 1, "logs survive restart");

  const secrets = ["quoted-password", "escaped-password", "single-quoted-secret", "basic-private", "cookie-private", "query-private", "fragment-private", "url-pass", "token-private", "key-private", "user-private", "hidden-person@example.com", "test-person", "win-person", "jwt-private"];
  const sensitive = [
    'password="quoted-password"',
    JSON.stringify({ password: 'escaped-password "and spaces"' }),
    "secret='single-quoted-secret'",
    "Authorization: Basic basic-private",
    "Cookie: session=cookie-private; other=more-private",
    "https://url-user:url-pass@api.coros.com/coros/user/login?query=query-private#fragment-private",
    "accessToken: token-private",
    "api_key=key-private",
    "client_secret=client-private",
    "appPassword=app-private",
    "password=several private words",
    JSON.stringify(JSON.stringify({ password: "double-encoded-private" })),
    "userId: user-private",
    "hidden-person@example.com",
    "/Users/test-person/Private Notes/file.txt",
    "C:\\Users\\win-person\\Private Notes\\file.txt",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqd3QtcHJpdmF0ZSJ9.jwt-private"
  ].join("\n");
  const privateError = new Error(sensitive, { cause: new Error("password: 'nested-password'") });
  privateError.headers = { Authorization: "uncollected-header" };
  privateError.body = "uncollected-body";
  privateError.stack += "\n    at login (/Users/test-person/private/app.js:42:3)";
  log.record("privacy-test", privateError);
  const disk = fs.readFileSync(file, "utf8");
  report = log.snapshot().report;
  for (const secret of [...secrets, "nested-password", "uncollected-header", "uncollected-body", "client-private", "app-private", "several private words", "double-encoded-private"]) {
    assert.ok(!disk.includes(secret), `disk leaked ${secret}`);
    assert.ok(!report.includes(secret), `report leaked ${secret}`);
  }
  assert.match(report, /\[redacted\]/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(redactDiagnosticText("ENOTFOUND apieu.coros.com"), "ENOTFOUND apieu.coros.com");

  const circular = new Error("cyclic");
  circular.cause = circular;
  log.record("circular", circular);
  assert.match(log.snapshot().report, /Additional causes omitted/);
  for (let index = 0; index < 205; index++) log.record("bounded", new Error(`failure ${index}`));
  assert.equal(log.snapshot().entryCount, 200);
  assert.ok(fs.statSync(file).size <= 512 * 1024);
  assert.doesNotMatch(log.snapshot().report, /privacy-test/);
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal(open().snapshot().entryCount, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [], "expired entries are removed from disk on restart");

  const restarted = open();
  restarted.record("clear-test", new Error("clear me"));
  assert.equal(restarted.clear().entryCount, 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(open().snapshot().entryCount, 0);
  fs.writeFileSync(file, "invalid JSON");
  const recovered = open();
  assert.equal(recovered.snapshot().entryCount, 0);
  recovered.record("recovered", new Error("usable again"));
  assert.equal(open().snapshot().entryCount, 1);

  const blockedPath = path.join(directory, "not-a-directory");
  fs.writeFileSync(blockedPath, "block mkdir");
  const memoryOnly = open(path.join(blockedPath, "errors.json"));
  const rejected = new Error("original failure");
  await assert.rejects(withDiagnosticLogging(memoryOnly, "failed-write", async () => { throw rejected; })(), (caught) => caught === rejected);
  assert.equal(memoryOnly.snapshot().entryCount, 1);
  assert.equal(memoryOnly.snapshot().persistent, false);
  assert.throws(() => memoryOnly.clear(), /ENOTDIR/);
  assert.equal(memoryOnly.snapshot().entryCount, 1, "failed clear retains in-memory logs");
  assert.equal(await withDiagnosticLogging(log, "success", async (value) => value + 1)(41), 42);
  console.log("Diagnostics passed: nested transport causes, original IPC failures, redaction on disk/export, restart, limits, expiry, clear, corrupt logs, and storage failures.");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
