import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CLOUDFLARED_VERSION, Connector, downloadCloudflared, findCloudflared, managedPath, parseVersion, tarMember, targetFor, tooOld, type Asset } from "./cloudflared";

// A stand-in for `cloudflared`: answers --version, logs what it was started with, and registers (or not) on its stderr.
const FAKE = `
import fs from "node:fs";
const log = (event, extra = {}) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ event, pid: process.pid, ...extra }) + "\\n");
if (process.argv[2] === "--version") { console.log("cloudflared version " + (process.env.FAKE_VERSION || "${CLOUDFLARED_VERSION}") + " (built 2026-10-27)"); process.exit(0); }
log("start", { argv: process.argv.slice(2), token: process.env.TUNNEL_TOKEN, home: process.env.HOME, envKeys: Object.keys(process.env) });
process.on("SIGTERM", () => { log("stop"); process.exit(0); });
const mode = process.env.FAKE_MODE || "register";
process.stderr.write("INF Starting tunnel tunnelID=00000000\\n");
if (mode === "register") setTimeout(() => process.stderr.write("\\u001b[32mINF Registered tunnel connection connIndex=0 location=yyz01\\u001b[0m\\nINF Registered tunnel connection connIndex=1\\n"), 20);
if (mode === "exit") setTimeout(() => { process.stderr.write("ERR Couldn't start tunnel token=" + process.env.TUNNEL_TOKEN + "\\n"); process.exit(1); }, 20);
if (mode === "reject") { let n = 0; const timer = setInterval(() => { process.stderr.write("ERR Register tunnel error=\\"Unauthorized: Invalid tunnel secret\\" connIndex=" + (n % 4) + "\\n"); if (++n >= 4) clearInterval(timer); }, 10); }
setInterval(() => {}, 60000);
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clink-cloudflared-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const script = path.join(root, "fake.mjs");
fs.writeFileSync(script, FAKE);
let count = 0;
const fresh = () => fs.mkdtempSync(path.join(root, `case${count++}-`));

/** A `cloudflared` wrapper around the fake, in a folder of its own. */
function fakeBinary(env: Record<string, string> = {}): { binary: string; log: string } {
  const folder = fresh();
  const log = path.join(folder, "log.jsonl");
  const binary = path.join(folder, "cloudflared");
  const exports = Object.entries({ FAKE_LOG: log, ...env }).map(([k, v]) => `export ${k}='${v}'`).join("\n");
  fs.writeFileSync(binary, `#!/bin/sh\n${exports}\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
  return { binary, log };
}
const events = (log: string) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);
async function until(check: () => boolean, what: string): Promise<void> {
  for (const deadline = Date.now() + 5_000; !check();) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const connectors: Connector[] = [];
afterEach(async () => { await Promise.all(connectors.splice(0).map((c) => c.stop())); });
const connector = (options: Partial<ConstructorParameters<typeof Connector>[0]> = {}) => {
  const made = new Connector({ dir: fresh(), env: { PATH: process.env.PATH, HOME: "/Users/athlete", TUNNEL_ORIGIN_CERT: "/Users/athlete/.cloudflared/cert.pem" }, restartDelayMs: () => 20, ...options });
  connectors.push(made);
  return made;
};

describe.skipIf(process.platform === "win32")("cloudflared", () => {
  it("knows which pinned build fits which computer", () => {
    expect(targetFor("darwin", "arm64")).toBe("darwin-arm64");
    expect(targetFor("darwin", "x64")).toBe("darwin-amd64");
    expect(targetFor("win32", "arm64")).toBe("windows-amd64");
    expect(targetFor("linux", "arm64")).toBeNull();
    expect(parseVersion("cloudflared version 2026.10.5 (built 2026-10-27-13:25 UTC)")).toBe("2026.10.5");
    expect(parseVersion("cloudflared DEV")).toBeNull();
    expect(tooOld("2026.10.2")).toBe(true);
    expect(tooOld("2026.10.3")).toBe(false);
    expect(tooOld(null)).toBe(false);
  });

  it("finds the athlete's own cloudflared first, and passes over one too old to trust", async () => {
    const own = fakeBinary();
    expect(await findCloudflared({ dir: fresh(), env: { COROSLINK_CLOUDFLARED_PATH: own.binary }, platform: "darwin", arch: "arm64" }))
      .toEqual({ path: own.binary, source: "env", version: CLOUDFLARED_VERSION });
    const old = fakeBinary({ FAKE_VERSION: "2025.1.0" });
    await expect(findCloudflared({ dir: fresh(), env: { COROSLINK_CLOUDFLARED_PATH: old.binary }, platform: "darwin", arch: "arm64" })).rejects.toThrow(/2025\.1\.0/);
    const onPath = fakeBinary();
    expect(await findCloudflared({ dir: fresh(), env: { PATH: [path.dirname(old.binary), path.dirname(onPath.binary)].join(path.delimiter) }, platform: "darwin", arch: "arm64" }))
      .toEqual({ path: onPath.binary, source: "path", version: CLOUDFLARED_VERSION });
    expect(await findCloudflared({ dir: fresh(), env: { PATH: "" }, platform: "darwin", arch: "arm64" })).toBeNull();
  });

  it("removes a downloaded build that isn't the pinned bytes", async () => {
    const dir = fresh();
    const managed = managedPath(dir, "darwin");
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, "tampered", { mode: 0o755 });
    expect(await findCloudflared({ dir, env: { PATH: "" }, platform: "darwin", arch: "arm64" })).toBeNull();
    expect(fs.existsSync(managed)).toBe(false);
  });

  it("downloads only the pinned bytes, out of the .tgz, executable", async () => {
    const binary = Buffer.from("#!/bin/sh\necho cloudflared\n");
    const header = Buffer.alloc(512);
    header.write("cloudflared", 0);
    header.write("0000755\0", 100);
    header.write(`${binary.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("0", 156);
    const tar = Buffer.concat([header, binary, Buffer.alloc(512 - binary.length), Buffer.alloc(1024)]);
    expect(tarMember(tar, "cloudflared")).toEqual(binary);
    const tgz = gzipSync(tar);
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const asset: Asset = { target: "darwin-arm64", url: "https://github.com/cloudflare/cloudflared/x.tgz", size: tgz.length, tgz: true, sha256: sha(tgz), binarySha256: sha(binary) };
    const dir = fresh();
    fs.mkdirSync(path.join(dir, "2026.1.1"));
    const progress: number[] = [];
    const fetchTgz = (async () => new Response(tgz)) as unknown as typeof fetch;
    const file = await downloadCloudflared({ dir, asset, platform: "darwin", fetch: fetchTgz, onProgress: (f) => progress.push(f) });
    expect(file).toBe(managedPath(dir, "darwin"));
    expect(fs.readFileSync(file)).toEqual(binary);
    expect(fs.statSync(file).mode & 0o111).not.toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([CLOUDFLARED_VERSION]);

    const other = fresh();
    await expect(downloadCloudflared({ dir: other, asset: { ...asset, sha256: "0".repeat(64) }, platform: "darwin", fetch: fetchTgz })).rejects.toThrow(/SHA-256/);
    expect(fs.existsSync(managedPath(other, "darwin"))).toBe(false);
  });

  it("runs with the token in its environment only, and nothing of the athlete's own cloudflared setup", async () => {
    const fake = fakeBinary();
    const made = connector();
    await made.run(fake.binary, "connector-secret");
    await until(() => made.snapshot().state === "online", "online");
    expect(made.snapshot()).toEqual({ state: "online", connections: 2 });
    const start = events(fake.log).find((e) => e.event === "start")!;
    const argv = start.argv as string[];
    expect(argv.slice(0, 3)).toEqual(["tunnel", "--no-autoupdate", "--config"]);
    expect(argv.at(-1)).toBe("run");
    expect(argv.join(" ")).not.toContain("connector-secret");
    expect(start.token).toBe("connector-secret");
    expect(start.home).not.toBe("/Users/athlete");
    expect(fs.readFileSync(argv[3], "utf8")).toBe("no-autoupdate: true\n");
    expect(start.envKeys).not.toContain("TUNNEL_ORIGIN_CERT");
    await made.stop();
    expect(made.snapshot().state).toBe("stopped");
    expect(events(fake.log).some((e) => e.event === "stop")).toBe(true);
  });

  it("restarts after an exit, asks for recovery, and keeps the token out of its message", async () => {
    const fake = fakeBinary({ FAKE_MODE: "exit" });
    const reasons: string[] = [];
    const made = connector({ onNeedsRecovery: (reason) => reasons.push(reason) });
    await made.run(fake.binary, "connector-secret");
    await until(() => events(fake.log).filter((e) => e.event === "start").length >= 2, "a restart");
    expect(reasons[0]).toBe("exit");
    expect(made.snapshot().message ?? "").not.toContain("connector-secret");
  });

  it("asks for recovery when the edge keeps refusing it", async () => {
    const reasons: string[] = [];
    const made = connector({ onNeedsRecovery: (reason) => reasons.push(reason) });
    await made.run(fakeBinary({ FAKE_MODE: "reject" }).binary, "t");
    await until(() => reasons.includes("rejected"), "a rejected recovery");
    expect(made.snapshot().state).toBe("starting");
  });

  it("stops a connector a crash left behind, and only ours", async () => {
    const dir = fresh();
    const fake = fakeBinary({ FAKE_MODE: "silent" });
    const config = path.join(dir, "home", "config.yml");
    // Ours, left running by a crashed C-LINK, and a stranger whose pid we pretend we wrote down.
    const leftover = spawn(fake.binary, ["tunnel", "--no-autoupdate", "--config", config, "run"], { stdio: "ignore" });
    const stranger = spawn(fake.binary, ["tunnel", "run"], { stdio: "ignore" });
    try {
      await until(() => events(fake.log).filter((e) => e.event === "start").length === 2, "both started");
      fs.writeFileSync(path.join(dir, "cloudflared.pid"), JSON.stringify({ pid: leftover.pid }));
      const made = connector({ dir });
      await made.run(fakeBinary().binary, "t");
      expect(leftover.exitCode ?? leftover.signalCode).not.toBeNull();
      await made.stop();

      fs.writeFileSync(path.join(dir, "cloudflared.pid"), JSON.stringify({ pid: stranger.pid }));
      const again = connector({ dir });
      await again.run(fakeBinary().binary, "t");
      expect(stranger.exitCode).toBeNull();
      expect(JSON.parse(fs.readFileSync(path.join(dir, "cloudflared.pid"), "utf8")).pid).not.toBe(stranger.pid);
    } finally {
      leftover.kill("SIGKILL");
      stranger.kill("SIGKILL");
    }
  });
});
