import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createFakeSecretBox, createSettings, requireDist } from "./remote-test-support.mjs";

// electron/remote/cloud/websiteAccount.ts: the coroslink://auth/callback
// parser, PKCE, and the sign-in → clk_ token → relay token flow against a
// stub watchfaces.coroslink.com. Run with `npm run test:website-sign-in`.
const {
  AUTH_CALLBACK_URL,
  WebsiteAccount,
  authorizeUrl,
  createPkce,
  isAuthCallbackUrl,
  parseAuthCallback,
  websiteBaseUrl
} = requireDist("./remote/cloud/websiteAccount.js");

const b64 = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const state = b64(32);
const code = b64(32);
const callback = (query) => `${AUTH_CALLBACK_URL}${query}`;

// ----- Parsing the callback -----
{
  assert.equal(AUTH_CALLBACK_URL, "coroslink://auth/callback");
  assert.deepEqual(parseAuthCallback(callback(`?code=${code}&state=${state}`)), { kind: "code", code, state });
  assert.deepEqual(parseAuthCallback(callback(`?state=${state}&code=${code}`)), { kind: "code", code, state });
  assert.deepEqual(parseAuthCallback(callback(`?error=access_denied&state=${state}`)), {
    kind: "error",
    error: "access_denied",
    state
  });
  assert.deepEqual(parseAuthCallback(callback(`?error=access_denied&error_description=Nope&state=${state}`)), {
    kind: "error",
    error: "access_denied",
    state
  });

  const refused = {
    "no state": `?code=${code}`,
    "short state": `?code=${code}&state=abc`,
    "state with other characters": `?code=${code}&state=${state.slice(0, 20)}%2B${state.slice(21)}`,
    "long state": `?code=${code}&state=${"a".repeat(129)}`,
    "short code": `?code=${code.slice(0, 31)}&state=${state}`,
    "long code": `?code=${"a".repeat(129)}&state=${state}`,
    "code with other characters": `?code=${code.slice(0, 40)}.ab&state=${state}`,
    "code and error": `?code=${code}&error=access_denied&state=${state}`,
    "neither": `?state=${state}`,
    "repeated state": `?code=${code}&state=${state}&state=${state}`,
    "repeated code": `?code=${code}&code=${code}&state=${state}`,
    "an extra parameter": `?code=${code}&state=${state}&redirect=https://example.com`,
    "an error description with a code": `?code=${code}&error_description=x&state=${state}`,
    "an odd error": `?error=Access-Denied!&state=${state}`,
    "a fragment": `?code=${code}&state=${state}#x`
  };
  for (const [label, query] of Object.entries(refused)) {
    assert.equal(parseAuthCallback(callback(query)), null, label);
  }
  for (const url of [
    `coroslink://watchfaces/some-face?code=${code}&state=${state}`,
    `coroslink://auth/callback/extra?code=${code}&state=${state}`,
    `coroslink://auth/other?code=${code}&state=${state}`,
    `https://auth/callback?code=${code}&state=${state}`,
    `coroslink://user@auth/callback?code=${code}&state=${state}`,
    "not a url"
  ]) {
    assert.equal(parseAuthCallback(url), null, url);
  }

  assert.equal(isAuthCallbackUrl(callback(`?code=${code}&state=${state}`)), true);
  assert.equal(isAuthCallbackUrl("COROSLINK://auth/callback?x"), true);
  assert.equal(isAuthCallbackUrl("coroslink://watchfaces/run-club"), false);
  assert.equal(isAuthCallbackUrl("coroslink://auth/callbackx"), false);
}

// ----- PKCE and the authorize URL -----
{
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, crypto.createHash("sha256").update(verifier).digest("base64url"));
  const url = new URL(authorizeUrl("https://watchfaces.coroslink.com", { challenge, state }));
  assert.equal(url.origin + url.pathname, "https://watchfaces.coroslink.com/apps/authorize");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "coroslink-desktop",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state
  });
  assert.equal(websiteBaseUrl({ isPackaged: true, override: "http://127.0.0.1:3000" }), "https://watchfaces.coroslink.com");
  assert.equal(websiteBaseUrl({ isPackaged: false, override: "http://127.0.0.1:3000/x" }), "http://127.0.0.1:3000");
  assert.throws(() => websiteBaseUrl({ isPackaged: false, override: "http://example.com" }), /https/);
}

