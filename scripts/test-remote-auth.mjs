import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createDeviceKey,
  createFakeSecretBox,
  createProof,
  createRemoteDatabase,
  createSettings,
  jose,
  requireDist,
  sha256
} from "./remote-test-support.mjs";

// electron/remote/auth.ts and identity.ts against the compiled build, with an
// in-memory SQLite database holding the real remote_* tables and a hand-moved
// clock. Run under Electron as Node (npm run test:remote).
const { RemoteAuth, RemoteAuthError, verifyDpopProof, ReplayCache, normalizeHtu } = requireDist("./remote/auth.js");
const {
  encodeRemotePairingLink,
  parseRemotePairingLink,
  narrowPermissions,
  DEFAULT_GRANT_PERMISSIONS,
  SESSION_IDLE_TTL_MS
} = requireDist("./remote/contract.js");
const { loadOrCreateRemoteIdentity, preferredRemotePort, saveRemotePort, jwkThumbprint } = requireDist("./remote/identity.js");

const contract = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/coach-contract.json"), "utf8"));

const refusal = (status, code) => (error) => {
  assert.ok(error instanceof RemoteAuthError, `expected RemoteAuthError, got ${error}`);
  assert.equal(error.status, status, error.message);
  assert.equal(error.code, code, error.message);
  return true;
};

// ----- The shared vectors -----

