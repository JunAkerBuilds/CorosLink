// The Training Hub client against a mocked fetch. Nothing here reaches COROS and no real account is used.
import { describe, expect, it } from "vitest";
import { bcryptHash } from "./bcrypt";
import { HUB_HOSTS, TrainingHub, assertHubURL, dataOf, regionBaseURL, regionName, type HubSession } from "./client";
import { HubExpired, HubForbidden, HubInvalid, HubMoveFailed, HubNotWired, HubProblem, HubRefused, HubSignedOut, errorResponse } from "./errors";
import type { Json, JsonObject } from "./json";

const session: HubSession = { accessToken: "tok-123", userId: "4242", regionId: "3", baseURL: "https://teameuapi.coros.com" };
const MD5 = "5f4dcc3b5aa765d61d8327deb882cf99";

interface Seen { url: URL; method: string; headers: Record<string, string>; body: JsonObject | null; redirect: string | undefined; signal: boolean }

/** A hub whose fetch is `answer`, with every request it made. */
function mocked(answer: (seen: Seen) => Response | Promise<Response>): { hub: TrainingHub; seen: Seen[] } {
  const seen: Seen[] = [];
  const hub = new TrainingHub(async (input, init) => {
    const request: Seen = {
      url: new URL(String(input)), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) as JsonObject : null, redirect: init?.redirect, signal: init?.signal instanceof AbortSignal,
    };
    seen.push(request);
    return answer(request);
  });
  return { hub, seen };
}
const ok = (data: Json) => Response.json({ result: "0000", message: "OK", data });

describe("the host allowlist", () => {
  it("is COROS's four Training Hub hosts", () => {
    expect([...HUB_HOSTS].sort()).toEqual(["teamapi.coros.com", "teamcnapi.coros.com", "teameuapi.coros.com", "teamsgapi.coros.com"]);
  });

  it("refuses anything else", () => {
    expect(() => assertHubURL(new URL("https://teamapi.coros.com/account/query"))).not.toThrow();
    for (const bad of [
      "http://teamapi.coros.com/x", "https://teamapi.coros.com.evil.example/x", "https://evil.example/teamapi.coros.com", "https://teamapi.coros.com:8443/x",
      "https://user:pw@teamapi.coros.com/x", "https://training.coros.com/x", "https://xteamapi.coros.com/x", "https://localhost/x", "https://169.254.169.254/x",
    ]) expect(() => assertHubURL(new URL(bad)), bad).toThrow("C-LINK only talks to COROS's own servers");
  });

  it("never sends a request for a session on another host", async () => {
    const { hub, seen } = mocked(() => ok({}));
    await expect(hub.get("account/query", {}, { ...session, baseURL: "https://evil.example" })).rejects.toThrow(HubProblem);
    await expect(hub.post("training/program/query", {}, { ...session, baseURL: "http://teamapi.coros.com" })).rejects.toThrow(HubProblem);
    expect(seen).toHaveLength(0);
  });

  it("doesn't follow a redirect", async () => {
    const { hub, seen } = mocked(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } }));
    await expect(hub.get("account/query", {}, session)).rejects.toThrow("HTTP 302");
    expect(seen).toHaveLength(1);
    expect(seen[0].redirect).toBe("manual");
  });

  it("maps COROS's regions", () => {
    expect(regionBaseURL("1")).toBe("https://teamapi.coros.com");
    expect(regionBaseURL("2")).toBe("https://teamcnapi.coros.com");
    expect(regionBaseURL("3")).toBe("https://teameuapi.coros.com");
    expect(regionBaseURL("4")).toBe("https://teamsgapi.coros.com");
    expect(regionBaseURL("9")).toBeNull();
    expect(regionName("https://teameuapi.coros.com")).toBe("Europe");
  });
});

