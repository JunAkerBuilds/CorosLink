// A stand-in for `cloudflared tunnel --no-autoupdate run`, for
// scripts/test-cloudflared-manager.mjs and scripts/test-relay-client.mjs.
// The tests wrap it in a small shell script named `cloudflared`.
//
// FAKE_CLOUDFLARED_LOG   file that gets one JSON line per event
// FAKE_CLOUDFLARED_NAME  which wrapper this is (old, new, …)
// FAKE_CLOUDFLARED_MODE  register (default) | exit | reject | silent
// FAKE_CLOUDFLARED_DELAY_MS  wait before registering (default 20)
import crypto from "node:crypto";
import fs from "node:fs";

const log = (event, extra = {}) => {
  if (!process.env.FAKE_CLOUDFLARED_LOG) return;
  fs.appendFileSync(
    process.env.FAKE_CLOUDFLARED_LOG,
    `${JSON.stringify({ event, name: process.env.FAKE_CLOUDFLARED_NAME ?? "fake", pid: process.pid, at: Date.now(), ...extra })}\n`
  );
};

const token = process.env.TUNNEL_TOKEN ?? "";
log("start", {
  argv: process.argv.slice(2),
  tokenSha256: token ? crypto.createHash("sha256").update(token).digest("hex") : null
});

process.on("SIGTERM", () => {
  log("stop");
  process.stderr.write("INF Initiating graceful shutdown due to signal terminated ...\n");
  process.exit(0);
});

const mode = process.env.FAKE_CLOUDFLARED_MODE ?? "register";
const delay = Number(process.env.FAKE_CLOUDFLARED_DELAY_MS ?? 20);
process.stderr.write("2026-10-16T12:00:00Z INF Starting tunnel tunnelID=00000000-0000-0000-0000-000000000000\n");

if (mode === "exit") {
  setTimeout(() => {
    process.stderr.write(`2026-10-16T12:00:00Z ERR Couldn't start tunnel error="boom" token=${token}\n`);
    log("exit");
    process.exit(1);
  }, delay);
} else if (mode === "reject") {
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    process.stderr.write(
      `2026-10-16T12:00:0${count}Z ERR Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=${count % 4}\n`
    );
    if (count >= 6) clearInterval(timer);
  }, delay);
} else if (mode === "register") {
  setTimeout(() => {
    log("registered");
    // cloudflared colours its output on a terminal; the manager strips it.
    process.stderr.write(
      "\u001b[32m2026-10-16T12:00:01Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.13 location=yyz01 protocol=quic\u001b[0m\n"
    );
  }, delay);
}

// Stay up until stopped.
setInterval(() => undefined, 60_000);