// ----- Signing in against a stub website -----
const appToken = `clk_${b64(32)}`;
const requests = [];
let relayStatus = 200;
let relayIssued = 0;
let clock = Date.parse("2026-10-16T12:00:00Z");
let challengeSeen = null;
const website = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    const json = (status, value) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (request.method === "POST" && request.url === "/api/v1/app/token") {
      const verified =
        body.grant_type === "authorization_code" &&
        body.client_id === "coroslink-desktop" &&
        body.code === code &&
        crypto.createHash("sha256").update(body.code_verifier).digest("base64url") === challengeSeen;
      if (!verified) return json(400, { code: "INVALID_GRANT", message: "Bad code." });
      return json(200, {
        schemaVersion: 1,
        accessToken: appToken,
        tokenType: "Bearer",
        expiresAt: "2027-04-14T12:00:00.000Z",
        viewer: { handle: "aker", displayName: "Aker", needsUsername: false }
      });
    }
    if (request.method === "POST" && request.url === "/api/v1/app/relay-token") {
      if (request.headers.authorization !== `Bearer ${appToken}`) return json(401, { code: "UNAUTHORIZED" });
      if (relayStatus !== 200) return json(relayStatus, { code: "UNAUTHORIZED", message: "Signed out." });
      relayIssued += 1;
      return json(200, { schemaVersion: 1, token: `relay-jwt-${relayIssued}`, expiresAt: new Date(clock + 600_000).toISOString() });
    }
    if (request.method === "DELETE" && request.url === "/api/v1/app/session") {
      return json(200, { signedOut: true });
    }
    json(404, { code: "NOT_FOUND" });
  });
});
await new Promise((resolve) => website.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${website.address().port}`;

try {
  const settings = createSettings();
  const secrets = createFakeSecretBox();
  const opened = [];
  let changes = 0;
  const account = new WebsiteAccount({
    origin,
    settings,
    secrets,
    openExternal: async (url) => {
      opened.push(url);
    },
    now: () => clock,
    onChange: () => {
      changes += 1;
    }
  });
  assert.deepEqual(account.status(), { signedIn: false, viewer: null, signingIn: false });
  await assert.rejects(account.relayToken(), /Sign in/);

  const begin = async () => {
    await account.beginSignIn();
    const url = new URL(opened.at(-1));
    challengeSeen = url.searchParams.get("code_challenge");
    return url.searchParams.get("state");
  };

  // A callback for a sign-in this computer didn't start is refused, and doesn't cancel the real one.
  const started = await begin();
  assert.equal(account.status().signingIn, true);
  assert.ok(changes > 0);
  await account.handleCallback(callback(`?code=${code}&state=${b64(32)}`));
  assert.match(account.status().error, /doesn't match a sign-in started on this computer/);
  assert.equal(account.status().signingIn, true);
  assert.equal(requests.length, 0, "no code is spent for a mismatched state");

  // A malformed callback is refused.
  await account.handleCallback(callback(`?code=short&state=${started}`));
  assert.match(account.status().error, /isn't valid/);
  assert.equal(account.status().signingIn, true);

  // The real answer: the code and verifier are traded for a clk_ token, kept encrypted.
  await account.handleCallback(callback(`?code=${code}&state=${started}`));
  const status = account.status();
  assert.equal(status.signedIn, true, status.error);
  assert.deepEqual(status.viewer, { handle: "aker", displayName: "Aker" });
  assert.equal(status.signingIn, false);
  assert.equal(status.error, undefined);
  assert.equal(requests.at(-1).url, "/api/v1/app/token");
  assert.ok(![...settings.values.values()].some((value) => value.includes(appToken)), "the clk_ token isn't stored in plain text");

  // The same callback again: nothing is waiting for it.
  const tokenCalls = requests.filter((entry) => entry.url === "/api/v1/app/token").length;
  await account.handleCallback(callback(`?code=${code}&state=${started}`));
  assert.match(account.status().error, /doesn't match/);
  assert.equal(requests.filter((entry) => entry.url === "/api/v1/app/token").length, tokenCalls);
  assert.equal(account.status().signedIn, true);

  // Cancel in the browser.
  const second = await begin();
  await account.handleCallback(callback(`?error=access_denied&state=${second}`));
  assert.equal(account.status().error, "Sign-in was cancelled.");
  assert.equal(account.status().signingIn, false);

  // A sign-in left too long expires.
  const third = await begin();
  clock += 11 * 60_000;
  assert.equal(account.status().signingIn, false);
  await account.handleCallback(callback(`?code=${code}&state=${third}`));
  assert.match(account.status().error, /doesn't match/);

  // Relay tokens: fetched with the clk_ token, cached until a minute before they expire.
  assert.equal(await account.relayToken(), "relay-jwt-1");
  assert.equal(await account.relayToken(), "relay-jwt-1");
  assert.equal(requests.at(-1).authorization, `Bearer ${appToken}`);
  clock += 8 * 60_000;
  assert.equal(await account.relayToken(), "relay-jwt-1");
  clock += 90_000;
  assert.equal(await account.relayToken(), "relay-jwt-2");
  account.forgetRelayToken();
  assert.equal(await account.relayToken(), "relay-jwt-3");

  // Revoked on the website: the next relay token signs this computer out.
  relayStatus = 401;
  account.forgetRelayToken();
  await assert.rejects(account.relayToken(), (error) => error.code === "signed_out");
  assert.equal(account.status().signedIn, false);

  // Signing out tells the website and forgets the token here.
  relayStatus = 200;
  const fourth = await begin();
  await account.handleCallback(callback(`?code=${code}&state=${fourth}`));
  assert.equal(account.status().signedIn, true);
  await account.signOut();
  assert.equal(account.status().signedIn, false);
  const signOut = requests.at(-1);
  assert.deepEqual([signOut.method, signOut.url, signOut.authorization], ["DELETE", "/api/v1/app/session", `Bearer ${appToken}`]);

  // No safe place for the token (Linux basic_text): refused before opening a browser.
  const locked = new WebsiteAccount({
    origin,
    settings: createSettings(),
    secrets: createFakeSecretBox({ available: false }),
    openExternal: async (url) => opened.push(url)
  });
  const openedBefore = opened.length;
  await assert.rejects(locked.beginSignIn(), /Secure credential storage is unavailable/);
  assert.equal(opened.length, openedBefore);

  console.log("website sign-in: ok");
} finally {
  website.close();
}
