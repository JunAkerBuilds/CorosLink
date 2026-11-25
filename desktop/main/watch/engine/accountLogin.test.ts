// CorosKit's CorosAccountLoginTests, against the same vectors (CorosLink for Mac's own field cipher and key decoder).
import { createPublicKey, verify } from "node:crypto";
import { describe as group, expect, it } from "vitest";
import v from "./fixtures/coros-login.json";
import { decodeKey, encryptField, isWrongPassword, newInstallId, SessionConflict, signIn, SignInFailed, suggestedRegion, watchKey, type Fetch } from "./accountLogin";
import { parseWatchKey, SystemBind } from "./systemBind";

interface Seen { url: URL; headers: Headers; body: string }

/** A fake fetch answering by host (CorosKit's StubSiteProtocol / RegionStub). */
function stub(answer: (url: URL) => { status?: number; body: string }) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    const { status = 200, body } = answer(url);
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as Fetch;
  return { seen, fetchImpl };
}

const login = (s: ReturnType<typeof stub>, installId = "ab".repeat(16)) => ({ installId, fetchImpl: s.fetchImpl });
const notRegistered = `{"result":"1030","message":"Account is not registered"}`;

group("COROS account sign-in (CorosKit CorosAccountLoginTests)", () => {
  it("encrypts fields as the Mac does", () => {
    expect(encryptField(v.field.clear)).toBe(v.field.encrypted);
    expect(encryptField(v.md5Field.clear)).toBe(v.md5Field.encrypted);
  });

  it("signs in and unwraps the watch key", async () => {
    const s = stub((url) => (url.pathname === "/coros/user/login" ? { body: v.response } : { status: 404, body: `{"message":"Not found."}` }));
    const key = await watchKey(login(s), " Jay@example.com ", "password", "us");
    expect(String(key.accountUserId)).toBe("470158221903216640");
    expect(key.unit).toBe(1);
    expect(key.dataCollectSwitch).toBe(19);
    expect(key.deviceName).toBeUndefined();
    expect(key.privateKeyDER).toBe(v.privateKeyDer);

    const request = s.seen[0];
    expect(request.url.host).toBe("api.coros.com");
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body.account).toBe(encryptField("Jay@example.com"));
    expect(body.pwd).toBe(v.md5Field.encrypted); // MD5("password"), as the official client sends it.
    expect(body.checkStatus).toBe(1);
    expect(request.body).not.toContain("password");
    const header = request.headers.get("YFHeader") ?? "";
    expect(header).toContain(`"userId":0,`);
    expect(() => JSON.parse(header)).not.toThrow();
    expect(request.headers.get("app-state")).toBe("foreground");
  });

  it("waits for consent on a session conflict", async () => {
    const s = stub(() => ({ body: `{"result":"1115","message":"User logged in"}` }));
    await expect(watchKey(login(s), "jay@example.com", "password", "us")).rejects.toBeInstanceOf(SessionConflict);
    expect(s.seen).toHaveLength(1);
    // Consent sends checkStatus 0.
    await expect(watchKey(login(s), "jay@example.com", "password", "us", true)).rejects.toThrow("signed in somewhere else");
    expect(JSON.parse(s.seen[1].body).checkStatus).toBe(0);
  });

  it("falls through a wrong region to the next", async () => {
    const s = stub((url) => ({ body: url.host === "apieu.coros.com" ? v.response : notRegistered }));
    const key = await watchKey(login(s, "cd".repeat(16)), "jay@example.com", "password", "us");
    expect(String(key.accountUserId)).toBe("470158221903216640");
    expect(s.seen.map((r) => r.url.host)).toEqual(["api.coros.com", "apieu.coros.com"]);
  });

  it("reads COROS's message for a wrong password", async () => {
    const s = stub(() => ({ body: `{"result":"1002","message":"Incorrect password"}` }));
    const error = await watchKey(login(s), "jay@example.com", "nope", "eu").catch((e: unknown) => e);
    expect((error as Error).message).toBe("Incorrect password (COROS 1002)\n\nServers tried: Europe: COROS 1002");
    expect((error as SignInFailed).answers.map((a) => a.answer)).toEqual([{ kind: "refused", code: "1002", message: "Incorrect password" }]);
    expect(s.seen).toHaveLength(1);
  });

  it("says what each server answered", async () => {
    const s = stub((url) => ({ body: url.host === "apisg.coros.com" ? `{"result":"1006","message":"Please input correct user name and password"}` : notRegistered }));
    const error = await watchKey(login(s, "cd".repeat(16)), "jay@example.com", "nope", "us").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignInFailed);
    const failure = error as SignInFailed;
    expect(failure.summary).toBe("Global: not registered · Europe: not registered · Singapore: COROS 1006");
    expect(isWrongPassword(failure.answers[failure.answers.length - 1].answer)).toBe(true);
    expect(s.seen.map((r) => r.url.host)).toEqual(["api.coros.com", "apieu.coros.com", "apisg.coros.com"]);
  });

  it("refuses a tampered key", () => {
    const data = (JSON.parse(v.response) as { data: Record<string, unknown> }).data;
    expect(() => decodeKey(data, 470_158_221_903_216_641n)).toThrow(/key account differs/);
    expect(() => decodeKey({ ...data, appEncKey: "0000000000000000" }, 470_158_221_903_216_640n)).toThrow(/usable watch key/);
  });

  it("suggests a region from the locale", () => {
    expect(suggestedRegion("en_CA")).toBe("us");
    expect(suggestedRegion("de_DE")).toBe("eu");
    expect(suggestedRegion("zh_CN")).toBe("cn");
  });

  // Not in CorosKit's tests: an unreachable server and an empty form.
  it("reports no reply and asks for both fields", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as Fetch;
    await expect(watchKey({ installId: newInstallId(), fetchImpl }, "jay@example.com", "x", "cn"))
      .rejects.toThrow("Couldn't reach COROS. Check your connection and try again.\n\nServers tried: China: no reply");
    await expect(watchKey({ installId: newInstallId(), fetchImpl }, "  ", "x", "us")).rejects.toThrow("Enter your COROS email and password.");
    expect(newInstallId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

group("the helper's signIn command", () => {
  it("returns the key as JSONEncoder writes it, which parses and binds", async () => {
    const s = stub(() => ({ body: v.response }));
    const out = await signIn({ email: "jay@example.com", password: "password", region: "us", installId: "ab".repeat(16) }, s.fetchImpl);
    expect(out.account).toBe("•••• 6640");
    // JSONEncoder: nil deviceName left out, Data as base64 with "/" escaped.
    expect(out.key).toBe(`{"accountUserId":470158221903216640,"dataCollectSwitch":19,"privateKeyDER":"${v.privateKeyDer.replaceAll("/", "\\/")}","unit":1}`);
    expect(s.seen[0].headers.get("YFHeader")).toContain(`"mobileName":"${"ab".repeat(16)}"`);

    const key = parseWatchKey(out.key);
    expect(String(key.accountUserId)).toBe("470158221903216640");
    expect(key.privateKeyDER).toBe(v.privateKeyDer);
    const bind = new SystemBind(key, "COROS PACE Pro 2F1A6C", 0, false);
    const base = bind.initialPayload(new Date(1_791_471_375_000));
    expect(base[11]).toBe(0x22); // check-bind flag, imperial units
    expect(base.readUInt32LE(12)).toBe(19);
    const challenge = Buffer.from([5, ...Array(8).fill(0), 5, 0, 1, 2, 3, 4, 0, 0]);
    const reply = bind.authenticatedPayload(base, challenge);
    const signature = reply.subarray(25, 25 + 256);
    const publicKey = createPublicKey({ key: Buffer.from(v.privateKeyDer, "base64"), format: "der", type: "pkcs1" });
    expect(verify("sha256", Buffer.concat([Buffer.from([1, 2, 3, 4]), bind.user]), publicKey, signature)).toBe(true);
  });

  it("needs email, password and a known region", async () => {
    await expect(signIn({ email: "a", password: "b", region: "uk" })).rejects.toThrow("Email, password and region are needed.");
  });
});