{
  const { dpop } = contract;
  // The recorded proof verifies and yields its key's thumbprint. Its iat is
  // fixed, so the ±60 s window is skipped for this one.
  const verified = await verifyDpopProof({
    proof: dpop.proof,
    method: dpop.method,
    url: dpop.url,
    accessToken: dpop.accessToken,
    now: Date.now(),
    ignoreIssuedAt: true
  });
  assert.equal(verified.jkt, dpop.jkt);
  assert.equal(verified.jti, dpop.jti);
  assert.equal(verified.iat, dpop.iat);
  assert.equal(sha256(dpop.accessToken), dpop.ath);
  assert.equal(await jose.calculateJwkThumbprint(dpop.jwk, "sha256"), dpop.jkt);
  assert.equal(jwkThumbprint(dpop.jwk), dpop.jkt, "identity.ts's thumbprint matches jose's");
  assert.equal(normalizeHtu(dpop.url), dpop.htu);

  // With the window on, the same proof is too old.
  await assert.rejects(
    verifyDpopProof({ proof: dpop.proof, method: "POST", url: dpop.url, accessToken: dpop.accessToken, now: Date.now() }),
    refusal(400, "invalid_dpop_proof")
  );
  // At its own time it passes the window too.
  await verifyDpopProof({ proof: dpop.proof, method: "POST", url: dpop.htu, accessToken: dpop.accessToken, now: dpop.iat * 1000 });
  // Another token: ath no longer matches.
  await assert.rejects(
    verifyDpopProof({ proof: dpop.proof, method: "POST", url: dpop.url, accessToken: "tok_other", now: dpop.iat * 1000 }),
    refusal(400, "invalid_dpop_proof")
  );

  // The pairing link round-trips exactly, `'` and all.
  const { pairing } = contract;
  const parsed = parseRemotePairingLink(pairing.link);
  assert.equal(parsed.environmentId, pairing.environmentId);
  assert.deepEqual(parsed.hosts.map((host) => `http://${host}:${parsed.port}`), pairing.routes);
  assert.equal(parsed.name, pairing.name);
  assert.equal(parsed.secret, pairing.secret);
  assert.equal(encodeRemotePairingLink(parsed), pairing.link);
  assert.throws(() => parseRemotePairingLink(pairing.link.replace(/#.*/, "")), /pairing link/);
  assert.throws(() => parseRemotePairingLink(pairing.link.replace("p=47123", "p=80")), /pairing link/);
}

// ----- DPoP edge cases -----

{
  const key = await createDeviceKey();
  const other = await createDeviceKey();
  const url = "http://192.168.1.20:47123/v1/auth/ws-ticket";
  const now = Date.now();
  const iat = Math.floor(now / 1000);
  const token = `rcs_${"A".repeat(43)}`;
  const check = (proof, overrides = {}) =>
    verifyDpopProof({ proof, method: "POST", url, now, ...overrides }, overrides.replay);

  const good = await createProof(key, { url, iat });
  assert.equal((await check(good)).jkt, key.jkt);

  const replay = new ReplayCache();
  const once = await createProof(key, { url, iat });
  await check(once, { replay });
  await assert.rejects(check(once, { replay }), refusal(400, "invalid_dpop_proof"), "a proof works once");
  // The same jti from another key is another proof.
  await check(await createProof(other, { url, iat, jti: "shared-jti" }), { replay });
  await check(await createProof(key, { url, iat, jti: "shared-jti" }), { replay });

  const bad = {
    "another method": await createProof(key, { url, iat, method: "GET" }),
    "another host": await createProof(key, { url: "http://192.168.1.21:47123/v1/auth/ws-ticket", iat }),
    "another path": await createProof(key, { url: "http://192.168.1.20:47123/v1/auth/pair", iat }),
    "https for http": await createProof(key, { url: url.replace("http:", "https:"), iat }),
    "too old": await createProof(key, { url, iat: iat - 61 }),
    "from the future": await createProof(key, { url, iat: iat + 61 }),
    "typ jwt": await createProof(key, { url, iat, typ: "JWT" }),
    "no jti": await createProof(key, { url, iat, jti: null }),
    "no key": await createProof(key, { url, iat, jwk: null }),
    "another key in the header": await createProof(key, { url, iat, jwk: other.publicJwk })
  };
  for (const [name, proof] of Object.entries(bad)) {
    await assert.rejects(check(proof), refusal(400, "invalid_dpop_proof"), name);
  }
  // Within the window either side.
  await check(await createProof(key, { url, iat: iat - 59 }));
  await check(await createProof(key, { url, iat: iat + 59 }));
  // htu ignores the query, as RFC 9449 says.
  await check(await createProof(key, { url, iat }), { url: `${url}?x=1#frag` });

  // A private key in the header.
  const privateJwk = await jose.exportJWK(key.privateKey);
  await assert.rejects(check(await createProof(key, { url, iat, jwk: privateJwk })), refusal(400, "invalid_dpop_proof"));
  // Other algorithms.
  const p384 = await jose.generateKeyPair("ES384", { extractable: true });
  const p384Jwk = await jose.exportJWK(p384.publicKey);
  await assert.rejects(
    check(await createProof(key, { url, iat, alg: "ES384", jwk: p384Jwk, signingKey: p384.privateKey })),
    refusal(400, "invalid_dpop_proof")
  );
  const hmac = new TextEncoder().encode("x".repeat(32));
  await assert.rejects(
    check(await createProof(key, { url, iat, alg: "HS256", signingKey: hmac })),
    refusal(400, "invalid_dpop_proof")
  );
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "dpop+jwt", jwk: key.publicJwk })).toString("base64url")}.${Buffer.from(
    JSON.stringify({ htm: "POST", htu: url, iat, jti: "x" })
  ).toString("base64url")}.`;
  await assert.rejects(check(unsigned), refusal(400, "invalid_dpop_proof"), "alg none");
  // A tampered signature.
  const [head, body, signature] = good.split(".");
  const flipped = `${head}.${body}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BA" : "AA"}`;
  await assert.rejects(check(flipped), refusal(400, "invalid_dpop_proof"), "tampered signature");
  // Exactly one proof.
  await assert.rejects(check(`${good}, ${good}`), refusal(400, "invalid_dpop_proof"), "two proofs in one header");
  await assert.rejects(check([good, good]), refusal(400, "invalid_dpop_proof"), "a repeated header");
  await assert.rejects(check(undefined), refusal(400, "invalid_dpop_proof"), "no proof");

  // With a token: ath required and must match.
  await check(await createProof(key, { url, iat, token }), { accessToken: token });
  await assert.rejects(check(good, { accessToken: token }), refusal(400, "invalid_dpop_proof"), "no ath");
  await assert.rejects(
    check(await createProof(key, { url, iat, token: `rcs_${"B".repeat(43)}` }), { accessToken: token }),
    refusal(400, "invalid_dpop_proof"),
    "another token's ath"
  );
}

