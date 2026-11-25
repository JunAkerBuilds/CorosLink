import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HubInvalid } from "./errors";
import { open, seal } from "./seal";
import { account, corosId, day, dayRange, fromThisSite, moveProgress, passwordHash, plainText, workout } from "./validate";

describe("input checks", () => {
  it("takes an email and the password's MD5 only", () => {
    expect(account("  runner@example.com ")).toBe("runner@example.com");
    for (const bad of ["", "runner", "a b@example.com", "a@b\nc", 5, null, "x".repeat(250) + "@example.com"]) expect(() => account(bad)).toThrow(HubInvalid);
    expect(passwordHash("5f4dcc3b5aa765d61d8327deb882cf99")).toBe("5f4dcc3b5aa765d61d8327deb882cf99");
    // A plain password, upper-case hex, or anything of another length is refused: the server never takes a password.
    for (const bad of ["password", "5F4DCC3B5AA765D61D8327DEB882CF99", "5f4dcc3b5aa765d61d8327deb882cf9", "5f4dcc3b5aa765d61d8327deb882cf99 ", undefined]) {
      expect(() => passwordHash(bad)).toThrow(HubInvalid);
    }
  });

  it("takes real days and bounded ranges", () => {
    expect(day("2026-11-19")).toBe("2026-11-19");
    expect(day("2028-02-29")).toBe("2028-02-29");
    for (const bad of ["2026-02-30", "2026-13-01", "20261119", "2026-1-9", "1999-01-01", "", null, 20261119]) expect(() => day(bad)).toThrow(HubInvalid);
    expect(dayRange("2026-11-01", "2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(dayRange("2026-11-19", "2026-11-19")).toEqual({ from: "2026-11-19", to: "2026-11-19" });
    expect(() => dayRange("2026-11-30", "2026-11-01")).toThrow("from must not be after to.");
    expect(() => dayRange("2026-01-01", "2027-06-01")).toThrow("at most 400 days");
    expect(() => dayRange(null, "2026-11-01")).toThrow(HubInvalid);
  });

  it("takes COROS IDs that can't bend a URL or a header", () => {
    expect(corosId("426109589008859136")).toBe("426109589008859136");
    for (const bad of ["", "1/../2", "1?x=1", "1\r\nX: y", "1 2", 7, "x".repeat(41)]) expect(() => corosId(bad)).toThrow(HubInvalid);
    expect(() => plainText("a\u0000b", "The name", 10)).toThrow(HubInvalid);
    expect(() => plainText("toolong", "The name", 3)).toThrow(HubInvalid);
  });

  it("cleans a workout from the browser and drops what it doesn't know", () => {
    const clean = workout({
      name: "Tempo", sport: "run", description: "", evil: "<script>", blocks: [
        { repeats: null, steps: [{ id: "1", kind: "warmup", target: "time", seconds: 600, intensity: { kind: "heartRate", low: 120, high: 140 }, source: { accesstoken: "x" } }] },
        { id: "2", repeats: 3, steps: [{ kind: "training", target: "distance", meters: 1000 }, { kind: "rest", target: "time", seconds: 60, intensity: null }] },
      ],
    });
    expect(clean).toEqual({
      name: "Tempo", sport: "run", description: "", blocks: [
        { repeats: null, steps: [{ id: "1", kind: "warmup", target: "time", seconds: 600, intensity: { kind: "heartRate", low: 120, high: 140 } }] },
        { id: "2", repeats: 3, steps: [{ kind: "training", target: "distance", meters: 1000, intensity: { kind: "none" } }, { kind: "rest", target: "time", seconds: 60, intensity: { kind: "none" } }] },
      ],
    });
  });

  it("refuses a malformed workout", () => {
    const step = { kind: "training", target: "time", seconds: 60 };
    const base = { name: "x", sport: "run", description: "", blocks: [{ repeats: null, steps: [step] }] };
    expect(() => workout(base)).not.toThrow();
    expect(workout({ ...base, sport: "swim", poolLength: 33.33 }).poolLength).toBe(33.33);
    expect(workout(base)).not.toHaveProperty("poolLength");
    for (const bad of [
      { ...base, poolLength: 0 }, { ...base, poolLength: "25" },
      null, "x", [], { ...base, sport: "chess" }, { ...base, blocks: "no" }, { ...base, name: 5 },
      { ...base, blocks: [{ repeats: null, steps: [{ ...step, kind: "sprint" }] }] },
      { ...base, blocks: [{ repeats: null, steps: [{ ...step, seconds: "60" }] }] },
      { ...base, blocks: [{ repeats: null, steps: [{ ...step, seconds: Number.NaN }] }] },
      { ...base, blocks: [{ repeats: 2.5, steps: [step] }] },
      { ...base, blocks: [{ repeats: null, steps: [{ ...step, id: "1/2" }] }] },
      { ...base, blocks: [{ repeats: null, steps: [{ ...step, exercise: { id: "1" } }] }] },
      { ...base, blocks: Array.from({ length: 101 }, () => ({ repeats: null, steps: [step] })) },
      { ...base, gradeSystem: "made-up" },
    ]) expect(() => workout(bad)).toThrow(HubInvalid);
  });

  it("takes back a move's progress only in the shape it was handed out", () => {
    const move = { from: "2026-11-23", to: "2026-11-27", name: "Tempo", idInPlan: "7", targetBefore: ["8", ""], newIdInPlan: null, removed: false };
    expect(moveProgress(move)).toEqual(move);
    expect(moveProgress({ ...move, targetBefore: undefined, idInPlan: undefined })).toMatchObject({ targetBefore: null, idInPlan: null });
    for (const bad of [{ ...move, removed: "no" }, { ...move, to: "tomorrow" }, { ...move, targetBefore: "8" }, { ...move, newIdInPlan: "9;drop" }, null]) {
      expect(() => moveProgress(bad)).toThrow(HubInvalid);
    }
  });
});

describe("the same-site check on state-changing requests", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it("lets this site's own pages through", () => {
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "https://app.example", "sec-fetch-site": "same-origin" }), "app.example")).toBe(true);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "http://localhost:3210" }), "localhost:3210")).toBe(true);
    expect(fromThisSite(headers({ "x-clink-hub": "1", "sec-fetch-site": "same-origin" }), "app.example")).toBe(true);
  });

  it("refuses other sites, and requests that say nothing about where they came from", () => {
    expect(fromThisSite(headers({ origin: "https://app.example", "sec-fetch-site": "same-origin" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "https://evil.example", "sec-fetch-site": "cross-site" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "https://evil.example" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "https://sub.app.example", "sec-fetch-site": "same-site" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "null" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1" }), "app.example")).toBe(false);
    expect(fromThisSite(headers({ "x-clink-hub": "1", origin: "https://app.example" }), null)).toBe(false);
  });
});

describe("the sealed session cookie", () => {
  const key = randomBytes(32);
  const session = { session: { accessToken: "tok-123", userId: "4242", regionId: "3", baseURL: "https://teameuapi.coros.com" }, email: "runner@example.com" };

  it("opens what it sealed, and shows nothing of it", () => {
    const sealed = seal("clink_hub", session, 60, key);
    expect(open("clink_hub", sealed, key)).toEqual(session);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("tok-123");
    expect(seal("clink_hub", session, 60, key)).not.toBe(sealed);
  });

  it("opens as nothing when altered, expired, renamed or from another key", () => {
    const sealed = seal("clink_hub", session, 60, key, 1_000_000);
    expect(open("clink_hub", sealed, key, 1_000_000 + 59_000)).toEqual(session);
    expect(open("clink_hub", sealed, key, 1_000_000 + 61_000)).toBeNull();
    expect(open("clink_hub_code", sealed, key, 1_000_000)).toBeNull();
    expect(open("clink_hub", sealed, randomBytes(32), 1_000_000)).toBeNull();
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(open("clink_hub", flipped, key, 1_000_000)).toBeNull();
    for (const bad of [undefined, "", "not base64!", "abcd"]) expect(open("clink_hub", bad, key)).toBeNull();
  });
});
