import { describe, expect, it } from "vitest";
import { clientNetwork } from "../src/wifiAudioLookup";
import { Harness, RELAY_ORIGIN } from "./helpers";

const session = { token: "AbCdEf_123", taskId: "1234ABCD", host: "10.1.2.3", port: 23456,
  audioNonce: "0123456789abcdef0123456789abcdef", fileIds: ["ABCDEF01", "ABCDEF02"] };
const post = (path: string, body: unknown, ip = "203.0.113.9") => new Request(`${RELAY_ORIGIN}${path}`, {
  method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body),
});
const task = (i: number) => i.toString(16).toUpperCase().padStart(8, "0");
const renewal = (token = session.token, task = session.taskId, file = "ABCDEF01") =>
  post(`/${token}/.coros.com/openapi/music163/song/download/renew`, { task_id: task, file_id: file, device_id: "not-used" });

describe("NetEase HTTPS lookup", () => {
  it("only returns explicitly staged LAN URLs to a matching temporary capability", async () => {
    const h = await Harness.create();
    expect((await h.fetch(renewal())).status).toBe(404);
    expect((await h.fetch(post("/v1/wifi-audio/lookups", session))).status).toBe(200);
    const result = await h.fetch(renewal());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ code: 0, data: { sub_code: 200,
      url: `http://10.1.2.3:23456/audio/${session.audioNonce}/ABCDEF01/ABCDEF01.mp3` } });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect((await h.fetch(renewal("wrongToken", session.taskId))).status).toBe(404);
    expect((await h.fetch(renewal(session.token, "00000000"))).status).toBe(404);
    expect((await h.fetch(renewal(session.token, session.taskId, "ABCDEF03"))).status).toBe(404);
    expect((await h.fetch(post("/v1/wifi-audio/lookups/revoke", { token: session.token, taskId: session.taskId }))).status).toBe(200);
    expect((await h.fetch(renewal())).status).toBe(404);
  });

  it("expires lookups and never accepts public, loopback, malformed or oversized targets", async () => {
    const h = await Harness.create();
    for (const host of ["127.0.0.1", "8.8.8.8", "192.168.001.1", "169.254.169.254", "[::1]", "example.com"]) {
      expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, host }))).status).toBe(400);
    }
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, fileIds: Array.from({ length: 101 }, (_, i) => (0xABCD0000 + i).toString(16).toUpperCase()) }))).status).toBe(400);
    // One download task may list up to 100 files (the desktop's batch size).
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: "ABCDEF99", fileIds: Array.from({ length: 100 }, (_, i) => (0xABCD0000 + i).toString(16).toUpperCase()) }))).status).toBe(200);
    expect((await h.fetch(post("/v1/wifi-audio/lookups", session))).status).toBe(200);
    h.clock.advance(36 * 60_000);
    expect((await h.fetch(renewal())).status).toBe(404);
    await h.maintenance();
    const count = await h.env.DB.prepare("SELECT COUNT(*) AS n FROM wifi_audio_lookups").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("rate limits registrations and cannot overwrite an existing capability", async () => {
    const h = await Harness.create();
    expect((await h.fetch(post("/v1/wifi-audio/lookups", session))).status).toBe(200);
    const duplicate = await h.fetch(post("/v1/wifi-audio/lookups", { ...session, port: 2 }));
    expect(duplicate.status).not.toBe(200);
    expect(((await (await h.fetch(renewal())).json()) as {data: {url: string}}).data.url).toContain(":23456/");
    // Revoking keeps the active count down, so only the hourly limit applies.
    for (let i = 0; i < 38; i++) {
      expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(i) }))).status).toBe(200);
      await h.fetch(post("/v1/wifi-audio/lookups/revoke", { token: session.token, taskId: task(i) }));
    }
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: "FFFFFFFF" }))).status).toBe(429);
  });

  it("caps active lookups per client network, counting IPv6 by /64", async () => {
    const h = await Harness.create();
    const a = "2001:db8:1:2::1", b = "2001:db8:1:2:ffff::9", other = "2001:db8:1:3::1";
    for (let i = 0; i < 10; i++) {
      expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(i) }, i % 2 ? a : b))).status).toBe(200);
    }
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(10) }, b))).status).toBe(429);
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(11) }, other))).status).toBe(200);
    await h.fetch(post("/v1/wifi-audio/lookups/revoke", { token: session.token, taskId: task(0) }));
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(12) }, a))).status).toBe(200);
    h.clock.advance(36 * 60_000);
    expect((await h.fetch(post("/v1/wifi-audio/lookups", { ...session, taskId: task(13) }, a))).status).toBe(200);
  });

  it("groups IPv6 clients by /64 and keeps IPv4 addresses whole", () => {
    expect(clientNetwork("203.0.113.9")).toBe("203.0.113.9");
    expect(clientNetwork("2001:0DB8:0001:0002:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
    expect(clientNetwork("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  });
});