// ----- Pairing, sessions, scopes, revocation -----

const clock = { now: Date.parse("2026-10-16T10:00:00.000Z") };
const db = createRemoteDatabase();
const auth = new RemoteAuth({ database: () => db, now: () => clock.now });
const changes = [];
auth.onChange((change) => changes.push(change.kind));

const phone = await createDeviceKey();
const thief = await createDeviceKey();

{
  const first = auth.createPairing();
  assert.match(first.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(first.permissions, ["coach:read", "coach:operate", "coach:approve"]);
  assert.equal(first.expiresAt - first.createdAt, 10 * 60_000);
  assert.deepEqual(auth.pendingPairing(), { id: first.id, expiresAt: first.expiresAt });
  // Only hashes are stored.
  const stored = JSON.stringify(db.prepare("SELECT * FROM remote_pairing_grants").all());
  assert.ok(!stored.includes(first.secret), "the secret isn't stored");
  assert.ok(stored.includes(sha256(first.secret)));

  // A new code replaces an unused one.
  const second = auth.createPairing();
  assert.throws(() => auth.redeemPairing({ secret: first.secret, label: "iPhone", jkt: phone.jkt }), refusal(401, "invalid_grant"));

  const { grant, session } = auth.redeemPairing({ secret: second.secret, label: "Aker's iPhone\u0007", jkt: phone.jkt });
  assert.match(grant.sessionToken, /^rcs_[A-Za-z0-9_-]{43}$/);
  assert.equal(grant.expiresAt, new Date(clock.now + SESSION_IDLE_TTL_MS).toISOString());
  assert.deepEqual(grant.permissions, ["coach:read", "coach:operate", "coach:approve"]);
  assert.equal(session.label, "Aker's iPhone", "control characters are dropped from labels");
  assert.equal(session.jkt, phone.jkt);
  assert.equal(auth.pendingPairing(), null);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM remote_sessions").all()).includes(grant.sessionToken), "tokens are stored hashed");

  // One use.
  assert.throws(() => auth.redeemPairing({ secret: second.secret, label: "Again", jkt: thief.jkt }), refusal(401, "invalid_grant"));

  // The token works only with the key it is bound to.
  assert.equal(auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt }).id, session.id);
  assert.throws(() => auth.authenticate({ token: grant.sessionToken, jkt: thief.jkt }), refusal(401, "invalid_token"));
  assert.throws(() => auth.authenticate({ token: "rcs_nope", jkt: phone.jkt }), refusal(401, "invalid_token"));
  assert.throws(() => auth.authenticate({ token: `rcs_${"Z".repeat(43)}`, jkt: phone.jkt }), refusal(401, "invalid_token"));

  // Idle expiry slides with use.
  clock.now += 60 * 24 * 60 * 60_000;
  const used = auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt });
  assert.equal(used.expiresAt, clock.now + SESSION_IDLE_TTL_MS);
  clock.now += SESSION_IDLE_TTL_MS - 1_000;
  auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt });
  clock.now += SESSION_IDLE_TTL_MS + 1;
  assert.throws(() => auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt }), refusal(401, "invalid_token"), "idle too long");
  assert.equal(auth.session(session.id), null);
}

{
  // An unused code lapses after 10 minutes.
  const code = auth.createPairing();
  clock.now += 10 * 60_000 + 1;
  assert.equal(auth.pendingPairing(), null);
  assert.throws(() => auth.redeemPairing({ secret: code.secret, label: "Late", jkt: phone.jkt }), refusal(401, "invalid_grant"));
  assert.throws(() => auth.redeemPairing({ secret: "short", label: "x", jkt: phone.jkt }), refusal(401, "invalid_grant"));
  // Cancelled codes stop working.
  const cancelled = auth.createPairing();
  auth.cancelPairing(cancelled.id);
  assert.throws(() => auth.redeemPairing({ secret: cancelled.secret, label: "x", jkt: phone.jkt }), refusal(401, "invalid_grant"));
}