describe("requests", () => {
  it("sends the token and user as COROS's web app does, with a timeout", async () => {
    const { hub, seen } = mocked(() => ok({ list: [] }));
    await hub.get("training/schedule/query", { startDate: "20261118", endDate: "20261119", supportRestExercise: "1" }, session);
    expect(seen[0].url.href).toBe("https://teameuapi.coros.com/training/schedule/query?endDate=20261119&startDate=20261118&supportRestExercise=1");
    expect(seen[0].headers).toMatchObject({ accesstoken: "tok-123", yfheader: '{"userId":"4242"}', Accept: "application/json, text/plain, */*" });
    expect(seen[0].headers["Content-Type"]).toBeUndefined();
    expect(seen[0].signal).toBe(true);
    await hub.post("training/program/query", {}, session);
    expect(seen[1]).toMatchObject({ method: "POST", body: {} });
    expect(seen[1].headers["Content-Type"]).toBe("application/json");
  });

  it("answers data, nothing for null, and typed errors", async () => {
    expect(dataOf({ result: "0000", data: null }, true)).toBeUndefined();
    expect(dataOf({ result: "0000", data: { a: 1 } }, true)).toEqual({ a: 1 });
    expect(() => dataOf({ result: "1030", message: "Wrong" }, false)).toThrow(HubRefused);
    expect(() => dataOf({ apiCode: "5001" }, true)).toThrow("COROS refused the request (5001).");
    expect(() => dataOf({}, false)).toThrow("COROS refused the request (unknown).");
  });

  it("finds an ended session by COROS's codes, or a message about the token", () => {
    for (const code of ["0101", "0102", "1006", "1019", "ACCESS_TOKEN_IS_INVALID"]) {
      expect(() => dataOf({ result: code, message: "Login expired" }, true), code).toThrow(HubExpired);
    }
    expect(() => dataOf({ result: "9999", message: "Access Token invalid" }, true)).toThrow(HubExpired);
    expect(() => dataOf({ result: "0000", message: "token ok", data: 1 }, true)).not.toThrow();
    // While signing in there is no session to end: 1006 is a refusal (a wrong password).
    expect(() => dataOf({ result: "1006", message: "Wrong" }, false)).toThrow(HubRefused);
  });

  it("words what went wrong on the way", async () => {
    await expect(mocked(() => new Response("<html>", { status: 200 })).hub.get("x", {}, session)).rejects.toThrow("COROS sent an unexpected answer.");
    await expect(mocked(() => new Response("{}", { status: 503 })).hub.get("x", {}, session)).rejects.toThrow("HTTP 503");
    await expect(mocked(() => { throw new TypeError("fetch failed"); }).hub.get("x", {}, session)).rejects.toThrow("COROS couldn't be reached");
    await expect(mocked(() => { throw new DOMException("timed out", "TimeoutError"); }).hub.get("x", {}, session)).rejects.toThrow("within 30 seconds");
    await expect(mocked(() => new Response("{}", { headers: { "content-length": String(17 << 20) } })).hub.get("x", {}, session)).rejects.toThrow("unexpected response");
  });
});

describe("sign-in", () => {
  it("sends bcrypt of the MD5 with its salt, never the MD5, and resolves the account's region", async () => {
    const { hub, seen } = mocked((request) => {
      if (request.url.pathname === "/account/login") {
        return request.url.host === "teamapi.coros.com" ? Response.json({ result: "1031", message: "Not registered" }) : ok({ accessToken: "tok-9", userId: "77", regionId: 3 });
      }
      return ok({ userId: "4242" });
    });
    const result = await hub.signIn("runner@example.com", MD5);
    expect(result).toEqual({ kind: "signedIn", session: { accessToken: "tok-9", userId: "4242", regionId: "3", baseURL: "https://teameuapi.coros.com" } });
    const logins = seen.filter((request) => request.url.pathname === "/account/login");
    expect(logins.map((request) => request.url.host)).toEqual(["teamapi.coros.com", "teameuapi.coros.com"]);
    for (const login of logins) {
      const body = login.body!;
      expect(body).toMatchObject({ account: "runner@example.com", accountType: 2, rmbm: 1 });
      expect(String(body.p2)).toMatch(/^\$2b\$10\$.{22}$/);
      expect(body.p1).toBe(bcryptHash(MD5, String(body.p2)));
      expect(JSON.stringify(body)).not.toContain(MD5);
      expect(login.headers.YFHeader).toBe('{"language":"en-US"}');
      expect(login.headers.accesstoken).toBeUndefined();
    }
    expect(logins[0].body!.p2).not.toBe(logins[1].body!.p2);
    const check = seen[seen.length - 1];
    expect(check.url.href).toBe("https://teameuapi.coros.com/account/query");
    expect(check.headers.accesstoken).toBe("tok-9");
  });

  it("reports the useful refusal, not a later region's 'not registered'", async () => {
    const wrong = mocked((request) => Response.json(request.url.host === "teameuapi.coros.com" ? { result: "1030", message: "Wrong password" } : { result: "1031", message: "Not registered" }));
    const error = await wrong.hub.signIn("runner@example.com", MD5).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HubRefused);
    expect((error as HubRefused).code).toBe("1030");
    expect(wrong.seen).toHaveLength(4);
    expect(errorResponse(error, true)).toEqual({ status: 401, body: { error: { code: "wrong_password", message: "COROS didn't accept that email and password.", corosCode: "1030" } } });
    const unknown = await mocked(() => Response.json({ result: "1031", message: "Not registered" })).hub.signIn("x@example.com", MD5).catch((caught: unknown) => caught);
    expect(errorResponse(unknown, true).body.error).toMatchObject({ code: "unknown_account", message: "COROS doesn't know that email." });
  });

  it("asks for the emailed code when COROS wants one, then verifies it", async () => {
    const { hub, seen } = mocked((request) => {
      switch (request.url.pathname) {
        case "/account/login": return ok({ loginTicket: "ticket-1", appKey: "key-1", account: "r***@example.com", accountType2fa: 2, regionId: "1", userId: "77" });
        case "/account/captcha": return ok(null);
        case "/account/2fa/login/verify": return ok({ accessToken: "tok-2fa" });
        default: return ok({ userId: "77" });
      }
    });
    const result = await hub.signIn("runner@example.com", MD5);
    if (result.kind !== "needsCode") throw new Error("expected a challenge");
    expect(result.challenge).toEqual({ account: "r***@example.com", baseURL: "https://teamapi.coros.com", loginTicket: "ticket-1", appKey: "key-1", accountType: "2", regionId: "1", userId: "77" });
    expect(JSON.stringify(result.challenge)).not.toContain(MD5);
    expect(seen[1].url.pathname).toBe("/account/captcha");
    expect(seen[1].body).toEqual({ account: "r***@example.com", codeType: 20, lengthType: 2, accountType: "2" });

    await expect(hub.verify("12345", result.challenge)).rejects.toThrow(HubInvalid);
    await expect(hub.verify("12345a", result.challenge)).rejects.toThrow("Enter the 6-digit code COROS emailed you.");
    const verified = await hub.verify(" 123456 ", result.challenge);
    expect(verified).toEqual({ accessToken: "tok-2fa", userId: "77", regionId: "1", baseURL: "https://teamapi.coros.com" });
    const verify = seen.find((request) => request.url.pathname === "/account/2fa/login/verify")!;
    expect(verify.body).toEqual({ loginTicket: "ticket-1", appKey: "key-1", code: "123456" });
    expect(verify.headers["X-No-Warnning"]).toBe("1");
  });

  it("fails cleanly when COROS's answer is incomplete or unreachable", async () => {
    await expect(mocked(() => ok({ regionId: "1" })).hub.signIn("a@example.com", MD5)).rejects.toThrow("COROS's sign-in answer was incomplete.");
    await expect(mocked(() => { throw new TypeError("fetch failed"); }).hub.signIn("a@example.com", MD5)).rejects.toThrow("COROS couldn't be reached");
  });
});

