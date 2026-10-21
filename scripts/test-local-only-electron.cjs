// Local-Only Mode inside a real Electron runtime: uploads to COROS from the
// renderer, a late-created session (as webviews and OAuth windows use) and
// net.fetch are cancelled before they leave, while other traffic keeps
// flowing. Nothing here reaches COROS: refused requests never leave, and the
// allowed ones go to a loopback server. Run with:
//   npm run build:electron && electron scripts/test-local-only-electron.cjs
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, net, session } = require("electron");

const PROFILE_PREFIX = "coroslink-privacy-electron-";
// Profiles an earlier run couldn't remove (Chromium writes to its profile while it quits).
for (const name of fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(PROFILE_PREFIX))) {
  const stale = path.join(os.tmpdir(), name);
  try {
    if (Date.now() - fs.statSync(stale).mtimeMs > 3_600_000) fs.rmSync(stale, { recursive: true, force: true });
  } catch { /* another run's, or already gone */ }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
app.setPath("userData", profile);
// Removes the profile once this process has exited and Chromium has stopped writing to it.
spawn(process.execPath, ["-e", `
  const fs = require("node:fs");
  const timer = setInterval(() => {
    try { process.kill(${process.pid}, 0); return; } catch {}
    clearInterval(timer);
    try { fs.rmSync(${JSON.stringify(profile)}, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }, 100);
  setTimeout(() => process.exit(0), 120000).unref();
`], { detached: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
// Every COROS and S3 name resolves to this computer, so even a request the gate wrongly let through couldn't leave it.
app.commandLine.appendSwitch("host-resolver-rules", "MAP *.coros.com 127.0.0.1, MAP *.amazonaws.com 127.0.0.1");

const dist = (file) => path.join(__dirname, "..", "dist-electron", file);
const { NetworkPolicy } = require(dist("privacy/networkPolicy.js"));
const { installNodeNetworkGuards } = require(dist("privacy/networkGuards.js"));
const { installElectronNetworkGuards } = require(dist("privacy/electronNetworkGuards.js"));

const policy = new NetworkPolicy({ enforcing: true });
installNodeNetworkGuards(policy);
installElectronNetworkGuards(policy);

// The verdict alone decides the exit code. The temp profile is removed after exit (above), so a
// cleanup error can neither hide a failure nor turn a pass into a hang.
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) console.error(error);
  else console.log("local-only electron: COROS uploads are cancelled in every session, redirects included; other traffic flows");
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
setTimeout(() => finish(new Error("local-only electron: timed out")), 60_000).unref();

app.whenReady().then(async () => {
  const received = [];
  const server = http.createServer((request, response) => {
    received.push(`${request.method} ${request.url}`);
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url === "/redirect-to-coros") {
      // A 307 keeps the method and body: an upload if it were followed.
      response.writeHead(307, { Location: `http://teamapi.coros.com:${server.address().port}/activity/fit/import` });
      response.end();
      return;
    }
    response.end("loopback ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${server.address().port}/`;

  const late = session.fromPartition("persist:privacy-late");
  const window = new BrowserWindow({ show: false, webPreferences: { session: late, contextIsolation: true } });
  await window.loadURL("data:text/html,<html><body></body></html>");
  const result = await window.webContents.executeJavaScript(`(async () => {
    const attempt = async (url, init) => { try { await fetch(url, init); return "sent"; } catch { return "blocked"; } };
    return {
      planUpload: await attempt("https://teamapi.coros.com/training/plan/add?token=SECRET", { method: "POST", body: "{}" }),
      // A simple request (no custom headers), so no CORS preflight goes out either.
      mcpWrite: await attempt("https://mcpus.coros.com/mcp", { method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "createTrainingPlan" } }) }),
      local: await (await fetch(${JSON.stringify(local)}, { method: "POST", body: "data" })).text()
    };
  })()`);
  assert.deepEqual(result, { planUpload: "blocked", mcpWrite: "blocked", local: "loopback ok" });

  await assert.rejects(net.fetch("https://coros-s3.s3.us-west-2.amazonaws.com/fit/1.zip", { method: "PUT", body: "zip" }));
  assert.equal(await (await net.fetch(local, { method: "PUT", body: "zip" })).text(), "loopback ok");

  // Chromium asks the gate again for each redirect hop: a 307 can't carry the body to a COROS upload.
  await assert.rejects(net.fetch(`${local}redirect-to-coros`, { method: "POST", body: "activity" }));
  // A malformed escape in an S3 path is not a COROS bucket: answered (not hung) and let through, here to the loopback server.
  const port = server.address().port;
  assert.equal(await (await net.fetch(`http://tiles.s3.amazonaws.com:${port}/%zz`)).text(), "loopback ok");
  assert.equal(await (await net.fetch(`http://tiles.s3.amazonaws.com:${port}/%E0%A4%A/k`)).text(), "loopback ok");

  // Reads are classified as allowed (not performed here, to stay off the real COROS servers).
  assert.equal(policy.allowRequest({ url: "https://teamapi.coros.com/activity/query", method: "POST" }, "electron").allowed, true);

  const attempts = policy.recentAttempts();
  const seen = (destination) => attempts.some((attempt) => attempt.channel === "electron" && attempt.destination === destination);
  assert.ok(seen("POST teamapi.coros.com/training/plan/add"), JSON.stringify(attempts));
  assert.ok(seen("POST mcpus.coros.com/mcp createTrainingPlan"), JSON.stringify(attempts));
  assert.ok(seen("PUT coros-s3.s3.us-west-2.amazonaws.com/fit/1.zip"), JSON.stringify(attempts));
  assert.equal(JSON.stringify(attempts).includes("SECRET"), false, "queries are never recorded");
  assert.ok(seen("POST teamapi.coros.com/activity/fit/import"), JSON.stringify(attempts));
  assert.deepEqual(received, ["POST /", "PUT /", "POST /redirect-to-coros", "GET /%zz", "GET /%E0%A4%A/k"], "the redirected upload never arrived");

  window.destroy();
  server.close();
}).then(() => finish(), finish);