{
  // Narrowing: an exchange can ask for less, never more.
  assert.deepEqual(narrowPermissions(DEFAULT_GRANT_PERMISSIONS, ["coach:read", "access:write", "coach:someday"]), ["coach:read"]);
  const narrowed = auth.redeemPairing({
    secret: auth.createPairing().secret,
    label: "Viewer",
    jkt: phone.jkt,
    permissions: ["coach:read", "access:write"]
  });
  assert.deepEqual(narrowed.grant.permissions, ["coach:read"]);
  assert.throws(
    () => auth.authenticate({ token: narrowed.grant.sessionToken, jkt: phone.jkt, permission: "coach:operate" }),
    (error) => refusal(403, "forbidden")(error) && error.requiredPermission === "coach:operate"
  );
  auth.authenticate({ token: narrowed.grant.sessionToken, jkt: phone.jkt, permission: "coach:read" });

  // A view-only code can't be widened by asking.
  const viewOnly = auth.createPairing(["coach:read"]);
  assert.deepEqual(viewOnly.permissions, ["coach:read"]);
  const widened = auth.redeemPairing({
    secret: viewOnly.secret,
    label: "Viewer",
    jkt: phone.jkt,
    permissions: ["coach:read", "coach:operate", "coach:approve"]
  });
  assert.deepEqual(widened.grant.permissions, ["coach:read"]);

  // access:write is never granted to a device, however the code is made.
  assert.deepEqual(auth.createPairing(["access:write", "coach:approve"]).permissions, ["coach:read", "coach:approve"]);
  // Asking for nothing it grants.
  assert.throws(
    () => auth.redeemPairing({ secret: auth.createPairing().secret, label: "x", jkt: phone.jkt, permissions: ["access:write"] }),
    refusal(400, "invalid_request")
  );
  assert.throws(
    () => auth.redeemPairing({ secret: auth.createPairing().secret, label: "x", jkt: phone.jkt, permissions: "coach:read" }),
    refusal(400, "invalid_request")
  );
}

{
  // Relay bootstrap credentials: bound to the phone key, one use, about 2 minutes, nonce once.
  const minted = auth.mintBootstrap({ jkt: phone.jkt, nonce: "nonce-0000000000000001" });
  assert.match(minted.credential, /^rcb_[A-Za-z0-9_-]{43}$/);
  assert.equal(minted.expiresAt % 1000, 0, "whole seconds, for the proof's exp");
  assert.ok(minted.expiresAt - clock.now <= 2 * 60_000 && minted.expiresAt - clock.now > 115_000);
  assert.throws(() => auth.mintBootstrap({ jkt: phone.jkt, nonce: "nonce-0000000000000001" }), refusal(401, "replayed"));
  assert.throws(() => auth.mintBootstrap({ jkt: "short", nonce: "nonce-0000000000000002" }), refusal(400, "invalid_request"));

  // Another key can't spend it, and trying doesn't burn it.
  assert.throws(() => auth.redeemBootstrap({ credential: minted.credential, jkt: thief.jkt }), refusal(401, "invalid_grant"));
  const { grant, session } = auth.redeemBootstrap({ credential: minted.credential, jkt: phone.jkt });
  assert.equal(session.via, "bootstrap");
  assert.equal(session.label, "iPhone");
  assert.deepEqual(grant.permissions, ["coach:read", "coach:operate", "coach:approve"]);
  assert.throws(() => auth.redeemBootstrap({ credential: minted.credential, jkt: phone.jkt }), refusal(401, "invalid_grant"), "one use");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM remote_pairing_grants").all()).includes(minted.credential));

  const late = auth.mintBootstrap({ jkt: phone.jkt, nonce: "nonce-0000000000000003" });
  clock.now += 2 * 60_000 + 1;
  assert.throws(() => auth.redeemBootstrap({ credential: late.credential, jkt: phone.jkt }), refusal(401, "invalid_grant"), "expired");
  // Narrowing applies here too.
  const narrow = auth.mintBootstrap({ jkt: phone.jkt, nonce: "nonce-0000000000000004" });
  assert.deepEqual(
    auth.redeemBootstrap({ credential: narrow.credential, jkt: phone.jkt, permissions: ["coach:read"] }).grant.permissions,
    ["coach:read"]
  );
}