describe("what the browser is told", () => {
  it("maps an ended session to 401 expired, and never retries", async () => {
    const { hub, seen } = mocked(() => Response.json({ result: "1019", message: "Login expired" }));
    const error = await hub.check(session).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HubExpired);
    expect(seen).toHaveLength(1);
    expect(errorResponse(error)).toEqual({ status: 401, body: { error: { code: "expired", message: "COROS signed you out. Sign in again." } } });
  });

  it("maps every other failure", () => {
    expect(errorResponse(new HubSignedOut())).toMatchObject({ status: 401, body: { error: { code: "signed_out" } } });
    expect(errorResponse(new HubForbidden())).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    expect(errorResponse(new HubInvalid("from must be YYYY-MM-DD."))).toEqual({ status: 400, body: { error: { code: "invalid", message: "from must be YYYY-MM-DD." } } });
    expect(errorResponse(new HubNotWired("later"))).toMatchObject({ status: 501, body: { error: { code: "not_wired" } } });
    expect(errorResponse(new HubRefused("5005", "Plan is full"))).toEqual({ status: 422, body: { error: { code: "refused", message: "Plan is full", corosCode: "5005" } } });
    expect(errorResponse(new HubProblem("Give the workout a name.", "workout"))).toMatchObject({ status: 422, body: { error: { code: "invalid" } } });
    expect(errorResponse(new HubProblem("COROS couldn't be reached.", "unreachable"))).toMatchObject({ status: 504, body: { error: { code: "unreachable" } } });
    expect(errorResponse(new HubProblem("HTTP 503"))).toMatchObject({ status: 502, body: { error: { code: "coros" } } });
    // Anything unexpected says nothing about itself.
    expect(errorResponse(new Error("secret detail tok-123"))).toEqual({ status: 500, body: { error: { code: "server", message: "C-LINK couldn't finish that. Try again." } } });
  });

  it("sends a stopped move's progress along with why it stopped", () => {
    const move = { from: "2026-11-23", to: "2026-11-27", name: "Tempo", idInPlan: "7", targetBefore: ["8"], newIdInPlan: "9", removed: false };
    expect(errorResponse(new HubMoveFailed(new HubProblem("HTTP 500"), move))).toEqual({ status: 502, body: { error: { code: "coros", message: "HTTP 500", move } } });
    expect(errorResponse(new HubMoveFailed(new HubExpired(), move))).toMatchObject({ status: 401, body: { error: { code: "expired", move } } });
  });
});
