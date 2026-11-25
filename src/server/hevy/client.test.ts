// The Hevy client against a mocked fetch. Nothing here reaches Hevy and no real key is used.
import { describe, expect, it } from "vitest";
import { HubInvalid, HubProblem } from "@/server/hub/errors";
import { parseHevyEventsPage, parseHevyTemplatesPage, parseHevyWorkoutsPage } from "@/lib/hevy";
import { Hevy, hevyKey, hevyPage, hevySince } from "./client";
import { mockHevyFetch, mockHevyWorkouts } from "./mock";

const KEY = "sample-hevy-key-0000";

interface Seen { url: URL; headers: Record<string, string>; method: string | undefined; redirect: string | undefined; body: unknown }
function mocked(answer: (seen: Seen, n: number) => Response) {
  const seen: Seen[] = [];
  const api = new Hevy(async (input, init) => {
    const request = { url: new URL(String(input)), headers: init?.headers as Record<string, string>, method: init?.method, redirect: init?.redirect, body: init?.body };
    seen.push(request);
    return answer(request, seen.length);
  });
  return { api, seen };
}

describe("what is typed", () => {
  it("is trimmed and checked", () => {
    expect(hevyKey(`  ${KEY} `)).toBe(KEY);
    for (const bad of ["", "short", "has space in it", 42, null, "x".repeat(201)]) expect(() => hevyKey(bad), String(bad)).toThrow(HubInvalid);
    expect(hevyPage("3")).toBe(3);
    for (const bad of [null, "0", "-1", "1.5", "abc", "1001"]) expect(() => hevyPage(bad), String(bad)).toThrow(HubInvalid);
    expect(hevySince("2026-11-20T07:12:00+01:00")).toBe("2026-11-20T06:12:00.000Z");
    for (const bad of [null, "", "yesterday", "2026-11-20T07:12:00Z&page=9".padEnd(60, "x")]) expect(() => hevySince(bad), String(bad)).toThrow(HubInvalid);
  });
});

describe("the Hevy client", () => {
  it("asks whose key it is, with the key only in the api-key header", async () => {
    const { api, seen } = mocked(() => Response.json({ data: { id: "u-1", name: " alex ", url: "https://hevy.com/user/alex" } }));
    await expect(api.identity(KEY)).resolves.toEqual({ userId: "u-1", name: "alex", profileUrl: "https://hevy.com/user/alex" });
    expect(seen[0].url.href).toBe("https://api.hevyapp.com/v1/user/info");
    expect(seen[0].headers["api-key"]).toBe(KEY);
    expect(seen[0].url.href).not.toContain(KEY);
    expect(seen[0].redirect).toBe("manual");
  });

  it("keeps a profile address only when it is Hevy's own", async () => {
    const at = (url: unknown) => mocked(() => Response.json({ data: { id: "u-1", url } })).api.identity(KEY);
    await expect(at("https://evil.example/hevy.com")).resolves.toEqual({ userId: "u-1" });
    await expect(at("javascript:alert(1)")).resolves.toEqual({ userId: "u-1" });
    await expect(at(7)).resolves.toEqual({ userId: "u-1" });
  });

  it("says so when the key is refused, as the phone reads it", async () => {
    for (const status of [401, 403, 404]) {
      const refusal = mocked(() => new Response("{}", { status })).api.identity(KEY);
      await expect(refusal, String(status)).rejects.toThrow(HubInvalid);
      await expect(refusal).rejects.toThrow("didn't accept that API key");
    }
    await expect(mocked(() => Response.json({ data: {} })).api.identity(KEY)).rejects.toThrow("didn't say whose key");
  });

  it("words a saved key that stopped working differently from one just pasted", async () => {
    await expect(mocked(() => new Response("{}", { status: 401 })).api.workouts(KEY, 1)).rejects.toThrow("no longer accepts the saved API key");
    // A 404 away from /user/info is not about the key.
    await expect(mocked(() => new Response("{}", { status: 404 })).api.workouts(KEY, 1)).rejects.toThrow("HTTP 404");
  });

  it("names a rate limit, a fault, a timeout and a dead line", async () => {
    await expect(mocked(() => new Response("", { status: 429 })).api.workouts(KEY, 1)).rejects.toThrow("fewer requests");
    await expect(mocked(() => new Response("", { status: 500 })).api.workouts(KEY, 1)).rejects.toThrow("HTTP 500");
    await expect(mocked(() => new Response("<html>", { status: 200 })).api.workouts(KEY, 1)).rejects.toThrow("unexpected answer");
    await expect(mocked(() => Response.json([1, 2])).api.workouts(KEY, 1)).rejects.toThrow("unexpected answer");
    const down = new Hevy(async () => { throw new TypeError("fetch failed"); });
    await expect(down.workouts(KEY, 1)).rejects.toThrow("couldn't be reached");
    const slow = new Hevy(async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); });
    await expect(slow.workouts(KEY, 1)).rejects.toThrow(HubProblem);
    await expect(slow.workouts(KEY, 1)).rejects.toThrow("30 seconds");
  });

  it("pages workouts, changes and templates the way the desktop app does, and only ever reads", async () => {
    const { api, seen } = mocked(() => Response.json({ page_count: 1 }));
    await api.workouts(KEY, 2);
    await api.events(KEY, "2026-11-20T06:12:00.000Z", 1);
    await api.templates(KEY, 3);
    expect(seen.map((s) => s.url.href)).toEqual([
      "https://api.hevyapp.com/v1/workouts?page=2&pageSize=10",
      "https://api.hevyapp.com/v1/workouts/events?page=1&pageSize=10&since=2026-11-20T06%3A12%3A00.000Z",
      "https://api.hevyapp.com/v1/exercise_templates?page=3&pageSize=100",
    ]);
    for (const s of seen) {
      expect(s.method).toBeUndefined();
      expect(s.body).toBeUndefined();
      expect(s.headers["api-key"]).toBe(KEY);
    }
  });
});

describe("the development stand-in", () => {
  const api = new Hevy(mockHevyFetch);

  it("answers in Hevy's own JSON, page by page", async () => {
    const all = mockHevyWorkouts(new Date());
    const first = parseHevyWorkoutsPage(await api.workouts(KEY, 1), 1);
    expect(first.pageCount).toBe(Math.ceil(all.length / 10));
    expect(first.workouts).toHaveLength(10);
    expect(first.workouts[0].start).toBeGreaterThan(first.workouts[9].start);
    const last = parseHevyWorkoutsPage(await api.workouts(KEY, first.pageCount), first.pageCount);
    expect(last.seen).toBe(all.length - 10 * (first.pageCount - 1));
    expect(parseHevyEventsPage(await api.events(KEY, "2026-11-20T06:12:00.000Z", 1), 1)).toEqual({ events: [], seen: 0, pageCount: 1 });
    expect(parseHevyTemplatesPage(await api.templates(KEY, 1), 1).assisted).toEqual(["A1PULLUP"]);
    await expect(api.identity(KEY)).resolves.toMatchObject({ userId: "dev-hevy-user" });
  });

  it("can refuse a key and fail a read, so those screens can be seen", async () => {
    await expect(api.identity("refused-key-0000")).rejects.toThrow("didn't accept that API key");
    await expect(api.identity("flaky-key-00000")).resolves.toMatchObject({ userId: "dev-hevy-user" });
    await expect(api.workouts("flaky-key-00000", 1)).rejects.toThrow("HTTP 500");
  });
});
