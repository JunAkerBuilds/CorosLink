import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiagnosticsLog, annotateDiagnosticRequest, expectedError, isExpectedError, redactDiagnosticText, withDiagnosticLogging } from "../dist-electron/diagnosticsLog.js";

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
  // Local-Only Mode: backup passphrases, the watch key, where the weather is for, and the watch's identifiers.
  for (const [input, secret] of [
    ["Restore failed: passphrase=correct horse battery", "correct horse"],
    ["{\"watchKey\":\"0011223344556677\"}", "0011223344556677"],
    ["Weather for latitude: 48.85661, longitude: 2.35222", "48.85661"],
    ["Weather for latitude: 48.85661, longitude: 2.35222", "2.35222"],
    ["{\"lat\":-33.8688,\"lon\":151.2093}", "151.2093"],
    ["watch serial_number=P4A1234567", "P4A1234567"],
    ["Peripheral AA:BB:CC:DD:EE:0F disconnected", "AA:BB:CC:DD:EE:0F"]
  ]) {
    assert.ok(!redactDiagnosticText(input).includes(secret), `redaction kept ${secret}`);
  }
  assert.equal(redactDiagnosticText("Synced at 10:41:48 on 2026-10-20"), "Synced at 10:41:48 on 2026-10-20");

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

  // Outcomes the user chose (a closed sign-in window) reach the caller but are not logged.
  const quiet = open(path.join(directory, "quiet", "errors.json"));
  const closed = expectedError(new Error("COROS connection window was closed."));
  assert.equal(isExpectedError(closed), true);
  assert.equal(isExpectedError(new Error("other")), false);
  await assert.rejects(withDiagnosticLogging(quiet, "chatMcp:connect", async () => { throw closed; })(), (caught) => caught === closed);
  quiet.record("chatMcp:connect", closed);
  assert.equal(quiet.snapshot().entryCount, 0);

  // A failure that comes back on every reload is one entry with a count, not a page of copies.
  for (let index = 0; index < 5; index++) {
    quiet.record("trainingHub:getDashboard", new Error("Log in to COROS Training Hub first."));
    quiet.record("trainingHub:getTrainingAnalytics", new Error("Log in to COROS Training Hub first."));
    now += 1000;
  }
  let entries = JSON.parse(fs.readFileSync(path.join(directory, "quiet", "errors.json"), "utf8"));
  assert.deepEqual(entries.map((entry) => [entry.source, entry.count]), [["trainingHub:getDashboard", 5], ["trainingHub:getTrainingAnalytics", 5]]);
  assert.ok(Date.parse(entries[0].lastSeen) > Date.parse(entries[0].timestamp));
  assert.equal(open(path.join(directory, "quiet", "errors.json")).snapshot().entryCount, 2, "counts survive restart");
  assert.match(quiet.snapshot().report, /"count": 5/);
  now += 11 * 60 * 1000;
  quiet.record("trainingHub:getDashboard", new Error("Log in to COROS Training Hub first."));
  quiet.record("trainingHub:getDashboard", new Error("A different failure"));
  entries = JSON.parse(fs.readFileSync(path.join(directory, "quiet", "errors.json"), "utf8"));
  assert.equal(entries.length, 4, "a repeat after the window, or a different message, is a new entry");
  assert.equal(entries.at(-2).count, undefined);
  // Watch identity notices: an info or warning entry, not an error; short tags kept, identifiers redacted even if one slips in.
  const notes = open(path.join(directory, "notes", "errors.json"));
  const { identityTag } = await import("../dist-electron/watchIdentity.js");
  const tag = identityTag("5A1E3C2B-0D4F-4E6A-9B7C-1D2E3F405162");
  assert.match(tag, /^id#[0-9a-f]{8}$/);
  assert.equal(identityTag("5a1e3c2b-0d4f-4e6a-9b7c-1d2e3f405162"), tag, "the same identity, however it's written");
  notes.note("corosBle:identity", `Remembered the watch's Bluetooth identity (system, ${tag}).`);
  notes.note("corosBle:identity", "Identity changed (system, 5A1E3C2B-0D4F-4E6A-9B7C-1D2E3F405162 to usb, AA:BB:CC:DD:EE:0F).", "warning");
  entries = JSON.parse(fs.readFileSync(path.join(directory, "notes", "errors.json"), "utf8"));
  assert.deepEqual(entries.map((entry) => [entry.level, entry.error.name]), [["info", "Info"], ["warning", "Warning"]]);
  assert.ok(entries[0].error.message.includes(tag), "the short tag is kept");
  for (const secret of ["5A1E3C2B-0D4F-4E6A-9B7C-1D2E3F405162", "AA:BB:CC:DD:EE:0F"]) {
    assert.ok(!JSON.stringify(entries).includes(secret) && !notes.snapshot().report.includes(secret), `identity notice leaked ${secret}`);
  }
  assert.match(open(path.join(directory, "notes", "errors.json")).snapshot().report, /"level": "warning"/, "levels survive restart");
  // Watch key backups: "exported" / "imported" and the four-digit key ID survive redaction; a wrong
  // passphrase is the user's to retry and isn't logged; a passphrase, path or key that slipped into
  // a message would be redacted.
  const keyNotes = open(path.join(directory, "watch-key", "errors.json"));
  keyNotes.note("watchKey:backup", "Watch key backup exported (key 7EDA).");
  keyNotes.note("watchKey:backup", "Watch key imported from a backup (key 7EDA).");
  const wrongPassphrase = withDiagnosticLogging(keyNotes, "watchfaces:restoreWatchKey", () => { throw expectedError(new Error("Wrong passphrase or damaged file.")); });
  await assert.rejects(wrongPassphrase({ passphrase: "typed-passphrase-private" }), /Wrong passphrase/);
  const leaky = withDiagnosticLogging(keyNotes, "watchfaces:backupWatchKey", () => {
    throw new Error(`passphrase: typed-passphrase-private while writing /Users/test-person/Desktop/coros-watch-key-7eda.coroswatchkey ${"MIIEowIBAAKCAQEA".repeat(4)}`);
  });
  await assert.rejects(leaky({ passphrase: "typed-passphrase-private" }));
  const keyReport = keyNotes.snapshot().report;
  assert.match(keyReport, /Watch key backup exported \(key 7EDA\)\./);
  assert.match(keyReport, /Watch key imported from a backup \(key 7EDA\)\./);
  assert.equal(keyNotes.snapshot().entryCount, 3, "two notices and the unexpected failure; the wrong passphrase isn't recorded");
  for (const secret of ["typed-passphrase-private", "test-person", "MIIEowIBAAKCAQEA"]) assert.ok(!keyReport.includes(secret), `watch key diagnostics leaked ${secret}`);
  console.log("Diagnostics passed: nested transport causes, original IPC failures, redaction on disk/export, restart, limits, expiry, clear, corrupt logs, storage failures, redacted watch identity notices, and watch key backup notices.");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
