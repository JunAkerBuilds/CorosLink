// The intervals.icu client against a mocked fetch. Nothing here reaches intervals.icu and no real key is used.
import { describe, expect, it } from "vitest";
import { HubInvalid, HubProblem } from "@/server/hub/errors";
import { Intervals, intervalsActivityId, intervalsAthlete, intervalsKey, type IntervalsLogin } from "./client";

const login: IntervalsLogin = { apiKey: "sample-key-0000", athleteId: "i204817" };
const BASIC = "Basic " + Buffer.from("API_KEY:sample-key-0000").toString("base64");

interface Seen { url: URL; headers: Record<string, string>; redirect: string | undefined }
function mocked(answer: (seen: Seen, n: number) => Response) {
  const seen: Seen[] = [];
  const api = new Intervals(async (input, init) => {
    const request = { url: new URL(String(input)), headers: init?.headers as Record<string, string>, redirect: init?.redirect };
    seen.push(request);
    return answer(request, seen.length);
  });
  return { api, seen };
}

describe("what is typed", () => {
  it("is trimmed and checked", () => {
    expect(intervalsKey("  sample-key-0000 ")).toBe("sample-key-0000");
    expect(intervalsAthlete(" i204817 ")).toBe("i204817");
    expect(intervalsActivityId("i55512345")).toBe("i55512345");
    for (const bad of ["", "abc", "has space in it", 42, null]) expect(() => intervalsKey(bad), String(bad)).toThrow(HubInvalid);
    for (const bad of ["", "i1/../x", "i1?x=1", "i 1", null]) expect(() => intervalsAthlete(bad), String(bad)).toThrow(HubInvalid);
    for (const bad of ["", "a/b", "a?b", "../x", 7]) expect(() => intervalsActivityId(bad), String(bad)).toThrow(HubInvalid);
  });
});

describe("the intervals.icu client", () => {
  it("checks a key against the athlete, with the key only in the Authorization header", async () => {
    const { api, seen } = mocked(() => Response.json({ id: "i204817" }));
    await expect(api.check(login)).resolves.toBeUndefined();
    expect(seen[0].url.href).toBe("https://intervals.icu/api/v1/athlete/i204817");
    expect(seen[0].headers.Authorization).toBe(BASIC);
    expect(seen[0].url.href).not.toContain("sample-key");
    expect(seen[0].redirect).toBe("manual");
  });

  it("says so when the key or the athlete is wrong", async () => {
    await expect(mocked(() => new Response("", { status: 401 })).api.check(login)).rejects.toThrow("didn't accept that API key");
    await expect(mocked(() => new Response("", { status: 403 })).api.check(login)).rejects.toThrow(HubInvalid);
    await expect(mocked(() => new Response("", { status: 404 })).api.check(login)).rejects.toThrow("doesn't know that athlete ID");
    await expect(mocked(() => new Response("", { status: 500 })).api.check(login)).rejects.toThrow("HTTP 500");
    const down = new Intervals(async () => { throw new TypeError("fetch failed"); });
    await expect(down.check(login)).rejects.toThrow("couldn't be reached");
  });

  it("lists a range of days", async () => {
    const { api, seen } = mocked(() => Response.json([{ id: "i1" }]));
    await expect(api.list(login, "2026-10-21", "2026-11-20")).resolves.toEqual([{ id: "i1" }]);
    expect(seen[0].url.href).toBe("https://intervals.icu/api/v1/athlete/i204817/activities?oldest=2026-10-21&newest=2026-11-20");
    await expect(mocked(() => new Response("<html>", { status: 200 })).api.list(login, "2026-10-21", "2026-11-20")).rejects.toThrow("unexpected answer");
    await expect(mocked(() => new Response("", { status: 429 })).api.list(login, "2026-10-21", "2026-11-20")).rejects.toThrow("HTTP 429");
  });

  it("downloads an activity's original file", async () => {
    const { api, seen } = mocked(() => new Response(new Uint8Array([14, 16, 1, 2]), { status: 200 }));
    await expect(api.file(login, "i55512345")).resolves.toEqual(new Uint8Array([14, 16, 1, 2]));
    expect(seen[0].url.href).toBe("https://intervals.icu/api/v1/activity/i55512345/file");
    expect(seen[0].headers.Authorization).toBe(BASIC);
  });

  it("follows one pointer to the bytes, without the key when it leaves intervals.icu", async () => {
    const { api, seen } = mocked((_, n) => n === 1
      ? new Response(null, { status: 302, headers: { Location: "https://files.example/abc.fit?sig=1" } })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    await expect(api.file(login, "i55512345")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(seen).toHaveLength(2);
    expect(seen[1].url.href).toBe("https://files.example/abc.fit?sig=1");
    expect(seen[1].headers).not.toHaveProperty("Authorization");
    expect(seen[1].redirect).toBe("manual");
  });

  it("won't follow a pointer that isn't https, or a second one", async () => {
    await expect(mocked(() => new Response(null, { status: 302, headers: { Location: "http://files.example/abc.fit" } })).api.file(login, "i1")).rejects.toThrow(HubProblem);
    const twice = mocked(() => new Response(null, { status: 302, headers: { Location: "https://files.example/abc.fit" } }));
    await expect(twice.api.file(login, "i1")).rejects.toThrow("HTTP 302");
    expect(twice.seen).toHaveLength(2);
  });

  it("says so when there is no file", async () => {
    await expect(mocked(() => new Response("", { status: 404 })).api.file(login, "i1")).rejects.toThrow("no original file");
    await expect(mocked(() => new Response(new Uint8Array(0), { status: 200 })).api.file(login, "i1")).rejects.toThrow("no original file");
  });
});