{
  // WebSocket tickets: single use, 30 seconds, gone with the session.
  const { grant, session } = auth.redeemPairing({ secret: auth.createPairing().secret, label: "Ticket", jkt: phone.jkt });
  const record = auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt });
  const ticket = auth.issueTicket(record);
  assert.match(ticket.ticket, /^wst_[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(ticket.expiresAt) - clock.now, 30_000);
  assert.equal(auth.redeemTicket(ticket.ticket).id, session.id);
  assert.equal(auth.redeemTicket(ticket.ticket), null, "single use");
  const stale = auth.issueTicket(record);
  clock.now += 30_001;
  assert.equal(auth.redeemTicket(stale.ticket), null, "expired");
  assert.equal(auth.redeemTicket("wst_nope"), null);
  for (let index = 0; index < 16; index += 1) auth.issueTicket(record);
  assert.throws(() => auth.issueTicket(record), refusal(429, "rate_limited"), "outstanding tickets are capped");

  // Revocation ends the session, its token and its tickets.
  const pending = auth.issueTicket({ ...record, id: "unrelated" });
  assert.ok(pending.ticket);
  changes.length = 0;
  assert.equal(auth.revokeSession(session.id), true);
  assert.deepEqual(changes, ["revoked"]);
  assert.equal(auth.revokeSession(session.id), false, "already revoked");
  assert.throws(() => auth.authenticate({ token: grant.sessionToken, jkt: phone.jkt }), refusal(401, "invalid_token"));
  assert.ok(!auth.listSessions().some((entry) => entry.id === session.id));
}

{
  // Housekeeping keeps live rows only.
  clock.now += 31 * 24 * 60 * 60_000;
  auth.prune();
  const remaining = db.prepare("SELECT COUNT(*) AS count FROM remote_pairing_grants").get().count;
  assert.equal(remaining, 0);
}

// ----- Identity -----

{
  const settings = createSettings();
  const box = createFakeSecretBox();
  const identity = loadOrCreateRemoteIdentity(settings, box);
  assert.match(identity.environmentId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(Buffer.from(identity.environmentId, "base64url").length, 16);
  assert.equal(identity.kid, await jose.calculateJwkThumbprint(identity.publicJwk, "sha256"));
  assert.ok(!settings.values.get("remote.identity").includes(identity.privateJwk.d), "the private key is kept encrypted");
  // Made once: later loads return the same identity.
  const again = loadOrCreateRemoteIdentity(settings, box);
  assert.deepEqual(again, identity);
  // The key signs and verifies.
  const signed = await new jose.CompactSign(new TextEncoder().encode("hello"))
    .setProtectedHeader({ alg: "ES256" })
    .sign(await jose.importJWK(identity.privateJwk, "ES256"));
  await jose.compactVerify(signed, await jose.importJWK(identity.publicJwk, "ES256"));

  // No safe storage (Linux basic_text): refuse, and store nothing.
  const refusing = createSettings();
  assert.throws(() => loadOrCreateRemoteIdentity(refusing, createFakeSecretBox({ available: false })), /Secure credential storage/);
  assert.equal(refusing.values.size, 0);
  // A key that won't decrypt is reported, not replaced.
  const broken = createSettings();
  loadOrCreateRemoteIdentity(broken, box);
  assert.throws(
    () => loadOrCreateRemoteIdentity(broken, { ...box, decrypt: () => { throw new Error("locked"); } }),
    /unlock/
  );

  // The port is picked once and kept.
  const ports = createSettings();
  const first = preferredRemotePort(ports, () => 0.5);
  assert.ok(first >= 41_000 && first <= 48_999);
  assert.equal(preferredRemotePort(ports, () => 0.1), first);
  saveRemotePort(ports, 45_123);
  assert.equal(preferredRemotePort(ports), 45_123);
}

console.log("remote auth tests passed");
