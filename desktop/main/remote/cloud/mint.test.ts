import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type JsonWebKey } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sealer } from "../../secrets";
import { EnvironmentKey } from "../identity";
import { mintAnswer, MintError, mintRequestKid, verifyMintRequest, type MintClaims } from "./mint";
import type { RelayKey } from "./relay";

const sealer: Sealer = { encrypt: async (t) => Buffer.from(t), decrypt: async (d) => ({ text: d.toString(), stale: false }) };
const ENV_ID = "env_0123456789abcdef";
const ISSUER = "https://relay.coroslink.com";
const NOW = 1_800_000_000_000;
const now = Math.floor(NOW / 1000);
const JKT = "j".repeat(43);

const relay = generateKeyPairSync("ec", { namedCurve: "P-256" });
const relayJwk = relay.publicKey.export({ format: "jwk" });
const jwks: RelayKey[] = [{ kty: "EC", crv: "P-256", x: String(relayJwk.x), y: String(relayJwk.y), kid: "relay-1", alg: "ES256" }];

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function request(claims: Partial<MintClaims> & Record<string, unknown> = {}, header: Record<string, unknown> = {}, signer = relay.privateKey): string {
  const input = `${b64({ alg: "ES256", typ: "coroslink-relay-mint+jwt", kid: "relay-1", ...header })}.${b64({
    iss: ISSUER, aud: `coroslink-env:${ENV_ID}`, environmentId: ENV_ID, userId: "user-1", jkt: JKT, nonce: "n".repeat(43), iat: now, exp: now + 120, ...claims,
  })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: signer, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

const options = (seen = new Set<string>()) => ({
  environmentId: ENV_ID, linkedUserId: "user-1", issuer: ISSUER, jwks, now: NOW,
  seenNonce: (nonce: string) => { if (seen.has(nonce)) return true; seen.add(nonce); return false; },
});
const refusal = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof MintError ? error.code : "other"; } return "accepted"; };

let dir: string;
let key: EnvironmentKey;
beforeAll(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "clink-mint-")); key = await EnvironmentKey.load(dir, sealer); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a mint request", () => {
  it("passes when the relay signed it for this computer and its linked user", () => {
    expect(verifyMintRequest(request(), options())).toMatchObject({ environmentId: ENV_ID, userId: "user-1", jkt: JKT, nonce: "n".repeat(43) });
    expect(mintRequestKid(request())).toBe("relay-1");
    expect(mintRequestKid("junk")).toBeNull();
  });

  it("is refused for anything PROTOCOL.md says to check", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    const cases: [string, string][] = [
      [request({}, {}, other), "invalid"],
      [request({}, { typ: "JWT" }), "invalid"],
      [request({}, { alg: "none" }), "invalid"],
      [request({}, { kid: "relay-2" }), "unknownKey"],
      [request({ iss: "https://relay.evil.example" }), "invalid"],
      [request({ aud: "coroslink-env:someone-else" }), "invalid"],
      [request({ environmentId: "env_someone_else" }), "invalid"],
      [request({ userId: "user-2" }), "invalid"],
      [request({ iat: now - 400, exp: now - 280 }), "invalid"],
      [request({ exp: now + 600 }), "invalid"],
      [request({ iat: now + 300, exp: now + 400 }), "invalid"],
      [request({ jkt: "short" }), "invalid"],
      [request({ nonce: "tiny" }), "invalid"],
      ["not.a.jwt", "invalid"],
    ];
    for (const [jwt, code] of cases) expect(refusal(() => verifyMintRequest(jwt, options())), jwt).toBe(code);
  });

  it("is refused the second time its nonce is seen", () => {
    const seen = new Set<string>();
    verifyMintRequest(request(), options(seen));
    expect(refusal(() => verifyMintRequest(request(), options(seen)))).toBe("replayed");
  });

  it("doesn't use up a nonce on a request that fails its checks", () => {
    const seen = new Set<string>();
    expect(refusal(() => verifyMintRequest(request({ userId: "user-2" }), options(seen)))).toBe("invalid");
    expect(seen.size).toBe(0);
  });
});

describe("a mint answer", () => {
  it("carries a proof the relay can check against the environment key", () => {
    const claims = verifyMintRequest(request(), options());
    const expiresAt = NOW + 120_000;
    const answer = mintAnswer(claims, "rcb_credential", expiresAt, key, NOW);
    expect(answer.credential).toBe("rcb_credential");
    expect(answer.expiresAt).toBe(new Date(expiresAt).toISOString());
    const [h, p, s] = answer.proof.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "coroslink-env-mint+jws", alg: "ES256", kid: key.thumbprint });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      environmentId: ENV_ID, nonce: claims.nonce, jkt: JKT,
      credentialSha256: createHash("sha256").update("rcb_credential").digest("base64url"),
      exp: Math.floor(expiresAt / 1000), iat: now,
    });
    const publicKey = createPublicKey({ key: key.publicJwk as JsonWebKey, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("won't vouch for a credential that lasts longer than 10 minutes", () => {
    const claims = verifyMintRequest(request(), options());
    expect(() => mintAnswer(claims, "c", NOW + 601_000, key, NOW)).toThrow(/10 minutes/);
    expect(() => mintAnswer(claims, "c", NOW - 1, key, NOW)).toThrow();
  });
});
