// Send to iPhone, CorosLink's scripts/test-watchface-phone-send.mjs carried over, with the "Must not regress" item
// (replacement-checklist §5): iPhone handoff ≤64 MB, 10 min, private IPv4 only, token + SHA-256.
import { createHash } from "node:crypto";
import http from "node:http";
import type os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { encodePhoneFaceLink, PHONE_FACE_MAX_BYTES, PHONE_FACE_SEND_TTL_MS, phoneSendAddresses, PhoneSend, type PhoneFaceSendStatus } from "./phoneSend";

const nic = (address: string, internal = false): os.NetworkInterfaceInfo =>
  ({ address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

const get = (url: string, method = "GET") => new Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
  const request = http.request(url, { method }, (response) => {
    const chunks: Buffer[] = [];
    response.on("data", (c: Buffer) => chunks.push(c));
    response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
  });
  request.on("error", reject);
  request.end();
});

const sends: PhoneSend[] = [];
const sender = (options: ConstructorParameters<typeof PhoneSend>[0]) => { const s = new PhoneSend(options); sends.push(s); return s; };
afterEach(() => { for (const s of sends.splice(0)) s.stop(); });

describe("Send to iPhone", () => {
  it("offers only private addresses, Wi-Fi first, no virtual adapters, at most four", () => {
    expect(phoneSendAddresses({
      lo0: [nic("127.0.0.1", true)],
      en5: [nic("10.0.0.7")],
      en0: [nic("192.168.1.20"), { ...nic("fe80::1"), family: "IPv6", scopeid: 0 }],
      utun3: [nic("10.8.0.2")],
      bridge100: [nic("192.168.2.1")],
      "vEthernet (WSL)": [nic("172.28.80.1")],
      docker0: [nic("172.17.0.1")],
      en7: [nic("8.8.8.8")],
      en8: [nic("169.254.10.10")],
    })).toEqual(["192.168.1.20", "10.0.0.7"]);
    expect(phoneSendAddresses({ "Wi-Fi": [nic("172.20.10.3")], Ethernet: [nic("10.1.2.3")] })).toEqual(["172.20.10.3", "10.1.2.3"]);
    expect(phoneSendAddresses({ en1: [nic("10.0.0.1")], en2: [nic("10.0.0.2")], en3: [nic("10.0.0.3")], en4: [nic("10.0.0.4")], en5: [nic("10.0.0.5")] })).toHaveLength(4);
  });

  it("writes the link the iPhone app parses (its FaceTransferTests.swift holds this exact string)", () => {
    const hash = createHash("sha256").update("C-LINK face").digest();
    expect(encodePhoneFaceLink({
      hosts: ["192.168.1.20", "10.0.0.7"], port: 52814, token: Buffer.alloc(16, 0xab).toString("base64url"), sha256: hash, size: 123456,
      name: "Morning Run & Co + 晨跑\u0007", model: "apex-4",
    })).toBe("coroslink://face/1?a=192.168.1.20%2C10.0.0.7&p=52814&k=q6urq6urq6urq6urq6urqw"
      + `&h=${hash.toString("base64url")}&s=123456&n=Morning%20Run%20%26%20Co%20%2B%20%E6%99%A8%E8%B7%91&w=apex-4`);
  });

  it("serves the face only on its token path, only to GET and HEAD, and reports downloads", async () => {
    const data = Buffer.from("PK\u0003\u0004 not really a face, just bytes ".repeat(2000));
    const statuses: PhoneFaceSendStatus[] = [];
    const phone = sender({ hosts: () => ["192.168.1.20"], onStatus: (s) => statuses.push(s) });
    const send = await phone.start({ data, name: "  Track\nDay  ", model: "pace-pro" });
    expect(send.name).toBe("TrackDay");
    expect(send.size).toBe(data.length);
    expect(send.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(send.expiresAt - Date.now()).toBeGreaterThan(PHONE_FACE_SEND_TTL_MS - 5_000);
    expect(PHONE_FACE_SEND_TTL_MS).toBe(10 * 60_000);
    const link = new URL(send.link.replace("coroslink://face/1", "http://face.invalid/"));
    const port = Number(link.searchParams.get("p"));
    const token = link.searchParams.get("k")!;
    expect(link.searchParams.get("a")).toBe("192.168.1.20");
    expect(token).toHaveLength(22);
    expect(Buffer.from(token, "base64url")).toHaveLength(16);
    expect(link.searchParams.get("h")).toBe(createHash("sha256").update(data).digest("base64url"));
    expect(link.searchParams.get("s")).toBe(String(data.length));
    expect(link.searchParams.get("w")).toBe("pace-pro");
    expect(phone.status()).toEqual({ active: true, sending: false, received: 0, expiresAt: send.expiresAt });

    const base = `http://127.0.0.1:${port}`;
    const ok = await get(`${base}/face/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/zip");
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.body.equals(data)).toBe(true);
    expect((await get(`${base}/face/${token}`, "HEAD")).status).toBe(200);
    expect((await get(`${base}/face/${token}`, "POST")).status).toBe(404);
    expect((await get(`${base}/face/${"A".repeat(22)}`)).status).toBe(404);
    expect((await get(`${base}/face/${token}?x=1`)).status).toBe(404);
    expect((await get(`${base}/`)).status).toBe(404);
    await new Promise((r) => setTimeout(r, 20));
    expect(statuses.some((s) => s.sending)).toBe(true);
    // One finished download; HEAD doesn't count.
    expect(statuses.at(-1)?.received).toBe(1);
    expect(statuses.at(-1)?.expiresAt).toBe(send.expiresAt);
    expect(phone.status()).toMatchObject({ active: true, sending: false, received: 1 });

    phone.stop();
    expect(statuses.at(-1)?.active).toBe(false);
    expect(phone.status()).toMatchObject({ active: false, received: 1, expiresAt: send.expiresAt });
    await expect(get(`${base}/face/${token}`)).rejects.toThrow(/ECONNREFUSED|ECONNRESET/);
  });

  it("sends one face at a time", async () => {
    const phone = sender({ hosts: () => ["10.0.0.7"] });
    const first = await phone.start({ data: Buffer.from("one"), name: "One" });
    const second = await phone.start({ data: Buffer.from("two"), name: "Two" });
    const port = (s: typeof first) => new URL(s.link.replace("coroslink://face/1", "http://x/")).searchParams.get("p");
    const token = (s: typeof first) => new URL(s.link.replace("coroslink://face/1", "http://x/")).searchParams.get("k");
    await expect(get(`http://127.0.0.1:${port(first)}/face/${token(first)}`)).rejects.toThrow(/ECONNREFUSED|ECONNRESET/);
    expect((await get(`http://127.0.0.1:${port(second)}/face/${token(second)}`)).body.toString()).toBe("two");
  });

  it("stops on its own when the code expires", async () => {
    const phone = sender({ hosts: () => ["10.0.0.7"], ttlMs: 50 });
    await phone.start({ data: Buffer.from("face"), name: "Short" });
    await new Promise((r) => setTimeout(r, 120));
    expect(phone.status().active).toBe(false);
  });

  it("refuses no network, an empty face and one over 64 MB", async () => {
    const data = Buffer.from("face");
    await expect(sender({ hosts: () => [] }).start({ data, name: "x" })).rejects.toThrow(/local network/);
    await expect(sender({ hosts: () => ["10.0.0.7"] }).start({ data: Buffer.alloc(0), name: "x" })).rejects.toThrow(/Build the watch face/);
    await expect(sender({ hosts: () => ["10.0.0.7"] }).start({ data: Buffer.alloc(PHONE_FACE_MAX_BYTES + 1), name: "x" })).rejects.toThrow(/64 MB/);
  });
});
