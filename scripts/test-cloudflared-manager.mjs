import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// electron/remote/cloud/cloudflaredManager.ts: the pinned release, the
// verified download, finding an installed cloudflared, and the supervisor,
// driven with scripts/fixtures/fake-cloudflared.mjs in place of the real one.
// Run with `npm run test:cloudflared-manager` (after build:electron).
const repoRoot = path.resolve(import.meta.dirname, "..");
const requireDist = createRequire(path.join(repoRoot, "dist-electron", "main.js"));
const {
  CLOUDFLARED_ASSETS,
  CLOUDFLARED_MIN_VERSION,
  CLOUDFLARED_VERSION,
  CloudflaredSupervisor,
  cloudflaredTarget,
  downloadCloudflared,
  extractTarMember,
  findCloudflared,
  isVulnerableCloudflared,
  parseCloudflaredVersion,
  isIntelMac,
  managedCloudflaredPath,
  probeEdgePorts
} = requireDist("./remote/cloud/cloudflaredManager.js");

const fixture = path.join(repoRoot, "scripts", "fixtures", "fake-cloudflared.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-cloudflared-test-"));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await wait(10);
  }
}

/** A `cloudflared` shell wrapper around the fake, with its own mode and name. */
function fakeBinary(name, env = {}) {
  const directory = path.join(root, "bin", name);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "cloudflared");
  const exports = Object.entries({ FAKE_CLOUDFLARED_NAME: name, ...env })
    .map(([key, value]) => `export ${key}='${value}'`)
    .join("\n");
  fs.writeFileSync(
    file,
    `#!/bin/sh\n${exports}\nexport ELECTRON_RUN_AS_NODE=1\nexec '${process.execPath}' '${fixture}' "$@"\n`,
    { mode: 0o755 }
  );
  return file;
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const supervisors = [];
try {
  // ----- The pinned release -----
  {
    assert.match(CLOUDFLARED_VERSION, /^\d{4}\.\d{1,2}\.\d+$/);
    for (const target of ["darwin-arm64", "darwin-amd64", "windows-amd64", "linux-amd64"]) {
      const asset = CLOUDFLARED_ASSETS[target];
      assert.equal(asset.target, target);
      assert.ok(asset.url.startsWith(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/`), asset.url);
      assert.match(asset.sha256, /^[0-9a-f]{64}$/);
      assert.match(asset.binarySha256, /^[0-9a-f]{64}$/);
      assert.ok(asset.size > 1_000_000);
      // macOS ships a .tgz, so the archive and the binary hash differ; the others are the binary.
      if (target.startsWith("darwin")) {
        assert.equal(asset.archive, "tgz");
        assert.notEqual(asset.sha256, asset.binarySha256);
      } else {
        assert.equal(asset.archive, null);
        assert.equal(asset.sha256, asset.binarySha256);
      }
    }
    assert.equal(cloudflaredTarget("darwin", "arm64"), "darwin-arm64");
    assert.equal(cloudflaredTarget("darwin", "x64"), "darwin-amd64");
    assert.equal(cloudflaredTarget("win32", "x64"), "windows-amd64");
    assert.equal(cloudflaredTarget("win32", "arm64"), "windows-amd64");
    assert.equal(cloudflaredTarget("linux", "x64"), "linux-amd64");
    assert.equal(cloudflaredTarget("linux", "arm64"), null);
    assert.equal(isIntelMac("darwin", "x64"), true);
    assert.equal(isIntelMac("darwin", "arm64"), false);
  }

  // ----- The verified download -----
  {
    const binary = Buffer.from("#!/bin/sh\necho fake cloudflared\n");
    const tarDirectory = path.join(root, "tar");
    fs.mkdirSync(tarDirectory, { recursive: true });
    fs.writeFileSync(path.join(tarDirectory, "cloudflared"), binary, { mode: 0o755 });
    fs.writeFileSync(path.join(tarDirectory, "README"), "not this one");
    execFileSync("tar", ["-czf", path.join(root, "cloudflared.tgz"), "-C", tarDirectory, "README", "cloudflared"]);
    const tgz = fs.readFileSync(path.join(root, "cloudflared.tgz"));
    const { gunzipSync } = await import("node:zlib");
    assert.deepEqual(extractTarMember(gunzipSync(tgz), "cloudflared"), binary);
    assert.throws(() => extractTarMember(gunzipSync(tgz), "missing"), /doesn't contain/);

    const files = { "/raw": binary, "/archive.tgz": tgz, "/big": Buffer.alloc(3 * 1024 * 1024, 1) };
    const { server, origin } = await serve((request, response) => {
      const body = files[request.url];
      if (!body) return response.writeHead(404).end();
      response.writeHead(200, { "Content-Length": body.length }).end(body);
    });
    try {
      const userDataDir = path.join(root, "userData");
      const destination = managedCloudflaredPath(userDataDir, "9999.1.0", "linux");
      const download = (asset, version = "9999.1.0") =>
        downloadCloudflared({ asset, version, userDataDir, platform: "linux" });
      const leftovers = () =>
        fs.existsSync(path.dirname(destination)) ? fs.readdirSync(path.dirname(destination)).filter((name) => name.endsWith(".tmp")) : [];

      // A mismatched checksum is refused, and nothing lands at the final path.
      await assert.rejects(
        download({ target: "linux-amd64", url: `${origin}/raw`, size: binary.length, sha256: "0".repeat(64), archive: null, binarySha256: "0".repeat(64) }),
        /failed SHA-256 verification/
      );
      assert.equal(fs.existsSync(destination), false, "refused download isn't installed");
      assert.deepEqual(leftovers(), []);

      // The archive matches but the binary inside doesn't: refused too.
      await assert.rejects(
        download({ target: "darwin-arm64", url: `${origin}/archive.tgz`, size: tgz.length, sha256: sha256(tgz), archive: "tgz", binarySha256: "f".repeat(64) }),
        /failed SHA-256 verification/
      );
      assert.equal(fs.existsSync(destination), false);

      // Larger than pinned: refused before hashing.
      await assert.rejects(
        download({ target: "linux-amd64", url: `${origin}/big`, size: 1024, sha256: "0".repeat(64), archive: null, binarySha256: "0".repeat(64) }),
        /larger than expected/
      );

      // The right bytes: installed atomically and executable.
      const progress = [];
      const installed = await downloadCloudflared({
        asset: { target: "linux-amd64", url: `${origin}/raw`, size: binary.length, sha256: sha256(binary), archive: null, binarySha256: sha256(binary) },
        version: "9999.1.0",
        userDataDir,
        platform: "linux",
        onProgress: (received, total) => progress.push([received, total])
      });
      assert.equal(installed, destination);
      assert.deepEqual(fs.readFileSync(destination), binary);
      assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
      assert.deepEqual(leftovers(), []);
      assert.deepEqual(progress.at(-1), [binary.length, binary.length]);

      // The macOS .tgz: the binary is extracted and checked against its own hash.
      const fromArchive = await downloadCloudflared({
        asset: { target: "darwin-arm64", url: `${origin}/archive.tgz`, size: tgz.length, sha256: sha256(tgz), archive: "tgz", binarySha256: sha256(binary) },
        version: "9999.2.0",
        userDataDir,
        platform: "darwin"
      });
      assert.deepEqual(fs.readFileSync(fromArchive), binary);
      assert.equal(fs.statSync(fromArchive).mode & 0o777, 0o755);
    } finally {
      server.close();
    }
  }

  // ----- Finding an installed one -----
  {
    const userDataDir = path.join(root, "find");
    const emptyPath = path.join(root, "empty-path");
    fs.mkdirSync(emptyPath, { recursive: true });
    const find = (env = {}) => findCloudflared({ env: { PATH: emptyPath, ...env }, userDataDir, platform: "darwin", arch: "arm64" });

    assert.equal(await find(), null, "nothing installed: ask before downloading");

    const own = fakeBinary("own");
    assert.deepEqual(await find({ COROSLINK_CLOUDFLARED_PATH: own }), { path: own, source: "env", version: "2026.10.5" });
    await assert.rejects(find({ COROSLINK_CLOUDFLARED_PATH: path.join(root, "nope") }), /COROSLINK_CLOUDFLARED_PATH/);
    assert.deepEqual(await find({ PATH: [emptyPath, path.dirname(own)].join(path.delimiter) }), {
      path: own,
      source: "path",
      version: "2026.10.5"
    });
    const silent = fakeBinary("no-version", { FAKE_CLOUDFLARED_VERSION: "none" });
    assert.deepEqual(await find({ PATH: path.dirname(silent) }), { path: silent, source: "path", version: null });

    // A build that trusts the compromised eMudhra intermediates is never run.
    assert.equal(isVulnerableCloudflared("2026.10.2"), true);
    assert.equal(isVulnerableCloudflared(CLOUDFLARED_MIN_VERSION), false);
    assert.equal(isVulnerableCloudflared(null), false);
    assert.equal(parseCloudflaredVersion("cloudflared version 2026.10.5 (built 2026-10-27-13:25 UTC)"), "2026.10.5");
    const vulnerable = fakeBinary("vulnerable", { FAKE_CLOUDFLARED_VERSION: "2026.10.1" });
    await assert.rejects(find({ COROSLINK_CLOUDFLARED_PATH: vulnerable }), /2026\.10\.1.*compromised certificates/);
    assert.equal(await find({ PATH: path.dirname(vulnerable) }), null, "an old one on PATH: ask to download the pin");
    assert.deepEqual(await find({ PATH: [path.dirname(vulnerable), path.dirname(own)].join(path.delimiter) }), {
      path: own,
      source: "path",
      version: "2026.10.5"
    });

    // A downloaded build that doesn't hash to the pin is removed, not run.
    const managed = managedCloudflaredPath(userDataDir, CLOUDFLARED_VERSION, "darwin");
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, "tampered", { mode: 0o755 });
    assert.equal(await find(), null);
    assert.equal(fs.existsSync(managed), false);

    // An older download below the minimum isn't run while the pin downloads...
    const unsafe = managedCloudflaredPath(userDataDir, "2026.10.1", "darwin");
    fs.mkdirSync(path.dirname(unsafe), { recursive: true });
    fs.writeFileSync(unsafe, "unsafe", { mode: 0o755 });
    assert.equal(await find(), null);

    // ...but a safe older one keeps running until the pinned one is in.
    const older = managedCloudflaredPath(userDataDir, CLOUDFLARED_MIN_VERSION, "darwin");
    fs.mkdirSync(path.dirname(older), { recursive: true });
    fs.writeFileSync(older, "older", { mode: 0o755 });
    assert.deepEqual(await find(), { path: older, source: "managed", version: CLOUDFLARED_MIN_VERSION, stale: true });
  }

  // ----- Running it -----
  const logFile = path.join(root, "events.jsonl");
  const token = `eyJ${crypto.randomBytes(48).toString("base64url")}`;
  const tokenHash = sha256(token);
  const supervise = (options = {}) => {
    const changes = [];
    const recoveries = [];
    const swaps = [];
    const supervisor = new CloudflaredSupervisor({
      env: { ...process.env, FAKE_CLOUDFLARED_LOG: logFile },
      restartDelayMs: () => 50,
      onChange: (snapshot) => changes.push(snapshot),
      onNeedsRecovery: (reason) => recoveries.push(reason),
      onSwapped: (spec) => swaps.push(spec),
      ...options
    });
    supervisors.push(supervisor);
    return { supervisor, changes, recoveries, swaps };
  };

  // Registered → online, with the token in the environment and never in argv.
  {
    fs.rmSync(logFile, { force: true });
    const binary = fakeBinary("online");
    const { supervisor } = supervise();
    supervisor.run({ binary, token, version: "1" });
    assert.equal(supervisor.snapshot().state, "starting");
    await waitFor(() => supervisor.snapshot().state === "online", "online");
    assert.equal(supervisor.snapshot().connections, 1);
    const [start] = readLog(logFile).filter((entry) => entry.event === "start");
    assert.deepEqual(start.argv, ["tunnel", "--no-autoupdate", "run"]);
    assert.equal(start.tokenSha256, tokenHash, "TUNNEL_TOKEN reached cloudflared");
    assert.ok(!JSON.stringify(start.argv).includes(token), "the token is not in argv");
    // The same spec again is a no-op.
    supervisor.run({ binary, token, version: "1" });
    await wait(80);
    assert.equal(readLog(logFile).filter((entry) => entry.event === "start").length, 1);
    await supervisor.stop();
    assert.equal(supervisor.snapshot().state, "stopped");
    await waitFor(() => readLog(logFile).some((entry) => entry.event === "stop"), "stop");
  }

  // Exit → recovery requested and a restart, with the token redacted from the message.
  {
    fs.rmSync(logFile, { force: true });
    const binary = fakeBinary("crashing", { FAKE_CLOUDFLARED_MODE: "exit" });
    const { supervisor, recoveries, changes } = supervise();
    supervisor.run({ binary, token, version: "1" });
    await waitFor(() => readLog(logFile).filter((entry) => entry.event === "start").length >= 3, "two restarts");
    assert.ok(recoveries.length >= 2 && recoveries.every((reason) => reason === "exit"), JSON.stringify(recoveries));
    const messages = changes.map((snapshot) => snapshot.message ?? "").join("\n");
    assert.match(messages, /cloudflared stopped \(1\)/);
    assert.ok(!messages.includes(token), "the token is redacted from cloudflared's output");
    assert.match(messages, /\[token\]/);
    await supervisor.stop();
    const starts = readLog(logFile).filter((entry) => entry.event === "start").length;
    await wait(150);
    assert.equal(readLog(logFile).filter((entry) => entry.event === "start").length, starts, "no restart after stop");
  }

  // Repeated rejections → recovery requested once per three.
  {
    fs.rmSync(logFile, { force: true });
    const binary = fakeBinary("rejected", { FAKE_CLOUDFLARED_MODE: "reject", FAKE_CLOUDFLARED_DELAY_MS: "10" });
    const { supervisor, recoveries } = supervise();
    supervisor.run({ binary, token, version: "1" });
    await waitFor(() => recoveries.length >= 2, "two rejection recoveries");
    assert.deepEqual(recoveries.slice(0, 2), ["rejected", "rejected"]);
    assert.notEqual(supervisor.snapshot().state, "online");
    await supervisor.stop();
  }

  // Dials that time out (a network blocking port 7844) are reported, each one, and leave it starting.
  {
    fs.rmSync(logFile, { force: true });
    const binary = fakeBinary("blocked", {
      FAKE_CLOUDFLARED_MODE: "unreachable",
      FAKE_CLOUDFLARED_FAILURES: "3",
      FAKE_CLOUDFLARED_DELAY_MS: "10",
      FAKE_CLOUDFLARED_THEN: "register"
    });
    let unreachable = 0;
    const { supervisor, recoveries } = supervise({ onEdgeUnreachable: () => (unreachable += 1) });
    supervisor.run({ binary, token, version: "1" });
    await waitFor(() => unreachable === 3, "three unreachable dials");
    assert.equal(supervisor.snapshot().state, "starting");
    assert.equal(supervisor.snapshot().message, undefined, "a timed-out dial isn't a rejection");
    await waitFor(() => supervisor.snapshot().state === "online", "online once out");
    assert.equal(unreachable, 3);
    assert.deepEqual(recoveries, [], "no recovery: the tunnel is fine");
    await supervisor.stop();

    // A rejection is not an unreachable edge.
    const rejected = fakeBinary("rejected-reach", { FAKE_CLOUDFLARED_MODE: "reject", FAKE_CLOUDFLARED_DELAY_MS: "10" });
    const second = supervise({ onEdgeUnreachable: () => (unreachable += 1) });
    second.supervisor.run({ binary: rejected, token, version: "1" });
    await waitFor(() => second.recoveries.length >= 1, "a rejection recovery");
    assert.equal(unreachable, 3);
    await second.supervisor.stop();
  }

  // The port check: the relay answers and the edge port doesn't = blocked.
  {
    const listening = http.createServer();
    await new Promise((resolve) => listening.listen(0, "127.0.0.1", resolve));
    const open = listening.address().port;
    const closedServer = http.createServer();
    await new Promise((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
    const closed = closedServer.address().port;
    await new Promise((resolve) => closedServer.close(resolve));
    try {
      const relay = { host: "127.0.0.1", port: open };
      assert.deepEqual(
        await probeEdgePorts({ relay, edgeHosts: ["127.0.0.1"], edgePort: closed, timeoutMs: 1_000 }),
        { tunnelPort: false, relay: true }
      );
      assert.deepEqual(
        await probeEdgePorts({ relay, edgeHosts: ["127.0.0.1", "127.0.0.1"], edgePort: open, timeoutMs: 1_000 }),
        { tunnelPort: true, relay: true }
      );
      assert.deepEqual(
        await probeEdgePorts({ relay: { host: "127.0.0.1", port: closed }, edgeHosts: ["127.0.0.1"], edgePort: closed, timeoutMs: 1_000 }),
        { tunnelPort: false, relay: false }
      );
    } finally {
      listening.closeAllConnections?.();
      await new Promise((resolve) => listening.close(resolve));
    }
  }

  // Version swap: the new connector starts, and the old one stops only after the new one registers.
  {
    fs.rmSync(logFile, { force: true });
    const oldBinary = fakeBinary("old");
    const newBinary = fakeBinary("new", { FAKE_CLOUDFLARED_DELAY_MS: "400" });
    const { supervisor, swaps } = supervise();
    supervisor.run({ binary: oldBinary, token, version: "2026.9.0" });
    await waitFor(() => supervisor.snapshot().state === "online", "old online");
    supervisor.run({ binary: newBinary, token, version: "2026.10.1" });
    assert.equal(supervisor.snapshot().swapping, true);
    await wait(200);
    // Still mid-swap: the old connector is up and carrying the tunnel.
    assert.equal(supervisor.snapshot().state, "online");
    assert.equal(supervisor.snapshot().version, "2026.9.0");
    assert.ok(!readLog(logFile).some((entry) => entry.name === "old" && entry.event === "stop"), "old still running");
    await waitFor(() => readLog(logFile).some((entry) => entry.name === "old" && entry.event === "stop"), "old stopped");
    const events = readLog(logFile).map((entry) => `${entry.name}:${entry.event}`);
    const at = (name) => events.indexOf(name);
    assert.ok(at("old:start") < at("new:start"), events.join(" "));
    assert.ok(at("new:start") < at("new:registered"), events.join(" "));
    assert.ok(at("new:registered") < at("old:stop"), events.join(" "));
    assert.equal(supervisor.snapshot().version, "2026.10.1");
    assert.equal(supervisor.snapshot().swapping, false);
    assert.deepEqual(swaps.map((spec) => spec.version), ["2026.10.1"]);

    // A replacement that dies before registering leaves the running one alone.
    const broken = fakeBinary("broken", { FAKE_CLOUDFLARED_MODE: "exit" });
    supervisor.run({ binary: broken, token, version: "2026.11.0" });
    await waitFor(() => readLog(logFile).some((entry) => entry.name === "broken" && entry.event === "exit"), "broken exit");
    await waitFor(() => !supervisor.snapshot().swapping, "swap abandoned");
    assert.equal(supervisor.snapshot().state, "online");
    assert.equal(supervisor.snapshot().version, "2026.10.1");
    assert.ok(!readLog(logFile).some((entry) => entry.name === "new" && entry.event === "stop"));
    await supervisor.stop();
    await waitFor(() => readLog(logFile).some((entry) => entry.name === "new" && entry.event === "stop"), "new stopped");
  }

  console.log("cloudflared manager: ok");
} finally {
  await Promise.all(supervisors.map((supervisor) => supervisor.stop()));
  fs.rmSync(root, { recursive: true, force: true });
}
