import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ReportSender, tail, type Report } from "./reports";

function setup(options: { status?: number; crashes?: boolean; origin?: string | null; down?: boolean } = {}) {
  const folder = mkdtempSync(path.join(tmpdir(), "clink-reports-"));
  const sent: Report[] = [];
  let status = options.status ?? 201;
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (options.down) throw new TypeError("fetch failed");
    sent.push(JSON.parse(String(init?.body)) as Report);
    return Response.json({ reference: "AB12CD34" }, { status });
  });
  const host = {
    version: "1.2.3", platform: "darwin", arch: "arm64", system: "macOS · Apple silicon", electron: "40.0.0",
    origin: options.origin === undefined ? "https://faces.test" : options.origin,
    log: (hours: number) => `C-LINK 1.2.3\n[${hours}h] app Something broke at ~/Library`,
    installId: () => "0f3c2d1e-1111-4222-8333-444455556666",
    crashesAllowed: () => options.crashes ?? true,
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => new Date("2026-11-26T10:00:00Z"),
  };
  return { folder, sent, fetch, host, setStatus: (s: number) => { status = s; }, reports: new ReportSender(folder, host) };
}

describe("error reports", () => {
  it("sends the log the person sees, their note and email, and gives back a reference", async () => {
    const { reports, sent } = setup();
    expect(await reports.send({ note: "  Studio froze  ", contact: "me@example.com", hours: 24 })).toEqual({ reference: "AB12CD34" });
    expect(sent[0]).toMatchObject({ kind: "manual", note: "Studio froze", contact: "me@example.com", installId: "0f3c2d1e-1111-4222-8333-444455556666", log: "C-LINK 1.2.3\n[24h] app Something broke at ~/Library" });
  });

  it("says why a send failed", async () => {
    expect(await setup({ down: true }).reports.send({ note: "", contact: "", hours: 1 })).toEqual({ failed: "offline" });
    expect(await setup({ status: 400 }).reports.send({ note: "", contact: "x", hours: 1 })).toEqual({ failed: "refused" });
    expect(await setup({ origin: null }).reports.send({ note: "", contact: "", hours: 1 })).toEqual({ failed: "unavailable" });
  });

  it("keeps the newest end of a long log", () => {
    const text = "a".repeat(10) + "b".repeat(100);
    expect(tail(text, 50).endsWith("b".repeat(48))).toBe(true);
    expect(tail(text, 50)).toHaveLength(50);
  });

  it("sends a crash with the last hour, once, and at most three a day", async () => {
    const { reports, sent } = setup();
    reports.crashed("Window: crashed");
    await reports.flush();
    reports.crashed("Window: crashed");
    await reports.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "crash", note: "Window: crashed", log: expect.stringContaining("[1h]") });
    reports.crashed("GPU process: crashed");
    await reports.flush();
    reports.crashed("App: boom");
    await reports.flush();
    reports.crashed("App: again");
    await reports.flush();
    expect(sent.map((r) => r.note)).toEqual(["Window: crashed", "GPU process: crashed", "App: boom"]);
  });

  it("takes home folders and keys out of the crash's own words, and sends a repeat crash again the next day", async () => {
    let now = new Date("2026-11-26T10:00:00Z");
    const s = setup();
    const reports = new ReportSender(s.folder, { ...s.host, now: () => now });
    reports.crashed(`App: ENOENT open '${homedir()}/Library/x' token=abcdef1234567890abcdef`);
    await reports.flush();
    expect(s.sent[0].note).not.toContain(homedir());
    expect(s.sent[0].note).toContain("~/Library/x");
    const same = s.sent[0].note;
    now = new Date("2026-11-27T10:00:00Z");
    reports.crashed(`App: ENOENT open '${homedir()}/Library/x' token=abcdef1234567890abcdef`);
    await reports.flush();
    expect(s.sent.map((r) => r.note)).toEqual([same, same]);
  });

  it("keeps a crash that couldn't go out for the next launch", async () => {
    const first = setup({ status: 503 });
    first.reports.crashed("App: boom");
    await first.reports.flush();
    expect(first.sent).toHaveLength(1);
    first.setStatus(201);
    const next = new ReportSender(first.folder, first.host);
    await next.flush();
    expect(first.sent).toHaveLength(2);
    await next.flush();
    expect(first.sent).toHaveLength(2);
  });

  it("sends no crash when turned off", async () => {
    const { reports, sent } = setup({ crashes: false });
    reports.crashed("App: boom");
    await reports.flush();
    expect(sent).toHaveLength(0);
  });
});
