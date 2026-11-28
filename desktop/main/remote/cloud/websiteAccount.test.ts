import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sealer } from "../../secrets";
import { CALLBACK_URL, parseCallback, WEBSITE_URL, WebsiteAccount, websiteOrigin } from "./websiteAccount";

const sealer: Sealer = {
  encrypt: async (text) => Buffer.from(`sealed:${text}`),
  decrypt: async (data) => ({ text: data.toString().replace(/^sealed:/, ""), stale: false }),
};
const dirs: string[] = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clink-account-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const APP_TOKEN = `clk_${"a".repeat(43)}`;
const CODE = "c".repeat(40);

/** The website, as far as the desktop client sees it. */
function fakeWebsite() {
  const calls: { route: string; init: RequestInit }[] = [];
  let challenge = "";
  let relayAnswers = 0;
  let relayStatus = 200;
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ route: `${init.method ?? "GET"} ${url.pathname}`, init });
    if (url.pathname === "/api/v1/app/token") {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      const ok = body.client_id === "coroslink-desktop" && body.grant_type === "authorization_code" && body.code === CODE
        && createHash("sha256").update(body.code_verifier).digest("base64url") === challenge;
      return ok ? Response.json({ schemaVersion: 1, accessToken: APP_TOKEN, tokenType: "Bearer", expiresAt: "2027-05-01T00:00:00.000Z", viewer: { handle: "aker" } })
        : Response.json({ code: "INVALID_GRANT" }, { status: 401 });
    }
    if (url.pathname === "/api/v1/app/relay-token") {
      if (relayStatus !== 200) return Response.json({ code: "UNAUTHORIZED" }, { status: relayStatus });
      relayAnswers++;
      return Response.json({ schemaVersion: 1, token: `jwt-${relayAnswers}`, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }
    if (url.pathname === "/api/v1/app/session") return new Response(null, { status: 204 });
    return new Response("not found", { status: 404 });
  });
  return { fetch, calls, setChallenge: (c: string) => { challenge = c; }, setRelayStatus: (s: number) => { relayStatus = s; } };
}

async function signedIn(dir = tempDir()) {
  const site = fakeWebsite();
  let opened = "";
  const account = new WebsiteAccount({ dir, sealer, origin: WEBSITE_URL, fetch: site.fetch as typeof fetch, openExternal: (url) => { opened = url; } });
  await account.load();
  await account.signIn();
  const query = new URL(opened).searchParams;
  site.setChallenge(query.get("code_challenge")!);
  await account.finish(`${CALLBACK_URL}?code=${CODE}&state=${query.get("state")}`);
  return { account, site, opened, dir };
}

describe("the website callback", () => {
  const state = "s".repeat(43);
  it("reads a code or an error, and nothing else", () => {
    expect(parseCallback(`coroslink://auth/callback?code=${CODE}&state=${state}`)).toEqual({ code: CODE, state });
    expect(parseCallback(`coroslink://auth/callback?error=access_denied&state=${state}`)).toEqual({ error: "access_denied", state });
    expect(parseCallback(`coroslink://auth/callback?code=${CODE}&state=${state}&extra=1`)).toBeNull();
    expect(parseCallback(`coroslink://auth/callback?code=${CODE}&code=${CODE}&state=${state}`)).toBeNull();
    expect(parseCallback(`coroslink://auth/callback?code=${CODE}&error=x&state=${state}`)).toBeNull();
    expect(parseCallback(`coroslink://auth/callback?code=short&state=${state}`)).toBeNull();
    expect(parseCallback(`clink://auth/callback?code=${CODE}&state=${state}`)).toBeNull();
    expect(parseCallback(`coroslink://evil/callback?code=${CODE}&state=${state}`)).toBeNull();
    expect(parseCallback(`coroslink://auth/callback?code=${CODE}&state=${state}#x`)).toBeNull();
  });

  it("is the production website in a shipped build, whatever the environment says", () => {
    const env = { COROSLINK_WATCHFACE_SITE_URL: "http://localhost:3000/x" };
    expect(websiteOrigin(true, env)).toBe(WEBSITE_URL);
    expect(websiteOrigin(false, env)).toBe("http://localhost:3000");
    expect(websiteOrigin(false, {})).toBe(WEBSITE_URL);
    expect(() => websiteOrigin(false, { COROSLINK_WATCHFACE_SITE_URL: "http://example.com" })).toThrow(/https/);
  });
});

describe("the website account", () => {
  it("signs in with PKCE through the browser, and stays signed in, sealed", async () => {
    const { account, opened, dir } = await signedIn();
    const url = new URL(opened);
    expect(url.origin + url.pathname).toBe(`${WEBSITE_URL}/apps/authorize`);
    expect(url.searchParams.get("client_id")).toBe("coroslink-desktop");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(account.status()).toEqual({ signedIn: true, handle: "aker", signingIn: false });
    expect(fs.readFileSync(path.join(dir, "website-account.bin"), "utf8").startsWith("sealed:")).toBe(true);
    const later = new WebsiteAccount({ dir, sealer, origin: WEBSITE_URL, openExternal: () => {} });
    await later.load();
    expect(later.status().signedIn).toBe(true);
  });

  it("takes only the answer to its own sign-in, once", async () => {
    const site = fakeWebsite();
    let opened = "";
    const account = new WebsiteAccount({ dir: tempDir(), sealer, origin: WEBSITE_URL, fetch: site.fetch as typeof fetch, openExternal: (url) => { opened = url; } });
    expect(account.handleCallback("https://example.com/")).toBe(false);
    await account.finish(`${CALLBACK_URL}?code=${CODE}&state=${"x".repeat(20)}`);
    expect(account.status()).toMatchObject({ signedIn: false, error: expect.stringMatching(/doesn't match/) });
    await account.signIn();
    expect(account.status().signingIn).toBe(true);
    const state = new URL(opened).searchParams.get("state");
    await account.finish(`${CALLBACK_URL}?error=access_denied&state=${state}`);
    expect(account.status()).toMatchObject({ signedIn: false, signingIn: false, error: "Sign-in was cancelled." });
    await account.finish(`${CALLBACK_URL}?code=${CODE}&state=${state}`);
    expect(account.status().signedIn).toBe(false);
    expect(site.calls).toEqual([]);
  });

  it("caches relay tokens, and fetches a new one when told", async () => {
    const { account, site } = await signedIn();
    expect(await account.relayToken()).toBe("jwt-1");
    expect(await account.relayToken()).toBe("jwt-1");
    account.forgetRelayToken();
    expect(await account.relayToken()).toBe("jwt-2");
    const relayCall = site.calls.find((c) => c.route === "POST /api/v1/app/relay-token")!;
    expect((relayCall.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${APP_TOKEN}`);
    expect(relayCall.init.redirect).toBe("manual");
  });

  it("is signed out when the website no longer takes the token", async () => {
    const { account, site, dir } = await signedIn();
    site.setRelayStatus(401);
    await expect(account.relayToken()).rejects.toMatchObject({ code: "signedOut" });
    expect(account.status().signedIn).toBe(false);
    expect(fs.existsSync(path.join(dir, "website-account.bin"))).toBe(false);
  });

  it("signs out here and on the website", async () => {
    const { account, site, dir } = await signedIn();
    await account.signOut();
    expect(account.status().signedIn).toBe(false);
    expect(fs.existsSync(path.join(dir, "website-account.bin"))).toBe(false);
    const call = site.calls.at(-1)!;
    expect(call.route).toBe("DELETE /api/v1/app/session");
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${APP_TOKEN}`);
  });
});
