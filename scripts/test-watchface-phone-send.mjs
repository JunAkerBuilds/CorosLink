import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) => pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;
const {
  encodePhoneFaceLink, phoneSendAddresses, startWatchfacePhoneSend, stopWatchfacePhoneSend, PHONE_FACE_MAX_BYTES
} = await import(`${distUrl("watchfacePhoneSend.js")}?cacheBust=${Date.now()}`);

const nic = (address, internal = false) => ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

// Private addresses only, Wi-Fi first, virtual adapters dropped, at most four.
assert.deepEqual(phoneSendAddresses({
  lo0: [nic("127.0.0.1", true)],
  en5: [nic("10.0.0.7")],
  en0: [nic("192.168.1.20"), { ...nic("fe80::1"), family: "IPv6" }],
  utun3: [nic("10.8.0.2")],
  bridge100: [nic("192.168.2.1")],
  "vEthernet (WSL)": [nic("172.28.80.1")],
  docker0: [nic("172.17.0.1")],
  en7: [nic("8.8.8.8")],
  en8: [nic("169.254.10.10")]
}), ["192.168.1.20", "10.0.0.7"]);
assert.deepEqual(phoneSendAddresses({ "Wi-Fi": [nic("172.20.10.3")], Ethernet: [nic("10.1.2.3")] }), ["172.20.10.3", "10.1.2.3"]);

// The link C-LINK parses (CorosKitTests/FaceTransferTests.swift holds this exact string).
const vector = encodePhoneFaceLink({
  hosts: ["192.168.1.20", "10.0.0.7"],
  port: 52814,
  token: Buffer.alloc(16, 0xab).toString("base64url"),
  sha256: createHash("sha256").update("C-LINK face").digest(),
  size: 123456,
  name: "Morning Run & Co + 晨跑\u0007",
  model: "apex-4"
});
assert.equal(vector,
  "coroslink://face/1?a=192.168.1.20%2C10.0.0.7&p=52814&k=q6urq6urq6urq6urq6urqw" +
  "&h=" + createHash("sha256").update("C-LINK face").digest("base64url") +
  "&s=123456&n=Morning%20Run%20%26%20Co%20%2B%20%E6%99%A8%E8%B7%91&w=apex-4");
console.log(`vector: ${vector}`);

const get = (url, method = "GET") => new Promise((resolve, reject) => {
  const request = http.request(url, { method }, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
  });
  request.on("error", reject);
  request.end();
});

// Serving: only the token path, only GET/HEAD; downloads are reported.
const data = Buffer.from("PK\u0003\u0004 not really a face, just bytes ".repeat(2000));
const statuses = [];
const send = await startWatchfacePhoneSend({ data, name: "  Track\nDay  ", model: "pace-pro" },
  status => statuses.push(status), { hosts: ["192.168.1.20"] });
assert.equal(send.name, "TrackDay");
assert.equal(send.size, data.length);
assert.match(send.qrDataUrl, /^data:image\/png;base64,/);
const link = new URL(send.link.replace("coroslink://face/1", "http://face.invalid/"));
const port = Number(link.searchParams.get("p"));
const token = link.searchParams.get("k");
assert.equal(link.searchParams.get("a"), "192.168.1.20");
assert.equal(token.length, 22);
assert.equal(link.searchParams.get("h"), createHash("sha256").update(data).digest("base64url"));
assert.equal(link.searchParams.get("s"), String(data.length));
assert.equal(link.searchParams.get("w"), "pace-pro");

const base = `http://127.0.0.1:${port}`;
const ok = await get(`${base}/face/${token}`);
assert.equal(ok.status, 200);
assert.equal(ok.headers["content-type"], "application/zip");
assert.equal(ok.headers["cache-control"], "no-store");
assert.ok(ok.body.equals(data), "served bytes must match");
assert.equal((await get(`${base}/face/${token}`, "HEAD")).status, 200);
assert.equal((await get(`${base}/face/${token}`, "POST")).status, 404);
assert.equal((await get(`${base}/face/${"A".repeat(22)}`)).status, 404);
assert.equal((await get(`${base}/face/${token}?x=1`)).status, 404);
assert.equal((await get(`${base}/`)).status, 404);
await new Promise(resolve => setTimeout(resolve, 20));
assert.ok(statuses.some(status => status.sending), "a download in progress is reported");
assert.equal(statuses.at(-1).received, 1, "one finished download (HEAD doesn't count)");
assert.equal(statuses.at(-1).expiresAt, send.expiresAt);

stopWatchfacePhoneSend();
assert.equal(statuses.at(-1).active, false);
await assert.rejects(get(`${base}/face/${token}`), /ECONNREFUSED|ECONNRESET/);

// Codes expire on their own.
const expiring = [];
await startWatchfacePhoneSend({ data, name: "Short" }, status => expiring.push(status), { hosts: ["10.0.0.7"], ttlMs: 50 });
await new Promise(resolve => setTimeout(resolve, 120));
assert.equal(expiring.at(-1)?.active, false, "the server stops at expiry");

await assert.rejects(startWatchfacePhoneSend({ data, name: "x" }, undefined, { hosts: [] }), /local network/);
await assert.rejects(startWatchfacePhoneSend({ data: Buffer.alloc(0), name: "x" }, undefined, { hosts: ["10.0.0.7"] }), /Build the watch face/);
await assert.rejects(startWatchfacePhoneSend({ data: Buffer.alloc(PHONE_FACE_MAX_BYTES + 1), name: "x" }, undefined, { hosts: ["10.0.0.7"] }), /64 MB/);

console.log("watchface phone send tests passed");
