import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDay, UsageCheckIn } from "./usage";

interface Sent { installId: string; day: string; version: string; platform: string; arch: string; areas: string[] }

function setup(options: { allowed?: () => boolean; status?: number; now?: () => Date } = {}) {
  const folder = mkdtempSync(path.join(tmpdir(), "clink-usage-"));
  const sent: Sent[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(null, { status: options.status ?? 204 });
  });
  const usage = new UsageCheckIn(folder, {
    endpoint: "https://faces.test/api/v1/app/usage", version: "1.2.3", platform: "darwin", arch: "arm64", allowed: options.allowed ?? (() => true),
    fetch: fetch as unknown as typeof globalThis.fetch, now: options.now ?? (() => new Date(2026, 10, 26, 9)),
  });
  return { folder, sent, fetch, usage };
}

describe("usage counts", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("dates the day as the person sees it", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("checks in on launch with a random ID and nothing else about the person", async () => {
    const { usage, sent } = setup();
    usage.start();
    await usage.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ installId: expect.stringMatching(/^[0-9a-f-]{36}$/), day: "2026-11-26", version: "1.2.3", platform: "darwin", arch: "arm64", areas: [] });
  });

  it("checks in once a day, and again on a new day", async () => {
    let now = new Date(2026, 10, 26, 9);
    const { usage, sent } = setup({ now: () => now });
    usage.start();
    await usage.flush();
    usage.start();
    await usage.flush();
    expect(sent).toHaveLength(1);
    now = new Date(2026, 10, 27, 8);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await usage.flush();
    expect(sent.map((s) => s.day)).toEqual(["2026-11-26", "2026-11-27"]);
    usage.forget();
  });

  it("keeps the same ID across launches and retries a failed send", async () => {
    const first = setup({ status: 503 });
    first.usage.start();
    await first.usage.flush();
    expect(first.sent).toHaveLength(1);
    const saved = JSON.parse(readFileSync(path.join(first.folder, "usage.json"), "utf8")) as { installId: string };
    const again = new UsageCheckIn(first.folder, {
      endpoint: "https://faces.test/api/v1/app/usage", version: "1.2.3", platform: "darwin", arch: "arm64", allowed: () => true,
      fetch: first.fetch as unknown as typeof fetch, now: () => new Date(2026, 10, 26, 12),
    });
    await again.flush();
    expect(first.sent).toHaveLength(2);
    expect(first.sent[1].installId).toBe(saved.installId);
    first.usage.forget();
  });

  it("sends nothing when not allowed, and forgets the ID when turned off", async () => {
    let on = false;
    const { usage, sent, folder } = setup({ allowed: () => on });
    usage.start();
    await usage.flush();
    expect(sent).toHaveLength(0);
    on = true;
    usage.start();
    await usage.flush();
    const id = sent[0].installId;
    usage.forget();
    expect(existsSync(path.join(folder, "usage.json"))).toBe(false);
    usage.start();
    await usage.flush();
    expect(sent.at(-1)?.installId).not.toBe(id);
    usage.forget();
  });
});
